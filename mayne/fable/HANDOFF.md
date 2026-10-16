# Trader Mayne System: HANDOFF — Fable version (read this first in a new chat)

_Last updated: 16 Oct 2026, 07:00 Beirut. Fable is built and tested: no edge found on 2024–26, kill rule applied. Fable
lives in `mayne/fable/` on branch `mayne-fable` (PR to main open); v1.1 (`mayne/`) and v1.2 (`mayne/v1.2/`) are untouched.
The v1.2 handoff is `../v1.2/HANDOFF.md`._

## Goal of the Fable version
Jeffrey asked: "based on the education section, improve on and make the setups and alerts more profitable", saved as a
NEW version ("fable"), nothing existing overwritten. The education section = the 26-video rulebook material.

## What was done
1. **Fidelity check** (`FIDELITY_V24.md`): the engine reproduces Mayne's one dated trade (V24, BTC short 21 May 2026) at
   the entry, stop and final target, but not his exit (he held the runner on its original stop to 60,000 for ≈ 11R; the
   v1.1 exit trailed out at +2.8R and re-entered twice for −2R).
2. **Pre-registered plan** (`FABLE_PLAN.md`): Stage A exit candidates, Stage B entry rules (direct profiles P1D / P2D,
   continuation-only, daily-bias V22, Power of 3 V10, OB+FVG overlap V07, killzones / Silver Bullet), decide 2021–23 /
   confirm 2024–26, pass/kill rule.
3. **Engine, tools, workflows, indicator, board** — see `RESULTS.md` "What changed".
4. **Runs:** decide-A, decide-B, decide-F, confirm (orphan branch `mayne-fable-results`; reports in `research/`).
5. **Outcome:** FAIL on every profile (`RESULTS.md`, plan §9b). Every switch ships off; ARMED stays "not validated".
6. **Independent verification** (separate agent): DECIDE numbers, selection and split re-derived from raw rows — all
   match; no look-ahead in the new rules.

## Where things stand
| What | Where |
|---|---|
| Code, plan, fidelity, results, reports | GitHub `wee-bey/krillin-scanner` branch `mayne-fable`, folder `mayne/fable/` — PR to main for Jeffrey to merge |
| Research data | orphan branch `mayne-fable-results` (`decide-A/`, `decide-B/`, `decide-F/`, `confirm/`) |
| Board | `/mayne/fable/` → https://wee-bey.github.io/krillin-scanner/mayne/fable/ after the merge |
| Forward test | `.github/workflows/mayne-fable-forward.yml`, daily 08:41 UTC on main after the merge; setups from 17 Oct 2026; shipped set B0, tracked B1 / F_P1 / F_P2 |
| Indicator | TradingView script `mayne.fable · Trader Mayne System` (`USER;807c67e6aa7149f3830909f2dd3b9963`), saved in Jeffrey's account; not yet on a chart |
| Project docs | `FABLE_PLAN.md`, `FABLE_FIDELITY_V24.md`, `FABLE_RESULTS.md`, `FABLE_HANDOFF.md` (+ the four run reports) |
| PC folder | `C:\Users\Jeffrey\Desktop\TraderMayne\fable\` |

## Ground rules (unchanged)
Mayne separate from Krillin · new version, never overwrite · optional modules toggleable, off by default, "not Mayne"
labelled · uncluttered chart · no tuning on one regime, relative parameters only · plan before looking, decide/confirm,
log every look, kill rule · Opus for core logic, cheaper models for grunt work.

## NEXT
1. **Jeffrey:** merge the `mayne-fable` PR (GitHub → Pull requests). The forward test starts with the first daily run
   after the merge. Open the board and the Evidence tab.
2. **Jeffrey:** add `mayne.fable` to a BTCUSDT H1 chart (P1) and compare its tally with
   `node mayne/fable/tools/fidelity.js --sym BTCUSDT --market spot --profile P1 --chart-from 2024-01-01` (defaults
   should equal v1.2's 19 armed · 16 filled · 7W/9L · +8.1R). Not yet checked on the chart.
3. Read the forward numbers in 2–3 months before deciding anything. The only set worth watching is P1's
   continuation + overlap (tracked as F_P1).
4. Remaining honest questions, each needing a new plan: a regime-conditional exit (with a moved split), and the blind
   discretion test (`../v1.2/RESULTS.md`).

## How to run the research (Fable)
Edit `mayne/fable/research-run.json` (name, window, variants, profiles, diag, custom specs with `"fable": "exit"` for a
profile's Stage A exit and `"only": [...]` to restrict profiles) and push to `mayne-fable`; 8 shards; result lands on
`mayne-fable-results/<name>/`. Then `node mayne/fable/tools/analyze.js --dir <dir> [--select --stage A|B --base B1]
[--portfolio V,…]` and `node mayne/fable/tools/make-evidence.js --res <results root> --verdict '{…}' --text '…'`.
TradingView, Binance and device notes: `../v1.2/HANDOFF.md`.
