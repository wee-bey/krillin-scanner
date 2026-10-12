# Trader Mayne System: Rulebook v1.2 (crypto)

*Status: APPROVED by Jeffrey (decisions in §12), Milestone 1. Independently fact-checked against the transcripts (100 claims; see VERIFICATION_v1.md), with all corrections applied. Built from all 26 Trading Bootcamp videos (playlist as of 11 Oct 2026).*
*This is the single source of truth for both the scanner and the TradingView indicator. If code and rulebook disagree, the rulebook wins. Change the rulebook first, then the code.*
*Revision v1.1 (11 Oct 2026): §4 continuation path tightened, tag-to-trigger expiry added, §14 records the interpretations used by indicator `mayne_v1.pine` v1.1.*
*Addendum (11 Oct 2026, Milestone 3): §15 records how the scanner and the replay run these rules. The rules themselves are unchanged.*
*Version v1.2 (11 Oct 2026): a new file next to v1 (`MAYNE_RULEBOOK_v1.md`, unchanged). §1–§15 are the v1.1 rules, unchanged. §16 adds the v1.2 rule switches (all off by default) and the realistic execution model. §17 records the v1.2 test and its outcome: no edge found, kill rule applied. Code: indicator `mayne.v1.2`, engine `mayne/v1.2/lib/engine.js`.*

## How to read this

| Tag | Meaning |
|---|---|
| **[M]** | Mayne said it. Every [M] rule carries a citation **V##@mm:ss** (video number, then the caption-block timestamp; the real moment can be up to about a minute later). Video list: `video_index.md`. |
| **R##** | A citation like "V07 R12" points to rule 12 in `notes/07-*.md`, which carries the transcript quote and timestamp. |
| **[P]** | A parameter I had to choose because Mayne never gives a number. Every [P] is in the parameter table (§11) and is adjustable. |
| **[I]** | My interpretation, used where his statements conflict or leave a gap. The reasoning is in §13 and §14. |
| **OPTIONAL-M** | Mayne teaches it, but as a booster, not a requirement. It gets its own toggle, off by default. |
| **OPTIONAL-X** | Not Mayne. It gets its own toggle, off by default, and is labelled "not Mayne" in the UI. |

Separation from Krillin: everything here lives in a separate strategy namespace (`mayne.*`) with its own signal IDs, scanner tab and results replay. It never shares a score or a filter with the Krillin system. Shared infrastructure is limited to strategy-agnostic plumbing: candle fetch, alert transport and the replay engine.

---

## 1. The system in one paragraph

Mayne calls himself a sniper: "everything that you do in this system is meant to point you to a specific moment in time and price" [M] V24@23:19.

**What to trade**
- Direction comes only from the higher timeframes: weekly + daily, or "weekly + 12-hour", which he treats as interchangeable with daily [M] V12@4:15, V05@4:18, V14@11:39.
- He trades only where an HTF bullish leg meets **discount** (or a bearish leg meets **premium**) of the dealing range, at an HTF point of interest: an order block, FVG or breaker.

**How to enter**
- He waits for that zone to be traded into, and for the HTF to show the turn.
- He then drops to a lower timeframe. The trigger there is: market-structure break in the HTF direction, then displacement that leaves a fair value gap, then entry on the pullback into that FVG.

**Stop, target and risk**
- The stop sits at the point where the idea is wrong.
- The target is the next HTF liquidity pool, at a minimum of 2R.
- Risk is a fixed 0.5–2% per trade, with 1% as his working baseline.
- He takes a few trades a month [M] V14@45:33, V24@15:53.

---

## 2. Timeframe profiles (answers "which timeframes?")

**Confirmed:** Mayne's personal system is literally called the **"H12–H1"**. In his words: "The H12 H1 really really is a weekly daily H4 H1. And I'm entering just on the H1" [M] V14@11:39. He also says "I like the H12 chart. It's my favorite chart… Two H12 candles are one daily candle" [M] V14@11:39. His other two named pairs are **H4–M15** and **H1–M5** [M] V14@11:39-12:42. Any stack works "as long as you're doing top down" and the steps are "evenly spaced" [M] V12@30:47.

| Profile | Bias (Step 1) | Zone / POI TF (Step 2) | Confirmation TF (Step 3) | Trigger / entry TF (Step 4) | Typical hold |
|---|---|---|---|---|---|
| **P1 "H12–H1"** (default, his favourite) | W + D/H12 | D or H12 | H4 | H1 | days to weeks |
| **P2 "H4–M15"** | W + D | H4 | H1 | M15 | hours to days |
| **P3 "H1–M5"** | W + D | H4 | H1 | M5 | hours |

- The scanner runs P1 and P2 by default. P3 is a toggle, because he finds M5 noisy and fake-out-prone unless the HTF confirmation is there [M] V14@1:03-2:07.
- The H12 candle is aligned to 00:00/12:00 UTC (standard on TradingView crypto) [P].
- Entering on a higher timeframe is allowed: you can take the H4 FVG or H1 model directly, with no lower TF [M] V14@41:23-43:28. The indicator therefore lets you set any trigger TF.

---

## 3. Building blocks (definitions)

### 3.1 Swing points
- A swing high is a 3-candle pivot: the middle candle's high is above both neighbours' highs. A swing low is the mirror image. He rejects 5-candle pivots [M] V01@2:08, V02@1:04, V24@1:03.
- A pivot is confirmed only after the right-hand candle has closed. There is no repainting [P].

### 3.2 Market structure state machine (per timeframe)

**What it tracks**
- Two live levels: the **protected high** and the **protected low**.
- In an uptrend:
  - The protected high is the latest swing high (a break of it = MSB, continuation).
  - The protected low is the swing low that generated it, i.e. the higher low (a break of it = MSS, potential reversal) [M] V02@18:07-19:09.

**What counts as a break**
- Breaks count only on a **candle close** beyond the level. "A market structure break requires a close through the higher high" [M] V02@20:11.
- A wick-only break is not a break. It is a candidate sweep or SFP (§3.7).
- The close rule is applied to MSS as well [I] (he states it explicitly for MSB and in his weekly examples).

**States**
- `BULL`, `BEAR`, `BULL_SHIFTING` (MSS down printed, flip not yet confirmed) and `BEAR_SHIFTING`.
- A flip is confirmed when a lower high forms and then a close below the last swing low prints (mirror for bullish) [M] V02@11:42-13:51.
- While shifting, bias = **unclear**, so no trade [M] V15@4:12, V12@7:26.

**Persistence**
- Sideways action after a trend keeps the prior trend's bias until a protected level breaks [M] V02@25:26.
- A pullback that does not close beyond the protected low is still a pullback, not a reversal [M] V02@20:11.

### 3.3 Dealing range, EQ, premium/discount, OTE
- **Dealing range** on any TF: from the protected low to the protected high of the current leg (bull state), or the mirror in a bear state. Equivalently: "the most recent significant swing high and swing low" of the current price leg [M] V04, V24@1:03.
  - After an MSS, the new range runs from the swing that made the shift to the extreme created by the break [M] V24@6:18-7:23.
- **EQ** = 50% of the range. Above EQ is **premium**, below is **discount**. Longs only in discount, shorts only in premium ("no diddle in the middle") [M] V01@36:08-42:24, V15@5:15.
- **OTE** = the 0.62–0.79 retracement of the leg, sweet spot 0.705. The fib is drawn swing low→high for longs and high→low for shorts [M] V01@58:23, V09.
  - In this system OTE is a **grade booster**, not a gate. V15 only requires discount/premium.
- **Range reset**:
  - The range retires only when price **displaces beyond its extreme** [M] V19@8:28-12:38. Coded as a close beyond the extreme with an FVG in that leg [I].
  - A sweep or SFP beyond the extreme that closes back inside does **not** reset it [M] V19@10:33.
  - After a reset, the new range is defined at the first meaningful pullback. In code: the first confirmed opposite swing [P].

### 3.4 Fair value gap (FVG)
- **Bullish FVG:** `low(c3) > high(c1)`, zone = [high c1, low c3]. **Bearish FVG:** `high(c3) < low(c1)`, zone = [high c3, low c1]. Both use wicks [M] V06@2:07-5:21.
- **Minimum size** = 0.10 × ATR(14) of that TF, to suppress noise [P].
- **Proximal edge** = the edge price meets first on the pullback. **CE** = 50% of the gap.
- **Status values:**
  - `fresh`: never touched.
  - `tagged`: wick entered the gap. Still valid; he shows FVGs tagged several times and still respected [M] V06@4:17.
  - `invalid`: a candle has **closed** beyond the far edge [P].

### 3.5 Order block (OB) and breaker
- **Bullish OB:** the last down-close candle (or consecutive run of down candles) right before a displacement move up. A bearish OB is the mirror [M] V07 R1–R2, V01.
  - The OB counts as a POI only if that displacement leg produced an MSB (or left an FVG) [I] (V07: MSB = higher quality).
- **OB zone** = the full candle range (wick to wick) of the OB candle or run.
  - Consecutive same-colour candles are merged into one box (visual check, V07).
  - Entry band = from the proximal edge of the box to its mean threshold. The mean threshold is drawn at 50% of the whole box in his charts (visual check, V07/V24).
  - A "good" OB does not see a close beyond its 50% [M] V07 R6–R7.
- **Breaker:** an OB that failed. Price **closed through** it, so it flips polarity: a failed bearish OB becomes bullish support [M] V07 R11.
  - It is usually found at reversals after a sweep [M] V07 R12.
- **Best POI:** an OB or breaker that overlaps an FVG. "One of the best setups in all of smart money trading" [M] V07 R18, V08. This is a grade booster, not required: "the fair value gap alone is enough" [M] V13@8:31.

### 3.6 Liquidity pools and targets
- **Pools:** confirmed swing highs and lows, equal highs/lows, dealing-range extremes, and the prior day/week high and low [M] V03, V11, V22.
- **Equal highs/lows (EQH/EQL):** two or more confirmed swings that look "visually equal" relative to that coin's own candle size: within 0.25 × ATR(14) of each other on that TF, unswept in between [P]. The value is calibrated from his drawn examples (VISUAL_CALIBRATION_v1 Q6), never from fixed price values, so it adapts per coin and per day.
- **ERL / IRL:**
  - External range liquidity (ERL) = the extremes of the dealing range.
  - Internal range liquidity (IRL) = EQH/EQL, swings, FVGs and OBs inside the range [M] V13@14:54, V16@18:00.
- **Target logic:**
  - Entering from internal (a POI pullback) means you target external.
  - Entering after an external sweep means you target internal first [M] V16@18:00-19:03, V19@12:38.
  - Targets always come from the HTF, never the trigger TF [M] V12@23:19, V13@10:40.

### 3.7 Sweep, SFP and liquidity trap
- **SFP:** the candle's wick goes beyond a pool and the **same candle closes back inside** [M] V03@16:56.
- **Break-and-close sweep:** a close beyond the pool, then a close back inside within 2 candles [P] ("immediately" [M] V03@15:53-18:01).
- **Real breakout instead:** price "hovers" beyond the level without closing back inside [M] V03@16:56.
- **Confirmation:** a sweep only counts once displacement follows and produces an MSS the other way [M] V03@12:42-14:48.
- **Weighting:**
  - HTF sweeps carry more weight.
  - LTF sweeps against the HTF trend get much less weight [M] V03@21:14-22:15 ("not going to give this as much weight"). Coded as: they never trigger a setup on their own until the LTF re-syncs with the HTF [I].

### 3.8 Displacement
Mayne never gives a number. He says "displacement can be one candle, it can be multiple candles. We want to see fair value gaps" [M] V13@24:27.
- **Rule:** the MSB leg is "displaced" if at least one FVG in the break direction formed within the leg, counted from the swing to the MSB candle plus one bar [I]. Without displacement the model is "a lot less likely to work" [M] V13@35:03.
- **OPTIONAL-X:** require a displacement candle body of at least 1.0 × ATR(14).

### 3.9 Zone tag
- Price must **trade into** the zone, meaning any wick overlap. "Not close to it" [M] V13@2:08.
- A near miss does not count [M] V15@14:46.

---

## 4. The setup pipeline (what the scanner tracks)

The scanner runs this per symbol and per profile. Each stage must happen **in order**: "all of them have to happen and they have to happen in order" [M] V13@2:08, V15@8:28.

| Stage | Name | Condition (all must hold) | Scanner state |
|---|---|---|---|
| S1 | **Bias** | Weekly state is `BULL` or `BEAR` (not shifting) [M] V12@6:24, V15@4:12 | — |
| S2 | **Daily sync** | Daily/H12 state equals the weekly direction, OR the daily has just printed an MSB back in the weekly direction after a pullback. A daily that is still pulling back against the weekly = wait [M] V12@8:30-12:47 | — |
| S3 | **POI mapped** | On the zone TF: an unmitigated OB/FVG/breaker in the bias direction, sitting in discount (longs) or premium (shorts) of the zone-TF dealing range [M] V12@14:52, V15@5:15 | `WATCH` (once price is within 1.5 × ATR(zone TF) of the POI [P]) |
| S4 | **Zone tagged** | Price trades into the POI [M] V13@2:08, V12@19:04 | `FORMING` |
| S5 | **HTF turn confirmed** | One of these happens inside or from the zone after the tag: an SFP on the zone TF or confirmation TF; an MSB in the bias direction on the confirmation TF that leaves an FVG/OB; or a daily MSB in the bias direction [M] V14@2:07-3:12, 23:19-25:27. "You don't go from high time frame directly to model." | `FORMING+` |
| S6 | **Trigger** | On the trigger TF: an MSB in the bias direction (close through the last opposing swing), with displacement (§3.8) leaving an FVG [M] V13@3:14-6:25, V24@11:37. An optional sweep of the trigger-TF swing before the MSB raises the grade [M] V24@9:30 | `ARMED`: Entry / SL / TP computed, alert fires |
| S7 | **Fill** | Price retraces into the trigger FVG: limit at the proximal edge (default) or the CE [M] V13@7:29-8:31, V06 R10 | `ACTIVE` |
| — | **Invalidation** | Before fill: price trades through the SL level, or trades beyond the POI's far edge plus the buffer, or the bias (S1/S2) is lost. "It's wrong below that H4 fair value gap" [M] V12@22:16, V14@4:14 | `INVALIDATED` |
| — | **Expiry / no chase** | Before fill: price reaches PT, or 48 trigger-TF bars pass with no fill [P]. "If you don't get that fill, there's no trade" [M] V15@9:30. Before the trigger (S4–S5): price reaches the target pool recorded at the tag, or 12 zone-TF candles pass with no trigger [P] (v1.1) | `EXPIRED` |

**Continuation path** (V14@26:30-27:34, V13 USDCAD)

When the zone TF (or the daily) has printed its MSB in the bias direction **after the tag** of a zone-TF POI, the HTF turn is proven. New POIs **formed by that impulse** (fresh FVG/OB on the zone or confirmation TF created between the start of the displaced leg and the break), taken on the way to the target, are **continuation setups**.
- S5 is automatically satisfied.
- The stop uses continuation mode (§5.2).
- Continuation is "higher probability"; reversal gives "the best entry, the best risk reward" [M] V14@57:10.
- v1.1 clarification [I]: without a prior zone tag there is no proven turn, so no continuation setup. POIs that formed later in the trend (after the break) are not continuation POIs; they are ordinary reversal-path POIs.

**Multiple attempts**

A new trigger inside the same live zone is allowed after a failed one, as long as the zone itself is not invalidated [M] V12@22:16-23:19, V13@25:31-27:36. Cap: 2 attempts per zone [P].

**Excluded from v1**

Counter-trend trades against the W/D bias. Mayne calls them advanced and says "only trade directly with the high time frame trend" [M] V14@47:41. They also fail his own checklist [M] V15@3:09. They could be added later as an OPTIONAL-M module.

---

## 5. Entry, stop, targets

### 5.1 Entry
- Mayne leaves the order type to "personal preference": a market order at the FVG, a limit, or waiting for a tag and a small reaction [M] V13@7:29-8:31. Levels: the near edge, or a ladder across to the 50% [M] V06@23:18.
- **Default here:** a limit at the **proximal edge** of the trigger FVG [P]. Options: the CE (50%), or a 3-step ladder from the edge to the CE.
- Enter after the FVG forms, never before it, and never chase [M] V13@8:31, V15@9:30.

### 5.2 Stop loss (always placed with the entry; never widened)
- **Reversal mode** (the stage-S5 path):
  - If a sweep/SFP printed inside the zone before the trigger, the stop goes beyond **that sweep's extreme**. "For reversals, we put our stop at the SFP high, not at the fair value gap" [M] V24@12:42.
  - Otherwise the stop goes beyond the **far edge of the HTF POI** [M] V12@21:13-22:16, V14@4:14, V16@2:05.
- **Continuation mode:** beyond the trigger-TF swing that the MSB came from [M] V13@9:36-10:40, V14@5:19, V16@3:09.
- **Buffer:** a small "breathing room" is required: "don't put your stop on the exact low tick" [M] V16@17:00. Size: 0.25 × ATR(14) of the trigger TF [P]. His drawn stops sit about 0.3–0.5 candle ranges beyond the wick (low-confidence visual read); this will be tested at 0.10 / 0.25 / 0.50.
- **Never widen; trailing in profit is fine** [M] V16@6:20.
- **Hard stop:** the stop order goes in at the same moment as the entry. No mental stops [M] V16@5:17.

### 5.3 Targets
- **Primary target (PT):** the nearest **unswept** liquidity pool in the trade direction on the **zone TF**, i.e. EQH/EQL, a swing, or the zone-TF range extreme. Targets come from the HTF, "not just targeting a five-minute swing high or low" [M] V12@23:19, V13@10:40.
- **R:R gate:** (PT − entry) / (entry − SL) ≥ **2.0**. "If it's not a 2:1 setup based on where you're entering, that's not a trade" [M] V13@11:43, V15@7:24, V16@29:38. Levels must be chart-derived only. Never drag the TP or SL to manufacture R:R [M] V16@34:00.
- **Final target (FT):** the HTF external range liquidity, i.e. the daily or weekly dealing-range extreme in the trade direction [M] V12@27:31, V24@21:13.
- **Partial level (PL):** used only by the Mayne-own exit mode. It is the first liquidity level on the **entry TF** at or beyond 2R. "I took my first partial at the liquidity level based on my entry time frame" [M] V24@19:04. Entry-TF swings / internal liquidity "can be used for partials" [M] V13@10:40. If no such level sits before PT, PL = the 2R price, because by 2R he has "at the bare minimum 50 to 75%" off [M] V16@21:09.

### 5.4 Exit management: two modes (indicator setting)
- **Mechanical** (what he teaches beginners) [M] V16@23:16:
  - Close 100% at **PT** (≥2R).
  - No partials, no break-even.
  - This is also how he records his published results: "assume I closed 100% of the trade at two to one" [M] V16@20:06.
- **Mayne-own** (**chosen default**; advanced) [M] V24@19:04-24:23, V16@21:09-27:30:
  - About **2/3 off at PL**.
  - The remaining 1/3 runs to **FT** (he holds the runner when the trade is a weekly-level thesis, V24@19:04).
  - After the partial, the stop moves to the latest trigger-TF structure low/high once one has formed. It never moves straight to entry; no break-even before a "meaningful level" has been hit [M] V16@26:27.

---

## 6. The 7 disqualifiers (hard gates; any one = no trade) [M] V15

| # | Disqualifier | How it's coded |
|---|---|---|
| D1 | No clear HTF bias | Weekly state is shifting, or the daily is not synced (S1/S2 fail) |
| D2 | Wrong zone | Long entry price is not below the zone-TF EQ, or short entry price is not above it |
| D3 | No clear target / R:R < 2 | No unswept pool in the trade direction, or R:R to PT < 2.0 |
| D4 | Model not fully triggered | Any stage S3–S6 missing or out of order |
| D5 | Chasing | No fill at the FVG before expiry, or entry before the FVG/zone |
| D6 | News | **OPTIONAL-M** (crypto): the scanner marks setups that arm within the blackout window of a manually maintained list of CPI / FOMC / NFP dates. Default window: 60 min before to 60 min after [P]. He says either "sit out the day" or "let the dust settle", so the minutes are not his [M] V15@10:34-14:46, V18 |
| D7 | Emotional state | Not codeable. This is your own pre-trade checkbox, kept in the journal |

D2 uses the zone-TF dealing range as the hard gate [I] (see §13 #3). Alignment across the W, D and zone TF ranges ("stacking") counts toward the grade (§7.2) [M] V19@4:16-6:21.

---

## 7. Risk, grading, frequency

### 7.1 Position size [M] V16@9:31-13:43
`size = (risk% × account) / |entry − SL|`. Leverage is irrelevant. Risk % is **static**, between 0.5% and 2%.

### 7.2 Grade → suggested risk
Mayne's own definition: "A+ has everything. We have our model, we have all of the time frames in alignment, we have all of the ranges stacking on top of each other and X, Y, and Z" [M] V19@15:47. He never fills in "X, Y, Z".

| Grade | Requirements (beyond passing D1–D6) | Suggested risk |
|---|---|---|
| **A+** | Structure aligned on all profile TFs (W, D, zone, confirmation, trigger) **and** PD stacked on W + D + zone TF [M] V19 | **2%** [M] V19@15:47 ("instead of risking 1%… I'm going to risk 2%") |
| **A** | One of those two conditions | 1% |
| **B** | Gates only | 1% [M] V20 (2% for an A++ trade, 1% for a B trade) |

**Boosters** (each shown as a "+" marker): a sweep/SFP before the trigger [M] V24@9:30, V16@15:51; an OB or breaker overlapping the FVG [M] V07, V08; OTE [M] V09; killzone [M] V20; SMT [M] V21 (SMT "upgrades a B+/A to A+"). **Two or more boosters lift the grade one step** [I]. Killzone and SMT count only when their optional module is switched on.

### 7.3 Frequency and behaviour (journal rules, not scanner rules)
- **Expected frequency:** a few trades a month across 4–5 coins [M] V14@45:33, V15@1:02 (he trades BTC, ETH, SOL and maybe HYPE).
- **Trade cap:** 5 per week, his example; his own style is 5–10 per month [M] V26.
- **Circuit breaker:** for lower-timeframe day trading at 1% risk, stop for the session after 2–3 consecutive losses. He notes swing traders can see 3–6 losses in a row, so this rule is aimed at P2/P3 [M] V26@13:51-14:54.
- **Total open risk:** watch it; five trades at 2% = 10% of the account at risk [M] V16@11:37. Cap: 4% total open risk [P].

---

## 8. Optional modules: Mayne's boosters (OPTIONAL-M, each with its own toggle, off by default)

| Module | Rule | Source |
|---|---|---|
| **Killzones** | Tag setups armed during London 02:00–05:00 or NY 07:00–10:00 New York time (DST-aware). This is a grader only: "your kill zone does not create the entry". For crypto he names the main trading day as about 08:00–21:00 UTC and says crypto respects these windows "with varied success" | V20, V14@32:53 |
| **Silver Bullet** | Tag triggers that occur 03–04, 10–11 or 14–15 NY time. 10–11 is "the most common one"; for crypto he says only that it is "still a high volatility time" | V14@28:36-33:57 |
| **SMT (BTC↔ETH)** | At a key level, one asset sweeps its swing and the correlated one fails to. This is an upgrade, never a signal or a veto | V21 |
| **Power of 3 / opens** | Show the daily open (00:00 UTC) and weekly open (Monday 00:00 UTC). Tag the setup if the manipulation leg went below the open (longs) or above it (shorts) | V10 |
| **Daily-bias stats** | Show yesterday's close location in its range. Top 10% → about 86–91% odds the high gets taken; bottom 10% → about 90% odds the low gets taken; mid-range → no edge. These are his BTC/ETH/SOL back-test figures | V22 |
| **OTE gate** | Make OTE (0.62–0.79) a hard requirement instead of a booster | V09, V12@26:29 |
| **Strict stacking** | Make PD alignment on W + D + zone TF a hard gate instead of a grade item | V19@4:16 |
| **News blackout** | D6 above | V15, V18 |

## 9. Optional modules: not Mayne (OPTIONAL-X, each with its own toggle, off by default, labelled "not Mayne")

These are candidates only. None will be built unless you ask for it.
- Minimum candle body for displacement (≥ k × ATR).
- Volume spike on the trigger candle.
- Funding rate or open-interest context (perps).
- Higher-TF EMA filter.
- Minimum 24h volume for the watchlist.

---

## 10. Crypto adaptations [P]
- **Candle boundaries:** daily 00:00 UTC; weekly Monday 00:00 UTC; H12 at 00:00 and 12:00 UTC. These are TradingView's crypto defaults.
- **Session times:** anything time-of-day based is converted from New York time with DST handled. Mayne writes "EST" but means NY local time.
- **Weekends:** no rule from Mayne. Flag only, as an OPTIONAL-X toggle "ignore triggers Sat–Sun".
- **Watchlist:** the top 100 crypto pairs by volume (§12), refreshed the same way as the Krillin scanner.

## 11. Parameter table (all [P] values; each one is a setting)
| Parameter | Default | Why |
|---|---|---|
| Swing pivot | 3 candles (1 each side) | [M] |
| Break rule | candle close | [M] |
| Flip confirm | LH then a close below the last low (mirror) | [M] |
| FVG min size | 0.10 × ATR(14) | noise filter |
| FVG invalid | close beyond far edge | [I] |
| EQH/EQL tolerance | 0.25 × ATR(14) (test 0.10/0.25/0.50) | visual calibration; relative to the coin's own volatility |
| Break-and-close reclaim | ≤ 2 candles | "immediately" |
| Displacement | FVG in the MSB leg | [I] from V13 |
| WATCH distance | 1.5 × ATR(zone TF) | scanner UX |
| Entry level | FVG proximal edge (alt: CE) | [M] options |
| SL buffer | 0.25 × ATR(14) of trigger TF (test 0.10/0.25/0.50) | "breathing room"; his drawn stops sit about 0.3–0.5 candle ranges beyond the wick |
| Min R:R | 2.0 to PT | [M] |
| Fill expiry | 48 trigger-TF bars, or PT hit first | no-chase rule |
| Tag-to-trigger expiry (v1.1) | 12 zone-TF candles, or the target pool recorded at the tag is reached first | a zone that has not turned soon after the tag is stale; on BTC H1/M15 history zones otherwise stayed "live" for months |
| Attempts per zone | 2 | [M] allows multiple attempts; cap is mine |
| News window | −60 / +60 min | [M] gives no minutes |
| Max open risk | 4% | [M] warns but gives no cap |

## 12. Decisions (Jeffrey, 11 Oct 2026)
1. **Profiles:** P1 "H12–H1" + P2 "H4–M15" on by default; P3 "H1–M5" off. ✅
2. **Exit mode default: Mayne-own.** About 2/3 off at PL, runner to FT, and the stop trails to structure after the partial. The indicator still draws PT. ✅
3. **Risk:** 1% base, 2% for A+, applied to a fixed account size you enter. ✅
4. **Universe: top 100 crypto by volume**, the same approach as the Krillin scanner. Mayne himself watches 4 coins, so on 100 symbols the grade (A+/A/B) is what keeps the noise down. ✅
5. **[P] defaults:** calibrated against the chart drawings in his videos (VISUAL_CALIBRATION_v1.md). The EQH/EQL tolerance and SL buffer moved to 0.25 × ATR, and the OB box is wick-to-wick with merged candles. Final tuning happens on multi-regime history in Milestone 3.

## 13. Conflicts I resolved (and how)
1. **Stop placement (V12 vs V13 vs V14/V16/V24).** V12 puts the stop beyond the H4 POI, V13 at the M5 swing, and V24 at the SFP high. Resolved with V14's own reconciliation: reversal setups use the zone or sweep extreme; continuation setups use the LTF swing. On reversals, the sweep extreme takes priority when one exists (V24, his most recent full walkthrough).
2. **OB/breaker overlap required? (V12 "best" vs V13 "FVG alone is enough").** Not required. It is a grade item.
3. **Which range D2 uses (V15 strict vs V14/V19 continuation into premium).** The hard gate is the zone-TF range. W/D stacking is graded. V19 explicitly says the entry-TF range "is the range that's most important to you".
4. **News (V15 "sit out the day" vs "let the dust settle").** Implemented as an optional, configurable blackout. In V03 he even calls news "cover" for liquidity runs.
5. **Silver Bullet (V14 three 1-hour windows vs "8–11 am" at the end of the video).** I used the three windows he states explicitly; "8–11" reads as a misstatement.
6. **TP1 "like 2R" vs the journal maths (V24).** The visual check of his trade journal confirms the first partial was about 4.7R per unit (about 3.2R of total risk), and the whole trade about 11R. The partial is therefore taken at a liquidity level at or beyond 2R (PL), not at a fixed 2R. Separately, the 2R gate is measured to the HTF primary target (PT), as V13/V15 require.
7. **Video 23 ("liquidity trap")** turned out to be about chart patterns and gives no codeable trap rule. Trap avoidance comes instead from the sweep definition (§3.7) plus the displacement, MSS, SMT and killzone boosters.
8. **"H12" in captions** is real. He uses the 12-hour chart as his favourite daily stand-in (V05, V14, V20, V24).

## 14. Implementation interpretations used by the indicator (mayne_v1.pine v1.1)
These are code-level [I]/[P] choices where the rules above needed a precise definition. They are part of the spec; change them here first.
1. **Forming range edge.** While a new leg extreme is still forming, the range edge is the running extreme; it fixes when the next 3-candle swing confirms. A close-break without displacement keeps the structure trend but does not reset the range (§3.3).
2. **Flip confirmation.** After an MSS and a lower high (mirror), the flip prints on a close beyond the lowest low (highest high) since the MSS.
3. **POI in discount/premium.** A POI qualifies for S3 when its 50% (CE) is on the correct side of the zone-TF EQ; D2 is then enforced on the entry price.
4. **OB life cycle.** An OB stops being a POI after a close beyond its 50%; a close through its far edge turns it into a breaker of opposite polarity.
5. **Continuation path.** See §4: requires a prior zone-TF tag, then a displaced zone-TF (or D) break in the bias direction after that tag; only POIs created inside that impulse (leg start → break) qualify. Confirmation-TF POIs are used only on this path.
6. **Order of S5 and S6.** The trigger MSB must close at or after the chart bar on which the HTF turn became known. The same chart bar is allowed, because the confirming HTF candle had already closed at that bar's open.
7. **Reversal stop.** If any sweep (zone/confirmation-TF SFP or trigger-TF sweep) printed since the tag, the stop goes beyond the extreme since the tag; otherwise beyond the POI far edge.
8. **Zone life.** A tagged zone dies when breached (far edge + buffer), when bias is lost, when its attempts are used, when price reaches the target pool recorded at the tag before any trigger, or after 12 zone-TF candles without a trigger (§11).
9. **Candle-order assumptions (simulation only).** Cancellations known at a bar's open (bias lost, fill window over) are applied before a fill on that bar. Within one candle, SL is assumed before targets, and the fill candle checks only the SL. The indicator's win/loss/R tally ignores fees, slippage and funding; it is a debugging aid, not evidence of an edge. Profitability is judged only in the Milestone 3 multi-coin, multi-regime replay.

## 15. Scanner and replay (Milestone 3)
These choices concern how the rules are run, not the rules themselves.
1. **One engine.** The board, the replay and the fidelity logs all use `mayne/lib/engine.js` in the `wee-bey/krillin-scanner` repo. It is a line-by-line port of `mayne_v1.pine` v1.1, and it reproduces the indicator's own BTCUSDT tallies exactly:
   - P1 on H1 from 2024-01-01: 19 armed · 16 filled · 7W/9L · +8.1R.
   - P2 on M15, Mar–Aug 2026: 49 armed · 41 filled · 7W/34L · −18.8R.

   If the indicator changes, the engine changes with it, and both are re-checked with `mayne/tools/fidelity.js`.
2. **Higher-TF data.** Higher-TF values come only from closed candles, the same as `request.security(expr[1], lookahead_on)`. A regression test (`mayne/tools/test-engine.js`) proves there is no look-ahead: everything decided before time X is identical when the data stops at X. The replay builds W from daily candles, and H12/H4/H1 from 15m candles. All are UTC-aligned, with weeks starting Monday 00:00. D and W use the coin's full daily history.
3. **Universe.** Every day, the top 100 Binance USDT-M perpetuals by the previous day's quote volume, as in the Krillin scanner. Stablecoins, wrapped tokens, index and metal contracts are excluded. Delisted coins are included, so there is no survivorship bias. A setup counts when it arms on a day its coin is in that day's top 100.
4. **Costs and fills (replay only).**
   - Costs: a 0.05% fee per side plus 0.03% slippage per round trip, charged on every fill and exit.
   - Gaps: a limit entry or a stop that the price gaps through fills at the candle's open.
   - R: net PnL ÷ the planned risk (entry to the original stop).
   - Exit: Mayne-own (§5.4).
5. **Market regime used for splitting results (not a filter).** BTC's 60-day change as of the previous daily close: ≥ +10% is bull, ≤ −10% is bear, anything else is chop. Results are also split by calendar year.
6. **Board.** It runs in the browser on Binance USDT-M closed candles, with 499 candles per TF: W, D, H12, H4, H1 and M15 (M5 only with P3). It shows the latest state per coin and profile. Because the history is shorter than the replay's, a live state can occasionally differ from the replay at the margins.
7. **Not ported (indicator-only, all OPTIONAL-M and off by default):** SMT, the killzone / Silver Bullet / PO3 tags, daily-bias stats and the news blackout. The OTE gate and strict stacking are ported.

### 15.1 First replay results (2021-01-01 → 2026-10-10, 745 coins; rulebook defaults)
| Profile | Closed | Win | Avg R net | Avg R gross | PF | ΣR |
|---|---|---|---|---|---|---|
| P1 H12–H1 | 2,430 | 28% | −0.09 | −0.05 | 0.88 | −219 |
| P2 H4–M15 | 10,510 | 29% | −0.12 | −0.04 | 0.84 | −1,279 |

**Sweep.** The grid was SL buffer 0.10/0.25/0.50 × tag-to-trigger expiry 6/12/24, plus Mayne's mechanical exit and the CE entry.
- Every one of the 24 combinations is negative overall.
- No parameter changes the average by more than about 0.04R. The parameters are not the problem, so nothing was tuned.
- The Mayne-own exit beats the mechanical exit.

**Regimes and years.**
- Nothing is consistently positive in bull, bear or chop.
- P1 is slightly positive in 2025–26 and on BTC alone (+0.38R on 27 trades), but these samples are too small to act on.

**Findings for a v1.2 rule review (open; not decided):**
- **The sweep booster is too loose.** The code counts any trigger-TF pool swept after the tag (§14.7), so the SWEEP booster appears on 98% of setups, and every reversal stop is a "sweep extreme" stop.
  - §4 S6 and V24@9:30 describe a sweep of the trigger-TF swing *before the MSB*.
  - As coded, the grade does not rank trades: A+ does worst and B best.
- **The runner rarely reaches FT.** Only about 1–2% of trades hit FT. Most profit comes from the PL partial.

## 16. v1.2 switches and execution model
The v1.1 rules above stay the default. v1.2 adds switches for the candidate rules tested in `mayne/v1.2/TEST_PLAN.md`.
They are in the indicator (group "v1.2 rules") and the engine. **All are off by default, because none survived the
out-of-sample check (§17).** They remain available so setups can be inspected against them; the indicator, the board
and the alerts also show three of them as information ("checks"), so you can judge each setup yourself.

| Switch | Tag | Definition (engine option) |
|---|---|---|
| C1c trigger-TF sweep required | [M] V24@11:37 | Reversal setups arm only when the MSB leg took out the last trigger-TF swing confirmed before the swing it breaks ("a low taken, then the high broken"; mirror for shorts), with that extreme printed after the tag. The stop then goes beyond that leg extreme (`sweepDef: 'ltf'`, `reqSweep: true`). Shown as the "sweep ✓/✗" check. |
| C2a BTC agrees | OPTIONAL-X | Alts arm only when BTC's own weekly bias is clear and its daily is synced in the same direction (S1/S2 run on BTC; indicator input "BTC symbol used by C2a"). Shown as the "BTC agrees" check. |
| C7 young trend | [M] V14@26:30 | Only the first N zone tags in the bias direction since the latest daily break that way (`maxTagN`). Shown as "tag #n". |
| C8b time stop | OPTIONAL-X | Exit at the close when N trigger bars have passed since the fill and the trade never reached +1R (`timeStopN`, `timeStopR`). |
| C9b no weekends | OPTIONAL-X | No arming on Saturday or Sunday UTC (`noWeekend`). |
| Trade-through fills | [P] replay realism | A limit (entry, PL, FT/PT) fills only when price trades beyond it by `fillThruPct` % of price; default **0.02** in v1.2 (0 = touch, as v1.1). |

The engine has more switches for research only (C1/C1d sweep definitions, C3/C3b cost-aware 2:1 and cost cap, C5
reaction entry, C6 external liquidity, C8a runner to PT, C9a 08–21 UTC, C10 ladder entry, and the D3 gate ablations);
their definitions are in TEST_PLAN §6 and its addenda. Fidelity: on BINANCE:BTCUSDT H1 from 2024-01-01 the indicator
and the engine give identical tallies, 19 armed · 16 filled · 7W/9L · +8.1R (defaults) and 4 armed · 3 filled · 2W/1L ·
+4.8R (C1c + C7 = 2 + C8b = 12 + C9b on).

**Execution model used to judge v1.2** (replay only): maker 0.02% for limit entries and targets; taker 0.05% + 0.03%
slippage for stops and market exits; limits need the 0.02% trade-through; gaps through limit entries and stops fill at
the open; funding charged from the Binance archive on the open fraction of the position.

## 17. v1.2 test and outcome (11 Oct 2026)
Pre-registered in `TEST_PLAN.md`: rules chosen on setups armed 2021–23, checked once on 2024-01-01 → 2026-10-10,
745 coins, the §16 execution model, 90% intervals from a week-block bootstrap.
- **Baseline (§1–§15 as coded):** P1 −0.146R per trade on 2021–23 and −0.057R on 2024–26; P2 −0.101R and −0.154R.
- **Random-entry check:** entries at random times in the same direction, with the same stops, targets and exit, did as
  well as the setups (2024–26 P2: setups 0.05R *worse* than random).
- **Gates:** removing D2, S5, S2 or the 2:1 rule one at a time never cost more than 0.01R.
- **Grade:** A+ still does worst.
- **Best combination** on 2021–23 for P1 (C2a + C7 + C1c, +0.105R on 152 trades) made **−0.028R on 2024–26** (182 trades).
- **P2's best** (C2a) made −0.201R. Both fail.
- **Kill rule applied:** the board and the indicator present setups as a candidate list for discretionary review,
  ARMED is labelled "not validated", and nothing is tuned further on this history.
- **Krillin confluence** (separate test, `CONFLUENCE_PLAN.md`): no profitable combination.
- **Forward test:** every setup that arms from 12 Oct 2026 is scored daily on the v1.2 board's Evidence tab.

Full numbers: `RESULTS.md` (Project doc `V1.2_RESULTS.md`).

