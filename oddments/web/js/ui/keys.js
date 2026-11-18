// The key ring: a key for each place, handed over by its ringleader when the
// place is calm: eight for the lane, and four more for the far bank, whose
// hooks appear on the ring when great-aunt Maribel has rung about it. Shown where you look at how far you have
// got: "What to do", and the scrapbook. A key not yet earned is its own dark
// outline on the ring. Which keys there are, and what is said of each, is in
// core/story.js; this only lays them out.
import { ROOMS } from '../core/balance.js';
import { keysOf } from '../core/story.js';
import { h } from './dom.js';

export const keySrc = (room) => `assets/keys/${room}.webp`;
/** Every key's picture, to fetch before the game shows. */
export const KEY_ART = ROOMS.map((room) => keySrc(room.id));

/** A key's picture. */
export const keyPicture = (room, cls = '') => h('img', { class: cls, src: keySrc(room), alt: '', draggable: false });

/**
 * The ring, as a card: how many keys you hold, all of them in the order of the places (the lane's
 * eight in one row; the far bank's four in a row of their own, once you know of it), and under
 * them what the one you tapped is (to begin with, the newest you hold). Tap one not yet earned
 * and it says where it is to be had.
 */
export function keyRing(state) {
  const far = state.story.call2 === true;
  const keys = keysOf(state).filter((key) => key.chapter === 1 || far);
  const held = keys.filter((key) => key.held);
  const about = h('small', { class: 'keyabout', data: { act: 'keyabout' } });
  const slots = keys.map((key) => h('button', {
    class: `keyslot${key.held ? ' held' : ''}`, data: { key: key.room }, 'aria-label': key.held ? key.name : `A key not yet earned: ${key.place}`,
    onclick: () => show(key),
  }, keyPicture(key.room)));
  function show(key) {
    slots.forEach((slot) => slot.classList.toggle('on', slot.dataset.key === key.room));
    about.replaceChildren(...(key.held ? [h('b', null, `${key.name}. `), key.line] : [`Calm ${key.place.replace(/^The /, 'the ')} and its key is yours.`]));
  }
  if (held.length) show(held[held.length - 1]);
  else about.textContent = 'Each place has a key. Calm a place and its ringleader hands it over.';
  return h('div', { class: 'keyring', data: { held: String(held.length), keys: keys.filter((key) => key.held).map((key) => key.room).join(',') } },
    h('div', { class: 'keyhead' }, h('b', null, 'Keys'), h('small', null, `${held.length} of ${keys.length}`)),
    h('div', { class: 'keyrow', data: { chapter: '1' } }, slots.filter((_, i) => keys[i].chapter === 1)),
    far ? [h('small', { class: 'keysub' }, 'Over the water'), h('div', { class: 'keyrow', data: { chapter: '2' } }, slots.filter((_, i) => keys[i].chapter === 2))] : null,
    about);
}
