import { SUPABASE } from './supabase';

/**
 * Google sign-in through Supabase Auth's REST API (no library), as in Michael's other
 * games: the page goes to Google by way of Supabase and comes back with tokens in the
 * address, which `init()` picks up. The session lives in localStorage; every call
 * resolves to `{ ok, ... }` instead of throwing, so the game plays on when offline.
 */
export interface Session {
  access_token: string;
  refresh_token: string;
  /** Seconds since 1970. */
  expires_at: number;
  user: { id: string; email: string };
}

export interface Reply<T = unknown> {
  ok: boolean;
  status: number;
  body?: T;
}

const KEY = 'oathofstur.auth.v1';

let session: Session | null = load();

function load(): Session | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null') as Session | null;
  } catch {
    return null;
  }
}

function store(s: Session | null): void {
  session = s;
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the sign-in lasts for this page only.
  }
}

/** The account's id and email come from the access token itself. */
function fromTokens(t: Record<string, unknown>): Session | null {
  try {
    const access = String(t.access_token);
    const claims = JSON.parse(atob(access.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { sub: string; email?: string; exp: number };
    return {
      access_token: access,
      refresh_token: String(t.refresh_token),
      expires_at: Number(t.expires_at) || claims.exp,
      user: { id: claims.sub, email: claims.email ?? '' },
    };
  } catch {
    return null;
  }
}

async function request<T>(url: string, opts: RequestInit = {}): Promise<Reply<T>> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), SUPABASE.timeout);
  try {
    const res = await fetch(url, {
      ...opts,
      signal: ctl.signal,
      headers: { apikey: SUPABASE.key, 'Content-Type': 'application/json', ...(opts.headers as Record<string, string>) },
    });
    const body = res.status === 204 ? undefined : ((await res.json().catch(() => undefined)) as T | undefined);
    return { ok: res.ok, status: res.status, body };
  } catch {
    return { ok: false, status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

/** Where Google sends the player back to: this page, without any #tokens. */
const returnUrl = () => location.origin + location.pathname;

export const account = {
  /** Why the last sign-in didn't finish, for the Options tab. */
  lastError: '',

  get user(): Session['user'] | null {
    return session?.user ?? null;
  },

  /**
   * Google sign-in only works on the real page: the claude.ai preview runs it in a
   * sandboxed frame that can't leave for Google and come back.
   */
  get available(): boolean {
    try {
      return window.top === window && location.protocol !== 'file:';
    } catch {
      return false;
    }
  },

  /** Called once at startup: picks up the tokens Supabase puts in the address after signing in. */
  init(): 'signed-in' | 'error' | null {
    const params = new URLSearchParams(location.hash.slice(1) || location.search.slice(1));
    if (!params.has('access_token') && !params.has('error')) return null;
    history.replaceState(null, '', returnUrl()); // don't leave tokens in the address bar
    if (params.has('error')) {
      this.lastError = (params.get('error_description') ?? params.get('error_code') ?? params.get('error') ?? '').slice(0, 160);
      return 'error';
    }
    const s = fromTokens(Object.fromEntries(params));
    if (!s) {
      this.lastError = "The sign-in came back in a form the game didn't understand.";
      return 'error';
    }
    store(s);
    return 'signed-in';
  },

  /** A valid session, refreshing it when it's about to run out. */
  async ensure(): Promise<boolean> {
    if (!session) return false;
    if (session.expires_at - 60 > Date.now() / 1000) return true;
    const r = await request<Record<string, unknown>>(`${SUPABASE.url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    });
    const fresh = r.ok && r.body ? fromTokens(r.body) : null;
    if (fresh) {
      store(fresh);
      return true;
    }
    if (r.status !== 0) store(null); // revoked or expired for good; offline keeps it for later
    return false;
  },

  /** The access token, fresh, for joining the online world; null when signed out. */
  async token(): Promise<string | null> {
    return (await this.ensure()) ? session!.access_token : null;
  },

  /** Calls the database REST API as this account. */
  async rest<T>(path: string, opts: RequestInit = {}): Promise<Reply<T>> {
    if (!(await this.ensure())) return { ok: false, status: 401 };
    return request<T>(`${SUPABASE.url}/rest/v1/${path}`, {
      ...opts,
      headers: { Authorization: `Bearer ${session!.access_token}`, ...(opts.headers as Record<string, string>) },
    });
  },

  /** Leaves for Google; the page comes back through `init()`. */
  signIn(): void {
    location.assign(`${SUPABASE.url}/auth/v1/authorize?${new URLSearchParams({ provider: 'google', redirect_to: returnUrl() })}`);
  },

  /** Signs out on this device. The character stays in this browser; it just stops syncing. */
  signOut(): void {
    if (session) void request(`${SUPABASE.url}/auth/v1/logout`, { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` } });
    store(null);
  },
};
