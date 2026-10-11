// MIT. Dependency-free operator UI; downloaded result bytes come from the retained server edition.
const $ = id => document.getElementById(id);
const state = { token: null, workspaceId: null, data: null, draft: null, dirty: false, busy: false,
  pending: null, edition: null, hitPage: 0 };
const pretty = value => JSON.stringify(value, null, 2);
function element(tag, text, attrs = {}) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}
function notice(message, error = false) { $('notice').textContent = message; $('notice').dataset.error = String(error); }
function errorMessage(error) { return [error.code, error.message].filter(Boolean).join(' · '); }
const currentKey = () => 'stellar-forge-opensearch:' + state.workspaceId + ':pending';
function retainPending(value) {
  state.pending = value;
  try { value ? localStorage.setItem(currentKey(), JSON.stringify(value)) : localStorage.removeItem(currentKey()); } catch {}
  renderPending(); buttons();
}
async function api(path, payload, retried = false) {
  const response = await fetch(path, payload === undefined ? { cache: 'no-store' } : {
    method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-workspace-token': state.token },
    body: JSON.stringify(payload) });
  const data = await response.json();
  if (response.status === 403 && data.error === 'WORKSPACE_TOKEN_REQUIRED' && payload !== undefined && !retried) {
    const session = await (await fetch('/api/session', { cache: 'no-store' })).json();
    if (session.workspaceId !== state.workspaceId) throw new Error('A different workspace is open at this address. Reload to select it.');
    state.token = session.token;
    return api(path, payload, true);
  }
  if (!response.ok) { const error = new Error(data.message ?? data.error); error.code = data.error; error.status = response.status; error.requestRecorded = data.requestRecorded; throw error; }
  return data;
}
function view(name) {
  for (const id of ['draft', 'editions', 'packages', 'operations']) $('view-' + id).hidden = id !== name;
  for (const button of document.querySelectorAll('[data-view]')) button.setAttribute('aria-selected', String(button.dataset.view === name));
}
function buttons() {
  const hasDraft = Boolean(state.draft?.id), held = state.busy || Boolean(state.pending);
  $('save').disabled = held || !state.dirty;
  for (const id of ['validate', 'inspect', 'capture', 'prepare']) $(id).disabled = held || !hasDraft || state.dirty;
  $('inspect').disabled ||= Boolean(state.data?.nativeBusy);
  $('capture').disabled ||= Boolean(state.data?.nativeBusy);
  $('new-draft').disabled = held;
  for (const id of ['draft-title', 'query-name', 'query-json', 'input-json', 'plan-json']) $(id).disabled = held;
  $('open-history').disabled = !hasDraft || state.busy;
  $('recover').disabled = state.busy || !state.pending;
  $('retry').disabled = state.busy || !state.pending;
  $('saved-state').textContent = state.draft?.id ?
    'Revision ' + state.draft.revision + ' · ' + (state.dirty ? 'unsaved changes' : 'saved ' + state.draft.updatedAt) :
    'New draft · ' + (state.dirty ? 'unsaved changes' : 'save your current choices');
}
function jsonEditor(id, label) {
  try {
    const value = JSON.parse($(id).value);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Object required');
    return value;
  } catch { throw new Error(label + ' must be a JSON object. The editor contents are retained.'); }
}
function editor() {
  return { ...(state.draft?.id ? { draftId: state.draft.id, expectedRevision: state.draft.revision } : {}),
    title: $('draft-title').value, queryName: $('query-name').value.trim(),
    query: jsonEditor('query-json', 'Query declaration'), input: jsonEditor('input-json', 'Search input'),
    plan: jsonEditor('plan-json', 'Merchant plan') };
}
function fill(draft, saved = true) {
  state.draft = draft.id ? draft : null;
  $('draft-title').value = draft.title ?? '';
  $('query-name').value = draft.queryName ?? '';
  $('query-json').value = pretty(draft.query ?? {});
  $('input-json').value = pretty(draft.input ?? {});
  $('plan-json').value = pretty(draft.plan ?? {});
  state.dirty = !saved;
  $('editor-heading').textContent = draft.title || 'New query draft';
  $('action-result').open = false; $('history').open = false;
  summary(); buttons(); renderDrafts();
}
function summary() {
  try {
    const query = JSON.parse($('query-json').value);
    $('query-summary').textContent = [
      'Indices: ' + (query.indices ?? []).join(', '),
      'Fields: ' + (query.fields ?? []).join(', '),
      'Page size: ' + (query.pageSize ?? 'source default'),
      'Capture limit: ' + (query.maxHits ?? 'source default')
    ].join(' · ');
  } catch { $('query-summary').textContent = 'The query editor contains unfinished JSON.'; }
}
function leaveEditor() { return !state.dirty || window.confirm('Open another draft and discard the current unsaved editor changes?'); }
function defaultPlan(name, query) {
  const plan = structuredClone(state.data.templatePlan);
  if (!Array.isArray(plan.routes) || !plan.routes.length) plan.routes = [{ id: name + '_search', path: '/search/' + name, method: 'POST',
    query: name, serviceName: name + ' search', description: 'Search selected ' + name + ' records',
    parameterDescriptions: Object.fromEntries(Object.keys(query.parameters ?? {}).map(key => [key, key])),
    example: structuredClone(query.probe ?? {}) }];
  return plan;
}
function newDraft() {
  if (state.pending) { view('operations'); return notice('Recover the current saved request before selecting another draft.', true); }
  if (!leaveEditor()) return;
  const name = $('source-query').value, query = state.data.source.queries[name];
  if (!query) return notice('The source declaration has no selectable named query.', true);
  fill({ title: name + ' search', queryName: name, query, input: query.probe ?? {}, plan: defaultPlan(name, query) }, false);
  view('draft'); notice('New draft. Save the query and intended merchant terms to keep its first revision.');
}
async function openDraft(id) {
  if (state.pending) { view('operations'); return notice('Recover the current saved request before selecting another draft.', true); }
  if (!leaveEditor()) return;
  const draft = await api('/api/drafts/' + encodeURIComponent(id));
  fill(draft); view('draft'); notice('Opened ' + draft.title + ' at revision ' + draft.revision + '.');
}
function renderDrafts() {
  const target = $('draft-list'); target.replaceChildren();
  const filter = $('draft-filter').value.toLowerCase();
  const drafts = state.data?.drafts?.filter(d => (d.title + ' ' + d.queryName).toLowerCase().includes(filter)) ?? [];
  for (const draft of drafts) {
    const button = element('button', undefined, { class: 'draft', type: 'button', 'aria-current': draft.id === state.draft?.id });
    button.append(element('strong', draft.title), element('span', draft.queryName + ' · revision ' + draft.revision));
    button.addEventListener('click', () => attempt(() => openDraft(draft.id)));
    target.append(button);
  }
  if (!drafts.length) target.append(element('p', filter ? 'No saved drafts match.' : 'Saved drafts will appear here.', { class: 'muted' }));
}
function displayAction(value) { $('action-json').textContent = pretty(value); $('action-result').open = true; }
function renderPending() {
  $('pending').hidden = !state.pending;
  $('pending-description').textContent = state.pending ? state.pending.kind + ' · ' + state.pending.payload.requestId : '';
}
async function acceptOperation(operation) {
  $('operation-json').textContent = pretty(operation);
  displayAction(operation);
  if (operation.state === 'RUNNING') {
    notice('Request ' + operation.id + ' is retained and still pending. Read its original result to recover the outcome.');
    return;
  }
  retainPending(null);
  if (operation.state === 'FAILED' || operation.state === 'INTERRUPTED') notice(errorMessage(operation.error), true);
  else if (operation.result?.draft) {
    fill(operation.result.draft); notice('Saved ' + operation.result.draft.title + ' at revision ' + operation.result.revision + '.');
  } else if (operation.result?.editionId) {
    await openEdition(operation.result.editionId);
    notice('Captured and retained edition ' + operation.result.editionId + '.');
  } else if (operation.result?.packageId) {
    await openPackage(operation.result.packageId);
    notice('Merchant package prepared through the original seller compiler.');
  } else notice('Native source inspection is saved with request ' + operation.id + '.');
}
async function transmitPending() {
  if (!state.pending) return;
  state.busy = true; buttons();
  try {
    const result = await api('/api/' + (state.pending.kind === 'save-draft' ? 'drafts' : state.pending.kind), state.pending.payload);
    await acceptOperation(result); await refresh();
  } catch (error) {
    if (error.requestRecorded === false) {
      retainPending(null); view('draft');
      notice(errorMessage(error) + ' The editor contents are retained; correct the draft and save again.', true);
    } else { notice(errorMessage(error) + ' The original request is retained for recovery.', true); view('operations'); }
  }
  finally { state.busy = false; buttons(); }
}
async function perform(kind, values) {
  if (state.pending) { view('operations'); return notice('Read or retry the existing saved request before creating another.', true); }
  const payload = { ...values, requestId: crypto.randomUUID() };
  if (new TextEncoder().encode(JSON.stringify(payload)).length > 1048576)
    throw new Error('The saved request exceeds 1 MiB. Reduce the editor contents before sending.');
  retainPending({ kind, payload });
  await transmitPending();
}
async function recover() {
  if (!state.pending) return;
  state.busy = true; buttons();
  try {
    await acceptOperation(await api('/api/operations/' + encodeURIComponent(state.pending.payload.requestId)));
    await refresh();
  } catch (error) {
    notice(error.status === 404 ? 'The original request has no saved result yet. Retry the same request ID and input to reconcile it.' : errorMessage(error), true);
  } finally { state.busy = false; buttons(); }
}
function recordList(target, items, describe, open) {
  target.replaceChildren();
  if (!items.length) return target.append(element('p', 'No saved items yet.', { class: 'empty' }));
  for (const item of items) {
    const box = element('div', undefined, { class: 'record' }), label = element('div');
    const description = describe(item);
    label.append(element('strong', description.title), element('span', description.detail));
    const button = element('button', 'Open', { type: 'button' }); button.addEventListener('click', () => attempt(() => open(item.id)));
    box.append(label, button); target.append(box);
  }
}
function totalLabel(total) {
  if (!total) return 'Provider total unavailable';
  return (total.relation === 'gte' ? 'At least ' : '') + total.value + ' provider matches' + (total.relation ? ' (' + total.relation + ')' : '');
}
function editionLabel(edition) { return edition.title + ' · r' + edition.draftRevision + ' · ' + edition.capturedAt; }
function renderEditions() {
  const editions = state.data.editions, target = $('edition-list'); target.replaceChildren();
  if (!editions.length) target.append(element('p', 'Capture a saved query to retain its first native result edition.', { class: 'empty' }));
  else {
    const table = element('table'), head = element('tr');
    for (const title of ['Draft', 'Captured', 'Hits', 'Provider total', 'Capture limit', '']) head.append(element('th', title));
    const thead = element('thead'); thead.append(head); table.append(thead);
    const tbody = element('tbody');
    for (const edition of editions) {
      const row = element('tr');
      for (const text of [edition.title + ' · r' + edition.draftRevision, edition.capturedAt, edition.hitCount,
        totalLabel(edition.total), edition.truncated ? 'Limit reached' : 'Within limit']) row.append(element('td', text));
      const cell = element('td'), button = element('button', 'Open'); button.addEventListener('click', () => attempt(() => openEdition(edition.id)));
      cell.append(button); row.append(cell); tbody.append(row);
    }
    table.append(tbody); target.append(table);
  }
  for (const id of ['compare-before', 'compare-after']) {
    const previous = $(id).value; $(id).replaceChildren(element('option', 'Choose an edition', { value: '' }));
    for (const edition of editions) $(id).append(element('option', editionLabel(edition), { value: edition.id }));
    if (editions.some(x => x.id === previous)) $(id).value = previous;
  }
}
function sourceField(value, path) {
  if (value && Object.hasOwn(value, path)) return value[path];
  for (const part of path.split('.')) { if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) return undefined; value = value[part]; }
  return value;
}
function preview(value) {
  const text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return text.length > 200 ? text.slice(0, 200) + '…' : text;
}
function renderHits() {
  const result = state.edition.result, hits = result.hits, size = 25;
  state.hitPage = Math.max(0, Math.min(state.hitPage, Math.max(0, Math.ceil(hits.length / size) - 1)));
  const offset = state.hitPage * size, shown = hits.slice(offset, offset + size), fields = result.fields ?? [];
  $('hits-page').textContent = hits.length ? (offset + 1) + '–' + (offset + shown.length) + ' of ' + hits.length + ' captured hits' : '0 captured hits';
  $('hits-previous').disabled = state.hitPage === 0; $('hits-next').disabled = offset + size >= hits.length;
  const table = element('table'), thead = element('thead'), head = element('tr');
  for (const name of ['Document', '_index', '_id', '_score', ...fields]) head.append(element('th', name));
  thead.append(head); table.append(thead); const tbody = element('tbody');
  for (const hit of shown) {
    const row = element('tr'), cell = element('td'), button = element('button', 'Details');
    button.addEventListener('click', () => { $('document-json').textContent = pretty(hit); $('document-detail').open = true; });
    cell.append(button); row.append(cell);
    for (const value of [hit._index, hit._id, hit._score, ...fields.map(name => sourceField(hit._source, name))]) row.append(element('td', preview(value)));
    tbody.append(row);
  }
  table.append(tbody); $('hit-table').replaceChildren(table);
}
async function openEdition(id) {
  const edition = await api('/api/editions/' + encodeURIComponent(id));
  state.edition = edition; state.hitPage = 0;
  $('edition-detail').hidden = false; $('edition-title').textContent = editionLabel(edition);
  $('edition-summary').textContent = edition.hitCount + ' captured hits · ' + totalLabel(edition.total) + ' · ' +
    (edition.truncated ? 'The configured capture limit was reached.' : 'Capture finished within its configured limit.');
  $('number-encoding').textContent = edition.numberEncoding ?
    'Number encoding: ' + edition.numberEncoding + '. Original unsafe integers retain decimal text and exactIntegerPaths in the downloaded JSON.' : '';
  const links = $('edition-downloads'); links.replaceChildren();
  for (const [format, label] of [['result.json', 'Original result JSON'], ['edition.json', 'Complete edition JSON'], ['results.csv', 'CSV export']])
    links.append(element('a', label, { href: '/api/editions/' + encodeURIComponent(id) + '/' + format }));
  const { result, ...metadata } = edition; $('edition-meta').textContent = pretty(metadata);
  $('document-json').textContent = ''; $('document-detail').open = false;
  renderHits(); view('editions');
}
async function compare() {
  const before = $('compare-before').value, after = $('compare-after').value;
  if (!before || !after) throw new Error('Choose two saved editions to compare.');
  const query = '?before=' + encodeURIComponent(before) + '&after=' + encodeURIComponent(after);
  const result = await api('/api/compare' + query);
  $('comparison').hidden = false;
  $('comparison-summary').textContent = result.counts.added + ' entered this result set · ' +
    result.counts.removed + ' left this result set · ' + result.counts.changed + ' changed content · ' +
    result.counts.unchanged + ' unchanged content · ' + result.counts.rankingChanged + ' changed ranking. ' +
    (result.scope.sameQueryInputAndProjection ? 'Same query, input and fields. ' : 'The query, input or fields differ. ') +
    (result.scope.sameNativeCluster === false ? 'The native clusters differ. ' :
      result.scope.sameNativeCluster === null ? 'Native cluster identity is unavailable for this comparison. ' : '') +
    (result.scope.eitherTruncated ? 'One or both captures reached their limit. ' : '') +
    'Identity uses [_index, _id]; PIT snapshot tie breakers are excluded from changes.';
  $('comparison-json').textContent = pretty(result);
  $('comparison-download').href = '/api/compare' + query + '&download=1'; $('comparison-download').hidden = false;
  notice('Compared the two retained result editions.');
}
async function openPackage(id) {
  const item = await api('/api/packages/' + encodeURIComponent(id));
  $('package-detail').hidden = false; $('package-title').textContent = item.title + ' · draft revision ' + item.draftRevision;
  $('package-location').textContent = item.directory;
  const files = element('div', undefined, { class: 'file-list' });
  for (const file of item.files) {
    const row = element('div');
    row.append(element('a', file.name, { href: '/api/packages/' + encodeURIComponent(id) + '/file?name=' + encodeURIComponent(file.name) }),
      element('small', file.bytes + ' bytes · SHA-256 ' + file.sha256));
    files.append(row);
  }
  $('package-files').replaceChildren(files);
  $('package-handoff').textContent = pretty({ handoff: item.handoff, sourceQuery: item.sourceQuery, note: item.launchNote });
  view('packages');
}
async function refresh() {
  state.data = await api('/api/state');
  $('identity').textContent = state.data.source.name + ' · ' + state.data.workspaceId;
  const selection = $('source-query').value;
  $('source-query').replaceChildren();
  for (const name of Object.keys(state.data.source.queries)) $('source-query').append(element('option', name, { value: name }));
  if (Object.hasOwn(state.data.source.queries, selection)) $('source-query').value = selection;
  renderDrafts(); renderEditions();
  recordList($('package-list'), state.data.packages, item => ({ title: item.title,
    detail: 'Revision ' + item.draftRevision + ' · ' + item.createdAt + ' · ' + item.files.length + ' files' }), openPackage);
  recordList($('operation-list'), state.data.operations, item => ({ title: item.kind + ' · ' + item.state,
    detail: item.createdAt + ' · ' + item.id }), async id => { $('operation-json').textContent = pretty(await api('/api/operations/' + encodeURIComponent(id))); });
  buttons();
}
async function attempt(action) { try { await action(); } catch (error) { notice(errorMessage(error), true); } }
for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => view(button.dataset.view));
for (const id of ['draft-title', 'query-name', 'query-json', 'input-json', 'plan-json']) $(id).addEventListener('input', () => { state.dirty = true; summary(); buttons(); });
$('draft-filter').addEventListener('input', renderDrafts);
$('new-draft').addEventListener('click', () => attempt(newDraft));
$('save').addEventListener('click', () => attempt(() => perform('save-draft', editor())));
$('validate').addEventListener('click', () => attempt(async () => {
  displayAction(await api('/api/validate', { draftId: state.draft.id, expectedRevision: state.draft.revision }));
  notice('The original source and merchant compilers accepted this saved revision.');
}));
for (const kind of ['inspect', 'capture', 'prepare']) $(kind).addEventListener('click', () => attempt(() => perform(kind,
  { draftId: state.draft.id, expectedRevision: state.draft.revision })));
$('recover').addEventListener('click', () => attempt(recover));
$('retry').addEventListener('click', () => attempt(transmitPending));
for (const id of ['refresh-editions', 'refresh-packages', 'refresh-operations']) $(id).addEventListener('click', () => attempt(refresh));
$('compare').addEventListener('click', () => attempt(compare));
$('hits-previous').addEventListener('click', () => { state.hitPage--; renderHits(); });
$('hits-next').addEventListener('click', () => { state.hitPage++; renderHits(); });
$('open-history').addEventListener('click', () => attempt(async () => {
  const history = await api('/api/history/' + encodeURIComponent(state.draft.id));
  const target = $('history-list'); target.replaceChildren();
  for (const draft of history.revisions) {
    const detail = element('details'), title = element('summary', 'Revision ' + draft.revision + ' · ' + draft.updatedAt);
    detail.append(title, element('pre', pretty(draft))); target.append(detail);
  }
  $('history').open = true;
}));
window.addEventListener('beforeunload', event => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });
await attempt(async () => {
  const session = await api('/api/session'); state.token = session.token; state.workspaceId = session.workspaceId;
  await refresh();
  try { state.pending = JSON.parse(localStorage.getItem(currentKey()) ?? 'null'); } catch { state.pending = null; }
  if (state.pending?.kind === 'save-draft') fill({ ...state.pending.payload, id: state.pending.payload.draftId,
    revision: state.pending.payload.expectedRevision }, false);
  else if (state.data.drafts.length) fill(await api('/api/drafts/' + encodeURIComponent(state.data.drafts[0].id)));
  else newDraft();
  renderPending(); buttons();
  if (state.pending) { view('operations'); notice('The previous browser request is retained. Read its original result or retry its same ID.'); }
  else notice('Workspace reopened. Saved drafts, native result editions and merchant packages are available.');
});
