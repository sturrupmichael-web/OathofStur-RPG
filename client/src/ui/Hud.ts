import { ITEMS, SKILLS, levelForXp, xpForLevel, MAX_LEVEL, type Inventory, type SelfState, type SkillId } from '@rpg/shared';
import { itemIcon } from './itemIcons';

export interface MenuOption {
  label: string;
  /** Second part of the label, shown in the target colour (e.g. the entity name). */
  target?: string;
  action: () => void;
}

const EQUIPMENT_SLOTS = ['helmet', 'weapon', 'body', 'shield', 'legs'] as const;

export interface InventoryHandlers {
  /** A filled slot was tapped or right-clicked, at these screen coordinates. */
  open: (slot: number, x: number, y: number) => void;
  move: (from: number, to: number) => void;
}

/** DOM side of the interface: side panel, chat, tooltip and context menu. */
export class Hud {
  private readonly chatLog = el('chat-log');
  private readonly tooltip = el('tooltip');
  private readonly menu = el('context-menu');
  private readonly xpDrops = el('xp-drops');
  private readonly levelUpBox = el('level-up');
  private levelUpTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByOutsidePress = false;
  private inventory: Inventory = [];
  inventoryHandlers: InventoryHandlers = { open: () => {}, move: () => {} };

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
    this.levelUpBox.addEventListener('click', () => (this.levelUpBox.hidden = true));
  }

  /** Floating "+25" next to the skill's icon in the corner of the view. */
  showXpDrop(skill: SkillId, amount: number): void {
    const drop = document.createElement('div');
    drop.className = 'xp-drop';
    const name = SKILLS.find((s) => s.id === skill)?.name ?? skill;
    drop.append(span(name.slice(0, 2), `skill-icon skill-${skill}`), text(`+${amount}`));
    this.xpDrops.appendChild(drop);
    drop.addEventListener('animationend', () => drop.remove());
  }

  showLevelUp(skill: SkillId, level: number): void {
    const name = SKILLS.find((s) => s.id === skill)?.name ?? skill;
    const article = /^[AEIOU]/.test(name) ? 'an' : 'a';
    const title = document.createElement('div');
    title.className = 'lu-title';
    title.textContent = `${name} level ${level}!`;
    const body = document.createElement('div');
    body.className = 'lu-text';
    body.textContent = `Congratulations, you've just advanced ${article} ${name} level. You are now level ${level}.`;
    const hint = document.createElement('div');
    hint.className = 'lu-hint';
    hint.textContent = 'Click to close';
    this.levelUpBox.replaceChildren(title, body, hint);
    this.levelUpBox.hidden = false;
    // Restart the pop animation when levels come back to back.
    this.levelUpBox.style.animation = 'none';
    void this.levelUpBox.offsetWidth;
    this.levelUpBox.style.animation = '';
    if (this.levelUpTimer) clearTimeout(this.levelUpTimer);
    this.levelUpTimer = setTimeout(() => (this.levelUpBox.hidden = true), 5000);
  }

  renderInventory(inv: Inventory): void {
    this.inventory = inv;
    el('inventory-grid')
      .querySelectorAll<HTMLElement>('.inv-slot')
      .forEach((slot, i) => {
        const stack = inv[i];
        const key = stack ? `${stack.itemId}:${stack.qty}` : '';
        if (slot.dataset.key === key) return;
        slot.dataset.key = key;
        slot.classList.toggle('filled', !!stack);
        slot.title = stack ? ITEMS[stack.itemId]?.name ?? stack.itemId : '';
        slot.innerHTML = stack ? itemIcon(stack.itemId) : '';
        if (stack && stack.qty > 1) slot.appendChild(span(stack.qty.toLocaleString(), 'inv-qty'));
      });
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
    // Screen coordinates: the menu is fixed to the window so it works over the panels too.
    const w = this.menu.offsetWidth;
    const h = this.menu.offsetHeight;
    const left = Math.min(Math.max(0, x - w / 2), window.innerWidth - w);
    const top = Math.min(Math.max(0, y - 8), Math.max(0, window.innerHeight - h));
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

  /**
   * Tap (or right-click) a slot for its options; drag an item onto another
   * slot to swap them. Pointer events cover mouse, pen and touch alike.
   */
  private buildInventory(): void {
    const grid = el('inventory-grid');
    const slots: HTMLElement[] = [];
    for (let i = 0; i < 28; i++) {
      const slot = document.createElement('div');
      slot.className = 'inv-slot';
      slot.dataset.slot = String(i);
      grid.appendChild(slot);
      slots.push(slot);
    }
    let drag: { from: number; x: number; y: number; moved: boolean; pointerId: number } | null = null;
    let target: HTMLElement | null = null;
    const slotAt = (x: number, y: number) => (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('.inv-slot') ?? null;
    const clearTarget = () => {
      target?.classList.remove('drop-target');
      target = null;
    };
    grid.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const slot = (e.target as HTMLElement).closest<HTMLElement>('.inv-slot');
      if (slot && this.inventory[Number(slot.dataset.slot)]) this.inventoryHandlers.open(Number(slot.dataset.slot), e.clientX, e.clientY);
    });
    grid.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const slot = (e.target as HTMLElement).closest<HTMLElement>('.inv-slot');
      if (!slot || !this.inventory[Number(slot.dataset.slot)]) return;
      drag = { from: Number(slot.dataset.slot), x: e.clientX, y: e.clientY, moved: false, pointerId: e.pointerId };
      grid.setPointerCapture(e.pointerId);
    });
    grid.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 8) {
        drag.moved = true;
        slots[drag.from].classList.add('dragging');
      }
      if (!drag.moved) return;
      const over = slotAt(e.clientX, e.clientY);
      if (over !== target) {
        clearTarget();
        if (over && over !== slots[drag.from]) {
          target = over;
          over.classList.add('drop-target');
        }
      }
    });
    const end = (e: PointerEvent, cancelled: boolean) => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      const { from, moved } = drag;
      drag = null;
      slots[from].classList.remove('dragging');
      const to = target ? Number(target.dataset.slot) : null;
      clearTarget();
      if (cancelled) return;
      if (moved && to !== null) this.inventoryHandlers.move(from, to);
      else if (!moved) this.inventoryHandlers.open(from, e.clientX, e.clientY);
    };
    grid.addEventListener('pointerup', (e) => end(e, false));
    grid.addEventListener('pointercancel', (e) => end(e, true));
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
