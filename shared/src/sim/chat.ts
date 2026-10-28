/**
 * Public chat: what a player says reaches everyone near them. The server tidies
 * each line and masks a short list of slurs and the worst swearing; players can
 * block anyone else on their own side.
 */

/** Longest line, in characters. */
export const CHAT_MAX = 80;
/** Tiles away a player can still be heard. */
export const CHAT_RANGE = 16;
/** Ticks between lines from one player. */
export const CHAT_GAP = 2;

// Word stems: a stem matches the word and anything that carries on from it (stem "fuck" catches "fucking").
const STEMS = ['fuck', 'fuk', 'shit', 'cunt', 'bitch', 'bastard', 'pussy', 'whore', 'slut', 'twat', 'wank', 'nigg', 'faggot', 'retard', 'kike', 'tranny', 'wetback', 'rapist'];
// Whole words only, where a stem would catch ordinary words (ass/class, cum/document, spic/spicy, cock/cockatrice).
const WORDS = [
  'ass', 'asshole', 'arse', 'cum', 'hoe', 'hoes', 'tits', 'piss', 'prick', 'coon', 'jizz', 'dick', 'dicks', 'cock', 'cocks',
  'spic', 'spics', 'paki', 'pakis', 'fag', 'fags', 'chink', 'chinks', 'gook', 'gooks', 'dyke', 'dykes', 'rape', 'raped', 'nazi', 'nazis', 'kys',
];

/** Look-alikes people use to slip past a filter. */
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '9': 'g', '@': 'a', $: 's', '!': 'i' };
const fold = (word: string) =>
  word
    .toLowerCase()
    .replace(/[0134579@$!]/g, (c) => LEET[c])
    .replace(/[^a-z]/g, '')
    .replace(/(.)\1+/g, '$1$1');

function rude(word: string): boolean {
  const w = fold(word);
  if (!w) return false;
  const squeezed = w.replace(/(.)\1+/g, '$1');
  return WORDS.includes(w) || WORDS.includes(squeezed) || STEMS.some((s) => w.startsWith(s) || squeezed.startsWith(s));
}

/** Tidies a line for chat: one line, no control characters, not too long. Null when nothing is left. */
export function cleanChat(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CHAT_MAX);
  return text || null;
}

/** Masks rude words with asterisks, keeping the rest of the line as typed. */
export function filterChat(text: string): string {
  return text.replace(/[^\s]+/g, (word) => (rude(word) ? '*'.repeat(word.length) : word));
}

/** Whether a character name is fit to show: no rude word in it, even run together. */
export function decentName(name: string): boolean {
  if (name.split(/[\s-]+/).some(rude)) return false;
  const joined = fold(name);
  return !STEMS.some((s) => s.length >= 4 && joined.includes(s));
}
