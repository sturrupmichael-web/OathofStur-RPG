import * as THREE from 'three';
import type { MapData, Point, WorldGrid } from '@rpg/shared';
import { Batcher, lambert } from './batch';
import type { Heightmap } from './heightmap';
import { hash2, type TileInfo } from './palette';
import { textures } from './textures';

export const WALL_HEIGHT = 1.3;
export const CITY_WALL_HEIGHT = 1.8;
/** Real point lights, moved to the nearest light spots each frame. */
const LIGHT_POOL = 6;

export type BuildingKind = 'bank' | 'store' | 'smithy' | 'chapel' | 'inn' | 'keep' | 'library' | 'house';

export interface Building {
  /** Wall rectangle, inclusive tile coordinates. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  doors: Point[];
  kind: BuildingKind;
  /** The map's name for it, or '' for an unnamed hut. */
  name: string;
  /** 'round' buildings (The Bourse) have curved walls: a conical roof and no wall trim. */
  shape: 'rect' | 'round';
  /** A floor tile near the middle, used when the roof is clicked. */
  entry: Point;
}

const FLOORS = new Set(['stone_floor', 'wooden_floor']);

const KIND_BY_OBJECT: Record<string, BuildingKind> = {
  bank_booth: 'bank',
  anvil: 'smithy',
  altar: 'chapel',
};

/** Kinds the map's building names imply, checked in order. */
const KIND_BY_NAME: [RegExp, BuildingKind][] = [
  [/keep/i, 'keep'],
  [/chapel|shrine|temple/i, 'chapel'],
  [/bank/i, 'bank'],
  [/smith/i, 'smithy'],
  [/inn|tavern/i, 'inn'],
  [/scriptorium|library/i, 'library'],
  [/store|shop|blades|robe/i, 'store'],
];

/**
 * Finds buildings: the map's named areas whose edge is all wall and door, plus
 * any other floor area enclosed by a rectangle of walls (unnamed huts).
 */
export function detectBuildings(map: MapData, info: TileInfo): Building[] {
  const { width, height } = map;
  const key = (x: number, y: number) => info.terrainKey[y * width + x];
  const buildings: Building[] = [];

  const make = (b: { x0: number; y0: number; x1: number; y1: number }, name: string): Building | null => {
    const doors: Point[] = [];
    let closed = true;
    forEachBorder(b, (x, y) => {
      const k = key(x, y);
      if (k === 'door') doors.push({ x, y });
      else if (k !== 'building_wall') closed = false;
    });
    if (!closed || !doors.length) return null;
    const objects = new Set<string>();
    let floors = 0;
    for (let y = b.y0 + 1; y < b.y1; y++)
      for (let x = b.x0 + 1; x < b.x1; x++) {
        if (FLOORS.has(key(x, y))) floors++;
        const p = info.placementKey[y * width + x];
        if (p) objects.add(p);
      }
    if (!floors) return null;
    let kind: BuildingKind = KIND_BY_NAME.find(([re]) => re.test(name))?.[1] ?? 'house';
    if (kind === 'house') for (const o of objects) kind = KIND_BY_OBJECT[o] ?? kind;
    // Entry: the floor tile nearest the middle (the middle may be an inner wall).
    const mx = (b.x0 + b.x1) / 2;
    const my = (b.y0 + b.y1) / 2;
    let entry = { x: b.x0 + 1, y: b.y0 + 1 };
    for (let y = b.y0 + 1; y < b.y1; y++)
      for (let x = b.x0 + 1; x < b.x1; x++)
        if (FLOORS.has(key(x, y)) && !info.placementKey[y * width + x] && Math.hypot(x - mx, y - my) < Math.hypot(entry.x - mx, entry.y - my)) entry = { x, y };
    return { ...b, doors, kind, name, entry, shape: 'rect' as const };
  };

  /** A named area holding an enclosed floor that isn't a rectangle, like the round Bourse. */
  const makeRound = (a: { x: number; y: number; w: number; h: number; name: string }): Building | null => {
    const inArea = (x: number, y: number) => x >= a.x && y >= a.y && x < a.x + a.w && y < a.y + a.h;
    let start = -1;
    for (let i = 0; i < a.w * a.h && start < 0; i++) {
      const x = a.x + (i % a.w);
      const y = a.y + Math.floor(i / a.w);
      if (FLOORS.has(key(x, y))) start = y * width + x;
    }
    if (start < 0) return null;
    const seen = new Set([start]);
    const stack = [start];
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const doors: Point[] = [];
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % width;
      const y = Math.floor(i / width);
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        const j = ny * width + nx;
        if (seen.has(j)) continue;
        if (!inArea(nx, ny)) return null; // the floor leaks out: not enclosed
        const k = key(nx, ny);
        if (k === 'door') {
          seen.add(j);
          doors.push({ x: nx, y: ny });
        } else if (FLOORS.has(k) || info.placementKey[j]) {
          seen.add(j);
          stack.push(j);
        } else if (k !== 'building_wall') return null;
      }
    }
    const b = { x0: x0 - 1, y0: y0 - 1, x1: x1 + 1, y1: y1 + 1 };
    // It must be the area itself, not a hut somewhere inside a larger district.
    if ((b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1) < a.w * a.h * 0.5) return null;
    const kind = KIND_BY_NAME.find(([re]) => re.test(a.name))?.[1] ?? 'house';
    return { ...b, doors, kind, name: a.name, entry: { x: Math.round((x0 + x1) / 2), y: y1 }, shape: 'round' };
  };

  for (const a of map.areas) {
    if (a.w < 3 || a.h < 3) continue;
    const b = make({ x0: a.x, y0: a.y, x1: a.x + a.w - 1, y1: a.y + a.h - 1 }, a.name) ?? makeRound(a);
    if (b) buildings.push(b);
  }

  const inside = (x: number, y: number) => buildings.some((b) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1);
  const seen = new Uint8Array(width * height);
  for (let start = 0; start < width * height; start++) {
    const sx = start % width;
    const sy = Math.floor(start / width);
    if (seen[start] || !FLOORS.has(info.terrainKey[start]) || inside(sx, sy)) continue;
    const stack = [start];
    seen[start] = 1;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % width;
      const y = Math.floor(i / width);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const j = ny * width + nx;
        if (!seen[j] && (FLOORS.has(info.terrainKey[j]) || info.placementKey[j])) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    if (minX < 1 || minY < 1 || maxX > width - 2 || maxY > height - 2) continue;
    const b = make({ x0: minX - 1, y0: minY - 1, x1: maxX + 1, y1: maxY + 1 }, '');
    if (b) buildings.push(b);
  }
  return buildings;
}

function forEachBorder(b: { x0: number; y0: number; x1: number; y1: number }, fn: (x: number, y: number) => void): void {
  for (let x = b.x0; x <= b.x1; x++) {
    fn(x, b.y0);
    fn(x, b.y1);
  }
  for (let y = b.y0 + 1; y < b.y1; y++) {
    fn(b.x0, y);
    fn(b.x1, y);
  }
}

/** Outward normal of a border tile (corners return their row normal). */
function outward(b: Building, x: number, y: number): [number, number] {
  if (y === b.y0) return [0, -1];
  if (y === b.y1) return [0, 1];
  if (x === b.x0) return [-1, 0];
  return [1, 0];
}

const ROOF_COLORS: Record<BuildingKind, number> = {
  bank: 0x48627f,
  store: 0x9c3f2c,
  smithy: 0x45464f,
  chapel: 0x5d6a78,
  inn: 0xb0623a,
  keep: 0x3e4450,
  library: 0x6a4a7a,
  house: 0x7a5a3a,
};

/** Kinds with a working hearth: they get a chimney and smoke. */
const HEARTH: Partial<Record<BuildingKind, true>> = { smithy: true, inn: true, house: true };

interface RoofState {
  building: Building;
  group: THREE.Group;
  materials: THREE.Material[];
  opacity: number;
}

interface Flame {
  mesh: THREE.Object3D;
  phase: number;
}

interface Smoke {
  puffs: THREE.Mesh[];
  origin: THREE.Vector3;
  roof: RoofState;
}

/**
 * Everything that makes the town's buildings read as buildings: timber trim,
 * windows, door frames, signs, wall-mounted interior props, lights and roofs.
 * The boundary wall around the southeast gets battlements and gate torches.
 */
export class BuildingLayer {
  readonly group = new THREE.Group();
  readonly buildings: Building[];
  readonly roofPickables: THREE.Object3D[] = [];
  private readonly roofs: RoofState[] = [];
  private readonly flames: Flame[] = [];
  private readonly smoke: Smoke[] = [];
  /** Where warm lights belong; a few real lights follow the player between them. */
  private readonly lightSpots: { pos: THREE.Vector3; color: number; intensity: number }[] = [];
  private readonly lights: THREE.PointLight[] = [];
  private lastUpdate = 0;
  roofsEnabled = true;

  constructor(
    private readonly map: MapData,
    private readonly grid: WorldGrid,
    private readonly info: TileInfo,
    buildings: Building[],
    private readonly hm: Heightmap,
  ) {
    this.buildings = buildings;
    const batch = new Batcher((x, z) => hm.groundAt(x, z));
    for (const b of buildings) {
      if (b.shape === 'round') {
        this.addRoundRoof(b);
        continue;
      }
      this.addWallDetail(batch, b);
      this.addInterior(batch, b);
      this.addRoof(b);
    }
    this.addBoundaryDetail(batch);
    this.group.add(batch.build());
    // A fixed number of lights keeps shaders the same size however many rooms there are.
    for (let i = 0; i < LIGHT_POOL; i++) {
      const light = new THREE.PointLight(0xffb060, 0, 6.5, 1.6);
      this.lights.push(light);
      this.group.add(light);
    }
  }

  buildingFromHit(hit: THREE.Intersection): Building | null {
    let o: THREE.Object3D | null = hit.object;
    while (o) {
      if (o.userData.building) return o.userData.building as Building;
      o = o.parent;
    }
    return null;
  }

  update(now: number, player: { x: number; y: number } | null): void {
    const dt = this.lastUpdate ? Math.min(0.25, (now - this.lastUpdate) / 1000) : 0;
    this.lastUpdate = now;
    for (const roof of this.roofs) {
      const b = roof.building;
      const inside = !!player && player.x >= b.x0 && player.x <= b.x1 && player.y >= b.y0 && player.y <= b.y1;
      const target = this.roofsEnabled && !inside ? 1 : 0;
      // Fade over about a third of a second, independent of frame rate.
      const step = dt * 3;
      roof.opacity = target > roof.opacity ? Math.min(target, roof.opacity + step) : Math.max(target, roof.opacity - step);
      roof.group.visible = roof.opacity > 0.02;
      for (const m of roof.materials) {
        const transparent = roof.opacity < 1;
        if (m.transparent !== transparent) {
          m.transparent = transparent;
          m.needsUpdate = true;
        }
        m.opacity = roof.opacity;
        m.depthWrite = !transparent;
      }
    }
    if (player) {
      const near = this.lightSpots
        .map((spot) => ({ spot, d: Math.hypot(spot.pos.x - player.x - 0.5, spot.pos.z - player.y - 0.5) }))
        .sort((a, b) => a.d - b.d);
      this.lights.forEach((light, i) => {
        const n = near[i];
        light.intensity = n && n.d < 24 ? n.spot.intensity : 0;
        if (n) light.position.copy(n.spot.pos);
        if (n) light.color.setHex(n.spot.color);
      });
    }
    for (const f of this.flames) {
      const s = 1 + Math.sin(now * 0.018 + f.phase) * 0.12 + Math.sin(now * 0.041 + f.phase * 2) * 0.08;
      f.mesh.scale.set(1, s, 1);
    }
    for (const s of this.smoke) {
      s.puffs.forEach((p, i) => {
        const t = (now / 4200 + i / s.puffs.length) % 1;
        p.position.set(s.origin.x + Math.sin(t * 5 + i) * 0.15 + t * 0.5, s.origin.y + t * 2.4, s.origin.z + t * 0.2);
        p.scale.setScalar(0.12 + t * 0.35);
        (p.material as THREE.MeshLambertMaterial).opacity = (1 - t) * 0.55 * Math.min(1, s.roof.opacity + 0.3);
      });
    }
  }

  // -------------------------------------------------------------------------

  private addWallDetail(batch: Batcher, b: Building): void {
    const wood = lambert(0xffffff);
    const timber = 0x4a3020;
    const beam = new THREE.BoxGeometry(1.0, 0.1, 0.05);
    const capstone = new THREE.BoxGeometry(1.0, 0.06, 1.06);
    const corner = new THREE.BoxGeometry(1.1, WALL_HEIGHT + 0.04, 1.1);
    const frame = new THREE.BoxGeometry(0.56, 0.52, 0.06);
    const pane = new THREE.BoxGeometry(0.42, 0.38, 0.07);
    const mullion = new THREE.BoxGeometry(0.04, 0.38, 0.075);
    const sill = new THREE.BoxGeometry(0.64, 0.05, 0.16);
    const glass = lambert(0x2a3550, { emissive: 0x3a2a10 });
    const doorAt = new Set(b.doors.map((d) => `${d.x},${d.y}`));
    const nearDoor = (x: number, y: number) => b.doors.some((d) => Math.abs(d.x - x) + Math.abs(d.y - y) <= 1);
    const isCorner = (x: number, y: number) => (x === b.x0 || x === b.x1) && (y === b.y0 || y === b.y1);

    forEachBorder(b, (x, y) => {
      const cx = x + 0.5;
      const cz = y + 0.5;
      const [nx, nz] = outward(b, x, y);
      const yaw = nx !== 0 ? Math.PI / 2 : 0; // geometry is built facing ±z
      if (doorAt.has(`${x},${y}`)) {
        this.addDoor(batch, x, y, nx, nz);
        return;
      }
      batch.add('cap', capstone, lambert(0xffffff, { map: textures.bricks() }), { position: [cx, WALL_HEIGHT + 0.03, cz], rotationY: yaw }, 0xb5a283);
      batch.add('beam', beam, wood, { position: [cx + nx * 0.51, WALL_HEIGHT - 0.12, cz + nz * 0.51], rotationY: yaw }, timber);
      if (isCorner(x, y)) {
        batch.add('corner', corner, lambert(0xffffff, { map: textures.bricks() }), { position: [cx, (WALL_HEIGHT + 0.04) / 2, cz] }, 0x8f8576);
        return;
      }
      const along = nx !== 0 ? y : x;
      if (nearDoor(x, y) || along % 2 !== 0) return;
      for (const side of [1, -1]) {
        const off = 0.5 * side;
        const px = cx + nx * off;
        const pz = cz + nz * off;
        batch.add('win-frame', frame, wood, { position: [px, 0.8, pz], rotationY: yaw }, 0x5b3a22);
        batch.add('win-pane', pane, glass, { position: [px, 0.8, pz], rotationY: yaw });
        batch.add('win-mullion', mullion, wood, { position: [px, 0.8, pz], rotationY: yaw }, 0x5b3a22);
        batch.add('win-sill', sill, wood, { position: [px, 0.53, pz], rotationY: yaw }, 0x6b4a2e);
      }
    });

    // Sign beside the first door, on the outside face. Unnamed huts get none.
    const door = b.doors[0];
    if (door && b.name) {
      const [nx, nz] = outward(b, door.x, door.y);
      const ax = nz !== 0 ? 1 : 0;
      const az = nx !== 0 ? 1 : 0;
      const sx = door.x + ax + 0.5 + nx * 0.53;
      const sz = door.y + az + 0.5 + nz * 0.53;
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(0.9, 0.45),
        new THREE.MeshLambertMaterial({ map: textures.sign(b.name, SIGN_SYMBOLS[b.kind]) }),
      );
      sign.position.set(sx, this.hm.groundAt(sx, sz) + 0.74, sz);
      sign.rotation.y = Math.atan2(nx, nz);
      this.group.add(sign);
    }
  }

  private addDoor(batch: Batcher, x: number, y: number, nx: number, nz: number): void {
    const cx = x + 0.5;
    const cz = y + 0.5;
    const yaw = nx !== 0 ? Math.PI / 2 : 0;
    const wood = lambert(0xffffff);
    batch.add('lintel', new THREE.BoxGeometry(1.0, 0.22, 1.06), wood, { position: [cx, WALL_HEIGHT - 0.09, cz], rotationY: yaw }, 0x4a3020);
    batch.add('wallcap', new THREE.BoxGeometry(1.0, 0.1, 1.02), lambert(0xffffff, { map: textures.bricks() }), { position: [cx, WALL_HEIGHT - 0.25, cz], rotationY: yaw }, 0xa89880);
    const post = new THREE.BoxGeometry(0.12, WALL_HEIGHT - 0.2, 1.08);
    for (const s of [-0.47, 0.47]) {
      const px = cx + (nz !== 0 ? s : 0);
      const pz = cz + (nx !== 0 ? s : 0);
      batch.add('door-post', post, wood, { position: [px, (WALL_HEIGHT - 0.2) / 2, pz], rotationY: 0 }, 0x4a3020);
    }
    // Open door leaf swung inward against the frame.
    const leaf = new THREE.BoxGeometry(0.06, 1.0, 0.78);
    const hingeAlong = 0.44;
    const lx = cx + (nz !== 0 ? hingeAlong : 0) - nx * 0.45;
    const lz = cz + (nx !== 0 ? hingeAlong : 0) - nz * 0.45;
    batch.add('door-leaf', leaf, wood, { position: [lx, 0.5, lz], rotationY: nx !== 0 ? Math.PI / 2 : 0 }, 0x6e4526);
  }

  private addInterior(batch: Batcher, b: Building): void {
    const fx0 = b.x0 + 1;
    const fy0 = b.y0 + 1;
    const fx1 = b.x1 - 1;
    const fy1 = b.y1 - 1;
    const door = b.doors[0];
    // The back wall is the one opposite the door.
    const back = door && door.y === b.y1 ? b.y0 : b.y1;
    const backInnerZ = back === b.y0 ? b.y0 + 1 + 0.01 : b.y1 - 0.01;
    const inward = back === b.y0 ? 1 : -1;
    const wood = lambert(0xffffff);

    // Rug
    const rug = RUGS[b.kind];
    if (rug) {
      const w = fx1 - fx0 - 1;
      const d = fy1 - fy0 - 1;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: textures.rug(rug[0], rug[1]) }));
      mesh.position.set((fx0 + fx1 + 1) / 2, this.hm.groundAt((fx0 + fx1 + 1) / 2, (fy0 + fy1 + 1) / 2) + 0.012, (fy0 + fy1 + 1) / 2);
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }

    // Wall torches on the side walls, plus one warm light per room.
    for (const [wx, dir] of [[b.x0 + 1 + 0.02, 1], [b.x1 - 0.02, -1]] as const) {
      const tz = (fy0 + fy1 + 1) / 2;
      this.addTorch(batch, wx, tz, dir, 0);
    }
    const lx = (fx0 + fx1 + 1) / 2;
    const lz = (fy0 + fy1 + 1) / 2;
    this.lightSpots.push({ pos: new THREE.Vector3(lx, this.hm.groundAt(lx, lz) + 1.1, lz), color: 0xffb060, intensity: 6 });

    // Back wall furnishings, mounted flat so they never look like they block a tile.
    const shelfGeo = new THREE.BoxGeometry(0.92, 0.04, 0.24);
    const jar = new THREE.CylinderGeometry(0.05, 0.06, 0.14, 8);
    const box = new THREE.BoxGeometry(0.14, 0.12, 0.14);
    const shelfZ = backInnerZ + inward * 0.12;
    const bookGeo = new THREE.BoxGeometry(0.04, 0.15, 0.16);
    const tiles: number[] = [];
    for (let x = fx0; x <= fx1; x++) tiles.push(x);

    if (b.kind === 'store' || b.kind === 'inn' || b.kind === 'library') {
      for (const x of tiles.slice(0, tiles.length - 2)) {
        for (const [i, h] of [0.45, 0.8, 1.12].entries()) {
          batch.add('shelf', shelfGeo, wood, { position: [x + 0.5, h, shelfZ] }, 0x6b4a2e);
          for (let k = 0; k < 4; k++) {
            if (hash2(x, i, k) < 0.25) continue;
            const ox = -0.33 + k * 0.22;
            const tint = JAR_COLORS[Math.floor(hash2(x, i, k + 10) * JAR_COLORS.length)];
            if (b.kind === 'library') {
              for (let n = 0; n < 4; n++) batch.add('book', bookGeo, lambert(), { position: [x + 0.5 + ox - 0.075 + n * 0.05, h + 0.09, shelfZ], rotationY: 0 }, BOOK_COLORS[Math.floor(hash2(x * 7 + n, i, k) * BOOK_COLORS.length)]);
            } else if (hash2(x, i, k + 20) < 0.5) batch.add('jar', jar, lambert(), { position: [x + 0.5 + ox, h + 0.09, shelfZ] }, tint);
            else batch.add('crate', box, lambert(), { position: [x + 0.5 + ox, h + 0.08, shelfZ], rotationY: hash2(x, k) }, b.kind === 'store' ? 0xa07a48 : tint);
          }
        }
      }
    }
    if (b.kind === 'inn') {
      const pan = new THREE.CylinderGeometry(0.13, 0.11, 0.03, 12).rotateX(Math.PI / 2);
      for (const x of tiles.slice(-2)) {
        batch.add('pan-rail', new THREE.BoxGeometry(0.9, 0.04, 0.04), wood, { position: [x + 0.5, 1.12, backInnerZ + inward * 0.04] }, 0x3b3b3b);
        for (const ox of [-0.25, 0.05, 0.3]) batch.add('pan', pan, lambert(), { position: [x + 0.5 + ox, 0.92, backInnerZ + inward * 0.05] }, 0x2b2b2b);
      }
    }
    const bannerColor = b.kind === 'bank' ? 0x2f4f8a : b.kind === 'chapel' ? 0xe8e0c8 : b.kind === 'keep' ? 0x8a2a2a : null;
    if (bannerColor !== null) {
      const banner = new THREE.PlaneGeometry(0.5, 0.85);
      for (const x of [fx0 + 1, fx1 - 1]) {
        batch.add('banner', banner, lambert(0xffffff, { side: THREE.DoubleSide }), { position: [x + 0.5, 0.8, backInnerZ + inward * 0.02], rotationY: inward > 0 ? 0 : Math.PI }, bannerColor);
        batch.add('banner-trim', new THREE.BoxGeometry(0.56, 0.06, 0.04), wood, { position: [x + 0.5, 1.24, backInnerZ + inward * 0.03] }, 0xd4a73a);
        batch.add('banner-emblem', new THREE.CircleGeometry(0.11, 6), lambert(0xffffff, { side: THREE.DoubleSide }), { position: [x + 0.5, 0.85, backInnerZ + inward * 0.03], rotationY: inward > 0 ? 0 : Math.PI }, 0xe0bb4a);
      }
    }
    if (b.kind === 'bank') {
      const coin = new THREE.CylinderGeometry(0.05, 0.05, 0.02, 10);
      for (const x of tiles.slice(2, -2)) {
        batch.add('shelf', shelfGeo, wood, { position: [x + 0.5, 0.7, shelfZ] }, 0x6b4a2e);
        for (let k = 0; k < 5; k++) batch.add('coin', coin, lambert(0xffffff, { emissive: 0x2a1c00 }), { position: [x + 0.3 + k * 0.1, 0.73 + (k % 2) * 0.02, shelfZ] }, 0xe8c04a);
      }
    }
    if (b.kind === 'smithy') {
      const handle = new THREE.BoxGeometry(0.04, 0.34, 0.04);
      const head = new THREE.BoxGeometry(0.16, 0.07, 0.07);
      const blade = new THREE.BoxGeometry(0.06, 0.55, 0.02);
      for (const x of tiles.slice(1, -1)) {
        batch.add('rack', new THREE.BoxGeometry(0.92, 0.5, 0.04), wood, { position: [x + 0.5, 0.95, backInnerZ + inward * 0.02] }, 0x5a3d22);
        for (const ox of [-0.28, 0, 0.28]) {
          const px = x + 0.5 + ox;
          const pz = backInnerZ + inward * 0.07;
          if (hash2(x, Math.round(ox * 10)) < 0.5) {
            batch.add('tool-handle', handle, wood, { position: [px, 0.92, pz] }, 0x7a5230);
            batch.add('tool-head', head, lambert(), { position: [px, 1.1, pz] }, 0x55575c);
          } else {
            batch.add('blade', blade, lambert(), { position: [px, 0.98, pz] }, 0xb8bcc4);
            batch.add('hilt', new THREE.BoxGeometry(0.16, 0.03, 0.03), lambert(), { position: [px, 0.72, pz] }, 0x8a6a3a);
          }
        }
      }
    }
  }

  private addTorch(batch: Batcher, x: number, z: number, dirX: number, dirZ: number): void {
    const wood = lambert(0xffffff);
    const yaw = dirX !== 0 ? Math.PI / 2 : 0;
    batch.add('sconce', new THREE.BoxGeometry(0.08, 0.08, 0.2), wood, { position: [x + dirX * 0.08, 0.95, z + dirZ * 0.08], rotationY: yaw }, 0x2f2f2f);
    batch.add('torch', new THREE.CylinderGeometry(0.03, 0.025, 0.25, 6), wood, { position: [x + dirX * 0.16, 1.05, z + dirZ * 0.16] }, 0x6b4a2e);
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.06, 0.18, 6).translate(0, 0.09, 0),
      new THREE.MeshBasicMaterial({ color: 0xffa531 }),
    );
    flame.position.set(x + dirX * 0.16, this.hm.groundAt(x + dirX * 0.16, z + dirZ * 0.16) + 1.17, z + dirZ * 0.16);
    this.group.add(flame);
    this.flames.push({ mesh: flame, phase: hash2(Math.round(x * 10), Math.round(z * 10)) * 10 });
  }

  private addRoof(b: Building): void {
    const w = b.x1 - b.x0 + 1;
    const d = b.y1 - b.y0 + 1;
    const alongX = w >= d;
    const len = alongX ? w : d;
    const span = alongX ? d : w;
    const height = span * 0.3;
    const overhang = 0.2;

    const group = new THREE.Group();
    const shingleTex = textures.shingles().clone();
    shingleTex.needsUpdate = true;
    const roofMat = new THREE.MeshLambertMaterial({ color: ROOF_COLORS[b.kind], map: shingleTex, side: THREE.DoubleSide });
    const gableMat = new THREE.MeshLambertMaterial({ color: 0xd9ccaa, side: THREE.DoubleSide });
    const trimMat = new THREE.MeshLambertMaterial({ color: 0x3e2a1a });

    group.add(new THREE.Mesh(gableRoofGeometry(len, span, height, overhang), roofMat));
    group.add(new THREE.Mesh(gableEndsGeometry(len, span, height), gableMat));
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(len + overhang * 2, 0.1, 0.14), trimMat);
    ridge.position.y = height + 0.03;
    group.add(ridge);
    const materials: THREE.Material[] = [roofMat, gableMat, trimMat];
    const state: RoofState = { building: b, group, materials, opacity: 1 };

    // A chimney toward the back wall of anything with a hearth.
    const chimneyMat = new THREE.MeshLambertMaterial({ color: 0x8a7a6a, map: textures.bricks() });
    materials.push(chimneyMat);
    const door = b.doors[0];
    const hearths = HEARTH[b.kind] && door ? [{ x: Math.round(b.x0 + w * 0.3), y: door.y === b.y1 ? b.y0 + 1 : b.y1 - 1 }] : [];
    for (const p of hearths) {
      const lx = p.x + 0.5 - (b.x0 + w / 2);
      const lz = p.y + 0.5 - (b.y0 + d / 2);
      const [l, s] = alongX ? [lx, lz] : [lz, lx];
      const surface = height * (1 - Math.abs(s) / (span / 2));
      const top = height + 0.7;
      const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.4, top - surface + 0.3, 0.4), chimneyMat);
      chimney.position.set(l, (top + surface - 0.3) / 2, alongX ? s : -s);
      group.add(chimney);
      const puffs: THREE.Mesh[] = [];
      for (let i = 0; i < 8; i++) {
        const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: 0xc8c8c8, transparent: true, depthWrite: false }));
        this.group.add(puff);
        puffs.push(puff);
      }
      const world = new THREE.Vector3(alongX ? l : s, top, alongX ? s : l).add(new THREE.Vector3(b.x0 + w / 2, WALL_HEIGHT + this.hm.groundAt(b.x0 + w / 2, b.y0 + d / 2), b.y0 + d / 2));
      this.smoke.push({ puffs, origin: world, roof: state });
    }

    group.position.set(b.x0 + w / 2, WALL_HEIGHT + this.hm.groundAt(b.x0 + w / 2, b.y0 + d / 2), b.y0 + d / 2);
    if (!alongX) group.rotation.y = -Math.PI / 2;
    group.traverse((o) => {
      o.castShadow = true;
      o.userData.building = b;
    });
    this.group.add(group);
    this.roofPickables.push(group);
    this.roofs.push(state);
  }

  /** Conical roof over a round hall, with a finial. */
  private addRoundRoof(b: Building): void {
    const w = b.x1 - b.x0 + 1;
    const d = b.y1 - b.y0 + 1;
    const radius = Math.max(w, d) / 2 + 0.25;
    const height = radius * 0.75;
    const shingleTex = textures.shingles().clone();
    shingleTex.repeat.set(14, 5);
    shingleTex.needsUpdate = true;
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x3f6a5a, map: shingleTex, side: THREE.DoubleSide });
    const trimMat = new THREE.MeshLambertMaterial({ color: 0xd4a73a });
    const group = new THREE.Group();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(radius, height, 16, 1, true), roofMat);
    cone.position.y = height / 2;
    const finial = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), trimMat);
    finial.position.y = height + 0.1;
    group.add(cone, finial);
    const cx = b.x0 + w / 2;
    const cz = b.y0 + d / 2;
    group.position.set(cx, WALL_HEIGHT + this.hm.groundAt(cx, cz), cz);
    group.traverse((o) => {
      o.castShadow = true;
      o.userData.building = b;
    });
    this.group.add(group);
    this.roofPickables.push(group);
    this.roofs.push({ building: b, group, materials: [roofMat, trimMat], opacity: 1 });
    this.lightSpots.push({ pos: new THREE.Vector3(cx, this.hm.groundAt(cx, cz) + 1.2, cz), color: 0xffb060, intensity: 8 });
  }

  private addBoundaryDetail(batch: Batcher): void {
    const { map, info, grid } = this;
    const key = (x: number, y: number) => (x < 0 || y < 0 || x >= map.width || y >= map.height ? '' : info.terrainKey[y * map.width + x]);
    const stone = lambert(0xffffff, { map: textures.bricks() });
    const merlon = new THREE.BoxGeometry(0.46, 0.3, 0.46);
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (key(x, y) !== 'city_wall') continue;
        batch.add('walltop', new THREE.BoxGeometry(1.04, 0.1, 1.04), stone, { position: [x + 0.5, CITY_WALL_HEIGHT + 0.05, y + 0.5] }, 0x5e5853);
        if ((x + y) % 2 === 0) batch.add('merlon', merlon, stone, { position: [x + 0.5, CITY_WALL_HEIGHT + 0.25, y + 0.5] }, 0x6a645e);

        // Where a run of wall ends at an opening, it is a gateway: torches on both faces.
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (!grid.isWalkable(x + dx, y + dy) || key(x - dx, y - dy) !== 'city_wall') continue;
          for (const s of [-1, 1]) {
            const fx = dy !== 0 ? s : 0;
            const fy = dx !== 0 ? s : 0;
            this.addTorch(batch, x + 0.5 + fx * 0.52, y + 0.5 + fy * 0.52, fx, fy);
            const lx = x + 0.5 + fx * 1.2 + dx * 0.5;
            const lz = y + 0.5 + fy * 1.2 + dy * 0.5;
            this.lightSpots.push({ pos: new THREE.Vector3(lx, this.hm.groundAt(lx, lz) + 1.4, lz), color: 0xff9a40, intensity: 4 });
          }
        }
      }
    }
  }
}

/** Two sloped planes meeting at a ridge along X; UVs in world units for tiling. */
function gableRoofGeometry(len: number, span: number, height: number, overhang: number): THREE.BufferGeometry {
  const half = span / 2;
  const hx = len / 2 + overhang;
  const eaveZ = half + overhang;
  const eaveY = -height * (overhang / half);
  const slope = Math.hypot(eaveZ, height - eaveY);
  const positions: number[] = [];
  const uvs: number[] = [];
  for (const side of [1, -1]) {
    const quad = [
      [-hx, eaveY, side * eaveZ, 0, 0],
      [hx, eaveY, side * eaveZ, len, 0],
      [hx, height, 0, len, slope],
      [-hx, height, 0, 0, slope],
    ];
    for (const k of [0, 1, 2, 0, 2, 3]) {
      positions.push(quad[k][0], quad[k][1], quad[k][2]);
      uvs.push(quad[k][3] / 1.5, quad[k][4] / 1.5);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.computeVertexNormals();
  return geo;
}

function gableEndsGeometry(len: number, span: number, height: number): THREE.BufferGeometry {
  const positions: number[] = [];
  for (const end of [-1, 1]) {
    const x = (end * len) / 2;
    positions.push(x, 0, -span / 2, x, 0, span / 2, x, height, 0);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

const RUGS: Partial<Record<BuildingKind, [string, string]>> = {
  bank: ['#2f4f7a', '#d4a73a'],
  store: ['#7a2f3a', '#e3c27a'],
  inn: ['#4f5f34', '#e0d0a0'],
  chapel: ['#6a2a3a', '#e8d8a0'],
  keep: ['#6a1f1f', '#d4a73a'],
  library: ['#3a2f5a', '#c8b88a'],
  house: ['#6a4a2a', '#d0b080'],
};

const BOOK_COLORS = [0x7a2a2a, 0x2a4a7a, 0x2f5a35, 0x6a4a2a, 0x4a2f5a, 0x8a7a3a];

const JAR_COLORS = [0x9fc4a0, 0xc9a86a, 0x8a5a3a, 0xd8d0b0, 0x7a8fb0, 0xb05a4a];

const SIGN_SYMBOLS: Record<BuildingKind, (ctx: CanvasRenderingContext2D) => void> = {
  bank: (ctx) => {
    ctx.fillStyle = '#e8c04a';
    for (const [x, y] of [[-14, 10], [0, 14], [14, 10], [-7, -2], [7, -2], [0, -14]]) {
      ctx.beginPath();
      ctx.ellipse(x, y, 13, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#8a6a1a';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  },
  store: (ctx) => {
    ctx.fillStyle = '#d9c08a';
    ctx.beginPath();
    ctx.ellipse(0, 8, 26, 24, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#8a6a3a';
    ctx.fillRect(-10, -26, 20, 12);
    ctx.fillStyle = '#e8c04a';
    ctx.font = 'bold 26px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('¤', 0, 10);
  },
  smithy: (ctx) => {
    ctx.fillStyle = '#c8ccd4';
    ctx.fillRect(-28, 4, 56, 14);
    ctx.fillRect(-14, 18, 28, 10);
    ctx.beginPath();
    ctx.moveTo(28, 4);
    ctx.lineTo(42, 10);
    ctx.lineTo(28, 14);
    ctx.fill();
    ctx.save();
    ctx.rotate(-0.6);
    ctx.fillStyle = '#8a6a3a';
    ctx.fillRect(-4, -36, 8, 40);
    ctx.fillStyle = '#c8ccd4';
    ctx.fillRect(-14, -42, 28, 12);
    ctx.restore();
  },
  chapel: (ctx) => {
    ctx.fillStyle = '#f0c850';
    ctx.beginPath();
    ctx.arc(0, 6, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#f0c850';
    ctx.lineWidth = 4;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 20, 6 + Math.sin(a) * 20);
      ctx.lineTo(Math.cos(a) * 30, 6 + Math.sin(a) * 30);
      ctx.stroke();
    }
  },
  keep: (ctx) => {
    ctx.fillStyle = '#8a2a2a';
    ctx.beginPath();
    ctx.moveTo(-24, -26);
    ctx.lineTo(24, -26);
    ctx.lineTo(24, 4);
    ctx.quadraticCurveTo(24, 26, 0, 34);
    ctx.quadraticCurveTo(-24, 26, -24, 4);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#d4a73a';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = '#d4a73a';
    ctx.fillRect(-3, -18, 6, 40);
    ctx.fillRect(-14, -6, 28, 6);
  },
  library: (ctx) => {
    ctx.fillStyle = '#e8e0c8';
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.quadraticCurveTo(-16, -22, -32, -14);
    ctx.lineTo(-32, 22);
    ctx.quadraticCurveTo(-16, 14, 0, 24);
    ctx.quadraticCurveTo(16, 14, 32, 22);
    ctx.lineTo(32, -14);
    ctx.quadraticCurveTo(16, -22, 0, -12);
    ctx.fill();
    ctx.strokeStyle = '#6a4a7a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.lineTo(0, 24);
    ctx.stroke();
  },
  inn: (ctx) => {
    ctx.fillStyle = '#2b2b2b';
    ctx.beginPath();
    ctx.ellipse(0, 10, 30, 20, 0, 0, Math.PI);
    ctx.fill();
    ctx.fillRect(-32, 6, 64, 6);
    ctx.strokeStyle = '#e8e2d0';
    ctx.lineWidth = 3;
    for (const x of [-12, 0, 12]) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x - 8, -12, x + 8, -20, x, -32);
      ctx.stroke();
    }
  },
  house: () => {},
};
