# Fable · fidelity check against Mayne's own documented trade (V24)

_16 Oct 2026. Question: does the engine (v1.2, defaults) reproduce the trade Mayne walks through in video 24, the one
dated, journalled trade in the whole Bootcamp? Engine log: `data/fidelity/BTCUSDT-spot-P1-v1.2-engine.txt`
(BINANCE:BTCUSDT spot, P1 H12–H1, full daily history, trade-through 0.02%)._

## What Mayne did (notes/24, transcript V24 @14:49–24:23)
| Item | Mayne (journal) |
|---|---|
| Bias | Weekly bearish (LH, LL); weekly bearish FVG in premium as the POI |
| HTF turn | Daily MSS bearish, then an SFP into a daily bearish OB |
| Entry | H1: sweep of the high, bearish MSB, breaker + FVG; short **at ~77,000 on 21 May 2026** ("edge of the red box") |
| Stop | Just above the sweep / SFP high ("not at the fair value gap") |
| Partial | ~2/3 off at **74,000** ("internal range liquidity… all those lows that had built up") |
| Runner | ~1/3 held with the original stop to **60,000** (weekly range low), closed **5 June** |
| Result | ~$22,000 on $2,000 risk ≈ 11R; one position throughout |

## What the engine did on the same chart
```
[2026-05-20 15:00 UTC] TAG SHORT H12 OB 77721.19-78599.99 rev
[2026-05-20 16:00 UTC] TURN SHORT SFP H4
[2026-05-21 10:00 UTC] ARM SHORT A+ +SWEEP +OTE | rev H12 OB | turn SFP H4 | en 77678.01 sl 78288.385 (sweep extreme, 1.73 ATR) pl 76457.26 pt 76144.71 rr 2.51 ft 60000
[2026-05-23 13:00 UTC] CLOSE SHORT runner stopped 2.82R
[2026-05-24 14:00 UTC] ARM SHORT A+ +SWEEP +OB/FVG +OTE | rev H12 Breaker+FVG | en 76840.01 sl 77631.737 pl 74660.05 pt 74289.6 rr 3.22 ft 60000
[2026-05-25 06:00 UTC] CLOSE SHORT stopped -1.00R
[2026-05-25 20:00 UTC] ARM SHORT A+ +SWEEP +OB/FVG +OTE | rev H12 OB+FVG | en 77500 sl 77977.172 pl 76545.656 pt 76108 rr 2.92 ft 60000
[2026-05-26 14:00 UTC] CLOSE SHORT stopped -1.00R
```
Daily candles: 21 May high 78,200 / close 77,616; 22 May low 75,359; 23 May low 74,290; 26 May high 78,080; 5 June
low 59,131.

## Comparison
| | Mayne | Engine (v1.2 defaults) |
|---|---|---|
| Direction, date | short, 21 May | short, 21 May 10:00 UTC ✅ |
| Entry | ~77,000 | 77,678 (+0.9%) ✅ |
| Stop | above the sweep high (~78.2k area) | 78,288, "sweep extreme (reversal)" ✅ |
| Final target | 60,000 (weekly range low) | FT 60,000 ✅ |
| Partial level | 74,000 (daily-level lows; "like 2R" in speech, more by the journal maths) | 76,457 (first H1 pool ≥ 2R, 2.0R) ❌ |
| Runner management | original stop kept; runner to 60,000 | stop trailed to H1 swings; stopped 23 May ❌ |
| Positions | one, 21 May → 5 June | three; two re-entries after the early exit, both −1R ❌ |
| Outcome | ≈ +11R | +2.82 − 1.00 − 1.00 = **+0.82R** |

_Sources for the table: the engine log (TAG/TURN/ARM/CLOSE lines, abbreviated above; `att`, `turn` and `tagged` fields
dropped) gives the dates, levels, stops, targets, the 23 May exit and the two re-entries. The daily candles quoted come
from the Binance spot archive read during the check (not in the log). Mayne's side is the V24 transcript and journal
frames; his partial is quoted as "like 2R" in speech while the journal numbers imply more (notes/24 §7) — the exact R of
his partial is not needed here, only its level (74,000) and the fact that the runner was held._

## Reading
1. **The entry pipeline reproduces his system** on this trade: same bar-day, same level within 1%, same stop logic,
   same final target. The v1.2 research was therefore measuring Mayne's entries, not something else.
2. **The exit as coded is not what he does.** Rulebook §5.4 "Mayne-own" trails the runner to trigger-TF structure after
   the partial; on this trade that gave up the whole runner, and the partial sat at the nearest trigger-TF pool instead
   of the daily-level liquidity he used. The v1.2 statistic "only 1–2% of runners reach FT" says the same thing across
   the sample.
3. **Re-entries** happened only because the engine was flat; with the runner still open, the state machine stays in
   ACTIVE and arms nothing new. An exit fix removes them without any new rule.
4. This is one trade. It shapes the hypotheses in `FABLE_PLAN.md`; it proves nothing about profitability, and nothing
   here was tuned on the universe.

Not checked: the V12 / V13 / V14 walkthroughs carry no dates (chart-only), and YouTube pages could not be fetched from
this session to date them. A frame-by-frame reading would be a separate task.
