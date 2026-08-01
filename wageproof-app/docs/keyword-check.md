# The free afternoon: does anyone search for this?

One question, answered for zero dollars, before anything else gets built or
spent. Work top to bottom and fill in `keyword-worksheet.csv` as you go, then
run the scoring script at the end.

Budget about two hours.

---

## 1. Get into Keyword Planner without spending

1. Create a Google Ads account at ads.google.com.
2. It will push you hard toward building a campaign. Look for **"Switch to
   Expert Mode"** — usually a small link at the bottom — then **"Create an
   account without a campaign."** Taking the guided path means entering billing
   details and possibly going live.
3. Once inside: **Tools → Planning → Keyword Planner**.

**Know this before you read a single number.** Without an actively spending
campaign, Google shows search volume as *broad ranges* — `100–1K`, `1K–10K` —
not exact figures. That is enough for a go/no-go call and not enough for
forecasting. Record the range as given; the worksheet expects it.

---

## 2. Configure it correctly

Wrong settings here produce confidently wrong numbers.

- **Location:** United States. Not your city, not "all locations."
- **Language:** English.
- **Network:** Google Search only. Exclude search partners.
- **Date range:** last 12 months.

Construction is seasonal and federal fiscal-year timing moves work around, so a
single month's snapshot misleads. Twelve months is the honest window.

---

## 3. Terms to check

Use **"Discover new keywords" → Start with keywords**, and paste each tier as a
batch. Then use **"Get search volume and forecasts"** for the exact terms in the
worksheet.

### Tier 2 first — this is your market-size proxy

Counter-intuitive, but do this tier first. These are the category terms, and
they are the only ones Keyword Planner measures reliably.

```
certified payroll software
prevailing wage software
davis bacon software
certified payroll reporting
certified payroll service
prevailing wage compliance software
```

### Tier 1 — the terms you would actually bid on

```
certified payroll rejected
wh-347
how to fill out certified payroll
certified payroll fringe benefits
do i have to pay fringe benefits in cash
certified payroll overtime calculation
certified payroll mistakes
wh-347 instructions
certified payroll help
davis bacon fringe benefits
```

### Tier 3 — only meaningful if Tier 2 looks alive

```
lcptracker alternative
certified payroll pro alternative
certified payroll software for small contractors
cheap certified payroll software
```

---

## 4. What to record

For each term, the worksheet wants four things, all visible in the results table:

| Column | Where it comes from |
|---|---|
| `avg_monthly_searches` | The volume range. Enter it as shown: `100-1K`. |
| `competition` | Low / Medium / High. |
| `bid_low` | "Top of page bid (low range)" — strip the `$`. |
| `bid_high` | "Top of page bid (high range)" — strip the `$`. |

Fill in what you find. Leave a row blank if Google reports no data — that is
itself a data point, and the script handles it.

---

## 5. The honest caveat about Tier 1

**Keyword Planner is bad at exactly the terms my strategy recommends.** It
aggregates and suppresses long-tail queries, so `certified payroll rejected`
may come back as `10–100` or as no data at all, even if real people type it
every week.

So do not read a thin Tier 1 as a kill signal. Read it this way instead:

- **Tier 2 volume tells you whether the market exists.** It is the reliable
  measurement, and it is the number the go/no-go rests on.
- **Tier 1 tells you what a cheap entry costs.** If those terms show low
  competition and low bids, the entry strategy is affordable — whether or not
  the reported volume looks impressive.

A market with healthy Tier 2 volume and near-zero measurable Tier 1 volume is
still worth testing. A market with dead Tier 2 volume is not, regardless of what
Tier 1 says.

---

## 6. Score it

```bash
python3 scripts/score_keywords.py docs/keyword-worksheet.csv
```

It prints tier totals, the blended cost per click, and a verdict.

### The metric it actually turns on

The script does not guess at conversion rates, because nobody knows them yet.
It inverts the question instead:

> Given this cost per click, **what share of clicks would have to finish a free
> check** for the cost per completed check to come in under $25?

That threshold comes from `ads.md`. The inversion is useful because the required
rate is checkable against reality, while a projected customer count is not:

| Required completion rate | Read |
|---|---|
| Under 25% | Achievable. A well-matched landing page does this. **Go.** |
| 25–40% | Demanding but not absurd. Worth one careful test. |
| Over 40% | Not realistic. The clicks cost too much for this funnel. **Stop.** |

Those bands are my judgment, not measured fact — a paste-your-payroll tool asks
more of a visitor than an email box, so I would not bet on beating 30%.

### The volume floor, separately

Cheap clicks against a market that does not exist is still a dead end. Tier 2
combined monthly volume:

- **Under 1,000/month** — too thin to carry an ads-primary strategy. Stop.
- **1,000–5,000/month** — real but tight. Ads alone likely will not be enough.
- **Over 5,000/month** — healthy. Proceed to the $1,000 test in `ads.md`.

**Both tests must pass.** Affordable clicks into an empty market fails. A large
market you cannot afford to enter also fails.

---

## 7. What to do with the answer

- **Both pass** → run the $1,000 Tier 1 campaign in `ads.md`. The product and
  the funnel instrumentation are already built and waiting.
- **Volume passes, cost fails** → the market is real but paid search is not the
  way in. That is a genuine finding, and it means reconsidering the channel
  rather than the product.
- **Volume fails** → these contractors do not search. Stop here. The afternoon
  saved you a month, which is the entire point of spending it.

Record what you find at the bottom of the worksheet either way. A negative
result is worth keeping — it is the thing that stops this question being
reopened on a hunch in six months.
