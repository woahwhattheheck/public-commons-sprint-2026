// MIT. Merchant input receiving through the original private host and verified stream.
const $ = id => document.getElementById(id);
const sessionKey = 'starforge-paid-jobs:' + location.origin;
const selectedKey = 'starforge-job-input-selected:' + location.origin;
const referenceKey = 'starforge-job-input-reference:' + location.origin;
let token = sessionStorage.getItem(sessionKey) || '';
const fragment = location.hash.slice(1);
if (/^[a-f0-9]{64}$/.test(fragment)) {
  token = fragment; sessionStorage.setItem(sessionKey, token);
  history.replaceState(null, '', location.pathname);
}
$('jobs-link').href = '/#' + token;
const state = { page: 0, pageSize: 40, selected: sessionStorage.getItem(selectedKey) || null,
  reference: sessionStorage.getItem(referenceKey) || '', query: null, detail: null,
  loading: false, operation: null, mutating: false, filterVersion: 0 };
sessionStorage.removeItem(referenceKey);
const json = value => JSON.stringify(value, null, 2);
const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
const time = value => value ? new Date(value).toLocaleString() : '—';
const bytes = value => {
  if (value === null || value === undefined) return '—';
  if (value < 1024) return value + ' B';
  for (const [unit, scale] of [['GiB', 1073741824], ['MiB', 1048576], ['KiB', 1024]])
    if (value >= scale) return (value / scale).toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' ' + unit;
};
const friendly = {
  JOB_INPUT_REVISION_CHANGED: 'This upload changed. Its current progress is shown below; review it before releasing.',
  JOB_INPUT_FILE_IN_USE: 'The original job or its preparation now retains this file. Refresh to inspect the job.',
  JOB_INPUT_FILE_PINNED: 'This upload is pinned. Review its original job and the orphan release option.',
  JOB_INPUT_FILE_NOT_SEALED: 'The file is still arriving. Preview and download are available after sealing.',
  DOWNLOAD_CAPACITY_REACHED: 'Current downloads are using the available slots. Finish one, then request another.',
  JOB_INPUT_READ_CAPACITY_REACHED: 'Current reads are using the available slots. Finish one, then retry.',
  WORKSPACE_AUTH_REQUIRED: 'Open the complete private merchant launch address from the terminal.',
  JOB_INPUT_DESK_CLOSED: 'The merchant workspace has closed. Reopen its launch address.',
};
function notice(text, error = false) { $('notice').textContent = text; $('notice').hidden = !text; $('notice').classList.toggle('error', error); }
async function request(path, { method = 'GET', input, signal } = {}) {
  const response = await fetch(path, { method, signal, cache: 'no-store', credentials: 'omit',
    headers: { authorization: 'Bearer ' + token, ...(input !== undefined ? { 'content-type': 'application/json' } : {}) },
    ...(input !== undefined ? { body: JSON.stringify(input) } : {}) });
  const value = await response.json();
  if (!response.ok) {
    const code = value.code || value.error || 'INPUT_OPERATION_FAILED';
    throw Object.assign(new Error(friendly[code] || value.message || code), { code, status: response.status });
  }
  return value;
}
const post = (path, input = {}, signal) => request(path, { method: 'POST', input, signal });
function field(target, label, value, wide = false, mono = false) {
  const group = el('div', undefined, wide ? 'wide' : undefined);
  group.append(el('dt', label), el('dd', value ?? '—', mono ? 'mono' : undefined)); target.append(group);
}
function updateControls() {
  const busy = !!state.operation || state.mutating, detail = state.detail;
  $('preview').disabled = !detail || detail.upload.state !== 'SEALED' || busy;
  $('download').disabled = $('preview').disabled;
  $('release').disabled = !detail?.release.allowed || busy ||
    detail.release.orphanPin && !$('orphan').checked;
  $('reason').disabled = !detail?.release.allowed || state.mutating;
  $('orphan').disabled = state.mutating;
  $('cancel-read').hidden = !state.operation;
  $('refresh').disabled = state.loading;
  $('previous').disabled = state.page === 0 || state.loading;
  $('next').disabled = !state.query || (state.page + 1) * state.pageSize >= state.query.total || state.loading;
}
function renderPolicies(functions) {
  $('policies').replaceChildren();
  for (const fn of functions) {
    const panel = el('article', undefined, 'policy');
    panel.append(el('h3', fn.id), el('p', fn.description));
    const limits = el('dl'); field(limits, 'Total input limit', bytes(fn.inputFiles.maxTotalBytes));
    panel.append(limits);
    for (const [slot, policy] of Object.entries(fn.inputFiles.slots)) {
      const row = el('div', undefined, 'slot');
      row.append(el('strong', slot + (policy.required ? ' · Required' : ' · Optional')), el('p', policy.description));
      const facts = el('dl'); field(facts, 'File limit', bytes(policy.maxBytes)); field(facts, 'Media types', policy.mediaTypes.join(', '));
      row.append(facts); panel.append(row);
    }
    $('policies').append(panel);
  }
  if (!functions.length) $('policies').append(el('p', 'This merchant has no configured file input slots.'));
}
function renderQuery(value) {
  state.query = value;
  $('merchant').textContent = [value.serviceName, value.publicOrigin].filter(Boolean).join(' · ');
  $('uploading').textContent = value.totals.uploading.toLocaleString();
  $('sealed').textContent = value.totals.sealed.toLocaleString();
  $('unassigned').textContent = (value.totals.unassigned + value.totals.orphanPins).toLocaleString();
  $('retained').textContent = value.totals.retainedJobs.toLocaleString();
  $('reserved').textContent = bytes(value.capacity?.reservedBytes);
  $('capacity').textContent = value.capacity ? 'of ' + bytes(value.capacity.maxBytes) + ' · ' +
    value.capacity.uploads + ' / ' + value.capacity.maxUploads + ' files' : 'File inputs not configured';
  $('unconfigured').hidden = value.configured;
  const currentFunction = $('function').value;
  if (json([...$('function').options].slice(1).map(item => item.value)) !== json(value.functions.map(fn => fn.id))) {
    const all = el('option', 'All functions'); all.value = '';
    $('function').replaceChildren(all, ...value.functions.map(fn => { const option = el('option', fn.id); option.value = fn.id; return option; }));
    $('function').value = currentFunction;
  }
  $('rows').replaceChildren();
  for (const upload of value.items) {
    const row = el('tr'); row.classList.toggle('selected', upload.id === state.selected);
    const file = el('td'), button = el('button', upload.file.filename, 'row-button');
    button.type = 'button'; button.addEventListener('click', () => select(upload.id, true));
    file.append(button, el('span', bytes(upload.file.bytes) + ' · ' + upload.file.contentType, 'sub'));
    const original = el('td'); original.append(el('span', upload.reference, 'mono'), el('span', upload.functionId + ' / ' + upload.slot, 'sub'));
    const progress = el('td'); progress.append(el('span', upload.state === 'SEALED' ? 'Sealed' : 'Arriving',
      'badge' + (upload.state === 'SEALED' ? ' sealed' : '')), el('span', upload.receivedChunks + ' / ' + upload.totalChunks +
      ' chunks · ' + bytes(upload.receivedBytes), 'sub'));
    const job = el('td'); job.append(el('span', upload.job ? upload.job.state.replaceAll('_', ' ') :
      upload.pinned ? 'Pinned before commit' : 'Awaiting a job'), el('span', upload.job?.label || '', 'sub'));
    row.append(file, original, progress, job, el('td', time(upload.updatedAt))); $('rows').append(row);
  }
  $('count').textContent = value.total.toLocaleString() + ' matching files' +
    (state.reference ? ' · request ' + state.reference : '');
  $('empty').hidden = value.items.length > 0;
  $('page').textContent = value.total ? (value.offset + 1) + '–' + Math.min(value.offset + value.limit, value.total) + ' of ' + value.total : '0 files';
  $('catalog').textContent = value.publicOrigin;
  renderPolicies(value.functions); $('updated').textContent = 'Updated ' + time(value.capturedAt);
  $('connection').textContent = 'Connected'; updateControls();
}
function renderDetail(value) {
  const previous = state.detail;
  state.detail = value; const { upload, original, job } = value;
  $('detail').hidden = false; $('detail-title').textContent = upload.file.filename;
  $('detail-reference').textContent = original.reference + ' · ' + original.functionId + ' / ' + original.slot;
  $('detail-state').textContent = upload.state === 'SEALED' ? 'Sealed' : 'Arriving';
  $('detail-state').className = 'badge' + (upload.state === 'SEALED' ? ' sealed' : '');
  $('facts').replaceChildren();
  for (const [label, text] of [['Size', bytes(upload.file.bytes)], ['Media type', upload.file.contentType],
    ['Revision', upload.revision], ['Created', time(upload.createdAt)], ['Sealed', time(upload.sealedAt)],
    ['Transfer progress', upload.receivedChunks + ' / ' + upload.totalChunks + ' chunks']]) field($('facts'), label, text);
  field($('facts'), 'File SHA-256', upload.file.sha256, true, true);
  field($('facts'), 'Upload identity', upload.id, true, true);
  $('job-relation').textContent = job ? (value.usesFile ?
    'Retained by job ' + job.id + ' (' + job.state.replaceAll('_', ' ') + '). Its saved input uses this original file.' :
    'Job ' + job.id + ' exists for this reference. Its original input does not match this slot; inspect that job before changing its source files.') :
    upload.pinned ? 'This file was pinned before an original job commit. The merchant will check for active preparation again before releasing it.' :
    'This upload is awaiting a job. The customer can resume the same original request and remaining chunks.';
  $('open-job').hidden = !job;
  $('policy-change').hidden = value.policy.current;
  $('policy-change').textContent = 'This upload retains an earlier slot policy. Its original manifest remains available. New requests must use the current function catalog.';
  $('progress-bar').max = Math.max(1, upload.file.bytes); $('progress-bar').value = upload.receivedBytes;
  const missing = upload.missing.slice(0, 24);
  $('progress-text').textContent = bytes(upload.receivedBytes) + ' of ' + bytes(upload.file.bytes) + ' received' +
    (missing.length ? ' · Missing chunk indexes: ' + missing.join(', ') + (upload.missing.length > missing.length ? ' …' : '') : ' · All chunks received') +
    (upload.state === 'SEALED' ? ' · Whole file verified and sealed' : '');
  $('manifest').textContent = json(original); $('slot-policy').textContent = json(value.policy);
  $('orphan-field').hidden = !value.release.orphanPin;
  if (!previous || previous.upload.id !== upload.id || previous.upload.revision !== upload.revision) $('orphan').checked = false;
  $('release-explanation').textContent = job ?
    'The original job retains this file through execution, retries and recovery.' :
    upload.pinned ? 'Release the orphan pin only when this request is no longer needed. The merchant checks the original preparation and job state again.' :
    'Release storage when this original upload is no longer needed. A customer who continues the request will need to transfer its original bytes again.';
  updateControls();
}
async function select(id, scroll = false) {
  state.operation?.abort(); state.selected = id; state.detail = null; $('detail').hidden = true;
  sessionStorage.setItem(selectedKey, id); updateControls();
  $('preview-content').hidden = true; $('reason').value = ''; $('orphan').checked = false;
  try {
    const value = await request('/api/inputs/' + id);
    if (state.selected !== id) return;
    renderDetail(value);
    if (state.query) renderQuery(state.query);
    if (scroll) $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) { notice(error.message, true); }
}
async function refresh() {
  if (state.loading) return;
  state.loading = true; updateControls();
  const version = state.filterVersion;
  try {
    const value = await post('/api/inputs/query', { q: $('search').value, functionId: $('function').value,
      state: $('state').value, ownership: $('ownership').value, reference: state.reference,
      offset: state.page * state.pageSize, limit: state.pageSize });
    if (version !== state.filterVersion) return;
    if (!value.items.length && value.total && state.page > 0) { state.page = Math.floor((value.total - 1) / state.pageSize); state.filterVersion++; return; }
    renderQuery(value);
    if (state.selected) {
      const selected = state.selected;
      try { const detail = await request('/api/inputs/' + selected); if (state.selected === selected) renderDetail(detail); }
      catch (error) {
        if (error.status === 404 && state.selected === selected) {
          state.selected = null; state.detail = null; sessionStorage.removeItem(selectedKey); $('detail').hidden = true;
        } else throw error;
      }
    }
  } catch (error) { $('connection').textContent = 'Unavailable'; notice(error.message, true); }
  finally { state.loading = false; updateControls(); if (version !== state.filterVersion) void refresh(); }
}
async function readOriginal(action) {
  if (state.operation || state.mutating || !state.detail) return;
  const controller = new AbortController(), id = state.selected;
  state.operation = controller; updateControls();
  notice('Reading and verifying the original file…');
  try {
    const value = await post('/api/inputs/' + id + '/' + action, {}, controller.signal);
    if (controller.signal.aborted || id !== state.selected) return;
    if (action === 'preview') {
      $('preview-content').textContent = value.text === null ? 'Binary file. First bytes in hexadecimal:\n' + value.hex :
        value.text + (value.truncated ? '\n\n[Preview shows the first 256 KiB. Download contains the complete file.]' : '');
      $('preview-content').hidden = false;
      notice('Original file verified · ' + bytes(value.bytes) + ' · ' + value.sha256);
    } else {
      const target = new URL(value.url, location.origin);
      if (target.origin !== location.origin || !/^\/input-transfer\/[a-f0-9]{48}$/.test(target.pathname) ||
        target.search || target.hash || value.bytes !== state.detail.upload.file.bytes || value.sha256 !== state.detail.upload.file.sha256)
        throw new Error('The download ticket does not match this original file.');
      const link = el('a'); link.href = target.href; link.download = state.detail.upload.file.filename;
      document.body.append(link); link.click(); link.remove();
      notice('Download opened in the browser · ' + bytes(value.bytes) + ' · ' + value.sha256);
    }
  } catch (error) {
    if (controller.signal.aborted) notice('File reading stopped. The original upload remains available.');
    else notice(error.message, true);
  } finally { if (state.operation === controller) state.operation = null; updateControls(); }
}
$('filters').addEventListener('submit', event => { event.preventDefault(); state.page = 0; state.filterVersion++; void refresh(); });
$('clear').addEventListener('click', () => { $('filters').reset(); state.reference = ''; state.page = 0; state.filterVersion++; void refresh(); });
$('previous').addEventListener('click', () => { state.page--; state.filterVersion++; void refresh(); });
$('next').addEventListener('click', () => { state.page++; state.filterVersion++; void refresh(); });
$('refresh').addEventListener('click', refresh);
$('preview').addEventListener('click', () => readOriginal('preview'));
$('download').addEventListener('click', () => readOriginal('download'));
$('cancel-read').addEventListener('click', () => state.operation?.abort());
$('orphan').addEventListener('change', updateControls);
$('open-job').addEventListener('click', () => {
  if (!state.detail?.job) return;
  sessionStorage.setItem('starforge-paid-jobs-selection:' + location.origin, state.detail.job.id);
  location.assign('/#' + token);
});
$('copy-catalog').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('catalog').textContent); notice('Merchant address copied. Paste it into Request’s merchant field.'); }
  catch { notice('Copy the merchant address displayed above into Request.', true); }
});
$('release-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (state.mutating || state.operation || !state.detail?.release.allowed || !$('release-form').reportValidity()) return;
  const { id, revision } = state.detail.upload;
  const input = { expectedRevision: revision, reason: $('reason').value.trim(), releaseOrphan: $('orphan').checked };
  if (!input.reason) return;
  state.mutating = true; updateControls();
  try {
    const result = await post('/api/inputs/' + id + '/discard', input);
    notice('Upload released · ' + bytes(result.bytes) + ' of reserved storage.');
    if (state.selected === id) { state.selected = null; state.detail = null; sessionStorage.removeItem(selectedKey); $('detail').hidden = true; }
  } catch (error) { notice(error.message, true); }
  finally { state.mutating = false; await refresh(); updateControls(); }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
addEventListener('pagehide', () => state.operation?.abort());
await refresh();
setInterval(() => { if (!document.hidden && !state.mutating) void refresh(); }, 5000);
