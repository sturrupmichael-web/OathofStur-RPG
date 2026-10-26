import type { MapData, Point } from '../map/types';
import {
  PROTOCOL_VERSION,
  type Activity,
  type ClientMessage,
  type AnimationKind,
  type GameMessageKind,
  type PublicEntity,
  type SelfState,
  type ServerMessage,
  type UiView,
} from '../protocol/messages';
import { Rng } from '../rng';
import {
  ATTACK_STYLES,
  EAT_DELAY,
  MONSTERS,
  REGEN_TICKS,
  WEAPON_SPEED,
  XP_PER_DAMAGE,
  equipmentBonuses,
  hitChance,
  monsterFighter,
  playerFighter,
  playerMaxHit,
  rangedFighter,
  rollQty,
} from './combat';
import { RECIPES, RECIPE_BY_ID, SELL_RATE, SHOPS, STATION_TITLES, burnChance, isBanker, opensFletching, shopBuys, shopForNpc, type StationKind } from './crafting';
import type { Entity, EntityId, GroundItemEntity, MonsterEntity, ObjectEntity, PlayerEntity } from './entities';
import { ATTEMPT_TICKS, EXAMINE, RESOURCE_DATA, gatherChance, requiredLevel } from './gathering';
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
  removeItem,
  roomFor,
  type EquipSlot,
  type ItemStack,
} from './items';
import { findPath } from './pathfinding';
import { QUESTS, QUEST_IDS, conversation, doneStage, questView, type QuestId, type TalkActions } from './quests';
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
const STATIONS: readonly string[] = ['furnace', 'anvil', 'range'];

/** Wording for each kind of gathering. */
const GATHER_TEXT = {
  chop: { start: 'You swing your axe at the tree.', got: (item: string) => `You get some ${item}.`, tool: 'an axe to chop down this tree', what: 'chop this tree' },
  mine: { start: 'You swing your pickaxe at the rock.', got: (item: string) => `You manage to mine some ${item}.`, tool: 'a pickaxe to mine this rock', what: 'mine this rock' },
  net: { start: 'You cast out your net.', got: (item: string) => `You catch some ${item}.`, tool: 'a small fishing net to fish here', what: 'fish here' },
  rod: { start: 'You cast out your line.', got: (item: string) => `You catch a ${item}.`, tool: 'a fishing rod to fish here', what: 'fish here' },
} as const;

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
    };
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
    }
    for (const e of [...this.entities.values()]) {
      if (e.kind === 'player') this.recover(e);
      if (e.kind === 'resource' && e.depletedUntil !== undefined && this.tick >= e.depletedUntil) delete e.depletedUntil;
      if (e.kind === 'item' && this.tick >= e.despawnAt) this.entities.delete(e.id);
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
        this.useItem(player, msg.slot);
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

  private interact(player: PlayerEntity, targetId: EntityId, action: 'gather' | 'take' | 'use' | 'talk'): void {
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
    else {
      const key = target.depletedUntil !== undefined ? `${target.defKey}_stump` : target.defKey;
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

  private movePlayer(player: PlayerEntity): void {
    const next = player.path.shift();
    if (!next) return;
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
      return;
    }
    player.x = next.x;
    player.y = next.y;
    if (!player.path.length) {
      player.destination = null;
      if (player.gateNotice) this.reportGate(player);
    }
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
    if (isBow(player.equipment.weapon)) return this.playerShoot(player, monster);
    const stats = MONSTERS[monster.defKey];
    const attacker = playerFighter(player.skills, player.equipment, player.attackStyle);
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
    const attacker = rangedFighter(player.skills, player.equipment, player.attackStyle, arrow.ammo!.strength);
    const landed = this.rng.chance(hitChance(attacker, monsterFighter(MONSTERS[monster.defKey])));
    const damage = landed ? Math.min(monster.hp, this.rng.int(1, playerMaxHit(attacker))) : 0;
    player.nextAttack = this.tick + (bow.speed ?? WEAPON_SPEED) - (player.attackStyle === 'aggressive' ? 1 : 0);
    this.animate(player, 'shoot');
    if (this.rng.chance(ARROW_SAVE_CHANCE)) this.dropArrow(arrow.id, monster, player.id);
    this.landPlayerHit(player, monster, damage, player.attackStyle === 'defensive' ? [['ranged', 0.5], ['defence', 0.5]] : [['ranged', 1]]);
  }

  /** How a player fights right now: with a bow and their best arrows, or hand to hand. */
  private fighterFor(player: PlayerEntity) {
    if (!isBow(player.equipment.weapon)) return playerFighter(player.skills, player.equipment, player.attackStyle);
    const arrow = bestArrows(player.inventory, levelForXp(player.skills.ranged));
    return rangedFighter(player.skills, player.equipment, player.attackStyle, arrow?.ammo?.strength ?? 0);
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
  private landPlayerHit(player: PlayerEntity, monster: MonsterEntity, damage: number, skills: [SkillId, number][]): void {
    const stats = MONSTERS[monster.defKey];
    monster.hp -= damage;
    monster.damageBy.set(player.id, (monster.damageBy.get(player.id) ?? 0) + damage);
    this.broadcastHit(player, monster, damage, monster.hp, monster.maxHp);
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

  private monsterAttack(monster: MonsterEntity, player: PlayerEntity): void {
    const stats = MONSTERS[monster.defKey];
    if (stats.breath && this.rng.chance(stats.breath.chance)) return this.breathe(monster, player);
    const defender = playerFighter(player.skills, player.equipment, player.attackStyle);
    const landed = this.rng.chance(hitChance(monsterFighter(stats), defender));
    const damage = landed ? Math.min(player.hp, this.rng.int(1, stats.maxHit)) : 0;
    monster.nextAttack = this.tick + stats.attackSpeed;
    this.animate(monster, stats.attackAnim);
    this.landMonsterHit(monster, player, damage);
  }

  /** Fire: it always lands, armour doesn't help, and only a fireward shield takes the edge off. */
  private breathe(monster: MonsterEntity, player: PlayerEntity): void {
    const stats = MONSTERS[monster.defKey];
    const warded = !!(player.equipment.shield && ITEMS[player.equipment.shield]?.fireward);
    const max = warded ? Math.floor(stats.breath!.maxHit / 3) : stats.breath!.maxHit;
    const damage = Math.min(player.hp, this.rng.int(0, max));
    monster.nextAttack = this.tick + stats.attackSpeed;
    this.animate(monster, 'breath');
    if (warded) this.message(player.id, 'Your shield turns most of the fire aside.');
    else if (damage >= max / 2) this.message(player.id, `You are badly burnt by the ${monster.name.toLowerCase()}'s fire.`, 'warn');
    this.landMonsterHit(monster, player, damage);
  }

  private landMonsterHit(monster: MonsterEntity, player: PlayerEntity, damage: number): void {
    player.hp -= damage;
    player.attackedBy = monster.id;
    this.broadcastHit(monster, player, damage, player.hp, levelForXp(player.skills.hitpoints));
    if (player.hp <= 0) return this.playerDies(player);
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
    if (winner?.kind === 'player') this.questKill(winner, monster.defKey);
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
    if (player.hp >= max) player.nextRegen = this.tick + REGEN_TICKS;
    else if (this.tick >= player.nextRegen) {
      player.hp++;
      player.nextRegen = this.tick + REGEN_TICKS;
    }
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
    const skill = equip.style === 'shoot' ? 'ranged' : equip.slot === 'weapon' ? 'attack' : 'defence';
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
      m.nextWander = this.tick + this.rng.int(2, 10);
      this.occupied.add(this.grid.index(m.x, m.y));
      return;
    }
    if (m.dyingUntil !== undefined) {
      if (this.tick < m.dyingUntil) return;
      delete m.dyingUntil;
      this.dropLoot(m);
      this.occupied.delete(this.grid.index(m.x, m.y));
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
    const station = target.defKey as StationKind;
    if (station === 'anvil' && !hasItem(player.inventory, 'hammer')) {
      this.message(player.id, 'You need a hammer to work the metal with.', 'warn');
      return;
    }
    player.ui = { kind: 'craft', station, at: target.id };
  }

  /** Using an item on its own: knives, logs, feathers and the like open the fletching window, anywhere. */
  private useItem(player: PlayerEntity, slot: number): void {
    const stack = this.slot(player, slot);
    if (!stack) return;
    if (!opensFletching(stack.itemId)) {
      this.message(player.id, 'Nothing interesting happens.');
      return;
    }
    this.stopActions(player);
    player.path = [];
    player.destination = null;
    // Fletching needs no station: the window is "at" the player.
    player.ui = { kind: 'craft', station: 'fletching', at: player.id };
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
      this.addXp(player, recipe.skill, Math.round(recipe.xp * scale * 10) / 10);
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
        name: page.speaker === 'player' ? player.name : npc?.kind === 'npc' ? npc.name : '',
        text: page.text,
        ...(page.options && { options: page.options.map((o) => o.label) }),
      };
    }
    if (ui.kind === 'bank') return { kind: 'bank', items: player.bank.map((b) => ({ ...b })) };
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
      const activity = ({ furnace: 'smelt', anvil: 'smith', range: 'cook', fletching: 'fletch' } as const)[recipe.station];
      return { target, activity };
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
  private questKill(player: PlayerEntity, defKey: string): void {
    if (defKey === 'goblin' && player.quests.first_oath === 4) {
      this.setQuestStage(player, 'first_oath', 5);
      this.message(player.id, "That's the goblin beaten. Elder Maren will want to hear about it.", 'quest');
    }
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

  private broadcastHit(attacker: Entity, target: Entity, damage: number, hp: number, maxHp: number): void {
    this.broadcast(target, { type: 'hit', attackerId: attacker.id, targetId: target.id, damage, hp: Math.max(0, hp), maxHp });
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
      out.push(this.toPublic(e));
    }
    return out;
  }

  private toPublic(e: Entity): PublicEntity {
    if (e.kind === 'player') {
      const work = this.activityOf(e);
      const fighting = e.action?.kind === 'attack' ? e.action.targetId : e.attackedBy;
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
      };
    }
    if (e.kind === 'item') return { id: e.id, kind: e.kind, x: e.x, y: e.y, name: e.name, defKey: e.itemId, qty: e.qty };
    return {
      id: e.id,
      kind: e.kind,
      x: e.x,
      y: e.y,
      name: e.name,
      defKey: e.defKey,
      ...(e.size && { size: e.size }),
      ...(e.depletedUntil !== undefined && { depleted: true }),
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
      maxHit: playerMaxHit(this.fighterFor(player)),
      ui: this.uiView(player),
      quests: QUEST_IDS.map((id) => questView(id, player.quests[id] ?? 0)),
      questPoints: this.questPoints(player),
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
