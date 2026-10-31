// The floating island: a terraced slate diorama with an L-shaped upper tier along the back, stepped
// mossy terraces at the front, a jagged rock underside, stairs, a raised reflecting pool with a
// channel that spills over the edge, bonsai, rocks, moss and stone lanterns.
//
// Everything is authored in island coordinates (x/z on the island grid). The world rotates the
// island 45° so it reads as a diamond from the 30° camera; I(sx, sd) converts a screen-aligned
// layout position (right, away from the camera) into island coordinates.

import * as THREE from 'three';
import { materials } from './materials.ts';
import { Batch, fbm, noise2, rng, squirclePoints } from './util.ts';

export const HALF = 8.6;
export const ISLAND_ROTATION = Math.PI / 4;
/** Screen-aligned layout position (sx right, sd away from the camera) to island x/z. */
export const I = (sx: number, sd: number) => new THREE.Vector2((sx + sd) * Math.SQRT1_2, (sx - sd) * Math.SQRT1_2);
/** Yaw that turns a local +z front toward the camera. */
export const FACE_CAMERA = -Math.PI / 4;
const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export interface Site {
  /** Island-space centre of the building footprint. */
  at: THREE.Vector2;
  /** Ground height the building stands on. */
  y: number;
  /** Yaw of the building's front (+z local). */
  yaw: number;
}

export const LAYOUT = {
  spire: { at: I(0, 0.6), y: 0, yaw: FACE_CAMERA } as Site,
  pool: I(-1.6, -3.2),
  observatory: { at: I(-7.0, 0.5), y: 0.4, yaw: FACE_CAMERA } as Site,
  atelier: { at: new THREE.Vector2(2.4, -6.0), y: 1.4, yaw: -Math.PI / 2 } as Site,
  nexus: { at: new THREE.Vector2(6.0, -2.4), y: 1.4, yaw: 0 } as Site,
  forge: { at: I(7.0, 0.2), y: 0.25, yaw: FACE_CAMERA } as Site,
  pads: [I(-4.5, -5.4), I(4.3, -5.6), I(-0.1, -8.3), I(-7.0, -3.6), I(6.4, -3.2)].map((at) => ({ at, y: 0.2, yaw: FACE_CAMERA }) as Site),
};

/** Island outline: a softened square with an irregular, hand-cut edge. */
function outline(half: number, seed: number, steps = 128) {
  return squirclePoints(half, half, 5, steps).map(([x, z], i) => {
    const a = (i / steps) * Math.PI * 2;
    const k = 1 + fbm(Math.cos(a) * 2.2 + seed, Math.sin(a) * 2.2 + seed * 0.7, 3) * 0.035;
    return new THREE.Vector2(x * k, z * k);
  });
}

/** A closed blob in screen-aligned local axes (u right, w away), placed at c in island space. */
function screenBlob(c: THREE.Vector2, ru: number, rw: number, wobble: (a: number) => number, steps = 72) {
  const out: THREE.Vector2[] = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const k = wobble(a);
    const u = Math.cos(a) * ru * k;
    const w = Math.sin(a) * rw * k;
    out.push(new THREE.Vector2(c.x + (u + w) * Math.SQRT1_2, c.y + (u - w) * Math.SQRT1_2));
  }
  return out;
}

/** Polygon with rounded corners (island x/z points, counter-clockwise or not). */
function roundedPolygon(pts: THREE.Vector2[], r: number, seg = 6) {
  const out: THREE.Vector2[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const a = p0.clone().sub(p1).normalize().multiplyScalar(r).add(p1);
    const b = p2.clone().sub(p1).normalize().multiplyScalar(r).add(p1);
    for (let k = 0; k <= seg; k++) {
      const t = k / seg;
      // quadratic bezier a → p1 → b
      out.push(
        new THREE.Vector2(
          (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * p1.x + t * t * b.x,
          (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * p1.y + t * t * b.y,
        ),
      );
    }
  }
  return out;
}

/** Extrudes an island-space outline into a slab whose top sits at `top`. Caps get material 0, sides material 1. */
function slab(points: THREE.Vector2[], top: number, thick: number, bevel = 0.08, holes: THREE.Vector2[][] = []) {
  const shape = new THREE.Shape(points.map((p) => new THREE.Vector2(p.x, -p.y)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p.x, -p.y))));
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.01, thick - bevel * 2),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 4,
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, top - thick + bevel, 0);
  return geo;
}

/** The jagged rock mass hanging under the island, tapering to an off-centre point. */
function underside(points: THREE.Vector2[], top: number, depth: number, seed: number) {
  const n = points.length;
  const rings = 16;
  const c = points.reduce((a, p) => a.add(p), new THREE.Vector2()).divideScalar(n);
  const tip = new THREE.Vector2(c.x + 1.2, c.y - 0.6);
  const grid: THREE.Vector3[][] = [];
  for (let k = 0; k <= rings; k++) {
    const t = k / rings;
    const row: THREE.Vector3[] = [];
    const shrink = Math.pow(1 - t, 0.85) * (1 - 0.1 * t);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const p = points[i];
      // vertical rock columns (angle only) plus ledges that vary with depth
      const column = noise2(a * 9 + seed, seed * 0.3) * 0.16;
      const ledge = fbm(a * 3 + seed, t * 5, 2) * 0.28 * Math.sin(t * Math.PI);
      const k2 = k === 0 ? 1 : shrink * (1 + column + ledge);
      const q = new THREE.Vector2(c.x + (p.x - c.x) * k2, c.y + (p.y - c.y) * k2);
      q.lerp(tip, t * t);
      const y = top - t * depth * (1 + (k > 0 ? noise2(a * 4, seed) * 0.12 : 0));
      row.push(V3(q.x, y, q.y));
    }
    grid.push(row);
  }
  const pos: number[] = [];
  const uv: number[] = [];
  const push = (v: THREE.Vector3, u: number) => {
    pos.push(v.x, v.y, v.z);
    uv.push(u, v.y * 0.35);
  };
  for (let k = 0; k < rings; k++) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = grid[k][i];
      const b = grid[k][j];
      const d = grid[k + 1][i];
      const e = grid[k + 1][j];
      const u0 = (i / n) * 10;
      const u1 = ((i + 1) / n) * 10;
      push(a, u0);
      push(d, u0);
      push(b, u1);
      push(b, u1);
      push(d, u0);
      push(e, u1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

function rockGeometry(seed: number, size: number, squash = 0.7) {
  const g = new THREE.IcosahedronGeometry(size, 1);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const d = 1 + noise2(x * 2.3 + seed, z * 2.3 + y * 1.7) * 0.28;
    p.setXYZ(i, x * d, y * d * squash, z * d);
  }
  g.computeVertexNormals();
  return g;
}

/** Stairs climbing from `bottom` along `dir` (island x/z unit vector). */
function stairs(b: Batch, bottom: THREE.Vector3, dir: THREE.Vector2, width: number, rise: number, count: number, run = 0.32) {
  const { m } = materials();
  const yaw = Math.atan2(dir.x, dir.y);
  for (let i = 0; i < count; i++) {
    const h = (i + 1) * rise;
    const d = (i + 0.5) * run;
    b.put('slate', m.slate, new THREE.BoxGeometry(width, h, run), V3(bottom.x + dir.x * d, bottom.y + h / 2, bottom.z + dir.y * d), [0, yaw, 0]);
    // worn stone nosing
    b.put('alabaster', m.alabaster, new THREE.BoxGeometry(width + 0.04, 0.035, run + 0.02), V3(bottom.x + dir.x * d, bottom.y + h + 0.012, bottom.z + dir.y * d), [0, yaw, 0]);
  }
  // cheek walls
  for (const s of [-1, 1]) {
    const len = count * run;
    const side = new THREE.Vector2(dir.y, -dir.x).multiplyScalar((s * (width + 0.22)) / 2);
    b.put(
      'basalt',
      materials().m.basalt,
      new THREE.BoxGeometry(0.2, count * rise + 0.1, len),
      V3(bottom.x + dir.x * (len / 2) + side.x, bottom.y + (count * rise) / 2, bottom.z + dir.y * (len / 2) + side.y),
      [0, yaw, 0],
    );
  }
}

/** A stylised bonsai: tapering trunk segments and flattened cloud pads of foliage. */
export function bonsai(b: Batch, base: THREE.Vector3, scale: number, seed: number) {
  const { m } = materials();
  const r = rng(seed);
  const pts = [V3(0, 0, 0)];
  let p = V3(0, 0, 0);
  const lean = new THREE.Vector2(r() - 0.5, r() - 0.5).normalize().multiplyScalar(0.35);
  for (let i = 1; i <= 4; i++) {
    p = p.clone().add(V3(lean.x * (i % 2 ? 1 : -0.6) + (r() - 0.5) * 0.25, 0.42 + r() * 0.12, lean.y * (i % 2 ? 1 : -0.6) + (r() - 0.5) * 0.25));
    pts.push(p);
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i].clone().multiplyScalar(scale).add(base);
    const c = pts[i + 1].clone().multiplyScalar(scale).add(base);
    const d = c.clone().sub(a);
    const geo = new THREE.CylinderGeometry(0.07 * scale * (1 - (i + 1) * 0.17), 0.075 * scale * (1 - i * 0.17) + (i === 0 ? 0.05 * scale : 0), d.length(), 7);
    const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d.clone().normalize());
    const mat = new THREE.Matrix4().compose(a.clone().addScaledVector(d, 0.5), q, V3(1, 1, 1));
    b.add('trunk', m.trunk, geo, mat);
  }
  // foliage pads at the upper joints and the tip, plus one low branch
  const pads = [pts[2], pts[3], pts[4], pts[4].clone().add(V3(-lean.x * 1.4, -0.1, -lean.y * 1.4))];
  pads.forEach((c, i) => {
    const s = (0.42 + r() * 0.18) * scale * (i === 2 ? 1.2 : 1);
    const pos = c.clone().multiplyScalar(scale).add(base).add(V3(0, 0.06 * scale, 0));
    b.put(i % 2 ? 'leafLight' : 'leaf', i % 2 ? m.leafLight : m.leaf, new THREE.IcosahedronGeometry(1, 1), pos, [r(), r() * 3, r()], [s * 1.25, s * 0.5, s * 1.1]);
    b.put('leafLight', m.leafLight, new THREE.IcosahedronGeometry(1, 0), pos.clone().add(V3(0, s * 0.25, 0)), [r(), r() * 3, 0], [s * 0.8, s * 0.32, s * 0.7]);
  });
}

/** A Japanese-style stone lantern with a glowing firebox. */
function lantern(b: Batch, at: THREE.Vector3, glow: THREE.Material) {
  const { m } = materials();
  b.put('alabaster', m.alabaster, new THREE.CylinderGeometry(0.16, 0.2, 0.12, 8), at.clone().add(V3(0, 0.06, 0)));
  b.put('alabaster', m.alabaster, new THREE.CylinderGeometry(0.06, 0.07, 0.42, 8), at.clone().add(V3(0, 0.33, 0)));
  b.put('alabaster', m.alabaster, new THREE.BoxGeometry(0.26, 0.05, 0.26), at.clone().add(V3(0, 0.56, 0)));
  b.put('glow', glow, new THREE.BoxGeometry(0.16, 0.16, 0.16), at.clone().add(V3(0, 0.66, 0)));
  b.put('alabaster', m.alabaster, new THREE.ConeGeometry(0.24, 0.16, 4), at.clone().add(V3(0, 0.82, 0)), [0, Math.PI / 4, 0]);
}

export interface Terrain {
  group: THREE.Group;
  /** Lantern positions in island space, for optional light probes. */
  lanterns: THREE.Vector3[];
  /** The pool water outline and channel, for the water shader meshes. */
  poolOutline: THREE.Vector2[];
  channel: { x: number; z0: number; z1: number; width: number };
  /** Where the channel spills over the edge. */
  fall: THREE.Vector3;
  dispose(): void;
}

export function buildTerrain(lanternGlow: THREE.Material, lanternPool: THREE.Material): Terrain {
  const { m, tex } = materials();
  tex.flagstone.repeat.set(0.26, 0.26);
  const group = new THREE.Group();
  const owned: THREE.BufferGeometry[] = [];
  const addMesh = (geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], cast = false) => {
    owned.push(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = cast;
    group.add(mesh);
    return mesh;
  };

  // ---- main plaza, front terraces, underside
  const plaza = outline(HALF, 3);
  addMesh(slab(plaza, 0, 0.55, 0.1), [m.paving, m.basalt]);
  const front = new THREE.Vector2(-Math.SQRT1_2, Math.SQRT1_2);
  let lowest = plaza;
  for (let k = 1; k <= 3; k++) {
    const o = outline(HALF + 0.42 * k, 3 + k * 1.3).map((p) => p.clone().addScaledVector(front, 0.3 * k));
    addMesh(slab(o, -0.34 * k, 0.4, 0.07), [m.slate, m.basalt]);
    lowest = o;
  }
  addMesh(underside(lowest, -0.34 * 3 - 0.36, 6.5, 7), m.basaltDark);

  // ---- upper tier along the back (Atelier and Nexus), with stairs down to the plaza
  const E = 8.0;
  const upper = roundedPolygon(
    [new THREE.Vector2(-0.3, -E), new THREE.Vector2(E, -E), new THREE.Vector2(E, 0.3), new THREE.Vector2(3.7, 0.3), new THREE.Vector2(3.7, -3.7), new THREE.Vector2(-0.3, -3.7)],
    0.55,
  );
  addMesh(slab(upper, LAYOUT.atelier.y, LAYOUT.atelier.y + 0.05, 0.08), [m.paving, m.basalt], true);

  const b = new Batch();
  const rise = LAYOUT.atelier.y / 6;
  stairs(b, V3(-0.3 - 6 * 0.32, 0, LAYOUT.atelier.at.y), new THREE.Vector2(1, 0), 1.25, rise, 6);
  stairs(b, V3(LAYOUT.nexus.at.x, 0, 0.3 + 6 * 0.32), new THREE.Vector2(0, -1), 1.25, rise, 6);

  // ---- observatory plinth (round) and forge platform
  const obs = LAYOUT.observatory;
  const plinth = squirclePoints(2.15, 2.15, 2, 64).map(([x, z]) => new THREE.Vector2(obs.at.x + x, obs.at.y + z));
  addMesh(slab(plinth, obs.y, obs.y + 0.05, 0.06), [m.paving, m.basalt], true);
  const forge = LAYOUT.forge;
  const deck = roundedPolygon(
    [V3(-2.3, 0, -2.2), V3(2.3, 0, -2.2), V3(2.3, 0, 2.2), V3(-2.3, 0, 2.2)].map((v) => {
      const p = new THREE.Vector2(v.x, v.z).rotateAround(new THREE.Vector2(), -forge.yaw);
      return p.add(forge.at);
    }),
    0.35,
  );
  addMesh(slab(deck, forge.y, forge.y + 0.05, 0.05), [m.slate, m.basalt], true);
  // a step up onto each raised base, toward the camera
  for (const site of [obs, forge]) {
    const dir = new THREE.Vector2(Math.sin(site.yaw), Math.cos(site.yaw));
    const r = site === obs ? 2.15 : 2.3;
    const p = site.at.clone().addScaledVector(dir, r + 0.2);
    b.put('slate', m.slate, new THREE.BoxGeometry(1.3, site.y * 0.5, 0.36), V3(p.x, site.y * 0.25, p.y), [0, site.yaw, 0]);
  }

  // ---- hex pads for agents beyond the core four
  for (const pad of LAYOUT.pads) {
    b.put('slate', m.slate, new THREE.CylinderGeometry(1.0, 1.06, pad.y + 0.05, 6), V3(pad.at.x, (pad.y - 0.05) / 2 + 0.02, pad.at.y), [0, Math.PI / 6 + pad.yaw, 0]);
  }

  // ---- reflecting pool rim and the channel to the waterfall
  const pool = LAYOUT.pool;
  const wob = (a: number) => 1 + 0.1 * Math.cos(2 * a + 0.6) + 0.05 * Math.sin(3 * a + 1.1);
  const inner = screenBlob(pool, 2.35, 1.45, wob);
  const outer = screenBlob(pool, 2.35 + 0.3, 1.45 + 0.3, wob);
  addMesh(slab(outer, 0.16, 0.2, 0.04, [inner.slice().reverse()]), [m.alabaster, m.slate], true);
  const channel = { x: pool.x + 0.15, z0: pool.y + 1.85, z1: HALF + 0.55, width: 0.7 };
  for (const s of [-1, 1]) {
    const len = channel.z1 - channel.z0;
    b.put('alabaster', m.alabaster, new THREE.BoxGeometry(0.22, 0.16, len), V3(channel.x + (s * (channel.width + 0.22)) / 2, 0.08, channel.z0 + len / 2));
  }
  // little arched bridge over the channel
  const bz = channel.z0 + (channel.z1 - channel.z0) * 0.55;
  for (let i = 0; i < 9; i++) {
    const t = i / 8 - 0.5;
    b.put('alabaster', m.alabaster, new THREE.BoxGeometry(0.2, 0.08, 1.05), V3(channel.x + t * 1.7, 0.2 + (0.25 - t * t) * 0.7, bz), [0, 0, -t * 1.1]);
  }
  for (const s of [-1, 1]) for (const e of [-1, 1]) b.put('alabaster', m.alabaster, new THREE.CylinderGeometry(0.05, 0.06, 0.34, 6), V3(channel.x + e * 0.86, 0.32, bz + s * 0.48));

  // ---- stone lanterns along the paths
  const lanterns = [I(-1.9, -0.9), I(2.4, -1.4), I(-4.6, 2.2), I(4.8, 2.6), I(-3.0, -6.6), I(1.6, -7.4), I(-6.6, -2.8), I(4.0, -2.0)].map((p) => V3(p.x, 0, p.y));
  lanterns.forEach((p) => {
    lantern(b, p, lanternGlow);
    b.put('pool', lanternPool, new THREE.PlaneGeometry(2.4, 2.4), V3(p.x, 0.025, p.z), [-Math.PI / 2, 0, 0]);
  });

  // ---- bonsai, rocks and moss: art-directed placements
  const trees: [number, number, number, number, number][] = [
    // x, z, y, scale, seed
    [6.6, -6.6, LAYOUT.atelier.y, 1.35, 11],
    [0.6, -7.6, LAYOUT.atelier.y, 0.95, 4],
    [7.4, -4.6, LAYOUT.atelier.y, 0.85, 9],
    [-8.0, -6.6, 0, 1.05, 2],
    [-7.9, 3.4, 0, 0.95, 5],
    [7.6, 1.6, 0, 0.9, 7],
    [-7.3, 7.3, 0, 0.85, 13],
    [-5.9, 3.6, 0, 0.75, 17],
    [1.6, 8.0, 0, 0.9, 21],
  ];
  for (const [x, z, y, s, seed] of trees) bonsai(b, V3(x, y, z), s, seed);

  const r = rng(99);
  const rockSpots: [number, number, number, number][] = [
    [-5.6, 0.0, 0.0, 0.45],
    [-4.8, 3.6, 0.0, 0.32],
    [-1.6, 2.9, 0.0, 0.28],
    [-2.0, 3.4, 0.0, 0.2],
    [3.0, -3.2, 0.0, 0.38],
    [-7.6, -5.2, 0.0, 0.5],
    [-8.3, 1.6, 0, 0.42],
    [-8.0, 5.6, 0, 0.5],
    [-3.6, 9.05, -0.34, 0.45],
    [3.8, 8.85, -0.34, 0.4],
    [8.3, 4.6, 0, 0.45],
    [7.3, -7.4, LAYOUT.atelier.y, 0.4],
    [5.4, -7.6, LAYOUT.atelier.y, 0.3],
    [2.2, 5.6, 0, 0.3],
    [-0.6, -3.0, 0, 0.26],
  ];
  rockSpots.forEach(([x, z, y, s], i) => {
    b.put(i % 3 ? 'basalt' : 'basaltDark', i % 3 ? m.basalt : m.basaltDark, rockGeometry(i * 7.1, s), V3(x, y + s * 0.3, z), [0, r() * 6, 0]);
    // moss cushions hugging the rock
    b.put('moss', m.moss, new THREE.SphereGeometry(1, 10, 6), V3(x + s * 0.6, y + 0.04, z + s * 0.4), [0, r() * 6, 0], [s * 1.1, s * 0.28, s * 0.8]);
  });
  // moss creeping over the front terraces
  for (let i = 0; i < 36; i++) {
    const t = r();
    const k = 1 + Math.floor(r() * 3);
    const off = HALF + 0.42 * k - 0.15 + 0.3 * k * 0.7;
    const p = t < 0.5 ? new THREE.Vector2(-off, THREE.MathUtils.lerp(-7.5, off, t * 2)) : new THREE.Vector2(THREE.MathUtils.lerp(-off, 7.5, (t - 0.5) * 2), off);
    const s = 0.14 + r() * 0.3;
    b.put(i % 4 ? 'moss' : 'mossDark', i % 4 ? m.moss : m.mossDark, new THREE.SphereGeometry(1, 9, 5), V3(p.x, -0.34 * k + 0.01, p.y), [0, r() * 6, 0], [s * 1.6, s * 0.22, s]);
  }
  // moss along the plaza's front edges and the upper tier lip
  for (let i = 0; i < 46; i++) {
    const t = i / 46;
    const edge = t < 0.5 ? new THREE.Vector2(-HALF + 0.5, THREE.MathUtils.lerp(-6, HALF - 0.8, t * 2)) : new THREE.Vector2(THREE.MathUtils.lerp(-HALF + 0.8, 6, (t - 0.5) * 2), HALF - 0.5);
    const s = 0.25 + r() * 0.35;
    b.put(i % 3 ? 'moss' : 'mossDark', i % 3 ? m.moss : m.mossDark, new THREE.SphereGeometry(1, 9, 5), V3(edge.x + (r() - 0.5) * 0.5, 0.02, edge.y + (r() - 0.5) * 0.5), [0, r() * 6, 0], [s * 1.4, s * 0.22, s]);
  }
  // hanging stone chunks under the island
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4;
    b.put('basaltDark', m.basaltDark, new THREE.ConeGeometry(0.5 + r() * 0.5, 2 + r() * 2.5, 6), V3(Math.cos(a) * 5.4, -3.2 - r() * 1.6, Math.sin(a) * 5.4), [Math.PI, r() * 6, 0]);
  }

  const props = b.build({ castShadow: true, receiveShadow: true });
  group.add(props);

  return {
    group,
    lanterns,
    poolOutline: inner,
    channel,
    fall: V3(channel.x, 0.05, channel.z1),
    dispose() {
      owned.forEach((g) => g.dispose());
      props.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    },
  };
}
