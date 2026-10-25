import type { ClientMessage, ServerMessage } from '@rpg/shared';

/**
 * The only way the client talks to the game. LocalServer (single-player) and
 * NetworkServer (phase 6, WebSocket) both implement it, so nothing above this
 * layer knows or cares where the simulation runs.
 */
export interface ServerConnection {
  connect(name: string): Promise<void>;
  send(msg: ClientMessage): void;
  onMessage(handler: (msg: ServerMessage) => void): void;
  disconnect(): void;
}
