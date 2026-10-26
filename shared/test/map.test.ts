import { describe, expect, it } from 'vitest';
import { JsonMapSource, areaAt, type JsonMapFile } from '../src/map/JsonMapSource';
import { loadWorld } from './helpers';

describe('JsonMapSource', () => {
  const map = loadWorld();
  const terrainAt = (x: number, y: number) => map.terrainDefs[map.terrain[y * map.width + x]].key;
  const count = (key: string) => map.placements.filter((p) => p.defKey === key).length;

  it('loads the full 120x96 Kelmoor map', () => {
    expect(map.width).toBe(120);
    expect(map.height).toBe(96);
    expect(map.terrain).toHaveLength(120 * 96);
    expect(map.terrain.every((t) => t >= 0)).toBe(true);
    expect(map.spawn).toEqual({ x: 60, y: 49 });
    expect(map.areas).toHaveLength(30);
  });

  it('turns trees, rocks, stations and props into placements', () => {
    expect(count('tree')).toBe(435);
    expect(count('dead_tree')).toBe(37);
    expect(count('copper_rock')).toBe(10);
    expect(count('bank_booth')).toBe(20);
    expect(count('anvil')).toBe(2);
    expect(count('hide_tent')).toBe(16);
    expect(map.defs.resources.coal_rock.skill).toBe('mining');
    expect(map.defs.resources.tree.level).toBeUndefined(); // not in the map data
  });

  it('spawns the encampment goblins with their level and wander area', () => {
    const goblins = map.placements.filter((p) => p.kind === 'monster');
    expect(goblins).toHaveLength(8);
    expect(goblins.every((g) => g.defKey === 'goblin' && g.level === 2 && g.wander?.radius === 6)).toBe(true);
  });

  it('gives objects the ground around them', () => {
    expect(terrainAt(39, 52)).toBe('stone_floor'); // anvil in the smithy
    expect(terrainAt(60, 46)).toBe('water'); // fountain statue
    expect(terrainAt(1, 66)).toBe('long_grass'); // Thornwood tree
  });

  it('finds the smallest named area at a tile', () => {
    expect(areaAt(map, 39, 52)?.name).toBe('Smithy');
    expect(areaAt(map, 60, 49)?.name).toBe('Kelmoor Square');
    expect(areaAt(map, 22, 86)?.name).toBe('Goblin Encampment');
    expect(areaAt(map, 2, 90)?.name).toBe('Thornwood');
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
