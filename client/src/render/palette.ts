import type { MapData, WorldGrid } from '@rpg/shared';

/** Cheap deterministic per-tile hash in [0, 1), for visual variation only. */
export function hash2(x: number, y: number, salt = 0): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export const AREA_COLORS = {
  grass: 0x5f9e45,
  forest: 0x3d7333,
  mine: 0x8c8660,
  town: 0x7fb05a,
  hollowmere: 0x5a5845,
  pen: 0xa89a5a,
  road: 0xa39572,
  dirtPath: 0x8a6a45,
  floor: 0xa47c52,
  door: 0x6e4b2c,
  gateGround: 0x6a5c48,
  waterShallow: 0x3c7fbb,
  waterDeep: 0x2a5f99,
  bridge: 0x8b6239,
  mountain: 0x6d6458,
  wall: 0x7c7b77,
} as const;

/** What sits on top of each tile, derived once from map data. */
export interface TileInfo {
  terrainKey: string[];
  placementKey: (string | null)[];
  placementKind: (string | null)[];
}

export function tileInfo(map: MapData): TileInfo {
  const size = map.width * map.height;
  const terrainKey = map.terrain.map((t) => map.terrainDefs[t].key);
  const placementKey: (string | null)[] = new Array(size).fill(null);
  const placementKind: (string | null)[] = new Array(size).fill(null);
  for (const p of map.placements) {
    placementKey[p.y * map.width + p.x] = p.defKey;
    placementKind[p.y * map.width + p.x] = p.kind;
  }
  return { terrainKey, placementKey, placementKind };
}

export function isBridge(map: MapData, info: TileInfo, x: number, y: number): boolean {
  if (info.terrainKey[y * map.width + x] !== 'road') return false;
  const water = (dx: number, dy: number) => {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) return false;
    const i = ny * map.width + nx;
    return info.terrainKey[i] === 'water' || isFishingSpot(info.placementKey[i]);
  };
  return water(0, -1) || water(0, 1);
}

export function isFishingSpot(key: string | null): boolean {
  return key !== null && key.endsWith('fishing_spot');
}

export type Area = 'grass' | 'forest' | 'mine' | 'town' | 'hollowmere' | 'pen' | 'other';

/** Which readable area each tile belongs to (only meaningful for grass tiles). */
export function classifyAreas(map: MapData, grid: WorldGrid, info: TileInfo): Area[] {
  const { width, height } = map;
  const areas: Area[] = new Array(width * height).fill('other');
  const countNear = (x: number, y: number, r: number, test: (i: number) => boolean) => {
    let n = 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (test(ny * width + nx)) n++;
      }
    }
    return n;
  };
  const isTree = (i: number) => (info.placementKey[i] ?? '').endsWith('tree');
  const isRocky = (i: number) => info.terrainKey[i] === 'mountain' || (info.placementKey[i] ?? '').endsWith('rock');
  const isBuilt = (i: number) => info.terrainKey[i] === 'floor' || info.terrainKey[i] === 'door';
  // A tile is in a pen if a fence is the first solid thing in all four directions.
  const fenced = (x: number, y: number) =>
    [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => {
      for (let k = 1; k < 10; k++) {
        const nx = x + dx * k;
        const ny = y + dy * k;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) return false;
        const key = info.terrainKey[ny * width + nx];
        if (key === 'fence' || key === 'door') return true;
        if (!grid.isWalkable(nx, ny) && !info.placementKey[ny * width + nx]) return false;
      }
      return false;
    });

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (info.terrainKey[i] !== 'grass') continue;
      // Blocked tiles (trees, rocks) have no zone of their own; borrow a neighbour's.
      const inGatedArea = grid.gateZone[i] !== -1 || (grid.blocked[i] === 1 && countNear(x, y, 1, (j) => grid.gateZone[j] !== -1) > 0);
      if (inGatedArea) areas[i] = 'hollowmere';
      else if (fenced(x, y)) areas[i] = 'pen';
      else if (countNear(x, y, 2, isTree) >= 4) areas[i] = 'forest';
      else if (countNear(x, y, 4, isRocky) >= 5) areas[i] = 'mine';
      else if (countNear(x, y, 4, isBuilt) > 0) areas[i] = 'town';
      else areas[i] = 'grass';
    }
  }
  return areas;
}

/**
 * Base ground colour of every tile, tinted by area so forest, river, mine,
 * town and the walled southeast read at a glance. Purely presentational.
 */
export function buildTileColors(map: MapData, info: TileInfo, areas: Area[]): number[] {
  const { width, height } = map;
  const colors: number[] = new Array(width * height);
  const waterNear = (x: number, y: number) => {
    let n = 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < width && ny < height && info.terrainKey[ny * width + nx] === 'water') n++;
      }
    return n;
  };
  const areaColor: Record<Area, number> = {
    grass: AREA_COLORS.grass,
    forest: AREA_COLORS.forest,
    mine: AREA_COLORS.mine,
    town: AREA_COLORS.town,
    hollowmere: AREA_COLORS.hollowmere,
    pen: AREA_COLORS.pen,
    other: AREA_COLORS.grass,
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let c: number;
      switch (info.terrainKey[i]) {
        case 'water':
          c = waterNear(x, y) >= 8 ? AREA_COLORS.waterDeep : AREA_COLORS.waterShallow;
          break;
        case 'road':
          c = isBridge(map, info, x, y) ? AREA_COLORS.bridge : AREA_COLORS.road;
          break;
        case 'dirt_path':
          c = AREA_COLORS.dirtPath;
          break;
        case 'floor':
          c = AREA_COLORS.floor;
          break;
        case 'door':
          c = AREA_COLORS.door;
          break;
        case 'gate':
          c = AREA_COLORS.gateGround;
          break;
        case 'mountain':
          c = AREA_COLORS.mountain;
          break;
        case 'wall':
          c = AREA_COLORS.wall;
          break;
        default: {
          // Blend with neighbouring grass so area edges fade instead of forming squares.
          let r = 0;
          let g = 0;
          let b = 0;
          let n = 0;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx;
              const ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
              const j = ny * width + nx;
              if (info.terrainKey[j] !== 'grass') continue;
              const w = dx === 0 && dy === 0 ? 4 : 1;
              const ac = areaColor[areas[j]];
              r += ((ac >> 16) & 255) * w;
              g += ((ac >> 8) & 255) * w;
              b += (ac & 255) * w;
              n += w;
            }
          // The walled area keeps a hard edge so it reads as separate.
          c = areas[i] === 'hollowmere' || areas[i] === 'pen' ? areaColor[areas[i]] : (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n);
        }
      }
      colors[i] = shade(c, 0.97 + hash2(x, y) * 0.05);
    }
  }
  return colors;
}

export function shade(color: number, factor: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 255) * factor));
  const g = Math.min(255, Math.round(((color >> 8) & 255) * factor));
  const b = Math.min(255, Math.round((color & 255) * factor));
  return (r << 16) | (g << 8) | b;
}
