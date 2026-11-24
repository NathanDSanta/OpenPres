import type { Keybinds } from "@/lib/commands";
import type { Mode } from "@/lib/manager";

/**
 * Keyboard shortcuts are kept per manager and mode: each mode on this computer (or browser)
 * changes the shared ones the admin sets for every manager. Only the changes are kept, so a
 * shortcut the admin adds later (a macro's, say) still reaches every manager.
 */
export interface KeybindChanges {
  /** Shortcuts added or pointed at another command here. */
  set: Keybinds;
  /** Shared shortcuts removed here. */
  removed: string[];
}

const NONE: KeybindChanges = { set: {}, removed: [] };
const storageKey = (mode: Mode) => `openpres.keybinds.${mode}`;

export function loadKeybindChanges(mode: Mode): KeybindChanges {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(mode)) ?? "null") as Partial<KeybindChanges> | null;
    if (!raw || typeof raw !== "object") return NONE;
    const set = raw.set && typeof raw.set === "object" ? Object.fromEntries(Object.entries(raw.set).filter(([, id]) => typeof id === "string")) : {};
    const removed = Array.isArray(raw.removed) ? raw.removed.filter((c): c is string => typeof c === "string") : [];
    return { set, removed };
  } catch {
    return NONE;
  }
}

export function saveKeybindChanges(mode: Mode, changes: KeybindChanges) {
  try {
    if (!Object.keys(changes.set).length && !changes.removed.length) localStorage.removeItem(storageKey(mode));
    else localStorage.setItem(storageKey(mode), JSON.stringify(changes));
  } catch {
    /* private browsing: they last until the page closes */
  }
}

export const hasChanges = (changes: KeybindChanges) => Object.keys(changes.set).length > 0 || changes.removed.length > 0;

/** The shared shortcuts with this manager's changes. */
export function applyKeybindChanges(shared: Keybinds, changes: KeybindChanges): Keybinds {
  const out = { ...shared };
  for (const combo of changes.removed) delete out[combo];
  return { ...out, ...changes.set };
}

/** The changes that turn the shared shortcuts into `wanted`. */
export function keybindChanges(shared: Keybinds, wanted: Keybinds): KeybindChanges {
  const set: Keybinds = {};
  for (const [combo, id] of Object.entries(wanted)) if (shared[combo] !== id) set[combo] = id;
  const removed = Object.keys(shared).filter((combo) => !(combo in wanted));
  return { set, removed };
}
