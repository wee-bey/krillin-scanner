# Trader Mayne · Fable: results

_16 Oct 2026. Plan: `FABLE_PLAN.md` (committed before any result; outcomes in its addendum 1, §9 and §9b). Fidelity check:
`FIDELITY_V24.md`. Raw reports: `research/decide-A/`, `decide-B/`, `decide-F/`, `confirm/`._

## Verdict
**No Fable rule set survived the out-of-sample check.** The question was whether Mayne's actual exit, and the entry
rules he teaches that v1.2 never coded, carry an edge. On 2021–23 the exit helped every profile and two entry rules
helped P1; on 2024–26, checked once, all of it was worse than the baseline. Kill rule applied.

| Profile | What was chosen on 2021–23 | 2021–23 | 2024–26 (one look) | Baseline 2024–26 | Verdict |
|---|---|---|---|---|---|
| P1 H12–H1 | runner trails to zone-TF structure + continuation only + OB/FVG-overlap zones only | **+0.062R** (356) | **−0.045R** (281; 90% CI −0.22 … +0.16) | −0.060R (1,162) | FAIL |
| P2 H4–M15 | runner keeps its stop + partial at daily equal lows + Silver Bullet window | −0.065R → N6b +0.100 | **−0.481R** (962) | −0.155R (5,078) | FAIL |
| P1D H12–H4 direct | runner keeps its stop + partial at daily equal lows | −0.118R (169) | **−0.407R** (173) | −0.220R (177) | FAIL |
| P2D H4–H1 direct | nothing kept | −0.038R (1,016) | −0.109R (1,086) | same | FAIL |

What that means in practice:
- **Do not trade the Fable switches mechanically.** They stay in the indicator and the board, all off, so setups can be
  inspected under them; the alert text still says "not validated".
- **The exit finding is real but not profitable.** Mayne's runner management (keep the original stop, partial at daily
  liquidity) reproduces his V24 trade and lifted the share of runners reaching the final target from 1–5% to 8–12%, and
  it improved every profile on 2021–23 by +0.03 to +0.16R. It then cost every profile on 2024–26 (P1 −0.03R, P2
  −0.13R, P1D −0.19R vs the v1.1 exit). A looser stop wins in trending years and loses in choppy ones; 2024–26 was the
  latter for these setups.
- **The W/D bias is still the drag.** Random entries in a random direction beat random entries with Mayne's bias on
  every profile and both periods (−0.03 to −0.30R gross). P1's chosen set beat bias-only random entries by +0.10R on
  2024–26 (90% CI −0.08 … +0.29): the zone and trigger rules add something there, but not enough to overcome the bias
  and costs.
- **Direct entries (V14) are not better.** P1D on 2024–26: −0.22R baseline, −0.41R with the exit. P2D: −0.11R.

## What was tested
| Stage | Candidates (all Mayne-sourced; plan §3–§4) | Outcome on 2021–23 |
|---|---|---|
| Fidelity | engine vs Mayne's V24 journal trade | entry, stop and final target reproduced; v1.1's exit not (`FIDELITY_V24.md`) |
| A · exit | E1 runner keeps its original stop · E3 trail to zone-TF structure · E2a partial at the nearest daily pool ≥ 2R · E2b daily EQH/EQL first · E4 = E1 + E2b | P1 kept E3 (+0.052); P1D kept E4 (+0.156); P2 kept E4 (+0.035); P2D kept nothing |
| B · entries | direct profiles P1D / P2D · N2 continuation only · N3a/b daily-bias close location (V22) · N4 Power of 3 (V10) · N5 OB/breaker + FVG overlap only (V07) · N6a killzones / N6b Silver Bullet (V20, V14) | P1 kept N2 (+0.070), N5 (+0.059); P2 kept N6b (+0.100); P1D, P2D nothing |
| F · combination | P1: E3 + N2 + N5 | +0.062R on 356 trades (first positive DECIDE result in the project) |
| Confirm | B0, B1 and F per profile, 2024-01-01 → 2026-10-15, opened once | all FAIL (table above) |

Method, unchanged from v1.2: daily top-100 Binance USDT-M perpetuals (745 coins, delisted included); maker 0.02% on
limits with a 0.02% trade-through, taker 0.05% + 0.03% slippage on stops, funding charged; average net R per closed
trade with 90% calendar-week block-bootstrap intervals; selection and pass/kill rules written before any result. An
independent agent re-derived the DECIDE numbers, the selection outcome and the split from the raw rows (all matched)
and confirmed the engine reads only closed daily candles for the new rules.

## What changed in Fable (new files only; v1.1 and v1.2 untouched)
- **Engine** `lib/engine.js`: every Fable rule as a switch (defaults = v1.2 exactly, checked by `tools/test-engine.js`);
  profiles P1D / P2D; trade facts for the checks (daily-bias, PO3, session, exit mode).
- **Indicator** `indicator/mayne_fable.pine` = TradingView script **"mayne.fable · Trader Mayne System"**: group "Fable
  rules" (all off), profiles P1D / P2D, the Fable checks in the table / tooltip / alerts (`mayneF …`), compiles clean.
- **Board** `/mayne/fable/`: the v1.2 board plus the direct profiles, the Fable switches (off), the checks and the exit
  mode on every card, an Evidence tab with Stage A / B / F / confirm tables and the random-entry baselines.
- **Research tools** (`tools/research.js`, `analyze.js --stage A|B`, `make-evidence.js`, `forward.js`) and the workflows
  `mayne-fable-research.yml` / `mayne-fable-forward.yml`; results on the orphan branch `mayne-fable-results`.
- **Forward test** from 17 Oct 2026: the shipped set (B0) plus B1 and the F sets tracked per profile, information only.

## If you want to keep looking (each needs a new plan before looking)
- **Regime-conditional exit.** The exit helped in 2021–23 and hurt in 2024–26. A rule that switches between the trailed
  and the original stop by a pre-defined regime measure could be tested; it must be specified before looking, and the
  decide/confirm split must move (2021–24 decide, 2025–26 confirm) because 2024–26 has now been seen.
- **P1 continuation + overlap zones** is the only set that was positive anywhere (2021–23) and the only one that beat
  bias-only random entries on 2024–26. Its 2024–26 result is indistinguishable from zero on 281 trades. The forward
  test is the honest place to watch it.
- **The blind discretion test** from v1.2's results still stands as the best remaining question: Mayne reports ~54%
  wins; the coded rules get 28–30%.
