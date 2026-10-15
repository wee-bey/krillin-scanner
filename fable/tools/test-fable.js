#!/usr/bin/env node
/* Fable · regression checks, run before every job. Exit code 1 on any failure. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Regime = require('../lib/regime.js');
const Gates = require('../lib/gates.js');
const DAY = 864e5;
let n = 0; const ok = (name, fn) => { try { fn(); n++; console.log('ok  ' + name); } catch (e) { console.log('FAIL ' + name + ': ' + e.message); process.exitCode = 1; } };

// synthetic daily candles: 150 days drifting down from 103 to 100 (below a lagging MA), then 60 days rising to 160, then 60 days falling to 90
function synth() {
  const c = []; for (let i = 0; i < 150; i++) c.push(103 - i * 3 / 149); for (let i = 1; i <= 60; i++) c.push(100 + i); for (let i = 1; i <= 60; i++) c.push(160 - i * 70 / 60);
  const t0 = Date.parse('2025-01-01T00:00:00Z');
  return { t: c.map((_, i) => t0 + i * DAY), o: c.map((x) => x), h: c.map((x) => x * 1.01), l: c.map((x) => x * 0.99), c };
}

ok('sma / smma', () => {
  const s = Regime.sma([1, 2, 3, 4, 5], 3); assert.deepStrictEqual(s.slice(2).map((x) => +x.toFixed(6)), [2, 3, 4]); assert.ok(Number.isNaN(s[1]));
  const m = Regime.smma([1, 2, 3, 4, 5], 3); assert.strictEqual(+m[2].toFixed(6), 2); assert.strictEqual(+m[3].toFixed(6), +((2 * 2 + 4) / 3).toFixed(6));
});
ok('regime series: first row after 100 closes, flips where the close crosses the daily MA100', () => {
  const D = synth(); const r = Regime.series(D);
  assert.strictEqual(r.rows.length, D.c.length - 99); assert.strictEqual(r.rows[0].day, '2025-04-10');
  const on = r.rows.find((x) => x.flip); assert.ok(on && on.state === 1 && on.day >= '2025-05-31', 'first flip is to risk-on during the rise');
  const off = r.rows.filter((x) => x.flip).pop(); assert.ok(off.state === -1 && off.day > on.day, 'last flip is to risk-off during the fall');
  const last = r.rows[r.rows.length - 1]; assert.strictEqual(last.state, -1); assert.ok(last.daysSinceFlip >= 0 && last.dist < 0);
  for (const x of r.rows) assert.ok(x.t === Date.parse(x.day + 'T00:00:00Z') + DAY, 't is the close time of the day');
});
ok('book: the exposure decided at a close applies to the next day; costs on changes; funding charged to longs', () => {
  const D = synth(); const r = Regime.series(D);
  const f = new Map(); for (const x of r.rows) f.set(x.day, 0.0003);
  const A = Regime.book(D, r, 'A', null, f), C = Regime.book(D, r, 'C', null, f);
  assert.strictEqual(A.rows.length, r.rows.length - 0, 'one row per regime day');
  const i = A.rows.findIndex((x) => x.pos !== 0); assert.ok(i > 0); assert.strictEqual(A.rows[i].pos, A.rows[i - 1].target, 'pos today = target decided yesterday');
  const k = A.rows.findIndex((x) => x.state === -1 && x.pos > 0); assert.ok(k > 0, 'the day of the flip still carries the long'); assert.ok(A.rows[k].target < 0, 'and targets a short from that close');
  for (const x of C.rows) assert.ok(x.target >= 0, 'book C never shorts');
  assert.ok(A.stats.costPaid > 0 && C.stats.fundingPaid > 0 && A.stats.maxDD >= 0 && A.stats.maxDD <= 1, 'costs paid, the long-only book pays funding');
  // a hand-checked day: ret = pos*pxRet - pos*funding - |target-pos|*cost
  const j = A.rows.findIndex((x, q) => q > 0 && x.pos !== 0 && x.pos === x.target); const row = A.rows[j], prev = A.rows[j - 1];
  const pxRet = row.close / prev.close - 1; const exp = row.pos * pxRet - row.pos * 0.0003 - Math.abs(row.target - row.pos) * 0.0008;
  assert.ok(Math.abs(row.ret - exp) < 1e-5, `day return ${row.ret} vs ${exp}`);
  const lev = A.rows.map((x) => Math.abs(x.target)); assert.ok(Math.max(...lev) <= 2 + 1e-9, 'max 2x');
});
ok('byYear / windowReturn compound the daily rows', () => {
  const rows = [{ day: '2025-01-01', ret: 0.1 }, { day: '2025-01-02', ret: -0.1 }, { day: '2026-01-01', ret: 0.05 }];
  assert.deepStrictEqual(Regime.byYear(rows), { 2025: -0.01, 2026: 0.05 }); assert.deepStrictEqual(Regime.windowReturn(rows, '2025-01-02', '2026-12-31'), { ret: -0.055, days: 2 });
});

const base = { t: Date.parse('2026-03-04T12:00:00Z'), day: '2026-03-04', S: 'SOL', setup: 'A2', tf: '4h', dir: 'long', grade: 'A', stopPct: 2.5, warnings: [], missing: ['Room to the next HTF resistance of 3R or more'], ctx: { btcAtRes: false } };
const on = () => 1, off = () => -1;
ok('gates: a clean, regime-aligned 4h long passes; the rest of the week of rules reject', () => {
  assert.strictEqual(Gates.evaluate(base, on, []).pass, true);
  assert.deepStrictEqual(Gates.evaluate(base, on, []).soft, []);
  const bad = (patch, re) => { const g = Gates.evaluate({ ...base, ...patch }, on, []); assert.strictEqual(g.pass, false, JSON.stringify(patch)); assert.ok(g.hard.some((h) => re.test(h)), g.hard.join(' | ')); };
  bad({ tf: '1h' }, /4h and daily only/);
  bad({ dir: 'short' }, /against the BTC regime \(risk-on\)/);
  bad({ missing: ['A+ requires a bullish daily bias, 2R+ room'] }, /daily bias is not bullish/);
  bad({ warnings: ['Pre-pump context: daily MA100 descending above price (daily MAs = resistance)'] }, /pre-pump/);
  bad({ warnings: ['4h highs shrinking: momentum waning'] }, /highs shrinking/);
  bad({ warnings: ['Daily stoch RSI maxed (stop-milking signal)', 'Only 2 touches: a weaker trend line'] }, /2 warnings/);
  bad({ stopPct: 0.8 }, /under 1%/);
  bad({ ctx: { btcAtRes: true } }, /BTC at HTF resistance/);
  bad({ setup: 'RG' }, /regime trade/);
  assert.strictEqual(Gates.evaluate({ ...base, S: 'BTC', ctx: { btcAtRes: true } }, on, []).pass, true, 'BTC itself is not an alt long');
  assert.strictEqual(Gates.evaluate({ ...base, dir: 'short', missing: [] }, off, []).pass, true, 'a short passes in risk-off');
  assert.strictEqual(Gates.evaluate({ ...base, dir: 'short', missing: ['A+ requires a bearish daily bias'] }, off, []).pass, false);
  assert.strictEqual(Gates.evaluate(base, () => 0, []).pass, false, 'no regime known → no pass');
});
ok('gates: soft warnings (stop under 2%, weekend, dead hour) do not reject', () => {
  const g = Gates.evaluate({ ...base, stopPct: 1.5, t: Date.parse('2026-03-07T22:30:00Z') }, on, []);
  assert.strictEqual(g.pass, true); assert.ok(g.soft.some((s) => /under 2%/.test(s)) && g.soft.some((s) => /weekend/.test(s)) && g.soft.some((s) => /dead hour/.test(s)));
});
ok('gates: D4@1d within 72 h after a D4@1h on the same coin and direction is the §5d bad stack', () => {
  const d1 = { ...base, setup: 'D4', tf: '1d' }; const p = { S: 'SOL', dir: 'long', setup: 'D4', tf: '1h', t: d1.t - 20 * 3600e3 };
  assert.strictEqual(Gates.evaluate(d1, on, [p]).pass, false); assert.strictEqual(Gates.evaluate(d1, on, [{ ...p, t: d1.t - 80 * 3600e3 }]).pass, true); assert.strictEqual(Gates.evaluate(d1, on, [{ ...p, S: 'ETH' }]).pass, true);
});
ok('stats: win rate, average R and profit factor', () => {
  const s = Gates.stats([{ ev: { done: true, R: 2 } }, { ev: { done: true, R: -1 } }, { ev: { done: true, R: -0.5 } }, { ev: { done: false, R: null } }]);
  assert.deepStrictEqual(s, { n: 4, closed: 3, winRate: 0.333, avgR: 0.167, totalR: 0.5, pf: 1.33 });
});
ok('the repo data is readable and the latest day has 4h/1d signals the gates can evaluate', () => {
  const idx = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'index.json'), 'utf8')); assert.ok(idx.months.length);
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', `signals-${idx.months[idx.months.length - 1]}.json`), 'utf8')).signals;
  const s = m.find((x) => ['4h', '1d'].includes(x.tf) && x.setup !== 'RG'); assert.ok(s && Array.isArray(s.warnings) && Array.isArray(s.missing) && Number.isFinite(s.stopPct) && s.ctx);
  const g = Gates.evaluate(s, () => 1, []); assert.ok(typeof g.pass === 'boolean' && Array.isArray(g.hard));
});
console.log(process.exitCode ? 'FAILED' : `all ${n} checks passed`);
