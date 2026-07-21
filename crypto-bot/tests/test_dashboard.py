"""Smoke test for the dashboard HTTP server + snapshot builder.

Runs entirely offline: it hand-feeds synthetic candles to the engine's snapshot
builder (no exchange calls) and checks the server serves HTML and JSON.
"""

import json
import os
import sys
import tempfile
import threading
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from bot.config import (  # noqa: E402
    Config, ExchangeConfig, PortfolioConfig, RiskConfig, StateConfig,
    StrategyConfig, TradingConfig,
)
from bot.dashboard import serve  # noqa: E402
from bot.engine import TradingEngine  # noqa: E402
from bot.exchange import Candle  # noqa: E402


def _config():
    tmp = tempfile.mkdtemp()
    return Config(
        exchange=ExchangeConfig(),
        trading=TradingConfig(product_id="SOL-USD", granularity=900),
        portfolio=PortfolioConfig(starting_cash=1000.0),
        strategy=StrategyConfig(),
        risk=RiskConfig(),
        state=StateConfig(file=os.path.join(tmp, "state.json"),
                          log_file=os.path.join(tmp, "bot.log")),
    )


def _local_get(url):
    # Bypass any configured proxy for localhost.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(url, timeout=5) as r:
        return r.status, r.read().decode("utf-8")


def test_dashboard_serves_html_and_state():
    engine = TradingEngine(_config())

    # Build a snapshot directly from synthetic candles (no network).
    import math
    candles = [
        Candle(1_700_000_000 + i * 900, p * 0.999, p * 1.001, p, p, 10.0)
        for i, p in enumerate(140 + 20 * math.sin(i / 15.0) for i in range(120))
    ]
    reading = engine.strategy.evaluate([c.close for c in candles])
    engine._update_snapshot(candles, candles[-1].close, reading, halted=False)

    server = serve(engine, "127.0.0.1", 0)  # port 0 -> OS picks a free port
    port = server.server_address[1]
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    try:
        status, html = _local_get(f"http://127.0.0.1:{port}/")
        assert status == 200
        assert "Paper Trading Bot" in html
        assert "priceChart" in html

        status, body = _local_get(f"http://127.0.0.1:{port}/api/state")
        assert status == 200
        snap = json.loads(body)
        assert snap["product"] == "SOL-USD"
        assert snap["starting_cash"] == 1000.0
        assert "chart" in snap and len(snap["chart"]["price"]) == len(candles)
        assert "signal" in snap
    finally:
        server.shutdown()
