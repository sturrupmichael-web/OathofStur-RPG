import { PROTOCOL_VERSION, WORLD_SEED, type ServerMessage } from '@rpg/shared';
import { describe, expect, it } from 'vitest';
import { loadWorld } from '../../shared/test/helpers';
import { GameHost, type Link } from '../src/GameHost';

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

const join = (extra: Record<string, unknown> = {}) => JSON.stringify({ type: 'join', name: 'Tess', protocolVersion: PROTOCOL_VERSION, ...extra });

describe('GameHost', () => {
  const accounts: Record<string, { id: string; email: string }> = { good: { id: 'u1', email: 'a@b.c' } };
  const host = () => new GameHost({ map, seed: WORLD_SEED, verify: async (t) => accounts[t] ?? null, maxPlayers: 3 });

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
    await h.receive(h.open(first), join({ token: 'good' }));
    await h.receive(h.open(second), join({ token: 'good' }));
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
});
