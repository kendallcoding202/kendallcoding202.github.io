/*
 * Kovyr Proof trust page.
 *
 * computeState() is the one rule that decides "verified" vs "lapsed", shared
 * by the trust page (in the visitor's browser) and build-badges.js (when it
 * draws a firm's badge images). It fails safe: anything missing, malformed,
 * expired, from the future, or not explicitly "verified" is Lapsed.
 *
 * Firm data (firms/<slug>/firm.json, or inline in sample.html):
 * {
 *   "firm": "Maple Street Tax & Bookkeeping",
 *   "tagline": "Tax preparation and bookkeeping · Springfield",
 *   "status": "verified",                       // anything else = lapsed
 *   "lastVerified": "2026-10-26T06:00:00-05:00",
 *   "validUntil": "2026-11-25T06:00:00-05:00",  // capped at 31 days after lastVerified
 *   "proofUrl": "../demo/",                     // relative path or https:// only
 *   "coverage": "6 of 6 known laptops and 9 of 9 staff accounts enrolled",
 *   "protections": [{ "label": "...", "detail": "...", "source": "...", "met": true }]
 * }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KovyrTrust = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAY = 24 * 60 * 60 * 1000;
  var MAX_VALID_DAYS = 31;
  var CLOCK_SKEW_MS = 10 * 60 * 1000;

  /** → { state: 'verified' | 'lapsed', reason, lastVerified, validUntil } */
  function computeState(data, now) {
    now = typeof now === 'number' ? now : Date.now();
    var out = { state: 'lapsed', reason: 'invalid', lastVerified: null, validUntil: null };
    if (!data || typeof data !== 'object') return out;
    var last = Date.parse(data.lastVerified);
    var until = Date.parse(data.validUntil);
    if (isNaN(last)) return out;
    out.lastVerified = last;
    if (isNaN(until) || until <= last) {
      out.reason = 'invalid';
      return out;
    }
    // A typo can't make a badge valid for a year: cap the window.
    until = Math.min(until, last + MAX_VALID_DAYS * DAY);
    out.validUntil = until;
    if (data.status !== 'verified') out.reason = 'status';
    else if (last > now + CLOCK_SKEW_MS) out.reason = 'future';
    else if (now >= until) out.reason = 'expired';
    else {
      out.state = 'verified';
      out.reason = 'current';
    }
    return out;
  }

  /** Only relative links or https:// URLs; never javascript: or data:. */
  function safeUrl(url, fallback) {
    if (typeof url !== 'string' || !url) return fallback;
    if (/^https:\/\//i.test(url)) return url;
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) || /^\/\//.test(url)) return fallback;
    return url;
  }

  function isSlug(s) {
    return typeof s === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,62})$/.test(s);
  }

  /** For the sample page: dates relative to today so the demo stays current. */
  function withSampleDates(data, now) {
    var d = new Date(now);
    var last = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 6, 0, 0);
    if (last.getTime() > now) last = new Date(last.getTime() - DAY);
    var copy = JSON.parse(JSON.stringify(data));
    copy.lastVerified = last.toISOString();
    copy.validUntil = new Date(last.getTime() + 3 * DAY).toISOString();
    return copy;
  }

  var api = {
    computeState: computeState,
    safeUrl: safeUrl,
    isSlug: isSlug,
    withSampleDates: withSampleDates,
    MAX_VALID_DAYS: MAX_VALID_DAYS
  };

  if (typeof document === 'undefined') return api;

  /* ------------------------------------------------------------------ */
  /* Browser rendering                                                   */
  /* ------------------------------------------------------------------ */

  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') el.className = v;
        else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      });
    }
    (Array.isArray(children) ? children : [children]).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  }

  function icon(name) {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    var use = document.createElementNS(ns, 'use');
    use.setAttribute('href', '#i-' + name);
    svg.appendChild(use);
    return svg;
  }

  function fmtDateTime(ms) {
    try {
      return new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(ms));
    } catch (e) {
      return new Date(ms).toString();
    }
  }

  function fmtDate(ms) {
    try {
      return new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(ms));
    } catch (e) {
      return new Date(ms).toDateString();
    }
  }

  function render(rootEl, data, opts) {
    opts = opts || {};
    var B = window.KovyrBrand || { product: 'Kovyr Proof', company: 'Kovyr', contactEmail: 'kendall@kovyr.com' };
    var now = Date.now();
    var computed = computeState(data, now);
    // A preview may only ever downgrade the state, never upgrade it.
    var state = opts.forceLapsed ? 'lapsed' : computed.state;
    var verified = state === 'verified';
    var name = data.firm + (data.sample ? ' (sample)' : '');
    document.title = name + ': security checks · ' + B.product;
    rootEl.textContent = '';
    rootEl.setAttribute('data-state', state);

    var head = h('section', { class: 'firm-head', 'aria-labelledby': 'firm-name' }, [
      h('p', { class: 'eyebrow' }, 'Security trust page'),
      h('h1', { id: 'firm-name' }, name),
      data.tagline ? h('p', { class: 'tagline' }, data.tagline) : null
    ]);

    var last = computed.lastVerified;
    var statusBody = verified
      ? [
          h('p', { class: 'status-line' }, [h('strong', null, 'Last verified: '), h('time', { datetime: new Date(last).toISOString() }, fmtDateTime(last))]),
          h('p', { class: 'status-note' }, 'Checks run automatically. If no new check arrives by ' + fmtDate(computed.validUntil) + ', this page switches to "Lapsed" on its own.')
        ]
      : [
          h('p', { class: 'status-line' }, last ? [h('strong', null, 'Last verified: '), h('time', { datetime: new Date(last).toISOString() }, fmtDateTime(last))] : 'No current check on record.'),
          h('p', { class: 'status-note' }, B.product + " hasn't received a current check from this firm, so this page no longer shows it as verified. That doesn't mean something is wrong, only that it hasn't been checked recently.")
        ];
    var statusCard = h('section', { class: 'status-card ' + (verified ? 'is-verified' : 'is-lapsed'), 'aria-labelledby': 'status-title' }, [
      h('div', { class: 'status-top' }, [
        h('span', { class: 'status-icon' }, icon(verified ? 'check' : 'pause')),
        h('div', null, [
          h('h2', { id: 'status-title' }, verified ? 'Security checks verified' : 'Security checks lapsed'),
          h('p', { class: 'status-by' }, 'by ' + B.product)
        ])
      ])
    ].concat(statusBody, [data.coverage ? h('p', { class: 'coverage' }, [h('strong', null, 'Covers: '), data.coverage]) : null]));

    var items = (data.protections || []).map(function (p) {
      var mark = !verified ? 'dash' : p.met === false ? 'gap' : 'check';
      var word = !verified ? 'Not current' : p.met === false ? 'Not met' : 'Verified';
      return h('li', { class: 'protection p-' + mark }, [
        h('span', { class: 'p-icon' }, [icon(mark), h('span', { class: 'visually-hidden' }, word + ': ')]),
        h('div', null, [
          h('span', { class: 'p-label' }, p.label),
          p.detail ? h('span', { class: 'p-detail' }, p.detail) : null,
          p.source ? h('span', { class: 'p-source' }, 'Source: ' + p.source) : null
        ])
      ]);
    });
    var protections = h('section', { class: 'protections', 'aria-labelledby': 'prot-title' }, [
      h('h2', { id: 'prot-title' }, verified ? 'Protections checked' : 'Last known results (not current)'),
      h('ul', { class: 'protection-list' }, items)
    ]);

    var proofUrl = safeUrl(data.proofUrl, '../demo/');
    var verify = h('section', { class: 'verify', 'aria-labelledby': 'verify-title' }, [
      h('h2', { id: 'verify-title' }, "Don't take our word for it"),
      h('p', null, 'Every check is signed, time-stamped and recorded in a public log. The verifier checks those signatures and log entries in your browser, so you don\'t have to trust the firm or ' + B.company + '.'),
      h('a', { class: 'btn btn-primary', href: proofUrl }, verified ? 'Verify the proof yourself' : 'See the last Proof Pack')
    ]);

    var limits = h('section', { class: 'limits', 'aria-labelledby': 'limits-title' }, [
      h('h2', { id: 'limits-title' }, 'What this does and doesn\'t prove'),
      h('div', { class: 'limits-grid' }, [
        h('div', { class: 'limit-box does' }, [
          h('h3', null, 'It shows'),
          h('ul', null, [
            h('li', null, 'These protections were switched on and checked, on the devices and accounts listed, at the times shown.'),
            h('li', null, 'The records can\'t be quietly edited or backdated later, not even by ' + B.company + ', because each one is in a public log.'),
            h('li', null, 'Where each fact came from, so you can tell automatic checks from records kept by staff.')
          ])
        ]),
        h('div', { class: 'limit-box doesnt' }, [
          h('h3', null, 'It doesn\'t show'),
          h('ul', null, [
            h('li', null, 'That the firm can\'t be hacked or will never have a breach. Nobody can honestly promise that.'),
            h('li', null, 'That the firm is compliant with any law or standard. This is evidence, not a certification or an audit.'),
            h('li', null, 'Anything about devices or accounts that aren\'t enrolled.')
          ])
        ])
      ])
    ]);

    [head, statusCard, protections, verify, limits].forEach(function (s) { rootEl.appendChild(s); });

    if (data.sample) {
      var v = verified ? 'verified' : 'lapsed';
      rootEl.appendChild(h('section', { class: 'badge-demo', 'aria-labelledby': 'badge-title' }, [
        h('h2', { id: 'badge-title' }, 'The badge that links here'),
        h('p', null, 'Firms show this on their website and in their email signature. When checks lapse, the badge changes too.'),
        h('div', { class: 'badge-row' }, [
          h('picture', null, [
            h('source', { srcset: 'img/' + v + '-web-dark.svg', media: '(prefers-color-scheme: dark)' }),
            h('img', { src: 'img/' + v + '-web-light.svg', width: '280', height: '64', alt: verified ? 'Website badge: Security checks verified, ' + B.product : 'Website badge: Security checks lapsed, ' + B.product })
          ]),
          h('picture', null, [
            h('source', { srcset: 'img/' + v + '-email-dark.png', media: '(prefers-color-scheme: dark)' }),
            h('img', { src: 'img/' + v + '-email-light.png', width: '232', height: '40', alt: 'Email signature badge' })
          ])
        ])
      ]));
    }
    return state;
  }

  function showError(rootEl, title, text) {
    rootEl.textContent = '';
    rootEl.setAttribute('data-state', 'unknown');
    rootEl.appendChild(h('section', { class: 'status-card is-lapsed' }, [
      h('h1', null, title),
      h('p', null, text)
    ]));
  }

  function setupSampleToggle(rootEl, data) {
    var bar = document.getElementById('preview');
    if (!bar) return;
    var forced = /(?:^|[?&])state=lapsed(?:&|$)/.test(location.search);
    var buttons = bar.querySelectorAll('button[data-preview]');
    function paint(lapsed) {
      Array.prototype.forEach.call(buttons, function (b) {
        b.setAttribute('aria-pressed', String((b.getAttribute('data-preview') === 'lapsed') === lapsed));
      });
      render(rootEl, data, { forceLapsed: lapsed });
    }
    Array.prototype.forEach.call(buttons, function (b) {
      b.addEventListener('click', function () { paint(b.getAttribute('data-preview') === 'lapsed'); });
    });
    bar.hidden = false;
    paint(forced);
  }

  function boot() {
    if (window.KovyrBrand) window.KovyrBrand.applyBrand(document);
    var rootEl = document.getElementById('trust-root');
    if (!rootEl) return;
    var inline = document.getElementById('firm-data');
    if (inline) {
      var data;
      try {
        data = JSON.parse(inline.textContent);
      } catch (e) {
        showError(rootEl, 'This trust page is unavailable', 'Its data could not be read, so no status is shown.');
        return;
      }
      if (data.sample) {
        data = withSampleDates(data, Date.now());
        setupSampleToggle(rootEl, data);
      } else {
        render(rootEl, data);
      }
      return;
    }
    var m = /(?:^|[?&])f=([^&]+)/.exec(location.search);
    var slug = m ? decodeURIComponent(m[1]) : '';
    if (!isSlug(slug)) {
      showError(rootEl, 'No firm selected', 'This link is missing the firm\'s name. Use the link from the firm\'s badge.');
      return;
    }
    fetch('firms/' + slug + '/firm.json', { cache: 'no-store', credentials: 'omit' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        data.sample = false;
        render(rootEl, data);
      })
      .catch(function () {
        showError(rootEl, 'We couldn\'t find this firm\'s trust page', 'There is no current record for this firm, so no status is shown. If you followed a badge, ask the firm for an updated link.');
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  api.render = render;
  return api;
});
