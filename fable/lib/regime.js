/* Fable · regime library (pure functions; node and browser)

   The one piece of the Krillin course with evidence behind it (HANDOFF §5f): BTC's daily close above its daily
   MA100 = risk-on, below = risk-off. This file turns BTC daily candles into
   - the regime series (state per daily close, flips, days since the last flip, distance to the line),
   - the regime books as paper portfolios: A = long BTC in risk-on / short in risk-off, C = long / flat.
     Each leg is sized to a target annual volatility from BTC's trailing realised volatility (max 2x), the position
     decided at the daily close applies to the next day, exposure changes pay fees + slippage, and perp funding is
     charged (longs pay positive funding; shorts receive it).

   Every MA names its timeframe: everything here is DAILY (1d) BTC. The line is the daily SMA(100) of closes; the
   secondary line is Krillin's daily "EMA200", which his own script computes as SMMA(99).
*/
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(); else root.FableRegime = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const DAY = 864e5;
  const DEFAULTS = {
    ma: 100,            // daily SMA(100) of closes: the switch line
    smma: 99,           // Krillin's daily "EMA200" = SMMA(99), shown as a second opinion only
    atrN: 14,
    volWindow: 60,      // trailing days for realised volatility
    targetVol: 0.30,    // 30%/yr per leg
    maxLev: 2,
    costPct: 0.08,      // fee 0.05% + slippage 0.03%, per side, on each change of exposure
  };
  const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
  const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
  const round = (x, d = 4) => isNum(x) ? +x.toFixed(d) : null;

  function sma(c, n) { const out = new Array(c.length).fill(NaN); let s = 0; for (let i = 0; i < c.length; i++) { s += c[i]; if (i >= n) s -= c[i - n]; if (i >= n - 1) out[i] = s / n; } return out; }
  // Wilder's smoothed MA, seeded with the first n-value SMA (what TradingView's ta.rma does)
  function smma(c, n) { const out = new Array(c.length).fill(NaN); let s = 0; for (let i = 0; i < c.length; i++) { if (i < n) { s += c[i]; if (i === n - 1) out[i] = s / n; } else out[i] = (out[i - 1] * (n - 1) + c[i]) / n; } return out; }
  function atr(D, n) { const out = new Array(D.c.length).fill(NaN); for (let i = n; i < D.c.length; i++) { let s = 0; for (let j = i - n + 1; j <= i; j++) s += Math.max(D.h[j] - D.l[j], Math.abs(D.h[j] - D.c[j - 1]), Math.abs(D.l[j] - D.c[j - 1])); out[i] = s / n; } return out; }

  // D = { t, o, h, l, c } daily candles (closed), ascending. Returns one row per daily close from the first day the
  // MA exists. state: 1 risk-on (close above the line), -1 risk-off, 0 exactly on it (treated as unchanged).
  function series(D, P) {
    P = Object.assign({}, DEFAULTS, P || {});
    const n = D.c.length, m = sma(D.c, P.ma), s2 = smma(D.c, P.smma), a = atr(D, P.atrN), rows = [];
    let state = 0, lastFlipT = null, flips = 0;
    for (let i = 0; i < n; i++) {
      if (!isNum(m[i])) continue;
      const raw = D.c[i] > m[i] ? 1 : D.c[i] < m[i] ? -1 : 0; const next = raw || state;
      const flip = state !== 0 && next !== state; if (flip) { flips++; lastFlipT = D.t[i]; }
      if (state === 0 && next !== 0) lastFlipT = lastFlipT || D.t[i];
      state = next;
      const dist = (D.c[i] / m[i] - 1) * 100;
      const smmaState = isNum(s2[i]) ? (D.c[i] > s2[i] ? 1 : D.c[i] < s2[i] ? -1 : 0) : null;
      rows.push({ t: D.t[i] + DAY, day: ymd(D.t[i]), close: D.c[i], ma100: round(m[i], 2), state, flip, dist: round(dist, 3), daysSinceFlip: lastFlipT === null ? null : Math.round((D.t[i] - lastFlipT) / DAY), atr14: round(a[i], 2), smma99: round(s2[i], 2), smmaState });
    }
    return { rows, flips, params: P };
  }

  // realised volatility: annualised std of daily log returns over the trailing window ending at index i (inclusive)
  function realisedVol(c, i, w) { if (i < w) return NaN; let m = 0; const r = []; for (let j = i - w + 1; j <= i; j++) { const x = Math.log(c[j] / c[j - 1]); r.push(x); m += x; } m /= w; let v = 0; for (const x of r) v += (x - m) ** 2; return Math.sqrt(v / (w - 1)) * Math.sqrt(365); }

  // Paper portfolio for one book. funding: optional Map day -> summed daily funding rate (fraction), or null.
  // kind: 'A' long/short, 'C' long/flat. Returns daily rows with the target exposure, the realised return and equity.
  // The exposure decided at day d's close is held through day d+1 (so the return of day d+1 uses it).
  function book(D, reg, kind, P, funding) {
    P = Object.assign({}, DEFAULTS, P || {});
    const byT = new Map(); reg.rows.forEach((r, k) => byT.set(r.day, k));
    const rows = []; let eq = 1, pos = 0, peak = 1, maxDD = 0, costPaid = 0, fundPaid = 0, grossSum = 0, days = 0, switches = 0;
    const rets = [];
    for (let i = 1; i < D.c.length; i++) {
      const day = ymd(D.t[i]); const k = byT.get(day); if (k === undefined) continue;
      const r = reg.rows[k];
      // 1) the day's return on the exposure decided at the previous close
      const pxRet = D.c[i] / D.c[i - 1] - 1; const f = funding && funding.has(day) ? funding.get(day) : 0;
      const gross = pos * pxRet; const fund = -pos * f; // longs pay positive funding
      // 2) new exposure from this close: sign from the regime, size from the trailing vol
      const vol = realisedVol(D.c, i, P.volWindow); const size = isNum(vol) && vol > 0 ? Math.min(P.maxLev, P.targetVol / vol) : 0;
      const sgn = r.state > 0 ? 1 : (kind === 'A' ? -1 : 0);
      const target = sgn * size;
      const cost = Math.abs(target - pos) * P.costPct / 100; if (Math.sign(target) !== Math.sign(pos) && (target || pos)) switches++;
      const net = gross + fund - cost; eq *= 1 + net; rets.push(net); grossSum += gross; costPaid += cost; fundPaid += -fund; days++;
      peak = Math.max(peak, eq); maxDD = Math.max(maxDD, 1 - eq / peak);
      rows.push({ day, close: D.c[i], state: r.state, pos: round(pos, 3), target: round(target, 3), vol: round(vol, 3), ret: round(net, 6), eq: round(eq, 5) });
      pos = target;
    }
    const mean = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
    const sd = rets.length > 1 ? Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1)) : 0;
    const years = days / 365;
    return {
      kind, rows,
      stats: { days, years: round(years, 3), total: round(eq - 1, 4), cagr: years > 0 ? round(Math.pow(eq, 1 / years) - 1, 4) : null, sharpe: sd > 0 ? round(mean / sd * Math.sqrt(365), 3) : null, maxDD: round(maxDD, 4), switches, grossSum: round(grossSum, 4), costPaid: round(costPaid, 4), fundingPaid: round(fundPaid, 4), lastPos: round(pos, 3), lastVol: rows.length ? rows[rows.length - 1].vol : null },
    };
  }

  // calendar-year and custom-window slices of a book's daily rows (compounded)
  function windowReturn(rows, from, to) { let eq = 1, n = 0; for (const r of rows) if (r.day >= from && r.day <= to) { eq *= 1 + r.ret; n++; } return n ? { ret: round(eq - 1, 4), days: n } : null; }
  function byYear(rows) { const out = {}; for (const r of rows) { const y = r.day.slice(0, 4); if (!out[y]) out[y] = 1; out[y] *= 1 + r.ret; } for (const y of Object.keys(out)) out[y] = round(out[y] - 1, 4); return out; }

  // the target position for an account, from the latest regime row and vol
  function targetPosition(bookStats, account) { const lev = bookStats.lastPos; return { exposure: round(lev, 3), notional: isNum(lev) ? round(account * lev, 2) : null }; }

  return { DEFAULTS, sma, smma, atr, series, realisedVol, book, windowReturn, byYear, targetPosition, DAY };
});
