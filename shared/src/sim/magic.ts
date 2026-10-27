import type { Point } from '../map/types';
import spellData from '../../data/spells.json';
import { ITEMS, countItem, type Equipment, type Inventory } from './items';

/**
 * Magic: spells cast with glyphs from the pack. Combat spells are thrown at a
 * monster from range; teleports move the caster; item spells work on
 * something in the pack. An elemental staff stands in for its element's glyphs.
 */
export type SpellKind = 'combat' | 'teleport' | 'item';

export interface SpellDef {
  id: string;
  name: string;
  kind: SpellKind;
  level: number;
  xp: number;
  /** Glyphs used up per cast, by element ("wind" for wind glyphs). */
  glyphs: Record<string, number>;
  description: string;
  /** Combat spells. */
  element?: string;
  tier?: number;
  maxHit?: number;
  /** Teleports: where to, and the name of the place. */
  to?: Point;
  place?: string;
  /** Hearth Recall: chanted slowly, free, and not in a fight. */
  recall?: boolean;
  /** Item spells: what they do, and for gilding the share of the item's value paid. */
  effect?: 'gild' | 'smelt';
  rate?: number;
}

export const SPELLS: readonly SpellDef[] = spellData.spells as SpellDef[];
export const SPELL_BY_ID: Readonly<Record<string, SpellDef>> = Object.fromEntries(SPELLS.map((s) => [s.id, s]));
/** Furthest a spell can be thrown, in tiles. */
export const MAGIC_RANGE = spellData.range;
/** Ticks between casts in a fight. */
export const CAST_TICKS = spellData.castTicks;
/** Ticks a teleport takes, from the first word to arriving. */
export const TELEPORT_TICKS = spellData.teleportTicks;
/** Ticks of chanting before Hearth Recall takes you home. */
export const RECALL_TICKS = spellData.recallTicks;
export const MAGIC_XP_PER_DAMAGE = spellData.xpPerDamage;

export const glyphItem = (element: string) => `${element}_glyph`;

/** The element an elemental staff in hand stands in for, if any. */
export function staffElement(equipment: Equipment): string | undefined {
  return equipment.weapon ? ITEMS[equipment.weapon]?.equip?.staffOf : undefined;
}

/** Glyphs a cast would take from the pack: the spell's cost, less what the staff covers. */
export function glyphCost(spell: SpellDef, equipment: Equipment): { itemId: string; qty: number }[] {
  const free = staffElement(equipment);
  return Object.entries(spell.glyphs)
    .filter(([element]) => element !== free)
    .map(([element, qty]) => ({ itemId: glyphItem(element), qty }));
}

/** Glyphs short for one cast, by item, or an empty list when there are enough. */
export function missingGlyphs(spell: SpellDef, inventory: Inventory, equipment: Equipment): { itemId: string; qty: number }[] {
  return glyphCost(spell, equipment)
    .map(({ itemId, qty }) => ({ itemId, qty: qty - countItem(inventory, itemId) }))
    .filter((m) => m.qty > 0);
}

/** How many casts the pack (and staff) has glyphs for. */
export function castsLeft(spell: SpellDef, inventory: Inventory, equipment: Equipment): number {
  const cost = glyphCost(spell, equipment);
  if (!cost.length) return Infinity;
  return Math.min(...cost.map(({ itemId, qty }) => Math.floor(countItem(inventory, itemId) / qty)));
}
