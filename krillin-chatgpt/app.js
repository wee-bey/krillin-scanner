/* Krillin Chatgpt controller. All observations are local to this browser.
   The original scanner's storage and archives are never written. */
(function (root) {
  'use strict';
  const C = typeof module !== 'undefined' && module.exports ? require('./core.js') : root.KC;
  const clone = value => JSON.parse(JSON.stringify(value));
  const episodeKey = d => [d.sym, d.setupId, d.tf, d.dir].join('|');
  const repeatMs = 12 * 60 * 60e3;
  const gradeOf = raw => raw && raw.grade && typeof raw.grade === 'object' ? raw.grade.grade : raw && raw.grade;
  const isEvaluable = d => d.validPlan && d.dataValid && d.raw.status === 'active' && !d.raw.watch && !(d.raw.gates || []).length;
  function emptyState() { return { schema: 1, revision: 0, cohorts: [], records: [], events: [], latest: null }; }
  function ingest(previous, scan, manifest) {
    const state = clone(previous), events = [];
    let cohort = state.cohorts.find(x => x.id === manifest.id);
    if (!cohort) {
      cohort = Object.assign({}, clone(manifest), { startedAt: scan.at }); state.cohorts.push(cohort);
      events.push(C.createEvent('rules', scan.at, cohort));
    }
    const recent = new Map();
    for (const r of state.records.filter(x => x.cohortId === cohort.id)) recent.set(episodeKey(r.decision), r);
    const activeRecords = state.records.filter(x => x.cohortId === cohort.id && x.accepted && !(x.ev && x.ev.done));
    const activeIdeas = activeRecords.map(r => {
      const saved = state.latest && state.latest.cohortId === cohort.id && state.latest.ideas.find(i => i.decisionId === r.id);
      if (saved) return saved;
      const d = r.decision;
      return { id: d.id, t: d.t, symbol: d.symbol, sym: d.sym, dir: d.dir, setupId: d.setupId, tf: d.tf, plan: d.plan, decisionId: d.id, zone: [Math.min(...d.plan.bids.map(b => b.price)), Math.max(...d.plan.bids.map(b => b.price))], support: [{ decisionId: d.id, setupId: d.setupId, tf: d.tf, t: d.t }] };
    });
    const base = scan.rawSignals.map(raw => C.qualify(raw, { at: scan.at, price: raw.px, source: scan.source, closedAt: raw.marketData.closedAt, valid: raw.marketData.valid, settings: manifest.settings }));
    const candidates = base.map(d => {
      const old = recent.get(episodeKey(d));
      const zone = d.plan && [Math.min(...d.plan.bids.map(b => b.price)), Math.max(...d.plan.bids.map(b => b.price))];
      const represented = zone && activeIdeas.some(i => i.symbol === d.symbol && i.dir === d.dir && zone[0] <= i.zone[1] && i.zone[0] <= zone[1]);
      if (!old || d.t - old.decision.t >= repeatMs && old.ev && old.ev.done || represented) return d;
      const copy = clone(d); copy.accepted = false; copy.reasons.push('Existing paper candidate or 12-hour repeat window'); copy.reasonCodes.push('repeat_window'); return copy;
    });
    const grouped = C.deduplicate(candidates, activeIdeas);
    const earlier = new Map((state.latest && state.latest.cohortId === cohort.id ? state.latest.decisions : []).map(d => [episodeKey(d), d]));
    for (const d of grouped.decisions) {
      events.push(C.createEvent('signal', scan.at, { cohortId: cohort.id, decision: d }));
      const oldObservation = earlier.get(episodeKey(d));
      if (oldObservation && (gradeOf(oldObservation.raw) !== gradeOf(d.raw) || oldObservation.raw.status !== d.raw.status || oldObservation.accepted !== d.accepted)) {
        events.push(C.createEvent('upgrade', scan.at, { cohortId: cohort.id, previousDecisionId: oldObservation.id, decisionId: d.id, previousGrade: gradeOf(oldObservation.raw), grade: gradeOf(d.raw), accepted: d.accepted }));
      }
      const old = recent.get(episodeKey(d));
      if (isEvaluable(d) && (!old || old.ev && old.ev.done && d.t - old.decision.t >= repeatMs)) {
        const record = { id: d.id, cohortId: cohort.id, decision: d, accepted: d.accepted, ev: null, evaluationError: null };
        state.records.push(record); recent.set(episodeKey(d), record);
      }
    }
    state.latest = { cohortId: cohort.id, at: scan.at, featureAt: scan.featureAt, decisions: grouped.decisions, ideas: grouped.ideas, counts: scan.counts, errors: scan.errors, universe: scan.universe.map(x => ({ sym: x.sym, rank: x.rank, quoteVolume: x.quoteVolume })) };
    events.push(C.createEvent('scan', scan.at, { cohortId: cohort.id, featureAt: scan.featureAt, counts: scan.counts, errors: scan.errors, universe: state.latest.universe }));
    state.events = C.appendEvents(state.events, events);
    return state;
  }
  function forwardSignals(state, cohortId) {
    return state.records.filter(x => x.cohortId === cohortId).map(r => ({ ...r.decision, accepted: r.accepted, ev: r.ev && r.ev.coverageComplete !== false && !r.evaluationError ? r.ev : null }));
  }
  const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const api = { emptyState, ingest, forwardSignals, episodeKey, isEvaluable, escape };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  root.KCApp = api;
  boot().catch(error => {
    const e = document.getElementById('scan-error'); e.hidden = false; e.textContent = error.message + ' Your existing log has not been cleared.';
    document.getElementById('scan-btn').disabled = true;
  });

  async function boot() {
    const $ = id => document.getElementById(id);
    const fmt = (x, digits = 3) => Number.isFinite(x) ? x.toFixed(digits) : '—';
    const signed = (x, digits = 3) => Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(digits) : '—';
    const price = x => Number.isFinite(x) ? x.toLocaleString(undefined, { maximumSignificantDigits: 8 }) : '—';
    const time = x => Number.isFinite(x) ? new Date(x).toLocaleString() : 'Not started';
    const defaults = { account: 5000, riskPct: 2, universeSize: 100, feePct: C.POLICY.feePct, slipPct: C.POLICY.slipPct };
    let settings = defaults, state, history = [], historyIndex = null, selected = null, feed = 'qualified', busy = false, currentManifest, storageFailed = false;
    try { settings = { ...defaults, ...JSON.parse(localStorage.getItem('krillin-chatgpt-settings-v1') || '{}') }; } catch (_) { /* Defaults remain available when browser preferences cannot be read. */ }
    function validSettings(s) { return Number.isFinite(s.account) && s.account > 0 && Number.isFinite(s.riskPct) && s.riskPct > 0 && s.riskPct <= 100 && [25, 50, 100].includes(s.universeSize); }
    if (!validSettings(settings)) settings = defaults;
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('krillin-chatgpt', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('state');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error('Browser storage is unavailable. Enable site storage to collect an auditable log.'));
      request.onblocked = () => reject(new Error('Close other Krillin Chatgpt tabs to finish opening its storage.'));
    });
    state = await new Promise((resolve, reject) => {
      const q = db.transaction('state').objectStore('state').get('observations'); q.onsuccess = () => resolve(q.result || emptyState()); q.onerror = () => reject(q.error);
    });
    if (state.schema !== 1 || !['cohorts', 'records', 'events'].every(k => Array.isArray(state[k]))) throw new Error('The saved observation log has an unsupported format.');
    async function save(next) {
      await new Promise((resolve, reject) => {
        const tx = db.transaction('state', 'readwrite'), store = tx.objectStore('state');
        let failure = null, writtenRevision = null;
        const request = store.get('observations');
        request.onsuccess = () => {
          const current = request.result, revision = current && current.revision || 0;
          if (revision !== (next.revision || 0)) { failure = new Error('Another tab saved a newer log. Export this page before reloading; its unsaved observations have not replaced that log.'); tx.abort(); return; }
          writtenRevision = revision + 1; store.put({ ...next, revision: writtenRevision }, 'observations');
        };
        tx.oncomplete = () => { next.revision = writtenRevision; resolve(); };
        tx.onerror = () => reject(failure || tx.error || new Error('Could not save observations')); tx.onabort = () => reject(failure || tx.error || new Error('Observation save aborted'));
      });
    }
    const sourceFiles = ['../tools/lib/engine.js', './core.js', './market.js', './app.js'];
    const sourceTexts = await Promise.all(sourceFiles.map(async path => { const r = await fetch(path, { cache: 'no-cache', credentials: 'omit' }); if (!r.ok) throw new Error('Could not identify the loaded scanner rules. Reload this page.'); return r.text(); }));
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sourceTexts.join('\n'))))].map(x => x.toString(16).padStart(2, '0')).join('');
    function manifest() {
      const fingerprint = [C.POLICY.version, digest, settings.account, settings.riskPct, settings.universeSize, settings.feePct, settings.slipPct].join('|');
      return { id: fingerprint, ruleVersion: C.POLICY.version, sourceDigest: digest, policy: C.POLICY, settings: clone(settings), source: 'binance-usdm' };
    }
    currentManifest = manifest();
    const client = root.KM.createClient({ fetch: root.fetch.bind(root) });
    let clearChart = () => {};
    function error(message) { $('scan-error').hidden = !message; $('scan-error').textContent = message || ''; }
    function progress(p) { $('scan-status').textContent = p.message; $('scan-progress').hidden = false; $('scan-progress').max = p.total || 1; $('scan-progress').value = p.done || 0; }
    function recordFor(id) { return state.records.find(x => x.id === id); }
    function cohortRecords() { return state.records.filter(x => x.cohortId === currentManifest.id); }
    function groupsForFeed() {
      const latest = state.latest && state.latest.cohortId === currentManifest.id ? state.latest : null;
      if (!latest) return [];
      if (feed === 'qualified') return latest.ideas.filter(i => { const r = recordFor(i.decisionId); return !r || !(r.ev && r.ev.done); });
      if (feed === 'research') {
        const decisions = latest.decisions.filter(d => isEvaluable(d) && d.reasonCodes.includes('not_shortlisted')).map(d => ({ ...clone(d), accepted: true }));
        return C.deduplicate(decisions).ideas;
      }
      return latest.decisions.filter(d => !d.accepted && !d.duplicateOf && !(isEvaluable(d) && d.reasonCodes.includes('not_shortlisted'))).map(d => ({ ...d, decisionId: d.id, support: [], rejected: true }));
    }
    function getDecision(item) { return state.latest.decisions.find(x => x.id === item.decisionId) || (recordFor(item.decisionId) || {}).decision || item; }
    function showDetail(item) {
      clearChart();
      const d = getDecision(item), p = d.plan, r = recordFor(item.decisionId), ev = r && r.ev;
      const headings = '<header class="detail-header"><h3>' + escape(d.symbol) + ' <span class="' + escape(d.dir) + '">' + escape(d.dir) + '</span></h3><p>' + escape(d.sym) + ' · ' + escape(d.setupId) + ' · ' + escape(d.tf) + ' · observed ' + escape(time(d.t)) + '</p></header>';
      const supports = [...new Set((item.support || []).map(x => x.setupId + ' · ' + x.tf))].join(', ');
      $('idea-detail').innerHTML = headings + (supports ? '<p>Supporting observations: ' + escape(supports) + '. These are one trade idea.</p>' : '') +
        '<p>Decision quote ' + price(d.px) + ' · closed-data time ' + escape(time(d.context && d.context.closedAt)) + '</p>' +
        '<p>Native candle history: ' + escape(Object.entries(d.raw.marketData && d.raw.marketData.history || {}).map(([tf, n]) => tf + ' ' + n).join(' · ') || 'counts unavailable') + '. Longer derived indicators may lack warm-up on younger listings.</p>' +
        (d.reasons.length ? '<div class="detail-section"><h4>Decision reasons</h4><ul>' + d.reasons.map(x => '<li>' + escape(x) + '</li>').join('') + '</ul></div>' : '<p>Passes the provisional shortlist and validity checks. This is a research candidate.</p>') +
        (p ? '<div class="detail-section"><h4>Complete plan</h4><dl class="plan-grid"><div><dt>Planned stop risk, including modeled costs</dt><dd>$' + fmt(p.riskUsd, 2) + '</dd></div><div><dt>Stop</dt><dd>' + price(p.stop) + '</dd></div><div><dt>Net R if the full target ladder completes</dt><dd>' + signed(p.weightedNetR) + 'R</dd></div><div><dt>Full-fill TP1 then stop estimate</dt><dd>' + signed(p.tp1ThenStopR) + 'R</dd></div></dl><p>Entries: ' + p.bids.map(b => price(b.price) + ' (' + fmt(b.weight * 100, 0) + '%)').join(' · ') + '</p><p>Targets: ' + p.tps.map((tp, i) => 'TP' + (i + 1) + ' ' + price(tp.price) + ' (' + fmt(tp.weight * 100, 1) + '%)').join(' · ') + '</p><p>Quotes and full-fill estimates are planning assumptions. Actual partial fills change target fractions and remaining risk. Gaps may exceed the planned stop risk.</p></div>' : '') +
        '<div class="detail-section"><h4>Observed paper outcome</h4><p>' + (ev ? escape(ev.st) + ' · ' + (ev.st === 'closed' ? signed(ev.R) + 'R' : 'closed outcome not available') + ' · evaluated through ' + escape(time(ev.upd)) : 'No closed outcome yet.') + '</p>' + (r && r.evaluationError ? '<p>' + escape(r.evaluationError) + '</p>' : '') + '<p>Paper orders activate at the next 15-minute opening. Stops precede targets inside an ambiguous candle. Independent paper plans share no capital; their R totals are not account returns. Funding and order-book execution are not modeled.</p></div>';
      clearChart = root.KCChart.mount(d, ev, client);
    }
    function renderFeed() {
      const latest = state.latest && state.latest.cohortId === currentManifest.id ? state.latest : null;
      const previousFeed = feed;
      for (const name of ['qualified', 'research', 'rejected']) { feed = name; $('count-' + name).textContent = groupsForFeed().length; }
      feed = previousFeed;
      const items = groupsForFeed(); $('idea-list').replaceChildren(); $('idea-empty').hidden = items.length > 0;
      $('idea-empty').querySelector('h3').textContent = !latest ? 'Start with a fresh scan' : 'No ' + (feed === 'qualified' ? 'qualified ideas' : feed === 'research' ? 'research ideas' : 'rejected candidates') + ' in this scan';
      $('idea-empty').querySelector('p').textContent = !latest ? 'Scan now to review current ideas. Every detected signal is retained in the log.' : 'The scanner does not fill this feed with weaker substitutes. Review the other feeds or scan again after fresh candles close.';
      $('feed-description').textContent = feed === 'qualified' ? 'Grouped shortlist ideas, including currently tracked paper plans. Supporting observations are not separate confirmations.' : feed === 'research' ? 'Valid plans outside the shortlist, grouped for research. No grade or past winning symbol promotes them.' : 'Candidates that fail validity, activity, or repeat checks. Every observation remains in the export.';
      if (items.length > 120) $('feed-description').textContent += ' Showing the first 120; export contains every observation.';
      items.slice(0, 120).forEach(item => {
        const d = getDecision(item), li = document.createElement('li'), button = document.createElement('button');
        button.className = 'idea-row'; button.type = 'button'; button.setAttribute('aria-pressed', String(selected === item.id)); button.setAttribute('aria-controls', 'idea-detail'); button.dataset.ideaId = item.id;
        button.innerHTML = '<span class="idea-head"><strong>' + escape(d.symbol) + '</strong><span class="chip ' + escape(d.dir) + '">' + escape(d.dir) + '</span><span>' + escape(d.setupId) + ' · ' + escape(d.tf) + '</span></span><span class="idea-sub">' + escape(time(d.t)) + (item.support && item.support.length > 1 ? ' · ' + [...new Set(item.support.map(s => s.setupId + '|' + s.tf))].length + ' supporting setups' : '') + '</span><span class="idea-meta">' + escape(item.rejected ? d.reasons[0] : feed === 'qualified' ? 'Provisional research candidate' : 'Outside shortlist') + '</span>';
        button.addEventListener('click', () => { selected = item.id; renderFeed(); const current = [...$('idea-list').querySelectorAll('button')].find(b => b.dataset.ideaId === item.id); if (current) current.focus({ preventScroll: true }); }); li.append(button); $('idea-list').append(li);
      });
      const chosen = items.find(x => x.id === selected); if (chosen) showDetail(chosen); else { clearChart(); selected = null; $('idea-detail').innerHTML = '<p id="detail-empty">Select an idea to inspect its plan, reasons, and evidence.</p>'; }
    }
    function evidenceRows(signals) {
      const groups = C.summarize(signals).groups;
      const end = signals.reduce((n, s) => Math.max(n, s.t || 0), 0), cut = end - 8 * 864e5;
      return groups.map(g => {
        const recent = C.summarize(signals.filter(s => (s.setupId || s.setup) === g.setupId && s.tf === g.tf && s.t >= cut)).total;
        return '<tr><th scope="row">' + escape(g.setupId) + '</th><td>' + escape(g.tf) + '</td><td class="n">' + g.closedN + '</td><td class="n">' + g.openN + '</td><td class="n">' + signed(g.avgR) + '</td><td class="n">' + fmt(g.profitFactor, 2) + '</td><td class="n">' + signed(recent.avgR) + ' <small>(n=' + recent.closedN + ')</small></td></tr>';
      }).join('') || '<tr><td colspan="7">No completed evidence yet. Open and unfilled plans remain separate.</td></tr>';
    }
    function renderEvidence() {
      $('historical-evidence-body').innerHTML = evidenceRows(history);
      const records = cohortRecords(), signals = forwardSignals(state, currentManifest.id), summary = C.summarize(signals), cohort = state.cohorts.find(c => c.id === currentManifest.id);
      $('forward-evidence-body').innerHTML = evidenceRows(signals.filter(s => s.accepted));
      $('rule-version').textContent = C.POLICY.version; $('rules-frozen-at').textContent = cohort ? time(cohort.startedAt) : 'At the first saved scan'; $('validation-start').textContent = cohort ? time(cohort.startedAt) : 'Not started';
      $('accepted-count').textContent = summary.accepted.n; $('rejected-count').textContent = summary.rejected.n;
      $('accepted-result').textContent = summary.accepted.closedN ? signed(summary.accepted.avgR) + 'R / close · n=' + summary.accepted.closedN : 'No closed plans';
      $('rejected-result').textContent = summary.rejected.closedN ? signed(summary.rejected.avgR) + 'R / close · n=' + summary.rejected.closedN : 'No closed plans';
      const incomplete = records.filter(r => r.evaluationError || r.ev && !r.ev.coverageComplete).length;
      $('validation-status').textContent = 'One independent paper candidate per setup/timeframe episode. Rejected comparison includes valid active plans only; invalid plans remain in the log.' + (incomplete ? ' ' + incomplete + ' plans have incomplete data and are excluded from closed metrics.' : '');
      $('forward-status').textContent = 'Current frozen rules and settings · ' + summary.total.openN + ' open · ' + summary.total.pendingN + ' pending. Source digest ' + digest.slice(0, 12) + '.';
    }
    function renderEvents() {
      $('event-log').replaceChildren();
      if (!state.events.length) { const li = document.createElement('li'); li.className = 'log-empty'; li.textContent = 'No observations yet. Run a scan to begin.'; $('event-log').append(li); }
      state.events.slice(-35).reverse().forEach(e => {
        const li = document.createElement('li'), d = e.payload.decision;
        li.textContent = time(e.at) + ' · ' + e.type + (d ? ' · ' + d.symbol + ' ' + d.setupId + ' ' + d.tf + ' · ' + (d.accepted ? 'qualified' : d.reasons.join('; ')) : e.type === 'outcome' ? ' · ' + e.payload.symbol + ' · ' + e.payload.ev.st : e.type === 'upgrade' ? ' · new decision; original preserved' : ''); $('event-log').append(li);
      });
    }
    function render() { renderFeed(); renderEvidence(); renderEvents(); $('last-scan').textContent = state.latest ? time(state.latest.at) : 'Not scanned'; }
    async function evaluate(next, at) {
      const open = next.records.filter(r => !(r.ev && r.ev.done && r.ev.coverageComplete)), bySymbol = new Map(), events = [];
      open.forEach(r => { const sym = r.decision.sym; if (!bySymbol.has(sym)) bySymbol.set(sym, []); bySymbol.get(sym).push(r); });
      for (const [sym, records] of bySymbol) {
        progress({ message: 'Evaluating saved paper plans: ' + sym, done: 0, total: bySymbol.size });
        try {
          const startTime = Math.min(...records.map(r => r.decision.t));
          const series = await client.candles(sym, '15m', { at, startTime });
          for (const r of records) {
            const ev = C.simulate(r.decision, series, at);
            const material = value => value && [value.st, value.fill, value.avgFill, value.fees, value.R, value.uR, value.coverageComplete, value.tp, value.fills, value.exits];
            if (JSON.stringify(material(r.ev)) !== JSON.stringify(material(ev))) events.push(C.createEvent('outcome', at, { cohortId: r.cohortId, decisionId: r.id, symbol: r.decision.symbol, ev }));
            r.ev = ev; r.evaluationError = ev.coverageComplete ? null : 'Candle coverage is incomplete. Closed metrics exclude this plan.';
          }
        } catch (e) { records.forEach(r => { r.evaluationError = 'Paper evaluation unavailable: ' + e.message; }); }
      }
      next.events = C.appendEvents(next.events, events); return next;
    }
    async function scan() {
      if (busy || storageFailed) return;
      busy = true; $('scan-btn').disabled = true; $('save-settings').disabled = true; error(null);
      try {
        const data = await client.scan(settings, progress);
        const next = ingest(state, data, currentManifest);
        next.records.filter(r => !r.ev).forEach(r => { r.ev = C.simulate(r.decision, { t: [], o: [], h: [], l: [], c: [] }, data.at); });
        state = next;
        try { await save(state); } catch (e) { storageFailed = true; $('auto-scan').checked = false; throw new Error('Could not save the observation log. Export it now before closing this page. ' + e.message); }
        $('scan-status').textContent = 'Scan saved · ' + data.counts.scanned + ' symbols analyzed · ' + data.errors.length + ' data issues';
        if (data.errors.length) error('Some symbols were excluded because their data could not be verified. Details are in the exported scan log.');
        render();
        state = await evaluate(clone(state), data.at);
        try { await save(state); } catch (e) { storageFailed = true; $('auto-scan').checked = false; throw new Error('Could not save updated paper outcomes. Export the current log before closing this page. ' + e.message); }
        render(); $('scan-status').textContent = 'Scan saved · ' + data.counts.scanned + ' symbols analyzed · paper plans evaluated';
      } catch (e) { error(e.message); $('scan-status').textContent = storageFailed ? 'Storage failed · export the current log' : 'Scan unavailable · retry when the data source is reachable'; if (storageFailed) render(); }
      finally { busy = false; $('scan-btn').disabled = storageFailed; $('save-settings').disabled = storageFailed; $('scan-progress').hidden = true; }
    }
    document.querySelectorAll('[data-feed]').forEach(button => button.addEventListener('click', () => {
      feed = button.dataset.feed; selected = null; document.querySelectorAll('[data-feed]').forEach(b => b.setAttribute('aria-pressed', String(b === button))); renderFeed();
    }));
    $('account-size').value = settings.account; $('risk-percent').value = settings.riskPct; $('universe-size').value = settings.universeSize;
    $('settings-form').addEventListener('submit', async e => {
      e.preventDefault(); if (busy) return;
      const next = { ...defaults, account: Number($('account-size').value), riskPct: Number($('risk-percent').value), universeSize: Number($('universe-size').value) };
      if (!validSettings(next)) { $('settings-status').textContent = 'Enter a positive account size, valid risk percentage, and a listed universe size.'; return; }
      settings = next; currentManifest = manifest(); selected = null;
      try { localStorage.setItem('krillin-chatgpt-settings-v1', JSON.stringify(settings)); $('settings-status').textContent = 'Saved. Changed settings start a separate forward cohort; earlier observations remain available in the export.'; }
      catch (_) { $('settings-status').textContent = 'Applied for this page. Browser preferences could not be saved.'; }
      render();
    });
    $('scan-btn').addEventListener('click', scan);
    $('auto-scan').addEventListener('change', () => { if ($('auto-scan').checked) scan(); });
    setInterval(() => { if ($('auto-scan').checked && document.visibilityState === 'visible') scan(); }, 15 * 60e3);
    $('export-log').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify({ application: 'Krillin Chatgpt', exportedAt: new Date().toISOString(), policy: C.POLICY, sourceDigest: digest, state }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'krillin-chatgpt-observations-' + new Date().toISOString().slice(0, 10) + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    render(); $('scan-status').textContent = 'Ready · scans run while this page is open';
    try {
      const response = await fetch('../data/index.json', { cache: 'no-cache', credentials: 'omit' }); if (!response.ok) throw new Error('Historical index is unavailable'); historyIndex = await response.json();
      if (!Array.isArray(historyIndex.months) || historyIndex.months.some(m => !/^\d{4}-\d{2}$/.test(m))) throw new Error('Historical index has an invalid month list');
      const months = historyIndex.months.slice(-2); // signals don't need history; the evidence table only shows the last two months (the full replay is a year+)
      for (const month of months) {
        const r = await fetch('../data/signals-' + month + '.json', { credentials: 'omit' }); if (!r.ok) throw new Error('Historical month ' + month + ' is unavailable');
        const data = await r.json(); if (!Array.isArray(data.signals)) throw new Error('Historical month has an invalid format'); history.push(...data.signals);
      }
      $('historical-source').textContent = 'Original replay, last ' + months.length + ' month' + (months.length === 1 ? '' : 's') + ' (' + months[0] + ' on; the full history is in the main scanner\'s Results tab) through ' + historyIndex.coverage.last + ' UTC · ' + history.length + ' raw signals. Exploratory; selected after inspecting these outcomes.';
      $('historical-status').textContent = 'All original setups are shown. Recent mean uses the latest eight signal days. Unresolved trades can bias recent comparisons.';
      renderEvidence();
    } catch (e) { $('historical-source').textContent = 'Historical source unavailable'; $('historical-status').textContent = e.message + '. Live scanning and forward observations remain separate.'; }
  }
})(typeof window !== 'undefined' ? window : globalThis);
