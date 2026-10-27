import farmingData from '../../data/farming.json';
import type { Rng } from '../rng';

export type PatchKind = 'allotment' | 'herb';

export interface PatchKindDef {
  name: string;
  /** Seeds planted at once. */
  seeds: number;
  /** Needed to harvest, if anything. */
  tool?: string;
}

export interface CropDef {
  id: string;
  patch: PatchKind;
  seed: string;
  produce: string;
  level: number;
  plantXp: number;
  harvestXp: number;
  stages: number;
  stageMinutes: number;
  yield: [number, number];
}

/**
 * One player's patch. Missing means untouched: fully overgrown. `timer` counts
 * ticks toward the next weed (empty patch) or the next stage (growing crop).
 */
export interface PatchState {
  weeds: number;
  timer: number;
  crop?: string;
  stage?: number;
  diseased?: boolean;
  dead?: boolean;
  compost?: boolean;
  /** Grown: how many are left to harvest. */
  left?: number;
}

export const FARMING = farmingData;
export const PATCH_KINDS: Readonly<Record<PatchKind, PatchKindDef>> = farmingData.patches as Record<PatchKind, PatchKindDef>;
export const MAX_WEEDS = 3;
const TICKS_PER_MINUTE = 100;

export const CROPS: Readonly<Record<string, CropDef>> = Object.fromEntries(
  Object.entries(farmingData.crops).map(([id, c]) => [id, { id, ...c, patch: c.patch as PatchKind, yield: c.yield as [number, number] }]),
);

/** The crop a seed grows into. */
export function cropForSeed(itemId: string): CropDef | undefined {
  return Object.values(CROPS).find((c) => c.seed === itemId);
}

export function overgrown(): PatchState {
  return { weeds: MAX_WEEDS, timer: 0 };
}

/** Whether a crop is fully grown and waiting to be picked. */
export function isGrown(p: PatchState): boolean {
  const crop = p.crop ? CROPS[p.crop] : undefined;
  return !!crop && !p.dead && p.stage === crop.stages;
}

/**
 * Moves a patch on by `ticks`: weeds creep back into an empty patch, crops
 * grow a stage at a time and may fall sick at each one. Works the same for a
 * single tick and for hours away.
 */
export function growPatch(p: PatchState, ticks: number, rng: Rng): void {
  const crop = p.crop ? CROPS[p.crop] : undefined;
  if (!crop) {
    if (p.weeds >= MAX_WEEDS) {
      p.timer = 0;
      return;
    }
    p.timer += ticks;
    while (p.timer >= farmingData.weedTicks && p.weeds < MAX_WEEDS) {
      p.timer -= farmingData.weedTicks;
      p.weeds++;
    }
    if (p.weeds >= MAX_WEEDS) p.timer = 0;
    return;
  }
  if (p.dead || isGrown(p)) return;
  p.timer += ticks;
  const per = crop.stageMinutes * TICKS_PER_MINUTE;
  while (p.timer >= per && !p.dead && (p.stage ?? 0) < crop.stages) {
    p.timer -= per;
    if (p.diseased) {
      p.dead = true;
      delete p.diseased;
      break;
    }
    p.stage = (p.stage ?? 0) + 1;
    if (p.stage < crop.stages && rng.chance(p.compost ? farmingData.compostDiseaseChance : farmingData.diseaseChance)) p.diseased = true;
  }
  if (isGrown(p)) {
    p.timer = 0;
    p.left = rng.int(...crop.yield) + (p.compost ? farmingData.compostYield : 0);
  }
}

/** What anyone looking at a patch sees of it. */
export interface PatchView {
  weeds: number;
  crop?: string;
  stage?: number;
  stages?: number;
  diseased?: boolean;
  dead?: boolean;
  compost?: boolean;
}

export function patchView(p: PatchState): PatchView {
  const crop = p.crop ? CROPS[p.crop] : undefined;
  return {
    weeds: p.weeds,
    ...(crop && { crop: crop.id, stage: p.stage ?? 0, stages: crop.stages }),
    ...(p.diseased && { diseased: true }),
    ...(p.dead && { dead: true }),
    ...(p.compost && { compost: true }),
  };
}

/** Ticks a crop has in hand after time away, at most the offline cap. */
export function offlineTicks(savedAt: string, now: string): number {
  const ms = Date.parse(now) - Date.parse(savedAt);
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.floor(Math.min(ms, farmingData.offlineCapMinutes * 60_000) / 600);
}
