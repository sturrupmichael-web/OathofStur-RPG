import skillData from '../../data/skills.json';

export type SkillId =
  | 'attack'
  | 'strength'
  | 'defence'
  | 'ranged'
  | 'magic'
  | 'prayer'
  | 'hitpoints'
  | 'woodcutting'
  | 'firemaking'
  | 'mining'
  | 'fishing'
  | 'cooking'
  | 'smithing'
  | 'fletching'
  | 'herblore'
  | 'agility'
  | 'glyphcraft'
  | 'farming'
  | 'bounty'
  | 'homesteading';

export interface SkillInfo {
  id: SkillId;
  name: string;
}

export const SKILLS: readonly SkillInfo[] = skillData.skills as SkillInfo[];
export const MAX_LEVEL = skillData.maxLevel;
export const MAX_XP = 200_000_000;

export type SkillXp = Record<SkillId, number>;

const XP_TABLE: number[] = (() => {
  const { base, growth } = skillData.xpCurve;
  const table = [0, 0]; // index = level; level 1 needs 0 XP
  for (let level = 2; level <= MAX_LEVEL; level++) {
    table.push(Math.round((base * (Math.pow(growth, level - 1) - 1)) / (growth - 1)));
  }
  return table;
})();

/** Total XP required to reach `level`. */
export function xpForLevel(level: number): number {
  return XP_TABLE[Math.max(1, Math.min(MAX_LEVEL, level))];
}

export function levelForXp(xp: number): number {
  let level = 1;
  while (level < MAX_LEVEL && xp >= XP_TABLE[level + 1]) level++;
  return level;
}

export function startingXp(): SkillXp {
  const xp = {} as SkillXp;
  const starting = skillData.startingLevels as Partial<Record<SkillId, number>>;
  for (const s of SKILLS) xp[s.id] = xpForLevel(starting[s.id] ?? 1);
  return xp;
}

export function combatLevel(xp: SkillXp): number {
  const { meleeWeight, hitpointsWeight, prayerWeight } = skillData.combatLevel;
  const defence = levelForXp(xp.defence);
  const melee = levelForXp(xp.attack) + levelForXp(xp.strength) + defence;
  const ranged = 2 * levelForXp(xp.ranged) + defence;
  const magic = 2 * levelForXp(xp.magic) + defence;
  return Math.floor((meleeWeight * Math.max(melee, ranged, magic)) / 3 + hitpointsWeight * levelForXp(xp.hitpoints) + prayerWeight * levelForXp(xp.prayer));
}

/** Level used for a requirement: a skill id, or "combat" for combat level. */
export function requirementLevel(xp: SkillXp, skill: string): number {
  if (skill === 'combat') return combatLevel(xp);
  const value = xp[skill as SkillId];
  return value === undefined ? 0 : levelForXp(value);
}
