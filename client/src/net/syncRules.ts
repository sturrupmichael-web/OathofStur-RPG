import { QUESTS, doneStage, levelForXp, type QuestId, type SaveData } from '@rpg/shared';

/**
 * Which save wins when this browser and the account's cloud save differ. Kept apart
 * from the network code so it can be tested on its own.
 */

/** What was last synced on this device: whose account, the cloud copy's time, and the save's fingerprint. */
export interface SyncRecord {
  user?: string;
  at?: string;
  hash?: string;
}

/** JSON with sorted keys: the database doesn't keep key order. */
const canon = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canon).join(',')}]`
    : v && typeof v === 'object'
      ? `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`)
          .join(',')}}`
      : JSON.stringify(v ?? null);

/** A short fingerprint of a save, to spot changes. The format version is left out, so an upgrade on load doesn't count. */
export function fingerprint(save: SaveData): string {
  const { version: _version, ...rest } = save;
  const str = canon(rest);
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

export type SyncChoice = 'none' | 'same' | 'upload' | 'download' | 'conflict';

/**
 * Only this device changed → upload; only the cloud → download; both, or a browser
 * that was synced with a different account → let the player choose.
 */
export function decide(local: SaveData | null, cloud: { data: SaveData; at: string } | null, rec: SyncRecord, user: string): SyncChoice {
  if (!cloud) return local ? 'upload' : 'none';
  if (!local) return 'download';
  if (fingerprint(local) === fingerprint(cloud.data)) return 'same';
  const sameUser = rec.user === user;
  const localChanged = !sameUser || fingerprint(local) !== rec.hash;
  const cloudChanged = !sameUser || cloud.at !== rec.at;
  if (localChanged && !cloudChanged) return 'upload';
  if (cloudChanged && !localChanged) return 'download';
  return 'conflict';
}

/** What the "which character do you want to keep?" choice shows for each side. */
export function summary(save: SaveData): { name: string; totalLevel: number; quests: number; savedAt: string } {
  return {
    name: save.name,
    totalLevel: Object.values(save.skills).reduce((sum, xp) => sum + levelForXp(xp ?? 0), 0),
    quests: Object.entries(save.quests ?? {}).filter(([id, stage]) => QUESTS[id as QuestId] && stage >= doneStage(QUESTS[id as QuestId])).length,
    savedAt: save.updatedAt,
  };
}
