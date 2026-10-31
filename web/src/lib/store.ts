import { useSyncExternalStore } from 'react';
import type { AgentConfig, AgentLive, Preferences, ServerMessage, Snapshot, VillageEvent } from '../../../shared/types.ts';
import { api } from './api.ts';

export type AuthState = 'unknown' | 'signed-out' | 'setup' | 'setup-remote' | 'signed-in';

export interface UIState {
  auth: AuthState;
  snapshot: Snapshot | null;
  events: VillageEvent[];
  socket: 'connecting' | 'open' | 'closed';
  lastMessageAt: number | null;
  /** Round trip of the last WebSocket ping, measured, in ms. */
  latency: number | null;
  prefs: Preferences;
}

const DEFAULT_PREFS: Preferences = {
  theme: 'dark',
  reduceMotion: typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  sound: false,
  environment: 'nebula',
  dayNight: true,
  layout: 'scattered',
  bubbles: true,
  notifyOn: { waiting: true, error: true, completed: false },
};

type EventFn = (e: VillageEvent) => void;
type LiveFn = (next: AgentLive, prev: AgentLive | undefined) => void;

class Store {
  state: UIState = { auth: 'unknown', snapshot: null, events: [], socket: 'closed', lastMessageAt: null, latency: null, prefs: DEFAULT_PREFS };
  private listeners = new Set<() => void>();
  private eventFns = new Set<EventFn>();
  private liveFns = new Set<LiveFn>();
  private ws: WebSocket | null = null;
  private retry = 1000;
  private pingTimer: number | undefined;
  private pingSent = 0;
  private wanted = false;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  get = () => this.state;
  set(patch: Partial<UIState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }
  onEvent(fn: EventFn) {
    this.eventFns.add(fn);
    return () => void this.eventFns.delete(fn);
  }
  onLive(fn: LiveFn) {
    this.liveFns.add(fn);
    return () => void this.liveFns.delete(fn);
  }

  async boot() {
    window.addEventListener('av:unauthorized', () => this.signedOut());
    try {
      const s = await api.get<{ configured: boolean; authenticated: boolean; canSetup: boolean }>('/api/auth/status');
      if (s.authenticated) await this.signedIn();
      else if (!s.configured) this.set({ auth: s.canSetup ? 'setup' : 'setup-remote' });
      else this.set({ auth: 'signed-out' });
    } catch {
      this.set({ auth: 'signed-out' });
    }
  }

  async signedIn() {
    this.set({ auth: 'signed-in' });
    try {
      const prefs = await api.get<Preferences>('/api/prefs');
      this.set({ prefs: { ...DEFAULT_PREFS, ...prefs } });
    } catch {
      /* keep defaults */
    }
    this.connect();
  }

  signedOut() {
    this.wanted = false;
    this.ws?.close();
    this.set({ auth: 'signed-out', snapshot: null, events: [] });
  }

  async savePrefs(patch: Partial<Preferences>) {
    const prefs = { ...this.state.prefs, ...patch };
    this.set({ prefs });
    try {
      await api.put('/api/prefs', patch);
    } catch {
      /* local change still applies */
    }
  }

  private async loadEvents() {
    try {
      const events = await api.get<VillageEvent[]>('/api/events?limit=200');
      this.set({ events });
    } catch {
      /* feed stays empty */
    }
  }

  connect() {
    this.wanted = true;
    if (this.ws && this.ws.readyState <= 1) return;
    this.set({ socket: 'connecting' });
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    const ws = new WebSocket(url);
    this.ws = ws;
    const ping = () => {
      if (ws.readyState !== 1) return;
      this.pingSent = performance.now();
      ws.send('{"t":"ping"}');
    };
    ws.onopen = () => {
      this.retry = 1000;
      this.set({ socket: 'open' });
      clearInterval(this.pingTimer);
      ping();
      this.pingTimer = window.setInterval(ping, 10_000);
    };
    ws.onmessage = (m) => this.handle(JSON.parse(m.data) as ServerMessage);
    ws.onclose = (e) => {
      clearInterval(this.pingTimer);
      this.set({ socket: 'closed', latency: null });
      if (e.code === 4401) return this.signedOut();
      if (!this.wanted) return;
      setTimeout(() => this.connect(), this.retry);
      this.retry = Math.min(this.retry * 2, 15_000);
    };
  }

  private handle(m: ServerMessage) {
    const now = Date.now();
    const snap = this.state.snapshot;
    switch (m.t) {
      case 'snapshot': {
        const demoChanged = snap && snap.demo !== m.snapshot.demo;
        this.set({ snapshot: m.snapshot, lastMessageAt: now });
        if (!snap || demoChanged) void this.loadEvents();
        break;
      }
      case 'live': {
        if (!snap) return;
        const prev = snap.live[m.live.agentId];
        this.set({ snapshot: { ...snap, live: { ...snap.live, [m.live.agentId]: m.live }, stats: m.stats }, lastMessageAt: now });
        this.liveFns.forEach((f) => f(m.live, prev));
        break;
      }
      case 'event':
        this.set({ events: [m.event, ...this.state.events].slice(0, 400), lastMessageAt: now });
        this.eventFns.forEach((f) => f(m.event));
        break;
      case 'agents':
        if (snap) this.set({ snapshot: { ...snap, agents: m.agents }, lastMessageAt: now });
        break;
      case 'hub':
        if (snap) this.set({ snapshot: { ...snap, hub: m.hub, demo: m.demo }, lastMessageAt: now });
        break;
      case 'pong':
        this.set({ lastMessageAt: now, latency: this.pingSent ? Math.round(performance.now() - this.pingSent) : null });
        break;
    }
  }
}

export const store = new Store();

// Stable empty values so selectors never return a fresh object while no snapshot exists.
export const NO_AGENTS: AgentConfig[] = [];
export const NO_LIVE: Record<string, AgentLive> = {};

export function useStore<T>(select: (s: UIState) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.get()));
}
