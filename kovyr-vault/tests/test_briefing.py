"""Tests for the de-identified briefing boundary.

The load-bearing test is test_client_directory_names_never_survive: a
real path carries a person's name in a directory, and none of it may
appear anywhere in the serialized briefing.
"""

import json

from kovyr_vault import briefing
from kovyr_vault.monitor import Drift
from kovyr_vault.posture import Check
from kovyr_vault.sensitive import Finding, ScanReport


def scan_summary(files=10, dupes=2, groups=1):
    return {
        "timestamp": "2026-07-01 00:00 UTC",
        "files_scanned": files,
        "bytes_scanned": 5000,
        "duplicate_files": dupes,
        "wasted_bytes": 400,
        "groups": [{"sha256": "ab" * 32, "size": 200, "count": 2,
                    "paths": ["/data/a.txt", "/data/b.txt"]}] * groups,
    }


# ---------- the one that matters ----------

def test_client_directory_names_never_survive():
    """A finding's path carries the client's name in a directory. Nothing
    of it — not the surname, not the folder, not the filename — may reach
    the briefing in any form."""
    report = ScanReport(
        findings=[Finding(r"C:\Clients\Smith_John\ssn_scan.pdf", 3, 0)],
        read=1, skipped=0)
    obj = briefing.build(period="2026-07", sensitive_report=report)
    blob = json.dumps(obj)

    for secret in ("Smith", "smith", "Clients", "clients",
                   "ssn_scan", "John", r"C:\\", ".pdf"):
        assert secret not in blob, f"{secret!r} leaked into the briefing"

    # the finding is still counted, just not described
    assert obj["sensitive_files"] == 1
    assert obj["sensitive_ssn"] == 3
    assert obj["exposure_by_location"]["other"] == 1
    assert briefing.validate(obj) == []


# ---------- location bucketing ----------

def test_known_folders_map_to_their_bucket():
    cases = {
        r"C:\Users\kendall\Downloads\taxes.csv": "downloads",
        "/Users/kendall/Desktop/notes.txt": "desktop",
        "/Users/kendall/Documents/file.txt": "documents",
        "/tmp/scratch.txt": "temp",
        r"C:\Windows\Temp\x.txt": "temp",
    }
    for path, expected in cases.items():
        assert briefing.location_bucket(path) == expected, path


def test_deepest_recognised_folder_wins():
    """A file under /tmp/staging/Downloads lives in Downloads; the temp
    directory it happens to sit beneath is not where it is."""
    assert briefing.location_bucket(
        "/tmp/staging/Downloads/receipt.csv") == "downloads"
    assert briefing.location_bucket(
        "/Users/x/Documents/temp/scratch.txt") == "temp"
    assert briefing.location_bucket(
        "/tmp/build/Clients/Smith/x.pdf") == "temp"   # no deeper match


def test_unknown_folders_collapse_to_other():
    """Anything we did not choose ourselves becomes "other" — a directory
    name is never passed through, because that is where names live."""
    for path in (r"C:\Clients\Smith_John\x.pdf",
                 "/srv/patients/DOE_JANE/chart.txt",
                 "/Volumes/Backup2024/acme_dental/f.csv",
                 "", "relative.txt"):
        assert briefing.location_bucket(path) == "other", path


def test_every_bucket_key_is_on_the_allowlist():
    report = ScanReport(findings=[
        Finding("/Users/x/Downloads/a.txt", 1, 0),
        Finding("/secret/client_hospital/b.txt", 0, 1),
    ], read=2, skipped=0)
    obj = briefing.build(period="2026-07", sensitive_report=report)
    assert set(obj["exposure_by_location"]) == set(briefing.LOCATION_BUCKETS)
    assert obj["exposure_by_location"]["downloads"] == 1
    assert obj["exposure_by_location"]["other"] == 1


# ---------- coverage ----------

def test_coverage_counts_survive_intact():
    """A clean result over 412 readable files means nothing if 1,203 were
    unreadable; the narrative must be able to say so."""
    report = ScanReport(findings=[], read=412, skipped=1203)
    obj = briefing.build(period="2026-07", sensitive_report=report)
    assert obj["coverage_read"] == 412
    assert obj["coverage_skipped"] == 1203
    assert obj["coverage_total"] == 1615
    assert obj["sensitive_files"] == 0


# ---------- device controls ----------

def test_control_states_stay_distinct():
    """n/a and unknown must not collapse into each other."""
    controls = [
        Check("disk", "Disk encryption", True, "on"),
        Check("firewall", "Firewall", False, "off"),
        Check("screenlock", "Automatic screen lock", None, "couldn't tell"),
        Check("antivirus", "Antivirus", None, "n/a here", applicable=False),
    ]
    obj = briefing.build(period="2026-07", controls=controls)
    rows = {r["key"]: r for r in obj["controls"]}
    assert rows["disk"]["status"] is True
    assert rows["firewall"]["status"] is False
    # unknown: applies here, but undetermined
    assert rows["screenlock"]["status"] is None
    assert rows["screenlock"]["applicable"] is True
    # not applicable: distinct from unknown
    assert rows["antivirus"]["status"] is None
    assert rows["antivirus"]["applicable"] is False


def test_control_detail_is_dropped():
    """`detail` is free text — it has carried an antivirus product name and
    a BitLocker drive letter. It must not reach the briefing."""
    controls = [Check("antivirus", "Antivirus", True,
                      "Antivirus is active (Sophos Endpoint)")]
    obj = briefing.build(period="2026-07", controls=controls)
    assert "Sophos" not in json.dumps(obj)
    assert set(obj["controls"][0]) == {"key", "status", "applicable"}


# ---------- counts, never the underlying lists ----------

def test_verify_problems_becomes_a_count():
    """vault.verify() returns "<filename>: <error>" strings. Only the
    length may cross the boundary."""
    obj = briefing.build(period="2026-07", vault_stats={
        "present": True, "files": 12, "unique_blobs": 10,
        "verify_problems": ["/Clients/Smith/1099.pdf: bad tag",
                            "payroll.xlsx: bad tag"]})
    assert obj["vault_verify_problems"] == 2
    blob = json.dumps(obj)
    assert "Smith" not in blob and "payroll" not in blob
    assert briefing.validate(obj) == []


def test_drift_and_groups_reduce_to_counts():
    grp = {"sha256": "cd" * 32, "size": 9, "count": 2,
           "paths": [r"C:\Clients\Acme\a.txt", r"C:\Clients\Acme\b.txt"]}
    obj = briefing.build(period="2026-07",
                         scan_summary=scan_summary(groups=2),
                         drift=Drift(new_groups=[grp], resolved_groups=[]))
    assert obj["duplicate_groups"] == 2
    assert obj["new_duplicate_groups"] == 1
    assert obj["resolved_duplicate_groups"] == 0
    assert "Acme" not in json.dumps(obj)


# ---------- client name ----------

def test_client_is_always_the_placeholder():
    obj = briefing.build(period="2026-07")
    assert obj["client"] == briefing.CLIENT_PLACEHOLDER
    assert briefing.validate(obj, client_name="Kimball & Roberts") == []


# ---------- validate ----------

def test_validate_accepts_a_full_briefing():
    obj = briefing.build(
        period="2026-07", scan_summary=scan_summary(),
        sensitive_report=ScanReport(
            findings=[Finding("/Users/x/Desktop/a.txt", 1, 1)],
            read=5, skipped=2),
        controls=[Check("disk", "Disk encryption", True, "on")],
        drift=Drift(), vault_stats={"present": True, "files": 3,
                                    "unique_blobs": 3,
                                    "verify_problems": []},
        alerts={"failed_unlocks": 2, "canary": False})
    assert briefing.validate(obj, client_name="Acme Dental") == []


def test_validate_flags_a_leaked_path():
    obj = briefing.build(period="2026-07")
    obj["period"] = r"C:\Clients\Smith"
    problems = briefing.validate(obj)
    assert any("path-like" in p for p in problems)


def test_validate_flags_the_real_client_name():
    obj = briefing.build(period="2026-07")
    obj["period"] = "2026-07 for Kimball and Roberts"
    problems = briefing.validate(obj, client_name="Kimball and Roberts")
    assert any("client name" in p for p in problems)


def test_validate_flags_unexpected_and_missing_keys():
    obj = briefing.build(period="2026-07")
    obj["exfiltrated"] = "anything"
    assert any("unexpected key" in p for p in briefing.validate(obj))

    del obj["exfiltrated"]
    del obj["coverage_read"]
    assert any("missing key" in p for p in briefing.validate(obj))


def test_validate_flags_a_substituted_client_name():
    obj = briefing.build(period="2026-07")
    obj["client"] = "Kimball & Roberts"
    assert any("placeholder" in p for p in briefing.validate(obj))


def test_validate_flags_non_primitive_values():
    obj = briefing.build(period="2026-07")
    obj["files_scanned"] = object()
    assert any("non-primitive" in p for p in briefing.validate(obj))


def test_validate_flags_an_off_allowlist_bucket():
    obj = briefing.build(period="2026-07")
    obj["exposure_by_location"]["C:\\Clients"] = 1
    problems = briefing.validate(obj)
    assert any("allowlist" in p or "path-like" in p for p in problems)


# ---------- path detection ----------

def test_looks_like_path_detects_common_shapes():
    for text in (r"C:\Users\x", r"\\server\share", "/etc/passwd",
                 "see report.pdf at /tmp/report.pdf", "~/Documents",
                 r"C:/Users/x"):
        assert briefing.looks_like_path(text), text


def test_looks_like_path_allows_ordinary_prose():
    for text in ("3 files hold unencrypted SSNs.",
                 "Disk encryption is on; the firewall is off.",
                 "Coverage was 412 of 1,615 files.",
                 "The period is 2026-07."):
        assert not briefing.looks_like_path(text), text
