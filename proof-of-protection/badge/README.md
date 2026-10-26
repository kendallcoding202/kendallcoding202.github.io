# Kovyr Proof badge and trust page

Firms put a small badge on their website and in their email signature. Clicking it opens the firm's own **trust page**, which shows their current protection status and links to the verifier for their live Proof Pack.

| File | What it is |
|---|---|
| `sample.html` | Sample trust page for a fictional firm, "Maple Street Tax & Bookkeeping (sample)". Has a sample banner and a *Checks current / Checks lapsed* preview switch (or add `?state=lapsed`). |
| `trust.html?f=<slug>` | A real firm's trust page. Reads `firms/<slug>/firm.json`. |
| `embed.html?f=<slug>` | Badge setup page to send the firm: a copyable signature badge plus prefilled HTML. Without `?f=` it shows the sample. |
| `img/` | Sample badges: `{verified,lapsed}-{web,email}-{light,dark}.{svg,png}` and `mark.svg`. For previews only. Real firms use their own files (below). |
| `firms/<slug>/` | One folder per firm: `firm.json` plus the badge files generated from it. `firms/_template/` is a starting point (not published, not built). |
| `build-badges.js` | Draws every badge from the brand constants in `../check/brand.js`. |
| `trust.js`, `trust.css`, `embed.js` | Page logic and styles. No third-party code, fonts or analytics. |

Sizes: website badge 280×64, email-signature badge 232×40 (PNGs are rendered at 2× for sharp display).

## The one rule: a badge never says "verified" after checks lapse

- **Trust page.** The visitor's browser decides the state using `computeState()` in `trust.js`. The page shows *Verified* only if `status` is `"verified"`, `lastVerified` isn't in the future, and the current time is before `validUntil`. Anything missing or malformed shows *Lapsed*. `validUntil` is capped at 31 days after `lastVerified`, so a typo can't keep a firm verified for a year. This happens without anyone touching the site.
- **Badge images** are static files, so they can't expire by themselves. Each firm embeds **its own** image URLs (`firms/<slug>/…`), and `build-badges.js` redraws them as Verified or Lapsed using the same rule. File names never change, so the firm's embed code never changes either. **Run `node badge/build-badges.js --all` at least once a day** (see "Daily refresh") and whenever a Proof Pack is updated. Verified badges also print the date of the last check (for example "Checked 26 Oct 2026"), so a stale image is visibly stale.
- **Alt text and titles are state-neutral** ("Kovyr Proof security checks: see current status"). The image can change but the firm's HTML can't, so the HTML must never say "verified".
- Some email services cache images for a while (Gmail proxies them), so a signature badge can take up to about a day to change. The trust page it links to is always current.

## Embed code: website

Each real firm gets its own trust-page URL and badge files. The easiest route is to send the firm `embed.html?f=<slug>`, which fills in the exact URLs. To write it by hand, replace `BASE` with the public address of this folder, for example `https://kendallcoding202.github.io/proof-of-protection/badge` (or `…/kovyr-proof/badge` after the rename), and `maple-street` with the firm's slug.

```html
<a href="BASE/trust.html?f=maple-street" target="_blank" rel="noopener" title="Kovyr Proof security checks: see current status">
  <img src="BASE/firms/maple-street/web-light.svg" width="280" height="64" border="0"
       alt="Kovyr Proof security checks: see current status">
</a>
```

On a dark website background, use `web-dark.svg`. If a website builder won't accept SVG, use `web-light.png` or `web-dark.png` with the same width and height.

## Embed code: email signature

Email clients block scripts and many block SVG, so signatures use a **hosted PNG with a link**. Never attach or upload the image: an embedded copy would never switch to Lapsed.

```html
<a href="BASE/trust.html?f=maple-street" target="_blank" rel="noopener"><img
  src="BASE/firms/maple-street/email-light.png" width="232" height="40" border="0"
  alt="Kovyr Proof security checks: see current status"></a>
```

- **Outlook and Apple Mail:** open `embed.html?f=<slug>`, click **Copy badge for my signature**, then paste into the signature editor.
- **Gmail:** Settings › See all settings › Signature. Click the image button, choose **Web address (URL)** and paste the `email-light.png` URL. Then select the image, click the link button and paste the trust-page URL.
- Use `email-dark.png` only if the signature sits on a dark background.

## Adding a firm

1. Copy `firms/_template/` to `firms/<slug>/`. A slug is lowercase letters, digits and dashes, such as `maple-street`.
2. Fill in `firm.json` from the firm's Proof Pack: `firm`, `tagline`, `lastVerified`, `validUntil` (no more than 31 days later), `proofUrl` (the Proof Pack verifier link; relative or `https://` only), `coverage`, and the `protections`. Set `"met": false` for any protection that isn't in place; the page shows it as *Not met* rather than hiding it. Name the `source` honestly ("Microsoft 365, read automatically", "Device check signed with each laptop's hardware key", "Staff record, entered by the firm").
3. Run `node badge/build-badges.js --firm <slug>` to draw the firm's badge files.
4. Publish, then send the firm `BASE/embed.html?f=<slug>`.

When checks stop, set `"status": "lapsed"` (or just let `validUntil` pass) and rebuild. To remove a firm, delete its folder: the trust page then says no record exists and shows no status.

## Daily refresh

The script needs Node 18+ and, for PNGs, Playwright's Chromium (`npm i -g playwright && npx playwright install chromium`; add `--no-png` to skip PNGs). To automate it, add a scheduled workflow such as this one to `.github/workflows/`; it rebuilds every firm daily and commits any change:

```yaml
name: Refresh Kovyr Proof badges
on:
  schedule: [{ cron: "17 10 * * *" }]
  workflow_dispatch: {}
permissions:
  contents: write
jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm i playwright@1 && npx playwright install --with-deps chromium
      - run: NODE_PATH=$PWD/node_modules node proof-of-protection/badge/build-badges.js --all
      - run: |
          git config user.name "badge-refresh"
          git config user.email "badge-refresh@users.noreply.github.com"
          git add proof-of-protection/badge/firms
          git diff --cached --quiet || git commit -m "Refresh Kovyr Proof badges"
          git push
```

Adjust the path if the folder is renamed to `kovyr-proof/`. In production, Kovyr's backend should serve each badge with a short cache lifetime instead.

## Renaming the brand

Change `company` / `product` in `../check/brand.js`, then run `node badge/build-badges.js` (samples) and `node badge/build-badges.js --all` (firms). Pages pick up the new name at load time; the badge text shrinks to fit if the new name is longer.

## Wording rules

The badge and pages say only what the evidence shows: "Security checks verified · Kovyr Proof" or "Security checks lapsed · Not current". Never use "unhackable", "certified secure", "compliant", "guaranteed" or similar. Every trust page states what the proof does **not** show: that the firm can't be breached, that it is compliant with any law or standard, or anything about unenrolled devices. The tests enforce this for the badge text.

## Tests

```sh
node --test proof-of-protection/badge/tests/*.test.js     # state rule, badge text, firm builds
node proof-of-protection/badge/tests/browser.e2e.js       # Playwright: pages, fail-safes, badge rendering
```
