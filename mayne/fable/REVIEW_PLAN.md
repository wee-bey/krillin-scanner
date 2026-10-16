# Fable · blind discretion test (pre-registered)

_Written 16 Oct 2026, before any review was done. Committed before the review set was built. Nothing here changes after
a result exists; a change needs a dated addendum._

## 0. The question
Mayne reports ~54% winners; the coded rules get 28–30% and no rule change has produced an edge out of sample (v1.2,
Fable). The remaining hypothesis is that the edge is **his judgment at the moment of the trigger**: which of the
rule-compliant setups to take. If Jeffrey's own chart judgment picks the better setups out of the engine's candidates,
the system works as a candidate list plus discretion; if not, discretion does not rescue it either.

## 1. The set
- Source: the Fable `confirm` run, variant B0 (Mayne's rules as coded, v1.2 behaviour), **closed, filled** trades armed
  2024-01-01 → 2026-10-15 (7,503 trades, 472 coins).
- Sample: **40 setups, 20 P1 and 20 P2**, drawn uniformly at random within each profile with a fixed seed (20261016),
  no two from the same coin-and-week, coins with a rank ≤ 100 on the arm day (all B0 rows satisfy this).
- Each setup is shown **frozen at the arm bar**: the zone-TF chart (up to 150 closed candles) and the trigger-TF chart
  (up to 240 closed candles) ending at the trigger candle, the zone box, the zone-TF dealing range and EQ, the
  proposed Entry / SL / PL / PT / FT, the direction, profile, zone kind, path (reversal / continuation), the HTF turn,
  the grade and the v1.2 / Fable checks. **Nothing after the arm bar is shown**, and the coin's name and the date are
  hidden (replaced by a number), so the picture cannot be recognised from news or memory.
- The outcome (net R, how it closed) is stored obfuscated in the file and is revealed only on the results page.

## 2. The procedure
- Jeffrey marks each setup **Take** or **Skip**, optionally with a one-line note, in one or more sittings, in the order
  shown (randomised once). He may not go back to change a decision after seeing any result. The tool records the
  decision time.
- No peeking at the outcomes before all 40 are marked. The file is in the repo, so this is on the honour system; the
  tool itself shows nothing until the last decision is in.

## 3. The statistic and the pass rule
- **Primary:** mean net R of the taken setups minus mean net R of the skipped setups (B0 execution model: the same net R
  the research used).
- **Test:** a permutation test — the 40 labels are shuffled 20,000 times at the observed number of takes; the p-value is
  the share of shuffles whose difference is at least the observed one.
- **PASS:** taken mean − skipped mean > 0 **and** p < 0.10 **and** the taken mean net R > 0. → discretion is worth
  keeping; a larger set (120) is drawn for a second check before anything changes in the alerts.
- **INCONCLUSIVE:** difference > 0 but p ≥ 0.10, or difference > 0 with the taken mean ≤ 0. → draw a larger set once.
- **FAIL:** difference ≤ 0. → judgment does not separate the candidates; the candidate list stays a candidate list and
  nothing further is built on discretion.
- Also reported, information only: the taken set's win rate and profit factor, the same for "take all" (the engine's
  own result on these 40), per profile, and the decisions per grade.

## 4. What it cannot tell
- 40 setups is a small set; the test is powered for a large difference (about 0.5R between the groups), not a subtle
  one. A FAIL on 40 is still a FAIL for the purpose above (the gap Mayne claims is large).
- The charts are the engine's candles, not TradingView; no volume, no other indicators. That is what the board shows.

## 5. Files
- `tools/make-review.js` builds `data/review.json` from the confirm rows and the Binance archive (the window of candles
  before each arm bar; outcomes obfuscated).
- `review.html` is the tool (offline, self-contained, decisions saved in the browser and downloadable as JSON).
- `tools/score-review.js` scores a downloaded decisions file against `data/review.json` (the same statistic as the
  tool's results page), so the result can be reproduced outside the browser.

## 6. Log
| Date | What | Outcome |
|---|---|---|
| (none yet) | | |
