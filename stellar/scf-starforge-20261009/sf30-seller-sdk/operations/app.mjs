// MIT. No dependencies, external assets, or HTML interpolation of server data.
const byId = id => document.getElementById(id);
const count = value => new Intl.NumberFormat().format(value);
let snapshot = null, paused = false, fetching = false, timer = null;
function statusSum(statuses, lower, upper) {
  return Object.entries(statuses).reduce((n, [code, value]) => n + (+code >= lower && +code <= upper ? value : 0), 0);
}
function cell(row, value, className = '') {
  const node = document.createElement('td'); node.textContent = String(value); node.className = className; row.append(node); return node;
}
function routeLabel(route) { return `${route.method} ${route.path}`; }
function latency(value) {
  if (!value.count) return '—';
  return value.p95UpperBoundMs === null ? '>60,000' : count(value.p95UpperBoundMs);
}
function duration(seconds) {
  if (seconds < 60) return `${Math.floor(seconds)}s uptime`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m uptime`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m uptime`;
}
function renderRecent() {
  if (!snapshot) return;
  const filter = byId('route-filter').value, outcome = byId('outcome-filter').value;
  const labels = new Map(snapshot.routes.map(row => [row.routeId, row.path]));
  const events = snapshot.recent.filter(row => (!filter || row.routeId === filter) &&
    (outcome === 'errors' ? row.outcome === 'completed' && row.status >= 400 : !outcome || row.outcome === outcome));
  const body = byId('recent'); body.replaceChildren();
  for (const event of events) {
    const row = document.createElement('tr');
    cell(row, new Date(event.at).toLocaleTimeString());
    cell(row, labels.get(event.routeId) ?? event.routeId, 'path');
    cell(row, event.method); cell(row, event.outcome, event.outcome === 'aborted' ? 'warn' : '');
    cell(row, event.status === null ? 'Not sent' : event.status, event.status >= 500 ? 'warn' : '');
    cell(row, event.durationMs); body.append(row);
  }
  byId('empty').hidden = events.length !== 0;
  byId('empty').textContent = snapshot.totals.received === 0
    ? 'No traffic observed yet. Use your existing seller endpoint; this page does not generate seller requests.'
    : 'No retained outcomes match these filters.';
}
function render(data) {
  snapshot = data;
  byId('mode').textContent = data.mode === 'NATIVE_X402' ? 'Native x402 runtime' : 'Challenge-only runtime';
  byId('uptime').textContent = duration(data.uptimeSeconds);
  byId('updated').textContent = `Snapshot ${new Date(data.capturedAt).toLocaleTimeString()}`;
  byId('received').textContent = count(data.totals.received);
  byId('rate').textContent = `${count(data.receivedInLast60SecondBuckets)} in last 60 second buckets`;
  byId('active').textContent = count(data.totals.active);
  byId('challenges').textContent = count(data.totals.statuses['402'] ?? 0);
  byId('failures').textContent = `${count(statusSum(data.totals.statuses, 500, 599))} / ${count(data.totals.aborted)}`;
  byId('retention').textContent = `Latest ${data.recent.length} of up to ${data.recentLimit} outcomes · memory only · no request contents.`;
  const body = byId('routes'); body.replaceChildren();
  for (const route of data.routes) {
    const row = document.createElement('tr');
    const name = cell(row, '', 'path');
    const strong = document.createElement('strong'); strong.textContent = routeLabel(route);
    const small = document.createElement('small'); small.textContent = route.routeId; name.append(strong, small);
    cell(row, count(route.received)); cell(row, count(route.active)); cell(row, count(route.completed));
    cell(row, count(route.statuses['402'] ?? 0));
    cell(row, count(statusSum(route.statuses, 400, 499) - (route.statuses['402'] ?? 0)));
    const failures = statusSum(route.statuses, 500, 599);
    cell(row, count(failures), failures ? 'warn' : ''); cell(row, count(route.aborted), route.aborted ? 'warn' : '');
    cell(row, latency(route.latency)); body.append(row);
  }
  const select = byId('route-filter'), selected = select.value;
  const unique = new Map(data.routes.map(route => [route.routeId, route.path]));
  select.replaceChildren(new Option('All routes', ''));
  for (const [id, path] of unique) select.add(new Option(path, id));
  if (unique.has(selected)) select.value = selected;
  renderRecent();
}
async function refresh() {
  if (fetching || paused || document.hidden) return;
  fetching = true;
  try {
    const response = await fetch('/api/traffic', { cache: 'no-store', credentials: 'omit',
      signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data.schema !== 'stellar-forge.seller-traffic.v1') throw new Error('Unexpected response schema');
    render(data);
    byId('connection').textContent = paused ? 'Refresh paused' : 'Live · loopback';
    byId('connection').className = paused ? '' : 'live';
  } catch {
    byId('connection').textContent = snapshot ? 'Disconnected · showing last snapshot' : 'Operator service unavailable';
    byId('connection').className = 'warn';
  } finally { fetching = false; }
}
function schedule() {
  clearInterval(timer); timer = null;
  if (!paused && !document.hidden) { refresh(); timer = setInterval(refresh, 2000); }
}
byId('pause').addEventListener('click', () => {
  paused = !paused; byId('pause').textContent = paused ? 'Resume refresh' : 'Pause refresh';
  byId('pause').setAttribute('aria-pressed', String(paused));
  if (paused) { byId('connection').textContent = 'Refresh paused'; byId('connection').className = ''; }
  schedule();
});
byId('route-filter').addEventListener('change', renderRecent);
byId('outcome-filter').addEventListener('change', renderRecent);
document.addEventListener('visibilitychange', schedule);
schedule();
