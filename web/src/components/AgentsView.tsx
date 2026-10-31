import { useEffect, useState } from 'react';
import { Plus, Users, Webhook } from 'lucide-react';
import type { AgentConfig } from '../../../shared/types.ts';
import { api } from '../lib/api.ts';
import { NO_AGENTS, NO_LIVE, useStore } from '../lib/store.ts';
import { CONNECTION_LABEL } from '../lib/format.ts';
import { Portrait as Character } from './Avatar.tsx';
import { Sheet, StatePill } from './ui.tsx';

interface HookStatus {
  emitter: string;
  status: Record<string, { file: string; exists: boolean; installed: string[]; complete: boolean; error?: string }>;
}

export function AgentsView({ open, onClose, onEdit, onOpenProfile }: { open: boolean; onClose: () => void; onEdit: (a: AgentConfig | null) => void; onOpenProfile: (id: string) => void }) {
  const agents = useStore((s) => s.snapshot?.agents ?? NO_AGENTS);
  const live = useStore((s) => s.snapshot?.live ?? NO_LIVE);
  const [hooks, setHooks] = useState<HookStatus | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const loadHooks = () => api.get<HookStatus>('/api/hooks').then(setHooks).catch(() => {});
  useEffect(() => {
    if (open) void loadHooks();
  }, [open]);

  const hookAction = async (action: 'install' | 'uninstall', only: string) => {
    setMsg(null);
    try {
      const r = await api.post<{ status: HookStatus['status'] }>('/api/hooks', { action, only: [only] });
      setHooks((h) => (h ? { ...h, status: r.status } : h));
      setMsg(action === 'install' ? `Installed. Your previous ${only} settings were backed up next to the file. Restart running ${only === 'claude' ? 'Claude Code' : 'Gemini CLI'} sessions to pick them up.` : 'Removed. A backup was saved first.');
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Agents" icon={<Users size={17} />} width={480} actions={<button className="btn btn-primary h-8" onClick={() => onEdit(null)}><Plus size={15} /> Add</button>}>
      <div className="space-y-2 p-4">
        {agents.map((a) => {
          const l = live[a.id];
          return (
            <div key={a.id} className="section flex items-center gap-3 !p-3">
              <button className={`state-${l?.state ?? 'UNKNOWN'} flex-none`} onClick={() => onOpenProfile(a.id)} aria-label={`Open ${a.name}`}>
                <Character color={a.color} appearance={a.appearance} voice={a.voice} state={l?.state ?? 'UNKNOWN'} size={58} />
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-semibold">{a.name}</span>
                  {l && <StatePill state={l.state} />}
                </div>
                <div className="truncate text-[12.5px] text-ink-3">
                  {a.integration} · {l ? CONNECTION_LABEL[l.connection] : '—'}
                </div>
              </div>
              <button className="btn h-8" onClick={() => onEdit(a)}>
                Edit
              </button>
            </div>
          );
        })}
        <button className="section flex w-full items-center justify-center gap-2 border-dashed !py-4 text-[14px] text-ink-2 hover:text-ink" onClick={() => onEdit(null)}>
          <Plus size={16} /> Add a custom agent
        </button>

        <div className="section mt-4">
          <div className="mb-2 flex items-center gap-2">
            <Webhook size={16} className="text-ink-2" />
            <span className="font-semibold">Agent hooks on this PC</span>
          </div>
          <p className="mb-3 text-[12.5px] text-ink-3">These hooks make Claude Code and Gemini CLI report real activity to the village. They can only be changed from the PC itself.</p>
          {hooks ? (
            Object.entries(hooks.status).map(([name, s]) => (
              <div key={name} className="flex items-center gap-3 border-t border-line py-2.5 first:border-t-0">
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-medium">{name === 'claude' ? 'Claude Code' : 'Gemini CLI'}</div>
                  <div className="truncate text-[12px] text-ink-3" title={s.file}>
                    {s.error ?? (s.complete ? 'Installed' : s.installed.length ? `Partially installed (${s.installed.length} events)` : 'Not installed')}
                  </div>
                </div>
                {s.installed.length > 0 && (
                  <button className="btn h-8" onClick={() => void hookAction('uninstall', name)}>
                    Remove
                  </button>
                )}
                <button className="btn btn-primary h-8" onClick={() => void hookAction('install', name)}>
                  {s.complete ? 'Reinstall' : 'Install'}
                </button>
              </div>
            ))
          ) : (
            <p className="text-[13px] text-ink-3">Loading…</p>
          )}
          {msg && <p className="mt-2 text-[12.5px] text-ink-2">{msg}</p>}
        </div>
      </div>
    </Sheet>
  );
}
