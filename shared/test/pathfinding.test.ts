import { describe, expect, it } from 'vitest';
import { WorldGrid } from '../src/sim/grid';
import { findPath } from '../src/sim/pathfinding';
import { loadWorld } from './helpers';

describe('findPath', () => {
  const map = loadWorld();
  const grid = new WorldGrid(map);

  it('finds a valid path across the river to the mine', () => {
    const start = map.spawn;
    const target = { x: 78, y: 15 };
    const { path, reachedGoal } = findPath(grid, start, [target], target);
    expect(reachedGoal).toBe(true);
    expect(path[path.length - 1]).toEqual(target);
    let prev = start;
    for (const step of path) {
      expect(Math.max(Math.abs(step.x - prev.x), Math.abs(step.y - prev.y))).toBe(1);
      expect(grid.isWalkable(step.x, step.y)).toBe(true);
      prev = step;
    }
  });

  it('never cuts corners diagonally', () => {
    const { path } = findPath(grid, map.spawn, [{ x: 10, y: 40 }], { x: 10, y: 40 });
    let prev = map.spawn;
    for (const step of path) {
      if (step.x !== prev.x && step.y !== prev.y) {
        expect(grid.isWalkable(step.x, prev.y)).toBe(true);
        expect(grid.isWalkable(prev.x, step.y)).toBe(true);
      }
      prev = step;
    }
  });

  it('walks as close as possible to an unreachable tile', () => {
    const water = { x: 61, y: 40 };
    const { path, reachedGoal } = findPath(grid, map.spawn, [water], water);
    expect(reachedGoal).toBe(false);
    const end = path[path.length - 1];
    expect(Math.max(Math.abs(end.x - water.x), Math.abs(end.y - water.y))).toBeLessThanOrEqual(2);
  });
});
