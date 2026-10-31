// Integration adapters. Each adapter turns one kind of real signal into NormalizedEvents.
// Adding a provider = adding an entry to ADAPTERS; nothing else in the hub needs to change.

import { basename } from 'node:path';
import type { AgentConfig, Capability, ConfigField, IntegrationInfo, IntegrationKind } from '../shared/types.ts';
import { labelFromCwd, type NormalizedEvent, type StateEngine } from './state.ts';
import type { Secrets } from './secrets.ts';

export interface AdapterContext {
  engine: StateEngine;
  secrets: Secrets;
  emitterPath: string;
  hubUrl: string;
  captureDetails: () => boolean;
  promptPreviews: () => boolean;
  log: (msg: string) => void;
}

export interface Connector {
  stop(): void;
}

export interface TestResult {
  ok: boolean;
  message: string;
}

export interface Adapter {
  kind: IntegrationKind;
  label: string;
  summary: string;
  capabilities: Capability[];
  fields: ConfigField[];
  usesSecret: boolean;
  docs(agent: AgentConfig, ctx: AdapterContext): string;
  ingest?(agent: AgentConfig, payload: Record<string, unknown>, ctx: AdapterContext): NormalizedEvent[];
  connect?(agent: AgentConfig, ctx: AdapterContext): Connector;
  test?(agent: AgentConfig, ctx: AdapterContext): Promise<TestResult>;
}

// ---------------------------------------------------------------- helpers

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
const fileName = (input: Record<string, unknown> | undefined) => {
  const p = str(input?.file_path) ?? str(input?.notebook_path) ?? str(input?.absolute_path) ?? str(input?.path) ?? str(input?.dir_path);
  return p ? basename(p) : undefined;
};

function taskTitle(payload: Record<string, unknown>, ctx: AdapterContext, label: string | null) {
  const preview = str(payload.prompt_preview);
  if (preview && ctx.promptPreviews()) return preview;
  return label ? `Request in ${label}` : 'New request';
}

function lastEventTest(agent: AgentConfig, ctx: AdapterContext): Promise<TestResult> {
  const live = ctx.engine.live(agent.id);
  if (live.lastEventAt) {
    const ago = Math.round((Date.now() - live.lastEventAt) / 1000);
    return Promise.resolve({ ok: true, message: `Last real event received ${ago < 90 ? `${ago}s` : `${Math.round(ago / 60)} min`} ago.` });
  }
  return Promise.resolve({
    ok: false,
    message: 'No events received yet. Make sure the hooks are installed, then use the agent once. Hooks only fire when the agent does something.',
  });
}

// ---------------------------------------------------------------- tool mapping shared by hook adapters

type ToolKind = 'write' | 'edit' | 'shell' | 'web' | 'read' | 'search' | 'delegate' | 'mcp' | 'other';

const CLAUDE_TOOLS: Record<string, ToolKind> = {
  Write: 'write',
  Edit: 'edit',
  MultiEdit: 'edit',
  NotebookEdit: 'edit',
  Bash: 'shell',
  PowerShell: 'shell',
  BashOutput: 'shell',
  WebSearch: 'web',
  WebFetch: 'web',
  Read: 'read',
  Grep: 'search',
  Glob: 'search',
  LS: 'search',
  Task: 'delegate',
  Agent: 'delegate',
};
const GEMINI_TOOLS: Record<string, ToolKind> = {
  write_file: 'write',
  replace: 'edit',
  edit: 'edit',
  run_shell_command: 'shell',
  google_web_search: 'web',
  web_fetch: 'web',
  read_file: 'read',
  read_many_files: 'read',
  glob: 'search',
  search_file_content: 'search',
  grep: 'search',
  list_directory: 'search',
};

function toolEvents(
  phase: 'pre' | 'post' | 'fail',
  tool: string,
  kind: ToolKind,
  input: Record<string, unknown> | undefined,
  base: Omit<NormalizedEvent, 'type' | 'title'>,
  ctx: AdapterContext,
): NormalizedEvent {
  const f = ctx.captureDetails() ? fileName(input) : undefined;
  const desc = ctx.captureDetails() ? str(input?.description) : undefined;
  const cmd = ctx.captureDetails() ? str(input?.command_head) : undefined;
  const mcpName = tool.startsWith('mcp__') ? tool.split('__').slice(1).join(' › ') : tool.startsWith('mcp_') ? tool.slice(4) : null;
  const detail = desc ?? null;

  if (phase === 'fail') {
    return { ...base, type: 'tool.failed', title: `${tool} failed${f ? ` on ${f}` : ''}`, detail, state: 'THINKING', data: { tool } };
  }
  const pre = phase === 'pre';
  switch (kind) {
    case 'write':
      return pre
        ? { ...base, type: 'tool.started', title: f ? `Writing ${f}` : 'Writing a file', detail, state: 'WORKING', ephemeral: true, data: { tool } }
        : { ...base, type: 'file.created', title: f ? `Wrote ${f}` : 'Wrote a file', detail, state: 'THINKING', data: { tool } };
    case 'edit':
      return pre
        ? { ...base, type: 'tool.started', title: f ? `Editing ${f}` : 'Editing a file', detail, state: 'WORKING', ephemeral: true, data: { tool } }
        : { ...base, type: 'file.edited', title: f ? `Edited ${f}` : 'Edited a file', detail, state: 'THINKING', data: { tool } };
    case 'shell':
      return pre
        ? { ...base, type: 'code.started', title: desc ?? (cmd ? `Running ${cmd}` : 'Running a command'), detail: null, state: 'WORKING', data: { tool } }
        : { ...base, type: 'code.completed', title: desc ? `Done: ${desc}` : cmd ? `Finished ${cmd}` : 'Command finished', detail: null, state: 'THINKING', data: { tool } };
    case 'web': {
      const what = ctx.captureDetails() ? (str(input?.query) ?? (str(input?.url) ? new URL(String(input!.url)).hostname : undefined)) : undefined;
      return pre
        ? { ...base, type: 'research.started', title: what ? `Researching: ${what}` : 'Researching the web', detail: null, state: 'WORKING', data: { tool } }
        : { ...base, type: 'research.completed', title: what ? `Research done: ${what}` : 'Research step done', detail: null, state: 'THINKING', data: { tool } };
    }
    case 'read':
      return { ...base, type: pre ? 'tool.started' : 'tool.completed', title: f ? `Reading ${f}` : 'Reading files', detail, state: pre ? 'WORKING' : 'THINKING', ephemeral: true, data: { tool } };
    case 'search':
      return { ...base, type: pre ? 'tool.started' : 'tool.completed', title: 'Searching the code', detail, state: pre ? 'WORKING' : 'THINKING', ephemeral: true, data: { tool } };
    case 'delegate':
      return pre
        ? { ...base, type: 'tool.started', title: desc ? `Delegating: ${desc}` : 'Delegating to a subagent', detail: null, state: 'WORKING', data: { tool } }
        : { ...base, type: 'tool.completed', title: 'Subagent finished', detail: null, state: 'THINKING', data: { tool } };
    default:
      return {
        ...base,
        type: pre ? 'tool.started' : 'tool.completed',
        title: mcpName ? `Using ${mcpName}` : `Using ${tool}`,
        detail,
        state: pre ? 'WORKING' : 'THINKING',
        ephemeral: true,
        data: { tool },
      };
  }
}

// ---------------------------------------------------------------- Claude Code

const claudeCode: Adapter = {
  kind: 'claude-code',
  label: 'Claude Code hooks',
  summary: 'Real-time lifecycle events from Claude Code (CLI and the desktop Code tab) through its hooks system. Works with subscription plans; no API key needed.',
  usesSecret: false,
  capabilities: [
    { key: 'presence', label: 'Session open/closed', level: 'live' },
    { key: 'activity', label: 'Live activity (tools, files, commands)', level: 'live' },
    { key: 'tasks', label: 'Task start / finish', level: 'live' },
    { key: 'waiting', label: 'Waiting for your input', level: 'live' },
    { key: 'tokens', label: 'Token usage per task', level: 'partial', note: 'Read from the local transcript when a turn ends. Fresh input, cache reads and output are counted separately.' },
    { key: 'cost', label: 'API cost', level: 'none', note: 'Subscription plans have no per-call cost to report.' },
    { key: 'heartbeat', label: 'Heartbeat', level: 'none', note: 'Hooks fire only when Claude does something.' },
  ],
  fields: [],
  docs: (a, ctx) => `## How it works
Claude Code runs a command at each lifecycle point (session start, prompt submitted, before/after each tool, waiting for permission, turn finished). AI Village installs a tiny reporter for each of these. It sends a short summary (tool name, file name) to the hub on this PC. Prompt text and file contents are never sent.

## Install
Run this on the PC (backs up your settings first):
\`\`\`
npm run hooks:install
\`\`\`
Or add this to \`~/.claude/settings.json\` yourself, under \`"hooks"\`, for SessionStart, SessionEnd, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, Notification, Stop and SubagentStop:
\`\`\`
{ "hooks": [ { "type": "command", "command": "node \\"${ctx.emitterPath}\\" ${a.id} --format claude", "timeout": 5 } ] }
\`\`\`

## Limits
- Claude.ai chat (web and desktop chat) has no hooks, so it can't be monitored.
- If Claude Code closes without firing SessionEnd, the session is dropped after the session timeout in Settings.`,
  ingest(agent, p, ctx) {
    const event = str(p.hook_event_name);
    const sessionId = str(p.session_id) ?? 'default';
    const label = labelFromCwd(p.cwd);
    const base = { agentId: agent.id, sessionId, sessionLabel: label, source: 'claude-code hook' } as const;
    const tool = str(p.tool_name) ?? 'tool';
    const input = p.tool_input as Record<string, unknown> | undefined;
    switch (event) {
      case 'SessionStart':
        return [{ ...base, type: 'session.started', title: `Session ${p.source === 'resume' ? 'resumed' : 'started'}${label ? ` in ${label}` : ''}`, data: { model: p.model ?? null } }];
      case 'SessionEnd':
        return [{ ...base, type: 'session.ended', title: `Session ended${label ? ` in ${label}` : ''}`, detail: str(p.reason) ?? null }];
      case 'UserPromptSubmit':
        return [{ ...base, type: 'task.started', title: taskTitle(p, ctx, label), detail: 'Thinking about the request' }];
      case 'PreToolUse':
        return [toolEvents('pre', tool, CLAUDE_TOOLS[tool] ?? (tool.startsWith('mcp__') ? 'mcp' : 'other'), input, base, ctx)];
      case 'PostToolUse':
        return [toolEvents(p.tool_error ? 'fail' : 'post', tool, CLAUDE_TOOLS[tool] ?? 'other', input, base, ctx)];
      case 'PostToolUseFailure':
        return [toolEvents('fail', tool, 'other', input, base, ctx)];
      case 'PermissionRequest':
        return [{ ...base, type: 'agent.waiting', title: `Needs your OK to use ${tool}`, state: 'WAITING' }];
      case 'Notification': {
        const type = str(p.notification_type);
        if (type === 'idle_prompt') return [{ ...base, type: 'agent.waiting', title: 'Waiting for your next message', state: 'WAITING' }];
        if (type === 'auth_success') return [];
        return [{ ...base, type: 'agent.waiting', title: str(p.message) ?? 'Needs your attention', state: 'WAITING' }];
      }
      case 'Stop': {
        const tokens = p.tokens as { in: number; out: number; cached?: number } | null | undefined;
        return [{ ...base, type: 'task.completed', title: 'Finished the request', tokens: tokens ?? null, data: tokens ? { tokens } : null }];
      }
      case 'StopFailure':
        return [{ ...base, type: 'task.failed', title: 'Turn ended with an error', detail: str(p.error) ?? null }];
      case 'SubagentStart':
        return [{ ...base, type: 'tool.started', title: `Started a ${str(p.agent_type) ?? ''} subagent`.replace('  ', ' '), state: 'WORKING', ephemeral: true }];
      case 'SubagentStop':
        return [{ ...base, type: 'tool.completed', title: 'Subagent finished', state: 'THINKING', ephemeral: true }];
      case 'PreCompact':
        return [{ ...base, type: 'agent.thinking', title: 'Compacting its context', state: 'THINKING' }];
      default:
        return [];
    }
  },
  test: lastEventTest,
};

// ---------------------------------------------------------------- Gemini CLI

const geminiCli: Adapter = {
  kind: 'gemini-cli',
  label: 'Gemini CLI hooks',
  summary: 'Real-time lifecycle events from Gemini CLI through its hooks system (Google login or API key).',
  usesSecret: false,
  capabilities: [
    { key: 'presence', label: 'Session open/closed', level: 'live' },
    { key: 'activity', label: 'Live activity (tools, files, commands)', level: 'live' },
    { key: 'tasks', label: 'Task start / finish', level: 'live' },
    { key: 'waiting', label: 'Waiting for tool permission', level: 'live' },
    { key: 'tokens', label: 'Token usage', level: 'none', note: 'Only exposed per streamed chunk; not collected to keep hooks light.' },
    { key: 'heartbeat', label: 'Heartbeat', level: 'none' },
  ],
  fields: [],
  docs: (a, ctx) => `## How it works
Gemini CLI runs hooks at SessionStart, BeforeAgent (you sent a prompt), BeforeTool/AfterTool, Notification (tool permission), AfterAgent (turn finished) and SessionEnd. The reporter sends a short summary to the hub on this PC and prints \`{}\` as Gemini expects.

## Install
\`\`\`
npm run hooks:install
\`\`\`
Or add this to \`~/.gemini/settings.json\` under \`"hooks"\` for each event:
\`\`\`
{ "hooks": [ { "type": "command", "name": "ai-village", "command": "node \\"${ctx.emitterPath}\\" ${a.id} --format gemini", "timeout": 5000 } ] }
\`\`\`
You can check them in Gemini CLI with \`/hooks\`.

## Limits
- The Gemini web/mobile app exposes no activity, so it can't be monitored.`,
  ingest(agent, p, ctx) {
    const event = str(p.hook_event_name);
    const sessionId = str(p.session_id) ?? 'default';
    const label = labelFromCwd(p.cwd);
    const base = { agentId: agent.id, sessionId, sessionLabel: label, source: 'gemini-cli hook' } as const;
    const tool = str(p.tool_name) ?? 'tool';
    const input = p.tool_input as Record<string, unknown> | undefined;
    switch (event) {
      case 'SessionStart':
        return [{ ...base, type: 'session.started', title: `Session ${p.source === 'resume' ? 'resumed' : 'started'}${label ? ` in ${label}` : ''}` }];
      case 'SessionEnd':
        return [{ ...base, type: 'session.ended', title: `Session ended${label ? ` in ${label}` : ''}`, detail: str(p.reason) ?? null }];
      case 'BeforeAgent':
        return [{ ...base, type: 'task.started', title: taskTitle(p, ctx, label), detail: 'Thinking about the request' }];
      case 'AfterAgent':
        return [{ ...base, type: 'task.completed', title: 'Finished the request' }];
      case 'BeforeTool':
        return [toolEvents('pre', tool, GEMINI_TOOLS[tool] ?? (tool.startsWith('mcp_') ? 'mcp' : 'other'), input, base, ctx)];
      case 'AfterTool':
        return [toolEvents(p.tool_error ? 'fail' : 'post', tool, GEMINI_TOOLS[tool] ?? 'other', input, base, ctx)];
      case 'Notification':
        return [{ ...base, type: 'agent.waiting', title: str(p.message) ?? 'Needs your permission', state: 'WAITING' }];
      case 'PreCompress':
        return [{ ...base, type: 'agent.thinking', title: 'Compressing its context', state: 'THINKING' }];
      default:
        return [];
    }
  },
  test: lastEventTest,
};

// ---------------------------------------------------------------- Codex (ChatGPT plan)

const codex: Adapter = {
  kind: 'codex',
  label: 'OpenAI Codex notify',
  summary: 'Codex (signed in with your ChatGPT plan) runs a notify command when each turn finishes. That gives completion events only.',
  usesSecret: false,
  capabilities: [
    { key: 'tasks', label: 'Turn finished', level: 'live' },
    { key: 'activity', label: 'Live activity', level: 'none', note: 'Codex notify fires only when a turn ends.' },
    { key: 'presence', label: 'Session open/closed', level: 'none' },
    { key: 'chat', label: 'ChatGPT app conversations', level: 'none', note: 'The ChatGPT app exposes no activity.' },
  ],
  fields: [],
  docs: (a, ctx) => `## Install
Add this line to \`~/.codex/config.toml\` (top level):
\`\`\`
notify = ["node", "${ctx.emitterPath.replace(/\\/g, '/')}", "${a.id}", "--format", "codex"]
\`\`\`
Restart Codex. Each finished turn will show up as a completed task.

## Limits
Codex only reports when a turn finishes, so this agent shows COMPLETED, then IDLE. It never shows WORKING. ChatGPT chat conversations can't be monitored.`,
  ingest(agent, p) {
    if (p.type !== 'agent-turn-complete') return [];
    const label = labelFromCwd(p.cwd);
    return [
      {
        agentId: agent.id,
        sessionId: str(p.thread_id) ?? 'default',
        sessionLabel: label,
        type: 'task.completed',
        title: label ? `Finished a turn in ${label}` : 'Finished a turn',
        source: 'codex notify',
      },
    ];
  },
  test: lastEventTest,
};

// ---------------------------------------------------------------- OpenCode server (SSE)

const opencode: Adapter = {
  kind: 'opencode',
  label: 'OpenCode server events',
  summary: 'Connects to `opencode serve` and listens to its live event stream (Server-Sent Events).',
  usesSecret: true,
  capabilities: [
    { key: 'presence', label: 'Server connected', level: 'live' },
    { key: 'activity', label: 'Live tool activity', level: 'live', note: 'Mapped from OpenCode message-part events.' },
    { key: 'tasks', label: 'Busy / idle per session', level: 'live' },
    { key: 'waiting', label: 'Permission requests', level: 'live' },
  ],
  fields: [
    { key: 'url', label: 'Server URL', type: 'url', placeholder: 'http://127.0.0.1:4096', default: 'http://127.0.0.1:4096' },
    { key: 'eventPath', label: 'Event stream path', type: 'text', default: '/event', help: 'OpenCode v1 uses /event. Change it if your version uses a different path.' },
    { key: 'username', label: 'Username (if password protected)', type: 'text', default: 'opencode' },
  ],
  docs: () => `## Install
Start OpenCode's server (keep it running in a terminal or as a service):
\`\`\`
opencode serve --port 4096 --hostname 127.0.0.1
\`\`\`
Then set the Server URL here. If you set \`OPENCODE_SERVER_PASSWORD\`, store that password as this agent's secret.

## Notes
This adapter uses the documented OpenCode event names (\`session.status\`, \`session.idle\`, \`message.part.updated\`, \`permission.*\`, \`session.error\`). Events this adapter doesn't recognize are ignored, never guessed at. If your OpenCode version renames them, the agent will show connected but quiet.`,
  connect(agent, ctx) {
    let stopped = false;
    let ctrl: AbortController | null = null;
    let backoff = 3000;
    const url = String(agent.settings.url || 'http://127.0.0.1:4096').replace(/\/$/, '') + String(agent.settings.eventPath || '/event');
    const busy = new Set<string>();

    const handle = (msg: Record<string, unknown>) => {
      const type = str(msg.type);
      const props = (msg.properties ?? {}) as Record<string, unknown>;
      const part = (props.part ?? {}) as Record<string, unknown>;
      const sessionId = str(props.sessionID) ?? str(part.sessionID) ?? str((props.info as Record<string, unknown> | undefined)?.id) ?? 'default';
      const base = { agentId: agent.id, sessionId, source: 'opencode sse' } as const;
      const start = () => {
        if (!busy.has(sessionId)) {
          busy.add(sessionId);
          ctx.engine.apply({ ...base, type: 'task.started', title: 'Working on a request' });
        }
      };
      const done = () => {
        if (busy.delete(sessionId)) ctx.engine.apply({ ...base, type: 'task.completed', title: 'Finished the request' });
      };
      switch (type) {
        case 'server.connected':
          ctx.engine.setLink(agent.id, true, `Connected to ${url}`, 'opencode sse');
          break;
        case 'session.created':
          ctx.engine.apply({ ...base, type: 'session.started', title: 'Session created' });
          break;
        case 'session.deleted':
          busy.delete(sessionId);
          ctx.engine.apply({ ...base, type: 'session.ended', title: 'Session deleted' });
          break;
        case 'session.status': {
          const st = str((props.status as Record<string, unknown> | undefined)?.type);
          if (st === 'busy' || st === 'retry') start();
          else if (st === 'idle') done();
          break;
        }
        case 'session.idle':
          done();
          break;
        case 'session.error':
          busy.delete(sessionId);
          ctx.engine.apply({ ...base, type: 'agent.error', title: 'Session error', detail: JSON.stringify(props.error ?? '').slice(0, 200), state: 'ERROR' });
          break;
        case 'permission.updated':
        case 'permission.asked':
          ctx.engine.apply({ ...base, type: 'agent.waiting', title: str(props.title) ?? 'Needs your permission', state: 'WAITING' });
          break;
        case 'message.part.updated': {
          if (part.type !== 'tool') break;
          const tool = str(part.tool) ?? 'tool';
          const st = (part.state ?? {}) as Record<string, unknown>;
          const status = str(st.status);
          const title = ctx.captureDetails() ? str(st.title) : undefined;
          start();
          if (status === 'running') ctx.engine.apply({ ...base, type: 'tool.started', title: title ?? `Using ${tool}`, state: 'WORKING', ephemeral: tool !== 'bash' });
          else if (status === 'completed') ctx.engine.apply({ ...base, type: tool === 'bash' ? 'code.completed' : 'tool.completed', title: title ?? `${tool} done`, state: 'THINKING', ephemeral: tool !== 'bash' && tool !== 'write' && tool !== 'edit' });
          else if (status === 'error') ctx.engine.apply({ ...base, type: 'tool.failed', title: `${tool} failed`, state: 'THINKING' });
          break;
        }
      }
    };

    const run = async () => {
      while (!stopped) {
        ctrl = new AbortController();
        try {
          const headers: Record<string, string> = { accept: 'text/event-stream' };
          if (agent.secretRef) {
            const pw = await ctx.secrets.get(agent.secretRef);
            if (pw) headers.authorization = 'Basic ' + Buffer.from(`${agent.settings.username || 'opencode'}:${pw}`).toString('base64');
          }
          const res = await fetch(url, { headers, signal: ctrl.signal });
          if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
          ctx.engine.setLink(agent.id, true, `Connected to ${url}`, 'opencode sse');
          backoff = 3000;
          const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
          let buf = '';
          while (!stopped) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += value;
            let idx;
            while ((idx = buf.indexOf('\n\n')) >= 0) {
              const chunk = buf.slice(0, idx);
              buf = buf.slice(idx + 2);
              const data = chunk
                .split('\n')
                .filter((l) => l.startsWith('data:'))
                .map((l) => l.slice(5).trim())
                .join('\n');
              if (!data) continue;
              try {
                const parsed = JSON.parse(data) as Record<string, unknown>;
                handle((parsed.payload as Record<string, unknown>) ?? parsed);
              } catch {
                /* ignore malformed frames */
              }
            }
          }
          if (!stopped) throw new Error('Stream closed by server');
        } catch (err) {
          if (stopped) break;
          busy.clear();
          ctx.engine.setLink(agent.id, false, `Can't reach ${url}: ${(err as Error).message}`, 'opencode sse');
          await new Promise((r) => setTimeout(r, backoff));
          backoff = Math.min(backoff * 2, 60_000);
        }
      }
    };
    void run();
    return {
      stop() {
        stopped = true;
        ctrl?.abort();
      },
    };
  },
  async test(agent) {
    const base = String(agent.settings.url || 'http://127.0.0.1:4096').replace(/\/$/, '');
    try {
      const res = await fetch(base + String(agent.settings.eventPath || '/event'), { signal: AbortSignal.timeout(3000), headers: { accept: 'text/event-stream' } });
      res.body?.cancel().catch(() => {});
      return res.ok ? { ok: true, message: `OpenCode event stream answered at ${base}.` } : { ok: false, message: `Server answered HTTP ${res.status}.` };
    } catch (e) {
      return { ok: false, message: `Can't reach ${base}: ${(e as Error).message}. Is \`opencode serve\` running?` };
    }
  },
};

// ---------------------------------------------------------------- generic push (custom agents)

const PUSH_STATES = ['ONLINE', 'WORKING', 'THINKING', 'WAITING', 'IDLE', 'ERROR', 'COMPLETED'];

/** Shared by HTTP push, WebSocket and MCP: accepts the documented village event format. */
export function genericEvents(agent: AgentConfig, p: Record<string, unknown>, source: string): NormalizedEvent[] {
  const type = str(p.type) ?? 'custom';
  const allowed = [
    'agent.heartbeat', 'agent.status', 'agent.error', 'session.started', 'session.ended', 'task.started', 'task.completed',
    'task.failed', 'agent.thinking', 'agent.waiting', 'tool.started', 'tool.completed', 'tool.failed', 'file.created',
    'file.edited', 'research.started', 'research.completed', 'code.started', 'code.completed', 'custom',
  ];
  if (!allowed.includes(type)) return [];
  const state = str(p.state)?.toUpperCase();
  const tokens = p.tokens && typeof p.tokens === 'object' ? (p.tokens as { in: number; out: number; cached?: number }) : null;
  return [
    {
      agentId: agent.id,
      sessionId: str(p.sessionId) ?? str(p.session_id) ?? 'default',
      sessionLabel: str(p.sessionLabel) ?? null,
      type: type as NormalizedEvent['type'],
      title: str(p.title) ?? type,
      detail: str(p.detail) ?? null,
      state: state && PUSH_STATES.includes(state) ? (state as NormalizedEvent['state']) : undefined,
      source,
      tokens,
      data: { ...(p.data as object | undefined), ...(str(p.message) ? { message: p.message } : {}), ...(state ? { state } : {}) },
      ephemeral: type === 'agent.heartbeat' && !state,
    },
  ];
}

const pushDocs = (a: AgentConfig, ctx: AdapterContext) => `## Send events
POST JSON to the hub. From this PC no token is needed. From other machines, send the agent's ingest token (create it in the agent's profile):
\`\`\`
POST ${ctx.hubUrl}/api/v1/agents/${a.id}/events
Authorization: Bearer <ingest token>
{ "type": "task.started", "title": "Summarize inbox", "sessionId": "run-42" }
\`\`\`
Heartbeat (send every ${a.settings.heartbeatSec ?? 30}s while running):
\`\`\`
POST ${ctx.hubUrl}/api/v1/agents/${a.id}/heartbeat
{ "state": "IDLE", "message": "Ready" }
\`\`\`
## Event types
\`session.started\`, \`session.ended\`, \`task.started\`, \`task.completed\`, \`task.failed\`, \`agent.thinking\`, \`agent.waiting\`, \`agent.error\`, \`tool.started\`, \`tool.completed\`, \`file.created\`, \`file.edited\`, \`research.started\`, \`research.completed\`, \`code.started\`, \`code.completed\`, \`agent.status\` (with \`message\`), \`custom\`.
Optional fields: \`state\` (WORKING, THINKING, WAITING, IDLE, ERROR, COMPLETED), \`detail\`, \`sessionLabel\`, \`tokens\` ({"in":n,"out":n,"cached":n}, cached optional).

## Handoffs between agents
When your orchestrator really passes work from one agent to another:
\`\`\`
POST ${ctx.hubUrl}/api/v1/handoff
{ "from": "gemini", "to": "claude", "title": "Build the app from the research" }
\`\`\``;

const httpPush: Adapter = {
  kind: 'http-push',
  label: 'HTTP push + heartbeat',
  summary: 'Your agent (script, service, bot) sends events and heartbeats to the hub. Best for custom local or LAN agents.',
  usesSecret: false,
  capabilities: [
    { key: 'presence', label: 'Heartbeat presence', level: 'live' },
    { key: 'activity', label: 'Activity', level: 'live', note: 'Whatever your agent reports.' },
    { key: 'tasks', label: 'Tasks', level: 'live' },
    { key: 'tokens', label: 'Tokens', level: 'partial', note: 'If your agent includes them.' },
  ],
  fields: [{ key: 'heartbeatSec', label: 'Expected heartbeat interval (seconds)', type: 'number', default: 30 }],
  docs: pushDocs,
  ingest: (agent, p) => genericEvents(agent, p, 'http push'),
  test: lastEventTest,
};

// ---------------------------------------------------------------- HTTP polling

const httpPoll: Adapter = {
  kind: 'http-poll',
  label: 'HTTP status endpoint (polling)',
  summary: 'The hub polls a status URL. Any 2xx answer means online. A JSON body like {"state":"WORKING","task":"…"} sets the state.',
  usesSecret: true,
  capabilities: [
    { key: 'presence', label: 'Reachability', level: 'live' },
    { key: 'activity', label: 'State from response body', level: 'partial' },
  ],
  fields: [
    { key: 'url', label: 'Status URL', type: 'url', placeholder: 'http://127.0.0.1:8080/status' },
    { key: 'intervalSec', label: 'Poll every (seconds)', type: 'number', default: 15 },
  ],
  docs: () => `## Response format
Any 2xx response = online. Optional JSON body:
\`\`\`
{ "state": "WORKING", "task": "Indexing documents", "activity": "Page 14 of 80", "message": "Nightly job" }
\`\`\`
If a secret is set, it is sent as \`Authorization: Bearer <secret>\`.`,
  connect(agent, ctx) {
    let stopped = false;
    let lastTask: string | null = null;
    const interval = Math.max(5, Number(agent.settings.intervalSec || 15)) * 1000;
    const url = String(agent.settings.url || '');
    const tick = async () => {
      if (stopped) return;
      if (!url) {
        ctx.engine.setLink(agent.id, false, 'No status URL configured.', 'http poll');
        return;
      }
      try {
        const headers: Record<string, string> = { accept: 'application/json' };
        if (agent.secretRef) {
          const s = await ctx.secrets.get(agent.secretRef);
          if (s) headers.authorization = `Bearer ${s}`;
        }
        const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        ctx.engine.setLink(agent.id, true, `Status endpoint answered ${res.status}`, 'http poll');
        let body: Record<string, unknown> | null = null;
        try {
          body = (await res.json()) as Record<string, unknown>;
        } catch {
          /* non-JSON body is fine */
        }
        const state = str(body?.state)?.toUpperCase();
        const task = str(body?.task) ?? null;
        if (task && task !== lastTask) ctx.engine.apply({ agentId: agent.id, type: 'task.started', title: task, detail: str(body?.activity) ?? null, source: 'http poll' });
        if (!task && lastTask) ctx.engine.apply({ agentId: agent.id, type: 'task.completed', title: `Finished ${lastTask}`, source: 'http poll' });
        lastTask = task;
        if (state && PUSH_STATES.includes(state))
          ctx.engine.apply({ agentId: agent.id, type: 'agent.heartbeat', title: 'Status', state: state as NormalizedEvent['state'], source: 'http poll', ephemeral: true, data: { state, message: body?.message } });
        if (str(body?.message)) ctx.engine.apply({ agentId: agent.id, type: 'agent.status', title: 'Status message', source: 'http poll', ephemeral: true, data: { message: body!.message } });
      } catch (e) {
        lastTask = null;
        ctx.engine.setLink(agent.id, false, `Status check failed: ${(e as Error).message}`, 'http poll');
      }
    };
    void tick();
    const t = setInterval(tick, interval);
    return {
      stop() {
        stopped = true;
        clearInterval(t);
      },
    };
  },
  async test(agent) {
    const url = String(agent.settings.url || '');
    if (!url) return { ok: false, message: 'Set a status URL first.' };
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      return { ok: res.ok, message: `${url} answered HTTP ${res.status}.` };
    } catch (e) {
      return { ok: false, message: `Can't reach ${url}: ${(e as Error).message}` };
    }
  },
};

// ---------------------------------------------------------------- WebSocket client

const websocket: Adapter = {
  kind: 'websocket',
  label: 'WebSocket stream',
  summary: 'The hub connects to your agent\'s WebSocket and reads JSON events in the village event format.',
  usesSecret: true,
  capabilities: [
    { key: 'presence', label: 'Socket connected', level: 'live' },
    { key: 'activity', label: 'Activity', level: 'live', note: 'Whatever the stream sends.' },
  ],
  fields: [{ key: 'url', label: 'WebSocket URL', type: 'url', placeholder: 'ws://127.0.0.1:8765/events' }],
  docs: (a, ctx) => `## Message format
Each message is one JSON event, the same shape as HTTP push:
\`\`\`
{ "type": "tool.started", "title": "Crawling docs", "state": "WORKING" }
\`\`\`
If a secret is set, it is appended as \`?token=<secret>\`.

${pushDocs(a, ctx).split('## Event types')[1] ? '## Event types' + pushDocs(a, ctx).split('## Event types')[1] : ''}`,
  connect(agent, ctx) {
    let stopped = false;
    let ws: WebSocket | null = null;
    let backoff = 3000;
    const open = async () => {
      if (stopped) return;
      let url = String(agent.settings.url || '');
      if (!url) {
        ctx.engine.setLink(agent.id, false, 'No WebSocket URL configured.', 'websocket');
        return;
      }
      if (agent.secretRef) {
        const s = await ctx.secrets.get(agent.secretRef);
        if (s) url += (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(s);
      }
      try {
        ws = new WebSocket(url);
      } catch (e) {
        ctx.engine.setLink(agent.id, false, `Bad URL: ${(e as Error).message}`, 'websocket');
        return;
      }
      ws.onopen = () => {
        backoff = 3000;
        ctx.engine.setLink(agent.id, true, `Connected to ${agent.settings.url}`, 'websocket');
      };
      ws.onmessage = (m) => {
        try {
          for (const e of genericEvents(agent, JSON.parse(String(m.data)), 'websocket')) ctx.engine.apply(e);
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => {
        if (stopped) return;
        ctx.engine.setLink(agent.id, false, `Socket closed; retrying in ${Math.round(backoff / 1000)}s`, 'websocket');
        setTimeout(open, backoff);
        backoff = Math.min(backoff * 2, 60_000);
      };
      ws.onerror = () => {};
    };
    void open();
    return {
      stop() {
        stopped = true;
        ws?.close();
      },
    };
  },
  test: async (agent, ctx) => {
    const l = ctx.engine.live(agent.id);
    return l.connection === 'connected' ? { ok: true, message: 'Socket is connected.' } : { ok: false, message: l.connectionDetail };
  },
};

// ---------------------------------------------------------------- MCP (agent self-reporting)

const mcp: Adapter = {
  kind: 'mcp',
  label: 'MCP self-reporting',
  summary: 'Adds the village as an MCP server. MCP-capable agents get a `village_report` tool and report their own status. These reports are self-reported and labeled that way.',
  usesSecret: false,
  capabilities: [
    { key: 'activity', label: 'Self-reported status', level: 'partial', note: 'Only as accurate as the agent\'s own reports.' },
    { key: 'presence', label: 'Presence', level: 'none' },
  ],
  fields: [],
  docs: (a, ctx) => `## Connect
Add an MCP server (Streamable HTTP) to your agent:
\`\`\`
URL: ${ctx.hubUrl}/mcp?agent=${a.id}
Authorization: Bearer <ingest token>   (not needed from this PC)
\`\`\`
For Claude Code: \`claude mcp add --transport http ai-village "${ctx.hubUrl}/mcp?agent=${a.id}"\`

The agent gets one tool, \`village_report(status, task?, activity?)\`. Ask it to call the tool when it starts, waits, or finishes work. The village labels these events "self-reported".`,
  test: lastEventTest,
};

// ---------------------------------------------------------------- provider only

const providerOnly: Adapter = {
  kind: 'provider-only',
  label: 'Provider availability only',
  summary: 'Checks whether the provider\'s service is up (public status page, or a key check if you allow it). This cannot see what any agent is doing.',
  usesSecret: true,
  capabilities: [
    { key: 'provider', label: 'Provider availability', level: 'live' },
    { key: 'activity', label: 'Agent activity', level: 'none', note: 'Provider APIs do not expose your sessions on consumer plans.' },
  ],
  fields: [{ key: 'validateKey', label: 'Also validate the stored API key against the provider', type: 'boolean', default: false }],
  docs: () => `## What this shows
Only whether the provider is reachable and, optionally, whether your stored key is accepted. The character stays UNKNOWN because no activity signal exists.

To see real activity, use an agent runtime integration (Claude Code hooks, Gemini CLI hooks, Codex notify, OpenCode server) or report from your own code (HTTP push).`,
};

export const ADAPTERS: Record<IntegrationKind, Adapter> = {
  'claude-code': claudeCode,
  'gemini-cli': geminiCli,
  codex,
  opencode,
  'http-push': httpPush,
  'http-poll': httpPoll,
  websocket,
  mcp,
  'provider-only': providerOnly,
};

export function integrationInfo(agent: AgentConfig, ctx: AdapterContext): IntegrationInfo {
  const a = ADAPTERS[agent.integration];
  return { kind: a.kind, label: a.label, summary: a.summary, capabilities: a.capabilities, fields: a.fields, docs: a.docs(agent, ctx), usesSecret: a.usesSecret };
}
