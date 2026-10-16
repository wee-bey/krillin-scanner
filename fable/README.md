# Fable version (fable/*): regime first, setups second

**Open it:** https://wee-bey.github.io/krillin-scanner/fable/

The Fable version answers the question "based only on the course and its summary, can a profitable scanner and alert system be built?" (Project doc `notes/regime_first_scanner.md`). A year of replay says the Krillin setups alone cannot be made profitable by selection (HANDOFF §5c–§5f); the one piece of the course with evidence behind it is its regime rule. So this module inverts the live scanner's priorities:

1. **The regime is the signal.** BTC's **daily** close above its **daily** MA100 (SMA of 100 daily closes) = risk-on, below = risk-off. Traded as a paper book: A = long BTC in risk-on / short in risk-off, C = long / flat. Each leg is sized to 30%/yr from BTC's trailing 60-day realised volatility (max 2x), the position decided at the 00:00 UTC close is held through the next day, exposure changes pay 0.08% per side, and perp funding is charged. The daily "EMA200" (Krillin's SMMA 99) is shown as a second opinion only.
2. **The setups are a gated watch list,** not trade calls, in two places: a **live scan** in the page (the top 100 Binance USDT-M perps by 24 h volume, scanned in your browser with the same engine as the scanner and the replay, candles cached in IndexedDB and fetched incrementally; Bybit as the fallback exchange), and the **replay watch list** (the 4h and daily signals of the Krillin replay's latest day, about a day behind). Both apply the same gates: direction with the regime (longs in risk-on, shorts in risk-off), the coin's own daily bias with the trade, no pre-pump / shrinking-highs warning, fewer than 2 warnings, stop ≥ 1% (under 2% flagged), no D4@1d right after a D4@1h. Weekend / dead-hour timing and "BTC at HTF resistance" are soft flags: the engine raises the resistance flag on 95% of days and alt longs do no worse when it is on (Project note `regime_alignment_funding.md`), so since 2026-10-16 it no longer blocks. The same gates are applied to the whole replay history, so the gated subset gets a forward test next to the full stream.
3. **Three alert tiers:** a regime flip (the only "act now" message), the daily digest, and the level alerts Jeffrey sets himself in TradingView. Delivery is a Telegram bot driven by the GitHub job.

It is a **separate module** like `krillin-chatgpt/` and `mayne/`: it reads the Krillin replay's `data/` and never writes it; nothing in `tools/`, `index.html` or `dev/` changes.

| File | What it is |
|---|---|
| `index.html` | The page: a live regime card (BTC daily candles fetched by your browser from Binance, Bybit as fallback, the job's data as the last resort), the regime books, the watch list, the gated subset's record, the alert log. |
| `lib/regime.js` | Pure functions, node + browser: SMA / SMMA / ATR, the regime series, the vol-sized books with costs and funding. |
| `lib/gates.js` | Pure functions: the watch-list gates on signal records (replay or live), and the stats helpers. |
| `lib/scan.js` | The live scan (browser): universe, candle cache, one scan with `tools/lib/engine.js` in the replay's record shape, then the gates. Testable in node with injected fetchers. |
| `tools/run.js` | The daily job: archive → regime + books; `data/` → gated history + today's watch list; alerts. Writes `fable/data/`. |
| `tools/archive.js` | BTC daily candles and funding from data.binance.vision, with a cache (`.fcache/`). |
| `tools/notify.js` | Telegram delivery; without the secrets it only writes `fable/data/outbox.txt`. |
| `tools/test-fable.js` | Regression checks, run before every job (the last one runs the live scan on BTC/ETH/SOL with archive candles). |
| `data/` | `regime.json` (series, flips, books), `digest.json` (the latest day's watch list and the subset stats), `history.json` (every gated signal with its replay result), `alerts.json`, `state.json`, `last_run.txt`, `outbox.txt`. |

The workflow is `.github/workflows/fable.yml`: three times a day (after the Krillin replay's runs), on a push to `fable/lib`, `fable/tools` or the workflow, or by hand: **Actions → Fable → Run workflow**.

**Telegram:** create a bot with @BotFather, get your chat id (send the bot a message, then read `https://api.telegram.org/bot<token>/getUpdates`), and add the repository secrets `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` (Settings → Secrets and variables → Actions). The next run sends a start message; flips and digests follow. The job never logs the token.

**Honest expectations (from the first run, 2026-10-16, archive through 2026-10-14):**
- Book A: +24.6% over the replay year (2025-09 → 2026-10), +90% since 2022 (CAGR 13.8%, Sharpe 0.56, max drawdown −37%); book C: +2.2% / +96% (Sharpe 0.70, max DD −25%). BTC buy & hold over the same windows: −25% / +71%. About 70 switches since 2021-06; not statistically proven on its own (t ≈ 1.3–1.7, HANDOFF §5f).
- The gated subset of the Krillin setups (the page's "How the gated subset has done" table has the current figures): with the resistance rule as a hard gate it was 1,843 of 19,142 4h/daily signals, +0.03R, PF 1.08 (first half +0.046R, second −0.013R), almost all shorts in risk-off; with it as a flag (since 2026-10-16) the risk-on longs are back in: 2,493 signals, −0.003R, PF 0.99 (first half +0.011R, second −0.025R); the longs in it did −0.095R (PF 0.78, 663 closed), the shorts +0.03R (PF 1.08). Not an edge, and the risk-on longs are the weak half: that is why they are a watch list, and why the regime book carries the long exposure.
- The replay's R has no funding; the books do.

Planning aid only, not financial advice.
