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
  road: 0xa39572,
  dirtPath: 0x8a6a45,
  floor: 0x9b7650,
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

/**
 * Base ground colour of every tile, tinted by area so forest, river, mine,
 * town and the walled southeast read at a glance. Purely presentational.
 */
export function buildTileColors(map: MapData, grid: WorldGrid, info: TileInfo): number[] {
  const { width, height } = map;
  const colors: number[] = new Array(width * height);

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
  const isBuilt = (i: number) => {
    const k = info.terrainKey[i];
    return k === 'floor' || k === 'door' || (k === 'wall' && grid.gateZone[i] === -1 && !nearGateWall(i));
  };
  // The long Hollowmere wall should not tint its surroundings as "town".
  const nearGateWall = (i: number) => {
    const x = i % width;
    const y = Math.floor(i / width);
    return countNear(x, y, 1, (j) => grid.gateZone[j] !== -1) > 0;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const key = info.terrainKey[i];
      let c: number;
      switch (key) {
        case 'water': {
          const deep = countNear(x, y, 1, (j) => info.terrainKey[j] === 'water') >= 8;
          c = deep ? AREA_COLORS.waterDeep : AREA_COLORS.waterShallow;
          break;
        }
        case 'road':
          c = isBridge(map, info, x, y) ? AREA_COLORS.bridge : AREA_COLORS.road;
          break;
        case 'dirt_path':
          c = AREA_COLORS.dirtPath;
          break;
        case 'floor':
          c = y % 2 ? AREA_COLORS.floor : shade(AREA_COLORS.floor, 0.92);
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
          // Blocked tiles (trees, rocks) have no zone of their own; borrow a neighbour's.
          const inGatedArea = grid.gateZone[i] !== -1 || (grid.blocked[i] === 1 && countNear(x, y, 1, (j) => grid.gateZone[j] !== -1) > 0);
          if (inGatedArea) c = AREA_COLORS.hollowmere;
          else if (countNear(x, y, 2, isTree) >= 4) c = AREA_COLORS.forest;
          else if (countNear(x, y, 4, isRocky) >= 5) c = AREA_COLORS.mine;
          else if (countNear(x, y, 3, isBuilt) > 0) c = AREA_COLORS.town;
          else c = AREA_COLORS.grass;
        }
      }
      colors[i] = shade(c, 0.94 + hash2(x, y) * 0.1);
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
