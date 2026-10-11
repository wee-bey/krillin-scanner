#!/usr/bin/env node
/* mayne v1.2 · export a research sample from the replay's candle cache (run in GitHub Actions, where the archive is
   reachable). Writes:
     daily/SYM.json.gz   every symbol's full daily history (rows [t, o, h, l, c, quoteVolume]) → the daily top-100 universe
     m15/SYM.json.gz     15m history of the sample symbols
     funding/SYM.json.gz funding events of the sample symbols ({ t: [...], r: [...] })
     meta.json           latest archive day, symbol list
   Usage: node mayne/v1.2/tools/export-sample.js --out /tmp/sample [--cache .mcache] [--syms A,B,...] */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { makeStore, pool, dayStart, DAY } = require('../../tools/candles.js');
const { makeFunding } = require('./funding.js');

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => { if (x.startsWith('--')) a.push([x.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]); return a; }, []));
const ROOT = path.resolve(__dirname, '..', '..', '..');
const OUT = path.resolve(args.out || '/tmp/sample');
const CACHE = path.resolve(ROOT, args.cache || '.mcache');
const SAMPLE = String(args.syms || 'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,DOGEUSDT,ADAUSDT,LINKUSDT,AVAXUSDT,LTCUSDT,DOTUSDT,MATICUSDT,1000PEPEUSDT,SUIUSDT,ARBUSDT,OPUSDT,NEARUSDT,FTMUSDT,WIFUSDT,TRXUSDT,APTUSDT,INJUSDT').split(',');
const put = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, zlib.gzipSync(JSON.stringify(v))); };

(async () => {
  const store = makeStore({ cache: CACHE, log: console.log }); const fund = makeFunding({ cache: CACHE });
  const lastDay = await store.latestDay(); const endMs = dayStart(lastDay) + DAY;
  const syms = await store.listSymbols(); console.log(`${syms.length} symbols; archive through ${lastDay}`);
  let nD = 0;
  await pool(syms, 16, async (s) => { const rows = await store.loadRows(s, '1d', Date.UTC(2019, 0, 1), endMs, lastDay); if (rows.length) { put(path.join(OUT, 'daily', s + '.json.gz'), rows); nD++; } });
  console.log(`daily: ${nD} symbols · ${store.netCount()} downloads`);
  const done = [];
  for (const s of SAMPLE) {
    if (!fs.existsSync(path.join(OUT, 'daily', s + '.json.gz'))) { console.log(`${s}: not in the archive, skipped`); continue; }
    const rows = await store.loadRows(s, '15m', Date.UTC(2020, 8, 1), endMs, lastDay);
    if (rows.length < 2000) { console.log(`${s}: only ${rows.length} 15m rows, skipped`); continue; }
    put(path.join(OUT, 'm15', s + '.json.gz'), rows);
    const F = await fund.load(s, Date.UTC(2020, 8, 1), endMs); put(path.join(OUT, 'funding', s + '.json.gz'), F);
    console.log(`${s}: ${rows.length} 15m rows, ${F.t.length} funding events · ${store.netCount() + fund.netCount()} downloads`); done.push(s);
  }
  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify({ lastDay, sample: done, made: new Date().toISOString() }, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
