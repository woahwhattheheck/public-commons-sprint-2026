// MIT. Local-only read-only interface. All server strings enter the DOM as text, never markup.
import { renderRecentOutcomes } from './recent.mjs';
const $ = id => document.getElementById(id);
const number = new Intl.NumberFormat();
let last = null, paused = false, timer = null, busy = false, receivedAt = 0;
let historyEnabled = false, historyLast = null, historyAttemptAt = 0;
let historyController = null, historySequence = 0, historyQuery = '';
const text = (id, value) => { $(id).textContent = value; };
const fmt = value => value === null || value === undefined ? '—' : number.format(value);
const p95 = value => value === null || value === undefined ? '—' : typeof value === 'number' ? `≤ ${fmt(value)} ms` : '> 15,000 ms';
function renderRows() {
  if (!last) return;
  const query = $('filter').value.trim().toLowerCase();
  const rows = last.routes.filter(row => !row.id.startsWith('@') || row.started).filter(row => `${row.id} ${row.method} ${row.path}`.toLowerCase().includes(query))
    .sort((a, b) => (b.serverError + b.disconnected) - (a.serverError + a.disconnected) || b.started - a.started || a.id.localeCompare(b.id));
  const fragment = document.createDocumentFragment();
  for (const row of rows) {
    const tr = document.createElement('tr'), name = document.createElement('th');
    name.scope = 'row';
    const primary = document.createElement('strong'), detail = document.createElement('span');
    primary.textContent = row.id; detail.textContent = `${row.method} ${row.path}`;
    name.append(primary, detail); tr.append(name);
    for (const key of ['started', 'success', 'challenge', 'clientError', 'serverError', 'disconnected', 'inFlight']) {
      const td = document.createElement('td'); td.textContent = fmt(row[key]);
      if (row[key] && ['serverError', 'disconnected'].includes(key)) td.className = 'attention';
      tr.append(td);
    }
    const td = document.createElement('td'); td.textContent = p95(row.latencyP95UpperBoundMs); tr.append(td);
    fragment.append(tr);
  }
  $('routes').replaceChildren(fragment); $('empty').hidden = rows.length > 0;
}
function renderUpstreams(snapshot) {
  const panel = $('upstream-panel');
  if (!snapshot) { panel.hidden = true; return; }
  if (snapshot.schema !== 'stellar-forge.seller-upstream-availability.v1' || !Array.isArray(snapshot.bindings))
    throw new Error('Unsupported upstream snapshot');
  panel.hidden = false;
  const labels = { CLOSED: 'Requests allowed', OPEN: 'Cooling down',
    RECOVERY_READY: 'Ready for one recovery call', RECOVERY_IN_FLIGHT: 'Recovery call in flight' };
  const fragment = document.createDocumentFragment();
  for (const row of snapshot.bindings) {
    const tr = document.createElement('tr'), name = document.createElement('th');
    name.scope = 'row'; name.textContent = `${row.name} · ${row.method}`; tr.append(name);
    const gate = row.availability;
    for (const value of [gate ? labels[gate.state] ?? gate.state : 'Protection not enabled',
      fmt(row.inFlight), gate ? fmt(gate.maxInFlight) : '—', fmt(row.failed),
      gate ? fmt(gate.admissionRejected) : '—', gate ? fmt(gate.recoveryCalls) : '—',
      gate?.retryAfterMs ? `${fmt(Math.ceil(gate.retryAfterMs / 1000))} s` : '—',
      gate?.lastStatus ?? 'Unobserved']) {
      const td = document.createElement('td'); td.textContent = String(value); tr.append(td);
    }
    fragment.append(tr);
  }
  $('upstreams').replaceChildren(fragment);
}
function render(snapshot) {
  if (snapshot.schema !== 'stellar-forge.seller-traffic.v1') throw new Error('Unsupported snapshot');
  last = snapshot; receivedAt = Date.now();
  const totals = snapshot.totals;
  text('mode', snapshot.mode === 'NATIVE_X402' ? 'Native x402 service' : snapshot.mode === 'CHALLENGE_ONLY' ? 'Challenge-only service' : 'Runtime unknown');
  text('started', fmt(totals.started)); text('success', fmt(totals.success));
  text('challenge', fmt(totals.challenge)); text('in-flight', fmt(totals.inFlight));
  text('success-rate', totals.httpSuccessPercent === null ? 'Not settlement or revenue' : `${fmt(totals.httpSuccessPercent)}% of finished HTTP responses · not revenue`);
  text('latency', totals.durationMeanMs === null ? 'No completed requests yet' : `${fmt(totals.durationMeanMs)} ms mean · ${p95(totals.latencyP95UpperBoundMs)} p95`);
  text('connection', `Live · updated ${new Date(snapshot.capturedAt).toLocaleTimeString()}${snapshot.attached ? '' : ' · observer detached'}`);
  $('connection').className = snapshot.attached ? '' : 'attention';
  text('session', `Session ${snapshot.sessionId.slice(0, 8)} · observing since ${new Date(snapshot.startedAt).toLocaleString()}`);
  const max = Math.max(1, ...snapshot.minutes.map(x => x.started));
  const bars = document.createDocumentFragment();
  let recent = 0;
  for (const minute of snapshot.minutes) {
    const bar = document.createElement('div'); bar.className = 'bar';
    // CSS custom properties are numeric values, never server-provided style strings.
    bar.style.setProperty('--height', `${Math.max(2, minute.started / max * 100)}%`);
    if (!minute.started) bar.classList.add('zero');
    bar.title = `${new Date(minute.minute).toLocaleTimeString()}: ${minute.started} attempts, ${minute.serverError} server errors`;
    if (minute.serverError) bar.classList.add('failed');
    bars.append(bar); recent += minute.started;
  }
  $('timeline').replaceChildren(bars); $('timeline').setAttribute('aria-label', `${recent} attempts over the last 60 minutes. Peak ${max} per minute.`);
  text('recent', `${fmt(recent)} attempts`);
  const signals = [];
  if (snapshot.mode === 'CHALLENGE_ONLY') signals.push('This service advertises payment challenges only. Application handlers are not enabled in this mode.');
  if (!totals.started) signals.push('No application traffic observed yet. Health and offers probes are excluded; request an advertised resource to see it here.');
  if (totals.serverError) signals.push(`${fmt(totals.serverError)} HTTP 5xx responses. The route table puts failing routes first; inspect the seller runtime for the cause.`);
  if (totals.disconnected) signals.push(`${fmt(totals.disconnected)} requests disconnected before finish. Their payment outcomes cannot be inferred from this dashboard.`);
  if (totals.challenge) signals.push(`${fmt(totals.challenge)} payment challenges returned. Retries count separately; this is not a buyer conversion rate.`);
  if (snapshot.observerErrors) signals.push(`${fmt(snapshot.observerErrors)} observer errors. Counts may be incomplete; seller handling was not changed.`);
  if (snapshot.attached && totals.started && !totals.serverError && !totals.disconnected) signals.push('No server errors or early disconnects observed in this session.');
  const fragment = document.createDocumentFragment();
  for (const signal of signals) { const p = document.createElement('p'); p.textContent = signal; fragment.append(p); }
  $('signals').replaceChildren(fragment); renderRows(); renderRecentOutcomes(snapshot); renderUpstreams(snapshot.upstreams);
  updateHistoryAvailability(snapshot.usageHistory);
  if (paused) text('connection', 'Updates paused · exports still request a fresh server snapshot');
}

const UTC_DAY = 86400000;
const utcDay = time => new Date(time).toISOString().slice(0, 10);
const utcTime = value => {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime()) ? date.toISOString().replace('T', ' ').slice(0, 19) : '—';
};
function rangeQuery() {
  const query = new URLSearchParams({ from: $('history-from').value, to: $('history-to').value });
  if ($('history-route').value) query.set('routeId', $('history-route').value);
  return query.toString();
}
function setHistoryRange(days) {
  const today = utcDay(Date.now());
  $('history-from').value = utcDay(Date.parse(today) - (days - 1) * UTC_DAY);
  $('history-to').value = today;
  $('history-from').max = today; $('history-to').max = today;
}
function historyRoutes(routes = []) {
  const selected = $('history-route').value;
  const known = new Map();
  for (const route of [...(last?.routes ?? []), ...routes]) {
    if (typeof route.id !== 'string') continue;
    if (!known.has(route.id)) known.set(route.id, { ...route, variants: new Set() });
    known.get(route.id).variants.add(JSON.stringify([route.method, route.path]));
  }
  if (selected && !known.has(selected)) known.set(selected, { id: selected, variants: new Set() });
  const options = document.createDocumentFragment(), all = document.createElement('option');
  all.value = ''; all.textContent = 'All routes'; options.append(all);
  for (const route of [...known.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    const option = document.createElement('option'); option.value = route.id;
    option.textContent = route.variants.size > 1 ? `${route.id} · ${route.variants.size} route configurations` :
      route.path ? `${route.id} · ${route.method ?? ''} ${route.path}` : route.id;
    options.append(option);
  }
  $('history-route').replaceChildren(options); $('history-route').value = selected;
}
function historyDelta(current, previous) {
  if (!previous) return '—';
  const change = current.started - previous.started;
  const count = `${change > 0 ? '+' : ''}${fmt(change)}`;
  if (!previous.started) return change ? `${count} (from 0)` : count;
  const percent = Math.round(change / previous.started * 1000) / 10;
  return `${count} (${percent > 0 ? '+' : ''}${fmt(percent)}%)`;
}
function tableCell(row, value, attention = false) {
  const cell = document.createElement('td'); cell.textContent = value;
  if (attention) cell.className = 'attention'; row.append(cell);
}
function renderHistory(view, requestedQuery) {
  if (view.schema !== 'stellar-forge.seller-usage-history.v1') throw new Error('Unsupported usage history');
  if (!view.enabled) { updateHistoryAvailability({ enabled: false }); return; }
  historyLast = view;
  const totals = view.totals, days = [...view.days].sort((a, b) => a.day.localeCompare(b.day));
  const byDay = new Map(days.map(day => [day.day, day.totals]));
  text('history-attempts', fmt(totals.started)); text('history-success', fmt(totals.success));
  text('history-challenge', fmt(totals.challenge));
  text('history-failures', fmt(totals.serverError + totals.disconnected));
  historyRoutes(view.routes);
  const rows = document.createDocumentFragment(), today = utcDay(Date.now());
  for (const day of days.reverse()) {
    const row = document.createElement('tr'), label = document.createElement('th'); label.scope = 'row';
    label.textContent = day.day;
    if (day.day === today) { const partial = document.createElement('span'); partial.textContent = 'Today · partial'; label.append(partial); }
    row.append(label);
    const previous = byDay.get(utcDay(Date.parse(day.day) - UTC_DAY));
    tableCell(row, fmt(day.totals.started)); tableCell(row, historyDelta(day.totals, previous));
    for (const key of ['success', 'challenge', 'clientError', 'serverError', 'disconnected']) {
      tableCell(row, fmt(day.totals[key]), day.totals[key] > 0 && ['serverError', 'disconnected'].includes(key));
    }
    tableCell(row, p95(day.totals.latencyP95UpperBoundMs)); rows.append(row);
  }
  $('history-days').replaceChildren(rows); $('history-empty').hidden = days.length > 0;
  const sessions = document.createDocumentFragment();
  for (const session of view.sessions) {
    const row = document.createElement('tr'), label = document.createElement('th'); label.scope = 'row';
    label.textContent = session.sessionId?.slice(0, 12) ?? '—';
    if (session.sessionId) label.title = session.sessionId;
    row.append(label); tableCell(row, utcTime(session.startedAt)); tableCell(row, utcTime(session.savedAt));
    const state = String(session.state ?? 'unknown').toLowerCase();
    tableCell(row, ({ active: 'Active', finalized: 'Finalized', interrupted: 'Interrupted' })[state] ?? 'Unknown', state === 'interrupted');
    tableCell(row, fmt(session.outstandingAtCheckpoint), state === 'interrupted' && session.outstandingAtCheckpoint > 0);
    sessions.append(row);
  }
  $('history-sessions').replaceChildren(sessions);
  text('history-session-count', `(${fmt(view.sessions.length)})`);
  $('history-sessions-empty').hidden = view.sessions.length > 0;
  const range = view.range;
  text('history-range-status', `${range.from} through ${range.to} UTC · ${range.routeId || 'all routes'} · ${fmt(days.length)} observed days · updated ${utcTime(view.generatedAt)} UTC${range.truncatedByRetention ? ' · earlier dates are outside retention' : ''}`);
  $('history-range-status').className = '';
  historyQuery = new URLSearchParams({ from: range.from, to: range.to, ...(range.routeId ? { routeId: range.routeId } : {}) }).toString();
  if (rangeQuery() === requestedQuery) {
    $('history-from').value = range.from; $('history-to').value = range.to; $('history-route').value = range.routeId ?? '';
  }
  if (rangeQuery() !== historyQuery) $('history-range-status').append(' · unapplied range changes');
  $('history-json').href = `/history.json?${historyQuery}`; $('history-csv').href = `/history.csv?${historyQuery}`;
  for (const id of ['history-json', 'history-csv']) { $(id).removeAttribute('aria-disabled'); $(id).removeAttribute('tabindex'); }
  renderHistoryStorage(view.storage, view.retentionDays);
}
function renderHistoryStorage(storage = {}, retentionDays) {
  const details = [`Up to ${fmt(retentionDays ?? storage.retentionDays)} UTC days retained.`];
  if (storage.checkpointIntervalMs) details.push(`Active usage checkpoints every ${fmt(storage.checkpointIntervalMs / 1000)} seconds.`);
  if (storage.lastCheckpointAt) details.push(`Last saved ${utcTime(storage.lastCheckpointAt)} UTC.`);
  if (storage.checkpointFailures) details.push(`${fmt(storage.checkpointFailures)} failed checkpoints; retained counts may be incomplete.`);
  if (storage.damagedSessions?.length) details.push(`${fmt(storage.damagedSessions.length)} unreadable sessions were excluded.`);
  details.push('Recent individual outcomes stay in memory. A sudden stop can lose activity since the last checkpoint.');
  text('history-storage', details.join(' '));
  const unhealthy = storage.healthy === false || !!storage.lastError || storage.damagedSessions?.length > 0;
  text('history-state', unhealthy ? 'Storage needs attention' : 'History enabled');
  $('history-state').className = unhealthy ? 'badge attention' : 'badge';
}
function updateHistoryAvailability(storage) {
  if (!storage) return;
  historyEnabled = storage.enabled === true;
  $('history-content').hidden = !historyEnabled; $('history-setup').hidden = historyEnabled;
  if (!historyEnabled) {
    historyController?.abort(); historyController = null;
    text('history-state', 'History off');
    text('history-setup', 'Daily history is off for this seller. Configure a private history folder when starting the service to retain aggregate usage across restarts. The live view remains available.');
    return;
  }
  renderHistoryStorage(storage, historyLast?.retentionDays);
  if (!paused && !document.hidden && !historyController && Date.now() - historyAttemptAt > 15000) refreshHistory();
}
async function refreshHistory(manual = false) {
  if (!historyEnabled || ((manual || !historyQuery) && !$('history-form').reportValidity())) return;
  const from = $('history-from').value, to = $('history-to').value;
  if ((manual || !historyQuery) && from > to) { text('history-range-status', 'Choose a start date on or before the end date.'); return; }
  const requestedQuery = manual || !historyQuery ? rangeQuery() : historyQuery;
  historyController?.abort(); const controller = new AbortController(); historyController = controller;
  const sequence = ++historySequence; historyAttemptAt = Date.now();
  const timeout = setTimeout(() => controller.abort(), 5000);
  $('history-form').setAttribute('aria-busy', 'true'); $('history-apply').disabled = true;
  try {
    const response = await fetch(`/api/history?${requestedQuery}`, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const view = await response.json();
    if (sequence === historySequence) renderHistory(view, requestedQuery);
  } catch {
    if (sequence === historySequence) {
      text('history-range-status', historyLast ? 'History could not refresh. The table and export range remain at the last loaded selection.' : 'History is unavailable. Check the date range and the seller’s history storage, then apply again.');
      $('history-range-status').className = 'attention';
    }
  } finally {
    clearTimeout(timeout);
    if (sequence === historySequence) {
      historyController = null; $('history-apply').disabled = false; $('history-form').removeAttribute('aria-busy');
    }
  }
}
async function refresh() {
  clearTimeout(timer);
  if (paused || document.hidden || busy) return;
  busy = true;
  try {
    const response = await fetch('/api/snapshot', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    render(await response.json());
  } catch {
    text('connection', last ? `Connection unavailable · showing snapshot from ${new Date(receivedAt).toLocaleTimeString()}` : 'Cannot reach operations server. Check that the launcher is still running.');
    $('connection').className = 'attention';
  } finally {
    busy = false;
    if (!paused && !document.hidden) timer = setTimeout(refresh, 3000);
  }
}
$('filter').addEventListener('input', renderRows);
$('history-form').addEventListener('submit', event => { event.preventDefault(); refreshHistory(true); });
$('history-form').addEventListener('input', () => {
  if (historyLast && rangeQuery() !== historyQuery) text('history-range-status', 'Range changed. Apply it to update the table and export selection.');
});
$('history-seven').addEventListener('click', () => { setHistoryRange(7); refreshHistory(true); });
$('history-thirty').addEventListener('click', () => { setHistoryRange(30); refreshHistory(true); });
for (const id of ['history-json', 'history-csv']) $(id).addEventListener('click', event => { if (!historyLast) event.preventDefault(); });
setHistoryRange(7);
$('pause').addEventListener('click', () => {
  paused = !paused; $('pause').textContent = paused ? 'Resume updates' : 'Pause updates';
  clearTimeout(timer);
  if (paused) text('connection', 'Updates paused · exports still request a fresh server snapshot');
  else refresh();
});
document.addEventListener('visibilitychange', () => { clearTimeout(timer); if (!document.hidden && !paused) refresh(); });
refresh();

