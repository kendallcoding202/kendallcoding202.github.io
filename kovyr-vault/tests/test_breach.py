"""Tests for the HIBP email breach scan. The HTTP layer is injected so
tests never touch the network or need a real API key."""

import json

from kovyr_vault import breach, report


def fake_fetch(responses):
    """Return a fetch(url, headers) that maps email -> (status, body)."""
    def _fetch(url, headers):
        for email, resp in responses.items():
            if breach.urllib.parse.quote(email, safe="") in url:
                return resp
        return (404, b"")
    return _fetch


def test_clean_email_404():
    fetch = fake_fetch({"ok@x.com": (404, b"")})
    r = breach.check_email("ok@x.com", "key", fetch=fetch)
    assert r.exposed is False
    assert r.breaches == []


def test_exposed_email_200():
    body = json.dumps([{"Name": "Adobe"}, {"Name": "LinkedIn"}]).encode()
    fetch = fake_fetch({"bad@x.com": (200, body)})
    r = breach.check_email("bad@x.com", "key", fetch=fetch)
    assert r.exposed is True
    assert r.breach_names == ["Adobe", "LinkedIn"]


def test_bad_key_raises():
    import pytest
    fetch = fake_fetch({"a@x.com": (401, b"")})
    with pytest.raises(breach.BreachError):
        breach.check_email("a@x.com", "bad", fetch=fetch)


def test_scan_and_summarize():
    fetch = fake_fetch({
        "clean@x.com": (404, b""),
        "hit@x.com": (200, json.dumps([{"Name": "Dropbox"}]).encode()),
    })
    results = breach.scan(["clean@x.com", "hit@x.com"], "key",
                          fetch=fetch, pace=False)
    s = breach.summarize(results)
    assert s["checked"] == 2
    assert s["exposed"] == 1
    assert s["clean"] == 1
    assert s["errors"] == 0


def test_scan_records_errors_without_aborting():
    fetch = fake_fetch({
        "a@x.com": (401, b""),           # will raise -> captured as error
        "b@x.com": (404, b""),
    })
    results = breach.scan(["a@x.com", "b@x.com"], "key",
                          fetch=fetch, pace=False)
    s = breach.summarize(results)
    assert s["errors"] == 1
    assert s["clean"] == 1


def test_breach_report_renders_and_escapes():
    summary = {
        "checked": 2, "exposed": 1, "clean": 1, "errors": 0,
        "details": [
            {"email": "safe@x.com", "exposed": False, "breaches": [],
             "error": None},
            {"email": "<script>@x.com", "exposed": True,
             "breaches": ["Adobe"], "error": None},
        ],
    }
    html = report.render_breach_report(summary, client="Acme")
    assert "Email Breach Exposure" in html
    assert "Adobe" in html
    assert "<script>@x.com" not in html   # escaped
    assert "Acme" in html
