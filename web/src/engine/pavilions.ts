// The agents' homes, after the workspace studies in the visual package:
//   Astra Observatory (explorer) – stone drum, ribbed blue dome that turns while working, telescope
//   Atelier (scholar)            – walnut-and-glass conservatory with a drafting table and shelves
//   Nexus (host)                 – wavy ribbed canopy with a console and a holographic equaliser
//   Forge (builder)              – open steel truss workshop with a robot arm, rack and sparks
//   Hex pad (custom agents)      – an expansion pad with a glowing rim and a small kiosk
// plus the central spire. Interior tungsten follows the resident's real state (125% working, 60%
// idle, 15% offline); a vacant building stays dark. Nothing here invents activity.

import * as THREE from 'three';
import type { AgentState } from '../../../shared/types.ts';
import { materials } from './materials.ts';
import { Batch, chamferBox, damp, rng } from './util.ts';

export interface Resident {
  state: AgentState | null;
  accent: THREE.Color;
}

export interface Building {
  group: THREE.Group;
  /** Where the resident stands, local to the building (front is +z). */
  home: THREE.Vector3;
  /** Local height above which the status badge floats. */
  roof: number;
  update(dt: number, t: number, r: Resident): void;
  dispose(): void;
}

export const STATUS_COLOR: Record<AgentState, string> = {
  WORKING: '#10B981',
  THINKING: '#A855F7',
  IDLE: '#38BDF8',
  ONLINE: '#38BDF8',
  WAITING: '#F59E0B',
  COMPLETED: '#FACC15',
  ERROR: '#EF4444',
  OFFLINE: '#64748B',
  UNKNOWN: '#94A3B8',
};

/** Interior light level per resident state (package lighting rig). */
export function tungsten(state: AgentState | null) {
  switch (state) {
    case 'WORKING':
      return 1.25;
    case 'COMPLETED':
      return 1.1;
    case 'THINKING':
      return 1.05;
    case 'WAITING':
      return 0.85;
    case 'ERROR':
      return 0.75;
    case 'IDLE':
    case 'ONLINE':
      return 0.6;
    case 'UNKNOWN':
      return 0.3;
    case 'OFFLINE':
      return 0.15;
    default:
      return 0.06;
  }
}

const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const TUNGSTEN = new THREE.Color('#FBBF24');
const ERROR_TINT = new THREE.Color('#ff5a4a');

/** Shared lighting behaviour: a warm point light plus glowing windows that track the resident. */
class Lamp {
  level = 0.06;
  readonly light: THREE.PointLight;
  readonly windows: THREE.MeshStandardMaterial;
  private color = new THREE.Color();
  private spill: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;

  constructor(
    parent: THREE.Object3D,
    pos: THREE.Vector3,
    private power: number,
    distance: number,
    private windowPower = 2.2,
    spill?: { at: THREE.Vector3; size: number },
  ) {
    this.light = new THREE.PointLight(TUNGSTEN, 0, distance, 1.8);
    this.light.position.copy(pos);
    parent.add(this.light);
    this.windows = new THREE.MeshStandardMaterial({ color: '#1a1108', emissive: '#ffc46b', emissiveIntensity: 0.1, roughness: 0.6 });
    if (spill) {
      // warm light pooling on the ground in front of the door
      this.spill = new THREE.Mesh(
        new THREE.PlaneGeometry(spill.size, spill.size),
        new THREE.MeshBasicMaterial({ map: materials().tex.glow, color: '#ffb066', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      this.spill.rotation.x = -Math.PI / 2;
      this.spill.position.copy(spill.at);
      this.spill.renderOrder = 1;
      parent.add(this.spill);
    }
  }

  update(dt: number, t: number, state: AgentState | null) {
    this.level = damp(this.level, tungsten(state), 2.2, dt);
    let flicker = 1;
    if (state === 'ERROR') flicker = 0.75 + 0.25 * Math.sin(t * 6);
    this.color.copy(TUNGSTEN).lerp(ERROR_TINT, state === 'ERROR' ? 0.45 : 0);
    this.light.color.copy(this.color);
    this.light.intensity = this.power * this.level * flicker;
    this.windows.emissiveIntensity = this.windowPower * this.level * flicker;
    if (this.spill) {
      this.spill.material.opacity = Math.min(0.55, 0.38 * this.level * flicker);
      this.spill.material.color.copy(this.color);
    }
  }

  dispose() {
    this.windows.dispose();
    this.spill?.geometry.dispose();
    this.spill?.material.dispose();
  }
}

/** A thin glowing status ring at a doorway, in the status colour (dark when vacant). */
class Beacon {
  readonly mesh: THREE.Mesh;
  private mat: THREE.MeshBasicMaterial;
  private c = new THREE.Color();
  constructor(parent: THREE.Object3D, pos: THREE.Vector3, radius: number) {
    this.mat = new THREE.MeshBasicMaterial({ color: '#000000', toneMapped: false });
    this.mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.025, 6, 48), this.mat);
    this.mesh.rotation.x = Math.PI / 2;
    this.mesh.position.copy(pos);
    parent.add(this.mesh);
  }
  update(dt: number, t: number, state: AgentState | null) {
    const target = state ? this.c.set(STATUS_COLOR[state]).multiplyScalar(state === 'OFFLINE' || state === 'UNKNOWN' ? 0.5 : 1.6) : this.c.set('#000000');
    let pulse = 1;
    if (state === 'ERROR') pulse = 0.55 + 0.45 * Math.abs(Math.sin(t * 3.2));
    else if (state === 'WAITING') pulse = 0.65 + 0.35 * Math.sin(t * 2.2);
    else if (state === 'WORKING' || state === 'THINKING') pulse = 0.85 + 0.15 * Math.sin(t * 4);
    this.mat.color.lerp(target.multiplyScalar(pulse), Math.min(1, dt * 4));
  }
  dispose() {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

function glassMaterial() {
  return new THREE.MeshPhysicalMaterial({ color: '#b8d4ea', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.17, depthWrite: false, side: THREE.DoubleSide, emissive: '#ffb35a', emissiveIntensity: 0 });
}

function holoMaterial(color: string, opacity = 0.8) {
  return new THREE.MeshBasicMaterial({ map: materials().tex.holo, color: new THREE.Color(color).multiplyScalar(2), transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
}

function finish(batch: Batch, group: THREE.Group) {
  const built = batch.build({ castShadow: true, receiveShadow: true });
  group.add(built);
  return built;
}

function disposeTree(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    m.geometry?.dispose();
  });
}

// ------------------------------------------------------------------ Astra Observatory
export function observatory(accent: string): Building {
  const { m } = materials();
  const group = new THREE.Group();
  const b = new Batch();
  const lamp = new Lamp(group, V3(0, 1.3, 2.0), 9, 7, 2.4, { at: V3(0, 0.02, 1.7), size: 3.2 });
  b.put('slate', m.slate, new THREE.CylinderGeometry(1.44, 1.5, 0.16, 56), V3(0, 0.08, 0));
  b.put('alabaster', m.alabaster, new THREE.CylinderGeometry(1.3, 1.36, 1.3, 56), V3(0, 0.81, 0));
  b.put('titanium', m.titanium, new THREE.TorusGeometry(1.35, 0.06, 8, 72), V3(0, 1.46, 0), [Math.PI / 2, 0, 0]);
  b.put('titanium', m.titanium, new THREE.TorusGeometry(1.37, 0.035, 8, 72), V3(0, 0.2, 0), [Math.PI / 2, 0, 0]);
  // arched windows all round, door at the front
  for (let i = 1; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const r = 1.335;
    b.put('windows', lamp.windows, new THREE.PlaneGeometry(0.28, 0.5), V3(Math.sin(a) * r, 0.86, Math.cos(a) * r), [0, a, 0]);
    b.put('windows', lamp.windows, new THREE.CircleGeometry(0.14, 16, 0, Math.PI), V3(Math.sin(a) * r, 1.11, Math.cos(a) * r), [0, a, 0]);
    b.put('titanium', m.titanium, new THREE.BoxGeometry(0.36, 0.04, 0.08), V3(Math.sin(a) * (r + 0.02), 0.6, Math.cos(a) * (r + 0.02)), [0, a, 0]);
  }
  b.put('windows', lamp.windows, new THREE.PlaneGeometry(0.56, 0.72), V3(0, 0.58, 1.34), [0, 0, 0]);
  b.put('windows', lamp.windows, new THREE.CircleGeometry(0.28, 20, 0, Math.PI), V3(0, 0.94, 1.34), [0, 0, 0]);
  b.put('titanium', m.titanium, new THREE.TorusGeometry(0.31, 0.035, 8, 24, Math.PI), V3(0, 0.94, 1.36));
  for (const s of [-1, 1]) b.put('titanium', m.titanium, new THREE.BoxGeometry(0.07, 0.74, 0.07), V3(s * 0.31, 0.57, 1.36));
  finish(b, group);

  // turning dome with ribs, a slit and the telescope
  const dome = new THREE.Group();
  dome.position.y = 1.46;
  group.add(dome);
  const domeMat = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(accent).lerp(new THREE.Color('#0b2a6b'), 0.35), metalness: 0.55, roughness: 0.26, clearcoat: 1, clearcoatRoughness: 0.08 });
  const db = new Batch();
  db.put('dome', domeMat, new THREE.SphereGeometry(1.42, 56, 28, 0, Math.PI * 2, 0, Math.PI / 2), V3(0, 0, 0));
  for (let k = 0; k < 6; k++) db.put('titanium', m.titanium, new THREE.TorusGeometry(1.43, 0.024, 6, 56, Math.PI), V3(0, 0, 0), [0, (k * Math.PI) / 6 + 0.26, 0]);
  db.put('slit', m.darkGlass, new THREE.SphereGeometry(1.435, 6, 20, Math.PI / 2 - 0.13, 0.26, 0.05, Math.PI / 2 - 0.05), V3(0, 0, 0));
  db.put('titanium', m.titanium, new THREE.CylinderGeometry(0.14, 0.19, 1.5, 28), V3(0, 0.95, 0.72), [0.85, 0, 0]);
  db.put('gunmetal', m.gunmetal, new THREE.TorusGeometry(0.16, 0.035, 8, 28), V3(0, 1.48, 1.28), [0.85 - Math.PI / 2, 0, 0]);
  db.put('titanium', m.titanium, new THREE.CylinderGeometry(0.07, 0.07, 0.4, 12), V3(0.17, 1.12, 0.62), [0.85, 0, 0]);
  const domeMesh = finish(db, dome);

  // star-chart hologram that wakes up while the resident works
  const holo = new THREE.Group();
  holo.position.set(-1.55, 2.9, 0.4);
  group.add(holo);
  const r = rng(3);
  const starPos = new Float32Array(70 * 3);
  for (let i = 0; i < 70; i++) {
    const a = r() * Math.PI * 2;
    const d = 0.15 + r() * 0.5;
    starPos.set([Math.cos(a) * d, (r() - 0.5) * 0.5, Math.sin(a) * d], i * 3);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ color: new THREE.Color('#7dd3fc').multiplyScalar(2.2), size: 0.05, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  holo.add(new THREE.Points(sg, starMat));
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#7dd3fc').multiplyScalar(1.6), transparent: true, opacity: 0.15, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const rings = [0.62, 0.48].map((rad, i) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(rad, 0.008, 4, 72), ringMat);
    ring.rotation.set(Math.PI / 2 + i * 0.5, i * 0.7, 0);
    holo.add(ring);
    return ring;
  });

  const beacon = new Beacon(group, V3(0, 0.18, 1.75), 0.55);
  let turn = 0;
  return {
    group,
    home: V3(0, 0, 1.78),
    roof: 3.0,
    update(dt, t, res) {
      lamp.update(dt, t, res.state);
      beacon.update(dt, t, res.state);
      const working = res.state === 'WORKING' || res.state === 'THINKING';
      turn = damp(turn, working ? 0.22 : 0, 1.5, dt);
      dome.rotation.y += turn * dt;
      holo.rotation.y += dt * (0.1 + turn);
      const glow = working ? 0.9 : res.state && res.state !== 'OFFLINE' ? 0.3 : 0.06;
      starMat.opacity = damp(starMat.opacity, glow, 2, dt);
      ringMat.opacity = damp(ringMat.opacity, glow * 0.6, 2, dt);
      rings[0].rotation.z += dt * 0.3;
    },
    dispose() {
      lamp.dispose();
      beacon.dispose();
      domeMat.dispose();
      starMat.dispose();
      ringMat.dispose();
      sg.dispose();
      disposeTree(group);
      void domeMesh;
    },
  };
}

// ------------------------------------------------------------------ Atelier (glass conservatory)
export function atelier(): Building {
  const { m } = materials();
  const group = new THREE.Group();
  const b = new Batch();
  const glass = glassMaterial();
  const lamp = new Lamp(group, V3(0, 1.7, 0.3), 11, 8, 2.6, { at: V3(0, 0.16, 1.5), size: 3.4 });
  const W = 1.8;
  const D = 1.4;
  const H = 1.75;
  const ridge = 0.78;
  b.put('walnut', m.walnut, new THREE.BoxGeometry(W * 2 + 0.3, 0.14, D * 2 + 0.3), V3(0, 0.07, 0));
  // posts, sills, plates
  for (const x of [-W, 0, W]) for (const z of [-D, D]) if (!(x === 0 && z === D)) b.put('walnut', m.walnut, new THREE.BoxGeometry(0.11, H, 0.11), V3(x, 0.14 + H / 2, z));
  for (const x of [-W, W]) b.put('walnut', m.walnut, new THREE.BoxGeometry(0.11, H, 0.11), V3(x, 0.14 + H / 2, 0));
  for (const z of [-D, D]) {
    b.put('walnut', m.walnut, new THREE.BoxGeometry(W * 2 + 0.12, 0.1, 0.12), V3(0, 0.14 + H, z));
    b.put('walnut', m.walnut, new THREE.BoxGeometry(W * 2, 0.06, 0.08), V3(0, 0.95, z));
  }
  for (const x of [-W, W]) {
    b.put('walnut', m.walnut, new THREE.BoxGeometry(0.12, 0.1, D * 2 + 0.12), V3(x, 0.14 + H, 0));
    b.put('walnut', m.walnut, new THREE.BoxGeometry(0.08, 0.06, D * 2), V3(x, 0.95, 0));
  }
  // door frame
  for (const s of [-1, 1]) b.put('walnut', m.walnut, new THREE.BoxGeometry(0.1, 1.5, 0.12), V3(s * 0.45, 0.14 + 0.75, D));
  b.put('walnut', m.walnut, new THREE.BoxGeometry(1.0, 0.1, 0.12), V3(0, 1.64, D));
  // glass walls (door left open)
  b.put('glass', glass, new THREE.PlaneGeometry(W * 2, H), V3(0, 0.14 + H / 2, -D));
  for (const s of [-1, 1]) b.put('glass', glass, new THREE.PlaneGeometry(D * 2, H), V3(s * W, 0.14 + H / 2, 0), [0, Math.PI / 2, 0]);
  for (const s of [-1, 1]) b.put('glass', glass, new THREE.PlaneGeometry(W - 0.45, H), V3(s * (0.45 + (W - 0.45) / 2), 0.14 + H / 2, D));
  b.put('glass', glass, new THREE.PlaneGeometry(0.9, H - 1.55), V3(0, 1.64 + (H - 1.5) / 2, D));
  // gable roof: glass slopes, rafters, ridge, glass gable ends
  const slope = Math.hypot(D + 0.1, ridge);
  const ang = Math.atan2(ridge, D + 0.1);
  const top = 0.14 + H;
  b.put('glass', glass, new THREE.PlaneGeometry(W * 2 + 0.3, slope), V3(0, top + ridge / 2, (D + 0.1) / 2), [-(Math.PI / 2 - ang), 0, 0]);
  b.put('glass', glass, new THREE.PlaneGeometry(W * 2 + 0.3, slope), V3(0, top + ridge / 2, -(D + 0.1) / 2), [Math.PI / 2 - ang, 0, 0]);
  for (let x = -W; x <= W + 0.01; x += 0.6) {
    b.put('walnut', m.walnut, new THREE.BoxGeometry(0.07, 0.07, slope), V3(x, top + ridge / 2, (D + 0.1) / 2), [ang, 0, 0]);
    b.put('walnut', m.walnut, new THREE.BoxGeometry(0.07, 0.07, slope), V3(x, top + ridge / 2, -(D + 0.1) / 2), [-ang, 0, 0]);
  }
  b.put('walnut', m.walnut, new THREE.BoxGeometry(W * 2 + 0.36, 0.1, 0.1), V3(0, top + ridge, 0));
  const gable = new THREE.Shape([new THREE.Vector2(-D, 0), new THREE.Vector2(D, 0), new THREE.Vector2(0, ridge)]);
  for (const s of [-1, 1]) b.put('glass', glass, new THREE.ShapeGeometry(gable), V3(s * W, top, 0), [0, Math.PI / 2, 0]);
  b.put('brass', m.brass, new THREE.SphereGeometry(0.07, 12, 8), V3(W + 0.15, top + ridge, 0));
  b.put('brass', m.brass, new THREE.SphereGeometry(0.07, 12, 8), V3(-W - 0.15, top + ridge, 0));

  // interior: drafting table with a glowing blueprint, shelves of books, a plant, a rug, a pendant lamp
  b.put('rug', new THREE.MeshStandardMaterial({ color: '#4a2650', roughness: 1 }), new THREE.CylinderGeometry(1.0, 1.0, 0.02, 32), V3(0, 0.15, 0.1), [0, 0, 0], [1.2, 1, 0.8]);
  for (const [x, z] of [[-1.25, -0.85], [-0.45, -0.85], [-1.25, -0.25], [-0.45, -0.25]] as const) b.put('gunmetal', m.gunmetal, new THREE.CylinderGeometry(0.025, 0.025, 0.72, 6), V3(x, 0.5, z));
  b.put('walnut', m.walnut, new THREE.BoxGeometry(1.0, 0.05, 0.75), V3(-0.85, 0.9, -0.55), [0.35, 0, 0]);
  const blueprint = holoMaterial('#93c5fd', 0.85);
  b.put('blueprint', blueprint, new THREE.PlaneGeometry(0.86, 0.6), V3(-0.85, 0.93, -0.54), [-Math.PI / 2 + 0.35, 0, 0]);
  b.put('walnut', m.walnut, new THREE.BoxGeometry(1.3, 1.5, 0.32), V3(1.0, 0.89, -1.15));
  const r = rng(12);
  const bookColors = ['#7c2d12', '#1e3a8a', '#14532d', '#a16207', '#581c87', '#9f1239'];
  for (let shelf = 0; shelf < 3; shelf++) {
    let x = 0.45;
    while (x < 1.5) {
      const w = 0.06 + r() * 0.05;
      const h = 0.26 + r() * 0.12;
      const col = bookColors[Math.floor(r() * bookColors.length)];
      b.put(`book-${col}`, bookMaterial(col), new THREE.BoxGeometry(w, h, 0.22), V3(x + w / 2, 0.36 + shelf * 0.45 + h / 2, -1.02));
      x += w + 0.01;
    }
  }
  b.put('alabaster', m.alabaster, new THREE.CylinderGeometry(0.16, 0.12, 0.3, 16), V3(1.45, 0.29, 0.95));
  b.put('leaf', m.leaf, new THREE.IcosahedronGeometry(0.3, 1), V3(1.45, 0.62, 0.95), [0, 0, 0], [1, 1.3, 1]);
  b.put('brass', m.brass, new THREE.CylinderGeometry(0.008, 0.008, 0.5, 4), V3(0, top + ridge - 0.25, 0.1));
  b.put('brass', m.brass, new THREE.ConeGeometry(0.2, 0.18, 20, 1, true), V3(0, top + ridge - 0.55, 0.1));
  b.put('windows', lamp.windows, new THREE.SphereGeometry(0.08, 12, 8), V3(0, top + ridge - 0.62, 0.1));
  finish(b, group);

  const beacon = new Beacon(group, V3(0, 0.16, D + 0.55), 0.5);
  return {
    group,
    home: V3(0, 0.14, D + 0.62),
    roof: top + ridge + 0.2,
    update(dt, t, res) {
      lamp.update(dt, t, res.state);
      beacon.update(dt, t, res.state);
      glass.emissiveIntensity = lamp.level * 0.12;
      blueprint.opacity = 0.25 + lamp.level * 0.55 + (res.state === 'WORKING' ? Math.sin(t * 3) * 0.08 : 0);
    },
    dispose() {
      lamp.dispose();
      beacon.dispose();
      glass.dispose();
      blueprint.dispose();
      disposeTree(group);
    },
  };
}

const bookMats = new Map<string, THREE.MeshStandardMaterial>();
function bookMaterial(color: string) {
  if (!bookMats.has(color)) bookMats.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.7 }));
  return bookMats.get(color)!;
}

// ------------------------------------------------------------------ Nexus (ribbed canopy)
export function nexus(accent: string): Building {
  const { m } = materials();
  const group = new THREE.Group();
  const b = new Batch();
  const lamp = new Lamp(group, V3(0, 1.4, 0.8), 10, 8, 2.2, { at: V3(0, 0.17, 1.6), size: 3.4 });
  const ribMat = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(accent).lerp(new THREE.Color('#064e3b'), 0.45), roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.12 });
  b.put('slate', m.slate, new THREE.BoxGeometry(3.9, 0.14, 3.3), V3(0, 0.07, 0));
  b.put('alabaster', m.alabaster, new THREE.BoxGeometry(3.96, 0.05, 3.36), V3(0, 0.15, 0));
  const ribs = 15;
  for (let i = 0; i < ribs; i++) {
    const z = -1.45 + (i / (ribs - 1)) * 2.9;
    const h = 1.12 + 0.2 * Math.sin(i * 0.62 + 0.4);
    b.put('rib', ribMat, new THREE.TorusGeometry(1.72, 0.095, 10, 44, Math.PI), V3(0, 0.15, z), [0, 0, 0], [1, h * 1.22, 1]);
  }
  // back wall: glass with a big holographic screen; interior console and stools
  const glass = glassMaterial();
  b.put('glass', glass, new THREE.CircleGeometry(1.7, 40, 0, Math.PI), V3(0, 0.15, -1.48), [0, 0, 0], [1, 1.3, 1]);
  const screen = holoMaterial('#6ee7b7', 0.5);
  b.put('screen', screen, new THREE.PlaneGeometry(1.6, 0.8), V3(0, 1.25, -1.42));
  b.put('gunmetal', m.gunmetal, new THREE.CylinderGeometry(0.42, 0.5, 0.7, 32), V3(0, 0.5, -0.2));
  const consoleGlow = new THREE.MeshStandardMaterial({ color: '#04130d', emissive: '#6ee7b7', emissiveIntensity: 0.4 });
  b.put('consoleGlow', consoleGlow, new THREE.CylinderGeometry(0.46, 0.46, 0.04, 32), V3(0, 0.87, -0.2));
  for (const s of [-1, 1]) {
    b.put('gunmetal', m.gunmetal, new THREE.CylinderGeometry(0.04, 0.04, 0.42, 8), V3(s * 0.85, 0.36, 0.2));
    b.put('rib', ribMat, new THREE.CylinderGeometry(0.17, 0.17, 0.06, 20), V3(s * 0.85, 0.58, 0.2));
  }
  finish(b, group);

  // holographic equaliser above the canopy, alive only while the resident talks/works
  const eqMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#6ee7b7').multiplyScalar(1.8), transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const bars: THREE.Mesh[] = [];
  const barGeo = new THREE.BoxGeometry(0.09, 1, 0.09);
  for (let i = 0; i < 16; i++) {
    const bar = new THREE.Mesh(barGeo, eqMat);
    bar.position.set(-1.2 + (i / 15) * 2.4, 2.65, 0.6);
    bar.userData.seed = i * 1.7;
    group.add(bar);
    bars.push(bar);
  }
  const beacon = new Beacon(group, V3(0, 0.17, 1.9), 0.5);
  return {
    group,
    home: V3(0, 0.15, 1.95),
    roof: 2.95,
    update(dt, t, res) {
      lamp.update(dt, t, res.state);
      beacon.update(dt, t, res.state);
      const active = res.state === 'WORKING' || res.state === 'THINKING';
      eqMat.opacity = damp(eqMat.opacity, active ? 0.75 : res.state && res.state !== 'OFFLINE' ? 0.12 : 0.03, 2, dt);
      bars.forEach((bar) => {
        const s = bar.userData.seed as number;
        const h = active ? 0.15 + Math.abs(Math.sin(t * (2.2 + (s % 1.3)) + s)) * 0.55 : 0.08;
        bar.scale.y = damp(bar.scale.y, h, 8, dt);
        bar.position.y = 2.65 + bar.scale.y / 2;
      });
      screen.opacity = 0.15 + lamp.level * 0.45;
      consoleGlow.emissiveIntensity = 0.2 + lamp.level * 1.1;
      glass.emissiveIntensity = lamp.level * 0.1;
    },
    dispose() {
      lamp.dispose();
      beacon.dispose();
      ribMat.dispose();
      glass.dispose();
      screen.dispose();
      consoleGlow.dispose();
      eqMat.dispose();
      barGeo.dispose();
      disposeTree(group);
    },
  };
}

// ------------------------------------------------------------------ Forge (truss workshop)
export function forge(accent: string): Building {
  const { m, tex } = materials();
  const group = new THREE.Group();
  const b = new Batch();
  const lamp = new Lamp(group, V3(0, 2.1, 0.3), 12, 8, 2.4, { at: V3(0, 0.1, 1.2), size: 3.6 });
  const paint = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(accent).lerp(new THREE.Color('#7c2d12'), 0.3), roughness: 0.35, metalness: 0.3, clearcoat: 0.7 });
  const W = 1.85;
  const D = 1.6;
  const H = 2.55;
  b.put('gunmetal', m.gunmetal, new THREE.BoxGeometry(W * 2 + 0.3, 0.08, D * 2 + 0.3), V3(0, 0.04, 0));
  b.put('paint', paint, new THREE.BoxGeometry(W * 2 + 0.3, 0.03, 0.12), V3(0, 0.09, D + 0.09));
  const rod = (a: THREE.Vector3, c: THREE.Vector3, r = 0.028) => {
    const d = c.clone().sub(a);
    const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d.clone().normalize());
    b.add('steel', m.steel, new THREE.CylinderGeometry(r, r, d.length(), 6), new THREE.Matrix4().compose(a.clone().addScaledVector(d, 0.5), q, V3(1, 1, 1)));
  };
  // corner truss columns
  for (const x of [-W, W]) {
    for (const z of [-D, D]) {
      const c = [V3(x - 0.1, 0, z - 0.1), V3(x + 0.1, 0, z - 0.1), V3(x + 0.1, 0, z + 0.1), V3(x - 0.1, 0, z + 0.1)];
      c.forEach((p) => rod(p, p.clone().setY(H), 0.03));
      for (let y = 0; y < H - 0.1; y += 0.42) {
        rod(V3(x - 0.1, y, z + 0.1), V3(x + 0.1, y + 0.42, z + 0.1), 0.014);
        rod(V3(x + 0.1, y, z - 0.1), V3(x + 0.1, y + 0.42, z + 0.1), 0.014);
      }
    }
  }
  // top beams with zigzag web
  const beam = (a: THREE.Vector3, c: THREE.Vector3) => {
    rod(a, c, 0.03);
    rod(a.clone().setY(a.y - 0.26), c.clone().setY(c.y - 0.26), 0.03);
    const n = Math.round(a.distanceTo(c) / 0.36);
    for (let i = 0; i < n; i++) {
      const p0 = a.clone().lerp(c, i / n);
      const p1 = a.clone().lerp(c, (i + 1) / n);
      rod(i % 2 ? p0 : p0.clone().setY(p0.y - 0.26), i % 2 ? p1.clone().setY(p1.y - 0.26) : p1, 0.014);
    }
  };
  beam(V3(-W, H, D), V3(W, H, D));
  beam(V3(-W, H, -D), V3(W, H, -D));
  beam(V3(-W, H, -D), V3(-W, H, D));
  beam(V3(W, H, -D), V3(W, H, D));
  // workbench with tools and a vise
  b.put('walnut', m.walnut, new THREE.BoxGeometry(1.7, 0.08, 0.7), V3(-0.8, 0.82, -1.1));
  for (const [x, z] of [[-1.55, -1.35], [-0.05, -1.35], [-1.55, -0.85], [-0.05, -0.85]] as const) b.put('gunmetal', m.gunmetal, new THREE.BoxGeometry(0.06, 0.78, 0.06), V3(x, 0.43, z));
  b.put('gunmetal', m.gunmetal, new THREE.BoxGeometry(0.22, 0.14, 0.16), V3(-0.15, 0.93, -0.9));
  b.put('paint', paint, new THREE.BoxGeometry(0.34, 0.16, 0.2), V3(-1.3, 0.94, -1.2));
  b.put('steel', m.steel, new THREE.BoxGeometry(0.03, 0.02, 0.3), V3(-0.8, 0.87, -1.0), [0, 0.5, 0]);
  b.put('steel', m.steel, new THREE.BoxGeometry(0.03, 0.02, 0.24), V3(-0.65, 0.87, -1.05), [0, -0.3, 0]);
  // server rack
  b.put('rack', new THREE.MeshStandardMaterial({ color: '#12151c', roughness: 0.5, metalness: 0.5 }), new THREE.BoxGeometry(0.62, 1.7, 0.5), V3(1.35, 0.93, -1.25));
  // hanging work lamp
  b.put('gunmetal', m.gunmetal, new THREE.CylinderGeometry(0.01, 0.01, 0.4, 4), V3(0, H - 0.45, 0.3));
  b.put('paint', paint, new THREE.ConeGeometry(0.22, 0.2, 20, 1, true), V3(0, H - 0.72, 0.3));
  b.put('windows', lamp.windows, new THREE.SphereGeometry(0.08, 12, 8), V3(0, H - 0.8, 0.3));
  finish(b, group);

  // rack LEDs (instanced so they can blink cheaply)
  const ledGeo = new THREE.BoxGeometry(0.06, 0.03, 0.01);
  const ledMat = new THREE.MeshBasicMaterial({ toneMapped: false });
  const leds = new THREE.InstancedMesh(ledGeo, ledMat, 24);
  const tmp = new THREE.Object3D();
  for (let i = 0; i < 24; i++) {
    tmp.position.set(1.17 + (i % 3) * 0.12, 0.3 + Math.floor(i / 3) * 0.19, -0.995);
    tmp.updateMatrix();
    leds.setMatrixAt(i, tmp.matrix);
    leds.setColorAt(i, new THREE.Color('#0a0f0c'));
  }
  group.add(leds);

  // robot arm
  const arm = new THREE.Group();
  arm.position.set(0.55, 0.08, -0.55);
  group.add(arm);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 0.22, 24), m.gunmetal);
  base.position.y = 0.11;
  arm.add(base);
  const yawJ = new THREE.Group();
  yawJ.position.y = 0.25;
  arm.add(yawJ);
  const shoulder = new THREE.Group();
  shoulder.position.y = 0.08;
  yawJ.add(shoulder);
  const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.26, 18), m.gunmetal);
  hinge.rotation.z = Math.PI / 2;
  shoulder.add(hinge);
  const lower = new THREE.Mesh(chamferBox(0.16, 0.82, 0.16, 0.04, 2), paint);
  lower.position.y = 0.41;
  shoulder.add(lower);
  const elbow = new THREE.Group();
  elbow.position.y = 0.82;
  shoulder.add(elbow);
  const elbowHinge = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.22, 16), m.gunmetal);
  elbowHinge.rotation.z = Math.PI / 2;
  elbow.add(elbowHinge);
  const upper = new THREE.Mesh(chamferBox(0.12, 0.66, 0.12, 0.03, 2), paint);
  upper.position.y = 0.33;
  elbow.add(upper);
  const wrist = new THREE.Group();
  wrist.position.y = 0.68;
  elbow.add(wrist);
  wrist.add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.12, 12), m.steel));
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.14, 10), m.steel);
  tip.position.y = 0.13;
  wrist.add(tip);
  arm.traverse((o) => {
    o.castShadow = true;
    o.receiveShadow = true;
  });

  // weld sparks
  const sparkCount = 48;
  const sparkPos = new Float32Array(sparkCount * 3);
  const sparkVel = new Float32Array(sparkCount * 3);
  const sparkLife = new Float32Array(sparkCount);
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparkMat = new THREE.PointsMaterial({ color: new THREE.Color('#ffb347').multiplyScalar(3), size: 0.045, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, map: tex.glow });
  const sparks = new THREE.Points(sg, sparkMat);
  sparks.frustumCulled = false;
  group.add(sparks);
  const weld = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.glow, color: new THREE.Color('#bfe3ff').multiplyScalar(3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  weld.scale.setScalar(0.5);
  group.add(weld);
  const tipWorld = new THREE.Vector3();
  const r = rng(8);
  let ledClock = 0;
  const ledColor = new THREE.Color();
  const beacon = new Beacon(group, V3(0, 0.1, 1.95), 0.5);

  return {
    group,
    home: V3(0, 0.08, 1.95),
    roof: H + 0.35,
    update(dt, t, res) {
      lamp.update(dt, t, res.state);
      beacon.update(dt, t, res.state);
      const working = res.state === 'WORKING';
      const awake = res.state !== null && res.state !== 'OFFLINE' && res.state !== 'UNKNOWN';
      // arm: welding sweeps while working, parked otherwise
      const sweep = working ? Math.sin(t * 0.9) : 0;
      yawJ.rotation.y = damp(yawJ.rotation.y, working ? -0.9 + sweep * 0.5 : -0.4, 3, dt);
      shoulder.rotation.x = damp(shoulder.rotation.x, working ? -0.55 + Math.sin(t * 1.7) * 0.08 : -0.15, 3, dt);
      elbow.rotation.x = damp(elbow.rotation.x, working ? -1.35 + Math.sin(t * 2.3) * 0.1 : -2.2, 3, dt);
      wrist.rotation.x = damp(wrist.rotation.x, working ? -0.7 : -0.6, 3, dt);
      tip.getWorldPosition(tipWorld);
      group.worldToLocal(tipWorld);
      const welding = working && Math.sin(t * 5.3) > -0.2;
      weld.position.copy(tipWorld);
      (weld.material as THREE.SpriteMaterial).opacity = welding ? 0.55 + r() * 0.45 : 0;
      for (let i = 0; i < sparkCount; i++) {
        if (sparkLife[i] <= 0) {
          if (!welding || r() > 0.35) {
            sparkPos[i * 3 + 1] = -100;
            continue;
          }
          sparkPos.set([tipWorld.x, tipWorld.y, tipWorld.z], i * 3);
          sparkVel.set([(r() - 0.5) * 1.6, r() * 1.4, (r() - 0.5) * 1.6], i * 3);
          sparkLife[i] = 0.4 + r() * 0.5;
        }
        sparkLife[i] -= dt;
        sparkVel[i * 3 + 1] -= 4.5 * dt;
        for (let k = 0; k < 3; k++) sparkPos[i * 3 + k] += sparkVel[i * 3 + k] * dt;
        if (sparkPos[i * 3 + 1] < 0.1) sparkVel[i * 3 + 1] *= -0.3;
      }
      sg.attributes.position.needsUpdate = true;
      // rack LEDs blink when the resident is awake, faster while working
      ledClock += dt * (working ? 6 : 1.2);
      if (ledClock > 1) {
        ledClock = 0;
        for (let i = 0; i < 24; i++) {
          const on = awake && r() < (working ? 0.6 : 0.3);
          leds.setColorAt(i, ledColor.set(on ? (i % 7 === 0 ? '#f59e0b' : '#22c55e') : '#0b120e').multiplyScalar(on ? 2.2 : 1));
        }
        if (leds.instanceColor) leds.instanceColor.needsUpdate = true;
      }
    },
    dispose() {
      lamp.dispose();
      beacon.dispose();
      paint.dispose();
      ledGeo.dispose();
      ledMat.dispose();
      sg.dispose();
      sparkMat.dispose();
      weld.material.dispose();
      disposeTree(group);
    },
  };
}

// ------------------------------------------------------------------ hex expansion pad
export function hexPad(): Building {
  const { m } = materials();
  const group = new THREE.Group();
  const rimMat = new THREE.MeshBasicMaterial({ color: '#000000', toneMapped: false });
  const hex: THREE.Vector3[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    hex.push(V3(Math.sin(a) * 0.92, 0.01, Math.cos(a) * 0.92));
  }
  const rim = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hex, true, 'catmullrom', 0.02), 72, 0.03, 5, true), rimMat);
  group.add(rim);
  const b = new Batch();
  b.put('gunmetal', m.gunmetal, new THREE.BoxGeometry(0.08, 0.85, 0.08), V3(0.62, 0.42, -0.45));
  b.put('gunmetal', m.gunmetal, new THREE.BoxGeometry(0.42, 0.3, 0.05), V3(0.62, 0.95, -0.45), [-0.3, -0.5, 0]);
  finish(b, group);
  const screenMat = new THREE.MeshBasicMaterial({ color: '#000000', toneMapped: false });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.24), screenMat);
  screen.position.set(0.628, 0.955, -0.42);
  screen.rotation.set(-0.3, -0.5, 0);
  group.add(screen);
  const c = new THREE.Color();
  return {
    group,
    home: V3(-0.1, 0, 0.12),
    roof: 1.9,
    update(dt, t, res) {
      const lit = res.state ? (res.state === 'OFFLINE' ? 0.25 : res.state === 'UNKNOWN' ? 0.4 : 1.2 + (res.state === 'WORKING' ? Math.sin(t * 4) * 0.3 : 0)) : 0.22 + Math.sin(t * 0.8) * 0.05;
      rimMat.color.lerp(res.state ? c.copy(res.accent).multiplyScalar(lit) : c.set('#38bdf8').multiplyScalar(lit), Math.min(1, dt * 3));
      screenMat.color.lerp(res.state ? c.copy(res.accent).multiplyScalar(lit * 0.7) : c.set('#38bdf8').multiplyScalar(lit * 0.6), Math.min(1, dt * 3));
    },
    dispose() {
      rimMat.dispose();
      screenMat.dispose();
      disposeTree(group);
    },
  };
}

// ------------------------------------------------------------------ central spire
export interface Spire {
  group: THREE.Group;
  /** 0..1 share of agents that are actively working or thinking (real states only). */
  update(dt: number, t: number, activity: number): void;
  dispose(): void;
}

export function spire(): Spire {
  const { m } = materials();
  const group = new THREE.Group();
  const b = new Batch();
  b.put('slate', m.slate, new THREE.CylinderGeometry(1.62, 1.68, 0.14, 48), V3(0, 0.07, 0));
  b.put('alabaster', m.alabaster, new THREE.CylinderGeometry(1.36, 1.4, 0.14, 48), V3(0, 0.21, 0));
  b.put('slate', m.slate, new THREE.CylinderGeometry(1.12, 1.16, 0.14, 48), V3(0, 0.35, 0));
  const profile = [
    [0.98, 0.42],
    [0.94, 0.6],
    [0.76, 0.82],
    [0.68, 1.55],
    [0.78, 1.66],
    [0.78, 1.8],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  b.put('alabaster', m.alabaster, new THREE.LatheGeometry(profile, 48), V3(0, 0, 0));
  const glow = new THREE.MeshStandardMaterial({ color: '#2a1d0c', emissive: '#ffe6b8', emissiveIntensity: 1.6 });
  b.put('glow', glow, new THREE.CylinderGeometry(0.56, 0.56, 1.1, 32), V3(0, 2.35, 0));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.put('alabaster', m.alabaster, new THREE.BoxGeometry(0.13, 1.1, 0.13), V3(Math.sin(a) * 0.66, 2.35, Math.cos(a) * 0.66), [0, a, 0]);
  }
  const cap = [
    [0.84, 2.9],
    [0.84, 3.0],
    [0.62, 3.12],
    [0.5, 3.42],
    [0.34, 3.72],
    [0.001, 3.74],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  b.put('alabaster', m.alabaster, new THREE.LatheGeometry(cap, 48), V3(0, 0, 0));
  b.put('titanium', m.titanium, new THREE.TorusGeometry(0.8, 0.04, 8, 56), V3(0, 1.8, 0), [Math.PI / 2, 0, 0]);
  b.put('titanium', m.titanium, new THREE.TorusGeometry(0.36, 0.035, 8, 40), V3(0, 3.72, 0), [Math.PI / 2, 0, 0]);
  b.put('titanium', m.titanium, new THREE.ConeGeometry(0.26, 1.7, 24), V3(0, 4.55, 0));
  b.put('glow', glow, new THREE.SphereGeometry(0.09, 16, 12), V3(0, 5.45, 0));
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#9be7ff').multiplyScalar(1.2), toneMapped: false });
  b.put('ring', ringMat, new THREE.TorusGeometry(1.0, 0.025, 6, 64), V3(0, 0.43, 0), [Math.PI / 2, 0, 0]);
  finish(b, group);
  const light = new THREE.PointLight('#ffe2b0', 6, 12, 1.6);
  light.position.y = 2.4;
  group.add(light);
  const halo = new THREE.Mesh(
    new THREE.PlaneGeometry(6.5, 6.5),
    new THREE.MeshBasicMaterial({ map: materials().tex.glow, color: '#ffd59a', transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 0.03;
  halo.renderOrder = 1;
  group.add(halo);
  let level = 0.5;
  return {
    group,
    update(dt, t, activity) {
      level = damp(level, 0.55 + activity * 0.7, 1.5, dt);
      const breathe = 1 + Math.sin(t * 0.8) * 0.04;
      glow.emissiveIntensity = 1.4 * level * breathe;
      light.intensity = 9 * level * breathe;
      halo.material.opacity = 0.22 * level * breathe;
    },
    dispose() {
      glow.dispose();
      ringMat.dispose();
      halo.material.dispose();
      disposeTree(group);
    },
  };
}
