import { createHash } from 'node:crypto';

/**
 * Mutes and bans, kept with the character in the store (a `moderation` field
 * beside the save), so they last across visits and restarts.
 */
export interface Moderation {
  /** ISO time; missing means not muted. */
  mutedUntil?: string;
  /** ISO time, or 'forever'; missing means not banned. */
  bannedUntil?: string;
}

/**
 * Who may moderate: SHA-256 of their sign-in email, so the repo never holds the
 * address itself. ADMIN_EMAIL_SHA256 (comma-separated) replaces the default, which is Michael.
 */
const DEFAULT_ADMINS = '89b268c00180519d8ac7004c02a48431ed93c73239c5b5f3cd41c4bf583bc7a5';

export function isAdmin(email: string): boolean {
  if (!email) return false;
  const admins = (process.env.ADMIN_EMAIL_SHA256 ?? DEFAULT_ADMINS).split(',').map((h) => h.trim().toLowerCase());
  return admins.includes(createHash('sha256').update(email.trim().toLowerCase()).digest('hex'));
}

export function isMuted(m: Moderation | undefined, now: number): boolean {
  return !!m?.mutedUntil && Date.parse(m.mutedUntil) > now;
}

export function isBanned(m: Moderation | undefined, now: number): boolean {
  return !!m?.bannedUntil && (m.bannedUntil === 'forever' || Date.parse(m.bannedUntil) > now);
}

/** "until 3:40 pm", "for good": how long a ban or mute lasts, for messages. */
export function until(when: string | undefined): string {
  if (!when) return '';
  if (when === 'forever') return 'for good';
  return `until ${new Date(when).toUTCString().replace(/:\d\d GMT$/, ' UTC')}`;
}

export type Command =
  | { kind: 'who' }
  | { kind: 'help' }
  | { kind: 'kick' | 'unmute' | 'unban'; name: string }
  /** minutes for a mute, hours for a ban; 0 means for good. */
  | { kind: 'mute' | 'ban'; name: string; amount: number };

/**
 * Moderator commands typed in chat: ::who, ::kick Name, ::mute Name [minutes],
 * ::unmute Name, ::ban Name [hours], ::unban Name. Names may have spaces, so a
 * trailing number is the amount.
 */
export function parseCommand(text: string): Command | null {
  const m = /^::(\w+)\s*(.*)$/.exec(text.trim());
  if (!m) return null;
  const verb = m[1].toLowerCase();
  let rest = m[2].trim();
  if (verb === 'who') return { kind: 'who' };
  if (verb === 'help') return { kind: 'help' };
  if (!rest) return { kind: 'help' };
  if (verb === 'kick' || verb === 'unmute' || verb === 'unban') return { kind: verb, name: rest };
  if (verb === 'mute' || verb === 'ban') {
    const n = /\s+(\d+)$/.exec(rest);
    let amount = verb === 'mute' ? 60 : 0;
    if (n) {
      amount = Number(n[1]);
      rest = rest.slice(0, n.index).trim();
    }
    return { kind: verb, name: rest, amount };
  }
  return { kind: 'help' };
}

export const HELP =
  'Moderator commands: ::who, ::kick Name, ::mute Name [minutes, default 60], ::unmute Name, ::ban Name [hours, default for good], ::unban Name.';
