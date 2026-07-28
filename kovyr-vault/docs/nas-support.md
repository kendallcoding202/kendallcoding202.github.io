# NAS support — parked spec

**Status: PARKED.** Do not build yet. The decision gate is the
Kimball & Roberts meeting — learn their actual setup first, then decide
with the rule at the bottom of this doc. If greenlit, the build below is
scoped to roughly one week including testing.

This exists because a client asked, in effect, "can Kovyr encrypt data on
our NAS?" That phrase means three very different things. We are building
**one** of them, deliberately not the other two.

---

## What we are NOT building

- **Block/volume encryption of the NAS itself.** Synology and QNAP already
  ship encrypted shared folders; DIY boxes have LUKS/BitLocker. Reinventing
  volume encryption is huge, driver-level, and competes with free built-in
  features. No.
- **A transparent, always-on, multi-user encrypted network share** (the
  Cryptomator / PreVeil / Boxcryptor category). Virtual mounted volumes +
  multi-user key management + concurrent-write locking is a different
  product and a severe liability for a solo operator. No.

Kovyr's vault is **single-writer** by design. Anything requiring several
workstations to edit one encrypted store simultaneously is out of scope —
recommend the NAS vendor's native encryption for that layer instead.

---

## What we ARE building (if greenlit)

Two small, honest pieces that fit Kovyr's DNA (file/container-level,
client-held keys, local-first, compliance-oriented).

### A. Vault-on-NAS support

Let a vault's root live on a network share so a **defined set of sensitive
files** is Kovyr-encrypted, sits on the NAS, is backed up, and is audited —
with a key the client holds, separate from the NAS login.

Work:
- Verify create / open / add / restore / backup when the vault root is a
  UNC path (`\\server\share\...`) or mapped drive (`Z:\`) on Windows, and a
  mounted SMB share (`/Volumes/...`) on macOS.
- Harden the network failure modes: share disconnects mid-operation,
  latency, and — critically — confirm the index's atomic-replace write
  (`os.replace`) is safe over SMB, falling back gracefully if not.
- **Single-writer lockfile:** drop a lock in the vault so a second machine
  opening the same vault is refused with a clear message ("this vault is in
  use by another computer") instead of racing the index. This is the key
  robustness piece for a shared location.
- GUI Settings: allow choosing a network path for the vault, validate it's
  reachable, and show a friendly error if the share drops.
- Docs that state the limit plainly: a single-maintainer archive of
  selected files, **not** a live multi-user share.

### B. NAS-native encryption check (assessment)

Same shape as the FileVault/BitLocker check (`diskcrypto.py`): report
whether the NAS's own encrypted-shared-folder feature is on, so the
assessment can verify it and guide the client to enable it.

Reality check that the meeting must settle: full auto-detection needs the
vendor's API + admin credentials and is **per-vendor** (Synology DSM API,
QNAP, etc.). So v1 is one of:
- **Guided checklist + report line** (works for any NAS, no creds): "Is the
  NAS shared folder encrypted? Synology: Control Panel → Shared Folder →
  Encryption. QNAP: …" — captured in the engagement report.
- **Targeted auto-check for their specific model** — only worth building if
  Kimball & Roberts run a known box and give admin access. Decide after the
  meeting.

Either way, if the Kovyr vault lives on the NAS, the report can state that
*that data* is encrypted regardless of the NAS's own setting — a clean
assurance line.

---

## Discovery checklist for the Kimball & Roberts meeting

Bring answers back to these; they decide the build.

1. **Is there a NAS/server holding sensitive data at all?** Make & model —
   Synology? QNAP? Windows Server? Or just workstations + an external HD?
2. **Is that data encrypted at rest today?** Is the vendor's shared-folder
   encryption on, off, or unknown?
3. **How is it accessed?** Mapped drive on each workstation? **How many
   people edit the same files at the same time?**
4. **What sensitive data lives there** (PHI, financials, imaging/X-rays,
   backups) and roughly how much?
5. **Workstation OS mix** — Windows, Mac, both?
6. **Backups** — what writes to the external HD, on what schedule, and is
   it encrypted?
7. **Who administers the NAS?** Are admin credentials available (needed for
   an automated encryption check)?

## Decision rule

- **NAS exists + sensitive data on it + native encryption OFF or unknown**
  → build A (vault-on-NAS) + B (check). Worth it.
- **No NAS — just endpoints + an external HD** → skip. The current features
  (vault, backup-to-external, disk-check) already cover them.
- **They need a live, multi-user encrypted share** → out of scope. Point
  them at the NAS's native encryption; use Kovyr for the specific regulated
  file set on top.

## Rough one-week plan (only if greenlit)

- **Day 1–2** — vault path handling over SMB + single-writer lockfile +
  tests (simulate a share locally).
- **Day 3** — GUI Settings support for a network vault path, reachability
  and drop handling.
- **Day 4** — assessment check: guided checklist + report line, or a
  targeted auto-check for their specific NAS.
- **Day 5** — end-to-end test over a real SMB share (ideally their NAS
  type), docs, ship a release.
