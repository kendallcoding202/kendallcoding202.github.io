/*
 * Badge setup page: builds copy-paste embed code for one firm
 * (embed.html?f=<slug>) with absolute URLs worked out from where this page
 * is hosted, so renaming or moving the folder needs no edits.
 */
(function () {
  'use strict';
  var T = window.KovyrTrust;
  var B = window.KovyrBrand;
  B.applyBrand(document);

  var m = /(?:^|[?&])f=([^&]+)/.exec(location.search);
  var slug = m ? decodeURIComponent(m[1]) : null;
  var sample = !slug;
  var err = document.getElementById('embed-error');

  if (!sample && !T.isSlug(slug)) {
    err.textContent = 'This link has an invalid firm name. Ask ' + B.company + ' for a new setup link.';
    err.hidden = false;
    return;
  }

  function abs(rel) {
    return new URL(rel, location.href).href;
  }

  var urls = sample
    ? {
        trust: abs('sample.html'),
        emailPng: abs('img/verified-email-light.png'),
        webLight: abs('img/verified-web-light.svg'),
        webDark: abs('img/verified-web-dark.svg')
      }
    : {
        trust: abs('trust.html?f=' + encodeURIComponent(slug)),
        emailPng: abs('firms/' + slug + '/email-light.png'),
        webLight: abs('firms/' + slug + '/web-light.svg'),
        webDark: abs('firms/' + slug + '/web-dark.svg')
      };

  // Alt text must not say "verified": the image can change, the alt text can't.
  var alt = B.product + ' security checks: see current status';

  function attr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  var sigHtml = '<a href="' + attr(urls.trust) + '" target="_blank" rel="noopener"><img src="' + attr(urls.emailPng) +
    '" width="232" height="40" border="0" alt="' + attr(alt) + '"></a>';
  function webHtml(src) {
    return '<a href="' + attr(urls.trust) + '" target="_blank" rel="noopener" title="' + attr(alt) + '">\n  <img src="' + attr(src) +
      '" width="280" height="64" border="0" alt="' + attr(alt) + '">\n</a>';
  }

  document.getElementById('sig-code').value = sigHtml;
  document.getElementById('web-code').value = webHtml(urls.webLight);
  document.getElementById('web-code-dark').value = webHtml(urls.webDark);
  document.getElementById('sig-img-url').textContent = urls.emailPng;
  document.getElementById('sig-link-url').textContent = urls.trust;

  function badge(href, src, w, h) {
    var a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener';
    var img = document.createElement('img');
    img.src = src;
    img.width = w;
    img.height = h;
    img.alt = alt;
    a.appendChild(img);
    return a;
  }

  var sigArea = document.getElementById('sig-area');
  sigArea.appendChild(badge(urls.trust, urls.emailPng, 232, 40));
  var pair = document.getElementById('web-preview');
  pair.appendChild(badge(urls.trust, urls.webLight, 280, 64));
  var darkWrap = document.createElement('div');
  darkWrap.className = 'on-dark';
  darkWrap.appendChild(badge(urls.trust, urls.webDark, 280, 64));
  pair.appendChild(darkWrap);

  if (sample) {
    document.getElementById('for-firm').textContent = 'Sample badge (fictional firm)';
  } else {
    fetch('firms/' + slug + '/firm.json', { cache: 'no-store', credentials: 'omit' })
      .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
      .then(function (d) { document.getElementById('for-firm').textContent = 'Badge setup for ' + d.firm; })
      .catch(function () {
        err.textContent = 'We couldn\'t find this firm yet. Ask ' + B.company + ' to finish setting up your badge before you add it.';
        err.hidden = false;
      });
  }

  var status = document.getElementById('sig-status');
  document.getElementById('copy-sig').addEventListener('click', function () {
    function ok() { status.textContent = 'Copied. Now paste it into your signature.'; }
    function fallback() {
      var range = document.createRange();
      range.selectNode(sigArea.firstChild);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      var done = false;
      try { done = document.execCommand('copy'); } catch (e) { done = false; }
      status.textContent = done ? 'Copied. Now paste it into your signature.' : 'The badge is selected. Press Ctrl+C (or Cmd+C) to copy it.';
    }
    if (navigator.clipboard && window.ClipboardItem && window.isSecureContext) {
      var item = new window.ClipboardItem({
        'text/html': new Blob([sigHtml], { type: 'text/html' }),
        'text/plain': new Blob([urls.trust], { type: 'text/plain' })
      });
      navigator.clipboard.write([item]).then(ok, fallback);
    } else {
      fallback();
    }
  });

  Array.prototype.forEach.call(document.querySelectorAll('textarea'), function (ta) {
    ta.addEventListener('focus', function () { ta.select(); });
  });
})();
