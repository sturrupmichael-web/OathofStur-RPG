import type { MapData, Point } from '../map/types';
import {
  PROTOCOL_VERSION,
  type Activity,
  type ClientMessage,
  type GameMessageKind,
  type PublicEntity,
  type SelfState,
  type ServerMessage,
  type UiView,
} from '../protocol/messages';
import { Rng } from '../rng';
import { RECIPES, RECIPE_BY_ID, SELL_RATE, SHOPS, STATION_TITLES, burnChance, isBanker, shopBuys, shopForNpc, type StationKind } from './crafting';
import type { Entity, EntityId, GroundItemEntity, ObjectEntity, PlayerEntity } from './entities';
import { ATTEMPT_TICKS, EXAMINE, RESOURCE_DATA, gatherChance, requiredLevel } from './gathering';
import { NEIGHBOURS_4, NEIGHBOURS_8, WorldGrid } from './grid';
import {
  ITEMS,
  INVENTORY_SIZE,
  addItem,
  bestTool,
  canAdd,
  countItem,
  emptyInventory,
  hasAnyTool,
  hasItem,
  removeItem,
  roomFor,
  type ItemStack,
} from './items';
import { findPath } from './pathfinding';
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
    const player: PlayerEntity = {
      id: this.allocateId(),
      kind: 'player',
      name: (save?.name ?? name).trim().slice(0, 12) || 'Adventurer',
      x: start.x,
      y: start.y,
      skills: save ? { ...save.skills } : startingXp(),
      inventory,
      bank: save ? save.bank.map((s) => ({ ...s })) : [],
      ui: null,
      createdAt: save?.createdAt ?? now,
      path: [],
      destination: null,
      gateNotice: null,
      action: null,
      pickup: null,
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
        : 'Welcome to Kelmoor, in the Vell Reaches. Click the ground to walk, right-click for options. Chop trees with your axe, net fish in the River Vell, and visit the General Store for more tools.',
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
      equipment: {},
      bank: p.bank.map((s) => ({ ...s })),
      quests: {},
      createdAt: p.createdAt || now,
      updatedAt: now,
    };
  }

  removePlayer(id: EntityId): void {
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
      if (e.kind === 'player') this.movePlayer(e);
    }
    for (const e of this.entities.values()) {
      if (e.kind !== 'player' || e.path.length) continue;
      if (e.pickup !== null) this.pickUp(e);
      if (e.action?.kind === 'gather') this.gather(e);
      else if (e.action?.kind === 'use') this.arriveToUse(e);
      else if (e.action?.kind === 'craft') this.craftStep(e);
    }
    for (const e of [...this.entities.values()]) {
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

  private interact(player: PlayerEntity, targetId: EntityId, action: 'gather' | 'take' | 'use'): void {
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
    else {
      const key = target.depletedUntil !== undefined ? `${target.defKey}_stump` : target.defKey;
      text = EXAMINE[key] ?? EXAMINE[target.defKey] ?? `It's a ${target.name.toLowerCase()}.`;
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
    };
    this.entities.set(item.id, item);
  }

  private walkTo(player: PlayerEntity, target: Point): void {
    const goals = this.goalsFor(target);
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

  /** Walkable targets are their own goal; blocked ones are reached from a neighbour. */
  private goalsFor(target: Point): Point[] {
    if (this.grid.isWalkable(target.x, target.y)) return [target];
    const orthogonal = NEIGHBOURS_4.map(([dx, dy]) => ({ x: target.x + dx, y: target.y + dy })).filter((p) =>
      this.grid.isWalkable(p.x, p.y),
    );
    if (orthogonal.length) return orthogonal;
    return NEIGHBOURS_8.map(([dx, dy]) => ({ x: target.x + dx, y: target.y + dy })).filter((p) =>
      this.grid.isWalkable(p.x, p.y),
    );
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
    if (!item || item.kind !== 'item' || item.x !== player.x || item.y !== player.y) return;
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
      const tool = bestTool(player.inventory, data.skill, level);
      if (!tool) {
        const why = hasAnyTool(player.inventory, data.skill) ? `You need a higher ${skillName} level to use the tool you have.` : `You need ${text.tool}.`;
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

  private adjacent(player: PlayerEntity, target: { x: number; y: number }): boolean {
    return Math.max(Math.abs(target.x - player.x), Math.abs(target.y - player.y)) <= 1;
  }

  private skillName(skill: SkillId): string {
    return SKILLS.find((s) => s.id === skill)!.name;
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
    const missing = recipe.inputs.find((i) => !hasItem(player.inventory, i.itemId, i.qty));
    if (missing) {
      if (!action.started) this.message(player.id, `You don't have enough ${ITEMS[missing.itemId].name.toLowerCase()} to make that.`, 'warn');
      return void (player.action = null);
    }

    action.started = true;
    for (const input of recipe.inputs) removeItem(player.inventory, input.itemId, input.qty);
    if (recipe.burnt && this.rng.chance(burnChance(recipe, level))) {
      addItem(player.inventory, recipe.burnt);
      this.message(player.id, `You accidentally burn the ${output.toLowerCase()}.`);
    } else {
      addItem(player.inventory, recipe.output);
      this.message(player.id, CRAFT_TEXT[recipe.station](output.toLowerCase()));
      this.addXp(player, recipe.skill, recipe.xp);
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
      return { target, activity: recipe.station === 'furnace' ? 'smelt' : recipe.station === 'anvil' ? 'smith' : 'cook' };
    }
    return null;
  }

  private addXp(player: PlayerEntity, skill: SkillId, amount: number): void {
    const before = levelForXp(player.skills[skill]);
    player.skills[skill] = Math.min(MAX_XP, Math.round((player.skills[skill] + amount) * 10) / 10);
    const after = levelForXp(player.skills[skill]);
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
  // Output
  // -------------------------------------------------------------------------

  private message(playerId: EntityId, text: string, kind: GameMessageKind = 'info'): void {
    this.sessions.get(playerId)?.outbox.push({ type: 'gameMessage', text, kind });
  }

  private reject(playerId: EntityId, reason: string): void {
    this.sessions.get(playerId)?.outbox.push({ type: 'reject', reason });
  }

  /** Everything is visible in single-player; a view radius slots in here for multiplayer. */
  private visibleTo(player: PlayerEntity): PublicEntity[] {
    const out: PublicEntity[] = [];
    for (const e of this.entities.values()) {
      if (e.id !== player.id && Math.max(Math.abs(e.x - player.x), Math.abs(e.y - player.y)) > VIEW_RADIUS) continue;
      out.push(this.toPublic(e));
    }
    return out;
  }

  private toPublic(e: Entity): PublicEntity {
    if (e.kind === 'player') {
      const work = this.activityOf(e);
      return {
        id: e.id,
        kind: e.kind,
        x: e.x,
        y: e.y,
        name: e.name,
        combatLevel: combatLevel(e.skills),
        ...(work && { workingOn: { x: work.target.x, y: work.target.y }, activity: work.activity }),
      };
    }
    if (e.kind === 'item') return { id: e.id, kind: e.kind, x: e.x, y: e.y, name: e.name, defKey: e.itemId, qty: e.qty };
    return { id: e.id, kind: e.kind, x: e.x, y: e.y, name: e.name, defKey: e.defKey, ...(e.depletedUntil !== undefined && { depleted: true }) };
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
      destination: player.destination,
      inventory: player.inventory,
      ui: this.uiView(player),
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
      if (p.kind === 'monster') continue; // monsters arrive in phase 4
      const table = p.kind === 'resource' ? defs.resources : p.kind === 'station' ? defs.stations : p.kind === 'scenery' ? defs.scenery : defs.npcs;
      const entity: ObjectEntity = {
        id: this.allocateId(),
        kind: p.kind,
        defKey: p.defKey,
        name: table[p.defKey].name,
        x: p.x,
        y: p.y,
      };
      this.entities.set(entity.id, entity);
    }
  }
}

const CRAFT_TEXT: Record<StationKind, (item: string) => string> = {
  furnace: (item) => `You retrieve ${aOrSome(item)}.`,
  anvil: (item) => `You hammer the metal and make ${aOrSome(item)}.`,
  range: (item) => `You cook the ${item}.`,
};

function aOrSome(name: string): string {
  if (name.endsWith('s')) return `some ${name}`;
  return /^[aeiou]/i.test(name) ? `an ${name}` : `a ${name}`;
}
