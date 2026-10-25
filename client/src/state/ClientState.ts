import type { EntityId, PublicEntity, SelfState, ServerMessage } from '@rpg/shared';

export interface EntityView {
  data: PublicEntity;
  /** Render position interpolates from -> to over one tick. */
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  movedAt: number;
}

type Events = {
  added: EntityView;
  removed: EntityId;
  self: SelfState;
  gameMessage: { text: string; kind: string };
  tick: number;
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
    const view: EntityView = { data, fromX: data.x, fromY: data.y, toX: data.x, toY: data.y, movedAt: now };
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
    view.data = data;
  }

  private remove(id: EntityId): void {
    if (this.entities.delete(id)) this.emit('removed', id);
  }
}
