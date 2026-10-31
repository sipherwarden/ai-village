import { basename } from 'node:path';
import type {
  AgentConfig,
  AgentLive,
  AgentState,
  Connection,
  EventType,
  ProviderHealth,
  SessionInfo,
  Stats,
  VillageEvent,
} from '../shared/types.ts';
import type { Store } from './db.ts';

/** What adapters hand to the engine. Everything here must come from a real signal. */
export interface NormalizedEvent {
  agentId: string;
  sessionId?: string | null;
  type: EventType;
  ts?: number;
  title: string;
  detail?: string | null;
  source: string;
  /** Explicit state the signal implies for its session, if any. */
  state?: AgentState;
  /** Human label for the session (usually the project folder). */
  sessionLabel?: string | null;
  data?: Record<string, unknown> | null;
  tokens?: { in: number; out: number; cached?: number } | null;
  /** Skip persisting (used for high-frequency heartbeats). */
  ephemeral?: boolean;
}

interface Session {
  id: string;
  label: string;
  state: AgentState;
  stateSince: number;
  startedAt: number;
  lastEventAt: number;
  activity: string | null;
  taskId: number | null;
  taskTitle: string | null;
  taskStartedAt: number | null;
}

interface Runtime {
  lastEventAt: number | null;
  lastHeartbeatAt: number | null;
  /** Set by persistent adapters (SSE, WebSocket, polling). null = adapter does not track connectivity. */
  link: { up: boolean; detail: string; since: number } | null;
  heartbeatUp: boolean;
  sessions: Map<string, Session>;
  provider: ProviderHealth;
  statusMessage: string | null;
}

const PRIORITY: Record<AgentState, number> = {
  ERROR: 8,
  WAITING: 7,
  WORKING: 6,
  THINKING: 5,
  COMPLETED: 4,
  ONLINE: 3,
  IDLE: 2,
  UNKNOWN: 1,
  OFFLINE: 0,
};

/** Integrations whose agents only speak when something happens (no persistent link, no heartbeat). */
const EVENT_ONLY = new Set(['claude-code', 'gemini-cli', 'codex', 'mcp']);
const LINKED = new Set(['opencode', 'websocket', 'http-poll']);

export const COMPLETED_HOLD_MS = 12_000;
export const ONLINE_HOLD_MS = 30_000;

export interface EngineOptions {
  demo: boolean;
  store: Store;
  getAgents: () => AgentConfig[];
  getSessionTimeoutMs: () => number;
  onEvent: (e: VillageEvent) => void;
  onLive: (live: AgentLive) => void;
}

export class StateEngine {
  private rt = new Map<string, Runtime>();
  private opts: EngineOptions;
  lastEventAt: number | null = null;

  constructor(opts: EngineOptions) {
    this.opts = opts;
  }

  get demo() {
    return this.opts.demo;
  }

  private runtime(agentId: string): Runtime {
    let r = this.rt.get(agentId);
    if (!r) {
      r = {
        lastEventAt: null,
        lastHeartbeatAt: null,
        link: null,
        heartbeatUp: false,
        sessions: new Map(),
        provider: { status: 'not-checked', detail: 'Provider status has not been checked yet.', checkedAt: null, source: null },
        statusMessage: null,
      };
      this.rt.set(agentId, r);
    }
    return r;
  }

  private agent(agentId: string) {
    return this.opts.getAgents().find((a) => a.id === agentId);
  }

  /** After a hub restart: remember when we last heard from an agent so it reads "last seen", not "never seen". */
  seedLastSeen(agentId: string, ts: number) {
    const r = this.runtime(agentId);
    if (!r.lastEventAt) r.lastEventAt = ts;
  }

  forget(agentId: string) {
    this.rt.delete(agentId);
  }

  /** Called when an agent is disabled/reconnected: drop live sessions, keep history. */
  resetLive(agentId: string) {
    const r = this.runtime(agentId);
    const now = Date.now();
    for (const s of r.sessions.values()) this.closeSession(agentId, s, now, 'abandoned');
    r.sessions.clear();
    r.link = null;
    r.heartbeatUp = false;
    this.emitLive(agentId);
  }

  setProvider(agentId: string, health: ProviderHealth) {
    this.runtime(agentId).provider = health;
    this.emitLive(agentId);
  }

  /** Persistent adapters report their transport state here. */
  setLink(agentId: string, up: boolean, detail: string, source: string) {
    const r = this.runtime(agentId);
    const was = r.link?.up;
    r.link = { up, detail, since: was === up && r.link ? r.link.since : Date.now() };
    if (was !== up) {
      if (!up) {
        const now = Date.now();
        for (const s of r.sessions.values()) this.closeSession(agentId, s, now, 'abandoned');
        r.sessions.clear();
      }
      this.apply({
        agentId,
        type: up ? 'agent.connected' : 'agent.disconnected',
        title: up ? 'Connected' : 'Disconnected',
        detail,
        source,
      });
    } else this.emitLive(agentId);
  }

  apply(ev: NormalizedEvent): VillageEvent | null {
    const agent = this.agent(ev.agentId);
    if (!agent) return null;
    const ts = ev.ts ?? Date.now();
    const r = this.runtime(ev.agentId);
    r.lastEventAt = ts;
    this.lastEventAt = ts;

    if (ev.type === 'agent.heartbeat') {
      r.lastHeartbeatAt = ts;
      if (!r.heartbeatUp) {
        r.heartbeatUp = true;
        this.apply({ agentId: ev.agentId, type: 'agent.connected', title: 'Heartbeat received', source: ev.source, ts });
      }
    }
    if (ev.type === 'agent.status' && typeof ev.data?.message === 'string') {
      r.statusMessage = String(ev.data.message).slice(0, 120) || null;
    }

    const sessionless =
      ev.type === 'agent.connected' ||
      ev.type === 'agent.disconnected' ||
      ev.type === 'provider.status' ||
      ev.type === 'handoff' ||
      ev.type === 'agent.status' ||
      (ev.type === 'agent.heartbeat' && !ev.state && typeof ev.data?.state !== 'string');
    const sid = sessionless ? null : (ev.sessionId ?? 'default');
    if (sid) this.applyToSession(ev, r, sid, ts);

    let stored: VillageEvent | null = null;
    if (!ev.ephemeral) {
      stored = this.opts.store.insertEvent({
        ts,
        agentId: ev.agentId,
        sessionId: ev.sessionId ?? null,
        type: ev.type,
        title: ev.title.slice(0, 200),
        detail: ev.detail ? ev.detail.slice(0, 500) : null,
        source: ev.source,
        demo: this.opts.demo,
        data: ev.data ?? null,
      });
      this.opts.onEvent(stored);
    }
    this.emitLive(ev.agentId);
    return stored;
  }

  private applyToSession(ev: NormalizedEvent, r: Runtime, sid: string, ts: number) {
    const agentId = ev.agentId;
    if (ev.type === 'session.ended') {
      const s = r.sessions.get(sid);
      if (s) {
        this.closeSession(agentId, s, ts, 'abandoned');
        r.sessions.delete(sid);
      }
      return;
    }
    let s = r.sessions.get(sid);
    if (!s) {
      const label = ev.sessionLabel ? ev.sessionLabel : sid === 'default' ? 'main' : sid.slice(0, 8);
      s = {
        id: sid,
        label,
        state: 'ONLINE',
        stateSince: ts,
        startedAt: ts,
        lastEventAt: ts,
        activity: null,
        taskId: null,
        taskTitle: null,
        taskStartedAt: null,
      };
      r.sessions.set(sid, s);
      this.opts.store.logSessionStart(agentId, sid, ts, this.opts.demo);
    }
    if (ev.sessionLabel) s.label = ev.sessionLabel;
    s.lastEventAt = ts;

    switch (ev.type) {
      case 'task.started':
        if (s.taskId == null) {
          s.taskId = this.opts.store.startTask(agentId, sid, ev.title, ts, this.opts.demo);
          s.taskTitle = ev.title;
          s.taskStartedAt = ts;
        }
        s.activity = ev.detail ?? 'Working on a request';
        break;
      case 'task.completed':
      case 'task.failed':
        if (s.taskId != null) {
          if (s.taskStartedAt) ev.data = { ...ev.data, durationMs: ts - s.taskStartedAt, task: s.taskTitle };
          this.opts.store.endTask(s.taskId, ev.type === 'task.completed' ? 'completed' : 'failed', ts, ev.tokens?.in, ev.tokens?.out, ev.tokens?.cached);
        }
        s.taskId = null;
        s.taskTitle = null;
        s.taskStartedAt = null;
        s.activity = ev.type === 'task.completed' ? 'Finished' : ev.detail ?? 'Task failed';
        break;
      default:
        if (ev.state === 'WORKING' || ev.state === 'WAITING' || ev.state === 'ERROR') s.activity = ev.title;
    }

    let next: AgentState | undefined = ev.state;
    if (!next) {
      next = (
        {
          'session.started': 'ONLINE',
          'task.started': 'THINKING',
          'task.completed': 'COMPLETED',
          'task.failed': 'ERROR',
          'agent.thinking': 'THINKING',
          'agent.waiting': 'WAITING',
          'agent.error': 'ERROR',
          'tool.started': 'WORKING',
          'code.started': 'WORKING',
          'research.started': 'WORKING',
          'file.created': 'WORKING',
          'file.edited': 'WORKING',
        } as Partial<Record<EventType, AgentState>>
      )[ev.type];
    }
    if (!next && (ev.type === 'tool.completed' || ev.type === 'tool.failed' || ev.type === 'code.completed' || ev.type === 'research.completed')) {
      next = s.taskId != null ? 'THINKING' : s.state;
    }
    if (ev.type === 'agent.heartbeat' && typeof ev.data?.state === 'string') next = ev.data.state as AgentState;
    if (ev.type === 'agent.heartbeat' && !next && s.state === 'ONLINE') next = 'ONLINE';
    if (next && next !== s.state) {
      s.state = next;
      s.stateSince = ts;
    }
  }

  private closeSession(agentId: string, s: Session, ts: number, status: 'abandoned' | 'completed') {
    if (s.taskId != null) this.opts.store.endTask(s.taskId, status, ts);
    this.opts.store.logSessionEnd(agentId, s.id, ts);
  }

  /** Time-based decay. Runs every few seconds. */
  sweep(now = Date.now()) {
    const timeout = this.opts.getSessionTimeoutMs();
    for (const agent of this.opts.getAgents()) {
      const r = this.rt.get(agent.id);
      if (!r) continue;
      let changed = false;
      for (const s of [...r.sessions.values()]) {
        if (now - s.lastEventAt > timeout) {
          this.closeSession(agent.id, s, now, 'abandoned');
          r.sessions.delete(s.id);
          this.apply({
            agentId: agent.id,
            sessionId: null,
            type: 'session.ended',
            title: `Session ${s.label} went quiet`,
            detail: `No events for ${Math.round(timeout / 60000)} min; treating the session as ended.`,
            source: 'hub',
            ts: now,
          });
          changed = true;
          continue;
        }
        if (s.state === 'COMPLETED' && now - s.stateSince > COMPLETED_HOLD_MS) {
          s.state = 'IDLE';
          s.stateSince = now;
          changed = true;
        } else if (s.state === 'ONLINE' && now - s.stateSince > ONLINE_HOLD_MS) {
          s.state = 'IDLE';
          s.stateSince = now;
          changed = true;
        }
      }
      if (agent.integration === 'http-push' && r.heartbeatUp) {
        const interval = Number(agent.settings.heartbeatSec ?? 30) * 1000;
        if (r.lastHeartbeatAt && now - r.lastHeartbeatAt > interval * 2.5) {
          r.heartbeatUp = false;
          for (const s of r.sessions.values()) this.closeSession(agent.id, s, now, 'abandoned');
          r.sessions.clear();
          this.apply({
            agentId: agent.id,
            type: 'agent.disconnected',
            title: 'Heartbeat lost',
            detail: `No heartbeat for ${Math.round((now - r.lastHeartbeatAt) / 1000)}s (expected every ${interval / 1000}s).`,
            source: 'hub',
            ts: now,
          });
          continue;
        }
      }
      if (changed) this.emitLive(agent.id);
    }
  }

  live(agentId: string): AgentLive {
    const agent = this.agent(agentId);
    const r = this.runtime(agentId);
    const now = Date.now();
    const sessions: SessionInfo[] = [...r.sessions.values()]
      .sort((a, b) => PRIORITY[b.state] - PRIORITY[a.state] || b.lastEventAt - a.lastEventAt)
      .map((s) => ({
        sessionId: s.id,
        label: s.label,
        state: s.state,
        stateSince: s.stateSince,
        startedAt: s.startedAt,
        lastEventAt: s.lastEventAt,
        activity: s.activity,
        taskTitle: s.taskTitle,
        taskStartedAt: s.taskStartedAt,
      }));
    const top = sessions[0];

    let connection: Connection;
    let connectionDetail: string;
    let state: AgentState;
    let stateSince = top?.stateSince ?? r.link?.since ?? r.lastEventAt ?? now;
    // Demo events are session-based for every agent, so presence is judged the event-only way.
    const kind = this.opts.demo && agent?.integration !== 'provider-only' ? 'claude-code' : agent?.integration;

    if (!agent || !agent.enabled) {
      connection = 'disabled';
      connectionDetail = 'Monitoring is turned off for this agent.';
      state = 'OFFLINE';
    } else if (kind === 'provider-only') {
      connection = 'not-observable';
      connectionDetail = 'This integration can only check provider availability. It cannot see agent activity.';
      state = 'UNKNOWN';
    } else if (LINKED.has(kind!)) {
      if (!r.link) {
        connection = 'never-seen';
        connectionDetail = 'Not connected yet.';
        state = 'UNKNOWN';
      } else if (!r.link.up) {
        connection = 'disconnected';
        connectionDetail = r.link.detail;
        state = 'OFFLINE';
        stateSince = r.link.since;
      } else {
        connection = 'connected';
        connectionDetail = r.link.detail;
        state = top ? top.state : 'IDLE';
      }
    } else if (kind === 'http-push') {
      if (r.heartbeatUp || top) {
        connection = 'connected';
        connectionDetail = r.lastHeartbeatAt ? 'Receiving heartbeats.' : 'Receiving events (no heartbeat yet).';
        state = top ? top.state : 'IDLE';
      } else if (r.lastEventAt) {
        connection = 'disconnected';
        connectionDetail = 'Heartbeats stopped.';
        state = 'OFFLINE';
      } else {
        connection = 'never-seen';
        connectionDetail = 'No heartbeat or event received yet.';
        state = 'UNKNOWN';
      }
    } else {
      // Event-only integrations: presence is inferred from open sessions.
      if (top) {
        const quiet = now - top.lastEventAt > 5 * 60_000;
        connection = quiet ? 'quiet' : 'connected';
        connectionDetail = quiet
          ? 'Session open, but no events recently. Hooks only report when something happens.'
          : `${sessions.length} open session${sessions.length === 1 ? '' : 's'}.`;
        state = top.state;
      } else if (r.lastEventAt) {
        connection = 'disconnected';
        connectionDetail = 'No open sessions.';
        state = 'OFFLINE';
        stateSince = r.lastEventAt;
      } else {
        connection = 'never-seen';
        connectionDetail = 'No events received yet. Check that the hooks are installed.';
        state = 'UNKNOWN';
      }
    }

    return {
      agentId,
      state,
      stateSince,
      connection,
      connectionDetail,
      lastEventAt: r.lastEventAt,
      lastHeartbeatAt: r.lastHeartbeatAt,
      activity: top?.activity ?? null,
      currentTask: top?.taskTitle && top.taskStartedAt ? { title: top.taskTitle, startedAt: top.taskStartedAt } : null,
      sessions,
      provider: r.provider,
      statusMessage: r.statusMessage,
    };
  }

  allLive(): Record<string, AgentLive> {
    const out: Record<string, AgentLive> = {};
    for (const a of this.opts.getAgents()) out[a.id] = this.live(a.id);
    return out;
  }

  stats(): Stats {
    const agents = this.opts.getAgents();
    const live = agents.map((a) => this.live(a.id));
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const ts = this.opts.store.taskStats(null, this.opts.demo, midnight.getTime());
    let activeTasks = 0;
    for (const l of live) activeTasks += l.sessions.filter((s) => s.taskTitle).length;
    return {
      total: agents.length,
      online: live.filter((l) => !['OFFLINE', 'UNKNOWN'].includes(l.state)).length,
      working: live.filter((l) => l.state === 'WORKING' || l.state === 'THINKING').length,
      waiting: live.filter((l) => l.state === 'WAITING').length,
      offline: live.filter((l) => l.state === 'OFFLINE').length,
      activeTasks,
      completedToday: ts.completed,
      handoffsToday: this.opts.store.countEvents(this.opts.demo, ['handoff'], midnight.getTime()),
      errors24h: this.opts.store.countEvents(this.opts.demo, ['agent.error', 'task.failed'], Date.now() - 86_400_000),
      lastEventAt: this.lastEventAt,
    };
  }

  private emitLive(agentId: string) {
    if (!this.agent(agentId)) return;
    this.opts.onLive(this.live(agentId));
  }
}

export function labelFromCwd(cwd: unknown): string | null {
  if (typeof cwd !== 'string' || !cwd) return null;
  return basename(cwd.replace(/[\\/]+$/, '')) || cwd;
}
