import itemData from '../../data/items.json';
import type { SkillId } from './skills';

export interface ItemDef {
  id: string;
  name: string;
  examine: string;
  stackable?: boolean;
  /** Set on tools: the skill it is used for, the level needed, and its success bonus. */
  tool?: { skill: SkillId; level: number; bonus: number };
}

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
