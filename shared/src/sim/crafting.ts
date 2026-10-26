import recipeData from '../../data/recipes.json';
import shopData from '../../data/shops.json';
import type { SkillId } from './skills';

/** Where things are made. Fletching isn't a place: it opens from the pack, anywhere. */
export type StationKind = 'furnace' | 'anvil' | 'range' | 'fletching';

export interface Recipe {
  id: string;
  station: StationKind;
  skill: SkillId;
  level: number;
  xp: number;
  ticks: number;
  inputs: { itemId: string; qty: number }[];
  output: string;
  /** How many one go makes, when more than one (15 arrow shafts from a log). */
  outputQty?: number;
  /** An item that must be carried, not used up (a knife). */
  tool?: string;
  /** Cooking only: the level from which it never burns, and what a burnt one becomes. */
  stopBurn?: number;
  burnt?: string;
}

export const RECIPES: readonly Recipe[] = recipeData.recipes as Recipe[];
export const RECIPE_BY_ID: Readonly<Record<string, Recipe>> = Object.fromEntries(RECIPES.map((r) => [r.id, r]));

export const STATION_TITLES: Record<StationKind, string> = {
  furnace: 'What would you like to smelt?',
  anvil: 'What would you like to smith?',
  range: 'What would you like to cook?',
  fletching: 'What would you like to fletch?',
};

/** Whether using an item from the pack opens the fletching window: a knife, or anything fletched from. */
export function opensFletching(itemId: string): boolean {
  return itemId === 'knife' || RECIPES.some((r) => r.station === 'fletching' && r.inputs.some((i) => i.itemId === itemId));
}

/** Chance a cooking attempt burns the food. */
export function burnChance(recipe: Recipe, level: number): number {
  if (!recipe.stopBurn || level >= recipe.stopBurn) return 0;
  return 0.5 * ((recipe.stopBurn - level) / (recipe.stopBurn - recipe.level));
}

export interface ShopDef {
  id: string;
  name: string;
  npc: string;
  buys: 'all' | string[];
  stock: string[];
}

export const SELL_RATE = shopData.sellRate;
export const SHOPS: Readonly<Record<string, ShopDef>> = Object.fromEntries(
  Object.entries(shopData.shops).map(([id, s]) => [id, { id, ...s } as ShopDef]),
);

export function shopForNpc(npcKey: string): ShopDef | undefined {
  return Object.values(SHOPS).find((s) => s.npc === npcKey);
}

/** Bankers are whoever the map calls a banker. */
export function isBanker(npc: { role: string } | undefined): boolean {
  return npc?.role === 'Banker';
}

export function shopBuys(shop: ShopDef, itemId: string): boolean {
  if (itemId === 'coins') return false;
  return shop.buys === 'all' || shop.buys.includes(itemId) || shop.stock.includes(itemId);
}
