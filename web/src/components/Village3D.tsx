import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { CameraControls, Environment, Lightformer, PerformanceMonitor } from '@react-three/drei';
import { Bloom, EffectComposer, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import type { AgentConfig, AgentLive, AgentState } from '../../../shared/types.ts';
import { NO_AGENTS, NO_LIVE, store, useStore } from '../lib/store.ts';
import { archetypeOf, extraAccessory } from '../lib/archetype.ts';
import { bubbleForEvent } from '../lib/bubbles.ts';
import { STATE_LABEL } from '../lib/format.ts';
import { VillageRuntime, type AgentView } from '../engine/runtime.ts';
import { useLayout } from './ui.tsx';
import type { TimeOfDay } from '../engine/world.ts';
import type { Emote, Island } from '../../../shared/cosmetics.ts';

export type Quality = 'high' | 'balanced' | 'saver';
export interface Insets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const ACTIVE = new Set<AgentState>(['WORKING', 'THINKING', 'WAITING', 'ERROR']);
const PITCH = THREE.MathUtils.degToRad(30);
const FOV = 28;
/** Points that must stay in frame for the overview: island corners, spire tip, upper garden, waterfall. */
const FRAME_POINTS = [
  [-12.8, -0.8, 0],
  [12.8, -0.8, 0],
  [0, -1.1, 12.9],
  [0, 4.2, -11.2],
  [0, 5.6, -0.6],
  [0.6, -5.4, 0.8],
].map(([x, y, z]) => new THREE.Vector3(x, y, z));
/** On tall screens: just the four homes and the spire, so the village fills the width instead of shrinking. */
const HOME_POINTS = [
  [-9.4, 0.4, -1.2],
  [9.4, 0.4, -1.4],
  [0, 4.0, -9.4],
  [0, 5.6, -0.6],
  [0, 0, 5.2],
].map(([x, y, z]) => new THREE.Vector3(x, y, z));

/** Picks the camera distance and target that fit the island into the unobstructed part of the view. */
function overview(aspect: number, insets: Insets, w: number, h: number, tall: boolean) {
  const cam = new THREE.PerspectiveCamera(FOV, aspect, 0.5, 500);
  const free = { x0: insets.left / w, x1: 1 - insets.right / w, y0: insets.top / h, y1: 1 - insets.bottom / h };
  const points = tall ? HOME_POINTS : FRAME_POINTS;
  const target = tall ? new THREE.Vector3(0, 0.6, -1.6) : new THREE.Vector3(0, -0.4, 0.4);
  const dir = new THREE.Vector3(0, Math.sin(PITCH), Math.cos(PITCH));
  const fits = (d: number) => {
    cam.position.copy(target).addScaledVector(dir, d);
    cam.lookAt(target);
    cam.updateMatrixWorld();
    let x0 = 1;
    let x1 = 0;
    let y0 = 1;
    let y1 = 0;
    // phones crop the outer homes a little so the characters stay legible; two fingers pan
    const squeeze = aspect < 0.6 ? 0.78 : 1;
    for (const p0 of points) {
      const p = p0.clone();
      p.x *= squeeze;
      const q = p.project(cam);
      const sx = q.x * 0.5 + 0.5;
      const sy = -q.y * 0.5 + 0.5;
      x0 = Math.min(x0, sx);
      x1 = Math.max(x1, sx);
      y0 = Math.min(y0, sy);
      y1 = Math.max(y1, sy);
    }
    return { ok: x1 - x0 <= (free.x1 - free.x0) * 0.96 && y1 - y0 <= (free.y1 - free.y0) * 0.96, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  };
  let lo = 10;
  let hi = 120;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid).ok) hi = mid;
    else lo = mid;
  }
  return { distance: hi, target, dir };
}

interface Caption {
  text: string;
  until: number;
}

function viewOf(a: AgentConfig, live: AgentLive | undefined): AgentView {
  return {
    id: a.id,
    archetype: archetypeOf(a.appearance, a.voice),
    color: a.color,
    accessory: extraAccessory(a.appearance, a.voice),
    scale: a.appearance.scale,
    state: a.enabled ? (live?.state ?? 'UNKNOWN') : 'OFFLINE',
  };
}

export function Village3D({
  onSelect,
  selectedId,
  reduceMotion,
  period,
  insets,
  kiosk = false,
  quality,
  island = 'nocturne',
}: {
  onSelect: (id: string | null) => void;
  selectedId: string | null;
  reduceMotion: boolean;
  period: TimeOfDay;
  insets: Insets;
  kiosk?: boolean;
  quality: Quality;
  island?: Island;
}) {
  const agents = useStore((s) => s.snapshot?.agents ?? NO_AGENTS);
  const live = useStore((s) => s.snapshot?.live ?? NO_LIVE);
  const views = useMemo(() => agents.map((a) => viewOf(a, live[a.id])), [agents, live]);
  const badges = useRef(new Map<string, HTMLElement>());
  const [captions, setCaptions] = useState<Record<string, Caption>>({});
  const runtime = useRef<VillageRuntime | null>(null);
  const { phone } = useLayout();
  const [ready, setReady] = useState(false);
  const [dpr, setDpr] = useState(quality === 'high' ? 1.75 : quality === 'balanced' ? 1.4 : 1);

  // Captions and handoff packets come only from real events.
  useEffect(() => {
    const off = store.onEvent((e) => {
      const snap = store.get().snapshot;
      const agent = snap?.agents.find((a) => a.id === e.agentId);
      if (!agent || !snap) return;
      const b = bubbleForEvent(e, agent, snap.agents);
      if (b) setCaptions((c) => ({ ...c, [agent.id]: { text: b.text, until: Date.now() + 6500 } }));
      if (e.type === 'handoff' && typeof e.data?.to === 'string') {
        runtime.current?.handoff(agent.id, e.data.to);
        const task = typeof e.data.task === 'string' ? e.data.task : null;
        const to = e.data.to;
        setCaptions((c) => ({ ...c, [to]: { text: task ? `Assigned: ${task.slice(0, 48)}` : 'Assigned new work', until: Date.now() + 6500 } }));
      }
    });
    const t = setInterval(() => {
      const now = Date.now();
      setCaptions((c) => {
        let changed = false;
        const out: Record<string, Caption> = {};
        for (const [k, v] of Object.entries(c)) v.until > now ? (out[k] = v) : (changed = true);
        return changed ? out : c;
      });
    }, 1000);
    return () => {
      off();
      clearInterval(t);
    };
  }, []);

  const shadows = quality === 'saver' ? false : 'percentage';
  return (
    <div className={`scene3d ${kiosk ? 'kiosk' : ''}`}>
      <Canvas
        shadows={shadows}
        dpr={dpr}
        camera={{ fov: FOV, position: [0, 18, 32], near: 0.5, far: 500 }}
        gl={{ antialias: false, powerPreference: 'high-performance', alpha: false }}
        aria-label="Village view"
      >
        <PerformanceMonitor onDecline={() => setDpr((d) => Math.max(1, d - 0.25))} flipflops={3} />
        <Scene views={views} selectedId={selectedId} onSelect={onSelect} period={period} insets={insets} quality={quality} reduceMotion={reduceMotion} kiosk={kiosk} badges={badges} runtimeRef={runtime} onReady={() => setReady(true)} island={island} />
        <Reflections />
        <EffectComposer multisampling={quality === 'saver' ? 0 : 4} resolutionScale={quality === 'saver' ? 0.75 : 1}>
          <Bloom luminanceThreshold={0.82} luminanceSmoothing={0.2} intensity={kiosk ? 0.55 : 0.7} mipmapBlur radius={0.72} />
          <Vignette offset={0.32} darkness={kiosk ? 0.7 : 0.55} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
      </Canvas>

      <div className="village-loading" data-done={ready || undefined} role="status" aria-hidden={ready}>
        Building the village…
      </div>

      {/* micro-badges float over each home; positions are written every frame by the scene */}
      <div className={`badges ${phone ? 'compact' : ''}`} aria-label="Agents">
        {agents.map((a) => {
          const st: AgentState = a.enabled ? (live[a.id]?.state ?? 'UNKNOWN') : 'OFFLINE';
          const caption = captions[a.id]?.text ?? (ACTIVE.has(st) ? (live[a.id]?.activity ?? live[a.id]?.currentTask?.title ?? null) : null);
          const status = a.enabled ? STATE_LABEL[st] : 'Paused';
          return (
            <button
              key={a.id}
              ref={(el) => {
                if (el) badges.current.set(a.id, el);
                else badges.current.delete(a.id);
              }}
              className={`badge st-${st}`}
              data-selected={selectedId === a.id || undefined}
              onClick={() => onSelect(a.id)}
              aria-label={`${a.name}, ${status}${caption ? `, ${caption}` : ''}. Open details.`}
              aria-pressed={selectedId === a.id}
            >
              <span className="badge-pill">
                <span className="state-dot" />
                <span className="badge-name">{a.name}</span>
                <span className="badge-state">{status}</span>
              </span>
              {caption && !phone && <span className="badge-caption">{caption}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
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

function Scene({
  views,
  selectedId,
  onSelect,
  period,
  insets,
  quality,
  reduceMotion,
  kiosk,
  badges,
  runtimeRef,
  onReady,
  island,
}: {
  views: AgentView[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  period: TimeOfDay;
  insets: Insets;
  quality: Quality;
  reduceMotion: boolean;
  kiosk: boolean;
  badges: MutableRefObject<Map<string, HTMLElement>>;
  runtimeRef: MutableRefObject<VillageRuntime | null>;
  onReady: () => void;
  island: Island;
}) {
  const { scene, camera, size, gl } = useThree();
  const [rt, setRt] = useState<VillageRuntime | null>(null);
  const controls = useRef<CameraControls>(null);
  const offset = useRef({ x: 0, y: 0 });
  const frames = useRef(0);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const tall = size.width / Math.max(1, size.height) < 0.9;

  // The world lives in an effect so StrictMode's double mount never leaves a stray copy behind.
  useEffect(() => {
    const r = new VillageRuntime({ shadows: quality === 'high' ? 'high' : quality === 'balanced' ? 'low' : 'off', particles: quality !== 'saver' && !reduceMotion, island });
    r.setLively(!reduceMotion);
    // ?debug exposes the scene runtime for inspection in the browser console
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as { __village?: VillageRuntime }).__village = r;
    setRt(r);
    runtimeRef.current = r;
    scene.fog = r.world.fog;
    return () => {
      scene.fog = null;
      runtimeRef.current = null;
      r.dispose();
    };
  }, [scene, quality, reduceMotion, runtimeRef, island]);

  // Emotes requested from the inspector.
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ id: string; kind: Emote }>).detail;
      rt?.emote(d.id, d.kind);
    };
    window.addEventListener('av:emote', on);
    return () => window.removeEventListener('av:emote', on);
  }, [rt]);

  useEffect(() => {
    gl.shadowMap.enabled = quality !== 'saver';
  }, [gl, quality]);

  useEffect(() => rt?.sync(views), [rt, views]);
  useEffect(() => rt?.setFocus(selectedId), [rt, selectedId]);
  useEffect(() => rt?.world.setTimeOfDay(period), [rt, period]);

  // Camera: frame the island, or glide to the selected agent's home.
  useEffect(() => {
    const c = controls.current;
    if (!c || !rt) return;
    const view = overview(size.width / Math.max(1, size.height), insets, size.width, size.height, tall);
    c.minDistance = 7;
    c.maxDistance = view.distance * 1.35;
    c.minPolarAngle = THREE.MathUtils.degToRad(42);
    c.maxPolarAngle = THREE.MathUtils.degToRad(72);
    c.minAzimuthAngle = -0.7;
    c.maxAzimuthAngle = 0.7;
    c.setBoundary(new THREE.Box3(new THREE.Vector3(-11, -3, -11), new THREE.Vector3(11, 6, 11)));
    const animate = !reduceMotion;
    const focus = selectedId ? rt.focusPoint(selectedId, tmp) : null;
    if (focus) {
      const d = tall ? 15 : 17;
      const p = focus.clone().add(new THREE.Vector3(0, Math.sin(PITCH) * d, Math.cos(PITCH) * d));
      void c.setLookAt(p.x, p.y, p.z, focus.x, focus.y, focus.z, animate);
    } else {
      const p = view.target.clone().addScaledVector(view.dir, view.distance);
      void c.setLookAt(p.x, p.y, p.z, view.target.x, view.target.y, view.target.z, animate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rt, selectedId, size.width, size.height, tall, insets.top, insets.bottom, insets.left, insets.right, reduceMotion]);

  // Clicking a character or its home selects that agent.
  useEffect(() => {
    if (!rt) return;
    const el = gl.domElement;
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
      const r = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      onSelect(rt.pick(ndc, camera));
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
    };
  }, [rt, gl, camera, onSelect]);

  useFrame((state, dt) => {
    if (!rt) return;
    const step = Math.min(dt, 0.05);
    rt.update(step, state.clock.elapsedTime);
    if (++frames.current === 3) onReady();

    // Shift the projection so the unobstructed area (not the whole canvas) is the visual centre.
    // In kiosk mode the frame also drifts a few pixels over minutes to protect always-on screens.
    const drift = kiosk ? state.clock.elapsedTime / 240 : 0;
    const ox = (insets.right - insets.left) / 2 + (kiosk ? Math.cos(drift) * 4 : 0);
    const oy = -(insets.top - insets.bottom) / 2 + (kiosk ? Math.sin(drift * 1.3) * 4 : 0);
    const k = reduceMotion ? 1 : Math.min(1, step * 5);
    offset.current.x += (ox - offset.current.x) * k;
    offset.current.y += (oy - offset.current.y) * k;
    const cam = camera as THREE.PerspectiveCamera;
    const v = cam.view;
    if (!v || Math.abs(v.offsetX - offset.current.x) > 0.05 || Math.abs(v.offsetY - offset.current.y) > 0.05 || v.fullWidth !== size.width || v.fullHeight !== size.height) {
      cam.setViewOffset(size.width, size.height, offset.current.x, offset.current.y, size.width, size.height);
    }

    // Badges follow their homes on screen.
    for (const [id, el] of badges.current) {
      const p = rt.badgeAnchor(id, tmp);
      const s = p ? rt.project(p, camera, size.width, size.height) : null;
      if (!s) {
        el.style.visibility = 'hidden';
        continue;
      }
      el.style.visibility = 'visible';
      el.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(s.y)}px) translate(-50%, -100%)`;
    }
  });

  return (
    <>
      {rt && <primitive object={rt.world.root} />}
      <CameraControls ref={controls} makeDefault smoothTime={reduceMotion ? 0 : 0.6} draggingSmoothTime={0.15} />
    </>
  );
}
