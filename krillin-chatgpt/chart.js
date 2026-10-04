/* TradingView chart presentation. This module never changes decisions or paper outcomes. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../tools/lib/engine.js'));
  else root.KCChart = factory(root.KE);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (K) {
  'use strict';
  const valid = x => Number.isFinite(x) && x > 0;
  const price = x => x.toLocaleString(undefined, { maximumSignificantDigits: 8 });
  const nativeTF = tf => tf === '12h' ? '4h' : ['3d', '1w'].includes(tf) ? '1d' : tf;
  function levelsFor(d, ev) {
    const levels = [], p = d.plan, raw = d.raw || {};
    const add = (title, value, kind, note = '') => { if (valid(value)) levels.push({ title, price: value, kind, note }); };
    if (p) {
      p.bids.forEach((b, i) => add('Entry ' + (i + 1), b.price, 'entry', (b.weight * 100).toFixed(0) + '% of planned size'));
      add('Planned avg', p.avg, 'average', 'Full-fill estimate, before fees');
      add('SL', p.stop, 'stop', raw.stopText || 'Fixed planned stop');
      p.tps.forEach((tp, i) => add('TP' + (i + 1), tp.price, 'target', (tp.weight * 100).toFixed(1) + '% full-fill exit estimate · ' + tp.r.toFixed(2) + 'R · ' + (tp.label || 'Target')));
    }
    const zone = raw.entry || raw.watchZone;
    if (Array.isArray(zone) && zone.length === 2 && zone.every(valid)) {
      add(p ? 'Entry zone low' : 'Watch / raw zone low', Math.min(...zone), 'zone', raw.entryText || 'Unqualified setup zone');
      add(p ? 'Entry zone high' : 'Watch / raw zone high', Math.max(...zone), 'zone', raw.entryText || 'Unqualified setup zone');
    }
    for (const lv of raw.chartLevels || []) {
      add(lv.name + (lv.moving ? ' (snapshot)' : '') + ' low', lv.lo, 'context', 'Setup reference at observation');
      if (lv.hi !== lv.lo) add(lv.name + ' high', lv.hi, 'context', 'Setup reference at observation');
    }
    add('Decision quote', d.px, 'quote', 'Executable quote when the idea was observed');
    if (ev && ev.fill > 0) add('Paper avg fill', ev.avgFill, 'fill', 'Modeled fills, not exchange executions');
    return levels;
  }
  function chartBars(series, tf, at) {
    const ms = K.TF_MS[tf], base = K.TF_MS[nativeTF(tf)];
    if (!ms || !Number.isFinite(at)) throw new Error('Invalid chart timeframe or cutoff');
    let s = series;
    if (ms !== base) s = K.aggregate(series, tf);
    // Both ends must contain full native buckets; aggregate() alone includes partial buckets.
    return s.t.flatMap((t, i) => t >= series.t[0] && t + ms <= at ? [{ time: t / 1000, open: s.o[i], high: s.h[i], low: s.l[i], close: s.c[i] }] : []);
  }
  function mount(d, ev, client) {
    const $ = id => document.getElementById(id), panel = $('idea-chart-panel'), host = $('idea-chart');
    let chart = null, disposed = false, request = 0;
    panel.hidden = false;
    host.style.minHeight = '440px'; // Keep the chart visible even when an older stylesheet is cached.
    const levels = levelsFor(d, ev), tfSelect = $('idea-chart-tf'), view = $('idea-chart-view');
    const theme = window.matchMedia('(prefers-color-scheme: dark)');
    const color = name => getComputedStyle(panel).getPropertyValue(name).trim();
    const colors = () => ({ entry: color('--accent'), average: color('--warn'), stop: color('--short'), target: color('--long'), zone: color('--accent'), context: color('--muted'), quote: color('--ink-2'), fill: color('--info') });
    const timeframes = [...new Set(['15m', '1h', '4h', '12h', '1d', d.tf])].filter(tf => K.TF_MS[tf]);
    tfSelect.replaceChildren(...timeframes.map(tf => new Option(K.TF_LABEL[tf], tf)));
    tfSelect.value = d.tf; view.value = 'setup';
    $('idea-tv-link').href = 'https://www.tradingview.com/chart/?symbol=' + encodeURIComponent('BINANCE:' + d.sym + '.P');
    $('idea-chart-levels').replaceChildren(...levels.map(lv => {
      const row = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = lv.title; dd.textContent = price(lv.price) + ' · ' + lv.note;
      row.dataset.kind = lv.kind; row.append(dt, dd); return row;
    }));
    function clear() { if (chart) chart.remove(); chart = null; host.replaceChildren(); }
    function reset() {
      if (chart) { chart.priceScale('right').applyOptions({ autoScale: true }); chart.timeScale().fitContent(); }
    }
    async function load() {
      const token = ++request, tf = tfSelect.value, latest = view.value === 'latest';
      clear(); host.hidden = true;
      $('idea-chart-status').textContent = 'Loading ' + d.sym + ' ' + tf + ' closed candles…';
      $('idea-chart-ohlc').textContent = 'Move the crosshair to inspect a candle.';
      try {
        if (!window.LightweightCharts) throw new Error('TradingView chart library did not load. Reload the page.');
        const at = latest ? await client.serverTime() : d.context && d.context.closedAt || d.t;
        const series = await client.candles(d.sym, nativeTF(tf), { at });
        if (disposed || token !== request) return;
        const allBars = chartBars(series, tf, at), bars = allBars.slice(-120);
        if (!bars.length) throw new Error('No complete candles are available for this timeframe.');
        host.hidden = false;
        const TV = window.LightweightCharts, palette = colors();
        chart = TV.createChart(host, {
          autoSize: true, layout: { background: { color: color('--surface') }, textColor: color('--ink-2'), attributionLogo: true },
          grid: { vertLines: { color: color('--line') }, horzLines: { color: color('--line') } },
          rightPriceScale: { borderColor: color('--line'), scaleMargins: { top: 0.08, bottom: 0.08 } },
          timeScale: { timeVisible: true, secondsVisible: false, borderColor: color('--line'), rightOffset: 8 },
          localization: { priceFormatter: price, timeFormatter: t => new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' },
          handleScroll: { vertTouchDrag: false },
        });
        const candles = chart.addSeries(TV.CandlestickSeries, {
          upColor: palette.target, downColor: palette.stop, wickUpColor: palette.target, wickDownColor: palette.stop, borderVisible: false,
          priceLineVisible: false, lastValueVisible: true, priceFormat: { type: 'custom', formatter: price, minMove: 0.00000001 },
          autoscaleInfoProvider: original => {
            const info = original(); if (!info || !levels.length) return info;
            return { ...info, priceRange: { minValue: Math.min(info.priceRange.minValue, ...levels.map(l => l.price)), maxValue: Math.max(info.priceRange.maxValue, ...levels.map(l => l.price)) } };
          },
        });
        candles.setData(bars);
        levels.forEach(lv => candles.createPriceLine({ price: lv.price, title: lv.title, color: palette[lv.kind], lineWidth: lv.kind === 'stop' || lv.kind === 'target' ? 2 : 1, lineStyle: lv.kind === 'context' || lv.kind === 'zone' ? TV.LineStyle.Dotted : TV.LineStyle.Dashed, axisLabelVisible: ['entry', 'stop', 'target', 'fill'].includes(lv.kind) }));
        // Reuse the scanner's indicator definitions, including its EMA200 = SMMA(99).
        for (const [title, values, lineColor] of [
          ['EMA13', K.ema(series.c, 13), palette.quote], ['EMA21', K.ema(series.c, 21), palette.fill],
          ['MA100', K.sma(series.c, 100), palette.average], ['EMA200 / SMMA99', K.rma(series.c, 99), palette.entry], ['MA300', K.sma(series.c, 300), palette.context],
        ]) {
          if (tf !== nativeTF(tf)) continue;
          const line = chart.addSeries(TV.LineSeries, { color: lineColor, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
          const start = series.t.length - bars.length;
          line.setData(bars.flatMap((b, i) => valid(values[start + i]) ? [{ time: b.time, value: values[start + i] }] : []));
        }
        if (tf !== nativeTF(tf)) {
          const line = chart.addSeries(TV.LineSeries, { color: palette.entry, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
          const values = K.rma(allBars.map(b => b.close), 99);
          line.setData(allBars.flatMap((b, i) => valid(values[i]) && b.time >= bars[0].time ? [{ time: b.time, value: values[i] }] : []));
        }
        const diagonal = d.raw && d.raw.diag;
        if (diagonal && [diagonal.t1, diagonal.t2, diagonal.p1, diagonal.p2].every(valid) && diagonal.t2 > diagonal.t1) {
          const slope = (diagonal.p2 - diagonal.p1) / (diagonal.t2 - diagonal.t1);
          const line = chart.addSeries(TV.LineSeries, { color: palette.context, lineWidth: 2, lineStyle: TV.LineStyle.Dashed, title: 'Setup trend line', priceLineVisible: false, lastValueVisible: false });
          line.setData(bars.flatMap(b => { const value = diagonal.p1 + slope * (b.time * 1000 - diagonal.t1); return valid(value) ? [{ time: b.time, value }] : []; }));
        }
        const observedBar = bars.findLast(b => b.time * 1000 <= d.t);
        if (observedBar && (!latest || d.t < (bars[bars.length - 1].time * 1000 + K.TF_MS[tf]))) TV.createSeriesMarkers(candles, [{ time: observedBar.time, position: d.dir === 'short' ? 'aboveBar' : 'belowBar', color: palette.entry, shape: 'circle', text: latest ? 'Observation candle' : 'Last closed before observation' }]);
        chart.subscribeCrosshairMove(event => {
          const b = event.seriesData.get(candles);
          $('idea-chart-ohlc').textContent = b ? new Date(b.time * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC · O ' + price(b.open) + ' · H ' + price(b.high) + ' · L ' + price(b.low) + ' · C ' + price(b.close) : 'Move the crosshair to inspect a candle.';
        });
        reset();
        const lastClose = (bars[bars.length - 1].time * 1000 + K.TF_MS[tf]);
        $('idea-chart-status').textContent = d.sym + ' · ' + tf + ' · Binance USDT-M · closed through ' + new Date(lastClose).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' + (d.plan ? ' · original plan' : ' · no valid trade plan; raw/watch levels only') + (!(d.raw && d.raw.chartLevels) ? ' · saved support/resistance snapshot unavailable for this older observation' : '');
      } catch (e) {
        if (disposed || token !== request) return;
        clear(); host.hidden = true;
        $('idea-chart-status').textContent = 'Chart unavailable: ' + e.message + ' Change timeframe or candle view to retry. Planned levels remain below.';
      }
    }
    tfSelect.onchange = load; view.onchange = load; $('idea-chart-fit').onclick = reset;
    theme.addEventListener('change', load);
    load();
    return () => { disposed = true; request++; clear(); panel.hidden = true; tfSelect.onchange = null; view.onchange = null; $('idea-chart-fit').onclick = null; theme.removeEventListener('change', load); };
  }
  return { levelsFor, chartBars, nativeTF, mount };
}));
