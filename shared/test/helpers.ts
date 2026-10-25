import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AsciiMapSource, type AsciiLegend } from '../src/map/AsciiMapSource';

const dir = fileURLToPath(new URL('../data/maps/', import.meta.url));

export function loadWorld() {
  const text = readFileSync(dir + 'world.txt', 'utf8');
  const legend = JSON.parse(readFileSync(dir + 'legend.json', 'utf8')) as AsciiLegend;
  return new AsciiMapSource('world', text, legend).load();
}
