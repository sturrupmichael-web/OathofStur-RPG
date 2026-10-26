import { parseSave, type SaveData } from '@rpg/shared';

const KEY = 'oathofstur.save';

/** The character saved in this browser, or null. Storage can be blocked, so every access is guarded. */
export function loadLocal(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? parseSave(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function storeLocal(save: SaveData): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
    return true;
  } catch {
    return false;
  }
}

export function clearLocal(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing stored to clear.
  }
}

/** Downloads the save as a .json file the player can keep or move to another device. */
export function downloadSave(save: SaveData): void {
  const blob = new Blob([JSON.stringify(save, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `oath-of-stur-${save.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Reads a save file the player picked. Returns null if it isn't a valid save. */
export async function readSaveFile(file: File): Promise<SaveData | null> {
  try {
    return parseSave(JSON.parse(await file.text()));
  } catch {
    return null;
  }
}
