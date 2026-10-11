#!/usr/bin/env node
/* mayne · engine regression checks (run by the workflow before every replay). No network, no files. */
'use strict';
const assert = require('assert');
const M = require('../lib/engine.js');
const { evaluate } = require('./replay.js');

let pass = 0; const ok = (name, fn) => { fn(); pass++; console.log('ok  ' + name); };
const cols = (rows) => ({ t: rows.map((r) => r[0]), o: rows.map((r) => r[1]), h: rows.map((r) => r[2]), l: rows.map((r) => r[3]), c: rows.map((r) => r[4]), v: rows.map(() => 1) });
function walk(n, seed, p0, t0) { // deterministic random walk with slow trends, 15m candles
  let s = seed; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const rows = []; let p = p0;
  for (let i = 0; i < n; i++) { const o = p; const r = (rnd() - 0.5) * 0.006 + Math.sin(i / 7000 + seed) * 0.0005; const c = o * (1 + r); rows.push([t0 + i * 9e5, o, Math.max(o, c) * (1 + rnd() * 0.002), Math.min(o, c) * (1 - rnd() * 0.002), c]); p = c; }
  return cols(rows);
}
const dataOf = (T15, prof) => {
  const ag = (tf) => M.aggregate(T15, 9e5, tf, true); const D = ag('1d');
  return prof === 'P1' ? { W: M.aggregate(D, 864e5, '1w', true), D, Z: ag('12h'), CF: ag('4h'), T: ag('1h') } : { W: M.aggregate(D, 864e5, '1w', true), D, Z: ag('4h'), CF: ag('1h'), T: T15 };
};

ok('ATR = Pine RMA of the true range (SMA seed)', () => {
  const C = cols([[0, 10, 12, 9, 11], [1, 11, 13, 10, 12], [2, 12, 12.5, 8, 9], [3, 9, 10, 7, 8]]);
  const a = M.atrSeries(C, 2); const tr = [3, 3, 4.5, 3];
  assert(Number.isNaN(a[0])); assert.strictEqual(a[1], (tr[0] + tr[1]) / 2); assert.strictEqual(a[2], (a[1] + tr[2]) / 2); assert.strictEqual(a[3], (a[2] + tr[3]) / 2);
});

ok('weekly candles start Monday 00:00 UTC; an unfinished last bucket is dropped', () => {
  const t0 = Date.UTC(2024, 0, 1); // a Monday
  const D = cols(Array.from({ length: 17 }, (_, i) => [t0 + i * 864e5, i, i + 1, i - 1, i + 0.5]));
  const W = M.aggregate(D, 864e5, '1w', true);
  assert.deepStrictEqual(W.t, [t0, t0 + 7 * 864e5]); assert.strictEqual(W.o[1], 7); assert.strictEqual(W.c[1], 13.5); assert.strictEqual(W.h[1], 14); assert.strictEqual(W.l[0], -1);
  const H12 = M.aggregate(walk(100, 3, 100, Date.UTC(2024, 0, 1, 3)), 9e5, '12h', true);
  assert.strictEqual(H12.t[0] % (12 * 36e5), 0);
});

ok('structure: MSB up → BULL, MSS down → BULL·shifting, lower high + close below → BEAR (§3.2, §14.2)', () => {
  // highs/lows hand-built: swing low, swing high, close above it (bull), pullback, MSS below the higher low, LH, flip
  const seq = [[10, 12, 9, 11], [11, 13, 10, 12], [12, 15, 11, 14], [14, 14.5, 12, 13], [13, 13.5, 11.5, 12], [12, 16, 11.8, 15.8], [15.8, 16.5, 15, 16], [16, 16.2, 14, 14.5],
    [14.5, 15, 13, 13.5], [13.5, 13.8, 10, 10.5], [10.5, 12.5, 10.2, 12], [12, 13, 11.5, 12.5], [12.5, 12.8, 11, 11.2], [11.2, 11.5, 9, 9.2]];
  const C = cols(seq.map((x, i) => [i * 864e5, ...x]));
  const S = M.htfEngine(C, 864e5, Object.assign({}, M.DEFAULTS, { atrLen: 2 }), false, false);
  const st = S.map((s) => s.st);
  assert.ok(st.includes(1), 'bull state seen'); const iB = st.indexOf(1);
  assert.ok(st.slice(iB).includes(2), 'MSS down printed while bull'); const iS = st.indexOf(2, iB);
  assert.ok(st.slice(iS).includes(-1), 'flip to bear after a lower high and a close below');
});

ok('prepare + simulate equals run; a sweep override leaves the base untouched', () => {
  const T15 = walk(40000, 9, 100, Date.UTC(2022, 0, 3));
  for (const prof of ['P1', 'P2']) {
    const data = dataOf(T15, prof); const a = M.run(data, { profile: prof }); const prep = M.prepare(data, { profile: prof });
    const b = M.simulate(prep); M.simulate(prep, { slBufM: 0.5, maxWaitZ: 6 }); const c = M.simulate(prep);
    assert.deepStrictEqual(JSON.stringify(a.trades), JSON.stringify(b.trades)); assert.deepStrictEqual(JSON.stringify(b.trades), JSON.stringify(c.trades));
    assert.throws(() => M.simulate(prep, { fvgMin: 0.2 }), /higher-TF/);
  }
});

ok('no look-ahead: everything decided before time X is identical when the data stops at X', () => {
  const T15 = walk(60000, 21, 50, Date.UTC(2022, 0, 3));
  for (const prof of ['P1', 'P2']) {
    const full = M.run(dataOf(T15, prof), { profile: prof });
    for (const frac of [0.35, 0.6, 0.85]) {
      const X = T15.t[Math.floor(T15.t.length * frac)];
      const cut = {}; for (const k of Object.keys(T15)) cut[k] = T15[k].slice(0, T15.t.findIndex((t) => t >= X));
      const part = M.run(dataOf(cut, prof), { profile: prof });
      const evs = (r) => r.events.filter((e) => e.tc <= X).map((e) => `${e.type}|${e.t}|${e.dir}|${e.en || ''}|${e.sl || ''}`);
      assert.deepStrictEqual(evs(part), evs(full), `${prof} events before the cut differ`);
    }
    assert.ok(full.events.length > 50, `${prof} produced events`);
  }
});

ok('every armed trade obeys the gates: R:R ≥ 2 to PT, entry in discount/premium, stop beyond entry', () => {
  const T15 = walk(80000, 33, 2000, Date.UTC(2021, 5, 7));
  for (const prof of ['P1', 'P2']) {
    const r = M.run(dataOf(T15, prof), { profile: prof });
    for (const tr of r.trades) {
      assert.ok(tr.rr >= 2 - 1e-9, 'rr'); const long = tr.dir === 'long';
      assert.ok(long ? tr.sl0 < tr.en && tr.pt > tr.en && tr.pl > tr.en : tr.sl0 > tr.en && tr.pt < tr.en && tr.pl < tr.en, 'geometry');
      assert.ok(long ? tr.ft >= tr.pt : tr.ft <= tr.pt, 'FT beyond PT');
      const fr = tr.exits.reduce((a, x) => a + x.frac, 0); if (tr.st === 'closed') assert.ok(Math.abs(fr - 1) < 1e-9, 'exits sum to 100%');
    }
  }
});

ok('evaluator: costs and gap fills', () => {
  const base = { dir: 'long', en: 100, sl0: 98, risk: 2, fillOpen: 101, tFill: 1, st: 'closed' };
  const win = evaluate(Object.assign({}, base, { exits: [{ px: 104, open: 103, frac: 1, why: 'FT' }] }));
  const side = (0.05 + 0.015) / 100; assert.ok(Math.abs(win.Rn - (4 - side * 100 - side * 104) / 2) < 1e-12);
  const gap = evaluate(Object.assign({}, base, { exits: [{ px: 98, open: 97, frac: 1, why: 'stop' }] })); // gapped through the stop: filled at the open
  assert.ok(Math.abs(gap.Rn - (-3 - side * 100 - side * 97) / 2) < 1e-12);
  const better = evaluate(Object.assign({}, base, { fillOpen: 99.5, exits: [{ px: 98, open: 99, frac: 1, why: 'stop' }] })); // limit filled at a lower open
  assert.ok(Math.abs(better.Rn - (-1.5 - side * 99.5 - side * 98) / 2) < 1e-12);
});

console.log(`${pass} checks passed`);
