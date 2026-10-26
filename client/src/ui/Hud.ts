import { SKILLS, levelForXp, xpForLevel, MAX_LEVEL, type SelfState } from '@rpg/shared';

export interface MenuOption {
  label: string;
  /** Second part of the label, shown in the target colour (e.g. the entity name). */
  target?: string;
  action: () => void;
}

const EQUIPMENT_SLOTS = ['helmet', 'weapon', 'body', 'shield', 'legs'] as const;

/** DOM side of the interface: side panel, chat, tooltip and context menu. */
export class Hud {
  private readonly chatLog = el('chat-log');
  private readonly tooltip = el('tooltip');
  private readonly menu = el('context-menu');
  private closedByOutsidePress = false;

  constructor() {
    this.buildTabs();
    this.buildInventory();
    this.buildEquipment();
    document.addEventListener(
      'pointerdown',
      (e) => {
        if (this.menuOpen && !this.menu.contains(e.target as Node)) {
          this.closedByOutsidePress = true;
          this.hideMenu();
        }
      },
      true,
    );
    window.addEventListener('blur', () => this.hideMenu());
  }

  addMessage(text: string, kind = 'info'): void {
    const line = document.createElement('div');
    line.className = `msg msg-${kind}`;
    line.textContent = text;
    this.chatLog.appendChild(line);
    while (this.chatLog.childElementCount > 150) this.chatLog.firstElementChild?.remove();
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
  }

  showTooltip(x: number, y: number, action: string, target: string): void {
    this.tooltip.replaceChildren(text(action + ' '), span(target, 'tip-target'));
    this.tooltip.style.transform = `translate(${x + 16}px, ${y + 18}px)`;
    this.tooltip.hidden = false;
  }

  hideTooltip(): void {
    this.tooltip.hidden = true;
  }

  /** True once after a press outside the menu closed it, so that press doesn't also walk. */
  consumeMenuDismiss(): boolean {
    const was = this.closedByOutsidePress;
    this.closedByOutsidePress = false;
    return was;
  }

  get menuOpen(): boolean {
    return !this.menu.hidden;
  }

  showMenu(x: number, y: number, options: MenuOption[]): void {
    const title = document.createElement('div');
    title.className = 'menu-title';
    title.textContent = 'Choose Option';
    this.menu.replaceChildren(title);
    for (const opt of [...options, { label: 'Cancel', action: () => {} }]) {
      const item = document.createElement('button');
      item.className = 'menu-item';
      item.append(text(opt.label));
      if (opt.target) item.append(text(' '), span(opt.target, 'tip-target'));
      item.addEventListener('click', () => {
        this.hideMenu();
        opt.action();
      });
      this.menu.appendChild(item);
    }
    this.menu.hidden = false;
    const parent = this.menu.parentElement!.getBoundingClientRect();
    const w = this.menu.offsetWidth;
    const h = this.menu.offsetHeight;
    const left = Math.min(Math.max(0, x - w / 2), parent.width - w);
    const top = Math.min(Math.max(0, y - 8), parent.height - h);
    this.menu.style.transform = `translate(${left}px, ${top}px)`;
  }

  hideMenu(): void {
    this.menu.hidden = true;
  }

  renderSelf(self: SelfState): void {
    el('player-name').textContent = self.name;
    el('combat-level').textContent = `Combat level ${self.combatLevel}`;
    const grid = el('skills-grid');
    grid.replaceChildren();
    let total = 0;
    for (const skill of SKILLS) {
      const xp = self.skills[skill.id];
      const level = levelForXp(xp);
      total += level;
      const next = level >= MAX_LEVEL ? null : xpForLevel(level + 1);
      const cell = document.createElement('div');
      cell.className = 'skill';
      cell.title = next === null ? `${skill.name}: ${xp.toLocaleString()} XP` : `${skill.name}: ${xp.toLocaleString()} XP\n${(next - xp).toLocaleString()} XP to level ${level + 1}`;
      const icon = span(skill.name.slice(0, 2), `skill-icon skill-${skill.id}`);
      const info = document.createElement('div');
      info.className = 'skill-info';
      info.append(span(skill.name, 'skill-name'), span(`${level}`, 'skill-level'));
      const bar = document.createElement('div');
      bar.className = 'skill-bar';
      const fill = document.createElement('div');
      const prev = xpForLevel(level);
      fill.style.width = next === null ? '100%' : `${((xp - prev) / (next - prev)) * 100}%`;
      bar.appendChild(fill);
      const toNext = span(next === null ? 'Max' : `${(next - xp).toLocaleString()} to go`, 'skill-next');
      cell.append(icon, info, bar, toNext);
      grid.appendChild(cell);
    }
    el('total-level').textContent = `Total level ${total}`;
  }

  private buildTabs(): void {
    const buttons = document.querySelectorAll<HTMLButtonElement>('.tab');
    const app = el('app');
    // On phones the panels are a sheet: tapping the open tab again closes it.
    if (window.matchMedia('(max-width: 720px)').matches) app.classList.add('sheet-closed');
    buttons.forEach((b) =>
      b.addEventListener('click', () => {
        if (b.classList.contains('active')) {
          app.classList.toggle('sheet-closed');
          return;
        }
        app.classList.remove('sheet-closed');
        buttons.forEach((x) => x.classList.toggle('active', x === b));
        document.querySelectorAll<HTMLElement>('.panel').forEach((p) => (p.hidden = p.id !== `panel-${b.dataset.tab}`));
      }),
    );
  }

  private buildInventory(): void {
    const grid = el('inventory-grid');
    for (let i = 0; i < 28; i++) {
      const slot = document.createElement('div');
      slot.className = 'inv-slot';
      grid.appendChild(slot);
    }
  }

  private buildEquipment(): void {
    const grid = el('equipment-grid');
    for (const name of EQUIPMENT_SLOTS) {
      const slot = document.createElement('div');
      slot.className = `equip-slot equip-${name}`;
      slot.textContent = name;
      grid.appendChild(slot);
    }
  }
}

function el(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node;
}

function span(content: string, className: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = className;
  s.textContent = content;
  return s;
}

function text(content: string): Text {
  return document.createTextNode(content);
}
