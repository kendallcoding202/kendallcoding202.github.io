# Verification brief — attestation feature for Kovyr Vault

*Paste the block below into the Claude session that has been building Kovyr
Vault. It asks for verification only — explicitly no code.*

---

## Context

I'm considering a new feature for Kovyr Vault and I want you to **check and
verify it against the actual codebase before anything gets built**.

**Do not write a single line of code.** No patches, no diffs, no example
implementations, no "here's roughly how it'd look." I want an assessment: what's
accurate, what's wrong, what breaks, and what I haven't thought of. If you
think the whole idea is flawed, say so.

## What's being proposed

Kovyr Vault would gain the ability to emit a **signed attestation** — a small,
fixed-schema JSON statement describing whether the machine's security controls
are on, so an MSP or insurance broker can see the state of many client machines
without any client data leaving those machines.

This has to hold the existing zero-egress promise. The boundary:

- **Leaves the machine:** control states (on/off/unknown), counts, buckets,
  timestamps. Booleans and integers only.
- **Never leaves:** file paths, filenames, content hashes, hostnames,
  usernames, the contents of anything.

Proposed schema, roughly:

```
schema, device (UUID minted at enrollment), label (MSP-assigned),
tenant, generated_at, agent_version, platform,
controls: { disk/firewall/screenlock/antivirus -> status only },
vault: { present, entries, integrity_verified, days_since_backup,
         failed_unlocks_since_last },
exposure: { findings[]: { id, kind, matches, location_enum, filetype_enum,
            size_bucket, age_bucket, first_seen, status },
            duplicate_groups, excess_copies },
drift: { new_since_last, canary_alerts },
audit_head, signature
```

`location` is a fixed enum (`user_desktop`, `user_downloads`, `network_share`,
`external_media`, etc.) derived locally from the path, after which the path is
discarded. `id` is `HMAC(path, device_local_key)` truncated — stable across runs
so a finding can be tracked and aged, irreversible off-device.

Rough plan: new `identity.py` (device UUID + Ed25519 keypair + HMAC key),
`classify.py` (pure functions: path→location enum, extension→filetype, size and
age buckets, finding ID), `attest.py` (build, canonicalize, sign), a
`cmd_attest` following the existing CLI pattern, and a hook in `cmd_monitor`
behind an `--attest PATH` flag.

The structural rule: **`attest.py` must not import `scanner` or `monitor`, and
must never accept a snapshot dict or a `Path`** — only `posture.Check` objects,
ints, and pre-classified records. If it can't see unsafe data it can't leak it.

## Claims to verify against the code

I believe each of these. Tell me which are wrong.

1. `cryptography>=44` is already a dependency, so Ed25519 signing needs no new
   packages.
2. `audit.py` already hash-chains entries, so exposing a chain-head hash is a
   read, not new machinery — and entries themselves must stay internal because
   `_actor()` collects OS user, hostname, and pid.
3. `cmd_monitor` is the right hook: it already captures posture on the client
   machine and has counts, vault state, and drift in scope simultaneously.
4. `monitor`'s snapshot contains `groups` with `paths` and `sha256`, so the
   snapshot must never be passed to the attestation builder.
5. `posture.Check.as_dict()` includes a free-text `detail` field that should be
   stripped — `key` and `status` only.
6. `sensitive.Finding` is `path/ssn/card` with no size or mtime, so age and size
   buckets require capturing stat data inside `scan_file` where the path is
   still legitimately in scope.
7. `_read_text` caps reads at `MAX_BYTES` (5 MB), so match counts on large files
   are floors, not exact — the attestation must not imply precision the scan
   didn't deliver.
8. New CLI commands follow the `cmd_*` + `add_parser` + `set_defaults(func=...)`
   pattern.

## Questions I actually need answered

1. **Finding ID stability.** The ID is derived from the path, so moving a file
   changes its ID and it looks like a brand-new finding. Does that break the
   aging/remediation tracking the whole thing is for? Is there a better local
   anchor, and what does it cost?
2. **Key storage on Windows.** The private and HMAC keys must not be readable by
   other users. POSIX `0600` is easy; what's the honest story on Windows given
   how the project handles files today, and is it good enough to claim?
3. **Canonical JSON.** Can `audit._canonical` be reused for signing, or does
   signing need stricter guarantees (key ordering, unicode, float handling)
   than the audit log needs?
4. **Cross-platform schema stability.** Does `posture.check_all()` return a
   consistent key set on macOS vs Windows, or would attestations have different
   shapes per platform? A server aggregating both needs one schema.
5. **Lost state.** If the state directory is deleted or the machine is
   re-imaged, identity is lost and the device looks new. What's the least-bad
   behavior, and does it create a way to quietly erase a bad compliance history?
6. **Schema versioning.** How should a v1→v2 change be handled once agents are
   deployed in the field and a server is holding years of signed v1 records?
7. **Testability.** Is an adversarial test practical here — scan a fixture tree
   with incriminating paths, build an attestation, assert no path, filename,
   separator, hostname, or username appears in the serialized bytes, and assert
   the key set matches an explicit allowlist? Does that fit the existing test
   style?
8. **Anything I've missed** that would leak identifying data, break an existing
   guarantee, or make this unpleasant to maintain.

## What I want back

A written assessment: which claims are right or wrong (with the specific code
that decides it), answers to the questions above, any design flaws I've missed,
and a suggested build order with the risky parts last.

Again — **no code.** Verification only.
