import type { Point } from '../map/types';
import type { EntityId } from '../sim/entities';
import type { AttackStyle, Bonuses } from '../sim/combat';
import type { EquipSlot, Equipment, Inventory, ItemStack } from '../sim/items';
import type { QuestView } from '../sim/quests';
import type { SaveData } from '../sim/save';
import type { SkillId, SkillXp } from '../sim/skills';

/** Bumped whenever a message shape changes, so client and server can refuse a mismatch. */
export const PROTOCOL_VERSION = 5;

// ---------------------------------------------------------------------------
// Client -> server. Intents only: the simulation validates and decides outcomes.
// ---------------------------------------------------------------------------

export type ClientMessage =
  | { type: 'join'; name: string; protocolVersion: number; save?: SaveData | null }
  | { type: 'walk'; x: number; y: number }
  /**
   * Use a world object: gather from a tree, rock or fishing spot, take a
   * ground item, use a station, bank or shopkeeper (opens its window), or
   * talk to someone.
   */
  | { type: 'interact'; targetId: EntityId; action: 'gather' | 'take' | 'use' | 'talk' }
  /** In a conversation: pick an option, or (option 0 on a page without options) carry on. */
  | { type: 'dialogueChoice'; option: number }
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
  | { type: 'shopSell'; slot: number; qty: number }
  | { type: 'attack'; targetId: EntityId }
  | { type: 'eat'; slot: number }
  /** Use an item from the pack on its own: a knife or logs open the fletching window. */
  | { type: 'useItem'; slot: number }
  | { type: 'equip'; slot: number }
  | { type: 'unequip'; slot: EquipSlot }
  | { type: 'setAttackStyle'; style: AttackStyle };

// ---------------------------------------------------------------------------
// Server -> client.
// ---------------------------------------------------------------------------

/** What any client may see about an entity. Private state never goes here. */
export interface PublicEntity {
  id: EntityId;
  kind: 'player' | 'resource' | 'station' | 'scenery' | 'npc' | 'item' | 'monster';
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
  /** Players and monsters: health, for health bars. */
  hp?: number;
  maxHp?: number;
  /** Players and monsters: who they are fighting, so they face them. */
  interacting?: EntityId;
  /** Players: what they wear, so others see it. */
  gear?: Equipment;
  /** Players and monsters: fallen and playing the death animation. */
  dead?: boolean;
}

export type Activity = 'chop' | 'mine' | 'net' | 'rod' | 'cook' | 'smelt' | 'smith' | 'fletch';

/**
 * One-off animations, sent as they happen. Players: punch, stab, slash, block, eat, death.
 * Monsters: their attack (swing, bite, sting, peck, butt, wail), block and death.
 */
export type AnimationKind = string;

/** The window the player has open, with what it needs to draw. */
export type UiView =
  | { kind: 'bank'; items: ItemStack[] }
  | { kind: 'shop'; shopId: string; name: string; stock: { itemId: string; price: number }[]; buys: 'all' | string[]; sellRate: number }
  | {
      kind: 'craft';
      title: string;
      recipes: { id: string; output: string; level: number; skill: SkillId; xp: number; inputs: { itemId: string; qty: number }[] }[];
    }
  /** One page of a conversation. `npcId` is who you are talking to; `speaker` says whose words these are. */
  | { kind: 'dialogue'; npcId: EntityId; speaker: 'npc' | 'player'; name: string; text: string; options?: string[] };

/** State only the owning player sees. */
export interface SelfState {
  id: EntityId;
  name: string;
  skills: SkillXp;
  combatLevel: number;
  hp: number;
  maxHp: number;
  destination: Point | null;
  inventory: Inventory;
  equipment: Equipment;
  attackStyle: AttackStyle;
  bonuses: Bonuses;
  maxHit: number;
  ui: UiView | null;
  /** Every quest, with your progress in it. */
  quests: QuestView[];
  questPoints: number;
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
  | { type: 'hit'; attackerId: EntityId; targetId: EntityId; damage: number; hp: number; maxHp: number }
  | { type: 'animation'; entityId: EntityId; kind: AnimationKind }
  | { type: 'saveData'; save: SaveData }
  /** A quest finished: the scroll with what you got. */
  | { type: 'questComplete'; name: string; rewards: string[]; questPoints: number }
  | { type: 'reject'; reason: string };
