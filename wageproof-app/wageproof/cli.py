"""Command line interface.

    wageproof check week-12.json
    wageproof form week-12.json --out payroll-12.txt
    wageproof import timesheet.csv --project project.json --week-ending 2026-03-08
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .compliance import ComplianceResult, Severity, check_week
from .forms import build_payload, render_text
from .importers import ImportError_, load_week_file, parse_date, week_from_csv
from .models import ZERO, PayrollWeek

_MARKS = {Severity.BLOCKER: "BLOCKER", Severity.WARNING: "WARNING", Severity.NOTICE: "note"}


def _render_result(result: ComplianceResult, verbose: bool) -> str:
    week = result.week
    out: list[str] = []
    add = out.append

    total_hours = sum((c.total_hours for c in result.computations.values()), ZERO)
    add(
        f"{week.project.name} — payroll {week.payroll_number or '—'}, "
        f"week ending {week.week_ending:%b %d, %Y}"
    )
    add(f"{len(week.workers)} worker(s), {total_hours:g} hours")
    add("")

    findings = result.sorted_findings
    if not findings:
        add("No issues found. This payroll is ready to file.")
        return "\n".join(out)

    for finding in findings:
        if finding.severity is Severity.NOTICE and not verbose:
            continue
        add(f"[{_MARKS[finding.severity]}] {finding.title}")
        add(f"    {finding.detail}")
        add(f"    → {finding.action}")
        if finding.citation:
            add(f"    ({finding.citation})")
        if finding.amount_at_risk:
            add(f"    Back wages owed: ${finding.amount_at_risk}")
        add("")

    blockers = len(result.blockers)
    warnings = len(result.warnings)
    add("-" * 72)
    if result.total_at_risk > ZERO:
        add(f"Total back wages owed before this can be filed: ${result.total_at_risk}")
    if blockers:
        add(
            f"{blockers} blocker(s) and {warnings} warning(s). "
            "Do not file until the blockers are fixed."
        )
    else:
        add(f"No blockers. {warnings} warning(s) worth a look, but this can be filed.")
    return "\n".join(out)


def _load(path: str) -> PayrollWeek:
    try:
        return load_week_file(path)
    except (ImportError_, json.JSONDecodeError, OSError) as exc:
        raise SystemExit(f"Could not read {path}: {exc}") from exc


def cmd_check(args: argparse.Namespace) -> int:
    week = _load(args.week)
    result = check_week(week)
    if args.json:
        payload = {
            "filable": result.is_filable,
            "total_at_risk": str(result.total_at_risk),
            "findings": [
                {
                    "rule_id": f.rule_id,
                    "severity": f.severity.value,
                    "title": f.title,
                    "detail": f.detail,
                    "action": f.action,
                    "citation": f.citation,
                    "worker": f.worker_name,
                    "amount_at_risk": str(f.amount_at_risk) if f.amount_at_risk else None,
                }
                for f in result.sorted_findings
            ],
        }
        print(json.dumps(payload, indent=2))
    else:
        print(_render_result(result, verbose=args.verbose))
    return 1 if result.blockers else 0


def cmd_form(args: argparse.Namespace) -> int:
    week = _load(args.week)
    result = check_week(week)
    if result.blockers and not args.force:
        print(_render_result(result, verbose=False), file=sys.stderr)
        print(
            "\nRefusing to generate the form: the statement of compliance would not be true.\n"
            "Fix the blockers, or pass --force if you know better.",
            file=sys.stderr,
        )
        return 1

    if args.json:
        output = json.dumps(build_payload(week), indent=2)
    else:
        output = render_text(week, args.remarks)
    if args.out:
        Path(args.out).write_text(output)
        print(f"Wrote {args.out}")
    else:
        print(output)
    return 0


def cmd_import(args: argparse.Namespace) -> int:
    week_ending = parse_date(args.week_ending)
    if week_ending is None:
        raise SystemExit(f"Could not read --week-ending {args.week_ending!r}. Try YYYY-MM-DD.")

    try:
        config = json.loads(Path(args.project).read_text())
    except (json.JSONDecodeError, OSError) as exc:
        raise SystemExit(f"Could not read {args.project}: {exc}") from exc

    try:
        week = week_from_csv(
            Path(args.csv).read_text(),
            week_ending=week_ending,
            project=config.get("project", config),
            contractor=config.get("contractor"),
            payroll_number=args.payroll_number,
            pay_date=args.pay_date,
        )
    except (ImportError_, OSError) as exc:
        raise SystemExit(f"Could not import {args.csv}: {exc}") from exc

    payload = {
        "week_ending": week.week_ending.isoformat(),
        "payroll_number": week.payroll_number,
        "pay_date": week.pay_date.isoformat() if week.pay_date else None,
        "project": config.get("project", config),
        "contractor": config.get("contractor", {}),
        "workers": [
            {
                "name": w.name,
                "identifier": w.identifier,
                "classification": w.classification,
                "cash_hourly_rate": str(w.cash_hourly_rate),
                "cash_fringe_in_lieu": str(w.cash_fringe_in_lieu),
                "worker_type": w.worker_type.value,
                "other_project_hours": str(w.other_project_hours),
                "daily_hours": {d.isoformat(): str(h) for d, h in sorted(w.daily_hours.items())},
            }
            for w in week.workers
        ],
    }
    output = json.dumps(payload, indent=2)
    if args.out:
        Path(args.out).write_text(output)
        print(
            f"Wrote {args.out} — {len(week.workers)} worker(s). "
            "Edit it to add fringes and deductions."
        )
    else:
        print(output)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="wageproof",
        description="Check a Davis-Bacon certified payroll before you file it.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    check = sub.add_parser("check", help="run the compliance checks against a payroll week")
    check.add_argument("week", help="path to a payroll week JSON file")
    check.add_argument("--json", action="store_true", help="machine-readable output")
    check.add_argument("-v", "--verbose", action="store_true", help="include informational notices")
    check.set_defaults(func=cmd_check)

    form = sub.add_parser("form", help="generate the WH-347 payroll and statement of compliance")
    form.add_argument("week", help="path to a payroll week JSON file")
    form.add_argument("--out", help="write to a file instead of stdout")
    form.add_argument("--json", action="store_true", help="structured payload instead of text")
    form.add_argument("--remarks", default="", help="remarks for the statement of compliance")
    form.add_argument("--force", action="store_true", help="generate even with blocking findings")
    form.set_defaults(func=cmd_form)

    imp = sub.add_parser("import", help="convert a time sheet CSV into a payroll week")
    imp.add_argument("csv", help="path to the time sheet CSV")
    imp.add_argument("--project", required=True, help="JSON file holding project and contractor")
    imp.add_argument("--week-ending", required=True, help="week ending date, e.g. 2026-03-08")
    imp.add_argument("--payroll-number", help="sequential payroll number for this contract")
    imp.add_argument("--pay-date", help="date wages were actually paid")
    imp.add_argument("--out", help="write to a file instead of stdout")
    imp.set_defaults(func=cmd_import)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
