# Fable version (fable/*): regime first, setups second

**Open it:** https://wee-bey.github.io/krillin-scanner/fable/

The Fable version answers the question "based only on the course and its summary, can a profitable scanner and alert system be built?" (Project doc `notes/regime_first_scanner.md`). A year of replay says the Krillin setups alone cannot be made profitable by selection (HANDOFF §5c–§5f); the one piece of the course with evidence behind it is its regime rule. So this module inverts the live scanner's priorities:

1. **The regime is the signal.** BTC's **daily** close above its **daily** MA100 (SMA of 100 daily closes) = risk-on, below = risk-off. Traded as a paper book: A = long BTC in risk-on / short in risk-off, C = long / flat. Each leg is sized to 30%/yr from BTC's trailing 60-day realised volatility (max 2x), the position decided at the 00:00 UTC close is held through the next day, exposure changes pay 0.08% per side, and perp funding is charged. The daily "EMA200" (Krillin's SMMA 99) is shown as a second opinion only.
2. **The setups are a gated watch list,** not trade calls: the 4h and daily signals of the Krillin replay's latest day that pass every gate: direction with the regime (longs in risk-on, shorts in risk-off), the coin's own daily bias with the trade, no pre-pump / shrinking-highs warning, fewer than 2 warnings, stop ≥ 1% (under 2% flagged), no alt longs with BTC at HTF resistance, no D4@1d right after a D4@1h. Weekend / dead-hour timing is a soft flag. The same gates are applied to the whole history, so the gated subset gets a forward test next to the full stream.
3. **Three alert tiers:** a regime flip (the only "act now" message), the daily digest, and the level alerts Jeffrey sets himself in TradingView. Delivery is a Telegram bot driven by the GitHub job.

It is a **separate module** like `krillin-chatgpt/` and `mayne/`: it reads the Krillin replay's `data/` and never writes it; nothing in `tools/`, `index.html` or `dev/` changes.

| File | What it is |
|---|---|
| `index.html` | The page: a live regime card (BTC daily candles fetched by your browser from Binance, Bybit as fallback, the job's data as the last resort), the regime books, the watch list, the gated subset's record, the alert log. |
| `lib/regime.js` | Pure functions, node + browser: SMA / SMMA / ATR, the regime series, the vol-sized books with costs and funding. |
| `lib/gates.js` | Pure functions: the watch-list gates on the replay's signal records, and the stats helpers. |
| `tools/run.js` | The daily job: archive → regime + books; `data/` → gated history + today's watch list; alerts. Writes `fable/data/`. |
| `tools/archive.js` | BTC daily candles and funding from data.binance.vision, with a cache (`.fcache/`). |
| `tools/notify.js` | Telegram delivery; without the secrets it only writes `fable/data/outbox.txt`. |
| `tools/test-fable.js` | Regression checks, run before every job. |
| `data/` | `regime.json` (series, flips, books), `digest.json` (the latest day's watch list and the subset stats), `history.json` (every gated signal with its replay result), `alerts.json`, `state.json`, `last_run.txt`, `outbox.txt`. |

The workflow is `.github/workflows/fable.yml`: three times a day (after the Krillin replay's runs), on a push to `fable/lib`, `fable/tools` or the workflow, or by hand: **Actions → Fable → Run workflow**.

**Telegram:** create a bot with @BotFather, get your chat id (send the bot a message, then read `https://api.telegram.org/bot<token>/getUpdates`), and add the repository secrets `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` (Settings → Secrets and variables → Actions). The next run sends a start message; flips and digests follow. The job never logs the token.

**Honest expectations (from the first run, 2026-10-16, archive through 2026-10-14):**
- Book A: +24.6% over the replay year (2025-09 → 2026-10), +90% since 2022 (CAGR 13.8%, Sharpe 0.56, max drawdown −37%); book C: +2.2% / +96% (Sharpe 0.70, max DD −25%). BTC buy & hold over the same windows: −25% / +71%. About 70 switches since 2021-06; not statistically proven on its own (t ≈ 1.3–1.7, HANDOFF §5f).
- The gated subset of the Krillin setups: 1,843 of 19,142 4h/daily signals passed over the year; +0.03R per trade, PF 1.08 (first half +0.046R, second half −0.013R). About breakeven, not an edge: that is why they are a watch list. Almost all of them were shorts in risk-off, because the engine's "BTC at HTF resistance" flag fired on 122 of the 125 risk-on days and the course forbids alt longs then; risk-on longs that passed every other gate did +0.03R without the flag (38 trades) and −0.10R with it (627).
- The replay's R has no funding; the books do.

Planning aid only, not financial advice.
