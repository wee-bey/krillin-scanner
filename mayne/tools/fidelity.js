#!/usr/bin/env node
/* mayne · fidelity check: runs the JS engine on one TradingView chart's data and prints the same log lines as the
   indicator's "Log every setup to Pine Logs" switch (TAG, TURN, ARM, REJ, CLOSE, EXP, INV, ZINV, ZEXP), plus the chart
   tally. Compare with the Pine Logs of mayne.v1 on the same chart.
   TradingView computes higher-TF requests only from the chart's first bar on, so --chart-from cuts every TF there
   (by default the W / D state would start from the coin's full daily history).

   Usage: node mayne/tools/fidelity.js --sym BTCUSDT --market spot --profile P1 --chart-from 2024-01-01 [--to 2026-10-01]
          [--out mayne/data/fidelity] [--cache .mcache] */
'use strict';
const fs = require('fs');
const path = require('path');
const M = require('../lib/engine.js');
const { makeStore, toCols, ymd, dayStart, DAY } = require('./candles.js');

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => { if (x.startsWith('--')) a.push([x.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]); return a; }, []));
const ROOT = path.resolve(__dirname, '..', '..');
const SYM = args.sym || 'BTCUSDT', MKT = args.market || 'spot', PROF = args.profile || 'P1';
const OUT = path.resolve(ROOT, args.out || 'mayne/data/fidelity');
const fmt = (x) => (Number.isFinite(x) ? String(+x.toPrecision(8)) : '—');
const ts = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');

async function main() {
  const store = makeStore({ cache: path.resolve(ROOT, args.cache || '.mcache'), market: MKT });
  const lastDay = args.to || await store.latestDay(); const endMs = dayStart(lastDay) + DAY;
  const chartFrom = args['chart-from'] ? dayStart(args['chart-from']) : null;
  const prof = M.PROFILES[PROF]; const trigTf = prof.trig;
  const srcTf = trigTf === '15m' ? '15m' : '1h';
  const d1 = toCols(await store.loadRows(SYM, '1d', chartFrom || Date.UTC(2017, 0, 1), endMs, lastDay));
  const lo = toCols(await store.loadRows(SYM, srcTf, chartFrom || Date.UTC(2017, 0, 1), endMs, lastDay));
  const ag = (tf) => M.aggregate(lo, M.TF_MS[srcTf], tf, true);
  const W = M.aggregate(d1, DAY, '1w', true);
  const data = PROF === 'P1' ? { W, D: d1, Z: ag('12h'), CF: ag('4h'), T: srcTf === '1h' ? lo : ag('1h') } : { W, D: d1, Z: ag('4h'), CF: ag('1h'), T: lo };
  const lines = [];
  const r = M.run(data, { profile: PROF, sym: SYM });
  const byId = new Map(r.trades.map((t) => [t.id, t]));
  const dirS = (d) => (d === 1 ? 'LONG' : 'SHORT');
  for (const e of r.events) {
    let s = '';
    if (e.type === 'TAG') s = `TAG ${dirS(e.dir)} ${e.tf} ${e.kind} ${fmt(e.zone[0])}-${fmt(e.zone[1])}${e.cont ? ' cont' : ' rev'}`;
    else if (e.type === 'TURN') s = `TURN ${dirS(e.dir)} ${e.how}`;
    else if (e.type === 'REJ') s = `REJ ${dirS(e.dir)} ${e.why} | ${e.cont ? 'cont' : 'rev'} | en ${fmt(e.en)} sl ${fmt(e.sl)} pt ${fmt(e.pt)}`;
    else if (e.type === 'ARM') { const t = byId.get(e.trade); s = `ARM ${dirS(e.dir)} ${t.grade}${t.boost.map((b) => ' +' + b).join('')} | ${t.cont ? 'cont' : 'rev'} ${t.zoneTf} ${t.zoneKind} | turn ${t.turnHow} | att ${t.att} | en ${fmt(t.en)} sl ${fmt(t.sl0)} (${t.slWhy}, ${t.riskAtr.toFixed(2)} ATR) pl ${fmt(t.pl)} pt ${fmt(t.pt)} rr ${t.rr.toFixed(2)} ft ${fmt(t.ft)} | tagged ${ts(t.tTag)}`; }
    else if (e.type === 'CLOSE') s = `CLOSE ${dirS(e.dir)} ${e.how} ${e.R.toFixed(2)}R`;
    else if (e.type === 'EXP' || e.type === 'INV') s = `${e.type} ${dirS(e.dir)} ${e.why}`;
    else if (e.type === 'ZEXP' || e.type === 'ZINV') s = `${e.type} ${dirS(e.dir)} ${e.why}`;
    else continue;
    lines.push(`[${ts(e.t)} UTC] ${s}`);
  }
  const st = r.stats;
  const head = `mayne.v1 JS engine ${M.VERSION} · ${MKT === 'spot' ? 'BINANCE:' + SYM : 'BINANCE:' + SYM + '.P'} · ${prof.name} · trigger ${M.TF_LABEL[trigTf]} · data ${ts(data.T.t[0])} → ${ts(data.T.t[data.T.t.length - 1])} UTC${chartFrom ? ' · every TF cut at the chart start ' + ymd(chartFrom) : ' · full daily history for W/D'}\n` +
    `This chart: ${st.armed} armed · ${st.filled} filled · ${st.win}W/${st.loss}L · ${st.sumR >= 0 ? '+' : ''}${st.sumR.toFixed(1)}R · ${st.exp} expired · ${st.inv} invalidated\n`;
  fs.mkdirSync(OUT, { recursive: true });
  const f = path.join(OUT, `${SYM}-${MKT}-${PROF}${chartFrom ? '-from' + ymd(chartFrom) : ''}.txt`);
  fs.writeFileSync(f, head + lines.join('\n') + '\n');
  console.log(head.trim()); console.log('→ ' + path.relative(ROOT, f));
}
main().catch((e) => { console.error(e); process.exit(1); });
