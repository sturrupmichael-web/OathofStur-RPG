import glyphData from '../../data/glyphs.json';

export interface GlyphDef {
  id: string;
  /** The glyph item. */
  item: string;
  level: number;
  xp: number;
  /** Each shard makes one more glyph at every multiple of this many levels. */
  every?: number;
}

export const SHARD = glyphData.shard;
export const INSCRIBE_TICKS = glyphData.ticks;

export const GLYPHS: Readonly<Record<string, GlyphDef>> = Object.fromEntries(
  Object.entries(glyphData.glyphs).map(([id, g]) => [id, { id, item: `${id}_glyph`, ...g }]),
);

/** Glyphs made from each shard at a level. */
export function glyphsPerShard(glyph: GlyphDef, level: number): number {
  return glyph.every ? 1 + Math.floor(level / glyph.every) : 1;
}

/** Which glyph a shrine makes, from the name of the area it stands in ("Wind Shrine"). */
export function glyphForArea(areaName: string | undefined): GlyphDef | undefined {
  const m = areaName?.match(/^(\w+) Shrine$/);
  return m ? GLYPHS[m[1].toLowerCase()] : undefined;
}
