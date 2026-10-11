/* mayne.v1.1 engine (JavaScript) — Trader Mayne System, Milestone 3
   A line-by-line port of the TradingView indicator indicator/mayne_v1.pine v1.1.
   Spec: rulebook/MAYNE_RULEBOOK_v1.md (if this file and the rulebook disagree, the rulebook wins).
   Strategy namespace mayne.* — a separate module. It never shares a score, filter or signal with Krillin.

   Port rules (so the scanner, the replay and the chart agree):
   • Higher-TF values come from the last CLOSED higher-TF candle only, like request.security(expr[1],
     lookahead_on): at a trigger candle that opens at T, the W / D / zone / confirmation state is the state
     after the last candle of that TF whose close time is <= T.
   • The setup machine runs once per closed trigger candle, in the same section order as the Pine script.
   • Pine's na is NaN here; every comparison with NaN is false, as with na in Pine.
   • Not ported (indicator-only, all off by default): SMT, killzone / Silver Bullet / PO3 tags, daily-bias
     stats, news blackout. The OTE gate and the strict-stacking gate are ported.

   Works in Node (require) and in the browser (window.MayneEngine). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MayneEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const VERSION = 'mayne.v1.1-js.1';
  const H = 3600e3, DAY = 864e5;
  const TF_MS = { '5m': 3e5, '15m': 9e5, '1h': H, '4h': 4 * H, '12h': 12 * H, '1d': DAY, '1w': 7 * DAY };
  const TF_LABEL = { '1w': 'W', '1d': 'D', '12h': 'H12', '4h': 'H4', '1h': 'H1', '15m': 'M15', '5m': 'M5' };
  // rulebook §2 (the chart / trigger TF is the profile's trigger TF; bias = W + D)
  const PROFILES = {
    P1: { id: 'P1', name: 'P1 H12–H1', zone: '12h', conf: '4h', trig: '1h' },
    P2: { id: 'P2', name: 'P2 H4–M15', zone: '4h', conf: '1h', trig: '15m' },
    P3: { id: 'P3', name: 'P3 H1–M5', zone: '4h', conf: '1h', trig: '5m' },
  };
  // rulebook §11 / §12 defaults (= the indicator's input defaults)
  const DEFAULTS = {
    atrLen: 14, fvgMin: 0.10, eqTol: 0.25, slBufM: 0.25, minRR: 2.0, watchM: 1.5, expiryN: 48, maxAtt: 2,
    maxWaitZ: 12, reclaimN: 2, exitMode: 'mayne', partPct: 66.7, entryMode: 'edge', biasD: '1d',
    acct: 10000, riskBase: 1.0, riskAP: 2.0, mOTE: false, mStack: false,
  };
  const STATE_NAMES = ['IDLE', 'WATCH', 'FORMING', 'FORMING+', 'ARMED', 'ACTIVE'];

  const isn = (x) => x !== x;                        // NaN test (Pine na)
  const nz = (x) => (x !== x ? 0 : x);
  const kindName = (code) => { if (isn(code)) return 'POI'; const k = code % 10; const base = k === 1 ? 'FVG' : k === 2 ? 'OB' : k === 3 ? 'Breaker' : 'POI'; return code >= 10 ? (k === 1 ? 'FVG+OB' : base + '+FVG') : base; };
  const brkDir = (s) => (s === 1 || s === -2 ? 1 : s === -1 || s === 2 ? -1 : 0);
  const stName = (s) => (s === 1 ? 'BULL' : s === -1 ? 'BEAR' : s === 2 ? 'BULL · shifting' : s === -2 ? 'BEAR · shifting' : '—');

  // ta.atr(len) = RMA of the true range; first value = SMA of the first len true ranges (Pine semantics)
  function atrSeries(C, len) {
    const n = C.t.length, out = new Float64Array(n).fill(NaN); let prev = NaN, sum = 0;
    for (let i = 0; i < n; i++) {
      const tr = i === 0 ? C.h[0] - C.l[0] : Math.max(C.h[i] - C.l[i], Math.abs(C.h[i] - C.c[i - 1]), Math.abs(C.l[i] - C.c[i - 1]));
      if (i < len) { sum += tr; if (i === len - 1) prev = sum / len; out[i] = i === len - 1 ? prev : NaN; continue; }
      prev = (prev * (len - 1) + tr) / len; out[i] = prev;
    }
    return out;
  }

  // ───────────────────────── higher-TF engine (the Pine f_struct + f_htf) ─────────────────────────
  // C = { t, o, h, l, c } columns of CLOSED candles of one TF, ms = that TF's length.
  // Returns one snapshot per candle: the state after that candle closed.
  function htfEngine(C, ms, P, withPoi, pdFilter) {
    const { t, o, h, l, c } = C; const n = t.length;
    const atr = atrSeries(C, P.atrLen); const snaps = new Array(n);
    let st = 0, pHi = NaN, pHiBar = NaN, pLo = NaN, pLoBar = NaN, hiPend = false, loPend = false, xSeen = false;
    let upT = NaN, upDisp = false, upLegT = NaN, upBar = NaN, upLo = NaN, upLb = NaN, upNoReset = false;
    let dnT = NaN, dnDisp = false, dnLegT = NaN, dnBar = NaN, dnHi = NaN, dnHb = NaN, dnNoReset = false;
    let lastBullFvgBar = NaN, lastBearFvgBar = NaN;
    const hiP = [], hiE = [], loP = [], loE = [];
    let bullSfpT = NaN, bullSfpX = NaN, bearSfpT = NaN, bearSfpX = NaN;
    let bcHi = NaN, bcHiBar = NaN, bcHiX = NaN, bcLo = NaN, bcLoBar = NaN, bcLoX = NaN;
    const pois = []; let lastBullObBar = NaN, lastBearObBar = NaN;
    const lowestSince = (i, from) => { const k = isn(from) ? 0 : Math.min(Math.max(i - from, 0), 450); let lo = l[i], lb = i; for (let q = 0; q <= k; q++) if (l[i - q] < lo) { lo = l[i - q]; lb = i - q; } return [lo, lb]; };
    const highestSince = (i, from) => { const k = isn(from) ? 0 : Math.min(Math.max(i - from, 0), 450); let hi = h[i], hb = i; for (let q = 0; q <= k; q++) if (h[i - q] > hi) { hi = h[i - q]; hb = i - q; } return [hi, hb]; };

    for (let i = 0; i < n; i++) {
      const A = atr[i];
      const isSH = i >= 2 && h[i - 1] > h[i - 2] && h[i - 1] > h[i];
      const isSL = i >= 2 && l[i - 1] < l[i - 2] && l[i - 1] < l[i];
      const bullFvg = i >= 2 && l[i] > h[i - 2] && (l[i] - h[i - 2]) >= P.fvgMin * A;
      const bearFvg = i >= 2 && h[i] < l[i - 2] && (l[i - 2] - h[i]) >= P.fvgMin * A;
      if (bullFvg) lastBullFvgBar = i;
      if (bearFvg) lastBearFvgBar = i;

      // ── structure state machine (§3.2, §3.3, §14.1–14.2)
      if (st === 0) { if (isSH) { pHi = h[i - 1]; pHiBar = i - 1; } if (isSL) { pLo = l[i - 1]; pLoBar = i - 1; } }
      if (hiPend && h[i] > pHi) { pHi = h[i]; pHiBar = i; }
      if (loPend && l[i] < pLo) { pLo = l[i]; pLoBar = i; }
      if (st === 1 && hiPend && isSH) hiPend = false;
      if (st === -1 && loPend && isSL) loPend = false;
      if (st === 2 && isSH && h[i - 1] < pHi) { xSeen = true; loPend = false; }
      if (st === -2 && isSL && l[i - 1] > pLo) { xSeen = true; hiPend = false; }
      const brkUp = !isn(pHi) && !isn(pLo) && c[i] > pHi && (st !== -2 || xSeen);
      const brkDn = !isn(pHi) && !isn(pLo) && c[i] < pLo && (st !== 2 || xSeen);
      if (brkUp) {
        const [lo, lb] = lowestSince(i, pHiBar);
        const disp = !isn(lastBullFvgBar) && lastBullFvgBar >= lb + 2;
        upT = t[i] + ms; upDisp = disp; upLegT = t[lb]; upBar = i; upLo = lo; upLb = lb; upNoReset = false;
        if (st === -1) { st = -2; loPend = false; }
        else { if (st === 1 && !disp) upNoReset = true; else { pLo = lo; pLoBar = lb; } st = 1; loPend = false; }
        pHi = h[i]; pHiBar = i; hiPend = true; xSeen = false;
      } else if (brkDn) {
        const [hi, hb] = highestSince(i, pLoBar);
        const disp = !isn(lastBearFvgBar) && lastBearFvgBar >= hb + 2;
        dnT = t[i] + ms; dnDisp = disp; dnLegT = t[hb]; dnBar = i; dnHi = hi; dnHb = hb; dnNoReset = false;
        if (st === 1) { st = 2; hiPend = false; }
        else { if (st === -1 && !disp) dnNoReset = true; else { pHi = hi; pHiBar = hb; } st = -1; hiPend = false; }
        pLo = l[i]; pLoBar = i; loPend = true; xSeen = false;
      }
      if (!brkUp && !isn(upBar) && i === upBar + 1 && !upDisp && bullFvg) { upDisp = true; if (upNoReset && st === 1) { pLo = upLo; pLoBar = upLb; } upNoReset = false; }
      if (!brkDn && !isn(dnBar) && i === dnBar + 1 && !dnDisp && bearFvg) { dnDisp = true; if (dnNoReset && st === -1) { pHi = dnHi; pHiBar = dnHb; } dnNoReset = false; }

      const S = { st, hi: pHi, lo: pLo, upT, upD: upDisp, upL: upLegT, dnT, dnD: dnDisp, dnL: dnLegT };
      if (withPoi) {
        // ── liquidity pools, EQH/EQL, SFP & break-and-close sweeps (§3.6, §3.7)
        let sfpBear = false, sfpBearX = h[i];
        if (!isn(bcHi)) { bcHiX = Math.max(bcHiX, h[i]); if (c[i] < bcHi && i > bcHiBar) { sfpBear = true; sfpBearX = bcHiX; bcHi = NaN; } else if (i - bcHiBar >= P.reclaimN) bcHi = NaN; }
        for (let q = hiP.length - 1; q >= 0; q--) { const L = hiP[q]; if (h[i] > L) { if (c[i] < L) sfpBear = true; else if (isn(bcHi)) { bcHi = L; bcHiBar = i; bcHiX = h[i]; } hiP.splice(q, 1); hiE.splice(q, 1); } }
        if (sfpBear) { bearSfpT = t[i] + ms; bearSfpX = sfpBearX; }
        let sfpBull = false, sfpBullX = l[i];
        if (!isn(bcLo)) { bcLoX = Math.min(bcLoX, l[i]); if (c[i] > bcLo && i > bcLoBar) { sfpBull = true; sfpBullX = bcLoX; bcLo = NaN; } else if (i - bcLoBar >= P.reclaimN) bcLo = NaN; }
        for (let q = loP.length - 1; q >= 0; q--) { const L = loP[q]; if (l[i] < L) { if (c[i] > L) sfpBull = true; else if (isn(bcLo)) { bcLo = L; bcLoBar = i; bcLoX = l[i]; } loP.splice(q, 1); loE.splice(q, 1); } }
        if (sfpBull) { bullSfpT = t[i] + ms; bullSfpX = sfpBullX; }
        if (isSH) { const lvl = h[i - 1]; let eq = false; for (let q = 0; q < hiP.length; q++) if (Math.abs(hiP[q] - lvl) <= P.eqTol * A) { hiE[q] = true; eq = true; } hiP.push(lvl); hiE.push(eq); if (hiP.length > 40) { hiP.shift(); hiE.shift(); } }
        if (isSL) { const lvl = l[i - 1]; let eq = false; for (let q = 0; q < loP.length; q++) if (Math.abs(loP[q] - lvl) <= P.eqTol * A) { loE[q] = true; eq = true; } loP.push(lvl); loE.push(eq); if (loP.length > 40) { loP.shift(); loE.shift(); } }
        let up1 = NaN, up1Eq = false, up2 = NaN, dn1 = NaN, dn1Eq = false, dn2 = NaN;
        for (let q = 0; q < hiP.length; q++) { const L = hiP[q]; if (isn(up1) || L < up1) { up2 = up1; up1 = L; up1Eq = hiE[q]; } else if (isn(up2) || L < up2) up2 = L; }
        for (let q = 0; q < loP.length; q++) { const L = loP[q]; if (isn(dn1) || L > dn1) { dn2 = dn1; dn1 = L; dn1Eq = loE[q]; } else if (isn(dn2) || L > dn2) dn2 = L; }

        // ── POI status: 50% / invalid / breaker flip (§3.4, §3.5, §14.4)
        for (let q = pois.length - 1; q >= 0; q--) {
          const p = pois[q]; const mid = (p.top + p.bot) / 2;
          if (p.dir === 1) { if (p.kind === 2 && c[i] < mid) p.alive = false; if (c[i] < p.bot) { if (p.kind === 2) { p.dir = -1; p.kind = 3; p.alive = true; } else pois.splice(q, 1); } }
          else { if (p.kind === 2 && c[i] > mid) p.alive = false; if (c[i] > p.top) { if (p.kind === 2) { p.dir = 1; p.kind = 3; p.alive = true; } else pois.splice(q, 1); } }
        }
        // ── new POIs: FVG + the OB behind its displacement (last opposite-colour run, merged, wick to wick)
        if (bullFvg) {
          const fTop = l[i], fBot = h[i - 2]; let ovl = false, k0 = -1;
          for (let k = 1; k <= 6; k++) if (i - k >= 0 && c[i - k] < o[i - k]) { k0 = k; break; }
          if (k0 > 0) {
            let k1 = k0; for (let k = k0 + 1; k <= k0 + 5; k++) { if (i - k >= 0 && c[i - k] < o[i - k]) k1 = k; else break; }
            let obTop = h[i - k0], obBot = l[i - k0]; for (let k = k0; k <= k1; k++) { obTop = Math.max(obTop, h[i - k]); obBot = Math.min(obBot, l[i - k]); }
            ovl = obTop > fBot; const anchor = i - k0;
            if (isn(lastBullObBar) || anchor !== lastBullObBar) { lastBullObBar = anchor; pois.push({ dir: 1, kind: 2, top: obTop, bot: obBot, t: t[i - k0], ovl, alive: true }); }
          }
          pois.push({ dir: 1, kind: 1, top: fTop, bot: fBot, t: t[i - 1], ovl, alive: true });
        }
        if (bearFvg) {
          const fTop = l[i - 2], fBot = h[i]; let ovl = false, k0 = -1;
          for (let k = 1; k <= 6; k++) if (i - k >= 0 && c[i - k] > o[i - k]) { k0 = k; break; }
          if (k0 > 0) {
            let k1 = k0; for (let k = k0 + 1; k <= k0 + 5; k++) { if (i - k >= 0 && c[i - k] > o[i - k]) k1 = k; else break; }
            let obTop = h[i - k0], obBot = l[i - k0]; for (let k = k0; k <= k1; k++) { obTop = Math.max(obTop, h[i - k]); obBot = Math.min(obBot, l[i - k]); }
            ovl = obBot < fTop; const anchor = i - k0;
            if (isn(lastBearObBar) || anchor !== lastBearObBar) { lastBearObBar = anchor; pois.push({ dir: -1, kind: 2, top: obTop, bot: obBot, t: t[i - k0], ovl, alive: true }); }
          }
          pois.push({ dir: -1, kind: 1, top: fTop, bot: fBot, t: t[i - 1], ovl, alive: true });
        }
        while (pois.length > 60) pois.shift();
        // ── the two nearest valid POIs per direction (zone TF: must sit in discount / premium, §14.3)
        const eqL = (pHi + pLo) / 2; const b = [null, null], s = [null, null];
        for (const p of pois) {
          const ok = p.kind !== 2 || p.alive; const ce = (p.top + p.bot) / 2; const cd = p.kind + (p.ovl ? 10 : 0);
          if (ok && p.dir === 1 && (!pdFilter || (!isn(eqL) && ce <= eqL))) {
            if (!b[0] || p.top > b[0].top) { b[1] = b[0]; b[0] = { top: p.top, bot: p.bot, cd, tm: p.t }; }
            else if (!b[1] || p.top > b[1].top) b[1] = { top: p.top, bot: p.bot, cd, tm: p.t };
          }
          if (ok && p.dir === -1 && (!pdFilter || (!isn(eqL) && ce >= eqL))) {
            if (!s[0] || p.bot < s[0].bot) { s[1] = s[0]; s[0] = { top: p.top, bot: p.bot, cd, tm: p.t }; }
            else if (!s[1] || p.bot < s[1].bot) s[1] = { top: p.top, bot: p.bot, cd, tm: p.t };
          }
        }
        Object.assign(S, { bsT: bullSfpT, bsX: bullSfpX, ssT: bearSfpT, ssX: bearSfpX, atr: A, b, s, u1: up1, u1e: up1Eq, u2: up2, d1: dn1, d1e: dn1Eq, d2: dn2 });
      }
      snaps[i] = S;
    }
    return snaps;
  }

  const NA_LITE = { st: 0, hi: NaN, lo: NaN, upT: NaN, upD: false, upL: NaN, dnT: NaN, dnD: false, dnL: NaN };
  const NA_FULL = Object.assign({}, NA_LITE, { bsT: NaN, bsX: NaN, ssT: NaN, ssX: NaN, atr: NaN, b: [null, null], s: [null, null], u1: NaN, u1e: false, u2: NaN, d1: NaN, d1e: false, d2: NaN });

  // ───────────────────────── the chart-side engine: trigger TF + setup state machine (§4–§7) ─────────────────────────
  // data = { W, D, Z, CF, T } candle columns ({ t, o, h, l, c }, open times in ms), all closed candles.
  // opts = DEFAULTS overrides + { profile: 'P1'|'P2'|'P3', sym, onEvent }.
  // Returns { trades, events, stats, state }.
  // prepare(): the parameter-independent part (higher-TF snapshots, alignment, trigger ATR). simulate() can then be
  // re-run with different chart-side parameters (SL buffer, expiries, attempts, exits, gates) without redoing it.
  const HTF_KEYS = ['atrLen', 'fvgMin', 'eqTol', 'reclaimN', 'biasD', 'profile'];
  function prepare(data, opts) {
    const P = Object.assign({}, DEFAULTS, opts || {}); const prof = PROFILES[P.profile || 'P1'];
    const zMs = TF_MS[prof.zone], cfMs = TF_MS[prof.conf], dMs = TF_MS[P.biasD], wMs = TF_MS['1w'];
    const wS = htfEngine(data.W, wMs, P, false, false), dS = htfEngine(data.D, dMs, P, false, false);
    const zS = htfEngine(data.Z, zMs, P, true, true), cS = htfEngine(data.CF, cfMs, P, true, false);
    const T = data.T; const n = T.t.length;
    const idx = (C, ms) => { const out = new Int32Array(n); let k = -1; const m = C.t.length; for (let j = 0; j < n; j++) { while (k + 1 < m && C.t[k + 1] + ms <= T.t[j]) k++; out[j] = k; } return out; };
    return { P, prof, T, atrC: atrSeries(T, P.atrLen), wS, dS, zS, cS, iW: idx(data.W, wMs), iD: idx(data.D, dMs), iZ: idx(data.Z, zMs), iC: idx(data.CF, cfMs) };
  }
  function run(data, opts) { return simulate(prepare(data, opts)); }

  function simulate(prep, over) {
    const P = Object.assign({}, prep.P, over || {}); const prof = prep.prof;
    for (const k of HTF_KEYS) if (over && k in over && over[k] !== prep.P[k]) throw new Error(`simulate(): ${k} changes the higher-TF state, call prepare() again`);
    const zTF = prof.zone, cfTF = prof.conf, tgTF = prof.trig, zMs = TF_MS[zTF];
    const zL = TF_LABEL[zTF], cfL = TF_LABEL[cfTF], dL = TF_LABEL[P.biasD];
    const { wS, dS, zS, cS, iW, iD, iZ, iC } = prep;
    const T = prep.T; const { t, o, h, l, c } = T; const n = t.length; const tgMs = TF_MS[tgTF];
    const atrC = prep.atrC;
    const pf = P.partPct / 100; const mech = P.exitMode === 'mechanical'; const useCE = P.entryMode === 'ce';
    const events = [], trades = []; const emit = (e) => { events.push(e); if (P.onEvent) P.onEvent(e); };

    // trigger-TF engine state
    let cSH = NaN, cSHBar = NaN, cSHBrk = true, cSL = NaN, cSLBar = NaN, cSLBrk = true;
    const gaps = [], cHiP = [], cLoP = [];
    let cBullSwT = NaN, cBearSwT = NaN, cbcLo = NaN, cbcLoBar = NaN, cbcHi = NaN, cbcHiBar = NaN;
    const lowestSince = (j, from) => { const k = isn(from) ? 0 : Math.min(Math.max(j - from, 0), 450); let lo = l[j], lb = j; for (let q = 0; q <= k; q++) if (l[j - q] < lo) { lo = l[j - q]; lb = j - q; } return [lo, lb]; };
    const highestSince = (j, from) => { const k = isn(from) ? 0 : Math.min(Math.max(j - from, 0), 450); let hi = h[j], hb = j; for (let q = 0; q <= k; q++) if (h[j - q] > hi) { hi = h[j - q]; hb = j - q; } return [hi, hb]; };
    const findGap = (dir, from, to) => { let gt = NaN, gb = NaN, g3 = NaN; for (const g of gaps) if (g.dir === dir && g.c3 >= from && g.c3 <= to) if (isn(gt) || (dir === 1 ? g.top > gt : g.bot < gb)) { gt = g.top; gb = g.bot; g3 = g.c3; } return [gt, gb, g3]; };

    // setup state machine — sSt: 0 IDLE · 1 WATCH · 2 FORMING · 3 FORMING+ · 4 ARMED · 5 ACTIVE
    let sSt = 0, sDir = 0, zTop = NaN, zBot = NaN, zCode = NaN, zId = NaN, zTm = NaN, zTfS = '', zCont = false;
    let tagTm = NaN, ext = NaN, swept = false, turnTm = NaN, turnHow = '', att = 0;
    let pendBar = NaN, pendLeg = NaN, pendLegX = NaN, ptTag = NaN, tagZN = 0, pendSwBar = NaN, pendSwX = NaN;
    const used = new Set();
    let wDir = 0, wTop = NaN, wBot = NaN, wCode = NaN, wId = NaN, wTm = NaN, wTfS = '', wCont = false;
    let tr = null;                                   // the armed / active trade
    let partDone = false, partBar = NaN, realR = 0;
    let revTagB = NaN, revTagS = NaN;
    const stats = { armed: 0, filled: 0, win: 0, loss: 0, exp: 0, inv: 0, sumR: 0 };
    let hiSZ = NaN, loSZ = NaN, lastEvt = '—';
    let ctx = null;                                  // the HTF context of the latest bar (for the board)

    for (let j = 0; j < n; j++) {
      const time = t[j], tc = time + tgMs;
      const w = iW[j] >= 0 ? wS[iW[j]] : NA_LITE, d = iD[j] >= 0 ? dS[iD[j]] : NA_LITE, z = iZ[j] >= 0 ? zS[iZ[j]] : NA_FULL, cf = iC[j] >= 0 ? cS[iC[j]] : NA_FULL;
      const A = atrC[j], buf = P.slBufM * A;
      const zNew = j > 0 && Math.floor(time / zMs) !== Math.floor(t[j - 1] / zMs);
      hiSZ = zNew || isn(hiSZ) ? h[j] : Math.max(hiSZ, h[j]);
      loSZ = zNew || isn(loSZ) ? l[j] : Math.min(loSZ, l[j]);

      // bias (S1 weekly, S2 daily sync) and ranges
      const biasDir = w.st === 1 ? 1 : w.st === -1 ? -1 : 0;
      const dSync = biasDir === 1 ? (d.st === 1 || d.st === -2) : biasDir === -1 ? (d.st === -1 || d.st === 2) : false;
      const biasOK = biasDir !== 0 && dSync;
      const zEQ = (z.hi + z.lo) / 2, dEQ = (d.hi + d.lo) / 2, wEQ = (w.hi + w.lo) / 2;
      // continuation context (§4, §14.5)
      const zUpLive = nz(z.upT) > nz(z.dnT) && z.upD && !isn(revTagB) && z.upT > revTagB;
      const dUpLive = nz(d.upT) > nz(d.dnT) && d.upD && !isn(revTagB) && d.upT > revTagB;
      const zDnLive = nz(z.dnT) > nz(z.upT) && z.dnD && !isn(revTagS) && z.dnT > revTagS;
      const dDnLive = nz(d.dnT) > nz(d.upT) && d.dnD && !isn(revTagS) && d.dnT > revTagS;
      const contLegB = zUpLive ? z.upL : dUpLive ? d.upL : NaN, contLegS = zDnLive ? z.dnL : dDnLive ? d.dnL : NaN;
      const contBrkB = zUpLive ? z.upT : dUpLive ? d.upT : NaN, contBrkS = zDnLive ? z.dnT : dDnLive ? d.dnT : NaN;
      // primary target: nearest unswept zone-TF pool beyond entry, not swept in the current zone candle (§5.3)
      const fpt = (dir, en) => {
        if (dir === 1) { const fl = Math.max(en, hiSZ); if (!isn(z.u1) && z.u1 > fl) return z.u1; if (!isn(z.u2) && z.u2 > fl) return z.u2; return NaN; }
        const cl = Math.min(en, loSZ); if (!isn(z.d1) && z.d1 < cl) return z.d1; if (!isn(z.d2) && z.d2 < cl) return z.d2; return NaN;
      };
      ctx = { time, biasDir, dSync, biasOK, w, d, z, cf, zEQ };

      // ── trigger-TF swings, MSB, FVGs, pools, sweeps
      const cIsSH = j >= 2 && h[j - 1] > h[j - 2] && h[j - 1] > h[j];
      const cIsSL = j >= 2 && l[j - 1] < l[j - 2] && l[j - 1] < l[j];
      if (cIsSH) { cSH = h[j - 1]; cSHBar = j - 1; cSHBrk = false; }
      if (cIsSL) { cSL = l[j - 1]; cSLBar = j - 1; cSLBrk = false; }
      const cUp = !cSHBrk && !isn(cSH) && c[j] > cSH;
      const cDn = !cSLBrk && !isn(cSL) && c[j] < cSL;
      let cLegLo = NaN, cLegLoB = NaN, cLegHi = NaN, cLegHiB = NaN;
      if (cUp) { cSHBrk = true; [cLegLo, cLegLoB] = lowestSince(j, cSHBar); }
      if (cDn) { cSLBrk = true; [cLegHi, cLegHiB] = highestSince(j, cSLBar); }
      for (let q = gaps.length - 1; q >= 0; q--) { const g = gaps[q]; if ((g.dir === 1 && c[j] < g.bot) || (g.dir === -1 && c[j] > g.top) || j - g.c3 > 400) gaps.splice(q, 1); }
      if (j >= 2 && l[j] > h[j - 2] && (l[j] - h[j - 2]) >= P.fvgMin * A) gaps.push({ dir: 1, top: l[j], bot: h[j - 2], c3: j });
      if (j >= 2 && h[j] < l[j - 2] && (l[j - 2] - h[j]) >= P.fvgMin * A) gaps.push({ dir: -1, top: l[j - 2], bot: h[j], c3: j });
      while (gaps.length > 80) gaps.shift();
      if (!isn(cbcLo)) { if (c[j] > cbcLo && j > cbcLoBar) { cBullSwT = time; cbcLo = NaN; } else if (j - cbcLoBar >= P.reclaimN) cbcLo = NaN; }
      if (!isn(cbcHi)) { if (c[j] < cbcHi && j > cbcHiBar) { cBearSwT = time; cbcHi = NaN; } else if (j - cbcHiBar >= P.reclaimN) cbcHi = NaN; }
      for (let q = cLoP.length - 1; q >= 0; q--) { const L = cLoP[q]; if (l[j] < L) { if (c[j] > L) cBullSwT = time; else if (isn(cbcLo)) { cbcLo = L; cbcLoBar = j; } cLoP.splice(q, 1); } }
      for (let q = cHiP.length - 1; q >= 0; q--) { const L = cHiP[q]; if (h[j] > L) { if (c[j] < L) cBearSwT = time; else if (isn(cbcHi)) { cbcHi = L; cbcHiBar = j; } cHiP.splice(q, 1); } }
      if (cIsSH) { cHiP.push(h[j - 1]); if (cHiP.length > 60) cHiP.shift(); }
      if (cIsSL) { cLoP.push(l[j - 1]); if (cLoP.length > 60) cLoP.shift(); }

      const dirS = sDir === 1 ? 'LONG' : 'SHORT';
      const ev = (type, extra) => { const e = Object.assign({ type, t: time, tc, dir: sDir, j }, extra || {}); emit(e); return e; };

      // ── ACTIVE: manage the filled trade (§5.4)
      if (sSt === 5) {
        const fillNow = j === tr.fillBar;
        const stopHit = sDir === 1 ? l[j] <= tr.sl : h[j] >= tr.sl;
        let closed = false, how = '';
        if (stopHit) {
          const rx = (sDir === 1 ? tr.sl - tr.en : tr.en - tr.sl) / tr.risk;
          const fr = partDone ? 1 - pf : 1.0; realR += fr * rx; closed = true; how = partDone ? 'runner stopped' : 'stopped';
          tr.exits.push({ t: time, px: tr.sl, open: o[j], frac: fr, why: partDone ? 'runner stop' : 'stop' }); ev('STOP', { px: tr.sl });
        } else if (!fillNow) {
          if (mech) {
            if (sDir === 1 ? h[j] >= tr.pt : l[j] <= tr.pt) { realR = tr.rr; closed = true; how = 'PT hit'; tr.exits.push({ t: time, px: tr.pt, open: o[j], frac: 1, why: 'PT' }); ev('TARGET', { px: tr.pt }); }
          } else {
            if (!partDone && (sDir === 1 ? h[j] >= tr.pl : l[j] <= tr.pl)) {
              partDone = true; partBar = j; realR += pf * Math.abs(tr.pl - tr.en) / tr.risk;
              tr.exits.push({ t: time, px: tr.pl, open: o[j], frac: pf, why: 'PL' }); ev('PARTIAL', { px: tr.pl });
            }
            if (sDir === 1 ? h[j] >= tr.ft : l[j] <= tr.ft) {
              const fr = partDone ? 1 - pf : 1.0; realR += fr * Math.abs(tr.ft - tr.en) / tr.risk; closed = true; how = 'FT hit';
              tr.exits.push({ t: time, px: tr.ft, open: o[j], frac: fr, why: 'FT' }); ev('TARGET', { px: tr.ft });
            } else if (partDone && !isn(partBar) && j - 1 > partBar) {
              // trail to the latest trigger-TF structure formed after the partial (never to entry)
              let nsl = NaN;
              if (sDir === 1 && cIsSL && l[j - 1] - buf > tr.sl) nsl = l[j - 1] - buf;
              if (sDir === -1 && cIsSH && h[j - 1] + buf < tr.sl) nsl = h[j - 1] + buf;
              if (!isn(nsl)) { tr.sl = nsl; tr.trail.push([time, nsl]); }
            }
          }
        }
        if (closed) {
          stats.sumR += realR; if (realR > 0) stats.win++; else stats.loss++;
          tr.st = 'closed'; tr.how = how; tr.R = realR; tr.tExit = time; tr.partDone = partDone;
          lastEvt = `${dirS} closed: ${how} ${realR.toFixed(2)}R`; ev('CLOSE', { how, R: realR, trade: tr.id });
          const zoneOk = sDir === 1 ? l[j] >= zBot - buf : h[j] <= zTop + buf;
          if (stopHit && zoneOk && att < P.maxAtt && biasOK) { sSt = 3; pendBar = NaN; }     // another attempt in the same live zone
          else { used.add(zId); sSt = 0; }
          tr = null;
        }
      }

      // ── ARMED: waiting for the fill (S7), expiry / invalidation
      if (sSt === 4 && j > tr.armBar) {
        // bias loss and the fill window are known at this bar's open, so they cancel the limit before any fill
        const timeOut = j - tr.armBar > P.expiryN;
        const filled = biasOK && !timeOut && (sDir === 1 ? l[j] <= tr.en : h[j] >= tr.en);
        if (filled) {
          sSt = 5; tr.fillBar = j; tr.tFill = time; tr.fillOpen = o[j]; tr.st = 'active'; stats.filled++;
          lastEvt = `${dirS} FILLED @ ${tr.en}`; ev('FILL', { px: tr.en, trade: tr.id });
          if (sDir === 1 ? l[j] <= tr.sl : h[j] >= tr.sl) {
            realR = (sDir === 1 ? tr.sl - tr.en : tr.en - tr.sl) / tr.risk; stats.sumR += realR; stats.loss++;
            tr.exits.push({ t: time, px: tr.sl, open: o[j], frac: 1, why: 'stop (fill candle)' });
            tr.st = 'closed'; tr.how = 'stopped on the fill candle'; tr.R = realR; tr.tExit = time; tr.partDone = false;
            ev('STOP', { px: tr.sl }); ev('CLOSE', { how: tr.how, R: realR, trade: tr.id });
            used.add(zId); sSt = 0; tr = null;
          }
        } else {
          const breach = sDir === 1 ? l[j] < zBot - buf : h[j] > zTop + buf;
          const ptFirst = sDir === 1 ? h[j] >= tr.pt : l[j] <= tr.pt;
          if (ptFirst || timeOut || breach || !biasOK) {
            const why = ptFirst ? 'PT reached before fill' : timeOut ? `no fill in ${P.expiryN} bars` : breach ? 'zone breached' : 'bias lost';
            const exp = ptFirst || timeOut; if (exp) stats.exp++; else stats.inv++;
            tr.st = exp ? 'expired' : 'cancelled'; tr.how = why; tr.tExit = time; tr.R = 0;
            lastEvt = `${dirS} ${exp ? 'EXPIRED' : 'INVALIDATED'}: ${why}`; ev(exp ? 'EXP' : 'INV', { why, trade: tr.id });
            if (timeOut && !ptFirst && !breach && biasOK && att < P.maxAtt) { sSt = 3; pendBar = NaN; }
            else { if (breach || ptFirst || timeOut) used.add(zId); sSt = 0; }
            tr = null;
          }
        }
      }

      // ── FORMING / FORMING+ : zone locked, waiting for the HTF turn and the trigger
      if (sSt === 2 || sSt === 3) {
        ext = sDir === 1 ? Math.min(ext, l[j]) : Math.max(ext, h[j]);
        const htfSw = sDir === 1 ? (nz(z.bsT) > tagTm || nz(cf.bsT) > tagTm) : (nz(z.ssT) > tagTm || nz(cf.ssT) > tagTm);
        const ltfSw = sDir === 1 ? nz(cBullSwT) >= tagTm : nz(cBearSwT) >= tagTm;
        if (htfSw || ltfSw) swept = true;
        if (zNew) tagZN++;
        const breach = sDir === 1 ? l[j] < zBot - buf : h[j] > zTop + buf;
        const spent = !isn(ptTag) && (sDir === 1 ? h[j] >= ptTag : l[j] <= ptTag);
        const stale = tagZN > P.maxWaitZ;
        if ((spent || stale) && !breach && biasOK) {
          stats.exp++; const why = spent ? 'target reached before a trigger' : `no trigger within ${P.maxWaitZ} ${zL} candles`;
          lastEvt = `${dirS} EXPIRED: ${why}`; ev('ZEXP', { why }); used.add(zId); sSt = 0;
        } else if (breach || !biasOK) {
          stats.inv++; const why = breach ? 'zone breached' : 'bias lost (S1/S2)';
          lastEvt = `${dirS} INVALIDATED: ${why}`; ev('ZINV', { why }); if (breach) used.add(zId); sSt = 0;
        }
      }

      // S5 — HTF turn confirmed after the tag
      if (sSt === 2) {
        let how = '';
        if (sDir === 1) how = nz(z.bsT) > tagTm ? 'SFP ' + zL : nz(cf.bsT) > tagTm ? 'SFP ' + cfL : (nz(cf.upT) > tagTm && cf.upD) ? `MSB ${cfL} (displaced)` : nz(d.upT) > tagTm ? 'MSB ' + dL : '';
        else how = nz(z.ssT) > tagTm ? 'SFP ' + zL : nz(cf.ssT) > tagTm ? 'SFP ' + cfL : (nz(cf.dnT) > tagTm && cf.dnD) ? `MSB ${cfL} (displaced)` : nz(d.dnT) > tagTm ? 'MSB ' + dL : '';
        if (how !== '') { sSt = 3; turnTm = time; turnHow = how; lastEvt = `${dirS} FORMING+ (${how})`; ev('TURN', { how }); }
      }

      // S6 — trigger: trigger-TF MSB in the bias direction with displacement (FVG in the leg)
      if (sSt === 3) {
        if (((sDir === 1 && cUp) || (sDir === -1 && cDn)) && !isn(turnTm) && time >= turnTm) {
          pendBar = j; pendSwBar = sDir === 1 ? cSHBar : cSLBar; pendSwX = sDir === 1 ? cSH : cSL;
          pendLeg = sDir === 1 ? cLegLoB : cLegHiB; pendLegX = sDir === 1 ? cLegLo : cLegHi;
        }
        if (!isn(pendBar) && j <= pendBar + 1) {
          const [gTop, gBot, gC3] = findGap(sDir, pendLeg + 2, pendBar + 1);
          if (!isn(gTop)) {
            pendBar = NaN;
            const en = useCE ? (gTop + gBot) / 2 : sDir === 1 ? gTop : gBot;
            let sl = NaN, slWhy = '';
            if (zCont) { sl = sDir === 1 ? pendLegX - buf : pendLegX + buf; slWhy = 'trigger swing (continuation)'; }
            else if (swept) { sl = sDir === 1 ? Math.min(ext, pendLegX) - buf : Math.max(ext, pendLegX) + buf; slWhy = 'sweep extreme (reversal)'; }
            else { sl = sDir === 1 ? Math.min(zBot, ext) - buf : Math.max(zTop, ext) + buf; slWhy = 'POI far edge (reversal)'; }
            const risk = sDir === 1 ? en - sl : sl - en;
            const pt = fpt(sDir, en);
            const rr = risk > 0 && !isn(pt) ? Math.abs(pt - en) / risk : NaN;
            const rng = z.hi - z.lo; const retr = rng > 0 ? (sDir === 1 ? (z.hi - en) / rng : (en - z.lo) / rng) : NaN;
            const ote = !isn(retr) && retr >= 0.62 && retr <= 0.79;
            const stacked = sDir === 1 ? (en < wEQ && en < dEQ && en < zEQ) : (en > wEQ && en > dEQ && en > zEQ);
            let why = '';
            if (isn(risk) || risk <= 0) why = 'stop geometry';
            else if (isn(pt)) why = 'D3 no target';
            else if (rr < P.minRR) why = 'D3 R:R ' + rr.toFixed(1);
            else if (isn(zEQ) || (sDir === 1 ? en >= zEQ : en <= zEQ)) why = sDir === 1 ? 'D2 not in discount' : 'D2 not in premium';
            else if (P.mOTE && !ote) why = 'OTE gate';
            else if (P.mStack && !stacked) why = 'stacking gate';
            if (why !== '') { lastEvt = `${dirS} trigger rejected: ${why}`; ev('REJ', { why, en, sl, pt, cont: zCont }); }
            else {
              // targets (§5.3)
              let ft = sDir === 1 ? d.hi : d.lo;
              if (isn(ft) || (sDir === 1 ? ft <= pt : ft >= pt)) ft = sDir === 1 ? w.hi : w.lo;
              if (isn(ft) || (sDir === 1 ? ft <= pt : ft >= pt)) ft = pt;
              const twoR = sDir === 1 ? en + 2 * risk : en - 2 * risk; let pl = NaN;
              if (sDir === 1) { for (const L of cHiP) if (L >= twoR && L < pt && (isn(pl) || L < pl)) pl = L; }
              else { for (const L of cLoP) if (L <= twoR && L > pt && (isn(pl) || L > pl)) pl = L; }
              if (isn(pl)) pl = twoR;
              // grade (§7.2)
              const aligned = brkDir(w.st) === sDir && brkDir(d.st) === sDir && brkDir(z.st) === sDir && brkDir(cf.st) === sDir;
              let g = aligned && stacked ? 2 : aligned || stacked ? 1 : 0; let nb = 0; const boost = [];
              if (swept) { nb++; boost.push('SWEEP'); }
              if (!isn(zCode) && zCode >= 10) { nb++; boost.push('OB/FVG'); }
              if (ote) { nb++; boost.push('OTE'); }
              if (nb >= 2) g = Math.min(2, g + 1);
              const rp = g === 2 ? P.riskAP : P.riskBase;
              sSt = 4; att++; stats.armed++;
              partDone = false; partBar = NaN; realR = 0;
              const grade = g === 2 ? 'A+' : g === 1 ? 'A' : 'B';
              const ptEq = sDir === 1 ? (pt === z.u1 && z.u1e) : (pt === z.d1 && z.d1e);
              tr = {
                id: `${P.sym || ''}|${prof.id}|${sDir === 1 ? 'L' : 'S'}|${time}`, sym: P.sym || '', prof: prof.id, dir: sDir === 1 ? 'long' : 'short',
                tArm: time, armBar: j, en, sl, sl0: sl, pl, pt, ft, rr, risk, riskAtr: risk / A, atr: A, grade, g, boost, aligned, stacked, ote,
                cont: zCont, zoneTf: zTfS, zoneKind: kindName(zCode), zTop, zBot, tTag: tagTm, tTurn: turnTm, turnHow, slWhy, att, ptEq,
                riskPct: rp, riskUsd: P.acct * rp / 100, size: P.acct * rp / 100 / risk, fillBar: NaN, tFill: NaN, fillOpen: NaN,
                exits: [], trail: [], st: 'armed', how: '', R: NaN, tExit: NaN, partDone: false, msbT: t[pendSwBar], msbX: pendSwX, fvg: [gTop, gBot, t[gC3]],
              };
              trades.push(tr); lastEvt = `${dirS} ARMED ${grade}`; ev('ARM', { trade: tr.id, grade, en, sl, pl, pt, ft, rr });
            }
          }
        } else if (!isn(pendBar) && j > pendBar + 1) pendBar = NaN;
      }

      // ── IDLE / WATCH: pick the nearest valid POI, WATCH when close, FORMING when traded into (S3, S4)
      if (sSt <= 1) {
        let cand = null;
        if (biasOK) {
          const bull = biasDir === 1; const list = bull ? [z.b[0], z.b[1], cf.b[0], cf.b[1]] : [z.s[0], z.s[1], cf.s[0], cf.s[1]];
          const contLeg = bull ? contLegB : contLegS, contBrk = bull ? contBrkB : contBrkS;
          for (let i = 0; i < 4; i++) {
            const p = list[i]; if (!p || isn(p.top) || isn(p.bot) || isn(p.tm)) continue;
            const isConf = i >= 2; const id = p.tm + (isConf ? 1 : 0);
            const isCt = !isn(contLeg) && !isn(contBrk) && p.tm >= contLeg && p.tm <= contBrk;
            const pdOK = !isConf || (bull ? (p.top + p.bot) / 2 <= zEQ : (p.top + p.bot) / 2 >= zEQ);
            const okC = (!isConf || isCt) && pdOK && !used.has(id);
            const nearer = !cand || (bull ? p.top > cand.top : p.bot < cand.bot);
            if (okC && nearer) cand = { top: p.top, bot: p.bot, code: p.cd, id, tm: p.tm, tf: isConf ? cfL : zL, cont: isCt };
          }
        }
        if (cand) {
          const dd = biasDir;
          const touched = dd === 1 ? l[j] <= cand.top : h[j] >= cand.bot;
          const breach = dd === 1 ? l[j] < cand.bot - buf : h[j] > cand.top + buf;
          const dist = dd === 1 ? c[j] - cand.top : cand.bot - c[j];
          if (touched && breach) { used.add(cand.id); sSt = 0; }       // traded straight through: zone is dead
          else if (touched) {
            sSt = 2; sDir = dd; zTop = cand.top; zBot = cand.bot; zCode = cand.code; zId = cand.id; zTm = cand.tm; zTfS = cand.tf; zCont = cand.cont;
            tagTm = time; ptTag = fpt(dd, c[j]); tagZN = 0;
            if (!cand.cont) { if (dd === 1) revTagB = time; else revTagS = time; }
            ext = dd === 1 ? l[j] : h[j]; swept = false; att = 0; turnTm = NaN; turnHow = ''; pendBar = NaN;
            wDir = dd; wTop = cand.top; wBot = cand.bot;
            lastEvt = `${dd === 1 ? 'LONG' : 'SHORT'} FORMING: ${cand.tf} ${kindName(cand.code)} tagged`;
            emit({ type: 'TAG', t: time, tc, dir: dd, j, zone: [cand.bot, cand.top], tf: cand.tf, kind: kindName(cand.code), cont: cand.cont, ptTag });
            if (cand.cont) { sSt = 3; turnTm = time; turnHow = `continuation (${cand.tf} POI from a displaced HTF break)`; emit({ type: 'TURN', t: time, tc, dir: dd, j, how: turnHow }); }
          } else if (dist <= P.watchM * z.atr) {
            if (sSt === 0 || wId !== cand.id) emit({ type: 'WATCH', t: time, tc, dir: dd, j, zone: [cand.bot, cand.top], tf: cand.tf, kind: kindName(cand.code) });
            sSt = 1; wDir = dd; wTop = cand.top; wBot = cand.bot; wCode = cand.code; wId = cand.id; wTm = cand.tm; wTfS = cand.tf; wCont = cand.cont;
          } else sSt = 0;
        } else sSt = 0;
      }
    }

    // the live state after the last closed trigger candle (for the board)
    const last = n - 1;
    const state = {
      st: sSt, stName: STATE_NAMES[sSt], dir: sSt >= 2 ? sDir : sSt === 1 ? wDir : 0, t: n ? t[last] : NaN, tc: n ? t[last] + tgMs : NaN, close: n ? c[last] : NaN, atr: n ? atrC[last] : NaN,
      zone: sSt >= 2 ? { tf: zTfS, kind: kindName(zCode), top: zTop, bot: zBot, cont: zCont, tTag: tagTm, ptTag } : sSt === 1 ? { tf: wTfS, kind: kindName(wCode), top: wTop, bot: wBot, cont: wCont } : null,
      turn: sSt >= 3 ? { how: turnHow, t: turnTm } : null, swept, att, trade: tr ? Object.assign({}, tr) : null, partDone,
      bias: ctx ? { dir: ctx.biasDir, dSync: ctx.dSync, ok: ctx.biasOK, w: ctx.w.st, d: ctx.d.st, z: ctx.z.st, cf: ctx.cf.st, zHi: ctx.z.hi, zLo: ctx.z.lo, zEQ: ctx.zEQ } : null,
      lastEvt,
    };
    return { version: VERSION, profile: prof.id, trades, events, stats, state, params: P };
  }

  // ───────────────────────── candle helpers ─────────────────────────
  // aggregate closed candles of a lower TF (length fromMs) into a higher TF (UTC-aligned; weekly = Monday 00:00 UTC,
  // like TradingView crypto). With dropPartial the last bucket is dropped when the source data ends before that
  // bucket's close, so an unfinished higher-TF candle is never used.
  function aggregate(C, fromMs, toTf, dropPartial) {
    const ms = TF_MS[toTf]; const MON = 4 * DAY; // 1970-01-05 was a Monday
    const key = toTf === '1w' ? (x) => Math.floor((x - MON) / ms) * ms + MON : (x) => Math.floor(x / ms) * ms;
    const out = { t: [], o: [], h: [], l: [], c: [], v: [] }; let k = NaN;
    for (let i = 0; i < C.t.length; i++) {
      const b = key(C.t[i]);
      if (b !== k) { k = b; out.t.push(b); out.o.push(C.o[i]); out.h.push(C.h[i]); out.l.push(C.l[i]); out.c.push(C.c[i]); out.v.push(C.v ? C.v[i] : 0); }
      else { const m = out.t.length - 1; if (C.h[i] > out.h[m]) out.h[m] = C.h[i]; if (C.l[i] < out.l[m]) out.l[m] = C.l[i]; out.c[m] = C.c[i]; out.v[m] += C.v ? C.v[i] : 0; }
    }
    const n = C.t.length;
    if (dropPartial && out.t.length && n && out.t[out.t.length - 1] + ms > C.t[n - 1] + fromMs) for (const f of ['t', 'o', 'h', 'l', 'c', 'v']) out[f].pop();
    return out;
  }
  // keep only candles closed by time T
  function closedBy(C, ms, T) { let n = C.t.length; while (n > 0 && C.t[n - 1] + ms > T) n--; if (n === C.t.length) return C; const o = {}; for (const k of Object.keys(C)) o[k] = Array.isArray(C[k]) || ArrayBuffer.isView(C[k]) ? C[k].slice(0, n) : C[k]; return o; }

  return { VERSION, TF_MS, TF_LABEL, PROFILES, DEFAULTS, STATE_NAMES, run, prepare, simulate, htfEngine, atrSeries, aggregate, closedBy, kindName, stName, brkDir };
});
