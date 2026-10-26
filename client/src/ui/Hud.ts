import {
  ATTACK_STYLES,
  EQUIP_SLOTS,
  ITEMS,
  RANGED_STYLES,
  SKILLS,
  isBow,
  countItem,
  levelForXp,
  xpForLevel,
  MAX_LEVEL,
  type AttackStyle,
  type EquipSlot,
  type Inventory,
  type QuestView,
  type SelfState,
  type SkillId,
  type UiView,
} from '@rpg/shared';
import { itemIcon } from './itemIcons';

export interface MenuOption {
  label: string;
  /** Second part of the label, shown in the target colour (e.g. the entity name). */
  target?: string;
  action: () => void;
}

export interface InventoryHandlers {
  /** A filled slot was tapped or right-clicked, at these screen coordinates. */
  open: (slot: number, x: number, y: number) => void;
  move: (from: number, to: number) => void;
}

/** What the bank, shop and crafting windows ask the game to do. */
export interface WindowHandlers {
  close: () => void;
  withdraw: (index: number, qty: number) => void;
  depositAll: () => void;
  buy: (itemId: string, qty: number) => void;
  craft: (recipeId: string, qty: number) => void;
  examine: (itemId: string) => void;
}

/** What the conversation box asks the game to do: carry on (option 0) or pick an option. */
export interface DialogueHandlers {
  choose: (option: number) => void;
}

/** What the Equipment tab asks the game to do. */
export interface EquipmentHandlers {
  unequip: (slot: EquipSlot) => void;
  setStyle: (style: AttackStyle) => void;
  examine: (itemId: string) => void;
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
  windowHandlers: WindowHandlers = { close: () => {}, withdraw: () => {}, depositAll: () => {}, buy: () => {}, craft: () => {}, examine: () => {} };
  private readonly win = el('window');
  private windowKey = '';
  private equipmentKey = '';
  private skillsKey = '';
  private equipment: SelfState['equipment'] = {};
  equipmentHandlers: EquipmentHandlers = { unequip: () => {}, setStyle: () => {}, examine: () => {} };
  dialogueHandlers: DialogueHandlers = { choose: () => {} };
  private readonly dialogue = el('dialogue');
  private dialogueOptions: string[] | null = null;
  private questsKey = '';
  private readonly openQuests = new Set<string>();
  private readonly questDone = el('quest-complete');
  private questDoneTimer: ReturnType<typeof setTimeout> | null = null;

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
    el('win-close').addEventListener('click', () => this.windowHandlers.close());
    // Anywhere on a page without options carries the conversation on.
    this.dialogue.addEventListener('click', (e) => {
      if (!this.dialogueOptions && !(e.target as HTMLElement).closest('button')) this.dialogueHandlers.choose(0);
    });
    this.questDone.addEventListener('click', () => (this.questDone.hidden = true));
  }

  /** Whether a conversation is showing, and its options (null when it just carries on). */
  get dialogueOpen(): { options: string[] | null } | null {
    return this.dialogue.hidden ? null : { options: this.dialogueOptions };
  }

  private drawDialogue(ui: Extract<UiView, { kind: 'dialogue' }>): void {
    this.dialogue.hidden = false;
    this.dialogue.className = `dialogue-${ui.speaker}`;
    this.dialogueOptions = ui.options ?? null;
    const name = span(ui.name, 'dlg-name');
    const words = document.createElement('p');
    words.className = 'dlg-text';
    words.textContent = ui.text;
    const actions = document.createElement('div');
    actions.className = 'dlg-actions';
    if (ui.options) {
      ui.options.forEach((label, i) => {
        const b = document.createElement('button');
        b.className = 'dlg-option';
        b.append(span(`${i + 1}.`, 'dlg-num'), text(` ${label}`));
        b.addEventListener('click', () => this.dialogueHandlers.choose(i));
        actions.appendChild(b);
      });
    } else {
      const more = document.createElement('button');
      more.className = 'dlg-continue';
      more.textContent = 'Click here to continue';
      more.addEventListener('click', () => this.dialogueHandlers.choose(0));
      actions.appendChild(more);
    }
    this.dialogue.replaceChildren(name, words, actions);
  }

  /** The Quests tab: every quest, coloured by progress, with its journal underneath. */
  renderQuests(quests: QuestView[], points: number): void {
    const key = JSON.stringify([quests, points, [...this.openQuests]]);
    if (key === this.questsKey) return;
    this.questsKey = key;
    const list = el('quest-list');
    list.replaceChildren();
    el('quest-points').textContent = `Quest points: ${points}`;
    for (const q of quests) {
      const item = document.createElement('div');
      item.className = `quest quest-${q.status}`;
      const head = document.createElement('button');
      head.className = 'quest-name';
      head.textContent = q.name;
      head.setAttribute('aria-expanded', String(this.openQuests.has(q.id)));
      head.addEventListener('click', () => {
        if (this.openQuests.has(q.id)) this.openQuests.delete(q.id);
        else this.openQuests.add(q.id);
        this.renderQuests(quests, points);
      });
      item.appendChild(head);
      if (this.openQuests.has(q.id)) {
        const journal = document.createElement('div');
        journal.className = 'quest-journal';
        for (const step of q.steps) {
          const line = document.createElement('p');
          line.textContent = step.text;
          if (step.done) line.className = 'done';
          journal.appendChild(line);
        }
        if (q.status === 'done') journal.appendChild(span('QUEST COMPLETE!', 'quest-done-line'));
        else {
          journal.appendChild(span('Rewards', 'quest-rewards-title'));
          for (const r of q.rewards) journal.appendChild(span(r, 'quest-reward'));
        }
        item.appendChild(journal);
      }
      list.appendChild(item);
    }
  }

  /** The scroll that unrolls when a quest is finished. */
  showQuestComplete(name: string, rewards: string[], points: number): void {
    const title = span('Quest complete!', 'qc-title');
    const quest = span(`You have completed ${name}.`, 'qc-name');
    const list = document.createElement('ul');
    for (const r of rewards) {
      const li = document.createElement('li');
      li.textContent = r;
      list.appendChild(li);
    }
    const total = span(`Quest points: ${points}`, 'qc-points');
    const hint = span('Click to close', 'lu-hint');
    this.questDone.replaceChildren(title, quest, span('You are awarded:', 'qc-sub'), list, total, hint);
    this.questDone.hidden = false;
    if (this.questDoneTimer) clearTimeout(this.questDoneTimer);
    this.questDoneTimer = setTimeout(() => (this.questDone.hidden = true), 12000);
  }

  /** Draws the open bank, shop or crafting window, or hides it. */
  renderWindow(self: SelfState): void {
    const ui = self.ui;
    // Redraw only when what it shows changes; crafting also depends on the inventory and levels.
    const key = JSON.stringify(ui?.kind === 'craft' ? [ui, self.inventory, self.skills] : ui);
    if (key === this.windowKey) return;
    this.windowKey = key;
    if (ui?.kind !== 'dialogue') {
      this.dialogue.hidden = true;
      this.dialogueOptions = null;
    }
    if (!ui || ui.kind === 'dialogue') {
      this.win.hidden = true;
      if (ui) this.drawDialogue(ui);
      return;
    }
    this.win.hidden = false;
    const body = el('win-body');
    const foot = el('win-foot');
    body.replaceChildren();
    foot.replaceChildren();
    if (ui.kind === 'bank') this.drawBank(ui, body, foot);
    else if (ui.kind === 'shop') this.drawShop(ui, body, foot);
    else this.drawCraft(ui, self, body);
  }

  private drawBank(ui: Extract<UiView, { kind: 'bank' }>, body: HTMLElement, foot: HTMLElement): void {
    el('win-title').textContent = 'Bank of Kelmoor';
    const grid = document.createElement('div');
    grid.className = 'win-grid';
    ui.items.forEach((stack, index) => {
      const name = ITEMS[stack.itemId]?.name ?? stack.itemId;
      const slot = itemSlot(stack.itemId, stack.qty, name);
      slot.addEventListener('click', (e) =>
        this.showMenu(e.clientX, e.clientY, [
          { label: 'Withdraw-1', target: name, action: () => this.windowHandlers.withdraw(index, 1) },
          { label: 'Withdraw-5', target: name, action: () => this.windowHandlers.withdraw(index, 5) },
          { label: 'Withdraw-All', target: name, action: () => this.windowHandlers.withdraw(index, stack.qty) },
          { label: 'Examine', target: name, action: () => this.windowHandlers.examine(stack.itemId) },
        ]),
      );
      grid.appendChild(slot);
    });
    if (!ui.items.length) body.append(span('Your bank is empty. Click items in your inventory to deposit them.', 'muted'));
    else body.appendChild(grid);
    const all = document.createElement('button');
    all.textContent = 'Deposit inventory';
    all.addEventListener('click', () => this.windowHandlers.depositAll());
    foot.append(all);
  }

  private drawShop(ui: Extract<UiView, { kind: 'shop' }>, body: HTMLElement, foot: HTMLElement): void {
    el('win-title').textContent = ui.name;
    const grid = document.createElement('div');
    grid.className = 'win-grid';
    for (const { itemId, price } of ui.stock) {
      const name = ITEMS[itemId]?.name ?? itemId;
      const slot = itemSlot(itemId, 1, `${name}: ${price} coins`);
      slot.appendChild(span(`${price}`, 'win-price'));
      slot.addEventListener('click', (e) =>
        this.showMenu(e.clientX, e.clientY, [
          { label: 'Buy 1', target: name, action: () => this.windowHandlers.buy(itemId, 1) },
          { label: 'Buy 5', target: name, action: () => this.windowHandlers.buy(itemId, 5) },
          { label: 'Buy 10', target: name, action: () => this.windowHandlers.buy(itemId, 10) },
          { label: 'Examine', target: name, action: () => this.windowHandlers.examine(itemId) },
        ]),
      );
      grid.appendChild(slot);
    }
    body.appendChild(grid);
    foot.textContent = 'Prices are in coins. Click an item in your inventory to sell it.';
  }

  private drawCraft(ui: Extract<UiView, { kind: 'craft' }>, self: SelfState, body: HTMLElement): void {
    el('win-title').textContent = ui.title;
    for (const r of ui.recipes) {
      const level = levelForXp(self.skills[r.skill]);
      // A batch of one-for-one parts (shafts and feathers) can be made short.
      const partial = r.outputQty > 1 && r.inputs.every((i) => i.qty === r.outputQty);
      const canMake = Math.min(...r.inputs.map((i) => Math.floor(countItem(self.inventory, i.itemId) / (partial ? 1 : i.qty))));
      const hasTool = !r.tool || countItem(self.inventory, r.tool) > 0;
      const ok = level >= r.level && canMake > 0 && hasTool;
      const row = document.createElement('div');
      row.className = `recipe${ok ? '' : ' unavailable'}`;
      const icon = document.createElement('div');
      icon.className = 'recipe-icon';
      icon.innerHTML = itemIcon(r.output);
      const info = document.createElement('div');
      const name = document.createElement('div');
      name.className = 'recipe-name';
      name.textContent = `${r.outputQty > 1 ? `${r.outputQty} × ` : ''}${ITEMS[r.output]?.name ?? r.output}`;
      const detail = document.createElement('div');
      detail.className = 'recipe-detail';
      const skill = SKILLS.find((s) => s.id === r.skill)?.name ?? r.skill;
      const needs = r.inputs.map((i) => `${i.qty} × ${ITEMS[i.itemId]?.name ?? i.itemId}`).join(', ');
      const tool = r.tool ? ` · needs ${ITEMS[r.tool]?.name.toLowerCase() ?? r.tool}` : '';
      detail.textContent = `${skill} ${r.level} · ${needs}${tool} · ${r.xp} XP`;
      info.append(name, detail);
      const buttons = document.createElement('div');
      buttons.className = 'recipe-buttons';
      for (const [label, qty] of [['1', 1], ['5', 5], ['All', 1000]] as const) {
        const b = document.createElement('button');
        b.textContent = label;
        b.disabled = !ok;
        b.addEventListener('click', () => this.windowHandlers.craft(r.id, qty));
        buttons.appendChild(b);
      }
      row.append(icon, info, buttons);
      body.appendChild(row);
    }
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

  /** The Equipment tab: what's worn, its bonuses, and the fighting style. */
  renderEquipment(self: SelfState): void {
    const key = JSON.stringify([self.equipment, self.attackStyle, self.bonuses, self.maxHit]);
    if (key === this.equipmentKey) return;
    this.equipmentKey = key;
    this.equipment = self.equipment;
    for (const slot of EQUIP_SLOTS) {
      const cell = el('equipment-grid').querySelector<HTMLElement>(`.equip-${slot}`)!;
      const itemId = self.equipment[slot];
      cell.classList.toggle('filled', !!itemId);
      cell.title = itemId ? `${ITEMS[itemId]?.name ?? itemId}: tap to take off` : slot;
      cell.innerHTML = itemId ? itemIcon(itemId) : '';
      if (!itemId) cell.textContent = slot;
    }
    const b = self.bonuses;
    const bow = isBow(self.equipment.weapon);
    const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
    el('equip-stats').replaceChildren(
      ...(bow
        ? [`Ranged ${sign(ITEMS[self.equipment.weapon!].equip!.attack ?? 0)}`, `Range ${ITEMS[self.equipment.weapon!].equip!.range} tiles`, `Defence ${sign(b.defence)}`, `Max hit ${self.maxHit}`]
        : [`Attack ${sign(b.attack)}`, `Strength ${sign(b.strength)}`, `Defence ${sign(b.defence)}`, `Max hit ${self.maxHit}`]
      ).map((t) => span(t, 'equip-stat')),
    );
    const styles = el('attack-styles');
    styles.replaceChildren();
    for (const [id, info] of Object.entries(ATTACK_STYLES) as [AttackStyle, (typeof ATTACK_STYLES)[AttackStyle]][]) {
      const b = document.createElement('button');
      b.className = `style-button${self.attackStyle === id ? ' active' : ''}`;
      const skill = SKILLS.find((s) => s.id === info.skill)?.name ?? info.skill;
      if (bow) b.append(span(RANGED_STYLES[id].label, 'style-name'), span(RANGED_STYLES[id].detail, 'style-detail'));
      else b.append(span(info.label, 'style-name'), span(`${skill} XP, +3 ${skill.toLowerCase()}`, 'style-detail'));
      b.addEventListener('click', () => this.equipmentHandlers.setStyle(id));
      styles.appendChild(b);
    }
  }

  renderSelf(self: SelfState): void {
    el('player-name').textContent = self.name;
    el('combat-level').textContent = `Combat level ${self.combatLevel}`;
    el('hp-text').textContent = `${self.hp} / ${self.maxHp}`;
    el('hp-fill').style.width = `${(self.hp / self.maxHp) * 100}%`;
    el('hp-bar').classList.toggle('low', self.hp <= self.maxHp / 4);
    // The state comes every tick something changes; rebuild the skills only when XP moves.
    const key = JSON.stringify(self.skills);
    if (key === this.skillsKey) return;
    this.skillsKey = key;
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
    for (const name of EQUIP_SLOTS) {
      const slot = document.createElement('div');
      slot.className = `equip-slot equip-${name}`;
      slot.textContent = name;
      slot.addEventListener('click', (e) => {
        const itemId = this.equipment[name];
        if (!itemId) return;
        const label = ITEMS[itemId]?.name ?? itemId;
        this.showMenu(e.clientX, e.clientY, [
          { label: 'Remove', target: label, action: () => this.equipmentHandlers.unequip(name) },
          { label: 'Examine', target: label, action: () => this.equipmentHandlers.examine(itemId) },
        ]);
      });
      grid.appendChild(slot);
    }
  }
}

/** An item square like an inventory slot, for the bank and shop windows. */
function itemSlot(itemId: string, qty: number, title: string): HTMLElement {
  const slot = document.createElement('div');
  slot.className = 'inv-slot filled';
  slot.title = title;
  slot.innerHTML = itemIcon(itemId);
  if (qty > 1) slot.appendChild(span(qty.toLocaleString(), 'inv-qty'));
  return slot;
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
