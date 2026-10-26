import type { Point } from '../map/types';
import { ATTACK_STYLES, type AttackStyle } from './combat';
import { QUESTS, QUEST_IDS, doneStage } from './quests';
import { EQUIP_SLOTS, INVENTORY_SIZE, ITEMS, type Equipment, type Inventory, type ItemStack } from './items';
import { MAX_XP, SKILLS, startingXp, type SkillXp } from './skills';

export const SAVE_VERSION = 3;

/**
 * Version 1 saves hold Kelmoor's own coordinates. Kelmoor now sits inside the
 * Vell Reaches at this offset, so an old character keeps the spot they left.
 */
const KELMOOR_OFFSET = { x: 130, y: 70 };

/**
 * Everything needed to bring a character back. XP is stored, levels are
 * derived. The same record maps one-to-one onto a per-account row once the
 * server keeps saves (phase 6). `quests` holds the stage reached in each quest.
 * Version 3 added hp and attackStyle; older saves start at full health.
 */
export interface SaveData {
  version: number;
  name: string;
  position: Point;
  skills: SkillXp;
  inventory: Inventory;
  equipment: Equipment;
  /** Current hitpoints. Left out means full. */
  hp?: number;
  attackStyle?: AttackStyle;
  /** Prayer points left. Left out means full. */
  prayer?: number;
  bank: ItemStack[];
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
  let x = Number(s.position.x);
  let y = Number(s.position.y);
  if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
  if (s.version < 2) {
    x += KELMOOR_OFFSET.x;
    y += KELMOOR_OFFSET.y;
  }

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

  const bank: ItemStack[] = [];
  for (const entry of Array.isArray(s.bank) ? s.bank : []) {
    const qty = Number(entry?.qty);
    if (!entry || typeof entry.itemId !== 'string' || !ITEMS[entry.itemId] || !Number.isInteger(qty) || qty < 1) continue;
    const existing = bank.find((b) => b.itemId === entry.itemId);
    if (existing) existing.qty += qty;
    else bank.push({ itemId: entry.itemId, qty });
  }

  const equipment: Equipment = {};
  const worn = (s.equipment ?? {}) as Record<string, unknown>;
  for (const slot of EQUIP_SLOTS) {
    const itemId = worn[slot];
    if (typeof itemId === 'string' && ITEMS[itemId]?.equip?.slot === slot) equipment[slot] = itemId;
  }
  const hp = Number(s.hp);
  const prayer = Number(s.prayer);
  const style = typeof s.attackStyle === 'string' && s.attackStyle in ATTACK_STYLES ? s.attackStyle : undefined;
  const quests: Record<string, number> = {};
  const saved = (s.quests ?? {}) as Record<string, unknown>;
  for (const id of QUEST_IDS) {
    const stage = Number(saved[id]);
    if (Number.isInteger(stage) && stage > 0) quests[id] = Math.min(stage, doneStage(QUESTS[id]));
  }

  const now = new Date().toISOString();
  return {
    version: SAVE_VERSION,
    name: s.name.trim().slice(0, 12) || 'Adventurer',
    position: { x, y },
    skills,
    inventory,
    equipment,
    ...(Number.isInteger(hp) && hp >= 1 && { hp }),
    ...(Number.isInteger(prayer) && prayer >= 0 && { prayer }),
    ...(style && { attackStyle: style }),
    bank,
    quests,
    createdAt: typeof s.createdAt === 'string' ? s.createdAt : now,
    updatedAt: typeof s.updatedAt === 'string' ? s.updatedAt : now,
  };
}
