#!/usr/bin/env node
/* Fable · the daily job (GitHub Actions, see .github/workflows/fable.yml)

   1. BTC daily candles + funding from Binance's public archive → the regime series (BTC daily close vs daily MA100)
      and the regime books A (long/short) and C (long/flat) as paper portfolios, with costs and funding.
   2. The Krillin replay's own signals (data/signals-YYYY-MM.json, unchanged) → the watch list: the 4h/1d signals of
      the latest replayed day that pass every Fable gate, with their plan cards; and the same gates over the whole
      history, so the gated subset gets an honest forward test next to the full stream.
   3. Writes fable/data/ (regime.json, digest.json, history.json, alerts.json, state.json, last_run.txt, outbox.txt)
      and sends the regime-flip alert and the daily digest to Telegram when the secrets exist.

   Nothing in tools/, data/ or the live scanner is read for writing or changed.
   Usage: node fable/tools/run.js [--out fable/data] [--cache .fcache] [--data data] [--from 2021-06-01] [--offline]
*/
'use strict';
const fs = require('fs');
const path = require('path');
const { Archive, DAY, ymd, readJSON, writeJSON } = require('./archive.js');
const Regime = require('../lib/regime.js');
const Gates = require('../lib/gates.js');
const notify = require('./notify.js');

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => { if (x.startsWith('--')) a.push([x.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]); return a; }, []));
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.resolve(ROOT, args.out || 'fable/data');
const CACHE = path.resolve(ROOT, args.cache || '.fcache');
const DATA = path.resolve(ROOT, args.data || 'data');
const FROM = args.from || '2021-06-01';
const ACCOUNT = 10000;
const SPLIT = '2026-05-01'; // first half / second half of the replay year, as in HANDOFF §5d-§5f
const runLog = []; const log = (...a) => { const s = `[${new Date().toISOString().slice(11, 19)}] ` + a.join(' '); console.log(s); runLog.push(s); };
const fmt = (x, d = 0) => Number.isFinite(x) ? x.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }) : '–';
const pct = (x, d = 1) => Number.isFinite(x) ? (x * 100).toFixed(d) + '%' : '–';

function loadSignals() { // every Krillin signal record, oldest first (RG trades excluded: tracked by the replay itself)
  const idx = readJSON(path.join(DATA, 'index.json'), null); if (!idx) throw new Error(`no ${DATA}/index.json (the Krillin replay has not run)`);
  const all = []; for (const m of idx.months) for (const s of readJSON(path.join(DATA, `signals-${m}.json`), { signals: [] }).signals) if (s.setup !== 'RG') all.push(s);
  all.sort((a, b) => a.t - b.t); return { idx, all, market: readJSON(path.join(DATA, 'market.json'), { days: {} }) };
}

function planLine(s, g) {
  const bids = s.bids.length > 1 ? `${fmt(s.bids[0], 6)}–${fmt(s.bids[s.bids.length - 1], 6)}` : fmt(s.bids[0], 6);
  const tp1 = s.tps && s.tps[0] ? `TP1 ${fmt(s.tps[0][0], 6)} (${s.tps[0][1]}R, ${s.tps[0][2]})` : 'no TP';
  const tps = s.tps && s.tps.length > 1 ? ` · TP2 ${fmt(s.tps[1][0], 6)} (${s.tps[1][1]}R)${s.tps[2] ? ` · TP3 ${fmt(s.tps[2][0], 6)} (${s.tps[2][1]}R)` : ''}` : '';
  const soft = g.soft.length ? ` · ⚠ ${g.soft.join('; ')}` : '';
  return `• ${s.S} · ${s.setup} ${s.tf} ${s.dir} · grade ${s.grade} · ${s.dir === 'long' ? 'bids' : 'asks'} ${bids} · stop ${fmt(s.stop, 6)} (${s.stopPct.toFixed(1)}%) · ${tp1}${tps}${soft}\n  ${s.name}: ${s.why}`;
}

async function main() {
  const t0 = Date.now();
  const state = readJSON(path.join(OUT, 'state.json'), { lastDigestDay: null, lastFlipDay: null, startSent: false });
  const alerts = readJSON(path.join(OUT, 'alerts.json'), []);
  const A = new Archive(CACHE);
  // ── 1. regime and books ─────────────────────────────────────────────────────────────────────────────────────
  const lastDay = args.offline ? ymd(Date.now() - 2 * DAY) : await A.lastDay();
  const until = Date.parse(lastDay + 'T00:00:00Z') + DAY;
  const from = Date.parse(FROM + 'T00:00:00Z');
  const rows = await A.klines('BTCUSDT', '1d', from, until, lastDay); if (rows.length < 200) throw new Error('not enough BTC daily candles');
  const D = { t: rows.map((r) => r[0]), o: rows.map((r) => r[1]), h: rows.map((r) => r[2]), l: rows.map((r) => r[3]), c: rows.map((r) => r[4]) };
  const fund = await A.funding('BTCUSDT', from, until, lastDay);
  const funding = new Map(fund.perDay); for (let t = from; t < until; t += DAY) { const d = ymd(t); if (!funding.has(d) && (!fund.knownThrough || d > fund.knownThrough)) funding.set(d, fund.estimate); }
  const reg = Regime.series(D); const latest = reg.rows[reg.rows.length - 1];
  const books = {}; for (const k of ['A', 'C']) books[k] = Regime.book(D, reg, k, null, funding);
  const { idx, all, market } = loadSignals();
  const cov = idx.coverage;
  const stateByDay = new Map(reg.rows.map((r) => [r.day, r.state]));
  const regimeOf = (day) => stateByDay.get(ymd(Date.parse(day + 'T00:00:00Z') - DAY)) || 0; // as of the close before that day
  const flips = reg.rows.filter((r) => r.flip).map((r) => ({ day: r.day, to: r.state > 0 ? 'risk-on' : 'risk-off', close: r.close, ma100: r.ma100 }));
  const since = (s) => Regime.windowReturn(s.rows, cov.first || '2025-09-01', lastDay);
  const regimeOut = {
    updated: new Date().toISOString(), archiveThrough: lastDay, params: reg.params, rule: 'BTC daily close above its daily MA100 = risk-on, below = risk-off (HANDOFF §5f). Books: each leg sized to 30%/yr from BTC\'s trailing 60-day realised volatility, max 2x; the position decided at the 00:00 UTC close is held through the next day; 0.08% per side on exposure changes; perp funding charged (estimated from the last 30 known days where the archive has not published the month yet).',
    latest: { ...latest, regime: latest.state > 0 ? 'risk-on' : 'risk-off', targets: { A: Regime.targetPosition(books.A.stats, ACCOUNT), C: Regime.targetPosition(books.C.stats, ACCOUNT) }, account: ACCOUNT },
    flips: flips.slice(-40), flipCount: { all: flips.length, since2025: flips.filter((f) => f.day >= '2025-01-01').length },
    rows: reg.rows.slice(-420).map((r) => [r.day, r.close, r.ma100, r.state, r.dist, r.smma99]),
    books: Object.fromEntries(Object.entries(books).map(([k, b]) => [k, { stats: b.stats, byYear: Regime.byYear(b.rows), since2022: Regime.windowReturn(b.rows, '2022-01-01', lastDay), replayYear: since(b), eq: b.rows.filter((r) => r.day >= '2022-01-01').map((r) => [r.day, r.eq]) }])),
    funding: { knownThrough: fund.knownThrough, estimateDaily: fund.estimate, lastMonth: fund.lastMonth },
    buyHold: { since2022: (() => { const i0 = D.t.findIndex((t) => ymd(t) >= '2022-01-01'); return i0 >= 0 ? +(D.c[D.c.length - 1] / D.c[i0] - 1).toFixed(4) : null; })(), replayYear: (() => { const i0 = D.t.findIndex((t) => ymd(t) >= (cov.first || '2025-09-01')); return i0 >= 0 ? +(D.c[D.c.length - 1] / D.c[i0] - 1).toFixed(4) : null; })() },
  };
  writeJSON(path.join(OUT, 'regime.json'), regimeOut);
  log(`regime: ${latest.day} BTC ${fmt(latest.close)} vs daily MA100 ${fmt(latest.ma100)} (${latest.dist > 0 ? '+' : ''}${latest.dist}%) → ${regimeOut.latest.regime}, ${latest.daysSinceFlip} d since the flip · book A ${pct(books.A.stats.total)} since ${FROM}, replay year ${pct(since(books.A) && since(books.A).ret)}; book C replay year ${pct(since(books.C) && since(books.C).ret)}`);

  // ── 2. gates over the whole history, and the latest day's watch list ────────────────────────────────────────
  const prior = all.filter((s) => s.setup === 'D4' && s.tf === '1h');
  const gated = [], rejected = new Map(); const tfOK = all.filter((s) => Gates.TFS.includes(s.tf));
  const reason = (h) => h.replace(/^(\w+) against/, 'against').replace(/^[A-Z0-9]+'s daily bias is not \w+/, 'coin daily bias against').replace(/^stop .* is under/, 'stop under').replace(/^\d+ warnings/, '2+ warnings');
  const countReasons = (list) => Object.fromEntries([...list.reduce((m, s) => { for (const h of s._g.hard) { const k = reason(h); m.set(k, (m.get(k) || 0) + 1); } return m; }, new Map()).entries()].sort((a, b) => b[1] - a[1]));
  for (const s of tfOK) {
    const g = Gates.evaluate(s, regimeOf, prior); s._g = g;
    if (g.pass) gated.push(s); else for (const h of g.hard) { const k = reason(h); rejected.set(k, (rejected.get(k) || 0) + 1); }
  }
  const half = (list, which) => list.filter((s) => which === 1 ? s.day < SPLIT : s.day >= SPLIT);
  const subset = {
    gated: { all: Gates.stats(gated), firstHalf: Gates.stats(half(gated, 1)), secondHalf: Gates.stats(half(gated, 2)), bySetup: Gates.groupStats(gated, (s) => s.setup), byTf: Gates.groupStats(gated, (s) => s.tf), byDir: Gates.groupStats(gated, (s) => s.dir), byGrade: Gates.groupStats(gated, (s) => s.grade), byRegime: Gates.groupStats(gated, (s) => regimeOf(s.day) > 0 ? 'risk-on' : 'risk-off') },
    all4h1d: { all: Gates.stats(tfOK), firstHalf: Gates.stats(half(tfOK, 1)), secondHalf: Gates.stats(half(tfOK, 2)) },
    everything: { all: Gates.stats(all), firstHalf: Gates.stats(half(all, 1)), secondHalf: Gates.stats(half(all, 2)) },
    alerted: Gates.stats(all.filter((s) => s.alertedAt)),
    split: SPLIT, rejected: Object.fromEntries([...rejected.entries()].sort((a, b) => b[1] - a[1])),
  };
  const day = cov.last; const todays = all.filter((s) => s.day === day && Gates.TFS.includes(s.tf));
  const watch = todays.filter((s) => s._g.pass).sort((a, b) => (b.pot || 0) - (a.pot || 0));
  const digest = {
    updated: new Date().toISOString(), day, archiveThrough: lastDay, regime: regimeOut.latest, market: market.days[day] || null,
    counts: { signalsAll: all.filter((s) => s.day === day).length, signals4h1d: todays.length, passed: watch.length },
    rejectedToday: countReasons(todays.filter((s) => !s._g.pass)),
    watch: watch.map((s) => ({ id: s.id, t: s.t, S: s.S, sym: s.sym, setup: s.setup, name: s.name, tf: s.tf, dir: s.dir, grade: s.grade, pot: s.pot, px: s.px, bids: s.bids, w: s.w, avg: s.avg, stop: s.stop, stopPct: s.stopPct, tps: s.tps, avgTP: s.avgTP, room: s.room, roomLabel: s.roomLabel, size: s.size, beWin: s.beWin, why: s.why, entryText: s.entryText, warnings: s.warnings, soft: s._g.soft, ctx: s.ctx, ev: s.ev ? { st: s.ev.st, R: s.ev.R, uR: s.ev.uR, fill: s.ev.fill, done: s.ev.done } : null })),
    subset,
  };
  writeJSON(path.join(OUT, 'digest.json'), digest);
  const HC = ['t', 'day', 'S', 'setup', 'tf', 'dir', 'grade', 'stopPct', 'st', 'R', 'uR', 'done', 'regime'];
  writeJSON(path.join(OUT, 'history.json'), { cols: HC, rows: gated.map((s) => [s.t, s.day, s.S, s.setup, s.tf, s.dir, s.grade, s.stopPct, s.ev ? s.ev.st : null, s.ev && Number.isFinite(s.ev.R) ? s.ev.R : null, s.ev && Number.isFinite(s.ev.uR) ? s.ev.uR : null, s.ev && s.ev.done ? 1 : 0, regimeOf(s.day) > 0 ? 1 : -1]) });
  log(`gates: ${tfOK.length} 4h/1d signals in the history, ${gated.length} pass (${subset.gated.all.closed} closed: ${subset.gated.all.avgR}R, PF ${subset.gated.all.pf}; first half ${subset.gated.firstHalf.avgR}R, second half ${subset.gated.secondHalf.avgR}R) · ${day}: ${todays.length} 4h/1d signals, ${watch.length} on the watch list`);

  // ── 3. alerts ─────────────────────────────────────────────────────────────────────────────────────────────
  const head = `Fable · BTC ${fmt(latest.close)} vs daily MA100 ${fmt(latest.ma100)} (${latest.dist > 0 ? '+' : ''}${latest.dist}%) → ${regimeOut.latest.regime.toUpperCase()} (${latest.daysSinceFlip} d since the flip; daily EMA200/SMMA99 ${latest.smmaState > 0 ? 'above' : latest.smmaState < 0 ? 'below' : 'n/a'})\nBook A target ${regimeOut.latest.targets.A.exposure > 0 ? '+' : ''}${regimeOut.latest.targets.A.exposure}x BTC (${fmt(regimeOut.latest.targets.A.notional)} on ${fmt(ACCOUNT)}) · Book C ${regimeOut.latest.targets.C.exposure}x`;
  const send = async (kind, text) => { const r = await notify.send(text, OUT); alerts.push({ t: Date.now(), kind, day: latest.day, sent: r.sent, why: r.why || null, text }); log(`${kind} alert: ${r.sent ? 'sent' : r.why}`); };
  const tgOn = !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
  if (tgOn && !state.startSent) { await send('start', `${head}\n\nFable started. Flip alerts arrive after the daily close (00:00 UTC) that crosses the daily MA100; the watch-list digest follows the Krillin replay (about a day behind the archive). Planning aid only, not financial advice.`); state.startSent = alerts[alerts.length - 1].sent; }
  if (latest.flip && state.lastFlipDay !== latest.day) { state.lastFlipDay = latest.day; await send('flip', `🔔 REGIME FLIP at the ${latest.day} daily close → ${regimeOut.latest.regime.toUpperCase()}\n${head}\nExecute the same morning (a 24 h delay removed the replay-year gain).`); }
  if (day && state.lastDigestDay !== day) {
    state.lastDigestDay = day;
    const m = digest.market; const lines = [head, `Context ${day}: BTC daily ${m ? m.bias1d : '?'} / 4h ${m ? m.bias4h : '?'} / weekly ${m ? m.bias1w : '?'} · daily regime ${m ? m.reg1d : '?'} · 30-day ${m && Number.isFinite(m.chg30) ? (m.chg30 > 0 ? '+' : '') + m.chg30.toFixed(1) + '%' : '?'} · BTC at HTF resistance: ${todays.some((s) => s.ctx && s.ctx.btcAtRes) ? 'yes' : 'no'}`, ''];
    lines.push(`Watch list ${day} (4h/1d, gated): ${watch.length} of ${todays.length} signals passed`);
    if (watch.length) for (const s of watch.slice(0, 8)) lines.push(planLine(s, s._g)); else lines.push('• nothing passed the gates today');
    if (watch.length > 8) lines.push(`… and ${watch.length - 8} more on the page`);
    const rej = Object.entries(digest.rejectedToday).slice(0, 5).map(([k, v]) => `${v} ${k}`).join(' · '); if (rej) lines.push(`Rejected: ${rej}`);
    const g = subset.gated; lines.push('', `Gated subset so far: ${g.all.closed} closed, ${g.all.avgR}R avg, PF ${g.all.pf} (first half ${g.firstHalf.avgR}R / second half ${g.secondHalf.avgR}R). Everything: ${subset.everything.all.avgR}R, PF ${subset.everything.all.pf}.`, 'Planning aid only, not financial advice. https://wee-bey.github.io/krillin-scanner/fable/');
    await send('digest', lines.join('\n'));
  }
  writeJSON(path.join(OUT, 'alerts.json'), alerts.slice(-200));
  writeJSON(path.join(OUT, 'state.json'), state);
  log(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s · ${A.downloads} downloads`);
  fs.writeFileSync(path.join(OUT, 'last_run.txt'), runLog.join('\n') + '\n');
}
if (require.main === module) main().catch((e) => { log('FAILED: ' + (e && e.stack || e)); try { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'last_run.txt'), runLog.join('\n') + '\n'); } catch (e2) { /* ignore */ } process.exit(1); });
module.exports = { main };
