import * as THREE from 'three';
import type { EntityId, MapData, WorldGrid } from '@rpg/shared';
import type { ClientState, EntityView } from '../state/ClientState';
import { animateCharacter, buildCharacter, type CharacterRig } from './character';
import { FLICKER, RESOURCE_STYLES, buildStation, type PartStyle } from './models';
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
  private lastFrame = 0;
  private readonly tmp = new THREE.Matrix4();

  constructor(
    private readonly state: ClientState,
    private readonly map: MapData,
    private readonly grid: WorldGrid,
    private readonly hm: Heightmap,
    private readonly info: TileInfo,
  ) {
    const counts = new Map<string, number>();
    for (const p of map.placements) counts.set(p.defKey, (counts.get(p.defKey) ?? 0) + 1);
    for (const [key, styles] of Object.entries(RESOURCE_STYLES)) {
      const capacity = (counts.get(key) ?? 0) + 8;
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
      if (view.data.kind === 'player' || view.data.kind === 'npc') this.placeCharacter(id, obj, view, now, dt);
    }
    for (const pool of this.pools.values()) if (pool.ripple && pool.slotOf.size) this.animateRipples(pool, now);
    this.flickers.forEach((f, i) => {
      const k = 0.8 + Math.sin(now * 0.02 + i) * 0.12 + Math.sin(now * 0.053 + i * 3) * 0.08;
      ((f as THREE.Mesh).material as THREE.MeshLambertMaterial).emissiveIntensity = k;
    });
  }

  private add(view: EntityView): void {
    const { data } = view;
    if (data.kind === 'resource' && data.defKey && this.pools.has(data.defKey)) {
      const pool = this.pools.get(data.defKey)!;
      const slot = pool.free.pop();
      if (slot === undefined) return;
      pool.slotOf.set(data.id, slot);
      pool.entityAt[slot] = data.id;
      this.writeResource(pool, slot, data.x, data.y, 0);
      for (const { mesh } of pool.parts) mesh.boundingSphere = null; // recomputed on next raycast
      return;
    }
    let obj: THREE.Object3D;
    if (data.kind === 'station' || data.kind === 'scenery') obj = buildStation(data.defKey ?? '', (dx, dy) => this.objectAt(data.x + dx, data.y + dy), hash2(data.x, data.y, 5));
    else {
      const style = data.kind === 'npc' ? (data.defKey ?? '') : data.id === this.state.playerId ? 'player' : 'other_player';
      const rig = buildCharacter(style, hash2(data.id, 3) * 100);
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
    const obj = this.meshes.get(id);
    if (obj) {
      this.group.remove(obj);
      this.meshes.delete(id);
      this.rigs.delete(id);
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

  private writeResource(pool: ResourcePool, slot: number, x: number, y: number, t: number): void {
    const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash2(x, y, 7) * Math.PI * 2);
    const size = 0.88 + hash2(x, y, 8) * 0.24;
    // Fishing-spot parts are modelled relative to a water surface at -0.18.
    const ground = pool.ripple ? this.hm.waterAt(x, y) + 0.18 : this.hm.tileCentre(x, y);
    const base = new THREE.Matrix4().compose(new THREE.Vector3(x + 0.5, ground, y + 0.5), rot, new THREE.Vector3(size, size, size));
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
    const moving = (dx !== 0 || dy !== 0) && now - view.movedAt < this.state.tickMs;
    if (moving) this.facing.set(id, Math.atan2(dx, dy));
    const targetYaw = this.facing.get(id) ?? obj.rotation.y;
    obj.rotation.y += shortestAngle(obj.rotation.y, targetYaw) * Math.min(1, dt * 12);
    obj.position.set(pos.x + 0.5, this.hm.groundAt(pos.x + 0.5, pos.y + 0.5), pos.y + 0.5);
    const rig = this.rigs.get(id);
    if (rig) animateCharacter(rig, dt, now, moving, Math.min(1.4, Math.hypot(dx, dy)));
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

function shortestAngle(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
