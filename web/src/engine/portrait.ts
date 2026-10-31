// Still portraits of the 3D characters for the 2D interface (roster, feed, editor, login). One small
// offscreen renderer draws a design once, caches the PNG and disposes the rig; the same design is
// never rendered twice. If WebGL is unavailable the caller falls back to a coloured disc.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Accessory, AgentState, Archetype } from '../../../shared/types.ts';
import { Creature } from './creature.ts';

export interface PortraitSpec {
  archetype: Archetype;
  color: string;
  accessory?: Accessory;
  state?: AgentState;
  framing: 'head' | 'full';
}

const SIZE = 256;
const cache = new Map<string, string>();
let ctx: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera } | null | false = null;

function setup() {
  try {
    const canvas = document.createElement('canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(SIZE, SIZE, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.32;
    pmrem.dispose();
    scene.add(new THREE.HemisphereLight('#c7d4ff', '#1a1d2a', 0.9));
    const key = new THREE.DirectionalLight('#e3ecff', 2.3);
    key.position.set(-2, 3, 4);
    const rim = new THREE.DirectionalLight('#a5b4fc', 2.2);
    rim.position.set(3, 2, -3);
    const warm = new THREE.PointLight('#fbbf24', 3, 8, 1.6);
    warm.position.set(2, 1.2, 2.5);
    scene.add(key, rim, warm);
    const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 50);
    ctx = { renderer, scene, camera };
  } catch {
    ctx = false;
  }
}

/** Expression families: portraits only change for states that change the face. */
function faceState(s: AgentState | undefined): AgentState {
  if (s === 'OFFLINE' || s === 'ERROR' || s === 'WAITING' || s === 'UNKNOWN') return s;
  return 'IDLE';
}

/** Data URL of the character, or '' when WebGL is not available. */
export function portrait(spec: PortraitSpec): string {
  const state = faceState(spec.state);
  const key = `${spec.archetype}|${spec.color}|${spec.accessory ?? 'none'}|${state}|${spec.framing}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  if (ctx === null) setup();
  if (!ctx) return '';
  const { renderer, scene, camera } = ctx;
  const c = new Creature({ id: `portrait:${key}`, archetype: spec.archetype, color: spec.color, accessory: spec.accessory });
  c.setState(state, true);
  // settle the pose without advancing the clock past the first blink or glance
  for (let i = 0; i < 40; i++) c.update(0.05, 0.25);
  c.group.traverse((o) => {
    // the ground shadow disc and cushion belong to the world, not to a portrait
    if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshBasicMaterial && o.geometry instanceof THREE.PlaneGeometry) o.visible = false;
  });
  scene.add(c.group);
  if (spec.framing === 'head') {
    const cy = c.headY + 0.06;
    const r = Math.max(c.headR * 1.45, 0.64);
    const d = r / Math.tan(THREE.MathUtils.degToRad(12));
    camera.position.set(d * 0.22, cy + d * 0.12, d);
    camera.lookAt(0, cy, 0);
  } else {
    const cy = c.height * 0.52;
    const d = (c.height * 0.62) / Math.tan(THREE.MathUtils.degToRad(12));
    camera.position.set(d * 0.3, cy + d * 0.18, d);
    camera.lookAt(0, cy, 0);
  }
  renderer.setClearColor(0x000000, 0);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  scene.remove(c.group);
  c.dispose();
  cache.set(key, url);
  return url;
}
