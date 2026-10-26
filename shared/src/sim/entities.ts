import type { Point } from '../map/types';
import type { SkillXp } from './skills';

export type EntityId = number;

export interface PlayerEntity {
  id: EntityId;
  kind: 'player';
  name: string;
  x: number;
  y: number;
  skills: SkillXp;
  /** Remaining steps, one taken per tick. */
  path: Point[];
  /** Final tile of the current path, for the client's destination marker. */
  destination: Point | null;
  /** Set when a path was cut short at a locked gate; reported on arrival. */
  gateNotice: Point | null;
}

/** Static world objects that occupy a tile: resource nodes, stations, props, NPCs. */
export interface ObjectEntity {
  id: EntityId;
  kind: 'resource' | 'station' | 'scenery' | 'npc';
  defKey: string;
  name: string;
  x: number;
  y: number;
}

export type Entity = PlayerEntity | ObjectEntity;
