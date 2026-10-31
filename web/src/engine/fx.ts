// Atmosphere and light effects: bioluminescent water, the waterfall, glowing stone conduits with
// handoff packets, the sky dome with stars and bokeh, drifting motes and the haze under the island.
// All shaders are small and self-contained; nothing is loaded from the network.

import * as THREE from 'three';
import { materials } from './materials.ts';
import { rng } from './util.ts';

const COMMON_HEAD = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
`;

// ------------------------------------------------------------------ water
export function waterMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uDeep: { value: new THREE.Color('#06173a') },
      uGlow: { value: new THREE.Color('#38bdf8') },
      uSpark: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uDeep;
      uniform vec3 uGlow;
      uniform float uSpark;
      varying vec3 vWorld;
      ${COMMON_HEAD}
      void main() {
        vec2 p = vWorld.xz;
        float r = sin(p.x * 2.6 + uTime * 0.6) * sin(p.y * 2.2 - uTime * 0.5) * 0.5 + 0.5;
        float r2 = sin((p.x + p.y) * 3.7 - uTime * 0.8) * 0.5 + 0.5;
        vec3 col = mix(uDeep, uGlow * 0.32, r * r2 * 0.55);
        // bioluminescent sparkles, one candidate per cell, each on its own rhythm
        for (int k = 0; k < 2; k++) {
          float sc = k == 0 ? 5.0 : 9.0;
          vec2 cell = floor(p * sc + float(k) * 3.7);
          vec2 f = fract(p * sc + float(k) * 3.7) - 0.5;
          float h = hash(cell);
          vec2 o = vec2(hash(cell + 1.3), hash(cell + 7.1)) - 0.5;
          float d = length(f - o * 0.6);
          float tw = 0.5 + 0.5 * sin(uTime * (0.8 + h * 2.2) + h * 40.0);
          col += uGlow * smoothstep(0.09, 0.0, d) * step(0.7, h) * tw * 2.4 * uSpark;
        }
        vec3 v = normalize(cameraPosition - vWorld);
        col += uGlow * pow(1.0 - clamp(v.y, 0.0, 1.0), 3.0) * 0.35;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

export function waterfallMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color('#a5e8ff') } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      varying vec2 vUv;
      ${COMMON_HEAD}
      void main() {
        float lane = floor(vUv.x * 16.0);
        float h = hash(vec2(lane, 3.0));
        float s = fract(vUv.y * (3.0 + h * 2.0) - uTime * (1.1 + h * 0.6) + h * 7.0);
        float streak = smoothstep(0.0, 0.25, s) * smoothstep(1.0, 0.55, s);
        float edge = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
        float fade = smoothstep(1.0, 0.45, vUv.y);
        float foam = smoothstep(0.12, 0.0, vUv.y);
        float a = (0.22 + streak * 0.5 + foam * 0.6) * edge * fade;
        gl_FragColor = vec4(uColor * a, a);
      }`,
  });
}

/** A strip following `path`, `width` wide across the x axis, with uv.y running along the path. */
export function ribbon(path: THREE.Vector3[], width: number, segments = 48) {
  const curve = new THREE.CatmullRomCurve3(path);
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p = curve.getPoint(t);
    const w = width * (1 + t * 0.6);
    pos.push(p.x - w / 2, p.y, p.z, p.x + w / 2, p.y, p.z);
    uv.push(0, t, 1, t);
    if (i < segments) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ conduits
export function conduitMaterial(length: number) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color('#9be7ff') },
      uLen: { value: length },
      uLevel: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uLen;
      uniform float uLevel;
      varying vec2 vUv;
      void main() {
        float d = fract(vUv.x * uLen * 0.45 - uTime * 0.35);
        float dash = smoothstep(0.0, 0.12, d) * smoothstep(0.45, 0.2, d);
        float a = (0.35 + dash * 0.55) * uLevel;
        gl_FragColor = vec4(uColor * a * 1.6, a);
      }`,
  });
}

/** Builds a glowing groove along a path (island space) and returns it with its curve. */
export function conduit(points: THREE.Vector3[]) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const len = curve.getLength();
  const mat = conduitMaterial(len);
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(16, Math.round(len * 6)), 0.03, 5, false), mat);
  mesh.renderOrder = 2;
  return { mesh, curve, mat, length: len };
}

// ------------------------------------------------------------------ sky, stars, bokeh, motes, haze
export function skyDome() {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color('#0b1430') },
      uMid: { value: new THREE.Color('#070b1c') },
      uBottom: { value: new THREE.Color('#03050d') },
    },
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop;
      uniform vec3 uMid;
      uniform vec3 uBottom;
      varying vec3 vDir;
      void main() {
        float y = vDir.y;
        vec3 col = y > 0.0 ? mix(uMid, uTop, smoothstep(0.0, 0.6, y)) : mix(uMid, uBottom, smoothstep(0.0, -0.7, y));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(140, 32, 16), mat);
  mesh.renderOrder = -10;
  return { mesh, mat };
}

export function stars(count = 1400) {
  const r = rng(5);
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const u = r() * 2 - 1;
    const a = r() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const d = 110 + r() * 20;
    pos.set([Math.cos(a) * s * d, u * d, Math.sin(a) * s * d], i * 3);
    seed[i] = r();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uOpacity: { value: 1 }, uScale: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    vertexShader: /* glsl */ `
      attribute float seed;
      uniform float uTime;
      uniform float uScale;
      varying float vA;
      void main() {
        vA = (0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * (0.4 + seed * 1.6) + seed * 50.0))) * (0.3 + seed * 0.7);
        gl_PointSize = (1.0 + seed * seed * 2.6) * uScale;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d) * vA * uOpacity;
        gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * a, a);
      }`,
  });
  return { points: new THREE.Points(g, mat), mat };
}

/** Large soft out-of-focus lights far behind the island, like the reference renders' bokeh. */
export function bokeh(count = 26) {
  const { tex } = materials();
  const r = rng(31);
  const group = new THREE.Group();
  const palette = ['#3b82f6', '#22d3ee', '#a78bfa', '#f59e0b', '#38bdf8'];
  const mats: THREE.SpriteMaterial[] = [];
  for (let i = 0; i < count; i++) {
    const mat = new THREE.SpriteMaterial({ map: tex.glow, color: palette[i % palette.length], transparent: true, opacity: 0.05 + r() * 0.1, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    mats.push(mat);
    const s = new THREE.Sprite(mat);
    const a = r() * Math.PI * 2;
    const d = 38 + r() * 30;
    s.position.set(Math.cos(a) * d, -14 + r() * 26, Math.sin(a) * d - 10);
    s.scale.setScalar(2 + r() * 6);
    s.userData.phase = r() * 6;
    s.userData.base = mat.opacity;
    group.add(s);
  }
  return { group, mats };
}

export function motes(count = 180, radius = 13) {
  const r = rng(17);
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  const warm = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * radius;
    pos.set([Math.cos(a) * d, -1 + r() * 6.5, Math.sin(a) * d], i * 3);
    seed[i] = r();
    warm[i] = r() < 0.35 ? 1 : 0;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  g.setAttribute('warm', new THREE.BufferAttribute(warm, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uOpacity: { value: 1 }, uPixel: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float seed;
      attribute float warm;
      uniform float uTime;
      uniform float uPixel;
      varying float vA;
      varying float vWarm;
      void main() {
        vec3 p = position;
        float t = uTime * (0.12 + seed * 0.18) + seed * 30.0;
        p += vec3(sin(t) * 0.6, sin(t * 1.3) * 0.35, cos(t * 0.8) * 0.6);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vA = 0.25 + 0.75 * (0.5 + 0.5 * sin(uTime * (0.7 + seed) + seed * 20.0));
        vWarm = warm;
        gl_PointSize = (2.0 + seed * 3.5) * uPixel * (30.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      varying float vA;
      varying float vWarm;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d) * vA * uOpacity;
        vec3 c = mix(vec3(0.55, 0.85, 1.0), vec3(1.0, 0.78, 0.4), vWarm);
        gl_FragColor = vec4(c * a * 1.6, a);
      }`,
  });
  return { points: new THREE.Points(g, mat), mat };
}

export function haze() {
  const { tex } = materials();
  const group = new THREE.Group();
  const mats: THREE.MeshBasicMaterial[] = [];
  const layers: [number, number, string, number][] = [
    [-5.5, 30, '#16234a', 0.5],
    [-9, 46, '#0d1633', 0.55],
    [-2.6, 20, '#1e3a8a', 0.12],
  ];
  for (const [y, size, color, opacity] of layers) {
    const mat = new THREE.MeshBasicMaterial({ map: tex.glow, color, transparent: true, opacity, depthWrite: false, fog: false });
    mats.push(mat);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.y = y;
    m.renderOrder = -5;
    group.add(m);
  }
  return { group, mats };
}

/** A glowing packet that travels a curve over `duration` seconds, with a short fading trail. */
export class Packet {
  readonly group = new THREE.Group();
  private sprites: THREE.Sprite[] = [];
  private age = 0;
  done = false;

  constructor(
    private curve: THREE.Curve<THREE.Vector3>,
    color: THREE.ColorRepresentation,
    private duration = 2.6,
  ) {
    const { tex } = materials();
    for (let i = 0; i < 6; i++) {
      const mat = new THREE.SpriteMaterial({ map: tex.glow, color: new THREE.Color(color).multiplyScalar(i === 0 ? 3 : 2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      const s = new THREE.Sprite(mat);
      s.scale.setScalar(i === 0 ? 0.55 : 0.4 - i * 0.05);
      this.sprites.push(s);
      this.group.add(s);
    }
  }

  update(dt: number) {
    this.age += dt;
    const t = this.age / this.duration;
    if (t >= 1) {
      this.done = true;
      this.group.visible = false;
      return;
    }
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    this.sprites.forEach((s, i) => {
      const tt = Math.max(0, e - i * 0.018);
      this.curve.getPoint(tt, s.position);
      s.position.y += 0.08;
      (s.material as THREE.SpriteMaterial).opacity = (1 - i / 6) * Math.min(1, (1 - t) * 4, t * 8);
    });
  }

  dispose() {
    this.sprites.forEach((s) => s.material.dispose());
  }
}
