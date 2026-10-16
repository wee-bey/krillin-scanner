# Trader Mayne System: HANDOFF — Fable version (read this first in a new chat)

_Last updated: 16 Oct 2026, 00:50 Beirut. Session paused by Jeffrey mid-task (usage limit). Fable lives in `mayne/fable/`
on branch `mayne-fable`; v1.1 (`mayne/`) and v1.2 (`mayne/v1.2/`) are untouched. The v1.2 handoff is `../v1.2/HANDOFF.md`._

## Goal of the Fable version
Jeffrey asked: "based on the education section, improve on and make the setups and alerts more profitable". The
education section = the 26-video rulebook material (`MAYNE_RULEBOOK_v1.2.md` §1–§11, `notes/`, `transcripts/`).
Everything is saved as a NEW version ("fable"), nothing existing is overwritten.

## What was done this session (in order)
1. **Fidelity check against Mayne's one dated trade (V24).** `FIDELITY_V24.md`. The v1.2 engine reproduces his entry
   (short 21 May 2026, 77,678 vs his ~77,000, same stop logic, FT = 60,000 = his runner target) but NOT his exit: the
   engine trailed the runner to H1 structure and was stopped on 23 May (+2.8R), then re-entered twice (−2R); he held the
   runner on its original stop to 60,000 on 5 June (≈ 11R). The v1.2 research therefore measured his entries under an
   exit he does not use.
2. **Pre-registered plan** `FABLE_PLAN.md` (committed before any result): Stage A = exit candidates (E1 runner keeps its
   original stop; E3 trail to zone-TF structure; E2a/E2b partial at the nearest daily pool / daily EQH-EQL ≥ 2R; E4 =
   E1 + E2b). Stage B = untested Mayne entry rules on top of the kept exit: direct profiles P1D (H12 zone, H4 trigger)
   and P2D (H4 zone, H1 trigger) (V14@41:23), N2 continuation-only, N3a/b daily-bias (V22), N4 Power of 3 (V10), N5
   OB+FVG overlap only (V07), N6a/b killzones / Silver Bullet on the trigger close. Same DECIDE 2021–23 / CONFIRM
   2024–26 split, same execution model, same pass/kill rule as v1.2.
3. **Engine** `lib/engine.js` with every switch (defaults reproduce v1.2 exactly), `tools/test-engine.js` (4 checks pass),
   research tools (`tools/research.js`, `analyze.js --stage A|B`, `research-merge.js`, `fidelity.js`), workflow
   `.github/workflows/mayne-fable-research.yml` (push to `mayne/fable/research-run.json` on `mayne-fable` → 8 shards →
   results on orphan branch `mayne-fable-results/<name>/`).
4. **Stage A DECIDE run done** (`decide-A`, 745 coins, 51,134 rows): report in `research/decide-A/report.md`.
5. **Indicator** `indicator/mayne_fable.pine`: compiles clean (0 errors, 0 warnings) and is saved in Jeffrey's
   TradingView account as **"mayne.fable · Trader Mayne System"** (`USER;807c67e6aa7149f3830909f2dd3b9963`, v1.0),
   next to `mayne.v1` and `mayne.v1.2`. Not yet added to a chart; not yet checked against the engine on a chart.
   Group "Fable rules": trail mode, partial level, N2–N6 switches; profiles P1D / P2D; checks (daily-bias, PO3,
   session) in the table / tooltip / alerts; alerts named `mayneF …`; `VALID` constant carries the validation label.

## Stage A result (DECIDE 2021–23; avg net R per trade; selection rule FABLE_PLAN §6)
| Profile | B0 | Best exit | Kept | E* (= B1's exit) |
|---|---|---|---|---|
| P1 | −0.146 (1,264) | E3 −0.094 (+0.052, 3/3 yrs) | E3 | **E3** (trail to zone-TF structure; partial unchanged) |
| P1D | −0.274 (171) | E4 −0.118 (+0.156, 3/3) | E1, E2b, E4 | **E4** (E4 ≥ E1 + E2b) |
| P2 | −0.101 (5,346) | E4 −0.065 (+0.035, 2/3); E3 +0.030 just under the 0.03 bar | E4 | **E4** |
| P2D | −0.038 (1,016) | E1 +0.002 (+0.040, but 1/3 yrs) | none | **B0's exit** |

Reading: the exit change helps every profile by +0.03 to +0.16R and the runner now reaches FT 8–12% of the time
(was 1–5%), but no profile is positive on DECIDE after costs. D2: under E1/E4 the real setups beat bias-only random
entries by +0.03 to +0.10R (P2 E4: +0.094, 90% CI +0.00 … +0.20 — the first positive, barely), while bias-only random
still loses to random-direction random (−0.09 to −0.17R): the W/D bias itself is the drag. A+ still ranks worst on
P1/P2. P2D is the least bad profile (B0 −0.038, E1 +0.002). **No CONFIRM look has been taken** (plan §9 is empty).

## NEXT (resume here)
1. **Stage B DECIDE run.** Edit `mayne/fable/research-run.json` → name `decide-B`, variants `B0,N2,N3a,N3b,N4,N5,N6a,N6b`,
   and per profile the B1 exit via `custom` specs (P1: `{trail:'zone'}`; P1D and P2: `{trail:'none',plFrom:'dailyEq'}`;
   P2D: none) — easiest as custom variants `B1_P1…` with `only:['P1']` etc. and each N-rule combined with that
   profile's exit; `diag: "B1"`. Push to `mayne-fable`; ~1 h. Then `node mayne/fable/tools/analyze.js --dir … --select
   --stage B --base <B1 variant>` per profile. Build F per §6 (floors P1 150, P2 500, P1D 150, P2D 300).
2. **One CONFIRM look** (2024-01-01 → latest): B0, B1 and F per profile. Log it in FABLE_PLAN §9. Apply §7.
3. Depending on §7: set the indicator defaults and `VALID` string, finish the board `/mayne/fable/` (copy of
   `../v1.2/index.html` + engine switches + the Fable checks on cards; not started), write `RESULTS.md`, update the
   Project docs, open the PR (`mayne-fable` → main; never self-merge).
4. Independent verification agent on the analysis numbers and the fidelity claim before anything is called final.
5. Jeffrey: add `mayne.fable` to a BTCUSDT H1 chart and compare its tally with `node mayne/fable/tools/fidelity.js
   --sym BTCUSDT --market spot --profile P1 --chart-from 2024-01-01 --set trail=none,plFrom=dailyEq` (expected to match
   the engine; not yet verified on the chart).

## Ground rules (unchanged)
Mayne separate from Krillin · new version, never overwrite · optional modules toggleable, off by default, "not Mayne"
labelled · uncluttered chart · no tuning on one regime, relative parameters only · plan before looking, decide/confirm,
log every look, kill rule · Opus for core logic, cheaper models for grunt work.

## Files
| What | Where |
|---|---|
| Code, plan, fidelity, Stage A report | GitHub `wee-bey/krillin-scanner` branch `mayne-fable`, folder `mayne/fable/` |
| Research data | orphan branch `mayne-fable-results` (`decide-A/`) |
| Project docs | `FABLE_PLAN.md`, `FABLE_FIDELITY_V24.md`, `FABLE_HANDOFF.md` (this file) |
| PC folder | `C:\Users\Jeffrey\Desktop\TraderMayne\fable\` (plan, fidelity, handoff, indicator, Stage A report) |
| TradingView | script `mayne.fable · Trader Mayne System` (`USER;807c67e6aa7149f3830909f2dd3b9963`) |
