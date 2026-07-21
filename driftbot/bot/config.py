"""Typed configuration loaded from a YAML file."""

from __future__ import annotations

import dataclasses
import os
from dataclasses import dataclass
from pathlib import Path

import yaml


@dataclass
class ExchangeConfig:
    base_url: str = "https://api.exchange.coinbase.com"
    timeout: int = 10


@dataclass
class TradingConfig:
    product_id: str = "BTC-USD"
    granularity: int = 300      # candle size AND the trade-decision cadence
    refresh_interval: int = 60  # how often the loop refreshes the view/equity


@dataclass
class PortfolioConfig:
    starting_cash: float = 10000.0
    fee_rate: float = 0.006
    slippage: float = 0.0005


@dataclass
class StrategyConfig:
    name: str = "ma_crossover"
    ma_type: str = "ema"
    fast_period: int = 12
    slow_period: int = 26
    # RSI confirmation filter: when enabled, a BUY crossover only fires if RSI
    # is inside [rsi_buy_min, rsi_buy_max] — i.e. momentum is bullish but not
    # already overbought.
    use_rsi_filter: bool = True
    rsi_period: int = 14
    rsi_buy_min: float = 50.0
    rsi_buy_max: float = 70.0


@dataclass
class RiskConfig:
    position_pct: float = 0.25
    stop_loss_pct: float = 0.03
    take_profit_pct: float = 0.06
    max_daily_loss_pct: float = 0.10


@dataclass
class StateConfig:
    file: str = "state.json"
    log_file: str = "bot.log"


@dataclass
class Config:
    exchange: ExchangeConfig
    trading: TradingConfig
    portfolio: PortfolioConfig
    strategy: StrategyConfig
    risk: RiskConfig
    state: StateConfig

    def validate(self) -> None:
        """Fail fast on nonsensical settings before any trading starts."""
        s = self.strategy
        if s.fast_period < 1 or s.slow_period < 1:
            raise ValueError("MA periods must be >= 1")
        if s.fast_period >= s.slow_period:
            raise ValueError(
                f"fast_period ({s.fast_period}) must be < slow_period ({s.slow_period})"
            )
        if s.ma_type not in ("ema", "sma"):
            raise ValueError("strategy.ma_type must be 'ema' or 'sma'")
        if s.use_rsi_filter:
            if s.rsi_period < 2:
                raise ValueError("strategy.rsi_period must be >= 2")
            if not 0 <= s.rsi_buy_min < s.rsi_buy_max <= 100:
                raise ValueError(
                    "require 0 <= rsi_buy_min < rsi_buy_max <= 100"
                )
        if self.trading.granularity not in (60, 300, 900, 3600, 21600, 86400):
            raise ValueError(
                "granularity must be one of 60, 300, 900, 3600, 21600, 86400 (Coinbase limits)"
            )
        if self.portfolio.starting_cash <= 0:
            raise ValueError("starting_cash must be positive")
        for name, val in (
            ("position_pct", self.risk.position_pct),
            ("stop_loss_pct", self.risk.stop_loss_pct),
            ("take_profit_pct", self.risk.take_profit_pct),
            ("max_daily_loss_pct", self.risk.max_daily_loss_pct),
        ):
            if not 0 < val <= 1:
                raise ValueError(f"risk.{name} must be in (0, 1]")


# Old config keys mapped to their current names, so existing config.yaml files
# keep working after a rename instead of crashing on load.
_ALIASES = {"trading": {"poll_interval": "refresh_interval"}}


def _build(cls, data, aliases=None):
    """Construct a config dataclass, applying key aliases and ignoring unknown
    keys (with a warning) rather than raising on them."""
    data = dict(data or {})
    for old, new in (aliases or {}).items():
        if old in data:
            val = data.pop(old)
            data.setdefault(new, val)
    valid = {f.name for f in dataclasses.fields(cls)}
    unknown = sorted(set(data) - valid)
    if unknown:
        print(f"config: ignoring unknown {cls.__name__} key(s): {', '.join(unknown)}")
    return cls(**{k: v for k, v in data.items() if k in valid})


def load_config(path: str | Path) -> Config:
    """Load and validate configuration from a YAML file."""
    path = Path(path)
    if not path.exists():
        # Fall back to the committed example so fresh deploys (e.g. Railway,
        # where config.yaml is gitignored) run with sensible defaults.
        example = path.parent / "config.example.yaml"
        if example.exists():
            print(f"config: {path.name} not found, using {example.name} defaults")
            path = example
        else:
            raise FileNotFoundError(
                f"Config file not found: {path}. Copy config.example.yaml to config.yaml first."
            )
    raw = yaml.safe_load(path.read_text()) or {}

    cfg = Config(
        exchange=_build(ExchangeConfig, raw.get("exchange")),
        trading=_build(TradingConfig, raw.get("trading"), _ALIASES["trading"]),
        portfolio=_build(PortfolioConfig, raw.get("portfolio")),
        strategy=_build(StrategyConfig, raw.get("strategy")),
        risk=_build(RiskConfig, raw.get("risk")),
        state=_build(StateConfig, raw.get("state")),
    )

    # Persist state/logs to a mounted volume when DRIFTBOT_DATA_DIR is set
    # (e.g. a Railway volume at /data), so a redeploy doesn't wipe the paper
    # portfolio. Unset locally -> use the paths from config.
    data_dir = os.environ.get("DRIFTBOT_DATA_DIR")
    if data_dir:
        Path(data_dir).mkdir(parents=True, exist_ok=True)
        cfg.state.file = str(Path(data_dir) / "state.json")
        cfg.state.log_file = str(Path(data_dir) / "bot.log")

    cfg.validate()
    return cfg
