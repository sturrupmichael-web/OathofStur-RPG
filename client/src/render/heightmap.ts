import type { MapData } from '@rpg/shared';
import type { Building } from './buildings';
import { hash2, isBridge, type Area, type TileInfo } from './palette';

/** Height of the river surface. */
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
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (isBridge(map, info, x, y)) bridge[tileIndex(x, y)] = 1;
  const isWaterTile = (x: number, y: number) => inMap(x, y) && (info.terrainKey[tileIndex(x, y)] === 'water' || bridge[tileIndex(x, y)] === 1);

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
      if (around(cx, cy).some(([x, y]) => isWaterTile(x, y))) {
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

  // 2. Rolling hills, pulled down into a valley near the river.
  const raw = new Float32Array(n);
  for (let cy = 0; cy < ch; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      let h = 0.9 + noise(cx / 14, cy / 14, 1) * 2.5 + noise(cx / 6, cy / 6, 2) * 0.6 + noise(cx / 2.5, cy / 2.5, 3) * 0.12;
      const tiles = around(cx, cy);
      const share = (pred: (i: number) => boolean) => tiles.filter(([x, y]) => pred(tileIndex(x, y))).length / Math.max(1, tiles.length);
      h += share((i) => areas[i] === 'mine') * 1.3; // the mine sits on a plateau
      h += share((i) => areas[i] === 'hollowmere') * 0.6;
      h = BANK_Y + (h - BANK_Y) * smoothstep(0, 9, waterDist[cy * cw + cx]);
      raw[cy * cw + cx] = Math.max(BANK_Y, h);
    }
  }

  // 3. Level the town and soften roads: blend toward a heavily blurred copy.
  const blurred = blur(blur(raw, cw, ch, 4), cw, ch, 4);
  const flat = new Float32Array(n);
  const isBuilt = (i: number) => {
    const k = info.terrainKey[i];
    return k === 'floor' || k === 'door' || k === 'fence' || k === 'gate' || (k === 'wall' && areas[i] !== 'hollowmere');
  };
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
          if (info.terrainKey[i] === 'road' || info.terrainKey[i] === 'dirt_path') m = Math.max(m, 0.75 * (1 - smoothstep(0.5, 2.5, d)));
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

  // 5. Mountains rise from their own rocky base; water corners drop to the bed.
  for (let cy = 0; cy < ch; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      const tiles = around(cx, cy);
      const i = cy * cw + cx;
      const mountains = tiles.filter(([x, y]) => info.terrainKey[tileIndex(x, y)] === 'mountain').length;
      corners[i] += (mountains / 4) * 1.4;
      const water = tiles.filter(([x, y]) => isWaterTile(x, y)).length;
      if (water === tiles.length) corners[i] = BED_Y;
      else if (water > 0) corners[i] = BANK_Y;
    }
  }

  const deck = new Float32Array(W * H).fill(NaN);
  for (let i = 0; i < W * H; i++) if (bridge[i]) deck[i] = DECK_Y;
  return new Heightmap(corners, map, deck);
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
