import type { MapData, Point } from '@rpg/shared';
import type { ClientState } from '../state/ClientState';
import type { TileInfo } from '../render/palette';

const SCALE = 2;

/** North-up overview drawn straight from map data. Click to walk there. */
export class Minimap {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly base: HTMLCanvasElement;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly map: MapData,
    tileColors: number[],
    info: TileInfo,
    private readonly state: ClientState,
    onWalk: (tile: Point) => void,
  ) {
    canvas.width = map.width * SCALE;
    canvas.height = map.height * SCALE;
    this.ctx = canvas.getContext('2d')!;

    this.base = document.createElement('canvas');
    this.base.width = canvas.width;
    this.base.height = canvas.height;
    const b = this.base.getContext('2d')!;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const i = y * map.width + x;
        const key = info.placementKey[i];
        let color = '#' + tileColors[i].toString(16).padStart(6, '0');
        const terrain = info.terrainKey[i];
        if (key === 'dead_tree') color = '#5a5048';
        else if (key?.endsWith('tree')) color = '#2b5e27';
        else if (key?.endsWith('rock')) color = '#b9a27a';
        else if (key === 'hide_tent') color = '#9a7a52';
        else if (key) color = '#c8c0b0';
        else if (terrain === 'city_wall') color = '#d8d4cc';
        else if (terrain === 'building_wall') color = '#efe6d2';
        else if (terrain === 'door') color = '#b0603a';
        else if (terrain === 'fence') color = '#8a6240';
        else if (terrain === 'palisade') color = '#5a3d22';
        else if (terrain === 'ditch') color = '#2e261e';
        b.fillStyle = color;
        b.fillRect(x * SCALE, y * SCALE, SCALE, SCALE);
      }
    }

    canvas.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = Math.floor(((e.clientX - rect.left) / rect.width) * map.width);
      const y = Math.floor(((e.clientY - rect.top) / rect.height) * map.height);
      onWalk({ x, y });
    });
  }

  draw(now: number): void {
    const { ctx } = this;
    ctx.drawImage(this.base, 0, 0);
    for (const view of this.state.entities.values()) {
      if (view.data.kind === 'npc') this.dot(view.data.x + 0.5, view.data.y + 0.5, '#ffe14d', 2);
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
    this.ctx.arc(x * SCALE, y * SCALE, r, 0, Math.PI * 2);
    this.ctx.fill();
  }
}
