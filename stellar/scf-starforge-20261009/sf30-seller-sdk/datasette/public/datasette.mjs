// MIT. The complete source workflow over the original Datasette HTTP workspace.
import {createDatasetteClient} from '/client.mjs';
const $ = id => document.getElementById('ds-' + id);
const state = {client: null, health: null, snapshot: null, catalog: [], busy: false, refreshPromise: null,
  pageSize: 25, offsets: {captures: 0, editions: 0, plans: 0, runs: 0, history: 0, browser: 0},
  selection: null, view: null, review: null, sourceReview: null, dirty: false,
  publisher: null, plan: null, run: null, target: null, release: null, journal: [], pending: null, db: null,
  compare: null, comparisonPage: 0, lastFiles: null, sourceTemplate: null, originalSelection: null};
const uuid = () => crypto.randomUUID();
const short = value => typeof value === 'string' && value.length > 23 ? value.slice(0, 18) + '…' : String(value ?? '—');
const count = value => Number.isSafeInteger(value) ? value.toLocaleString() : String(value ?? '—');
const time = value => value ? String(value).replace('T', ' ').replace(/Z$/, ' UTC') : '—';
const text = value => value === null ? 'null' : typeof value === 'string' ? value : JSON.stringify(value, null, 2);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function node(tag, value = '', attributes = {}) {
  const element = document.createElement(tag); element.textContent = String(value);
  for (const [key, selected] of Object.entries(attributes)) element.setAttribute(key, String(selected));
  return element;
}
function message(value, error = false) {
  $('message').textContent = value; $('message').hidden = !value;
  $('message').dataset.kind = error ? 'error' : 'information';
}
function report(error) {message(error?.message ?? String(error), true);}
function json(id, empty = {}) {
  const value = $(id).value.trim() ? JSON.parse($(id).value) : empty;
  if (!object(value)) throw new Error('Use a JSON object for ' + $(id).closest('label').firstChild.textContent.trim() + '.');
  return value;
}
function metrics(id, entries) {
  $(id).replaceChildren(...entries.map(([label, value]) => {
    const item = node('div'); item.append(node('dt', label), node('dd', count(value))); return item;
  }));
}
function result(id, value) {
  const pre = node('pre', JSON.stringify(value, null, 2)); pre.className = 'result'; $(id).replaceChildren(pre);
}
function download(content, filename, type = 'application/json') {
  const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], {type}));
  const link = node('a', '', {href: url, download: filename});
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function controls() {
  const active = state.snapshot?.active;
  const locked = state.busy || !state.health || !state.db;
  for (const field of document.querySelectorAll('main input, main textarea, main select')) field.disabled = locked;
  if (state.selection?.kind === 'edition') {
    $('key').disabled = true;
    for (const field of $('projection').querySelectorAll('input,select')) field.disabled = true;
  }
  $('initialize').disabled = locked || !state.target?.initializable;
  for (const button of document.querySelectorAll('[data-mutates]'))
    button.disabled = locked || Boolean(active);
  $('cancel').hidden = !active;
  $('cancel').disabled = state.busy && !active;
  $('active').textContent = active ? active.operation : state.busy ? 'Working' : state.health ? 'Connected' : 'Connecting';
  $('publish').disabled = state.busy || Boolean(active) || state.run?.run?.state !== 'REVIEWED';
  $('create-edition').disabled = state.busy || Boolean(active) || !state.sourceReview?.approved ||
    state.dirty || state.selection?.kind !== 'capture';
  $('extract').disabled = state.busy || Boolean(active) || !state.plan;
  $('select-edition').disabled = state.busy || Boolean(active) || state.selection?.kind !== 'edition';
}
async function action(fn) {
  if (state.busy) return;
  state.busy = true; controls();
  try {return await fn();} catch (error) {report(error);}
  finally {state.busy = false; controls();}
}
function pager(id, page, callback) {
  const container = $(id); container.replaceChildren();
  if (!page) return;
  const previous = node('button', 'Previous', {type: 'button'}), next = node('button', 'Next', {type: 'button'});
  previous.disabled = page.previous === null; next.disabled = page.next === null;
  previous.addEventListener('click', () => action(() => callback(page.previous)));
  next.addEventListener('click', () => action(() => callback(page.next)));
  container.append(previous, node('span', page.total ? count(page.offset + 1) + '–' +
    count(Math.min(page.offset + page.limit, page.total)) + ' of ' + count(page.total) : 'No records'), next);
}
function localPage(items, offset) {
  const limit = state.pageSize;
  return {items: items.slice(offset, offset + limit), page: {offset, limit, total: items.length,
    previous: offset > 0 ? Math.max(0, offset - limit) : null, next: offset + limit < items.length ? offset + limit : null}};
}
function rowTable(id, columns, rows, types = null) {
  const table = document.createElement('table'), head = document.createElement('thead'), top = document.createElement('tr');
  for (const column of columns) top.append(node('th', column)); head.append(top); table.append(head);
  const body = document.createElement('tbody');
  for (let index = 0; index < rows.length; index++) {
    const tr = document.createElement('tr');
    for (let cell = 0; cell < columns.length; cell++) {
      const td = document.createElement('td'), value = Array.isArray(rows[index]) ? rows[index][cell] : rows[index][columns[cell]];
      if (types) td.append(node('span', types[index]?.[cell] ?? '', {class: 'ds-cell-type'}));
      td.append(node('span', value === '' ? '""' : text(value) ?? '—', {class: 'ds-cell-value'})); tr.append(td);
    }
    body.append(tr);
  }
  table.append(body); $(id).replaceChildren(table);
}
function listButton(title, subtitle, selected, callback) {
  const button = node('button', '', {type: 'button', 'aria-pressed': String(selected)});
  button.append(node('strong', title), node('small', subtitle));
  button.addEventListener('click', () => action(callback)); return button;
}
function selectedOption(id, items, preferred) {
  const select = $(id), selected = preferred ?? select.value;
  select.replaceChildren(...items.map(item => node('option', item.name, {value: item.id})));
  if (items.some(item => item.id === selected)) select.value = selected;
}
async function openJournal(workspaceId) {
  if (!globalThis.indexedDB) throw new Error('This browser needs local storage for original operation recovery.');
  state.db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('starforge-datasette-operations', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('operations', {keyPath: 'id'});
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  const values = await new Promise((resolve, reject) => {
    const request = state.db.transaction('operations').objectStore('operations').getAll();
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  state.journal = values.filter(item => item.workspaceId === workspaceId).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  renderJournal();
}
async function saveJournal(value) {
  if (!state.db) throw new Error('The browser operation store is unavailable.');
  await new Promise((resolve, reject) => {
    const transaction = state.db.transaction('operations', 'readwrite'); transaction.objectStore('operations').put(value);
    transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error);
  });
  state.journal = [value, ...state.journal.filter(item => item.id !== value.id)].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  renderJournal();
}
function renderJournal() {
  state.pending = state.journal.find(item => ['SENDING','UNCERTAIN','UPLOADED','RECEIVING'].includes(item.state)) ?? null;
  $('pending').hidden = !state.pending;
  if (state.pending) $('pending-label').textContent = state.pending.operation + ' · ' + state.pending.id + ' · ' + time(state.pending.startedAt);
  const table = document.createElement('table'), head = document.createElement('tr');
  for (const label of ['Operation','Original identifier','State','Started','Input']) head.append(node('th', label));
  const body = document.createElement('tbody'); table.append(head, body);
  const selected = localPage(state.journal, state.offsets.browser);
  for (const record of selected.items) {
    const row = document.createElement('tr');
    row.append(node('td', record.operation), node('td', record.input.operationId ?? record.input.runId ?? record.input.uploadId ?? record.input.id ?? record.input.requestId ?? record.id),
      node('td', record.state + (record.stage ? ' · ' + record.stage : '')), node('td', time(record.startedAt)));
    const td = document.createElement('td'), button = node('button', 'Save input', {type: 'button', class: 'link'});
    button.addEventListener('click', () => download(JSON.stringify(record, null, 2) + '\n', record.id + '.json'));
    td.append(button); row.append(td); body.append(row);
  }
  $('browser-history').replaceChildren(table);
  pager('browser-pages', selected.page, offset => {state.offsets.browser = offset; renderJournal();});
}
async function readOperation(operation, input = {}) {return state.client.dispatch(operation, input);}
function originalRun(value, id) {
  const run = value?.run ?? value;
  return run && run.id === id && typeof run.state === 'string' ? run : null;
}
function runIssue(run) {
  const issue = run?.data?.error;
  return typeof issue === 'string' ? issue : issue?.message ?? issue?.code ?? '';
}
function savedOutcome(record, value) {
  if (['publisher.extract','publisher.publish','publisher.recover'].includes(record.operation)) {
    const run = originalRun(value, record.input.runId);
    if (!run) return {state: 'UNCERTAIN', message: 'Read the saved original run to resolve this response.'};
    const suffix = runIssue(run) ? ' · ' + runIssue(run) : '';
    const message = 'Original run ' + run.id + ' · ' + run.state + suffix;
    if (['EXTRACTING','PUBLISHING','PUBLICATION_UNKNOWN'].includes(run.state)) return {state: 'UNCERTAIN', message};
    if (['FAILED','CANCELLED','INTERRUPTED'].includes(run.state) ||
        record.operation === 'publisher.publish' && run.state !== 'PUBLISHED') return {state: 'FAILED', message};
    return {state: 'COMPLETE', message};
  }
  if (['source.capture','source.adopt'].includes(record.operation)) {
    if (value?.operationId !== record.input.operationId || value.state !== 'COMPLETE')
      return {state: 'UNCERTAIN', message: 'The original capture remains available to inspect and continue.'};
  }
  return {state: 'COMPLETE'};
}
async function retainOutcome(record, value) {
  const outcome = savedOutcome(record, value), {completedAt, ...original} = record;
  await saveJournal({...original, ...outcome, result: value, error: null,
    ...(['COMPLETE','FAILED'].includes(outcome.state) ? {completedAt: new Date().toISOString()} : {})});
  return outcome;
}
function announceRun(operation, value) {
  const run = value?.run ?? value, issue = runIssue(run);
  if (operation === 'publisher.publish' && run?.state === 'PUBLISHED')
    message('Published snapshot ' + run.data.publication.snapshot + ' · Revision ' + run.data.publication.revision + '.');
  else if (operation === 'publisher.extract' && ['READY','REVIEWED','PUBLISHED'].includes(run?.state))
    message('The original extraction is ' + run.state + ' and its retained candidate is available.');
  else message('Original run ' + (run?.state ?? 'outcome pending') + (issue ? ' · ' + issue : '') + '.',
    ['FAILED','CANCELLED','INTERRUPTED','PUBLICATION_UNKNOWN'].includes(run?.state) ||
    operation === 'publisher.publish' && run?.state !== 'PUBLISHED');
}
async function sendOriginal(record) {
  await saveJournal({...record, state: 'SENDING'});
  let value;
  try { value = await state.client.dispatch(record.operation, record.input); }
  catch (error) {
    await saveJournal({...record, state: error.uncertain ? 'UNCERTAIN' : 'FAILED',
      message: error.message, error: error.code,
      ...(error.uncertain ? {} : {completedAt: new Date().toISOString()})});
    throw error;
  }
  try {await retainOutcome(record, value);}
  catch (cause) {
    const error = new Error('The original operation returned its result, but this browser could not save it. Read its original outcome in Activity.', {cause});
    error.code = 'DATASETTE_BROWSER_RESULT_UNSAVED'; error.uncertain = true; error.result = value; throw error;
  }
  return value;
}
async function change(operation, input = {}) {
  const id = input.requestId ?? uuid();
  const record = {schema: 'stellar-forge.datasette-browser-operation.v1', id,
    workspaceId: state.health.workspaceId, operation, input,
    startedAt: new Date().toISOString(), state: 'SENDING'};
  const value = await sendOriginal(record);
  await refresh(); return value;
}
function declaredColumns() {
  const source = $('columns').value.trim();
  if (!source) return undefined;
  let columns;
  try { columns = JSON.parse(source); } catch { throw new Error('Use a JSON array for the ordered original column names.'); }
  if (!Array.isArray(columns) || !columns.length || columns.length > 10000 ||
      columns.some(name => typeof name !== 'string' || !name || name.includes('\0') || name.length > 4096) ||
      new Set(columns).size !== columns.length)
    throw new Error('Enter distinct, nonempty source column names in the exact returned order.');
  return columns;
}
function sourceSelection() {
  const url = new URL($('url').value), kind = $('kind').value, original = state.sourceTemplate ?? {};
  const selection = structuredClone(original);
  selection.url = url.href; selection.kind = kind; selection.continuation = $('continuation').value;
  selection.approvedOrigins = [...new Set([url.origin, ...$('origins').value.split(/\r?\n/).map(value => value.trim()).filter(Boolean)])];
  for (const field of ['database','table','query']) delete selection[field];
  if ($('database').value.trim()) selection.database = $('database').value.trim();
  if (kind === 'table' && $('table').value.trim()) selection.table = $('table').value.trim();
  if (kind === 'query') {selection.readOnly = true; if ($('query').value.trim()) selection.query = $('query').value.trim();}
  else delete selection.readOnly;
  if ($('allow-http').checked) selection.allowHttp = true; else delete selection.allowHttp;
  const columns = declaredColumns();
  if (columns) selection.columns = columns; else delete selection.columns;
  const metadata = structuredClone(original.metadata ?? {});
  for (const [id, name] of [['source-title','title'],['source-org','source'],['source-url','source_url'],
    ['license','license'],['license-url','license_url'],['about-url','about_url']]) {
    if ($(id).value.trim()) metadata[name] = $(id).value.trim(); else delete metadata[name];
  }
  if (Object.keys(metadata).length) selection.metadata = metadata; else delete selection.metadata;
  const changed = ['url','kind','database','table','query'].some(key => selection[key] !== original[key]) ||
    JSON.stringify(selection.columns ?? null) !== JSON.stringify(original.columns ?? null);
  if (changed) {delete selection.columnSource; delete selection.immutableIdentity;}
  if (original.url && new URL(original.url).origin !== url.origin) {
    delete selection.authentication; delete selection.account;
  }
  return selection;
}
function setSourceSelection(selection) {
  state.sourceTemplate = structuredClone(selection);
  $('url').value = selection.url ?? ''; $('kind').value = selection.kind ?? 'table';
  $('database').value = selection.database ?? ''; $('table').value = selection.table ?? ''; $('query').value = selection.query ?? '';
  $('columns').value = selection.columns ? JSON.stringify(selection.columns, null, 2) : '';
  $('continuation').value = selection.continuation ?? 'auto'; $('allow-http').checked = selection.allowHttp === true;
  $('origins').value = (selection.approvedOrigins ?? []).join('\n');
  for (const [id, name] of [['source-title','title'],['source-org','source'],['source-url','source_url'],
    ['license','license'],['license-url','license_url'],['about-url','about_url']])
    $(id).value = selection.metadata?.[name] ?? '';
  selectionKind();
}
function selectionKind() {
  $('table-label').hidden = $('kind').value !== 'table'; $('query-label').hidden = $('kind').value !== 'query';
}
function renderLists() {
  const captures = localPage(state.snapshot?.captures ?? [], state.offsets.captures);
  $('captures').replaceChildren(...captures.items.map(item => listButton(item.operationId,
    item.state + ' · ' + count(item.rowCount) + ' rows · ' + count(item.pageCount) + ' pages',
    state.selection?.kind === 'capture' && state.selection.id === item.operationId, () => openSource('capture', item.operationId))));
  pager('capture-pages', captures.page, offset => {state.offsets.captures = offset; renderLists();});
  const editions = localPage(state.snapshot?.editions ?? [], state.offsets.editions);
  $('editions').replaceChildren(...editions.items.map(item => listButton(item.edition?.name ?? item.id,
    count(item.edition?.rowCount) + ' rows · ' + short(item.editionSha256),
    state.selection?.kind === 'edition' && state.selection.id === item.id, () => openSource('edition', item.id))));
  pager('edition-pages', editions.page, offset => {state.offsets.editions = offset; renderLists();});
  const choices = (state.snapshot?.editions ?? []).map(item => ({id: item.id, name: item.edition?.name ?? item.id}));
  selectedOption('before', choices); selectedOption('after', choices);
  if (choices.length > 1 && $('before').value === $('after').value) $('after').value = choices.at(-1).id;
  $('publisher-source').textContent = state.snapshot?.selection ?
    'Selected edition: ' + state.snapshot.selection.edition + ' · ' + state.snapshot.selection.editionSha256 :
    'Select a named source edition to open the original publisher.';
}
async function refresh() {
  if (state.refreshPromise) return state.refreshPromise;
  state.refreshPromise = (async () => {
    const snapshot = await state.client.status(); state.snapshot = snapshot;
    $('binding').textContent = snapshot.directory + ' · Workspace ' + snapshot.workspaceId;
    if (snapshot.publisher) {state.publisher = snapshot.publisher; renderPublisher();}
    renderLists(); controls();
    return snapshot;
  })().finally(() => {state.refreshPromise = null;});
  return state.refreshPromise;
}
async function loadPublisher() {
  if (!state.snapshot?.selection || state.snapshot.active) return;
  state.publisher = await readOperation('publisher.status', {
    limit: state.pageSize, plansOffset: state.offsets.plans, runsOffset: state.offsets.runs, historyOffset: state.offsets.history});
  renderPublisher();
}
async function openSource(kind, id, offset = 0) {
  state.selection = {kind, id}; state.view = null; state.sourceReview = null; state.dirty = false; state.originalSelection = null;
  $('inspect-title').textContent = kind === 'edition' ? 'Source edition ' + id : 'Capture ' + id;
  $('inspect-state').textContent = 'Reading';
  $('review-controls').hidden = true; $('review-empty').hidden = false; $('saved-edition').hidden = true;
  renderLists();
  try {
    const value = await readOperation(kind === 'edition' ? 'editions.inspect' : 'source.inspect',
      {...(kind === 'edition' ? {id} : {operationId: id}), offset, limit: state.pageSize});
    state.view = value; renderSource(value); await loadReview(); return value;
  } catch (error) {
    const capture = state.snapshot.captures.find(item => item.operationId === id);
    if (kind === 'capture' && capture && capture.state !== 'COMPLETE') {
      const original = await readOperation('operations.inspect', {operationId: id});
      if (original.operationId !== id) throw new Error('The saved capture returned a different original operation.');
      state.originalSelection = original.selection;
      $('inspect-state').textContent = original.state;
      $('inspect-identity').textContent = capture.captureFile ?? id;
      $('observation').textContent = ''; $('attribution').hidden = true;
      $('source-rows').replaceChildren(); $('row-pages').replaceChildren(); $('source-metrics').replaceChildren();
      $('source-details').hidden = true; $('resume-capture').hidden = false;
      $('use-selection').hidden = !state.originalSelection; controls(); return null;
    }
    throw error;
  }
}
async function sourcePage(offset) {
  const {kind, id} = state.selection;
  const view = await readOperation(kind === 'edition' ? 'editions.inspect' : 'source.inspect',
    {...(kind === 'edition' ? {id} : {operationId: id}), offset, limit: state.pageSize});
  state.view = view; renderSource(view);
}
function renderSource(value) {
  state.originalSelection = value.capture.selection;
  $('inspect-state').textContent = value.edition?.state ?? value.capture?.state ?? 'COMPLETE';
  $('inspect-title').textContent = value.edition?.name ?? 'Capture ' + state.selection.id;
  $('inspect-identity').textContent = (value.editionSha256 ? 'Edition ' + value.editionSha256 + '\n' : '') + 'Capture ' + value.captureSha256;
  metrics('source-metrics', [['Rows', value.page.total],['Columns', value.columns.length],
    ['Original pages', value.capture.pageCount],['Selection', value.capture.selection.kind]]);
  const window = value.capture.consistency;
  $('observation').textContent = (window?.kind === 'immutable-database' ? 'Source database identity retained. ' : 'Source observation window. ') +
    time(window?.startedAt ?? window?.observationWindow?.notBefore) + ' → ' +
    time(window?.completedAt ?? window?.observationWindow?.notAfter);
  const metadata = value.capture.selection.metadata;
  $('attribution').hidden = !metadata;
  if (metadata) $('attribution').replaceChildren(...Object.entries(metadata).map(([key, val]) => node('p', key + ': ' + text(val))));
  rowTable('source-rows', value.columns, value.rows, value.cellTypes);
  pager('row-pages', value.page, sourcePage);
  $('resume-capture').hidden = true; $('use-selection').hidden = false; $('source-details').hidden = false;
  $('source-metadata').textContent = JSON.stringify({selection: value.capture.selection, sourceVersion: value.capture.sourceVersion,
    consistency: value.capture.consistency, pages: value.capture.pages}, null, 2);
  renderPageFiles(value);
  $('saved-edition').hidden = state.selection.kind !== 'edition';
  if (state.selection.kind === 'edition') {
    const selected = state.snapshot.selection?.editionSha256 === value.editionSha256;
    $('selected-summary').textContent = (selected ? 'Selected for publication. ' : 'Retained source edition. ') + value.edition.name;
  }
}
function renderPageFiles(value) {
  const table = document.createElement('table'), head = document.createElement('tr');
  for (const label of ['Page','Source receipt','Rows','Original body','Size']) head.append(node('th', label));
  const body = document.createElement('tbody'); table.append(head, body);
  for (const [index, page] of (value.capture.pages ?? []).entries()) {
    const row = document.createElement('tr');
    row.append(node('td', index + 1), node('td', (page.status !== null && page.status !== undefined ? 'HTTP ' + page.status :
        (page.providerReceipt?.provider ?? 'Retained source') + ' · ' + (page.providerReceipt?.status ?? 'Receipt available')) +
        ' · ' + (page.responseUrl ?? page.requestedUrl ?? '')),
      node('td', page.rowCount ?? page.rows ?? '—'));
    const cell = document.createElement('td');
    cell.append(node('span', page.body?.sha256 ?? '', {class: 'mono'}));
    if (page.body?.file) {
      const button = node('button', 'Download original bytes', {type: 'button', class: 'link'});
      button.addEventListener('click', () => action(() => downloadSourceFile(page.body.file))); cell.append(node('br'), button);
    }
    row.append(cell, node('td', count(page.body?.bytes))); body.append(row);
  }
  $('page-files').replaceChildren(table);
}
async function loadReview() {
  const value = state.view;
  const operationId = value.capture.operationId;
  state.review = value.review ?? await readOperation('source.review', {operationId, key: []});
  state.sourceReview = value.review ?? null;
  projectionFields(state.review);
  $('review-empty').hidden = true; $('review-controls').hidden = false;
  $('create-edition-form').hidden = state.selection.kind === 'edition';
  $('review-source').hidden = state.selection.kind === 'edition';
  $('reset-projection').hidden = state.selection.kind === 'edition';
  $('key').disabled = state.selection.kind === 'edition';
  for (const input of $('projection').querySelectorAll('input,select')) input.disabled = state.selection.kind === 'edition';
  const keys = state.review.key?.columns ?? [];
  $('key').value = keys.some(key => key.includes(',')) ? JSON.stringify(keys) : keys.join(', ');
  if (state.selection.kind === 'capture') {
    $('edition-id').value = 'edition-' + operationId;
    $('edition-name').value = value.capture.selection.metadata?.title ?? 'Datasette source ' + new Date().toISOString().slice(0, 10);
  }
  renderSourceReview(); controls();
}
function projectionFields(review, suggested = false) {
  const projection = !suggested && review.projection ? review.projection : review.suggestedProjection;
  const profiles = new Map(review.columns.map(profile => [profile.name, profile]));
  const entries = Object.entries(projection ?? {}).map(([name, spec]) => {
    const profile = profiles.get(spec.column);
    if (!profile) throw new Error('The saved projection refers to an unavailable source column.');
    return {profile, spec: {...spec, name}};
  });
  if (state.selection?.kind !== 'edition') {
    const selected = new Set(entries.map(entry => entry.profile.name));
    for (const profile of review.columns) if (!selected.has(profile.name)) entries.push({profile, spec: null});
  }
  $('projection').replaceChildren(...entries.map(({profile, spec}) => {
    const row = document.createElement('tr'); row.dataset.column = profile.name;
    const source = document.createElement('td'); source.append(node('strong', profile.name),
      node('small', Object.entries(profile.types).filter(([, number]) => number).map(([kind, number]) => kind + ' ' + count(number)).join(' · ')),
      node('small', 'Blank ' + count(profile.emptyStringCount) + ' · Null ' + count(profile.nullCount)));
    if (profile.unsafeIntegerCount || profile.nonRoundtripNumberCount)
      source.append(node('small', 'Exact numeric text required for ' + count(Math.max(profile.unsafeIntegerCount, profile.nonRoundtripNumberCount)) + ' values'));
    const include = node('input', '', {type: 'checkbox', 'aria-label': 'Include ' + profile.name}); include.checked = Boolean(spec); include.dataset.field = 'include';
    const name = node('input', '', {type: 'text', maxlength: 48, 'aria-label': 'Published name for ' + profile.name}); name.value = spec?.name ?? ''; name.dataset.field = 'name';
    const type = document.createElement('select'); type.dataset.field = 'type'; type.setAttribute('aria-label', 'Type for ' + profile.name);
    for (const entry of ['string','integer','number','boolean']) type.append(node('option', entry, {value: entry}));
    type.value = spec?.type ?? profile.suggestedType;
    const representation = document.createElement('select'); representation.dataset.field = 'representation'; representation.setAttribute('aria-label', 'Representation for ' + profile.name);
    for (const [key, label] of [['native','Source value'],['json','Exact JSON text'],['label','Source label']])
      representation.append(node('option', label, {value: key}));
    representation.value = spec?.representation ?? profile.suggestedRepresentation;
    const nullable = node('input', '', {type: 'checkbox', 'aria-label': 'Nullable ' + profile.name}); nullable.dataset.field = 'nullable';
    nullable.checked = spec?.nullable ?? profile.suggestedNullable;
    row.append(source, ...[include,name,type,representation,nullable].map(input => {const td = document.createElement('td'); td.append(input); return td;}));
    for (const input of [include,name,type,representation,nullable]) input.addEventListener('change', () => {
      if (representation.value === 'json') {type.value = 'string'; nullable.checked = false;}
      state.dirty = true; state.sourceReview = null; renderSourceReview(); projectionCount(); controls();
    });
    name.addEventListener('input', () => {state.dirty = true; state.sourceReview = null; controls();});
    return row;
  }));
  projectionCount();
}
function projectionCount() {
  $('column-count').textContent = count($('projection').querySelectorAll('input[data-field=include]:checked').length) + ' published fields';
}
function projectionInput() {
  const result = {};
  for (const row of $('projection').rows) {
    const field = name => row.querySelector('[data-field=' + name + ']');
    if (!field('include').checked) continue;
    const name = field('name').value.trim();
    if (!/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(name) || ['constructor','prototype','__proto__'].includes(name) || Object.hasOwn(result, name))
      throw new Error('Use distinct published field names beginning with a letter, up to 48 letters, digits or underscores.');
    result[name] = {column: row.dataset.column, type: field('type').value,
      representation: field('representation').value, nullable: field('nullable').checked};
  }
  if (!Object.keys(result).length) throw new Error('Select at least one source field.');
  return result;
}
function keyInput() {
  const input = $('key').value.trim();
  const keys = input.startsWith('[') ? JSON.parse(input) : input.split(',').map(value => value.trim()).filter(Boolean);
  if (!Array.isArray(keys) || keys.some(key => typeof key !== 'string' || !key) || new Set(keys).size !== keys.length)
    throw new Error('Choose distinct original key columns, using a JSON array when a name contains a comma.');
  return keys;
}
function renderSourceReview() {
  const value = state.sourceReview, container = $('source-review'); container.hidden = !value;
  if (!value) return;
  container.replaceChildren(node('p', 'Complete review: ' + count(value.rowCount) + ' rows · ' + count(value.pageCount) + ' pages · ' +
    count(value.columnTypes?.length) + ' published fields.'));
  container.append(node('p', value.key.columns.length ? 'Source key: ' + value.key.columns.join(', ') + ' · ' +
    (value.key.unique ? 'Unique across this source' : 'Requires attention') + ' · Missing ' + count(value.key.missingRows) +
    ' · Blank ' + count(value.key.blankRows) + ' · Duplicates ' + count(value.key.duplicateRows) :
    'No cross-edition business key selected.'));
  if (value.key.note) container.append(node('p', value.key.note));
  if (value.key.duplicates?.length) {
    const details = node('details'), summary = node('summary', 'Duplicate source keys');
    details.append(summary, node('pre', JSON.stringify(value.key.duplicates, null, 2))); container.append(details);
  }
  container.append(node('p', value.digest, {class: 'mono'}));
}

function renderPublisher() {
  const value = state.publisher;
  if (!value) return;
  $('plans').replaceChildren(...value.plans.map(plan => listButton(plan.data.title,
    'Plan ' + plan.id + ' · ' + time(plan.created), state.plan?.id === plan.id,
    async () => {state.plan = plan; renderPlan(); renderPublisher();})));
  $('runs').replaceChildren(...value.runs.map(run => listButton(run.state,
    'Plan ' + run.plan + ' · ' + time(run.created) + ' · ' + short(run.id),
    state.run?.run.id === run.id, () => loadRun(run.id))));
  for (const [name, element] of [['plans','plan-pages'],['runs','run-pages'],['history','history-pages']])
    pager(element, value.pages?.[name], async offset => {state.offsets[name] = offset; await loadPublisher();});
  const rows = (value.history ?? []).map(item => [item.id, time(item.created), item.kind ?? item.event ?? item.type,
    item.run ?? '', JSON.stringify(item.data ?? {})]);
  rowTable('history', ['Record','Time','Activity','Original run','Details'], rows);
}
function renderPlan() {
  $('plan-selected').hidden = !state.plan;
  if (state.plan) {
    $('plan-name').textContent = state.plan.data.title + ' · Plan ' + state.plan.id;
    $('plan-detail').textContent = JSON.stringify(state.plan.data, null, 2);
  }
  controls();
}
function requireRun() {
  if (!state.run?.run?.id) throw new Error('Select an original extraction run.');
  return state.run.run.id;
}
async function loadRun(id, query) {
  state.run = await readOperation('publisher.inspect', {runId: id, ...(query ? {query} : {})});
  state.offer = null;
  $('buyer-offer-result').textContent = ''; $('buyer-option').replaceChildren();
  renderRun(); renderPublisher(); await loadTarget(); return state.run;
}
function renderRun() {
  const value = state.run; $('run-panel').hidden = !value;
  if (!value) return;
  const saved = value.run, candidate = saved.data.candidate;
  $('run-title').textContent = value.plan.data.title;
  $('run-state').textContent = saved.state; $('run-identity').textContent = saved.id;
  $('run-outcome').textContent = runIssue(saved) || (saved.state === 'PUBLICATION_UNKNOWN' ?
    'Reconcile this original run with the retained dataset target.' : '');
  $('run-outcome').hidden = !$('run-outcome').textContent;
  metrics('run-metrics', [['Rows', candidate?.dataset?.rowCount],['CSV bytes', candidate?.csvBytes],
    ['Dataset version', short(candidate?.dataset?.snapshot)],['Source pages', candidate?.extraction?.pageCount]]);
  if (value.preview) rowTable('candidate-rows', value.preview.fields ?? Object.keys(value.preview.rows?.[0] ?? {}),
    value.preview.rows ?? []); else $('candidate-rows').replaceChildren();
  const review = saved.data.review;
  $('publication-review').replaceChildren(node('p', review ?
    'Reviewed by ' + review.reviewer + ' at ' + time(review.recordedAt) + '. ' + review.note :
    'Record the candidate and its current target before publication.'));
  if (review) $('publication-review').append(node('p', review.id, {class: 'mono'}));
  if (saved.data.publication) $('publication-review').append(node('p',
    'Published snapshot ' + saved.data.publication.snapshot + ' · Revision ' + saved.data.publication.revision, {class: 'mono'}));
  $('run-detail').textContent = JSON.stringify(value, null, 2);
  controls();
}
async function loadTarget() {
  state.target = await readOperation('publisher.target');
  const target = state.target;
  $('target').replaceChildren(node('p', target.connected ? 'Dataset target running · Revision ' + target.versions.revision :
    target.initializable ? 'This dataset target is ready for its first publication.' : 'Open the original dataset seller to refresh this target.'),
    node('p', target.directory, {class: 'mono'}));
  if (target.connected) $('target').append(node('p', target.dataset.name + ' · ' + count(target.dataset.rowCount) + ' rows'),
    node('p', target.versions.current, {class: 'mono'}));
  $('initialize').disabled = !target.initializable;
  if (!target.initializable) $('initialize').checked = false;
}
function comparison(value) {
  state.compare = value;
  const container = $('comparison'); container.replaceChildren();
  const summary = node('section', '', {class: 'ds-muted-panel'});
  summary.append(node('h3', value.beforeName + ' → ' + value.afterName),
    node('p', value.comparison === 'reviewed-source-key' ? 'Compared by reviewed key: ' + value.key.join(', ') :
      'Compared as complete source rows.'),
    node('p', [['Added', value.addedRows],['Removed', value.removedRows],['Changed', value.changedRows],
      ['Unchanged', value.unchangedRows]].map(([label, number]) => label + ' ' + count(number)).join(' · ')),
    node('p', 'Source values ' + (value.sourceValuesUnchanged ? 'unchanged' : 'changed') + ' · Original HTTP bodies ' +
      (value.httpBodiesUnchanged ? 'unchanged' : 'changed')));
  const fields = [['schemaChanged','Column schema'],['selectionChanged','Source selection'],['projectionChanged','Published projection'],
    ['sourceVersionChanged','Source version'],['sourceMetadataChanged','Source attribution'],['keyChanged','Source key'],['orderChanged','Row order']];
  summary.append(node('p', fields.filter(([key]) => value[key]).map(([, name]) => name + ' changed').join(' · ') || 'Source selection and field contract unchanged.'));
  container.append(summary);
  const changes = [
    ...value.changed.map(item => ({kind: 'Changed', ...item})),
    ...value.added.map(item => ({kind: 'Added', ...item})),
    ...value.removed.map(item => ({kind: 'Removed', ...item})),
  ];
  const paged = localPage(changes, state.comparisonPage);
  const table = document.createElement('table'), header = document.createElement('tr');
  for (const label of ['Change','Source key / row','Original values']) header.append(node('th', label));
  table.append(header);
  for (const change of paged.items) {
    const row = document.createElement('tr');
    row.append(node('td', change.kind), node('td', change.key ? JSON.stringify(change.key) : String(change.row)),
      node('td', JSON.stringify(change.fields ?? {beforeRow: change.beforeRow, afterRow: change.afterRow}, null, 2), {class: 'ds-raw'}));
    table.append(row);
  }
  const wrap = node('div', '', {class: 'table-wrap'}); wrap.append(table); container.append(wrap);
  const nav = node('nav', '', {id: 'ds-comparison-pages', class: 'ds-pager', 'aria-label': 'Edition differences'}); container.append(nav);
  pager('comparison-pages', paged.page, offset => {state.comparisonPage = offset; comparison(state.compare);});
  const save = node('button', 'Save complete comparison', {type: 'button'});
  save.addEventListener('click', () => download(JSON.stringify(value, null, 2) + '\n', 'datasette-edition-comparison.json')); container.append(save);
}
function relativeFile(path) {
  if (typeof path !== 'string') throw new Error('The operation did not return a retained file.');
  if (!path.startsWith('/')) return path;
  const prefix = state.snapshot.directory.replace(/\/$/, '') + '/';
  if (!path.startsWith(prefix)) throw new Error('This file is outside the selected workspace. Open it on the original host.');
  return path.slice(prefix.length);
}
async function downloadRetainedFile(descriptor) {
  if (!descriptor || descriptor.workspaceId !== state.health.workspaceId || !/^[a-f0-9]{64}$/.test(descriptor.sha256 ?? ''))
    throw new Error('Select an identified original file from this workspace.');
  const total = Number(descriptor.bytes);
  if (!Number.isSafeInteger(total) || total < 0) throw new Error('The original file size is invalid.');
  const parts = []; let offset = '0', received = 0;
  do {
    const chunk = await readOperation('files.read', {path: descriptor.path, sha256: descriptor.sha256, offset, limit: 262144});
    if (chunk.workspaceId !== descriptor.workspaceId || chunk.path !== descriptor.path || chunk.sha256 !== descriptor.sha256 ||
        chunk.bytes !== descriptor.bytes || chunk.offset !== offset || chunk.encoding !== 'base64')
      throw new Error('The original file changed during download.');
    const decoded = atob(chunk.data), bytes = Uint8Array.from(decoded, character => character.charCodeAt(0));
    if (bytes.length !== Number(chunk.length) || received + bytes.length > total ||
        chunk.complete !== (received + bytes.length === total))
      throw new Error('The source file did not return a complete original byte range.');
    parts.push(bytes); received += bytes.length;
    if (!chunk.complete && (chunk.nextOffset !== String(received) || chunk.nextOffset === offset))
      throw new Error('The source file continuation did not advance.');
    offset = chunk.nextOffset;
    message('Downloading ' + descriptor.name + ' · ' + count(received) + ' / ' + count(total) + ' bytes');
  } while (offset !== null);
  if (received !== total) throw new Error('The source download ended before the complete file.');
  const blob = new Blob(parts, {type: 'application/octet-stream'});
  const actual = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())),
    byte => byte.toString(16).padStart(2, '0')).join('');
  if (actual !== descriptor.sha256) throw new Error('The complete download differs from the original retained file.');
  download(blob, descriptor.name, 'application/octet-stream'); message('Downloaded ' + descriptor.name + ' · ' + count(total) + ' original bytes.');
}
async function downloadSourceFile(member) {
  const value = state.view;
  const directory = state.selection.kind === 'edition' ?
    relativeFile(value.editionFile).replace(/edition\.json$/, '') + 'capture/' :
    relativeFile(value.captureFile).replace(/capture\.json$/, '');
  const descriptor = await readOperation('files.inspect', {path: directory + member});
  await downloadRetainedFile(descriptor);
}
async function showExport(id, value) {
  result(id, value);
  if (value.retainedFile) {
    const button = node('button', 'Download original package', {type: 'button'});
    button.addEventListener('click', () => action(() => downloadRetainedFile(value.retainedFile)));
    $(id).append(button);
  }
}
async function inspectPending() {
  const record = state.pending;
  if (!record) return;
  if (record.workspaceId !== state.health.workspaceId)
    throw new Error('Reopen the original workspace selected by this saved operation.');
  await refresh();
  let value;
  if (record.operation === 'files.upload') {
    value = await state.client.uploadStatus({uploadId: record.input.uploadId});
    if (!uploadMatches(value, record.input)) throw new Error('The saved upload selects a different original archive.');
    if (value.state === 'REJECTED')
      await saveJournal({...record, state: 'FAILED', lastConfirmed: value,
        message: value.error?.message ?? 'The original upload was rejected.', error: value.error?.code});
    else if (value.state === 'COMPLETE') {
      await saveJournal({...record, state: 'UPLOADED', stage: 'receiving', lastConfirmed: value});
      message('The original archive is fully uploaded. Continue original input to complete or reopen its receiving operation.');
    } else {
      await saveJournal({...record, state: 'UNCERTAIN', stage: 'upload', lastConfirmed: value});
      message('The original upload prefix is retained. Select the same archive to continue its remaining bytes.');
    }
    result('operation-result', value); result('receive-result', value); return;
  }
  if (['source.select','publisher.plan','publisher.review','publisher.prepare-buyer'].includes(record.operation) &&
      typeof record.input.requestId === 'string' && state.catalog.some(item => item.operation === 'requests.inspect')) {
    value = await readOperation('requests.inspect', {requestId: record.input.requestId});
    if (value.schema !== 'stellar-forge.datasette-request.v1' || value.workspaceId !== record.workspaceId ||
        value.requestId !== record.input.requestId || value.operation !== record.operation ||
        JSON.stringify(value.input) !== JSON.stringify(record.input) ||
        !['PENDING','COMPLETE','REJECTED'].includes(value.state))
      throw new Error('The retained request does not match this original operation and complete input.');
    if (value.state === 'COMPLETE') await retainOutcome(record, value.result);
    else if (value.state === 'REJECTED') await saveJournal({...record, state: 'FAILED', result: value,
      message: value.error?.message ?? 'The original request was rejected.', error: value.error?.code,
      completedAt: value.completedAt ?? new Date().toISOString()});
  } else if (['publisher.extract','publisher.publish','publisher.recover'].includes(record.operation)) {
    value = await readOperation('operations.inspect', {operationId: record.input.runId});
    if (!originalRun(value, record.input.runId)) throw new Error('The saved run returned a different original identifier.');
    await retainOutcome(record, value);
  } else if (['source.capture','source.adopt'].includes(record.operation)) {
    value = await readOperation('operations.inspect', {operationId: record.input.operationId});
    if (value.operationId === record.input.operationId && value.state === 'COMPLETE') await retainOutcome(record, value);
  } else if (['editions.create','source.receive'].includes(record.operation) && record.input.id) {
    value = await readOperation('editions.inspect', {id: record.input.id});
  } else value = {workspace: state.snapshot, originalInput: record.input};
  result('operation-result', value);
  message('The current original outcome is shown in the operation result.');
}
function operationCatalog() {
  selectedOption('operation', state.catalog.map(item => ({id: item.operation, name: item.operation})));
  const update = () => {
    const selected = state.catalog.find(item => item.operation === $('operation').value);
    $('operation-help').textContent = selected ? selected.description + ' Required: ' + (selected.required.join(', ') || 'none') + '.' : '';
  };
  $('operation').addEventListener('change', update); update();
}
function on(id, event, callback) {
  $(id).addEventListener(event, value => {value.preventDefault(); action(() => callback(value));});
}
on('refresh', 'click', async () => {await refresh(); await loadPublisher(); message('Original workspace refreshed.');});
$('kind').addEventListener('change', selectionKind);
$('example').addEventListener('click', () => {
  setSourceSelection({url: 'https://datasette.io/global-power-plants/global-power-plants.json?primary_fuel=Geothermal&_shape=arrays&_size=50',
    kind: 'table', database: 'global-power-plants', table: 'global-power-plants', continuation: 'auto',
    approvedOrigins: ['https://datasette.io'], columns: ["rowid","country","country_long","name","gppd_idnr","capacity_mw","latitude","longitude","primary_fuel","other_fuel1","other_fuel2","other_fuel3","commissioning_year","owner","source","url","geolocation_source","wepp_id","year_of_capacity_data","generation_gwh_2013","generation_gwh_2014","generation_gwh_2015","generation_gwh_2016","generation_gwh_2017","generation_data_source","estimated_generation_gwh"],
    metadata: {title: 'Global Power Plant Database', source: 'World Resources Institute',
      source_url: 'http://www.wri.org/publication/global-power-plant-database',
      license: 'CC Attribution 4.0 License', license_url: 'https://creativecommons.org/licenses/by/4.0/',
      about_url: 'https://github.com/simonw/global-power-plants-datasette'}});
  $('url').focus();
});
on('capture-form', 'submit', async () => {
  const operationId = uuid(); await change('source.capture', {operationId, selection: sourceSelection()});
  await openSource('capture', operationId); message('The complete source capture is retained.');
});
on('resume-capture', 'click', async () => {
  const id = state.selection.id;
  const original = await readOperation('operations.inspect', {operationId: id});
  const selection = original.selection ?? original.operation?.selection ??
    state.snapshot.captures.find(item => item.operationId === id)?.selection ??
    state.journal.find(item => item.input.operationId === id && item.input.selection)?.input.selection;
  if (!selection) throw new Error('Open the original saved capture input in Activity.');
  await change('source.capture', {operationId: id, selection}); await openSource('capture', id);
});
on('use-selection', 'click', async () => {
  const selection = state.view?.capture.selection ?? state.originalSelection ??
    state.snapshot.captures.find(item => item.operationId === state.selection.id)?.selection;
  if (selection) {setSourceSelection(selection); document.getElementById('source').scrollIntoView({behavior: 'smooth'});}
});
$('cancel').addEventListener('click', async () => {
  try {if (state.snapshot?.active) {await readOperation('operations.cancel', {operationId: state.snapshot.active.operationId}); message('The original operation is settling its retained work.'); await refresh();}}
  catch (error) {report(error);}
});
$('key').addEventListener('input', () => {state.dirty = true; state.sourceReview = null; renderSourceReview(); controls();});
on('reset-projection', 'click', async () => {projectionFields(state.review, true); state.dirty = true; state.sourceReview = null; renderSourceReview(); controls();});
on('review-source', 'click', async () => {
  state.sourceReview = await readOperation('source.review', {operationId: state.view.capture.operationId,
    key: keyInput(), projection: projectionInput()});
  state.dirty = false; renderSourceReview(); controls(); message('Every retained source row has been reviewed against this projection.');
});
on('create-edition-form', 'submit', async () => {
  if (!state.sourceReview?.approved || state.dirty) throw new Error('Review the complete current projection first.');
  const id = $('edition-id').value.trim();
  await change('editions.create', {id, operationId: state.view.capture.operationId, name: $('edition-name').value.trim(),
    key: state.sourceReview.key.columns, projection: state.sourceReview.projection});
  await openSource('edition', id); message('The reviewed source edition is saved.');
});
on('select-edition', 'click', async () => {
  await change('source.select', {requestId: uuid(), editionId: state.selection.id,
    expectedSelectionHash: state.snapshot.selectionHash ?? null});
  await loadPublisher(); message('The source edition is selected for the next publisher plan.');
});
on('export-edition', 'click', async () => {
  const value = await change('source.export', {editionId: state.selection.id}); await showExport('export-result', value);
});
on('compare-form', 'submit', async () => {
  if ($('before').value === $('after').value) throw new Error('Choose two source editions.');
  state.comparisonPage = 0;
  comparison(await readOperation('editions.compare', {left: $('before').value, right: $('after').value}));
});
on('plan-form', 'submit', async () => {
  const dataset = json('plan-dataset'), source = await readOperation('publisher.source');
  const input = {requestId: uuid(), title: $('plan-title').value.trim(), query: $('plan-query').value.trim(),
    input: json('plan-input'), extraction: json('plan-extraction'), sourceHash: source.hash};
  if (Object.keys(dataset).length) input.dataset = dataset;
  state.plan = await change('publisher.plan', input); renderPlan(); await loadPublisher();
  message('The source-bound plan is retained with the original publisher.');
});
on('extract', 'click', async () => {
  const runId = uuid(), value = await change('publisher.extract', {planId: state.plan.id, runId});
  announceRun('publisher.extract', value); await loadRun(runId);
});
on('preview-form', 'submit', async () => {await loadRun(requireRun(), $('preview-query').value);});
on('recover-run', 'click', async () => {const id = requireRun(); await change('publisher.recover', {runId: id}); await loadRun(id);});
on('read-target', 'click', loadTarget);
on('publish-review-form', 'submit', async () => {
  if (!state.target) await loadTarget();
  const input = {requestId: uuid(), runId: requireRun(), reviewer: $('reviewer').value.trim(), note: $('publication-note').value.trim()};
  if ($('initialize').checked) input.initialize = true;
  else {
    if (!state.target.connected) throw new Error('Open the original dataset seller, then read its current target.');
    input.expectedSnapshot = state.target.versions.current; input.expectedRevision = state.target.versions.revision;
  }
  const id = requireRun(); await change('publisher.review', input); await loadRun(id);
  message('The original candidate and selected target review are recorded.');
});
on('publish', 'click', async () => {
  const runId = requireRun(), reviewId = state.run.run.data.review?.id;
  if (!reviewId) throw new Error('Record the current original publication review first.');
  const value = await change('publisher.publish', {runId, reviewId});
  announceRun('publisher.publish', value); await loadRun(runId);
});
on('release-form', 'submit', async () => {
  const input = {runId: requireRun(), payment: json('release-payment'),
    origin: $('release-origin').value, path: $('release-path').value};
  if ($('release-directory').value.trim()) input.outputDirectory = $('release-directory').value.trim();
  state.release = await change('release.prepare', input); result('release-result', state.release); $('stage-fields').hidden = false;
  message('The complete source and dataset release package is ready.');
});
on('stage', 'click', async () => {
  if (!state.release?.directory || !$('stage-id').value.trim()) throw new Error('Prepare the complete release and enter its original release identifier.');
  const input = {packageDirectory: state.release.directory, id: $('stage-id').value.trim(), runtime: json('stage-runtime')};
  if ($('stage-label').value.trim()) input.label = $('stage-label').value.trim();
  const value = await change('release.stage', input); result('release-result', value); message('The package is staged in the original merchant release store.');
});
on('buyer-offer', 'click', async () => {
  const runId = requireRun(), query = $('buyer-query').value;
  const value = await readOperation('publisher.buyer-offer', {runId, query});
  state.offer = {runId, query, value}; $('buyer-offer-result').textContent = JSON.stringify(value, null, 2);
  selectedOption('buyer-option', value.accepts.map((entry, index) => ({id: String(index),
    name: (index + 1) + ' · ' + entry.network + ' · ' + entry.amount + ' atomic'})));
});
$('buyer-query').addEventListener('input', () => {state.offer = null; $('buyer-option').replaceChildren();});
on('buyer-form', 'submit', async () => {
  if (!state.offer || state.offer.runId !== requireRun() || state.offer.query !== $('buyer-query').value)
    throw new Error('Read the offer for the selected original run and query.');
  const value = await change('publisher.prepare-buyer', {...json('buyer-input'), requestId: uuid(),
    runId: requireRun(), query: state.offer.query, intentId: $('buyer-intent').value.trim(),
    acceptIndex: Number($('buyer-option').value), offerSha256: state.offer.value.offerSha256});
  result('buyer-result', value);
  if (value.configText) {
    const button = node('button', 'Download buyer configuration', {type: 'button'});
    button.addEventListener('click', () => download(value.configText, 'dataset-buyer.json')); $('buyer-result').append(button);
  }
  message('The buyer configuration is retained with the original extraction.');
});
on('pending-inspect', 'click', inspectPending);
on('pending-retry', 'click', async () => {
  if (!state.pending) return;
  if (state.pending.operation === 'files.upload') {await continueUpload(state.pending); return;}
  const original = state.pending, value = await sendOriginal(original); result('operation-result', value); await refresh();
  const current = savedOutcome(original, value);
  message(current.message ?? 'The original saved input has completed.', current.state !== 'COMPLETE');
});
on('pending-download', 'click', async () => {
  if (state.pending) download(JSON.stringify(state.pending, null, 2) + '\n', state.pending.id + '.json');
});
on('pending-dismiss', 'click', async () => {
  if (state.pending) await saveJournal({...state.pending, state: 'BROWSER_REMINDER_CLEARED'});
});
$('page-size').addEventListener('change', () => action(async () => {
  state.pageSize = Number($('page-size').value);
  for (const key of Object.keys(state.offsets)) state.offsets[key] = 0;
  renderLists(); await loadPublisher(); if (state.view) await sourcePage(0);
}));
on('operation-form', 'submit', async () => {
  const operation = $('operation').value, input = json('operation-input');
  const reads = new Set(['source.inspect','source.review','editions.list','editions.inspect','editions.compare',
    'publisher.status','publisher.source','publisher.target','publisher.inspect','publisher.buyer-offer',
    'files.list','files.inspect','files.read','operations.inspect','requests.inspect','requests.list']);
  const value = reads.has(operation) ? await readOperation(operation, input) : await change(operation, input);
  result('operation-result', value);
});

async function loadFiles(offset = 0) {
  const value = await readOperation('files.list', {prefix: $('files-prefix').value.trim(), offset, limit: state.pageSize});
  state.lastFiles = value;
  const table = document.createElement('table'), head = document.createElement('tr');
  for (const label of ['Original file','Kind','Bytes','SHA-256','Download']) head.append(node('th', label));
  table.append(head);
  for (const file of value.files) {
    const row = document.createElement('tr'); row.append(node('td', file.path), node('td', file.kind),
      node('td', file.bytes), node('td', file.sha256, {class: 'mono'}));
    const td = document.createElement('td'), button = node('button', 'Download', {type: 'button'});
    button.addEventListener('click', () => action(() => downloadRetainedFile(file))); td.append(button); row.append(td); table.append(row);
  }
  $('files').replaceChildren(table); pager('files-pages', value.page, loadFiles);
}
on('files-form', 'submit', () => loadFiles(0));
on('export-workspace', 'click', async () => {
  const outputFile = state.snapshot.directory.replace(/\/$/, '') + '/exports/workspace-' + uuid() + '.zip';
  const value = await change('workspace.export', {outputFile}); await showExport('workspace-export-result', value);
  message('The complete workspace archive is retained with its original identity.');
});
function receivingKind() {
  const workspace = $('receive-kind').value === 'workspace';
  $('receive-id-label').hidden = workspace; $('receive-id').required = !workspace;
  $('receive-directory-label').hidden = !workspace; $('receive-directory').required = workspace;
  $('receive-submit').textContent = workspace ? 'Receive source/publisher workspace' : 'Receive complete source edition';
}
$('receive-kind').addEventListener('change', receivingKind);

function uploadMatches(value, input) {
  return value?.schema === 'stellar-forge.datasette-upload.v1' && value.workspaceId === state.health.workspaceId &&
    ['RECEIVING','FINALIZABLE','COMPLETE','REJECTED'].includes(value.state) &&
    ['uploadId','name','bytes','sha256'].every(key => value[key] === input[key]);
}
async function selectedUploadFile() {
  const file = $('receive-file').files[0];
  if (!file) throw new Error('Select the original source or workspace archive.');
  if (file.size > 2 * 1024 * 1024 * 1024) throw new Error('The original archive exceeds the native 2 GiB source-file limit.');
  let sha256 = $('receive-sha').value.trim();
  if (sha256 && !/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Use the original lowercase SHA-256 from the archive receipt.');
  if (!sha256) {
    message('Reading the original archive identity · ' + file.name);
    sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())),
      byte => byte.toString(16).padStart(2, '0')).join('');
  }
  return {file, sha256};
}
function uploadReceipt(value) {
  result('receive-result', value);
  message('Source upload · ' + value.state + ' · ' + count(Number(value.receivedBytes)) + ' / ' +
    count(Number(value.bytes)) + ' bytes · ' + value.name);
}
async function continueUpload(record, selected) {
  if (typeof state.client.uploadStatus !== 'function' || typeof state.client.uploadChunk !== 'function')
    throw new Error('Open the installed Datasette client containing the original upload operations.');
  let current = null, completed = false, receivingStarted = false;
  const terminal = (message, code) => Object.assign(new Error(message), {code, terminal: true});
  try {
    try {current = await state.client.uploadStatus({uploadId: record.input.uploadId});}
    catch (error) {if (error.code !== 'DATASETTE_UPLOAD_NOT_FOUND' || error.status !== 404) throw error;}
    if (current && !uploadMatches(current, record.input))
      throw terminal('The saved upload selects a different original archive.', 'BROWSER_UPLOAD_IDENTITY_CHANGED');
    while (current?.state !== 'COMPLETE') {
      if (current?.state === 'REJECTED')
        throw terminal(current.error?.message ?? 'The retained archive bytes differ from their declared SHA-256.',
          current.error?.code ?? 'DATASETTE_UPLOAD_REJECTED');
      const total = Number(record.input.bytes), offset = current ? Number(current.receivedBytes) : 0;
      if (!/^(0|[1-9][0-9]*)$/.test(record.input.bytes ?? '') || !Number.isSafeInteger(total) ||
          total < 0 || total > 2 * 1024 * 1024 * 1024 ||
          current && !/^(0|[1-9][0-9]*)$/.test(current.receivedBytes ?? '') ||
          !Number.isSafeInteger(offset) || offset < 0 || offset > total)
        throw terminal('The original upload prefix is invalid.', 'BROWSER_UPLOAD_PREFIX_INVALID');
      const maximum = Math.min(1024 * 1024, Number(current?.maximumChunkBytes ?? 8 * 1024 * 1024));
      if (!Number.isSafeInteger(maximum) || maximum < 1)
        throw terminal('The original upload range limit is invalid.', 'BROWSER_UPLOAD_LIMIT_INVALID');
      const length = Math.min(maximum, total - offset);
      let raw = new Uint8Array(0);
      if (length > 0) {
        selected ??= await selectedUploadFile();
        if (selected.file.name !== record.input.name || String(selected.file.size) !== record.input.bytes ||
            selected.sha256 !== record.input.sha256)
          throw new Error('Continue with the same original filename, byte count and archive SHA-256.');
        raw = new Uint8Array(await selected.file.slice(offset, offset + length).arrayBuffer());
      }
      const input = {...record.input, offset: String(offset), length: String(length)};
      record = {...record, state: 'SENDING', stage: 'upload',
        lastRange: {offset: input.offset, length: input.length}, lastConfirmed: current};
      await saveJournal(record);
      current = await state.client.uploadChunk(input, raw);
      if (!uploadMatches(current, record.input) || !/^(0|[1-9][0-9]*)$/.test(current.receivedBytes ?? '') ||
          Number(current.receivedBytes) < offset + length || Number(current.receivedBytes) > total ||
          current.state !== 'COMPLETE' && Number(current.receivedBytes) === offset && length > 0)
        throw terminal('The upload did not return the original complete range checkpoint.', 'BROWSER_UPLOAD_CHECKPOINT_INVALID');
      record = {...record, lastConfirmed: current};
      await saveJournal(record); uploadReceipt(current);
      if (length === 0 && current.state !== 'COMPLETE' && current.state !== 'REJECTED')
        throw new Error('Read the original upload outcome before continuing its finalization.');
    }
    if (!current.archiveFile || !current.retainedFile || !uploadMatches(current, record.input) ||
        current.receivedBytes !== record.input.bytes || current.retainedFile.sha256 !== record.input.sha256 ||
        current.retainedFile.bytes !== record.input.bytes || current.retainedFile.workspaceId !== record.workspaceId ||
        relativeFile(current.archiveFile) !== current.retainedFile.path)
      throw terminal('The original completed upload did not identify its complete retained archive.', 'BROWSER_UPLOAD_ARCHIVE_INVALID');
    const receiving = record.receiving;
    if (!receiving || !['source','workspace'].includes(receiving.kind))
      throw terminal('The saved upload has no original receiving destination.', 'BROWSER_RECEIVING_INPUT_MISSING');
    const operation = receiving.kind === 'workspace' ? 'workspace.receive' : 'source.receive';
    const input = {archiveFile: current.archiveFile, sha256: current.sha256,
      ...(receiving.kind === 'workspace' ? {directory: receiving.directory} : {id: receiving.id})};
    if (record.receivingInput && (JSON.stringify(record.receivingInput) !== JSON.stringify(input) ||
        record.receivingOperation !== operation))
      throw terminal('The retained receiving input differs from this original archive or destination.', 'BROWSER_RECEIVING_INPUT_CHANGED');
    record = {...record, state: 'UPLOADED', stage: 'receiving', lastConfirmed: current,
      receivingOperation: operation, receivingInput: input};
    await saveJournal(record);
    message('The complete original archive is retained. Receiving it at the saved destination.');
    record = {...record, state: 'RECEIVING'};
    await saveJournal(record);
    receivingStarted = true;
    const value = await state.client.dispatch(operation, record.receivingInput);
    try {
      await saveJournal({...record, state: 'COMPLETE', result: value, message: null, error: null,
        completedAt: new Date().toISOString()});
    } catch (cause) {
      const error = new Error('The original receiving operation completed, but this browser could not save its result. Continue its saved original input in Activity.', {cause});
      error.code = 'DATASETTE_BROWSER_RESULT_UNSAVED'; error.uncertain = true; error.result = value; throw error;
    }
    completed = true;
    result('receive-result', value);
    message(receiving.kind === 'workspace' ? 'The source/publisher workspace is received at ' + value.directory +
      '. Open that original directory in Applications.' :
      'The complete original source edition is received and ready to inspect.');
    await refresh();
    if (receiving.kind === 'source') await openSource('edition', receiving.id);
    return value;
  } catch (error) {
    if (!completed) {
      const retryable = !error.terminal && (!receivingStarted || error.uncertain || error.code === 'DATASETTE_WORKSPACE_BUSY');
      try {
        await saveJournal({...record, state: retryable ? 'UNCERTAIN' : 'FAILED',
          stage: current?.state === 'COMPLETE' ? 'receiving' : 'upload', lastConfirmed: current,
          message: error.message, error: error.code,
          ...(retryable ? {} : {completedAt: new Date().toISOString()})});
      } catch (journalError) { error.journalError = journalError; }
    }
    throw error;
  }
}
on('receive-form', 'submit', async () => {
  const selected = await selectedUploadFile(), kind = $('receive-kind').value;
  const receiving = kind === 'workspace' ? {kind, directory: $('receive-directory').value.trim()} : {kind, id: $('receive-id').value.trim()};
  if (kind === 'workspace' && !receiving.directory.startsWith('/')) throw new Error('Choose a separate absolute private receiving directory.');
  if (kind === 'source' && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(receiving.id))
    throw new Error('Choose the original local source-edition identifier.');
  const prior = state.journal.find(item => item.operation === 'files.upload' &&
    item.input.name === selected.file.name && item.input.bytes === String(selected.file.size) &&
    item.input.sha256 === selected.sha256 && JSON.stringify(item.receiving) === JSON.stringify(receiving));
  const uploadId = prior?.input.uploadId ?? uuid();
  const record = prior ?? {schema: 'stellar-forge.datasette-browser-upload.v1', id: uploadId,
    workspaceId: state.health.workspaceId, operation: 'files.upload',
    input: {uploadId, name: selected.file.name, bytes: String(selected.file.size), sha256: selected.sha256},
    receiving, startedAt: new Date().toISOString(), state: 'SENDING'};
  await saveJournal(record); await continueUpload(record, selected);
});
async function connect() {
  state.client = createDatasetteClient({url: location.origin + '/', timeoutMs: 3600000, maxResponseBytes: 64 * 1024 * 1024});
  state.health = await state.client.health();
  await openJournal(state.health.workspaceId);
  state.catalog = await state.client.operations(); operationCatalog();
  await refresh(); await loadPublisher(); selectionKind(); receivingKind();
  $('buyer-intent').value ||= uuid();
  const selected = state.snapshot.editions.find(item => item.editionSha256 === state.snapshot.selection?.editionSha256);
  if (selected) await openSource('edition', selected.id);
  else {
    const capture = state.snapshot.captures.find(item => item.state === 'COMPLETE');
    if (capture) await openSource('capture', capture.operationId);
  }
  controls();
}
connect().catch(report);
const poll = setInterval(() => {
  if (document.hidden || !state.client || !state.health || state.refreshPromise) return;
  if (state.busy || state.snapshot?.active) refresh().catch(report);
}, 5000);
window.addEventListener('pagehide', () => {clearInterval(poll); state.db?.close();}, {once: true});
