import monsterData from '../../data/monsters.json';
import { ITEMS, type Equipment } from './items';
import { prayerBoost, type PrayerId } from './prayer';
import { levelForXp, type SkillId, type SkillXp } from './skills';

/** Ticks between attacks for every weapon, and for fists. */
export const WEAPON_SPEED = 4;
/** XP per point of damage dealt, to the attack style's skill; Hitpoints gets a third of it. */
export const XP_PER_DAMAGE = 4;
/** One hitpoint comes back this often (ticks) when hurt. */
export const REGEN_TICKS = 100;
/** Ticks after eating before you can eat again. */
export const EAT_DELAY = 3;

export type AttackStyle = 'accurate' | 'aggressive' | 'defensive';

/** Each style trains one skill and gives it +3 while fighting. */
export const ATTACK_STYLES: Readonly<Record<AttackStyle, { skill: SkillId; label: string }>> = {
  accurate: { skill: 'attack', label: 'Accurate' },
  aggressive: { skill: 'strength', label: 'Aggressive' },
  defensive: { skill: 'defence', label: 'Defensive' },
};

/** The same three choices with a bow: steadier aim, faster shots, or shooting from further back. */
export const RANGED_STYLES: Readonly<Record<AttackStyle, { label: string; detail: string }>> = {
  accurate: { label: 'Accurate', detail: '+3 Ranged' },
  aggressive: { label: 'Rapid', detail: 'Shoots a tick faster' },
  defensive: { label: 'Longrange', detail: '+2 range, trains Defence too' },
};

export interface Drop {
  item: string;
  qty: number | [number, number];
  /** 0..1; rolled on its own for each kill. */
  chance: number;
}

export interface MonsterStats {
  hitpoints: number;
  attack: number;
  strength: number;
  defence: number;
  maxHit: number;
  attackSpeed: number;
  aggressive?: boolean;
  aggroRange?: number;
  respawnTicks: number;
  /** Which attack animation the client plays. */
  attackAnim: string;
  /** Bosses pick on anyone, whatever their combat level. */
  boss?: boolean;
  /** A fire attack used instead of a bite now and then, and from range. It always lands. */
  breath?: { chance: number; maxHit: number; range: number };
  examine: string;
  drops: Drop[];
}

export const MONSTERS: Readonly<Record<string, MonsterStats>> = monsterData.monsters as unknown as Record<string, MonsterStats>;

/** Bonuses from everything worn. */
export interface Bonuses {
  attack: number;
  strength: number;
  defence: number;
}

export function equipmentBonuses(equipment: Equipment): Bonuses {
  const total: Bonuses = { attack: 0, strength: 0, defence: 0 };
  for (const itemId of Object.values(equipment)) {
    const e = itemId ? ITEMS[itemId]?.equip : undefined;
    if (!e) continue;
    total.attack += e.attack ?? 0;
    total.strength += e.strength ?? 0;
    total.defence += e.defence ?? 0;
  }
  return total;
}

/** A fighter's numbers, player or monster, ready for the rolls below. */
export interface Fighter {
  attack: number;
  strength: number;
  defence: number;
  bonuses: Bonuses;
}

/** What changes a player's levels in a fight for now: potions drunk and prayers on. */
export interface LevelMods {
  boosts?: Partial<Record<SkillId, number>>;
  prayers?: readonly PrayerId[];
}

/** A level as it counts in a fight: the real level, plus any potion boost, raised by any prayer. */
export function effectiveLevel(skills: SkillXp, skill: SkillId, mods: LevelMods = {}): number {
  const level = levelForXp(skills[skill]) + (mods.boosts?.[skill] ?? 0);
  return Math.floor(level * (1 + prayerBoost(mods.prayers ?? [], skill)));
}

export function playerFighter(skills: SkillXp, equipment: Equipment, style: AttackStyle, mods: LevelMods = {}): Fighter {
  const level = (skill: SkillId) => effectiveLevel(skills, skill, mods) + (ATTACK_STYLES[style].skill === skill ? 3 : 0);
  return {
    attack: level('attack'),
    strength: level('strength'),
    defence: level('defence'),
    bonuses: equipmentBonuses(equipment),
  };
}

/** A player shooting: Ranged for both aim and power, the bow's accuracy and the arrow's strength. */
export function rangedFighter(skills: SkillXp, equipment: Equipment, style: AttackStyle, arrowStrength: number, mods: LevelMods = {}): Fighter {
  const ranged = effectiveLevel(skills, 'ranged', mods) + (style === 'accurate' ? 3 : 0);
  const bow = equipment.weapon ? ITEMS[equipment.weapon]?.equip : undefined;
  const worn = equipmentBonuses(equipment);
  return {
    attack: ranged,
    strength: ranged,
    defence: effectiveLevel(skills, 'defence', mods) + (style === 'defensive' ? 3 : 0),
    bonuses: { attack: bow?.attack ?? 0, strength: arrowStrength, defence: worn.defence },
  };
}

export function monsterFighter(m: MonsterStats): Fighter {
  return { attack: m.attack, strength: m.strength, defence: m.defence, bonuses: { attack: 0, strength: 0, defence: 0 } };
}

/**
 * Chance an attack lands. Each side rolls up to (level + 8) x (bonus + 64);
 * the attacker hits when their roll beats the defender's.
 */
export function hitChance(attacker: Fighter, defender: Fighter): number {
  const a = (attacker.attack + 8) * (attacker.bonuses.attack + 64);
  const d = (defender.defence + 8) * (defender.bonuses.defence + 64);
  return a > d ? 1 - (d + 2) / (2 * (a + 1)) : a / (2 * (d + 1));
}

/** Highest hit a player can deal: grows with Strength and strength bonus. */
export function playerMaxHit(f: Fighter): number {
  return Math.max(1, Math.floor(0.5 + ((f.strength + 8) * (f.bonuses.strength + 64)) / 640));
}

export function rollQty(qty: Drop['qty'], roll: (min: number, max: number) => number): number {
  return Array.isArray(qty) ? roll(qty[0], qty[1]) : qty;
}
