import type { Point } from '../map/types';
import type { EntityId } from '../sim/entities';
import type { AttackStyle, Bonuses } from '../sim/combat';
import type { ObstacleType } from '../sim/agility';
import type { PackStation } from '../sim/crafting';
import type { PatchView } from '../sim/farming';
import type { EquipSlot, Equipment, Inventory, ItemStack } from '../sim/items';
import type { PrayerId } from '../sim/prayer';
import type { QuestView } from '../sim/quests';
import type { SaveData } from '../sim/save';
import type { SkillId, SkillXp } from '../sim/skills';

/** Bumped whenever a message shape changes, so client and server can refuse a mismatch. */
export const PROTOCOL_VERSION = 9;

// ---------------------------------------------------------------------------
// Client -> server. Intents only: the simulation validates and decides outcomes.
// ---------------------------------------------------------------------------

export type ClientMessage =
  | { type: 'join'; name: string; protocolVersion: number; save?: SaveData | null }
  | { type: 'walk'; x: number; y: number }
  /**
   * Use a world object: gather from a tree, rock or fishing spot, take a
   * ground item, use a station, bank or shopkeeper (opens its window), talk
   * to someone, offer bones at an altar, cross an agility obstacle, inscribe
   * glyphs at a shrine, or tend a farming patch (rake, harvest, clear...).
   */
  | { type: 'interact'; targetId: EntityId; action: InteractAction }
  /** Use an item from the pack on something in the world: seeds on a patch, shards on a shrine. */
  | { type: 'useOn'; slot: number; targetId: EntityId }
  /** Turn running on or off. */
  | { type: 'setRun'; on: boolean }
  /** Cast a spell: a combat spell at a monster, an item spell on a pack slot, a teleport on its own. */
  | { type: 'cast'; spell: string; targetId?: EntityId; slot?: number }
  /** Pick the combat spell a staff casts by itself (null for none). */
  | { type: 'setAutocast'; spell: string | null }
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
  /** At the open build window: build this tier of furniture, fit out the spot's room, or take down what's there. */
  | { type: 'build'; tier: number }
  | { type: 'buildRoom' }
  | { type: 'removeFurniture' }
  | { type: 'bankDeposit'; slot: number; qty: number }
  | { type: 'bankDepositAll' }
  | { type: 'bankWithdraw'; index: number; qty: number }
  | { type: 'shopBuy'; itemId: string; qty: number }
  | { type: 'shopSell'; slot: number; qty: number }
  | { type: 'attack'; targetId: EntityId }
  | { type: 'eat'; slot: number }
  /** Use an item from the pack on its own: a knife or logs open the fletching window, a herb or vial the herblore one. */
  | { type: 'useItem'; slot: number; station?: PackStation }
  /** Clean every grimy herb of this kind in the pack, one after another. */
  | { type: 'clean'; slot: number }
  /** Bury bones, or scatter ashes, for Prayer XP. */
  | { type: 'bury'; slot: number }
  /** Drink a dose of a potion. */
  | { type: 'drink'; slot: number }
  | { type: 'togglePrayer'; prayer: PrayerId }
  /** Light the logs in this slot with a tinderbox. */
  | { type: 'light'; slot: number }
  | { type: 'equip'; slot: number }
  | { type: 'unequip'; slot: EquipSlot }
  | { type: 'setAttackStyle'; style: AttackStyle };

/** `build` looks at a homestead build spot; `remove` takes its furniture down; `enter` goes through the homestead gate. */
export type InteractAction = 'gather' | 'take' | 'use' | 'talk' | 'offer' | 'cross' | 'inscribe' | 'farm' | 'build' | 'remove' | 'enter';

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
  /** Players: a ward prayer that is on, shown over their head. */
  overhead?: 'ward_of_blades' | 'ward_of_spells' | 'ember_ward';
  /** Players: the tile they ran through this tick, when they moved two. */
  via?: Point;
  /** Players: crossing an agility obstacle, from one tile to another over `ms`. A fall ends on the obstacle and drops off its side. */
  crossing?: { obstacle: ObstacleType; from: Point; to: Point; ms: number; fall?: boolean };
  /** Farming patches: what is growing, as the viewer's own patch. */
  patch?: PatchView;
  /** Homestead build spots, as the viewer's own: the furniture kind, its tier (0 when empty), and whether its room is fitted out. */
  spot?: { kind: string; tier: number; room: boolean };
}

export type Activity = 'chop' | 'mine' | 'net' | 'rod' | 'cook' | 'smelt' | 'smith' | 'fletch' | 'light' | 'clean' | 'mix' | 'offer' | 'inscribe' | 'rake' | 'plant' | 'dig' | 'pick' | 'recall' | 'build';

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
      recipes: { id: string; output: string; outputQty: number; tool?: string; level: number; skill: SkillId; xp: number; inputs: { itemId: string; qty: number }[] }[];
    }
  /** One page of a conversation. `npcId` is who you are talking to; `speaker` says whose words these are. */
  | { kind: 'dialogue'; npcId: EntityId; speaker: 'npc' | 'player'; name: string; text: string; options?: string[] }
  /**
   * A homestead build spot: each tier that can go there, which one is built
   * (0 for none), and the room it is in, with what fitting it out costs when
   * that hasn't been done.
   */
  | {
      kind: 'build';
      title: string;
      built: number;
      room: { name: string; built: boolean; level: number; coins: number };
      tiers: { name: string; level: number; xp: number; materials: { itemId: string; qty: number }[] }[];
    };

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
  /** Prayer points left (rounded up) and the most there can be (the Prayer level). */
  prayer: number;
  prayerMax: number;
  /** Prayers that are on. */
  prayers: PrayerId[];
  /** Levels raised (or lowered) by potions for now, by skill. */
  boosts: Partial<Record<SkillId, number>>;
  /** Minutes of fireward potion left (rounded up), when one is working. */
  fireward?: number;
  /** Run energy, 0 to 100 (rounded down), and whether running is on. */
  energy: number;
  run: boolean;
  /** The combat spell the staff casts by itself, if one is picked. */
  autocast: string | null;
  /** Hrolf's bounty: the creature (plural, as he says it) and kills to go, and bounty points. */
  bounty: { task?: { name: string; left: number }; points: number };
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
  /** A blow, arrow or spell landing (damage 0 is a miss). `spell` says a spell was thrown, and how it looks in flight. */
  | { type: 'hit'; attackerId: EntityId; targetId: EntityId; damage: number; hp: number; maxHp: number; spell?: { element: string; tier: number } }
  | { type: 'animation'; entityId: EntityId; kind: AnimationKind }
  | { type: 'saveData'; save: SaveData }
  /** A quest finished: the scroll with what you got. */
  | { type: 'questComplete'; name: string; rewards: string[]; questPoints: number }
  | { type: 'reject'; reason: string };
