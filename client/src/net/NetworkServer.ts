import { PROTOCOL_VERSION, type ClientMessage, type SaveData, type ServerMessage } from '@rpg/shared';
import type { ServerConnection } from './ServerConnection';

export type NetStatus =
  | { kind: 'online' }
  | { kind: 'reconnecting'; attempt: number }
  /** The server turned us away (a newer game version, a full world, joined elsewhere): no retrying. */
  | { kind: 'refused'; reason: string };

/** Waits this long for the world to answer before giving up on the first connect (slow phones need a while to load the world too). */
const CONNECT_MS = 20_000;
/** Seconds between reconnect tries, growing to the last and staying there. */
const BACKOFF = [1, 2, 4, 8, 15];

/**
 * Plays in the shared online world over a WebSocket. Same messages as
 * LocalServer; the simulation just runs on the game server instead, which also
 * keeps the character. After a dropped connection (a deploy, a phone losing
 * signal) it rejoins by itself.
 */
export class NetworkServer implements ServerConnection {
  /** Told when the link drops, comes back, or is refused, for the banner. */
  onStatus: (status: NetStatus) => void = () => {};

  private ws: WebSocket | null = null;
  private handlers: ((msg: ServerMessage) => void)[] = [];
  private name = '';
  private save: SaveData | null = null;
  private closing = false;
  private attempt = 0;
  private retry: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly url: string,
    /** The sign-in token to join with, when signed in. */
    private readonly token: () => Promise<string | null>,
  ) {}

  /** Resolves once the server has let us in; rejects when it can't be reached or says no. */
  connect(name: string, save: SaveData | null = null): Promise<void> {
    this.name = name;
    this.save = save;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => fail(new Error("The online world didn't answer.")), CONNECT_MS);
      const fail = (err: Error) => {
        clearTimeout(timer);
        this.closing = true;
        this.ws?.close();
        reject(err);
      };
      this.open({
        welcome: () => {
          clearTimeout(timer);
          resolve();
        },
        refused: (reason) => fail(new Error(reason)),
        lost: () => fail(new Error("Couldn't reach the online world.")),
      });
    });
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  onMessage(handler: (msg: ServerMessage) => void): void {
    this.handlers.push(handler);
  }

  disconnect(): void {
    this.closing = true;
    if (this.retry) clearTimeout(this.retry);
    this.ws?.close(1000, 'bye');
    this.ws = null;
  }

  private open(first?: { welcome: () => void; refused: (reason: string) => void; lost: () => void }): void {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    let joined = false;
    let refused: string | null = null;
    ws.onopen = async () => {
      const token = await this.token().catch(() => null);
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: 'join', name: this.name, protocolVersion: PROTOCOL_VERSION, save: this.save, ...(token && { token }) } satisfies ClientMessage));
    };
    ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      if (msg.type === 'reject' && !joined) {
        refused = msg.reason;
        return;
      }
      if (msg.type === 'welcome') {
        joined = true;
        this.attempt = 0;
        if (first) first.welcome();
        else this.onStatus({ kind: 'online' });
      }
      for (const h of this.handlers) h(msg);
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws || this.closing) return;
      this.ws = null;
      if (ev.code === 4000 || refused) {
        const reason = refused ?? 'The online world closed the connection.';
        if (first && !joined) first.refused(reason);
        else this.onStatus({ kind: 'refused', reason });
        return;
      }
      if (first && !joined) return first.lost();
      this.attempt++;
      this.onStatus({ kind: 'reconnecting', attempt: this.attempt });
      const wait = BACKOFF[Math.min(this.attempt - 1, BACKOFF.length - 1)] * 1000;
      this.retry = setTimeout(() => this.open(), wait);
    };
  }
}

/**
 * Where the online world lives: the server's own address when it served this page,
 * the dev server next to Vite, otherwise the hosted one.
 */
export function serverUrl(): string {
  if (import.meta.env.DEV) return `ws://${location.hostname}:8080/ws`;
  // Served by the game server itself (the fly.dev copy, or a local run on :8080).
  if (location.hostname.endsWith('.fly.dev') || location.port === '8080') return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  return 'wss://oath-of-stur.fly.dev/ws';
}
