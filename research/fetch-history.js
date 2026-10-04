#!/usr/bin/env node
/* Research only (runs on a research/** branch, never on main).
   Downloads long price history for strategy research from Binance's public archive (data.binance.vision):
     - daily (1d) candles for EVERY USDT-M perpetual in the archive, delisted ones included (no survivorship bias)
     - 4h candles and funding-rate history for every symbol that was ever in the daily top TOPN by quote volume
   from FROM_MONTH to the latest archived day, and writes compact gzip CSVs to research/hist/.

   Output (all times are UTC open times in ms):
     research/hist/d1.csv.gz       sym,t,o,h,l,c,qv,tbq        (qv = quote volume, tbq = taker-buy quote volume)
     research/hist/h4.csv.gz       sym,t,o,h,l,c,qv,tbq
     research/hist/funding.csv.gz  sym,t,rate                  (rate per funding interval, e.g. 0.0001 = 0.01%)
     research/hist/symbols.json    the symbol lists and coverage
     research/hist/log.txt         run log
*/
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'research', 'hist');
const ARCHIVE = 'https://data.binance.vision/data/futures/um';
const LIST_URL = 'https://s3-ap-northeast-1.amazonaws.com/data.binance.vision';
const FROM_MONTH = process.env.FROM_MONTH || '2021-06';
const TOPN = +(process.env.TOPN || 150);
const CONC = 24;
const DAY = 864e5;
const STABLES = new Set('usdt usdc dai fdusd tusd usde usdd pyusd usds usd1 frax lusd gusd busd eurc eure rlusd usdb susd usdx usdtb usdf usdg usdp usdq crvusd gho dola mim usdy usdm usd0 ousg buidl eurt xusd bfusd usdai usdr cusd ausd'.split(' '));
const WRAPPED = new Set('wbtc weth steth wsteth weeth cbbtc cbeth reth wbeth bnsol jitosol msol lbtc solvbtc wbnb meth ezeth rseth susde tbtc btcb sweth oseth ethx wsol stsol jupsol bbsol clbtc unibtc pumpbtc fbtc enzobtc swbtc xsolvbtc lseth wrseth stkaave'.split(' '));
const NON_CRYPTO = new Set('btcdom defi football bluebird xau xag xpt xpd'.split(' '));
const runLog = [];
const t0 = Date.now();
const log = (...a) => { const s = `[${((Date.now() - t0) / 1000).toFixed(0)}s] ` + a.join(' '); console.log(s); runLog.push(s); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
const baseOf = (sym) => { const b = sym.replace(/USDT$/, ''); const m = b.match(/^(1000000|1000|1M)(.+)$/); return m ? { base: m[2], mult: m[1] === '1000' ? 1000 : 1e6 } : { base: b, mult: 1 }; };
async function pool(items, n, fn) { let i = 0; const out = new Array(items.length); await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } })); return out; }
let net = 0, fails = 0;
async function fetchBuf(url, tries = 5) {
  let last;
  for (let a = 0; a < tries; a++) {
    try {
      net++;
      const r = await fetch(url);
      if (r.status === 404 || r.status === 403) return null;
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) { last = e; await sleep(700 * (a + 1)); }
  }
  fails++; log('FAILED', url, last && last.message); return null;
}
function unzipFirst(buf) {
  let eocd = -1; for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip');
  const cd = buf.readUInt32LE(eocd + 16);
  const method = buf.readUInt16LE(cd + 10), csize = buf.readUInt32LE(cd + 20), lho = buf.readUInt32LE(cd + 42);
  const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
  const data = buf.subarray(start, start + csize);
  return (method === 0 ? data : zlib.inflateRawSync(data)).toString('utf8');
}
const num = (x) => { const v = +x; return Number.isFinite(v) ? v : NaN; };
function parseKlines(text) { // → [t,o,h,l,c,qv,tbq]
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line || !(line.charCodeAt(0) >= 48 && line.charCodeAt(0) <= 57)) continue;
    const f = line.split(','); let t = +f[0]; if (t > 1e14) t = Math.floor(t / 1000);
    rows.push([t, num(f[1]), num(f[2]), num(f[3]), num(f[4]), num(f[7]), num(f[10])]);
  }
  return rows;
}
function parseFunding(text) { // calc_time,funding_interval_hours,last_funding_rate → [t, rate]
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line || !(line.charCodeAt(0) >= 48 && line.charCodeAt(0) <= 57)) continue;
    const f = line.split(','); let t = +f[0]; if (t > 1e14) t = Math.floor(t / 1000);
    rows.push([t, num(f[2])]);
  }
  return rows;
}
async function listPrefixes(prefix) {
  const out = []; let marker = '';
  for (let page = 0; page < 20; page++) {
    const buf = await fetchBuf(`${LIST_URL}?delimiter=/&prefix=${prefix}${marker ? '&marker=' + encodeURIComponent(marker) : ''}`); if (!buf) break;
    const xml = buf.toString('utf8');
    const pre = [...xml.matchAll(/<Prefix>([^<]+)<\/Prefix>/g)].map((m) => m[1]).filter((p) => p !== prefix);
    out.push(...pre);
    const nm = xml.match(/<NextMarker>([^<]+)<\/NextMarker>/);
    if (/<IsTruncated>true<\/IsTruncated>/.test(xml) && (nm || pre.length)) marker = nm ? nm[1] : pre[pre.length - 1]; else break;
  }
  return out;
}
async function listKeys(prefix) {
  const out = []; let marker = '';
  for (let page = 0; page < 20; page++) {
    const buf = await fetchBuf(`${LIST_URL}?prefix=${prefix}${marker ? '&marker=' + encodeURIComponent(marker) : ''}`); if (!buf) break;
    const xml = buf.toString('utf8');
    const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]);
    out.push(...keys);
    if (/<IsTruncated>true<\/IsTruncated>/.test(xml) && keys.length) marker = keys[keys.length - 1]; else break;
  }
  return out;
}
// every monthly file of one symbol/interval that exists from FROM_MONTH, plus daily files after the last monthly one
async function klinesFor(sym, tf, lastDay) {
  const keys = await listKeys(`data/futures/um/monthly/klines/${sym}/${tf}/`);
  const months = keys.map((k) => (k.match(new RegExp(`${sym}-${tf}-(\\d{4}-\\d{2})\\.zip$`)) || [])[1]).filter(Boolean).filter((m) => m >= FROM_MONTH).sort();
  const parts = await pool(months, 4, async (m) => { const b = await fetchBuf(`${ARCHIVE}/monthly/klines/${sym}/${tf}/${sym}-${tf}-${m}.zip`); return b ? parseKlines(unzipFirst(b)) : []; });
  let rows = [].concat(...parts);
  const lastMonth = months.length ? months[months.length - 1] : null;
  // daily files from the month after the last monthly file (or from the start of the latest month) up to lastDay
  const startDay = lastMonth ? ymd(Date.UTC(+lastMonth.slice(0, 4), +lastMonth.slice(5, 7), 1)) : lastDay.slice(0, 7) + '-01';
  if (startDay <= lastDay && (lastMonth || keys.length === 0)) {
    const days = []; for (let d = Date.parse(startDay + 'T00:00:00Z'); ymd(d) <= lastDay; d += DAY) days.push(ymd(d));
    if (days.length <= 62) {
      const got = await pool(days, 4, async (d) => { const b = await fetchBuf(`${ARCHIVE}/daily/klines/${sym}/${tf}/${sym}-${tf}-${d}.zip`); return b ? parseKlines(unzipFirst(b)) : []; });
      for (const g of got) rows.push(...g);
    }
  }
  rows.sort((a, b) => a[0] - b[0]);
  const out = []; for (const r of rows) if (!out.length || r[0] > out[out.length - 1][0]) out.push(r);
  return out;
}
async function fundingFor(sym) {
  const keys = await listKeys(`data/futures/um/monthly/fundingRate/${sym}/`);
  const months = keys.map((k) => (k.match(/fundingRate-(\d{4}-\d{2})\.zip$/) || [])[1]).filter(Boolean).filter((m) => m >= FROM_MONTH).sort();
  const parts = await pool(months, 4, async (m) => { const b = await fetchBuf(`${ARCHIVE}/monthly/fundingRate/${sym}/${sym}-fundingRate-${m}.zip`); return b ? parseFunding(unzipFirst(b)) : []; });
  const rows = [].concat(...parts).sort((a, b) => a[0] - b[0]);
  const out = []; for (const r of rows) if (!out.length || r[0] > out[out.length - 1][0]) out.push(r);
  return out;
}
function gzWrite(file, header, lines) {
  const s = header + '\n' + lines.join('\n') + '\n';
  fs.writeFileSync(file, zlib.gzipSync(Buffer.from(s), { level: 9 }));
  log(`wrote ${path.basename(file)}: ${lines.length} rows, ${(fs.statSync(file).size / 1e6).toFixed(1)} MB`);
}
const fx = (v) => (Number.isFinite(v) ? +v.toPrecision(7) : '');

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  // the latest archived day: yesterday or the day before (the archive lags a few hours)
  const probe = async (d) => !!(await fetchBuf(`${ARCHIVE}/daily/klines/BTCUSDT/1d/BTCUSDT-1d-${d}.zip`));
  let lastDay = ymd(Date.now() - DAY); if (!(await probe(lastDay))) lastDay = ymd(Date.now() - 2 * DAY);
  log('latest archived day', lastDay, '· from', FROM_MONTH, '· top', TOPN);
  const all = (await listPrefixes('data/futures/um/monthly/klines/')).map((p) => p.split('/').slice(-2)[0]);
  const daily = (await listPrefixes('data/futures/um/daily/klines/')).map((p) => p.split('/').slice(-2)[0]);
  const syms = [...new Set([...all, ...daily])].filter((s) => /^[A-Z0-9]+USDT$/.test(s)).filter((s) => { const b = baseOf(s).base.toLowerCase(); return !STABLES.has(b) && !WRAPPED.has(b) && !NON_CRYPTO.has(b); }).sort();
  log('symbols in the archive (USDT perps, filtered):', syms.length);

  // 1) daily candles for every symbol
  const d1 = new Map(); let done = 0;
  await pool(syms, CONC, async (s) => { const rows = await klinesFor(s, '1d', lastDay); if (rows.length) d1.set(s, rows); if (++done % 50 === 0) log(`1d ${done}/${syms.length} · ${net} requests`); });
  const lines1 = []; for (const [s, rows] of [...d1].sort()) for (const r of rows) lines1.push([s, r[0], ...r.slice(1).map(fx)].join(','));
  gzWrite(path.join(OUT, 'd1.csv.gz'), 'sym,t,o,h,l,c,qv,tbq', lines1);

  // 2) symbols ever in the daily top TOPN by quote volume (one per base asset, like the replay's universe)
  const byDay = new Map();
  for (const [s, rows] of d1) for (const r of rows) { if (!(r[5] > 0)) continue; if (!byDay.has(r[0])) byDay.set(r[0], []); byDay.get(r[0]).push([s, r[5]]); }
  const ever = new Set();
  for (const [, list] of byDay) { list.sort((a, b) => b[1] - a[1]); const seen = new Set(); let n = 0; for (const [s] of list) { const b = baseOf(s).base; if (seen.has(b)) continue; seen.add(b); ever.add(s); if (++n >= TOPN) break; } }
  const top = [...ever].sort();
  log(`symbols ever in the daily top ${TOPN}:`, top.length);

  // 3) 4h candles and funding for those
  const h4 = new Map(); done = 0;
  await pool(top, CONC, async (s) => { const rows = await klinesFor(s, '4h', lastDay); if (rows.length) h4.set(s, rows); if (++done % 50 === 0) log(`4h ${done}/${top.length} · ${net} requests`); });
  const lines4 = []; for (const [s, rows] of [...h4].sort()) for (const r of rows) lines4.push([s, r[0], ...r.slice(1).map(fx)].join(','));
  gzWrite(path.join(OUT, 'h4.csv.gz'), 'sym,t,o,h,l,c,qv,tbq', lines4);
  const fu = new Map(); done = 0;
  await pool(top, CONC, async (s) => { const rows = await fundingFor(s); if (rows.length) fu.set(s, rows); if (++done % 50 === 0) log(`funding ${done}/${top.length} · ${net} requests`); });
  const linesF = []; for (const [s, rows] of [...fu].sort()) for (const r of rows) linesF.push([s, r[0], fx(r[1])].join(','));
  gzWrite(path.join(OUT, 'funding.csv.gz'), 'sym,t,rate', linesF);

  fs.writeFileSync(path.join(OUT, 'symbols.json'), JSON.stringify({ built: new Date().toISOString(), lastDay, fromMonth: FROM_MONTH, topN: TOPN, archive: syms.length, d1: d1.size, top, h4: h4.size, funding: fu.size, requests: net, failures: fails }, null, 1));
  log(`done · ${net} requests · ${fails} failures`);
  fs.writeFileSync(path.join(OUT, 'log.txt'), runLog.join('\n') + '\n');
}
main().catch((e) => { log('ERROR', e && e.stack || e); fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'log.txt'), runLog.join('\n') + '\n'); process.exit(1); });
