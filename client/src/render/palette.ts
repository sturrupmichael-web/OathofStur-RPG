import type { MapData, WorldGrid } from '@rpg/shared';

/** Cheap deterministic per-tile hash in [0, 1), for visual variation only. */
export function hash2(x: number, y: number, salt = 0): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Base colour of each kind of ground, keyed by terrain key. Textures are near-white, so these tint them. */
export const GROUND_COLORS: Record<string, number> = {
  grass: 0x5f9e45,
  long_grass: 0x4c8a36,
  dirt_path: 0x8a6a45,
  cobblestone: 0xa39572,
  stone_floor: 0xb0a898,
  wooden_floor: 0xa47c52,
  flower_bed: 0x5e4630,
  crop_field: 0x7a5a36,
  sand: 0xdcc48e,
  scorched_earth: 0x6c625a,
  bridge: 0x8b6239,
  door: 0x6e4b2c,
  sewer_hatch: 0xa39572,
  trampled_mud: 0x6e5438,
  bone_scatter: 0x6e5438,
  ditch: 0x3a3028,
  city_wall: 0x7c7b77,
  sandstone_wall: 0xbfa172,
  building_wall: 0xc4b08e,
  sandstone_paving: 0xc8b48a,
  swamp: 0x55663e,
  mountain: 0x8b8378,
  lava: 0xd4471c,
  agility_obstacle: 0x8a6a45,
};

export const WATER_COLORS = { shallow: 0x3c7fbb, deep: 0x2a5f99, sea: 0x1d4a7a };

/** Water, the sea and lava all pool rather than sit as ground. */
export function isWaterKey(key: string): boolean {
  return key === 'water' || key === 'deep_sea';
}

/** Walls that stand a tile tall, and the colour each is cut from. */
export const WALL_TONES: Record<string, { tone: number; city: boolean }> = {
  city_wall: { tone: 0x6e6862, city: true },
  sandstone_wall: { tone: 0xbfa172, city: true },
  building_wall: { tone: 0xc4b08e, city: false },
};

/** Grass tint by region, so Thornwood, the city and the farm read at a glance. */
const GRASS_BY_AREA: Record<Area, number> = {
  grass: 0x5f9e45,
  forest: 0x3d7333,
  town: 0x7fb05a,
  farm: 0x83a64e,
  camp: 0x5c7a3a,
  ash: 0x6a6650,
  other: 0x5f9e45,
};

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
    if (p.kind === 'monster') continue;
    placementKey[p.y * map.width + p.x] = p.defKey;
    placementKind[p.y * map.width + p.x] = p.kind;
  }
  return { terrainKey, placementKey, placementKind };
}

export function isBridge(info: TileInfo, i: number): boolean {
  return info.terrainKey[i] === 'bridge';
}

/** Kinds of grass the map's tiles are grouped into for tinting and ground cover. */
export type Area = 'grass' | 'forest' | 'town' | 'farm' | 'camp' | 'ash' | 'other';

/** Named regions from the map that change how the land looks. */
const REGION_AREAS: Record<string, Area> = {
  Kelmoor: 'town',
  Falcrest: 'town',
  Qadir: 'town',
  Brightwater: 'town',
  Saltcombe: 'town',
  Hallowmere: 'town',
  'Hollin Farm': 'farm',
  'Brightwater Pasture': 'farm',
  'Brightwater Allotments': 'farm',
  'Goblin Encampment': 'camp',
  'The Ashen Waste': 'ash',
  'Black Keep': 'ash',
  Thornwood: 'forest',
  Elderglen: 'forest',
  'Starwood Grove': 'forest',
};

/** Which look each tile gets: the map's named regions first, then tree density. */
export function classifyAreas(map: MapData, _grid: WorldGrid, info: TileInfo): Area[] {
  const { width, height } = map;
  const areas: Area[] = new Array(width * height).fill('other');
  const region = new Array<Area | undefined>(width * height);
  // Larger regions first so smaller ones inside them win.
  const named = map.areas.filter((a) => REGION_AREAS[a.name]).sort((a, b) => b.w * b.h - a.w * a.h);
  for (const a of named) for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) region[y * width + x] = REGION_AREAS[a.name];

  const isTree = (i: number) => (info.placementKey[i] ?? '').endsWith('tree');
  const treesNear = (x: number, y: number) => {
    let n = 0;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < width && ny < height && isTree(ny * width + nx)) n++;
      }
    return n;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const r = region[i];
      if (r && r !== 'forest') areas[i] = r;
      else if (r === 'forest' || treesNear(x, y) >= 4) areas[i] = 'forest';
      else areas[i] = 'grass';
    }
  }
  return areas;
}

const isGrassy = (key: string) => key === 'grass' || key === 'long_grass';

/** Ground colour of every tile. Purely presentational. */
export function buildTileColors(map: MapData, info: TileInfo, areas: Area[]): number[] {
  const { width, height } = map;
  const colors: number[] = new Array(width * height);
  const keyAt = (x: number, y: number) => (x < 0 || y < 0 || x >= width || y >= height ? '' : info.terrainKey[y * width + x]);
  const waterNear = (x: number, y: number) => {
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (isWaterKey(keyAt(x + dx, y + dy))) n++;
    return n;
  };
  const grassColor = (i: number) => {
    const c = GRASS_BY_AREA[areas[i]];
    return info.terrainKey[i] === 'long_grass' ? shade(c, 0.86) : c;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const key = info.terrainKey[i];
      let c: number;
      if (key === 'deep_sea') c = WATER_COLORS.sea;
      else if (key === 'water') c = waterNear(x, y) >= 8 ? WATER_COLORS.deep : WATER_COLORS.shallow;
      else if (isGrassy(key) || key === 'fence' || key === 'palisade') {
        // Blend with neighbouring grass so region edges fade instead of forming squares.
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
            if (!isGrassy(info.terrainKey[j])) continue;
            const w = dx === 0 && dy === 0 ? 4 : 1;
            const ac = grassColor(j);
            r += ((ac >> 16) & 255) * w;
            g += ((ac >> 8) & 255) * w;
            b += (ac & 255) * w;
            n += w;
          }
        c = n ? (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n) : key === 'palisade' ? GROUND_COLORS.trampled_mud : GROUND_COLORS.dirt_path;
      } else c = GROUND_COLORS[key] ?? 0xff00ff;
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
