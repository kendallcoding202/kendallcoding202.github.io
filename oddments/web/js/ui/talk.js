// Someone speaking: who they are, their picture, and their words a line at a
// time. One button hears the next line; the last one ends it.
import { h, sprite } from './dom.js';
import { modal } from './modals.js';
import { CAST } from '../core/story.js';
import { play } from '../platform/sound.js';

/** Plays `lines` (each { who, text }) one after another. `onDone` runs when the last has been heard. */
export function converse(lines, onDone) {
  let at = 0;
  const name = h('b');
  const role = h('small');
  const face = h('div', { class: 'talkface' });
  const words = h('p', { class: 'talkwords' });
  const dialog = modal({
    title: h('span', { class: 'talkname' }, name, role), cls: 'talk', fixed: true,
    body: [h('div', { class: 'talkrow' }, face, words)],
    actions: [{ id: 'next', label: 'Next', onClick: () => {
      if (at < lines.length - 1) { at++; show(); return false; }
      if (onDone) onDone();
      return true;
    } }],
  });
  const button = dialog.el.querySelector('[data-id="next"]');
  function show() {
    const person = CAST[lines[at].who];
    name.textContent = person.name;
    role.textContent = person.role;
    if (face.dataset.who !== lines[at].who) { face.dataset.who = lines[at].who; face.replaceChildren(sprite(person.art)); }
    words.textContent = lines[at].text;
    play('talk', { who: lines[at].who });
    button.textContent = at < lines.length - 1 ? 'Next' : 'OK';
    dialog.el.dataset.line = `${at + 1}/${lines.length}`;
  }
  // Low on the screen, like someone standing in front of you, with the world still in view above.
  dialog.el.parentElement.classList.add('low');
  show();
  return dialog;
}
