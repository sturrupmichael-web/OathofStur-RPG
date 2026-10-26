import { describe, expect, it } from 'vitest';
import type { ServerMessage } from '../src/protocol/messages';
import type { ObjectEntity } from '../src/sim/entities';
import { countItem } from '../src/sim/items';
import { effectiveLevel } from '../src/sim/combat';
import { withPrayer } from '../src/sim/prayer';
import { parseSave } from '../src/sim/save';
import { ALTAR_MULTIPLIER, Simulation } from '../src/sim/Simulation';
import { combatLevel, startingXp, xpForLevel } from '../src/sim/skills';
import { addPlayer, besides, entities, kx, ky, loadWorld, monsters, run } from './helpers';

const map = loadWorld();
const TOWN = { x: kx(60), y: ky(48) };
const NESSA_DONE = { nessas_cauldron: 3 };

const texts = (log: ServerMessage[]) => log.flatMap((m) => (m.type === 'gameMessage' ? [m.text] : []));
const slotOf = (p: { inventory: ({ itemId: string } | null)[] }, itemId: string) => p.inventory.findIndex((s) => s?.itemId === itemId);

/** The Chapel of the Dawn's altar. */
function altar(sim: Simulation): ObjectEntity {
  return entities(sim).find((e): e is ObjectEntity => e.kind === 'station' && e.defKey === 'altar' && e.x === 201 && e.y === 96)!;
}

describe('Herblore', () => {
  it('is closed until Old Nessa has her cauldron going', () => {
    const sim = new Simulation({ map, seed: 1 });
    const p = addPlayer(sim, { at: TOWN, items: [['grimy_sunleaf', 1], ['sunleaf', 1]] });
    sim.drain(p.id);
    sim.queueIntent(p.id, { type: 'clean', slot: 0 });
    sim.queueIntent(p.id, { type: 'useItem', slot: 1 });
    run(sim, 3);
    expect(countItem(p.inventory, 'grimy_sunleaf')).toBe(1);
    expect(p.ui).toBeNull();
    expect(texts(sim.drain(p.id)).some((t) => t.includes('Old Nessa'))).toBe(true);
  });

  it('cleans every grimy herb of a kind, one after another', () => {
    const sim = new Simulation({ map, seed: 1 });
    const p = addPlayer(sim, { at: TOWN, quests: NESSA_DONE, items: [['grimy_sunleaf', 3], ['grimy_duskroot', 1]] });
    sim.queueIntent(p.id, { type: 'clean', slot: 0 });
    run(sim, 10);
    expect(countItem(p.inventory, 'sunleaf')).toBe(3);
    expect(countItem(p.inventory, 'grimy_duskroot')).toBe(1);
    expect(p.skills.herblore).toBe(7.5);
    // Duskroot needs level 20.
    sim.drain(p.id);
    sim.queueIntent(p.id, { type: 'clean', slot: slotOf(p, 'grimy_duskroot') });
    run(sim, 3);
    expect(texts(sim.drain(p.id))).toContain('You need a Herblore level of 20 to clean this herb.');
  });

  it('mixes a herb and a vial of water, then the second ingredient, into three doses', () => {
    const sim = new Simulation({ map, seed: 1 });
    const p = addPlayer(sim, { at: TOWN, quests: NESSA_DONE, levels: { herblore: 3 }, items: [['sunleaf', 2], ['vial_of_water', 2], ['crimson_feathers', 5]] });
    sim.queueIntent(p.id, { type: 'useItem', slot: 0 });
    run(sim, 1);
    expect(p.ui).toMatchObject({ kind: 'craft', station: 'herblore' });
    sim.queueIntent(p.id, { type: 'craft', recipeId: 'mix_sunleaf_unf', qty: 5 });
    run(sim, 10);
    expect(countItem(p.inventory, 'sunleaf_potion_unf')).toBe(2);
    expect(p.skills.herblore).toBe(xpForLevel(3));
    sim.queueIntent(p.id, { type: 'useItem', slot: slotOf(p, 'sunleaf_potion_unf') });
    run(sim, 1);
    sim.queueIntent(p.id, { type: 'craft', recipeId: 'mix_attack_potion', qty: 5 });
    run(sim, 10);
    expect(countItem(p.inventory, 'attack_potion3')).toBe(2);
    expect(countItem(p.inventory, 'crimson_feathers')).toBe(3);
    expect(p.skills.herblore).toBe(xpForLevel(3) + 50);
  });

  it('opens fletching or herblore from feathers, whichever was asked for', () => {
    const sim = new Simulation({ map, seed: 1 });
    const p = addPlayer(sim, { at: TOWN, quests: NESSA_DONE, items: [['feathers', 5], ['ashes', 1]] });
    sim.queueIntent(p.id, { type: 'useItem', slot: 0 });
    run(sim, 1);
    expect(p.ui).toMatchObject({ station: 'fletching' });
    sim.queueIntent(p.id, { type: 'useItem', slot: 1, station: 'herblore' });
    run(sim, 1);
    expect(p.ui).toMatchObject({ station: 'herblore' });
  });

  it('boosts with a potion dose by dose, and the boost fades a level a minute', () => {
    const sim = new Simulation({ map, seed: 1 });
    const p = addPlayer(sim, { at: TOWN, levels: { attack: 40 }, items: [['attack_potion3', 1]] });
    sim.queueIntent(p.id, { type: 'drink', slot: 0 });
    run(sim, 1);
    expect(p.boosts.attack).toBe(7);
    expect(p.inventory[0]).toEqual({ itemId: 'attack_potion2', qty: 1 });
    expect(effectiveLevel(p.skills, 'attack', p)).toBe(47);
    run(sim, 100);
    expect(p.boosts.attack).toBe(6);
    // Another dose tops it up rather than stacking.
    sim.queueIntent(p.id, { type: 'drink', slot: 0 });
    sim.queueIntent(p.id, { type: 'drink', slot: 0 });
    run(sim, 4);
    sim.queueIntent(p.id, { type: 'drink', slot: 0 });
    run(sim, 1);
    expect(p.boosts.attack).toBe(7);
    expect(p.inventory[0]).toEqual({ itemId: 'vial', qty: 1 });
  });

  it('drops herbs and bones from monsters', () => {
    const goblin = Object.values(map.defs.monsters).find((m) => m.key === 'goblin');
    expect(goblin).toBeDefined();
    const sim = new Simulation({ map, seed: 5 });
    const g = monsters(sim, 'goblin')[0];
    const p = addPlayer(sim, { at: besides(sim, g), levels: { attack: 40, strength: 40, defence: 40, hitpoints: 40 } });
    sim.queueIntent(p.id, { type: 'attack', targetId: g.id });
    run(sim, 100, () => g.respawnAt !== undefined);
    expect(entities(sim).some((e) => e.kind === 'item' && e.itemId === 'bones' && e.owner === p.id)).toBe(true);
  });
});

describe('Prayer', () => {
  it('buries bones and scatters ashes for XP, a couple of ticks apart', () => {
    const sim = new Simulation({ map, seed: 1 });
    const p = addPlayer(sim, { at: TOWN, items: [['bones', 1], ['big_bones', 1], ['ashes', 1]] });
    sim.queueIntent(p.id, { type: 'bury', slot: 0 });
    sim.queueIntent(p.id, { type: 'bury', slot: 1 });
    run(sim, 1);
    expect(p.skills.prayer).toBe(4.5);
    expect(countItem(p.inventory, 'big_bones')).toBe(1);
    run(sim, 2);
    sim.queueIntent(p.id, { type: 'bury', slot: 1 });
    run(sim, 3);
    sim.queueIntent(p.id, { type: 'bury', slot: 2 });
    run(sim, 1);
    expect(p.skills.prayer).toBe(4.5 + 15 + 2);
    expect(p.inventory.every((s) => !s)).toBe(true);
  });

  it('turns prayers on and off, and drains points while on', () => {
    const sim = new Simulation({ map, seed: 1 });
    const p = addPlayer(sim, { at: TOWN, levels: { prayer: 20, defence: 40 } });
    expect(p.prayer).toBe(20);
    sim.queueIntent(p.id, { type: 'togglePrayer', prayer: 'stone_skin' });
    run(sim, 1);
    expect(p.prayers).toEqual(['stone_skin']);
    expect(effectiveLevel(p.skills, 'defence', p)).toBe(44);
    run(sim, 99);
    // Ten points a minute.
    expect(Math.ceil(p.prayer)).toBe(10);
    sim.queueIntent(p.id, { type: 'togglePrayer', prayer: 'stone_skin' });
    run(sim, 1);
    expect(p.prayers).toEqual([]);
    run(sim, 50);
    expect(Math.ceil(p.prayer)).toBe(10);
  });

  it('needs the level, and runs out', () => {
    const sim = new Simulation({ map, seed: 1 });
    const p = addPlayer(sim, { at: TOWN, levels: { prayer: 5 } });
    sim.drain(p.id);
    sim.queueIntent(p.id, { type: 'togglePrayer', prayer: 'clear_mind' });
    run(sim, 1);
    expect(p.prayers).toEqual([]);
    expect(texts(sim.drain(p.id))).toContain('You need a Prayer level of 7 to use Clear Mind.');
    sim.queueIntent(p.id, { type: 'togglePrayer', prayer: 'oak_skin' });
    sim.queueIntent(p.id, { type: 'togglePrayer', prayer: 'burst_of_will' });
    // Two prayers at five points a minute each: five points last half a minute.
    run(sim, 51);
    expect(p.prayer).toBe(0);
    expect(p.prayers).toEqual([]);
    expect(texts(sim.drain(p.id)).some((t) => t.startsWith('You have run out of prayer points'))).toBe(true);
  });

  it('replaces prayers of the same kind, and melee and ranged push each other off', () => {
    expect(withPrayer(['oak_skin', 'clear_mind'], 'stone_skin')).toEqual(['clear_mind', 'stone_skin']);
    expect(withPrayer(['clear_mind', 'burst_of_will', 'oak_skin'], 'keen_eye')).toEqual(['oak_skin', 'keen_eye']);
    expect(withPrayer(['keen_eye'], 'bulls_might')).toEqual(['bulls_might']);
    expect(withPrayer(['ward_of_blades'], 'ember_ward')).toEqual(['ember_ward']);
  });

  it('recharges at an altar, and offers bones there for double XP', () => {
    const sim = new Simulation({ map, seed: 1 });
    const a = altar(sim);
    const p = addPlayer(sim, { at: { x: a.x, y: a.y + 2 }, levels: { prayer: 10 }, items: [['bones', 3], ['ashes', 1]] });
    p.prayer = 2;
    sim.queueIntent(p.id, { type: 'interact', targetId: a.id, action: 'use' });
    run(sim, 6);
    expect(p.prayer).toBe(10);
    const before = p.skills.prayer;
    sim.queueIntent(p.id, { type: 'interact', targetId: a.id, action: 'offer' });
    run(sim, 20);
    expect(countItem(p.inventory, 'bones')).toBe(0);
    expect(countItem(p.inventory, 'ashes')).toBe(1);
    expect(p.skills.prayer).toBe(before + 3 * 4.5 * ALTAR_MULTIPLIER);
  });

  it('Ward of Blades turns monster blows aside', () => {
    const sim = new Simulation({ map, seed: 2 });
    const g = monsters(sim, 'goblin')[0];
    const p = addPlayer(sim, { at: besides(sim, g), levels: { prayer: 40, hitpoints: 10 } });
    sim.queueIntent(p.id, { type: 'togglePrayer', prayer: 'ward_of_blades' });
    sim.queueIntent(p.id, { type: 'attack', targetId: g.id });
    const hits: number[] = [];
    for (let i = 0; i < 40; i++) {
      sim.step();
      for (const m of sim.drain(p.id)) if (m.type === 'hit' && m.targetId === p.id) hits.push(m.damage);
    }
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((d) => d === 0)).toBe(true);
  });

  it('restores prayer points with a devotion potion', () => {
    const sim = new Simulation({ map, seed: 1 });
    const p = addPlayer(sim, { at: TOWN, levels: { prayer: 40 }, items: [['devotion_potion1', 1]] });
    p.prayer = 3;
    sim.queueIntent(p.id, { type: 'drink', slot: 0 });
    run(sim, 1);
    expect(p.prayer).toBe(3 + 7 + 10);
    expect(p.inventory[0]).toEqual({ itemId: 'vial', qty: 1 });
  });

  it('counts Prayer a little in the combat level, and saves the points', () => {
    const xp = startingXp();
    const before = combatLevel(xp);
    xp.prayer = xpForLevel(40);
    expect(combatLevel(xp)).toBe(before + 5);
    const save = parseSave({ version: 3, name: 'Old', position: TOWN, skills: { attack: 0 }, inventory: [], equipment: {}, bank: [], prayer: 0, createdAt: '', updatedAt: '' })!;
    expect(save.skills.prayer).toBe(0);
    expect(save.skills.herblore).toBe(0);
    expect(save.prayer).toBe(0);
  });
});
