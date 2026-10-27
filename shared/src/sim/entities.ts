import type { Appearance } from './appearance';
import type { Point } from '../map/types';
import type { BountyState } from './bounty';
import type { AttackStyle } from './combat';
import type { StationKind } from './crafting';
import type { PatchKind, PatchState } from './farming';
import type { HomesteadState } from './homestead';
import type { Equipment, Inventory, ItemStack } from './items';
import type { DialoguePage } from './quests';
import type { PrayerId } from './prayer';
import type { SkillId, SkillXp } from './skills';

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
  /** Walking up to someone to talk; the conversation opens on arrival. */
  | { kind: 'talk'; targetId: EntityId }
  /** Making things at a station, one every recipe.ticks. */
  | { kind: 'craft'; stationId: EntityId; recipeId: string; remaining: number; nextAttempt: number; started?: boolean }
  /** Cleaning every grimy herb of one kind in the pack, one each `nextAttempt`. */
  | { kind: 'clean'; itemId: string; nextAttempt: number }
  /** Offering bones at an altar, one at a time, once there. */
  | { kind: 'offer'; targetId: EntityId; nextAttempt: number; started?: boolean }
  /** Lighting logs on the spot with a tinderbox; a try every tick until it catches. */
  | { kind: 'light'; itemId: string; nextAttempt: number }
  /** Crossing an agility obstacle: walk to its start, then cross until `endsAt`, landing on `landing`. */
  | { kind: 'cross'; targetId: EntityId; started?: boolean; endsAt: number; fall?: boolean; landing?: Point }
  /** Inscribing every aether shard in the pack at a shrine, once there. */
  | { kind: 'inscribe'; targetId: EntityId; nextAttempt: number; started?: boolean }
  /** Tending a farming patch: the task is picked on arrival (or by the item used on it), then done every `nextAttempt`. */
  | { kind: 'farm'; targetId: EntityId; itemId?: string; task?: FarmTask; nextAttempt: number }
  /** Fighting a monster: chase it into reach, then swing whenever the weapon is ready. `spell` is one spell to cast at it. */
  | { kind: 'attack'; targetId: EntityId; chasing?: Point; spell?: string }
  /** Teleporting: (chanting until `departAt` for Hearth Recall), vanishing, then arriving at `to` on `arriveAt`. `place` names where, for a portal. */
  | { kind: 'teleport'; spell: string; to: Point; departAt: number; arriveAt: number; departed?: boolean; place?: string; ferry?: boolean }
  /**
   * At the homestead: through the gate, look at a build spot (its window opens),
   * build a tier there (done at `doneAt`), use what's built, or take it down.
   */
  | { kind: 'home'; targetId: EntityId; task: HomeTask; tier?: number; doneAt?: number };

export type HomeTask = 'gate' | 'plan' | 'build' | 'use' | 'remove';

export type FarmTask = 'rake' | 'plant' | 'compost' | 'cure' | 'harvest' | 'clear';

/** The window a player has open. Walking away closes it. */
export type OpenUi =
  | { kind: 'bank'; at: EntityId }
  | { kind: 'shop'; shopId: string; at: EntityId }
  | { kind: 'craft'; station: StationKind; at: EntityId }
  /** A conversation: the pages to show and which one is showing. */
  | { kind: 'dialogue'; at: EntityId; pages: DialoguePage[]; index: number }
  /** What can be built at a homestead build spot. */
  | { kind: 'build'; at: EntityId };

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
  /** Stage reached in each quest; missing means not started. */
  quests: Record<string, number>;
  ui: OpenUi | null;
  /** How they look; missing for a character made before looks could be chosen. */
  look?: Appearance;
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
  /** Prayer points left; the most is the Prayer level. Fractions drain away tick by tick. */
  prayer: number;
  prayers: PrayerId[];
  /** Potion boosts by skill; each wears off a level a minute. */
  boosts: Partial<Record<SkillId, number>>;
  /** Tick the next boost level wears off. */
  nextBoostFade: number;
  /** Tick from which more bones can be buried. */
  nextBury: number;
  /** Set while a fireward potion works: the tick it runs out. */
  firewardUntil?: number;
  /** Run energy, 0 to 100, and whether they run when they can. */
  energy: number;
  run: boolean;
  /** Set on a tick they ran two tiles: the one in between. */
  via?: Point;
  /** How far round an agility course they are, for the lap bonus. */
  lap?: { course: string; next: number };
  /** Their own crops, by patch tile ("x,y"). Patches they never touched are overgrown. */
  farm: Record<string, PatchState>;
  /** The combat spell a staff casts by itself in a fight. */
  autocast?: string;
  /** Hrolf's bounty and points. */
  bounty: BountyState;
  /** Their plot, rooms and furniture. */
  homestead: HomesteadState;
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
  /** Called up by another monster: it never respawns, and fades when the fight is over. */
  summonedBy?: EntityId;
  /** How many of its `summons` thresholds it has passed this life. */
  summoned?: number;
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
  /** Fires players light: the tick it burns out, leaving ashes. */
  burnsUntil?: number;
  /** Farming patches: which kind. */
  patch?: PatchKind;
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
