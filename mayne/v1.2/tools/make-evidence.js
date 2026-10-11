#!/usr/bin/env node
/* mayne v1.2 · collect the research results for the board's Evidence tab (mayne/v1.2/data/evidence.json).
   Reads the analysed result folders (summary.json from analyze.js, confluence.json from confluence.js).
   Usage: node mayne/v1.2/tools/make-evidence.js --res /path/to/mayne-v12-results [--out mayne/v1.2/data/evidence.json] */
'use strict';
const fs = require('fs');
const path = require('path');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => { if (x.startsWith('--')) a.push([x.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]); return a; }, []));
const RES = path.resolve(args.res); const OUT = path.resolve(args.out || path.join(__dirname, '..', 'data', 'evidence.json'));
const rd = (d, f) => JSON.parse(fs.readFileSync(path.join(RES, d, f), 'utf8'));
const LABEL = {
  B0: 'Baseline: Mayne rules as coded (v1.1) + realistic fills and costs', B0touch: 'Baseline with touch fills (as v1.1 assumed)',
  C1: 'C1 sweep definition fix (HTF or trigger-TF sweep)', C1b: 'C1b sweep required (C1 definition)', C1c: 'C1c trigger-TF sweep required (low taken → high broken)', C1d: 'C1d zone-TF SFP or trigger-TF sweep required',
  C2a: 'C2a BTC W/D bias agrees (not Mayne)', C2b: 'C2b relative strength vs BTC (not Mayne)', C2c: 'C2c both', C3: 'C3 2:1 after costs', C3b: 'C3b + cost cap 10% of 1R (not Mayne)',
  'C4-50': 'C4 volume rank ≤ 50', 'C4-20': 'C4 volume rank ≤ 20', 'C4-10': 'C4 volume rank ≤ 10', 'C4-maj': 'C4 majors only (BTC, ETH, SOL, HYPE)',
  C5: 'C5 reaction entry (Mayne V13)', C6: 'C6 external liquidity taken', C7: 'C7 young trend (first 2 tags since the daily MSB)', C7b: 'C7b OTE gate',
  C8a: 'C8a runner to PT', C8b12: 'C8b time stop 12 bars (not Mayne)', C8b24: 'C8b time stop 24 bars (not Mayne)', C8b48: 'C8b time stop 48 bars (not Mayne)',
  C9a: 'C9a crypto trading day 08–21 UTC', C9b: 'C9b no weekends (not Mayne)', C10: 'C10 ladder entry in thirds (Mayne V17)',
  'A-noD2': 'Gate removed: discount / premium (D2)', 'A-noTurn': 'Gate removed: HTF turn (S5)', 'A-noDsync': 'Gate removed: daily sync (S2)', 'A-noRR': 'Gate removed: 2:1 (D3)',
  F1: 'F1 = C2a', F2: 'F2 = C2a + C7', F3: 'F3 = C2a + C7 + C1c (chosen for P1)', F4: 'F4 = F3 + C8b12', F5: 'F5 = F4 + C9b',
};
const slim = (r) => r && ({ n: r.all.n, avg: r.all.avg, win: r.all.win, pf: r.all.pf, gross: r.gross && r.gross.avg, ci: r.ci ? [r.ci.lo90, r.ci.hi90] : null, perMonth: r.all.perMonth, year: Object.fromEntries(Object.entries(r.year || {}).map(([y, s]) => [y, s.n ? { n: s.n, avg: s.avg } : null])) });
function table(dir, skip) {
  const S = rd(dir, 'summary.json'); const o = {};
  for (const [p, vs] of Object.entries(S.profiles)) { o[p] = []; for (const [v, r] of Object.entries(vs)) { if (v === 'kept' || (skip && skip.test(v))) continue; o[p].push(Object.assign({ v, label: LABEL[v] || v }, slim(r))); } }
  return { rows: o, diag: S.diag || null, kept: Object.fromEntries(Object.entries(S.profiles).map(([p, vs]) => [p, vs.kept || null])) };
}
const ev = {
  made: new Date().toISOString(), engine: 'mayne.v1.2-js.1',
  verdict: { P1: 'FAIL', P2: 'FAIL', text: 'No rule change or combination survived the out-of-sample check. Kill rule applied: the board is a candidate list for discretionary review, ARMED is not validated, and nothing is tuned further on this history.' },
  method: {
    universe: 'Daily top-100 Binance USDT-M perpetuals by the previous day’s volume, delisted coins included (745 coins since 2021).',
    split: 'Rules chosen on setups armed 2021-01-01 → 2023-12-31; checked once on 2024-01-01 → 2026-10-10.',
    costs: 'Maker 0.02% for limit entries and targets; taker 0.05% + 0.03% slippage for stops; limits must trade through by 0.02%; funding from the Binance archive.',
    stats: 'Average net R per closed trade; 90% intervals from a block bootstrap over calendar weeks.',
    plan: 'Pre-registered in mayne/v1.2/TEST_PLAN.md before any result (two dated addenda).',
  },
  decide: table('decide'), combos: table('decide-combos-p1', /^C4|^B0$/), confirm: table('confirm', /^C4/),
  confluence: fs.existsSync(path.join(RES, 'confluence-mayne', 'confluence.json')) ? rd('confluence-mayne', 'confluence.json') : null,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(ev));
console.log(`wrote ${OUT} (${fs.statSync(OUT).size} bytes)`);
