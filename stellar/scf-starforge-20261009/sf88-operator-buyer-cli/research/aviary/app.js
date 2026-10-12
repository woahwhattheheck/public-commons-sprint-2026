'use strict';

const $ = id => document.getElementById(id);
const KINDS = ['resources', 'media', 'transcripts', 'indexes', 'supplemental'];
const TARGET_FIELDS = ['baseUrl', 'collectionId', 'tokenEnv', 'organizationId', 'operationId'];
let state = null, review = null, revision = 0, dirty = false, jsonDirty = false, headers = [], page = 0;
let editorEpoch = 0, editVersion = 0, stateRequest = 0, mappingRequest = 0, previewRequest = 0;
let lastPreview = null, previewPending = false, pollTimer = null, previewTimer = null, polling = false;
let saving = false, assigning = false, planning = false, operationRequest = 0;
let selectedOperationId = '', selectedOperation = null, operationLoading = false, operationInitialized = false;
let draftVersion = 0, draftTouched = false;
let planDraft = {baseUrl: '', collectionId: '', tokenEnv: 'AVIARY_TOKEN', organizationId: '', operationId: ''};
const sourceTables = new Map();
const pendingMappings = new Set();

function copy(value) { return JSON.parse(JSON.stringify(value)); }
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function same(a, b) { return canonical(a) === canonical(b); }
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = String(text);
  if (className) element.className = className;
  return element;
}
function message(value) {
  $('message').hidden = !value;
  $('message').textContent = value || '';
}
async function api(path, body) {
  const options = body === undefined ? {} : {
    method: 'POST', headers: {'Content-Type': 'application/json', 'X-Workspace-Token': state.csrf},
    body: JSON.stringify(body)
  };
  const response = await fetch(path, options);
  const value = await response.json();
  if (!response.ok) throw new Error((value.message || 'The workspace request failed.') +
    (value.details ? '\n' + JSON.stringify(value.details, null, 2) : ''));
  return value;
}
function guarded(action) {
  return async event => {
    if (event) event.preventDefault();
    message('');
    try { await action(); } catch (error) { message(error.message); }
  };
}
function bytes(value) {
  if (value < 1024) return value + ' B';
  if (value < 1048576) return (value / 1024).toFixed(1) + ' KiB';
  return (value / 1048576).toFixed(1) + ' MiB';
}
function table(labels, rows) {
  const wrap = node('div', undefined, 'table-wrap'), result = node('table');
  const head = node('thead'), heading = node('tr'), body = node('tbody');
  for (const label of labels) heading.append(node('th', label));
  head.append(heading);
  for (const cells of rows) {
    const row = node('tr');
    for (const cell of cells) {
      const field = node('td');
      if (cell instanceof Node) field.append(cell); else field.textContent = String(cell ?? '');
      row.append(field);
    }
    body.append(row);
  }
  result.append(head, body); wrap.append(result); return wrap;
}
function syncJson() { if (!jsonDirty) $('mappingJson').value = JSON.stringify(review, null, 2); }
function currentEditor(epoch, document) { return epoch === editorEpoch && document === review; }
function pendingMappingCount() { return [...pendingMappings].filter(item => Object.values(review?.tables || {}).includes(item)).length; }
function syncControls() {
  const mappingPending = pendingMappingCount() > 0;
  $('saveMapping').disabled = $('saveReview').disabled = !review || saving || assigning || mappingPending;
  $('assignKeys').disabled = !review || saving || assigning || mappingPending;
  $('applyJson').disabled = !review || assigning;
  $('savedOperation').disabled = $('newOperation').disabled = !state;
  for (const field of TARGET_FIELDS) $(field).disabled = !state;
  for (const element of document.querySelectorAll('#mapping input, #mapping select, #mapping textarea, #previewRows input')) {
    element.disabled = !review || assigning;
  }
  const active = Boolean(state?.jobs?.active);
  const chosen = Boolean(selectedOperation && selectedOperation.id === selectedOperationId && !operationLoading &&
    state?.status.runs.some(run => run.id === selectedOperationId));
  $('planMigration').disabled = !review || planning || Boolean(selectedOperationId) || saving || assigning || mappingPending;
  $('runMigration').disabled = !chosen || active;
  $('reconcile').disabled = !chosen || active || !$('reconcileAction').value;
  $('refreshUpload').disabled = !chosen || active;
  $('exportTranscripts').disabled = !chosen || active;
  $('buildPackage').disabled = !review || active || saving || assigning || mappingPending;
  $('exportWorkspace').disabled = !review || active || saving || assigning || mappingPending;
  $('mappingDirty').textContent = assigning ? 'Assigning keys to the saved mapping…' :
    saving ? (dirty ? 'Saving the captured mapping; later edits are retained.' : 'Saving mapping…') :
    jsonDirty ? 'Unapplied JSON changes are retained. Apply the document before saving.' :
    dirty ? 'Unsaved mapping choices based on revision ' + revision : 'All choices saved at revision ' + revision;
  $('deliveryRevision').textContent = dirty || jsonDirty ?
    'The editor has unsaved choices. Save them before building a package or exporting this workspace.' :
    'Native packages use saved mapping revision ' + revision + '. Complete exports retain all saved revisions and original operations.';
}
function markDirty(refresh = false) {
  dirty = true; editVersion += 1; previewRequest += 1; previewPending = false;
  syncJson(); syncControls();
  if (lastPreview) $('previewStatus').textContent = 'Editor changed after this preview. Refresh to review the current choices.';
  if (refresh) schedulePreview();
}
function adoptEditor(record) {
  review = copy(record.document); revision = record.revision; dirty = false;
  editorEpoch += 1; editVersion += 1; mappingRequest += 1; previewRequest += 1;
  headers = []; lastPreview = null;
  $('mappingNote').value = review.note || '';
  syncJson(); syncControls();
}
function tab(name) {
  for (const section of document.querySelectorAll('.tab')) section.hidden = section.id !== name;
  for (const button of document.querySelectorAll('nav button')) {
    if (button.dataset.tab === name) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  if (name === 'preview') guarded(loadPreview)();
  if (name === 'delivery') guarded(loadArtifacts)();
}
function renderJobs(jobs) {
  $('jobList').replaceChildren();
  if (!jobs.jobs.length) { $('jobList').append(node('p', 'No operator jobs have run yet.', 'muted')); return; }
  const rows = jobs.jobs.slice(-10).reverse().map(job => [
    job.kind, job.state, job.created,
    job.error?.message || job.persistenceError?.message || job.result?.state || job.result?.output || job.message || ''
  ]);
  $('jobList').append(table(['Work', 'State', 'Started', 'Result'], rows));
}
function renderTranscripts(downloads) {
  $('transcriptList').replaceChildren(table(['Resource', 'Transcript', 'Format', 'Download', 'Size'],
    downloads.map(item => {
      const link = node('a', item.path.split('/').at(-1));
      link.href = '/download-transcript?path=' + encodeURIComponent(item.path);
      return [item.resourceId, item.transcriptId, item.format, link, bytes(item.bytes)];
    })));
}
async function loadState() {
  const request = ++stateRequest, startEpoch = editorEpoch, startEdit = editVersion;
  const next = await api('/api/state');
  if (request !== stateRequest) return state;
  if (state && next.status.workspace.id !== state.status.workspace.id) {
    throw new Error('The server now contains a different workspace. Reload this page to open its source.');
  }
  state = next;
  let replaced = false;
  if (!review || (!dirty && !jsonDirty && !saving && !assigning && currentEditor(startEpoch, review) && startEdit === editVersion)) {
    if (!review || next.status.mapping.revision !== revision ||
        !same(next.status.mapping.document, review)) {
      adoptEditor(next.status.mapping); replaced = true;
    }
  }
  $('workspaceLabel').textContent = next.status.workspace.label + ' · saved mapping revision ' + next.status.mapping.revision;
  $('sourceSummary').replaceChildren(
    node('p', next.status.source.files.length + ' retained files · ' + bytes(next.status.source.bytes)),
    node('code', next.status.workspace.sourceManifestSha256));
  $('mappingSummary').replaceChildren(
    node('p', 'Editor base revision ' + revision + ' · latest saved revision ' + next.status.mapping.revision),
    node('p', review.note || 'No mapping note.', 'muted'));
  if ((dirty || jsonDirty) && next.status.mapping.revision !== revision) {
    $('mappingSummary').append(node('p', 'Another saved revision exists. Your draft is retained and its original save revision remains fixed.'));
  }
  if (!planDraft.operationId) planDraft.operationId = 'aviary-' + next.status.workspace.id;
  if (!operationInitialized) fillTarget(planDraft);
  renderJobs(next.jobs); renderOperationChoices(); renderTransfer(); renderTranscripts(next.status.downloads);
  syncControls();
  if (replaced) await renderMapping();
  const eventResult = await api('/api/events?tail=100');
  if (request === stateRequest) {
    $('events').replaceChildren(table(['Time', 'Event', 'Item'], eventResult.events.slice(-12).reverse()
      .map(item => [item.created, item.kind, item.action_key || 'Workspace'])));
  }
  if (!operationInitialized) {
    operationInitialized = true;
    await selectOperation(next.status.runs.at(-1)?.id || '');
  }
  if (next.jobs.active) schedulePoll();
  return state;
}
function sourceTable(path) {
  const key = state.status.workspace.sourceManifestSha256 + ':' + path;
  if (!sourceTables.has(key)) {
    sourceTables.set(key, api('/api/source-table?path=' + encodeURIComponent(path)).catch(error => {
      sourceTables.delete(key); throw error;
    }));
  }
  return sourceTables.get(key);
}
async function renderMapping() {
  if (!review) return;
  const request = ++mappingRequest, epoch = editorEpoch, document = review;
  const kind = $('mappingKind').value, selected = document.tables[kind], path = selected?.path || '';
  const current = () => request === mappingRequest && currentEditor(epoch, document) &&
    $('mappingKind').value === kind && review.tables[kind] === selected && (selected?.path || '') === path;
  $('mappingPath').replaceChildren();
  const empty = node('option', 'No table selected'); empty.value = ''; $('mappingPath').append(empty);
  for (const item of state.status.source.files.filter(item => item.path.toLowerCase().endsWith('.csv'))) {
    const option = node('option', item.path); option.value = item.path; $('mappingPath').append(option);
  }
  $('mappingPath').value = path; $('mappingRows').replaceChildren(); headers = [];
  $('mapCustom').disabled = $('ignoreUnused').disabled = true;
  if (!selected) { $('sourceColumns').textContent = 'Select an original CSV to map this table.'; renderUnmapped(); return; }
  $('sourceColumns').textContent = 'Reading retained source columns…';
  let source;
  try { source = await sourceTable(path); } catch (error) { if (current()) throw error; return; }
  if (!current()) return;
  headers = source.headers;
  const fields = [...state.fields[kind], ...Object.keys(selected.columns || {}).filter(field => !state.fields[kind].includes(field))];
  for (const field of fields) {
    const row = node('tr'), from = node('td'), defaults = node('td'), select = node('select');
    select.setAttribute('aria-label', 'Source column for ' + field);
    const none = node('option', '— No source column —'); none.value = ''; select.append(none);
    for (const header of headers) { const option = node('option', header); option.value = header; select.append(option); }
    select.value = selected.columns?.[field] || '';
    select.addEventListener('change', () => {
      if (!current()) return;
      selected.columns ??= {};
      if (select.value) selected.columns[field] = select.value; else delete selected.columns[field];
      markDirty(); renderUnmapped();
    });
    const value = node('input'); value.value = selected.defaults?.[field] || '';
    value.setAttribute('aria-label', 'Entered default for ' + field);
    value.addEventListener('input', () => {
      if (!current()) return;
      selected.defaults ??= {};
      if (value.value) selected.defaults[field] = value.value; else delete selected.defaults[field];
      markDirty();
    });
    from.append(select); defaults.append(value); row.append(node('td', field), from, defaults); $('mappingRows').append(row);
  }
  renderUnmapped(); syncControls();
}
function unusedColumns() {
  const selected = review?.tables[$('mappingKind').value];
  if (!selected) return [];
  return headers.filter(header => !Object.values(selected.columns || {}).includes(header) &&
    !(selected.ignoredColumns || []).includes(header));
}
function renderUnmapped() {
  const selected = review?.tables[$('mappingKind').value], unused = unusedColumns();
  $('sourceColumns').textContent = !selected ? 'Select an original CSV to map this table.' :
    unused.length ? 'Original columns still needing a mapping or an explicit ignored choice: ' + unused.join(', ') :
    'All original columns have a recorded mapping or ignored choice.';
  $('mapCustom').disabled = assigning || !['resources', 'media'].includes($('mappingKind').value) || !unused.length;
  $('ignoreUnused').disabled = assigning || !unused.length;
}
async function chooseSource() {
  const kind = $('mappingKind').value, path = $('mappingPath').value, epoch = editorEpoch, document = review;
  if (!path) {
    delete review.tables[kind]; markDirty(); await renderMapping(); return;
  }
  const selected = {path, columns: {}, defaults: {}, valueMaps: {}, ignoredColumns: [], stripPathPrefix: ''};
  review.tables[kind] = selected; pendingMappings.add(selected); markDirty(); syncControls();
  $('mappingRows').replaceChildren(); headers = [];
  $('sourceColumns').textContent = 'Reading the selected original CSV columns…';
  try {
    const source = await sourceTable(path);
    if (!currentEditor(epoch, document) || review.tables[kind] !== selected) return;
    selected.columns = Object.fromEntries(source.headers.filter(header => state.fields[kind].includes(header))
      .map(header => [header, header]));
    markDirty();
    if ($('mappingKind').value === kind) await renderMapping();
  } catch (error) {
    if (currentEditor(epoch, document) && review.tables[kind] === selected) throw error;
  } finally { pendingMappings.delete(selected); syncControls(); }
}
async function save() {
  if (saving || assigning || pendingMappingCount()) throw new Error('Wait for the current source-column or mapping operation to finish.');
  if (jsonDirty) throw new Error('Apply the complete mapping document to the editor before saving. Your JSON text is retained.');
  const document = copy(review), epoch = editorEpoch, version = editVersion, expected = revision;
  const workspaceId = state.status.workspace.id;
  saving = true; syncControls();
  let result;
  try {
    try {
      result = await api('/api/mapping', {document, expectedRevision: expected});
    } catch (error) {
      // A saved revision can outlive its HTTP response. Adopt only the exact
      // captured document at this request's unchanged or single successor revision.
      let observed;
      try { observed = await api('/api/state'); } catch { throw error; }
      const current = observed.status.mapping;
      if (observed.status.workspace.id !== workspaceId ||
          ![expected, expected + 1].includes(current.revision) ||
          !same(current.document, document)) throw error;
      result = {revision: current.revision, reused: current.revision === expected, recovered: true};
    }
    if (revision === expected && state.status.workspace.id === workspaceId) {
      // Our captured save advances the base even when the operator applied a
      // new document while it was in flight. Only that captured draft can be clean.
      revision = result.revision;
      if (epoch === editorEpoch && version === editVersion && same(review, document)) dirty = false;
    }
  } finally { saving = false; syncControls(); }
  await loadState(); await loadPreview();
  message((result.recovered ? 'Recovered saved mapping revision ' :
    result.reused ? 'Mapping already saved at revision ' : 'Saved mapping revision ') + result.revision +
    (dirty ? '. Your later edits remain in the editor.' : '.'));
  return result;
}
async function assignKeys() {
  if (dirty || jsonDirty) await save();
  if (dirty) throw new Error('Your later mapping edits are retained. Save them before assigning keys.');
  if (saving || assigning || pendingMappingCount()) throw new Error('A mapping operation is still active.');
  assigning = true; syncControls(); renderUnmapped();
  let result, failure;
  try { result = await api('/api/assign-keys', {expectedRevision: revision}); }
  catch (error) { failure = error; }
  finally { assigning = false; syncControls(); }
  await loadState(); await renderMapping(); await loadPreview();
  if (failure) throw new Error(failure.message + '\nLatest saved mapping revision ' +
    state.status.mapping.revision + ' is shown; the original source and your current editor choices are retained.');
  message('Aviary user keys saved at revision ' + result.revision + ' with their original source identifiers.');
}
function schedulePreview() {
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = setTimeout(() => { previewTimer = null; guarded(loadPreview)(); }, 200);
}
function recordDetails(item, kind, document) {
  const details = node('details'), summary = node('summary', 'Fields, source and files');
  details.append(summary);
  const mapping = document.tables[kind] || {};
  details.append(table(['Aviary field', 'Original column / entered default', 'Mapped value'],
    Object.keys(item.values).sort().map(field => [
      field, mapping.columns?.[field] || (Object.hasOwn(mapping.defaults || {}, field) ? 'Entered default' : '—'),
      item.values[field]
    ])));
  details.append(node('h3', 'Exact original source row'));
  details.append(table(['Original column', 'Original value'], Object.entries(item.source.values)));
  const assets = Object.entries(item.assets || {});
  if (assets.length) {
    details.append(node('h3', 'Retained files'));
    details.append(table(['Field', 'Original file', 'Size', 'SHA256'],
      assets.map(([field, item]) => [field, item.path, bytes(item.bytes), item.sha256])));
  }
  if (item.exclusionReason) details.append(node('p', 'Recorded exclusion: ' + item.exclusionReason));
  return details;
}
async function loadPreview() {
  if (!review) return;
  if (previewTimer) { clearTimeout(previewTimer); previewTimer = null; }
  const request = ++previewRequest, epoch = editorEpoch, version = editVersion;
  const document = review, captured = copy(review), kind = $('previewKind').value, offset = page, base = revision;
  const workspaceId = state.status.workspace.id, wasDirty = dirty, hadJsonDraft = jsonDirty;
  const current = () => request === previewRequest && currentEditor(epoch, document) &&
    version === editVersion && revision === base && $('previewKind').value === kind && page === offset &&
    state.status.workspace.id === workspaceId;
  previewPending = true; $('previousPage').disabled = $('nextPage').disabled = true;
  $('previewStatus').textContent = 'Reviewing ' + (wasDirty ? 'current editor choices' : 'saved mapping revision ' + base) + '…';
  $('previewRows').replaceChildren();
  let result;
  try {
    result = await api('/api/preview', {table: kind, offset, limit: 50, revision: base, document: captured});
  } catch (error) { if (current()) throw error; return; }
  finally { if (request === previewRequest) previewPending = false; }
  if (!current()) return;
  if (result.workspace.id !== workspaceId || result.page.table !== kind || result.page.offset !== offset) {
    throw new Error('The preview response belongs to a different selection.');
  }
  lastPreview = {data: result, kind, page: offset, epoch, version};
  $('metrics').replaceChildren();
  for (const name of KINDS) {
    const card = node('div', undefined, 'metric');
    card.append(node('strong', result.counts[name]), node('span', name)); $('metrics').append(card);
  }
  $('issues').replaceChildren();
  if (result.issues.length) {
    const list = node('ul', undefined, 'notes');
    for (const item of result.issues) {
      list.append(node('li', (item.level === 'error' ? 'Required correction: ' : 'Source note: ') +
        (item.table || 'Package') + ' ' + (item.key || '') + ' — ' + item.message));
    }
    $('issues').append(list);
  } else $('issues').append(node('p', 'All selected rows have valid mappings and file relationships.', 'muted'));
  for (const item of result.tables[kind]) {
    const row = node('tr', undefined, item.included ? '' : 'row-disabled'), check = node('input');
    check.type = 'checkbox'; check.checked = !review.exclude?.[kind]?.[item.key];
    check.setAttribute('aria-label', 'Include source row ' + item.key);
    check.addEventListener('change', () => {
      if (!currentEditor(epoch, document) || $('previewKind').value !== kind || page !== offset || assigning) return;
      review.exclude ??= {}; review.exclude[kind] ??= {};
      if (check.checked) delete review.exclude[kind][item.key];
      else {
        const reason = window.prompt('Reason for excluding this source row');
        if (!reason?.trim()) { check.checked = true; return; }
        review.exclude[kind][item.key] = reason.trim();
      }
      row.classList.toggle('row-disabled', !check.checked); markDirty(true);
    });
    const included = node('td'); included.append(check); row.append(included);
    const values = item.values, title = values.Title || values['Display Name'] || values.Path || values['File Path'] || item.key;
    for (const value of [item.key, title, item.parent?.key || item.parent?.providerId || '',
      values['Rights Statement'] || values.Rights || values.Description || '', item.source.path + ':' + item.source.line]) {
      row.append(node('td', value));
    }
    const detail = node('td'); detail.append(recordDetails(item, kind, captured)); row.append(detail); $('previewRows').append(row);
  }
  $('previewCount').textContent = result.page.total ?
    (offset + 1) + '–' + Math.min(offset + 50, result.page.total) + ' of ' + result.page.total + ' rows' : 'No rows';
  $('previewStatus').textContent = wasDirty ?
    'Preview of unsaved editor choices based on revision ' + base + '. Save review choices to retain them.' :
    'Exact saved mapping revision ' + base + ' · original source retained.';
  if (hadJsonDraft) $('previewStatus').textContent += ' Unapplied JSON text is retained separately until you apply the document.';
  $('previousPage').disabled = offset === 0; $('nextPage').disabled = result.page.nextOffset === null;
  syncControls();
}
function captureDraft() {
  if (selectedOperationId) return;
  for (const field of TARGET_FIELDS) planDraft[field] = $(field).value;
}
function renderOperationChoices() {
  const select = $('savedOperation');
  select.replaceChildren();
  const draft = node('option', 'New migration plan'); draft.value = ''; select.append(draft);
  for (const run of [...state.status.runs].reverse()) {
    const option = node('option', run.id + ' · mapping revision ' + run.revision);
    option.value = run.id; select.append(option);
  }
  select.value = selectedOperationId;
}
function fillTarget(values) {
  for (const field of TARGET_FIELDS) $(field).value = values[field] ?? (field === 'tokenEnv' ? 'AVIARY_TOKEN' : '');
}
async function selectOperation(id) {
  operationInitialized = true;
  if (!selectedOperationId) captureDraft();
  const request = ++operationRequest;
  selectedOperationId = id; selectedOperation = null; operationLoading = Boolean(id);
  $('savedOperation').value = id;
  $('providerId').value = $('reconcileNote').value = $('refreshMediaKey').value = $('uploadManifest').value = '';
  if (!id) { fillTarget(planDraft); renderTransfer(); syncControls(); return; }
  renderTransfer(); syncControls();
  let operation;
  try { operation = await api('/api/operation?id=' + encodeURIComponent(id)); }
  catch (error) { if (request === operationRequest && selectedOperationId === id) throw error; return; }
  finally { if (request === operationRequest) { operationLoading = false; renderTransfer(); } syncControls(); }
  if (request !== operationRequest || selectedOperationId !== id) return;
  if (operation.id !== id) throw new Error('Saved operation response changed its identity.');
  selectedOperation = operation;
  fillTarget({...operation.config, operationId: operation.id});
  renderTransfer(); syncControls();
}
function renderTransfer() {
  if (!state) return;
  const selected = state.status.runs.find(run => run.id === selectedOperationId);
  const oldAction = $('reconcileAction').value;
  $('actionRows').replaceChildren(); $('reconcileAction').replaceChildren();
  for (const field of TARGET_FIELDS) $(field).readOnly = Boolean(selectedOperationId);
  $('savedConfiguration').hidden = !selectedOperation;
  $('selectedConfiguration').textContent = selectedOperation ? JSON.stringify(selectedOperation.config, null, 2) : '';
  if (!selectedOperationId) {
    $('planState').textContent = 'New-plan draft. Refreshing saved progress preserves these entered values.';
    $('runSummary').textContent = 'Save this target as a new operation, then choose that saved operation to run it.';
    return;
  }
  $('planState').textContent = operationLoading ? 'Opening the exact saved target configuration…' :
    selectedOperation ? 'Saved operation selected. Its original target, token variable and configuration are fixed.' :
    'Saved configuration is unavailable. Refresh progress to reopen this exact operation.';
  $('runSummary').textContent = selected ?
    'Original operation ' + selected.id + ' · mapping revision ' + selected.revision :
    'This operation is absent from the current saved workspace.';
  for (const item of selected?.actions || []) {
    let error = '';
    try { error = item.error ? JSON.parse(item.error).message : ''; } catch { error = item.error || ''; }
    const row = node('tr');
    for (const value of [item.action_key, item.state, item.provider_id || '', item.updated, error]) row.append(node('td', value));
    $('actionRows').append(row);
    if (['DISPATCHING', 'UNCERTAIN'].includes(item.state)) {
      const option = node('option', item.action_key); option.value = item.action_key; $('reconcileAction').append(option);
    }
  }
  if ([...$('reconcileAction').options].some(option => option.value === oldAction)) $('reconcileAction').value = oldAction;
}
function selectedId() {
  if (!selectedOperationId || operationLoading || selectedOperation?.id !== selectedOperationId ||
      $('savedOperation').value !== selectedOperationId ||
      !state.status.runs.some(run => run.id === selectedOperationId)) {
    throw new Error('Choose and open the saved operation first.');
  }
  return selectedOperationId;
}
async function savePlan() {
  if (selectedOperationId) throw new Error('Open the separate new-plan draft to choose another target.');
  if (dirty || jsonDirty) throw new Error('Apply and save the reviewed mapping choices before planning the migration.');
  if (planning) throw new Error('The captured migration plan is still being saved.');
  captureDraft();
  const captured = copy(planDraft), version = draftVersion, base = revision, selection = operationRequest;
  const config = {schema: 'stellar-forge.aviary-client.v1',
    baseUrl: captured.baseUrl, collectionId: captured.collectionId, tokenEnv: captured.tokenEnv,
    organizationId: captured.organizationId};
  planning = true; syncControls();
  try {
    await api('/api/plan', {config, operationId: captured.operationId, revision: base});
  } finally { planning = false; syncControls(); }
  await loadState();
  if (!selectedOperationId && selection === operationRequest && version === draftVersion && same(planDraft, captured)) {
    draftTouched = false; await selectOperation(captured.operationId);
  }
  message('Saved original migration ' + captured.operationId + ' at mapping revision ' + base +
    (version !== draftVersion ? '. Your later target edits remain in the new-plan draft.' : '.'));
}
async function loadArtifacts() {
  const workspace = state.status.workspace.id, result = await api('/api/artifacts');
  if (state.status.workspace.id !== workspace) return;
  $('artifactList').replaceChildren();
  if (!result.files.length) { $('artifactList').append(node('p', 'Built packages appear here.', 'muted')); return; }
  $('artifactList').append(table(['Download', 'Size'], result.files.map(item => {
    const link = node('a', item.name); link.href = item.downloadUrl; link.className = 'button';
    return [link, bytes(item.bytes)];
  })));
}
function schedulePoll() {
  if (pollTimer || polling) return;
  pollTimer = setTimeout(async () => {
    pollTimer = null; polling = true;
    let again = false;
    try {
      const jobs = await api('/api/jobs');
      state.jobs = jobs; renderJobs(jobs); syncControls();
      await loadState();
      again = Boolean(state.jobs.active);
      if (!again) {
        await loadArtifacts();
        const job = state.jobs.jobs.at(-1);
        message(job?.state === 'FAILED' ? job.error?.message || 'The operator job failed.' :
          job?.result?.state === 'PARTIAL' ? 'Migration saved partial progress. Select its original operation to review unfinished items.' :
          job?.state === 'COMPLETED' ? 'Completed ' + job.kind + '.' : 'Saved operation refreshed.');
      }
    } catch (error) { message(error.message + '\nRefresh progress to reopen the original saved operation.'); }
    finally { polling = false; if (again) schedulePoll(); }
  }, 2000);
}
async function queue(path, body = {}) {
  const result = await api(path, body);
  state.jobs.active = result.job.id; syncControls();
  message('Running ' + result.job.kind + (body.operationId ? ' for ' + body.operationId : '') +
    '. Progress is saved in this workspace.');
  schedulePoll();
}
function requireSavedMapping() {
  if (dirty || jsonDirty) throw new Error('Apply and save your current mapping choices before creating this delivery.');
  if (saving || assigning || pendingMappingCount()) throw new Error('Wait for the current mapping operation to finish.');
}

for (const button of document.querySelectorAll('[data-tab]')) button.addEventListener('click', () => tab(button.dataset.tab));
for (const button of document.querySelectorAll('[data-go]')) button.addEventListener('click', () => tab(button.dataset.go));
$('mappingKind').addEventListener('change', guarded(renderMapping));
$('mappingPath').addEventListener('change', guarded(chooseSource));
$('mappingNote').addEventListener('input', () => { review.note = $('mappingNote').value; markDirty(); });
$('mappingJson').addEventListener('input', () => {
  jsonDirty = true; editVersion += 1; previewRequest += 1; previewPending = false; syncControls();
});
$('mapCustom').addEventListener('click', guarded(async () => {
  const selected = review.tables[$('mappingKind').value];
  for (const column of unusedColumns()) selected.columns[column] = column;
  markDirty(); await renderMapping();
}));
$('ignoreUnused').addEventListener('click', () => {
  const selected = review.tables[$('mappingKind').value];
  selected.ignoredColumns = [...(selected.ignoredColumns || []), ...unusedColumns()];
  markDirty(); renderUnmapped();
});
$('applyJson').addEventListener('click', guarded(async () => {
  const value = JSON.parse($('mappingJson').value);
  if (value.schema !== 'stellar-forge.aviary-mapping.v1' || !value.tables) throw new Error('Use an Aviary mapping document.');
  review = value; jsonDirty = false; editorEpoch += 1; mappingRequest += 1;
  $('mappingNote').value = review.note || ''; markDirty(); await renderMapping();
}));
$('saveMapping').addEventListener('click', guarded(save));
$('saveReview').addEventListener('click', guarded(save));
$('assignKeys').addEventListener('click', guarded(assignKeys));
$('previewKind').addEventListener('change', guarded(async () => { page = 0; await loadPreview(); }));
$('refreshPreview').addEventListener('click', guarded(loadPreview));
$('previousPage').addEventListener('click', guarded(async () => { if (!previewPending) { page = Math.max(0, page - 50); await loadPreview(); } }));
$('nextPage').addEventListener('click', guarded(async () => {
  if (!previewPending && lastPreview?.kind === $('previewKind').value && lastPreview.page === page &&
      lastPreview.data.page.nextOffset !== null) { page = lastPreview.data.page.nextOffset; await loadPreview(); }
}));
for (const field of TARGET_FIELDS) $(field).addEventListener('input', () => {
  if (!selectedOperationId) { captureDraft(); draftVersion += 1; draftTouched = true; }
});
$('savedOperation').addEventListener('change', guarded(() => selectOperation($('savedOperation').value)));
$('newOperation').addEventListener('click', guarded(() => selectOperation('')));
$('planMigration').addEventListener('click', guarded(savePlan));
$('runMigration').addEventListener('click', guarded(() => queue('/api/run', {operationId: selectedId()})));
$('refreshTransfer').addEventListener('click', guarded(async () => {
  await loadState(); if (selectedOperationId && !selectedOperation) await selectOperation(selectedOperationId);
}));
$('reconcileAction').addEventListener('change', syncControls);
$('reconcile').addEventListener('click', guarded(async () => {
  const operationId = selectedId(), action = $('reconcileAction').value;
  if (!action) throw new Error('Select an original uncertain action.');
  const result = await api('/api/reconcile', {operationId, action, providerId: $('providerId').value, note: $('reconcileNote').value});
  await loadState();
  message('Original provider record ' + result.providerId + ' joined to ' + operationId + ' / ' + action + '.');
}));
$('refreshUpload').addEventListener('click', guarded(async () => {
  const operationId = selectedId(), manifestText = $('uploadManifest').value, mediaKey = $('refreshMediaKey').value;
  await api('/api/refresh-upload', {operationId, mediaKey, manifest: JSON.parse(manifestText)});
  if (selectedOperationId === operationId && $('uploadManifest').value === manifestText) $('uploadManifest').value = '';
  message('Fresh upload links saved for ' + operationId + ' / ' + mediaKey + '. Continue that original migration.');
}));
$('buildPackage').addEventListener('click', guarded(() => {
  requireSavedMapping(); return queue('/api/package', {revision});
}));
$('exportWorkspace').addEventListener('click', guarded(() => {
  requireSavedMapping(); return queue('/api/export');
}));
$('exportTranscripts').addEventListener('click', guarded(() => queue('/api/transcripts', {operationId: selectedId()})));
window.addEventListener('beforeunload', event => {
  if (dirty || jsonDirty || draftTouched) { event.preventDefault(); event.returnValue = ''; }
});
syncControls(); renderUnmapped();
guarded(async () => { await loadState(); await loadPreview(); })();
