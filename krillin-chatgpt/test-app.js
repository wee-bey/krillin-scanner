'use strict';
const assert = require('node:assert/strict');
const App = require('./app.js');
const C = require('./core.js');
const K = require('../tools/lib/engine.js');
const AT = Date.UTC(2026, 9, 4), BAR = 9e5, REPEAT = 12 * 3600e3;
const copy = x => JSON.parse(JSON.stringify(x));
const manifest = (id = 'cohort-a') => ({ id, ruleVersion: C.POLICY.version, sourceDigest: 'test-source', source: 'binance-usdm', policy: C.POLICY, settings: { account: 5000, riskPct: 2, feePct: .05, slipPct: .03, universeSize: 100 } });
function raw(id='A2', tf='4h', at=AT, changes={}) {
  return { id, symbol:'TEST', sym:'TESTUSDT', t:at, tf, dir:'long', px:101, status:'active', watch:false, grade:'B', gates:[],
    marketData:{closedAt:Math.floor(at/BAR)*BAR,valid:true}, plan:{ bids:[100,99,98,97].map((price,i)=>({price,weight:C.POLICY.entryWeights[i]})),stop:95,tps:[105,110,115].map(price=>({price})) }, ...changes };
}
const pair = (at=AT) => [raw('A2','4h',at),raw('A3','15m',at)];
const scan = (rawSignals,at=AT) => ({at,featureAt:Math.floor(at/BAR)*BAR,source:'binance-usdm',rawSignals,counts:{scanned:1},errors:[],universe:[{sym:'TESTUSDT',rank:1,quoteVolume:1e8}]});
const ingest = (state,rows,at=AT,id='cohort-a') => App.ingest(state,scan(rows,at),manifest(id));
const initial = () => ingest(App.emptyState(),pair());
const pending = state => { const s=copy(state);s.records.forEach(r=>{r.ev={st:'pending',done:false,coverageComplete:true};});return s; };
const close = state => { const s=copy(state);s.records.forEach(r=>{r.ev={st:'closed',done:true,coverageComplete:true,R:1,tExit:AT+BAR};});return s; };

const before=App.emptyState(), original=JSON.stringify(before), first=ingest(before,pair());
assert.equal(JSON.stringify(before),original);
assert.equal(first.records.length,2);
assert.equal(first.records.filter(r=>r.accepted).length,1);
assert.equal(first.latest.ideas.length,1);
assert.equal(first.latest.ideas[0].confluence.rating,10);
assert.deepEqual(first.latest.ideas[0].confluence.labels,['A2 4h','A3 15m']);
assert.equal(first.records[0].decision.plan.riskUsd,100);
assert.deepEqual(first.events.map(e=>e.type),['rules','signal','signal','scan']);

const repeated=ingest(pending(first),[raw('A2','4h',AT+BAR,{grade:'A'}),raw('A3','15m',AT+BAR)],AT+BAR);
assert.equal(repeated.records.length,2);
assert.equal(repeated.records[0].decision.t,AT);
assert.equal(repeated.latest.ideas[0].decisionId,first.latest.ideas[0].decisionId);
assert(repeated.latest.decisions.every(d=>!d.accepted && d.reasonCodes.includes('repeat_window')));
assert(repeated.events.some(e=>e.type==='upgrade' && e.payload.grade==='A'));
assert.equal(JSON.stringify(first.records[0].decision),JSON.stringify(repeated.records[0].decision));

// A rejected but valid unresolved plan can later supply support; its label is never rewritten.
const standalone=pending(ingest(App.emptyState(),[raw()]));
assert.equal(standalone.records[0].accepted,false);
assert(standalone.records[0].decision.reasonCodes.includes('no_positive_confluence'));
const supported=ingest(standalone,[raw('A3','15m',AT+BAR)],AT+BAR);
assert.equal(supported.records[0].accepted,false);
assert.equal(supported.records[1].accepted,true);
assert(supported.records[1].decision.confluence.supportIds.includes(standalone.records[0].id));
for (const mode of ['closed','incomplete','unavailable']) {
  const bad=copy(standalone);
  if (mode==='closed') bad.records[0].ev={st:'closed',done:true,coverageComplete:true};
  if (mode==='incomplete') bad.records[0].ev.coverageComplete=false;
  if (mode==='unavailable') bad.records[0].evaluationError='Unavailable candles';
  assert.equal(ingest(bad,[raw('A3','15m',AT+BAR)],AT+BAR).records.at(-1).accepted,false);
}
assert.equal(ingest(standalone,[raw('A3','15m',AT+BAR)],AT+BAR,'cohort-b').records.at(-1).accepted,false);

for (const changes of [{gates:['blocked']},{status:'forming'},{watch:true},{px:105},{plan:null},{marketData:{closedAt:AT-2*BAR,valid:true}}]) {
  const state=ingest(App.emptyState(),[raw(),raw('A3','15m',AT,changes)]);
  assert(state.records.every(r=>!r.accepted));
  assert.equal(state.latest.ideas.length,0);
}
for (const changes of [{sym:'OTHERUSDT',symbol:'OTHER'},{dir:'short',plan:{bids:[102,103,104,105].map((price,i)=>({price,weight:C.POLICY.entryWeights[i]})),stop:107,tps:[97,92,87].map(price=>({price}))}}]) {
  assert.equal(ingest(App.emptyState(),[raw(),raw('A3','15m',AT,changes)]).latest.ideas.length,0);
}
const negative=ingest(App.emptyState(),[raw('B2','1h'),raw('C2','1h'),raw('C6','1h')]);
assert.equal(negative.latest.ideas.length,0);
assert(negative.latest.decisions.every(d=>d.reasonCodes.includes('negative_confluence')));

// A nonpositive required subset blocks a positive subset containing the same new anchor.
const conflict=ingest(App.emptyState(),[raw('A1','1h'),raw('C3','4h'),raw('C6','4h'),raw('C6','1h')]);
assert.equal(conflict.latest.decisions.find(d=>d.setupId==='A1').accepted,false);
assert(conflict.latest.decisions.find(d=>d.setupId==='A1').reasonCodes.includes('negative_confluence'));

const closed=close(first);
assert.equal(ingest(closed,pair(AT+2*BAR),AT+2*BAR).records.length,2);
assert.equal(ingest(closed,pair(AT+REPEAT),AT+REPEAT).records.filter(r=>r.accepted).length,2);
const unresolved=ingest(pending(first),pair(AT+REPEAT),AT+REPEAT);
assert.equal(unresolved.records.length,2);
const other=ingest(first,pair(AT+BAR),AT+BAR,'cohort-b');
assert.equal(other.cohorts.length,2);
const back=ingest(other,pair(AT+2*BAR),AT+2*BAR);
assert.equal(back.records.filter(r=>r.cohortId==='cohort-a').length,2);
assert.equal(back.latest.ideas[0].t,AT);

const outcomes=close(first);
outcomes.records[1].ev.R=-.5;
let stats=C.summarize(App.forwardSignals(outcomes,'cohort-a'));
assert.equal(stats.accepted.closedN,1);
assert.equal(stats.rejected.closedN,1);
outcomes.records[0].ev.coverageComplete=false;
stats=C.summarize(App.forwardSignals(outcomes,'cohort-a'));
assert.equal(stats.total.closedN,1);
assert.equal(stats.total.netR,-.5);

const mid=AT+60000,state=ingest(App.emptyState(),pair(mid),mid);
const ev=C.simulate(state.records[0].decision,K.fromRows([[AT,101,110,90,101,1],[AT+BAR,99.5,100,99.1,99.5,1]]),AT+2*BAR);
assert.equal(ev.activationAt,AT+BAR);
assert.equal(ev.tFill,AT+BAR);
assert.equal(ev.coverageComplete,true);

const positives=C.EVIDENCE.rules.filter(r=>r.meanR>0);
assert.equal(positives.length,76);
assert.equal(positives[0].rating,10);
assert.equal(positives.at(-1).rating,1);
assert(positives.every((r,i)=>Number.isInteger(r.rating)&&r.rating>=1&&r.rating<=10&&(!i||r.rating<=positives[i-1].rating)));
assert(C.EVIDENCE.rules.filter(r=>r.meanR<=0).every(r=>r.rating===null));
const low=ingest(App.emptyState(),[raw('C3','4h'),raw('D4','1d')]);
assert.equal(low.latest.ideas[0].confluence.rating,1);
console.log('Controller checks passed: positive/negative confluence, 10–1 ratings, active rejected support, validity, repeats, immutable cohorts, paper timing and coverage.');
