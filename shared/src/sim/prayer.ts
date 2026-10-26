import type { SkillId } from './skills';

/**
 * Prayers. Each one, while on, drains prayer points (`drain` points a minute);
 * the points are the Prayer level when full, and an altar fills them again.
 * Prayers in the same group replace each other, and the ranged ones push off
 * the melee ones (and back), so only one of each kind of help is on at once.
 */
export type PrayerId =
  | 'oak_skin'
  | 'burst_of_will'
  | 'clear_mind'
  | 'keen_eye'
  | 'mending_hands'
  | 'stone_skin'
  | 'bulls_might'
  | 'sharp_mind'
  | 'hawks_eye'
  | 'ember_ward'
  | 'ward_of_blades'
  | 'steel_skin'
  | 'titans_might'
  | 'seers_focus'
  | 'falcons_eye';

type Group = 'defence' | 'strength' | 'attack' | 'ranged' | 'mending' | 'ward';

export interface PrayerDef {
  id: PrayerId;
  name: string;
  level: number;
  /** Prayer points used up per minute while it is on. */
  drain: number;
  group: Group;
  description: string;
  /** Raises a skill's level in combat by this fraction. */
  boost?: { skill: SkillId; by: number };
}

const list: PrayerDef[] = [
  { id: 'oak_skin', name: 'Oak Skin', level: 1, drain: 5, group: 'defence', description: '+5% Defence', boost: { skill: 'defence', by: 0.05 } },
  { id: 'burst_of_will', name: 'Burst of Will', level: 4, drain: 5, group: 'strength', description: '+5% Strength', boost: { skill: 'strength', by: 0.05 } },
  { id: 'clear_mind', name: 'Clear Mind', level: 7, drain: 5, group: 'attack', description: '+5% Attack', boost: { skill: 'attack', by: 0.05 } },
  { id: 'keen_eye', name: 'Keen Eye', level: 8, drain: 5, group: 'ranged', description: '+5% Ranged', boost: { skill: 'ranged', by: 0.05 } },
  { id: 'mending_hands', name: 'Mending Hands', level: 10, drain: 3, group: 'mending', description: 'Hitpoints come back twice as fast' },
  { id: 'stone_skin', name: 'Stone Skin', level: 13, drain: 10, group: 'defence', description: '+10% Defence', boost: { skill: 'defence', by: 0.1 } },
  { id: 'bulls_might', name: "Bull's Might", level: 16, drain: 10, group: 'strength', description: '+10% Strength', boost: { skill: 'strength', by: 0.1 } },
  { id: 'sharp_mind', name: 'Sharp Mind', level: 19, drain: 10, group: 'attack', description: '+10% Attack', boost: { skill: 'attack', by: 0.1 } },
  { id: 'hawks_eye', name: "Hawk's Eye", level: 22, drain: 10, group: 'ranged', description: '+10% Ranged', boost: { skill: 'ranged', by: 0.1 } },
  { id: 'ember_ward', name: 'Ember Ward', level: 28, drain: 10, group: 'ward', description: 'Halves the harm of dragonfire' },
  { id: 'ward_of_blades', name: 'Ward of Blades', level: 37, drain: 20, group: 'ward', description: 'Monsters’ blows and bites do no harm' },
  { id: 'steel_skin', name: 'Steel Skin', level: 40, drain: 20, group: 'defence', description: '+15% Defence', boost: { skill: 'defence', by: 0.15 } },
  { id: 'titans_might', name: "Titan's Might", level: 43, drain: 20, group: 'strength', description: '+15% Strength', boost: { skill: 'strength', by: 0.15 } },
  { id: 'seers_focus', name: "Seer's Focus", level: 46, drain: 20, group: 'attack', description: '+15% Attack', boost: { skill: 'attack', by: 0.15 } },
  { id: 'falcons_eye', name: "Falcon's Eye", level: 49, drain: 20, group: 'ranged', description: '+15% Ranged', boost: { skill: 'ranged', by: 0.15 } },
];

export const PRAYERS: Readonly<Record<PrayerId, PrayerDef>> = Object.fromEntries(list.map((p) => [p.id, p])) as Record<PrayerId, PrayerDef>;
export const PRAYER_IDS: readonly PrayerId[] = list.map((p) => p.id);

/** Groups a prayer pushes off when it is turned on: its own, and melee and ranged push each other off. */
function clashes(group: Group): Group[] {
  if (group === 'ranged') return ['ranged', 'attack', 'strength'];
  if (group === 'attack' || group === 'strength') return [group, 'ranged'];
  return [group];
}

/** The prayers left on after turning `id` on. */
export function withPrayer(active: readonly PrayerId[], id: PrayerId): PrayerId[] {
  const off = clashes(PRAYERS[id].group);
  return [...active.filter((p) => !off.includes(PRAYERS[p].group)), id];
}

/** How much active prayers raise a skill in combat, as a fraction. */
export function prayerBoost(active: readonly PrayerId[], skill: SkillId): number {
  let best = 0;
  for (const id of active) {
    const b = PRAYERS[id].boost;
    if (b?.skill === skill) best = Math.max(best, b.by);
  }
  return best;
}

/** Prayer points used up each tick (a minute is 100 ticks) by the prayers that are on. */
export function drainPerTick(active: readonly PrayerId[]): number {
  return active.reduce((n, id) => n + PRAYERS[id].drain, 0) / 100;
}
