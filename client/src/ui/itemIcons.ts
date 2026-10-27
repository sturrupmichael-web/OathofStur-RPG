/**
 * Inventory icons, drawn as small inline SVGs so the game still ships with
 * no external art. Unknown items fall back to a plain sack.
 */
const axe = (head: string, edge: string) => `
  <rect x="9" y="5" width="4" height="27" rx="1.5" fill="#7a5230" transform="rotate(30 11 18)"/>
  <rect x="9" y="5" width="4" height="27" rx="1.5" fill="none" stroke="#3d2814" stroke-width="1" transform="rotate(30 11 18)"/>
  <path d="M14 4 L26 2 Q31 9 26 16 L15 13 Z" fill="${head}" stroke="#2a2a2a" stroke-width="1.2"/>
  <path d="M26 2 Q31 9 26 16" fill="none" stroke="${edge}" stroke-width="2"/>`;

const logs = (bark: string, wood: string, ring: string) => `
  <g stroke="#2a1a0c" stroke-width="1.1">
    <rect x="4" y="18" width="24" height="9" rx="4.5" fill="${bark}"/>
    <rect x="8" y="9" width="24" height="9" rx="4.5" fill="${bark}"/>
    <ellipse cx="8.5" cy="22.5" rx="3.6" ry="4.5" fill="${wood}"/>
    <ellipse cx="12.5" cy="13.5" rx="3.6" ry="4.5" fill="${wood}"/>
  </g>
  <ellipse cx="8.5" cy="22.5" rx="1.4" ry="1.8" fill="none" stroke="${ring}" stroke-width="0.8"/>
  <ellipse cx="12.5" cy="13.5" rx="1.4" ry="1.8" fill="none" stroke="${ring}" stroke-width="0.8"/>`;

const pickaxe = (head: string) => `
  <rect x="16" y="6" width="4" height="27" rx="1.5" fill="#7a5230" stroke="#3d2814" stroke-width="1" transform="rotate(25 18 19)"/>
  <path d="M4 12 Q18 1 32 10 L30 13 Q18 6 6 15 Z" fill="${head}" stroke="#2a2a2a" stroke-width="1.2"/>`;

const ore = (fleck: string) => `
  <path d="M6 24 L9 12 L19 7 L29 12 L31 23 L22 30 L11 29 Z" fill="#7d776e" stroke="#2f2b26" stroke-width="1.2"/>
  <path d="M9 12 L19 7 L29 12 L19 15 Z" fill="#958e84"/>
  <circle cx="14" cy="19" r="2.6" fill="${fleck}"/><circle cx="22" cy="22" r="2.2" fill="${fleck}"/><circle cx="21" cy="13" r="1.8" fill="${fleck}"/>`;

const bar = (top: string, side: string) => `
  <path d="M6 22 L11 13 L30 13 L30 22 Z" fill="${side}" stroke="#222" stroke-width="1.1"/>
  <path d="M11 13 L15 9 L33 9 L30 13 Z" fill="${top}" stroke="#222" stroke-width="1.1"/>
  <path d="M30 13 L33 9 L33 18 L30 22 Z" fill="${side}" stroke="#222" stroke-width="1.1"/>
  <rect x="9" y="15" width="16" height="2" fill="rgba(255,255,255,.35)"/>`;

const fish = (body: string, belly: string, stripes = '') => `
  <path d="M5 18 Q14 8 25 14 L32 9 L31 18 L32 27 L25 22 Q14 28 5 18 Z" fill="${body}" stroke="#1d1d1d" stroke-width="1.1"/>
  <path d="M8 19 Q15 25 24 21" fill="none" stroke="${belly}" stroke-width="2"/>${stripes}
  <circle cx="10" cy="16" r="1.4" fill="#111"/>`;

const blade = (metal: string, length: number) => `
  <path d="M18 ${32 - length} L21 ${34 - length} L20 26 L16 26 L15 ${34 - length} Z" fill="${metal}" stroke="#222" stroke-width="1"/>
  <rect x="11" y="26" width="14" height="3" rx="1" fill="#6b5a3a" stroke="#222" stroke-width="0.8"/>
  <rect x="16.5" y="29" width="3" height="5" fill="#5a3a20"/>`;

const helm = (metal: string, dark: string) => `
  <path d="M7 24 Q7 7 18 6 Q29 7 29 24 Z" fill="${metal}" stroke="#222" stroke-width="1.2"/>
  <path d="M7 24 L29 24 L29 21 L7 21 Z" fill="${dark}" stroke="#222" stroke-width="1"/>
  <rect x="16.5" y="18" width="3" height="11" fill="${dark}" stroke="#222" stroke-width="0.8"/>
  <path d="M11 13 Q14 9 18 9" fill="none" stroke="rgba(255,255,255,.45)" stroke-width="1.5"/>`;

const chainbody = (metal: string, dark: string) => `
  <path d="M8 9 L14 6 Q18 9 22 6 L28 9 L32 17 L27 19 L26 31 L10 31 L9 19 L4 17 Z" fill="${metal}" stroke="#222" stroke-width="1.2"/>
  <g stroke="${dark}" stroke-width="0.9" fill="none">
    <path d="M10 14 H26 M10 18 H26 M10 22 H26 M10 26 H26"/>
    <path d="M12 12 V30 M16 12 V30 M20 12 V30 M24 12 V30" stroke-dasharray="1.5 2"/>
  </g>`;

const platelegs = (metal: string, dark: string) => `
  <path d="M9 5 L27 5 L28 12 L26 32 L20 32 L18 15 L16 32 L10 32 L8 12 Z" fill="${metal}" stroke="#222" stroke-width="1.2"/>
  <path d="M8 9 H28" stroke="${dark}" stroke-width="2"/>
  <path d="M12 20 L14 20 M22 20 L24 20" stroke="rgba(255,255,255,.4)" stroke-width="1.5"/>`;

const shield = (metal: string, dark: string) => `
  <path d="M18 3 L30 8 L28 20 L18 33 L8 20 L6 8 Z" fill="${metal}" stroke="#222" stroke-width="1.3"/>
  <path d="M18 6 L27 10 L25.5 19 L18 29 L10.5 19 L9 10 Z" fill="none" stroke="${dark}" stroke-width="1.2"/>
  <circle cx="18" cy="15" r="2.6" fill="${dark}" stroke="#222" stroke-width="0.8"/>`;

const meat = (outer: string, inner: string) => `
  <path d="M6 20 Q6 8 18 8 Q30 9 29 19 Q27 29 16 29 Q7 28 6 20 Z" fill="${outer}" stroke="#2a1410" stroke-width="1.2"/>
  <path d="M11 19 Q12 13 18 13 Q24 14 23 19 Q21 24 16 24 Q12 23 11 19 Z" fill="${inner}"/>
  <path d="M26 24 L32 31" stroke="#e8e0d0" stroke-width="3" stroke-linecap="round"/>`;

/** A bow drawn on the diagonal; unstrung ones have no string and a plain grip. */
const bow = (wood: string, dark: string, long: boolean, strung: boolean) => {
  const [a, b] = long ? [3, 33] : [7, 29];
  return `
  <path d="M${a} ${a + 2} Q${long ? 26 : 24} ${long ? 10 : 12} ${b - 2} ${b}" fill="none" stroke="${dark}" stroke-width="${long ? 4.2 : 4.6}" stroke-linecap="round"/>
  <path d="M${a} ${a + 2} Q${long ? 26 : 24} ${long ? 10 : 12} ${b - 2} ${b}" fill="none" stroke="${wood}" stroke-width="${long ? 2.6 : 3}" stroke-linecap="round"/>
  ${strung ? `<path d="M${a} ${a + 2} L${b - 2} ${b}" stroke="#ece6d2" stroke-width="0.9"/>` : ''}
  <path d="M${long ? 18.6 : 18} ${long ? 13.4 : 15} l3 3" stroke="#4a3020" stroke-width="${strung ? 4 : 0}" stroke-linecap="round"/>`;
};

/** A stack of arrows; `head` is the tip colour, or none for headless ones. */
const arrows = (head: string | null, fletch = '#e8e2d4') => [0, 4, 8]
  .map((o) => `
  <path d="M${5 + o} ${29 - o * 0.2} L${27 + o * 0.2} ${7 + o}" stroke="#b08a5a" stroke-width="1.6"/>
  <path d="M${5 + o} ${29 - o * 0.2} l1 -6 l2.5 2.5 Z M${5 + o} ${29 - o * 0.2} l6 -1 l-2.5 -2.5 Z" fill="${fletch}" stroke="#6a6458" stroke-width="0.5"/>
  ${head ? `<path d="M${27 + o * 0.2} ${7 + o} l-1.5 4.5 l-3 -3 Z" fill="${head}" stroke="#222" stroke-width="0.7"/>` : ''}`)
  .join('');

const arrowheads = (metal: string) => [[9, 22], [19, 14], [22, 25]]
  .map(([x, y]) => `<path d="M${x} ${y - 6} L${x + 4} ${y + 3} L${x} ${y + 1} L${x - 4} ${y + 3} Z" fill="${metal}" stroke="#222" stroke-width="0.9"/>`)
  .join('');

/** A herb sprig. Grimy ones are darker and flecked with dirt. */
const herb = (leaf: string, vein: string, grimy: boolean) => `
  <path d="M18 33 Q17 22 18 12" stroke="${grimy ? '#4a3a22' : '#4a6a22'}" stroke-width="1.6" fill="none"/>
  <g stroke="${grimy ? '#2a2014' : '#2a3a12'}" stroke-width="1" fill="${leaf}">
    <path d="M18 14 Q8 12 6 4 Q15 4 18 14 Z"/><path d="M18 14 Q28 12 30 4 Q21 4 18 14 Z"/>
    <path d="M18 22 Q7 22 4 14 Q14 13 18 22 Z"/><path d="M18 22 Q29 22 32 14 Q22 13 18 22 Z"/>
    <path d="M18 12 Q14 6 18 1 Q22 6 18 12 Z"/>
  </g>
  <path d="M18 14 L9 7 M18 14 L27 7 M18 22 L8 16 M18 22 L28 16" stroke="${vein}" stroke-width="0.7"/>
  ${grimy ? '<g fill="#4a3a1e"><circle cx="9" cy="8" r="1.3"/><circle cx="26" cy="9" r="1.1"/><circle cx="10" cy="18" r="1.4"/><circle cx="25" cy="19" r="1.2"/><circle cx="18" cy="6" r="1"/><circle cx="20" cy="27" r="1.3"/></g>' : ''}`;

/** A glass vial, filled to `level` (0..1) with `liquid`. */
const vial = (liquid: string | null, level: number) => {
  const top = 30 - 18 * level;
  return `
  <path d="M13 9 L13 12 Q8 16 8 22 Q8 31 18 31 Q28 31 28 22 Q28 16 23 12 L23 9 Z" fill="rgba(210,235,245,.35)" stroke="#3a4a52" stroke-width="1.2"/>
  ${liquid ? `<path d="M9 ${Math.max(top, 14)} Q18 ${Math.max(top, 14) + 2} 27 ${Math.max(top, 14)} Q28 30 18 30.5 Q8 30 9 ${Math.max(top, 14)} Z" fill="${liquid}" opacity=".9"/>` : ''}
  <rect x="12" y="5" width="12" height="5" rx="1.5" fill="#9a7448" stroke="#3d2c14" stroke-width="1"/>
  <path d="M12 16 Q10 20 11 25" stroke="rgba(255,255,255,.7)" stroke-width="1.4" fill="none"/>`;
};

const bones = (scale: number, color: string) => `
  <g transform="translate(18 18) scale(${scale}) rotate(-35) translate(-18 -18)" fill="${color}" stroke="#5a5040" stroke-width="1.1">
    <rect x="9" y="15.5" width="18" height="5" rx="2"/>
    <circle cx="8" cy="15" r="3.4"/><circle cx="8" cy="21" r="3.4"/><circle cx="28" cy="15" r="3.4"/><circle cx="28" cy="21" r="3.4"/>
  </g>`;

/** Potions by what they do. */
const POTION_COLOURS: Record<string, string> = {
  attack: '#e8a030',
  strength: '#c8443a',
  devotion: '#9fd4ff',
  defence: '#4aa05a',
  ranging: '#3aa8b0',
  fireward: '#a050c8',
};
/** Leaf and vein colours for each herb. */
const HERB_COLOURS: Record<string, [string, string]> = {
  sunleaf: ['#e8c840', '#9a7a10'],
  marshwort: ['#5a8a3a', '#2a4a1a'],
  duskroot: ['#5a3a5a', '#2a1a2a'],
  silverfern: ['#b8c8c8', '#6a7a7a'],
  hawkweed: ['#8aa83a', '#3a4a12'],
  emberbloom: ['#d8402a', '#7a1a0a'],
};

const HERBLORE_ICONS: Record<string, string> = Object.fromEntries([
  ...Object.entries(HERB_COLOURS).flatMap(([id, [leaf, vein]]) => [
    [id, herb(leaf, vein, false)],
    [`grimy_${id}`, herb(shade(leaf), vein, true)],
    [`${id}_potion_unf`, vial(mixColour(leaf), 0.85)],
  ]),
  ...Object.entries(POTION_COLOURS).flatMap(([id, colour]) => [1, 2, 3].map((d) => [`${id}_potion${d}`, vial(colour, d / 3.3)])),
]);

/** A darker, muddier version of a colour. */
function shade(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const mud = [0x5a, 0x4a, 0x2a];
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v, i) => Math.round(v * 0.55 + mud[i] * 0.45));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Herb steeping in water: its colour, clouded. */
function mixColour(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const water = [0x9a, 0xb8, 0x8a];
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v, i) => Math.round(v * 0.5 + water[i] * 0.5));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Each glyph's mark, carved on a pale stone and coloured like its shrine. */
const GLYPH_MARKS: Record<string, [string, string]> = {
  wind: ['#9ad0e0', 'M11 15 Q18 11 25 15 M11 19 Q18 15 25 19 M13 23 Q18 20 23 23'],
  thought: ['#c08ad8', 'M18 10 L18 26 M12 14 L24 22 M24 14 L12 22'],
  tide: ['#3a7ad0', 'M10 20 Q14 14 18 20 Q22 26 26 20'],
  root: ['#8a6a3a', 'M18 10 L18 20 M18 20 L12 26 M18 20 L24 26 M18 16 L14 13'],
  ember: ['#e05a20', 'M18 9 Q24 15 21 22 Q19 26 18 27 Q13 23 15 17 Q17 20 18 18 Q16 13 18 9 Z'],
  vigour: ['#d8c030', 'M18 26 Q10 20 12 14 Q15 11 18 15 Q21 11 24 14 Q26 20 18 26 Z'],
  bloom: ['#4aa83a', 'M18 26 L18 16 M18 16 Q12 14 13 9 Q18 10 18 16 Q18 10 23 9 Q24 14 18 16'],
  star: ['#a8b0d8', 'M18 9 L20 16 L27 18 L20 20 L18 27 L16 20 L9 18 L16 16 Z'],
  storm: ['#6a80e8', 'M20 8 L13 19 L18 19 L15 28 L24 16 L19 16 Z'],
  dusk: ['#5a3a8a', 'M22 10 Q12 12 13 19 Q14 26 23 26 Q16 23 16 18 Q16 13 22 10 Z'],
  oath: ['#c8a040', 'M12 12 L24 12 L24 24 L12 24 Z M12 12 L24 24 M24 12 L12 24'],
  crimson: ['#b02030', 'M18 9 Q26 18 18 27 Q10 18 18 9 Z M18 14 L18 22'],
};
const glyph = ([colour, mark]: [string, string]) => `
  <ellipse cx="18" cy="19" rx="12" ry="11.5" fill="#d8d0c0" stroke="#5a5448" stroke-width="1.2"/>
  <ellipse cx="17" cy="17" rx="9" ry="8" fill="#e8e2d4" opacity=".6"/>
  <path d="${mark}" fill="none" stroke="${colour}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;

/** A paper packet of seeds, showing what grows from them. */
const seedPacket = (picture: string) => `
  <path d="M9 7 L27 7 L27 31 L9 31 Z" fill="#e8dcbc" stroke="#6a5a3a" stroke-width="1.2"/>
  <path d="M9 7 L27 7 L25 10 L11 10 Z" fill="#c8b48a" stroke="#6a5a3a" stroke-width="1"/>
  <g transform="translate(18 20) scale(.55) translate(-18 -18)">${picture}</g>`;
/** A pinch of herb seeds. */
const herbSeeds = (colour: string) => `
  <g fill="${colour}" stroke="#3a2a14" stroke-width=".8">
    <ellipse cx="14" cy="20" rx="3" ry="2.2"/><ellipse cx="21" cy="18" rx="3" ry="2.2" transform="rotate(30 21 18)"/>
    <ellipse cx="18" cy="25" rx="3" ry="2.2" transform="rotate(-20 18 25)"/><ellipse cx="23" cy="25" rx="2.6" ry="2"/><ellipse cx="12" cy="26" rx="2.6" ry="2"/>
  </g>`;

const PRODUCE: Record<string, string> = {
  potato: `<path d="M8 20 Q8 11 18 11 Q29 11 29 19 Q29 28 18 28 Q8 28 8 20 Z" fill="#b08a54" stroke="#5a3a1a" stroke-width="1.2"/><g fill="#7a5a2a"><circle cx="14" cy="17" r="1"/><circle cx="22" cy="22" r="1"/><circle cx="20" cy="15" r=".8"/></g>`,
  onion: `<path d="M18 9 Q30 18 25 27 Q18 32 11 27 Q6 18 18 9 Z" fill="#d8b070" stroke="#6a4a1a" stroke-width="1.2"/><path d="M18 9 Q16 4 18 2 Q20 4 18 9" stroke="#6a8a3a" stroke-width="1.6" fill="#8aa84a"/><path d="M14 14 Q12 21 15 28 M22 14 Q24 21 21 28" stroke="#b08a4a" stroke-width=".9" fill="none"/>`,
  cabbage: `<circle cx="18" cy="19" r="11" fill="#8ac85a" stroke="#3a6a2a" stroke-width="1.2"/><path d="M18 8 Q12 18 18 30 M9 14 Q16 18 13 28 M27 14 Q20 18 23 28" stroke="#5a9a3a" stroke-width="1.1" fill="none"/>`,
  tomato: `<circle cx="18" cy="20" r="10" fill="#d8302a" stroke="#6a1a10" stroke-width="1.2"/><path d="M12 11 L18 13 L24 11 L20 14 L22 17 L18 15 L14 17 L16 14 Z" fill="#4a8a3a" stroke="#2a4a1a" stroke-width=".8"/><ellipse cx="14" cy="18" rx="2" ry="3" fill="#ff8070" opacity=".6"/>`,
  sweetcorn: `<path d="M18 4 Q25 10 24 21 Q22 30 18 32 Q14 30 12 21 Q11 10 18 4 Z" fill="#f0d040" stroke="#7a6010" stroke-width="1.1"/><path d="M15 9 L15 28 M18 6 L18 31 M21 9 L21 28 M13 14 L23 14 M12 19 L24 19 M13 24 L23 24" stroke="#c8a020" stroke-width=".7"/><path d="M18 32 Q8 26 9 12 Q13 22 18 32 Z M18 32 Q28 26 27 12 Q23 22 18 32 Z" fill="#8ab84a" stroke="#3a6a2a" stroke-width="1"/>`,
  strawberry: `<path d="M18 31 Q8 22 9 14 Q12 10 18 11 Q24 10 27 14 Q28 22 18 31 Z" fill="#e02a3a" stroke="#6a0a1a" stroke-width="1.2"/><path d="M12 10 L18 12 L24 10 L21 7 L18 9 L15 7 Z" fill="#4a8a3a" stroke="#2a4a1a" stroke-width=".8"/><g fill="#ffe08a"><circle cx="14" cy="16" r=".8"/><circle cx="19" cy="15" r=".8"/><circle cx="23" cy="17" r=".8"/><circle cx="16" cy="21" r=".8"/><circle cx="21" cy="22" r=".8"/><circle cx="18" cy="26" r=".8"/></g>`,
  watermelon: `<ellipse cx="18" cy="19" rx="14" ry="11" fill="#3a8a2a" stroke="#1a4a10" stroke-width="1.2"/><path d="M8 13 Q12 19 9 26 M14 9 Q17 19 14 29 M22 9 Q19 19 22 29 M28 13 Q24 19 27 26" stroke="#2a6a1a" stroke-width="2" fill="none"/>`,
};

const SKILL_ICONS: Record<string, string> = {
  ...Object.fromEntries(Object.entries(GLYPH_MARKS).map(([id, m]) => [`${id}_glyph`, glyph(m)])),
  ...PRODUCE,
  ...Object.fromEntries(Object.entries(PRODUCE).map(([id, picture]) => [`${id}_seed`, seedPacket(picture)])),
  ...Object.fromEntries(Object.entries(HERB_COLOURS).map(([id, [leaf]]) => [`${id}_seed`, herbSeeds(shade(leaf))])),
  baked_potato: `<path d="M8 20 Q8 11 18 11 Q29 11 29 19 Q29 28 18 28 Q8 28 8 20 Z" fill="#8a5a2a" stroke="#3a2210" stroke-width="1.2"/><path d="M12 17 Q18 23 25 17 Q22 14 18 15 Q14 14 12 17 Z" fill="#f4e8b8" stroke="#c8a860" stroke-width=".8"/><rect x="16" y="15" width="4" height="3" rx="1" fill="#ffe060"/>`,
  cooked_sweetcorn: `<path d="M18 4 Q25 10 24 21 Q22 30 18 32 Q14 30 12 21 Q11 10 18 4 Z" fill="#e8a830" stroke="#7a5010" stroke-width="1.1"/><path d="M15 9 L15 28 M18 6 L18 31 M21 9 L21 28 M13 14 L23 14 M12 19 L24 19 M13 24 L23 24" stroke="#b88010" stroke-width=".7"/><path d="M14 12 Q16 10 18 12" stroke="#fff4b0" stroke-width="1.4" fill="none"/>`,
  aether_shard: `<path d="M18 3 L26 14 L21 33 L12 28 L10 13 Z" fill="#cfe8ff" stroke="#3a5a7a" stroke-width="1.2"/><path d="M18 3 L18 20 L21 33 M10 13 L18 20 L26 14" stroke="#8ab0d8" stroke-width=".9" fill="none"/><path d="M14 10 L16 18" stroke="#fff" stroke-width="1.4" opacity=".8"/>`,
  rake: `<path d="M27 4 L10 25" stroke="#8a6a42" stroke-width="2.4" stroke-linecap="round"/><path d="M4 21 L15 31" stroke="#6c6e74" stroke-width="2.4" stroke-linecap="round"/><path d="M5 22 L3 25 M8 25 L6 28 M11 28 L9 31 M14 31 L12 34" stroke="#6c6e74" stroke-width="1.6" stroke-linecap="round"/>`,
  spade: `<path d="M28 4 L14 20" stroke="#8a6a42" stroke-width="2.4" stroke-linecap="round"/><path d="M25 3 L31 8" stroke="#5a3a20" stroke-width="2.4" stroke-linecap="round"/><path d="M14 17 L19 22 L11 31 Q6 32 5 31 Q4 26 6 25 Z" fill="#9a9ca4" stroke="#3a3c42" stroke-width="1.2"/>`,
  seed_dibber: `<path d="M24 6 L10 28" stroke="#9a7448" stroke-width="3" stroke-linecap="round"/><path d="M10 28 L7 33" stroke="#6a4a28" stroke-width="2" stroke-linecap="round"/><path d="M22 6 Q27 3 29 8 Q26 10 24 9 Z" fill="#7a5230" stroke="#3a2210" stroke-width="1"/>`,
  bucket: `<path d="M8 12 L28 12 L25 31 L11 31 Z" fill="#9a7048" stroke="#3d2c14" stroke-width="1.2"/><path d="M9 18 L27 18 M10 25 L26 25" stroke="#6c6e74" stroke-width="1.6"/><ellipse cx="18" cy="12" rx="10" ry="2.5" fill="#3a2a1a" stroke="#3d2c14" stroke-width="1"/><path d="M8 12 Q18 0 28 12" stroke="#6c6e74" stroke-width="1.4" fill="none"/>`,
  compost: `<path d="M8 12 L28 12 L25 31 L11 31 Z" fill="#9a7048" stroke="#3d2c14" stroke-width="1.2"/><path d="M9 18 L27 18 M10 25 L26 25" stroke="#6c6e74" stroke-width="1.6"/><path d="M8 12 Q12 7 16 10 Q19 6 23 9 Q27 8 28 12 Z" fill="#4a3424" stroke="#2a1a10" stroke-width="1"/><path d="M8 12 Q18 0 28 12" stroke="#6c6e74" stroke-width="1.4" fill="none"/>`,
  plant_cure: vial('#6ad84a', 0.8),
};

/** A staff on the diagonal, with its element's orb (or a plain knob) at the head. */
const staff = (orb: string | null) => `<path d="M7 32 L25 10" stroke="#6b4428" stroke-width="3" stroke-linecap="round"/><path d="M7 32 L9 29.6" stroke="#55575c" stroke-width="3.4" stroke-linecap="round"/>
  ${orb ? `<path d="M23 12 Q21 7 24 5 M25 10 Q30 9 31 6 M24 11 Q27 6 30 7" fill="none" stroke="#6b4428" stroke-width="1.4" stroke-linecap="round"/><circle cx="27" cy="7" r="4.2" fill="${orb}" stroke="#2a2a3a" stroke-width="1"/><circle cx="25.6" cy="5.6" r="1.3" fill="#fff" opacity=".8"/>` : '<circle cx="26" cy="9" r="2.6" fill="#8a5a32" stroke="#3d2814"/>'}`;
/** Pointed hat, robe top and long skirt, in a set's cloth and trim. */
const wizardHat = (cloth: string, trim: string) => `<path d="M18 3 Q20 10 25 22 L11 22 Q16 10 18 3 Z" fill="${cloth}" stroke="#1a1a2a" stroke-width="1.2" stroke-linejoin="round"/><ellipse cx="18" cy="24" rx="14" ry="4" fill="${cloth}" stroke="#1a1a2a" stroke-width="1.2"/><path d="M11.5 21 Q18 23.5 24.5 21" fill="none" stroke="${trim}" stroke-width="2"/><path d="M17 10 L18.4 12.4 L21 12.6 L19 14.2 L19.7 16.8 L17.5 15.4" fill="${trim}"/>`;
const wizardRobe = (cloth: string, trim: string) => `<path d="M11 6 L25 6 L31 13 L28 17 L26 15 L27 31 L9 31 L10 15 L8 17 L5 13 Z" fill="${cloth}" stroke="#1a1a2a" stroke-width="1.2" stroke-linejoin="round"/><path d="M14 6 L18 12 L22 6" fill="none" stroke="${trim}" stroke-width="1.6"/><path d="M18 12 V31" stroke="${trim}" stroke-width="1.4"/><path d="M9 29.5 H27" stroke="${trim}" stroke-width="2"/>`;
const wizardSkirt = (cloth: string, trim: string) => `<path d="M11 5 H25 L29 31 H7 Z" fill="${cloth}" stroke="#1a1a2a" stroke-width="1.2" stroke-linejoin="round"/><path d="M11 7 H25" stroke="${trim}" stroke-width="2"/><path d="M7.6 29 H28.4" stroke="${trim}" stroke-width="2"/><path d="M15 9 L13 29 M21 9 L23 29" stroke="#000" stroke-opacity=".25" stroke-width="1"/>`;

const ICONS: Record<string, string> = {
  ...SKILL_ICONS,
  staff: staff(null),
  wind_staff: staff('#e8f6ff'),
  tide_staff: staff('#3d8bff'),
  root_staff: staff('#7aa840'),
  ember_staff: staff('#ff6a1a'),
  wizard_hat: wizardHat('#2b3f9e', '#d8dcf0'),
  wizard_robe: wizardRobe('#2b3f9e', '#d8dcf0'),
  wizard_skirt: wizardSkirt('#2b3f9e', '#d8dcf0'),
  starweave_hat: wizardHat('#4b2a7a', '#e0c060'),
  starweave_robe: wizardRobe('#4b2a7a', '#e0c060'),
  starweave_skirt: wizardSkirt('#4b2a7a', '#e0c060'),
  shortbow_u: bow('#a8743e', '#5a3a1e', false, false),
  shortbow: bow('#a8743e', '#5a3a1e', false, true),
  longbow_u: bow('#a8743e', '#5a3a1e', true, false),
  longbow: bow('#a8743e', '#5a3a1e', true, true),
  oak_shortbow_u: bow('#c89452', '#6a4422', false, false),
  oak_shortbow: bow('#c89452', '#6a4422', false, true),
  oak_longbow_u: bow('#c89452', '#6a4422', true, false),
  oak_longbow: bow('#c89452', '#6a4422', true, true),
  willow_shortbow_u: bow('#d8b878', '#7a5c30', false, false),
  willow_shortbow: bow('#d8b878', '#7a5c30', false, true),
  willow_longbow_u: bow('#d8b878', '#7a5c30', true, false),
  willow_longbow: bow('#d8b878', '#7a5c30', true, true),
  yew_shortbow_u: bow('#8a4626', '#3a1a0c', false, false),
  yew_shortbow: bow('#8a4626', '#3a1a0c', false, true),
  yew_longbow_u: bow('#8a4626', '#3a1a0c', true, false),
  yew_longbow: bow('#8a4626', '#3a1a0c', true, true),
  bronze_arrow: arrows('#c88a4a'),
  bronze_arrowheads: arrowheads('#c88a4a'),
  iron_arrow: arrows('#9a9ca4'),
  iron_arrowheads: arrowheads('#9a9ca4'),
  steel_arrow: arrows('#c9d3dd'),
  steel_arrowheads: arrowheads('#c9d3dd'),
  cobalt_arrow: arrows('#4a6fc4'),
  verdite_arrow: arrows('#3a7a58'),
  glacite_arrow: arrows('#a8dcef'),
  cobalt_arrowheads: arrowheads('#4a6fc4'),
  verdite_arrowheads: arrowheads('#3a7a58'),
  glacite_arrowheads: arrowheads('#a8dcef'),
  headless_arrow: arrows(null),
  arrow_shaft: `<g stroke="#8a6a3e" stroke-width="1.8" stroke-linecap="round"><path d="M6 28 L28 8"/><path d="M9 31 L31 11"/><path d="M5 23 L24 5"/></g>`,
  feathers: `<g stroke="#6a6458" stroke-width="0.9"><path d="M8 30 Q10 12 24 5 Q20 18 8 30 Z" fill="#d8d4cc"/><path d="M14 31 Q18 15 31 10 Q25 23 14 31 Z" fill="#ecebe6"/></g><path d="M8 30 L22 8 M14 31 L29 12" stroke="#9a948a" stroke-width="0.7"/>`,
  bowstring: `<path d="M18 6 C30 6 30 16 18 16 C6 16 6 26 18 26 C28 26 28 32 20 32" fill="none" stroke="#ece6d2" stroke-width="1.6"/><path d="M18 6 C30 6 30 16 18 16 C6 16 6 26 18 26" fill="none" stroke="#8a8270" stroke-width="0.5" transform="translate(.6 .6)"/>`,
  sunspire_seal: `<circle cx="18" cy="18" r="12" fill="#e8b830" stroke="#7a5a10" stroke-width="1.4"/><circle cx="18" cy="18" r="8.5" fill="none" stroke="#9a7418" stroke-width="1"/><path d="M18 11 L19.6 16.2 L25 16.2 L20.7 19.4 L22.3 24.6 L18 21.4 L13.7 24.6 L15.3 19.4 L11 16.2 L16.4 16.2 Z" fill="#fff0a8" stroke="#9a7418" stroke-width="0.6"/>`,
  tinderbox: `<rect x="7" y="13" width="22" height="14" rx="2" fill="#7a5230" stroke="#2a1a0c" stroke-width="1.2"/><rect x="7" y="13" width="22" height="4" fill="#5a3a20"/><path d="M12 9 L22 9 L23 12 L11 12 Z" fill="#8a8c92" stroke="#222" stroke-width="0.8"/><circle cx="25" cy="7" r="1.2" fill="#ffb030"/><circle cx="28" cy="10" r="0.9" fill="#ffd060"/>`,
  ashes: `<path d="M5 28 Q9 15 18 13 Q27 15 31 28 Z" fill="#9a958e" stroke="#4a4642" stroke-width="1.1"/><path d="M10 26 Q14 20 18 21 M21 24 Q24 20 27 25" stroke="#c8c4bc" stroke-width="1.2" fill="none"/><circle cx="15" cy="24" r="1.4" fill="#3a3430"/>`,
  knife: `<path d="M8 28 L22 10 Q26 7 27 9 L13 30 Z" fill="#c9d3dd" stroke="#222" stroke-width="1"/><path d="M13 30 L8 35 L5 32 L10 27 Z" fill="#5a3a20" stroke="#222" stroke-width="0.9"/>`,
  bronze_helm: helm('#c88a4a', '#8a5a2a'),
  iron_helm: helm('#9a9ca4', '#5f6168'),
  steel_helm: helm('#c9d3dd', '#8a96a2'),
  cobalt_helm: helm('#4a6fc4', '#2a3f80'),
  verdite_helm: helm('#3a7a58', '#1e4430'),
  glacite_helm: helm('#a8dcef', '#5a9ab8'),
  bronze_chainbody: chainbody('#c88a4a', '#7a4a1e'),
  iron_chainbody: chainbody('#9a9ca4', '#55575e'),
  steel_chainbody: chainbody('#c9d3dd', '#7d8996'),
  cobalt_chainbody: chainbody('#4a6fc4', '#2a3f80'),
  verdite_chainbody: chainbody('#3a7a58', '#1e4430'),
  glacite_chainbody: chainbody('#a8dcef', '#5a9ab8'),
  bronze_platelegs: platelegs('#c88a4a', '#8a5a2a'),
  iron_platelegs: platelegs('#9a9ca4', '#5f6168'),
  steel_platelegs: platelegs('#c9d3dd', '#8a96a2'),
  cobalt_platelegs: platelegs('#4a6fc4', '#2a3f80'),
  verdite_platelegs: platelegs('#3a7a58', '#1e4430'),
  glacite_platelegs: platelegs('#a8dcef', '#5a9ab8'),
  bronze_shield: shield('#c88a4a', '#8a5a2a'),
  iron_shield: shield('#9a9ca4', '#5f6168'),
  steel_shield: shield('#c9d3dd', '#8a96a2'),
  cobalt_shield: shield('#4a6fc4', '#2a3f80'),
  verdite_shield: shield('#3a7a58', '#1e4430'),
  glacite_shield: shield('#a8dcef', '#5a9ab8'),
  raw_beef: meat('#c8424a', '#e88a8a'),
  beef: meat('#8a4a24', '#c88a52'),
  burnt_meat: meat('#2a2018', '#3d3024'),
  cowhide: `<path d="M6 8 L14 5 L22 7 L30 5 L31 15 L28 22 L31 30 L20 28 L12 31 L5 27 L8 19 Z" fill="#f0ece2" stroke="#3d2c14" stroke-width="1.2"/>
    <path d="M12 10 Q17 9 17 14 Q14 18 11 15 Z M21 18 Q27 17 26 22 Q22 25 20 22 Z M9 22 Q12 21 12 24 Q10 26 8 25 Z" fill="#2a2420"/>`,
  crimson_feathers: `<g stroke="#5a0a0e" stroke-width="0.9"><path d="M8 30 Q10 12 24 5 Q20 18 8 30 Z" fill="#c8262a"/><path d="M14 31 Q18 15 31 10 Q25 23 14 31 Z" fill="#e0403a"/></g>
    <path d="M8 30 L20 11 M14 31 L27 14" stroke="#f0c0a0" stroke-width="0.8"/>`,
  lizard_scales: `<g stroke="#5a4012" stroke-width="1"><path d="M6 20 Q10 12 16 18 Q11 24 6 20 Z" fill="#d8b050"/><path d="M15 12 Q20 4 26 10 Q21 17 15 12 Z" fill="#e8c860"/><path d="M17 26 Q22 18 29 24 Q23 31 17 26 Z" fill="#c8a040"/></g>`,
  drake_scale: `<path d="M18 4 Q31 10 29 22 Q26 31 18 33 Q10 31 7 22 Q5 10 18 4 Z" fill="#5a2018" stroke="#1a0806" stroke-width="1.3"/>
    <path d="M18 8 Q27 13 25 22 Q23 28 18 29 Q13 28 11 22 Q9 13 18 8 Z" fill="#8a3018"/>
    <path d="M18 9 L18 28 M13 15 Q18 19 23 15 M12 21 Q18 25 24 21" stroke="#ff8a2a" stroke-width="1.2" fill="none"/>`,
  duskfang: `<path d="M24 5 Q29 9 26 16 L15 27 L11 23 L22 12 Q25 9 24 5 Z" fill="#e2d6be" stroke="#3a2e22" stroke-width="1.1"/><path d="M23 8 Q25 11 21 15" stroke="#8a7aa8" stroke-width="1" fill="none"/>
    <path d="M11 23 L15 27 L9 33 Q6 33 5 31 Q5 29 7 27 Z" fill="#3a2a40" stroke="#1a1018" stroke-width="1"/><path d="M9 25 L13 29" stroke="#a88ac8" stroke-width="1"/>`,
  wolf_pelt: `<path d="M5 12 Q9 6 16 8 L22 6 Q29 7 31 13 L29 20 L32 27 Q26 31 18 29 Q10 31 5 27 L8 20 Z" fill="#9aa0a6" stroke="#3a3e44" stroke-width="1.2"/>
    <path d="M9 14 Q14 12 18 15 M18 15 Q23 12 27 15 M10 22 Q15 20 18 23 M18 23 Q22 20 26 23" stroke="#e8ecf0" stroke-width="1" fill="none"/><path d="M16 8 L18 4 L20 7" fill="#7a8088" stroke="#3a3e44" stroke-width="0.8"/>`,
  cinder_blade: blade('#5a2018', 26) + '<path d="M18 9 L18.8 25" stroke="#ff7a1a" stroke-width="1.4"/>',
  drakescale_shield: shield('#a8401e', '#5a1e14') + '<path d="M12 12 Q18 15 24 12 M11 17 Q18 20 25 17 M13 22 Q18 25 23 22" stroke="#5a1e14" stroke-width="1" fill="none"/>',
  bronze_axe: axe('#b8793a', '#f0c48a'),
  iron_axe: axe('#7d7f86', '#d8dbe2'),
  steel_axe: axe('#a9b3bd', '#f2f6fa'),
  cobalt_axe: axe('#4a6fc4', '#a8c0f4'),
  verdite_axe: axe('#3a7a58', '#8fd0a8'),
  glacite_axe: axe('#a8dcef', '#f0fcff'),
  bronze_pickaxe: pickaxe('#b8793a'),
  iron_pickaxe: pickaxe('#7d7f86'),
  steel_pickaxe: pickaxe('#a9b3bd'),
  cobalt_pickaxe: pickaxe('#4a6fc4'),
  verdite_pickaxe: pickaxe('#3a7a58'),
  glacite_pickaxe: pickaxe('#a8dcef'),
  logs: logs('#6b4a2b', '#d9b47c', '#9a7646'),
  ashwood_logs: logs('#8d857c', '#ece3d2', '#b9ad98'),
  oak_logs: logs('#5e3f24', '#d6a765', '#8a6236'),
  willow_logs: logs('#6f5a3a', '#e0c796', '#a88b56'),
  yew_logs: logs('#3f2b1a', '#b08a5c', '#7a5a34'),
  starwood_logs: logs('#d8d0c0', '#cdf6ef', '#7fd8c8'),
  copper_ore: ore('#d07a3a'),
  tin_ore: ore('#d4d8e0'),
  iron_ore: ore('#9a5238'),
  gold_ore: ore('#f0c840'),
  cobalt_ore: ore('#3a5ad0'),
  verdite_ore: ore('#2f8a5a'),
  glacite_ore: ore('#8fe0ff'),
  coal: `<path d="M6 24 L9 12 L19 7 L29 12 L31 23 L22 30 L11 29 Z" fill="#232323" stroke="#000" stroke-width="1.2"/><path d="M9 12 L19 7 L29 12 L19 15 Z" fill="#3a3a3a"/>`,
  bronze_bar: bar('#e0a060', '#b8793a'),
  iron_bar: bar('#a8aab2', '#7d7f86'),
  gold_bar: bar('#ffe081', '#e0ab2a'),
  steel_bar: bar('#dfe6ee', '#a9b3bd'),
  cobalt_bar: bar('#7d9ae0', '#4a6fc4'),
  verdite_bar: bar('#5aa07a', '#3a7a58'),
  glacite_bar: bar('#c8ecf8', '#a8dcef'),
  bronze_dagger: blade('#c88a4a', 14),
  iron_dagger: blade('#9a9ca4', 14),
  steel_dagger: blade('#c9d3dd', 14),
  cobalt_dagger: blade('#4a6fc4', 14),
  verdite_dagger: blade('#3a7a58', 14),
  glacite_dagger: blade('#a8dcef', 14),
  bronze_sword: blade('#c88a4a', 26),
  iron_sword: blade('#9a9ca4', 26),
  steel_sword: blade('#c9d3dd', 26),
  cobalt_sword: blade('#4a6fc4', 26),
  verdite_sword: blade('#3a7a58', 26),
  glacite_sword: blade('#a8dcef', 26),
  small_net: `<rect x="16" y="20" width="3" height="14" fill="#7a5230"/><ellipse cx="17.5" cy="12" rx="11" ry="9" fill="rgba(240,230,200,.15)" stroke="#d8cfb4" stroke-width="1.6"/>
    <path d="M9 7 L26 17 M9 17 L26 7 M17.5 3 L17.5 21 M7 12 L28 12" stroke="#d8cfb4" stroke-width="0.8"/>`,
  fishing_rod: `<path d="M6 32 L30 4" stroke="#7a5230" stroke-width="2.4" stroke-linecap="round"/><path d="M30 4 Q33 16 27 26" fill="none" stroke="#e8e8e8" stroke-width="0.8"/>
    <circle cx="10" cy="27" r="2.6" fill="#555" stroke="#222"/><circle cx="27" cy="27" r="1.6" fill="#d33"/>`,
  fishing_bait: `<path d="M9 14 L27 14 L25 31 L11 31 Z" fill="#8a6a46" stroke="#3d2c14" stroke-width="1.2"/><ellipse cx="18" cy="14" rx="9" ry="3" fill="#5a3e22"/>
    <path d="M13 13 Q16 6 19 12 Q22 5 24 12" fill="none" stroke="#d98a8a" stroke-width="2" stroke-linecap="round"/>`,
  hammer: `<rect x="16" y="12" width="4" height="22" rx="1.5" fill="#7a5230" stroke="#3d2814"/><rect x="8" y="5" width="20" height="8" rx="1.5" fill="#6c6e74" stroke="#222" stroke-width="1.2"/>`,
  raw_minnows: fish('#8fa9b8', '#dfe8ee') + `<g transform="translate(4 -6) scale(.8)">${fish('#7f98a6', '#dfe8ee')}</g>`,
  minnows: fish('#c99a52', '#f0d6a0') + `<g transform="translate(4 -6) scale(.8)">${fish('#b8873e', '#f0d6a0')}</g>`,
  raw_perch: fish('#8aa04a', '#e8e0a0', '<path d="M13 12 L13 23 M17 11 L17 24 M21 12 L21 23" stroke="#3d4a20" stroke-width="1.4"/>'),
  perch: fish('#b88442', '#f0d0a0', '<path d="M13 12 L13 23 M17 11 L17 24 M21 12 L21 23" stroke="#6a4a20" stroke-width="1.4"/>'),
  raw_pike: fish('#5f7f52', '#d8e0b8', '<circle cx="15" cy="15" r="1" fill="#e8f0c8"/><circle cx="20" cy="18" r="1" fill="#e8f0c8"/>'),
  pike: fish('#a8743a', '#ecc890'),
  burnt_fish: fish('#2a2420', '#3d3530'),
  ...HERBLORE_ICONS,
  vial: vial(null, 0),
  vial_of_water: vial('#9fc8e8', 0.75),
  bones: bones(1, '#ece4cc'),
  big_bones: bones(1.18, '#e0d6b8'),
  drake_bones: bones(1.18, '#5a4a40') + '<g fill="#f08a32" opacity=".8"><circle cx="11" cy="23" r="1.4"/><circle cx="24" cy="12" r="1.2"/></g>',
  cow_horn: `<path d="M8 30 Q6 16 16 9 Q24 4 30 6 Q22 9 19 15 Q15 22 14 31 Z" fill="#e8dcbc" stroke="#5a4a2a" stroke-width="1.2"/><path d="M9 28 L14 29 M9 24 L15 25 M11 19 L17 20" stroke="#b8a882" stroke-width="1"/><path d="M27 6 Q29 6 30 6" stroke="#3a3020" stroke-width="2"/>`,
  spirit_dust: `<path d="M5 29 Q9 18 18 16 Q27 18 31 29 Z" fill="#dfe6f0" stroke="#7a8496" stroke-width="1.1"/><g fill="#ffffff"><circle cx="14" cy="22" r="1.2"/><circle cx="22" cy="24" r="1"/><circle cx="18" cy="11" r="1.1" opacity=".7"/><circle cx="24" cy="8" r=".8" opacity=".5"/><circle cx="12" cy="9" r=".9" opacity=".5"/></g>`,
  scorpion_stinger: `<path d="M8 30 Q10 20 16 16 Q22 12 24 6 Q27 10 26 14 Q24 20 16 24 Q12 27 11 31 Z" fill="#8a5a2a" stroke="#3a2010" stroke-width="1.2"/><path d="M24 6 L27 2" stroke="#1a1008" stroke-width="2" stroke-linecap="round"/><path d="M13 25 Q18 21 22 15" stroke="#b8844a" stroke-width="1" fill="none"/>`,
  contract_stone: `<path d="M8 28 L7 12 Q8 5 18 5 Q28 5 29 12 L28 28 Z" fill="#8a8a84" stroke="#2a2a26" stroke-width="1.2"/><path d="M12 13 H24 M12 17 H24 M12 21 H20" stroke="#3a3a36" stroke-width="1.3"/><circle cx="23" cy="23" r="2.4" fill="#c8402a" stroke="#5a1a10" stroke-width=".8"/>`,
  rock_hammer: `<rect x="16" y="12" width="4" height="22" rx="1.5" fill="#7a5230" stroke="#3d2814"/><path d="M6 6 L28 6 L31 11 L28 13 L8 13 Z" fill="#7d7f86" stroke="#222" stroke-width="1.2"/><path d="M28 6 L31 11 L28 13" fill="#a0a3aa"/>`,
  salt_sack: `<path d="M10 13 Q6 30 18 31 Q30 30 26 13 Z" fill="#e8e2d0" stroke="#5a5040" stroke-width="1.2"/><path d="M12 13 L24 13 L21 8 L15 8 Z" fill="#cfc6ae" stroke="#5a5040" stroke-width="1.2"/><g fill="#ffffff"><circle cx="15" cy="21" r="1"/><circle cx="20" cy="24" r="1"/><circle cx="19" cy="18" r=".8"/></g>`,
  scent_mask: `<path d="M6 13 Q18 9 30 13 Q30 25 18 28 Q6 25 6 13 Z" fill="#6a7a4a" stroke="#22281a" stroke-width="1.2"/><ellipse cx="12.5" cy="16" rx="3" ry="2.2" fill="#1a1a14"/><ellipse cx="23.5" cy="16" rx="3" ry="2.2" fill="#1a1a14"/><path d="M14 22 Q18 25 22 22 L21 27 Q18 29 15 27 Z" fill="#8a9a64" stroke="#22281a" stroke-width=".9"/><path d="M6 14 L2 13 M30 14 L34 13" stroke="#5a3e22" stroke-width="1.4"/>`,
  polished_shield: shield('#e8eef4', '#9aa6b2') + '<path d="M12 10 Q15 8 19 9 L13 20 Z" fill="#ffffff" opacity=".7"/>',
  bounty_helm: helm('#4a4a50', '#2a2a2e') + '<path d="M9 21 Q18 17 27 21" stroke="#c8402a" stroke-width="1.6" fill="none"/><circle cx="18" cy="12" r="2" fill="#c8402a" stroke="#222" stroke-width=".8"/>',
  plank: `<path d="M4 22 L10 14 L32 14 L26 22 Z" fill="#c89a5e" stroke="#2a1a0c" stroke-width="1.1"/><path d="M4 22 L26 22 L26 27 L4 27 Z" fill="#a0753e" stroke="#2a1a0c" stroke-width="1.1"/><path d="M26 22 L32 14 L32 19 L26 27 Z" fill="#a0753e" stroke="#2a1a0c" stroke-width="1.1"/><path d="M11 17 Q18 16 27 18 M9 19.5 Q16 18.5 24 20.5" stroke="#8a6034" stroke-width=".8" fill="none"/>`,
  oak_plank: `<path d="M4 22 L10 14 L32 14 L26 22 Z" fill="#a8783e" stroke="#2a1a0c" stroke-width="1.1"/><path d="M4 22 L26 22 L26 27 L4 27 Z" fill="#80592a" stroke="#2a1a0c" stroke-width="1.1"/><path d="M26 22 L32 14 L32 19 L26 27 Z" fill="#80592a" stroke="#2a1a0c" stroke-width="1.1"/><path d="M11 17 Q18 16 27 18 M9 19.5 Q16 18.5 24 20.5" stroke="#5e3e1a" stroke-width=".8" fill="none"/>`,
  yew_plank: `<path d="M4 22 L10 14 L32 14 L26 22 Z" fill="#c2603a" stroke="#2a1a0c" stroke-width="1.1"/><path d="M4 22 L26 22 L26 27 L4 27 Z" fill="#94442a" stroke="#2a1a0c" stroke-width="1.1"/><path d="M26 22 L32 14 L32 19 L26 27 Z" fill="#94442a" stroke="#2a1a0c" stroke-width="1.1"/><path d="M11 17 Q18 16 27 18 M9 19.5 Q16 18.5 24 20.5" stroke="#6a2a18" stroke-width=".8" fill="none"/>`,
  steel_nails: `<g stroke="#2a2a2a" stroke-width=".8"><path d="M9 6 H15 L13 8 L13 28 L12 31 L11 28 L11 8 Z" fill="#c9d3dd"/><path d="M17 9 H23 L21 11 L21 29 L20 32 L19 29 L19 11 Z" fill="#b8c2cc"/><path d="M24 5 H30 L28 7 L28 25 L27 28 L26 25 L26 7 Z" fill="#c9d3dd"/></g>`,
  saw: `<path d="M6 14 L30 18 L30 24 L8 24 Z" fill="#b8c2cc" stroke="#222" stroke-width="1.1"/><path d="M8 24 l2 3 l2 -3 l2 3 l2 -3 l2 3 l2 -3 l2 3 l2 -3 l2 3 l2 -3 l2 3" fill="none" stroke="#5a6068" stroke-width=".9"/><path d="M2 10 Q2 6 6 6 L10 6 Q12 6 12 9 L12 22 L4 22 Q2 22 2 19 Z" fill="#7a5230" stroke="#3d2814" stroke-width="1.1"/><rect x="5" y="10" width="4" height="7" rx="1.5" fill="#2a1a0c"/>`,
  bolt_of_cloth: `<path d="M6 12 L24 12 L30 18 L12 18 Z" fill="#d8c8a0" stroke="#4a3e28" stroke-width="1.1"/><rect x="6" y="12" width="6" height="16" rx="3" fill="#c8b48a" stroke="#4a3e28" stroke-width="1.1"/><path d="M12 18 L30 18 L30 26 L12 28 Z" fill="#bfa878" stroke="#4a3e28" stroke-width="1.1"/><ellipse cx="9" cy="12" rx="3" ry="1.5" fill="#e8dcb8" stroke="#4a3e28" stroke-width=".8"/>`,
  limestone_brick: `<path d="M4 22 L10 13 L32 13 L26 22 Z" fill="#ece4cc" stroke="#4a4436" stroke-width="1.1"/><path d="M4 22 L26 22 L26 29 L4 29 Z" fill="#d6ccae" stroke="#4a4436" stroke-width="1.1"/><path d="M26 22 L32 13 L32 20 L26 29 Z" fill="#c2b896" stroke="#4a4436" stroke-width="1.1"/><circle cx="12" cy="25" r=".8" fill="#a89e80"/><circle cx="20" cy="26" r=".6" fill="#a89e80"/>`,
  coins: `<g stroke="#7a5a10" stroke-width="1"><ellipse cx="14" cy="24" rx="8" ry="4" fill="#e8b830"/><ellipse cx="22" cy="20" rx="8" ry="4" fill="#f0c840"/><ellipse cx="16" cy="15" rx="8" ry="4" fill="#ffd84d"/></g>`,
};

const SACK = `<path d="M10 12 Q6 30 18 31 Q30 30 26 12 Z" fill="#a08454" stroke="#3d2c14" stroke-width="1.2"/>
  <path d="M12 12 L24 12 L21 7 L15 7 Z" fill="#8a6f42" stroke="#3d2c14" stroke-width="1.2"/>`;

export function itemIcon(itemId: string): string {
  return `<svg viewBox="0 0 36 36" width="100%" height="100%" aria-hidden="true">${ICONS[itemId] ?? SACK}</svg>`;
}
