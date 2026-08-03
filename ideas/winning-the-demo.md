# Winning the demo without weakening the boundary

*Addendum to [attestation-architecture.md](./attestation-architecture.md).*

I previously wrote that competitors with server-side drill-down "will demo
better" and framed that as an acceptable cost. That was too passive. Most of the
gap closes with schema work, and the part that doesn't should be fought on a
different axis entirely.

The demo weakness is real but misdiagnosed. Nobody wants the file path. They
want the answer to *"how bad is it and what do I do?"* — and a path is just the
crudest possible way to convey that. Structured non-identifying attributes
answer it better, and they're all enums.

---

## Change 1 — A safe-detail vocabulary in the attestation

**This is the change that closes most of the gap.** Right now `exposure` reports
`unencrypted_sensitive_files: 3` — a number with no texture. Replace it with
per-finding records built entirely from controlled vocabularies:

```json
"exposure": {
  "findings": [
    {
      "id": "F-7a2c41b9",
      "kind": "ssn",
      "matches": 1240,
      "location": "user_downloads",
      "filetype": "csv",
      "size_bucket": "1m_10m",
      "age_bucket": "gt_1y",
      "first_seen": "2026-05-02",
      "status": "open"
    }
  ],
  "duplicate_groups": 17,
  "excess_copies": 41
}
```

The `location` enum is a fixed set — `user_desktop`, `user_downloads`,
`user_documents`, `user_other`, `shared_local`, `network_share`,
`external_media`, `temp`, `other` — derived locally from the path and then the
path discarded. `filetype` comes from an extension allowlist, everything else
collapsing to `other`. Sizes and ages are buckets, never exact values.

Compare what the dashboard can now say:

> ~~3 files containing SSNs~~
>
> **A CSV in a user's Downloads folder holds 1,240 Social Security numbers. It
> has been sitting there over a year, and it's been flagged and unresolved for
> 34 days.**

That is a *better* demo line than a file path, and it leaked nothing. The path
never left the machine; a fixed vocabulary of nine location values did.

**Effort:** classification helpers in `sensitive.py`, plus the schema change.
Small. Do it before the first pilot — retrofitting a schema across deployed
agents is the expensive version.

---

## Change 2 — Stable opaque finding IDs

`id` above is `HMAC(path, device_local_key)` truncated, where the key is
generated at enrollment and **never leaves the device**. The server sees
`F-7a2c41b9` — stable across runs, so it can track that a finding has persisted
34 days, been assigned, been remediated, and stayed closed. But it is
irreversible off-device and meaningless on any other machine.

This buys the entire remediation workflow — aging, assignment, SLA tracking,
"closed and verified" — which is what MSPs actually run their week on, and it's
worth more to them than forensics. The local report prints the ID next to the
real path, so a tech on the machine reconciles the two instantly.

**Effort:** small. One helper, one key file alongside the existing device state.

---

## Change 3 — Live cryptographic freshness

Give the dashboard a **"Verify now"** button. The server issues a nonce, the
endpoint signs a fresh attestation including it, and the dashboard shows the
result verified seconds ago.

This is the single best demo moment available to you and no competitor has it,
because it only works if evidence originates on the endpoint. Every
questionnaire-based platform is showing a broker something a human typed into a
form at some point in the past. You show a machine cryptographically asserting
its own state, live, in the meeting.

Lead the demo with this.

**Effort:** medium — needs the nonce endpoint and a dispatch path (RMM job or an
agent poll). Worth it.

---

## Change 4 — Compete on the portfolio view, not the file view

The competitor's drill-down demos to *one tenant at a time*. Your buyer is a
broker with 400 clients or an MSP with 60. Their question is never "which file
on this laptop" — it's **"which of my 400 clients will fail their renewal?"**

Build the book-level view: a heatmap across the whole portfolio, clients ranked
by renewal date against unresolved findings, a "these six renew in 30 days with
disk encryption off" worklist. Because attestations are tiny you can keep years
of them, so you get trend lines nobody else can produce: *MFA on for 214
consecutive days, verified daily, signed.* Continuous proof is a graph; a
questionnaire is a snapshot.

This flips the comparison. On their axis you lose a little. On this axis they
have nothing, and it's the axis the buyer actually pays for.

**Effort:** this is most of the server product. It's the work either way.

---

## Change 5 — The escape hatch, for the rare case that needs a path

Sometimes a tech genuinely needs the filename. Handle it by **dispatching, not
by storing**: the dashboard's "open detail" button fires an RMM job on that
endpoint, which renders the full local report — paths included — in the tech's
own session on the machine they already administer. Nothing transits your
server; the detail exists only where it always did.

Slower than a click-through into a database. Also the only version an MSP's own
compliance officer will sign off on without a conversation.

**Effort:** small, and mostly integration glue per RMM vendor.

---

## What I would explicitly not do

**Redacted paths** (`C:\Users\***\Downloads\***.csv`) look like a clever middle
ground and are a trap. Redaction is leaky — segment count and depth hint at
structure, and one missed pattern in one edge case turns a structural guarantee
into a bug report. Change 1 delivers the same demo value with a fixed vocabulary
that cannot leak by construction. Take the enum.

**Hashed paths** are worse. A salted hash still permits confirmation attacks:
anyone who guesses a path can verify it's present. That's precisely the property
you're selling against.

---

## Revised position

With changes 1–3, the drill-down gap mostly closes — and on freshness and
portfolio view you're ahead rather than behind. The residual limitation is
narrow and defensible: *the exact filename lives only on the machine, and here's
the button that shows it to you there.*

The constraint stops being an apology in the demo and becomes the differentiator
— which is the same bet `0.14.0` already made when breach-scan was removed.
