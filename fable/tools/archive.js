/* Fable · Binance public archive reader (data.binance.vision), with a local cache.
   Only what Fable needs: BTCUSDT daily candles and funding rates. Same approach as tools/replay.js (the live API is
   geo-blocked for GitHub's US runners; the archive is not), kept separate so the Krillin replay is untouched. */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ARCHIVE = 'https://data.binance.vision/data/futures/um';
const DAY = 864e5;
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
const ym = (ms) => new Date(ms).toISOString().slice(0, 7);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
const writeJSON = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v)); };

let netCount = 0;
async function fetchBuf(url, tries = 4) {
  let last;
  for (let a = 0; a < tries; a++) {
    try { netCount++; const r = await fetch(url); if (r.status === 404 || r.status === 403) return null; if (!r.ok) throw new Error('HTTP ' + r.status); return Buffer.from(await r.arrayBuffer()); }
    catch (e) { last = e; await sleep(500 * (a + 1)); }
  }
  throw new Error(`fetch failed ${url}: ${last && last.message}`);
}
function unzipFirst(buf) {
  let eocd = -1; for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip');
  const cd = buf.readUInt32LE(eocd + 16); if (buf.readUInt32LE(cd) !== 0x02014b50) throw new Error('bad central directory');
  const method = buf.readUInt16LE(cd + 10), csize = buf.readUInt32LE(cd + 20), lho = buf.readUInt32LE(cd + 42);
  const nameLen = buf.readUInt16LE(lho + 26), extraLen = buf.readUInt16LE(lho + 28); const start = lho + 30 + nameLen + extraLen;
  const data = buf.subarray(start, start + csize); return method === 0 ? data : zlib.inflateRawSync(data);
}
const csvRows = (text) => text.split('\n').filter((l) => l && l.charCodeAt(0) >= 48 && l.charCodeAt(0) <= 57).map((l) => l.split(','));
function parseKlines(text) { return csvRows(text).map((f) => { let t = +f[0]; if (t > 1e14) t = Math.floor(t / 1000); return [t, +f[1], +f[2], +f[3], +f[4], +f[7]]; }); }
function parseFunding(text) { return csvRows(text).map((f) => { let t = +f[0]; if (t > 1e14) t = Math.floor(t / 1000); return [t, +f[2]]; }); } // [calc_time, last_funding_rate]

function monthsBetween(fromMs, toMs) { const out = []; let y = new Date(fromMs).getUTCFullYear(), mo = new Date(fromMs).getUTCMonth(); const end = ym(toMs); for (;;) { const s = `${y}-${String(mo + 1).padStart(2, '0')}`; out.push(s); if (s >= end) break; mo++; if (mo > 11) { mo = 0; y++; } } return out; }

class Archive {
  constructor(cacheDir) { this.cache = cacheDir; }
  // the latest day the archive has published (BTCUSDT 1d daily file as the probe)
  async lastDay() { for (let d = Math.floor(Date.now() / DAY) * DAY - DAY; d > Date.now() - 6 * DAY; d -= DAY) { const buf = await fetchBuf(`${ARCHIVE}/daily/klines/BTCUSDT/1d/BTCUSDT-1d-${ymd(d)}.zip`); if (buf) return ymd(d); } throw new Error('the archive has no recent daily files'); }
  async klinesMonth(sym, tf, m, lastDay) {
    const f = path.join(this.cache, 'k', tf, sym, m + '.json'); let c = readJSON(f, null);
    const nowMonth = lastDay.slice(0, 7); const monthEnd = ymd(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)); const needTo = monthEnd < lastDay ? monthEnd : lastDay;
    if (c && (c.complete || c.absent || c.to >= needTo)) return c.rows || [];
    if (!c) c = { rows: [], to: null };
    if (m < nowMonth && !c.to) {
      const buf = await fetchBuf(`${ARCHIVE}/monthly/klines/${sym}/${tf}/${sym}-${tf}-${m}.zip`);
      if (buf) { c = { rows: parseKlines(unzipFirst(buf).toString('utf8')), complete: true }; writeJSON(f, c); return c.rows; }
      const prevMonth = ym(Date.UTC(+nowMonth.slice(0, 4), +nowMonth.slice(5, 7) - 2, 1));
      if (m < prevMonth) { c = { rows: [], absent: true }; writeJSON(f, c); return []; }
    }
    const days = []; for (let d = c.to ? Date.parse(c.to + 'T00:00:00Z') + DAY : Date.parse(m + '-01T00:00:00Z'); ymd(d) <= needTo; d += DAY) days.push(ymd(d));
    for (const d of days) { const buf = await fetchBuf(`${ARCHIVE}/daily/klines/${sym}/${tf}/${sym}-${tf}-${d}.zip`); if (buf) c.rows.push(...parseKlines(unzipFirst(buf).toString('utf8'))); }
    c.rows.sort((a, b) => a[0] - b[0]); c.to = needTo; writeJSON(f, c); return c.rows;
  }
  async klines(sym, tf, fromMs, toMs, lastDay) {
    const parts = []; for (const m of monthsBetween(fromMs, toMs)) parts.push(await this.klinesMonth(sym, tf, m, lastDay));
    const rows = [].concat(...parts).filter((r) => r[0] >= fromMs && r[0] < toMs); const out = [];
    for (const r of rows) if (!out.length || r[0] > out[out.length - 1][0]) out.push(r);
    return out;
  }
  // funding: monthly files only (published in the first days of the next month). Returns Map day -> summed daily rate,
  // plus the last month that had data. Days without data get the mean daily rate of the last 30 known days.
  async funding(sym, fromMs, toMs, lastDay) {
    const perDay = new Map(); let lastMonth = null;
    for (const m of monthsBetween(fromMs, toMs)) {
      const f = path.join(this.cache, 'f', sym, m + '.json'); let c = readJSON(f, null);
      if (!c || (!c.complete && !c.absent)) {
        const buf = await fetchBuf(`${ARCHIVE}/monthly/fundingRate/${sym}/${sym}-fundingRate-${m}.zip`);
        if (buf) { c = { rows: parseFunding(unzipFirst(buf).toString('utf8')), complete: true }; writeJSON(f, c); }
        else { const nowMonth = lastDay.slice(0, 7); c = { rows: [], absent: m < nowMonth && m < ym(Date.UTC(+nowMonth.slice(0, 4), +nowMonth.slice(5, 7) - 2, 1)) }; if (c.absent) writeJSON(f, c); }
      }
      if (c.rows.length) lastMonth = m;
      for (const [t, r] of c.rows) { const d = ymd(t); perDay.set(d, (perDay.get(d) || 0) + r); }
    }
    const known = [...perDay.keys()].sort(); const tail = known.slice(-30); const est = tail.length ? tail.reduce((a, d) => a + perDay.get(d), 0) / tail.length : 0;
    return { perDay, lastMonth, estimate: est, knownThrough: known.length ? known[known.length - 1] : null };
  }
  get downloads() { return netCount; }
}
module.exports = { Archive, DAY, ymd, ym, readJSON, writeJSON, monthsBetween };
