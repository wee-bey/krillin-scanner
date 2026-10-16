#!/usr/bin/env node
/* mayne fable · browser test for mayne/fable/index.html (copy of mayne/test-page.js, adapted). No internet needed:
   every fapi.binance.com request is answered with deterministic synthetic data; the forward-test files come from a
   replay that the real v1.1 replay tool runs offline on synthetic candles (same file shape), and evidence.json is the
   real research summary in mayne/v1.2/data/.

   Run:   node mayne/fable/test-page.js
   Env:   MAYNE_TEST_DIR  scratch dir for the synthetic replay and screenshots (default: <tmp>/mayne-page-test)
          SHOTS           screenshot dir (default: $MAYNE_TEST_DIR/shots)
          FRESH=1         rebuild the synthetic replay data instead of reusing it
          EXPLORE=1       only print which engine states the synthetic board produces (used to pick the test clock)
   Needs: playwright (npm i --no-save playwright@1.48.2 in a scratch dir if it is not importable) and Chromium
          (PLAYWRIGHT_BROWSERS_PATH, or CHROMIUM_PATH=/path/to/chromium). */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('assert');
const cp = require('child_process');
const ME = require('./lib/engine.js');

const REPO = path.resolve(__dirname, '..', '..');
const WORK = process.env.MAYNE_TEST_DIR || path.join(os.tmpdir(), 'mayne12-page-test');
const SHOTS = process.env.SHOTS || path.join(WORK, 'shots');
const DAY = 864e5, M5 = 3e5;

// ═════════════════════════ synthetic market ═════════════════════════
// The test clock. 30 s after a 15-minute close, so the last closed 5m / 15m candle is stable for minutes.
// Picked with EXPLORE=1 so the synthetic board shows real setups. NOW_MAIN: one ARMED and one ACTIVE trade;
// NOW_MIX: WATCH, FORMING, FORMING+ and ARMED at once (used for the screenshots).
const NOW_MAIN = Date.UTC(2026, 7, 26, 4, 15, 30), NOW_MIX = Date.UTC(2026, 8, 17, 20, 15, 30);
const FIXED_NOW = NOW_MAIN;
const T0 = Date.UTC(2024, 0, 1);                              // a Monday; the walks start here
const T_END = Date.UTC(2026, 9, 1);                           // the walks run beyond FIXED_NOW
// listed contracts. `seed` picks the random walk; the exchange also lists things the board must leave out.
const COINS = [
  { sym: 'BTCUSDT', p0: 42000, seed: 11, qv: 3.1e10 }, { sym: 'ETHUSDT', p0: 2300, seed: 23, qv: 1.8e10 },
  { sym: 'SOLUSDT', p0: 100, seed: 37, qv: 6.5e9 }, { sym: 'XRPUSDT', p0: 0.55, seed: 41, qv: 3.2e9 },
  { sym: '1000PEPEUSDT', p0: 0.0098, seed: 53, qv: 2.4e9 }, { sym: 'DOGEUSDT', p0: 0.09, seed: 67, qv: 1.9e9 },
];
const EXTRA = [   // present in ticker/exchangeInfo but must not be scanned
  { sym: 'USDCUSDT', qv: 4e9, contract: 'PERPETUAL' },                    // stablecoin
  { sym: 'WBTCUSDT', qv: 3e9, contract: 'PERPETUAL' },                    // wrapped
  { sym: 'BTCUSDT_261225', qv: 5e9, contract: 'CURRENT_QUARTER' },        // delivery contract
  { sym: 'PEPEUSDT', qv: 1e6, contract: 'PERPETUAL' },                    // same base as 1000PEPE, lower volume (dedupe)
];
const FAIL_COIN = { sym: 'ADAUSDT', p0: 0.4, seed: 71, qv: 1.5e9 };      // only listed in the failure scenario

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// 5m random walk with trending regimes and volatility clustering: enough structure for the engine to find zones.
function genWalk(c) {
  const r = rng(c.seed), n = Math.floor((T_END - T0) / M5), t = new Array(n), o = new Float64Array(n), h = new Float64Array(n), l = new Float64Array(n), cl = new Float64Array(n), v = new Float64Array(n);
  const gauss = () => { let s = 0; for (let i = 0; i < 6; i++) s += r(); return (s - 3) * 1.4142; };
  let p = c.p0, mu = 0, vs = 0, left = 0;
  for (let i = 0; i < n; i++) {
    if (left-- <= 0) { mu = (r() - 0.5) * 2 * 0.00009; if (r() < 0.2) mu = 0; left = 288 * (1 + r() * 9); }
    vs = vs * 0.995 + (r() - 0.5) * 0.06; const sig = 0.0011 * Math.exp(Math.max(-0.7, Math.min(0.9, vs * 4)));
    const ret = mu + sig * gauss(), q = p * (1 + ret);
    t[i] = T0 + i * M5; o[i] = p; cl[i] = q; h[i] = Math.max(p, q) * (1 + Math.abs(gauss()) * sig * 0.45); l[i] = Math.min(p, q) * (1 - Math.abs(gauss()) * sig * 0.45);
    v[i] = c.qv / 288 * (0.4 + r()) * (1 + Math.abs(ret) / sig * 0.2); p = q;
  }
  return { t, o: Array.from(o), h: Array.from(h), l: Array.from(l), c: Array.from(cl), v: Array.from(v) };
}
const cache = new Map();
function market(c) {
  if (cache.has(c.sym)) return cache.get(c.sym);
  const base = genWalk(c), tf = {};
  for (const k of ['15m', '1h', '4h', '12h', '1d', '1w']) tf[k] = ME.aggregate(base, M5, k, false);
  tf['5m'] = base;
  const m = { base, tf }; cache.set(c.sym, m); return m;
}
const upper = (a, x) => { let lo = 0, hi = a.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] <= x) lo = mid + 1; else hi = mid; } return lo; };  // # of items <= x
// what GET /fapi/v1/klines returns at time `now`: the last `limit` candles, the final one still forming
function klinesAt(c, interval, limit, now) {
  const m = market(c), C = m.tf[interval], ms = ME.TF_MS[interval];
  const end = upper(C.t, now), from = Math.max(0, end - limit), rows = [];
  for (let i = from; i < end; i++) {
    let o = C.o[i], h = C.h[i], l = C.l[i], cl = C.c[i], v = C.v[i];
    if (C.t[i] + ms > now) {                                   // forming candle: only the 5m bars that are closed by now
      const b = m.base, a = Math.max(0, upper(b.t, C.t[i] - 1)), z = upper(b.t, now - M5);
      if (z > a) { o = b.o[a]; cl = b.c[z - 1]; h = -Infinity; l = Infinity; v = 0; for (let k = a; k < z; k++) { h = Math.max(h, b.h[k]); l = Math.min(l, b.l[k]); v += b.v[k]; } } else { h = l = cl = o; v = 0; }
    }
    rows.push([C.t[i], String(o), String(h), String(l), String(cl), String(v), C.t[i] + ms - 1, String(v), 100, '0', '0', '0']);
  }
  return rows;
}
// the same preparation the page does: closed candles only, engine per profile
function boardStates(now, coins) {
  const out = [];
  for (const c of coins || COINS) {
    const K = {};
    for (const tf of ['1w', '1d', '12h', '4h', '1h', '15m']) {
      const ms = ME.TF_MS[tf], rows = klinesAt(c, tf, 499, now).filter((r) => r[0] + ms <= now);
      K[tf] = { t: rows.map((r) => r[0]), o: rows.map((r) => +r[1]), h: rows.map((r) => +r[2]), l: rows.map((r) => +r[3]), c: rows.map((r) => +r[4]), v: rows.map((r) => +r[5]) };
    }
    for (const prof of ['P1', 'P2']) {
      const P = ME.PROFILES[prof], res = ME.run({ W: K['1w'], D: K['1d'], Z: K[P.zone], CF: K[P.conf], T: K[P.trig] }, { profile: prof, sym: c.sym });
      out.push({ sym: c.sym, prof, st: res.state.stName, dir: res.state.dir, grade: res.state.trade ? res.state.trade.grade : '' });
    }
  }
  return out;
}

// ═════════════════════════ synthetic replay (real engine + real replay tool, offline) ═════════════════════════
function buildReplay(dir) {
  const off = path.join(dir, 'offline'), out = path.join(dir, 'replay-out');
  if (fs.existsSync(path.join(out, 'sweep.json')) && !process.env.FRESH) return out;
  fs.rmSync(off, { recursive: true, force: true }); fs.mkdirSync(off, { recursive: true });
  const endMs = Date.UTC(2026, 8, 24);                           // whole days only, through 2026-09-23
  for (const c of COINS) {
    const m = market(c);
    for (const tf of ['15m', '1d']) {
      const A = m.tf[tf], n = upper(A.t, endMs - ME.TF_MS[tf]), rows = [];
      for (let i = 0; i < n; i++) rows.push([A.t[i], A.o[i], A.h[i], A.l[i], A.c[i], A.v[i]]);
      fs.writeFileSync(path.join(off, `${c.sym}_${tf}.json`), JSON.stringify(rows));
    }
  }
  console.log('building the synthetic replay with tools/replay.js (about a minute) ...');
  cp.execFileSync(process.execPath, [path.join(REPO, 'mayne', 'tools', 'replay.js'), '--offline', off, '--out', out, '--cache', path.join(dir, 'cache'), '--from', '2024-05-01', '--sweep'], { stdio: 'inherit', cwd: REPO });
  return out;
}

// ═════════════════════════ browser side ═════════════════════════
function loadPlaywright() {
  const tries = [() => require('playwright'), () => require(path.join(process.env.PLAYWRIGHT_DIR || path.join(os.tmpdir(), 'mayne-pw'), 'node_modules', 'playwright'))];
  for (const f of tries) { try { return f(); } catch (e) { /* next */ } }
  throw new Error('playwright is not importable. Run: mkdir -p /tmp/mayne-pw && cd /tmp/mayne-pw && npm install --no-save playwright@1.48.2');
}
function serve(root) { // tiny static server for the repo root
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
    const f = path.normalize(path.join(root, p));
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); fs.createReadStream(f).pipe(res);
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(srv)));
}
const CORS = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'Retry-After' };

// Binance mock. `scn` tweaks the scenario: failCoin (listed, klines answer 500), flaky (first klines call of one coin answers 429).
function makeMock(scn, clockOffset) {
  const log = { klines: [], other: [], inflight: new Map(), maxCoins: 0 };
  const coins = COINS.concat(scn.failCoin ? [FAIL_COIN] : []);
  const bySym = Object.fromEntries(coins.map((c) => [c.sym, c]));
  const flakySeen = new Set();
  const nowSim = () => Date.now() + clockOffset;
  async function handler(route) {
    const url = new URL(route.request().url()), p = url.pathname;
    const send = (status, body, extra) => route.fulfill({ status, headers: Object.assign({ 'content-type': 'application/json' }, CORS, extra || {}), body: typeof body === 'string' ? body : JSON.stringify(body) });
    if (p === '/fapi/v1/ticker/24hr') {
      log.other.push(p);
      const rows = coins.map((c) => ({ symbol: c.sym, quoteVolume: String(c.qv), lastPrice: '1' })).concat(EXTRA.map((e) => ({ symbol: e.sym, quoteVolume: String(e.qv), lastPrice: '1' })));
      return send(200, rows);
    }
    if (p === '/fapi/v1/exchangeInfo') {
      log.other.push(p);
      const syms = coins.map((c) => ({ symbol: c.sym, contractType: 'PERPETUAL', status: 'TRADING' })).concat(EXTRA.map((e) => ({ symbol: e.sym, contractType: e.contract, status: 'TRADING' })), [{ symbol: 'OLDUSDT', contractType: 'PERPETUAL', status: 'SETTLING' }]);
      return send(200, { symbols: syms });
    }
    if (p === '/fapi/v1/klines') {
      const sym = url.searchParams.get('symbol'), iv = url.searchParams.get('interval'), limit = +url.searchParams.get('limit');
      log.klines.push({ sym, iv, limit, t: Date.now() });
      log.inflight.set(sym, (log.inflight.get(sym) || 0) + 1);
      const active = Array.from(log.inflight.values()).filter((x) => x > 0).length; log.maxCoins = Math.max(log.maxCoins, active);
      await new Promise((r) => setTimeout(r, 25));
      log.inflight.set(sym, log.inflight.get(sym) - 1);
      const c = bySym[sym];
      if (!c) return send(400, { code: -1121, msg: 'Invalid symbol.' });
      if (scn.failCoin && sym === FAIL_COIN.sym) return send(500, { code: -1000, msg: 'boom' });
      if (scn.flaky === sym && !flakySeen.has(iv)) { flakySeen.add(iv); return send(429, { code: -1003, msg: 'Too many requests' }, { 'retry-after': '1' }); }
      return send(200, klinesAt(c, iv, limit, nowSim()));
    }
    log.other.push(p); return send(404, { msg: 'unknown ' + p });
  }
  return { handler, log };
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const replayDir = buildReplay(WORK);
  const files = {}; for (const f of ['index', 'trades', 'sweep', 'market']) files[f] = fs.readFileSync(path.join(replayDir, f + '.json'), 'utf8');
  files['forward-index'] = files.index; files['forward-trades'] = files.trades; files.evidence = fs.readFileSync(path.join(REPO, 'mayne', 'fable', 'data', 'evidence.json'), 'utf8');
  const idx = JSON.parse(files.index);
  console.log(`synthetic replay: P1 ${idx.summary.P1.all.closed} closed, P2 ${idx.summary.P2.all.closed} closed`);

  const { chromium } = loadPlaywright();
  const srv = await serve(REPO); const BASE = `http://127.0.0.1:${srv.address().port}/mayne/fable/index.html`;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  let pass = 0; const ok = (name) => { pass++; console.log('ok  ' + name); };

  // opens the page with a fake clock (starts at FIXED_NOW), the Binance mock and the replay files
  async function open(width, o) {
    o = o || {};
    const ctx = await browser.newContext({ viewport: { width, height: o.height || 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage(); const errors = [];
    const offset = (o.now || FIXED_NOW) - Date.now();
    await page.addInitScript(({ offset, settings, blockStorage }) => {
      const RD = Date; class FD extends RD { constructor(...a) { if (a.length === 0) super(RD.now() + offset); else super(...a); } static now() { return RD.now() + offset; } } window.Date = FD;
      if (blockStorage) Object.defineProperty(window, 'localStorage', { get() { throw new Error('storage blocked'); } });
      else if (settings) localStorage.setItem('maynefable.settings.v1', JSON.stringify(settings));
    }, { offset, settings: o.settings, blockStorage: !!o.blockStorage });
    const mock = makeMock(o.scn || {}, offset);
    await page.route('https://fapi.binance.com/**', mock.handler);
    await page.route('**/mayne/fable/data/*.json', (route) => {
      if (o.noData) return route.fulfill({ status: 404, body: 'not found' });
      const name = route.request().url().split('/').pop().replace('.json', '');
      if (!files[name]) return route.fulfill({ status: 404, body: 'not found' });
      route.fulfill({ status: 200, contentType: 'application/json', body: files[name] });
    });
    const allowed = o.allowConsole || [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') { const t = m.text() + ' ' + (m.location().url || ''); if (!allowed.some((re) => re.test(t))) errors.push(m.type() + ': ' + t); } });
    page.on('requestfailed', (r) => { if (!/favicon/.test(r.url())) errors.push('requestfailed: ' + r.url()); });
    await page.goto(BASE);
    return { page, ctx, mock, errors };
  }
  const scanDone = (page) => page.waitForFunction(() => /Last scan/.test(document.querySelector('#st-text').textContent) && !document.querySelector('#scan-now').disabled, null, { timeout: 60000 });
  // screenshots of single sections (the full-page results shot is too tall to look at)
  const shotSections = async (page, tag) => {
    const sel = { equity: '.chartbox', profile: '#prof-block', evidence: () => { const h = Array.from(document.querySelectorAll('h2')).find((x) => /Stage A/.test(x.textContent)); return h.parentElement; }, trades: () => { const h = Array.from(document.querySelectorAll('h2')).find((x) => /Trade list/.test(x.textContent)); return h.parentElement; } };
    for (const [name, q] of Object.entries(sel)) {
      const h = typeof q === 'string' ? await page.$(q) : (await page.evaluateHandle(q)).asElement();
      await h.scrollIntoViewIfNeeded(); const bb = await h.boundingBox();
      if (bb.height > 1000) await page.screenshot({ path: path.join(SHOTS, `results-${name}-${tag}.png`), fullPage: true, clip: { x: bb.x, y: bb.y + (await page.evaluate(() => scrollY)), width: bb.width, height: 900 } });
      else await h.screenshot({ path: path.join(SHOTS, `results-${name}-${tag}.png`) });
    }
  };
  const noOverflow = async (page, w, what) => { const sw = await page.evaluate(() => document.documentElement.scrollWidth); assert.ok(sw <= w, `${what}: horizontal overflow (scrollWidth ${sw} > ${w})`); };

  if (process.env.EXPLORE) {
    const rows = boardStates(FIXED_NOW); console.table(rows); await browser.close(); srv.close(); return;
  }

  // ───── 1. unit-level checks through the page hook
  {
    const { page, errors } = await open(1280); await scanDone(page);
    const r = await page.evaluate(() => {
      const H = window.__mayne, q = 9e5, base = Date.UTC(2026, 0, 1, 12, 0, 0);
      return {
        n1: H.nextScanAt(base + 10e3) - base, n2: H.nextScanAt(base + 20e3) - base, n3: H.nextScanAt(base + q - 1000) - base, n4: H.nextScanAt(base + q + 5000) - base,
        px: [H.fmtPx(63123.456), H.fmtPx(152.3456), H.fmtPx(12.3456), H.fmtPx(1.23456), H.fmtPx(0.5234567), H.fmtPx(0.0123456), H.fmtPx(0.00001234)],
        cols: H.toCols([[1000, '1', '2', '0.5', '1.5', '10'], [2000, '1.5', '2', '1', '1.8', '10'], [3000, '1.8', '2', '1', '1.9', '10']], '5m', 1000 + 3e5 + 5), // only the 1st closes by `now`
        uni: H.pickUniverse([{ symbol: 'USDCUSDT', quoteVolume: '9' }, { symbol: 'AAAUSDT', quoteVolume: '8' }, { symbol: '1000AAAUSDT', quoteVolume: '7' }, { symbol: 'ETHUSDT', quoteVolume: '1' }, { symbol: 'XAUUSDT', quoteVolume: '6' }, { symbol: 'WBTCUSDT', quoteVolume: '5' }, { symbol: 'BTCUSDT', quoteVolume: '0.5' }], null, 2).map((x) => x.sym),
      };
    });
    assert.deepStrictEqual([r.n1, r.n2, r.n3, r.n4], [20000, 920000, 920000, 920000], 'nextScanAt');
    assert.deepStrictEqual(r.px, ['63,123.5', '152.35', '12.346', '1.2346', '0.52346', '0.012346', '0.000012340'], 'price precision');
    assert.deepStrictEqual(r.cols.t, [1000], 'unclosed candles dropped');
    assert.ok(r.uni.includes('BTCUSDT') && r.uni.includes('AAAUSDT') && !r.uni.includes('USDCUSDT') && !r.uni.includes('1000AAAUSDT') && !r.uni.includes('XAUUSDT') && !r.uni.includes('WBTCUSDT'), 'universe filters: ' + r.uni);
    assert.deepStrictEqual(errors, [], 'console clean in the unit page');
    await page.context().close(); ok('scan schedule (20 s after each quarter), price precision, closed-candle filter, universe filters');
  }

  // ───── 2. the board, desktop
  let boardHasTrade = false;
  {
    const { page, mock, errors } = await open(1280); await scanDone(page);
    const L = mock.log;
    // requests: weights, limit, concurrency, universe
    assert.ok(L.klines.every((k) => k.limit === 499), 'every klines call uses limit=499');
    const syms = new Set(L.klines.map((k) => k.sym)); assert.deepStrictEqual(Array.from(syms).sort(), COINS.map((c) => c.sym).sort(), 'only universe coins are fetched');
    assert.ok(!L.klines.some((k) => k.iv === '5m'), 'no 5m data while P3 is off');
    for (const c of COINS) assert.deepStrictEqual(L.klines.filter((k) => k.sym === c.sym).map((k) => k.iv).sort(), ['12h', '15m', '1d', '1h', '1w', '4h'], c.sym + ' intervals');
    assert.ok(L.maxCoins <= 4, 'at most 4 coins in flight, saw ' + L.maxCoins);
    assert.strictEqual(L.other.filter((x) => x.endsWith('ticker/24hr')).length, 1); assert.strictEqual(L.other.filter((x) => x.endsWith('exchangeInfo')).length, 1);
    const weight = L.klines.length * 2 + 40 + 1; assert.ok(weight < 1000, 'scan weight ' + weight);
    // board content
    const cards = await page.$$eval('article.card', (els) => els.map((e) => ({ sym: e.dataset.sym, prof: e.dataset.prof, state: e.dataset.state, text: e.innerText })));
    assert.ok(cards.length >= 1, 'board shows rows');
    for (const c of cards) assert.ok(COINS.some((x) => x.sym === c.sym), 'unexpected coin on the board: ' + c.sym);
    const states = new Set(cards.map((c) => c.state)); console.log('     board states:', Array.from(states).join(', '), `(${cards.length} rows)`);
    assert.ok(Array.from(states).some((s) => s !== 'IDLE'), 'a non-idle state');
    for (const c of cards.filter((c) => c.state === 'ARMED' || c.state === 'ACTIVE')) {
      boardHasTrade = true;
      for (const w of ['Entry', 'SL', 'PL', 'PT', 'FT', 'R:R to PT', 'Risk', 'Size', 'Stop reason', 'Armed']) assert.ok(c.text.includes(w), `${c.sym} ${c.state} card shows ${w}`);
      if (c.state === 'ACTIVE') assert.ok(/Partial \(PL\): (done|not yet)/.test(c.text), 'active card shows the partial');
    }
    for (const c of cards) assert.ok(/LONG|SHORT/.test(c.text) && /W /.test(c.text) && /D /.test(c.text), 'direction text and W/D bias');
    const tv = await page.$$eval('article.card a.tv', (as) => as.map((a) => ({ href: a.href, target: a.target, rel: a.rel })));
    assert.ok(tv.length === cards.length && tv.every((a) => a.target === '_blank' && /^https:\/\/www\.tradingview\.com\/chart\/\?symbol=BINANCE:[A-Z0-9]+USDT\.P&interval=(60|15)$/.test(a.href) && /noopener/.test(a.rel)), 'TradingView links');
    const counts = await page.$$eval('#st-counts .count', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
    assert.ok(counts.length === 6 && /Idle/.test(counts[5]), 'counts per state + idle: ' + counts.join(' | '));
    const foot = await page.innerText('footer');
    assert.ok(foot.includes('Trader Mayne system (mayne.fable) · separate from the Krillin scanner · planning aid only, not financial advice'), 'footer text');
    assert.strictEqual(await page.$eval('footer a', (a) => a.getAttribute('href')), '../');
    assert.strictEqual(await page.title(), 'Mayne Scanner Fable');
    assert.ok(/validation pending|validated|Not validated/i.test(await page.innerText('.verdict')), 'the validation banner is on the board');
    const checks = await page.$$eval('.checks-row', (e) => e.map((x) => x.innerText)); assert.ok(checks.length >= 1 && checks.every((t) => /Checks:/.test(t)), 'checks rows on the cards: ' + checks.length);
    // settings: persist, and the size follows the account size at once
    await page.click('#settings summary'); await page.fill('#s-acct', '50000'); await page.waitForTimeout(100);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('maynefable.settings.v1')));
    assert.strictEqual(stored.acct, 50000); assert.strictEqual(stored.P1, true); assert.strictEqual(stored.P3, false);
    await page.screenshot({ path: path.join(SHOTS, 'board-1280.png'), fullPage: true });
    assert.deepStrictEqual(errors, [], 'no console / page errors on the board');
    await page.context().close(); ok('board: rows, cards, links, counts, footer, request weights, concurrency, settings saved');
  }

  // ───── 3. results tab, desktop
  {
    const { page, errors } = await open(1280); await scanDone(page);
    await page.click('#tab-results'); await page.waitForSelector('.kpi', { timeout: 10000 });
    const kpis = await page.$$eval('.kpi', (e) => e.map((x) => x.innerText.replace(/\s+/g, ' ')));
    assert.strictEqual(kpis.length, 8, 'eight KPI tiles: ' + kpis.join(' | '));
    for (const k of ['Armed', 'Filled', 'Closed', 'Win rate', 'Avg R', 'Profit factor', 'Max drawdown']) assert.ok(kpis.some((x) => x.includes(k)), 'KPI ' + k);
    assert.ok(await page.$('#eq-svg svg polyline'), 'equity svg with a line');
    assert.ok((await page.$$('#eq-svg svg polyline')).length >= 2, 'a line per profile');
    assert.ok(await page.$('#eq-svg svg text'), 'axis labels');
    const heads = await page.$$eval('#results h2', (e) => e.map((x) => x.textContent));
    for (const hd of ['Verdict', 'Stage A · the exit, 2021–23', 'Stage B · entry filters', 'Do the setups beat random entries?', 'Forward test', 'Forward equity curve']) assert.ok(heads.some((x) => x.includes(hd)), 'evidence section ' + hd + ': ' + heads.join(' | '));
    assert.strictEqual(await page.$$eval('.ev-card', (e) => e.length), 4, 'four verdict cards');
    const evRows = await page.$$eval('#results .sec table tbody tr', (e) => e.length); assert.ok(evRows > 40, 'evidence tables have rows: ' + evRows);
    const breakdowns = await page.$$eval('#prof-block h3', (e) => e.map((x) => x.textContent)); assert.ok(breakdowns.length >= 7, 'breakdown tables: ' + breakdowns.join(', '));
    assert.ok(await page.$('#prof-block tr.small .ss'), 'small-sample hint appears for thin cells');
    await page.click('.seg button[data-prof="P2"]'); assert.ok((await page.innerText('#prof-block')).includes('P2'), 'profile switch');
    await page.click('.how summary'); { const ht = await page.innerText('.how'); assert.ok(/split|top.100/i.test(ht), 'method box: ' + ht.slice(0, 300)); }
    // trade list: newest first, 300 cap, filters, expand
    const nRows = await page.$$eval('#tr-body tr.trow', (r) => r.length); assert.ok(nRows > 0 && nRows <= 300, 'trade rows ' + nRows);
    const times = await page.$$eval('#tr-body tr.trow td:first-child', (r) => r.map((x) => x.textContent)); assert.deepStrictEqual(times, times.slice().sort().reverse(), 'newest first');
    await page.selectOption('select[data-f="dir"]', '-1');
    const dirs = await page.$$eval('#tr-body tr.trow td:nth-child(4)', (r) => r.map((x) => x.textContent)); assert.ok(dirs.length && dirs.every((d) => d === 'SHORT'), 'direction filter');
    await page.selectOption('select[data-f="dir"]', ''); await page.fill('input[data-f="q"]', 'eth');
    const coins = await page.$$eval('#tr-body tr.trow td:nth-child(2)', (r) => r.map((x) => x.textContent)); assert.ok(coins.length && coins.every((d) => d === 'ETH'), 'coin search');
    await page.fill('input[data-f="q"]', '');
    await page.click('#tr-body tr.trow'); const det = await page.innerText('#tr-body tr.det'); assert.ok(/Plan:/.test(det) && /Stop reason/.test(det) && /Gross R/.test(det) && /Checks:/.test(det), 'row details');
    await shotSections(page, '1280');
    assert.deepStrictEqual(errors, [], 'no console / page errors on the results tab');
    await page.context().close(); ok('evidence: verdict cards, rule tables, random baselines, confluence; forward KPI tiles, equity svg, breakdowns, trade list filters and details');
  }

  // ───── 3b. a board with several states at once (screenshots; checks that every group renders its rows)
  {
    const { page, errors } = await open(1280, { now: NOW_MIX }); await scanDone(page);
    const by = await page.$$eval('article.card', (els) => els.map((e) => e.dataset.state));
    for (const s of ['ARMED', 'FORMING+', 'FORMING', 'WATCH']) assert.ok(by.includes(s), 'mixed board has a ' + s + ' row: ' + by.join(','));
    const cnt = await page.$$eval('#st-counts .count b', (e) => e.map((x) => +x.textContent.replace(/\D/g, '')));
    assert.strictEqual(cnt.slice(0, 5).reduce((a, b) => a + b, 0), by.length, 'header counts match the rows');
    assert.ok(!(await page.$('#banners .banner')), 'no banner on a healthy scan');
    await page.screenshot({ path: path.join(SHOTS, 'board-mixed-1280.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 800 }); await noOverflow(page, 390, 'mixed board 390');
    await page.screenshot({ path: path.join(SHOTS, 'board-mixed-390.png'), fullPage: true });
    // an unchanged second scan must not flag anything as new / changed
    assert.strictEqual(await page.$$eval('.chip.new, .chip.chg', (e) => e.length), 0, 'first scan has no badges');
    await page.click('#scan-now'); await page.waitForTimeout(300); await scanDone(page);
    assert.strictEqual(await page.$$eval('.chip.new, .chip.chg', (e) => e.length), 0, 'an identical rescan shows no new/changed badges');
    assert.deepStrictEqual(errors, [], 'no console errors on the mixed board'); await page.context().close();
    ok('board with ARMED / FORMING+ / FORMING / WATCH rows renders and counts match');
  }

  // ───── 4. phone widths: no horizontal overflow, screenshots
  for (const w of [360, 390]) {
    const { page, errors } = await open(w, { height: 800 }); await scanDone(page);
    await noOverflow(page, w, `board ${w}`);
    await page.click('#settings summary'); await noOverflow(page, w, `board settings ${w}`);
    if (w === 390) await page.screenshot({ path: path.join(SHOTS, 'board-390.png'), fullPage: true });
    await page.click('#tab-results'); await page.waitForSelector('.kpi'); await page.waitForSelector('#tr-body tr.trow');
    await noOverflow(page, w, `results ${w}`);
    await page.click('#tr-body tr.trow'); await noOverflow(page, w, `results with an open row ${w}`);
    await page.click('.how summary'); await noOverflow(page, w, `results rules box ${w}`);
    const eqw = await page.$eval('#eq-svg svg', (s) => s.getBoundingClientRect().width); assert.ok(eqw <= w, 'equity chart fits the phone width');
    // wide tables must scroll inside their own container
    const inner = await page.$$eval('.tablewrap', (els) => els.filter((e) => e.scrollWidth > e.clientWidth + 2).length); assert.ok(inner >= 1, 'wide tables scroll inside their container');
    if (w === 390) await shotSections(page, '390');
    assert.deepStrictEqual(errors, [], `no console errors at ${w}`);
    await page.context().close();
  }
  ok('phone: no horizontal page scroll at 360 and 390 px (board, settings, results, expanded row); tables scroll inside their boxes');

  // ───── 5. failures: a coin with HTTP 500, a coin that answers 429 once, blocked storage, P3 on
  {
    const { page, mock, errors } = await open(1280, { scn: { failCoin: true, flaky: 'DOGEUSDT' }, blockStorage: true, allowConsole: [/ADAUSDT/, /DOGEUSDT/, /status of (500|429)/] });
    await scanDone(page);
    const summary = await page.innerText('#st-errs summary'); assert.ok(/1 error/.test(summary), 'error note: ' + summary);
    await page.click('#st-errs summary'); const det = await page.innerText('#st-errs'); assert.ok(/ADAUSDT/.test(det) && /data error/.test(det), 'error details: ' + det);
    const cards = await page.$$eval('article.card', (e) => e.map((x) => x.dataset.sym)); assert.ok(!cards.includes('ADAUSDT'));
    assert.ok(mock.log.klines.filter((k) => k.sym === 'DOGEUSDT').length > 6, 'the 429 was retried');
    assert.ok(!(await page.innerText('#st-text')).includes('No data'), 'scan completed despite errors');
    const hard = errors.filter((e) => !/Failed to load resource/.test(e)); assert.deepStrictEqual(hard, [], 'no page errors with blocked storage / failing coins');
    await page.context().close();
  }
  {
    const { page, mock, errors } = await open(1280, { settings: { P3: true, P1: false } }); await scanDone(page);
    assert.ok(mock.log.klines.some((k) => k.iv === '5m'), '5m is fetched when P3 is on');
    assert.ok(!mock.log.klines.some((k) => k.iv === '12h'), '12h is not fetched when P1 is off');
    const profs = await page.$$eval('article.card', (e) => e.map((x) => x.dataset.prof)); assert.ok(profs.every((p) => p !== 'P1'), 'no P1 rows when P1 is off');
    assert.deepStrictEqual(errors, [], 'P3 scan is clean'); await page.context().close();
  }
  ok('failures: HTTP 500 coin listed as a data error, 429 retried, storage blocked, P3 adds 5m data, P1 off skips 12h');

  // ───── 6. no replay files
  {
    const { page, errors } = await open(1280, { noData: true, allowConsole: [/mayne\/v1\.2\/data\//, /status of 404/] }); await scanDone(page);
    await page.click('#tab-results'); await page.waitForSelector('#results .notice');
    assert.ok(/Starts after the merge/.test(await page.innerText('#results')) && /evidence file/.test(await page.innerText('#results')), 'friendly messages');
    assert.deepStrictEqual(errors.filter((e) => !/404/.test(e)), [], 'no page errors without replay files'); await page.context().close();
    ok('evidence: friendly messages when the files are missing');
  }

  await browser.close(); srv.close();
  console.log(`${pass} groups passed. Screenshots in ${SHOTS}`);
  if (!boardHasTrade) console.log('note: the synthetic board had no ARMED/ACTIVE row at the test clock, so the trade-card fields were not checked');
}
module.exports = { COINS, FIXED_NOW, klinesAt, boardStates, market };
if (require.main === module) main().catch((e) => { console.error('FAILED:', e && e.stack || e); process.exit(1); });
