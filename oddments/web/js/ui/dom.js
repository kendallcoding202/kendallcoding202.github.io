// Tiny DOM helpers. Everything on screen is built with these, as elements
// and text, never by writing markup from strings: a name can then contain
// anything at all and still only ever be text.

/**
 * h('div', { class: 'card', onclick: fn }, child, 'text', ...)
 * Null and false children are skipped; arrays are flattened.
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
      else if (key === 'data') Object.assign(el.dataset, value);
      else if (key in el && key !== 'list') el[key] = value;
      else el.setAttribute(key, value);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else el.append(child);
  }
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

export const icon = (name, cls = '') => h('img', { class: `ic ${cls}`.trim(), src: `assets/icons/${name}.webp`, alt: '', draggable: false });

/** The picture of an Oddment (its Heirloom colours if it has them) or of a person. */
export const spriteSrc = (species, heirloom = false) => `assets/sprites/${species}${heirloom ? '_heirloom' : ''}.webp`;
export const sprite = (species, heirloom = false, cls = '') => h('img', { class: cls, src: spriteSrc(species, heirloom), alt: '', draggable: false });

export function setText(el, text) {
  const value = String(text);
  if (el.__text !== value) { el.__text = value; el.textContent = value; }
}
export function setWidth(el, fraction) {
  const value = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
  if (el.__w !== value) { el.__w = value; el.style.width = value; }
}

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
