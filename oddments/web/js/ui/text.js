// What the fight says out loud: one short line per thing that happens.
import { CALLS, STATS, BRACE, moveOf } from '../core/balance.js';

/** A line for an event, or null if it needs none. `name(key)` gives a fighter's name. */
export function lineFor(event, name) {
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
      return event.huff > 0 ? `${name(event.target)} is calming down.` : null;
    case 'settle':
      return `${name(event.target)} settles down.`;
    default:
      return null;
  }
}

export const callName = (id) => CALLS[id].name;
