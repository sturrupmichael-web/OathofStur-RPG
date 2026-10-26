import type { Point } from '../map/types';
import type { EntityId } from '../sim/entities';
import type { Inventory, ItemStack } from '../sim/items';
import type { SaveData } from '../sim/save';
import type { SkillId, SkillXp } from '../sim/skills';

/** Bumped whenever a message shape changes, so client and server can refuse a mismatch. */
export const PROTOCOL_VERSION = 3;

// ---------------------------------------------------------------------------
// Client -> server. Intents only: the simulation validates and decides outcomes.
// ---------------------------------------------------------------------------

export type ClientMessage =
  | { type: 'join'; name: string; protocolVersion: number; save?: SaveData | null }
  | { type: 'walk'; x: number; y: number }
  /**
   * Use a world object: gather from a tree, rock or fishing spot, take a
   * ground item, or use a station, bank or shopkeeper (opens its window).
   */
  | { type: 'interact'; targetId: EntityId; action: 'gather' | 'take' | 'use' }
  | { type: 'examine'; targetId: EntityId }
  | { type: 'examineItem'; slot: number }
  | { type: 'invDrop'; slot: number }
  | { type: 'invMove'; from: number; to: number }
  | { type: 'requestSave' }
  | { type: 'closeInterface' }
  /** Make `qty` of a recipe at the open station window. */
  | { type: 'craft'; recipeId: string; qty: number }
  | { type: 'bankDeposit'; slot: number; qty: number }
  | { type: 'bankDepositAll' }
  | { type: 'bankWithdraw'; index: number; qty: number }
  | { type: 'shopBuy'; itemId: string; qty: number }
  | { type: 'shopSell'; slot: number; qty: number };

// ---------------------------------------------------------------------------
// Server -> client.
// ---------------------------------------------------------------------------

/** What any client may see about an entity. Private state never goes here. */
export interface PublicEntity {
  id: EntityId;
  kind: 'player' | 'resource' | 'station' | 'scenery' | 'npc' | 'item';
  x: number;
  y: number;
  name: string;
  defKey?: string;
  /** Tiles per side for objects bigger than one tile (big trees). */
  size?: number;
  combatLevel?: number;
  /** Resources: used up and waiting to grow back (a stump). */
  depleted?: boolean;
  /** Players: the tile they are working on, so others see them face it. */
  workingOn?: Point;
  /** Players: what they are doing there, which picks the animation and tool. */
  activity?: Activity;
  /** Ground items: how many. */
  qty?: number;
}

export type Activity = 'chop' | 'mine' | 'net' | 'rod' | 'cook' | 'smelt' | 'smith';

/** The window the player has open, with what it needs to draw. */
export type UiView =
  | { kind: 'bank'; items: ItemStack[] }
  | { kind: 'shop'; shopId: string; name: string; stock: { itemId: string; price: number }[]; buys: 'all' | string[]; sellRate: number }
  | {
      kind: 'craft';
      title: string;
      recipes: { id: string; output: string; level: number; skill: SkillId; xp: number; inputs: { itemId: string; qty: number }[] }[];
    };

/** State only the owning player sees. */
export interface SelfState {
  id: EntityId;
  name: string;
  skills: SkillXp;
  combatLevel: number;
  destination: Point | null;
  inventory: Inventory;
  ui: UiView | null;
}

export type GameMessageKind = 'info' | 'warn' | 'examine' | 'quest' | 'levelup';

export type ServerMessage =
  | { type: 'welcome'; playerId: EntityId; protocolVersion: number; mapId: string; tick: number; tickMs: number }
  | { type: 'snapshot'; tick: number; entities: PublicEntity[] }
  | { type: 'tick'; tick: number; added: PublicEntity[]; updated: PublicEntity[]; removed: EntityId[] }
  | { type: 'self'; state: SelfState }
  | { type: 'gameMessage'; text: string; kind: GameMessageKind }
  | { type: 'xpDrop'; skill: SkillId; amount: number }
  | { type: 'levelUp'; skill: SkillId; level: number }
  | { type: 'saveData'; save: SaveData }
  | { type: 'reject'; reason: string };
