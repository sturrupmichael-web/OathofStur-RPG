import type { Point } from '../map/types';
import { INVENTORY_SIZE, ITEMS, type Inventory } from './items';
import { MAX_XP, SKILLS, startingXp, type SkillXp } from './skills';

export const SAVE_VERSION = 1;

/**
 * Everything needed to bring a character back. XP is stored, levels are
 * derived. The same record maps one-to-one onto a per-account row once the
 * server keeps saves (phase 6). Equipment, bank and quests are empty until
 * the phases that add them.
 */
export interface SaveData {
  version: number;
  name: string;
  position: Point;
  skills: SkillXp;
  inventory: Inventory;
  equipment: Record<string, string>;
  bank: { itemId: string; qty: number }[];
  quests: Record<string, number>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Checks and cleans a save that came from storage or a file the player
 * imported. Unknown items and skills are dropped rather than trusted; anything
 * that isn't recognisably a save returns null. Older versions migrate here.
 */
export function parseSave(raw: unknown): SaveData | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<SaveData>;
  if (typeof s.version !== 'number' || s.version < 1 || s.version > SAVE_VERSION) return null;
  if (typeof s.name !== 'string' || !s.position || typeof s.skills !== 'object' || !Array.isArray(s.inventory)) return null;
  const x = Number(s.position.x);
  const y = Number(s.position.y);
  if (!Number.isInteger(x) || !Number.isInteger(y)) return null;

  const skills = startingXp();
  for (const { id } of SKILLS) {
    const xp = Number((s.skills as Record<string, unknown>)[id]);
    if (Number.isFinite(xp) && xp >= 0) skills[id] = Math.min(Math.floor(xp * 10) / 10, MAX_XP);
  }

  const inventory: Inventory = [];
  for (let i = 0; i < INVENTORY_SIZE; i++) {
    const slot = s.inventory[i] as { itemId?: unknown; qty?: unknown } | null | undefined;
    const qty = Number(slot?.qty);
    const valid = slot && typeof slot.itemId === 'string' && ITEMS[slot.itemId] && Number.isInteger(qty) && qty >= 1;
    inventory.push(valid ? { itemId: slot.itemId as string, qty: ITEMS[slot.itemId as string].stackable ? qty : 1 } : null);
  }

  const now = new Date().toISOString();
  return {
    version: SAVE_VERSION,
    name: s.name.trim().slice(0, 12) || 'Adventurer',
    position: { x, y },
    skills,
    inventory,
    equipment: {},
    bank: [],
    quests: {},
    createdAt: typeof s.createdAt === 'string' ? s.createdAt : now,
    updatedAt: typeof s.updatedAt === 'string' ? s.updatedAt : now,
  };
}
