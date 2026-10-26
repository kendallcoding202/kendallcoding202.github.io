/*
 * Kovyr Check page: wires the form to grader.js + doh.js and renders results.
 * DNS data is untrusted (anyone can publish any TXT record), so everything is
 * inserted with textContent via h(); never innerHTML.
 */
(function () {
  'use strict';

  var G = window.KovyrGrader;
  var D = window.KovyrDoh;
  var B = window.KovyrBrand;
  B.applyBrand(document);

  var form = document.getElementById('check-form');
  var input = document.getElementById('domain-input');
  var button = document.getElementById('check-button');
  var errorEl = document.getElementById('domain-error');
  var progress = document.getElementById('progress');
  var progressTitle = document.getElementById('progress-title');
  var results = document.getElementById('results');
  var live = document.getElementById('live');
  var running = false;
  var buttonText = button.textContent;

  var STATUS_WORDS = { pass: 'Good', warn: 'Needs attention', fail: 'Problem', info: 'For your information', error: "Couldn't check" };
  var SEV_WORDS = { critical: 'Fix first', major: 'Important', minor: 'Worth doing', optional: 'Nice to have' };
  var GRADE_ICON = { strong: 'pass', 'needs-work': 'warn', 'at-risk': 'fail', incomplete: 'error' };
  var CHECK_ORDER = ['dmarc', 'spf', 'dkim', 'mx', 'mtaSts', 'tlsRpt'];
  var TLD_TYPOS = { con: 'com', cmo: 'com', ocm: 'com', vom: 'com', xom: 'com', comm: 'com', coom: 'com', nte: 'net', ent: 'net', nett: 'net', ogr: 'org', rog: 'org', orgg: 'org' };

  /* ---------------------------------------------------------- helpers */

  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      });
    }
    append(el, children);
    return el;
  }

  function append(el, children) {
    if (children === null || children === undefined || children === false) return;
    if (!Array.isArray(children)) children = [children];
    children.forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
  }

  function icon(name, cls) {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    if (cls) svg.setAttribute('class', cls);
    var use = document.createElementNS(ns, 'use');
    use.setAttribute('href', '#i-' + name);
    svg.appendChild(use);
    return svg;
  }

  function announce(text) {
    live.textContent = '';
    setTimeout(function () { live.textContent = text; }, 30);
  }

  function formatTime(iso) {
    try {
      return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
    } catch (e) {
      return new Date(iso).toLocaleString();
    }
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function copyText(text, btn) {
    var done = function (ok) {
      var old = btn.getAttribute('data-label');
      btn.textContent = ok ? 'Copied' : 'Select and copy';
      announce(ok ? 'Copied to clipboard' : 'Copy failed. Select the text and copy it.');
      setTimeout(function () { btn.textContent = old; }, 2000);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
      return;
    }
    try {
      var ta = h('textarea', { 'aria-hidden': 'true', class: 'visually-hidden' });
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      done(ok);
    } catch (e) {
      done(false);
    }
  }

  /* ------------------------------------------------------------ input */

  function showInputError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
    input.setAttribute('aria-invalid', 'true');
    input.focus();
  }

  function clearInputError() {
    errorEl.hidden = true;
    errorEl.textContent = '';
    input.removeAttribute('aria-invalid');
  }

  function setBusy(busy, domain) {
    button.disabled = busy;
    button.textContent = busy ? 'Checking…' : buttonText;
    form.setAttribute('aria-busy', busy ? 'true' : 'false');
    if (busy) {
      results.hidden = true;
      results.textContent = '';
      progressTitle.textContent = 'Checking ' + domain + '…';
      Array.prototype.forEach.call(progress.querySelectorAll('li'), function (li) { li.classList.remove('done'); });
      progress.hidden = false;
      announce('Checking ' + domain);
    } else {
      progress.hidden = true;
    }
  }

  function markStep(step) {
    var li = progress.querySelector('li[data-step="' + step + '"]');
    if (li) li.classList.add('done');
  }

  function run(raw) {
    if (running) return;
    var n = G.normalizeInput(raw);
    if (!n.ok) {
      showInputError(n.error);
      return;
    }
    clearInputError();
    if (n.domain !== input.value.trim().toLowerCase() && n.kind === 'domain') input.value = n.domain;
    running = true;
    setBusy(true, n.domain);
    var resolver = D.createResolver();
    G.runCheck(n.domain, resolver.resolve, { onProgress: markStep })
      .catch(function () { return { kind: 'unreachable', domain: n.domain }; })
      .then(function (report) {
        running = false;
        setBusy(false);
        render(report);
        try { history.replaceState(null, '', '#d=' + encodeURIComponent(n.domain)); } catch (e) { /* file:// etc. */ }
      });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    run(input.value);
  });
  input.addEventListener('input', function () {
    if (!errorEl.hidden) clearInputError();
  });

  /* ---------------------------------------------------------- render */

  function render(report) {
    results.textContent = '';
    if (report.kind === 'nxdomain') renderNotFound(report.domain);
    else if (report.kind === 'unreachable') renderUnreachable(report.domain);
    else renderReport(report);
    results.hidden = false;
    var title = document.getElementById('result-title');
    if (title) {
      title.focus({ preventScroll: true });
      results.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    }
  }

  function againRow(domain) {
    return h('div', { class: 'again' }, [
      domain ? h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { run(domain); } }, 'Try again') : null,
      h('button', { type: 'button', class: 'btn btn-secondary', onclick: checkAnother }, 'Check another domain')
    ]);
  }

  function checkAnother() {
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    input.focus({ preventScroll: true });
    input.select();
  }

  function renderNotFound(domain) {
    var labels = domain.split('.');
    var fix = TLD_TYPOS[labels[labels.length - 1]];
    var suggestion = fix ? labels.slice(0, -1).concat(fix).join('.') : null;
    results.appendChild(h('div', { class: 'panel message err' }, [
      h('h2', { id: 'result-title', tabindex: '-1' }, "We couldn't find " + domain),
      h('p', null, "That domain doesn't exist in public DNS. Check the spelling of the part after the @."),
      suggestion ? h('p', null, [
        h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { input.value = suggestion; run(suggestion); } }, 'Check ' + suggestion + ' instead')
      ]) : null,
      againRow(null)
    ]));
    announce("Couldn't find " + domain);
  }

  function renderUnreachable(domain) {
    results.appendChild(h('div', { class: 'panel message err' }, [
      h('h2', { id: 'result-title', tabindex: '-1' }, "We couldn't reach a DNS service"),
      h('p', null, "Your browser couldn't get an answer from Cloudflare's or Google's public DNS, so nothing has been graded. A firewall, VPN or ad blocker may be blocking cloudflare-dns.com and dns.google. Check your connection and try again."),
      againRow(domain)
    ]));
    announce("Couldn't reach a DNS service");
  }

  function renderReport(r) {
    results.appendChild(gradeCard(r));
    results.appendChild(fixesSection(r));
    results.appendChild(ctaSection(r));
    results.appendChild(checksSection(r));
    results.appendChild(againRow(null));
    announce('Result for ' + r.domain + ': ' + r.grade.label);
  }

  function gradeCard(r) {
    var g = r.grade;
    var scale = null;
    if (g.id !== 'incomplete') {
      scale = h('ol', { class: 'grade-scale', 'aria-hidden': 'true' }, [
        ['at-risk', 'At risk'], ['needs-work', 'Needs work'], ['strong', 'Strong']
      ].map(function (s) {
        return h('li', { class: 's-' + s[0] + (s[0] === g.id ? ' on' : '') }, s[1]);
      }));
    }
    var took = r.elapsedMs < 1000 ? 'in under a second' : 'in ' + (r.elapsedMs / 1000).toFixed(1) + ' s';
    return h('div', { class: 'grade-card grade-' + g.id }, [
      h('p', { class: 'grade-domain' }, [h('strong', null, r.domain), ' · Email by ' + r.provider.label]),
      h('h2', { class: 'grade-title', id: 'result-title', tabindex: '-1' }, [
        h('span', { class: 'grade-badge' }, icon(GRADE_ICON[g.id])),
        h('span', null, [h('span', { class: 'visually-hidden' }, 'Grade: '), g.label])
      ]),
      h('p', { class: 'grade-headline' }, g.headline),
      h('p', { class: 'grade-summary' }, g.summary),
      scale,
      h('p', { class: 'grade-meta' }, 'Checked ' + formatTime(r.checkedAt) + ' from your browser ' + took + '.'),
      h('div', { class: 'grade-note' }, h('p', null,
        'This grade covers criminals pretending to be your domain. It can\'t tell whether one of your mailboxes has already been taken over; that needs a different kind of check.'))
    ]);
  }

  // Plain-English text where short technical terms ("-all", p=none,
  // %{i}.x.com) never split across lines.
  function prose(text) {
    var out = [];
    var re = /"[^"\s]{1,32}"|[^\s"]*[=:%{}~@+][^\s"]*|[+\-~?]all\b/g;
    var last = 0;
    var m;
    while ((m = re.exec(text))) {
      if (m[0].length > 32) continue;
      if (m.index > last) out.push(text.slice(last, m.index));
      out.push(h('span', { class: 'nowrap' }, m[0]));
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }

  // Text that may break after dots, colons and equals signs (for domains).
  function breakable(text) {
    var out = [];
    String(text).split(/([.:=])/).forEach(function (part) {
      if (!part) return;
      out.push(part);
      if (part === '.' || part === ':' || part === '=') out.push(h('wbr'));
    });
    return out;
  }

  // A DNS value as a <code> whose short terms never break internally.
  function recordValue(value) {
    var parts = String(value).split(/(\s+)/);
    return h('code', { class: 'record-value' }, parts.map(function (p) {
      if (!p || /^\s+$/.test(p)) return p;
      return h('span', { class: p.length > 28 ? 'tok tok-long' : 'tok' }, p);
    }));
  }

  function recordBox(rec) {
    var btn = h('button', { type: 'button', class: 'copy', 'data-label': 'Copy value', 'aria-label': 'Copy the ' + rec.type + ' record value for host ' + rec.host }, 'Copy value');
    btn.addEventListener('click', function () { copyText(rec.value, btn); });
    return h('div', { class: 'record' }, [
      h('div', { class: 'record-meta' }, [
        h('span', null, ['Type ', h('code', null, rec.type)]),
        h('span', null, ['Host / name ', h('code', null, rec.host)]),
        btn
      ]),
      recordValue(rec.value)
    ]);
  }

  function docsRow(docs) {
    if (!docs || !docs.length) return null;
    return h('p', { class: 'fix-docs' }, docs.map(function (d) {
      return h('a', { href: d.url, target: '_blank', rel: 'noopener noreferrer' }, [d.label, icon('ext', 'icon'), h('span', { class: 'visually-hidden' }, ' (opens in a new tab)')]);
    }));
  }

  function fixBody(f) {
    return [
      h('p', { class: 'fix-problem' }, prose(f.problem)),
      f.steps && f.steps.length ? h('ol', { class: 'fix-steps' }, f.steps.map(function (s) { return h('li', null, prose(s)); })) : null,
      f.record ? recordBox(f.record) : null,
      docsRow(f.docs)
    ];
  }

  function fixItem(f, num) {
    return h('li', { class: 'fix' }, [
      h('div', { class: 'fix-head' }, [
        num ? h('span', { class: 'fix-num', 'aria-hidden': 'true' }, String(num)) : null,
        h('div', null, [
          h('span', { class: 'sev sev-' + f.severity }, SEV_WORDS[f.severity]),
          h('h3', null, f.title)
        ])
      ])
    ].concat(fixBody(f)));
  }

  function fixesSection(r) {
    var sec = h('section', { 'aria-labelledby': 'fixes-title' });
    if (r.topFixes.length) {
      var n = r.topFixes.length;
      sec.appendChild(h('h2', { id: 'fixes-title' }, n === 1 ? 'Your top fix' : 'Your top ' + n + ' fixes, in order'));
      sec.appendChild(h('ol', { class: 'fix-list' }, r.topFixes.map(function (f, i) { return fixItem(f, i + 1); })));
      var more = r.fixes.length - n;
      if (more > 0) sec.appendChild(h('p', { class: 'hint' }, more + ' smaller suggestion' + (more === 1 ? ' is' : 's are') + ' under "All checks" below.'));
      var it = G.itEmail(r, B);
      sec.appendChild(h('div', { class: 'share-row' }, [
        h('a', { class: 'btn btn-secondary', href: G.mailto('', it.subject, it.body) }, 'Email these fixes to your IT person')
      ]));
      return sec;
    }
    if (r.grade.id === 'incomplete') {
      sec.appendChild(h('h2', { id: 'fixes-title' }, 'Try again in a minute'));
      sec.appendChild(h('p', null, 'Some lookups didn\'t get an answer, so we won\'t guess. The details are under "All checks" below.'));
      sec.appendChild(againRow(r.domain));
      return sec;
    }
    sec.appendChild(h('h2', { id: 'fixes-title' }, 'Nothing urgent to fix'));
    sec.appendChild(h('p', null, 'Your anti-spoofing records are in good shape. They tend to drift when you change email provider or add a new tool that sends email for you, so check again after any change. ' + B.product + ' re-checks them every day and tells you if they change.'));
    if (r.niceToHave.length) {
      sec.appendChild(h('h3', null, 'Nice to have'));
      sec.appendChild(h('ul', { class: 'fix-list' }, r.niceToHave.map(function (f) { return fixItem(f, null); })));
    }
    return sec;
  }

  function ctaSection(r) {
    var mail = G.ownerEmail(r, B);
    var lead = {
      'at-risk': 'Want help closing these gaps, and proof that they stay closed?',
      'needs-work': 'Want help closing these gaps, and proof that they stay closed?',
      strong: 'Your email is in good shape. Is the rest of your office?',
      incomplete: 'Want a person to look at this with you?'
    }[r.grade.id];
    return h('section', { class: 'cta', 'aria-labelledby': 'cta-title' }, [
      h('h2', { id: 'cta-title' }, 'Get the full ' + B.fullCheck),
      h('p', null, lead),
      h('p', null, 'Email spoofing is one piece. The full ' + B.fullCheck + ' also covers remote-access exposure, device encryption, passkeys, backups, and client SSNs sitting unencrypted. You get a signed, time-stamped Proof Pack that insurers, clients or regulators can verify without trusting ' + B.company + '.'),
      h('div', { class: 'cta-actions' }, [
        h('a', { class: 'btn btn-primary', id: 'cta-mail', href: G.mailto(B.contactEmail, mail.subject, mail.body) }, 'Get the full ' + B.fullCheck),
        h('a', { class: 'btn btn-secondary', href: '../demo/' }, 'See a sample Proof Pack')
      ]),
      h('p', { class: 'cta-note' }, [
        'Opens your email app with your domain and grade filled in. Nothing is sent until you press Send. No email app? Write to ',
        h('a', { href: 'mailto:' + B.contactEmail }, B.contactEmail),
        '.'
      ]),
      h('p', { class: 'cta-note' }, h('a', { href: '../' }, 'What is ' + B.product + '?'))
    ]);
  }

  function checkItem(c, r, topCodes) {
    var word = c.optional && c.status === 'info' ? 'Optional' : STATUS_WORDS[c.status];
    var body = h('div', { class: 'check-body' });
    body.appendChild(h('p', { class: 'why' }, [h('strong', null, 'Why it matters: '), c.why]));
    if (c.details && c.details.length) body.appendChild(h('ul', null, c.details.map(function (d) { return h('li', null, prose(d)); })));

    var recs = c.records && c.records.length ? c.records : c.record ? [c.record] : [];
    if (c.id === 'dkim') recs = c.found.map(function (f) { return f.selector + ': ' + f.record; });
    if (recs.length) {
      body.appendChild(h('span', { class: 'label' }, recs.length === 1 ? 'Record found' : 'Records found'));
      recs.forEach(function (rec) {
        body.appendChild(h('div', { class: 'record' }, recordValue(rec)));
      });
    }

    if (c.id === 'spf' && c.breakdown && c.breakdown.length) {
      var rows = c.breakdown.map(function (b) { return h('tr', null, [h('td', null, breakable(b.term)), h('td', null, String(b.lookups))]); });
      rows.push(h('tr', { class: 'total' }, [h('td', null, 'Total (limit 10)'), h('td', null, String(c.lookups))]));
      body.appendChild(h('table', { class: 'breakdown' }, [
        h('caption', { class: 'visually-hidden' }, 'DNS lookups used by each part of your SPF record'),
        h('thead', null, h('tr', null, [h('th', { scope: 'col' }, 'Part of your SPF record'), h('th', { scope: 'col' }, 'Lookups')])),
        h('tbody', null, rows)
      ]));
    }

    var fixes = r.fixes.concat(r.niceToHave).filter(function (f) {
      return (c.issues || []).some(function (code) { return code === f.code; });
    });
    fixes.forEach(function (f) {
      var idx = topCodes.indexOf(f.code);
      if (idx !== -1) {
        body.appendChild(h('p', null, [h('strong', null, 'How to fix: '), 'see fix ' + (idx + 1) + ' above, "' + f.title + '".']));
      } else {
        body.appendChild(h('div', { class: 'fix' }, [h('span', { class: 'sev sev-' + f.severity }, SEV_WORDS[f.severity]), h('h3', null, f.title)].concat(fixBody(f))));
      }
    });

    return h('details', { class: 'check check-' + c.status }, [
      h('summary', null, [
        h('span', { class: 'status status-' + c.status }, icon(c.status)),
        h('span', { class: 'check-text' }, [
          h('span', { class: 'check-name' }, c.name),
          h('span', { class: 'status-word w-' + c.status }, word),
          h('span', { class: 'check-summary' }, ' ' + c.summary)
        ])
      ]),
      body
    ]);
  }

  function checksSection(r) {
    var topCodes = r.topFixes.map(function (f) { return f.code; });
    return h('section', { 'aria-labelledby': 'checks-title' }, [
      h('h2', { id: 'checks-title' }, 'All checks'),
      h('p', { class: 'section-hint' }, 'Select a check for details and the records we found.'),
      h('div', { class: 'check-list' }, CHECK_ORDER.map(function (id) { return checkItem(r.checks[id], r, topCodes); }))
    ]);
  }

  /* ------------------------------------------------- start from a link */

  function fromHash() {
    // Shareable links look like check/#d=smithcpa.com (the hash never leaves the browser).
    var m = /^#d=([^&]+)$/.exec(location.hash || '');
    if (!m) return null;
    try {
      return decodeURIComponent(m[1]);
    } catch (e) {
      return null;
    }
  }

  var initial = fromHash();
  if (initial && G.normalizeInput(initial).ok) {
    input.value = G.normalizeInput(initial).domain;
    run(input.value);
  }
})();
