"""A tiny, dependency-free web dashboard for the paper-trading bot.

Serves a single self-contained HTML page plus a ``/api/state`` JSON endpoint
that returns the engine's latest snapshot. The engine runs in the main thread;
this HTTP server runs in a background daemon thread and only *reads* the
snapshot, so it never places trades or mutates state.
"""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .engine import TradingEngine

_HTML_PATH = Path(__file__).parent / "dashboard.html"


def _make_handler(engine: TradingEngine):
    class Handler(BaseHTTPRequestHandler):
        def _send(self, code: int, body: bytes, content_type: str) -> None:
            self.send_response(code)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):  # noqa: N802
            if self.path in ("/", "/index.html"):
                self._send(200, _HTML_PATH.read_bytes(), "text/html; charset=utf-8")
            elif self.path.startswith("/api/state"):
                snap = engine.get_snapshot() or {"warming_up": True, "status": "waiting"}
                body = json.dumps(snap).encode("utf-8")
                self._send(200, body, "application/json")
            else:
                self._send(404, b"not found", "text/plain")

        def log_message(self, *args):  # silence per-request stderr logging
            return

    return Handler


def serve(engine: TradingEngine, host: str, port: int) -> ThreadingHTTPServer:
    """Create (but do not start) the dashboard HTTP server for ``engine``."""
    return ThreadingHTTPServer((host, port), _make_handler(engine))
