import { describe, expect, it } from 'vitest';
import type { ServerMessage } from '../src/protocol/messages';
import type { GroundItemEntity, MonsterEntity, ObjectEntity, PlayerEntity } from '../src/sim/entities';
import { countItem } from '../src/sim/items';
import { findPath } from '../src/sim/pathfinding';
import { QUESTS, doneStage } from '../src/sim/quests';
import { Simulation } from '../src/sim/Simulation';
import { addPlayer, besides, entities, loadWorld, monsters, run } from './helpers';

const map = loadWorld();
const fighter = { levels: { attack: 99, strength: 99, defence: 99, hitpoints: 99, prayer: 1 }, equipment: { weapon: 'glacite_sword' } };

function npc(sim: Simulation, key: string): ObjectEntity {
  const found = entities(sim).find((e): e is ObjectEntity => e.kind === 'npc' && e.defKey === key);
  if (!found) throw new Error(`no ${key}`);
  return found;
}

function standBeside(sim: Simulation, p: PlayerEntity, who: { x: number; y: number }): void {
  const spot = [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1]].map(([dx, dy]) => ({ x: who.x + dx, y: who.y + dy })).find((q) => sim.grid.isWalkable(q.x, q.y))!;
  [p.x, p.y] = [spot.x, spot.y];
  p.path = [];
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

const shadesOf = (sim: Simulation, hart: MonsterEntity) => monsters(sim, 'gloam_shade').filter((s) => s.summonedBy === hart.id);
const standing = (m: MonsterEntity) => m.respawnAt === undefined && m.dyingUntil === undefined && m.hp > 0;

/**
 * Fights the hart to the end, kept alive throughout: the shades first
 * whenever they're up, then the hart. Returns the hits it took while shrouded.
 */
function slayHart(sim: Simulation, p: PlayerEntity, hart: MonsterEntity): { shroudedHits: number; shadesSeen: number } {
  let shroudedHits = 0;
  let shadesSeen = 0;
  for (let round = 0; round < 60 && hart.respawnAt === undefined; round++) {
    const shade = shadesOf(sim, hart).find(standing);
    const target = shade ?? hart;
    if (!standing(target)) {
      run(sim, 5);
      continue;
    }
    shadesSeen = Math.max(shadesSeen, shadesOf(sim, hart).length);
    standBeside(sim, p, target);
    sim.queueIntent(p.id, { type: 'attack', targetId: target.id });
    const before = hart.hp;
    run(sim, 60, () => {
      p.hp = 99;
      return !standing(target) || (!shade && shadesOf(sim, hart).some(standing)) || hart.respawnAt !== undefined;
    });
    if (shade && hart.hp < before) shroudedHits++;
  }
  return { shroudedHits, shadesSeen };
}

describe('The Duskwood', () => {
  it('has a rangers\' camp on the road and a trail to the Gloaming Glade, where the hart sleeps', () => {
    const sim = new Simulation({ map, seed: 31 });
    const area = (name: string) => map.areas.find((a) => a.name === name)!;
    const inside = (p: { x: number; y: number }, a: { x: number; y: number; w: number; h: number }) => p.x >= a.x && p.y >= a.y && p.x < a.x + a.w && p.y < a.y + a.h;
    const vessa = npc(sim, 'vessa');
    expect(inside(vessa, area("Rangers' Camp"))).toBe(true);
    const [hart] = monsters(sim, 'gloam_hart');
    expect(inside(hart, area('The Gloaming Glade'))).toBe(true);
    expect(inside(hart, area('The Duskwood'))).toBe(true);
    expect(hart.level).toBe(78);
    // Walkable all the way from Vessa's fire to the hart.
    const route = findPath(sim.grid, { x: vessa.x, y: vessa.y + 1 }, [{ x: hart.x - 1, y: hart.y }], { x: hart.x - 1, y: hart.y });
    expect(route.reachedGoal).toBe(true);
    // No stalker lies in wait in the glade itself.
    for (const s of monsters(sim, 'dusk_stalker')) expect(inside(s, area('The Gloaming Glade')), `${s.x},${s.y}`).toBe(false);
  });

  it('the Gloam Hart calls up shades twice, and blows pass through it until they fall', () => {
    const sim = new Simulation({ map, seed: 32 });
    const [hart] = monsters(sim, 'gloam_hart');
    const p = addPlayer(sim, { ...fighter, at: besides(sim, hart) });
    sim.queueIntent(p.id, { type: 'attack', targetId: hart.id });
    run(sim, 300, () => ((p.hp = 99), shadesOf(sim, hart).length > 0));
    expect(shadesOf(sim, hart)).toHaveLength(2);
    expect(hart.hp).toBeLessThanOrEqual(hart.maxHp * 0.66);
    // Keep swinging at the hart itself: nothing gets through.
    const hp = hart.hp;
    run(sim, 15, () => ((p.hp = 99), false));
    expect(hart.hp).toBe(hp);
    const log: ServerMessage[] = sim.drain(p.id);
    slayHart(sim, p, hart);
    log.push(...sim.drain(p.id));
    expect(hart.respawnAt).toBeDefined();
    expect(hart.summoned).toBe(2);
    const said = log.flatMap((m) => (m.type === 'gameMessage' ? [m.text] : []));
    expect(said.some((t) => t.includes('shadows rise to answer it'))).toBe(true);
    expect(said.some((t) => t.includes('passes through the shadow'))).toBe(true);
    // The shades are gone for good, and the hart left its bones.
    run(sim, 10);
    expect(monsters(sim, 'gloam_shade')).toHaveLength(0);
    const loot = entities(sim).filter((e): e is GroundItemEntity => e.kind === 'item' && e.x === hart.x && e.y === hart.y).map((l) => l.itemId);
    expect(loot).toContain('hart_bones');
    expect(loot).toContain('hart_antler');
  });

  it('the shades fade if their quarry leaves', () => {
    const sim = new Simulation({ map, seed: 33 });
    const [hart] = monsters(sim, 'gloam_hart');
    const p = addPlayer(sim, { ...fighter, at: besides(sim, hart) });
    sim.queueIntent(p.id, { type: 'attack', targetId: hart.id });
    run(sim, 200, () => ((p.hp = 99), shadesOf(sim, hart).length > 0));
    expect(shadesOf(sim, hart).length).toBe(2);
    // Run far away: the shades lose their quarry and fade.
    [p.x, p.y] = [418, 336];
    p.path = [];
    p.action = null;
    run(sim, 10);
    expect(monsters(sim, 'gloam_shade')).toHaveLength(0);
  });

  it('The Gloaming: find Tamsin\'s horn, slay the hart, and Vessa rewards you', () => {
    const sim = new Simulation({ map, seed: 34 });
    const vessa = npc(sim, 'vessa');
    const p = addPlayer(sim, { ...fighter, at: { x: vessa.x, y: vessa.y + 1 } });
    standBeside(sim, p, vessa);
    talk(sim, p, 'vessa');
    expect(p.quests.the_gloaming).toBe(1);

    for (let i = 0; i < 40 && p.quests.the_gloaming === 1; i++) {
      const m = monsters(sim, 'dusk_stalker').find(standing);
      if (!m) {
        run(sim, 20);
        continue;
      }
      standBeside(sim, p, m);
      sim.queueIntent(p.id, { type: 'attack', targetId: m.id });
      run(sim, 300, () => ((p.hp = 99), m.respawnAt !== undefined));
    }
    expect(p.quests.the_gloaming).toBe(2);
    const horn = entities(sim).find((e): e is GroundItemEntity => e.kind === 'item' && e.itemId === 'tamsins_horn')!;
    [p.x, p.y] = [horn.x, horn.y];
    sim.queueIntent(p.id, { type: 'interact', targetId: horn.id, action: 'take' });
    run(sim, 3);
    expect(countItem(p.inventory, 'tamsins_horn')).toBe(1);

    standBeside(sim, p, vessa);
    expect(talk(sim, p, 'vessa').join(' ')).toContain('Gloam Hart');
    expect(p.quests.the_gloaming).toBe(3);
    expect(countItem(p.inventory, 'tamsins_horn')).toBe(0);

    const [hart] = monsters(sim, 'gloam_hart');
    slayHart(sim, p, hart);
    expect(p.quests.the_gloaming).toBe(4);

    standBeside(sim, p, vessa);
    talk(sim, p, 'vessa');
    expect(p.quests.the_gloaming).toBe(doneStage(QUESTS.the_gloaming));
    expect(countItem(p.inventory, 'yew_longbow')).toBe(1);
    expect(countItem(p.inventory, 'glacite_arrow')).toBe(150);
  });
});
