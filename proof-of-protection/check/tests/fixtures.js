/*
 * Fake DNS zones for Kovyr Check tests (Node unit tests and the Playwright
 * browser run). Record shapes are modelled on real-world records.
 *
 * Zone format:
 *   'name': { MX: ['10 host.'], TXT: [string | string[]], CNAME: 'target.' }
 *   TXT entries: a string is one character-string; an array is a record
 *   split into several character-strings (as DNS does above 255 bytes).
 *   '$rcode' / '$timeout' on a name apply to that name and all names under it.
 */
'use strict';

const TYPE_CODES = { CNAME: 5, MX: 15, TXT: 16 };

// 392 base64 chars ~ a 2048-bit RSA public key; 216 ~ 1024-bit.
const KEY_2048 = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA' + 'q'.repeat(348);
const KEY_1024 = 'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQ' + 'z'.repeat(178);

const THIRD_PARTY = {
  // Microsoft 365 publishes a flat record: 1 lookup for the include itself.
  'spf.protection.outlook.com': {
    TXT: ['v=spf1 ip4:40.92.0.0/15 ip4:40.107.0.0/16 ip4:52.100.0.0/15 ip4:52.102.0.0/16 ip4:52.103.0.0/16 ip4:104.47.0.0/17 ip6:2a01:111:f400::/48 ip6:2a01:111:f403::/49 ip6:2a01:111:f403:8000::/51 ip6:2a01:111:f403:c000::/51 ip6:2a01:111:f403:f000::/52 -all']
  },
  // Google: include + 3 nested = 4 lookups.
  '_spf.google.com': { TXT: ['v=spf1 include:_netblocks.google.com include:_netblocks2.google.com include:_netblocks3.google.com ~all'] },
  '_netblocks.google.com': { TXT: ['v=spf1 ip4:35.190.247.0/24 ip4:64.233.160.0/19 ip4:66.102.0.0/20 ip4:66.249.80.0/20 ip4:72.14.192.0/18 ~all'] },
  '_netblocks2.google.com': { TXT: ['v=spf1 ip6:2001:4860:4000::/36 ip6:2404:6800:4000::/36 ip6:2607:f8b0:4000::/36 ~all'] },
  '_netblocks3.google.com': { TXT: ['v=spf1 ip4:172.217.0.0/19 ip4:172.217.32.0/20 ip4:172.217.128.0/19 ~all'] },
  'sendgrid.net': { TXT: ['v=spf1 ip4:167.89.0.0/17 ip4:208.117.48.0/20 ip4:50.31.32.0/19 ip4:198.37.144.0/20 ~all', 'google-site-verification=abc123'] },
  'servers.mcsv.net': { TXT: ['v=spf1 ip4:205.201.128.0/20 ip4:198.2.128.0/18 ip4:148.105.8.0/21 ?all'] },
  'spf.constantcontact.com': { TXT: ['v=spf1 ip4:208.75.120.0/22 ip4:63.251.135.0/24 ip4:205.207.104.0/22 -all'] },
  // Salesforce uses an exists: macro (counts as a lookup, can't be expanded).
  '_spf.salesforce.com': { TXT: ['v=spf1 exists:%{i}._spf.mta.salesforce.com -all'] },
  'mail.zendesk.com': { TXT: ['v=spf1 ip4:192.161.144.0/20 ip4:185.12.80.0/22 ip4:188.172.128.0/20 ~all'] },
  'emailsrvr.com': { TXT: ['v=spf1 ip4:207.97.245.0/24 ip4:204.232.172.40/29 ip4:173.203.187.0/24 ~all'] }
};

const ZONES = Object.assign({}, THIRD_PARTY, {
  /* 1. Strong: Microsoft 365, -all, DMARC reject, DKIM on, MTA-STS + TLS-RPT. */
  'strongfirm.com': {
    MX: ['0 strongfirm-com.mail.protection.outlook.com.'],
    TXT: ['v=spf1 include:spf.protection.outlook.com -all', 'MS=ms48213367']
  },
  '_dmarc.strongfirm.com': { TXT: ['v=DMARC1; p=reject; rua=mailto:dmarc@strongfirm.com; adkim=r'] },
  'selector1._domainkey.strongfirm.com': { CNAME: 'selector1-strongfirm-com._domainkey.strongfirm.onmicrosoft.com.' },
  'selector1-strongfirm-com._domainkey.strongfirm.onmicrosoft.com': { TXT: [['v=DKIM1; k=rsa; p=' + KEY_2048.slice(0, 200), KEY_2048.slice(200)]] },
  'selector2._domainkey.strongfirm.com': { CNAME: 'selector2-strongfirm-com._domainkey.strongfirm.onmicrosoft.com.' },
  'selector2-strongfirm-com._domainkey.strongfirm.onmicrosoft.com': { TXT: [['v=DKIM1; k=rsa; p=' + KEY_2048.slice(0, 200), KEY_2048.slice(200)]] },
  '_mta-sts.strongfirm.com': { TXT: ['v=STSv1; id=20260101T000000;'] },
  '_smtp._tls.strongfirm.com': { TXT: ['v=TLSRPTv1; rua=mailto:tls-reports@strongfirm.com'] },

  /* 2. Microsoft 365 with DMARC p=none; DKIM CNAMEs exist but keys aren't published. */
  'monitorfirm.com': {
    MX: ['0 monitorfirm-com.mail.protection.outlook.com.'],
    TXT: ['v=spf1 include:spf.protection.outlook.com -all']
  },
  '_dmarc.monitorfirm.com': { TXT: ['v=DMARC1; p=none; rua=mailto:reports@monitorfirm.com'] },
  'selector1._domainkey.monitorfirm.com': { CNAME: 'selector1-monitorfirm-com._domainkey.monitorfirm.onmicrosoft.com.' },
  'selector2._domainkey.monitorfirm.com': { CNAME: 'selector2-monitorfirm-com._domainkey.monitorfirm.onmicrosoft.com.' },

  /* 3. Google Workspace, ~all, no DMARC at all. */
  'nodmarc.com': {
    MX: ['1 smtp.google.com.'],
    TXT: ['v=spf1 include:_spf.google.com ~all', 'google-site-verification=xyz']
  },
  'google._domainkey.nodmarc.com': { TXT: [['v=DKIM1; k=rsa; p=' + KEY_2048.slice(0, 250), KEY_2048.slice(250)]] },

  /* 4. SPF +all (Rackspace mail), DMARC p=none. */
  'openspf.com': {
    MX: ['10 mx1.emailsrvr.com.', '20 mx2.emailsrvr.com.'],
    TXT: ['v=spf1 include:emailsrvr.com +all']
  },
  '_dmarc.openspf.com': { TXT: ['v=DMARC1; p=none'] },

  /* 5. Too many lookups (13), M365, DMARC quarantine. */
  'toomany.com': {
    MX: ['0 toomany-com.mail.protection.outlook.com.'],
    TXT: [['v=spf1 include:spf.protection.outlook.com include:_spf.google.com include:sendgrid.net ', 'include:servers.mcsv.net include:spf.constantcontact.com include:_spf.salesforce.com include:mail.zendesk.com a mx -all']]
  },
  '_dmarc.toomany.com': { TXT: ['v=DMARC1; p=quarantine; rua=mailto:dmarc@toomany.com'] },

  /* 6. Two SPF records (common after switching providers). */
  'multispf.com': {
    MX: ['0 multispf-com.mail.protection.outlook.com.'],
    TXT: ['v=spf1 include:spf.protection.outlook.com -all', 'v=spf1 include:_spf.google.com ~all']
  },
  '_dmarc.multispf.com': { TXT: ['v=DMARC1; p=reject; rua=mailto:d@multispf.com'] },

  /* 7. Parked domain: no MX, no SPF, no DMARC. */
  'parked-firm.com': { TXT: ['google-site-verification=parked'] },

  /* 8. Uppercase, odd spacing, Proofpoint gateway in front of M365. */
  'shoutyfirm.com': {
    MX: ['10 mx0a-00112233.pphosted.com.', '10 mx0b-00112233.pphosted.com.'],
    TXT: ['V=SPF1 INCLUDE:SPF.PROTECTION.OUTLOOK.COM   -ALL']
  },
  '_dmarc.shoutyfirm.com': { TXT: ['V=DMARC1;P=REJECT;RUA=mailto:DMARC@SHOUTYFIRM.COM;'] },

  /* 9. Malformed DMARC + SPF typo. */
  'typofirm.com': {
    MX: ['10 typofirm-com.mail.protection.outlook.com.'],
    TXT: ['v=spf1 inlcude:spf.protection.outlook.com ip4:300.1.1.1 -all']
  },
  '_dmarc.typofirm.com': { TXT: ['v=DMARC1 p=reject rua=mailto:x@typofirm.com'] },

  /* 10. Partial enforcement: pct=25, sp=none, ptr, 1024-bit key. */
  'partialfirm.com': {
    MX: ['5 partialfirm-com.mail.protection.outlook.com.'],
    TXT: ['v=spf1 ptr include:spf.protection.outlook.com -all']
  },
  '_dmarc.partialfirm.com': { TXT: ['v=DMARC1; p=reject; pct=25; sp=none; rua=mailto:d@partialfirm.com'] },
  'selector1._domainkey.partialfirm.com': { TXT: ['v=DKIM1; k=rsa; p=' + KEY_1024] },

  /* 11. Include loop and include of a domain with no SPF. */
  'loopfirm.com': { MX: ['10 mail.loopfirm.com.'], TXT: ['v=spf1 include:spf.loopfirm.com include:gone-vendor.com -all'] },
  'spf.loopfirm.com': { TXT: ['v=spf1 include:loopfirm.com ~all'] },
  'gone-vendor.com': { TXT: ['some-other-verification=1'] },
  '_dmarc.loopfirm.com': { TXT: ['v=DMARC1; p=reject; rua=mailto:d@loopfirm.com'] },

  /* 12. Subdomain inherits DMARC from its parent. */
  'billing.strongfirm.com': { MX: ['0 strongfirm-com.mail.protection.outlook.com.'], TXT: ['v=spf1 include:spf.protection.outlook.com -all'] },

  /* 13. Escaped quotes inside TXT and a redirect= SPF. */
  'redirectfirm.com': { MX: ['10 aspmx.l.google.com.', '20 alt1.aspmx.l.google.com.'], TXT: ['v=spf1 redirect=_spf.redirectfirm.com', 'note=say "hi"'] },
  '_spf.redirectfirm.com': { TXT: ['v=spf1 include:_spf.google.com -all'] },
  '_dmarc.redirectfirm.com': { TXT: ['v=DMARC1; p=quarantine; rua=mailto:d@redirectfirm.com, mailto:x@vendor.example.net'] },

  /* Failure modes. */
  'servfail-firm.com': { $rcode: 2 },
  'slow-firm.com': { $timeout: true },
  // DMARC lookup alone times out.
  'halfslow.com': { MX: ['0 halfslow-com.mail.protection.outlook.com.'], TXT: ['v=spf1 include:spf.protection.outlook.com -all'] },
  '_dmarc.halfslow.com': { $timeout: true }
});

function ancestorRule(zones, name, key) {
  const labels = name.split('.');
  for (let i = 0; i < labels.length - 1; i++) {
    const n = labels.slice(i).join('.');
    if (zones[n] && zones[n][key] !== undefined) return zones[n][key];
  }
  return undefined;
}

function hasDescendants(zones, name) {
  const suffix = '.' + name;
  return Object.keys(zones).some(function (k) { return k.endsWith(suffix); });
}

function quoteTxt(parts) {
  return (Array.isArray(parts) ? parts : [parts])
    .map(function (p) { return '"' + p.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; })
    .join(' ');
}

/**
 * Answer a DoH JSON query from `zones`. Returns the JSON object, or the
 * string 'TIMEOUT' when the zone says the query should hang.
 * format: 'cloudflare' (quoted TXT) or 'google' (unquoted, joined TXT).
 */
function dohAnswer(zones, name, type, format) {
  name = String(name).toLowerCase().replace(/\.$/, '');
  if (ancestorRule(zones, name, '$timeout')) return 'TIMEOUT';
  const rcode = ancestorRule(zones, name, '$rcode');
  const question = [{ name: name + '.', type: TYPE_CODES[type] }];
  if (rcode !== undefined) return { Status: rcode, TC: false, RD: true, RA: true, AD: false, CD: false, Question: question };

  const answer = [];
  let current = name;
  for (let hops = 0; hops < 8; hops++) {
    const node = zones[current];
    if (!node) {
      const status = answer.length || hasDescendants(zones, current) ? (answer.length ? 3 : 0) : 3;
      return { Status: status, TC: false, RD: true, RA: true, AD: false, CD: false, Question: question, Answer: answer.length ? answer : undefined };
    }
    if (node.CNAME && type !== 'CNAME') {
      answer.push({ name: current + '.', type: 5, TTL: 3600, data: node.CNAME });
      current = node.CNAME.replace(/\.$/, '').toLowerCase();
      continue;
    }
    for (const rec of node[type] || []) {
      let data = rec;
      if (type === 'TXT') data = format === 'google' ? [].concat(rec).join('') : quoteTxt(rec);
      answer.push({ name: current + '.', type: TYPE_CODES[type], TTL: 300, data: data });
    }
    return { Status: 0, TC: false, RD: true, RA: true, AD: false, CD: false, Question: question, Answer: answer.length ? answer : undefined };
  }
  return { Status: 2, Question: question };
}

/** A resolver(name, type) for grader tests, going through parseDohJson. */
function zoneResolver(G, zones, opts) {
  opts = opts || {};
  const log = [];
  function resolve(name, type) {
    log.push(type + ' ' + name);
    const ans = dohAnswer(zones || ZONES, name, type, opts.format || 'cloudflare');
    if (ans === 'TIMEOUT') return Promise.resolve({ status: 'TIMEOUT', records: [], cnames: [] });
    return Promise.resolve(G.parseDohJson(ans, type));
  }
  resolve.log = log;
  return resolve;
}

module.exports = { ZONES, THIRD_PARTY, KEY_2048, KEY_1024, dohAnswer, zoneResolver, quoteTxt };
