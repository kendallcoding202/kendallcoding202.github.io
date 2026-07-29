"""Command-line interface for Kovyr Vault."""

from __future__ import annotations

import argparse
import getpass
import json
import sys
from pathlib import Path

from . import __version__, crypto, dedupe as dedupe_mod, monitor as monitor_mod, report as report_mod, scanner
from .util import human_size, mirror_path, now_stamp
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


def _open_vault(path: Path, keyfile: str | None = None) -> Vault:
    kf = Path(keyfile) if keyfile else None
    if kf is None and Vault.requires_keyfile(path):
        sys.exit("error: this vault requires a keyfile — pass --keyfile PATH")
    try:
        return Vault.open(path, _prompt_passphrase(), keyfile=kf)
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


def cmd_keyfile(args: argparse.Namespace) -> int:
    from .vault import generate_keyfile
    try:
        path = generate_keyfile(Path(args.output))
    except VaultError as exc:
        sys.exit(f"error: {exc}")
    print(f"Keyfile written to {path}")
    print("This is the SECOND factor. Store it on a separate device "
          "(USB drive) and back it up — losing it locks the vault "
          "as surely as losing the passphrase.")
    return 0


def cmd_init(args: argparse.Namespace) -> int:
    keyfile = Path(args.keyfile) if args.keyfile else None
    try:
        Vault.create(Path(args.vault), _prompt_passphrase(confirm=True),
                     keyfile=keyfile)
    except VaultError as exc:
        sys.exit(f"error: {exc}")
    print(f"Vault created at {args.vault}")
    if keyfile:
        print(f"Two-factor: unlocking needs the passphrase AND {keyfile}.")
    print("Keep the passphrase safe — without it the data is unrecoverable.")
    return 0


def cmd_protect(args: argparse.Namespace) -> int:
    vault = _open_vault(Path(args.vault), args.keyfile)
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
    vault = _open_vault(Path(args.vault), args.keyfile)
    dest = Path(args.dest)
    entries = vault.list_files()
    if args.name:
        entries = {n: e for n, e in entries.items() if n == args.name}
        if not entries:
            sys.exit(f"error: no such file in vault: {args.name}")
    for name in entries:
        target = mirror_path(dest, name)
        vault.restore_file(name, target)
        print(f"Restored: {target}")
    print(f"\n{len(entries)} files restored to {dest}")
    return 0


def cmd_list(args: argparse.Namespace) -> int:
    vault = _open_vault(Path(args.vault), args.keyfile)
    entries = vault.list_files()
    total = sum(e.size for e in entries.values())
    for name, entry in sorted(entries.items()):
        print(f"{human_size(entry.size):>10}  {name}")
    print(f"\n{len(entries)} files ({human_size(total)}), "
          f"{vault.unique_blobs()} unique encrypted blobs")
    return 0


def cmd_backup(args: argparse.Namespace) -> int:
    from . import backup as backup_mod
    try:
        result = backup_mod.backup(Path(args.vault), Path(args.dest))
    except (FileNotFoundError, ValueError) as exc:
        sys.exit(f"error: {exc}")
    print(f"Backed up to {args.dest}: {result.copied} files copied "
          f"({human_size(result.bytes_copied)}), {result.skipped} already "
          f"current.")
    for err in result.errors:
        print(f"warning: {err}", file=sys.stderr)
    return 1 if result.errors else 0


def cmd_versions(args: argparse.Namespace) -> int:
    vault = _open_vault(Path(args.vault), args.keyfile)
    versions = vault.list_versions(args.name)
    if not versions:
        sys.exit(f"error: no such file in vault: {args.name}")
    for v in versions:
        when = "current" if v.ts == "current" else v.ts
        tag = " (deleted)" if v.deleted else ""
        current = "  <- current" if v.ts == "current" else ""
        print(f"{v.sha256[:12]}  {human_size(v.size):>10}  {when}{tag}"
              f"{current}")
    return 0


def cmd_restore_version(args: argparse.Namespace) -> int:
    vault = _open_vault(Path(args.vault), args.keyfile)
    try:
        vault.restore_version(args.name, args.sha256)
    except VaultError as exc:
        sys.exit(f"error: {exc}")
    print(f"Restored {args.name} to version {args.sha256[:12]}.")
    return 0


def cmd_purge(args: argparse.Namespace) -> int:
    vault = _open_vault(Path(args.vault), args.keyfile)
    if not args.yes:
        resp = input(f"Permanently delete retained versions older than "
                     f"{args.retention_days} days? This cannot be undone. "
                     f"[y/N] ")
        if resp.strip().lower() not in ("y", "yes"):
            print("Aborted.")
            return 0
    removed = vault.purge_versions(retention_days=args.retention_days)
    print(f"Purged {removed} aged-out blob(s).")
    return 0


def cmd_breach_scan(args: argparse.Namespace) -> int:
    import os
    from . import breach
    api_key = args.api_key or os.environ.get("KOVYR_HIBP_KEY")
    if not api_key:
        sys.exit("error: no HIBP API key — pass --api-key or set "
                 "KOVYR_HIBP_KEY. A key is required (haveibeenpwned.com/API).")
    emails = list(args.emails)
    if args.file:
        try:
            emails += [ln.strip() for ln in
                       Path(args.file).read_text().splitlines() if ln.strip()]
        except OSError as exc:
            sys.exit(f"error: cannot read {args.file}: {exc}")
    if not emails:
        sys.exit("error: give one or more emails, or --file")
    print(f"Checking {len(emails)} email(s) against Have I Been Pwned. "
          "Note: these addresses are sent to the HIBP service.")
    try:
        results = breach.scan(emails, api_key,
                              on_progress=lambda d, t: print(
                                  f"  {d}/{t}…", file=sys.stderr))
    except breach.BreachError as exc:
        sys.exit(f"error: {exc}")
    summary = breach.summarize(results)
    if args.json:
        print(json.dumps(summary, indent=2))
        return 1 if summary["exposed"] else 0
    for r in results:
        if r.error:
            print(f"  ?  {r.email}: {r.error}")
        elif r.exposed:
            print(f"  ⚠  {r.email}: found in {len(r.breaches)} "
                  f"breach(es) — {', '.join(r.breach_names[:6])}")
        else:
            print(f"  ✓  {r.email}: no known breaches")
    print(f"\n{summary['exposed']} exposed, {summary['clean']} clean, "
          f"{summary['errors']} error(s), of {summary['checked']} checked.")
    if args.html:
        Path(args.html).write_text(
            report_mod.render_breach_report(summary, args.client),
            encoding="utf-8")
        print(f"Report written to {args.html}")
    return 1 if summary["exposed"] else 0


def _slugify(text: str) -> str:
    keep = [c if c.isalnum() else "-" for c in (text or "client").lower()]
    slug = "".join(keep).strip("-")
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug or "client"


def cmd_packet(args: argparse.Namespace) -> int:
    """Generate an endpoint & encryption status report for one client into a
    dated local folder: what's encrypted at rest plus the machine's baseline
    device-security controls. This is NOT the WISP/HIPAA compliance packet —
    that is produced by the Kovyr platform. Never uploaded — confidential."""
    from . import audit, security_report

    month = args.month or now_stamp()[:7]
    folder = Path(args.output_dir) / f"{_slugify(args.client)}-{month}"
    folder.mkdir(parents=True, exist_ok=True)
    pieces = []

    # 1. Encryption & vault status (what's encrypted + integrity/retention).
    vault = _open_vault(Path(args.vault), args.keyfile)
    summary = security_report.summarize(Path(args.vault),
                                        since=args.since or month)
    sec_ctx = {
        "client": args.client, "prepared_by": args.prepared_by,
        "generated": now_stamp(), "version": __version__,
        "vault": {"files": len(vault.list_files()),
                  "total_bytes": sum(e.size
                                     for e in vault.list_files().values()),
                  "unique_blobs": vault.unique_blobs(),
                  "verify_problems": vault.verify()},
        "security": summary,
    }
    (folder / "encryption-status.html").write_text(
        report_mod.render_report(sec_ctx), encoding="utf-8")
    pieces.append(("Encryption &amp; vault status", "encryption-status.html"))
    audit.record(Path(args.vault), audit.EV_REPORT,
                 detail={"kind": "status-report", "month": month})

    # 2. Device security & monitoring report if provided (carries the
    #    baseline device-security checks captured on the client machine).
    if args.monitor_html and Path(args.monitor_html).exists():
        import shutil
        shutil.copy2(args.monitor_html, folder / "device-monitoring.html")
        pieces.append(("Device security &amp; monitoring",
                       "device-monitoring.html"))

    # 3. Cover index linking the pieces.
    (folder / "index.html").write_text(
        report_mod.render_packet_index(args.client, month, pieces,
                                       now_stamp(), __version__),
        encoding="utf-8")

    print(f"\nEndpoint & encryption status report written to {folder}")
    print("Confidential — deliver privately. This is not the WISP/HIPAA "
          "compliance packet; that comes from the Kovyr platform.")
    return 0


def cmd_security_report(args: argparse.Namespace) -> int:
    from . import audit, security_report
    vault = _open_vault(Path(args.vault), args.keyfile)
    summary = security_report.summarize(Path(args.vault), since=args.since)
    ctx = {
        "client": args.client,
        "prepared_by": args.prepared_by,
        "generated": now_stamp(),
        "version": __version__,
        "vault": {
            "files": len(vault.list_files()),
            "total_bytes": sum(e.size for e in vault.list_files().values()),
            "unique_blobs": vault.unique_blobs(),
            "verify_problems": vault.verify(),
        },
        "security": summary,
    }
    Path(args.output).write_text(report_mod.render_report(ctx),
                                 encoding="utf-8")
    audit.record(Path(args.vault), audit.EV_REPORT,
                 detail={"kind": "security", "since": args.since or "all"})
    print(f"Security report written to {args.output}")
    if not summary["log_verified"]:
        print("WARNING: audit log integrity check FAILED.", file=sys.stderr)
        return 1
    return 0


def cmd_verify_log(args: argparse.Namespace) -> int:
    from . import audit
    result = audit.verify_log(Path(args.vault))
    if result["ok"]:
        print(f"Audit log verified intact — {result['entries']} entries, "
              f"chain unbroken.")
        return 0
    print(f"AUDIT LOG TAMPERING DETECTED at entry #{result['broken_seq']}: "
          f"{result['reason']}", file=sys.stderr)
    print(f"({result['entries']} entries scanned.)", file=sys.stderr)
    return 1


def cmd_disk_check(args: argparse.Namespace) -> int:
    """Report whole-disk encryption (FileVault/BitLocker) on this machine.
    Read-only. Run it on the client's machine to capture the answer to the
    assessment's 'is data encrypted at rest?' at the device level."""
    from . import diskcrypto
    status = diskcrypto.check()
    if args.json:
        print(json.dumps(status.as_dict(), indent=2))
    else:
        mark = {True: "ON ", False: "OFF", None: "???"}[status.encrypted]
        print(f"[{mark}] {status.feature}: {status.detail}")
    # Exit non-zero only when we positively determined it is OFF, so this
    # can gate scripts; "unknown" stays 0 (nothing to assert).
    return 1 if status.encrypted is False else 0


def cmd_device_check(args: argparse.Namespace) -> int:
    """Report the baseline device-security controls on this machine — disk
    encryption, firewall, automatic screen lock, and (Windows) antivirus.
    Read-only. Run it on the client's machine. Exits non-zero if any check
    is positively OFF."""
    from . import posture
    checks = posture.check_all()
    if args.json:
        print(json.dumps([c.as_dict() for c in checks], indent=2))
    else:
        mark = {True: "ON ", False: "OFF", None: "???"}
        for c in checks:
            print(f"[{mark[c.status]}] {c.name}: {c.detail}")
    return 1 if any(c.status is False for c in checks) else 0


def cmd_verify(args: argparse.Namespace) -> int:
    vault = _open_vault(Path(args.vault), args.keyfile)
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


def cmd_report(args: argparse.Namespace) -> int:
    ctx: dict = {
        "client": args.client,
        "prepared_by": args.prepared_by,
        "generated": now_stamp(),
        "version": __version__,
        "before": _load_scan_json(args.before) if args.before else None,
        "after": _load_scan_json(args.after) if args.after else None,
    }
    if not (ctx["before"] or ctx["after"] or args.vault):
        sys.exit("error: nothing to report — give --before/--after scan "
                 "JSON and/or --vault")
    if args.vault:
        vault = _open_vault(Path(args.vault), args.keyfile)
        entries = vault.list_files()
        print("Verifying vault integrity…")
        problems = vault.verify()
        ctx["vault"] = {
            "files": len(entries),
            "total_bytes": sum(e.size for e in entries.values()),
            "unique_blobs": vault.unique_blobs(),
            "verify_problems": problems,
        }
        from . import audit, security_report
        ctx["security"] = security_report.summarize(Path(args.vault))
        audit.record(Path(args.vault), audit.EV_REPORT,
                     detail={"kind": "engagement"})
    out = Path(args.output)
    out.write_text(report_mod.render_report(ctx), encoding="utf-8")
    print(f"Report written to {out}")
    return 0


def cmd_monitor(args: argparse.Namespace) -> int:
    from . import posture as posture_mod
    cache = monitor_mod.load_hash_cache(Path(args.state))
    result = scanner.scan([Path(p) for p in args.paths], cache=cache)
    # Runs on the client machine, so this is the right place to capture the
    # device's baseline security controls for the report/packet.
    device_posture = [c.as_dict() for c in posture_mod.check_all()]
    snapshot, drift, history = monitor_mod.record_run(
        Path(args.state), result, now_stamp(),
        vault=Path(args.vault) if args.vault else None,
        protected=[Path(p) for p in args.protected] or None,
        hash_cache=cache, posture=device_posture,
    )
    if snapshot.get("awaiting_encryption"):
        print(f"ALERT: {snapshot['awaiting_encryption']} files in "
              f"protected folders are not encrypted yet.")
    print(f"Scanned {snapshot['files_scanned']} files: "
          f"{snapshot['duplicate_files']} redundant copies, "
          f"{human_size(snapshot['wasted_bytes'])} excess exposure.")
    for alert in snapshot.get("canary_alerts", []):
        print(f"ALERT: {alert}")
    if snapshot.get("new_failed_unlocks"):
        print(f"ALERT: {snapshot['new_failed_unlocks']} failed vault "
              f"unlock attempts since last check.")
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
            "generated": now_stamp(),
            "version": __version__,
            "history": history,
            "new_groups": drift.new_groups,
            "resolved_groups": drift.resolved_groups,
            "posture": device_posture,
        }
        Path(args.html).write_text(
            report_mod.render_monitor_report(ctx), encoding="utf-8"
        )
        print(f"Monitoring report written to {args.html}")
    for err in result.errors:
        print(f"warning: {err}", file=sys.stderr)
    if not args.no_notify:
        from . import notify as notify_mod
        alert = notify_mod.compose_alert(snapshot, len(drift.new_groups))
        if alert:
            notify_mod.send(alert)
    # Exit codes for schedulers/scripts: 2 = canary alert (mass change /
    # vault tamper / failed unlocks), 1 = new duplication drift, 0 = quiet.
    if snapshot.get("canary_alerts") or snapshot.get("new_failed_unlocks"):
        return 2
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

    p = sub.add_parser("keyfile", help="generate a keyfile (optional "
                                       "second unlock factor)")
    p.add_argument("output", help="path to write the new keyfile to "
                                  "(e.g. a USB drive)")
    p.set_defaults(func=cmd_keyfile)

    p = sub.add_parser("init", help="create a new encrypted vault")
    p.add_argument("vault", help="directory for the new vault")
    p.add_argument("--keyfile", help="require this keyfile as a second "
                                     "factor to unlock the vault")
    p.set_defaults(func=cmd_init)

    p = sub.add_parser("protect", help="encrypt files into the vault "
                                       "(deduplicates automatically)")
    p.add_argument("vault")
    p.add_argument("paths", nargs="+")
    p.add_argument("--remove-originals", action="store_true",
                   help="delete plaintext originals after encrypting")
    p.add_argument("--keyfile", help="keyfile for a two-factor vault")
    p.set_defaults(func=cmd_protect)

    p = sub.add_parser("restore", help="decrypt files out of the vault")
    p.add_argument("vault")
    p.add_argument("dest", help="directory to restore into")
    p.add_argument("--name", help="restore a single file by its vault name")
    p.add_argument("--keyfile", help="keyfile for a two-factor vault")
    p.set_defaults(func=cmd_restore)

    p = sub.add_parser("list", help="list vault contents")
    p.add_argument("vault")
    p.add_argument("--keyfile", help="keyfile for a two-factor vault")
    p.set_defaults(func=cmd_list)

    p = sub.add_parser("verify", help="check every vault entry decrypts "
                                      "and matches its hash")
    p.add_argument("vault")
    p.add_argument("--keyfile", help="keyfile for a two-factor vault")
    p.set_defaults(func=cmd_verify)

    p = sub.add_parser("backup", help="incrementally copy the encrypted "
                                      "vault to another location")
    p.add_argument("vault")
    p.add_argument("dest", help="backup destination (USB drive, etc.)")
    p.set_defaults(func=cmd_backup)

    p = sub.add_parser("verify-log", help="check the audit log's tamper-"
                                          "evidence hash chain")
    p.add_argument("vault")
    p.set_defaults(func=cmd_verify_log)

    p = sub.add_parser("disk-check", help="report whole-disk encryption "
                                          "(FileVault/BitLocker) on this "
                                          "machine")
    p.add_argument("--json", action="store_true",
                   help="emit machine-readable JSON")
    p.set_defaults(func=cmd_disk_check)

    p = sub.add_parser("device-check", help="report baseline device "
                                            "security (encryption, firewall, "
                                            "screen lock, antivirus)")
    p.add_argument("--json", action="store_true",
                   help="emit machine-readable JSON")
    p.set_defaults(func=cmd_device_check)

    p = sub.add_parser("packet", help="generate an endpoint & encryption "
                                      "status report (encryption + device "
                                      "security) into a dated local folder")
    p.add_argument("vault")
    p.add_argument("output_dir", help="where the dated report folder goes")
    p.add_argument("--client", required=True)
    p.add_argument("--month", help="YYYY-MM label (default: current month)")
    p.add_argument("--since", help="ISO date prefix for activity window")
    p.add_argument("--prepared-by")
    p.add_argument("--monitor-html", help="path to the client's latest "
                                          "device & monitoring report to include")
    p.add_argument("--keyfile", help="keyfile for a two-factor vault")
    p.set_defaults(func=cmd_packet)

    p = sub.add_parser("breach-scan", help="check client emails against "
                                           "Have I Been Pwned (sends the "
                                           "addresses to HIBP)")
    p.add_argument("emails", nargs="*", help="email addresses to check")
    p.add_argument("--file", help="text file of emails, one per line")
    p.add_argument("--api-key", help="HIBP API key (or set KOVYR_HIBP_KEY)")
    p.add_argument("--client", help="client name for the HTML report")
    p.add_argument("--html", metavar="OUT", help="write an HTML report")
    p.add_argument("--json", action="store_true",
                   help="emit a machine-readable summary")
    p.set_defaults(func=cmd_breach_scan)

    p = sub.add_parser("security-report", help="client-facing HTML security "
                                              "report (access activity, "
                                              "log verification, retention)")
    p.add_argument("vault")
    p.add_argument("output", help="path for the HTML report")
    p.add_argument("--client", help="client name shown on the report")
    p.add_argument("--prepared-by", help="assessor name for the footer")
    p.add_argument("--since", help="ISO date prefix to filter activity, "
                                   "e.g. 2026-07 for a monthly report")
    p.add_argument("--keyfile", help="keyfile for a two-factor vault")
    p.set_defaults(func=cmd_security_report)

    p = sub.add_parser("versions", help="list retained versions of a file")
    p.add_argument("vault")
    p.add_argument("name", help="the file's vault name")
    p.add_argument("--keyfile", help="keyfile for a two-factor vault")
    p.set_defaults(func=cmd_versions)

    p = sub.add_parser("restore-version", help="make a retained version "
                                              "current again")
    p.add_argument("vault")
    p.add_argument("name")
    p.add_argument("sha256", help="version hash (from 'versions')")
    p.add_argument("--keyfile", help="keyfile for a two-factor vault")
    p.set_defaults(func=cmd_restore_version)

    p = sub.add_parser("purge", help="permanently delete retained versions "
                                     "older than the retention window")
    p.add_argument("vault")
    p.add_argument("--retention-days", type=int, default=30)
    p.add_argument("--yes", action="store_true",
                   help="skip the confirmation prompt")
    p.add_argument("--keyfile", help="keyfile for a two-factor vault")
    p.set_defaults(func=cmd_purge)

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
    p.add_argument("--keyfile", help="keyfile for a two-factor vault")
    p.set_defaults(func=cmd_report)

    p = sub.add_parser("monitor", help="recurring scan: record a snapshot "
                                       "and report drift since last run")
    p.add_argument("paths", nargs="+")
    p.add_argument("--state", required=True, metavar="JSON",
                   help="state file that accumulates snapshot history")
    p.add_argument("--html", metavar="OUT",
                   help="also write a branded monitoring report")
    p.add_argument("--client", help="client name for the HTML report")
    p.add_argument("--vault", metavar="PATH",
                   help="also watch this vault: failed unlock attempts "
                        "and tamper evidence on its encrypted blobs "
                        "(no passphrase needed)")
    p.add_argument("--protected", metavar="PATH", action="append",
                   default=[],
                   help="protected folder to check for files awaiting "
                        "encryption (repeatable)")
    p.add_argument("--no-notify", action="store_true",
                   help="suppress the desktop notification on alerts")
    p.set_defaults(func=cmd_monitor)

    p = sub.add_parser("gui", help="open the client-side desktop app")
    p.add_argument("--config", help="path to config.json (default: next "
                                    "to the executable)")
    p.add_argument("--selftest", action="store_true",
                   help=argparse.SUPPRESS)
    p.set_defaults(func=cmd_gui)

    return parser


def cmd_gui(args: argparse.Namespace) -> int:
    from .gui import run_app  # deferred: tkinter may be absent on servers
    return run_app(Path(args.config) if args.config else None,
                   selftest=args.selftest)


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
