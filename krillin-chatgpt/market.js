/* Public Binance USD-M data for Krillin Chatgpt. No credentials or order endpoints. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../tools/lib/engine.js'));
  else root.KM = factory(root.KE);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (K) {
  'use strict';
  const API = 'https://fapi.binance.com';
  const DAY = 86400000, STEP = 900000;
  const TF = { '15m': STEP, '1h': 3600000, '4h': 14400000, '1d': DAY };
  const STABLES = new Set('USDT USDC DAI FDUSD TUSD USDE USDD PYUSD USDS USD1 FRAX LUSD GUSD BUSD EURC EURE RLUSD USDB SUSD USDX USDTB USDF USDG USDP USDQ CRVUSD GHO DOLA MIM USDY USDM USD0 OUSG BUIDL EURT XUSD BFUSD USDAI USDR CUSD AUSD'.split(' '));
  const WRAPPED = new Set('WBTC WETH STETH WSTETH WEETH CBBTC CBETH RETH WBETH BNSOL JITOSOL MSOL LBTC SOLVBTC WBNB METH EZETH RSETH SUSDE TBTC BTCB SWETH OSETH ETHX WSOL STSOL JUPSOL BBSOL CLBTC UNIBTC PUMPBTC FBTC ENZOBTC SWBTC XSOLVBTC LSETH WRSETH STKAAVE'.split(' '));
  const NON_CRYPTO = new Set('BTCDOM DEFI FOOTBALL BLUEBIRD XAU XAG XPT XPD PAXG XAUT GOLD SILVER OIL QQQ SPY SPX NDX DJIA KORU EWY AAPL TSLA NVDA MSFT AMZN META GOOGL GOOG COIN MSTR'.split(' '));
  const finite = Number.isFinite;
  function error(message, extra) { return Object.assign(new Error(message), extra || {}); }
  function baseOf(symbol) { return symbol.replace(/USDT$/, '').replace(/^(1000000|10000|1000|1M)(?=[A-Z])/, ''); }
  function eligible(m) {
    if (!m || !/^[A-Z0-9]+USDT$/.test(m.symbol || '') || m.status !== 'TRADING' || m.quoteAsset !== 'USDT' || m.marginAsset !== 'USDT' || m.contractType !== 'PERPETUAL' || m.underlyingType !== 'COIN') return false;
    const base = baseOf(m.symbol);
    return !STABLES.has(base) && !WRAPPED.has(base) && !NON_CRYPTO.has(base) && !(m.underlyingSubType || []).some(x => /INDEX|STOCK|EQUITY|COMMODITY|METAL|TRADFI/i.test(x));
  }
  function timestamp(t, name) { if (!Number.isSafeInteger(t) || t <= 0) throw error('Invalid ' + name + ' timestamp'); return t; }
  function rowsOf(payload, tf, at) {
    if (!Array.isArray(payload)) throw error('Binance returned invalid candle data');
    const ms = TF[tf], out = [];
    for (const r of payload) {
      if (!Array.isArray(r) || r.length < 8) throw error('Malformed Binance candle');
      const row = [Number(r[0]), Number(r[1]), Number(r[2]), Number(r[3]), Number(r[4]), Number(r[7])];
      const [t, o, h, l, c, v] = row;
      if (!Number.isSafeInteger(t) || t < 0 || t % ms || ![o, h, l, c, v].every(finite) || Math.min(o, h, l, c) <= 0 || v < 0 || h < Math.max(o, c, l) || l > Math.min(o, c, h) || Number(r[6]) !== t + ms - 1) throw error('Invalid Binance OHLC candle');
      if (out.length && t <= out[out.length - 1][0]) throw error('Binance candles are duplicated or out of order');
      if (t + ms <= at) out.push(row);
    }
    return out;
  }
  function complete(rows, tf, at, min = 1) {
    const ms = TF[tf], expected = Math.floor(at / ms) * ms - ms;
    if (rows.length < min) throw error('Insufficient ' + tf + ' history: ' + rows.length + ' closed candles; needs ' + min);
    for (let i = 1; i < rows.length; i++) if (rows[i][0] - rows[i - 1][0] !== ms) throw error('Gap in ' + tf + ' candle history');
    if (rows[rows.length - 1][0] !== expected) throw error('Missing latest closed ' + tf + ' candle');
    return rows;
  }
  async function pool(items, count, fn) {
    let next = 0, fatal = null;
    const out = new Array(items.length);
    await Promise.all(Array.from({ length: Math.min(count, items.length) }, async () => {
      while (next < items.length && !fatal) {
        const i = next++;
        try { out[i] = await fn(items[i], i); } catch (e) { fatal = e; }
      }
    }));
    if (fatal) throw fatal;
    return out;
  }
  function analyze(data, coin, btcContext, settings, featureAt) {
    const T = K.analyzeCoin(data, featureAt);
    const scanPrice = data['15m'].c[data['15m'].c.length - 1];
    T.live = scanPrice; T.liveTime = featureAt;
    const levels = K.buildLevels(T, { diag: true });
    const setups = K.detectSetups(T, levels, { symbol: coin.base, btcAtResistance: btcContext && btcContext.atResistance, diag: true });
    for (const s of setups) {
      s.plan = K.buildPlan(s, T, levels, settings);
      if (s.plan && !s.plan.invalid) K.roomGate(s, s.plan);
      s.grade = K.gradeSetup(s, T, levels, { symbol: coin.base, btc1d: btcContext ? btcContext.bias['1d'].label : 'n/a', btcAtRes: !!(btcContext && btcContext.atResistance), rsPct: coin.rsPct, volRank: coin.rank });
    }
    return { T, levels, setups, scanPrice };
  }
  function createClient(options) {
    options = options || {};
    const fetcher = options.fetch || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    if (!fetcher) throw error('A fetch implementation is required');
    const now = options.now || Date.now;
    const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
    const histories = new Map();
    let metadata = null, metadataAt = 0, ranked = null, rankedDay = 0;
    let minute = Math.floor(now() / 60000), used = 0, budget = 1600, blockedUntil = 0, admission = Promise.resolve();
    function progress(callback, message, done, total) { const fn = callback || options.onProgress; if (fn) fn({ message, done, total }); }
    async function reserve(weight) {
      const turn = admission.then(async () => {
        if (blockedUntil > now()) throw error('Binance rate limit: retry after ' + new Date(blockedUntil).toISOString(), { retryAt: blockedUntil, fatal: true });
        const current = Math.floor(now() / 60000);
        if (current !== minute) { minute = current; used = 0; }
        if (used + weight > budget) {
          await sleep((minute + 1) * 60000 - now() + 100);
          minute = Math.floor(now() / 60000); used = 0;
        }
        used += weight;
      });
      admission = turn.catch(() => {});
      await turn;
    }
    async function get(path, params, weight) {
      await reserve(weight || 1);
      const query = params ? '?' + new URLSearchParams(params) : '';
      let response;
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timeout = controller ? setTimeout(() => controller.abort(), 30000) : null;
      try { response = await fetcher(API + path + query, { cache: 'no-store', signal: controller ? controller.signal : undefined }); }
      catch (e) { throw error('Binance public data is unreachable. Check connectivity, browser access, and regional availability. No alternate market feed was used.', { fatal: true }); }
      finally { if (timeout !== null) clearTimeout(timeout); }
      if (response.status === 429 || response.status === 418) {
        const retry = response.headers && response.headers.get('Retry-After');
        const numeric = retry !== null && retry !== undefined && retry !== '' ? Number(retry) : NaN;
        const delay = finite(numeric) ? Math.max(1000, numeric * 1000) : Math.max(1000, Date.parse(retry) - now() || (response.status === 418 ? 120000 : 60000));
        blockedUntil = now() + delay;
        throw error('Binance HTTP ' + response.status + ': scanning paused until ' + new Date(blockedUntil).toISOString(), { retryAt: blockedUntil, fatal: true });
      }
      if (response.status === 451 || response.status === 403) throw error('Binance public USD-M data is unavailable from this region or network (HTTP ' + response.status + '). No Bybit or spot fallback was used.', { fatal: true });
      if (!response.ok) throw error('Binance public data HTTP ' + response.status);
      let value;
      try { value = await response.json(); } catch (e) { throw error('Binance returned invalid JSON'); }
      if (value && finite(value.code) && value.code < 0) throw error('Binance data error ' + value.code + ': ' + String(value.msg || 'request failed'));
      // Binance documents the bookTicker weight header as inaccurate; use our own budget there.
      if (path !== '/fapi/v1/ticker/bookTicker' && response.headers) {
        const count = Number(response.headers.get('X-MBX-USED-WEIGHT-1M'));
        if (finite(count)) used = Math.max(used, count);
      }
      return value;
    }
    async function serverTime() {
      const r = await get('/fapi/v1/time');
      return timestamp(r && r.serverTime, 'Binance server');
    }
    async function page(symbol, tf, at, startTime, limit) {
      const params = { symbol, interval: tf, limit, endTime: at - 1 };
      if (startTime !== undefined) params.startTime = startTime;
      const value = await get('/fapi/v1/klines', params, limit < 100 ? 1 : limit < 500 ? 2 : 5);
      return rowsOf(value, tf, at);
    }
    async function history(symbol, tf, at) {
      const key = symbol + '|' + tf, prior = histories.get(key), ms = TF[tf];
      const expected = Math.floor(at / ms) * ms - ms;
      if (prior && prior[prior.length - 1][0] === expected) return prior;
      let rows;
      if (prior && expected > prior[prior.length - 1][0] && expected - prior[prior.length - 1][0] < 998 * ms) {
        const start = prior[prior.length - 1][0] + ms;
        const add = await page(symbol, tf, at, start, Math.min(1000, Math.ceil((expected - start) / ms) + 1));
        if (!add.length || add[0][0] !== start) throw error('Missing incremental ' + tf + ' candles');
        rows = prior.concat(add).slice(-1000);
      } else rows = await page(symbol, tf, at, undefined, 1000);
      complete(rows, tf, at, 300);
      histories.set(key, rows);
      return rows;
    }
    async function candles(symbol, tf, options) {
      tf = tf || '15m'; options = options || {};
      if (!/^[A-Z0-9]+USDT$/.test(symbol || '') || !TF[tf]) throw error('Invalid Binance symbol or supported timeframe');
      let at = options.at;
      if (at === undefined) at = Math.floor(await serverTime() / STEP) * STEP;
      timestamp(at, 'candle cutoff');
      if (options.endTime !== undefined) { timestamp(options.endTime, 'end'); at = Math.min(at, options.endTime); }
      at = Math.floor(at / TF[tf]) * TF[tf];
      if (options.startTime === undefined) return K.fromRows(complete(await page(symbol, tf, at, undefined, 1000), tf, at));
      timestamp(options.startTime, 'start');
      let cursor = Math.ceil(options.startTime / TF[tf]) * TF[tf];
      const first = cursor;
      if (cursor >= at) return K.fromRows([]);
      if ((at - cursor) / TF[tf] > 50000) throw error('Forward history exceeds 50,000 candles. Evaluate an earlier interval first; no candles were skipped.');
      const cached = histories.get(symbol + '|' + tf);
      if (cached && cached[0][0] <= first && cached[cached.length - 1][0] >= at - TF[tf]) {
        return K.fromRows(complete(cached.filter(r => r[0] >= first && r[0] < at), tf, at));
      }
      const rows = [];
      while (cursor < at) {
        const add = await page(symbol, tf, at, cursor, Math.min(1000, (at - cursor) / TF[tf]));
        if (!add.length || add[0][0] !== cursor) throw error('Missing forward candle at ' + new Date(cursor).toISOString());
        for (const r of add) { if (r[0] < cursor || r[0] >= at) throw error('Binance returned a candle outside the requested interval'); rows.push(r); }
        const next = rows[rows.length - 1][0] + TF[tf];
        if (next <= cursor) throw error('Candle pagination did not advance');
        cursor = next;
      }
      complete(rows, tf, at);
      if (rows[0][0] !== first || rows.length !== (at - first) / TF[tf]) throw error('Forward candle coverage is incomplete');
      return K.fromRows(rows);
    }
    async function universe(at, size, callback) {
      const day = Math.floor(at / DAY) * DAY;
      if (!metadata || now() - metadataAt > 3600000) {
        const value = await get('/fapi/v1/exchangeInfo');
        if (!value || !Array.isArray(value.symbols) || !value.symbols.length) throw error('Binance exchange metadata is incomplete');
        const oldEligible = metadata && metadata.filter(eligible).map(m => m.symbol).sort().join('|');
        metadata = value.symbols; metadataAt = now();
        const rate = (value.rateLimits || []).find(x => x.rateLimitType === 'REQUEST_WEIGHT' && x.interval === 'MINUTE' && x.intervalNum === 1 && x.limit > 0);
        if (rate) budget = Math.min(1600, Math.floor(rate.limit * 0.7));
        const newEligible = metadata.filter(eligible).map(m => m.symbol).sort().join('|');
        if (newEligible !== oldEligible) ranked = null;
      }
      if (!ranked || rankedDay !== day) {
        const eligibleSymbols = metadata.filter(eligible);
        if (!eligibleSymbols.some(m => m.symbol === 'BTCUSDT')) throw error('BTCUSDT is missing from eligible Binance metadata');
        let done = 0;
        const failed = [];
        const list = await pool(eligibleSymbols, 3, async m => {
          if (m.onboardDate && m.onboardDate > day - DAY) { done++; return null; }
          try {
            const rows = complete(await page(m.symbol, '1d', day, undefined, 8), '1d', day);
            const previous = rows[rows.length - 1];
            const chg7 = rows.length >= 8 ? (previous[4] / rows[rows.length - 8][4] - 1) * 100 : null;
            return { symbol: baseOf(m.symbol), sym: m.symbol, base: baseOf(m.symbol), S: baseOf(m.symbol), quoteVolume: previous[5], chg7, metadata: m };
          } catch (e) { if (e.fatal) throw e; failed.push({ symbol: m.symbol, stage: 'universe', message: e.message }); return null; }
          finally { done++; progress(callback, 'Ranking previous UTC-day volume', done, eligibleSymbols.length); }
        });
        if (failed.length) throw error('Previous-day universe ranking is incomplete (' + failed.length + ' contracts unavailable). No signals were published.', { errors: failed });
        const seen = new Set();
        ranked = list.filter(c => c && c.quoteVolume > 0).sort((a, b) => b.quoteVolume - a.quoteVolume || a.sym.localeCompare(b.sym)).filter(c => { if (seen.has(c.base)) return false; seen.add(c.base); return true; });
        rankedDay = day;
      }
      if (ranked.length < size) throw error('Only ' + ranked.length + ' eligible contracts have complete prior-day data; requested ' + size + '. Reduce universe size.');
      return ranked.slice(0, size).map((c, i) => Object.assign({}, c, { rank: i + 1 }));
    }
    async function scan(settings, callback) {
      settings = Object.assign({ universeSize: 100, account: 5000, riskPct: 2, feePct: 0.05, slipPct: 0.03 }, settings || {});
      if (!Number.isInteger(settings.universeSize) || settings.universeSize < 1 || settings.universeSize > 250 || !finite(settings.account) || settings.account <= 0 || !finite(settings.riskPct) || settings.riskPct <= 0 || settings.riskPct > 100 || !finite(settings.feePct) || settings.feePct < 0 || !finite(settings.slipPct) || settings.slipPct < 0) throw error('Invalid scan universe, account, risk, or cost settings');
      const initialServerTime = await serverTime();
      const featureAt = Math.floor(initialServerTime / STEP) * STEP;
      const U = await universe(featureAt, settings.universeSize, callback);
      const btcCoin = U.find(c => c.sym === 'BTCUSDT') || Object.assign({}, ranked.find(c => c.sym === 'BTCUSDT'), { rank: ranked.findIndex(c => c.sym === 'BTCUSDT') + 1 });
      if (!btcCoin.sym) throw error('BTC context is unavailable');
      const work = U.some(c => c.sym === 'BTCUSDT') ? U : [btcCoin].concat(U);
      const errors = [], loaded = []; let done = 0;
      await pool(work, 3, async coin => {
        try {
          const data = {};
          for (const tf of ['15m', '1h', '4h', '1d']) data[tf] = K.fromRows(await history(coin.sym, tf, featureAt));
          loaded.push(Object.assign({}, coin, { data }));
        } catch (e) { if (e.fatal) throw e; errors.push({ symbol: coin.sym, stage: 'candles', message: e.message }); }
        finally { done++; progress(callback, 'Loading closed candles', done, work.length); }
      });
      const btc = loaded.find(c => c.sym === 'BTCUSDT');
      if (!btc) throw error('BTC closed-candle context is incomplete. No new signals were published.', { errors });
      const btcAnalysis = analyze(btc.data, btc, null, settings, featureAt);
      const btcContext = K.btcContext(btcAnalysis.T);
      const changes = loaded.filter(c => c.rank <= settings.universeSize && finite(c.chg7) && finite(btc.chg7)).map(c => c.chg7 - btc.chg7).sort((a, b) => a - b);
      const analyses = [];
      let analyzed = 0;
      for (const c of loaded) {
        if (!U.some(u => u.sym === c.sym)) continue;
        const relative = finite(c.chg7) && finite(btc.chg7) ? c.chg7 - btc.chg7 : null;
        c.rsPct = finite(relative) && changes.length ? 100 * changes.filter(x => x <= relative).length / changes.length : null;
        try { analyses.push({ coin: c, analysis: analyze(c.data, c, btcContext, settings, featureAt) }); }
        catch (e) { errors.push({ symbol: c.sym, stage: 'analysis', message: e.message }); }
        analyzed++; progress(callback, 'Analyzing closed-candle setups', analyzed, U.length);
        if (analyzed % 5 === 0) await sleep(0);
      }
      progress(callback, 'Checking current executable quotes', analyses.length, U.length);
      const quotes = await get('/fapi/v1/ticker/bookTicker', undefined, 5);
      if (!Array.isArray(quotes)) throw error('Binance executable quotes are incomplete');
      const observedAt = await serverTime();
      if (observedAt < initialServerTime) throw error('Binance server time moved backwards. No new signals were published.');
      if (Math.floor(observedAt / STEP) * STEP !== featureAt) throw error('A new 15-minute candle closed during this scan. Scan again to refresh all features; no new signals were published.');
      const book = new Map(quotes.map(q => [q.symbol, q]));
      const rawSignals = [], coinData = [];
      for (const { coin: c, analysis: a } of analyses) {
        const quote = book.get(c.sym), bid = quote && Number(quote.bidPrice), ask = quote && Number(quote.askPrice), quoteAt = quote && Number(quote.time);
        const valid = [bid, ask, quoteAt].every(finite) && bid > 0 && ask >= bid && quoteAt <= observedAt + 1000 && observedAt - quoteAt <= 60000;
        const summary = { symbol: c.base, sym: c.sym, rank: c.rank, quoteVolume: c.quoteVolume, chg7: c.chg7, rsPct: c.rsPct, scanPrice: a.scanPrice, bid, ask, history: Object.fromEntries(Object.entries(c.data).map(([tf, series]) => [tf, series.t.length])), bias: { '1h': K.tfBias(a.T['1h']).label, '4h': K.tfBias(a.T['4h']).label, '1d': K.tfBias(a.T['1d']).label }, setups: a.setups.length };
        if (!valid) { summary.error = 'Missing, invalid, or stale executable quote'; errors.push({ symbol: c.sym, stage: 'quote', message: summary.error }); }
        coinData.push(summary);
        // Preserve raw detections when execution quotes fail; the decision layer must reject valid=false.
        for (const s of a.setups) {
          const bounds = [...(s.entry || s.watchZone || []), s.stop, ...(s.plan && s.plan.tps || []).map(tp => tp.price)].filter(x => finite(x) && x > 0);
          const chartLevels = bounds.length ? a.levels.levels.filter(lv => lv.hi >= Math.min(...bounds) && lv.lo <= Math.max(...bounds)).map(lv => ({ name: lv.name, lo: lv.lo, hi: lv.hi, moving: !!lv.moving })) : [];
          rawSignals.push(Object.assign({}, s, { chartLevels, symbol: c.base, sym: c.sym, base: c.base, t: observedAt, px: valid ? (s.dir === 'short' ? bid : ask) : null, scanPrice: a.scanPrice, marketData: { valid: !!valid, source: 'binance-usdm', closedAt: featureAt, observedAt, quoteAt, bid, ask, btcContext, history: summary.history, error: valid ? null : summary.error }, btc1d: btcContext.bias['1d'].label, btcAtRes: btcContext.atResistance, rsPct: c.rsPct, volRank: c.rank }));
        }
      }
      for (const e of errors) if (!coinData.some(c => c.sym === e.symbol)) coinData.push({ sym: e.symbol, symbol: baseOf(e.symbol), error: e.message });
      return { at: observedAt, featureAt, serverTime: observedAt, initialServerTime, source: 'binance-usdm', universe: U, rawSignals, coinData, errors, btcContext, counts: { requested: U.length, analyzed: analyses.length, scanned: analyses.length, quoted: coinData.filter(c => !c.error).length, signals: rawSignals.length, errors: errors.length } };
    }
    return { scan, candles, serverTime };
  }
  return { createClient, analyze, eligible, rowsOf, complete, baseOf, TF, API };
}));
