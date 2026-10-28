import {
  PROTOCOL_VERSION,
  Simulation,
  type ClientMessage,
  type EntityId,
  parseSave,
  type MapData,
  type ServerMessage,
} from '@rpg/shared';
import type { Account } from './auth';

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
  maxPlayers?: number;
  now?: () => string;
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
}

/**
 * The online world: one Simulation, ticked by the server, shared by every
 * connected player. Speaks the same messages as the browser's LocalServer, so
 * the client can't tell the difference beyond the network delay.
 */
export class GameHost {
  readonly sim: Simulation;
  private readonly clients = new Set<Client>();
  private readonly maxPlayers: number;
  private readonly now: () => string;

  constructor(private readonly opts: HostOptions) {
    this.sim = new Simulation({ map: opts.map, seed: opts.seed, onError: (err, msg) => console.error('intent failed', msg.type, err) });
    this.maxPlayers = opts.maxPlayers ?? 50;
    this.now = opts.now ?? (() => new Date().toISOString());
  }

  get playerCount(): number {
    let n = 0;
    for (const c of this.clients) if (c.playerId !== null) n++;
    return n;
  }

  /** A new connection. It has to send `join` first. */
  open(link: Link): Client {
    const client: Client = { link, playerId: null, account: null, joining: false, allowance: BURST, refilledAt: Date.now() };
    this.clients.add(client);
    return client;
  }

  /** The connection went away: the character leaves the world. */
  close(client: Client): void {
    if (!this.clients.delete(client)) return;
    if (client.playerId !== null) this.sim.removePlayer(client.playerId);
    client.playerId = null;
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
    // Answered straight away, like LocalServer, so a save asked for as the tab closes still gets out.
    if (msg.type === 'requestSave') {
      const save = this.sim.saveFor(client.playerId, this.now());
      if (save) this.emit(client, { type: 'saveData', save });
      return;
    }
    this.sim.queueIntent(client.playerId, msg);
  }

  /** Before the server stops: every player gets their save, since browsers still keep them for now. */
  saveAll(): void {
    for (const c of this.clients) {
      const save = c.playerId !== null ? this.sim.saveFor(c.playerId, this.now()) : null;
      if (save) this.emit(c, { type: 'saveData', save });
    }
  }

  /** One world tick, then everyone's messages go out. */
  step(): void {
    this.sim.step();
    for (const c of this.clients) this.flush(c);
  }

  private async join(client: Client, msg: Extract<ClientMessage, { type: 'join' }>): Promise<void> {
    if (client.playerId !== null || client.joining) return;
    if (msg.protocolVersion !== PROTOCOL_VERSION) return this.refuse(client, 'The game has been updated. Please reload the page.');
    if (this.playerCount >= this.maxPlayers) return this.refuse(client, 'The world is full right now. Try again in a little while.');
    client.joining = true;
    const account = typeof msg.token === 'string' && msg.token ? await this.opts.verify(msg.token) : null;
    client.joining = false;
    if (!this.clients.has(client)) return; // left while the token was checked
    if (account) {
      // One character per account: signing in again takes over from the old tab.
      for (const other of this.clients) {
        if (other !== client && other.account?.id === account.id) {
          this.refuse(other, 'You joined the world from another tab or device.');
          this.close(other);
        }
      }
      client.account = account;
    }
    const save = msg.save ? parseSave(msg.save) : null;
    client.playerId = this.sim.addPlayer(String(msg.name ?? ''), save, this.now());
    this.flush(client);
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
