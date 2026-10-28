import * as THREE from 'three';
import type { EntityId, MapData, Point, WorldGrid } from '@rpg/shared';
import type { ClientState } from '../state/ClientState';
import { CameraRig } from './CameraRig';
import { freeze } from './batch';
import { BuildingLayer, detectBuildings } from './buildings';
import { EntityLayer } from './EntityLayer';
import { buildTileColors, classifyAreas, tileInfo, type TileInfo } from './palette';
import { SceneryChunks } from './sceneryChunks';
import { buildHeightmap, type Heightmap } from './heightmap';
import { buildTerrain, type TerrainLayer } from './terrain';

/**
 * How much work each frame asks of the graphics card. High is the full look.
 * Balanced (the default) draws at one pixel per screen point with simpler
 * shadow edges, and lowers the resolution further on its own if the frame
 * rate falls under 60. Low also drops shadows and smoothing.
 */
export type Quality = 'high' | 'balanced' | 'low';

const QUALITY: Record<Quality, { pixelRatio: number; shadows: boolean; shadowSize: number; soft: boolean; antialias: boolean; adaptive: boolean; lights: number }> = {
  high: { pixelRatio: 2, shadows: true, shadowSize: 2048, soft: true, antialias: true, adaptive: false, lights: 6 },
  balanced: { pixelRatio: 1, shadows: true, shadowSize: 1024, soft: false, antialias: true, adaptive: true, lights: 3 },
  low: { pixelRatio: 1, shadows: false, shadowSize: 1024, soft: false, antialias: false, adaptive: true, lights: 2 },
};

/** Frame times (ms) either side of 60 fps that make the adaptive resolution step down or back up. */
const SLOW_FRAME = 18.5;
const STEADY_FRAME = 17.4;
/** Lowest share of the full resolution the adaptive step goes to. */
const MIN_SCALE = 0.6;

/** Widest the sun's shadows reach from the camera's centre, in tiles. */
const SHADOW_REACH = 28;

export interface PickResult {
  tile: Point;
  entityId: EntityId | null;
  /** Set when the cursor is over a building's roof. */
  buildingName?: string;
}

/** Owns the Three.js scene. Reads ClientState, never mutates game state. */
export class Renderer {
  readonly rig = new CameraRig();
  readonly terrain: TerrainLayer;
  readonly info: TileInfo;
  readonly tileColors: number[];
  readonly buildings: BuildingLayer;
  readonly heightmap: Heightmap;
  private readonly webgl: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  readonly entities: EntityLayer;
  private readonly scenery: SceneryChunks;
  private readonly sun: THREE.DirectionalLight;
  private readonly raycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly hoverOutline: THREE.LineLoop;
  private readonly destinationMarker: THREE.Group;
  private readonly clickPulse: THREE.Mesh;
  private clickPulseAt = -Infinity;
  private hasSnapped = false;
  private size = { w: 1, h: 1 };
  private quality: Quality;
  /** Share of the quality's resolution in use; below 1 when frames were too slow. */
  private scale = 1;
  /** Smoothed time between frames (ms), and how the frame rate has looked lately. */
  private frameMs = 16.7;
  private lastFrameAt = 0;
  private checkedAt = 0;
  private steadyChecks = 0;

  constructor(
    private readonly container: HTMLElement,
    private readonly map: MapData,
    grid: WorldGrid,
    private readonly state: ClientState,
    quality: Quality = 'balanced',
  ) {
    this.quality = quality;
    // Smoothing can only be chosen as the canvas is made, so a change to it waits for the next visit.
    this.webgl = new THREE.WebGLRenderer({ antialias: QUALITY[quality].antialias });
    container.appendChild(this.webgl.domElement);

    this.scene.background = new THREE.Color(0x1b2430);
    this.scene.fog = new THREE.Fog(0x1b2430, 120, 220);
    this.scene.add(new THREE.HemisphereLight(0xdfefff, 0x4a4030, 0.85));
    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.1);
    Object.assign(this.sun.shadow.camera, { left: -SHADOW_REACH, right: SHADOW_REACH, top: SHADOW_REACH, bottom: -SHADOW_REACH, near: 1, far: 120 });
    this.sun.shadow.bias = -0.0008;
    this.scene.add(this.sun, this.sun.target);

    this.info = tileInfo(map);
    const areas = classifyAreas(map, grid, this.info);
    this.tileColors = buildTileColors(map, this.info, areas);
    const buildings = detectBuildings(map, this.info);
    this.heightmap = buildHeightmap(map, this.info, areas, buildings);
    this.terrain = buildTerrain(map, this.info, this.tileColors, buildings, this.heightmap);
    this.scene.add(this.terrain.group);
    this.buildings = new BuildingLayer(map, grid, this.info, buildings, this.heightmap);
    this.scene.add(this.buildings.group);
    freeze(this.terrain.group);
    freeze(this.buildings.group, this.buildings.moving);
    this.applyQuality();
    this.scenery = new SceneryChunks(map, grid, this.info, areas, this.tileColors, this.heightmap);
    this.scenery.update(map.spawn);
    this.scene.add(this.scenery.group);
    this.entities = new EntityLayer(state, map, grid, this.heightmap, this.info);
    this.scene.add(this.entities.group);

    this.hoverOutline = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(1, 0, 1),
        new THREE.Vector3(0, 0, 1),
      ]),
      new THREE.LineBasicMaterial({ color: 0xfff6c0, transparent: true, opacity: 0.7 }),
    );
    this.hoverOutline.visible = false;
    this.scene.add(this.hoverOutline);

    this.destinationMarker = buildFlag();
    this.destinationMarker.visible = false;
    this.scene.add(this.destinationMarker);

    this.clickPulse = new THREE.Mesh(
      new THREE.RingGeometry(0.18, 0.28, 20).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffe14d, transparent: true, depthWrite: false }),
    );
    this.clickPulse.visible = false;
    this.scene.add(this.clickPulse);

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  get graphics(): Quality {
    return this.quality;
  }

  /** Switches graphics quality at once (all but smoothing, which needs a reload). */
  setQuality(quality: Quality): void {
    if (quality === this.quality) return;
    this.quality = quality;
    this.scale = 1;
    this.applyQuality();
  }

  /** Resolution in use, as a share of the chosen quality's (for the frame-rate readout). */
  get resolutionScale(): number {
    return this.scale;
  }

  /**
   * Holds 60 fps on the adaptive qualities: a slow patch steps the resolution
   * down a notch, and several steady seconds step it back up.
   */
  private adapt(now: number): void {
    const gap = now - this.lastFrameAt;
    this.lastFrameAt = now;
    // A hidden tab or a stall while loading says nothing about the graphics card.
    if (gap <= 0 || gap > 250) return;
    this.frameMs += (gap - this.frameMs) * 0.05;
    if (!QUALITY[this.quality].adaptive || now - this.checkedAt < 1000) return;
    this.checkedAt = now;
    if (this.frameMs > SLOW_FRAME && this.scale > MIN_SCALE) {
      this.scale = Math.max(MIN_SCALE, this.scale - 0.1);
      this.steadyChecks = 0;
      this.webgl.setPixelRatio(this.pixelRatio());
    } else if (this.frameMs < STEADY_FRAME && this.scale < 1 && ++this.steadyChecks >= 5) {
      this.scale = Math.min(1, this.scale + 0.1);
      this.steadyChecks = 0;
      this.webgl.setPixelRatio(this.pixelRatio());
    } else if (this.frameMs >= STEADY_FRAME) this.steadyChecks = 0;
  }

  private pixelRatio(): number {
    return Math.min(window.devicePixelRatio, QUALITY[this.quality].pixelRatio) * this.scale;
  }

  private applyQuality(): void {
    const q = QUALITY[this.quality];
    this.webgl.setPixelRatio(this.pixelRatio());
    const type = q.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    const changed = this.webgl.shadowMap.enabled !== q.shadows || this.webgl.shadowMap.type !== type;
    this.webgl.shadowMap.enabled = q.shadows;
    this.webgl.shadowMap.type = type;
    this.sun.castShadow = q.shadows;
    this.buildings.setLightBudget(q.lights);
    if (this.sun.shadow.mapSize.x !== q.shadowSize) {
      this.sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    // Shaders are built for one kind of shadow; rebuild them for the new one.
    if (changed)
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        for (const mat of Array.isArray(m) ? m : m ? [m] : []) mat.needsUpdate = true;
      });
    if (this.container.clientWidth) this.resize();
  }

  /** Draw calls and triangles for the last frame, for performance checks. */
  get stats(): { calls: number; triangles: number } {
    return { calls: this.webgl.info.render.calls, triangles: this.webgl.info.render.triangles };
  }

  get canvas(): HTMLCanvasElement {
    return this.webgl.domElement;
  }

  /** Screen point -> tile and (if any) entity under the cursor. */
  pick(clientX: number, clientY: number): PickResult | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.rig.camera);

    // The sloped ground first; the y=0 plane is only a fallback off the map.
    const groundHit = new THREE.Vector3();
    const terrainHit = this.raycaster.intersectObjects(this.terrain.ground, false)[0];
    let hasGround = !!terrainHit;
    if (terrainHit) groundHit.copy(terrainHit.point);
    else hasGround = this.raycaster.ray.intersectPlane(this.groundPlane, groundHit) !== null;
    const groundDist = hasGround ? this.raycaster.ray.origin.distanceTo(groundHit) : Infinity;

    const roofs = this.buildings.pickables.filter((r) => r.visible);
    const hits = this.raycaster.intersectObjects([...this.entities.pickables, ...this.terrain.pickables, ...roofs], true);
    // An item's click pad beats anything behind it, except a creature or townsperson standing right there.
    let pad: { pick: PickResult; distance: number } | null = null;
    for (const hit of hits) {
      if (hit.distance > groundDist + 0.5) break;
      if (pad && hit.distance > pad.distance + 0.6) break;
      if (this.entities.isItemPad(hit)) {
        const id = this.entities.entityFromHit(hit);
        const view = id !== null ? this.state.entities.get(id) : undefined;
        if (view && !pad) pad = { pick: { tile: { x: view.data.x, y: view.data.y }, entityId: view.data.id }, distance: hit.distance };
        continue;
      }
      const building = pad ? null : this.buildings.buildingFromHit(hit);
      if (building) return { tile: building.entry, entityId: null, buildingName: building.name };
      const entityId = this.entities.entityFromHit(hit);
      // You never need to click yourself, and you often stand on what you want to pick up.
      if (entityId !== null && entityId === this.state.playerId) continue;
      if (entityId !== null) {
        const view = this.state.entities.get(entityId);
        const person = view && ((view.data.kind === 'monster' && !view.data.dead) || view.data.kind === 'npc');
        if (view && (!pad || person)) return { tile: { x: view.data.x, y: view.data.y }, entityId };
      }
      const tileOf = hit.object.userData.tileOf as Int32Array | undefined;
      if (!pad && tileOf && hit.instanceId !== undefined) {
        const i = tileOf[hit.instanceId];
        return { tile: { x: i % this.map.width, y: Math.floor(i / this.map.width) }, entityId: null };
      }
    }
    if (pad) return pad.pick;
    if (!hasGround) return null;
    const tile = { x: Math.floor(groundHit.x), y: Math.floor(groundHit.z) };
    if (tile.x < 0 || tile.y < 0 || tile.x >= this.map.width || tile.y >= this.map.height) return null;
    return { tile, entityId: null };
  }

  /** Lights up the dropped item under the cursor, if that's what it is. */
  highlight(entityId: EntityId | null): void {
    this.entities.highlight(entityId);
  }

  setHover(tile: Point | null): void {
    this.hoverOutline.visible = !!tile;
    if (!tile) return;
    // Drape the outline over the tile's four corners.
    const pos = this.hoverOutline.geometry.attributes.position as THREE.BufferAttribute;
    const h = this.heightmap;
    const deck = h.isDeck(tile.x, tile.y) ? h.tileCentre(tile.x, tile.y) : null;
    [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([dx, dz], k) => pos.setY(k, (deck ?? h.corner(tile.x + dx, tile.y + dz)) + 0.03));
    pos.needsUpdate = true;
    this.hoverOutline.position.set(tile.x, 0, tile.y);
  }

  showClick(tile: Point): void {
    this.clickPulseAt = performance.now();
    this.clickPulse.position.set(tile.x + 0.5, this.heightmap.tileCentre(tile.x, tile.y) + 0.04, tile.y + 0.5);
  }

  /** World position of an entity, projected to screen pixels (for labels). */
  screenPosition(entityId: EntityId, height: number, now: number): { x: number; y: number } | null {
    const view = this.state.entities.get(entityId);
    if (!view) return null;
    const p = this.state.renderPosition(view, now);
    const v = new THREE.Vector3(p.x + 0.5, height + this.heightmap.groundAt(p.x + 0.5, p.y + 0.5), p.y + 0.5).project(this.rig.camera);
    // The size kept from the last resize: measuring the canvas here would make the browser lay
    // out the page again for every label moved since the last one.
    return { x: ((v.x + 1) / 2) * this.size.w, y: ((1 - v.y) / 2) * this.size.h };
  }

  frame(now: number): void {
    this.adapt(now);
    const player = this.state.player;
    if (player) {
      const p = this.state.renderPosition(player, now);
      this.rig.update(new THREE.Vector3(p.x + 0.5, this.heightmap.groundAt(p.x + 0.5, p.y + 0.5), p.y + 0.5), !this.hasSnapped);
      this.hasSnapped = true;
    }
    const t = this.rig.target;
    this.sun.position.set(t.x - 30, t.y + 26, t.z + 14); // low sun so slopes cast light and shade
    this.sun.target.position.copy(t);
    // Shadows cover what the camera sees and a margin for long shadows cast in from
    // off screen: zoomed in, fewer things cast and the same map gives crisper edges.
    const reach = Math.min(SHADOW_REACH, this.rig.groundReach + 6);
    const sc = this.sun.shadow.camera;
    if (sc.right !== reach) {
      Object.assign(sc, { left: -reach, right: reach, top: reach, bottom: -reach });
      sc.updateProjectionMatrix();
    }

    const dest = this.state.self?.destination;
    this.destinationMarker.visible = !!dest;
    if (dest) this.destinationMarker.position.set(dest.x + 0.5, this.heightmap.tileCentre(dest.x, dest.y), dest.y + 0.5);
    this.destinationMarker.rotation.y = this.rig.yaw;

    const age = (now - this.clickPulseAt) / 450;
    this.clickPulse.visible = age < 1;
    if (age < 1) {
      this.clickPulse.scale.setScalar(1 + age * 1.2);
      (this.clickPulse.material as THREE.MeshBasicMaterial).opacity = 1 - age;
    }

    const self = this.state.player;
    // A zoomed-out camera sees past the usual ring of chunks.
    if (self) this.scenery.update({ x: self.data.x, y: self.data.y }, this.rig.zoom < 0.8);
    this.buildings.update(now, self ? { x: self.data.x, y: self.data.y } : null);
    this.terrain.waterTexture.offset.set((now / 9000) % 1, (now / 14000) % 1);
    this.entities.update(now);
    this.webgl.render(this.scene, this.rig.camera);
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.size = { w, h };
    this.webgl.setSize(w, h);
    this.rig.resize(w, h);
  }
}

/** Small red flag that marks where the player is walking to. */
function buildFlag(): THREE.Group {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 6), new THREE.MeshLambertMaterial({ color: 0xdddddd }));
  pole.position.set(-0.1, 0.3, 0);
  const shape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0.28, -0.09), new THREE.Vector2(0, -0.18)]);
  const cloth = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshLambertMaterial({ color: 0xd8342c, side: THREE.DoubleSide }));
  cloth.position.set(-0.1, 0.6, 0);
  g.add(pole, cloth);
  return g;
}
