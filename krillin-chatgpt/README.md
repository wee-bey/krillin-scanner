# Krillin Chatgpt

This is a separate scanner at `/krillin-chatgpt/`. The original scanner, its storage, historical archives, engine, and replay workflow are unchanged. GitHub Pages serves the new directory after this addition is merged into the published branch.

## Use

Open the page and choose **Scan now**. Optionally enable **Scan every 15 minutes**. Scans run while this page is open and visible; this is not a hosted, always-on bot. The first 100-market scan can take several minutes because it loads history; later scans reuse validated candle data.

The page shows grouped qualified ideas, valid research plans outside the shortlist, and rejected candidates with reasons. Choose an idea to inspect its original observation time, exact exchange contract, plan, costs, and supporting observations. **Export log** saves all observations, decisions, upgrades, rule cohorts, and modeled outcomes from this browser. Keep an export before clearing browser storage or changing devices.

No API key is requested, no orders are placed, and no messages are sent. Binance public data must be reachable from your browser and region. Regional restrictions, rate limits, stale quotes, missing BTC context, and invalid candles stop qualification; there is no silent Bybit, spot, or CoinGecko substitution.

## The six improvements

1. **Truthful timing.** Indicator inputs use a single closed-candle cutoff. Decisions use actual exchange observation time and a fresh executable bid/ask. A later grade or decision change is a separate event; an original entry or classification is never rewritten.
2. **Plan validity and costs.** Reject crossed stops/TP1, wrongly ordered targets/entries, invalid data, gated/inactive setups, and full-plan weighted reward that is nonpositive after modeled costs. The target weights match the actual partial-exit model. TP1 is never described as guaranteeing a risk-free remainder.
3. **One trade idea.** Fixed priority B4, C3, C6 12h, then C6 4h selects a primary overlapping plan. Other observations support that same symbol/direction/entry-zone idea. One setup/timeframe episode stays frozen while unresolved, with a 12-hour repeat window after completion; all raw observations remain in the log.
4. **Provisional shortlist.** B4, C3, and C6 on 4h/12h qualify for the main research feed. Other valid setups remain available for counterfactual research. This shortlist was selected retrospectively from a losing month and is not a validated future edge.
5. **Evidence instead of confidence grades.** The original archive supplies exploratory setup/timeframe evidence. Forward counts, open plans, net mean R, profit factor, and recent results are separate. Grades, weekdays, and past winning coins never promote a plan.
6. **Frozen forward observation.** The rule version, source-code digest, feed, account/risk settings, and universe size identify each cohort. Changed settings or source code create separate cohorts. Accepted/rejected labels stay fixed. Incomplete future candle coverage is excluded from closed metrics, with the issue retained explicitly.

## Market and paper model

The universe consists of supported active Binance USDT-M perpetuals ranked by the previous completed UTC day's quote volume, with metadata and explicit stable/wrapped/index/metal/equity exclusions. There is no current-volume historical fallback. All scanned symbols request up to 1,000 closed native 15m/1h/4h/daily bars, requiring at least 300 fresh, contiguous bars. Derived 12h/3d/weekly indicators reuse the original engine. Younger listings may lack long derived-indicator warm-up; their native counts appear in the detail/log.

Fresh bid/ask quotes validate the plan when the observation is emitted. Independent paper orders activate at the **next complete 15-minute opening**, so the model never uses a pre-observation wick or ignores exposure in a partially elapsed bar. Limit entries fill conservatively at their bid/open price. Stops precede targets when both are touched; a new fill and target in one candle earns no target profit on that candle. Subsequent TP1 fractions use actual filled average entry. TP2 takes 4/7 of the remainder when there are three targets; the final target closes the rest. Fixed stops, 20 setup-candle entry windows, and 100 setup-candle holding limits remain explicit.

The defaults are $5,000 reference capital and 2% risk, **$100 across the full entry ladder**. Quantity is sized against the original limit ladder and stop, including 0.05% fee per side plus 0.03% total modeled slippage. Actual fills and exit costs determine R. Stop gaps can exceed planned risk. Target reward figures are conditional full-plan estimates, not expected returns or probabilities.

Paper plans have no shared capital, combined-risk cap, funding, liquidation, latency, or order-book execution model. Their summed R and R drawdown are not account returns or account drawdown. Forward comparison is between independent valid active paper candidates; invalid plans remain logged but cannot have a meaningful trade outcome. Supporting signals and accepted/rejected samples are correlated.

Observation snapshots use a separate IndexedDB database `krillin-chatgpt`; preferences use `krillin-chatgpt-settings-v1`. A revision check prevents another open tab from overwriting a newer saved log. Storage errors halt collection and offer export of unsaved observations. No old log is automatically removed.

## Local development and checks

Serve the repository root over HTTP, for example `python -m http.server 8000`, then open `http://localhost:8000/krillin-chatgpt/`. A direct `file://` opening is unsupported because the scanner reads local scripts and historical JSON over HTTP.

No package installation or build step is needed. With Node.js installed:

```sh
node krillin-chatgpt/test-core.js
node krillin-chatgpt/test-market.js
node krillin-chatgpt/test-app.js
node tools/test-replay.js
```

Tests cover timing, partial fills, cost-aware quantities, gap handling, target allocations, immutable observations, deduplication, repeated episodes, cohort changes, rejected counterfactuals, and market failures with deterministic responses. They do not establish strategy profitability.

Market schema reference: [Binance USD-M public market data](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data).
