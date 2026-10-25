import { describe, expect, it } from 'vitest';
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
    sim.queueIntent(id, { type: 'walk', x: 42, y: 36 });
    sim.step();
    const p = sim.getEntity(id) as PlayerEntity;
    expect(p.y).toBe(32);
    run(sim, 4);
    expect([p.x, p.y]).toEqual([42, 36]);
  });

  it('walks next to a blocked object instead of onto it', () => {
    const sim = new Simulation({ map, seed: 1 });
    const id = sim.addPlayer('Tester');
    sim.queueIntent(id, { type: 'walk', x: 41, y: 29 }); // Town Guide
    run(sim, 10);
    const p = sim.getEntity(id) as PlayerEntity;
    expect(Math.abs(p.x - 41) + Math.abs(p.y - 29)).toBe(1);
  });

  it('stops a low-level player at the gate and explains why', () => {
    const sim = new Simulation({ map, seed: 1 });
    const id = sim.addPlayer('Tester');
    sim.queueIntent(id, { type: 'walk', x: 85, y: 45 });
    const messages: ServerMessage[] = [];
    for (let i = 0; i < 120; i++) {
      sim.step();
      messages.push(...sim.drain(id));
    }
    const p = sim.getEntity(id) as PlayerEntity;
    expect([p.x, p.y]).not.toEqual([85, 45]);
    expect(sim.grid.gateZone[sim.grid.index(p.x, p.y)]).toBe(-1);
    const warn = messages.find((m) => m.type === 'gameMessage' && m.kind === 'warn');
    expect(warn && warn.type === 'gameMessage' && warn.text).toMatch(/combat level of 20.*yours is 3/);
  });

  it('lets a qualified player through the gate', () => {
    const sim = new Simulation({ map, seed: 1 });
    const id = sim.addPlayer('Veteran');
    const p = sim.getEntity(id) as PlayerEntity;
    for (const s of ['attack', 'strength', 'defence', 'hitpoints'] as const) p.skills[s] = xpForLevel(20);
    expect(combatLevel(p.skills)).toBe(20);
    sim.queueIntent(id, { type: 'walk', x: 85, y: 45 });
    run(sim, 120);
    expect([p.x, p.y]).toEqual([85, 45]);
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
        if (i === 15) sim.queueIntent(id, { type: 'walk', x: 70, y: 31 });
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
    sim.queueIntent(id, { type: 'walk', x: 42, y: 34 });
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
