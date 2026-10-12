# Trader Mayne v1.2: results

_11 Oct 2026. Test plan: `TEST_PLAN.md` (written and committed before any result). Krillin confluence: `CONFLUENCE_PLAN.md`._

## Verdict
**No profitable version of the system was found.** 18 rule ideas, 4 gate removals and 5 combinations were tested on
745 coins with realistic fills and costs. The best combination, chosen on 2021–23, lost on 2024–26. Combining the
signals with Krillin's didn't help either.

What that means in practice:
- **Do not trade the ARMED signals mechanically, not even small.** Traded at 1% risk with a 4% open-risk cap, the
  rules as coded would have lost 78% of the account in 2021–23 and 50% in 2024–26 (P1); P2 lost more than 95%.
- **Use v1.2 as a candidate list.** It finds Mayne-style setups and shows the checks; the decision is yours, on the
  chart.
- **The forward test keeps score.** From 12 Oct 2026, every setup is scored on data nobody has seen. That is the only
  honest place left to look for an edge.

## How it was tested
| Item | Setting |
|---|---|
| Universe | Daily top-100 Binance USDT-M perpetuals by the previous day's volume, delisted coins included (745 coins) |
| Split | Rules chosen on setups armed 2021-01-01 → 2023-12-31 ("decide"); checked once on 2024-01-01 → 2026-10-10 ("confirm") |
| Fills and costs | Limit entries and targets: maker 0.02%, must trade through by 0.02%. Stops: taker 0.05% + 0.03% slippage, gaps fill at the open. Funding from Binance's archive |
| Statistic | Average net R per closed trade; 90% intervals from a bootstrap over calendar weeks (alts move with BTC, so trades in one week are not independent) |
| Pass rule | Confirm average > 0 and the 90% lower bound > 0 = pass; average > 0 = promising; otherwise fail, and the kill rule applies |

## Baseline (Mayne's rules as coded)
| Profile | 2021–23 | 2024–26 |
|---|---|---|
| P1 H12–H1 | −0.146R per trade (1,264 trades, 27% wins, PF 0.81) | −0.057R (1,152 trades, 29% wins, PF 0.92) |
| P2 H4–M15 | −0.101R (5,346 trades, 29% wins, PF 0.87) | −0.154R (5,058 trades, 27% wins, PF 0.80) |

## Why there is no edge: three checks
1. **Random entries do just as well.** For every real trade, 5 entries were placed at random times within ±30 days in
   the same direction, with the same stop, targets and exit. The real setups did not beat them: 2021–23 P1 −0.02R
   (90% CI −0.10 … +0.06), P2 −0.02R; 2024–26 P1 +0.03R (−0.05 … +0.12), P2 **−0.05R (−0.09 … −0.01): worse than
   random**.
2. **The bias direction does not help either.** Random entries *with* the W/D bias did worse than random entries in a
   random direction for P1 in both periods (−0.10R, 90% CI −0.16 … −0.04 both times).
3. **Mayne's gates don't filter.** Removing discount/premium, the HTF turn, the daily sync or the 2:1 rule one at a
   time never made results more than 0.01R worse, and for P1 every removal improved them.

Also: the A+ grade still ranks worst (P1 2021–23: A+ −0.15R, A −0.14R, B −0.12R), and only 46–49% of fills ever reach
+1R before −1R. That is what a coin flip gives.

## The rule ideas (2021–23, average net R; baseline P1 −0.146R, P2 −0.101R)
| Idea | Mayne? | P1 | P2 | Kept? |
|---|---|---|---|---|
| C1/C1b sweep definition fix | yes | −0.147 | −0.099 | no (the HTF turn is already an SFP in 100% of setups) |
| **C1c trigger-TF sweep required** ("low taken, high broken", V24) | yes | **−0.051** | −0.136 | P1 |
| C1d zone-TF SFP or trigger-TF sweep required | yes | −0.102 | −0.126 | no |
| **C2a BTC's W/D bias agrees** | no | **+0.011** | −0.055 | P1, P2 |
| C2b/C2c relative strength vs BTC | no | −0.152 / −0.064 | −0.126 / −0.112 | no |
| C3/C3b 2:1 after costs, cost cap | yes / no | −0.142 / −0.133 | −0.103 / −0.080 | no |
| C4 universe tiers (top 50/20/10, majors) | partly | −0.18 … −0.44 | −0.12 … −0.26 | no |
| C5 reaction entry (V13) | yes | −0.195 | −0.107 | no |
| C6 external liquidity taken | yes | −0.146 | −0.100 | no (same as baseline) |
| **C7 young trend** (first 2 tags, V14) | yes | **−0.034** | −0.080 | P1 |
| C7b OTE gate | yes | −0.134 | −0.098 | no |
| C8a runner to PT | yes | −0.128 | −0.098 | no |
| **C8b time stop 12 bars** | no | **−0.078** | −0.078 | P1 |
| C9a crypto day 08–21 UTC / **C9b no weekends** | yes / no | −0.157 / **−0.101** | −0.129 / −0.077 | P1 (C9b) |
| C10 ladder entry in thirds (V17) | yes | −0.131 | −0.099 | no |

Combining P1's kept ideas: F5 (all five) left 117 trades and F4 left 141, both under the 150 floor. **F3 = BTC agrees +
young trend + trigger-TF sweep** made +0.105R on 152 trades, so it went to the one confirm check.

## The one confirm check (2024–26)
| Profile | Rule set | 2021–23 | 2024–26 | Verdict |
|---|---|---|---|---|
| P1 | F3 (C2a + C7 + C1c) | +0.105R (152) | **−0.028R** (182; 90% CI −0.25 … +0.18) | **FAIL** |
| P2 | C2a | −0.055R (1,454) | **−0.201R** (2,397; 90% CI −0.27 … −0.13) | **FAIL** |

The gains were regime effects. BTC-agrees made +0.67R in 2022's bear market (on only 25 trades) and lost in 2023 and 2024–26. Young
trends did best in 2022 too. One unplanned extra look (universe tiers on 2024–26) is logged in the test plan and was
not acted on: those tiers had all lost on 2021–23.

## Confluence with Krillin (separate test, Sep 2025 – Oct 2026)
| Filter | Sep 2025 – Mar 2026 | Apr – Oct 2026 (one look) | Verdict |
|---|---|---|---|
| Krillin signal while a Mayne P2 zone is live (same direction) | +0.026R (1,652) vs base −0.048R | −0.075R (1,421) vs base −0.101R | FAIL |
| Mayne P1 trade with no opposite Krillin signal in the prior 24 h | +0.300R (102) vs base +0.221R | +0.010R (87) vs base −0.047R | promising, but indistinguishable from zero |

Agreement between the two systems removes some of the worst trades but leaves no edge after costs. The Mayne P1
veto is tracked in the forward test only.

## What changed in v1.2 (everything is new files; v1.1 is untouched)
- **Indicator `mayne.v1.2`** (new TradingView script, saved next to `mayne.v1`):
  - Settings no longer print in the status line.
  - The status table is compact, with a "Next" line that says what to wait for, plus a Full mode for details.
  - The live trade gets risk/reward shading.
  - The checks (sweep, BTC agrees, tag #) show in the table, tooltip and alerts. Alerts say "not validated".
  - Every v1.2 rule is a switch, off by default. Limit fills need a 0.02% trade-through.
  - The chart tallies match the engine exactly: 19/16/7W9L/+8.1R on the defaults, 4/3/2W1L/+4.8R with the switches on.
- **Board** `/mayne/v1.2/`:
  - A "not validated" banner.
  - The Mayne checks and costs-as-%-of-1R on every card.
  - An Evidence tab with this research.
  - A forward-test view, updated daily after the merge.
- **Research tools:**
  - The v1.2 engine with switches; its defaults reproduce v1.1 exactly.
  - A sharded research replay, the realistic execution model with funding, and random-entry and excursion
    diagnostics.
  - A portfolio simulator, the confluence join, and a fidelity tool.

## If you want to keep looking (each needs a new plan written before looking)
- **Your own discretion.** Mayne reports 63 trades at a ~54% win rate; the coded rules get 28%. If the difference is
  his judgment, a blind chart review tests it: 40 setups shown up to the moment they arm, you mark take/skip, then the
  outcomes are revealed. If your picks don't beat the rest, the edge isn't there.
- **Forward results.** Check the Evidence tab after 2–3 months. Treat any rule as real only if it holds there.
- **Leads, not results.** These appeared in the data but were not pre-registered, so they are untested:
  - P1 continuation setups were about break-even in 2021–23 (−0.00R on 451 trades), while reversals were −0.23R.
  - With-bias random entries did worse than random-direction ones, which hints at mean reversion at these horizons.
