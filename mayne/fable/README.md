# Trader Mayne · Fable (mayne.*)

The third version of the Mayne module. It sits next to v1.1 (`mayne/`) and v1.2 (`mayne/v1.2/`), both unchanged, and,
like them, never shares a score, filter or signal with the Krillin scanner.

**Status: not validated.** The Fable test (`FABLE_PLAN.md`, written before any result) checked Mayne's own trade
management and the entry rules he teaches that v1.2 never coded. Everything that looked better on 2021–23 was worse on
2024–26 (`RESULTS.md`). Every Fable switch ships off; the board and the indicator remain a candidate list for
discretionary review, and a daily forward test tracks the Fable sets from 17 Oct 2026 as information.

| Path | What it is |
|---|---|
| `index.html` | The Fable board (https://wee-bey.github.io/krillin-scanner/mayne/fable/): live states for P1, P2, P1D, P2D, the Fable switches, checks and exit mode per card, Evidence tab. |
| `lib/engine.js` | The Fable engine: v1.2 plus the Fable switches and the direct profiles. Defaults give exactly v1.2's trades (`tools/test-engine.js`). |
| `indicator/mayne_fable.pine` | TradingView script `mayne.fable · Trader Mayne System` (new; `mayne.v1` and `mayne.v1.2` unchanged). |
| `FABLE_PLAN.md` | The pre-registered plan, its addendum, the log of the one confirm look and the outcome. |
| `FIDELITY_V24.md` | The engine against Mayne's one dated trade. |
| `RESULTS.md`, `research/` | The results; `research/` holds each run's report. |
| `tools/research.js`, `analyze.js`, `research-merge.js`, `make-evidence.js`, `forward.js`, `fidelity.js`, `funding.js`, `test-engine.js`, `test-page.js` | Research replay (sharded by `.github/workflows/mayne-fable-research.yml`, results on branch `mayne-fable-results`), statistics and selection, evidence builder, daily forward test (`mayne-fable-forward.yml`), engine and board checks. |
| `HANDOFF.md` | Where things stand and what is next. |

Planning aid only, not financial advice.
