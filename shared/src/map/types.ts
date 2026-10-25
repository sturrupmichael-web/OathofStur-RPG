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
  level: number;
  /** Item(s) as written in the source data; parsed into item ids in later phases. */
  item: string;
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
  aggressive: boolean;
  boss?: boolean;
  drops?: string[];
}

export type PlacementKind = 'resource' | 'station' | 'npc' | 'monster';

/** Something placed on the map: a resource node, station, NPC, or monster spawn point. */
export interface Placement {
  kind: PlacementKind;
  defKey: string;
  x: number;
  y: number;
}

/**
 * Format-independent world description. Game logic only ever sees this, so the
 * ASCII loader can be swapped for a Tiled or LDtk loader without touching it.
 */
export interface MapData {
  id: string;
  width: number;
  height: number;
  /** Row-major, index = y * width + x, values index into `terrainDefs`. */
  terrain: number[];
  terrainDefs: TerrainDef[];
  placements: Placement[];
  spawn: Point;
  defs: {
    resources: Record<string, ResourceDef>;
    stations: Record<string, StationDef>;
    npcs: Record<string, NpcDef>;
    monsters: Record<string, MonsterDef>;
  };
}

export interface MapSource {
  load(): MapData;
}
