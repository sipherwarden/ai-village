// Small math/geometry helpers shared by the world builders. Pure three.js, no React.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Deterministic 32-bit hash of a string (agent ids, seeds). */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Seeded PRNG so the island looks the same on every load. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Compact 2D value noise with smooth interpolation (good enough for rock jitter and moss blotches).
const PERM = (() => {
  const r = rng(1337);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  return [...p, ...p];
})();
const GRAD = Array.from({ length: 256 }, (_, i) => {
  const a = (PERM[i] / 256) * Math.PI * 2;
  return [Math.cos(a), Math.sin(a)];
});
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

export function noise2(x: number, y: number): number {
  const xi = Math.floor(x) & 255;
  const yi = Math.floor(y) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const g = (ix: number, iy: number, dx: number, dy: number) => {
    const v = GRAD[PERM[ix + PERM[iy]]];
    return v[0] * dx + v[1] * dy;
  };
  const u = fade(xf);
  const v = fade(yf);
  const n00 = g(xi, yi, xf, yf);
  const n10 = g(xi + 1, yi, xf - 1, yf);
  const n01 = g(xi, yi + 1, xf, yf - 1);
  const n11 = g(xi + 1, yi + 1, xf - 1, yf - 1);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(n00, n10, u), THREE.MathUtils.lerp(n01, n11, u), v) * 1.4;
}

export function fbm(x: number, y: number, octaves = 4): number {
  let a = 0.5;
  let f = 1;
  let s = 0;
  for (let i = 0; i < octaves; i++) {
    s += a * noise2(x * f, y * f);
    f *= 2;
    a *= 0.5;
  }
  return s;
}

/** Screen-aligned plaza coordinates (u = right, v = away from the camera) to world x/z. */
export const P = (u: number, v: number, y = 0) => new THREE.Vector3(u, y, -v);

/**
 * Collects geometry by material key and merges it into one mesh per material. Static props are
 * authored as many small primitives; merging keeps the draw-call count low enough for an iPad.
 */
export class Batch {
  private parts = new Map<string, THREE.BufferGeometry[]>();
  private mats = new Map<string, THREE.Material>();

  add(key: string, material: THREE.Material, geometry: THREE.BufferGeometry, matrix?: THREE.Matrix4) {
    let g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((g.attributes.position.count) * 2), 2));
    if (matrix) g = g.applyMatrix4(matrix);
    g.clearGroups();
    if (!this.parts.has(key)) this.parts.set(key, []);
    this.parts.get(key)!.push(g);
    this.mats.set(key, material);
    geometry.dispose();
    return this;
  }

  /** Convenience: add with position / rotation (Euler XYZ) / scale. */
  put(key: string, material: THREE.Material, geometry: THREE.BufferGeometry, pos: THREE.Vector3Like, rot: [number, number, number] = [0, 0, 0], scale: [number, number, number] | number = 1) {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(pos.x, pos.y, pos.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)),
      typeof scale === 'number' ? new THREE.Vector3(scale, scale, scale) : new THREE.Vector3(...scale),
    );
    return this.add(key, material, geometry, m);
  }

  build(opts: { castShadow?: boolean; receiveShadow?: boolean } = {}): THREE.Group {
    const group = new THREE.Group();
    for (const [key, geos] of this.parts) {
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, this.mats.get(key)!);
      mesh.name = key;
      mesh.castShadow = opts.castShadow ?? true;
      mesh.receiveShadow = opts.receiveShadow ?? true;
      group.add(mesh);
    }
    this.parts.clear();
    return group;
  }
}

/** A rounded rectangle THREE.Shape centred on the origin. */
export function roundedRectShape(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** Closed smooth shape through points (Catmull-Rom), as a THREE.Shape. */
export function smoothShape(points: THREE.Vector2[], samples = 96): THREE.Shape {
  const curve = new THREE.SplineCurve([...points, points[0]]);
  const pts = curve.getSpacedPoints(samples);
  return new THREE.Shape(pts);
}

/** A rounded box with chamfered (bevelled) edges, built by extrusion. Good for slabs and robot shells. */
export function chamferBox(w: number, h: number, d: number, r: number, segments = 3): THREE.BufferGeometry {
  const shape = roundedRectShape(w - 2 * r * 0.5, h - 2 * r * 0.5, Math.min(r, Math.min(w, h) / 2 - 0.001) * 0.6);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, d - r),
    bevelEnabled: true,
    bevelThickness: r * 0.5,
    bevelSize: r * 0.5,
    bevelSegments: segments,
    curveSegments: 8,
  });
  geo.center();
  return geo;
}

/** Superellipse outline points, centred on the origin. n = 2 is an ellipse, larger n squarer. */
export function squirclePoints(a: number, b: number, n: number, steps = 96): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    out.push([a * Math.sign(c) * Math.pow(Math.abs(c), 2 / n), b * Math.sign(s) * Math.pow(Math.abs(s), 2 / n)]);
  }
  return out;
}

/**
 * A plane bent onto a sphere of radius r (centred on the origin, facing +z). UVs stay planar, so a
 * canvas face maps onto a curved visor without distortion.
 */
export function sphereScreen(r: number, w: number, h: number, yOffset = 0, segX = 32, segY = 20): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h, segX, segY);
  const p = g.attributes.position as THREE.BufferAttribute;
  const n = g.attributes.normal as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i) + yOffset;
    v.set(x, y, Math.sqrt(Math.max(0, r * r - x * x - y * y)));
    p.setXYZ(i, v.x, v.y, v.z);
    v.normalize();
    n.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
}

/** Closed squircle path lying on a sphere of radius r (matches sphereScreen), for bezels and trims. */
export function sphereOutline(r: number, a: number, b: number, n: number, yOffset = 0, steps = 72) {
  const pts = squirclePoints(a, b, n, steps).map(([x, y]) => {
    const yy = y + yOffset;
    return new THREE.Vector3(x, yy, Math.sqrt(Math.max(0, r * r - x * x - yy * yy)));
  });
  return new THREE.CatmullRomCurve3(pts, true);
}

/** Closed squircle path in the xy plane at depth z. */
export function flatOutline(a: number, b: number, n: number, z = 0, steps = 72) {
  return new THREE.CatmullRomCurve3(
    squirclePoints(a, b, n, steps).map(([x, y]) => new THREE.Vector3(x, y, z)),
    true,
  );
}

/** Ease helpers for animation. */
export const ease = {
  inOut: (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  out: (t: number) => 1 - Math.pow(1 - t, 3),
  back: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
};

/** Frame-rate independent exponential smoothing toward a target. */
export const damp = (current: number, target: number, lambda: number, dt: number) => THREE.MathUtils.damp(current, target, lambda, dt);

export function lighten(hex: string, t: number) {
  return new THREE.Color(hex).lerp(new THREE.Color('#ffffff'), t);
}
export function darken(hex: string, t: number) {
  return new THREE.Color(hex).lerp(new THREE.Color('#05060c'), t);
}
