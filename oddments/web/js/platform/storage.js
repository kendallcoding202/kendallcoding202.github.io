// Where the save lives: on this device, and nowhere else. In a browser that
// is localStorage. In the iOS app it is also written to the app's own native
// settings store, which iOS never clears the way it can clear a web view's
// storage; on load the newer of the two copies wins.
// Nothing here or anywhere in the game talks to a network.
import { isNative, native } from './native.js';

const KEY = 'oddments.save';

function readLocal() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

/** When a stored save was last played, or -1 if it cannot be read at all. */
function lastSeenOf(json) {
  try { return JSON.parse(json).lastSeen || 0; } catch { return -1; }
}

/** Which of two stored copies to use: the one played more recently; either, if there is only one. */
export function newer(local, kept) {
  if (local && kept) return lastSeenOf(kept) > lastSeenOf(local) ? kept : local;
  return local || kept || null;
}

/**
 * Every stored copy of the save, as text, the one played most recently first: one in a browser, up
 * to two in the app. Whoever reads them should try each in turn: a copy that turns out to be
 * damaged must not hide a good one behind it.
 */
export async function loadSaves() {
  const local = readLocal();
  let kept = null;
  if (isNative()) {
    try { kept = (await native('Preferences', 'get', { key: KEY })).value; } catch { kept = null; }
  }
  if (typeof kept !== 'string') kept = null;
  const first = newer(local, kept);
  const copies = [first, first === local ? kept : local].filter((copy) => typeof copy === 'string' && copy.length > 0);
  return copies.length === 2 && copies[0] === copies[1] ? [copies[0]] : copies;
}

/** The stored save as text (the copy played most recently), or null if there is none. */
export async function loadSave() {
  return (await loadSaves())[0] || null;
}

/** Writes the save. True once this device has it; false if the browser would not take it (private mode, or full). */
export function writeSave(json) {
  let stored = false;
  try { localStorage.setItem(KEY, json); stored = true; } catch { /* the app's own copy below still saves */ }
  if (isNative()) { native('Preferences', 'set', { key: KEY, value: json }).catch(() => {}); stored = true; }
  return stored;
}

/** Sets aside a stored save the game could not read, so starting over does not destroy it. */
export function keepUnreadable(json) {
  try { localStorage.setItem(`${KEY}.unreadable`, json); } catch { /* best effort */ }
  if (isNative()) native('Preferences', 'set', { key: `${KEY}.unreadable`, value: json }).catch(() => {});
}

/**
 * Sets aside a save that is about to be erased on purpose, so that erasing can be undone by hand.
 * (One copy is kept: the last game erased.)
 */
export function keepErased(json) {
  try { localStorage.setItem(`${KEY}.erased`, json); } catch { /* best effort */ }
  if (isNative()) native('Preferences', 'set', { key: `${KEY}.erased`, value: json }).catch(() => {});
}

/** Removes the save from wherever it is kept. Resolves once it is gone. */
export async function clearSave() {
  try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ }
  if (isNative()) await native('Preferences', 'remove', { key: KEY }).catch(() => {});
}
