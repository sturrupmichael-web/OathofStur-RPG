export interface Point {
  x: number;
  y: number;
}

/** A level requirement. `skill` is a skill id, or "combat" for combat level. */
export interface Requirement {
  skill: string;
  level: number;
}

export interface TerrainDef {
  /** Stable semantic id, e.g. "grass", "gate". Independent of the ASCII char. */
  key: string;
  name: string;
  walkable: boolean;
  requires?: Requirement;
  note?: string;
}

export interface ResourceDef {
  key: string;
  name: string;
  skill: string;
  /** Undefined when the map data doesn't say (Kelmoor gives no skill levels yet). */
  level?: number;
  /** Item(s) as written in the source data; parsed into item ids in later phases. */
  item?: string;
  respawnTicks?: number;
  tool?: string;
}

export interface StationDef {
  key: string;
  name: string;
}

export interface NpcDef {
  key: string;
  name: string;
  role: string;
}

export interface MonsterDef {
  key: string;
  name: string;
  combatLevel: number;
  aggressive?: boolean;
  boss?: boolean;
  drops?: string[];
}

/** Solid, non-interactive props: statues, tents, standing stones. */
export interface SceneryDef {
  key: string;
  name: string;
}

export type PlacementKind = 'resource' | 'station' | 'scenery' | 'npc' | 'monster';

/** Something placed on the map: a resource node, station, prop, NPC, or monster spawn point. */
export interface Placement {
  kind: PlacementKind;
  defKey: string;
  x: number;
  y: number;
  /** Per-spawn level, when the map gives one (monsters). */
  level?: number;
  /** Where a spawned creature may roam. */
  wander?: { cx: number; cy: number; radius: number };
}

/** A named rectangle: a building, district or region. Inclusive x..x+w-1. */
export interface MapArea {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Format-independent world description. Game logic only ever sees this, so the
 * JSON loader can be swapped for a Tiled or LDtk loader without touching it.
 */
export interface MapData {
  id: string;
  width: number;
  height: number;
  /** Row-major, index = y * width + x, values index into `terrainDefs`. */
  terrain: number[];
  terrainDefs: TerrainDef[];
  placements: Placement[];
  /** Named regions, in the order the source lists them. */
  areas: MapArea[];
  spawn: Point;
  defs: {
    resources: Record<string, ResourceDef>;
    stations: Record<string, StationDef>;
    scenery: Record<string, SceneryDef>;
    npcs: Record<string, NpcDef>;
    monsters: Record<string, MonsterDef>;
  };
}

export interface MapSource {
  load(): MapData;
}
