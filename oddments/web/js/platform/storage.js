// Where the save lives: this device's localStorage, and nowhere else.
// Nothing here or anywhere in the game talks to a network.

const KEY = 'oddments.save';

export function loadSave() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

/** Writes the save. True once it is stored; false if the browser would not take it (private mode, or full). */
export function writeSave(json) {
  try { localStorage.setItem(KEY, json); return true; } catch { return false; }
}

/** Sets aside a stored save the game could not read, so starting over does not destroy it. */
export function keepUnreadable(json) {
  try { localStorage.setItem(`${KEY}.unreadable`, json); } catch { /* best effort */ }
}

export function clearSave() {
  try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ }
}
