import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JsonMapSource, type JsonMapFile } from '../src/map/JsonMapSource';

const dir = fileURLToPath(new URL('../data/maps/', import.meta.url));

export function loadWorld() {
  const file = JSON.parse(readFileSync(dir + 'kelmoor.json', 'utf8')) as JsonMapFile;
  return new JsonMapSource('kelmoor', file).load();
}
