import { areaAt } from '../map/JsonMapSource';
import type { MapData, Point } from '../map/types';
import {
  PROTOCOL_VERSION,
  type Activity,
  type ClientMessage,
  type AnimationKind,
  type GameMessageKind,
  type InteractAction,
  type PublicEntity,
  type SelfState,
  type ServerMessage,
  type UiView,
} from '../protocol/messages';
import { Rng } from '../rng';
import { COURSES, OBSTACLE_KINDS, RUN_DRAIN, energyRestore, failChance, obstacleAt } from './agility';
import { BOUNTY, bountyLevel, pickTask, pointsFor, taskName } from './bounty';
import {
  ATTACK_STYLES,
  EAT_DELAY,
  MONSTERS,
  REGEN_TICKS,
  WEAPON_SPEED,
  XP_PER_DAMAGE,
  equipmentBonuses,
  hitChance,
  magicDefender,
  magicFighter,
  monsterFighter,
  monsterMagicFighter,
  playerFighter,
  playerMaxHit,
  rangedFighter,
  rollQty,
  type Fighter,
} from './combat';
import { RECIPES, RECIPE_BY_ID, SELL_RATE, SHOPS, STATION_TITLES, burnChance, isBanker, packStations, shopBuys, shopForNpc, type PackStation, type StationKind } from './crafting';
import type { Entity, EntityId, FarmTask, GroundItemEntity, HomeTask, MonsterEntity, ObjectEntity, PlayerEntity } from './entities';
import { CROPS, FARMING, PATCH_KINDS, cropForSeed, growPatch, isGrown, offlineTicks, overgrown, patchView, type PatchKind, type PatchState } from './farming';
import { ATTEMPT_TICKS, EXAMINE, RESOURCE_DATA, gatherChance, requiredLevel } from './gathering';
import { FURNITURE, HOMESTEAD, PORTALS, ROOMS, SPOTS, newHomestead, spotName, spotState } from './homestead';
import { FERRY } from './ferry';
import { INSCRIBE_TICKS, SHARD, glyphForArea, glyphsPerShard } from './glyphcraft';
import { WorldGrid } from './grid';
import {
  ITEMS,
  INVENTORY_SIZE,
  addItem,
  bestArrows,
  bestTool,
  canAdd,
  countItem,
  emptyInventory,
  hasAnyTool,
  hasItem,
  isBow,
  isStaff,
  removeItem,
  roomFor,
  type EquipSlot,
  type ItemStack,
} from './items';
import { CAST_TICKS, MAGIC_RANGE, MAGIC_XP_PER_DAMAGE, RECALL_TICKS, SPELL_BY_ID, TELEPORT_TICKS, glyphCost, missingGlyphs, type SpellDef } from './magic';
import { findPath } from './pathfinding';
import { PRAYERS, drainPerTick, withPrayer, type PrayerId } from './prayer';
import { QUESTS, QUEST_DROPS, QUEST_IDS, conversation, doneStage, questView, type QuestId, type TalkActions } from './quests';
import { SAVE_VERSION, type SaveData } from './save';
import { MAX_XP, SKILLS, combatLevel, levelForXp, requirementLevel, startingXp, type SkillId } from './skills';

export const TICK_MS = 600;
/**
 * How far around a player entities are sent. The world is far larger than the
 * screen, so only what is near the player goes over the wire.
 */
export const VIEW_RADIUS = 48;
/** Dropped items stay on the ground for two minutes. */
export const GROUND_ITEM_TICKS = 200;
/** For the first minute only the player who dropped (or earned) an item can see it. */
export const PRIVATE_TICKS = 100;
/** What you drop when you die waits ten minutes for you, seen by no one else. */
export const DEATH_PILE_TICKS = 1000;
/** You keep this many of your most valuable items when you die. */
export const KEEP_ON_DEATH = 3;
/** Ticks the death animation plays before a player wakes at the spawn point. */
const PLAYER_DEATH_TICKS = 4;
/** Ticks a monster's death animation plays before its loot drops. */
const MONSTER_DEATH_TICKS = 2;
/** Fighting stops when the two are further apart than this. */
const MAX_CHASE = 16;
/** Monsters give up a chase this many tiles beyond the edge of where they roam. */
const LEASH = 8;
/** Chance a fired arrow lands where it can be picked up again. */
const ARROW_SAVE_CHANCE = 0.7;
/** What a new character carries. */
const STARTING_ITEMS: ItemStack[] = [
  { itemId: 'bronze_axe', qty: 1 },
  { itemId: 'small_net', qty: 1 },
  { itemId: 'coins', qty: 25 },
];
const STATIONS: readonly string[] = ['furnace', 'anvil', 'range', 'campfire', 'fire', 'altar'];
/** Fires cook like a range. */
const COOKING_FIRES: readonly string[] = ['campfire', 'fire'];
/** Ticks between buried bones, and between bones offered at an altar. */
const BURY_TICKS = 2;
const OFFER_TICKS = 3;
/** Bones offered at an altar give this many times the XP of burying them. */
export const ALTAR_MULTIPLIER = 2;
/** Potion boosts wear off a level this often (ticks). */
const BOOST_FADE_TICKS = 100;
/** Herblore is taught by Old Nessa: none of it until her cauldron is bubbling. */
const HERBLORE_QUEST: QuestId = 'nessas_cauldron';
/** Intents ignored while crossing an obstacle. */
const CROSSING_LOCKS: readonly ClientMessage['type'][] = ['walk', 'interact', 'useOn', 'attack', 'useItem', 'clean', 'light', 'eat', 'drink', 'bury', 'equip', 'unequip'];
/** Intents ignored while teleporting (and casting another spell is no use either). */
const TELEPORT_LOCKS: readonly ClientMessage['type'][] = [...CROSSING_LOCKS, 'cast'];
/** Joined patch tiles that make allotments rather than herb patches. */
const ALLOTMENT_SIZE = 6;
/** Ticks before the first go at each farming task. */
const FARM_TASK_TICKS: Record<FarmTask, number> = {
  rake: FARMING.rakeTicks,
  plant: FARMING.plantTicks,
  compost: 2,
  cure: 2,
  harvest: FARMING.harvestTicks,
  clear: FARMING.clearTicks,
};
/** How long a lit fire burns (ticks), at least and at most. */
export const FIRE_TICKS = [60, 110] as const;

/** Wording for each kind of gathering. */
const GATHER_TEXT = {
  chop: { start: 'You swing your axe at the tree.', got: (item: string) => `You get some ${item}.`, tool: 'an axe to chop down this tree', what: 'chop this tree' },
  mine: { start: 'You swing your pickaxe at the rock.', got: (item: string) => `You manage to mine some ${item}.`, tool: 'a pickaxe to mine this rock', what: 'mine this rock' },
  net: { start: 'You cast out your net.', got: (item: string) => `You catch some ${item}.`, tool: 'a small fishing net to fish here', what: 'fish here' },
  rod: { start: 'You cast out your line.', got: (item: string) => `You catch a ${item}.`, tool: 'a fishing rod to fish here', what: 'fish here' },
} as const;

/** How a spell looks on its way, sent with the hit it lands. */
type HitSpell = { element: string; tier: number };

export interface SimulationOptions {
  map: MapData;
  seed: number;
}

/** Per-connected-player bookkeeping for outgoing messages and state diffs. */
interface Session {
  outbox: ServerMessage[];
  lastSent: Map<EntityId, string>;
  lastSelf: string;
}

/**
 * The authoritative game world. Pure logic: no DOM, no rendering, no timers,
 * no Math.random. A host (LocalServer in the browser, a Node server later)
 * calls step() every TICK_MS, feeds it intents, and drains messages.
 */
export class Simulation {
  readonly map: MapData;
  readonly grid: WorldGrid;
  readonly rng: Rng;
  tick = 0;

  private readonly entities = new Map<EntityId, Entity>();
  /** Tiles taken by players and living monsters, rebuilt each tick; monsters don't share tiles. */
  private occupied = new Set<number>();
  private readonly sessions = new Map<EntityId, Session>();
  private intents: { playerId: EntityId; msg: ClientMessage }[] = [];
  private nextId = 1;

  constructor({ map, seed }: SimulationOptions) {
    this.map = map;
    this.grid = new WorldGrid(map);
    this.rng = new Rng(seed);
    this.spawnStaticObjects();
    this.nameObjects();
  }

  // -------------------------------------------------------------------------
  // Host API
  // -------------------------------------------------------------------------

  /**
   * Adds a player, from a save when there is one. `save` must already have
   * been through parseSave; a saved position that is no longer walkable (the
   * map changed) falls back to the spawn point.
   */
  addPlayer(name: string, save: SaveData | null = null, now = ''): EntityId {
    const inventory = save ? save.inventory.map((s) => (s ? { ...s } : null)) : emptyInventory();
    if (!save) for (const { itemId, qty } of STARTING_ITEMS) addItem(inventory, itemId, qty);
    const start = save && this.grid.isWalkable(save.position.x, save.position.y) ? save.position : this.map.spawn;
    const skills = save ? { ...save.skills } : startingXp();
    const maxHp = levelForXp(skills.hitpoints);
    const player: PlayerEntity = {
      id: this.allocateId(),
      kind: 'player',
      name: (save?.name ?? name).trim().slice(0, 12) || 'Adventurer',
      x: start.x,
      y: start.y,
      skills,
      hp: Math.min(maxHp, save?.hp ?? maxHp),
      inventory,
      equipment: save ? { ...save.equipment } : {},
      attackStyle: save?.attackStyle ?? 'accurate',
      bank: save ? save.bank.map((s) => ({ ...s })) : [],
      quests: save ? { ...save.quests } : {},
      ui: null,
      createdAt: save?.createdAt ?? now,
      path: [],
      destination: null,
      gateNotice: null,
      action: null,
      pickup: null,
      nextAttack: 0,
      nextEat: 0,
      nextRegen: this.tick + REGEN_TICKS,
      attackedBy: null,
      prayer: Math.min(levelForXp(skills.prayer), save?.prayer ?? levelForXp(skills.prayer)),
      prayers: [],
      boosts: {},
      nextBoostFade: 0,
      nextBury: 0,
      energy: save?.energy ?? 100,
      run: save?.run ?? false,
      farm: Object.fromEntries(Object.entries(save?.farm ?? {}).map(([k, v]) => [k, { ...v }])),
      ...(save?.autocast && { autocast: save.autocast }),
      bounty: save?.bounty ? { ...save.bounty, ...(save.bounty.task && { task: { ...save.bounty.task } }) } : { points: 0, done: 0 },
      homestead: save?.homestead ? { owned: save.homestead.owned, rooms: [...save.homestead.rooms], built: { ...save.homestead.built } } : newHomestead(),
    };
    // Crops kept growing while the player was away.
    const away = save ? offlineTicks(save.updatedAt, now) : 0;
    if (away) for (const patch of Object.values(player.farm)) growPatch(patch, away, this.rng);
    this.entities.set(player.id, player);
    const session: Session = { outbox: [], lastSent: new Map(), lastSelf: '' };
    this.sessions.set(player.id, session);

    session.outbox.push({
      type: 'welcome',
      playerId: player.id,
      protocolVersion: PROTOCOL_VERSION,
      mapId: this.map.id,
      tick: this.tick,
      tickMs: TICK_MS,
    });
    const visible = this.visibleTo(player);
    for (const e of visible) session.lastSent.set(e.id, JSON.stringify(e));
    session.outbox.push({ type: 'snapshot', tick: this.tick, entities: visible });
    this.syncSelf(player, session);
    this.message(
      player.id,
      save
        ? `Welcome back, ${player.name}.`
        : 'Welcome to Kelmoor, in the Vell Reaches. Click the ground to walk, right-click for options. Elder Maren, by the fountain, has a task for newcomers.',
    );
    return player.id;
  }

  /** The player's current state as a save record. `now` is an ISO time from the host. */
  saveFor(playerId: EntityId, now: string): SaveData | null {
    const p = this.entities.get(playerId);
    if (!p || p.kind !== 'player') return null;
    return {
      version: SAVE_VERSION,
      name: p.name,
      position: { x: p.x, y: p.y },
      skills: { ...p.skills },
      inventory: p.inventory.map((s) => (s ? { ...s } : null)),
      equipment: { ...p.equipment },
      hp: p.hp,
      attackStyle: p.attackStyle,
      prayer: Math.ceil(p.prayer),
      energy: Math.floor(p.energy),
      ...(p.run && { run: true }),
      ...(Object.keys(p.farm).length && { farm: Object.fromEntries(Object.entries(p.farm).map(([k, v]) => [k, { ...v }])) }),
      ...(p.autocast && { autocast: p.autocast }),
      ...((p.bounty.points || p.bounty.done || p.bounty.task) && { bounty: { ...p.bounty, ...(p.bounty.task && { task: { ...p.bounty.task } }) } }),
      ...(p.homestead.owned && { homestead: { owned: true, rooms: [...p.homestead.rooms], built: { ...p.homestead.built } } }),
      bank: p.bank.map((s) => ({ ...s })),
      quests: { ...p.quests },
      createdAt: p.createdAt || now,
      updatedAt: now,
    };
  }

  removePlayer(id: EntityId): void {
    for (const e of this.entities.values()) if (e.kind === 'monster' && e.target === id) e.target = null;
    this.entities.delete(id);
    this.sessions.delete(id);
  }

  queueIntent(playerId: EntityId, msg: ClientMessage): void {
    this.intents.push({ playerId, msg });
  }

  /** Advance the world by one tick. */
  step(): void {
    this.tick++;
    const intents = this.intents;
    this.intents = [];
    for (const { playerId, msg } of intents) this.handleIntent(playerId, msg);

    for (const e of this.entities.values()) {
      if (e.kind === 'player' && e.deadUntil === undefined) this.movePlayer(e);
    }
    this.occupied = this.occupancy();
    for (const e of this.entities.values()) {
      if (e.kind === 'monster') this.monsterStep(e);
    }
    for (const e of this.entities.values()) {
      if (e.kind === 'player' && e.action?.kind === 'attack') this.fightStep(e);
    }
    for (const e of this.entities.values()) {
      if (e.kind !== 'player' || e.path.length) continue;
      if (e.pickup !== null) this.pickUp(e);
      if (e.action?.kind === 'gather') this.gather(e);
      else if (e.action?.kind === 'use') this.arriveToUse(e);
      else if (e.action?.kind === 'talk') this.arriveToTalk(e);
      else if (e.action?.kind === 'craft') this.craftStep(e);
      else if (e.action?.kind === 'light') this.lightStep(e);
      else if (e.action?.kind === 'clean') this.cleanStep(e);
      else if (e.action?.kind === 'offer') this.offerStep(e);
      else if (e.action?.kind === 'cross') this.crossStep(e);
      else if (e.action?.kind === 'inscribe') this.inscribeStep(e);
      else if (e.action?.kind === 'farm') this.farmStep(e);
      else if (e.action?.kind === 'teleport') this.teleportStep(e);
      else if (e.action?.kind === 'home') this.homeStep(e);
    }
    for (const e of [...this.entities.values()]) {
      if (e.kind === 'player') {
        this.recover(e);
        for (const patch of Object.values(e.farm)) growPatch(patch, 1, this.rng);
      }
      if (e.kind === 'resource' && e.depletedUntil !== undefined && this.tick >= e.depletedUntil) delete e.depletedUntil;
      if (e.kind === 'item' && this.tick >= e.despawnAt) this.entities.delete(e.id);
      if (e.kind === 'station' && e.burnsUntil !== undefined && this.tick >= e.burnsUntil) this.burnOut(e);
    }

    this.flushDeltas();
  }

  /** Take all pending messages for a player. */
  drain(playerId: EntityId): ServerMessage[] {
    const session = this.sessions.get(playerId);
    if (!session) return [];
    const out = session.outbox;
    session.outbox = [];
    return out;
  }

  getEntity(id: EntityId): Entity | undefined {
    return this.entities.get(id);
  }

  // -------------------------------------------------------------------------
  // Intents
  // -------------------------------------------------------------------------

  private handleIntent(playerId: EntityId, msg: ClientMessage): void {
    const player = this.entities.get(playerId);
    if (!player || player.kind !== 'player') return;
    if (player.deadUntil !== undefined) return;
    // Halfway over an obstacle there's no turning back.
    if (player.action?.kind === 'cross' && player.action.started && CROSSING_LOCKS.includes(msg.type)) return;
    // Once the words of a teleport are spoken it can't be stopped (a Hearth Recall chant can, until it ends).
    if (player.action?.kind === 'teleport' && player.action.departed && TELEPORT_LOCKS.includes(msg.type)) return;
    switch (msg.type) {
      case 'walk':
        if (!Number.isInteger(msg.x) || !Number.isInteger(msg.y) || !this.grid.inBounds(msg.x, msg.y)) {
          this.reject(playerId, 'Invalid walk target.');
          return;
        }
        this.stopActions(player);
        this.walkTo(player, { x: msg.x, y: msg.y });
        return;
      case 'interact':
        this.interact(player, msg.targetId, msg.action);
        return;
      case 'useOn':
        this.useOn(player, msg.slot, msg.targetId);
        return;
      case 'setRun':
        if (msg.on && player.energy < RUN_DRAIN) return this.message(player.id, "You're too tired to run.", 'warn');
        player.run = !!msg.on;
        return;
      case 'cast':
        return this.cast(player, msg.spell, msg.targetId, msg.slot);
      case 'setAutocast':
        return this.setAutocast(player, msg.spell);
      case 'examine':
        this.examine(player, msg.targetId);
        return;
      case 'examineItem': {
        const stack = this.slot(player, msg.slot);
        if (stack) this.message(player.id, ITEMS[stack.itemId].examine, 'examine');
        return;
      }
      case 'invDrop': {
        const stack = this.slot(player, msg.slot);
        if (!stack) return;
        player.inventory[msg.slot] = null;
        this.dropItem(player, stack.itemId, stack.qty);
        return;
      }
      case 'invMove': {
        if (!this.validSlot(msg.from) || !this.validSlot(msg.to)) return;
        const inv = player.inventory;
        [inv[msg.from], inv[msg.to]] = [inv[msg.to], inv[msg.from]];
        return;
      }
      case 'closeInterface':
        player.ui = null;
        return;
      case 'dialogueChoice':
        this.dialogueChoice(player, msg.option);
        return;
      case 'craft':
        this.startCraft(player, msg.recipeId, msg.qty);
        return;
      case 'build':
        this.startBuild(player, msg.tier);
        return;
      case 'buildRoom':
        this.buildRoom(player);
        return;
      case 'removeFurniture': {
        const spot = player.ui?.kind === 'build' ? this.entities.get(player.ui.at) : undefined;
        if (spot?.kind === 'scenery' && this.adjacent(player, spot)) this.removeFurniture(player, spot);
        return;
      }
      case 'bankDeposit':
        this.bankDeposit(player, msg.slot, msg.qty);
        return;
      case 'bankDepositAll':
        if (player.ui?.kind !== 'bank') return;
        for (let i = 0; i < INVENTORY_SIZE; i++) if (player.inventory[i]) this.bankDeposit(player, i, Number.MAX_SAFE_INTEGER);
        return;
      case 'bankWithdraw':
        this.bankWithdraw(player, msg.index, msg.qty);
        return;
      case 'shopBuy':
        this.shopBuy(player, msg.itemId, msg.qty);
        return;
      case 'shopSell':
        this.shopSell(player, msg.slot, msg.qty);
        return;
      case 'attack':
        this.startAttack(player, msg.targetId);
        return;
      case 'useItem':
        this.useItem(player, msg.slot, msg.station);
        return;
      case 'clean':
        this.startClean(player, msg.slot);
        return;
      case 'bury':
        this.bury(player, msg.slot);
        return;
      case 'drink':
        this.drink(player, msg.slot);
        return;
      case 'togglePrayer':
        this.togglePrayer(player, msg.prayer);
        return;
      case 'light':
        this.startLight(player, msg.slot);
        return;
      case 'eat':
        this.eat(player, msg.slot);
        return;
      case 'equip':
        this.equip(player, msg.slot);
        return;
      case 'unequip':
        this.unequip(player, msg.slot);
        return;
      case 'setAttackStyle':
        if (msg.style in ATTACK_STYLES) player.attackStyle = msg.style;
        return;
      case 'join':
      case 'requestSave':
        // Handled by the host, not as in-world intents.
        return;
      default:
        this.reject(playerId, 'Unknown intent.');
    }
  }

  private stopActions(player: PlayerEntity): void {
    player.action = null;
    player.pickup = null;
    player.ui = null;
  }

  private interact(player: PlayerEntity, targetId: EntityId, action: InteractAction): void {
    const target = this.entities.get(targetId);
    this.stopActions(player);
    if (action === 'take' && target?.kind === 'item') {
      player.pickup = target.id;
      this.walkTo(player, target);
      return;
    }
    if (action === 'gather' && target?.kind === 'resource' && RESOURCE_DATA[target.defKey]) {
      player.action = { kind: 'gather', targetId: target.id, nextAttempt: 0, started: false };
      this.walkTo(player, target);
      return;
    }
    if (action === 'talk' && target?.kind === 'npc') {
      player.action = { kind: 'talk', targetId: target.id };
      this.walkTo(player, target);
      return;
    }
    if (action === 'offer' && target && (target.kind === 'station' || target.kind === 'scenery') && this.altarMultiplier(player, target)) {
      player.action = { kind: 'offer', targetId: target.id, nextAttempt: 0 };
      this.walkTo(player, target);
      return;
    }
    if (action === 'cross' && target?.kind === 'scenery' && target.defKey === 'agility_obstacle') {
      const obstacle = obstacleAt(target.x, target.y);
      if (!obstacle) return;
      player.action = { kind: 'cross', targetId: target.id, endsAt: 0 };
      this.walkTo(player, obstacle.from, [obstacle.from]);
      return;
    }
    if (action === 'inscribe' && target?.kind === 'scenery' && target.defKey === 'glyph_shrine') {
      player.action = { kind: 'inscribe', targetId: target.id, nextAttempt: 0 };
      this.walkTo(player, target);
      return;
    }
    if (action === 'farm' && target?.kind === 'scenery' && target.patch) {
      player.action = { kind: 'farm', targetId: target.id, nextAttempt: 0 };
      this.walkTo(player, target);
      return;
    }
    const home = target?.kind === 'scenery' ? this.homeTask(player, target, action) : null;
    if (home && target) {
      player.action = { kind: 'home', targetId: target.id, task: home };
      this.walkTo(player, target);
      return;
    }
    if (action === 'use' && target && (target.kind === 'station' || target.kind === 'npc') && this.usable(target)) {
      player.action = { kind: 'use', targetId: target.id };
      this.walkTo(player, target);
      return;
    }
    this.reject(player.id, 'Nothing interesting happens.');
  }

  private examine(player: PlayerEntity, targetId: EntityId): void {
    const target = this.entities.get(targetId);
    if (!target) return;
    let text: string;
    if (target.kind === 'player') text = target.id === player.id ? "It's you. Looking sharp." : `A fellow adventurer, ${target.name}.`;
    else if (target.kind === 'item') text = ITEMS[target.itemId].examine;
    else if (target.kind === 'monster') text = MONSTERS[target.defKey]?.examine ?? `It's a ${target.name.toLowerCase()}.`;
    else if (target.defKey === 'build_spot') {
      const spot = spotState(player.homestead, `${target.x},${target.y}`);
      text = spot?.tier ? `Your own handiwork: ${aOrSome(spotName(spot.def.kind, spot.tier).toLowerCase())}.` : 'An empty space, waiting for furniture.';
    }
    else {
      const obstacle = target.defKey === 'agility_obstacle' ? obstacleAt(target.x, target.y) : undefined;
      const key = obstacle ? `obstacle_${obstacle.type}` : target.depletedUntil !== undefined ? `${target.defKey}_stump` : target.defKey;
      // People without their own line are described by what they do.
      const role = target.kind === 'npc' ? this.map.defs.npcs[target.defKey]?.role : undefined;
      text = EXAMINE[key] ?? EXAMINE[target.defKey] ?? (role ? `${target.name}, ${aOrSome(role.toLowerCase())} of the Reaches.` : `It's ${aOrSome(target.name.toLowerCase())}.`);
    }
    this.message(player.id, text, 'examine');
  }

  private validSlot(slot: number): boolean {
    return Number.isInteger(slot) && slot >= 0 && slot < INVENTORY_SIZE;
  }

  private slot(player: PlayerEntity, slot: number) {
    return this.validSlot(slot) ? player.inventory[slot] : null;
  }

  private dropItem(player: PlayerEntity, itemId: string, qty: number): void {
    const item: GroundItemEntity = {
      id: this.allocateId(),
      kind: 'item',
      itemId,
      qty,
      name: ITEMS[itemId].name,
      x: player.x,
      y: player.y,
      despawnAt: this.tick + GROUND_ITEM_TICKS,
      owner: player.id,
      publicAt: this.tick + PRIVATE_TICKS,
    };
    this.entities.set(item.id, item);
  }

  private spawnItem(itemId: string, qty: number, at: Point, owner: EntityId | undefined, publicTicks: number, lifeTicks: number): void {
    const id = this.allocateId();
    this.entities.set(id, {
      id,
      kind: 'item',
      itemId,
      qty,
      name: ITEMS[itemId].name,
      x: at.x,
      y: at.y,
      despawnAt: this.tick + lifeTicks,
      ...(owner !== undefined && { owner, publicAt: this.tick + publicTicks }),
    });
  }

  /** Someone else's drop stays hidden from you until it turns public. */
  private canSeeItem(item: GroundItemEntity, viewer: EntityId): boolean {
    return item.owner === undefined || item.owner === viewer || this.tick >= (item.publicAt ?? 0);
  }

  private walkTo(player: PlayerEntity, target: Point & { size?: number }, goals = this.goalsFor(target)): void {
    const canStep = this.gateRule(player);
    let result = findPath(this.grid, player, goals, target, { canStep });
    player.gateNotice = null;

    if (!result.reachedGoal) {
      // Would the target be reachable with gates open? Then walk up to the
      // locked gate and explain on arrival why it would not open.
      const ignoringGates = findPath(this.grid, player, goals, target);
      if (ignoringGates.reachedGoal) {
        const blockedAt = ignoringGates.path.findIndex((step, i) => {
          const from = i === 0 ? player : ignoringGates.path[i - 1];
          return !canStep(from.x, from.y, step.x, step.y);
        });
        if (blockedAt >= 0) {
          result = { path: ignoringGates.path.slice(0, blockedAt), reachedGoal: false };
          player.gateNotice = ignoringGates.path[blockedAt];
        }
      }
    }

    player.path = result.path;
    player.destination = result.path.length ? result.path[result.path.length - 1] : null;
    if (!player.path.length && player.gateNotice) this.reportGate(player);
  }

  /**
   * Walkable targets are their own goal; blocked ones are reached from a
   * neighbour, preferring the sides over the corners. A big tree's neighbours
   * are the tiles around its whole footprint.
   */
  private goalsFor(target: Point & { size?: number }): Point[] {
    const size = target.size ?? 1;
    if (size === 1 && this.grid.isWalkable(target.x, target.y)) return [target];
    const sides: Point[] = [];
    const corners: Point[] = [];
    for (let y = target.y - 1; y <= target.y + size; y++) {
      for (let x = target.x - 1; x <= target.x + size; x++) {
        const outsideX = x < target.x || x >= target.x + size;
        const outsideY = y < target.y || y >= target.y + size;
        if (!outsideX && !outsideY) continue;
        if (!this.grid.isWalkable(x, y)) continue;
        (outsideX && outsideY ? corners : sides).push({ x, y });
      }
    }
    return sides.length ? sides : corners;
  }

  /** Gates check their requirement only when entered from outside their area. */
  private gateRule(player: PlayerEntity) {
    const grid = this.grid;
    return (fx: number, fy: number, tx: number, ty: number): boolean => {
      if (!grid.isGate(tx, ty)) return true;
      const gi = grid.index(tx, ty);
      if (grid.gateZone[grid.index(fx, fy)] === gi) return true;
      const req = this.map.terrainDefs[grid.gateAt[gi]].requires!;
      return requirementLevel(player.skills, req.skill) >= req.level;
    };
  }

  private reportGate(player: PlayerEntity): void {
    const gate = player.gateNotice!;
    player.gateNotice = null;
    const def = this.map.terrainDefs[this.grid.gateAt[this.grid.index(gate.x, gate.y)]];
    const req = def.requires!;
    const label = req.skill === 'combat' ? 'combat level' : `${SKILLS.find((s) => s.id === req.skill)?.name ?? req.skill} level`;
    const current = requirementLevel(player.skills, req.skill);
    this.message(
      player.id,
      `The ${def.name} won't open. You need a ${label} of ${req.level} to pass (yours is ${current}).`,
      'warn',
    );
  }

  // -------------------------------------------------------------------------
  // Systems
  // -------------------------------------------------------------------------

  /** A step a tick walking; two running, while the energy lasts. */
  private movePlayer(player: PlayerEntity): void {
    delete player.via;
    if (!this.stepPlayer(player)) return;
    if (!player.run || !player.path.length) return;
    const via = { x: player.x, y: player.y };
    if (!this.stepPlayer(player)) return;
    player.via = via;
    player.energy = Math.max(0, player.energy - RUN_DRAIN);
    if (player.energy < RUN_DRAIN) {
      player.run = false;
      this.message(player.id, "You're out of run energy.", 'warn');
    }
  }

  /** Takes the next step on the player's path; false when there is none or it's blocked. */
  private stepPlayer(player: PlayerEntity): boolean {
    const next = player.path.shift();
    if (!next) return false;
    const canStep = this.gateRule(player);
    const dx = next.x - player.x;
    const dy = next.y - player.y;
    const valid =
      Math.abs(dx) <= 1 &&
      Math.abs(dy) <= 1 &&
      this.grid.isWalkable(next.x, next.y) &&
      canStep(player.x, player.y, next.x, next.y);
    if (!valid) {
      player.path = [];
      player.destination = null;
      return false;
    }
    player.x = next.x;
    player.y = next.y;
    if (!player.path.length) {
      player.destination = null;
      if (player.gateNotice) this.reportGate(player);
    }
    return true;
  }

  private pickUp(player: PlayerEntity): void {
    const item = this.entities.get(player.pickup!);
    player.pickup = null;
    if (!item || item.kind !== 'item' || item.x !== player.x || item.y !== player.y || !this.canSeeItem(item, player.id)) return;
    if (!addItem(player.inventory, item.itemId, item.qty)) {
      this.message(player.id, "You don't have enough inventory space to hold that item.", 'warn');
      return;
    }
    this.entities.delete(item.id);
  }

  /** Woodcutting, mining and fishing: one attempt every ATTEMPT_TICKS while next to the node. */
  private gather(player: PlayerEntity): void {
    const action = player.action;
    if (action?.kind !== 'gather') return;
    const node = this.entities.get(action.targetId);
    const data = node?.kind === 'resource' ? RESOURCE_DATA[node.defKey] : undefined;
    if (!node || node.kind !== 'resource' || !data) return this.stopGathering(player);
    if (!this.adjacent(player, node)) return this.stopGathering(player);
    if (node.depletedUntil !== undefined) return this.stopGathering(player);

    const text = GATHER_TEXT[data.verb];
    const skillName = this.skillName(data.skill);
    const level = levelForXp(player.skills[data.skill]);
    const required = requiredLevel(data);
    const best = data.yields.find((y) => y.level <= level);
    const lowestItem = ITEMS[data.yields[data.yields.length - 1].item].name.toLowerCase();
    const itemWord = data.skill === 'fishing' ? 'fish' : lowestItem;
    if (!best) {
      this.message(player.id, `You need a ${skillName} level of ${required} to ${text.what}.`, 'warn');
      return this.stopGathering(player);
    }
    let bonus = 0;
    if (data.toolItem) {
      if (!hasItem(player.inventory, data.toolItem)) {
        this.message(player.id, `You need ${text.tool}.`, 'warn');
        return this.stopGathering(player);
      }
    } else {
      // A wielded axe or pickaxe counts as much as one in the pack.
      const carried = [...player.inventory, player.equipment.weapon ? { itemId: player.equipment.weapon, qty: 1 } : null];
      const tool = bestTool(carried, data.skill, level);
      if (!tool) {
        const why = hasAnyTool(carried, data.skill) ? `You need a higher ${skillName} level to use the tool you have.` : `You need ${text.tool}.`;
        this.message(player.id, why, 'warn');
        return this.stopGathering(player);
      }
      bonus = tool.tool!.bonus;
    }
    if (data.bait && !hasItem(player.inventory, data.bait)) {
      this.message(player.id, `You don't have any ${ITEMS[data.bait].name.toLowerCase()} left.`, 'warn');
      return this.stopGathering(player);
    }
    if (!canAdd(player.inventory, best.item)) {
      this.message(player.id, `Your inventory is too full to hold any more ${itemWord}.`, 'warn');
      return this.stopGathering(player);
    }

    if (!action.started) {
      action.started = true;
      action.nextAttempt = this.tick + ATTEMPT_TICKS;
      this.message(player.id, text.start);
      return;
    }
    if (this.tick < action.nextAttempt) return;
    action.nextAttempt = this.tick + ATTEMPT_TICKS;
    if (!this.rng.chance(gatherChance(level, required, bonus))) return;

    // Several yields: take the best one you can, stepping down a tier half the time.
    const eligible = data.yields.filter((y) => y.level <= level);
    let got = eligible[0];
    for (let i = 1; i < eligible.length && this.rng.chance(0.5); i++) got = eligible[i];
    if (data.bait) removeItem(player.inventory, data.bait, 1);
    addItem(player.inventory, got.item);
    this.message(player.id, text.got(ITEMS[got.item].name.toLowerCase().replace(/^raw /, '')));
    this.addXp(player, data.skill, got.xp);
    if (data.depleteChance > 0 && this.rng.chance(data.depleteChance)) {
      node.depletedUntil = this.tick + data.respawnTicks;
      for (const e of this.entities.values()) {
        if (e.kind === 'player' && e.action?.kind === 'gather' && e.action.targetId === node.id) this.stopGathering(e);
      }
    } else if (!canAdd(player.inventory, got.item)) {
      this.message(player.id, `Your inventory is too full to hold any more ${itemWord}.`, 'warn');
      this.stopGathering(player);
    }
  }

  private stopGathering(player: PlayerEntity): void {
    player.action = null;
  }

  private adjacent(player: PlayerEntity, target: { x: number; y: number; size?: number }): boolean {
    const near = nearestTile(target, player);
    return Math.max(Math.abs(near.x - player.x), Math.abs(near.y - player.y)) <= 1;
  }

  /** How many a recipe makes this time: its full batch, or fewer when every input is one-for-one and runs short. */
  private batchSize(player: PlayerEntity, recipe: (typeof RECIPES)[number]): number {
    const full = recipe.outputQty ?? 1;
    if (full === 1 || !recipe.inputs.every((i) => i.qty === full)) return full;
    return Math.min(full, ...recipe.inputs.map((i) => countItem(player.inventory, i.itemId)));
  }

  private skillName(skill: SkillId): string {
    return SKILLS.find((s) => s.id === skill)!.name;
  }

  // -------------------------------------------------------------------------
  // Combat
  // -------------------------------------------------------------------------

  private startAttack(player: PlayerEntity, targetId: EntityId): void {
    const target = this.entities.get(targetId);
    this.stopActions(player);
    if (target?.kind !== 'monster' || !alive(target)) {
      this.reject(player.id, "You can't attack that.");
      return;
    }
    if (this.bountyLocked(player, target)) return;
    player.action = { kind: 'attack', targetId };
  }

  /** A player fighting: close in on the target, then attack whenever the weapon is ready. */
  private fightStep(player: PlayerEntity): void {
    const action = player.action;
    if (action?.kind !== 'attack') return;
    const target = this.entities.get(action.targetId);
    if (target?.kind !== 'monster' || !alive(target) || distance(player, target) > MAX_CHASE) {
      player.action = null;
      return;
    }
    if (this.canHit(player, target)) {
      player.path = [];
      player.destination = null;
      if (this.bountyLocked(player, target)) return void (player.action = null);
      if (this.tick >= player.nextAttack) this.playerAttack(player, target);
      return;
    }
    // Chase: plan a new route whenever the target has moved.
    if (player.path.length && action.chasing?.x === target.x && action.chasing.y === target.y) return;
    action.chasing = { x: target.x, y: target.y };
    this.walkTo(player, target, this.meleeGoals(target));
    if (!player.path.length) {
      this.message(player.id, "I can't reach that.", 'warn');
      player.action = null;
    }
  }

  /** Whether a player can hit a monster from where they stand: beside it, or within a bow's range with a clear shot. */
  private canHit(player: PlayerEntity, target: MonsterEntity): boolean {
    const weapon = player.equipment.weapon;
    if (this.spellFor(player)) {
      const d = distance(player, target);
      return d > 0 && d <= MAGIC_RANGE && this.clearShot(player, target);
    }
    if (!isBow(weapon)) return inReach(player, target);
    const range = ITEMS[weapon!].equip!.range! + (player.attackStyle === 'defensive' ? 2 : 0);
    const d = distance(player, target);
    return d > 0 && d <= range && this.clearShot(player, target);
  }

  /** Nothing solid (walls, trees, rocks) on the tiles between; water doesn't count. */
  private clearShot(from: Point, to: Point): boolean {
    const steps = distance(from, to);
    for (let i = 1; i < steps; i++) {
      const x = Math.round(from.x + ((to.x - from.x) * i) / steps);
      const y = Math.round(from.y + ((to.y - from.y) * i) / steps);
      if (this.grid.blocked[this.grid.index(x, y)] && !this.isWater(x, y)) return false;
    }
    return true;
  }

  /** Arrows fly over water; they don't fly through walls or trees. */
  private isWater(x: number, y: number): boolean {
    const def = this.map.terrainDefs[this.map.terrain[this.grid.index(x, y)]];
    return !!def && /water/i.test(def.key);
  }

  private playerAttack(player: PlayerEntity, monster: MonsterEntity): void {
    const spell = this.spellFor(player);
    if (spell) return this.playerCast(player, monster, spell);
    if (isBow(player.equipment.weapon)) return this.playerShoot(player, monster);
    const stats = MONSTERS[monster.defKey];
    const attacker = this.helmed(player, monster, playerFighter(player.skills, player.equipment, player.attackStyle, player));
    const landed = this.rng.chance(hitChance(attacker, monsterFighter(stats)));
    const damage = landed ? Math.min(monster.hp, this.rng.int(1, playerMaxHit(attacker))) : 0;
    const weapon = player.equipment.weapon ? ITEMS[player.equipment.weapon]?.equip : undefined;
    player.nextAttack = this.tick + (weapon?.speed ?? WEAPON_SPEED);
    this.animate(player, weapon?.style ?? 'punch');
    this.landPlayerHit(player, monster, damage, [[ATTACK_STYLES[player.attackStyle].skill, 1]]);
  }

  /** A bow: fire the best arrow carried. Most can be picked up again where they fell. */
  private playerShoot(player: PlayerEntity, monster: MonsterEntity): void {
    const bow = ITEMS[player.equipment.weapon!].equip!;
    const arrow = bestArrows(player.inventory, levelForXp(player.skills.ranged));
    if (!arrow) {
      const any = player.inventory.some((s) => s && ITEMS[s.itemId]?.ammo);
      this.message(player.id, any ? 'You need a higher Ranged level to fire the arrows you carry.' : 'You have no arrows left to fire.', 'warn');
      player.action = null;
      return;
    }
    removeItem(player.inventory, arrow.id, 1);
    const attacker = this.helmed(player, monster, rangedFighter(player.skills, player.equipment, player.attackStyle, arrow.ammo!.strength, player));
    const landed = this.rng.chance(hitChance(attacker, monsterFighter(MONSTERS[monster.defKey])));
    const damage = landed ? Math.min(monster.hp, this.rng.int(1, playerMaxHit(attacker))) : 0;
    player.nextAttack = this.tick + (bow.speed ?? WEAPON_SPEED) - (player.attackStyle === 'aggressive' ? 1 : 0);
    this.animate(player, 'shoot');
    if (this.rng.chance(ARROW_SAVE_CHANCE)) this.dropArrow(arrow.id, monster, player.id);
    this.landPlayerHit(player, monster, damage, player.attackStyle === 'defensive' ? [['ranged', 0.5], ['defence', 0.5]] : [['ranged', 1]]);
  }

  /** The spell a player throws in this fight: one picked for it, or the staff's own. */
  private spellFor(player: PlayerEntity): SpellDef | undefined {
    const action = player.action;
    if (action?.kind === 'attack' && action.spell) return SPELL_BY_ID[action.spell];
    return player.autocast && isStaff(player.equipment.weapon) ? SPELL_BY_ID[player.autocast] : undefined;
  }

  /** A spell thrown: glyphs used up, Magic against the monster's Magic, the spell's own damage. */
  private playerCast(player: PlayerEntity, monster: MonsterEntity, spell: SpellDef): void {
    if (!this.takeGlyphs(player, spell)) {
      player.action = null;
      return;
    }
    const attacker = this.helmed(player, monster, magicFighter(player.skills, player.equipment, player));
    const landed = this.rng.chance(hitChance(attacker, monsterMagicFighter(MONSTERS[monster.defKey])));
    const damage = landed ? Math.min(monster.hp, this.rng.int(1, spell.maxHit!)) : 0;
    player.nextAttack = this.tick + CAST_TICKS;
    this.animate(player, 'cast');
    this.addXp(player, 'magic', spell.xp);
    const action = player.action;
    // A spell picked by hand is thrown once; then the staff takes over, or the fight waits for a new order.
    if (action?.kind === 'attack' && action.spell) {
      if (player.autocast && isStaff(player.equipment.weapon)) delete action.spell;
      else player.action = null;
    }
    this.landPlayerHit(player, monster, damage, [['magic', MAGIC_XP_PER_DAMAGE / XP_PER_DAMAGE]], { element: spell.element!, tier: spell.tier! });
  }

  /** How a player fights right now: with a bow and their best arrows, or hand to hand. */
  private fighterFor(player: PlayerEntity) {
    if (!isBow(player.equipment.weapon)) return playerFighter(player.skills, player.equipment, player.attackStyle, player);
    const arrow = bestArrows(player.inventory, levelForXp(player.skills.ranged));
    return rangedFighter(player.skills, player.equipment, player.attackStyle, arrow?.ammo?.strength ?? 0, player);
  }

  /** Arrows that fall on the same tile pile up rather than lying about one by one. */
  private dropArrow(itemId: string, at: Point, owner: EntityId): void {
    for (const e of this.entities.values()) {
      if (e.kind === 'item' && e.itemId === itemId && e.x === at.x && e.y === at.y && e.owner === owner) {
        e.qty++;
        e.despawnAt = this.tick + GROUND_ITEM_TICKS;
        return;
      }
    }
    this.spawnItem(itemId, 1, at, owner, PRIVATE_TICKS, GROUND_ITEM_TICKS);
  }

  /** A player's blow or arrow lands (or misses): XP split between `skills`, and the monster turns on them. */
  private landPlayerHit(player: PlayerEntity, monster: MonsterEntity, damage: number, skills: [SkillId, number][], spell?: HitSpell): void {
    const stats = MONSTERS[monster.defKey];
    // Some Bounty creatures can't be finished without the right thing in the pack.
    const finisher = stats.bounty?.finisher;
    if (finisher && damage > 0 && damage >= monster.hp) {
      if (hasItem(player.inventory, finisher.item)) {
        if (finisher.consume) removeItem(player.inventory, finisher.item, 1);
        this.message(player.id, finisher.finish);
      } else {
        damage = monster.hp - 1;
        this.message(player.id, finisher.clings, 'warn');
      }
    }
    // A monster wrapped in shadow takes no harm until the shades it called up are gone.
    if (damage > 0 && stats.summons && this.shrouded(monster)) {
      damage = 0;
      this.message(player.id, `Your blow passes through the shadow around the ${monster.name.toLowerCase()}. Its shades must fall first.`, 'warn');
    }
    monster.hp -= damage;
    monster.damageBy.set(player.id, (monster.damageBy.get(player.id) ?? 0) + damage);
    if (stats.summons) this.summonShades(monster, player);
    this.broadcastHit(player, monster, damage, monster.hp, monster.maxHp, spell);
    if (damage > 0) {
      for (const [skill, share] of skills) this.addXp(player, skill, damage * XP_PER_DAMAGE * share);
      this.addXp(player, 'hitpoints', Math.round((damage * XP_PER_DAMAGE * 10) / 3) / 10);
    }
    // Monsters always fight back; a fresh fight gives them a moment to turn.
    if (monster.target === null) {
      monster.target = player.id;
      monster.nextAttack = Math.max(monster.nextAttack, this.tick + Math.ceil(stats.attackSpeed / 2));
    }
    if (monster.hp <= 0) this.monsterDies(monster);
  }

  /** Whether any shade `monster` called up still stands. */
  private shrouded(monster: MonsterEntity): boolean {
    for (const e of this.entities.values()) if (e.kind === 'monster' && e.summonedBy === monster.id && alive(e)) return true;
    return false;
  }

  /**
   * Each time a summoner's health first drops below one of its thresholds it
   * calls up its shades around it, and holds on with at least 1 hitpoint
   * until they are beaten.
   */
  private summonShades(monster: MonsterEntity, player: PlayerEntity): void {
    const summons = MONSTERS[monster.defKey].summons!;
    const used = monster.summoned ?? 0;
    if (used >= summons.at.length || monster.hp > monster.maxHp * summons.at[used]) return;
    monster.summoned = used + 1;
    monster.hp = Math.max(1, monster.hp);
    const stats = MONSTERS[summons.monster];
    const spots: Point[] = [];
    for (let r = 1; r <= 3 && spots.length < summons.count; r++) {
      const ring: Point[] = [];
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const x = monster.x + dx;
          const y = monster.y + dy;
          if (Math.max(Math.abs(dx), Math.abs(dy)) === r && this.grid.isWalkable(x, y) && !this.grid.isGate(x, y) && !this.occupied.has(this.grid.index(x, y))) ring.push({ x, y });
        }
      while (ring.length && spots.length < summons.count) spots.push(ring.splice(this.rng.int(0, ring.length - 1), 1)[0]);
    }
    for (const at of spots) {
      const shade: MonsterEntity = {
        id: this.allocateId(),
        kind: 'monster',
        defKey: summons.monster,
        name: this.map.defs.monsters[summons.monster]?.name ?? 'Gloam shade',
        level: Math.floor((0.75 * (stats.attack + stats.strength + stats.defence)) / 3 + 0.25 * Math.min(99, stats.hitpoints)),
        x: at.x,
        y: at.y,
        hp: stats.hitpoints,
        maxHp: stats.hitpoints,
        spawn: { ...at },
        wander: { cx: monster.wander.cx, cy: monster.wander.cy, radius: monster.wander.radius + 4 },
        path: [],
        target: player.id,
        nextAttack: this.tick + 2,
        nextWander: this.tick + 10,
        damageBy: new Map(),
        summonedBy: monster.id,
      };
      this.entities.set(shade.id, shade);
      this.occupied.add(this.grid.index(at.x, at.y));
    }
    this.animate(monster, 'summon');
    this.message(player.id, `The ${monster.name.toLowerCase()} throws back its head, and the shadows rise to answer it.`, 'warn');
  }

  private monsterAttack(monster: MonsterEntity, player: PlayerEntity): void {
    const stats = MONSTERS[monster.defKey];
    if (stats.breath && this.rng.chance(stats.breath.chance)) return this.breathe(monster, player);
    if (stats.casts && this.rng.chance(stats.casts.chance)) return this.monsterCast(monster, player);
    const defender = playerFighter(player.skills, player.equipment, player.attackStyle, player);
    // A Bounty creature met without the gear it calls for always lands, and hard.
    const needs = stats.bounty?.requires;
    const exposed = !!needs && player.equipment[ITEMS[needs.item].equip!.slot] !== needs.item;
    const landed = exposed || this.rng.chance(hitChance(monsterFighter(stats), defender));
    // The Ward of Blades turns every bite and blow aside.
    const warded = player.prayers.includes('ward_of_blades');
    const damage = landed && !warded ? Math.min(player.hp, this.rng.int(1, stats.maxHit * (exposed ? 3 : 1))) : 0;
    if (exposed && !warded) this.message(player.id, needs!.warning, 'warn');
    monster.nextAttack = this.tick + stats.attackSpeed;
    this.animate(monster, stats.attackAnim);
    this.landMonsterHit(monster, player, damage);
  }

  /**
   * Fire: it always lands and armour doesn't help. A fireward shield and a
   * fireward potion each cut it to a third, and the Ember Ward prayer halves it.
   */
  private breathe(monster: MonsterEntity, player: PlayerEntity): void {
    const stats = MONSTERS[monster.defKey];
    const shield = !!(player.equipment.shield && ITEMS[player.equipment.shield]?.fireward);
    const potion = player.firewardUntil !== undefined;
    const prayer = player.prayers.includes('ember_ward');
    const max = Math.floor(stats.breath!.maxHit / (shield ? 3 : 1) / (potion ? 3 : 1) / (prayer ? 2 : 1));
    const damage = Math.min(player.hp, this.rng.int(0, max));
    monster.nextAttack = this.tick + stats.attackSpeed;
    this.animate(monster, 'breath');
    if (shield) this.message(player.id, 'Your shield turns most of the fire aside.');
    else if (potion || prayer) this.message(player.id, 'The fire washes over you, but its heat barely bites.');
    else if (damage >= max / 2) this.message(player.id, `You are badly burnt by the ${monster.name.toLowerCase()}'s fire.`, 'warn');
    this.landMonsterHit(monster, player, damage);
  }

  /** A monster's spell: its Magic against the player's magic defence. The Ward of Spells stops it. */
  private monsterCast(monster: MonsterEntity, player: PlayerEntity): void {
    const stats = MONSTERS[monster.defKey];
    const spell = stats.casts!;
    const magic = stats.magic ?? stats.attack;
    const attacker = { attack: magic, strength: 0, defence: magic, bonuses: { attack: 0, strength: 0, defence: 0, magic: 0 } };
    const landed = this.rng.chance(hitChance(attacker, magicDefender(player.skills, player.equipment, player)));
    const warded = player.prayers.includes('ward_of_spells');
    const damage = landed && !warded ? Math.min(player.hp, this.rng.int(1, spell.maxHit)) : 0;
    monster.nextAttack = this.tick + stats.attackSpeed;
    this.animate(monster, 'cast');
    this.landMonsterHit(monster, player, damage, { element: spell.element, tier: 2 });
  }

  private landMonsterHit(monster: MonsterEntity, player: PlayerEntity, damage: number, spell?: HitSpell): void {
    player.hp -= damage;
    player.attackedBy = monster.id;
    this.broadcastHit(monster, player, damage, player.hp, levelForXp(player.skills.hitpoints), spell);
    if (player.hp <= 0) return this.playerDies(player);
    // A blow breaks a Hearth Recall chant.
    if (player.action?.kind === 'teleport' && !player.action.departed) {
      player.action = null;
      this.message(player.id, 'Your chant is broken.', 'warn');
    }
    // Auto-retaliate when standing idle.
    if (!player.action && !player.path.length) {
      player.action = { kind: 'attack', targetId: monster.id };
      player.nextAttack = Math.max(player.nextAttack, this.tick + 1);
    }
  }

  private monsterDies(monster: MonsterEntity): void {
    monster.hp = 0;
    monster.target = null;
    monster.path = [];
    monster.dyingUntil = this.tick + MONSTER_DEATH_TICKS;
    this.animate(monster, 'death');
    for (const e of this.entities.values()) {
      if (e.kind !== 'player') continue;
      if (e.action?.kind === 'attack' && e.action.targetId === monster.id) e.action = null;
      if (e.attackedBy === monster.id) e.attackedBy = null;
    }
  }

  /** Loot goes to whoever did the most damage, seen only by them for the first minute. */
  private dropLoot(monster: MonsterEntity): void {
    let killer: EntityId | undefined;
    let best = 0;
    for (const [id, dealt] of monster.damageBy) {
      if (dealt > best && this.entities.has(id)) [killer, best] = [id, dealt];
    }
    const winner = killer !== undefined ? this.entities.get(killer) : undefined;
    if (winner?.kind === 'player') {
      this.questKill(winner, monster);
      this.bountyKill(winner, monster);
    }
    for (const drop of MONSTERS[monster.defKey].drops) {
      if (!this.rng.chance(drop.chance)) continue;
      const qty = rollQty(drop.qty, (a, b) => this.rng.int(a, b));
      if (ITEMS[drop.item].stackable) this.spawnItem(drop.item, qty, monster, killer, PRIVATE_TICKS, GROUND_ITEM_TICKS);
      else for (let i = 0; i < qty; i++) this.spawnItem(drop.item, 1, monster, killer, PRIVATE_TICKS, GROUND_ITEM_TICKS);
    }
  }

  private playerDies(player: PlayerEntity): void {
    player.hp = 0;
    player.deadUntil = this.tick + PLAYER_DEATH_TICKS;
    player.path = [];
    player.destination = null;
    player.gateNotice = null;
    player.attackedBy = null;
    this.stopActions(player);
    player.prayers = [];
    player.boosts = {};
    delete player.firewardUntil;
    this.animate(player, 'death');
    this.message(player.id, 'You have been defeated.', 'warn');
    for (const e of this.entities.values()) if (e.kind === 'monster' && e.target === player.id) e.target = null;
  }

  /**
   * Back at the spawn point with full health. You keep your most valuable
   * items (counted one at a time, so a stack of coins is many cheap items);
   * everything else waits where you fell, for you alone.
   */
  private respawnPlayer(player: PlayerEntity): void {
    type Held = { itemId: string; qty: number; value: number; slot: EquipSlot | null };
    const held: Held[] = [];
    for (const [slot, itemId] of Object.entries(player.equipment) as [EquipSlot, string][]) held.push({ itemId, qty: 1, value: ITEMS[itemId].value, slot });
    for (const stack of player.inventory) if (stack) held.push({ ...stack, value: ITEMS[stack.itemId].value, slot: null });
    held.sort((a, b) => b.value - a.value);

    let keep = KEEP_ON_DEATH;
    const inventory = emptyInventory();
    const equipment: PlayerEntity['equipment'] = {};
    const lost: ItemStack[] = [];
    for (const h of held) {
      const kept = Math.min(keep, h.qty);
      keep -= kept;
      if (kept > 0 && h.slot) equipment[h.slot] = h.itemId;
      else if (kept > 0) addItem(inventory, h.itemId, kept);
      if (h.qty > kept) lost.push({ itemId: h.itemId, qty: h.qty - kept });
    }
    for (const { itemId, qty } of lost) this.spawnItem(itemId, qty, player, player.id, DEATH_PILE_TICKS, DEATH_PILE_TICKS);

    player.inventory = inventory;
    player.equipment = equipment;
    player.x = this.map.spawn.x;
    player.y = this.map.spawn.y;
    player.hp = levelForXp(player.skills.hitpoints);
    player.prayer = levelForXp(player.skills.prayer);
    player.nextRegen = this.tick + REGEN_TICKS;
    delete player.deadUntil;
    this.message(
      player.id,
      lost.length
        ? `You wake in Kelmoor, sore but alive. You kept your ${KEEP_ON_DEATH} most valuable items; the rest lies where you fell. Only you can see it, for the next ${DEATH_PILE_TICKS * TICK_MS / 60000} minutes.`
        : 'You wake in Kelmoor, sore but alive. You kept everything you had.',
    );
  }

  /** Waking up after a death, and a hitpoint back every minute. */
  private recover(player: PlayerEntity): void {
    if (player.deadUntil !== undefined) {
      if (this.tick >= player.deadUntil) this.respawnPlayer(player);
      return;
    }
    const max = levelForXp(player.skills.hitpoints);
    const regen = player.prayers.includes('mending_hands') ? REGEN_TICKS / 2 : REGEN_TICKS;
    if (player.hp >= max) player.nextRegen = this.tick + regen;
    else if (this.tick >= player.nextRegen) {
      player.hp++;
      player.nextRegen = this.tick + regen;
    }
    if (!player.via && player.energy < 100) player.energy = Math.min(100, player.energy + energyRestore(levelForXp(player.skills.agility)));
    if (player.prayers.length) this.drainPrayer(player);
    if (Object.keys(player.boosts).length && this.tick >= player.nextBoostFade) this.fadeBoosts(player);
    if (player.firewardUntil !== undefined) {
      if (this.tick === player.firewardUntil - 50) this.message(player.id, 'Your fireward potion is about to wear off.', 'warn');
      if (this.tick >= player.firewardUntil) {
        delete player.firewardUntil;
        this.message(player.id, 'Your fireward potion has worn off.', 'warn');
      }
    }
  }

  private drainPrayer(player: PlayerEntity): void {
    player.prayer = Math.max(0, Math.round((player.prayer - drainPerTick(player.prayers)) * 1000) / 1000);
    if (player.prayer > 0) return;
    player.prayers = [];
    this.message(player.id, 'You have run out of prayer points. Pray at an altar to recharge them.', 'warn');
  }

  /** Each potion boost slips a level a minute until it is gone. */
  private fadeBoosts(player: PlayerEntity): void {
    player.nextBoostFade = this.tick + BOOST_FADE_TICKS;
    for (const [skill, boost] of Object.entries(player.boosts) as [SkillId, number][]) {
      const next = boost - Math.sign(boost);
      if (next === 0) delete player.boosts[skill];
      else player.boosts[skill] = next;
    }
  }

  private togglePrayer(player: PlayerEntity, id: PrayerId): void {
    const prayer = PRAYERS[id];
    if (!prayer) return;
    if (player.prayers.includes(id)) {
      player.prayers = player.prayers.filter((p) => p !== id);
      return;
    }
    if (levelForXp(player.skills.prayer) < prayer.level) {
      return this.message(player.id, `You need a Prayer level of ${prayer.level} to use ${prayer.name}.`, 'warn');
    }
    if (player.prayer <= 0) return this.message(player.id, 'You have no prayer points left. Pray at an altar to recharge them.', 'warn');
    player.prayers = withPrayer(player.prayers, id);
  }

  /** Bones go in the ground, ashes on the wind; both please the gods a little. */
  private bury(player: PlayerEntity, slot: number): void {
    const stack = this.slot(player, slot);
    const bury = stack ? ITEMS[stack.itemId].bury : undefined;
    if (!stack || !bury || this.tick < player.nextBury) return;
    const ashes = stack.itemId === 'ashes';
    player.inventory[slot] = stack.qty > 1 ? { ...stack, qty: stack.qty - 1 } : null;
    player.nextBury = this.tick + BURY_TICKS;
    this.animate(player, ashes ? 'scatter' : 'bury');
    this.message(player.id, ashes ? 'You scatter the ashes on the wind.' : `You dig a hole in the ground and bury the ${ITEMS[stack.itemId].name.toLowerCase()}.`);
    this.addXp(player, 'prayer', bury.xp);
  }

  /** A dose of potion: a boost to some levels, prayer points back, or a ward against fire. */
  private drink(player: PlayerEntity, slot: number): void {
    const stack = this.slot(player, slot);
    const effect = stack ? ITEMS[stack.itemId].drink : undefined;
    if (!stack || !effect || this.tick < player.nextEat) return;
    player.inventory[slot] = { itemId: effect.next, qty: 1 };
    player.nextEat = this.tick + EAT_DELAY;
    player.nextAttack = Math.max(player.nextAttack, this.tick + 2);
    const amount = (level: number) => (effect.base ?? 0) + Math.floor((level * (effect.pct ?? 0)) / 100);
    for (const skill of effect.boost ?? []) {
      // A fresh dose tops the boost back up; it never stacks on top of one.
      player.boosts[skill] = Math.max(player.boosts[skill] ?? 0, amount(levelForXp(player.skills[skill])));
      if (!player.nextBoostFade || player.nextBoostFade <= this.tick) player.nextBoostFade = this.tick + BOOST_FADE_TICKS;
    }
    if (effect.prayer) {
      const max = levelForXp(player.skills.prayer);
      player.prayer = Math.min(max, Math.floor(player.prayer) + amount(max));
    }
    if (effect.fireward) player.firewardUntil = this.tick + effect.fireward;
    this.animate(player, 'drink');
    const name = ITEMS[stack.itemId].name.replace(/ \(\d\)$/, '').toLowerCase();
    const left = ITEMS[effect.next]?.drink ? Number(/\((\d)\)$/.exec(ITEMS[effect.next].name)?.[1]) : 0;
    this.message(player.id, `You drink some of your ${name}.`);
    this.message(player.id, left ? `You have ${left} dose${left > 1 ? 's' : ''} of potion left.` : 'You have finished your potion.');
  }

  /** Whether Old Nessa has taught this player her craft; tells them if not. */
  private knowsHerblore(player: PlayerEntity): boolean {
    if ((player.quests[HERBLORE_QUEST] ?? 0) >= doneStage(QUESTS[HERBLORE_QUEST])) return true;
    this.message(player.id, 'You don\'t know enough about herbs yet. Old Nessa, in her hut in the swamp, might teach you once her cauldron is going again.', 'warn');
    return false;
  }

  private startClean(player: PlayerEntity, slot: number): void {
    const stack = this.slot(player, slot);
    const clean = stack ? ITEMS[stack.itemId].clean : undefined;
    if (!stack || !clean || !this.knowsHerblore(player)) return;
    this.stopActions(player);
    player.path = [];
    player.destination = null;
    player.action = { kind: 'clean', itemId: stack.itemId, nextAttempt: this.tick + 1 };
  }

  /** Cleans one grimy herb of the chosen kind, until none are left. */
  private cleanStep(player: PlayerEntity): void {
    const action = player.action;
    if (action?.kind !== 'clean' || this.tick < action.nextAttempt) return;
    const clean = ITEMS[action.itemId].clean!;
    const slot = player.inventory.findIndex((s) => s?.itemId === action.itemId);
    if (slot < 0) return void (player.action = null);
    if (levelForXp(player.skills.herblore) < clean.level) {
      this.message(player.id, `You need a Herblore level of ${clean.level} to clean this herb.`, 'warn');
      return void (player.action = null);
    }
    player.inventory[slot] = { itemId: clean.into, qty: 1 };
    this.addXp(player, 'herblore', clean.xp);
    this.message(player.id, `You clean the dirt from the ${ITEMS[clean.into].name.toLowerCase()}.`);
    action.nextAttempt = this.tick + 2;
    if (!player.inventory.some((s) => s?.itemId === action.itemId)) player.action = null;
  }

  /** Once beside the altar, offers the bones carried one at a time, for more XP than burying them. */
  private offerStep(player: PlayerEntity): void {
    const action = player.action;
    if (action?.kind !== 'offer' || this.tick < action.nextAttempt) return;
    const altar = this.entities.get(action.targetId);
    if (!altar || !this.adjacent(player, altar)) return void (player.action = null);
    const slot = player.inventory.findIndex((s) => !!s && !!ITEMS[s.itemId].bury && s.itemId !== 'ashes');
    if (slot < 0) {
      if (!action.started) this.message(player.id, 'You have no bones to offer.', 'warn');
      return void (player.action = null);
    }
    const bones = player.inventory[slot]!;
    if (!action.started) {
      action.started = true;
      action.nextAttempt = this.tick + 1;
      this.message(player.id, 'You kneel before the altar.');
      return;
    }
    player.inventory[slot] = bones.qty > 1 ? { ...bones, qty: bones.qty - 1 } : null;
    this.addXp(player, 'prayer', ITEMS[bones.itemId].bury!.xp * this.altarMultiplier(player, altar));
    this.message(player.id, `The gods are pleased with your offering of ${ITEMS[bones.itemId].name.toLowerCase()}.`);
    action.nextAttempt = this.tick + OFFER_TICKS;
  }

  private eat(player: PlayerEntity, slot: number): void {
    const stack = this.slot(player, slot);
    const heals = stack ? ITEMS[stack.itemId].heals : undefined;
    if (!stack || !heals || this.tick < player.nextEat) return;
    player.inventory[slot] = stack.qty > 1 ? { ...stack, qty: stack.qty - 1 } : null;
    const max = levelForXp(player.skills.hitpoints);
    const before = player.hp;
    player.hp = Math.min(max, player.hp + heals);
    player.nextEat = this.tick + EAT_DELAY;
    player.nextAttack = Math.max(player.nextAttack, this.tick + 2);
    this.animate(player, 'eat');
    const name = ITEMS[stack.itemId].name.toLowerCase();
    this.message(player.id, player.hp > before ? `You eat the ${name}. It heals some health.` : `You eat the ${name}.`);
  }

  private equip(player: PlayerEntity, slot: number): void {
    const stack = this.slot(player, slot);
    const equip = stack ? ITEMS[stack.itemId].equip : undefined;
    if (!stack || !equip) return;
    const skill = equip.skill ?? (equip.style === 'shoot' ? 'ranged' : equip.slot === 'weapon' ? 'attack' : 'defence');
    const need = equip.level ?? 1;
    if (levelForXp(player.skills[skill]) < need) {
      this.message(player.id, `You need ${aOrSome(this.skillName(skill))} level of ${need} to ${equip.slot === 'weapon' ? 'wield' : 'wear'} this.`, 'warn');
      return;
    }
    // Bows take both hands: a bow and a shield push each other off.
    const clash = equip.style === 'shoot' ? 'shield' : equip.slot === 'shield' && isBow(player.equipment.weapon) ? 'weapon' : null;
    const other = clash ? player.equipment[clash] : undefined;
    const old = player.equipment[equip.slot];
    if (other && old && !player.inventory.some((s, i) => !s && i !== slot)) {
      this.message(player.id, "You don't have enough inventory space.", 'warn');
      return;
    }
    player.equipment[equip.slot] = stack.itemId;
    player.inventory[slot] = old ? { itemId: old, qty: 1 } : null;
    if (other) {
      delete player.equipment[clash!];
      addItem(player.inventory, other);
    }
  }

  private unequip(player: PlayerEntity, slot: EquipSlot): void {
    const itemId = player.equipment[slot];
    if (!itemId) return;
    if (!addItem(player.inventory, itemId)) {
      this.message(player.id, "You don't have enough free space in your inventory.", 'warn');
      return;
    }
    delete player.equipment[slot];
  }

  // -------------------------------------------------------------------------
  // Magic
  // -------------------------------------------------------------------------

  /** A spell from the spellbook: at a monster, on an item in the pack, or a teleport. */
  private cast(player: PlayerEntity, spellId: string, targetId?: EntityId, slot?: number): void {
    const spell = SPELL_BY_ID[spellId];
    if (!spell) return;
    if (levelForXp(player.skills.magic) < spell.level) {
      this.message(player.id, `You need a Magic level of ${spell.level} to cast ${spell.name}.`, 'warn');
      return;
    }
    if (!this.hasGlyphs(player, spell)) return;
    if (spell.kind === 'teleport') return this.startTeleport(player, spell);
    if (spell.kind === 'item') {
      if (slot !== undefined && this.validSlot(slot)) this.castOnItem(player, spell, slot);
      return;
    }
    const target = targetId !== undefined ? this.entities.get(targetId) : undefined;
    if (target?.kind !== 'monster' || !alive(target)) {
      this.message(player.id, 'You can only cast that on a creature you can fight.', 'warn');
      return;
    }
    this.stopActions(player);
    player.action = { kind: 'attack', targetId: target.id, spell: spell.id };
  }

  /** Picks (or clears) the spell a staff casts by itself. */
  private setAutocast(player: PlayerEntity, spellId: string | null): void {
    const spell = spellId ? SPELL_BY_ID[spellId] : undefined;
    if (!spell) {
      delete player.autocast;
      return;
    }
    if (spell.kind !== 'combat') return;
    if (levelForXp(player.skills.magic) < spell.level) {
      this.message(player.id, `You need a Magic level of ${spell.level} to cast ${spell.name}.`, 'warn');
      return;
    }
    player.autocast = spell.id;
    this.message(player.id, isStaff(player.equipment.weapon) ? `Your staff will cast ${spell.name} when you fight.` : `Your staff will cast ${spell.name} when you fight. Wield one to use it.`);
  }

  /** The spell a staff in hand is set to cast, if any. */
  private autocastSpell(player: PlayerEntity): SpellDef | undefined {
    return player.autocast && isStaff(player.equipment.weapon) ? SPELL_BY_ID[player.autocast] : undefined;
  }

  /** Whether the pack (and staff) has the glyphs for a cast; says which run short if not. */
  private hasGlyphs(player: PlayerEntity, spell: SpellDef, extra?: { itemId: string; qty: number }): boolean {
    const missing = missingGlyphs(spell, player.inventory, player.equipment);
    // Gilding a glyph the spell also uses needs one more of it.
    if (extra && !missing.length) {
      const need = glyphCost(spell, player.equipment).find((c) => c.itemId === extra.itemId);
      if (need && countItem(player.inventory, extra.itemId) < need.qty + extra.qty) missing.push({ itemId: extra.itemId, qty: 1 });
    }
    if (!missing.length) return true;
    const names = missing.map((m) => ITEMS[m.itemId].name.toLowerCase().replace(/ glyph$/, ''));
    this.message(player.id, `You don't have enough ${names.join(' and ')} glyphs to cast ${spell.name}.`, 'warn');
    return false;
  }

  /** Uses up a cast's glyphs; false (and a message) when there aren't enough. */
  private takeGlyphs(player: PlayerEntity, spell: SpellDef): boolean {
    if (!this.hasGlyphs(player, spell)) return false;
    for (const { itemId, qty } of glyphCost(spell, player.equipment)) removeItem(player.inventory, itemId, qty);
    return true;
  }

  /** A teleport: the words, a flash, and a few ticks later the caster is there. Hearth Recall is chanted first. */
  private startTeleport(player: PlayerEntity, spell: SpellDef): void {
    if (spell.recall && this.inFight(player)) {
      this.message(player.id, "You can't chant the way home while something is fighting you.", 'warn');
      return;
    }
    if (!spell.recall && !this.takeGlyphs(player, spell)) return;
    this.stopActions(player);
    player.path = [];
    player.destination = null;
    const departAt = this.tick + (spell.recall ? RECALL_TICKS : 0);
    player.action = { kind: 'teleport', spell: spell.id, to: this.openTileNear(spell.to!), departAt, arriveAt: departAt + TELEPORT_TICKS };
    if (spell.recall) this.message(player.id, 'You begin to chant the way home...');
    else this.addXp(player, 'magic', spell.xp);
  }

  private teleportStep(player: PlayerEntity): void {
    const action = player.action;
    if (action?.kind !== 'teleport') return;
    if (!action.departed && this.tick >= action.departAt) {
      action.departed = true;
      if (!action.ferry) this.animate(player, 'teleport');
    }
    if (this.tick < action.arriveAt) return;
    player.x = action.to.x;
    player.y = action.to.y;
    player.action = null;
    player.attackedBy = null;
    for (const e of this.entities.values()) if (e.kind === 'monster' && e.target === player.id) e.target = null;
    if (action.ferry) {
      this.message(player.id, `The ferry ties up at ${action.place}.`);
      return;
    }
    this.animate(player, 'arrive');
    this.message(player.id, `You arrive in ${action.place ?? SPELL_BY_ID[action.spell].place}.`);
  }

  /** Whether a monster is fighting this player right now. */
  private inFight(player: PlayerEntity): boolean {
    for (const e of this.entities.values()) if (e.kind === 'monster' && e.target === player.id && alive(e)) return true;
    return false;
  }

  /** The nearest walkable tile to a point, searching outward ring by ring. */
  private openTileNear(p: Point): Point {
    for (let r = 0; r <= 8; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (this.grid.inBounds(p.x + dx, p.y + dy) && this.grid.isWalkable(p.x + dx, p.y + dy)) return { x: p.x + dx, y: p.y + dy };
        }
      }
    }
    return this.map.spawn;
  }

  /** Gilding (an item to coins) or Forge Touch (ore to a bar), on one item in the pack. */
  private castOnItem(player: PlayerEntity, spell: SpellDef, slot: number): void {
    const stack = this.slot(player, slot);
    if (!stack || this.tick < player.nextAttack) return;
    const item = ITEMS[stack.itemId];
    if (spell.effect === 'gild') {
      if (stack.itemId === 'coins') return this.message(player.id, 'Coins are already gold.');
      const coins = Math.floor(item.value * (spell.rate ?? 0));
      if (coins < 1) return this.message(player.id, "There's not enough worth in that to gild.");
      const freesSlot = !item.stackable || stack.qty === 1;
      if (!freesSlot && !canAdd(player.inventory, 'coins', coins)) return this.message(player.id, "You don't have enough inventory space.", 'warn');
      if (!this.hasGlyphs(player, spell, { itemId: stack.itemId, qty: 1 })) return;
      this.takeGlyphs(player, spell);
      removeItem(player.inventory, stack.itemId, 1);
      addItem(player.inventory, 'coins', coins);
      player.nextAttack = this.tick + CAST_TICKS;
      this.animate(player, 'gild');
      this.addXp(player, 'magic', spell.xp);
      this.message(player.id, `The ${item.name.toLowerCase()} melts into ${coins} gold coin${coins === 1 ? '' : 's'}.`);
      return;
    }
    // Forge Touch: the best bar this ore (and whatever else is carried) can make.
    const smithing = levelForXp(player.skills.smithing);
    const recipes = RECIPES.filter((r) => r.station === 'furnace' && r.inputs.some((i) => i.itemId === stack.itemId));
    if (!recipes.length) return this.message(player.id, 'Forge Touch only works on ore.');
    const can = recipes
      .filter((r) => smithing >= r.level && r.inputs.every((i) => countItem(player.inventory, i.itemId) >= i.qty))
      .sort((a, b) => b.level - a.level)[0];
    if (!can) {
      const least = Math.min(...recipes.map((r) => r.level));
      return this.message(player.id, smithing < least ? `You need a Smithing level of ${least} to smelt that.` : "You don't have everything that bar needs.", 'warn');
    }
    if (!this.takeGlyphs(player, spell)) return;
    for (const i of can.inputs) removeItem(player.inventory, i.itemId, i.qty);
    addItem(player.inventory, can.output, can.outputQty ?? 1);
    player.nextAttack = this.tick + CAST_TICKS;
    this.animate(player, 'forge');
    this.addXp(player, 'magic', spell.xp);
    this.addXp(player, 'smithing', can.xp);
    this.message(player.id, `The ore glows white in your hand and runs into ${aOrSome(ITEMS[can.output].name.toLowerCase())}.`);
  }

  // -------------------------------------------------------------------------
  // Monsters
  // -------------------------------------------------------------------------

  /** One tick of a monster's life: respawning, dying, fighting, or wandering. */
  private monsterStep(m: MonsterEntity): void {
    const stats = MONSTERS[m.defKey];
    if (m.respawnAt !== undefined) {
      if (this.tick < m.respawnAt || this.occupied.has(this.grid.index(m.spawn.x, m.spawn.y))) return;
      delete m.respawnAt;
      m.x = m.spawn.x;
      m.y = m.spawn.y;
      m.hp = m.maxHp;
      m.damageBy.clear();
      delete m.summoned;
      m.nextWander = this.tick + this.rng.int(2, 10);
      this.occupied.add(this.grid.index(m.x, m.y));
      return;
    }
    if (m.dyingUntil !== undefined) {
      if (this.tick < m.dyingUntil) return;
      delete m.dyingUntil;
      this.dropLoot(m);
      this.occupied.delete(this.grid.index(m.x, m.y));
      if (m.summonedBy !== undefined) return void this.entities.delete(m.id);
      m.respawnAt = this.tick + stats.respawnTicks;
      return;
    }

    let target = m.target !== null ? this.entities.get(m.target) : undefined;
    const home = Math.hypot(m.x - m.wander.cx, m.y - m.wander.cy);
    if (target && (target.kind !== 'player' || target.deadUntil !== undefined || distance(m, target) > MAX_CHASE || home > m.wander.radius + LEASH)) {
      target = undefined;
    }
    if (!target && stats.aggressive) target = this.findPrey(m, stats.aggroRange ?? 3, !!stats.boss);
    const was = m.target !== null ? this.entities.get(m.target) : undefined;
    m.target = target?.kind === 'player' ? target.id : null;
    // Whoever it gave up on is no longer under attack from it.
    if (was?.kind === 'player' && was.id !== m.target && was.attackedBy === m.id) was.attackedBy = null;
    // A shade fades once its fight is over or whatever called it up has fallen.
    if (m.summonedBy !== undefined) {
      const owner = this.entities.get(m.summonedBy);
      if (!target || owner?.kind !== 'monster' || !alive(owner)) {
        if (target?.kind === 'player' && target.attackedBy === m.id) target.attackedBy = null;
        this.occupied.delete(this.grid.index(m.x, m.y));
        this.entities.delete(m.id);
        return;
      }
    }

    if (target?.kind === 'player') {
      m.path = [];
      if (inReach(m, target)) {
        if (this.tick >= m.nextAttack) this.monsterAttack(m, target);
        return;
      }
      // Fire reaches further than teeth: a fleeing or approaching player may get breathed on.
      if (stats.breath && this.tick >= m.nextAttack && distance(m, target) <= stats.breath.range && this.rng.chance(0.5)) {
        this.breathe(m, target);
        return;
      }
      // So do spells, with a clear line to the target.
      if (stats.casts && this.tick >= m.nextAttack && distance(m, target) <= stats.casts.range && this.clearShot(m, target) && this.rng.chance(0.5)) {
        this.monsterCast(m, target);
        return;
      }
      const route = findPath(this.grid, m, this.meleeGoals(target), target, { maxNodes: 600, canStep: this.monsterCanStep(m) });
      if (route.path.length) this.stepMonster(m, route.path[0]);
      return;
    }

    // Wandering: drift back if it was led away, else now and then amble somewhere nearby.
    if (!m.path.length && home > m.wander.radius) {
      m.path = findPath(this.grid, m, [m.spawn], m.spawn, { maxNodes: 2000, canStep: this.monsterCanStep(m) }).path;
    } else if (!m.path.length && this.tick >= m.nextWander) {
      m.nextWander = this.tick + this.rng.int(5, 18);
      const to = { x: m.x + this.rng.int(-4, 4), y: m.y + this.rng.int(-4, 4) };
      if (Math.hypot(to.x - m.wander.cx, to.y - m.wander.cy) <= m.wander.radius && this.grid.isWalkable(to.x, to.y)) {
        m.path = findPath(this.grid, m, [to], to, { maxNodes: 200, canStep: this.monsterCanStep(m, true) }).path.slice(0, 6);
      }
    }
    const next = m.path.shift();
    if (next && !this.stepMonster(m, next)) m.path = [];
  }

  /** Moves a monster one tile if nothing stands there; false when blocked. */
  private stepMonster(m: MonsterEntity, to: Point): boolean {
    const i = this.grid.index(to.x, to.y);
    if (this.occupied.has(i) || !this.grid.isWalkable(to.x, to.y)) return false;
    this.occupied.delete(this.grid.index(m.x, m.y));
    this.occupied.add(i);
    m.x = to.x;
    m.y = to.y;
    return true;
  }

  /** Monsters route around each other and around players, and keep out of gates; wandering keeps to their area. */
  private monsterCanStep(m: MonsterEntity, keepToArea = false) {
    return (_fx: number, _fy: number, tx: number, ty: number): boolean => {
      if (this.grid.isGate(tx, ty)) return false;
      if (keepToArea && Math.hypot(tx - m.wander.cx, ty - m.wander.cy) > m.wander.radius) return false;
      return !this.occupied.has(this.grid.index(tx, ty)) || (tx === m.x && ty === m.y);
    };
  }

  /** The nearest player an aggressive monster will pick on: in range, alive, and (bosses aside) not too strong for it. */
  private findPrey(m: MonsterEntity, range: number, boss: boolean): PlayerEntity | undefined {
    let best: PlayerEntity | undefined;
    for (const e of this.entities.values()) {
      if (e.kind !== 'player' || e.deadUntil !== undefined) continue;
      if (distance(m, e) > range || (!boss && combatLevel(e.skills) > m.level * 2)) continue;
      // Bounty creatures leave alone anyone who doesn't yet know how to fight them.
      if (levelForXp(e.skills.bounty) < bountyLevel(m.defKey)) continue;
      if (!best || distance(m, e) < distance(m, best)) best = e;
    }
    return best;
  }

  /** The four tiles you can fight something from: straight beside it, never across a corner. */
  private meleeGoals(target: Point): Point[] {
    return [
      { x: target.x, y: target.y + 1 },
      { x: target.x + 1, y: target.y },
      { x: target.x - 1, y: target.y },
      { x: target.x, y: target.y - 1 },
    ].filter((p) => this.grid.isWalkable(p.x, p.y));
  }

  private occupancy(): Set<number> {
    const taken = new Set<number>();
    for (const e of this.entities.values()) {
      if ((e.kind === 'player' && e.deadUntil === undefined) || (e.kind === 'monster' && e.respawnAt === undefined)) taken.add(this.grid.index(e.x, e.y));
    }
    return taken;
  }

  // -------------------------------------------------------------------------
  // Agility, Glyphcraft and Farming
  // -------------------------------------------------------------------------

  /** Uses an item from the pack on something in the world, once there. */
  private useOn(player: PlayerEntity, slot: number, targetId: EntityId): void {
    const stack = this.slot(player, slot);
    const target = this.entities.get(targetId);
    if (!stack || !target) return;
    this.stopActions(player);
    if (target.kind === 'scenery' && target.patch) {
      player.action = { kind: 'farm', targetId, itemId: stack.itemId, nextAttempt: 0 };
      this.walkTo(player, target);
      return;
    }
    if (target.kind === 'scenery' && target.defKey === 'glyph_shrine' && stack.itemId === SHARD) {
      player.action = { kind: 'inscribe', targetId, nextAttempt: 0 };
      this.walkTo(player, target);
      return;
    }
    this.message(player.id, 'Nothing interesting happens.');
  }

  /**
   * Once at an obstacle's start, crosses it over a few ticks. A fall happens
   * part way over: it hurts, and you land beside the obstacle with no XP.
   * Crossing a course's obstacles in order earns the lap bonus.
   */
  private crossStep(player: PlayerEntity): void {
    const action = player.action;
    if (action?.kind !== 'cross') return;
    const target = this.entities.get(action.targetId);
    const obstacle = target ? obstacleAt(target.x, target.y) : undefined;
    if (!target || !obstacle) return void (player.action = null);
    const course = COURSES[obstacle.course];
    const kind = OBSTACLE_KINDS[obstacle.type];
    if (!action.started) {
      if (player.x !== obstacle.from.x || player.y !== obstacle.from.y) return void (player.action = null);
      const level = levelForXp(player.skills.agility);
      if (level < course.level) {
        this.message(player.id, `You need an Agility level of ${course.level} to attempt the ${course.name}.`, 'warn');
        return void (player.action = null);
      }
      action.started = true;
      action.endsAt = this.tick + kind.ticks;
      action.fall = !!kind.canFail && this.rng.chance(failChance(level, course.level));
      action.landing = action.fall ? this.fallSpot(obstacle) : obstacle.to;
      player.attackedBy = null;
      return;
    }
    if (this.tick < action.endsAt) return;
    player.action = null;
    player.x = action.landing!.x;
    player.y = action.landing!.y;
    if (action.fall) {
      const damage = Math.min(player.hp, this.rng.int(...course.fall));
      player.hp -= damage;
      this.broadcastHit(target, player, damage, player.hp, levelForXp(player.skills.hitpoints));
      this.message(player.id, `You lose your footing and fall off the ${kind.name.toLowerCase()}.`, 'warn');
      delete player.lap;
      if (player.hp <= 0) this.playerDies(player);
      return;
    }
    this.addXp(player, 'agility', obstacle.xp);
    // The first obstacle starts a lap; each next one in order carries it on.
    if (obstacle.index === 0) player.lap = { course: course.id, next: 1 };
    else if (player.lap?.course === course.id && player.lap.next === obstacle.index) player.lap.next++;
    else delete player.lap;
    if (player.lap?.next === course.obstacles.length) {
      delete player.lap;
      this.addXp(player, 'agility', course.lapXp);
      this.message(player.id, `You complete a lap of the ${course.name}.`);
    }
  }

  /** Where a fall leaves you: off to one side of the obstacle, or back where you started. */
  private fallSpot(obstacle: NonNullable<ReturnType<typeof obstacleAt>>): Point {
    const sides = [
      { x: obstacle.x + obstacle.dir.y, y: obstacle.y + obstacle.dir.x },
      { x: obstacle.x - obstacle.dir.y, y: obstacle.y - obstacle.dir.x },
    ];
    return sides.find((p) => this.grid.isWalkable(p.x, p.y)) ?? obstacle.from;
  }

  /** At a shrine, every aether shard in the pack becomes its glyphs at once, after a moment. */
  private inscribeStep(player: PlayerEntity): void {
    const action = player.action;
    if (action?.kind !== 'inscribe' || this.tick < action.nextAttempt) return;
    const shrine = this.entities.get(action.targetId);
    const glyph = shrine ? glyphForArea(areaAt(this.map, shrine.x, shrine.y)?.name) : undefined;
    if (!shrine || !glyph || !this.adjacent(player, shrine)) return void (player.action = null);
    const level = levelForXp(player.skills.glyphcraft);
    const shards = countItem(player.inventory, SHARD);
    const glyphName = ITEMS[glyph.item].name.toLowerCase();
    if (!action.started) {
      if (level < glyph.level) {
        this.message(player.id, `You need a Glyphcraft level of ${glyph.level} to inscribe ${glyphName}s.`, 'warn');
        return void (player.action = null);
      }
      if (!shards) {
        this.message(player.id, "You don't have any aether shards to inscribe. Mine them from aether stone by the Wizards' Spire.", 'warn');
        return void (player.action = null);
      }
      action.started = true;
      action.nextAttempt = this.tick + INSCRIBE_TICKS;
      this.message(player.id, 'You hold the aether shards up to the shrine.');
      return;
    }
    player.action = null;
    if (!shards) return;
    removeItem(player.inventory, SHARD, shards);
    const made = shards * glyphsPerShard(glyph, level);
    addItem(player.inventory, glyph.item, made);
    this.addXp(player, 'glyphcraft', shards * glyph.xp);
    this.message(player.id, `The shrine marks your shards. You inscribe ${made} ${glyphName}${made > 1 ? 's' : ''}.`);
  }

  /** A player's own state of a patch; untouched patches are overgrown. */
  private patchOf(player: PlayerEntity, patch: ObjectEntity): PatchState {
    return (player.farm[`${patch.x},${patch.y}`] ??= overgrown());
  }

  /**
   * Tending a patch. On arrival the task is chosen from the item used on it
   * (seeds, compost, plant cure) or from the patch itself (weeds to rake, a
   * crop to harvest, dead plants to clear); then it is done over a few ticks.
   */
  private farmStep(player: PlayerEntity): void {
    const action = player.action;
    if (action?.kind !== 'farm' || this.tick < action.nextAttempt) return;
    const target = this.entities.get(action.targetId);
    if (!target || target.kind !== 'scenery' || !target.patch || !this.adjacent(player, target)) return void (player.action = null);
    const state = this.patchOf(player, target);
    if (!action.task) {
      const task = action.itemId ? this.farmTaskForItem(player, target, state, action.itemId) : this.farmTaskForPatch(player, target, state);
      if (!task) return void (player.action = null);
      action.task = task;
      action.nextAttempt = this.tick + FARM_TASK_TICKS[task];
      if (task === 'compost' || task === 'cure') this.animate(player, task === 'compost' ? 'spread' : 'pour');
      const crop = state.crop ? CROPS[state.crop] : undefined;
      const start: Partial<Record<FarmTask, string>> = {
        rake: 'You start raking the patch.',
        harvest: target.patch === 'herb' ? 'You begin to pick the herbs.' : `You begin to dig up the ${plural(crop ? ITEMS[crop.produce].name : 'crop')}.`,
        clear: 'You start digging up the dead plants.',
      };
      if (start[task]) this.message(player.id, start[task]!);
      return;
    }
    this.doFarmTask(player, target, state, action);
  }

  private farmTaskForItem(player: PlayerEntity, patch: ObjectEntity, state: PatchState, itemId: string): FarmTask | null {
    const kind = PATCH_KINDS[patch.patch!];
    const crop = cropForSeed(itemId);
    const warn = (text: string) => (this.message(player.id, text, 'warn'), null);
    if (crop) {
      if (state.crop) return warn('Something is already growing here.');
      if (state.weeds > 0) return warn('This patch needs weeding first. A rake will clear it.');
      if (crop.patch !== patch.patch) return warn(`${ITEMS[crop.seed].name}s grow in ${aOrSome(PATCH_KINDS[crop.patch].name.toLowerCase())}, not here.`);
      if (levelForXp(player.skills.farming) < crop.level) return warn(`You need a Farming level of ${crop.level} to plant ${ITEMS[crop.seed].name.toLowerCase()}s.`);
      if (!hasItem(player.inventory, 'seed_dibber')) return warn('You need a seed dibber to plant seeds.');
      if (countItem(player.inventory, itemId) < kind.seeds) return warn(`You need ${kind.seeds} ${ITEMS[itemId].name.toLowerCase()}s to plant ${aOrSome(kind.name.toLowerCase())}.`);
      return 'plant';
    }
    if (itemId === 'compost') {
      if (state.crop) return warn('Compost goes on before you plant.');
      if (state.compost) return warn('This patch has already been composted.');
      return 'compost';
    }
    if (itemId === 'plant_cure') return state.diseased ? 'cure' : warn("These plants don't need curing.");
    if (itemId === 'rake' || itemId === 'spade') return this.farmTaskForPatch(player, patch, state);
    this.message(player.id, 'Nothing interesting happens.');
    return null;
  }

  private farmTaskForPatch(player: PlayerEntity, patch: ObjectEntity, state: PatchState): FarmTask | null {
    const kind = PATCH_KINDS[patch.patch!];
    const crop = state.crop ? CROPS[state.crop] : undefined;
    const warn = (text: string) => (this.message(player.id, text, 'warn'), null);
    const tell = (text: string) => (this.message(player.id, text), null);
    if (crop && state.dead) return hasItem(player.inventory, 'spade') ? 'clear' : warn('The plants here have died. You need a spade to dig them up.');
    if (crop && isGrown(state)) {
      if (kind.tool && !hasItem(player.inventory, kind.tool)) return warn(`You need ${aOrSome(ITEMS[kind.tool].name.toLowerCase())} to harvest this patch.`);
      return 'harvest';
    }
    if (crop && state.diseased) return hasItem(player.inventory, 'plant_cure') ? 'cure' : warn('The plants in this patch are diseased. A plant cure will save them, if you hurry.');
    if (crop) {
      const name = patch.patch === 'herb' ? `${crop.id} is` : `${plural(ITEMS[crop.produce].name)} are`;
      return tell(`The ${name} growing nicely (stage ${state.stage ?? 0} of ${crop.stages}).${state.compost ? ' The soil is rich with compost.' : ''}`);
    }
    if (state.weeds > 0) return hasItem(player.inventory, 'rake') ? 'rake' : warn('This patch is overgrown with weeds. You need a rake to clear it.');
    return tell(`The patch is clear and ready for planting. Use ${kind.seeds > 1 ? 'seeds' : 'a seed'} on it.${state.compost ? ' The soil is rich with compost.' : ''}`);
  }

  private doFarmTask(player: PlayerEntity, patch: ObjectEntity, state: PatchState, action: Extract<PlayerEntity['action'], { kind: 'farm' }>): void {
    const done = () => void (player.action = null);
    const key = `${patch.x},${patch.y}`;
    switch (action.task) {
      case 'rake':
        if (state.crop || state.weeds <= 0) return done();
        state.weeds--;
        state.timer = 0;
        this.addXp(player, 'farming', FARMING.rakeXp);
        if (state.weeds > 0) return void (action.nextAttempt = this.tick + FARMING.rakeTicks);
        this.message(player.id, 'The patch is clear for planting.');
        return done();
      case 'plant': {
        const crop = cropForSeed(action.itemId ?? '');
        const kind = PATCH_KINDS[patch.patch!];
        if (!crop || state.crop || state.weeds > 0 || countItem(player.inventory, crop.seed) < kind.seeds) return done();
        removeItem(player.inventory, crop.seed, kind.seeds);
        player.farm[key] = { weeds: 0, timer: 0, crop: crop.id, stage: 0, ...(state.compost && { compost: true }) };
        this.addXp(player, 'farming', crop.plantXp);
        const seeds = kind.seeds > 1 ? `${kind.seeds} ${ITEMS[crop.seed].name.toLowerCase()}s` : aOrSome(ITEMS[crop.seed].name.toLowerCase());
        this.message(player.id, `You plant ${seeds} in the ${kind.name.toLowerCase()}.`);
        return done();
      }
      case 'compost':
        if (state.crop || state.compost || !hasItem(player.inventory, 'compost')) return done();
        removeItem(player.inventory, 'compost', 1);
        addItem(player.inventory, 'bucket');
        state.compost = true;
        this.message(player.id, 'You spread the compost over the patch.');
        return done();
      case 'cure':
        if (!state.diseased || !hasItem(player.inventory, 'plant_cure')) return done();
        removeItem(player.inventory, 'plant_cure', 1);
        addItem(player.inventory, 'vial');
        delete state.diseased;
        this.message(player.id, 'You pour the plant cure over the patch. The plants perk up.');
        return done();
      case 'clear':
        player.farm[key] = { weeds: 0, timer: 0 };
        this.message(player.id, 'You dig up the dead plants. The patch is clear again.');
        return done();
      case 'harvest': {
        const crop = state.crop ? CROPS[state.crop] : undefined;
        if (!crop || !isGrown(state)) return done();
        state.left ??= this.rng.int(...crop.yield);
        if (!addItem(player.inventory, crop.produce)) {
          this.message(player.id, "You don't have enough inventory space to hold any more.", 'warn');
          return done();
        }
        this.addXp(player, 'farming', crop.harvestXp);
        state.left--;
        if (state.left > 0) return void (action.nextAttempt = this.tick + FARMING.harvestTicks);
        player.farm[key] = { weeds: 0, timer: 0 };
        this.message(player.id, 'The patch is empty now.');
        return done();
      }
      default:
        return done();
    }
  }

  /**
   * Names the objects whose name depends on where they are: each obstacle
   * after its kind, each shrine after its glyph, and each patch after its
   * kind (big groups of patch tiles are allotments, small ones herb patches).
   */
  private nameObjects(): void {
    const patches = new Map<string, ObjectEntity>();
    for (const e of this.entities.values()) {
      if (e.kind !== 'scenery') continue;
      if (e.defKey === 'agility_obstacle') {
        const obstacle = obstacleAt(e.x, e.y);
        if (obstacle) e.name = OBSTACLE_KINDS[obstacle.type].name;
      } else if (e.defKey === 'glyph_shrine') {
        const glyph = glyphForArea(areaAt(this.map, e.x, e.y)?.name);
        if (glyph) e.name = `${ITEMS[glyph.item].name.replace(/ glyph$/, '')} shrine`;
      } else if (e.defKey === 'farming_patch') patches.set(`${e.x},${e.y}`, e);
    }
    const seen = new Set<string>();
    for (const [start, first] of patches) {
      if (seen.has(start)) continue;
      const group: ObjectEntity[] = [];
      const queue = [first];
      seen.add(start);
      while (queue.length) {
        const p = queue.pop()!;
        group.push(p);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const k = `${p.x + dx},${p.y + dy}`;
          const next = patches.get(k);
          if (next && !seen.has(k)) {
            seen.add(k);
            queue.push(next);
          }
        }
      }
      const kind: PatchKind = group.length >= ALLOTMENT_SIZE ? 'allotment' : 'herb';
      for (const p of group) {
        p.patch = kind;
        p.name = PATCH_KINDS[kind].name;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Stations, banks and shops
  // -------------------------------------------------------------------------

  private usable(target: ObjectEntity): boolean {
    if (target.kind === 'station') return STATIONS.includes(target.defKey) || target.defKey === 'bank_booth';
    return isBanker(this.map.defs.npcs[target.defKey]) || !!shopForNpc(target.defKey);
  }

  /** Opens the window for a station, banker or shopkeeper once the player is next to it. */
  private arriveToUse(player: PlayerEntity): void {
    const action = player.action;
    if (action?.kind !== 'use') return;
    player.action = null;
    const target = this.entities.get(action.targetId);
    if (!target || (target.kind !== 'station' && target.kind !== 'npc')) return;
    // Bankers stand behind their booths, so allow a counter between.
    const reach = target.kind === 'npc' ? 2 : 1;
    if (Math.max(Math.abs(target.x - player.x), Math.abs(target.y - player.y)) > reach) return;
    if (target.defKey === 'bank_booth' || isBanker(this.map.defs.npcs[target.defKey])) {
      player.ui = { kind: 'bank', at: target.id };
      return;
    }
    if (target.kind === 'npc') {
      const shop = shopForNpc(target.defKey);
      if (shop) player.ui = { kind: 'shop', shopId: shop.id, at: target.id };
      return;
    }
    if (target.defKey === 'altar') return this.pray(player);
    const station = (COOKING_FIRES.includes(target.defKey) ? 'range' : target.defKey) as StationKind;
    if (station === 'anvil' && !hasItem(player.inventory, 'hammer')) {
      this.message(player.id, 'You need a hammer to work the metal with.', 'warn');
      return;
    }
    player.ui = { kind: 'craft', station, at: target.id };
  }

  /** Kneeling at an altar fills your prayer points again. */
  private pray(player: PlayerEntity): void {
    const max = levelForXp(player.skills.prayer);
    this.animate(player, 'pray');
    if (player.prayer >= max) return this.message(player.id, 'You pray at the altar. Your prayer points are already full.');
    player.prayer = max;
    this.message(player.id, 'You kneel and pray. You feel your prayer points return.');
  }

  /** Light logs from the pack where you stand. It may take a few strikes to catch. */
  private startLight(player: PlayerEntity, slot: number): void {
    const stack = this.slot(player, slot);
    const burn = stack ? ITEMS[stack.itemId].burn : undefined;
    if (!stack || !burn) return;
    this.stopActions(player);
    player.path = [];
    player.destination = null;
    if (!hasItem(player.inventory, 'tinderbox')) return this.message(player.id, 'You need a tinderbox to light a fire.', 'warn');
    if (levelForXp(player.skills.firemaking) < burn.level) {
      return this.message(player.id, `You need a Firemaking level of ${burn.level} to light ${ITEMS[stack.itemId].name.toLowerCase()}.`, 'warn');
    }
    if (!this.canLightHere(player)) return this.message(player.id, "You can't light a fire here.", 'warn');
    this.message(player.id, 'You strike the tinderbox over the logs...');
    player.action = { kind: 'light', itemId: stack.itemId, nextAttempt: this.tick + 1 };
  }

  /** Fires go on open ground: not on another fire, and not in banks, shops or town squares. */
  private canLightHere(at: Point): boolean {
    for (const e of this.entities.values()) if (e.kind === 'station' && e.x === at.x && e.y === at.y) return false;
    return !this.map.areas.some((a) => /bank|square|keep|chapel|inn|store|bourse|market/i.test(a.name) && at.x >= a.x && at.y >= a.y && at.x < a.x + a.w && at.y < a.y + a.h);
  }

  private lightStep(player: PlayerEntity): void {
    const action = player.action;
    if (action?.kind !== 'light' || this.tick < action.nextAttempt) return;
    const burn = ITEMS[action.itemId].burn!;
    if (!hasItem(player.inventory, action.itemId) || !hasItem(player.inventory, 'tinderbox')) return void (player.action = null);
    action.nextAttempt = this.tick + 1;
    const level = levelForXp(player.skills.firemaking);
    if (!this.rng.chance(Math.min(1, 0.4 + (level - burn.level) * 0.03))) return;
    player.action = null;
    removeItem(player.inventory, action.itemId, 1);
    const id = this.allocateId();
    this.entities.set(id, { id, kind: 'station', defKey: 'fire', name: 'Fire', x: player.x, y: player.y, burnsUntil: this.tick + this.rng.int(FIRE_TICKS[0], FIRE_TICKS[1]) });
    this.grid.blocked[this.grid.index(player.x, player.y)] = 1;
    this.addXp(player, 'firemaking', burn.xp);
    this.message(player.id, 'The fire catches and the logs begin to burn.');
    // Step off the fire: west first, as fire-lighters always have.
    const step = [[-1, 0], [1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: player.x + dx, y: player.y + dy })).find((p) => this.grid.isWalkable(p.x, p.y));
    if (step) {
      player.path = [step];
      player.destination = step;
    }
  }

  /** A fire dies down to a heap of ashes. */
  private burnOut(fire: ObjectEntity): void {
    this.entities.delete(fire.id);
    this.grid.blocked[this.grid.index(fire.x, fire.y)] = 0;
    this.spawnItem('ashes', 1, fire, undefined, 0, GROUND_ITEM_TICKS);
  }

  /** Using an item on its own: knives, logs and feathers open the fletching window, herbs and vials the herblore one, anywhere. */
  private useItem(player: PlayerEntity, slot: number, wanted?: PackStation): void {
    const stack = this.slot(player, slot);
    if (!stack) return;
    if (stack.itemId === 'contract_stone') return this.checkBounty(player);
    const stations = packStations(stack.itemId);
    const station = wanted && stations.includes(wanted) ? wanted : stations[0];
    if (!station) {
      this.message(player.id, 'Nothing interesting happens.');
      return;
    }
    if (station === 'herblore' && !this.knowsHerblore(player)) return;
    this.stopActions(player);
    player.path = [];
    player.destination = null;
    // No station needed: the window is "at" the player.
    player.ui = { kind: 'craft', station, at: player.id };
  }

  private startCraft(player: PlayerEntity, recipeId: string, qty: number): void {
    const recipe = RECIPE_BY_ID[recipeId];
    if (player.ui?.kind !== 'craft' || !recipe || recipe.station !== player.ui.station) return;
    if (!Number.isInteger(qty) || qty < 1) return;
    const stationId = player.ui.at;
    player.ui = null;
    player.action = { kind: 'craft', stationId, recipeId, remaining: Math.min(qty, 1000), nextAttempt: this.tick + 1 };
  }

  private craftStep(player: PlayerEntity): void {
    const action = player.action;
    if (action?.kind !== 'craft' || this.tick < action.nextAttempt) return;
    const recipe = RECIPE_BY_ID[action.recipeId];
    const station = this.entities.get(action.stationId);
    if (!recipe || !station || !this.adjacent(player, station)) return void (player.action = null);
    const level = levelForXp(player.skills[recipe.skill]);
    const output = ITEMS[recipe.output].name;
    if (level < recipe.level) {
      this.message(player.id, `You need a ${this.skillName(recipe.skill)} level of ${recipe.level} to make ${aOrSome(output.toLowerCase())}.`, 'warn');
      return void (player.action = null);
    }
    if (recipe.station === 'anvil' && !hasItem(player.inventory, 'hammer')) {
      this.message(player.id, 'You need a hammer to work the metal with.', 'warn');
      return void (player.action = null);
    }
    if (recipe.tool && !hasItem(player.inventory, recipe.tool)) {
      this.message(player.id, `You need ${aOrSome(ITEMS[recipe.tool].name.toLowerCase())} to fletch that.`, 'warn');
      return void (player.action = null);
    }
    // Batches of one-for-one parts (15 shafts and 15 feathers) can be made short with whatever is carried.
    const made = this.batchSize(player, recipe);
    const scale = made / (recipe.outputQty ?? 1);
    const missing = recipe.inputs.find((i) => !hasItem(player.inventory, i.itemId, Math.max(1, i.qty * scale)));
    if (missing || made < 1) {
      const item = missing ?? recipe.inputs[0];
      if (!action.started) this.message(player.id, `You don't have enough ${ITEMS[item.itemId].name.toLowerCase()} to make that.`, 'warn');
      return void (player.action = null);
    }

    // Check the result will fit once the inputs are used, before using them.
    const after = player.inventory.map((s) => s && { ...s });
    for (const input of recipe.inputs) removeItem(after, input.itemId, input.qty * scale);
    if (!canAdd(after, recipe.output, made)) {
      this.message(player.id, "You don't have enough inventory space.", 'warn');
      return void (player.action = null);
    }

    action.started = true;
    for (const input of recipe.inputs) removeItem(player.inventory, input.itemId, input.qty * scale);
    if (recipe.burnt && this.rng.chance(burnChance(recipe, level))) {
      addItem(player.inventory, recipe.burnt);
      this.message(player.id, `You accidentally burn the ${output.toLowerCase()}.`);
    } else {
      addItem(player.inventory, recipe.output, made);
      this.message(player.id, CRAFT_TEXT[recipe.station](made > 1 ? `${made} ${output.toLowerCase()}` : output.toLowerCase()));
      if (recipe.xp > 0) this.addXp(player, recipe.skill, Math.round(recipe.xp * scale * 10) / 10);
    }
    action.remaining--;
    action.nextAttempt = this.tick + recipe.ticks;
    if (action.remaining <= 0) player.action = null;
  }

  /** Whether the player has this kind of window open and is still beside whatever opened it. */
  private uiOpen(player: PlayerEntity, kind: 'bank' | 'shop'): boolean {
    const ui = player.ui;
    if (ui?.kind !== kind) return false;
    const at = this.entities.get(ui.at);
    if (at && Math.max(Math.abs(at.x - player.x), Math.abs(at.y - player.y)) <= 2) return true;
    player.ui = null;
    return false;
  }

  private bankDeposit(player: PlayerEntity, slot: number, qty: number): void {
    if (!this.uiOpen(player, 'bank')) return;
    const stack = this.slot(player, slot);
    if (!stack || !Number.isInteger(qty) || qty < 1) return;
    const itemId = stack.itemId;
    const moved = removeItem(player.inventory, itemId, Math.min(qty, countItem(player.inventory, itemId)));
    const banked = player.bank.find((b) => b.itemId === itemId);
    if (banked) banked.qty += moved;
    else player.bank.push({ itemId, qty: moved });
  }

  private bankWithdraw(player: PlayerEntity, index: number, qty: number): void {
    if (!this.uiOpen(player, 'bank')) return;
    const banked = Number.isInteger(index) ? player.bank[index] : undefined;
    if (!banked || !Number.isInteger(qty) || qty < 1) return;
    const n = Math.min(qty, banked.qty, roomFor(player.inventory, banked.itemId));
    if (n <= 0) {
      this.message(player.id, "You don't have enough inventory space.", 'warn');
      return;
    }
    addItem(player.inventory, banked.itemId, n);
    banked.qty -= n;
    if (banked.qty === 0) player.bank.splice(index, 1);
  }

  private shopBuy(player: PlayerEntity, itemId: string, qty: number): void {
    if (!this.uiOpen(player, 'shop') || player.ui?.kind !== 'shop') return;
    const shop = SHOPS[player.ui.shopId];
    if (!shop.stock.includes(itemId) || !Number.isInteger(qty) || qty < 1) return;
    const price = ITEMS[itemId].value;
    const coins = countItem(player.inventory, 'coins');
    const affordable = Math.floor(coins / price);
    if (affordable < 1) {
      this.message(player.id, "You don't have enough coins.", 'warn');
      return;
    }
    // Spending every coin frees the coins' slot, so count it as space.
    const room = roomFor(player.inventory, itemId) + (coins === price * Math.min(qty, affordable) && !ITEMS[itemId].stackable ? 1 : 0);
    const n = Math.min(qty, affordable, room);
    if (n < 1) {
      this.message(player.id, "You don't have enough inventory space.", 'warn');
      return;
    }
    removeItem(player.inventory, 'coins', n * price);
    addItem(player.inventory, itemId, n);
  }

  private shopSell(player: PlayerEntity, slot: number, qty: number): void {
    if (!this.uiOpen(player, 'shop') || player.ui?.kind !== 'shop') return;
    const shop = SHOPS[player.ui.shopId];
    const stack = this.slot(player, slot);
    if (!stack || !Number.isInteger(qty) || qty < 1) return;
    if (!shopBuys(shop, stack.itemId)) {
      this.message(player.id, "The shop isn't interested in buying that.", 'warn');
      return;
    }
    const price = Math.floor(ITEMS[stack.itemId].value * SELL_RATE);
    const n = removeItem(player.inventory, stack.itemId, Math.min(qty, countItem(player.inventory, stack.itemId)));
    if (n * price > 0) addItem(player.inventory, 'coins', n * price);
  }

  private uiView(player: PlayerEntity): UiView | null {
    const ui = player.ui;
    if (!ui) return null;
    if (ui.kind === 'dialogue') {
      const page = ui.pages[ui.index];
      const npc = this.entities.get(ui.at);
      return {
        kind: 'dialogue',
        npcId: ui.at,
        speaker: page.speaker,
        name: page.speaker === 'player' ? player.name : npc && npc.kind !== 'item' ? this.nameFor(npc, player) : '',
        text: page.text,
        ...(page.options && { options: page.options.map((o) => o.label) }),
      };
    }
    if (ui.kind === 'bank') return { kind: 'bank', items: player.bank.map((b) => ({ ...b })) };
    if (ui.kind === 'build') return this.buildView(player, ui.at);
    if (ui.kind === 'shop') {
      const shop = SHOPS[ui.shopId];
      return {
        kind: 'shop',
        shopId: shop.id,
        name: shop.name,
        stock: shop.stock.map((itemId) => ({ itemId, price: ITEMS[itemId].value })),
        buys: shop.buys === 'all' ? 'all' : [...new Set([...shop.buys, ...shop.stock])],
        sellRate: SELL_RATE,
      };
    }
    return {
      kind: 'craft',
      title: STATION_TITLES[ui.station],
      recipes: RECIPES.filter((r) => r.station === ui.station).map((r) => ({
        id: r.id,
        output: r.output,
        outputQty: r.outputQty ?? 1,
        ...(r.tool ? { tool: r.tool } : {}),
        level: r.level,
        skill: r.skill,
        xp: r.xp,
        inputs: r.inputs.map((i) => ({ ...i })),
      })),
    };
  }

  /** What a player is visibly doing, for other clients' animations. */
  private activityOf(player: PlayerEntity): { target: Entity; activity: Activity } | null {
    const a = player.action;
    if (a?.kind === 'gather' && a.started) {
      const target = this.entities.get(a.targetId);
      const data = target?.kind === 'resource' ? RESOURCE_DATA[target.defKey] : undefined;
      return target && data ? { target, activity: data.verb } : null;
    }
    if (a?.kind === 'craft' && a.started) {
      const target = this.entities.get(a.stationId);
      const recipe = RECIPE_BY_ID[a.recipeId];
      if (!target || !recipe) return null;
      const activity = ({ furnace: 'smelt', anvil: 'smith', range: 'cook', fletching: 'fletch', herblore: 'mix' } as const)[recipe.station];
      return { target, activity };
    }
    // Kneeling at your own feet, striking the tinderbox.
    if (a?.kind === 'light') return { target: player, activity: 'light' };
    if (a?.kind === 'clean') return { target: player, activity: 'clean' };
    if (a?.kind === 'offer' && a.started) {
      const altar = this.entities.get(a.targetId);
      return altar ? { target: altar, activity: 'offer' } : null;
    }
    if (a?.kind === 'inscribe' && a.started) {
      const shrine = this.entities.get(a.targetId);
      return shrine ? { target: shrine, activity: 'inscribe' } : null;
    }
    if (a?.kind === 'teleport' && !a.departed && !a.place) return { target: player, activity: 'recall' };
    if (a?.kind === 'home' && a.task === 'build' && a.doneAt !== undefined) {
      const spot = this.entities.get(a.targetId);
      return spot ? { target: spot, activity: 'build' } : null;
    }
    if (a?.kind === 'farm' && a.task && a.task !== 'compost' && a.task !== 'cure') {
      const patch = this.entities.get(a.targetId);
      if (!patch || patch.kind !== 'scenery') return null;
      const activity = a.task === 'harvest' ? (patch.patch === 'herb' ? 'pick' : 'dig') : a.task === 'clear' ? 'dig' : a.task;
      return { target: patch, activity };
    }
    return null;
  }

  private addXp(player: PlayerEntity, skill: SkillId, amount: number): void {
    const before = levelForXp(player.skills[skill]);
    player.skills[skill] = Math.min(MAX_XP, Math.round((player.skills[skill] + amount) * 10) / 10);
    const after = levelForXp(player.skills[skill]);
    if (skill === 'hitpoints' && player.deadUntil === undefined) player.hp += after - before;
    const session = this.sessions.get(player.id);
    session?.outbox.push({ type: 'xpDrop', skill, amount });
    if (after > before) {
      session?.outbox.push({ type: 'levelUp', skill, level: after });
      const name = SKILLS.find((s) => s.id === skill)!.name;
      const article = /^[AEIOU]/.test(name) ? 'an' : 'a';
      this.message(player.id, `Congratulations, you've just advanced ${article} ${name} level. You are now level ${after}.`, 'levelup');
    }
  }

  // -------------------------------------------------------------------------
  // Conversations and quests
  // -------------------------------------------------------------------------

  /** Starts a conversation once the player is next to whoever they want to talk to. */
  private arriveToTalk(player: PlayerEntity): void {
    const action = player.action;
    if (action?.kind !== 'talk') return;
    player.action = null;
    const target = this.entities.get(action.targetId);
    if (target?.kind !== 'npc') return;
    // People behind counters can be talked to across them.
    if (Math.max(Math.abs(target.x - player.x), Math.abs(target.y - player.y)) > 2) return;
    const def = this.map.defs.npcs[target.defKey];
    if (!def) return;
    this.showPages(player, target.id, conversation(def, this.talkActions(player, target)));
  }

  /** Shows the first of `pages`, or ends the conversation when there are none. */
  private showPages(player: PlayerEntity, at: EntityId, pages: ReturnType<typeof conversation>): void {
    // An option like "Let's trade" opens another window instead of more talk.
    if (player.ui && player.ui.kind !== 'dialogue') return;
    if (!pages.length) {
      player.ui = null;
      return;
    }
    player.ui = { kind: 'dialogue', at, pages, index: 0 };
    pages[0].effect?.();
  }

  private dialogueChoice(player: PlayerEntity, option: number): void {
    const ui = player.ui;
    if (ui?.kind !== 'dialogue' || !Number.isInteger(option)) return;
    const page = ui.pages[ui.index];
    if (page.options) {
      const chosen = page.options[option];
      if (!chosen) return;
      // Cleared first, so a choice that opens a shop or bank isn't overwritten.
      player.ui = null;
      const npc = this.entities.get(ui.at);
      const pages = chosen.then();
      if (player.ui === null && npc) this.showPages(player, ui.at, pages);
      return;
    }
    ui.index++;
    if (ui.index >= ui.pages.length) {
      player.ui = null;
      return;
    }
    ui.pages[ui.index].effect?.();
  }

  /** What a conversation with `npc` may do for this player. */
  private talkActions(player: PlayerEntity, npc: ObjectEntity): TalkActions {
    const def = this.map.defs.npcs[npc.defKey];
    const shop = shopForNpc(npc.defKey);
    const carried = () => [...player.inventory, player.equipment.weapon ? { itemId: player.equipment.weapon, qty: 1 } : null];
    return {
      playerName: player.name,
      stage: (quest) => player.quests[quest] ?? 0,
      setStage: (quest, stage) => this.setQuestStage(player, quest, stage),
      has: (itemId, qty = 1) => hasItem(player.inventory, itemId, qty),
      hasTool: (skill) => hasAnyTool(carried(), skill),
      take: (itemId, qty = 1) => hasItem(player.inventory, itemId, qty) && removeItem(player.inventory, itemId, qty) === qty,
      give: (itemId, qty = 1) => {
        if (!addItem(player.inventory, itemId, qty)) this.spawnItem(itemId, qty, player, player.id, PRIVATE_TICKS, GROUND_ITEM_TICKS);
      },
      complete: (quest) => this.completeQuest(player, quest),
      ...(shop && { trade: () => void (player.ui = { kind: 'shop', shopId: shop.id, at: npc.id }) }),
      ...(isBanker(def) && { bank: () => void (player.ui = { kind: 'bank', at: npc.id }) }),
      bounty: this.bountyActions(player),
      homestead: {
        owned: () => player.homestead.owned,
        buyPlot: () => {
          if (player.homestead.owned) return 'owned';
          if (!hasItem(player.inventory, 'coins', HOMESTEAD.plotPrice)) return 'coins';
          removeItem(player.inventory, 'coins', HOMESTEAD.plotPrice);
          player.homestead.owned = true;
          this.message(player.id, 'You now own the homestead plot outside Falcrest\'s south gate.', 'quest');
          return 'ok';
        },
      },
      sawmill: { make: (logs) => this.makePlanks(player, logs) },
      ferry: {
        cross: (to) => {
          if (!hasItem(player.inventory, 'coins', FERRY.fare)) return 'coins';
          removeItem(player.inventory, 'coins', FERRY.fare);
          const stop = FERRY.stops[to];
          player.path = [];
          player.destination = null;
          player.action = { kind: 'teleport', spell: 'ferry', to: this.openTileNear(stop), departAt: this.tick, arriveAt: this.tick + FERRY.ticks, place: stop.name, ferry: true };
          this.message(player.id, `You pay ${FERRY.fare} coins and step aboard the ferry.`);
          return 'ok';
        },
      },
    };
  }

  private setQuestStage(player: PlayerEntity, quest: QuestId, stage: number): void {
    const before = player.quests[quest] ?? 0;
    player.quests[quest] = stage;
    if (before === 0 && stage > 0) this.message(player.id, `You have started a new quest: ${QUESTS[quest].name}. Check the Quests tab to see what to do next.`, 'quest');
    else if (stage > before) this.message(player.id, 'Your quest journal has been updated.', 'quest');
  }

  private completeQuest(player: PlayerEntity, quest: QuestId): void {
    const q = QUESTS[quest];
    if ((player.quests[quest] ?? 0) >= doneStage(q)) return;
    player.quests[quest] = doneStage(q);
    for (const [itemId, qty] of q.reward.items) {
      if (!addItem(player.inventory, itemId, qty)) this.spawnItem(itemId, qty, player, player.id, PRIVATE_TICKS, GROUND_ITEM_TICKS);
    }
    for (const [skill, xp] of q.reward.xp) this.addXp(player, skill, xp);
    this.message(player.id, `Congratulations! You have completed ${q.name}.`, 'quest');
    this.sessions.get(player.id)?.outbox.push({ type: 'questComplete', name: q.name, rewards: q.rewards, questPoints: this.questPoints(player) });
  }

  private questPoints(player: PlayerEntity): number {
    return QUEST_IDS.filter((id) => (player.quests[id] ?? 0) >= doneStage(QUESTS[id])).length;
  }

  /** Kills that move a quest on. */
  private questKill(player: PlayerEntity, monster: MonsterEntity): void {
    const defKey = monster.defKey;
    // The Emir's seal, the barrow-king's circlet and Pike's lure turn up on about one kill in three.
    for (const d of QUEST_DROPS) {
      if (defKey !== d.monster || player.quests[d.quest] !== d.stage || !this.rng.chance(d.chance)) continue;
      this.spawnItem(d.item, 1, monster, player.id, GROUND_ITEM_TICKS, GROUND_ITEM_TICKS);
      this.setQuestStage(player, d.quest, d.stage + 1);
      this.message(player.id, d.message, 'quest');
    }
    if (defKey === 'gloam_hart' && player.quests.the_gloaming === 3) {
      this.setQuestStage(player, 'the_gloaming', 4);
      this.message(player.id, 'The Gloam Hart falls, and the shadows of the glade fall back with it. Vessa will want to hear.', 'quest');
    }
    if (defKey === 'goblin' && player.quests.first_oath === 4) {
      this.setQuestStage(player, 'first_oath', 5);
      this.message(player.id, "That's the goblin beaten. Elder Maren will want to hear about it.", 'quest');
    }
  }

  // -------------------------------------------------------------------------
  // Bounty
  // -------------------------------------------------------------------------

  /** Bounty creatures can't be fought below their Bounty level. Says so, and returns true, when that's the case. */
  private bountyLocked(player: PlayerEntity, monster: MonsterEntity): boolean {
    const need = MONSTERS[monster.defKey]?.bounty?.level;
    if (!need || levelForXp(player.skills.bounty) >= need) return false;
    this.message(player.id, `You need a Bounty level of ${need} to know how to fight ${aOrSome(monster.name.toLowerCase())}.`, 'warn');
    return true;
  }

  /** The bounty helm sharpens every blow against whatever you're hunting. */
  private helmed(player: PlayerEntity, monster: MonsterEntity, f: Fighter): Fighter {
    if (player.equipment.helmet !== 'bounty_helm' || player.bounty.task?.monster !== monster.defKey) return f;
    const k = 1 + BOUNTY.helmBonus;
    return { ...f, attack: Math.floor(f.attack * k), strength: Math.floor(f.strength * k) };
  }

  /** A kill on task: Bounty XP for the creature's hitpoints, and the task counts down. */
  private bountyKill(player: PlayerEntity, monster: MonsterEntity): void {
    const task = player.bounty.task;
    if (task?.monster !== monster.defKey) return;
    this.addXp(player, 'bounty', MONSTERS[monster.defKey].hitpoints * BOUNTY.xpPerHp);
    task.left--;
    if (task.left > 0) return;
    delete player.bounty.task;
    player.bounty.done++;
    const points = pointsFor(player.bounty.done);
    player.bounty.points += points;
    this.message(player.id, `You've finished your bounty and earned ${points} points (${player.bounty.points} in all). Hrolf will have another.`, 'quest');
  }

  /** The contract stone: how the bounty is going. */
  private checkBounty(player: PlayerEntity): void {
    const task = player.bounty.task;
    const points = `You have ${player.bounty.points} bounty points.`;
    this.message(player.id, task ? `Your bounty: ${task.left} ${taskName(task.monster)} still to go, out of ${task.total}. ${points}` : `You have no bounty. Hrolf, in Brakk Village, hands them out. ${points}`);
  }

  private bountyActions(player: PlayerEntity): NonNullable<TalkActions['bounty']> {
    // A new task after a skip is never the one just dropped.
    let last = player.bounty.task?.monster;
    return {
      task: () => player.bounty.task ?? null,
      points: () => player.bounty.points,
      assign: () => {
        const task = pickTask(combatLevel(player.skills), levelForXp(player.skills.bounty), this.rng, last);
        if (task) {
          player.bounty.task = task;
          last = task.monster;
        }
        return task;
      },
      skip: () => {
        if (!player.bounty.task || player.bounty.points < BOUNTY.skipCost) return false;
        player.bounty.points -= BOUNTY.skipCost;
        delete player.bounty.task;
        return true;
      },
      buy: (itemId) => {
        const reward = BOUNTY.rewards.find((r) => r.item === itemId);
        if (!reward || player.bounty.points < reward.points) return 'points';
        if (!canAdd(player.inventory, itemId, 1)) return 'space';
        player.bounty.points -= reward.points;
        addItem(player.inventory, itemId, 1);
        return 'ok';
      },
    };
  }

  // -------------------------------------------------------------------------
  // Homesteading
  // -------------------------------------------------------------------------

  /** What clicking a homestead object does: through the gate, or a build spot's build, use or remove. */
  private homeTask(player: PlayerEntity, target: ObjectEntity, action: InteractAction): HomeTask | null {
    if (target.defKey === 'homestead_gate') return action === 'enter' ? 'gate' : null;
    if (target.defKey !== 'build_spot') return null;
    if (action === 'build') return 'plan';
    if (action === 'remove') return 'remove';
    const spot = spotState(player.homestead, `${target.x},${target.y}`);
    return action === 'use' && spot?.tier && FURNITURE[spot.def.kind].use ? 'use' : null;
  }

  private homeStep(player: PlayerEntity): void {
    const action = player.action;
    if (action?.kind !== 'home') return;
    const target = this.entities.get(action.targetId);
    if (target?.kind !== 'scenery') return void (player.action = null);
    if (action.task === 'gate') {
      player.action = null;
      return this.throughGate(player, target);
    }
    if (!this.adjacent(player, target)) {
      player.action = null;
      return this.message(player.id, "I can't reach that.", 'warn');
    }
    const spot = spotState(player.homestead, `${target.x},${target.y}`);
    if (!spot || !player.homestead.owned) {
      player.action = null;
      return this.message(player.id, "This isn't your house to build in.", 'warn');
    }
    if (action.task === 'build') {
      if (this.tick < action.doneAt!) return;
      player.action = null;
      return this.finishBuild(player, target, action.tier!);
    }
    player.action = null;
    if (action.task === 'plan') player.ui = { kind: 'build', at: target.id };
    else if (action.task === 'remove') this.removeFurniture(player, target);
    else this.useFurniture(player, target);
  }

  /** The homestead gate opens for its owner: a step through to the other side. */
  private throughGate(player: PlayerEntity, gate: ObjectEntity): void {
    const dx = gate.x - player.x;
    const dy = gate.y - player.y;
    if (Math.abs(dx) + Math.abs(dy) !== 1) return this.message(player.id, "I can't reach that.", 'warn');
    if (!player.homestead.owned) {
      return this.message(player.id, 'The gate is locked. The plot is for sale: Corwin, the estate agent in Falcrest, has the key.', 'warn');
    }
    const to = { x: gate.x + dx, y: gate.y + dy };
    if (!this.grid.isWalkable(to.x, to.y)) return;
    player.via = { x: gate.x, y: gate.y };
    player.x = to.x;
    player.y = to.y;
  }

  /** Whether this tier can be built at a spot now; says why not when it can't. */
  private canBuild(player: PlayerEntity, spot: NonNullable<ReturnType<typeof spotState>>, tier: number): boolean {
    const t = FURNITURE[spot.def.kind].tiers[tier - 1];
    const warn = (text: string) => (this.message(player.id, text, 'warn'), false);
    if (!spot.room) return warn(`You need to fit out the ${ROOMS[spot.def.room].name.toLowerCase()} before you can build in it.`);
    if (spot.tier === tier) return warn(`There's already ${aOrSome(t.name.toLowerCase())} here.`);
    if (levelForXp(player.skills.homesteading) < t.level) return warn(`You need a Homesteading level of ${t.level} to build ${aOrSome(t.name.toLowerCase())}.`);
    if (!hasItem(player.inventory, 'hammer') || !hasItem(player.inventory, 'saw')) return warn('You need a hammer and a saw to build anything.');
    const short = t.materials.find(([itemId, qty]) => !hasItem(player.inventory, itemId, qty));
    if (short) return warn(`You need ${short[1]} ${ITEMS[short[0]].name.toLowerCase()}${short[1] > 1 && !ITEMS[short[0]].name.endsWith('s') ? 's' : ''} to build ${aOrSome(t.name.toLowerCase())}.`);
    return true;
  }

  /** Picked in the build window: start building, done a few ticks later. */
  private startBuild(player: PlayerEntity, tier: number): void {
    const ui = player.ui;
    if (ui?.kind !== 'build' || !Number.isInteger(tier)) return;
    const target = this.entities.get(ui.at);
    if (target?.kind !== 'scenery' || !this.adjacent(player, target)) return;
    const spot = spotState(player.homestead, `${target.x},${target.y}`);
    if (!spot || !FURNITURE[spot.def.kind].tiers[tier - 1] || !this.canBuild(player, spot, tier)) return;
    player.ui = null;
    player.action = { kind: 'home', targetId: target.id, task: 'build', tier, doneAt: this.tick + HOMESTEAD.buildTicks };
  }

  private finishBuild(player: PlayerEntity, target: ObjectEntity, tier: number): void {
    const key = `${target.x},${target.y}`;
    const spot = spotState(player.homestead, key);
    if (!spot || !this.canBuild(player, spot, tier)) return;
    const t = FURNITURE[spot.def.kind].tiers[tier - 1];
    for (const [itemId, qty] of t.materials) removeItem(player.inventory, itemId, qty);
    player.homestead.built[key] = tier;
    this.addXp(player, 'homesteading', t.xp);
    this.message(player.id, `You build ${aOrSome(t.name.toLowerCase())}.`);
  }

  /** Fits out the room the open build window's spot is in, for coins. */
  private buildRoom(player: PlayerEntity): void {
    const ui = player.ui;
    if (ui?.kind !== 'build') return;
    const target = this.entities.get(ui.at);
    if (target?.kind !== 'scenery' || !this.adjacent(player, target)) return;
    const spot = spotState(player.homestead, `${target.x},${target.y}`);
    if (!spot || spot.room) return;
    const room = ROOMS[spot.def.room];
    if (levelForXp(player.skills.homesteading) < room.level) {
      return this.message(player.id, `You need a Homesteading level of ${room.level} to fit out the ${room.name.toLowerCase()}.`, 'warn');
    }
    if (!hasItem(player.inventory, 'coins', room.coins)) {
      return this.message(player.id, `Fitting out the ${room.name.toLowerCase()} costs ${room.coins.toLocaleString('en-GB')} coins.`, 'warn');
    }
    removeItem(player.inventory, 'coins', room.coins);
    player.homestead.rooms.push(room.id);
    this.message(player.id, `You fit out the ${room.name.toLowerCase()}. Now you can build in it.`);
  }

  private removeFurniture(player: PlayerEntity, target: ObjectEntity): void {
    const key = `${target.x},${target.y}`;
    const spot = spotState(player.homestead, key);
    if (!spot?.tier) return this.message(player.id, "There's nothing built here.");
    delete player.homestead.built[key];
    this.message(player.id, `You take the ${spotName(spot.def.kind, spot.tier).toLowerCase()} down.`);
  }

  private buildView(player: PlayerEntity, at: EntityId): UiView | null {
    const target = this.entities.get(at);
    const spot = target ? spotState(player.homestead, `${target.x},${target.y}`) : null;
    if (!spot) return null;
    const f = FURNITURE[spot.def.kind];
    const room = ROOMS[spot.def.room];
    return {
      kind: 'build',
      title: f.space,
      built: spot.tier,
      room: { name: room.name, built: spot.room, level: room.level, coins: room.coins },
      tiers: f.tiers.map((t) => ({ name: t.name, level: t.level, xp: t.xp, materials: t.materials.map(([itemId, qty]) => ({ itemId, qty })) })),
    };
  }

  /** What built furniture does: cook, pray, take tools, rest, travel or drink. */
  private useFurniture(player: PlayerEntity, target: ObjectEntity): void {
    const spot = spotState(player.homestead, `${target.x},${target.y}`);
    const f = spot ? FURNITURE[spot.def.kind] : undefined;
    const t = spot?.tier ? f?.tiers[spot.tier - 1] : undefined;
    if (!spot || !f?.use || !t) return this.message(player.id, 'Nothing interesting happens.');
    const maxHp = levelForXp(player.skills.hitpoints);
    switch (f.use) {
      case 'range':
        player.ui = { kind: 'craft', station: 'range', at: target.id };
        return;
      case 'altar':
        return this.pray(player);
      case 'tools': {
        const carried = (id: string) => hasItem(player.inventory, id) || player.equipment.weapon === id;
        const missing = t.tools!.filter((id) => !carried(id));
        if (!missing.length) return this.message(player.id, 'You already carry every tool on the rack.');
        const taken = missing.filter((id) => addItem(player.inventory, id, 1));
        if (!taken.length) return this.message(player.id, "You don't have room for any of the tools.", 'warn');
        const names = taken.map((id) => aOrSome(ITEMS[id].name.toLowerCase()));
        return this.message(player.id, `You take ${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]} from the rack.`);
      }
      case 'rest':
        player.energy = 100;
        player.hp = Math.max(player.hp, Math.min(maxHp, player.hp + Math.ceil(maxHp * t.heal!)));
        this.animate(player, 'pray');
        return this.message(player.id, 'You lie down for a moment, and get up refreshed.');
      case 'pool':
        player.energy = 100;
        if (spot.tier >= 2) player.prayer = levelForXp(player.skills.prayer);
        if (spot.tier >= 3) player.hp = Math.max(player.hp, maxHp);
        this.animate(player, 'drink');
        return this.message(player.id, spot.tier >= 3 ? 'The water restores you completely.' : spot.tier >= 2 ? 'The water restores your energy and your prayer.' : 'The cool water restores your energy.');
      case 'portal':
        return this.showPages(player, target.id, [
          {
            speaker: 'npc',
            text: 'The portal shimmers. Where would you like to go?',
            options: [
              ...t.to!.map((id) => ({ label: PORTALS[id].name, then: () => (this.portalTo(player, id), []) })),
              { label: 'Nowhere for now.', then: () => [] },
            ],
          },
        ]);
    }
  }

  /** Stepping through a homestead portal: a teleport with no glyphs and no chant. */
  private portalTo(player: PlayerEntity, id: string): void {
    const place = PORTALS[id];
    player.path = [];
    player.destination = null;
    player.action = { kind: 'teleport', spell: 'portal', to: this.openTileNear(place), departAt: this.tick, arriveAt: this.tick + TELEPORT_TICKS, place: place.name };
  }

  /** Altars multiply Prayer XP: town altars by the usual, homestead altars by their tier and the lamps lit beside them. */
  private altarMultiplier(player: PlayerEntity, target: Entity): number {
    if (target.kind === 'station' && target.defKey === 'altar') return ALTAR_MULTIPLIER;
    if (target.kind !== 'scenery' || target.defKey !== 'build_spot') return 0;
    const spot = spotState(player.homestead, `${target.x},${target.y}`);
    if (!spot?.tier || FURNITURE[spot.def.kind].use !== 'altar') return 0;
    let multiplier = FURNITURE[spot.def.kind].tiers[spot.tier - 1].multiplier!;
    for (const [key, def] of Object.entries(SPOTS)) {
      if (def.room === spot.def.room && def.kind === 'lamp') multiplier += HOMESTEAD.lampBonus * (player.homestead.built[key] ?? 0);
    }
    return multiplier;
  }

  /** Jory cuts every log of a kind carried into planks, for as many as the fee can be paid. */
  private makePlanks(player: PlayerEntity, logs: string): { made: number; short?: 'logs' | 'coins' } {
    const kind = HOMESTEAD.planks.find((p) => p.logs === logs);
    const have = kind ? countItem(player.inventory, logs) : 0;
    if (!kind || !have) return { made: 0, short: 'logs' };
    const made = Math.min(have, Math.floor(countItem(player.inventory, 'coins') / kind.fee));
    if (made) {
      removeItem(player.inventory, logs, made);
      removeItem(player.inventory, 'coins', made * kind.fee);
      addItem(player.inventory, kind.plank, made);
    }
    return made < have ? { made, short: 'coins' } : { made };
  }

  // -------------------------------------------------------------------------
  // Output
  // -------------------------------------------------------------------------

  private message(playerId: EntityId, text: string, kind: GameMessageKind = 'info'): void {
    this.sessions.get(playerId)?.outbox.push({ type: 'gameMessage', text, kind });
  }

  /** Sends a message to every player close enough to see `near`. */
  private broadcast(near: Point, msg: ServerMessage): void {
    for (const [id, session] of this.sessions) {
      const p = this.entities.get(id);
      if (p && Math.max(Math.abs(p.x - near.x), Math.abs(p.y - near.y)) <= VIEW_RADIUS) session.outbox.push(msg);
    }
  }

  private animate(e: Entity, kind: AnimationKind): void {
    this.broadcast(e, { type: 'animation', entityId: e.id, kind });
  }

  private broadcastHit(attacker: Entity, target: Entity, damage: number, hp: number, maxHp: number, spell?: HitSpell): void {
    this.broadcast(target, { type: 'hit', attackerId: attacker.id, targetId: target.id, damage, hp: Math.max(0, hp), maxHp, ...(spell && { spell }) });
  }

  private reject(playerId: EntityId, reason: string): void {
    this.sessions.get(playerId)?.outbox.push({ type: 'reject', reason });
  }

  /** What a player can see: everything within VIEW_RADIUS, less respawning monsters and other people's private drops. */
  private visibleTo(player: PlayerEntity): PublicEntity[] {
    const out: PublicEntity[] = [];
    for (const e of this.entities.values()) {
      if (e.id !== player.id && Math.max(Math.abs(e.x - player.x), Math.abs(e.y - player.y)) > VIEW_RADIUS) continue;
      if (e.kind === 'monster' && e.respawnAt !== undefined) continue;
      if (e.kind === 'item' && !this.canSeeItem(e, player.id)) continue;
      out.push(this.toPublic(e, player));
    }
    return out;
  }

  /** How `e` looks to `viewer`: a farming patch shows the viewer's own crop. */
  private toPublic(e: Entity, viewer: PlayerEntity): PublicEntity {
    if (e.kind === 'player') {
      const work = this.activityOf(e);
      const fighting = e.action?.kind === 'attack' ? e.action.targetId : e.attackedBy;
      const overhead = (['ward_of_blades', 'ward_of_spells', 'ember_ward'] as const).find((p) => e.prayers.includes(p));
      const crossing = e.action?.kind === 'cross' && e.action.started ? this.crossingView(e.action) : undefined;
      return {
        id: e.id,
        kind: e.kind,
        x: e.x,
        y: e.y,
        name: e.name,
        combatLevel: combatLevel(e.skills),
        hp: e.hp,
        maxHp: levelForXp(e.skills.hitpoints),
        ...(Object.keys(e.equipment).length && { gear: { ...e.equipment } }),
        ...(fighting !== null && { interacting: fighting }),
        ...(e.deadUntil !== undefined && { dead: true }),
        ...(work && { workingOn: nearestTile(work.target, e), activity: work.activity }),
        ...(overhead && { overhead }),
        ...(e.via && { via: { ...e.via } }),
        ...(crossing && { crossing }),
      };
    }
    if (e.kind === 'monster') {
      return {
        id: e.id,
        kind: e.kind,
        x: e.x,
        y: e.y,
        name: e.name,
        defKey: e.defKey,
        combatLevel: e.level,
        hp: e.hp,
        maxHp: e.maxHp,
        ...(e.target !== null && { interacting: e.target }),
        ...(e.dyingUntil !== undefined && { dead: true }),
        ...(MONSTERS[e.defKey]?.summons && this.shrouded(e) && { shrouded: true }),
      };
    }
    if (e.kind === 'item') return { id: e.id, kind: e.kind, x: e.x, y: e.y, name: e.name, defKey: e.itemId, qty: e.qty };
    const spot = e.defKey === 'build_spot' ? spotState(viewer.homestead, `${e.x},${e.y}`) : null;
    return {
      id: e.id,
      kind: e.kind,
      x: e.x,
      y: e.y,
      name: this.nameFor(e, viewer),
      defKey: e.defKey,
      ...(e.size && { size: e.size }),
      ...(e.depletedUntil !== undefined && { depleted: true }),
      ...(e.patch && { patch: patchView(viewer.farm[`${e.x},${e.y}`] ?? overgrown()) }),
      ...(spot && { spot: { kind: spot.def.kind, tier: spot.tier, room: spot.room } }),
    };
  }

  /** An object's name as `viewer` sees it: a build spot is named for what they built there. */
  private nameFor(e: ObjectEntity | PlayerEntity | MonsterEntity, viewer: PlayerEntity): string {
    if (e.kind !== 'scenery' || e.defKey !== 'build_spot') return e.name;
    const spot = spotState(viewer.homestead, `${e.x},${e.y}`);
    return spot ? spotName(spot.def.kind, spot.tier) : e.name;
  }

  private crossingView(action: Extract<PlayerEntity['action'], { kind: 'cross' }>): PublicEntity['crossing'] {
    const target = this.entities.get(action.targetId);
    const obstacle = target ? obstacleAt(target.x, target.y) : undefined;
    if (!obstacle) return undefined;
    const kind = OBSTACLE_KINDS[obstacle.type];
    return {
      obstacle: obstacle.type,
      from: { ...obstacle.from },
      to: action.fall ? { x: obstacle.x, y: obstacle.y } : { ...obstacle.to },
      ms: kind.ticks * TICK_MS,
      ...(action.fall && { fall: true }),
    };
  }

  private flushDeltas(): void {
    for (const [playerId, session] of this.sessions) {
      const player = this.entities.get(playerId) as PlayerEntity;
      const added: PublicEntity[] = [];
      const updated: PublicEntity[] = [];
      const seen = new Set<EntityId>();
      for (const e of this.visibleTo(player)) {
        seen.add(e.id);
        const json = JSON.stringify(e);
        const prev = session.lastSent.get(e.id);
        if (prev === undefined) added.push(e);
        else if (prev !== json) updated.push(e);
        session.lastSent.set(e.id, json);
      }
      const removed = [...session.lastSent.keys()].filter((id) => !seen.has(id));
      for (const id of removed) session.lastSent.delete(id);
      session.outbox.push({ type: 'tick', tick: this.tick, added, updated, removed });
      this.syncSelf(player, session);
    }
  }

  private syncSelf(player: PlayerEntity, session: Session): void {
    const state: SelfState = {
      id: player.id,
      name: player.name,
      skills: { ...player.skills },
      combatLevel: combatLevel(player.skills),
      hp: player.hp,
      maxHp: levelForXp(player.skills.hitpoints),
      destination: player.destination,
      inventory: player.inventory,
      equipment: player.equipment,
      attackStyle: player.attackStyle,
      bonuses: equipmentBonuses(player.equipment),
      maxHit: this.autocastSpell(player)?.maxHit ?? playerMaxHit(this.fighterFor(player)),
      ui: this.uiView(player),
      quests: QUEST_IDS.map((id) => questView(id, player.quests[id] ?? 0)),
      questPoints: this.questPoints(player),
      prayer: Math.ceil(player.prayer),
      prayerMax: levelForXp(player.skills.prayer),
      prayers: [...player.prayers],
      boosts: { ...player.boosts },
      ...(player.firewardUntil !== undefined && { fireward: Math.ceil((player.firewardUntil - this.tick) / 100) }),
      energy: Math.floor(player.energy),
      run: player.run,
      autocast: player.autocast ?? null,
      bounty: {
        ...(player.bounty.task && { task: { name: taskName(player.bounty.task.monster), left: player.bounty.task.left } }),
        points: player.bounty.points,
      },
    };
    const json = JSON.stringify(state);
    if (json === session.lastSelf) return;
    session.lastSelf = json;
    session.outbox.push({ type: 'self', state });
  }

  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------

  private allocateId(): EntityId {
    return this.nextId++;
  }

  private spawnStaticObjects(): void {
    const { defs } = this.map;
    for (const p of this.map.placements) {
      if (p.kind === 'monster') {
        this.spawnMonster(p);
        continue;
      }
      const table = p.kind === 'resource' ? defs.resources : p.kind === 'station' ? defs.stations : p.kind === 'scenery' ? defs.scenery : defs.npcs;
      const entity: ObjectEntity = {
        id: this.allocateId(),
        kind: p.kind,
        defKey: p.defKey,
        name: table[p.defKey].name,
        x: p.x,
        y: p.y,
        ...(p.size && p.size > 1 && { size: p.size }),
      };
      this.entities.set(entity.id, entity);
    }
  }

  private spawnMonster(p: MapData['placements'][number]): void {
    const stats = MONSTERS[p.defKey];
    if (!stats) return;
    const monster: MonsterEntity = {
      id: this.allocateId(),
      kind: 'monster',
      defKey: p.defKey,
      name: this.map.defs.monsters[p.defKey]?.name ?? p.defKey,
      level: p.level ?? this.map.defs.monsters[p.defKey]?.combatLevel ?? 1,
      x: p.x,
      y: p.y,
      hp: stats.hitpoints,
      maxHp: stats.hitpoints,
      spawn: { x: p.x, y: p.y },
      wander: p.wander ?? { cx: p.x, cy: p.y, radius: 3 },
      path: [],
      target: null,
      nextAttack: 0,
      nextWander: this.rng.int(1, 12),
      damageBy: new Map(),
    };
    this.entities.set(monster.id, monster);
  }
}

function alive(m: MonsterEntity): boolean {
  return m.respawnAt === undefined && m.dyingUntil === undefined && m.hp > 0;
}

function distance(a: Point, b: Point): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** Melee reach: straight beside, never diagonal and never on the same tile. */
function inReach(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
}

const CRAFT_TEXT: Record<StationKind, (item: string) => string> = {
  furnace: (item) => `You retrieve ${aOrSome(item)}.`,
  anvil: (item) => `You hammer the metal and make ${aOrSome(item)}.`,
  range: (item) => `You cook the ${item}.`,
  fletching: (item) => (/^\d/.test(item) ? `You make ${item}.` : `You carefully make ${aOrSome(item)}.`),
  herblore: (item) => (item.endsWith('(unf)') ? `You put the herb into the vial of water.` : `You mix the ingredients and make ${aOrSome(item.replace(/ \(3\)$/, ''))}.`),
};

function aOrSome(name: string): string {
  if (name.endsWith('s')) return `some ${name}`;
  return /^[aeiou]/i.test(name) ? `an ${name}` : `a ${name}`;
}

/** The tile of a (possibly multi-tile) object closest to a point. */
function nearestTile(target: { x: number; y: number; size?: number }, from: Point): Point {
  const last = (target.size ?? 1) - 1;
  return {
    x: Math.max(target.x, Math.min(target.x + last, from.x)),
    y: Math.max(target.y, Math.min(target.y + last, from.y)),
  };
}

/** "Potato" to "Potatoes", "Sunleaf" to "Sunleaves"... near enough for crops. */
function plural(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('corn')) return lower;
  if (/(o|ch|sh)$/.test(lower)) return `${lower}es`;
  if (lower.endsWith('y')) return `${lower.slice(0, -1)}ies`;
  return lower.endsWith('s') ? lower : `${lower}s`;
}
