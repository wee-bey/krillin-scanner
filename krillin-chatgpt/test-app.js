'use strict';
const assert = require('node:assert/strict');
const App = require('./app.js');
const C = require('./core.js');
const K = require('../tools/lib/engine.js');
const AT = Date.UTC(2026, 9, 1), BAR = 9e5, REPEAT = 12 * 3600e3;
const copy = x => JSON.parse(JSON.stringify(x));
const manifest = (id = 'cohort-a', settings = {}) => ({ id, ruleVersion: C.POLICY.version, sourceDigest: 'fixed-test-source', source: 'binance-usdm', policy: C.POLICY, settings: { account: 5000, riskPct: 2, feePct: 0.05, slipPct: 0.03, universeSize: 100, ...settings } });
function raw(at, changes = {}) {
  return { id: 'B4', symbol: 'TEST', sym: 'TESTUSDT', t: at, tf: '4h', dir: 'long', px: 101, scanPrice: 101, status: 'active', watch: false, grade: 'B', gates: [], marketData: { closedAt: Math.floor(at / BAR) * BAR, valid: true }, plan: { bids: [100, 99, 98, 97].map((price, i) => ({ price, weight: C.POLICY.entryWeights[i] })), stop: 95, tps: [{ price: 105 }, { price: 110 }, { price: 115 }] }, ...changes };
}
function scan(at, rawSignals, changes = {}) { return { at, featureAt: Math.floor(at / BAR) * BAR, source: 'binance-usdm', rawSignals, counts: { scanned: 1, raw: rawSignals.length }, errors: [], universe: [{ sym: 'TESTUSDT', rank: 1, quoteVolume: 1e8 }], ...changes }; }
const initial = (changes = {}) => App.ingest(App.emptyState(), scan(AT, [raw(AT, changes)]), manifest());
const close = (state, record = 0) => { const next = copy(state); next.records[record].ev = { st: 'closed', done: true, coverageComplete: true, R: 1, tExit: AT + BAR, tp: [true, true, true] }; return next; };
let failures = 0;
function check(name, fn) { try { fn(); console.log('PASS: ' + name); } catch (e) { failures++; console.error('FAIL: ' + name + '\n' + e.message); } }

check('Raw observations and rules are saved without mutating previous state', () => {
  const before = App.emptyState(), original = JSON.stringify(before), state = App.ingest(before, scan(AT, [raw(AT)]), manifest());
  assert.equal(JSON.stringify(before), original);
  assert.equal(state.records.length, 1);
  assert.equal(state.records[0].accepted, true);
  assert.equal(state.records[0].decision.plan.riskUsd, 100);
  assert.equal(state.cohorts.length, 1);
  assert.deepEqual(state.events.map(e => e.type), ['rules', 'signal', 'scan']);
});

check('Same-key repeats and grade upgrades preserve the original paper entry', () => {
  const before = initial(), saved = JSON.stringify(before.records[0]), firstEvent = JSON.stringify(before.events[1]);
  const state = App.ingest(before, scan(AT + BAR, [raw(AT + BAR, { grade: 'A', px: 102 })]), manifest());
  assert.equal(state.records.length, 1);
  assert.equal(JSON.stringify(state.records[0]), saved);
  assert.equal(JSON.stringify(state.events[1]), firstEvent);
  assert.equal(state.records[0].decision.t, AT);
  assert.equal(state.records[0].decision.px, 101);
  assert.equal(state.latest.ideas[0].decisionId, state.records[0].id);
  assert.equal(state.latest.decisions[0].accepted, false);
  assert(state.events.some(e => e.type === 'upgrade' && e.at === AT + BAR && e.payload.grade === 'A'));
});

check('Overlapping setups create one accepted idea and preserve rejected counterfactuals', () => {
  const state = App.ingest(App.emptyState(), scan(AT, [raw(AT, { id: 'C3' }), raw(AT)]), manifest());
  assert.equal(state.latest.ideas.length, 1);
  assert.equal(state.latest.ideas[0].setupId, 'B4');
  assert.equal(state.latest.ideas[0].support.length, 2);
  assert.equal(state.records.length, 2);
  assert.equal(state.records.filter(r => r.accepted).length, 1);
  assert.equal(state.records.find(r => r.decision.setupId === 'C3').accepted, false);
  assert(state.records.find(r => r.decision.setupId === 'C3').decision.reasonCodes.includes('duplicate_idea'));
});

check('A valid setup outside the shortlist remains a rejected paper candidate', () => {
  const state = initial({ id: 'A1' });
  assert.equal(state.records.length, 1);
  assert.equal(state.records[0].accepted, false);
  assert.equal(state.records[0].decision.validPlan, true);
  assert.equal(state.latest.ideas.length, 0);
  assert(state.events.some(e => e.type === 'signal' && e.payload.decision.reasonCodes.includes('not_shortlisted')));
  const repeated = App.ingest(state, scan(AT + BAR, [raw(AT + BAR, { id: 'A1' })]), manifest());
  assert.equal(repeated.records.length, 1);
  assert(repeated.latest.decisions[0].reasonCodes.includes('repeat_window'));
});

check('Invalid candles, plans, engine gates and inactive setups are logged without paper evaluation', () => {
  for (const changes of [{ marketData: { closedAt: AT - 2 * BAR, valid: true } }, { marketData: { closedAt: AT, valid: false } }, { gates: ['Engine blocked'] }, { status: 'forming' }, { watch: true }, { px: 105 }, { plan: null }]) {
    const state = initial(changes);
    assert.equal(state.records.length, 0);
    assert.equal(state.latest.decisions.length, 1);
    assert.equal(state.latest.decisions[0].accepted, false);
    assert(state.events.some(e => e.type === 'signal'));
  }
  const badFeed = App.ingest(App.emptyState(), scan(AT, [raw(AT)], { source: 'bybit' }), manifest());
  assert.equal(badFeed.records.length, 0);
});

check('Closed episodes do not restart before the fixed repeat window', () => {
  const first = close(initial());
  const soon = App.ingest(first, scan(AT + 2 * BAR, [raw(AT + 2 * BAR)]), manifest());
  assert.equal(soon.records.length, 1);
  assert.equal(soon.latest.ideas.length, 0);
  assert(soon.latest.decisions[0].reasonCodes.includes('repeat_window'));
  const later = App.ingest(soon, scan(AT + REPEAT, [raw(AT + REPEAT)]), manifest());
  assert.equal(later.records.length, 2);
  assert.equal(later.records[1].accepted, true);
  assert.equal(later.records[0].decision.t, AT);
});

check('An unresolved same-key episode cannot create an untracked accepted idea after its zone moves', () => {
  const state = initial();
  const shifted = raw(AT + BAR, { px: 201, plan: { bids: [200, 199, 198, 197].map((price, i) => ({ price, weight: C.POLICY.entryWeights[i] })), stop: 195, tps: [{ price: 205 }, { price: 210 }, { price: 215 }] } });
  const next = App.ingest(state, scan(AT + BAR, [shifted]), manifest());
  assert.equal(next.records.length, 1);
  assert.equal(next.latest.decisions[0].accepted, false);
  assert(next.latest.decisions[0].reasonCodes.includes('repeat_window'));
  assert(next.latest.ideas.every(idea => next.records.some(r => r.id === idea.decisionId && r.accepted)));
});

check('Settings create separate cohorts and cannot mix their risk or outcomes', () => {
  const first = close(initial());
  const next = App.ingest(first, scan(AT + BAR, [raw(AT + BAR)]), manifest('cohort-b', { account: 1000, riskPct: 1 }));
  assert.equal(next.cohorts.length, 2);
  assert.equal(next.records.length, 2);
  assert.equal(next.records[0].decision.plan.riskUsd, 100);
  assert.equal(next.records[1].decision.plan.riskUsd, 10);
  assert.equal(C.summarize(App.forwardSignals(next, 'cohort-a')).total.netR, 1);
  assert.equal(C.summarize(App.forwardSignals(next, 'cohort-b')).total.closedN, 0);
});

check('Returning to a cohort recovers its original active idea rather than replacing its timestamp', () => {
  const first = initial();
  const other = App.ingest(first, scan(AT + BAR, [raw(AT + BAR)]), manifest('cohort-b', { account: 1000, riskPct: 1 }));
  const back = App.ingest(other, scan(AT + 2 * BAR, [raw(AT + 2 * BAR, { grade: 'A' })]), manifest());
  assert.equal(back.records.filter(r => r.cohortId === 'cohort-a').length, 1);
  assert.equal(back.latest.ideas[0].decisionId, first.records[0].id);
  assert.equal(back.latest.ideas[0].t, AT);
});

check('Forward comparison uses original accepted/rejected labels and excludes incomplete coverage', () => {
  const state = App.ingest(App.emptyState(), scan(AT, [raw(AT), raw(AT, { id: 'A1' }), raw(AT, { id: 'C3' })]), manifest());
  for (const r of state.records) r.ev = { st: 'closed', done: true, coverageComplete: true, R: r.accepted ? 1 : -0.5, tExit: AT + BAR };
  const summary = C.summarize(App.forwardSignals(state, 'cohort-a'));
  assert.equal(summary.accepted.closedN, 1);
  assert.equal(summary.rejected.closedN, 2);
  assert.equal(summary.accepted.netR, 1);
  assert.equal(summary.rejected.netR, -1);
  state.records[0].ev.coverageComplete = false;
  state.records[1].evaluationError = 'Missing coverage';
  const incomplete = C.summarize(App.forwardSignals(state, 'cohort-a'));
  assert.equal(incomplete.total.closedN, 1);
  assert.equal(incomplete.total.netR, -0.5);
  assert.equal(incomplete.total.pendingN, 2);
});

check('A mid-bar saved decision starts paper exposure at the next complete opening', () => {
  const at = AT + 60000, state = App.ingest(App.emptyState(), scan(at, [raw(at)]), manifest());
  const d = state.records[0].decision;
  const rows = [[AT, 101, 110, 90, 101, 1], [AT + BAR, 99.5, 100, 99.1, 99.5, 1]];
  const ev = C.simulate(d, K.fromRows(rows), AT + 2 * BAR);
  assert.equal(ev.activationAt, AT + BAR);
  assert.equal(ev.tFill, AT + BAR);
  assert.equal(ev.st, 'open');
  assert.equal(ev.coverageComplete, true);
});

if (failures) { process.exitCode = 1; console.error(failures + ' controller checks failed'); }
else console.log('Krillin Chatgpt controller: all offline assertions passed');
