import { useCallback, useEffect, useState } from 'react';
import { ListChecks } from 'lucide-react';
import type { TaskSummary } from '../../../shared/types.ts';
import { api } from '../lib/api.ts';
import { NO_AGENTS, store, useStore } from '../lib/store.ts';
import { useNow } from '../lib/hooks.ts';
import { AgentAvatar } from './Avatar.tsx';
import { TaskLine } from './ProfilePanel.tsx';
import { Empty, Sheet } from './ui.tsx';

/** Every agent's tasks in one place: what is running now, then what finished recently. */
export function TasksView({ open, onClose, onAgent }: { open: boolean; onClose: () => void; onAgent: (id: string) => void }) {
  const agents = useStore((s) => s.snapshot?.agents ?? NO_AGENTS);
  const demo = useStore((s) => s.snapshot?.demo ?? false);
  const now = useNow(5000);
  const [tasks, setTasks] = useState<TaskSummary[] | null>(null);

  const load = useCallback(async () => {
    try {
      setTasks((await api.get<{ tasks: TaskSummary[] }>('/api/tasks?limit=80')).tasks);
    } catch {
      setTasks([]);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void load();
    let timer: number | undefined;
    const off = store.onEvent((e) => {
      if (!e.type.startsWith('task.')) return;
      clearTimeout(timer);
      timer = window.setTimeout(load, 800);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [open, load, demo]);

  const byId = Object.fromEntries(agents.map((a) => [a.id, a]));
  const running = tasks?.filter((t) => t.status === 'running') ?? [];
  const recent = tasks?.filter((t) => t.status !== 'running') ?? [];
  const who = (t: TaskSummary) =>
    byId[t.agentId] ? (
      <button className="flex-none" onClick={() => onAgent(t.agentId)} aria-label={`Open ${byId[t.agentId].name}`}>
        <AgentAvatar agent={byId[t.agentId]} size={22} />
      </button>
    ) : null;

  return (
    <Sheet open={open} onClose={onClose} title="Tasks" icon={<ListChecks size={17} />}>
      <div className="space-y-3 p-4">
        {demo && <div className="rounded-xl bg-[var(--st-waiting)]/15 px-3 py-2 text-[12.5px] text-[var(--st-waiting)]">Simulation Lab is on. These tasks are simulated.</div>}
        <div className="section">
          <div className="label mb-1">Running now</div>
          {tasks === null ? <Empty>Loading…</Empty> : running.length ? running.map((t) => <TaskLine key={t.id} t={t} now={now} who={who(t)} />) : <Empty>No task is running.</Empty>}
        </div>
        <div className="section">
          <div className="label mb-1">Recent</div>
          {tasks === null ? <Empty>Loading…</Empty> : recent.length ? recent.map((t) => <TaskLine key={t.id} t={t} now={now} who={who(t)} />) : <Empty>No finished tasks yet. Tasks appear when an integration reports them.</Empty>}
        </div>
      </div>
    </Sheet>
  );
}
