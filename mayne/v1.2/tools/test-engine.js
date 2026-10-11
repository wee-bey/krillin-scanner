#!/usr/bin/env node
/* mayne v1.2 · engine checks (run before every research replay). No network, no files.
   1. With every v1.2 switch at its default, the v1.2 engine gives exactly the v1.1 engine's trades and events.
   2. No look-ahead with the v1.2 switches on.
   3. Rule mechanics of each switch (what it must and must not let through).
   4. The v1.2 execution model (maker/taker, gaps, ladder entries, funding). */
'use strict';
const assert = require('assert');
const V11 = require('../../lib/engine.js');
const M = require('../lib/engine.js');
const { execR } = require('./research.js');
const { fundingR } = require('./funding.js');

let pass = 0; const ok = (name, fn) => { fn(); pass++; console.log('ok  ' + name); };
const cols = (rows) => ({ t: rows.map((r) => r[0]), o: rows.map((r) => r[1]), h: rows.map((r) => r[2]), l: rows.map((r) => r[3]), c: rows.map((r) => r[4]), v: rows.map(() => 1) });
function walk(n, seed, p0, t0, vol) { // deterministic random walk with slow trends, 15m candles
  let s = seed; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; const vv = vol || 0.006;
  const rows = []; let p = p0;
  for (let i = 0; i < n; i++) { const o = p; const r = (rnd() - 0.5) * vv + Math.sin(i / 3000 + seed) * vv * 0.06; const c = o * (1 + r); rows.push([t0 + i * 9e5, o, Math.max(o, c) * (1 + rnd() * vv / 2), Math.min(o, c) * (1 - rnd() * vv / 2), c]); p = c; }
  return cols(rows);
}
const dataOf = (E, T15, prof) => {
  const ag = (tf) => E.aggregate(T15, 9e5, tf, true); const D = ag('1d');
  return prof === 'P1' ? { W: E.aggregate(D, 864e5, '1w', true), D, Z: ag('12h'), CF: ag('4h'), T: ag('1h') } : { W: E.aggregate(D, 864e5, '1w', true), D, Z: ag('4h'), CF: ag('1h'), T: T15 };
};
const V12_ONLY = ['entries', 'exitBar', 'qty', 'avgEn', 'mkt', 'entryMode', 'lad', 'lvl', 'rTag', 'swV11', 'swHtf', 'swZone', 'swLtf', 'extSw', 'tagN', 'sameBar', 'rrN'];
const strip = (tr) => { const o = {}; for (const k of Object.keys(tr)) if (!V12_ONLY.includes(k)) o[k] = tr[k]; return o; };
const SEEDS = [3, 21, 47, 77, 101, 131, 157, 191, 223, 257].map((s, i) => [s, [0.006, 0.007, 0.008][i % 3]]);
const runs = {}; // cache of (seed, profile) → { data, prep }
function get(seed, vol, prof) { const k = seed + prof; if (!runs[k]) { const T15 = walk(80000, seed, 100, Date.UTC(2021, 0, 4), vol); const data = dataOf(M, T15, prof); runs[k] = { T15, data, prep: M.prepare(data, { profile: prof }) }; } return runs[k]; }

ok('v1.2 defaults = v1.1 (trades and events), both profiles', () => {
  let n = 0;
  for (const [seed, vol] of SEEDS) for (const prof of ['P1', 'P2']) {
    const { T15 } = get(seed, vol, prof);
    const a = V11.run(dataOf(V11, T15, prof), { profile: prof }), b = M.run(dataOf(M, T15, prof), { profile: prof });
    assert.strictEqual(JSON.stringify(b.trades.map(strip)), JSON.stringify(a.trades), `trades differ (seed ${seed} ${prof})`);
    assert.strictEqual(JSON.stringify(b.events.map((e) => { const x = Object.assign({}, e); delete x.tagN; return x; })), JSON.stringify(a.events), `events differ (seed ${seed} ${prof})`);
    n += a.trades.length;
  }
  assert.ok(n >= 20, 'enough trades to compare: ' + n);
});

const ALL_ON = { sweepDef: 'zone', reqSweep: true, rrAfterCost: true, costCap: 0.1, fillThruPct: 0.02, reqExtSweep: true, timeStopN: 24, session: '08-21', noWeekend: false, runnerTo: 'pt' };
ok('no look-ahead with the v1.2 switches on (limit, reaction and ladder entries)', () => {
  for (const mode of ['edge', 'react', 'ladder']) for (const prof of ['P1', 'P2']) {
    const T15 = walk(60000, 21, 50, Date.UTC(2022, 0, 3), 0.008); const o = Object.assign({ profile: prof, entryMode: mode }, ALL_ON);
    const full = M.run(dataOf(M, T15, prof), o);
    for (const frac of [0.4, 0.75]) {
      const X = T15.t[Math.floor(T15.t.length * frac)];
      const cut = {}; for (const k of Object.keys(T15)) cut[k] = T15[k].slice(0, T15.t.findIndex((t) => t >= X));
      const part = M.run(dataOf(M, cut, prof), o);
      const evs = (r) => r.events.filter((e) => e.tc <= X).map((e) => `${e.type}|${e.t}|${e.dir}|${e.en || ''}|${e.sl || ''}|${e.px || ''}`);
      assert.deepStrictEqual(evs(part), evs(full), `${mode} ${prof} events before the cut differ`);
    }
  }
});

ok('switch mechanics: what each rule lets through', () => {
  for (const [seed, vol] of SEEDS) for (const prof of ['P1', 'P2']) {
    const { prep } = get(seed, vol, prof); const sim = (o) => M.simulate(prep, o).trades;
    for (const tr of sim({ sweepDef: 'ltf', reqSweep: true })) if (!tr.cont) { assert.ok(tr.swLtf, 'C1c needs the trigger-TF sweep'); assert.ok(/trigger-TF sweep/.test(tr.slWhy), 'C1c stop at the leg extreme'); }
    for (const tr of sim({ sweepDef: 'zone', reqSweep: true })) if (!tr.cont) assert.ok(tr.swZone || tr.swLtf, 'C1d needs a zone-TF SFP or the leg sweep');
    for (const tr of sim({ reqExtSweep: true })) if (!tr.cont) assert.ok(tr.extSw, 'C6 needs external liquidity');
    for (const tr of sim({ maxTagN: 2 })) assert.ok(tr.tagN <= 2, 'C7 tag count');
    for (const tr of sim({ rrAfterCost: true })) assert.ok(tr.rrN >= 2 - 1e-9, 'C3 R:R after costs');
    for (const tr of sim({ rrAfterCost: true, costCap: 0.1 })) assert.ok(0.001 * tr.en <= 0.1 * tr.risk + 1e-12, 'C3b cost cap');
    for (const tr of sim({ session: '08-21' })) { const hh = ((tr.tArm + M.TF_MS[M.PROFILES[prof].trig]) % 864e5) / 36e5; assert.ok(hh >= 8 && hh <= 21, 'C9a session'); }
    for (const tr of sim({ noWeekend: true })) { const dw = new Date(tr.tArm).getUTCDay(); assert.ok(dw !== 0 && dw !== 6, 'C9b weekend'); }
    for (const tr of sim({ runnerTo: 'pt' })) assert.strictEqual(tr.ft, tr.pt, 'C8a runner to PT');
    for (const tr of sim({ timeStopN: 12 })) if (tr.how === 'time stop') { assert.ok(tr.exitBar - tr.fillBar >= 12); assert.ok(!tr.partDone); }
    for (const tr of sim({ entryMode: 'react' })) if (Number.isFinite(tr.tFill)) { assert.ok(tr.mkt && tr.entries.length === 1 && tr.entries[0].mkt, 'C5 market entry'); assert.ok(tr.rr >= 2 - 1e-9, 'C5 re-checked R:R'); assert.ok(tr.dir === 'long' ? tr.en > tr.lvl : tr.en < tr.lvl, 'C5 entry beyond the edge'); }
    for (const tr of sim({ entryMode: 'ladder', fillThruPct: 0.02 })) if (tr.st === 'closed') {
      const q = tr.entries.reduce((a, x) => a + x.frac, 0), xq = tr.exits.reduce((a, x) => a + x.frac, 0);
      assert.ok(q > 0 && q <= 1 + 1e-9 && Math.abs(q - xq) < 1e-9, 'C10 exits close what was filled');
      assert.ok(tr.entries.every((x, i) => i === 0 || (tr.dir === 'long' ? x.px < tr.entries[i - 1].px : x.px > tr.entries[i - 1].px)), 'C10 levels fill in order');
    }
    for (const tr of sim({ fillThruPct: 0.02 })) if (Number.isFinite(tr.tFill)) { const j = tr.fillBar; assert.ok(tr.dir === 'long' ? prep.T.l[j] <= tr.en * (1 - 0.0002) : prep.T.h[j] >= tr.en * (1 + 0.0002), 'trade-through fill'); }
  }
});

ok('every armed trade still obeys the core gates with the switches on', () => {
  for (const [seed, vol] of SEEDS) for (const prof of ['P1', 'P2']) {
    const { prep } = get(seed, vol, prof);
    for (const mode of ['edge', 'react', 'ladder']) for (const tr of M.simulate(prep, Object.assign({ entryMode: mode }, ALL_ON)).trades) {
      const long = tr.dir === 'long'; assert.ok(tr.rr >= 2 - 1e-9, 'rr');
      assert.ok(long ? tr.sl0 < tr.en && tr.pt > tr.en : tr.sl0 > tr.en && tr.pt < tr.en, 'geometry');
      if (tr.st === 'closed') { const fr = tr.exits.reduce((a, x) => a + x.frac, 0); assert.ok(Math.abs(fr - (tr.qty || 1)) < 1e-9, 'exits sum to the filled size'); }
    }
  }
});

ok('execution model v1.2: maker / taker, gaps, ladder average, funding', () => {
  const X = { maker: 0.02, taker: 0.08 };
  const base = { dir: 'long', en: 100, sl0: 98, risk: 2, tFill: 0, st: 'closed' };
  const win = execR(Object.assign({}, base, { entries: [{ px: 100, frac: 1, open: 101 }], exits: [{ t: 1, px: 104, open: 103, frac: 1, why: 'FT' }] }), X, null);
  assert.ok(Math.abs(win.Rn - (4 - 0.0002 * 100 - 0.0002 * 104) / 2) < 1e-12, 'maker both sides');
  const stop = execR(Object.assign({}, base, { entries: [{ px: 100, frac: 1, open: 101 }], exits: [{ t: 1, px: 98, open: 97, frac: 1, why: 'stop' }] }), X, null);
  assert.ok(Math.abs(stop.Rn - (-3 - 0.0002 * 100 - 0.0008 * 97) / 2) < 1e-12, 'taker stop, gap at the open');
  const lad = execR(Object.assign({}, base, { entries: [{ px: 100, frac: 1 / 3, open: 101 }, { px: 99.5, frac: 1 / 3, open: 101 }], exits: [{ t: 1, px: 98, open: 99, frac: 2 / 3, why: 'stop' }] }), X, null);
  const e = (100 + 99.5) / 2; assert.ok(Math.abs(lad.Rg - (2 / 3) * (98 - e) / 2) < 1e-12, 'ladder average entry');
  const F = { t: [10, 20, 30], r: [0.0001, 0.0001, -0.0002] };
  assert.ok(Math.abs(fundingR(F, 1, 100, 2, 5, [[25, 1], [35, 1 / 3]]) - (-(0.0001 + 0.0001) * 100 / 2 + (0.0002 / 3) * 100 / 2)) < 1e-12, 'funding: longs pay positive rates, on the open fraction');
});

console.log(`${pass} checks passed`);
