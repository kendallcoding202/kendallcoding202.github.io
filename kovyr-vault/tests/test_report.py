from kovyr_vault import report


def scan_payload(wasted=2400, dupes=2):
    return {
        "files_scanned": 10,
        "bytes_scanned": 50_000,
        "duplicate_files": dupes,
        "wasted_bytes": wasted,
        "groups": [
            {
                "sha256": "ab" * 32,
                "size": 1200,
                "paths": ["/data/report.pdf", "/data/report copy.pdf",
                          "/backup/report.pdf"],
            }
        ] if dupes else [],
        "errors": [],
    }


def base_ctx(**overrides):
    ctx = {
        "client": "Acme Dental",
        "prepared_by": "Kovyr",
        "generated": "2026-07-22 00:00 UTC",
        "version": "0.1.0",
        "before": scan_payload(),
        "after": scan_payload(wasted=0, dupes=0),
        "vault": {
            "files": 8,
            "total_bytes": 40_000,
            "unique_blobs": 7,
            "verify_problems": [],
        },
    }
    ctx.update(overrides)
    return ctx


def test_report_contains_key_facts():
    html = report.render_report(base_ctx())
    assert "Acme Dental" in html
    assert "Redundant copies found" in html
    assert "Exposure eliminated" in html
    assert "2.3 KB" in html  # 2400 bytes wasted, before
    assert "PASS" in html
    assert "report copy.pdf" in html


def test_report_escapes_untrusted_names():
    ctx = base_ctx(client="<script>alert(1)</script>")
    ctx["before"]["groups"][0]["paths"][0] = "/data/<img src=x>.pdf"
    html = report.render_report(ctx)
    assert "<script>alert(1)" not in html
    assert "<img src=x>" not in html
    assert "&lt;script&gt;" in html


def test_report_failed_verify_shows_fail():
    ctx = base_ctx()
    ctx["vault"]["verify_problems"] = ["doc.txt: authentication failed"]
    html = report.render_report(ctx)
    assert "FAIL" in html


def test_report_without_vault_or_after():
    html = report.render_report(base_ctx(after=None, vault=None))
    assert "Redundant copies found" in html
    assert "Encryption at rest" not in html


def test_monitor_report_renders_history():
    ctx = {
        "client": "Acme Dental",
        "generated": "2026-07-22 00:00 UTC",
        "version": "0.1.0",
        "history": [
            {"timestamp": "2026-07-01 00:00 UTC", "files_scanned": 10,
             "bytes_scanned": 1000, "duplicate_files": 4,
             "wasted_bytes": 400, "groups": []},
            {"timestamp": "2026-07-08 00:00 UTC", "files_scanned": 12,
             "bytes_scanned": 1200, "duplicate_files": 6,
             "wasted_bytes": 600, "groups": []},
        ],
        "new_groups": [{"sha256": "cd" * 32, "size": 100, "count": 2,
                        "paths": ["/a", "/b"]}],
        "resolved_groups": [],
    }
    html = report.render_monitor_report(ctx)
    assert "Exposure over time" in html
    assert "2026-07-01" in html
    assert "1 new" in html
