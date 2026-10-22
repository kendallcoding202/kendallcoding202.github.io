# Test C (maker) — evaluation at day 7.3 (2026-10-22)

Data: the dashboard export of 2026-10-22 20:44 UTC, kept at
`data/polysports/export-2026-10-22T2044.jsonl.gz`. The registered stop (7 days and 300
matches) was met at day 7.3 with 1,227 matches. The server freezes the verdict at its daily
check, 00:00 UTC on 2026-10-23. **This is a preview of that freeze from data 3 hours older.**
The missing 3 hours (about 200 fills, 1.6% more) cannot change it (see below). Confirm it
against a post-freeze export. Report: `node research/polymaker-eval.mjs <export>`.

The review had six independent analyses, each checked by an adversarial verifier, plus a
completeness critic (13 agents). Every number below was reproduced by at least two
independent implementations.

## The verdict

**Registered verdict (what the code freezes): INCONCLUSIVE.** The touch rule, meant to be
the cautious fill rule, scored the cheaper side better than the main trade rule: +48.6% vs
+4.6% corrected markout per $1. The gap is +44 points, 98.75% [+37, +51], in 4,000 of 4,000
bootstrap draws and on all 7 kickoff days. The pre-registration says that makes the touch
rule mis-specified and the result INCONCLUSIVE.

**In substance: NO. Neither side made money, whatever the touch rule did.** With the touch
check set aside, each side still fails YES conditions that do not involve the touch rule:

| condition (all must hold for YES) | cheaper (< 50¢) | dearer (≥ 50¢) |
|---|---|---|
| trade-rule markout, 98.75% lower end > 0 | +1.5% ✓ (but see the stub marks below) | −4.0% ✗ |
| touch-rule markout, 98.75% lower end > 0 | +41.3% ✓ (mis-specified rule) | −5.5% ✗ |
| trade-rule real outcome ≥ 0 | **−3.0%** ✗ | **−2.4%** ✗ |
| guard (fills vs their own kickoff price), not reliably negative | **−7.7%, upper end −1.6%** ✗ | +0.7% ✓ |
| touch not kinder than trade | ✗ (INCONCLUSIVE) | ✓ on the registered markout |

Pooled real outcome of the 12,463 settled trade-rule fills: **−2.6% per $1 [−4.2%, −1.0%]**
(−$891 on $34,663 of paper fills). No reading of the pre-registration gives YES, so there is
no live step.

How the label should be recorded: the code makes the whole test INCONCLUSIVE when one side
trips the touch check. The pre-registration decides each side separately (PREREG lines
168, 177–178). Read per side: **cheaper INCONCLUSIVE** (and failing real outcome and the
guard anyway), **dearer NO**.

## Why the touch rule scored better (mis-specified on both sides)

- **'Bid gone' is book flicker, not a pick-off.** 2,245 cheaper touch fills, median price
  3¢, mostly a lone 1¢ bid on a long shot being cancelled for a minute. No seller ever
  came: only 13 of them match a trade-rule fill. They supply 73% of the touch rule's cheaper
  markout.
- **'Price fell' dips are mostly not adverse.** On the cheaper side these fills resolved in
  line with the midpoint when the order was placed (+0.4%).
- **A touch fills the whole order**, and the first order with any evidence wins. So the
  touch rule picks up non-adverse fills on wide, cheap books that the trade rule never gets.
- **Kickoff midpoints of exactly 50¢ are common (stub books).** 3,792 of 42,958
  calibration games (8.8%) have this midpoint, 10× any neighbouring value. Outcome 0 of
  those games won only 40.3%. The fresh-mark test accepts any two-sided read, and the
  calibration cannot correct these games: both outcomes land in the 50–55¢ band and cancel.
- **After fixing both artifacts**, the touch rule still beats the trade rule: cheaper +7.8
  points [+5.6, +10.4] (fills under 5¢ dropped, 50¢ marks scored on result), dearer +1.2
  [+0.5, +1.9]. It also wins on real outcomes on both sides: cheaper +24.7% vs −3.0%, dearer
  +1.2% vs −2.4%. So the INCONCLUSIVE is substantive, not a fluke, and any rerun would need
  a new pessimistic rule. Design for the record:
  - no fill from 'bid gone' or a cleared book;
  - a 'price fell' that persists over two reads on a book still ≤ 10¢ wide;
  - value it at the midpoint at the touch;
  - compare paired per-order values, not ratios over different fill sets.

## Why resting orders lost

- **Favourites (dearer side, 74% of the money): informed selling.** The order captured
  +1.1% per $1 of spread (0.8¢/share). The midpoint then fell about 3.0% (2.6× the spread,
  50¢ stub marks removed) before kickoff. Wider spreads do not help: the adverse move grows
  with the spread (−2.4¢ at 3¢ to −4.9¢ at 6–10¢). Quoting only more than 6 h before kickoff:
  −3.2%. To break even the dearer side needs about 2 more ticks of edge per fill. The maker
  rebate is worth +0.3% per $1 at most.
- **A check that needs no model:** in the 2,164 markets where both outcomes filled, the pair
  locked in a loss. That is −0.90¢ per matched share [−1.07, −0.72], weighted by shares (the
  simple mean is −0.57¢, the median 0). The second leg filled on average 2.5¢ worse than the
  first leg's quote implied.
- **Long shots (cheaper side): the positive markout is not money.** Part of it rests on 50¢
  stub marks: score those 204 fills on their result and the 98.75% interval becomes +3.0%
  [−0.4%, +6.6%]. One tick dearer, which is what a visible order faces, gives +0.2%. Filled
  long shots won less than their kickoff price implied (20 wins against 38.7 expected at
  2–10¢), so real P&L was −3.0%.
- **Prices after the fill** drift against us before kickoff, about −1% per $1 within the
  hour. Note: the dashboard's after-fill prices included in-play prices (21% of the 60-minute
  prices were after kickoff). The evaluator now leaves those out.

## Data integrity

- **The deciding numbers are right.** Two independent re-implementations, without the
  project code, match the evaluator on every cell and on the 20-band calibration table. The
  repository's own `makerSummary` gives the same INCONCLUSIVE at 00:00:40 UTC.
- **The fill replay is sound:**
  - Paging over the trade feed reconciles exactly (4,449 requests = stats.tradeCalls).
  - The 20-game batching drops nothing.
  - The re-read audit changed 0 of 2,064 games.
  - classify() is right on all 32 sampled maker records (bid hit, mint, ask lift, merge).
  - Measurable biases are small (≤ 0.5 points) and none changes a sign. They are the 60 s
    lag tail (512 fills), the dearest-overlap rule, and crossings sized as the full order.
- **Protocol deviation:** the registered feed validation (PREREG lines 132–138) was not met,
  and no amendment was made before the first replay.
  - The v2 trade feed ignores start/end. This is harmless: the client reads the whole
    history.
  - It gives one record per taker order. A multi-level sweep was never observed, so
    whether the price is averaged is unknown.
  - The likely effect is to make the paper result *more* optimistic, not less.
- **Smaller code-vs-text gaps, none decisive:**
  - the guard's bootstrap uses 1,000 draws, not 4,000 (its upper end −1.6% becomes −2.0%);
  - the frozen string names only the cheaper side;
  - the server never exported the order log, so the registered $200 ledger cannot be
    computed from the export.
- **Most of the sample is one weekend.** Saturday and Sunday kickoffs hold 63% of
  trade-rule fills. The pooled markout was negative on 6 of 7 kickoff days, so the loss is
  not a weekend artifact. Slice findings are fragile, though.

## Exploratory leads (not results; each needs its own registered test)

| slice | markout | real outcome | caveat |
|---|---|---|---|
| Corners (soccer, both sides) | +2.3% [+0.3, +4.4] | +4.1% [−2.2, +10.6] | Holm p 0.14; gone one tick dearer; real P&L falls to +$21 without its top 3 matches |
| cheaper, 4–5¢ spread | +6.2% [+2.2, +10.6] | +5.9% [−5.3, +17.4] | the touch rule scores it better; +$11 without its top 3 matches |
| cheaper, 10–30¢ | +8.7% | +1.2% [−9.6, +12.2] | +3.3% one tick dearer; guard −7.2% |

On real outcomes, 84 slices were searched. None is positive after a Holm correction, and
discovery-half rankings did not carry over to the later games. Confirming Corners on real
outcomes would take about 1–1.5 months of data, at half the effect size about 4–6 months.

## What $200 would have done

Under this rule, a $200 account could take only about 6% of the paper fills. Capital is
locked about 14 h from fill to settlement. That gives an expected loss of about **−$2 to
−$10 a day (about −$43 a week, range −$70 to −$15)**, with swings of 40–80% of the bankroll
from a handful of long-shot results. Replaying the week in time order realised −$16
(−$84 dearer only, −$64 cheaper only).

## Where it could be traded (research 2026-10-22; check before relying on it)

The server's geoblock answer was **blocked, US / California**. US persons may not open
positions on Polymarket International (close-only or blocked; sources conflict on which).
So this test, on Polymarket International books, only ever spoke for a non-US user.

| venue | for whom | makers pay | takers pay | small-account maker income | bot API |
|---|---|---|---|---|---|
| Polymarket International | non-restricted countries | 0 | 0.05·p(1−p) on most sports (0.03 on some; NBA games fee-free) | 15–25% of taker fees, per market | yes |
| Polymarket US (CFTC) | KYC'd US residents, most states (list unconfirmed; not NV) | 0 | 0.0695·p(1−p) | rebate is 0 under $10M/month since Oct 19, 2026; a liquidity program found only for approved participants | yes (Retail API, orders flagged automatic) |
| Kalshi (CFTC) | US (not NV/MI for sports; WA restricted) and countries outside its 55 restricted ones | 0.0175·p(1−p) on the main game series; fees round up to the cent | 0.07·p(1−p) | Liquidity Incentive Program: pools per sub-category from Oct 28, ending by Jan 1, 2027 | yes (own trading) |

Kalshi's main game books mostly have spreads of 2¢ or less, outside this test's 3–10¢ rule.

## Conclusion

Making markets on Polymarket sports with a slow, public-information bot does not pay:
- the flow that reaches a bid+1¢ order is informed enough to take more than the spread;
- the one side that looked positive did so only against a flawed kickoff price.

With Tests A and B (taking), both sides of the book have now been measured, and both lose.
Stop this strategy rather than re-register it. Any further test needs the user's country
first, then a new hypothesis on that venue's own books and fees.
