import type { Point } from '../map/types';
import type { StationKind } from './crafting';
import type { Inventory, ItemStack } from './items';
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
  | { kind: 'craft'; stationId: EntityId; recipeId: string; remaining: number; nextAttempt: number; started?: boolean };

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
  inventory: Inventory;
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
}

/** Static world objects that occupy a tile: resource nodes, stations, props, NPCs. */
export interface ObjectEntity {
  id: EntityId;
  kind: 'resource' | 'station' | 'scenery' | 'npc';
  defKey: string;
  name: string;
  x: number;
  y: number;
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
}

export type Entity = PlayerEntity | ObjectEntity | GroundItemEntity;
