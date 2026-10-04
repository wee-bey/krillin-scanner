'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const vm = require('node:vm');
const K = require('./lib/engine.js');

function analysis(n, tf) {
  const rows = Array.from({ length: n }, (_, i) => {
    const c = 100 + i * 0.2;
    return [Date.UTC(2026, 7, 1) + i * K.TF_MS[tf], c - 0.1, c + 0.2, c - 0.2, c, 1e6];
  });
  return K.analyzeTF(K.fromRows(rows), tf);
}

function checkSparseHistory(engine) {
  for (const [h, h4] of [[10, 300], [300, 10], [300, 300]]) {
    const T = { '1h': analysis(h, '1h'), '4h': analysis(h4, '4h'), '1d': analysis(300, '1d') };
    T['1d'].diag = { res: null, sup: { state: 'broken', barsSince: 1, next: 160, extreme: 160, touches: 3, span: 40, brk: 298 } };
    const lv = { price: 160, levels: [] };
    const short = engine.detectSetups(T, lv).find((s) => s.id === 'D5' && s.tf === '1d');
    assert.ok(short, 'The sparse-history fixture must generate a short setup');
    const gated = short.gates.includes("Don't short strength: 1h and 4h trends both up");
    assert.equal(gated, h === 300 && h4 === 300, 'Only known bullish trends should trigger the strength gate');
    T['1d'].range = { isRange: true, pos: 0.95, hi: 161, lo: 140, mid: 150.5, width: 21, widthPct: 15 };
    T['1d'].regime = 'range';
    assert.ok(engine.detectSetups(T, lv).some((s) => s.id === 'D1' && s.dir === 'short'));
  }
}

checkSparseHistory(K);
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const embedded = html.slice(html.indexOf('/* Krillin Scanner engine'), html.indexOf("})(typeof window !== 'undefined' ? window : globalThis);") + "})(typeof window !== 'undefined' ? window : globalThis);".length);
const browser = { window: {} };
vm.runInNewContext(embedded, browser);
checkSparseHistory(browser.window.KE);
assert.equal(embedded.trim(), fs.readFileSync(path.join(__dirname, 'lib', 'engine.js'), 'utf8').trim(), 'Browser and replay engines must stay identical');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'krillin-replay-test-'));
try {
  const out = path.join(tmp, 'data'), offline = path.join(tmp, 'candles');
  fs.mkdirSync(out); fs.mkdirSync(offline);
  const write = (p, v) => fs.writeFileSync(p, JSON.stringify(v));
  const first = Date.UTC(2026, 8, 3), day = 864e5;
  const rows = Array.from({ length: 192 }, (_, i) => [first + i * 9e5, 100, 110, 99, 105, 1e6]);
  write(path.join(offline, 'BTCUSDT_15m.json'), rows);
  write(path.join(out, 'state.json'), { version: 1, days: ['2026-08-31', '2026-09-03', '2026-09-04'], seenAll: {}, seenAlert: {} });
  write(path.join(out, 'signals-2026-08.json'), { signals: [{ id: 'older', key: 'older', t: first - 3 * day, ev: { done: true, st: 'closed', R: 1 } }] });
  write(path.join(out, 'signals-2026-09.json'), { signals: [{ id: 'open', key: 'open', t: first, sym: 'BTCUSDT', dir: 'long', tf: '1h', size: 1000, avg: 100, stop: 95, bids: [100, 100, 100, 100], w: [0.1, 0.2, 0.3, 0.4], px: 100, tps: [[105, 1], [107, 1.4], [109, 1.8]] }] });
  // A failed run checkpoints monthly files before writing index.json.
  const result = spawnSync(process.execPath, [path.join(__dirname, 'replay.js'), '--offline', offline, '--out', out, '--cache', path.join(tmp, 'cache')], { encoding: 'utf8' });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const index = JSON.parse(fs.readFileSync(path.join(out, 'index.json'), 'utf8'));
  assert.deepEqual(index.months, ['2026-08', '2026-09']);
  assert.equal(index.counts.signals, 2);
  assert.equal(index.counts.resolved, 2);
  const signals = JSON.parse(fs.readFileSync(path.join(out, 'signals-2026-09.json'), 'utf8')).signals;
  assert.equal(signals[0].ev.st, 'closed');
  assert.equal(signals[0].ev.reason, 'tp3');
  assert.ok(signals[0].ev.R > 0);
} finally {
  assert.equal(path.dirname(path.resolve(tmp)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(tmp).startsWith('krillin-replay-test-'));
  fs.rmSync(tmp, { recursive: true, force: true });
}
// BTC regime trades (setup RG): open on the first close and on flips, protective stop, no re-entry until the next flip
{
  const { regimeSignals } = require('./replay.js');
  const day = 864e5, t0 = Date.UTC(2026, 0, 1); const D = { t: [], o: [], h: [], l: [], c: [] };
  const add = (o, h, l, c) => { D.t.push(t0 + D.t.length * day); D.o.push(o); D.h.push(h); D.l.push(l); D.c.push(c); };
  for (let i = 0; i < 105; i++) { const c = 100 + 0.1 * i; add(c - 0.05, c + 0.5, c - 0.5, c); } // steady rise: above the MA100, ATR14 = 1
  add(110.4, 110.6, 99.9, 100);   // 105: wick through the long's stop, closes below the MA100 → stop, then a short at the close
  add(100, 104, 99, 101);         // 106: short holds
  add(101, 112.5, 100.5, 112);    // 107: short stopped, closes above → long at the close
  add(112, 112.5, 90, 111);       // 108: long stopped, still above the MA100 → no re-entry
  add(111.5, 112.5, 111, 112);    // 109: still above → still no trade
  add(112, 112, 99.5, 100);       // 110: flip → short
  add(100, 112.2, 99.8, 112);     // 111: flip back → short closed at the close, long opened
  const rg = regimeSignals(D, D, D.t[104] + day - 1, D.t[111] + day); // daily candles stand in for 15m ones
  assert.deepEqual(rg.map((s) => [s.dir, (s.t - t0) / day - 1, s.ev.reason]), [['long', 104, 'stop'], ['short', 105, 'stop'], ['long', 107, 'stop'], ['short', 110, 'flip'], ['long', 111, null]]);
  assert.equal(rg[0].stop, 107.4);
  assert.ok(Math.abs(rg[0].ev.R + 1.047) < 0.01, 'a full stop loses 1R plus costs: ' + rg[0].ev.R);
  assert.equal(rg[1].ev.exits[0][1], rg[1].stop, 'the short exits at its stop');
  assert.ok(Math.abs(rg[3].ev.R + 0.785) < 0.01, 'the flip exit is at the close: ' + rg[3].ev.R);
  assert.ok(rg[4].ev.st === 'open' && !rg[4].ev.done && Number.isFinite(rg[4].ev.uR));
  assert.ok(rg.every((s) => s.setup === 'RG' && s.tf === '1d' && s.sym === 'BTCUSDT' && s.tps.length === 0));
}
console.log('Replay regression checks passed');
