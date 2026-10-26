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
import type { Entity, EntityId, ObjectEntity, PlayerEntity } from './entities';
import { NEIGHBOURS_4, NEIGHBOURS_8, WorldGrid } from './grid';
import { findPath } from './pathfinding';
import { SKILLS, combatLevel, requirementLevel, startingXp } from './skills';

export const TICK_MS = 600;

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

  addPlayer(name: string): EntityId {
    const player: PlayerEntity = {
      id: this.allocateId(),
      kind: 'player',
      name: name.trim().slice(0, 12) || 'Adventurer',
      x: this.map.spawn.x,
      y: this.map.spawn.y,
      skills: startingXp(),
      path: [],
      destination: null,
      gateNotice: null,
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
    this.message(player.id, 'Welcome. Click the ground to walk, right-click for options.');
    return player.id;
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
        this.walkTo(player, { x: msg.x, y: msg.y });
        return;
      case 'join':
        // Joining is handled by the host, not as an in-world intent.
        return;
      default:
        this.reject(playerId, 'Unknown intent.');
    }
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
      return { id: e.id, kind: e.kind, x: e.x, y: e.y, name: e.name, combatLevel: combatLevel(e.skills) };
    }
    return { id: e.id, kind: e.kind, x: e.x, y: e.y, name: e.name, defKey: e.defKey };
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
