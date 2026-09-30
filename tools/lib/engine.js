/* Krillin Scanner engine v1.0 — implements rules/rules_spec.md v1.0.
   Pure functions, no DOM. Works in the browser (window.KE) and in node (module.exports).
   Timeframe convention (spec §7): every line is read as an explicit (tf, line) pair via L(tf, name). */
(function (root) {
  'use strict';

  // ---------- constants ----------
  const TF_MS = { '15m': 9e5, '1h': 3.6e6, '4h': 1.44e7, '12h': 4.32e7, '1d': 8.64e7, '3d': 2.592e8, '1w': 6.048e8 };
  const TF_UP = { '15m': '1h', '1h': '4h', '4h': '1d', '12h': '1d', '1d': '1w', '3d': '1w', '1w': null };
  const TF_LABEL = { '15m': '15m', '1h': '1h', '4h': '4h', '12h': '12h', '1d': 'Daily', '3d': '3D', '1w': 'Weekly' };
  const P = { // spec §13 defaults [P]
    atrLen: 14, slopeKShort: 3, slopeKLong: 10, flatShort: 0.05, flatLong: 0.02,
    trendValidFrac: 0.7, trendValidBars: 30, tapGapBars: 3, tapClearAtr: 0.5,
    respectCrosses: 4, pctWindow: 500, tightPct: 20, widePct: 50, apexBars: 100,
    qualityDispAtr: 3, rangeAtr: 6, staleBars: 100, staleBars15: 150, resolveAtr: 0.25,
    strongBreak: 1.5, invalidBars: 3, blowRangeAtr: 2.5, blowWick: 0.4,
    clusterAtr: 0.35, boxMaxAtr: 0.6, wickAtr: 0.25, outsizedWickAtr: 1.5, obImpulseAtr: 3, roomR: 2, tpFrontAtr: 0.25,
    stopBufAtr: 0.3, a3StopAtr1h: 1.0, a3StopMinPct: 1.5, profitTakePct: 75,
    riskPct: 0.5, feePct: 0.05, slipPct: 0.03, openRiskCap: 5,
    // [ADD-ON] diagonal trend lines (Krillin uses them as confluence; the thresholds are outside Krillin and go to the backtest)
    diagWindow: 300, diagPivots: 14, diagMinSpan: 10, diagMinMoveAtr: 0.75, diagMaxSlopeAtr: 0.4, diagTolAtr: 0.1, diagTouchAtr: 0.3, diagRelAtr: 6, diagBrokenBars: 40, diagCompBars: 15, diagNearAtr: 4,
  };

  // ---------- helpers ----------
  const isNum = (x) => typeof x === 'number' && isFinite(x);
  const last = (a, k = 0) => a[a.length - 1 - k];
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const fmtPct = (x) => (x >= 0 ? '+' : '') + x.toFixed(1) + '%';

  // ---------- indicators (TradingView-compatible seeding) ----------
  function sma(src, n) {
    const out = new Array(src.length).fill(NaN); let s = 0;
    for (let i = 0; i < src.length; i++) {
      s += src[i]; if (i >= n) s -= src[i - n];
      if (i >= n - 1) out[i] = s / n;
    }
    return out;
  }
  function ema(src, n) { // ta.ema: seeded with SMA(n)
    const out = new Array(src.length).fill(NaN); const a = 2 / (n + 1); let prev = NaN, s = 0;
    for (let i = 0; i < src.length; i++) {
      if (i < n - 1) { s += src[i]; continue; }
      if (i === n - 1) { s += src[i]; prev = s / n; out[i] = prev; continue; }
      prev = a * src[i] + (1 - a) * prev; out[i] = prev;
    }
    return out;
  }
  function rma(src, n) { // SMMA / ta.rma, seeded with SMA(n). Krillin's "EMA200" = rma(close, 99)
    const out = new Array(src.length).fill(NaN); let prev = NaN, s = 0, cnt = 0;
    for (let i = 0; i < src.length; i++) {
      const x = src[i];
      if (!isNum(x)) { out[i] = prev; continue; }
      if (!isNum(prev)) { s += x; cnt++; if (cnt === n) { prev = s / n; out[i] = prev; } continue; }
      prev = (prev * (n - 1) + x) / n; out[i] = prev;
    }
    return out;
  }
  function atr(h, l, c, n) {
    const tr = h.map((hi, i) => i === 0 ? hi - l[i] : Math.max(hi - l[i], Math.abs(hi - c[i - 1]), Math.abs(l[i] - c[i - 1])));
    return rma(tr, n);
  }
  function rsi(c, n) {
    const up = c.map((x, i) => i === 0 ? NaN : Math.max(x - c[i - 1], 0));
    const dn = c.map((x, i) => i === 0 ? NaN : Math.max(c[i - 1] - x, 0));
    const ru = rma(up, n), rd = rma(dn, n);
    return ru.map((u, i) => (!isNum(u) || !isNum(rd[i])) ? NaN : rd[i] === 0 ? 100 : u === 0 ? 0 : 100 - 100 / (1 + u / rd[i]));
  }
  function stochRsi(c, lenRsi = 14, lenSt = 14, kS = 3, dS = 3) {
    const r = rsi(c, lenRsi); const st = new Array(c.length).fill(NaN);
    for (let i = 0; i < c.length; i++) {
      if (i < lenSt - 1) continue; let lo = Infinity, hi = -Infinity, ok = true;
      for (let j = i - lenSt + 1; j <= i; j++) { if (!isNum(r[j])) { ok = false; break; } lo = Math.min(lo, r[j]); hi = Math.max(hi, r[j]); }
      if (ok) st[i] = hi === lo ? 50 : 100 * (r[i] - lo) / (hi - lo);
    }
    const k = smaNan(st, kS), d = smaNan(k, dS);
    return { k, d, rsi: r };
  }
  function smaNan(src, n) {
    const out = new Array(src.length).fill(NaN);
    for (let i = n - 1; i < src.length; i++) { let s = 0, ok = true; for (let j = i - n + 1; j <= i; j++) { if (!isNum(src[j])) { ok = false; break; } s += src[j]; } if (ok) out[i] = s / n; }
    return out;
  }
  function stdev(src, n) {
    const out = new Array(src.length).fill(NaN);
    for (let i = n - 1; i < src.length; i++) { let s = 0, s2 = 0; for (let j = i - n + 1; j <= i; j++) { s += src[j]; s2 += src[j] * src[j]; } const m = s / n; out[i] = Math.sqrt(Math.max(s2 / n - m * m, 0)); }
    return out;
  }
  function pctRank(arr, i, win) { // share (0-100) of the previous `win` valid values that are <= arr[i]
    let n = 0, le = 0;
    for (let j = Math.max(0, i - win); j < i; j++) { if (isNum(arr[j])) { n++; if (arr[j] <= arr[i]) le++; } }
    return n < 50 ? NaN : 100 * le / n;
  }
  function pivots(h, l, left, right) { // confirmed pivots only (right bars after)
    const ph = [], pl = [];
    for (let i = left; i < h.length - right; i++) {
      let isH = true, isL = true;
      for (let j = i - left; j <= i + right; j++) { if (j === i) continue; if (h[j] > h[i] || (j > i && h[j] === h[i])) isH = false; if (l[j] < l[i] || (j > i && l[j] === l[i])) isL = false; if (!isH && !isL) break; }
      if (isH) ph.push({ i, p: h[i] }); if (isL) pl.push({ i, p: l[i] });
    }
    return { ph, pl };
  }

  // ---------- candles ----------
  // series = {t:[], o:[], h:[], l:[], c:[], v:[]} (v = quote volume), sorted ascending, last bar may be forming
  function fromRows(rows) { const s = { t: [], o: [], h: [], l: [], c: [], v: [] }; for (const r of rows) { s.t.push(r[0]); s.o.push(r[1]); s.h.push(r[2]); s.l.push(r[3]); s.c.push(r[4]); s.v.push(r[5] || 0); } return s; }
  function aggregate(s, tfTo) { // 4h->12h, 1d->3d, 1d->1w. UTC buckets; weekly starts Monday.
    const ms = TF_MS[tfTo]; const off = tfTo === '1w' ? 4 * 864e5 : 0; const out = { t: [], o: [], h: [], l: [], c: [], v: [] }; let cur = null;
    for (let i = 0; i < s.t.length; i++) {
      const b = Math.floor((s.t[i] - off) / ms) * ms + off;
      if (cur !== b) { cur = b; out.t.push(b); out.o.push(s.o[i]); out.h.push(s.h[i]); out.l.push(s.l[i]); out.c.push(s.c[i]); out.v.push(s.v[i]); }
      else { const k = out.t.length - 1; out.h[k] = Math.max(out.h[k], s.h[i]); out.l[k] = Math.min(out.l[k], s.l[i]); out.c[k] = s.c[i]; out.v[k] += s.v[i]; }
    }
    return out;
  }

  // ---------- per-timeframe analysis (spec §3, §4, §5.1) ----------
  function slopeOf(line, a, i, k) { if (i - k < 0 || !isNum(line[i]) || !isNum(line[i - k]) || !isNum(a[i]) || a[i] === 0) return NaN; return (line[i] - line[i - k]) / (k * a[i]); }
  function slopeClass(s, flat) { if (!isNum(s)) return 'na'; return s > flat ? 'up' : s < -flat ? 'down' : 'flat'; }

  function analyzeTF(s, tf) {
    const n = s.c.length; const { h, l, c, o } = s;
    const A = { tf, n, t: s.t, o, h, l, c, v: s.v };
    if (n < 30) { A.insufficient = true; return A; }
    A.e13 = ema(c, 13); A.e21 = ema(c, 21); A.e25 = ema(c, 25); A.e30 = ema(c, 30); A.e34 = ema(c, 34); A.e55 = ema(c, 55);
    A.m100 = sma(c, 100); A.m200 = sma(c, 200); A.m300 = sma(c, 300); A.e200 = rma(c, 99);
    A.atr = atr(h, l, c, P.atrLen);
    const st = stochRsi(c); A.stK = st.k; A.stD = st.d; A.rsi = st.rsi;
    const basis = sma(c, 20), sd = stdev(c, 20); A.bbw = basis.map((b, i) => isNum(b) && isNum(sd[i]) ? (4 * sd[i]) / b * 100 : NaN);
    const e20 = ema(c, 20); A.ttmOn = A.atr.map((x, i) => isNum(sd[i]) && isNum(x) ? (2 * sd[i] < 1.5 * x) : false); // BB(20,2) inside KC(20,1.5 ATR); ATR14 as KC range proxy
    const i = n - 1; A.i = i; A.close = c[i]; A.ATR = A.atr[i];
    // slopes
    A.slope = {}; A.cls = {};
    for (const [k, line, kk, flat] of [['e13', A.e13, P.slopeKShort, P.flatShort], ['e21', A.e21, P.slopeKShort, P.flatShort], ['m100', A.m100, P.slopeKLong, P.flatLong], ['e200', A.e200, P.slopeKLong, P.flatLong], ['m300', A.m300, P.slopeKLong, P.flatLong], ['m200', A.m200, P.slopeKLong, P.flatLong]]) {
      A.slope[k] = slopeOf(line, A.atr, i, kk); A.cls[k] = slopeClass(A.slope[k], flat);
    }
    A.trend = trendState(A);
    A.structure = structureState(A);
    A.diag = ['1h', '4h', '12h', '1d'].includes(tf) ? diagonals(A) : null;
    A.comp = compressionState(A);
    A.respect = respectState(A);
    A.range = rangeState(A);
    A.regime = regimeOf(A);
    A.momentum = momentumState(A);
    A.blowoff = blowoffIdx(A);
    A.squeeze = { bbPct: pctRank(A.bbw, i, P.pctWindow), bbSqueeze: pctRank(A.bbw, i, P.pctWindow) <= 10, ttm: !!A.ttmOn[i] };
    A.stoch = { k: A.stK[i], d: A.stD[i], reset: recentMin(A.stK, i, 5) <= 20, curlUp: isNum(A.stK[i]) && A.stK[i] > A.stK[i - 1] && A.stK[i - 1] > A.stK[i - 2] && recentMin(A.stK, i, 4) <= 25, maxed: A.stK[i] >= 80, resetHigh: recentMax(A.stK, i, 5) >= 80 };
    A.rsiNow = A.rsi[i];
    return A;
  }
  function recentMin(a, i, k) { let m = Infinity; for (let j = Math.max(0, i - k + 1); j <= i; j++) if (isNum(a[j])) m = Math.min(m, a[j]); return m; }
  function recentMax(a, i, k) { let m = -Infinity; for (let j = Math.max(0, i - k + 1); j <= i; j++) if (isNum(a[j])) m = Math.max(m, a[j]); return m; }

  function trendState(A) { // spec §3 "Trend (EMA13/21 band)"
    const { c, l, h, e13, e21, e25, atr: at, i } = A;
    if (!isNum(e21[i])) return { dir: 'na' };
    const dir = e13[i] >= e21[i] ? 'up' : 'down';
    const sgn = dir === 'up' ? 1 : -1;
    const onSide = (j) => sgn * (c[j] - e21[j]) >= 0;
    const lostAt = (j) => { // bull: 2 closes below EMA21 or 1 close below EMA25, with EMA13 not ascending
      const s13 = slopeOf(e13, at, j, P.slopeKShort); const notWith = sgn > 0 ? !(s13 > P.flatShort) : !(s13 < -P.flatShort);
      const two = sgn * (c[j] - e21[j]) < 0 && sgn * (c[j - 1] - e21[j - 1]) < 0; const one25 = sgn * (c[j] - e25[j]) < 0;
      return (two || one25) && notWith;
    };
    // valid: >= 70% of the last 30 closes on the trend side of EMA21
    let side = 0, cnt = 0; for (let j = Math.max(1, i - P.trendValidBars + 1); j <= i; j++) { if (!isNum(e21[j])) continue; cnt++; if (onSide(j)) side++; }
    const valid = cnt >= 20 && side / cnt >= P.trendValidFrac;
    // trend start = last bar after which no "lost" state occurred
    let start = Math.max(1, i - 400);
    for (let j = i; j > Math.max(1, i - 400); j--) { if (isNum(e25[j]) && lostAt(j)) { start = j + 1; break; } }
    const lostNow = isNum(e25[i]) && lostAt(i);
    // reclaimed: a close >= 0.1 ATR beyond EMA21 within the last 3 bars after a lost state, and closes since on side
    let reclaimed = false; if (!lostNow && i - start <= 3 && start > 2) reclaimed = true;
    // taps since start
    let taps = 0, lastTap = -99, clearSince = true, confirmed = false; const tapIdx = [];
    for (let j = start; j <= i; j++) {
      if (!isNum(e13[j])) continue;
      const touch = sgn > 0 ? l[j] <= e13[j] : h[j] >= e13[j];
      if (touch && clearSince && j - lastTap >= P.tapGapBars) { taps++; lastTap = j; clearSince = false; tapIdx.push(j); if (onSide(j)) confirmed = true; }
      if (sgn > 0 ? h[j] >= e13[j] + P.tapClearAtr * at[j] : l[j] <= e13[j] - P.tapClearAtr * at[j]) clearSince = true;
    }
    const s13 = A.slope.e13;
    const holding = !lostNow && onSide(i) && (sgn > 0 ? !(s13 < -P.flatShort) : !(s13 > P.flatShort));
    const distBand = (c[i] - e13[i]) / at[i]; // in ATR, >0 above EMA13
    return { dir, holding, lost: lostNow || !onSide(i), valid, taps, tapIdx, confirmed, start, barsSinceStart: i - start, reclaimed, distBand, inBand: sgn > 0 ? (l[i] <= e13[i] && c[i] >= e21[i] - 0.3 * at[i]) : (h[i] >= e13[i] && c[i] <= e21[i] + 0.3 * at[i]) };
  }

  function structureState(A) { // pivots -> HH/HL | LH/LL | undefined (spec §3)
    const left = ['12h', '1d', '3d', '1w'].includes(A.tf) ? 3 : 5;
    const pv = pivots(A.h, A.l, left, left); const ph = pv.ph, pl = pv.pl;
    const out = { ph, pl, label: 'undefined' };
    if (ph.length < 2 || pl.length < 2) return out;
    const h1 = last(ph, 1).p, h2 = last(ph).p, l1 = last(pl, 1).p, l2 = last(pl).p;
    const HH = h2 > h1, HL = l2 > l1;
    out.lastHigh = last(ph); out.lastLow = last(pl); out.prevHigh = last(ph, 1); out.prevLow = last(pl, 1);
    // live breaks of the last swing (price beyond the last confirmed pivot)
    const c = A.close; out.brokeHigh = c > h2; out.brokeLow = c < l2;
    if (HH && HL) out.label = 'bull'; else if (!HH && !HL) out.label = 'bear'; else out.label = 'undefined';
    if (out.label === 'bear' && out.brokeHigh) out.label = 'undefined';
    if (out.label === 'bull' && out.brokeLow) out.label = 'undefined';
    out.hhhlText = (HH ? 'HH' : 'LH') + '/' + (HL ? 'HL' : 'LL');
    return out;
  }

  // ---------- [ADD-ON] diagonal trend lines ----------
  // Krillin (C2-L15, C2-L18, C4-L08, C5-L01): a compression plus a diagonal breakout = a stronger breakout; expect a nasty second retest
  // of the diagonal; the compression is the more powerful signal; diagonal resistance = TP3 in price discovery (clone the support line
  // for a parallel channel); diagonals add confluence to retest shorts and dip bids. The detection rules below are outside Krillin:
  // a line joins two confirmed swing pivots, candle CLOSES must respect it (wicks may poke through), touches = pivots within 0.3 ATR.
  function diagonals(A) {
    const out = { res: null, sup: null }; const { h, l, c, atr: at, i } = A; if (i < 60 || !isNum(at[i])) return out;
    const from = Math.max(0, i - P.diagWindow);
    for (const kind of ['res', 'sup']) {
      const all = kind === 'res' ? A.structure.ph : A.structure.pl; const piv = all.filter((p) => p.i >= from).slice(-P.diagPivots);
      const sgn = kind === 'res' ? 1 : -1; let best = null;
      for (let x = 0; x < piv.length - 1; x++) for (let y = x + 1; y < piv.length; y++) {
        const p1 = piv[x], p2 = piv[y]; const span = p2.i - p1.i; if (span < P.diagMinSpan) continue;
        if (kind === 'res' ? !(p1.p > p2.p) : !(p1.p < p2.p)) continue; // descending resistance / ascending support
        const a2 = isNum(at[p2.i]) ? at[p2.i] : at[i]; if (Math.abs(p1.p - p2.p) < P.diagMinMoveAtr * a2) continue; // too flat: that is a horizontal
        const slope = (p2.p - p1.p) / span; if (Math.abs(slope) > P.diagMaxSlopeAtr * a2) continue;
        const val = (k) => p1.p + slope * (k - p1.i);
        let ok = true, brk = -1;
        for (let k = p1.i + 1; k <= i; k++) { const ak = isNum(at[k]) ? at[k] : a2; const d = sgn * (c[k] - val(k)); if (k <= p2.i) { if (d > P.diagTolAtr * ak) { ok = false; break; } } else if (d > P.resolveAtr * ak) { brk = k; break; } }
        if (!ok) continue;
        const lastK = brk >= 0 ? brk : i; let touches = 0, lastT = -99;
        for (const q of all) { if (q.i < p1.i || q.i > lastK) continue; const aq = isNum(at[q.i]) ? at[q.i] : a2; if (Math.abs(q.p - val(q.i)) <= P.diagTouchAtr * aq && q.i - lastT >= 3) { touches++; lastT = q.i; } }
        if (touches < 2) continue;
        if (brk < 0 && Math.abs(c[i] - val(i)) > P.diagRelAtr * at[i]) continue; // intact but far from price: not relevant now
        if (brk >= 0 && i - brk > P.diagBrokenBars) continue; // broken long ago
        const score = touches * 3 + (i - p2.i < 60 ? 2 : 0) + Math.min(3, span / 60) + (brk >= 0 ? 1 : 0);
        if (!best || score > best.score || (score === best.score && p2.i > best.p2.i)) best = { p1, p2, slope, brk, touches, score, val, span };
      }
      if (!best) continue;
      const { p1, p2, slope, brk, touches, val, span } = best;
      const d = { kind, i1: p1.i, p1: p1.p, i2: p2.i, p2: p2.p, t1: A.t[p1.i], t2: A.t[p2.i], slope, slopeAtr: slope / at[i], touches, span, value: val(i), next: val(i + 1), state: 'intact', brk, barsSince: brk >= 0 ? i - brk : NaN, retests: 0, breakStrong: false, extreme: NaN, chanOff: NaN };
      if (brk >= 0) {
        let rs = 0, lastR = -99, ext = kind === 'res' ? Infinity : -Infinity;
        for (let k = brk + 1; k <= i; k++) {
          const ak = at[k]; if (sgn * (c[k] - val(k)) < -P.resolveAtr * ak) { d.state = 'failed'; d.failBar = k; break; }
          const touch = kind === 'res' ? l[k] <= val(k) + P.diagTouchAtr * ak : h[k] >= val(k) - P.diagTouchAtr * ak; if (touch && k - lastR >= 3) { rs++; lastR = k; }
          ext = kind === 'res' ? Math.min(ext, l[k]) : Math.max(ext, h[k]);
        }
        if (d.state !== 'failed') d.state = 'broken'; d.retests = rs; d.extreme = isFinite(ext) ? ext : val(i);
        let avg = 0, nb = 0; for (let k = Math.max(0, brk - 20); k < brk; k++) { avg += h[k] - l[k]; nb++; } avg = nb ? avg / nb : NaN; d.breakStrong = isNum(avg) && (h[brk] - l[brk]) >= P.strongBreak * avg;
      }
      // parallel channel (C2-L15: clone the support line): offset through the extreme opposite swing between the anchors and the break/now
      let off = kind === 'res' ? Infinity : -Infinity; for (let k = p1.i; k <= (brk >= 0 ? brk : i); k++) off = kind === 'res' ? Math.min(off, l[k] - val(k)) : Math.max(off, h[k] - val(k)); d.chanOff = isFinite(off) ? off : NaN;
      out[kind] = d;
    }
    return out;
  }

  function respectState(A) { // closes crossing EMA200 / MA100 in the last 100 bars (spec §3 MA respect)
    const { c, e200, m100, i } = A; let xe = 0, xm = 0;
    for (let j = Math.max(1, i - 99); j <= i; j++) {
      if (isNum(e200[j]) && isNum(e200[j - 1]) && Math.sign(c[j] - e200[j]) !== Math.sign(c[j - 1] - e200[j - 1])) xe++;
      if (isNum(m100[j]) && isNum(m100[j - 1]) && Math.sign(c[j] - m100[j]) !== Math.sign(c[j - 1] - m100[j - 1])) xm++;
    }
    return { e200Crosses: xe, m100Crosses: xm, e200Respected: xe < P.respectCrosses, m100Respected: xm < P.respectCrosses };
  }

  function compressionState(A) { // spec §4
    const { c, h, l, m100, e200, m300, m200, atr: at, i, tf } = A;
    const out = { state: 'none', available: isNum(m300[i]) && isNum(e200[i]) };
    if (!out.available) { out.reason = 'Needs 300+ candles for MA300'; return out; }
    const n = c.length; const sp = new Array(n).fill(NaN), gap = new Array(n).fill(NaN);
    for (let j = 0; j < n; j++) if (isNum(m300[j]) && isNum(e200[j]) && isNum(at[j]) && at[j] > 0) { const mx = Math.max(m100[j], e200[j], m300[j]), mn = Math.min(m100[j], e200[j], m300[j]); sp[j] = (mx - mn) / at[j]; gap[j] = Math.abs(m100[j] - m300[j]) / at[j]; }
    out.sp = sp[i]; out.pct = pctRank(sp, i, P.pctWindow); out.spPctOfPrice = (Math.max(m100[i], e200[i], m300[i]) - Math.min(m100[i], e200[i], m300[i])) / c[i] * 100;
    out.lowHistory = !isNum(out.pct);
    if (out.lowHistory) { // fall back to a shorter window when history is short
      let nn = 0, le = 0; for (let j = 0; j < i; j++) if (isNum(sp[j])) { nn++; if (sp[j] <= sp[i]) le++; } out.pct = nn >= 20 ? 100 * le / nn : NaN;
    }
    const top = Math.max(m100[i], e200[i], m300[i]), bot = Math.min(m100[i], e200[i], m300[i]);
    out.top = top; out.bottom = bot; out.mid = e200[i];
    out.topName = top === m100[i] ? 'MA100' : top === m300[i] ? 'MA300' : 'EMA200';
    out.bottomName = bot === m100[i] ? 'MA100' : bot === m300[i] ? 'MA300' : 'EMA200';
    out.validBanana = e200[i] <= Math.max(m100[i], m300[i]) && e200[i] >= Math.min(m100[i], m300[i]);
    // order (spec §4.4)
    let order = 'mixed';
    if (m300[i] < e200[i] && e200[i] < m100[i]) order = 'bullCont';        // MA300 < EMA200 < MA100 (old uptrend order)
    else if (m100[i] < e200[i] && e200[i] < m300[i]) order = (isNum(m200[i]) && e200[i] < m200[i]) ? 'bullRevWrong' : 'bullRev'; // MA100 bottom; EMA200 must sit above MA200
    out.order = order; // bullRev* is also the bearish-continuation order; direction comes from §4.4 clues
    // last MA100/EMA200 cross (banana origin)
    let lastCross = -1; for (let j = i; j > 0; j--) { if (isNum(e200[j - 1]) && Math.sign(m100[j] - e200[j]) !== Math.sign(m100[j - 1] - e200[j - 1])) { lastCross = j; break; } }
    out.lastCross = lastCross; out.barsSinceCross = lastCross >= 0 ? i - lastCross : NaN;
    // quality (§4.3)
    if (lastCross > 0) {
      const meanNow = (m100[i] + e200[i] + m300[i]) / 3, meanX = (m100[lastCross] + e200[lastCross] + m300[lastCross]) / 3;
      out.disp = Math.abs(meanNow - meanX) / at[i];
      let hi = -Infinity, lo = Infinity; for (let j = lastCross; j <= i; j++) { hi = Math.max(hi, h[j]); lo = Math.min(lo, l[j]); }
      out.rangeSinceCross = (hi - lo) / at[i];
    } else { out.disp = NaN; out.rangeSinceCross = NaN; }
    let crosses150 = 0; for (let j = Math.max(1, i - 149); j <= i; j++) if (isNum(e200[j - 1]) && Math.sign(m100[j] - e200[j]) !== Math.sign(m100[j - 1] - e200[j - 1])) crosses150++;
    out.maCrosses150 = crosses150;
    out.quality = { dispOk: out.disp >= P.qualityDispAtr, notInRange: !(out.rangeSinceCross < P.rangeAtr), notChopFlat: crosses150 < 3 };
    out.qualityOk = out.quality.dispOk && out.quality.notInRange && out.quality.notChopFlat;
    // tight streak and closes-through-band count (stale rule)
    const pctCache = new Map(); const pctAt = (k) => { if (!pctCache.has(k)) pctCache.set(k, pctRank(sp, k, P.pctWindow)); return pctCache.get(k); };
    let tightBars = 0, j = i; const tightAt = (k) => { const pk = pctAt(k); return isNum(pk) ? pk <= P.tightPct : false; };
    while (j > 0 && tightAt(j) && tightBars < 400) { tightBars++; j--; }
    out.tightBars = tightBars;
    let through = 0, prevSide = 0; for (let k = i - tightBars + 1; k <= i; k++) { if (k < 0) continue; const tp = Math.max(m100[k], e200[k], m300[k]), bt = Math.min(m100[k], e200[k], m300[k]); const s = c[k] > tp ? 1 : c[k] < bt ? -1 : 0; if (s !== 0) { if (prevSide !== 0 && s !== prevSide) through++; prevSide = s; } }
    out.closesThrough = through;
    // recent tight window (for resolution / cluster)
    let lastTight = -1; for (let k = i; k >= Math.max(0, i - 200); k--) if (tightAt(k)) { lastTight = k; break; }
    out.lastTight = lastTight; out.barsSinceTight = lastTight >= 0 ? i - lastTight : NaN;
    // resolution bar after the last tight window
    let resBar = -1, resDir = null;
    if (lastTight >= 0) for (let k = lastTight; k <= i; k++) { const tp = Math.max(m100[k], e200[k], m300[k]), bt = Math.min(m100[k], e200[k], m300[k]); if (c[k] > tp + P.resolveAtr * at[k]) { resBar = k; resDir = 'up'; break; } if (c[k] < bt - P.resolveAtr * at[k]) { resBar = k; resDir = 'down'; break; } }
    out.resBar = resBar; out.resDir = resDir;
    if (resBar >= 0) { // break quality: range vs average range during the tight window
      let s = 0, m = 0; for (let k = Math.max(0, resBar - Math.max(10, Math.min(tightBars || 20, 60))); k < resBar; k++) { s += h[k] - l[k]; m++; }
      const avg = m ? s / m : NaN; out.breakRangeX = (h[resBar] - l[resBar]) / avg; out.breakStrong = out.breakRangeX >= P.strongBreak;
    }
    // midline and banana slope
    out.midSlope = A.cls.e200; out.m100Slope = A.cls.m100; out.m300Slope = A.cls.m300;
    // apex: spread at a 100-bar low
    let min100 = Infinity; for (let k = Math.max(0, i - P.apexBars); k < i; k++) if (isNum(sp[k])) min100 = Math.min(min100, sp[k]);
    const isTight = isNum(out.pct) && out.pct <= P.tightPct && out.validBanana;
    const isApex = isTight && sp[i] <= min100 * 1.02;
    const gapPct = pctRank(gap, i, P.pctWindow); out.gapPct = gapPct;
    const widening = isNum(gap[i - 10]) && gap[i] > gap[i - 10];
    const spreadRising = isNum(sp[i - 10]) && sp[i] > sp[i - 10];
    const bullStack = m100[i] > e200[i] && e200[i] > m300[i], bearStack = m100[i] < e200[i] && e200[i] < m300[i];
    out.bullStack = bullStack; out.bearStack = bearStack;
    // rounding: MA100 lost for the first time after an expansion (bull), mirror for bear
    let closesBelow100 = 0, closesAbove100 = 0, wasExpanded = false;
    for (let k = Math.max(1, i - 99); k <= i; k++) { if (c[k] < m100[k]) closesBelow100++; else closesAbove100++; }
    for (let k = Math.max(1, i - 60); k <= i; k++) { const pk = pctAt(k); if (pk >= P.widePct) { wasExpanded = true; break; } }
    const roundingBull = bullStack && c[i] < m100[i] && closesBelow100 <= 15 && wasExpanded;
    const roundingBear = bearStack && c[i] > m100[i] && closesAbove100 <= 15 && wasExpanded;
    // cluster: after a resolution, tight-ish, parallel, all sloping the same way, no fresh MA100/EMA200 cross
    const allUp = A.cls.m100 === 'up' && A.cls.e200 === 'up' && A.cls.m300 === 'up';
    const allDown = A.cls.m100 === 'down' && A.cls.e200 === 'down' && A.cls.m300 === 'down';
    const noFreshCross = !(out.barsSinceCross < 30);
    const clusterUp = resDir === 'up' && isNum(out.pct) && out.pct <= 40 && allUp && noFreshCross && c[i] > bot;
    const clusterDown = resDir === 'down' && isNum(out.pct) && out.pct <= 40 && allDown && noFreshCross && c[i] < top;
    // continuation-compression invalidation: close below MA300 not reclaimed within N bars (bull order)
    let belowM300 = 0; for (let k = i; k > i - 10 && k > 0; k--) { if (c[k] < m300[k]) belowM300++; else break; }
    out.closesBelowM300 = belowM300;
    const stale = tightBars > (tf === '15m' ? P.staleBars15 : P.staleBars) && through >= 3;
    // precedence
    const beyond = c[i] > top + P.resolveAtr * at[i] ? 'up' : c[i] < bot - P.resolveAtr * at[i] ? 'down' : null;
    if (isTight && beyond) { // price has escaped the tight banana: the start of the current streak outside the band is the resolution bar
      let k = i; while (k > 0 && (beyond === 'up' ? c[k - 1] > Math.max(m100[k - 1], e200[k - 1], m300[k - 1]) : c[k - 1] < Math.min(m100[k - 1], e200[k - 1], m300[k - 1]))) k--;
      out.resBar = k; out.resDir = beyond; resBar = k; resDir = beyond;
    }
    out.beyond = beyond; out.beyondAtr = beyond === 'up' ? (c[i] - top) / at[i] : beyond === 'down' ? (bot - c[i]) / at[i] : 0;
    let state = 'none';
    if (out.order === 'bullCont' && (isTight || (isNum(out.pct) && out.pct <= P.widePct)) && belowM300 > P.invalidBars) state = 'invalid';
    else if (stale) state = 'stale';
    else if (resBar >= 0 && (i - resBar <= 30 || (isTight && beyond)) && (!isTight || beyond)) state = resDir === 'up' ? 'resolved_up' : 'resolved_down';
    else if (clusterUp || clusterDown) state = 'cluster';
    else if (isApex) state = 'apex';
    else if (isTight) state = 'tight';
    else if (roundingBull || roundingBear) state = 'rounding';
    else if (isNum(out.pct) && out.pct <= P.widePct) state = 'wide';
    else if (isNum(gapPct) && gapPct >= 90 && widening) state = 'extension';
    else if (isNum(out.pct) && spreadRising && (bullStack || bearStack)) state = 'expansion';
    else if (bullStack || bearStack) state = 'trend_ma';
    out.state = state; out.clusterDir = clusterUp ? 'up' : clusterDown ? 'down' : null; out.roundingDir = roundingBull ? 'bull' : roundingBear ? 'bear' : null;
    return out;
  }

  function rangeState(A) { // §5.1 range box [P]
    const { h, l, c, i } = A; const W = 100; if (i < W) return { isRange: false };
    let hi = -Infinity, lo = Infinity; for (let k = i - W + 1; k <= i; k++) { hi = Math.max(hi, h[k]); lo = Math.min(lo, l[k]); }
    const w = hi - lo; const pv = pivots(h.slice(i - W + 1, i + 1), l.slice(i - W + 1, i + 1), 3, 3);
    const topHits = pv.ph.filter(p => p.p >= hi - 0.25 * w).length, botHits = pv.pl.filter(p => p.p <= lo + 0.25 * w).length;
    const tangled = A.respect ? A.respect.e200Crosses >= P.respectCrosses : false;
    const isRange = topHits >= 2 && botHits >= 2 && tangled;
    return { isRange, hi, lo, mid: (hi + lo) / 2, width: w, widthPct: w / lo * 100, pos: (c[i] - lo) / w, devBelow: [lo - 0.2 * w, lo - 0.15 * w], devAbove: [hi + 0.15 * w, hi + 0.2 * w] };
  }

  function regimeOf(A) {
    const t = A.trend, s = A.structure;
    if (A.tf === '1d' && A.blowoffRegime) return 'post_blowoff';
    if (t.valid && t.dir === 'up' && s.label !== 'bear') return 'trend_up';
    if (t.valid && t.dir === 'down' && s.label !== 'bull') return 'trend_down';
    if (A.range && A.range.isRange) return 'range';
    return 'chop';
  }

  function momentumState(A) { // shrinking highs = waning (C4-L08); leg sizes
    const ph = A.structure.ph; if (!ph || ph.length < 3) return { waning: false };
    const a = ph[ph.length - 3].p, b = ph[ph.length - 2].p, d = ph[ph.length - 1].p;
    const inc1 = b - a, inc2 = d - b; return { waning: inc1 > 0 && inc2 > 0 && inc2 < inc1 * 0.6, accelerating: inc1 > 0 && inc2 > inc1 * 1.2 };
  }
  function blowoffIdx(A) { // last blow-off candle within 30 bars [P]
    const { h, l, c, o, atr: at, i } = A;
    for (let k = i; k > Math.max(0, i - 30); k--) {
      const r = h[k] - l[k]; if (!(r > P.blowRangeAtr * at[k])) continue;
      const upW = h[k] - Math.max(o[k], c[k]), dnW = Math.min(o[k], c[k]) - l[k];
      if (upW / r > P.blowWick) return { i: k, dir: 'top', barsAgo: i - k };
      if (dnW / r > P.blowWick) return { i: k, dir: 'bottom', barsAgo: i - k };
    }
    return null;
  }
  function postBlowoff(D) { // daily: blow-off top + >30% drop within 20 bars -> 60 days re-accumulation regime (§5.1)
    const { h, l, c, o, atr: at, i } = D;
    for (let k = i; k > Math.max(0, i - 60); k--) {
      const r = h[k] - l[k]; if (!(r > P.blowRangeAtr * at[k])) continue;
      const upW = h[k] - Math.max(o[k], c[k]); if (upW / r <= P.blowWick) continue;
      let mn = Infinity; for (let j = k; j <= Math.min(i, k + 20); j++) mn = Math.min(mn, l[j]);
      if ((h[k] - mn) / h[k] >= 0.30) return { i: k, daysAgo: i - k };
    }
    return null;
  }

  // ---------- coin analysis ----------
  // data: {'1h': series, '4h': series, '1d': series, '15m'?: series}
  // States are computed on CLOSED candles only (the forming candle is dropped); the live price is kept separately.
  function sliceS(s, n) { return { t: s.t.slice(0, n), o: s.o.slice(0, n), h: s.h.slice(0, n), l: s.l.slice(0, n), c: s.c.slice(0, n), v: s.v.slice(0, n) }; }
  function closedOnly(s, tf, now) { const ms = TF_MS[tf]; let n = s.t.length; while (n > 0 && s.t[n - 1] + ms > now) n--; return n === s.t.length ? s : sliceS(s, n); }
  function analyzeCoin(data, now) {
    now = now || Date.now(); const T = {};
    const raw = data['15m'] || data['1h'] || data['4h'] || data['1d']; T.live = raw ? raw.c[raw.c.length - 1] : NaN; T.liveTime = raw ? raw.t[raw.t.length - 1] : NaN;
    if (data['15m']) T['15m'] = analyzeTF(closedOnly(data['15m'], '15m', now), '15m');
    if (data['1h']) T['1h'] = analyzeTF(closedOnly(data['1h'], '1h', now), '1h');
    if (data['4h']) { const c4 = closedOnly(data['4h'], '4h', now); T['4h'] = analyzeTF(c4, '4h'); T['12h'] = analyzeTF(closedOnly(aggregate(c4, '12h'), '12h', now), '12h'); }
    if (data['1d']) {
      const cd = closedOnly(data['1d'], '1d', now);
      const D = analyzeTF(cd, '1d'); if (!D.insufficient) { const pb = postBlowoff(D); if (pb) { D.blowoffRegime = pb; D.regime = 'post_blowoff'; } }
      T['1d'] = D; T['3d'] = analyzeTF(closedOnly(aggregate(cd, '3d'), '3d', now), '3d'); T['1w'] = analyzeTF(closedOnly(aggregate(cd, '1w'), '1w', now), '1w');
    }
    return T;
  }
  // explicit (tf, line) accessor — spec §7 timeframe convention
  function L(T, tf, name, k = 0) { const A = T[tf]; if (!A || A.insufficient || !A[name]) return NaN; return A[name][A.i - k]; }

  // ---------- levels engine (§6) ----------
  function buildLevels(T, opts) {
    const D = T['1d'], H4 = T['4h']; const price = isNum(T.live) ? T.live : (T['1h'] || H4 || D).close;
    const levels = [];
    if (D && !D.insufficient) {
      const atrD = D.ATR;
      // 1) HTF horizontals from daily + 3D pivots, body-based, clustered
      const raw = [];
      for (const [A, left] of [[D, 3], [T['3d'], 3]]) {
        if (!A || A.insufficient) continue; const pv = pivots(A.h, A.l, left, left);
        for (const p of pv.ph) { const bodyTop = Math.max(A.o[p.i], A.c[p.i]); const wick = A.h[p.i] - bodyTop; const top = wick > P.outsizedWickAtr * atrD ? bodyTop : Math.min(A.h[p.i], bodyTop + P.wickAtr * atrD); raw.push({ lo: bodyTop, hi: top, kind: 'H', t: A.t[p.i], tf: A.tf }); }
        for (const p of pv.pl) { const bodyBot = Math.min(A.o[p.i], A.c[p.i]); const wick = bodyBot - A.l[p.i]; const bot = wick > P.outsizedWickAtr * atrD ? bodyBot : Math.max(A.l[p.i], bodyBot - P.wickAtr * atrD); raw.push({ lo: bot, hi: bodyBot, kind: 'L', t: A.t[p.i], tf: A.tf }); }
      }
      raw.sort((a, b) => (a.lo + a.hi) - (b.lo + b.hi));
      const clusters = [];
      for (const r of raw) { const m = (r.lo + r.hi) / 2; const cl = clusters[clusters.length - 1]; if (cl && m - cl.mid <= P.clusterAtr * atrD && Math.max(cl.hi, r.hi) - Math.min(cl.lo, r.lo) <= P.boxMaxAtr * atrD) { cl.items.push(r); cl.lo = Math.min(cl.lo, r.lo); cl.hi = Math.max(cl.hi, r.hi); cl.mid = (cl.mid * (cl.items.length - 1) + m) / cl.items.length; } else clusters.push({ lo: r.lo, hi: r.hi, mid: m, items: [r] }); }
      const tNow = D.t[D.i];
      for (const cl of clusters) {
        const hs = cl.items.filter(x => x.kind === 'H').length, ls = cl.items.filter(x => x.kind === 'L').length;
        const recency = Math.max(...cl.items.map(x => x.t)); const ageDays = (tNow - recency) / 864e5;
        const score = cl.items.length + 2 * Math.min(hs, ls) + (ageDays < 90 ? 2 : ageDays < 365 ? 1 : 0);
        levels.push({ type: 'horizontal', name: hs && ls ? 'HTF S/R flip' : hs ? 'HTF swing high' : 'HTF swing low', tf: '1d', lo: cl.lo, hi: cl.hi, mid: cl.mid, score, touches: cl.items.length, flips: Math.min(hs, ls) });
      }
      // 2) last support before breakdown + 3) breakdown/breakout order blocks (daily and 4h)
      for (const A of [D, H4]) { if (!A || A.insufficient) continue; obScan(A, levels); }
      // inefficiencies: strict FVGs on 4h and daily, unfilled
      for (const A of [D, H4]) { if (!A || A.insufficient) continue; fvgScan(A, levels, price); }
    }
    // 6) MA levels with slope (explicit TF)
    const maList = [['4h', 'e200', '4h EMA200'], ['12h', 'e200', '12h EMA200 (= daily EMA100)'], ['1d', 'e13', 'Daily EMA13'], ['1d', 'e21', 'Daily EMA21'], ['1d', 'm100', 'Daily MA100'], ['1d', 'm200', 'Daily MA200'], ['1d', 'e200', 'Daily EMA200'], ['1d', 'm300', 'Daily MA300'], ['3d', 'e200', '3D EMA200'], ['1w', 'm100', 'Weekly MA100'], ['1w', 'e13', 'Weekly EMA13'], ['4h', 'm100', '4h MA100'], ['4h', 'm300', '4h MA300'], ['1h', 'e200', '1h EMA200'], ['4h', 'e13', '4h EMA13']];
    for (const [tf, k, name] of maList) { const v = L(T, tf, k); if (!isNum(v)) continue; const A = T[tf]; const cls = A.cls[k] || 'na'; levels.push({ type: 'ma', name, tf, key: k, lo: v, hi: v, mid: v, slope: cls, score: tf === '4h' && k === 'e200' ? 6 : ['1d'].includes(tf) ? 5 : 3 }); }
    // [ADD-ON] diagonal trend lines (value projected to the forming candle; they move every candle)
    if (!opts || opts.diag !== false) for (const tf of ['1h', '4h', '12h', '1d']) {
      const A = T[tf]; if (!A || A.insufficient || !A.diag) continue; const a = A.ATR, lbl = TF_LABEL[tf];
      for (const d of [A.diag.res, A.diag.sup]) {
        if (!d || d.state === 'failed') continue; const v = d.next;
        const role = d.state === 'intact' ? d.kind : (d.kind === 'res' ? 'sup' : 'res');
        levels.push({ type: 'diagonal', name: `${lbl} ${d.kind === 'res' ? 'descending' : 'ascending'} trend line (${d.touches} touches${d.state === 'broken' ? `, broken ${d.barsSince} bar${d.barsSince === 1 ? '' : 's'} ago: ${role === 'sup' ? 'retest support' : 'retest resistance'}` : ''})`, tf, lo: v - 0.1 * a, hi: v + 0.1 * a, mid: v, role, kind: d.kind, state: d.state, slope: d.kind === 'res' ? 'down' : 'up', touches: d.touches, moving: true, score: { '1h': 2, '4h': 3, '12h': 4, '1d': 5 }[tf] + (d.touches >= 3 ? 1 : 0) });
        if (d.state === 'intact' && isNum(d.chanOff)) { const cv = v + d.chanOff; if (cv > 0) levels.push({ type: 'diagonal', name: `${lbl} channel ${d.kind === 'sup' ? 'top (support line cloned)' : 'bottom (resistance line cloned)'}`, tf, lo: cv - 0.1 * a, hi: cv + 0.1 * a, mid: cv, role: d.kind === 'sup' ? 'res' : 'sup', kind: 'chan', state: 'intact', slope: d.kind === 'res' ? 'down' : 'up', touches: 0, moving: true, score: 2 }); }
      }
    }
    // 5) range model (daily and 4h)
    const ranges = {}; for (const tf of ['4h', '1d']) { const A = T[tf]; if (A && !A.insufficient && A.range && A.range.isRange) ranges[tf] = A.range; }
    // de-duplicate levels of the same type/TF whose zones overlap by > 80%
    for (let a1 = levels.length - 1; a1 >= 0; a1--) { const x = levels[a1]; for (let b1 = 0; b1 < a1; b1++) { const y = levels[b1]; if (x.type !== y.type || x.tf !== y.tf) continue; const ov = Math.min(x.hi, y.hi) - Math.max(x.lo, y.lo); const wmin = Math.max(Math.min(x.hi - x.lo, y.hi - y.lo), 1e-12); if (ov / wmin > 0.8 || (x.lo === y.lo && x.hi === y.hi)) { levels.splice(a1, 1); break; } } }
    // distances
    for (const lv of levels) { lv.distPct = (lv.mid - price) / price * 100; lv.side = lv.lo > price ? 'above' : lv.hi < price ? 'below' : 'at'; }
    return { levels, ranges, price };
  }
  function obScan(A, levels) {
    const { o, h, l, c, atr: at, i, tf } = A; const pv = pivots(h, l, 3, 3);
    const lowsBefore = (k) => { let best = null; for (const p of pv.pl) { if (p.i < k) best = p; else break; } return best; };
    const highsBefore = (k) => { let best = null; for (const p of pv.ph) { if (p.i < k) best = p; else break; } return best; };
    for (let s = Math.max(5, i - 400); s <= i - 1; s++) {
      if (!isNum(at[s])) continue;
      for (const dir of ['down', 'up']) {
        // impulse over <= 3 candles starting at s
        let e = -1; for (let k = s; k <= Math.min(i, s + 2); k++) { const mv = dir === 'down' ? h[s] - l[k] : h[k] - l[s]; if (mv >= P.obImpulseAtr * at[s]) { e = k; break; } }
        if (e < 0) continue; if (dir === 'down' ? !(c[s] < o[s]) : !(c[s] > o[s])) continue; // first impulse candle must go the impulse's way
        if (dir === 'down') {
          const sw = lowsBefore(s); if (!sw || !(l[e] < sw.p)) continue; // breaks a swing low
          const fail = s - 1; const top = Math.max(h[fail], h[s]), bot = l[fail];
          let mitigated = false, firstRevisit = true; for (let k = e + 1; k <= i; k++) { if (h[k] >= bot) { firstRevisit = false; } if (c[k] > top) { mitigated = true; break; } }
          levels.push({ type: 'ob_breakdown', name: `${TF_LABEL[tf]} breakdown order block`, tf, lo: bot, hi: top, mid: (bot + top) / 2, score: tf === '1d' ? 6 : 4, mitigated, untouched: firstRevisit, t: A.t[s] });
          const sup = sw; const sLo = Math.min(o[sup.i], c[sup.i]); let revisited = false; for (let k = e + 1; k <= i; k++) if (h[k] >= sLo) { revisited = true; break; }
          levels.push({ type: 'last_support', name: `Last support before breakdown (${TF_LABEL[tf]})`, tf, lo: Math.min(sLo, sup.p), hi: Math.max(sLo, sup.p), mid: (sLo + sup.p) / 2, score: tf === '1d' ? 7 : 5, firstRevisit: !revisited, t: A.t[sup.i] });
        } else {
          const sw = highsBefore(s); if (!sw || !(h[e] > sw.p)) continue;
          const fail = s - 1; const bot = Math.min(l[fail], l[s]), top = h[fail];
          let mitigated = false; for (let k = e + 1; k <= i; k++) { if (c[k] < bot) { mitigated = true; break; } }
          levels.push({ type: 'ob_breakout', name: `${TF_LABEL[tf]} breakout order block`, tf, lo: bot, hi: top, mid: (bot + top) / 2, score: tf === '1d' ? 5 : 3, mitigated, t: A.t[s] });
        }
        s = e; break;
      }
    }
    // keep only unmitigated, most recent 4 per type per tf
    const keep = (type) => { const xs = levels.filter(x => x.type === type && x.tf === tf); xs.sort((a, b) => b.t - a.t); xs.forEach((x, k) => { if (x.mitigated || k >= 4) x.drop = true; }); };
    keep('ob_breakdown'); keep('ob_breakout'); keep('last_support');
    for (let k = levels.length - 1; k >= 0; k--) if (levels[k].drop) levels.splice(k, 1);
  }
  function fvgScan(A, levels, price) {
    const { h, l, i, tf } = A; const found = [];
    for (let k = Math.max(2, i - 300); k <= i; k++) {
      if (l[k] > h[k - 2]) { let top = l[k], bot = h[k - 2]; for (let j = k + 1; j <= i; j++) { if (l[j] < top) top = Math.max(bot, l[j]); if (top <= bot) break; } if (top > bot) found.push({ type: 'fvg', name: `${TF_LABEL[tf]} bullish inefficiency (unfilled)`, tf, lo: bot, hi: top, mid: (bot + top) / 2, score: tf === '1d' ? 4 : 2, dir: 'bull', t: A.t[k] }); }
      if (h[k] < l[k - 2]) { let bot = h[k], top = l[k - 2]; for (let j = k + 1; j <= i; j++) { if (h[j] > bot) bot = Math.min(top, h[j]); if (bot >= top) break; } if (top > bot) found.push({ type: 'fvg', name: `${TF_LABEL[tf]} bearish inefficiency (unfilled)`, tf, lo: bot, hi: top, mid: (bot + top) / 2, score: tf === '1d' ? 4 : 2, dir: 'bear', t: A.t[k] }); }
    }
    found.sort((a, b) => Math.abs(a.mid - price) - Math.abs(b.mid - price));
    for (const f of found.slice(0, 6)) levels.push(f);
  }

  // ---------- bias (§5.2) ----------
  function tfBias(A) {
    if (!A || A.insufficient) return { label: 'n/a' };
    const s = A.structure.label, t = A.trend, cp = A.comp;
    let score = 0; if (s === 'bull') score += 2; if (s === 'bear') score -= 2;
    if (t.valid) score += t.dir === 'up' ? 1 : -1; if (t.dir === 'up' && !t.lost) score += 0.5; if (t.dir === 'down' && !t.lost) score -= 0.5;
    if (isNum(A.e200[A.i])) score += A.close > A.e200[A.i] ? 0.5 : -0.5;
    if (A.cls.e200 === 'up') score += 0.5; if (A.cls.e200 === 'down') score -= 0.5;
    const label = score >= 2 ? 'bullish' : score <= -2 ? 'bearish' : A.regime === 'range' ? 'range' : 'neutral';
    return { label, score, structure: A.structure.hhhlText || 'n/a', structureLabel: s, regime: A.regime, maState: cp.state, trend: t.dir + (t.lost ? ' (lost)' : t.valid ? '' : ' (chopped)'), taps: t.taps };
  }

  // ---------- setups (§7) ----------
  function mkSetup(o) { return Object.assign({ gates: [], warnings: [], confluence: [], status: 'forming' }, o); }
  function near(x, lo, hi, tol) { return x >= lo - tol && x <= hi + tol; }

  function detectSetups(T, lv, ctx) {
    const out = []; const price = lv.price;
    const htfBiasBull = ['bullish'].includes(tfBias(T['1d']).label) || (tfBias(T['1d']).label === 'neutral' && tfBias(T['1w']).label === 'bullish');
    const htfBiasBear = tfBias(T['1d']).label === 'bearish';
    // --- A1: 1h trend continuation (spec §7 A1) ---
    (() => {
      const H = T['1h'], H4 = T['4h']; if (!H || H.insufficient || !H4 || H4.insufficient) return;
      const t = H.trend; if (t.dir !== 'up') return;
      const e13 = L(T, '1h', 'e13'), e21 = L(T, '1h', 'e21'), e30 = L(T, '1h', 'e30'), a = H.ATR;
      const above4hTrend = price >= L(T, '4h', 'e21');
      const S = mkSetup({ id: 'A1', family: 'Trend continuation', name: '1h trend continuation', tf: '1h', dir: 'long',
        entry: [e21, e13], entryText: 'Bids between 1h EMA13 and 1h EMA21', stop: e30 - 0.2 * a, stopText: 'Below 1h EMA25-30 (1h EMA30 − 0.2 ATR)',
        why: [t.lost ? '1h trend just lost' : `1h trend up, ${t.taps} tap(s) since it started`, above4hTrend ? 'Price is above the 4h trend (4h EMA21)' : 'Price is NOT above the 4h trend'], nextIfLost: 'If the 1h trend is lost: 15m EMA200 ≈ 4h trend (4h EMA13)' });
      if (t.lost) S.gates.push('1h trend lost: next support per the ladder is 15m EMA200 ≈ 4h trend (4h EMA13)');
      if (!above4hTrend) S.gates.push('Context: price is not above the 4h trend (4h EMA13/21)');
      if (!t.valid) S.gates.push('1h trend not respected (chopped) on this TF');
      if (t.taps >= 3) S.gates.push(`1h trend worn: ${t.taps} taps (spec: 1st-2nd tap only)`);
      if (['tight', 'apex', 'wide'].includes(H.comp.state)) S.gates.push('Inside a 1h compression: don\'t bid 1h EMA13 retests (C1-L07)');
      if (H.stoch.reset || H.stoch.curlUp) S.confluence.push('1h stoch RSI reset/curling');
      S.status = t.inBand ? 'active' : (t.distBand > 0 && t.distBand <= 2.5 ? 'forming' : 'far');
      out.push(S);
    })();
    // --- A2: 4h trend continuation (+15m compression timing) ---
    (() => {
      const H4 = T['4h']; if (!H4 || H4.insufficient) return; const t = H4.trend; if (t.dir !== 'up') return;
      const e13 = L(T, '4h', 'e13'), e21 = L(T, '4h', 'e21'), e30 = L(T, '4h', 'e30'), a = H4.ATR;
      const S = mkSetup({ id: 'A2', family: 'Trend continuation', name: '4h trend continuation', tf: '4h', dir: 'long', entry: [e21, e13], entryText: 'Bids across 4h EMA13-21 (advanced: 15m EMA200 once the 15m banana is tight)',
        stop: e30 - 0.2 * a, stopText: 'Below 4h EMA25-30 (4h EMA30 − 0.2 ATR); cut on a slow bleed under 15m EMA200', why: [`4h structure ${H4.structure.hhhlText || 'n/a'}, 4h trend ${t.lost ? 'lost' : 'up, ' + t.taps + ' tap(s)'}`], nextIfLost: 'If the 4h trend is lost: 1h EMA200 ≈ daily trend (daily EMA13 the safest)' });
      if (t.lost) S.gates.push('4h trend lost: next support per the ladder is 1h EMA200 ≈ daily trend');
      if (H4.structure.label === 'bear') S.gates.push('4h structure is bearish (LH/LL)');
      if (!t.valid) S.gates.push('4h trend not respected (chopped)');
      if (t.taps >= 3) S.gates.push(`4h trend worn: ${t.taps} taps (expect a deeper mean reversion)`);
      if (H4.stoch.reset || H4.stoch.curlUp) S.confluence.push('4h stoch RSI reset'); else S.warnings.push('4h stoch RSI not reset yet');
      if (H4.rsiNow > 50) S.confluence.push(`4h RSI ${H4.rsiNow.toFixed(0)} > 50`); else S.warnings.push(`4h RSI ${isNum(H4.rsiNow) ? H4.rsiNow.toFixed(0) : 'n/a'} ≤ 50`);
      if (price > L(T, '1d', 'm100') || price > L(T, '1d', 'e200')) S.confluence.push('Macro uptrend: above daily MA100 / EMA200');
      const m100_1h = L(T, '1h', 'm100'); if (T['1h'] && isNum(m100_1h) && Math.abs(price - m100_1h) <= 0.5 * T['1h'].ATR) S.confluence.push('Timing: 1h MA100 has caught up with price (C4-L12)');
      if (T['15m'] && !T['15m'].insufficient) { const cs = T['15m'].comp.state; if (['tight', 'apex'].includes(cs)) S.confluence.push(`Timing: 15m compression is ${cs}`); S.m15 = cs; }
      S.status = t.inBand ? 'active' : (t.distBand > 0 && t.distBand <= 2.5 ? 'forming' : 'far');
      out.push(S);
    })();
    // --- A3: 15m EMA200 bid when the 1h trend is lost in a strong uptrend (needs 15m) ---
    (() => {
      const H = T['1h'], H4 = T['4h'], M = T['15m']; if (!H || H.insufficient || !H4 || H4.insufficient) return;
      const ctxUp = H4.trend.dir === 'up' && H4.trend.valid && tfBias(T['1d']).label !== 'bearish';
      const lost1h = H.trend.dir === 'up' ? H.trend.lost : H.trend.barsSinceStart <= 6;
      if (!ctxUp || !lost1h) return;
      const S = mkSetup({ id: 'A3', family: 'Trend continuation', name: '15m EMA200 bid (1h trend lost)', tf: '15m', dir: 'long', why: ['4h uptrend intact, the 1h trend was just lost'], nextIfLost: 'If 15m EMA200 fails: 1h EMA200 ≈ daily trend' });
      if (!M || M.insufficient) { S.needs15m = true; S.status = 'forming'; S.entryText = 'Load the 15m chart to place the bid at 15m EMA200'; out.push(S); return; }
      const e200 = L(T, '15m', 'e200'), cp = M.comp; const tight = ['tight', 'apex'].includes(cp.state);
      const atr1h = H.ATR; const stopDist = Math.max(P.a3StopAtr1h * atr1h, e200 * P.a3StopMinPct / 100);
      if (tight) { S.entry = [cp.bottom, e200]; S.entryText = `Bid the 15m EMA200 → 15m ${cp.bottomName} zone (15m compression tight)`; S.stop = cp.bottom - 0.2 * M.ATR; S.stopText = `Below 15m ${cp.bottomName} (the compression bottom)`; }
      else { S.entry = [e200 - 0.3 * M.ATR, e200 + 0.2 * M.ATR]; S.entryText = 'Bid 15m EMA200 (15m MAs spread)'; S.stop = e200 - stopDist; S.stopText = `Below 15m EMA200, volatility-sized (1.0 × 1h ATR, min ${P.a3StopMinPct}%)`; }
      S.tpText = 'Back to the highs / HTF resistance; secure 70-80% there, trail a 20-30% runner';
      S.status = near(price, S.entry[0], S.entry[1], 0.3 * M.ATR) ? 'active' : price > S.entry[1] ? 'forming' : 'far';
      out.push(S);
    })();
    // --- A4: daily-trend buy ---
    (() => {
      const D = T['1d']; if (!D || D.insufficient) return; const t = D.trend; if (t.dir !== 'up') return;
      const S = mkSetup({ id: 'A4', family: 'Trend continuation', name: 'Daily-trend buy', tf: '1d', dir: 'long', entry: [L(T, '1d', 'e21'), L(T, '1d', 'e13')], entryText: 'Daily EMA13, extra bids at daily EMA21 ("lucky entries")',
        stop: L(T, '1d', 'e25') - 0.2 * D.ATR, stopText: 'Below the daily trend (daily EMA25 − 0.2 ATR)', why: [t.lost ? 'Daily trend lost' : `Daily trend up, ${t.taps} tap(s)`], nextIfLost: 'If the daily trend is lost: 4h EMA200' });
      if (t.lost) S.gates.push('Daily trend lost: next support per the ladder is 4h EMA200');
      if (!t.valid) S.gates.push('Daily trend not respected (chopped)');
      if (t.taps >= 4) S.warnings.push(`Daily trend tapped ${t.taps} times`);
      S.status = t.inBand ? 'active' : (t.distBand > 0 && t.distBand <= 1.5 ? 'forming' : 'far');
      out.push(S);
    })();
    // --- compression setups on each TF ---
    for (const tf of ['15m', '1h', '4h', '12h', '1d']) {
      const A = T[tf]; if (!A || A.insufficient || !A.comp.available) continue; const cp = A.comp; const lbl = TF_LABEL[tf]; const a = A.ATR;
      const bias = compressionDirection(T, tf);
      // B1 long the tight compression
      if (['tight', 'apex'].includes(cp.state) && cp.validBanana) {
        const S = mkSetup({ id: 'B1', family: 'Compression', name: `Long the tight ${lbl} compression`, tf, dir: 'long', entry: [cp.bottom, cp.mid], entryText: `Bids from ${lbl} EMA200 down to ${lbl} ${cp.bottomName} (the compression bottom)`,
          stop: cp.bottom - P.stopBufAtr * a, stopText: `Below ${lbl} ${cp.bottomName} (compression bottom − ${P.stopBufAtr} ATR)`, why: [`${lbl} MAs ${cp.state} (spread at the ${cp.pct.toFixed(0)}th percentile)`, `Direction clues: ${bias.text}`], nextIfLost: `A close below ${lbl} ${cp.bottomName} + a bleed = invalid` });
        if (!cp.qualityOk) S.gates.push(`Low-quality banana: ${qualityText(cp)}`);
        if (bias.dir !== 'up') S.gates.push(`Direction not bullish (${bias.text})`);
        if (!(A.close > cp.mid)) S.gates.push(`Price is not above ${lbl} EMA200`);
        if (cp.midSlope === 'down') S.gates.push(`${lbl} EMA200 still descending (needs flat or rising, C4-L12)`);
        if (tf === '15m' && T['1d'] && T['1d'].regime !== 'trend_up') S.warnings.push('15m compression: must sit at daily support when the daily is choppy');
        if (A.stoch.curlUp) S.confluence.push(`${lbl} stoch RSI curling up`);
        if (A.squeeze.bbSqueeze) S.confluence.push('[Outside Krillin] Bollinger squeeze');
        if (A.squeeze.ttm) S.confluence.push('[Outside Krillin] TTM squeeze on');
        S.status = near(price, cp.bottom, cp.mid, 0.3 * a) ? 'active' : price > cp.mid ? 'forming' : 'far';
        out.push(S);
      }
      // W1 watch: a good banana still building (ping-pong phase), bullish direction -> "becoming" B1 (C2-L07: wait for tight)
      if (['1h', '4h', '12h', '1d'].includes(tf) && cp.state === 'wide' && cp.validBanana && cp.qualityOk && bias.dir === 'up' && isNum(cp.pct) && cp.pct <= 40) {
        out.push(mkSetup({ id: 'W1', family: 'Compression', name: `${lbl} compression building`, tf, dir: 'long', status: 'watch', watch: true, watchZone: [cp.bottom, cp.mid],
          entryText: `Wait for the ${lbl} MAs to get tight (spread now at the ${cp.pct.toFixed(0)}th percentile; tight = 20th or lower), then bid ${lbl} EMA200 down to ${lbl} ${cp.bottomName}. Meanwhile it ping-pongs between ${lbl} MA100 and MA300.`,
          why: [`Good ${lbl} banana forming (${cp.disp.toFixed(1)} ATR since the last cross)`, `Direction clues: ${bias.text}`] }));
      }
      // B2 breakout-and-retest (1h default; also 4h)
      if (['1h', '4h'].includes(tf) && cp.resDir === 'up' && cp.resBar >= 0 && A.i - cp.resBar <= 40) {
        const retestZone = cp.breakStrong ? [Math.min(cp.top, L(T, tf, 'm100')) - 0.2 * a, cp.top + 0.3 * a] : [cp.mid - 0.2 * a, cp.top + 0.3 * a];
        const S = mkSetup({ id: 'B2', family: 'Compression', name: `${lbl} compression breakout-retest`, tf, dir: 'long', entry: retestZone,
          entryText: cp.breakStrong ? `Strong breakout: buy the retest of the compression top / a flat ${lbl} MA100` : `Weak breakout: bid as low as ${lbl} EMA200`,
          stop: cp.bottom - P.stopBufAtr * a, stopText: `Below the compression bottom (${lbl} ${cp.bottomName} − ${P.stopBufAtr} ATR)`, why: [`${lbl} compression broke up ${A.i - cp.resBar} bar(s) ago (${cp.breakStrong ? 'strong' : 'weak'} break, ${isNum(cp.breakRangeX) ? cp.breakRangeX.toFixed(1) : '?'}× the average candle)`],
          targetsHint: tf === '1h' ? [['4h', 'e200', '4h EMA200'], ['4h', 'm300', '4h MA300']] : [['1d', 'm100', 'Daily MA100'], ['1d', 'e200', 'Daily EMA200']] });
        if (tf === '1h' && T['15m']) S.warnings.push('While a 1h compression is active, ignore the 15m');
        S.status = near(price, retestZone[0], retestZone[1], 0.1 * a) ? 'active' : price > retestZone[1] ? 'forming' : 'far';
        if (price < cp.bottom) { S.gates.push('Price fell back below the compression: failed breakout'); S.status = 'far'; }
        out.push(S);
      }
      // B3 MA-cluster retest
      if (cp.state === 'cluster' && cp.clusterDir === 'up') {
        const S = mkSetup({ id: 'B3', family: 'Compression', name: `${lbl} MA-cluster retest`, tf, dir: 'long', entry: [cp.mid - 0.25 * a, cp.mid + 0.25 * a], entryText: `Bid ${lbl} EMA200 (the cluster)`,
          stop: L(T, tf, 'm300') - P.stopBufAtr * a, stopText: `Below ${lbl} MA300`, why: [`${lbl} MAs tight, parallel and all rising after a breakout`], targetsHint: [['swing', 'high', 'Previous high']] });
        S.status = near(price, S.entry[0], S.entry[1], 0.2 * a) ? 'active' : price > S.entry[1] ? 'forming' : 'far';
        out.push(S);
      }
      // B4 early EMA200 bid (4h, 1h): MA100 lost for the first time after an expansion
      if (['1h', '4h'].includes(tf) && cp.state === 'rounding' && cp.roundingDir === 'bull') {
        const up = TF_UP[tf]; const strong = T[up] && T[up].trend && T[up].trend.dir === 'up';
        const e200 = L(T, tf, 'e200'), m100 = L(T, tf, 'm100');
        const S = mkSetup({ id: 'B4', family: 'Compression', name: `Early ${lbl} EMA200 bid (MA100 lost)`, tf, dir: 'long', entry: [e200 - 0.3 * a, e200 + 0.2 * a], entryText: `Bid ${lbl} EMA200 with a wide stop`,
          stop: e200 - 1.2 * a, stopText: `Wide: below ${lbl} EMA200 − 1.2 ATR (and below the nearest horizontal/OB)`, why: [`${lbl} MA100 lost for the first time after an expansion ("wait for EMA200")`], tp1: { price: m100, label: `${lbl} MA100 (partial: EMA200 bounce → sell MA100)` }, nextIfLost: `Poor reaction on the second ${lbl} EMA200 test → bid ${lbl} MA300` });
        if (!strong) S.gates.push(`Needs a strong uptrend (${TF_LABEL[up]} trend not up)`);
        S.status = near(price, S.entry[0], S.entry[1], 0.2 * a) ? 'active' : price > S.entry[1] ? 'forming' : 'far';
        out.push(S);
      }
      // B7 bearish compression short: MA300 lost and retested from below, or resolved down
      const bearCtx = (cp.state === 'invalid') || (cp.resDir === 'down' && cp.resBar >= 0 && A.i - cp.resBar <= 40) || (cp.state === 'cluster' && cp.clusterDir === 'down');
      if (['1h', '4h', '12h', '1d'].includes(tf) && bearCtx && A.close < cp.mid) {
        const S = mkSetup({ id: 'B7', family: 'Compression', name: `Bearish ${lbl} compression short`, tf, dir: 'short', entry: [cp.bottom, Math.max(cp.mid, cp.bottom)], entryText: `Asks at the ${lbl} EMA200 / compression retest from below`,
          stop: cp.top + P.stopBufAtr * a, stopText: `Above the compression top (${lbl} ${cp.topName} + ${P.stopBufAtr} ATR)`, why: [cp.state === 'invalid' ? `${lbl} MA300 lost (continuation compression invalidated)` : `${lbl} compression resolved down`], tpText: 'Next support below; take profits aggressively (shorts shrink)' });
        S.status = near(price, S.entry[0], S.entry[1], 0.2 * a) ? 'active' : price < S.entry[0] ? 'forming' : 'far';
        out.push(S);
      }
    }
    // --- C1: first retest of an ascending MA100 (4h, daily) ---
    for (const tf of ['4h', '1d']) {
      const A = T[tf]; if (!A || A.insufficient || !isNum(L(T, tf, 'm100'))) continue; const lbl = TF_LABEL[tf];
      if (A.cls.m100 !== 'up' || A.structure.label !== 'bull' || A.close < L(T, tf, 'm100')) continue;
      // first touch since MA100 started ascending
      let startUp = A.i; for (let k = A.i; k > 20; k--) { const s = slopeOf(A.m100, A.atr, k, P.slopeKLong); if (!(s > P.flatLong)) { startUp = k + 1; break; } }
      let touches = 0; for (let k = startUp; k <= A.i; k++) if (A.l[k] <= A.m100[k] + 0.2 * A.atr[k]) { touches++; while (k <= A.i && A.l[k] <= A.m100[k] + 0.5 * A.atr[k]) k++; }
      const m100 = L(T, tf, 'm100'), a = A.ATR;
      const S = mkSetup({ id: 'C1', family: 'MA levels', name: `First retest of the rising ${lbl} MA100`, tf, dir: 'long', entry: [m100 - 0.2 * a, m100 + 0.3 * a], entryText: `Bid ${lbl} MA100 (first touch only)`,
        stop: m100 - 0.8 * a, stopText: `Below ${lbl} MA100 − 0.8 ATR`, why: [`${lbl} MA100 rising in a bullish structure; ${touches} touch(es) since it turned up`] });
      if (touches >= 2 || (touches === 1 && !(A.l[A.i] <= m100 + 0.3 * a))) S.gates.push('Not the first retest (the 2nd is weak, the 3rd "usually shit")');
      S.status = near(price, S.entry[0], S.entry[1], 0.2 * a) ? 'active' : (price - m100) / a <= 3 ? 'forming' : 'far';
      out.push(S);
    }
    // --- C2: gap fill (MA100 break toward EMA200 of the same TF) ---
    for (const tf of ['1h', '4h', '1d']) {
      const A = T[tf]; if (!A || A.insufficient || !isNum(L(T, tf, 'e200'))) continue; const lbl = TF_LABEL[tf];
      const m100 = L(T, tf, 'm100'), e200 = L(T, tf, 'e200'), a = A.ATR;
      if (A.cls.m100 !== 'flat') continue; // MA100 must be flattening (C4-L10: break MA100 -> EMA200 as MA100 flattens)
      let crossedUp = -1; for (let k = A.i; k >= A.i - 5; k--) if (A.c[k] > A.m100[k] && A.c[k - 1] <= A.m100[k - 1]) { crossedUp = k; break; }
      if (crossedUp < 0 || !(e200 > price) || A.comp.state === 'tight' || A.comp.state === 'apex') continue;
      const S = mkSetup({ id: 'C2', family: 'MA levels', name: `${lbl} gap fill: MA100 → EMA200`, tf, dir: 'long', entry: [m100 - 0.2 * a, m100 + 0.3 * a], entryText: `Buy the break / retest of ${lbl} MA100`,
        stop: m100 - 0.6 * a, stopText: `Back below ${lbl} MA100 (− 0.6 ATR)`, why: [`${lbl} MA100 is ${A.cls.m100} and just got broken; ${lbl} EMA200 is the gap-fill target`], tp1: { price: e200 - P.tpFrontAtr * a, label: `${lbl} EMA200 (front-run; the full gap fill)` }, tpText: 'Stop chasing once filled' });
      S.status = near(price, S.entry[0], S.entry[1], 0.2 * a) ? 'active' : 'forming';
      out.push(S);
    }
    // --- C3: 4h EMA200 retest long ---
    (() => {
      const A = T['4h']; if (!A || A.insufficient || !isNum(L(T, '4h', 'e200'))) return; const e200 = L(T, '4h', 'e200'), a = A.ATR;
      if (A.close < e200 - 0.3 * a || A.cls.e200 === 'down' || A.structure.label === 'bear') return;
      if ((A.close - e200) / a > 3) return;
      const below = lv.levels.filter(x => x.type === 'horizontal' && x.hi < e200).sort((x, y) => y.hi - x.hi)[0];
      const stop = below && (e200 - below.lo) / a < 3 ? below.lo - 0.2 * a : e200 - 1.0 * a;
      const S = mkSetup({ id: 'C3', family: 'MA levels', name: '4h EMA200 retest', tf: '4h', dir: 'long', entry: [e200 - 0.3 * a, e200 + 0.3 * a], entryText: 'Bid the 4h EMA200 retest', stop, stopText: below && (e200 - below.lo) / a < 3 ? 'Below the nearby horizontal that flipped S/R' : 'Below 4h EMA200 − 1 ATR',
        why: [`4h EMA200 ${A.cls.e200}; price ${((A.close - e200) / a).toFixed(1)} ATR above it`] });
      if (A.cls.m100 === 'down') S.tp1 = { price: L(T, '4h', 'm100') - P.tpFrontAtr * a, label: '4h MA100 curling down: de-risk there' };
      S.status = near(price, S.entry[0], S.entry[1], 0.1 * a) ? 'active' : 'forming';
      out.push(S);
    })();
    // --- C4: bearish 4h EMA200 retest short ---
    (() => {
      const A = T['4h']; if (!A || A.insufficient || !isNum(L(T, '4h', 'e200'))) return; const e200 = L(T, '4h', 'e200'), a = A.ATR, i = A.i;
      if (!(A.slope.e200 < -2 * P.flatLong) || A.close > e200) return;
      let lo = Infinity, loK = i; for (let k = i - 10; k <= i; k++) if (A.l[k] < lo) { lo = A.l[k]; loK = k; }
      const impulse = (Math.max(...A.h.slice(loK, i + 1)) - lo) / a; const gapAtStart = (A.e200[loK] - A.e13[loK]) / a;
      const wickTouch = Math.max(A.h[i], A.h[i - 1]) >= e200 - 0.3 * a;
      if (!(impulse >= 3 && gapAtStart >= 2)) return;
      const S = mkSetup({ id: 'C4', family: 'MA levels', name: 'Bearish 4h EMA200 retest (short)', tf: '4h', dir: 'short', entry: [e200 - 0.2 * a, e200 + 0.3 * a], entryText: 'Asks at 4h EMA200', stop: Math.max(A.h[i], A.h[i - 1], e200) + 0.5 * a, stopText: 'Above the rejection wick (+0.5 ATR)',
        why: [`4h EMA200 descending; impulse into it ${impulse.toFixed(1)} ATR from a ${gapAtStart.toFixed(1)} ATR EMA13→EMA200 gap`], tp1: { price: L(T, '4h', 'e13'), label: 'Back to 4h EMA13' }, tpText: 'Stop shorting once 4h EMA13 flattens' });
      let hover = 0; for (let k = i - 5; k <= i; k++) if (A.c[k] < A.e200[k] && A.c[k] > A.e200[k] - 1 * A.atr[k]) hover++;
      if (hover >= 6) S.gates.push('Consolidating just under 4h EMA200: assume bullish, no short');
      if (A.cls.e13 === 'up' && A.cls.m100 === 'flat') S.gates.push('Weak resistance: 4h EMA13 rising and 4h MA100 flat');
      S.status = wickTouch ? 'active' : 'forming';
      out.push(S);
    })();
    // --- C6: EMA200 sweep and reclaim (1h, 4h, 12h) ---
    for (const tf of ['1h', '4h', '12h']) {
      const A = T[tf]; if (!A || A.insufficient || !isNum(L(T, tf, 'e200'))) continue; const i = A.i; if (i < 2) continue; // A.i is already the last CLOSED bar (closedOnly); was A.i - 1 before closedOnly existed
      const e200 = A.e200[i], a = A.atr[i]; const lbl = TF_LABEL[tf];
      if (A.l[i] < e200 - 0.2 * a && A.c[i] > e200 && A.c[i - 1] >= A.e200[i - 1] - 0.5 * a) {
        const S = mkSetup({ id: 'C6', family: 'MA levels', name: `${lbl} EMA200 sweep and reclaim`, tf, dir: 'long', entry: [e200, A.c[i]], entryText: `Wick swept ${lbl} EMA200 and closed back above: enter`, stop: A.l[i] - 0.2 * a, stopText: 'Below the sweep wick', why: [`${lbl} candle wicked below EMA200 and closed back above`], status: 'active' });
        if (isNum(A.m100[i]) && A.m100[i] > A.c[i]) S.tp1 = { price: A.m100[i], label: `${lbl} MA100` };
        out.push(S);
      }
    }
    // --- D1: range extremes (range regime only) ---
    for (const tf of ['4h', '1d']) {
      const A = T[tf]; if (!A || A.insufficient || !A.range || !A.range.isRange || !['range', 'chop'].includes(A.regime)) continue; const r = A.range; const lbl = TF_LABEL[tf];
      if (r.pos <= 0.2) out.push(mkSetup({ id: 'D1', family: 'Range', name: `${lbl} range low`, tf, dir: 'long', entry: [r.lo - 0.15 * r.width, r.lo + 0.05 * r.width], entryText: 'Layer bids from the range low into the deviation zone (15-20% of the width below)', stop: r.lo - 0.2 * r.width - 0.2 * A.ATR, stopText: 'Beyond the deviation zone (range low − 20% of the width)', tp1: { price: r.mid, label: 'Range mid' }, why: [`${lbl} range ${r.widthPct.toFixed(0)}% wide; price in the bottom ${Math.round(r.pos * 100)}%`], status: r.pos <= 0.08 ? 'active' : 'forming' }));
      if (r.pos >= 0.8) { const S = mkSetup({ id: 'D1', family: 'Range', name: `${lbl} range high`, tf, dir: 'short', entry: [r.hi - 0.05 * r.width, r.hi + 0.15 * r.width], entryText: 'Layer asks from the range high into the deviation zone (15-20% above)', stop: r.hi + 0.2 * r.width + 0.2 * A.ATR, stopText: 'Beyond the deviation zone (range high + 20% of the width)', tp1: { price: r.mid, label: 'Range mid' }, why: [`${lbl} range ${r.widthPct.toFixed(0)}% wide; price in the top ${Math.round((1 - r.pos) * 100)}%`], status: r.pos >= 0.92 ? 'active' : 'forming' }); if (T['4h'] && !T['4h'].insufficient && T['4h'].trend.dir === 'up' && T['4h'].trend.valid) S.gates.push('No range-high shorts while the 4h trend is ascending'); out.push(S); }
    }
    // --- [ADD-ON] trend-line (diagonal) setups: D4 breakout-retest long, D5 breakdown-retest short, W2 compression under a trend line ---
    const diagOn = !ctx || ctx.diag !== false;
    if (diagOn) for (const tf of ['1h', '4h', '12h', '1d']) {
      const A = T[tf]; if (!A || A.insufficient || !A.diag) continue; const a = A.ATR, lbl = TF_LABEL[tf]; const cp = A.comp || {};
      const r = A.diag.res, sp = A.diag.sup;
      if (r && r.state !== 'intact' && r.barsSince <= P.diagBrokenBars && (price - r.next) / a <= P.diagNearAtr && (price - r.next) / a >= -1.5) { // only while price is still near the line
        const v = r.next; const withComp = cp.available && cp.resDir === 'up' && cp.resBar >= 0 && Math.abs(cp.resBar - r.brk) <= P.diagCompBars;
        const deepest = Math.min(r.extreme, v); const stop = Math.min(v - 1.0 * a, deepest - 0.2 * a);
        const S = mkSetup({ id: 'D4', family: 'Trend lines', name: `${lbl} trend-line breakout retest`, tf, dir: 'long', entry: [v - 0.25 * a, v + 0.25 * a], diag: r, withComp,
          entryText: `Bid the retest of the broken ${lbl} descending trend line (it moves each candle). Expect a nasty second retest of the diagonal (C2-L15)${r.retests ? `; ${r.retests} retest(s) so far` : ''}`,
          stop, stopText: `Wide: below the trend line − 1 ATR${deepest - 0.2 * a < v - 1.0 * a ? ' and below the retest low' : ''}`,
          why: [`${lbl} descending trend line (${r.touches} touches over ${r.span} bars) broken ${r.barsSince} bar(s) ago${r.breakStrong ? ' by a strong candle' : ''}`], targetsHint: [['swing', 'high', 'Previous swing high']], nextIfLost: `A close back below the ${lbl} trend line = failed breakout: step aside` });
        if (withComp) S.confluence.push(`Broke out together with the ${lbl} compression (a stronger breakout, C2-L15)`); else S.warnings.push(`No ${lbl} compression breakout with it: the compression is the stronger signal (C2-L15)`);
        if (r.state === 'failed') S.gates.push(`Failed breakout: closed back below the ${lbl} trend line`);
        if (r.touches < 3) S.warnings.push('Only 2 touches: a weaker trend line');
        if (A.range && A.range.isRange && A.range.pos > 0.3 && A.range.pos < 0.7) S.warnings.push('Mid-range: Krillin trades the range extremes, not the middle, even near a diagonal breakout (C2-L18)');
        out.push(S);
      }
      if (sp && sp.state !== 'intact' && sp.barsSince <= P.diagBrokenBars && (sp.next - price) / a <= P.diagNearAtr && (sp.next - price) / a >= -1.5) {
        const v = sp.next; const withComp = cp.available && cp.resDir === 'down' && cp.resBar >= 0 && Math.abs(cp.resBar - sp.brk) <= P.diagCompBars;
        const highest = Math.max(sp.extreme, v); const stop = Math.max(v + 1.0 * a, highest + 0.2 * a);
        const S = mkSetup({ id: 'D5', family: 'Trend lines', name: `${lbl} trend-line breakdown retest (short)`, tf, dir: 'short', entry: [v - 0.25 * a, v + 0.25 * a], diag: sp, withComp,
          entryText: `Asks at the retest of the broken ${lbl} ascending trend line from below (it moves each candle)`, stop, stopText: `Wide: above the trend line + 1 ATR${highest + 0.2 * a > v + 1.0 * a ? ' and above the retest high' : ''}`,
          why: [`${lbl} ascending trend line (${sp.touches} touches over ${sp.span} bars) broken ${sp.barsSince} bar(s) ago${sp.breakStrong ? ' by a strong candle' : ''}`], tpText: 'Next support below; take profits aggressively (shorts shrink)', nextIfLost: `A close back above the ${lbl} trend line = failed breakdown` });
        if (withComp) S.confluence.push(`Broke down together with the ${lbl} compression`); 
        if (sp.state === 'failed') S.gates.push(`Failed breakdown: closed back above the ${lbl} trend line`);
        if (sp.touches < 3) S.warnings.push('Only 2 touches: a weaker trend line');
        out.push(S);
      }
      if (r && r.state === 'intact' && cp.available && ['tight', 'apex'].includes(cp.state) && cp.validBanana && r.next > A.close && (r.next - A.close) / a <= 1.5) {
        out.push(mkSetup({ id: 'W2', family: 'Trend lines', name: `${lbl} compression under a trend line`, tf, dir: 'long', status: 'watch', watch: true, watchZone: [r.next, r.next + 0.5 * a], diag: r,
          entryText: `Wait for a close above the ${lbl} descending trend line and the compression together, then buy the retest. Don't buy "almost breaking the diagonal" (C2-L18)`, why: [`${lbl} MAs ${cp.state} just under a ${r.touches}-touch descending trend line: a break of both = a strong breakout (C2-L15)`] }));
      }
    }
    // generic status from the live price vs the entry zone and stop, then global gates and warnings (§8)
    for (const S of out) {
      if (S.entry && isNum(S.entry[0]) && isNum(S.entry[1]) && isNum(S.stop) && T[S.tf] && !T[S.tf].insufficient) S.status = statusFor(S, price, T[S.tf].ATR);
      if (diagOn && S.entry && isNum(S.entry[0]) && T[S.tf] && !T[S.tf].insufficient && !['D4', 'D5'].includes(S.id)) { // [ADD-ON] a trend line at the entry zone = confluence
        const za = T[S.tf].ATR * 0.3, zlo = Math.min(S.entry[0], S.entry[1]) - za, zhi = Math.max(S.entry[0], S.entry[1]) + za;
        const dl = lv.levels.find((x) => x.type === 'diagonal' && x.role === (S.dir === 'long' ? 'sup' : 'res') && x.hi >= zlo && x.lo <= zhi); if (dl) S.confluence.push(`[Add-on] ${dl.name} at the entry zone`);
      }
      applyGates(S, T, lv, ctx);
    }
    return out;
  }
  // active = a bid/ask in the zone would fill now; forming = within 2 ATR of the zone; far = further; invalidated = beyond the stop
  function statusFor(S, price, a) {
    const lo = Math.min(S.entry[0], S.entry[1]), hi = Math.max(S.entry[0], S.entry[1]);
    if (S.dir === 'long') { if (price < S.stop) return 'invalidated'; if (price >= lo - 0.1 * a && price <= hi + 0.1 * a) return 'active'; if (price > hi) return (price - hi) <= 2 * a ? 'forming' : 'far'; return 'active'; }
    if (price > S.stop) return 'invalidated'; if (price >= lo - 0.1 * a && price <= hi + 0.1 * a) return 'active'; if (price < lo) return (lo - price) <= 2 * a ? 'forming' : 'far'; return 'active';
  }

  function qualityText(cp) { const q = []; if (!cp.quality.dispOk) q.push(isNum(cp.disp) ? `only ${cp.disp.toFixed(1)} ATR between the last MA100/EMA200 cross and now` : 'no MA100/EMA200 cross in the loaded history (banana origin unknown)'); if (!cp.quality.notInRange) q.push('banana inside a range'); if (!cp.quality.notChopFlat) q.push(`${cp.maCrosses150} MA crosses in 150 bars (flat because of chop)`); return q.join('; ') || 'ok'; }

  function compressionDirection(T, tf) { // §4.4 clues
    const A = T[tf], up = TF_UP[tf]; const cp = A.comp; let s = 0; const why = [];
    const b = tfBias(T[up] || T['1d']); if (b.label === 'bullish') { s += 2; why.push(`${TF_LABEL[up] || 'HTF'} bias bullish`); } else if (b.label === 'bearish') { s -= 2; why.push(`${TF_LABEL[up] || 'HTF'} bias bearish`); }
    if (cp.midSlope === 'up') { s += 1; why.push('EMA200 rising'); } if (cp.midSlope === 'down') { s -= 1; why.push('EMA200 falling'); }
    if (A.cls.m100 === 'up' && cp.midSlope === 'flat') { s += 1; why.push('MA100 up, EMA200 flattening'); }
    if (A.close > cp.mid) { s += 1; why.push('price above EMA200'); } else { s -= 1; why.push('price below EMA200'); }
    if (cp.order === 'bullRev' || cp.order === 'bullRevWrong') { const e13 = A.cls.e13; if (e13 === 'up') { s += 1; why.push('EMA13 rising (reversal)'); } if (e13 === 'down') { s -= 1; why.push('EMA13 falling (continuation down)'); } if (cp.order === 'bullRevWrong') { s -= 1; why.push('wrong order: EMA200 below MA200'); } }
    return { dir: s >= 2 ? 'up' : s <= -2 ? 'down' : 'unclear', score: s, text: why.join(', ') };
  }

  function applyGates(S, T, lv, ctx) {
    const price = lv.price; const tf = S.tf; const up = TF_UP[tf];
    if (S.dir === 'long') {
      // 1. HTF prevails: a descending MA of TF+1 just overhead
      const eHi = S.entry ? Math.max(S.entry[0], S.entry[1]) : price; const reach = S.entry && isNum(S.stop) ? eHi + 2 * (eHi - S.stop) : price * 1.06;
      if (up && T[up] && !T[up].insufficient) { for (const k of ['m100', 'e200', 'm300']) { const v = L(T, up, k); if (isNum(v) && v > price && T[up].cls[k] === 'down' && v < reach) { S.gates.push(`HTF prevails: ${TF_LABEL[up]} ${k === 'e200' ? 'EMA200' : k === 'm100' ? 'MA100' : 'MA300'} descending just overhead`); break; } } }
      // 2. 4h long MAs spread and descending
      const H4 = T['4h']; if (H4 && !H4.insufficient && H4.comp.available && H4.comp.pct >= 50 && H4.cls.m100 === 'down' && H4.cls.e200 === 'down' && H4.cls.m300 === 'down') S.gates.push('4h long MAs spread and descending: no longs (C2-L16)');
      // 3. pre-pump
      const D = T['1d']; if (D && !D.insufficient && isNum(L(T, '1d', 'm100')) && D.cls.m100 === 'down' && D.close < L(T, '1d', 'm100')) { if (['B6', 'C2'].includes(S.id) && tf === '1d') S.gates.push('Pre-pump: daily MA100 descending with price below'); else S.warnings.push('Pre-pump context: daily MA100 descending above price (daily MAs = resistance)'); }
      // 7. battle of the trends
      if (S.family === 'Trend continuation' && up && T[tf] && T[up] && T[tf].trend && T[up].trend && T[tf].trend.dir === 'down' && T[up].trend.dir === 'up') S.gates.push(`Battle of the trends: ${TF_LABEL[tf]} trend down vs ${TF_LABEL[up]} trend up: wait`);
      // regime
      if (S.family === 'Trend continuation' && T[tf] && T[tf].regime && !['trend_up'].includes(T[tf].regime)) S.gates.push(`Regime on ${TF_LABEL[tf]} is ${T[tf].regime.replace('_', ' ')}`);
      if (D && D.regime === 'post_blowoff') S.gates.push('Post blow-off regime on the daily: expect weeks of chop (no EMA-system swings)');
      // 12. failed breakout + daily MA100 + maxed stoch
      if (S.id === 'A2' && D && !D.insufficient && D.stoch.maxed && D.structure.lastHigh) { const sw = D.structure.lastHigh.p; for (let k = D.i - 4; k <= D.i; k++) if (D.h[k] > sw && D.c[k] < sw) { S.gates.push('Failed breakout above the daily swing high with a maxed daily stoch RSI'); break; } }
      // warnings
      if (ctx && ctx.btcAtResistance && ctx.symbol !== 'BTC') S.warnings.push('BTC sits at HTF resistance: careful with alt longs');
      if (D && !D.insufficient && D.stoch.maxed) S.warnings.push('Daily stoch RSI maxed (stop-milking signal)');
      if (T[tf] && T[tf].momentum && T[tf].momentum.waning) S.warnings.push(`${TF_LABEL[tf]} highs shrinking: momentum waning`);
      if (D && !D.insufficient) { const lo7 = Math.min(...D.l.slice(-7)); const g = (price - lo7) / lo7 * 100; if (g >= P.profitTakePct) S.warnings.push(`+${g.toFixed(0)}% in 7 days: profit-taking zone, size down`); }
    } else {
      // shorts: don't short strength
      const H = T['1h'], H4 = T['4h']; if (S.id !== 'D1' && H && !H.insufficient && H4 && !H4.insufficient && H.trend.dir === 'up' && H.trend.valid && H4.trend.dir === 'up' && H4.trend.valid) S.gates.push('Don\'t short strength: 1h and 4h trends both up');
      if (T['1d'] && tfBias(T['1d']).label === 'bullish' && S.id !== 'D1') S.warnings.push('Daily bias is bullish: treat as a hedge / TP aggressively');
    }
  }

  // ---------- plan card (§9) ----------
  function buildPlan(S, T, lv, settings) {
    const st = Object.assign({ account: 10000, riskPct: P.riskPct, feePct: P.feePct, slipPct: P.slipPct }, settings || {});
    if (!S.entry || !isNum(S.entry[0]) || !isNum(S.entry[1]) || !isNum(S.stop)) return null;
    const long = S.dir === 'long'; const A = T[S.tf] || T['4h']; const a = A.ATR;
    let lo = Math.min(S.entry[0], S.entry[1]), hi = Math.max(S.entry[0], S.entry[1]);
    if (hi - lo < 0.1 * a) { lo -= 0.05 * a; hi += 0.05 * a; }
    // ladder: 10/20/30/40 from the first level to the deepest non-invalidating level (§9.3)
    const w = [0.1, 0.2, 0.3, 0.4]; const first = long ? hi : lo, deep = long ? lo : hi;
    const bids = w.map((wt, k) => ({ price: first + (deep - first) * (k / 3), weight: wt }));
    const avg = bids.reduce((s, b) => s + b.price * b.weight, 0);
    const R = long ? avg - S.stop : S.stop - avg; if (!(R > 0)) return { invalid: 'Stop is on the wrong side of the entry' };
    // targets from levels (front-run by 0.25 ATR), spec §9.5
    const cands = []; const px = lv.price;
    for (const x of lv.levels) { // targets/resistance only beyond BOTH the entry and the current price (levels price already broke are support now)
      const edge = long ? x.lo : x.hi; if (long ? !(edge > Math.max(avg + 0.3 * R, px)) : !(edge < Math.min(avg - 0.3 * R, px))) continue;
      if (x.type === 'ma' && ((long && x.slope === 'up') || (!long && x.slope === 'down'))) continue; // rising MAs above = weak resistance; falling MAs below = weak support
      if (x.type === 'fvg' && long && x.dir !== 'bear') continue; if (x.type === 'fvg' && !long && x.dir !== 'bull') continue;
      if (long && x.type === 'ob_breakout') continue; if (!long && (x.type === 'ob_breakdown' || x.type === 'last_support')) continue;
      if (x.type === 'diagonal' && x.role !== (long ? 'res' : 'sup')) continue; // [ADD-ON] only trend lines acting as resistance (longs) / support (shorts)
      cands.push({ price: long ? edge - P.tpFrontAtr * a : edge + P.tpFrontAtr * a, edge, label: x.type === 'diagonal' ? x.name + ' (moves each candle)' : x.name, type: x.type, score: x.score, tf: x.tf, touches: x.touches });
    }
    if (S.targetsHint) for (const [tf, k, name] of S.targetsHint) { let v = NaN; if (tf === 'swing') { const s = A.structure; v = long ? (s.lastHigh ? s.lastHigh.p : NaN) : (s.lastLow ? s.lastLow.p : NaN); } else v = L(T, tf, k); if (isNum(v) && (long ? v > Math.max(avg, px) : v < Math.min(avg, px))) cands.push({ price: long ? v - P.tpFrontAtr * a : v + P.tpFrontAtr * a, edge: v, label: name + ' (setup target)', type: 'hint', score: 8 }); }
    if (S.tp1 && isNum(S.tp1.price) && (long ? S.tp1.price > avg : S.tp1.price < avg)) cands.push({ price: S.tp1.price, label: S.tp1.label, type: 'tp1', score: 10 });
    cands.sort((x, y) => long ? x.price - y.price : y.price - x.price);
    // de-duplicate targets closer than 0.5 ATR
    const tps = []; for (const cnd of cands) { const prev = tps[tps.length - 1]; if (prev && Math.abs(cnd.price - prev.price) < 0.5 * a) { if (cnd.score > prev.score) tps[tps.length - 1] = cnd; continue; } tps.push(cnd); }
    const withR = tps.map(t => Object.assign({}, t, { r: (long ? t.price - avg : avg - t.price) / R }));
    let ladder = withR.filter(t => t.r >= 0.8).slice(0, 3);
    if (ladder.length === 0) ladder = [{ price: long ? avg + 2 * R : avg - 2 * R, label: '2R (no mapped level)', r: 2 }, { price: long ? avg + 3 * R : avg - 3 * R, label: '3R (no mapped level)', r: 3 }];
    const sig = withR.filter(t => ['horizontal', 'ob_breakdown', 'last_support', 'ob_breakout', 'hint'].includes(t.type) || (t.type === 'ma' && !/^1h |4h EMA13/.test(t.label)) || (t.type === 'diagonal' && ['12h', '1d'].includes(t.tf) && t.touches >= 3));
    const nearestOpp = sig[0];
    const room = nearestOpp ? ((long ? (nearestOpp.edge || nearestOpp.price) - avg : avg - (nearestOpp.edge || nearestOpp.price)) / R) : Infinity;
    // fee-aware R and sizing (§9.6, §10)
    const feeFrac = (2 * st.feePct + st.slipPct) / 100;
    const netR = (t) => ((long ? t.price - avg : avg - t.price) - avg * feeFrac) / (R + avg * feeFrac);
    const stopPct = R / avg * 100; const risk$ = st.account * st.riskPct / 100;
    const size = risk$ / ((stopPct + 2 * st.feePct + st.slipPct) / 100);
    const tp1 = ladder[0]; const k = tp1.r; const derisk = 1 / (k + 1);
    const avgTP = ladder.length >= 2 ? (ladder[0].r * 0.3 + ladder[1].r * 0.4 + (ladder[2] ? ladder[2].r : ladder[1].r) * 0.3) : ladder[0].r;
    const rrFinal = ladder[ladder.length - 1].r;
    return {
      bids, avg, stop: S.stop, R, stopPct, tps: ladder, room, roomLabel: nearestOpp ? nearestOpp.label : 'none mapped',
      netRR: ladder.map(netR), avgTP, rrFinal, beWinRate: 1 / (1 + avgTP), size, risk$,
      derisk: { atR: k, fraction: derisk, text: `Sell ${Math.round(derisk * 100)}% at TP1 (+${k.toFixed(1)}R) → the rest is risk-free` },
      alert: long ? bids[0].price + 0.1 * a : bids[0].price - 0.1 * a,
      secondTouch: 'Comfortable with a second touch of the entry? Yes → ~30% at +1-1.5R and re-bid the entry. No → a small partial and a break-even stop.',
    };
  }

  // ---------- A+ grading (spec §9.11): Krillin's checklist as weighted items ----------
  function setupQuality(S, T, lv) {
    const A = T[S.tf]; const up = TF_UP[S.tf];
    switch (S.id) {
      case 'A1': case 'A2': case 'A4': { const tp = A.trend.taps; return { f: tp <= 1 ? 1 : tp === 2 ? 0.6 : 0, label: `Fresh ${TF_LABEL[S.tf]} trend (1st-2nd tap; now ${tp})` }; }
      case 'A3': { const m = T['15m']; const tight = m && !m.insufficient && ['tight', 'apex'].includes(m.comp.state); return { f: tight ? 1 : (T['4h'].trend.taps <= 2 ? 0.8 : 0.4), label: tight ? '15m compression tight at the bid' : 'Fresh 4h trend under the 1h pullback' }; }
      case 'B1': { const cp = A.comp; const f = (cp.qualityOk ? 0.7 : 0.2) + (cp.state === 'apex' ? 0.2 : 0) + (['bullCont', 'bullRev'].includes(cp.order) ? 0.1 : 0); return { f: Math.min(1, f), label: `Good ${TF_LABEL[S.tf]} banana, tight or at the apex` }; }
      case 'B2': return { f: A.comp.breakStrong ? 1 : 0.6, label: 'Strong breakout candle out of the compression' };
      case 'B3': return { f: 0.9, label: 'MA cluster tight, parallel and rising' };
      case 'B4': return { f: T[up] && T[up].trend && T[up].trend.valid ? 0.9 : 0.5, label: `Strong ${TF_LABEL[up] || ''} uptrend behind the MA100 loss` };
      case 'B7': return { f: 0.8, label: 'Bearish compression confirmed (MA300 lost / broke down)' };
      case 'C1': return { f: 1, label: 'First retest of a rising MA100' };
      case 'C2': { const m100 = L(T, S.tf, 'm100'), e200 = L(T, S.tf, 'e200'); const gap = lv.levels.some((x) => x.type === 'fvg' && x.dir === 'bear' && x.hi > Math.min(m100, e200) && x.lo < Math.max(m100, e200)); return { f: gap ? 1 : 0.7, label: 'Unfilled gap between MA100 and EMA200' }; }
      case 'C3': return { f: A.cls.e200 === 'up' ? 1 : 0.6, label: '4h EMA200 rising' };
      case 'C4': return { f: 0.9, label: 'Big impulse into a steep, descending 4h EMA200' };
      case 'C6': return { f: 0.8, label: 'Clean sweep and reclaim of EMA200' };
      case 'D1': { const r = A.range; return { f: r && r.widthPct >= 10 ? 0.9 : 0.6, label: 'Wide, clean range (10%+)' }; }
      case 'W1': return { f: A.comp.pct <= 30 ? 0.8 : 0.6, label: `Good ${TF_LABEL[S.tf]} banana getting tighter` };
      case 'D4': case 'D5': { const d = S.diag; const withC = S.withComp; return { f: Math.min(1, (d.touches >= 3 ? 0.6 : 0.4) + (withC ? 0.3 : 0) + (d.breakStrong ? 0.1 : 0)), label: `Clean ${TF_LABEL[S.tf]} trend line (3+ touches) broken together with a compression` }; }
      case 'W2': return { f: 0.6, label: `Tight ${TF_LABEL[S.tf]} compression under a clean trend line` };
      default: return { f: 0.5, label: 'Setup quality' };
    }
  }
  function gradeSetup(S, T, lv, g) {
    g = g || {}; const long = S.dir === 'long'; const A = T[S.tf] && !T[S.tf].insufficient ? T[S.tf] : (T['1h'] && !T['1h'].insufficient ? T['1h'] : T['4h']); const up = TF_UP[S.tf]; const lbl = TF_LABEL[S.tf]; const items = []; // A3 before the 15m is loaded: grade on the 1h
    const add = (key, label, w, frac) => { frac = Math.max(0, Math.min(1, isNum(frac) ? frac : 0)); items.push({ key, label, w, got: frac * w, ok: frac >= 0.999, part: frac > 0 && frac < 0.999 }); };
    const want = long ? 'bullish' : 'bearish', opp = long ? 'bearish' : 'bullish';
    const b1d = tfBias(T['1d']).label, b3d = tfBias(T['3d']).label, b1w = tfBias(T['1w']).label;
    add('htf', `Daily bias ${want}; 3D and weekly not against it`, 15, ((b1d === want ? 10 : 0) + (b3d !== opp ? 3 : 0) + (b1w !== opp ? 2 : 0)) / 15);
    if (g.symbol === 'BTC') add('btc', 'BTC 3D bias not against the trade', 8, b3d !== opp ? 1 : 0);
    else if (long) add('btc', 'BTC daily not bearish and BTC not at HTF resistance', 8, ((g.btc1d !== 'bearish' ? 4 : 0) + (!g.btcAtRes ? 4 : 0)) / 8);
    else add('btc', 'BTC daily bearish or BTC at HTF resistance', 8, ((g.btc1d === 'bearish' ? 4 : 0) + (g.btcAtRes ? 4 : 0)) / 8);
    const sTF = A && A.structure ? A.structure.label : 'undefined', sUp = up && T[up] && T[up].structure ? T[up].structure.label : 'undefined';
    add('struct', `${lbl} structure ${long ? 'HH/HL' : 'LH/LL'}, ${TF_LABEL[up] || 'higher TF'} not against it`, 10, ((sTF === (long ? 'bull' : 'bear') ? 6 : 0) + (sUp !== (long ? 'bear' : 'bull') ? 4 : 0)) / 10);
    const q = setupQuality(S, T, lv); add('quality', q.label, 15, q.f);
    const stc = A.stoch || {}; const tfSt = S.id === 'A2' ? T['4h'].stoch : stc;
    add('timing', `${S.id === 'A2' ? '4h' : lbl} stoch RSI ${long ? 'reset or curling up' : 'maxed or rolling over'}`, 7, long ? ((tfSt.reset || tfSt.curlUp) ? 1 : 0) : ((tfSt.maxed || tfSt.resetHigh) ? 1 : 0));
    // room: from the plan (level edge), else estimated from price for watch items
    let room = S.plan && !S.plan.invalid ? S.plan.room : NaN;
    if (room === Infinity) room = 9; // nothing mapped overhead
    if (!isNum(room)) { const px = lv.price; const res = lv.levels.filter((x) => ['horizontal', 'ob_breakdown', 'last_support'].includes(x.type) || (x.type === 'ma' && x.slope !== (long ? 'up' : 'down') && x.tf !== S.tf)).map((x) => long ? x.lo : x.hi).filter((e) => long ? e > px : e < px); const e = res.length ? (long ? Math.min(...res) : Math.max(...res)) : NaN; room = isNum(e) ? Math.abs(e - px) / (1.5 * A.ATR) : 9; }
    add('room', 'Room to the next HTF resistance of 3R or more', 12, room >= 3 ? 1 : room >= 2 ? 0.6 : room >= 1.5 ? 0.25 : 0);
    const zone = S.entry && isNum(S.entry[0]) ? S.entry : S.watchZone; let conf = 0;
    if (zone && A) { const zlo = Math.min(zone[0], zone[1]) - 0.3 * A.ATR, zhi = Math.max(zone[0], zone[1]) + 0.3 * A.ATR;
      const okType = (x) => long ? (['horizontal', 'ob_breakout'].includes(x.type) || (x.type === 'fvg' && x.dir === 'bull') || (x.type === 'ma' && x.tf !== S.tf && x.slope !== 'down') || (x.type === 'diagonal' && x.role === 'sup' && !(S.diag && x.kind === S.diag.kind && x.tf === S.tf))) : (['horizontal', 'ob_breakdown', 'last_support'].includes(x.type) || (x.type === 'fvg' && x.dir === 'bear') || (x.type === 'ma' && x.tf !== S.tf && x.slope !== 'up') || (x.type === 'diagonal' && x.role === 'res' && !(S.diag && x.kind === S.diag.kind && x.tf === S.tf)));
      conf = lv.levels.filter((x) => okType(x) && x.hi >= zlo && x.lo <= zhi).length; }
    add('confluence', 'Entry lines up with a horizontal / OB / inefficiency or a higher-TF MA', 10, conf >= 2 ? 1 : conf === 1 ? 0.6 : 0);
    const rp = g.rsPct; add('rs', long ? 'Stronger than BTC over 7 days (top 30% of the scan)' : 'Weaker than BTC over 7 days (bottom 30%)', 8, !isNum(rp) ? 0.5 : long ? (rp >= 70 ? 1 : rp >= 40 ? 0.5 : 0) : (rp <= 30 ? 1 : rp <= 60 ? 0.5 : 0));
    const vr = g.volRank; add('liq', 'Liquid (top 30 by volume)', 5, !isNum(vr) ? 0.6 : vr <= 30 ? 1 : vr <= 70 ? 0.6 : 0.2);
    add('clean', 'No warnings', 10, 1 - 0.35 * S.warnings.length);
    const score = Math.round(items.reduce((t, x) => t + x.got, 0));
    const core = items.find((x) => x.key === 'htf').got >= 10 && items.find((x) => x.key === 'struct').got >= 6 && room >= 2 && q.f >= 0.6;
    const grade = S.gates.length ? 'blocked' : (score >= 85 && core) ? 'A+' : score >= 72 ? 'A' : score >= 58 ? 'B' : 'C';
    const sf = { active: 1, forming: 0.92, watch: 0.75, far: 0.6, invalidated: 0 }[S.status]; const factor = isNum(sf) ? sf : 0.6;
    const potential = Math.round(S.gates.length ? score * 0.25 : score * factor);
    const missing = items.filter((x) => !x.ok).sort((a1, b1) => (b1.w - b1.got) - (a1.w - a1.got)).map((x) => x.label + (x.part ? ' (partly)' : ''));
    const coreMiss = []; if (items.find((x) => x.key === 'htf').got < 10) coreMiss.push(`a ${want} daily bias`); if (items.find((x) => x.key === 'struct').got < 6) coreMiss.push(`clean ${lbl} structure`); if (!(room >= 2)) coreMiss.push('2R+ room'); if (q.f < 0.6) coreMiss.push('a higher-quality setup');
    if (coreMiss.length && grade !== 'blocked') missing.unshift('A+ requires ' + coreMiss.join(', '));
    return { score, grade, potential, items, missing, core, room };
  }

  // ---------- scoring ----------
  function scoreSetup(S, plan) {
    let s = 0; if (S.status === 'active') s += 40; else if (S.status === 'forming') s += 20; else s += 0;
    s += S.confluence.length * 6 - S.warnings.length * 4; if (S.gates.length) s -= 60;
    if (plan && isNum(plan.avgTP)) s += Math.min(plan.avgTP, 5) * 4; if (plan && plan.room < P.roomR && S.family === 'Trend continuation') s -= 20;
    const tier = S.gates.length ? 'blocked' : s >= 60 ? 'A' : s >= 40 ? 'B' : 'C';
    return { score: s, tier };
  }

  function roomGate(S, plan) { if (plan && S.family === 'Trend continuation' && plan.room < P.roomR) S.gates.push(`Room ${plan.room.toFixed(1)}R to "${plan.roomLabel}" (< ${P.roomR}R)`); }

  // ---------- market context ----------
  function btcContext(T) {
    const out = { bias: {} }; for (const tf of ['1w', '3d', '1d', '12h', '4h', '1h']) out.bias[tf] = tfBias(T[tf]);
    const H4 = T['4h']; out.above4hE200 = H4 && !H4.insufficient ? H4.close > L(T, '4h', 'e200') : null;
    const lv = buildLevels(T); const price = lv.price; const resAbove = lv.levels.filter(x => ['1d', '3d', '1w', '12h'].includes(x.tf) && ['horizontal', 'ob_breakdown', 'last_support', 'ma'].includes(x.type) && x.lo > price && (x.lo - price) / price * 100 < 2 && (x.type !== 'ma' || x.slope !== 'up')).sort((a, b) => a.lo - b.lo);
    out.atResistance = resAbove.length > 0; out.resistance = resAbove[0] || null;
    const D = T['1d']; out.endOfBullRun = D && !D.insufficient && D.close < L(T, '1d', 'm100') && D.c[D.i - 1] >= D.m100[D.i - 1];
    return out;
  }

  const api = { gradeSetup, setupQuality, P, TF_MS, TF_UP, TF_LABEL, sma, ema, rma, atr, rsi, stochRsi, pivots, fromRows, aggregate, analyzeTF, analyzeCoin, L, buildLevels, tfBias, detectSetups, buildPlan, scoreSetup, roomGate, btcContext, compressionDirection, qualityText, isNum };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.KE = api;
})(typeof window !== 'undefined' ? window : globalThis);
