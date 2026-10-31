// World lab (?lab=world): the full village with a fixed simulated cast, for composing and
// screenshotting the scene. Clearly simulated, never connected to agent data.

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer, OrbitControls } from '@react-three/drei';
import { Bloom, EffectComposer, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import type { AgentState, Archetype } from '../../../shared/types.ts';
import { IDENTITY } from './creature.ts';
import { VillageRuntime } from './runtime.ts';
import type { TimeOfDay } from './world.ts';

const CAST: { id: string; archetype: Archetype; color: string; state: AgentState }[] = [
  { id: 'gemini', archetype: 'explorer', color: IDENTITY.explorer.primary, state: 'WORKING' },
  { id: 'claude', archetype: 'scholar', color: IDENTITY.scholar.primary, state: 'THINKING' },
  { id: 'chatgpt', archetype: 'host', color: IDENTITY.host.primary, state: 'IDLE' },
  { id: 'opencode', archetype: 'builder', color: IDENTITY.builder.primary, state: 'WORKING' },
  { id: 'aegis', archetype: 'sprite', color: '#F43F5E', state: 'WAITING' },
  { id: 'prism', archetype: 'sprite', color: '#06B6D4', state: 'OFFLINE' },
];

function Village({ tod }: { tod: TimeOfDay }) {
  const scene = useThree((s) => s.scene);
  const [rt, setRt] = useState<VillageRuntime | null>(null);
  useEffect(() => {
    const r = new VillageRuntime({ shadows: 'high', particles: true });
    r.sync(CAST);
    setRt(r);
    return () => r.dispose();
  }, []);
  useEffect(() => {
    if (!rt) return;
    scene.fog = rt.world.fog;
    return () => {
      scene.fog = null;
    };
  }, [scene, rt]);
  useEffect(() => rt?.world.setTimeOfDay(tod), [rt, tod]);
  const last = useRef(0);
  useFrame((s, dt) => {
    if (!rt) return;
    const t = s.clock.elapsedTime;
    rt.update(Math.min(dt, 0.05), t);
    // simulated handoff every few seconds: Claude → OpenCode → Gemini → Claude
    if (t - last.current > 6) {
      last.current = t;
      const pairs = [['claude', 'opencode'], ['opencode', 'gemini'], ['gemini', 'claude']];
      const [from, to] = pairs[Math.floor(t / 6) % 3];
      rt.handoff(from, to);
    }
  });
  return rt ? <primitive object={rt.world.root} /> : null;
}

function Reflections() {
  return (
    <Environment resolution={256} frames={1} environmentIntensity={0.45}>
      <color attach="background" args={['#04060d']} />
      <Lightformer form="rect" intensity={3} color="#a9c4ff" position={[-5, 5, 4]} scale={[7, 4, 1]} target={[0, 0, 0]} />
      <Lightformer form="rect" intensity={2} color="#ffcf8a" position={[6, 2.5, 4]} scale={[4, 3, 1]} target={[0, 0, 0]} />
      <Lightformer form="circle" intensity={1.4} color="#7ff0ff" position={[0, 3, -7]} scale={4} target={[0, 0, 0]} />
      <Lightformer form="rect" intensity={0.9} color="#ffffff" position={[0, 9, 0]} rotation-x={Math.PI / 2} scale={[12, 12, 1]} />
    </Environment>
  );
}

export function WorldLab() {
  const params = new URLSearchParams(location.search);
  const [tod, setTod] = useState<TimeOfDay>((params.get('tod') as TimeOfDay) ?? 'night');
  const D = Number(params.get('d') ?? 36);
  const pitch = THREE.MathUtils.degToRad(Number(params.get('pitch') ?? 30));
  const target: [number, number, number] = [0, 0.2, 0.6];
  const pos: [number, number, number] = [target[0], target[1] + Math.sin(pitch) * D, target[2] + Math.cos(pitch) * D];
  const btn = (on: boolean): React.CSSProperties => ({ font: '600 12px/1 Inter, system-ui', padding: '7px 10px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.1)', background: on ? 'rgba(125,211,252,0.18)' : 'rgba(10,15,29,0.78)', color: on ? '#e0f2fe' : '#94a3b8', cursor: 'pointer' });
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#060914' }}>
      <Canvas shadows="percentage" dpr={[1, 2]} camera={{ fov: 28, position: pos, near: 1, far: 400 }} gl={{ antialias: false, powerPreference: 'high-performance' }}>
        <Village tod={tod} />
        <Reflections />
        <OrbitControls target={target} enableDamping makeDefault />
        <EffectComposer multisampling={4}>
          <Bloom luminanceThreshold={0.82} luminanceSmoothing={0.2} intensity={0.7} mipmapBlur radius={0.72} />
          <Vignette offset={0.32} darkness={0.6} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
      </Canvas>
      <div style={{ position: 'fixed', top: 12, left: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
        <span style={{ font: '700 12px/1 Inter, system-ui', letterSpacing: '0.14em', color: '#e2e8f0', marginRight: 8 }}>WORLD LAB · SIMULATED CAST</span>
        {(['night', 'dusk', 'dawn', 'day'] as TimeOfDay[]).map((t) => (
          <button key={t} style={btn(tod === t)} onClick={() => setTod(t)}>{t}</button>
        ))}
      </div>
    </div>
  );
}
