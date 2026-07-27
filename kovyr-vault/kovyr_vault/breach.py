"""Email breach exposure check via Have I Been Pwned (HIBP) v3 API.

An operator-side assessment tool: given a client's email addresses, ask
HIBP whether they appear in known public breaches, and summarize the
exposure for the engagement report.

Privacy note — unlike the rest of Kovyr, this feature sends data off the
machine: each email address is sent to the HIBP service to be checked.
Disclose this to the client. The HIBP API key is supplied by the
operator (env var KOVYR_HIBP_KEY or --api-key) and never stored in code.
"""

from __future__ import annotations

import json
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field

API_ROOT = "https://haveibeenpwned.com/api/v3/breachedaccount/"
USER_AGENT = "Kovyr-Vault-Assessment"
# HIBP asks callers to pace requests; the lowest key tier allows one
# request every ~1.5s. Be a good citizen by default.
MIN_INTERVAL_S = 1.6


class BreachError(Exception):
    """A problem talking to HIBP (bad key, rate limit, network)."""


@dataclass
class EmailResult:
    email: str
    breaches: list[dict] = field(default_factory=list)
    error: str | None = None

    @property
    def exposed(self) -> bool:
        return bool(self.breaches) and self.error is None

    @property
    def breach_names(self) -> list[str]:
        return [b.get("Name", "?") for b in self.breaches]


def _default_fetch(url: str, headers: dict) -> tuple[int, bytes]:
    try:
        import certifi
        ctx = ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        ctx = ssl.create_default_context()
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=20, context=ctx) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read() if exc.fp else b""
    except urllib.error.URLError as exc:
        raise BreachError(f"network error: {exc.reason}") from exc


def check_email(email: str, api_key: str, fetch=None) -> EmailResult:
    """Query HIBP for one email. 404 = clean, 200 = breached list,
    401 = bad key, 429 = rate limited. `fetch` is injectable for tests."""
    fetch = fetch or _default_fetch
    quoted = urllib.parse.quote(email, safe="")
    url = f"{API_ROOT}{quoted}?truncateResponse=false"
    headers = {"hibp-api-key": api_key, "user-agent": USER_AGENT}
    status, body = fetch(url, headers)
    if status == 404:
        return EmailResult(email, breaches=[])
    if status == 200:
        try:
            return EmailResult(email, breaches=json.loads(body))
        except (json.JSONDecodeError, TypeError):
            return EmailResult(email, error="unexpected response format")
    if status == 401:
        raise BreachError("HIBP rejected the API key (401)")
    if status == 429:
        raise BreachError("HIBP rate limit hit (429) — slow down or wait")
    return EmailResult(email, error=f"HIBP returned status {status}")


def scan(emails: list[str], api_key: str, fetch=None,
         pace: bool = True, on_progress=None) -> list[EmailResult]:
    """Check several emails, pacing requests to respect HIBP limits."""
    results: list[EmailResult] = []
    for i, email in enumerate(emails):
        if pace and i > 0:
            time.sleep(MIN_INTERVAL_S)
        try:
            results.append(check_email(email, api_key, fetch=fetch))
        except BreachError as exc:
            results.append(EmailResult(email, error=str(exc)))
        if on_progress:
            on_progress(i + 1, len(emails))
    return results


def summarize(results: list[EmailResult]) -> dict:
    exposed = [r for r in results if r.exposed]
    errored = [r for r in results if r.error]
    return {
        "checked": len(results),
        "exposed": len(exposed),
        "clean": len([r for r in results
                      if not r.exposed and not r.error]),
        "errors": len(errored),
        "details": [
            {"email": r.email, "exposed": r.exposed,
             "breaches": r.breach_names, "error": r.error}
            for r in results
        ],
    }
