import { describe, expect, it } from 'vitest';
import type { ServerMessage } from '../src/protocol/messages';
import { MONSTERS, equipmentBonuses, hitChance, magicFighter, monsterMagicFighter } from '../src/sim/combat';
import type { PlayerEntity } from '../src/sim/entities';
import { ITEMS, countItem } from '../src/sim/items';
import { SPELLS, SPELL_BY_ID, castsLeft, glyphCost, missingGlyphs } from '../src/sim/magic';
import { parseSave } from '../src/sim/save';
import { Simulation } from '../src/sim/Simulation';
import { combatLevel, startingXp, xpForLevel } from '../src/sim/skills';
import { addPlayer, besides, loadWorld, monsters, run } from './helpers';

const map = loadWorld();

const texts = (log: ServerMessage[]) => log.flatMap((m) => (m.type === 'gameMessage' ? [m.text] : []));
const hits = (log: ServerMessage[]) => log.filter((m): m is Extract<ServerMessage, { type: 'hit' }> => m.type === 'hit');
const slotOf = (p: PlayerEntity, itemId: string) => p.inventory.findIndex((s) => s?.itemId === itemId);

/** The nearest walkable tile to a point. */
function open(sim: Simulation, x: number, y: number) {
  for (let r = 0; r < 8; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (sim.grid.isWalkable(x + dx, y + dy)) return { x: x + dx, y: y + dy };
  throw new Error('nowhere to stand');
}

/** A walkable tile a few tiles from a monster, in a straight line with nothing in the way. */
function rangeFrom(sim: Simulation, m: { x: number; y: number }, d = 4) {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const ok = Array.from({ length: d }, (_, i) => i + 1).every((k) => sim.grid.isWalkable(m.x + dx * k, m.y + dy * k));
    if (ok) return { x: m.x + dx * d, y: m.y + dy * d };
  }
  throw new Error('no clear line');
}

describe('Spellbook data', () => {
  it('only asks for glyphs that exist, and every spell is reachable', () => {
    for (const spell of SPELLS) {
      for (const { itemId } of glyphCost(spell, {})) expect(ITEMS[itemId], `${spell.id} needs ${itemId}`).toBeDefined();
      expect(spell.level).toBeGreaterThanOrEqual(1);
      if (spell.kind === 'combat') expect(spell.maxHit! > 0 && spell.element && spell.tier).toBeTruthy();
      if (spell.kind === 'teleport') expect(spell.to && spell.place).toBeTruthy();
    }
    // Stronger spells hit harder.
    const combat = SPELLS.filter((s) => s.kind === 'combat');
    for (let i = 1; i < combat.length; i++) expect(combat[i].maxHit!).toBeGreaterThan(combat[i - 1].maxHit!);
  });

  it('lets an elemental staff stand in for its glyphs', () => {
    const spell = SPELL_BY_ID.ember_spark;
    const pack = [{ itemId: 'thought_glyph', qty: 1 }, { itemId: 'wind_glyph', qty: 2 }, null];
    expect(missingGlyphs(spell, pack, {})).toEqual([{ itemId: 'ember_glyph', qty: 3 }]);
    expect(missingGlyphs(spell, pack, { weapon: 'ember_staff' })).toEqual([]);
    expect(castsLeft(SPELL_BY_ID.wind_bolt, [{ itemId: 'storm_glyph', qty: 7 }], { weapon: 'wind_staff' })).toBe(7);
  });

  it('makes robes help and metal armour hinder a spell', () => {
    const xp = startingXp();
    xp.magic = xpForLevel(30);
    const druid = monsterMagicFighter(MONSTERS.storm_druid);
    const robed = magicFighter(xp, { helmet: 'wizard_hat', body: 'wizard_robe', legs: 'wizard_skirt', weapon: 'staff' });
    const plated = magicFighter(xp, { helmet: 'steel_helm', body: 'steel_chainbody', legs: 'steel_platelegs' });
    expect(equipmentBonuses({ body: 'wizard_robe' }).magic).toBe(3);
    expect(hitChance(robed, druid)).toBeGreaterThan(hitChance(plated, druid));
  });

  it('counts a mage as much as a fighter for combat level', () => {
    const xp = startingXp();
    xp.magic = xpForLevel(40);
    expect(combatLevel(xp)).toBeGreaterThan(combatLevel(startingXp()));
  });

  it('keeps the autocast spell in a save, and drops a made-up one', () => {
    const base = { version: 3, name: 'Mage', position: { x: 190, y: 119 }, skills: {}, inventory: [], equipment: {}, bank: [], quests: {} };
    expect(parseSave({ ...base, autocast: 'wind_bolt' })?.autocast).toBe('wind_bolt');
    expect(parseSave({ ...base, autocast: 'kelmoor_teleport' })?.autocast).toBeUndefined();
    expect(parseSave({ ...base, autocast: 'fireball' })?.autocast).toBeUndefined();
  });
});

describe('Combat spells', () => {
  it('throws Wind Spark from range, using glyphs and earning Magic XP', () => {
    const sim = new Simulation({ map, seed: 3 });
    const goblin = monsters(sim, 'goblin')[0];
    const mage = addPlayer(sim, { at: rangeFrom(sim, goblin), items: [['wind_glyph', 10], ['thought_glyph', 10]] });
    const start = { x: mage.x, y: mage.y };
    sim.queueIntent(mage.id, { type: 'cast', spell: 'wind_spark', targetId: goblin.id });
    const log: ServerMessage[] = [];
    run(sim, 3, () => (log.push(...sim.drain(mage.id)), hits(log).length > 0));
    // Cast from where they stood: no walking up to it.
    expect({ x: mage.x, y: mage.y }).toEqual(start);
    const hit = hits(log).find((h) => h.attackerId === mage.id)!;
    expect(hit.spell).toEqual({ element: 'wind', tier: 1 });
    expect(log.some((m) => m.type === 'animation' && m.entityId === mage.id && m.kind === 'cast')).toBe(true);
    expect(countItem(mage.inventory, 'wind_glyph')).toBe(9);
    expect(countItem(mage.inventory, 'thought_glyph')).toBe(9);
    expect(mage.skills.magic).toBeGreaterThanOrEqual(startingXp().magic + 5.5);
    // One cast picked by hand, then the fight waits for orders.
    expect(mage.action).toBeNull();
  });

  it('autocasts from a staff until the monster falls, and stops when glyphs run out', () => {
    const sim = new Simulation({ map, seed: 5 });
    const goblin = monsters(sim, 'goblin')[0];
    const mage = addPlayer(sim, { at: rangeFrom(sim, goblin, 3), levels: { magic: 20 }, items: [['thought_glyph', 1], ['wind_glyph', 50]], equipment: { weapon: 'staff' } });
    sim.queueIntent(mage.id, { type: 'setAutocast', spell: 'wind_spark' });
    sim.queueIntent(mage.id, { type: 'attack', targetId: goblin.id });
    const log: ServerMessage[] = [];
    run(sim, 30, () => (log.push(...sim.drain(mage.id)), mage.action === null));
    expect(countItem(mage.inventory, 'thought_glyph')).toBe(0);
    if (goblin.hp > 0) expect(texts(log).some((t) => t.includes("don't have enough thought glyphs"))).toBe(true);

    const druid = monsters(sim, 'storm_druid')[0];
    const pro = addPlayer(sim, { at: rangeFrom(sim, druid, 3), levels: { magic: 60, hitpoints: 60, defence: 40 }, items: [['storm_glyph', 100]], equipment: { weapon: 'wind_staff', body: 'wizard_robe' } });
    sim.queueIntent(pro.id, { type: 'setAutocast', spell: 'wind_bolt' });
    sim.queueIntent(pro.id, { type: 'attack', targetId: druid.id });
    run(sim, 120, () => druid.dyingUntil !== undefined || druid.respawnAt !== undefined);
    expect(druid.hp).toBeLessThanOrEqual(0);
    // The wind staff paid for the wind glyphs; only storm glyphs were used.
    expect(countItem(pro.inventory, 'storm_glyph')).toBeLessThan(100);
    expect(sim.saveFor(pro.id, '')?.autocast).toBe('wind_bolt');
  });

  it('needs the Magic level and the glyphs', () => {
    const sim = new Simulation({ map, seed: 1 });
    const goblin = monsters(sim, 'goblin')[0];
    const p = addPlayer(sim, { at: rangeFrom(sim, goblin), items: [['wind_glyph', 5]] });
    sim.queueIntent(p.id, { type: 'cast', spell: 'wind_bolt', targetId: goblin.id });
    sim.queueIntent(p.id, { type: 'cast', spell: 'wind_spark', targetId: goblin.id });
    run(sim, 2);
    const said = texts(sim.drain(p.id));
    expect(said).toContain('You need a Magic level of 17 to cast Wind Bolt.');
    expect(said).toContain("You don't have enough thought glyphs to cast Wind Spark.");
    expect(countItem(p.inventory, 'wind_glyph')).toBe(5);
  });

  it('lets a storm druid throw spells back, which the Ward of Spells stops', () => {
    const sim = new Simulation({ map, seed: 9 });
    const druid = monsters(sim, 'storm_druid')[0];
    const p = addPlayer(sim, { at: besides(sim, druid), levels: { hitpoints: 99, prayer: 99 } });
    sim.queueIntent(p.id, { type: 'attack', targetId: druid.id });
    const log: ServerMessage[] = [];
    run(sim, 60, () => (log.push(...sim.drain(p.id)), hits(log).some((h) => h.attackerId === druid.id && h.spell)));
    const spells = hits(log).filter((h) => h.attackerId === druid.id && h.spell);
    expect(spells.length).toBeGreaterThan(0);
    expect(log.some((m) => m.type === 'animation' && m.entityId === druid.id && m.kind === 'cast')).toBe(true);

    sim.queueIntent(p.id, { type: 'togglePrayer', prayer: 'ward_of_spells' });
    run(sim, 1);
    const warded: ServerMessage[] = [];
    run(sim, 80, () => (warded.push(...sim.drain(p.id)), hits(warded).filter((h) => h.attackerId === druid.id && h.spell).length >= 3));
    for (const h of hits(warded).filter((h) => h.attackerId === druid.id && h.spell)) expect(h.damage).toBe(0);
  });
});

describe('Teleports and item spells', () => {
  it('lands every teleport on open ground', () => {
    const sim = new Simulation({ map, seed: 1 });
    for (const spell of SPELLS.filter((s) => s.kind === 'teleport')) {
      const p = addPlayer(sim, { at: map.spawn, levels: { magic: 99 }, items: Object.entries(spell.glyphs).map(([g, n]) => [`${g}_glyph`, n] as [string, number]) });
      sim.queueIntent(p.id, { type: 'cast', spell: spell.id });
      run(sim, 20, () => p.action === null && sim.tick > 1);
      expect(sim.grid.isWalkable(p.x, p.y), spell.id).toBe(true);
      expect(Math.max(Math.abs(p.x - spell.to!.x), Math.abs(p.y - spell.to!.y)), spell.id).toBeLessThanOrEqual(3);
      expect(Object.keys(spell.glyphs).every((g) => countItem(p.inventory, `${g}_glyph`) === 0), spell.id).toBe(true);
    }
  });

  it('teleports after the words, ignoring clicks on the way', () => {
    const sim = new Simulation({ map, seed: 1 });
    const p = addPlayer(sim, { at: open(sim, 63, 141), levels: { magic: 30 }, items: [['oath_glyph', 1], ['wind_glyph', 3], ['ember_glyph', 1]] });
    sim.queueIntent(p.id, { type: 'cast', spell: 'kelmoor_teleport' });
    run(sim, 1);
    sim.queueIntent(p.id, { type: 'walk', x: 60, y: 141 });
    run(sim, 3);
    expect(Math.max(Math.abs(p.x - 190), Math.abs(p.y - 116))).toBeLessThanOrEqual(3);
    expect(texts(sim.drain(p.id))).toContain('You arrive in Kelmoor Square.');
  });

  it('chants Hearth Recall for free, but not in a fight, and walking away breaks it', () => {
    const sim = new Simulation({ map, seed: 1 });
    const start = open(sim, 63, 141);
    const p = addPlayer(sim, { at: start });
    sim.queueIntent(p.id, { type: 'cast', spell: 'hearth_recall' });
    run(sim, 3);
    expect(p.action?.kind).toBe('teleport');
    sim.queueIntent(p.id, { type: 'walk', x: start.x, y: start.y });
    run(sim, 20);
    expect(p.x).toBeLessThan(100);
    sim.queueIntent(p.id, { type: 'cast', spell: 'hearth_recall' });
    run(sim, 20, () => p.action === null);
    expect(Math.max(Math.abs(p.x - 190), Math.abs(p.y - 119))).toBeLessThanOrEqual(3);

    const goblin = monsters(sim, 'goblin')[0];
    const fighter = addPlayer(sim, { at: besides(sim, goblin), levels: { hitpoints: 50 } });
    goblin.target = fighter.id;
    sim.queueIntent(fighter.id, { type: 'cast', spell: 'hearth_recall' });
    run(sim, 1);
    expect(texts(sim.drain(fighter.id))).toContain("You can't chant the way home while something is fighting you.");
  });

  it('gilds an item into coins', () => {
    const sim = new Simulation({ map, seed: 1 });
    const p = addPlayer(sim, { at: map.spawn, levels: { magic: 60 }, items: [['steel_sword', 1], ['ember_glyph', 10], ['bloom_glyph', 2]] });
    sim.queueIntent(p.id, { type: 'cast', spell: 'greater_gilding', slot: slotOf(p, 'steel_sword') });
    run(sim, 1);
    expect(countItem(p.inventory, 'steel_sword')).toBe(0);
    expect(countItem(p.inventory, 'coins')).toBe(Math.floor(ITEMS.steel_sword.value * 0.75));
    expect(countItem(p.inventory, 'ember_glyph')).toBe(5);
    // Gilding a bloom glyph needs a second one for the spell itself.
    run(sim, 5);
    sim.queueIntent(p.id, { type: 'cast', spell: 'lesser_gilding', slot: slotOf(p, 'bloom_glyph') });
    run(sim, 1);
    expect(countItem(p.inventory, 'bloom_glyph')).toBe(1);
    expect(texts(sim.drain(p.id)).some((t) => t.includes("don't have enough bloom glyphs"))).toBe(true);
  });

  it('smelts ore in the hand with Forge Touch, steel when there is coal', () => {
    const sim = new Simulation({ map, seed: 1 });
    const p = addPlayer(sim, { at: map.spawn, levels: { magic: 50, smithing: 35 }, items: [['iron_ore', 2], ['coal', 2], ['ember_glyph', 8], ['bloom_glyph', 2]] });
    sim.queueIntent(p.id, { type: 'cast', spell: 'forge_touch', slot: slotOf(p, 'iron_ore') });
    run(sim, 6);
    sim.queueIntent(p.id, { type: 'cast', spell: 'forge_touch', slot: slotOf(p, 'iron_ore') });
    run(sim, 1);
    expect(countItem(p.inventory, 'steel_bar')).toBe(1);
    expect(countItem(p.inventory, 'iron_bar')).toBe(1);
    expect(countItem(p.inventory, 'coal')).toBe(0);
    expect(p.skills.smithing).toBeGreaterThan(xpForLevel(35));
  });

  it('teaches Magic at the Wizards’ Spire and sells the gear in Kelmoor', async () => {
    const { SHOPS } = await import('../src/sim/crafting');
    expect(SHOPS.glyph_and_robe.stock).toEqual(expect.arrayContaining(['staff', 'wizard_hat', 'wind_glyph', 'thought_glyph']));
    expect(SHOPS.wizards_spire.stock).toEqual(expect.arrayContaining(['wind_staff', 'oath_glyph']));
  });
});
