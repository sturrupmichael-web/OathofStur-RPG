import type { SaveData } from '@rpg/shared';
import { summary } from '../net/syncRules';

/**
 * The screen before the game loads, like a login screen: play solo in this browser,
 * or sign in with Google and play online. Signing in is what brings a character to a
 * new device (the online one from the server, the solo one from the cloud save), so it
 * comes before the game makes a fresh character.
 */
export type TitleChoice = 'solo' | 'online' | 'sign-in' | 'sign-out';

export interface TitleOptions {
  /** The signed-in account's email ('' if Google didn't share one), or null when signed out. */
  user: { email: string } | null;
  /** False in the claude.ai preview frame, where Google sign-in and the online world can't work. */
  canSignIn: boolean;
  /** The character kept in this browser, if any. */
  local: SaveData | null;
  /** The world played last time, which gets the gold button. */
  last: 'solo' | 'online';
  /** Why the last sign-in didn't finish. */
  error?: string;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

/** Shows the screen and resolves with what the player picked. */
export function showTitle(opts: TitleOptions): Promise<TitleChoice> {
  const root = el('div', '');
  root.id = 'title';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-labelledby', 'title-name');
  root.innerHTML = `
    <div class="title-sky"></div>
    <svg class="title-hills" viewBox="0 0 1200 300" preserveAspectRatio="none" aria-hidden="true">
      <path class="far" d="M0 190 L120 120 L210 165 L330 70 L450 150 L560 95 L690 160 L800 80 L930 150 L1050 105 L1200 170 V300 H0Z"/>
      <path class="near" d="M0 240 L90 205 L200 230 L320 190 L430 225 L560 200 L700 235 L820 195 L950 230 L1080 205 L1200 228 V300 H0Z"/>
    </svg>`;
  const box = el('div', 'title-box');
  const name = el('h1', 'title-name', 'Oath of Stur');
  name.id = 'title-name';
  box.append(name, el('p', 'title-tag', 'Adventures in the Vell Reaches'));
  const panel = el('div', 'title-panel');
  box.append(panel);
  root.append(box);

  return new Promise((resolve) => {
    const done = (choice: TitleChoice) => {
      root.remove();
      resolve(choice);
    };
    const button = (label: string, choice: TitleChoice, gold: boolean, note = '') => {
      const b = el('button', gold ? 'title-button gold' : 'title-button');
      b.append(el('b', '', label));
      if (note) b.append(el('span', '', note));
      b.addEventListener('click', () => done(choice));
      panel.append(b);
      return b;
    };
    const local = opts.local ? summary(opts.local) : null;
    const soloNote = local ? `${local.name}, total level ${local.totalLevel}` : 'A new character in this browser';

    if (opts.user) {
      panel.append(el('p', 'title-who', `Signed in as ${opts.user.email || 'a Google account'}`));
      const online = button('Play online', 'online', opts.last === 'online', 'Your character, with other players');
      button('Play solo', 'solo', opts.last !== 'online', 'Kept in step with your cloud save');
      const out = el('button', 'title-link', 'Sign out');
      out.addEventListener('click', () => done('sign-out'));
      panel.append(out);
      (opts.last === 'online' ? online : (panel.querySelector('.gold') as HTMLButtonElement)).focus();
    } else if (opts.canSignIn) {
      const signIn = button('Sign in with Google', 'sign-in', true, 'Play online, and get your character on any device');
      button('Play solo', 'solo', false, soloNote);
      if (opts.error) panel.append(el('p', 'title-error', `Sign-in didn't finish: ${opts.error}`));
      signIn.focus();
    } else {
      button('Play', 'solo', true, soloNote).focus();
      panel.append(el('p', 'title-note', 'Sign-in and the online world work on the game page, not in this preview.'));
    }
    document.body.append(root);
  });
}
