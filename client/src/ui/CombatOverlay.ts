import { MONSTERS, type EntityId } from '@rpg/shared';
import { missileFlight } from '../render/EntityLayer';
import type { Renderer } from '../render/Renderer';
import type { ClientState } from '../state/ClientState';

/** How long a health bar stays up after a hit (ms). */
const BAR_MS = 6000;
const SPLAT_MS = 1100;

/** Height above the ground (tiles) where splats and bars float, by monster. */
const HEIGHTS: Record<string, number> = { cow: 1.15, desert_lizard: 0.55, scorpion: 0.7, cave_creeper: 0.75, crimson_swift: 1.35, goblin: 1.0, cinder_drake: 3.3 };

const OVERHEAD_ICONS: Record<string, string> = {
  ward_of_blades: `<svg viewBox="0 0 24 24"><path d="M12 2 L21 5.5 V12 C21 17.5 17 21 12 22.5 C7 21 3 17.5 3 12 V5.5 Z" fill="#9fd4ff" stroke="#1e3a52" stroke-width="1.4"/><path d="M7.5 7.5 L16.5 16.5 M16.5 7.5 L7.5 16.5" stroke="#1e3a52" stroke-width="2.2" stroke-linecap="round"/></svg>`,
  ward_of_spells: `<svg viewBox="0 0 24 24"><path d="M12 2 L21 5.5 V12 C21 17.5 17 21 12 22.5 C7 21 3 17.5 3 12 V5.5 Z" fill="#c9b0ff" stroke="#3a2a5a" stroke-width="1.4"/><path d="M12 6.5 L13.6 10.6 L17.8 10.8 L14.5 13.5 L15.6 17.6 L12 15.3 L8.4 17.6 L9.5 13.5 L6.2 10.8 L10.4 10.6 Z" fill="#5a3a9a"/></svg>`,
  ember_ward: `<svg viewBox="0 0 24 24"><path d="M12 2 C15.5 7.5 20 10 19 15.5 C18 20 14.5 22.5 12 22.5 C8.5 22.5 5 20 5 15.5 C5 12 7.5 9.5 8.5 7.5 C9.5 10.5 11 11.5 12 11.5 C12 8.5 11 5.5 12 2 Z" fill="#f08a32" stroke="#6a2a10" stroke-width="1.4"/><path d="M12 14 C13.5 16 14.5 17.5 13.2 19.5 C11 19.6 9.8 18 11 16 Z" fill="#ffd36a"/></svg>`,
};

/**
 * Hit splats and health bars over the 3D view, drawn as DOM elements that
 * follow their entity's screen position each frame.
 */
export class CombatOverlay {
  private readonly splats: { el: HTMLElement; target: EntityId; at: number; offset: number }[] = [];
  private readonly bars = new Map<EntityId, HTMLElement>();
  /** Ward prayers glowing over people's heads. */
  private readonly overheads = new Map<EntityId, HTMLElement>();
  private readonly bossBar = document.getElementById('boss-bar')!;
  private bossKey = '';

  constructor(
    private readonly layer: HTMLElement,
    private readonly state: ClientState,
    private readonly renderer: Renderer,
  ) {
    state.on('hit', (hit) => {
      const { targetId, damage } = hit;
      // An arrow's or a spell's splat shows when it lands.
      const flight = missileFlight(state, hit);
      if (flight) setTimeout(() => this.splat(targetId, damage), flight.loose + flight.ms);
      else this.splat(targetId, damage);
    });
  }

  private splat(targetId: EntityId, damage: number): void {
    const el = document.createElement('div');
    el.className = `splat${damage === 0 ? ' miss' : ''}`;
    el.textContent = String(damage);
    this.layer.appendChild(el);
    // Splats landing close together fan out instead of stacking.
    const recent = this.splats.filter((s) => s.target === targetId).length;
    this.splats.push({ el, target: targetId, at: performance.now(), offset: [0, -14, 14][recent % 3] });
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
    this.updateOverheads(now);
    this.updateBossBar();
  }

  /** A ward prayer shows as an icon floating over the head of whoever has it on. */
  private updateOverheads(now: number): void {
    const seen = new Set<EntityId>();
    for (const view of this.state.entities.values()) {
      const d = view.data;
      if (!d.overhead || d.dead) continue;
      seen.add(d.id);
      let icon = this.overheads.get(d.id);
      if (icon?.dataset.kind !== d.overhead) {
        icon?.remove();
        icon = document.createElement('div');
        icon.className = `overhead overhead-${d.overhead}`;
        icon.dataset.kind = d.overhead;
        icon.innerHTML = OVERHEAD_ICONS[d.overhead];
        this.layer.appendChild(icon);
        this.overheads.set(d.id, icon);
      }
      // Above the health bar, bobbing gently.
      const pos = this.renderer.screenPosition(d.id, this.height(d.id) + 0.62 + Math.sin(now / 500) * 0.03, now);
      if (pos) icon.style.transform = `translate(${pos.x - 12}px, ${pos.y - 12}px)`;
    }
    for (const [id, icon] of this.overheads) {
      if (seen.has(id)) continue;
      icon.remove();
      this.overheads.delete(id);
    }
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
