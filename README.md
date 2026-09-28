# Krillin Scanner

A crypto market scanner built on the rules of Krillin's Education (The Haven) MA/EMA system. It scans the top coins by volume and ranks them by how close they are to an A+ setup. For each coin it gives a full guide: per-timeframe bias, levels, plans, and an optional Ask Claude section.

**Open it:** https://wee-bey.github.io/krillin-scanner/
On a phone, tap Share → "Add to Home Screen".

- All market data (CoinGecko, Binance and Bybit public APIs) is fetched by your own browser. Nothing is sent anywhere else.
- Settings, favourites, the journal and the optional Anthropic API key stay in the browser of the device you use.
- Planning aid only, not financial advice.

## Signal results (the Results tab)
The **Results** button opens a report on how every signal the scanner would have sent played out. It has a day filter (and 7 days, 30 days, All), filters for grade, setup, timeframe and direction, and a **Copy link** button: `…/krillin-scanner/#results/2026-09-27` opens that day directly.

How the data is made:
- `.github/workflows/replay.yml` runs `tools/replay.js` on GitHub four times a day.
- It replays the scanner's 15-minute scans for each finished UTC day. It uses the same engine (`tools/lib/engine.js`, a copy of the dashboard's) on the top 100 Binance USDT-M perpetuals, with candles from Binance's public data archive (data.binance.vision).
- Every setup that turns active with no blocks counts as a signal, at every grade; the A and A+ ones are marked "alerted". Each signal is paper-traded on 15m candles with its own plan: 4 bids, the stop, the TP ladder with the de-risk rule, fees and slippage.
- The results are committed to `data/` (one JSON file per month) and read by the Results tab.
- The archive is published a few hours after each UTC day ends, so the latest replayed day is usually yesterday. The first run backfills the last 30 days.

To run it by hand: **Actions → Signal replay → Run workflow**.
