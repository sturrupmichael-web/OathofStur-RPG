import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { GroundItemEntity, ObjectEntity } from '../src/sim/entities';
import { ITEMS, countItem } from '../src/sim/items';
import { MONSTERS } from '../src/sim/combat';
import { Simulation } from '../src/sim/Simulation';
import { addPlayer, besides, entities, loadWorld, monsters, run } from './helpers';

const map = loadWorld();
const TIERS = ['cobalt', 'verdite', 'glacite'] as const;
const PIECES = ['bar', 'dagger', 'sword', 'helm', 'chainbody', 'platelegs', 'shield', 'axe', 'pickaxe', 'arrowheads', 'arrow'];
const recipes = (JSON.parse(readFileSync(new URL('../data/recipes.json', import.meta.url), 'utf8')) as { recipes: { id: string; level: number; inputs: { itemId: string }[]; output: string }[] }).recipes;
const bounty = JSON.parse(readFileSync(new URL('../data/bounty.json', import.meta.url), 'utf8')) as { tasks: { monster: string }[] };

function object(sim: Simulation, defKey: string, near: { x: number; y: number }): ObjectEntity {
  const all = entities(sim).filter((e): e is ObjectEntity => e.kind !== 'player' && e.kind !== 'monster' && e.kind !== 'item' && e.defKey === defKey);
  return all.sort((a, b) => Math.hypot(a.x - near.x, a.y - near.y) - Math.hypot(b.x - near.x, b.y - near.y))[0];
}

function beside(sim: Simulation, o: ObjectEntity) {
  for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1]]) if (sim.grid.isWalkable(o.x + dx, o.y + dy)) return { x: o.x + dx, y: o.y + dy };
  throw new Error(`no room beside ${o.defKey}`);
}

describe('Cobalt, verdite and glacite', () => {
  it('each tier has bars, weapons, armour, tools and arrows, each better than the last', () => {
    for (const t of TIERS) for (const piece of PIECES) expect(ITEMS[`${t}_${piece}`], `${t}_${piece}`).toBeDefined();
    const sword = TIERS.map((t) => ITEMS[`${t}_sword`].equip!);
    expect(sword.map((e) => e.level)).toEqual([20, 30, 40]);
    expect(ITEMS.steel_sword.equip!.attack!).toBeLessThan(sword[0].attack!);
    for (let i = 1; i < 3; i++) {
      expect(sword[i].attack!).toBeGreaterThan(sword[i - 1].attack!);
      expect(ITEMS[`${TIERS[i]}_chainbody`].equip!.defence!).toBeGreaterThan(ITEMS[`${TIERS[i - 1]}_chainbody`].equip!.defence!);
      expect(ITEMS[`${TIERS[i]}_pickaxe`].tool!.bonus).toBeGreaterThan(ITEMS[`${TIERS[i - 1]}_pickaxe`].tool!.bonus);
      expect(ITEMS[`${TIERS[i]}_arrow`].ammo!.strength).toBeGreaterThan(ITEMS[`${TIERS[i - 1]}_arrow`].ammo!.strength);
    }
  });

  it('every piece can be made, from ore at the furnace to the anvil and the fletching knife', () => {
    for (const t of TIERS)
      for (const piece of PIECES) expect(recipes.some((r) => r.output === `${t}_${piece}`), `${t}_${piece}`).toBe(true);
    const smelt = TIERS.map((t) => recipes.find((r) => r.id === `smelt_${t}`)!);
    expect(smelt.map((r) => r.level)).toEqual([50, 70, 85]);
    for (const r of smelt) expect(r.inputs.map((i) => i.itemId)).toContain('coal');
  });

  it('smelts cobalt at the Corvane furnace and smiths a cobalt sword at the anvil', () => {
    const sim = new Simulation({ map, seed: 11 });
    const furnace = object(sim, 'furnace', { x: 454, y: 135 });
    const player = addPlayer(sim, { at: beside(sim, furnace), levels: { smithing: 55 }, items: [['cobalt_ore', 2], ['coal', 8], ['hammer', 1]] });
    sim.queueIntent(player.id, { type: 'interact', targetId: furnace.id, action: 'use' });
    run(sim, 3);
    sim.queueIntent(player.id, { type: 'craft', recipeId: 'smelt_cobalt', qty: 2 });
    run(sim, 20);
    expect(countItem(player.inventory, 'cobalt_bar')).toBe(2);
    expect(countItem(player.inventory, 'coal')).toBe(0);

    const anvil = object(sim, 'anvil', furnace);
    sim.queueIntent(player.id, { type: 'interact', targetId: anvil.id, action: 'use' });
    run(sim, 20, () => player.ui?.kind === 'craft');
    sim.queueIntent(player.id, { type: 'craft', recipeId: 'smith_cobalt_sword', qty: 1 });
    run(sim, 8);
    expect(countItem(player.inventory, 'cobalt_sword')).toBe(1);
  });

  it("won't smelt glacite below Smithing 85", () => {
    const sim = new Simulation({ map, seed: 12 });
    const furnace = object(sim, 'furnace', { x: 454, y: 135 });
    const player = addPlayer(sim, { at: beside(sim, furnace), levels: { smithing: 84 }, items: [['glacite_ore', 1], ['coal', 8]] });
    sim.queueIntent(player.id, { type: 'interact', targetId: furnace.id, action: 'use' });
    run(sim, 3);
    sim.queueIntent(player.id, { type: 'craft', recipeId: 'smelt_glacite', qty: 1 });
    run(sim, 10);
    expect(countItem(player.inventory, 'glacite_bar')).toBe(0);
    expect(countItem(player.inventory, 'glacite_ore')).toBe(1);
  });
});

describe('Creatures of the new lands', () => {
  const where: Record<string, string> = { fen_lurker: 'Saltmere Fen', frost_wolf: 'Frostpeak Heights', barrow_wight: 'The Barrowfield', dusk_stalker: 'The Duskwood' };

  it('live in their own regions, drop real items and can be given as bounties', () => {
    const sim = new Simulation({ map, seed: 13 });
    for (const [key, region] of Object.entries(where)) {
      const found = monsters(sim, key);
      expect(found.length, key).toBeGreaterThanOrEqual(3);
      const a = map.areas.find((r) => r.name === region)!;
      for (const m of found) expect(m.x >= a.x && m.y >= a.y && m.x < a.x + a.w && m.y < a.y + a.h, `${key} at ${m.x},${m.y}`).toBe(true);
      for (const d of MONSTERS[key].drops) expect(ITEMS[d.item], `${key} drops ${d.item}`).toBeDefined();
      expect(bounty.tasks.some((t) => t.monster === key)).toBe(true);
    }
  });

  it('a frost wolf always leaves its pelt', () => {
    const sim = new Simulation({ map, seed: 14 });
    const wolf = monsters(sim, 'frost_wolf')[0];
    const hero = addPlayer(sim, { at: besides(sim, wolf), levels: { attack: 90, strength: 90, defence: 90, hitpoints: 90 }, equipment: { weapon: 'glacite_sword' } });
    sim.queueIntent(hero.id, { type: 'attack', targetId: wolf.id });
    run(sim, 300, () => wolf.respawnAt !== undefined);
    expect(wolf.respawnAt).toBeDefined();
    const loot = entities(sim).filter((e): e is GroundItemEntity => e.kind === 'item' && e.x === wolf.x && e.y === wolf.y);
    expect(loot.map((l) => l.itemId)).toContain('wolf_pelt');
  });
});
