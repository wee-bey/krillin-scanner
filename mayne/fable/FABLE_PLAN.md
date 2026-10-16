# Trader Mayne · Fable: test plan (pre-registered)

_Written 16 Oct 2026, before any Fable result was produced, and committed to git before the first research run. Nothing
in this file may be changed after results come in; a change needs a dated addendum at the bottom that says why. The
Fable version lives in `mayne/fable/`; v1.1 (`mayne/`) and v1.2 (`mayne/v1.2/`) are untouched._

## 0. Why this test exists
v1.2 (`../v1.2/TEST_PLAN.md`, `../v1.2/RESULTS.md`) found no edge in Mayne's rules as coded, nor in 18 rule ideas
tested one at a time on the same pipeline, and applied its kill rule. Two things were not covered by that test:

1. **The exit.** A fidelity check against the one dated trade in the videos (`FIDELITY_V24.md`) shows that the engine
   reproduces Mayne's entry (same day, same level within 1%, same stop logic, same final target) but not his trade
   management: he kept the runner on its original stop to the weekly range low (≈11R); the engine took its partial at
   the nearest H1 pool, trailed the runner to H1 swings, was stopped two days later (+2.8R), then re-entered twice and
   lost both (−2R). v1.2's own statistic — only 1–2% of runners ever reach FT — points the same way. Every v1.2
   candidate was judged under this exit.
2. **Entry models and filters Mayne teaches that were never coded:** the direct H4/H1 entry (V14), continuation-only
   (V14), the daily-bias statistics (V22), Power of 3 (V10), the OB+FVG overlap as a requirement (V07), and killzones
   (V20). Two leads from v1.2 (continuation ≈ break-even; with-bias random entries worse than random) are covered by
   the continuation and daily-bias candidates.

The question is therefore two-staged: **does Mayne's actual exit change the picture, and, under that exit, does any
of the untested entry rules carry an edge?**

## 1. What has already been seen (honest disclosure)
- Everything in `../v1.2/RESULTS.md` and `../v1.2/TEST_PLAN.md` §9–§9b, on both periods.
- The v1.2 engine's full log on **one coin** (BINANCE:BTCUSDT spot, P1, defaults, 2017 → 10 Oct 2026), read for the
  V24 fidelity check. Its tally (54 armed, 46 filled, 19W/27L, +22.7R gross) was seen; no other coin, profile or
  variant has been run under the Fable engine.
- No Fable switch has been run on any data before this file was committed.

## 2. Data, split, execution model, statistics
Identical to v1.2 §2–§4, repeated here so this file stands alone:
- **Universe:** daily top 100 Binance USDT-M perpetuals by the previous day's quote volume, delisted coins included.
- **DECIDE:** setups armed 2021-01-01 → 2023-12-31. **CONFIRM:** 2024-01-01 → the latest archive day, opened once
  (§8); every extra look is logged in §9.
- **Execution:** maker 0.02% on limit entries and targets, which must trade through by 0.02% of price; taker 0.05% +
  0.03% slippage on stops and market exits; gaps fill at the open; funding from the Binance archive on the open
  fraction of the position.
- **Primary metric:** average net R per closed trade. **Uncertainty:** 90% / 95% intervals from a 2,000-resample
  calendar-week block bootstrap. Also reported: gross R, win rate, profit factor, trades per month, max drawdown in R,
  by year and regime, and the portfolio simulation of v1.2 §4 for the final configuration.
- **Baseline B0** = v1.2's B0 (the v1.1 rules with the v1.2 execution model). The Fable engine with every Fable switch
  at its default must give exactly v1.2's trades (checked by `tools/test-engine.js` before every run).

## 3. Stage A — the exit (DECIDE only)
Each candidate is a switch on the Mayne-own exit (rulebook §5.4); the stop at entry, the partial size (2/3) and FT are
unchanged. [M] = Mayne said it, [I] = interpretation.

| # | Switch | Tag | Exact definition |
|---|---|---|---|
| E1 | `trail: 'none'` | [M] V24 journal; V16@26:27 (no break-even before a meaningful level; no trailing rule stated) | After the partial the runner keeps its **original** stop. Exit only at FT or that stop. |
| E3 | `trail: 'zone'` | [I] a looser reading of V16@26:27 "the latest structure low" | After the partial, on each trigger bar, the stop moves to the zone-TF **protected low** (longs; protected high for shorts) ± the buffer, only when that is beyond the current stop. Never to entry. |
| E2a | `plFrom: 'daily'` | [M] V24@21:13 "internal range liquidity… all those lows that had built up" (daily-level lows inside the weekly range) | PL = the nearest **unswept daily pool** (confirmed daily 3-candle swing high/low, same pool logic as the zone TF) beyond the entry at ≥ 2R and before FT. None → the v1.1 PL (nearest trigger-TF pool ≥ 2R, else 2R). |
| E2b | `plFrom: 'dailyEq'` | [M] V24@21:13 + V11 (equal lows as the liquidity that gets taken) | As E2a, but if an unswept daily **EQH/EQL** (two or more daily swings within 0.25 × ATR(14, D) of each other, unswept between) sits at ≥ 2R before FT, PL = the nearest such level; otherwise E2a. |
| E4 | E1 + E2b | [M] V24 (what he did) | The combination, tested as one named candidate. |

Families: {E1, E3} (trail mode) and {E2a, E2b} (partial level). Selection per profile by §7 against B0. **E\*** = the kept
trail mode + the kept partial level, or E4 if E4 beats that sum on DECIDE; if nothing is kept, E\* = B0's exit.
**B1** = B0 + E\*.

## 4. Stage B — entry models and filters (DECIDE only, each on top of B1)
| # | Switch / profile | Tag | Exact definition |
|---|---|---|---|
| N1 | profile **P1D** `{W+D bias, zone H12, confirmation = trigger = H4}` | [M] V14@41:23–42:25 "I'm entering right here on the fair value gap… stop at the low. What's wrong with that trade? Nothing" | The H4 displaced MSB in the bias direction after the zone tag is both the HTF turn (S5) and the trigger (S6); entry at the proximal edge of the H4 FVG it leaves; stops, targets, gates as in §4–§6 of the rulebook with H4 as the trigger TF. No lower TF is consulted. |
| N1b | profile **P2D** `{W+D bias, zone H4, confirmation = trigger = H1}` | [M] V14@43:28 "H1 model… you totally can" | The same with H1. |
| N2 | `pathOnly: 'cont'` | [M] V14@57:10 continuation is "higher probability"; v1.2 lead (P1 continuation −0.00R vs reversal −0.23R) | Reversal zones are still tagged and tracked (a continuation setup needs a prior tag), but only continuation-path triggers may arm; a reversal-path trigger is rejected. |
| N3a | `dailyBias: 'close'` | [M] V22@21:36–22:41 (close in the top / bottom 10% of yesterday's range → ~9 in 10 that side is taken) | At the trigger bar, the last closed daily candle must have closed in the **bottom 10%** of its range for longs ((close − low)/(high − low) ≤ 0.10), the **top 10%** for shorts. |
| N3b | `dailyBias: 'sweep'` | [M] V22@31:10–32:15 (the bias sentence: …"yesterday's low is still intact", then the sweep is the reversal point, then the trigger) | N3a **and** the trigger leg's extreme took that daily candle's low (longs: leg low < yesterday's low; shorts: leg high > yesterday's high). |
| N4 | `po3: true` | [M] V10 (Power of 3: the manipulation leg goes below the open before the expansion up) | The trigger leg's extreme is beyond the **current UTC day's open** (longs: leg low < the open of the first trigger candle of that day; shorts: leg high > it). |
| N5 | `poiKind: 'overlap'` | [M] V07 R18, V08 ("one of the best setups in all of smart money trading"); v1.2 lead (P1 H4 OB +0.33R on 41) | The zone POI must be an OB or breaker **overlapping an FVG** (zone kinds FVG+OB, OB+FVG, Breaker+FVG). Plain FVG, OB or breaker zones are not tagged. |
| N6a | `session: 'kz'` | [M] V20 killzones (London 02:00–05:00, New York 07:00–10:00, New York time, DST-aware) | Arm only when the trigger candle **closes** inside a killzone. |
| N6b | `session: 'sb'` | [M] V14@28:36–29:43 Silver Bullet (03–04, 10–11, 14–15 New York time) | Arm only when the trigger candle closes inside a Silver Bullet window. |

Families: {N3a, N3b}, {N6a, N6b}. N1 and N1b are profiles: each is run as its own profile with B0's rules, with E\*
(= B1 rules), and with the Stage-B switches on top, and judged by §7 and §8 separately with trade floors P1D 150,
P2D 300. N2–N6 are judged per profile (P1, P2, P1D, P2D) by §7 against B1.

## 5. Diagnostics (information only)
- D1 excursions, D2 random-entry baselines (bias-only and no-bias, with the same exit as the variant under test), D5
  grade ranking, D6 same-candle counts — as in v1.2 §5. For Stage A, D2 is recomputed with E\* so the comparison
  stays like for like.
- D7 **runner outcome**: share of filled trades whose runner reaches FT, is stopped at the original stop, or is
  trailed out; median hold time; share of trades that were re-entries after an exit in the same zone.

## 6. Selection rule (DECIDE)
Per profile, as v1.2 §7 with its addendum 2: a candidate is **kept** against its baseline (B0 for Stage A, B1 for
Stage B) when (a) average net R improves by ≥ 0.03R, (b) the improvement is positive in at least 2 of the 3 DECIDE
years, (c) ≥ 150 closed trades remain for P1 / P1D, ≥ 500 for P2, ≥ 300 for P2D. One variant per family. **F** =
B1 + every kept Stage-B candidate, run on DECIDE; F must meet the floor and must not be worse than the best single kept
candidate; otherwise drop the kept candidate with the smallest gain and re-run, until it passes. Nothing kept → F = B1.

## 7. Pass / kill rule (CONFIRM, looked at once)
One look at 2024-01-01 → latest for: B0, B1 and F per profile (P1, P2, P1D, P2D), with the baseline diagnostics.
- **PASS:** F's average net R > 0 **and** its 90% week-block lower bound > 0. → Fable defaults = F; alerts fire only
  on setups that pass F's checks, with the reason line; "validated on 2024–26, forward test from 16 Oct 2026".
- **PROMISING:** average > 0, interval includes 0. → Fable defaults = F, labelled "unproven"; paper logging only.
- **FAIL:** average ≤ 0. → kill rule: Fable ships the switches off, ARMED stays "not validated", no further tuning on
  this history. A FAIL for the exit alone (B1 ≤ 0 on CONFIRM while B1 > B0 on DECIDE) is reported as "exit change not
  confirmed", and B1 is not adopted.
- B1 vs B0 on CONFIRM is reported in the same look; it is not an extra look.

## 8. What ships regardless of the outcome
- Engine `lib/engine.js` with every switch above (defaults = v1.2), `tools/test-engine.js` (identity with v1.2,
  no look-ahead, switch mechanics), the research tools, this plan, `FIDELITY_V24.md`, `RESULTS.md`.
- Indicator `mayne.fable` and board `/mayne/fable/`: new files; the switches as inputs; the alert text carries the
  checks and the reason line. Defaults follow §7.

## 9. Log of looks at CONFIRM
| Date | What was looked at | Why |
|---|---|---|
| 16 Oct 2026 | CONFIRM run `confirm`: B0, B1 and F per profile (P1 F = E3 + N2 + N5; P2 F = E4 + N6b; P1D F = B1 = E4; P2D F = B0), with the baseline diagnostics on B0, B1 and both F variants | The one planned look (§7). Configuration fixed by addendum 1 and the `decide-F` run (P1 F = +0.062R on 356 trades on DECIDE, ≥ N2 alone −0.025R, ≥ 150 trades). Logged before the run was started. |

## 10. Addenda
**Addendum 1 (16 Oct 2026, after the Stage A and Stage B DECIDE runs, before any CONFIRM look).** DECIDE outcomes,
recorded here so the CONFIRM configuration is fixed before it is opened:
- Stage A (`research/decide-A/`): P1 kept E3 (+0.052, 3/3 years) → E\* = E3. P1D kept E1, E2b, E4; E4 is by definition the kept
  trail (E1) + the kept partial (E2b), so E\* = E4 (+0.156; the single gains, +0.085 and +0.106, do not add up, which is
  expected since both act on the same runner). P2 kept E4 only (+0.035; E3 was +0.030, under the 0.03 bar) → E\* = E4. P2D kept nothing → E\* = B0's
  exit. B1 per profile = B0 + that E\*.
- Stage B (`research/decide-B/`, each candidate on B1): P1 kept N2 (+0.070, 2/3) and N5 (+0.059, 2/3); P2 kept N6b
  (+0.100, 2/3, 987 trades); P1D kept nothing (N5 +0.045 and N6b on 13 trades fail (a)/(c)); P2D kept nothing (N3a
  +0.058 on 213 trades fails the 300 floor).
- F per profile: **P1 = B1 + N2 + N5** (combination run `decide-F`, must hold ≥ 150 trades and ≥ N2 alone, −0.025R;
  else drop N5 then N2 per §6); **P2 = B1 + N6b**; **P1D = B1 (E4)**; **P2D = B0**.
- The CONFIRM look (§7) will open B0, B1 and F for all four profiles at once.
- `decide-F` (P1): F = B1 + N2 + N5 made **+0.062R on 356 closed trades** (90% CI −0.14 … +0.28; +0.23 / +0.30 / −0.08 by
  year), vs B1 −0.094 and N2 alone −0.025. It passes §6 step 3, so P1's F stands as B1 + N2 + N5.
- Independent verification (separate agent, 16 Oct 2026): the report numbers, the selection rule and the DECIDE split
  were re-derived from the raw rows and match; the engine's daily-pool partial and daily-close test read only closed
  daily candles. Noted: 0.15% of DECIDE trades (armed in 2023) exited in 2024, so their exits use 2024 prices; and
  several Stage A margins are thin (P1 E3 over E1 by 0.001R; P2 E3 at +0.0295 missed the 0.03 bar).
