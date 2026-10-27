import { describe, expect, it } from 'vitest';
import type { ServerMessage } from '../src/protocol/messages';
import { MONSTERS, hitChance, monsterFighter, playerFighter, playerMaxHit } from '../src/sim/combat';
import type { GroundItemEntity, MonsterEntity } from '../src/sim/entities';
import { INVENTORY_SIZE, ITEMS, countItem } from '../src/sim/items';
import { parseSave } from '../src/sim/save';
import { DEATH_PILE_TICKS, PRIVATE_TICKS, Simulation } from '../src/sim/Simulation';
import { combatLevel, startingXp, xpForLevel } from '../src/sim/skills';
import { addPlayer, besides, entities, kx, ky, loadWorld, monsters, run } from './helpers';

const map = loadWorld();

const hits = (log: ServerMessage[]) => log.filter((m): m is Extract<ServerMessage, { type: 'hit' }> => m.type === 'hit');

describe('Combat formulas', () => {
  it('gives every monster on the map stats that match its level', () => {
    for (const p of map.placements.filter((p) => p.kind === 'monster')) {
      const stats = MONSTERS[p.defKey];
      expect(stats, p.defKey).toBeDefined();
      const xp = startingXp();
      xp.attack = xpForLevel(stats.attack);
      xp.strength = xpForLevel(stats.strength);
      xp.defence = xpForLevel(stats.defence);
      xp.hitpoints = xpForLevel(stats.hitpoints);
      expect(combatLevel(xp), p.defKey).toBe(p.level);
      for (const d of stats.drops) expect(ITEMS[d.item], `${p.defKey} drops ${d.item}`).toBeDefined();
    }
  });

  it('makes better gear and levels hit harder and more often', () => {
    const fresh = playerFighter(startingXp(), {}, 'accurate');
    const goblin = monsterFighter(MONSTERS.goblin);
    expect(playerMaxHit(fresh)).toBe(1);
    const strong = startingXp();
    strong.attack = xpForLevel(40);
    strong.strength = xpForLevel(40);
    const armed = playerFighter(strong, { weapon: 'steel_sword' }, 'aggressive');
    expect(playerMaxHit(armed)).toBeGreaterThanOrEqual(5);
    expect(hitChance(armed, goblin)).toBeGreaterThan(hitChance(fresh, goblin));
    expect(hitChance(fresh, goblin)).toBeGreaterThan(0.3);
    // Armour makes you harder to hit.
    const plated = playerFighter(startingXp(), { body: 'steel_chainbody', legs: 'steel_platelegs' }, 'defensive');
    expect(hitChance(monsterFighter(MONSTERS.skeleton), plated)).toBeLessThan(hitChance(monsterFighter(MONSTERS.skeleton), fresh));
  });
});

describe('Fighting', () => {
  it('kills a goblin, earns XP, and drops loot only its killer can see at first', () => {
    const sim = new Simulation({ map, seed: 7 });
    const goblin = monsters(sim, 'goblin')[0];
    const hero = addPlayer(sim, { at: besides(sim, goblin), levels: { attack: 40, strength: 40, defence: 40 } });
    const other = addPlayer(sim, { at: besides(sim, goblin), levels: { attack: 40, defence: 40 } });
    const xpBefore = { ...hero.skills };
    sim.queueIntent(hero.id, { type: 'attack', targetId: goblin.id });
    const log: ServerMessage[] = [];
    run(sim, 100, () => {
      log.push(...sim.drain(hero.id));
      return goblin.respawnAt !== undefined;
    });
    expect(goblin.respawnAt).toBeDefined();
    expect(hits(log).some((h) => h.attackerId === hero.id && h.targetId === goblin.id && h.damage > 0)).toBe(true);
    expect(log.some((m) => m.type === 'animation' && m.entityId === hero.id && m.kind === 'punch')).toBe(true);
    expect(log.some((m) => m.type === 'animation' && m.entityId === goblin.id && m.kind === 'death')).toBe(true);
    expect(hero.skills.attack - xpBefore.attack).toBe(4 * 5);
    expect(hero.skills.hitpoints).toBeGreaterThan(xpBefore.hitpoints);
    expect(hero.action).toBeNull();

    // The hero sees the loot; the bystander doesn't, and can't take it, until a minute has passed.
    const loot = entities(sim).find((e): e is GroundItemEntity => e.kind === 'item' && e.x === goblin.x && e.y === goblin.y)!;
    expect(loot).toBeDefined();
    sim.queueIntent(other.id, { type: 'interact', targetId: loot.id, action: 'take' });
    run(sim, 5);
    expect(countItem(other.inventory, loot.itemId)).toBe(0);
    expect(loot.owner).toBe(hero.id);
    const late = addPlayer(sim, { at: besides(sim, goblin) });
    const snapshot = sim.drain(late.id).find((m) => m.type === 'snapshot');
    expect(snapshot?.type === 'snapshot' && snapshot.entities.some((e) => e.id === loot.id)).toBe(false);
    run(sim, PRIVATE_TICKS);
    sim.queueIntent(other.id, { type: 'interact', targetId: loot.id, action: 'take' });
    run(sim, 5);
    expect(countItem(other.inventory, loot.itemId)).toBe(loot.qty);
  });

  it('brings a monster back at its spawn point with full health', () => {
    const sim = new Simulation({ map, seed: 2 });
    const goblin = monsters(sim, 'goblin')[0];
    const hero = addPlayer(sim, { at: besides(sim, goblin), levels: { attack: 60, strength: 60, defence: 60 } });
    sim.queueIntent(hero.id, { type: 'attack', targetId: goblin.id });
    run(sim, 100, () => goblin.respawnAt !== undefined);
    run(sim, MONSTERS.goblin.respawnTicks + 2);
    expect(goblin.respawnAt).toBeUndefined();
    expect([goblin.x, goblin.y]).toEqual([goblin.spawn.x, goblin.spawn.y]);
    expect(goblin.hp).toBe(goblin.maxHp);
  });

  it('lets goblins pick on weak players, who fight back on their own', () => {
    const sim = new Simulation({ map, seed: 4 });
    const goblin = monsters(sim, 'goblin')[0];
    const newbie = addPlayer(sim, { at: besides(sim, goblin) });
    run(sim, 30, () => newbie.hp < 10);
    expect(goblin.target).toBe(newbie.id);
    expect(newbie.action).toEqual(expect.objectContaining({ kind: 'attack', targetId: goblin.id }));
  });

  it('leaves strong players alone', () => {
    const sim = new Simulation({ map, seed: 4 });
    const goblin = monsters(sim, 'goblin')[0];
    const veteran = addPlayer(sim, { at: besides(sim, goblin), levels: { attack: 10, strength: 10, defence: 10 } });
    run(sim, 60);
    expect(goblin.target).toBeNull();
    expect(veteran.hp).toBe(10);
  });

  it('chases a fleeing player, then gives up and goes home', () => {
    const sim = new Simulation({ map, seed: 5 });
    const goblin = monsters(sim, 'goblin')[0];
    const newbie = addPlayer(sim, { at: besides(sim, goblin) });
    sim.queueIntent(newbie.id, { type: 'attack', targetId: goblin.id });
    run(sim, 3);
    expect(goblin.target).toBe(newbie.id);
    // Walk well away to the north-east, toward Kelmoor.
    sim.queueIntent(newbie.id, { type: 'walk', x: map.spawn.x, y: map.spawn.y });
    let furthest = 0;
    run(sim, 120, () => {
      furthest = Math.max(furthest, Math.hypot(goblin.x - goblin.wander.cx, goblin.y - goblin.wander.cy));
      return false;
    });
    expect(goblin.target).toBeNull();
    expect(furthest).toBeLessThanOrEqual(goblin.wander.radius + 8 + 1.5);
    expect(Math.hypot(goblin.x - goblin.wander.cx, goblin.y - goblin.wander.cy)).toBeLessThanOrEqual(goblin.wander.radius + 1);
  });

  it('stops showing a player as under attack once the monster gives up', () => {
    const sim = new Simulation({ map, seed: 5 });
    const goblin = monsters(sim, 'goblin')[0];
    const newbie = addPlayer(sim, { at: besides(sim, goblin) });
    run(sim, 30, () => newbie.attackedBy === goblin.id);
    expect(newbie.attackedBy).toBe(goblin.id);
    // Out of its reach in one step (as a teleport would), far from any other monster.
    newbie.x = map.spawn.x;
    newbie.y = map.spawn.y;
    run(sim, 2);
    expect(goblin.target).toBeNull();
    expect(newbie.attackedBy).toBeNull();
  });

  it('keeps wandering monsters inside their area and off each other', () => {
    const sim = new Simulation({ map, seed: 11 });
    const all = entities(sim).filter((e): e is MonsterEntity => e.kind === 'monster');
    expect(all.length).toBe(map.placements.filter((p) => p.kind === 'monster').length);
    const start = all.map((m) => `${m.x},${m.y}`);
    for (let t = 0; t < 300; t++) {
      sim.step();
      const tiles = new Set(all.map((m) => `${m.x},${m.y}`));
      expect(tiles.size).toBe(all.length);
      for (const m of all) {
        const fromCentre = Math.hypot(m.x - m.wander.cx, m.y - m.wander.cy);
        const fromSpawn = Math.hypot(m.x - m.spawn.x, m.y - m.spawn.y);
        expect(fromCentre <= m.wander.radius + 0.01 || fromSpawn < 1, `${m.defKey} at ${m.x},${m.y}`).toBe(true);
      }
    }
    expect(all.map((m) => `${m.x},${m.y}`)).not.toEqual(start);
  });
});

describe('Equipment and eating', () => {
  it('wields and wears items, swapping out what was there', () => {
    const sim = new Simulation({ map, seed: 1 });
    const p = addPlayer(sim, { at: map.spawn, items: [['bronze_sword', 1], ['iron_sword', 1], ['bronze_helm', 1]] });
    sim.queueIntent(p.id, { type: 'equip', slot: 0 });
    sim.queueIntent(p.id, { type: 'equip', slot: 2 });
    sim.step();
    expect(p.equipment).toEqual({ weapon: 'bronze_sword', helmet: 'bronze_helm' });
    sim.queueIntent(p.id, { type: 'equip', slot: 1 });
    sim.step();
    expect(p.equipment.weapon).toBe('iron_sword');
    expect(p.inventory[1]).toEqual({ itemId: 'bronze_sword', qty: 1 });
    const self = sim.drain(p.id).filter((m) => m.type === 'self').pop();
    expect(self?.type === 'self' && self.state.bonuses).toEqual({ attack: 10, strength: 9, defence: 2, magic: -3 });
  });

  it('wields an axe as a weapon and still chops with it', () => {
    const sim = new Simulation({ map, seed: 3 });
    const p = addPlayer(sim, { at: { x: kx(25), y: ky(60) }, items: [['bronze_axe', 1]] });
    sim.queueIntent(p.id, { type: 'equip', slot: 0 });
    sim.step();
    expect(p.equipment.weapon).toBe('bronze_axe');
    expect(p.inventory.every((s) => s === null)).toBe(true);
    const tree = entities(sim).find((e) => e.kind === 'resource' && e.x === kx(26) && e.y === ky(60))!;
    sim.queueIntent(p.id, { type: 'interact', targetId: tree.id, action: 'gather' });
    run(sim, 200, () => countItem(p.inventory, 'logs') > 0);
    expect(countItem(p.inventory, 'logs')).toBeGreaterThan(0);
  });

  it('needs the level to use steel', () => {
    const sim = new Simulation({ map, seed: 1 });
    const p = addPlayer(sim, { at: map.spawn, items: [['steel_sword', 1]] });
    sim.queueIntent(p.id, { type: 'equip', slot: 0 });
    sim.step();
    expect(p.equipment.weapon).toBeUndefined();
    expect(sim.drain(p.id).some((m) => m.type === 'gameMessage' && m.text === 'You need an Attack level of 5 to wield this.')).toBe(true);
  });

  it("won't take something off without room for it", () => {
    const sim = new Simulation({ map, seed: 1 });
    const p = addPlayer(sim, { at: map.spawn, items: [['logs', INVENTORY_SIZE]], equipment: { helmet: 'bronze_helm' } });
    sim.queueIntent(p.id, { type: 'unequip', slot: 'helmet' });
    sim.step();
    expect(p.equipment.helmet).toBe('bronze_helm');
  });

  it('heals by eating, one bite at a time', () => {
    const sim = new Simulation({ map, seed: 1 });
    const p = addPlayer(sim, { at: map.spawn, items: [['perch', 1], ['perch', 1]], hp: 2 });
    expect(p.hp).toBe(2);
    sim.queueIntent(p.id, { type: 'eat', slot: 0 });
    sim.queueIntent(p.id, { type: 'eat', slot: 1 });
    sim.step();
    expect(p.hp).toBe(8);
    expect(p.inventory[1]).not.toBeNull();
    run(sim, 3);
    sim.queueIntent(p.id, { type: 'eat', slot: 1 });
    sim.step();
    expect(p.hp).toBe(10);
    expect(p.inventory.every((s) => s === null)).toBe(true);
  });

  it('keeps gear, health and attack style in the save', () => {
    const sim = new Simulation({ map, seed: 1 });
    const p = addPlayer(sim, { at: map.spawn, equipment: { weapon: 'bronze_sword', shield: 'bronze_shield' }, hp: 6 });
    sim.queueIntent(p.id, { type: 'setAttackStyle', style: 'aggressive' });
    sim.step();
    const save = parseSave(JSON.parse(JSON.stringify(sim.saveFor(p.id, 'now'))))!;
    expect(save.equipment).toEqual({ weapon: 'bronze_sword', shield: 'bronze_shield' });
    expect(save.hp).toBe(6);
    expect(save.attackStyle).toBe('aggressive');
    // Nonsense in a save is dropped rather than trusted.
    const bad = parseSave({ ...save, equipment: { weapon: 'bronze_helm', helmet: 'no_such_thing' } })!;
    expect(bad.equipment).toEqual({});
  });
});

describe('Death', () => {
  it('sends a fallen player home, keeping their three most valuable items', () => {
    const sim = new Simulation({ map, seed: 9 });
    const scorpion = monsters(sim, 'scorpion')[0];
    const spot = besides(sim, scorpion);
    const p = addPlayer(sim, {
      at: spot,
      hp: 1,
      equipment: { weapon: 'steel_sword', helmet: 'bronze_helm' },
      items: [['coins', 500], ['iron_helm', 1], ['bronze_axe', 1], ['minnows', 1]],
    });
    run(sim, 200, () => p.deadUntil !== undefined);
    expect(p.deadUntil).toBeDefined();
    const fellAt = { x: p.x, y: p.y };
    run(sim, 10);
    expect(p.deadUntil).toBeUndefined();
    expect([p.x, p.y]).toEqual([map.spawn.x, map.spawn.y]);
    expect(p.hp).toBe(10);
    // Steel sword (325), iron helm (84), bronze helm (24) are kept.
    expect(p.equipment).toEqual({ weapon: 'steel_sword', helmet: 'bronze_helm' });
    expect(p.inventory.filter(Boolean)).toEqual([{ itemId: 'iron_helm', qty: 1 }]);
    const pile = entities(sim).filter((e): e is GroundItemEntity => e.kind === 'item' && e.x === fellAt.x && e.y === fellAt.y);
    expect(pile.map((e) => [e.itemId, e.qty]).sort()).toEqual([['bronze_axe', 1], ['coins', 500], ['minnows', 1]]);
    for (const item of pile) {
      expect(item.owner).toBe(p.id);
      expect(item.despawnAt - sim.tick).toBeGreaterThan(DEATH_PILE_TICKS - 20);
    }
    expect(scorpion.target).not.toBe(p.id);
  });
});
