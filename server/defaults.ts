import type { AgentConfig, HubSettings, Preferences } from '../shared/types.ts';

export const DEFAULT_PREFS: Preferences = {
  theme: 'dark',
  reduceMotion: false,
  sound: false,
  environment: 'nebula',
  dayNight: true,
  lighting: 'auto',
  dock: true,
  layout: 'scattered',
  bubbles: true,
  notifyOn: { waiting: true, error: true, completed: false },
};

export const DEFAULT_HUB: HubSettings = {
  demoMode: false,
  sessionTimeoutMin: 60,
  captureDetails: true,
  promptPreviews: false,
  providerChecks: true,
  retentionDays: 30,
};

type Seed = Omit<AgentConfig, 'createdAt' | 'hasIngestToken'>;

export function defaultAgents(hasSecret: (name: string) => boolean): Seed[] {
  return [
    {
      id: 'gemini',
      name: 'Gemini',
      provider: 'google',
      integration: 'gemini-cli',
      color: '#4C8DFF',
      personality: 'Curious, analytical, adventurous. Always looking around for the next thing to learn.',
      voice: 'curious',
      appearance: { archetype: 'explorer', shape: 'round', accessory: 'none', expression: 'friendly', scale: 1 },
      enabled: true,
      settings: {},
      secretRef: hasSecret('gemini') ? 'gemini' : null,
      sort: 0,
    },
    {
      id: 'claude',
      name: 'Claude',
      provider: 'anthropic',
      integration: 'claude-code',
      color: '#A47CFF',
      personality: 'Thoughtful, meticulous, creative. Calm and deliberate.',
      voice: 'calm',
      appearance: { archetype: 'scholar', shape: 'squircle', accessory: 'none', expression: 'focused', scale: 1 },
      enabled: true,
      settings: {},
      secretRef: hasSecret('anthropic') ? 'anthropic' : null,
      sort: 1,
    },
    {
      id: 'chatgpt',
      name: 'ChatGPT',
      provider: 'openai',
      integration: 'codex',
      color: '#2FC17A',
      personality: 'Helpful, adaptable, conversational. Friendly and expressive.',
      voice: 'chatty',
      appearance: { archetype: 'host', shape: 'bean', accessory: 'none', expression: 'cheerful', scale: 1 },
      enabled: true,
      settings: {},
      secretRef: null,
      sort: 2,
    },
    {
      id: 'opencode',
      name: 'OpenCode',
      provider: 'opencode',
      integration: 'opencode',
      color: '#FF8A3D',
      personality: 'Technical, determined, hardworking. Focused and energetic.',
      voice: 'determined',
      appearance: { archetype: 'builder', shape: 'drop', accessory: 'none', expression: 'focused', scale: 1 },
      enabled: true,
      settings: { url: 'http://127.0.0.1:4096', eventPath: '/event', username: 'opencode' },
      secretRef: null,
      sort: 3,
    },
  ];
}
