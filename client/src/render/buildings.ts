import * as THREE from 'three';
import type { MapData, Point, WorldGrid } from '@rpg/shared';
import { Batcher, lambert } from './batch';
import type { Heightmap } from './heightmap';
import { hash2, type TileInfo } from './palette';
import { textures } from './textures';

export const WALL_HEIGHT = 1.3;

export type BuildingKind = 'bank' | 'store' | 'smithy' | 'kitchen' | 'house';

export interface Building {
  /** Wall rectangle, inclusive tile coordinates. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  doors: Point[];
  kind: BuildingKind;
  name: string;
  /** A floor tile near the middle, used when the roof is clicked. */
  entry: Point;
}

const KIND_BY_OBJECT: Record<string, BuildingKind> = {
  bank_chest: 'bank',
  shopkeeper: 'store',
  furnace: 'smithy',
  anvil: 'smithy',
  range: 'kitchen',
};

const NAMES: Record<BuildingKind, string> = {
  bank: 'Bank',
  store: 'General Store',
  smithy: 'Smithy',
  kitchen: 'Kitchen',
  house: 'House',
};

/** Finds rooms: connected floor areas enclosed by a rectangle of walls and doors. */
export function detectBuildings(map: MapData, info: TileInfo): Building[] {
  const { width, height } = map;
  const seen = new Uint8Array(width * height);
  const buildings: Building[] = [];
  for (let start = 0; start < width * height; start++) {
    if (seen[start] || info.terrainKey[start] !== 'floor') continue;
    const stack = [start];
    seen[start] = 1;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const kinds = new Set<BuildingKind>();
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % width;
      const y = Math.floor(i / width);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      const k = info.placementKey[i];
      if (k && KIND_BY_OBJECT[k]) kinds.add(KIND_BY_OBJECT[k]);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const j = ny * width + nx;
        if (!seen[j] && info.terrainKey[j] === 'floor') {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    const b = { x0: minX - 1, y0: minY - 1, x1: maxX + 1, y1: maxY + 1 };
    const doors: Point[] = [];
    let solid = 0;
    let border = 0;
    forEachBorder(b, (x, y) => {
      border++;
      const k = info.terrainKey[y * width + x];
      if (k === 'wall') solid++;
      if (k === 'door') {
        solid++;
        doors.push({ x, y });
      }
    });
    if (solid < border) continue; // not a closed rectangular room
    const kind: BuildingKind = kinds.has('bank') ? 'bank' : kinds.has('store') ? 'store' : kinds.has('smithy') ? 'smithy' : kinds.has('kitchen') ? 'kitchen' : 'house';
    buildings.push({ ...b, doors, kind, name: NAMES[kind], entry: { x: Math.round((minX + maxX) / 2), y: Math.round((minY + maxY) / 2) } });
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
  kitchen: 0xb0623a,
  house: 0x7a5a3a,
};

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
      this.addWallDetail(batch, b);
      this.addInterior(batch, b);
      this.addRoof(b);
    }
    this.addBoundaryDetail(batch);
    this.group.add(batch.build());
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

    // Sign beside the first door, on the outside face.
    const door = b.doors[0];
    if (door) {
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
    const light = new THREE.PointLight(0xffb060, 6, 6.5, 1.6);
    light.position.set((fx0 + fx1 + 1) / 2, this.hm.groundAt((fx0 + fx1 + 1) / 2, (fy0 + fy1 + 1) / 2) + 1.1, (fy0 + fy1 + 1) / 2);
    this.group.add(light);

    // Back wall furnishings, mounted flat so they never look like they block a tile.
    const shelfGeo = new THREE.BoxGeometry(0.92, 0.04, 0.24);
    const jar = new THREE.CylinderGeometry(0.05, 0.06, 0.14, 8);
    const box = new THREE.BoxGeometry(0.14, 0.12, 0.14);
    const shelfZ = backInnerZ + inward * 0.12;
    const tiles: number[] = [];
    for (let x = fx0; x <= fx1; x++) tiles.push(x);

    if (b.kind === 'store' || b.kind === 'kitchen') {
      for (const x of tiles.slice(0, tiles.length - 2)) {
        for (const [i, h] of [0.45, 0.8, 1.12].entries()) {
          batch.add('shelf', shelfGeo, wood, { position: [x + 0.5, h, shelfZ] }, 0x6b4a2e);
          for (let k = 0; k < 4; k++) {
            if (hash2(x, i, k) < 0.25) continue;
            const ox = -0.33 + k * 0.22;
            const tint = JAR_COLORS[Math.floor(hash2(x, i, k + 10) * JAR_COLORS.length)];
            if (hash2(x, i, k + 20) < 0.5) batch.add('jar', jar, lambert(), { position: [x + 0.5 + ox, h + 0.09, shelfZ] }, tint);
            else batch.add('crate', box, lambert(), { position: [x + 0.5 + ox, h + 0.08, shelfZ], rotationY: hash2(x, k) }, b.kind === 'store' ? 0xa07a48 : tint);
          }
        }
      }
    }
    if (b.kind === 'kitchen') {
      const pan = new THREE.CylinderGeometry(0.13, 0.11, 0.03, 12).rotateX(Math.PI / 2);
      for (const x of tiles.slice(-2)) {
        batch.add('pan-rail', new THREE.BoxGeometry(0.9, 0.04, 0.04), wood, { position: [x + 0.5, 1.12, backInnerZ + inward * 0.04] }, 0x3b3b3b);
        for (const ox of [-0.25, 0.05, 0.3]) batch.add('pan', pan, lambert(), { position: [x + 0.5 + ox, 0.92, backInnerZ + inward * 0.05] }, 0x2b2b2b);
      }
    }
    if (b.kind === 'bank') {
      const banner = new THREE.PlaneGeometry(0.5, 0.85);
      for (const x of [fx0 + 1, fx1 - 1]) {
        batch.add('banner', banner, lambert(0xffffff, { side: THREE.DoubleSide }), { position: [x + 0.5, 0.8, backInnerZ + inward * 0.02], rotationY: inward > 0 ? 0 : Math.PI }, 0x2f4f8a);
        batch.add('banner-trim', new THREE.BoxGeometry(0.56, 0.06, 0.04), wood, { position: [x + 0.5, 1.24, backInnerZ + inward * 0.03] }, 0xd4a73a);
        batch.add('banner-emblem', new THREE.CircleGeometry(0.11, 6), lambert(0xffffff, { side: THREE.DoubleSide }), { position: [x + 0.5, 0.85, backInnerZ + inward * 0.03], rotationY: inward > 0 ? 0 : Math.PI }, 0xe0bb4a);
      }
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

    // Chimneys over the furnace and the range.
    const chimneyMat = new THREE.MeshLambertMaterial({ color: 0x8a7a6a, map: textures.bricks() });
    materials.push(chimneyMat);
    for (const p of this.map.placements) {
      if (p.defKey !== 'furnace' && p.defKey !== 'range') continue;
      if (p.x < b.x0 || p.x > b.x1 || p.y < b.y0 || p.y > b.y1) continue;
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

  private addBoundaryDetail(batch: Batcher): void {
    const { map, info, grid } = this;
    const inBuilding = (x: number, y: number) => this.buildings.some((b) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1);
    const stone = lambert(0xffffff, { map: textures.bricks() });
    const merlon = new THREE.BoxGeometry(0.46, 0.3, 0.46);
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const i = y * map.width + x;
        if (info.terrainKey[i] !== 'wall' || inBuilding(x, y)) continue;
        batch.add('walltop', new THREE.BoxGeometry(1.04, 0.1, 1.04), stone, { position: [x + 0.5, WALL_HEIGHT + 0.05, y + 0.5] }, 0x5e5853);
        if ((x + y) % 2 === 0) batch.add('merlon', merlon, stone, { position: [x + 0.5, WALL_HEIGHT + 0.25, y + 0.5] }, 0x6a645e);
      }
    }
    // Torches on the outside face of the wall either side of each gate.
    for (let i = 0; i < grid.gateAt.length; i++) {
      if (grid.gateAt[i] === -1) continue;
      const gx = i % map.width;
      const gy = Math.floor(i / map.width);
      const outside = [[0, -1], [0, 1], [-1, 0], [1, 0]].find(([dx, dy]) => grid.isWalkable(gx + dx, gy + dy) && grid.gateZone[grid.index(gx + dx, gy + dy)] === -1);
      if (!outside) continue;
      const [ox, oy] = outside;
      for (const s of [-1, 1]) {
        const wx = gx + (oy !== 0 ? s : 0);
        const wy = gy + (ox !== 0 ? s : 0);
        this.addTorch(batch, wx + 0.5 + ox * 0.52, wy + 0.5 + oy * 0.52, ox, oy);
      }
      const light = new THREE.PointLight(0xff9a40, 5, 6, 1.6);
      light.position.set(gx + 0.5 + ox * 1.2, this.hm.tileCentre(gx, gy) + 1.3, gy + 0.5 + oy * 1.2);
      this.group.add(light);
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
  kitchen: ['#4f5f34', '#e0d0a0'],
  house: ['#6a4a2a', '#d0b080'],
};

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
  kitchen: (ctx) => {
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
