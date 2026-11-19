// The switches for testing: ?reset, ?fast, ?seed=7, ?day=20001, ?news, ?sample and ?debug in the
// web address, or the same names in an ODDMENTS_FLAGS object a host page sets
// before the game loads (for a host that strips query strings).
//
// They exist only in a copy for trying things out. In a numbered build, which
// is what goes into the app, there are none: nothing in an address, and
// nothing another script could set, changes how the app runs.
import { BUILD } from './build.js';

/**
 * The switches as they stand for a build, an address's query and whatever a host set:
 * { has(name), get(name), number(name) }. In a numbered build every one of them is off.
 */
export function switchesFor(build, search, hostFlags) {
  const testing = build === 'dev';
  const params = new URLSearchParams(testing && typeof search === 'string' ? search : '');
  // Only a plain object's own, simple values are looked at: nothing inherited, nothing that is not text, a number or true.
  const given = testing && hostFlags && typeof hostFlags === 'object' && !Array.isArray(hostFlags) ? hostFlags : {};
  const own = (name) => (Object.prototype.hasOwnProperty.call(given, name) && ['string', 'number', 'boolean'].includes(typeof given[name]) ? given[name] : undefined);
  return {
    testing,
    has: (name) => params.has(name) || !!own(name),
    get: (name) => (params.has(name) ? params.get(name) : own(name) === undefined ? null : String(own(name))),
    /** A switch's value as a number, or NaN if it is not there or is not one. */
    number(name) { const value = this.get(name); return value === null || value === '' ? NaN : Number(value); },
  };
}

/** The switches for this page. */
export const switches = switchesFor(BUILD, typeof location === 'object' && location ? location.search : '', typeof window === 'object' ? window.ODDMENTS_FLAGS : null);
