import type { ClientMessage, SaveData, ServerMessage } from '@rpg/shared';

/**
 * The only way the client talks to the game. LocalServer (single-player) and
 * NetworkServer (phase 6, WebSocket) both implement it, so nothing above this
 * layer knows or cares where the simulation runs.
 */
export interface ServerConnection {
  /** Joins as a new character, or as the saved one when `save` is given. */
  connect(name: string, save?: SaveData | null): Promise<void>;
  send(msg: ClientMessage): void;
  onMessage(handler: (msg: ServerMessage) => void): void;
  disconnect(): void;
}
