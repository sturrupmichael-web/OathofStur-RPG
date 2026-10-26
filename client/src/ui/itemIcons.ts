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

const ICONS: Record<string, string> = {
  bronze_helm: helm('#c88a4a', '#8a5a2a'),
  iron_helm: helm('#9a9ca4', '#5f6168'),
  steel_helm: helm('#c9d3dd', '#8a96a2'),
  bronze_chainbody: chainbody('#c88a4a', '#7a4a1e'),
  iron_chainbody: chainbody('#9a9ca4', '#55575e'),
  steel_chainbody: chainbody('#c9d3dd', '#7d8996'),
  bronze_platelegs: platelegs('#c88a4a', '#8a5a2a'),
  iron_platelegs: platelegs('#9a9ca4', '#5f6168'),
  steel_platelegs: platelegs('#c9d3dd', '#8a96a2'),
  bronze_shield: shield('#c88a4a', '#8a5a2a'),
  iron_shield: shield('#9a9ca4', '#5f6168'),
  steel_shield: shield('#c9d3dd', '#8a96a2'),
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
  cinder_blade: blade('#5a2018', 26) + '<path d="M18 9 L18.8 25" stroke="#ff7a1a" stroke-width="1.4"/>',
  drakescale_shield: shield('#a8401e', '#5a1e14') + '<path d="M12 12 Q18 15 24 12 M11 17 Q18 20 25 17 M13 22 Q18 25 23 22" stroke="#5a1e14" stroke-width="1" fill="none"/>',
  bronze_axe: axe('#b8793a', '#f0c48a'),
  iron_axe: axe('#7d7f86', '#d8dbe2'),
  steel_axe: axe('#a9b3bd', '#f2f6fa'),
  bronze_pickaxe: pickaxe('#b8793a'),
  iron_pickaxe: pickaxe('#7d7f86'),
  steel_pickaxe: pickaxe('#a9b3bd'),
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
  bronze_dagger: blade('#c88a4a', 14),
  iron_dagger: blade('#9a9ca4', 14),
  steel_dagger: blade('#c9d3dd', 14),
  bronze_sword: blade('#c88a4a', 26),
  iron_sword: blade('#9a9ca4', 26),
  steel_sword: blade('#c9d3dd', 26),
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
  coins: `<g stroke="#7a5a10" stroke-width="1"><ellipse cx="14" cy="24" rx="8" ry="4" fill="#e8b830"/><ellipse cx="22" cy="20" rx="8" ry="4" fill="#f0c840"/><ellipse cx="16" cy="15" rx="8" ry="4" fill="#ffd84d"/></g>`,
};

const SACK = `<path d="M10 12 Q6 30 18 31 Q30 30 26 12 Z" fill="#a08454" stroke="#3d2c14" stroke-width="1.2"/>
  <path d="M12 12 L24 12 L21 7 L15 7 Z" fill="#8a6f42" stroke="#3d2c14" stroke-width="1.2"/>`;

export function itemIcon(itemId: string): string {
  return `<svg viewBox="0 0 36 36" width="100%" height="100%" aria-hidden="true">${ICONS[itemId] ?? SACK}</svg>`;
}
