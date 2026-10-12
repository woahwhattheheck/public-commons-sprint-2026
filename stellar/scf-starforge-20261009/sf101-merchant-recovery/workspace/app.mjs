// MIT. Industrial operator interface; all recovery actions use the original engine.
const $ = id => document.getElementById(id);
const SESSION_KEY = 'starforge-recovery-session';
const fragment = new URLSearchParams(location.hash.slice(1));
let token = fragment.get('token') || sessionStorage.getItem(SESSION_KEY) || '';
if (/^[a-f0-9]{64}$/.test(token)) sessionStorage.setItem(SESSION_KEY, token);
if (location.hash) history.replaceState(null, '', location.pathname + location.search);
let current = null, profileId = '', review = null, local = [], reviewEpoch = 0;
let inventoryRows = [], inventoryCursor = null, journalCursor = null, requestCursor = null;
const journal = new Map(), requests = new Map();
let polling = false, lastRequests = '', requestsExpanded = false;
const actionNames = { push: 'Upload encrypted snapshot', pull: 'Download encrypted snapshot', restore: 'Cold restore' };
const bytes = value => {
  if (!Number.isFinite(value)) return '—';
  if (value < 1024) return value.toLocaleString() + ' B';
  const unit = value < 1024 ** 2 ? 'KiB' : value < 1024 ** 3 ? 'MiB' : 'GiB';
  const divisor = unit === 'KiB' ? 1024 : unit === 'MiB' ? 1024 ** 2 : 1024 ** 3;
  return (value / divisor).toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' ' + unit;
};
const date = value => value ? new Date(value).toLocaleString() : '—';
const profile = () => current?.profiles.find(item => item.id === profileId);
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}
function notice(message, error = false) {
  $('notice').textContent = message;
  $('notice').classList.toggle('error', error);
}
function errorText(error) {
  return (error.code ? error.code + ': ' : '') + error.message +
    (error.requestId ? ' · Provider request ' + error.requestId : '');
}
async function api(path, options = {}) {
  const headers = { 'X-Recovery-Token': token, ...(options.body ? { 'Content-Type': 'application/json' } : {}) };
  const response = await fetch(path, { ...options, headers, credentials: 'omit', cache: 'no-store' });
  let value;
  try { value = await response.json(); } catch { throw new Error('The workspace returned an unreadable response'); }
  if (!response.ok || value.error) {
    if (response.status === 401) { token = ''; sessionStorage.removeItem(SESSION_KEY); }
    const error = new Error(value.error?.message ?? 'Recovery workspace request failed');
    Object.assign(error, value.error ?? {}); throw error;
  }
  return value;
}
function url(path, values) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  return path + (search.size ? '?' + search : '');
}
const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });
async function task(button, action) {
  const previous = button?.disabled;
  if (button) button.disabled = true;
  try { return await action(); }
  catch (error) { notice(errorText(error), true); return null; }
  finally { if (button) button.disabled = previous; updateStart(); }
}
function button(text, action) {
  const node = element('button', text); node.type = 'button';
  node.addEventListener('click', () => task(node, action)); return node;
}
function emptyRow(tbody, message, span = 4) {
  const row = element('tr'), cell = element('td', message, 'empty');
  cell.colSpan = span; row.append(cell); tbody.replaceChildren(row);
}
function nextId() {
  return 'recovery-' + Date.now().toString(36) + '-' + crypto.randomUUID().slice(0, 8);
}
function invalidateReview() {
  reviewEpoch++;
  review = null; $('review-panel').hidden = true; updateStart();
}
function updateStart() {
  $('start-button').disabled = !review || Boolean(current?.readOnly) || Boolean(current?.active);
}
function syncFields() {
  const action = $('action').value;
  $('bundle-field').hidden = action === 'pull';
  $('snapshot-field').hidden = action === 'push';
  $('destination-field').hidden = action === 'push';
  $('snapshot').required = action !== 'push';
  $('snapshot').pattern = '[a-f0-9]{64}';
  $('bundle-help').textContent = action === 'restore' ?
    'An existing matching encrypted bundle can be used. Otherwise the original engine downloads the selected snapshot.' :
    'Select an original encrypted snapshot from the host’s backup roots.';
  $('destination-help').textContent = (action === 'restore' ? 'Plaintext destination under ' : 'Encrypted download under ') +
    (action === 'restore' ? profile()?.restoreRoot : profile()?.downloadRoot) + '.';
  const selected = $('bundle').value;
  $('bundle').replaceChildren();
  if (action === 'restore') { const option = element('option', 'Download the selected snapshot when needed'); option.value = ''; $('bundle').append(option); }
  for (const item of local) {
    const option = element('option', item.rootLabel + ' / ' + item.name + ' · ' + item.files + ' files');
    option.value = item.bundleId; $('bundle').append(option);
  }
  if (local.some(item => item.bundleId === selected)) $('bundle').value = selected;
  if (!local.length && action === 'push') {
    const option = element('option', 'No original encrypted bundles in the selected roots');
    option.value = ''; $('bundle').append(option);
  }
}
function newSelection() {
  invalidateReview(); $('operation-id').value = nextId(); $('destination').value = '';
  $('snapshot').value = ''; $('action').value = 'push'; syncFields();
}
function intent() {
  const action = $('action').value;
  const input = { profileId, action, id: $('operation-id').value.trim() };
  if (action === 'push') input.bundleId = $('bundle').value;
  else {
    input.snapshotId = $('snapshot').value.trim();
    if ($('destination').value.trim()) input.destinationName = $('destination').value.trim();
    if (action === 'restore' && $('bundle').value) input.bundleId = $('bundle').value;
  }
  return input;
}
function showReview(value) {
  review = value;
  const details = [
    ['Profile', current?.profiles.find(item => item.id === value.profileId)?.label ?? value.profileId],
    ['Action', actionNames[value.command] ?? value.command],
    ['Operation ID', value.operationId],
    ['Store', (value.store.endpoint ?? 'AWS S3') + ' · ' + value.store.region],
    ['Bucket / prefix', value.store.bucket + '/' + (value.store.prefix ?? '')],
    ['Snapshot', value.snapshotId ?? '—'],
    ['Encrypted source', value.source ?? 'Selected remote snapshot'],
    ['Destination', value.destination ?? 'Immutable remote bundle and completion descriptor'],
    ['Files / bytes', value.files === null ? 'Read and verified by the original engine' : value.files + ' files · ' + bytes(value.plainBytes)],
  ];
  $('review-details').replaceChildren();
  for (const [key, value] of details) $('review-details').append(element('dt', key), element('dd', value));
  $('review-state').textContent = value.originalStatus ?? 'REVIEWED';
  $('review-note').textContent = value.originalStatus === 'COMPLETE' ?
    'This original operation is complete. Opening it retains its completed result.' :
    value.command === 'restore' ? 'The original engine verifies the encrypted bundle and restores into this new destination. Keep the same operation ID to continue.' :
    'Starting repeats the exact selection check and uses the original transfer journal.';
  $('review-panel').hidden = false; updateStart();
  $('review-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function applyState(value, initialize = false) {
  current = value; if (!requestsExpanded) requestCursor = value.nextRequestsCursor;
  for (const row of value.requests) requests.set(row.profileId + '/' + row.operationId, row);
  if (initialize) {
    $('title').textContent = value.title; document.title = value.title + ' · Starforge';
    $('profile').replaceChildren();
    for (const item of value.profiles) { const option = element('option', item.label); option.value = item.id; $('profile').append(option); }
    profileId = value.profiles[0].id; $('profile').value = profileId; $('profile').disabled = false;
    $('workspace-reference').textContent = value.id + ' · ' + value.directory;
  }
  const selected = profile();
  $('store-summary').textContent = selected.store.bucket + '/' + selected.store.prefix + ' · ' + selected.store.region;
  $('passphrase-summary').textContent = selected.passphraseAvailable ? 'Available from host environment' :
    'Set ' + selected.passEnv + ' in the host environment, then restart';
  $('operations-path').textContent = selected.operations;
  $('active-summary').textContent = value.active ?
    value.active.operationId + (value.active.cancelRequested ? ' · Stop requested; reading the original completion state.' : ' · Original engine is running.') :
    'The original transfer journal supplies operation status.';
  $('requests-more').hidden = !requestCursor;
  renderRequests(); updateStart();
}
async function refreshState() {
  const value = await api('/api/state'); applyState(value, !current); return value;
}
async function refreshBundles() {
  const selected = profileId;
  const value = await api(url('/api/bundles', { profile: selected }));
  if (selected !== profileId) return;
  const previousBundle = $('bundle').value;
  const previousSnapshot = local.find(item => item.bundleId === previousBundle)?.snapshotId;
  local = value.bundles; $('bundle-count').textContent = local.length;
  const children = [];
  for (const item of local) {
    const row = element('article');
    row.append(element('h3', item.rootLabel + ' / ' + item.name),
      element('p', item.snapshotId, 'mono'),
      element('p', item.files + ' files · ' + bytes(item.plainBytes) + ' · ' + date(item.createdAt)),
      element('p', item.directory, 'mono'));
    children.push(row);
  }
  if (!children.length) children.push(element('p', 'No original encrypted bundle manifests were found in the selected host roots.', 'empty'));
  for (const error of value.errors) children.push(element('p', error.bundleId + ' · ' + error.code + ': ' + error.message, 'hint'));
  $('bundle-list').replaceChildren(...children); syncFields();
  if (previousBundle !== $('bundle').value || previousSnapshot !== local.find(item => item.bundleId === $('bundle').value)?.snapshotId)
    invalidateReview();
}
function useSnapshot(row, action) {
  invalidateReview(); $('action').value = action; $('snapshot').value = row.snapshotId;
  $('operation-id').value = nextId(); $('destination').value = ''; syncFields();
  if (action === 'restore') {
    const match = local.find(item => item.snapshotId === row.snapshotId);
    $('bundle').value = match?.bundleId ?? '';
  }
  $('transfer-heading').scrollIntoView({ behavior: 'smooth', block: 'start' });
  notice('Selected ' + row.snapshotId + '. Review the exact transfer and destination.');
}
function renderInventory() {
  const tbody = $('inventory-rows'); tbody.replaceChildren();
  for (const item of inventoryRows) {
    const row = element('tr'), id = element('td'), created = element('td', date(item.createdAt));
    id.append(element('code', item.snapshotId, 'snapshot-id'));
    const size = element('td', item.files + ' / ' + bytes(item.plainBytes), 'number');
    const actions = element('div', undefined, 'actions');
    actions.append(button('Download', () => useSnapshot(item, 'pull')), button('Restore', () => useSnapshot(item, 'restore')));
    const use = element('td'); use.append(actions); row.append(id, created, size, use); tbody.append(row);
  }
  if (!inventoryRows.length) emptyRow(tbody, 'No completed snapshots were returned by this remote inventory page.');
  $('inventory-more').hidden = !inventoryCursor;
  $('snapshot-options').replaceChildren();
  for (const item of inventoryRows) { const option = element('option'); option.value = item.snapshotId; option.label = date(item.createdAt) + ' · ' + item.files + ' files'; $('snapshot-options').append(option); }
}
async function refreshInventory(more = false) {
  const selected = profileId;
  const value = await api(url('/api/inventory', { profile: selected, limit: 20, cursor: more ? inventoryCursor : undefined }));
  if (selected !== profileId) return;
  const values = more ? new Map(inventoryRows.map(item => [item.snapshotId, item])) : new Map();
  for (const row of value.snapshots) values.set(row.snapshotId, row);
  inventoryRows = [...values.values()]; inventoryCursor = value.nextCursor; renderInventory();
  $('inventory-observed').textContent = 'Read from ' + value.store.bucket + ' at ' + date(value.observedAt) +
    (value.ignoredObjects ? ' · ' + value.ignoredObjects + ' non-snapshot objects skipped' : '') + '.';
  notice('Remote inventory refreshed from the selected store.');
}
async function details(id) {
  const value = await api(url('/api/operation', { profile: profileId, id }));
  $('detail-body').textContent = JSON.stringify(value, null, 2); $('detail-panel').hidden = false;
  $('detail-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
async function reviewSelection(input) {
  invalidateReview();
  const generation = reviewEpoch, selected = input.profileId;
  try {
    const value = await post('/api/review', input);
    if (generation !== reviewEpoch || selected !== profileId) return null;
    showReview(value); return value;
  } catch (error) {
    if (generation !== reviewEpoch || selected !== profileId) return null;
    throw error;
  }
}
async function adopt(id) {
  const value = await reviewSelection({ profileId, action: 'resume', id });
  if (value) notice('Reviewed the original selection for ' + id + '.');
}
function renderJournal() {
  const tbody = $('operation-rows'); tbody.replaceChildren();
  for (const item of journal.values()) {
    const row = element('tr'), id = element('td'); id.append(element('code', item.operationId));
    const controls = element('div', undefined, 'actions');
    controls.append(button('Details', () => details(item.operationId)), button('Review continuation', () => adopt(item.operationId)));
    const use = element('td'); use.append(controls);
    row.append(id, element('td', item.command), element('td', item.status), use); tbody.append(row);
  }
  if (!journal.size) emptyRow(tbody, 'No original recovery operations in this profile’s journal.');
  $('operations-more').hidden = !journalCursor;
}
async function refreshJournal(more = false) {
  const selected = profileId;
  const value = await api(url('/api/operations', { profile: selected, limit: 25, cursor: more ? journalCursor : undefined }));
  if (selected !== profileId) return;
  if (!more) journal.clear();
  for (const row of value.operations) journal.set(row.operationId, row);
  journalCursor = value.nextCursor; renderJournal();
  if (value.errors.length) notice(value.errors.map(error => error.operationId + ' · ' + error.code + ': ' + error.message).join(' | '), true);
}
function progressText(row) {
  const op = row.operation, progress = op?.progress;
  if (!op) return 'Waiting for the original operation journal.';
  const parts = [];
  if (Number.isInteger(progress?.nextObject)) parts.push(progress.nextObject + '/' + (op.files ?? '?') + ' encrypted objects');
  if (Number.isFinite(progress?.bytesWritten)) parts.push(bytes(progress.bytesWritten) + ' written');
  if (Number.isFinite(progress?.reused)) parts.push(progress.reused + ' reused');
  if (op.verified) parts.push('Original bundle verified');
  if (op.originalRestore) parts.push('Original cold restore complete');
  return parts.join(' · ') || 'Original status: ' + op.status;
}
function renderRequests() {
  const rows = [...requests.values()].filter(row => row.profileId === profileId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const signature = JSON.stringify(rows);
  if (signature === lastRequests) return;
  lastRequests = signature;
  const children = [];
  for (const row of rows) {
    const item = element('article', undefined, 'request'), heading = element('div', undefined, 'request-head');
    heading.append(element('h3', row.operationId, 'mono'), element('span', row.phase, 'badge'));
    item.append(heading, element('p', (actionNames[row.review.command] ?? row.review.command) + ' · ' + date(row.updatedAt), 'hint'),
      element('p', progressText(row), 'hint'));
    const count = row.operation?.progress?.nextObject, total = row.operation?.files;
    if (Number.isInteger(count) && total > 0) {
      const progress = document.createElement('progress'); progress.max = total; progress.value = count;
      progress.setAttribute('aria-label', 'Encrypted objects completed'); item.append(progress);
    }
    if (row.error) item.append(element('p', row.error.code + ': ' + row.error.message, 'request-error'));
    if (row.cancelRequested) item.append(element('p', 'Stop requested. The original local verification or restore may finish before the final readback.', 'hint'));
    const controls = element('div', undefined, 'actions');
    if (row.operation) controls.append(button('Details', () => details(row.operationId)));
    if (row.running) controls.append(button('Stop transfer', async () => {
      await post('/api/cancel', { profileId: row.profileId, id: row.operationId });
      notice('Stop requested for ' + row.operationId + '. Reading the original journal for its final state.');
      await refreshState();
    }));
    else if (row.phase !== 'COMPLETE') controls.append(button('Continue operation', async () => {
      await post('/api/resume', { profileId: row.profileId, id: row.operationId });
      notice('Continuing the original selection for ' + row.operationId + '.');
      await refreshState();
    }));
    controls.append(button('View selection', () => {
      $('detail-body').textContent = JSON.stringify(row, null, 2); $('detail-panel').hidden = false;
      $('detail-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }));
    item.append(controls); children.push(item);
  }
  if (!children.length) children.push(element('p', 'Reviewed transfers will remain here after the browser closes.', 'empty'));
  $('request-list').replaceChildren(...children);
}
async function loadProfile() {
  invalidateReview(); local = []; journal.clear(); inventoryRows = []; inventoryCursor = journalCursor = null;
  lastRequests = ''; renderRequests(); renderJournal();
  $('inventory-observed').textContent = 'Refresh to read the selected remote store.';
  emptyRow($('inventory-rows'), 'Remote inventory has not been read for this profile in this session.');
  $('inventory-more').hidden = true; $('snapshot-options').replaceChildren();
  applyState(current); newSelection();
  const results = await Promise.allSettled([refreshBundles(), refreshJournal()]);
  for (const result of results) if (result.status === 'rejected') notice(errorText(result.reason), true);
}
$('profile').addEventListener('change', () => task($('profile'), async () => { profileId = $('profile').value; await loadProfile(); }));
$('action').addEventListener('change', () => { invalidateReview(); syncFields(); });
for (const id of ['bundle', 'snapshot', 'operation-id', 'destination']) $(id).addEventListener('input', invalidateReview);
$('new-selection').addEventListener('click', newSelection);
$('transfer-form').addEventListener('submit', event => {
  event.preventDefault();
  task($('review-button'), async () => {
    const value = await reviewSelection(intent());
    if (value) notice('Review the exact snapshot, store and destination below.');
  });
});
$('discard-review').addEventListener('click', invalidateReview);
$('start-button').addEventListener('click', () => task($('start-button'), async () => {
  const chosen = review;
  const result = await post('/api/start', { selection: chosen.intent, expectedReviewHash: chosen.reviewHash });
  if (review?.reviewHash === chosen.reviewHash) invalidateReview();
  requests.set(result.profileId + '/' + result.operationId, result);
  notice('Original recovery operation ' + result.operationId + ' opened. Progress is retained in its original journal.');
  await refreshState(); await refreshJournal();
}));
$('refresh-bundles').addEventListener('click', () => task($('refresh-bundles'), refreshBundles));
$('refresh-inventory').addEventListener('click', () => task($('refresh-inventory'), () => refreshInventory()));
$('inventory-more').addEventListener('click', () => task($('inventory-more'), () => refreshInventory(true)));
$('refresh-progress').addEventListener('click', () => task($('refresh-progress'), async () => {
  await refreshState(); notice('Original operation progress refreshed.');
}));
$('refresh-operations').addEventListener('click', () => task($('refresh-operations'), () => refreshJournal()));
$('operations-more').addEventListener('click', () => task($('operations-more'), () => refreshJournal(true)));
$('requests-more').addEventListener('click', () => task($('requests-more'), async () => {
  const value = await api(url('/api/requests', { cursor: requestCursor, limit: 50 }));
  requestsExpanded = true;
  for (const row of value.requests) requests.set(row.profileId + '/' + row.operationId, row);
  requestCursor = value.nextCursor; $('requests-more').hidden = !requestCursor; renderRequests();
}));
$('close-details').addEventListener('click', () => { $('detail-panel').hidden = true; });
async function poll() {
  if (polling || !token) return;
  polling = true;
  try { if (!document.hidden) await refreshState(); }
  catch (error) { notice(errorText(error), true); }
  finally {
    polling = false;
    if (token) setTimeout(poll, current?.active ? 2500 : 15000);
  }
}
async function boot() {
  if (!/^[a-f0-9]{64}$/.test(token)) {
    notice('Open the current browser URL printed by workspace serve to access this recovery workspace.', true); return;
  }
  try {
    await refreshState(); await loadProfile();
    notice('Recovery workspace ready. Select an original encrypted bundle or refresh the remote inventory.');
    setTimeout(poll, 5000);
  } catch (error) { notice(errorText(error), true); }
}
boot();
