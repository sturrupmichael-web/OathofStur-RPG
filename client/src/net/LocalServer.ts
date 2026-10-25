import {
  PROTOCOL_VERSION,
  Simulation,
  TICK_MS,
  type ClientMessage,
  type EntityId,
  type MapData,
  type ServerMessage,
} from '@rpg/shared';
import type { ServerConnection } from './ServerConnection';

/**
 * Runs the shared simulation in the browser on a fixed tick. Every message is
 * passed through JSON in both directions, exactly as it would be over a
 * socket, so no object references leak between client and simulation.
 */
export class LocalServer implements ServerConnection {
  private sim: Simulation | null = null;
  private playerId: EntityId | null = null;
  private handlers: ((msg: ServerMessage) => void)[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly map: MapData,
    private readonly seed: number,
  ) {}

  async connect(name: string): Promise<void> {
    this.sim = new Simulation({ map: this.map, seed: this.seed });
    this.receive({ type: 'join', name, protocolVersion: PROTOCOL_VERSION });
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  send(msg: ClientMessage): void {
    this.receive(JSON.parse(JSON.stringify(msg)) as ClientMessage);
  }

  onMessage(handler: (msg: ServerMessage) => void): void {
    this.handlers.push(handler);
  }

  disconnect(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.sim && this.playerId !== null) this.sim.removePlayer(this.playerId);
    this.timer = null;
    this.sim = null;
    this.playerId = null;
  }

  private receive(msg: ClientMessage): void {
    if (!this.sim) return;
    if (msg.type === 'join') {
      if (msg.protocolVersion !== PROTOCOL_VERSION) {
        this.emit({ type: 'reject', reason: 'Client version mismatch. Please reload.' });
        return;
      }
      this.playerId = this.sim.addPlayer(msg.name);
      this.flush();
      return;
    }
    if (this.playerId !== null) this.sim.queueIntent(this.playerId, msg);
  }

  private tick(): void {
    if (!this.sim) return;
    this.sim.step();
    this.flush();
  }

  private flush(): void {
    if (!this.sim || this.playerId === null) return;
    for (const msg of this.sim.drain(this.playerId)) this.emit(msg);
  }

  private emit(msg: ServerMessage): void {
    const copy = JSON.parse(JSON.stringify(msg)) as ServerMessage;
    for (const h of this.handlers) h(copy);
  }
}
