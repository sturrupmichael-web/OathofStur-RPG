import itemData from '../../data/items.json';
import type { SkillId } from './skills';

export interface ItemDef {
  id: string;
  name: string;
  examine: string;
  stackable?: boolean;
  /** Shop price in coins. */
  value: number;
  /** Hitpoints restored when eaten. */
  heals?: number;
  /** Shields that turn fire: breath attacks do a third of the damage. */
  fireward?: boolean;
  /** Set on things that can be worn or wielded. */
  equip?: EquipStats;
  /** Arrows: their strength bonus, and the Ranged level needed to fire them. */
  ammo?: { strength: number; level: number };
  /** Logs: the Firemaking level needed to light them, and the XP for it. */
  burn?: { level: number; xp: number };
  /** Grimy herbs: the Herblore level to clean one, the XP for it, and the clean herb it becomes. */
  clean?: { level: number; xp: number; into: string };
  /** Bones (and ashes): Prayer XP for burying (or scattering) them. */
  bury?: { xp: number };
  /** A potion dose: what it does, and what is left in the hand after (a smaller dose, or an empty vial). */
  drink?: PotionEffect;
  /** Set on tools: the skill it is used for, the level needed, and its success bonus. */
  tool?: { skill: SkillId; level: number; bonus: number };
}

/**
 * What a dose of potion does. `boost` raises each skill by base + pct% of its
 * level (for a while); `prayer` restores base + pct% of the Prayer level;
 * `fireward` softens dragonfire for that many ticks.
 */
export interface PotionEffect {
  boost?: SkillId[];
  prayer?: boolean;
  base?: number;
  pct?: number;
  fireward?: number;
  next: string;
}

export type EquipSlot = 'helmet' | 'weapon' | 'body' | 'shield' | 'legs';
export const EQUIP_SLOTS: readonly EquipSlot[] = ['helmet', 'weapon', 'body', 'shield', 'legs'];

export interface EquipStats {
  slot: EquipSlot;
  attack?: number;
  strength?: number;
  defence?: number;
  /** Bonus to casting spells; metal armour gets in the way. */
  magic?: number;
  /** Attack level to wield a weapon (Ranged for a bow), Defence level to wear armour. */
  level?: number;
  /** Which skill `level` is in, when not the usual one (Magic for staves and robes). */
  skill?: SkillId;
  /** Elemental staves: the glyph element they stand in for. */
  staffOf?: string;
  /** Weapons: how it is swung (or shot), which picks the animation. */
  style?: 'stab' | 'slash' | 'bash' | 'shoot';
  /** Bows: how many tiles away they can hit from. */
  range?: number;
  /** Ticks between attacks, when not the usual 4. */
  speed?: number;
}

/** What a player is wearing, item id per slot. */
export type Equipment = Partial<Record<EquipSlot, string>>;

export const ITEMS: Readonly<Record<string, ItemDef>> = Object.fromEntries(
  (itemData.items as ItemDef[]).map((item) => [item.id, item]),
);

export const INVENTORY_SIZE = 28;

export interface ItemStack {
  itemId: string;
  qty: number;
}

export type Inventory = (ItemStack | null)[];

export function emptyInventory(): Inventory {
  return new Array<ItemStack | null>(INVENTORY_SIZE).fill(null);
}

/** Whether `qty` of an item would fit. Stackables need one slot (or an existing stack). */
export function canAdd(inv: Inventory, itemId: string, qty = 1): boolean {
  if (ITEMS[itemId]?.stackable) return inv.some((s) => s === null || s.itemId === itemId);
  return inv.filter((s) => s === null).length >= qty;
}

/** Adds items if they all fit; returns false (and changes nothing) if they don't. */
export function addItem(inv: Inventory, itemId: string, qty = 1): boolean {
  if (!ITEMS[itemId] || qty < 1 || !canAdd(inv, itemId, qty)) return false;
  if (ITEMS[itemId].stackable) {
    const stack = inv.find((s) => s?.itemId === itemId);
    if (stack) stack.qty += qty;
    else inv[inv.indexOf(null)] = { itemId, qty };
    return true;
  }
  for (let n = 0; n < qty; n++) inv[inv.indexOf(null)] = { itemId, qty: 1 };
  return true;
}

/** The best tool for a skill that the player has the level to use, or null. */
export function bestTool(inv: Inventory, skill: SkillId, level: number): ItemDef | null {
  let best: ItemDef | null = null;
  for (const s of inv) {
    const tool = s && ITEMS[s.itemId]?.tool;
    if (!tool || tool.skill !== skill || tool.level > level) continue;
    if (!best || tool.bonus > best.tool!.bonus) best = ITEMS[s!.itemId];
  }
  return best;
}

/** Whether the player carries any tool for a skill, whatever its level. */
export function hasAnyTool(inv: Inventory, skill: SkillId): boolean {
  return inv.some((s) => s !== null && ITEMS[s.itemId]?.tool?.skill === skill);
}

/** Whether an item is a bow (fights from range with arrows). */
export function isBow(itemId: string | undefined): boolean {
  return !!itemId && ITEMS[itemId]?.equip?.style === 'shoot';
}

/** Staves: what a mage wields to cast with. */
export function isStaff(itemId: string | undefined): boolean {
  return !!itemId && ITEMS[itemId]?.equip?.style === 'bash';
}

/** The strongest arrows in the pack that a Ranged level can fire, or null. */
export function bestArrows(inv: Inventory, rangedLevel: number): ItemDef | null {
  let best: ItemDef | null = null;
  for (const s of inv) {
    const ammo = s && ITEMS[s.itemId]?.ammo;
    if (!ammo || ammo.level > rangedLevel) continue;
    if (!best || ammo.strength > best.ammo!.strength) best = ITEMS[s!.itemId];
  }
  return best;
}

/** How many of an item the inventory holds. */
export function countItem(inv: Inventory, itemId: string): number {
  return inv.reduce((n, s) => n + (s?.itemId === itemId ? s.qty : 0), 0);
}

export function hasItem(inv: Inventory, itemId: string, qty = 1): boolean {
  return countItem(inv, itemId) >= qty;
}

/** Removes up to `qty` of an item, last slots first; returns how many were removed. */
export function removeItem(inv: Inventory, itemId: string, qty = 1): number {
  let left = qty;
  for (let i = inv.length - 1; i >= 0 && left > 0; i--) {
    const s = inv[i];
    if (s?.itemId !== itemId) continue;
    const take = Math.min(s.qty, left);
    s.qty -= take;
    left -= take;
    if (s.qty === 0) inv[i] = null;
  }
  return qty - left;
}

/** How many of an item could be added: unlimited-ish for a stack, else the free slots. */
export function roomFor(inv: Inventory, itemId: string): number {
  if (ITEMS[itemId]?.stackable) return canAdd(inv, itemId) ? Number.MAX_SAFE_INTEGER : 0;
  return inv.filter((s) => s === null).length;
}
