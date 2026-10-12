// MIT. Datasette customer views on the original Analysis workspace and domain API.
const $ = id => document.getElementById(id);
const token = location.hash.slice(1);
const nativeSchema = 'stellar-forge.datasette-operator.v1';
const state = {snapshot: null, selected: null, offset: 0, next: null,
  page: null, busy: false, refresh: null, poll: null, currentView: 'editions',
  shownRequests: new Set(), comparison: null, comparisonPage: null,
  rowGeneration: 0, comparisonGeneration: 0, submitGeneration: 0,
  preparing: false, submitting: false, prepareRevision: 0, receipts: new Map()};
const storageKey = 'stellar-forge:datasette-pending:' + location.origin;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function el(tag, text, className) {
  const item = document.createElement(tag);
  if (text !== undefined) item.textContent = String(text);
  if (className) item.className = className;
  return item;
}
function notice(message, error = false) {
  $('notice').textContent = message;
  $('notice').className = 'notice' + (error ? ' error' : '');
  $('notice').hidden = !message;
}
function parseExact(text) {
  let output = '', quoted = false, escaped = false;
  for (let i = 0; i < text.length;) {
    const c = text[i];
    if (quoted) {
      output += c; i++;
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') {quoted = true; output += c; i++; continue;}
    if (c === '-' || c >= '0' && c <= '9') {
      const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(i));
      if (!match) throw new Error('The original operator returned invalid JSON.');
      const value = match[0]; i += value.length;
      output += /^-?[0-9]+$/.test(value) && !Number.isSafeInteger(Number(value))
        ? JSON.stringify({encoding: 'json-integer', text: value}) : value;
      continue;
    }
    output += c; i++;
  }
  return JSON.parse(output);
}
function display(value) {
  if (value === null) return 'NULL';
  if (value === undefined) return '—';
  if (value === '') return '""';
  if (object(value) && typeof value.text === 'string' && value.encoding) return value.text;
  if (object(value) && typeof value.text === 'string' && value.type)
    return value.type === 'null' ? 'NULL' : value.type === 'missing' ? 'MISSING' : value.text === '' ? '\"\"' : value.text;
  if (object(value) && value.type && Object.hasOwn(value, 'value')) return display(value.value);
  return object(value) || Array.isArray(value) ? JSON.stringify(value) : String(value);
}
function bytes(value) {
  if (!Number.isFinite(value)) return '—';
  if (value < 1024) return value + ' B';
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KiB';
  return (value / (1024 * 1024)).toFixed(1) + ' MiB';
}
function stamp(value) {
  if (!value) return '';
  const time = new Date(value);
  return Number.isFinite(time.valueOf()) ? time.toLocaleString() : String(value);
}
function formatKey(value) {return String(value).replaceAll('_', ' ').replaceAll('-', ' ');}
async function api(path, {method = 'GET', body, headers = {}, raw = false} = {}) {
  if (!token) throw new Error('Open the complete private operator URL printed by the launch command.');
  const options = {method, cache: 'no-store', credentials: 'omit',
    headers: {'X-Analysis-Capability': token, ...headers}};
  if (body !== undefined) {
    if (body instanceof Blob || body instanceof ArrayBuffer) options.body = body;
    else {options.body = JSON.stringify(body); options.headers['Content-Type'] = 'application/json';}
  }
  const response = await fetch(path, options);
  if (raw && response.ok) return response;
  const value = parseExact(await response.text());
  if (!response.ok) {
    const error = new Error(value.message || value.error || 'The operator could not complete this request.');
    error.code = value.error; error.status = response.status; throw error;
  }
  return value;
}
function workspaceScope(snapshot = state.snapshot) {
  return snapshot ? snapshot.workspace_id + ':' + snapshot.operation_id : null;
}
function requireScope(scope) {
  if (!scope || scope !== workspaceScope())
    throw new Error('Reopen the original workspace and operation before continuing this request.');
}
function mutationControls() {
  for (const button of document.querySelectorAll('[data-mutation]'))
    button.disabled = state.busy || state.preparing || state.submitting;
}
function clearPending(requestId) {
  if (pending()?.request_id === requestId) pending(null);
}
function rememberReceipt(request) {
  if (!object(request) || !/^[a-f0-9]{32}$/.test(request.id || '')
      || request.operation_id !== state.snapshot?.operation_id)
    throw new Error('The returned request belongs to a different original operation.');
  const prior = state.receipts.get(request.id);
  if (prior?.status === 'COMPLETE' && request.status !== 'COMPLETE') return prior;
  if (prior && prior.status !== 'COMPLETE' && request.status !== 'COMPLETE'
      && String(prior.updated_at) > String(request.updated_at)) return prior;
  state.receipts.set(request.id, request); return request;
}
function pending(value) {
  if (!state.snapshot?.workspace_id || !state.snapshot?.operation_id) return null;
  const key = storageKey + ':' + state.snapshot.workspace_id + ':' + state.snapshot.operation_id;
  try {
    if (value === undefined) return JSON.parse(sessionStorage.getItem(key) || 'null');
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    if (value !== undefined && value !== null)
      throw new Error('The original request could not be retained in this browser. Keep its inputs and reopen this operator.');
  }
  return null;
}
const editionId = edition => edition?.edition_id || edition?.id || null;
const nativeState = () => state.snapshot?.state || {};
const editions = () => {
  const saved = nativeState().editions || [];
  return Array.isArray(saved) ? saved : Object.values(saved);
};
const selectedEdition = () => editions().find(item => editionId(item) === state.selected);
function selectEdition(id) {
  if (state.selected === id) return;
  state.selected = id; state.offset = 0; state.next = null; state.page = null;
  state.rowGeneration++;
  $('data-table').replaceChildren(); $('data-table').removeAttribute('aria-busy');
  $('page-label').textContent = ''; $('previous-page').disabled = true; $('next-page').disabled = true;
}
function editionTitle(edition) {
  return edition.title || edition.name || edition.prefix || String(editionId(edition) || 'Retained edition').slice(0, 16);
}
function setView(view, focus = false) {
  state.currentView = view;
  for (const tab of document.querySelectorAll('[role=tab]')) {
    const selected = tab.dataset.view === view;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    $('view-' + tab.dataset.view).hidden = !selected;
    if (selected && focus) tab.focus();
  }
  if (view === 'data' && state.selected) loadRows(state.selected, state.offset).catch(error => notice(error.message, true));
}
function definition(record, labels = {}) {
  const list = el('dl', undefined, 'definition');
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) continue;
    list.append(el('dt', labels[key] || formatKey(key)), el('dd', display(value)));
  }
  return list;
}
function jsonDetails(title, value) {
  const detail = el('details', undefined, 'detail-block');
  detail.append(el('summary', title), el('pre', JSON.stringify(value, null, 2)));
  return detail;
}
function table(columns, rows, {className = '', empty = 'No rows in this selection.'} = {}) {
  if (!rows?.length) return el('p', empty, 'empty');
  const names = columns?.length ? columns.map(column => typeof column === 'string' ? column : column.name)
    : [...new Set(rows.flatMap(row => object(row) ? Object.keys(row) : []))];
  const result = el('table', undefined, className), head = el('thead'), title = el('tr'), body = el('tbody');
  for (const name of names) {
    const item = el('th', name); item.scope = 'col'; title.append(item);
  }
  head.append(title);
  for (const row of rows) {
    const tr = el('tr');
    names.forEach((name, index) => {
      const value = Array.isArray(row) ? row[index] : row[name];
      const text = display(value), cell = el('td', text, value === null ? 'null' : '');
      if (text.length > 70) cell.title = text;
      tr.append(cell);
    });
    body.append(tr);
  }
  result.append(head, body); return result;
}
function renderSelectors() {
  const all = editions();
  for (const [id, fallback] of [['data-edition', state.selected],
    ['before-edition', editionId(all[0])], ['after-edition', editionId(all.at(-1))]]) {
    const control = $(id), previous = control.value;
    control.replaceChildren(...all.map(item => {
      const option = el('option', editionTitle(item)); option.value = editionId(item); return option;
    }));
    const chosen = id === 'data-edition' ? state.selected
      : all.some(item => editionId(item) === previous) ? previous : fallback;
    if (chosen) control.value = chosen;
  }
}
function renderEditions() {
  const all = editions(), current = nativeState().current_edition;
  if (!all.some(item => editionId(item) === state.selected))
    selectEdition((object(current) ? editionId(current) : current) || editionId(all.at(-1)));
  $('editions').replaceChildren(...all.map(item => {
    const button = el('button', undefined, 'edition');
    button.type = 'button'; button.setAttribute('aria-pressed', String(editionId(item) === state.selected));
    button.append(el('strong', editionTitle(item)),
      el('small', (item.row_count ?? item.rows ?? item.source?.row_count ?? '—') + ' rows'),
      el('small', stamp(item.created_at || item.captured_at || item.createdAt)),
      el('span', editionId(item), 'id'));
    button.addEventListener('click', () => {
      selectEdition(editionId(item));
      renderEditions(); renderSelectors(); renderSummary(); renderFiles();
      if (state.currentView === 'data') loadRows(state.selected, 0).catch(error => notice(error.message, true));
    });
    return button;
  }));
  if (!all.length) $('editions').append(el('p', 'Receive a source edition to begin.', 'empty'));
  const item = selectedEdition(), root = $('edition-detail'); root.replaceChildren();
  $('edition-label').textContent = item ? editionTitle(item) : '';
  if (!item) return;
  const source = item.source || {};
  root.append(definition({
    edition_id: editionId(item), version_id: item.version_id || item.version?.version_id,
    rows: item.row_count ?? item.rows ?? source.row_count,
    source: source.title || source.name || source.source_type || source.sourceType,
    database: source.database, table: source.table,
    retrieved: source.captured_at || source.capturedAt || source.retrieved_at,
    observation_window: source.observation_window || source.observed,
    attribution: source.attribution, license: source.license,
    reviewed_keys: item.review?.keys?.recommended || item.review?.keys || item.keys || source.keys,
  }, {edition_id: 'Edition', version_id: 'Analysis version'}));
  const summary = item.analysis?.summary || item.summary;
  if (summary) {
    const section = el('section', undefined, 'detail-block'); section.append(el('h3', 'Edition analysis'));
    if (Array.isArray(summary)) section.append(table(['label', 'value', 'unit'], summary));
    else if (object(summary)) {
      const simple = Object.fromEntries(Object.entries(summary).filter(([, value]) => !object(value) && !Array.isArray(value)));
      if (Object.keys(simple).length) section.append(definition(simple));
      const rows = Object.entries(summary).filter(([, value]) => object(value) || Array.isArray(value));
      for (const [name, value] of rows)
        if (Array.isArray(value) && value.every(object)) {
          section.append(el('h3', formatKey(name)), table(null, value));
        }
    }
    root.append(section);
  }
  root.append(jsonDetails('Retained source, review and publication', item));
  renderSelectors();
}
function renderSummary() {
  const native = nativeState(), selected = selectedEdition();
  $('workspace-state').textContent = state.busy ? 'Working' : formatKey(native.status || (editions().length ? 'Ready' : 'Ready for source'));
  $('workspace-id').textContent = state.snapshot?.workspace_id || '';
  $('operation-id').textContent = 'Operation ' + (state.snapshot?.operation_id || '');
  $('edition-count').textContent = editions().length;
  $('row-count').textContent = selected ? display(selected.row_count ?? selected.rows ?? selected.source?.row_count) : '—';
  $('file-count').textContent = allFiles().length;
}
function allFiles() {
  const result = [], seen = new Set();
  const append = (items, defaultEdition) => {
    for (const file of Array.isArray(items) ? items : []) {
      const item = {...file, edition_id: file.edition_id || defaultEdition};
      const key = (item.edition_id || '') + ':' + (item.export_id || '') + ':' + (item.name || item.filename);
      if (!seen.has(key)) {seen.add(key); result.push(item);}
    }
  };
  append(nativeState().files);
  for (const edition of editions()) append(edition.files, editionId(edition));
  for (const exported of nativeState().exports || [])
    if (exported.availability?.can_download === true) append(exported.files);
  return result;
}
async function download(file) {
  const params = new URLSearchParams({name: file.name || file.filename});
  if (file.edition_id) params.set('edition_id', file.edition_id);
  if (file.export_id) params.set('export_id', file.export_id);
  const response = await api('/api/datasette/download?' + params, {raw: true});
  const content = await response.arrayBuffer();
  const expectedHash = file.sha256 || response.headers.get('X-Content-SHA256');
  const expectedBytes = file.bytes ?? Number(response.headers.get('Content-Length'));
  if (Number.isFinite(expectedBytes) && content.byteLength !== expectedBytes)
    throw new Error('The download ended before the original file was complete. Download the same file again.');
  if (expectedHash) {
    const actual = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', content)),
      value => value.toString(16).padStart(2, '0')).join('');
    if (actual !== expectedHash) throw new Error('The downloaded file differs from its selected source identity.');
  }
  const url = URL.createObjectURL(new Blob([content], {type: response.headers.get('Content-Type') || 'application/octet-stream'}));
  const link = el('a'); link.href = url; link.download = file.filename || file.name;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  notice('Downloaded ' + (file.filename || file.name) + '.');
}
function renderFiles() {
  const files = allFiles();
  if (!files.length) {$('files').replaceChildren(el('p', 'Prepare a customer edition and delivery to expose its retained files.', 'empty')); return;}
  const output = el('table', undefined, 'downloads'), head = el('thead'), hr = el('tr'), body = el('tbody');
  for (const text of ['File', 'Edition', 'Size', 'SHA-256', '']) hr.append(el('th', text));
  head.append(hr);
  for (const file of files) {
    const row = el('tr'), digest = el('td', file.sha256 ? file.sha256.slice(0, 12) + '…' : '—');
    if (file.sha256) digest.title = file.sha256;
    row.append(el('td', file.filename || file.name),
      el('td', file.edition_id ? String(file.edition_id).slice(0, 12)
        : file.export_id ? 'Export ' + file.export_id.slice(0, 12) : 'Workspace'), el('td', bytes(file.bytes)), digest);
    const cell = el('td'), button = el('button', 'Download'); button.type = 'button';
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {await download(file);} catch (error) {notice(error.message, true);} finally {button.disabled = false;}
    });
    cell.append(button); row.append(cell); body.append(row);
  }
  output.append(head, body); $('files').replaceChildren(output);
  const archive = files.find(file => /workspace.*\.zip$/i.test(file.filename || file.name || '') || file.kind === 'workspace-archive');
  if (archive?.sha256) {
    $('receive-command').textContent = [
      'python3 stellar/scf-starforge-20261009/sf30-seller-sdk/datasette-analysis/cli.py receive',
      '  --archive /absolute/private/' + (archive.filename || archive.name),
      '  --sha256 ' + archive.sha256,
      '  --workspace /absolute/private/received-analysis',
      '  --operation-id <stable-32-character-lowercase-hex-id>',
      '',
      'Then run the same CLI with serve, the received --workspace, and the original Datasette --operation-id.',
    ].join('\n');
  }
}
function renderComparison(result) {
  if (!result) return;
  const root = $('comparison-result'); root.replaceChildren();
  root.append(el('h3', 'Saved edition comparison'));
  if (object(result.summary)) root.append(definition(result.summary));
  const job = result.page?.report?.id || result.native?.id
    || nativeState().comparisons?.find(item => item.id === result.comparison_id)?.job_id;
  if (!state.comparisonPage || state.comparisonPage.id !== result.comparison_id
      || state.comparisonPage.job !== job) {
    state.comparisonGeneration++;
    state.comparisonPage = {id: result.comparison_id, job,
      page: result.page || {rows: result.rows || []}, history: [], kind: 'all', pending: null};
  }
  const selected = state.comparisonPage, page = selected.page;
  const controls = el('div', undefined, 'pagination'), filter = el('select');
  filter.setAttribute('aria-label', 'Change kind');
  for (const kind of ['all', 'added', 'removed', 'changed', 'moved']) {
    const option = el('option', formatKey(kind)); option.value = kind; filter.append(option);
  }
  filter.value = selected.pending?.kind || selected.kind;
  async function readPage(after, kind, previous) {
    if (!/^[a-f0-9]{32}$/.test(job || '')) throw new Error('Open the retained comparison in the Analysis workspace.');
    const generation = ++state.comparisonGeneration, scope = workspaceScope();
    const selection = {after, kind, previous: [...previous]};
    selected.pending = selection; renderComparison(result);
    try {
      const query = new URLSearchParams({after: String(after), kind});
      const next = await api('/api/changes/' + job + '?' + query);
      if (generation !== state.comparisonGeneration || state.comparisonPage !== selected
          || selected.pending !== selection || scope !== workspaceScope()) return;
      selected.page = next; selected.kind = kind; selected.history = [...previous];
      selected.pending = null; renderComparison(result);
    } catch (error) {
      if (generation !== state.comparisonGeneration || state.comparisonPage !== selected
          || selected.pending !== selection || scope !== workspaceScope()) return;
      selected.pending = null; renderComparison(result); throw error;
    }
  }
  filter.addEventListener('change', () => readPage(0, filter.value, []).catch(error => notice(error.message, true)));
  const before = el('button', 'Previous'), after = el('button', 'Next');
  before.type = after.type = 'button'; before.disabled = Boolean(selected.pending) || selected.history.length === 0;
  after.disabled = Boolean(selected.pending) || page.next_after === null || page.next_after === undefined;
  root.setAttribute('aria-busy', String(Boolean(selected.pending)));
  before.addEventListener('click', () => {
    const previous = selected.history.slice(), cursor = previous.pop();
    readPage(cursor, selected.kind, previous).catch(error => notice(error.message, true));
  });
  after.addEventListener('click', () => readPage(page.next_after, selected.kind,
    [...selected.history, page.after || 0]).catch(error => notice(error.message, true)));
  controls.append(filter, before, el('span', (page.rows?.length || 0) + ' changes on this page', 'meta'), after);
  root.append(controls);
  const columns = page.report?.columns || result.native?.columns || result.columns || [];
  for (const change of page.rows || []) {
    const detail = el('details', undefined, 'detail-block');
    detail.append(el('summary', formatKey(change.kind) + ' · '
      + (change.key || []).map(display).join(' / ') + ' · source rows '
      + display(change.before_row_number) + ' → ' + display(change.after_row_number)));
    const cells = columns.map((column, index) => ({column,
      before: change.before === null ? {type: 'missing', text: ''} : change.before?.[index],
      after: change.after === null ? {type: 'missing', text: ''} : change.after?.[index],
      changed: (change.changed_columns || []).includes(column) ? 'Changed' : ''}));
    const area = el('div', undefined, 'table-scroll');
    area.append(table(['column', 'before', 'after', 'changed'], cells)); detail.append(area); root.append(detail);
  }
  if (!page.rows?.length) root.append(el('p', 'No changes in this selection.', 'empty'));
  root.append(jsonDetails('Retained comparison and current page', {comparison: result.native || result, page}));
}
function renderRequests() {
  const requests = state.snapshot?.requests || [];
  const active = requests.find(request => request.status === 'RUNNING');
  state.busy = Boolean(active);
  mutationControls();
  const activeNode = $('active-work'); activeNode.replaceChildren();
  if (active) {
    activeNode.append(el('strong', formatKey(active.action)), el('small', active.id));
  } else activeNode.append(el('p', 'No action is running.', 'empty'));
  const latest = active || requests[0];
  $('progress').replaceChildren(...(latest?.progress || []).slice(-12).map(event => {
    const row = el('li');
    row.append(el('span', event.phase || event.message || event.status || 'Working'),
      el('br'), el('time', stamp(event.time)));
    if (event.rows !== undefined) row.append(el('span', ' · ' + display(event.rows) + ' rows'));
    return row;
  }));
  const root = $('requests'); root.replaceChildren();
  for (const request of requests) {
    const row = el('div', undefined, 'activity');
    row.append(el('span', request.status, 'state'));
    const main = el('div'); main.append(el('h3', formatKey(request.action)),
      el('small', stamp(request.updated_at)), el('small', request.id));
    if (request.error) main.append(el('p', request.error.message || request.error.code));
    row.append(main);
    if (['FAILED', 'INTERRUPTED'].includes(request.status)) {
      const button = el('button', 'Continue request'); button.type = 'button'; button.disabled = state.busy;
      button.addEventListener('click', () => resumeRequest(request.id).catch(error => notice(error.message, true)));
      row.append(button);
    }
    row.append(jsonDetails('Original request and result', {body: request.body, result: request.result, error: request.error}));
    root.append(row);
    
    if (request.status === 'COMPLETE' && !state.shownRequests.has(request.id)) {
      state.shownRequests.add(request.id);
      if (pending()?.request_id === request.id) {
        clearPending(request.id); notice(formatKey(request.action) + ' completed.');
      }
    }
  }
  if (!requests.length) root.append(el('p', 'Source preparation, comparison and export activity will appear here.', 'empty'));
  const unknown = pending();
  if (unknown && !requests.some(request => request.id === unknown.request_id)) {
    const row = el('div', undefined, 'activity');
    row.append(el('span', 'UNCONFIRMED', 'state'), el('p', 'Reconnect the same original ' + unknown.action + ' request.'));
    const button = el('button', 'Continue original request'); button.type = 'button'; button.disabled = state.busy;
    button.addEventListener('click', () => submitEnvelope(unknown).catch(error => notice(error.message, true)));
    row.append(button); root.prepend(row);
  }
  state.comparison = requests.find(request => request.action === 'compare' && request.status === 'COMPLETE')?.result || null;
  renderComparison(state.comparison);
}
async function refresh() {
  if (state.refresh) return state.refresh;
  state.refresh = (async () => {
    const value = await api('/api/datasette/status');
    if (value.schema !== nativeSchema) throw new Error('This URL belongs to a different operator.');
    if (state.snapshot && workspaceScope(value) !== workspaceScope())
      throw new Error('This operator now selects a different original workspace or operation. Reopen its launch URL.');
    state.snapshot = value;
    for (const request of value.requests || []) rememberReceipt(request);
    value.requests = [...state.receipts.values()].sort((a, b) =>
      String(b.updated_at).localeCompare(String(a.updated_at)) || a.id.localeCompare(b.id));
    $('analysis-link').href = (value.analysis_path || '/') + '#' + token;
    renderRequests(); renderEditions(); renderSummary(); renderFiles();
    clearTimeout(state.poll);
    state.poll = setTimeout(() => refresh().catch(error => notice(error.message, true)), state.busy ? 1500 : 10000);
    return value;
  })();
  try {return await state.refresh;} finally {state.refresh = null;}
}
async function loadRows(edition, offset = 0) {
  const generation = ++state.rowGeneration, scope = workspaceScope();
  const requested = edition, params = new URLSearchParams({edition_id: edition, offset: String(offset), limit: '50'});
  $('data-table').setAttribute('aria-busy', 'true');
  try {
    const page = await api('/api/datasette/rows?' + params);
    if (generation !== state.rowGeneration || requested !== state.selected || scope !== workspaceScope()) return;
    if (page.edition_id !== requested || page.offset !== offset)
      throw new Error('The returned data page differs from the selected original edition and offset.');
    state.page = page; state.offset = page.offset;
    state.next = page.next_offset ?? (page.total > state.offset + (page.rows?.length || 0)
      ? state.offset + page.rows.length : null);
    $('data-table').replaceChildren(table(page.columns, page.rows, {className: 'source-table'}));
    const end = state.offset + (page.rows?.length || 0);
    $('page-label').textContent = (page.rows?.length ? state.offset + 1 : 0) + '–' + end + ' of ' + display(page.total ?? page.row_count);
    $('previous-page').disabled = state.offset === 0;
    $('next-page').disabled = state.next === null || state.next === undefined;
  } catch (error) {
    if (generation === state.rowGeneration && requested === state.selected && scope === workspaceScope()) throw error;
  } finally {
    if (generation === state.rowGeneration && requested === state.selected && scope === workspaceScope())
      $('data-table').removeAttribute('aria-busy');
  }
}
async function submitEnvelope(envelope, expectedScope = workspaceScope()) {
  requireScope(expectedScope);
  const generation = ++state.submitGeneration;
  pending(envelope); state.submitting = true; mutationControls();
  let result;
  try {
    result = await api('/api/datasette/requests', {method: 'POST', body: envelope});
    requireScope(expectedScope);
    if (result.request?.id !== envelope.request_id || result.request?.action !== envelope.action)
      throw new Error('The returned receipt differs from the original request.');
    result.request = rememberReceipt(result.request);
    clearPending(envelope.request_id);
    if (result.request.action === 'compare') state.comparison = null;
  } catch (error) {
    const accepted = state.receipts.get(envelope.request_id);
    if (workspaceScope() === expectedScope && accepted?.action === envelope.action) {
      result = {request: accepted, reused: true}; clearPending(envelope.request_id);
    } else {
      if (generation === state.submitGeneration && workspaceScope() === expectedScope)
        notice(error.message + ' Continue this original request to reconnect its saved result.', true);
      throw error;
    }
  } finally {
    if (generation === state.submitGeneration) {state.submitting = false; mutationControls();}
  }
  if (generation === state.submitGeneration)
    notice(result.request.status === 'COMPLETE' ? 'The original request is complete.' : 'The original request is running.');
  try {await refresh();}
  catch (error) {
    if (generation === state.submitGeneration && workspaceScope() === expectedScope)
      notice('The original request was accepted. Its latest workspace status could not be read: ' + error.message, true);
  }
  return result;
}
async function startAction(action, body, expectedScope = workspaceScope()) {
  if (!state.snapshot) await refresh();
  if (expectedScope === null) expectedScope = workspaceScope();
  requireScope(expectedScope);
  if (state.busy || state.submitting || state.preparing && action !== 'prepare')
    throw new Error('Wait for the current Datasette action to finish.');
  return submitEnvelope({request_id: crypto.randomUUID().replaceAll('-', ''), action, body}, expectedScope);
}
async function resumeRequest(requestId) {
  await api('/api/datasette/requests/' + requestId + '/resume', {method: 'POST', body: {}});
  notice('Continuing the original request.'); await refresh();
}
function prepareSelection() {
  return {revision: state.prepareRevision, path: $('handover-path').value,
    text: $('handover-json').value, file: $('handover-file').files[0] || null,
    prefix: $('prefix').value, resume: $('prepare-resume').checked};
}
function samePrepareSelection(original) {
  const current = prepareSelection();
  return current.revision === original.revision
    && ['path', 'text', 'file', 'prefix', 'resume'].every(key => current[key] === original[key]);
}
for (const id of ['handover-path', 'handover-json', 'handover-file', 'prefix', 'prepare-resume']) {
  $(id).addEventListener('input', () => {state.prepareRevision++;});
  $(id).addEventListener('change', () => {state.prepareRevision++;});
}
$('prepare-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (state.preparing || state.submitting || state.busy) {
    notice('The original Datasette source operation is still being submitted.', true); return;
  }
  const original = prepareSelection(), initialScope = workspaceScope(), initialView = state.currentView;
  state.preparing = true; mutationControls();
  try {
    const path = original.path.trim(), text = original.text.trim(), file = original.file;
    if ([Boolean(path), Boolean(text), Boolean(file)].filter(Boolean).length !== 1)
      throw new Error('Choose one handover file, existing path, or JSON descriptor.');
    let handover = path || (text ? parseExact(text) : null);
    if (!state.snapshot) await refresh();
    const selectedScope = initialScope || workspaceScope(); requireScope(selectedScope);
    if (file) {
      if (file.size > 32 * 1024 * 1024) throw new Error('Use the existing host path for a handover larger than 32 MiB.');
      const content = await file.arrayBuffer(); requireScope(selectedScope);
      const expectedHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', content)),
        byte => byte.toString(16).padStart(2, '0')).join('');
      requireScope(selectedScope);
      const result = await api('/api/datasette/intake', {method: 'POST', body: content,
        headers: {'X-Datasette-Filename': encodeURIComponent(file.name), 'Content-Type': 'application/json'}});
      requireScope(selectedScope);
      if (result.bytes !== content.byteLength || result.sha256 !== expectedHash
          || result.filename !== file.name || typeof result.handover !== 'string')
        throw new Error('The retained handover differs from the complete selected file.');
      handover = result.handover;
    }
    await startAction('prepare', {handover, prefix: original.prefix, resume: original.resume}, selectedScope);
    if (file && samePrepareSelection(original)) {
      $('handover-path').value = handover; $('handover-file').value = ''; state.prepareRevision++;
    }
    if (state.currentView === initialView) setView('editions');
  } catch (error) {notice(error.message, true);}
  finally {state.preparing = false; mutationControls();}
});
$('compare-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const before = $('before-edition').value, after = $('after-edition').value;
    if (!before || !after || before === after) throw new Error('Select two different retained editions.');
    const body = {before, after}, keys = $('comparison-keys').value.split(',').map(value => value.trim()).filter(Boolean);
    if (keys.length) body.keys = keys;
    await startAction('compare', body);
  } catch (error) {notice(error.message, true);}
});
$('export-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const destination = $('export-destination').value.trim();
    await startAction('export', destination ? {destination} : {});
  } catch (error) {notice(error.message, true);}
});
$('refresh').addEventListener('click', () => refresh().catch(error => notice(error.message, true)));
$('data-edition').addEventListener('change', () => {
  selectEdition($('data-edition').value);
  renderEditions(); renderSummary(); loadRows(state.selected, 0).catch(error => notice(error.message, true));
});
$('previous-page').addEventListener('click', () => loadRows(state.selected, Math.max(0, state.offset - 50)).catch(error => notice(error.message, true)));
$('next-page').addEventListener('click', () => loadRows(state.selected, state.next).catch(error => notice(error.message, true)));
const tabs = [...document.querySelectorAll('[role=tab]')];
for (const [index, tab] of tabs.entries()) {
  tab.addEventListener('click', () => setView(tab.dataset.view));
  tab.addEventListener('keydown', event => {
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
    if (next !== null) {event.preventDefault(); setView(tabs[next].dataset.view, true);}
  });
}
document.addEventListener('visibilitychange', () => {
  clearTimeout(state.poll);
  if (!document.hidden) refresh().catch(error => notice(error.message, true));
});
refresh().catch(error => notice(error.message, true));
