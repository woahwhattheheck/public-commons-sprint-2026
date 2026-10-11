// MIT. Local-only read-only interface. All server strings enter the DOM as text, never markup.
import { renderRecentOutcomes } from './recent.mjs';
const $ = id => document.getElementById(id);
const number = new Intl.NumberFormat();
let last = null, paused = false, timer = null, busy = false, receivedAt = 0;
const text = (id, value) => { $(id).textContent = value; };
const fmt = value => value === null || value === undefined ? '—' : number.format(value);
const p95 = value => value === null ? '—' : typeof value === 'number' ? `≤ ${fmt(value)} ms` : '> 15,000 ms';
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
  $('signals').replaceChildren(fragment); renderRows(); renderRecentOutcomes(snapshot);
  if (paused) text('connection', 'Updates paused · exports still request a fresh server snapshot');
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
$('pause').addEventListener('click', () => {
  paused = !paused; $('pause').textContent = paused ? 'Resume updates' : 'Pause updates';
  clearTimeout(timer);
  if (paused) text('connection', 'Updates paused · exports still request a fresh server snapshot');
  else refresh();
});
document.addEventListener('visibilitychange', () => { clearTimeout(timer); if (!document.hidden && !paused) refresh(); });
refresh();
