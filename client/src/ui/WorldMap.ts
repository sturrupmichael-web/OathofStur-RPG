import type { MapData, Point, SkillGuide } from '@rpg/shared';
import type { ClientState } from '../state/ClientState';

/**
 * The whole region on one screen: tap a tile to walk there, or pick a skill to
 * see where it is trained. Drawn from the minimap's world image.
 */
export class WorldMap {
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly note: HTMLElement;
  private readonly skillRow: HTMLElement;
  private skill: SkillGuide | null = null;
  private open = false;

  constructor(
    private readonly map: MapData,
    private readonly image: HTMLCanvasElement,
    private readonly state: ClientState,
    private readonly onWalk: (tile: Point) => void,
  ) {
    this.root = document.getElementById('worldmap')!;
    this.canvas = document.getElementById('worldmap-canvas') as HTMLCanvasElement;
    this.note = document.getElementById('worldmap-note')!;
    this.skillRow = document.getElementById('worldmap-skills')!;
    this.canvas.width = map.width * 2;
    this.canvas.height = map.height * 2;
    this.ctx = this.canvas.getContext('2d')!;

    for (const guide of map.skills) {
      const button = document.createElement('button');
      button.textContent = guide.name;
      button.addEventListener('click', () => {
        this.skill = this.skill?.name === guide.name ? null : guide;
        for (const other of this.skillRow.children) other.classList.remove('on');
        if (this.skill) button.classList.add('on');
        this.note.textContent = this.skill ? `${this.skill.name}: ${this.skill.note}` : TAP_HINT;
        this.draw();
      });
      this.skillRow.appendChild(button);
    }

    document.getElementById('worldmap-close')!.addEventListener('click', () => this.hide());
    document.getElementById('worldmap-open')!.addEventListener('click', () => this.show());
    this.canvas.addEventListener('click', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = Math.floor(((e.clientX - rect.left) / rect.width) * map.width);
      const y = Math.floor(((e.clientY - rect.top) / rect.height) * map.height);
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) return;
      this.onWalk({ x, y });
      this.hide();
    });
  }

  get isOpen(): boolean {
    return this.open;
  }

  show(): void {
    this.open = true;
    this.root.hidden = false;
    this.note.textContent = this.skill ? `${this.skill.name}: ${this.skill.note}` : TAP_HINT;
    this.draw();
  }

  hide(): void {
    this.open = false;
    this.root.hidden = true;
  }

  toggle(): void {
    if (this.open) this.hide();
    else this.show();
  }

  /** Redraws while open; markers move with the player. */
  draw(): void {
    if (!this.open) return;
    const { ctx } = this;
    ctx.drawImage(this.image, 0, 0, this.canvas.width, this.canvas.height);

    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const area of this.map.areas) {
      if ((area.tier ?? 1) !== 0 || area.w > 100) continue;
      const x = (area.x + area.w / 2) * 2;
      const y = (area.y + area.h / 2) * 2;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
      ctx.fillText(area.name, x + 1, y + 1);
      ctx.fillStyle = '#f0e2bc';
      ctx.fillText(area.name, x, y);
    }

    for (const view of this.state.entities.values()) {
      if (view.data.kind === 'npc') this.dot(view.data.x, view.data.y, '#ffe14d', 2);
    }

    if (this.skill) {
      for (const site of this.skill.sites) {
        this.ring(site.x, site.y, '#58d6ff');
        ctx.fillStyle = '#58d6ff';
        ctx.fillText(site.label, site.x * 2, site.y * 2 - 10);
      }
    }

    const me = this.state.player?.data;
    if (me) this.ring(me.x, me.y, '#ffffff');
  }

  private dot(x: number, y: number, color: string, r: number): void {
    this.ctx.fillStyle = color;
    this.ctx.beginPath();
    this.ctx.arc(x * 2 + 1, y * 2 + 1, r, 0, Math.PI * 2);
    this.ctx.fill();
  }

  private ring(x: number, y: number, color: string): void {
    const { ctx } = this;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x * 2 + 1, y * 2 + 1, 5, 0, Math.PI * 2);
    ctx.stroke();
  }
}

const TAP_HINT = 'Tap anywhere to walk there. Pick a skill to see where it is trained.';
