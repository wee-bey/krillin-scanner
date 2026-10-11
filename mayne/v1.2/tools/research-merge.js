#!/usr/bin/env node
/* mayne v1.2 · merge the research shards into one result folder (trades.json.gz, diag.json.gz, meta.json).
   Usage: node mayne/v1.2/tools/research-merge.js --in DIR_WITH_SHARDS --out RESULT_DIR */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => { if (x.startsWith('--')) a.push([x.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]); return a; }, []));
const IN = path.resolve(args.in), OUT = path.resolve(args.out);
const files = []; (function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/^shard-\d+\.json\.gz$/.test(f)) files.push(p); } })(IN);
if (!files.length) throw new Error('no shard files in ' + IN);
let meta = null; const rows = [], drows = [], prows = [], zrows = [], brows = []; const shards = [];
for (const f of files.sort()) {
  const d = JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString('utf8'));
  if (!meta) meta = { engine: d.engine, lastDay: d.lastDay, armFrom: d.armFrom, armTo: d.armTo, variants: d.variants, specs: d.specs, extra: d.extra, exec: d.exec, cols: d.cols, dcols: d.dcols, pcols: d.pcols, of: d.of };
  shards.push({ shard: d.shard, coins: d.coins, rows: d.rows.length, made: d.made }); rows.push(...d.rows); drows.push(...d.drows); prows.push(...d.prows); if (d.zrows) for (const z of d.zrows) zrows.push(z); if (d.brows) for (const b of d.brows) brows.push(b);
}
meta.shards = shards.sort((a, b) => a.shard - b.shard); meta.merged = new Date().toISOString(); meta.rows = rows.length;
if (meta.shards.length !== meta.of) console.warn(`WARNING: ${meta.shards.length} of ${meta.of} shards present`);
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'trades.json.gz'), zlib.gzipSync(JSON.stringify({ cols: meta.cols, rows })));
fs.writeFileSync(path.join(OUT, 'diag.json.gz'), zlib.gzipSync(JSON.stringify({ dcols: meta.dcols, drows, pcols: meta.pcols, prows })));
if (zrows.length || brows.length) fs.writeFileSync(path.join(OUT, 'events.json.gz'), zlib.gzipSync(JSON.stringify({ zcols: ['sym', 'prof', 'tc', 'st', 'dir'], zrows, bcols: ['sym', 'day', 'bias'], brows })));
fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 1));
console.log(`merged ${files.length} shards: ${rows.length} rows, ${drows.length} diag, ${prows.length} pseudo → ${OUT}`);
