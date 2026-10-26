import { describe, expect, it } from 'vitest';
import type { Point } from '../src/map/types';
import type { ServerMessage } from '../src/protocol/messages';
import type { GroundItemEntity, MonsterEntity } from '../src/sim/entities';
import { countItem } from '../src/sim/items';
import { parseSave } from '../src/sim/save';
import { Simulation } from '../src/sim/Simulation';
import { combatLevel, startingXp, xpForLevel } from '../src/sim/skills';
import { addPlayer, entities, kx, ky, loadWorld, monsters, run } from './helpers';

const map = loadWorld();
const TOWN = { x: kx(60), y: ky(48) };

const texts = (log: ServerMessage[]) => log.flatMap((m) => (m.type === 'gameMessage' ? [m.text] : []));

/** Runs some ticks and returns everything the player was sent. */
function watch(sim: Simulation, id: number, ticks: number): ServerMessage[] {
  const log: ServerMessage[] = [];
  for (let i = 0; i < ticks; i++) {
    sim.step();
    log.push(...sim.drain(id));
  }
  return log;
}

/** Opens the fletching window from a carried item and makes `qty` of a recipe. */
function fletch(sim: Simulation, id: number, slot: number, recipeId: string, qty: number, ticks = 60) {
  sim.queueIntent(id, { type: 'useItem', slot });
  run(sim, 1);
  sim.queueIntent(id, { type: 'craft', recipeId, qty });
  run(sim, ticks);
}

describe('Fletching', () => {
  it('whittles logs into shafts and bows with a knife, then strings the bow', () => {
    const sim = new Simulation({ map, seed: 1 });
    const p = addPlayer(sim, { at: TOWN, levels: { fletching: 10 }, items: [['knife', 1], ['logs', 3], ['bowstring', 1]] });
    fletch(sim, p.id, 1, 'fletch_shafts', 1);
    expect(countItem(p.inventory, 'arrow_shaft')).toBe(15);
    fletch(sim, p.id, 1, 'fletch_longbow', 1);
    expect(countItem(p.inventory, 'longbow_u')).toBe(1);
    const slot = p.inventory.findIndex((s) => s?.itemId === 'bowstring');
    fletch(sim, p.id, slot, 'string_longbow', 1);
    expect(countItem(p.inventory, 'longbow')).toBe(1);
    expect(countItem(p.inventory, 'logs')).toBe(1);
    expect(p.skills.fletching).toBe(xpForLevel(10) + 5 + 10 + 10);
  });

  it('needs a knife to carve and the level for the bow', () => {
    const sim = new Simulation({ map, seed: 1 });
    const p = addPlayer(sim, { at: TOWN, items: [['logs', 1]] });
    const log: ServerMessage[] = [];
    sim.drain(p.id);
    sim.queueIntent(p.id, { type: 'useItem', slot: 0 });
    run(sim, 1);
    sim.queueIntent(p.id, { type: 'craft', recipeId: 'fletch_shafts', qty: 1 });
    log.push(...watch(sim, p.id, 5));
    expect(texts(log)).toContain('You need a knife to fletch that.');

    addItemTo(p, 'knife');
    sim.queueIntent(p.id, { type: 'useItem', slot: 0 });
    run(sim, 1);
    sim.queueIntent(p.id, { type: 'craft', recipeId: 'fletch_longbow', qty: 1 });
    log.push(...watch(sim, p.id, 5));
    expect(texts(log)).toContain('You need a Fletching level of 10 to make a longbow (unstrung).');
    expect(countItem(p.inventory, 'logs')).toBe(1);
  });

  it('builds arrows in batches of 15, or fewer when parts run short', () => {
    const sim = new Simulation({ map, seed: 1 });
    const p = addPlayer(sim, { at: TOWN, items: [['arrow_shaft', 25], ['feathers', 40], ['bronze_arrowheads', 30]] });
    fletch(sim, p.id, 0, 'fletch_headless', 5);
    expect(countItem(p.inventory, 'headless_arrow')).toBe(25);
    expect(countItem(p.inventory, 'arrow_shaft')).toBe(0);
    expect(countItem(p.inventory, 'feathers')).toBe(15);
    expect(p.skills.fletching).toBe(15 + 10);
    const slot = p.inventory.findIndex((s) => s?.itemId === 'headless_arrow');
    fletch(sim, p.id, slot, 'fletch_bronze_arrows', 5);
    expect(countItem(p.inventory, 'bronze_arrow')).toBe(25);
    expect(countItem(p.inventory, 'bronze_arrowheads')).toBe(5);
  });

  it('says nothing happens for items that are not for fletching', () => {
    const sim = new Simulation({ map, seed: 1 });
    const p = addPlayer(sim, { at: TOWN, items: [['coins', 5]] });
    sim.drain(p.id);
    sim.queueIntent(p.id, { type: 'useItem', slot: 0 });
    run(sim, 1);
    expect(p.ui).toBeNull();
    expect(texts(sim.drain(p.id))).toContain('Nothing interesting happens.');
  });
});

function addItemTo(p: { inventory: ({ itemId: string; qty: number } | null)[] }, itemId: string) {
  const i = p.inventory.findIndex((s) => !s);
  p.inventory[i] = { itemId, qty: 1 };
}

/** A walkable tile `d` steps straight out from a monster with nothing in the way. */
function inRange(sim: Simulation, m: MonsterEntity, d: number): Point {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    let ok = true;
    for (let i = 1; i <= d && ok; i++) ok = sim.grid.isWalkable(m.x + dx * i, m.y + dy * i);
    if (ok) return { x: m.x + dx * d, y: m.y + dy * d };
  }
  throw new Error('no open line from the monster');
}

describe('Ranged', () => {
  const archer = (sim: Simulation, goblin: MonsterEntity, items: [string, number][] = [['bronze_arrow', 50]]) =>
    addPlayer(sim, { at: inRange(sim, goblin, 4), levels: { ranged: 30, defence: 30, hitpoints: 30 }, items, equipment: { weapon: 'shortbow' } });

  it('shoots from a distance, using arrows and leaving some to pick up', () => {
    const sim = new Simulation({ map, seed: 3 });
    const goblin = monsters(sim, 'goblin')[0];
    const p = archer(sim, goblin);
    const start = { x: p.x, y: p.y };
    sim.queueIntent(p.id, { type: 'attack', targetId: goblin.id });
    const log = watch(sim, p.id, 3);
    expect([p.x, p.y]).toEqual([start.x, start.y]);
    expect(log.some((m) => m.type === 'animation' && m.entityId === p.id && m.kind === 'shoot')).toBe(true);
    run(sim, 200, () => goblin.respawnAt !== undefined);
    expect(goblin.respawnAt).toBeDefined();
    const fired = 50 - countItem(p.inventory, 'bronze_arrow');
    expect(fired).toBeGreaterThan(0);
    expect(p.skills.ranged).toBeGreaterThan(xpForLevel(30));
    expect(p.skills.attack).toBe(0);
    const dropped = entities(sim)
      .filter((e): e is GroundItemEntity => e.kind === 'item' && e.itemId === 'bronze_arrow' && e.owner === p.id)
      .reduce((n, e) => n + e.qty, 0);
    expect(dropped).toBeGreaterThan(0);
    expect(dropped).toBeLessThanOrEqual(fired);
  });

  it('stops when the arrows run out', () => {
    const sim = new Simulation({ map, seed: 3 });
    const goblin = monsters(sim, 'goblin')[0];
    const p = archer(sim, goblin, [['bronze_arrow', 1]]);
    sim.drain(p.id);
    sim.queueIntent(p.id, { type: 'attack', targetId: goblin.id });
    const log = watch(sim, p.id, 12);
    expect(countItem(p.inventory, 'bronze_arrow')).toBe(0);
    expect(texts(log)).toContain('You have no arrows left to fire.');
  });

  it('needs the Ranged level for better bows and arrows', () => {
    const sim = new Simulation({ map, seed: 3 });
    const goblin = monsters(sim, 'goblin')[0];
    const p = addPlayer(sim, { at: inRange(sim, goblin, 3), items: [['oak_shortbow', 1], ['steel_arrow', 5]], equipment: { weapon: 'shortbow' } });
    sim.drain(p.id);
    sim.queueIntent(p.id, { type: 'equip', slot: 0 });
    run(sim, 1);
    expect(p.equipment.weapon).toBe('shortbow');
    expect(texts(sim.drain(p.id))).toContain('You need a Ranged level of 5 to wield this.');
    sim.queueIntent(p.id, { type: 'attack', targetId: goblin.id });
    const log = watch(sim, p.id, 3);
    expect(texts(log)).toContain('You need a higher Ranged level to fire the arrows you carry.');
    expect(countItem(p.inventory, 'steel_arrow')).toBe(5);
  });

  it('takes both hands: a bow and a shield push each other off', () => {
    const sim = new Simulation({ map, seed: 3 });
    const p = addPlayer(sim, { at: TOWN, items: [['shortbow', 1], ['bronze_shield', 1]], equipment: { weapon: 'bronze_sword', shield: 'iron_shield' } });
    sim.queueIntent(p.id, { type: 'equip', slot: 0 });
    run(sim, 1);
    expect(p.equipment).toEqual({ weapon: 'shortbow' });
    expect(countItem(p.inventory, 'bronze_sword') + countItem(p.inventory, 'iron_shield')).toBe(2);
    sim.queueIntent(p.id, { type: 'equip', slot: 1 });
    run(sim, 1);
    expect(p.equipment).toEqual({ shield: 'bronze_shield' });
    expect(countItem(p.inventory, 'shortbow')).toBe(1);
  });

  it('walks closer when a wall is in the way', () => {
    const sim = new Simulation({ map, seed: 3 });
    const goblin = monsters(sim, 'goblin')[0];
    const p = archer(sim, goblin);
    // Drop a wall between them by blocking the middle tile.
    const mid = { x: Math.round((p.x + goblin.x) / 2), y: Math.round((p.y + goblin.y) / 2) };
    sim.grid.blocked[sim.grid.index(mid.x, mid.y)] = 1;
    const start = { x: p.x, y: p.y };
    sim.queueIntent(p.id, { type: 'attack', targetId: goblin.id });
    run(sim, 2);
    expect([p.x, p.y]).not.toEqual([start.x, start.y]);
  });

  it('counts Ranged in the combat level', () => {
    const xp = startingXp();
    const melee = combatLevel(xp);
    xp.ranged = xpForLevel(40);
    expect(combatLevel(xp)).toBeGreaterThan(melee);
  });

  it('gives old saves the new skills at level 1', () => {
    const save = parseSave({ version: 3, name: 'Old', position: TOWN, skills: { attack: 0 }, inventory: [], equipment: {}, bank: [], createdAt: '', updatedAt: '' })!;
    expect(save.skills.ranged).toBe(0);
    expect(save.skills.fletching).toBe(0);
  });
});
