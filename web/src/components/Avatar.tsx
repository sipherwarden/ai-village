import { useEffect, useMemo, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import type { AgentConfig, AgentState, Appearance, VoiceStyle } from '../../../shared/types.ts';
import { archetypeOf, extraAccessory } from '../lib/archetype.ts';
import { portrait } from '../engine/portrait.ts';
import { Creature } from '../engine/creature.ts';

/** The character as a still image, rendered from its 3D rig (drop-in for the old SVG character). */
export function Portrait({
  color,
  appearance,
  voice,
  state,
  size,
  framing = 'full',
  round = false,
}: {
  color: string;
  appearance: Appearance;
  voice: VoiceStyle;
  state?: AgentState;
  size: number;
  framing?: 'head' | 'full';
  round?: boolean;
  /** Accepted for compatibility with the old SVG character; portraits are still images. */
  seed?: number;
  still?: boolean;
}) {
  const archetype = archetypeOf(appearance, voice);
  const accessory = extraAccessory(appearance, voice);
  const url = useMemo(() => portrait({ archetype, color, accessory, state, framing }), [archetype, color, accessory, state, framing]);
  const style = round ? { width: size, height: size, background: `radial-gradient(circle at 50% 30%, color-mix(in srgb, ${color} 40%, #0b1020), #070a14 72%)` } : { width: size, height: size };
  if (!url) return <span className={round ? 'avatar' : 'portrait'} style={{ ...style, background: color }} aria-hidden />;
  return <img src={url} width={size} height={size} alt="" draggable={false} className={round ? 'avatar' : 'portrait'} style={style} />;
}

/** Round head-and-shoulders chip for lists, the feed and the ticker. */
export function AgentAvatar({ agent, size = 30, state }: { agent: AgentConfig; size?: number; state?: AgentState }) {
  return <Portrait color={agent.color} appearance={agent.appearance} voice={agent.voice} state={state} size={size} framing="head" round />;
}

/** The agent's character, alive: blinking, breathing and acting out its real state. */
export function LivePortrait({ agent, state, height = 220 }: { agent: AgentConfig; state: AgentState; height?: number }) {
  return (
    <div className="live-portrait" style={{ height, ['--agent' as string]: agent.color }}>
      <Canvas dpr={[1, 2]} gl={{ alpha: true, antialias: true, powerPreference: 'low-power' }} camera={{ fov: 24, near: 0.1, far: 60, position: [1.4, 2.0, 6.2] }} aria-hidden>
        <hemisphereLight args={['#c7d4ff', '#1a1d2a', 0.9]} />
        <directionalLight position={[-2, 3, 4]} intensity={2.2} color="#e3ecff" />
        <directionalLight position={[3, 2, -3]} intensity={2.2} color="#a5b4fc" />
        <pointLight position={[2, 1.2, 2.5]} intensity={3} distance={8} decay={1.6} color="#fbbf24" />
        <Environment resolution={128} frames={1} environmentIntensity={0.4}>
          <Lightformer form="rect" intensity={3} color="#a9c4ff" position={[-5, 5, 4]} scale={[7, 4, 1]} target={[0, 0, 0]} />
          <Lightformer form="rect" intensity={2} color="#ffcf8a" position={[6, 2.5, 4]} scale={[4, 3, 1]} target={[0, 0, 0]} />
        </Environment>
        <Rig agent={agent} state={state} />
      </Canvas>
    </div>
  );
}

function Rig({ agent, state }: { agent: AgentConfig; state: AgentState }) {
  const camera = useThree((s) => s.camera);
  const archetype = archetypeOf(agent.appearance, agent.voice);
  const accessory = extraAccessory(agent.appearance, agent.voice);
  const [c, setC] = useState<Creature | null>(null);
  useEffect(() => {
    const cr = new Creature({ id: agent.id, archetype, color: agent.color, accessory });
    cr.setState(state, true);
    setC(cr);
    const h = cr.height;
    camera.position.set(1.3, h * 0.62 + 1.1, h * 2.6 + 1.6);
    camera.lookAt(0, h * 0.55, 0);
    return () => cr.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id, archetype, agent.color, accessory, camera]);
  useEffect(() => c?.setState(state), [c, state]);
  useFrame((s, dt) => {
    if (!c) return;
    c.update(Math.min(dt, 0.05), s.clock.elapsedTime);
    c.setFacing(Math.sin(s.clock.elapsedTime * 0.25) * 0.25 + 0.15);
  });
  return c ? <primitive object={c.group} /> : null;
}

