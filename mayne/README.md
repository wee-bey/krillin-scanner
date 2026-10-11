# Trader Mayne scanner (mayne.*)

The second strategy on this site, built from Trader Mayne's "Trading Bootcamp" playlist. It is a **separate module**: its own engine, data, results and page. It never shares a score, filter or signal with the Krillin scanner. The only thing it reuses is strategy-agnostic plumbing: the Binance archive download approach, the top-100-by-volume universe rule and the cost model, all copied into `mayne/tools/`. No Krillin file is changed.

| File | What it is |
|---|---|
| `lib/engine.js` | The rules engine. It is a line-by-line port of the TradingView indicator `mayne_v1.pine` v1.1 and runs in Node and in the browser. Spec: `MAYNE_RULEBOOK_v1.md` (Project docs / PC folder `TraderMayne\rulebook`). |
| `tools/replay.js` | The multi-coin replay and paper-trade evaluator, with fees, slippage and gap fills. It writes `data/`. |
| `tools/candles.js` | Candle download and cache from data.binance.vision (perps, plus spot for the fidelity checks). |
| `tools/fidelity.js` | Prints the engine's log for one chart in the indicator's Pine Logs format, for comparison with TradingView. |
| `tools/test-engine.js` | Regression checks, run before every replay: ATR, candle alignment, structure, no look-ahead, gates and costs. |
| `data/` | `index.json` (rules and summaries), `trades.json` (every armed setup), `market.json` (BTC regime per day), `sweep.json` (parameter grid) and `fidelity/`. |

The workflow is `.github/workflows/mayne-replay.yml`. It runs daily, and also on a code push (which includes the sweep) or by hand: **Actions → Mayne replay → Run workflow**.

Planning aid only, not financial advice.
