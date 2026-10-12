# Trader Mayne System: HANDOFF (read this first in a new chat)

_Last updated: 11 Oct 2026 (night). v1.2 is built and tested: no edge found, kill rule applied. v1.2 lives next to
v1.1; nothing in v1.1 was changed. The previous handoff is kept as `HANDOFF_v1.1.md`._

## Goal
Turn Trader Mayne's "Trading Bootcamp" playlist (26 videos) into a usable crypto system: a TradingView indicator and a
scanner that show setups as they form, arm and go active, with Entry/SL/TP.

## Where things stand
- **v1.1** (Milestones 1–3): the rulebook, indicator `mayne.v1` (TradingView script v9.0), the scanner/board at
  `/mayne/`, and the replay. All unchanged.
- **v1.2** (11 Oct 2026): Jeffrey asked Claude to take over and improve the system, its profitability, the
  indicator's look and feel, and the scanner, saving everything as a new version.
  - **Research.** A pre-registered test (`TEST_PLAN.md`) covered 18 rule ideas, 4 gate removals and combinations, on
    745 coins, with realistic fills and costs. Rules were chosen on 2021–23 and checked once on 2024–26. Result:
    **FAIL** for both profiles.
    - P1's best (BTC agrees + young trend + trigger-TF sweep): +0.105R on 2021–23 → −0.028R on 2024–26.
    - P2's best: −0.201R.
    - Random entries in the same direction do as well as the setups. Mayne's gates don't filter. A+ ranks worst.
  - **Krillin confluence.** Jeffrey asked for this explicitly, which lifts his "never mix" rule for research only.
    Separate pre-registered test (`CONFLUENCE_PLAN.md`): no profitable combination. Mayne P1 with no opposite
    Krillin signal in 24 h made +0.01R on 2026's held-out months; it is tracked in the forward test only.
  - **Kill rule applied.** The board and the indicator are a candidate list for discretionary review; ARMED is
    labelled "not validated"; no further tuning on this history.
  - **Deliverables.**
    - Indicator `mayne.v1.2 · Trader Mayne System` (new TradingView script `USER;5e3f1eb6904c4e74b7882531c86c8187`,
      on Jeffrey's chart; `mayne.v1` is hidden there, not removed).
    - Board `/mayne/v1.2/` and the rulebook `MAYNE_RULEBOOK_v1.2.md`.
    - `RESULTS.md` and a daily forward test from 12 Oct 2026.

## Ground rules (Jeffrey)
- Mayne stays a separate module (`mayne.*`). The Krillin confluence was research at his request; neither system's code
  or signals changed.
- New work goes into a **new version**; never overwrite the previous one.
- Optional modules have their own toggle, off by default; anything not Mayne's is labelled "not Mayne".
- Uncluttered chart, readable text, labels off the candles unless they mark a price level.
- No tuning on one regime; relative (ATR/R) parameters only, never fixed prices.
- Model usage: Opus manages and writes core logic; cheaper models for grunt work (Haiku under 100k tokens per chat).
- Research discipline (new in v1.2): write the plan before looking. Split decide/confirm. Log every look at held-out
  data. Apply the kill rule.

## Files
**Single source of truth: the Project docs.** The repo and the PC folder carry copies.
| What | Where |
|---|---|
| Code | GitHub `wee-bey/krillin-scanner`, folder `mayne/v1.2/` (branch `mayne-v1.2`, PR to main). README there lists every file. |
| Research data | Orphan branch `mayne-v12-results` (`decide/`, `decide-combos-p1/`, `confirm/`, `confluence-mayne/`, `fidelity/`); research sample in `mayne-v12-sample` |
| Docs | Project: `V1.2_TEST_PLAN.md`, `V1.2_CONFLUENCE_PLAN.md`, `V1.2_RESULTS.md`, `MAYNE_RULEBOOK_v1.2.md`, this HANDOFF (old one: `HANDOFF_v1.1.md`) |
| PC folder | `C:\Users\Jeffrey\Desktop\TraderMayne\v1.2\` (indicator, rulebook, plans, results). v1.1 files untouched. |

## v1.2 indicator (what changed)
- Settings are hidden from the status line (`display = display.none`).
- Compact status table: bias, setup, **Next** (what to wait for), trade, size, checks. There is a Full mode. The
  table is created once, so a new position applies after a reload.
- Risk/reward shading on the live trade (red entry→SL, green entry→PT). It fades after the trade and is removed for
  setups that never filled.
- Checks: "sweep ✓/✗", "BTC ✓/✗", "tag #n", in the table, the tooltip and the alerts.
- Alerts are named `mayne12 …`, say "(not validated)", and there is a TIME STOP alert.
- v1.2 switches, all off: C1c, C2a (with a BTC symbol input), C7, C8b, C9b. Trade-through 0.02%.
- Fidelity (BTCUSDT spot H1 from 2024-01-01), identical tallies:
  - indicator vs engine: 19/16/7W9L/+8.1R (defaults), 4/3/2W1L/+4.8R (C1c + C7 = 2 + C8b = 12 + C9b);
  - v1.2 with trade-through 0 = v1.1's 19/16/7W9L/+8.1R.

## How to work with TradingView from a session (updated)
- **Compile check:** POST multipart `source` to
  `https://pine-facade.tradingview.com/pine-facade/translate_light?user_name=Guest&pine_id=00000000-0000-0000-0000-000000000000`
  from a tradingview.com page. Errors are in `result.errors2`; it catches type errors and unknown functions.
- **Save:**
  - a new script: `POST /pine-facade/save/new/?name=<name>&allow_overwrite=false`;
  - a new version: `POST /pine-facade/save/next/<URL-encoded id>/?allow_create_new=false&name=<name>` (both
    multipart `source`, credentials included);
  - list saved scripts: `GET /pine-facade/list/?filter=saved`.
- **Getting the source into the page:** fetch it from `raw.githubusercontent.com/wee-bey/krillin-scanner/<commit sha>/…`
  inside the page (the sandbox cannot reach pine-facade itself).
- **Chart API:**
  - `window.TradingViewApi.activeChart()` gives `getAllStudies()` and `getStudyById(id)` with `setInputValues`,
    `getInputsInfo` and `setVisible`.
  - `setVisibleRange` is not implemented; use Alt+G, set the date input's value with the native setter, then click
    "Go to".
- **Reading Pine output without the canvas:**
  - Table cells are at
    `getStudyById(id).study().graphics()._primitivesCollection.dwgtablecells.tableCells._primitivesDataById` (`.t` =
    text).
  - Pine Logs are in `…_primitivesCollection.logs`.
  - This works even when the desktop window is covered, which stops the page from redrawing and makes screenshots
    stale.
- **Actions logs:** blob URLs are blocked from the sandbox but open in the built-in browser (signed URL from
  `GET /repos/…/actions/jobs/<id>/logs`).

## Running the research
- Edit `mayne/v1.2/research-run.json` (name, armed-date window, variants, `custom` specs, `events`), then push to
  `mayne-v1.2`. Eight shards run, and the merged result lands in `mayne-v12-results/<name>/`.
- Then `node mayne/v1.2/tools/analyze.js --dir <result> [--select] [--portfolio V]`.
- **analyze.js derives the C4 universe tiers from B0 automatically.** On a held-out run, that is an extra look; log
  it.

## NEXT
1. **Jeffrey:**
   - Merge the v1.2 PR (GitHub → Pull requests). After the merge, open https://wee-bey.github.io/krillin-scanner/mayne/v1.2/.
   - The forward test starts with the first daily run after the merge (08:13 UTC).
2. **Jeffrey:** glance at `mayne.v1.2` on the chart: the compact table, the shading on the next live trade, and
   whether the checks help your own judgment. `mayne.v1` is hidden on the layout, not deleted.
3. In 2–3 months, read the forward-test numbers on the Evidence tab before deciding anything.
4. The only new ideas worth a fresh pre-registered test:
   - a blind chart review of your own discretion (40 setups shown up to the arm, take/skip, then reveal);
   - the two untested leads in `RESULTS.md` (P1 continuation ≈ break-even; with-bias entries worse than random).
