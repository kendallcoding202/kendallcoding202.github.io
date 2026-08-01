# WageProof

Check a Davis-Bacon certified payroll **before** you file it.

Every contractor and subcontractor on a federally funded job has to submit a
weekly certified payroll — Form WH-347 — within seven days of each pay date.
Page two is a statement of compliance signed under penalty of prosecution. Get a
rate wrong and you are not late, you are certifying something untrue.

Small subs do this in a spreadsheet, weekly, forever. WageProof reads the same
data and tells them what is wrong while it can still be fixed.

## What it catches

| Rule | What it means |
|---|---|
| `WAGE_BASE_UNDERPAID` | Cash rate below the determination's basic hourly rate. Fringe contributions cannot make up the difference. |
| `WAGE_FRINGE_SHORTFALL` | Fringe not fully satisfied by bona fide plans plus cash in lieu. |
| `WAGE_OVERTIME_SHORT` | Hours past 40 in the week paid at less than 1.5× the base rate. |
| `WAGE_FRINGE_IN_OT_BASE` | The hourly rate looks like base and fringe combined — which means the fringe column is wrong and the overtime premium is computed on too much. |
| `CLASS_NOT_ON_DETERMINATION` | A classification with no published rate. Suggests near matches. |
| `WD_MISSING` | No wage determination attached, so nothing can be verified. |
| `APPRENTICE_NOT_REGISTERED` | Apprentice rate paid without an approved program registration. |
| `APPRENTICE_RATIO_EXCEEDED` | More apprentice hours than the determination's ratio allows. |
| `DEDUCT_NOT_PERMITTED` | A deduction outside 29 CFR 3.5 — the worker did not receive the prevailing wage. |
| `DEDUCT_NO_WRITTEN_CONSENT` | A deduction that needs written authorization and does not have it on file. |
| `FORM_FULL_SSN` | A full social security number where the form wants the last four digits. |
| `FORM_MISSING_HEADER` | The header fields agencies bounce submissions over. |
| `FORM_HOURS_OUTSIDE_WEEK` | Hours belonging to a different payroll week. |
| `FILE_OVERDUE` | Past the seven-day deadline. |

Findings are **blockers**, **warnings**, or **notices**. `wageproof form`
refuses to generate a WH-347 while a blocker stands, because the certification
would not be true. `--force` overrides it.

## Use

```bash
pip install -e .

# Check a payroll week
wageproof check examples/week-12-problems.json

# Convert a time sheet into a payroll week
wageproof import examples/timesheet.csv \
    --project examples/project.json \
    --week-ending 2026-03-08 \
    --payroll-number 12 \
    --out week-12.json

# Generate the form once it is clean
wageproof form week-12.json --out payroll-12.txt
```

`check` exits non-zero when blockers are present, so it drops straight into a
cron job or a CI step.

As a library:

```python
from wageproof import check_week, load_week_file, render_text

week = load_week_file("week-12.json")
result = check_week(week)

for f in result.sorted_findings:
    print(f"{f.severity.value}: {f.title} — {f.action}")

if result.is_filable:
    print(render_text(week))
```

## Input

A payroll week is JSON — see `examples/week-12-problems.json`. Time sheets
import from CSV in either shape people actually keep:

```csv
name,id,classification,rate,mon,tue,wed,thu,fri,sat,sun
Marcus Ellery,4417,Electrician,48.20,8,8,8,8,8,0,0
```

```csv
name,id,classification,rate,date,hours
Marcus Ellery,4417,Electrician,48.20,2026-03-02,8
```

Wage determinations are entered per project. Rates are published free at
SAM.gov; automatic lookup by contract number is on the roadmap.

## The thing most spreadsheets get wrong

A worker at $48.20 base plus $31.15 fringe is often recorded as "$79.35/hr".
That produces two errors at once: the WH-347 fringe column is wrong, and the
overtime premium gets computed on the fringe portion. An overtime hour is worth
`(48.20 × 1.5) + 31.15 = $103.45`, not `79.35 × 1.5 = $119.03`. WageProof keeps
base and fringe separate everywhere and flags the combined-rate pattern.

## Scope

Federal Davis-Bacon and the WH-347 today. State portals (California eCPR,
LCPtracker and similar) each want the same facts in a different shape —
`build_payload()` returns structured data for exactly that reason, and adapters
are the next piece of work. See `docs/roadmap.md`.

WageProof checks arithmetic against a wage determination you supply. It is not
legal advice, and it does not replace reading your contract.

## Development

```bash
pip install -e ".[dev]"
pytest
ruff check .
```
