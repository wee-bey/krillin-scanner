#!/usr/bin/env node
/* mayne v1.2 · analysis of a research run (TEST_PLAN §4, §5, §7, §8).
   Reads <dir>/trades.json.gz and <dir>/diag.json.gz (from research-merge.js) and writes <dir>/report.md + summary.json.
   Usage: node mayne/v1.2/tools/analyze.js --dir RESULT_DIR [--base B0] [--select] [--portfolio VARIANT] */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => { if (x.startsWith('--')) a.push([x.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]); return a; }, []));
const DIR = path.resolve(args.dir); const BASE = args.base || 'B0';
const rd = (f) => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(DIR, f))).toString('utf8'));
const DAY = 864e5, WEEK = 7 * DAY, MON = 4 * DAY;
const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);
const sgn = (x, d = 2) => (x == null || !Number.isFinite(x) ? '—' : (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(d));
const MAJORS = new Set(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'HYPEUSDT']);
const MIN_N = { P1: 150, P2: 500 };

// ───────────────────────── stats ─────────────────────────
function rngF(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
function stats(rows, key = 'Rn') {
  const c = rows.filter((r) => r.st === 'closed' && Number.isFinite(r[key]));
  const n = c.length; if (!n) return { n: 0 };
  let sum = 0, wins = 0, pos = 0, neg = 0; for (const r of c) { sum += r[key]; if (r[key] > 0) { wins++; pos += r[key]; } else neg -= r[key]; }
  const srt = c.slice().sort((a, b) => a.tExit - b.tExit); let eq = 0, peak = 0, dd = 0; for (const r of srt) { eq += r[key]; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
  const t0 = Math.min(...c.map((r) => r.tArm)), t1 = Math.max(...c.map((r) => r.tArm));
  return { n, avg: sum / n, sum, win: wins / n, pf: neg > 0 ? pos / neg : null, dd, perMonth: n / Math.max(1, (t1 - t0) / (30.44 * DAY)) };
}
// block bootstrap over calendar weeks (TEST_PLAN §4)
function bootCI(rows, key = 'Rn', B = 2000, seed = 7) {
  const c = rows.filter((r) => r.st === 'closed' && Number.isFinite(r[key])); if (c.length < 10) return null;
  const wk = new Map(); for (const r of c) { const w = Math.floor((r.tArm - MON) / WEEK); if (!wk.has(w)) wk.set(w, [0, 0]); const x = wk.get(w); x[0] += r[key]; x[1]++; }
  const W = [...wk.values()]; const R = rngF(seed); const means = new Float64Array(B);
  for (let b = 0; b < B; b++) { let s = 0, n = 0; for (let i = 0; i < W.length; i++) { const x = W[Math.floor(R() * W.length)]; s += x[0]; n += x[1]; } means[b] = s / n; }
  means.sort(); const q = (p) => means[Math.min(B - 1, Math.max(0, Math.floor(p * B)))];
  return { lo90: q(0.05), hi90: q(0.95), lo95: q(0.025), hi95: q(0.975), weeks: W.length };
}
const year = (t) => new Date(t).getUTCFullYear();

// ───────────────────────── portfolio simulation (TEST_PLAN §4) ─────────────────────────
// 10,000 start; risk % of current equity per trade (riskAP for A+ when useGrade); 4% max open risk counted from arm to close /
// cancel; ≤ 3 open in the same direction; ties at the same arm time: grade, then volume rank.
function portfolio(rows, opt = {}) {
  const riskBase = opt.riskBase || 1, riskAP = opt.riskAP || 2, useGrade = !!opt.useGrade, maxOpen = opt.maxOpen || 4, maxDir = opt.maxDir || 3;
  const ev = rows.filter((r) => Number.isFinite(r.tArm) && (r.st === 'closed' || r.st === 'expired' || r.st === 'cancelled') && Number.isFinite(r.tExit))
    .sort((a, b) => a.tArm - b.tArm || (b.grade === 'A+' ? 2 : b.grade === 'A' ? 1 : 0) - (a.grade === 'A+' ? 2 : a.grade === 'A' ? 1 : 0) || a.rank - b.rank);
  let eq = 10000, peak = 10000, maxDD = 0; const open = []; const taken = []; let skipped = 0; const monthly = new Map();
  const closeUntil = (t) => {
    open.sort((a, b) => a.tExit - b.tExit);
    while (open.length && open[0].tExit <= t) { const p = open.shift(); const pnl = p.st === 'closed' && Number.isFinite(p.Rn) ? p.Rn * p.usd : 0; eq += pnl; peak = Math.max(peak, eq); maxDD = Math.max(maxDD, (peak - eq) / peak); const m = new Date(p.tExit).toISOString().slice(0, 7); monthly.set(m, (monthly.get(m) || 0) + pnl); if (p.st === 'closed') taken.push(p.Rn); }
  };
  const eq0 = []; let eqStart = null;
  for (const r of ev) {
    closeUntil(r.tArm);
    const rp = useGrade && r.grade === 'A+' ? riskAP : riskBase;
    const openRisk = open.reduce((a, p) => a + p.rp, 0), sameDir = open.filter((p) => p.dir === r.dir).length;
    if (openRisk + rp > maxOpen + 1e-9 || sameDir >= maxDir || open.some((p) => p.sym === r.sym && p.prof === r.prof)) { skipped++; continue; }
    if (eqStart == null) eqStart = r.tArm;
    open.push({ tExit: r.tExit, st: r.st, Rn: r.Rn, usd: eq * rp / 100, rp, dir: r.dir, sym: r.sym, prof: r.prof });
  }
  closeUntil(Infinity);
  let streak = 0, worst = 0; for (const x of taken) { if (x <= 0) { streak++; worst = Math.max(worst, streak); } else streak = 0; }
  const t0 = eqStart || 0, t1 = Math.max(...ev.map((r) => r.tExit)); const yrs = Math.max(0.25, (t1 - t0) / (365.25 * DAY));
  const months = [...monthly.entries()].sort(); const worstMonth = months.length ? Math.min(...months.map((m) => m[1])) : 0;
  return { end: eq, ret: eq / 10000 - 1, cagr: Math.pow(eq / 10000, 1 / yrs) - 1, maxDD, trades: taken.length, skipped, longestLosing: worst, worstMonthPct: worstMonth / 10000, years: yrs };
}

// ───────────────────────── main ─────────────────────────
function main() {
  const T = rd('trades.json.gz'); const C = T.cols; const meta = JSON.parse(fs.readFileSync(path.join(DIR, 'meta.json'), 'utf8'));
  const rows = T.rows.map((a) => { const o = {}; C.forEach((k, i) => { o[k] = a[i]; }); return o; });
  const byV = new Map(); for (const r of rows) { if (!byV.has(r.v)) byV.set(r.v, []); byV.get(r.v).push(r); }
  // C4 universe tiers: derived from B0 (post hoc, like the top-100 rule itself)
  if (byV.has(BASE)) {
    const b = byV.get(BASE);
    byV.set('C4-50', b.filter((r) => r.rank <= 50)); byV.set('C4-20', b.filter((r) => r.rank <= 20)); byV.set('C4-10', b.filter((r) => r.rank <= 10)); byV.set('C4-maj', b.filter((r) => MAJORS.has(r.sym)));
  }
  const profs = [...new Set(rows.map((r) => r.prof))].sort(); const years = [...new Set(rows.map((r) => year(r.tArm)))].sort();
  const out = { meta: { dir: DIR, armFrom: meta.armFrom, armTo: meta.armTo, engine: meta.engine, rows: rows.length }, profiles: {} };
  const md = [`# Mayne v1.2 research: ${path.basename(DIR)}`, '', `Setups armed ${meta.armFrom} → ${meta.armTo} · engine ${meta.engine} · ${rows.length} rows · made ${meta.merged}`, ''];
  for (const p of profs) {
    const res = {}; for (const [v, rs] of byV) { const x = rs.filter((r) => r.prof === p); const s = stats(x); if (!s.n) continue;
      res[v] = { all: s, gross: stats(x, 'Rg'), v11: stats(x, 'Rn11'), ci: bootCI(x), year: Object.fromEntries(years.map((y) => [y, stats(x.filter((r) => year(r.tArm) === y))])), regime: Object.fromEntries(['bull', 'bear', 'chop'].map((g) => [g, stats(x.filter((r) => r.reg === g))])) }; }
    out.profiles[p] = res; const b = res[BASE];
    md.push(`## ${p}`, '', `| Variant | Closed | Win | Avg R net | 90% CI | Avg R gross | v1.1 costs | PF | Δ vs ${BASE} | Δ by year | per month |`, '|---|---|---|---|---|---|---|---|---|---|---|');
    const order = [...Object.keys(res)].sort((a, b2) => (a === 'B0touch' ? -2 : a === BASE ? -1 : b2 === BASE || b2 === 'B0touch' ? 1 : a < b2 ? -1 : 1));
    for (const v of order) {
      const r = res[v]; const d = b && v !== BASE ? r.all.avg - b.all.avg : null;
      const dy = b && v !== BASE ? years.map((y) => (r.year[y].n && b.year[y].n ? sgn(r.year[y].avg - b.year[y].avg) : '—')).join(' / ') : '';
      md.push(`| ${v} | ${r.all.n} | ${(r.all.win * 100).toFixed(0)}% | ${sgn(r.all.avg, 3)} | ${r.ci ? `${sgn(r.ci.lo90)} … ${sgn(r.ci.hi90)}` : '—'} | ${sgn(r.gross.avg, 3)} | ${sgn(r.v11.avg, 3)} | ${r.all.pf ? r.all.pf.toFixed(2) : '—'} | ${d == null ? '' : sgn(d, 3)} | ${dy} | ${r.all.perMonth.toFixed(1)} |`);
    }
    md.push('');
    // selection rule (TEST_PLAN §7)
    if (args.select && b) {
      const fams = { C1: ['C1', 'C1b', 'C1c', 'C1d'], C2: ['C2a', 'C2b', 'C2c'], C3: ['C3', 'C3b'], C4: ['C4-50', 'C4-20', 'C4-10', 'C4-maj'], C5: ['C5'], C6: ['C6'], C7: ['C7'], C7b: ['C7b'], C8a: ['C8a'], C8b: ['C8b12', 'C8b24', 'C8b48'], C9a: ['C9a'], C9b: ['C9b'], C10: ['C10'] };
      const kept = []; md.push(`### Selection (TEST_PLAN §7) — ${p}`, '', '| Family | Best variant | Δ avg R | Years improved | Closed | Kept |', '|---|---|---|---|---|---|');
      for (const [f, vs] of Object.entries(fams)) {
        let best = null;
        for (const v of vs) { const r = res[v]; if (!r) continue; const d = r.all.avg - b.all.avg; const yi = years.filter((y) => r.year[y].n && b.year[y].n && r.year[y].avg - b.year[y].avg > 0).length;
          const pass = d >= 0.03 && yi >= 2 && r.all.n >= MIN_N[p]; const cand = { v, d, yi, n: r.all.n, pass };
          if (!best || (cand.pass && !best.pass) || (cand.pass === best.pass && cand.d > best.d)) best = cand; }
        if (!best) continue; if (best.pass) kept.push(best.v);
        md.push(`| ${f} | ${best.v} | ${sgn(best.d, 3)} | ${best.yi}/${years.length} | ${best.n} | ${best.pass ? '**yes**' : 'no'} |`);
      }
      out.profiles[p].kept = kept; md.push('', `Kept for ${p}: ${kept.length ? kept.join(', ') : 'none'}`, '');
    }
  }
  // diagnostics (TEST_PLAN §5)
  if (fs.existsSync(path.join(DIR, 'diag.json.gz'))) {
    const D = rd('diag.json.gz'); const dr = D.drows.map((a) => Object.fromEntries(D.dcols.map((k, i) => [k, a[i]]))); const pr = D.prows.map((a) => Object.fromEntries(D.pcols.map((k, i) => [k, a[i]])));
    md.push('## Diagnostics', '');
    md.push('### D1 excursions (filled B0 trades)', '', '| Profile | Trades | Median MFE to exit | Median MAE to exit | Median MFE in window | Reached +1R before −1R | +2R | +3R | Same-candle (D6) |', '|---|---|---|---|---|---|---|---|---|');
    const med = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
    out.diag = { D1: {}, D2: {} };
    for (const p of profs) { const x = dr.filter((r) => r.prof === p); if (!x.length) continue; const sh = (k) => x.filter((r) => r.best >= k).length / x.length;
      out.diag.D1[p] = { n: x.length, r1: sh(1), r2: sh(2), r3: sh(3), same: x.filter((r) => r.same).length };
      md.push(`| ${p} | ${x.length} | ${sgn(med(x.map((r) => r.mfeX)))}R | ${sgn(med(x.map((r) => r.maeX)))}R | ${sgn(med(x.map((r) => r.mfeH)))}R | ${(sh(1) * 100).toFixed(0)}% | ${(sh(2) * 100).toFixed(0)}% | ${(sh(3) * 100).toFixed(0)}% | ${x.filter((r) => r.same).length} |`); }
    md.push('', '### D2 random-entry baselines (gross R per trade; the real trades are the filled B0 trades they were drawn around)', '', '| Profile | Real B0 gross | Bias-only random gross | No-bias random gross | Real − bias-only (90% CI) | Bias-only − no-bias (90% CI) |', '|---|---|---|---|---|---|');
    for (const p of profs) {
      const real = (out.profiles[p][BASE] || {}).gross; const a = pr.filter((r) => r.prof === p && r.kind === 'bias'), n = pr.filter((r) => r.prof === p && r.kind === 'none'); if (!a.length) continue;
      const m = (z, k) => z.reduce((s, r) => s + r[k], 0) / z.length;
      // CI of differences by week-block bootstrap (pseudo-trades carry the arm week of their random bar)
      const diffCI = (A, Bv, kA, kB) => { const wk = new Map(); const add = (r, k, side) => { const w = Math.floor((r.tArm - MON) / WEEK); if (!wk.has(w)) wk.set(w, [0, 0, 0, 0]); const z = wk.get(w); if (side === 0) { z[0] += r[k]; z[1]++; } else { z[2] += r[k]; z[3]++; } }; A.forEach((r) => add(r, kA, 0)); Bv.forEach((r) => add(r, kB, 1));
        const W = [...wk.values()]; const R = rngF(11); const ds = []; for (let b2 = 0; b2 < 2000; b2++) { let s0 = 0, n0 = 0, s1 = 0, n1 = 0; for (let i = 0; i < W.length; i++) { const z = W[Math.floor(R() * W.length)]; s0 += z[0]; n0 += z[1]; s1 += z[2]; n1 += z[3]; } if (n0 && n1) ds.push(s0 / n0 - s1 / n1); } ds.sort((x, y) => x - y); return [ds[Math.floor(0.05 * ds.length)], ds[Math.floor(0.95 * ds.length)]]; };
      const realRows = (byV.get(BASE) || []).filter((r) => r.prof === p && r.st === 'closed' && Number.isFinite(r.Rg));
      const c1 = diffCI(realRows, a, 'Rg', 'Rg'), c2 = diffCI(a, n, 'Rg', 'Rg');
      out.diag.D2[p] = { real: real && real.avg, bias: m(a, 'Rg'), none: m(n, 'Rg'), realVsBias: c1, biasVsNone: c2 };
      md.push(`| ${p} | ${sgn(real && real.avg, 3)} | ${sgn(m(a, 'Rg'), 3)} (${a.length}) | ${sgn(m(n, 'Rg'), 3)} (${n.length}) | ${sgn((real && real.avg) - m(a, 'Rg'), 3)} (${sgn(c1[0])} … ${sgn(c1[1])}) | ${sgn(m(a, 'Rg') - m(n, 'Rg'), 3)} (${sgn(c2[0])} … ${sgn(c2[1])}) |`);
    }
    md.push('');
  }
  // D4 same-bar turn+trigger, D5 grade ranking per variant
  md.push('### D4 HTF turn and trigger on the same bar (B0 reversal setups)', '');
  for (const p of profs) { const x = (byV.get(BASE) || []).filter((r) => r.prof === p && !r.cont); if (x.length) md.push(`- ${p}: ${x.filter((r) => r.sameBar).length} of ${x.length} (${(x.filter((r) => r.sameBar).length / x.length * 100).toFixed(1)}%)`); }
  md.push('', '### D5 grade ranking (avg net R by grade)', '', '| Variant | Profile | A+ | A | B |', '|---|---|---|---|---|');
  for (const v of [BASE, 'C1', 'C1c', 'C1d']) for (const p of profs) { const x = (byV.get(v) || []).filter((r) => r.prof === p); if (!x.length) continue; const g = (k) => { const s = stats(x.filter((r) => r.grade === k)); return s.n ? `${sgn(s.avg, 3)} (${s.n})` : '—'; }; md.push(`| ${v} | ${p} | ${g('A+')} | ${g('A')} | ${g('B')} |`); }
  md.push('');
  if (args.portfolio) for (const v of String(args.portfolio).split(',')) for (const p of [...profs, 'P1+P2']) {
    const x = (byV.get(v) || []).filter((r) => p === 'P1+P2' || r.prof === p); if (!x.length) continue; const pf = portfolio(x);
    (out.portfolio = out.portfolio || {})[`${v}|${p}`] = pf;
    md.push(`- Portfolio ${v} ${p}: ${(pf.ret * 100).toFixed(1)}% total, CAGR ${(pf.cagr * 100).toFixed(1)}%, max DD ${(pf.maxDD * 100).toFixed(1)}%, ${pf.trades} trades (${pf.skipped} skipped by the risk caps), longest losing streak ${pf.longestLosing}, worst month ${(pf.worstMonthPct * 100).toFixed(1)}% of the start`);
  }
  fs.writeFileSync(path.join(DIR, 'report.md'), md.join('\n') + '\n');
  fs.writeFileSync(path.join(DIR, 'summary.json'), JSON.stringify(out, (k, v) => (typeof v === 'number' ? r3(v) : v), 1));
  console.log(md.join('\n'));
}
if (require.main === module) main();
module.exports = { stats, bootCI, portfolio };
