import {
  PROTOCOL_VERSION,
  Simulation,
  type ClientMessage,
  type EntityId,
  parseSave,
  type MapData,
  type SaveData,
  type ServerMessage,
} from '@rpg/shared';
import type { Account } from './auth';
import type { SaveStore } from './store';

/** One player's link to the world: a WebSocket in production, a stub in tests. */
export interface Link {
  send(text: string): void;
  close(code: number, reason: string): void;
}

export interface HostOptions {
  map: MapData;
  seed: number;
  /** Checks a sign-in token; null when it isn't valid. */
  verify: (token: string) => Promise<Account | null>;
  /** Where characters live between visits. */
  store: SaveStore;
  maxPlayers?: number;
  now?: () => string;
  log?: (...args: unknown[]) => void;
}

/** Messages a client may send in a burst, and how many it earns back each second. */
const BURST = 40;
const PER_SECOND = 20;
/** Fields that must be whole numbers when a message has them. */
const INT_FIELDS = ['x', 'y', 'slot', 'from', 'to', 'qty', 'index', 'option', 'targetId', 'tier'] as const;

interface Client {
  link: Link;
  playerId: EntityId | null;
  account: Account | null;
  joining: boolean;
  allowance: number;
  refilledAt: number;
  /** The last save written for this player, to skip writing when nothing changed. */
  lastStored: string;
}

/** A save without its timestamp, for telling whether anything changed. */
const sameness = (save: SaveData) => JSON.stringify({ ...save, updatedAt: '' });

/**
 * The online world: one Simulation, ticked by the server, shared by every
 * connected player. Speaks the same messages as the browser's LocalServer, so
 * the client can't tell the difference beyond the network delay.
 *
 * Characters belong to Google accounts (checked with Supabase) and live in the
 * store, not the browser. A player's first visit brings their existing character
 * over once; after that the server's copy is the only one that counts.
 */
export class GameHost {
  readonly sim: Simulation;
  private readonly clients = new Set<Client>();
  private readonly maxPlayers: number;
  private readonly now: () => string;
  private readonly log: (...args: unknown[]) => void;
  /** Each account's store writes, one after another, so a quick rejoin reads the latest. */
  private readonly writes = new Map<string, Promise<void>>();

  constructor(private readonly opts: HostOptions) {
    this.sim = new Simulation({ map: opts.map, seed: opts.seed, onError: (err, msg) => this.log('intent failed', msg.type, err) });
    this.maxPlayers = opts.maxPlayers ?? 50;
    this.now = opts.now ?? (() => new Date().toISOString());
    this.log = opts.log ?? console.error;
  }

  get playerCount(): number {
    let n = 0;
    for (const c of this.clients) if (c.playerId !== null) n++;
    return n;
  }

  /** A new connection. It has to send `join` first. */
  open(link: Link): Client {
    const client: Client = { link, playerId: null, account: null, joining: false, allowance: BURST, refilledAt: Date.now(), lastStored: '' };
    this.clients.add(client);
    return client;
  }

  /** The connection went away: the character is stored and leaves the world. */
  close(client: Client): void {
    if (!this.clients.delete(client)) return;
    this.leave(client);
  }

  async receive(client: Client, text: string): Promise<void> {
    if (!this.spend(client)) return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(text) as ClientMessage;
    } catch {
      return;
    }
    if (!wellFormed(msg)) return;

    if (msg.type === 'join') return this.join(client, msg);
    if (client.playerId === null) return;
    // Stored now, and sent back so the player can export it.
    if (msg.type === 'requestSave') {
      const save = this.persist(client);
      if (save) this.emit(client, { type: 'saveData', save });
      return;
    }
    this.sim.queueIntent(client.playerId, msg);
  }

  /** One world tick, then everyone's messages go out. */
  step(): void {
    this.sim.step();
    for (const c of this.clients) this.flush(c);
  }

  /** Every minute: store whoever changed. */
  autosave(): void {
    for (const c of this.clients) this.persist(c);
  }

  /** Before the server stops: store everyone and wait for it. */
  async saveAll(): Promise<void> {
    this.autosave();
    await Promise.all(this.writes.values());
  }

  private async join(client: Client, msg: Extract<ClientMessage, { type: 'join' }>): Promise<void> {
    if (client.playerId !== null || client.joining) return;
    if (msg.protocolVersion !== PROTOCOL_VERSION) return this.refuse(client, 'The game has been updated. Please reload the page.');
    if (this.playerCount >= this.maxPlayers) return this.refuse(client, 'The world is full right now. Try again in a little while.');
    client.joining = true;
    try {
      const account = typeof msg.token === 'string' && msg.token ? await this.opts.verify(msg.token) : null;
      if (!account) return this.refuse(client, 'Sign in with Google to play online: ⚙ Options, Cloud save.');
      // A store write still on its way (a quick reload) lands before the character is read back.
      await this.writes.get(account.id);
      let stored: SaveData | null;
      try {
        stored = await this.opts.store.load(account.id);
      } catch (err) {
        this.log('load failed', account.id, err);
        return this.refuse(client, "Couldn't load your character just now. Please try again in a minute.");
      }
      if (!this.clients.has(client)) return; // left while we were busy

      // One character per account: joining again takes over from the old tab, as it is right now.
      let save = stored ? parseSave(stored) : null;
      for (const other of [...this.clients]) {
        if (other === client || other.account?.id !== account.id) continue;
        const live = other.playerId !== null ? this.sim.saveFor(other.playerId, this.now()) : null;
        if (live) save = live;
        this.refuse(other, 'You joined the world from another tab or device.');
        this.clients.delete(other);
        this.leave(other, false);
      }
      // First visit: the character they already have comes with them, once.
      const imported = !stored && !save && !!msg.save;
      if (imported) save = parseSave(msg.save);

      client.account = account;
      client.playerId = this.sim.addPlayer(String(msg.name ?? ''), save, this.now());
      // Stored at once: an import happens only once, and a takeover keeps the live state.
      this.persist(client);
      this.flush(client);
      if (imported) {
        this.emit(client, {
          type: 'gameMessage',
          kind: 'info',
          text: 'Your character came with you into the online world. From now on it is kept on the server, and your solo save stays as it was.',
        });
      }
    } finally {
      client.joining = false;
    }
  }

  /** Takes the player out of the world, storing them first unless someone else is taking over. */
  private leave(client: Client, store = true): void {
    if (client.playerId === null) return;
    if (store) this.persist(client);
    this.sim.removePlayer(client.playerId);
    client.playerId = null;
  }

  /** Queues a store write of the player's character when it changed. Returns the save. */
  private persist(client: Client): SaveData | null {
    if (client.playerId === null || !client.account) return null;
    const save = this.sim.saveFor(client.playerId, this.now());
    if (!save) return null;
    const key = sameness(save);
    if (key === client.lastStored) return save;
    client.lastStored = key;
    const id = client.account.id;
    const write = (this.writes.get(id) ?? Promise.resolve())
      .then(() => this.opts.store.save(id, save))
      .catch((err) => {
        this.log('save failed', id, err);
        // Try again on the next autosave.
        if (client.lastStored === key) client.lastStored = '';
      });
    this.writes.set(id, write);
    void write.then(() => {
      if (this.writes.get(id) === write) this.writes.delete(id);
    });
    return save;
  }

  private refuse(client: Client, reason: string): void {
    this.emit(client, { type: 'reject', reason });
    client.link.close(4000, 'refused');
  }

  private flush(client: Client): void {
    if (client.playerId === null) return;
    for (const m of this.sim.drain(client.playerId)) this.emit(client, m);
  }

  private emit(client: Client, msg: ServerMessage): void {
    client.link.send(JSON.stringify(msg));
  }

  /** Token bucket: a client that floods is ignored until it slows down. */
  private spend(client: Client): boolean {
    const t = Date.now();
    client.allowance = Math.min(BURST, client.allowance + ((t - client.refilledAt) / 1000) * PER_SECOND);
    client.refilledAt = t;
    if (client.allowance < 1) return false;
    client.allowance--;
    return true;
  }
}

/** The shape checks every intent gets before the simulation sees it. */
function wellFormed(msg: unknown): msg is ClientMessage {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return false;
  const m = msg as Record<string, unknown>;
  if (typeof m.type !== 'string') return false;
  for (const f of INT_FIELDS) {
    if (f === 'slot' && m.type === 'unequip') continue; // a gear slot's name
    if (f in m && m[f] !== undefined && !Number.isSafeInteger(m[f])) return false;
  }
  return true;
}
