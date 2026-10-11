# Mayne v1.2 research: CONFIRM (2024–26), the one planned look (raw report; the C4 rows are the logged unintended extra look)

Setups armed 2024-01-01 → 2026-12-31 · engine mayne.v1.2-js.1 · 10258 rows · made 2026-10-11T18:27:03.819Z

## P1

| Variant | Closed | Win | Avg R net | 90% CI | Avg R gross | v1.1 costs | PF | Δ vs B0 | Δ by year | per month |
|---|---|---|---|---|---|---|---|---|---|---|
| B0 | 1152 | 29% | −0.057 | −0.14 … +0.04 | −0.021 | −0.064 | 0.92 |  |  | 34.8 |
| C4-10 | 106 | 32% | +0.083 | −0.20 … +0.40 | +0.119 | +0.070 | 1.12 | +0.140 | −0.14 / +0.08 / +0.55 | 3.2 |
| C4-20 | 248 | 33% | +0.071 | −0.12 … +0.26 | +0.112 | +0.066 | 1.10 | +0.128 | +0.12 / +0.10 / +0.12 | 7.5 |
| C4-50 | 633 | 31% | +0.015 | −0.10 … +0.13 | +0.053 | +0.010 | 1.02 | +0.071 | +0.02 / +0.11 / +0.09 | 19.2 |
| C4-maj | 29 | 45% | +0.511 | −0.02 … +1.01 | +0.573 | +0.485 | 1.86 | +0.567 | +0.70 / −0.08 / +0.88 | 0.9 |
| F3 | 182 | 31% | −0.028 | −0.25 … +0.18 | +0.019 | −0.033 | 0.96 | +0.028 | +0.08 / −0.35 / +0.39 | 5.7 |

## P2

| Variant | Closed | Win | Avg R net | 90% CI | Avg R gross | v1.1 costs | PF | Δ vs B0 | Δ by year | per month |
|---|---|---|---|---|---|---|---|---|---|---|
| B0 | 5058 | 27% | −0.154 | −0.20 … −0.11 | −0.089 | −0.180 | 0.80 |  |  | 152.0 |
| C2a | 2397 | 26% | −0.201 | −0.27 … −0.13 | −0.131 | −0.224 | 0.75 | −0.047 | −0.06 / −0.03 / +0.07 | 73.5 |
| C4-10 | 572 | 27% | −0.163 | −0.28 … −0.04 | −0.085 | −0.194 | 0.79 | −0.010 | −0.06 / +0.02 / +0.03 | 17.2 |
| C4-20 | 1169 | 27% | −0.177 | −0.26 … −0.09 | −0.109 | −0.203 | 0.77 | −0.024 | −0.04 / −0.02 / +0.00 | 35.2 |
| C4-50 | 2728 | 27% | −0.158 | −0.21 … −0.10 | −0.093 | −0.184 | 0.80 | −0.004 | −0.01 / −0.01 / +0.01 | 82.0 |
| C4-maj | 167 | 26% | −0.197 | −0.39 … +0.01 | −0.075 | −0.245 | 0.76 | −0.044 | −0.09 / −0.06 / +0.03 | 5.1 |

## Diagnostics

### D1 excursions (filled B0 trades)

| Profile | Trades | Median MFE to exit | Median MAE to exit | Median MFE in window | Reached +1R before −1R | +2R | +3R | Same-candle (D6) |
|---|---|---|---|---|---|---|---|---|
| P1 | 1152 | +0.95R | +1.09R | +1.57R | 48% | 34% | 24% | 3 |
| P2 | 5058 | +0.85R | +1.11R | +1.68R | 46% | 30% | 23% | 2 |

### D2 random-entry baselines (gross R per trade; the real trades are the filled B0 trades they were drawn around)

| Profile | Real B0 gross | Bias-only random gross | No-bias random gross | Real − bias-only (90% CI) | Bias-only − no-bias (90% CI) |
|---|---|---|---|---|---|
| P1 | −0.021 | −0.054 (5760) | +0.050 (5760) | +0.033 (−0.05 … +0.12) | −0.103 (−0.16 … −0.04) |
| P2 | −0.089 | −0.040 (25276) | −0.008 (25290) | −0.049 (−0.09 … −0.01) | −0.032 (−0.07 … −0.00) |

### D4 HTF turn and trigger on the same bar (B0 reversal setups)

- P1: 44 of 941 (4.7%)
- P2: 203 of 4496 (4.5%)

### D5 grade ranking (avg net R by grade)

| Variant | Profile | A+ | A | B |
|---|---|---|---|---|
| B0 | P1 | −0.117 (640) | −0.005 (437) | +0.160 (75) |
| B0 | P2 | −0.168 (2179) | −0.157 (2368) | −0.078 (511) |

- Portfolio B0 P1: -50.2% total, CAGR -22.3%, max DD 62.1%, 785 trades (425 skipped by the risk caps), longest losing streak 19, worst month -12.9% of the start
- Portfolio B0 P2: -98.8% total, CAGR -79.7%, max DD 98.9%, 3371 trades (1969 skipped by the risk caps), longest losing streak 21, worst month -21.9% of the start
- Portfolio B0 P1+P2: -98.1% total, CAGR -75.8%, max DD 98.3%, 3003 trades (3763 skipped by the risk caps), longest losing streak 27, worst month -26.6% of the start
- Portfolio F3 P1: -11.3% total, CAGR -4.4%, max DD 21.8%, 157 trades (30 skipped by the risk caps), longest losing streak 10, worst month -10.0% of the start
- Portfolio F3 P1+P2: -11.3% total, CAGR -4.4%, max DD 21.8%, 157 trades (30 skipped by the risk caps), longest losing streak 10, worst month -10.0% of the start
- Portfolio C2a P2: -95.0% total, CAGR -66.2%, max DD 95.5%, 1573 trades (954 skipped by the risk caps), longest losing streak 17, worst month -24.0% of the start
- Portfolio C2a P1+P2: -95.0% total, CAGR -66.2%, max DD 95.5%, 1573 trades (954 skipped by the risk caps), longest losing streak 17, worst month -24.0% of the start
