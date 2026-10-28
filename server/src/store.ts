import type { SaveData } from '@rpg/shared';

/**
 * Where the online world keeps characters, one per account. The server is the
 * only writer, so a player can't edit their own character.
 */
export interface SaveStore {
  /** The account's character; null when it has none yet. Throws when the store can't be reached. */
  load(userId: string): Promise<SaveData | null>;
  save(userId: string, data: SaveData): Promise<void>;
  /** For the logs at startup. */
  readonly label: string;
}

/** Keeps characters in memory only: for tests, and local runs without the secret key. */
export class MemoryStore implements SaveStore {
  readonly label = 'memory (characters are lost when the server stops)';
  readonly rows = new Map<string, SaveData>();

  async load(userId: string): Promise<SaveData | null> {
    const row = this.rows.get(userId);
    return row ? (JSON.parse(JSON.stringify(row)) as SaveData) : null;
  }

  async save(userId: string, data: SaveData): Promise<void> {
    this.rows.set(userId, JSON.parse(JSON.stringify(data)) as SaveData);
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

  async load(userId: string): Promise<SaveData | null> {
    const res = await this.fetchFn(`${this.url}/rest/v1/saves_oath_online?user_id=eq.${encodeURIComponent(userId)}&select=data`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`load ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const rows = (await res.json()) as { data: SaveData }[];
    return rows[0]?.data ?? null;
  }

  async save(userId: string, data: SaveData): Promise<void> {
    const res = await this.fetchFn(`${this.url}/rest/v1/saves_oath_online?on_conflict=user_id`, {
      method: 'POST',
      headers: { ...this.headers(), Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ user_id: userId, data, updated_at: new Date().toISOString() }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`save ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}
