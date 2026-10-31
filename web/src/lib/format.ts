import type { AgentState, Connection } from '../../../shared/types.ts';

export const STATE_LABEL: Record<AgentState, string> = {
  ONLINE: 'Online',
  WORKING: 'Working',
  THINKING: 'Thinking',
  WAITING: 'Waiting',
  IDLE: 'Idle',
  OFFLINE: 'Offline',
  ERROR: 'Error',
  COMPLETED: 'Completed',
  UNKNOWN: 'Unknown',
};

export const CONNECTION_LABEL: Record<Connection, string> = {
  connected: 'Connected',
  quiet: 'Connected · quiet',
  disconnected: 'Disconnected',
  'never-seen': 'Never seen',
  disabled: 'Disabled',
  'not-observable': 'Not observable',
};

export function duration(ms: number | null | undefined): string {
  if (ms == null || !isFinite(ms)) return '—';
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function ago(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return 'never';
  const s = Math.round((now - ts) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(ts).toLocaleDateString();
}

export function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

export function compact(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt)));
  const r = f(n >> 16);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** Blend two #rrggbb colors; t=0 gives a, t=1 gives b. */
export function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `#${((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)}`;
}

/** "Request in ai-village" reads better mid-sentence as "a request in ai-village". */
const PROVIDERS: Record<string, string> = { anthropic: 'Anthropic', openai: 'OpenAI', google: 'Google', opencode: 'OpenCode', custom: 'Custom' };

/** Display name for a provider id; unknown ids are shown as entered. */
export function providerName(id: string): string {
  return PROVIDERS[id.toLowerCase()] ?? id;
}

export function taskPhrase(title: string): string {
  return title.startsWith('Request in ') ? `a request in ${title.slice(11)}` : title;
}
