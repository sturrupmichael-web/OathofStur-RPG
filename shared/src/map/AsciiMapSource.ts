import type {
  MapData,
  MapSource,
  MonsterDef,
  NpcDef,
  Placement,
  PlacementKind,
  ResourceDef,
  StationDef,
  TerrainDef,
} from './types';

/** Shape of legend.json. */
export interface AsciiLegend {
  width: number;
  height: number;
  spawn: { x: number; y: number };
  tiles: Record<string, { name: string; walkable: boolean; base?: string; requires?: { skill: string; level: number }; note?: string }>;
  resources: Record<string, Omit<ResourceDef, 'key'>>;
  stations: Record<string, Omit<StationDef, 'key'>>;
  npcs: Record<string, Omit<NpcDef, 'key'>>;
  monsters: Record<string, Omit<MonsterDef, 'key'>>;
}

export function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Loads the one-char-per-tile ASCII map plus its legend. Raw text is passed in
 * so this works the same in the browser (Vite ?raw import) and in Node (fs).
 */
export class AsciiMapSource implements MapSource {
  constructor(
    private readonly id: string,
    private readonly text: string,
    private readonly legend: AsciiLegend,
  ) {}

  load(): MapData {
    const { legend } = this;
    const rows = this.text.replace(/\r/g, '').split('\n');
    while (rows.length && rows[rows.length - 1] === '') rows.pop();

    if (rows.length !== legend.height) {
      throw new Error(`Map ${this.id}: expected ${legend.height} rows, found ${rows.length}`);
    }
    rows.forEach((row, y) => {
      if (row.length !== legend.width) {
        throw new Error(`Map ${this.id}: row ${y} has ${row.length} columns, expected ${legend.width}`);
      }
    });

    // Terrain defs. Tiles with a `base` (e.g. the spawn marker) render and behave as their base.
    const terrainDefs: TerrainDef[] = [];
    const terrainIndexByChar = new Map<string, number>();
    for (const [ch, t] of Object.entries(legend.tiles)) {
      if (t.base) continue;
      terrainIndexByChar.set(ch, terrainDefs.length);
      terrainDefs.push({ key: slug(t.name), name: t.name, walkable: t.walkable, requires: t.requires, note: t.note });
    }
    for (const [ch, t] of Object.entries(legend.tiles)) {
      if (!t.base) continue;
      const baseIndex = terrainIndexByChar.get(t.base);
      if (baseIndex === undefined) throw new Error(`Map ${this.id}: tile '${ch}' has unknown base '${t.base}'`);
      terrainIndexByChar.set(ch, baseIndex);
    }

    const placementKinds: [PlacementKind, Record<string, { name: string }>][] = [
      ['resource', legend.resources],
      ['station', legend.stations],
      ['npc', legend.npcs],
      ['monster', legend.monsters],
    ];
    const placementByChar = new Map<string, { kind: PlacementKind; key: string }>();
    for (const [kind, table] of placementKinds) {
      for (const [ch, def] of Object.entries(table)) {
        if (placementByChar.has(ch) || terrainIndexByChar.has(ch)) {
          throw new Error(`Map ${this.id}: character '${ch}' is defined twice in the legend`);
        }
        placementByChar.set(ch, { kind, key: slug(def.name) });
      }
    }

    const keyed = <T extends { name: string }>(table: Record<string, T>) =>
      Object.fromEntries(Object.values(table).map((d) => [slug(d.name), { ...d, key: slug(d.name) }]));

    const width = legend.width;
    const height = legend.height;
    const terrain: number[] = new Array(width * height).fill(-1);
    const placements: Placement[] = [];
    const grass = terrainIndexByChar.get('.');
    const water = terrainIndexByChar.get('~');

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const ch = rows[y][x];
        const t = terrainIndexByChar.get(ch);
        if (t !== undefined) {
          terrain[y * width + x] = t;
          continue;
        }
        const p = placementByChar.get(ch);
        if (!p) throw new Error(`Map ${this.id}: unknown character '${ch}' at ${x},${y}`);
        placements.push({ kind: p.kind, defKey: p.key, x, y });
      }
    }

    // The legend gives no base terrain for placements, so infer it:
    // fishing spots sit on water; everything else takes the most common
    // walkable terrain around it (floor indoors, grass outside).
    for (const p of placements) {
      const i = p.y * width + p.x;
      if (p.kind === 'resource' && legend.resources[rows[p.y][p.x]]?.skill === 'fishing' && water !== undefined) {
        terrain[i] = water;
        continue;
      }
      const counts = new Map<number, number>();
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = p.x + dx;
          const ny = p.y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const t = terrainIndexByChar.get(rows[ny][nx]);
          if (t === undefined || !terrainDefs[t].walkable || terrainDefs[t].requires) continue;
          counts.set(t, (counts.get(t) ?? 0) + 1);
        }
      }
      let best = grass ?? 0;
      let bestCount = 0;
      for (const [t, c] of counts) {
        if (c > bestCount) {
          best = t;
          bestCount = c;
        }
      }
      terrain[i] = best;
    }

    const spawn = { x: legend.spawn.x, y: legend.spawn.y };
    const spawnTerrain = terrainDefs[terrain[spawn.y * width + spawn.x]];
    if (!spawnTerrain?.walkable || placements.some((p) => p.x === spawn.x && p.y === spawn.y && p.kind !== 'monster')) {
      throw new Error(`Map ${this.id}: spawn ${spawn.x},${spawn.y} is not walkable`);
    }

    return {
      id: this.id,
      width,
      height,
      terrain,
      terrainDefs,
      placements,
      spawn,
      defs: {
        resources: keyed(legend.resources),
        stations: keyed(legend.stations),
        npcs: keyed(legend.npcs),
        monsters: keyed(legend.monsters),
      },
    };
  }
}
