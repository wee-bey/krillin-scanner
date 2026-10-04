#!/usr/bin/env node
/* Research only (not part of the scanner or the replay): re-simulates every logged signal under
   different ENTRY, STOP and TARGET rules, on the same 15m Binance archive candles and the same
   fill rules as tools/replay.js (stop checked first; a fill and a target in one candle takes no profit;
   20-candle entry window; 100-candle time stop; fees 0.05%/side + 0.03% slippage).

   Every variant is sized for the same risk: R = PnL / (full size × distance from the variant's planned
   average entry to the variant's stop). Output: research/out/ (variant list, signal ids, Int16 R×1000).
   Usage: node research/variants.js [--cache .cache] [--limit N]
*/
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const ROOT = path.resolve(__dirname, '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => { if (x.startsWith('--')) a.push([x.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]); return a; }, []));
const CACHE = path.resolve(ROOT, args.cache || '.cache');
const OUTD = path.join(ROOT, 'research', 'out');
const ARCHIVE = 'https://data.binance.vision/data/futures/um';
const TF_MS = { '15m': 9e5, '1h': 3.6e6, '4h': 1.44e7, '12h': 4.32e7, '1d': 8.64e7 };
const FEE_SIDE = (0.05 + 0.03 / 2) / 100, ENTRY_WINDOW = 20, TIME_STOP = 100, DAY = 864e5;
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
const writeJSON = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v)); };
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchBuf(url, tries = 4) { let last; for (let a = 0; a < tries; a++) { try { const r = await fetch(url); if (r.status === 404 || r.status === 403) return null; if (!r.ok) throw new Error('HTTP ' + r.status); return Buffer.from(await r.arrayBuffer()); } catch (e) { last = e; await sleep(500 * (a + 1)); } } throw new Error(`fetch failed ${url}: ${last && last.message}`); }
function unzipFirst(buf) { let e = -1; for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { e = i; break; } const cd = buf.readUInt32LE(e + 16); const method = buf.readUInt16LE(cd + 10), cs = buf.readUInt32LE(cd + 20), lho = buf.readUInt32LE(cd + 42); const st = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28); const d = buf.subarray(st, st + cs); return method === 0 ? d : zlib.inflateRawSync(d); }
function parseKlines(text) { const rows = []; for (const line of text.split('\n')) { if (!line || !(line.charCodeAt(0) >= 48 && line.charCodeAt(0) <= 57)) continue; const f = line.split(','); let t = +f[0]; if (t > 1e14) t = Math.floor(t / 1000); rows.push([t, +f[1], +f[2], +f[3], +f[4]]); } return rows; }
let net = 0;
async function getMonth(sym, m, lastDay) { // same cache layout as tools/replay.js (.cache/k/15m/SYM/YYYY-MM.json)
  const f = path.join(CACHE, 'k', '15m', sym, m + '.json'); let c = readJSON(f, null);
  const monthEnd = ymd(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)); const needTo = monthEnd < lastDay ? monthEnd : lastDay;
  if (c && (c.complete || c.absent || c.to >= needTo)) return c.rows || [];
  if (m < lastDay.slice(0, 7) && !(c && c.to)) { net++; const buf = await fetchBuf(`${ARCHIVE}/monthly/klines/${sym}/15m/${sym}-15m-${m}.zip`); if (buf) { c = { rows: parseKlines(unzipFirst(buf).toString('utf8')), complete: true }; writeJSON(f, c); return c.rows; } }
  if (!c) c = { rows: [], to: null };
  for (let d = c.to ? Date.parse(c.to + 'T00:00:00Z') + DAY : Date.parse(m + '-01T00:00:00Z'); ymd(d) <= needTo; d += DAY) { net++; const buf = await fetchBuf(`${ARCHIVE}/daily/klines/${sym}/15m/${sym}-15m-${ymd(d)}.zip`); if (buf) c.rows.push(...parseKlines(unzipFirst(buf).toString('utf8'))); }
  c.rows.sort((a, b) => a[0] - b[0]); c.to = needTo; writeJSON(f, c); return c.rows;
}
async function series(sym, from, to, lastDay) {
  const ms = []; for (let d = new Date(from); ; ) { const s = d.toISOString().slice(0, 7); ms.push(s); if (s >= ymd(to).slice(0, 7)) break; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)); }
  const rows = [].concat(...(await Promise.all(ms.map((m) => getMonth(sym, m, lastDay))))).filter((r) => r[0] >= from && r[0] < to);
  const n = rows.length, S = { t: new Float64Array(n), o: new Float64Array(n), h: new Float64Array(n), l: new Float64Array(n), c: new Float64Array(n) }; let k = 0;
  for (const r of rows) { if (k && r[0] <= S.t[k - 1]) continue; S.t[k] = r[0]; S.o[k] = r[1]; S.h[k] = r[2]; S.l[k] = r[3]; S.c[k] = r[4]; k++; }
  for (const x of 'tohlc') S[x] = S[x].subarray(0, k); return S;
}
function firstAfter(S, t) { let lo = 0, hi = S.t.length; while (lo < hi) { const m = (lo + hi) >> 1; if (S.t[m] + 9e5 <= t) lo = m + 1; else hi = m; } return lo; } // first candle not closed at t

// ───────── variants ─────────
const ENTRIES = ['ladder', 'equal', 'market', 'top', 'deep'];
const STOPS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const TPS = ['ladder', 'ladderBE', 'tp1', 'tp2', 'tpLast', 'r1', 'r1.5', 'r2', 'r3'];
const VARIANTS = []; for (const e of ENTRIES) for (const m of STOPS) for (const x of TPS) VARIANTS.push({ e, m, x });

// returns R (per unit risk) or null when no trade happened
function sim(sig, S, i0, until, v) {
  const long = sig.dir === 'long', sg = long ? 1 : -1, tfMs = TF_MS[sig.tf] || TF_MS['1h'];
  let bids;
  if (v.e === 'ladder') bids = sig.bids.map((p, i) => ({ p, q: sig.w[i] }));
  else if (v.e === 'equal') bids = sig.bids.map((p) => ({ p, q: 1 / sig.bids.length }));
  else if (v.e === 'market') bids = [{ p: sig.px, q: 1, mkt: true }];
  else if (v.e === 'top') bids = [{ p: sig.bids[0], q: 1 }];
  else { const b = sig.bids.slice(-2); bids = b.map((p) => ({ p, q: 1 / b.length })); }
  const ref = bids.reduce((a, b) => a + b.p * b.q, 0); // the variant's planned average entry
  const stop = sig.avg - v.m * (sig.avg - sig.stop);   // stop moved away from / towards the plan's average entry
  const Rd = sg * (ref - stop); if (!(Rd > 0)) return null;
  let tps;
  if (v.x === 'ladder' || v.x === 'ladderBE') tps = sig.tps.map((t) => t[0]);
  else if (v.x === 'tp1') tps = sig.tps.slice(0, 1).map((t) => t[0]);
  else if (v.x === 'tp2') tps = sig.tps.slice(0, 2).slice(-1).map((t) => t[0]);
  else if (v.x === 'tpLast') tps = sig.tps.slice(-1).map((t) => t[0]);
  else tps = [ref + sg * parseFloat(v.x.slice(1)) * Rd];
  tps = tps.filter((p) => sg * (p - ref) > 0);
  const hit = tps.map(() => false); const ladder = (v.x === 'ladder' || v.x === 'ladderBE') && tps.length > 1;
  const k1 = tps.length ? (v.e === 'ladder' && v.m === 1 && sig.tps.length && sig.tps[0][0] === tps[0] ? sig.tps[0][1] : sg * (tps[0] - ref) / Rd) : 1; const f1 = 1 / (k1 + 1);
  let pos = 0, avg = 0, pnl = 0, fees = 0, stp = stop, st = 'pending', first = null;
  const fill = (b, px) => { fees += b.q * px * FEE_SIDE; avg = (avg * pos + px * b.q) / (pos + b.q); pos += b.q; b.done = true; };
  const exit = (q, px) => { q = Math.min(q, pos); fees += q * px * FEE_SIDE; pnl += sg * q * (px - avg); pos -= q; if (pos <= 1e-12) { pos = 0; st = 'closed'; } };
  for (const b of bids) if (b.mkt || (long ? b.p >= sig.px : b.p <= sig.px)) fill(b, sig.px);
  if (pos > 0) first = sig.t;
  const entryEnd = sig.t + ENTRY_WINDOW * tfMs;
  for (let i = i0; i < S.t.length; i++) {
    const t = S.t[i]; if (t + 9e5 > until) break; const o = S.o[i], h = S.h[i], l = S.l[i], c = S.c[i];
    let now = false;
    if (st !== 'closed' && t < entryEnd && !hit.some(Boolean)) for (const b of bids) if (!b.done && (long ? l <= b.p : h >= b.p)) { fill(b, long ? Math.min(b.p, o) : Math.max(b.p, o)); now = true; if (first === null) first = t; }
    if (pos > 0) st = 'open';
    const sh = long ? l <= stp : h >= stp;
    if (sh) { if (pos > 0) { exit(pos, long ? Math.min(stp, o) : Math.max(stp, o)); break; } if (st === 'pending') return null; }
    for (let k = 0; k < tps.length && pos > 0; k++) {
      if (hit[k]) continue; if (!(long ? h >= tps[k] : l <= tps[k])) break; if (now) break;
      hit[k] = true; const last = k === tps.length - 1;
      const q = !ladder || last ? pos : k === 0 ? pos * f1 : (k === 1 && tps.length >= 3 ? pos * 4 / 7 : pos);
      exit(q, tps[k]); if (k === 0 && v.x === 'ladderBE' && pos > 0) stp = avg;
    }
    if (st === 'closed') break;
    if (pos === 0 && st === 'pending') { if (tps.length && (long ? h >= tps[0] : l <= tps[0])) return null; if (t + 9e5 >= entryEnd) return null; }
    if (pos > 0 && first !== null && t + 9e5 >= first + TIME_STOP * tfMs) { exit(pos, c); break; }
  }
  if (st !== 'closed') return null; // still open: not counted
  return (pnl - fees) / Rd;
}

async function main() {
  const t0 = Date.now(); const idx = readJSON(path.join(ROOT, 'data', 'index.json'));
  const lastDay = idx.coverage.archiveThrough; const until = Date.parse(lastDay + 'T00:00:00Z') + DAY;
  let sigs = []; for (const m of idx.months) sigs.push(...readJSON(path.join(ROOT, 'data', `signals-${m}.json`)).signals);
  sigs.sort((a, b) => a.t - b.t); if (args.limit) sigs = sigs.slice(0, +args.limit);
  const N = sigs.length, V = VARIANTS.length; const out = new Int16Array(N * V).fill(-32768);
  const pos = new Map(sigs.map((s, i) => [s, i])); const bySym = new Map();
  for (const s of sigs) { if (!bySym.has(s.sym)) bySym.set(s.sym, []); bySym.get(s.sym).push(s); }
  let chk = 0, bad = 0, done = 0; const badEx = [];
  for (const [sym, list] of bySym) {
    const from = Math.min(...list.map((s) => s.t)) - DAY; const S = await series(sym, from, until, lastDay);
    for (const s of list) {
      if (!s.bids || !s.bids.length || !s.tps) continue; const i0 = firstAfter(S, s.t); const row = pos.get(s) * V;
      for (let j = 0; j < V; j++) { const r = sim(s, S, i0, until, VARIANTS[j]); if (r !== null && Number.isFinite(r)) out[row + j] = Math.max(-32000, Math.min(32000, Math.round(r * 1000))); }
      // self-check: the baseline variant must reproduce the replay's R (replay R is in $ at $50 risk)
      const jb = VARIANTS.findIndex((v) => v.e === 'ladder' && v.m === 1 && v.x === 'ladder');
      if (s.ev && s.ev.st === 'closed' && out[row + jb] !== -32768) { chk++; const units = s.size / s.avg; const mine = out[row + jb] / 1000 * Math.abs(s.avg - s.stop) * units / 50; if (Math.abs(mine - s.ev.R) > 0.02) { bad++; if (badEx.length < 10) badEx.push([s.id, s.ev.R, +mine.toFixed(3)]); } }
    }
    done += list.length; if ((done / N * 20 | 0) !== ((done - list.length) / N * 20 | 0)) console.log(`${done}/${N} signals · ${net} downloads · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  fs.mkdirSync(OUTD, { recursive: true });
  fs.writeFileSync(path.join(OUTD, 'R.i16.gz'), zlib.gzipSync(Buffer.from(out.buffer)));
  writeJSON(path.join(OUTD, 'meta.json'), { built: new Date().toISOString(), lastDay, variants: VARIANTS, ids: sigs.map((s) => s.id), check: { compared: chk, mismatched: bad, examples: badEx }, seconds: Math.round((Date.now() - t0) / 1000), downloads: net });
  console.log(`done: ${N} signals × ${V} variants in ${((Date.now() - t0) / 1000).toFixed(0)} s; baseline check ${bad}/${chk} mismatched`, JSON.stringify(badEx));
}
module.exports = { sim, VARIANTS, firstAfter };
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
