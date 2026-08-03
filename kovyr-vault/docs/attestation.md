# Signed attestations — parked spec

**Status: PARKED. Do not build.** Verified against the codebase at
v0.16.0; the findings below are accurate as of that version. Two blockers
make it unshippable as originally specified, and one of them cannot be
solved inside Kovyr Vault at all. Revisit only on the trigger at the
bottom.

---

## What it is

Kovyr Vault would write a small, signed file stating what a machine's
security controls looked like at a point in time:

> *"On 2026-08-01, this machine had disk encryption **on**, firewall
> **on**, screen lock **off**, antivirus **on**. 3 files hold unencrypted
> SSNs. The vault was backed up 6 days ago."*

Like a vehicle inspection sticker: a compact, tamper-evident statement
that someone can verify without examining the machine themselves.

**The constraint that makes it viable:** the file carries only booleans,
integers, enums and timestamps. Never paths, filenames, content hashes,
hostnames, usernames, or contents. It preserves the zero-egress promise
while still being useful off-machine.

**Who it's for:** aggregation. An MSP with 20 client offices, a
cyber-insurance broker wanting proof rather than a questionnaire answer,
or Kovyr itself once it manages enough machines that checking each one
individually is tedious.

---

## Blockers

### 1. The vault block cannot be produced by `cmd_monitor`

`vault.py:_load_index` decrypts the index (`crypto.decrypt(self._key,
...)`), so `list_files()` and `verify()` **both require the passphrase**.
`verify()` additionally decrypts every file. `cmd_monitor` deliberately
runs unattended without a passphrase — its own `--vault` help says "no
passphrase needed."

What is actually readable keyless:

| Field | Keyless? | Source |
|---|---|---|
| `present` | yes | `vault.json` exists |
| `entries` | **no** | encrypted index — use `monitor.blob_inventory()` count and name it `blobs` (dedup means blobs ≤ entries; they are not the same number) |
| `integrity_verified` | **ambiguous** | audit-chain check (`audit.verify_log`) is free; decrypt-verify (`vault.verify`) needs the key and is O(vault). Pick one and name it unambiguously — `audit_chain_intact` vs `vault_contents_verified` |
| `days_since_backup` | yes | `backup.days_since_backup` reads a marker file, returns `int \| None` |
| `failed_unlocks` | yes | `audit.count_events` over plaintext JSONL |

### 2. A signature without enrollment proves the wrong thing

The signature proves *"someone holding this private key asserted this."*
It does **not** prove the attestation came from a particular client's
machine. `device` (self-minted UUID), `label`, and `tenant` are all
self-asserted — anyone can generate a keypair, write someone else's
tenant name, and sign all-green.

Fixing this requires a server-side enrollment step (enrollment token, or
trust-on-first-use binding pubkey→device→tenant, with a changed pubkey
for a known device raising an alert). **That work lives in halden, not in
Vault.** Building the Vault half alone yields signed statements no
recipient can justifiably trust.

---

## Verified codebase facts (v0.16.0)

Confirmed true — these do not need re-checking:

- `cryptography>=44` is already a dependency; Ed25519 needs no new package.
- `audit.py` hash-chains entries (`_chain_hash`, `prev`/`hash`), so
  exposing a chain-head hash is a read, not new machinery.
- Audit entries must stay internal: `_actor()` collects OS user,
  `socket.gethostname()`, and pid into **every** entry, and
  `_append()` writes `entry["target"] = str(target)` (callers pass
  hashed ids, but the field accepts anything).
- `cmd_monitor` is the right hook — it already captures posture and has
  counts, vault state and drift in scope simultaneously.
- The monitor snapshot must never reach the builder: `snapshot_from_scan`
  emits `groups[].paths` and `groups[].sha256`, and `record_run` persists
  `state["inventory"]` (path→size) and `state["hash_cache"]` (path-keyed).
  **`state.json` is a path database.**
- `posture.Check.as_dict()` includes free-text `detail` — strip it. Its
  concrete leak vectors: antivirus **product name**, BitLocker **drive
  letter**, screen-lock **delay**.
- `sensitive.Finding` is `path/ssn/card` only — size and age buckets need
  stat captured inside `scan_file` while the path is legitimately in
  scope. That ripples to `cmd_discover`, the GUI results window, and
  `test_sensitive.py`.
- `sensitive._read_text` caps reads at `MAX_BYTES` (5 MB) and skips
  binary/undecodable files, so match counts are **floors**. As of 0.16.0
  `ScanReport.read`/`.skipped` quantify this — an attestation must carry
  the coverage numbers, never imply full coverage.
- New CLI commands follow `cmd_*` + `add_parser` + `set_defaults(func=)`.
- **Fixed in 0.16.0:** `posture.check_all()` now returns the same four
  keys on every platform with an `applicable` flag, so the per-platform
  schema-shape problem is already solved.

---

## Trust-model decisions to settle BEFORE any code

1. **Enrollment.** How does a pubkey get bound to a device and tenant?
   Until this is answered, nothing else matters.
2. **Replay.** A signed all-green file is replayable forever. Needs a
   monotonic per-device `seq` plus a server freshness window.
3. **Clock.** `generated_at` comes from the local clock (`util.now_iso`)
   and is trivially backdated. The server must stamp its own receipt time
   and flag skew.
4. **Lost state.** Deleting the state directory mints a new identity and
   orphans the history — **a quiet-erasure path**, unclosable client-side
   by anyone with local admin. Least-bad: stamp `enrolled_at` and alert
   server-side on "new device in a tenant bearing the label of a device
   that stopped reporting." State the limit plainly to any broker: an
   attestation proves a device reported a state at a time; **it cannot
   prove no device was hidden.** Absence detection needs a server-side
   expected-device roster.
5. **Finding ID anchor.** Path-derived IDs break the tracking this exists
   for — the natural remediation (move the file into a Locked folder) is
   a move, so successful remediation and a fresh violation look identical.
   Content-derived (HMAC over the file's SHA-256) survives moves and
   renames; cost is that editing the file mints a new ID. Inode/file-index
   is a trap (breaks on copy, volume change, re-image). Either way
   `first_seen` needs new local persistence that must never be emitted.
6. **Key storage on Windows.** The only `chmod` in the package is
   `vault.py:58`, commented "owner-only where the OS honors it" and
   wrapped in `try/except`. On Windows `chmod(0o600)` only toggles the
   read-only bit — it does **not** restrict other users. Honest options:
   DPAPI via `ctypes` (no new dependency, the real answer), or
   `%APPDATA%` default ACLs (user + Administrators + SYSTEM). Bound the
   stakes correctly when describing it: this key signs attestations, it
   does not decrypt client data — compromise means forged compliance
   claims, not a data breach.
7. **Canonicalization.** `audit._canonical` has the right technique
   (`sort_keys`, tight separators, UTF-8) but excludes the key `"hash"`;
   signing must exclude `"signature"`. Generalize it, don't share it.
   **Ban floats outright** (Python emits `NaN`/`Infinity`, invalid JSON,
   and float repr varies) — every field int/bool/enum/null.
   NFC-normalize or ASCII-restrict `label`, the one free-text field.
8. **Versioning.** A stored attestation can never be re-serialized — its
   signature covers exact bytes under v1 canonicalization rules. The
   server must keep the **raw signed bytes verbatim** forever and keep a
   v1 verifier permanently. Version the canonicalization, not just the
   schema.
9. **Caps.** `findings[]` is unbounded; a client with 5,000 sensitive
   files yields 5,000 records. The repo caps everywhere already
   (`DUPES_ROW_CAP`, `VAULT_LIST_CAP`, `MAX_GROUPS_SHOWN`,
   `MAX_HISTORY`). Cap it and emit an explicit `truncated: true`.
10. **`canary_alerts` are free-text strings** built by `monitor.canary_check`.
    Emit `{kind: enum, count: int}`, not prose.
11. **`location` enum is approximate.** Needs `Path.home()`; on Windows a
    mapped network drive and a USB stick are both drive letters. Don't
    imply precision the classification doesn't have.

---

## The structural rule (keep this regardless)

`attest.py` must not import `scanner` or `monitor`, and must never accept
a snapshot dict or a `Path` — only `posture.Check` objects, ints, and
pre-classified records. **If it cannot see unsafe data it cannot leak
it.** This makes the safety property checkable by import graph rather
than by reviewer diligence, and it is the best part of the design.

---

## Communications impact

Shipping this changes a claim already made in writing. Today:
*"nothing leaves the machine."* After: *"no client data leaves; control
states do, and only when the operator chooses to transmit a file Vault
wrote locally."* Vault still makes no outbound connection — a human moves
the file — and that property is worth preserving deliberately. But the
data-handling summary PDF and any legal review must be updated to the new
wording **before** shipping, not after.

---

## Build order (risky parts last)

1. **Settle the trust model on paper** (items 1–4 above). If enrollment
   doesn't resolve, stop here.
2. **`classify.py`** — pure functions, no I/O, no app imports. Highest
   confidence, lowest risk.
3. **The adversarial test harness** — before the builder exists, so it
   gates rather than follows. Precedent:
   `tests/test_vault.py::test_no_plaintext_at_rest` walks every byte
   asserting a marker's absence. Extend it structurally: assert every leaf
   is `bool | int | None` or an allowlisted enum string; assert the key
   set matches a hardcoded expectation; assert no value contains `/`,
   `\`, `:`, `os.sep`, the fixture username, or the hostname; run it
   across simulated macOS and Windows.
4. **Extend `sensitive.Finding` with size/mtime** — small but cross-cutting.
5. **`attest.py`** (build + canonicalize), import rule enforced, signing
   stubbed. Get the shape right unsigned.
6. **`identity.py`** — keypair + HMAC key. **Windows DPAPI is the risk
   here**: platform-specific, hard to test in CI, and where an overclaim
   would be most damaging.
7. **Signing + `cmd_attest`.**
8. **`--attest` hook in `cmd_monitor`** — last, because that is where the
   unsafe objects live and where a careless refactor reintroduces a leak.

Do not start at 6 or 8 because they feel like the real work.

---

## Revisit trigger

Build only when **either** is true:

- An actual MSP or insurance broker asks for it, **or**
- Kovyr manages enough client machines that per-machine checking is a
  real operational burden (roughly 5+).

Until then this is speculative infrastructure for a fleet of zero, and
the enrollment half belongs to halden anyway.
