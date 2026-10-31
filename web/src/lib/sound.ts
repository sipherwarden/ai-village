// Tiny synthesized sound effects (no audio files). Each agent gets its own pitch.

let ctx: AudioContext | null = null;

function audio() {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** Call from a user gesture so iPad Safari allows playback later. */
export function unlockAudio() {
  audio();
}

function tone(freq: number, start: number, len: number, type: OscillatorType = 'sine', gain = 0.08) {
  const a = audio();
  if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, a.currentTime + start);
  g.gain.linearRampToValueAtTime(gain, a.currentTime + start + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + start + len);
  o.connect(g).connect(a.destination);
  o.start(a.currentTime + start);
  o.stop(a.currentTime + start + len + 0.05);
}

export function pitchFor(agentId: string) {
  let h = 0;
  for (const c of agentId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return [392, 440, 494, 523, 587, 659][h % 6];
}

export const sfx = {
  completed(agentId: string) {
    const p = pitchFor(agentId);
    tone(p, 0, 0.18);
    tone(p * 1.5, 0.12, 0.28);
  },
  waiting(agentId: string) {
    const p = pitchFor(agentId);
    tone(p * 2, 0, 0.12, 'triangle', 0.05);
    tone(p * 2, 0.22, 0.12, 'triangle', 0.05);
  },
  error() {
    tone(180, 0, 0.3, 'sawtooth', 0.04);
    tone(140, 0.15, 0.35, 'sawtooth', 0.04);
  },
  started(agentId: string) {
    tone(pitchFor(agentId) * 1.25, 0, 0.09, 'sine', 0.035);
  },
};
