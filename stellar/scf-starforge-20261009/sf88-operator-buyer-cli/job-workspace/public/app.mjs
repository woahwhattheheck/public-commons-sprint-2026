// MIT. Customer browser; all status, result and library operations use original server APIs.
const byId = id => document.getElementById(id);
const SESSION = 'sf88-paid-job-customer-session';
let token = location.hash.slice(1);
if (token) { sessionStorage.setItem(SESSION, token); history.replaceState(null, '', location.pathname + location.search); }
else token = sessionStorage.getItem(SESSION) ?? '';
const prefix = '/api/job-workspace';
const initialEntry = new URL(location.href).searchParams.get('entry');
let requestedEntry = /^[a-f0-9]{64}$/.test(initialEntry ?? '') ? initialEntry : null;
let selected = null, selectionEpoch = 0, offset = 0, total = 0, pageItems = [], refreshing = false, timer;
let labelDirty = false, labelRevision = 0, noteDirty = false, annotationRevision = 0, noteRequest = null, collectionRequest = null;
let previewKey = null;
const endpoint = (id, action = '') => prefix + '/jobs/' + id + (action ? '/' + action : '');
function message(text, error = false) {
  byId('message').textContent = text;
  byId('message').dataset.error = String(error);
}
function problem(error) {
  message(error?.code ? error.code.replace(/^JOB_/, '').replaceAll('_', ' ').toLowerCase() : 'The operation could not complete. Reopen the workspace or try again.', true);
}
async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(path, { method, credentials: 'omit',
    headers: { authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(120000) });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error ?? 'REQUEST_FAILED'), { code: result.error ?? 'REQUEST_FAILED', status: response.status });
  return result;
}
function state(entry) { return entry.receipt.latestStatus?.state ?? 'AWAITING_SETTLEMENT'; }
function date(value) {
  if (!value) return '—';
  const parsed = new Date(value); return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : '—';
}
function size(value) {
  if (!Number.isSafeInteger(value)) return '—';
  if (value < 1024) return value + ' B';
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KiB';
  return (value / (1024 * 1024)).toFixed(1) + ' MiB';
}
function node(tag, text, className) {
  const value = document.createElement(tag);
  if (text !== undefined) value.textContent = text;
  if (className) value.className = className;
  return value;
}
function links() {
  for (const [id, path] of [['checkoutLink','/jobs/checkout/'],['jobsLink','/jobs/'],['libraryLink','/'],['collectionsLink','/collections'],['resultLibraryLink','/']])
    byId(id).href = path + '#' + token;
}
function renderList() {
  const body = byId('jobs'); body.replaceChildren();
  for (const entry of pageItems) {
    const tr = node('tr'); if (entry.id === selected?.id) tr.className = 'selected';
    const identity = node('td'), open = node('button', entry.label || entry.receipt.jobId);
    open.type = 'button'; open.addEventListener('click', () => select(entry.id).catch(problem));
    identity.append(open, node('span', entry.receipt.jobId, 'small mono'),
      node('span', entry.receipt.acceptance.functionId, 'small'));
    const status = node('td'); status.append(node('span', state(entry).replaceAll('_', ' '), 'state'));
    if (entry.task?.state === 'RUNNING' || entry.task?.state === 'CANCELLING')
      status.append(node('span', entry.task.kind + ' · ' + entry.task.state.toLowerCase(), 'small'));
    const result = node('td', entry.resource?.status === 'VERIFIED' ? 'In library' :
      entry.receipt.delivery ? 'Delivered' : state(entry) === 'COMPLETED' ? 'Ready' : '—');
    if (entry.receipt.latestStatus?.result) result.append(node('span', size(entry.receipt.latestStatus.result.bytes), 'small'));
    tr.append(identity, status, result); body.append(tr);
  }
  byId('empty').hidden = pageItems.length > 0;
  byId('empty').textContent = total ? 'No jobs on this page.' :
    byId('query').value || byId('stateFilter').value ? 'No jobs match these filters.' : 'Add an accepted job to begin.';
  byId('jobCount').textContent = total + (total === 1 ? ' job' : ' jobs');
  byId('page').textContent = total ? (offset + 1) + '–' + Math.min(offset + 50, total) + ' of ' + total : '0 jobs';
  byId('previous').disabled = offset === 0; byId('next').disabled = offset + 50 >= total;
}
function renderDetail() {
  byId('unselected').hidden = Boolean(selected); byId('detail').hidden = !selected;
  if (!selected) return;
  const receipt = selected.receipt, status = receipt.latestStatus, saved = receipt.delivery, resource = selected.resource;
  const busy = ['RUNNING','CANCELLING'].includes(selected.task?.state);
  byId('detailHeading').textContent = selected.label || receipt.jobId;
  byId('jobIdentity').textContent = receipt.jobId;
  byId('jobState').textContent = state(selected).replaceAll('_', ' ');
  byId('merchant').textContent = new URL(receipt.acceptance.statusUrl).host;
  byId('function').textContent = receipt.acceptance.functionId;
  byId('updated').textContent = date(status?.updatedAt ?? receipt.retainedAt);
  byId('purchaseKind').textContent = receipt.purchase.kind === 'SF88_NATIVE_RESULT' ? 'Original buyer result' : 'Saved accepted response';
  const task = selected.task;
  byId('jobActivity').textContent = selected.lastError ? selected.lastError.replaceAll('_', ' ') :
    busy ? (task.kind === 'fetch' ? 'Retrieving this job’s result.' : task.kind === 'watch' ? 'Monitoring the job for completion.' : 'Refreshing the customer status.') :
      task ? task.kind + ' · ' + task.state.toLowerCase() + (task.completedAt ? ' · ' + date(task.completedAt) : '') :
      'Reopen the receipt to read saved state, or refresh for the merchant’s current status.';
  byId('refreshButton').disabled = busy;
  byId('watchButton').disabled = busy || state(selected) === 'COMPLETED';
  byId('fetchButton').disabled = busy;
  byId('stopButton').hidden = !busy;
  byId('stopButton').disabled = task?.state === 'CANCELLING';
  byId('provenance').textContent = JSON.stringify({
    jobId: receipt.jobId, inputSha256: receipt.acceptance.inputSha256,
    acceptanceSha256: receipt.acceptanceSha256, nativeSettlement: status?.nativeSettlement ?? null,
    retainedAt: receipt.retainedAt, buyerDirectory: selected.directory,
  }, null, 2);
  if (!labelDirty) { byId('jobLabel').value = selected.label; byId('archived').checked = selected.archived; labelRevision = selected.revision; }
  byId('resultState').textContent = resource?.status ?? (saved ? 'Ready for library scan' : status?.result ? 'Ready to retrieve' : 'Waiting');
  const result = saved ?? status?.result;
  byId('resultMeta').textContent = result ? result.filename + ' · ' + size(result.bytes) + ' · ' + result.contentType + '\nSHA-256 ' + result.sha256 :
    'A completed application publishes its result here.';
  const available = resource?.status === 'VERIFIED';
  for (const id of ['previewButton','downloadButton','saveNote','saveCollection']) byId(id).disabled = !available;
  byId('resultLibraryLink').hidden = !resource;
  for (const id of ['note','tags','starred']) byId(id).disabled = !resource;
  if (!noteDirty) {
    const annotation = resource?.annotation;
    byId('note').value = annotation?.note ?? ''; byId('tags').value = annotation?.tags.join(', ') ?? '';
    byId('starred').checked = annotation?.starred ?? false; annotationRevision = annotation?.revision ?? 0;
  }
  byId('noteRevision').textContent = resource ? 'Revision ' + annotationRevision : 'Retrieve and index a result to add notes.';
  const key = selected.id + ':' + (resource?.sha256 ?? '');
  if (previewKey !== key) { byId('preview').textContent = available ? 'Select Preview to inspect the verified file.' : 'The verified result will appear here.'; previewKey = key; }
}
async function select(id) {
  const epoch = ++selectionEpoch, next = await api(endpoint(id));
  if (epoch !== selectionEpoch) return;
  if (selected?.id !== next.id) {
    labelDirty = false; noteDirty = false; noteRequest = null; collectionRequest = null; previewKey = null;
  }
  selected = next; renderList(); renderDetail(); await loadCollections();
}
async function loadCollections() {
  const previous = byId('collection').value, page = await api('/api/collections?limit=100');
  byId('collection').replaceChildren(new Option('Create a collection', ''));
  for (const collection of page.items) byId('collection').append(new Option(collection.name + ' · ' + collection.memberCount + ' results', collection.id));
  byId('collection').value = previous; byId('collectionNameLabel').hidden = Boolean(byId('collection').value);
}
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const params = new URLSearchParams({ q: byId('query').value, state: byId('stateFilter').value,
      view: byId('viewFilter').value, offset: String(offset), limit: '50' });
    const [status, page] = await Promise.all([api(prefix + '/state'), api(prefix + '/jobs?' + params)]);
    total = page.total; pageItems = page.items;
    byId('totalJobs').textContent = status.entries; byId('activeJobs').textContent = status.active.length;
    byId('readyJobs').textContent = status.counts.COMPLETED ?? 0;
    byId('buyerRoots').textContent = status.buyerRoots.join('\n') || 'Owned buyers inside ' + status.directory + '/buyers';
    const scan = status.library.activity;
    byId('scanStatus').textContent = scan ? 'Indexing ' + scan.completed + ' / ' + (scan.total ?? '…') :
      status.library.scan ? (status.library.scan.counts.VERIFIED ?? 0) + ' verified resources' : 'Library has not been scanned';
    byId('scanButton').disabled = Boolean(scan);
    const selectedId = selected?.id ?? requestedEntry, epoch = selectionEpoch;
    if (selectedId) {
      const current = await api(endpoint(selectedId));
      if ((!selected || selected.id === selectedId) && epoch === selectionEpoch) { selected = current; requestedEntry = null; }
    }
    renderList(); renderDetail();
    byId('connection').textContent = 'Connected · ' + new Date().toLocaleTimeString();
  } catch (error) {
    byId('connection').textContent = 'Connection interrupted';
    if (error.status === 401) message('Open the private launch URL again to restore this session.', true);
    else { requestedEntry = null; problem(error); }
  } finally { refreshing = false; }
}
async function perform(kind) {
  if (!selected) return;
  const id = selected.id;
  const result = await api(endpoint(id, 'start'), { method: 'POST', body: { kind, deadlineMs: 900000, pollMs: 1500 } });
  if (selected?.id === id) { selected = result; renderDetail(); }
  message(kind === 'fetch' ? 'Result retrieval started.' : kind === 'watch' ? 'Job monitoring started.' : 'Status refresh started.');
  await refresh();
}
byId('filterForm').addEventListener('submit', event => { event.preventDefault(); offset = 0; refresh(); });
byId('previous').addEventListener('click', () => { offset = Math.max(0, offset - 50); refresh(); });
byId('next').addEventListener('click', () => { offset += 50; refresh(); });
byId('intakeMode').addEventListener('change', () => {
  const directory = byId('intakeMode').value === 'directory';
  byId('fileFields').hidden = directory; byId('directoryFields').hidden = !directory;
});
function base64(bytes) {
  let value = ''; for (let index = 0; index < bytes.length; index += 32768) value += String.fromCharCode(...bytes.subarray(index, index + 32768));
  return btoa(value);
}
byId('intakeForm').addEventListener('submit', async event => {
  event.preventDefault(); const submit = event.submitter; submit.disabled = true;
  try {
    let result;
    if (byId('intakeMode').value === 'directory') result = await api(prefix + '/register', { method: 'POST',
      body: { buyerDirectory: byId('buyerDirectory').value.trim(), label: byId('intakeLabel').value } });
    else {
      const file = byId('acceptanceFile').files[0], handoff = byId('handoffFile').files[0];
      if (!file || file.size > 65536) throw { code: 'JOB_ACCEPTANCE_FILE_REQUIRED' };
      if (handoff && handoff.size > 1048576) throw { code: 'JOB_HANDOFF_FILE_TOO_LARGE' };
      if (handoff && byId('claimToken').value) throw { code: 'JOB_SELECT_ONE_CLAIM_SOURCE' };
      const body = { acceptanceBase64: base64(new Uint8Array(await file.arrayBuffer())), label: byId('intakeLabel').value,
        ...(handoff ? { handoff: JSON.parse(await handoff.text()) } : { claimToken: byId('claimToken').value.trim() }) };
      result = await api(prefix + '/retain', { method: 'POST', body });
    }
    byId('claimToken').value = ''; byId('intake').open = false;
    labelDirty = false; noteDirty = false; noteRequest = null; collectionRequest = null; previewKey = null; selectionEpoch++; selected = result.entry;
    message(result.reused ? 'Opened the retained job.' : 'Job added to the workspace.');
    await refresh(); await loadCollections();
  } catch (error) { problem(error); } finally { submit.disabled = false; }
});
for (const [id, kind] of [['refreshButton','refresh'],['watchButton','watch'],['fetchButton','fetch']])
  byId(id).addEventListener('click', () => perform(kind).catch(problem));
byId('stopButton').addEventListener('click', async () => {
  const id = selected?.id, epoch = selectionEpoch;
  try {
    const value = await api(endpoint(id, 'stop'), { method: 'POST', body: {} });
    if (selected?.id === id && epoch === selectionEpoch) { selected = value; renderDetail(); }
    message('Stopping the local monitor or transfer.');
  } catch (error) { problem(error); }
});
byId('reopenButton').addEventListener('click', async () => {
  const id = selected?.id, epoch = selectionEpoch;
  try {
    const value = await api(endpoint(id, 'reopen'), { method: 'POST', body: {} });
    if (selected?.id === id && epoch === selectionEpoch) { selected = value; renderDetail(); }
    message('Original buyer receipt reopened.');
  } catch (error) { problem(error); }
});
byId('scanButton').addEventListener('click', async () => {
  try { await api('/api/scan', { method: 'POST', body: {} }); message('Updating the resource library.'); await refresh(); }
  catch (error) { problem(error); }
});
for (const id of ['jobLabel','archived']) byId(id).addEventListener('input', () => { labelDirty = true; });
byId('labelForm').addEventListener('submit', async event => {
  event.preventDefault();
  const id = selected?.id, epoch = selectionEpoch;
  try {
    const value = await api(endpoint(id), { method: 'PATCH', body: { expectedRevision: labelRevision,
      label: byId('jobLabel').value, archived: byId('archived').checked } });
    if (selected?.id === id && epoch === selectionEpoch) { selected = value; labelDirty = false; }
    message('Job details saved.'); await refresh();
  } catch (error) { problem(error); }
});
byId('previewButton').addEventListener('click', async () => {
  const id = selected?.id, resource = selected?.resource;
  if (!resource) return;
  byId('previewButton').disabled = true;
  try {
    const preview = await api('/api/resources/' + resource.id + '/preview');
    if (selected?.id !== id) return;
    byId('preview').textContent = preview.text ?? 'Binary file. Use Download to open it in the appropriate application.';
    message(preview.coverage === 'PREFIX' ? 'Preview covers ' + size(preview.indexedBytes) + ' of ' + size(preview.bytes) + '.' : 'Result verified and opened.');
  } catch (error) { problem(error); }
  finally { renderDetail(); }
});
byId('downloadButton').addEventListener('click', async () => {
  try {
    const transfer = await api('/api/resources/' + selected.resource.id + '/download', { method: 'POST', body: {} });
    const link = node('a'); link.href = transfer.url; link.download = selected.resource.name;
    document.body.append(link); link.click(); link.remove(); message('Verified download started.');
  } catch (error) { problem(error); }
});
byId('resultLibraryLink').addEventListener('click', async event => {
  event.preventDefault();
  try { await api('/api/selection', { method: 'PUT', body: { id: selected.resource.id } }); location.assign(byId('resultLibraryLink').href); }
  catch (error) { problem(error); }
});
for (const id of ['note','tags','starred']) byId(id).addEventListener('input', () => { noteDirty = true; noteRequest = null; });
byId('noteForm').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const resource = selected.resource;
    if (!noteRequest) noteRequest = { expectedRevision: annotationRevision, operationId: crypto.randomUUID(),
      note: byId('note').value, tags: byId('tags').value.split(',').map(value => value.trim()).filter(Boolean), starred: byId('starred').checked };
    const request = noteRequest;
    const annotation = await api('/api/resources/' + resource.id + '/note', { method: 'PATCH', body: request });
    if (selected.resource?.id === resource.id) {
      selected.resource.annotation = annotation;
      if (noteRequest === request) { noteDirty = false; noteRequest = null; }
      renderDetail();
    }
    message('Research notes saved.');
  } catch (error) { problem(error); }
});
byId('collection').addEventListener('change', () => {
  byId('collectionNameLabel').hidden = Boolean(byId('collection').value); collectionRequest = null;
});
byId('collectionName').addEventListener('input', () => { collectionRequest = null; });
byId('collectionForm').addEventListener('submit', async event => {
  event.preventDefault();
  const entryId = selected?.id, resource = selected?.resource;
  if (!resource) return;
  try {
    let request = collectionRequest;
    if (!request) {
      const id = byId('collection').value, name = byId('collectionName').value.trim();
      const previous = id ? await api('/api/collections/' + id) : null;
      const members = (previous?.members ?? []).filter(value => value.id !== resource.id)
        .map(value => ({ id: value.id, sha256: value.sha256, annotationRevision: value.annotation.revision, mode: 'retain' }));
      members.push({ id: resource.id, sha256: resource.sha256, annotationRevision: resource.annotation.revision, mode: 'current' });
      request = { id: previous?.id ?? 'jobs-' + crypto.randomUUID(), name: previous?.name ?? name,
        note: previous?.note ?? '', expectedRevision: previous?.revision ?? 0, operationId: crypto.randomUUID(), members };
      if (selected?.id === entryId) collectionRequest = request;
    }
    const result = await api('/api/collections', { method: 'PUT', body: request });
    if (selected?.id === entryId && collectionRequest === request) {
      collectionRequest = null; await loadCollections();
      if (selected?.id === entryId) { byId('collection').value = result.id; byId('collectionNameLabel').hidden = true; }
    }
    message('Saved to ' + result.name + ', revision ' + result.revision + '.');
  } catch (error) { problem(error); }
});
async function poll() {
  clearTimeout(timer);
  if (!document.hidden) await refresh();
  timer = setTimeout(poll, document.hidden ? 10000 : 2500);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) void poll(); });
window.addEventListener('pagehide', () => clearTimeout(timer), { once: true });
links();
if (!token) message('Open the private launch URL printed by job-workspace serve.', true);
else void poll();
