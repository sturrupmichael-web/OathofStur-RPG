import { describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE, cleanName, parseAppearance, randomAppearance } from '../src/sim/appearance';
import type { PlayerEntity } from '../src/sim/entities';
import { Rng } from '../src/rng';
import { parseSave } from '../src/sim/save';
import { Simulation } from '../src/sim/Simulation';
import { loadWorld } from './helpers';

const map = loadWorld();
const look = { body: 'female', skin: 4, hairStyle: 'ponytail', hair: 6, beard: false, shirt: 2, trousers: 8, boots: 1 } as const;

describe('Appearance', () => {
  it('accepts looks inside the palettes and nothing else', () => {
    expect(parseAppearance(look)).toEqual(look);
    expect(parseAppearance({ ...look, skin: 99 })).toBeNull();
    expect(parseAppearance({ ...look, hairStyle: 'mullet' })).toBeNull();
    expect(parseAppearance({ ...look, body: 'robot' })).toBeNull();
    expect(parseAppearance(null)).toBeNull();
    const rng = new Rng(5);
    for (let i = 0; i < 50; i++) expect(parseAppearance(randomAppearance(rng))).not.toBeNull();
    expect(parseAppearance(DEFAULT_APPEARANCE)).toEqual(DEFAULT_APPEARANCE);
  });

  it('keeps names short and plain', () => {
    expect(cleanName('  Ash   Vale ')).toBe('Ash Vale');
    expect(cleanName('9lives')).toBeNull();
    expect(cleanName('<b>')).toBeNull();
    expect(cleanName('Averyverylongname')).toBeNull();
  });

  it('names the character once, restyles any time, and saves the look', () => {
    const sim = new Simulation({ map, seed: 1 });
    const id = sim.addPlayer('Wanderer');
    const p = sim.getEntity(id) as PlayerEntity;
    expect(p.look).toBeUndefined();
    sim.queueIntent(id, { type: 'setLook', look, name: 'Ash' });
    sim.step();
    expect(p.name).toBe('Ash');
    expect(p.look).toEqual(look);
    sim.queueIntent(id, { type: 'setLook', look: { ...look, hair: 0 }, name: 'Renamed' });
    sim.step();
    expect(p.name).toBe('Ash');
    expect(p.look?.hair).toBe(0);

    const save = parseSave(JSON.parse(JSON.stringify(sim.saveFor(id, new Date().toISOString()))))!;
    expect(save.look).toEqual({ ...look, hair: 0 });
    const again = new Simulation({ map, seed: 1 });
    const back = again.getEntity(again.addPlayer('x', save)) as PlayerEntity;
    expect(back.look).toEqual({ ...look, hair: 0 });
  });

  it('ignores a look that is out of range', () => {
    const sim = new Simulation({ map, seed: 1 });
    const id = sim.addPlayer('Wanderer');
    sim.queueIntent(id, { type: 'setLook', look: { ...look, shirt: -1 }, name: 'Ash' });
    sim.step();
    const p = sim.getEntity(id) as PlayerEntity;
    expect(p.look).toBeUndefined();
    expect(p.name).toBe('Wanderer');
  });
});
