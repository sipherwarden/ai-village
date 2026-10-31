// Speech bubble text. Every bubble is generated from a real event or a real live-state fact;
// personality only changes the phrasing, never the facts.

import type { AgentConfig, AgentLive, VillageEvent, VoiceStyle } from '../../../shared/types.ts';
import { duration, taskPhrase } from './format.ts';

export type BubbleKind = 'start' | 'done' | 'wait' | 'error' | 'research' | 'code' | 'file' | 'hello' | 'bye' | 'link' | 'unlink' | 'handoff' | 'info';

export interface BubbleText {
  text: string;
  kind: BubbleKind;
}

const VOICE: Record<VoiceStyle, { start: string; done: string; wait: string; error: string }> = {
  curious: { start: 'Exploring', done: 'Finished exploring', wait: 'Quick question for you', error: 'Hmm, something broke' },
  calm: { start: 'Working on', done: 'Finished', wait: 'Ready when you are', error: 'Something went wrong' },
  chatty: { start: 'On it! Working on', done: 'All done with', wait: 'Hey, I need you for a sec', error: 'Oops, I hit a snag' },
  determined: { start: 'Building', done: 'Shipped', wait: 'Blocked on your approval', error: 'Error, investigating' },
  neutral: { start: 'Working on', done: 'Finished', wait: 'Waiting for your input', error: 'Error' },
};

const short = (s: string, n = 56) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export function bubbleForEvent(e: VillageEvent, agent: AgentConfig, agents: AgentConfig[]): BubbleText | null {
  const v = VOICE[agent.voice] ?? VOICE.neutral;
  switch (e.type) {
    case 'task.started':
      return { kind: 'start', text: `${v.start} ${short(taskPhrase(e.title), 46)}…` };
    case 'task.completed': {
      const task = typeof e.data?.task === 'string' ? taskPhrase(e.data.task) : null;
      const ms = typeof e.data?.durationMs === 'number' ? ` in ${duration(e.data.durationMs)}` : '';
      return { kind: 'done', text: task ? `${v.done} ${short(task, 40)}${ms}.` : `${v.done}${ms}.` };
    }
    case 'task.failed':
    case 'agent.error':
      return { kind: 'error', text: `${v.error}: ${short(e.detail ?? e.title, 44)}` };
    case 'agent.waiting':
      return { kind: 'wait', text: `${v.wait}: ${short(e.title, 44)}` };
    case 'session.started':
      return { kind: 'hello', text: agent.voice === 'chatty' ? 'Hi! New session started.' : 'New session started.' };
    case 'session.ended':
      return { kind: 'bye', text: 'Session closed.' };
    case 'research.started':
      return { kind: 'research', text: short(e.title) };
    case 'research.completed':
      return { kind: 'research', text: 'Finished the research.' };
    case 'code.started':
      return { kind: 'code', text: short(e.title) };
    case 'file.created':
    case 'file.edited':
      return { kind: 'file', text: short(e.title) };
    case 'agent.connected':
      return { kind: 'link', text: 'Connected.' };
    case 'agent.disconnected':
      return {
        kind: 'unlink',
        text: ['opencode', 'websocket', 'http-poll'].includes(agent.integration) ? 'Connection lost. Trying to reconnect.' : 'Heartbeat lost.',
      };
    case 'handoff': {
      const to = agents.find((a) => a.id === e.data?.to);
      const task = typeof e.data?.task === 'string' ? e.data.task : null;
      return { kind: 'handoff', text: to ? `${to.name}, over to you${task ? `: ${short(task, 36)}` : ''}.` : short(e.title) };
    }
    default:
      return null;
  }
}

/** Ambient bubbles: only restate true, current facts. */
export function ambientBubble(agent: AgentConfig, live: AgentLive, now = Date.now()): BubbleText | null {
  switch (live.state) {
    case 'IDLE':
    case 'ONLINE':
      return { kind: 'info', text: live.lastEventAt && now - live.lastEventAt > 5 * 60_000 ? `Idle for ${duration(now - live.lastEventAt)}. Waiting for your next assignment.` : 'Waiting for your next assignment.' };
    case 'WORKING':
    case 'THINKING':
      return live.currentTask
        ? { kind: 'start', text: `Still on ${short(taskPhrase(live.currentTask.title), 40)} (${duration(now - live.currentTask.startedAt)})` }
        : live.activity
          ? { kind: 'start', text: short(live.activity) }
          : null;
    case 'WAITING':
      return { kind: 'wait', text: `Waiting on you for ${duration(now - live.stateSince)}.` };
    case 'OFFLINE':
      return live.connection === 'disabled' ? { kind: 'info', text: 'Monitoring is paused for me.' } : null;
    case 'UNKNOWN':
      return { kind: 'info', text: live.connection === 'not-observable' ? 'My activity isn’t visible to the village.' : 'No signal from my runtime yet.' };
    case 'ERROR':
      return { kind: 'error', text: 'Still stuck on an error.' };
    default:
      return null;
  }
}
