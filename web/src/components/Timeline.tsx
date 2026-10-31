import { useMemo } from 'react';
import { NO_AGENTS, useStore } from '../lib/store.ts';
import { useNow } from '../lib/hooks.ts';
import { EVENT_META } from './EventRow.tsx';

const WINDOW = 60 * 60_000;

/** The last hour of real events, one labeled lane per agent. Lives at the top of the activity panel. */
export function LaneChart() {
  const events = useStore((s) => s.events);
  const agents = useStore((s) => s.snapshot?.agents ?? NO_AGENTS);
  const now = useNow(10_000);
  const laneOf = useMemo(() => Object.fromEntries(agents.map((a, i) => [a.id, i])), [agents]);
  const recent = events.filter((e) => now - e.ts < WINDOW && laneOf[e.agentId] !== undefined);

  return (
    <div className="section !p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="label">Last hour</span>
        <span className="text-[12px] text-ink-3">{recent.length ? `${recent.length} events` : 'Quiet'}</span>
      </div>
      <div className="space-y-1.5">
        {agents.map((a) => {
          const mine = recent.filter((e) => e.agentId === a.id);
          return (
            <div key={a.id} className="flex items-center gap-2">
              <span className="w-[72px] flex-none truncate text-[12px] font-semibold text-ink-2">{a.name}</span>
              <div className="relative h-5 flex-1 rounded-full bg-glass">
                {[0.25, 0.5, 0.75].map((f) => (
                  <span key={f} className="absolute top-1 h-3 w-px bg-[var(--border)]" style={{ left: `${f * 100}%` }} />
                ))}
                {mine.map((e) => {
                  const big = ['task.completed', 'task.failed', 'agent.waiting', 'agent.error', 'handoff'].includes(e.type);
                  const bad = e.type === 'task.failed' || e.type === 'agent.error';
                  const size = big ? 10 : 6;
                  return (
                    <span
                      key={e.id}
                      title={`${EVENT_META[e.type]?.label ?? e.type}: ${e.title}`}
                      className="absolute top-1/2 rounded-full"
                      style={{
                        left: `calc(${(1 - (now - e.ts) / WINDOW) * 100}% - ${size / 2}px)`,
                        width: size,
                        height: size,
                        marginTop: -size / 2,
                        background: bad ? 'var(--st-error)' : a.color,
                        boxShadow: big ? `0 0 0 3px color-mix(in srgb, ${bad ? 'var(--st-error)' : a.color} 30%, transparent)` : undefined,
                      }}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between pl-[80px] text-[10.5px] text-ink-3">
        <span>60 min ago</span>
        <span>30</span>
        <span>now</span>
      </div>
    </div>
  );
}
