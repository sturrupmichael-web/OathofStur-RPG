import * as THREE from 'three';
import { PATCH_KINDS, areaAt, glyphForArea, isBow, obstacleAt, type EntityId, type MapData, type PublicEntity, type WorldGrid } from '@rpg/shared';
import type { ClientState, EntityView, HitEvent } from '../state/ClientState';
import { CAST_MS, CAST_RELEASE, CHARACTER_STYLES, SHOOT_MS, SHOOT_RELEASE, activityPhase, animateCharacter, buildCharacter, characterBusy, crossingPose, playCharacter, styleForLook, styleForNpc, townsfolkStyle, withGear, type CharacterRig } from './character';
import { animateCreature, buildCreature, creatureBusy, isCreature, playCreature, setShroud, shotMs, type CreatureRig } from './creatures';
import { disposeModel, shared } from './dispose';
import { Effects } from './effects';
import { buildFurniture } from './furniture';
import { FLICKER, GATE_LEAF, RESOURCE_STYLES, buildStation, type PartStyle } from './models';
import { buildGroundItem } from './itemModels';
import { areaOf, freeze } from './batch';
import type { Heightmap } from './heightmap';
import { GLYPH_COLOURS, ROPE, buildObstacle, buildPatch } from './skillModels';
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
/**
 * An unseen pad over a dropped item's whole square, so a click anywhere
 * near the item takes it, not just on its few pixels. Shared by every item.
 */
const ITEM_PAD = (() => {
  const pad = new THREE.Mesh(shared(new THREE.BoxGeometry(0.96, 0.2, 0.96).translate(0, 0.1, 0)), shared(new THREE.MeshBasicMaterial({ visible: false })));
  pad.userData.itemPad = true;
  return pad;
})();
const CLICK_BOX_MATERIAL = shared(new THREE.MeshBasicMaterial({ visible: false }));

/**
 * Gives a person or creature an unseen box to be clicked by, in place of its
 * skinned meshes: testing the cursor against a posed body means skinning
 * thousands of vertices each time, which is most of the cost of hovering.
 */
function addClickBox(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);
  const toRoot = root.matrixWorld.clone().invert();
  const box = new THREE.Box3();
  const part = new THREE.Box3();
  const m = new THREE.Matrix4();
  root.traverse((o) => {
    if (!(o instanceof THREE.SkinnedMesh)) return;
    o.raycast = () => {};
    if (!o.visible) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    box.union(part.copy(o.geometry.boundingBox!).applyMatrix4(m.multiplyMatrices(toRoot, o.matrixWorld)));
  });
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const pad = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), CLICK_BOX_MATERIAL);
  box.getCenter(pad.position);
  root.add(pad);
}

/** How much a hovered item brightens. */
const ITEM_GLOW = new THREE.Color(0x3a3420);

/** What a player wears and looks like; a change rebuilds their model. */
function outfitKey(data: PublicEntity): string {
  return JSON.stringify([data.gear ?? {}, data.look ?? null]);
}

export class EntityLayer {
  readonly group = new THREE.Group();
  /** Resource pools by model and AREA square (see poolKey), made when first needed. */
  private readonly pools = new Map<string, ResourcePool>();
  private readonly capacity = new Map<string, number>();
  /** One material per part of each resource model, shared by its pools. */
  private readonly resourceMaterials = new Map<string, THREE.MeshLambertMaterial[]>();
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
  /** Rope swings by tile, so the rope can swing with whoever is on it. */
  /** Who has a Hearth Recall ring going. */
  private readonly chanting = new Set<EntityId>();
  private readonly ropes = new Map<string, THREE.Object3D>();
  /** Homestead gate leaves by tile, and when each was last walked through. */
  private readonly gates = new Map<string, { leaf: THREE.Object3D; openedAt: number }>();
  /** The dropped item under the cursor, lit up so it's clear what a click will take. */
  private lit: EntityId | null = null;

  constructor(
    private readonly state: ClientState,
    private readonly map: MapData,
    private readonly grid: WorldGrid,
    private readonly hm: Heightmap,
    private readonly info: TileInfo,
  ) {
    this.group.add(this.effects.group);
    // Pools are per kind and per AREA square, sized from the map's own placements.
    for (const p of map.placements) {
      for (const key of [resourceModel(p.defKey, p.x, p.y), `${p.defKey}_stump`]) {
        const k = poolKey(key, p.x, p.y);
        this.capacity.set(k, (this.capacity.get(k) ?? 0) + 1);
      }
    }

    state.on('added', (v) => this.add(v));
    state.on('removed', (id) => this.remove(id));
    state.on('changed', (v) => {
      // A tree felled or grown back swaps models; a player changing gear or look is rebuilt.
      const gearChanged = v.data.kind === 'player' && this.meshes.get(v.data.id)?.userData.outfit !== outfitKey(v.data);
      // A patch is rebuilt as its crop grows, a build spot as furniture goes up or comes down.
      if (v.data.kind !== 'resource' && !gearChanged && !v.data.patch && !v.data.spot) return;
      const yaw = this.meshes.get(v.data.id)?.rotation.y;
      this.remove(v.data.id);
      this.add(v);
      const obj = this.meshes.get(v.data.id);
      if (yaw !== undefined && obj) {
        obj.rotation.y = yaw;
        obj.updateMatrix(); // still-standing things are frozen in place
      }
    });
    state.on('animation', ({ entityId, kind }) => this.play(entityId, kind, performance.now()));
    // Whoever is hit flinches as the blow lands, unless busy with a move of their own.
    // An archer's arrow or a mage's spell flies first, and the flinch waits for it to land.
    state.on('hit', (hit) => {
      const { attackerId, targetId } = hit;
      const now = performance.now();
      let lands = now + 220;
      const flight = missileFlight(state, hit);
      if (flight && hit.spell) {
        this.effects.bolt(() => this.handOf(attackerId), () => this.chestOf(targetId), now + flight.loose, flight.ms, hit.spell.element, hit.spell.tier, hit.damage === 0);
        lands = now + flight.loose + flight.ms;
      } else if (flight) {
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

  /** True when a hit is only an item's click pad, which anything solid in the way should beat. */
  isItemPad(hit: THREE.Intersection): boolean {
    return !!hit.object.userData.itemPad;
  }

  /** Lights up a dropped item (or none) under the cursor. */
  highlight(id: EntityId | null): void {
    if (id !== null && this.state.entities.get(id)?.data.kind !== 'item') id = null;
    if (id === this.lit) return;
    for (const [target, on] of [[this.lit, false], [id, true]] as const) {
      this.meshes.get(target as EntityId)?.traverse((o) => {
        const mat = (o as THREE.Mesh).material as THREE.MeshLambertMaterial | undefined;
        if (!mat?.emissive || mat.userData.shared) return;
        mat.userData.emissive ??= mat.emissive.clone();
        mat.emissive.copy(mat.userData.emissive as THREE.Color);
        if (on) mat.emissive.add(ITEM_GLOW);
      });
    }
    this.lit = id;
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
    // A gate swings open as someone steps through it, then falls shut.
    for (const view of this.state.entities.values()) {
      const via = view.data.kind === 'player' ? view.data.via : undefined;
      const gate = via && this.gates.get(`${via.x},${via.y}`);
      if (gate && now - view.movedAt < this.state.tickMs) gate.openedAt = view.movedAt;
    }
    for (const gate of this.gates.values()) {
      const open = now - gate.openedAt < this.state.tickMs * 2 ? 1.5 : 0;
      gate.leaf.rotation.y += (open - gate.leaf.rotation.y) * Math.min(1, dt * (open ? 9 : 3));
    }
    // Ropes nobody is swinging on settle back to hanging straight.
    for (const rope of this.ropes.values()) if (!rope.userData.swungAt || now - rope.userData.swungAt > 100) rope.rotation.x *= Math.max(0, 1 - dt * 3);
    this.effects.update(now, dt);
    this.flickers.forEach((f, i) => {
      const k = 0.8 + Math.sin(now * 0.02 + i) * 0.12 + Math.sin(now * 0.053 + i * 3) * 0.08;
      ((f as THREE.Mesh).material as THREE.MeshLambertMaterial).emissiveIntensity = k;
    });
  }

  /**
   * The pool for a resource model in the square at (x, y). Cutting pools by
   * square lets the camera skip the trees and rocks it can't see.
   */
  private poolFor(model: string, x: number, y: number): ResourcePool | undefined {
    const styles = RESOURCE_STYLES[model];
    if (!styles) return undefined;
    const key = poolKey(model, x, y);
    let pool = this.pools.get(key);
    if (pool) return pool;
    let materials = this.resourceMaterials.get(model);
    if (!materials) {
      materials = styles.map(
        (style) =>
          new THREE.MeshLambertMaterial({
            color: 0xffffff,
            map: style.map?.() ?? null,
            emissive: style.emissive ?? 0x000000,
            flatShading: true,
            transparent: !!style.transparent,
            opacity: style.transparent ? 0.75 : 1,
          }),
      );
      this.resourceMaterials.set(model, materials);
    }
    // A few spare slots for anything that grows where the map didn't place it.
    const capacity = (this.capacity.get(key) ?? 0) + 8;
    pool = { parts: [], slotOf: new Map(), entityAt: [], free: [], ripple: false };
    styles.forEach((style, k) => {
      const mesh = new THREE.InstancedMesh(style.geometry, materials[k], capacity);
      mesh.count = 0;
      mesh.castShadow = !style.ripple;
      mesh.receiveShadow = true;
      mesh.userData.pool = pool;
      pool!.parts.push({ style, mesh });
      if (style.ripple) pool!.ripple = true;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
    });
    for (let i = capacity - 1; i >= 0; i--) pool.free.push(i);
    this.pools.set(key, pool);
    return pool;
  }

  private add(view: EntityView): void {
    const { data } = view;
    const model = data.depleted ? `${data.defKey}_stump` : data.defKey && resourceModel(data.defKey, data.x, data.y);
    const pool = data.kind === 'resource' && model ? this.poolFor(model, data.x, data.y) : undefined;
    if (pool) {
      const slot = pool.free.pop();
      if (slot === undefined) return;
      pool.slotOf.set(data.id, slot);
      pool.entityAt[slot] = data.id;
      this.writeResource(pool, slot, data.x, data.y, 0, data.size);
      for (const { mesh } of pool.parts) mesh.boundingSphere = null; // recomputed for the next cull or raycast
      return;
    }
    let obj: THREE.Object3D;
    const obstacle = data.defKey === 'agility_obstacle' ? obstacleAt(data.x, data.y) : undefined;
    if (data.kind === 'item') {
      obj = buildGroundItem(data.defKey ?? '');
      obj.rotation.y = hash2(data.id, 11) * Math.PI * 2;
      const pad = ITEM_PAD.clone();
      pad.rotation.y = -obj.rotation.y; // square to the tile, whichever way the item lies
      obj.add(pad);
    } else if (obstacle) {
      // Laid along the way it is crossed.
      obj = buildObstacle(obstacle.type);
      obj.rotation.y = Math.atan2(obstacle.dir.x, obstacle.dir.y);
      obj.userData.span = [1, 1];
      const rope = obj.getObjectByName(ROPE);
      if (rope) {
        obj.userData.rope = `${data.x},${data.y}`;
        this.ropes.set(obj.userData.rope, rope);
      }
    } else if (data.spot) {
      obj = buildFurniture(data.spot.kind, data.spot.tier, data.spot.room);
    } else if (data.patch) {
      obj = buildPatch(data.name === PATCH_KINDS.allotment.name ? 'allotment' : 'herb', data.patch, hash2(data.x, data.y, 5));
    } else if (data.defKey === 'glyph_shrine') {
      const glyph = glyphForArea(areaAt(this.map, data.x, data.y)?.name);
      obj = buildStation('glyph_shrine', undefined, 0, glyph ? GLYPH_COLOURS[glyph.id] : undefined);
    } else if (data.kind === 'station' || data.kind === 'scenery' || data.kind === 'resource') obj = buildStation(data.defKey ?? '', (dx, dy) => this.objectAt(data.x + dx, data.y + dy), hash2(data.x, data.y, 5));
    else if (data.kind === 'monster' && isCreature(data.defKey ?? '')) {
      const rig = buildCreature(data.defKey as Parameters<typeof buildCreature>[0], hash2(data.id, 3) * 100);
      this.creatures.set(data.id, rig);
      obj = rig.root;
    } else if (data.kind === 'monster') {
      const rig = buildCharacter(CHARACTER_STYLES[data.defKey ?? ''] ? (data.defKey as string) : 'goblin', hash2(data.id, 3) * 100);
      this.rigs.set(data.id, rig);
      obj = rig.root;
    } else if (data.kind === 'player') {
      const look = data.look ? styleForLook(data.look) : CHARACTER_STYLES[data.id === this.state.playerId ? 'player' : 'other_player'];
      const rig = buildCharacter(withGear(look, data.gear), hash2(data.id, 3) * 100, true);
      this.rigs.set(data.id, rig);
      obj = rig.root;
      obj.userData.outfit = outfitKey(data);
    } else {
      const style = styleForNpc(data.defKey ?? '', this.map.defs.npcs[data.defKey ?? '']?.role);
      // Townsfolk with no look of their own each get one, rather than all dressing alike.
      const own = style === 'town_guide' && data.defKey !== 'town_guide' ? townsfolkStyle(hash2(data.id, 17)) : style;
      const rig = buildCharacter(own, hash2(data.id, 3) * 100);
      this.rigs.set(data.id, rig);
      obj = rig.root;
    }
    obj.userData.entityId = data.id;
    if (data.kind === 'player' || data.kind === 'npc' || data.kind === 'monster') addClickBox(obj);
    obj.position.set(data.x + 0.5, this.hm.tileCentre(data.x, data.y), data.y + 0.5);
    // Multi-tile props (tents) are laid out in map axes and keep their rotation.
    if ((data.kind === 'station' || data.kind === 'scenery' || data.kind === 'npc') && !obj.userData.span) obj.rotation.y = data.spot ? this.backToWall(data.x, data.y) : this.faceOpenSide(data.x, data.y);
    const swinging: THREE.Object3D[] = [];
    obj.traverse((o) => {
      if (o.name === FLICKER) this.flickers.push(o);
      if (o.name === GATE_LEAF) this.gates.set(`${data.x},${data.y}`, { leaf: o, openedAt: -Infinity });
      if (o.name === GATE_LEAF || o.name === ROPE) swinging.push(o);
    });
    // Anything that doesn't walk about is fixed in place, bar gates and ropes.
    if (data.kind !== 'player' && data.kind !== 'npc' && data.kind !== 'monster') freeze(obj, swinging);
    this.meshes.set(data.id, obj);
    this.group.add(obj);
  }

  private remove(id: EntityId): void {
    const rope = this.meshes.get(id)?.userData.rope as string | undefined;
    if (rope) this.ropes.delete(rope);
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
      if (this.lit === id) this.lit = null;
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
    const crossing = view.data.crossing;
    const cross = crossing ? crossingPose(crossing.obstacle, this.state.crossProgress(view, now), crossing.fall) : null;
    if (crossing) {
      const sx = Math.sign(crossing.to.x - crossing.from.x);
      const sy = Math.sign(crossing.to.y - crossing.from.y);
      this.facing.set(id, Math.atan2(sx, sy));
      const rope = this.ropes.get(`${crossing.from.x + sx},${crossing.from.y + sy}`);
      if (rope) {
        rope.rotation.x = 0.55 * (1 - 2 * this.state.crossProgress(view, now));
        rope.userData.swungAt = now;
      }
    }
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
    obj.position.set(pos.x + 0.5, this.hm.groundAt(pos.x + 0.5, pos.y + 0.5) + (cross?.lift ?? 0), pos.y + 0.5);
    // Two tiles in a tick is a run.
    const step = Math.hypot(dx, dy);
    const speed = view.via || step >= 1.5 ? 2 : Math.min(1.4, step);
    const dead = !!view.data.dead;
    const rig = this.rigs.get(id);
    if (rig) {
      animateCharacter(rig, dt, now, moving, speed, work ? (view.data.activity ?? 'chop') : fighting ? (rig.archer ? 'aim' : 'fight') : null, dead, turn, cross?.pose ?? null);
      rig.body.rotation.z = cross?.roll ?? 0;
    }
    if (rig && work && !moving && view.data.activity) {
      const u = activityPhase(rig, view.data.activity, now);
      const was = this.workPhase.get(id);
      const at = IMPACT[view.data.activity] ?? [];
      if (u !== null && was !== undefined && at.some((p) => (was < p && u >= p) || (u < was && (p > was || u >= p)))) this.onImpact?.(id, view.data.activity);
      if (u !== null) this.workPhase.set(id, u);
    } else this.workPhase.delete(id);
    // Chanting Hearth Recall: a ring of light gathers at the feet for as long as the chant goes on.
    if (work && view.data.activity === 'recall' && !this.chanting.has(id)) {
      this.chanting.add(id);
      this.effects.fountain(() => (this.state.entities.get(id)?.data.activity === 'recall' ? obj.position.clone() : (this.chanting.delete(id), null)), 0x8fd4ff, now, 7000, 'ring', 45);
    }
    const creature = this.creatures.get(id);
    if (creature) {
      setShroud(creature, !!view.data.shrouded);
      animateCreature(creature, dt, now, moving, speed, fighting, dead);
    }
  }

  /** Plays a one-off animation on anyone: attacks from the server, talking from the conversation box. */
  play(id: EntityId, kind: string, now: number): void {
    const rig = this.rigs.get(id);
    if (rig) playCharacter(rig, kind, now);
    const feet = () => this.meshes.get(id)?.position.clone() ?? null;
    const hands = () => this.handOf(id);
    // Magic: light pouring up round a teleport, falling round an arrival, gold or fire in the hands.
    if (kind === 'teleport') this.effects.fountain(feet, 0xb98cff, now + 200, 1500, 'rise', 90);
    if (kind === 'arrive') this.effects.fountain(feet, 0xb98cff, now, 700, 'fall', 70);
    if (kind === 'gild') this.effects.fountain(hands, 0xffd24a, now + 300, 700, 'hands', 70);
    if (kind === 'forge') this.effects.fountain(hands, 0xff8a2a, now + 250, 800, 'hands', 80);
    const creature = this.creatures.get(id);
    if (creature) playCreature(creature, kind, now);
    if (creature && kind === 'breath') this.effects.breathe(creature, now, shotMs(creature, kind), () => this.chestOf(this.state.entities.get(id)?.data.interacting));
  }

  /** Where a caster's spell leaves from: the staff's head, or the right hand. */
  private handOf(id: EntityId | undefined): THREE.Vector3 | null {
    const rig = id !== undefined ? this.rigs.get(id) : undefined;
    if (!rig) return this.chestOf(id);
    const tip = rig.staffTip ?? rig.handR;
    return tip.getWorldPosition(new THREE.Vector3());
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
  /** Furniture faces into the room with its back to a wall when it can. */
  private backToWall(x: number, y: number): number {
    let best = 0;
    let bestScore = -1;
    for (const [dx, dy, yaw] of [[0, 1, 0], [1, 0, Math.PI / 2], [-1, 0, -Math.PI / 2], [0, -1, Math.PI]] as const) {
      const score = (this.grid.isWalkable(x + dx, y + dy) ? 1 : 0) + (this.grid.isWalkable(x - dx, y - dy) ? 0 : 2);
      if (score > bestScore) [best, bestScore] = [yaw, score];
    }
    return best;
  }

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
 * When an archer's arrow (or a spell) leaves and how long it flies (ms), or
 * null for a blow in reach. Splats and sounds wait for it to land.
 */
export function missileFlight(state: ClientState, hit: Pick<HitEvent, 'attackerId' | 'targetId' | 'spell'>): { loose: number; ms: number } | null {
  const from = state.entities.get(hit.attackerId);
  if (!from || (!hit.spell && !isBow(from.data.gear?.weapon))) return null;
  const to = state.entities.get(hit.targetId);
  const tiles = to ? Math.hypot(to.toX - from.toX, to.toY - from.toY) : 4;
  return hit.spell ? { loose: CAST_MS * CAST_RELEASE, ms: 180 + tiles * 70 } : { loose: SHOOT_MS * SHOOT_RELEASE, ms: 120 + tiles * 45 };
}

/** Points in each work cycle where the tool meets its target. */
const IMPACT: Record<string, number[]> = {
  chop: [0.8],
  mine: [0.78],
  smith: [0.7],
  build: [0.24, 0.49, 0.74],
  net: [0.25, 0.75],
  rod: [0.9],
  cook: [0.1],
  smelt: [0.25],
  fletch: [0.65],
  light: [0.6],
  clean: [0.4, 0.85],
  mix: [0.2, 0.6],
  offer: [0.85],
  inscribe: [0.5],
  rake: [0.85],
  dig: [0.2],
  plant: [0.25],
  pick: [0.5],
  recall: [0.02],
};

function shortestAngle(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** A resource pool's name: its model and the AREA square it covers. */
function poolKey(model: string, x: number, y: number): string {
  return `${model}@${areaOf(x, y)}`;
}

/**
 * The model a resource is drawn with. Plain trees are a mix of kinds by
 * tile, with more pines in the cold north.
 */
function resourceModel(defKey: string, x: number, y: number): string {
  if (defKey !== 'tree') return defKey;
  const h = hash2(x, y, 81);
  const pine = y < 110 ? 0.4 : 0.1;
  if (h < pine) return 'tree_pine';
  if (h < pine + 0.15) return 'tree_birch';
  if (h < pine + 0.27) return 'tree_beech';
  return 'tree';
}
