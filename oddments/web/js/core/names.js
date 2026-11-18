// What a friend is called. Every Clutterkin answers to the name of its kind;
// one that has come home can be given a name of your own as well, and that is
// then used wherever its kind's name would have been: on its card, on the
// team, in a fight, and in the story if it is one of the three you set out
// with. The kind's name is never lost: clear yours and it is back.
//
// A friend that has grown up goes by its grown form's name (a Hopmote grows
// into a Lintelope), unless you gave it a name of your own, which it keeps.
import { SPECIES, NAME_LENGTH } from './balance.js';

// Characters that draw nothing, or change how the line around them is drawn:
// control characters, the soft hyphen, zero-width marks, and the marks that
// turn text right to left. Each is taken for a space.
const unseen = (code) => code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0xad
  || (code >= 0x200b && code <= 0x200f) || (code >= 0x2028 && code <= 0x202f) || (code >= 0x2060 && code <= 0x206f) || code === 0xfeff;

/** A typed name, made fit to keep: one line, at most NAME_LENGTH characters, '' if nothing is left. */
export function tidyName(text) {
  if (typeof text !== 'string') return '';
  const flat = Array.from(text.slice(0, 400), (letter) => (unseen(letter.codePointAt(0)) ? ' ' : letter)).join('').replace(/\s+/g, ' ').trim();
  return Array.from(flat).slice(0, NAME_LENGTH).join('').trim();
}

/** What a friend's kind is called as it stands now: its grown form's name once it has grown up. */
export const kindNameOf = (one) => (one.grown && SPECIES[one.species].grown ? SPECIES[one.species].grown.name : SPECIES[one.species].name);

/** Which picture is this one's: its kind's, or its kind's grown form. (A friend or a fighter.) */
export const artOf = (one) => (one.grown && SPECIES[one.species].grown ? `${one.species}_grown` : one.species);

/** What a friend is called: the name you gave it, or else its kind's. */
export const nameOf = (friend) => friend.nick || kindNameOf(friend);

/** What your friend of a kind is called; the kind's own name if none has come home. */
export function calledOf(state, species) {
  const friend = state.friends.find((each) => each.species === species);
  return friend ? nameOf(friend) : SPECIES[species].name;
}

/** A piece of the story about a kind, told with the name your friend of that kind goes by. */
export const toldOf = (state, species, text) => text.split(SPECIES[species].name).join(calledOf(state, species));

/**
 * Gives a friend a name of your own, or takes it away again ('' or its kind's own name).
 * Returns what it is called now.
 */
export function giveName(friend, text) {
  const name = tidyName(text);
  if (name && name !== kindNameOf(friend)) friend.nick = name; else delete friend.nick;
  return nameOf(friend);
}
