import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WebSocket } from 'ws';
import type {
  AgentConfig,
  EventType,
  HubSettings,
  IntegrationKind,
  Preferences,
  ServerMessage,
  Snapshot,
} from '../shared/types.ts';
import { Store } from './db.ts';
import { StateEngine } from './state.ts';
import { ADAPTERS, genericEvents, integrationInfo, type AdapterContext, type Connector } from './adapters.ts';
import { Secrets } from './secrets.ts';
import { checkProvider } from './providers.ts';
import { Auth, COOKIE, isLoopback, isPrivate, newToken, sha256 } from './auth.ts';
import { Shop, loadShopConfig } from './shop.ts';
import { ACCESSORY_IDS, ARCHETYPE_IDS, ISLAND_IDS, ITEM, dailyDeals, dealDay } from '../shared/cosmetics.ts';
import { DemoDriver } from './demo.ts';
import { DEFAULT_HUB, DEFAULT_PREFS, defaultAgents } from './defaults.ts';
// @ts-ignore -- plain ESM helper shared with the CLI
import { install as installHooks, status as hooksStatus, uninstall as uninstallHooks } from '../scripts/install-hooks.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.AI_VILLAGE_PORT ?? 7777);
const HOST = process.env.AI_VILLAGE_HOST ?? '0.0.0.0';
const DATA = process.env.AI_VILLAGE_DATA ?? join(ROOT, 'data');
const DIST = join(ROOT, 'web', 'dist');
const EMITTER = join(ROOT, 'hooks', 'emit.mjs').replace(/\\/g, '/');
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version as string;

// ------------------------------------------------------------------ state

const store = new Store(join(DATA, 'village.db'));
const secrets = new Secrets(process.env.AI_VILLAGE_SECRETS);
const auth = new Auth(store);
const shop = new Shop(store, loadShopConfig(ROOT));

store.abandonRunningTasks(Date.now());

let agents: AgentConfig[] = store.listAgents();
if (!agents.length && !store.getKv('seeded', false)) {
  for (const a of defaultAgents((n) => secrets.has(n))) store.saveAgent({ ...a, createdAt: Date.now(), hasIngestToken: false });
  store.setKv('seeded', true);
  agents = store.listAgents();
}
let hub: HubSettings = { ...DEFAULT_HUB, ...store.getKv<Partial<HubSettings>>('hub', {}) };
let prefs: Preferences = { ...DEFAULT_PREFS, ...store.getKv<Partial<Preferences>>('prefs', {}) };
const getAgents = () => agents;

const clients = new Set<WebSocket>();
function broadcast(msg: ServerMessage) {
  const data = JSON.stringify(msg);
  for (const ws of clients) if (ws.readyState === 1) ws.send(data);
}

function makeEngine(demo: boolean) {
  const engine: StateEngine = new StateEngine({
    demo,
    store,
    getAgents,
    getSessionTimeoutMs: () => hub.sessionTimeoutMin * 60_000,
    onEvent: (event) => {
      if (hub.demoMode === demo) broadcast({ t: 'event', event });
    },
    onLive: (live) => {
      if (hub.demoMode === demo) broadcast({ t: 'live', live, stats: engine.stats() });
    },
  });
  return engine;
}
const realEngine = makeEngine(false);
const demoEngine = makeEngine(true);
const activeEngine = () => (hub.demoMode ? demoEngine : realEngine);
const demo = new DemoDriver(demoEngine, getAgents);

const hubUrl = `http://127.0.0.1:${PORT}`;
const ctx: AdapterContext = {
  engine: realEngine,
  secrets,
  emitterPath: EMITTER,
  hubUrl,
  captureDetails: () => hub.captureDetails,
  promptPreviews: () => hub.promptPreviews,
  log: (m) => app.log.info(m),
};

// ------------------------------------------------------------------ connectors

const connectors = new Map<string, Connector>();
function startConnector(a: AgentConfig) {
  stopConnector(a.id);
  const adapter = ADAPTERS[a.integration];
  if (a.enabled && adapter?.connect) connectors.set(a.id, adapter.connect(a, ctx));
}
function stopConnector(id: string) {
  connectors.get(id)?.stop();
  connectors.delete(id);
}

async function refreshProvider(a: AgentConfig, allowKeyCheck = true) {
  const health = await checkProvider(a, secrets, allowKeyCheck);
  realEngine.setProvider(a.id, health);
  demoEngine.setProvider(a.id, health);
  return health;
}
async function refreshAllProviders() {
  if (!hub.providerChecks) return;
  for (const a of agents) if (a.enabled) await refreshProvider(a).catch(() => {});
}

function snapshot(): Snapshot {
  const e = activeEngine();
  return { serverTime: Date.now(), demo: hub.demoMode, agents, live: e.allLive(), stats: e.stats(), hub };
}

function reloadAgents() {
  agents = store.listAgents();
  broadcast({ t: 'agents', agents });
  broadcast({ t: 'snapshot', snapshot: snapshot() });
}

// ------------------------------------------------------------------ server

const tls =
  process.env.AI_VILLAGE_TLS_CERT && process.env.AI_VILLAGE_TLS_KEY
    ? { cert: readFileSync(process.env.AI_VILLAGE_TLS_CERT), key: readFileSync(process.env.AI_VILLAGE_TLS_KEY) }
    : existsSync(join(DATA, 'tls', 'cert.pem'))
      ? { cert: readFileSync(join(DATA, 'tls', 'cert.pem')), key: readFileSync(join(DATA, 'tls', 'key.pem')) }
      : null;

const app = Fastify({
  logger: { level: process.env.AI_VILLAGE_LOG ?? 'warn' },
  bodyLimit: 256 * 1024,
  trustProxy: false,
  ...(tls ? { https: tls } : {}),
});

await app.register(cookie);
await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

// Private-network guard: refuse anything that isn't loopback or a private LAN address.
app.addHook('onRequest', async (req, reply) => {
  if (!isPrivate(req.ip)) {
    reply.code(403).send({ error: 'AI Village only accepts connections from your private network.' });
    return reply;
  }
  reply.header('x-content-type-options', 'nosniff');
  reply.header('referrer-policy', 'no-referrer');
  reply.header('x-frame-options', 'DENY');
});

const PUBLIC = [/^\/api\/auth\//, /^\/api\/health$/, /^\/api\/ingest\//, /^\/api\/v1\//, /^\/mcp/];

app.addHook('preHandler', async (req, reply) => {
  const path = req.url.split('?')[0];
  if (!path.startsWith('/api/') && path !== '/ws') return;
  if (PUBLIC.some((r) => r.test(path))) return;
  if (!auth.check(req)) {
    reply.code(401).send({ error: 'Sign in required.' });
    return reply;
  }
  // CSRF: state-changing requests must come from our own origin.
  if (req.method !== 'GET' && req.headers.origin) {
    const host = req.headers.host;
    try {
      if (new URL(req.headers.origin).host !== host) {
        reply.code(403).send({ error: 'Cross-origin request refused.' });
        return reply;
      }
    } catch {
      reply.code(403).send({ error: 'Bad origin.' });
      return reply;
    }
  }
});

const bad = (reply: FastifyReply, code: number, error: string) => reply.code(code).send({ error });

// ---- auth
app.get('/api/health', async () => ({ ok: true, version: VERSION }));

app.get('/api/auth/status', async (req) => ({
  configured: auth.configured,
  authenticated: auth.check(req),
  canSetup: !auth.configured && isLoopback(req.ip),
}));

function setSessionCookie(req: FastifyRequest, reply: FastifyReply) {
  const { token, maxAge } = auth.createSession(String(req.headers['user-agent'] ?? '').slice(0, 200) || null);
  reply.setCookie(COOKIE, token, { httpOnly: true, sameSite: 'strict', path: '/', maxAge, secure: !!tls });
}

app.post<{ Body: { password?: string } }>('/api/auth/setup', async (req, reply) => {
  if (auth.configured) return bad(reply, 409, 'A password is already set.');
  if (!isLoopback(req.ip)) return bad(reply, 403, 'Finish setup on the PC running AI Village (open http://localhost:7777 there).');
  try {
    auth.setPassword(String(req.body?.password ?? ''));
  } catch (e) {
    return bad(reply, 400, (e as Error).message);
  }
  setSessionCookie(req, reply);
  return { ok: true };
});

app.post<{ Body: { password?: string } }>('/api/auth/login', async (req, reply) => {
  if (!auth.allowAttempt(req.ip)) return bad(reply, 429, 'Too many attempts. Wait a few minutes.');
  if (!auth.verify(String(req.body?.password ?? ''))) return bad(reply, 401, 'Wrong password.');
  setSessionCookie(req, reply);
  return { ok: true };
});

app.post('/api/auth/logout', async (req, reply) => {
  auth.destroy(req);
  reply.clearCookie(COOKIE, { path: '/' });
  return { ok: true };
});

app.post<{ Body: { current?: string; next?: string } }>('/api/auth/password', async (req, reply) => {
  if (!auth.check(req)) return bad(reply, 401, 'Sign in required.');
  if (!auth.verify(String(req.body?.current ?? ''))) return bad(reply, 401, 'Current password is wrong.');
  try {
    auth.setPassword(String(req.body?.next ?? ''));
  } catch (e) {
    return bad(reply, 400, (e as Error).message);
  }
  setSessionCookie(req, reply);
  return { ok: true };
});

// ---- snapshot / events
app.get('/api/snapshot', async () => snapshot());

app.get<{ Querystring: { agent?: string; types?: string; since?: string; before?: string; limit?: string } }>('/api/events', async (req) => {
  const q = req.query;
  return store.queryEvents({
    demo: hub.demoMode,
    agentId: q.agent || undefined,
    types: q.types ? (q.types.split(',') as EventType[]) : undefined,
    since: q.since ? Number(q.since) : undefined,
    before: q.before ? Number(q.before) : undefined,
    limit: q.limit ? Number(q.limit) : 100,
  });
});

// ---- agents
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

function sanitizeAgent(input: Partial<AgentConfig>, existing?: AgentConfig): AgentConfig | string {
  const a: AgentConfig = {
    id: existing?.id ?? String(input.id ?? '').toLowerCase(),
    name: String(input.name ?? existing?.name ?? '').trim().slice(0, 32),
    provider: String(input.provider ?? existing?.provider ?? 'custom').trim().toLowerCase().slice(0, 32) || 'custom',
    integration: (input.integration ?? existing?.integration ?? 'http-push') as IntegrationKind,
    color: String(input.color ?? existing?.color ?? '#7C8CFF'),
    personality: String(input.personality ?? existing?.personality ?? '').slice(0, 300),
    voice: input.voice ?? existing?.voice ?? 'neutral',
    appearance: {
      shape: 'round',
      accessory: 'none',
      expression: 'friendly',
      scale: 1,
      ...existing?.appearance,
      ...input.appearance,
    },
    enabled: input.enabled ?? existing?.enabled ?? true,
    settings: { ...existing?.settings, ...input.settings },
    secretRef: input.secretRef !== undefined ? input.secretRef || null : (existing?.secretRef ?? null),
    hasIngestToken: existing?.hasIngestToken ?? false,
    createdAt: existing?.createdAt ?? Date.now(),
    sort: input.sort ?? existing?.sort ?? agents.length,
  };
  if (!ID_RE.test(a.id)) return 'Agent id must be lowercase letters, numbers and dashes.';
  if (!a.name) return 'Name is required.';
  if (!COLOR_RE.test(a.color)) return 'Color must look like #A47CFF.';
  if (!ADAPTERS[a.integration]) return 'Unknown integration.';
  if (a.secretRef && !secrets.has(a.secretRef)) return `No stored secret named "${a.secretRef}".`;
  a.appearance.scale = Math.min(1.3, Math.max(0.8, Number(a.appearance.scale) || 1));
  if (a.appearance.archetype && !ARCHETYPE_IDS.includes(a.appearance.archetype)) delete a.appearance.archetype;
  if (!ACCESSORY_IDS.includes(a.appearance.accessory)) a.appearance.accessory = 'none';
  // Shop items: anything newly chosen must be unlocked on this install (existing looks are kept).
  for (const id of [`character:${a.appearance.archetype}`, `accessory:${a.appearance.accessory}`]) {
    const was = id.startsWith('character:') ? `character:${existing?.appearance.archetype}` : `accessory:${existing?.appearance.accessory}`;
    if (ITEM[id] && id !== was && !shop.owns(id)) return `Unlock the ${ITEM[id].name} ${ITEM[id].kind} in the shop first.`;
  }
  for (const [k, v] of Object.entries(a.settings)) {
    if (!['string', 'number', 'boolean'].includes(typeof v)) delete a.settings[k];
    else if (typeof v === 'string') a.settings[k] = v.slice(0, 500);
  }
  return a;
}

app.get<{ Querystring: { agent?: string; limit?: string } }>('/api/tasks', async (req) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 60) || 60));
  const agentId = req.query.agent && agents.some((a) => a.id === req.query.agent) ? req.query.agent : null;
  return { demo: hub.demoMode, tasks: store.listTasks(agentId, hub.demoMode, limit) };
});

app.get<{ Params: { id: string } }>('/api/agents/:id', async (req, reply) => {
  const a = agents.find((x) => x.id === req.params.id);
  if (!a) return bad(reply, 404, 'No such agent.');
  const e = activeEngine();
  const now = Date.now();
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  return {
    agent: a,
    live: e.live(a.id),
    integration: integrationInfo(a, ctx),
    tasks: store.listTasks(a.id, hub.demoMode, 25),
    today: store.taskStats(a.id, hub.demoMode, midnight.getTime()),
    week: store.taskStats(a.id, hub.demoMode, now - 7 * 86_400_000),
    activeTodayMs: store.activeMs(a.id, hub.demoMode, midnight.getTime(), now),
    activeWeekMs: store.activeMs(a.id, hub.demoMode, now - 7 * 86_400_000, now),
    errors: store.queryEvents({ demo: hub.demoMode, agentId: a.id, types: ['agent.error', 'task.failed', 'tool.failed'], limit: 10 }),
    timeline: store.queryEvents({ demo: hub.demoMode, agentId: a.id, limit: 60 }),
  };
});

app.post<{ Body: Partial<AgentConfig> }>('/api/agents', async (req, reply) => {
  const body = req.body ?? {};
  if (!body.id && body.name) body.id = String(body.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32);
  if (agents.some((a) => a.id === body.id)) return bad(reply, 409, `An agent with id "${body.id}" already exists.`);
  const a = sanitizeAgent(body);
  if (typeof a === 'string') return bad(reply, 400, a);
  store.saveAgent(a);
  reloadAgents();
  const saved = agents.find((x) => x.id === a.id)!;
  startConnector(saved);
  void refreshProvider(saved, false).catch(() => {});
  return saved;
});

app.patch<{ Params: { id: string }; Body: Partial<AgentConfig> }>('/api/agents/:id', async (req, reply) => {
  const existing = agents.find((x) => x.id === req.params.id);
  if (!existing) return bad(reply, 404, 'No such agent.');
  const a = sanitizeAgent(req.body ?? {}, existing);
  if (typeof a === 'string') return bad(reply, 400, a);
  const linkChanged =
    a.enabled !== existing.enabled ||
    a.integration !== existing.integration ||
    a.secretRef !== existing.secretRef ||
    JSON.stringify(a.settings) !== JSON.stringify(existing.settings);
  store.saveAgent(a);
  agents = store.listAgents();
  if (linkChanged) {
    realEngine.resetLive(a.id);
    startConnector(a);
  }
  reloadAgents();
  return agents.find((x) => x.id === a.id);
});

app.delete<{ Params: { id: string } }>('/api/agents/:id', async (req, reply) => {
  if (!agents.some((x) => x.id === req.params.id)) return bad(reply, 404, 'No such agent.');
  stopConnector(req.params.id);
  realEngine.forget(req.params.id);
  demoEngine.forget(req.params.id);
  store.deleteAgent(req.params.id);
  reloadAgents();
  return { ok: true };
});

app.post<{ Params: { id: string } }>('/api/agents/:id/reconnect', async (req, reply) => {
  const a = agents.find((x) => x.id === req.params.id);
  if (!a) return bad(reply, 404, 'No such agent.');
  realEngine.resetLive(a.id);
  startConnector(a);
  void refreshProvider(a).catch(() => {});
  return { ok: true, message: ADAPTERS[a.integration].connect ? 'Reconnecting…' : 'Live sessions cleared. New events will repopulate them.' };
});

app.post<{ Params: { id: string } }>('/api/agents/:id/test', async (req, reply) => {
  const a = agents.find((x) => x.id === req.params.id);
  if (!a) return bad(reply, 404, 'No such agent.');
  const adapter = ADAPTERS[a.integration];
  const runtime = adapter.test ? await adapter.test(a, ctx) : null;
  const provider = await refreshProvider(a);
  return { runtime, provider };
});

app.post<{ Params: { id: string } }>('/api/agents/:id/token', async (req, reply) => {
  const a = agents.find((x) => x.id === req.params.id);
  if (!a) return bad(reply, 404, 'No such agent.');
  const token = `avt_${newToken(24)}`;
  store.setIngestTokenHash(a.id, sha256(token));
  reloadAgents();
  return { token, note: 'Copy this now. Only a hash is stored, so it cannot be shown again.' };
});

app.delete<{ Params: { id: string } }>('/api/agents/:id/token', async (req) => {
  store.setIngestTokenHash(req.params.id, null);
  reloadAgents();
  return { ok: true };
});

app.get<{ Querystring: { kind?: string; agentId?: string } }>('/api/integrations', async (req) => {
  const sample = (kind: IntegrationKind): AgentConfig => agents.find((a) => a.id === req.query.agentId && a.integration === kind) ?? {
    id: req.query.agentId || 'my-agent',
    name: 'My agent',
    provider: 'custom',
    integration: kind,
    color: '#7C8CFF',
    personality: '',
    voice: 'neutral',
    appearance: { shape: 'round', accessory: 'none', expression: 'friendly', scale: 1 },
    enabled: true,
    settings: {},
    secretRef: null,
    hasIngestToken: false,
    createdAt: 0,
    sort: 0,
  };
  return (Object.keys(ADAPTERS) as IntegrationKind[]).map((k) => integrationInfo(sample(k), ctx));
});

// ---- hub settings & preferences
app.get('/api/hub', async () => hub);
app.put<{ Body: Partial<HubSettings> }>('/api/hub', async (req) => {
  const b = req.body ?? {};
  const next: HubSettings = {
    demoMode: b.demoMode ?? hub.demoMode,
    sessionTimeoutMin: Math.min(24 * 60, Math.max(5, Number(b.sessionTimeoutMin ?? hub.sessionTimeoutMin))),
    captureDetails: b.captureDetails ?? hub.captureDetails,
    promptPreviews: b.promptPreviews ?? hub.promptPreviews,
    providerChecks: b.providerChecks ?? hub.providerChecks,
    retentionDays: Math.min(365, Math.max(1, Number(b.retentionDays ?? hub.retentionDays))),
  };
  const demoChanged = next.demoMode !== hub.demoMode;
  hub = next;
  store.setKv('hub', hub);
  if (demoChanged) {
    if (hub.demoMode) demo.start();
    else {
      demo.stop();
      for (const a of agents) demoEngine.forget(a.id);
      store.purgeDemo();
    }
  }
  broadcast({ t: 'hub', hub, demo: hub.demoMode });
  broadcast({ t: 'snapshot', snapshot: snapshot() });
  return hub;
});

// ---- shop: browse, and redeem receipts signed by the shop server
app.get('/api/shop', async () => ({
  configured: !!(shop.config.serverUrl && shop.config.publicKey),
  serverUrl: shop.config.serverUrl,
  installId: shop.installId(),
  owned: shop.owned(),
  day: dealDay(),
  deals: dailyDeals(),
}));
app.post<{ Body: { receipt?: string } }>('/api/shop/redeem', async (req, reply) => {
  const r = shop.redeem(String(req.body?.receipt ?? ''));
  if (typeof r === 'string') return bad(reply, 400, r);
  return { ok: true, item: r.item, owned: shop.owned() };
});

app.get('/api/prefs', async () => prefs);
app.put<{ Body: Partial<Preferences> }>('/api/prefs', async (req) => {
  const next = { ...prefs, ...req.body, notifyOn: { ...prefs.notifyOn, ...req.body?.notifyOn } };
  if (next.island !== prefs.island && (!next.island || !ISLAND_IDS.includes(next.island) || !shop.owns(`island:${next.island}`))) next.island = prefs.island;
  prefs = next;
  store.setKv('prefs', prefs);
  return prefs;
});

// ---- secrets (names only ever leave the server)
app.get('/api/secrets', async () => secrets.list().map((s) => ({ ...s, usedBy: agents.filter((a) => a.secretRef === s.name).map((a) => a.id) })));
app.put<{ Params: { name: string }; Body: { value?: string } }>('/api/secrets/:name', async (req, reply) => {
  try {
    await secrets.set(req.params.name, String(req.body?.value ?? ''));
  } catch (e) {
    return bad(reply, 400, (e as Error).message);
  }
  return { ok: true };
});
app.delete<{ Params: { name: string } }>('/api/secrets/:name', async (req, reply) => {
  if (agents.some((a) => a.secretRef === req.params.name)) return bad(reply, 409, 'An agent still uses this secret.');
  secrets.remove(req.params.name);
  return { ok: true };
});

// ---- hook installer
app.get('/api/hooks', async () => ({ emitter: EMITTER, status: hooksStatus() }));
app.post<{ Body: { action?: 'install' | 'uninstall'; only?: string[] } }>('/api/hooks', async (req, reply) => {
  if (!isLoopback(req.ip)) return bad(reply, 403, 'Hooks can only be changed from the PC itself.');
  const only = req.body?.only;
  const claudeAgent = agents.find((a) => a.integration === 'claude-code')?.id ?? 'claude';
  const geminiAgent = agents.find((a) => a.integration === 'gemini-cli')?.id ?? 'gemini';
  try {
    const result = req.body?.action === 'uninstall' ? uninstallHooks({ only }) : installHooks({ claudeAgent, geminiAgent, only });
    return { ok: true, result, status: hooksStatus() };
  } catch (e) {
    return bad(reply, 500, (e as Error).message);
  }
});

// ---- ingest
function ingestAuth(req: FastifyRequest, agentId: string): boolean {
  if (isLoopback(req.ip)) return true;
  const h = String(req.headers.authorization ?? '');
  if (!h.startsWith('Bearer ')) return false;
  return store.findAgentByTokenHash(sha256(h.slice(7).trim())) === agentId;
}

app.post<{ Params: { id: string }; Body: { format?: string; payload?: Record<string, unknown> } }>('/api/ingest/:id', async (req, reply) => {
  if (!isLoopback(req.ip)) return bad(reply, 403, 'Hook ingest is local-only.');
  const a = agents.find((x) => x.id === req.params.id);
  if (!a) return bad(reply, 404, 'Unknown agent.');
  if (!a.enabled) return { ok: true, ignored: 'disabled' };
  const adapter = ADAPTERS[a.integration];
  if (!adapter.ingest) return bad(reply, 400, `Agent "${a.id}" uses ${adapter.label}, which doesn't accept hook events.`);
  const events = adapter.ingest(a, req.body?.payload ?? {}, ctx);
  for (const e of events) realEngine.apply(e);
  return { ok: true, accepted: events.length };
});

app.post<{ Params: { id: string }; Body: Record<string, unknown> | Record<string, unknown>[] }>('/api/v1/agents/:id/events', async (req, reply) => {
  const a = agents.find((x) => x.id === req.params.id);
  if (!a) return bad(reply, 404, 'Unknown agent.');
  if (!ingestAuth(req, a.id)) return bad(reply, 401, 'Invalid ingest token.');
  if (!a.enabled) return { ok: true, ignored: 'disabled' };
  const list = Array.isArray(req.body) ? req.body.slice(0, 100) : [req.body ?? {}];
  let n = 0;
  for (const p of list) for (const e of genericEvents(a, p, 'http push')) (realEngine.apply(e), n++);
  return { ok: true, accepted: n };
});

app.post<{ Params: { id: string }; Body: { state?: string; message?: string; sessionId?: string } }>('/api/v1/agents/:id/heartbeat', async (req, reply) => {
  const a = agents.find((x) => x.id === req.params.id);
  if (!a) return bad(reply, 404, 'Unknown agent.');
  if (!ingestAuth(req, a.id)) return bad(reply, 401, 'Invalid ingest token.');
  if (!a.enabled) return { ok: true, ignored: 'disabled' };
  for (const e of genericEvents(a, { ...req.body, type: 'agent.heartbeat', title: 'Heartbeat' }, 'heartbeat')) realEngine.apply(e);
  if (req.body?.message) realEngine.apply({ agentId: a.id, type: 'agent.status', title: 'Status', source: 'heartbeat', ephemeral: true, data: { message: req.body.message } });
  return { ok: true };
});

app.post<{ Body: { from?: string; to?: string; title?: string } }>('/api/v1/handoff', async (req, reply) => {
  const from = agents.find((x) => x.id === req.body?.from);
  const to = agents.find((x) => x.id === req.body?.to);
  if (!from || !to) return bad(reply, 400, 'Both "from" and "to" must be agent ids.');
  if (!ingestAuth(req, from.id)) return bad(reply, 401, 'Invalid ingest token for the "from" agent.');
  const title = String(req.body?.title ?? 'the next step').slice(0, 120);
  realEngine.apply({ agentId: from.id, type: 'handoff', title: `Handed "${title}" to ${to.name}`, source: 'orchestrator', data: { from: from.id, to: to.id, task: title } });
  return { ok: true };
});

// ---- MCP (Streamable HTTP, stateless JSON responses)
const MCP_TOOL = {
  name: 'village_report',
  description:
    'Report your current status to AI Village, the user\'s agent dashboard. Call when you start a task, are waiting for the user, finish, or hit an error.',
  inputSchema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['working', 'thinking', 'waiting', 'idle', 'completed', 'error'] },
      task: { type: 'string', description: 'Short task title' },
      activity: { type: 'string', description: 'What you are doing right now' },
    },
    required: ['status'],
  },
};

app.get('/mcp', async (_req, reply) => reply.code(405).header('allow', 'POST').send());
app.post<{ Querystring: { agent?: string }; Body: { jsonrpc?: string; id?: number | string; method?: string; params?: Record<string, unknown> } }>(
  '/mcp',
  async (req, reply) => {
    const a = agents.find((x) => x.id === req.query.agent);
    if (!a) return bad(reply, 404, 'Add ?agent=<id> to the MCP URL.');
    if (!ingestAuth(req, a.id)) return bad(reply, 401, 'Invalid ingest token.');
    const { id, method, params } = req.body ?? {};
    const ok = (result: unknown) => ({ jsonrpc: '2.0', id, result });
    if (id === undefined) return reply.code(202).send();
    switch (method) {
      case 'initialize':
        return ok({ protocolVersion: (params?.protocolVersion as string) ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'ai-village', version: VERSION } });
      case 'ping':
        return ok({});
      case 'tools/list':
        return ok({ tools: [MCP_TOOL] });
      case 'tools/call': {
        if (params?.name !== MCP_TOOL.name) return { jsonrpc: '2.0', id, error: { code: -32602, message: 'Unknown tool' } };
        const args = (params.arguments ?? {}) as { status?: string; task?: string; activity?: string };
        const status = String(args.status ?? '');
        const map: Record<string, [EventType, string]> = {
          working: ['tool.started', 'WORKING'],
          thinking: ['agent.thinking', 'THINKING'],
          waiting: ['agent.waiting', 'WAITING'],
          idle: ['agent.heartbeat', 'IDLE'],
          completed: ['task.completed', 'COMPLETED'],
          error: ['agent.error', 'ERROR'],
        };
        const m = map[status];
        if (!m) return { jsonrpc: '2.0', id, error: { code: -32602, message: 'Invalid status' } };
        if (a.enabled) {
          if (args.task && (status === 'working' || status === 'thinking') && !realEngine.live(a.id).currentTask)
            realEngine.apply({ agentId: a.id, sessionId: 'mcp', type: 'task.started', title: args.task.slice(0, 120), source: 'self-reported (mcp)' });
          realEngine.apply({
            agentId: a.id,
            sessionId: 'mcp',
            type: m[0],
            state: m[1] as never,
            title: (args.activity || args.task || status).slice(0, 160),
            source: 'self-reported (mcp)',
            data: { state: m[1] },
          });
        }
        return ok({ content: [{ type: 'text', text: `Status "${status}" recorded in AI Village.` }] });
      }
      default:
        return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } };
    }
  },
);

// ---- WebSocket
app.register(async (scope) => {
  scope.get('/ws', { websocket: true }, (socket, req) => {
    if (!auth.check(req)) {
      socket.close(4401, 'auth');
      return;
    }
    clients.add(socket);
    socket.send(JSON.stringify({ t: 'snapshot', snapshot: snapshot() } satisfies ServerMessage));
    socket.on('message', (raw) => {
      try {
        const m = JSON.parse(String(raw));
        if (m.t === 'ping') socket.send(JSON.stringify({ t: 'pong', ts: Date.now() } satisfies ServerMessage));
      } catch {
        /* ignore */
      }
    });
    socket.on('close', () => clients.delete(socket));
  });
});

// ---- static UI
if (existsSync(DIST)) {
  await app.register(fastifyStatic, {
    root: DIST,
    // wildcard (default) so a rebuilt UI is served without restarting the hub.
    maxAge: '1h',
    // index.html must never be cached, or a rebuilt UI keeps loading old asset names.
    setHeaders: (reply, path) => {
      if (path.endsWith('.html') || path.endsWith('.webmanifest')) reply.header('cache-control', 'no-cache');
    },
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return bad(reply, 404, 'Not found');
    return reply.header('cache-control', 'no-cache').sendFile('index.html');
  });
} else {
  app.get('/', async (_req, reply) =>
    reply.type('text/html').send('<p style="font-family:system-ui">The UI is not built yet. Run <code>npm run build</code>, or use <code>npm run dev</code>.</p>'),
  );
}

// ------------------------------------------------------------------ timers & boot

setInterval(() => {
  realEngine.sweep();
  if (hub.demoMode) demoEngine.sweep();
}, 4000);
setInterval(() => void refreshAllProviders(), 10 * 60_000);
setInterval(() => store.pruneOlderThan(Date.now() - hub.retentionDays * 86_400_000), 6 * 3600_000);

for (const a of agents) {
  const last = store.lastEventTs(a.id);
  if (last) realEngine.seedLastSeen(a.id, last);
  startConnector(a);
}
if (hub.demoMode) demo.start();
setTimeout(() => void refreshAllProviders(), 2000);

try {
  await app.listen({ port: PORT, host: HOST });
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw e;
  // Usually the hub is already running (autostart plus a manual start); say so instead of crashing.
  const running = await fetch(`http://127.0.0.1:${PORT}/api/health`)
    .then((r) => r.ok)
    .catch(() => false);
  console.log(running ? `\n  AI Village is already running: http://localhost:${PORT}\n` : `\n  Port ${PORT} is used by another program. Close it, or set AI_VILLAGE_PORT to another port.\n`);
  process.exit(running ? 0 : 1);
}

const lan = Object.values((await import('node:os')).networkInterfaces())
  .flat()
  .filter((i) => i && i.family === 'IPv4' && !i.internal && isPrivate(i.address))
  .map((i) => i!.address);
const proto = tls ? 'https' : 'http';
console.log(`\n  AI Village hub ${VERSION}`);
console.log(`  On this PC:   ${proto}://localhost:${PORT}`);
if (!['127.0.0.1', 'localhost', '::1'].includes(HOST)) for (const ip of lan) console.log(`  On your iPad: ${proto}://${ip}:${PORT}`);
if (!auth.configured) console.log('\n  First run: open the PC address above to create your password.');
console.log('');

const shutdown = () => {
  for (const id of [...connectors.keys()]) stopConnector(id);
  demo.stop();
  app.close().finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
