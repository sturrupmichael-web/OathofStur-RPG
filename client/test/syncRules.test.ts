import { describe, expect, it } from 'vitest';
import { parseSave, type SaveData } from '@rpg/shared';
import { decide, fingerprint, summary } from '../src/net/syncRules';

const save = (name: string, woodcutting = 0): SaveData =>
  parseSave({ version: 3, name, position: { x: 190, y: 116 }, skills: { woodcutting }, inventory: [], bank: [], quests: {}, createdAt: '2026-10-20T10:00:00.000Z', updatedAt: '2026-10-27T10:00:00.000Z' })!;

describe('cloud save sync', () => {
  const user = 'u1';
  const a = save('Ada', 100);
  const b = save('Ada', 900);

  it('uploads when there is no cloud save yet, and does nothing with no save at all', () => {
    expect(decide(a, null, {}, user)).toBe('upload');
    expect(decide(null, null, {}, user)).toBe('none');
  });

  it('downloads on a device with no character', () => {
    expect(decide(null, { data: b, at: 't2' }, {}, user)).toBe('download');
  });

  it('does nothing when both hold the same save', () => {
    expect(decide(a, { data: save('Ada', 100), at: 't1' }, {}, user)).toBe('same');
  });

  it('uploads when only this browser changed since the last sync', () => {
    expect(decide(b, { data: a, at: 't1' }, { user, at: 't1', hash: fingerprint(a) }, user)).toBe('upload');
  });

  it('downloads when only the cloud changed since the last sync', () => {
    expect(decide(a, { data: b, at: 't2' }, { user, at: 't1', hash: fingerprint(a) }, user)).toBe('download');
  });

  it('asks when both changed, or the browser last synced with another account', () => {
    const c = save('Ada', 400);
    expect(decide(c, { data: b, at: 't2' }, { user, at: 't1', hash: fingerprint(a) }, user)).toBe('conflict');
    expect(decide(a, { data: b, at: 't1' }, { user: 'someone-else', at: 't1', hash: fingerprint(a) }, user)).toBe('conflict');
  });

  it('ignores key order and the format version in fingerprints', () => {
    const shuffled = JSON.parse(JSON.stringify({ updatedAt: a.updatedAt, ...a, version: 99 })) as SaveData;
    expect(fingerprint(shuffled)).toBe(fingerprint(a));
  });

  it('summarises a save for the choice', () => {
    const s = summary(b);
    expect(s.name).toBe('Ada');
    expect(s.totalLevel).toBeGreaterThan(summary(a).totalLevel);
    expect(s.quests).toBe(0);
  });
});
