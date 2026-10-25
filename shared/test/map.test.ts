import { describe, expect, it } from 'vitest';
import { AsciiMapSource } from '../src/map/AsciiMapSource';
import { WorldGrid } from '../src/sim/grid';
import { loadWorld } from './helpers';

describe('AsciiMapSource', () => {
  const map = loadWorld();

  it('loads the full 100x60 world', () => {
    expect(map.width).toBe(100);
    expect(map.height).toBe(60);
    expect(map.terrain).toHaveLength(6000);
    expect(map.terrain.every((t) => t >= 0)).toBe(true);
    expect(map.spawn).toEqual({ x: 42, y: 31 });
  });

  it('places every resource, station, NPC and monster spawn', () => {
    const count = (key: string) => map.placements.filter((p) => p.defKey === key).length;
    expect(count('tree')).toBe(227);
    expect(count('bank_chest')).toBe(3);
    expect(count('elder_maren')).toBe(1);
    expect(count('hen')).toBe(8);
    expect(count('cinder_drake')).toBe(1);
  });

  it('puts fishing spots on water and indoor stations on floor', () => {
    const terrainAt = (x: number, y: number) => map.terrainDefs[map.terrain[y * map.width + x]].key;
    const spot = map.placements.find((p) => p.defKey === 'deep_fishing_spot')!;
    expect(terrainAt(spot.x, spot.y)).toBe('water');
    const bank = map.placements.find((p) => p.defKey === 'bank_chest')!;
    expect(terrainAt(bank.x, bank.y)).toBe('floor');
  });

  it('rejects malformed maps with a clear error', () => {
    const legend = { width: 2, height: 1, spawn: { x: 0, y: 0 }, tiles: { '.': { name: 'grass', walkable: true } }, resources: {}, stations: {}, npcs: {}, monsters: {} };
    expect(() => new AsciiMapSource('bad', '.?\n', legend).load()).toThrow(/unknown character '\?'/);
    expect(() => new AsciiMapSource('bad', '...\n', legend).load()).toThrow(/columns/);
  });

  it('finds the walled area behind the gate', () => {
    const grid = new WorldGrid(map);
    expect(grid.isGate(80, 38)).toBe(true);
    const gate = grid.index(80, 38);
    expect(grid.gateZone[grid.index(80, 39)]).toBe(gate); // just inside
    expect(grid.gateZone[grid.index(92, 45)]).toBe(gate); // near the drake
    expect(grid.gateZone[grid.index(80, 37)]).toBe(-1); // just outside
    expect(grid.gateZone[grid.index(map.spawn.x, map.spawn.y)]).toBe(-1);
  });
});
