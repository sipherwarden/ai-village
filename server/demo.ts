// Demonstration mode. Everything here is simulated, is written with demo=1, and runs on a separate
// state engine, so it can never mix with real monitoring data. The UI shows a banner while it runs.

import type { AgentConfig } from '../shared/types.ts';
import type { NormalizedEvent, StateEngine } from './state.ts';

const TASKS = [
  'Research vector databases',
  'Refactor the auth module',
  'Draft release notes',
  'Fix flaky test in api/users',
  'Summarize customer feedback',
  'Build settings screen',
  'Compare hosting providers',
  'Migrate CSS to tokens',
];
const FILES = ['app.tsx', 'server.ts', 'README.md', 'auth.py', 'styles.css', 'schema.sql', 'notes.md'];
const SEARCHES = ['pgvector benchmarks', 'iPad Safari wake lock', 'SQLite WAL mode', 'WebSocket backoff'];

type Step = Omit<NormalizedEvent, 'agentId' | 'source'> & { wait: number };

function pick<T>(xs: T[]) {
  return xs[Math.floor(Math.random() * xs.length)];
}

function scenario(sessionId: string, label: string): Step[] {
  const task = pick(TASKS);
  const steps: Step[] = [
    { type: 'session.started', title: `Session started in ${label}`, sessionId, sessionLabel: label, wait: 2500 },
    { type: 'task.started', title: task, detail: 'Thinking about the request', sessionId, wait: 4000 },
  ];
  const n = 2 + Math.floor(Math.random() * 4);
  for (let i = 0; i < n; i++) {
    const r = Math.random();
    if (r < 0.3) {
      const q = pick(SEARCHES);
      steps.push({ type: 'research.started', title: `Researching: ${q}`, state: 'WORKING', sessionId, wait: 5000 });
      steps.push({ type: 'research.completed', title: `Research done: ${q}`, state: 'THINKING', sessionId, wait: 3000 });
    } else if (r < 0.65) {
      const f = pick(FILES);
      steps.push({ type: 'tool.started', title: `Editing ${f}`, state: 'WORKING', sessionId, ephemeral: true, wait: 4000 });
      steps.push({ type: 'file.edited', title: `Edited ${f}`, state: 'THINKING', sessionId, wait: 2500 });
    } else {
      steps.push({ type: 'code.started', title: 'Running the test suite', state: 'WORKING', sessionId, wait: 6000 });
      steps.push({ type: 'code.completed', title: 'Done: Running the test suite', state: 'THINKING', sessionId, wait: 2500 });
    }
  }
  const end = Math.random();
  if (end < 0.2) steps.push({ type: 'agent.waiting', title: 'Needs your OK to run a command', state: 'WAITING', sessionId, wait: 9000 });
  if (end > 0.92) {
    steps.push({ type: 'task.failed', title: 'Turn ended with an error', detail: 'Simulated rate limit', sessionId, wait: 8000 });
  } else {
    steps.push({ type: 'task.completed', title: 'Finished the request', sessionId, tokens: { in: 20000 + Math.floor(Math.random() * 90000), cached: 200000 + Math.floor(Math.random() * 900000), out: 800 + Math.floor(Math.random() * 6000) }, wait: 6000 });
  }
  if (Math.random() < 0.4) steps.push({ type: 'session.ended', title: `Session ended in ${label}`, sessionId, wait: 4000 });
  return steps;
}

export class DemoDriver {
  private timers: NodeJS.Timeout[] = [];
  private running = false;
  private engine: StateEngine;
  private getAgents: () => AgentConfig[];

  constructor(engine: StateEngine, getAgents: () => AgentConfig[]) {
    this.engine = engine;
    this.getAgents = getAgents;
  }

  start() {
    if (this.running) return;
    this.running = true;
    const agents = this.getAgents().filter((a) => a.enabled);
    agents.forEach((a, i) => this.loop(a.id, 800 + i * 1700));
    this.timers.push(setInterval(() => this.handoff(), 45_000));
  }

  stop() {
    this.running = false;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  private loop(agentId: string, delay: number) {
    const t = setTimeout(() => {
      if (!this.running) return;
      if (!this.getAgents().some((a) => a.id === agentId)) return;
      const steps = scenario(`demo-${Math.random().toString(36).slice(2, 8)}`, pick(['ai-village', 'website', 'research', 'api']));
      this.play(agentId, steps, 0);
    }, delay);
    this.timers.push(t);
  }

  private play(agentId: string, steps: Step[], i: number) {
    if (!this.running) return;
    if (i >= steps.length) {
      this.loop(agentId, 6000 + Math.random() * 20000);
      return;
    }
    const { wait, ...ev } = steps[i];
    this.engine.apply({ ...ev, agentId, source: 'demo' });
    const t = setTimeout(() => this.play(agentId, steps, i + 1), wait * (0.7 + Math.random() * 0.6));
    this.timers.push(t);
  }

  private handoff() {
    const agents = this.getAgents().filter((a) => a.enabled);
    if (agents.length < 2 || !this.running) return;
    const from = pick(agents);
    const to = pick(agents.filter((a) => a.id !== from.id));
    this.engine.apply({
      agentId: from.id,
      sessionId: null,
      type: 'handoff',
      title: `Handed "${pick(TASKS)}" to ${to.name}`,
      source: 'demo',
      data: { from: from.id, to: to.id },
    });
  }
}
