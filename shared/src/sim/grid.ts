import type { MapData, Point } from '../map/types';

/**
 * Static collision and gate info derived from map data. Built once per world.
 * `blocked` covers unwalkable terrain plus tiles occupied by resources,
 * stations and NPCs (those are interacted with from an adjacent tile).
 */
export class WorldGrid {
  readonly width: number;
  readonly height: number;
  readonly blocked: Uint8Array;
  /** Terrain index of each gate tile that has a requirement, else -1. */
  readonly gateAt: Int32Array;
  /**
   * For each tile, the index of the gate tile whose walled-off side it is on,
   * or -1. Used so a gate only checks requirements on the way in.
   */
  readonly gateZone: Int32Array;

  constructor(readonly map: MapData) {
    this.width = map.width;
    this.height = map.height;
    const size = map.width * map.height;
    this.blocked = new Uint8Array(size);
    this.gateAt = new Int32Array(size).fill(-1);
    this.gateZone = new Int32Array(size).fill(-1);

    for (let i = 0; i < size; i++) {
      const def = map.terrainDefs[map.terrain[i]];
      if (!def.walkable) this.blocked[i] = 1;
      if (def.requires) this.gateAt[i] = map.terrain[i];
    }
    for (const p of map.placements) {
      if (p.kind === 'monster') continue;
      const size = p.size ?? 1;
      for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) this.blocked[this.index(p.x + dx, p.y + dy)] = 1;
    }
    this.computeGateZones();
  }

  index(x: number, y: number): number {
    return y * this.width + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  isWalkable(x: number, y: number): boolean {
    return this.inBounds(x, y) && !this.blocked[this.index(x, y)];
  }

  isGate(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.gateAt[this.index(x, y)] !== -1;
  }

  /**
   * For each requirement gate, flood-fill from each of its walkable neighbours
   * without crossing gates. The side that does not contain the spawn point is
   * the gated area.
   */
  private computeGateZones(): void {
    const spawnIndex = this.index(this.map.spawn.x, this.map.spawn.y);
    for (let gi = 0; gi < this.gateAt.length; gi++) {
      if (this.gateAt[gi] === -1) continue;
      const gx = gi % this.width;
      const gy = Math.floor(gi / this.width);
      for (const [dx, dy] of NEIGHBOURS_4) {
        const nx = gx + dx;
        const ny = gy + dy;
        if (!this.isWalkable(nx, ny) || this.isGate(nx, ny)) continue;
        const region = this.flood({ x: nx, y: ny });
        if (!region.has(spawnIndex)) {
          for (const i of region) this.gateZone[i] = gi;
        }
      }
    }
  }

  private flood(start: Point): Set<number> {
    const seen = new Set<number>([this.index(start.x, start.y)]);
    const queue: Point[] = [start];
    while (queue.length) {
      const { x, y } = queue.pop()!;
      for (const [dx, dy] of NEIGHBOURS_4) {
        const nx = x + dx;
        const ny = y + dy;
        if (!this.isWalkable(nx, ny) || this.isGate(nx, ny)) continue;
        const i = this.index(nx, ny);
        if (seen.has(i)) continue;
        seen.add(i);
        queue.push({ x: nx, y: ny });
      }
    }
    return seen;
  }
}

export const NEIGHBOURS_4: readonly [number, number][] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

export const NEIGHBOURS_8: readonly [number, number][] = [
  ...NEIGHBOURS_4,
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
];
