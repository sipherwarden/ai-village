// AI Village characters as procedural 3D rigs. One shared skeleton (body pivot, optional head and
// shoulder pivots, a canvas-driven screen face, state props) dressed as five archetypes with
// distinct silhouettes, following the character sheets in the visual package:
//   explorer  – glossy hovering sphere, wrap-around glass visor, gauntlet hands, thrusters (Gemini)
//   scholar   – velvet pear, silver crown cap, big brass spectacles, drafting tablet      (Claude)
//   host      – capsule astronaut, big helmet screen, studio headphones and boom mic      (ChatGPT)
//   builder   – chamfered box robot, goggle faceplate, flip-up welding visor, tool belt   (OpenCode)
//   sprite    – compact pod for custom agents, takes the classic accessories
// State drives pose, face, props and light; a per-agent phase offset keeps everyone out of sync.

import * as THREE from 'three';
import type { Accessory, AgentState, Archetype } from '../../../shared/types.ts';
import { Face, glyphTexture, type Expr } from './face.ts';
import { materials, withRim } from './materials.ts';
import { chamferBox, damp, flatOutline, hashString, rng, sphereOutline, sphereScreen } from './util.ts';

export interface CreatureOptions {
  id: string;
  archetype: Archetype;
  color: string;
  accessory?: Accessory;
  scale?: number;
}

/** Identity triads from the visual package (primary, deep core, emissive glow, trim). */
export const IDENTITY: Record<Exclude<Archetype, 'sprite'>, { primary: string; core: string; glow: string; trim: string }> = {
  explorer: { primary: '#00D2FF', core: '#0284C7', glow: '#7DD3FC', trim: '#64748B' },
  scholar: { primary: '#A855F7', core: '#6B21A8', glow: '#D8B4FE', trim: '#D4AF37' },
  host: { primary: '#10B981', core: '#047857', glow: '#6EE7B7', trim: '#CBD5E1' },
  builder: { primary: '#F59E0B', core: '#B45309', glow: '#FDE047', trim: '#334155' },
};

/** Accessories a design already wears; picking them again would double up. */
const BUILT_IN: Partial<Record<Archetype, Accessory[]>> = {
  explorer: ['visor'],
  scholar: ['glasses'],
  host: ['headphones'],
  builder: ['visor', 'glasses'],
};

export function triad(archetype: Archetype, color: string) {
  const c = new THREE.Color(color);
  const id = archetype !== 'sprite' ? IDENTITY[archetype] : null;
  // Use the package triad when the agent still has its identity colour; derive one otherwise.
  if (id && c.getHexString() === new THREE.Color(id.primary).getHexString()) return id;
  return {
    primary: `#${c.getHexString()}`,
    core: `#${c.clone().lerp(new THREE.Color('#0a0c18'), 0.42).getHexString()}`,
    glow: `#${c.clone().lerp(new THREE.Color('#ffffff'), 0.5).getHexString()}`,
    trim: id?.trim ?? '#8b93a7',
  };
}

const mix = (a: string, b: string, t: number) => new THREE.Color(a).lerp(new THREE.Color(b), t);

interface Pose {
  lift: number;
  lean: number;
  tilt: number;
  spreadL: number;
  spreadR: number;
  raiseL: number;
  raiseR: number;
  dim: number;
  expr: Expr;
}

const POSE: Record<AgentState, Pose> = {
  ONLINE: { lift: 0, lean: 0, tilt: 0, spreadL: 0.22, spreadR: 0.22, raiseL: 0.1, raiseR: 0.1, dim: 1, expr: 'neutral' },
  IDLE: { lift: 0, lean: 0, tilt: 0, spreadL: 0.16, spreadR: 0.16, raiseL: 0.05, raiseR: 0.05, dim: 0.9, expr: 'idle' },
  WORKING: { lift: 0, lean: 0.08, tilt: 0, spreadL: 0.3, spreadR: 0.3, raiseL: 1.05, raiseR: 1.05, dim: 1, expr: 'focus' },
  THINKING: { lift: 0, lean: -0.04, tilt: 0.06, spreadL: 0.2, spreadR: 0.5, raiseL: 0.15, raiseR: 1.95, dim: 1, expr: 'think' },
  WAITING: { lift: 0.12, lean: 0, tilt: 0, spreadL: 0.12, spreadR: 0.12, raiseL: 0.6, raiseR: 0.6, dim: 0.9, expr: 'calm' },
  COMPLETED: { lift: 0, lean: -0.05, tilt: 0, spreadL: 2.5, spreadR: 2.5, raiseL: 0.2, raiseR: 0.2, dim: 1, expr: 'happy' },
  ERROR: { lift: 0, lean: -0.04, tilt: 0, spreadL: 0.9, spreadR: 0.9, raiseL: 1.3, raiseR: 1.3, dim: 1, expr: 'alarm' },
  OFFLINE: { lift: 0, lean: 0.22, tilt: 0.05, spreadL: 0.05, spreadR: 0.05, raiseL: 0.1, raiseR: 0.1, dim: 0.3, expr: 'sleep' },
  UNKNOWN: { lift: 0, lean: 0.04, tilt: 0, spreadL: 0.12, spreadR: 0.12, raiseL: 0.05, raiseR: 0.05, dim: 0.5, expr: 'unknown' },
};

/** Floating-hand rest positions for the explorer, per state: [x, y, z] (x mirrored for the left hand). */
const HANDS: Partial<Record<AgentState, [number, number, number]>> = {
  WORKING: [0.4, 0.86, 0.66],
  THINKING: [0.66, 0.74, 0.3],
  COMPLETED: [0.82, 1.62, 0.1],
  ERROR: [0.66, 1.2, 0.42],
  OFFLINE: [0.7, 0.18, 0.25],
  WAITING: [0.56, 0.6, 0.34],
};

interface Parts {
  height: number;
  headY: number;
  headR: number;
  face: Face;
  head?: THREE.Object3D;
  arms?: [THREE.Object3D, THREE.Object3D];
  hands?: [THREE.Object3D, THREE.Object3D];
  hover: boolean;
  jets?: THREE.Sprite[];
  holo: THREE.Object3D;
  glowMats: THREE.MeshStandardMaterial[];
}

export class Creature {
  readonly group = new THREE.Group();
  readonly id: string;
  readonly archetype: Archetype;
  readonly height: number;
  /** Height of the face centre and the head radius, for framing portraits and badges. */
  readonly headY: number;
  readonly headR: number;
  readonly colors: ReturnType<typeof triad>;
  state: AgentState = 'UNKNOWN';
  focused = false;
  /** 0 = standing still, >0 = walking speed (drives step animation). */
  walking = 0;

  private body = new THREE.Group();
  private pivot = new THREE.Group();
  private parts: Parts;
  private phase: number;
  private period: number;
  private pose: Pose = { ...POSE.UNKNOWN };
  private nextBlink = 2;
  private blinkUntil = 0;
  private stateSince = 0;
  private time = 0;
  private facing = 0;
  private facingTarget = 0;
  private look = new THREE.Vector2();
  private lookTarget = new THREE.Vector2();
  private nextGlance = 3;
  private focusSince = -10;
  private random: () => number;
  private fx: {
    think: THREE.Group;
    sparkles: THREE.Group;
    wait: THREE.Group;
    warn: THREE.Sprite;
    zzz: THREE.Sprite[];
    question: THREE.Sprite;
    cushion: THREE.Mesh;
    shadow: THREE.Mesh;
  };
  private owned: (THREE.Material | THREE.BufferGeometry | THREE.Texture)[] = [];

  constructor(opts: CreatureOptions) {
    this.id = opts.id;
    this.archetype = opts.archetype;
    this.colors = triad(opts.archetype, opts.color);
    const h = hashString(opts.id);
    this.phase = ((h % 6283) / 1000) % (Math.PI * 2);
    this.period = 3.2 + ((h >>> 8) % 900) / 1000;
    this.random = rng(h);
    // Blink and glance clocks start at different moments for every agent.
    this.nextBlink = 0.4 + this.random() * 4;
    this.nextGlance = 1 + this.random() * 3;

    this.group.add(this.pivot);
    this.pivot.add(this.body);
    this.parts = this.build(opts);
    this.parts.holo.userData.baseY = this.parts.holo.position.y;
    this.height = this.parts.height;
    this.headY = this.parts.headY;
    this.headR = this.parts.headR;
    this.fx = this.buildFx();
    const acc = opts.accessory;
    if (acc && acc !== 'none' && !BUILT_IN[opts.archetype]?.includes(acc)) this.addAccessory(acc);

    this.group.scale.setScalar(opts.scale ?? 1);
    this.body.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = !o.userData.noShadow;
    });
    this.group.traverse((o) => {
      o.userData.agentId = this.id;
    });
    this.setState('UNKNOWN', true);
  }

  // ------------------------------------------------------------------ construction helpers
  private own<T extends THREE.Material | THREE.BufferGeometry | THREE.Texture>(x: T): T {
    this.owned.push(x);
    return x;
  }
  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, pos?: [number, number, number], rot?: [number, number, number], scale?: [number, number, number]) {
    const m = new THREE.Mesh(this.own(geo), mat);
    if (pos) m.position.set(...pos);
    if (rot) m.rotation.set(...rot);
    if (scale) m.scale.set(...scale);
    parent.add(m);
    return m;
  }
  /** A cylinder between two points. */
  private rod(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material, parent: THREE.Object3D) {
    const d = new THREE.Vector3().subVectors(b, a);
    const m = this.mesh(new THREE.CylinderGeometry(r, r, d.length(), 8), mat, parent);
    m.position.copy(a).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    return m;
  }
  private physical(p: THREE.MeshPhysicalMaterialParameters, rim = 0.35) {
    const m = new THREE.MeshPhysicalMaterial(p);
    if (rim > 0) withRim(m, this.colors.glow, rim, 2.6);
    return this.own(m);
  }
  private standard(p: THREE.MeshStandardMaterialParameters) {
    return this.own(new THREE.MeshStandardMaterial(p));
  }
  private glowMat(color: string, intensity = 2) {
    return this.own(new THREE.MeshStandardMaterial({ color: '#000000', emissive: color, emissiveIntensity: intensity, roughness: 0.4 }));
  }
  /** Glossy dark screen glass showing the face canvas; transparent outside the squircle. */
  private screenMat(face: Face) {
    return this.own(
      new THREE.MeshPhysicalMaterial({
        color: '#ffffff',
        map: face.texture,
        alphaTest: 0.5,
        emissive: '#ffffff',
        emissiveMap: face.texture,
        emissiveIntensity: 1.5,
        roughness: 0.18,
        metalness: 0,
        clearcoat: 1,
        clearcoatRoughness: 0.04,
      }),
    );
  }
  /** A face screen bent onto a sphere, with an optional metal bezel following its outline. */
  private sphereFace(face: Face, r: number, w: number, h: number, yOff: number, n: number, parent: THREE.Object3D, bezel?: THREE.Material, bezelR = 0.02) {
    const screen = this.mesh(sphereScreen(r + 0.004, w, h, yOff), this.screenMat(face), parent);
    if (bezel) this.mesh(new THREE.TubeGeometry(sphereOutline(r + 0.004, w / 2, h / 2, n, yOff), 144, bezelR, 8, true), bezel, parent);
    return screen;
  }
  private glowSprite(color: string, size: number, opacity = 0.8) {
    const s = new THREE.Sprite(
      this.own(new THREE.SpriteMaterial({ map: materials().tex.glow, color: new THREE.Color(color).multiplyScalar(1.5), transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })),
    );
    s.scale.setScalar(size);
    return s;
  }

  // ------------------------------------------------------------------ archetypes
  private build(opts: CreatureOptions): Parts {
    switch (opts.archetype) {
      case 'explorer':
        return this.buildExplorer();
      case 'scholar':
        return this.buildScholar();
      case 'host':
        return this.buildHost();
      case 'builder':
        return this.buildBuilder();
      default:
        return this.buildSprite();
    }
  }

  private buildExplorer(): Parts {
    const { m } = materials();
    const c = this.colors;
    const R = 0.6;
    const cy = 1.0;
    const shell = this.physical({ color: mix(c.core, c.primary, 0.2), roughness: 0.26, metalness: 0, clearcoat: 0.75, clearcoatRoughness: 0.08 }, 0.26);
    const seam = this.standard({ color: mix(c.core, '#020617', 0.5), roughness: 0.5, metalness: 0.4 });
    const head = new THREE.Group();
    head.position.y = cy;
    this.body.add(head);
    this.mesh(new THREE.SphereGeometry(R, 72, 54), shell, head);
    for (const y of [-0.28, -0.4]) this.mesh(new THREE.TorusGeometry(Math.sqrt(R * R - y * y) + 0.001, 0.007, 6, 80), seam, head, [0, y, 0], [Math.PI / 2, 0, 0]);
    this.mesh(new THREE.TorusGeometry(R + 0.001, 0.007, 6, 80, Math.PI), seam, head, [0, 0, 0], [0, Math.PI / 2, 0]);

    const face = new Face({ kind: 'ring', eye: '#55eaff', alarm: '#ff7a45', bg: '#02050b', mouth: 'glow', squircle: 3.2, eyeX: 0.2, eyeR: 0.125, eyeRy: 0.22, eyeY: 0.47, mouthY: 0.77 }, 256, 182);
    this.sphereFace(face, R, 0.84, 0.6, -0.02, 3.2, head, m.titanium, 0.024);

    // translucent wrap visor across the upper face with a glowing rim
    const glass = this.own(
      new THREE.MeshPhysicalMaterial({ color: '#4fd8ff', roughness: 0.03, transparent: true, opacity: 0.16, emissive: '#0ea5e9', emissiveIntensity: 0.25, side: THREE.DoubleSide, depthWrite: false, clearcoat: 1 }),
    );
    this.mesh(sphereScreen(R + 0.075, 1.1, 0.3, 0.13, 40, 10), glass, head).userData.noShadow = true;
    const edge = this.glowMat(c.glow, 1.6);
    this.mesh(new THREE.TubeGeometry(sphereOutline(R + 0.077, 0.55, 0.15, 6, 0.13), 160, 0.011, 6, true), edge, head).userData.noShadow = true;

    // ear pods
    const ring = this.glowMat(c.glow, 1.8);
    for (const s of [-1, 1]) {
      this.mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.12, 40), m.titanium, head, [s * (R - 0.015), 0.03, 0], [0, 0, Math.PI / 2]);
      this.mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.03, 36), shell, head, [s * (R + 0.055), 0.03, 0], [0, 0, Math.PI / 2]);
      this.mesh(new THREE.TorusGeometry(0.13, 0.014, 8, 40), ring, head, [s * (R + 0.064), 0.03, 0], [0, Math.PI / 2, 0]);
    }

    // three thrusters underneath, each with a soft exhaust glow
    const jets: THREE.Sprite[] = [];
    const down = new THREE.Vector3(0, -1, 0);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
      const x = Math.cos(a) * 0.3;
      const z = Math.sin(a) * 0.3;
      const nozzle = new THREE.Group();
      nozzle.position.set(x, -Math.sqrt(R * R - 0.09) + 0.03, z);
      nozzle.quaternion.setFromUnitVectors(down, new THREE.Vector3(x * 0.8, -1, z * 0.8).normalize());
      this.mesh(new THREE.CylinderGeometry(0.075, 0.095, 0.13, 28), m.gunmetal, nozzle, [0, -0.05, 0]);
      this.mesh(new THREE.TorusGeometry(0.078, 0.013, 8, 28), ring, nozzle, [0, -0.115, 0], [Math.PI / 2, 0, 0]);
      const jet = this.glowSprite(c.glow, 0.22, 0.5);
      jet.position.y = -0.19;
      nozzle.add(jet);
      jets.push(jet);
      head.add(nozzle);
    }

    // detached gauntlet hands held by magnetic fields
    const hands: THREE.Object3D[] = [];
    for (const s of [-1, 1]) {
      const hand = new THREE.Group();
      hand.position.set(s * 0.9, 0.78, 0.1);
      this.mesh(new THREE.CylinderGeometry(0.085, 0.1, 0.1, 28), m.titanium, hand, [0, 0.11, 0]);
      this.mesh(new THREE.TorusGeometry(0.093, 0.012, 8, 28), ring, hand, [0, 0.06, 0], [Math.PI / 2, 0, 0]);
      this.mesh(chamferBox(0.21, 0.17, 0.12, 0.05, 2), shell, hand, [0, -0.03, 0]);
      this.mesh(chamferBox(0.19, 0.045, 0.03, 0.014, 2), m.titanium, hand, [0, -0.09, 0.062]);
      for (let f = 0; f < 3; f++) this.mesh(new THREE.CapsuleGeometry(0.031, 0.075, 4, 10), shell, hand, [(f - 1) * 0.064, -0.175, 0.012], [0.18, 0, (f - 1) * 0.12]);
      this.mesh(new THREE.CapsuleGeometry(0.03, 0.06, 4, 10), shell, hand, [-s * 0.12, -0.035, 0.035], [0, 0, s * 0.95]);
      this.body.add(hand);
      hands.push(hand);
    }
    const holo = this.starChart(c.glow);
    holo.position.set(0, 1.0, 0.9);
    this.body.add(holo);
    return { height: cy + R, headY: cy, headR: R, face, hands: [hands[0], hands[1]], hover: true, jets, holo, glowMats: [ring, edge] };
  }

  private buildScholar(): Parts {
    const { m } = materials();
    const c = this.colors;
    const pts = new THREE.SplineCurve(
      [
        [0.001, 0.05],
        [0.34, 0.07],
        [0.52, 0.17],
        [0.585, 0.36],
        [0.57, 0.56],
        [0.5, 0.76],
        [0.445, 0.92],
        [0.42, 1.06],
        [0.41, 1.2],
        [0.375, 1.34],
        [0.285, 1.47],
        [0.15, 1.545],
        [0.001, 1.565],
      ].map(([x, y]) => new THREE.Vector2(x, y)),
    ).getSpacedPoints(64);
    const radiusAt = (y: number) => {
      for (let i = 1; i < pts.length; i++) {
        if (pts[i].y >= y) {
          const a = pts[i - 1];
          const b = pts[i];
          return THREE.MathUtils.lerp(a.x, b.x, (y - a.y) / Math.max(1e-6, b.y - a.y));
        }
      }
      return 0;
    };
    const velvet = this.physical({ color: mix(c.primary, c.core, 0.5), roughness: 0.72, sheen: 1, sheenRoughness: 0.32, sheenColor: new THREE.Color(c.glow), clearcoat: 0 }, 0.3);
    this.mesh(new THREE.LatheGeometry(pts, 80), velvet, this.body);

    // brushed-silver crown cap hugging the top, with a brass band
    const capY = 1.4;
    const cap = pts.filter((p) => p.y >= capY).map((p) => new THREE.Vector2(p.x + 0.014, p.y + 0.006));
    cap.unshift(new THREE.Vector2(radiusAt(capY) + 0.014, capY));
    cap[cap.length - 1].x = 0;
    const silver = this.standard({ color: '#d9d5e2', metalness: 0.85, roughness: 0.26 });
    this.mesh(new THREE.LatheGeometry(cap, 72), silver, this.body);
    this.mesh(new THREE.TorusGeometry(radiusAt(capY) + 0.016, 0.02, 10, 72), m.brass, this.body, [0, capY, 0], [Math.PI / 2, 0, 0]);
    // darker hem at the base
    this.mesh(new THREE.TorusGeometry(radiusAt(0.2) + 0.004, 0.03, 10, 72), this.standard({ color: mix(c.core, '#0b0614', 0.55), roughness: 0.8 }), this.body, [0, 0.2, 0], [Math.PI / 2, 0, 0]);

    // face decal printed on the velvet (eyes glow amber behind the spectacles)
    const top = 1.27;
    const bottom = 0.72;
    const facePts = pts.filter((p) => p.y > bottom && p.y < top).map((p) => new THREE.Vector2(p.x + 0.008, p.y));
    const eyeLine = 1.01;
    const face = new Face(
      { kind: 'disc', eye: '#ffbe45', alarm: '#ff6a3d', bg: null, mouth: 'ink', ink: '#25103a', pupil: '#2d1405', eyeX: 0.215, eyeR: 0.125, eyeRy: 0.16, eyeY: (top - eyeLine) / (top - bottom), mouthY: (top - 0.84) / (top - bottom) },
      256,
      216,
    );
    const decalMat = this.own(
      new THREE.MeshStandardMaterial({ map: face.texture, emissiveMap: face.texture, emissive: '#ffffff', emissiveIntensity: 1.3, transparent: true, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    const span = 1.56;
    this.mesh(new THREE.LatheGeometry(facePts, 48, -span / 2, span), decalMat, this.body).userData.noShadow = true;

    // round champagne-brass spectacles
    const lensR = 0.13;
    const ang = 0.215 * span;
    const er = radiusAt(eyeLine) + 0.04;
    const outer: THREE.Vector3[] = [];
    for (const s of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(Math.sin(s * ang) * er, eyeLine, Math.cos(s * ang) * er);
      g.rotation.y = s * ang;
      this.mesh(new THREE.TorusGeometry(lensR, 0.018, 12, 48), m.brass, g);
      this.mesh(new THREE.CircleGeometry(lensR, 40), m.glass, g, [0, 0, 0.004]).userData.noShadow = true;
      this.body.add(g);
      g.updateMatrix();
      outer.push(new THREE.Vector3(s * lensR, 0, 0).applyMatrix4(g.matrix));
    }
    this.mesh(new THREE.TorusGeometry(0.035, 0.012, 8, 16, Math.PI), m.brass, this.body, [0, eyeLine + 0.008, er + 0.002]);
    for (const [i, s] of [-1, 1].entries()) {
      const back = new THREE.Vector3(s * (radiusAt(eyeLine + 0.02) - 0.01), eyeLine + 0.02, 0.06);
      this.rod(outer[i], back, 0.009, m.brass, this.body);
    }

    const plum = this.standard({ color: '#2b1838', roughness: 0.6, metalness: 0.2 });
    const arms = this.arms(velvet, m.brass, plum, 0.52, 0.74, 0.085, 0.3);
    for (const s of [-1, 1]) this.mesh(new THREE.SphereGeometry(0.15, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), plum, this.body, [s * 0.21, 0, 0.1], undefined, [1, 0.62, 1.3]);

    const holo = this.tablet('#ffbf47');
    holo.position.set(0, 0.7, 0.66);
    holo.rotation.x = -0.95;
    this.body.add(holo);
    return { height: 1.57, headY: eyeLine, headR: radiusAt(eyeLine), face, arms, hover: false, holo, glowMats: [] };
  }

  private buildHost(): Parts {
    const { m } = materials();
    const c = this.colors;
    const shell = this.physical({ color: mix(c.primary, c.core, 0.58).offsetHSL(0, 0.06, 0), roughness: 0.24, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08 }, 0.22);
    const plate = this.physical({ color: mix(c.primary, '#ffffff', 0.08), roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 }, 0.2);
    const dark = this.standard({ color: '#141922', roughness: 0.42, metalness: 0.35 });
    const silver = this.standard({ color: '#d7dde6', roughness: 0.28, metalness: 0.9 });

    // legs and boots
    for (const s of [-1, 1]) {
      this.mesh(new THREE.CapsuleGeometry(0.1, 0.1, 6, 20), shell, this.body, [s * 0.14, 0.25, 0]);
      this.mesh(new THREE.TorusGeometry(0.1, 0.018, 8, 24), dark, this.body, [s * 0.14, 0.27, 0], [Math.PI / 2, 0, 0]);
      this.mesh(chamferBox(0.21, 0.13, 0.29, 0.06, 2), shell, this.body, [s * 0.14, 0.075, 0.035]);
      this.mesh(chamferBox(0.22, 0.04, 0.3, 0.016, 2), dark, this.body, [s * 0.14, 0.02, 0.035]);
    }
    // torso: an egg with a lighter chest plate, two status lights and a waist ring
    const torso = new THREE.Group();
    torso.position.y = 0.62;
    torso.scale.set(1.06, 1.12, 0.92);
    this.body.add(torso);
    this.mesh(new THREE.SphereGeometry(0.33, 56, 40), shell, torso);
    this.mesh(sphereScreen(0.336, 0.36, 0.26, 0.05), plate, torso);
    this.mesh(new THREE.TubeGeometry(sphereOutline(0.337, 0.18, 0.13, 4, 0.05), 96, 0.01, 6, true), silver, torso);
    const mint = this.glowMat(c.glow, 2);
    for (const s of [-1, 1]) this.mesh(new THREE.SphereGeometry(0.02, 12, 8), mint, torso, [s * 0.06, 0.02, 0.332]);
    this.mesh(new THREE.TorusGeometry(0.3, 0.02, 8, 56), dark, torso, [0, -0.17, 0], [Math.PI / 2, 0, 0]);

    // helmet head with a big screen visor, pivoting at the neck
    const head = new THREE.Group();
    head.position.y = 0.88;
    this.body.add(head);
    const hr = 0.46;
    const hy = 0.42;
    const helmet = new THREE.Group();
    helmet.position.y = hy;
    helmet.scale.set(1.1, 0.97, 1);
    head.add(helmet);
    this.mesh(new THREE.SphereGeometry(hr, 72, 52), shell, helmet);
    const face = new Face({ kind: 'dots', eye: '#ffd25a', alarm: '#ff7045', bg: '#03060b', mouth: 'glow', squircle: 3.6, eyeX: 0.19, eyeR: 0.12, eyeRy: 0.2, eyeY: 0.45, mouthY: 0.77, dotStep: 5 }, 256, 172);
    this.sphereFace(face, hr, 0.68, 0.46, -0.03, 3.6, helmet, silver, 0.022);

    // studio over-ear headphones (outside the scaled helmet so they keep their shape)
    const graphite = this.standard({ color: '#2a303b', roughness: 0.4, metalness: 0.55 });
    const ex = hr * 1.1 + 0.02;
    this.mesh(new THREE.TorusGeometry(ex + 0.005, 0.045, 14, 64, Math.PI), graphite, head, [0, hy + 0.02, 0]);
    this.mesh(new THREE.TorusGeometry(ex + 0.005, 0.022, 10, 64, Math.PI), silver, head, [0, hy + 0.02, 0.035]);
    for (const s of [-1, 1]) {
      this.mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.13, 40), graphite, head, [s * (ex + 0.02), hy, 0], [0, 0, Math.PI / 2]);
      this.mesh(new THREE.TorusGeometry(0.13, 0.04, 12, 40), dark, head, [s * (ex - 0.05), hy, 0], [0, Math.PI / 2, 0]);
      this.mesh(new THREE.TorusGeometry(0.125, 0.015, 8, 40), mint, head, [s * (ex + 0.088), hy, 0], [0, Math.PI / 2, 0]);
      this.mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.01, 32), silver, head, [s * (ex + 0.087), hy, 0], [0, 0, Math.PI / 2]);
    }
    const boom = new THREE.CatmullRomCurve3([new THREE.Vector3(ex + 0.06, hy - 0.08, 0.06), new THREE.Vector3(ex - 0.02, hy - 0.25, 0.28), new THREE.Vector3(0.2, hy - 0.3, 0.44)]);
    this.mesh(new THREE.TubeGeometry(boom, 20, 0.014, 6), graphite, head);
    this.mesh(new THREE.SphereGeometry(0.04, 16, 12), dark, head, [0.19, hy - 0.3, 0.45]);

    const arms = this.arms(shell, dark, dark, 0.37, 0.84, 0.085, 0.18);
    const holo = this.soundRings(c.glow, ex + 0.16);
    holo.position.set(0, hy, 0);
    head.add(holo);
    return { height: 0.88 + hy + hr * 0.97, headY: 0.88 + hy, headR: hr, face, head, arms, hover: false, holo, glowMats: [mint] };
  }

  private buildBuilder(): Parts {
    const { m } = materials();
    const c = this.colors;
    const paint = this.physical({ color: mix(c.primary, c.core, 0.5), roughness: 0.32, metalness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.16 }, 0.25);
    const steel = this.standard({ color: '#b8c0cc', metalness: 0.85, roughness: 0.3 });
    const dark = this.standard({ color: '#1b1f28', roughness: 0.55, metalness: 0.4 });
    const leather = this.standard({ color: '#6a4026', roughness: 0.78 });

    // legs and boots
    for (const s of [-1, 1]) {
      this.mesh(chamferBox(0.17, 0.2, 0.19, 0.05, 2), paint, this.body, [s * 0.17, 0.24, 0]);
      this.mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.2, 20), m.gunmetal, this.body, [s * 0.17, 0.33, 0], [0, 0, Math.PI / 2]);
      this.mesh(chamferBox(0.22, 0.11, 0.3, 0.04, 2), dark, this.body, [s * 0.17, 0.055, 0.04]);
    }
    // body with a vented chest and rivets
    this.mesh(chamferBox(0.74, 0.5, 0.56, 0.11), paint, this.body, [0, 0.6, 0]);
    this.mesh(chamferBox(0.36, 0.2, 0.03, 0.025, 2), steel, this.body, [0, 0.66, 0.285]);
    for (let i = 0; i < 3; i++) this.mesh(new THREE.BoxGeometry(0.26, 0.022, 0.02), dark, this.body, [0, 0.72 - i * 0.055, 0.302]);
    for (const [x, y] of [[-0.3, 0.8], [0.3, 0.8], [-0.3, 0.42], [0.3, 0.42]] as const) this.mesh(new THREE.SphereGeometry(0.022, 10, 8), m.brass, this.body, [x, y, 0.282]);

    // leather tool belt with hanging tools
    this.mesh(chamferBox(0.8, 0.1, 0.62, 0.03, 2), leather, this.body, [0, 0.4, 0]);
    this.mesh(chamferBox(0.13, 0.09, 0.03, 0.015, 2), m.brass, this.body, [0, 0.4, 0.315]);
    this.mesh(chamferBox(0.08, 0.04, 0.03, 0.01, 2), leather, this.body, [0, 0.4, 0.33]);
    this.tools(steel, leather, dark);

    // head pivoting at the neck
    const head = new THREE.Group();
    head.position.y = 0.86;
    this.body.add(head);
    const hy = 0.32;
    this.mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.12, 24), m.gunmetal, head, [0, 0.02, 0]);
    this.mesh(chamferBox(0.88, 0.62, 0.72, 0.15), paint, head, [0, hy, 0]);
    this.mesh(chamferBox(0.8, 0.09, 0.66, 0.04, 2), steel, head, [0, hy + 0.315, 0]);
    // steel faceplate, glowing eyes behind goggle frames
    this.mesh(chamferBox(0.74, 0.46, 0.05, 0.05, 2), steel, head, [0, hy - 0.02, 0.355]);
    const face = new Face({ kind: 'disc', eye: '#ffb03a', alarm: '#ff5a3a', bg: '#05070b', mouth: 'glow', pupil: '#3b1e04', squircle: 5, eyeX: 0.215, eyeR: 0.13, eyeRy: 0.26, eyeY: 0.42, mouthY: 0.82 }, 256, 150);
    this.mesh(new THREE.PlaneGeometry(0.64, 0.375), this.screenMat(face), head, [0, hy - 0.025, 0.383]);
    const gx = 0.215 * 0.64;
    const gy = hy - 0.025 + (0.5 - 0.42) * 0.375;
    for (const s of [-1, 1]) this.mesh(new THREE.TubeGeometry(flatOutline(0.11, 0.095, 4), 72, 0.022, 8, true), dark, head, [s * gx, gy, 0.392]);
    this.mesh(new THREE.BoxGeometry(0.06, 0.03, 0.03), dark, head, [0, gy + 0.02, 0.392]);
    // goggle strap around the head and ear bolts
    this.mesh(chamferBox(0.91, 0.07, 0.74, 0.03, 2), dark, head, [0, gy, -0.02]);
    for (const s of [-1, 1]) {
      this.mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.07, 28), m.gunmetal, head, [s * 0.46, hy - 0.02, 0], [0, 0, Math.PI / 2]);
      this.mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 6), m.brass, head, [s * 0.48, hy - 0.02, 0], [0, 0, Math.PI / 2]);
    }
    // flip-up welding visor resting on the brow
    const visor = new THREE.Group();
    visor.position.set(0, hy + 0.31, 0.3);
    visor.rotation.x = -1.05;
    this.mesh(chamferBox(0.66, 0.2, 0.06, 0.03, 2), m.brass, visor, [0, 0.08, 0]);
    this.mesh(
      chamferBox(0.58, 0.14, 0.04, 0.02, 2),
      this.own(new THREE.MeshPhysicalMaterial({ color: '#2a1806', roughness: 0.08, metalness: 0.3, clearcoat: 1, emissive: '#ff8a1a', emissiveIntensity: 0.12 })),
      visor,
      [0, 0.08, 0.025],
    );
    for (const s of [-1, 1]) this.mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 14), m.gunmetal, visor, [s * 0.35, 0.0, 0], [0, 0, Math.PI / 2]);
    head.add(visor);

    const arms = this.arms(paint, m.gunmetal, dark, 0.45, 0.76, 0.075, 0.22, true);
    const holo = this.keyboard(c.glow);
    holo.position.set(0, 0.62, 0.64);
    holo.rotation.x = -1.05;
    this.body.add(holo);
    return { height: 0.86 + hy + 0.36, headY: 0.86 + hy, headR: 0.42, face, head, arms, hover: false, holo, glowMats: [] };
  }

  /** Wrench, screwdriver, hammer and pliers hanging from the builder's belt. */
  private tools(steel: THREE.Material, leather: THREE.Material, dark: THREE.Material) {
    const red = this.standard({ color: '#c2412d', roughness: 0.45 });
    const wood = this.standard({ color: '#8a5a32', roughness: 0.7 });
    const hang = (x: number, z: number, rotY: number) => {
      const g = new THREE.Group();
      g.position.set(x, 0.36, z);
      g.rotation.set(0.08, rotY, 0);
      this.body.add(g);
      return g;
    };
    let g = hang(-0.24, 0.32, 0);
    this.mesh(new THREE.BoxGeometry(0.03, 0.17, 0.014), steel, g, [0, -0.09, 0]);
    this.mesh(new THREE.TorusGeometry(0.03, 0.012, 6, 14, Math.PI * 1.5), steel, g, [0, -0.19, 0], [0, 0, -Math.PI * 0.25]);
    g = hang(-0.13, 0.33, 0);
    this.mesh(new THREE.CylinderGeometry(0.024, 0.02, 0.08, 10), red, g, [0, -0.05, 0]);
    this.mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.1, 6), steel, g, [0, -0.14, 0]);
    g = hang(0.2, 0.33, 0);
    this.mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.18, 8), wood, g, [0, -0.1, 0]);
    this.mesh(chamferBox(0.13, 0.045, 0.045, 0.012, 2), steel, g, [0.02, -0.2, 0]);
    g = hang(0.38, 0.08, Math.PI / 2);
    this.mesh(chamferBox(0.1, 0.14, 0.05, 0.02, 2), leather, g, [0, -0.07, 0]);
    this.mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.08, 6), dark, g, [-0.02, 0.02, 0], [0, 0, 0.2]);
    this.mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.08, 6), dark, g, [0.02, 0.02, 0], [0, 0, -0.2]);
  }

  private buildSprite(): Parts {
    const { m } = materials();
    const c = this.colors;
    const shell = this.physical({ color: mix(c.primary, c.core, 0.45), roughness: 0.24, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08 }, 0.25);
    const dark = this.standard({ color: '#161a22', roughness: 0.5, metalness: 0.3 });
    // a rounded pod on stubby legs; the head is the top of the pod
    this.mesh(new THREE.CapsuleGeometry(0.44, 0.24, 14, 56), shell, this.body, [0, 0.74, 0]);
    this.mesh(new THREE.TorusGeometry(0.44, 0.02, 8, 64), dark, this.body, [0, 0.56, 0], [Math.PI / 2, 0, 0]);
    const head = new THREE.Group();
    head.position.y = 0.86;
    this.body.add(head);
    const face = new Face({ kind: 'ring', eye: c.glow, alarm: '#ff6a45', bg: '#03060b', mouth: 'glow', squircle: 3.4, eyeX: 0.2, eyeR: 0.125, eyeRy: 0.22, eyeY: 0.46, mouthY: 0.78 }, 256, 176);
    this.sphereFace(face, 0.44, 0.66, 0.46, 0.02, 3.4, head, m.titanium, 0.02);
    // antenna nub with a status bead
    this.mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.16, 8), m.gunmetal, head, [0, 0.5, 0]);
    this.mesh(new THREE.SphereGeometry(0.045, 16, 12), this.glowMat(c.glow, 2), head, [0, 0.6, 0]);
    const arms = this.arms(shell, m.gunmetal, dark, 0.46, 0.66, 0.07, 0.2);
    for (const s of [-1, 1]) {
      this.mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.14, 16), m.gunmetal, this.body, [s * 0.17, 0.16, 0]);
      this.mesh(chamferBox(0.2, 0.1, 0.28, 0.045, 2), dark, this.body, [s * 0.17, 0.05, 0.04]);
    }
    const holo = this.panel(c.glow);
    holo.position.set(0, 0.75, 0.7);
    holo.rotation.x = -0.4;
    this.body.add(holo);
    return { height: 1.42, headY: 0.86, headR: 0.44, face, arms, hover: false, holo, glowMats: [] };
  }

  /** Two shoulder pivots with arms hanging along -y. */
  private arms(mat: THREE.Material, cuff: THREE.Material, hand: THREE.Material, x: number, y: number, r: number, len: number, boxy = false): [THREE.Object3D, THREE.Object3D] {
    const out: THREE.Object3D[] = [];
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(s * x, y, 0.02);
      this.mesh(new THREE.SphereGeometry(r * 1.1, 18, 14), cuff, pivot);
      if (boxy) this.mesh(chamferBox(r * 2, len, r * 2, 0.035, 2), mat, pivot, [0, -len / 2 - 0.03, 0]);
      else this.mesh(new THREE.CapsuleGeometry(r, len, 6, 18), mat, pivot, [0, -len / 2 - 0.03, 0]);
      this.mesh(new THREE.TorusGeometry(r * 0.98, 0.016, 8, 22), cuff, pivot, [0, -len - 0.05, 0], [Math.PI / 2, 0, 0]);
      this.mesh(new THREE.SphereGeometry(r * 1.12, 18, 14), hand, pivot, [0, -len - 0.12, 0], undefined, [1, 1.08, 0.86]);
      this.body.add(pivot);
      out.push(pivot);
    }
    return [out[0], out[1]];
  }

  // ------------------------------------------------------------------ work props (shown while WORKING)
  private holoMat(color: string, opacity = 0.85) {
    const { tex } = materials();
    return this.own(new THREE.MeshBasicMaterial({ map: tex.holo, color: new THREE.Color(color).multiplyScalar(2.2), transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
  }
  private panel(color: string) {
    const g = new THREE.Group();
    this.mesh(new THREE.PlaneGeometry(0.56, 0.36), this.holoMat(color), g).userData.noShadow = true;
    return g;
  }
  private tablet(color: string) {
    const g = new THREE.Group();
    const glass = this.own(new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.6), transparent: true, opacity: 0.35, toneMapped: false, side: THREE.DoubleSide, depthWrite: false }));
    this.mesh(new THREE.PlaneGeometry(0.42, 0.3), glass, g).userData.noShadow = true;
    this.mesh(new THREE.PlaneGeometry(0.4, 0.28), this.holoMat(color, 0.9), g, [0, 0, 0.002]).userData.noShadow = true;
    return g;
  }
  private keyboard(color: string) {
    const g = new THREE.Group();
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 96;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(0, 0, 256, 96);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (let r = 0; r < 4; r++) for (let k = 0; k < 14; k++) ctx.fillRect(6 + k * 18 + (r % 2) * 6, 8 + r * 22, 13, 15);
    const t = this.own(new THREE.CanvasTexture(c));
    const mat = this.own(new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(color).multiplyScalar(2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    this.mesh(new THREE.PlaneGeometry(0.62, 0.23), mat, g).userData.noShadow = true;
    return g;
  }
  private soundRings(color: string, x: number) {
    const g = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      for (const s of [-1, 1]) {
        const mat = this.own(new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
        const ring = this.mesh(new THREE.TorusGeometry(0.16, 0.008, 6, 40), mat, g, [s * x, 0, 0], [0, Math.PI / 2, 0]);
        ring.userData.wave = i;
        ring.userData.side = s;
        ring.userData.x = x;
        ring.userData.noShadow = true;
      }
    }
    return g;
  }
  private starChart(color: string) {
    const g = new THREE.Group();
    const r = rng(9);
    const n = 46;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2;
      const rad = 0.08 + r() * 0.3;
      pos[i * 3] = Math.cos(a) * rad;
      pos[i * 3 + 1] = (r() - 0.5) * 0.36;
      pos[i * 3 + 2] = Math.sin(a) * rad * 0.4;
    }
    const geo = this.own(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pm = this.own(new THREE.PointsMaterial({ color: new THREE.Color(color).multiplyScalar(2.4), size: 0.04, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    g.add(new THREE.Points(geo, pm));
    const lines: number[] = [];
    for (let i = 0; i < 14; i++) {
      const a = Math.floor(r() * n);
      const b = Math.floor(r() * n);
      lines.push(pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2], pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]);
    }
    const lg = this.own(new THREE.BufferGeometry());
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    const lm = this.own(new THREE.LineBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.6), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    g.add(new THREE.LineSegments(lg, lm));
    this.mesh(new THREE.TorusGeometry(0.4, 0.004, 4, 64), lm, g, [0, 0, 0], [Math.PI / 2.2, 0, 0]).userData.noShadow = true;
    return g;
  }

  // ------------------------------------------------------------------ state effects
  private buildFx() {
    const top = this.parts.height;
    const { tex, m } = materials();
    const think = new THREE.Group();
    const dotMat = this.own(new THREE.MeshBasicMaterial({ color: new THREE.Color('#c4b5fd').multiplyScalar(2.2), toneMapped: false }));
    const dotGeo = this.own(new THREE.SphereGeometry(0.026, 8, 6));
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const d = new THREE.Mesh(dotGeo, dotMat);
      d.position.set(Math.cos(a) * 0.36, 0, Math.sin(a) * 0.36);
      d.scale.setScalar(0.6 + (i % 3) * 0.3);
      think.add(d);
    }
    const ringLine = this.own(new THREE.MeshBasicMaterial({ color: new THREE.Color('#a78bfa').multiplyScalar(1.4), transparent: true, opacity: 0.45, toneMapped: false }));
    think.add(new THREE.Mesh(this.own(new THREE.TorusGeometry(0.36, 0.004, 4, 64)), ringLine).rotateX(Math.PI / 2));
    think.position.y = top + 0.22;
    think.rotation.x = 0.3;
    this.pivot.add(think);

    const sparkles = new THREE.Group();
    const sparkMat = this.own(new THREE.MeshBasicMaterial({ color: new THREE.Color('#facc15').multiplyScalar(2.6), toneMapped: false, transparent: true }));
    const sparkGeo = this.own(new THREE.OctahedronGeometry(0.045, 0));
    for (let i = 0; i < 10; i++) {
      const s = new THREE.Mesh(sparkGeo, sparkMat);
      s.userData.dir = new THREE.Vector3(Math.cos((i / 10) * Math.PI * 2), 0.6 + this.random() * 0.8, Math.sin((i / 10) * Math.PI * 2) * 0.6).normalize();
      sparkles.add(s);
    }
    sparkles.position.y = top * 0.7;
    this.group.add(sparkles);

    const wait = new THREE.Group();
    const amber = this.own(new THREE.MeshBasicMaterial({ color: new THREE.Color('#f59e0b').multiplyScalar(2.4), toneMapped: false }));
    const pill = this.own(new THREE.MeshBasicMaterial({ color: '#141a2c', transparent: true, opacity: 0.85 }));
    wait.add(new THREE.Mesh(this.own(new THREE.CapsuleGeometry(0.075, 0.2, 4, 12)), pill).rotateZ(Math.PI / 2));
    const waitDot = this.own(new THREE.SphereGeometry(0.03, 10, 8));
    for (let i = 0; i < 3; i++) {
      const d = new THREE.Mesh(waitDot, amber);
      d.position.set((i - 1) * 0.085, 0, 0.06);
      wait.add(d);
    }
    wait.position.y = top + 0.26;
    this.pivot.add(wait);

    const warn = new THREE.Sprite(this.own(new THREE.SpriteMaterial({ map: this.own(warningTexture()), color: new THREE.Color('#ffffff').multiplyScalar(1.8), toneMapped: false, transparent: true })));
    warn.scale.setScalar(0.42);
    warn.position.set(0.34, top + 0.26, 0);
    this.pivot.add(warn);

    const zTex = this.own(glyphTexture('Z', '#dbe7ff'));
    const zzz: THREE.Sprite[] = [];
    for (let i = 0; i < 3; i++) {
      const z = new THREE.Sprite(this.own(new THREE.SpriteMaterial({ map: zTex, transparent: true, opacity: 0, depthWrite: false })));
      z.userData.i = i;
      zzz.push(z);
      this.pivot.add(z);
    }
    const question = new THREE.Sprite(this.own(new THREE.SpriteMaterial({ map: this.own(glyphTexture('?', '#cbd5e1')), transparent: true, opacity: 0.8 })));
    question.scale.setScalar(0.32);
    question.position.set(0.32, top + 0.2, 0);
    this.pivot.add(question);

    const cushion = new THREE.Mesh(this.own(new THREE.SphereGeometry(0.5, 32, 16)), m.cushion);
    cushion.scale.set(1, 0.24, 0.85);
    cushion.position.y = 0.07;
    cushion.castShadow = true;
    this.group.add(cushion);

    const shadow = new THREE.Mesh(this.own(new THREE.PlaneGeometry(1.6, 1.6)), this.own(new THREE.MeshBasicMaterial({ map: tex.glow, color: '#000000', transparent: true, opacity: 0.55, depthWrite: false })));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.015;
    shadow.renderOrder = -1;
    this.group.add(shadow);
    return { think, sparkles, wait, warn, zzz, question, cushion, shadow };
  }

  private addAccessory(a: Accessory) {
    const { m } = materials();
    const top = this.parts.height;
    const hy = this.parts.headY;
    const hr = this.parts.headR;
    const g = this.parts.head ?? this.body;
    const base = this.parts.head ? this.parts.head.position.y : 0;
    const Y = (y: number) => y - base;
    switch (a) {
      case 'antenna':
        this.mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.25, 8), m.gunmetal, g, [0, Y(top + 0.1), 0]);
        this.mesh(new THREE.SphereGeometry(0.05, 16, 12), this.glowMat(this.colors.glow, 2.5), g, [0, Y(top + 0.24), 0]);
        break;
      case 'crown': {
        const gold = this.standard({ color: '#e0b84a', metalness: 0.95, roughness: 0.25 });
        this.mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.1, 24, 1, true), gold, g, [0, Y(top - 0.02), 0]);
        for (let i = 0; i < 5; i++) {
          const a2 = (i / 5) * Math.PI * 2;
          this.mesh(new THREE.ConeGeometry(0.04, 0.1, 8), gold, g, [Math.cos(a2) * 0.18, Y(top + 0.07), Math.sin(a2) * 0.18]);
        }
        break;
      }
      case 'bow':
        for (const s of [-1, 1]) this.mesh(new THREE.ConeGeometry(0.08, 0.16, 12), this.standard({ color: '#e0708f', roughness: 0.6 }), g, [0.22 + s * 0.08, Y(top - 0.05), 0.1], [0, 0, (s * Math.PI) / 2]);
        break;
      case 'leaf':
        this.mesh(new THREE.SphereGeometry(0.09, 16, 10), m.leafLight, g, [0.06, Y(top + 0.06), 0], [0, 0, -0.6], [1.6, 0.35, 0.8]);
        break;
      case 'glasses':
        for (const s of [-1, 1]) this.mesh(new THREE.TorusGeometry(0.09, 0.012, 8, 32), m.brass, g, [s * 0.11, Y(hy + 0.03), hr + 0.04]);
        break;
      case 'headphones':
        this.mesh(new THREE.TorusGeometry(hr + 0.04, 0.025, 10, 40, Math.PI), m.gunmetal, g, [0, Y(hy), 0]);
        for (const s of [-1, 1]) this.mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.08, 24), m.gunmetal, g, [s * (hr + 0.03), Y(hy - 0.03), 0], [0, 0, Math.PI / 2]);
        break;
      case 'scarf':
        this.mesh(new THREE.TorusGeometry(hr * 0.85, 0.06, 10, 32), this.standard({ color: '#c99a4a', roughness: 0.9 }), this.body, [0, hy - hr * 0.75, 0], [Math.PI / 2, 0, 0]);
        break;
      case 'beanie':
        this.mesh(new THREE.SphereGeometry(hr * 0.92, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2.4), this.standard({ color: '#b65a5a', roughness: 0.95 }), g, [0, Y(top - hr * 0.62), 0]);
        break;
      case 'visor':
        this.mesh(new THREE.CylinderGeometry(hr * 0.95, hr * 0.95, 0.06, 32, 1, true, -1.2, 2.4), m.gunmetal, g, [0, Y(top - 0.12), 0]);
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------------ public API
  setState(state: AgentState, immediate = false) {
    if (state === this.state && !immediate) return;
    this.state = state;
    this.stateSince = this.time;
    if (immediate) this.pose = { ...POSE[state] };
  }

  /** Body yaw (radians) the character should turn toward. */
  setFacing(yaw: number) {
    this.facingTarget = yaw;
  }

  setFocused(f: boolean) {
    if (f && !this.focused) this.focusSince = this.time;
    this.focused = f;
  }

  update(dt: number, t: number) {
    this.time = t;
    const p = this.pose;
    const target = POSE[this.state];
    for (const key of ['lift', 'lean', 'tilt', 'spreadL', 'spreadR', 'raiseL', 'raiseR', 'dim'] as const) p[key] = damp(p[key], target[key], 6, dt);
    p.expr = target.expr;

    const age = t - this.stateSince;
    const phase = (t / this.period) * Math.PI * 2 + this.phase;
    const parts = this.parts;
    const s = this.state;
    // A short wave hello right after the agent is selected.
    const sinceFocus = t - this.focusSince;
    const waving = this.focused && (s === 'IDLE' || s === 'ONLINE') && sinceFocus > 0.15 && sinceFocus < 2.8;

    // body: hover or breathe, plus state-specific motion
    let y = p.lift;
    let shakeX = 0;
    let extraTilt = 0;
    if (parts.hover) {
      y += s === 'OFFLINE' ? -0.3 : 0.12 + Math.sin(phase) * 0.07;
      if (s === 'WAITING') y -= 0.05;
    } else {
      y += Math.sin(phase) * 0.012;
      this.body.scale.y = 1 + Math.sin(phase * 2) * 0.012;
    }
    if (s === 'COMPLETED' && age < 1.6) y += Math.max(0, Math.sin((age / 0.8) * Math.PI)) * 0.28;
    if (s === 'ERROR' && age < 1.4) shakeX = Math.sin(age * 55) * 0.02 * (1 - age / 1.4);
    if (this.walking > 0) {
      y += Math.abs(Math.sin(t * 9)) * 0.05;
      extraTilt = Math.sin(t * 9) * 0.05;
    }
    if (s === 'THINKING' && !parts.head) extraTilt += Math.sin(t * 0.9 + this.phase) * 0.05;
    this.pivot.position.set(shakeX, y, 0);
    this.pivot.rotation.set(p.lean, 0, p.tilt + extraTilt);

    // head: looks around, tilts while thinking, bows over work
    if (parts.head) {
      const hd = parts.head;
      const yaw = this.look.x * 2.4 + (s === 'THINKING' ? Math.sin(t * 0.7 + this.phase) * 0.14 : 0);
      const roll = s === 'THINKING' ? 0.15 : s === 'ERROR' ? Math.sin(t * 7) * 0.03 : waving ? 0.1 : Math.sin(phase * 0.5) * 0.015;
      const pitch = s === 'WORKING' ? 0.16 : s === 'OFFLINE' ? 0.28 : s === 'COMPLETED' ? -0.12 : this.look.y * 1.5;
      hd.rotation.set(damp(hd.rotation.x, pitch, 4, dt), damp(hd.rotation.y, yaw, 4, dt), damp(hd.rotation.z, roll, 4, dt));
    }

    // arms
    if (parts.arms) {
      const [L, R] = parts.arms;
      let rl = p.raiseL;
      let rr = p.raiseR;
      let sl = p.spreadL;
      let sr = p.spreadR;
      if (s === 'WORKING') {
        rl += Math.sin(t * 13) * 0.1;
        rr += Math.sin(t * 13 + Math.PI) * 0.1;
      } else if (s === 'COMPLETED') {
        sl += Math.sin(t * 8) * 0.18;
        sr += Math.sin(t * 8 + 1) * 0.18;
      } else if (waving) {
        sr = 2.3 + Math.sin(t * 9) * 0.35;
        rr = 0.3;
      } else if (this.walking > 0) {
        rl += Math.sin(t * 9) * 0.35;
        rr -= Math.sin(t * 9) * 0.35;
      } else {
        sl += Math.sin(phase + 1) * 0.03;
        sr += Math.sin(phase + 2) * 0.03;
      }
      L.rotation.set(-rl, 0, -sl);
      R.rotation.set(-rr, 0, sr);
    }
    if (parts.hands) {
      const [L, R] = parts.hands;
      const b = HANDS[s] ?? [0.9, 0.78, 0.1];
      const bob = (o: number) => Math.sin(phase * 1.3 + o) * 0.04;
      const jitter = s === 'WORKING' ? Math.sin(t * 12) * 0.03 : 0;
      const k = Math.min(1, dt * 5);
      L.position.lerp(TMP.set(-b[0], b[1] + bob(0) + jitter, b[2]), k);
      const rb = s === 'THINKING' ? [0.3, 0.8, 0.62] : waving ? [0.9, 1.45 + Math.sin(t * 9) * 0.08, 0.2] : b;
      R.position.lerp(TMP.set(rb[0], rb[1] + bob(1.7) - jitter, rb[2]), k);
      L.rotation.z = damp(L.rotation.z, s === 'COMPLETED' ? -2.6 : -0.25, 5, dt);
      R.rotation.z = damp(R.rotation.z, s === 'COMPLETED' || waving ? 2.6 : 0.25, 5, dt);
    }
    if (parts.jets) {
      const on = s === 'OFFLINE' ? 0.08 : 1;
      parts.jets.forEach((j, i) => {
        (j.material as THREE.SpriteMaterial).opacity = 0.5 * on * (0.8 + Math.sin(t * 11 + i * 2) * 0.2);
        j.scale.setScalar(0.22 * (0.9 + Math.sin(t * 7 + i) * 0.1));
      });
    }

    // face: blink, glance, expression
    if (t > this.nextBlink) {
      this.blinkUntil = t + 0.13;
      this.nextBlink = t + 3.5 + this.random() * 3 + (this.random() < 0.15 ? -3.2 : 0);
    }
    const blink = t < this.blinkUntil ? 1 - Math.abs((this.blinkUntil - t) / 0.13 - 0.5) * 2 : 0;
    if (t > this.nextGlance) {
      const calm = s === 'IDLE' || s === 'ONLINE' || s === 'WAITING' || s === 'UNKNOWN';
      this.lookTarget.set(calm ? (this.random() - 0.5) * 0.08 : 0, calm ? (this.random() - 0.5) * 0.05 : 0);
      this.nextGlance = t + 2.2 + this.random() * 3.5;
    }
    if (this.focused || s === 'WORKING') this.lookTarget.set(0, s === 'WORKING' ? 0.03 : 0);
    this.look.x = damp(this.look.x, this.lookTarget.x, 5, dt);
    this.look.y = damp(this.look.y, this.lookTarget.y, 5, dt);
    parts.face.draw(p.expr, s === 'OFFLINE' ? 0 : blink, Math.min(1, p.dim * (this.focused ? 1.15 : 1)), this.look.x * 0.5, this.look.y * 0.5);

    // facing
    this.facing = damp(this.facing, this.facingTarget, 4, dt);
    this.group.rotation.y = this.facing;

    // glow materials follow presence
    for (const gm of parts.glowMats) gm.emissiveIntensity = 1.8 * Math.max(0.15, p.dim);

    // props
    const working = s === 'WORKING';
    parts.holo.visible = working;
    if (working) {
      parts.holo.children.forEach((c) => {
        if (c.userData.wave === undefined) return;
        const w = (((t * 0.9 + c.userData.wave / 3) % 1) + 1) % 1;
        c.scale.setScalar(0.6 + w * 1.6);
        c.position.x = c.userData.side * (c.userData.x + w * 0.25);
        ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = (1 - w) * 0.9;
      });
      if (this.archetype === 'explorer') parts.holo.rotation.y = t * 0.6;
      else if (this.archetype !== 'host') parts.holo.position.y = parts.holo.userData.baseY + Math.sin(t * 2.2 + this.phase) * 0.012;
    }
    const fx = this.fx;
    fx.think.visible = s === 'THINKING';
    if (fx.think.visible) fx.think.rotation.y = t * 1.4;
    fx.wait.visible = s === 'WAITING';
    if (fx.wait.visible) fx.wait.children.slice(1).forEach((d, i) => (d.position.y = Math.max(0, Math.sin(t * 5 - i * 0.6)) * 0.04));
    fx.warn.visible = s === 'ERROR';
    if (fx.warn.visible) {
      fx.warn.position.y = this.parts.height + 0.28 + Math.sin(t * 3) * 0.04;
      (fx.warn.material as THREE.SpriteMaterial).opacity = 0.75 + Math.sin(t * 6) * 0.25;
    }
    fx.question.visible = s === 'UNKNOWN';
    fx.cushion.visible = s === 'WAITING' && !parts.hover;
    fx.sparkles.visible = s === 'COMPLETED' && age < 3.2;
    if (fx.sparkles.visible) {
      const cycle = age % 1.6;
      fx.sparkles.children.forEach((c) => {
        c.position.copy(c.userData.dir as THREE.Vector3).multiplyScalar(0.25 + cycle * 0.75);
        c.scale.setScalar(Math.max(0.01, 1 - cycle / 1.6) * 1.2);
        c.rotation.y = t * 4;
      });
    }
    fx.zzz.forEach((z) => {
      z.visible = s === 'OFFLINE';
      if (!z.visible) return;
      const w = (((t * 0.32 + z.userData.i / 3) % 1) + 1) % 1;
      z.position.set(0.24 + w * 0.3, this.parts.height * 0.8 + w * 0.65, 0.1);
      z.scale.setScalar(0.12 + w * 0.16);
      (z.material as THREE.SpriteMaterial).opacity = Math.sin(w * Math.PI) * 0.85;
    });
    // contact shadow tightens and fades as the body rises
    const lift = parts.hover ? y + 0.3 : p.lift;
    fx.shadow.scale.setScalar(0.95 - Math.min(0.3, lift * 0.35));
    (fx.shadow.material as THREE.MeshBasicMaterial).opacity = 0.55 - Math.min(0.25, lift * 0.3);
  }

  dispose() {
    this.parts.face.dispose();
    for (const o of this.owned) o.dispose();
    this.owned = [];
  }
}

const TMP = new THREE.Vector3();

function warningTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(64, 14);
  ctx.lineTo(118, 108);
  ctx.lineTo(10, 108);
  ctx.closePath();
  ctx.fillStyle = 'rgba(40,6,10,0.75)';
  ctx.fill();
  ctx.lineWidth = 9;
  ctx.strokeStyle = '#ff4d4f';
  ctx.stroke();
  ctx.fillStyle = '#ff6b6b';
  ctx.fillRect(58, 44, 12, 36);
  ctx.beginPath();
  ctx.arc(64, 93, 7, 0, Math.PI * 2);
  ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
