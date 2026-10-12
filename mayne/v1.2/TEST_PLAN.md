# Trader Mayne v1.2: test plan (pre-registered)

_Written 11 Oct 2026, before any v1.2 result was produced. It is committed to git before the first research run, so the
timestamp proves the order. Nothing in this file may be changed after results come in; a change needs a dated addendum
at the bottom that says why._

## 0. Why v1.2 exists
The v1.1 replay (2021-01 → 2026-10, 745 coins) found no edge in the rules as coded: P1 −0.05R and P2 −0.04R per trade
before costs, −0.09R and −0.12R after. A 28–29% win rate with ~2.4R average winners is what a random entry with the
same stop and target would give. Tuning the existing parameters did not help (all 24 sweep cells negative, spread
~0.04R). v1.2 asks a different question: **which setups get taken and filled**, and **how realistic the execution model
is**. Every v1.1 file stays as it is; v1.2 lives in `mayne/v1.2/`.

## 1. What has already been seen (honest disclosure)
These v1.1 numbers were seen on the **full** sample, including the confirm years, before this plan was written:
by year, by regime, by grade, by zone type, BTC / ETH / SOL vs other coins (P1 on BTC alone +0.38R on 27 trades,
P1 H4 OB +0.33R on 41), the sweep grid, and the SWEEP booster rate (98%). Hypothesis C4 (universe tiers) is partly
motivated by the BTC-only number; its independent reason is that Mayne trades only BTC, ETH, SOL and maybe HYPE
(V15@1:02, V14@45:33). Treat a C4 pass with extra caution.

## 2. Data split
- **DECIDE:** setups that arm 2021-01-01 → 2023-12-31. All exploration, diagnostics and selection happen here.
- **CONFIRM:** setups that arm 2024-01-01 → the latest archive day. Opened **once**, for the final configuration of
  each profile and for the baseline. Every extra look at CONFIRM is logged in §9.
- Universe, data and engine plumbing are the v1.1 ones (daily top 100 Binance USDT-M perpetuals by the previous day's
  quote volume; delisted coins included; higher-TF values from closed candles only).

## 3. Execution model v1.2 ("realistic")
Applied to the baseline and every candidate. v1.1 costs are also reported for the baseline, for comparison.
| Item | v1.1 | v1.2 |
|---|---|---|
| Limit entry, PL partial, FT/PT exits | 0.05% fee + 0.015% slip per side | 0.02% maker fee, no slippage |
| Stops, time-stop exits, market (reaction) entries | 0.05% + 0.015% per side | 0.05% taker fee + 0.03% slippage |
| Limit fills (entry and targets) | touch | price must trade **through** the level by ≥ 0.02% of price |
| Gaps through a limit entry or a stop | fill at the open | unchanged |
| Funding | not counted | Binance archive funding rates, charged on the open fraction of the position |
| Same-candle stop and target | stop first; fill candle checks the stop only | unchanged (cases are counted; if they exceed 2% of trades they get resolved on 15m data) |

## 4. Statistics
- **Primary metric:** average net R per closed trade (v1.2 execution model).
- **Uncertainty:** 90% and 95% intervals from a block bootstrap that resamples **calendar weeks** (all trades armed in
  the same week move together), 2,000 resamples. This handles the fact that alts move with BTC.
- **Also reported:** gross R, win rate, profit factor, trades per month, max drawdown in R, by year and regime.
- **Portfolio simulation** (final configuration only, both periods): 10,000 account, 1% of current equity risked per
  trade (2% for A+ only if the grade is shown to rank trades), 4% maximum total open risk (counted from arm until
  close or cancel), at most 3 open positions in the same direction, ties broken by grade then by volume rank.
  Reports CAGR, max drawdown %, longest losing streak, worst month.

## 5. Diagnostics (information only; they decide nothing on their own)
- **D1 Excursion.** For filled baseline trades: maximum favourable and adverse excursion in R, until exit and over a
  fixed window after the fill (P1: 72 H1 bars; P2: 96 M15 bars). Share of trades reaching +1R, +2R, +3R before −1R.
- **D2 Random-entry baselines.** For each filled baseline trade, 5 pseudo-trades on the same coin and profile:
  (a) *bias-only*: same direction, entry at the open of a random trigger bar within ±30 days where the W/D bias points
  the same way; (b) *no-bias*: random direction. Same stop distance in ATR units, same PL and FT distances in R, the
  same Mayne-own exit (partial at PL, runner to FT, trail to trigger-TF structure), taker entry costs. If the Mayne
  setups do not beat (a), the zone/trigger machinery adds nothing beyond the bias; if (a) does not beat (b), the bias
  adds nothing.
- **D3 Gate ablation (DECIDE only).** One gate removed at a time: (a) D2 discount/premium; (b) S5 HTF turn (reversal
  zones go straight to FORMING+ on the tag); (c) S2 daily sync; (d) the 2:1 gate (a target is still required). A gate
  whose removal costs ≤ 0.02R while adding trades is reported as "not contributing".
- **D4** How often the HTF turn and the trigger land on the same trigger bar (§14.6).
- **D5** Whether the grade ranks trades once C1 is in.
- **D6** Same-candle stop/target counts (see §3).

## 6. Candidate rules
Each is a separate switch, off in the baseline **B0** (= v1.1 rules + the v1.2 execution model). [M] = Mayne,
[X] = not Mayne (labelled "not Mayne" wherever it appears).

| # | Rule | Tag | Exact definition |
|---|---|---|---|
| C1 | Sweep definition fix | [M] V24@9:30, V24@11:37, V24@12:42 | "Swept" (SWEEP booster and the sweep-extreme stop) only when, after the tag: (i) a zone- or confirmation-TF SFP printed, or (ii) the trigger-TF MSB leg's extreme took out the last confirmed trigger-TF swing on the other side **before** the swing that the MSB breaks ("a low taken, then the high broken"), and that extreme printed after the tag. Stop: (i) beyond the extreme since the tag; (ii) beyond the leg extreme; otherwise beyond the POI far edge. |
| C1b | Sweep required | [M] V24@11:37 | C1, and reversal-path setups need a sweep to arm. Continuation setups are exempt. |
| C2a | BTC agrees | [X] | Alts arm only when BTC's own W bias points the same way and BTC's D is synced (the S1/S2 test run on BTC). |
| C2b | Relative strength | [X] | Longs only on coins whose 30-day return (to the previous daily close) beats BTC's; shorts only on coins that lag it. |
| C2c | Both | [X] | C2a and C2b. |
| C3 | 2:1 after costs | [M] rule, cost-aware | R:R = (\|PT − entry\| − c) / (risk + c) ≥ 2, where c = 0.10% of entry (maker entry + taker stop + slippage). |
| C3b | Cost cap | [X] | Also skip setups where c > 10% of the planned risk. |
| C4 | Universe tiers | [M] he trades 4 coins | Counted only when the coin's previous-day volume rank is ≤ 50 / ≤ 20 / ≤ 10, or the coin is a major (BTC, ETH, SOL, HYPE). |
| C5 | Reaction entry | [M] V13@7:29 | No resting limit. After the price trades into the FVG, enter at the close of the first trigger candle that closes back beyond the FVG's proximal edge in the trade direction (bullish candle for longs, bearish for shorts). Stop unchanged; PL recomputed from the new entry; the 2:1 gate is re-checked from the actual entry ("based on where you're entering", V13@11:43); a stop touch before the reaction cancels. Same expiry and cancellation rules. |
| C6 | External liquidity taken | [M] V16@18:00, V22 | Between the tag and the trigger, price trades beyond the previous day's or previous week's low (longs; highs for shorts), or a zone/confirmation-TF SFP prints. |
| C7 | Young trend | [M] V14@26:30 | Only the first 2 zone tags in the bias direction since the latest daily MSB in that direction. |
| C7b | OTE gate | [M] V09 (already ported) | Entry inside the 0.62–0.79 retracement of the zone-TF range. |
| C8a | Runner to PT | [M] PT is his HTF pool | The runner targets PT instead of FT. |
| C8b | Time stop | [X] | Exit at the close when N trigger bars have passed since the fill and the trade never reached +1R. N ∈ {12, 24, 48}, chosen on DECIDE. |
| C9a | Crypto trading day | [M] V20 | Arm only when the trigger candle closes 08:00–21:00 UTC. |
| C9b | No weekends | [X] | No arming Saturday or Sunday (UTC). |
| C10 | Ladder entry | [M] V17@12:42 ("I usually scale in thirds") | Three limits of 1/3 each at the FVG's proximal edge, its 50% and its far edge; one stop; size from the proximal-edge risk, so 1R = the planned risk; no adds after the PL partial. |

## 7. Selection rule (DECIDE)
Per profile (P1 and P2 are judged separately):
1. A candidate is **kept** when, against B0 on DECIDE: (a) average net R improves by ≥ 0.03R; (b) the improvement is
   positive in at least 2 of the 3 DECIDE years; (c) at least 150 closed trades remain for P1, 500 for P2.
2. Mutually exclusive variants (C2a/b/c, C3/C3b, C4 tiers, C8b N values) count as one family: the best variant that
   meets (a)–(c) is kept.
3. **F** = B0 + every kept candidate. F is run on DECIDE to check that the gains roughly add up (F must be at least as
   good as the best single kept candidate; if not, drop the weakest candidate until it is).
4. If nothing is kept, F = B0.

## 8. Pass / kill rule (CONFIRM, looked at once)
For each profile's F, on 2024-01-01 → latest:
- **PASS:** average net R > 0 **and** the 90% week-block lower bound > 0. → v1.2 defaults ship with F; small live size
  only after 4–8 weeks of forward paper logging agree with the replay.
- **PROMISING:** average net R > 0 but the 90% interval includes 0. → F ships as the default, labelled "unproven";
  forward paper logging only, no real money.
- **FAIL:** average net R ≤ 0. → **kill rule:** stop trying to automate Mayne's entries on this data. The board keeps
  showing WATCH / FORMING / ARMED as a candidate list for discretionary review, ARMED alerts are labelled "not
  validated", and no further tuning happens on this history. Any new attempt needs a new idea and a new pre-registered
  plan.

## 9. Log of looks at CONFIRM
| Date | What was looked at | Why |
|---|---|---|
| 11 Oct 2026 | CONFIRM run: B0 (P1, P2), F_P1 = F3 (C2a + C7 + C1c), F_P2 = C2a; plus the baseline diagnostics | The one planned look (§8). F chosen by §7 + addendum 2 on DECIDE: F5 117 trades and F4 141 trades failed the 150 floor; F3 152 trades, +0.105R ≥ C2a alone (+0.011R). |
| 11 Oct 2026 | **Unintended extra look:** the analysis script also printed the C4 universe tiers for CONFIRM, because it derives them from the B0 rows automatically (P1: top-20 +0.07R on 248, majors +0.51R on 29; P2: all tiers negative). | A script default, not a choice. C4 failed on DECIDE (every tier worse than B0), so it was not in F; these numbers are not acted on. Logged so the look is on record. |

## 9b. Outcome (11 Oct 2026)
| Profile | F | DECIDE 2021–23 | CONFIRM 2024–26 | Verdict |
|---|---|---|---|---|
| P1 | C2a + C7 + C1c | +0.105R (152 closed) | **−0.028R** (182 closed, 90% CI −0.25 … +0.18) | **FAIL** |
| P2 | C2a | −0.055R (1,454 closed) | **−0.201R** (2,397 closed, 90% CI −0.27 … −0.13) | **FAIL** |

Baselines on CONFIRM: B0 P1 −0.057R (1,152), B0 P2 −0.154R (5,058). **Kill rule applied (§8):** no further tuning on
this history; the board and the indicator present setups as a candidate list for discretionary review, ARMED is
labelled "not validated"; v1.2 rule switches stay available but off by default.

## 10. Addenda
**Addendum 1 (11 Oct 2026, before any performance result).** A mechanics check on 4 sample coins (DECIDE period only;
counts of rule states, no R looked at) showed that condition (i) of C1 — a zone- **or confirmation**-TF SFP after the
tag — is met by **100%** of reversal setups (247 of 247), because the HTF turn (S5) is itself usually an SFP. As
pre-registered, C1 and C1b would therefore be the same as B0. Two variants are added so the sweep idea is actually
tested; C1 and C1b stay in the run unchanged:
| # | Rule | Tag | Exact definition |
|---|---|---|---|
| C1c | Trigger-TF sweep required | [M] V24@11:37 ("a high get taken, then a market structure shift, fair value gap") | Reversal setups arm only when condition (ii) of C1 holds (the MSB leg took out the last trigger-TF swing before the swing it breaks, after the tag). Stop beyond the leg extreme. In the sample, ~40% of reversal setups meet (ii). |
| C1d | Zone-TF SFP or trigger-TF sweep required | [M] V24@7:23 ("SFP into the daily OB") | Reversal setups arm only when a **zone-TF** SFP (not the confirmation TF) printed after the tag, or (ii) holds. Stop: beyond the extreme since the tag for the SFP case, beyond the leg extreme for (ii). |
Both belong to the C1 family for the selection rule (§7.2).

**Addendum 2 (11 Oct 2026, after the DECIDE run, before any combination was run and before any CONFIRM look).**
§7.3 does not say how to drop candidates when the full combination fails, nor that F must keep enough trades. Fixed
now, before running any combination:
- F must meet the same trade floor as single candidates (§7.1c: ≥ 150 closed for P1, ≥ 500 for P2) and must not be
  worse on DECIDE than the best single kept candidate.
- If it fails either test, drop the kept candidate with the smallest Δ first and re-run, until it passes.
- DECIDE outcome: P1 kept C2a (+0.158), C7 (+0.112), C1c (+0.095), C8b12 (+0.068), C9b (+0.046); P2 kept C2a (+0.046).
  So the P1 sequence is F5 = all five → F4 (− C9b) → F3 (− C8b12) → F2 (− C1c) → F1 = C2a alone; P2's F is C2a alone.
