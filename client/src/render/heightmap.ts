import type { MapData } from '@rpg/shared';
import type { Building } from './buildings';
import { hash2, isBridge, isWaterKey, type Area, type TileInfo } from './palette';

/** Height of the river surface. Small ponds and the fountain sit at their own level. */
export const WATER_Y = -0.3;
/** Shoreline corners sit just above the water. */
const BANK_Y = WATER_Y + 0.08;
/** River and lake bed. */
const BED_Y = WATER_Y - 0.4;
/** Bridge decks float a little above the banks. */
const DECK_Y = BANK_Y + 0.14;

/**
 * Visual-only terrain elevation. The simulation stays on a flat tile grid;
 * this only decides where things are drawn. Heights live on tile corners
 * (width+1 x height+1) so neighbouring tiles share edges and slopes are smooth.
 */
export class Heightmap {
  readonly cw: number;
  readonly ch: number;

  constructor(
    readonly corners: Float32Array,
    private readonly map: MapData,
    /** Flat walking height for tiles that override the slope (bridge decks). */
    private readonly deck: Float32Array,
    /** Water surface height per water tile, NaN elsewhere. */
    private readonly water: Float32Array,
  ) {
    this.cw = map.width + 1;
    this.ch = map.height + 1;
  }

  corner(cx: number, cy: number): number {
    cx = Math.max(0, Math.min(this.cw - 1, cx));
    cy = Math.max(0, Math.min(this.ch - 1, cy));
    return this.corners[cy * this.cw + cx];
  }

  /** Ground height at a world point (tile units, x right, z down the map). */
  groundAt(x: number, z: number): number {
    const tx = Math.floor(x);
    const tz = Math.floor(z);
    if (tx >= 0 && tz >= 0 && tx < this.map.width && tz < this.map.height) {
      const d = this.deck[tz * this.map.width + tx];
      if (!Number.isNaN(d)) return d;
    }
    const fx = x - tx;
    const fz = z - tz;
    const a = this.corner(tx, tz);
    const b = this.corner(tx + 1, tz);
    const c = this.corner(tx, tz + 1);
    const d = this.corner(tx + 1, tz + 1);
    return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
  }

  /** Height at the centre of a tile. */
  tileCentre(x: number, y: number): number {
    return this.groundAt(x + 0.5, y + 0.5);
  }

  /** Surface height of the water on a tile (the river level if the tile is dry). */
  waterAt(x: number, y: number): number {
    const w = this.water[y * this.map.width + x];
    return Number.isNaN(w) ? WATER_Y : w;
  }

  isDeck(x: number, y: number): boolean {
    return !Number.isNaN(this.deck[y * this.map.width + x]);
  }
}

/** Smooth 2D value noise in roughly [-1, 1]. */
function noise(x: number, y: number, salt: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const v = (ix: number, iy: number) => hash2(ix, iy, salt) * 2 - 1;
  const top = v(x0, y0) * (1 - sx) + v(x0 + 1, y0) * sx;
  const bottom = v(x0, y0 + 1) * (1 - sx) + v(x0 + 1, y0 + 1) * sx;
  return top * (1 - sy) + bottom * sy;
}

const smoothstep = (a: number, b: number, t: number) => {
  const x = Math.max(0, Math.min(1, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

export function buildHeightmap(map: MapData, info: TileInfo, areas: Area[], buildings: Building[]): Heightmap {
  const W = map.width;
  const H = map.height;
  const cw = W + 1;
  const ch = H + 1;
  const n = cw * ch;
  const tileIndex = (x: number, y: number) => y * W + x;
  const inMap = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;
  const bridge = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if (isBridge(info, i)) bridge[i] = 1;
  const isWaterTile = (x: number, y: number) => inMap(x, y) && (isWaterKey(info.terrainKey[tileIndex(x, y)]) || bridge[tileIndex(x, y)] === 1);

  // Split water into the river (big, carves a valley at WATER_Y) and pools
  // (the fountain, the park pond, the Thornwood pond) that sit at local ground level.
  const pool = new Int32Array(W * H).fill(-1);
  const pools: number[][] = [];
  for (let start = 0; start < W * H; start++) {
    if (pool[start] !== -1 || !isWaterTile(start % W, Math.floor(start / W))) continue;
    const tiles = [start];
    pool[start] = pools.length;
    for (let head = 0; head < tiles.length; head++) {
      const x = tiles[head] % W;
      const y = Math.floor(tiles[head] / W);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const j = tileIndex(x + dx, y + dy);
        if (isWaterTile(x + dx, y + dy) && pool[j] === -1) {
          pool[j] = pools.length;
          tiles.push(j);
        }
      }
    }
    pools.push(tiles);
  }
  const RIVER_MIN = 150;
  const isRiverTile = (x: number, y: number) => isWaterTile(x, y) && pools[pool[tileIndex(x, y)]].length >= RIVER_MIN;

  /** The up-to-four tiles that share a corner. */
  const around = (cx: number, cy: number) =>
    [
      [cx - 1, cy - 1],
      [cx, cy - 1],
      [cx - 1, cy],
      [cx, cy],
    ].filter(([x, y]) => inMap(x, y));

  // 1. Distance (in tiles) from each corner to the nearest water, by BFS over corners.
  const waterDist = new Float32Array(n).fill(Infinity);
  const queue: number[] = [];
  for (let cy = 0; cy < ch; cy++)
    for (let cx = 0; cx < cw; cx++)
      if (around(cx, cy).some(([x, y]) => isRiverTile(x, y))) {
        waterDist[cy * cw + cx] = 0;
        queue.push(cy * cw + cx);
      }
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head];
    const cx = c % cw;
    const cy = Math.floor(c / cw);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
      const j = ny * cw + nx;
      if (waterDist[j] > waterDist[c] + 1) {
        waterDist[j] = waterDist[c] + 1;
        queue.push(j);
      }
    }
  }

  // 2. Rolling hills, pulled down into a valley near the river. The mine sits
  // on a plateau and the Ashen Waste is a raised moor beyond the ditch.
  const lift = new Float32Array(W * H);
  const LIFT_BY_AREA: Record<string, number> = {
    'Copperback Mine': 1.3,
    'The Ashen Waste': 0.7,
    'Dig Site': 0.3,
    'Greyspine Mountains': 1.6,
    'Ironcrag Peaks': 1.6,
  };
  for (const a of map.areas) {
    const l = LIFT_BY_AREA[a.name];
    if (l) for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) lift[tileIndex(x, y)] = l;
  }
  // Mountains are real high ground rather than blocks on flat land, and lava
  // sits in a hollow. Both are smoothed with everything else below.
  const LIFT_BY_TILE: Record<string, number> = { mountain: 2.6, lava: -0.5 };
  for (let i = 0; i < W * H; i++) {
    const l = LIFT_BY_TILE[info.terrainKey[i]];
    if (l !== undefined) lift[i] += l;
  }
  const raw = new Float32Array(n);
  for (let cy = 0; cy < ch; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      // Broad hills and dales across the region, then the smaller rolls on top.
      const broad = Math.max(0, noise(cx / 38, cy / 38, 4) + 0.15) * 3.2;
      let h = 0.9 + broad + noise(cx / 14, cy / 14, 1) * 2.5 + noise(cx / 6, cy / 6, 2) * 0.6 + noise(cx / 2.5, cy / 2.5, 3) * 0.12;
      const tiles = around(cx, cy);
      h += tiles.reduce((sum, [x, y]) => sum + lift[tileIndex(x, y)], 0) / Math.max(1, tiles.length);
      if (tiles.some(([x, y]) => areas[tileIndex(x, y)] === 'town')) h -= 0.3; // the city sits a little lower
      h = BANK_Y + (h - BANK_Y) * smoothstep(0, 9, waterDist[cy * cw + cx]);
      raw[cy * cw + cx] = Math.max(BANK_Y, h);
    }
  }

  // 3. Level the city, farm and camp and soften roads: blend toward a heavily blurred copy.
  const blurred = blur(blur(raw, cw, ch, 4), cw, ch, 4);
  const flat = new Float32Array(n);
  const BUILT = new Set(['building_wall', 'city_wall', 'sandstone_wall', 'stone_floor', 'wooden_floor', 'door', 'fence', 'palisade', 'cobblestone', 'sandstone_paving', 'sewer_hatch', 'crop_field', 'vegetable_garden', 'flower_bed', 'trampled_mud', 'bone_scatter', 'agility_obstacle', 'farming_patch']);
  const isBuilt = (i: number) => BUILT.has(info.terrainKey[i]);
  const isRoad = (i: number) => info.terrainKey[i] === 'dirt_path' || info.terrainKey[i] === 'sand';
  for (let cy = 0; cy < ch; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      let m = 0;
      for (let dy = -3; dy <= 2; dy++)
        for (let dx = -3; dx <= 2; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (!inMap(x, y)) continue;
          const d = Math.max(Math.abs(dx + 0.5), Math.abs(dy + 0.5));
          const i = tileIndex(x, y);
          if (isBuilt(i)) m = Math.max(m, 1 - smoothstep(1.5, 3.5, d));
          if (isRoad(i)) m = Math.max(m, 0.75 * (1 - smoothstep(0.5, 2.5, d)));
        }
      flat[cy * cw + cx] = m;
    }
  }
  const corners = new Float32Array(n);
  for (let i = 0; i < n; i++) corners[i] = raw[i] + (blurred[i] - raw[i]) * flat[i];

  // 4. Every building stands on one level plot, feathered into its surroundings.
  for (const b of buildings) {
    let sum = 0;
    let count = 0;
    for (let cy = b.y0; cy <= b.y1 + 1; cy++)
      for (let cx = b.x0; cx <= b.x1 + 1; cx++) {
        sum += corners[cy * cw + cx];
        count++;
      }
    const level = sum / count;
    for (let cy = b.y0 - 3; cy <= b.y1 + 4; cy++) {
      for (let cx = b.x0 - 3; cx <= b.x1 + 4; cx++) {
        if (cx < 0 || cy < 0 || cx >= cw || cy >= ch) continue;
        const dx = Math.max(b.x0 - cx, cx - (b.x1 + 1), 0);
        const dy = Math.max(b.y0 - cy, cy - (b.y1 + 1), 0);
        const t = 1 - smoothstep(0, 3.5, Math.max(dx, dy));
        const i = cy * cw + cx;
        corners[i] += (level - corners[i]) * t;
      }
    }
  }

  // 5. Each pool's surface sits just below the lowest dry ground around it.
  const surface = new Float32Array(W * H).fill(NaN);
  for (const tiles of pools) {
    let level = WATER_Y;
    if (tiles.length < RIVER_MIN) {
      level = Infinity;
      for (const t of tiles) {
        const x = t % W;
        const y = Math.floor(t / W);
        for (const [cx, cy] of [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]]) {
          if (around(cx, cy).every(([tx, ty]) => isWaterTile(tx, ty))) continue;
          level = Math.min(level, corners[cy * cw + cx]);
        }
      }
      level -= 0.14;
    }
    for (const t of tiles) surface[t] = level;
  }

  // 6. The ditch is a dry trench; water corners drop to the bed. Along
  // natural shores the bank dips in and out of the water, so the waterline
  // wanders instead of tracing tile edges (the water sheet reaches one tile
  // inland to meet it).
  const NATURAL_SHORE = new Set(['grass', 'long_grass', 'sand', 'swamp', 'dirt_path', 'trampled_mud', 'scorched_earth', 'mountain']);
  for (let cy = 0; cy < ch; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      const tiles = around(cx, cy);
      const i = cy * cw + cx;
      if (tiles.some(([x, y]) => info.terrainKey[tileIndex(x, y)] === 'ditch')) corners[i] -= 1.3;
      const wet = tiles.filter(([x, y]) => isWaterTile(x, y));
      if (!wet.length) continue;
      const level = Math.max(...wet.map(([x, y]) => surface[tileIndex(x, y)]));
      if (wet.length === tiles.length) {
        corners[i] = level + (BED_Y - WATER_Y);
        continue;
      }
      const dry = tiles.filter(([x, y]) => !isWaterTile(x, y));
      const wild = dry.every(([x, y]) => NATURAL_SHORE.has(info.terrainKey[tileIndex(x, y)]) && !bridge[tileIndex(x, y)]);
      const dip = wild ? Math.max(0, noise(cx / 2.2, cy / 2.2, 8) + 0.1) * 0.45 : 0;
      corners[i] = level + (BANK_Y - WATER_Y) - dip;
    }
  }

  const deck = new Float32Array(W * H).fill(NaN);
  for (let i = 0; i < W * H; i++) if (bridge[i]) deck[i] = surface[i] + (DECK_Y - WATER_Y);
  return new Heightmap(corners, map, deck, surface);
}

function blur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      let c = 0;
      for (let k = -r; k <= r; k++) {
        const xx = Math.max(0, Math.min(w - 1, x + k));
        s += src[y * w + xx];
        c++;
      }
      tmp[y * w + x] = s / c;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      let c = 0;
      for (let k = -r; k <= r; k++) {
        const yy = Math.max(0, Math.min(h - 1, y + k));
        s += tmp[yy * w + x];
        c++;
      }
      out[y * w + x] = s / c;
    }
  return out;
}
