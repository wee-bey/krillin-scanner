# Mayne Fable research: decide-F

Setups armed 2021-01-01 → 2023-12-31 · engine mayne.fable-js.1 · 1801 rows · made 2026-10-16T03:10:05.592Z

## P1

| Variant | Closed | Win | Avg R net | 90% CI | Avg R gross | v1.1 costs | PF | Δ vs B1 | Δ by year | per month |
|---|---|---|---|---|---|---|---|---|---|---|
| B1 | 1177 | 28% | −0.094 | −0.21 … +0.03 | −0.050 | −0.086 | 0.87 |  |  | 32.9 |
| C4-10 | 168 | 29% | −0.058 | −0.29 … +0.19 | −0.002 | −0.035 | 0.92 | +0.036 | +0.13 / +0.21 / −0.19 | 4.8 |
| C4-20 | 304 | 27% | −0.150 | −0.31 … +0.03 | −0.097 | −0.131 | 0.80 | −0.056 | −0.01 / +0.02 / −0.17 | 8.6 |
| C4-50 | 690 | 26% | −0.172 | −0.30 … −0.04 | −0.125 | −0.160 | 0.77 | −0.077 | −0.07 / −0.09 / −0.08 | 19.3 |
| C4-maj | 46 | 22% | −0.293 | −0.67 … +0.13 | −0.246 | −0.287 | 0.64 | −0.198 | −0.13 / +0.48 / −0.53 | 1.3 |
| F | 356 | 30% | +0.062 | −0.14 … +0.28 | +0.107 | +0.063 | 1.08 | +0.156 | +0.23 / +0.30 / −0.08 | 9.9 |

## Diagnostics

### D1 excursions (filled trades of the diagnosed variants)

| Variant | Profile | Trades | Median MFE to exit | Median MAE to exit | Median MFE in window | Reached +1R before −1R | +2R | +3R | Same-candle (D6) |
|---|---|---|---|---|---|---|---|---|---|
| F | P1 | 356 | +1.21R | +1.20R | +2.17R | 56% | 38% | 27% | 0 |

### D2 random-entry baselines (gross R per trade; same exit as the diagnosed variant; the real trades are its filled trades)

| Variant | Profile | Real gross | Bias-only random gross | No-bias random gross | Real − bias-only (90% CI) | Bias-only − no-bias (90% CI) |
|---|---|---|---|---|---|---|
| F | P1 | +0.107 | −0.044 (1778) | +0.041 (1780) | +0.151 (−0.07 … +0.39) | −0.085 (−0.19 … +0.02) |

### D4 HTF turn and trigger on the same bar (B0 reversal setups)

- P1: 33 of 857 (3.9%)

### D5 grade ranking (avg net R by grade)

| Variant | Profile | A+ | A | B |
|---|---|---|---|---|
| B1 | P1 | −0.157 (617) | −0.024 (480) | −0.035 (80) |
| F | P1 | +0.074 (221) | +0.058 (130) | −0.405 (5) |

### D7 runner outcome (filled trades: how the position ended; share of trailed runners; re-entries in the same zone; median hold)

| Variant | Profile | Filled | FT hit | PT hit | Runner stopped (original) | Runner stopped (trailed) | Stopped before the partial | Time stop | Partial taken | Re-entries (att > 1) | Median hold (h) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| B1 | P1 | 1177 | 9% | 0% | 15% | 4% | 72% | 0% | 28% | 18% | 27 |
| F | P1 | 356 | 9% | 0% | 20% | 1% | 70% | 0% | 30% | 26% | 23 |
| C4-50 | P1 | 690 | 9% | 0% | 14% | 4% | 73% | 0% | 27% | 18% | 27 |
| C4-20 | P1 | 304 | 9% | 0% | 16% | 3% | 72% | 0% | 28% | 17% | 29 |
| C4-10 | P1 | 168 | 10% | 0% | 14% | 4% | 71% | 0% | 29% | 16% | 41 |
| C4-maj | P1 | 46 | 11% | 0% | 7% | 4% | 78% | 0% | 22% | 24% | 41 |

