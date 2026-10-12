// MIT. Private customer desk. Every result preview is rendered as plain text.
const $ = id => document.getElementById(id);
const KEY = 'starforge.result-receiver.access';
const state = { token: '', epoch: 0, requests: new Set(), rows: [], after: '', history: [],
  next: null, selected: null, selection: 0, refresh: 0 };
const bytes = value => value < 1024 ? value + ' B' : value < 1048576
  ? (value / 1024).toFixed(1) + ' KiB' : (value / 1048576).toFixed(1) + ' MiB';
const date = value => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : value;
const aborted = () => new DOMException('Request superseded', 'AbortError');
const MESSAGES = {
  JRR_OPERATOR_AUTH_REQUIRED: 'Access was not accepted. Open the current operator link or enter its token.',
  JRR_STORED_RESULT_CHANGED: 'The stored bytes no longer match this result. Inspect the receiver storage before using this file.',
  JRR_STORED_FILE_INVALID: 'This result file could not be opened with the required storage permissions.',
  JRR_NOT_FOUND: 'This result is no longer available in the receiver directory.',
  JRR_DRAINING: 'The receiver is stopping. Open the operator desk again after it restarts.',
};
function notice(message = '') { $('notice').textContent = message; $('notice').hidden = !message; }
function failure(error) {
  if (error.name !== 'AbortError') notice(MESSAGES[error.message] ??
    (error.message.startsWith('JRR_') ? 'Receiver response: ' + error.message : 'The receiver could not be reached. Check that it is running and refresh.'));
}
function setToken(token) {
  state.token = token;
  try { token ? sessionStorage.setItem(KEY, token) : sessionStorage.removeItem(KEY); } catch {}
}
function clearSelection() {
  state.selected = null; state.selection++;
  $('detail').hidden = true; $('select-prompt').hidden = false;
  $('filename').textContent = ''; $('fields').replaceChildren();
  $('manifest').textContent = ''; $('preview').textContent = ''; $('preview').hidden = true;
  $('verification').hidden = true;
}
function lock(message = '') {
  state.epoch++; state.refresh++;
  for (const request of state.requests) request.abort();
  state.requests.clear(); setToken('');
  state.rows = []; state.after = ''; state.history = []; state.next = null;
  clearSelection(); $('rows').replaceChildren(); $('merchants').replaceChildren();
  $('workspace').hidden = true; $('access-panel').hidden = false; $('lock').hidden = true;
  $('access-token').value = ''; notice(message);
}
async function request(path, { binary = false } = {}) {
  const epoch = state.epoch;
  const controller = new AbortController(); state.requests.add(controller);
  try {
    const response = await fetch(path, { method: 'GET', headers: { authorization: 'Bearer ' + state.token },
      cache: 'no-store', credentials: 'omit', signal: controller.signal });
    if (epoch !== state.epoch) throw aborted();
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      const code = result.error ?? 'JRR_REQUEST_FAILED';
      if (response.status === 401) lock(MESSAGES.JRR_OPERATOR_AUTH_REQUIRED);
      throw new Error(code);
    }
    const result = binary ? await response.blob() : await response.json();
    if (epoch !== state.epoch) throw aborted();
    return result;
  } finally { state.requests.delete(controller); }
}
function add(parent, tag, content, className) {
  const node = document.createElement(tag);
  if (content != null) node.textContent = String(content);
  if (className) node.className = className;
  parent.append(node); return node;
}
function drawStatus(status) {
  $('destination-id').textContent = status.destination.id;
  $('destination-url').textContent = status.destination.url;
  $('total-results').textContent = status.total;
  $('receiving-count').textContent = status.receiving;
  $('max-bytes').textContent = bytes(status.maxResultBytes);
  const parts = [];
  if (status.recoveredOnOpen) parts.push(status.recoveredOnOpen + ' completed incoming result(s) recovered when this service opened.');
  if (status.retainedIncoming.length) parts.push(status.retainedIncoming.length +
    ' incoming entry/entries require operator inspection. Stop the receiver and run recover-incoming to list the retained paths and reasons.');
  $('recovery').textContent = parts.join(' '); $('recovery').hidden = !parts.length;
  $('merchants').replaceChildren();
  for (const merchant of status.merchants) {
    const row = add($('merchants'), 'li');
    add(row, 'strong', merchant.publicOrigin);
    if (merchant.configSha256) add(row, 'p', 'Merchant config: ' + merchant.configSha256, 'mono');
    if (merchant.applicationSha256) add(row, 'p', 'Application: ' + merchant.applicationSha256, 'mono');
  }
}
function drawRows() {
  $('rows').replaceChildren();
  const query = $('filter').value.trim().toLowerCase();
  const rows = state.rows.filter(row => [row.deliveryId, row.manifest?.job.id,
    row.manifest?.job.functionId, row.manifest?.result.filename].filter(Boolean).join(' ').toLowerCase().includes(query));
  for (const row of rows) {
    const tr = add($('rows'), 'tr');
    if (row.deliveryId === state.selected) tr.classList.add('selected');
    const job = add(tr, 'td');
    const select = add(job, 'button', row.manifest?.job.id ?? row.deliveryId.slice(0, 16));
    select.type = 'button'; select.dataset.deliveryId = row.deliveryId;
    select.setAttribute('aria-label', 'Inspect result for job ' + (row.manifest?.job.id ?? row.deliveryId));
    if (row.manifest) {
      add(job, 'span', row.manifest.job.functionId, 'subline');
      const result = add(tr, 'td', row.manifest.result.filename);
      add(result, 'span', bytes(row.manifest.result.bytes), 'subline');
      add(tr, 'td', date(row.receipt.receivedAt));
    } else {
      add(tr, 'td', 'Storage requires inspection');
      add(tr, 'td', row.error ?? row.state);
    }
  }
  $('empty').hidden = rows.length > 0;
  $('empty').textContent = query ? 'No results on this page match the filter.' :
    state.history.length || state.after ? 'No results on this page.' : 'No results have arrived yet.';
  $('page-label').textContent = 'Page ' + (state.history.length + 1) + ' · ' + state.rows.length + ' results';
  $('previous').disabled = state.history.length === 0;
  $('next').disabled = !state.next;
}
function field(name, value, hash = false) {
  add($('fields'), 'dt', name); add($('fields'), 'dd', value, hash ? 'hash' : '');
}
async function selectResult(id) {
  clearSelection(); state.selected = id;
  const selection = state.selection;
  const current = () => state.selected === id && state.selection === selection;
  drawRows(); $('select-prompt').textContent = 'Opening result…';
  try {
    const value = await request('/api/results/' + id);
    if (!current()) return;
    const m = value.manifest;
    $('filename').textContent = m.result.filename;
    field('Job', m.job.id); field('Function', m.job.functionId);
    field('Merchant', m.merchant.publicOrigin);
    field('Content type', m.result.contentType); field('Size', bytes(m.result.bytes) + ' (' + m.result.bytes + ' bytes)');
    field('Completed', date(m.job.completedAt)); field('Received', date(value.receipt.receivedAt));
    field('Result SHA-256', m.result.sha256, true); field('Delivery ID', id, true);
    $('manifest').textContent = JSON.stringify(m, null, 2);
    $('select-prompt').hidden = true; $('detail').hidden = false;
    $('preview-caption').textContent = 'Verifying the original bytes and loading the preview…';
    try {
      const preview = await request('/api/results/' + id + '/preview');
      if (!current()) return;
      $('preview').hidden = preview.text === null;
      $('preview').textContent = preview.text ?? '';
      $('preview-caption').textContent = preview.text === null
        ? 'A text preview is unavailable for this content type. Download the original file to open it.'
        : preview.truncated ? 'Showing the first 32 KiB as plain text. Download the file for the complete output.'
          : 'Complete output shown as plain text.';
    } catch (error) {
      if (!current()) return;
      $('preview-caption').textContent = 'Preview could not be loaded.';
      failure(error);
    }
  } catch (error) {
    if (!current()) return;
    $('select-prompt').textContent = 'This result could not be opened.';
    failure(error);
  }
}
async function refresh({ reset = false } = {}) {
  const operation = ++state.refresh;
  if (reset) { state.after = ''; state.history = []; clearSelection(); }
  const after = state.after;
  $('refresh').disabled = true; $('previous').disabled = true; $('next').disabled = true;
  try {
    const [status, page] = await Promise.all([
      request('/api/status'), request('/api/results?limit=50' + (after ? '&after=' + encodeURIComponent(after) : '')),
    ]);
    if (operation !== state.refresh) return;
    state.rows = page.rows; state.next = page.next;
    drawStatus(status); drawRows();
    $('workspace').hidden = false; $('access-panel').hidden = true; $('lock').hidden = false;
    notice();
  } catch (error) { if (operation === state.refresh) failure(error); }
  finally {
    if (operation === state.refresh) {
      $('refresh').disabled = false; $('previous').disabled = !state.history.length; $('next').disabled = !state.next;
    }
  }
}
async function download(kind, button) {
  const id = state.selected; const selection = state.selection;
  if (!id) return;
  button.disabled = true;
  try {
    const blob = await request('/api/results/' + id + '/' + kind, { binary: true });
    if (state.selected !== id || state.selection !== selection) return;
    const filename = kind === 'body' ? $('filename').textContent : kind + '-' + id.slice(0, 12) + '.json';
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = filename;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (error) { if (state.selected === id && state.selection === selection) failure(error); }
  finally { button.disabled = false; }
}
$('access-form').addEventListener('submit', event => {
  event.preventDefault();
  const token = $('access-token').value.trim();
  if (token.length < 32) return;
  state.epoch++; setToken(token); $('access-token').value = '';
  refresh({ reset: true });
});
$('lock').addEventListener('click', () => lock());
$('refresh').addEventListener('click', () => refresh());
$('filter').addEventListener('input', drawRows);
$('rows').addEventListener('click', event => {
  const button = event.target.closest('button[data-delivery-id]');
  if (button) selectResult(button.dataset.deliveryId);
});
$('previous').addEventListener('click', () => {
  if (!state.history.length) return;
  state.after = state.history.pop(); clearSelection(); refresh();
});
$('next').addEventListener('click', () => {
  if (!state.next) return;
  state.history.push(state.after); state.after = state.next; clearSelection(); refresh();
});
$('verify').addEventListener('click', async () => {
  const id = state.selected; const selection = state.selection;
  if (!id) return;
  $('verify').disabled = true; $('verification').hidden = true;
  try {
    const verified = await request('/api/results/' + id + '/verify');
    if (state.selected !== id || state.selection !== selection) return;
    $('verification').textContent = bytes(verified.bytes) + ' matched the manifest SHA-256 at ' + date(verified.verifiedAt) + '.';
    $('verification').hidden = false;
  } catch (error) { if (state.selected === id && state.selection === selection) failure(error); }
  finally { $('verify').disabled = false; }
});
for (const [id, kind] of [['download', 'body'], ['download-manifest', 'manifest'], ['download-receipt', 'receipt']]) {
  $(id).addEventListener('click', () => download(kind, $(id)));
}
const fragment = new URLSearchParams(location.hash.slice(1));
let token = fragment.get('access');
if (location.hash) history.replaceState(null, '', location.pathname);
if (!token) { try { token = sessionStorage.getItem(KEY); } catch {} }
if (token) { setToken(token); refresh({ reset: true }); }
