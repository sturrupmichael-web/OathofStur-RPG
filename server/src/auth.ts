/**
 * Sign-in checks for the online world. The browser signs in with Google through
 * Supabase (the same project as the cloud saves) and sends its access token when it
 * joins; the server asks Supabase who the token belongs to, so a client can never
 * just say who it is.
 */
export interface Account {
  id: string;
  email: string;
}

export interface SupabaseConfig {
  url: string;
  /** The publishable key: public, and all /auth/v1/user needs beside the token. */
  key: string;
}

/** Recent answers, so a reconnect doesn't ask Supabase again. */
const CACHE_MS = 5 * 60_000;

export function makeVerifier(cfg: SupabaseConfig, fetchFn: typeof fetch = fetch) {
  const cache = new Map<string, { account: Account | null; until: number }>();
  return async (token: string): Promise<Account | null> => {
    if (token.length > 4096) return null;
    const hit = cache.get(token);
    if (hit && hit.until > Date.now()) return hit.account;
    let account: Account | null = null;
    try {
      const res = await fetchFn(`${cfg.url}/auth/v1/user`, {
        headers: { apikey: cfg.key, Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const body = (await res.json()) as { id?: unknown; email?: unknown };
        if (typeof body.id === 'string') account = { id: body.id, email: typeof body.email === 'string' ? body.email : '' };
      } else if (res.status >= 500) {
        return null; // Supabase trouble: don't remember it
      }
    } catch {
      return null;
    }
    if (cache.size > 1000) cache.clear();
    cache.set(token, { account, until: Date.now() + CACHE_MS });
    return account;
  };
}
