// Small pieces of screen used in more than one place.
import { ELEMENTS, SPECIES, STATS, MAX_LEVEL, moveOf, softSpotOf, statAt, xpNeeded, movesAt } from '../core/balance.js';
import { aboutOf } from '../core/story.js';
import { h, sprite } from './dom.js';
import { modal } from './modals.js';

/** A coloured tag naming an element. */
export const elementTag = (element) => h('span', { class: `el el-${element}` }, ELEMENTS[element].name);

export const heirloomTag = () => h('span', { class: 'heirloom', title: 'Heirloom' }, 'Heirloom');

export function bar(cls, fraction, text) {
  const fill = h('i');
  fill.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
  return h('div', { class: `bar ${cls}` }, fill, text ? h('span', null, text) : null);
}

/** One line saying what a move does, from its numbers. */
export function moveLine(id) {
  const move = moveOf(id);
  const parts = [];
  if (move.power) parts.push(`${move.kind === 'sweep' ? 'Hits everyone' : 'Hits'} for ${Math.round(move.power * 100)}% Oomph`);
  if (move.mend) parts.push(`Mends ${move.aim === 'allies' ? 'your side' : move.aim === 'self' ? 'itself' : 'a friend'} by ${Math.round(move.mend * 100)}%`);
  if (move.boost) parts.push(move.wait === 0 && move.boost.turns === 1 ? 'Takes a third less until its next turn' : `${STATS[move.boost.stat].name} +${Math.round(move.boost.by * 100)}% for ${move.boost.turns} turns`);
  if (move.sap) parts.push(`${STATS[move.sap.stat].name} −${Math.round(move.sap.by * 100)}% for ${move.sap.turns} turns`);
  if (move.wait) parts.push(`then waits ${move.wait} turn${move.wait === 1 ? '' : 's'}`);
  return parts.join(', ');
}

/** "a" or "an", for the name that follows. */
export const aOrAn = (name) => (/^[AEIOU]/i.test(name) ? 'an' : 'a');

/** How an element stands in the ring, in a sentence. */
export function ringLine(element) {
  const beats = ELEMENTS[element].beats;
  const beatenBy = Object.keys(ELEMENTS).find((id) => ELEMENTS[id].beats === element);
  return `Strong against ${ELEMENTS[beats].name}. Weak against ${ELEMENTS[beatenBy].name}.`;
}

/**
 * A card about one Clutterkin: a friend (with its experience and all its
 * moves) or a restless one met in a fight (with its Huff and soft spot).
 * `name` is what a friend is called, if you have given it a name of your own.
 * `grown` is true for a friend that has grown up: its grown form's picture, name and strength.
 */
export function oddmentCard({ species, level, heirloom = false, xp = null, huff = null, name = '', grown = false, actions = [] }) {
  const kind = SPECIES[species];
  const big = !!grown && !!kind.grown;
  const kindName = big ? kind.grown.name : kind.name;
  const called = name || kindName;
  const known = movesAt(species, level);
  const stats = ['hp', 'oomph', 'grit', 'pep'].map((key) => h('div', { class: 'stat' }, h('small', null, STATS[key].name), h('b', null, String(statAt(kind[key], level, big)))));
  const moves = kind.moves.map(([id, at]) => {
    const move = moveOf(id);
    const learned = known.includes(id);
    return h('div', { class: `moverow${learned ? '' : ' locked'}` },
      h('div', null, h('b', null, move.name), ' ', elementTag(move.element), learned ? null : h('small', { class: 'at' }, ` at level ${at}`)),
      h('small', null, learned ? `${moveLine(id)}.` : '???'));
  });
  const body = [
    h('div', { class: 'cardtop' },
      sprite(big ? `${species}_grown` : species, heirloom, kind.boss ? 'big' : big ? 'grown' : ''),
      h('div', null,
        h('div', { class: 'tags' }, called === kindName ? null : h('b', { class: 'kindname', data: { act: 'kind' } }, kindName), elementTag(kind.element), big ? h('span', { class: 'growntag' }, 'Grown up') : null, heirloom ? heirloomTag() : null, kind.boss ? h('span', { class: 'bosstag' }, 'Boss') : null),
        h('p', { class: 'blurb' }, kind.blurb),
        h('small', null, ringLine(kind.element)))),
    // One of the three you set out with has its story here too.
    aboutOf(species) ? h('p', { class: 'about', data: { act: 'about' } }, aboutOf(species).about.split(kind.name).join(called)) : null,
    xp === null ? null : (level >= MAX_LEVEL ? h('small', null, 'As strong as it gets.') : bar('xp', xp / xpNeeded(level), `${xp} / ${xpNeeded(level)} to level ${level + 1}`)),
    h('div', { class: 'stats' }, stats),
    huff === null ? null : h('p', { class: 'note' }, kind.boss
      ? 'Too proud to reach. It will not come home, however kindly you ask.'
      : `In a Huff: ${huff} pip${huff === 1 ? '' : 's'}. Has a soft spot for ${ELEMENTS[softSpotOf(kind.element)].name}: a friend of that element at your side makes reaching out work better.`),
    h('div', { class: 'movelist' }, moves),
    // Growing up: when it will, or that it has (and what it was called when it was small).
    xp === null || !kind.grown ? null : h('small', { class: 'note', data: { act: 'grows' } }, big
      ? `Grown up: bigger, and stronger in every way. It was ${aOrAn(kind.name)} ${kind.name} when it was small.`
      : level >= kind.grown.at ? `Ready to grow up into ${aOrAn(kind.grown.name)} ${kind.grown.name}: it will at its next level.`
        : `Grows up into something new at level ${kind.grown.at}.`),
  ];
  return modal({ title: `${called} · Lv ${level}`, cls: 'oddment', body, actions });
}
