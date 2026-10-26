import * as THREE from 'three';
import { isBow, type EntityId, type MapData, type WorldGrid } from '@rpg/shared';
import type { ClientState, EntityView } from '../state/ClientState';
import { CHARACTER_STYLES, SHOOT_MS, SHOOT_RELEASE, activityPhase, animateCharacter, buildCharacter, characterBusy, playCharacter, styleForNpc, withGear, type CharacterRig } from './character';
import { animateCreature, buildCreature, creatureBusy, isCreature, playCreature, shotMs, type CreatureRig } from './creatures';
import { disposeModel } from './dispose';
import { Effects } from './effects';
import { FLICKER, RESOURCE_STYLES, buildGroundItem, buildStation, type PartStyle } from './models';
import type { Heightmap } from './heightmap';
import { hash2, shade, type TileInfo } from './palette';

/** One InstancedMesh per part of a resource model, shared by every node of that type. */
interface ResourcePool {
  parts: { style: PartStyle; mesh: THREE.InstancedMesh }[];
  slotOf: Map<EntityId, number>;
  entityAt: EntityId[];
  free: number[];
  ripple: boolean;
}

/**
 * Draws entities the server has told us about. Resource nodes are instanced
 * (hundreds of trees and rocks); stations and characters are plain meshes.
 */
export class EntityLayer {
  readonly group = new THREE.Group();
  private readonly pools = new Map<string, ResourcePool>();
  private readonly meshes = new Map<EntityId, THREE.Object3D>();
  private readonly facing = new Map<EntityId, number>();
  private readonly flickers: THREE.Object3D[] = [];
  private readonly rigs = new Map<EntityId, CharacterRig>();
  private readonly creatures = new Map<EntityId, CreatureRig>();
  private lastFrame = 0;
  private readonly tmp = new THREE.Matrix4();
  private readonly effects = new Effects();
  /** Called as a working player's tool lands (axe bites, hammer rings), for sound. */
  onImpact: ((id: EntityId, activity: string) => void) | null = null;
  private readonly workPhase = new Map<EntityId, number>();

  constructor(
    private readonly state: ClientState,
    private readonly map: MapData,
    private readonly grid: WorldGrid,
    private readonly hm: Heightmap,
    private readonly info: TileInfo,
  ) {
    this.group.add(this.effects.group);
    const counts = new Map<string, number>();
    for (const p of map.placements) counts.set(p.defKey, (counts.get(p.defKey) ?? 0) + 1);
    for (const [key, styles] of Object.entries(RESOURCE_STYLES)) {
      // Any tree can become a stump, so stump pools are sized for a busy forest.
      const capacity = key.endsWith('_stump') ? 64 : (counts.get(key) ?? 0) + 8;
      const pool: ResourcePool = { parts: [], slotOf: new Map(), entityAt: [], free: [], ripple: false };
      for (const style of styles) {
        const material = new THREE.MeshLambertMaterial({
          color: 0xffffff,
          map: style.map?.() ?? null,
          emissive: style.emissive ?? 0x000000,
          flatShading: true,
          transparent: !!style.transparent,
          opacity: style.transparent ? 0.75 : 1,
        });
        const mesh = new THREE.InstancedMesh(style.geometry, material, capacity);
        mesh.count = 0;
        mesh.castShadow = !style.ripple;
        mesh.receiveShadow = true;
        mesh.userData.pool = pool;
        mesh.frustumCulled = false;
        pool.parts.push({ style, mesh });
        if (style.ripple) pool.ripple = true;
        this.group.add(mesh);
      }
      for (let i = capacity - 1; i >= 0; i--) pool.free.push(i);
      this.pools.set(key, pool);
    }

    state.on('added', (v) => this.add(v));
    state.on('removed', (id) => this.remove(id));
    state.on('changed', (v) => {
      // A tree felled or grown back swaps models; a player changing gear is rebuilt in it.
      const gearChanged = v.data.kind === 'player' && this.meshes.get(v.data.id)?.userData.gear !== JSON.stringify(v.data.gear ?? {});
      if (v.data.kind !== 'resource' && !gearChanged) return;
      const yaw = this.meshes.get(v.data.id)?.rotation.y;
      this.remove(v.data.id);
      this.add(v);
      if (yaw !== undefined) this.meshes.get(v.data.id)!.rotation.y = yaw;
    });
    state.on('animation', ({ entityId, kind }) => this.play(entityId, kind, performance.now()));
    // Whoever is hit flinches as the blow lands, unless busy with a move of their own.
    // An archer's arrow flies first, and the flinch waits for it to land.
    state.on('hit', ({ attackerId, targetId }) => {
      const now = performance.now();
      let lands = now + 220;
      const flight = arrowFlight(state, attackerId, targetId);
      if (flight) {
        this.effects.shoot(() => this.chestOf(attackerId), () => this.chestOf(targetId), now + flight.loose, flight.ms);
        lands = now + flight.loose + flight.ms;
      }
      const rig = this.rigs.get(targetId);
      if (rig && !characterBusy(rig, now)) rig.oneShot = { kind: 'block', start: lands };
      const creature = this.creatures.get(targetId);
      if (creature && !creatureBusy(creature, now)) creature.oneShot = { kind: 'block', start: lands };
    });
  }

  /** Objects to raycast; hits resolve to an entity id via entityFromHit. */
  get pickables(): THREE.Object3D[] {
    const instanced: THREE.Object3D[] = [...this.pools.values()].flatMap((p) => p.parts.filter((x) => !x.style.ripple).map((x) => x.mesh));
    return instanced.concat([...this.meshes.values()]);
  }

  entityFromHit(hit: THREE.Intersection): EntityId | null {
    let o: THREE.Object3D | null = hit.object;
    const pool = o.userData.pool as ResourcePool | undefined;
    if (pool && hit.instanceId !== undefined) return pool.entityAt[hit.instanceId] ?? null;
    while (o) {
      if (o.userData.entityId !== undefined) return o.userData.entityId as EntityId;
      o = o.parent;
    }
    return null;
  }

  update(now: number): void {
    const dt = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 0;
    this.lastFrame = now;
    for (const [id, obj] of this.meshes) {
      const view = this.state.entities.get(id);
      if (!view) continue;
      if (view.data.kind === 'player' || view.data.kind === 'npc' || view.data.kind === 'monster') this.placeCharacter(id, obj, view, now, dt);
    }
    for (const pool of this.pools.values()) if (pool.ripple && pool.slotOf.size) this.animateRipples(pool, now);
    this.effects.update(now, dt);
    this.flickers.forEach((f, i) => {
      const k = 0.8 + Math.sin(now * 0.02 + i) * 0.12 + Math.sin(now * 0.053 + i * 3) * 0.08;
      ((f as THREE.Mesh).material as THREE.MeshLambertMaterial).emissiveIntensity = k;
    });
  }

  private add(view: EntityView): void {
    const { data } = view;
    const poolKey = data.depleted ? `${data.defKey}_stump` : data.defKey;
    if (data.kind === 'resource' && poolKey && this.pools.has(poolKey)) {
      const pool = this.pools.get(poolKey)!;
      const slot = pool.free.pop();
      if (slot === undefined) return;
      pool.slotOf.set(data.id, slot);
      pool.entityAt[slot] = data.id;
      this.writeResource(pool, slot, data.x, data.y, 0, data.size);
      for (const { mesh } of pool.parts) mesh.boundingSphere = null; // recomputed on next raycast
      return;
    }
    let obj: THREE.Object3D;
    if (data.kind === 'item') {
      obj = buildGroundItem(data.defKey ?? '');
      obj.rotation.y = hash2(data.id, 11) * Math.PI * 2;
    } else if (data.kind === 'station' || data.kind === 'scenery') obj = buildStation(data.defKey ?? '', (dx, dy) => this.objectAt(data.x + dx, data.y + dy), hash2(data.x, data.y, 5));
    else if (data.kind === 'monster' && isCreature(data.defKey ?? '')) {
      const rig = buildCreature(data.defKey as Parameters<typeof buildCreature>[0], hash2(data.id, 3) * 100);
      this.creatures.set(data.id, rig);
      obj = rig.root;
    } else if (data.kind === 'monster') {
      const rig = buildCharacter(CHARACTER_STYLES[data.defKey ?? ''] ? (data.defKey as string) : 'goblin', hash2(data.id, 3) * 100);
      this.rigs.set(data.id, rig);
      obj = rig.root;
    } else if (data.kind === 'player') {
      const look = CHARACTER_STYLES[data.id === this.state.playerId ? 'player' : 'other_player'];
      const rig = buildCharacter(withGear(look, data.gear), hash2(data.id, 3) * 100, true);
      this.rigs.set(data.id, rig);
      obj = rig.root;
      obj.userData.gear = JSON.stringify(data.gear ?? {});
    } else {
      const rig = buildCharacter(styleForNpc(data.defKey ?? '', this.map.defs.npcs[data.defKey ?? '']?.role), hash2(data.id, 3) * 100);
      this.rigs.set(data.id, rig);
      obj = rig.root;
    }
    obj.userData.entityId = data.id;
    obj.position.set(data.x + 0.5, this.hm.tileCentre(data.x, data.y), data.y + 0.5);
    // Multi-tile props (tents) are laid out in map axes and keep their rotation.
    if ((data.kind === 'station' || data.kind === 'scenery' || data.kind === 'npc') && !obj.userData.span) obj.rotation.y = this.faceOpenSide(data.x, data.y);
    obj.traverse((o) => {
      if (o.name === FLICKER) this.flickers.push(o);
    });
    this.meshes.set(data.id, obj);
    this.group.add(obj);
  }

  private remove(id: EntityId): void {
    this.facing.delete(id);
    this.workPhase.delete(id);
    const obj = this.meshes.get(id);
    if (obj) {
      // Things come and go all the time (walking about, monsters respawning), so free their buffers.
      this.group.remove(obj);
      obj.traverse((o) => {
        const i = this.flickers.indexOf(o);
        if (i >= 0) this.flickers.splice(i, 1);
      });
      disposeModel(obj);
      this.meshes.delete(id);
      this.rigs.delete(id);
      this.creatures.delete(id);
      return;
    }
    for (const pool of this.pools.values()) {
      const slot = pool.slotOf.get(id);
      if (slot === undefined) continue;
      pool.slotOf.delete(id);
      for (const { mesh } of pool.parts) {
        mesh.setMatrixAt(slot, this.tmp.makeScale(0, 0, 0));
        mesh.instanceMatrix.needsUpdate = true;
      }
      pool.free.push(slot);
      return;
    }
  }

  private writeResource(pool: ResourcePool, slot: number, x: number, y: number, t: number, tiles = 1): void {
    const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash2(x, y, 7) * Math.PI * 2);
    const size = 0.88 + hash2(x, y, 8) * 0.24;
    // Big trees stand in the middle of their square, wider and taller; small
    // ones lean a little off-centre so a wood doesn't look planted in rows.
    const [wide, tall] = tiles === 2 ? [1.75, 1.45] : [1, 1];
    const cx = x + tiles / 2 + (tiles === 1 && !pool.ripple ? (hash2(x, y, 13) - 0.5) * 0.24 : 0);
    const cz = y + tiles / 2 + (tiles === 1 && !pool.ripple ? (hash2(x, y, 14) - 0.5) * 0.24 : 0);
    // Fishing-spot parts are modelled relative to a water surface at -0.18.
    const ground = pool.ripple ? this.hm.waterAt(x, y) + 0.18 : this.hm.groundAt(cx, cz);
    const base = new THREE.Matrix4().compose(new THREE.Vector3(cx, ground, cz), rot, new THREE.Vector3(size * wide, size * tall, size * wide));
    const color = new THREE.Color();
    pool.parts.forEach(({ style, mesh }, k) => {
      const [sx, sy, sz] = style.scale ?? [1, 1, 1];
      const pos = new THREE.Vector3(...style.position);
      let pulse = 1;
      if (style.ripple) {
        const phase = (t / 1600 + hash2(x, y, 9) + k * 0.31) % 1;
        if (style.geometry.type === 'TorusGeometry') pulse = 0.7 + 0.5 * phase;
        else if (style.scale) {
          // Fish shadow circling under the surface.
          const a = t / 900 + hash2(x, y, 12) * 6;
          pos.set(Math.cos(a) * 0.18, pos.y, Math.sin(a) * 0.18);
        } else pos.y += phase * 0.1;
      }
      const euler = new THREE.Euler(...(style.rotation ?? [0, 0, 0]));
      if (style.ripple && style.scale) euler.y = -(t / 900 + hash2(x, y, 12) * 6) - Math.PI / 2;
      const local = new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromEuler(euler), new THREE.Vector3(sx * pulse, sy, sz * pulse));
      mesh.setMatrixAt(slot, this.tmp.multiplyMatrices(base, local));
      mesh.count = Math.max(mesh.count, slot + 1);
      mesh.instanceMatrix.needsUpdate = true;
      if (t === 0) {
        const vary = style.vary ?? 0;
        color.setHex(shade(style.color, 1 - vary + hash2(x, y, 20 + k) * vary * 2));
        mesh.setColorAt(slot, color);
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    });
  }

  private animateRipples(pool: ResourcePool, now: number): void {
    for (const [id, slot] of pool.slotOf) {
      const view = this.state.entities.get(id);
      if (view) this.writeResource(pool, slot, view.data.x, view.data.y, now);
    }
  }

  private placeCharacter(id: EntityId, obj: THREE.Object3D, view: EntityView, now: number, dt: number): void {
    const pos = this.state.renderPosition(view, now);
    const dx = view.toX - view.fromX;
    const dy = view.toY - view.fromY;
    // Keep the legs going a little past the step, so a tick that lands late doesn't stutter the walk.
    const moving = (dx !== 0 || dy !== 0) && now - view.movedAt < this.state.tickMs * 1.2;
    if (moving) this.facing.set(id, Math.atan2(dx, dy));
    const work = view.data.workingOn;
    // Work in hand (fletching) is on your own tile: keep facing whichever way you were.
    if (work && !moving && (work.x !== view.toX || work.y !== view.toY)) this.facing.set(id, Math.atan2(work.x - view.toX, work.y - view.toY));
    // Fighters turn to face their opponent.
    const foe = view.data.interacting !== undefined ? this.state.entities.get(view.data.interacting) : undefined;
    const fighting = !!foe && !view.data.dead;
    if (foe && !moving && !view.data.dead) {
      const at = this.state.renderPosition(foe, now);
      if (at.x !== pos.x || at.y !== pos.y) this.facing.set(id, Math.atan2(at.x - pos.x, at.y - pos.y));
    }
    // Turn at a steady pace that eases in at the end, rather than snapping round.
    const targetYaw = this.facing.get(id) ?? obj.rotation.y;
    const turn = shortestAngle(obj.rotation.y, targetYaw);
    obj.rotation.y += Math.sign(turn) * Math.min(Math.abs(turn), dt * 9, Math.abs(turn) * dt * 14);
    obj.position.set(pos.x + 0.5, this.hm.groundAt(pos.x + 0.5, pos.y + 0.5), pos.y + 0.5);
    const speed = Math.min(1.4, Math.hypot(dx, dy));
    const dead = !!view.data.dead;
    const rig = this.rigs.get(id);
    if (rig) animateCharacter(rig, dt, now, moving, speed, work ? (view.data.activity ?? 'chop') : fighting ? (rig.archer ? 'aim' : 'fight') : null, dead, turn);
    if (rig && work && !moving && view.data.activity) {
      const u = activityPhase(rig, view.data.activity, now);
      const was = this.workPhase.get(id);
      const at = IMPACT[view.data.activity] ?? [];
      if (u !== null && was !== undefined && at.some((p) => (was < p && u >= p) || (u < was && (p > was || u >= p)))) this.onImpact?.(id, view.data.activity);
      if (u !== null) this.workPhase.set(id, u);
    } else this.workPhase.delete(id);
    const creature = this.creatures.get(id);
    if (creature) animateCreature(creature, dt, now, moving, speed, fighting, dead);
  }

  /** Plays a one-off animation on anyone: attacks from the server, talking from the conversation box. */
  play(id: EntityId, kind: string, now: number): void {
    const rig = this.rigs.get(id);
    if (rig) playCharacter(rig, kind, now);
    const creature = this.creatures.get(id);
    if (creature) playCreature(creature, kind, now);
    if (creature && kind === 'breath') this.effects.breathe(creature, now, shotMs(creature, kind), () => this.chestOf(this.state.entities.get(id)?.data.interacting));
  }

  /** Roughly where someone's chest is, in world space, for aiming effects at them. */
  private chestOf(id: EntityId | undefined): THREE.Vector3 | null {
    const obj = id !== undefined ? this.meshes.get(id) : undefined;
    return obj ? obj.position.clone().add(new THREE.Vector3(0, 0.75, 0)) : null;
  }

  /** Turns someone to face someone else (a person you're talking to turns to you). */
  face(id: EntityId, toward: EntityId): void {
    const a = this.state.entities.get(id);
    const b = this.state.entities.get(toward);
    if (a && b && (a.toX !== b.toX || a.toY !== b.toY)) this.facing.set(id, Math.atan2(b.toX - a.toX, b.toY - a.toY));
  }

  private objectAt(x: number, y: number): string | null {
    if (x < 0 || y < 0 || x >= this.map.width || y >= this.map.height) return null;
    const i = y * this.map.width + x;
    return this.info.placementKey[i] ?? this.info.terrainKey[i];
  }

  /** Face NPCs and stations toward a walkable neighbour, preferring south. */
  private faceOpenSide(x: number, y: number): number {
    const options: [number, number, number][] = [
      [0, 1, 0],
      [1, 0, Math.PI / 2],
      [-1, 0, -Math.PI / 2],
      [0, -1, Math.PI],
    ];
    for (const [dx, dy, yaw] of options) if (this.grid.isWalkable(x + dx, y + dy)) return yaw;
    return 0;
  }
}

/**
 * When an archer's arrow leaves the string and how long it flies (ms), or
 * null if the attacker has no bow. Splats and sounds wait for it to land.
 */
export function arrowFlight(state: ClientState, attackerId: EntityId, targetId: EntityId): { loose: number; ms: number } | null {
  const from = state.entities.get(attackerId);
  if (!isBow(from?.data.gear?.weapon)) return null;
  const to = state.entities.get(targetId);
  const tiles = to ? Math.hypot(to.toX - from!.toX, to.toY - from!.toY) : 4;
  return { loose: SHOOT_MS * SHOOT_RELEASE, ms: 120 + tiles * 45 };
}

/** Points in each work cycle where the tool meets its target. */
const IMPACT: Record<string, number[]> = {
  chop: [0.8],
  mine: [0.78],
  smith: [0.7],
  net: [0.25, 0.75],
  rod: [0.9],
  cook: [0.1],
  smelt: [0.25],
  fletch: [0.65],
  light: [0.6],
  clean: [0.4, 0.85],
  mix: [0.2, 0.6],
  offer: [0.85],
};

function shortestAngle(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
