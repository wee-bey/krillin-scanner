#!/usr/bin/env node
/* mayne v1.2 · research replay (TEST_PLAN.md). Separate from Krillin and from the v1.1 replay (mayne/tools/replay.js,
   untouched). Same universe and data plumbing as v1.1; on top of it:
   • every candidate rule of TEST_PLAN §6 as an engine variant (mayne/v1.2/lib/engine.js), plus the D3 gate ablations;
   • the v1.2 execution model (maker/taker fees, trade-through limit fills, funding from the Binance archive);
   • diagnostics on the baseline: excursions (D1), random-entry baselines (D2), same-candle counts (D6);
   • a period filter, so a DECIDE run never writes a CONFIRM-period trade (TEST_PLAN §2).
   Output: one gzip JSON per shard (merged by research-merge.js).

   Usage: node mayne/v1.2/tools/research.js --arm-from 2021-01-01 --arm-to 2023-12-31 [--shard 0 --of 8]
            [--variants B0,C1,...] [--profiles P1,P2] [--out /tmp/res] [--cache .mcache] [--sample DIR] [--syms A,B]
            [--set k=v,k=v]   (extra engine settings for every variant, e.g. for the final configuration) */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const M = require('../lib/engine.js');
const { makeStore, toCols, baseOf, pool, ymd, dayStart, DAY } = require('../../tools/candles.js');
const { makeFunding, fundingR } = require('./funding.js');

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => { if (x.startsWith('--')) a.push([x.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]); return a; }, []));
const ROOT = path.resolve(__dirname, '..', '..', '..');
const OUT = path.resolve(args.out || '/tmp/mayne-v12-research');
const CACHE = path.resolve(ROOT, args.cache || '.mcache');
const SAMPLE = args.sample ? path.resolve(args.sample) : null;
const UNI_FROM = '2021-01-01';                                       // universe / regime start (= v1.1)
const ARM_FROM = dayStart(args['arm-from'] || '2021-01-01'), ARM_TO = dayStart(args['arm-to'] || '2099-12-31') + DAY; // counted setups: tArm in [from, to]
const PROFILES = String(args.profiles || 'P1,P2').split(',');
const SHARD = +(args.shard || 0), OF = +(args.of || 1);
const UNIVERSE_N = 100, WARM_DAYS = 92;
const REGIME = { lookback: 60, band: 10 };
const MAJORS = new Set(['BTC', 'ETH', 'SOL', 'HYPE']);
// execution models (TEST_PLAN §3)
const X11 = { maker: 0.065, taker: 0.065 };                          // v1.1: 0.05% fee + 0.015% slippage per side, everything
const X12 = { maker: 0.02, taker: 0.08 };                            // v1.2: maker 0.02%; taker 0.05% + 0.03% slippage
const THRU = 0.02;                                                   // limit fills trade through by 0.02% of price
const EXTRA = {}; if (args.set) for (const kv of String(args.set).split(',')) { const [k, v] = kv.split('='); EXTRA[k] = v === 'true' ? true : v === 'false' ? false : isNaN(+v) || v === '' ? v : +v; }

// ───────────────────────── variants (TEST_PLAN §6, §5 D3) ─────────────────────────
const VARIANTS = {
  B0touch: { fillThruPct: 0 },                                       // B0 with touch fills (for the v1.1 cost comparison)
  B0: {},
  C1: { sweepDef: 'v12' }, C1b: { sweepDef: 'v12', reqSweep: true },
  C1c: { sweepDef: 'ltf', reqSweep: true }, C1d: { sweepDef: 'zone', reqSweep: true },   // TEST_PLAN addendum 1
  C2a: { gate: 'btc' }, C2b: { gate: 'rs' }, C2c: { gate: 'btc+rs' },
  C3: { rrAfterCost: true }, C3b: { rrAfterCost: true, costCap: 0.10 },
  C5: { entryMode: 'react' }, C6: { reqExtSweep: true }, C7: { maxTagN: 2 }, C7b: { mOTE: true },
  C8a: { runnerTo: 'pt' }, C8b12: { timeStopN: 12 }, C8b24: { timeStopN: 24 }, C8b48: { timeStopN: 48 },
  C9a: { session: '08-21' }, C9b: { noWeekend: true }, C10: { entryMode: 'ladder' },
  'A-noD2': { abl: 'noD2' }, 'A-noTurn': { abl: 'noTurn' }, 'A-noDsync': { abl: 'noDsync' }, 'A-noRR': { abl: 'noRR' },
};
// custom variants (e.g. the combinations of TEST_PLAN §7.3): --custom '{"F2":{"gate":"btc","maxTagN":2}}'
if (args.custom) Object.assign(VARIANTS, JSON.parse(String(args.custom)));
const VLIST = args.variants ? String(args.variants).split(',') : Object.keys(VARIANTS);
for (const v of VLIST) if (!VARIANTS[v]) throw new Error('unknown variant ' + v);

const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}] ` + a.join(' '));
const r4 = (x) => (Number.isFinite(x) ? Math.round(x * 1e4) / 1e4 : null);
const sig = (x) => (Number.isFinite(x) ? +x.toPrecision(7) : null);
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
function hash(str) { let x = 2166136261; for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 16777619) >>> 0; } return x; }

// ───────────────────────── data access (online = the v1.1 archive store; offline = an exported sample) ─────────────────────────
function makeData() {
  if (!SAMPLE) {
    const store = makeStore({ cache: CACHE, log }); const fund = makeFunding({ cache: CACHE });
    return { latestDay: () => store.latestDay(), listSymbols: () => store.listSymbols(), daily: (s, a, b, ld) => store.loadRows(s, '1d', a, b, ld), m15: (s, a, b, ld) => store.loadRows(s, '15m', a, b, ld), funding: (s, a, b) => fund.load(s, a, b), net: () => store.netCount() + fund.netCount() };
  }
  const rd = (f, d) => { try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString('utf8')); } catch (e) { return d; } };
  const meta = JSON.parse(fs.readFileSync(path.join(SAMPLE, 'meta.json'), 'utf8'));
  const cut = (rows, a, b) => rows.filter((r) => r[0] >= a && r[0] < b);
  return {
    latestDay: async () => meta.lastDay, listSymbols: async () => fs.readdirSync(path.join(SAMPLE, 'daily')).map((f) => f.replace('.json.gz', '')),
    daily: async (s, a, b) => cut(rd(path.join(SAMPLE, 'daily', s + '.json.gz'), []), a, b), m15: async (s, a, b) => cut(rd(path.join(SAMPLE, 'm15', s + '.json.gz'), []), a, b),
    funding: async (s, a, b) => { const F = rd(path.join(SAMPLE, 'funding', s + '.json.gz'), { t: [], r: [] }); const o = { t: [], r: [] }; F.t.forEach((t, i) => { if (t >= a && t < b) { o.t.push(t); o.r.push(F.r[i]); } }); return o; },
    net: () => 0, sampleSyms: new Set(meta.sample),
  };
}

// ───────────────────────── execution model: net R of one engine trade ─────────────────────────
// entries / exits from the engine; gaps through limit entries and stops fill at the open; targets fill at their level.
function execR(tr, X, F) {
  if (!Number.isFinite(tr.tFill) || tr.st !== 'closed') return null;
  const long = tr.dir === 'long', sgn = long ? 1 : -1;
  const ents = (tr.entries && tr.entries.length ? tr.entries : [{ px: tr.en, frac: 1, open: tr.fillOpen }]).map((x) => ({ px: x.mkt || !Number.isFinite(x.open) ? x.px : long ? Math.min(x.px, x.open) : Math.max(x.px, x.open), f: x.frac, mkt: !!x.mkt }));
  let q = 0, pe = 0, cost = 0; for (const x of ents) { q += x.f; pe += x.f * x.px; cost += x.f * x.px * (x.mkt ? X.taker : X.maker) / 100; }
  const e = pe / q; let gross = 0; const segs = []; let open = q; const ex = tr.exits.slice().sort((a, b) => a.t - b.t);
  for (const x of ex) {
    const stop = /stop/.test(x.why), mkt = stop || x.mkt;
    const px = stop && Number.isFinite(x.open) ? (long ? Math.min(x.px, x.open) : Math.max(x.px, x.open)) : x.px;
    gross += x.frac * sgn * (px - e); cost += x.frac * px * (mkt ? X.taker : X.maker) / 100;
    segs.push([x.t, open]); open -= x.frac;
  }
  const fR = F ? fundingR(F, sgn, e, tr.risk, tr.tFill, segs) : 0;
  return { Rg: gross / tr.risk, Rn: (gross - cost) / tr.risk + fR, fR, gap: ents.some((x, i) => !x.mkt && x.px !== (tr.entries && tr.entries[i] ? tr.entries[i].px : tr.en)) };
}

// ───────────────────────── diagnostics on the baseline (D1, D6) ─────────────────────────
function excursions(tr, T, H) {
  const f = tr.fillBar, x = tr.exitBar, long = tr.dir === 'long', e = tr.avgEn, rk = tr.risk; const n = T.t.length;
  const fav = (k) => (long ? T.h[k] - e : e - T.l[k]) / rk, adv = (k) => (long ? e - T.l[k] : T.h[k] - e) / rk;
  let mfeX = 0, maeX = 0; for (let k = f + 1; k <= x && k < n; k++) { mfeX = Math.max(mfeX, fav(k)); maeX = Math.max(maeX, adv(k)); }
  let mfeH = 0, maeH = 0; for (let k = f + 1; k <= f + H && k < n; k++) { mfeH = Math.max(mfeH, fav(k)); maeH = Math.max(maeH, adv(k)); }
  // best excursion reached before −1R (fill candle: stop first), up to 3,000 bars
  let best = 0; for (let k = f; k < n && k < f + 3000; k++) { if (adv(k) >= 1) break; if (k > f) best = Math.max(best, fav(k)); }
  // same-candle stop & target (D6): the stop bar also touched PL (before the partial) / the fill bar touched both
  let same = 0; if (x === f && tr.exits.length && /stop/.test(tr.exits[0].why) && (long ? T.h[f] >= tr.pl : T.l[f] <= tr.pl)) same = 1;
  else { const st = tr.exits.find((z) => /^stop/.test(z.why)); if (st && !tr.partDone && (long ? T.h[x] >= tr.pl : T.l[x] <= tr.pl)) same = 2; }
  return { mfeX, maeX, mfeH, maeH, best, same };
}

// ───────────────────────── random-entry baselines (D2) ─────────────────────────
// a market entry at the open of bar j, the same stop distance in ATR units, PL / FT at the same R multiples, and the
// engine's Mayne-own exit (stop first; partial at PL; runner to FT; trail to trigger-TF swings after the partial).
function pseudoTrade(T, atr, j, dir, riskAtr, plR, ftR, P) {
  const n = T.t.length; const { o, h, l, c } = T; const A0 = atr[j - 1]; if (!(A0 > 0)) return null;
  const en = o[j], risk = riskAtr * A0; if (!(risk > 0)) return null;
  let sl = en - dir * risk; const pl = en + dir * plR * risk, ft = en + dir * ftR * risk; const pf = P.partPct / 100; const thru = THRU / 100;
  const hitT = (px, k) => (dir === 1 ? h[k] >= px * (1 + thru) : l[k] <= px * (1 - thru));
  let partDone = false, partBar = -1; const exits = [];
  for (let k = j; k < n && k < j + 3000; k++) {
    const stopHit = dir === 1 ? l[k] <= sl : h[k] >= sl;
    if (stopHit) { exits.push([partDone ? 1 - pf : 1, dir === 1 ? Math.min(sl, o[k]) : Math.max(sl, o[k]), true]); break; }
    if (k === j) continue;
    if (!partDone && hitT(pl, k)) { partDone = true; partBar = k; exits.push([pf, pl, false]); }
    if (hitT(ft, k)) { exits.push([partDone ? 1 - pf : 1, ft, false]); break; }
    if (partDone && k - 1 > partBar && k >= 2) {
      const buf = P.slBufM * atr[k];
      if (dir === 1 && l[k - 1] < l[k - 2] && l[k - 1] < l[k] && l[k - 1] - buf > sl) sl = l[k - 1] - buf;
      if (dir === -1 && h[k - 1] > h[k - 2] && h[k - 1] > h[k] && h[k - 1] + buf < sl) sl = h[k - 1] + buf;
    }
    if (k === n - 1 || k === j + 2999) { exits.push([partDone ? 1 - pf : 1, c[k], true]); }
  }
  if (!exits.length) return null;
  let g = 0, cost = en * X12.taker / 100; for (const [f, px, mkt] of exits) { g += f * dir * (px - en); cost += f * px * (mkt ? X12.taker : X12.maker) / 100; }
  return { Rg: g / risk, Rn: (g - cost) / risk };
}

// ───────────────────────── BTC context (C2) ─────────────────────────
function btcContext(D1) {
  const P = M.DEFAULTS; const W = M.aggregate(D1, DAY, '1w', true);
  const wS = M.htfEngine(W, 7 * DAY, P, false, false), dS = M.htfEngine(D1, DAY, P, false, false);
  const lastClosed = (C, ms, T) => { let lo = 0, hi = C.t.length - 1, r = -1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (C.t[mid] + ms <= T) { r = mid; lo = mid + 1; } else hi = mid - 1; } return r; };
  return {
    bias(T) { // BTC's own S1/S2 at time T: +1 / −1 when the weekly is clear and the daily synced, else 0
      const kw = lastClosed(W, 7 * DAY, T), kd = lastClosed(D1, DAY, T); if (kw < 0 || kd < 0) return 0;
      const w = wS[kw].st, d = dS[kd].st; const b = w === 1 ? 1 : w === -1 ? -1 : 0;
      const sync = b === 1 ? d === 1 || d === -2 : b === -1 ? d === -1 || d === 2 : false; return b !== 0 && sync ? b : 0;
    },
    ret30(T) { const k = lastClosed(D1, DAY, T); return k >= 30 ? D1.c[k] / D1.c[k - 30] - 1 : NaN; },
    lastClosed,
  };
}

// ───────────────────────── main ─────────────────────────
async function main() {
  const t0 = Date.now(); const data = makeData();
  const lastDay = await data.latestDay(); const endMs = dayStart(lastDay) + DAY; const fromMs = dayStart(UNI_FROM);
  log(`archive through ${lastDay}; counted setups armed ${ymd(ARM_FROM)} → ${ymd(ARM_TO - DAY)}; shard ${SHARD}/${OF}; variants ${VLIST.join(',')}`);
  let syms = await data.listSymbols(); log(`${syms.length} symbols`);
  const daily = new Map();
  await pool(syms, 16, async (s) => { const rows = await data.daily(s, Date.UTC(2019, 0, 1), endMs, lastDay); if (rows.length) daily.set(s, rows); });
  log(`daily candles for ${daily.size} symbols (${data.net()} downloads)`);
  // daily top-100 universe (identical to the v1.1 replay)
  const qv = new Map(); for (const [s, rows] of daily) for (const r of rows) { const d = ymd(r[0]); if (!qv.has(d)) qv.set(d, []); qv.get(d).push([s, r[5]]); }
  const member = new Map();
  for (let d = fromMs; d < endMs; d += DAY) {
    const day = ymd(d), prev = ymd(d - DAY); const ranked = (qv.get(prev) || []).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]);
    const seen = new Set(); const list = [];
    for (const [s] of ranked) { const { base } = baseOf(s); if (seen.has(base)) continue; seen.add(base); list.push(s); if (list.length >= UNIVERSE_N) break; }
    if (!list.includes('BTCUSDT') && daily.has('BTCUSDT')) list.unshift('BTCUSDT');
    list.forEach((s, i) => { if (!member.has(s)) member.set(s, new Map()); member.get(s).set(day, i + 1); });
  }
  let cands = [...member.keys()].sort((a, b) => (a === 'BTCUSDT' ? -1 : b === 'BTCUSDT' ? 1 : a < b ? -1 : 1));
  if (SAMPLE) cands = cands.filter((s) => data.sampleSyms.has(s));
  if (args.syms) { const want = new Set(String(args.syms).split(',')); cands = cands.filter((s) => want.has(s)); }
  const mine = cands.filter((_, i) => i % OF === SHARD);
  log(`${cands.length} coins ever in the top ${UNIVERSE_N}; this shard runs ${mine.length}`);
  // regime per day and BTC context
  const regime = {}; const btcRows = daily.get('BTCUSDT') || [];
  for (let i = REGIME.lookback; i < btcRows.length; i++) { const chg = (btcRows[i][4] / btcRows[i - REGIME.lookback][4] - 1) * 100; regime[ymd(btcRows[i][0] + DAY)] = chg >= REGIME.band ? 'bull' : chg <= -REGIME.band ? 'bear' : 'chop'; }
  const BTC = btcContext(toCols(btcRows));

  const COLS = ['v', 'sym', 'prof', 'dir', 'tArm', 'tFill', 'tExit', 'st', 'how', 'grade', 'cont', 'zone', 'slWhy', 'en', 'sl0', 'pl', 'pt', 'ft', 'rr', 'riskAtr', 'riskPct', 'R', 'Rg', 'Rn', 'Rn11', 'fR', 'rank', 'reg', 'swV11', 'swHtf', 'swZone', 'swLtf', 'extSw', 'tagN', 'sameBar', 'ote', 'stacked', 'aligned', 'nBoost', 'btc', 'rs30', 'hr', 'dow', 'part', 'att', 'mkt', 'qty'];
  const DCOLS = ['sym', 'prof', 'tArm', 'mfeX', 'maeX', 'mfeH', 'maeH', 'best', 'same'];
  const PCOLS = ['prof', 'kind', 'dir', 'tArm', 'Rg', 'Rn', 'realRg'];
  const rows = [], drows = [], prows = []; let done = 0;
  const W = { P1: 72, P2: 96 };
  await pool(mine, SAMPLE ? 2 : 4, async (sym) => {
    const mem = member.get(sym); const days = [...mem.keys()].sort(); const D1rows = daily.get(sym);
    const from15 = Math.max(dayStart(days[0]) - WARM_DAYS * DAY, D1rows[0][0]);
    const rows15 = await data.m15(sym, from15, endMs, lastDay);
    if (rows15.length < 2000) { done++; return; }
    const F = await data.funding(sym, from15, endMs);
    const T15 = toCols(rows15); const D1 = toCols(D1rows);
    const Wk = M.aggregate(D1, DAY, '1w', true), H1 = M.aggregate(T15, 9e5, '1h', true), H4 = M.aggregate(T15, 9e5, '4h', true), H12 = M.aggregate(T15, 9e5, '12h', true);
    const isBTC = sym === 'BTCUSDT';
    const gates = {
      btc: (x) => (isBTC || BTC.bias(x.time) === x.dir ? '' : 'BTC disagrees'),
      rs: (x) => { if (isBTC) return ''; const k = BTC.lastClosed(D1, DAY, x.time); if (k < 30) return 'no RS history'; const rs = D1.c[k] / D1.c[k - 30] - 1 - BTC.ret30(x.time); return (x.dir === 1 ? rs > 0 : rs < 0) ? '' : 'relative strength against'; },
    };
    gates['btc+rs'] = (x) => gates.btc(x) || gates.rs(x);
    for (const prof of PROFILES) {
      const dat = prof === 'P1' ? { W: Wk, D: D1, Z: H12, CF: H4, T: H1 } : { W: Wk, D: D1, Z: H4, CF: H1, T: T15 };
      const prep = M.prepare(dat, { profile: prof, sym });
      const T = dat.T;
      const keep = (tr) => tr.tArm >= ARM_FROM && tr.tArm < ARM_TO && mem.has(ymd(tr.tArm));
      for (const v of VLIST) {
        if (VARIANTS[v].only && !VARIANTS[v].only.includes(prof)) continue;      // a variant meant for one profile only
        const spec = Object.assign({ fillThruPct: THRU }, VARIANTS[v] || {}, EXTRA); delete spec.only;
        const o = Object.assign({}, spec); if (typeof o.gate === 'string') o.gate = gates[o.gate]; if (o.gate === undefined) delete o.gate;
        const res = M.simulate(prep, o);
        for (const tr of res.trades) {
          if (!keep(tr)) continue;
          const day = ymd(tr.tArm); const ex12 = execR(tr, X12, F), ex11 = execR(tr, X11, null);
          const kd = BTC.lastClosed(D1, DAY, tr.tArm); const rs = kd >= 30 ? D1.c[kd] / D1.c[kd - 30] - 1 - BTC.ret30(tr.tArm) : NaN;
          const tc = tr.tArm + M.TF_MS[M.PROFILES[prof].trig];
          rows.push([v, sym, prof, tr.dir === 'long' ? 1 : -1, tr.tArm, Number.isFinite(tr.tFill) ? tr.tFill : null, Number.isFinite(tr.tExit) ? tr.tExit : null, tr.st, tr.how, tr.grade, tr.cont ? 1 : 0,
            `${tr.zoneTf} ${tr.zoneKind}`, tr.slWhy, sig(tr.en), sig(tr.sl0), sig(tr.pl), sig(tr.pt), sig(tr.ft), r4(tr.rr), r4(tr.riskAtr), r4(tr.risk / tr.en * 100), r4(tr.R),
            ex12 ? r4(ex12.Rg) : null, ex12 ? r4(ex12.Rn) : null, ex11 ? r4(ex11.Rn) : null, ex12 ? r4(ex12.fR) : null, mem.get(day), regime[day] || null,
            tr.swV11 ? 1 : 0, tr.swHtf ? 1 : 0, tr.swZone ? 1 : 0, tr.swLtf ? 1 : 0, tr.extSw ? 1 : 0, tr.tagN, tr.sameBar ? 1 : 0, tr.ote ? 1 : 0, tr.stacked ? 1 : 0, tr.aligned ? 1 : 0, tr.boost.length,
            isBTC ? tr.dir === 'long' ? 1 : -1 : BTC.bias(tr.tArm), r4(rs), new Date(tc).getUTCHours(), new Date(tr.tArm).getUTCDay(), tr.partDone ? 1 : 0, tr.att, tr.mkt ? 1 : 0, r4(tr.qty)]);
          if (v === 'B0' && tr.st === 'closed' && Number.isFinite(tr.fillBar)) {
            const e = excursions(tr, T, W[prof]); drows.push([sym, prof, tr.tArm, r4(e.mfeX), r4(e.maeX), r4(e.mfeH), r4(e.maeH), r4(e.best), e.same]);
            // D2 random-entry baselines: 5 bias-only + 5 no-bias pseudo-trades per filled trade
            const plR = Math.abs(tr.pl - tr.en) / tr.risk, ftR = Math.abs(tr.ft - tr.en) / tr.risk, dir = tr.dir === 'long' ? 1 : -1;
            const R = rng(hash(tr.id)); const f = tr.fillBar; const lo = Math.max(2, f - Math.round(30 * DAY / M.TF_MS[M.PROFILES[prof].trig])), hi = Math.min(T.t.length - 2, f + Math.round(30 * DAY / M.TF_MS[M.PROFILES[prof].trig]));
            const bdir = (j) => { const w = prep.iW[j] >= 0 ? prep.wS[prep.iW[j]] : null, d = prep.iD[j] >= 0 ? prep.dS[prep.iD[j]] : null; if (!w || !d) return 0; const b = w.st === 1 ? 1 : w.st === -1 ? -1 : 0; const s = b === 1 ? d.st === 1 || d.st === -2 : b === -1 ? d.st === -1 || d.st === 2 : false; return b !== 0 && s ? b : 0; };
            for (const kind of ['bias', 'none']) {
              let got = 0;
              for (let tries = 0; got < 5 && tries < 60; tries++) {
                const j = lo + Math.floor(R() * (hi - lo + 1)); const d = kind === 'bias' ? dir : R() < 0.5 ? 1 : -1;
                if (kind === 'bias' && bdir(j) !== dir) continue;
                const p = pseudoTrade(T, prep.atrC, j, d, tr.riskAtr, plR, ftR, prep.P); if (!p) continue;
                prows.push([prof, kind, d, T.t[j], r4(p.Rg), r4(p.Rn), ex12 ? r4(ex12.Rg) : null]); got++;
              }
            }
          }
        }
      }
    }
    done++; if (done % 10 === 0 || done === mine.length) log(`${done}/${mine.length} coins · ${rows.length} rows · ${data.net()} downloads`);
  });
  fs.mkdirSync(OUT, { recursive: true });
  const out = { version: 1, engine: M.VERSION, made: new Date().toISOString(), lastDay, armFrom: ymd(ARM_FROM), armTo: ymd(ARM_TO - DAY), shard: SHARD, of: OF, variants: VLIST, specs: Object.fromEntries(VLIST.map((v) => [v, VARIANTS[v]])), extra: EXTRA, exec: { X11, X12, THRU }, coins: mine.length, cols: COLS, rows, dcols: DCOLS, drows, pcols: PCOLS, prows };
  fs.writeFileSync(path.join(OUT, `shard-${SHARD}.json.gz`), zlib.gzipSync(JSON.stringify(out)));
  log(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s · ${rows.length} rows · ${drows.length} diag · ${prows.length} pseudo`);
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { execR, pseudoTrade, excursions };
