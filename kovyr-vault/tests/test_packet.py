"""Tests for the monthly compliance packet cover page and slug."""

from kovyr_vault import report
from kovyr_vault.cli import _slugify


def test_slugify():
    assert _slugify("Bright Smile Dental, LLC") == "bright-smile-dental-llc"
    assert _slugify("") == "client"
    assert _slugify("A/B  C") == "a-b-c"


def test_packet_index_links_pieces():
    html = report.render_packet_index(
        "Acme Dental", "2026-07",
        [("Security &amp; access report", "security-report.html"),
         ("Email breach exposure", "breach-scan.html")],
        "2026-07-27 15:00 UTC", "0.11.0")
    assert "Monthly Security Packet" in html
    assert "Acme Dental" in html
    assert 'href="security-report.html"' in html
    assert 'href="breach-scan.html"' in html
    assert "confidential" in html.lower()


def test_packet_index_escapes_client():
    html = report.render_packet_index(
        "<script>x</script>", "2026-07", [], "t", "0.11.0")
    assert "<script>x</script>" not in html
