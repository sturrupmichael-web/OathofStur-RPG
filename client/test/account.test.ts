import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The account module reads storage as it loads, so each test sets up a fresh browser
// stand-in first and then imports it.
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (sub: string) => `${b64({ alg: 'none' })}.${b64({ sub, email: `${sub}@example.com`, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const session = (sub: string, refresh = `r-${sub}`, expires_at = Math.floor(Date.now() / 1000) + 3600) => ({
  access_token: jwt(sub),
  refresh_token: refresh,
  expires_at,
  user: { id: sub, email: `${sub}@example.com`, guest: false },
});

const SITE = 'michaelsturrup.auth.v1';
let store: Map<string, string>;

beforeEach(() => {
  vi.resetModules();
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal('location', { origin: 'https://michaelsturrup.com', pathname: '/oathofstur/', hash: '', search: '', protocol: 'https:', assign: vi.fn() });
  vi.stubGlobal('history', { replaceState: vi.fn() });
  vi.stubGlobal('atob', (s: string) => Buffer.from(s, 'base64').toString('binary'));
});

afterEach(() => vi.unstubAllGlobals());

const load = async () => (await import('../src/net/account')).account;
const shared = () => JSON.parse(store.get(SITE) ?? 'null');

describe('site-wide sign-in', () => {
  it('a sign-in from the main page (or another game) is picked up, even after load', async () => {
    const account = await load();
    expect(account.user).toBeNull();
    store.set(SITE, JSON.stringify(session('ada')));
    expect(account.user?.id).toBe('ada');
  });

  it('coming back from Google keeps the session in the shared slot', async () => {
    (location as unknown as { hash: string }).hash = `#access_token=${jwt('bo')}&refresh_token=r1&expires_in=3600`;
    const account = await load();
    expect(account.init()).toBe('signed-in');
    expect(shared().refresh_token).toBe('r1');
  });

  it("the game's old sign-in moves into the shared slot", async () => {
    store.set('oathofstur.auth.v1', JSON.stringify(session('old')));
    const account = await load();
    expect(account.user?.id).toBe('old');
    expect(shared().user.id).toBe('old');
    expect(store.has('oathofstur.auth.v1')).toBe(false);
  });

  it('signing out clears the shared slot', async () => {
    store.set(SITE, JSON.stringify(session('ada')));
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 204, json: async () => undefined })));
    const account = await load();
    account.signOut();
    expect(store.has(SITE)).toBe(false);
    expect(account.user).toBeNull();
  });

  it('a refused refresh uses the session another page just refreshed', async () => {
    store.set(SITE, JSON.stringify(session('ada', 'r-old', 10)));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        store.set(SITE, JSON.stringify(session('ada', 'r-other')));
        return { ok: false, status: 400, json: async () => ({ msg: 'Invalid Refresh Token: Already Used' }) };
      }),
    );
    const account = await load();
    expect(await account.ensure()).toBe(true);
    expect(shared().refresh_token).toBe('r-other');
  });

  it('a refresh the server refuses for good signs out', async () => {
    store.set(SITE, JSON.stringify(session('ada', 'r-old', 10)));
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 400, json: async () => ({}) })));
    const account = await load();
    expect(await account.ensure()).toBe(false);
    expect(store.has(SITE)).toBe(false);
  });
});
