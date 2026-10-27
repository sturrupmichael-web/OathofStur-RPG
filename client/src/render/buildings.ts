import * as THREE from 'three';
import type { MapData, Point, WorldGrid } from '@rpg/shared';
import { BoxBuilder, Batcher, lambert } from './batch';
import type { Heightmap } from './heightmap';
import { GROUND_COLORS, hash2, shade, type TileInfo } from './palette';
import { textures, type RugPattern } from './textures';

export const WALL_HEIGHT = 1.3;
export const CITY_WALL_HEIGHT = 1.8;
/**
 * Building walls are this thick and run down the middle of their tiles, so
 * half of every wall tile is open ground outside and floor inside.
 */
export const WALL_T = 0.3;
/** Height of each floor above the ground floor. */
const STOREY_H = 1.15;
/** How far a timber upper floor juts out past the wall below. */
const JETTY = 0.1;
/** Width of a doorway. */
const DOOR_W = 0.8;
/** Real point lights, moved to the nearest light spots each frame. */
const LIGHT_POOL = 6;

export type BuildingKind = 'bank' | 'store' | 'smithy' | 'chapel' | 'inn' | 'keep' | 'library' | 'guildhall' | 'windmill' | 'house';

/** A rectangle of tiles, walls included, inclusive. */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Building {
  /** Bounding rectangle of the walls, inclusive tile coordinates. */
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
  /** Floors, counting the ground floor. Upper floors hide with the roof. */
  storeys: number;
  /** The main floor surface inside. */
  floor: 'wooden_floor' | 'stone_floor' | 'sandstone_paving';
  /** Timber and tile like Kelmoor, or the flat-roofed sandstone of the desert. */
  style: 'timber' | 'sandstone';
  /**
   * The wall rectangles it is made of: one for a plain building, or the main
   * house first and then its wings for an L or T shape. Neighbouring parts
   * overlap by two rows, so the wall between them is open.
   */
  parts: Rect[];
}

/** Whether a tile is part of a building, walls included. */
export function inBuilding(b: Building, x: number, y: number): boolean {
  return b.parts.some((p) => x >= p.x0 && x <= p.x1 && y >= p.y0 && y <= p.y1);
}

/** Whether a tile is inside a building's rooms, not its outer walls. */
export function inRoom(b: Building, x: number, y: number): boolean {
  return b.parts.some((p) => x > p.x0 && x < p.x1 && y > p.y0 && y < p.y1);
}

/** Whether a tile is one of a building's outer walls (or doors). */
export function isOuterWall(b: Building, x: number, y: number): boolean {
  return inBuilding(b, x, y) && !inRoom(b, x, y);
}

/** A building's outer wall tiles, each with the way out (diagonal at outer corners). */
export function outerWalls(b: Building): { x: number; y: number; out: [number, number] }[] {
  const tiles: { x: number; y: number; out: [number, number] }[] = [];
  for (let y = b.y0; y <= b.y1; y++)
    for (let x = b.x0; x <= b.x1; x++) {
      if (!isOuterWall(b, x, y)) continue;
      let dx = !inBuilding(b, x - 1, y) ? -1 : !inBuilding(b, x + 1, y) ? 1 : 0;
      let dy = !inBuilding(b, x, y - 1) ? -1 : !inBuilding(b, x, y + 1) ? 1 : 0;
      // An inside corner of an L: the way out is the one open diagonal.
      if (!dx && !dy)
        for (const [ex, ey] of [[1, 1], [1, -1], [-1, 1], [-1, -1]])
          if (!inBuilding(b, x + ex, y + ey)) {
            dx = ex;
            dy = ey;
            break;
          }
      tiles.push({ x, y, out: [dx, dy] });
    }
  return tiles;
}

const FLOORS = new Set(['stone_floor', 'wooden_floor']);
/** Desert houses are paved inside with the same stone as the streets, so they are found by their walls. */
const SAND_FLOORS = new Set([...FLOORS, 'sandstone_paving']);

const KIND_BY_OBJECT: Record<string, BuildingKind> = {
  bank_booth: 'bank',
  anvil: 'smithy',
  altar: 'chapel',
};

/** Kinds the map's building names imply, checked in order. */
const KIND_BY_NAME: [RegExp, BuildingKind][] = [
  [/windmill/i, 'windmill'],
  [/guildhall/i, 'guildhall'],
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
 * any other floor area enclosed by a rectangle of walls (unnamed huts), plus
 * the desert's sandstone houses.
 */
export function detectBuildings(map: MapData, info: TileInfo): Building[] {
  const { width, height } = map;
  const key = (x: number, y: number) => info.terrainKey[y * width + x];
  const buildings: Building[] = [];

  const make = (b: { x0: number; y0: number; x1: number; y1: number }, name: string): Building | null => {
    const doors: Point[] = [];
    const walls = new Set<string>();
    forEachBorder(b, (x, y) => {
      const k = key(x, y);
      if (k === 'door') doors.push({ x, y });
      else walls.add(k);
    });
    const wall = walls.size === 1 ? [...walls][0] : '';
    if ((wall !== 'building_wall' && wall !== 'sandstone_wall') || !doors.length) return null;
    const style = wall === 'sandstone_wall' ? 'sandstone' : 'timber';
    const floorKeys = style === 'sandstone' ? SAND_FLOORS : FLOORS;
    const objects = new Set<string>();
    let floors = 0;
    let open = false;
    for (let y = b.y0 + 1; y < b.y1; y++)
      for (let x = b.x0 + 1; x < b.x1; x++) {
        const k = key(x, y);
        if (floorKeys.has(k)) floors++;
        const p = info.placementKey[y * width + x];
        if (p) objects.add(p);
        else if (!floorKeys.has(k) && k !== wall && k !== 'door') open = true;
      }
    if (!floors) return null;
    // A sandstone ring around sand, water or a garden is a courtyard or a town wall, not a house.
    if (style === 'sandstone' && (open || (b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1) > 150)) return null;
    let kind: BuildingKind = KIND_BY_NAME.find(([re]) => re.test(name))?.[1] ?? 'house';
    if (kind === 'house') for (const o of objects) kind = KIND_BY_OBJECT[o] ?? kind;
    // Entry: the floor tile nearest the middle (the middle may be an inner wall).
    const mx = (b.x0 + b.x1) / 2;
    const my = (b.y0 + b.y1) / 2;
    let entry = { x: b.x0 + 1, y: b.y0 + 1 };
    for (let y = b.y0 + 1; y < b.y1; y++)
      for (let x = b.x0 + 1; x < b.x1; x++)
        if (floorKeys.has(key(x, y)) && !info.placementKey[y * width + x] && Math.hypot(x - mx, y - my) < Math.hypot(entry.x - mx, entry.y - my)) entry = { x, y };
    const tally = new Map<string, number>();
    for (let y = b.y0 + 1; y < b.y1; y++) for (let x = b.x0 + 1; x < b.x1; x++) tally.set(key(x, y), (tally.get(key(x, y)) ?? 0) + 1);
    const floor = (['wooden_floor', 'stone_floor', 'sandstone_paving'] as const).reduce((best, k) => ((tally.get(k) ?? 0) > (tally.get(best) ?? 0) ? k : best));
    return { ...b, doors, kind, name, entry, shape: 'rect' as const, storeys: storeysFor(kind, b), floor, style, parts: [{ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 }] };
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
    return { ...b, doors, kind, name: a.name, entry: { x: Math.round((x0 + x1) / 2), y: y1 }, shape: 'round', storeys: 1, floor: 'stone_floor', style: 'timber', parts: [b] };
  };

  /**
   * An L or T-shaped house: rooms that are not one rectangle but split into
   * two or three rectangular bands (by rows or by columns), all walled round.
   */
  const makeCompound = (room: Set<number>): Building | null => {
    const tiles = [...room].map((i) => ({ x: i % width, y: Math.floor(i / width) }));
    const bands = (rows: boolean) => {
      const lines = new Map<number, number[]>();
      for (const t of tiles) {
        const [line, at] = rows ? [t.y, t.x] : [t.x, t.y];
        lines.set(line, [...(lines.get(line) ?? []), at]);
      }
      const out: { a0: number; a1: number; l0: number; l1: number }[] = [];
      for (const line of [...lines.keys()].sort((p, q) => p - q)) {
        const ats = lines.get(line)!;
        const a0 = Math.min(...ats);
        const a1 = Math.max(...ats);
        if (ats.length !== a1 - a0 + 1) return null;
        const last = out[out.length - 1];
        if (last && last.l1 === line - 1 && last.a0 === a0 && last.a1 === a1) last.l1 = line;
        else out.push({ a0, a1, l0: line, l1: line });
      }
      return out.map((b) => (rows ? { x0: b.a0 - 1, y0: b.l0 - 1, x1: b.a1 + 1, y1: b.l1 + 1 } : { x0: b.l0 - 1, y0: b.a0 - 1, x1: b.l1 + 1, y1: b.a1 + 1 }));
    };
    const options = [bands(true), bands(false)].filter((o): o is Rect[] => !!o && o.length >= 2 && o.length <= 3);
    if (!options.length) return null;
    const area = (r: Rect) => (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
    const parts = options.sort((p, q) => p.length - q.length)[0].sort((p, q) => area(q) - area(p));
    const bound = { x0: Math.min(...parts.map((p) => p.x0)), y0: Math.min(...parts.map((p) => p.y0)), x1: Math.max(...parts.map((p) => p.x1)), y1: Math.max(...parts.map((p) => p.y1)) };
    const b: Building = { ...bound, doors: [], kind: 'house', name: '', entry: { x: 0, y: 0 }, shape: 'rect', storeys: 1, floor: 'wooden_floor', style: 'timber', parts };
    // Everything round the rooms must be timber wall or door.
    const objects = new Set<string>();
    for (let y = bound.y0; y <= bound.y1; y++)
      for (let x = bound.x0; x <= bound.x1; x++) {
        if (!inBuilding(b, x, y)) continue;
        const i = y * width + x;
        if (inRoom(b, x, y)) {
          if (!room.has(i)) return null;
          if (info.placementKey[i]) objects.add(info.placementKey[i]!);
          continue;
        }
        if (key(x, y) === 'door') b.doors.push({ x, y });
        else if (key(x, y) !== 'building_wall') return null;
      }
    if (!b.doors.length) return null;
    for (const o of objects) b.kind = KIND_BY_OBJECT[o] ?? b.kind;
    const main = parts[0];
    const mx = (main.x0 + main.x1) / 2;
    const my = (main.y0 + main.y1) / 2;
    const free = tiles.filter((t) => !info.placementKey[t.y * width + t.x] && t.x > main.x0 && t.x < main.x1 && t.y > main.y0 && t.y < main.y1);
    b.entry = free.sort((p, q) => Math.hypot(p.x - mx, p.y - my) - Math.hypot(q.x - mx, q.y - my))[0] ?? tiles[0];
    const tally = new Map<string, number>();
    for (const t of tiles) tally.set(key(t.x, t.y), (tally.get(key(t.x, t.y)) ?? 0) + 1);
    b.floor = (['wooden_floor', 'stone_floor'] as const).reduce((best, k) => ((tally.get(k) ?? 0) > (tally.get(best) ?? 0) ? k : best));
    b.storeys = storeysFor(b.kind, main);
    return b;
  };

  for (const a of map.areas) {
    if (a.w < 3 || a.h < 3) continue;
    const b = make({ x0: a.x, y0: a.y, x1: a.x + a.w - 1, y1: a.y + a.h - 1 }, a.name) ?? makeRound(a);
    if (b) buildings.push(b);
  }

  const inside = (x: number, y: number) => buildings.some((b) => inBuilding(b, x, y));
  const seen = new Uint8Array(width * height);
  for (let start = 0; start < width * height; start++) {
    const sx = start % width;
    const sy = Math.floor(start / width);
    if (seen[start] || !FLOORS.has(info.terrainKey[start]) || inside(sx, sy)) continue;
    const stack = [start];
    const room = new Set([start]);
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
          room.add(j);
          stack.push(j);
        }
      }
    }
    if (minX < 1 || minY < 1 || maxX > width - 2 || maxY > height - 2) continue;
    const b = make({ x0: minX - 1, y0: minY - 1, x1: maxX + 1, y1: maxY + 1 }, '') ?? makeCompound(room);
    if (b) buildings.push(b);
  }

  // Sandstone houses: from each top-left wall corner, follow the wall right
  // and down to the far corners and see whether the rectangle closes.
  const sand = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && key(x, y) === 'sandstone_wall';
  const edge = (x: number, y: number) => sand(x, y) || (x >= 0 && y >= 0 && x < width && y < height && key(x, y) === 'door');
  for (let y = 0; y < height - 2; y++) {
    for (let x = 0; x < width - 2; x++) {
      if (!sand(x, y) || !edge(x + 1, y) || !edge(x, y + 1) || sand(x + 1, y + 1) || inside(x, y)) continue;
      for (let x1 = x + 2; x1 < Math.min(width, x + 16) && edge(x1, y); x1++) {
        if (!sand(x1, y + 1) && !(key(x1, y + 1) === 'door')) continue;
        let y1 = y + 2;
        while (y1 < Math.min(height, y + 16) && edge(x, y1) && edge(x1, y1) && !sand(x + 1, y1)) y1++;
        if (y1 >= height || !edge(x, y1)) continue;
        const b = make({ x0: x, y0: y, x1, y1 }, '');
        if (b && !buildings.some((o) => !(o.x1 < b.x0 || o.x0 > b.x1 || o.y1 < b.y0 || o.y0 > b.y1))) {
          buildings.push(b);
          break;
        }
      }
    }
  }
  return buildings;
}

/**
 * How many floors a building has. The keep is a tower; halls, shops and inns
 * have an upper floor; houses are a mix; small huts and the smithy (open to
 * its forge) stay low.
 */
function storeysFor(kind: BuildingKind, b: Rect): number {
  const area = (b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1);
  if (kind === 'keep' || kind === 'guildhall' || kind === 'windmill') return 3;
  if (area < 20 || kind === 'smithy') return 1;
  if (kind === 'house') return hash2(b.x0, b.y0, 31) < 0.6 ? 2 : 1;
  return 2;
}

/** One straight wall of a rectangular building, along x (north/south) or z (west/east). */
interface Side {
  axis: 'x' | 'z';
  /** The wall's centreline: z for an x wall, x for a z wall. */
  at: number;
  /** Where the wall starts and ends along its axis. */
  from: number;
  to: number;
  /** Outward direction, +1 or -1 on the cross axis. */
  out: number;
  /** Doorway centres along the axis. */
  doors: number[];
  /** Tiles along the wall between the corners, as their along-axis coordinate. */
  tiles: number[];
}

/**
 * The straight runs of a building's outer wall. Runs along x reach over the
 * corners and close them; runs along z fit between them.
 */
function sidesOf(b: Building): Side[] {
  const T = WALL_T;
  const wall = (x: number, y: number) => isOuterWall(b, x, y);
  const sides: Side[] = [];
  for (const axis of ['x', 'z'] as const) {
    // Walk each line of tiles along the axis: (a, c) is (x, y) for x runs and (y, x) for z runs.
    const at = (a: number, c: number) => (axis === 'x' ? wall(a, c) : wall(c, a));
    const room = (a: number, c: number) => (axis === 'x' ? inRoom(b, a, c) : inRoom(b, c, a));
    const [c0, c1, a0, a1] = axis === 'x' ? [b.y0, b.y1, b.x0, b.x1] : [b.x0, b.x1, b.y0, b.y1];
    for (let c = c0; c <= c1; c++) {
      for (let a = a0; a <= a1; a++) {
        if (!at(a, c) || !at(a + 1, c)) continue;
        const start = a;
        while (at(a + 1, c)) a++;
        const run = Array.from({ length: a - start + 1 }, (_, i) => start + i);
        // Corner tiles have wall across the run as well; the rest are plain wall.
        const tiles = run.filter((t) => !at(t, c - 1) && !at(t, c + 1));
        const out = run.some((t) => room(t, c + 1)) ? -1 : 1;
        const doors = tiles.filter((t) => b.doors.some((d) => (axis === 'x' ? d.x === t && d.y === c : d.x === c && d.y === t))).map((t) => t + 0.5);
        const reach = axis === 'x' ? T / 2 : -T / 2;
        sides.push({ axis, at: c + 0.5, from: start + 0.5 - reach, to: a + 0.5 + reach, out, doors, tiles });
      }
    }
  }
  return sides;
}

/** The stretches of a side left between its doorways. */
function segmentsOf(side: Side): [number, number][] {
  const cuts = [...side.doors].sort((a, b) => a - b);
  const out: [number, number][] = [];
  let start = side.from;
  for (const d of cuts) {
    out.push([start, d - DOOR_W / 2]);
    start = d + DOOR_W / 2;
  }
  out.push([start, side.to]);
  return out.filter(([a, z]) => z - a > 0.01);
}

/**
 * A box against a side: `a0..a1` along it, `o0..o1` outward from its
 * centreline (negative is inside), `y0..y1` up. Returns world min and max.
 */
function sideBox(side: Side, a0: number, a1: number, o0: number, o1: number, y0: number, y1: number): [[number, number, number], [number, number, number]] {
  const c0 = side.at + Math.min(o0 * side.out, o1 * side.out);
  const c1 = side.at + Math.max(o0 * side.out, o1 * side.out);
  return side.axis === 'x' ? [[a0, y0, c0], [a1, y1, c1]] : [[c0, y0, a0], [c1, y1, a1]];
}

/** Masonry colour of the ground floor by kind. */
const MASONRY: Record<BuildingKind, number> = {
  bank: 0xc4bcae,
  store: 0xb9a683,
  smithy: 0x8f8576,
  chapel: 0xccc4b2,
  inn: 0xb39c7a,
  keep: 0x8a8478,
  library: 0xbcae90,
  guildhall: 0xb8a888,
  windmill: 0xd8d0c0,
  house: 0xb8a686,
};

/** Kinds built of stone all the way up; the rest have timber-framed upper floors. */
const ALL_STONE: Partial<Record<BuildingKind, true>> = { keep: true, chapel: true, bank: true, windmill: true };

/** Kinds with arched doors and tall round-headed windows. */
const GRAND: Partial<Record<BuildingKind, true>> = { chapel: true, library: true, guildhall: true, bank: true };

/** Painted or bare door leaves, one per building. */
const DOOR_COLOURS = [0x6e4526, 0x2f5a3a, 0x7a2f2a, 0x2f4a6a, 0x4a3a2a, 0x8a6a3a, 0x3a3a3a];

/** Painted shutters, one colour per building. */
const SHUTTERS = [0x2f5a3a, 0x2f4a6a, 0x7a2f2a, 0x5a4a2a, 0x3a5a5a];

/** Plaster tints for upper floors. */
const PLASTER = [0xf0e6cf, 0xe8dcc0, 0xf2ead8, 0xe6d6b8];

const TIMBER = 0x3e2a1a;

/** Sun-baked render for desert houses. */
const SANDSTONE = [0xdcc59a, 0xd6bb8a, 0xe2cfa6, 0xcfb487];

/** Striped cloth over desert windows. */
const AWNINGS = [0xb8442f, 0x2f6a8a, 0xd8a23a, 0x5a7a3a];

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
  if (inRoom(b, x, y + 1)) return [0, -1];
  if (inRoom(b, x, y - 1)) return [0, 1];
  if (inRoom(b, x + 1, y)) return [-1, 0];
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
  guildhall: 0x3f5a78,
  windmill: 0x6a4a34,
  house: 0x7a5a3a,
};

/** Homes' roofs, picked per house: thatch is steeper than tile or slate. */
const HOUSE_ROOFS: { color: number; pitch: number; thatch?: boolean }[] = [
  { color: 0x7a5a3a, pitch: 0.45 },
  { color: 0x9c4a32, pitch: 0.45 },
  { color: 0x4f5866, pitch: 0.5 },
  { color: 0x6a4a34, pitch: 0.42 },
  { color: 0xc8a860, pitch: 0.62, thatch: true },
  { color: 0xb09050, pitch: 0.62, thatch: true },
  { color: 0x5d6a4a, pitch: 0.45 },
];

/** Homes' stonework, picked per house. */
const HOUSE_MASONRY = [0xb8a686, 0xa89f90, 0xc4b494, 0x9c8e7c, 0xbcae9a, 0xa8957a];

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
  /** Walls, upper floors and roofs: a click on one walks into that building. */
  readonly pickables: THREE.Object3D[] = [];
  private readonly roofs: RoofState[] = [];
  private readonly flames: Flame[] = [];
  private readonly smoke: Smoke[] = [];
  /** Windmill sails, turned about their axle (local z) each frame. */
  private readonly sails: THREE.Object3D[] = [];
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
    const masonry = {
      timber: new THREE.MeshLambertMaterial({ color: 0xffffff, map: textures.bricks(), vertexColors: true }),
      sandstone: new THREE.MeshLambertMaterial({ color: 0xffffff, map: textures.plaster(), vertexColors: true }),
    };
    const floors = { wooden_floor: new BoxBuilder(), stone_floor: new BoxBuilder(), sandstone_paving: new BoxBuilder() };
    for (const b of buildings) {
      if (b.shape === 'round') {
        this.addRoundRoof(b);
        continue;
      }
      this.addWalls(batch, b, masonry[b.style], floors);
      this.addSign(b);
      this.addInterior(batch, b);
      this.addUpperFloorsAndRoof(b);
    }
    this.addBoundaryDetail(batch);
    this.group.add(batch.build());
    const floorMaterial = (tex: THREE.Texture) => new THREE.MeshLambertMaterial({ color: 0xffffff, map: tex, vertexColors: true });
    for (const [key, builder] of Object.entries(floors)) {
      if (builder.empty) continue;
      const mesh = builder.build(floorMaterial(key === 'wooden_floor' ? textures.planks() : key === 'stone_floor' ? textures.cobble() : textures.rock()));
      mesh.castShadow = false;
      this.group.add(mesh);
    }
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
      const inside = !!player && inBuilding(b, player.x, player.y);
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
    for (const sail of this.sails) sail.rotation.z -= dt * 0.7;
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

  /** Ground level of a building's plot (the heightmap levels each one). */
  private plotLevel(b: Building): number {
    return this.hm.groundAt((b.x0 + b.x1 + 1) / 2, (b.y0 + b.y1 + 1) / 2);
  }

  /**
   * The ground floor: walls down the middle of the wall tiles with a plinth,
   * corner stones and a timber band, windows with shutters, doorways with
   * frames, an open door and a step, and floor boards under the inner half
   * of the wall tiles.
   */
  private addWalls(batch: Batcher, b: Building, masonry: THREE.Material, floors: Record<Building['floor'], BoxBuilder>): void {
    const T = WALL_T;
    const G = WALL_HEIGHT;
    const base = this.plotLevel(b);
    const desert = b.style === 'sandstone';
    const tone = desert ? SANDSTONE[Math.floor(hash2(b.x0, b.y0, 47) * SANDSTONE.length)] : b.kind === 'house' ? HOUSE_MASONRY[Math.floor(hash2(b.x0, b.y0, 63) * HOUSE_MASONRY.length)] : MASONRY[b.kind];
    const shutter = SHUTTERS[Math.floor(hash2(b.x0, b.y0, 41) * SHUTTERS.length)];
    const walls = new BoxBuilder();
    const unit = new THREE.BoxGeometry(1, 1, 1);
    const wood = lambert(0xffffff);
    const glass = lambert(0x2a3550, { emissive: 0x3a2a10 });
    // A box against a side, batched; heights are relative to the plot.
    const put = (key: string, mat: THREE.Material, color: number, side: Side, a0: number, a1: number, o0: number, o1: number, y0: number, y1: number) => {
      const [min, max] = sideBox(side, a0, a1, o0, o1, y0, y1);
      batch.add(
        key,
        unit,
        mat,
        { position: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2], scale: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] },
        color,
      );
    };
    // A flat piece in the plane of a side (an arch, a fanlight), centred at a, o, y.
    const flat = (key: string, geo: THREE.BufferGeometry, mat: THREE.Material, color: number, side: Side, a: number, o: number, y: number, scale: [number, number, number] = [1, 1, 1]) => {
      const [p] = sideBox(side, a, a, o, o, y, y);
      batch.add(key, geo, mat, { position: p, rotationY: side.axis === 'x' ? 0 : Math.PI / 2, scale }, color);
    };
    // Halls get arched doors and tall arched windows; homes have their own
    // kind of window, plain, leaded or small; every door its own paint.
    const grand = GRAND[b.kind] ?? false;
    const winStyle = grand ? 'arched' : b.kind === 'house' ? (['plain', 'lattice', 'small'] as const)[Math.floor(hash2(b.x0, b.y0, 74) * 3)] : 'plain';
    const leaf = DOOR_COLOURS[Math.floor(hash2(b.x0, b.y0, 75) * DOOR_COLOURS.length)];
    const archGeo = new THREE.TorusGeometry(1, 0.06, 5, 14, Math.PI);
    const halfDisc = new THREE.CircleGeometry(1, 14, 0, Math.PI);
    const glassBoth = lambert(0x2a3550, { emissive: 0x3a2a10, side: THREE.DoubleSide });

    for (const side of sidesOf(b)) {
      for (const [a0, a1] of segmentsOf(side)) {
        const [min, max] = sideBox(side, a0, a1, -T / 2, T / 2, base - 0.3, base + G);
        walls.box(min, max, shade(tone, 0.94 + hash2(Math.round(a0 * 3), Math.round(side.at), 5) * 0.12));
        const [pmin, pmax] = sideBox(side, a0, a1, -T / 2 - 0.05, T / 2 + 0.05, base - 0.3, base + 0.2);
        walls.box(pmin, pmax, shade(tone, 0.7));
      }
      // Timber band under the eaves on the outside (a pale stone course in the desert).
      put('band', wood, desert ? shade(tone, 1.12) : TIMBER, side, side.from - (side.axis === 'z' ? 0 : 0.02), side.to + (side.axis === 'z' ? 0 : 0.02), T / 2 - 0.01, T / 2 + 0.04, G - 0.14, G - 0.02);

      for (const d of side.doors) {
        const [min, max] = sideBox(side, d - DOOR_W / 2, d + DOOR_W / 2, -T / 2, T / 2, base + 1.02, base + G);
        walls.box(min, max, tone);
        for (const s of [-1, 1]) put('door-post', wood, TIMBER, side, d + s * (DOOR_W / 2) - 0.05, d + s * (DOOR_W / 2) + 0.05, -T / 2 - 0.03, T / 2 + 0.03, 0, 1.06);
        put('door-lintel', wood, TIMBER, side, d - DOOR_W / 2 - 0.08, d + DOOR_W / 2 + 0.08, -T / 2 - 0.04, T / 2 + 0.04, 0.98, 1.1);
        put('threshold', wood, 0x7a5432, side, d - DOOR_W / 2, d + DOOR_W / 2, -T / 2, T / 2, -0.02, 0.03);
        put('step', lambert(0xffffff, { map: textures.rock() }), 0x8a857c, side, d - 0.48, d + 0.48, T / 2, T / 2 + 0.34, -0.06, 0.07);
        // Open door leaf swung inward against the frame.
        if (grand) {
          // A low stone arch over the lintel with a fanlight in it.
          const r = DOOR_W / 2 + 0.06;
          flat('door-arch', archGeo, wood, shade(tone, 0.78), side, d, T / 2 + 0.03, 1.08, [r, r * 0.42, 1.2]);
          flat('fanlight', halfDisc, glassBoth, 0xffffff, side, d, T / 2 + 0.02, 1.08, [r - 0.05, (r - 0.05) * 0.42, 1]);
        }
        put('door-leaf', wood, leaf, side, d + DOOR_W / 2 - 0.08, d + DOOR_W / 2 - 0.02, -T / 2 - 0.72, -T / 2 - 0.02, 0.02, 0.98);
      }

      // Windows on every other tile, clear of corners and doors.
      for (const t of side.tiles) {
        const a = t + 0.5;
        if (t % 2 !== 0 || side.doors.some((d) => Math.abs(d - a) < 1.6)) continue;
        for (const face of [1, -1]) {
          const o = face * (T / 2);
          const sill = (w: number, y: number) => put('win-sill', wood, 0x6b4a2e, side, a - w, a + w, face > 0 ? o : o - 0.12, face > 0 ? o + 0.12 : o, y - 0.05, y);
          if (winStyle === 'arched') {
            // Tall and narrow with a round head, in a dressed stone surround.
            put('win-frame', wood, shade(tone, 0.78), side, a - 0.22, a + 0.22, o - 0.03, o + 0.03, 0.38, 0.9);
            flat('win-arch', archGeo, wood, shade(tone, 0.78), side, a, o + face * 0.03, 0.9, [0.19, 0.19, 1]);
            put('win-pane', glass, 0xffffff, side, a - 0.16, a + 0.16, o - 0.035, o + 0.035, 0.44, 0.9);
            flat('win-head', halfDisc, glassBoth, 0xffffff, side, a, o + face * 0.036, 0.9, [0.16, 0.16, 1]);
            put('win-mullion', wood, 0x3a3a3a, side, a - 0.015, a + 0.015, o - 0.04, o + 0.04, 0.44, 1.04);
            sill(0.25, 0.4);
            continue;
          }
          const [hw, y0, y1] = winStyle === 'small' ? [0.15, 0.66, 0.98] : [0.21, 0.61, 0.99];
          put('win-frame', wood, 0x5b3a22, side, a - hw - 0.07, a + hw + 0.07, o - 0.03, o + 0.03, y0 - 0.07, y1 + 0.07);
          put('win-pane', glass, 0xffffff, side, a - hw, a + hw, o - 0.035, o + 0.035, y0, y1);
          put('win-mullion', wood, 0x5b3a22, side, a - 0.02, a + 0.02, o - 0.04, o + 0.04, y0, y1);
          if (winStyle === 'lattice') {
            // Leaded panes: thin bars across and down.
            for (const f of [1 / 3, 2 / 3]) put('win-lead', wood, 0x3a3a3a, side, a - hw, a + hw, o - 0.04, o + 0.04, y0 + (y1 - y0) * f - 0.008, y0 + (y1 - y0) * f + 0.008);
            for (const f of [-0.5, 0.5]) put('win-lead', wood, 0x3a3a3a, side, a + hw * f - 0.008, a + hw * f + 0.008, o - 0.04, o + 0.04, y0, y1);
          } else if (winStyle === 'plain') put('win-mullion', wood, 0x5b3a22, side, a - hw, a + hw, o - 0.04, o + 0.04, (y0 + y1) / 2 - 0.015, (y0 + y1) / 2 + 0.015);
          sill(hw + 0.11, y0 - 0.06);
        }
        if (!desert && winStyle !== 'arched') for (const s of [-1, 1]) put('shutter', wood, shutter, side, a + s * 0.29 - 0.12, a + s * 0.29 + 0.12, T / 2 + 0.01, T / 2 + 0.05, 0.56, 1.04);
        // Desert windows get a cloth awning instead.
        else put('awning', wood, AWNINGS[Math.floor(hash2(Math.round(a * 3), b.y0, 48) * AWNINGS.length)], side, a - 0.32, a + 0.32, T / 2, T / 2 + 0.22, 1.1, 1.14);
      }
    }

    // Dressed stone at the corners, inside corners of an L too.
    const wall = (x: number, y: number) => isOuterWall(b, x, y);
    for (let y = b.y0; y <= b.y1; y++)
      for (let x = b.x0; x <= b.x1; x++) {
        if (!wall(x, y) || !(wall(x - 1, y) || wall(x + 1, y)) || !(wall(x, y - 1) || wall(x, y + 1))) continue;
        const cx = x + 0.5;
        const cz = y + 0.5;
        walls.box([cx - T / 2 - 0.05, base - 0.3, cz - T / 2 - 0.05], [cx + T / 2 + 0.05, base + G + 0.02, cz + T / 2 + 0.05], shade(tone, 0.82));
      }

    const mesh = walls.build(masonry);
    mesh.userData.building = b;
    this.group.add(mesh);
    this.pickables.push(mesh);

    // Floor under the inner half of the wall tiles, so the room reaches its
    // walls: each quarter of a wall tile that touches a room tile.
    const f = floors[b.floor];
    const y0 = base - 0.02;
    const y1 = base + 0.012;
    const color = shade(GROUND_COLORS[b.floor], 0.97);
    for (const { x, y } of outerWalls(b))
      for (const qx of [0, 1])
        for (const qz of [0, 1])
          if (inRoom(b, x + (qx ? 1 : -1), y) || inRoom(b, x, y + (qz ? 1 : -1)) || inRoom(b, x + (qx ? 1 : -1), y + (qz ? 1 : -1))) f.box([x + qx * 0.5, y0, y + qz * 0.5], [x + qx * 0.5 + 0.5, y1, y + qz * 0.5 + 0.5], color);
  }

  /** Furnishings, in the main room (the main part of an L or T). */
  private addInterior(batch: Batcher, b: Building): void {
    const main = b.parts[0];
    const fx0 = main.x0 + 1;
    const fy0 = main.y0 + 1;
    const fx1 = main.x1 - 1;
    const fy1 = main.y1 - 1;
    const door = b.doors[0];
    // The back wall is the one opposite the door.
    const back = door && door.y === main.y1 ? main.y0 : main.y1;
    const backInnerZ = back === main.y0 ? main.y0 + 0.5 + WALL_T / 2 + 0.01 : main.y1 + 0.5 - WALL_T / 2 - 0.01;
    const inward = back === main.y0 ? 1 : -1;
    // Where a wing opens off the room there is no wall to hang anything on.
    const solid = (x: number, y: number) => isOuterWall(b, x, y);
    const wood = lambert(0xffffff);

    // Rug: each building's own colours and weave, and for homes its own size.
    const rug = RUGS[b.kind];
    if (rug) {
      const r = (salt: number) => hash2(main.x0, main.y0, salt);
      const [base, trim, accent] = b.kind === 'house' ? RUG_COLOURS[Math.floor(r(1) * RUG_COLOURS.length)] : rug;
      const pattern = RUG_PATTERNS[Math.floor(r(2) * RUG_PATTERNS.length)];
      const fw = fx1 - fx0 - 1;
      const fd = fy1 - fy0 - 1;
      // Homes get a smaller rug, sometimes a long runner; halls a big one.
      const share = b.kind === 'house' ? 0.55 + r(3) * 0.35 : 1;
      let w = Math.max(1, fw * share);
      let d = Math.max(1, fd * share);
      if (b.kind === 'house' && r(4) < 0.35) {
        if (w > d) d = Math.max(0.9, d * 0.5);
        else w = Math.max(0.9, w * 0.5);
      }
      const cx = (fx0 + fx1 + 1) / 2 + (fw - w) * (r(5) - 0.5) * 0.6;
      const cz = (fy0 + fy1 + 1) / 2 + (fd - d) * (r(6) - 0.5) * 0.6;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: textures.rug(base, trim, accent, pattern, d / w) }));
      mesh.position.set(cx, this.hm.groundAt(cx, cz) + 0.012, cz);
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }

    // Wall torches on the side walls, plus one warm light per room.
    for (const [wx, dir] of [[main.x0 + 0.5 + WALL_T / 2 + 0.02, 1], [main.x1 + 0.5 - WALL_T / 2 - 0.02, -1]] as const) {
      const tz = (fy0 + fy1 + 1) / 2;
      if (!solid(Math.floor(wx), Math.floor(tz))) continue;
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
    for (let x = fx0; x <= fx1; x++) if (solid(x, back)) tiles.push(x);

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
    const bannerColor = b.kind === 'bank' ? 0x2f4f8a : b.kind === 'chapel' ? 0xe8e0c8 : b.kind === 'keep' ? 0x8a2a2a : b.kind === 'guildhall' ? 0x1f3a5a : null;
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

  /** A hanging sign beside the first door, on the outside face. Unnamed huts get none. */
  private addSign(b: Building): void {
    const door = b.doors[0];
    if (!door || !b.name) return;
    const [nx, nz] = outward(b, door.x, door.y);
    const ax = nz !== 0 ? 1 : 0;
    const az = nx !== 0 ? 1 : 0;
    const off = WALL_T / 2 + 0.03;
    const sx = door.x + ax + 0.5 + nx * off;
    const sz = door.y + az + 0.5 + nz * off;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.45), new THREE.MeshLambertMaterial({ map: textures.sign(b.name, SIGN_SYMBOLS[b.kind]) }));
    sign.position.set(sx, this.hm.groundAt(sx, sz) + 0.74, sz);
    sign.rotation.y = Math.atan2(nx, nz);
    this.group.add(sign);
  }

  /**
   * Everything above the ground floor, which hides with the roof when the
   * player goes inside: upper floors (timber frame and plaster jutting out a
   * little, or plain stone for the bank, chapel and keep) and the roof with
   * its chimney. The keep gets a flat, battlemented top with corner turrets.
   */
  private addUpperFloorsAndRoof(b: Building): void {
    const T = WALL_T;
    const base = this.plotLevel(b);
    const desert = b.style === 'sandstone';
    const stone = !!ALL_STONE[b.kind] || desert;
    const top = new THREE.Group();
    const materials: THREE.Material[] = [];
    const material = (params: THREE.MeshLambertMaterialParameters) => {
      const m = new THREE.MeshLambertMaterial(params);
      materials.push(m);
      return m;
    };
    const state: RoofState = { building: b, group: top, materials, opacity: 1 };
    const walls = new BoxBuilder();
    const timber = new BoxBuilder();
    const glass = new BoxBuilder();
    const braces = new Batcher();
    const braceMat = material({ color: 0xffffff });
    const unit = new THREE.BoxGeometry(1, 1, 1);
    const tone = desert
      ? SANDSTONE[Math.floor(hash2(b.x0, b.y0, 47) * SANDSTONE.length)]
      : stone
        ? MASONRY[b.kind]
        : PLASTER[Math.floor(hash2(b.x0, b.y0, 43) * PLASTER.length)];
    const shutter = SHUTTERS[Math.floor(hash2(b.x0, b.y0, 41) * SHUTTERS.length)];
    const main = b.parts[0];
    const mainAlongX = main.x1 - main.x0 >= main.y1 - main.y0;
    const roofs: (() => void)[] = [];

    // Each part in turn: the main house, then any wings, which are sometimes a floor lower.
    b.parts.forEach((part, index) => {
    const storeys = index > 0 && b.storeys > 1 && hash2(part.x0, part.y0, 61) < 0.5 ? b.storeys - 1 : b.storeys;
    // Outer face of the ground floor walls, then of the upper floors.
    const jetty = stone ? 0 : JETTY;
    const ox0 = part.x0 + 0.5 - T / 2 - jetty;
    const ox1 = part.x1 + 0.5 + T / 2 + jetty;
    const oz0 = part.y0 + 0.5 - T / 2 - jetty;
    const oz1 = part.y1 + 0.5 + T / 2 + jetty;
    const eaves = base + WALL_HEIGHT + (storeys - 1) * STOREY_H;

    for (let k = 1; k < storeys; k++) {
      const y0 = base + WALL_HEIGHT + (k - 1) * STOREY_H;
      const y1 = y0 + STOREY_H;
      walls.box([ox0, y0, oz0], [ox1, y1, oz1], shade(tone, 0.96 + hash2(b.x0, k, 44) * 0.08));
      // Joists showing where the floor juts out, and a plate along the top.
      timber.box([ox0 - 0.03, y0, oz0 - 0.03], [ox1 + 0.03, y0 + 0.13, oz1 + 0.03], TIMBER);
      if (!stone) timber.box([ox0 - 0.015, y1 - 0.08, oz0 - 0.015], [ox1 + 0.015, y1, oz1 + 0.015], TIMBER);

      // Walk round the four faces: along runs a0..a1 at the fixed coordinate c, facing out.
      const faces: { axis: 'x' | 'z'; c: number; out: number; a0: number; a1: number }[] = [
        { axis: 'x', c: oz0, out: -1, a0: ox0, a1: ox1 },
        { axis: 'x', c: oz1, out: 1, a0: ox0, a1: ox1 },
        { axis: 'z', c: ox0, out: -1, a0: oz0, a1: oz1 },
        { axis: 'z', c: ox1, out: 1, a0: oz0, a1: oz1 },
      ];
      for (const f of faces) {
        const at = (a: number, o: number): [number, number] => (f.axis === 'x' ? [a, f.c + o * f.out] : [f.c + o * f.out, a]);
        const slab = (b0: number, b1: number, o0: number, o1: number, ya: number, yb: number, into: BoxBuilder, color: number) => {
          const [x0, z0] = at(b0, o0);
          const [x1, z1] = at(b1, o1);
          into.box([Math.min(x0, x1), ya, Math.min(z0, z1)], [Math.max(x0, x1), yb, Math.max(z0, z1)], color);
        };
        const len = f.a1 - f.a0;
        const panels = Math.max(1, Math.round(len));
        const step = len / panels;
        for (let i = 0; i < panels; i++) {
          const p0 = f.a0 + i * step;
          const mid = p0 + step / 2;
          const hasWindow = panels >= 3 ? i % 2 === 1 && i < panels - 1 : i === 0;
          if (!stone) {
            // Posts between panels, and a brace across the blind ones.
            slab(p0 - 0.045, p0 + 0.045, -0.01, 0.025, y0 + 0.13, y1 - 0.08, timber, TIMBER);
            if (!hasWindow) {
              const [bx, bz] = at(mid, 0.012);
              const lean = (i + k) % 2 === 0 ? 1 : -1;
              const angle = Math.atan2(STOREY_H - 0.21, step) * lean;
              const brace = Math.hypot(STOREY_H - 0.21, step);
              braces.add('brace', unit, braceMat, {
                position: [bx, (y0 + 0.13 + y1 - 0.08) / 2, bz],
                rotation: f.axis === 'x' ? [0, 0, angle] : [angle, 0, 0],
                scale: f.axis === 'x' ? [brace, 0.07, 0.03] : [0.03, 0.07, brace],
              }, TIMBER);
            }
          }
          if (!hasWindow) continue;
          const wy0 = y0 + 0.4;
          const wy1 = y1 - (stone ? 0.18 : 0.28);
          const hw = stone ? 0.14 : 0.2;
          slab(mid - hw - 0.05, mid + hw + 0.05, -0.01, 0.035, wy0 - 0.05, wy1 + 0.05, stone ? walls : timber, stone ? shade(tone, 0.8) : 0x4a3020);
          slab(mid - hw, mid + hw, 0, 0.045, wy0, wy1, glass, 0xffffff);
          if (!stone) {
            for (const s of [-1, 1]) slab(mid + s * (hw + 0.17) - 0.12, mid + s * (hw + 0.17) + 0.12, 0, 0.04, wy0 - 0.02, wy1 + 0.02, timber, shutter);
            // Window boxes with flowers on houses and inns.
            if ((b.kind === 'house' || b.kind === 'inn') && hash2(Math.round(mid * 3), k, 45) < 0.6) {
              slab(mid - hw - 0.04, mid + hw + 0.04, 0.03, 0.16, wy0 - 0.13, wy0 - 0.02, timber, 0x6b4a2e);
              const bloom = [0xd04a6a, 0xe8c04a, 0xa060d0, 0xe07a3a][Math.floor(hash2(Math.round(mid * 3), k, 46) * 4)];
              slab(mid - hw, mid + hw, 0.05, 0.15, wy0 - 0.02, wy0 + 0.05, timber, bloom);
            }
          }
        }
        if (!stone) slab(f.a1 - 0.045, f.a1 + 0.045, -0.01, 0.025, y0 + 0.13, y1 - 0.08, timber, TIMBER);
      }
    }

    const here = { ...b, ...part, storeys };
    if (desert) roofs.push(() => this.addFlatRoof(here, top, material, tone, ox0, ox1, oz0, oz1, eaves));
    else if (b.kind === 'windmill') roofs.push(() => this.addWindmillTop(here, top, material, ox0, ox1, oz0, oz1, eaves));
    else if (b.kind === 'keep') roofs.push(() => this.addKeepTop(here, top, material, ox0, ox1, oz0, oz1, eaves));
    else if (index === 0) roofs.push(() => this.addGableRoof(here, top, material, state, ox0, ox1, oz0, oz1, eaves, mainAlongX, true));
    else {
      // A wing's ridge runs across the main one. Where it points at the main
      // house it carries on in to the main ridge, so the two roofs meet.
      const alongX = !mainAlongX;
      const besideX = part.x0 >= main.x0 && part.x1 <= main.x1;
      let [rx0, rx1, rz0, rz1] = [ox0, ox1, oz0, oz1];
      const mcx = (main.x0 + main.x1 + 1) / 2;
      const mcz = (main.y0 + main.y1 + 1) / 2;
      if (besideX && !alongX) [rz0, rz1] = part.y0 > main.y0 ? [Math.min(rz0, mcz), rz1] : [rz0, Math.max(rz1, mcz)];
      if (!besideX && alongX) [rx0, rx1] = part.x0 > main.x0 ? [Math.min(rx0, mcx), rx1] : [rx0, Math.max(rx1, mcx)];
      roofs.push(() => this.addGableRoof(here, top, material, state, rx0, rx1, rz0, rz1, eaves, alongX, false));
    }
    });

    const wallMat = material({ color: 0xffffff, map: stone && !desert ? textures.bricks() : textures.plaster(), vertexColors: true });
    const timberMat = material({ color: 0xffffff, vertexColors: true });
    const glassMat = material({ color: 0x2a3550, emissive: 0x3a2a10, vertexColors: true });
    for (const [builder, mat] of [[walls, wallMat], [timber, timberMat], [glass, glassMat]] as const) if (!builder.empty) top.add(builder.build(mat));
    top.add(braces.build());

    for (const roof of roofs) roof();

    top.traverse((o) => {
      o.castShadow = true;
      o.userData.building = b;
    });
    this.group.add(top);
    this.pickables.push(top);
    this.roofs.push(state);
  }

  private addGableRoof(
    b: Building,
    top: THREE.Group,
    material: (p: THREE.MeshLambertMaterialParameters) => THREE.MeshLambertMaterial,
    state: RoofState,
    ox0: number,
    ox1: number,
    oz0: number,
    oz1: number,
    eaves: number,
    alongX = ox1 - ox0 >= oz1 - oz0,
    hearth = true,
  ): void {
    const w = ox1 - ox0;
    const d = oz1 - oz0;
    const len = alongX ? w : d;
    const span = alongX ? d : w;
    const look = b.kind === 'house' ? HOUSE_ROOFS[Math.floor(hash2(b.parts[0].x0, b.parts[0].y0, 62) * HOUSE_ROOFS.length)] : null;
    const height = span * (b.kind === 'chapel' ? 0.62 : (look?.pitch ?? 0.45));
    const overhang = 0.3;

    const group = new THREE.Group();
    const shingleTex = textures.shingles().clone();
    shingleTex.needsUpdate = true;
    const roofMat = material({ color: look?.color ?? ROOF_COLORS[b.kind], map: look?.thatch ? textures.thatch() : shingleTex, side: THREE.DoubleSide });
    const gableMat = material({ color: ALL_STONE[b.kind] ? MASONRY[b.kind] : 0xe8dcc0, side: THREE.DoubleSide });
    const trimMat = material({ color: TIMBER });

    group.add(new THREE.Mesh(gableRoofGeometry(len, span, height, overhang), roofMat));
    group.add(new THREE.Mesh(gableEndsGeometry(len, span, height), gableMat));
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(len + overhang * 2, 0.1, 0.14), trimMat);
    ridge.position.y = height + 0.03;
    group.add(ridge);
    // Barge boards along the gable edges.
    const rake = Math.hypot(span / 2 + overhang, height + (height * overhang) / (span / 2));
    for (const end of [-1, 1])
      for (const side of [-1, 1]) {
        const board = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, rake), trimMat);
        board.position.set(end * (len / 2 + overhang - 0.03), height / 2 - (height * overhang) / (span / 2) / 2, (side * (span / 2 + overhang)) / 2);
        board.rotation.x = side * Math.atan2(height + (height * overhang) / (span / 2), span / 2 + overhang);
        group.add(board);
      }

    // A chimney toward the back wall of anything with a hearth.
    const chimneyMat = material({ color: 0x8a7a6a, map: textures.bricks() });
    const cx = (ox0 + ox1) / 2;
    const cz = (oz0 + oz1) / 2;
    const door = b.doors[0];
    const hearths = hearth && HEARTH[b.kind] && door ? [{ x: Math.round(b.x0 + (b.x1 - b.x0 + 1) * 0.3), y: door.y === b.y1 ? b.y0 + 1 : b.y1 - 1 }] : [];
    for (const p of hearths) {
      const lx = p.x + 0.5 - cx;
      const lz = p.y + 0.5 - cz;
      const [l, s] = alongX ? [lx, lz] : [lz, lx];
      const surface = height * (1 - Math.abs(s) / (span / 2));
      const peak = height + 0.7;
      const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.4, peak - surface + 0.3, 0.4), chimneyMat);
      chimney.position.set(l, (peak + surface - 0.3) / 2, alongX ? s : -s);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.5), chimneyMat);
      cap.position.set(l, peak, alongX ? s : -s);
      group.add(chimney, cap);
      const puffs: THREE.Mesh[] = [];
      for (let i = 0; i < 8; i++) {
        const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: 0xc8c8c8, transparent: true, depthWrite: false }));
        this.group.add(puff);
        puffs.push(puff);
      }
      const world = new THREE.Vector3(alongX ? l : s, peak, alongX ? s : l).add(new THREE.Vector3(cx, eaves, cz));
      this.smoke.push({ puffs, origin: world, roof: state });
    }

    // The guildhall's bell turret and flag on the middle of its ridge.
    if (b.kind === 'guildhall' && hearth) {
      const post = material({ color: 0xe8dcc0, map: textures.plaster() });
      const turret = new THREE.Mesh(new THREE.BoxGeometry(1.15, 1.2, 1.15), post);
      turret.position.y = height + 0.4;
      const open = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 0.7), material({ color: 0x2a2018 }));
      open.position.y = height + 0.65;
      const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.22, 0.32, 10), material({ color: 0xc89a3a }));
      bell.position.y = height + 0.65;
      const spire = new THREE.Mesh(new THREE.ConeGeometry(0.95, 1.7, 4), material({ color: ROOF_COLORS.guildhall, map: textures.shingles() }));
      spire.rotation.y = Math.PI / 4;
      spire.position.y = height + 1.85;
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.9, 5), trimMat);
      mast.position.y = height + 3.1;
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.32), material({ color: 0x1f3a5a, side: THREE.DoubleSide }));
      flag.position.set(0.3, height + 3.35, 0);
      const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.07), material({ color: 0xd4a73a, side: THREE.DoubleSide }));
      stripe.position.set(0.3, height + 3.35, 0.002);
      group.add(turret, open, bell, spire, mast, flag, stripe);
    }

    // A round window high in the gables of some homes and halls.
    if ((b.kind === 'house' || b.kind === 'inn' || b.kind === 'guildhall') && span > 2.5 && hash2(b.parts[0].x0, b.parts[0].y0, 73) < 0.45) {
      const r = Math.min(0.26, height * 0.22);
      const ringGeo = new THREE.TorusGeometry(r, 0.045, 6, 16).rotateY(Math.PI / 2);
      const paneGeo = new THREE.CircleGeometry(r, 16).rotateY(Math.PI / 2);
      const paneMat = material({ color: 0x2a3550, emissive: 0x3a2a10, side: THREE.DoubleSide });
      for (const end of [-1, 1]) {
        const ring = new THREE.Mesh(ringGeo, trimMat);
        ring.position.set(end * (len / 2 + 0.02), height * 0.4, 0);
        const pane = new THREE.Mesh(paneGeo, paneMat);
        pane.position.set(end * (len / 2 + 0.01), height * 0.4, 0);
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.03, r * 2, 0.03), trimMat);
        bar.position.copy(ring.position);
        const bar2 = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, r * 2), trimMat);
        bar2.position.copy(ring.position);
        group.add(ring, pane, bar, bar2);
      }
    }

    group.position.set(cx, eaves, cz);
    if (!alongX) group.rotation.y = -Math.PI / 2;
    top.add(group);
  }

  /** A desert roof: a flat terrace behind a low parapet, and a dome on the larger houses. */
  private addFlatRoof(
    b: Building,
    top: THREE.Group,
    material: (p: THREE.MeshLambertMaterialParameters) => THREE.MeshLambertMaterial,
    tone: number,
    ox0: number,
    ox1: number,
    oz0: number,
    oz1: number,
    eaves: number,
  ): void {
    const roof = new BoxBuilder();
    const t = 0.12;
    roof.box([ox0, eaves - 0.05, oz0], [ox1, eaves + 0.06, oz1], shade(tone, 0.9));
    roof.box([ox0 - 0.03, eaves, oz0 - 0.03], [ox1 + 0.03, eaves + 0.28, oz0 + t], shade(tone, 1.05));
    roof.box([ox0 - 0.03, eaves, oz1 - t], [ox1 + 0.03, eaves + 0.28, oz1 + 0.03], shade(tone, 1.05));
    roof.box([ox0 - 0.03, eaves, oz0], [ox0 + t, eaves + 0.28, oz1], shade(tone, 1.05));
    roof.box([ox1 - t, eaves, oz0], [ox1 + 0.03, eaves + 0.28, oz1], shade(tone, 1.05));
    // Rounded merlons along the parapet, every half tile.
    for (let x = ox0 + 0.3; x < ox1 - 0.2; x += 0.6) {
      roof.box([x - 0.08, eaves + 0.28, oz0 - 0.03], [x + 0.08, eaves + 0.38, oz0 + t], shade(tone, 1.05));
      roof.box([x - 0.08, eaves + 0.28, oz1 - t], [x + 0.08, eaves + 0.38, oz1 + 0.03], shade(tone, 1.05));
    }
    top.add(roof.build(material({ color: 0xffffff, map: textures.plaster(), vertexColors: true })));
    const w = ox1 - ox0;
    const d = oz1 - oz0;
    if (w * d >= 24 || b.name) {
      const r = Math.min(w, d) * 0.3;
      const domeMat = material({ color: b.kind === 'chapel' || b.kind === 'bank' ? 0x3f7a8a : shade(tone, 1.08), map: textures.plaster() });
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.3, 16), material({ color: tone, map: textures.plaster() }));
      drum.position.set((ox0 + ox1) / 2, eaves + 0.2, (oz0 + oz1) / 2);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
      dome.position.set((ox0 + ox1) / 2, eaves + 0.35, (oz0 + oz1) / 2);
      const finial = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.3, 6), material({ color: 0xd4a73a }));
      finial.position.set((ox0 + ox1) / 2, eaves + 0.35 + r + 0.12, (oz0 + oz1) / 2);
      top.add(drum, dome, finial);
    }
  }

  /**
   * A windmill's cap: a shingled pyramid with a finial, and four lattice sails
   * on an axle over the door, which turn slowly.
   */
  private addWindmillTop(
    b: Building,
    top: THREE.Group,
    material: (p: THREE.MeshLambertMaterialParameters) => THREE.MeshLambertMaterial,
    ox0: number,
    ox1: number,
    oz0: number,
    oz1: number,
    eaves: number,
  ): void {
    const cx = (ox0 + ox1) / 2;
    const cz = (oz0 + oz1) / 2;
    const half = Math.max(ox1 - ox0, oz1 - oz0) / 2;
    const capMat = material({ color: ROOF_COLORS.windmill, map: textures.shingles() });
    const wood = material({ color: 0x5a3d22 });
    const cloth = material({ color: 0xe8dcc0, side: THREE.DoubleSide });
    const cap = new THREE.Mesh(new THREE.ConeGeometry(half * Math.SQRT2 + 0.25, 1.7, 4, 1), capMat);
    cap.rotation.y = Math.PI / 4;
    cap.position.set(cx, eaves + 0.85, cz);
    const finial = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), material({ color: 0xd4a73a }));
    finial.position.set(cx, eaves + 1.75, cz);
    top.add(cap, finial);

    // The axle sticks out of the wall the door is in.
    const door = b.doors[0];
    const [nx, nz] = door ? outward(b, door.x, door.y) : [0, 1];
    const mount = new THREE.Group();
    mount.position.set(cx + nx * (half + 0.05), eaves + 0.35, cz + nz * (half + 0.05));
    mount.rotation.y = Math.atan2(nx, nz);
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.6, 8).rotateX(Math.PI / 2), wood);
    axle.position.z = 0.1;
    const rotor = new THREE.Group();
    rotor.position.z = 0.42;
    rotor.rotation.z = hash2(b.x0, b.y0, 71) * Math.PI;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.14, 10).rotateX(Math.PI / 2), wood);
    rotor.add(hub);
    const LEN = 2.3;
    for (let k = 0; k < 4; k++) {
      const arm = new THREE.Group();
      arm.rotation.z = (k * Math.PI) / 2;
      const spar = new THREE.Mesh(new THREE.BoxGeometry(0.08, LEN, 0.06), wood);
      spar.position.y = LEN / 2;
      arm.add(spar);
      // A lattice frame to one side of the spar with cloth stretched over it.
      const sail = new THREE.Mesh(new THREE.PlaneGeometry(0.5, LEN - 0.5), cloth);
      sail.position.set(0.3, LEN / 2 + 0.25, 0.02);
      arm.add(sail);
      for (let r = 0; r <= 5; r++) {
        const rung = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.03, 0.03), wood);
        rung.position.set(0.3, 0.5 + (r * (LEN - 0.5)) / 5, 0.04);
        arm.add(rung);
      }
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.03, LEN - 0.5, 0.03), wood);
      rail.position.set(0.56, LEN / 2 + 0.25, 0.04);
      arm.add(rail);
      rotor.add(arm);
    }
    mount.add(axle, rotor);
    top.add(mount);
    this.sails.push(rotor);
  }

  /** The keep's flat roof: a lead deck, battlements all round and a turret at each corner. */
  private addKeepTop(
    b: Building,
    top: THREE.Group,
    material: (p: THREE.MeshLambertMaterialParameters) => THREE.MeshLambertMaterial,
    ox0: number,
    ox1: number,
    oz0: number,
    oz1: number,
    eaves: number,
  ): void {
    const stone = new BoxBuilder();
    const tone = MASONRY[b.kind];
    stone.box([ox0, eaves - 0.05, oz0], [ox1, eaves + 0.12, oz1], shade(tone, 0.6));
    // Parapet with merlons.
    const t = 0.18;
    stone.box([ox0, eaves, oz0], [ox1, eaves + 0.32, oz0 + t], tone);
    stone.box([ox0, eaves, oz1 - t], [ox1, eaves + 0.32, oz1], tone);
    stone.box([ox0, eaves, oz0], [ox0 + t, eaves + 0.32, oz1], tone);
    stone.box([ox1 - t, eaves, oz0], [ox1, eaves + 0.32, oz1], tone);
    for (let x = ox0 + 0.25; x < ox1 - 0.2; x += 0.5) {
      stone.box([x - 0.12, eaves + 0.32, oz0], [x + 0.12, eaves + 0.55, oz0 + t], tone);
      stone.box([x - 0.12, eaves + 0.32, oz1 - t], [x + 0.12, eaves + 0.55, oz1], tone);
    }
    for (let z = oz0 + 0.25; z < oz1 - 0.2; z += 0.5) {
      stone.box([ox0, eaves + 0.32, z - 0.12], [ox0 + t, eaves + 0.55, z + 0.12], tone);
      stone.box([ox1 - t, eaves + 0.32, z - 0.12], [ox1, eaves + 0.55, z + 0.12], tone);
    }
    top.add(stone.build(material({ color: 0xffffff, map: textures.bricks(), vertexColors: true })));
    const towerMat = material({ color: tone, map: textures.bricks() });
    const capMat = material({ color: ROOF_COLORS.keep, map: textures.shingles() });
    for (const x of [ox0, ox1])
      for (const z of [oz0, oz1]) {
        const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.45, 1.1, 10), towerMat);
        tower.position.set(x, eaves + 0.3, z);
        const cap = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.9, 10), capMat);
        cap.position.set(x, eaves + 1.3, z);
        top.add(tower, cap);
      }
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
    this.pickables.push(group);
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

const RUGS: Partial<Record<BuildingKind, [string, string, string]>> = {
  bank: ['#2f4f7a', '#d4a73a', '#8fb0d8'],
  store: ['#7a2f3a', '#e3c27a', '#2f4a5a'],
  inn: ['#4f5f34', '#e0d0a0', '#9a3a2a'],
  chapel: ['#6a2a3a', '#e8d8a0', '#3a2a5a'],
  keep: ['#6a1f1f', '#d4a73a', '#1f2f4a'],
  library: ['#3a2f5a', '#c8b88a', '#7a4a2a'],
  guildhall: ['#1f3a5a', '#d4a73a', '#8a2a2a'],
  house: ['#6a4a2a', '#d0b080', '#8a3a2a'],
};
/** Colours for homes' rugs, picked per house. */
const RUG_COLOURS: [string, string, string][] = [
  ['#6a4a2a', '#d0b080', '#8a3a2a'],
  ['#8a3a2a', '#e8c890', '#2f3a5a'],
  ['#2f5a4a', '#d8c898', '#a04a2a'],
  ['#4a3a6a', '#d8b870', '#6a8aa0'],
  ['#a0703a', '#4a2a1a', '#e8d8b0'],
  ['#2f3f5f', '#c8a050', '#a03a3a'],
  ['#7a6a4a', '#3a2f24', '#c8b890'],
  ['#9a4a5a', '#f0d8b0', '#3a4a3a'],
  ['#3a5a7a', '#e0e0d0', '#c08a3a'],
  ['#5a6a3a', '#e8d0a0', '#6a2a2a'],
];
const RUG_PATTERNS: RugPattern[] = ['medallion', 'stripes', 'checks', 'lattice', 'plain'];

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
  guildhall: (ctx) => {
    // Two hands clasped over a key: the guilds' oath.
    ctx.strokeStyle = '#e8c04a';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(-14, -8, 10, 0, Math.PI * 2);
    ctx.moveTo(-4, -8);
    ctx.lineTo(30, -8);
    ctx.moveTo(20, -8);
    ctx.lineTo(20, 4);
    ctx.moveTo(28, -8);
    ctx.lineTo(28, 2);
    ctx.stroke();
    ctx.fillStyle = '#d9b48a';
    ctx.beginPath();
    ctx.ellipse(-10, 18, 18, 9, 0.3, 0, Math.PI * 2);
    ctx.ellipse(10, 18, 18, 9, -0.3, 0, Math.PI * 2);
    ctx.fill();
  },
  windmill: (ctx) => {
    ctx.fillStyle = '#e8d8a8';
    ctx.strokeStyle = '#e8d8a8';
    ctx.lineWidth = 4;
    for (let k = 0; k < 4; k++) {
      ctx.save();
      ctx.translate(0, -4);
      ctx.rotate(k * Math.PI / 2 + 0.4);
      ctx.fillRect(4, -5, 26, 10);
      ctx.restore();
    }
    ctx.fillStyle = '#c8a050';
    for (const [x, y, a] of [[-12, 26, -0.4], [0, 28, 0], [12, 26, 0.4]]) {
      ctx.beginPath();
      ctx.ellipse(x, y, 4, 9, a, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  house: () => {},
};
