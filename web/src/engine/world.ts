// The village world: the island, its buildings, conduits, water, sky and the lighting rig, plus
// the slots agents live in. Plain three.js; the React layer owns the renderer, camera and
// characters and feeds real agent states in through update().

import * as THREE from 'three';
import type { AgentState, Archetype } from '../../../shared/types.ts';
import { bokeh, conduit, haze, motes, Packet, ribbon, skyDome, stars, waterfallMaterial, waterMaterial } from './fx.ts';
import { atelier, forge, hexPad, nexus, observatory, spire, type Building, type Resident } from './pavilions.ts';
import { buildTerrain, FACE_CAMERA, ISLAND_ROTATION, LAYOUT, type Site } from './terrain.ts';
import { IDENTITY } from './creature.ts';
import { materials } from './materials.ts';

export type SlotKind = Exclude<Archetype, 'sprite'> | 'pad' | 'plaza';
export type TimeOfDay = 'dawn' | 'day' | 'dusk' | 'night';

export interface Slot {
  id: string;
  kind: SlotKind;
  building: Building | null;
  /** Island-space standing spot and body yaw for the resident. */
  home: THREE.Vector3;
  yaw: number;
  /** Island-space point the status badge hangs over. */
  badge: THREE.Vector3;
  /** Spire → home route that handoff packets travel. */
  route: THREE.Vector3[];
  conduit: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial };
}

const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

interface Look {
  skyTop: string;
  skyMid: string;
  skyBottom: string;
  hemiSky: string;
  hemiGround: string;
  hemi: number;
  key: string;
  keyPower: number;
  keyDir: [number, number, number];
  rim: string;
  rimPower: number;
  stars: number;
  lamps: number;
  water: string;
  fog: string;
}

const LOOKS: Record<TimeOfDay, Look> = {
  night: { skyTop: '#0c1533', skyMid: '#070b1c', skyBottom: '#03050d', hemiSky: '#3a4f8a', hemiGround: '#0c0e18', hemi: 0.95, key: '#93C5FD', keyPower: 2.1, keyDir: [-9, 15, 8], rim: '#a5b4fc', rimPower: 1.0, stars: 1, lamps: 1, water: '#06173a', fog: '#060914' },
  dusk: { skyTop: '#1e1b4b', skyMid: '#4a2a55', skyBottom: '#120b24', hemiSky: '#8b7bd8', hemiGround: '#1a1020', hemi: 0.75, key: '#fdba74', keyPower: 1.9, keyDir: [-14, 7, 9], rim: '#f0abfc', rimPower: 0.9, stars: 0.35, lamps: 0.9, water: '#1a1b4b', fog: '#1c1230' },
  dawn: { skyTop: '#1e3a5f', skyMid: '#6b5b95', skyBottom: '#1b2440', hemiSky: '#c4b5fd', hemiGround: '#1b2030', hemi: 0.8, key: '#fde68a', keyPower: 1.8, keyDir: [14, 8, 8], rim: '#fbcfe8', rimPower: 0.7, stars: 0.2, lamps: 0.6, water: '#16305a', fog: '#2a2a4a' },
  day: { skyTop: '#3f78bd', skyMid: '#9cc3e6', skyBottom: '#5d82ad', hemiSky: '#dbeafe', hemiGround: '#475569', hemi: 1.15, key: '#fff4e0', keyPower: 2.6, keyDir: [6, 16, 8], rim: '#e0f2fe', rimPower: 0.5, stars: 0, lamps: 0.25, water: '#0f4c75', fog: '#9cc3e6' },
};

export interface WorldOptions {
  shadows: 'high' | 'low' | 'off';
  particles: boolean;
}

export class World {
  readonly root = new THREE.Group();
  readonly island = new THREE.Group();
  readonly slots: Slot[] = [];
  readonly moon: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private rim: THREE.DirectionalLight;
  private bounce: THREE.PointLight;
  private sky = skyDome();
  private starField = stars();
  private bokehField = bokeh();
  private moteField: ReturnType<typeof motes> | null = null;
  private hazeField = haze();
  private water = waterMaterial();
  private fall = waterfallMaterial();
  private mist: THREE.Sprite[] = [];
  private lanternGlow = new THREE.MeshStandardMaterial({ color: '#3a2508', emissive: '#ffc777', emissiveIntensity: 2.4 });
  private lanternPool = new THREE.MeshBasicMaterial({ map: materials().tex.glow, color: '#ffb366', transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false });
  private spire = spire();
  private terrain;
  private packets: Packet[] = [];
  private look: Look = { ...LOOKS.night };
  private target: TimeOfDay = 'night';
  private tmpA = new THREE.Color();
  private owned: (THREE.BufferGeometry | THREE.Material)[] = [];
  readonly fog = new THREE.Fog('#060914', 48, 120);

  constructor(opts: WorldOptions) {
    this.root.add(this.sky.mesh, this.starField.points, this.bokehField.group, this.hazeField.group);
    this.island.rotation.y = ISLAND_ROTATION;
    this.root.add(this.island);

    // ---- lights
    this.hemi = new THREE.HemisphereLight('#2e3f73', '#07080f', 0.6);
    this.moon = new THREE.DirectionalLight('#93C5FD', 1.5);
    this.moon.position.set(-9, 15, 8);
    this.moon.castShadow = opts.shadows !== 'off';
    const size = opts.shadows === 'high' ? 2048 : 1024;
    this.moon.shadow.mapSize.set(size, size);
    const cam = this.moon.shadow.camera;
    cam.left = -15;
    cam.right = 15;
    cam.top = 15;
    cam.bottom = -15;
    cam.near = 1;
    cam.far = 60;
    this.moon.shadow.bias = -0.0004;
    this.moon.shadow.normalBias = 0.035;
    this.rim = new THREE.DirectionalLight('#a5b4fc', 1.0);
    this.rim.position.set(10, 6, -12);
    this.root.add(this.hemi, this.moon, this.moon.target, this.rim);

    // ---- terrain, water, waterfall
    this.terrain = buildTerrain(this.lanternGlow, this.lanternPool);
    this.island.add(this.terrain.group);
    const pool = new THREE.ShapeGeometry(new THREE.Shape(this.terrain.poolOutline.map((p) => new THREE.Vector2(p.x, -p.y))), 6);
    pool.rotateX(-Math.PI / 2);
    pool.translate(0, 0.1, 0);
    const poolMesh = new THREE.Mesh(pool, this.water);
    poolMesh.receiveShadow = true;
    const ch = this.terrain.channel;
    const chGeo = new THREE.PlaneGeometry(ch.width, ch.z1 - ch.z0);
    chGeo.rotateX(-Math.PI / 2);
    chGeo.translate(ch.x, 0.09, (ch.z0 + ch.z1) / 2);
    const chMesh = new THREE.Mesh(chGeo, this.water);
    const f = this.terrain.fall;
    const fallGeo = ribbon([V3(f.x, 0.09, f.z - 0.15), V3(f.x, -0.02, f.z + 0.12), V3(f.x, -0.36, f.z + 0.36), V3(f.x, -0.78, f.z + 0.66), V3(f.x, -1.5, f.z + 0.95), V3(f.x, -3.4, f.z + 1.15), V3(f.x, -6.2, f.z + 1.25)], ch.width * 0.9);
    const fallMesh = new THREE.Mesh(fallGeo, this.fall);
    fallMesh.renderOrder = 3;
    this.island.add(poolMesh, chMesh, fallMesh);
    this.owned.push(pool, chGeo, fallGeo);
    const { tex } = materials();
    for (const [y, dz, s] of [[-0.75, 0.8, 1.4], [-1.6, 1.0, 1.8], [-5.2, 1.3, 3.2]] as const) {
      const mist = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.glow, color: '#bfe9ff', transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false }));
      mist.position.set(f.x, y, f.z + dz);
      mist.scale.setScalar(s);
      mist.userData.base = 0.16;
      this.mist.push(mist);
      this.island.add(mist);
    }
    this.bounce = new THREE.PointLight('#06B6D4', 3, 7, 1.6);
    this.bounce.position.set(LAYOUT.pool.x, 0.7, LAYOUT.pool.y);
    this.island.add(this.bounce);

    // ---- spire
    const sp = LAYOUT.spire;
    this.spire.group.position.set(sp.at.x, sp.y, sp.at.y);
    this.island.add(this.spire.group);

    // ---- homes
    const core: [SlotKind, Building, Site][] = [
      ['explorer', observatory(IDENTITY.explorer.primary), LAYOUT.observatory],
      ['scholar', atelier(), LAYOUT.atelier],
      ['host', nexus(IDENTITY.host.primary), LAYOUT.nexus],
      ['builder', forge(IDENTITY.builder.primary), LAYOUT.forge],
    ];
    for (const [kind, building, site] of core) this.addSlot(kind, kind, building, site);
    LAYOUT.pads.forEach((site, i) => this.addSlot(`pad-${i}`, 'pad', hexPad(), site));

    if (opts.particles) {
      this.moteField = motes();
      this.root.add(this.moteField.points);
    }
  }

  private addSlot(id: string, kind: SlotKind, building: Building | null, site: Site) {
    const g = building?.group ?? new THREE.Group();
    g.position.set(site.at.x, site.y, site.at.y);
    g.rotation.y = site.yaw;
    this.island.add(g);
    g.updateMatrixWorld(true);
    const local = building?.home ?? V3(0, 0, 0);
    const home = local.clone().applyMatrix4(g.matrix);
    const badge = V3(home.x, site.y + (building?.roof ?? 2), home.z);
    if (building && kind !== 'pad') {
      // badge over the roof line, nudged toward the porch so it stays near the resident
      const c = V3(site.at.x, 0, site.at.y);
      badge.x = c.x + (home.x - c.x) * 0.45;
      badge.z = c.z + (home.z - c.z) * 0.45;
    }
    const route = this.route(home, site, kind);
    const c = conduit(route);
    this.island.add(c.mesh);
    this.slots.push({ id, kind, building, home, yaw: FACE_CAMERA, badge, route, conduit: { mesh: c.mesh, mat: c.mat } });
  }

  /** Path along the plaza from the spire to a home, skirting the pool and using stairs and the bridge. */
  private route(home: THREE.Vector3, site: Site, kind: SlotKind) {
    const s = LAYOUT.spire.at;
    const front = new THREE.Vector2(Math.sin(site.yaw), Math.cos(site.yaw));
    const pts: THREE.Vector3[] = [];
    let approach: THREE.Vector2;
    const tail: THREE.Vector3[] = [];
    if (kind === 'scholar') {
      approach = new THREE.Vector2(-0.3 - 6 * 0.32 - 0.4, site.at.y);
      tail.push(V3(-0.3 - 6 * 0.32, 0.03, site.at.y), V3(-0.3, site.y + 0.03, site.at.y));
    } else if (kind === 'host') {
      approach = new THREE.Vector2(site.at.x, 0.3 + 6 * 0.32 + 0.4);
      tail.push(V3(site.at.x, 0.03, 0.3 + 6 * 0.32), V3(site.at.x, site.y + 0.03, 0.3));
    } else if (kind === 'pad') {
      approach = site.at.clone().addScaledVector(front, -1.25);
    } else {
      const r = kind === 'explorer' ? 2.5 : 2.6;
      approach = site.at.clone().addScaledVector(front, r);
      tail.push(V3(approach.x - front.x * 0.3, site.y + 0.03, approach.y - front.y * 0.3));
    }
    const dir = approach.clone().sub(s).normalize();
    pts.push(V3(s.x + dir.x * 1.75, 0.03, s.y + dir.y * 1.75));
    // skirt the pool
    const pool = LAYOUT.pool;
    const a = new THREE.Vector2(pts[0].x, pts[0].z);
    const ab = approach.clone().sub(a);
    const t = THREE.MathUtils.clamp(pool.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1);
    const closest = a.clone().addScaledVector(ab, t);
    if (closest.distanceTo(pool) < 2.7) {
      const away = closest.clone().sub(pool);
      if (away.lengthSq() < 1e-4) away.set(-1, -1);
      const w = pool.clone().addScaledVector(away.normalize(), 3.0);
      pts.push(V3(w.x, 0.03, w.y));
    }
    // cross the channel on the bridge when the home is on the far side of it
    const ch = this.terrain.channel;
    const last = pts[pts.length - 1];
    if (approach.y > ch.z0 && (last.x - ch.x) * (approach.x - ch.x) < 0) {
      const bz = ch.z0 + (ch.z1 - ch.z0) * 0.55;
      const side = Math.sign(last.x - ch.x);
      pts.push(V3(ch.x + side * 1.3, 0.03, bz), V3(ch.x, 0.42, bz), V3(ch.x - side * 1.3, 0.03, bz));
    }
    pts.push(V3(approach.x, 0.03, approach.y), ...tail, V3(home.x, home.y + 0.03, home.z));
    return pts;
  }

  /** Assigns agents to homes: each core archetype's first agent gets its pavilion, the rest get pads. */
  assign(agents: { id: string; archetype: Archetype }[]) {
    const out = new Map<string, Slot>();
    const free = new Set(this.slots);
    for (const a of agents) {
      const s = this.slots.find((x) => x.kind === a.archetype && free.has(x));
      if (s) {
        out.set(a.id, s);
        free.delete(s);
      }
    }
    let extra = 0;
    for (const a of agents) {
      if (out.has(a.id)) continue;
      const s = this.slots.find((x) => x.kind === 'pad' && free.has(x));
      if (s) {
        out.set(a.id, s);
        free.delete(s);
        continue;
      }
      out.set(a.id, this.plazaSlot(extra++));
    }
    return out;
  }

  private plazaSlots: Slot[] = [];
  private plazaSlot(i: number) {
    if (!this.plazaSlots[i]) {
      const s = LAYOUT.spire.at;
      const a = -Math.PI / 4 + (i % 2 ? 1 : -1) * (0.6 + Math.floor(i / 2) * 0.45);
      const home = V3(s.x + Math.sin(a) * 2.4, 0, s.y + Math.cos(a) * 2.4);
      const route = [V3(s.x + Math.sin(a) * 1.75, 0.03, s.y + Math.cos(a) * 1.75), home.clone().setY(0.03)];
      const c = conduit(route);
      this.island.add(c.mesh);
      this.plazaSlots[i] = { id: `plaza-${i}`, kind: 'plaza', building: null, home, yaw: FACE_CAMERA, badge: home.clone().setY(2), route, conduit: { mesh: c.mesh, mat: c.mat } };
    }
    return this.plazaSlots[i];
  }

  /** Sends a glowing packet from one home to another along the conduits, via the spire. */
  sendPacket(from: Slot, to: Slot, color: THREE.ColorRepresentation) {
    const pts = [...from.route.slice().reverse(), ...to.route.slice(1)].map((p) => p.clone());
    const p = new Packet(new THREE.CatmullRomCurve3(pts, false, 'centripetal'), color, 2.4 + pts.length * 0.12);
    this.island.add(p.group);
    this.packets.push(p);
  }

  setTimeOfDay(t: TimeOfDay) {
    this.target = t;
  }

  /** Island-space point to world space. */
  toWorld(p: THREE.Vector3, out = new THREE.Vector3()) {
    return out.copy(p).applyMatrix4(this.island.matrixWorld);
  }

  update(dt: number, t: number, residents: Map<Slot, Resident>, activity: number) {
    // time-of-day crossfade
    const goal = LOOKS[this.target];
    const k = Math.min(1, dt * 0.8);
    const L = this.look;
    for (const key of ['skyTop', 'skyMid', 'skyBottom', 'hemiSky', 'hemiGround', 'key', 'rim', 'water', 'fog'] as const) L[key] = `#${this.tmpA.set(L[key]).lerp(new THREE.Color(goal[key]), k).getHexString()}`;
    for (const key of ['hemi', 'keyPower', 'rimPower', 'stars', 'lamps'] as const) L[key] += (goal[key] - L[key]) * k;
    L.keyDir = L.keyDir.map((v, i) => v + (goal.keyDir[i] - v) * k) as [number, number, number];
    this.sky.mat.uniforms.uTop.value.set(L.skyTop);
    this.sky.mat.uniforms.uMid.value.set(L.skyMid);
    this.sky.mat.uniforms.uBottom.value.set(L.skyBottom);
    this.hemi.color.set(L.hemiSky);
    this.hemi.groundColor.set(L.hemiGround);
    this.hemi.intensity = L.hemi;
    this.moon.color.set(L.key);
    this.moon.intensity = L.keyPower;
    this.moon.position.set(...L.keyDir);
    this.rim.color.set(L.rim);
    this.rim.intensity = L.rimPower;
    this.fog.color.set(L.fog);
    this.starField.mat.uniforms.uOpacity.value = L.stars;
    this.starField.mat.uniforms.uTime.value = t;
    this.water.uniforms.uDeep.value.set(L.water);
    this.water.uniforms.uTime.value = t;
    this.water.uniforms.uSpark.value = 0.4 + L.lamps * 0.6;
    this.fall.uniforms.uTime.value = t;
    this.lanternGlow.emissiveIntensity = 2.4 * L.lamps;
    this.lanternPool.opacity = 0.4 * L.lamps;
    this.bounce.intensity = 3 * (0.4 + L.lamps * 0.6);
    this.bokehField.group.children.forEach((s) => {
      const m = (s as THREE.Sprite).material;
      m.opacity = s.userData.base * (0.6 + 0.4 * Math.sin(t * 0.3 + s.userData.phase)) * (0.3 + L.stars * 0.7);
    });
    this.mist.forEach((m, i) => ((m.material as THREE.SpriteMaterial).opacity = m.userData.base * (0.75 + 0.25 * Math.sin(t * 1.3 + i))));
    if (this.moteField) {
      this.moteField.mat.uniforms.uTime.value = t;
      this.moteField.mat.uniforms.uOpacity.value = 0.25 + L.lamps * 0.75;
    }

    // buildings, conduits, spire
    const vacant: Resident = { state: null, accent: new THREE.Color('#64748b') };
    for (const slot of [...this.slots, ...this.plazaSlots]) {
      const r = residents.get(slot) ?? vacant;
      slot.building?.update(dt, t, r);
      const u = slot.conduit.mat.uniforms;
      u.uTime.value = t;
      const active = r.state === 'WORKING' || r.state === 'THINKING';
      const goalLevel = r.state ? (active ? 1.25 : r.state === 'OFFLINE' ? 0.25 : 0.6) : 0.15;
      u.uLevel.value += (goalLevel - u.uLevel.value) * Math.min(1, dt * 2);
      u.uColor.value.set('#9be7ff').lerp(r.accent, r.state ? 0.35 : 0);
    }
    this.spire.update(dt, t, activity);

    // packets
    for (const p of this.packets) p.update(dt);
    for (const p of this.packets.filter((x) => x.done)) {
      this.island.remove(p.group);
      p.dispose();
    }
    this.packets = this.packets.filter((x) => !x.done);
  }

  dispose() {
    for (const s of [...this.slots, ...this.plazaSlots]) {
      s.building?.dispose();
      s.conduit.mesh.geometry.dispose();
      s.conduit.mat.dispose();
    }
    this.spire.dispose();
    this.terrain.dispose();
    this.packets.forEach((p) => p.dispose());
    this.owned.forEach((o) => o.dispose());
    this.water.dispose();
    this.fall.dispose();
    this.lanternGlow.dispose();
    this.lanternPool.dispose();
    this.sky.mesh.geometry.dispose();
    this.sky.mat.dispose();
    this.starField.points.geometry.dispose();
    this.starField.mat.dispose();
    this.bokehField.mats.forEach((m) => m.dispose());
    this.hazeField.mats.forEach((m) => m.dispose());
    this.mist.forEach((m) => m.material.dispose());
    if (this.moteField) {
      this.moteField.points.geometry.dispose();
      this.moteField.mat.dispose();
    }
  }
}

/** Status colour for a state, shared with the HUD. */
export { STATUS_COLOR } from './pavilions.ts';
export type { Resident } from './pavilions.ts';
export type { AgentState };

