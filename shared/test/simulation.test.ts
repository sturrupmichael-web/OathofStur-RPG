import { describe, expect, it } from 'vitest';
import type { MapData } from '../src/map/types';
import type { ServerMessage } from '../src/protocol/messages';
import type { PlayerEntity } from '../src/sim/entities';
import { Simulation } from '../src/sim/Simulation';
import { combatLevel, levelForXp, startingXp, xpForLevel } from '../src/sim/skills';
import { loadWorld } from './helpers';

const map = loadWorld();

function run(sim: Simulation, ticks: number) {
  for (let i = 0; i < ticks; i++) sim.step();
}

describe('Simulation', () => {
  it('moves one tile per tick toward a clicked tile', () => {
    const sim = new Simulation({ map, seed: 1 });
    const id = sim.addPlayer('Tester');
    sim.queueIntent(id, { type: 'walk', x: 60, y: 53 });
    sim.step();
    const p = sim.getEntity(id) as PlayerEntity;
    expect(p.y).toBe(50);
    run(sim, 3);
    expect([p.x, p.y]).toEqual([60, 53]);
  });

  it('walks next to a blocked object instead of onto it', () => {
    const sim = new Simulation({ map, seed: 1 });
    const id = sim.addPlayer('Tester');
    sim.queueIntent(id, { type: 'walk', x: 39, y: 52 }); // smithy anvil
    run(sim, 60);
    const p = sim.getEntity(id) as PlayerEntity;
    expect(Math.abs(p.x - 39) + Math.abs(p.y - 52)).toBe(1);
  });

  // Kelmoor has no requirement gates yet, so the gate rule runs on a small hand-made map.
  const gated: MapData = {
    id: 'gated',
    width: 7,
    height: 3,
    // #######
    // ...G...   spawn at the left, gated room on the right
    // #######
    terrain: [1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 2, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1],
    terrainDefs: [
      { key: 'grass', name: 'Grass', walkable: true },
      { key: 'wall', name: 'Wall', walkable: false },
      { key: 'gate', name: 'Gate', walkable: true, requires: { skill: 'combat', level: 20 } },
    ],
    placements: [],
    areas: [],
    spawn: { x: 0, y: 1 },
    defs: { resources: {}, stations: {}, scenery: {}, npcs: {}, monsters: {} },
  };

  it('stops a low-level player at a gate and explains why', () => {
    const sim = new Simulation({ map: gated, seed: 1 });
    const id = sim.addPlayer('Tester');
    sim.queueIntent(id, { type: 'walk', x: 6, y: 1 });
    const messages: ServerMessage[] = [];
    for (let i = 0; i < 20; i++) {
      sim.step();
      messages.push(...sim.drain(id));
    }
    const p = sim.getEntity(id) as PlayerEntity;
    expect([p.x, p.y]).toEqual([2, 1]);
    const warn = messages.find((m) => m.type === 'gameMessage' && m.kind === 'warn');
    expect(warn && warn.type === 'gameMessage' && warn.text).toMatch(/combat level of 20.*yours is 3/);
  });

  it('lets a qualified player through a gate', () => {
    const sim = new Simulation({ map: gated, seed: 1 });
    const id = sim.addPlayer('Veteran');
    const p = sim.getEntity(id) as PlayerEntity;
    for (const s of ['attack', 'strength', 'defence', 'hitpoints'] as const) p.skills[s] = xpForLevel(20);
    expect(combatLevel(p.skills)).toBe(20);
    sim.queueIntent(id, { type: 'walk', x: 6, y: 1 });
    run(sim, 20);
    expect([p.x, p.y]).toEqual([6, 1]);
  });

  it('rejects malformed intents without crashing', () => {
    const sim = new Simulation({ map, seed: 1 });
    const id = sim.addPlayer('Tester');
    sim.drain(id);
    sim.queueIntent(id, { type: 'walk', x: 1.5, y: -3 });
    sim.step();
    expect(sim.drain(id).some((m) => m.type === 'reject')).toBe(true);
  });

  it('is deterministic for the same seed and intents', () => {
    const play = () => {
      const sim = new Simulation({ map, seed: 42 });
      const id = sim.addPlayer('Tester');
      const log: ServerMessage[] = [];
      sim.queueIntent(id, { type: 'walk', x: 10, y: 45 });
      for (let i = 0; i < 40; i++) {
        if (i === 15) sim.queueIntent(id, { type: 'walk', x: 109, y: 40 });
        sim.step();
        log.push(...sim.drain(id));
      }
      return JSON.stringify(log) + sim.rng.getState();
    };
    expect(play()).toBe(play());
  });

  it('sends only changed entities each tick', () => {
    const sim = new Simulation({ map, seed: 1 });
    const id = sim.addPlayer('Tester');
    sim.drain(id);
    sim.queueIntent(id, { type: 'walk', x: 60, y: 51 });
    sim.step();
    const tick = sim.drain(id).find((m) => m.type === 'tick');
    expect(tick && tick.type === 'tick' && tick.updated.map((e) => e.id)).toEqual([id]);
  });
});

describe('skills', () => {
  it('has a monotonic exponential curve from 1 to 99', () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(70);
    for (let l = 2; l <= 99; l++) expect(xpForLevel(l)).toBeGreaterThan(xpForLevel(l - 1));
    expect(levelForXp(xpForLevel(50))).toBe(50);
    expect(levelForXp(xpForLevel(50) - 1)).toBe(49);
    expect(levelForXp(1e9)).toBe(99);
  });

  it('starts a new character at combat level 3 with 10 hitpoints', () => {
    const xp = startingXp();
    expect(levelForXp(xp.hitpoints)).toBe(10);
    expect(combatLevel(xp)).toBe(3);
  });
});
