import { describe, expect, it } from 'vitest';
import type { ServerMessage } from '../src/protocol/messages';
import type { Entity, PlayerEntity } from '../src/sim/entities';
import { addItem, countItem, emptyInventory } from '../src/sim/items';
import { parseSave } from '../src/sim/save';
import { Simulation } from '../src/sim/Simulation';
import { xpForLevel } from '../src/sim/skills';
import { loadWorld } from './helpers';

const map = loadWorld();

/** A player standing at (x, y) with only the given items. */
function setup(x: number, y: number, items: [string, number][] = [], seed = 1) {
  const sim = new Simulation({ map, seed });
  const id = sim.addPlayer('Tester');
  const player = sim.getEntity(id) as PlayerEntity;
  player.x = x;
  player.y = y;
  player.inventory = emptyInventory();
  for (const [item, qty] of items) addItem(player.inventory, item, qty);
  const messages: ServerMessage[] = [];
  const run = (ticks: number) => {
    for (let i = 0; i < ticks; i++) {
      sim.step();
      messages.push(...sim.drain(id));
    }
  };
  sim.drain(id);
  const texts = () => messages.flatMap((m) => (m.type === 'gameMessage' ? [m.text] : []));
  return { sim, id, player, messages, run, texts };
}

function at(sim: Simulation, defKey: string, x: number, y: number): Entity {
  for (let id = 1; id < 5000; id++) {
    const e = sim.getEntity(id);
    if (e && 'defKey' in e && e.defKey === defKey && e.x === x && e.y === y) return e;
  }
  throw new Error(`no ${defKey} at ${x},${y}`);
}

/** Keep doing something until `done`, re-issuing the intent when the player goes idle. */
function until(s: ReturnType<typeof setup>, intent: () => void, done: () => boolean, max = 3000) {
  intent();
  for (let t = 0; t < max && !done(); t++) {
    s.run(1);
    if (!s.player.action && !done()) intent();
  }
  expect(done()).toBe(true);
}

describe('New characters', () => {
  it('start with an axe, a net and 25 coins', () => {
    const sim = new Simulation({ map, seed: 1 });
    const p = sim.getEntity(sim.addPlayer('New')) as PlayerEntity;
    expect(countItem(p.inventory, 'bronze_axe')).toBe(1);
    expect(countItem(p.inventory, 'small_net')).toBe(1);
    expect(countItem(p.inventory, 'coins')).toBe(25);
  });
});

describe('Mining', () => {
  it('needs a pickaxe', () => {
    const s = setup(85, 78);
    const rock = at(s.sim, 'copper_rock', 86, 78);
    s.sim.queueIntent(s.id, { type: 'interact', targetId: rock.id, action: 'gather' });
    s.run(2);
    expect(s.texts()).toContain('You need a pickaxe to mine this rock.');
  });

  it('mines one ore, then the rock is empty until it refills', () => {
    const s = setup(85, 78, [['bronze_pickaxe', 1]]);
    const rock = at(s.sim, 'copper_rock', 86, 78) as Entity & { depletedUntil?: number };
    until(s, () => s.sim.queueIntent(s.id, { type: 'interact', targetId: rock.id, action: 'gather' }), () => countItem(s.player.inventory, 'copper_ore') === 1);
    expect(rock.depletedUntil).toBeDefined();
    expect(s.player.skills.mining).toBe(17.5);
    expect(s.texts()).toContain('You manage to mine some copper ore.');
    s.run(5);
    expect(rock.depletedUntil).toBeUndefined();
  });

  it('needs Mining 15 for iron', () => {
    const s = setup(86, 78, [['bronze_pickaxe', 1]]);
    const rock = at(s.sim, 'iron_rock', 87, 78);
    s.sim.queueIntent(s.id, { type: 'interact', targetId: rock.id, action: 'gather' });
    s.run(2);
    expect(s.texts()).toContain('You need a Mining level of 15 to mine this rock.');
  });
});

describe('Fishing', () => {
  it('nets minnows at a shallow spot without using it up', () => {
    const s = setup(99, 55, [['small_net', 1]]);
    const spot = at(s.sim, 'shallow_fishing_spot', 100, 55);
    until(s, () => s.sim.queueIntent(s.id, { type: 'interact', targetId: spot.id, action: 'gather' }), () => countItem(s.player.inventory, 'raw_minnows') >= 3);
    expect(s.player.skills.fishing).toBe(countItem(s.player.inventory, 'raw_minnows') * 10);
    expect((spot as { depletedUntil?: number }).depletedUntil).toBeUndefined();
  });

  it('rod fishing needs level 15 and uses bait', () => {
    const s = setup(100, 66, [['fishing_rod', 1], ['fishing_bait', 2]]);
    const spot = at(s.sim, 'deep_fishing_spot', 101, 66);
    s.sim.queueIntent(s.id, { type: 'interact', targetId: spot.id, action: 'gather' });
    s.run(2);
    expect(s.texts()).toContain('You need a Fishing level of 15 to fish here.');

    s.player.skills.fishing = xpForLevel(15);
    until(s, () => s.sim.queueIntent(s.id, { type: 'interact', targetId: spot.id, action: 'gather' }), () => countItem(s.player.inventory, 'fishing_bait') === 0);
    expect(countItem(s.player.inventory, 'raw_perch')).toBe(2);
    s.sim.queueIntent(s.id, { type: 'interact', targetId: spot.id, action: 'gather' });
    s.run(2);
    expect(s.texts()).toContain("You don't have any fishing bait left.");
  });
});

describe('Cooking and smithing', () => {
  it('cooks fish on the range, sometimes burning them at low level', () => {
    const s = setup(67, 58, [['raw_minnows', 10]]);
    const range = at(s.sim, 'range', 68, 58);
    s.sim.queueIntent(s.id, { type: 'interact', targetId: range.id, action: 'use' });
    s.run(1);
    expect(s.player.ui?.kind).toBe('craft');
    s.sim.queueIntent(s.id, { type: 'craft', recipeId: 'cook_minnows', qty: 10 });
    s.run(60);
    const cooked = countItem(s.player.inventory, 'minnows');
    const burnt = countItem(s.player.inventory, 'burnt_fish');
    expect(cooked + burnt).toBe(10);
    expect(burnt).toBeGreaterThan(0);
    expect(s.player.skills.cooking).toBe(cooked * 30);
  });

  it('smelts bronze, then smiths a dagger with a hammer', () => {
    const s = setup(42, 51, [['copper_ore', 2], ['tin_ore', 2], ['hammer', 1]]);
    const furnace = at(s.sim, 'furnace', 43, 51);
    s.sim.queueIntent(s.id, { type: 'interact', targetId: furnace.id, action: 'use' });
    s.run(1);
    s.sim.queueIntent(s.id, { type: 'craft', recipeId: 'smelt_bronze', qty: 5 });
    s.run(20);
    expect(countItem(s.player.inventory, 'bronze_bar')).toBe(2);
    expect(countItem(s.player.inventory, 'copper_ore')).toBe(0);
    expect(s.player.skills.smithing).toBe(12);

    const anvil = at(s.sim, 'anvil', 41, 52);
    s.sim.queueIntent(s.id, { type: 'interact', targetId: anvil.id, action: 'use' });
    s.run(3);
    expect(s.player.ui?.kind).toBe('craft');
    s.sim.queueIntent(s.id, { type: 'craft', recipeId: 'smith_bronze_dagger', qty: 1 });
    s.run(3);
    expect(countItem(s.player.inventory, 'bronze_dagger')).toBe(1);
    expect(s.texts()).toContain('You hammer the metal and make a bronze dagger.');
  });

  it('refuses the anvil without a hammer', () => {
    const s = setup(41, 51, [['bronze_bar', 1]]);
    const anvil = at(s.sim, 'anvil', 41, 52);
    s.sim.queueIntent(s.id, { type: 'interact', targetId: anvil.id, action: 'use' });
    s.run(1);
    expect(s.player.ui).toBeNull();
    expect(s.texts()).toContain('You need a hammer to work the metal with.');
  });
});

describe('Bank and shops', () => {
  it('deposits and withdraws at a bank booth, and the bank is saved', () => {
    const s = setup(39, 42, [['logs', 5], ['coins', 100]]);
    const booth = at(s.sim, 'bank_booth', 39, 41);
    s.sim.queueIntent(s.id, { type: 'interact', targetId: booth.id, action: 'use' });
    s.run(1);
    expect(s.player.ui?.kind).toBe('bank');
    s.sim.queueIntent(s.id, { type: 'bankDepositAll' });
    s.run(1);
    expect(s.player.inventory.every((x) => x === null)).toBe(true);
    expect(s.player.bank).toEqual([
      { itemId: 'logs', qty: 5 },
      { itemId: 'coins', qty: 100 },
    ]);
    s.sim.queueIntent(s.id, { type: 'bankWithdraw', index: 0, qty: 2 });
    s.run(1);
    expect(countItem(s.player.inventory, 'logs')).toBe(2);

    const save = parseSave(JSON.parse(JSON.stringify(s.sim.saveFor(s.id, 'now'))))!;
    expect(save.bank).toEqual([
      { itemId: 'logs', qty: 3 },
      { itemId: 'coins', qty: 100 },
    ]);
  });

  it('buys from and sells to the General Store', () => {
    const s = setup(73, 51, [['coins', 25], ['logs', 3]]);
    const keeper = at(s.sim, 'shopkeeper', 73, 52);
    s.sim.queueIntent(s.id, { type: 'interact', targetId: keeper.id, action: 'use' });
    s.run(1);
    expect(s.player.ui?.kind).toBe('shop');
    s.sim.queueIntent(s.id, { type: 'shopBuy', itemId: 'bronze_pickaxe', qty: 1 });
    s.run(1);
    expect(countItem(s.player.inventory, 'bronze_pickaxe')).toBe(1);
    expect(countItem(s.player.inventory, 'coins')).toBe(9);
    const logSlot = s.player.inventory.findIndex((x) => x?.itemId === 'logs');
    s.sim.queueIntent(s.id, { type: 'shopSell', slot: logSlot, qty: 3 });
    s.run(1);
    expect(countItem(s.player.inventory, 'logs')).toBe(0);
    expect(countItem(s.player.inventory, 'coins')).toBe(9 + 3 * 1);
  });

  it('will not sell what you cannot afford, and closes when you walk away', () => {
    const s = setup(73, 51, [['coins', 10]]);
    const keeper = at(s.sim, 'shopkeeper', 73, 52);
    s.sim.queueIntent(s.id, { type: 'interact', targetId: keeper.id, action: 'use' });
    s.run(1);
    s.sim.queueIntent(s.id, { type: 'shopBuy', itemId: 'iron_axe', qty: 1 });
    s.run(1);
    expect(s.texts()).toContain("You don't have enough coins.");
    s.sim.queueIntent(s.id, { type: 'walk', x: 73, y: 47 });
    s.run(1);
    expect(s.player.ui).toBeNull();
  });
});
