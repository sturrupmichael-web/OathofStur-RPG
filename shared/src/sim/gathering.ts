import examineData from '../../data/examine.json';
import resourceData from '../../data/resources.json';
import type { SkillId } from './skills';

export interface ResourceYield {
  item: string;
  level: number;
  xp: number;
}

export interface ResourceData {
  skill: SkillId;
  /** Which animation and messages: chop, mine, net or rod. */
  verb: 'chop' | 'mine' | 'net' | 'rod';
  /** Best yield first. The node's level requirement is its lowest yield's. */
  yields: ResourceYield[];
  /** A specific item needed (fishing gear) instead of a tiered tool. */
  toolItem?: string;
  /** Used up, one per catch. */
  bait?: string;
  /** Chance the node is used up after each success. */
  depleteChance: number;
  respawnTicks: number;
}

export const RESOURCE_DATA: Readonly<Record<string, ResourceData>> = resourceData.resources as Record<string, ResourceData>;
export const ATTEMPT_TICKS = resourceData.attemptTicks;

/** Examine text for world objects by key ("tree", "tree_stump", "anvil"...). */
export const EXAMINE: Readonly<Record<string, string>> = examineData.objects;

export function requiredLevel(data: ResourceData): number {
  return Math.min(...data.yields.map((y) => y.level));
}

/** Chance that one gathering attempt succeeds. */
export function gatherChance(level: number, required: number, toolBonus: number): number {
  const chance = resourceData.baseChance + resourceData.perLevel * (level - required) + toolBonus;
  return Math.min(0.9, Math.max(0.05, chance));
}
