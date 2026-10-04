#!/usr/bin/env node
/* Krillin Scanner · signal replay and paper-trade evaluator (runs daily on GitHub Actions)

   1. Replays the dashboard's 15-minute scans for each finished UTC day. It uses Binance USDT-M perpetual candles
      from Binance's public archive (data.binance.vision). The live API is geo-blocked for GitHub's US runners;
      the archive is not.
   2. Uses the SAME engine as the dashboard (lib/engine.js) with the dashboard's scan rules: the top 100 by
      volume, BTC context first, the 15m second pass for A2/A3 candidates, RS/volume grading, and the
      notifier's 12-hour re-send rule. Every setup that turns active (no gates, a valid plan) is logged,
      at every grade.
   3. Paper-trades every signal on its own plan, on 15m candles:
      - the 4 bids (10/20/30/40%) fill as price trades through them
      - the stop stays where it is
      - Krillin's de-risk rule: sell 1/(k+1) at TP1, then 4/7 of the rest at TP2 and the rest at TP3
      - fees and slippage are charged on every fill and exit
      - when one candle touches both the stop and a target, the stop is assumed to come first
   4. Writes data/index.json and data/signals-YYYY-MM.json. The scanner's Results tab reads these.

   Usage: node tools/replay.js [--backfill 30] [--max-days 6] [--out data] [--cache .cache] [--offline DIR]
*/
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const K = require('./lib/engine.js');

// ───────────────────────── settings (mirror the dashboard defaults) ─────────────────────────
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => { if (x.startsWith('--')) a.push([x.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]); return a; }, []));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(ROOT, args.out || 'data');
const CACHE = path.resolve(ROOT, args.cache || '.cache');
const OFFLINE = args.offline ? path.resolve(args.offline) : null;
const BACKFILL_DAYS = +(args.backfill || 30);
const MAX_DAYS_PER_RUN = +(args['max-days'] || 6);
const UNIVERSE_N = 100;
const HIST = 1000;                        // candles per timeframe, as the dashboard holds
const SCAN_MS = 15 * 60e3;                // the dashboard's automatic rescan interval
const SEEN_MS = 12 * 3600e3;              // the notifier re-sends a key after 12 h
const SETTINGS = { account: 10000, riskPct: 0.5, feePct: 0.05, slipPct: 0.03 };
const ENTRY_WINDOW = 20;                  // candles of the setup's timeframe before unfilled bids are cancelled
const TIME_STOP = 100;                    // candles of the setup's timeframe after the first fill → exit at market
const ARCHIVE = 'https://data.binance.vision/data/futures/um';
const LIST_URL = 'https://s3-ap-northeast-1.amazonaws.com/data.binance.vision';
const DAY = 864e5;
const TFS = ['15m', '1h', '4h', '1d'];
const VERSION = 1;
const log = (...a) => { const s = `[${new Date().toISOString().slice(11, 19)}] ` + a.join(' '); console.log(s); runLog.push(s); };
const runLog = [];

// universe filters (same lists as the dashboard, plus Binance index / commodity contracts)
const STABLES = new Set('usdt usdc dai fdusd tusd usde usdd pyusd usds usd1 frax lusd gusd busd eurc eure rlusd usdb susd usdx usdtb usdf usdg usdp usdq crvusd gho dola mim usdy usdm usd0 ousg buidl eurt xusd bfusd usdai usdr cusd ausd'.split(' '));
const WRAPPED = new Set('wbtc weth steth wsteth weeth cbbtc cbeth reth wbeth bnsol jitosol msol lbtc solvbtc wbnb meth ezeth rseth susde tbtc btcb sweth oseth ethx wsol stsol jupsol bbsol clbtc unibtc pumpbtc fbtc enzobtc swbtc xsolvbtc lseth wrseth stkaave'.split(' '));
const NON_CRYPTO = new Set('btcdom defi football bluebird xau xag xpt xpd'.split(' '));

// ───────────────────────── small helpers ─────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
const ym = (ms) => new Date(ms).toISOString().slice(0, 7);
const dayStart = (s) => Date.parse(s + 'T00:00:00Z');
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
const writeJSON = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v)); };
async function pool(items, n, fn) { let i = 0; const out = new Array(items.length); await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } })); return out; }
const baseOf = (sym) => { const b = sym.replace(/USDT$/, ''); const m = b.match(/^(1000000|1000|1M)(.+)$/); return m ? { base: m[2], mult: m[1] === '1000' ? 1000 : 1e6 } : { base: b, mult: 1 }; };
const round = (x, d = 6) => Number.isFinite(x) ? +x.toPrecision(d) : null;

let netCount = 0;
async function fetchBuf(url, tries = 4) {
  let last;
  for (let a = 0; a < tries; a++) {
    try {
      netCount++;
      const r = await fetch(url);
      if (r.status === 404 || r.status === 403) return null; // the archive answers 404 (or 403 from S3) for files that don't exist
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) { last = e; await sleep(500 * (a + 1)); }
  }
  throw new Error(`fetch failed ${url}: ${last && last.message}`);
}
// minimal ZIP reader (the archive zips hold one CSV each)
function unzipFirst(buf) {
  let eocd = -1; for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip');
  const cd = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt32LE(cd) !== 0x02014b50) throw new Error('bad central directory');
  const method = buf.readUInt16LE(cd + 10), csize = buf.readUInt32LE(cd + 20), lho = buf.readUInt32LE(cd + 42);
  const nameLen = buf.readUInt16LE(lho + 26), extraLen = buf.readUInt16LE(lho + 28); const start = lho + 30 + nameLen + extraLen;
  const data = buf.subarray(start, start + csize);
  return method === 0 ? data : zlib.inflateRawSync(data);
}
// CSV → rows [openTime, open, high, low, close, quoteVolume] (the dashboard's row format)
function parseKlines(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line || !(line.charCodeAt(0) >= 48 && line.charCodeAt(0) <= 57)) continue; // skip the header row
    const f = line.split(','); let t = +f[0]; if (t > 1e14) t = Math.floor(t / 1000); // µs timestamps → ms
    rows.push([t, +f[1], +f[2], +f[3], +f[4], +f[7]]);
  }
  return rows;
}

// ───────────────────────── candle archive with a local cache ─────────────────────────
const monthMem = new Map(); let memRows = 0;
const memSet = (key, rows) => { if (!monthMem.has(key)) memRows += rows.length; monthMem.set(key, rows); };
const MEM_ROWS_MAX = 6e6; // ~6M candle rows (~1 GB); the long backfill would otherwise hold every month it ever read
function trimMem() { if (memRows > MEM_ROWS_MAX) { monthMem.clear(); memRows = 0; } } // called between days only; the disk cache keeps everything
function monthFile(sym, tf, m) { return path.join(CACHE, 'k', tf, sym, m + '.json'); }
async function getMonth(sym, tf, m, lastDay) { // rows of one month, up to lastDay (YYYY-MM-DD) for an unfinished month
  const key = `${sym}|${tf}|${m}`; if (monthMem.has(key)) return monthMem.get(key);
  const f = monthFile(sym, tf, m); let c = readJSON(f, null);
  const nowMonth = lastDay.slice(0, 7); const monthEnd = ymd(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0));
  const needTo = monthEnd < lastDay ? monthEnd : lastDay;
  if (c && (c.complete || c.absent || c.to >= needTo)) { memSet(key, c.rows || []); return c.rows || []; }
  if (!c) c = { rows: [], to: null };
  if (m < nowMonth && !c.to) { // a finished month: the monthly file (published in the first days of the next month)
    const buf = await fetchBuf(`${ARCHIVE}/monthly/klines/${sym}/${tf}/${sym}-${tf}-${m}.zip`);
    if (buf) { c = { rows: parseKlines(unzipFirst(buf).toString('utf8')), complete: true }; writeJSON(f, c); memSet(key, c.rows); return c.rows; }
    const prevMonth = ym(Date.UTC(+nowMonth.slice(0, 4), +nowMonth.slice(5, 7) - 2, 1));
    if (m < prevMonth) { c = { rows: [], absent: true }; writeJSON(f, c); memSet(key, []); return []; } // before the listing
  }
  // unfinished (or not yet published) month: daily files
  const days = []; for (let d = c.to ? dayStart(c.to) + DAY : dayStart(m + '-01'); ymd(d) <= needTo; d += DAY) days.push(ymd(d));
  const got = await pool(days, 6, async (d) => { const buf = await fetchBuf(`${ARCHIVE}/daily/klines/${sym}/${tf}/${sym}-${tf}-${d}.zip`); return buf ? parseKlines(unzipFirst(buf).toString('utf8')) : null; });
  for (const r of got) if (r) c.rows.push(...r);
  c.rows.sort((a, b) => a[0] - b[0]); c.to = needTo; writeJSON(f, c); memSet(key, c.rows); return c.rows;
}
function monthsBetween(fromMs, toMs) { const out = []; let y = new Date(fromMs).getUTCFullYear(), mo = new Date(fromMs).getUTCMonth(); const end = ym(toMs); for (;;) { const s = `${y}-${String(mo + 1).padStart(2, '0')}`; out.push(s); if (s >= end) break; mo++; if (mo > 11) { mo = 0; y++; } } return out; }
async function loadSeries(sym, tf, fromMs, toMs, lastDay) {
  if (OFFLINE) { const f = path.join(OFFLINE, `${sym}_${tf}.json`); const rows = readJSON(f, []); return rows.filter((r) => r[0] >= fromMs && r[0] < toMs); }
  const parts = await Promise.all(monthsBetween(fromMs, toMs).map((m) => getMonth(sym, tf, m, lastDay)));
  const rows = [].concat(...parts).filter((r) => r[0] >= fromMs && r[0] < toMs); const out = [];
  for (const r of rows) if (!out.length || r[0] > out[out.length - 1][0]) out.push(r);
  return out;
}
const toCols = (rows) => ({ t: rows.map((r) => r[0]), o: rows.map((r) => r[1]), h: rows.map((r) => r[2]), l: rows.map((r) => r[3]), c: rows.map((r) => r[4]), v: rows.map((r) => r[5]) });
function upto(S, tf, t) { // index of the last candle CLOSED at time t (open + tf <= t), −1 if none
  const ms = K.TF_MS[tf]; let lo = 0, hi = S.t.length - 1, ans = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (S.t[mid] + ms <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans;
}
function windowAt(S, tf, t, n) { const i = upto(S, tf, t); if (i < 0) return null; const a = Math.max(0, i - n + 1); return { t: S.t.slice(a, i + 1), o: S.o.slice(a, i + 1), h: S.h.slice(a, i + 1), l: S.l.slice(a, i + 1), c: S.c.slice(a, i + 1), v: S.v.slice(a, i + 1) }; }

// ───────────────────────── universe: top 100 Binance USDT-M perpetuals by the previous day's quote volume ─────────────────────────
async function listSymbols() {
  if (OFFLINE) return fs.readdirSync(OFFLINE).filter((f) => /_1d\.json$/.test(f)).map((f) => f.replace('_1d.json', ''));
  const cached = readJSON(path.join(CACHE, 'symbols.json'), null); if (cached && Date.now() - cached.t < 3 * DAY) return cached.list;
  const out = []; let marker = '';
  for (let page = 0; page < 10; page++) {
    const buf = await fetchBuf(`${LIST_URL}?delimiter=/&prefix=data/futures/um/daily/klines/${marker ? '&marker=' + encodeURIComponent(marker) : ''}`); if (!buf) break;
    const xml = buf.toString('utf8'); const pre = [...xml.matchAll(/<Prefix>data\/futures\/um\/daily\/klines\/([^/<]+)\/<\/Prefix>/g)].map((m) => m[1]);
    out.push(...pre); const nm = xml.match(/<NextMarker>([^<]+)<\/NextMarker>/); if (/<IsTruncated>true<\/IsTruncated>/.test(xml) && (nm || pre.length)) marker = nm ? nm[1] : `data/futures/um/daily/klines/${pre[pre.length - 1]}/`; else break;
  }
  if (out.length < 50) { // fallback: Binance spot USDT pairs by volume (data-api.binance.vision is reachable from US runners); the archive check drops non-perps
    log('archive listing unavailable, falling back to spot tickers');
    const buf = await fetchBuf('https://data-api.binance.vision/api/v3/ticker/24hr'); const t = buf ? JSON.parse(buf.toString('utf8')) : [];
    const top = t.filter((x) => /USDT$/.test(x.symbol)).sort((a, b) => +b.quoteVolume - +a.quoteVolume).slice(0, 250).map((x) => x.symbol);
    for (const s of top) { out.push(s); out.push('1000' + s); }
  }
  const list = out.filter((s) => /^[A-Z0-9]+USDT$/.test(s)).filter((s) => { const b = baseOf(s).base.toLowerCase(); return !STABLES.has(b) && !WRAPPED.has(b) && !NON_CRYPTO.has(b); });
  writeJSON(path.join(CACHE, 'symbols.json'), { t: Date.now(), list }); return list;
}
async function universeFor(day, lastDay) { // ranked by the quote volume of the day before
  const f = path.join(CACHE, 'universe', day + '.json'); const c = readJSON(f, null); if (c) return c;
  const prev = ymd(dayStart(day) - DAY); const syms = await listSymbols();
  const vols = await pool(syms, 12, async (s) => {
    if (OFFLINE) { const rows = readJSON(path.join(OFFLINE, `${s}_1d.json`), []); const r = rows.find((x) => ymd(x[0]) === prev); return r ? [s, r[5]] : null; }
    if (prev.slice(0, 7) < lastDay.slice(0, 7)) { // a finished month: one cached monthly 1d file per symbol (the backfill reads hundreds of days)
      const rows = await getMonth(s, '1d', prev.slice(0, 7), lastDay); const r = rows.find((x) => ymd(x[0]) === prev); return r && r[5] ? [s, r[5]] : null;
    }
    const d = readJSON(path.join(CACHE, 'd1', s, prev + '.json'), undefined); if (d !== undefined) return d ? [s, d] : null;
    const buf = await fetchBuf(`${ARCHIVE}/daily/klines/${s}/1d/${s}-1d-${prev}.zip`); const rows = buf ? parseKlines(unzipFirst(buf).toString('utf8')) : [];
    const qv = rows.length ? rows[0][5] : 0; writeJSON(path.join(CACHE, 'd1', s, prev + '.json'), qv || 0); return qv ? [s, qv] : null;
  });
  const ranked = vols.filter(Boolean).sort((a, b) => b[1] - a[1]); const seen = new Set(); const list = [];
  for (const [s, qv] of ranked) { const { base, mult } = baseOf(s); if (seen.has(base)) continue; seen.add(base); list.push({ sym: s, S: base, mult, vol: qv }); if (list.length >= UNIVERSE_N) break; }
  if (!list.find((x) => x.S === 'BTC')) { const b = ranked.find((x) => x[0] === 'BTCUSDT'); if (b) list.unshift({ sym: 'BTCUSDT', S: 'BTC', mult: 1, vol: b[1] }); }
  list.forEach((c, i) => { c.rank = i + 1; }); writeJSON(f, list); return list;
}

// ───────────────────────── one scan (the dashboard's analyzeOne / gradeCoin / rankUniverse) ─────────────────────────
function analyzeOne(c, ctx, t) {
  const T = K.analyzeCoin(c.data, t); T.live = c.live; T.liveTime = t; // closed candles only; the live price is the latest 15m close
  const lv = K.buildLevels(T, { diag: true }); c.T = T; c.lv = lv;
  const setups = K.detectSetups(T, lv, { symbol: c.S, btcAtResistance: ctx && ctx.atResistance, diag: true });
  for (const S of setups) { S.plan = K.buildPlan(S, T, lv, SETTINGS); if (S.plan && !S.plan.invalid) K.roomGate(S, S.plan); S.key = `${c.S}|${S.id}|${S.tf}|${S.dir}`; }
  c.setups = setups;
}
function scanAt(t, coins, series) {
  const list = [];
  for (const u of coins) {
    const s = series.get(u.sym); if (!s) continue; const data = {};
    for (const tf of ['1h', '4h', '1d']) { const w = s[tf] && windowAt(s[tf], tf, t, HIST); if (w && w.t.length) data[tf] = w; }
    if (!data['1h'] || !data['4h'] || !data['1d']) continue;
    const i15 = s['15m'] ? upto(s['15m'], '15m', t) : -1; const i1 = upto(s['1h'], '1h', t);
    const live = i15 >= 0 ? s['15m'].c[i15] : s['1h'].c[i1]; if (!Number.isFinite(live)) continue;
    const i7 = upto(s['1h'], '1h', t - 7 * DAY); const chg7 = i7 >= 0 ? (live / s['1h'].c[i7] - 1) * 100 : NaN;
    list.push({ ...u, data, live, chg7, s });
  }
  const btc = list.find((c) => c.S === 'BTC'); if (btc) analyzeOne(btc, null, t);
  const ctx = btc && btc.T ? K.btcContext(btc.T) : null;
  for (const c of list) if (c !== btc) analyzeOne(c, ctx, t);
  // second pass: 15m candles for A2/A3 candidates (max 20, in universe order), as the dashboard does
  const need15 = list.filter((c) => c.setups && c.setups.some((x) => (x.id === 'A3' || x.id === 'A2') && x.gates.length === 0 && x.status !== 'far')).slice(0, 20);
  for (const c of need15) { const w = c.s['15m'] && windowAt(c.s['15m'], '15m', t, HIST); if (w && w.t.length) { c.data['15m'] = w; analyzeOne(c, ctx, t); } }
  // RS percentile and grades
  const rsOf = (c) => Number.isFinite(c.chg7) && btc && Number.isFinite(btc.chg7) ? c.chg7 - btc.chg7 : NaN;
  const rs = list.map(rsOf).filter(Number.isFinite).sort((a, b) => a - b);
  for (const c of list) {
    const v = rsOf(c); c.rsPct = Number.isFinite(v) && rs.length ? 100 * rs.filter((x) => x <= v).length / rs.length : NaN;
    const g = { symbol: c.S, btc1d: ctx ? ctx.bias['1d'].label : 'n/a', btcAtRes: ctx ? ctx.atResistance : false, rsPct: c.rsPct, volRank: c.rank };
    for (const S of c.setups) { const gr = K.gradeSetup(S, c.T, c.lv, g); S.grade = gr; S.potential = gr.potential; }
    c.setups.sort((a, b) => b.potential - a.potential);
  }
  return { list, btc, ctx };
}

// ───────────────────────── paper trade (see the header for the rules) ─────────────────────────
function simulate(sig, S15, untilMs) {
  const long = sig.dir === 'long'; const sgn = long ? 1 : -1; const tfMs = K.TF_MS[sig.tf] || K.TF_MS['1h'];
  const feeSide = (SETTINGS.feePct + SETTINGS.slipPct / 2) / 100; const riskUsd = SETTINGS.account * SETTINGS.riskPct / 100;
  const units = sig.size / sig.avg; const Rd = Math.abs(sig.avg - sig.stop);
  const bids = sig.bids.map((p, i) => ({ p, q: units * sig.w[i], done: false }));
  const tps = sig.tps.map((x) => ({ p: x[0], r: x[1], hit: false }));
  const k1 = tps.length ? tps[0].r : 1; const f1 = 1 / (k1 + 1);
  let pos = 0, avg = 0, filledQ = 0, fees = 0, pnl = 0, firstFill = null, exitT = null, st = 'pending', reason = null, amb = 0, mfe = 0, mae = 0, dirHit = null, dirAmb = false, lastT = sig.t, lastC = sig.px;
  const fills = [], exits = [];
  const fill = (b, px, t) => { fees += b.q * px * feeSide; avg = (avg * pos + px * b.q) / (pos + b.q); pos += b.q; filledQ += b.q; b.done = true; fills.push([t, round(px)]); if (firstFill === null) firstFill = t; };
  const exit = (q, px, t, why) => { q = Math.min(q, pos); if (q <= 0) return; fees += q * px * feeSide; pnl += sgn * q * (px - avg); pos -= q; exits.push([t, round(px), round(q / filledQ, 3), why]); if (pos <= units * 1e-9) { pos = 0; st = 'closed'; exitT = t; reason = why; } };
  // bids at or through the market fill immediately at the signal price
  for (const b of bids) if (long ? b.p >= sig.px : b.p <= sig.px) fill(b, sig.px, sig.t);
  const i0 = upto(S15, '15m', sig.t) + 1; // the first candle that opens at (or after) the signal time
  const entryEnd = sig.t + ENTRY_WINDOW * tfMs;
  for (let i = Math.max(0, i0); i < S15.t.length; i++) {
    const t = S15.t[i]; if (t + 9e5 > untilMs) break; const o = S15.o[i], h = S15.h[i], l = S15.l[i], c = S15.c[i]; lastT = t + 9e5; lastC = c;
    // first touch of TP1 vs the stop from the signal time, regardless of fills
    if (!dirHit && tps.length) { const hs = long ? l <= sig.stop : h >= sig.stop, ht = long ? h >= tps[0].p : l <= tps[0].p; if (hs && ht) { dirHit = 'stop'; dirAmb = true; } else if (hs) dirHit = 'stop'; else if (ht) dirHit = 'tp1'; }
    // 1) fills: price trades through the resting bids (a gap fills at the open)
    let filledNow = false;
    if (st === 'pending' || st === 'open') {
      if (t < entryEnd && !tps.some((x) => x.hit)) for (const b of bids) if (!b.done && (long ? l <= b.p : h >= b.p)) { fill(b, long ? Math.min(b.p, o) : Math.max(b.p, o), t); filledNow = true; }
      if (pos > 0) st = 'open';
    }
    if (pos > 0) { mfe = Math.max(mfe, sgn * ((long ? h : l) - avg) / Rd); mae = Math.max(mae, sgn * (avg - (long ? l : h)) / Rd); }
    // 2) the stop (checked before targets: the worse case when a candle touches both)
    const stopHit = long ? l <= sig.stop : h >= sig.stop;
    if (stopHit) {
      if (pos > 0) { const nt = tps.find((x) => !x.hit); if (nt && (long ? h >= nt.p : l <= nt.p)) amb++; exit(pos, long ? Math.min(sig.stop, o) : Math.max(sig.stop, o), t, 'stop'); break; }
      if (st === 'pending') { st = 'invalidated'; exitT = t; reason = 'stop before fill'; break; }
    }
    // 3) targets
    for (let k = 0; k < tps.length && pos > 0; k++) {
      const tp = tps[k]; if (tp.hit) continue;
      if (!(long ? h >= tp.p : l <= tp.p)) break;
      if (filledNow) { amb++; break; } // filled and reached a target in the same candle: order unknown, take no profit this candle
      tp.hit = true; const q = k === 0 ? pos * f1 : (k === 1 && tps.length >= 3 ? pos * 4 / 7 : pos);
      exit(k === tps.length - 1 ? pos : q, tp.p, t, 'tp' + (k + 1));
    }
    if (st === 'closed') break;
    if (pos === 0 && st === 'pending') {
      if (tps.length && (long ? h >= tps[0].p : l <= tps[0].p)) { st = 'missed'; exitT = t; reason = 'TP1 before any fill'; break; }
      if (t + 9e5 >= entryEnd) { st = 'expired'; exitT = t + 9e5; reason = 'no fill in the entry window'; break; }
    }
    // 4) time stop
    if (pos > 0 && firstFill !== null && t + 9e5 >= firstFill + TIME_STOP * tfMs) { exit(pos, c, t + 9e5, 'time'); break; }
  }
  const upnl = pos > 0 ? sgn * pos * (lastC - avg) - pos * lastC * feeSide : 0;
  return {
    st, reason, fill: round(filledQ / units, 3), avgFill: filledQ ? round(avg) : null, tFill: firstFill, tExit: exitT,
    R: round((pnl - fees) / riskUsd, 4), uR: st === 'open' ? round((pnl - fees + upnl) / riskUsd, 4) : null,
    mfe: round(mfe, 3), mae: round(mae, 3), tp: tps.map((x) => x.hit), stopHit: reason === 'stop', amb, dirHit, dirAmb, fills, exits, upd: lastT,
    done: ['closed', 'missed', 'invalidated', 'expired'].includes(st),
  };
}

// ───────────────────────── market condition of the day (BTC as of the previous daily close) ─────────────────────────
function marketOf(s, btc, ctx, d0) {
  const D = s && s['1d']; const i = D ? upto(D, '1d', d0) : -1; if (i < 0) return null;
  const c = D.c, chg = (k) => i >= k ? round((c[i] / c[i - k] - 1) * 100, 4) : null;
  const rets = []; for (let j = Math.max(1, i - 19); j <= i; j++) rets.push(c[j] / c[j - 1] - 1);
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length; const vol20 = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length) * 100;
  const T = btc && btc.T; const reg = (tf) => T && T[tf] && !T[tf].insufficient ? T[tf].regime : null;
  return { px: round(c[i]), chg7: chg(7), chg30: chg(30), chg90: chg(90), vol20: round(vol20, 4), reg1d: reg('1d'), reg4h: reg('4h'), bias1d: ctx ? ctx.bias['1d'].label : null, bias4h: ctx ? ctx.bias['4h'].label : null, bias1w: ctx && ctx.bias['1w'] ? ctx.bias['1w'].label : null };
}

// ───────────────────────── lite.json: every signal with only what the Results tab's stats and table need ─────────────────────────
// (a year of full records is ~100 MB; the full records stay in signals-YYYY-MM.json and load only when a row is opened)
const LITE_COLS = ['t', 'S', 'sym', 'setup', 'nm', 'tf', 'dir', 'grade', 'alertedAt', 'avg', 'stop', 'tp1', 'avgTP', 'beWin', 'btc1d', 'btcAtRes', 'btcReg1d', 'st', 'R', 'uR', 'fill', 'mfe', 'mae', 'tFill', 'tExit', 'upd', 'tp', 'stopHit', 'dirHit', 'amb', 'last', 'done'];
function liteOf(all) {
  const names = [], nameIx = new Map(); const nm = (x) => { if (!nameIx.has(x)) { nameIx.set(x, names.length); names.push(x); } return nameIx.get(x); };
  const r3 = (x) => Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null;
  const rows = all.map((s) => {
    const e = s.ev || {}; const c = s.ctx || {};
    return [s.t, s.S, s.sym === s.S + 'USDT' ? 0 : s.sym, s.setup, nm(s.name || ''), s.tf, s.dir === 'long' ? 1 : 0, s.grade, s.alertedAt || 0, s.avg, s.stop, s.tps && s.tps[0] ? s.tps[0][0] : null, s.avgTP, s.beWin,
      c.btc1d || null, c.btcAtRes ? 1 : 0, c.btcReg1d || null, e.st || null, r3(e.R), r3(e.uR), r3(e.fill), r3(e.mfe), r3(e.mae), e.tFill || 0, e.tExit || 0, e.upd || 0,
      (e.tp || []).reduce((a, h, k) => a | (h ? 1 << k : 0), 0), e.stopHit ? 1 : 0, e.dirHit || null, e.amb || 0, e.exits && e.exits.length ? e.exits[e.exits.length - 1][3] : (e.reason || null), e.done ? 1 : 0];
  });
  return { version: 1, cols: LITE_COLS, names, rows };
}

// ───────────────────────── main ─────────────────────────
async function main() {
  const t0 = Date.now();
  const state = readJSON(path.join(OUT, 'state.json'), { version: VERSION, days: [], seenAll: {}, seenAlert: {} });
  // the latest day the archive has published (BTCUSDT 15m as the probe)
  let lastDay = null;
  if (OFFLINE) { const r = readJSON(path.join(OFFLINE, 'BTCUSDT_15m.json'), []); const lastFull = Math.floor((r[r.length - 1][0] + 9e5) / DAY) * DAY - DAY; lastDay = ymd(lastFull); }
  else for (let d = Math.floor(Date.now() / DAY) * DAY - DAY; d > Date.now() - 6 * DAY; d -= DAY) { const buf = await fetchBuf(`${ARCHIVE}/daily/klines/BTCUSDT/15m/BTCUSDT-15m-${ymd(d)}.zip`); if (buf) { lastDay = ymd(d); break; } }
  if (!lastDay) throw new Error('the archive has no recent daily files');
  const done = new Set(state.days);
  let start = state.days.length ? ymd(dayStart(state.days[state.days.length - 1]) + DAY) : ymd(dayStart(lastDay) - (BACKFILL_DAYS - 1) * DAY);
  if (args.from) start = args.from;
  const todo = []; for (let d = dayStart(start); ymd(d) <= lastDay && todo.length < MAX_DAYS_PER_RUN; d += DAY) if (!done.has(ymd(d))) todo.push(ymd(d));
  log(`archive through ${lastDay}; replaying ${todo.length ? todo.join(', ') : 'nothing new'}`);
  const sigFile = (m) => path.join(OUT, `signals-${m}.json`);
  const months = new Map(); const loadMonth = (m) => { if (!months.has(m)) months.set(m, readJSON(sigFile(m), { signals: [] })); return months.get(m); };
  // A failed run may checkpoint monthly files before publishing index.json.
  for (const f of fs.existsSync(OUT) ? fs.readdirSync(OUT) : []) { const m = f.match(/^signals-(\d{4}-\d{2})\.json$/); if (m) loadMonth(m[1]); }
  const allSignals = () => [].concat(...[...months.values()].map((x) => x.signals));
  const market = readJSON(path.join(OUT, 'market.json'), { days: {} });
  async function evaluate(until) {
    const open = allSignals().filter((s) => !(s.ev && s.ev.done) && s.t < until);
    const bySym = new Map(); for (const s of open) { if (!bySym.has(s.sym)) bySym.set(s.sym, []); bySym.get(s.sym).push(s); }
    await pool([...bySym.keys()], 6, async (sym) => {
      const sigs = bySym.get(sym); const from = Math.min(...sigs.map((s) => s.t)) - DAY;
      const rows = await loadSeries(sym, '15m', from, until, lastDay); if (!rows.length) { for (const s of sigs) s.ev = { st: 'nodata', done: false }; return; } const S15 = toCols(rows);
      for (const s of sigs) s.ev = simulate(s, S15, until);
    });
  }
  const lastByKey = new Map(); for (const x of allSignals().sort((a, b) => a.t - b.t)) lastByKey.set(x.key, x);
  for (const day of todo) {
    const d0 = dayStart(day), d1 = d0 + DAY; const td = Date.now();
    trimMem(); const coins = await universeFor(day, lastDay);
    // candles: enough history for 1000 closed candles on every timeframe at the day's first scan
    const series = new Map();
    await pool(coins, 6, async (u) => {
      const s = {};
      for (const tf of TFS) { const from = d0 - (HIST + 2) * K.TF_MS[tf] - (tf === '1h' ? 8 * DAY : 0); const rows = await loadSeries(u.sym, tf, from, d1, lastDay); if (rows.length) s[tf] = toCols(rows); }
      if (s['1h'] && s['4h'] && s['1d']) series.set(u.sym, s);
    });
    let n = 0;
    for (let t = d0 + SCAN_MS; t <= d1; t += SCAN_MS) {
      const { list, ctx, btc } = scanAt(t, coins, series);
      const btcReg4h = btc && btc.T && btc.T['4h'] && !btc.T['4h'].insufficient ? btc.T['4h'].regime : null;
      const btcReg1d = btc && btc.T && btc.T['1d'] && !btc.T['1d'].insufficient ? btc.T['1d'].regime : null;
      if (t === d0 + SCAN_MS) market.days[day] = marketOf(series.get('BTCUSDT'), btc, ctx, d0);
      for (const c of list) for (const S of c.setups) {
        if (S.gates.length || S.status !== 'active' || !S.plan || S.plan.invalid || S.watch) continue;
        const gr = S.grade.grade; const alertOk = ['A+', 'A'].includes(gr);
        // the notifier's 12-hour rule; a key that already has an unresolved paper trade is not a new trade
        const prevT = state.seenAll[S.key];
        if (prevT && t - prevT < SEEN_MS) { if (alertOk && !(state.seenAlert[S.key] && t - state.seenAlert[S.key] < SEEN_MS)) { state.seenAlert[S.key] = t; const prev = lastByKey.get(S.key); if (prev && !prev.alertedAt) prev.alertedAt = t; } continue; }
        const prev = lastByKey.get(S.key);
        if (prev) { const s15 = series.get(c.sym) && series.get(c.sym)['15m']; if (s15 && s15.t.length && prev.t >= s15.t[0]) { if (!simulate(prev, s15, t).done) continue; } else if (prev.ev && !prev.ev.done) continue; }
        state.seenAll[S.key] = t; if (alertOk) state.seenAlert[S.key] = t;
        const P = S.plan;
        const sig = {
          id: `${S.key}|${t}`, key: S.key, t, day, S: c.S, sym: c.sym, mult: c.mult, setup: S.id, name: S.name, fam: S.family, tf: S.tf, dir: S.dir,
          grade: gr, score: S.grade.score, pot: S.potential, alertedAt: alertOk ? t : null, px: round(c.live),
          bids: P.bids.map((b) => round(b.price)), w: P.bids.map((b) => b.weight), avg: round(P.avg), stop: round(P.stop), stopPct: round(P.stopPct, 4),
          tps: P.tps.map((x) => [round(x.price), round(x.r, 3), x.label]), avgTP: round(P.avgTP, 3), room: Number.isFinite(P.room) ? round(P.room, 3) : null, roomLabel: P.roomLabel,
          size: round(P.size, 6), beWin: round(P.beWinRate, 3), why: S.why.join(' · ').slice(0, 300), entryText: S.entryText || '', warnings: S.warnings.slice(0, 6), conf: S.confluence.length,
          missing: (S.grade.missing || []).slice(0, 3), ctx: { btc1d: ctx ? ctx.bias['1d'].label : 'n/a', btc4h: ctx ? ctx.bias['4h'].label : 'n/a', btcAtRes: ctx ? !!ctx.atResistance : false, btcReg4h, btcReg1d, rsPct: Number.isFinite(c.rsPct) ? Math.round(c.rsPct) : null, rank: c.rank },
        };
        loadMonth(ym(t)).signals.push(sig); lastByKey.set(S.key, sig); n++;
      }
      for (const k of Object.keys(state.seenAll)) if (t - state.seenAll[k] > 2 * SEEN_MS) delete state.seenAll[k];
      for (const k of Object.keys(state.seenAlert)) if (t - state.seenAlert[k] > 2 * SEEN_MS) delete state.seenAlert[k];
    }
    // evaluate the open trades up to the end of this day, as the daily run would have (the next day's
    // "no new signal while the earlier one is unresolved" rule reads these results)
    await evaluate(d1);
    state.days.push(day); state.days = [...new Set(state.days)].sort();
    log(`${day}: ${coins.length} coins, ${n} new signals, ${((Date.now() - td) / 1000).toFixed(0)} s`);
    writeJSON(path.join(OUT, 'state.json'), state); // checkpoint after each day
    writeJSON(path.join(OUT, 'market.json'), market);
    for (const [m, v] of months) writeJSON(sigFile(m), v);
  }
  // evaluate every unresolved signal up to the end of the latest archived day
  let until = dayStart(lastDay) + DAY;
  if (OFFLINE) { const r = readJSON(path.join(OFFLINE, 'BTCUSDT_15m.json'), []); until = r[r.length - 1][0] + 9e5; } // offline tests: evaluate to the end of the saved candles
  await evaluate(until);
  for (const [m, v] of months) { v.signals.sort((a, b) => a.t - b.t); writeJSON(sigFile(m), v); }
  const all = allSignals();
  const index = {
    version: VERSION, updated: new Date().toISOString(), coverage: { first: state.days[0] || null, last: state.days[state.days.length - 1] || null, archiveThrough: lastDay, evaluatedThrough: new Date(until).toISOString() },
    months: [...months.keys()].sort(), counts: { signals: all.length, resolved: all.filter((s) => s.ev && s.ev.done).length },
    rules: { universe: `top ${UNIVERSE_N} Binance USDT-M perpetuals by the previous day's quote volume (stablecoins, wrapped tokens, index and metal contracts excluded)`, scans: 'every 15 minutes on closed candles, like the dashboard', settings: SETTINGS, entryWindowCandles: ENTRY_WINDOW, timeStopCandles: TIME_STOP, management: 'sell 1/(k+1) at TP1 (k = TP1 in R), then 4/7 of the rest at TP2 and the rest at TP3; the stop never moves', sameCandle: 'stop assumed first; a fill and a target in the same candle takes no profit that candle', resend: '12 h, and never while an earlier paper trade on the same setup is unresolved' },
  };
  writeJSON(path.join(OUT, 'lite.json'), liteOf(all.slice().sort((a, b) => a.t - b.t)));
  writeJSON(path.join(OUT, 'index.json'), index);
  writeJSON(path.join(OUT, 'state.json'), state);
  writeJSON(path.join(OUT, 'market.json'), market);
  log(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s · ${netCount} downloads · ${all.length} signals (${index.counts.resolved} resolved)`);
  fs.writeFileSync(path.join(OUT, 'last_run.txt'), runLog.join('\n') + '\n');
}
main().catch((e) => { log('FAILED: ' + (e && e.stack || e)); try { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'last_run.txt'), runLog.join('\n') + '\n'); } catch (e2) { /* ignore */ } process.exit(1); });
