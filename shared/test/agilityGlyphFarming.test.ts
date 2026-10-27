import { describe, expect, it } from 'vitest';
import type { ServerMessage } from '../src/protocol/messages';
import { Rng } from '../src/rng';
import { COURSES, OBSTACLE_KINDS } from '../src/sim/agility';
import type { ObjectEntity, PlayerEntity } from '../src/sim/entities';
import { CROPS, growPatch, type PatchState } from '../src/sim/farming';
import { glyphsPerShard, GLYPHS } from '../src/sim/glyphcraft';
import { countItem } from '../src/sim/items';
import { parseSave } from '../src/sim/save';
import { Simulation } from '../src/sim/Simulation';
import { xpForLevel } from '../src/sim/skills';
import { addPlayer, entities, loadWorld, run, type Setup } from './helpers';

const map = loadWorld();

const texts = (log: ServerMessage[]) => log.flatMap((m) => (m.type === 'gameMessage' ? [m.text] : []));
const slotOf = (p: PlayerEntity, itemId: string) => p.inventory.findIndex((s) => s?.itemId === itemId);

function objectAt(sim: Simulation, x: number, y: number): ObjectEntity {
  const found = entities(sim).find((e): e is ObjectEntity => e.kind !== 'player' && e.kind !== 'item' && e.kind !== 'monster' && e.x === x && e.y === y);
  if (!found) throw new Error(`nothing at ${x},${y}`);
  return found;
}

/** A player on a walkable tile next to (x, y). */
function nextTo(sim: Simulation, x: number, y: number, setup: Omit<Setup, 'at'> = {}): PlayerEntity {
  for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) {
    if (sim.grid.isWalkable(x + dx, y + dy)) return addPlayer(sim, { ...setup, at: { x: x + dx, y: y + dy } });
  }
  throw new Error(`no room beside ${x},${y}`);
}

/** A stand-in for the random number generator that never rolls disease and always picks the smallest crop. */
const healthy = { chance: () => false, int: (min: number) => min } as unknown as Rng;
const sickly = { chance: () => true, int: (min: number) => min } as unknown as Rng;

describe('Agility', () => {
  it('lays every course out so each obstacle can be crossed', () => {
    const sim = new Simulation({ map, seed: 1 });
    for (const course of Object.values(COURSES)) {
      for (const o of course.obstacles) {
        expect(sim.grid.isWalkable(o.x, o.y), `${course.id} ${o.index}`).toBe(false);
        expect(sim.grid.isWalkable(o.from.x, o.from.y), `${course.id} ${o.index} start`).toBe(true);
        expect(sim.grid.isWalkable(o.to.x, o.to.y), `${course.id} ${o.index} landing`).toBe(true);
        expect(objectAt(sim, o.x, o.y).name).toBe(OBSTACLE_KINDS[o.type].name);
      }
    }
  });

  it('walks to an obstacle, crosses it and lands on the far side, ignoring clicks on the way', () => {
    const sim = new Simulation({ map, seed: 1 });
    const hurdle = COURSES.brightwater.obstacles[1];
    const p = addPlayer(sim, { at: { x: hurdle.from.x, y: hurdle.from.y + 2 }, levels: { agility: 50 } });
    sim.queueIntent(p.id, { type: 'interact', targetId: objectAt(sim, hurdle.x, hurdle.y).id, action: 'cross' });
    run(sim, 10, () => p.action?.kind === 'cross' && !!p.action.started);
    const seen = sim.drain(p.id).flatMap((m) => (m.type === 'tick' ? m.updated : [])).filter((e) => e.id === p.id).pop();
    expect(seen?.crossing).toMatchObject({ obstacle: 'hurdle', from: hurdle.from, to: hurdle.to });
    sim.queueIntent(p.id, { type: 'walk', x: hurdle.from.x, y: hurdle.from.y + 3 });
    run(sim, 5, () => p.action === null);
    expect({ x: p.x, y: p.y }).toEqual(hurdle.to);
    expect(p.skills.agility).toBe(xpForLevel(50) + hurdle.xp);
  });

  it('gives the lap bonus for every obstacle in order', () => {
    const sim = new Simulation({ map, seed: 1 });
    const course = COURSES.brightwater;
    const p = addPlayer(sim, { at: course.obstacles[0].from, levels: { agility: 60 } });
    for (const o of course.obstacles) {
      sim.queueIntent(p.id, { type: 'interact', targetId: objectAt(sim, o.x, o.y).id, action: 'cross' });
      run(sim, 40, () => p.action === null && p.x === o.to.x && p.y === o.to.y);
      expect({ x: p.x, y: p.y }, `obstacle ${o.index}`).toEqual(o.to);
    }
    const total = course.obstacles.reduce((n, o) => n + o.xp, 0) + course.lapXp;
    expect(p.skills.agility).toBeCloseTo(xpForLevel(60) + total, 5);
    expect(texts(sim.drain(p.id)).some((t) => t.includes('complete a lap'))).toBe(true);
  });

  it('keeps the Ashen course for level 30 and up', () => {
    const sim = new Simulation({ map, seed: 1 });
    const o = COURSES.ashen.obstacles[0];
    const p = addPlayer(sim, { at: o.from, levels: { agility: 29 } });
    sim.queueIntent(p.id, { type: 'interact', targetId: objectAt(sim, o.x, o.y).id, action: 'cross' });
    run(sim, 3);
    expect({ x: p.x, y: p.y }).toEqual(o.from);
    expect(texts(sim.drain(p.id)).some((t) => t.includes('Agility level of 30'))).toBe(true);
  });

  it('sometimes drops a beginner off the log, hurting them', () => {
    const log = COURSES.brightwater.obstacles[0];
    let fell = false;
    for (let seed = 1; seed < 60 && !fell; seed++) {
      const sim = new Simulation({ map, seed });
      const p = addPlayer(sim, { at: log.from, levels: { hitpoints: 20 } });
      sim.queueIntent(p.id, { type: 'interact', targetId: objectAt(sim, log.x, log.y).id, action: 'cross' });
      run(sim, 8, () => p.action === null);
      if (p.x === log.to.x && p.y === log.to.y) continue;
      fell = true;
      expect(p.hp).toBeLessThan(20);
      expect(Math.abs(p.x - log.x) + Math.abs(p.y - log.y)).toBe(1);
      expect(p.skills.agility).toBe(0);
    }
    expect(fell).toBe(true);
  });

  it('runs two tiles a tick while energy lasts, and gets it back walking', () => {
    const sim = new Simulation({ map, seed: 1 });
    const start = { x: 190, y: 119 };
    const p = addPlayer(sim, { at: start });
    sim.queueIntent(p.id, { type: 'setRun', on: true });
    sim.queueIntent(p.id, { type: 'walk', x: start.x, y: start.y + 8 });
    run(sim, 1);
    expect(p.y - start.y).toBe(2);
    expect(p.via).toEqual({ x: start.x, y: start.y + 1 });
    run(sim, 3);
    expect(p.y).toBe(start.y + 8);
    expect(p.energy).toBeCloseTo(100 - 4 * 0.7, 5);
    run(sim, 2);
    expect(p.energy).toBeGreaterThan(100 - 4 * 0.7);
    p.energy = 1;
    sim.queueIntent(p.id, { type: 'walk', x: start.x, y: start.y });
    run(sim, 2);
    expect(p.run).toBe(false);
    expect(texts(sim.drain(p.id))).toContain("You're out of run energy.");
  });
});

describe('Glyphcraft', () => {
  const STONE = { x: 144, y: 185 };
  const WIND = { x: 48, y: 178 };

  it('mines aether shards from aether stone with a pickaxe; the stone never runs out', () => {
    const sim = new Simulation({ map, seed: 1 });
    const p = nextTo(sim, STONE.x, STONE.y, { items: [['bronze_pickaxe', 1]] });
    sim.queueIntent(p.id, { type: 'interact', targetId: objectAt(sim, STONE.x, STONE.y).id, action: 'gather' });
    run(sim, 150);
    expect(countItem(p.inventory, 'aether_shard')).toBeGreaterThan(3);
    expect(objectAt(sim, STONE.x, STONE.y).depletedUntil).toBeUndefined();
  });

  it('inscribes every shard into the shrine\'s glyphs, more per shard with levels', () => {
    const sim = new Simulation({ map, seed: 1 });
    const shrine = objectAt(sim, WIND.x, WIND.y);
    expect(shrine.name).toBe('Wind shrine');
    const p = nextTo(sim, WIND.x, WIND.y, { items: [['aether_shard', 10]], levels: { glyphcraft: 22 } });
    sim.queueIntent(p.id, { type: 'useOn', slot: slotOf(p, 'aether_shard'), targetId: shrine.id });
    run(sim, 8, () => p.action === null && countItem(p.inventory, 'wind_glyph') > 0);
    expect(countItem(p.inventory, 'aether_shard')).toBe(0);
    expect(countItem(p.inventory, 'wind_glyph')).toBe(30);
    expect(glyphsPerShard(GLYPHS.wind, 22)).toBe(3);
    expect(p.skills.glyphcraft).toBe(xpForLevel(22) + 50);
  });

  it('needs the level for the shrine', () => {
    const sim = new Simulation({ map, seed: 1 });
    const bloom = objectAt(sim, 115, 152);
    const p = nextTo(sim, bloom.x, bloom.y, { items: [['aether_shard', 5]], levels: { glyphcraft: 26 } });
    sim.queueIntent(p.id, { type: 'interact', targetId: bloom.id, action: 'inscribe' });
    run(sim, 6);
    expect(countItem(p.inventory, 'aether_shard')).toBe(5);
    expect(texts(sim.drain(p.id)).some((t) => t.includes('Glyphcraft level of 27'))).toBe(true);
  });
});

describe('Farming', () => {
  const ALLOTMENT = { x: 197, y: 182 };
  const HERB = { x: 195, y: 188 };

  it('splits the patches into allotments and herb patches', () => {
    const sim = new Simulation({ map, seed: 1 });
    const patches = entities(sim).filter((e): e is ObjectEntity => e.kind === 'scenery' && e.defKey === 'farming_patch');
    expect(patches.filter((p) => p.patch === 'allotment').length).toBe(16);
    expect(patches.filter((p) => p.patch === 'herb').length).toBe(12);
    expect(objectAt(sim, ALLOTMENT.x, ALLOTMENT.y).name).toBe('Allotment');
    expect(objectAt(sim, HERB.x, HERB.y).name).toBe('Herb patch');
  });

  it('rakes, plants, and digs up a crop of potatoes', () => {
    const sim = new Simulation({ map, seed: 1 });
    const patch = objectAt(sim, ALLOTMENT.x, ALLOTMENT.y);
    const p = nextTo(sim, patch.x, patch.y, { items: [['rake', 1], ['seed_dibber', 1], ['spade', 1], ['potato_seed', 5]] });
    sim.queueIntent(p.id, { type: 'interact', targetId: patch.id, action: 'farm' });
    run(sim, 20, () => p.action === null);
    const key = `${patch.x},${patch.y}`;
    expect(p.farm[key].weeds).toBe(0);
    expect(p.skills.farming).toBe(12);

    sim.queueIntent(p.id, { type: 'useOn', slot: slotOf(p, 'potato_seed'), targetId: patch.id });
    run(sim, 6, () => p.action === null);
    expect(p.farm[key]).toMatchObject({ crop: 'potato', stage: 0 });
    expect(countItem(p.inventory, 'potato_seed')).toBe(2);

    // Each viewer sees their own crop.
    const view = sim.drain(p.id).flatMap((m) => (m.type === 'tick' ? m.updated : [])).filter((e) => e.id === patch.id).pop();
    expect(view?.patch).toMatchObject({ weeds: 0, crop: 'potato', stage: 0, stages: 4 });

    growPatch(p.farm[key], CROPS.potato.stages * CROPS.potato.stageMinutes * 100, healthy);
    expect(p.farm[key].left).toBe(CROPS.potato.yield[0]);
    sim.queueIntent(p.id, { type: 'interact', targetId: patch.id, action: 'farm' });
    run(sim, 30, () => p.action === null);
    expect(countItem(p.inventory, 'potato')).toBe(CROPS.potato.yield[0]);
    expect(p.farm[key].crop).toBeUndefined();
    expect(p.farm[key].weeds).toBe(0);
  });

  it('refuses the wrong seeds, a weedy patch and a missing dibber', () => {
    const sim = new Simulation({ map, seed: 1 });
    const herb = objectAt(sim, HERB.x, HERB.y);
    const p = nextTo(sim, herb.x, herb.y, { items: [['potato_seed', 3], ['sunleaf_seed', 1]], levels: { farming: 20 } });
    sim.queueIntent(p.id, { type: 'useOn', slot: slotOf(p, 'sunleaf_seed'), targetId: herb.id });
    run(sim, 4);
    p.farm[`${herb.x},${herb.y}`].weeds = 0;
    sim.queueIntent(p.id, { type: 'useOn', slot: slotOf(p, 'potato_seed'), targetId: herb.id });
    run(sim, 4);
    sim.queueIntent(p.id, { type: 'useOn', slot: slotOf(p, 'sunleaf_seed'), targetId: herb.id });
    run(sim, 4);
    const said = texts(sim.drain(p.id));
    expect(said.some((t) => t.includes('needs weeding'))).toBe(true);
    expect(said.some((t) => t.includes('grow in an allotment'))).toBe(true);
    expect(said.some((t) => t.includes('seed dibber'))).toBe(true);
    expect(p.farm[`${herb.x},${herb.y}`].crop).toBeUndefined();
  });

  it('grows a stage at a time; disease kills a crop unless it is cured', () => {
    const fresh = (): PatchState => ({ weeds: 0, timer: 0, crop: 'sunleaf', stage: 0 });
    const stage = CROPS.sunleaf.stageMinutes * 100;
    const ok = fresh();
    growPatch(ok, stage * 2, healthy);
    expect(ok.stage).toBe(2);

    const sick = fresh();
    growPatch(sick, stage, sickly);
    expect(sick).toMatchObject({ stage: 1, diseased: true });
    growPatch(sick, stage, sickly);
    expect(sick.dead).toBe(true);
    expect(sick.stage).toBe(1);

    const saved = fresh();
    growPatch(saved, stage, sickly);
    delete saved.diseased;
    growPatch(saved, stage * 3, healthy);
    expect(saved.stage).toBe(4);
    expect(saved.left).toBe(CROPS.sunleaf.yield[0]);
  });

  it('cures a diseased crop with a plant cure, and the vial comes back', () => {
    const sim = new Simulation({ map, seed: 1 });
    const herb = objectAt(sim, HERB.x, HERB.y);
    const p = nextTo(sim, herb.x, herb.y, { items: [['plant_cure', 1]] });
    const key = `${herb.x},${herb.y}`;
    p.farm[key] = { weeds: 0, timer: 0, crop: 'sunleaf', stage: 2, diseased: true };
    sim.queueIntent(p.id, { type: 'interact', targetId: herb.id, action: 'farm' });
    run(sim, 6, () => p.action === null);
    expect(p.farm[key].diseased).toBeUndefined();
    expect(countItem(p.inventory, 'vial')).toBe(1);
  });

  it('keeps growing while the player is away, and saves the patches', () => {
    const sim = new Simulation({ map, seed: 1 });
    const save = parseSave({
      version: 3,
      name: 'Gardener',
      position: { x: 199, y: 185 },
      skills: {},
      inventory: [],
      equipment: {},
      bank: [],
      quests: {},
      energy: 42,
      run: true,
      farm: { '195,188': { weeds: 0, timer: 0, crop: 'sunleaf', stage: 3 }, '1,1': { weeds: 9, timer: 0 }, bad: {} },
      createdAt: '',
      updatedAt: '2026-10-26T10:00:00.000Z',
    })!;
    expect(Object.keys(save.farm!)).toEqual(['195,188']);
    const id = sim.addPlayer('Gardener', save, '2026-10-26T10:20:00.000Z');
    const p = sim.getEntity(id) as PlayerEntity;
    expect(p.farm['195,188']).toMatchObject({ stage: 4 });
    expect(p.energy).toBe(42);
    expect(p.run).toBe(true);
    const again = sim.saveFor(id, '2026-10-26T10:21:00.000Z')!;
    expect(again.farm?.['195,188']).toMatchObject({ crop: 'sunleaf', stage: 4 });
    expect(again.energy).toBe(42);
  });
});

describe('Teachers', () => {
  const lesson = (key: string, ask: number, setup: Omit<Setup, 'at'> = {}) => {
    const sim = new Simulation({ map, seed: 1 });
    const who = entities(sim).find((e): e is ObjectEntity => e.kind === 'npc' && e.defKey === key)!;
    const p = nextTo(sim, who.x, who.y, setup);
    sim.queueIntent(p.id, { type: 'interact', targetId: who.id, action: 'talk' });
    run(sim, 20, () => p.ui?.kind === 'dialogue');
    sim.queueIntent(p.id, { type: 'dialogueChoice', option: ask });
    run(sim, 1);
    const pages: string[] = [];
    for (let i = 0; i < 10 && p.ui?.kind === 'dialogue'; i++) {
      pages.push(p.ui.pages[p.ui.index].text);
      sim.queueIntent(p.id, { type: 'dialogueChoice', option: 0 });
      run(sim, 1);
    }
    return pages.join(' ');
  };

  it('Lio teaches Agility, Selwyn Glyphcraft and Farmer Gale Farming', () => {
    expect(lesson('agility_trainer_lio', 0)).toContain('run energy');
    expect(lesson('archmage_selwyn', 0)).toContain('aether stone');
    expect(lesson('farmer_gale', 0)).toContain('rake');
  });
});
