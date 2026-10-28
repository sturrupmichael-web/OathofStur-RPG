import { describe, expect, it } from 'vitest';
import type { ServerMessage } from '../src/protocol/messages';
import type { GroundItemEntity } from '../src/sim/entities';
import { Simulation } from '../src/sim/Simulation';
import { addPlayer, besides, entities, loadWorld, monsters, run } from './helpers';

const map = loadWorld();
const strong = { levels: { attack: 70, strength: 70, defence: 70, hitpoints: 70 } };
const said = (log: ServerMessage[], text: string) => log.some((m) => (m.type === 'reject' && m.reason.includes(text)) || (m.type === 'gameMessage' && m.text.includes(text)));

describe('Sharing the world', () => {
  it('lets only one player fight an ordinary creature at a time', () => {
    const sim = new Simulation({ map, seed: 41 });
    const goblin = monsters(sim, 'goblin')[0];
    // A new character, so the goblin lasts a while.
    const a = addPlayer(sim, { at: besides(sim, goblin), hp: 10 });
    const b = addPlayer(sim, { ...strong, at: besides(sim, goblin) });
    sim.queueIntent(a.id, { type: 'attack', targetId: goblin.id });
    run(sim, 10, () => goblin.target === a.id);
    expect(goblin.target).toBe(a.id);
    sim.drain(b.id);
    sim.queueIntent(b.id, { type: 'attack', targetId: goblin.id });
    sim.queueIntent(b.id, { type: 'cast', spell: 'wind_bolt', targetId: goblin.id });
    run(sim, 1);
    expect(said(sim.drain(b.id), 'Someone else is fighting that')).toBe(true);
    expect(goblin.damageBy.has(b.id)).toBe(false);

    // Once the first fighter has gone, it's anyone's.
    sim.removePlayer(a.id);
    run(sim, 1);
    sim.queueIntent(b.id, { type: 'attack', targetId: goblin.id });
    run(sim, 60, () => goblin.respawnAt !== undefined);
    expect(goblin.respawnAt).toBeDefined();
  });

  it('shares a boss: everyone who hurt it gets their own loot', () => {
    const sim = new Simulation({ map, seed: 42 });
    const [drake] = monsters(sim, 'cinder_drake');
    const a = addPlayer(sim, { ...strong, at: besides(sim, drake) });
    const b = addPlayer(sim, { ...strong, at: besides(sim, drake) });
    for (const p of [a, b]) sim.queueIntent(p.id, { type: 'attack', targetId: drake.id });
    run(sim, 600, () => {
      a.hp = b.hp = 70; // keep both standing: this is about the loot, not the fight
      return drake.respawnAt !== undefined;
    });
    expect(drake.respawnAt).toBeDefined();
    const loot = entities(sim).filter((e): e is GroundItemEntity => e.kind === 'item');
    expect(loot.some((i) => i.owner === a.id)).toBe(true);
    expect(loot.some((i) => i.owner === b.id)).toBe(true);
  });

  it('gives a rejoining player their dropped items back, still hidden from others', () => {
    const sim = new Simulation({ map, seed: 43 });
    const first = sim.getEntity(sim.addPlayer('Ana', null, '', 'acct-ana'))!;
    const other = sim.addPlayer('Bo', null, '', 'acct-bo');
    sim.queueIntent(first.id, { type: 'invDrop', slot: 0 });
    run(sim, 1);
    const dropped = entities(sim).find((e): e is GroundItemEntity => e.kind === 'item' && e.owner === first.id)!;
    expect(dropped).toBeDefined();
    sim.removePlayer(first.id);
    const again = sim.addPlayer('Ana', null, '', 'acct-ana');
    expect(dropped.owner).toBe(again);
    run(sim, 1);
    const seenBy = (id: number) =>
      sim.drain(id).some((m) => (m.type === 'snapshot' ? m.entities : m.type === 'tick' ? m.added : []).some((e) => e.id === dropped.id));
    expect(seenBy(again)).toBe(true);
    expect(seenBy(other)).toBe(false);
  });
});
