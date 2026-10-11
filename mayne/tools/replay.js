#!/usr/bin/env node
/* mayne · multi-coin replay and paper-trade evaluator (Milestone 3). Separate from Krillin: own engine, own data, own results.

   1. Universe: the top 100 Binance USDT-M perpetuals by the PREVIOUS day's quote volume, every day (the Krillin scanner's
      rule; stablecoins, wrapped tokens, index and metal contracts excluded; delisted coins included, so no survivorship bias).
   2. For every coin that was ever in that universe, the engine (mayne/lib/engine.js, a port of indicator v1.1) runs over
      its whole history, per profile, exactly as the indicator runs on a chart: W and D from daily candles, zone /
      confirmation / trigger TFs from 15m candles (H12 at 00/12 UTC, weekly from Monday 00:00 UTC).
      A setup counts when it ARMS on a day the coin is in that day's top 100.
   3. Every armed setup is paper-traded by the engine's own rules (limit at the FVG edge, fill expiry, Mayne-own exit:
      ~2/3 at PL, runner to FT, stop trails to trigger-TF structure). The evaluator then charges costs on every fill
      and exit (fee + half the slippage per side) and fills through gaps at the open (limit entries and stops).
      R = net PnL ÷ the planned risk (entry to the original stop).
   4. Writes mayne/data/: index.json (rules, coverage, summaries), trades.json (one compact row per armed setup),
      market.json (BTC regime per day) and, with --sweep, sweep.json (parameter grid × regime × year).

   Usage: node mayne/tools/replay.js [--from 2021-01-01] [--profiles P1,P2] [--sweep] [--out mayne/data] [--cache .mcache]
                                      [--syms BTCUSDT,ETHUSDT] [--max-syms N] [--offline DIR]
*/
'use strict';
const fs = require('fs');
const path = require('path');
const M = require('../lib/engine.js');
const { makeStore, toCols, baseOf, pool, ymd, dayStart, DAY } = require('./candles.js');

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => { if (x.startsWith('--')) a.push([x.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]); return a; }, []));
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.resolve(ROOT, args.out || 'mayne/data');
const CACHE = path.resolve(ROOT, args.cache || '.mcache');
const FROM = args.from || '2021-01-01';
const PROFILES = String(args.profiles || 'P1,P2').split(',');
const UNIVERSE_N = 100;
const WARM_DAYS = 92;                                   // 15m history before a coin's first day in the universe (zone/confirm warm-up)
const COST = { feePct: 0.05, slipPct: 0.03 };           // the same cost model as the Krillin replay
const SIDE = (COST.feePct + COST.slipPct / 2) / 100;
const SWEEP = { slBufM: [0.10, 0.25, 0.50], maxWaitZ: [6, 12, 24] };   // HANDOFF NEXT §2: SL buffer × tag-to-trigger expiry, per profile
const REGIME = { lookback: 60, band: 10 };              // BTC 60-day change ≥ +10% bull, ≤ −10% bear, else chop (as of the previous daily close)
const runLog = []; const log = (...a) => { const s = `[${new Date().toISOString().slice(11, 19)}] ` + a.join(' '); console.log(s); runLog.push(s); };
const r4 = (x) => (Number.isFinite(x) ? Math.round(x * 1e4) / 1e4 : null);
const sig = (x) => (Number.isFinite(x) ? +x.toPrecision(7) : null);

// ───────────────────────── net R of one engine trade (costs + gap fills) ─────────────────────────
function evaluate(tr) {
  if (!Number.isFinite(tr.tFill)) return { filled: false, Rn: tr.st === 'armed' ? null : 0 };
  const long = tr.dir === 'long', sgn = long ? 1 : -1;
  const e = Number.isFinite(tr.fillOpen) ? (long ? Math.min(tr.en, tr.fillOpen) : Math.max(tr.en, tr.fillOpen)) : tr.en; // a gap through the limit fills at the open
  let gross = 0, cost = SIDE * e, frac = 0;
  for (const x of tr.exits) {
    const stop = /stop/.test(x.why); const px = stop ? (long ? Math.min(x.px, x.open) : Math.max(x.px, x.open)) : x.px; // a gap through the stop fills at the open
    gross += x.frac * sgn * (px - e); cost += x.frac * SIDE * px; frac += x.frac;
  }
  if (tr.st !== 'closed') return { filled: true, Rn: null };
  return { filled: true, Rn: (gross - cost) / tr.risk, gapEntry: e !== tr.en };
}

// ───────────────────────── statistics ─────────────────────────
function stats(rows) {
  const s = { armed: rows.length, filled: 0, closed: 0, open: 0, wins: 0, sumR: 0, sumRg: 0, pos: 0, neg: 0, maxDD: 0, exp: 0, cancel: 0 };
  const closed = [];
  for (const r of rows) {
    if (r.st === 'expired') s.exp++; else if (r.st === 'cancelled') s.cancel++;
    if (Number.isFinite(r.tFill)) s.filled++;
    if (r.st === 'closed' && Number.isFinite(r.Rn)) { s.closed++; s.sumR += r.Rn; s.sumRg += r.R; if (r.Rn > 0) { s.wins++; s.pos += r.Rn; } else s.neg -= r.Rn; closed.push(r); }
    else if (r.st === 'active') s.open++;
  }
  closed.sort((a, b) => a.tExit - b.tExit); let eq = 0, peak = 0;
  for (const r of closed) { eq += r.Rn; peak = Math.max(peak, eq); s.maxDD = Math.max(s.maxDD, peak - eq); }
  return { armed: s.armed, filled: s.filled, closed: s.closed, open: s.open, expired: s.exp, cancelled: s.cancel, win: s.closed ? r4(s.wins / s.closed) : null,
    avgR: s.closed ? r4(s.sumR / s.closed) : null, sumR: r4(s.sumR), avgRgross: s.closed ? r4(s.sumRg / s.closed) : null, pf: s.neg > 0 ? r4(s.pos / s.neg) : null, maxDD: r4(s.maxDD) };
}
function groupStats(rows, keyFn) { const g = new Map(); for (const r of rows) { const k = keyFn(r); if (k == null) continue; if (!g.has(k)) g.set(k, []); g.get(k).push(r); } const o = {}; for (const [k, v] of [...g].sort()) o[k] = stats(v); return o; }
function summary(rows) {
  return {
    all: stats(rows), regime: groupStats(rows, (r) => r.reg), year: groupStats(rows, (r) => ymd(r.tArm).slice(0, 4)),
    grade: groupStats(rows, (r) => r.grade), dir: groupStats(rows, (r) => r.dir), path: groupStats(rows, (r) => (r.cont ? 'continuation' : 'reversal')),
    zone: groupStats(rows, (r) => `${r.zoneTf} ${r.zoneKind}`), stop: groupStats(rows, (r) => r.slWhy), btc: groupStats(rows, (r) => (r.sym === 'BTCUSDT' ? 'BTC' : r.sym === 'ETHUSDT' ? 'ETH' : r.sym === 'SOLUSDT' ? 'SOL' : 'other')),
  };
}

// ───────────────────────── main ─────────────────────────
async function main() {
  const t0 = Date.now();
  const store = makeStore({ cache: CACHE, offline: args.offline ? path.resolve(args.offline) : null, log });
  const lastDay = await store.latestDay(); const endMs = dayStart(lastDay) + DAY; const fromMs = dayStart(FROM);
  log(`archive through ${lastDay}; signals from ${FROM}; profiles ${PROFILES.join(', ')}${args.sweep ? '; with the parameter sweep' : ''}`);

  // 1) daily candles of every symbol → the daily top-100 universe
  let syms = await store.listSymbols(); if (args.syms) { const want = new Set(String(args.syms).split(',')); syms = syms.filter((s) => want.has(s)); }
  log(`${syms.length} symbols in the archive (after filters)`);
  const daily = new Map();
  await pool(syms, 16, async (s) => { const rows = await store.loadRows(s, '1d', Date.UTC(2019, 0, 1), endMs, lastDay); if (rows.length) daily.set(s, rows); });
  log(`daily candles loaded for ${daily.size} symbols (${store.netCount()} downloads so far)`);
  const qv = new Map(); // day → [[sym, quoteVolume]]
  for (const [s, rows] of daily) for (const r of rows) { const d = ymd(r[0]); if (!qv.has(d)) qv.set(d, []); qv.get(d).push([s, r[5]]); }
  const member = new Map(); // sym → Map(day → rank)
  const universeSize = {};
  for (let d = fromMs; d < endMs; d += DAY) {
    const day = ymd(d), prev = ymd(d - DAY); const ranked = (qv.get(prev) || []).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]);
    const seen = new Set(); const list = [];
    for (const [s] of ranked) { const { base } = baseOf(s); if (seen.has(base)) continue; seen.add(base); list.push(s); if (list.length >= UNIVERSE_N) break; }
    if (!list.includes('BTCUSDT') && daily.has('BTCUSDT')) list.unshift('BTCUSDT');
    list.forEach((s, i) => { if (!member.has(s)) member.set(s, new Map()); member.get(s).set(day, i + 1); });
    universeSize[day] = list.length;
  }
  let cands = [...member.keys()].sort((a, b) => (a === 'BTCUSDT' ? -1 : b === 'BTCUSDT' ? 1 : a < b ? -1 : 1));
  if (args['max-syms']) cands = cands.slice(0, +args['max-syms']);
  log(`${cands.length} coins were in the daily top ${UNIVERSE_N} at least once since ${FROM}`);

  // 2) market regime per day (BTC 60-day change as of the previous daily close)
  const market = { rule: `BTC ${REGIME.lookback}-day change as of the previous daily close: ≥ +${REGIME.band}% bull, ≤ −${REGIME.band}% bear, otherwise chop`, days: {} };
  const btc = daily.get('BTCUSDT') || [];
  for (let i = REGIME.lookback; i < btc.length; i++) {
    const day = ymd(btc[i][0] + DAY); if (day < FROM) continue;
    const chg = (btc[i][4] / btc[i - REGIME.lookback][4] - 1) * 100;
    market.days[day] = { px: btc[i][4], chg: r4(chg), reg: chg >= REGIME.band ? 'bull' : chg <= -REGIME.band ? 'bear' : 'chop' };
  }

  // 3) run the engine per coin and profile
  const grid = []; for (const a of SWEEP.slBufM) for (const b of SWEEP.maxWaitZ) grid.push({ slBufM: a, maxWaitZ: b });
  const trades = []; const sweepRows = new Map(); // combo key → rows
  let done = 0, bars = 0;
  await pool(cands, 4, async (sym) => {
    const mem = member.get(sym); const days = [...mem.keys()].sort(); const D1rows = daily.get(sym);
    const from15 = Math.max(dayStart(days[0]) - WARM_DAYS * DAY, D1rows[0][0]);
    const rows15 = await store.loadRows(sym, '15m', from15, endMs, lastDay);
    if (rows15.length < 2000) { log(`${sym}: only ${rows15.length} 15m candles, skipped`); done++; return; }
    const T15 = toCols(rows15); const D1 = toCols(D1rows);
    const W = M.aggregate(D1, DAY, '1w', true), H1 = M.aggregate(T15, 9e5, '1h', true), H4 = M.aggregate(T15, 9e5, '4h', true), H12 = M.aggregate(T15, 9e5, '12h', true);
    bars += T15.t.length;
    for (const prof of PROFILES) {
      const data = prof === 'P1' ? { W, D: D1, Z: H12, CF: H4, T: H1 } : prof === 'P2' ? { W, D: D1, Z: H4, CF: H1, T: T15 } : null;
      if (!data) throw new Error('profile ' + prof + ' needs 5m candles: not part of the replay');
      const prep = M.prepare(data, { profile: prof, sym });
      const keep = (tr) => mem.has(ymd(tr.tArm));
      const rowOf = (tr) => { const e = evaluate(tr); const day = ymd(tr.tArm); return Object.assign(tr, { Rn: e.Rn, rank: mem.get(day), reg: market.days[day] ? market.days[day].reg : null }); };
      const base = M.simulate(prep);
      for (const tr of base.trades) if (keep(tr)) trades.push(rowOf(tr));
      if (args.sweep) for (const g of grid) {
        const k = `${prof}|${g.slBufM}|${g.maxWaitZ}`; if (!sweepRows.has(k)) sweepRows.set(k, []);
        const r = M.simulate(prep, g); const arr = sweepRows.get(k);
        for (const tr of r.trades) if (keep(tr)) { const x = rowOf(tr); arr.push({ st: x.st, tFill: x.tFill, tExit: x.tExit, R: x.R, Rn: x.Rn, reg: x.reg, tArm: x.tArm, grade: x.grade, dir: x.dir, cont: x.cont, zoneTf: x.zoneTf, zoneKind: x.zoneKind, slWhy: x.slWhy, sym: x.sym }); }
      }
    }
    done++; if (done % 25 === 0 || done === cands.length) log(`${done}/${cands.length} coins · ${trades.length} armed setups so far · ${store.netCount()} downloads`);
  });

  // 4) outputs
  trades.sort((a, b) => a.tArm - b.tArm);
  const COLS = ['sym', 'prof', 'dir', 'tArm', 'tFill', 'tExit', 'st', 'how', 'grade', 'boost', 'cont', 'zoneTf', 'zoneKind', 'turnHow', 'slWhy', 'en', 'sl0', 'pl', 'pt', 'ft', 'rr', 'riskAtr', 'R', 'Rn', 'att', 'reg', 'rank'];
  const rowsOut = trades.map((t) => COLS.map((k) => {
    const v = t[k]; if (k === 'boost') return v.join('+'); if (k === 'dir') return v === 'long' ? 1 : -1; if (k === 'cont') return v ? 1 : 0;
    if (['en', 'sl0', 'pl', 'pt', 'ft'].includes(k)) return sig(v); if (['rr', 'riskAtr', 'R', 'Rn'].includes(k)) return r4(v); if (typeof v === 'number' && !Number.isFinite(v)) return null; return v;
  }));
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'trades.json'), JSON.stringify({ version: 1, engine: M.VERSION, cols: COLS, rows: rowsOut }));
  fs.writeFileSync(path.join(OUT, 'market.json'), JSON.stringify(market));
  const byProf = {}; for (const p of PROFILES) byProf[p] = summary(trades.filter((t) => t.prof === p));
  const index = {
    version: 1, engine: M.VERSION, updated: new Date().toISOString(),
    coverage: { from: FROM, through: lastDay, coins: cands.length, candles15m: bars },
    rules: {
      universe: `top ${UNIVERSE_N} Binance USDT-M perpetuals by the previous day's quote volume, each day (stablecoins, wrapped tokens, index and metal contracts excluded; delisted coins included)`,
      engine: 'mayne/lib/engine.js = indicator mayne_v1.pine v1.1 (rulebook v1.1 + §14); higher-TF values from closed candles only; one setup at a time per coin and profile',
      counted: 'a setup counts when it ARMS on a day its coin is in that day\'s top 100', params: M.DEFAULTS,
      costs: `${COST.feePct}% fee per side + ${COST.slipPct}% slippage per round trip, on every fill and exit; limit entries and stops that gap fill at the open`,
      R: 'net PnL ÷ planned risk (entry to the original stop); Mayne-own exit (~2/3 at PL, runner to FT, stop trails to trigger-TF structure after the partial)',
      sameCandle: 'stop before targets; the fill candle checks only the stop; a cancellation known at a candle\'s open (bias lost, fill window over) comes before a fill',
      regime: market.rule,
    },
    summary: byProf,
  };
  if (args.sweep) {
    const sw = { version: 1, grid: SWEEP, note: 'base = slBufM 0.25 · maxWaitZ 12 (rulebook defaults). Choose on earlier years, confirm on later ones.', combos: [] };
    for (const [k, rows] of sweepRows) { const [prof, a, b] = k.split('|'); sw.combos.push({ prof, slBufM: +a, maxWaitZ: +b, all: stats(rows), regime: groupStats(rows, (r) => r.reg), year: groupStats(rows, (r) => ymd(r.tArm).slice(0, 4)), grade: groupStats(rows, (r) => r.grade), path: groupStats(rows, (r) => (r.cont ? 'continuation' : 'reversal')) }); }
    sw.combos.sort((x, y) => (x.prof + x.slBufM + '|' + x.maxWaitZ < y.prof + y.slBufM + '|' + y.maxWaitZ ? -1 : 1));
    fs.writeFileSync(path.join(OUT, 'sweep.json'), JSON.stringify(sw));
    index.sweep = { combos: sw.combos.length, file: 'sweep.json' };
  }
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 1));
  for (const p of PROFILES) { const a = byProf[p].all; log(`${p}: ${a.armed} armed · ${a.filled} filled · ${a.closed} closed · win ${a.win} · avg ${a.avgR}R net (${a.avgRgross}R gross) · PF ${a.pf} · ΣR ${a.sumR} · max DD ${a.maxDD}R`); }
  log(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s · ${store.netCount()} downloads`);
  fs.writeFileSync(path.join(OUT, 'last_run.txt'), runLog.join('\n') + '\n');
}
if (require.main === module) main().catch((e) => { log('FAILED: ' + (e && e.stack || e)); try { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'last_run.txt'), runLog.join('\n') + '\n'); } catch (e2) { /* ignore */ } process.exit(1); });
module.exports = { evaluate, stats };
