import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JsonMapSource, type JsonMapFile } from '../src/map/JsonMapSource';
import type { Point } from '../src/map/types';
import type { Entity, MonsterEntity, PlayerEntity } from '../src/sim/entities';
import { addItem, emptyInventory, type Equipment, type Inventory } from '../src/sim/items';
import { parseSave } from '../src/sim/save';
import type { Simulation } from '../src/sim/Simulation';
import { startingXp, xpForLevel, type SkillId } from '../src/sim/skills';

const dir = fileURLToPath(new URL('../data/maps/', import.meta.url));

export function loadWorldFile(): JsonMapFile {
  return JSON.parse(readFileSync(dir + 'vell-reaches.json', 'utf8')) as JsonMapFile;
}

export function loadWorld() {
  return new JsonMapSource('vell-reaches', loadWorldFile()).load();
}

/** Where Kelmoor sits inside the region, so tests can use town coordinates. */
export const KELMOOR = { x: 130, y: 70 };
/** A Kelmoor tile in region coordinates. */
export const kx = (x: number) => x + KELMOOR.x;
export const ky = (y: number) => y + KELMOOR.y;

export function run(sim: Simulation, ticks: number, until?: () => boolean) {
  for (let i = 0; i < ticks; i++) {
    sim.step();
    if (until?.()) return;
  }
}

export function entities(sim: Simulation): Entity[] {
  const out: Entity[] = [];
  for (let id = 1; id < 20000; id++) {
    const e = sim.getEntity(id);
    if (e) out.push(e);
  }
  return out;
}

export function monsters(sim: Simulation, defKey: string): MonsterEntity[] {
  return entities(sim).filter((e): e is MonsterEntity => e.kind === 'monster' && e.defKey === defKey);
}

export interface Setup {
  at: Point;
  levels?: Partial<Record<SkillId, number>>;
  items?: [string, number][];
  equipment?: Equipment;
  hp?: number;
  quests?: Record<string, number>;
}

/** Adds a player through a save, so tests can choose where they stand and what they carry. */
export function addPlayer(sim: Simulation, { at, levels = {}, items = [], equipment = {}, hp, quests = {} }: Setup): PlayerEntity {
  const skills = startingXp();
  for (const [skill, level] of Object.entries(levels)) skills[skill as SkillId] = xpForLevel(level);
  const inventory: Inventory = emptyInventory();
  for (const [itemId, qty] of items) addItem(inventory, itemId, qty);
  const save = parseSave({ version: 3, name: 'Tester', position: at, skills, inventory, equipment, bank: [], quests, hp, createdAt: '', updatedAt: '' })!;
  return sim.getEntity(sim.addPlayer('Tester', save)) as PlayerEntity;
}

/** A walkable tile straight beside a monster. */
export function besides(sim: Simulation, m: MonsterEntity): Point {
  const spot = [{ x: m.x + 1, y: m.y }, { x: m.x - 1, y: m.y }, { x: m.x, y: m.y + 1 }, { x: m.x, y: m.y - 1 }].find(
    (p) => sim.grid.isWalkable(p.x, p.y) && !entities(sim).some((e) => e.kind === 'monster' && e.x === p.x && e.y === p.y),
  );
  if (!spot) throw new Error('no room beside the monster');
  return spot;
}

