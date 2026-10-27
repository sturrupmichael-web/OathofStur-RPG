import { parseSave, type SaveData } from '@rpg/shared';
import { account } from './account';
import { SUPABASE } from './supabase';
import { decide, fingerprint, type SyncRecord } from './syncRules';

/**
 * Keeps this browser's character in step with the account's cloud save (the
 * `saves_oath` table). It remembers what was last synced, so it can tell which side
 * changed. Uploads are guarded by the cloud copy's timestamp, so two devices never
 * silently overwrite each other: the player is asked instead.
 */
export type CloudStatus = 'off' | 'syncing' | 'synced' | 'offline' | 'conflict';

interface Row {
  data: unknown;
  updated_at: string;
}

const KEY = 'oathofstur.sync.v1';

function loadRecord(): SyncRecord {
  try {
    return (JSON.parse(localStorage.getItem(KEY) ?? 'null') as SyncRecord | null) ?? {};
  } catch {
    return {};
  }
}

function storeRecord(r: SyncRecord): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(r));
  } catch {
    // Storage blocked: we'll compare again next time.
  }
}

export class CloudSave {
  status: CloudStatus = 'off';
  /** Told whenever the status changes, for the Options tab. */
  onStatus: (status: CloudStatus) => void = () => {};
  private uploading = false;

  private set(status: CloudStatus): CloudStatus {
    this.status = status;
    this.onStatus(status);
    return status;
  }

  /**
   * At startup, before the game loads a character: which save to play. `choose` is
   * asked when this browser and the cloud both changed since they last synced.
   */
  async pick(local: SaveData | null, choose: (local: SaveData, cloud: SaveData) => Promise<'local' | 'cloud'>): Promise<SaveData | null> {
    const user = account.user;
    if (!user) return local;
    this.set('syncing');
    const r = await account.rest<Row[]>(`${SUPABASE.saves}?select=data,updated_at`);
    if (!r.ok || !r.body) {
      this.set('offline');
      return local;
    }
    const row = r.body[0];
    const data = row ? parseSave(row.data) : null;
    const cloud = row && data ? { data, at: row.updated_at } : null;
    let choice = decide(local, cloud, loadRecord(), user.id);
    if (choice === 'conflict') {
      this.set('conflict');
      choice = (await choose(local!, cloud!.data)) === 'cloud' ? 'download' : 'upload';
    }
    if (choice === 'download' || choice === 'same') {
      this.done(cloud!.at, cloud!.data);
      return cloud!.data;
    }
    if (choice === 'upload') await this.upload(local!, cloud?.at ?? null);
    else this.set('synced');
    return local;
  }

  /** After each save: send it up, unless the cloud copy changed on another device meanwhile. */
  async push(save: SaveData): Promise<void> {
    if (!account.user || this.uploading || this.status === 'conflict') return;
    const rec = loadRecord();
    if (rec.user === account.user.id && rec.hash === fingerprint(save)) return;
    this.uploading = true;
    try {
      await this.upload(save, rec.user === account.user.id ? (rec.at ?? null) : null);
    } finally {
      this.uploading = false;
    }
  }

  /** Writes the save; `prevAt` is the cloud copy we expect to replace (null: none yet). */
  private async upload(save: SaveData, prevAt: string | null): Promise<CloudStatus> {
    this.set('syncing');
    const body = JSON.stringify({ data: save });
    const headers = { Prefer: 'return=representation' };
    const r = prevAt
      ? await account.rest<Row[]>(`${SUPABASE.saves}?user_id=eq.${account.user!.id}&updated_at=eq.${encodeURIComponent(prevAt)}`, { method: 'PATCH', body, headers })
      : await account.rest<Row[]>(SUPABASE.saves, { method: 'POST', body, headers });
    if (r.ok && r.body?.[0]) return this.done(r.body[0].updated_at, save);
    // Nothing matched, or a row already exists: another device saved first.
    if (r.ok || r.status === 409) return this.set('conflict');
    return this.set('offline');
  }

  private done(at: string, save: SaveData): CloudStatus {
    storeRecord({ user: account.user!.id, at, hash: fingerprint(save) });
    return this.set('synced');
  }

  /** Deletes the account's cloud save (starting a new character). */
  async remove(): Promise<void> {
    if (!account.user) return;
    await account.rest(`${SUPABASE.saves}?user_id=eq.${account.user.id}`, { method: 'DELETE' });
    storeRecord({});
  }

  /** After signing out: forget which account this browser was synced with. */
  reset(): void {
    storeRecord({});
    this.set('off');
  }
}
