import { CHAT_MAX, type EntityId } from '@rpg/shared';
import type { ServerConnection } from '../net/ServerConnection';
import type { ClientState } from '../state/ClientState';
import type { Hud } from './Hud';

/** How long words stay over a speaker's head (ms). */
const SAY_MS = 5000;
const BLOCK_KEY = 'oathofstur.blocked.v1';
const HIDE_KEY = 'oathofstur.chatHidden.v1';

function load<T>(key: string, fallback: T): T {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? 'null') as T | null) ?? fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked: it lasts for this visit only.
  }
}

/**
 * The chat box and what players say over their heads. Blocking is kept in this
 * browser, by name: a blocked player's words never show, in the box or overhead.
 */
export function setupChat(state: ClientState, hud: Hud, server: ServerConnection, online: boolean) {
  const input = document.getElementById('chat-input') as HTMLInputElement;
  const hide = document.getElementById('chat-hide') as HTMLInputElement;
  const blockedStatus = document.getElementById('blocked-status')!;
  const blockedList = document.getElementById('blocked-list')!;
  const blocked = new Set<string>(load<string[]>(BLOCK_KEY, []));
  let hidden = load<boolean>(HIDE_KEY, false);
  const says = new Map<EntityId, { name: string; text: string; until: number }>();

  input.disabled = !online;
  input.maxLength = CHAT_MAX;
  if (online) input.placeholder = 'Press Enter to talk to players nearby';
  hide.checked = hidden;
  hide.addEventListener('change', () => {
    hidden = hide.checked;
    store(HIDE_KEY, hidden);
  });

  const showBlocked = () => {
    blockedStatus.textContent = blocked.size
      ? 'Blocked players (click a name to unblock):'
      : "You haven't blocked anyone. Right-click a player to block them.";
    blockedList.replaceChildren(
      ...[...blocked].sort().map((name) => {
        const b = document.createElement('button');
        b.textContent = name;
        b.onclick = () => api.setBlocked(name, false);
        return b;
      }),
    );
  };

  const api = {
    isBlocked: (name: string) => blocked.has(name.toLowerCase()),
    setBlocked(name: string, on: boolean) {
      const key = name.toLowerCase();
      if (on) blocked.add(key);
      else blocked.delete(key);
      store(BLOCK_KEY, [...blocked]);
      hud.addMessage(on ? `You won't see anything ${name} says.` : `You'll see what ${name} says again.`);
      showBlocked();
    },
    /** What a player is saying right now, for over their head ('' when nothing). */
    saying(id: EntityId, name: string, now: number): string {
      const s = says.get(id);
      if (!s) return '';
      if (s.until < now || s.name !== name || blocked.has(name.toLowerCase())) {
        says.delete(id);
        return '';
      }
      return s.text;
    },
  };
  showBlocked();

  state.on('chat', ({ fromId, from, text }) => {
    const mine = fromId === state.playerId;
    if (!mine && (hidden || blocked.has(from.toLowerCase()))) return;
    hud.addChat(from, text);
    says.set(fromId, { name: from, text, until: performance.now() + SAY_MS });
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const text = input.value.trim();
      if (text) server.send({ type: 'chat', text });
      input.value = '';
      input.blur();
    } else if (e.key === 'Escape') {
      input.value = '';
      input.blur();
    }
    e.stopPropagation();
  });
  // Enter anywhere in the game starts typing.
  window.addEventListener('keydown', (e) => {
    if (!online || e.key !== 'Enter' || hud.dialogueOpen || document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) return;
    e.preventDefault();
    input.focus();
  });

  return api;
}
