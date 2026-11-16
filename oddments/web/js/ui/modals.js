// Dialogs and toasts.
import { h, $ } from './dom.js';

const root = () => $('#modals');
export const modalOpen = () => root().childElementCount > 0;

/**
 * Opens a dialog. `actions` is a list of { id, label, kind, onClick }; a
 * click runs onClick and closes unless it returns false. With `fixed` the
 * dialog has no × and tapping outside does nothing: an action must be taken.
 */
export function modal({ title, cls = '', body = [], actions = [], fixed = false, onClose }) {
  let open = true;
  function close() {
    if (!open) return;
    open = false;
    scrim.remove();
    if (onClose) onClose();
  }
  const footer = actions.length ? h('footer', null, actions.map((action) => h('button', {
    class: `btn ${action.kind || 'gold'}`, data: { id: action.id },
    onclick: () => { if (!action.onClick || action.onClick() !== false) close(); },
  }, action.label))) : null;
  const box = h('div', { class: `modal ${cls}`.trim(), role: 'dialog', 'aria-modal': 'true' },
    h('header', null, h('span', null, title), fixed ? null : h('button', { class: 'x', 'aria-label': 'Close', onclick: close }, '×')),
    h('div', { class: 'body' }, body),
    footer);
  const scrim = h('div', { class: 'scrim', onclick: (e) => { if (e.target === scrim && !fixed) close(); } }, box);
  root().append(scrim);
  return { el: box, close };
}

export function toast(text, { kind = '' } = {}) {
  const el = h('div', { class: `toast ${kind}`.trim() }, text);
  $('#toasts').append(el);
  setTimeout(() => el.classList.add('out'), 2200);
  setTimeout(() => el.remove(), 2700);
}
