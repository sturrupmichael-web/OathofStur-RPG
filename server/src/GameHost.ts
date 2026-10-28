import {
  PROTOCOL_VERSION,
  Simulation,
  type ClientMessage,
  type EntityId,
  cleanName,
  parseSave,
  type PlayerEntity,
  type MapData,
  type SaveData,
  type ServerMessage,
} from '@rpg/shared';
import type { Account } from './auth';
import { HELP, isAdmin, isBanned, isMuted, parseCommand, until, type Command, type Moderation } from './moderation';
import type { SaveStore, StoredCharacter } from './store';

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
  /** Their mute or ban, stored with the character. */
  mod: Moderation;
  /** May use the moderator commands. */
  admin: boolean;
}

/** A save without its timestamp, for telling whether anything changed. */
const sameness = (save: StoredCharacter) => JSON.stringify({ ...save, updatedAt: '' });

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
    const client: Client = { link, playerId: null, account: null, joining: false, allowance: BURST, refilledAt: Date.now(), lastStored: '', mod: {}, admin: false };
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
    if (msg.type === 'chat' && typeof msg.text === 'string') {
      if (msg.text.trim().startsWith('::')) return this.command(client, msg.text);
      if (isMuted(client.mod, Date.now())) return this.tell(client, `You're muted ${until(client.mod.mutedUntil)}.`);
    }
    // Online, a character's name is theirs alone.
    if (msg.type === 'setLook' && msg.name !== undefined && !this.player(client)?.look) {
      const name = cleanName(msg.name);
      if (name && (await this.nameTaken(name, client))) {
        this.emit(client, { type: 'nameTaken', name });
        return;
      }
      if (client.playerId === null) return; // left while we looked
    }
    this.sim.queueIntent(client.playerId, msg);
  }

  private player(client: Client): PlayerEntity | undefined {
    const p = client.playerId !== null ? this.sim.getEntity(client.playerId) : undefined;
    return p?.kind === 'player' ? p : undefined;
  }

  /** Someone else in the world, or any other stored character, already has this name. */
  private async nameTaken(name: string, client: Client): Promise<boolean> {
    const lower = name.toLowerCase();
    for (const c of this.clients) if (c !== client && this.player(c)?.name.toLowerCase() === lower) return true;
    try {
      return await this.opts.store.nameTaken(name, client.account?.id ?? '');
    } catch (err) {
      this.log('name check failed', err);
      return false;
    }
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
      let stored: StoredCharacter | null;
      try {
        stored = await this.opts.store.load(account.id);
      } catch (err) {
        this.log('load failed', account.id, err);
        return this.refuse(client, "Couldn't load your character just now. Please try again in a minute.");
      }
      if (!this.clients.has(client)) return; // left while we were busy
      let mod: Moderation = stored?.moderation ?? {};

      // One character per account: joining again takes over from the old tab, as it is right now.
      let save = stored ? parseSave(stored) : null;
      for (const other of [...this.clients]) {
        if (other === client || other.account?.id !== account.id) continue;
        const live = other.playerId !== null ? this.sim.saveFor(other.playerId, this.now()) : null;
        if (live) save = live;
        mod = other.mod;
        this.refuse(other, 'You joined the world from another tab or device.');
        this.clients.delete(other);
        this.leave(other, false);
      }
      if (isBanned(mod, Date.now())) return this.refuse(client, `This account is banned from the online world ${until(mod.bannedUntil)}.`);
      // First visit: the character they already have comes with them, once.
      const imported = !stored && !save && !!msg.save;
      if (imported) save = parseSave(msg.save);

      client.account = account;
      client.mod = mod;
      client.admin = isAdmin(account.email);
      client.playerId = this.sim.addPlayer(String(msg.name ?? ''), save, this.now(), account.id);
      // A character brought over from solo may share its name with someone else's: it gets a number.
      const me = this.player(client)!;
      let renamed = false;
      if (me.look && (await this.nameTaken(me.name, client))) {
        const base = me.name.slice(0, 10).trim();
        for (let n = 2; n < 100 && !renamed; n++) {
          const name = `${base}${n}`;
          if (!(await this.nameTaken(name, client))) [me.name, renamed] = [name, true];
        }
      }
      if (!this.clients.has(client)) return this.leave(client);
      // Stored at once: an import happens only once, and a takeover keeps the live state.
      this.persist(client);
      this.flush(client);
      if (renamed) this.emit(client, { type: 'gameMessage', kind: 'warn', text: `Someone online is already called that, so here you are ${me.name}.` });
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
    const row: StoredCharacter = Object.keys(client.mod).length ? { ...save, moderation: client.mod } : save;
    const key = sameness(row);
    if (key === client.lastStored) return save;
    client.lastStored = key;
    const id = client.account.id;
    const write = (this.writes.get(id) ?? Promise.resolve())
      .then(() => this.opts.store.save(id, row))
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

  private tell(client: Client, text: string, kind: 'info' | 'warn' = 'warn'): void {
    this.emit(client, { type: 'gameMessage', text, kind });
  }

  /** A moderator command typed in chat; anyone else is told there's no such thing. */
  private async command(client: Client, text: string): Promise<void> {
    if (!client.admin) return this.tell(client, "There's no such command.");
    const cmd = parseCommand(text);
    if (!cmd || cmd.kind === 'help') return this.tell(client, HELP, 'info');
    if (cmd.kind === 'who') {
      const names = [...this.clients].map((c) => this.player(c)?.name).filter(Boolean);
      return this.tell(client, `${names.length} online: ${names.join(', ')}.`, 'info');
    }
    const lower = cmd.name.toLowerCase();
    const target = [...this.clients].find((c) => this.player(c)?.name.toLowerCase() === lower);
    if (cmd.kind === 'kick') {
      if (!target) return this.tell(client, `${cmd.name} isn't online.`);
      this.remove(target, 'A moderator removed you from the world.');
      return this.tell(client, `${cmd.name} was kicked.`, 'info');
    }
    const change = (m: Moderation): Moderation => moderate(m, cmd);
    if (target) {
      target.mod = change(target.mod);
      this.persist(target);
      if (cmd.kind === 'ban') this.remove(target, `You've been banned from the online world ${until(target.mod.bannedUntil)}.`);
      if (cmd.kind === 'mute') this.tell(target, `A moderator muted you ${until(target.mod.mutedUntil)}.`);
      if (cmd.kind === 'unmute') this.tell(target, 'You can talk again.', 'info');
    } else {
      // Not online: change their stored character.
      try {
        const found = await this.opts.store.findByName(cmd.name);
        if (!found) return this.tell(client, `There's no character called ${cmd.name}.`);
        const id = found.userId;
        const write = (this.writes.get(id) ?? Promise.resolve()).then(() =>
          this.opts.store.save(id, { ...found.data, moderation: change(found.data.moderation ?? {}) }),
        );
        this.writes.set(id, write.catch(() => {}));
        await write;
      } catch (err) {
        this.log('moderation failed', err);
        return this.tell(client, "Couldn't reach the saves just now. Try again in a minute.");
      }
    }
    const done = { mute: 'muted', unmute: 'unmuted', ban: 'banned', unban: 'unbanned' }[cmd.kind];
    const amount = cmd.kind === 'mute' || cmd.kind === 'ban' ? ` (${cmd.amount ? `${cmd.amount} ${cmd.kind === 'mute' ? 'min' : 'h'}` : 'for good'})` : '';
    this.tell(client, `${cmd.name} is ${done}${amount}.`, 'info');
  }

  /** Takes someone out of the world, with a reason, and stores them. */
  private remove(client: Client, reason: string): void {
    this.refuse(client, reason);
    this.clients.delete(client);
    this.leave(client);
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

/** A mute or ban applied, or lifted. */
function moderate(m: Moderation, cmd: Extract<Command, { name: string }>): Moderation {
  const next = { ...m };
  const later = (ms: number) => new Date(Date.now() + ms).toISOString();
  if (cmd.kind === 'mute') next.mutedUntil = later((cmd.amount || 60 * 24 * 365 * 100) * 60_000);
  if (cmd.kind === 'unmute') delete next.mutedUntil;
  if (cmd.kind === 'ban') next.bannedUntil = cmd.amount ? later(cmd.amount * 3_600_000) : 'forever';
  if (cmd.kind === 'unban') delete next.bannedUntil;
  return next;
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
