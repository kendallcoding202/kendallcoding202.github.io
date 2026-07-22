"""Branded HTML engagement reports.

Renders a self-contained, client-facing report from `scan --json` payloads
(before/after) and optional vault statistics. No external assets, works in
light and dark mode, and everything user-controlled is HTML-escaped.
"""

from __future__ import annotations

import html
from typing import Any

from .util import human_size

MAX_GROUPS_SHOWN = 20

_CSS = """
:root {
  --navy: #1e3a5f; --navy-light: #4a7ab2;
  --bg: #ffffff; --surface: #f5f7fa;
  --text: #1c2733; --muted: #5a6b7b; --border: #e2e8f0;
  --good: #1a7f4e; --bad: #b3261e;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0d1622; --surface: #16202e;
    --text: #e6edf3; --muted: #9fb0c0; --border: #24303f;
    --navy-light: #6ea3d8; --good: #4ec98c; --bad: #f2848b;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text);
  font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
  Helvetica, Arial, sans-serif; }
.hero { background: linear-gradient(135deg, var(--navy), #0c1b2e);
  color: #eef4fb; padding: 40px 24px 32px; }
.inner { max-width: 860px; margin: 0 auto; }
.badge { display: inline-flex; align-items: center; gap: 8px; font-size: 12px;
  letter-spacing: .05em; text-transform: uppercase; opacity: .85;
  margin-bottom: 12px; }
.badge .dot { width: 9px; height: 9px; border-radius: 50%;
  background: #6ea3d8; box-shadow: 0 0 12px #6ea3d8; }
.hero h1 { margin: 0 0 4px; font-size: 26px; font-weight: 700; }
.hero p { margin: 0; opacity: .85; font-size: 14px; }
main { max-width: 860px; margin: 0 auto; padding: 28px 24px 64px; }
h2 { font-size: 18px; margin: 34px 0 12px; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 12px; }
.tile { background: var(--surface); border: 1px solid var(--border);
  border-radius: 12px; padding: 14px 16px; }
.tile .label { font-size: 12px; letter-spacing: .04em; text-transform: uppercase;
  color: var(--muted); margin-bottom: 6px; }
.tile .value { font-size: 26px; font-weight: 700; line-height: 1.15; }
.tile .sub { font-size: 12px; color: var(--muted); margin-top: 4px; }
.status-good { color: var(--good); }
.status-bad { color: var(--bad); }
.bars { display: grid; gap: 10px; margin-top: 8px; }
.bar-row { display: grid; grid-template-columns: 90px 1fr; gap: 12px;
  align-items: center; }
.bar-row .name { font-size: 13px; color: var(--muted); text-align: right; }
.bar-track { position: relative; height: 26px; }
.bar-fill { height: 100%; border-radius: 0 4px 4px 0;
  background: var(--navy-light); min-width: 2px; }
.bar-val { position: absolute; left: 8px; top: 50%; transform: translateY(-50%);
  font-size: 12px; font-weight: 600; color: var(--text); white-space: nowrap;
  text-shadow: 0 0 4px var(--bg); }
.table-wrap { overflow-x: auto; border: 1px solid var(--border);
  border-radius: 12px; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th, td { text-align: left; padding: 9px 14px;
  border-bottom: 1px solid var(--border); vertical-align: top; }
th { background: var(--surface); font-size: 12px; letter-spacing: .03em;
  text-transform: uppercase; color: var(--muted); }
tr:last-child td { border-bottom: none; }
td.num, th.num { text-align: right; white-space: nowrap; }
.paths { color: var(--muted); font-size: 12px; word-break: break-all; }
.note { background: var(--surface); border: 1px solid var(--border);
  border-radius: 12px; padding: 14px 18px; font-size: 13px;
  color: var(--muted); }
footer { max-width: 860px; margin: 0 auto; padding: 0 24px 40px;
  font-size: 12px; color: var(--muted); }
@media print { .hero { -webkit-print-color-adjust: exact; } }
"""


def _esc(value: Any) -> str:
    return html.escape(str(value))


def _tile(label: str, value: str, sub: str = "", cls: str = "") -> str:
    sub_html = f'<div class="sub">{sub}</div>' if sub else ""
    return (
        f'<div class="tile"><div class="label">{_esc(label)}</div>'
        f'<div class="value {cls}">{value}</div>{sub_html}</div>'
    )


def _bar_pair(label_a: str, val_a: int, label_b: str, val_b: int) -> str:
    peak = max(val_a, val_b, 1)
    rows = []
    for name, val in ((label_a, val_a), (label_b, val_b)):
        pct = max(round(val / peak * 100), 1 if val else 0)
        rows.append(
            f'<div class="bar-row"><div class="name">{_esc(name)}</div>'
            f'<div class="bar-track"><div class="bar-fill" '
            f'style="width:{pct}%"></div>'
            f'<span class="bar-val">{_esc(human_size(val))}</span></div></div>'
        )
    return f'<div class="bars">{"".join(rows)}</div>'


def _groups_table(scan: dict) -> str:
    groups = scan.get("groups", [])
    rows = []
    for g in groups[:MAX_GROUPS_SHOWN]:
        paths = "<br>".join(_esc(p) for p in g["paths"])
        wasted = g["size"] * (len(g["paths"]) - 1)
        rows.append(
            f'<tr><td class="num">{len(g["paths"])}</td>'
            f'<td class="num">{_esc(human_size(g["size"]))}</td>'
            f'<td class="num">{_esc(human_size(wasted))}</td>'
            f'<td class="paths">{paths}</td></tr>'
        )
    omitted = ""
    if len(groups) > MAX_GROUPS_SHOWN:
        omitted = (
            f'<p class="note">Showing the {MAX_GROUPS_SHOWN} largest groups; '
            f"{len(groups) - MAX_GROUPS_SHOWN} smaller groups omitted "
            f"(all are included in the machine-readable scan data).</p>"
        )
    return (
        '<div class="table-wrap"><table>'
        "<tr><th class=\"num\">Copies</th><th class=\"num\">File size</th>"
        "<th class=\"num\">Excess</th><th>Locations</th></tr>"
        f'{"".join(rows)}</table></div>{omitted}'
    )


def render_report(ctx: dict) -> str:
    """Render the engagement report. See cli.cmd_report for the ctx shape."""
    client = ctx.get("client")
    before = ctx.get("before")
    after = ctx.get("after")
    vault = ctx.get("vault")

    sections: list[str] = []

    # --- headline tiles ---
    tiles = []
    if before:
        tiles.append(_tile("Files reviewed", f'{before["files_scanned"]:,}',
                           human_size(before["bytes_scanned"])))
        tiles.append(_tile("Redundant copies found",
                           f'{before["duplicate_files"]:,}'))
        tiles.append(_tile("Excess exposure found",
                           _esc(human_size(before["wasted_bytes"]))))
    if before and after:
        removed = before["wasted_bytes"] - after["wasted_bytes"]
        tiles.append(_tile("Exposure eliminated",
                           _esc(human_size(max(removed, 0)))))
        tiles.append(_tile("Duplicates remaining",
                           f'{after["duplicate_files"]:,}'))
    if vault:
        tiles.append(_tile("Files encrypted at rest", f'{vault["files"]:,}',
                           human_size(vault["total_bytes"])))
        problems = vault.get("verify_problems")
        if problems is not None:
            if problems:
                tiles.append(_tile("Integrity check",
                                   "&#10007; FAIL",
                                   f"{len(problems)} entries failed",
                                   "status-bad"))
            else:
                tiles.append(_tile("Integrity check", "&#10003; PASS",
                                   "every file decrypts and matches "
                                   "its hash", "status-good"))
    if tiles:
        sections.append(f'<h2>Summary</h2><div class="tiles">'
                        f'{"".join(tiles)}</div>')

    if before and after:
        sections.append(
            "<h2>Exposure, before and after</h2>"
            + _bar_pair("Before", before["wasted_bytes"],
                        "After", after["wasted_bytes"])
            + '<p class="note">Exposure = bytes held in redundant copies of '
            "the same content. Every extra copy is an additional place the "
            "data can leak from.</p>"
        )

    source_scan = before or after
    if source_scan and source_scan.get("groups"):
        sections.append("<h2>Duplicate content found</h2>"
                        + _groups_table(source_scan))

    if vault:
        sections.append(
            "<h2>Encryption at rest</h2><p>Remaining data is stored in a "
            "Kovyr Vault: AES-256-GCM authenticated encryption under a "
            "random 256-bit master key, wrapped by a passphrase-derived "
            "key (scrypt). File contents <em>and file names</em> are "
            "encrypted; identical content is stored once. Tampering or "
            "corruption is detected on decrypt.</p>"
        )

    title = "Data Protection Report"
    subtitle = f"Prepared for {_esc(client)}" if client else "Engagement summary"
    prepared = ctx.get("prepared_by")
    footer_bits = [f"Generated {_esc(ctx.get('generated', ''))}"]
    if prepared:
        footer_bits.append(f"Prepared by {_esc(prepared)}")
    footer_bits.append("Kovyr Vault v" + _esc(ctx.get("version", "")))

    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kovyr — {_esc(client) if client else title}</title>
<style>{_CSS}</style></head><body>
<div class="hero"><div class="inner">
<div class="badge"><span class="dot"></span>Kovyr &middot; Data Protection</div>
<h1>{title}</h1><p>{subtitle}</p>
</div></div>
<main>{"".join(sections)}</main>
<footer>{" &middot; ".join(footer_bits)}</footer>
</body></html>
"""


def render_monitor_report(ctx: dict) -> str:
    """Render the recurring-monitoring report from monitor state history."""
    client = ctx.get("client")
    history: list[dict] = ctx.get("history", [])
    current = history[-1] if history else None
    new_groups = ctx.get("new_groups", [])
    resolved = ctx.get("resolved_groups", [])

    sections: list[str] = []
    if current:
        drift_cls = "status-bad" if new_groups else "status-good"
        drift_val = (f"&#9888; {len(new_groups)} new"
                     if new_groups else "&#10003; none")
        tiles = [
            _tile("Files monitored", f'{current["files_scanned"]:,}',
                  human_size(current["bytes_scanned"])),
            _tile("Redundant copies", f'{current["duplicate_files"]:,}'),
            _tile("Current excess exposure",
                  _esc(human_size(current["wasted_bytes"]))),
            _tile("New duplication since last check", drift_val,
                  f"{len(resolved)} groups resolved" if resolved else "",
                  drift_cls),
        ]
        sections.append(f'<h2>Current status</h2><div class="tiles">'
                        f'{"".join(tiles)}</div>')

    if len(history) > 1:
        peak = max(s["wasted_bytes"] for s in history) or 1
        rows = []
        for snap in history[-12:]:
            val = snap["wasted_bytes"]
            pct = max(round(val / peak * 100), 1 if val else 0)
            date = _esc(str(snap.get("timestamp", ""))[:10])
            rows.append(
                f'<div class="bar-row"><div class="name">{date}</div>'
                f'<div class="bar-track"><div class="bar-fill" '
                f'style="width:{pct}%"></div>'
                f'<span class="bar-val">{_esc(human_size(val))} '
                f'&middot; {snap["duplicate_files"]} copies</span>'
                f"</div></div>"
            )
        sections.append(
            "<h2>Exposure over time</h2>"
            f'<div class="bars">{"".join(rows)}</div>'
            '<p class="note">Each row is one monitoring run (most recent '
            "last). Rising exposure means duplicate copies are creeping "
            "back and a cleanup pass is due.</p>"
        )

    title = "Ongoing Monitoring Report"
    subtitle = f"Prepared for {_esc(client)}" if client else "Recurring check"
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kovyr Monitor — {_esc(client) if client else "report"}</title>
<style>{_CSS}</style></head><body>
<div class="hero"><div class="inner">
<div class="badge"><span class="dot"></span>Kovyr &middot; Monitoring</div>
<h1>{title}</h1><p>{subtitle}</p>
</div></div>
<main>{"".join(sections)}</main>
<footer>Generated {_esc(ctx.get("generated", ""))} &middot; Kovyr Vault
v{_esc(ctx.get("version", ""))}</footer>
</body></html>
"""
