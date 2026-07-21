"""Read-only client for Coinbase public market data.

Only PUBLIC endpoints are used (candles + ticker). No API key, no auth, and no
way to place an order from here — this client cannot move money.

Coinbase Exchange docs: https://docs.cloud.coinbase.com/exchange/reference
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Dict, List

import requests


@dataclass
class Candle:
    time: int       # unix seconds (bucket start)
    low: float
    high: float
    open: float
    close: float
    volume: float


class CoinbaseClient:
    def __init__(self, base_url: str, timeout: int = 10):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": "driftbot/0.1"})

    def _get(self, path: str, params: dict | None = None, retries: int = 3) -> object:
        url = f"{self.base_url}{path}"
        last_err: Exception | None = None
        for attempt in range(retries):
            try:
                resp = self.session.get(url, params=params, timeout=self.timeout)
                if resp.status_code == 429:  # rate limited — back off and retry
                    raise requests.HTTPError("429 rate limited")
                resp.raise_for_status()
                return resp.json()
            except (requests.RequestException, ValueError) as exc:
                last_err = exc
                if attempt < retries - 1:
                    time.sleep(2 ** attempt)  # 1s, 2s, 4s
        raise RuntimeError(f"GET {url} failed after {retries} attempts: {last_err}")

    def get_candles(self, product_id: str, granularity: int,
                    limit: int = 300) -> List[Candle]:
        """Return up to ``limit`` recent candles, oldest first.

        Coinbase returns rows as [time, low, high, open, close, volume],
        newest first; we reverse so the caller gets chronological order.
        """
        data = self._get(
            f"/products/{product_id}/candles",
            params={"granularity": granularity},
        )
        if not isinstance(data, list):
            raise RuntimeError(f"unexpected candles response: {data!r}")
        candles = [
            Candle(int(r[0]), float(r[1]), float(r[2]), float(r[3]),
                   float(r[4]), float(r[5]))
            for r in data
        ]
        candles.sort(key=lambda c: c.time)  # oldest -> newest
        return candles[-limit:]

    def get_candles_history(self, product_id: str, granularity: int,
                            bars: int) -> List[Candle]:
        """Fetch up to ``bars`` recent candles by paging backward in time.

        Coinbase caps each request at 300 candles, so longer histories are
        stitched together from multiple windowed requests.
        """
        by_time: Dict[int, Candle] = {}
        window = timedelta(seconds=granularity * 300)
        end = datetime.now(timezone.utc)
        max_pages = (bars // 300) + 2

        for _ in range(max_pages):
            start = end - window
            data = self._get(
                f"/products/{product_id}/candles",
                params={
                    "granularity": granularity,
                    "start": start.isoformat(),
                    "end": end.isoformat(),
                },
            )
            if not isinstance(data, list) or not data:
                break
            for r in data:
                t = int(r[0])
                by_time[t] = Candle(t, float(r[1]), float(r[2]), float(r[3]),
                                    float(r[4]), float(r[5]))
            if len(by_time) >= bars:
                break
            end = start
            time.sleep(0.34)  # stay well under Coinbase's public rate limit

        candles = sorted(by_time.values(), key=lambda c: c.time)
        return candles[-bars:]

    def get_price(self, product_id: str) -> float:
        """Latest trade price for the product."""
        data = self._get(f"/products/{product_id}/ticker")
        if not isinstance(data, dict) or "price" not in data:
            raise RuntimeError(f"unexpected ticker response: {data!r}")
        return float(data["price"])
