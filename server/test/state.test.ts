import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../db.ts';
import { StateEngine } from '../state.ts';
import { ADAPTERS, type AdapterContext } from '../adapters.ts';
import { defaultAgents } from '../defaults.ts';
import type { AgentConfig } from '../../shared/types.ts';

function setup() {
  const store = new Store(join(mkdtempSync(join(tmpdir(), 'av-')), 'test.db'));
  const agents: AgentConfig[] = defaultAgents(() => false).map((a) => ({ ...a, createdAt: 0, hasIngestToken: false }));
  const engine = new StateEngine({ demo: false, store, getAgents: () => agents, getSessionTimeoutMs: () => 60_000, onEvent: () => {}, onLive: () => {} });
  const ctx = { engine, captureDetails: () => true, promptPreviews: () => false } as unknown as AdapterContext;
  const claude = agents.find((a) => a.id === 'claude')!;
  const feed = (p: Record<string, unknown>) => ADAPTERS['claude-code'].ingest!(claude, { session_id: 's1', cwd: '/x/proj', ...p }, ctx).forEach((e) => engine.apply(e));
  return { store, engine, feed };
}

test('an agent that never reported is UNKNOWN, not idle or online', () => {
  const { engine } = setup();
  const l = engine.live('claude');
  assert.equal(l.state, 'UNKNOWN');
  assert.equal(l.connection, 'never-seen');
});

test('Claude Code hook lifecycle maps to real states and a recorded task', () => {
  const { engine, feed, store } = setup();
  feed({ hook_event_name: 'SessionStart' });
  assert.equal(engine.live('claude').state, 'ONLINE');
  feed({ hook_event_name: 'UserPromptSubmit', prompt_preview: 'secret words' });
  assert.equal(engine.live('claude').state, 'THINKING');
  assert.equal(engine.live('claude').currentTask?.title, 'Request in proj', 'prompt text stays out unless previews are on');
  feed({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: '/x/proj/a.ts' } });
  assert.equal(engine.live('claude').state, 'WORKING');
  assert.equal(engine.live('claude').activity, 'Editing a.ts');
  feed({ hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Allow Bash?' });
  assert.equal(engine.live('claude').state, 'WAITING');
  feed({ hook_event_name: 'Stop', tokens: { in: 100, cached: 5000, out: 20 } });
  assert.equal(engine.live('claude').state, 'COMPLETED');
  const [task] = store.listTasks('claude', false);
  assert.equal(task.status, 'completed');
  assert.equal(task.tokensOut, 20);
  assert.equal(task.tokensIn, 100, 'cache reads are not counted as fresh input');
  assert.equal(task.tokensCached, 5000);
  feed({ hook_event_name: 'SessionEnd' });
  assert.equal(engine.live('claude').state, 'OFFLINE');
});

test('quiet sessions expire after the timeout instead of staying "working" forever', () => {
  const { engine, feed } = setup();
  feed({ hook_event_name: 'UserPromptSubmit' });
  engine.sweep(Date.now() + 61_000);
  assert.equal(engine.live('claude').state, 'OFFLINE');
});

test('linked integrations are OFFLINE when their transport is down', () => {
  const { engine } = setup();
  engine.setLink('opencode', false, 'refused', 'test');
  assert.equal(engine.live('opencode').state, 'OFFLINE');
  engine.setLink('opencode', true, 'ok', 'test');
  assert.equal(engine.live('opencode').state, 'IDLE');
});
