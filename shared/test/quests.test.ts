import { describe, expect, it } from 'vitest';
import type { ServerMessage, UiView } from '../src/protocol/messages';
import type { ObjectEntity, PlayerEntity } from '../src/sim/entities';
import { countItem } from '../src/sim/items';
import { QUESTS, doneStage, questView } from '../src/sim/quests';
import { parseSave } from '../src/sim/save';
import { Simulation } from '../src/sim/Simulation';
import { addPlayer, besides, entities, loadWorld, monsters, run } from './helpers';

const map = loadWorld();

function npc(sim: Simulation, key: string): ObjectEntity {
  return entities(sim).find((e): e is ObjectEntity => e.kind === 'npc' && e.defKey === key)!;
}

/** The conversation page the player is looking at, from their latest self state. */
function page(sim: Simulation, player: PlayerEntity): Extract<UiView, { kind: 'dialogue' }> | null {
  const selfs = sim.drain(player.id).filter((m): m is Extract<ServerMessage, { type: 'self' }> => m.type === 'self');
  const ui = selfs.at(-1)?.state.ui;
  return ui?.kind === 'dialogue' ? ui : null;
}

/** Talks to Maren and clicks through every page, taking `choice` at each question. */
function talk(sim: Simulation, player: PlayerEntity, choice = 0): string[] {
  const maren = npc(sim, 'elder_maren');
  sim.queueIntent(player.id, { type: 'interact', targetId: maren.id, action: 'talk' });
  run(sim, 10, () => player.ui?.kind === 'dialogue');
  const seen: string[] = [];
  for (let i = 0; i < 20 && player.ui?.kind === 'dialogue'; i++) {
    const ui = player.ui;
    const p = ui.pages[ui.index];
    seen.push(p.text);
    sim.queueIntent(player.id, { type: 'dialogueChoice', option: p.options ? choice : 0 });
    run(sim, 1);
  }
  return seen;
}

function nearMaren(sim: Simulation) {
  const maren = npc(sim, 'elder_maren');
  return { x: maren.x, y: maren.y + 1 };
}

describe('The First Oath', () => {
  it('stands Elder Maren by the fountain, next to where new characters start', () => {
    const sim = new Simulation({ map, seed: 1 });
    const maren = npc(sim, 'elder_maren');
    expect(Math.max(Math.abs(maren.x - map.spawn.x), Math.abs(maren.y - map.spawn.y))).toBeLessThanOrEqual(4);
  });

  it('shows her words page by page, and can be turned down', () => {
    const sim = new Simulation({ map, seed: 1 });
    const hero = addPlayer(sim, { at: nearMaren(sim) });
    const maren = npc(sim, 'elder_maren');
    sim.queueIntent(hero.id, { type: 'interact', targetId: maren.id, action: 'talk' });
    run(sim, 3);
    const first = page(sim, hero)!;
    expect(first).toMatchObject({ npcId: maren.id, speaker: 'npc', name: 'Elder Maren' });
    expect(first.text).toContain('Maren');
    expect(first.options).toBeUndefined();

    const seen = talk(sim, hero, 1);
    expect(seen.at(-1)).toContain("isn't going anywhere");
    expect(hero.quests.first_oath ?? 0).toBe(0);
    expect(hero.ui).toBeNull();
  });

  it('runs from the first word to the oath, step by step', () => {
    const sim = new Simulation({ map, seed: 1 });
    const hero = addPlayer(sim, { at: nearMaren(sim), levels: { attack: 50, strength: 50, defence: 50 } });
    const log: ServerMessage[] = [];

    talk(sim, hero);
    expect(hero.quests.first_oath).toBe(1);
    expect(questView('first_oath', 1).status).toBe('in_progress');

    // Without the logs she just reminds you.
    talk(sim, hero);
    expect(hero.quests.first_oath).toBe(1);

    hero.inventory[10] = { itemId: 'logs', qty: 1 };
    hero.inventory[11] = { itemId: 'logs', qty: 1 };
    hero.inventory[12] = { itemId: 'logs', qty: 1 };
    talk(sim, hero);
    expect(hero.quests.first_oath).toBe(2);
    expect(countItem(hero.inventory, 'logs')).toBe(0);

    // Raw fish won't do; a cooked one will, and she hands over a pickaxe.
    hero.inventory[10] = { itemId: 'raw_minnows', qty: 1 };
    talk(sim, hero);
    expect(hero.quests.first_oath).toBe(2);
    hero.inventory[11] = { itemId: 'minnows', qty: 1 };
    talk(sim, hero);
    expect(hero.quests.first_oath).toBe(3);
    expect(countItem(hero.inventory, 'minnows')).toBe(0);
    expect(countItem(hero.inventory, 'bronze_pickaxe')).toBe(1);

    hero.inventory[12] = { itemId: 'bronze_bar', qty: 1 };
    talk(sim, hero);
    expect(hero.quests.first_oath).toBe(4);

    // Beat a goblin.
    const goblin = monsters(sim, 'goblin')[0];
    const spot = besides(sim, goblin);
    hero.x = spot.x;
    hero.y = spot.y;
    sim.queueIntent(hero.id, { type: 'attack', targetId: goblin.id });
    run(sim, 100, () => goblin.respawnAt !== undefined);
    expect(hero.quests.first_oath).toBe(5);

    const back = nearMaren(sim);
    hero.x = back.x;
    hero.y = back.y;
    sim.drain(hero.id);
    const coins = countItem(hero.inventory, 'coins');
    const cookingXp = hero.skills.cooking;
    const seen = talk(sim, hero);
    log.push(...sim.drain(hero.id));
    expect(seen.some((t) => t.includes("I'll take only what I need"))).toBe(true);
    expect(hero.quests.first_oath).toBe(doneStage(QUESTS.first_oath));
    expect(countItem(hero.inventory, 'coins')).toBe(coins + 300);
    expect(countItem(hero.inventory, 'iron_sword')).toBe(1);
    expect(hero.skills.cooking).toBe(cookingXp + 150);
    const done = log.find((m) => m.type === 'questComplete');
    expect(done).toMatchObject({ name: 'The First Oath', questPoints: 1 });
    expect(questView('first_oath', hero.quests.first_oath).steps.every((s) => s.done)).toBe(true);

    // Talking again doesn't pay out twice, and she warns about the drake.
    const after = talk(sim, hero);
    expect(after.join(' ')).toContain('drake');
    expect(countItem(hero.inventory, 'iron_sword')).toBe(1);

    // Progress survives a save.
    const save = parseSave(JSON.parse(JSON.stringify(sim.saveFor(hero.id, '2026-10-26T00:00:00Z'))))!;
    expect(save.quests.first_oath).toBe(doneStage(QUESTS.first_oath));
  });

  it('keeps only sensible quest progress from a save', () => {
    const save = parseSave({ version: 3, name: 'A', position: { x: 1, y: 1 }, skills: {}, inventory: [], quests: { first_oath: 99, made_up: 3 }, bank: [], equipment: {} })!;
    expect(save.quests).toEqual({ first_oath: doneStage(QUESTS.first_oath) });
  });
});

describe('Talking to people', () => {
  it('lets a banker open your bank from the conversation', () => {
    const sim = new Simulation({ map, seed: 1 });
    const banker = npc(sim, 'banker');
    const spot = [{ x: banker.x, y: banker.y + 1 }, { x: banker.x, y: banker.y - 1 }, { x: banker.x + 1, y: banker.y }, { x: banker.x - 1, y: banker.y }].find((p) => sim.grid.isWalkable(p.x, p.y))!;
    const hero = addPlayer(sim, { at: spot });
    sim.queueIntent(hero.id, { type: 'interact', targetId: banker.id, action: 'talk' });
    run(sim, 3);
    const p = page(sim, hero)!;
    expect(p.options).toContain("I'd like to use my bank.");
    sim.queueIntent(hero.id, { type: 'dialogueChoice', option: p.options!.indexOf("I'd like to use my bank.") });
    run(sim, 1);
    expect(hero.ui?.kind).toBe('bank');
  });

  it('ends the conversation when you walk away', () => {
    const sim = new Simulation({ map, seed: 1 });
    const hero = addPlayer(sim, { at: nearMaren(sim) });
    sim.queueIntent(hero.id, { type: 'interact', targetId: npc(sim, 'elder_maren').id, action: 'talk' });
    run(sim, 3);
    expect(hero.ui?.kind).toBe('dialogue');
    sim.queueIntent(hero.id, { type: 'walk', x: hero.x, y: hero.y + 2 });
    run(sim, 1);
    expect(hero.ui).toBeNull();
  });
});

describe('The Cinder Drake', () => {
  it('breathes fire, which a drakescale shield mostly turns aside', () => {
    const sim = new Simulation({ map, seed: 5 });
    const drake = monsters(sim, 'cinder_drake')[0];
    expect(drake.level).toBe(60);
    const levels = { attack: 1, strength: 1, defence: 99, hitpoints: 99 };
    const bare = addPlayer(sim, { at: besides(sim, drake), levels });
    const log: ServerMessage[] = [];
    run(sim, 200, () => {
      log.push(...sim.drain(bare.id));
      return log.some((m) => m.type === 'animation' && m.entityId === drake.id && m.kind === 'breath');
    });
    // It came for a player far above double its level: bosses fight anyone.
    expect(drake.target).toBe(bare.id);
    expect(log.some((m) => m.type === 'animation' && m.entityId === drake.id && m.kind === 'breath')).toBe(true);

    // With the shield, no breath ever does more than a third of its 18.
    sim.removePlayer(bare.id);
    const warded = addPlayer(sim, { at: besides(sim, drake), levels, equipment: { shield: 'drakescale_shield' } });
    const hits: number[] = [];
    let breaths = 0;
    run(sim, 600, () => {
      const msgs = sim.drain(warded.id);
      let breathing = false;
      for (const m of msgs) {
        if (m.type === 'animation' && m.entityId === drake.id && m.kind === 'breath') breathing = true;
        if (breathing && m.type === 'hit' && m.targetId === warded.id) {
          hits.push(m.damage);
          breathing = false;
          breaths++;
        }
      }
      warded.hp = 99;
      return breaths >= 5;
    });
    expect(breaths).toBeGreaterThanOrEqual(5);
    expect(Math.max(...hits)).toBeLessThanOrEqual(6);
  });
});
