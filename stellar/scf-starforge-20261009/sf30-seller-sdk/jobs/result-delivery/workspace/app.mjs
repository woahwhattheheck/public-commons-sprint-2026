// MIT. Private delivery operations share the merchant workspace's original bearer token.
const $ = id => document.getElementById(id);
const tokenKey = 'starforge-job-result-delivery-token';
let token = location.hash.slice(1);
if (token) { sessionStorage.setItem(tokenKey, token); history.replaceState(null, '', location.pathname); }
else token = sessionStorage.getItem(tokenKey) ?? '';
$('jobs-link').href = '/#' + token;
let snapshot = null, selectedId = null, detailRow = null, page = 0, refreshing = null;
const pageSize = 100, requests = new Set();
const number = value => Number(value ?? 0).toLocaleString();
const date = value => value ? new Date(value).toLocaleString() : '—';
function bytes(value) {
  if (value < 1024) return number(value) + ' B';
  if (value < 1048576) return (value / 1024).toFixed(1) + ' KiB';
  return (value / 1048576).toFixed(1) + ' MiB';
}
function notice(text, error = false) { $('message').textContent = text; $('message').dataset.error = String(error); }
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function cell(row, text, className) { const element = node('td', text, className); row.append(element); return element; }
function empty(body, columns, text) {
  const row = node('tr'), item = cell(row, text, 'empty'); item.colSpan = columns; body.append(row);
}
async function api(path, body) {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    headers: { authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  let value;
  try { value = await response.json(); } catch { throw new Error('The workspace returned an incomplete response. Refresh to read retained state.'); }
  if (!response.ok) throw new Error(value.message || value.code || 'The operation could not complete.');
  return value;
}
function controls() {
  const busy = requests.size > 0, needsReopen = Boolean(snapshot?.reopenRequired);
  for (const button of document.querySelectorAll('[data-command]')) {
    const command = button.dataset.command;
    button.disabled = !snapshot || (command === 'stop' ?
      requests.has('stop') || !(snapshot.running || snapshot.sending || requests.has('drain')) :
      busy || needsReopen || command === 'start' && snapshot.running);
  }
  $('requeue').disabled = busy || needsReopen || !detailRow || !['RETRY', 'EXHAUSTED'].includes(detailRow.state);
  $('export').disabled = !snapshot || requests.has('export');
}
function renderDestinations() {
  const body = $('destinations'); body.replaceChildren();
  for (const destination of snapshot.destinations) {
    const row = node('tr'), label = cell(row, destination.id);
    if (!destination.enabled) label.append(node('span', 'Disabled', 'secondary'));
    const endpoint = cell(row, destination.url, 'mono wrap');
    if (destination.completedAfter) endpoint.append(node('span', 'Completed after ' + date(destination.completedAfter), 'secondary'));
    cell(row, destination.functionIds?.join(', ') || 'All configured functions', 'wrap');
    const readiness = cell(row, destination.enabled ? destination.secretConfigured ? 'Ready' : 'Secret required' : 'Paused');
    readiness.append(node('span', destination.secretEnv, 'secondary mono'));
    if (destination.error) readiness.append(node('span', destination.error, 'secondary'));
    body.append(row);
  }
}
function renderDetail() {
  detailRow = snapshot?.deliveries.find(row => row.id === selectedId) ?? null;
  $('detail').hidden = !detailRow;
  if (!detailRow) { controls(); return; }
  const row = detailRow, manifest = row.manifest, facts = $('detail-facts');
  $('detail-title').textContent = 'Delivery · ' + manifest.job.id;
  $('detail-id').textContent = row.id; facts.replaceChildren();
  const items = [
    ['State', row.state + (snapshot.paused.includes(row.id) ? ' · paused by destination configuration' : '')],
    ['Revision', number(row.revision)],
    ['Function', manifest.job.functionId],
    ['Destination', manifest.destination.id + ' · ' + manifest.destination.url],
    ['Result', manifest.result.filename + ' · ' + bytes(manifest.result.bytes) + ' · ' + manifest.result.contentType],
    ['Result SHA-256', manifest.result.sha256],
    ['Original settlement', manifest.nativeSettlement.id],
    ['Completed', date(manifest.job.completedAt)],
    ['Queued', date(row.createdAt)],
    ['Updated', date(row.updatedAt)],
    ['Attempts', number(row.attemptCount) + ' total · ' + number(row.attemptCount - row.retryBase) + ' in the current budget'],
    ['Next attempt', date(row.nextAttemptAt)],
    ['Last outcome', row.error || (row.receipt ? 'Receiver confirmed STORED' : '—')],
  ];
  for (const [label, value] of items) facts.append(node('dt', label), node('dd', value, /SHA|settlement/.test(label) ? 'mono' : undefined));
  const body = $('attempts'); body.replaceChildren();
  for (const attempt of [...row.attempts].reverse()) {
    const entry = node('tr');
    for (const value of [number(attempt.number), date(attempt.startedAt), date(attempt.finishedAt), attempt.state,
      attempt.httpStatus ?? '—', attempt.code ?? '—']) cell(entry, String(value));
    body.append(entry);
  }
  if (!row.attempts.length) empty(body, 6, 'This delivery has no send attempts.');
  $('manifest').textContent = JSON.stringify({ manifest, receipt: row.receipt }, null, 2);
  $('requeue-panel').hidden = !['RETRY', 'EXHAUSTED'].includes(row.state);
  controls();
}
function renderDeliveries() {
  const query = $('filter').value.trim().toLowerCase(), all = snapshot.deliveries;
  const rows = query ? all.filter(row => [row.id, row.manifest.job.id, row.manifest.job.functionId,
    row.manifest.destination.id, row.manifest.result.filename, row.state].some(value => value.toLowerCase().includes(query))) : all;
  const pages = Math.max(1, Math.ceil(rows.length / pageSize)); page = Math.min(page, pages - 1);
  const first = page * pageSize, body = $('deliveries'); body.replaceChildren();
  $('delivery-count').textContent = number(all.length) + ' retained · ' + number(rows.length) + ' match the current filter';
  for (const row of rows.slice(first, first + pageSize)) {
    const entry = node('tr'), job = cell(entry), button = node('button', row.manifest.job.id, 'row-link');
    button.type = 'button';
    button.addEventListener('click', () => {
      if (selectedId !== row.id) $('reason').value = '';
      selectedId = row.id; renderDetail(); $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    job.append(button, node('span', row.manifest.job.functionId + ' · ' + row.id.slice(0, 12), 'secondary mono'));
    cell(entry, row.manifest.destination.id);
    const stateCell = cell(entry), state = node('span', row.state, 'state'); state.dataset.state = row.state; stateCell.append(state);
    if (snapshot.paused.includes(row.id)) stateCell.append(node('span', 'Paused by configuration', 'secondary'));
    if (row.error) stateCell.append(node('span', row.error, 'secondary'));
    const result = cell(entry, row.manifest.result.filename, 'wrap');
    result.append(node('span', bytes(row.manifest.result.bytes), 'secondary'));
    cell(entry, number(row.attemptCount));
    cell(entry, date(row.nextAttemptAt));
    body.append(entry);
  }
  if (!rows.length) empty(body, 6, all.length ? 'No deliveries match this filter.' : 'Collect completed paid jobs to create destination deliveries.');
  $('page-label').textContent = rows.length ? number(first + 1) + '–' + number(Math.min(first + pageSize, rows.length)) + ' of ' + number(rows.length) : '0 deliveries';
  $('previous').disabled = page === 0; $('next').disabled = page + 1 >= pages;
  renderDetail();
}
function render() {
  for (const [id, state] of [['queued', 'QUEUED'], ['sending', 'SENDING'], ['retry', 'RETRY'], ['delivered', 'DELIVERED'], ['exhausted', 'EXHAUSTED']])
    $('metric-' + id).textContent = number(snapshot.counts[state]);
  $('metric-paused').textContent = number(snapshot.paused.length);
  $('dispatcher-state').textContent = [snapshot.running ? 'Automatic delivery is running' : 'Automatic delivery is stopped',
    snapshot.sending ? 'Sending due results' : 'No active send batch', 'Storage: ' + snapshot.storage].join(' · ');
  const run = snapshot.lastRun;
  $('last-run').textContent = run ? 'Last run ' + date(run.finishedAt) + ' · ' + number(run.attempted) + ' attempted · ' +
    number(run.delivered) + ' delivered · ' + number(run.exhausted) + ' exhausted' + (run.interrupted ? ' · interrupted' : '') :
    'No dispatch run in this process.';
  if (snapshot.reopenRequired) notice('The sender stopped after a state write failed. Restore writable storage, then restart the owning merchant service to recover retained attempts.', true);
  renderDestinations(); renderDeliveries(); controls();
  $('updated').textContent = 'Updated ' + new Date().toLocaleTimeString();
}
function refresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => { snapshot = await api('/api/deliveries'); render(); })().finally(() => { refreshing = null; });
  return refreshing;
}
async function command(name) {
  if (requests.has(name)) return;
  requests.add(name); controls();
  const messages = { scan: 'Collecting completed results…', drain: 'Sending due results…',
    start: 'Starting automatic delivery…', stop: 'Stopping the dispatcher…' };
  notice(messages[name]);
  try {
    const result = await api('/api/deliveries/' + name, {}); await refresh();
    if (!snapshot.reopenRequired) notice(name === 'scan' ? number(result.created) + ' deliveries queued; ' + number(result.existing) + ' already retained.' :
      name === 'drain' ? number(result.delivered) + ' delivered from ' + number(result.attempted) + ' attempts.' + (result.interrupted ? ' Sending stopped.' : '') :
      name === 'start' ? 'Automatic delivery is running.' : 'The dispatcher is stopped.');
  } catch (error) { notice(error.message, true); await refresh().catch(() => {}); }
  finally { requests.delete(name); controls(); }
}
for (const button of document.querySelectorAll('[data-command]')) button.addEventListener('click', () => command(button.dataset.command));
$('refresh').addEventListener('click', () => refresh().then(() => {
  if (!snapshot.reopenRequired) notice('Retained state refreshed.');
}).catch(error => notice(error.message, true)));
$('filter').addEventListener('input', () => { page = 0; if (snapshot) renderDeliveries(); });
$('previous').addEventListener('click', () => { page = Math.max(0, page - 1); renderDeliveries(); });
$('next').addEventListener('click', () => { page++; renderDeliveries(); });
$('close-detail').addEventListener('click', () => { selectedId = null; detailRow = null; $('detail').hidden = true; });
$('requeue-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!detailRow || requests.has('requeue')) return;
  const id = detailRow.id, expectedRevision = detailRow.revision, reason = $('reason').value.trim();
  if (!reason) { $('reason').focus(); return; }
  requests.add('requeue'); controls(); notice('Requeuing the retained delivery…');
  try {
    await api('/api/deliveries/' + id + '/requeue', { expectedRevision, reason });
    $('reason').value = ''; await refresh(); notice('The delivery is queued with its original result and a renewed attempt budget.');
  } catch (error) { notice(error.message, true); await refresh().catch(() => {}); }
  finally { requests.delete('requeue'); controls(); }
});
$('export').addEventListener('click', async () => {
  if (requests.has('export')) return;
  requests.add('export'); controls();
  try {
    const ledger = await api('/api/deliveries/export'), blob = new Blob([JSON.stringify(ledger, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = node('a'); link.href = url; link.download = 'job-result-deliveries.json';
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    notice('Delivery ledger exported.');
  } catch (error) { notice(error.message, true); }
  finally { requests.delete('export'); controls(); }
});
controls();
if (!token) notice('Open the complete private delivery address printed by jobs serve.', true);
else refresh().then(() => { if (!snapshot.reopenRequired) notice('Retained result deliveries are ready.'); }).catch(error => notice(error.message, true));
setInterval(() => {
  if (token && document.visibilityState === 'visible') refresh().catch(error => notice(error.message, true));
}, 5000);
