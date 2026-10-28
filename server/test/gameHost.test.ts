import { HAIR_STYLES, PROTOCOL_VERSION, WORLD_SEED, type ServerMessage } from '@rpg/shared';
import { describe, expect, it } from 'vitest';
import { loadWorld } from '../../shared/test/helpers';
import { GameHost, type Link } from '../src/GameHost';
import { MemoryStore } from '../src/store';

const map = loadWorld();

function link() {
  const got: ServerMessage[] = [];
  const l: Link & { got: ServerMessage[]; closed: number | null } = {
    got,
    closed: null,
    send: (text) => got.push(JSON.parse(text) as ServerMessage),
    close: (code) => (l.closed = code),
  };
  return l;
}

let tokens = 0;
/** A join as a fresh signed-in account, unless `token` names one. */
const join = (extra: Record<string, unknown> = {}) => JSON.stringify({ type: 'join', name: 'Tess', protocolVersion: PROTOCOL_VERSION, token: `user${++tokens}`, ...extra });
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('GameHost', () => {
  // Any token "userN" is a valid account with id "uN"; anything else isn't.
  const verify = async (t: string) => (/^user\d+$/.test(t) ? { id: t.replace('user', 'u'), email: '' } : null);
  const host = (store = new MemoryStore()) => new GameHost({ map, seed: WORLD_SEED, verify, store, maxPlayers: 3, log: () => {} });

  it('puts two players in one world, each seeing the other', async () => {
    const h = host();
    const a = link();
    const b = link();
    const ca = h.open(a);
    const cb = h.open(b);
    await h.receive(ca, join());
    await h.receive(cb, join());
    h.step();
    const idA = (a.got.find((m) => m.type === 'welcome') as { playerId: number }).playerId;
    const idB = (b.got.find((m) => m.type === 'welcome') as { playerId: number }).playerId;
    expect(idA).not.toBe(idB);
    const seen = (got: ServerMessage[]) => got.flatMap((m) => (m.type === 'snapshot' ? m.entities : m.type === 'tick' ? m.added : [])).map((e) => e.id);
    expect(seen(a.got)).toContain(idB);
    expect(h.playerCount).toBe(2);
    h.close(cb);
    expect(h.playerCount).toBe(1);
    h.step();
    expect(a.got.some((m) => m.type === 'tick' && m.removed.includes(idB))).toBe(true);
  });

  it('turns away an old client and a full world', async () => {
    const h = host();
    const old = link();
    await h.receive(h.open(old), join({ protocolVersion: 1 }));
    expect(old.got[0]).toMatchObject({ type: 'reject' });
    expect(old.closed).toBe(4000);
    for (let i = 0; i < 3; i++) await h.receive(h.open(link()), join());
    const late = link();
    await h.receive(h.open(late), join());
    expect(late.got[0]).toMatchObject({ type: 'reject', reason: expect.stringContaining('full') });
  });

  it('keeps one character per signed-in account', async () => {
    const h = host();
    const first = link();
    const second = link();
    await h.receive(h.open(first), join({ token: 'user900' }));
    await h.receive(h.open(second), join({ token: 'user900' }));
    expect(first.closed).toBe(4000);
    expect(h.playerCount).toBe(1);
  });

  it('ignores malformed messages and floods', async () => {
    const h = host();
    const a = link();
    const c = h.open(a);
    await h.receive(c, join());
    await h.receive(c, 'not json');
    await h.receive(c, JSON.stringify({ type: 'walk', x: 'far', y: 1 }));
    await h.receive(c, JSON.stringify([1, 2]));
    for (let i = 0; i < 200; i++) await h.receive(c, JSON.stringify({ type: 'examine', targetId: 1 }));
    expect(() => h.step()).not.toThrow();
    const examines = a.got.filter((m) => m.type === 'gameMessage' && m.kind === 'examine').length;
    expect(examines).toBeLessThan(60);
  });

  it('answers a save request straight away', async () => {
    const h = host();
    const a = link();
    const c = h.open(a);
    await h.receive(c, join());
    await h.receive(c, JSON.stringify({ type: 'requestSave' }));
    expect(a.got.at(-1)).toMatchObject({ type: 'saveData', save: { name: 'Tess' } });
  });

  it('turns away players who are not signed in', async () => {
    const h = host();
    const a = link();
    await h.receive(h.open(a), join({ token: undefined }));
    expect(a.got[0]).toMatchObject({ type: 'reject', reason: expect.stringContaining('Sign in') });
    expect(h.playerCount).toBe(0);
  });

  it('brings an existing character over once, then keeps the server copy', async () => {
    const store = new MemoryStore();
    const h = host(store);
    const a = link();
    const ca = h.open(a);
    const solo = { version: 1, name: 'Brann', position: { x: 0, y: 0 }, skills: { woodcutting: 5000 }, inventory: [], bank: [], quests: {}, createdAt: '', updatedAt: '' };
    await h.receive(ca, join({ token: 'user500', save: solo }));
    await settle();
    expect(store.rows.get('u500')?.skills.woodcutting).toBe(5000);
    expect(a.got.some((m) => m.type === 'gameMessage' && m.text.includes('came with you'))).toBe(true);
    h.close(ca);
    await settle();

    // A doctored save offered later is ignored: the server's copy wins.
    const b = link();
    const cb = h.open(b);
    await h.receive(cb, join({ token: 'user500', save: { ...solo, skills: { woodcutting: 13_000_000 } } }));
    await h.receive(cb, JSON.stringify({ type: 'requestSave' }));
    const back = b.got.filter((m) => m.type === 'saveData').at(-1);
    expect(back).toMatchObject({ save: { name: 'Brann', skills: { woodcutting: 5000 } } });
  });

  it('stores the character when the player leaves, and on a takeover keeps the live one', async () => {
    const store = new MemoryStore();
    const h = host(store);
    const a = link();
    const ca = h.open(a);
    await h.receive(ca, join({ token: 'user600' }));
    const id = (a.got.find((m) => m.type === 'welcome') as { playerId: number }).playerId;
    const p = h.sim.getEntity(id) as { x: number };
    await h.receive(ca, JSON.stringify({ type: 'walk', x: p.x + 2, y: (h.sim.getEntity(id) as { y: number }).y }));
    for (let i = 0; i < 4; i++) h.step();
    const walkedTo = (h.sim.getEntity(id) as { x: number }).x;
    // Second tab: the character arrives where the first tab left it, before any autosave.
    const b = link();
    await h.receive(h.open(b), join({ token: 'user600' }));
    const idB = (b.got.find((m) => m.type === 'welcome') as { playerId: number }).playerId;
    expect((h.sim.getEntity(idB) as { x: number }).x).toBe(walkedTo);
    expect(a.closed).toBe(4000);
    await settle();
    expect(store.rows.get('u600')?.position.x).toBe(walkedTo);
  });

  it("refuses rather than starting over when the store can't be read", async () => {
    const store = new MemoryStore();
    store.load = async () => {
      throw new Error('down');
    };
    const h = host(store);
    const a = link();
    await h.receive(h.open(a), join());
    expect(a.got[0]).toMatchObject({ type: 'reject', reason: expect.stringContaining("Couldn't load") });
    expect(h.playerCount).toBe(0);
  });

  it('stores everyone who changed before the server stops', async () => {
    const store = new MemoryStore();
    const h = host(store);
    const a = link();
    const ca = h.open(a);
    await h.receive(ca, join({ token: 'user700' }));
    await settle();
    const id = (a.got.find((m) => m.type === 'welcome') as { playerId: number }).playerId;
    const p = h.sim.getEntity(id) as { x: number; y: number };
    const from = p.x;
    await h.receive(ca, JSON.stringify({ type: 'walk', x: from + 2, y: p.y }));
    for (let i = 0; i < 4; i++) h.step();
    expect(store.rows.get('u700')?.position.x).toBe(from);
    await h.saveAll();
    expect(store.rows.get('u700')?.position.x).toBe(from + 2);
  });

  it('keeps names unique online', async () => {
    const store = new MemoryStore();
    const h = host(store);
    const look = { body: 'male', skin: 0, hairStyle: HAIR_STYLES[0], hair: 0, beard: false, shirt: 0, trousers: 0, boots: 0 };
    const solo = (name: string) => ({ version: 3, name, look, position: { x: 0, y: 0 }, skills: {}, inventory: [], bank: [], quests: {}, createdAt: '', updatedAt: '' });
    const a = link();
    await h.receive(h.open(a), join({ token: 'user800', save: solo('Brann') }));
    // Someone else brings a Brann over: they become Brann2.
    const b = link();
    await h.receive(h.open(b), join({ token: 'user801', save: solo('brann') }));
    expect(b.got.some((m) => m.type === 'gameMessage' && m.text.includes('brann2'))).toBe(true);
    // A new character can't pick a name that's taken.
    const c = link();
    const cc = h.open(c);
    await h.receive(cc, join({ token: 'user802' }));
    await h.receive(cc, JSON.stringify({ type: 'setLook', look, name: 'BRANN' }));
    expect(c.got.at(-1)).toEqual({ type: 'nameTaken', name: 'BRANN' });
    await h.receive(cc, JSON.stringify({ type: 'setLook', look, name: 'Corwen' }));
    h.step();
    const id = (c.got.find((m) => m.type === 'welcome') as { playerId: number }).playerId;
    expect((h.sim.getEntity(id) as { name: string }).name).toBe('Corwen');
  });
});
