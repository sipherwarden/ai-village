// Types shared by the hub (server/) and the village UI (web/).
// Keep this file free of runtime code so both sides can import it with `import type`.

export type AgentState =
  | 'ONLINE'
  | 'WORKING'
  | 'THINKING'
  | 'WAITING'
  | 'IDLE'
  | 'OFFLINE'
  | 'ERROR'
  | 'COMPLETED'
  | 'UNKNOWN';

/** Whether the hub can currently reach / hear from the agent runtime. */
export type Connection = 'connected' | 'quiet' | 'disconnected' | 'never-seen' | 'disabled' | 'not-observable';

export type EventType =
  | 'agent.connected'
  | 'agent.disconnected'
  | 'agent.heartbeat'
  | 'agent.error'
  | 'agent.status'
  | 'session.started'
  | 'session.ended'
  | 'task.started'
  | 'task.completed'
  | 'task.failed'
  | 'agent.thinking'
  | 'agent.waiting'
  | 'tool.started'
  | 'tool.completed'
  | 'tool.failed'
  | 'file.created'
  | 'file.edited'
  | 'research.started'
  | 'research.completed'
  | 'code.started'
  | 'code.completed'
  | 'handoff'
  | 'provider.status'
  | 'custom';

export type IntegrationKind =
  | 'claude-code'
  | 'gemini-cli'
  | 'codex'
  | 'opencode'
  | 'http-push'
  | 'http-poll'
  | 'websocket'
  | 'mcp'
  | 'provider-only';

export type BodyShape = 'round' | 'squircle' | 'drop' | 'ghost' | 'bean';
export type Accessory =
  | 'none'
  | 'antenna'
  | 'headphones'
  | 'glasses'
  | 'beanie'
  | 'bow'
  | 'leaf'
  | 'crown'
  | 'visor'
  | 'scarf'
  | 'party-hat'
  | 'halo'
  | 'top-hat'
  | 'wizard-hat'
  | 'cat-ears'
  | 'flower'
  | 'bowtie'
  | 'cape'
  | 'backpack'
  | 'jetpack';
export type ExpressionStyle = 'friendly' | 'focused' | 'sleepy' | 'cheerful';
/** Character design. Also decides the agent's workstation in the village. */
export type Archetype = 'explorer' | 'scholar' | 'host' | 'builder' | 'sprite' | 'sentinel' | 'alchemist' | 'conductor' | 'wisp';

export interface Appearance {
  /** Missing on agents saved before 2.0; the UI derives one from the voice style. */
  archetype?: Archetype;
  shape: BodyShape;
  accessory: Accessory;
  expression: ExpressionStyle;
  /** 0.8 – 1.3 relative size. */
  scale: number;
}

export type VoiceStyle = 'curious' | 'calm' | 'chatty' | 'determined' | 'neutral';

export interface AgentConfig {
  id: string;
  name: string;
  provider: string;
  integration: IntegrationKind;
  color: string;
  personality: string;
  voice: VoiceStyle;
  appearance: Appearance;
  enabled: boolean;
  /** Non-secret integration settings (URLs, intervals, matchers...). */
  settings: Record<string, string | number | boolean>;
  /** Name of an encrypted secret used by this agent, if any. Never the value. */
  secretRef: string | null;
  /** True once a remote ingest token has been issued (the token itself is shown once). */
  hasIngestToken: boolean;
  createdAt: number;
  sort: number;
}

export interface SessionInfo {
  sessionId: string;
  label: string;
  state: AgentState;
  stateSince: number;
  startedAt: number;
  lastEventAt: number;
  activity: string | null;
  taskTitle: string | null;
  taskStartedAt: number | null;
}

export interface TaskSummary {
  id: number;
  agentId: string;
  sessionId: string | null;
  title: string;
  status: 'running' | 'completed' | 'failed' | 'abandoned';
  startedAt: number;
  endedAt: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  /** Context re-read from the prompt cache. Kept apart from tokensIn, which is fresh input only. */
  tokensCached: number | null;
}

export interface ProviderHealth {
  status: 'operational' | 'degraded' | 'outage' | 'unknown' | 'not-checked';
  detail: string;
  checkedAt: number | null;
  source: string | null;
}

export interface AgentLive {
  agentId: string;
  state: AgentState;
  stateSince: number;
  connection: Connection;
  connectionDetail: string;
  lastEventAt: number | null;
  lastHeartbeatAt: number | null;
  activity: string | null;
  currentTask: { title: string; startedAt: number } | null;
  sessions: SessionInfo[];
  provider: ProviderHealth;
  /** Short real status text set via the API (e.g. "Deploying staging"). */
  statusMessage: string | null;
}

export interface VillageEvent {
  id: number;
  ts: number;
  agentId: string;
  sessionId: string | null;
  type: EventType;
  title: string;
  detail: string | null;
  source: string;
  demo: boolean;
  data?: Record<string, unknown> | null;
}

export interface Capability {
  key: string;
  label: string;
  level: 'live' | 'partial' | 'none';
  note?: string;
}

export interface ConfigField {
  key: string;
  label: string;
  type: 'text' | 'url' | 'number' | 'boolean' | 'select';
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
  default?: string | number | boolean;
}

export interface IntegrationInfo {
  kind: IntegrationKind;
  label: string;
  summary: string;
  capabilities: Capability[];
  fields: ConfigField[];
  /** Markdown-ish setup instructions; may contain {{AGENT_ID}} / {{HUB_URL}} placeholders already filled. */
  docs: string;
  usesSecret: boolean;
}

export interface Preferences {
  theme: 'dark' | 'light' | 'auto';
  reduceMotion: boolean;
  sound: boolean;
  environment: 'nebula' | 'aurora' | 'meadow' | 'ocean' | 'studio';
  dayNight: boolean;
  /** World lighting. auto follows the clock; missing means use dayNight. */
  lighting?: 'auto' | 'dawn' | 'day' | 'dusk' | 'night';
  /** Bottom activity ticker. */
  dock?: boolean;
  /** Which island the village is built on (see shared/cosmetics.ts). */
  island?: 'nocturne' | 'sakura' | 'glacier' | 'ember' | 'verdant';
  /** 3D render quality; auto picks by device. */
  quality?: 'auto' | 'high' | 'balanced' | 'saver';
  layout: 'scattered' | 'circle' | 'row';
  bubbles: boolean;
  notifyOn: { waiting: boolean; error: boolean; completed: boolean };
}

export interface HubSettings {
  demoMode: boolean;
  /** Minutes without events before a hook-reported session is considered gone. */
  sessionTimeoutMin: number;
  /** Store short tool details (file names, command descriptions). Prompt text is never stored. */
  captureDetails: boolean;
  /** Keep the first ~80 characters of prompts as task titles (local only). Off by default. */
  promptPreviews: boolean;
  providerChecks: boolean;
  /** Days of event history to keep. */
  retentionDays: number;
}

export interface Stats {
  total: number;
  online: number;
  working: number;
  waiting: number;
  offline: number;
  activeTasks: number;
  completedToday: number;
  /** Handoff events received since local midnight. */
  handoffsToday: number;
  errors24h: number;
  lastEventAt: number | null;
}

export interface Snapshot {
  serverTime: number;
  demo: boolean;
  agents: AgentConfig[];
  live: Record<string, AgentLive>;
  stats: Stats;
  hub: HubSettings;
}

export type ServerMessage =
  | { t: 'snapshot'; snapshot: Snapshot }
  | { t: 'live'; live: AgentLive; stats: Stats }
  | { t: 'event'; event: VillageEvent }
  | { t: 'agents'; agents: AgentConfig[] }
  | { t: 'hub'; hub: HubSettings; demo: boolean }
  | { t: 'pong'; ts: number };
