import { describe, expect, it } from 'vitest';
import type { GroundItemEntity, ObjectEntity, PlayerEntity } from '../src/sim/entities';
import { countItem } from '../src/sim/items';
import { QUESTS, doneStage, type QuestId } from '../src/sim/quests';
import { Simulation } from '../src/sim/Simulation';
import { addPlayer, besides, entities, loadWorld, monsters, run, type Setup } from './helpers';

const map = loadWorld();

function npc(sim: Simulation, key: string): ObjectEntity {
  const found = entities(sim).find((e): e is ObjectEntity => e.kind === 'npc' && e.defKey === key);
  if (!found) throw new Error(`no ${key}`);
  return found;
}

/** A player standing beside an NPC. */
function beside(sim: Simulation, key: string, setup: Omit<Setup, 'at'> = {}): PlayerEntity {
  const who = npc(sim, key);
  for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    if (sim.grid.isWalkable(who.x + dx, who.y + dy)) return addPlayer(sim, { ...setup, at: { x: who.x + dx, y: who.y + dy } });
  }
  throw new Error(`no room beside ${key}`);
}

/** Talks to someone and clicks through every page, taking the first option at each question. */
function talk(sim: Simulation, player: PlayerEntity, key: string): string[] {
  sim.queueIntent(player.id, { type: 'interact', targetId: npc(sim, key).id, action: 'talk' });
  run(sim, 30, () => player.ui?.kind === 'dialogue');
  const seen: string[] = [];
  for (let i = 0; i < 20 && player.ui?.kind === 'dialogue'; i++) {
    const ui = player.ui;
    seen.push(ui.pages[ui.index].text);
    sim.queueIntent(player.id, { type: 'dialogueChoice', option: 0 });
    run(sim, 1);
  }
  return seen;
}

const done = (p: PlayerEntity, q: QuestId) => (p.quests[q] ?? 0) >= doneStage(QUESTS[q]);
const give = (p: PlayerEntity, itemId: string, qty = 1) => {
  for (let i = 0; i < qty; i++) {
    const slot = p.inventory.findIndex((s) => !s);
    p.inventory[slot] = { itemId, qty: 1 };
  }
};

describe('Town quests', () => {
  it('has a giver on the map for every quest', () => {
    const sim = new Simulation({ map, seed: 1 });
    for (const q of Object.values(QUESTS)) expect(() => npc(sim, q.giver), q.id).not.toThrow();
  });

  it("A Feast for the Duke: beef and fish for Hilda, then word to the Duke", () => {
    const sim = new Simulation({ map, seed: 1 });
    const p = beside(sim, 'cook_hilda');
    talk(sim, p, 'cook_hilda');
    expect(p.quests.dukes_feast).toBe(1);
    talk(sim, p, 'cook_hilda');
    expect(p.quests.dukes_feast).toBe(1);
    give(p, 'beef', 3);
    talk(sim, p, 'cook_hilda');
    expect(p.quests.dukes_feast).toBe(2);
    give(p, 'minnows', 2);
    give(p, 'perch');
    talk(sim, p, 'cook_hilda');
    expect(p.quests.dukes_feast).toBe(3);
    expect(countItem(p.inventory, 'minnows') + countItem(p.inventory, 'perch')).toBe(0);
    const duke = npc(sim, 'duke_aldwin');
    p.x = duke.x;
    p.y = duke.y + 1;
    if (!sim.grid.isWalkable(p.x, p.y)) [p.x, p.y] = [duke.x + 1, duke.y];
    talk(sim, p, 'duke_aldwin');
    expect(done(p, 'dukes_feast')).toBe(true);
    expect(countItem(p.inventory, 'iron_platelegs')).toBe(1);
    expect(p.skills.cooking).toBe(500);
  });

  it('Hull and Nails: oak logs and iron bars for Aela', () => {
    const sim = new Simulation({ map, seed: 1 });
    const p = beside(sim, 'aela', { items: [['oak_logs', 5], ['iron_bar', 2]] });
    talk(sim, p, 'aela');
    talk(sim, p, 'aela');
    talk(sim, p, 'aela');
    expect(p.quests.hull_and_nails).toBe(3);
    talk(sim, p, 'aela');
    expect(done(p, 'hull_and_nails')).toBe(true);
    expect(countItem(p.inventory, 'steel_axe')).toBe(1);
    expect(countItem(p.inventory, 'oak_logs') + countItem(p.inventory, 'iron_bar')).toBe(0);
  });

  it('Feathers for Ivy: crimson feathers, then a shortbow of your own', () => {
    const sim = new Simulation({ map, seed: 1 });
    const p = beside(sim, 'ivy', { items: [['crimson_feathers', 12]] });
    talk(sim, p, 'ivy');
    talk(sim, p, 'ivy');
    expect(p.quests.feathers_for_ivy).toBe(2);
    expect(countItem(p.inventory, 'crimson_feathers')).toBe(2);
    talk(sim, p, 'ivy');
    expect(done(p, 'feathers_for_ivy')).toBe(false);
    give(p, 'shortbow');
    talk(sim, p, 'ivy');
    expect(done(p, 'feathers_for_ivy')).toBe(true);
    expect(countItem(p.inventory, 'iron_arrow')).toBe(50);
  });

  it("The Emir's Seal: bandits drop it, the Emir takes it back", () => {
    const sim = new Simulation({ map, seed: 5 });
    const p = beside(sim, 'emir_tarek', { levels: { attack: 70, strength: 70, defence: 70, hitpoints: 70 }, equipment: { weapon: 'steel_sword' } });
    talk(sim, p, 'emir_tarek');
    expect(p.quests.emirs_seal).toBe(1);
    // Fight bandits one after another until the seal turns up.
    for (let i = 0; i < 40 && p.quests.emirs_seal === 1; i++) {
      const bandit = monsters(sim, 'desert_bandit').find((m) => m.respawnAt === undefined && m.dyingUntil === undefined)!;
      if (!bandit) {
        run(sim, 20);
        continue;
      }
      const at = besides(sim, bandit);
      [p.x, p.y] = [at.x, at.y];
      p.hp = 70;
      sim.queueIntent(p.id, { type: 'attack', targetId: bandit.id });
      run(sim, 200, () => bandit.respawnAt !== undefined);
    }
    expect(p.quests.emirs_seal).toBe(2);
    const seal = entities(sim).find((e): e is GroundItemEntity => e.kind === 'item' && e.itemId === 'sunspire_seal')!;
    [p.x, p.y] = [seal.x, seal.y];
    sim.queueIntent(p.id, { type: 'interact', targetId: seal.id, action: 'take' });
    run(sim, 3);
    expect(countItem(p.inventory, 'sunspire_seal')).toBe(1);
    const emir = npc(sim, 'emir_tarek');
    const spot = [[0, 1], [1, 0], [-1, 0], [0, -1]].map(([dx, dy]) => ({ x: emir.x + dx, y: emir.y + dy })).find((q) => sim.grid.isWalkable(q.x, q.y))!;
    [p.x, p.y] = [spot.x, spot.y];
    p.path = [];
    talk(sim, p, 'emir_tarek');
    expect(done(p, 'emirs_seal')).toBe(true);
    expect(countItem(p.inventory, 'steel_shield')).toBe(1);
  });

  it("Nessa's Cauldron: ashes and a hide, then lizard scales", () => {
    const sim = new Simulation({ map, seed: 1 });
    const p = beside(sim, 'old_nessa', { items: [['ashes', 4], ['cowhide', 1], ['lizard_scales', 2]] });
    talk(sim, p, 'old_nessa');
    talk(sim, p, 'old_nessa');
    expect(p.quests.nessas_cauldron).toBe(1);
    expect(countItem(p.inventory, 'cowhide')).toBe(1);
    give(p, 'ashes');
    talk(sim, p, 'old_nessa');
    talk(sim, p, 'old_nessa');
    expect(done(p, 'nessas_cauldron')).toBe(true);
    expect(p.skills.firemaking).toBe(400);
  });

  it('counts a quest point for each quest done', () => {
    const sim = new Simulation({ map, seed: 1 });
    const p = beside(sim, 'aela', { quests: { first_oath: 6, hull_and_nails: 4 } });
    const self = sim.drain(p.id).find((m) => m.type === 'self');
    expect(self?.type === 'self' && self.state.questPoints).toBe(2);
  });
});

describe('Teachers', () => {
  it('Old Nessa teaches brewing and trades once her cauldron is going', () => {
    const sim = new Simulation({ map, seed: 1 });
    const p = beside(sim, 'old_nessa', { quests: { nessas_cauldron: 3 } });
    const pages = talk(sim, p, 'old_nessa');
    expect(pages.some((t) => t.includes('vial of water'))).toBe(true);
    sim.queueIntent(p.id, { type: 'interact', targetId: npc(sim, 'old_nessa').id, action: 'talk' });
    run(sim, 30, () => p.ui?.kind === 'dialogue');
    sim.queueIntent(p.id, { type: 'dialogueChoice', option: 1 });
    run(sim, 1);
    expect(p.ui).toMatchObject({ kind: 'shop', shopId: 'witchs_hut' });
  });

  it('priests explain Prayer', () => {
    const sim = new Simulation({ map, seed: 1 });
    const p = beside(sim, 'brother_aldo');
    expect(talk(sim, p, 'brother_aldo').some((t) => t.includes('Bury the bones'))).toBe(true);
  });
});
