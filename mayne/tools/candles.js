/* mayne · candle plumbing for the replay (strategy-agnostic; adapted from Krillin's tools/replay.js, which is left untouched)
   Binance USDT-M perpetual klines from Binance's public archive (data.binance.vision). The live API is geo-blocked for
   GitHub's US runners; the archive is not. Finished months come from the monthly zips, the current month from daily zips.
   Everything is cached on disk (gzip JSON) so a daily run only downloads the new days. */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const LIST_URL = 'https://s3-ap-northeast-1.amazonaws.com/data.binance.vision';
const DAY = 864e5;
// universe filters (the same lists the Krillin scanner uses)
const STABLES = new Set('usdt usdc dai fdusd tusd usde usdd pyusd usds usd1 frax lusd gusd busd eurc eure rlusd usdb susd usdx usdtb usdf usdg usdp usdq crvusd gho dola mim usdy usdm usd0 ousg buidl eurt xusd bfusd usdai usdr cusd ausd'.split(' '));
const WRAPPED = new Set('wbtc weth steth wsteth weeth cbbtc cbeth reth wbeth bnsol jitosol msol lbtc solvbtc wbnb meth ezeth rseth susde tbtc btcb sweth oseth ethx wsol stsol jupsol bbsol clbtc unibtc pumpbtc fbtc enzobtc swbtc xsolvbtc lseth wrseth stkaave'.split(' '));
const NON_CRYPTO = new Set('btcdom defi football bluebird xau xag xpt xpd'.split(' '));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
const ym = (ms) => new Date(ms).toISOString().slice(0, 7);
const dayStart = (s) => Date.parse(s + 'T00:00:00Z');
const baseOf = (sym) => { const b = sym.replace(/USDT$/, ''); const m = b.match(/^(1000000|1000|1M)(.+)$/); return m ? { base: m[2], mult: m[1] === '1000' ? 1000 : 1e6 } : { base: b, mult: 1 }; };
async function pool(items, n, fn) { let i = 0; const out = new Array(items.length); await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } })); return out; }

function makeStore(opts) {
  const MKT = opts.market === 'spot' ? 'spot' : 'futures/um'; // spot = TradingView's BINANCE:XXXUSDT (fidelity checks only)
  const ARCHIVE = 'https://data.binance.vision/data/' + MKT;
  const CACHE = path.join(opts.cache, MKT === 'spot' ? 'spot' : ''); const OFFLINE = opts.offline || null; const log = opts.log || console.log;
  let net = 0;
  const readJSON = (f, d) => { try { const b = fs.readFileSync(f); return JSON.parse(f.endsWith('.gz') ? zlib.gunzipSync(b).toString('utf8') : b.toString('utf8')); } catch (e) { return d; } };
  const writeJSON = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); const s = JSON.stringify(v); fs.writeFileSync(f, f.endsWith('.gz') ? zlib.gzipSync(s) : s); };

  async function fetchBuf(url, tries = 5) {
    let last;
    for (let a = 0; a < tries; a++) {
      try {
        net++; const r = await fetch(url);
        if (r.status === 404 || r.status === 403) return null; // the archive answers 404 (or 403 from S3) for files that don't exist
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return Buffer.from(await r.arrayBuffer());
      } catch (e) { last = e; await sleep(600 * (a + 1)); }
    }
    throw new Error(`fetch failed ${url}: ${last && last.message}`);
  }
  function unzipFirst(buf) { // the archive zips hold one CSV each
    let eocd = -1; for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('not a zip');
    const cd = buf.readUInt32LE(eocd + 16); if (buf.readUInt32LE(cd) !== 0x02014b50) throw new Error('bad central directory');
    const method = buf.readUInt16LE(cd + 10), csize = buf.readUInt32LE(cd + 20), lho = buf.readUInt32LE(cd + 42);
    const nameLen = buf.readUInt16LE(lho + 26), extraLen = buf.readUInt16LE(lho + 28); const start = lho + 30 + nameLen + extraLen;
    const data = buf.subarray(start, start + csize); return method === 0 ? data : zlib.inflateRawSync(data);
  }
  function parseKlines(text) { // → rows [openTime, open, high, low, close, quoteVolume]
    const rows = [];
    for (const line of text.split('\n')) {
      if (!line || !(line.charCodeAt(0) >= 48 && line.charCodeAt(0) <= 57)) continue; // skip the header row
      const f = line.split(','); let t = +f[0]; if (t > 1e14) t = Math.floor(t / 1000); // µs timestamps → ms
      rows.push([t, +f[1], +f[2], +f[3], +f[4], +f[7]]);
    }
    return rows;
  }
  async function s3List(prefix) { // every key under a prefix (paged)
    const keys = []; let marker = '';
    for (let page = 0; page < 50; page++) {
      const buf = await fetchBuf(`${LIST_URL}?delimiter=/&prefix=${encodeURIComponent(prefix)}${marker ? '&marker=' + encodeURIComponent(marker) : ''}`); if (!buf) break;
      const xml = buf.toString('utf8');
      const ks = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]); const ps = [...xml.matchAll(/<Prefix>([^<]+)<\/Prefix>/g)].map((m) => m[1]).filter((p) => p !== prefix);
      keys.push(...ks, ...ps);
      const nm = xml.match(/<NextMarker>([^<]+)<\/NextMarker>/);
      if (/<IsTruncated>true<\/IsTruncated>/.test(xml)) marker = nm ? nm[1] : (ks.length ? ks[ks.length - 1] : ps[ps.length - 1]); else break;
    }
    return keys;
  }

  // every USDT-M perpetual symbol the archive holds (listed and delisted: no survivorship bias), minus stables / wrapped / index
  async function listSymbols() {
    if (OFFLINE) return fs.readdirSync(OFFLINE).filter((f) => /_1d\.json$/.test(f)).map((f) => f.replace('_1d.json', ''));
    const f = path.join(CACHE, 'symbols.json'); const c = readJSON(f, null); if (c && Date.now() - c.t < 3 * DAY) return c.list;
    const pre = await s3List(`data/${MKT}/monthly/klines/`);
    const all = pre.map((p) => (p.match(/klines\/([^/]+)\/$/) || [])[1]).filter(Boolean);
    const list = all.filter((s) => /^[A-Z0-9]+USDT$/.test(s)).filter((s) => { const b = baseOf(s).base.toLowerCase(); return !STABLES.has(b) && !WRAPPED.has(b) && !NON_CRYPTO.has(b); });
    if (list.length < 50) throw new Error('archive symbol listing failed');
    writeJSON(f, { t: Date.now(), list }); return list;
  }
  // the months a symbol has a monthly file for (cached; refreshed when a newer month should exist)
  async function monthsOf(sym, tf, lastDay) {
    const f = path.join(CACHE, 'months', tf, sym + '.json'); const c = readJSON(f, null);
    const want = ym(Date.UTC(+lastDay.slice(0, 4), +lastDay.slice(5, 7) - 2, 1)); // the previous month's file should exist by now
    if (c && (c.months.length === 0 ? Date.now() - c.t < 3 * DAY : c.months[c.months.length - 1] >= want || Date.now() - c.t < DAY)) return c.months;
    const keys = await s3List(`data/${MKT}/monthly/klines/${sym}/${tf}/`);
    const months = [...new Set(keys.map((k) => (k.match(new RegExp(`${sym}-${tf}-(\\d{4}-\\d{2})\\.zip$`)) || [])[1]).filter(Boolean))].sort();
    writeJSON(f, { t: Date.now(), months }); return months;
  }
  // rows of one month (finished: the monthly zip; otherwise daily zips up to lastDay)
  async function getMonth(sym, tf, m, lastDay, hasMonthly) {
    const f = path.join(CACHE, 'k', tf, sym, m + '.json.gz'); let c = readJSON(f, null);
    const monthEnd = ymd(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)); const needTo = monthEnd < lastDay ? monthEnd : lastDay;
    if (c && (c.complete || c.to >= needTo)) return c.rows;
    if (hasMonthly) {
      const buf = await fetchBuf(`${ARCHIVE}/monthly/klines/${sym}/${tf}/${sym}-${tf}-${m}.zip`);
      if (buf) { c = { rows: parseKlines(unzipFirst(buf).toString('utf8')), complete: true }; writeJSON(f, c); return c.rows; }
    }
    if (!c) c = { rows: [], to: null };
    const days = []; for (let d = c.to ? dayStart(c.to) + DAY : dayStart(m + '-01'); ymd(d) <= needTo; d += DAY) days.push(ymd(d));
    const got = await pool(days, 6, async (d) => { const buf = await fetchBuf(`${ARCHIVE}/daily/klines/${sym}/${tf}/${sym}-${tf}-${d}.zip`); return buf ? parseKlines(unzipFirst(buf).toString('utf8')) : null; });
    for (const r of got) if (r) c.rows.push(...r);
    c.rows.sort((a, b) => a[0] - b[0]); c.to = needTo; writeJSON(f, c); return c.rows;
  }
  // all rows of sym/tf with open time in [fromMs, toMs), sorted and de-duplicated
  async function loadRows(sym, tf, fromMs, toMs, lastDay) {
    if (OFFLINE) { const rows = readJSON(path.join(OFFLINE, `${sym}_${tf}.json`), []); return rows.filter((r) => r[0] >= fromMs && r[0] < toMs); }
    const listed = await monthsOf(sym, tf, lastDay); const lm = new Set(listed);
    const first = listed.length ? listed[0] : ym(Date.now() - 40 * DAY);         // a symbol too new for a monthly file: daily files only
    const months = []; let y = new Date(Math.max(fromMs, dayStart(first + '-01'))).getUTCFullYear(), mo = new Date(Math.max(fromMs, dayStart(first + '-01'))).getUTCMonth();
    for (;;) { const s = `${y}-${String(mo + 1).padStart(2, '0')}`; if (s > lastDay.slice(0, 7) || dayStart(s + '-01') >= toMs) break; months.push(s); mo++; if (mo > 11) { mo = 0; y++; } }
    // a month without a monthly file has data only if it is too recent to be published yet (this or last month);
    // older gaps (and the months after a delisting) hold nothing, so they are not probed day by day
    const recent = ym(Date.UTC(+lastDay.slice(0, 4), +lastDay.slice(5, 7) - 2, 1));
    const parts = [];
    for (const m of months) { if (!lm.has(m) && m < recent) continue; parts.push(await getMonth(sym, tf, m, lastDay, lm.has(m))); }
    const out = []; for (const p of parts) for (const r of p) if (r[0] >= fromMs && r[0] < toMs && (!out.length || r[0] > out[out.length - 1][0])) out.push(r);
    return out;
  }
  async function latestDay() {
    if (OFFLINE) { const r = readJSON(path.join(OFFLINE, 'BTCUSDT_15m.json'), []); return ymd(Math.floor((r[r.length - 1][0] + 9e5) / DAY) * DAY - DAY); }
    for (let d = Math.floor(Date.now() / DAY) * DAY - DAY; d > Date.now() - 6 * DAY; d -= DAY) { const buf = await fetchBuf(`${ARCHIVE}/daily/klines/BTCUSDT/15m/BTCUSDT-15m-${ymd(d)}.zip`); if (buf) return ymd(d); }
    throw new Error('the archive has no recent daily files');
  }
  return { listSymbols, monthsOf, loadRows, latestDay, readJSON, writeJSON, netCount: () => net };
}

const toCols = (rows) => ({ t: rows.map((r) => r[0]), o: rows.map((r) => r[1]), h: rows.map((r) => r[2]), l: rows.map((r) => r[3]), c: rows.map((r) => r[4]), v: rows.map((r) => r[5]) });

module.exports = { makeStore, toCols, baseOf, pool, ymd, ym, dayStart, DAY };
