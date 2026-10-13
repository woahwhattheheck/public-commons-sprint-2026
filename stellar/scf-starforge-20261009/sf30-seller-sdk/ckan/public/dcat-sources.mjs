// MIT. Recurring DCAT source editions in the original catalogue workspace.
import { parseDcatJson, parseDcatJsonText, stringifyDcatJson } from './dcat-json.mjs';
const memories = new Map();
const pageSize = 20;
function node(tag, attrs = {}, ...children) {
  const result = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith('on')) result.addEventListener(key.slice(2), value);
    else if (['disabled', 'selected', 'checked', 'readOnly'].includes(key)) result[key] = Boolean(value);
    else if (value !== null && value !== undefined) result.setAttribute(key, value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined)
    result.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return result;
}
const note = value => node('p', { class: 'muted' }, value);
const card = (...children) => node('section', { class: 'card' }, ...children);
const row = (...children) => node('div', { class: 'row' }, ...children);
const field = (name, control) => node('label', { class: 'grow' }, name, control);
const input = (name, value = '', attrs = {}) => node('input', { name, value, ...attrs });
const details = (label, value) => node('details', {}, node('summary', {}, label),
  node('pre', { class: 'migration-value' }, stringifyDcatJson(value, null, 2)));
const time = value => {
  if (!value) return 'Not yet';
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf())
    ? parsed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : String(value);
};
function select(name, choices, value) {
  return node('select', { name }, choices.map(([key, label]) =>
    node('option', { value: key, selected: String(key) === String(value ?? '') }, label)));
}
function bind(control, callback) {
  control.addEventListener('input', callback); control.addEventListener('change', callback); return control;
}
function table(headers, values) {
  return node('div', { class: 'table-wrap' }, node('table', {},
    node('thead', {}, node('tr', {}, headers.map(value => node('th', {}, value)))),
    node('tbody', {}, values.map(values => node('tr', {}, values.map(value => node('td', {}, value)))))));
}
function action(ctx, label, callback, disabled = false) {
  const button = node('button', { type: 'button', disabled }, label);
  button.addEventListener('click', () => ctx.protect(async () => {
    if (button.disabled || !ctx.current()) return;
    button.disabled = true;
    try { return await callback(); } finally { if (button.isConnected) button.disabled = disabled; }
  }));
  return button;
}
async function api(ctx, path, value) {
  const response = await fetch('/api/' + path, { method: value === undefined ? 'GET' : 'POST',
    headers: { authorization: 'Bearer ' + ctx.token, ...(value === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(value === undefined ? {} : { body: stringifyDcatJson(value) }) });
  const output = parseDcatJson(new Uint8Array(await response.arrayBuffer()));
  if (!response.ok) throw new Error((output.error ?? response.status) + ': ' + (output.message ?? 'Source operation failed.'));
  return output;
}
function memoryFor(state) {
  const key = stringifyDcatJson([state.createdAt, state.catalogOrigin]);
  if (!memories.has(key)) memories.set(key, { selected: '', editing: null, draft: null,
    editorBaseSha256: null, retainedSourceDraft: null, pendingSourceId: null, reviewDrafts: new Map(), baselineReports: new Map(),
    attemptOffset: 0, attemptQuery: '', attemptStatus: '', unconditional: false, pending: false });
  return memories.get(key);
}
function draftFor(source) {
  return { label: source?.label ?? '', url: source?.url ?? '', profile: source?.profile ?? 'auto',
    authTokenEnv: source?.authTokenEnv ?? '', intervalMinutes: source?.intervalMinutes ?? 60,
    timeoutMs: source?.timeoutMs ?? 30000, maxResponseBytes: source?.maxResponseBytes ?? 134217728,
    enabled: source?.enabled !== false };
}
function reviewDraft(memory, source) {
  const key = stringifyDcatJson([source.id, source.sourceSha256, source.latestCatalogId]);
  if (!memory.reviewDrafts.has(key)) memory.reviewDrafts.set(key, {
    baselineReleaseId: '', reuseMappingIndexes: [], candidateId: '', normalizeV3: false,
    label: '', identityMappingsText: '[]', mappingQuery: '', mappingPage: 0,
  });
  return memory.reviewDrafts.get(key);
}
function downloadJson(value, filename) {
  const href = URL.createObjectURL(new Blob([stringifyDcatJson(value, null, 2) + '\n'],
    { type: 'application/json' }));
  const link = node('a', { href, download: filename });
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
async function mutate(ctx, memory, path, value, receive) {
  if (ctx.state.active || memory.pending) throw new Error('Follow the current workspace operation before starting another.');
  memory.pending = true;
  try {
    const result = await api(ctx, path, value);
    receive?.(result); ctx.acceptOperation(result);
    await ctx.refresh();
    return result;
  } finally { memory.pending = false; }
}
function sourceEditor(ctx, memory, source) {
  if (!memory.draft) memory.draft = draftFor(source);
  const draft = memory.draft;
  const label = bind(input('source-label', draft.label, { maxlength: '512', required: '' }), () => { draft.label = label.value; });
  const url = bind(input('source-url', draft.url, { type: 'url', maxlength: '4096', required: '' }),
    () => { draft.url = url.value; });
  const profile = bind(select('source-profile', [['auto', 'Detect original document'], ['1.1', 'DCAT-US 1.1'], ['3.0', 'DCAT-US 3.0']], draft.profile),
    () => { draft.profile = profile.value; });
  const token = bind(input('source-token-environment', draft.authTokenEnv, { maxlength: '128', autocomplete: 'off' }),
    () => { draft.authTokenEnv = token.value; });
  const interval = bind(input('source-interval-minutes', draft.intervalMinutes, { type: 'number', min: '1', max: '525600', step: '1' }),
    () => { draft.intervalMinutes = interval.value; });
  const timeout = bind(input('source-timeout-ms', draft.timeoutMs, { type: 'number', min: '100', max: '300000', step: '1' }),
    () => { draft.timeoutMs = timeout.value; });
  const maximum = bind(input('source-max-bytes', draft.maxResponseBytes, { type: 'number', min: '1024', max: '134217728', step: '1' }),
    () => { draft.maxResponseBytes = maximum.value; });
  const enabled = bind(input('source-enabled', '', { type: 'checkbox', checked: draft.enabled }),
    () => { draft.enabled = enabled.checked; });
  const changed = source && source.sourceSha256 !== memory.editorBaseSha256;
  return card(node('h3', {}, source ? 'Edit retained source' : 'Add a catalogue source'),
    note('Retain the complete downloaded documents and HTTP history in this project. Enter the name of a private token environment variable; its value stays in the application environment.'),
    row(field('Source label', label), field('Original publication URL', url)),
    row(field('Document profile', profile), field('Private token environment name · optional', token)),
    row(field('Check interval · minutes', interval), field('Request timeout · milliseconds', timeout),
      field('Maximum response bytes', maximum)),
    field('Include this source in due checks', enabled),
    note('The interval marks when this source is due. Run the installed acquire-due command through your existing scheduler, or acquire manually here. Pausing due checks keeps manual acquisition available.'),
    source ? note('Saving a changed configuration begins a new source version. Acquire it before reviewing its latest edition; all preceding versions and received documents remain saved.') : null,
    changed ? note('This source configuration changed after you opened its editor. Download your retained draft, then reopen the current source before saving.') : null,
    row(action(ctx, source ? 'Save source changes' : 'Save source', async () => {
      for (const control of [label, url, interval, timeout, maximum])
        if (!control.reportValidity()) throw new Error('Complete the source fields using their displayed limits.');
      if (draft.authTokenEnv && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(draft.authTokenEnv))
        throw new Error('Use an environment-variable name for the private token.');
      const value = { ...draft, authTokenEnv: draft.authTokenEnv || null };
      for (const key of ['intervalMinutes', 'timeoutMs', 'maxResponseBytes']) {
        value[key] = Number(draft[key]);
        if (!Number.isSafeInteger(value[key])) throw new Error('Use whole numbers for source request limits.');
      }
      if (source) Object.assign(value, { id: source.id, expectedSourceSha256: memory.editorBaseSha256 });
      await mutate(ctx, memory, 'dcat/sources/save', value, result => {
        memory.retainedSourceDraft = { draft: { ...draft }, editing: source?.id ?? 'new', savedId: result.sourceId ?? source?.id ?? '', baseSha256: memory.editorBaseSha256 };
        memory.selected = result.sourceId ?? source?.id ?? '';
        memory.pendingSourceId = memory.selected;
        memory.editing = null; memory.draft = null; memory.editorBaseSha256 = null;
      });
    }, Boolean(ctx.state.active) || Boolean(changed)),
    action(ctx, 'Download source draft', () => downloadJson(draft, 'dcat-source-configuration-draft.json')),
    action(ctx, 'Cancel source edit', async () => { memory.editing = null; memory.draft = null; await ctx.render(); })));
}
function mappingDecisions(ctx, draft, report) {
  const mappings = report.identity_mappings ?? [];
  if (!Array.isArray(mappings)) throw new Error('The accepted review has an invalid identity-mapping inventory.');
  const host = node('div');
  if (!mappings.length) { host.append(note('This accepted review contains no explicit identity mappings to carry forward.')); return host; }
  const query = bind(input('source-mapping-search', draft.mappingQuery, { type: 'search', placeholder: 'Original identity or JSON pointer' }),
    () => { draft.mappingQuery = query.value; draft.mappingPage = 0; render(); });
  const results = node('div');
  host.append(note('Select each accepted identity decision you intend to reuse. The original typed identifiers and pointers are shown below; the engine resolves them against this edition and reports any ambiguous or missing identity.'),
    field('Find an accepted identity decision', query), results);
  function render() {
    const term = draft.mappingQuery.toLocaleLowerCase().trim();
    const found = mappings.map((value, index) => ({ value, index }))
      .filter(item => !term || stringifyDcatJson(item.value).toLocaleLowerCase().includes(term));
    const pages = Math.max(1, Math.ceil(found.length / pageSize));
    draft.mappingPage = Math.min(Math.max(0, draft.mappingPage), pages - 1);
    const start = draft.mappingPage * pageSize;
    const chosen = new Set(draft.reuseMappingIndexes);
    results.replaceChildren(table(['Reuse', 'Source identity and path', 'Accepted identity and path', 'Original decision'], found.slice(start, start + pageSize).map(({ value, index }) => {
      const check = input('source-reuse-mapping-' + index, '', { type: 'checkbox', checked: chosen.has(index),
        'aria-label': 'Reuse accepted identity decision ' + (index + 1) });
      check.addEventListener('change', () => {
        const selected = new Set(draft.reuseMappingIndexes);
        if (check.checked) selected.add(index); else selected.delete(index);
        draft.reuseMappingIndexes = [...selected].sort((a, b) => a - b);
        count.textContent = draft.reuseMappingIndexes.length + ' of ' + mappings.length + ' accepted decisions selected.';
      });
      return [check, node('div', {}, node('code', {}, value.source_path ?? ''),
        node('pre', { class: 'migration-value' }, stringifyDcatJson(value.source_identifier, null, 2))),
      node('div', {}, node('code', {}, value.target_path ?? ''),
        node('pre', { class: 'migration-value' }, stringifyDcatJson(value.target_identifier, null, 2))),
      details('Complete typed decision · index ' + index, value)];
    })));
    const count = note(draft.reuseMappingIndexes.length + ' of ' + mappings.length + ' accepted decisions selected.');
    results.append(count, row(action(ctx, 'Previous decisions', async () => { draft.mappingPage--; render(); }, draft.mappingPage === 0),
      note(found.length ? (start + 1) + '–' + Math.min(start + pageSize, found.length) + ' of ' + found.length + ' matching decisions' : 'No matching decisions'),
      action(ctx, 'Following decisions', async () => { draft.mappingPage++; render(); }, draft.mappingPage + 1 >= pages)));
  }
  render(); return host;
}
async function acceptedBaseline(ctx, memory, release) {
  const key = stringifyDcatJson([release.id, release.reviewId, release.reviewSha256, release.sha256]);
  if (memory.baselineReports.has(key)) return memory.baselineReports.get(key);
  const report = await api(ctx, 'dcat/reviews/' + encodeURIComponent(release.reviewId));
  if (report.review_sha256 !== release.reviewSha256 || report.candidate?.sha256 !== release.sha256)
    throw new Error('The selected accepted release and its complete retained review differ. Refresh the workspace before preparing a following edition.');
  memory.baselineReports.set(key, report); return report;
}
async function reviewPanel(ctx, memory, source, dcat, callbacks) {
  const latest = dcat.catalogs.find(value => value.id === source.latestCatalogId);
  if (!latest) return card(node('h3', {}, 'Review the latest acquired edition'),
    note('Acquire this source configuration first. Earlier source versions, documents and reviews remain available in their retained histories.'));
  const draft = reviewDraft(memory, source);
  const selectedRelease = dcat.releases.find(value => value.id === draft.baselineReleaseId);
  const baseline = select('source-baseline-release', [['', 'No accepted predecessor'], ...dcat.releases.map(value => [
    value.id, time(value.createdAt) + (value.id === dcat.activeReleaseId ? ' · active' : '') + ' · ' + value.id
  ])], draft.baselineReleaseId);
  baseline.addEventListener('change', () => ctx.protect(async () => {
    draft.baselineReleaseId = baseline.value; draft.reuseMappingIndexes = []; draft.mappingPage = 0;
    await ctx.render();
  }));
  const candidate = bind(select('source-corrected-candidate', [['', 'New conversion or preserved acquired source'], ...dcat.catalogs.map(value => [
    value.id, (value.label || value.id) + ' · ' + time(value.receivedAt)
  ])], draft.candidateId), () => { draft.candidateId = candidate.value; });
  const normalize = bind(input('source-normalize-v3', '', { type: 'checkbox', checked: draft.normalizeV3 }),
    () => { draft.normalizeV3 = normalize.checked; });
  const label = bind(input('source-review-label', draft.label, { maxlength: '512' }), () => { draft.label = label.value; });
  const mappings = node('textarea', { name: 'source-identity-mappings', rows: '5', spellcheck: 'false', class: 'mono' }, draft.identityMappingsText);
  bind(mappings, () => { draft.identityMappingsText = mappings.value; });
  const host = card(node('h3', {}, 'Review the latest acquired edition'),
    node('p', {}, (latest.label || latest.id) + ' · ' + time(latest.receivedAt)),
    field('Current acquired catalogue SHA-256', input('source-latest-sha256', latest.sha256, { readOnly: true, class: 'mono' })),
    note('The source configuration and latest catalogue are bound to this review. Select an accepted release to compare against; the preceding accepted candidate remains unchanged.'),
    row(field('Accepted predecessor release', baseline), field('This edition’s corrected candidate · optional', candidate)),
    row(field('Review label · optional', label), field('Explicitly normalize a flat DCAT-US 3.0 catalogue', normalize)),
    note('The automatic candidate comes from the current acquired source. Upload an edited candidate through Receive catalogue below, then select that retained document explicitly.'),
    action(ctx, 'Download latest acquired source', () => ctx.download('dcat/catalogs/' + encodeURIComponent(latest.id) + '/download', 'dcat-source-' + latest.id + '.json')));
  let baselineError = null, baselineReport = null;
  if (draft.baselineReleaseId && !selectedRelease) baselineError = 'The selected accepted release is no longer in this workspace inventory. Select its current retained record.';
  if (selectedRelease) {
    host.append(details('Accepted predecessor release', selectedRelease),
      row(action(ctx, 'Open accepted predecessor review', async () => {
        callbacks.onReviewCreated?.(selectedRelease.reviewId); await ctx.render();
      }), action(ctx, 'Download accepted predecessor candidate', () => ctx.download(
        'dcat/reviews/' + encodeURIComponent(selectedRelease.reviewId) + '/candidate', 'dcat-accepted-' + selectedRelease.id + '.json'))));
    try { baselineReport = await acceptedBaseline(ctx, memory, selectedRelease); }
    catch (error) { baselineError = error.message || String(error); }
    if (!ctx.current()) return host;
    if (baselineReport) host.append(mappingDecisions(ctx, draft, baselineReport));
  }
  if (baselineError) host.append(node('p', { role: 'alert' }, baselineError),
    action(ctx, 'Read accepted baseline again', () => ctx.render()));
  host.append(node('details', {}, node('summary', {}, 'Additional explicit identity mappings'),
    note('Use a JSON array of source_path, target_path, source_identifier and target_identifier values for this edition. Preserve each identifier’s original JSON type, including complete identifier objects. The existing review viewer can also build these decisions from actual record rows.'),
    field('This edition’s identity mappings · JSON', mappings)),
    row(action(ctx, 'Prepare source edition review', async () => {
      const identityMappings = parseDcatJsonText(draft.identityMappingsText || '[]');
      if (!Array.isArray(identityMappings)) throw new Error('Identity mappings must be a JSON array.');
      if (draft.baselineReleaseId && !selectedRelease) throw new Error('Select a retained accepted predecessor release.');
      if (baselineError) throw new Error(baselineError);
      const value = {
        sourceId: source.id, expectedSourceSha256: source.sourceSha256,
        expectedLatestCatalogId: latest.id, baselineReleaseId: selectedRelease?.id ?? null,
        ...(selectedRelease ? { expectedBaselineSha256: selectedRelease.sha256,
          expectedBaselineReviewSha256: selectedRelease.reviewSha256 } : {}),
        ...(draft.reuseMappingIndexes.length ? { reuseMappingIndexes: draft.reuseMappingIndexes.slice() } : {}),
        ...(identityMappings.length ? { identityMappings } : {}),
        ...(draft.candidateId ? { candidateId: draft.candidateId } : {}),
        ...(draft.label.trim() ? { label: draft.label.trim() } : {}),
        normalizeV3: draft.normalizeV3,
      };
      await mutate(ctx, memory, 'dcat/sources/review', value, result => {
        if (result.reviewId) callbacks.onReviewCreated?.(result.reviewId);
      });
    }, Boolean(ctx.state.active) || Boolean(baselineError)),
    action(ctx, 'Download this review selection', () => downloadJson({
      sourceId: source.id, sourceSha256: source.sourceSha256, latestCatalogId: latest.id, ...draft,
    }, 'dcat-source-review-selection.json'))));
  return host;
}
function sourceCooldown(source) {
  return typeof source.retryNotBefore === 'string' && Date.parse(source.retryNotBefore) > Date.now();
}
function acquire(ctx, memory, source, retryOf) {
  return mutate(ctx, memory, 'dcat/sources/acquire', {
    sourceId: source.id, expectedSourceSha256: source.sourceSha256,
    expectedLatestCatalogId: source.latestCatalogId ?? null, unconditional: memory.unconditional,
    ...(retryOf ? { retryOf } : {}),
  });
}
function historyPanel(ctx, memory, source, attempts, reviews, callbacks) {
  const all = attempts.filter(value => value.sourceId === source.id).slice().sort((a, b) =>
    String(b.startedAt ?? '').localeCompare(String(a.startedAt ?? '')) || String(b.id).localeCompare(String(a.id)));
  const host = card(node('h3', {}, 'Original acquisition history'));
  const query = bind(input('source-acquisition-search', memory.attemptQuery, { type: 'search', placeholder: 'Attempt, catalogue, URL or error' }),
    () => { memory.attemptQuery = query.value; memory.attemptOffset = 0; render(); });
  const status = bind(select('source-acquisition-status', [['', 'All outcomes'], ...[...new Set(all.map(value => value.status))].sort().map(value => [value, value])], memory.attemptStatus),
    () => { memory.attemptStatus = status.value; memory.attemptOffset = 0; render(); });
  const results = node('div');
  host.append(row(field('Find an acquisition', query), field('Outcome', status)), results);
  function render() {
    const term = memory.attemptQuery.toLocaleLowerCase().trim();
    const found = all.filter(value => (!memory.attemptStatus || value.status === memory.attemptStatus)
      && (!term || stringifyDcatJson(value).toLocaleLowerCase().includes(term)));
    const total = found.length;
    memory.attemptOffset = Math.min(memory.attemptOffset, Math.max(0, Math.floor((total - 1) / pageSize) * pageSize));
    const rows = found.slice(memory.attemptOffset, memory.attemptOffset + pageSize);
    results.replaceChildren(total ? table(['Started / completed', 'Outcome', 'HTTP / bytes', 'Retained edition', 'Original files and continuation'], rows.map(value => [
      node('div', {}, time(value.startedAt), node('br'), time(value.completedAt)),
      node('div', {}, value.status, value.error ? details('Original error', value.error) : null,
        value.retryNotBefore ? note('Retry no earlier than ' + time(value.retryNotBefore)) : null),
      node('div', {}, value.httpStatus ?? 'No response status', note(value.responseBytes == null ? 'No response bytes retained' :
        Number(value.responseBytes).toLocaleString() + ' bytes · ' + (value.responseComplete ? 'complete' : 'incomplete'))),
      value.catalogId ? action(ctx, value.catalogId, () => ctx.download(
        'dcat/catalogs/' + encodeURIComponent(value.catalogId) + '/download', 'dcat-source-' + value.catalogId + '.json')) : 'No catalogue edition',
      row(value.receiptSha256 ? action(ctx, 'HTTP receipt', () =>
        ctx.download('dcat/acquisitions/' + encodeURIComponent(value.id) + '/receipt', 'dcat-acquisition-' + value.id + '-receipt.json')) : null,
      value.responseSha256 ? action(ctx, value.responseComplete ? 'Original response' : 'Retained incomplete response', () =>
        ctx.download('dcat/acquisitions/' + encodeURIComponent(value.id) + '/response', 'dcat-acquisition-' + value.id + '-response.bin')) : null,
      ['FAILED', 'INTERRUPTED'].includes(value.status) && value.sourceSha256 === source.sourceSha256
        ? action(ctx, 'Retry this acquisition', () => acquire(ctx, memory, source, value.id),
          Boolean(ctx.state.active) || sourceCooldown(source)) : null,
      details('Complete retained attempt', value))
    ])) : note(all.length ? 'No matching acquisitions.' : 'The first acquisition retains its request, response and source edition here.'));
    results.append(row(action(ctx, 'Previous checks', async () => { memory.attemptOffset = Math.max(0, memory.attemptOffset - pageSize); render(); }, memory.attemptOffset === 0),
      note(total ? String(memory.attemptOffset + 1) + '–' + Math.min(memory.attemptOffset + pageSize, total) + ' of ' + total : 'No checks'),
      action(ctx, 'Following checks', async () => { memory.attemptOffset += pageSize; render(); }, memory.attemptOffset + pageSize >= total)));
  }
  render();
  const retained = reviews.filter(value => value.acquisitionSourceId === source.id);
  if (retained.length) host.append(node('h4', {}, 'Saved reviews for this publication source'),
    table(['Created', 'Review', 'State', 'Source catalogue'], retained.map(value => [
      time(value.createdAt), action(ctx, value.label || value.id, async () => {
        callbacks.onReviewCreated?.(value.id); await ctx.render();
      }), value.status, value.sourceId
    ])));
  return host;
}
export async function renderDcatSources(ctx, callbacks = {}) {
  const dcat = ctx.state.dcat ?? {}, memory = memoryFor(ctx.state);
  const sources = dcat.sources ?? [], attempts = dcat.acquisitions ?? [];
  if (!Array.isArray(sources) || !Array.isArray(attempts)) throw new Error('The retained catalogue source inventory is invalid.');
  if (memory.pendingSourceId && sources.some(source => source.id === memory.pendingSourceId)) {
    memory.selected = memory.pendingSourceId; memory.pendingSourceId = null;
  }
  const awaitingSource = memory.pendingSourceId && ctx.state.active;
  if (!sources.some(source => source.id === memory.selected) && !awaitingSource)
    memory.selected = sources[0]?.id ?? '';
  const selected = sources.find(source => source.id === memory.selected);
  const choose = select('retained-catalogue-source', sources.map(source => [source.id, source.label || source.url]), memory.selected);
  choose.addEventListener('change', () => ctx.protect(async () => {
    memory.selected = choose.value; memory.pendingSourceId = null; memory.editing = null; memory.draft = null;
    memory.attemptOffset = 0; memory.attemptQuery = ''; memory.attemptStatus = '';
    await ctx.render();
  }));
  const root = node('div', { 'data-dcat-sources': '' }, card(node('h3', {}, 'Recurring catalogue sources'),
    note('Acquire complete published catalogues, retain each source version and HTTP attempt, then review the following edition in this same project.'),
    sources.length ? field('Retained source', choose) : note('Add the publication URL for your first source.'),
    row(action(ctx, 'Add source', async () => {
      memory.editing = 'new'; memory.draft = draftFor(null); memory.editorBaseSha256 = null; await ctx.render();
    }, Boolean(ctx.state.active)),
    selected ? action(ctx, 'Edit selected source', async () => {
      memory.editing = selected.id; memory.draft = draftFor(selected);
      memory.editorBaseSha256 = selected.sourceSha256; await ctx.render();
    }, Boolean(ctx.state.active)) : null,
    memory.retainedSourceDraft && !ctx.state.active && (memory.retainedSourceDraft.editing === 'new'
      ? !sources.some(value => value.id === memory.retainedSourceDraft.savedId)
      : sources.find(value => value.id === memory.retainedSourceDraft.editing)?.sourceSha256 === memory.retainedSourceDraft.baseSha256)
      ? action(ctx, 'Resume retained source configuration draft', async () => {
      memory.editing = memory.retainedSourceDraft.editing; memory.draft = { ...memory.retainedSourceDraft.draft };
      memory.editorBaseSha256 = memory.retainedSourceDraft.baseSha256; await ctx.render();
    }, Boolean(ctx.state.active)) : null,
    action(ctx, 'Download recurring catalogues guide', () => ctx.download('dcat/sources-guide', 'RECURRING_CATALOGS.md')))));
  if (awaitingSource && !selected) {
    root.append(card(node('h3', {}, 'Saving the selected source'),
      note('The current operation is retaining source ' + memory.pendingSourceId + '. It will open here when the saved source appears.')));
    return root;
  }
  if (memory.editing !== null) root.append(sourceEditor(ctx, memory, memory.editing === 'new' ? null :
    sources.find(source => source.id === memory.editing)));
  if (selected) {
    const unconditional = bind(input('source-unconditional', '', { type: 'checkbox', checked: memory.unconditional }),
      () => { memory.unconditional = unconditional.checked; });
    const due = selected.enabled === false ? 'Due checks paused' :
      selected.nextCheckAt && Date.parse(selected.nextCheckAt) > Date.now() ? 'Next due: ' + time(selected.nextCheckAt) : 'Due for acquisition';
    root.append(card(node('h3', {}, selected.label || 'Selected source'), node('p', { class: 'mono break' }, selected.url),
      row(note('Last check: ' + time(selected.lastCheckedAt)), note(due)),
      selected.retryNotBefore ? note('Publisher retry limit: ' + time(selected.retryNotBefore)) : null,
      selected.latestCatalogId ? note('Latest retained catalogue: ' + selected.latestCatalogId) : note('No catalogue has been acquired for this source configuration.'),
      field('Request the current document without conditional cache headers', unconditional),
      row(action(ctx, 'Acquire current source edition', () => acquire(ctx, memory, selected),
        Boolean(ctx.state.active) || sourceCooldown(selected)),
      action(ctx, 'Download source configuration and history', async () => {
        const value = await api(ctx, 'dcat/sources/' + encodeURIComponent(selected.id));
        downloadJson(value, 'dcat-source-' + selected.id + '.json');
      })), details('Saved source versions and current binding', selected)));
    root.append(await reviewPanel(ctx, memory, selected, {
      catalogs: dcat.catalogs ?? [], releases: dcat.releases ?? [],
      activeReleaseId: dcat.activeReleaseId,
    }, callbacks));
    if (!ctx.current()) return root;
    root.append(historyPanel(ctx, memory, selected, attempts, dcat.reviews ?? [], callbacks));
  }
  return root;
}
