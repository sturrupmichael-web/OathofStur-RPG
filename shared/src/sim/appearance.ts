import type { Rng } from '../rng';

/**
 * How a character looks, picked when they are made and changeable any time.
 * Colours are indices into the palettes below rather than free colours, so
 * every look stays in the game's style and a save can't carry anything odd.
 */
export interface Appearance {
  body: BodyType;
  skin: number;
  hairStyle: HairStyle;
  hair: number;
  beard: boolean;
  shirt: number;
  trousers: number;
  boots: number;
}

export type BodyType = 'male' | 'female';

export const HAIR_STYLES = ['short', 'long', 'bun', 'ponytail', 'spiky', 'none'] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];

export const SKIN_TONES = [0xf2d0b4, 0xe8b896, 0xd9a77e, 0xc08a5e, 0xa06c44, 0x7f5233, 0x5e3c26, 0x47301f];
export const HAIR_COLOURS = [0x1c1612, 0x3a2a1a, 0x5a3a1e, 0x7a3418, 0xb4581e, 0xc8845a, 0xd8b46a, 0xb8a888, 0x8a8a84, 0xe6e2da];
/** Shirts and trousers share one set of dyes. */
export const CLOTH_COLOURS = [0x2f5fb3, 0xb3412f, 0x3f7a3a, 0xc8a040, 0x6a3f8a, 0x2f7a7a, 0x5a4632, 0x6a6a6a, 0x2a2a2e, 0xe0dccf, 0xc06a2a, 0xc0607a];
export const BOOT_COLOURS = [0x3a2618, 0x1e1a16, 0x5a3a22, 0x6a6a6a, 0x2a3a2a, 0x7a2a22];

/** The look characters had before they could choose one. */
export const DEFAULT_APPEARANCE: Appearance = { body: 'male', skin: 2, hairStyle: 'short', hair: 2, beard: false, shirt: 0, trousers: 6, boots: 0 };

/** A sensible random look: townsfolk, and the creator's Random button. */
export function randomAppearance(rng: Pick<Rng, 'next'>): Appearance {
  const pick = (n: number) => Math.floor(rng.next() * n);
  const body: BodyType = rng.next() < 0.5 ? 'male' : 'female';
  const styles: HairStyle[] = body === 'male' ? ['short', 'short', 'spiky', 'long', 'none'] : ['long', 'long', 'bun', 'ponytail', 'short'];
  let trousers = pick(CLOTH_COLOURS.length);
  const shirt = pick(CLOTH_COLOURS.length);
  if (trousers === shirt) trousers = 6;
  return {
    body,
    skin: pick(SKIN_TONES.length),
    hairStyle: styles[pick(styles.length)],
    hair: pick(HAIR_COLOURS.length),
    beard: body === 'male' && rng.next() < 0.3,
    shirt,
    trousers,
    boots: pick(BOOT_COLOURS.length),
  };
}

/** Checks a look from a save or a client. Anything out of range returns null. */
export function parseAppearance(raw: unknown): Appearance | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  const index = (v: unknown, n: number) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < n ? (v as number) : null);
  const body = a.body === 'male' || a.body === 'female' ? a.body : null;
  const hairStyle = HAIR_STYLES.includes(a.hairStyle as HairStyle) ? (a.hairStyle as HairStyle) : null;
  const skin = index(a.skin, SKIN_TONES.length);
  const hair = index(a.hair, HAIR_COLOURS.length);
  const shirt = index(a.shirt, CLOTH_COLOURS.length);
  const trousers = index(a.trousers, CLOTH_COLOURS.length);
  const boots = index(a.boots, BOOT_COLOURS.length);
  if (!body || !hairStyle || skin === null || hair === null || shirt === null || trousers === null || boots === null) return null;
  return { body, skin, hairStyle, hair, beard: a.beard === true, shirt, trousers, boots };
}

/** A name a player may choose: 1 to 12 letters, digits, spaces or hyphens, starting with a letter. */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim().replace(/\s+/g, ' ');
  return /^[A-Za-z][A-Za-z0-9 -]{0,11}$/.test(name) ? name : null;
}
