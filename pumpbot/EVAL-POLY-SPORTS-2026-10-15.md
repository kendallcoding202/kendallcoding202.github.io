# Polymarket sports tests — evaluation at day 5.9 (2026-10-15)

Exploratory review before the stop, at the user's request. **Not the verdict**: each test's
verdict is taken once, automatically, at its stop (Test A 2026-10-16 ~16:22 UTC, Test B
~17:09 UTC: 7 days after each test's first record) and frozen. Nothing here changes the
rules, the stop or the verdict test.

Data: the dashboard export of 2026-10-15 12:48 UTC, kept at
`data/polysports/export-2026-10-15T1248.jsonl.gz`. Report below produced by
`node research/polysports-eval.mjs data/polysports/export-2026-10-15T1248.jsonl.gz --verify 40`.

## What the data says

1. **The data is sound.** 40 settled bets re-read from Polymarket: 40 agree. No partial
   fills, no prices outside 2–20¢, every fee matches the formula, no duplicates, nothing
   untagged.
2. **Buying the long shot loses heavily.** Test A −40.6% per $1 [−44.2%, −37.0%], Test B
   −32.3% [−42.9%, −20.7%]. Both ranges are far below zero; no final day can rescue them.
   Every price band, sport and bet type with a meaningful sample is negative.
3. **The market is right at its midpoint.** On bets whose book had a bid, the long shot won
   5.95% against a midpoint of 6.1¢ (Test A) and 9.35% against 9.6¢ (Test B). The rule paid
   the ask (7.8¢, 12.4¢), i.e. half the bid–ask spread above fair value, plus a 4% fee.
   Books with **no bid at all** were far worse: 2,107 Test A bets won 1.0% at 7.8¢ paid.
4. **Betting the other side (the "mirror") loses too.** Polymarket's two books mirror each
   other (the other side's ask = 1 − this side's bid; checked on live books 2026-10-15), so
   each bet's recorded best bid prices the opposite bet exactly: Test A −1.8% per $1
   [−2.1%, −1.5%], Test B −3.0% [−4.6%, −1.6%]; worse with fills 1¢ worse. A taker loses
   the half-spread and the fee whichever side they buy. **No forward test of the mirror is
   justified.** It fails on the very data that suggested it.
5. **The Watch list's +13.9%** is one college football game (Iowa vs Washington, +$146.84
   of +$29.61 overall); without it, the other six matches lost. Seven matches is luck.
6. **Calibration rows above ~35¢ measure empty books, not prices.** For example, Test A
   asks at 90–99¢ came true 14.8%. In a two-way market, a *cheaper* side above 50¢ means both
   sides are offered above 50¢. The rule's own 2–20¢ range is unaffected (all real, full
   fills).

**What is left.** In this data, the one position that earns is the one that *posts* the
prices: the market maker, who is paid the spread that both takers lose. That is a
different strategy (resting limit orders, inventory, being filled mostly when the other
trader knows more). This export cannot measure it, because it cannot say which resting
orders would have been filled. It would need its own registered forward test, recording
trades after each quote.

---

## Full report
Export 2026-10-15T12:48:45.745Z · 19037 bets · 73523 other settled markets (calibration). Ranges resample whole matches.

### Test A · Yes/No
Always bets YES, at 2–20¢, on Yes/No sports markets — mostly soccer (exact scores, who wins), plus baseball, golf and others.

- Running since 2026-10-09T16:22:03.968Z (5.9 days) · markets scanned 41119 · bets 12387 · settled 10650 · still open 1737

#### Headline
| | |
|---|---|
| Record | 530 won · 10120 lost on 551 matches |
| Net (paper) | −$9040.90 on $22270.47 staked |
| **Profit per $1, after fees** | **-40.6%** — plausible range -44.2% to -37.0% |
| Profit per $1, before fees | -37.9% [-41.6%, -34.1%] |
| Fees | $970.47 = 4.4% of the money staked |
| Won vs paid | won 4.98% of the time, at an average price of 7.8¢ → below the price by -2.81 points |
| If every fill were 1¢ worse | -49.1% [-52.2%, -46.0%] |
| If the market's prices were exactly right | -4.4% (you lose the fee) |

**Read:** behind so far; the registered test would be NO if it stopped on these bets (YES needs the whole range above zero). Before fees the rule is clearly behind — i.e. cheap contracts did not win more often than their price said.

#### Where the fair price sits, and betting the other side
| | |
|---|---|
| Bets with a bid on the book | 8543: the long shot won **5.95%**; best bid 4.4¢, midpoint 6.1¢, ask paid 7.8¢ |
| Bets with no bid at all | 2107: won 1.04% at 7.8¢ paid |
| Bet the other side instead, at 1 − the bid | -1.8% per $1 after fees [-2.1%, -1.5%] · −$304.71 |
| … with fills 1¢ worse | -2.6% [-2.9%, -2.2%] |

**Read:** the long shot came in close to the midpoint of the book. Betting the other side loses too: whichever side a taker buys, they pay half the spread plus the fee. (Exploratory: chosen after seeing this data.)

#### By price paid
| slice | bets | matches | won vs paid | per $1 before fees | per $1 after fees [95% range] | net |
|---|---|---|---|---|---|---|
| 2–5¢ | 3310 | 405 | 2.2% vs 3.5¢ | -37.3% | -40.1% [-52.8%, -27.0%] | −$2783.89 |
| 5–10¢ | 4479 | 486 | 4.0% vs 7.3¢ | -45.3% | -47.7% [-54.2%, -40.8%] | −$4471.37 |
| 10–15¢ | 1914 | 492 | 8.9% vs 11.6¢ | -24.1% | -27.3% [-36.6%, -18.1%] | −$1088.47 |
| 15–20¢ | 947 | 397 | 11.5% vs 17.4¢ | -32.8% | -35.4% [-46.9%, -23.5%] | −$697.17 |

#### By sport
| slice | bets | matches | won vs paid | per $1 before fees | per $1 after fees [95% range] | net |
|---|---|---|---|---|---|---|
| Soccer | 10266 | 524 | 4.9% vs 7.8¢ | -38.4% | -41.1% [-44.6%, -37.5%] | −$8831.22 |
| NFL | 319 | 14 | 7.2% vs 8.9¢ | -18.6% | -20.7% [-52.0%, +11.2%] | −$135.89 |
| Golf | 54 | 3 | 3.7% vs 5.1¢ | -42.3% | -45.0% [-100.0%, +59.1%] | −$50.86 |
| Combat sports | 5 | 5 | 0.0% vs 16.3¢ | -100.0% | -100.0% [-100.0%, -100.0%] | −$10.42 |
| Baseball | 4 | 3 | 0.0% vs 17.2¢ | -100.0% | -100.0% [-100.0%, -100.0%] | −$8.33 |
| Other | 2 | 2 | 0.0% vs 6.3¢ | -100.0% | -100.0% [-100.0%, -100.0%] | −$4.19 |

#### By bet type
| slice | bets | matches | won vs paid | per $1 before fees | per $1 after fees [95% range] | net |
|---|---|---|---|---|---|---|
| Exact score | 9479 | 482 | 4.5% vs 7.3¢ | -39.5% | -42.2% [-45.6%, -38.5%] | −$8361.81 |
| Other | 330 | 24 | 7.0% vs 9.1¢ | -21.3% | -23.4% [-52.4%, +7.2%] | −$158.82 |
| Moneyline | 321 | 190 | 10.9% vs 12.9¢ | -21.0% | -24.3% [-48.8%, +4.3%] | −$163.04 |
| First to score | 270 | 259 | 3.7% vs 7.6¢ | -48.6% | -50.9% [-79.6%, -16.1%] | −$287.50 |
| Half result | 193 | 180 | 14.5% vs 16.0¢ | -8.9% | -12.6% [-43.3%, +20.1%] | −$50.48 |
| Both teams to score | 57 | 57 | 15.8% vs 17.9¢ | -12.8% | -16.2% [-63.1%, +38.1%] | −$19.24 |

#### By kickoff day (UTC)
| slice | bets | matches | won vs paid | per $1 before fees | per $1 after fees [95% range] | net |
|---|---|---|---|---|---|---|
| 2026-10-10 | 2543 | 123 | 5.3% vs 7.5¢ | -36.4% | -39.2% [-45.8%, -32.4%] | −$2088.54 |
| 2026-10-11 | 4508 | 242 | 5.1% vs 8.0¢ | -42.1% | -44.6% [-49.6%, -39.2%] | −$4203.64 |
| 2026-10-12 | 1193 | 62 | 4.5% vs 8.1¢ | -41.8% | -44.4% [-55.7%, -31.9%] | −$1107.39 |
| 2026-10-13 | 912 | 60 | 4.7% vs 7.6¢ | -30.7% | -33.7% [-45.5%, -20.9%] | −$642.84 |
| 2026-10-14 | 1121 | 50 | 4.7% vs 7.3¢ | -25.3% | -28.6% [-40.5%, -16.6%] | −$670.79 |
| 2026-10-15 | 373 | 14 | 4.3% vs 7.5¢ | -39.3% | -42.0% [-60.1%, -19.3%] | −$327.70 |

#### Concentration
- 551 matches; the 5 best contributed +$230.29 of the −$9040.90 total.
  - pumas de la unam vs. cf cruz azul|2026-10-11 — 35 bets, +$60.06
  - raiders vs. patriots|2026-10-11 — 23 bets, +$58.87
  - grazer ak 1902 vs. fc salzburg|2026-10-10 — 24 bets, +$42.97
  - silkeborg if vs. ac horsens|2026-10-11 — 23 bets, +$35.22
  - fc slovan liberec vs. 1. fc slovácko|2026-10-11 — 20 bets, +$33.16
- Without those 5 matches: -42.1% per $1 [-45.6%, -38.8%].
- Worst matches: korn ferry tour: korn ferry tour championship winner (31 bets, −$64.97); sport lisboa e benfica vs. vitória sc (36 bets, −$60.69); gwangju fc vs. ulsan hd fc (28 bets, −$58.59).

#### Calibration — did prices match reality? (34117 settled markets, real $2 fills)
| price | markets | avg price | came true |
|---|---|---|---|
| 2–5¢ | 3310 | 3.5¢ | 2.2% |
| 5–10¢ | 4479 | 7.3¢ | 4.0% |
| 10–20¢ | 2743 | 13.3¢ | 9.8% |
| 20–35¢ | 2996 | 27.3¢ | 17.0% |
| 35–50¢ | 5289 | 43.6¢ | 15.3% |
| 50–65¢ | 2092 | 55.6¢ | 29.0% |
| 65–80¢ | 4798 | 74.0¢ | 7.5% |
| 80–90¢ | 1916 | 81.0¢ | 12.4% |
| 90–99¢ | 2479 | 96.5¢ | 14.8% |

Prices here are asks. Above about 35¢ the rows are mostly books with no real quote on one side (in a two-way market, a *cheaper* side above 50¢ means both sides are offered above 50¢), so they measure empty books, not prices. The rule's 2–20¢ bets all filled at real asks.

#### Data checks
- Resolution prices seen: 1 ×530, 0 ×10120.
- Fills: 0 not fully filled (should be 0); prices outside 2–20¢: 0 (should be 0).
- Fees: 0 bets whose fee does not match the formula at a 3–7% rate (should be 0).
- Duplicate bet ids: 0 (should be 0). Untagged: 0.

### Test B · Two-way
Bets the cheaper side, at 2–20¢, of two-way markets: Over or Under a line, a team to cover a spread, or a team to win.

- Running since 2026-10-09T17:09:18.086Z (5.8 days) · markets scanned 60725 · bets 6546 · settled 5642 · still open 904

#### Headline
| | |
|---|---|
| Record | 507 won · 5134 lost · 1 void on 534 matches |
| Net (paper) | −$3784.54 on $11727.55 staked |
| **Profit per $1, after fees** | **-32.3%** — plausible range -42.9% to -20.7% |
| Profit per $1, before fees | -29.6% [-40.7%, -17.6%] |
| Fees | $443.55 = 3.8% of the money staked |
| Won vs paid | won 9.00% of the time, at an average price of 12.4¢ → below the price by -3.36 points |
| If every fill were 1¢ worse | -38.4% [-48.0%, -27.9%] |
| If the market's prices were exactly right | -3.8% (you lose the fee) |

**Read:** behind so far; the registered test would be NO if it stopped on these bets (YES needs the whole range above zero). Before fees the rule is clearly behind — i.e. cheap contracts did not win more often than their price said.

#### Where the fair price sits, and betting the other side
| | |
|---|---|
| Bets with a bid on the book | 5407: the long shot won **9.35%**; best bid 6.8¢, midpoint 9.6¢, ask paid 12.4¢ |
| Bets with no bid at all | 235: won 0.85% at 12.1¢ paid |
| Bet the other side instead, at 1 − the bid | -3.0% per $1 after fees [-4.6%, -1.6%] · −$326.00 |
| … with fills 1¢ worse | -4.0% [-5.5%, -2.5%] |

**Read:** the long shot came in close to the midpoint of the book. Betting the other side loses too: whichever side a taker buys, they pay half the spread plus the fee. (Exploratory: chosen after seeing this data.)

#### By price paid
| slice | bets | matches | won vs paid | per $1 before fees | per $1 after fees [95% range] | net |
|---|---|---|---|---|---|---|
| 2–5¢ | 428 | 141 | 1.9% vs 3.5¢ | -52.5% | -54.7% [-83.1%, -19.8%] | −$489.95 |
| 5–10¢ | 1486 | 394 | 5.5% vs 7.8¢ | -30.2% | -33.1% [-51.2%, -13.0%] | −$1025.90 |
| 10–15¢ | 1692 | 446 | 8.8% vs 12.5¢ | -29.9% | -32.5% [-46.6%, -17.2%] | −$1140.73 |
| 15–20¢ | 2036 | 489 | 13.2% vs 17.4¢ | -24.1% | -26.7% [-37.7%, -15.3%] | −$1127.96 |

#### By sport
| slice | bets | matches | won vs paid | per $1 before fees | per $1 after fees [95% range] | net |
|---|---|---|---|---|---|---|
| Soccer | 4093 | 421 | 8.7% vs 11.7¢ | -28.5% | -31.5% [-42.6%, -19.6%] | −$2693.85 |
| College football | 865 | 69 | 10.1% vs 14.3¢ | -28.0% | -29.8% [-66.5%, +17.8%] | −$528.33 |
| NFL | 615 | 16 | 8.6% vs 13.6¢ | -43.1% | -44.5% [-73.4%, -9.4%] | −$561.41 |
| Baseball | 43 | 6 | 14.0% vs 12.7¢ | +6.4% | +2.0% [-54.5%, +68.2%] | +$1.77 |
| Esports | 17 | 13 | 20.6% vs 15.3¢ | +22.0% | +17.0% [-63.9%, +85.9%] | +$6.03 |
| Hockey | 6 | 6 | 16.7% vs 19.8¢ | -16.7% | -19.9% [-100.0%, +140.4%] | −$2.48 |
| Other | 1 | 1 | 0.0% vs 12.0¢ | -100.0% | -100.0% [-100.0%, -100.0%] | −$2.09 |
| Tennis | 1 | 1 | 0.0% vs 10.0¢ | -100.0% | -100.0% [-100.0%, -100.0%] | −$2.09 |
| Combat sports | 1 | 1 | 0.0% vs 17.0¢ | -100.0% | -100.0% [-100.0%, -100.0%] | −$2.08 |

#### By bet type
| slice | bets | matches | won vs paid | per $1 before fees | per $1 after fees [95% range] | net |
|---|---|---|---|---|---|---|
| Over/under | 2643 | 495 | 8.6% vs 12.2¢ | -32.1% | -34.7% [-46.0%, -22.3%] | −$1911.37 |
| Spread | 2089 | 430 | 9.2% vs 11.9¢ | -27.5% | -30.1% [-47.2%, -9.5%] | −$1303.21 |
| Team total O/U | 679 | 176 | 8.2% vs 13.7¢ | -33.6% | -36.3% [-57.2%, -12.4%] | −$512.89 |
| Corners | 86 | 43 | 11.6% vs 15.5¢ | -25.8% | -28.8% [-70.6%, +23.3%] | −$51.63 |
| Other | 78 | 20 | 15.4% vs 13.1¢ | -9.7% | -12.1% [-61.1%, +52.1%] | −$19.36 |
| Player prop | 34 | 3 | 8.8% vs 11.5¢ | -19.0% | -22.4% [-100.0%, +19.0%] | −$15.93 |
| Moneyline | 33 | 33 | 22.7% vs 14.0¢ | +48.5% | +43.8% [-42.6%, +147.3%] | +$29.85 |

#### By kickoff day (UTC)
| slice | bets | matches | won vs paid | per $1 before fees | per $1 after fees [95% range] | net |
|---|---|---|---|---|---|---|
| 2026-10-10 | 1626 | 162 | 8.8% vs 13.0¢ | -33.6% | -35.9% [-58.3%, -9.3%] | −$1208.59 |
| 2026-10-11 | 2236 | 200 | 8.1% vs 12.6¢ | -38.6% | -40.9% [-55.4%, -25.0%] | −$1900.54 |
| 2026-10-12 | 512 | 55 | 11.3% vs 11.9¢ | -11.0% | -14.6% [-47.5%, +20.6%] | −$155.59 |
| 2026-10-13 | 510 | 43 | 7.8% vs 11.1¢ | -32.2% | -34.9% [-62.9%, -1.6%] | −$371.25 |
| 2026-10-14 | 550 | 57 | 12.7% vs 11.4¢ | +9.3% | +4.7% [-36.8%, +51.0%] | +$54.25 |
| 2026-10-15 | 208 | 17 | 7.2% vs 11.8¢ | -44.4% | -46.7% [-81.7%, -5.4%] | −$202.81 |

#### Concentration
- 534 matches; the 5 best contributed +$829.59 of the −$3784.54 total.
  - buffalo vs. toledo|2026-10-10 — 28 bets, +$293.76
  - south carolina vs. florida|2026-10-10 — 14 bets, +$158.13
  - lask linz vs. liverpool fc|2026-10-14 — 14 bets, +$143.61
  - st. louis city sc vs. los angeles galaxy|2026-10-11 — 21 bets, +$127.59
  - bears vs. packers|2026-10-11 — 36 bets, +$106.49
- Without those 5 matches: -40.1% per $1 [-48.8%, -31.2%].
- Worst matches: ravens vs. falcons (52 bets, −$106.70); vikings vs. saints (46 bets, −$94.38); browns vs. jets (43 bets, −$88.19).

#### Calibration — did prices match reality? (51233 settled markets, real $2 fills)
| price | markets | avg price | came true |
|---|---|---|---|
| 2–5¢ | 428 | 3.5¢ | 1.9% |
| 5–10¢ | 1486 | 7.8¢ | 5.5% |
| 10–20¢ | 3513 | 14.9¢ | 11.0% |
| 20–35¢ | 6693 | 27.4¢ | 21.1% |
| 35–50¢ | 7651 | 42.4¢ | 35.3% |
| 50–65¢ | 4054 | 54.9¢ | 31.5% |
| 65–80¢ | 2046 | 71.5¢ | 28.3% |
| 80–90¢ | 1634 | 85.5¢ | 22.5% |
| 90–99¢ | 16044 | 96.6¢ | 28.7% |

Prices here are asks. Above about 35¢ the rows are mostly books with no real quote on one side (in a two-way market, a *cheaper* side above 50¢ means both sides are offered above 50¢), so they measure empty books, not prices. The rule's 2–20¢ bets all filled at real asks.

#### Data checks
- Resolution prices seen: 0 ×5134, 1 ×507, 0.5 ×1.
- Fills: 0 not fully filled (should be 0); prices outside 2–20¢: 0 (should be 0).
- Fees: 0 bets whose fee does not match the formula at a 3–7% rate (should be 0).
- Duplicate bet ids: 0 (should be 0). Untagged: 0.

### Watch · soon (watch list — not a test)
Games kicking off too soon for the tests (hockey and college football): the same 2–20¢ rule at the same real prices and fees, with wins and losses shown as they come in. Not part of either test.

- Running since 2026-10-09T18:04:16.110Z (5.8 days) · markets scanned 1217 · bets 104 · settled 104 · still open 0

#### Headline
| | |
|---|---|
| Record | 17 won · 87 lost on 7 matches |
| Net (paper) | +$29.61 on $213.42 staked |
| **Profit per $1, after fees** | **+13.9%** — plausible range -94.6% to +155.6% |
| Profit per $1, before fees | +16.8% [-94.5%, +162.3%] |
| Fees | $5.42 = 2.5% of the money staked |
| Won vs paid | won 16.35% of the time, at an average price of 13.7¢ → above the price by 2.69 points |
| If every fill were 1¢ worse | +5.5% [-95.0%, +135.7%] |
| If the market's prices were exactly right | -2.5% (you lose the fee) |

**Read:** ahead so far; the registered test would be NO if it stopped on these bets (YES needs the whole range above zero). Before fees the rule is indistinguishable from break-even — i.e. cheap contracts may or may not win more often than their price said.

#### Where the fair price sits, and betting the other side
| | |
|---|---|
| Bets with a bid on the book | 100: the long shot won **17.00%**; best bid 9.2¢, midpoint 11.5¢, ask paid 13.7¢ |
| Bets with no bid at all | 4: won 0.00% at 11.9¢ paid |
| Bet the other side instead, at 1 − the bid | -8.9% per $1 after fees [-31.4%, +9.0%] · −$17.82 |
| … with fills 1¢ worse | -9.9% [-32.2%, +7.8%] |

**Read:** the long shot came in above the midpoint of the book. Betting the other side is indistinguishable from break-even. (Exploratory: chosen after seeing this data.)

#### By price paid
| slice | bets | matches | won vs paid | per $1 before fees | per $1 after fees [95% range] | net |
|---|---|---|---|---|---|---|
| 2–5¢ | 0 | | | | | |
| 5–10¢ | 24 | 6 | 8.3% vs 8.1¢ | -1.6% | -4.3% [-100.0%, +102.7%] | −$2.10 |
| 10–15¢ | 33 | 5 | 12.1% vs 12.2¢ | +2.8% | +0.1% [-100.0%, +154.1%] | +$0.08 |
| 15–20¢ | 47 | 7 | 23.4% vs 17.5¢ | +36.2% | +32.8% [-88.2%, +189.2%] | +$31.63 |

#### By sport
| slice | bets | matches | won vs paid | per $1 before fees | per $1 after fees [95% range] | net |
|---|---|---|---|---|---|---|
| College football | 103 | 6 | 16.5% vs 13.6¢ | +18.0% | +15.0% [-93.6%, +157.7%] | +$31.69 |
| Hockey | 1 | 1 | 0.0% vs 20.0¢ | -100.0% | -100.0% [-100.0%, -100.0%] | −$2.08 |

#### By bet type
| slice | bets | matches | won vs paid | per $1 before fees | per $1 after fees [95% range] | net |
|---|---|---|---|---|---|---|
| Over/under | 53 | 7 | 17.0% vs 13.4¢ | +19.8% | +16.7% [-100.0%, +159.9%] | +$18.16 |
| Spread | 48 | 6 | 14.6% vs 13.7¢ | +10.5% | +7.7% [-100.0%, +144.2%] | +$7.60 |
| Team total O/U | 3 | 3 | 33.3% vs 17.7¢ | +66.7% | +62.7% [-100.0%, +388.3%] | +$3.85 |

#### By kickoff day (UTC)
| slice | bets | matches | won vs paid | per $1 before fees | per $1 after fees [95% range] | net |
|---|---|---|---|---|---|---|
| 2026-10-09 | 19 | 3 | 15.8% vs 15.2¢ | -3.5% | -6.0% [-100.0%, +56.2%] | −$2.33 |
| 2026-10-10 | 85 | 4 | 16.5% vs 13.3¢ | +21.4% | +18.3% [-100.0%, +184.6%] | +$31.94 |

#### Concentration
- 7 matches; the 5 best contributed +$107.58 of the +$29.61 total.
  - iowa vs. washington|2026-10-09 — 29 bets, +$146.84
  - columbia vs. marist|2026-10-09 — 4 bets, +$4.61
  - penguins vs. blue jackets|2026-10-09 — 1 bets, −$2.08
  - florida state vs. louisville|2026-10-09 — 14 bets, −$4.86
  - washington state vs. utah state|2026-10-09 — 18 bets, −$36.93
- Without those 5 matches: -100.0% per $1 [-100.0%, -100.0%].
- Worst matches: iowa state vs. byu (19 bets, −$39.00); wyoming vs. san jose state (19 bets, −$38.97); washington state vs. utah state (18 bets, −$36.93).

#### Calibration — did prices match reality? (1201 settled markets, real $2 fills)
| price | markets | avg price | came true |
|---|---|---|---|
| 5–10¢ | 24 | 8.1¢ | 8.3% |
| 10–20¢ | 72 | 14.8¢ | 16.7% |
| 20–35¢ | 163 | 27.5¢ | 23.9% |
| 35–50¢ | 305 | 43.2¢ | 42.1% |
| 50–65¢ | 103 | 54.2¢ | 35.9% |
| 65–80¢ | 32 | 69.8¢ | 50.0% |
| 80–90¢ | 16 | 85.6¢ | 50.0% |
| 90–99¢ | 301 | 97.6¢ | 37.9% |

Prices here are asks. Above about 35¢ the rows are mostly books with no real quote on one side (in a two-way market, a *cheaper* side above 50¢ means both sides are offered above 50¢), so they measure empty books, not prices. The rule's 2–20¢ bets all filled at real asks.

#### Data checks
- Resolution prices seen: 0 ×87, 1 ×17.
- Fills: 0 not fully filled (should be 0); prices outside 2–20¢: 0 (should be 0).
- Fees: 0 bets whose fee does not match the formula at a 3–7% rate (should be 0).
- Duplicate bet ids: 0 (should be 0). Untagged: 0.

### Outcome check against Polymarket
- Re-read 40 settled bets: 40 agree, 0 disagree, 0 not returned.
