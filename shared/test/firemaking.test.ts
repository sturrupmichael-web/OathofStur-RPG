import { describe, expect, it } from 'vitest';
import type { ServerMessage } from '../src/protocol/messages';
import type { GroundItemEntity, ObjectEntity } from '../src/sim/entities';
import { countItem } from '../src/sim/items';
import { parseSave } from '../src/sim/save';
import { FIRE_TICKS, Simulation } from '../src/sim/Simulation';
import { xpForLevel } from '../src/sim/skills';
import { addPlayer, entities, kx, ky, loadWorld, run } from './helpers';

const map = loadWorld();
/** Open grass in the cow field. */
const FIELD = { x: 170, y: 205 };

const texts = (log: ServerMessage[]) => log.flatMap((m) => (m.type === 'gameMessage' ? [m.text] : []));
const fires = (sim: Simulation) => entities(sim).filter((e): e is ObjectEntity => e.kind === 'station' && e.defKey === 'fire');

function watch(sim: Simulation, id: number, ticks: number, until?: () => boolean): ServerMessage[] {
  const log: ServerMessage[] = [];
  for (let i = 0; i < ticks; i++) {
    sim.step();
    log.push(...sim.drain(id));
    if (until?.()) break;
  }
  return log;
}

describe('Firemaking', () => {
  it('lights logs where you stand, then steps off the fire', () => {
    const sim = new Simulation({ map, seed: 1 });
    const p = addPlayer(sim, { at: FIELD, items: [['tinderbox', 1], ['logs', 2]] });
    sim.queueIntent(p.id, { type: 'light', slot: 1 });
    const log = watch(sim, p.id, 40, () => fires(sim).length > 0 && p.path.length === 0);
    const [fire] = fires(sim);
    expect(fire).toMatchObject({ x: FIELD.x, y: FIELD.y });
    expect(sim.grid.isWalkable(FIELD.x, FIELD.y)).toBe(false);
    expect([p.x, p.y]).not.toEqual([FIELD.x, FIELD.y]);
    expect(countItem(p.inventory, 'logs')).toBe(1);
    expect(p.skills.firemaking).toBe(40);
    expect(texts(log)).toContain('The fire catches and the logs begin to burn.');
  });

  it('needs a tinderbox, and the level for better logs', () => {
    const sim = new Simulation({ map, seed: 1 });
    const p = addPlayer(sim, { at: FIELD, items: [['logs', 1], ['oak_logs', 1]] });
    sim.drain(p.id);
    sim.queueIntent(p.id, { type: 'light', slot: 0 });
    let log = watch(sim, p.id, 3);
    expect(texts(log)).toContain('You need a tinderbox to light a fire.');
    p.inventory[2] = { itemId: 'tinderbox', qty: 1 };
    sim.queueIntent(p.id, { type: 'light', slot: 1 });
    log = watch(sim, p.id, 3);
    expect(texts(log)).toContain('You need a Firemaking level of 15 to light oak logs.');
    expect(fires(sim)).toHaveLength(0);
  });

  it("won't light a fire in a bank", () => {
    const sim = new Simulation({ map, seed: 1 });
    const bank = map.areas.find((a) => a.name === 'West Bank')!;
    let at = { x: bank.x + 1, y: bank.y + 1 };
    for (let y = bank.y; y < bank.y + bank.h; y++) for (let x = bank.x; x < bank.x + bank.w; x++) if (sim.grid.isWalkable(x, y)) at = { x, y };
    const p = addPlayer(sim, { at, items: [['tinderbox', 1], ['logs', 1]] });
    sim.drain(p.id);
    sim.queueIntent(p.id, { type: 'light', slot: 1 });
    expect(texts(watch(sim, p.id, 5))).toContain("You can't light a fire here.");
  });

  it('cooks on the fire, which burns down to ashes', () => {
    const sim = new Simulation({ map, seed: 2 });
    const p = addPlayer(sim, { at: FIELD, levels: { cooking: 30 }, items: [['tinderbox', 1], ['logs', 1], ['raw_minnows', 3]] });
    sim.queueIntent(p.id, { type: 'light', slot: 1 });
    run(sim, 40, () => fires(sim).length > 0 && p.path.length === 0);
    const [fire] = fires(sim);
    sim.queueIntent(p.id, { type: 'interact', targetId: fire.id, action: 'use' });
    run(sim, 3);
    expect(p.ui).toMatchObject({ kind: 'craft', station: 'range' });
    sim.queueIntent(p.id, { type: 'craft', recipeId: 'cook_minnows', qty: 3 });
    run(sim, 20);
    expect(countItem(p.inventory, 'minnows') + countItem(p.inventory, 'burnt_fish')).toBe(3);

    run(sim, FIRE_TICKS[1]);
    expect(fires(sim)).toHaveLength(0);
    expect(sim.grid.isWalkable(fire.x, fire.y)).toBe(true);
    const ashes = entities(sim).find((e): e is GroundItemEntity => e.kind === 'item' && e.itemId === 'ashes');
    expect(ashes).toMatchObject({ x: fire.x, y: fire.y });
  });

  it('lets you cook on a goblin campfire', () => {
    const sim = new Simulation({ map, seed: 2 });
    const camp = entities(sim).find((e): e is ObjectEntity => e.kind === 'station' && e.defKey === 'campfire')!;
    expect(camp).toBeDefined();
    const at = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: camp.x + dx, y: camp.y + dy })).find((q) => sim.grid.isWalkable(q.x, q.y))!;
    const p = addPlayer(sim, { at, levels: { attack: 40, defence: 40 }, items: [['raw_minnows', 1]] });
    sim.queueIntent(p.id, { type: 'interact', targetId: camp.id, action: 'use' });
    run(sim, 2);
    expect(p.ui).toMatchObject({ kind: 'craft', station: 'range' });
  });

  it('gives old saves Firemaking at level 1', () => {
    const save = parseSave({ version: 3, name: 'Old', position: { x: kx(60), y: ky(48) }, skills: { attack: xpForLevel(5) }, inventory: [], equipment: {}, bank: [], createdAt: '', updatedAt: '' })!;
    expect(save.skills.firemaking).toBe(0);
  });
});
