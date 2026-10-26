import agilityData from '../../data/agility.json';
import type { Point } from '../map/types';

export type ObstacleType = 'log' | 'hurdle' | 'net' | 'rope' | 'stones' | 'pipe' | 'bars' | 'wall';

export interface ObstacleKind {
  name: string;
  /** The menu option: "Walk-across", "Jump-over"... */
  verb: string;
  ticks: number;
  canFail?: boolean;
}

export interface CourseDef {
  id: string;
  name: string;
  level: number;
  lapXp: number;
  /** Damage from a fall, [min, max]. */
  fall: [number, number];
  obstacles: ObstacleDef[];
}

/** One obstacle on a course, worked out from the data: where you start, where you land, which way it faces. */
export interface ObstacleDef {
  course: string;
  /** Position on the course, from 0. */
  index: number;
  type: ObstacleType;
  xp: number;
  x: number;
  y: number;
  /** One tile step in the direction of travel. */
  dir: Point;
  from: Point;
  to: Point;
}

export const OBSTACLE_KINDS: Readonly<Record<ObstacleType, ObstacleKind>> = agilityData.obstacles as Record<ObstacleType, ObstacleKind>;
export const RUN_DRAIN = agilityData.runDrain;

/** Energy a player gets back in a tick they don't run. */
export function energyRestore(agilityLevel: number): number {
  return agilityData.restoreBase + agilityData.restorePerLevel * agilityLevel;
}

/** Chance of falling off a fallible obstacle. */
export function failChance(level: number, courseLevel: number): number {
  const [base, span] = agilityData.failChance;
  return Math.max(0, base * (1 - (level - courseLevel) / span));
}

/**
 * Each obstacle is crossed the way you arrive at it from the one before: the
 * axis that covers more of the way, upright on a tie.
 */
function crossing(prev: Point, at: Point): Point {
  const dx = at.x - prev.x;
  const dy = at.y - prev.y;
  return Math.abs(dy) >= Math.abs(dx) ? { x: 0, y: Math.sign(dy) } : { x: Math.sign(dx), y: 0 };
}

export const COURSES: Readonly<Record<string, CourseDef>> = Object.fromEntries(
  Object.entries(agilityData.courses).map(([id, c]) => {
    const raw = c.obstacles;
    const obstacles = raw.map((o, index): ObstacleDef => {
      const dir = crossing(raw[(index + raw.length - 1) % raw.length], o);
      return {
        course: id,
        index,
        type: o.type as ObstacleType,
        xp: o.xp,
        x: o.x,
        y: o.y,
        dir,
        from: { x: o.x - dir.x, y: o.y - dir.y },
        to: { x: o.x + dir.x, y: o.y + dir.y },
      };
    });
    return [id, { id, name: c.name, level: c.level, lapXp: c.lapXp, fall: c.fall as [number, number], obstacles }];
  }),
);

const BY_TILE = new Map<string, ObstacleDef>(Object.values(COURSES).flatMap((c) => c.obstacles.map((o): [string, ObstacleDef] => [`${o.x},${o.y}`, o])));

/** The obstacle standing on a tile, if any. */
export function obstacleAt(x: number, y: number): ObstacleDef | undefined {
  return BY_TILE.get(`${x},${y}`);
}
