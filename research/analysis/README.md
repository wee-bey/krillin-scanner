# Profitability search (2026-10-04), research only

Question from Jeffrey: can the system and signals be tweaked to be profitable over the year of replay data, mixing and
matching anything, course or not?

Nothing here touches main, the engine, the replay or `data/`. Full write-up: Project doc `notes/profitability_search.md`.

## Data
- Krillin signals: `data/` on main (59,435 signals, 2025-09-01 → 2026-10-03) and the exit-variant matrix from branch
  `research/entry-stop-tp` (`research/out/R.i16.gz`, 270 entry/stop/target variants per signal).
- Long history: `research/hist/` on this branch, made by `research/fetch-history.js` (workflow `research-history.yml`):
  daily candles for all 883 Binance USDT-M perps since 2021-06 (delisted included), 4h candles and funding for the 762
  coins ever in the daily top 150.

## Scripts (python3 + pandas + scikit-learn; paths point at /home/claude/k/an and /home/claude/krillin-scanner)
| Script | What it does |
|---|---|
| `build.py`, `common.py` | One table of every signal with all its features + the exit-variant R; split helpers, day-clustered t-stats |
| `screen.py`, `screen2.py`, `sigfeat.py` | Every feature bucket on the first half (2025-09 → 2026-04) vs the second (2026-05 → 2026-10); `sigfeat.py` adds candle features (coin trend, returns, distance to MAs, vol, funding) known at signal time |
| `greedy.py` | Greedy rule search on one half, tested on the other |
| `feat.py`, `wf_ml.py`, `wf_ml2.py` | Gradient-boosted selector: half splits, monthly walk-forward (only trades closed before each month), shuffled-label null |
| `hist.py`, `bt.py`, `strats.py` | Daily portfolio backtester on the long history (costs 0.08%/side, funding charged/credited), strategy families |
| `run1.py` | Trend-following (Donchian ensemble), cross-sectional momentum, funding contrarian, 1-day reversal |
| `run2.py`, `run3.py`, `run4.py`, `run5.py` | Market-regime books (BTC vs its N-day average), alts vs BTC |
| `run6.py` | Final regime grid with per-leg volatility sizing (30%/yr target, max 2x) |
| `run7.py` | Execution-delay check (trade 0/4/8/12/24 h after the daily close, 4h candles) |
| `verify.py` | Independent re-implementation of the BTC regime book from the raw CSVs (matches `run6.py`) |
