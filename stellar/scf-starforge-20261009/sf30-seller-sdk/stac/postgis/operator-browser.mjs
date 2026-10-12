import {parseExactJSON, stringifyExactJSON} from '/exact-json.js';
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const mutations = new Set(['stage', 'promote', 'rollback', 'export-receiving', 'export-backup', 'restore-backup']);
let config, profile, project, review, decisions = new Map(), changePage = 0, historyPage = 0, pending = [], busy = 0;
const pageSize = 100;
const jsonText = value => stringifyExactJSON(value, 2);
const keyOf = row => row.layerId + '\0' + row.rowKey;
const entry = (tag, value, className) => {
  const node = document.createElement(tag);
  if (value !== undefined) node.textContent = String(value);
  if (className) node.className = className;
  return node;
};
function storageKey(name) { return 'postgis:' + config.projectId + ':' + name; }
function restoreLocal(name, fallback) {
  try { return parseExactJSON(localStorage.getItem(storageKey(name)) || 'null') || fallback; } catch { return fallback; }
}
function retainLocal(name, value) {
  try { localStorage.setItem(storageKey(name), stringifyExactJSON(value)); } catch {}
}
function show(name) {
  $$('[data-pane]').forEach(node => { node.hidden = node.dataset.pane !== name; });
  $$('[data-show]').forEach(node => node.classList.toggle('selected', node.dataset.show === name));
}
function status(message) { $('#status').textContent = message || ''; }
function setBusy(change) {
  busy += change;
  $('#busy-label').textContent = busy ? 'Native operation in progress' : 'Ready';
  $$('button').forEach(button => { button.disabled = busy > 0; });
  if (!busy) { renderReviewControls(); renderPending(); }
}
function describeError(error) {
  const labels = {
    POSTGIS_PROJECT_REVISION_CHANGED: 'The active project changed. Refresh and review the current edition.',
    POSTGIS_LIVE_REVIEW_CHANGED: 'Customer rows changed after this review. Review the edition again before publishing.',
    POSTGIS_SOURCE_AND_CUSTOMER_EDIT_CONFLICT: 'Choose a decision for every conflicting customer edit.',
    POSTGIS_RESTORE_EMPTY_DESTINATION_PROJECT_REQUIRED: 'Restore requires an empty selected destination project.',
    POSTGIS_EXISTING_OUTPUT_CONFLICT: 'This path contains a different completed output. Select a new directory for a new operation.',
    POSTGIS_ORIGINAL_DIRECTORY_REQUEST_CONFLICT: 'This directory belongs to another original operation.',
    POSTGIS_EMPTY_NEW_OPERATION_DIRECTORY_REQUIRED: 'Select an empty directory for this new operation.',
    POSTGIS_MAPPING_MUST_RETAIN_ALL_SOURCE_FIELDS: 'The mapping must retain every original source field.',
    POSTGIS_ORIGINAL_OPERATION_REQUEST_CONFLICT: 'This operation identity already belongs to different reviewed inputs.',
    POSTGIS_RECEIVING_LIVE_ROWS_CHANGED: 'Live customer values differ from the accepted receiving observation.',
    POSTGIS_RECEIVING_EDITION_CHANGED: 'The receiving package belongs to a different database edition.',
    POSTGIS_EXPLICIT_COLUMN_CONTRACT_MIGRATION_REQUIRED: 'This mapping changes the published column contract. Use the existing contract for this edition.'
  };
  return labels[error.code] || error.message || String(error);
}
async function api(action, request = {}, selectedProfile = profile) {
  let response;
  try {
    response = await fetch('/api/' + action, {method: 'POST', credentials: 'same-origin',
      headers: {'content-type': 'application/json'}, body: stringifyExactJSON({request, profile: selectedProfile})});
  } catch {
    throw {code: 'RESPONSE_NOT_RECEIVED', message: 'The original response was not received. Continue the retained original request from Operations.'};
  }
  const result = parseExactJSON(await response.text());
  if (!response.ok || !result.ok) throw result.error || {message: 'The native operation did not return a result.'};
  return result.result;
}
function nativeRequest(action, request) {
  return {action, request: {...request, operationId: request.operationId || 'operator-' + crypto.randomUUID()},
    profile: parseExactJSON(stringifyExactJSON(profile)), createdAt: new Date().toISOString()};
}
async function perform(action, request, original = null) {
  const retained = mutations.has(action) ? original || nativeRequest(action, request) : null;
  if (retained && !pending.some(item => item.request.operationId === retained.request.operationId)) {
    pending.push(retained); retainLocal('pending', pending); renderPending();
  }
  setBusy(1); status('');
  try {
    const result = await api(action, retained ? retained.request : request, retained ? retained.profile : profile);
    if (retained) {
      pending = pending.filter(item => item.request.operationId !== retained.request.operationId);
      retainLocal('pending', pending); renderPending();
    }
    return result;
  } catch (error) {
    status(describeError(error));
    throw error;
  } finally { setBusy(-1); }
}
async function guarded(fn) {
  try { await fn(); } catch (error) { if (!$('#status').textContent) status(describeError(error)); }
}
function replaceRows(selector, rows) {
  const body = $(selector); body.replaceChildren(...rows);
  if (!rows.length) {
    const tr = entry('tr'), td = entry('td', 'No rows to display.');
    td.colSpan = body.closest('table').querySelectorAll('thead th').length; tr.append(td); body.append(tr);
  }
}
function tableRow(values) { const row = entry('tr'); values.forEach(value => row.append(entry('td', value ?? '—'))); return row; }
function renderProject() {
  $('#project-label').textContent = [config.projectId, project.database.name, project.database.schema].join(' / ');
  const facts = [
    ['Active edition', project.activeEditionId || 'No accepted edition'],
    ['Revision', project.revision || 0], ['Updated', project.updatedAt || 'Not initialized'],
    ['Database profile', project.database.profileId], ['PostgreSQL', project.database.postgresVersion],
    ['PostGIS', project.database.postgisVersion]
  ];
  $('#facts').replaceChildren(...facts.map(([label, value]) => {
    const node = entry('div'); node.append(entry('dt', label), entry('dd', value)); return node;
  }));
  replaceRows('#layers', (project.layers || []).map(layer => tableRow([
    layer.title, layer.schema + '.' + layer.relation, layer.geometryType + ' / ' + layer.dimension + 'D',
    'EPSG:' + layer.srid, layer.rowCount,
    layer.roles.map(role => role.name + ' (' + role.visibleRows + ' visible)').join('\n')
  ])));
  replaceRows('#editions', (project.editions || []).map(edition =>
    tableRow([edition.edition_id, edition.state, edition.created_at, edition.accepted_at])));
  for (const [selector, state] of [['#review-edition', 'staged'], ['#rollback-edition', 'accepted']]) {
    const select = $(selector), selected = select.value;
    const editions = (project.editions || []).filter(edition => edition.state === state &&
      (state !== 'accepted' || edition.edition_id !== project.activeEditionId));
    select.replaceChildren(...editions.map(edition => {
      const option = entry('option', edition.edition_id); option.value = edition.edition_id; return option;
    }));
    if (editions.some(edition => edition.edition_id === selected)) select.value = selected;
  }
}
async function refreshProject() {
  project = await api('inspect'); renderProject();
}
function renderReviewControls() {
  const conflicts = review ? review.changes.filter(row => row.conflict && !decisions.has(keyOf(row))).length : 0;
  $('#publish').disabled = busy > 0 || !review || conflicts > 0;
  $('#previous-page').disabled = busy > 0 || changePage === 0;
  $('#next-page').disabled = busy > 0 || !review || (changePage + 1) * pageSize >= review.changes.length;
  $('#review-page').textContent = review ? Math.min(changePage * pageSize + 1, review.changes.length) + '–' +
    Math.min((changePage + 1) * pageSize, review.changes.length) + ' of ' + review.changes.length + ' changes' : '';
  $('#review-identity').textContent = review ? 'Revision ' + review.expectedRevision +
    ' / ' + conflicts + ' unresolved conflicts' : '';
}
function renderChanges() {
  replaceRows('#changes', (review?.changes || []).slice(changePage * pageSize, (changePage + 1) * pageSize).map(change => {
    const tr = entry('tr');
    tr.append(entry('td', change.layerId + '\n' + change.rowKey),
      entry('td', change.sourceDisposition + (change.sourceChanged ? ' / changed' : ' / unchanged')),
      entry('td', change.liveDisposition + (change.conflict ? ' / conflict' : change.localChanged ? ' / changed' : '')));
    const cell = entry('td'), select = entry('select');
    for (const [value, label] of [['', 'Choose a decision'], ['take-source', 'Use incoming source'], ['keep-current', 'Keep customer values']]) {
      const option = entry('option', label); option.value = value; select.append(option);
    }
    select.value = decisions.get(keyOf(change)) || change.suggestedDecision || '';
    select.addEventListener('change', () => {
      if (select.value) decisions.set(keyOf(change), select.value); else decisions.delete(keyOf(change));
      renderReviewControls();
    });
    cell.append(select); tr.append(cell);
    const detail = entry('td'), button = entry('button', 'Compare values'); button.type = 'button';
    button.addEventListener('click', () => guarded(async () => {
      const result = await perform('row', {editionId: review.editionId, layerId: change.layerId, rowKey: change.rowKey});
      const pretty = row => row ? 'Attributes\n' + row.attributesJSON + '\n\nGeometry\n' +
        (row.geometryJSON || 'null') + '\n\nRow SHA-256\n' + row.rowHash : 'Row absent';
      $('#row-label').textContent = change.layerId + ' / ' + change.rowKey + ' / current revision ' + result.currentRevision;
      $('#row-before').textContent = pretty(result.comparison.previousBaseline);
      $('#row-current').textContent = pretty(result.comparison.customerCurrent);
      $('#row-incoming').textContent = pretty(result.comparison.incoming);
      $('#row-comparison').hidden = false;
    }));
    detail.append(button); tr.append(detail); return tr;
  }));
  renderReviewControls();
}
function renderPending() {
  $('#pending-panel').hidden = pending.length === 0;
  const selected = $('#pending-select').value;
  $('#pending-select').replaceChildren(...pending.map(item => {
    const option = entry('option', item.action + ' / ' + item.request.operationId);
    option.value = item.request.operationId; return option;
  }));
  if (pending.some(item => item.request.operationId === selected)) $('#pending-select').value = selected;
  const current = pending.find(item => item.request.operationId === $('#pending-select').value) || pending[0];
  $('#pending-label').textContent = pending.length + ' original response' + (pending.length === 1 ? '' : 's') + ' awaiting reconciliation.';
  $('#pending-detail').textContent = current ? jsonText(current) : '';
  $('#retry').disabled = busy > 0 || !current;
}
async function refreshHistory() {
  const result = await api('history', {limit: 100, offset: historyPage * 100});
  for (const original of result.unfinishedRequests || []) {
    if (!pending.some(item => item.request.operationId === original.request.operationId)) pending.push(original);
  }
  retainLocal('pending', pending); renderPending();
  replaceRows('#operations', result.operations.map(operation => {
    const tr = tableRow([operation.committedAt, operation.operationId, operation.kind]);
    const cell = entry('td'), button = entry('button', 'Open original'); button.type = 'button';
    button.addEventListener('click', () => { $('#operation-detail').textContent = jsonText(operation); });
    cell.append(button); tr.append(cell); return tr;
  }));
  $('#history-page').textContent = Math.min(historyPage * 100 + 1, Number(result.total)) + '–' +
    Math.min((historyPage + 1) * 100, Number(result.total)) + ' of ' + result.total + ' operations';
  $('#history-previous').disabled = historyPage === 0;
  $('#history-next').disabled = BigInt((historyPage + 1) * 100) >= BigInt(result.total);
}
$$('[data-show]').forEach(button => button.addEventListener('click', () => guarded(async () => {
  show(button.dataset.show); if (button.dataset.show === 'history') await refreshHistory();
})));
$('#refresh').addEventListener('click', () => guarded(refreshProject));
$('#apply-profile').addEventListener('click', () => guarded(async () => {
  const selected = parseExactJSON($('#profile-json').value);
  const inspected = await api('inspect', {}, selected);
  profile = selected; project = inspected; retainLocal('profile', profile); renderProject();
  status('Mapping selected for subsequent original requests.');
}));
$('#source-form').addEventListener('submit', event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget), action = event.submitter.value;
  const request = {sourceDirectory: form.get('sourceDirectory').trim(), expectedManifestSha256: form.get('expectedManifestSha256').trim()};
  guarded(async () => {
    const result = await perform(action === 'stage' ? 'stage' : 'source-inspect', request);
    $('#source-detail').textContent = jsonText(result);
    if (action === 'stage') {
      await refreshProject(); $('#review-edition').value = result.editionId;
      status('The complete source is staged as ' + result.editionId + '.'); show('review');
    } else {
      $('#source-summary').textContent = result.manifest.counts.sourceFeatures + ' original features / ' +
        result.manifest.counts.nativeLayers + ' native layers / source edition ' + result.manifest.sourceEdition;
      status('Original source and native export inspected.');
    }
  });
});
$('#review-form').addEventListener('submit', event => {
  event.preventDefault();
  guarded(async () => {
    const next = await perform('review', {editionId: $('#review-edition').value});
    if (review?.reviewSha256 !== next.reviewSha256) decisions = new Map();
    review = next; changePage = 0; $('#row-comparison').hidden = true;
    $('#review-summary').textContent = review.summaries.map(row => row.layerId + ': ' + row.sourceAdded + ' added, ' +
      row.sourceChanged + ' changed, ' + row.sourceRemoved + ' removed, ' + row.localChanged +
      ' customer edits, ' + row.conflicts + ' conflicts.').join('\n');
    renderChanges(); status('Review loaded from the current native rows.');
  });
});
$('#publish').addEventListener('click', () => guarded(async () => {
  const reviewed = review;
  const selected = [...decisions].map(([key, choice]) => {
    const split = key.indexOf('\0'); return {layerId: key.slice(0, split), rowKey: key.slice(split + 1), choice};
  });
  const result = await perform('promote', {editionId: reviewed.editionId, expectedRevision: reviewed.expectedRevision,
    reviewSha256: reviewed.reviewSha256, decisions: selected});
  review = null; decisions = new Map(); renderChanges(); await refreshProject();
  status('Published ' + result.editionId + ' at revision ' + result.revision + '.'); show('overview');
}));
$('#rollback-form').addEventListener('submit', event => {
  event.preventDefault();
  guarded(async () => {
    const result = await perform('rollback', {editionId: $('#rollback-edition').value, expectedRevision: project.revision});
    review = null; decisions = new Map(); renderChanges(); await refreshProject();
    status('Retained edition selected at revision ' + result.revision + '.'); show('overview');
  });
});
for (const [selector, action] of [['#receiving-form', 'export-receiving'], ['#backup-form', 'export-backup'], ['#restore-form', 'restore-backup']]) {
  $(selector).addEventListener('submit', event => {
    event.preventDefault(); const values = new FormData(event.currentTarget);
    const request = {directory: values.get('directory').trim()};
    if (values.has('expectedManifestSha256')) request.expectedManifestSha256 = values.get('expectedManifestSha256').trim();
    guarded(async () => {
      const result = await perform(action, request); $('#recovery-result').textContent = jsonText(result);
      await refreshProject(); status('Original ' + action + ' operation completed.');
    });
  });
}
$('#previous-page').addEventListener('click', () => { changePage--; renderChanges(); });
$('#next-page').addEventListener('click', () => { changePage++; renderChanges(); });
$('#history-previous').addEventListener('click', () => guarded(async () => { historyPage--; await refreshHistory(); }));
$('#history-next').addEventListener('click', () => guarded(async () => { historyPage++; await refreshHistory(); }));
$('#pending-select').addEventListener('change', renderPending);
$('#retry').addEventListener('click', () => guarded(async () => {
  const original = pending.find(item => item.request.operationId === $('#pending-select').value) || pending[0];
  const result = await perform(original.action, original.request, original);
  $('#operation-detail').textContent = jsonText(result);
  await refreshProject(); await refreshHistory(); status('Original operation reconciled.');
}));
await guarded(async () => {
  const response = await fetch('/api/config', {credentials: 'same-origin'});
  if (!response.ok) throw {message: 'Open the private operator address again to establish its session.'};
  config = parseExactJSON(await response.text()); profile = restoreLocal('profile', config.profile); pending = restoreLocal('pending', []);
  $('#profile-json').value = jsonText(profile); renderPending(); await refreshProject(); await refreshHistory();
});
