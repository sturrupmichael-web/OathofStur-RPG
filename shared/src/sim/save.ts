import type { Point } from '../map/types';
import { BOUNTY_TASKS, type BountyState } from './bounty';
import { parseAppearance, type Appearance } from './appearance';
import { ATTACK_STYLES, type AttackStyle } from './combat';
import { QUESTS, QUEST_IDS, doneStage } from './quests';
import { CROPS, MAX_WEEDS, type PatchState } from './farming';
import { FURNITURE, ROOMS, SPOTS, type HomesteadState } from './homestead';
import { SPELL_BY_ID } from './magic';
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
  /** Run energy (left out means full) and whether running is on. */
  energy?: number;
  run?: boolean;
  /** Farming patches the character has worked, by tile ("x,y"). They keep growing from `updatedAt`. */
  farm?: Record<string, PatchState>;
  /** The combat spell a staff casts by itself. */
  autocast?: string;
  /** Hrolf's bounty and points. */
  bounty?: BountyState;
  /** The homestead plot, its rooms and furniture. */
  homestead?: HomesteadState;
  /** How the character looks. Left out for characters made before looks could be chosen. */
  look?: Appearance;
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
  const energy = Number(s.energy);
  const farm = parseFarm(s.farm);
  const bounty = parseBounty(s.bounty);
  const homestead = parseHomestead(s.homestead);
  const look = parseAppearance(s.look);
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
    ...(Number.isFinite(energy) && energy >= 0 && energy <= 100 && { energy }),
    ...(s.run === true && { run: true }),
    ...(farm && { farm }),
    ...(typeof s.autocast === 'string' && SPELL_BY_ID[s.autocast]?.kind === 'combat' && { autocast: s.autocast }),
    ...(bounty && { bounty }),
    ...(homestead && { homestead }),
    ...(look && { look }),
    bank,
    quests,
    createdAt: typeof s.createdAt === 'string' ? s.createdAt : now,
    updatedAt: typeof s.updatedAt === 'string' ? s.updatedAt : now,
  };
}

/** Keeps only patches that make sense: a known crop at a real stage, weeds 0 to 3. */
function parseFarm(raw: unknown): Record<string, PatchState> | null {
  if (!raw || typeof raw !== 'object') return null;
  const out: Record<string, PatchState> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d+,\d+$/.test(key) || !value || typeof value !== 'object') continue;
    const v = value as Partial<PatchState>;
    const weeds = Number(v.weeds);
    const timer = Number(v.timer);
    if (!Number.isInteger(weeds) || weeds < 0 || weeds > MAX_WEEDS || !Number.isFinite(timer) || timer < 0) continue;
    const patch: PatchState = { weeds, timer };
    if (v.compost === true) patch.compost = true;
    if (v.crop !== undefined) {
      const crop = typeof v.crop === 'string' ? CROPS[v.crop] : undefined;
      const stage = Number(v.stage);
      if (!crop || !Number.isInteger(stage) || stage < 0 || stage > crop.stages) continue;
      Object.assign(patch, { weeds: 0, crop: crop.id, stage });
      if (v.diseased === true) patch.diseased = true;
      if (v.dead === true) patch.dead = true;
      const left = Number(v.left);
      if (stage === crop.stages && Number.isInteger(left) && left > 0) patch.left = left;
    }
    out[key] = patch;
  }
  return Object.keys(out).length ? out : null;
}

/** Points and tasks done are whole and not negative; a task must be for a creature Hrolf hands out. */
function parseBounty(raw: unknown): BountyState | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Partial<BountyState>;
  const points = Number(b.points);
  const done = Number(b.done);
  const out: BountyState = { points: Number.isInteger(points) && points >= 0 ? points : 0, done: Number.isInteger(done) && done >= 0 ? done : 0 };
  const t = b.task;
  if (t && typeof t.monster === 'string' && BOUNTY_TASKS[t.monster]) {
    const left = Number(t.left);
    const total = Number(t.total);
    if (Number.isInteger(left) && Number.isInteger(total) && left >= 1 && total >= left) out.task = { monster: t.monster, left, total };
  }
  return out.points || out.done || out.task ? out : null;
}

/** Only known rooms, and furniture at known spots at a tier that exists. */
function parseHomestead(raw: unknown): HomesteadState | null {
  if (!raw || typeof raw !== 'object') return null;
  const h = raw as Partial<HomesteadState>;
  if (h.owned !== true) return null;
  const rooms = Array.isArray(h.rooms) ? [...new Set(h.rooms.filter((r): r is string => typeof r === 'string' && !!ROOMS[r] && r !== 'garden'))] : [];
  const built: Record<string, number> = {};
  for (const [key, value] of Object.entries((h.built ?? {}) as Record<string, unknown>)) {
    const spot = SPOTS[key];
    const tier = Number(value);
    if (spot && Number.isInteger(tier) && tier >= 1 && tier <= FURNITURE[spot.kind].tiers.length) built[key] = tier;
  }
  return { owned: true, rooms, built };
}
