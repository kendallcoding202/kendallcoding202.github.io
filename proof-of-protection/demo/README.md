# Proof Pack demo

A one-page, owner-friendly view of a sample Proof Pack for a fictional firm,
with a **Verify** button that runs every cryptographic check in the browser
(WebCrypto: ECDSA P-256, Ed25519, SHA-256), and a **Try to tamper** mode that
shows exactly which check catches each attack.

* Open `index.html` from any static host (it works at
  `/<project-folder>/demo/` on GitHub Pages) or straight from disk
  (`file://`), where it falls back to `data/demo-data.js`.
* No third-party or remote code. A Content Security Policy allows only this
  folder's own scripts.
* Brand strings come from `brand.js` and the schema from `verifier/schema.js`,
  both generated from the Go engine.

| Path | What it is |
|---|---|
| `index.html`, `styles.css`, `app.js` | The page (print stylesheet included: it prints as one page). |
| `verifier/` | The verifier: strict JSON, crypto, Merkle, notes, schema, the ten steps. Mirrors `engine/pack`. |
| `data/pack.json` | The sample Proof Pack (generated). |
| `data/trust-policy.json` | The keys the verifier trusts (demo keys, simulated TSAs and witnesses). |
| `data/scenarios.json` | Three attack worlds (replay, backdate, vendor rewrite) in compact form; the page rebuilds their Merkle proofs. |
| `data/demo-data.js` | The same data for `file://`. |
| `data/public-log/` | The public log as C2SP tlog-tiles: a checkpoint and 32-byte fingerprints, nothing else. |
| `demo-keys/` | The demo's private keys. **Public on purpose; see the README there.** |
| `tests/` | `vectors.js` (verifier vs shared vectors, under Node), `e2e.js` (Playwright), `serve.js`. |

## The sample month (all invented)

Maple Street Tax & Bookkeeping (sample): 9 staff, 12 devices, October 1 to 30, 2026.

* Laptop D07 sends no check-ins on Oct 12 and 13 (a disclosed 2-day gap). It
  returns on Oct 14 with BitLocker off and Defender stopped, and is fixed by
  Oct 15. A missed check-in raises an alert.
* Passkeys go from 2 to 6 of 11 accounts (Oct 15 and 16).
* A mailbox-takeover alert (a new rule forwarding mail outside the firm) on
  Oct 21, resolved by Oct 22.
* A backup restore drill on Oct 9. Four payment-change requests were called
  back; one was fraud and was blocked.
* The vendor's external scan finds DMARC set to "monitor only" until Oct 18.

## Regenerate and test

```sh
cd engine && go run ./cmd/proofctl demo generate --keys ../demo/demo-keys --out ../demo
cd ../demo && node tests/vectors.js && node tests/e2e.js /tmp/shots
```

`e2e.js` serves the repository the way GitHub Pages does, checks the verify
flow, all six tamper scenarios, `file://`, phone width, dark mode and the
one-page print layout, and fails on any console error.
