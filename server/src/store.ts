import type { SaveData } from '@rpg/shared';
import type { Moderation } from './moderation';

/** What the store keeps per account: the save, plus any mute or ban. */
export type StoredCharacter = SaveData & { moderation?: Moderation };

/**
 * Where the online world keeps characters, one per account. The server is the
 * only writer, so a player can't edit their own character.
 */
export interface SaveStore {
  /** The account's character; null when it has none yet. Throws when the store can't be reached. */
  load(userId: string): Promise<StoredCharacter | null>;
  save(userId: string, data: StoredCharacter): Promise<void>;
  /** The account and stored character with this name (any capitals), if there is one. */
  findByName(name: string): Promise<{ userId: string; data: StoredCharacter } | null>;
  /** Whether a character other than this account's has the name (any capitals). */
  nameTaken(name: string, exceptUserId: string): Promise<boolean>;
  /** For the logs at startup. */
  readonly label: string;
}

/** Keeps characters in memory only: for tests, and local runs without the secret key. */
export class MemoryStore implements SaveStore {
  readonly label = 'memory (characters are lost when the server stops)';
  readonly rows = new Map<string, StoredCharacter>();

  async load(userId: string): Promise<StoredCharacter | null> {
    const row = this.rows.get(userId);
    return row ? (JSON.parse(JSON.stringify(row)) as StoredCharacter) : null;
  }

  async findByName(name: string): Promise<{ userId: string; data: StoredCharacter } | null> {
    for (const [userId, row] of this.rows) if (row.name.toLowerCase() === name.toLowerCase()) return { userId, data: JSON.parse(JSON.stringify(row)) as StoredCharacter };
    return null;
  }

  async nameTaken(name: string, exceptUserId: string): Promise<boolean> {
    for (const [id, row] of this.rows) if (id !== exceptUserId && row.name.toLowerCase() === name.toLowerCase()) return true;
    return false;
  }

  async save(userId: string, data: StoredCharacter): Promise<void> {
    this.rows.set(userId, JSON.parse(JSON.stringify(data)) as StoredCharacter);
  }
}

/** The `saves_oath_online` table (supabase/002_oath_online.sql), through Supabase's REST API with the secret key. */
export class SupabaseStore implements SaveStore {
  readonly label = 'Supabase saves_oath_online';

  constructor(
    private readonly url: string,
    private readonly secretKey: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { apikey: this.secretKey, 'Content-Type': 'application/json' };
    // Older service_role keys are JWTs and go in Authorization too; new sb_secret_ keys don't.
    if (this.secretKey.startsWith('eyJ')) h.Authorization = `Bearer ${this.secretKey}`;
    return h;
  }

  async load(userId: string): Promise<StoredCharacter | null> {
    const res = await this.fetchFn(`${this.url}/rest/v1/saves_oath_online?user_id=eq.${encodeURIComponent(userId)}&select=data`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`load ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const rows = (await res.json()) as { data: StoredCharacter }[];
    return rows[0]?.data ?? null;
  }

  async findByName(name: string): Promise<{ userId: string; data: StoredCharacter } | null> {
    if (!/^[A-Za-z0-9 -]{1,12}$/.test(name)) return null; // never a wildcard for ilike
    const res = await this.fetchFn(`${this.url}/rest/v1/saves_oath_online?select=user_id,data&limit=1&data->>name=ilike.${encodeURIComponent(name)}`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`find ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const rows = (await res.json()) as { user_id: string; data: StoredCharacter }[];
    return rows[0] ? { userId: rows[0].user_id, data: rows[0].data } : null;
  }

  async nameTaken(name: string, exceptUserId: string): Promise<boolean> {
    // Names are letters, digits, spaces and hyphens (cleanName), so ilike sees no wildcards in them.
    const q = `select=user_id&limit=1&data->>name=ilike.${encodeURIComponent(name)}${exceptUserId ? `&user_id=neq.${encodeURIComponent(exceptUserId)}` : ''}`;
    const res = await this.fetchFn(`${this.url}/rest/v1/saves_oath_online?${q}`, { headers: this.headers(), signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`name ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return ((await res.json()) as unknown[]).length > 0;
  }

  async save(userId: string, data: StoredCharacter): Promise<void> {
    const res = await this.fetchFn(`${this.url}/rest/v1/saves_oath_online?on_conflict=user_id`, {
      method: 'POST',
      headers: { ...this.headers(), Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ user_id: userId, data, updated_at: new Date().toISOString() }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`save ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}
