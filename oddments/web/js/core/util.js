// Small pure helpers shared by the core: the seeded random generator and a
// few number tools. Nothing here touches the DOM, the clock or storage.

// mulberry32. The whole generator state is one integer, kept in the save, so
// a fight replays exactly from the same seed and the same choices.
export function nextRandom(holder) {
  let t = (holder.rng = (holder.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** A whole number from lo to hi, both included. */
export const rollInt = (holder, lo, hi) => lo + Math.floor(nextRandom(holder) * (hi - lo + 1));

/** One entry of `list`, chosen by `weight(entry)` (default: evenly). */
export function rollPick(holder, list, weight = () => 1) {
  const weights = list.map((entry) => Math.max(0, weight(entry)));
  const total = weights.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return list[Math.floor(nextRandom(holder) * list.length)];
  let roll = nextRandom(holder) * total;
  for (let i = 0; i < list.length; i++) {
    roll -= weights[i];
    if (roll < 0) return list[i];
  }
  return list[list.length - 1];
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// (Not Object.hasOwn: iOS 15.0 to 15.3 do not have it.)
export const own = (table, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key);
