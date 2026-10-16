/* Fable · live scan (browser; node for tests with injected fetchers)

   Scans the top 100 Binance USDT-M perpetuals by 24 h quote volume with the SAME engine as the live scanner and
   the replay (tools/lib/engine.js, loaded as window.KE), the same scan rules (BTC context first, RS percentile,
   grades), and then applies the Fable gates (lib/gates.js) with the live regime (lib/regime.js). Differences from
   the replay: no 15m second pass (it only adds confluence to A2 and feeds A3, a 15m setup the watch list excludes),
   and the universe is ranked by the exchange's rolling 24 h volume rather than the previous UTC day's.

   Candles are cached in IndexedDB (per exchange / symbol / timeframe) and fetched incrementally, so the first scan
   costs about 300 requests and later scans only the new candles.
*/
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(); else root.FableScan = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const BN = 'https://fapi.binance.com', BY = 'https://api.bybit.com';
  const TFMAP = { bn: { '15m': '15m', '1h': '1h', '4h': '4h', '1d': '1d' }, by: { '15m': '15', '1h': '60', '4h': '240', '1d': 'D' } };
  const TFS = ['1h', '4h', '1d'], HIST = 1000, UNIVERSE_N = 100, DAY = 864e5;
  const STABLES = new Set('usdt usdc dai fdusd tusd usde usdd pyusd usds usd1 frax lusd gusd busd eurc eure rlusd usdb susd usdx usdtb usdf usdg usdp usdq crvusd gho dola mim usdy usdm usd0 ousg buidl eurt xusd bfusd usdai usdr cusd ausd'.split(' '));
  const WRAPPED = new Set('wbtc weth steth wsteth weeth cbbtc cbeth reth wbeth bnsol jitosol msol lbtc solvbtc wbnb meth ezeth rseth susde tbtc btcb sweth oseth ethx wsol stsol jupsol bbsol clbtc unibtc pumpbtc fbtc enzobtc swbtc xsolvbtc lseth wrseth stkaave'.split(' '));
  const NON_CRYPTO = new Set('btcdom defi football bluebird xau xag xpt xpd'.split(' '));
  const SETTINGS = { account: 10000, riskPct: 0.5, feePct: 0.05, slipPct: 0.03 };
  const baseOf = (sym) => { const b = sym.replace(/USDT$/, ''); const m = b.match(/^(1000000|1000|1M)(.+)$/); return m ? { base: m[2], mult: m[1] === '1000' ? 1000 : 1e6 } : { base: b, mult: 1 }; };
  const round = (x, d = 6) => Number.isFinite(x) ? +x.toPrecision(d) : null;
  const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
  async function pool(items, n, fn) { let i = 0; const out = new Array(items.length); await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } })); return out; }
  const getJSON = async (u) => { const r = await fetch(u, { referrerPolicy: 'no-referrer' }); if (!r.ok) throw new Error(`${r.status} ${u.slice(0, 60)}`); return r.json(); };

  // ── exchange layer (replaceable in node tests) ──
  async function fetchKlines(ex, sym, tf, startTime) {
    if (ex === 'bn') { const d = await getJSON(`${BN}/fapi/v1/klines?symbol=${sym}&interval=${TFMAP.bn[tf]}&limit=${HIST}` + (startTime ? `&startTime=${startTime}` : '')); return d.map((k) => [k[0], +k[1], +k[2], +k[3], +k[4], +k[7]]); }
    const d = await getJSON(`${BY}/v5/market/kline?category=linear&symbol=${sym}&interval=${TFMAP.by[tf]}&limit=${HIST}` + (startTime ? `&start=${startTime}` : ''));
    if (d.retCode !== 0) throw new Error('Bybit: ' + d.retMsg); return d.result.list.map((k) => [+k[0], +k[1], +k[2], +k[3], +k[4], +k[6]]).reverse();
  }
  async function fetchUniverse(ex) { // [{sym, S, mult, vol}] ranked by 24 h quote volume, one contract per base, same filters as the replay
    let rows;
    if (ex === 'bn') { const d = await getJSON(`${BN}/fapi/v1/ticker/24hr`); rows = d.map((x) => [x.symbol, +x.quoteVolume]); }
    else { const d = await getJSON(`${BY}/v5/market/tickers?category=linear`); if (d.retCode !== 0) throw new Error('Bybit: ' + d.retMsg); rows = d.result.list.map((x) => [x.symbol, +x.turnover24h]); }
    const ok = rows.filter(([s, v]) => /^[A-Z0-9]+USDT$/.test(s) && v > 0).filter(([s]) => { const b = baseOf(s).base.toLowerCase(); return !STABLES.has(b) && !WRAPPED.has(b) && !NON_CRYPTO.has(b); }).sort((a, b) => b[1] - a[1]);
    const seen = new Set(), list = [];
    for (const [s, v] of ok) { const { base, mult } = baseOf(s); if (seen.has(base)) continue; seen.add(base); list.push({ sym: s, S: base, mult, vol: v }); if (list.length >= UNIVERSE_N) break; }
    if (!list.find((x) => x.S === 'BTC')) { const b = ok.find((x) => x[0] === 'BTCUSDT'); if (b) list.unshift({ sym: 'BTCUSDT', S: 'BTC', mult: 1, vol: b[1] }); }
    list.forEach((c, i) => { c.rank = i + 1; }); return list;
  }

  // ── IndexedDB candle cache ──
  let dbp = null;
  function db() { if (dbp) return dbp; dbp = new Promise((res) => { try { const r = indexedDB.open('fable-candles', 1); r.onupgradeneeded = () => r.result.createObjectStore('c'); r.onsuccess = () => res(r.result); r.onerror = () => res(null); } catch (e) { res(null); } }); return dbp; }
  async function idbGet(key) { const d = await db(); if (!d) return null; return new Promise((res) => { try { const q = d.transaction('c').objectStore('c').get(key); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); } catch (e) { res(null); } }); }
  async function idbPut(key, val) { const d = await db(); if (!d) return; try { d.transaction('c', 'readwrite').objectStore('c').put(val, key); } catch (e) { /* ignore */ } }
  const mem = new Map();
  async function loadCandles(ex, sym, tf, io) {
    const key = `${ex}:${sym}:${tf}`, ms = io.K.TF_MS[tf], now = Date.now();
    let c = mem.get(key) || (io.cache ? await idbGet(key) : null);
    if (c && c.rows && c.rows.length) {
      const lastT = c.rows[c.rows.length - 1][0];
      if (now - c.fetched < 45e3) { mem.set(key, c); return c.rows; }
      if ((now - lastT) / ms < HIST - 10) { const add = await io.fetchKlines(ex, sym, tf, lastT); const rows = c.rows.filter((r) => r[0] < lastT).concat(add).slice(-HIST); c = { rows, fetched: now }; mem.set(key, c); if (io.cache) idbPut(key, c); return rows; }
    }
    const rows = await io.fetchKlines(ex, sym, tf); c = { rows, fetched: now }; mem.set(key, c); if (io.cache) idbPut(key, c); return rows;
  }

  // ── one scan, as tools/replay.js scanAt() ──
  function analyzeOne(K, c, ctx, t) {
    const T = K.analyzeCoin(c.data, t); T.live = c.live; T.liveTime = t;
    const lv = K.buildLevels(T, { diag: true }); c.T = T; c.lv = lv;
    const setups = K.detectSetups(T, lv, { symbol: c.S, btcAtResistance: ctx && ctx.atResistance, diag: true });
    for (const S of setups) { S.plan = K.buildPlan(S, T, lv, SETTINGS); if (S.plan && !S.plan.invalid) K.roomGate(S, S.plan); S.key = `${c.S}|${S.id}|${S.tf}|${S.dir}`; }
    c.setups = setups;
  }
  async function scan(opts) {
    opts = opts || {}; const K = opts.K || (typeof self !== 'undefined' && self.KE); if (!K) throw new Error('engine not loaded');
    const io = { K, fetchKlines: opts.fetchKlines || fetchKlines, cache: opts.cache !== false };
    const progress = opts.onProgress || (() => {}); const t = Date.now();
    let ex = opts.exchange || 'bn', coins;
    try { coins = await (opts.universe ? opts.universe(ex) : fetchUniverse(ex)); } catch (e) { if (ex === 'bn' && !opts.universe) { ex = 'by'; coins = await fetchUniverse(ex); } else throw e; }
    if (opts.limit) coins = coins.slice(0, opts.limit);
    let done = 0; const list = [], failed = [];
    await pool(coins, opts.concurrency || 4, async (u) => {
      try {
        const data = {};
        for (const tf of TFS) { const rows = await loadCandles(ex, u.sym, tf, io); if (rows.length) data[tf] = K.fromRows(rows); }
        if (data['1h'] && data['4h'] && data['1d']) {
          const h = data['1h']; const live = h.c[h.c.length - 1]; const i7 = h.t.findIndex((x) => x >= t - 7 * DAY); const chg7 = i7 > 0 ? (live / h.c[i7 - 1] - 1) * 100 : NaN;
          list.push({ ...u, data, live, chg7 });
        } else failed.push(u.sym);
      } catch (e) { failed.push(u.sym); }
      done++; progress(done, coins.length, u.sym);
    });
    const btc = list.find((c) => c.S === 'BTC'); if (btc) analyzeOne(K, btc, null, t);
    const ctx = btc && btc.T ? K.btcContext(btc.T) : null;
    for (const c of list) if (c !== btc) analyzeOne(K, c, ctx, t);
    const rsOf = (c) => Number.isFinite(c.chg7) && btc && Number.isFinite(btc.chg7) ? c.chg7 - btc.chg7 : NaN;
    const rs = list.map(rsOf).filter(Number.isFinite).sort((a, b) => a - b);
    for (const c of list) {
      const v = rsOf(c); c.rsPct = Number.isFinite(v) && rs.length ? 100 * rs.filter((x) => x <= v).length / rs.length : NaN;
      const g = { symbol: c.S, btc1d: ctx ? ctx.bias['1d'].label : 'n/a', btcAtRes: ctx ? ctx.atResistance : false, rsPct: c.rsPct, volRank: c.rank };
      for (const S of c.setups) { const gr = K.gradeSetup(S, c.T, c.lv, g); S.grade = gr; S.potential = gr.potential; }
    }
    // signal records in the replay's shape (what lib/gates.js and the page's cards read)
    const btcReg4h = btc && btc.T && btc.T['4h'] && !btc.T['4h'].insufficient ? btc.T['4h'].regime : null;
    const btcReg1d = btc && btc.T && btc.T['1d'] && !btc.T['1d'].insufficient ? btc.T['1d'].regime : null;
    const signals = [];
    for (const c of list) for (const S of c.setups) {
      if (S.gates.length || S.status !== 'active' || !S.plan || S.plan.invalid || S.watch) continue;
      const P = S.plan;
      signals.push({
        id: `${S.key}|${t}`, key: S.key, t, day: ymd(t), S: c.S, sym: c.sym, mult: c.mult, setup: S.id, name: S.name, fam: S.family, tf: S.tf, dir: S.dir,
        grade: S.grade.grade, score: S.grade.score, pot: S.potential, px: round(c.live),
        bids: P.bids.map((b) => round(b.price)), w: P.bids.map((b) => b.weight), avg: round(P.avg), stop: round(P.stop), stopPct: round(P.stopPct, 4),
        tps: P.tps.map((x) => [round(x.price), round(x.r, 3), x.label]), avgTP: round(P.avgTP, 3), room: Number.isFinite(P.room) ? round(P.room, 3) : null, roomLabel: P.roomLabel,
        size: round(P.size, 6), beWin: round(P.beWinRate, 3), why: S.why.join(' · ').slice(0, 300), entryText: S.entryText || '', warnings: S.warnings.slice(0, 6), conf: S.confluence.length,
        missing: (S.grade.missing || []).slice(0, 3), ctx: { btc1d: ctx ? ctx.bias['1d'].label : 'n/a', btc4h: ctx ? ctx.bias['4h'].label : 'n/a', btcAtRes: ctx ? !!ctx.atResistance : false, btcReg4h, btcReg1d, rsPct: Number.isFinite(c.rsPct) ? Math.round(c.rsPct) : null, rank: c.rank },
      });
    }
    const btcPx = btc ? btc.live : null;
    return { t, exchange: ex, coins: coins.length, scanned: list.length, failed, signals, btc: btc ? { px: btcPx, bias1d: ctx ? ctx.bias['1d'].label : null, bias4h: ctx ? ctx.bias['4h'].label : null, bias1w: ctx && ctx.bias['1w'] ? ctx.bias['1w'].label : null, atRes: ctx ? !!ctx.atResistance : null, reg1d: btcReg1d, reg4h: btcReg4h } : null };
  }

  // apply the Fable gates to a scan: regimeState = +1 / -1 from lib/regime.js as of the last daily close
  function gate(scanResult, regimeState, G) {
    const prior = scanResult.signals.filter((s) => s.setup === 'D4' && s.tf === '1h');
    const regimeOf = () => regimeState;
    const watch = [], rejected = {};
    for (const s of scanResult.signals) {
      if (!G.TFS.includes(s.tf)) continue;
      const g = G.evaluate(s, regimeOf, prior); s.soft = g.soft;
      if (g.pass) watch.push(s); else for (const h of g.hard) rejected[h] = (rejected[h] || 0) + 1;
    }
    watch.sort((a, b) => (b.pot || 0) - (a.pot || 0));
    return { watch, rejected, n4h1d: scanResult.signals.filter((s) => G.TFS.includes(s.tf)).length };
  }

  return { scan, gate, fetchUniverse, fetchKlines, TFS, HIST, UNIVERSE_N, SETTINGS };
});
