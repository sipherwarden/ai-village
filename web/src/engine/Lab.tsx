// Character lab (?lab=characters): renders the mascot family under the production lighting rig so
// silhouettes, materials, faces and every state can be inspected and screenshotted in isolation.
// It shows no agent data and makes no API calls.

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer, OrbitControls } from '@react-three/drei';
import { Bloom, EffectComposer, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import type { Accessory, AgentState, Archetype } from '../../../shared/types.ts';
import { ACCESSORY_IDS, EMOTE_IDS, type Emote } from '../../../shared/cosmetics.ts';
import { Creature, IDENTITY } from './creature.ts';
import { materials } from './materials.ts';

const ARCHETYPES: { id: Archetype; name: string; color: string }[] = [
  { id: 'explorer', name: 'Gemini', color: IDENTITY.explorer.primary },
  { id: 'scholar', name: 'Claude', color: IDENTITY.scholar.primary },
  { id: 'host', name: 'ChatGPT', color: IDENTITY.host.primary },
  { id: 'builder', name: 'OpenCode', color: IDENTITY.builder.primary },
  { id: 'sprite', name: 'Custom', color: '#38BDF8' },
  { id: 'sentinel', name: 'Sentinel', color: IDENTITY.sentinel.primary },
  { id: 'alchemist', name: 'Alchemist', color: IDENTITY.alchemist.primary },
  { id: 'conductor', name: 'Conductor', color: IDENTITY.conductor.primary },
  { id: 'wisp', name: 'Wisp', color: IDENTITY.wisp.primary },
];
const TONE: Record<string, ToneMappingMode> = { aces: ToneMappingMode.ACES_FILMIC, agx: ToneMappingMode.AGX, neutral: ToneMappingMode.NEUTRAL };
const STATES: AgentState[] = ['IDLE', 'WORKING', 'THINKING', 'WAITING', 'COMPLETED', 'ERROR', 'OFFLINE', 'UNKNOWN', 'ONLINE'];

function labelTexture(text: string) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.font = '600 30px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#cbd5e1';
  ctx.fillText(text.split('').join(String.fromCharCode(8202)), 256, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function Label({ text }: { text: string }) {
  const tex = useMemo(() => labelTexture(text), [text]);
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <sprite position={[0, 0.12, 0.95]} scale={[1.6, 0.2, 1]} renderOrder={10}>
      <spriteMaterial map={tex} transparent depthWrite={false} depthTest={false} opacity={0.85} />
    </sprite>
  );
}

function Actor({ archetype, color, state, position, focused, label, accessory, emote }: { archetype: Archetype; color: string; state: AgentState; position: [number, number, number]; focused?: boolean; label?: string; accessory?: Accessory; emote?: { kind: Emote; n: number } }) {
  const creature = useMemo(() => new Creature({ id: `${archetype}-${position.join(',')}`, archetype, color, accessory }), [archetype, color, position, accessory]);
  useEffect(() => {
    if (emote) creature.play(emote.kind);
  }, [creature, emote]);
  useEffect(() => () => creature.dispose(), [creature]);
  useEffect(() => creature.setState(state), [creature, state]);
  useEffect(() => creature.setFocused(!!focused), [creature, focused]);
  useFrame((s, dt) => creature.update(Math.min(dt, 0.05), s.clock.elapsedTime));
  return (
    <group position={position}>
      <primitive object={creature.group} />
      {label && <Label text={label} />}
    </group>
  );
}

function Stage({ radius }: { radius: number }) {
  const { m } = materials();
  const mat = useMemo(() => {
    const mm = m.paving.clone();
    mm.map = m.paving.map!.clone();
    mm.map.repeat.set(radius / 2, radius / 2);
    mm.map.needsUpdate = true;
    mm.color.set('#4b5569');
    return mm;
  }, [m, radius]);
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow material={mat}>
        <circleGeometry args={[radius, 96]} />
      </mesh>
      <mesh position-y={-0.2} material={m.basaltDark}>
        <cylinderGeometry args={[radius, radius * 0.96, 0.4, 96, 1, true]} />
      </mesh>
    </group>
  );
}

function Rig({ silhouette }: { silhouette: boolean }) {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    if (!silhouette) return;
    const white = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    scene.overrideMaterial = white;
    const bg = scene.background;
    scene.background = new THREE.Color('#000000');
    return () => {
      scene.overrideMaterial = null;
      scene.background = bg;
      white.dispose();
    };
  }, [scene, silhouette]);
  return (
    <>
      <color attach="background" args={['#060914']} />
      <fog attach="fog" args={['#060914', 16, 34]} />
      <hemisphereLight args={['#34416b', '#07080f', 0.55]} />
      {/* moon key */}
      <directionalLight
        position={[-5, 9, 6]}
        color="#93C5FD"
        intensity={1.6}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={8}
        shadow-camera-bottom={-8}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
      {/* back rim */}
      <directionalLight position={[3, 5, -7]} color="#a5b4fc" intensity={2.2} />
      {/* tungsten fill */}
      <pointLight position={[3.5, 3, 4]} color="#FBBF24" intensity={9} distance={14} decay={1.6} />
      {/* canal bounce */}
      <pointLight position={[0, 0.25, 3.2]} color="#06B6D4" intensity={3} distance={6} decay={1.8} />
      <Environment resolution={256} frames={1} environmentIntensity={0.5}>
        <color attach="background" args={['#04060d']} />
        <Lightformer form="rect" intensity={3} color="#a9c4ff" position={[-5, 5, 4]} scale={[7, 4, 1]} target={[0, 0, 0]} />
        <Lightformer form="rect" intensity={2} color="#ffcf8a" position={[6, 2.5, 4]} scale={[4, 3, 1]} target={[0, 0, 0]} />
        <Lightformer form="circle" intensity={1.4} color="#7ff0ff" position={[0, 3, -7]} scale={4} target={[0, 0, 0]} />
        <Lightformer form="rect" intensity={0.9} color="#ffffff" position={[0, 9, 0]} rotation-x={Math.PI / 2} scale={[12, 12, 1]} />
      </Environment>
    </>
  );
}

function Stats({ onStats }: { onStats: (s: string) => void }) {
  const gl = useThree((s) => s.gl);
  const acc = useRef({ t: 0, n: 0 });
  useEffect(() => {
    gl.info.autoReset = false;
  }, [gl]);
  useFrame((_, dt) => {
    const calls = gl.info.render.calls;
    const tris = gl.info.render.triangles;
    gl.info.reset();
    acc.current.t += dt;
    acc.current.n++;
    if (acc.current.t > 0.5) {
      onStats(`${Math.round(acc.current.n / acc.current.t)} fps · ${calls} calls · ${(tris / 1000).toFixed(0)}k tris`);
      acc.current = { t: 0, n: 0 };
    }
  });
  return null;
}

export function Lab() {
  const params = new URLSearchParams(location.search);
  const [view, setView] = useState<'lineup' | 'states' | 'portrait'>((params.get('view') as 'lineup' | 'states' | 'portrait') ?? 'lineup');
  const [arch, setArch] = useState<Archetype>((params.get('arch') as Archetype) ?? 'explorer');
  const [state, setState] = useState<AgentState>((params.get('state') as AgentState) ?? 'IDLE');
  const [silhouette, setSilhouette] = useState(params.get('silhouette') === '1');
  const [focus, setFocus] = useState(false);
  const [accessory, setAccessory] = useState<Accessory>((params.get('acc') as Accessory) ?? 'none');
  const [emote, setEmote] = useState<{ kind: Emote; n: number } | undefined>();
  const [stats, setStats] = useState('');

  const actors = useMemo(() => {
    if (view === 'lineup') {
      return ARCHETYPES.map((a, i) => ({ key: a.id, archetype: a.id, color: a.color, state, position: [(i - 4) * 1.55, 0, i % 2 ? -0.6 : 0.4] as [number, number, number], label: a.name.toUpperCase() }));
    }
    const a = ARCHETYPES.find((x) => x.id === arch)!;
    if (view === 'portrait') return [{ key: a.id, archetype: a.id, color: a.color, state, position: [0, 0, 0] as [number, number, number], label: '' }];
    return STATES.map((s, i) => ({ key: s, archetype: a.id, color: a.color, state: s, position: [((i % 3) - 1) * 2.2, 0, (Math.floor(i / 3) - 1) * 2.3] as [number, number, number], label: s }));
  }, [view, arch, state]);

  const camera =
    view === 'lineup'
      ? { position: [0, 3.4, 17] as [number, number, number], fov: 28 }
      : view === 'portrait'
        ? { position: [1.2, 1.7, 4.6] as [number, number, number], fov: 28 }
        : { position: [0, 8.5, 12.5] as [number, number, number], fov: 28 };
  const btn = (on: boolean): React.CSSProperties => ({
    font: '600 12px/1 Inter, system-ui',
    padding: '7px 10px',
    borderRadius: 999,
    border: '1px solid rgba(255,255,255,0.1)',
    background: on ? 'rgba(125,211,252,0.18)' : 'rgba(10,15,29,0.78)',
    color: on ? '#e0f2fe' : '#94a3b8',
    cursor: 'pointer',
  });

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#060914' }}>
      <Canvas key={view} shadows="percentage" dpr={[1, 2]} camera={camera} gl={{ antialias: false, powerPreference: 'high-performance' }}>
        <Rig silhouette={silhouette} />
        {!silhouette && <Stage radius={view === 'lineup' ? 8.5 : 5} />}
        {actors.map((a) => (
          <Actor key={a.key} archetype={a.archetype} color={a.color} state={a.state} position={a.position} label={silhouette ? undefined : a.label} focused={focus} accessory={accessory} emote={emote} />
        ))}
        <OrbitControls target={[0, view === 'lineup' ? 0.85 : view === 'portrait' ? 0.95 : 0.4, 0]} enableDamping makeDefault />
        {!silhouette && (
          <EffectComposer multisampling={4}>
            <Bloom luminanceThreshold={0.82} luminanceSmoothing={0.2} intensity={0.55} mipmapBlur radius={0.7} />
            <Vignette offset={0.3} darkness={0.55} />
            <ToneMapping mode={TONE[params.get('tm') ?? 'aces'] ?? ToneMappingMode.ACES_FILMIC} />
          </EffectComposer>
        )}
        <Stats onStats={setStats} />
      </Canvas>
      <div style={{ position: 'fixed', top: 12, left: 12, right: 12, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <span style={{ font: '700 12px/1 Inter, system-ui', letterSpacing: '0.14em', color: '#e2e8f0', marginRight: 8 }}>CHARACTER LAB</span>
        <button style={btn(view === 'lineup')} onClick={() => setView('lineup')}>Lineup</button>
        <button style={btn(view === 'states')} onClick={() => setView('states')}>State matrix</button>
        <button style={btn(view === 'portrait')} onClick={() => setView('portrait')}>Close-up</button>
        <span style={{ width: 10 }} />
        {view !== 'lineup' &&
          ARCHETYPES.map((a) => (
            <button key={a.id} style={btn(arch === a.id)} onClick={() => setArch(a.id)}>{a.name}</button>
          ))}
        {view !== 'states' &&
          STATES.map((s) => (
            <button key={s} style={btn(state === s)} onClick={() => setState(s)}>{s.toLowerCase()}</button>
          ))}
        <span style={{ width: 10 }} />
        <button style={btn(silhouette)} onClick={() => setSilhouette((v) => !v)}>Silhouette test</button>
        <button style={btn(focus)} onClick={() => setFocus((v) => !v)}>Select</button>
        <select value={accessory} onChange={(e) => setAccessory(e.target.value as Accessory)} style={btn(accessory !== 'none')} aria-label="Accessory">
          {ACCESSORY_IDS.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <span style={{ flexBasis: '100%' }} />
        {EMOTE_IDS.map((e) => (
          <button key={e} style={btn(emote?.kind === e)} onClick={() => setEmote({ kind: e, n: Date.now() })}>{e}</button>
        ))}
        <span style={{ marginLeft: 'auto', font: '500 11px/1 "JetBrains Mono", monospace', color: '#64748b' }}>{stats}</span>
      </div>
    </div>
  );
}
