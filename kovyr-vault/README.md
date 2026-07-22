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

## Typical engagement workflow

```bash
# 1. Assess: how much duplicated (over-exposed) data exists?
kovyr-vault scan "C:\ClientData" --json > assessment.json

# 2. Reduce: quarantine redundant copies (reversible, nothing deleted)
kovyr-vault dedupe "C:\ClientData" --apply --quarantine "C:\KovyrQuarantine"

# 3. Protect: encrypt the remaining data at rest
kovyr-vault init "C:\KovyrVault"
kovyr-vault protect "C:\KovyrVault" "C:\ClientData" --remove-originals

# 4. Prove: integrity check, before/after report
kovyr-vault verify "C:\KovyrVault"

# When the client needs a file back:
kovyr-vault restore "C:\KovyrVault" "C:\Restored" --name "C:\ClientData\report.pdf"
```

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

**Important:** there is no passphrase recovery. A lost passphrase means
the vault contents are unrecoverable — that's the point. Record the
passphrase in a password manager as part of the engagement.

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
