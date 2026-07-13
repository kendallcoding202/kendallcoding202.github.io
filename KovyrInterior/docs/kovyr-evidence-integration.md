# Kovyr Interior → Kovyr evidence pipeline — integration design (proposal)

> **Status:** Design only. **Nothing here is built, and this document does NOT
> modify the Kovyr (`halden`) codebase.** It describes how the Kovyr Interior
> iOS app *would* feed authorization‑gated internal‑scan findings into Kovyr's
> existing WISP / evidence pipeline when you reach that phase.
>
> **Roadmap placement:** This is **Phase 3 / Phase 4** work in Kovyr's
> `PHASES.md` (active + internal scanning, and the premium internal‑audit
> upsell). Do not build it until the Phase 1B validation gate has cleared and
> you actually need internal evidence for a paying customer.

## 1. Why

Kovyr's automated product is **passive + external**. Its own WISP spec repeatedly
notes the gap it can't cover: *"not an internal vulnerability assessment… if the
firm runs internal infrastructure, additional internal testing may be required
for full §314.4(d) coverage."*

Kovyr Interior is that internal piece. Feeding its output into the same evidence
model lets a WISP packet cite **internal** evidence for:

- **Element 2 / 3(2) — asset inventory:** the device list is an internal asset
  inventory.
- **Element 3 — safeguards:** open/exposed services indicate access‑control and
  configuration posture.
- **Element 4 — test & monitor:** each on‑site scan is a monitoring event; scan
  diffs are "reviewed & adjusted" evidence.

## 2. Hard constraint — the authorization gate (CFAA)

Internal scanning is **active**. It may only run against a network the firm has
authorized in writing. The integration therefore reuses Kovyr's **existing Phase 3
gate** unchanged:

> A scan's evidence is accepted only if its asset is `verified` **and** an
> `authorizations` row covers `now()`. Gated evidence is refused at the storage
> boundary (mirroring `wisp_adapter.py`'s existing behavior).

The iOS app never decides authorization — the **backend** enforces it on ingest.
The app simply refuses to *upload* unless the operator has selected an authorized
engagement in‑app (a soft guard; the hard guard is server‑side).

## 3. Data flow

```
Kovyr Interior (iOS, on-site)
   │  scans the client LAN (device inventory + open ports)
   │  operator picks the authorized engagement (org + asset)
   ▼
POST /api/internal-scan   (HTTPS, per-operator auth token)
   │
Kovyr backend (Next.js route → Python worker)
   │  1. AUTH: token → operator → org membership
   │  2. GATE: asset is type=ip_range, verified, authorization covers now()
   │  3. create a `scans` row (source = internal)
   │  4. map each device/port → `findings` row (with diffing vs last scan)
   │  5. wisp_adapter maps check_key → (elements, wisp_section) →
   │     append one `evidence_item` per element via wisp_record_evidence()
   ▼
Existing WISP coverage view + document generator pick it up unchanged.
```

No new infrastructure. It reuses `assets` (the existing `ip_range` asset type),
`scans`, `findings`, `evidence_items`, `wisp_record_evidence()`, and the check
catalog — the same path the passive scanner already uses.

## 4. App‑side export payload

Kovyr Interior serializes a completed scan to this JSON and POSTs it. It contains
**no** service‑role secret — only the operator's bearer token in the header.

```json
{
  "engagement": {
    "org_id": "uuid",              // chosen in-app from the operator's orgs
    "asset_id": "uuid",            // an ip_range asset the operator is authorized for
    "authorization_id": "uuid"     // the signed authorization the operator selected
  },
  "scan": {
    "started_at": "2026-07-13T18:04:00Z",
    "finished_at": "2026-07-13T18:07:12Z",
    "subnet_cidr": "192.168.1.0/24",
    "gateway": "192.168.1.1",
    "app_version": "1.0 (1)"
  },
  "devices": [
    {
      "fingerprint": "dev:officeprinter",   // = app identityKey (name-based, IP fallback)
      "ip": "192.168.1.23",
      "hostname": "officeprinter.local",
      "device_type": "printer",             // inferred type
      "open_ports": [
        { "port": 9100, "service": "Printer (RAW)" },
        { "port": 631,  "service": "IPP (Printer)" }
      ],
      "services": ["_ipp._tcp"]
    }
  ]
}
```

`fingerprint` mirrors the app's `identityKey` (Bonjour/DNS name, IP fallback) so
`findings` diffing stays stable across scans — the same stability rule Kovyr's
`PHASES.md` calls out (`asset_fingerprint` must be stable, not free‑text).

## 5. Backend mapping (to build in `halden`, later)

Internal `check` catalog entries (each with a plain‑English `why`, a fix, and an
`insurance_mapping`, exactly like the existing checks):

| check_key | §314.4 element | WISP section | status logic |
|-----------|----------------|--------------|--------------|
| `INT-INVENTORY` | 2, 3(2) | §3 data inventory | informational — every device is an inventory item |
| `INT-OPEN-PORT` | 3 | §5 technical | warn on remote‑admin ports (RDP 3389, VNC 5900, SSH 22, SMB 445) exposed on the LAN |
| `INT-EXPOSED-SVC` | 3, 4 | §5 technical / §9 testing | fail on plaintext/legacy services (telnet 23, FTP 21) |
| `INT-CAMERA` | 3(2) | §3 inventory | informational — camera/DVR fingerprint flagged for review |
| `INT-SCAN-RUN` | 4, 7 | §9 testing & review | each scan = a monitoring event; diff vs prior = reviewed/adjusted |

Findings are written with the existing diff semantics (match open findings on
`(check_id, asset_fingerprint)`; present → update `last_seen`; gone →
`status='resolved'`). Then `wisp_adapter` appends one `evidence_item` per element
via `wisp_record_evidence()`, tagged `source = internal-scan` (a new label
alongside the existing `scan` / `attestation`).

## 6. Security requirements

- **AuthN/Z:** per‑operator bearer token (or Supabase session) mapped to
  `org_members`; the server verifies membership before accepting a payload.
- **The app never holds the service‑role key.** Ingest goes through a server
  route that uses service‑role only server‑side (same rule as the rest of Kovyr).
- **Gate server‑side:** verify `asset.verified` and a covering `authorizations`
  row before writing anything; log the `authorization_id` on the `scans` row.
- **Transport:** HTTPS only; reject payloads over a size cap; validate every
  field (explicit checks / Zod), clamp array lengths.
- **Least privilege:** the ingest token can only write scans for orgs the
  operator belongs to; it cannot read other orgs (RLS still applies).

## 7. What Kovyr (`halden`) would need — checklist for later

- [ ] Migration: allow `scans.source = 'internal'`; seed the `INT-*` checks in
      the catalog with element/section mappings.
- [ ] Ingest route `POST /api/internal-scan` (auth + gate + validation).
- [ ] Worker `ingest_internal_scan(payload)`: gate → create scan → upsert
      findings with diffing → call `wisp_adapter` for evidence.
- [ ] Extend `wisp_record_evidence` source enum with `internal-scan`.
- [ ] Coverage view + WISP generator: no change needed — they read `evidence_items`.
- [ ] Operator UX: select org + authorized asset before upload; show the gate
      result.

## 8. Kovyr Interior (iOS) side — what this repo would add (also later)

- [ ] An **Export / Upload** action on a completed scan (build the payload in §4).
- [ ] Engagement picker (org + authorized asset) fetched from the backend.
- [ ] Bearer‑token storage in the Keychain; HTTPS upload with retry.
- [ ] A clear in‑app statement that scanning requires written authorization.

Until then, Kovyr Interior stays a standalone field/triage tool and its History
tab already serves as a local internal inventory.
