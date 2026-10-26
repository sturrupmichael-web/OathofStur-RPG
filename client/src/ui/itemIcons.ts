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

const ICONS: Record<string, string> = {
  bronze_axe: axe('#b8793a', '#f0c48a'),
  iron_axe: axe('#7d7f86', '#d8dbe2'),
  steel_axe: axe('#a9b3bd', '#f2f6fa'),
  logs: logs('#6b4a2b', '#d9b47c', '#9a7646'),
  ashwood_logs: logs('#8d857c', '#ece3d2', '#b9ad98'),
};

const SACK = `<path d="M10 12 Q6 30 18 31 Q30 30 26 12 Z" fill="#a08454" stroke="#3d2c14" stroke-width="1.2"/>
  <path d="M12 12 L24 12 L21 7 L15 7 Z" fill="#8a6f42" stroke="#3d2c14" stroke-width="1.2"/>`;

export function itemIcon(itemId: string): string {
  return `<svg viewBox="0 0 36 36" width="100%" height="100%" aria-hidden="true">${ICONS[itemId] ?? SACK}</svg>`;
}
