"""Tests for tolerant config loading (aliases + unknown-key handling)."""

import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from bot.config import load_config  # noqa: E402


def _write(text):
    p = os.path.join(tempfile.mkdtemp(), "config.yaml")
    with open(p, "w") as f:
        f.write(text)
    return p


def test_legacy_poll_interval_is_aliased():
    # An old config.yaml using poll_interval must still load (not crash).
    cfg = load_config(_write(
        "trading:\n  product_id: SOL-USD\n  granularity: 900\n  poll_interval: 120\n"
    ))
    assert cfg.trading.refresh_interval == 120
    assert cfg.trading.granularity == 900


def test_unknown_keys_are_ignored():
    cfg = load_config(_write(
        "portfolio:\n  starting_cash: 1000.0\n  bogus_key: 42\n"
    ))
    assert cfg.portfolio.starting_cash == 1000.0


def test_new_key_takes_precedence_over_alias():
    cfg = load_config(_write(
        "trading:\n  refresh_interval: 30\n  poll_interval: 900\n"
    ))
    assert cfg.trading.refresh_interval == 30
