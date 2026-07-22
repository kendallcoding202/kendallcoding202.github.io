"""Command-line interface for Kovyr Vault."""

from __future__ import annotations

import argparse
import getpass
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from . import __version__, crypto, dedupe as dedupe_mod, monitor as monitor_mod, report as report_mod, scanner
from .util import human_size
from .vault import Vault, VaultError


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


def _load_scan_json(path: str) -> dict:
    try:
        data = json.loads(Path(path).read_text())
    except (OSError, json.JSONDecodeError) as exc:
        sys.exit(f"error: cannot read scan data from {path}: {exc}")
    for key in ("files_scanned", "bytes_scanned", "duplicate_files",
                "wasted_bytes", "groups"):
        if key not in data:
            sys.exit(f"error: {path} is not output from 'scan --json' "
                     f"(missing {key!r})")
    return data


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def cmd_report(args: argparse.Namespace) -> int:
    ctx: dict = {
        "client": args.client,
        "prepared_by": args.prepared_by,
        "generated": _now(),
        "version": __version__,
        "before": _load_scan_json(args.before) if args.before else None,
        "after": _load_scan_json(args.after) if args.after else None,
    }
    if not (ctx["before"] or ctx["after"] or args.vault):
        sys.exit("error: nothing to report — give --before/--after scan "
                 "JSON and/or --vault")
    if args.vault:
        vault = _open_vault(Path(args.vault))
        entries = vault.list_files()
        print("Verifying vault integrity…")
        problems = vault.verify()
        ctx["vault"] = {
            "files": len(entries),
            "total_bytes": sum(e.size for e in entries.values()),
            "unique_blobs": vault.unique_blobs(),
            "verify_problems": problems,
        }
    out = Path(args.output)
    out.write_text(report_mod.render_report(ctx), encoding="utf-8")
    print(f"Report written to {out}")
    return 0


def cmd_monitor(args: argparse.Namespace) -> int:
    result = scanner.scan([Path(p) for p in args.paths])
    snapshot, drift, history = monitor_mod.record_run(
        Path(args.state), result, _now()
    )
    print(f"Scanned {snapshot['files_scanned']} files: "
          f"{snapshot['duplicate_files']} redundant copies, "
          f"{human_size(snapshot['wasted_bytes'])} excess exposure.")
    if len(history) == 1:
        print("Baseline recorded — future runs will report drift "
              "against it.")
    else:
        if drift.new_groups:
            print(f"NEW since last run: {len(drift.new_groups)} "
                  f"duplicate groups appeared:")
            for g in drift.new_groups:
                print(f"  {g['count']} copies of "
                      f"{human_size(g['size'])}:")
                for p in g["paths"]:
                    print(f"    {p}")
        if drift.resolved_groups:
            print(f"Resolved since last run: "
                  f"{len(drift.resolved_groups)} groups cleaned up.")
        if not drift.new_groups and not drift.resolved_groups:
            print("No duplication drift since last run.")
    if args.html:
        ctx = {
            "client": args.client,
            "generated": _now(),
            "version": __version__,
            "history": history,
            "new_groups": drift.new_groups,
            "resolved_groups": drift.resolved_groups,
        }
        Path(args.html).write_text(
            report_mod.render_monitor_report(ctx), encoding="utf-8"
        )
        print(f"Monitoring report written to {args.html}")
    for err in result.errors:
        print(f"warning: {err}", file=sys.stderr)
    # Non-zero exit signals new drift, so schedulers/scripts can alert.
    return 1 if drift.has_new else 0


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

    p = sub.add_parser("report", help="generate a branded HTML engagement "
                                      "report")
    p.add_argument("output", help="path for the HTML report")
    p.add_argument("--client", help="client name shown on the report")
    p.add_argument("--prepared-by", help="assessor name for the footer")
    p.add_argument("--before", metavar="JSON",
                   help="'scan --json' output from before remediation")
    p.add_argument("--after", metavar="JSON",
                   help="'scan --json' output from after remediation")
    p.add_argument("--vault", help="include vault stats + integrity check "
                                   "(prompts for passphrase)")
    p.set_defaults(func=cmd_report)

    p = sub.add_parser("monitor", help="recurring scan: record a snapshot "
                                       "and report drift since last run")
    p.add_argument("paths", nargs="+")
    p.add_argument("--state", required=True, metavar="JSON",
                   help="state file that accumulates snapshot history")
    p.add_argument("--html", metavar="OUT",
                   help="also write a branded monitoring report")
    p.add_argument("--client", help="client name for the HTML report")
    p.set_defaults(func=cmd_monitor)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
