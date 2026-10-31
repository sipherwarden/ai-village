import { useEffect, useMemo, useState } from 'react';
import { Activity } from 'lucide-react';
import type { EventType, VillageEvent } from '../../../shared/types.ts';
import { api } from '../lib/api.ts';
import { NO_AGENTS, NO_LIVE, useStore } from '../lib/store.ts';
import { EventRow } from './EventRow.tsx';
import { Empty, Sheet } from './ui.tsx';
import { LaneChart } from './Timeline.tsx';

const GROUPS: Record<string, { label: string; types: EventType[] }> = {
  all: { label: 'All', types: [] },
  tasks: { label: 'Tasks', types: ['task.started', 'task.completed', 'task.failed', 'handoff'] },
  attention: { label: 'Needs you', types: ['agent.waiting', 'agent.error', 'task.failed', 'tool.failed'] },
  work: { label: 'Work', types: ['file.created', 'file.edited', 'code.started', 'code.completed', 'research.started', 'research.completed', 'tool.started', 'tool.completed'] },
  presence: { label: 'Presence', types: ['agent.connected', 'agent.disconnected', 'session.started', 'session.ended'] },
};
const PERIODS = { live: { label: 'Recent', ms: 0 }, hour: { label: '1 h', ms: 3600_000 }, day: { label: '24 h', ms: 86_400_000 }, week: { label: '7 d', ms: 7 * 86_400_000 } } as const;

export function ActivityFeed({ open, onClose, onAgent, focus }: { open: boolean; onClose: () => void; onAgent: (id: string) => void; focus?: string }) {
  const liveEvents = useStore((s) => s.events);
  const agents = useStore((s) => s.snapshot?.agents ?? NO_AGENTS);
  const demo = useStore((s) => s.snapshot?.demo ?? false);
  const [agent, setAgent] = useState('');
  const [group, setGroup] = useState('all');
  useEffect(() => {
    if (open) setGroup(focus ?? 'all');
  }, [open, focus]);
  const [period, setPeriod] = useState<keyof typeof PERIODS>('live');
  const [older, setOlder] = useState<VillageEvent[] | null>(null);
  const [loading, setLoading] = useState(false);

  const filtered = useMemo(() => {
    const types = GROUPS[group].types;
    const since = PERIODS[period].ms ? Date.now() - PERIODS[period].ms : 0;
    const src = older ?? liveEvents;
    return src.filter((e) => (!agent || e.agentId === agent) && (!types.length || types.includes(e.type)) && e.ts >= since);
  }, [liveEvents, older, agent, group, period]);

  const loadPeriod = async (p: keyof typeof PERIODS) => {
    setPeriod(p);
    if (!PERIODS[p].ms) return setOlder(null);
    setLoading(true);
    try {
      setOlder(await api.get<VillageEvent[]>(`/api/events?limit=500&since=${Date.now() - PERIODS[p].ms}`));
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    const last = filtered[filtered.length - 1];
    if (!last) return;
    setLoading(true);
    try {
      const more = await api.get<VillageEvent[]>(`/api/events?limit=200&before=${last.id}${agent ? `&agent=${agent}` : ''}`);
      setOlder([...(older ?? liveEvents), ...more]);
    } finally {
      setLoading(false);
    }
  };

  const byId = Object.fromEntries(agents.map((a) => [a.id, a]));

  return (
    <Sheet open={open} onClose={onClose} title={demo ? 'Activity (demo)' : 'Live activity'} icon={<Activity size={17} />}>
      <div className="sticky top-0 z-10 space-y-2 border-b border-line bg-panel px-4 py-3 backdrop-blur-xl">
        <div className="flex gap-2">
          <select className="field h-9 flex-1" value={agent} onChange={(e) => setAgent(e.target.value)} aria-label="Filter by agent">
            <option value="">All agents</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <select className="field h-9 w-[110px]" value={period} onChange={(e) => void loadPeriod(e.target.value as keyof typeof PERIODS)} aria-label="Time period">
            {Object.entries(PERIODS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(GROUPS).map(([k, g]) => (
            <button key={k} className="chip h-7" style={group === k ? { background: 'var(--accent)', color: 'white', borderColor: 'transparent' } : undefined} onClick={() => setGroup(k)}>
              {g.label}
            </button>
          ))}
        </div>
      </div>
      <div className="px-4 pt-3">
        <LaneChart />
      </div>
      {filtered.length === 0 ? (
        <Empty>
          {loading
            ? 'Loading…'
            : demo
              ? 'Demo events will appear here in a moment.'
              : 'No events match. Real events appear here as soon as an agent reports something. Nothing here is simulated.'}
        </Empty>
      ) : (
        <div className="divide-y divide-[var(--border)]">
          {filtered.map((e) => (
            <EventRow key={e.id} e={e} agent={byId[e.agentId]} onAgent={onAgent} />
          ))}
          <div className="p-4 text-center">
            <button className="btn" onClick={() => void loadMore()} disabled={loading}>
              {loading ? 'Loading…' : 'Load older events'}
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
