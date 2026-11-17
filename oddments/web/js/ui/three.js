// Meeting the three you set out with: great-aunt Maribel's own, one to a
// page, each with where it came from and what it is like. Shown once, after
// her first call. Who they are is in core/story.js; this only lays it out.
import { SPECIES } from '../core/balance.js';
import { THREE, THREE_WORDS } from '../core/story.js';
import { h, sprite } from './dom.js';
import { elementTag } from './parts.js';
import { modal } from './modals.js';

/** One of the three: its picture, its name and what it is, its story, and what it is good for. */
const pageFor = (one) => [
  h('div', { class: 'threekin', data: { kind: one.kind } }, sprite(one.kind, false, 'flip')),
  h('div', { class: 'threename' }, h('h3', null, SPECIES[one.kind].name), elementTag(SPECIES[one.kind].element)),
  h('small', { class: 'threewhat' }, one.what),
  h('p', null, one.about),
  h('p', { class: 'note' }, one.knack),
];

/**
 * Opens the pages. `fresh` is true at the very start of a game (they are waiting in the hall);
 * a save from before this was written is told about them as old friends. `onDone` runs when read.
 */
export function meetTheThree(fresh, onDone) {
  const pages = [
    () => [h('div', { class: 'threerow' }, THREE.map((one) => sprite(one.kind, false, 'flip'))), h('p', null, fresh ? THREE_WORDS.open : THREE_WORDS.again)],
    ...THREE.map((one) => () => pageFor(one)),
    () => [h('div', { class: 'threerow' }, THREE.map((one) => sprite(one.kind, false, 'flip'))), h('p', null, THREE_WORDS.close)],
  ];
  let at = 0;
  const page = h('div', { class: 'threepage' });
  const dots = h('div', { class: 'howdots' }, pages.map(() => h('i')));
  const dialog = modal({
    title: 'Three of hers', cls: 'three', body: [page, dots], onClose: onDone, fixed: true,
    actions: [{ id: 'next', label: 'Next', onClick: () => {
      if (at < pages.length - 1) { at++; show(); return false; }
      return true;
    } }],
  });
  const button = dialog.el.querySelector('[data-id="next"]');
  function show() {
    page.replaceChildren(...pages[at]());
    page.scrollTop = 0;
    Array.from(dots.children).forEach((dot, i) => dot.classList.toggle('on', i === at));
    button.textContent = at < pages.length - 1 ? 'Next' : 'Off we go';
    dialog.el.dataset.page = `${at + 1}/${pages.length}`;
  }
  show();
  return dialog;
}
