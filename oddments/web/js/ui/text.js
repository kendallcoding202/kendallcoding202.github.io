// What the fight says out loud: one short line per thing that happens.
import { STATS, SPECIES, BRACE, moveOf } from '../core/balance.js';

/**
 * A line for an event, or null if it needs none. `name(key)` gives a fighter's name; `kind(key)`,
 * where it is given, which kind of Clutterkin it is.
 */
export function lineFor(event, name, kind = null) {
  switch (event.t) {
    case 'use':
      return event.move === BRACE.id ? `${name(event.who)} braces.` : `${name(event.who)} uses ${moveOf(event.move).name}.`;
    case 'hit':
      if (event.down) return `${name(event.target)} is down!`;
      if (event.edge > 0) return `${name(event.target)} really felt that.`;
      if (event.edge < 0) return `${name(event.target)} barely felt it.`;
      return null;
    case 'mend':
      return event.amount > 0 ? `${name(event.target)} feels better.` : `${name(event.target)} is as well as can be.`;
    case 'mod':
      return `${name(event.target)}'s ${STATS[event.stat].name} goes ${event.by > 0 ? 'up' : 'down'}.`;
    case 'call':
      if (event.call === 'reach') return `You reach out to ${name(event.target)}.`;
      if (event.call === 'cheer') return `You cheer ${name(event.target)} on!`;
      return `You patch up ${name(event.target)}.`;
    case 'huff':
      if (event.by > 0) return `${name(event.target)} is back in a huff.`;
      if (event.huff === 0) return null; // it settles, and the next line says so
      // Reached, and not ready to come: it says no in its own way. (How far there is to go comes next: see `toGo`.)
      return `${name(event.target)} ${notYetOf(kind ? kind(event.target) : null)}.`;
    case 'settle':
      return `${name(event.target)} settles down.`;
    default:
      return null;
  }
}

/** How far a Clutterkin that was not ready still is from coming with you: said once it has had its say. */
export const toGo = (huff) => `${huff} more pip${huff === 1 ? '' : 's'} to go.`;

/** What a kind does when you Reach out and it is not ready to come with you. */
export const notYetOf = (species) => (species && SPECIES[species] && SPECIES[species].notYet) || 'turns away';
