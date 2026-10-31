import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { FlaskConical, Minimize2, Plus, SunDim, WifiOff } from 'lucide-react';
import type { AgentConfig } from '../../shared/types.ts';
import { store, useStore } from './lib/store.ts';
import { unlockAudio } from './lib/sound.ts';
import { LIGHTING, usePeriod } from './lib/lighting.ts';
import { useNow } from './lib/hooks.ts';
import { Village3D, type Insets, type Quality } from './components/Village3D.tsx';
import { AgentDeck, IconRail, TabBar, Ticker, TopBar, type Section } from './components/Shell.tsx';
import { ActivityFeed } from './components/ActivityFeed.tsx';
import { ProfilePanel } from './components/ProfilePanel.tsx';
import { TasksView } from './components/TasksView.tsx';
import { AgentsView } from './components/AgentsView.tsx';
import { AgentEditor } from './components/AgentEditor.tsx';
import { SettingsView } from './components/SettingsView.tsx';
import { Toasts } from './components/Toasts.tsx';
import { ShopView } from './components/ShopView.tsx';
import { finishPurchase } from './lib/shop.ts';
import { ITEM } from '../../shared/cosmetics.ts';
import { Login } from './components/Login.tsx';
import { useLayout, useMedia } from './components/ui.tsx';

/** Render quality: the user's choice, or high on desktops and balanced on touch devices. */
function useQuality(pref: 'auto' | 'high' | 'balanced' | 'saver' | undefined): Quality {
  const coarse = useMedia('(pointer: coarse)');
  if (pref && pref !== 'auto') return pref;
  return coarse ? 'balanced' : 'high';
}

function useTheme(pref: 'dark' | 'light' | 'auto') {
  const systemLight = useMedia('(prefers-color-scheme: light)');
  const theme = pref === 'auto' ? (systemLight ? 'light' : 'dark') : pref;
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#060914' : '#eef0f4');
  }, [theme]);
  return theme;
}

function useViewportHeight() {
  const [h, setH] = useState(() => window.innerHeight);
  useEffect(() => {
    const on = () => setH(window.innerHeight);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return h;
}

export function App() {
  const auth = useStore((s) => s.auth);
  const prefs = useStore((s) => s.prefs);
  const snapshot = useStore((s) => s.snapshot);
  const socket = useStore((s) => s.socket);
  const theme = useTheme(prefs.theme);
  const period = usePeriod(prefs, theme);
  const quality = useQuality(prefs.quality);
  const { phone, wide, drawerW } = useLayout();
  const vh = useViewportHeight();
  const [section, setSection] = useState<Section>('village');
  const [feedFocus, setFeedFocus] = useState<string | undefined>();
  const [profile, setProfile] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ open: boolean; agent: AgentConfig | null }>({ open: false, agent: null });
  const [kiosk, setKiosk] = useState(false);
  const [offlineLong, setOfflineLong] = useState(false);
  const [purchase, setPurchase] = useState<string | null>(null);

  // Coming back from Stripe Checkout: claim the receipt and unlock the item.
  useEffect(() => {
    if (auth !== 'signed-in') return;
    void finishPurchase().then((r) => {
      if (!r) return;
      setPurchase(r.item ? `Unlocked: ${ITEM[r.item]?.name ?? r.item}. Thank you for supporting AI Village!` : (r.error ?? null));
      setSection('shop');
    });
  }, [auth]);
  useEffect(() => {
    if (!purchase) return;
    const t = setTimeout(() => setPurchase(null), 7000);
    return () => clearTimeout(t);
  }, [purchase]);

  useEffect(() => {
    void store.boot();
    window.addEventListener('pointerdown', () => unlockAudio(), { once: true });
  }, []);

  // Older panels still read the period palette for their accents.
  useEffect(() => {
    const root = document.documentElement;
    for (const [k, v] of Object.entries(LIGHTING[period])) root.style.setProperty(k, String(v));
  }, [period]);

  useEffect(() => {
    if (socket === 'open') return setOfflineLong(false);
    const t = setTimeout(() => setOfflineLong(true), 4000);
    return () => clearTimeout(t);
  }, [socket]);

  const openSection = useCallback((s: Section, focus?: string) => {
    setProfile(null);
    setFeedFocus(focus);
    setSection((cur) => (cur === s && s !== 'village' && !focus ? 'village' : s));
  }, []);
  const openProfile = useCallback((id: string) => {
    setSection('village');
    setProfile((cur) => (cur === id ? null : id));
  }, []);
  const select = useCallback((id: string | null) => (id ? openProfile(id) : setProfile(null)), [openProfile]);
  const closePanel = useCallback(() => setSection('village'), []);
  const edit = useCallback((agent: AgentConfig | null) => setEditor({ open: true, agent }), []);

  const enterKiosk = async () => {
    setSection('village');
    setProfile(null);
    setKiosk(true);
    const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    try {
      if (el.requestFullscreen) await el.requestFullscreen();
      else el.webkitRequestFullscreen?.();
    } catch {
      /* fullscreen not allowed here; the kiosk layout still applies */
    }
    try {
      await (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<unknown> } }).wakeLock?.request('screen');
    } catch {
      /* wake lock needs HTTPS */
    }
  };
  const exitKiosk = () => {
    setKiosk(false);
    if (document.fullscreenElement) void document.exitFullscreen();
  };

  if (auth !== 'signed-in') {
    return (
      <div className="relative h-full" style={{ background: 'radial-gradient(80% 60% at 50% 30%, #131a33, #060914 70%)' }}>
        {auth !== 'unknown' && <Login mode={auth} />}
      </div>
    );
  }

  const drawerOpen = section !== 'village' || !!profile;
  const showTicker = !kiosk && wide && prefs.dock !== false;
  const empty = snapshot && snapshot.agents.length === 0;
  // The unobstructed part of the screen; the camera centres the village (or the selected home) in it.
  const insets: Insets = kiosk
    ? { top: 20, bottom: 20, left: 20, right: 20 }
    : wide
      ? { top: 84, left: 84, bottom: showTicker ? 80 : 16, right: drawerOpen ? drawerW + 28 : 16 }
      : phone
        ? { top: 76, left: 8, right: 8, bottom: drawerOpen ? vh * 0.88 : 176 }
        : { top: 84, left: 12, right: 12, bottom: drawerOpen ? vh * 0.62 + 28 : 100 };

  return (
    <div className={`app h-full ${prefs.reduceMotion ? 'reduce-motion' : ''}`}>
      <main className="stage-area h-full" aria-label="Village">
        {snapshot && <Village3D onSelect={select} selectedId={profile} reduceMotion={prefs.reduceMotion} period={period} insets={insets} kiosk={kiosk} quality={quality} island={prefs.island ?? 'nocturne'} />}
        {!kiosk && <TopBar compact={!wide} onKiosk={() => void enterKiosk()} />}
        {!kiosk && wide && <IconRail section={section} onSection={openSection} onKiosk={() => void enterKiosk()} />}
        {showTicker && <Ticker onOpen={() => openSection('feed')} onAgent={openProfile} style={{ right: drawerOpen ? drawerW + 28 : 12 }} />}
        {!kiosk && phone && !drawerOpen && <AgentDeck selectedId={profile} onAgent={openProfile} />}
        {!kiosk && !wide && <TabBar section={profile ? 'village' : section} onSection={openSection} />}
        {empty && (
          <div className="absolute inset-0 z-10 grid place-items-center">
            <div className="smoke relative rounded-[18px] p-6 text-center">
              <p className="mb-3 text-[15px] font-semibold">The village is empty.</p>
              <button className="btn btn-primary" onClick={() => edit(null)}>
                <Plus size={16} /> Add your first agent
              </button>
            </div>
          </div>
        )}
        <AnimatePresence>
          {offlineLong && (
            <motion.div key="offline" role="status" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-none absolute inset-x-3 top-24 z-30 flex justify-center">
              <div className="smoke relative flex items-center gap-2 rounded-[12px] px-4 py-2 text-[13px]">
                <WifiOff size={15} className="flex-none text-[var(--st-error)]" /> Lost connection to the hub. Statuses may be out of date. Reconnecting…
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        {!kiosk && <Toasts onOpen={openProfile} style={{ right: drawerOpen && wide ? drawerW + 28 : 12, bottom: showTicker ? 80 : phone ? 184 : 100 }} />}
        {kiosk && <KioskHud onExit={exitKiosk} />}
        <AnimatePresence>
          {purchase && (
            <motion.div key="purchase" role="status" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="pointer-events-none absolute inset-x-3 top-24 z-[3600] flex justify-center">
              <div className="lg relative rounded-full px-5 py-2.5 text-[13.5px] font-medium">{purchase}</div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <ActivityFeed open={section === 'feed' && !kiosk} focus={feedFocus} onClose={closePanel} onAgent={openProfile} />
      <TasksView open={section === 'tasks' && !kiosk} onClose={closePanel} onAgent={openProfile} />
      <AgentsView open={section === 'agents' && !kiosk} onClose={closePanel} onEdit={edit} onOpenProfile={openProfile} />
      <SettingsView open={section === 'settings' && !kiosk} onClose={closePanel} onShop={() => openSection('shop')} />
      <ShopView open={section === 'shop' && !kiosk} onClose={closePanel} />
      <ProfilePanel agentId={kiosk ? null : profile} onClose={() => setProfile(null)} onCustomize={edit} onShop={() => openSection('shop')} />
      <AgentEditor open={editor.open} agent={editor.agent} onClose={() => setEditor((e) => ({ ...e, open: false }))} onShop={() => openSection('shop')} />
    </div>
  );
}

/** Always-on display: clock and one status line readable from across the room; controls fade when idle. */
function KioskHud({ onExit }: { onExit: () => void }) {
  const now = useNow(15_000);
  const stats = useStore((s) => s.snapshot?.stats);
  const demo = useStore((s) => s.snapshot?.demo ?? false);
  const [awake, setAwake] = useState(true);
  const [dim, setDim] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const wake = () => {
      setAwake(true);
      clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setAwake(false), 3500);
    };
    wake();
    window.addEventListener('pointermove', wake);
    window.addEventListener('pointerdown', wake);
    window.addEventListener('keydown', wake);
    return () => {
      window.removeEventListener('pointermove', wake);
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
      clearTimeout(timer.current);
    };
  }, []);
  const d = new Date(now);
  return (
    <>
      {dim && <div className="pointer-events-none absolute inset-0 z-20 bg-black/35" aria-hidden />}
      <div className="safe-top pointer-events-none absolute left-7 top-6 z-30 text-white">
        <div className="mono text-[46px] font-light leading-none tracking-tight">{d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>
        <div className="mt-2 text-[15px] text-white/70">{d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</div>
        {stats && (
          <div className="mt-2.5 text-[15px] text-white/85">
            {stats.online}/{stats.total} online · {stats.working} busy{stats.waiting ? ` · ${stats.waiting} waiting on you` : ''}
          </div>
        )}
        {demo && (
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[var(--st-waiting)] px-3 py-1 text-[13px] font-semibold text-black">
            <FlaskConical size={14} /> Simulation Lab
          </div>
        )}
      </div>
      <div className="safe-top absolute right-5 top-5 z-30 flex gap-2 transition-opacity duration-500" style={{ opacity: awake ? 1 : 0 }}>
        <button className="smoke relative flex h-10 items-center gap-2 rounded-[12px] px-3.5 text-[13.5px] font-medium" onClick={() => setDim((v) => !v)} aria-pressed={dim}>
          <SunDim size={16} /> {dim ? 'Brighten' : 'Dim'}
        </button>
        <button className="smoke relative flex h-10 items-center gap-2 rounded-[12px] px-3.5 text-[13.5px] font-medium" onClick={onExit}>
          <Minimize2 size={16} /> Exit kiosk
        </button>
      </div>
    </>
  );
}
