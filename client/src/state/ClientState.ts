import type { EntityId, PublicEntity, SaveData, SelfState, ServerMessage, SkillId } from '@rpg/shared';

export interface EntityView {
  data: PublicEntity;
  /** Render position interpolates from -> to over one tick. */
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  movedAt: number;
  /** When it last took a hit (ms), for showing its health bar. */
  hitAt: number;
}

export interface HitEvent {
  attackerId: EntityId;
  targetId: EntityId;
  damage: number;
  hp: number;
  maxHp: number;
}

type Events = {
  added: EntityView;
  removed: EntityId;
  /** An entity's data changed in place (a tree became a stump, a player started chopping). */
  changed: EntityView;
  self: SelfState;
  xpDrop: { skill: SkillId; amount: number };
  levelUp: { skill: SkillId; level: number };
  saveData: SaveData;
  gameMessage: { text: string; kind: string };
  tick: number;
  hit: HitEvent;
  animation: { entityId: EntityId; kind: string };
  questComplete: { name: string; rewards: string[]; questPoints: number };
};

/**
 * The client's read-only mirror of what the server has told it. It never
 * decides game outcomes; it only stores state and smooths movement for display.
 */
export class ClientState {
  playerId: EntityId | null = null;
  mapId = '';
  tick = 0;
  tickMs = 600;
  self: SelfState | null = null;
  readonly entities = new Map<EntityId, EntityView>();

  private listeners = new Map<keyof Events, ((v: never) => void)[]>();

  on<K extends keyof Events>(event: K, fn: (v: Events[K]) => void): void {
    const list = this.listeners.get(event) ?? [];
    list.push(fn as (v: never) => void);
    this.listeners.set(event, list);
  }

  private emit<K extends keyof Events>(event: K, value: Events[K]): void {
    for (const fn of this.listeners.get(event) ?? []) (fn as (v: Events[K]) => void)(value);
  }

  apply(msg: ServerMessage, now: number): void {
    switch (msg.type) {
      case 'welcome':
        this.playerId = msg.playerId;
        this.mapId = msg.mapId;
        this.tick = msg.tick;
        this.tickMs = msg.tickMs;
        break;
      case 'snapshot':
        for (const id of [...this.entities.keys()]) this.remove(id);
        for (const e of msg.entities) this.add(e, now);
        this.tick = msg.tick;
        break;
      case 'tick':
        this.tick = msg.tick;
        for (const e of msg.added) this.add(e, now);
        for (const e of msg.updated) this.update(e, now);
        for (const id of msg.removed) this.remove(id);
        this.emit('tick', msg.tick);
        break;
      case 'self':
        this.self = msg.state;
        this.emit('self', msg.state);
        break;
      case 'gameMessage':
        this.emit('gameMessage', { text: msg.text, kind: msg.kind });
        break;
      case 'xpDrop':
        this.emit('xpDrop', { skill: msg.skill, amount: msg.amount });
        break;
      case 'levelUp':
        this.emit('levelUp', { skill: msg.skill, level: msg.level });
        break;
      case 'saveData':
        this.emit('saveData', msg.save);
        break;
      case 'hit': {
        const target = this.entities.get(msg.targetId);
        if (target) {
          target.hitAt = now;
          target.data = { ...target.data, hp: msg.hp, maxHp: msg.maxHp };
        }
        this.emit('hit', { attackerId: msg.attackerId, targetId: msg.targetId, damage: msg.damage, hp: msg.hp, maxHp: msg.maxHp });
        break;
      }
      case 'animation':
        this.emit('animation', { entityId: msg.entityId, kind: msg.kind });
        break;
      case 'questComplete':
        this.emit('questComplete', { name: msg.name, rewards: msg.rewards, questPoints: msg.questPoints });
        break;
      case 'reject':
        this.emit('gameMessage', { text: msg.reason, kind: 'warn' });
        break;
    }
  }

  /** Interpolated tile-space position of an entity at time `now`. */
  renderPosition(view: EntityView, now: number): { x: number; y: number } {
    const t = Math.min(1, Math.max(0, (now - view.movedAt) / this.tickMs));
    return { x: view.fromX + (view.toX - view.fromX) * t, y: view.fromY + (view.toY - view.fromY) * t };
  }

  get player(): EntityView | undefined {
    return this.playerId === null ? undefined : this.entities.get(this.playerId);
  }

  private add(data: PublicEntity, now: number): void {
    const view: EntityView = { data, fromX: data.x, fromY: data.y, toX: data.x, toY: data.y, movedAt: now, hitAt: -Infinity };
    this.entities.set(data.id, view);
    this.emit('added', view);
  }

  private update(data: PublicEntity, now: number): void {
    const view = this.entities.get(data.id);
    if (!view) return this.add(data, now);
    if (data.x !== view.toX || data.y !== view.toY) {
      const current = this.renderPosition(view, now);
      // Teleports (respawn etc.) snap instead of sliding across the map.
      const far = Math.max(Math.abs(data.x - current.x), Math.abs(data.y - current.y)) > 2.5;
      view.fromX = far ? data.x : current.x;
      view.fromY = far ? data.y : current.y;
      view.toX = data.x;
      view.toY = data.y;
      view.movedAt = now;
    }
    const changed =
      data.depleted !== view.data.depleted ||
      data.dead !== view.data.dead ||
      JSON.stringify(data.workingOn) !== JSON.stringify(view.data.workingOn) ||
      JSON.stringify(data.gear) !== JSON.stringify(view.data.gear);
    view.data = data;
    if (changed) this.emit('changed', view);
  }

  private remove(id: EntityId): void {
    if (this.entities.delete(id)) this.emit('removed', id);
  }
}
