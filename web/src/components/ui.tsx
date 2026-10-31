import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import type { AgentState } from '../../../shared/types.ts';
import { STATE_LABEL } from '../lib/format.ts';

/** Live media query: re-renders when the viewport crosses the breakpoint. */
export function useMedia(query: string) {
  return useSyncExternalStore(
    (cb) => {
      const q = matchMedia(query);
      q.addEventListener('change', cb);
      return () => q.removeEventListener('change', cb);
    },
    () => matchMedia(query).matches,
  );
}

export function useIsNarrow(px = 759) {
  return useMedia(`(max-width: ${px}px)`);
}

/** Device layouts from the package: phone < 768, portrait tablet 768-1023, wide (iPad landscape and desktop) >= 1024. */
export function useLayout() {
  const phone = useMedia('(max-width: 767px)');
  const portrait = useMedia('(min-width: 768px) and (max-width: 1023px)');
  const snug = useMedia('(min-width: 1024px) and (max-width: 1279px)');
  return { phone, portrait, wide: !phone && !portrait, drawerW: snug ? 460 : 500 };
}

/**
 * Drawers float over the village in smoked glass. On wide screens they slide in from the right
 * (the camera pans so the selected agent stays in the clear part of the view); on portrait tablets
 * and phones they rise as bottom sheets.
 */
export function Sheet({
  open,
  onClose,
  title,
  icon,
  children,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  icon?: ReactNode;
  width?: number;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const { phone, wide, drawerW } = useLayout();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const t = setTimeout(() => ref.current?.focus({ preventScroll: true }), 50);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(t);
    };
  }, [open, onClose]);
  const place: React.CSSProperties = wide
    ? { top: 'calc(80px + env(safe-area-inset-top))', right: 12, bottom: 12, width: drawerW, borderRadius: 22 }
    : phone
      ? { left: 0, right: 0, bottom: 0, height: '88dvh', borderRadius: '22px 22px 0 0' }
      : { left: 12, right: 12, bottom: 12, height: '62dvh', borderRadius: 22 };
  return (
    <AnimatePresence>
      {open && (
        <>
          {phone && <motion.div className="fixed inset-0 z-[3000] bg-black/45" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />}
          <motion.aside
            ref={ref}
            tabIndex={-1}
            role={phone ? 'dialog' : 'complementary'}
            aria-modal={phone || undefined}
            aria-label={typeof title === 'string' ? title : undefined}
            className="drawer smoke fixed z-[3001] flex flex-col overflow-hidden outline-none"
            style={place}
            initial={wide ? { x: drawerW + 24, opacity: 0.6 } : { y: '100%' }}
            animate={wide ? { x: 0, opacity: 1 } : { y: 0 }}
            exit={wide ? { x: drawerW + 24, opacity: 0.6 } : { y: '100%' }}
            transition={{ type: 'tween', ease: [0.22, 1, 0.36, 1], duration: 0.34 }}
          >
            {!wide && <span className="mx-auto mt-2 h-1 w-10 flex-none rounded-full bg-[var(--hairline-strong)]" aria-hidden />}
            <header className="flex h-14 flex-none items-center gap-2.5 border-b border-[var(--smoke-edge)] px-4">
              {icon && <span className="text-ink-3">{icon}</span>}
              <h2 className="min-w-0 flex-1 truncate text-[14.5px] font-semibold tracking-tight">{title}</h2>
              {actions}
              <button className="icon-btn" onClick={onClose} aria-label="Close panel">
                <X size={18} />
              </button>
            </header>
            <div className="scroll-y safe-bottom min-h-0 flex-1">{children}</div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

export function Modal({ open, onClose, title, children, width = 720 }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: number }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[4000] grid place-items-center bg-black/45 p-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div
            role="dialog"
            className="glass flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-[24px]"
            style={{ maxWidth: width }}
            initial={{ scale: 0.95, y: 10 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.97, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center gap-2 border-b border-line px-5 py-3.5">
              <h2 className="flex-1 text-[16px] font-semibold">{title}</h2>
              <button className="icon-btn" onClick={onClose} aria-label="Close">
                <X size={18} />
              </button>
            </header>
            <div className="scroll-y min-h-0 flex-1">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  return (
    <label className={`flex items-start gap-3 py-2 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px]">{label}</span>
        {hint && <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-3">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="relative mt-0.5 h-[26px] w-[44px] flex-none rounded-full border border-line transition-colors"
        style={{ background: checked ? 'var(--accent)' : 'var(--glass-2)' }}
      >
        <span className="absolute top-[2px] h-[20px] w-[20px] rounded-full bg-white shadow transition-all" style={{ left: checked ? 20 : 2 }} />
      </button>
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-[12px] border border-line bg-glass p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className="h-8 rounded-[9px] px-3 text-[13px] font-medium transition-colors"
          style={value === o.value ? { background: 'var(--glass-2)', color: 'var(--text)', boxShadow: '0 1px 4px rgb(0 0 0 / .15)' } : { color: 'var(--text-2)' }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function StatePill({ state, big }: { state: AgentState; big?: boolean }) {
  return (
    <span className={`st-${state} inline-flex items-center gap-1.5 rounded-full border border-line font-semibold ${big ? 'h-8 px-3 text-[13px]' : 'h-6 px-2 text-[11.5px]'}`} style={{ background: 'color-mix(in srgb, var(--st) 14%, transparent)' }}>
      <span className="state-dot" />
      {STATE_LABEL[state]}
    </span>
  );
}

export function Row({ label, children, muted }: { label: ReactNode; children: ReactNode; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-[13.5px]">
      <span className="text-ink-3">{label}</span>
      <span className={`min-w-0 text-right ${muted ? 'text-ink-3 italic' : ''}`}>{children}</span>
    </div>
  );
}

/** Minimal Markdown: ## headings, fenced code, bullet lists, paragraphs, inline `code`. */
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split('\n');
  let i = 0;
  const inline = (s: string) => s.split(/(`[^`]+`)/g).map((part, k) => (part.startsWith('`') && part.endsWith('`') ? <code key={k}>{part.slice(1, -1)}</code> : part));
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('```')) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) body.push(lines[i++]);
      i++;
      blocks.push(
        <pre key={blocks.length}>
          <code>{body.join('\n')}</code>
        </pre>,
      );
    } else if (line.startsWith('## ')) {
      blocks.push(<h2 key={blocks.length}>{line.slice(3)}</h2>);
      i++;
    } else if (line.startsWith('- ')) {
      const items: string[] = [];
      while (i < lines.length && lines[i].startsWith('- ')) items.push(lines[i++].slice(2));
      blocks.push(
        <ul key={blocks.length}>
          {items.map((it, k) => (
            <li key={k}>{inline(it)}</li>
          ))}
        </ul>,
      );
    } else if (line.trim()) {
      blocks.push(<p key={blocks.length}>{inline(line)}</p>);
      i++;
    } else i++;
  }
  return <div className="md">{blocks}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-4 py-8 text-center text-[13.5px] text-ink-3">{children}</div>;
}
