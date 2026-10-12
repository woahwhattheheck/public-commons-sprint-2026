'use strict';
const $ = id => document.getElementById(id);
const json = value => JSON.stringify(value, null, 2);
const short = value => value ? value.slice(0, 12) : '—';
const date = value => value ? new Date(value).toLocaleString() : '—';
const node = (tag, text, className) => {
  const result = document.createElement(tag); if (text !== undefined) result.textContent = text;
  if (className) result.className = className; return result;
};
const button = (label, action, className) => {
  const result = node('button', label, className); result.type = 'button';
  result.addEventListener('click', () => run(result, action)); return result;
};
let capability = location.hash.slice(1);
try {
  if (capability) sessionStorage.setItem('snowflake-workspace-key', capability);
  else capability = sessionStorage.getItem('snowflake-workspace-key') ?? '';
} catch {}
if (location.hash) history.replaceState(null, '', location.pathname);
let state, draft, editingQuery = '', dirty = false, selectedEdition = null, lastComparison = null, activeTab = 'source';
let rowsOffset = 0, rowsNext = null, refreshBusy = false, retainedPublication = null;
const pages = Object.fromEntries(['operations', 'editions', 'publications'].map(kind => [kind, { offset: 0, next: null, items: [] }]));
function notify(text, error = false) { $('notice').textContent = text; $('notice').className = error ? 'error' : ''; }
async function api(path, { method = 'GET', value, raw } = {}) {
  const response = await fetch(path, { method, headers: { 'x-snowflake-workspace': capability,
    ...(value !== undefined ? { 'content-type': 'application/json' } : {}),
    ...(raw !== undefined ? { 'content-type': 'application/octet-stream' } : {}) },
    ...(value !== undefined ? { body: JSON.stringify(value) } : raw !== undefined ? { body: raw } : {}) });
  const content = await response.json();
  if (!response.ok) throw Object.assign(new Error((content.detail || content.error || 'Operation failed') + ' [' + response.status + ']'), { code: content.error });
  return content;
}
async function run(control, action) {
  if (control) control.disabled = true;
  try { return await action(); }
  catch (error) { notify(error.message, true); }
  finally { if (control) control.disabled = false; }
}
function form(id, action) {
  $(id).addEventListener('submit', event => { event.preventDefault(); run(event.submitter, action); });
}
function selectTab(name) {
  activeTab = name;
  document.querySelectorAll('[data-panel]').forEach(panel => { panel.hidden = panel.dataset.panel !== name; });
  document.querySelectorAll('[data-tab]').forEach(tab => {
    if (tab.dataset.tab === name) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current');
  });
  if (pages[name]) run(null, () => loadList(name));
  if (name === 'merchant') run(null, () => loadList('publications'));
}
document.querySelectorAll('[data-tab]').forEach(tab => tab.addEventListener('click', () => selectTab(tab.dataset.tab)));
function replaceOptions(select, entries, selected) {
  select.replaceChildren(...entries.map(([value, label]) => {
    const option = node('option', label); option.value = value; return option;
  }));
  if (entries.some(([value]) => value === selected)) select.value = selected;
}
function blankQuery() { return { sql: '', columns: [], parameters: {}, keyColumns: [], maxRows: 250000,
  maxResultBytes: 268435456, timeoutSeconds: 300, description: '' }; }
function blankSource() { return { schema: 'stellar-forge.snowflake-source.v1', label: 'Snowflake data',
  accountUrlEnv: 'SF30_SNOWFLAKE_ACCOUNT', tokenEnv: 'SF30_SNOWFLAKE_TOKEN', tokenType: 'OAUTH',
  context: { warehouse: '', database: '', schema: '', role: '' }, queries: {},
  requestTimeoutMs: 30000, maxPartitionBytes: 33554432, pollIntervalMs: 1000 }; }
function setDraft(config) {
  draft = structuredClone(config); dirty = false;
  $('source-label').value = draft.label; $('account-env').value = draft.accountUrlEnv;
  $('token-env').value = draft.tokenEnv; $('token-type').value = draft.tokenType;
  for (const name of ['warehouse', 'database', 'schema', 'role']) $('context-' + name).value = draft.context[name];
  $('partition-bytes').value = draft.maxPartitionBytes ?? 33554432;
  $('request-timeout').value = draft.requestTimeoutMs ?? 30000;
  $('poll-interval').value = draft.pollIntervalMs ?? 1000;
  refreshQuerySelector(Object.keys(draft.queries)[0] ?? '');
  $('source-json').value = json(draft); $('draft-status').textContent = 'Draft matches the selected source.';
}
function refreshQuerySelector(name) {
  replaceOptions($('query-editor-select'), [...Object.keys(draft.queries).map(key => [key, key]), ['', 'New query']], name);
  loadQuery(name);
}
function loadQuery(name) {
  editingQuery = name; const query = draft.queries[name] ?? blankQuery();
  $('query-name').value = name; $('query-sql').value = query.sql;
  $('query-columns').value = query.columns.join('\n'); $('query-keys').value = (query.keyColumns ?? []).join('\n');
  $('query-parameters').value = json(query.parameters ?? {}); $('query-order').value = query.parameterOrder ? JSON.stringify(query.parameterOrder) : '';
  $('query-description').value = query.description ?? ''; $('query-max-rows').value = query.maxRows ?? 250000;
  $('query-max-bytes').value = query.maxResultBytes ?? 268435456; $('query-timeout').value = query.timeoutSeconds ?? 300;
}
function captureDraftQuery() {
  const name = $('query-name').value;
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name)) throw new Error('Give the query a name using letters, digits and underscores.');
  if (name !== editingQuery && Object.hasOwn(draft.queries, name)) throw new Error('A query with this name already exists.');
  const lines = id => $(id).value.split(/\r?\n/).filter(value => value.length > 0);
  const query = { ...draft.queries[editingQuery], sql: $('query-sql').value, columns: lines('query-columns'),
    keyColumns: lines('query-keys'), parameters: JSON.parse($('query-parameters').value),
    description: $('query-description').value, maxRows: Number($('query-max-rows').value),
    maxResultBytes: Number($('query-max-bytes').value), timeoutSeconds: Number($('query-timeout').value) };
  if ($('query-order').value.trim()) query.parameterOrder = JSON.parse($('query-order').value);
  else delete query.parameterOrder;
  if (editingQuery && editingQuery !== name) delete draft.queries[editingQuery];
  draft.queries[name] = query; editingQuery = name;
  replaceOptions($('query-editor-select'), [...Object.keys(draft.queries).map(key => [key, key]), ['', 'New query']], name);
}
function captureDraft() {
  captureDraftQuery();
  draft.label = $('source-label').value; draft.accountUrlEnv = $('account-env').value;
  draft.tokenEnv = $('token-env').value; draft.tokenType = $('token-type').value;
  for (const name of ['warehouse', 'database', 'schema', 'role']) draft.context[name] = $('context-' + name).value;
  draft.maxPartitionBytes = Number($('partition-bytes').value);
  draft.requestTimeoutMs = Number($('request-timeout').value); draft.pollIntervalMs = Number($('poll-interval').value);
  return draft;
}
$('source-form').addEventListener('input', () => { dirty = true; $('draft-status').textContent = 'Unsaved source changes.'; });
$('query-editor-select').addEventListener('change', () => run(null, () => {
  const next = $('query-editor-select').value;
  if ($('query-name').value && $('query-sql').value) captureDraftQuery();
  refreshQuerySelector(next);
}));
$('new-query').addEventListener('click', () => { refreshQuerySelector(''); $('query-name').focus(); });
$('remove-query').addEventListener('click', () => {
  if (editingQuery) delete draft.queries[editingQuery]; dirty = true;
  refreshQuerySelector(Object.keys(draft.queries)[0] ?? ''); $('draft-status').textContent = 'Query removed from the unsaved draft.';
});
$('apply-query').addEventListener('click', () => run($('apply-query'), () => {
  captureDraftQuery(); dirty = true; $('draft-status').textContent = 'Query kept in the draft. Save source to use it.';
}));
$('reload-source').addEventListener('click', () => setDraft(state?.source?.config ?? blankSource()));
$('show-source-json').addEventListener('click', () => run(null, () => { $('source-json').value = json(captureDraft()); }));
$('load-source-json').addEventListener('click', () => run(null, () => {
  const value = JSON.parse($('source-json').value);
  if (value.schema !== 'stellar-forge.snowflake-source.v1' || !value.context || !value.queries) throw new Error('Choose a Snowflake source configuration.');
  setDraft(value); dirty = true; $('draft-status').textContent = 'JSON loaded into the draft. Save source to use it.';
}));
form('source-form', async () => {
  const config = captureDraft();
  const selectedSource = state.source?.id ?? null;
  try { await api('/api/source', { method: 'POST', value: { config, expectedRevision: state.revision } }); }
  catch (error) {
    if (error.code !== 'SNOWFLAKE_WORKSPACE_CHANGED') throw error;
    await refresh();
    if ((state.source?.id ?? null) !== selectedSource)
      throw new Error('The selected source changed in another session. Reload the saved source before replacing it.');
    await api('/api/source', { method: 'POST', value: { config, expectedRevision: state.revision } });
  }
  await refresh(); setDraft(state.source.config); notify('Source saved. Its named queries are ready for capture.');
});
function captureFields() {
  const query = state?.source?.config.queries[$('capture-query').value];
  $('capture-parameters').replaceChildren();
  if (!query) return;
  for (const [name, spec] of Object.entries(query.parameters ?? {})) {
    const row = node('div', undefined, 'parameter-row'), label = node('label', name), presence = node('select', undefined, 'presence');
    presence.setAttribute('aria-label', name + ' input mode');
    const modes = [['value', 'Value'], ...(spec.nullable ? [['null', 'SQL null']] : []), ['omit', 'Omit / default']];
    replaceOptions(presence, modes, Object.hasOwn(spec, 'default') ? 'omit' : 'value');
    let input;
    if (Array.isArray(spec.enum)) {
      input = node('select'); replaceOptions(input, spec.enum.map(value => [JSON.stringify(value), String(value)]));
      input.dataset.enum = 'true';
    } else if (spec.type === 'boolean') { input = node('select'); replaceOptions(input, [['true', 'true'], ['false', 'false']]); }
    else { input = node('input'); input.type = 'text'; if (spec.type !== 'string') input.inputMode = spec.type === 'integer' ? 'numeric' : 'decimal'; }
    input.dataset.name = name; input.dataset.type = spec.type; input.classList.add('parameter-value');
    if (spec.default !== undefined && spec.default !== null) input.value = spec.enum ? JSON.stringify(spec.default) : String(spec.default);
    if (spec.type === 'decimal') input.placeholder = 'Exact decimal string';
    const hint = node('span', spec.type + (spec.type === 'decimal' ? ' · precision ' + spec.precision + ', scale ' + spec.scale : ''), 'parameter-help');
    label.append(input, hint); row.append(label, presence); $('capture-parameters').append(row);
    presence.addEventListener('change', () => { input.disabled = presence.value !== 'value'; });
    input.disabled = presence.value !== 'value';
  }
}
function captureArguments() {
  const result = {};
  for (const row of $('capture-parameters').children) {
    const input = row.querySelector('.parameter-value'), mode = row.querySelector('.presence').value;
    if (mode === 'omit') continue;
    let value = mode === 'null' ? null : input.value;
    if (mode === 'value') {
      if (input.dataset.enum) value = JSON.parse(value);
      else if (input.dataset.type === 'boolean') value = value === 'true';
      else if (['integer', 'number'].includes(input.dataset.type)) {
        if (!value.trim()) throw new Error('Enter ' + input.dataset.name + ' or select Omit / default.');
        value = Number(value);
        if (!Number.isFinite(value) || input.dataset.type === 'integer' && !Number.isSafeInteger(value))
          throw new Error('Use an exact valid ' + input.dataset.type + ' for ' + input.dataset.name + '.');
      }
    }
    result[input.dataset.name] = value;
  }
  return result;
}
$('capture-query').addEventListener('change', captureFields);
$('capture-request-id').value = crypto.randomUUID();
form('capture-form', async () => {
  if (!state.source) throw new Error('Save the source configuration first.');
  const result = await api('/api/captures', { method: 'POST', value: { sourceId: state.source.id,
    queryName: $('capture-query').value, arguments: captureArguments(), requestId: $('capture-request-id').value } });
  $('capture-request-id').value = crypto.randomUUID();
  notify('Original capture ' + result.id + ' is retained. Follow its progress in Operations.');
  selectTab('operations'); await refresh();
});
form('receive-path-form', async () => {
  const result = await api('/api/receive', { method: 'POST', value: { manifestPath: $('receive-path').value } });
  notify('Original statement received: ' + result.status + '.'); await refresh();
  if (result.editionId) { selectTab('editions'); await openEdition(result.editionId); }
});
form('upload-form', async () => {
  const chosen = [...$('receiving-files').files], manifests = chosen.filter(file => file.name === 'receiving.json');
  if (manifests.length !== 1) throw new Error('Select one complete export folder containing one receiving.json.');
  const selected = manifests[0];
  if (selected.size > 2097152) throw new Error('The receiving manifest exceeds 2 MiB.');
  const manifest = JSON.parse(await selected.text()), fullPath = selected.webkitRelativePath || selected.name;
  const prefix = fullPath.slice(0, fullPath.length - selected.name);
  const available = new Map(chosen.map(file => [file.webkitRelativePath || file.name, file]));
  let transfer = await api('/api/transfers', { method: 'POST', value: { manifest } });
  for (const part of transfer.partitions) {
    if (part.received) continue;
    const file = available.get(prefix + part.path);
    if (!file || file.size !== part.bytes) throw new Error('Select the exact complete file ' + part.path + '.');
    $('receiving-progress').textContent = 'Receiving partition ' + (part.partition + 1) + ' of ' + transfer.partitions.length + '…';
    transfer = await api('/api/transfers/' + transfer.id + '/partitions/' + part.partition, { method: 'PUT', raw: file });
  }
  $('receiving-progress').textContent = 'Reopening the complete original result…';
  const result = await api('/api/transfers/' + transfer.id + '/commit', { method: 'POST', value: {} });
  $('receiving-progress').textContent = result.received + ' original partitions received. ' + result.status + '.';
  await refresh(); if (result.editionId) { selectTab('editions'); await openEdition(result.editionId); }
});
function table(container, columns, values, empty = 'No retained items yet.') {
  container.replaceChildren();
  if (!values.length) { container.append(node('p', empty, 'empty')); return; }
  const grid = node('table'), head = node('thead'), row = node('tr'), body = node('tbody');
  for (const column of columns) row.append(node('th', column.label));
  head.append(row); grid.append(head, body);
  for (const value of values) {
    const tr = node('tr');
    for (const column of columns) {
      const td = node('td', undefined, column.className), content = column.value(value);
      if (content instanceof Node) td.append(content);
      else if (content === null) { td.textContent = 'NULL'; td.classList.add('null'); }
      else td.textContent = content === '' ? '""' : String(content ?? '—');
      tr.append(td);
    }
    body.append(tr);
  }
  container.append(grid);
}
async function loadList(kind) {
  const page = pages[kind], result = await api('/api/' + kind + '?offset=' + page.offset + '&limit=50');
  page.items = result.items; page.next = result.nextOffset;
  $(kind + '-prev').disabled = page.offset === 0; $(kind + '-next').disabled = page.next === null;
  $(kind + '-page').textContent = result.items.length ? (page.offset + 1) + '–' + (page.offset + result.items.length) : 'No items';
  const when = { label: 'Retained', value: item => date(item.createdAt) };
  if (kind === 'operations') {
    table($('operations-table'), [when, { label: 'Query', value: item => item.queryName },
      { label: 'Original request', value: item => button(short(item.id), () => showOperation(item.id), 'link mono') },
      { label: 'State', value: item => node('span', item.status, 'badge') },
      { label: 'Actions', value: item => {
        const group = node('div', undefined, 'actions');
        if (item.editionId) group.append(button('Open edition', () => { selectTab('editions'); return openEdition(item.editionId); }));
        if (!['COMPLETE', 'CANCELLED', 'FAILED', 'REJECTED'].includes(item.status)) {
          group.append(button('Resume', async () => { await api('/api/operations/' + item.id + '/resume', { method: 'POST', value: {} }); await refresh(); }));
          group.append(button('Cancel statement', async () => { const result = await api('/api/operations/' + item.id + '/cancel', { method: 'POST', value: {} }); notify('Original statement: ' + result.status + '.'); await refresh(); }));
        }
        return group;
      } }], result.items);
  } else if (kind === 'editions') {
    table($('editions-table'), [when, { label: 'Query', value: item => item.queryName },
      { label: 'Edition', value: item => button(short(item.id), () => openEdition(item.id), 'link mono') },
      { label: 'Rows', value: item => item.rowCount.toLocaleString() },
      { label: 'Partitions', value: item => item.partitionCount },
      { label: 'Original statement', value: item => node('span', item.statementHandle, 'mono') }], result.items);
    updateComparisonOptions();
  } else {
    table($('publications-table'), [when, { label: 'Edition', value: item => short(item.editionId) },
      { label: 'Status', value: item => item.status },
      { label: 'Release', value: item => item.releaseId ?? 'Preparing' },
      { label: 'Actions', value: item => {
        const group = node('div', undefined, 'actions');
        group.append(button('Open publication', () => openPublication(item.id)),
          button('Inspect', async () => dialog('Original merchant publication', await api('/api/publications/' + item.id))));
        return group;
      } }], result.items);
  }
}
for (const kind of Object.keys(pages)) {
  $(kind + '-prev').addEventListener('click', () => run(null, async () => { pages[kind].offset = Math.max(0, pages[kind].offset - 50); await loadList(kind); }));
  $(kind + '-next').addEventListener('click', () => run(null, async () => { if (pages[kind].next !== null) { pages[kind].offset = pages[kind].next; await loadList(kind); } }));
}
function dialog(title, value, extra) {
  $('dialog-title').textContent = title; $('dialog-content').replaceChildren();
  if (extra) $('dialog-content').append(extra);
  if (value !== undefined) $('dialog-content').append(node('pre', json(value)));
  $('detail-dialog').showModal();
}
$('dialog-close').addEventListener('click', () => $('detail-dialog').close());
async function showOperation(id) {
  const [operation, observations] = await Promise.all([api('/api/operations/' + id), api('/api/operations/' + id + '/observations?limit=50')]);
  const content = node('div'), history = node('div');
  content.append(node('h3', 'Original request and retained result'), node('pre', json(operation)),
    node('h3', 'Provider observations'), history);
  const show = value => history.append(node('pre', json(value)));
  show(observations.items); let next = observations.nextOffset;
  const more = button('Load more observations', async () => {
    const result = await api('/api/operations/' + id + '/observations?offset=' + next + '&limit=50');
    show(result.items); next = result.nextOffset; more.hidden = next === null;
  });
  more.hidden = next === null; content.append(more);
  dialog('Original capture ' + short(id), undefined, content);
}
async function showRows() {
  if (!selectedEdition) return;
  const result = await api('/api/editions/' + selectedEdition.id + '/rows?offset=' + rowsOffset + '&limit=50');
  rowsNext = result.nextOffset;
  table($('edition-rows'), result.columns.map(column => ({ label: column.name + ' · ' + column.type,
    value: row => row[column.name] })), result.rows, 'The original result is complete and contains zero rows.');
  $('rows-prev').disabled = rowsOffset === 0; $('rows-next').disabled = rowsNext === null;
  $('rows-page').textContent = result.rows.length ? (rowsOffset + 1) + '–' + (rowsOffset + result.rows.length) + ' of ' + result.total.toLocaleString() : '0 rows';
}
async function openEdition(id) {
  const previousId = selectedEdition?.id;
  selectedEdition = await api('/api/editions/' + id);
  if (previousId !== id) { rowsOffset = 0; lastComparison = null; $('comparison-result').replaceChildren(); }
  $('edition-detail').hidden = false; $('edition-title').textContent = selectedEdition.queryName + ' · ' + short(id);
  $('edition-summary').textContent = selectedEdition.rowCount.toLocaleString() + ' rows · ' + selectedEdition.partitionCount +
    ' original partitions · retained ' + date(selectedEdition.createdAt);
  const review = selectedEdition.review;
  $('latest-review').textContent = review ? review.decision + ' by ' + review.actor + ' · ' + review.note : 'This edition has no recorded review.';
  $('merchant-edition').textContent = selectedEdition.queryName + ' / ' + id + (review ? ' · ' + review.decision : ' · Review required');
  updateComparisonOptions(); await showRows();
  if (previousId !== id) merchantTemplate();
}
function updateComparisonOptions() {
  const selected = $('compare-before').value;
  replaceOptions($('compare-before'), pages.editions.items.filter(item => item.id !== selectedEdition?.id)
    .map(item => [item.id, item.queryName + ' · ' + date(item.createdAt) + ' · ' + short(item.id)]), selected);
}
$('rows-prev').addEventListener('click', () => run(null, async () => { rowsOffset = Math.max(0, rowsOffset - 50); await showRows(); }));
$('rows-next').addEventListener('click', () => run(null, async () => { if (rowsNext !== null) { rowsOffset = rowsNext; await showRows(); } }));
form('compare-form', async () => {
  if (!selectedEdition) throw new Error('Select an edition first.');
  const beforeId = $('compare-before').value;
  const result = await api('/api/compare', { method: 'POST', value: { beforeId, afterId: selectedEdition.id } });
  lastComparison = beforeId;
  const box = $('comparison-result'); box.replaceChildren(node('p', result.mode + (result.schema.changed ? ' · Column metadata changed' : '')));
  if (result.counts) {
    const stats = node('div', undefined, 'stat-grid');
    for (const [name, count] of Object.entries(result.counts)) {
      const stat = node('div', undefined, 'stat'); stat.append(node('strong', count === null ? '—' : count.toLocaleString()), node('span', name)); stats.append(stat);
    }
    box.append(stats);
  }
  if (result.explanation) box.append(node('p', result.explanation));
  const detail = node('details'); detail.append(node('summary', 'Changed rows and native column metadata'), node('pre', json(result))); box.append(detail);
});
form('review-form', async () => {
  if (!selectedEdition) throw new Error('Select an edition first.');
  await api('/api/editions/' + selectedEdition.id + '/review', { method: 'POST', value: {
    actor: $('review-actor').value, decision: $('review-decision').value, note: $('review-note').value,
    comparisonId: lastComparison } });
  notify('Review saved for the exact retained edition.'); await openEdition(selectedEdition.id); await refresh();
});
async function downloadOriginal(index) {
  const response = await fetch('/api/editions/' + selectedEdition.id + '/partitions/' + index, {
    headers: { 'x-snowflake-workspace': capability } });
  if (!response.ok) throw new Error('Original partition download failed.');
  const link = node('a'); link.href = URL.createObjectURL(await response.blob());
  link.download = 'partition-' + String(index).padStart(5, '0') + '.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
$('edition-originals').addEventListener('click', () => run(null, async () => {
  const parts = node('ul', undefined, 'partition-list');
  for (const part of selectedEdition.partitions) {
    const item = node('li'), text = node('div');
    text.append(node('p', 'Partition ' + part.index + ' · ' + part.rows.toLocaleString() + ' rows · ' + part.bytes.toLocaleString() + ' bytes'),
      node('span', part.sha256, 'mono'));
    item.append(text, button('Download original', () => downloadOriginal(part.index))); parts.append(item);
  }
  dialog('Original source and result partitions', selectedEdition, parts);
}));
form('export-form', async () => {
  if (!selectedEdition) throw new Error('Select an edition first.');
  const cloudDelivery = $('cloud-options').value.trim() ? JSON.parse($('cloud-options').value) : undefined;
  const result = await api('/api/export', { method: 'POST', value: { editionId: selectedEdition.id,
    destination: $('export-destination').value, ...(cloudDelivery ? { cloudDelivery } : {}) } });
  $('export-result').textContent = json(result); notify('Complete original result exported to ' + result.directory + '.');
});
function publicationMode(publication) {
  retainedPublication = publication;
  for (const field of $('merchant-form').querySelectorAll('input, textarea')) {
    if (field.id !== 'publication-id') field.readOnly = Boolean(publication);
  }
  $('prepare-merchant').textContent = publication ?
    (publication.status === 'PREPARED' ? 'Reopen prepared release' : 'Resume saved publication') : 'Prepare original merchant release';
  $('new-publication').hidden = !publication;
  $('publication-status').textContent = publication ?
    'Saved publication ' + short(publication.id) + ' · ' + publication.status + '. Its edition and merchant terms are retained.' :
    'New publication using the selected edition.';
}
async function openPublication(id) {
  const publication = await api('/api/publications/' + id), request = publication.request;
  await openEdition(publication.editionId);
  const merchant = request.draft.merchant;
  for (const [field, key] of [['name', 'name'], ['origin', 'origin'], ['network', 'network'],
    ['asset', 'asset'], ['payto', 'payTo'], ['timeout', 'maxTimeoutSeconds']])
    $('merchant-' + field).value = merchant[key];
  $('merchant-queries').value = json(request.draft.queries);
  $('merchant-runtime').value = json(request.runtime);
  $('publication-id').value = publication.id;
  publicationMode(publication);
  $('merchant-result').textContent = json(publication);
  selectTab('merchant');
  notify('Saved publication opened. Continue it or start a new publication from these terms.');
}
$('new-publication').addEventListener('click', () => {
  publicationMode(null); $('publication-id').value = crypto.randomUUID();
  $('merchant-result').textContent = ''; $('merchant-name').focus();
  notify('New publication draft opened with the copied merchant terms.');
});
function merchantTemplate() {
  publicationMode(null);
  const columns = selectedEdition.columns;
  const quote = name => '"' + name.replaceAll('"', '""') + '"';
  $('merchant-queries').value = json([{ name: selectedEdition.queryName, method: 'GET', path: '/data/' + selectedEdition.queryName,
    sql: 'SELECT ' + columns.map(quote).join(', ') + ' FROM records ORDER BY __sf30_row_number',
    columns, parameters: {}, publicInput: {}, maxRows: Math.min(Math.max(selectedEdition.rowCount, 1), 1000),
    maxBytes: 917504, timeoutMs: 1000, description: 'Reviewed ' + selectedEdition.queryName + ' edition', amount: '' }]);
  if (!$('merchant-name').value) $('merchant-name').value = selectedEdition.queryName;
  if (!$('merchant-network').value) $('merchant-network').value = 'stellar:testnet';
  $('publication-id').value = crypto.randomUUID();
}
$('publication-id').value = crypto.randomUUID();
form('merchant-form', async () => {
  if (!selectedEdition || selectedEdition.review?.decision !== 'ACCEPTED') throw new Error('Select and accept the exact edition before preparing its merchant.');
  const original = retainedPublication;
  notify('Preparing the original SQLite merchant and retaining its release…');
  let result;
  if (original) result = await api('/api/publications/' + original.id + '/resume', { method: 'POST', value: {} });
  else {
    const draft = { merchant: { name: $('merchant-name').value, origin: $('merchant-origin').value,
      network: $('merchant-network').value, asset: $('merchant-asset').value, payTo: $('merchant-payto').value,
      maxTimeoutSeconds: Number($('merchant-timeout').value) }, queries: JSON.parse($('merchant-queries').value) };
    result = await api('/api/prepare', { method: 'POST', value: { editionId: selectedEdition.id, draft,
      publicationId: $('publication-id').value, runtime: JSON.parse($('merchant-runtime').value) } });
  }
  $('merchant-result').textContent = json(result); publicationMode(result);
  notify('Merchant release prepared. Open the original release console to operate it.');
  await loadList('publications'); await refresh();
});
$('release-console').addEventListener('click', () => run($('release-console'), async () => {
  const result = await api('/api/release-console', { method: 'POST', value: { port: 0 } });
  const link = node('a', 'Open the original release and customer console');
  link.href = result.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
  $('merchant-result').replaceWith(Object.assign(node('pre'), { id: 'merchant-result' }));
  $('merchant-result').append(link); link.click();
}));
async function refresh({ initial = false } = {}) {
  if (refreshBusy) return;
  refreshBusy = true;
  try {
    const previousSource = state?.source?.id, previousQuery = $('capture-query').value;
    state = await api('/api/state');
    $('workspace-status').textContent = (state.source?.config.label ?? 'New workspace') + ' · ' +
      state.activeJobs.length + ' captures running' +
      (state.cooldownUntil > Date.now() ? ' · Provider cooldown until ' + date(state.cooldownUntil) : '');
    $('operation-count').textContent = state.counts.operations; $('edition-count').textContent = state.counts.editions;
    $('source-version').textContent = state.source ? 'Source ' + short(state.source.id) : 'Unsaved source';
    if (initial) setDraft(state.source?.config ?? blankSource());
    if (initial || state.source?.id !== previousSource) {
      replaceOptions($('capture-query'), Object.keys(state.source?.config.queries ?? {}).map(name => [name, name]), previousQuery);
      captureFields();
      if (!initial && !dirty) setDraft(state.source?.config ?? blankSource());
    }
    if (pages[activeTab]) await loadList(activeTab);
    if (activeTab === 'merchant') await loadList('publications');
  } finally { refreshBusy = false; }
}
$('refresh').addEventListener('click', () => run($('refresh'), async () => { await refresh(); notify('Workspace refreshed.'); }));
run(null, async () => {
  if (!capability) throw new Error('Open the private workspace URL printed by the running Snowflake command.');
  await refresh({ initial: true });
  setInterval(() => { if (!document.hidden && (state?.activeJobs.length || state?.running.length)) run(null, () => refresh()); }, 5000);
});
