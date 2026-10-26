import type { MapData, Point } from '../map/types';
import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type GameMessageKind,
  type PublicEntity,
  type SelfState,
  type ServerMessage,
} from '../protocol/messages';
import { Rng } from '../rng';
import type { Entity, EntityId, GroundItemEntity, ObjectEntity, PlayerEntity } from './entities';
import { ATTEMPT_TICKS, EXAMINE, RESOURCE_DATA, gatherChance } from './gathering';
import { NEIGHBOURS_4, NEIGHBOURS_8, WorldGrid } from './grid';
import { ITEMS, INVENTORY_SIZE, addItem, bestTool, canAdd, emptyInventory, hasAnyTool } from './items';
import { findPath } from './pathfinding';
import { SAVE_VERSION, type SaveData } from './save';
import { MAX_XP, SKILLS, combatLevel, levelForXp, requirementLevel, startingXp, type SkillId } from './skills';

export const TICK_MS = 600;
/** Dropped items stay on the ground for two minutes. */
export const GROUND_ITEM_TICKS = 200;
/** What a brand-new character carries. */
const STARTING_ITEMS = ['bronze_axe'];

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
    if (!save) for (const item of STARTING_ITEMS) addItem(inventory, item);
    const start = save && this.grid.isWalkable(save.position.x, save.position.y) ? save.position : this.map.spawn;
    const player: PlayerEntity = {
      id: this.allocateId(),
      kind: 'player',
      name: (save?.name ?? name).trim().slice(0, 12) || 'Adventurer',
      x: start.x,
      y: start.y,
      skills: save ? { ...save.skills } : startingXp(),
      inventory,
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
      save ? `Welcome back, ${player.name}.` : 'Welcome to Kelmoor. Click the ground to walk, right-click for options. Trees can be chopped with your axe.',
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
      bank: [],
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
      if (e.action) this.gather(e);
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
  }

  private interact(player: PlayerEntity, targetId: EntityId, action: 'gather' | 'take'): void {
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
      if (target.depletedUntil !== undefined && target.defKey.endsWith('rock')) text = EXAMINE.rock_depleted;
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

  /** Woodcutting now; mining and fishing reuse this in phase 3. */
  private gather(player: PlayerEntity): void {
    const action = player.action!;
    const node = this.entities.get(action.targetId);
    const data = node?.kind === 'resource' ? RESOURCE_DATA[node.defKey] : undefined;
    if (!node || node.kind !== 'resource' || !data) return this.stopGathering(player);
    if (Math.max(Math.abs(node.x - player.x), Math.abs(node.y - player.y)) > 1) return this.stopGathering(player);
    if (node.depletedUntil !== undefined) return this.stopGathering(player);

    const skillName = SKILLS.find((s) => s.id === data.skill)!.name;
    const itemName = ITEMS[data.item]?.name.toLowerCase() ?? data.item;
    if (data.skill !== 'woodcutting') {
      this.message(player.id, `${skillName} isn't open yet. It arrives in the next update.`);
      return this.stopGathering(player);
    }
    const level = levelForXp(player.skills[data.skill]);
    if (level < data.level) {
      this.message(player.id, `You need a ${skillName} level of ${data.level} to chop this tree.`, 'warn');
      return this.stopGathering(player);
    }
    const tool = bestTool(player.inventory, data.skill, level);
    if (!tool) {
      const why = hasAnyTool(player.inventory, data.skill) ? `You need a higher ${skillName} level to use your axe.` : 'You need an axe to chop down this tree.';
      this.message(player.id, why, 'warn');
      return this.stopGathering(player);
    }
    if (!canAdd(player.inventory, data.item)) {
      this.message(player.id, `Your inventory is too full to hold any more ${itemName}.`, 'warn');
      return this.stopGathering(player);
    }

    if (!action.started) {
      action.started = true;
      action.nextAttempt = this.tick + ATTEMPT_TICKS;
      this.message(player.id, 'You swing your axe at the tree.');
      return;
    }
    if (this.tick < action.nextAttempt) return;
    action.nextAttempt = this.tick + ATTEMPT_TICKS;
    if (!this.rng.chance(gatherChance(level, data.level, tool.tool!.bonus))) return;

    addItem(player.inventory, data.item);
    this.message(player.id, `You get some ${itemName}.`);
    this.addXp(player, data.skill, data.xp);
    if (this.rng.chance(data.depleteChance)) {
      node.depletedUntil = this.tick + data.respawnTicks;
      for (const e of this.entities.values()) {
        if (e.kind === 'player' && e.action?.targetId === node.id) this.stopGathering(e);
      }
    } else if (!canAdd(player.inventory, data.item)) {
      this.message(player.id, `Your inventory is too full to hold any more ${itemName}.`, 'warn');
      this.stopGathering(player);
    }
  }

  private stopGathering(player: PlayerEntity): void {
    player.action = null;
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
  private visibleTo(_player: PlayerEntity): PublicEntity[] {
    return [...this.entities.values()].map((e) => this.toPublic(e));
  }

  private toPublic(e: Entity): PublicEntity {
    if (e.kind === 'player') {
      const target = e.action?.started ? this.entities.get(e.action.targetId) : undefined;
      return {
        id: e.id,
        kind: e.kind,
        x: e.x,
        y: e.y,
        name: e.name,
        combatLevel: combatLevel(e.skills),
        ...(target && { workingOn: { x: target.x, y: target.y } }),
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
