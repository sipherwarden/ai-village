import {
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  Code2,
  FilePen,
  FilePlus2,
  Hourglass,
  Link2,
  Link2Off,
  LogIn,
  LogOut,
  Play,
  Search,
  Sparkles,
  Wrench,
  XCircle,
  Activity,
  type LucideIcon,
} from 'lucide-react';
import type { AgentConfig, EventType, VillageEvent } from '../../../shared/types.ts';
import { clock, compact, duration } from '../lib/format.ts';
import { AgentAvatar } from './Avatar.tsx';

export const EVENT_META: Partial<Record<EventType, { icon: LucideIcon; label: string; tone?: string }>> = {
  'agent.connected': { icon: Link2, label: 'Connected', tone: 'var(--st-online)' },
  'agent.disconnected': { icon: Link2Off, label: 'Disconnected', tone: 'var(--st-offline)' },
  'agent.error': { icon: AlertTriangle, label: 'Error', tone: 'var(--st-error)' },
  'agent.waiting': { icon: Hourglass, label: 'Waiting for input', tone: 'var(--st-waiting)' },
  'agent.thinking': { icon: Sparkles, label: 'Thinking', tone: 'var(--st-thinking)' },
  'agent.status': { icon: Activity, label: 'Status' },
  'session.started': { icon: LogIn, label: 'Session started', tone: 'var(--st-online)' },
  'session.ended': { icon: LogOut, label: 'Session ended', tone: 'var(--st-offline)' },
  'task.started': { icon: Play, label: 'Task started', tone: 'var(--st-thinking)' },
  'task.completed': { icon: CheckCircle2, label: 'Task completed', tone: 'var(--st-completed)' },
  'task.failed': { icon: XCircle, label: 'Task failed', tone: 'var(--st-error)' },
  'tool.started': { icon: Wrench, label: 'Tool started', tone: 'var(--st-working)' },
  'tool.completed': { icon: Wrench, label: 'Tool finished' },
  'tool.failed': { icon: XCircle, label: 'Tool failed', tone: 'var(--st-error)' },
  'file.created': { icon: FilePlus2, label: 'File created', tone: 'var(--st-working)' },
  'file.edited': { icon: FilePen, label: 'File edited', tone: 'var(--st-working)' },
  'research.started': { icon: Search, label: 'Research started', tone: 'var(--st-working)' },
  'research.completed': { icon: Search, label: 'Research completed', tone: 'var(--st-completed)' },
  'code.started': { icon: Code2, label: 'Code execution started', tone: 'var(--st-working)' },
  'code.completed': { icon: Code2, label: 'Code execution completed', tone: 'var(--st-completed)' },
  handoff: { icon: ArrowRightLeft, label: 'Handoff', tone: 'var(--accent)' },
};

export function EventRow({ e, agent, showAgent = true, onAgent }: { e: VillageEvent; agent?: AgentConfig; showAgent?: boolean; onAgent?: (id: string) => void }) {
  const meta = EVENT_META[e.type] ?? { icon: Activity, label: e.type };
  const Icon = meta.icon;
  const dur = typeof e.data?.durationMs === 'number' ? duration(e.data.durationMs) : null;
  const tokens = e.data?.tokens as { in: number; out: number; cached?: number } | undefined;
  const tokenText = tokens
    ? [`${compact(tokens.in)} in`, tokens.cached != null && `${compact(tokens.cached)} from cache`, `${compact(tokens.out)} out`].filter(Boolean).join(' / ') + ' tokens'
    : null;
  return (
    <div className="flex gap-3 px-4 py-2.5">
      <span className="mt-0.5 grid h-7 w-7 flex-none place-items-center rounded-[9px] bg-glass-2" style={{ color: meta.tone ?? 'var(--text-2)' }}>
        <Icon size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[12px] text-ink-3">
          {showAgent && agent && (
            <button className="inline-flex items-center gap-1 font-semibold text-ink-2 hover:text-ink" onClick={() => onAgent?.(agent.id)}>
              <AgentAvatar agent={agent} size={18} />
              {agent.name}
            </button>
          )}
          <span>{meta.label}</span>
          {e.demo && <span className="rounded bg-[var(--st-waiting)]/20 px-1 text-[10px] font-bold text-[var(--st-waiting)]">DEMO</span>}
          <span className="ml-auto flex-none tabular-nums">{clock(e.ts)}</span>
        </div>
        <div className="mt-0.5 break-words text-[13.5px] leading-snug">{e.title}</div>
        {(e.detail || dur || tokens) && (
          <div className="mt-0.5 text-[12px] text-ink-3">
            {[e.detail, dur && `took ${dur}`, tokenText].filter(Boolean).join(' · ')}
          </div>
        )}
        <div className="mt-0.5 text-[11px] text-ink-3/80">via {e.source}</div>
      </div>
    </div>
  );
}
