# Trader Mayne v1.2 (mayne.*)

The second version of the Mayne module. It sits next to v1.1 (`mayne/`, unchanged) and, like v1.1, never shares a
score, filter or signal with the Krillin scanner.

**Status: not validated.** The v1.2 test (`TEST_PLAN.md`, written before any result) found no edge in Mayne's rules as
coded, nor in any of 18 rule ideas or their combinations, nor in a confluence with Krillin's signals
(`CONFLUENCE_PLAN.md`). Summary: `RESULTS.md`. The board and the indicator therefore present setups as a candidate list
for discretionary review, and a daily forward test scores every setup from 12 Oct 2026 on.

| Path | What it is |
|---|---|
| `index.html` | The v1.2 board (https://wee-bey.github.io/krillin-scanner/mayne/v1.2/): live states, Mayne checks and costs per card, Evidence tab (research + forward test). |
| `lib/engine.js` | The v1.2 engine: the v1.1 engine plus switches for every candidate rule. With the switches at their defaults it gives exactly v1.1's trades (checked in `tools/test-engine.js`). |
| `indicator/mayne_v1.2.pine` | The TradingView indicator `mayne.v1.2 · Trader Mayne System` (a new script; `mayne.v1` is unchanged). |
| `MAYNE_RULEBOOK_v1.2.md` | The spec: v1.1 rules unchanged, plus §16 (v1.2 switches, execution model) and §17 (outcome). |
| `TEST_PLAN.md`, `CONFLUENCE_PLAN.md` | The pre-registered plans, with their dated addenda and the log of every look at held-out data. |
| `RESULTS.md`, `research/` | The results; `research/` holds the raw reports of each run. |
| `tools/research.js` | Research replay: every variant per coin and profile, realistic fills and costs (maker/taker, trade-through, funding), diagnostics (excursions, random-entry baselines), Mayne state log. Sharded in `.github/workflows/mayne-v12-research.yml`; results go to the branch `mayne-v12-results`. |
| `tools/analyze.js` | Statistics (week-block bootstrap), the selection rule, diagnostics, portfolio simulation. |
| `tools/confluence.js` | The Mayne × Krillin join. |
| `tools/forward.js` | Builds the forward-test files (`data/forward-*.json`) in `.github/workflows/mayne-v12-forward.yml`, daily on main. |
| `tools/fidelity.js` | Engine logs for the indicator checks (`.github/workflows/mayne-v12-fidelity.yml`). |
| `tools/funding.js`, `tools/export-sample.js` | Funding-rate plumbing; a research sample exported to the branch `mayne-v12-sample`. |
| `tools/make-evidence.js` | Builds `data/evidence.json` for the Evidence tab. |
| `tools/test-engine.js`, `test-page.js` | Engine checks; headless browser test of the board. |

Planning aid only, not financial advice.
