#!/usr/bin/env node
/* mayne fable · collect the research results for the board's Evidence tab (mayne/fable/data/evidence.json).
   Reads the analysed result folders (summary.json from analyze.js) of the Fable runs: decide-A (Stage A, the exit),
   decide-B (Stage B, entry filters on B1), decide-F (P1's combination) and confirm (the one look).
   The verdict per profile is passed in by hand after FABLE_PLAN §7 is applied: --verdict '{"P1":"PASS",...}' --text '…'.
   Usage: node mayne/fable/tools/make-evidence.js --res /path/to/mayne-fable-results [--out mayne/fable/data/evidence.json]
          [--verdict JSON] [--text "…"] */
'use strict';
const fs = require('fs');
const path = require('path');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => { if (x.startsWith('--')) a.push([x.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]); return a; }, []));
const RES = path.resolve(args.res); const OUT = path.resolve(args.out || path.join(__dirname, '..', 'data', 'evidence.json'));
const rd = (d, f) => JSON.parse(fs.readFileSync(path.join(RES, d, f), 'utf8'));
const has = (d) => fs.existsSync(path.join(RES, d, 'summary.json'));
const LABEL = {
  B0: 'Baseline: Mayne rules as coded (v1.1) + realistic fills and costs',
  B1: 'B1 = baseline + this profile’s Stage A exit',
  E1: 'E1 runner keeps its original stop (Mayne V24)', E3: 'E3 runner trails to zone-TF structure', E2a: 'E2a partial at the nearest daily pool ≥ 2R (Mayne V24)', E2b: 'E2b partial at daily equal highs / lows first (Mayne V24)', E4: 'E4 = E1 + E2b (what Mayne did)',
  N2: 'N2 continuation setups only (Mayne V14)', N3a: 'N3a yesterday closed in its extreme 10% (Mayne V22)', N3b: 'N3b … and the trigger leg took that extreme (Mayne V22)', N4: 'N4 Power of 3: trigger leg beyond the daily open (Mayne V10)',
  N5: 'N5 only OB / breaker zones overlapping an FVG (Mayne V07)', N6a: 'N6a killzones NY 02–05 / 07–10 (Mayne V20)', N6b: 'N6b Silver Bullet NY 03–04 / 10–11 / 14–15 (Mayne V14)',
  F: 'F = B1 + N2 + N5 (P1’s chosen set)', F_P1: 'F = E3 exit + N2 + N5 (P1’s chosen set)', F_P2: 'F = E4 exit + N6b (P2’s chosen set)',
};
const slim = (r) => r && ({ n: r.all.n, avg: r.all.avg, win: r.all.win, pf: r.all.pf, gross: r.gross && r.gross.avg, ci: r.ci ? [r.ci.lo90, r.ci.hi90] : null, perMonth: r.all.perMonth, year: Object.fromEntries(Object.entries(r.year || {}).map(([y, s]) => [y, s.n ? { n: s.n, avg: s.avg } : null])) });
function table(dir) {
  if (!has(dir)) return null;
  const S = rd(dir, 'summary.json'); const o = {};
  for (const [p, vs] of Object.entries(S.profiles)) { o[p] = []; for (const [v, r] of Object.entries(vs)) { if (v === 'kept' || /^C4-/.test(v)) continue; o[p].push(Object.assign({ v, label: LABEL[v] || v }, slim(r))); } }
  return { rows: o, diag: S.diag || null, kept: Object.fromEntries(Object.entries(S.profiles).map(([p, vs]) => [p, vs.kept || null])) };
}
const ev = {
  made: new Date().toISOString(), engine: 'mayne.fable-js.1',
  verdict: { per: args.verdict ? JSON.parse(String(args.verdict)) : {}, text: args.text ? String(args.text) : 'Confirm look pending.' },
  method: {
    universe: 'Daily top-100 Binance USDT-M perpetuals by the previous day’s volume, delisted coins included (745 coins since 2021).',
    split: 'Rules chosen on setups armed 2021-01-01 → 2023-12-31 (Stage A exit, then Stage B entry filters on top of it); checked once on 2024-01-01 → 2026-10-15.',
    costs: 'Maker 0.02% for limit entries and targets; taker 0.05% + 0.03% slippage for stops; limits must trade through by 0.02%; funding from the Binance archive.',
    stats: 'Average net R per closed trade; 90% intervals from a block bootstrap over calendar weeks.',
    plan: 'Pre-registered in mayne/fable/FABLE_PLAN.md before any result; outcomes logged in its addendum 1 and §9.',
    fidelity: 'The engine reproduces Mayne’s one dated trade (V24, BTC short 21 May 2026) at the entry, stop and final target; v1.1’s exit did not reproduce his runner (FIDELITY_V24.md).',
  },
  stageA: table('decide-A'), stageB: table('decide-B'), stageF: table('decide-F'), confirm: table('confirm'),
  shipped: { P1: 'F_P1', P2: 'F_P2', P1D: 'B1', P2D: 'B0' },
};
fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(ev));
console.log(`wrote ${OUT} (${fs.statSync(OUT).size} bytes)`);
