# Kovyr Vault

Data protection tooling for Kovyr assessments: find duplicate copies of
client data, remove the redundant ones, and encrypt what remains at rest.

Every extra copy of a sensitive file is another place it can leak from —
copies drift into Downloads folders, old exports, and forgotten backups.
Kovyr Vault shrinks that exposure surface, then locks down what's left.

## What it does

| Command | Purpose |
|---|---|
| `scan` | Find duplicate files by content hash (renamed copies are still caught). Reports duplicate groups and total excess exposure. `--json` for machine-readable output. |
| `dedupe` | Remove redundant copies. **Dry-run by default**; `--apply` to act, `--quarantine DIR` to move instead of delete, `--keep first\|oldest\|newest` to choose the survivor. |
| `init` | Create a new encrypted vault protected by a passphrase. |
| `protect` | Encrypt files into the vault. Identical content is stored once (dedup + encryption in one step). `--remove-originals` deletes the plaintext afterward. |
| `restore` | Decrypt files back out of the vault. |
| `list` | Show vault contents and how many unique encrypted blobs back them. |
| `verify` | Decrypt every entry and check it against its recorded hash — proof for the client that the data is intact. |
| `report` | Generate a branded, self-contained HTML engagement report from before/after scan data and vault stats (with a live integrity check). |
| `monitor` | Recurring scan that records a snapshot and reports drift — new duplicate content appearing since the last run. With `--vault PATH` it also counts failed unlock attempts and checks the vault's immutable blobs for tamper evidence (no passphrase needed), and a conservative canary flags the mass-change footprint of ransomware. Exit codes: 2 = alert (canary/failed unlocks), 1 = new drift, 0 = quiet. `--html` writes a branded monitoring report with an alert banner when attention is needed. |
| `gui` | Open the client-side desktop app (also shipped as its own windowed `kovyr-vault-app.exe`). |

## Typical engagement workflow

```bash
# 1. Assess: how much duplicated (over-exposed) data exists?
kovyr-vault scan "C:\ClientData" --json > assessment.json

# 2. Reduce: quarantine redundant copies (reversible, nothing deleted)
kovyr-vault dedupe "C:\ClientData" --apply --quarantine "C:\KovyrQuarantine"

# 3. Protect: encrypt the remaining data at rest
kovyr-vault init "C:\KovyrVault"
kovyr-vault protect "C:\KovyrVault" "C:\ClientData" --remove-originals

# 4. Prove: verify integrity and hand the client a branded report
kovyr-vault scan "C:\ClientData" --json > after.json
kovyr-vault report engagement-report.html --client "Acme Dental" \
    --before assessment.json --after after.json --vault "C:\KovyrVault"

# When the client needs a file back:
kovyr-vault restore "C:\KovyrVault" "C:\Restored" --name "C:\ClientData\report.pdf"
```

## Ongoing monitoring (the monthly-fee part)

`monitor` re-scans on a schedule, compares against the previous snapshot,
and flags *drift* — duplicate copies creeping back after a cleanup. It
exits with code 1 when new duplication appears, so a scheduled task can
alert on it, and `--html` produces a client-ready report with an
exposure-over-time history.

```bash
kovyr-vault monitor "C:\ClientData" --state "C:\Kovyr\state.json" \
    --html "C:\Kovyr\latest-report.html" --client "Acme Dental"
```

Schedule it weekly on the client's machine:

```powershell
# Windows Task Scheduler (run as the user who owns the data)
schtasks /Create /SC WEEKLY /D MON /ST 07:00 /TN "Kovyr Monitor" /TR ^
  "C:\Kovyr\kovyr-vault.exe monitor C:\ClientData --state C:\Kovyr\state.json --html C:\Kovyr\latest-report.html --client \"Acme Dental\""
```

```bash
# macOS / Linux cron
0 7 * * 1  kovyr-vault monitor /srv/clientdata --state /var/kovyr/state.json --html /var/kovyr/latest-report.html --client "Acme Dental"
```

## Client desktop app

`kovyr-vault-app.exe` stays on the client's machine so they can see
their protection without Kovyr present:

- **Protection status tab** — last check time, files watched, redundant
  copies, excess exposure, and a green ✓ / red ⚠ headline; buttons to
  run a check on demand and open the full HTML report.
- **My encrypted files tab** — the client enters *their* passphrase to
  unlock the vault, browse their encrypted files, and restore any of
  them to a folder of their choice. Locking clears the key from memory.

Setup during the engagement is one `config.json` next to the exe:

```json
{
  "client": "Acme Dental",
  "paths": ["C:\\ClientData"],
  "state": "C:\\Kovyr\\state.json",
  "html": "C:\\Kovyr\\latest-report.html",
  "vault": "C:\\KovyrVault"
}
```

## Standalone executables (Windows and macOS)

Clients don't need Python: the `Kovyr Vault build` GitHub Actions
workflow (Actions tab → run manually, or push a `kovyr-vault-v*` tag)
runs the test suite on both platforms and uploads two artifacts:

- **kovyr-vault-windows** — `kovyr-vault.exe` (CLI) and
  `kovyr-vault-app.exe` (client desktop app)
- **kovyr-vault-macos** — a zip containing the `kovyr-vault` CLI binary
  and the double-clickable `Kovyr Vault.app`

Binaries only run on the platform they were built for — hand Windows
clients the exes and Mac clients the zip.

### Installers (preferred for client machines)

Each artifact now also carries a proper installer:

- **KovyrVault.dmg** (macOS) — open it, drag Kovyr Vault into
  Applications. Done.
- **KovyrVaultSetup.exe** (Windows) — Next → Next → Finish, with an
  optional desktop icon. Installs to Program Files\Kovyr.

With an installer the app no longer sits next to its config: put
`config.json` in the per-user location instead —
`~/Library/Application Support/Kovyr/config.json` on macOS,
`%APPDATA%\Kovyr\config.json` on Windows. (A config beside the app
still wins if both exist, so old installs keep working.)

**macOS scheduling:** use the cron line above (`crontab -e`) or a
launchd agent.

### macOS code signing & notarization

The macOS job signs and notarizes automatically when five repository
secrets exist (Settings → Secrets and variables → Actions → New
repository secret). Without them it still builds, but unsigned —
Gatekeeper then requires right-click → Open on first launch.

| Secret | Value |
|---|---|
| `MACOS_CERT_P12` | Your **Developer ID Application** certificate exported as .p12, base64-encoded (`base64 -i cert.p12 \| pbcopy`) |
| `MACOS_CERT_PASSWORD` | The password you set when exporting the .p12 |
| `APPLE_ID` | The Apple ID email on the developer account |
| `APPLE_TEAM_ID` | 10-character Team ID (developer.apple.com → Membership) |
| `APPLE_APP_PASSWORD` | An app-specific password from appleid.apple.com → Sign-In and Security → App-Specific Passwords |

To get the certificate: developer.apple.com → Certificates → create a
**Developer ID Application** certificate (Keychain Access → Certificate
Assistant → Request a Certificate From a Certificate Authority to make
the CSR), download and open it into Keychain Access, then right-click
the certificate → Export → .p12 with a password.

With the secrets in place, builds come out signed with the hardened
runtime, notarized by Apple, and stapled — clients double-click and it
just opens.

## Security design

- **AES-256-GCM** authenticated encryption — tampering or corruption is
  detected on decrypt, never silently returned as garbage.
- **Passphrase-wrapped master key**: file content is encrypted under a
  random 256-bit master key, which is itself encrypted by a key derived
  from the passphrase with **scrypt** (memory-hard, resistant to GPU
  brute force). The passphrase never touches disk.
- **Fresh random nonce per encryption**; blob, index, and key-wrap each
  use distinct AAD context strings so ciphertexts can't be swapped
  between roles.
- **Encrypted index**: file names and paths are sensitive metadata, so
  the vault index is encrypted too. Only `vault.json` (KDF parameters
  and the wrapped key) is plaintext, and it contains no secrets.
- **Content-addressed storage**: blobs are keyed by the SHA-256 of their
  plaintext, so duplicate content is stored and encrypted exactly once.
- Built entirely on the audited [`cryptography`](https://cryptography.io)
  library — no hand-rolled primitives.

### Key custody: the client holds the key

Kovyr provides the tool; **the client owns the passphrase.** It is typed
at unlock time, held only in memory, and never written to disk by any
part of this software — and there is deliberately no recovery. A lost
passphrase means the vault contents are unrecoverable; a subpoenaed or
breached Kovyr has nothing to hand over. Have the client set the
passphrase themselves during the engagement and store it in *their*
password manager.

The scheduled `monitor` runs need no key at all — they only scan for
duplicates — so ongoing monitoring never requires the client to share
anything.

## Install & run

```bash
pip install ./kovyr-vault      # installs the `kovyr-vault` command
kovyr-vault --version
```

Requires Python 3.10+ and `cryptography`. Cross-platform (Windows,
macOS, Linux). Run the tests with `python -m pytest tests/`.

## Current limitations (v0.1)

- Files are encrypted in one pass in memory — fine for documents and
  typical business data; very large files (multi-GB video, disk images)
  should wait for streaming support.
- Vault passphrase change and blob garbage-collection (after deleting
  index entries) are not implemented yet.
