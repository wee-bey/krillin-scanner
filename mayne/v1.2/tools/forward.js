#!/usr/bin/env node
/* mayne v1.2 · forward test (runs daily on main). The rules were frozen on 11 Oct 2026, so every setup that arms from
   12 Oct 2026 on is genuinely out of sample. Converts the research replay's B0 rows (v1.1 rules + realistic fills and
   costs) into the board's files, in the same shape as the v1.1 replay (index.json / trades.json):
     forward-index.json   coverage, rules, summary per profile (+ the Krillin-veto subset of the confluence test)
     forward-trades.json  one row per armed setup
   The Krillin flag (CONFLUENCE_PLAN M3: no opposite Krillin signal in the 24 h (P1) / 6 h (P2) before the arm) is read
   from the Krillin replay's own files on main (data/signals-*.json); it is tracked, not traded.
   Usage: node mayne/v1.2/tools/forward.js --in RESEARCH_OUT_DIR --krillin data --out mayne/v1.2/data */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { stats } = require('../../tools/replay.js');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => { if (x.startsWith('--')) a.push([x.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]); return a; }, []));
const IN = path.resolve(args.in), KD = path.resolve(args.krillin || 'data'), OUT = path.resolve(args.out || 'mayne/v1.2/data');
const FREEZE = '2026-10-12', H = 36e5, TF = { P1: H, P2: 15 * 6e4 }, WIN = { P1: 24 * H, P2: 6 * H };
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
const rows = [], cols = [];
for (const f of fs.readdirSync(IN).filter((x) => /^shard-\d+\.json\.gz$/.test(x))) { const d = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(IN, f))).toString('utf8')); if (!cols.length) cols.push(...d.cols); for (const r of d.rows) rows.push(r); }
const R = rows.map((a) => Object.fromEntries(cols.map((k, i) => [k, a[i]]))).filter((r) => r.v === 'B0');
// Krillin signals per coin (resolved or not: only their time and direction matter here)
const KS = new Map();
if (fs.existsSync(KD)) for (const f of fs.readdirSync(KD).filter((x) => /^signals-\d{4}-\d{2}\.json$/.test(x) && x >= 'signals-2026-09.json')) {
  for (const s of JSON.parse(fs.readFileSync(path.join(KD, f), 'utf8')).signals) { if (!KS.has(s.sym)) KS.set(s.sym, []); KS.get(s.sym).push([s.t, s.dir === 'long' ? 1 : -1]); }
}
const kFlags = (r) => { const tc = r.tArm + TF[r.prof], a = (KS.get(r.sym) || []).filter(([t]) => t >= tc - WIN[r.prof] && t <= tc); return { kOpp: a.some(([, d]) => d !== r.dir) ? 1 : 0, kSame: a.some(([, d]) => d === r.dir) ? 1 : 0 }; };
const T = R.map((r) => { const [zoneTf, ...k] = String(r.zone || '').split(' '); return Object.assign({}, r, { dir: r.dir === 1 ? 'long' : 'short', zoneTf, zoneKind: k.join(' '), boost: r.boost ? String(r.boost).split('+') : [] }, kFlags(r)); }).sort((a, b) => a.tArm - b.tArm);
const COLS = ['sym', 'prof', 'dir', 'tArm', 'tFill', 'tExit', 'st', 'how', 'grade', 'boost', 'cont', 'zoneTf', 'zoneKind', 'turnHow', 'slWhy', 'en', 'sl0', 'pl', 'pt', 'ft', 'rr', 'riskAtr', 'R', 'Rn', 'att', 'reg', 'rank', 'swLtf', 'tagN', 'btc', 'kOpp', 'kSame'];
const out = T.map((t) => COLS.map((k) => { const v = t[k]; if (k === 'boost') return v.join('+'); if (k === 'dir') return v === 'long' ? 1 : -1; return v == null || (typeof v === 'number' && !Number.isFinite(v)) ? null : v; }));
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'forward-trades.json'), JSON.stringify({ version: 1, engine: 'mayne.v1.2-js.1', cols: COLS, rows: out }));
const grp = (rs, f) => { const g = {}; for (const r of rs) { const k = f(r); if (k == null) continue; (g[k] = g[k] || []).push(r); } return Object.fromEntries(Object.entries(g).sort().map(([k, v]) => [k, stats(v)])); };
const summary = {}; for (const p of ['P1', 'P2']) { const x = T.filter((r) => r.prof === p); summary[p] = { all: stats(x), regime: grp(x, (r) => r.reg), year: grp(x, (r) => ymd(r.tArm).slice(0, 7)), grade: grp(x, (r) => r.grade), dir: grp(x, (r) => r.dir), path: grp(x, (r) => (r.cont ? 'continuation' : 'reversal')), krillin: grp(x, (r) => (r.kOpp ? 'opposite Krillin signal' : 'no opposite Krillin signal (M3)')) }; }
const lastDay = T.length ? ymd(Math.max(...T.map((r) => r.tArm))) : FREEZE;
fs.writeFileSync(path.join(OUT, 'forward-index.json'), JSON.stringify({ version: 1, engine: 'mayne.v1.2-js.1', updated: new Date().toISOString(),
  coverage: { from: FREEZE, through: lastDay, coins: new Set(T.map((r) => r.sym)).size },
  rules: { universe: 'daily top 100 Binance USDT-M perpetuals by the previous day’s volume', engine: 'mayne/v1.2/lib/engine.js with v1.1 rules (the v1.2 switches are off), frozen on 11 Oct 2026', counted: 'setups that arm on or after 12 Oct 2026 on a day their coin is in the top 100', costs: 'maker 0.02% for limit entries and targets, taker 0.05% + 0.03% slippage for stops, limits must trade through by 0.02%, funding charged', R: 'net PnL ÷ planned risk; Mayne-own exit', krillin: 'M3 flag: an opposite Krillin signal on the same coin in the 24 h (P1) / 6 h (P2) before the arm (tracked only)' },
  summary }, null, 1));
console.log(`forward: ${T.length} armed setups since ${FREEZE} (${T.filter((r) => r.st === 'closed').length} closed)`);
