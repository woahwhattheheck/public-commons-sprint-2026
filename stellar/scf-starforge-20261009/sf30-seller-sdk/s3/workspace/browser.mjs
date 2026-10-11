// MIT. Browser authoring for the same retained native S3 workspace.
const $ = id => document.getElementById(id);
const token = location.hash.slice(1) || sessionStorage.getItem('sf30.s3.token:' + location.origin) || '';
sessionStorage.setItem('sf30.s3.token:' + location.origin, token);
if (location.hash) history.replaceState(null, '', location.pathname);
const text = value => JSON.stringify(value, null, 2);
let state, model, expectedRevision = 0, loadedRevision = null, selectedObject = 0, dirty = false,
  sourceJsonDirty = false, selectedReview = null, historyRows = [], nextBeforeRevision = null, pending = {};
const sourceFields = ['region', 'bucket', 'endpoint', 'credentialProvider', 'expectedBucketOwner', 'timeoutMs', 'maxInFlight', 'forcePathStyle', 'allowLocalEndpoint'];
const objectFields = ['id', 'path', 'key', 'mode', 'maxBytes', 'contentType', 'filename', 'description', 'versionId', 'etag', 'expectedBytes', 'sha256'];
const optionalSource = ['endpoint', 'expectedBucketOwner'];
const optionalObject = ['versionId', 'etag', 'expectedBytes', 'sha256'];
const numberFields = new Set(['timeoutMs', 'maxInFlight', 'maxBytes', 'expectedBytes']);
const boolFields = new Set(['forcePathStyle', 'allowLocalEndpoint']);
function notice(message, error = false) { $('notice').textContent = message; $('notice').className = error ? 'error' : ''; }
async function api(path, body) {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-s3-workspace-token': token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || result.error || String(response.status));
  return result;
}
const query = (path, values) => path + '?' + new URLSearchParams(Object.entries(values).filter(([, value]) => value !== undefined));
async function run(task) {
  const buttons = [...document.querySelectorAll('button')]; buttons.forEach(button => { button.disabled = true; });
  try { await task(); } catch (error) { notice(error.message, true); }
  finally { buttons.forEach(button => { button.disabled = false; }); }
}
function remember() {
  if (!state || !model) return;
  sessionStorage.setItem('sf30.s3.draft', text({ workspaceId: state.workspaceId, model,
    paymentText: $('payment-json').value, sourceText: sourceJsonDirty ? $('source-json').value : null,
    expectedRevision, loadedRevision, selectedObject, dirty, pending }));
}
function changed() {
  dirty = true; $('draft-status').textContent = `Unsaved changes · expected revision ${expectedRevision}`;
  if (!sourceJsonDirty) $('source-json').value = text(model.source);
  remember();
}
function blankModel() { return { source: { schema: 'stellar-forge.s3-source.v1', region: 'us-east-1', bucket: '',
  credentialProvider: 'environment', timeoutMs: 10000, maxInFlight: 4, forcePathStyle: false, allowLocalEndpoint: false, objects: [] },
  payment: { scheme: 'exact', network: 'stellar:testnet', asset: '', payTo: '', amount: '1000', maxTimeoutSeconds: 60 }, origin: '' }; }
function fillInput(element, value, field) {
  if (boolFields.has(field)) element.checked = Boolean(value);
  else element.value = value === undefined ? '' : String(value);
}
function option(select, value, label) { const node = document.createElement('option'); node.value = value; node.textContent = label; select.append(node); }
function fillSelect(id, items, chosen, empty) {
  const select = $(id), old = chosen ?? select.value; select.replaceChildren(); option(select, '', empty);
  for (const item of items) option(select, item.value, item.label);
  if (items.some(item => item.value === old)) select.value = old;
}
function cell(row, value, mono = false) {
  const td = document.createElement('td');
  if (mono) { const pre = document.createElement('pre'); pre.textContent = value; td.append(pre); } else td.textContent = value;
  row.append(td); return td;
}
function renderObjects() {
  const tbody = $('products'); tbody.replaceChildren();
  (model.source.objects ?? []).forEach((item, index) => {
    const row = document.createElement('tr'); if (index === selectedObject) row.className = 'selected';
    const choose = document.createElement('button'); choose.textContent = item.id || 'Unnamed product';
    choose.addEventListener('click', () => { selectedObject = index; renderObjects(); remember(); });
    const td = document.createElement('td'); td.append(choose); row.append(td);
    cell(row, item.path ?? ''); cell(row, item.mode ?? 'whole'); tbody.append(row);
  });
  const item = model.source.objects?.[selectedObject]; $('product-editor').hidden = !item;
  if (item) for (const field of objectFields) fillInput($('object-' + field), item[field], field);
}
function renderEditor() {
  for (const field of sourceFields) fillInput($(field), model.source[field], field);
  $('origin').value = model.origin; $('payment-json').value = text(model.payment);
  $('source-json').value = text(model.source); sourceJsonDirty = false;
  selectedObject = Math.max(0, Math.min(selectedObject, (model.source.objects?.length ?? 1) - 1));
  renderObjects(); $('draft-status').textContent = loadedRevision === null ? 'New merchant draft' : `Opened revision ${loadedRevision} · expected revision ${expectedRevision}`;
}
function openDraft(draft, expected = state.draft?.revision ?? 0, persist = true) {
  model = draft ? { source: structuredClone(draft.source), payment: structuredClone(draft.payment), origin: draft.origin } : blankModel();
  loadedRevision = draft?.revision ?? null; expectedRevision = expected; dirty = false; renderEditor(); if (persist) remember();
}
function collect() {
  if (sourceJsonDirty) {
    const source = JSON.parse($('source-json').value);
    if (!source || !Array.isArray(source.objects)) throw new Error('Source JSON must contain its original objects array.');
    model.source = source; sourceJsonDirty = false;
  }
  model.payment = JSON.parse($('payment-json').value); model.origin = $('origin').value;
  return structuredClone(model);
}
async function durable(path, values, kind) {
  const identity = JSON.stringify(values), prior = pending[kind];
  const operationId = prior?.identity === identity ? prior.operationId : kind + '-' + crypto.randomUUID();
  pending[kind] = { identity, operationId }; remember();
  const result = await api(path, { ...values, operationId }); delete pending[kind]; remember(); return result;
}
function renderHistory() {
  $('history').replaceChildren();
  for (const item of historyRows) {
    const row = document.createElement('tr'); cell(row, String(item.revision)); cell(row, new Date(item.savedAt).toLocaleString());
    cell(row, item.origin); cell(row, item.sourceSha256.slice(0, 16));
    const button = document.createElement('button'); button.textContent = 'Open';
    button.addEventListener('click', () => run(async () => {
      const draft = await api(query('/api/revision', { revision: item.revision })); openDraft(draft);
      notice(`Opened revision ${item.revision}. Saving creates a new revision from the current selection.`);
    })); const td = document.createElement('td'); td.append(button); row.append(td); $('history').append(row);
  }
  $('older').hidden = nextBeforeRevision === null;
}
function renderState() {
  $('revision-status').textContent = `Current revision ${state.draft?.revision ?? 0}`;
  fillSelect('reviews', state.reviews.map(item => ({ value: item.reviewId,
    label: `Revision ${item.revision} · ${item.reviewId.slice(0, 12)} · ${new Date(item.createdAt).toLocaleString()}` })), selectedReview?.reviewId, 'Select saved inspection');
  fillSelect('packages', state.packages.filter(item => item.state === 'COMPLETE').map(item => ({ value: item.packageId,
    label: `Revision ${item.revision} · ${item.packageId}` })), undefined, 'Select prepared package');
  const releases = state.releases.releases ?? [];
  fillSelect('customer-release', releases.filter(item => item.source?.kind === 'S3_OBJECT_PACKAGE').map(item => ({ value: item.id,
    label: `${item.id} · ${item.s3?.objectCount ?? item.routes?.length ?? 0} products` })), undefined, 'Select retained S3 release');
  const selected = state.releases.state;
  $('release-summary').textContent = `Selection generation ${selected?.generation ?? 0}. Active release: ${selected?.active ?? 'none'}. ${releases.length} retained release(s).`;
  $('operations').textContent = text(state.operations.map(item => ({ operationId: item.operationId, kind: item.kind,
    state: item.state, error: item.error, updatedAt: item.updatedAt, result: item.kind === 'REVIEW' ? item.result : undefined })));
  historyRows = state.history.revisions; nextBeforeRevision = state.history.nextBeforeRevision; renderHistory();
}
async function refresh() { state = await api('/api/status'); renderState(); }
function renderReview(review) {
  selectedReview = review; $('reviews').value = review.reviewId;
  $('review-summary').textContent = `Saved revision ${review.revision} · ${review.description.objects.length} selected objects · inspected ${new Date(review.createdAt).toLocaleString()} · selection ${review.selectionSha256}`;
  $('review-objects').replaceChildren();
  for (const item of review.description.objects) {
    const route = review.service.routes.find(route => route.id === item.id), row = document.createElement('tr');
    cell(row, item.id + '\n' + item.snapshot, true); cell(row, `${item.mode}\n${item.bytes} total bytes\n${item.maxBytes} bytes per response`, true);
    cell(row, route.offer.resource.url); cell(row, text(route.offer.accepts), true); $('review-objects').append(row);
  }
}
for (const field of sourceFields) $(field).addEventListener('input', () => {
  const element = $(field), value = boolFields.has(field) ? element.checked : numberFields.has(field) ? Number(element.value) : element.value;
  if (optionalSource.includes(field) && value === '') delete model.source[field]; else model.source[field] = value;
  changed();
});
for (const field of objectFields) $('object-' + field).addEventListener('input', () => {
  const item = model.source.objects[selectedObject], value = $('object-' + field).value;
  if (optionalObject.includes(field) && value === '') delete item[field]; else item[field] = numberFields.has(field) ? Number(value) : value;
  changed(); if (['id', 'path', 'mode'].includes(field)) {
    const row = $('products').children[selectedObject]; if (row) {
      row.children[0].querySelector('button').textContent = item.id || 'Unnamed product'; row.children[1].textContent = item.path; row.children[2].textContent = item.mode ?? 'whole';
    }
  }
});
$('origin').addEventListener('input', () => { model.origin = $('origin').value; changed(); });
$('payment-json').addEventListener('input', changed);
$('source-json').addEventListener('input', () => { sourceJsonDirty = true; changed(); });
$('apply-source').addEventListener('click', () => run(async () => { collect(); renderEditor(); changed(); notice('Complete source JSON applied to this tab. Save to create a revision.'); }));
$('add-object').addEventListener('click', () => {
  const objects = model.source.objects; let index = objects.length + 1; while (objects.some(item => item.id === 'product-' + index)) index++;
  objects.push({ id: 'product-' + index, path: '/downloads/product-' + index, key: '', mode: 'whole', maxBytes: 921600,
    contentType: 'application/octet-stream', filename: 'product-' + index + '.bin', description: 'Download product ' + index });
  selectedObject = objects.length - 1; renderObjects(); changed();
});
$('remove-object').addEventListener('click', () => { model.source.objects.splice(selectedObject, 1); selectedObject = Math.max(0, selectedObject - 1); renderObjects(); changed(); });
$('refresh').addEventListener('click', () => run(async () => { await refresh(); notice('Current history refreshed. Your tab edits and expected revision are preserved.'); }));
$('reload').addEventListener('click', () => run(async () => { await refresh(); openDraft(state.draft); notice('Opened the current saved source and prices.'); }));
$('save').addEventListener('click', () => run(async () => {
  const result = await durable('/api/save', { expectedRevision, ...collect() }, 'save');
  await refresh(); openDraft(result, result.revision); notice(`Saved source and complete payment terms as revision ${result.revision}.`);
}));
$('review').addEventListener('click', () => run(async () => {
  if (dirty || !loadedRevision) throw new Error('Save this tab’s source and prices before inspecting its objects.');
  notice('Inspecting the saved object metadata through the native AWS provider…');
  const review = await durable('/api/review', { revision: loadedRevision }, 'review'); await refresh(); renderReview(review);
  notice('Object inspection saved. The complete selected snapshot is ready for preparation.');
}));
$('open-review').addEventListener('click', () => run(async () => { renderReview(await api(query('/api/review', { reviewId: $('reviews').value }))); notice('Reopened the retained inspection.'); }));
$('prepare').addEventListener('click', () => run(async () => {
  const review = await api(query('/api/review', { reviewId: $('reviews').value }));
  const result = await durable('/api/prepare', { revision: review.revision, reviewId: review.reviewId }, 'prepare');
  await refresh(); $('packages').value = result.packageId; notice(`Prepared ${result.packageId} from its original saved snapshot.`);
}));
$('stage').addEventListener('click', () => run(async () => {
  const runtime = { port: Number($('seller-port').value) };
  if ($('facilitator').value) runtime.facilitator = $('facilitator').value;
  if ($('allow-local-facilitator').checked) runtime.allowLocalFacilitator = true;
  const result = await durable('/api/stage', { packageId: $('packages').value, releaseId: $('release-id').value, runtime }, 'stage');
  await refresh(); $('customer-release').value = result.release.id;
  notice(`Staged ${result.release.id}. Open release operations to compare and select this version.`);
}));
$('console').addEventListener('click', () => run(async () => {
  const result = await api('/api/console', {}); $('console-link').href = result.operatorUrl; $('console-link').hidden = false;
  notice('The original release console is ready. Open release operations to manage the retained merchant.');
}));
$('older').addEventListener('click', () => run(async () => {
  const page = await api(query('/api/history', { beforeRevision: nextBeforeRevision })); historyRows.push(...page.revisions); nextBeforeRevision = page.nextBeforeRevision; renderHistory();
}));
async function download(file) {
  const releaseId = $('customer-release').value, manifest = await api(query('/api/customer', { releaseId }));
  const descriptor = manifest.files.find(item => item.file === file), bytes = new Uint8Array(descriptor.bytes); let offset = 0;
  do {
    const part = await api(query('/api/customer/file', { releaseId, file, offset, expectedSha256: descriptor.sha256 }));
    if (part.releaseDigest !== manifest.releaseDigest || part.offset !== offset || part.totalBytes !== descriptor.bytes) throw new Error('Customer handoff changed during download.');
    const block = Uint8Array.from(atob(part.dataBase64), character => character.charCodeAt(0)); bytes.set(block, offset); offset = part.nextOffset;
    if (part.eof) break; if (!block.length) throw new Error('Customer download made no progress.');
  } while (offset < bytes.length);
  const actual = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
  if (offset !== bytes.length || actual !== descriptor.sha256) throw new Error('Customer handoff digest differs from its original release.');
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/json' })), anchor = document.createElement('a');
  anchor.href = url; anchor.download = file; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  notice(`Downloaded original ${file} from ${releaseId} (${bytes.length} bytes).`);
}
for (const file of ['objects', 'offers']) $('download-' + file).addEventListener('click', () => run(() => download(file + '.json')));
for (const kind of ['source', 'payment']) {
  $('load-' + kind).addEventListener('click', () => $(kind + '-file').click());
  $(kind + '-file').addEventListener('change', () => run(async () => {
    const file = $(kind + '-file').files[0]; if (!file) return;
    if (file.size > 1048576) throw new Error('Choose a JSON file up to 1 MiB.');
    const value = JSON.parse(await file.text()), paymentText = $('payment-json').value,
      sourceText = sourceJsonDirty ? $('source-json').value : null;
    if (kind === 'source') { if (!Array.isArray(value?.objects)) throw new Error('Choose the original S3 source JSON.'); model.source = value; }
    else model.payment = value;
    renderEditor();
    if (kind === 'source') $('payment-json').value = paymentText;
    else if (sourceText !== null) { $('source-json').value = sourceText; sourceJsonDirty = true; }
    changed(); notice(`Imported ${file.name} into this tab. Save to retain the new revision.`);
  }));
}
function restoreTab(saved) {
  model = saved.model; expectedRevision = saved.expectedRevision; loadedRevision = saved.loadedRevision;
  selectedObject = saved.selectedObject ?? 0; pending = saved.pending ?? {}; renderEditor();
  $('payment-json').value = saved.paymentText;
  if (saved.sourceText) { $('source-json').value = saved.sourceText; sourceJsonDirty = true; }
  dirty = saved.dirty; if (dirty) changed(); remember(); $('restore-tab').hidden = true;
  notice(`Restored this tab’s draft against revision ${expectedRevision}.`);
}
await run(async () => {
  let saved; try { saved = JSON.parse(sessionStorage.getItem('sf30.s3.draft') ?? 'null'); } catch {}
  await refresh(); openDraft(state.draft, state.draft?.revision ?? 0, false);
  if (saved?.workspaceId === state.workspaceId) {
    if (saved.expectedRevision === (state.draft?.revision ?? 0)) restoreTab(saved);
    else if (saved.dirty || Object.keys(saved.pending ?? {}).length) {
      $('restore-tab').hidden = false; $('restore-tab').addEventListener('click', () => restoreTab(saved));
      notice('A retained tab draft belongs to an earlier revision. Restore it to reconcile your changes, or use the current saved source.');
    } else remember();
  } else remember();
});
