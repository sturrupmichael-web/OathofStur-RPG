import * as THREE from 'three';
import type { EntityId, MapData, Point, WorldGrid } from '@rpg/shared';
import type { ClientState } from '../state/ClientState';
import { CameraRig } from './CameraRig';
import { BuildingLayer, detectBuildings } from './buildings';
import { EntityLayer } from './EntityLayer';
import { buildTileColors, classifyAreas, tileInfo, type TileInfo } from './palette';
import { SceneryChunks } from './sceneryChunks';
import { buildHeightmap, type Heightmap } from './heightmap';
import { buildTerrain, type TerrainLayer } from './terrain';

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
  private readonly entities: EntityLayer;
  private readonly scenery: SceneryChunks;
  private readonly sun: THREE.DirectionalLight;
  private readonly raycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly hoverOutline: THREE.LineLoop;
  private readonly destinationMarker: THREE.Group;
  private readonly clickPulse: THREE.Mesh;
  private clickPulseAt = -Infinity;
  private hasSnapped = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly map: MapData,
    grid: WorldGrid,
    private readonly state: ClientState,
  ) {
    this.webgl = new THREE.WebGLRenderer({ antialias: true });
    this.webgl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.webgl.shadowMap.enabled = true;
    this.webgl.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.webgl.domElement);

    this.scene.background = new THREE.Color(0x1b2430);
    this.scene.fog = new THREE.Fog(0x1b2430, 120, 220);
    this.scene.add(new THREE.HemisphereLight(0xdfefff, 0x4a4030, 0.85));
    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -28, right: 28, top: 28, bottom: -28, near: 1, far: 120 });
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

    const roofs = this.buildings.roofPickables.filter((r) => r.visible);
    const hits = this.raycaster.intersectObjects([...this.entities.pickables, ...this.terrain.pickables, ...roofs], true);
    for (const hit of hits) {
      if (hit.distance > groundDist + 0.5) break;
      const building = this.buildings.buildingFromHit(hit);
      if (building) return { tile: building.entry, entityId: null, buildingName: building.name };
      const entityId = this.entities.entityFromHit(hit);
      if (entityId !== null) {
        const view = this.state.entities.get(entityId);
        if (view) return { tile: { x: view.data.x, y: view.data.y }, entityId };
      }
      const tileOf = hit.object.userData.tileOf as Int32Array | undefined;
      if (tileOf && hit.instanceId !== undefined) {
        const i = tileOf[hit.instanceId];
        return { tile: { x: i % this.map.width, y: Math.floor(i / this.map.width) }, entityId: null };
      }
    }
    if (!hasGround) return null;
    const tile = { x: Math.floor(groundHit.x), y: Math.floor(groundHit.z) };
    if (tile.x < 0 || tile.y < 0 || tile.x >= this.map.width || tile.y >= this.map.height) return null;
    return { tile, entityId: null };
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
    const rect = this.canvas.getBoundingClientRect();
    return { x: ((v.x + 1) / 2) * rect.width, y: ((1 - v.y) / 2) * rect.height };
  }

  frame(now: number): void {
    const player = this.state.player;
    if (player) {
      const p = this.state.renderPosition(player, now);
      this.rig.update(new THREE.Vector3(p.x + 0.5, this.heightmap.groundAt(p.x + 0.5, p.y + 0.5), p.y + 0.5), !this.hasSnapped);
      this.hasSnapped = true;
    }
    const t = this.rig.target;
    this.sun.position.set(t.x - 30, t.y + 26, t.z + 14); // low sun so slopes cast light and shade
    this.sun.target.position.copy(t);

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
