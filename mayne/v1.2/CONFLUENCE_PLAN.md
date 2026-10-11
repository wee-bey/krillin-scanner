# Mayne × Krillin confluence: test plan (pre-registered)

_Written 11 Oct 2026, after Jeffrey asked whether any combination with Krillin's setups is profitable, and before any
joined result was produced. Committed to git before the first joined run. Changes need a dated addendum._

**Rule change, at Jeffrey's request:** until now the two systems were never mixed. This is a separate research test
only. Neither system's code, signals, scanner or results change. If something passes, it would ship as a separate,
clearly labelled "confluence" view.

## 1. Data
- **Krillin:** every signal its replay recorded on `main` (`data/signals-*.json`, 2025-09-01 → 2026-10-10), resolved
  ones only (`ev.st == "closed"`), scored with Krillin's own outcome `ev.R` (its own fees, slippage, bids and TP ladder).
  Base performance, already known from the Krillin side: −0.075R average over 58,873 resolved signals.
- **Mayne:** the v1.2 engine with v1.1 rules (B0, trade-through fills, v1.2 execution model). For the Krillin-side
  tests, the Mayne state per coin and profile is rebuilt from the engine's event log (TAG / TURN / ARM / FILL / CLOSE /
  ZINV / ZEXP / INV / EXP) and its daily W/D bias.
- Same universe on both sides: the daily top-100 Binance USDT-M perpetuals.

## 2. Split
- **DECIDE:** signals / trades dated 2025-09-01 → 2026-03-31 (sub-periods: Sep–Dec 2025, Jan–Mar 2026).
- **CONFIRM:** 2026-04-01 → 2026-10-10, looked at once, only for the candidate(s) that pass DECIDE.
- Disclosure: Krillin-side features were already explored on both halves in the Krillin profitability search
  (4 Oct 2026), and Mayne's B0 totals for 2024–26 were seen today. The **joined** (confluence) results have never been
  computed.

## 3. Candidates (fixed)
**Krillin signals filtered by Mayne context** (base = all resolved Krillin signals):
| # | Keep a Krillin signal only when, at its signal time, on the same coin … |
|---|---|
| K1 | a Mayne **P1** zone is live in the same direction (between its TAG and the zone's end) |
| K2 | a Mayne **P2** zone is live in the same direction |
| K3 | K1 or K2 |
| K4 | Mayne's W/D bias (S1 + S2) points the same way |
| K5 | a Mayne HTF turn is confirmed (FORMING+ or later) in the same direction, on P1 or P2 |

**Mayne trades filtered by Krillin** (base = Mayne B0 closed trades, P1 and P2 judged separately):
| # | Keep a Mayne trade only when, on the same coin, in the 24 h (P1) / 6 h (P2) before it arms … |
|---|---|
| M1 | a Krillin signal in the same direction printed (any grade) |
| M2 | a Krillin A or A+ signal in the same direction printed |
| M3 | **no** Krillin signal in the opposite direction printed (veto) |

## 4. Selection (DECIDE) and the one CONFIRM look
- A candidate passes DECIDE when its average R beats its own base by ≥ 0.05R, the gain is positive in both DECIDE
  sub-periods, and it keeps ≥ 300 signals (Krillin side) or ≥ 100 trades per profile (Mayne side).
- At most one candidate per group (Krillin side; Mayne P1; Mayne P2), the one with the largest DECIDE gain, goes to
  CONFIRM.
- **CONFIRM:** PASS = average R > 0 and the 90% week-block bootstrap lower bound > 0; PROMISING = average R > 0;
  FAIL otherwise. Week blocks, as in TEST_PLAN §4.
- Because the window is short and partly seen, even a PASS means **forward paper testing first**, not real money.

## 5. Log of looks at CONFIRM
| Date | What | Why |
|---|---|---|
| — | — | — |
