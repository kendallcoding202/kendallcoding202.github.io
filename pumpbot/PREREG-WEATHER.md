# Pre-registration: does a weather forecast beat Polymarket's temperature markets?

Written 2026-10-01, before any forecast has been fetched or joined to any outcome.

## Why

The void Jev run (`PREREG-JEV-POLYMARKET.md`) showed that daily temperature markets are
about 30% of Polymarket's markets with $1k+ volume. 26,452 resolved in August–September
alone, across ~50 cities, each on one named station. The market beat a blind forecaster
there because traders use forecasts. The question here is whether **a forecast, properly
calibrated to each station, beats the market's price by more than the cost of trading**.

**Expected result: probably NO.** Bots already trade these markets with the same free
forecasts. What could still leave room: hundreds of thin markets a day, and the
station-specific calibration (airport vs city, hourly vs continuous readings) that a
casual trader skips.

## Population

- Polymarket markets matching "highest temperature in …" or "lowest temperature in …",
  from the population already fixed in `PREREG-JEV-POLYMARKET.md` (Yes/No, volume ≥ $1k,
  ending 2026-08-01 to 2026-09-30, cleanly resolved).
- **Station** parsed from the resolution rules: a Wunderground URL's ICAO code, a NOAA
  `site=` code, or the Hong Kong Observatory. Coordinates from OurAirports; the Hong Kong
  Observatory at 22.302 N, 114.174 E. Markets whose station cannot be parsed are dropped
  and counted.
- **Event** = (station, date, highest/lowest). Its buckets are the markets sharing it.
- **Sample to price:** up to 5,000 markets, seed 20261001, uniform. Decision time 24h
  before `endDate` (all are 12:00 UTC), price as in the Jev run (last hourly point at or
  before decision, within 6h). Prices outside 0.02–0.98 dropped and counted.

## The forecast — only what was known at decision time

Open-Meteo **Previous Runs API**, `temperature_2m_previous_day2`, hourly, `best_match`,
at the station's coordinates, in the station's local time zone. The day's forecast high
(low) is the max (min) over the 24 local hours.

`previous_day2` for an hour is the run issued about 48 hours before that hour. Decision
time is 12:00 UTC the day before the market's date. For every station from UTC−10 to
UTC+14, every local hour of the market's day is at least 24 hours after decision time, so
every value used comes from a run issued **before** the decision. Day-1 runs would be
more accurate but some were issued after the decision, so they are excluded. This handicaps
the model, which makes a YES more trustworthy.

The Historical Forecast API is **not** used. It stitches the first hours of every run
together, so it contains forecasts issued after the decision.

## The model (every fit in-sample only)

The observed value is a whole degree (C or F, as the market states).
`observed ≈ forecast + bias_station + noise`, noise normal with sd `σ_station`.

- **Fitting:** by maximum likelihood on in-sample events, using the bucket that resolved
  Yes as an interval (`[a − 0.5, b + 0.5]`, open-ended for "or higher"/"or below").
  Highest and lowest are fitted separately. A station with fewer than 15 in-sample events
  uses the pooled bias and σ for its kind (highest or lowest).
- **Market probability:** P(observed falls in this market's bucket).
- **Combined:** logistic regression on logit(market price) and logit(model probability),
  fitted in-sample. This is the forecast the strategy uses.

## Instrument checks — run first; any failure voids the result

1. **The forecast tracks reality.** In-sample, the pooled σ for highs must be under 3°C
   (a working 2-day forecast is usually 1.5–2.5°C).
2. **No hidden lookahead.** For a sample of 20 station-days, `previous_day2` must differ
   from the Historical Forecast API's value for the same hours. If they are identical,
   the "previous run" is not a previous run.
3. **Shuffle.** Forecasts are reassigned to a random other date at the same station
   (out-of-sample rows, seed 20261004). The combined model must **not** beat the market on
   Brier (interval includes or falls below zero).

## Split and costs

**60/40 by date** across the window, with all events on one date on the same side.

Cost of a $1 bet bought at the decision price: the fee from the market's `feeSchedule`
(`fee = C × p × rate × (p(1 − p))^exponent`, `PREREG-JEV-POLYMARKET.md` amendment 1)
plus a half-spread. **Primary half-spread: 2 cents.** These markets are thinner than the
general population, so the 1 cent used there is too generous. Also reported at 1 cent
and 4 cents. Held to resolution.

## Strategy

Buy YES when the combined probability exceeds the full YES cost; buy NO when
(1 − probability) exceeds the full NO cost; otherwise skip. $1 per bet.

## What decides it (out of sample; Bonferroni over two: the 1.25th percentile must be > 0)

Block bootstrap over 3-day blocks of dates (cities on the same day share weather regimes
and the same traders).

**YES only if both hold:**
1. **Information:** combined Brier is lower than the market's.
2. **Money:** profit per dollar staked, at a 2-cent half-spread, is above zero.

**Reported, not deciding:** model alone vs market; results at 1 and 4 cents; highs vs
lows; °C vs °F; bets per day; profit by city.

## If YES — before any money moves

1. **Paper, forward, 14 days.** Live order books: the real best ask at decision time,
   the real depth for a $2 order, settled on resolution. This is the test that counts;
   the backtest only earns the right to run it.
2. Then live with **$50 of the $200**, $1–2 per bet, at most $10 on any one date, stopped
   at a 20% drawdown. Check Polymarket's eligibility rules for your location first.

## Budget

No paid APIs. Roughly 50 forecast requests and 5,000 price requests.
