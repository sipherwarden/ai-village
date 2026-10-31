import { useCallback, useEffect, useRef, useState } from 'react';
import { FlaskConical, KeyRound, Palette, Plug, RefreshCw, Stethoscope, Trash2 } from 'lucide-react';
import type { AgentConfig, AgentLive, IntegrationInfo, TaskSummary, VillageEvent } from '../../../shared/types.ts';
import { api } from '../lib/api.ts';
import { store, useStore } from '../lib/store.ts';
import { useNow } from '../lib/hooks.ts';
import { CONNECTION_LABEL, ago, clock, compact, duration, providerName } from '../lib/format.ts';
import { LivePortrait } from './Avatar.tsx';
import { EMOTES } from '../../../shared/cosmetics.ts';
import { isOwned, useShop } from '../lib/shop.ts';
import { EMOTE_ICON } from './ShopView.tsx';
import { Lock } from 'lucide-react';
import { EventRow } from './EventRow.tsx';
import { Empty, Markdown, Row, Sheet, StatePill, Toggle } from './ui.tsx';

interface TaskStats {
  completed: number;
  failed: number;
  running: number;
  avgMs: number | null;
  maxMs: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  tokensCached: number | null;
}
interface Details {
  agent: AgentConfig;
  live: AgentLive;
  integration: IntegrationInfo;
  tasks: TaskSummary[];
  today: TaskStats;
  week: TaskStats;
  activeTodayMs: number;
  activeWeekMs: number;
  errors: VillageEvent[];
  timeline: VillageEvent[];
}

type Tab = 'overview' | 'activity' | 'tasks' | 'config';
const TABS: Tab[] = ['overview', 'activity', 'tasks', 'config'];
const LEVEL = { live: ['Live', 'var(--st-online)'], partial: ['Partial', 'var(--st-waiting)'], none: ['Not available', 'var(--st-offline)'] } as const;

/** The agent inspector: live portrait, then OVERVIEW / ACTIVITY / TASKS / CONFIG. */
export function ProfilePanel({ agentId, onClose, onCustomize, onShop }: { agentId: string | null; onClose: () => void; onCustomize: (a: AgentConfig) => void; onShop: () => void }) {
  const shop = useShop();
  const agent = useStore((s) => s.snapshot?.agents.find((a) => a.id === agentId));
  const live = useStore((s) => (agentId ? s.snapshot?.live[agentId] : undefined));
  const demo = useStore((s) => s.snapshot?.demo ?? false);
  const now = useNow();
  const [d, setD] = useState<Details | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const lastLoad = useRef(0);

  const load = useCallback(async () => {
    if (!agentId) return;
    lastLoad.current = Date.now();
    try {
      setD(await api.get<Details>(`/api/agents/${agentId}`));
    } catch {
      /* panel shows live data only */
    }
  }, [agentId]);

  useEffect(() => {
    setD(null);
    setNotice(null);
    setToken(null);
    setTab('overview');
    void load();
  }, [agentId, load]);

  useEffect(() => {
    if (!agentId) return;
    let timer: number | undefined;
    const off = store.onEvent((e) => {
      if (e.agentId !== agentId) return;
      clearTimeout(timer);
      timer = window.setTimeout(load, Math.max(0, 2500 - (Date.now() - lastLoad.current)));
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [agentId, load]);

  if (!agentId) return <Sheet open={false} onClose={onClose} title="">{null}</Sheet>;

  const act = async (fn: () => Promise<string | void>) => {
    setNotice(null);
    try {
      const msg = await fn();
      if (msg) setNotice(msg);
    } catch (e) {
      setNotice((e as Error).message);
    }
  };

  const l = live ?? d?.live;
  const info = d?.integration;
  const tokensCap = info?.capabilities.find((c) => c.key === 'tokens');
  const state = agent && l ? (agent.enabled ? l.state : 'OFFLINE') : 'UNKNOWN';

  return (
    <Sheet
      open={!!agentId && !!agent}
      onClose={onClose}
      title={agent?.name ?? ''}
      actions={
        agent && (
          <button className="icon-btn" onClick={() => onCustomize(agent)} aria-label="Customize">
            <Palette size={18} />
          </button>
        )
      }
    >
      {agent && l && (
        <div className="space-y-3 p-4">
          <div className="relative">
            <LivePortrait agent={agent} state={state} height={210} />
            <div className="absolute inset-x-3 bottom-3 flex items-end gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[22px] font-semibold leading-tight tracking-tight text-white drop-shadow">{agent.name}</div>
                <div className="truncate text-[12.5px] text-white/70">
                  {providerName(agent.provider)} · {info?.label ?? agent.integration}
                </div>
              </div>
              <div className="flex flex-none flex-col items-end gap-1">
                <StatePill state={state} big />
                <span className="mono text-[11.5px] text-white/65">for {duration(now - l.stateSince)}</span>
              </div>
            </div>
          </div>
          {l.statusMessage && <div className="px-1 text-[12.5px] text-ink-2">“{l.statusMessage}”</div>}
          {demo && (
            <div className="flex items-center gap-2 rounded-xl bg-[var(--st-waiting)]/15 px-3 py-2 text-[12.5px] text-[var(--st-waiting)]">
              <FlaskConical size={14} /> Simulation Lab is on. Everything shown here is simulated.
            </div>
          )}

          <div className="tabs" role="tablist" aria-label="Inspector">
            {TABS.map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className="tab" onClick={() => setTab(t)}>
                {t}
              </button>
            ))}
          </div>

          {tab === 'overview' && (
            <>
              <p className="px-1 text-[13.5px] leading-relaxed text-ink-2">{agent.personality}</p>
              <div className="section">
                <div className="label mb-2">Emotes</div>
                <div className="emote-row">
                  {EMOTES.map((e) => {
                    const owned = isOwned(shop, e.id);
                    return (
                      <button
                        key={e.id}
                        className="emote-btn"
                        data-locked={!owned || undefined}
                        title={owned ? `Play ${e.name}` : `${e.name} is in the shop`}
                        onClick={() => (owned ? window.dispatchEvent(new CustomEvent('av:emote', { detail: { id: agent.id, kind: e.value } })) : onShop())}
                      >
                        {owned ? EMOTE_ICON[e.value as keyof typeof EMOTE_ICON] : <Lock />}
                        {e.name}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-[11.5px] text-ink-3">Just for fun: emotes play in the village and never change the agent's reported state.</p>
              </div>
              <div className="section">
                <div className="label mb-1">Right now</div>
                <Row label="Current task">{l.currentTask?.title ?? <span className="text-ink-3">None</span>}</Row>
                {l.currentTask && <Row label="Started">{clock(l.currentTask.startedAt)} · {duration(now - l.currentTask.startedAt)}</Row>}
                <Row label="Activity">{l.activity ?? <span className="text-ink-3">—</span>}</Row>
                {l.sessions.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {l.sessions.map((s) => (
                      <div key={s.sessionId} className="flex items-center gap-2 rounded-[10px] bg-glass-2 px-2.5 py-1.5 text-[12.5px]">
                        <StatePill state={s.state} />
                        <span className="truncate font-medium">{s.label}</span>
                        <span className="mono ml-auto flex-none text-ink-3">{ago(s.lastEventAt, now)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {d && (
                <div className="grid grid-cols-3 gap-2">
                  <Tile value={String(d.today.completed)} label="done today" sub={d.today.failed ? `${d.today.failed} failed` : undefined} />
                  <Tile value={duration(d.activeTodayMs)} label="active today" />
                  <Tile value={duration(d.week.avgMs)} label="avg task (7d)" />
                </div>
              )}
              <div className="section">
                <div className="label mb-1">Connection</div>
                <Row label="Runtime">{CONNECTION_LABEL[l.connection]}</Row>
                <p className="pb-1 text-[12.5px] text-ink-3">{l.connectionDetail}</p>
                <Row label="Last event">{l.lastEventAt ? `${ago(l.lastEventAt, now)} · ${clock(l.lastEventAt)}` : 'never'}</Row>
                <Row label="Last heartbeat" muted={!l.lastHeartbeatAt}>
                  {l.lastHeartbeatAt ? ago(l.lastHeartbeatAt, now) : agent.integration === 'http-push' ? 'none yet' : 'Not provided by this integration'}
                </Row>
                <Row label="Provider service">
                  <span style={{ color: l.provider.status === 'operational' ? 'var(--st-online)' : l.provider.status === 'outage' ? 'var(--st-error)' : l.provider.status === 'degraded' ? 'var(--st-waiting)' : undefined }}>
                    {l.provider.status.replace('-', ' ')}
                  </span>
                </Row>
                <p className="text-[12px] text-ink-3">
                  {l.provider.detail}
                  {l.provider.checkedAt ? ` Checked ${ago(l.provider.checkedAt, now)}${l.provider.source ? ` via ${l.provider.source}` : ''}.` : ''} Provider status is separate from agent activity.
                </p>
              </div>
            </>
          )}

          {tab === 'activity' && (
            <>
              {d && d.errors.length > 0 && (
                <div className="section !px-0">
                  <div className="label mb-1 px-4">Recent errors</div>
                  {d.errors.slice(0, 5).map((e) => (
                    <EventRow key={e.id} e={e} showAgent={false} />
                  ))}
                </div>
              )}
              <div className="section !px-0">
                <div className="label mb-1 px-4">Received events</div>
                {d?.timeline.length ? d.timeline.map((e) => <EventRow key={e.id} e={e} showAgent={false} />) : <Empty>{d ? 'No events received yet.' : 'Loading…'}</Empty>}
              </div>
            </>
          )}

          {tab === 'tasks' && (
            <>
              <div className="section">
                <div className="label mb-1">Tasks</div>
                {!d ? (
                  <Empty>Loading…</Empty>
                ) : d.tasks.length === 0 ? (
                  <Empty>No tasks recorded yet.</Empty>
                ) : (
                  d.tasks.map((t) => <TaskLine key={t.id} t={t} now={now} />)
                )}
              </div>
              <div className="section">
                <div className="label mb-1">Last 7 days</div>
                {d ? (
                  <>
                    <Row label="Completed">{d.week.completed}</Row>
                    <Row label="Failed">{d.week.failed}</Row>
                    <Row label="Longest task">{duration(d.week.maxMs)}</Row>
                    <Row label="Active time">{duration(d.activeWeekMs)}</Row>
                    <Row label="Tokens in" muted={d.week.tokensIn == null}>
                      {d.week.tokensIn != null ? `${compact(d.week.tokensIn)} new` : tokensCap?.level === 'none' ? 'Not provided by this integration' : 'None reported yet'}
                    </Row>
                    {d.week.tokensIn != null && (
                      <>
                        <Row label="Read from cache" muted={d.week.tokensCached == null}>
                          {d.week.tokensCached != null ? compact(d.week.tokensCached) : 'Not reported'}
                        </Row>
                        <Row label="Tokens out">{compact(d.week.tokensOut)}</Row>
                      </>
                    )}
                    <Row label="API cost" muted>
                      Not reported
                    </Row>
                  </>
                ) : (
                  <Empty>Loading…</Empty>
                )}
              </div>
            </>
          )}

          {tab === 'config' && (
            <>
              {info && (
                <div className="section">
                  <div className="label mb-1">{info.label}</div>
                  <p className="text-[13px] text-ink-2">{info.summary}</p>
                  <div className="mt-3 space-y-1.5">
                    {info.capabilities.map((c) => (
                      <div key={c.key} className="flex items-start gap-2 text-[13px]">
                        <span className="mt-1 h-2 w-2 flex-none rounded-full" style={{ background: LEVEL[c.level][1] }} />
                        <span className="flex-1">
                          {c.label} <span className="text-ink-3">· {LEVEL[c.level][0]}</span>
                          {c.note && <span className="block text-[12px] text-ink-3">{c.note}</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="section">
                <div className="label mb-1">Configuration</div>
                <Row label="Agent id">
                  <code className="mono">{agent.id}</code>
                </Row>
                {Object.entries(agent.settings).map(([k, v]) => (
                  <Row key={k} label={k}>
                    {String(v)}
                  </Row>
                ))}
                <Row label="Stored secret" muted={!agent.secretRef}>
                  {agent.secretRef ? `${agent.secretRef} (encrypted)` : 'none'}
                </Row>
                <Row label="Remote ingest token">{agent.hasIngestToken ? 'issued' : 'none'}</Row>
              </div>
              <div className="section">
                <Toggle
                  checked={agent.enabled}
                  onChange={(v) => act(async () => void (await api.patch(`/api/agents/${agent.id}`, { enabled: v })))}
                  label="Monitoring enabled"
                  hint="When off, events from this agent are ignored and it sleeps in the village."
                />
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button className="btn" onClick={() => onCustomize(agent)}>
                    <Palette size={15} /> Customize
                  </button>
                  <button className="btn" onClick={() => act(async () => (await api.post<{ message: string }>(`/api/agents/${agent.id}/reconnect`)).message)}>
                    <RefreshCw size={15} /> Reconnect
                  </button>
                  <button
                    className="btn"
                    onClick={() =>
                      act(async () => {
                        const r = await api.post<{ runtime: { ok: boolean; message: string } | null; provider: { status: string; detail: string } }>(`/api/agents/${agent.id}/test`);
                        void load();
                        return `${r.runtime ? `${r.runtime.ok ? '✓' : '✕'} ${r.runtime.message} ` : ''}Provider: ${r.provider.detail}`;
                      })
                    }
                  >
                    <Stethoscope size={15} /> Test connection
                  </button>
                  <button
                    className="btn"
                    onClick={() =>
                      act(async () => {
                        if (agent.hasIngestToken && !confirm('Replace the existing ingest token? Agents using the old one will stop reporting.')) return;
                        const r = await api.post<{ token: string; note: string }>(`/api/agents/${agent.id}/token`);
                        setToken(r.token);
                        return r.note;
                      })
                    }
                  >
                    <KeyRound size={15} /> {agent.hasIngestToken ? 'New token' : 'Ingest token'}
                  </button>
                </div>
                {token && (
                  <div className="mt-2 rounded-[10px] border border-line bg-glass-2 p-2">
                    <div className="text-[11.5px] text-ink-3">Remote ingest token (shown once)</div>
                    <code className="mono block break-all text-[12px]">{token}</code>
                  </div>
                )}
                {notice && <p className="mt-2 text-[12.5px] text-ink-2">{notice}</p>}
                <button
                  className="btn btn-danger mt-3 w-full"
                  onClick={() =>
                    act(async () => {
                      if (!confirm(`Remove ${agent.name}? Its event history stays in the database.`)) return;
                      await api.del(`/api/agents/${agent.id}`);
                      onClose();
                    })
                  }
                >
                  <Trash2 size={15} /> Remove agent
                </button>
              </div>
              {info && (
                <div className="section">
                  <Markdown text={info.docs} />
                </div>
              )}
            </>
          )}

          <div className="flex items-center justify-center gap-1.5 pb-2 text-[11.5px] text-ink-3">
            <Plug size={12} /> Only real signals are shown. Missing data is labeled, never estimated.
          </div>
        </div>
      )}
    </Sheet>
  );
}

export function TaskLine({ t, now, who }: { t: TaskSummary; now: number; who?: React.ReactNode }) {
  const color = t.status === 'completed' ? 'var(--st-completed)' : t.status === 'failed' ? 'var(--st-error)' : t.status === 'running' ? 'var(--st-working)' : 'var(--st-offline)';
  const tokens = t.tokensIn != null || t.tokensOut != null ? `${compact(t.tokensIn)} in · ${compact(t.tokensOut)} out${t.tokensCached ? ` · ${compact(t.tokensCached)} cached` : ''}` : null;
  return (
    <div className="flex items-start gap-2.5 py-1.5 text-[13px]">
      <span className="mt-1.5 h-2 w-2 flex-none rounded-full" style={{ background: color }} />
      {who}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{t.title}</span>
        <span className="mono block text-[11px] text-ink-3">
          {clock(t.startedAt)}
          {tokens ? ` · ${tokens}` : ''}
        </span>
      </span>
      <span className="mono flex-none text-[11.5px] text-ink-3">{t.status === 'running' ? `running ${duration(now - t.startedAt)}` : t.status === 'abandoned' ? 'end unknown' : duration((t.endedAt ?? now) - t.startedAt)}</span>
    </div>
  );
}

function Tile({ value, label, sub }: { value: string; label: string; sub?: string }) {
  return (
    <div className="rounded-[14px] bg-glass-2 px-3 py-2.5">
      <div className="mono text-[18px] font-semibold leading-none">{value}</div>
      <div className="mt-1 text-[11px] text-ink-3">{label}</div>
      {sub && <div className="text-[11px] text-[var(--st-error)]">{sub}</div>}
    </div>
  );
}
