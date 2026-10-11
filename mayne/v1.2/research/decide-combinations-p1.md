# Mayne v1.2 research: P1 combinations on DECIDE (raw report)

Setups armed 2021-01-01 → 2023-12-31 · engine mayne.v1.2-js.1 · 2591 rows · made 2026-10-11T18:22:06.482Z

## P1

| Variant | Closed | Win | Avg R net | 90% CI | Avg R gross | v1.1 costs | PF | Δ vs B0 | Δ by year | per month |
|---|---|---|---|---|---|---|---|---|---|---|
| B0 | 1264 | 27% | −0.146 | −0.23 … −0.06 | −0.111 | −0.149 | 0.81 |  |  | 35.3 |
| C4-10 | 187 | 26% | −0.183 | −0.35 … −0.01 | −0.144 | −0.179 | 0.76 | −0.036 | −0.01 / +0.01 / −0.09 | 5.3 |
| C4-20 | 335 | 25% | −0.216 | −0.35 … −0.07 | −0.178 | −0.214 | 0.72 | −0.069 | −0.00 / −0.09 / −0.12 | 9.5 |
| C4-50 | 744 | 25% | −0.209 | −0.31 … −0.10 | −0.174 | −0.210 | 0.73 | −0.062 | −0.10 / −0.06 / −0.02 | 20.8 |
| C4-maj | 49 | 18% | −0.440 | −0.72 … −0.10 | −0.401 | −0.441 | 0.48 | −0.293 | −0.40 / +0.15 / −0.45 | 1.4 |
| F1 | 332 | 32% | +0.011 | −0.17 … +0.21 | +0.069 | +0.030 | 1.02 | +0.158 | +0.27 / +0.82 / −0.09 | 9.3 |
| F2 | 167 | 34% | +0.095 | −0.16 … +0.36 | +0.159 | +0.123 | 1.13 | +0.241 | +0.37 / +0.90 / −0.18 | 4.7 |
| F3 | 152 | 32% | +0.105 | −0.17 … +0.40 | +0.171 | +0.129 | 1.15 | +0.252 | +0.39 / +0.98 / −0.21 | 4.3 |
| F4 | 141 | 35% | +0.094 | −0.15 … +0.35 | +0.150 | +0.108 | 1.17 | +0.241 | +0.32 / +0.73 / −0.08 | 4.0 |
| F5 | 117 | 33% | +0.079 | −0.15 … +0.37 | +0.133 | +0.093 | 1.13 | +0.225 | +0.27 / +0.54 / −0.02 | 3.3 |

## Diagnostics

### D1 excursions (filled B0 trades)

| Profile | Trades | Median MFE to exit | Median MAE to exit | Median MFE in window | Reached +1R before −1R | +2R | +3R | Same-candle (D6) |
|---|---|---|---|---|---|---|---|---|
| P1 | 1264 | +0.91R | +1.12R | +1.56R | 47% | 30% | 23% | 0 |

### D2 random-entry baselines (gross R per trade; the real trades are the filled B0 trades they were drawn around)

| Profile | Real B0 gross | Bias-only random gross | No-bias random gross | Real − bias-only (90% CI) | Bias-only − no-bias (90% CI) |
|---|---|---|---|---|---|
| P1 | −0.111 | −0.089 (6320) | +0.009 (6320) | −0.022 (−0.10 … +0.06) | −0.098 (−0.16 … −0.04) |

### D4 HTF turn and trigger on the same bar (B0 reversal setups)

- P1: 41 of 944 (4.3%)

### D5 grade ranking (avg net R by grade)

| Variant | Profile | A+ | A | B |
|---|---|---|---|---|
| B0 | P1 | −0.152 (661) | −0.144 (514) | −0.115 (89) |

- Portfolio B0 P1: -77.9% total, CAGR -39.6%, max DD 83.5%, 858 trades (477 skipped by the risk caps), longest losing streak 26, worst month -11.2% of the start
- Portfolio B0 P1+P2: -77.9% total, CAGR -39.6%, max DD 83.5%, 858 trades (477 skipped by the risk caps), longest losing streak 26, worst month -11.2% of the start
- Portfolio F5 P1: 2.9% total, CAGR 1.0%, max DD 18.3%, 99 trades (27 skipped by the risk caps), longest losing streak 10, worst month -11.3% of the start
- Portfolio F5 P1+P2: 2.9% total, CAGR 1.0%, max DD 18.3%, 99 trades (27 skipped by the risk caps), longest losing streak 10, worst month -11.3% of the start
- Portfolio F4 P1: 2.0% total, CAGR 0.7%, max DD 19.0%, 122 trades (28 skipped by the risk caps), longest losing streak 11, worst month -8.1% of the start
- Portfolio F4 P1+P2: 2.0% total, CAGR 0.7%, max DD 19.0%, 122 trades (28 skipped by the risk caps), longest losing streak 11, worst month -8.1% of the start
- Portfolio F3 P1: 1.1% total, CAGR 0.4%, max DD 21.8%, 122 trades (41 skipped by the risk caps), longest losing streak 15, worst month -13.3% of the start
- Portfolio F3 P1+P2: 1.1% total, CAGR 0.4%, max DD 21.8%, 122 trades (41 skipped by the risk caps), longest losing streak 15, worst month -13.3% of the start
- Portfolio F2 P1: 3.3% total, CAGR 1.1%, max DD 20.5%, 133 trades (45 skipped by the risk caps), longest losing streak 15, worst month -15.0% of the start
- Portfolio F2 P1+P2: 3.3% total, CAGR 1.1%, max DD 20.5%, 133 trades (45 skipped by the risk caps), longest losing streak 15, worst month -15.0% of the start
- Portfolio F1 P1: 8.2% total, CAGR 2.7%, max DD 31.8%, 214 trades (140 skipped by the risk caps), longest losing streak 15, worst month -22.0% of the start
- Portfolio F1 P1+P2: 8.2% total, CAGR 2.7%, max DD 31.8%, 214 trades (140 skipped by the risk caps), longest losing streak 15, worst month -22.0% of the start
