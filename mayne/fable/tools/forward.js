#!/usr/bin/env node
/* mayne fable · forward test (runs daily on main). The Fable rules were frozen on 16 Oct 2026 (FABLE_PLAN §9), so every
   setup that arms from 17 Oct 2026 on is genuinely out of sample. FABLE_PLAN §7 ended in FAIL, so the SHIPPED rule set is
   B0 (v1.2 behaviour) for every profile; the B1 / F_P1 / F_P2 rows are kept as TRACKED variants (information only).
   Converts the research replay's rows into the board's files, in the same shape as the v1.1 replay (index.json / trades.json):
     forward-index.json   coverage, rules, summary per profile (+ the Krillin-veto subset of the confluence test)
     forward-trades.json  one row per armed setup
   The Krillin flag (CONFLUENCE_PLAN M3: no opposite Krillin signal in the 24 h (P1) / 6 h (P2) before the arm) is read
   from the Krillin replay's own files on main (data/signals-*.json); it is tracked, not traded.
   Usage: node mayne/fable/tools/forward.js --in RESEARCH_OUT_DIR --krillin data --out mayne/fable/data */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { stats } = require('../../tools/replay.js');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => { if (x.startsWith('--')) a.push([x.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]); return a; }, []));
const IN = path.resolve(args.in), KD = path.resolve(args.krillin || 'data'), OUT = path.resolve(args.out || 'mayne/fable/data');
const SHIPPED = { P1: 'B0', P2: 'B0', P1D: 'B0', P2D: 'B0' };     // FABLE_PLAN §7 outcome (16 Oct 2026): FAIL → B0 everywhere
const TRACKED = { P1: ['B1', 'F_P1'], P2: ['B1', 'F_P2'], P1D: ['B1'], P2D: [] };
const FREEZE = '2026-10-17', H = 36e5, TF = { P1: H, P2: 15 * 6e4, P1D: 4 * H, P2D: H }, WIN = { P1: 24 * H, P2: 6 * H, P1D: 24 * H, P2D: 24 * H };
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
const rows = [], cols = [];
for (const f of fs.readdirSync(IN).filter((x) => /^shard-\d+\.json\.gz$/.test(x))) { const d = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(IN, f))).toString('utf8')); if (!cols.length) cols.push(...d.cols); for (const r of d.rows) rows.push(r); }
const R = rows.map((a) => Object.fromEntries(cols.map((k, i) => [k, a[i]]))).filter((r) => r.v === SHIPPED[r.prof] || (TRACKED[r.prof] || []).includes(r.v));
// Krillin signals per coin (resolved or not: only their time and direction matter here)
const KS = new Map();
if (fs.existsSync(KD)) for (const f of fs.readdirSync(KD).filter((x) => /^signals-\d{4}-\d{2}\.json$/.test(x) && x >= 'signals-2026-09.json')) {
  for (const s of JSON.parse(fs.readFileSync(path.join(KD, f), 'utf8')).signals) { if (!KS.has(s.sym)) KS.set(s.sym, []); KS.get(s.sym).push([s.t, s.dir === 'long' ? 1 : -1]); }
}
const kFlags = (r) => { const tc = r.tArm + TF[r.prof], a = (KS.get(r.sym) || []).filter(([t]) => t >= tc - WIN[r.prof] && t <= tc); return { kOpp: a.some(([, d]) => d !== r.dir) ? 1 : 0, kSame: a.some(([, d]) => d === r.dir) ? 1 : 0 }; };
const T = R.map((r) => { const [zoneTf, ...k] = String(r.zone || '').split(' '); return Object.assign({}, r, { dir: r.dir === 1 ? 'long' : 'short', zoneTf, zoneKind: k.join(' '), boost: r.boost ? String(r.boost).split('+') : [] }, kFlags(r)); }).sort((a, b) => a.tArm - b.tArm);
const COLS = ['sym', 'prof', 'dir', 'tArm', 'tFill', 'tExit', 'st', 'how', 'grade', 'boost', 'cont', 'zoneTf', 'zoneKind', 'turnHow', 'slWhy', 'en', 'sl0', 'pl', 'pt', 'ft', 'rr', 'riskAtr', 'R', 'Rn', 'att', 'reg', 'rank', 'swLtf', 'tagN', 'btc', 'kOpp', 'kSame', 'v', 'trailed', 'dbOK', 'po3', 'kz', 'sb'];
const out = T.map((t) => COLS.map((k) => { const v = t[k]; if (k === 'boost') return v.join('+'); if (k === 'dir') return v === 'long' ? 1 : -1; return v == null || (typeof v === 'number' && !Number.isFinite(v)) ? null : v; }));
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'forward-trades.json'), JSON.stringify({ version: 1, engine: 'mayne.fable-js.1', cols: COLS, rows: out }));
const grp = (rs, f) => { const g = {}; for (const r of rs) { const k = f(r); if (k == null) continue; (g[k] = g[k] || []).push(r); } return Object.fromEntries(Object.entries(g).sort().map(([k, v]) => [k, stats(v)])); };
const summary = {}; for (const p of ['P1', 'P2', 'P1D', 'P2D']) { const x = T.filter((r) => r.prof === p && r.v === SHIPPED[p]); if (!x.length) continue; summary[p] = { all: stats(x), regime: grp(x, (r) => r.reg), year: grp(x, (r) => ymd(r.tArm).slice(0, 7)), grade: grp(x, (r) => r.grade), dir: grp(x, (r) => r.dir), path: grp(x, (r) => (r.cont ? 'continuation' : 'reversal')), krillin: grp(x, (r) => (r.kOpp ? 'opposite Krillin signal' : 'no opposite Krillin signal (M3)')), tracked: Object.fromEntries((TRACKED[p] || []).map((v) => [v, stats(T.filter((r) => r.prof === p && r.v === v))])) }; }
const lastDay = T.length ? ymd(Math.max(...T.map((r) => r.tArm))) : FREEZE;
fs.writeFileSync(path.join(OUT, 'forward-index.json'), JSON.stringify({ version: 1, engine: 'mayne.fable-js.1', updated: new Date().toISOString(), shipped: SHIPPED, tracked: TRACKED,
  coverage: { from: FREEZE, through: lastDay, coins: new Set(T.map((r) => r.sym)).size },
  rules: { universe: 'daily top 100 Binance USDT-M perpetuals by the previous day’s volume', engine: 'mayne/fable/lib/engine.js with the shipped set B0 (= v1.2 behaviour; FABLE_PLAN §7 ended in FAIL) and the tracked sets B1 / F per profile, frozen on 16 Oct 2026', counted: 'setups that arm on or after 17 Oct 2026 on a day their coin is in the top 100', costs: 'maker 0.02% for limit entries and targets, taker 0.05% + 0.03% slippage for stops, limits must trade through by 0.02%, funding charged', R: 'net PnL ÷ planned risk; the profile’s shipped exit', krillin: 'M3 flag: an opposite Krillin signal on the same coin in the 24 h (P1) / 6 h (P2) before the arm (tracked only)' },
  summary }, null, 1));
console.log(`forward: ${T.length} armed setups since ${FREEZE} (${T.filter((r) => r.st === 'closed').length} closed)`);
