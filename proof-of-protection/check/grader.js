/*
 * Kovyr Check: email-spoofing grader.
 *
 * Pure, dependency-free logic shared by the browser page and the Node tests:
 * input normalisation, DNS-over-HTTPS JSON parsing, SPF / DMARC / DKIM / MX /
 * MTA-STS / TLS-RPT evaluation, the overall grade, and provider-tailored fixes.
 *
 * No network code lives here. Every lookup goes through an injected
 * `resolve(name, type)` function that returns a Promise of
 *   { status: 'NOERROR' | 'NXDOMAIN' | 'SERVFAIL' | 'TIMEOUT' | 'ERROR' | ...,
 *     records: string[],   // TXT already joined, MX as "10 host."
 *     cnames?: string[] }
 * (doh.js provides the real one; tests provide fakes.)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KovyrGrader = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Input                                                               */
  /* ------------------------------------------------------------------ */

  // Names that never exist on the public internet (RFC 2606, 6761, 6762,
  // 8375 and common private-network suffixes).
  const PRIVATE_TLDS = [
    'localhost', 'local', 'localdomain', 'test', 'invalid', 'example',
    'internal', 'intranet', 'private', 'lan', 'home', 'corp', 'onion', 'arpa'
  ];

  const MSG = {
    empty: 'Type your work email address or your domain, like smithcpa.com.',
    emailNoDomain: 'That email address is missing the part after the @.',
    ip: 'That looks like an IP address. Enter the domain your firm uses for email instead, like smithcpa.com.',
    local: "That's a private or test name, not a public domain. Enter the domain your firm uses for email, like smithcpa.com.",
    noTld: 'Include the ending, like smithcpa.com, not just smithcpa.',
    invalid: "That doesn't look like a domain. Try something like smithcpa.com or jane@smithcpa.com.",
    tooLong: "That's longer than any real domain can be. Check for a typo."
  };

  function inputError(code) {
    return { ok: false, code: code, error: MSG[code] };
  }

  /**
   * Turn whatever the visitor typed (email, domain, URL, "Name <email>")
   * into a lowercase ASCII domain, or explain why we can't.
   */
  function normalizeInput(raw) {
    let s = raw == null ? '' : String(raw);
    s = s.trim();
    if (!s) return inputError('empty');

    const angle = s.match(/<([^<>]+)>/);
    if (angle) s = angle[1].trim();
    s = s.replace(/^mailto:/i, '');

    let kind = 'domain';
    if (s.indexOf('@') !== -1) {
      kind = 'email';
      s = s.slice(s.lastIndexOf('@') + 1);
      if (!s.trim()) return inputError('emailNoDomain');
    } else {
      s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
      s = s.split(/[/?#]/)[0];
    }
    s = s.replace(/[\s,;:>)\]]+$/, '').replace(/^[\s<([]+/, '');

    if (s.indexOf(':') !== -1 || /^\[.*\]$/.test(s)) {
      const hostPort = s.match(/^([^:[\]]+):\d{1,5}$/);
      if (!hostPort) return inputError('ip'); // IPv6 or garbage
      s = hostPort[1];
    }

    s = s.toLowerCase().replace(/\.+$/, '');
    if (!s) return inputError(kind === 'email' ? 'emailNoDomain' : 'empty');
    if (/\s/.test(s)) return inputError('invalid');
    if (/^[0-9.]+$/.test(s) || /^0x[0-9a-f]/i.test(s)) return inputError('ip');

    // Internationalised domain names: let URL convert to punycode.
    if (/[^\x00-\x7f]/.test(s)) {
      try {
        s = new URL('http://' + s + '/').hostname;
      } catch (e) {
        return inputError('invalid');
      }
    }

    if (s.length > 253) return inputError('tooLong');
    let labels = s.split('.');
    if (labels.length > 2 && labels[0] === 'www') {
      labels = labels.slice(1);
      s = labels.join('.');
    }
    if (labels.length < 2) {
      return inputError(PRIVATE_TLDS.indexOf(s) !== -1 ? 'local' : 'noTld');
    }
    for (const label of labels) {
      if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) {
        return inputError(label.length > 63 ? 'tooLong' : 'invalid');
      }
    }
    const tld = labels[labels.length - 1];
    if (/^[0-9]+$/.test(tld)) return inputError('ip');
    if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(tld)) return inputError('invalid');
    if (PRIVATE_TLDS.indexOf(tld) !== -1) return inputError('local');

    return { ok: true, domain: s, kind: kind };
  }

  /* ------------------------------------------------------------------ */
  /* DNS-over-HTTPS JSON                                                 */
  /* ------------------------------------------------------------------ */

  const TYPE_CODES = { A: 1, NS: 2, CNAME: 5, SOA: 6, MX: 15, TXT: 16, AAAA: 28 };
  const RCODES = { 0: 'NOERROR', 1: 'FORMERR', 2: 'SERVFAIL', 3: 'NXDOMAIN', 4: 'NOTIMP', 5: 'REFUSED' };

  /**
   * Join the character-strings of one TXT record. Cloudflare returns
   * `"part one" "part two"` (quoted, possibly split at 255 bytes); Google
   * returns the text unquoted. Per RFC 7208 §3.3 the strings are
   * concatenated with no separator. Handles \" \\ and \DDD escapes.
   */
  function joinTxt(data) {
    if (data == null) return '';
    const s = String(data).trim();
    if (s.charAt(0) !== '"') return s;
    let out = '';
    let i = 0;
    const n = s.length;
    while (i < n) {
      while (i < n && /\s/.test(s[i])) i++;
      if (i >= n) break;
      if (s[i] !== '"') {
        let j = i;
        while (j < n && !/\s/.test(s[j])) j++;
        out += s.slice(i, j);
        i = j;
        continue;
      }
      i++;
      while (i < n && s[i] !== '"') {
        if (s[i] === '\\' && i + 1 < n) {
          const digits = s.slice(i + 1, i + 4);
          if (/^\d{3}$/.test(digits)) {
            out += String.fromCharCode(parseInt(digits, 10));
            i += 4;
          } else {
            out += s[i + 1];
            i += 2;
          }
        } else {
          out += s[i];
          i++;
        }
      }
      i++;
    }
    return out;
  }

  /** Convert a DoH JSON body (Cloudflare or Google format) into our shape. */
  function parseDohJson(json, type) {
    if (!json || typeof json !== 'object' || typeof json.Status !== 'number') {
      return { status: 'ERROR', records: [], cnames: [], detail: 'Unexpected response from DNS service' };
    }
    const status = RCODES[json.Status] || 'RCODE_' + json.Status;
    const want = TYPE_CODES[type];
    const records = [];
    const cnames = [];
    const answers = Array.isArray(json.Answer) ? json.Answer : [];
    for (const a of answers) {
      if (!a || typeof a.data !== 'string') continue;
      if (a.type === want) records.push(type === 'TXT' ? joinTxt(a.data) : a.data.trim());
      else if (a.type === TYPE_CODES.CNAME) cnames.push(a.data.trim().toLowerCase().replace(/\.$/, ''));
    }
    return { status: status, records: records, cnames: cnames };
  }

  /** NOERROR and NXDOMAIN are real answers; anything else means "we don't know". */
  function isAnswer(res) {
    return !!res && (res.status === 'NOERROR' || res.status === 'NXDOMAIN');
  }

  function failureLabel(status) {
    if (status === 'TIMEOUT') return 'the DNS service timed out';
    if (status === 'SERVFAIL') return "your domain's DNS servers returned an error (SERVFAIL)";
    if (status === 'REFUSED') return 'the DNS service refused the query';
    return "we couldn't reach a DNS service";
  }

  /* ------------------------------------------------------------------ */
  /* Provider docs                                                       */
  /* ------------------------------------------------------------------ */

  const DOCS = {
    m365: {
      spf: { label: 'Microsoft: set up SPF', url: 'https://learn.microsoft.com/en-us/defender-office-365/email-authentication-spf-configure' },
      dkim: { label: 'Microsoft: set up DKIM', url: 'https://learn.microsoft.com/en-us/defender-office-365/email-authentication-dkim-configure' },
      dmarc: { label: 'Microsoft: set up DMARC', url: 'https://learn.microsoft.com/en-us/defender-office-365/email-authentication-dmarc-configure' },
      mtasts: { label: 'Microsoft: MTA-STS for inbound mail', url: 'https://learn.microsoft.com/en-us/purview/enhancing-mail-flow-with-mta-sts' }
    },
    google: {
      spf: { label: 'Google: set up SPF', url: 'https://support.google.com/a/answer/33786' },
      dkim: { label: 'Google: set up DKIM', url: 'https://support.google.com/a/answer/174124' },
      dmarc: { label: 'Google: set up DMARC', url: 'https://support.google.com/a/answer/2466580' },
      mtasts: { label: 'Google: MTA-STS and TLS reporting', url: 'https://support.google.com/a/answer/9261504' }
    },
    generic: { label: 'FTC: email authentication for small businesses', url: 'https://www.ftc.gov/business-guidance/small-businesses/cybersecurity/email-authentication' }
  };

  function docsFor(provider, topic) {
    const p = DOCS[provider && provider.id];
    const list = [];
    if (p && p[topic]) list.push(p[topic]);
    list.push(DOCS.generic);
    return list;
  }

  /* ------------------------------------------------------------------ */
  /* MX and provider detection                                           */
  /* ------------------------------------------------------------------ */

  function parseMx(records) {
    const list = [];
    for (const r of records || []) {
      const m = String(r).trim().match(/^(\d+)\s+(\S+)$/);
      if (!m) continue;
      list.push({ priority: Number(m[1]), host: m[2].toLowerCase().replace(/\.$/, '') });
    }
    return list.sort(function (a, b) { return a.priority - b.priority; });
  }

  const MX_PROVIDERS = [
    [/\.mail\.protection\.outlook\.com$/, 'm365'],
    [/\.mx\.microsoft$/, 'm365'],
    [/(^|\.)aspmx\.l\.google\.com$/, 'google'],
    [/^aspmx\d*\.googlemail\.com$/, 'google'],
    [/^smtp\.google\.com$/, 'google']
  ];
  // Filtering gateways that sit in front of the real mailbox provider.
  const MX_GATEWAYS = [
    [/\.pphosted\.com$/, 'Proofpoint'],
    [/\.ppe-hosted\.com$/, 'Proofpoint Essentials'],
    [/\.mimecast(-offshore)?\.com$/, 'Mimecast'],
    [/\.barracudanetworks\.com$/, 'Barracuda'],
    [/\.iphmx\.com$/, 'Cisco Secure Email'],
    [/\.sophos\.com$/, 'Sophos'],
    [/\.messagelabs\.com$/, 'Symantec Email Security'],
    [/\.hornetsecurity\.com$/, 'Hornetsecurity'],
    [/\.spamtitan\.com$/, 'SpamTitan'],
    [/\.trendmicro\.(com|eu)$/, 'Trend Micro']
  ];
  const MX_OTHER = [
    [/(^|\.)secureserver\.net$/, 'GoDaddy email'],
    [/(^|\.)zoho(mail)?\.(com|eu|in)$/, 'Zoho Mail'],
    [/(^|\.)messagingengine\.com$/, 'Fastmail'],
    [/(^|\.)emailsrvr\.com$/, 'Rackspace Email'],
    [/(^|\.)protonmail\.ch$/, 'Proton Mail'],
    [/(^|\.)privateemail\.com$/, 'Namecheap Private Email'],
    [/(^|\.)icloud\.com$/, 'iCloud Mail'],
    [/(^|\.)yahoodns\.net$/, 'Yahoo Mail'],
    [/(^|\.)intermedia\.net$/, 'Intermedia'],
    [/(^|\.)amazonaws\.com$/, 'Amazon WorkMail']
  ];

  const PROVIDER_NAMES = { m365: 'Microsoft 365', google: 'Google Workspace', other: 'another email provider', none: 'no email service' };

  function matchList(list, host) {
    for (const pair of list) if (pair[0].test(host)) return pair[1];
    return null;
  }

  /**
   * Work out who runs the mailboxes, from MX hosts first and SPF includes
   * second (a gateway such as Proofpoint hides M365 or Google behind it).
   */
  function detectProvider(mxCheck, spfCheck) {
    const hosts = (mxCheck && mxCheck.hosts) || [];
    const includes = (spfCheck && spfCheck.includes) || [];
    const spfHint = includes.some(function (d) { return /(^|\.)spf\.protection\.outlook\.com$/.test(d); })
      ? 'm365'
      : includes.some(function (d) { return /^_spf\.google\.com$/.test(d); }) ? 'google' : null;

    if (mxCheck && mxCheck.status === 'error') {
      // Unknown is not the same as "no email": never tailor fixes as if the
      // domain were unused when we simply couldn't see its mail servers.
      if (spfHint) return { id: spfHint, name: PROVIDER_NAMES[spfHint], label: PROVIDER_NAMES[spfHint], via: 'spf' };
      return { id: 'other', name: PROVIDER_NAMES.other, label: 'Unknown (mail server lookup failed)', via: 'none' };
    }

    for (const h of hosts) {
      const id = matchList(MX_PROVIDERS, h);
      if (id) return { id: id, name: PROVIDER_NAMES[id], label: PROVIDER_NAMES[id], via: 'mx' };
    }
    let gateway = null;
    for (const h of hosts) {
      gateway = matchList(MX_GATEWAYS, h);
      if (gateway) break;
    }
    if (gateway) {
      if (spfHint) {
        return { id: spfHint, name: PROVIDER_NAMES[spfHint], label: PROVIDER_NAMES[spfHint] + ' (behind ' + gateway + ')', gateway: gateway, via: 'spf' };
      }
      return { id: 'other', name: gateway, label: gateway + ' email filtering', gateway: gateway, via: 'mx' };
    }
    if (hosts.length) {
      let named = null;
      for (const h of hosts) {
        named = matchList(MX_OTHER, h);
        if (named) break;
      }
      return { id: 'other', name: named || PROVIDER_NAMES.other, label: named || 'Another email provider', via: 'mx' };
    }
    if (spfHint) return { id: spfHint, name: PROVIDER_NAMES[spfHint], label: PROVIDER_NAMES[spfHint], via: 'spf' };
    // No mail servers. Only call it an unused domain if SPF lists no senders either.
    const sends = ((spfCheck && spfCheck.records) || []).some(function (r) {
      return parseSpf(r).terms.some(function (t) { return t.mechanism !== 'all'; });
    });
    if (sends) return { id: 'other', name: PROVIDER_NAMES.other, label: 'No mail servers (sends only)', via: 'spf' };
    return { id: 'none', name: PROVIDER_NAMES.none, label: 'No mail servers', via: 'mx' };
  }

  function evaluateMx(res) {
    const out = {
      id: 'mx',
      name: 'Mail servers (MX)',
      why: 'Shows which service handles your email, so the fixes below match the tools you actually use.',
      status: 'info',
      summary: '',
      details: [],
      records: [],
      hosts: [],
      nullMx: false,
      issues: []
    };
    if (!isAnswer(res)) {
      out.status = 'error';
      out.summary = "Couldn't look up your mail servers: " + failureLabel(res && res.status) + '.';
      return out;
    }
    const list = parseMx(res.records);
    out.records = list.map(function (m) { return m.priority + ' ' + (m.host || '.'); });
    if (list.length === 1 && list[0].host === '') {
      out.nullMx = true;
      out.status = 'info';
      out.summary = 'This domain publishes a "null MX": it says it does not receive email.';
      out.details.push('A domain that never sends or receives email should also have SPF "v=spf1 -all" and DMARC "p=reject" so nobody can send as it.');
      return out;
    }
    out.hosts = list.map(function (m) { return m.host; }).filter(Boolean);
    if (!out.hosts.length) {
      out.status = 'warn';
      out.summary = 'No mail servers found.';
      out.details.push("If this domain is your firm's email address, something is wrong. If you don't use it for email, lock it down with SPF \"v=spf1 -all\" and DMARC \"p=reject\".");
      out.issues.push('mx-missing');
      return out;
    }
    out.status = 'pass';
    return out; // summary is filled in once the provider is known
  }

  /* ------------------------------------------------------------------ */
  /* SPF (RFC 7208)                                                      */
  /* ------------------------------------------------------------------ */

  const SPF_MECHANISMS = ['all', 'include', 'a', 'mx', 'ptr', 'ip4', 'ip6', 'exists'];
  const SPF_LOOKUP_TERMS = { include: true, a: true, mx: true, ptr: true, exists: true };
  const SPF_MAX_LOOKUPS = 10;
  const SPF_MAX_DEPTH = 10;
  const SPF_MAX_QUERIES = 40;

  function isSpfRecord(txt) {
    return /^v=spf1(\s|$)/i.test(String(txt).trim());
  }

  function isIp4(s) {
    const m = String(s).match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/);
    if (!m) return false;
    for (let i = 1; i <= 4; i++) if (Number(m[i]) > 255) return false;
    return m[5] === undefined || Number(m[5]) <= 32;
  }

  function isIp6(s) {
    const m = String(s).match(/^([0-9a-f:.]+)(?:\/(\d{1,3}))?$/i);
    if (!m || m[1].indexOf(':') === -1) return false;
    return m[2] === undefined || Number(m[2]) <= 128;
  }

  function looksLikeDomainSpec(s) {
    return /^[a-z0-9_%{}.+=,\-]+$/i.test(s) && s.indexOf('.') !== -1 && !/\.\./.test(s);
  }

  /** Parse one SPF record into terms, modifiers, errors and warnings. */
  function parseSpf(record) {
    const out = { record: String(record), terms: [], redirect: null, exp: null, all: null, errors: [], warnings: [] };
    const parts = String(record).trim().split(/\s+/);
    for (let i = 1; i < parts.length; i++) {
      const raw = parts[i];
      if (!raw) continue;

      const mod = raw.match(/^([a-z][a-z0-9_.-]*)=(.*)$/i);
      if (mod) {
        const name = mod[1].toLowerCase();
        const value = mod[2];
        if (name === 'v') {
          out.errors.push('"' + raw + '" appears in the middle of the record. Two SPF records may have been pasted together.');
        } else if (name === 'redirect' || name === 'exp') {
          if (out[name] !== null) out.errors.push('"' + name + '=" appears more than once.');
          else if (!value || !looksLikeDomainSpec(value)) out.errors.push('"' + raw + '" needs a domain after the "=".');
          else out[name] = value.toLowerCase();
        }
        // Unknown modifiers are allowed and ignored (RFC 7208 §6).
        continue;
      }

      let qualifier = '+';
      let body = raw;
      if (/^[+\-~?]/.test(body)) {
        qualifier = body[0];
        body = body.slice(1);
      }
      const mm = body.match(/^([a-z0-9]+)(?:([:/])(.*))?$/i);
      const mech = mm ? mm[1].toLowerCase() : null;
      if (!mm || SPF_MECHANISMS.indexOf(mech) === -1) {
        out.errors.push('"' + raw + '" isn\'t a valid SPF term.');
        continue;
      }
      const sep = mm[2] || '';
      const arg = mm[3] || '';
      const term = { raw: raw, qualifier: qualifier, mechanism: mech, value: null, cidr: null };
      let bad = false;
      switch (mech) {
        case 'all':
          bad = !!sep;
          break;
        case 'include':
        case 'exists':
          bad = sep !== ':' || !looksLikeDomainSpec(arg);
          term.value = arg.toLowerCase();
          break;
        case 'a':
        case 'mx':
          if (sep === ':') {
            const slash = arg.indexOf('/');
            term.value = (slash === -1 ? arg : arg.slice(0, slash)).toLowerCase();
            term.cidr = slash === -1 ? null : arg.slice(slash);
            bad = !looksLikeDomainSpec(term.value);
          } else if (sep === '/') {
            term.cidr = '/' + arg;
            bad = !/^\d{1,3}(\/\/?\d{1,3})?$|^\/\d{1,3}$/.test(arg);
          }
          break;
        case 'ptr':
          if (sep === ':') term.value = arg.toLowerCase();
          bad = sep === '/' || (sep === ':' && !looksLikeDomainSpec(arg));
          break;
        case 'ip4':
          bad = sep !== ':' || !isIp4(arg);
          term.value = arg;
          break;
        case 'ip6':
          bad = sep !== ':' || !isIp6(arg);
          term.value = arg;
          break;
      }
      if (bad) {
        out.errors.push('"' + raw + '" isn\'t written correctly.');
        continue;
      }
      out.terms.push(term);
    }
    const allIndex = out.terms.findIndex(function (t) { return t.mechanism === 'all'; });
    if (allIndex !== -1) {
      out.all = out.terms[allIndex];
      if (allIndex < out.terms.length - 1) out.warnings.push('Terms after "' + out.all.raw + '" are never checked; "all" should be last.');
      if (out.redirect) out.warnings.push('"redirect=" is ignored because the record already has "all".');
    }
    return out;
  }

  async function walkSpf(domain, record, depth, chain, ctx) {
    const parsed = parseSpf(record);
    const node = { domain: domain, record: record, parsed: parsed, lookups: 0, children: [], redirect: null, all: null };
    if (parsed.errors.length) ctx.syntax.push({ domain: domain, errors: parsed.errors });
    const includes = [];
    for (const t of parsed.terms) {
      if (SPF_LOOKUP_TERMS[t.mechanism]) {
        ctx.lookups++;
        node.lookups++;
      }
      if (t.mechanism === 'ptr') ctx.ptr.push(domain);
      if (t.mechanism === 'include') {
        includes.push(t.value);
        ctx.includes.push(t.value);
      }
      if ((t.mechanism === 'exists' || t.mechanism === 'include') && t.value && t.value.indexOf('%{') !== -1) ctx.macros.push(t.value);
    }
    let redirectTarget = null;
    if (parsed.redirect && !parsed.all) {
      ctx.lookups++;
      node.lookups++;
      redirectTarget = parsed.redirect;
      ctx.includes.push(redirectTarget);
    }
    node.children = await Promise.all(includes.map(function (target) {
      return followSpf(target, 'include', depth, chain, ctx);
    }));
    if (redirectTarget) node.redirect = await followSpf(redirectTarget, 'redirect', depth, chain, ctx);

    if (parsed.all) node.all = parsed.all.qualifier;
    else if (node.redirect && node.redirect.node) node.all = node.redirect.node.all;
    else if (node.redirect) node.all = 'unknown';
    return node;
  }

  async function followSpf(target, via, depth, chain, ctx) {
    const link = { target: target, via: via, node: null, problem: null };
    if (target.indexOf('%{') !== -1) {
      link.problem = 'macro';
      return link;
    }
    if (chain.indexOf(target) !== -1) {
      link.problem = 'loop';
      ctx.loops.push(chain.concat(target));
      return link;
    }
    if (depth + 1 > SPF_MAX_DEPTH) {
      link.problem = 'depth';
      ctx.depthHit = true;
      return link;
    }
    if (ctx.queries >= SPF_MAX_QUERIES) {
      link.problem = 'truncated';
      ctx.truncated = true;
      return link;
    }
    ctx.queries++;
    const res = await ctx.resolve(target, 'TXT');
    if (!isAnswer(res)) {
      link.problem = 'unresolved';
      link.status = res && res.status;
      ctx.unresolved.push(target);
      return link;
    }
    const spfs = res.records.filter(isSpfRecord);
    if (spfs.length === 0) {
      link.problem = 'missing';
      ctx.missing.push(target);
      return link;
    }
    if (spfs.length > 1) {
      link.problem = 'multiple';
      ctx.missing.push(target);
      return link;
    }
    link.node = await walkSpf(target, spfs[0], depth + 1, chain.concat(target), ctx);
    return link;
  }

  /** Total lookups attributable to each top-level term, for the breakdown. */
  function lookupBreakdown(node) {
    function count(n) {
      if (!n) return 0;
      let total = n.lookups;
      for (const c of n.children) total += c.node ? count(c.node) : 0;
      if (n.redirect && n.redirect.node) total += count(n.redirect.node);
      return total;
    }
    const rows = [];
    if (!node) return rows;
    let ci = 0;
    for (const t of node.parsed.terms) {
      if (!SPF_LOOKUP_TERMS[t.mechanism]) continue;
      let n = 1;
      if (t.mechanism === 'include') {
        const link = node.children[ci++];
        if (link && link.node) n += count(link.node);
      }
      rows.push({ term: t.raw, lookups: n });
    }
    if (node.redirect) rows.push({ term: 'redirect=' + node.redirect.target, lookups: 1 + (node.redirect.node ? count(node.redirect.node) : 0) });
    return rows;
  }

  const SPF_WHY = "SPF is your domain's list of servers allowed to send its email. Without a strict list, a criminal's server can send mail as you.";

  async function evaluateSpf(domain, resolve, rootResult) {
    const res = rootResult || (await resolve(domain, 'TXT'));
    const out = {
      id: 'spf',
      name: 'Approved senders (SPF)',
      why: SPF_WHY,
      status: 'error',
      state: 'error',
      summary: '',
      details: [],
      records: [],
      record: null,
      lookups: 0,
      breakdown: [],
      includes: [],
      allQualifier: null,
      issues: [],
      syntax: [],
      missingIncludes: [],
      unresolved: []
    };
    if (!isAnswer(res)) {
      out.summary = "Couldn't read your SPF record: " + failureLabel(res && res.status) + '.';
      return out;
    }
    const spfs = res.records.filter(isSpfRecord);
    out.records = spfs;
    if (spfs.length === 0) {
      out.state = 'missing';
      out.status = 'fail';
      out.summary = 'No SPF record found.';
      out.issues.push('spf-missing');
      const near = res.records.filter(function (r) { return /spf/i.test(r); });
      if (near.length) out.details.push('Found a TXT record that mentions SPF but doesn\'t start with "v=spf1": ' + near[0]);
      return out;
    }
    if (spfs.length > 1) {
      out.state = 'multiple';
      out.status = 'fail';
      out.summary = spfs.length + ' SPF records found. Receivers treat that as an error and ignore all of them.';
      out.issues.push('spf-multiple');
      for (const r of spfs) {
        const p = parseSpf(r);
        for (const t of p.terms) if (t.mechanism === 'include') out.includes.push(t.value);
      }
      return out;
    }

    out.record = spfs[0];
    const ctx = {
      resolve: resolve, lookups: 0, queries: 0, includes: [], ptr: [], macros: [], loops: [],
      missing: [], unresolved: [], syntax: [], depthHit: false, truncated: false
    };
    const tree = await walkSpf(domain, spfs[0], 0, [domain], ctx);
    out.lookups = ctx.lookups;
    out.includes = ctx.includes;
    out.breakdown = lookupBreakdown(tree);
    out.allQualifier = tree.all;
    out.syntax = ctx.syntax;
    out.missingIncludes = ctx.missing;
    out.unresolved = ctx.unresolved;

    const tooMany = ctx.lookups > SPF_MAX_LOOKUPS;
    const lookupText = (ctx.truncated || ctx.depthHit ? 'at least ' : '') + ctx.lookups + ' of ' + SPF_MAX_LOOKUPS + ' DNS lookups';

    if (tree.all === '+') out.issues.push('spf-plus-all');
    if (tooMany) out.issues.push('spf-too-many-lookups');
    if (ctx.syntax.length) out.issues.push('spf-syntax');
    if (ctx.missing.length) out.issues.push('spf-include-missing');
    if (ctx.loops.length) out.issues.push('spf-loop');
    if (tree.all === '?' || tree.all === null) out.issues.push(tree.all === '?' ? 'spf-neutral' : 'spf-no-all');
    if (tree.all === '~') out.issues.push('spf-softfail');
    if (ctx.ptr.length) out.issues.push('spf-ptr');
    if (tree.parsed.warnings.length) out.issues.push('spf-order');

    const broken = tooMany || ctx.syntax.length || ctx.missing.length || ctx.loops.length;
    if (tree.all === '+') out.state = 'open';
    else if (broken) out.state = 'broken';
    else if (tree.all === '?' || tree.all === null) out.state = 'neutral';
    else if (tree.all === 'unknown') out.state = 'error';
    else if (tree.all === '~') out.state = 'soft';
    else out.state = 'pass';

    out.status = out.state === 'pass' ? 'pass' : out.state === 'soft' ? 'warn' : out.state === 'error' ? 'error' : 'fail';
    if (out.state === 'pass' && (ctx.ptr.length || tree.parsed.warnings.length)) out.status = 'warn';

    const allText = {
      '-': 'ends in -all (strict: unlisted servers fail)',
      '~': 'ends in ~all (soft fail: unlisted servers are flagged, not refused)',
      '?': 'ends in ?all (neutral: says nothing about unlisted servers)',
      '+': 'ends in +all, which approves every server on the internet',
      null: 'has no "all" at the end, so unlisted servers get a neutral result',
      unknown: 'redirects to a record we couldn\'t read'
    }[tree.all];

    if (out.state === 'open') out.summary = 'Your SPF record ' + allText + '.';
    else if (tooMany) out.summary = 'Your SPF record needs ' + lookupText.replace(' of ' + SPF_MAX_LOOKUPS, '') + '. The limit is 10, so many receivers treat it as broken.';
    else if (broken) out.summary = 'Your SPF record has errors, so receivers may treat it as broken.';
    else out.summary = 'One SPF record; it ' + allText + '. Uses ' + lookupText + '.';

    if (!tooMany && ctx.lookups >= 9) out.details.push('You are close to the 10-lookup limit. Adding one more sending service could break SPF.');
    for (const s of ctx.syntax) {
      const where = s.domain === domain ? 'Your record' : 'The record at ' + s.domain + ' (included by yours)';
      out.details.push(where + ': ' + s.errors.join(' '));
    }
    for (const m of ctx.missing) out.details.push('include:' + m + ' points to a domain with no single valid SPF record. That makes your whole SPF record fail.');
    for (const l of ctx.loops) out.details.push('Include loop: ' + l.join(' → ') + '.');
    if (ctx.ptr.length) out.details.push('Uses the "ptr" mechanism, which is deprecated (RFC 7208), slow, and ignored by some receivers.');
    for (const w of tree.parsed.warnings) out.details.push(w);
    if (ctx.macros.length) out.details.push('Uses SPF macros (' + ctx.macros.join(', ') + "). These can't be expanded ahead of time, so each counts as one lookup here.");
    if (ctx.unresolved.length) out.details.push("Couldn't read " + ctx.unresolved.join(', ') + ' (DNS didn\'t answer), so the real lookup count may be higher.');
    if (ctx.truncated || ctx.depthHit) out.details.push('The include chain is very long; we stopped following it.');
    return out;
  }

  /** Rebuild an SPF record with a different "all" (and optionally no ptr). */
  function rewriteSpf(record, opts) {
    const tokens = String(record).trim().split(/\s+/);
    const out = [];
    let hadAll = false;
    for (const tok of tokens) {
      if (/^[+\-~?]?all$/i.test(tok)) {
        if (!hadAll) out.push(opts.all + 'all');
        hadAll = true;
        continue;
      }
      if (opts.dropPtr && /^[+\-~?]?ptr([:].*)?$/i.test(tok)) continue;
      out.push(tok);
    }
    if (!hadAll && !out.some(function (t) { return /^redirect=/i.test(t); })) out.push(opts.all + 'all');
    if (!/^v=spf1$/.test(out[0])) out[0] = 'v=spf1';
    return out.join(' ');
  }

  function mergeSpf(records) {
    const terms = [];
    let soft = false;
    for (const r of records) {
      for (const t of parseSpf(r).terms) {
        if (t.mechanism === 'all') {
          if (t.qualifier === '~') soft = true;
          continue;
        }
        const key = (t.qualifier === '+' ? '' : t.qualifier) + t.raw.replace(/^[+\-~?]/, '').toLowerCase();
        if (terms.indexOf(key) === -1) terms.push(key);
      }
    }
    return ['v=spf1'].concat(terms, [soft ? '~all' : '-all']).join(' ');
  }

  /* ------------------------------------------------------------------ */
  /* DMARC (RFC 7489)                                                    */
  /* ------------------------------------------------------------------ */

  const DMARC_TAGS = ['v', 'p', 'sp', 'pct', 'rua', 'ruf', 'adkim', 'aspf', 'fo', 'rf', 'ri', 'np', 'psd', 't'];
  const POLICIES = ['none', 'quarantine', 'reject'];

  function parseDmarc(record) {
    const out = {
      record: String(record), tags: {}, order: [], errors: [], warnings: [],
      policy: null, subPolicy: null, pct: 100, rua: [], ruf: [], valid: false
    };
    const parts = String(record).trim().split(';');
    let first = true;
    for (const part of parts) {
      const t = part.trim();
      if (!t) continue;
      const eq = t.indexOf('=');
      if (eq <= 0) {
        out.errors.push('"' + t + '" is missing "=" (tags look like p=reject).');
        first = false;
        continue;
      }
      const name = t.slice(0, eq).trim().toLowerCase();
      const value = t.slice(eq + 1).trim();
      if (/\s[a-z]{1,5}\s*=/i.test(value)) {
        out.errors.push('"' + t + '" looks like several tags run together. Separate tags with semicolons (;).');
      }
      if (first && name !== 'v') out.errors.push('The record must start with v=DMARC1.');
      first = false;
      if (Object.prototype.hasOwnProperty.call(out.tags, name)) {
        out.warnings.push('"' + name + '=" appears more than once; only the first is used.');
        continue;
      }
      if (DMARC_TAGS.indexOf(name) === -1) out.warnings.push('Unknown tag "' + name + '=" is ignored.');
      out.tags[name] = value;
      out.order.push(name);
    }

    const v = out.tags.v;
    if (v === undefined) {
      if (!out.errors.some(function (e) { return /start with v=DMARC1/.test(e); })) out.errors.push('The record must start with v=DMARC1.');
    } else if (v !== 'DMARC1') {
      if (v.toUpperCase() === 'DMARC1') out.warnings.push('Write the version exactly as "v=DMARC1" (uppercase); some receivers are strict.');
      else if (!/\s/.test(v)) out.errors.push('"v=' + v + '" isn\'t a DMARC version; it must be v=DMARC1.');
    }

    if (out.tags.p === undefined) {
      if (out.tags.rua !== undefined) {
        out.policy = 'none';
        out.warnings.push('No "p=" tag, so receivers treat it as p=none.');
      } else {
        out.errors.push('The record has no policy ("p=none", "p=quarantine" or "p=reject").');
      }
    } else {
      const p = out.tags.p.toLowerCase();
      if (POLICIES.indexOf(p) === -1) out.errors.push('"p=' + out.tags.p + '" isn\'t a valid policy. Use none, quarantine or reject.');
      else out.policy = p;
    }

    out.subPolicy = out.policy;
    if (out.tags.sp !== undefined) {
      const sp = out.tags.sp.toLowerCase();
      if (POLICIES.indexOf(sp) === -1) out.warnings.push('"sp=' + out.tags.sp + '" isn\'t valid and is ignored.');
      else out.subPolicy = sp;
    }

    if (out.tags.pct !== undefined) {
      if (/^\d{1,3}$/.test(out.tags.pct) && Number(out.tags.pct) <= 100) out.pct = Number(out.tags.pct);
      else out.warnings.push('"pct=' + out.tags.pct + '" must be a whole number from 0 to 100; it is ignored.');
    }

    function uris(tag) {
      const list = [];
      if (out.tags[tag] === undefined) return list;
      for (const u of out.tags[tag].split(',')) {
        const uri = u.trim();
        if (!uri) continue;
        if (/^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/i.test(uri.replace(/!\d+[kmgt]?$/i, ''))) list.push(uri);
        else out.warnings.push('"' + tag + '=' + uri + '" isn\'t a valid mailto: address.');
      }
      return list;
    }
    out.rua = uris('rua');
    out.ruf = uris('ruf');

    for (const tag of ['adkim', 'aspf']) {
      if (out.tags[tag] !== undefined && !/^[rs]$/i.test(out.tags[tag])) out.warnings.push('"' + tag + '=' + out.tags[tag] + '" must be r or s; it is ignored.');
    }
    out.valid = out.errors.length === 0 && out.policy !== null;
    return out;
  }

  // Multi-label public suffixes common enough to matter; not a full PSL.
  const TWO_LEVEL_SUFFIXES = [
    'co.uk', 'org.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au',
    'co.nz', 'org.nz', 'co.za', 'com.br', 'com.mx', 'co.jp', 'co.in', 'co.il', 'com.sg', 'com.cn'
  ];

  /** Organizational domain (RFC 7489 §3.2), approximated without the PSL. */
  function orgDomain(domain) {
    const labels = domain.split('.');
    const suffixLen = TWO_LEVEL_SUFFIXES.indexOf(labels.slice(-2).join('.')) !== -1 ? 2 : 1;
    if (labels.length <= suffixLen + 1) return domain;
    return labels.slice(-(suffixLen + 1)).join('.');
  }

  const DMARC_WHY = 'DMARC tells Gmail, Outlook and others what to do with email that claims to be from you but fails the checks: deliver it, send it to spam, or reject it. It is what stops fake invoices sent "from" your exact address.';

  function isDmarcCandidate(txt) {
    return /v\s*=\s*dmarc1/i.test(String(txt));
  }

  async function evaluateDmarc(domain, resolve, rootResult) {
    const host = '_dmarc.' + domain;
    const out = {
      id: 'dmarc',
      name: 'Spoofing policy (DMARC)',
      why: DMARC_WHY,
      host: host,
      status: 'error',
      state: 'error',
      summary: '',
      details: [],
      records: [],
      record: null,
      parsed: null,
      policy: null,
      inheritedFrom: null,
      issues: []
    };
    const res = rootResult || (await resolve(host, 'TXT'));
    if (!isAnswer(res)) {
      out.summary = "Couldn't read your DMARC record: " + failureLabel(res && res.status) + '.';
      return out;
    }
    let candidates = res.records.filter(isDmarcCandidate);

    if (!candidates.length) {
      const org = orgDomain(domain);
      if (org !== domain) {
        const parent = await resolve('_dmarc.' + org, 'TXT');
        if (!isAnswer(parent)) {
          out.summary = "Couldn't read the DMARC record for " + org + ': ' + failureLabel(parent && parent.status) + '.';
          return out;
        }
        const pc = parent.records.filter(isDmarcCandidate);
        if (pc.length === 1 && parseDmarc(pc[0]).valid) {
          out.inheritedFrom = org;
          candidates = pc;
        }
      }
    }
    out.records = candidates;

    if (!candidates.length) {
      out.state = 'missing';
      out.status = 'fail';
      out.summary = 'No DMARC record at ' + host + '.';
      out.issues.push('dmarc-missing');
      return out;
    }
    if (candidates.length > 1) {
      out.state = 'multiple';
      out.status = 'fail';
      out.summary = candidates.length + ' DMARC records found. Receivers ignore DMARC entirely when there is more than one.';
      out.issues.push('dmarc-multiple');
      return out;
    }

    const parsed = parseDmarc(candidates[0]);
    out.record = candidates[0];
    out.parsed = parsed;
    if (!parsed.valid) {
      out.state = 'invalid';
      out.status = 'fail';
      out.summary = 'Your DMARC record has errors, so receivers ignore it.';
      out.issues.push('dmarc-invalid');
      for (const e of parsed.errors) out.details.push(e);
      return out;
    }

    const policy = out.inheritedFrom ? parsed.subPolicy : parsed.policy;
    out.policy = policy;
    if (out.inheritedFrom) out.details.push('No record of its own; it inherits the policy for subdomains of ' + out.inheritedFrom + '.');

    const policyText = {
      none: 'p=none: monitoring only. Fake emails are still delivered.',
      quarantine: 'p=quarantine: fake emails go to spam.',
      reject: 'p=reject: fake emails are refused.'
    }[policy];

    if (policy === 'none') {
      out.state = 'none';
      out.issues.push('dmarc-none');
    } else {
      out.state = 'enforced';
      if (parsed.pct < 100) {
        out.state = 'partial';
        out.issues.push('dmarc-pct');
        out.details.push('pct=' + parsed.pct + ' means the policy applies to only ' + parsed.pct + '% of failing mail; the rest is delivered as if p=none.');
      }
      if (!out.inheritedFrom && parsed.subPolicy === 'none') {
        out.state = 'partial';
        out.issues.push('dmarc-sp-none');
        out.details.push('sp=none leaves subdomains (like billing.' + domain + ') unprotected.');
      }
      if (policy === 'quarantine') out.details.push('p=reject is the strongest setting; quarantine is a solid step.');
    }
    if (!parsed.rua.length) {
      out.issues.push('dmarc-no-rua');
      out.details.push('No report address (rua=), so you never see who is sending email as you.');
    } else {
      out.details.push('Reports go to ' + parsed.rua.join(', ') + '.');
    }
    if (parsed.warnings.length) {
      out.issues.push('dmarc-warnings');
      for (const w of parsed.warnings) out.details.push(w);
    }

    out.status = out.state === 'enforced' ? (parsed.warnings.length ? 'warn' : 'pass') : 'warn';
    out.summary = 'Policy ' + policyText;
    return out;
  }

  /**
   * Rebuild a clean DMARC record from parsed tags, with some tags changed
   * (null removes). Unknown tags and invalid values are dropped.
   */
  function buildDmarc(parsed, changes) {
    const tags = {};
    const order = ['v', 'p'];
    if (parsed) {
      for (const k of parsed.order) {
        if (DMARC_TAGS.indexOf(k) === -1) continue;
        let v = parsed.tags[k];
        if (k === 'sp') v = POLICIES.indexOf(v.toLowerCase()) !== -1 ? v.toLowerCase() : undefined;
        if (k === 'pct') v = /^\d{1,3}$/.test(v) && Number(v) <= 100 ? v : undefined;
        if (k === 'adkim' || k === 'aspf') v = /^[rs]$/i.test(v) ? v.toLowerCase() : undefined;
        if (k === 'rua') v = parsed.rua.length ? parsed.rua.join(',') : undefined;
        if (k === 'ruf') v = parsed.ruf.length ? parsed.ruf.join(',') : undefined;
        if (v === undefined) continue;
        tags[k] = v;
        if (order.indexOf(k) === -1) order.push(k);
      }
    }
    tags.v = 'DMARC1';
    if (parsed && parsed.policy) tags.p = parsed.policy;
    for (const k of Object.keys(changes || {})) {
      if (changes[k] === null) delete tags[k];
      else {
        tags[k] = changes[k];
        if (order.indexOf(k) === -1) order.push(k);
      }
    }
    if (!tags.p) tags.p = 'none';
    return order.filter(function (k) { return tags[k] !== undefined; }).map(function (k) { return k + '=' + tags[k]; }).join('; ');
  }

  /* ------------------------------------------------------------------ */
  /* DKIM (heuristic) and optional extras                                */
  /* ------------------------------------------------------------------ */

  const DKIM_SELECTORS = ['selector1', 'selector2', 'google', 'default', 'k1', 's1', 's2'];

  function parseTagList(txt) {
    const tags = {};
    for (const part of String(txt).split(';')) {
      const eq = part.indexOf('=');
      if (eq <= 0) continue;
      const k = part.slice(0, eq).trim().toLowerCase();
      if (!(k in tags)) tags[k] = part.slice(eq + 1).trim();
    }
    return tags;
  }

  function isDkimRecord(txt) {
    return /^\s*v\s*=\s*dkim1\b/i.test(txt) || /(^|;)\s*p\s*=/i.test(txt);
  }

  function parseDkim(txt) {
    const tags = parseTagList(txt);
    const key = (tags.p || '').replace(/\s+/g, '');
    const type = (tags.k || 'rsa').toLowerCase();
    const out = { tags: tags, keyType: type, revoked: key === '', bits: null };
    if (!out.revoked && type === 'rsa') {
      const bytes = Math.floor((key.replace(/=+$/, '').length * 3) / 4);
      out.bits = bytes < 120 ? 512 : bytes < 200 ? 1024 : bytes < 400 ? 2048 : 4096;
    }
    return out;
  }

  function evaluateDkim(results, provider) {
    const out = {
      id: 'dkim',
      name: 'Email signing (DKIM)',
      why: 'DKIM adds a tamper-proof signature to the email you send, so receivers can tell it really came from you. DMARC can rely on it.',
      status: 'info',
      summary: '',
      details: [],
      found: [],
      issues: []
    };
    let errors = 0;
    const cnameOnly = [];
    for (const r of results) {
      if (!isAnswer(r.res)) {
        errors++;
        continue;
      }
      const recs = r.res.records.filter(isDkimRecord);
      if (recs.length) {
        const k = parseDkim(recs[0]);
        out.found.push({ selector: r.selector, record: recs[0], keyType: k.keyType, bits: k.bits, revoked: k.revoked });
      } else if (r.res.cnames && r.res.cnames.length) {
        cnameOnly.push(r.selector);
      }
    }
    const live = out.found.filter(function (f) { return !f.revoked; });
    if (live.length) {
      out.status = 'pass';
      out.summary = 'Found a signing key at ' + live.map(function (f) { return f.selector; }).join(', ') + '.';
      for (const f of live) {
        if (f.keyType === 'rsa' && f.bits && f.bits <= 1024) out.details.push('The key at "' + f.selector + '" looks like ' + f.bits + '-bit RSA. 2048-bit is the current recommendation.');
      }
    } else {
      out.summary = 'No key under the common names we tried. That is not a failure: DKIM keys can use any name.';
      out.details.push('We looked for ' + DKIM_SELECTORS.join(', ') + '. Your email provider\'s admin console shows whether DKIM signing is on.');
    }
    for (const f of out.found) if (f.revoked) out.details.push('The key at "' + f.selector + '" is empty (revoked).');
    if (cnameOnly.length && provider && provider.id === 'm365') {
      out.details.push('Microsoft 365 DKIM records (' + cnameOnly.join(', ') + ') point to keys that are not published yet; DKIM may not be switched on in Microsoft 365.');
    }
    if (errors === results.length && results.length) {
      out.status = 'error';
      out.summary = "Couldn't look up DKIM keys: the DNS service didn't answer.";
    }
    return out;
  }

  function evaluateOptional(kind, res) {
    const isSts = kind === 'mta-sts';
    const out = {
      id: isSts ? 'mtasts' : 'tlsrpt',
      name: isSts ? 'Encrypted delivery (MTA-STS)' : 'Delivery reports (TLS-RPT)',
      why: isSts
        ? 'Makes other mail servers use an encrypted connection when they deliver email to you, so messages can\'t be read or redirected on the way. Nice to have.'
        : 'Sends you reports when other servers have trouble delivering to you securely. Nice to have; it pairs with MTA-STS.',
      optional: true,
      status: 'info',
      summary: '',
      details: [],
      record: null,
      issues: []
    };
    if (!isAnswer(res)) {
      out.status = 'error';
      out.summary = "Couldn't check: " + failureLabel(res && res.status) + '.';
      return out;
    }
    const prefix = isSts ? /^\s*v\s*=\s*STSv1\b/i : /^\s*v\s*=\s*TLSRPTv1\b/i;
    const recs = res.records.filter(function (r) { return prefix.test(r); });
    if (!recs.length) {
      out.summary = 'Not set up (optional).';
      out.issues.push(isSts ? 'mtasts-missing' : 'tlsrpt-missing');
      return out;
    }
    out.record = recs[0];
    const tags = parseTagList(recs[0]);
    if (recs.length > 1) {
      out.status = 'warn';
      out.summary = 'More than one record found; there should be exactly one.';
    } else if (isSts && !/^[a-z0-9]{1,32}$/i.test(tags.id || '')) {
      out.status = 'warn';
      out.summary = 'Record found, but its "id=" is missing or invalid.';
    } else if (!isSts && !/^(mailto:|https:)/i.test(tags.rua || '')) {
      out.status = 'warn';
      out.summary = 'Record found, but it has no valid report address (rua=).';
    } else {
      out.status = 'pass';
      out.summary = isSts ? 'Set up.' : 'Set up. Reports go to ' + tags.rua + '.';
    }
    if (isSts) out.details.push('We check the DNS record only. The policy file at https://mta-sts.<your domain>/.well-known/mta-sts.txt can\'t be read from a browser.');
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Grade                                                               */
  /* ------------------------------------------------------------------ */

  const GRADES = {
    strong: {
      id: 'strong', label: 'Strong',
      headline: 'Fakes using your domain should be blocked',
      summary: 'Email that pretends to come from @{domain} should be rejected or sent to spam by Gmail, Outlook and other major services.'
    },
    'needs-work': {
      id: 'needs-work', label: 'Needs work',
      headline: 'Some protection, with gaps',
      summary: 'Some protection is in place, but fake email using @{domain} can still reach inboxes.'
    },
    'at-risk': {
      id: 'at-risk', label: 'At risk',
      headline: 'Criminals could send email as you',
      summary: 'Right now, someone could send email that looks like it comes from @{domain}, and many inboxes would deliver it.'
    },
    incomplete: {
      id: 'incomplete', label: 'Not graded',
      headline: "We couldn't finish the check",
      summary: "Some DNS lookups failed (details below), so we haven't graded @{domain}. Please try again in a minute. If it keeps happening, your domain's DNS may have a problem worth checking."
    }
  };

  function gradeOf(spfState, dmarcState) {
    const dmarcMissing = dmarcState === 'missing' || dmarcState === 'invalid' || dmarcState === 'multiple';
    const spfWeak = spfState === 'missing' || spfState === 'multiple' || spfState === 'broken' || spfState === 'neutral';
    if (spfState === 'open' || dmarcMissing || (dmarcState === 'none' && spfWeak)) return 'at-risk';
    if (spfState === 'error' || dmarcState === 'error') return 'incomplete';
    if (dmarcState === 'enforced' && (spfState === 'pass' || spfState === 'soft')) return 'strong';
    return 'needs-work';
  }

  /* ------------------------------------------------------------------ */
  /* Fixes, tailored to the provider                                     */
  /* ------------------------------------------------------------------ */

  const PRIORITY = {
    'spf-plus-all': 10,
    'dmarc-missing': 20,
    'dmarc-multiple': 21,
    'dmarc-invalid': 22,
    'spf-missing': 30,
    'spf-multiple': 31,
    'spf-too-many-lookups': 32,
    'spf-syntax': 33,
    'spf-include-missing': 34,
    'spf-loop': 35,
    'spf-neutral': 36,
    'spf-no-all': 36,
    'dmarc-none': 40,
    'dmarc-pct': 45,
    'dmarc-sp-none': 46,
    'spf-softfail': 50,
    'spf-ptr': 52,
    'spf-order': 53,
    'dmarc-warnings': 54,
    'dmarc-no-rua': 55
  };

  const DNS_STEP = "Sign in to wherever your domain's DNS is managed: usually your domain registrar (such as GoDaddy or Network Solutions), your website host, or your IT provider.";

  function dkimStep(report) {
    const domain = report.domain;
    const dkim = report.checks.dkim;
    const id = report.provider.id;
    if (dkim && dkim.status === 'pass') return 'DKIM signing looks set up (we found a key at ' + dkim.found.filter(function (f) { return !f.revoked; }).map(function (f) { return f.selector; }).join(', ') + '). Keep it on.';
    if (id === 'm365') return 'Turn on DKIM: in the Microsoft Defender portal go to Email & collaboration › Policies & rules › Threat policies › Email authentication settings › DKIM, choose ' + domain + ', add the two CNAME records it shows (selector1 and selector2) at your DNS host, then switch signing on.';
    if (id === 'google') return 'Turn on DKIM: in the Google Admin console go to Apps › Google Workspace › Gmail › Authenticate email, generate a key for ' + domain + ', add the TXT record it shows (google._domainkey) at your DNS host, then click Start authentication.';
    return 'Check that DKIM signing is on: ask your email provider how to turn it on for ' + domain + '. They will give you a record to add to DNS.';
  }

  function sendersStep() {
    return 'List every service that sends email as you (for example QuickBooks, your practice-management or patient-reminder software, your newsletter tool) and add each one\'s SPF "include" from its help pages.';
  }

  function noMail(report) {
    return report.provider.id === 'none';
  }

  function defaultRua(domain) {
    return 'mailto:dmarc-reports@' + domain;
  }

  function newSpfRecord(report) {
    const id = report.provider.id;
    if (id === 'm365') return 'v=spf1 include:spf.protection.outlook.com -all';
    if (id === 'google') return 'v=spf1 include:_spf.google.com ~all';
    if (id === 'none') return 'v=spf1 -all';
    return null;
  }

  const FIXES = {
    'spf-plus-all': function (r) {
      const spf = r.checks.spf;
      return {
        title: 'Stop your SPF record from approving everyone',
        problem: '"+all" tells every mail server that any computer on the internet may send email as ' + r.domain + '. It turns SPF protection off and helps fakes pass.',
        steps: [DNS_STEP, 'Edit the TXT record at the root of your domain (host "@") that starts with v=spf1, and replace "+all" with "-all" as shown below.', sendersStep()],
        record: { type: 'TXT', host: '@', value: rewriteSpf(spf.record, { all: '-' }) },
        docs: docsFor(r.provider, 'spf')
      };
    },
    'spf-missing': function (r) {
      const rec = newSpfRecord(r);
      const steps = [DNS_STEP];
      if (noMail(r)) {
        steps.push('This domain has no mail servers, so it doesn\'t appear to be used for email. If that\'s right, publish an SPF record that allows no one: add a TXT record at host "@" with the value below.');
      } else if (rec) {
        steps.push('Add a TXT record at host "@" (your domain itself) with the value below. This lists ' + r.provider.name + ' as an approved sender.');
        steps.push(sendersStep());
      } else {
        steps.push('Ask ' + (r.provider.name === PROVIDER_NAMES.other ? 'your email provider' : r.provider.name) + ' for its SPF "include" value, then add a TXT record at host "@" that looks like: v=spf1 include:<their value> -all');
        steps.push(sendersStep());
      }
      return {
        title: 'Publish an SPF record',
        problem: 'There is no SPF record, so receivers have no list of servers allowed to send as ' + r.domain + '.',
        steps: steps,
        record: rec ? { type: 'TXT', host: '@', value: rec } : null,
        docs: docsFor(r.provider, 'spf')
      };
    },
    'spf-multiple': function (r) {
      return {
        title: 'Merge your SPF records into one',
        problem: 'You have ' + r.checks.spf.records.length + ' SPF records. The rules allow only one, so receivers treat SPF as broken.',
        steps: [DNS_STEP, 'Replace them with a single TXT record at host "@". A merged version is below; have your IT person confirm every service in it is still in use.', 'Delete the other v=spf1 records.'],
        record: { type: 'TXT', host: '@', value: mergeSpf(r.checks.spf.records) },
        docs: docsFor(r.provider, 'spf')
      };
    },
    'spf-too-many-lookups': function (r) {
      const spf = r.checks.spf;
      const heavy = spf.breakdown.slice().sort(function (a, b) { return b.lookups - a.lookups; }).filter(function (x) { return x.lookups > 1; }).slice(0, 3);
      const steps = ['Remove any service you no longer use (old newsletter tools, past IT vendors). A broken SPF record can also send your real email to spam.'];
      if (heavy.length) steps.push('The biggest costs: ' + heavy.map(function (h) { return h.term + ' (' + h.lookups + ')'; }).join(', ') + '.');
      steps.push('Move bulk or marketing senders to a subdomain such as news.' + r.domain + ', which gets its own SPF record.');
      steps.push('Ask your IT person to replace "a" and "mx" terms with fixed ip4: ranges where possible.');
      return {
        title: 'Trim your SPF record to 10 lookups or fewer',
        problem: 'SPF allows at most 10 DNS lookups. Yours needs ' + spf.lookups + ', so many receivers treat it as broken.',
        steps: steps,
        record: null,
        docs: docsFor(r.provider, 'spf')
      };
    },
    'spf-syntax': function (r) {
      const spf = r.checks.spf;
      return {
        title: 'Fix the errors in your SPF record',
        problem: 'Receivers stop reading an SPF record at the first error and treat it as broken.',
        steps: [DNS_STEP].concat(spf.syntax.map(function (s) { return (s.domain === r.domain ? 'In your record: ' : 'In ' + s.domain + ': ') + s.errors.join(' '); }), ['Correct or remove those terms. Common slips: a missing colon ("include:"), a typo in "include", or an extra space.']),
        record: null,
        docs: docsFor(r.provider, 'spf')
      };
    },
    'spf-include-missing': function (r) {
      return {
        title: 'Remove a broken include from SPF',
        problem: 'Your SPF record includes ' + r.checks.spf.missingIncludes.join(', ') + ', which has no valid SPF record. That makes your whole record fail.',
        steps: [DNS_STEP, 'Remove that include (it is often a service you stopped using), or check its help pages for the current value.'],
        record: null,
        docs: docsFor(r.provider, 'spf')
      };
    },
    'spf-loop': function (r) {
      return {
        title: 'Break the loop in your SPF includes',
        problem: 'Your SPF includes point back to themselves, so receivers can\'t finish checking.',
        steps: [DNS_STEP, 'Remove the include that leads back to your own domain.'],
        record: null,
        docs: docsFor(r.provider, 'spf')
      };
    },
    'spf-neutral': function (r) {
      return {
        title: 'End your SPF record with -all',
        problem: '"?all" tells receivers to treat unlisted servers as neutral, which gives no protection.',
        steps: [DNS_STEP, 'Edit the v=spf1 TXT record at host "@" and change "?all" to "-all".', sendersStep()],
        record: { type: 'TXT', host: '@', value: rewriteSpf(r.checks.spf.record, { all: '-' }) },
        docs: docsFor(r.provider, 'spf')
      };
    },
    'spf-no-all': function (r) {
      return {
        title: 'End your SPF record with -all',
        problem: 'Your SPF record doesn\'t end with "all", so servers that aren\'t on your list get a neutral result instead of failing.',
        steps: [DNS_STEP, 'Edit the v=spf1 TXT record at host "@" and add "-all" at the end.', sendersStep()],
        record: { type: 'TXT', host: '@', value: rewriteSpf(r.checks.spf.record, { all: '-' }) },
        docs: docsFor(r.provider, 'spf')
      };
    },
    'spf-softfail': function (r) {
      return {
        title: 'Tighten SPF from ~all to -all',
        problem: '"~all" only flags unlisted servers. Until DMARC is blocking fakes, "-all" gives receivers a firmer signal.',
        steps: [DNS_STEP, 'Once you are sure every service that sends as you is listed, change "~all" to "-all".'],
        record: { type: 'TXT', host: '@', value: rewriteSpf(r.checks.spf.record, { all: '-' }) },
        docs: docsFor(r.provider, 'spf')
      };
    },
    'spf-ptr': function (r) {
      return {
        title: 'Remove "ptr" from your SPF record',
        problem: '"ptr" is deprecated: it is slow, unreliable, and some receivers ignore it.',
        steps: [DNS_STEP, 'Remove the ptr term and list those servers with ip4:/ip6: or include: instead.'],
        record: r.checks.spf.record ? { type: 'TXT', host: '@', value: rewriteSpf(r.checks.spf.record, { all: r.checks.spf.allQualifier && r.checks.spf.allQualifier !== '+' && r.checks.spf.allQualifier !== 'unknown' ? r.checks.spf.allQualifier : '-', dropPtr: true }) } : null,
        docs: docsFor(r.provider, 'spf')
      };
    },
    'spf-order': function (r) {
      return {
        title: 'Put "all" last in your SPF record',
        problem: 'Anything after "all" is never read, so those senders aren\'t really approved.',
        steps: [DNS_STEP, 'Move the "-all" (or "~all") term to the very end of the v=spf1 record.'],
        record: null,
        docs: docsFor(r.provider, 'spf')
      };
    },
    'dmarc-missing': function (r) {
      const d = r.domain;
      if (noMail(r)) {
        return {
          title: 'Publish a DMARC record that blocks fakes',
          problem: 'There is no DMARC record, so email services don\'t know to block fakes that use @' + d + '.',
          steps: [DNS_STEP, 'This domain has no mail servers and lists no senders, so it doesn\'t appear to be used for email. If that\'s right, block everything now: add a TXT record with host "_dmarc" and the value below.', 'If you do send email from it, use p=none first and add a report address (rua=) instead.'],
          record: { type: 'TXT', host: '_dmarc', value: 'v=DMARC1; p=reject' },
          docs: docsFor(r.provider, 'dmarc')
        };
      }
      return {
        title: 'Publish a DMARC record',
        problem: 'There is no DMARC record, so email services don\'t know to block fakes that use @' + d + '.',
        steps: [
          DNS_STEP,
          'Add a TXT record with host "_dmarc" and the value below. It starts in monitoring mode (p=none), so it won\'t block any real email.',
          'Create the mailbox dmarc-reports@' + d + ' (or use any address you check) to receive the daily reports.',
          dkimStep(r),
          'After 2 to 4 weeks of reports showing only your real senders, change p=none to p=quarantine, then to p=reject. That is the step that actually blocks fakes.'
        ],
        record: { type: 'TXT', host: '_dmarc', value: 'v=DMARC1; p=none; rua=' + defaultRua(d) },
        docs: docsFor(r.provider, 'dmarc')
      };
    },
    'dmarc-multiple': function (r) {
      const parsed = r.checks.dmarc.records.map(parseDmarc).filter(function (p) { return p.valid; })[0] || null;
      return {
        title: 'Keep only one DMARC record',
        problem: 'You have ' + r.checks.dmarc.records.length + ' DMARC records at _dmarc.' + r.domain + '. Receivers ignore DMARC completely when there is more than one.',
        steps: [DNS_STEP, 'Delete all but one TXT record at host "_dmarc", and make the one you keep match the value below.'],
        record: { type: 'TXT', host: '_dmarc', value: buildDmarc(parsed, parsed && parsed.rua.length ? {} : { rua: defaultRua(r.domain) }) },
        docs: docsFor(r.provider, 'dmarc')
      };
    },
    'dmarc-invalid': function (r) {
      const p = r.checks.dmarc.parsed;
      const policy = p && p.policy ? p.policy : 'none';
      const rua = p && p.rua.length ? p.rua.join(',') : defaultRua(r.domain);
      return {
        title: 'Fix your DMARC record',
        problem: 'Your DMARC record has errors, so receivers ignore it: ' + (p ? p.errors.join(' ') : ''),
        steps: [DNS_STEP, 'Replace the TXT record at host "_dmarc" with the corrected value below.', dkimStep(r)],
        record: { type: 'TXT', host: '_dmarc', value: 'v=DMARC1; p=' + policy + '; rua=' + rua },
        docs: docsFor(r.provider, 'dmarc')
      };
    },
    'dmarc-none': function (r) {
      const dm = r.checks.dmarc;
      const p = dm.parsed;
      const steps = [dkimStep(r)];
      if (p && p.rua.length) steps.push('Read the DMARC reports going to ' + p.rua.join(', ') + ' and confirm all your real senders pass (your email, QuickBooks, practice software, newsletters).');
      else steps.push('Add a report address first (rua=) and read a couple of weeks of reports to confirm your real senders pass.');
      steps.push(DNS_STEP);
      steps.push('Change the TXT record at host "_dmarc" to the value below. Quarantine sends fakes to spam.');
      steps.push('After 2 to 4 more weeks of clean reports, change p=quarantine to p=reject.');
      const changes = { p: 'quarantine', pct: null };
      if (!p || !p.rua.length) changes.rua = defaultRua(r.domain);
      if (p && p.subPolicy === 'none' && p.tags.sp !== undefined) changes.sp = null;
      return {
        title: 'Switch DMARC from "monitor" to "block"',
        problem: 'Your DMARC policy is p=none. It reports on fake emails but still lets them through.',
        steps: steps,
        record: dm.inheritedFrom ? null : { type: 'TXT', host: '_dmarc', value: buildDmarc(p, changes) },
        docs: docsFor(r.provider, 'dmarc').concat(r.provider.id === 'm365' || r.provider.id === 'google' ? [docsFor(r.provider, 'dkim')[0]] : [])
      };
    },
    'dmarc-pct': function (r) {
      const p = r.checks.dmarc.parsed;
      return {
        title: 'Apply your DMARC policy to all email',
        problem: 'pct=' + p.pct + ' means only ' + p.pct + '% of fake email is blocked; the rest is delivered.',
        steps: [DNS_STEP, 'Edit the TXT record at host "_dmarc" and remove the pct tag (or set pct=100), as below.'],
        record: { type: 'TXT', host: '_dmarc', value: buildDmarc(p, { pct: null }) },
        docs: docsFor(r.provider, 'dmarc')
      };
    },
    'dmarc-sp-none': function (r) {
      const p = r.checks.dmarc.parsed;
      return {
        title: 'Protect your subdomains too',
        problem: 'sp=none lets criminals send as addresses like billing.' + r.domain + ', which look just as convincing.',
        steps: [DNS_STEP, 'Edit the TXT record at host "_dmarc" and remove "sp=none", so subdomains follow your main policy.'],
        record: { type: 'TXT', host: '_dmarc', value: buildDmarc(p, { sp: null }) },
        docs: docsFor(r.provider, 'dmarc')
      };
    },
    'dmarc-no-rua': function (r) {
      const p = r.checks.dmarc.parsed;
      return {
        title: 'Add a DMARC report address',
        problem: 'Without a report address you never see who is sending email as you, or whether your real email passes.',
        steps: [DNS_STEP, 'Edit the TXT record at host "_dmarc" and add a rua= address, as below. Create that mailbox first, or use any address you check.'],
        record: r.checks.dmarc.inheritedFrom ? null : { type: 'TXT', host: '_dmarc', value: buildDmarc(p, { rua: defaultRua(r.domain) }) },
        docs: docsFor(r.provider, 'dmarc')
      };
    },
    'dmarc-warnings': function (r) {
      return {
        title: 'Tidy up your DMARC record',
        problem: 'Parts of your DMARC record are ignored: ' + r.checks.dmarc.parsed.warnings.join(' '),
        steps: [DNS_STEP, 'Edit the TXT record at host "_dmarc" to match the cleaned-up value below.'],
        record: r.checks.dmarc.inheritedFrom ? null : { type: 'TXT', host: '_dmarc', value: buildDmarc(r.checks.dmarc.parsed, {}) },
        docs: docsFor(r.provider, 'dmarc')
      };
    }
  };

  const NICE_TO_HAVE = {
    'mtasts-missing': function (r) {
      return {
        title: 'Turn on MTA-STS (optional)',
        problem: 'Makes other servers deliver email to you over an encrypted connection.',
        steps: ['Needs a small web page at mta-sts.' + r.domain + ' plus a DNS record. Your IT provider can set it up in under an hour.'],
        record: null,
        docs: docsFor(r.provider, 'mtasts')
      };
    },
    'tlsrpt-missing': function (r) {
      return {
        title: 'Turn on TLS reporting (optional)',
        problem: 'Tells you when email to you couldn\'t be delivered securely.',
        steps: [DNS_STEP, 'Add a TXT record with host "_smtp._tls" and the value below.'],
        record: { type: 'TXT', host: '_smtp._tls', value: 'v=TLSRPTv1; rua=mailto:tls-reports@' + r.domain },
        docs: docsFor(r.provider, 'mtasts')
      };
    }
  };

  function severityOf(code, report) {
    if (code === 'spf-plus-all' || code === 'dmarc-missing' || code === 'dmarc-multiple' || code === 'dmarc-invalid') return 'critical';
    if (/^spf-(missing|multiple|too-many-lookups|syntax|include-missing|loop|neutral|no-all)$/.test(code)) {
      return report.checks.dmarc.state === 'enforced' ? 'major' : 'critical';
    }
    if (code === 'dmarc-none' || code === 'dmarc-pct' || code === 'dmarc-sp-none') return 'major';
    return 'minor';
  }

  function buildFixes(report) {
    const codes = [];
    for (const id of ['spf', 'dmarc']) {
      for (const code of report.checks[id].issues) if (FIXES[code] && codes.indexOf(code) === -1) codes.push(code);
    }
    // ~all is fine once DMARC enforces; only suggest -all before that.
    const dmarcState = report.checks.dmarc.state;
    const filtered = codes.filter(function (c) {
      if (c === 'spf-softfail') return dmarcState !== 'enforced';
      if (c === 'dmarc-no-rua') return dmarcState === 'none' || dmarcState === 'enforced' || dmarcState === 'partial';
      return true;
    });
    filtered.sort(function (a, b) { return PRIORITY[a] - PRIORITY[b]; });
    // The p=none fix already adds a report address; don't list it twice.
    const deduped = filtered.filter(function (c) { return !(c === 'dmarc-no-rua' && filtered.indexOf('dmarc-none') !== -1); });
    return deduped.map(function (code) {
      const f = FIXES[code](report);
      f.code = code;
      f.severity = severityOf(code, report);
      return f;
    });
  }

  function buildNiceToHave(report) {
    const list = [];
    for (const id of ['mtaSts', 'tlsRpt']) {
      for (const code of report.checks[id].issues) {
        if (NICE_TO_HAVE[code]) {
          const f = NICE_TO_HAVE[code](report);
          f.code = code;
          f.severity = 'optional';
          list.push(f);
        }
      }
    }
    return list;
  }

  function fillDomain(text, domain) {
    return text.replace(/\{domain\}/g, domain);
  }

  /** Fill in cross-check details once every check is in, then grade. */
  function finalize(report) {
    const c = report.checks;
    if (c.spf.state === 'soft') {
      if (c.dmarc.state === 'enforced') {
        c.spf.status = c.spf.issues.indexOf('spf-ptr') !== -1 || c.spf.issues.indexOf('spf-order') !== -1 ? 'warn' : 'pass';
        c.spf.details.unshift('~all is fine here because your DMARC policy blocks fakes. -all is slightly stricter.');
      } else {
        c.spf.details.unshift('~all only flags unlisted servers. With DMARC not yet blocking fakes, -all gives receivers a firmer signal.');
      }
    }
    if (c.mx.status === 'pass') {
      c.mx.summary = 'Email for this domain is handled by ' + report.provider.label + ' (' + c.mx.hosts.length + ' mail server' + (c.mx.hosts.length === 1 ? '' : 's') + ').';
    }
    const gid = gradeOf(c.spf.state, c.dmarc.state);
    const g = GRADES[gid];
    report.grade = { id: g.id, label: g.label, headline: g.headline, summary: fillDomain(g.summary, report.domain) };
    report.fixes = buildFixes(report);
    report.topFixes = report.fixes.slice(0, 3);
    report.niceToHave = buildNiceToHave(report);
    return report;
  }

  /* ------------------------------------------------------------------ */
  /* Orchestration                                                       */
  /* ------------------------------------------------------------------ */

  /**
   * Run every check for `domain` using `resolve(name, type)`.
   * Returns { kind: 'report', ... } or { kind: 'nxdomain' | 'unreachable', domain }.
   * `onProgress(step)` fires as each part finishes: mx, spf, dmarc, dkim, extras.
   */
  async function runCheck(domain, resolve, opts) {
    const onProgress = (opts && opts.onProgress) || function () {};
    const now = (opts && opts.now) || function () { return new Date(); };
    const started = Date.now();
    const q = function (name, type) {
      return Promise.resolve()
        .then(function () { return resolve(name, type); })
        .then(function (r) { return r || { status: 'ERROR', records: [] }; }, function (e) {
          return { status: 'ERROR', records: [], detail: String((e && e.message) || e) };
        });
    };
    const tick = function (step) {
      return function (v) {
        try { onProgress(step); } catch (e) { /* progress is cosmetic */ }
        return v;
      };
    };

    const mxP = q(domain, 'MX');
    const txtP = q(domain, 'TXT');
    const dmarcP = q('_dmarc.' + domain, 'TXT');
    const dkimP = Promise.all(DKIM_SELECTORS.map(function (s) {
      return q(s + '._domainkey.' + domain, 'TXT').then(function (res) { return { selector: s, res: res }; });
    })).then(tick('dkim'));
    const extrasP = Promise.all([q('_mta-sts.' + domain, 'TXT'), q('_smtp._tls.' + domain, 'TXT')]).then(tick('extras'));

    const mxRes = await mxP;
    const txtRes = await txtP;
    if (mxRes.status === 'NXDOMAIN' && txtRes.status === 'NXDOMAIN') {
      await Promise.all([dmarcP, dkimP, extrasP]);
      return { kind: 'nxdomain', domain: domain };
    }
    if (!isAnswer(mxRes) && !isAnswer(txtRes) && (mxRes.status === 'TIMEOUT' || mxRes.status === 'ERROR') && (txtRes.status === 'TIMEOUT' || txtRes.status === 'ERROR')) {
      await Promise.all([dmarcP, dkimP, extrasP]);
      return { kind: 'unreachable', domain: domain, status: mxRes.status };
    }
    const mx = evaluateMx(mxRes);
    tick('mx')();

    const results = await Promise.all([
      evaluateSpf(domain, q, txtRes).then(tick('spf')),
      dmarcP.then(function (res) { return evaluateDmarc(domain, q, res); }).then(tick('dmarc')),
      dkimP,
      extrasP
    ]);
    const spf = results[0];
    const dmarc = results[1];
    const provider = detectProvider(mx, spf);
    const report = {
      kind: 'report',
      domain: domain,
      checkedAt: now().toISOString(),
      elapsedMs: Date.now() - started,
      provider: provider,
      checks: {
        mx: mx,
        spf: spf,
        dmarc: dmarc,
        dkim: evaluateDkim(results[2], provider),
        mtaSts: evaluateOptional('mta-sts', results[3][0]),
        tlsRpt: evaluateOptional('tls-rpt', results[3][1])
      }
    };
    return finalize(report);
  }

  /* ------------------------------------------------------------------ */
  /* Sharing results                                                     */
  /* ------------------------------------------------------------------ */

  function mailto(to, subject, body) {
    return 'mailto:' + (to ? encodeURI(to) : '') + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body.replace(/\r?\n/g, '\r\n'));
  }

  /** "Get the full Proof Check" email to Kovyr: domain, grade, top fixes. */
  function ownerEmail(report, brand) {
    const lines = [
      'Hi ' + brand.company + ' team,',
      '',
      'I ran the free ' + brand.check + ' on ' + report.domain + '.',
      'Result: ' + report.grade.label,
      'Email handled by: ' + report.provider.label
    ];
    if (report.topFixes.length) {
      lines.push('', 'Top fixes it suggested:');
      report.topFixes.forEach(function (f, i) { lines.push(i + 1 + '. ' + f.title); });
    }
    lines.push('', "I'd like the full " + brand.fullCheck + ' for my office.', '', 'Firm name:', 'Number of people:', 'Best phone number:', '');
    return {
      subject: brand.fullCheck + ' request: ' + report.domain + ' (' + brand.check + ': ' + report.grade.label + ')',
      body: lines.join('\n')
    };
  }

  /** Fixes with records, to forward to whoever manages DNS. */
  function itEmail(report, brand) {
    const lines = [
      'Hi,',
      '',
      'I ran the free ' + brand.check + ' on ' + report.domain + ' and it rated our email-spoofing protection "' + report.grade.label + '".',
      'Could you make these changes?',
      ''
    ];
    report.topFixes.forEach(function (f, i) {
      lines.push(i + 1 + '. ' + f.title);
      lines.push('   Why: ' + f.problem);
      if (f.record) lines.push('   Record: ' + f.record.type + ' at "' + f.record.host + '": ' + f.record.value);
      if (f.docs && f.docs[0]) lines.push('   Guide: ' + f.docs[0].url);
      lines.push('');
    });
    lines.push('Thanks!');
    return { subject: 'Email security fixes for ' + report.domain, body: lines.join('\n') };
  }

  return {
    // input
    normalizeInput: normalizeInput,
    // DNS JSON
    joinTxt: joinTxt,
    parseDohJson: parseDohJson,
    isAnswer: isAnswer,
    // records
    parseMx: parseMx,
    detectProvider: detectProvider,
    evaluateMx: evaluateMx,
    isSpfRecord: isSpfRecord,
    parseSpf: parseSpf,
    evaluateSpf: evaluateSpf,
    rewriteSpf: rewriteSpf,
    mergeSpf: mergeSpf,
    parseDmarc: parseDmarc,
    buildDmarc: buildDmarc,
    evaluateDmarc: evaluateDmarc,
    orgDomain: orgDomain,
    parseDkim: parseDkim,
    evaluateDkim: evaluateDkim,
    evaluateOptional: evaluateOptional,
    // grading
    gradeOf: gradeOf,
    finalize: finalize,
    runCheck: runCheck,
    // sharing
    mailto: mailto,
    ownerEmail: ownerEmail,
    itEmail: itEmail,
    // constants
    DKIM_SELECTORS: DKIM_SELECTORS,
    SPF_MAX_LOOKUPS: SPF_MAX_LOOKUPS,
    DOCS: DOCS
  };
});
