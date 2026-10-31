import { useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowBigUp, BadgePercent, Check, CircleHelp, Hand, Heart, Laugh, Lock, Moon, Music, PartyPopper, RotateCw, ShoppingBag, Sparkles, Timer, X, Zap } from 'lucide-react';
import { ACCESSORIES, CHARACTERS, EMOTES, ISLANDS, ITEM, formatPrice, type Emote, type Island, type Item } from '../../../shared/cosmetics.ts';
import type { Accessory, Archetype } from '../../../shared/types.ts';
import { buy, isOwned, useShop } from '../lib/shop.ts';
import { useNow } from '../lib/hooks.ts';
import { IDENTITY } from '../engine/creature.ts';
import { THEMES } from '../engine/themes.ts';
import { Portrait } from './Avatar.tsx';
import { useLayout } from './ui.tsx';

type Tab = 'character' | 'accessory' | 'island' | 'emote';
const TABS: { id: Tab; label: string; items: Item[] }[] = [
  { id: 'character', label: 'Characters', items: CHARACTERS },
  { id: 'accessory', label: 'Accessories', items: ACCESSORIES.filter((a) => a.value !== 'none') },
  { id: 'island', label: 'Islands', items: ISLANDS },
  { id: 'emote', label: 'Emotes', items: EMOTES },
];

export const EMOTE_ICON: Record<Emote, ReactNode> = {
  wave: <Hand />,
  cheer: <PartyPopper />,
  nod: <Check />,
  jump: <ArrowBigUp />,
  dance: <Music />,
  spin: <RotateCw />,
  heart: <Heart />,
  laugh: <Laugh />,
  shrug: <CircleHelp />,
  surprised: <Zap />,
  stretch: <Moon />,
  bow: <Sparkles />,
};

const ACCENT = '#38BDF8';

/** A small picture of an item: the character itself, a pod wearing the accessory, an island swatch or the emote. */
export function ItemPreview({ item, size }: { item: Item; size: number }) {
  if (item.kind === 'character') {
    const id = item.value as Archetype;
    const color = id === 'sprite' ? ACCENT : IDENTITY[id as Exclude<Archetype, 'sprite'>].primary;
    return <Portrait color={color} appearance={{ archetype: id, shape: 'round', accessory: 'none', expression: 'friendly', scale: 1 }} voice="neutral" size={size} />;
  }
  if (item.kind === 'accessory') {
    return <Portrait color={ACCENT} appearance={{ archetype: 'sprite', shape: 'round', accessory: item.value as Accessory, expression: 'friendly', scale: 1 }} voice="neutral" size={size} framing="head" />;
  }
  if (item.kind === 'island') {
    const t = THEMES[item.value as Island];
    return (
      <div className="island-swatch" style={{ width: size * 1.35, height: size, background: `radial-gradient(90% 70% at 50% 15%, ${t.sky[0]}, ${t.sky[2]})` }} aria-hidden>
        <span className="island-top" style={{ background: `linear-gradient(160deg, ${t.paving}, ${t.slate})` }} />
        <span className="island-side" style={{ background: `linear-gradient(180deg, ${t.basalt}, ${t.basaltDark})` }} />
        {[0.22, 0.5, 0.74].map((x, i) => (
          <span key={x} className="island-tree" style={{ left: `${x * 100}%`, background: i % 2 ? t.leafLight : t.leaf }} />
        ))}
        <span className="island-pool" style={{ background: t.waterGlow, boxShadow: `0 0 14px ${t.waterGlow}` }} />
      </div>
    );
  }
  return (
    <div className="emote-tile" style={{ width: size, height: size }} aria-hidden>
      {EMOTE_ICON[item.value as Emote]}
    </div>
  );
}

function untilMidnightUtc(now: number) {
  const d = new Date(now);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  const m = Math.max(0, Math.round((next - now) / 60000));
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** The cosmetics shop: today's three deals, then every character, accessory, island and emote. */
export function ShopView({ open, onClose }: { open: boolean; onClose: () => void }) {
  const shop = useShop();
  const now = useNow(30_000);
  const { phone } = useLayout();
  const [tab, setTab] = useState<Tab>('character');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const deals = shop?.deals ?? [];
  const purchase = async (id: string) => {
    setBusy(id);
    setNotice(null);
    const err = await buy(id);
    setBusy(null);
    if (err) setNotice(err);
  };
  const priceOf = (item: Item) => deals.find((d) => d.id === item.id)?.price ?? item.price;

  const card = (item: Item, big = false) => {
    const owned = isOwned(shop, item.id);
    const deal = deals.find((d) => d.id === item.id);
    return (
      <div key={item.id} className={`shop-card lg ${big ? 'big' : ''}`} data-owned={owned || undefined}>
        {deal && !owned && (
          <span className="deal-badge">
            <BadgePercent size={13} /> {deal.off}% off
          </span>
        )}
        <div className="shop-preview">
          <ItemPreview item={item} size={big ? 118 : 92} />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold">{item.name}</div>
          <div className="line-clamp-2 text-[12px] text-ink-3">{item.blurb}</div>
        </div>
        {owned ? (
          <span className="lg-chip owned">
            <Check size={14} /> {item.price === 0 ? 'Included' : 'Owned'}
          </span>
        ) : (
          <button className="lg-btn primary" disabled={!!busy || !shop?.configured} onClick={() => void purchase(item.id)} aria-label={`Buy ${item.name} for ${formatPrice(priceOf(item))}`}>
            {busy === item.id ? 'Opening checkout…' : formatPrice(priceOf(item))}
            {deal && <s className="ml-1 opacity-60">{formatPrice(item.price)}</s>}
          </button>
        )}
      </div>
    );
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="fixed inset-0 z-[3500] bg-black/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.section
            role="dialog"
            aria-modal
            aria-label="Shop"
            className="shop lg fixed z-[3501] flex flex-col overflow-hidden"
            style={phone ? { inset: '6dvh 0 0 0', borderRadius: '28px 28px 0 0' } : { left: '50%', top: '50%', width: 'min(980px, calc(100vw - 48px))', height: 'min(720px, calc(100dvh - 48px))', borderRadius: 32, x: '-50%', y: '-50%' }}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
          >
            <header className="flex flex-none items-center gap-3 px-6 pb-3 pt-5">
              <ShoppingBag size={22} />
              <div className="min-w-0 flex-1">
                <h2 className="text-[20px] font-semibold tracking-tight">Shop</h2>
                <p className="text-[12.5px] text-ink-3">Cosmetics only: they never change what the village reports.</p>
              </div>
              <button className="lg-btn icon" onClick={onClose} aria-label="Close shop">
                <X size={18} />
              </button>
            </header>
            <div className="scroll-y min-h-0 flex-1 px-6 pb-6">
              {shop && !shop.configured && (
                <div className="lg-note mb-4">Purchases are not set up in this build. You can browse everything; buying needs the project's shop server (see the README).</div>
              )}
              {notice && <div className="lg-note warn mb-4">{notice}</div>}
              <div className="mb-2 flex items-center justify-between">
                <h3 className="label">Daily deals</h3>
                <span className="mono flex items-center gap-1.5 text-[12px] text-ink-3">
                  <Timer size={13} /> new deals in {untilMidnightUtc(now)}
                </span>
              </div>
              <div className="shop-grid deals mb-6">{deals.map((d) => ITEM[d.id] && card(ITEM[d.id], true))}</div>
              <div className="lg-segmented mb-4" role="tablist">
                {TABS.map((t) => (
                  <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
                    {t.label}
                  </button>
                ))}
              </div>
              <div className="shop-grid">{TABS.find((t) => t.id === tab)!.items.map((i) => card(i))}</div>
              <p className="mt-6 flex items-center gap-1.5 text-[11.5px] text-ink-3">
                <Lock size={12} /> Payments are handled by Stripe. AI Village never sees your card details.
              </p>
            </div>
          </motion.section>
        </>
      )}
    </AnimatePresence>
  );
}
