"""Command-line interface for Kovyr Vault."""

from __future__ import annotations

import argparse
import getpass
import json
import sys
from pathlib import Path

from . import __version__, crypto, dedupe as dedupe_mod, scanner
from .vault import Vault, VaultError


def human_size(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024 or unit == "TB":
            return f"{n:.1f} {unit}" if unit != "B" else f"{int(n)} B"
        n /= 1024
    return f"{n:.1f} TB"


def _prompt_passphrase(confirm: bool = False) -> str:
    phrase = getpass.getpass("Vault passphrase: ")
    if not phrase:
        sys.exit("error: passphrase must not be empty")
    if confirm:
        again = getpass.getpass("Confirm passphrase: ")
        if phrase != again:
            sys.exit("error: passphrases do not match")
    return phrase


def _open_vault(path: Path) -> Vault:
    try:
        return Vault.open(path, _prompt_passphrase())
    except (VaultError, crypto.WrongPassphrase) as exc:
        sys.exit(f"error: {exc}")


# ---------- commands ----------

def cmd_scan(args: argparse.Namespace) -> int:
    result = scanner.scan([Path(p) for p in args.paths])
    if args.json:
        payload = {
            "files_scanned": result.files_scanned,
            "bytes_scanned": result.bytes_scanned,
            "duplicate_files": result.duplicate_files,
            "wasted_bytes": result.wasted_bytes,
            "groups": [
                {
                    "sha256": g.sha256,
                    "size": g.size,
                    "paths": [str(p) for p in g.paths],
                }
                for g in result.groups
            ],
            "errors": result.errors,
        }
        print(json.dumps(payload, indent=2))
        return 0

    print(f"Scanned {result.files_scanned} files "
          f"({human_size(result.bytes_scanned)})")
    if not result.groups:
        print("No duplicates found.")
    for g in result.groups:
        print(f"\n{len(g.paths)} copies of {human_size(g.size)} "
              f"[{g.sha256[:12]}…]")
        for p in g.paths:
            print(f"  {p}")
    print(f"\nRedundant copies: {result.duplicate_files}  "
          f"Recoverable space / excess exposure: "
          f"{human_size(result.wasted_bytes)}")
    for err in result.errors:
        print(f"warning: {err}", file=sys.stderr)
    return 0


def cmd_dedupe(args: argparse.Namespace) -> int:
    result = scanner.scan([Path(p) for p in args.paths])
    if not result.groups:
        print("No duplicates found — nothing to do.")
        return 0
    quarantine = Path(args.quarantine) if args.quarantine else None
    outcome = dedupe_mod.dedupe(
        result.groups, apply=args.apply, keep=args.keep,
        quarantine=quarantine,
    )
    verb = "Removed" if args.apply else "Would remove"
    if args.apply and quarantine:
        verb = "Quarantined"
    for path in outcome.removed:
        print(f"{verb}: {path}")
    print(f"\n{verb} {len(outcome.removed)} redundant copies, "
          f"{human_size(outcome.bytes_reclaimed)} reclaimed.")
    if not args.apply:
        print("Dry run — re-run with --apply to make changes "
              "(add --quarantine DIR to move instead of delete).")
    for err in outcome.errors:
        print(f"warning: {err}", file=sys.stderr)
    return 1 if outcome.errors else 0


def cmd_init(args: argparse.Namespace) -> int:
    try:
        Vault.create(Path(args.vault), _prompt_passphrase(confirm=True))
    except VaultError as exc:
        sys.exit(f"error: {exc}")
    print(f"Vault created at {args.vault}")
    print("Keep the passphrase safe — without it the data is unrecoverable.")
    return 0


def cmd_protect(args: argparse.Namespace) -> int:
    vault = _open_vault(Path(args.vault))
    files = scanner.iter_files([Path(p) for p in args.paths])
    vault_root = vault.root
    stored = deduped = 0
    bytes_in = 0
    for path in files:
        if vault_root in path.parents:
            continue  # never ingest the vault into itself
        name = str(path)
        _entry, was_stored = vault.add_file(path, name)
        bytes_in += path.stat().st_size
        if was_stored:
            stored += 1
        else:
            deduped += 1
        if args.remove_originals:
            path.unlink()
    print(f"Protected {stored + deduped} files "
          f"({human_size(bytes_in)}): {stored} new, "
          f"{deduped} deduplicated against existing content.")
    if args.remove_originals:
        print("Originals removed — plaintext no longer at rest.")
    return 0


def cmd_restore(args: argparse.Namespace) -> int:
    vault = _open_vault(Path(args.vault))
    dest = Path(args.dest)
    entries = vault.list_files()
    if args.name:
        entries = {n: e for n, e in entries.items() if n == args.name}
        if not entries:
            sys.exit(f"error: no such file in vault: {args.name}")
    for name in entries:
        # Rebuild the original absolute path underneath dest.
        parts = [p.replace(":", "") for p in Path(name).parts
                 if p not in ("/", "\\")]
        target = dest.joinpath(*parts)
        vault.restore_file(name, target)
        print(f"Restored: {target}")
    print(f"\n{len(entries)} files restored to {dest}")
    return 0


def cmd_list(args: argparse.Namespace) -> int:
    vault = _open_vault(Path(args.vault))
    entries = vault.list_files()
    total = sum(e.size for e in entries.values())
    for name, entry in sorted(entries.items()):
        print(f"{human_size(entry.size):>10}  {name}")
    print(f"\n{len(entries)} files ({human_size(total)}), "
          f"{vault.unique_blobs()} unique encrypted blobs")
    return 0


def cmd_verify(args: argparse.Namespace) -> int:
    vault = _open_vault(Path(args.vault))
    problems = vault.verify()
    count = len(vault.list_files())
    if problems:
        for p in problems:
            print(f"FAIL: {p}", file=sys.stderr)
        print(f"{len(problems)} of {count} files failed verification.")
        return 1
    print(f"All {count} files decrypted and verified against their hashes.")
    return 0


# ---------- parser ----------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="kovyr-vault",
        description="Kovyr Vault — find duplicate data, remove it, and "
                    "encrypt what remains at rest.",
    )
    parser.add_argument("--version", action="version",
                        version=f"%(prog)s {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("scan", help="find duplicate files by content hash")
    p.add_argument("paths", nargs="+", help="files or directories to scan")
    p.add_argument("--json", action="store_true",
                   help="emit a machine-readable report")
    p.set_defaults(func=cmd_scan)

    p = sub.add_parser("dedupe", help="remove redundant copies (dry-run "
                                      "unless --apply)")
    p.add_argument("paths", nargs="+")
    p.add_argument("--apply", action="store_true",
                   help="actually remove files (default is dry run)")
    p.add_argument("--keep", choices=dedupe_mod.KEEP_POLICIES,
                   default="first", help="which copy to keep")
    p.add_argument("--quarantine", metavar="DIR",
                   help="move removed copies here instead of deleting")
    p.set_defaults(func=cmd_dedupe)

    p = sub.add_parser("init", help="create a new encrypted vault")
    p.add_argument("vault", help="directory for the new vault")
    p.set_defaults(func=cmd_init)

    p = sub.add_parser("protect", help="encrypt files into the vault "
                                       "(deduplicates automatically)")
    p.add_argument("vault")
    p.add_argument("paths", nargs="+")
    p.add_argument("--remove-originals", action="store_true",
                   help="delete plaintext originals after encrypting")
    p.set_defaults(func=cmd_protect)

    p = sub.add_parser("restore", help="decrypt files out of the vault")
    p.add_argument("vault")
    p.add_argument("dest", help="directory to restore into")
    p.add_argument("--name", help="restore a single file by its vault name")
    p.set_defaults(func=cmd_restore)

    p = sub.add_parser("list", help="list vault contents")
    p.add_argument("vault")
    p.set_defaults(func=cmd_list)

    p = sub.add_parser("verify", help="check every vault entry decrypts "
                                      "and matches its hash")
    p.add_argument("vault")
    p.set_defaults(func=cmd_verify)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
