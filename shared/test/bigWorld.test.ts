import { describe, expect, it } from 'vitest';
import type { ObjectEntity, PlayerEntity } from '../src/sim/entities';
import { FERRY } from '../src/sim/ferry';
import { countItem } from '../src/sim/items';
import { shopForNpc } from '../src/sim/crafting';
import { findPath } from '../src/sim/pathfinding';
import { Simulation } from '../src/sim/Simulation';
import { addPlayer, entities, loadWorld, run, type Setup } from './helpers';

const map = loadWorld();

function object(sim: Simulation, defKey: string): ObjectEntity {
  const found = entities(sim).find((e): e is ObjectEntity => e.kind !== 'player' && e.kind !== 'monster' && e.kind !== 'item' && e.defKey === defKey);
  if (!found) throw new Error(`no ${defKey}`);
  return found;
}

function besideNpc(sim: Simulation, key: string, setup: Omit<Setup, 'at'> = {}): PlayerEntity {
  const who = object(sim, key);
  for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) {
    if (sim.grid.isWalkable(who.x + dx, who.y + dy)) return addPlayer(sim, { ...setup, at: { x: who.x + dx, y: who.y + dy } });
  }
  throw new Error(`no room beside ${key}`);
}

/** Talks to someone and picks the first option starting with `choice`. */
function talk(sim: Simulation, player: PlayerEntity, key: string, choice: string): void {
  sim.queueIntent(player.id, { type: 'interact', targetId: object(sim, key).id, action: 'talk' });
  run(sim, 30, () => player.ui?.kind === 'dialogue');
  if (player.ui?.kind !== 'dialogue') throw new Error('no dialogue');
  const page = player.ui.pages[player.ui.index];
  const option = page.options!.findIndex((o) => o.label.startsWith(choice));
  sim.queueIntent(player.id, { type: 'dialogueChoice', option });
  run(sim, 1);
}

describe('The grown Vell Reaches', () => {
  it('is 512 by 384, with the old land where it was', () => {
    expect([map.width, map.height]).toEqual([512, 384]);
    expect(map.areas.map((a) => a.name)).toEqual(expect.arrayContaining(['Corvane', 'Port Avel', 'Saltmere Fen', 'Frostpeak Mine', 'The Southmarch']));
    expect(map.areas.find((a) => a.name === 'Kelmoor')).toMatchObject({ x: 164, y: 92 });
  });

  it('has a bank, shops and a furnace in each new town', () => {
    const sim = new Simulation({ map, seed: 5 });
    for (const key of ['tilda', 'harl', 'wenna', 'pike', 'bettany']) expect(shopForNpc(key), key).toBeTruthy();
    const inTown = (name: string, kind: string) => {
      const a = map.areas.find((r) => r.name === name)!;
      return entities(sim).some((e) => e.kind !== 'player' && 'defKey' in e && e.defKey === kind && e.x >= a.x && e.y >= a.y && e.x < a.x + a.w && e.y < a.y + a.h);
    };
    for (const town of ['Corvane', 'Port Avel']) expect(inTown(town, 'bank_booth'), town).toBe(true);
    expect(inTown('Corvane', 'furnace')).toBe(true);
    expect(inTown('Corvane', 'anvil')).toBe(true);
  });

  it('can be walked to from Kelmoor: the road east through Qadir reaches Corvane and Port Avel', () => {
    const sim = new Simulation({ map, seed: 6 });
    const from = { x: 357, y: 180 };
    for (const to of [{ x: 446, y: 149 }, { x: 199, y: 329 }, { x: 470, y: 112 }]) expect(findPath(sim.grid, from, [to], to).reachedGoal, `${to.x},${to.y}`).toBe(true);
  });
});

describe('The ferry', () => {
  it('takes the fare and carries you across the Saltwind Sea, and back', () => {
    const sim = new Simulation({ map, seed: 7 });
    const player = besideNpc(sim, 'ferrywoman_nell', { items: [['coins', 50]] });
    talk(sim, player, 'ferrywoman_nell', 'Take me');
    run(sim, FERRY.ticks + 3);
    expect(Math.abs(player.x - FERRY.stops.port_avel.x) + Math.abs(player.y - FERRY.stops.port_avel.y)).toBeLessThanOrEqual(3);
    expect(countItem(player.inventory, 'coins')).toBe(50 - FERRY.fare);

    const back = besideNpc(sim, 'ferryman_hob', { items: [['coins', 50]] });
    talk(sim, back, 'ferryman_hob', 'Take me');
    run(sim, FERRY.ticks + 3);
    expect(Math.abs(back.x - FERRY.stops.saltcombe.x) + Math.abs(back.y - FERRY.stops.saltcombe.y)).toBeLessThanOrEqual(3);
  });

  it("won't sail without the fare", () => {
    const sim = new Simulation({ map, seed: 8 });
    const player = besideNpc(sim, 'ferrywoman_nell', { items: [['coins', 5]] });
    const start = { x: player.x, y: player.y };
    talk(sim, player, 'ferrywoman_nell', 'Take me');
    run(sim, FERRY.ticks + 3);
    expect({ x: player.x, y: player.y }).toEqual(start);
    expect(countItem(player.inventory, 'coins')).toBe(5);
  });
});
