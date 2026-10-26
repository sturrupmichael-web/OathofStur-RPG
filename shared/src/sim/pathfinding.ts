import type { Point } from '../map/types';
import { NEIGHBOURS_8, type WorldGrid } from './grid';

export interface PathOptions {
  /** Extra per-step rule on top of static collision (e.g. gate requirements). */
  canStep?: (fromX: number, fromY: number, toX: number, toY: number) => boolean;
  /** Search budget. The default covers the whole grid, however large. */
  maxNodes?: number;
}

export interface PathResult {
  /** Steps to take, excluding the start tile. */
  path: Point[];
  /** True if the path ends on a goal tile; false if it is a best-effort approach. */
  reachedGoal: boolean;
}

/**
 * A* over 8 directions with uniform step cost (a diagonal step takes one tick
 * like a straight one). Diagonals may not cut corners: both orthogonal
 * neighbours must be passable.
 *
 * `goals` are the acceptable end tiles; `target` drives the heuristic and the
 * fallback. If no goal is reachable, returns the path to the explored tile
 * closest to `target`, so clicking an unreachable spot still walks toward it.
 */
export function findPath(
  grid: WorldGrid,
  start: Point,
  goals: readonly Point[],
  target: Point,
  options: PathOptions = {},
): PathResult {
  const w = grid.width;
  const { canStep, maxNodes = Math.max(20000, w * grid.height) } = options;
  const startIndex = grid.index(start.x, start.y);
  const goalSet = new Set(goals.filter((g) => grid.inBounds(g.x, g.y)).map((g) => grid.index(g.x, g.y)));

  if (goalSet.has(startIndex)) return { path: [], reachedGoal: true };

  const heuristic = (i: number) => {
    const dx = Math.abs((i % w) - target.x);
    const dy = Math.abs(Math.floor(i / w) - target.y);
    return Math.max(dx, dy);
  };
  // Goals may be next to the target rather than on it.
  const goalSlack = goals.length ? Math.min(...goals.map((g) => Math.max(Math.abs(g.x - target.x), Math.abs(g.y - target.y)))) : 0;

  const gScore = new Map<number, number>([[startIndex, 0]]);
  const cameFrom = new Map<number, number>();
  const closed = new Set<number>();
  const open = new MinHeap();
  open.push(startIndex, Math.max(0, heuristic(startIndex) - goalSlack));

  let best = startIndex;
  let bestH = heuristic(startIndex);
  let bestG = 0;
  let expanded = 0;

  while (open.size && expanded < maxNodes) {
    const current = open.pop();
    if (closed.has(current)) continue;
    closed.add(current);
    expanded++;

    if (goalSet.has(current)) return { path: rebuild(cameFrom, current, w), reachedGoal: true };

    const g = gScore.get(current)!;
    const h = heuristic(current);
    if (h < bestH || (h === bestH && g < bestG)) {
      best = current;
      bestH = h;
      bestG = g;
    }

    const cx = current % w;
    const cy = Math.floor(current / w);
    for (const [dx, dy] of NEIGHBOURS_8) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!passable(grid, cx, cy, nx, ny, canStep)) continue;
      if (dx !== 0 && dy !== 0) {
        if (!passable(grid, cx, cy, cx + dx, cy, canStep) || !passable(grid, cx, cy, cx, cy + dy, canStep)) continue;
      }
      const ni = grid.index(nx, ny);
      if (closed.has(ni)) continue;
      const ng = g + 1;
      if (ng < (gScore.get(ni) ?? Infinity)) {
        gScore.set(ni, ng);
        cameFrom.set(ni, current);
        // Small tie-break toward straight moves keeps paths looking natural.
        const tieBreak = dx !== 0 && dy !== 0 ? 0.001 : 0;
        open.push(ni, ng + Math.max(0, heuristic(ni) - goalSlack) + tieBreak);
      }
    }
  }

  return { path: rebuild(cameFrom, best, w), reachedGoal: false };
}

function passable(
  grid: WorldGrid,
  fx: number,
  fy: number,
  tx: number,
  ty: number,
  canStep?: PathOptions['canStep'],
): boolean {
  return grid.isWalkable(tx, ty) && (!canStep || canStep(fx, fy, tx, ty));
}

function rebuild(cameFrom: Map<number, number>, end: number, w: number): Point[] {
  const path: Point[] = [];
  let current: number | undefined = end;
  while (current !== undefined && cameFrom.has(current)) {
    path.push({ x: current % w, y: Math.floor(current / w) });
    current = cameFrom.get(current);
  }
  return path.reverse();
}

class MinHeap {
  private items: number[] = [];
  private priorities: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: number, priority: number): void {
    this.items.push(item);
    this.priorities.push(priority);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.priorities[parent] <= this.priorities[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const top = this.items[0];
    const lastItem = this.items.pop()!;
    const lastPriority = this.priorities.pop()!;
    if (this.items.length) {
      this.items[0] = lastItem;
      this.priorities[0] = lastPriority;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let smallest = i;
        if (l < this.items.length && this.priorities[l] < this.priorities[smallest]) smallest = l;
        if (r < this.items.length && this.priorities[r] < this.priorities[smallest]) smallest = r;
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.priorities[a], this.priorities[b]] = [this.priorities[b], this.priorities[a]];
  }
}
