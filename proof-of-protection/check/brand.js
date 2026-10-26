/*
 * Brand constants: the ONE place to rename the company or product.
 *
 * Used by the Kovyr Check page, the trust pages in ../badge/, and the badge
 * generator (badge/build-badges.js). Pages ship with the default names as
 * fallback text; on load, applyBrand() swaps every [data-brand] element and
 * any <title data-template> to these values. After renaming, re-run
 * `node badge/build-badges.js` so the badge images pick up the new name.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KovyrBrand = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var COMPANY = 'Kovyr';
  var PRODUCT = 'Kovyr Proof';

  var BRAND = {
    company: COMPANY,
    product: PRODUCT,
    // Free email-security grader (lead magnet).
    check: COMPANY + ' Check',
    // Paid one-time assessment the free check upsells to.
    fullCheck: 'Proof Check',
    // Where "Get the full Proof Check" emails go.
    contactEmail: 'kendall@kovyr.com'
  };

  function fill(template) {
    return String(template).replace(/\{(\w+)\}/g, function (m, key) {
      return Object.prototype.hasOwnProperty.call(BRAND, key) ? BRAND[key] : m;
    });
  }

  // Swap brand text into a document. Safe to call more than once.
  function applyBrand(doc) {
    var nodes = doc.querySelectorAll('[data-brand]');
    for (var i = 0; i < nodes.length; i++) {
      var key = nodes[i].getAttribute('data-brand');
      if (!Object.prototype.hasOwnProperty.call(BRAND, key)) continue;
      nodes[i].textContent = BRAND[key];
      if (key === 'contactEmail' && nodes[i].tagName === 'A') nodes[i].setAttribute('href', 'mailto:' + BRAND[key]);
    }
    var t = doc.querySelector('title[data-template]');
    if (t) doc.title = fill(t.getAttribute('data-template'));
  }

  return Object.freeze({
    company: BRAND.company,
    product: BRAND.product,
    check: BRAND.check,
    fullCheck: BRAND.fullCheck,
    contactEmail: BRAND.contactEmail,
    fill: fill,
    applyBrand: applyBrand
  });
});
