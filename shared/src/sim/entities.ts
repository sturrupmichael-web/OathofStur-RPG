import type { Point } from '../map/types';
import type { AttackStyle } from './combat';
import type { StationKind } from './crafting';
import type { Equipment, Inventory, ItemStack } from './items';
import type { SkillXp } from './skills';

export type EntityId = number;

/** What a player is busy with between ticks. Walking somewhere else cancels it. */
export type PlayerAction =
  | {
      kind: 'gather';
      targetId: EntityId;
      /** Tick of the next gathering attempt. */
      nextAttempt: number;
      /** Set once the player has arrived and started, so the start message is sent once. */
      started: boolean;
    }
  /** Walking to a station, banker or shopkeeper; its window opens on arrival. */
  | { kind: 'use'; targetId: EntityId }
  /** Making things at a station, one every recipe.ticks. */
  | { kind: 'craft'; stationId: EntityId; recipeId: string; remaining: number; nextAttempt: number; started?: boolean }
  /** Fighting a monster: chase it into reach, then swing whenever the weapon is ready. */
  | { kind: 'attack'; targetId: EntityId; chasing?: Point };

/** The window a player has open. Walking away closes it. */
export type OpenUi =
  | { kind: 'bank'; at: EntityId }
  | { kind: 'shop'; shopId: string; at: EntityId }
  | { kind: 'craft'; station: StationKind; at: EntityId };

export interface PlayerEntity {
  id: EntityId;
  kind: 'player';
  name: string;
  x: number;
  y: number;
  skills: SkillXp;
  /** Current hitpoints; the maximum is the Hitpoints level. */
  hp: number;
  inventory: Inventory;
  equipment: Equipment;
  attackStyle: AttackStyle;
  bank: ItemStack[];
  ui: OpenUi | null;
  createdAt: string;
  /** Remaining steps, one taken per tick. */
  path: Point[];
  /** Final tile of the current path, for the client's destination marker. */
  destination: Point | null;
  /** Set when a path was cut short at a locked gate; reported on arrival. */
  gateNotice: Point | null;
  action: PlayerAction | null;
  /** Ground item to pick up when the path ends. */
  pickup: EntityId | null;
  /** Tick from which the next attack may be made. */
  nextAttack: number;
  /** Tick from which the next food may be eaten. */
  nextEat: number;
  /** Tick of the next natural hitpoint regained. */
  nextRegen: number;
  /** Who is fighting this player, so it can face them and hit back. */
  attackedBy: EntityId | null;
  /** Set while dead: the tick they wake up at the spawn point. */
  deadUntil?: number;
}

/** A monster at its spawn point. Dead monsters stay in the world, hidden, until they respawn. */
export interface MonsterEntity {
  id: EntityId;
  kind: 'monster';
  defKey: string;
  name: string;
  level: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  spawn: Point;
  /** Where it roams when it isn't fighting. */
  wander: { cx: number; cy: number; radius: number };
  path: Point[];
  /** The player it is fighting. */
  target: EntityId | null;
  nextAttack: number;
  /** Tick it next considers wandering. */
  nextWander: number;
  /** Damage each player has dealt this life; the biggest share gets the loot. */
  damageBy: Map<EntityId, number>;
  /** Set when it falls: the death animation plays until this tick, then loot drops. */
  dyingUntil?: number;
  /** Set while dead: the tick it comes back. */
  respawnAt?: number;
}

/** Static world objects that occupy a tile: resource nodes, stations, props, NPCs. */
export interface ObjectEntity {
  id: EntityId;
  kind: 'resource' | 'station' | 'scenery' | 'npc';
  defKey: string;
  name: string;
  x: number;
  y: number;
  /** Tiles per side when bigger than one (big trees cover 2 x 2 from x, y). */
  size?: number;
  /** Resources only: tick at which a used-up node comes back. */
  depletedUntil?: number;
}

/** An item lying on the ground. It vanishes at `despawnAt`. */
export interface GroundItemEntity {
  id: EntityId;
  kind: 'item';
  itemId: string;
  qty: number;
  name: string;
  x: number;
  y: number;
  despawnAt: number;
  /** Only this player sees it until `publicAt` (their drops, their loot). */
  owner?: EntityId;
  publicAt?: number;
}

export type Entity = PlayerEntity | ObjectEntity | GroundItemEntity | MonsterEntity;
