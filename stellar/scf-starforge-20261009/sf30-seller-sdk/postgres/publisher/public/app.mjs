import { createSchedulePanel } from './schedules.mjs';
const $ = id => document.getElementById(id);
let schedulePanel;
const state = { source: null, snapshot: null, target: null, plan: null, dirty: false, selected: null,
  detail: null, detailVersion: null, editorHash: null, query: null, offer: null, busy: false, refreshing: false,
  pageSize: 25, offsets: { plans: 0, runs: 0, history: 0 } };
const friendly = {
  DATASET_INTEGER_REQUIRES_EXACT_STRING: 'An Integer column contains a fractional value or exceeds the exact integer range. Review the source type or use Text for exact identifiers.',
  DATASET_COLUMN_TYPE_MISMATCH: 'A selected dataset type does not match the declared source column. Exact decimals, large identifiers and timestamps can remain Text.',
  DATASET_EMPTY_NULL_CONFLICT: 'This nullable column contains a real empty string. The existing CSV format uses empty nullable cells for NULL. Review the approved source projection or choose a non-nullable text column.',
  DATASET_NULL_NOT_ALLOWED: 'A source NULL reached a column declared non-nullable. Review the column mapping.',
  DATASET_EXTRACTION_TOO_MANY_ROWS: 'The complete query exceeds the reviewed row limit. No candidate was published.',
  QUERY_TIMEOUT: 'The extraction reached its deadline. Review the query and limits before starting a new extraction.',
  EXTRACTION_INTERRUPTED: 'The prior process stopped during extraction. Recover a complete retained candidate if one exists, or start a new extraction.',
  PUBLICATION_OUTCOME_NOT_RECORDED: 'The process stopped before recording the publication result. Reconcile against the original target before another publication.',
};
const words = value => String(value ?? '').replaceAll('_', ' ').toLowerCase();
const short = value => value ? value.slice(0, 12) + '…' : '—';
const time = value => new Date(value).toISOString().slice(0, 19).replace('T', ' ');
function node(tag, text = '', attributes = {}) {
  const result = document.createElement(tag); result.textContent = text;
  for (const [key, value] of Object.entries(attributes)) result.setAttribute(key, value);
  return result;
}
function clear(element) { element.replaceChildren(); }
function notice(value) { $('notice').textContent = value; $('notice').hidden = !value; }
async function api(path, value) {
  const response = await fetch(path, value === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(friendly[result.error] ?? (result.message !== result.error ? result.message : words(result.error)));
  return result;
}
async function action(callback) {
  if (state.busy) return;
  state.busy = true; notice(''); buttons();
  try { await callback(); }
  catch (error) { notice(error.message); }
  finally { state.busy = false; buttons(); }
}
function buttons() {
  schedulePanel?.update();
  const running = state.snapshot?.active, selected = state.detail?.run, candidate = selected?.data.candidate;
  $('plan-form').querySelector('button[type=submit]').disabled = state.busy || Boolean(running);
  $('extract').disabled = state.busy || !state.plan || state.dirty || Boolean(running);
  $('cancel').hidden = running?.kind !== 'extraction' || running.id !== state.selected;
  $('cancel').disabled = state.busy;
  $('recover').hidden = !selected || !['INTERRUPTED', 'FAILED', 'CANCELLED', 'PUBLICATION_UNKNOWN'].includes(selected.state);
  $('recover').disabled = state.busy || Boolean(running);
  $('review-form').querySelector('button[type=submit]').disabled = state.busy || Boolean(running) || !candidate ||
    !state.target?.connected && !state.target?.initializable;
  $('publish').disabled = state.busy || Boolean(running) || !selected?.data.review || !['REVIEWED', 'PUBLICATION_UNKNOWN'].includes(selected.state);
  $('saved-plan').textContent = state.plan ? `Saved plan ${state.plan}${state.dirty ? ' · unsaved edits' : ' · ready to extract'}` : 'Save a plan before extraction.';
}
function inputChanged() { state.dirty = true; buttons(); }
function renderQuery(definition, saved) {
  state.query = definition;
  $('source-sql').textContent = typeof definition.sql === 'string' ? definition.sql : JSON.stringify(definition.serviceQuery && typeof definition.serviceQuery === 'object' && !Array.isArray(definition.serviceQuery) ? definition.serviceQuery : definition.path ? {
    path: definition.path, format: definition.format, recordsPointer: definition.recordsPointer,
    expectedSha256: definition.expectedSha256, mapping: definition.mapping, where: definition.where,
  } : { collection: definition.collection, pipeline: definition.pipeline, readConcern: definition.readConcern }, null, 2);
  $('source-hash').textContent = 'Source ' + short(state.editorHash);
  clear($('parameters'));
  for (const [name, spec] of Object.entries(definition.parameters)) {
    const label = node('label', name), wrapper = node('div');
    const input = spec.type === 'boolean' || spec.enum ? document.createElement('select') : document.createElement('input');
    input.dataset.parameter = name; input.dataset.type = spec.type;
    if (input.tagName === 'SELECT') {
      const choices = spec.type === 'boolean' ? ['true', 'false'] : spec.enum;
      for (const value of choices) input.append(node('option', String(value), { value: String(value) }));
    } else { input.type = 'text'; input.autocomplete = 'off'; }
    const value = saved?.input && Object.hasOwn(saved.input, name) ? saved.input[name] : spec.default;
    input.value = value === null || value === undefined ? '' : String(value);
    label.append(input); wrapper.append(label);
    if (spec.required === false) {
      const useLabel = node('label', 'Use parameter '), use = document.createElement('input');
      use.type = 'checkbox'; use.dataset.useParameter = name; use.checked = value !== undefined;
      input.disabled = !use.checked;
      use.addEventListener('change', () => {
        const nullBox = wrapper.querySelector('[data-null-parameter]');
        input.disabled = !use.checked || Boolean(nullBox?.checked); inputChanged();
      });
      useLabel.append(use); wrapper.append(useLabel);
    }
    if (spec.nullable) {
      const nullLabel = node('label', 'Use NULL '), box = document.createElement('input');
      box.type = 'checkbox'; box.dataset.nullParameter = name; box.checked = value === null;
      box.addEventListener('change', () => { input.disabled = box.checked || wrapper.querySelector('[data-use-parameter]')?.checked === false; inputChanged(); });
      input.disabled = box.checked || wrapper.querySelector('[data-use-parameter]')?.checked === false; nullLabel.append(box); wrapper.append(nullLabel);
    }
    $('parameters').append(wrapper);
  }
  clear($('columns'));
  for (const name of definition.columns) {
    const row = node('tr'); row.dataset.column = name;
    const enabled = document.createElement('input'); enabled.type = 'checkbox'; enabled.dataset.role = 'expose';
    enabled.checked = !saved || Object.hasOwn(saved.dataset.columns, name); enabled.setAttribute('aria-label', 'Expose ' + name);
    const enableCell = node('td'); enableCell.append(enabled); row.append(enableCell, node('td', name));
    const type = document.createElement('select'); type.dataset.role = 'type'; type.setAttribute('aria-label', name + ' type');
    for (const [value, label] of [['string', 'Text'], ['integer', 'Integer'], ['number', 'Float'], ['boolean', 'Boolean']])
      type.append(node('option', label, { value }));
    const declared = definition.columnTypes?.find(column => column.name === name);
    const spec = saved?.dataset.columns[name] ?? (!saved ? declared : undefined);
    type.value = typeof spec === 'string' ? spec : spec?.type ?? 'string';
    const typeCell = node('td'); typeCell.append(type); row.append(typeCell);
    for (const role of ['nullable', 'filters', 'ranges', 'sorts']) {
      const cell = node('td'), box = document.createElement('input'); box.type = 'checkbox'; box.dataset.role = role;
      box.setAttribute('aria-label', name + ' ' + role);
      box.checked = role === 'nullable' ? Boolean(spec?.nullable) : Boolean(saved?.dataset[role]?.includes(name));
      cell.append(box); row.append(cell);
    }
    $('columns').append(row);
  }
  $('order').value = saved ? saved.extraction.order.map(item => (item.direction === 'desc' ? '-' : '') + item.column).join(', ') : definition.columns[0];
}
async function freshPlan() {
  if (state.dirty && !window.confirm('Discard the unsaved extraction plan edits and start a new plan?')) return;
  state.source = await api('/api/source'); state.editorHash = state.source.hash;
  state.plan = null; state.dirty = false;
  clear($('query-name'));
  for (const name of Object.keys(state.source.queries)) $('query-name').append(node('option', name, { value: name }));
  renderQuery(state.source.queries[$('query-name').value]); buttons();
}
function planInput() {
  const input = {};
  for (const element of $('parameters').querySelectorAll('[data-parameter]')) {
    const useBox = [...$('parameters').querySelectorAll('[data-use-parameter]')].find(box => box.dataset.useParameter === element.dataset.parameter);
    if (useBox && !useBox.checked) continue;
    const nullBox = [...$('parameters').querySelectorAll('[data-null-parameter]')].find(box => box.dataset.nullParameter === element.dataset.parameter);
    input[element.dataset.parameter] = nullBox?.checked ? null : element.dataset.type === 'boolean' ? element.value === 'true' : element.value;
  }
  const columns = {}, filters = [], ranges = [], sorts = [];
  for (const row of $('columns').children) {
    const item = role => row.querySelector(`[data-role=${role}]`), name = row.dataset.column;
    if (!item('expose').checked) continue;
    columns[name] = { type: item('type').value, nullable: item('nullable').checked };
    if (item('filters').checked) filters.push(name); if (item('ranges').checked) ranges.push(name); if (item('sorts').checked) sorts.push(name);
  }
  return { title: $('plan-title').value, query: $('query-name').value, input, sourceHash: state.editorHash,
    dataset: { name: $('dataset-name').value, columns, filters, ranges, sorts,
      defaultLimit: Number($('default-limit').value), maxLimit: Number($('max-limit').value) },
    extraction: { maxRows: Number($('max-rows').value), maxBytes: Number($('max-mib').value) * 1048576,
      maxRowBytes: 1048576, timeoutMs: Number($('timeout').value) * 1000,
      order: $('order').value.split(',').map(value => value.trim()).filter(Boolean).map(value => ({
        column: value.startsWith('-') ? value.slice(1) : value, direction: value.startsWith('-') ? 'desc' : 'asc' })) } };
}
async function choosePlan(id) {
  if (state.dirty && !window.confirm('Discard the unsaved extraction plan edits and open this saved plan?')) return;
  const saved = await api('/api/plans/' + id), value = saved.data;
  state.plan = saved.id; state.dirty = false; state.editorHash = value.sourceHash;
  if (![...$('query-name').options].some(option => option.value === value.query)) $('query-name').append(node('option', value.query, { value: value.query }));
  $('query-name').value = value.query; $('plan-title').value = value.title; $('dataset-name').value = value.dataset.name;
  $('max-rows').value = value.extraction.maxRows; $('max-mib').value = value.extraction.maxBytes / 1048576;
  $('timeout').value = value.extraction.timeoutMs / 1000; $('default-limit').value = value.dataset.defaultLimit; $('max-limit').value = value.dataset.maxLimit;
  renderQuery(value.sourceQuery, value); renderLists(); buttons();
}
function pager(name, title) {
  const box = $(name + '-pages'), page = state.snapshot?.pages?.[name]; clear(box);
  if (!page) return;
  const count = state.snapshot[name].length;
  box.append(node('span', page.total ? `${page.offset + (count ? 1 : 0)}–${page.offset + count} of ${page.total}` : '0 saved', { class: 'muted' }));
  for (const [key, label] of [['previous', 'Newer'], ['next', 'Older']]) {
    const button = node('button', label, { type: 'button', 'aria-label': title + ' ' + label.toLowerCase() });
    button.disabled = page[key] === null;
    button.addEventListener('click', () => action(async () => { state.offsets[name] = page[key]; await refresh(); }));
    box.append(button);
  }
}
function renderLists() {
  clear($('plans')); clear($('runs'));
  for (const plan of state.snapshot?.plans ?? []) {
    const button = node('button'); button.type = 'button'; if (plan.id === state.plan) button.classList.add('selected');
    button.append(node('strong', plan.data.title), node('span', `Plan ${plan.id} · ${plan.data.query}`));
    button.addEventListener('click', () => action(() => choosePlan(plan.id))); $('plans').append(button);
  }
  if (!$('plans').children.length) $('plans').append(node('p', 'No saved plans.', { class: 'muted' }));
  for (const run of state.snapshot?.runs ?? []) {
    const button = node('button'); button.type = 'button'; if (run.id === state.selected) button.classList.add('selected');
    button.append(node('strong', words(run.state)), node('span', `${time(run.created)} · plan ${run.plan}`));
    button.addEventListener('click', () => action(async () => {
      state.selected = run.id; state.detailVersion = null; state.offer = null; await loadRun(); renderLists();
    })); $('runs').append(button);
  }
  if (!$('runs').children.length) $('runs').append(node('p', 'Extract a saved plan to create a retained candidate.', { class: 'muted' }));
  pager('plans', 'Plans'); pager('runs', 'Extractions');
}
function table(result) {
  clear($('preview')); if (!result) return;
  const table = node('table'), head = node('thead'), headings = node('tr'), body = node('tbody');
  for (const name of result.fields) headings.append(node('th', name)); head.append(headings); table.append(head);
  for (const row of result.rows) {
    const tr = node('tr'); for (const name of result.fields) tr.append(node('td', row[name] === null ? 'NULL' : String(row[name]))); body.append(tr);
  }
  table.append(body); $('preview').append(table, node('p', `${result.page.returned} shown · ${result.page.total} matching rows`, { class: 'muted' }));
}
function renderDetail(detail) {
  state.detail = detail; const saved = detail.run, candidate = saved.data.candidate;
  $('candidate-title').textContent = detail.plan.data.title; $('run-state').textContent = words(saved.state);
  $('run-error').hidden = !saved.data.error; $('run-error').textContent = friendly[saved.data.error] ?? words(saved.data.error);
  clear($('run-summary'));
  if (candidate) {
    const observationMetric = candidate.extraction.transaction ? ['Transaction', 'Read only'] :
      ['Observation', candidate.extraction.capture ? 'Complete file' : candidate.extraction.observation?.kind === 'SINGLE_SPREADSHEET_RESPONSE' ? 'Single response' : 'Retained'];
    for (const [label, value] of [['Rows', candidate.dataset.rowCount.toLocaleString()], ['CSV MiB', (candidate.csvBytes / 1048576).toFixed(3)],
      ['Dataset version', short(candidate.dataset.snapshot)], observationMetric]) {
      const item = node('div', '', { class: 'metric' }); item.append(node('span', label), node('strong', value)); $('run-summary').append(item);
    }
    $('candidate-source').textContent = JSON.stringify({ sourceHash: candidate.sourceHash, queryHash: candidate.queryHash,
      csvHash: candidate.csvHash, transaction: candidate.extraction.transaction,
      observation: candidate.extraction.observation, capture: candidate.extraction.capture,
      sourceQuery: candidate.extraction.sourceQuery, columnTypes: candidate.extraction.columnTypes }, null, 2);
  }
  $('source-details').hidden = !candidate; $('preview-form').hidden = !candidate; table(detail.preview);
  $('review-panel').hidden = !candidate; $('buyer-panel').hidden = !candidate || !state.snapshot?.buyer;
  const review = saved.data.review;
  $('review-status').textContent = review ? `Reviewed by ${review.reviewer} at ${time(review.recordedAt)}. ${review.note}` : 'No publication review recorded for this candidate.';
  if (saved.data.publication) $('review-status').textContent += ` Original target version ${short(saved.data.publication.snapshot)}, revision ${saved.data.publication.revision}.`;
  $('initialize-guide').hidden = !state.target?.initializable;
  $('buyer-prepare-form').hidden = !state.offer;
  if (!state.offer) { clear($('buyer-terms')); clear($('buyer-option')); }
  buttons();
}
async function loadRun(force = false, query) {
  if (!state.selected) return;
  const latest = state.snapshot?.runs.find(item => item.id === state.selected),
    key = state.selected + ':' + latest?.updated + ':' + latest?.state + ':' + latest?.data.review?.id;
  if (!force && state.detailVersion === key) return;
  const selected = state.selected;
  const detail = await api('/api/run?id=' + encodeURIComponent(selected) + (query ? '&query=' + encodeURIComponent(query) : ''));
  if (selected !== state.selected) return;
  state.detailVersion = key; renderDetail(detail);
}
function renderTarget() {
  const target = state.target;
  $('target-state').textContent = target?.connected ? `Running · revision ${target.versions.revision}` : target?.initializable ? 'New dataset target' : 'Seller is offline';
  $('target-detail').textContent = target?.connected ? `${target.dataset.name} · ${target.dataset.rowCount.toLocaleString()} rows · ${short(target.versions.current)}` : target?.directory ?? '';
  $('review-target').textContent = target?.connected ? `This review is bound to current version ${short(target.versions.current)}, revision ${target.versions.revision}. Intervening changes require a fresh review.` :
    target?.initializable ? 'This publication will initialize a new original dataset version store.' : 'Start the original dataset seller to review and publish against its current version.';
  $('initialize-guide').hidden = !target?.initializable;
}
async function refresh() {
  if (state.refreshing) return; state.refreshing = true;
  try {
    const parameters = new URLSearchParams({ limit: state.pageSize, ...Object.fromEntries(
      Object.entries(state.offsets).map(([key, value]) => [key + 'Offset', value])) });
    const [snapshot, target] = await Promise.all([api('/api/status?' + parameters), api('/api/target')]);
    state.snapshot = snapshot; state.target = target;
    const running = snapshot.active;
    $('activity').textContent = running ? `${words(running.kind)}${running.progress.rows === undefined ? '' : ' · ' + running.progress.rows.toLocaleString() + ' rows'}` : 'Idle';
    renderLists(); renderTarget();
    clear($('history'));
    for (const event of snapshot.history) {
      const item = node('div'); item.append(node('time', time(event.created)), node('span', words(event.kind) + (event.run ? ' · ' + short(event.run) : ''))); $('history').append(item);
    }
    pager('history', 'History');
    if (!state.selected && snapshot.runs.length) state.selected = snapshot.runs[0].id;
    await loadRun(); await schedulePanel?.refresh(); buttons();
  } finally { state.refreshing = false; }
}
$('plan-form').addEventListener('input', inputChanged);
$('query-name').addEventListener('change', () => {
  const query = state.source.queries[$('query-name').value];
  if (!query) return notice('Load a new plan to review the current source.');
  state.plan = null; state.editorHash = state.source.hash; renderQuery(query); inputChanged();
});
$('new-plan').addEventListener('click', () => action(freshPlan));
$('refresh').addEventListener('click', () => action(refresh));
$('page-size').addEventListener('change', () => action(async () => {
  state.pageSize = Number($('page-size').value); state.offsets = { plans: 0, runs: 0, history: 0 }; await refresh();
}));
window.addEventListener('beforeunload', event => {
  if (state.dirty || schedulePanel?.dirty) { event.preventDefault(); event.returnValue = ''; }
});
$('plan-form').addEventListener('submit', event => { event.preventDefault(); action(async () => {
  const saved = await api('/api/plans', planInput()); state.plan = saved.id; state.dirty = false; state.offsets.plans = 0;
  await refresh(); notice('Plan ' + saved.id + ' saved with its original source configuration.');
}); });
$('extract').addEventListener('click', () => action(async () => {
  const started = await api('/api/extract', { plan: state.plan }); state.selected = started.id; state.detailVersion = null;
  state.offsets.runs = 0; state.offer = null; await refresh(); notice('Extraction started. The current published dataset remains available.');
}));
$('cancel').addEventListener('click', () => action(async () => { await api('/api/cancel', { id: state.selected }); await refresh(); }));
$('recover').addEventListener('click', () => action(async () => {
  const result = await api('/api/recover', { id: state.selected }); state.detailVersion = null; await refresh();
  notice(result.recovery ?? 'Retained state reconciled without repeating the database query.');
}));
$('preview-form').addEventListener('submit', event => { event.preventDefault(); action(() => loadRun(true, $('preview-query').value)); });
$('review-form').addEventListener('submit', event => { event.preventDefault(); action(async () => {
  const target = state.target;
  await api('/api/review', { id: state.selected, reviewer: $('reviewer').value, note: $('review-note').value,
    initialize: target?.initializable === true, expectedSnapshot: target?.versions?.current, expectedRevision: target?.versions?.revision });
  state.detailVersion = null; await refresh(); notice('Review saved. Publish uses this exact candidate and target revision.');
}); });
$('publish').addEventListener('click', () => action(async () => {
  const result = await api('/api/publish', { id: state.selected, reviewId: state.detail.run.data.review.id });
  state.detailVersion = null; state.offer = null; await refresh();
  notice(result.state === 'PUBLISHED' ? 'The original dataset target now retains this published version.' : friendly[result.data.error] ?? words(result.data.error));
}));
$('buyer-offer-form').addEventListener('submit', event => { event.preventDefault(); action(async () => {
  const selected = state.selected, query = $('buyer-query').value;
  const offer = await api('/api/buyer?id=' + encodeURIComponent(selected) + '&query=' + encodeURIComponent(query));
  if (state.selected !== selected || $('buyer-query').value !== query) return;
  state.offer = offer;
  clear($('buyer-option')); clear($('buyer-terms'));
  for (const [index, option] of state.offer.accepts.entries()) $('buyer-option').append(node('option', `${index + 1} · ${option.network} · ${option.amount} atomic`, { value: String(index) }));
  $('buyer-terms').append(node('p', state.offer.url, { class: 'mono' }), node('pre', JSON.stringify(state.offer.accepts, null, 2)));
  $('buyer-prepare-form').hidden = false;
}); });
$('buyer-query').addEventListener('input', () => {
  state.offer = null; $('buyer-prepare-form').hidden = true; clear($('buyer-terms')); clear($('buyer-option'));
});
$('buyer-prepare-form').addEventListener('submit', event => { event.preventDefault(); action(async () => {
  const prepared = await api('/api/buyer', { id: state.selected, query: $('buyer-query').value,
    intentId: $('buyer-intent').value, acceptIndex: Number($('buyer-option').value), offerSha256: state.offer.offerSha256 });
  const url = URL.createObjectURL(new Blob([prepared.configText], { type: 'application/json' }));
  const link = node('a', 'Download', { href: url, download: 'dataset-buyer.json' }); document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000); notice('Original buyer configuration downloaded and retained with this extraction.'); await refresh();
}); });
schedulePanel = createSchedulePanel({ api, action, notice, context: () => state,
  async openRun(id) {
    state.selected = id; state.detailVersion = null; state.offer = null;
    await loadRun(true); renderLists();
    $('candidate').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } });
await action(async () => { await freshPlan(); await refresh(); });
setInterval(() => refresh().catch(error => notice(error.message)), 4000);
