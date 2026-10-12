#!/usr/bin/env node
/* Mayne × Krillin confluence (CONFLUENCE_PLAN.md). Research only: joins Krillin's replayed signals (data/ on main) with
   the Mayne v1.2 engine's state log, daily W/D bias and B0 trades (research run "confluence-mayne").
   Default: DECIDE only (2025-09-01 → 2026-03-31) and the selection of §4.
   --confirm K3,M1-P1  prints CONFIRM (2026-04-01 → 2026-10-10) for the named candidates only (the one planned look).
   Usage: node mayne/v1.2/tools/confluence.js --mayne RESULT_DIR [--krillin data] [--confirm LIST] [--out FILE.md] */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { bootCI } = require('./analyze.js');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => { if (x.startsWith('--')) a.push([x.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]); return a; }, []));
const MD = path.resolve(args.mayne); const KD = path.resolve(args.krillin || path.join(__dirname, '..', '..', '..', 'data'));
const DAY = 864e5, H = 36e5;
const D0 = Date.UTC(2025, 8, 1), SPLIT = Date.UTC(2026, 3, 1), SUB = Date.UTC(2026, 0, 1), END = Date.UTC(2026, 9, 11);
const TF = { P1: H, P2: 15 * 6e4 }, WIN = { P1: 24 * H, P2: 6 * H };
const gz = (f) => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(MD, f))).toString('utf8'));
const sgn = (x, d = 3) => (x == null || !Number.isFinite(x) ? '—' : (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(d));

// ── Krillin signals (resolved)
const K = [];
for (const f of fs.readdirSync(KD).filter((x) => /^signals-\d{4}-\d{2}\.json$/.test(x)).sort()) {
  for (const s of JSON.parse(fs.readFileSync(path.join(KD, f), 'utf8')).signals) {
    const ev = s.ev || {}; if (ev.st !== 'closed' || !Number.isFinite(ev.R)) continue;
    K.push({ sym: s.sym, t: s.t, dir: s.dir === 'long' ? 1 : -1, grade: s.grade, tf: s.tf, setup: s.setup, R: ev.R, tArm: s.t, st: 'closed', Rn: ev.R });
  }
}
// ── Mayne state log, daily bias, trades
const E = gz('events.json.gz'); const T = gz('trades.json.gz');
const SL = new Map(); // sym|prof → { t:[], st:[], dir:[] }
for (const [sym, prof, tc, st, dir] of E.zrows) { const k = sym + '|' + prof; if (!SL.has(k)) SL.set(k, { t: [], st: [], dir: [] }); const x = SL.get(k); x.t.push(tc); x.st.push(st); x.dir.push(dir); }
for (const x of SL.values()) { const ix = x.t.map((_, i) => i).sort((a, b) => x.t[a] - x.t[b]); x.t = ix.map((i) => x.t[i]); x.st = ix.map((i) => x.st[i]); x.dir = ix.map((i) => x.dir[i]); }
const stateAt = (sym, prof, t) => { const x = SL.get(sym + '|' + prof); if (!x) return null; let lo = 0, hi = x.t.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (x.t[m] <= t) { r = m; lo = m + 1; } else hi = m - 1; } return r < 0 ? null : { st: x.st[r], dir: x.dir[r] }; };
const BIAS = new Map(); for (const [sym, day, b] of E.brows) BIAS.set(sym + '|' + day, b);
const biasAt = (sym, t) => BIAS.get(sym + '|' + Math.floor(t / DAY) * DAY);
const MT = T.rows.map((a) => Object.fromEntries(T.cols.map((k, i) => [k, a[i]]))).filter((r) => r.v === 'B0' && r.st === 'closed' && Number.isFinite(r.Rn));
// Krillin signals per coin, sorted by time
const KS = new Map(); for (const k of K) { if (!KS.has(k.sym)) KS.set(k.sym, []); KS.get(k.sym).push(k); } for (const a of KS.values()) a.sort((x, y) => x.t - y.t);
const kIn = (sym, t0, t1) => { const a = KS.get(sym) || []; let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m].t < t0) lo = m + 1; else hi = m; } const o = []; for (let i = lo; i < a.length && a[i].t <= t1; i++) o.push(a[i]); return o; };

// ── candidates
const live = (s, d) => s && s.st >= 2 && s.dir === d, turned = (s, d) => s && s.st >= 3 && s.dir === d;
const KC = {
  K1: (k) => live(stateAt(k.sym, 'P1', k.t), k.dir),
  K2: (k) => live(stateAt(k.sym, 'P2', k.t), k.dir),
  K3: (k) => live(stateAt(k.sym, 'P1', k.t), k.dir) || live(stateAt(k.sym, 'P2', k.t), k.dir),
  K4: (k) => biasAt(k.sym, k.t) === k.dir,
  K5: (k) => turned(stateAt(k.sym, 'P1', k.t), k.dir) || turned(stateAt(k.sym, 'P2', k.t), k.dir),
};
const MC = {
  M1: (m) => { const tc = m.tArm + TF[m.prof]; return kIn(m.sym, tc - WIN[m.prof], tc).some((k) => k.dir === m.dir); },
  M2: (m) => { const tc = m.tArm + TF[m.prof]; return kIn(m.sym, tc - WIN[m.prof], tc).some((k) => k.dir === m.dir && (k.grade === 'A' || k.grade === 'A+')); },
  M3: (m) => { const tc = m.tArm + TF[m.prof]; return !kIn(m.sym, tc - WIN[m.prof], tc).some((k) => k.dir !== m.dir); },
};
const avg = (a, k) => (a.length ? a.reduce((s, r) => s + r[k], 0) / a.length : NaN);
const per = (a, t0, t1, tk) => a.filter((r) => r[tk] >= t0 && r[tk] < t1);
const J = { groups: {}, confirm: [] };
const md = ['# Mayne × Krillin confluence', '', `Krillin resolved signals: ${K.length} · Mayne B0 closed trades: ${MT.length} · Mayne state changes: ${E.zrows.length}`, ''];

function group(name, base, cands, key, minN) {
  const dec = per(base, D0, SPLIT, 'tArm'), s1 = per(base, D0, SUB, 'tArm'), s2 = per(base, SUB, SPLIT, 'tArm');
  md.push(`## ${name} — DECIDE (2025-09-01 → 2026-03-31)`, '', `Base: ${dec.length} · avg ${sgn(avg(dec, key))}R (Sep–Dec ${sgn(avg(s1, key))}, Jan–Mar ${sgn(avg(s2, key))})`, '', '| Candidate | Kept | Avg R | Δ vs base | Δ Sep–Dec | Δ Jan–Mar | Passes |', '|---|---|---|---|---|---|---|');
  let best = null;
  for (const [c, f] of Object.entries(cands)) {
    const a = dec.filter(f), a1 = s1.filter(f), a2 = s2.filter(f); const d = avg(a, key) - avg(dec, key), d1 = avg(a1, key) - avg(s1, key), d2 = avg(a2, key) - avg(s2, key);
    const pass = d >= 0.05 && d1 > 0 && d2 > 0 && a.length >= minN;
    (J.groups[name] = J.groups[name] || { base: { n: dec.length, avg: avg(dec, key) }, cands: [] }).cands.push({ c, n: a.length, avg: avg(a, key), d, d1, d2, pass });
    md.push(`| ${c} | ${a.length} | ${sgn(avg(a, key))} | ${sgn(d)} | ${sgn(d1)} | ${sgn(d2)} | ${pass ? '**yes**' : 'no'} |`);
    if (pass && (!best || d > best.d)) best = { c, d };
  }
  md.push('', `Goes to CONFIRM: ${best ? best.c : 'none'}`, '');
  return best ? best.c : null;
}
const picks = {};
picks.K = group('Krillin signals filtered by Mayne context', K, KC, 'R', 300);
for (const p of ['P1', 'P2']) picks['M-' + p] = group(`Mayne ${p} trades filtered by Krillin`, MT.filter((r) => r.prof === p), MC, 'Rn', 100);

if (args.confirm) {
  md.push('## CONFIRM (2026-04-01 → 2026-10-10) — the one planned look', '', '| Group | Candidate | Base avg R (n) | Candidate avg R (n) | 90% CI | Verdict |', '|---|---|---|---|---|---|');
  for (const want of String(args.confirm).split(',')) {
    const [c, p] = want.split('-'); const isK = c.startsWith('K');
    const base = isK ? per(K, SPLIT, END, 'tArm') : per(MT.filter((r) => r.prof === p), SPLIT, END, 'tArm'); const key = isK ? 'R' : 'Rn';
    const a = base.filter(isK ? KC[c] : MC[c]); const ci = bootCI(a.map((r) => Object.assign({}, r, { Rn: r[key] })), 'Rn');
    const m = avg(a, key); const verdict = m > 0 && ci && ci.lo90 > 0 ? 'PASS' : m > 0 ? 'PROMISING' : 'FAIL';
    J.confirm.push({ group: isK ? 'Krillin side' : 'Mayne ' + p, c, base: { n: base.length, avg: avg(base, key) }, n: a.length, avg: m, ci, verdict });
    md.push(`| ${isK ? 'Krillin side' : 'Mayne ' + p} | ${c} | ${sgn(avg(base, key))} (${base.length}) | ${sgn(m)} (${a.length}) | ${ci ? `${sgn(ci.lo90, 2)} … ${sgn(ci.hi90, 2)}` : '—'} | **${verdict}** |`);
  }
  md.push('');
}
const out = md.join('\n') + '\n'; if (args.out) fs.writeFileSync(path.resolve(args.out), out); console.log(out);
if (args.json) fs.writeFileSync(path.resolve(args.json), JSON.stringify(J, (k, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v)));
console.log('PICKS ' + JSON.stringify(picks));
