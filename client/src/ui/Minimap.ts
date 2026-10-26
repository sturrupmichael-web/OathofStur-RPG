import type { MapData, Point } from '@rpg/shared';
import type { ClientState } from '../state/ClientState';
import type { TileInfo } from '../render/palette';
import { drawWorldImage } from './mapImage';

const SCALE = 2;
/** Tiles across the minimap. The world is far bigger, so it shows the ground nearby. */
const SPAN = 48;

/** North-up view of the ground around the player. Click to walk there. */
export class Minimap {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly base: HTMLCanvasElement;
  /** Top-left tile of the window currently drawn. */
  private origin: Point = { x: 0, y: 0 };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly map: MapData,
    tileColors: number[],
    info: TileInfo,
    private readonly state: ClientState,
    onWalk: (tile: Point) => void,
  ) {
    canvas.width = SPAN * SCALE;
    canvas.height = SPAN * SCALE;
    this.ctx = canvas.getContext('2d')!;
    this.base = drawWorldImage(map, tileColors, info, SCALE);

    canvas.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = this.origin.x + Math.floor(((e.clientX - rect.left) / rect.width) * SPAN);
      const y = this.origin.y + Math.floor(((e.clientY - rect.top) / rect.height) * SPAN);
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) return;
      onWalk({ x, y });
    });
  }

  /** The world image, for the region map to reuse. */
  get worldImage(): HTMLCanvasElement {
    return this.base;
  }

  draw(now: number): void {
    const { ctx } = this;
    const me = this.state.player ? this.state.renderPosition(this.state.player, now) : this.map.spawn;
    const clamp = (v: number, max: number) => Math.max(0, Math.min(max - SPAN, v));
    this.origin = {
      x: clamp(Math.round(me.x - SPAN / 2), this.map.width),
      y: clamp(Math.round(me.y - SPAN / 2), this.map.height),
    };
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.base, -this.origin.x * SCALE, -this.origin.y * SCALE);

    for (const view of this.state.entities.values()) {
      if (view.data.kind === 'npc' || (view.data.kind === 'monster' && !view.data.dead)) this.dot(view.data.x + 0.5, view.data.y + 0.5, '#ffe14d', 2);
      if (view.data.kind === 'item') this.dot(view.data.x + 0.5, view.data.y + 0.5, '#e8322b', 1.6);
    }
    const dest = this.state.self?.destination;
    if (dest) this.dot(dest.x + 0.5, dest.y + 0.5, '#ff3b30', 2);
    for (const view of this.state.entities.values()) {
      if (view.data.kind !== 'player') continue;
      const p = this.state.renderPosition(view, now);
      this.dot(p.x + 0.5, p.y + 0.5, view.data.id === this.state.playerId ? '#ffffff' : '#ff7a6a', 2.5);
    }
  }

  private dot(x: number, y: number, color: string, r: number): void {
    this.ctx.fillStyle = color;
    this.ctx.beginPath();
    this.ctx.arc((x - this.origin.x) * SCALE, (y - this.origin.y) * SCALE, r, 0, Math.PI * 2);
    this.ctx.fill();
  }
}
