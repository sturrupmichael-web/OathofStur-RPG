import { MONSTERS, type EntityId } from '@rpg/shared';
import type { Renderer } from '../render/Renderer';
import type { ClientState } from '../state/ClientState';

/** How long a health bar stays up after a hit (ms). */
const BAR_MS = 6000;
const SPLAT_MS = 1100;

/** Height above the ground (tiles) where splats and bars float, by monster. */
const HEIGHTS: Record<string, number> = { cow: 1.15, desert_lizard: 0.55, scorpion: 0.7, cave_creeper: 0.75, crimson_swift: 1.35, goblin: 1.0, cinder_drake: 3.3 };

/**
 * Hit splats and health bars over the 3D view, drawn as DOM elements that
 * follow their entity's screen position each frame.
 */
export class CombatOverlay {
  private readonly splats: { el: HTMLElement; target: EntityId; at: number; offset: number }[] = [];
  private readonly bars = new Map<EntityId, HTMLElement>();
  private readonly bossBar = document.getElementById('boss-bar')!;
  private bossKey = '';

  constructor(
    private readonly layer: HTMLElement,
    private readonly state: ClientState,
    private readonly renderer: Renderer,
  ) {
    state.on('hit', ({ targetId, damage }) => {
      const el = document.createElement('div');
      el.className = `splat${damage === 0 ? ' miss' : ''}`;
      el.textContent = String(damage);
      this.layer.appendChild(el);
      // Splats landing close together fan out instead of stacking.
      const recent = this.splats.filter((s) => s.target === targetId).length;
      this.splats.push({ el, target: targetId, at: performance.now(), offset: [0, -14, 14][recent % 3] });
    });
  }

  private height(id: EntityId): number {
    const data = this.state.entities.get(id)?.data;
    return (data?.kind === 'monster' && HEIGHTS[data.defKey ?? '']) || 1.3;
  }

  update(now: number): void {
    for (let i = this.splats.length - 1; i >= 0; i--) {
      const s = this.splats[i];
      const pos = this.renderer.screenPosition(s.target, this.height(s.target) * 0.6, now);
      if (!pos || now - s.at > SPLAT_MS) {
        s.el.remove();
        this.splats.splice(i, 1);
        continue;
      }
      s.el.style.transform = `translate(${pos.x - 12 + s.offset}px, ${pos.y - 11}px)`;
    }

    for (const view of this.state.entities.values()) {
      const d = view.data;
      const show = d.hp !== undefined && d.maxHp && !d.dead && now - view.hitAt < BAR_MS;
      let bar = this.bars.get(d.id);
      if (!show) {
        if (bar) {
          bar.remove();
          this.bars.delete(d.id);
        }
        continue;
      }
      if (!bar) {
        bar = document.createElement('div');
        bar.className = 'healthbar';
        bar.appendChild(document.createElement('div'));
        this.layer.appendChild(bar);
        this.bars.set(d.id, bar);
      }
      (bar.firstChild as HTMLElement).style.width = `${(Math.max(0, d.hp!) / d.maxHp!) * 100}%`;
      const pos = this.renderer.screenPosition(d.id, this.height(d.id), now);
      if (pos) bar.style.transform = `translate(${pos.x - 17}px, ${pos.y - 3}px)`;
    }
    for (const [id, bar] of this.bars) {
      if (!this.state.entities.has(id)) {
        bar.remove();
        this.bars.delete(id);
      }
    }
    this.updateBossBar();
  }

  /** A big health bar across the top while you fight a boss. */
  private updateBossBar(): void {
    const me = this.state.player?.data;
    let boss = me?.interacting !== undefined ? this.state.entities.get(me.interacting)?.data : undefined;
    if (me && (!boss || boss.kind !== 'monster' || !MONSTERS[boss.defKey ?? '']?.boss)) {
      boss = [...this.state.entities.values()].map((v) => v.data).find((d) => d.kind === 'monster' && d.interacting === me.id && MONSTERS[d.defKey ?? '']?.boss);
    }
    const key = boss && !boss.dead ? `${boss.name}:${boss.hp}:${boss.maxHp}` : '';
    if (key === this.bossKey) return;
    this.bossKey = key;
    this.bossBar.hidden = !key;
    if (!boss || !key) return;
    document.getElementById('boss-name')!.textContent = `${boss.name} (level-${boss.combatLevel})`;
    document.getElementById('boss-hp-fill')!.style.width = `${(Math.max(0, boss.hp ?? 0) / (boss.maxHp || 1)) * 100}%`;
  }
}
