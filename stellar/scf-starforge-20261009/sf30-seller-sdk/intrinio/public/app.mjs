// MIT. Intrinio operator UI; every server action uses the original Python workspace API.
import {createDraftStore} from '/local-draft-store.mjs';
import {INDEX_PATH, FILE_LIMIT, parseIndex, captureManifest, importCaptureInput, previewResult, sha256, unbase64,
  stable, reviewValidationInput, saveReviewInput, selectionValidationInput, saveSelectionInput,
  comparisonValidationInput, saveComparisonInput, operationOutcome, fail} from './data.mjs';

const $ = id => document.getElementById(id);
const clone = value => structuredClone(value);
const terminal = job => !['QUEUED', 'RUNNING'].includes(job.status);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const freshId = kind => 'intrinio-' + kind + '-' + crypto.randomUUID();
let token = location.hash.slice(1);
const tokenKey = 'intrinio-token:' + location.origin;
if (token) {
  try { sessionStorage.setItem(tokenKey, token); } catch {}
  history.replaceState(null, '', location.pathname + location.search);
} else {
  try { token = sessionStorage.getItem(tokenKey) ?? ''; } catch {}
}
let state = null, cache = null, cacheKey = null, pending = null, busy = false, activeJob = null;
let draft = {nativeWorkspaceId: null, actor: '', editions: {}}, cacheWrites = Promise.resolve(), draftTimer;
let selectedView = '', inspection = null, comparison = null, inspectOffsets = [], compareOffsets = [];
let currentTab = 'sources';

function node(tag, value, className) {
  const element = document.createElement(tag);
  if (value !== undefined && value !== null) element.textContent = typeof value === 'string' ? value : JSON.stringify(value);
  if (className) element.className = className;
  return element;
}
function button(label, action) {
  const element = node('button', label);
  element.type = 'button';
  element.addEventListener('click', () => run(action));
  return element;
}
function notice(message, error = false) {
  $('notice').textContent = message;
  $('notice').dataset.error = error ? 'true' : 'false';
}
function report(error) { notice((error.code ? error.code + ' · ' : '') + error.message, true); }
function storageFailure(error) {
  $('cache-notice').hidden = false;
  $('cache-notice').textContent = error.message + ' The current in-memory draft can still be downloaded.';
}
function switchTab(name) {
  currentTab = name;
  for (const section of document.querySelectorAll('.tab')) section.hidden = section.id !== name;
  for (const item of document.querySelectorAll('[data-tab]')) {
    if (item.dataset.tab === name) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  }
}
function writable() {
  if (!state || state.historical) throw fail('HISTORICAL_REVISION', 'Select Current saved source before changing this workspace.');
}
function actor() {
  const value = $('actor').value.trim();
  if (!value) throw fail('REVIEWER_REQUIRED', 'Enter the operator name recorded with this change.');
  return value;
}
function requireFreePending() {
  if (pending) throw fail('RETAINED_REQUEST', 'Recover the retained request or explicitly clear its local pointer before starting another operation.');
}
async function run(action) {
  if (busy) return;
  busy = true;
  document.body.setAttribute('aria-busy', 'true');
  document.querySelector('main').inert = true;
  for (const item of document.querySelectorAll('button,select,input,textarea')) item.disabled = true;
  try { await action(); }
  catch (error) { report(error); }
  finally {
    busy = false; activeJob = null; document.body.removeAttribute('aria-busy');
    document.querySelector('main').inert = false;
    for (const item of document.querySelectorAll('button,select,input,textarea')) item.disabled = false;
    if ($('cancel-operation')) $('cancel-operation').hidden = true;
    renderPending();
  }
}
async function api(path, body) {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST', cache: 'no-store',
    headers: {'x-python-workspace-token': token, ...(body === undefined ? {} : {'content-type': 'application/json'})},
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
  });
  if (!response.ok) {
    let error;
    try { error = await response.json(); } catch { error = {}; }
    throw fail(error.error?.code ?? error.code ?? 'HTTP_' + response.status,
      error.error?.message ?? error.message ?? 'The original workspace request did not complete.');
  }
  return response;
}
async function jsonApi(path, body) { return (await api(path, body)).json(); }
function localRecord(value) { return {...value, workspaceId: cacheKey, nativeWorkspaceId: state.native.workspace.id}; }
async function storeDraft() {
  if (!cache) return;
  const value = localRecord(draft);
  cacheWrites = cacheWrites.catch(() => {}).then(() => cache.writeDraft(value));
  try { await cacheWrites; $('cache-notice').hidden = true; } catch (error) { storageFailure(error); }
}
function scheduleDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => storeDraft(), 200);
}
async function retainRequest(value) {
  pending = localRecord(value); renderPending();
  if (!cache) return;
  try { await cache.writePending(pending); $('cache-notice').hidden = true; }
  catch (error) { storageFailure(error); }
}
async function clearRequest() {
  pending = null; renderPending();
  if (cache) try { await cache.deletePending(); } catch (error) { storageFailure(error); }
}
function renderPending() {
  $('pending-panel').hidden = !pending;
  if (!pending) return;
  $('pending-title').textContent = 'Retained ' + pending.kind + ' request';
  $('pending-detail').textContent = (pending.command?.operationId ?? pending.operationId ?? '') +
    (pending.previewId ? ' · native ' + pending.previewId : '') +
    '. Recover reads the saved outcome or repeats this exact request identity.';
}
function decisionFields(decision = {}) { return {status: decision.status ?? 'open', note: decision.note ?? ''}; }
function reviewBase(review) {
  return {revision: review.revision, title: review.title, notes: review.notes, decisions: clone(review.decisions)};
}
function savedReviewDraft(viewId, review) {
  const value = draft.editions[viewId];
  if (!value) return;
  Object.assign(value, {dirty: false, expectedReviewRevision: review.revision, title: review.title, notes: review.notes,
    decisions: clone(review.decisions), baseReview: reviewBase(review)});
}
function currentDraft() {
  if (!selectedView || !state?.index.editions[selectedView]) return null;
  const review = state.index.reviews[selectedView];
  let value = draft.editions[selectedView];
  if (!value) {
    value = {title: review.title, notes: review.notes, decisions: clone(review.decisions),
      expectedReviewRevision: review.revision, selected: [], dirty: false, sourceSha256: state.index.editions[selectedView].sha256,
      baseReview: reviewBase(review)};
    draft.editions[selectedView] = value;
  }
  if (value.sourceSha256 !== state.index.editions[selectedView].sha256)
    throw fail('DRAFT_SOURCE_CHANGED', 'This local draft belongs to another exact response; the saved source remains available.');
  if (!value.dirty && value.expectedReviewRevision !== review.revision) {
    Object.assign(value, {title: review.title, notes: review.notes, decisions: clone(review.decisions), expectedReviewRevision: review.revision,
      baseReview: reviewBase(review)});
  }
  if (!value.dirty && !value.baseReview) value.baseReview = reviewBase(review);
  return value;
}
function captureEditor() {
  draft.actor = $('actor').value;
  if (!selectedView || !draft.editions[selectedView]) return;
  const value = draft.editions[selectedView];
  if (value.title !== $('review-title').value || value.notes !== $('review-notes').value) value.dirty = true;
  value.title = $('review-title').value;
  value.notes = $('review-notes').value;
  renderDraftStatus();
}
function renderDraftStatus() {
  const value = currentDraft();
  const current = value ? state.index.reviews[selectedView].revision : null;
  $('draft-status').textContent = !value ? 'No statement selected' : value.dirty
    ? 'Unsaved local review · based on ' + value.expectedReviewRevision + (current !== value.expectedReviewRevision ? ' · current saved review is ' + current : '')
    : 'Saved review ' + value.expectedReviewRevision;
  $('review-rebase-hint').textContent = value?.dirty && !value.baseReview
    ? 'This older local draft has no saved comparison base. Carrying it applies its title, notes and explicit fact decisions over the freshly read review; the previous draft is kept for download.'
    : 'Read the current saved review explicitly. Adopt replaces this editor; Carry keeps fields changed in this local draft and leaves other operators’ changes in place. Both retain the previous local draft for download.';
  $('selected-count').textContent = (value?.selected.length ?? 0) + ' selected';
}
function editorFromDraft() {
  const value = currentDraft();
  $('review-title').value = value?.title ?? '';
  $('review-notes').value = value?.notes ?? '';
  if (!$('extract-title').value && value) $('extract-title').value = value.title + ' · selected facts';
  renderDraftStatus();
}
async function reconcileReview(carryLocal) {
  writable(); requireFreePending(); captureEditor(); await storeDraft();
  const viewId = selectedView, local = clone(currentDraft());
  if (!local) throw fail('SOURCE_REQUIRED', 'Choose a retained statement first.');
  const previousSourceRevision = state.revision.id;
  await loadState(null, {keepEditor: false});
  const source = state.index.editions[viewId];
  if (!source || source.sha256 !== local.sourceSha256)
    throw fail('DRAFT_SOURCE_CHANGED', 'The current source does not retain this exact response. Download the local draft and reopen its original source revision.');
  selectedView = viewId;
  const current = state.index.reviews[viewId], base = local.baseReview;
  draft.reviewBackups ??= [];
  draft.reviewBackups.push({viewId,sourceSha256:local.sourceSha256,sourceRevision:previousSourceRevision,
    retainedAt:new Date().toISOString(),action:carryLocal?'carry-local':'adopt-saved',review:local});
  const next = {title:current.title,notes:current.notes,decisions:clone(current.decisions),expectedReviewRevision:current.revision,
    selected:[...local.selected],dirty:false,sourceSha256:source.sha256,baseReview:reviewBase(current)};
  let preservedNamed = 0;
  if (carryLocal) {
    if (!base || local.title !== base.title) next.title = local.title;
    if (!base || local.notes !== base.notes) next.notes = local.notes;
    for (const [rowId, decision] of Object.entries(local.decisions)) {
      if (base && stable(decisionFields(decision)) === stable(decisionFields(base.decisions[rowId]))) continue;
      if (decision.status === 'open' && current.decisions[rowId]) { preservedNamed++; continue; }
      next.decisions[rowId] = decisionFields(decision);
    }
    next.dirty = next.title !== current.title || next.notes !== current.notes ||
      Object.entries(next.decisions).some(([rowId, decision]) => stable(decisionFields(decision)) !== stable(decisionFields(current.decisions[rowId])));
  }
  draft.editions[viewId] = next;
  await storeDraft(); editorFromDraft();
  if (inspection?.edition.id === viewId) renderInspection();
  else { inspection = null; $('fact-rows').replaceChildren(); $('statement-metadata').replaceChildren(); }
  notice((carryLocal ? 'Local changes carried onto saved review ' : 'Adopted current saved review ') + current.revision +
    '. The previous draft remains in Download local review draft.' +
    (next.dirty ? ' Inspect the draft, then explicitly save it.' : '') +
    (preservedNamed ? ' ' + preservedNamed + ' existing named decisions stayed saved because Open cannot erase their history; the previous local choices remain in the draft download.' : ''));
}
async function loadState(revisionId = null, {keepEditor = true} = {}) {
  if (keepEditor && state) { captureEditor(); await storeDraft(); }
  const native = await jsonApi('/api/state');
  const revision = revisionId ? await jsonApi('/api/revision?id=' + encodeURIComponent(revisionId)) : native.revision;
  const index = parseIndex(await jsonApi('/api/file?revision=' + encodeURIComponent(revision.id) + '&path=' + encodeURIComponent(INDEX_PATH)));
  const files = new Map(revision.files.map(file => [file.path, file]));
  for (const view of Object.values(index.editions)) {
    const file = files.get(view.path);
    if (!file || file.sha256 !== view.sha256 || file.bytes !== view.bytes)
      throw fail('SOURCE_REVISION_BINDING', 'The selected revision does not retain an exact source identified by workspace.json.');
  }
  state = {native, revision, index, historical: revision.id !== native.workspace.head};
  if (!cache) {
    cacheKey = 'intrinio:' + native.workspace.id;
    cache = createDraftStore(cacheKey);
    try {
      const values = await Promise.all([cache.readDraft(), cache.readPending()]);
      if (values[0]?.nativeWorkspaceId === native.workspace.id) draft = values[0];
      if (values[1]?.nativeWorkspaceId === native.workspace.id) pending = values[1];
    } catch (error) { storageFailure(error); }
    draft.editions ??= {}; $('actor').value = draft.actor ?? '';
  }
  draft.nativeWorkspaceId = native.workspace.id;
  if (!index.editions[selectedView]) selectedView = Object.keys(index.editions)[0] ?? '';
  renderState(); editorFromDraft(); renderPending();
}
function fillOptions(element, entries, selected) {
  element.replaceChildren(...entries.map(([value, label]) => {
    const option = node('option', label); option.value = value; option.selected = value === selected; return option;
  }));
}
function metaLine(target, label, value) {
  const box = node('div'); box.append(node('strong', label), node('span', value === null || value === undefined ? 'Not supplied' : typeof value === 'object' ? JSON.stringify(value) : String(value)));
  target.append(box);
}
function renderState() {
  const {native, revision, index, historical} = state;
  $('workspace-label').textContent = native.workspace.label + ' · ' + native.workspace.id;
  $('native-link').href = '/#' + token;
  $('revision-mode').textContent = historical ? 'Historical source: inspection and downloads are available. Select current source to save.' : 'Current saved source';
  fillOptions($('revision-select'), [['', 'Current saved source'], ...native.revisions.map(row => [row.id, row.createdAt + ' · ' + row.note])], historical ? revision.id : '');
  $('workspace-summary').replaceChildren();
  metaLine($('workspace-summary'), 'Captured editions', index.document.editions.length);
  metaLine($('workspace-summary'), 'Response observations', Object.keys(index.editions).length);
  metaLine($('workspace-summary'), 'Unique response files', new Set(Object.values(index.editions).map(view => view.sha256)).size);
  metaLine($('workspace-summary'), 'Saved extracts', Object.keys(index.projections).length);
  metaLine($('workspace-summary'), 'External original custody', index.custody.filter(row => row.status === 'external').length);
  const entries = Object.values(index.editions).map(view => [view.id, view.label]);
  fillOptions($('edition-select'), entries, selectedView);
  for (const key of ['compare-left', 'compare-right']) fillOptions($(key), entries, $(key).value || selectedView);
  const bindings = index.document.comparisonBindings.map(row => [row.id, row.reviewer + ' · ' + row.fromFundamentalId + ' → ' + row.toFundamentalId]);
  fillOptions($('compare-binding'), [['', 'Same fundamental ID; no named binding'], ...bindings], $('compare-binding').value);
  if (!$('extract-columns').value) $('extract-columns').value = JSON.stringify(index.document.export.columns, null, 2);
  renderSources(); renderExtracts(); renderHistory();
}
function renderSources() {
  const rows = [];
  for (const view of Object.values(state.index.editions)) {
    const row = node('tr'), title = node('td'), actions = node('td');
    title.append(node('strong', view.label), node('small', view.editionId), node('small', view.sha256));
    if (view.acquisition) title.append(node('small', 'Acquisition: ' + view.acquisition.status + (view.acquisition.requiresPartition ? ' · explicit partition required' : '')));
    actions.append(button('Review', async () => { captureEditor(); await storeDraft(); selectedView = view.id; inspection = null; editorFromDraft(); $('edition-select').value = selectedView; switchTab('review'); await inspectPage(0, true); }),
      button('Original JSON', () => downloadSource(view)));
    row.append(title, node('td', view.operation), node('td', view.source.sourceKind + (view.source.originalWireBytes ? ' · original entity bytes' : ' · precision/capture context retained')),
      node('td', view.bytes.toLocaleString()), actions);
    rows.push(row);
  }
  $('source-rows').replaceChildren(...rows); $('source-empty').hidden = rows.length > 0;
}
async function originalPreview(request, onUpdate) {
  let job = await jsonApi('/api/preview', {revisionId: request.revisionId, function: request.function, input: request.input, operationId: request.operationId});
  request.previewId = job.id;
  activeJob = job;
  if ($('cancel-operation')) { $('cancel-operation').hidden = false; $('cancel-operation').disabled = false; }
  onUpdate?.(job);
  while (!terminal(job)) {
    notice('Original ' + request.function + ' · ' + job.status + ' · ' + job.id);
    await sleep(500);
    job = await jsonApi('/api/preview?id=' + encodeURIComponent(job.id));
    activeJob = job; onUpdate?.(job);
  }
  return job;
}
async function viewPreview(functionName, input, purpose, existing = null) {
  if (!existing) requireFreePending();
  const request = existing ?? {kind: 'preview', purpose, revisionId: state.revision.id, function: functionName,
    input, operationId: freshId(purpose), createdAt: new Date().toISOString()};
  await retainRequest(request);
  const job = await originalPreview(request, result => { if (pending) pending.previewId = result.id; });
  await clearRequest();
  if (job.status !== 'COMPLETED') throw Object.assign(fail(job.error?.code ?? job.status, job.error?.message ?? 'The original preview ended as ' + job.status + '. A new explicit action is required to try again.'), {job});
  return job;
}
function statementInput(offset) {
  return {edition_id: selectedView, offset, limit: 50, search: $('fact-search').value, review_status: $('review-filter').value};
}
async function inspectPage(offset, reset = false, existing = null) {
  if (!selectedView) throw fail('SOURCE_REQUIRED', 'Import and choose a retained response first.');
  captureEditor(); await storeDraft();
  const input = existing?.input ?? statementInput(offset);
  const job = await viewPreview('inspect_statement', input, 'inspect', existing);
  inspection = previewResult(job);
  selectedView = input.edition_id;
  if (reset) inspectOffsets = [];
  renderInspection(); editorFromDraft();
  notice('Opened complete original rows ' + (inspection.page.offset + 1) + '–' + (inspection.page.offset + inspection.page.returned) +
    ' of ' + inspection.page.total + '. Source bytes remain available separately.');
}
function renderInspection() {
  const {snapshot, page, edition} = inspection;
  const value = currentDraft();
  const fundamental = snapshot.fundamental ?? {}, company = snapshot.company ?? {};
  $('statement-context').textContent = [company.name ?? company.id, fundamental.statement_code, fundamental.fiscal_year,
    fundamental.fiscal_period, fundamental.type].filter(value => value !== undefined && value !== null).join(' · ') || edition.label;
  const metadata = $('statement-metadata'); metadata.replaceChildren();
  metaLine(metadata, 'Source class', edition.source.sourceKind);
  metaLine(metadata, 'Fundamental', fundamental.id);
  metaLine(metadata, 'Period start / end', [fundamental.start_date, fundamental.end_date]);
  metaLine(metadata, 'Provider updated', fundamental.updated_date);
  metaLine(metadata, 'Response coverage', snapshot.coverage);
  metaLine(metadata, 'Retained request collection', snapshot.collection_coverage);
  if (edition.acquisition) metaLine(metadata, 'Acquisition findings', edition.acquisition);
  if (snapshot.filing) metaLine(metadata, 'Original filing', snapshot.filing);
  if (snapshot.warnings.length) metaLine(metadata, 'Source observations', snapshot.warnings);
  const rows = [];
  for (const fact of page.rows.filter(row => row.id)) {
    const tr = node('tr'), selectCell = node('td'), identity = node('td'), exact = node('td'), unit = node('td'), reviewCell = node('td'), noteCell = node('td');
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = value.selected.includes(fact.id);
    checkbox.setAttribute('aria-label', 'Select ' + (fact.tag ?? fact.name));
    checkbox.addEventListener('change', () => {
      const set = new Set(value.selected);
      checkbox.checked ? set.add(fact.id) : set.delete(fact.id); value.selected = [...set];
      renderDraftStatus(); scheduleDraft();
    });
    selectCell.append(checkbox);
    identity.append(node('strong', fact.tag ?? fact.tag_id), node('small', fact.name), node('small', fact.source_pointer));
    exact.append(node('span', fact.value === null ? 'null' : typeof fact.value === 'object' ? JSON.stringify(fact.value) : String(fact.value), 'exact'),
      node('small', fact.value_kind));
    unit.append(node('span', fact.unit ?? 'Unit not supplied'), node('small', JSON.stringify(fact.dimensions)));
    const decision = value.decisions[fact.id] ?? {status: 'open', note: ''};
    const control = document.createElement('select');
    const states = state.index.reviews[selectedView].decisions[fact.id] ? [['confirmed','Confirmed'],['question','Question'],['excluded','Excluded']] :
      [['open','Open'],['confirmed','Confirmed'],['question','Question'],['excluded','Excluded']];
    fillOptions(control, states, decision.status);
    const input = document.createElement('textarea'); input.rows = 2; input.maxLength = 10000; input.value = decision.note ?? '';
    input.setAttribute('aria-label', 'Review note for ' + (fact.tag ?? fact.name));
    const changed = () => { value.decisions[fact.id] = {status: control.value, note: input.value}; value.dirty = true; renderDraftStatus(); scheduleDraft(); };
    control.addEventListener('change', changed); input.addEventListener('input', changed);
    reviewCell.append(control); noteCell.append(input); tr.append(selectCell, identity, exact, unit, reviewCell, noteCell); rows.push(tr);
  }
  $('fact-rows').replaceChildren(...rows);
  const catalog = page.rows.filter(row => !row.id);
  $('catalog-result').hidden = !catalog.length;
  $('catalog-result').replaceChildren(...catalog.map(record => {
    const details = node('details'); details.append(node('summary', record.source_pointer), node('pre', JSON.stringify(record.provider_row, null, 2))); return details;
  }));
  $('page-position').textContent = page.total ? (page.offset + 1) + '–' + (page.offset + page.returned) + ' of ' + page.total : 'No rows in this source/filter';
  renderDraftStatus();
}
async function sourceSave(prepared, request) {
  if (prepared.reused) { await clearRequest(); await loadState(null, {keepEditor: false}); return prepared.result; }
  request.saveInput = prepared.input; request.result = prepared.result;
  request.fingerprint = prepared.index.operations[request.command?.operationId ?? request.operationId]?.fingerprint;
  await retainRequest(request);
  await jsonApi('/api/revisions', prepared.input);
  await loadState(null, {keepEditor: false});
  const operationId = request.command?.operationId ?? request.operationId;
  const saved = operationOutcome(state.index, operationId);
  if (!saved || request.fingerprint && saved.fingerprint !== request.fingerprint)
    throw fail('SAVED_OPERATION_READBACK', 'The source save returned, but its exact domain operation has not been read back. Recover this retained request.');
  await clearRequest();
  return saved.result;
}
async function completeDomainRequest(request) {
  writable();
  const command = request.command, existing = operationOutcome(state.index, command.operationId);
  const builders = {review: [reviewValidationInput, saveReviewInput, 'validate_review'],
    selection: [selectionValidationInput, saveSelectionInput, 'validate_selection'],
    binding: [comparisonValidationInput, saveComparisonInput, 'validate_comparison']};
  const [validate, prepare, functionName] = builders[request.kind];
  if (existing) {
    const result = await prepare(state.revision, state.index, command, null);
    await clearRequest(); return result.result;
  }
  if (state.revision.id !== command.expectedHead) throw fail('SOURCE_REVISION_CHANGED', 'The original source changed. The local request is retained; clear its pointer and explicitly rebase your review against current source.');
  const input = validate(state.index, command);
  const job = await originalPreview({revisionId: command.expectedHead, function: functionName, input, operationId: 'validate-' + command.operationId},
    value => { if (pending) pending.previewId = value.id; });
  previewResult(job);
  await loadState(null, {keepEditor: false});
  const prepared = await prepare(state.revision, state.index, command, job);
  return sourceSave(prepared, request);
}
async function saveReview({within = false} = {}) {
  writable(); if (!within) requireFreePending();
  captureEditor(); await storeDraft();
  const value = currentDraft();
  if (!value) throw fail('SOURCE_REQUIRED', 'Choose a retained statement first.');
  const command = {editionId: selectedView, expectedReviewRevision: value.expectedReviewRevision, decisions: clone(value.decisions),
    actor: actor(), title: value.title, notes: value.notes, operationId: freshId('review'), expectedHead: state.revision.id};
  const request = {kind: 'review', command, createdAt: new Date().toISOString()};
  await retainRequest(request);
  const result = await completeDomainRequest(request);
  savedReviewDraft(result.editionId, result.review);
  await storeDraft(); editorFromDraft();
  notice('Named review saved in original source revision ' + state.revision.id + '.');
}
async function freezeExtract() {
  writable(); requireFreePending(); captureEditor();
  let value = currentDraft();
  if (!value?.selected.length) throw fail('SELECTION_REQUIRED', 'Select exact facts across the statement pages first.');
  const rowIds = [...value.selected];
  if (value.dirty) await saveReview();
  value = currentDraft();
  const command = {editionId: selectedView, expectedReviewRevision: state.index.reviews[selectedView].revision, rowIds,
    actor: actor(), title: $('extract-title').value, notes: $('extract-notes').value, columns: JSON.parse($('extract-columns').value),
    operationId: freshId('selection'), expectedHead: state.revision.id};
  const request = {kind: 'selection', command, createdAt: new Date().toISOString()};
  await retainRequest(request);
  const result = await completeDomainRequest(request);
  renderExtracts(); switchTab('extracts');
  notice('Saved exact customer selection ' + result.projectionId + '. Export JSON, CSV or the offline report from this retained record.');
}
async function selectCaptureFiles(manifest) {
  const selected = [...$('response-files').files, ...$('response-folder').files];
  const files = new Map(), known = new Map(state.revision.files.map(file => [file.path, file]));
  for (const row of [...manifest.responses, ...manifest.originals]) {
    if (known.get(row.path)?.sha256 === row.sha256 && known.get(row.path)?.bytes === row.bytes || files.has(row.path)) continue;
    if (row.bytes > FILE_LIMIT) continue;
    const exact = selected.filter(file => file.webkitRelativePath === row.path || file.webkitRelativePath?.endsWith('/' + row.path) || file.name === row.path.split('/').at(-1));
    const candidates = exact.length ? exact : selected.filter(file => file.size === row.bytes);
    for (const file of candidates) {
      if (file.size !== row.bytes || file.size > FILE_LIMIT) continue;
      const raw = new Uint8Array(await file.arrayBuffer());
      if (await sha256(raw) === row.sha256) { files.set(row.path, raw); break; }
    }
  }
  for (const sidecar of manifest.sidecars ?? []) {
    const file = selected.find(file => file.webkitRelativePath === sidecar.path ||
      file.webkitRelativePath?.endsWith('/' + sidecar.path) || file.name === sidecar.path.split('/').at(-1));
    if (file && file.size <= FILE_LIMIT) files.set(sidecar.path, new Uint8Array(await file.arrayBuffer()));
  }
  return files;
}
async function importCapture() {
  writable(); requireFreePending();
  const file = $('manifest-file').files[0];
  if (!file || file.size > FILE_LIMIT) throw fail('SOURCE_MANIFEST', 'Choose the complete acquisition workspace.json within the native file limit.');
  const manifest = await captureManifest(new Uint8Array(await file.arrayBuffer()));
  const files = await selectCaptureFiles(manifest), operationId = freshId('import');
  const prepared = await importCaptureInput(state.revision, state.index, manifest, files,
    {actor: actor(), operationId, expectedHead: state.revision.id, externalCustody: $('external-custody').value.trim() || undefined});
  const result = await sourceSave(prepared, {kind: 'import', operationId, createdAt: new Date().toISOString()});
  $('import-summary').textContent = 'Retained ' + result.editionIds.length + ' complete original response views. Inspect them through the original worker before interpreting their values.';
  notice('Source capture retained. Original bytes and scope were imported; parser inspection is a separate visible operation.');
}
async function download(bytes, name, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([bytes], {type}));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
async function downloadSource(view = state.index.editions[selectedView]) {
  if (!view) throw fail('SOURCE_REQUIRED', 'Choose a retained source first.');
  const file = await jsonApi('/api/file?revision=' + encodeURIComponent(state.revision.id) + '&path=' + encodeURIComponent(view.path));
  const bytes = file.encoding === 'utf8' ? new TextEncoder().encode(file.text) : unbase64(file.base64);
  if (bytes.length !== view.bytes || await sha256(bytes) !== view.sha256) throw fail('SOURCE_DOWNLOAD_IDENTITY', 'The original complete source did not match its saved identity.');
  await download(bytes, view.sha256 + '.json', 'application/json');
}
async function downloadOutput(job, filename) {
  if (job.status !== 'COMPLETED') throw fail('OUTPUT_UNAVAILABLE', 'This original preview has no completed output.');
  const response = await api('/api/preview-output?id=' + encodeURIComponent(job.id));
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length !== job.result.bytes || await sha256(bytes) !== job.result.sha256)
    throw fail('OUTPUT_IDENTITY', 'The completed preview output differs from its saved hash or byte count.');
  await download(bytes, filename, job.result.contentType);
}
function comparisonInput(offset = 0) {
  const input = {left_id: $('compare-left').value, right_id: $('compare-right').value, mode: $('compare-mode').value,
    changes_only: $('changes-only').checked, offset, limit: 50};
  if ($('compare-binding').value) input.binding_id = $('compare-binding').value;
  return input;
}
async function comparePage(offset, reset = false, existing = null) {
  const input = existing?.input ?? comparisonInput(offset);
  const job = await viewPreview('compare_statements', input, 'compare', existing);
  comparison = previewResult(job); if (reset) compareOffsets = [];
  renderComparison();
  notice(comparison.comparison.compatible
    ? 'Opened retained comparison: ' + Object.entries(comparison.comparison.counts).map(([kind,count]) => count + ' ' + kind).join(', ') + '.'
    : 'These retained sources are not comparable: ' + comparison.comparison.reason);
}
function renderComparison() {
  const data = comparison.comparison, metadata = $('comparison-summary'); metadata.replaceChildren();
  metaLine(metadata, 'Compatibility', data.compatible ? 'Exact original scope accepted' : data.reason);
  if (data.compatible) {
    metaLine(metadata, 'Observed groups', data.counts); metaLine(metadata, 'Provider update order', data.chronology);
    metaLine(metadata, 'Original signature', data.signature); metaLine(metadata, 'Named binding', data.binding);
    metaLine(metadata, 'Reference / selected coverage', [data.left.coverage, data.right.coverage]);
  }
  const rows = (comparison.page?.rows ?? []).map(change => {
    const tr = node('tr');
    const exact = items => items.map(row => row.value_kind + ': ' + (typeof row.value === 'object' ? JSON.stringify(row.value) : String(row.value)) + ' ' + (row.unit ?? '[unit not supplied]')).join('\n');
    const label = node('td'); label.append(node('strong', change.tag ?? change.name), node('small', change.name), node('small', JSON.stringify(change.dimensions)));
    tr.append(label, node('td', exact(change.before), 'exact'), node('td', exact(change.after), 'exact'),
      node('td', change.delta.value ?? change.delta.status, 'exact'), node('td', change.status + (change.changed_fields.length ? ' · ' + change.changed_fields.join(', ') : '')));
    return tr;
  });
  $('comparison-rows').replaceChildren(...rows);
  const page = comparison.page;
  $('compare-position').textContent = page ? page.total ? (page.offset + 1) + '–' + (page.offset + page.returned) + ' of ' + page.total : 'No changed groups in this selection' : 'No compatible comparison';
}
async function saveBinding() {
  writable(); requireFreePending();
  const command = {leftId: $('compare-left').value, rightId: $('compare-right').value, mode: $('compare-mode').value,
    actor: actor(), note: $('binding-note').value, operationId: freshId('binding'), expectedHead: state.revision.id};
  const request = {kind: 'binding', command, createdAt: new Date().toISOString()};
  await retainRequest(request);
  const result = await completeDomainRequest(request);
  $('compare-binding').value = result.binding.id;
  notice('Named fundamental comparison saved. Run the selected comparison to inspect its observed changes.');
}
function renderExtracts() {
  const rows = Object.values(state.index.projections).reverse().map(record => {
    const item = node('article', null, 'saved-extract');
    item.append(node('h3', record.title), node('p', record.notes), node('p', record.rowIds.length + ' selected facts · ' + record.actor + ' · ' + record.createdAt),
      node('small', record.id + ' · reviewed source ' + record.validatedRevision));
    const actions = node('div', null, 'actions');
    for (const format of ['json', 'csv', 'html']) actions.append(button('Export ' + format.toUpperCase(), async () => {
      const job = await viewPreview('export_selection_' + format, {projection_id: record.id}, 'export');
      if (format === 'json') previewResult(job);
      await downloadOutput(job, 'intrinio-' + record.id + '.' + format);
      notice('Downloaded the complete saved ' + format.toUpperCase() + ' extract from original preview ' + job.id + '.');
    }));
    item.append(actions); return item;
  });
  $('extract-list').replaceChildren(...rows); $('extract-empty').hidden = rows.length > 0;
}
function renderHistory() {
  $('receiving-commands').textContent = [
    'cd source/stellar/scf-starforge-20261009/sf30-seller-sdk/intrinio',
    'node cli.mjs import-workspace --workspace /private/NEW_REVIEW --bundle /private/ORIGINAL_EXPORT.json',
    'node cli.mjs serve --workspace /private/NEW_REVIEW',
    '', 'Use a new destination. The original import carries saved source, review and preview history.',
  ].join('\n');
  $('history-rows').replaceChildren(...state.native.revisions.map(record => {
    const row = node('tr'), actions = node('td');
    actions.append(button('Open source', async () => { await loadState(record.id); inspection = null; switchTab('sources'); }));
    row.append(node('td', record.createdAt), node('td', record.note), node('td', record.files + ' / ' + record.bytes.toLocaleString()), actions);
    return row;
  }));
  $('operation-rows').replaceChildren(...state.native.previews.map(record => {
    const row = node('tr'), actions = node('td');
    actions.append(button('Saved result', async () => {
      const result = await jsonApi('/api/preview?id=' + encodeURIComponent(record.id));
      $('operation-result').hidden = false; $('operation-result').textContent = JSON.stringify(result, null, 2);
    }));
    if (record.status === 'COMPLETED') actions.append(button('Download output', async () => {
      const result = await jsonApi('/api/preview?id=' + encodeURIComponent(record.id)); await downloadOutput(result, record.id + '.output');
    }));
    row.append(node('td', record.function), node('td', record.status), node('td', record.revisionId), actions); return row;
  }));
}
async function recover() {
  if (!pending) return;
  const request = clone(pending);
  await loadState(null, {keepEditor: true});
  if (request.kind === 'preview') {
    if (request.purpose === 'inspect') { await loadState(request.revisionId, {keepEditor: false}); selectedView = request.input.edition_id; switchTab('review'); await inspectPage(request.input.offset, false, request); }
    else if (request.purpose === 'compare') { await loadState(request.revisionId, {keepEditor: false}); switchTab('compare'); await comparePage(request.input.offset, false, request); }
    else {
      const job = await viewPreview(request.function, request.input, request.purpose, request);
      $('operation-result').hidden = false; $('operation-result').textContent = JSON.stringify(job, null, 2); switchTab('history');
    }
    return;
  }
  const operationId = request.command?.operationId ?? request.operationId;
  const outcome = operationOutcome(state.index, operationId);
  if (outcome && request.fingerprint && outcome.fingerprint !== request.fingerprint) throw fail('RETAINED_REQUEST_CONFLICT', 'The original operation ID has different saved input.');
  if (outcome) {
    await clearRequest();
    if (outcome.kind === 'review') savedReviewDraft(outcome.result.editionId, outcome.result.review);
    await storeDraft(); editorFromDraft();
    notice('Recovered the already-saved original ' + outcome.kind + ' result. No source write or preview was repeated.'); return;
  }
  if (request.saveInput) {
    if (state.revision.id !== request.saveInput.expectedHead) throw fail('SOURCE_REVISION_CHANGED', 'The saved source changed after this request. The exact local request remains available for download; do not overwrite the newer source.');
    await jsonApi('/api/revisions', request.saveInput); await loadState(null, {keepEditor: false});
    const saved = operationOutcome(state.index, operationId);
    if (!saved || saved.fingerprint !== request.fingerprint) throw fail('SAVED_OPERATION_READBACK', 'The exact saved domain result is not yet visible.');
    await clearRequest();
    if (saved.kind === 'review') savedReviewDraft(saved.result.editionId, saved.result.review);
    await storeDraft(); editorFromDraft();
    notice('Recovered the exact source-save outcome.'); return;
  }
  const result = await completeDomainRequest(request);
  if (request.kind === 'review') savedReviewDraft(result.editionId, result.review);
  await storeDraft(); editorFromDraft(); notice('Original retained ' + request.kind + ' request completed.');
}
for (const item of document.querySelectorAll('[data-tab]')) item.addEventListener('click', () => switchTab(item.dataset.tab));
$('actor').addEventListener('input', () => { draft.actor = $('actor').value; scheduleDraft(); });
for (const key of ['review-title','review-notes']) $(key).addEventListener('input', () => { captureEditor(); scheduleDraft(); });
$('edition-select').addEventListener('change', () => run(async () => {
  captureEditor(); await storeDraft(); selectedView = $('edition-select').value; inspection = null; inspectOffsets = [];
  $('fact-rows').replaceChildren(); $('statement-metadata').replaceChildren(); $('catalog-result').replaceChildren(); editorFromDraft();
}));
$('revision-select').addEventListener('change', () => run(async () => { await loadState($('revision-select').value || null); inspection = null; switchTab('sources'); }));
$('refresh').addEventListener('click', () => run(() => loadState(state.historical ? state.revision.id : null)));
$('import').addEventListener('click', () => run(importCapture));
$('inspect').addEventListener('click', () => run(() => inspectPage(0, true)));
$('apply-filter').addEventListener('click', () => run(() => inspectPage(0, true)));
$('source-download').addEventListener('click', () => run(() => downloadSource()));
$('save-review').addEventListener('click', () => run(saveReview));
$('adopt-review').addEventListener('click', () => run(() => reconcileReview(false)));
$('carry-review').addEventListener('click', () => run(() => reconcileReview(true)));
$('download-review-draft').addEventListener('click', () => {
  captureEditor();
  download(new TextEncoder().encode(JSON.stringify({draft,pending},null,2)), 'intrinio-local-review-draft.json', 'application/json');
});
$('freeze-extract').addEventListener('click', () => run(freezeExtract));
$('previous-page').addEventListener('click', () => run(async () => { const offset = inspectOffsets.at(-1); if (offset === undefined) return; await inspectPage(offset); inspectOffsets.pop(); }));
$('next-page').addEventListener('click', () => run(async () => { if (inspection?.page.next_offset === null || !inspection) return; const before = inspection.page.offset; await inspectPage(inspection.page.next_offset); inspectOffsets.push(before); }));
$('select-page').addEventListener('click', () => { if (busy || !inspection) return; const value = currentDraft(); value.selected = [...new Set([...value.selected, ...inspection.page.rows.filter(row => row.id).map(row => row.id)])]; renderInspection(); scheduleDraft(); });
$('clear-selection').addEventListener('click', () => { if (busy || !currentDraft()) return; currentDraft().selected = []; if (inspection) renderInspection(); renderDraftStatus(); scheduleDraft(); });
$('run-compare').addEventListener('click', () => run(() => comparePage(0, true)));
$('save-binding').addEventListener('click', () => run(saveBinding));
$('compare-previous').addEventListener('click', () => run(async () => { const offset = compareOffsets.at(-1); if (offset === undefined) return; await comparePage(offset); compareOffsets.pop(); }));
$('compare-next').addEventListener('click', () => run(async () => { if (!comparison?.page || comparison.page.next_offset === null) return; const before = comparison.page.offset; await comparePage(comparison.page.next_offset); compareOffsets.push(before); }));
$('recover').addEventListener('click', () => run(recover));
$('clear-request').addEventListener('click', () => run(async () => { await clearRequest(); notice('Cleared the local request pointer. Original saved source and native operation history remain unchanged.'); }));
$('download-draft').addEventListener('click', () => download(new TextEncoder().encode(JSON.stringify({draft, pending}, null, 2)), 'intrinio-local-draft.json', 'application/json'));
$('export-workspace').addEventListener('click', () => run(async () => {
  const response = await api('/api/export'), bytes = new Uint8Array(await response.arrayBuffer());
  const filename = /filename="?([^";]+)"?/.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? 'intrinio-original-workspace.json';
  await download(bytes, filename, 'application/json'); notice('Downloaded the complete original private workspace export, including source and native history.');
}));
$('cancel-operation').addEventListener('click', async () => {
  if (!activeJob || terminal(activeJob)) return;
  try { const job = await jsonApi('/api/preview/cancel', {id: activeJob.id}); notice('Original preview ' + job.id + ' · ' + job.status); }
  catch (error) { report(error); }
});
window.addEventListener('beforeunload', event => {
  if (Object.values(draft.editions).some(value => value.dirty) && $('cache-notice').hidden === false) { event.preventDefault(); event.returnValue = ''; }
});
run(async () => {
  if (!token) throw fail('OPERATOR_URL_REQUIRED', 'Open the private operator URL printed by the original CLI to authenticate this workspace.');
  await loadState(null, {keepEditor: false});
  notice('Original workspace opened. Retained source, review and operation history are available.');
});
