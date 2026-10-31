// Village runtime: owns the World and one Creature per agent, keeps them in sync with the agent
// list and their real states, and answers picking and camera-target queries for the React layer.

import * as THREE from 'three';
import type { Accessory, AgentState, Archetype } from '../../../shared/types.ts';
import { Creature } from './creature.ts';
import { World, type Resident, type Slot, type WorldOptions } from './world.ts';

export interface AgentView {
  id: string;
  archetype: Archetype;
  color: string;
  accessory?: Accessory;
  scale?: number;
  state: AgentState;
}

interface Member {
  view: AgentView;
  creature: Creature;
  holder: THREE.Group;
  slot: Slot;
  accent: THREE.Color;
}

const CHARACTER_SCALE = 1.3;

export class VillageRuntime {
  readonly world: World;
  private cast = new Map<string, Member>();
  private focused: string | null = null;
  private residents = new Map<Slot, Resident>();
  private raycaster = new THREE.Raycaster();
  private tmp = new THREE.Vector3();

  constructor(opts: WorldOptions) {
    this.world = new World(opts);
  }

  /** Reconciles characters with the agent list. Cheap to call on every state change. */
  sync(agents: AgentView[]) {
    const slots = this.world.assign(agents);
    for (const [id, m] of this.cast) {
      const next = agents.find((a) => a.id === id);
      const redesign = next && (next.archetype !== m.view.archetype || next.color !== m.view.color || next.accessory !== m.view.accessory || (next.scale ?? 1) !== (m.view.scale ?? 1));
      if (!next || redesign) {
        this.world.island.remove(m.holder);
        m.creature.dispose();
        this.cast.delete(id);
      }
    }
    for (const a of agents) {
      const slot = slots.get(a.id)!;
      let m = this.cast.get(a.id);
      if (!m) {
        const creature = new Creature({ id: a.id, archetype: a.archetype, color: a.color, accessory: a.accessory, scale: (a.scale ?? 1) * CHARACTER_SCALE });
        const holder = new THREE.Group();
        holder.add(creature.group);
        this.world.island.add(holder);
        creature.setState(a.state, true);
        m = { view: a, creature, holder, slot, accent: new THREE.Color(a.color) };
        this.cast.set(a.id, m);
      }
      m.view = a;
      m.slot = slot;
      m.accent.set(a.color);
      m.holder.position.copy(slot.home);
      m.creature.setFacing(slot.yaw);
      m.creature.setState(a.state);
      m.creature.setFocused(this.focused === a.id);
    }
    this.residents.clear();
    for (const m of this.cast.values()) this.residents.set(m.slot, { state: m.view.state, accent: m.accent });
  }

  setFocus(id: string | null) {
    this.focused = id;
    for (const [aid, m] of this.cast) m.creature.setFocused(aid === id);
  }

  update(dt: number, t: number) {
    let active = 0;
    for (const m of this.cast.values()) {
      m.creature.update(dt, t);
      if (m.view.state === 'WORKING' || m.view.state === 'THINKING') active++;
    }
    this.world.update(dt, t, this.residents, this.cast.size ? active / this.cast.size : 0);
  }

  /** A handoff packet between two agents' homes. */
  handoff(fromId: string, toId: string) {
    const a = this.cast.get(fromId);
    const b = this.cast.get(toId);
    if (a && b && a !== b) this.world.sendPacket(a.slot, b.slot, a.view.color);
  }

  /** World-space point above an agent's home where its badge floats. */
  badgeAnchor(id: string, out = new THREE.Vector3()) {
    const m = this.cast.get(id);
    if (!m) return null;
    return this.world.toWorld(m.slot.badge, out);
  }

  /** World-space point between the agent and its home, for the camera to frame. */
  focusPoint(id: string, out = new THREE.Vector3()) {
    const m = this.cast.get(id);
    if (!m) return null;
    this.world.toWorld(m.slot.home, out);
    out.y += 0.9;
    return out;
  }

  /** Agent under a normalised device coordinate, by character or by its home. */
  pick(ndc: THREE.Vector2, camera: THREE.Camera): string | null {
    this.raycaster.setFromCamera(ndc, camera);
    const hits = this.raycaster.intersectObject(this.world.island, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o) {
        if (o.userData.agentId) return o.userData.agentId as string;
        o = o.parent;
      }
      // a click on a building selects its resident
      const slot = this.slotOf(h.object);
      if (slot) {
        for (const [id, m] of this.cast) if (m.slot === slot) return id;
      }
    }
    return null;
  }

  private slotOf(obj: THREE.Object3D) {
    for (const s of this.world.slots) {
      if (!s.building) continue;
      let o: THREE.Object3D | null = obj;
      while (o) {
        if (o === s.building.group) return s;
        o = o.parent;
      }
    }
    return null;
  }

  /** Screen position (CSS px) of a world point, or null when behind the camera. */
  project(p: THREE.Vector3, camera: THREE.Camera, w: number, h: number) {
    this.tmp.copy(p).project(camera);
    if (this.tmp.z > 1) return null;
    return { x: (this.tmp.x * 0.5 + 0.5) * w, y: (-this.tmp.y * 0.5 + 0.5) * h };
  }

  dispose() {
    for (const m of this.cast.values()) m.creature.dispose();
    this.cast.clear();
    this.world.dispose();
  }
}
