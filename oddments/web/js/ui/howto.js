// How a fight works, in four small pages. Shown once, before your first
// fight, and again whenever it is asked for from the fight's menu. Every
// number on it is read from the rules, so it cannot fall out of step.
import { ELEMENTS, ELEMENT_IDS, STATS, STAT_IDS, STRONG, WEAK, REACH, CALLS, CALL_IDS } from '../core/balance.js';
import { h, sprite } from './dom.js';
import { modal } from './modals.js';

/** What the tag over a target says a move will do to it: the same words wherever they are shown. */
export const EDGE_WORDS = { strong: 'Hurts more', weak: 'Hurts less' };
const share = (mult) => Math.round(Math.abs(mult - 1) * 100);

/** The ring of elements, from one that beats the next, round to the first again. */
function ring() {
  const order = [ELEMENT_IDS[0]];
  while (order.length < ELEMENT_IDS.length) order.push(ELEMENTS[order[order.length - 1]].beats);
  const chip = (id) => h('b', { class: `ringchip el-${id}` }, ELEMENTS[id].name);
  return h('div', { class: 'elring' }, order.map((id) => [chip(id), h('i', null, '›')]), chip(order[0]));
}

const PAGES = [
  () => [
    h('h3', null, 'Every move has an element'),
    h('p', null, 'So has every Clutterkin: in a fight it is written under each of them. Each element beats the next one along:'),
    ring(),
    h('p', null, 'When you choose who to hit, a tag over them says what your move will do to them:'),
    h('div', { class: 'howrow' }, h('span', { class: 'edge strong' }, EDGE_WORDS.strong), h('small', null, `Your move beats their element: ${share(STRONG)}% more damage.`)),
    h('div', { class: 'howrow' }, h('span', { class: 'edge weak' }, EDGE_WORDS.weak), h('small', null, `Their element beats your move: ${share(WEAK)}% less damage.`)),
    h('p', { class: 'note' }, 'No tag means the usual amount. The tag is about your move, not about how tough they are.'),
  ],
  () => [
    h('h3', null, 'Four numbers'),
    h('p', null, 'Every Clutterkin has four. Tap one, in a fight or on Friends, to see its own.'),
    STAT_IDS.map((id) => h('div', { class: 'howrow', data: { stat: id } }, h('b', { class: 'howstat' }, STATS[id].name), h('small', null, `${STATS[id].hint} ${STATS[id].more}`))),
    h('p', { class: 'note' }, 'All four go up a little with every level.'),
  ],
  () => [
    h('h3', null, 'Making friends'),
    h('div', { class: 'howrow' }, h('div', { class: 'howkin' }, sprite('dandepuff'), h('div', { class: 'pips' }, h('i', { class: 'on' }), h('i', { class: 'on' }), h('i'))),
      h('small', null, 'The orange pips under a restless Clutterkin are its Huff: how worked up it is.')),
    h('p', null, `Reach out takes ${REACH.base} pips off (${REACH.base + REACH.soft} if a friend whose element it beats is standing with you). When none are left it settles down, and comes home with you if you win.`),
    h('p', null, 'If it is not ready it turns its back and tells you so. Reach out again next round.'),
    h('p', { class: 'note' }, `Every hit you land puts ${REACH.hitBack === 1 ? 'a pip' : `${REACH.hitBack} pips`} back, so stop hitting the one you want. A ringleader cannot be reached at all.`),
  ],
  () => [
    h('h3', null, 'Your part'),
    h('p', null, 'Your friends take turns to use a move. On top of that you make one Call a round:'),
    CALL_IDS.map((id) => h('div', { class: 'howrow' }, h('b', { class: 'howcall' }, CALLS[id].name), h('small', null, CALLS[id].desc))),
    h('p', { class: 'note' }, 'A friend whose Health runs out sits the rest of the fight out. If all three do, you carry them home to rest, and keep everything they learned.'),
  ],
];

/** Opens the pages. `onDone` runs when they have been read, or closed. */
export function howToFight(onDone) {
  let at = 0;
  const page = h('div', { class: 'howpage' });
  const dots = h('div', { class: 'howdots' }, PAGES.map(() => h('i')));
  const dialog = modal({
    title: 'How a fight works', cls: 'howto', body: [page, dots], onClose: onDone,
    actions: [{ id: 'next', label: 'Next', onClick: () => {
      if (at < PAGES.length - 1) { at++; show(); return false; }
      return true;
    } }],
  });
  const button = dialog.el.querySelector('[data-id="next"]');
  function show() {
    page.replaceChildren(...PAGES[at]().flat());
    page.scrollTop = 0;
    Array.from(dots.children).forEach((dot, i) => dot.classList.toggle('on', i === at));
    button.textContent = at < PAGES.length - 1 ? 'Next' : 'Got it';
    dialog.el.dataset.page = `${at + 1}/${PAGES.length}`;
  }
  show();
  return dialog;
}
