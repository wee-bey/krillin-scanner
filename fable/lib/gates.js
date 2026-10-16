/* Fable · watch-list gates (pure functions; node and browser)

   Applied to the Krillin replay's signal records (data/signals-YYYY-MM.json). A record passes when every hard gate
   holds; the course's timing rules are returned as soft warnings. The gates are the summary's "don't trade when"
   list plus the patterns that were negative in BOTH halves of the replay year (HANDOFF §5d-§5f). They remove the
   reliably bad; they do not by themselves make a setup profitable. "BTC at HTF resistance" is a soft flag (see below).

   regimeOf(day): the Fable regime state (1 risk-on / -1 risk-off) as of the daily close BEFORE that day, or 0/undefined.
*/
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(); else root.FableGates = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const TFS = new Set(['4h', '1d']);
  const MIN_STOP = 1.0, PREF_STOP = 2.0;
  const DAY = 864e5;
  const dayOf = (t) => new Date(t).toISOString().slice(0, 10);

  function biasAgainst(s) { // the engine's grade lists "A+ requires a <want> daily bias" when the coin's daily bias is not the trade's direction
    const want = s.dir === 'long' ? 'bullish' : 'bearish';
    return (s.missing || []).some((m) => m.startsWith('A+ requires') && m.includes(`a ${want} daily bias`));
  }
  // bad stack from §5d that can occur on 4h/1d: D4@1d within 72 h after a D4@1h on the same coin and direction
  function badStack(s, prior) { if (!(s.setup === 'D4' && s.tf === '1d')) return false; return (prior || []).some((p) => p.S === s.S && p.dir === s.dir && p.setup === 'D4' && p.tf === '1h' && p.t <= s.t && s.t - p.t <= 72 * 3600e3); }

  function evaluate(s, regimeOf, prior) {
    const hard = [], soft = [];
    if (s.setup === 'RG') return { pass: false, hard: ['regime trade, tracked separately'], soft };
    if (!TFS.has(s.tf)) hard.push(`${s.tf} setup: the watch list is 4h and daily only`);
    const reg = regimeOf ? regimeOf(s.day || dayOf(s.t)) : 0;
    if (!reg) hard.push('no BTC regime for this day');
    else if ((reg > 0) !== (s.dir === 'long')) hard.push(`${s.dir} against the BTC regime (${reg > 0 ? 'risk-on' : 'risk-off'})`);
    if (biasAgainst(s)) hard.push(`${s.S}'s daily bias is not ${s.dir === 'long' ? 'bullish' : 'bearish'}`);
    const w = s.warnings || [];
    if (w.some((x) => /pre-pump/i.test(x))) hard.push('pre-pump: daily MA100 descending above price');
    if (w.some((x) => /highs shrinking/i.test(x))) hard.push('highs shrinking: momentum waning');
    if (w.length >= 2) hard.push(`${w.length} warnings`);
    if (!(s.stopPct >= MIN_STOP)) hard.push(`stop ${Number.isFinite(s.stopPct) ? s.stopPct.toFixed(2) : '?'}% is under ${MIN_STOP}%`);
    else if (s.stopPct < PREF_STOP) soft.push(`stop ${s.stopPct.toFixed(2)}% is under ${PREF_STOP}%: costs weigh more`);
    // The course says no alt longs with BTC at HTF resistance, but the engine's flag fires on 95% of days and alt longs do
    // no worse when it is on (notes/regime_alignment_funding.md §2), so since 2026-10-16 it is a flag, not a gate.
    if (s.dir === 'long' && s.S !== 'BTC' && s.ctx && s.ctx.btcAtRes) soft.push('BTC at HTF resistance (the engine flags this on 95% of days)');
    if (badStack(s, prior)) hard.push('D4@1d right after a D4@1h on the same coin (a reliably bad stack)');
    // course timing rules, untested here: soft only
    const d = new Date(s.t); const dow = d.getUTCDay(), hr = d.getUTCHours();
    if (dow === 0 || dow === 6) soft.push('weekend signal');
    if (hr >= 21 || hr < 1) soft.push('dead hour (after the US close, before Asia)');
    return { pass: hard.length === 0, hard, soft };
  }

  // stats on a list of records that carry ev (the replay's paper-trade result)
  function stats(list) {
    const closed = list.filter((s) => s.ev && s.ev.done && Number.isFinite(s.ev.R));
    const R = closed.map((s) => s.ev.R); const wins = R.filter((x) => x > 0), losses = R.filter((x) => x <= 0);
    const sum = (a) => a.reduce((x, y) => x + y, 0);
    const mean = R.length ? sum(R) / R.length : null; const gp = sum(wins), gl = -sum(losses);
    return { n: list.length, closed: R.length, winRate: R.length ? +(wins.length / R.length).toFixed(3) : null, avgR: mean === null ? null : +mean.toFixed(3), totalR: +sum(R).toFixed(1), pf: gl > 0 ? +(gp / gl).toFixed(2) : (gp > 0 ? Infinity : null) };
  }
  function groupStats(list, keyFn) { const g = new Map(); for (const s of list) { const k = keyFn(s); if (!g.has(k)) g.set(k, []); g.get(k).push(s); } const out = {}; for (const [k, v] of g) out[k] = stats(v); return out; }

  return { TFS: [...TFS], MIN_STOP, PREF_STOP, evaluate, biasAgainst, badStack, stats, groupStats, DAY };
});
