import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JsonMapSource, type JsonMapFile } from '../src/map/JsonMapSource';

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
