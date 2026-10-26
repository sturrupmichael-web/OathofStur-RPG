import examineData from '../../data/examine.json';
import resourceData from '../../data/resources.json';
import type { SkillId } from './skills';

export interface ResourceData {
  skill: SkillId;
  level: number;
  xp: number;
  item: string;
  /** Chance the node is used up after each success. */
  depleteChance: number;
  respawnTicks: number;
}

export const RESOURCE_DATA: Readonly<Record<string, ResourceData>> = resourceData.resources as Record<string, ResourceData>;
export const ATTEMPT_TICKS = resourceData.attemptTicks;

/** Examine text for world objects by key ("tree", "tree_stump", "anvil"...). */
export const EXAMINE: Readonly<Record<string, string>> = examineData.objects;

/** Chance that one gathering attempt succeeds. */
export function gatherChance(level: number, required: number, toolBonus: number): number {
  const chance = resourceData.baseChance + resourceData.perLevel * (level - required) + toolBonus;
  return Math.min(0.9, Math.max(0.05, chance));
}
