import { useEffect, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { store } from '../lib/store.ts';
import { sfx } from '../lib/sound.ts';
import { EVENT_META } from './EventRow.tsx';

interface Toast {
  id: number;
  agentId: string;
  name: string;
  color: string;
  label: string;
  title: string;
  tone: string;
}

/** In-app alerts, sounds and (when allowed) system notifications for real events. */
export function Toasts({ onOpen, style }: { onOpen: (agentId: string) => void; style?: CSSProperties }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(
    () =>
      store.onEvent((e) => {
        const { prefs, snapshot } = store.get();
        const agent = snapshot?.agents.find((a) => a.id === e.agentId);
        if (!agent) return;
        const kind =
          e.type === 'agent.waiting' ? 'waiting' : e.type === 'agent.error' || e.type === 'task.failed' ? 'error' : e.type === 'task.completed' ? 'completed' : null;
        if (prefs.sound) {
          if (kind === 'completed') sfx.completed(agent.id);
          else if (kind === 'waiting') sfx.waiting(agent.id);
          else if (kind === 'error') sfx.error();
        }
        if (!kind || !prefs.notifyOn[kind]) return;
        const meta = EVENT_META[e.type];
        const t: Toast = { id: e.id, agentId: agent.id, name: agent.name, color: agent.color, label: meta?.label ?? e.type, title: e.title, tone: meta?.tone ?? 'var(--accent)' };
        setToasts((xs) => [t, ...xs].slice(0, 4));
        setTimeout(() => setToasts((xs) => xs.filter((x) => x.id !== t.id)), 6500);
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
          new Notification(`${agent.name}: ${t.label}`, { body: e.title, tag: `av-${agent.id}` });
        }
      }),
    [],
  );

  return (
    <div className="pointer-events-none absolute z-30 flex w-[min(340px,calc(100%-24px))] flex-col-reverse gap-2" style={style} role="log" aria-live="polite" aria-label="Notifications">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.button
            key={t.id}
            layout
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="glass pointer-events-auto flex items-start gap-3 rounded-[12px] p-3 text-left"
            onClick={() => onOpen(t.agentId)}
          >
            <span className="mt-1 h-3 w-3 flex-none rounded-full" style={{ background: t.color, boxShadow: `0 0 0 3px ${t.color}33` }} />
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] font-semibold" style={{ color: t.tone }}>
                {t.name} · {t.label}
              </span>
              <span className="block truncate text-[13.5px]">{t.title}</span>
            </span>
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}
