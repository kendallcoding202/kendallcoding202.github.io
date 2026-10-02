Snapshot for `PREREG-WEATHER.md`, so the test survives a container restart.

- `population.json.gz` — the 26,452 temperature markets from the Polymarket population
  (description cut to the station reference the runner parses).
- `prices.jsonl.gz` — decision-time prices for those markets.
- `forecasts.json` — Open-Meteo `previous_day2` forecasts for all 51 stations.

To restore: `gunzip -k` both into a directory as `population.json` and `prices.jsonl`,
copy `forecasts.json` to `<outDir>/forecasts.json`, fetch OurAirports'
`airports.csv`, then `node research/weather-test.mjs <dir> airports.csv <outDir>`.
