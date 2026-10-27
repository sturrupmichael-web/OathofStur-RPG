import { describe, expect, it } from 'vitest';
import type { ServerMessage } from '../src/protocol/messages';
import type { ObjectEntity, PlayerEntity } from '../src/sim/entities';
import { countItem } from '../src/sim/items';
import { parseSave } from '../src/sim/save';
import { Simulation } from '../src/sim/Simulation';
import { addPlayer, besides, entities, loadWorld, monsters, run, type Setup } from './helpers';

const map = loadWorld();

function object(sim: Simulation, defKey: string, at?: { x: number; y: number }): ObjectEntity {
  const found = entities(sim).find((e): e is ObjectEntity => e.kind !== 'player' && e.kind !== 'monster' && e.kind !== 'item' && e.defKey === defKey && (!at || (e.x === at.x && e.y === at.y)));
  if (!found) throw new Error(`no ${defKey}`);
  return found;
}

/** A player standing beside an NPC. */
function besideNpc(sim: Simulation, key: string, setup: Omit<Setup, 'at'> = {}): PlayerEntity {
  const who = object(sim, key);
  for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    if (sim.grid.isWalkable(who.x + dx, who.y + dy)) return addPlayer(sim, { ...setup, at: { x: who.x + dx, y: who.y + dy } });
  }
  throw new Error(`no room beside ${key}`);
}

/** Talks to someone and picks the options whose labels start with each of `choices`, in turn; returns every page seen. */
function talk(sim: Simulation, player: PlayerEntity, key: string, choices: string[]): string[] {
  sim.queueIntent(player.id, { type: 'interact', targetId: object(sim, key).id, action: 'talk' });
  run(sim, 30, () => player.ui?.kind === 'dialogue');
  const seen: string[] = [];
  const left = [...choices];
  for (let i = 0; i < 30 && player.ui?.kind === 'dialogue'; i++) {
    const page = player.ui.pages[player.ui.index];
    seen.push(page.text);
    let option = 0;
    if (page.options) {
      const want = left.shift();
      option = want ? page.options.findIndex((o) => o.label.startsWith(want)) : page.options.length - 1;
      if (option < 0) throw new Error(`no option "${want}" in ${page.options.map((o) => o.label).join(' | ')}`);
    }
    sim.queueIntent(player.id, { type: 'dialogueChoice', option });
    run(sim, 1);
  }
  return seen;
}

function watch(sim: Simulation, id: number, ticks: number, until?: () => boolean): ServerMessage[] {
  const log: ServerMessage[] = [];
  for (let i = 0; i < ticks; i++) {
    sim.step();
    log.push(...sim.drain(id));
    if (until?.()) break;
  }
  return log;
}
const texts = (log: ServerMessage[]) => log.flatMap((m) => (m.type === 'gameMessage' ? [m.text] : []));

const FIGHTER = { attack: 60, strength: 60, defence: 60, hitpoints: 70 };

describe('Bounty', () => {
  it('Hrolf hands out a bounty that suits a newcomer', () => {
    const sim = new Simulation({ map, seed: 1 });
    const p = besideNpc(sim, 'hrolf');
    const pages = talk(sim, p, 'hrolf', ['I need a bounty.']);
    expect(p.bounty.task).toBeDefined();
    expect(['crimson_swift', 'goblin', 'cow']).toContain(p.bounty.task!.monster);
    expect(p.bounty.task!.left).toBe(p.bounty.task!.total);
    expect(pages.some((t) => t.startsWith('Your bounty is'))).toBe(true);
  });

  it('kills on task give Bounty XP and count down; the last one earns points', () => {
    const sim = new Simulation({ map, seed: 2 });
    const goblin = monsters(sim, 'goblin')[0];
    const p = addPlayer(sim, { at: besides(sim, goblin), levels: FIGHTER });
    p.bounty = { task: { monster: 'goblin', left: 1, total: 12 }, points: 5, done: 8 };
    sim.drain(p.id);
    sim.queueIntent(p.id, { type: 'attack', targetId: goblin.id });
    const log = watch(sim, p.id, 100, () => goblin.respawnAt !== undefined);
    expect(goblin.respawnAt).toBeDefined();
    expect(p.skills.bounty).toBe(5 * 2);
    expect(p.bounty.task).toBeUndefined();
    expect(p.bounty).toEqual({ points: 15, done: 9 });
    expect(texts(log).some((t) => t.startsWith("You've finished your bounty and earned 10 points"))).toBe(true);
  });

  it('every tenth bounty is worth more, and kills off task give nothing', () => {
    const sim = new Simulation({ map, seed: 3 });
    const [a, b] = monsters(sim, 'goblin');
    const p = addPlayer(sim, { at: besides(sim, a), levels: FIGHTER });
    p.bounty = { task: { monster: 'cow', left: 3, total: 3 }, points: 0, done: 9 };
    sim.queueIntent(p.id, { type: 'attack', targetId: a.id });
    run(sim, 100, () => a.respawnAt !== undefined);
    expect(p.skills.bounty).toBe(0);
    expect(p.bounty.task!.left).toBe(3);
    p.bounty.task = { monster: 'goblin', left: 1, total: 3 };
    p.x = besides(sim, b).x;
    p.y = besides(sim, b).y;
    sim.queueIntent(p.id, { type: 'attack', targetId: b.id });
    run(sim, 100, () => b.respawnAt !== undefined);
    expect(p.bounty).toEqual({ points: 50, done: 10 });
  });

  it("Bounty creatures can't be fought below their level, and leave such players alone", () => {
    const sim = new Simulation({ map, seed: 4 });
    const bat = monsters(sim, 'gloom_bat')[0];
    const p = addPlayer(sim, { at: besides(sim, bat), levels: FIGHTER });
    sim.drain(p.id);
    sim.queueIntent(p.id, { type: 'attack', targetId: bat.id });
    const log = watch(sim, p.id, 10);
    expect(texts(log)).toContain('You need a Bounty level of 12 to know how to fight a gloom bat.');
    expect(p.action).toBeNull();
    expect(bat.target).toBeNull();
  });

  it('a brine slug needs salt to finish it off', () => {
    const sim = new Simulation({ map, seed: 5 });
    const slug = monsters(sim, 'brine_slug')[0];
    const p = addPlayer(sim, { at: besides(sim, slug), levels: { ...FIGHTER, bounty: 5 } });
    sim.drain(p.id);
    sim.queueIntent(p.id, { type: 'attack', targetId: slug.id });
    let log = watch(sim, p.id, 60);
    expect(slug.respawnAt).toBeUndefined();
    expect(slug.hp).toBe(1);
    expect(texts(log)).toContain("The brine slug is nearly done for, but blows won't finish it. A pinch of salt would.");
    p.inventory[5] = { itemId: 'salt_sack', qty: 3 };
    sim.queueIntent(p.id, { type: 'attack', targetId: slug.id });
    log = watch(sim, p.id, 30, () => slug.respawnAt !== undefined);
    expect(slug.respawnAt).toBeDefined();
    expect(countItem(p.inventory, 'salt_sack')).toBe(2);
    expect(texts(log)).toContain('You pour salt over the brine slug. It fizzes and shrivels away.');
  });

  it('a rockmaw needs a rock hammer, which is kept', () => {
    const sim = new Simulation({ map, seed: 6 });
    const rock = monsters(sim, 'rockmaw')[0];
    const p = addPlayer(sim, { at: besides(sim, rock), levels: { ...FIGHTER, bounty: 20 }, items: [['rock_hammer', 1]] });
    sim.queueIntent(p.id, { type: 'attack', targetId: rock.id });
    run(sim, 200, () => rock.respawnAt !== undefined);
    expect(rock.respawnAt).toBeDefined();
    expect(countItem(p.inventory, 'rock_hammer')).toBe(1);
  });

  it('a gloom bat hits hard and always, unless a scent mask is worn', () => {
    const exposedHits = (equipment: Setup['equipment']) => {
      const sim = new Simulation({ map, seed: 7 });
      const bat = monsters(sim, 'gloom_bat')[0];
      const p = addPlayer(sim, { at: besides(sim, bat), levels: { defence: 99, hitpoints: 99, bounty: 12 }, equipment });
      sim.drain(p.id);
      bat.target = p.id;
      const log = watch(sim, p.id, 60);
      const hits = log.flatMap((m) => (m.type === 'hit' && m.targetId === p.id ? [m.damage] : []));
      return { hits, warned: texts(log).includes("The gloom bat's stench makes your head swim. A scent mask would keep it out.") };
    };
    const bare = exposedHits({});
    expect(bare.warned).toBe(true);
    expect(bare.hits.every((d) => d > 0)).toBe(true);
    expect(Math.max(...bare.hits)).toBeGreaterThan(4);
    const masked = exposedHits({ helmet: 'scent_mask' });
    expect(masked.warned).toBe(false);
    expect(Math.max(...masked.hits)).toBeLessThanOrEqual(4);
  });

  it('skipping costs points and never hands back the same creature; points buy the helm', () => {
    const sim = new Simulation({ map, seed: 8 });
    const p = besideNpc(sim, 'hrolf', { levels: { attack: 30, strength: 30, defence: 30, hitpoints: 30, bounty: 30 } });
    p.bounty = { task: { monster: 'skeleton', left: 4, total: 20 }, points: 150, done: 3 };
    talk(sim, p, 'hrolf', ['Can I have a different bounty?']);
    expect(p.bounty.points).toBe(120);
    expect(p.bounty.task?.monster).not.toBe('skeleton');
    talk(sim, p, 'hrolf', ['What can I spend', 'Bounty helm']);
    expect(p.bounty.points).toBe(0);
    expect(countItem(p.inventory, 'bounty_helm')).toBe(1);
    const pages = talk(sim, p, 'hrolf', ['Can I have a different bounty?']);
    expect(pages).toContain("That costs 30 points, and you've 0. Get hunting.");
  });

  it('the contract stone says how the bounty is going', () => {
    const sim = new Simulation({ map, seed: 9 });
    const p = addPlayer(sim, { at: map.spawn, items: [['contract_stone', 1]] });
    p.bounty = { task: { monster: 'scorpion', left: 7, total: 20 }, points: 40, done: 4 };
    sim.drain(p.id);
    sim.queueIntent(p.id, { type: 'useItem', slot: 0 });
    expect(texts(watch(sim, p.id, 1))).toContain('Your bounty: 7 scorpions still to go, out of 20. You have 40 bounty points.');
  });
});

/** Standing inside the homestead, by a tile, owning the plot. */
function atHome(sim: Simulation, at: { x: number; y: number }, setup: Omit<Setup, 'at'> = {}): PlayerEntity {
  const p = addPlayer(sim, { ...setup, at });
  p.homestead = { owned: true, rooms: [], built: {} };
  return p;
}

const spot = (sim: Simulation, x: number, y: number) => object(sim, 'build_spot', { x, y });

describe('Homesteading', () => {
  it("the gate won't open until the plot is bought from Corwin, then lets its owner through", () => {
    const sim = new Simulation({ map, seed: 10 });
    const gate = object(sim, 'homestead_gate');
    const p = addPlayer(sim, { at: { x: gate.x - 3, y: gate.y }, items: [['coins', 6000]] });
    sim.drain(p.id);
    sim.queueIntent(p.id, { type: 'interact', targetId: gate.id, action: 'enter' });
    const log = watch(sim, p.id, 10);
    expect(p).toMatchObject({ x: gate.x - 1, y: gate.y });
    expect(texts(log)).toContain('The gate is locked. The plot is for sale: Corwin, the estate agent in Falcrest, has the key.');

    const buyer = besideNpc(sim, 'corwin', { items: [['coins', 6000]] });
    talk(sim, buyer, 'corwin', ['I want to buy some land.', 'Buy it']);
    expect(buyer.homestead.owned).toBe(true);
    expect(countItem(buyer.inventory, 'coins')).toBe(1000);

    p.homestead.owned = true;
    sim.queueIntent(p.id, { type: 'interact', targetId: gate.id, action: 'enter' });
    run(sim, 3);
    expect(p).toMatchObject({ x: gate.x + 1, y: gate.y });
    sim.queueIntent(p.id, { type: 'interact', targetId: gate.id, action: 'enter' });
    run(sim, 3);
    expect(p).toMatchObject({ x: gate.x - 1, y: gate.y });
  });

  it('Jory cuts logs into planks, as many as the coins cover', () => {
    const sim = new Simulation({ map, seed: 11 });
    const p = besideNpc(sim, 'jory', { items: [['logs', 5], ['oak_logs', 2], ['coins', 150]] });
    talk(sim, p, 'jory', ['Planks']);
    expect(countItem(p.inventory, 'plank')).toBe(3);
    expect(countItem(p.inventory, 'logs')).toBe(2);
    expect(countItem(p.inventory, 'coins')).toBe(30);
    expect(countItem(p.inventory, 'oak_plank')).toBe(0);
  });

  it('a room is fitted out first, then furniture is built with a hammer, a saw and materials', () => {
    const sim = new Simulation({ map, seed: 12 });
    const chair = spot(sim, 86, 183);
    const p = atHome(sim, { x: 87, y: 183 }, { items: [['coins', 1500], ['hammer', 1], ['saw', 1], ['plank', 4], ['steel_nails', 10]] });
    sim.drain(p.id);
    sim.queueIntent(p.id, { type: 'interact', targetId: chair.id, action: 'build' });
    run(sim, 2);
    expect(p.ui).toEqual({ kind: 'build', at: chair.id });
    sim.queueIntent(p.id, { type: 'build', tier: 1 });
    let log = watch(sim, p.id, 2);
    expect(texts(log)).toContain('You need to fit out the parlour before you can build in it.');
    sim.queueIntent(p.id, { type: 'buildRoom' });
    log = watch(sim, p.id, 1);
    const view = log.filter((m) => m.type === 'self').pop();
    expect(view?.type === 'self' && view.state.ui).toMatchObject({ kind: 'build', title: 'Chair space', built: 0, room: { name: 'Parlour', built: true } });
    expect(countItem(p.inventory, 'coins')).toBe(500);
    sim.queueIntent(p.id, { type: 'build', tier: 2 });
    expect(texts(watch(sim, p.id, 1))).toContain('You need a Homesteading level of 8 to build a wooden chair.');
    sim.queueIntent(p.id, { type: 'build', tier: 1 });
    log = watch(sim, p.id, 5);
    expect(texts(log)).toContain('You build a crude chair.');
    expect(p.homestead).toEqual({ owned: true, rooms: ['parlour'], built: { '86,183': 1 } });
    expect(p.skills.homesteading).toBe(60);
    expect(countItem(p.inventory, 'plank')).toBe(2);
    expect(countItem(p.inventory, 'steel_nails')).toBe(8);
    expect(log.some((m) => m.type === 'tick' && m.updated.some((e) => e.id === chair.id && e.name === 'Crude chair' && e.spot?.tier === 1))).toBe(true);
    // Taking it down leaves the space.
    sim.queueIntent(p.id, { type: 'interact', targetId: chair.id, action: 'remove' });
    run(sim, 2);
    expect(p.homestead.built).toEqual({});
  });

  it('others see an empty plot: furniture is per player', () => {
    const sim = new Simulation({ map, seed: 13 });
    const owner = atHome(sim, { x: 87, y: 182 });
    owner.homestead.rooms.push('parlour');
    owner.homestead.built['86,183'] = 3;
    const visitor = addPlayer(sim, { at: { x: 88, y: 182 } });
    run(sim, 1);
    const id = spot(sim, 86, 183).id;
    const seen = (pid: number) =>
      sim
        .drain(pid)
        .flatMap((m) => (m.type === 'snapshot' ? m.entities : m.type === 'tick' ? [...m.added, ...m.updated] : []))
        .filter((e) => e.id === id)
        .pop();
    expect(seen(owner.id)).toMatchObject({ name: 'Oak armchair', spot: { kind: 'chair', tier: 3, room: true } });
    expect(seen(visitor.id)).toMatchObject({ name: 'Chair space', spot: { kind: 'chair', tier: 0, room: false } });
  });

  it('furniture earns its keep: a stove to cook on, a rack of tools, a bed, a pool and a portal', () => {
    const sim = new Simulation({ map, seed: 14 });
    const p = atHome(sim, { x: 82, y: 176 }, { levels: { hitpoints: 50, prayer: 40 }, hp: 10, items: [['knife', 1]] });
    p.homestead.rooms.push('kitchen', 'workshop', 'bedroom', 'study');
    Object.assign(p.homestead.built, { '82,175': 1, '80,181': 2, '94,182': 2, '97,179': 3, '88,175': 3 });
    p.energy = 20;
    p.prayer = 0;

    sim.queueIntent(p.id, { type: 'interact', targetId: spot(sim, 82, 175).id, action: 'use' });
    run(sim, 2);
    expect(p.ui).toMatchObject({ kind: 'craft', station: 'range' });

    p.x = 81;
    p.y = 181;
    sim.queueIntent(p.id, { type: 'interact', targetId: spot(sim, 80, 181).id, action: 'use' });
    run(sim, 2);
    for (const tool of ['hammer', 'saw', 'tinderbox', 'spade', 'rake']) expect(countItem(p.inventory, tool)).toBe(1);
    expect(countItem(p.inventory, 'knife')).toBe(1);

    p.x = 93;
    p.y = 182;
    sim.queueIntent(p.id, { type: 'interact', targetId: spot(sim, 94, 182).id, action: 'use' });
    run(sim, 2);
    expect(p.hp).toBe(10 + 35);
    expect(p.energy).toBeGreaterThanOrEqual(100);

    p.energy = 20;
    p.x = 96;
    p.y = 179;
    sim.queueIntent(p.id, { type: 'interact', targetId: spot(sim, 97, 179).id, action: 'use' });
    run(sim, 2);
    expect(p.hp).toBe(50);
    expect(p.prayer).toBe(40);

    p.x = 88;
    p.y = 176;
    sim.queueIntent(p.id, { type: 'interact', targetId: spot(sim, 88, 175).id, action: 'use' });
    run(sim, 2);
    expect(p.ui?.kind === 'dialogue' && p.ui.pages[0].options!.map((o) => o.label)).toEqual(['Kelmoor', 'Falcrest', 'Brakk Village', 'Brightwater', 'Qadir', 'Nowhere for now.']);
    sim.queueIntent(p.id, { type: 'dialogueChoice', option: 1 });
    run(sim, 6);
    expect(Math.abs(p.x - 63) + Math.abs(p.y - 141)).toBeLessThanOrEqual(2);
  });

  it('a homestead altar, with lamps beside it, multiplies offerings', () => {
    const sim = new Simulation({ map, seed: 15 });
    const p = atHome(sim, { x: 92, y: 176 }, { items: [['bones', 1]] });
    p.homestead.rooms.push('chapel');
    Object.assign(p.homestead.built, { '92,175': 1, '91,175': 2, '93,175': 1 });
    sim.queueIntent(p.id, { type: 'interact', targetId: spot(sim, 92, 175).id, action: 'offer' });
    run(sim, 10);
    expect(countItem(p.inventory, 'bones')).toBe(0);
    expect(p.skills.prayer).toBeCloseTo(4.5 * (2.5 + 0.3), 1);
  });

  it('bounties and the homestead survive a save', () => {
    const sim = new Simulation({ map, seed: 16 });
    const p = atHome(sim, { x: 87, y: 182 });
    p.homestead.rooms.push('parlour', 'nowhere');
    p.homestead.built = { '86,183': 2, '1,1': 1 };
    p.bounty = { task: { monster: 'goblin', left: 3, total: 10 }, points: 20, done: 2 };
    const save = parseSave(JSON.parse(JSON.stringify(sim.saveFor(p.id, '2026-10-27T00:00:00Z'))))!;
    expect(save.homestead).toEqual({ owned: true, rooms: ['parlour'], built: { '86,183': 2 } });
    expect(save.bounty).toEqual({ task: { monster: 'goblin', left: 3, total: 10 }, points: 20, done: 2 });
  });
});
