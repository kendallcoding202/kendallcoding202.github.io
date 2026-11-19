// Things that begin without your doing anything, said once each on a card
// of its own: a ringleader has come out of doors with a wish; somebody is
// waiting by the road. And the list of wishes, which "What to do" opens.
//
// (The owner, on the first build that had these: "I also didn't see Tansy so
// I'm not sure, where is she supposed to be?" and "What are wishes? I haven't
// seen them yet". A mark in the world and a line in the journal were not
// enough: nobody looks for what they have not been told exists.)
import { SPECIES, roomOf } from '../core/balance.js';
import { CAST } from '../core/story.js';
import { h, sprite } from './dom.js';
import { modal } from './modals.js';
import { elementTag, bar } from './parts.js';
import { mapDialog } from './map.js';

const listed = (names) => (names.length <= 2 ? names.join(' and ') : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`);

/** What a wish is, in the fewest words that say all of it. */
const WISH_WORDS = 'A ringleader is too proud to reach. But every one of them has a wish. Grant it, and that ringleader asks for one more bout, a friendly one. Win that, and it comes home with you.';

/** One ringleader's wish, as a row of the list: its picture and name, what it wants, and how that stands. */
function wishRow(one) {
  const kind = SPECIES[one.species];
  const place = roomOf(one.room).name;
  return h('div', { class: `wishrow${one.home ? ' home' : one.granted ? ' granted' : ''}`, data: { wish: one.species, stands: one.home ? 'home' : one.granted ? 'granted' : 'open' } },
    sprite(one.species),
    h('div', null,
      h('b', null, kind.name, ' ', elementTag(kind.element)),
      h('small', { class: 'wishwant' }, one.wish),
      one.home ? h('small', { class: 'wishstate' }, '♥ Lives with you now.')
        : one.granted ? h('small', { class: 'wishstate' }, `Granted. Waiting outside ${place}, for a friendly bout.`)
          : h('small', null, `${one.how} Outside ${place}.`),
      one.home || one.granted ? null : bar('xp', one.have / one.need, `${one.have} of ${one.need}`)));
}

/** The list of wishes: every ringleader whose place is calm, what it wants and how far along that is. */
export function wishesDialog(game) {
  const all = game.wishes();
  const out = all.filter((one) => one.calm);
  const later = all.length - out.length;
  return modal({
    title: 'Wishes', cls: 'wishes',
    body: [
      h('p', { class: 'note' }, `${WISH_WORDS} Only one ringleader walks with you at a time.`),
      out.length ? out.map(wishRow) : h('p', null, 'No ringleader is out of doors yet. Calm a place, and its ringleader will be standing outside it, with a wish.'),
      later > 0 && out.length ? h('small', { class: 'wishlater' }, `${later} more ${later === 1 ? 'ringleader has a wish' : 'ringleaders have wishes'}, to be heard when ${later === 1 ? 'its place is' : 'their places are'} calm.`) : null,
    ],
    actions: [{ id: 'ok', label: 'OK', kind: 'plain' }],
  });
}

/**
 * Said once, the first time any ringleader is out of doors: that they are, where, and what a wish
 * is. `out` is who (the ones `game.waiting()` marks `chief`). `onDone` runs when the card is shut.
 */
export function wishNews(game, out, onDone) {
  const names = out.map((one) => SPECIES[one.id].name);
  const first = out[0];
  return modal({
    title: 'Ringleaders have wishes', cls: 'news', fixed: true, onClose: onDone,
    body: [
      h('div', { class: 'newspic' }, out.slice(0, 3).map((one) => sprite(one.id))),
      h('p', null, `${listed(names)} ${names.length === 1 ? 'is' : 'are'} calm now, and ${names.length === 1 ? 'has' : 'have'} come out of doors. Every ringleader does, once its place is calm: look on the grass beside ${names.length === 1 ? roomOf(first.room).name : 'each calm place'}.`),
      h('p', null, WISH_WORDS),
      h('p', { class: 'note' }, 'Walk up to one to see what it wants. Every wish, and how far along it is, is listed under "What to do". Only one ringleader walks with you at a time.'),
    ],
    actions: [
      { id: 'wishes', label: 'See the wishes', kind: 'plain', onClick: () => { setTimeout(() => wishesDialog(game), 0); } },
      { id: 'ok', label: 'OK' },
    ],
  });
}

/**
 * Said once for each of her meetings, when it comes due: that somebody is waiting, and where.
 * `aside` is what the journal says of it (see rival.rivalAside); `again` is true after the first.
 */
export function rivalNews(game, aside, again, onDone) {
  const cast = CAST.tansy;
  return modal({
    title: again ? `${cast.name} is waiting again` : 'Somebody is waiting for you', cls: 'news', fixed: true, onClose: onDone,
    body: [
      h('div', { class: 'newspic person' }, sprite(cast.art)),
      h('p', null, aside.detail),
      h('p', { class: 'note' }, again ? 'The map marks her with a gold !, and a gold ! at the edge of the screen points her way.'
        : 'She is from Spick & Span, like Mr. Spick, and thinks a mess belongs in a box. The map marks her with a gold !, and a gold ! at the edge of the screen points her way. Win or lose, nothing is taken from you.'),
    ],
    actions: [
      { id: 'map', label: 'Map', kind: 'plain', onClick: () => { setTimeout(() => mapDialog(game), 0); } },
      { id: 'ok', label: 'OK' },
    ],
  });
}
