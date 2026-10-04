// Checks research/variants.js against tools/replay.js's simulate() on random synthetic 15m paths:
// the baseline variant (ladder entry, plan stop, plan TP ladder) must give the same R.
'use strict';
const fs = require('fs'), path = require('path');
const { sim, VARIANTS, firstAfter } = require('./variants.js');
const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'replay.js'), 'utf8');
const grab = (name) => { const i = src.indexOf('function ' + name + '('); let d = 0, j = src.indexOf('{', i); for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (!d) return src.slice(i, k + 1); } } };
const K = { TF_MS: { '15m': 9e5, '1h': 3.6e6, '4h': 1.44e7, '12h': 4.32e7, '1d': 8.64e7 } };
const simulate = new Function('K', 'SETTINGS', 'ENTRY_WINDOW', 'TIME_STOP', 'round', `${grab('upto')}\n${grab('simulate')}\nreturn simulate;`)(K, { account: 10000, riskPct: 0.5, feePct: 0.05, slipPct: 0.03 }, 20, 100, (x, d = 6) => Number.isFinite(x) ? +x.toPrecision(d) : null);
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const jb = VARIANTS.findIndex((v) => v.e === 'ladder' && v.m === 1 && v.x === 'ladder');
let n = 0, bad = 0, closed = 0;
for (let k = 0; k < 3000; k++) {
  const long = rnd() < 0.6, sg = long ? 1 : -1, px = 100, step = 0.4 + rnd() * 1.5;
  const bids = [0, 1, 2, 3].map((i) => px - sg * (i * step + rnd() * 0.3));
  const w = [0.1, 0.2, 0.3, 0.4]; const avg = bids.reduce((a, b, i) => a + b * w[i], 0); const stop = avg - sg * (2 + rnd() * 3);
  const Rd = Math.abs(avg - stop); const tps = [1.2 + rnd(), 2.5 + rnd(), 4 + rnd()].map((r) => [avg + sg * r * Rd, +r.toFixed(2)]);
  const t0 = 1.7e12 - (1.7e12 % 9e5); const S = { t: [], o: [], h: [], l: [], c: [] }; let p = px; const vol = 0.3 + rnd();
  for (let i = 0; i < 1500; i++) { const o = p; p = p * (1 + (rnd() - 0.5) * vol / 100 * 3); const h = Math.max(o, p) + rnd() * vol * 0.3, l = Math.min(o, p) - rnd() * vol * 0.3; S.t.push(t0 + i * 9e5); S.o.push(o); S.h.push(h); S.l.push(l); S.c.push(p); }
  const sig = { t: t0, dir: long ? 'long' : 'short', tf: ['15m', '1h', '4h'][k % 3], px, bids, w, avg, stop, tps, size: 50 / Rd * avg };
  const ev = simulate(sig, S, t0 + 1500 * 9e5);
  const F = { t: Float64Array.from(S.t), o: Float64Array.from(S.o), h: Float64Array.from(S.h), l: Float64Array.from(S.l), c: Float64Array.from(S.c) };
  const r = sim(sig, F, firstAfter(F, t0), t0 + 1500 * 9e5, VARIANTS[jb]);
  n++; if (ev.st === 'closed') { closed++; if (r === null || Math.abs(r * Rd * sig.size / sig.avg / 50 - ev.R) > 1e-3) { bad++; if (bad < 5) console.log('mismatch', ev.st, ev.R, r, ev.reason); } } else if (r !== null) { bad++; if (bad < 5) console.log('mismatch (not closed)', ev.st, r); }
  for (const v of VARIANTS) { const x = sim(sig, F, firstAfter(F, t0), t0 + 1500 * 9e5, v); if (x !== null && !Number.isFinite(x)) { bad++; console.log('non-finite', v); } }
}
console.log(`${n} paths, ${closed} closed, ${bad} mismatches`); process.exit(bad ? 1 : 0);
