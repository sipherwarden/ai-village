// HUD around the village, after the interface spec in the visual package: a smoked-glass telemetry
// bar along the top, a floating icon rail on the left, a slim live ticker along the bottom and, on
// phones, a tab bar with a deck of agent status cards. Everything hugs the perimeter so the village
// keeps the screen. Every number shown is measured or counted from real events.

import { Activity, Bell, ChevronRight, Expand, FlaskConical, ListChecks, Map as MapIcon, Radio, Settings, ShoppingBag, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import type { AgentLive } from '../../../shared/types.ts';
import { api } from '../lib/api.ts';
import { NO_AGENTS, NO_LIVE, useStore } from '../lib/store.ts';
import { useNow } from '../lib/hooks.ts';
import { STATE_LABEL, ago } from '../lib/format.ts';
import { AgentAvatar } from './Avatar.tsx';
import { EVENT_META } from './EventRow.tsx';

export type Section = 'village' | 'feed' | 'tasks' | 'agents' | 'shop' | 'settings';

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden className="flex-none">
      <rect width="48" height="48" rx="13" fill="#0e1424" />
      <path d="M8 31l16-9 16 9-16 9Z" fill="#334155" />
      <path d="M8 31v3l16 9v-3Z" fill="#1e293b" />
      <path d="M40 31v3l-16 9v-3Z" fill="#273449" />
      <path d="M22.5 14h3l1.2 14h-5.4Z" fill="#e2e8f0" />
      <circle cx="24" cy="19" r="1.8" fill="#fde68a" />
      <circle cx="15" cy="29" r="2.4" fill="#38bdf8" />
      <circle cx="33" cy="29" r="2.4" fill="#10b981" />
      <circle cx="24" cy="35" r="2.4" fill="#f59e0b" />
      <circle cx="24" cy="25.5" r="2.2" fill="#a855f7" />
    </svg>
  );
}

export function attention(live: Record<string, AgentLive> | undefined) {
  const list = live ? Object.values(live).filter((l) => l.state === 'WAITING' || l.state === 'ERROR') : [];
  return { count: list.length, error: list.some((l) => l.state === 'ERROR') };
}

/** Live Telemetry or Simulation Lab, switchable in one click; simulated data is always badged. */
function ModeSwitch({ compact }: { compact: boolean }) {
  const demo = useStore((s) => s.snapshot?.demo ?? false);
  const toggle = () => void api.put('/api/hub', { demoMode: !demo }).catch(() => undefined);
  return (
    <button
      className={`mode-pill ${demo ? 'sim' : 'live'}`}
      onClick={toggle}
      aria-pressed={demo}
      title={demo ? 'Simulation Lab is on: everything shown is simulated. Click to return to live telemetry.' : 'Showing live telemetry only. Click to open the Simulation Lab.'}
    >
      {demo ? <FlaskConical size={13} /> : <Radio size={13} />}
      {compact ? (demo ? 'Sim' : 'Live') : demo ? 'Simulation Lab' : 'Live telemetry'}
    </button>
  );
}

export function TopBar({ compact, onKiosk }: { compact: boolean; onKiosk: () => void }) {
  const stats = useStore((s) => s.snapshot?.stats);
  const live = useStore((s) => s.snapshot?.live ?? NO_LIVE);
  const socket = useStore((s) => s.socket);
  const latency = useStore((s) => s.latency);
  const now = useNow(15_000);
  const states = Object.values(live).map((l) => l.state);
  const thinking = states.filter((s) => s === 'THINKING').length;
  const working = states.filter((s) => s === 'WORKING').length;
  const link = socket === 'open' ? (latency != null ? `${latency} ms` : '—') : socket === 'connecting' ? 'joining' : 'offline';
  return (
    <header className="hud-top smoke safe-top" aria-label="Telemetry">
      <div className="flex min-w-0 items-center gap-2.5">
        <Logo size={compact ? 28 : 30} />
        {!compact && (
          <div className="leading-tight">
            <div className="text-[14px] font-semibold tracking-tight">AI Village</div>
            <div className="text-[11px] text-ink-3">Agent command center</div>
          </div>
        )}
      </div>
      <ModeSwitch compact={compact} />
      {stats && (
        <dl className="telemetry" aria-live="off">
          <Metric label="Online" value={`${stats.online}/${stats.total}`} tone="var(--st-idle)" />
          <Metric label="Working" value={working} tone="var(--st-working)" />
          {!compact && <Metric label="Thinking" value={thinking} tone="var(--st-thinking)" />}
          <Metric label="Waiting" value={stats.waiting} tone={stats.waiting ? 'var(--st-waiting)' : undefined} wide />
          {!compact && <Metric label="Tasks" value={stats.activeTasks} />}
          {!compact && <Metric label="Handoffs today" value={stats.handoffsToday ?? 0} />}
          {!compact && <Metric label="Link" value={link} tone={socket === 'open' ? undefined : 'var(--st-error)'} />}
        </dl>
      )}
      <div className="ml-auto flex flex-none items-center gap-1">
        {!compact && <time className="mono px-2 text-[13px] text-ink-2">{new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>}
        <button className="icon-btn" onClick={onKiosk} aria-label="Kiosk mode" title="Kiosk mode (always-on display)">
          <Expand size={17} />
        </button>
      </div>
    </header>
  );
}

function Metric({ label, value, tone, wide }: { label: string; value: number | string; tone?: string; wide?: boolean }) {
  return (
    <div className={`metric ${wide ? 'not-phone' : ''}`}>
      <dt>
        {tone && <span className="metric-dot" style={{ background: tone }} />}
        {label}
      </dt>
      <dd className="mono">{value}</dd>
    </div>
  );
}

export function IconRail({ section, onSection, onKiosk }: { section: Section; onSection: (s: Section, focus?: string) => void; onKiosk: () => void }) {
  const live = useStore((s) => s.snapshot?.live);
  const att = attention(live);
  return (
    <nav className="hud-rail smoke" aria-label="Primary">
      <RailButton icon={<MapIcon size={19} />} label="Village" current={section === 'village'} onClick={() => onSection('village')} />
      <RailButton icon={<Bell size={19} />} label="Needs you" badge={att.count || undefined} tone={att.error ? 'var(--st-error)' : 'var(--st-waiting)'} onClick={() => onSection('feed', 'attention')} />
      <RailButton icon={<Activity size={19} />} label="Activity" current={section === 'feed'} onClick={() => onSection('feed')} />
      <RailButton icon={<ListChecks size={19} />} label="Tasks" current={section === 'tasks'} onClick={() => onSection('tasks')} />
      <RailButton icon={<Users size={19} />} label="Agents" current={section === 'agents'} onClick={() => onSection('agents')} />
      <RailButton icon={<ShoppingBag size={19} />} label="Shop" current={section === 'shop'} onClick={() => onSection('shop')} />
      <RailButton icon={<Settings size={19} />} label="Settings" current={section === 'settings'} onClick={() => onSection('settings')} />
      <span className="mx-auto my-1 h-px w-6 bg-[var(--smoke-edge)]" />
      <RailButton icon={<Expand size={18} />} label="Kiosk mode" onClick={onKiosk} />
    </nav>
  );
}

function RailButton({ icon, label, current, onClick, badge, tone }: { icon: ReactNode; label: string; current?: boolean; onClick: () => void; badge?: number; tone?: string }) {
  return (
    <button className="rail-btn" aria-current={current ? 'page' : undefined} onClick={onClick} aria-label={badge ? `${label}, ${badge}` : label} data-tip={label}>
      {icon}
      {badge !== undefined && (
        <span className="rail-badge mono" style={{ background: tone }}>
          {badge}
        </span>
      )}
    </button>
  );
}

/** Latest real event plus the last hour as a single track. Opens the full timeline. */
export function Ticker({ onOpen, onAgent, style }: { onOpen: () => void; onAgent: (id: string) => void; style?: React.CSSProperties }) {
  const events = useStore((s) => s.events);
  const agents = useStore((s) => s.snapshot?.agents ?? NO_AGENTS);
  const now = useNow(10_000);
  const byId = Object.fromEntries(agents.map((a) => [a.id, a]));
  const latest = events.find((e) => byId[e.agentId]);
  const hour = events.filter((e) => now - e.ts < 3_600_000 && byId[e.agentId]);
  const a = latest ? byId[latest.agentId] : null;
  const meta = latest ? EVENT_META[latest.type] : null;
  return (
    <section aria-label="Live activity" className="hud-ticker smoke" style={style}>
      <div className="min-w-0 flex-1" aria-live="polite">
        {latest && a ? (
          <button className="flex w-full min-w-0 items-center gap-2.5 text-left" onClick={() => onAgent(a.id)}>
            <AgentAvatar agent={a} size={30} />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2 text-[11px] text-ink-3">
                <span className="font-semibold text-ink-2">{a.name}</span>
                <span className="truncate">{meta?.label ?? latest.type}</span>
                <span className="mono ml-auto flex-none">{ago(latest.ts, now)}</span>
              </span>
              <span className="block truncate text-[13px] font-medium text-ink">{latest.title}</span>
            </span>
          </button>
        ) : (
          <span className="text-[13px] text-ink-3">No activity yet. Real events appear here the moment an agent reports them.</span>
        )}
      </div>
      <div className="hidden w-[min(30%,300px)] flex-none flex-col gap-1 lg:flex" aria-hidden>
        <div className="relative h-4 rounded-[5px] bg-[var(--smoke-edge)]">
          {hour.map((e) => {
            const bad = e.type === 'task.failed' || e.type === 'agent.error';
            const big = bad || e.type === 'task.completed' || e.type === 'agent.waiting' || e.type === 'handoff';
            return (
              <span
                key={e.id}
                className="absolute top-1/2 -translate-y-1/2 rounded-full"
                style={{ left: `${(1 - (now - e.ts) / 3_600_000) * 100}%`, width: big ? 6 : 3, height: big ? 6 : 3, background: bad ? 'var(--st-error)' : byId[e.agentId].color }}
              />
            );
          })}
        </div>
        <div className="mono flex justify-between text-[10px] text-ink-3">
          <span>-60m</span>
          <span>{hour.length} events</span>
          <span>now</span>
        </div>
      </div>
      <button className="btn h-8 flex-none px-3 text-[12.5px]" onClick={onOpen}>
        Timeline <ChevronRight size={14} />
      </button>
    </section>
  );
}

/** Bottom tabs on phones and portrait tablets, where the rail would crowd the village. */
export function TabBar({ section, onSection }: { section: Section; onSection: (s: Section, focus?: string) => void }) {
  const live = useStore((s) => s.snapshot?.live);
  const att = attention(live);
  const tabs: { id: Section; label: string; icon: ReactNode }[] = [
    { id: 'village', label: 'Village', icon: <MapIcon size={19} /> },
    { id: 'feed', label: 'Activity', icon: <Activity size={19} /> },
    { id: 'tasks', label: 'Tasks', icon: <ListChecks size={19} /> },
    { id: 'agents', label: 'Agents', icon: <Users size={19} /> },
    { id: 'shop', label: 'Shop', icon: <ShoppingBag size={19} /> },
    { id: 'settings', label: 'Settings', icon: <Settings size={19} /> },
  ];
  return (
    <nav aria-label="Primary" className="hud-tabs smoke">
      {tabs.map((t) => (
        <button key={t.id} className="tab-btn" aria-current={section === t.id ? 'page' : undefined} onClick={() => onSection(t.id)}>
          {t.icon}
          {t.label}
          {t.id === 'feed' && att.count > 0 && <span className="tab-dot" style={{ background: att.error ? 'var(--st-error)' : 'var(--st-waiting)' }} />}
        </button>
      ))}
    </nav>
  );
}

/** Phone status deck: one card per agent, swipeable, above the tab bar. */
export function AgentDeck({ selectedId, onAgent }: { selectedId: string | null; onAgent: (id: string) => void }) {
  const agents = useStore((s) => s.snapshot?.agents ?? NO_AGENTS);
  const live = useStore((s) => s.snapshot?.live ?? NO_LIVE);
  return (
    <div className="agent-deck" role="list" aria-label="Agents">
      {agents.map((a) => {
        const st = a.enabled ? (live[a.id]?.state ?? 'UNKNOWN') : 'OFFLINE';
        const sub = live[a.id]?.activity ?? live[a.id]?.currentTask?.title ?? (a.enabled ? STATE_LABEL[st] : 'Paused');
        return (
          <button key={a.id} role="listitem" className={`deck-card smoke st-${st}`} aria-pressed={selectedId === a.id} onClick={() => onAgent(a.id)} aria-label={`${a.name}, ${a.enabled ? STATE_LABEL[st] : 'Paused'}`}>
            <AgentAvatar agent={a} size={34} state={st} />
            <span className="min-w-0 flex-1 text-left">
              <span className="flex items-center gap-1.5">
                <span className="state-dot" />
                <span className="truncate text-[13px] font-semibold">{a.name}</span>
              </span>
              <span className="block truncate text-[11.5px] text-ink-3">{sub}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
