import type {
  MapArea,
  MapData,
  MapSource,
  MonsterDef,
  NpcDef,
  Placement,
  PlacementKind,
  ResourceDef,
  SceneryDef,
  StationDef,
  TerrainDef,
} from './types';

/** Shape of a map file such as maps/kelmoor.json. */
export interface JsonMapFile {
  name: string;
  width: number;
  height: number;
  tileSize?: number;
  spawn: { x: number; y: number };
  legend: Record<string, { name: string; walkable: boolean }>;
  areas?: (MapArea & { tier?: number })[];
  /**
   * Everyone on the map. An entry with a `role` is a person (shopkeeper,
   * banker, trainer); one with a level and no role is a monster. `wander` is
   * the box they keep to.
   */
  npcs?: {
    name: string;
    role?: string | null;
    level?: number | null;
    shop?: string | null;
    x: number;
    y: number;
    wander?: { x: number; y: number; w: number; h: number } | null;
  }[];
  /** Where each skill is trained, for the skill finder. */
  skills?: { name: string; note: string; sites: { label: string; x: number; y: number }[] }[];
  /** rows[y][x] is the tile code at (x, y). */
  rows: string[];
}

export function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * The legend only says name and walkable, so which tiles are things standing
 * on the ground (rather than the ground itself) is decided here, by name.
 * Anything not listed is terrain.
 */
const OBJECT_KINDS: Record<string, Exclude<PlacementKind, 'npc' | 'monster'>> = {
  tree: 'resource',
  dead_tree: 'resource',
  oak_tree: 'resource',
  willow_tree: 'resource',
  yew_tree: 'resource',
  starwood_tree: 'resource',
  copper_rock: 'resource',
  tin_rock: 'resource',
  iron_rock: 'resource',
  coal_rock: 'resource',
  gold_rock: 'resource',
  cobalt_rock: 'resource',
  verdite_rock: 'resource',
  glacite_rock: 'resource',
  shallow_fishing_spot: 'resource',
  deep_fishing_spot: 'resource',
  anvil: 'station',
  furnace: 'station',
  range: 'station',
  bank_booth: 'station',
  market_stall: 'station',
  altar: 'station',
  standing_stone: 'scenery',
  statue: 'scenery',
  log_pile: 'scenery',
  hide_tent: 'scenery',
  campfire: 'station',
  goblin_totem: 'scenery',
  gravestone: 'scenery',
  cactus: 'scenery',
  palm_tree: 'scenery',
  aether_stone: 'resource',
  // Agility, Glyphcraft and Farming give these their own actions.
  agility_obstacle: 'scenery',
  glyph_shrine: 'scenery',
  farming_patch: 'scenery',
  // Waiting for the phase that adds their skill, so they are props for now.
  spinning_wheel: 'scenery',
  homestead_gate: 'scenery',
  cave_entrance: 'scenery',
  training_dummy: 'scenery',
  archery_target: 'scenery',
};

/** The skill a resource belongs to is clear from its name; levels and yields are not in the map. */
function resourceSkill(key: string): string {
  if (key.endsWith('tree')) return 'woodcutting';
  if (key.endsWith('rock')) return 'mining';
  if (key.endsWith('fishing_spot')) return 'fishing';
  if (key === 'aether_stone') return 'mining';
  return 'unknown';
}

/**
 * Loads the one-char-per-tile JSON map format (rows + legend + areas + npcs).
 * The parsed object is passed in so this works the same in the browser
 * (bundled JSON import) and in Node (fs).
 */
export class JsonMapSource implements MapSource {
  constructor(
    private readonly id: string,
    private readonly file: JsonMapFile,
  ) {}

  load(): MapData {
    const { file, id } = this;
    const { width, height, rows, legend } = file;

    if (rows.length !== height) throw new Error(`Map ${id}: expected ${height} rows, found ${rows.length}`);
    rows.forEach((row, y) => {
      if (row.length !== width) throw new Error(`Map ${id}: row ${y} has ${row.length} columns, expected ${width}`);
    });

    const terrainDefs: TerrainDef[] = [];
    const terrainIndexByChar = new Map<string, number>();
    const objectByChar = new Map<string, { kind: PlacementKind; key: string }>();
    const resources: Record<string, ResourceDef> = {};
    const stations: Record<string, StationDef> = {};
    const scenery: Record<string, SceneryDef> = {};

    for (const [ch, t] of Object.entries(legend)) {
      if ([...ch].length !== 1) throw new Error(`Map ${id}: legend code '${ch}' must be a single character`);
      const key = slug(t.name);
      const kind = OBJECT_KINDS[key];
      if (!kind) {
        terrainIndexByChar.set(ch, terrainDefs.length);
        terrainDefs.push({ key, name: t.name, walkable: t.walkable });
        continue;
      }
      if (t.walkable) throw new Error(`Map ${id}: '${t.name}' is an object but the legend marks it walkable`);
      objectByChar.set(ch, { kind, key });
      if (kind === 'resource') resources[key] = { key, name: t.name, skill: resourceSkill(key) };
      else if (kind === 'station') stations[key] = { key, name: t.name };
      else scenery[key] = { key, name: t.name };
    }

    const terrain: number[] = new Array(width * height).fill(-1);
    const placements: Placement[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const ch = rows[y][x];
        const t = terrainIndexByChar.get(ch);
        if (t !== undefined) {
          terrain[y * width + x] = t;
          continue;
        }
        const o = objectByChar.get(ch);
        if (!o) throw new Error(`Map ${id}: unknown character '${ch}' at ${x},${y}`);
        placements.push({ kind: o.kind, defKey: o.key, x, y });
      }
    }

    // Objects have no ground of their own in the file, so they take the most
    // common walkable terrain around them (floor indoors, grass in a field).
    // Objects on water (the fountain statue) sit in the water.
    const water = terrainDefs.findIndex((d) => d.key === 'water');
    const fallback = terrainIndexByChar.get('.') ?? terrainDefs.findIndex((d) => d.walkable);
    for (const p of placements) {
      const counts = new Map<number, number>();
      for (let r = 1; r <= 3 && counts.size === 0; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const nx = p.x + dx;
            const ny = p.y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const t = terrainIndexByChar.get(rows[ny][nx]);
            if (t === undefined) continue;
            if (!terrainDefs[t].walkable && t !== water) continue;
            counts.set(t, (counts.get(t) ?? 0) + 1);
          }
        }
      }
      let best = fallback;
      let bestCount = 0;
      for (const [t, c] of counts) {
        if (c > bestCount) {
          best = t;
          bestCount = c;
        }
      }
      terrain[p.y * width + p.x] = best;
    }

    const walkableAt = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < width && y < height && !objectByChar.has(rows[y][x]) && terrainDefs[terrain[y * width + x]].walkable;

    const monsters: Record<string, MonsterDef> = {};
    const npcs: Record<string, NpcDef> = {};
    for (const n of file.npcs ?? []) {
      const key = slug(n.name);
      if (!walkableAt(n.x, n.y)) throw new Error(`Map ${id}: ${n.name} at ${n.x},${n.y} is not on a walkable tile`);
      const wander = n.wander
        ? { cx: n.wander.x + (n.wander.w - 1) / 2, cy: n.wander.y + (n.wander.h - 1) / 2, radius: Math.max(n.wander.w, n.wander.h) / 2 }
        : undefined;
      if (n.role) {
        npcs[key] ??= { key, name: n.name, role: n.role, shop: n.shop ?? undefined };
        placements.push({ kind: 'npc', defKey: key, x: n.x, y: n.y, wander });
        continue;
      }
      monsters[key] ??= { key, name: n.name, combatLevel: n.level ?? 1 };
      placements.push({ kind: 'monster', defKey: key, x: n.x, y: n.y, level: n.level ?? undefined, wander });
    }

    const spawn = { x: file.spawn.x, y: file.spawn.y };
    if (!walkableAt(spawn.x, spawn.y)) throw new Error(`Map ${id}: spawn ${spawn.x},${spawn.y} is not walkable`);

    // Trees spread out once everyone is placed, leaving the spawn and every
    // person and monster's own tile clear.
    const keep = new Set([spawn.y * width + spawn.x, ...placements.filter((p) => p.kind === 'npc' || p.kind === 'monster').map((p) => p.y * width + p.x)]);
    growBigTrees(placements, terrain, terrainDefs, width, height, keep);

    for (const a of file.areas ?? []) {
      if (a.x < 0 || a.y < 0 || a.x + a.w > width || a.y + a.h > height) throw new Error(`Map ${id}: area '${a.name}' runs off the map`);
    }

    return {
      id,
      width,
      height,
      terrain,
      terrainDefs,
      placements,
      areas: (file.areas ?? []).map((a) => ({ ...a })),
      skills: (file.skills ?? []).map((s) => ({ ...s, sites: s.sites.map((p) => ({ ...p })) })),
      spawn,
      defs: { resources, stations, scenery, npcs, monsters },
    };
  }
}

/** How often each kind of tree grows to cover 2 x 2 tiles, where it has room. */
const BIG_TREE_CHANCE: Record<string, number> = {
  tree: 0.55,
  dead_tree: 0.45,
  oak_tree: 0.9,
  willow_tree: 0.9,
  yew_tree: 0.95,
  starwood_tree: 0.95,
};

/** Ground a big tree may spread over. */
const OPEN_GROUND = new Set(['grass', 'long_grass']);

/**
 * Lets trees grow to cover 2 x 2 tiles. A tree takes the square over open
 * grass or over three more trees of its kind, and only where that never cuts
 * a way through: the walkable tiles around the square must still join up
 * around its outside, and every object beside it keeps a free side. So
 * nothing that could be reached before is shut off.
 */
function growBigTrees(placements: Placement[], terrain: number[], terrainDefs: TerrainDef[], width: number, height: number, keep: Set<number>): void {
  const objectAt = new Map<number, Placement>();
  for (const p of placements) if (p.kind !== 'monster') objectAt.set(p.y * width + p.x, p);
  const inMap = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height;
  const blocked = (x: number, y: number) => !inMap(x, y) || objectAt.has(y * width + x) || !terrainDefs[terrain[y * width + x]].walkable;
  const open = (x: number, y: number) => {
    const i = y * width + x;
    return inMap(x, y) && !objectAt.has(i) && !keep.has(i) && OPEN_GROUND.has(terrainDefs[terrain[i]].key);
  };
  const removed = new Set<Placement>();
  // The ring of tiles around a square at (x, y), walked clockwise.
  const ring = (x: number, y: number): [number, number][] => [
    [x - 1, y - 1], [x, y - 1], [x + 1, y - 1], [x + 2, y - 1],
    [x + 2, y], [x + 2, y + 1], [x + 2, y + 2],
    [x + 1, y + 2], [x, y + 2], [x - 1, y + 2],
    [x - 1, y + 1], [x - 1, y],
  ];

  const trees = placements.filter((p) => p.kind === 'resource' && BIG_TREE_CHANCE[p.defKey] !== undefined);
  for (const tree of trees) {
    if (removed.has(tree) || tileHash(tree.x, tree.y) >= BIG_TREE_CHANCE[tree.defKey]) continue;
    // Try the four squares the tree could sit in, starting from a different one per tree.
    const first = Math.floor(tileHash(tree.y, tree.x) * 4);
    for (let k = 0; k < 4; k++) {
      const corner = (first + k) % 4;
      const x = tree.x - (corner & 1);
      const y = tree.y - (corner >> 1);
      const cells: [number, number][] = [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]];
      const absorbed: Placement[] = [];
      const fits = cells.every(([cx, cy]) => {
        if (cx === tree.x && cy === tree.y) return true;
        const other = inMap(cx, cy) ? objectAt.get(cy * width + cx) : undefined;
        if (other) {
          if (other.defKey !== tree.defKey || other.size || removed.has(other)) return false;
          absorbed.push(other);
          return true;
        }
        return open(cx, cy);
      });
      if (!fits || !keepsWaysOpen(ring(x, y), cells, blocked, objectAt, width, inMap)) continue;
      for (const o of absorbed) {
        removed.add(o);
        objectAt.delete(o.y * width + o.x);
      }
      for (const [cx, cy] of cells) objectAt.set(cy * width + cx, tree);
      tree.x = x;
      tree.y = y;
      tree.size = 2;
      break;
    }
  }
  for (let i = placements.length - 1; i >= 0; i--) if (removed.has(placements[i])) placements.splice(i, 1);
}

/**
 * Whether blocking a square leaves its surroundings connected: every walkable
 * tile around the square can still reach every other one without crossing it
 * (searching a few tiles out, walking as the pathfinder does), and every
 * object beside it keeps a side joined to them.
 */
function keepsWaysOpen(
  ring: [number, number][],
  square: [number, number][],
  blocked: (x: number, y: number) => boolean,
  objectAt: Map<number, Placement>,
  width: number,
  inMap: (x: number, y: number) => boolean,
): boolean {
  const [sx, sy] = square[0];
  const inSquare = (x: number, y: number) => x >= sx && x <= sx + 1 && y >= sy && y <= sy + 1;
  const walk = (x: number, y: number) => !inSquare(x, y) && !blocked(x, y);
  const open = ring.filter(([x, y]) => walk(x, y));
  if (!open.length) return false;

  const R = 4;
  const inWindow = (x: number, y: number) => x >= sx - R && x <= sx + 1 + R && y >= sy - R && y <= sy + 1 + R;
  const key = (x: number, y: number) => y * width + x;
  const seen = new Set([key(...open[0])]);
  const queue = [open[0]];
  while (queue.length) {
    const [x, y] = queue.pop()!;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inWindow(nx, ny) || !walk(nx, ny) || seen.has(key(nx, ny))) continue;
        if (dx && dy && (!walk(nx, y) || !walk(x, ny))) continue;
        seen.add(key(nx, ny));
        queue.push([nx, ny]);
      }
  }
  if (!open.every(([x, y]) => seen.has(key(x, y)))) return false;

  for (const [x, y] of ring) {
    if (!inMap(x, y) || !objectAt.has(key(x, y))) continue;
    // Its free side must join the rest, not be a pocket that was reached through the square.
    const free = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]].some(([dx, dy]) => seen.has(key(x + dx, y + dy)));
    if (!free) return false;
  }
  return true;
}

/** Deterministic value in [0, 1) for a tile. */
function tileHash(x: number, y: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The smallest named area containing a tile, so "Smithy" wins over "Kelmoor". */
export function areaAt(map: MapData, x: number, y: number): MapArea | null {
  let best: MapArea | null = null;
  for (const a of map.areas) {
    if (x < a.x || y < a.y || x >= a.x + a.w || y >= a.y + a.h) continue;
    if (!best || a.w * a.h < best.w * best.h) best = a;
  }
  return best;
}
