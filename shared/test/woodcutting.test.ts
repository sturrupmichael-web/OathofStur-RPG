import { describe, expect, it } from 'vitest';
import type { ServerMessage } from '../src/protocol/messages';
import type { ObjectEntity, PlayerEntity } from '../src/sim/entities';
import { ITEMS, INVENTORY_SIZE, addItem, emptyInventory } from '../src/sim/items';
import { parseSave } from '../src/sim/save';
import { Simulation } from '../src/sim/Simulation';
import { levelForXp, xpForLevel } from '../src/sim/skills';
import { kx, ky, loadWorld } from './helpers';

const map = loadWorld();

function setup(seed = 1) {
  const sim = new Simulation({ map, seed });
  const id = sim.addPlayer('Tester');
  const player = sim.getEntity(id) as PlayerEntity;
  const messages: ServerMessage[] = [];
  const run = (ticks: number) => {
    for (let i = 0; i < ticks; i++) {
      sim.step();
      messages.push(...sim.drain(id));
    }
  };
  messages.push(...sim.drain(id));
  return { sim, id, player, messages, run };
}

/** x and y are Kelmoor coordinates, as the town map numbered them. */
function find(sim: Simulation, defKey: string, tx: number, ty: number): ObjectEntity {
  const x = kx(tx);
  const y = ky(ty);
  for (let id = 1; id < 60000; id++) {
    const e = sim.getEntity(id);
    if (e && e.kind !== 'player' && e.kind !== 'item' && e.defKey === defKey && e.x === x && e.y === y) return e;
  }
  throw new Error(`no ${defKey} at ${x},${y}`);
}

const texts = (messages: ServerMessage[]) => messages.flatMap((m) => (m.type === 'gameMessage' ? [m.text] : []));

describe('Woodcutting', () => {
  it('starts a new character with a bronze axe', () => {
    const { player } = setup();
    expect(player.inventory[0]).toEqual({ itemId: 'bronze_axe', qty: 1 });
    expect(player.inventory).toHaveLength(INVENTORY_SIZE);
  });

  it('walks to a tree, chops logs and gains XP', () => {
    const { sim, id, player, messages, run } = setup();
    const tree = find(sim, 'tree', 26, 60);
    sim.queueIntent(id, { type: 'interact', targetId: tree.id, action: 'gather' });
    run(150);
    expect(Math.max(Math.abs(player.x - kx(26)), Math.abs(player.y - ky(60)))).toBe(1);
    const logs = player.inventory.filter((s) => s?.itemId === 'logs').length;
    expect(logs).toBeGreaterThan(0);
    expect(player.skills.woodcutting).toBe(logs * 25);
    expect(texts(messages)).toContain('You swing your axe at the tree.');
    expect(messages.some((m) => m.type === 'xpDrop' && m.skill === 'woodcutting' && m.amount === 25)).toBe(true);
  });

  it('turns a tree into a stump that grows back', () => {
    const { sim, id, player, run } = setup(3);
    const tree = find(sim, 'tree', 26, 60);
    player.x = kx(25);
    player.y = ky(60);
    sim.queueIntent(id, { type: 'interact', targetId: tree.id, action: 'gather' });
    let ticks = 0;
    while (tree.depletedUntil === undefined && ticks < 2000) {
      run(1);
      ticks++;
      if (!player.action) sim.queueIntent(id, { type: 'interact', targetId: tree.id, action: 'gather' });
    }
    expect(tree.depletedUntil).toBeDefined();
    expect(player.action).toBeNull();
    run(10);
    expect(tree.depletedUntil).toBeUndefined();
  });

  it('chops a big tree from any side of its 2 x 2 footprint', () => {
    const { sim, id, player, messages, run } = setup(2);
    const tree = find(sim, 'tree', 25, 62);
    expect(tree.size).toBe(2);
    sim.queueIntent(id, { type: 'interact', targetId: tree.id, action: 'gather' });
    run(150);
    // Next to the footprint, never inside it.
    const dx = Math.max(tree.x - player.x, player.x - (tree.x + 1), 0);
    const dy = Math.max(tree.y - player.y, player.y - (tree.y + 1), 0);
    expect(Math.max(dx, dy)).toBe(1);
    expect(player.inventory.some((s) => s?.itemId === 'logs')).toBe(true);
    expect(texts(messages)).toContain('You swing your axe at the tree.');
  });

  it('needs Woodcutting 15 for dead trees', () => {
    const { sim, id, player, messages, run } = setup();
    const dead = find(sim, 'dead_tree', 21, 0);
    player.x = kx(21);
    player.y = ky(1);
    sim.queueIntent(id, { type: 'interact', targetId: dead.id, action: 'gather' });
    run(2);
    expect(texts(messages)).toContain('You need a Woodcutting level of 15 to chop this tree.');
    expect(player.action).toBeNull();
  });

  it('needs an axe and inventory space', () => {
    const { sim, id, player, messages, run } = setup();
    const tree = find(sim, 'tree', 26, 60);
    player.x = kx(25);
    player.y = ky(60);
    player.inventory = emptyInventory();
    sim.queueIntent(id, { type: 'interact', targetId: tree.id, action: 'gather' });
    run(2);
    expect(texts(messages)).toContain('You need an axe to chop down this tree.');

    addItem(player.inventory, 'bronze_axe');
    addItem(player.inventory, 'logs', INVENTORY_SIZE - 1);
    sim.queueIntent(id, { type: 'interact', targetId: tree.id, action: 'gather' });
    run(2);
    expect(texts(messages)).toContain('Your inventory is too full to hold any more logs.');
  });

  it('sends a level-up when XP crosses a level', () => {
    const { sim, id, player, messages, run } = setup(5);
    player.skills.woodcutting = xpForLevel(2) - 1;
    const tree = find(sim, 'tree', 26, 60);
    player.x = kx(25);
    player.y = ky(60);
    sim.queueIntent(id, { type: 'interact', targetId: tree.id, action: 'gather' });
    while (player.skills.woodcutting < xpForLevel(2)) {
      run(1);
      if (!player.action) sim.queueIntent(id, { type: 'interact', targetId: tree.id, action: 'gather' });
    }
    expect(messages).toContainEqual({ type: 'levelUp', skill: 'woodcutting', level: levelForXp(player.skills.woodcutting) });
  });

  it('walking away stops chopping', () => {
    const { sim, id, player, run } = setup();
    const tree = find(sim, 'tree', 26, 60);
    player.x = kx(25);
    player.y = ky(60);
    sim.queueIntent(id, { type: 'interact', targetId: tree.id, action: 'gather' });
    run(2);
    expect(player.action).not.toBeNull();
    sim.queueIntent(id, { type: 'walk', x: kx(60), y: ky(49) });
    run(1);
    expect(player.action).toBeNull();
  });
});

describe('Inventory', () => {
  it('drops an item on the ground and picks it back up', () => {
    const { sim, id, player, run } = setup();
    sim.queueIntent(id, { type: 'invDrop', slot: 0 });
    run(1);
    expect(player.inventory[0]).toBeNull();
    let groundId = -1;
    for (let i = 1; i < 60000; i++) {
      const e = sim.getEntity(i);
      if (e?.kind === 'item') groundId = i;
    }
    expect(groundId).toBeGreaterThan(0);
    sim.queueIntent(id, { type: 'interact', targetId: groundId, action: 'take' });
    run(1);
    expect(player.inventory.some((s) => s?.itemId === 'bronze_axe')).toBe(true);
    expect(sim.getEntity(groundId)).toBeUndefined();
  });

  it('swaps slots and examines items', () => {
    const { sim, id, player, messages, run } = setup();
    sim.queueIntent(id, { type: 'invMove', from: 0, to: 5 });
    sim.queueIntent(id, { type: 'examineItem', slot: 5 });
    run(1);
    expect(player.inventory[5]?.itemId).toBe('bronze_axe');
    expect(texts(messages)).toContain(ITEMS.bronze_axe.examine);
  });

  it('ignores bad slots', () => {
    const { sim, id, player, run } = setup();
    sim.queueIntent(id, { type: 'invMove', from: 0, to: 99 });
    sim.queueIntent(id, { type: 'invDrop', slot: -1 });
    run(1);
    expect(player.inventory[0]?.itemId).toBe('bronze_axe');
  });
});

describe('Saves', () => {
  it('round-trips a character through a save', () => {
    const { sim, id, player } = setup();
    player.skills.woodcutting = 1234;
    addItem(player.inventory, 'logs', 3);
    player.x = kx(61);
    player.y = ky(50);
    const save = parseSave(JSON.parse(JSON.stringify(sim.saveFor(id, '2026-10-26T00:00:00Z'))))!;
    expect(save).not.toBeNull();

    const sim2 = new Simulation({ map, seed: 9 });
    const p2 = sim2.getEntity(sim2.addPlayer('Other', save)) as PlayerEntity;
    expect(p2.name).toBe('Tester');
    expect([p2.x, p2.y]).toEqual([kx(61), ky(50)]);
    expect(p2.skills.woodcutting).toBe(1234);
    expect(p2.inventory.filter((s) => s?.itemId === 'logs')).toHaveLength(3);
  });

  it('rejects junk and cleans up bad entries', () => {
    expect(parseSave(null)).toBeNull();
    expect(parseSave({ hello: 'world' })).toBeNull();
    expect(parseSave({ version: 99, name: 'x', position: { x: 1, y: 1 }, skills: {}, inventory: [] })).toBeNull();
    const save = parseSave({
      version: 2,
      name: 'Cheater',
      position: { x: kx(60), y: ky(49) },
      skills: { woodcutting: -50, mining: 'lots' },
      inventory: [{ itemId: 'golden_crown', qty: 1 }, { itemId: 'logs', qty: 5 }],
    })!;
    expect(save.skills.woodcutting).toBe(0);
    expect(save.inventory[0]).toBeNull();
    expect(save.inventory[1]).toEqual({ itemId: 'logs', qty: 1 });
  });

  it('moves a Kelmoor-era save into the region', () => {
    const save = parseSave({ version: 1, name: 'Old', position: { x: 60, y: 49 }, skills: { woodcutting: 500 }, inventory: [] })!;
    expect(save.version).toBe(2);
    expect(save.position).toEqual({ x: kx(60), y: ky(49) });
    const sim = new Simulation({ map, seed: 1 });
    const p = sim.getEntity(sim.addPlayer('x', save)) as PlayerEntity;
    expect([p.x, p.y]).toEqual([kx(60), ky(49)]);
  });

  it('puts a player saved on a now-blocked tile back at spawn', () => {
    // A tile inside the city wall: walkable in no world.
    const save = parseSave({ version: 2, name: 'Lost', position: { x: kx(34), y: ky(30) }, skills: {}, inventory: [] })!;
    const sim = new Simulation({ map, seed: 1 });
    const p = sim.getEntity(sim.addPlayer('x', save)) as PlayerEntity;
    expect([p.x, p.y]).toEqual([map.spawn.x, map.spawn.y]);
  });
});
