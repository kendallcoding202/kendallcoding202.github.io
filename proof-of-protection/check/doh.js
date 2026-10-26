/*
 * DNS-over-HTTPS client for Kovyr Check.
 *
 * Asks Cloudflare's public JSON API first and falls back to Google's when
 * Cloudflare errors, times out or returns SERVFAIL. Only public DNS records
 * are requested; nothing else leaves the browser. `fetch` is injectable so
 * Node tests can simulate every failure mode.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./grader.js'));
  else root.KovyrDoh = factory(root.KovyrGrader);
})(typeof self !== 'undefined' ? self : this, function (G) {
  'use strict';

  const PROVIDERS = [
    {
      id: 'cloudflare',
      name: 'Cloudflare',
      url: function (name, type) {
        return 'https://cloudflare-dns.com/dns-query?name=' + encodeURIComponent(name) + '&type=' + encodeURIComponent(type);
      },
      headers: { accept: 'application/dns-json' }
    },
    {
      id: 'google',
      name: 'Google',
      url: function (name, type) {
        return 'https://dns.google/resolve?name=' + encodeURIComponent(name) + '&type=' + encodeURIComponent(type);
      },
      headers: {}
    }
  ];

  const DEFAULT_TIMEOUT_MS = 5000;

  /**
   * createResolver({ fetch, timeoutMs, providers }) → { resolve(name, type), stats }
   * resolve() never rejects; it resolves to { status, records, cnames, provider }.
   */
  function createResolver(opts) {
    opts = opts || {};
    const fetchFn = opts.fetch || (typeof fetch === 'function' ? fetch.bind(typeof self !== 'undefined' ? self : globalThis) : null);
    const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
    const providers = (opts.providers || PROVIDERS).slice();
    const cache = new Map();
    const stats = { queries: 0, byProvider: {}, failures: {} };

    async function ask(provider, name, type) {
      if (!fetchFn) return { status: 'ERROR', records: [], cnames: [], detail: 'fetch is not available' };
      const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      let timedOut = false;
      let timer;
      const timeout = new Promise(function (resolve) {
        timer = setTimeout(function () {
          timedOut = true;
          if (ctrl) ctrl.abort();
          resolve({ status: 'TIMEOUT', records: [], cnames: [], detail: 'No answer within ' + timeoutMs + ' ms' });
        }, timeoutMs);
      });
      const attempt = (async function () {
        try {
          const res = await fetchFn(provider.url(name, type), {
            method: 'GET',
            headers: provider.headers,
            signal: ctrl ? ctrl.signal : undefined,
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
            cache: 'no-store'
          });
          if (!res || !res.ok) return { status: 'ERROR', records: [], cnames: [], detail: 'HTTP ' + (res && res.status) };
          const json = await res.json();
          return G.parseDohJson(json, type);
        } catch (e) {
          return { status: timedOut ? 'TIMEOUT' : 'ERROR', records: [], cnames: [], detail: String((e && e.message) || e) };
        }
      })();
      const result = await Promise.race([attempt, timeout]);
      clearTimeout(timer);
      return result;
    }

    function demote(provider) {
      // A provider that just failed goes to the back of the line, so the
      // remaining lookups don't each wait out its timeout.
      const i = providers.indexOf(provider);
      if (i !== -1 && i < providers.length - 1) {
        providers.splice(i, 1);
        providers.push(provider);
      }
    }

    function resolve(name, type) {
      const key = type + ' ' + String(name).toLowerCase();
      if (cache.has(key)) return cache.get(key);
      const p = (async function () {
        let last = null;
        const order = providers.slice();
        for (const provider of order) {
          stats.queries++;
          stats.byProvider[provider.id] = (stats.byProvider[provider.id] || 0) + 1;
          const r = await ask(provider, name, type);
          r.provider = provider.id;
          if (r.status === 'NOERROR' || r.status === 'NXDOMAIN') return r;
          stats.failures[provider.id] = (stats.failures[provider.id] || 0) + 1;
          if (r.status === 'TIMEOUT' || r.status === 'ERROR') demote(provider);
          last = r;
        }
        return last || { status: 'ERROR', records: [], cnames: [], detail: 'No DNS providers configured' };
      })();
      cache.set(key, p);
      return p;
    }

    return { resolve: resolve, stats: stats };
  }

  return { createResolver: createResolver, PROVIDERS: PROVIDERS, DEFAULT_TIMEOUT_MS: DEFAULT_TIMEOUT_MS };
});
