import { describe, expect, it } from 'vitest';
import { JsonMapSource, areaAt, type JsonMapFile } from '../src/map/JsonMapSource';
import { kx, ky, loadWorld } from './helpers';

describe('JsonMapSource', () => {
  const map = loadWorld();
  const terrainAt = (x: number, y: number) => map.terrainDefs[map.terrain[y * map.width + x]].key;
  const count = (key: string) => map.placements.filter((p) => p.defKey === key).length;

  it('loads the whole 384x288 Vell Reaches region', () => {
    expect(map.width).toBe(384);
    expect(map.height).toBe(288);
    expect(map.terrain).toHaveLength(384 * 288);
    expect(map.terrain.every((t) => t >= 0)).toBe(true);
    expect(map.spawn).toEqual({ x: kx(60), y: ky(49) });
    expect(map.areas).toHaveLength(103);
  });

  it('turns trees, rocks, stations and props into placements', () => {
    expect(count('tree')).toBe(2821);
    expect(count('dead_tree')).toBe(790);
    expect(count('oak_tree')).toBe(318);
    expect(count('copper_rock')).toBe(22);
    expect(count('glacite_rock')).toBe(3);
    expect(count('bank_booth')).toBe(31);
    expect(count('anvil')).toBe(4);
    expect(count('hide_tent')).toBe(16);
    expect(map.defs.resources.coal_rock.skill).toBe('mining');
    expect(map.defs.resources.yew_tree.skill).toBe('woodcutting');
    expect(map.defs.resources.tree.level).toBeUndefined(); // not in the map data
    // Objects whose skill arrives in a later phase are props for now.
    expect(map.defs.scenery.glyph_shrine.name).toBe('Glyph shrine');
  });

  it('spawns monsters with their level and wander area, and people with their role', () => {
    const monsters = map.placements.filter((p) => p.kind === 'monster');
    const goblins = monsters.filter((p) => p.defKey === 'goblin');
    expect(monsters).toHaveLength(51);
    expect(goblins).toHaveLength(8);
    expect(goblins.every((g) => g.level === 2 && (g.wander?.radius ?? 0) > 0)).toBe(true);

    expect(map.placements.filter((p) => p.kind === 'npc')).toHaveLength(57);
    expect(map.defs.npcs.mara.role).toBe('Shopkeeper');
    expect(map.defs.npcs.mara.shop).toBe('General Store');
    expect(map.defs.npcs.banker.role).toBe('Banker');
  });

  it('lists where each skill is trained', () => {
    expect(map.skills).toHaveLength(24);
    const mining = map.skills.find((s) => s.name === 'Mining')!;
    expect(mining.sites.length).toBeGreaterThan(3);
    expect(mining.sites.every((s) => s.x >= 0 && s.x < map.width && s.y >= 0 && s.y < map.height)).toBe(true);
  });

  it('gives objects the ground around them', () => {
    expect(terrainAt(kx(39), ky(52))).toBe('stone_floor'); // anvil in the Kelmoor smithy
    expect(terrainAt(kx(60), ky(46))).toBe('water'); // fountain statue
    expect(terrainAt(kx(2), ky(63))).toBe('long_grass'); // Thornwood tree
  });

  it('bridges the River Vell where the east road crosses it', () => {
    for (let y = ky(45); y <= ky(47); y++) for (let x = kx(98); x <= kx(101); x++) expect(terrainAt(x, y)).toBe('bridge');
  });

  it('finds the smallest named area at a tile', () => {
    expect(areaAt(map, kx(39), ky(52))?.name).toBe('Smithy');
    expect(areaAt(map, map.spawn.x, map.spawn.y)?.name).toBe('Kelmoor Square');
    expect(areaAt(map, 203, 120)?.name).toBe('General Store');
    expect(areaAt(map, 340, 230)?.name).toBe('Sunscar Mine');
    expect(areaAt(map, 152, 156)?.name).toBe('Goblin Encampment');
  });

  it('rejects malformed maps with a clear error', () => {
    const base: JsonMapFile = { name: 'bad', width: 2, height: 1, spawn: { x: 0, y: 0 }, legend: { '.': { name: 'Grass', walkable: true } }, rows: ['..'] };
    expect(() => new JsonMapSource('bad', { ...base, rows: ['.?'] }).load()).toThrow(/unknown character '\?'/);
    expect(() => new JsonMapSource('bad', { ...base, rows: ['...'] }).load()).toThrow(/columns/);
    expect(() => new JsonMapSource('bad', { ...base, spawn: { x: 5, y: 0 } }).load()).toThrow(/spawn/);
    const tree = { ...base, legend: { ...base.legend, T: { name: 'Tree', walkable: true } }, rows: ['.T'] };
    expect(() => new JsonMapSource('bad', tree).load()).toThrow(/walkable/);
  });
});
