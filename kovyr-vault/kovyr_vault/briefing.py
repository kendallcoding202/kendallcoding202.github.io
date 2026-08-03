"""The de-identified briefing that is the only thing a model may ever see.

Every other module in this package works with real client data: file
paths, filenames, directory names, decrypted contents. A language model
must never receive any of it. This module is the boundary — it takes the
structures the tools already produce and returns a small object of
booleans, integers, and values drawn from fixed allowlists.

The design rule is *allowlist, never sanitize*. We do not take a
directory name and try to scrub it; client and patient names live in
directory names ("C:\\Clients\\Smith_John"), and a scrubber that misses
one leaks a person's name into a prompt. Instead each finding's location
is mapped to one of five buckets we chose ourselves, and anything that
does not match becomes "other". A value that never leaves this module
cannot leak from it.

Two things that look like data but are not, and must not be treated as
such:

* `vault.verify()` returns a list of strings shaped "<filename>: <error>".
  Only its length may cross this boundary.
* `Drift.new_groups` and the scan summary's `groups` each carry `paths`.
  Only their counts may cross.

`validate()` exists because the rules above are only as good as their
enforcement: it re-checks a finished briefing for path-like strings, a
real client name, unexpected keys, and non-primitive values. The CLI
prints the object so an operator can read it before trusting anything
downstream.
"""

from __future__ import annotations

import json
import re

SCHEMA = "kovyr.briefing.v1"

# The real name is substituted locally, after any generation step. The
# model is never told who the client is.
CLIENT_PLACEHOLDER = "{{CLIENT}}"

# Location buckets we chose. A path segment matching one of these keys is
# reported as that bucket; everything else collapses to "other".
LOCATION_BUCKETS = ("downloads", "desktop", "documents", "temp", "other")
_SEGMENT_TO_BUCKET = {
    "downloads": "downloads", "download": "downloads",
    "desktop": "desktop",
    "documents": "documents", "my documents": "documents",
    "temp": "temp", "tmp": "temp", "temporary": "temp",
}

# Device-control keys, mirroring posture.CONTROL_KEYS. Kept as a local
# constant so a briefing's shape is fixed here rather than inherited.
CONTROL_KEYS = ("disk", "firewall", "screenlock", "antivirus")

BRIEFING_KEYS = frozenset({
    "schema", "period", "client",
    "files_scanned", "bytes_scanned", "duplicate_files", "wasted_bytes",
    "duplicate_groups", "new_duplicate_groups", "resolved_duplicate_groups",
    "coverage_read", "coverage_skipped", "coverage_total",
    "sensitive_files", "sensitive_ssn", "sensitive_card",
    "exposure_by_location", "controls",
    "vault_present", "vault_files", "vault_unique_blobs",
    "vault_verify_problems", "failed_unlocks", "canary_alert",
})

# Anything that smells like a filesystem path. Used both to validate a
# briefing and to lint a generated draft.
_PATH_PATTERNS = (
    re.compile(r"[A-Za-z]:[\\/]"),        # C:\ or C:/
    re.compile(r"\\\\"),                  # UNC \\server
    re.compile(r"\\"),                    # any backslash
    re.compile(r"/[\w .-]+\.[A-Za-z0-9]{1,8}\b"),   # /name.ext
    re.compile(r"~/"),                    # home-relative
    re.compile(r"(?:^|\s)/[\w.-]+/"),     # /usr/, /Volumes/
)


def looks_like_path(text: str) -> bool:
    """Whether a string contains anything path-shaped. Deliberately
    eager: a false positive costs a rejected draft, a false negative
    costs a leaked filename."""
    return any(p.search(text) for p in _PATH_PATTERNS)


def location_bucket(path: str) -> str:
    """Map a filesystem path to one of LOCATION_BUCKETS.

    Only segments we recognise produce a named bucket; every other path —
    including one whose directories carry client or patient names —
    becomes "other". The path itself is discarded by the caller
    immediately after this returns.

    The *deepest* recognised segment wins, because that is where the file
    actually lives: "/tmp/staging/Downloads/x.csv" is a Downloads file
    that happens to sit under a temp directory, not a temp file.
    """
    bucket = "other"
    for raw in re.split(r"[\\/]+", str(path or "")):
        match = _SEGMENT_TO_BUCKET.get(raw.strip().lower())
        if match:
            bucket = match
    return bucket


def _int(value, default: int = 0) -> int:
    """Coerce to a plain int. Booleans are rejected rather than silently
    becoming 0/1, since a bool in a count field means a caller mistake."""
    if isinstance(value, bool) or value is None:
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _count(value) -> int:
    """Length for sized things, int for numbers. `vault.verify()` returns
    a list of "<filename>: <error>" strings — this is what keeps those
    filenames from crossing the boundary."""
    if value is None or isinstance(value, bool):
        return 0
    if isinstance(value, (list, tuple, set, dict)):
        return len(value)
    return _int(value)


def build(*, period: str,
          scan_summary: dict | None = None,
          sensitive_report=None,
          controls=None,
          drift=None,
          vault_stats: dict | None = None,
          alerts: dict | None = None) -> dict:
    """Assemble the object a model may see.

    Every argument is one of the structures the tools already produce.
    Nothing is copied through verbatim: each field is either a count, a
    boolean, or a value from a fixed allowlist.
    """
    scan_summary = scan_summary or {}
    vault_stats = vault_stats or {}
    alerts = alerts or {}

    # Duplicate groups: counts only. The groups themselves carry paths.
    groups = scan_summary.get("groups") or []
    new_groups = getattr(drift, "new_groups", None) or []
    resolved_groups = getattr(drift, "resolved_groups", None) or []

    findings = list(getattr(sensitive_report, "findings", None) or [])
    by_location = {bucket: 0 for bucket in LOCATION_BUCKETS}
    for finding in findings:
        by_location[location_bucket(getattr(finding, "path", ""))] += 1

    control_rows = []
    for check in controls or []:
        key = getattr(check, "key", None)
        if key not in CONTROL_KEYS:
            continue
        status = getattr(check, "status", None)
        control_rows.append({
            "key": key,
            # true / false / null, preserved exactly, alongside applicable:
            # "doesn't apply here" and "we couldn't tell" stay distinct.
            "status": status if isinstance(status, bool) else None,
            "applicable": bool(getattr(check, "applicable", True)),
        })

    return {
        "schema": SCHEMA,
        "period": str(period),
        "client": CLIENT_PLACEHOLDER,

        "files_scanned": _int(scan_summary.get("files_scanned")),
        "bytes_scanned": _int(scan_summary.get("bytes_scanned")),
        "duplicate_files": _int(scan_summary.get("duplicate_files")),
        "wasted_bytes": _int(scan_summary.get("wasted_bytes")),
        "duplicate_groups": len(groups),
        "new_duplicate_groups": len(new_groups),
        "resolved_duplicate_groups": len(resolved_groups),

        # Coverage travels with the findings, always. A clean result over
        # 412 readable files means nothing if 1,203 could not be read, and
        # the narrative has to be able to say so.
        "coverage_read": _int(getattr(sensitive_report, "read", 0)),
        "coverage_skipped": _int(getattr(sensitive_report, "skipped", 0)),
        "coverage_total": _int(getattr(sensitive_report, "read", 0))
        + _int(getattr(sensitive_report, "skipped", 0)),

        "sensitive_files": len(findings),
        "sensitive_ssn": sum(_int(getattr(f, "ssn", 0)) for f in findings),
        "sensitive_card": sum(_int(getattr(f, "card", 0)) for f in findings),
        "exposure_by_location": by_location,

        "controls": control_rows,

        "vault_present": bool(vault_stats.get("present", False)),
        "vault_files": _int(vault_stats.get("files")),
        "vault_unique_blobs": _int(vault_stats.get("unique_blobs")),
        # A count, never the list: its entries begin with a filename.
        "vault_verify_problems": _count(vault_stats.get("verify_problems")),

        "failed_unlocks": _int(alerts.get("failed_unlocks")),
        "canary_alert": bool(alerts.get("canary", False)),
    }


def validate(briefing: dict, client_name: str | None = None) -> list[str]:
    """Reasons this object is unsafe to send anywhere. Empty means safe.

    Re-checks what build() is supposed to guarantee, because a boundary
    that is only enforced at construction stops being a boundary the
    first time someone adds a field.
    """
    problems: list[str] = []
    if not isinstance(briefing, dict):
        return ["briefing is not a dict"]

    unexpected = set(briefing) - BRIEFING_KEYS
    for key in sorted(unexpected):
        problems.append(f"unexpected key: {key!r}")
    for key in sorted(BRIEFING_KEYS - set(briefing)):
        problems.append(f"missing key: {key!r}")

    if briefing.get("client") != CLIENT_PLACEHOLDER:
        problems.append(
            f"client must be the {CLIENT_PLACEHOLDER} placeholder, "
            f"got {briefing.get('client')!r}")

    for bucket in briefing.get("exposure_by_location") or {}:
        if bucket not in LOCATION_BUCKETS:
            problems.append(f"location bucket not on the allowlist: "
                            f"{bucket!r}")

    for row in briefing.get("controls") or []:
        if not isinstance(row, dict):
            problems.append("control row is not a dict")
            continue
        if set(row) - {"key", "status", "applicable"}:
            problems.append(f"control row has extra fields: {sorted(row)}")
        if row.get("key") not in CONTROL_KEYS:
            problems.append(f"unknown control key: {row.get('key')!r}")

    # Walk every leaf: only primitives, no path-like or client-named text.
    needle = (client_name or "").strip().lower()

    def walk(value, where: str) -> None:
        if isinstance(value, dict):
            for k, v in value.items():
                if isinstance(k, str) and looks_like_path(k):
                    problems.append(f"path-like key at {where}: {k!r}")
                walk(v, f"{where}.{k}")
        elif isinstance(value, (list, tuple)):
            for i, v in enumerate(value):
                walk(v, f"{where}[{i}]")
        elif isinstance(value, str):
            if looks_like_path(value):
                problems.append(f"path-like string at {where}: {value!r}")
            if needle and needle in value.lower():
                problems.append(f"client name appears at {where}")
        elif not isinstance(value, (bool, int, float, type(None))):
            problems.append(f"non-primitive value at {where}: "
                            f"{type(value).__name__}")

    walk(briefing, "briefing")
    return problems


def to_json(briefing: dict) -> str:
    """Stable serialization — what an operator reads, and what any later
    step would send."""
    return json.dumps(briefing, indent=2, sort_keys=True)
