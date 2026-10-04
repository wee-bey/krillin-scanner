/* Krillin Chatgpt: pure, versioned signal decisions and independent paper evaluation.
   The original engine is reused unchanged. R totals are not portfolio returns. */
(function (root) {
  'use strict';
  const K = typeof module !== 'undefined' && module.exports ? require('../tools/lib/engine.js') : root.KE;
  const EVIDENCE = typeof module !== 'undefined' && module.exports ? require('./confluence-data.js') : root.KCConfluence;
  const finite = Number.isFinite;
  const snapshot = value => JSON.parse(JSON.stringify(value));
  function freeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
  const POLICY = freeze({ version: 'kc-2026-10-04-confluence-v2', source: 'binance-usdm', paperActivation: 'next-15m-open', account: 5000, riskPct: 2, feePct: 0.05, slipPct: 0.03, entryWindowCandles: 20, timeStopCandles: 100, maxAgeMs: 15 * 60e3, entryWeights: [0.1, 0.2, 0.3, 0.4], confluenceSnapshot: EVIDENCE.snapshot });

  // Forming bars never reach the original engine. Gaps remain explicit for the caller.
  function closedRows(input, tf, at) {
    const duration = K.TF_MS[tf];
    if (!duration || !finite(at) || !Array.isArray(input)) return { rows: [], series: K.fromRows([]), closedAt: null, stale: true, invalid: 1, gaps: 0 };
    let invalid = 0;
    const rows = [];
    for (const raw of input) {
      if (!Array.isArray(raw) || raw.length < 5) { invalid++; continue; }
      const r = raw.slice(0, 6).map(Number);
      if (r.length === 5) r.push(0);
      if (!r.every(finite) || r[0] < 0 || r[0] % duration !== 0 || r.slice(1, 5).some(x => x <= 0) || r[5] < 0 || r[2] < Math.max(r[1], r[3], r[4]) || r[3] > Math.min(r[1], r[2], r[4])) { invalid++; continue; }
      if (r[0] + duration <= at) rows.push(r);
    }
    rows.sort((a, b) => a[0] - b[0]);
    const unique = [];
    for (const r of rows) { if (unique.length && r[0] === unique[unique.length - 1][0]) { invalid++; continue; } unique.push(r); }
    const closedAt = unique.length ? unique[unique.length - 1][0] + duration : null;
    const gaps = unique.reduce((n, r, i) => n + (i && r[0] - unique[i - 1][0] > duration ? 1 : 0), 0);
    return { rows: unique, series: K.fromRows(unique), closedAt, stale: closedAt === null || at - closedAt >= duration, invalid, gaps };
  }

  function exitWeights(count, k) {
    if (count === 1) return [1];
    const first = 1 / (Math.max(0, k) + 1);
    return count === 2 ? [first, 1 - first] : [first, (1 - first) * 4 / 7, (1 - first) * 3 / 7];
  }
  function normalizePlan(plan, dir, price, settings) {
    const issues = [];
    const st = Object.assign({}, POLICY, settings || {});
    if (!['long', 'short'].includes(dir)) issues.push('Invalid direction');
    if (!finite(price) || price <= 0) issues.push('Missing current decision quote');
    if (!finite(st.account) || st.account <= 0 || !finite(st.riskPct) || st.riskPct <= 0 || st.riskPct > 100 || !finite(st.feePct) || st.feePct < 0 || !finite(st.slipPct) || st.slipPct < 0) issues.push('Invalid paper risk or cost settings');
    if (!plan || plan.invalid) return { plan: null, issues: issues.concat(plan && plan.invalid ? String(plan.invalid) : 'Missing trade plan') };
    const bids = Array.isArray(plan.bids) ? plan.bids.map((b, i) => ({ price: typeof b === 'number' ? b : b.price, weight: typeof b === 'number' ? (plan.w || POLICY.entryWeights)[i] : b.weight })) : [];
    const tps = Array.isArray(plan.tps) ? plan.tps.map(x => ({ price: Array.isArray(x) ? x[0] : x.price, label: Array.isArray(x) ? x[2] || '' : x.label || '' })) : [];
    if (!bids.length || bids.some(b => !finite(b.price) || b.price <= 0 || !finite(b.weight) || b.weight <= 0)) issues.push('Invalid entry ladder');
    if (!tps.length || tps.length > 3 || tps.some(x => !finite(x.price) || x.price <= 0)) issues.push('Invalid target ladder');
    if (!finite(plan.stop) || plan.stop <= 0) issues.push('Invalid stop');
    if (issues.length) return { plan: null, issues };
    const sign = dir === 'long' ? 1 : -1;
    const weightSum = bids.reduce((n, b) => n + b.weight, 0);
    bids.forEach(b => { b.weight /= weightSum; b.effectivePrice = dir === 'long' ? Math.min(b.price, price) : Math.max(b.price, price); });
    if (bids.some(b => sign * (b.price - plan.stop) <= 0) || sign * (price - plan.stop) <= 0) issues.push('Stop is already crossed or is on the wrong side of an entry');
    const shallowEntry = dir === 'long' ? Math.max(...bids.map(b => b.price)) : Math.min(...bids.map(b => b.price));
    if (tps.some((x, i) => sign * (x.price - (i ? tps[i - 1].price : shallowEntry)) <= 0)) issues.push('Targets are not ordered beyond every entry');
    if (sign * (tps[0].price - price) <= 0) issues.push('TP1 already reached at decision price');
    if (issues.length) return { plan: null, issues };
    const avg = bids.reduce((n, b) => n + b.weight * b.effectivePrice, 0);
    const sideFee = (st.feePct + st.slipPct / 2) / 100;
    const R = sign * (avg - plan.stop);
    // Deferred activation may lose a favorable quote. Size against original limit prices, not the improved quote.
    const riskPerUnit = bids.reduce((n, b) => n + b.weight * (sign * (b.price - plan.stop) + (b.price + plan.stop) * sideFee), 0);
    const estimatedStopLoss = R + (avg + plan.stop) * sideFee;
    const targetWeights = exitWeights(tps.length, sign * (tps[0].price - avg) / R);
    const netRewards = tps.map(x => sign * (x.price - avg) - (avg + x.price) * sideFee);
    const weightedNetR = netRewards.reduce((n, v, i) => n + v * targetWeights[i], 0) / riskPerUnit;
    if (!(weightedNetR > 0) || !finite(weightedNetR)) return { plan: null, issues: ['Full-plan weighted reward is nonpositive after modeled costs'] };
    const riskUsd = st.account * (st.riskPct / 100);
    const units = riskUsd / riskPerUnit;
    const size = units * avg;
    if (![avg, R, sideFee, riskPerUnit, riskUsd, units, size].every(finite) || !(units > 0)) return { plan: null, issues: ['Paper plan exceeds finite numeric limits'] };
    const first = targetWeights[0];
    const tp1ThenStopR = tps.length === 1 ? netRewards[0] / riskPerUnit : (first * netRewards[0] - (1 - first) * estimatedStopLoss) / riskPerUnit;
    return { plan: { bids, tps: tps.map((x, i) => Object.assign(x, { r: sign * (x.price - avg) / R, weight: targetWeights[i] })), stop: plan.stop, avg, R, sideFee, riskUsd, riskPerUnit, units, size, weightedNetR, tp1ThenStopR, settings: { account: st.account, riskPct: st.riskPct, feePct: st.feePct, slipPct: st.slipPct } }, issues: [] };
  }

  function qualify(raw, context) {
    raw = raw || {};
    context = context || {};
    const at = context.at;
    const setupId = raw.setupId || raw.setup || raw.id;
    const symbol = raw.symbol || raw.S || raw.sym || '';
    const reasons = [], reasonCodes = [];
    const reject = (code, message) => { reasonCodes.push(code); reasons.push(message); };
    if (!finite(at) || !finite(raw.t) || raw.t > at) reject('invalid_time', 'Invalid decision time');
    if (!symbol) reject('missing_symbol', 'Missing symbol');
    if (!K.TF_MS[raw.tf]) reject('invalid_timeframe', 'Invalid timeframe');
    if (context.source !== POLICY.source) reject('feed_mismatch', 'Market feed differs from the frozen Binance USDT-M policy');
    const maxAge = finite(context.maxAgeMs) && context.maxAgeMs >= 0 ? context.maxAgeMs : POLICY.maxAgeMs;
    if (!finite(context.closedAt) || context.closedAt > at || at - context.closedAt > maxAge || context.valid === false) reject('invalid_data', 'Missing, forming, stale, or invalid candle data');
    const dataValid = reasons.length === 0;
    if (raw.status !== 'active' || raw.watch) reject('inactive', 'Setup is not active');
    if (Array.isArray(raw.gates) && raw.gates.length) raw.gates.forEach(x => reject('engine_gate', 'Engine gate: ' + x));
    const price = context.price;
    const normalized = normalizePlan(raw.plan, raw.dir, price, context.settings);
    normalized.issues.forEach(x => reject('invalid_plan', x));
    const id = `${symbol}|${setupId}|${raw.tf}|${raw.dir}|${at}`;
    return freeze(snapshot({ id, t: at, symbol, sym: raw.sym || symbol, setupId, tf: raw.tf, dir: raw.dir, px: price, version: POLICY.version, accepted: reasons.length === 0, reasons, reasonCodes, raw, plan: normalized.plan, validPlan: !!normalized.plan, dataValid, context: { source: context.source, closedAt: context.closedAt, decisionAt: at } }));
  }

  // Qualification above validates candidates; this batch stage applies the frozen historical filter.
  function rateConfluence(input, records, at) {
    const usable = d => d.validPlan && d.dataValid && d.raw.status === 'active' && !d.raw.watch && !(d.raw.gates || []).length;
    const prior = (records || []).filter(r => usable(r.decision) && r.decision.t <= at && r.ev && r.ev.coverageComplete === true && !r.ev.done && !r.evaluationError).map(r => r.decision);
    const available = input.filter(d => usable(d) && !d.reasonCodes.includes('repeat_window')).concat(prior);
    return freeze(input.map(original => {
      const d = snapshot(original);
      if (!d.accepted) return d;
      const own = d.setupId + ' ' + d.tf;
      const peers = available.filter(p => p.sym === d.sym && p.dir === d.dir && p.t <= at);
      const labels = [...new Set(peers.map(p => p.setupId + ' ' + p.tf))].sort();
      const matches = EVIDENCE.rules.filter(r => r.labels.includes(own) && r.labels.every(x => labels.includes(x)));
      const negative = matches.find(r => r.meanR <= 0);
      const best = matches.find(r => r.meanR > 0);
      d.activeConfluence = labels;
      if (negative || !best) {
        d.accepted = false;
        d.reasonCodes.push(negative ? 'negative_confluence' : 'no_positive_confluence');
        d.reasons.push(negative ? 'Excluded nonpositive historical combination: ' + negative.labels.join(' + ') : 'No positive historical combination meets the sample screen');
      } else {
        d.confluence = snapshot(best);
        d.confluence.snapshot = EVIDENCE.snapshot;
        d.confluence.supportIds = peers.filter(p => p.id !== d.id && best.labels.includes(p.setupId + ' ' + p.tf)).map(p => p.id);
      }
      return d;
    }));
  }
  function priority(d) { return d.confluence ? -d.confluence.meanR : 0; }
  function zone(d) { return d.zone || (d.plan ? [Math.min(...d.plan.bids.map(b => b.price)), Math.max(...d.plan.bids.map(b => b.price))] : null); }
  function overlaps(a, b) { const x = zone(a), y = zone(b); return a.symbol === b.symbol && a.dir === b.dir && x && y && x[0] <= y[1] && y[0] <= x[1]; }
  function deduplicate(input, activeIdeas) {
    const decisions = input.map(snapshot);
    const ideas = (activeIdeas || []).map(snapshot);
    const accepted = decisions.filter(d => d.accepted).sort((a, b) => priority(a) - priority(b) || a.t - b.t || a.id.localeCompare(b.id));
    // ponytail: scans are small, so explicit pairwise zone matching stays readable; index by symbol if universe size becomes large.
    for (const d of accepted) {
      let idea = ideas.find(x => overlaps(d, x));
      if (idea) { d.accepted = false; d.reasons.push('Overlapping trade idea already represented'); (d.reasonCodes || (d.reasonCodes = [])).push('duplicate_idea'); d.duplicateOf = idea.id; }
      else { idea = { id: d.id, t: d.t, symbol: d.symbol, sym: d.sym, dir: d.dir, setupId: d.setupId, tf: d.tf, zone: zone(d), plan: d.plan, decisionId: d.id, confluence: d.confluence, support: [] }; ideas.push(idea); }
      if (!idea.support) idea.support = [];
      if (!idea.support.some(x => x.decisionId === d.id)) idea.support.push({ decisionId: d.id, setupId: d.setupId, tf: d.tf, t: d.t });
      d.ideaId = idea.id;
    }
    return freeze({ decisions, ideas });
  }

  function createEvent(type, at, payload) {
    if (!['signal', 'upgrade', 'outcome', 'scan', 'rules'].includes(type) || !finite(at)) throw new Error('Invalid event type or timestamp');
    const body = snapshot(payload);
    const json = JSON.stringify(body);
    let hash = 2166136261;
    for (let i = 0; i < json.length; i++) hash = Math.imul(hash ^ json.charCodeAt(i), 16777619);
    return freeze({ id: `${type}|${at}|${(hash >>> 0).toString(16)}`, type, at, version: POLICY.version, payload: body });
  }
  function appendEvents(existing, incoming) {
    const events = (existing || []).map(snapshot), known = new Map(events.map(e => [e.id, JSON.stringify(e)]));
    for (const event of incoming) {
      const json = JSON.stringify(event);
      if (known.has(event.id)) { if (known.get(event.id) !== json) throw new Error('An existing event ID cannot be rewritten'); continue; }
      known.set(event.id, json); events.push(snapshot(event));
    }
    return freeze(events);
  }

  // Every raw valid plan is evaluated independently, including rejected counterfactuals.
  // This recomputes from the immutable decision, so refreshing cannot introduce past fills.
  function simulate(signal, series, untilMs) {
    if (!signal || !signal.plan || !finite(signal.t) || !finite(signal.px) || !finite(untilMs) || untilMs < signal.t) return { st: 'invalid', done: false, reason: 'No valid immutable plan or evaluation time', R: null };
    const p = signal.plan, long = signal.dir === 'long', sign = long ? 1 : -1, tfMs = K.TF_MS[signal.tf];
    if (!tfMs || !['long', 'short'].includes(signal.dir) || ![p.stop, p.units, p.riskUsd].every(x => finite(x) && x > 0) || !finite(p.sideFee) || p.sideFee < 0 || !Array.isArray(p.bids) || !p.bids.length || p.bids.some(b => ![b.price, b.weight].every(x => finite(x) && x > 0)) || !Array.isArray(p.tps) || !p.tps.length || p.tps.some(x => !finite(x.price) || x.price <= 0)) return { st: 'invalid', done: false, reason: 'Invalid normalized paper plan', R: null };
    const bids = p.bids.map(b => ({ price: b.price, q: p.units * b.weight, done: false }));
    const tps = p.tps.map(x => ({ price: x.price, hit: false }));
    let pos = 0, avg = 0, filledQ = 0, fees = 0, pnl = 0, firstFill = null, exitT = null, st = 'pending', reason = null, amb = 0, lastT = signal.t, lastC = signal.px, f1 = null;
    const fills = [], exits = [];
    const fill = (b, price, t) => { fees += b.q * price * p.sideFee; avg = (avg * pos + price * b.q) / (pos + b.q); pos += b.q; filledQ += b.q; b.done = true; fills.push([t, price, b.q]); if (firstFill === null) firstFill = t; st = 'open'; };
    const exit = (q, price, t, why) => { q = Math.min(q, pos); if (!(q > 0)) return; fees += q * price * p.sideFee; pnl += sign * q * (price - avg); pos -= q; exits.push([t, price, q / filledQ, why]); if (pos <= p.units * 1e-9) { pos = 0; st = 'closed'; reason = why; exitT = t; } };
    const s = series || { t: [] }, entryEnd = signal.t + POLICY.entryWindowCandles * tfMs;
    // Orders activate at the next 15m opening. No exposure exists during the emission's partial bar.
    const firstBarAt = Math.ceil(signal.t / K.TF_MS['15m']) * K.TF_MS['15m'];
    let nextBarAt = firstBarAt;
    let dataMissing = false;
    for (let i = 0; i < s.t.length; i++) {
      const t = s.t[i]; if (t < signal.t) continue; if (t + K.TF_MS['15m'] > untilMs) break;
      const o = s.o[i], h = s.h[i], l = s.l[i], c = s.c[i];
      if (!finite(t) || ![o, h, l, c].every(x => finite(x) && x > 0) || h < Math.max(o, l, c) || l > Math.min(o, h, c) || t !== nextBarAt) { dataMissing = true; break; }
      lastT = t + K.TF_MS['15m']; nextBarAt = lastT; lastC = c;
      let filledNow = false;
      if (t < entryEnd && !tps.some(x => x.hit)) for (const b of bids) if (!b.done && (long ? l <= b.price : h >= b.price)) { fill(b, long ? Math.min(b.price, o) : Math.max(b.price, o), t); filledNow = true; }
      const stopHit = long ? l <= p.stop : h >= p.stop;
      if (stopHit) {
        if (pos > 0) { if (tps.some(x => !x.hit && (long ? h >= x.price : l <= x.price))) amb++; exit(pos, long ? Math.min(p.stop, o) : Math.max(p.stop, o), t, 'stop'); }
        else { st = 'invalidated'; reason = 'Stop before fill'; exitT = t; }
        break;
      }
      for (let k = 0; k < tps.length && pos > 0; k++) {
        const target = tps[k]; if (target.hit) continue; if (!(long ? h >= target.price : l <= target.price)) break;
        if (filledNow) { amb++; break; }
        if (k === 0) f1 = 1 / (Math.max(0, sign * (target.price - avg) / (sign * (avg - p.stop))) + 1);
        target.hit = true;
        const q = k === tps.length - 1 ? pos : k === 0 ? pos * f1 : pos * 4 / 7;
        exit(q, target.price, t, 'tp' + (k + 1));
      }
      if (st === 'closed') break;
      if (!pos) {
        if (long ? h >= tps[0].price : l <= tps[0].price) { st = 'missed'; reason = 'TP1 before any fill'; exitT = t; break; }
        if (lastT >= entryEnd) { st = 'expired'; reason = 'No fill in entry window'; exitT = lastT; break; }
      }
      if (pos > 0 && lastT >= firstFill + POLICY.timeStopCandles * tfMs) { exit(pos, c, lastT, 'time'); break; }
    }
    const marked = pos > 0 ? sign * pos * (lastC - avg) - pos * lastC * p.sideFee : 0;
    const done = ['closed', 'missed', 'invalidated', 'expired'].includes(st);
    const coverageComplete = !dataMissing && (done || untilMs < nextBarAt + K.TF_MS['15m']);
    return { st, done, reason, fill: filledQ / p.units, avgFill: filledQ ? avg : null, tFill: firstFill, tExit: exitT, R: (pnl - fees) / p.riskUsd, uR: pos > 0 ? (pnl - fees + marked) / p.riskUsd : null, tp: tps.map(x => x.hit), stopHit: reason === 'stop', amb, fills, exits, upd: lastT, coverageComplete, dataMissing, activationAt: firstBarAt, partialBarSkippedMs: firstBarAt - signal.t, fees, riskUsd: p.riskUsd, tp1Fraction: f1 };
  }

  function metrics(signals) {
    const closed = signals.filter(x => x.ev && x.ev.st === 'closed' && finite(x.ev.R)).sort((a, b) => (a.ev.tExit || a.t || 0) - (b.ev.tExit || b.t || 0));
    const values = closed.map(x => x.ev.R), wins = values.filter(x => x > 0.05), losses = values.filter(x => x < -0.05);
    let total = 0, peak = 0, drawdownR = 0;
    for (const value of values) { total += value; peak = Math.max(peak, total); drawdownR = Math.max(drawdownR, peak - total); }
    const grossWin = values.reduce((n, r) => n + Math.max(0, r), 0), grossLoss = values.reduce((n, r) => n - Math.min(0, r), 0);
    return { n: signals.length, closedN: values.length, openN: signals.filter(x => x.ev && x.ev.st === 'open').length, pendingN: signals.filter(x => !x.ev || x.ev.st === 'pending').length, unresolvedN: signals.filter(x => !x.ev || !x.ev.done).length, unfilledN: signals.filter(x => x.ev && ['missed', 'expired', 'invalidated'].includes(x.ev.st)).length, netR: total, avgR: values.length ? total / values.length : null, profitFactor: grossLoss > 0 ? grossWin / grossLoss : null, drawdownR, winRate: values.length ? wins.length / values.length : null, wins: wins.length, losses: losses.length };
  }
  function summarize(signals) {
    const map = new Map();
    for (const x of signals) { const key = `${x.setupId || x.setup || (x.raw && x.raw.id) || 'unknown'}|${x.tf}`; if (!map.has(key)) map.set(key, []); map.get(key).push(x); }
    return { total: metrics(signals), accepted: metrics(signals.filter(x => x.accepted === true)), rejected: metrics(signals.filter(x => x.accepted === false)), groups: [...map].map(([key, items]) => ({ key, setupId: key.split('|')[0], tf: key.split('|')[1], ...metrics(items) })).sort((a, b) => b.n - a.n || a.key.localeCompare(b.key)) };
  }
  const api = { POLICY, EVIDENCE: freeze(EVIDENCE), closedRows, normalizePlan, qualify, rateConfluence, deduplicate, createEvent, appendEvents, simulate, summarize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.KC = api;
})(typeof window !== 'undefined' ? window : globalThis);
