/* mayne v1.2 · funding-rate plumbing (strategy-agnostic). Binance USDT-M funding history from the public archive
   (data.binance.vision/data/futures/um/monthly/fundingRate/SYM/SYM-fundingRate-YYYY-MM.zip), cached on disk as gzip JSON.
   Months that are not published yet (the current month) are simply missing: funding is then counted as 0 for them,
   and the replay reports how many trades that affects. */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ARCHIVE = 'https://data.binance.vision/data/futures/um/monthly/fundingRate';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ym = (ms) => new Date(ms).toISOString().slice(0, 7);

function unzipFirst(buf) { // the archive zips hold one CSV each
  let eocd = -1; for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip');
  const cd = buf.readUInt32LE(eocd + 16); if (buf.readUInt32LE(cd) !== 0x02014b50) throw new Error('bad central directory');
  const method = buf.readUInt16LE(cd + 10), csize = buf.readUInt32LE(cd + 20), lho = buf.readUInt32LE(cd + 42);
  const nameLen = buf.readUInt16LE(lho + 26), extraLen = buf.readUInt16LE(lho + 28); const start = lho + 30 + nameLen + extraLen;
  const data = buf.subarray(start, start + csize); return method === 0 ? data : zlib.inflateRawSync(data);
}

function makeFunding(opts) {
  const CACHE = path.join(opts.cache, 'funding'); let net = 0;
  const readJSON = (f, d) => { try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString('utf8')); } catch (e) { return d; } };
  const writeJSON = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, zlib.gzipSync(JSON.stringify(v))); };
  async function fetchBuf(url, tries = 4) {
    let last;
    for (let a = 0; a < tries; a++) {
      try { net++; const r = await fetch(url); if (r.status === 404 || r.status === 403) return null; if (!r.ok) throw new Error('HTTP ' + r.status); return Buffer.from(await r.arrayBuffer()); }
      catch (e) { last = e; await sleep(500 * (a + 1)); }
    }
    throw new Error(`fetch failed ${url}: ${last && last.message}`);
  }
  // one month of [time, rate] pairs; a month before `publishedThrough` that has no file is cached as empty
  async function month(sym, m, publishedThrough) {
    const f = path.join(CACHE, sym, m + '.json.gz'); const c = readJSON(f, null); if (c) return c;
    if (m > publishedThrough) return [];
    const buf = await fetchBuf(`${ARCHIVE}/${sym}/${sym}-fundingRate-${m}.zip`);
    const rows = [];
    if (buf) for (const line of unzipFirst(buf).toString('utf8').split('\n')) { const x = line.split(','); const t = +x[0]; if (!(t > 1e12)) continue; rows.push([t, +x[2]]); }
    writeJSON(f, rows); return rows;
  }
  // all funding events of sym in [fromMs, toMs): arrays { t: [...], r: [...] }
  async function load(sym, fromMs, toMs) {
    const now = Date.now(); const pub = ym(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth() - 1, 1)); // last finished month
    const out = { t: [], r: [] };
    for (let d = new Date(Date.UTC(new Date(fromMs).getUTCFullYear(), new Date(fromMs).getUTCMonth(), 1)); d.getTime() < toMs; d.setUTCMonth(d.getUTCMonth() + 1)) {
      const rows = await month(sym, ym(d.getTime()), pub);
      for (const [t, r] of rows) if (t >= fromMs && t < toMs) { out.t.push(t); out.r.push(r); }
    }
    return out;
  }
  return { load, netCount: () => net };
}

// funding paid by a position over (tFrom, tTo], in R: Σ rate × price / risk, sign: longs pay positive rates.
// fractions: [[tUntil, frac]] the open fraction of the position until each time (partial exits).
function fundingR(F, dir, price, risk, tFrom, segments) {
  if (!F || !F.t.length || !(risk > 0)) return 0;
  let lo = 0, hi = F.t.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (F.t[mid] <= tFrom) lo = mid + 1; else hi = mid; }
  let R = 0, k = 0;
  for (let i = lo; i < F.t.length; i++) {
    const t = F.t[i]; while (k < segments.length && t > segments[k][0]) k++; if (k >= segments.length) break;
    R += -dir * F.r[i] * segments[k][1] * price / risk;
  }
  return R;
}

module.exports = { makeFunding, fundingR };
