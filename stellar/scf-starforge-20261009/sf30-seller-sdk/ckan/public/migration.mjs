// MIT. Catalogue migration operator view; original values are rendered as text.
import { renderDcatSources } from './dcat-sources.mjs';
import { parseDcatJson, parseDcatJsonText, stringifyDcatJson, isExactCkanNumber } from './dcat-json.mjs';
const pageSize = 25;
const memories = new Map();
const own = (value, key) => value !== null && typeof value === 'object' && Object.hasOwn(value, key);
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'class') node.className = value;
    else if (['disabled', 'checked', 'selected', 'readOnly'].includes(key)) node[key] = Boolean(value);
    else if (value !== null && value !== undefined) node.setAttribute(key, value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined)
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
const note = text => el('p', { class: 'muted' }, text);
const card = (...children) => el('div', { class: 'card' }, ...children);
const row = (...children) => el('div', { class: 'row' }, ...children);
const title = text => el('h3', {}, text);
const tag = text => el('span', { class: 'pill' }, text ?? 'Unspecified');
const field = (name, control, grow = false) => el('label', { class: grow ? 'grow' : '' }, name, control);
const textInput = (name, value = '', attrs = {}) => el('input', { name, value, ...attrs });
const jsonText = value => value === undefined ? '(absent)' : stringifyDcatJson(value, null, 2);
function valueView(value, present = true) {
  if (!present) return el('span', { class: 'muted' }, '(absent)');
  if (value === null) return el('code', {}, 'null');
  if (isExactCkanNumber(value)) return el('code', {}, value.source);
  if (typeof value === 'string' && value.length < 180 && !value.includes('\n'))
    return value === '' ? el('code', {}, '""') : el('span', {}, value);
  return el('pre', { class: 'migration-value' }, typeof value === 'string' ? value : jsonText(value));
}
function details(label, value, open = false) {
  return el('details', { ...(open ? { open: '' } : {}) }, el('summary', {}, label), valueView(value));
}
function select(name, entries, current) {
  const node = el('select', { name }, entries.map(([value, label]) =>
    el('option', { value, selected: String(value) === String(current) }, label)));
  return node;
}
function readable(value) { return String(value ?? '').replaceAll('_', ' ').toLowerCase(); }
function readableTime(value) {
  if (typeof value !== 'string' || !value) return String(value ?? '');
  const date = new Date(value);
  return Number.isFinite(date.valueOf())
    ? date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : String(value ?? '');
}
function bind(control, callback) {
  control.addEventListener('input', callback);
  control.addEventListener('change', callback);
  return control;
}
function table(headers, rows) {
  return el('div', { class: 'table-wrap' }, el('table', {},
    el('thead', {}, el('tr', {}, headers.map(value => el('th', {}, value)))),
    el('tbody', {}, rows.map(values => el('tr', {}, values.map(value => el('td', {}, value)))))));
}
function action(ctx, label, run, { primary = false, disabled = false } = {}) {
  const node = el('button', { type: 'button', class: primary ? 'primary' : '', disabled }, label);
  node.addEventListener('click', () => ctx.protect(async () => {
    if (node.disabled || !ctx.current()) return;
    node.disabled = true;
    try { return await run(); } finally { if (node.isConnected) node.disabled = disabled; }
  }));
  return node;
}
function stats(entries) {
  return el('div', { class: 'stats migration-stats' }, entries.filter(([, value]) => value !== undefined && value !== null)
    .map(([name, value]) => el('div', {}, el('div', { class: 'stat' },
      typeof value === 'number' ? value.toLocaleString() : value), el('div', { class: 'muted' }, name))));
}
function sourceDescriptor(label, source) {
  if (!source) return card(title(label), note('This review has no ' + label.toLowerCase() + '.'));
  return card(title(label), source.name || source.label ? el('p', {}, source.name || source.label) : null,
    row(tag(source.profile ?? source.declared_profile ?? 'Unclassified profile'),
      source.bytes !== undefined ? tag(Number(source.bytes).toLocaleString() + ' bytes') : null),
    source.sha256 ? field('SHA-256', textInput('source-sha', source.sha256, { readOnly: true, class: 'mono' }), true) : null,
    source.declared_profile ? note('Declared source profile: ' + source.declared_profile) : null,
    source.origin ? note((label === 'Candidate' && ['converter', 'preserved', 'operator'].includes(source.origin) ? 'Candidate origin: ' : 'Declared source reference: ') + source.origin) : null,
    source.sourceUrl ? el('p', { class: 'mono break' }, source.sourceUrl) : null,
    details('Complete saved identity', source));
}
function validationIssues(validation) {
  const entries = new Map();
  const add = (errors, origin) => {
    for (const error of Array.isArray(errors) ? errors : []) {
      const key = stringifyDcatJson([error.path ?? '', error.validator ?? null, error.message ?? '']);
      let entry = entries.get(key);
      if (!entry) { entry = { ...error, origins: [] }; entries.set(key, entry); }
      entry.origins.push({ ...origin, schema_path: error.schema_path, context: error.context ?? [] });
    }
  };
  add(validation.errors, { scope: 'catalogue', schema_id: validation.schema_id });
  for (const record of validation.records ?? []) add(record.errors, {
    scope: 'record', path: record.path, identifier: record.identifier, role: record.role, schema_id: record.schema_id
  });
  for (const catalog of validation.catalogs ?? []) add(catalog.errors, {
    scope: 'nested catalogue', path: catalog.path, profile: catalog.profile
  });
  return [...entries.values()];
}
function renderValidation(ctx, label, validation, memory) {
  if (!validation) return card(title(label), note('Validation has not returned for this document.'));
  const errors = validationIssues(validation), records = Array.isArray(validation.records) ? validation.records : [], catalogs = Array.isArray(validation.catalogs) ? validation.catalogs : [];
  const host = card(row(title(label), tag(validation.state)),
    validation.schema_id ? el('p', { class: 'mono break' }, validation.schema_id) : null,
    stats([['Records checked', records.length], ['Valid records', records.filter(item => item.valid === true).length],
      ['Invalid records', records.filter(item => item.valid === false).length], ['Nested catalogues checked', catalogs.length]]),
    records.length ? details('Complete record validation', records) : null,
    catalogs.length ? details('Complete nested catalogue validation', catalogs) : null,
    validation.exception ? details('Original validation exception', validation.exception, true) : null,
    errors.length ? note(errors.length.toLocaleString() + ' distinct validation errors across catalogue and record checks. Each path refers to the retained document.') :
      note(validation.state === 'VALID' ? 'The original validator accepted this document.' : 'Read the validator result before selecting this document.'));
  if (!errors.length) return host;
  const selection = memory.filters['validation-' + label] ??= { query: '', validator: '', page: 0 };
  const query = textInput('validation-search', selection.query, { type: 'search', placeholder: 'Document path or error text' });
  const validators = [...new Set(errors.map(error => String(error.validator ?? '')).filter(Boolean))].sort();
  const validator = select('validator', [['', 'All validation rules'], ...validators.map(value => [value, value])], selection.validator);
  const results = el('div');
  host.append(row(field('Find validation issue', query, true), field('Rule', validator)), results);
  const update = () => {
    const term = selection.query.trim().toLocaleLowerCase();
    const filtered = errors.map((error, index) => ({ error, index })).filter(({ error }) =>
      (!selection.validator || error.validator === selection.validator) &&
      (!term || [error.path, error.schema_path, error.message].join(' ').toLocaleLowerCase().includes(term)));
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
    selection.page = Math.min(selection.page, pages - 1);
    const offset = selection.page * pageSize, shown = filtered.slice(offset, offset + pageSize);
    results.replaceChildren(note(filtered.length.toLocaleString() + ' issues match; showing ' +
      (shown.length ? offset + 1 : 0) + '–' + (offset + shown.length) + '.'),
      ...shown.map(({ error, index }) => el('details', {}, el('summary', {},
        (index + 1) + '. ' + (error.path || '/') + ' · ' + (error.message ?? error.validator ?? 'Validation issue')),
        table(['Document path', 'Schema path', 'Validator'], [[error.path || '/', error.schema_path ?? '', error.validator ?? '']]),
        error.message ? el('p', {}, error.message) : null,
        own(error, 'context') ? details('Full validator context', error.context) : null,
        details('Original validation occurrences · ' + error.origins.length, error.origins))),
      row(action(ctx, 'Previous issues', async () => { selection.page--; update(); }, { disabled: selection.page === 0 }),
        note('Page ' + (selection.page + 1) + ' of ' + pages),
        action(ctx, 'Next issues', async () => { selection.page++; update(); }, { disabled: selection.page + 1 >= pages })));
  };
  bind(query, () => { selection.query = query.value; selection.page = 0; update(); });
  bind(validator, () => { selection.validator = validator.value; selection.page = 0; update(); });
  update(); return host;
}
function identifierLabel(value) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object') return String(value);
  const short = value['@id'] ?? value.notation;
  return typeof short === 'string' ? short : stringifyDcatJson(value);
}
function recordLabel(record) {
  const after = record.after ?? {}, before = record.before ?? {};
  return [after.role ?? before.role, identifierLabel(after.identifier ?? before.identifier ?? record.key ?? record.identifier)]
    .filter(value => value !== undefined && value !== null && value !== '').join(' · ') || 'Unidentified record';
}
function pathOf(change) { return String(change.path ?? change.pointer ?? change.field ?? ''); }
function changesOf(record) { return Array.isArray(record.changes) ? record.changes : []; }
function recordRole(record) {
  const explicit = record.after?.role ?? record.before?.role ?? record.role;
  if (explicit) return String(explicit);
  const path = String(record.after?.path ?? record.before?.path ?? '');
  if (path.startsWith('/datasetSeries/')) return 'dataset_series';
  if (path.startsWith('/dataset/')) return 'dataset';
  return '';
}
function renderRecord(record, matchingChanges = null, labels = ['Original source', 'Candidate']) {
  const changes = matchingChanges ?? changesOf(record);
  return el('details', { class: 'migration-record' }, el('summary', {}, recordLabel(record),
    changes.length ? ' · ' + changes.length + ' field changes' : ''),
    table(labels, [[valueView(record.before), valueView(record.after)]]),
    changes.length ? table(['Path', 'Change', 'Classification', ...labels], changes.map(change => [
      el('code', {}, pathOf(change) || '/'), readable(change.kind), readable(change.classification),
      valueView(change.before, change.before_present !== false && own(change, 'before')), valueView(change.after, change.after_present !== false && own(change, 'after'))
    ])) : note('No field changes in this record.'),
    details('Complete record comparison', record));
}
function renderRecordBrowser(ctx, label, records, memory, slotName, introduction, labels = ['Original source', 'Candidate']) {
  const selection = memory.filters[slotName] ??= { query: '', role: '', kind: '', page: 0 };
  const query = textInput('record-search', selection.query, { type: 'search', placeholder: 'Identifier or field path', 'aria-label': label + ' identifier or field path' });
  const roles = [...new Set(records.map(recordRole).filter(Boolean))].sort();
  const kinds = [...new Set(records.flatMap(changesOf).map(change => String(change.kind ?? '')).filter(Boolean))].sort();
  const role = select('record-role', [['', 'All record types'], ...roles.map(value => [value, readable(value)])], selection.role);
  const kind = select('change-kind', [['', 'All change types'], ...kinds.map(value => [value, readable(value)])], selection.kind);
  const results = el('div'), host = card(title(label), introduction ? note(introduction) : null,
    row(field('Identifier or field path', query, true), field('Record type', role), field('Change type', kind)), results);
  const update = () => {
    const term = selection.query.trim().toLocaleLowerCase();
    const filtered = [];
    for (const record of records) {
      if (selection.role && recordRole(record) !== selection.role) continue;
      const identity = [recordLabel(record), jsonText(record.key), jsonText(record.before?.identifier), jsonText(record.after?.identifier), record.before?.path, record.after?.path].join(' ').toLocaleLowerCase();
      const identityMatches = term === '' || identity.includes(term);
      const matchedChanges = changesOf(record).filter(change =>
        (!selection.kind || String(change.kind ?? '') === selection.kind) &&
        (identityMatches || pathOf(change).toLocaleLowerCase().includes(term)));
      if ((!identityMatches || selection.kind) && !matchedChanges.length) continue;
      filtered.push({ record, changes: matchedChanges });
    }
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
    selection.page = Math.min(selection.page, pages - 1);
    const offset = selection.page * pageSize, shown = filtered.slice(offset, offset + pageSize);
    results.replaceChildren(note(filtered.length.toLocaleString() + ' of ' + records.length.toLocaleString() +
      ' records match. Showing ' + (shown.length ? offset + 1 : 0) + '–' + (offset + shown.length) + '.'),
      ...shown.map(item => renderRecord(item.record, item.changes, labels)),
      row(action(ctx, 'Previous records', async () => { selection.page--; update(); }, { disabled: selection.page === 0 }),
        note('Page ' + (selection.page + 1) + ' of ' + pages),
        action(ctx, 'Next records', async () => { selection.page++; update(); }, { disabled: selection.page + 1 >= pages })));
  };
  for (const [control, key] of [[query, 'query'], [role, 'role'], [kind, 'kind']])
    bind(control, () => { selection[key] = control.value; selection.page = 0; update(); });
  update(); return host;
}
function renderConservation(ctx, conservation, fieldChanges, memory) {
  if (!conservation) return card(title('Dataset and series conservation'), note('The converter has not returned a conservation comparison.'));
  const mappings = recordsFromFieldChanges(fieldChanges, conservation.mappings);
  return el('div', {}, card(row(title('Dataset and series conservation'), tag(conservation.state ?? (conservation.valid === true ? 'Conserved' : 'Review required'))),
    stats([['Source records', conservation.source_count], ['Candidate records', conservation.target_count], ['Matched identities', conservation.matched_count],
      ['Missing identities', Array.isArray(conservation.missing) ? conservation.missing.length : conservation.missing],
      ['Added identities', Array.isArray(conservation.added) ? conservation.added.length : conservation.added]]),
    note('Conservation follows each retained identifier and its dataset or series location. Profile conversion and intended operator corrections remain visible.'),
    details('Complete identifier and path mappings', conservation.mappings ?? []),
    ...['missing', 'added', 'duplicates', 'unidentified'].filter(key => issueCount(conservation[key]) > 0)
      .map(key => details(readable(key) + ' · ' + issueCount(conservation[key]), conservation[key], true))),
    renderRecordBrowser(ctx, 'Review converted fields', mappings, memory, 'conservation',
      'These differences compare the retained source with this conversion candidate. Dataset and series identities stay attached to every field change.'));
}
function issueCount(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.values(value).reduce((total, part) => total + issueCount(part), 0);
  return typeof value === 'number' ? value : 0;
}
function renderEditionComparison(ctx, comparison, memory) {
  if (!comparison) return card(title('Successive catalogue editions'), note('Choose a preceding retained edition to compare publisher changes separately from conversion.'));
  function section(label, part, key, labels) {
    const conservation = part.conservation ?? {};
    return el('div', {}, card(title(label),
      table(labels, [[el('code', {}, part.source_sha256 ?? ''), el('code', {}, part.comparison_sha256 ?? comparison.comparison_sha256 ?? '')]]),
      stats([['Source records', conservation.source_count], ['Comparison records', conservation.target_count], ['Matched identities', conservation.matched_count],
        ['Only in source', issueCount(conservation.missing)], ['Only in comparison', issueCount(conservation.added)]]),
      note('Values are shown in the declared direction: the selected source on the left and its comparison edition on the right. These publisher-edition differences are separate from conversion changes.'),
      ...['missing', 'added', 'duplicates', 'unidentified'].filter(name => issueCount(conservation[name]) > 0)
        .map(name => details(readable(name) + ' · ' + issueCount(conservation[name]), conservation[name], true)),
      part.catalog_changes ? details('Catalogue-level edition changes', part.catalog_changes) : null,
      details('Complete edition conservation', conservation)),
      renderRecordBrowser(ctx, label + ' · fields', recordsFromFieldChanges(part.field_changes, conservation.mappings), memory, key,
        'Inspect each retained dataset or series identity and its complete changed values.', labels));
  }
  return el('div', {}, section('Original source and preceding edition', comparison, 'editions-source', ['Selected source edition', 'Preceding comparison edition']),
    comparison.candidate_to_comparison ? section('Reviewed candidate and preceding edition', comparison.candidate_to_comparison,
      'editions-candidate', ['Reviewed candidate', 'Preceding comparison edition']) : null,
    details('Complete original edition comparison', comparison));
}
function recordsFromFieldChanges(changes, mappings = []) {
  const records = new Map();
  for (const mapping of Array.isArray(mappings) ? mappings : []) {
    const key = stringifyDcatJson([mapping.source_path ?? null, mapping.target_path ?? null]);
    records.set(key, { key: mapping.source_identifier ?? mapping.target_identifier ?? key,
      before: { path: mapping.source_path, identifier: mapping.source_identifier, role: mapping.source_role, catalog_path: mapping.source_catalog_path },
      after: { path: mapping.target_path, identifier: mapping.target_identifier, role: mapping.target_role, catalog_path: mapping.target_catalog_path },
      mapping, changes: [] });
  }
  for (const change of Array.isArray(changes) ? changes : []) {
    const key = stringifyDcatJson([change.source_path ?? null, change.target_path ?? null]);
    let record = records.get(key);
    if (!record) {
      record = { key: change.identifier ?? key,
        before: { path: change.source_path, identifier: change.source_identifier ?? change.identifier },
        after: { path: change.target_path, identifier: change.target_identifier ?? change.identifier }, changes: [] };
      records.set(key, record);
    }
    record.changes.push(change);
  }
  return [...records.values()];
}
function migrationMemory(state) {
  const key = stringifyDcatJson([state.directory, state.catalogOrigin, state.sourceKind]);
  if (!memories.has(key)) memories.set(key, {
    sourceId: '', comparisonId: '', candidateId: '', normalizeV3: false, selectedReview: '', rollbackId: '',
    upload: { label: '', profile: 'auto', origin: '', target: 'source', file: null },
    label: '', mappingRows: [], reviewNotes: {}, rollbackNote: '', filters: {},
    activeSection: 'overview', pending: false, lastReadReview: null
  });
  return memories.get(key);
}
function catalogName(item) {
  return (item.label || item.id) + ' · ' + (item.profile || 'unclassified') + ' · ' +
    (item.receivedAt ? readableTime(item.receivedAt) : item.id);
}
function findCatalog(dcat, id) { return dcat.catalogs.find(item => item.id === id); }
function setChoice(control, memory, key) {
  control.addEventListener('change', () => { memory[key] = control.value; });
  return control;
}
function validateMappings(rows) {
  return rows.filter(item => Object.values(item).some(value => String(value ?? '').trim() !== '')).map((item, index) => {
    const result = {};
    for (const key of ['source_path', 'target_path']) {
      const value = String(item[key] ?? '');
      if (!value) throw new Error('Identity mapping ' + (index + 1) + ' needs its exact source and target record pointers.');
      result[key] = value;
    }
    for (const key of ['source_identifier', 'target_identifier']) {
      try { result[key] = parseDcatJsonText(item[key]); }
      catch { throw new Error('Identity mapping ' + (index + 1) + ' needs a complete JSON value for ' + key + '. Quote plain string identifiers.'); }
    }
    return result;
  });
}
function originalIdentityChoices(report, side) {
  const conservation = report?.conservation;
  if (!conservation) return [];
  const output = new Map();
  for (const item of conservation.mappings ?? []) {
    const path = item[side + '_path'];
    if (typeof path !== 'string') continue;
    output.set(path, { path, identifier: item[side + '_identifier'], role: item[side + '_role'] });
  }
  const extras = side === 'source' ? conservation.missing : conservation.added;
  for (const item of Array.isArray(extras) ? extras : []) if (typeof item.path === 'string')
    output.set(item.path, { path: item.path, identifier: item.identifier, role: item.role });
  return [...output.values()];
}
function hasCandidate(report) {
  return report?.candidate !== null && typeof report?.candidate === 'object' &&
    typeof report.candidate_base64 === 'string';
}
function mappingContext(dcat, memory) {
  const retained = memory.lastReadReview;
  const sameSelection = retained?.summary?.sourceId === memory.sourceId &&
    (retained.summary.candidateId || '') === (memory.candidateId || '') &&
    Boolean(retained.summary.normalizeV3) === memory.normalizeV3;
  const report = sameSelection && hasCandidate(retained.report) ? retained.report : null;
  const scope = stringifyDcatJson([memory.sourceId, memory.candidateId || '', memory.normalizeV3]);
  const stale = memory.mappingRows.length > 0 && memory.mappingScope !== scope;
  return { report, scope, stale,
    enabled: !stale && (Boolean(findCatalog(dcat, memory.candidateId)) || Boolean(report)) };
}
function mappingEditor(ctx, memory, dcat) {
  const rows = el('div'), guidance = note(''), controls = el('div');
  const draw = () => {
    const context = mappingContext(dcat, memory), report = context.report;
    guidance.textContent = context.stale
      ? 'These draft mappings belong to an earlier source, candidate or normalization selection. Return to that selection or clear the draft before entering mappings for these documents.'
      : context.enabled
        ? 'Use the exact identifiers and pointers from these source and candidate documents. Current review choices are available when they match this selection.'
        : 'Prepare a review that produces a candidate, or receive and select an operator-corrected candidate before entering identity mappings.';
    const editable = context.enabled;
    rows.replaceChildren(...memory.mappingRows.map((item, index) => {
      const sides = ['source', 'target'].map(side => {
        const pathName = side + '_path', idName = side + '_identifier';
        const path = textInput(pathName, item[pathName] ?? '', { class: 'mono', disabled: !editable });
        const identity = el('textarea', { name: idName, rows: '3', disabled: !editable, placeholder: '"Exact string identifier" or complete Identifier object' }, item[idName] ?? '');
        bind(path, () => { item[pathName] = path.value; });
        bind(identity, () => { item[idName] = identity.value; });
        const choices = originalIdentityChoices(report, side);
        const saved = select(side + '-saved-record', [['', 'Select an actual retained record'], ...choices.map((entry, choiceIndex) => [
          String(choiceIndex), entry.path + ' · ' + identifierLabel(entry.identifier)
        ])], '');
        saved.disabled = !editable;
        saved.addEventListener('change', () => {
          if (saved.value === '') return;
          const selected = choices[Number(saved.value)];
          item[pathName] = selected.path; path.value = selected.path;
          item[idName] = stringifyDcatJson(selected.identifier, null, 2); identity.value = item[idName];
        });
        return el('div', { class: 'grow' },
          choices.length ? field(side === 'source' ? 'Retained source record' : 'Retained candidate record', saved, true) : null,
          field(side === 'source' ? 'Source record pointer' : 'Candidate record pointer', path, true),
          field(side === 'source' ? 'Source identifier · JSON value' : 'Candidate identifier · JSON value', identity, true));
      });
      return el('div', { class: 'migration-mapping' }, row(...sides),
        action(ctx, 'Remove mapping', async () => { memory.mappingRows.splice(index, 1); if (!memory.mappingRows.length) memory.mappingScope = null; draw(); }));
    }));
    controls.replaceChildren(...[
      action(ctx, 'Add identity mapping', async () => {
        memory.mappingScope = context.scope;
        memory.mappingRows.push({ source_path: '', target_path: '', source_identifier: '', target_identifier: '' }); draw();
      }, { disabled: !editable }),
      memory.mappingRows.length ? action(ctx, 'Clear draft mappings', async () => {
        memory.mappingRows = []; memory.mappingScope = null; draw();
      }) : null
    ].filter(Boolean));
  };
  memory.refreshMappings = draw;
  draw();
  return el('details', {}, el('summary', {}, 'Explicit identity changes'),
    note('Select actual identities from the matching review, or enter their exact JSON values. Keep plain identifiers as JSON strings and structured identifiers as their complete objects. The engine verifies the source and candidate values and pointers.'),
    guidance, rows, controls);
}
async function dcatApi(ctx, path, body) {
  const response = await fetch('/api/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: 'Bearer ' + ctx.token,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: stringifyDcatJson(body) })
  });
  const result = parseDcatJson(new Uint8Array(await response.arrayBuffer()));
  if (!response.ok) throw new Error((result.error ?? response.status) + ': ' + (result.message ?? 'Catalogue operation failed.'));
  return result;
}
async function followOperation(ctx, memory, response) {
  ctx.acceptOperation(response);
  await ctx.refresh();
}
async function mutate(ctx, memory, path, body, selectResult) {
  if (memory.pending || ctx.state.active) throw new Error('Follow the current workspace operation before starting the next one.');
  memory.pending = true;
  try {
    const result = await dcatApi(ctx, path, body);
    if (selectResult) selectResult(result);
    await followOperation(ctx, memory, result);
    return result;
  } finally { memory.pending = false; }
}
function uploadPanel(ctx, memory) {
  const draft = memory.upload;
  const name = textInput('label', draft.label, { required: '', maxlength: '240', placeholder: 'Publisher catalogue · acquired date' });
  const origin = textInput('origin', draft.origin, { required: '', placeholder: 'Original publisher URL or declared source reference' });
  const profile = select('profile', [['auto', 'Detect from retained document'], ['1.1', 'DCAT-US 1.1'], ['3.0', 'DCAT-US 3.0']], draft.profile);
  const target = select('target', [['source', 'Source for a new review'], ['comparison', 'Preceding catalogue edition'], ['candidate', 'Operator-corrected candidate']], draft.target);
  const file = textInput('catalog-file', '', { type: 'file', accept: '.json,application/json', 'aria-label': 'Complete DCAT-US JSON document' });
  const selectedFile = note(draft.file ? 'Selected: ' + draft.file.name + ' · ' + draft.file.size.toLocaleString() + ' bytes' : 'Select the complete JSON document.');
  file.addEventListener('change', () => {
    draft.file = file.files[0] ?? null;
    selectedFile.textContent = draft.file ? 'Selected: ' + draft.file.name + ' · ' + draft.file.size.toLocaleString() + ' bytes' : 'Select the complete JSON document.';
    if (!draft.label && draft.file) { draft.label = draft.file.name; name.value = draft.label; }
  });
  for (const [control, key] of [[name, 'label'], [origin, 'origin'], [profile, 'profile'], [target, 'target']])
    bind(control, () => { draft[key] = control.value; });
  return card(title('Receive an original catalogue document'),
    note('Upload a DCAT-US JSON document and retain its declared source identity. Original bytes stay available beside the converted or corrected candidate.'),
    row(field('Document label', name, true), field('Declared source profile', profile)),
    field('Original publisher or source reference', origin, true),
    row(field('Complete JSON document', file, true), field('Use after receiving', target)), selectedFile,
    action(ctx, 'Receive catalogue document', async () => {
      if (!draft.file) throw new Error('Choose the complete source JSON document.');
      if (!draft.label.trim() || !draft.origin.trim()) throw new Error('Give this document its label and original publisher or source reference.');
      if (memory.pending || ctx.state.active) throw new Error('Follow the current workspace operation before receiving another document.');
      memory.pending = true;
      try {
        const query = new URLSearchParams({ label: draft.label.trim(), profile: draft.profile, origin: draft.origin.trim() });
        const response = await fetch('/api/dcat/catalogs/upload?' + query, {
          method: 'POST', headers: { authorization: 'Bearer ' + ctx.token, 'content-type': 'application/octet-stream' }, body: draft.file
        });
        const result = await response.json();
        if (!response.ok) throw new Error((result.error ?? response.status) + ': ' + (result.message ?? 'Catalogue receiving failed.'));
        if (!result.catalogId) throw new Error('Catalogue receiving did not return its saved catalogue identity.');
        memory[draft.target === 'comparison' ? 'comparisonId' : draft.target === 'candidate' ? 'candidateId' : 'sourceId'] = result.catalogId;
        draft.file = null;
        await followOperation(ctx, memory, result);
      } finally { memory.pending = false; }
    }, { primary: true, disabled: Boolean(ctx.state.active) }));
}
function reviewPanel(ctx, dcat, memory) {
  const choices = dcat.catalogs.map(item => [item.id, catalogName(item)]);
  if (!findCatalog(dcat, memory.sourceId) && !ctx.state.active) memory.sourceId = dcat.catalogs.at(-1)?.id ?? '';
  const source = setChoice(select('source', choices, memory.sourceId), memory, 'sourceId');
  const comparison = setChoice(select('comparison', [['', 'No preceding edition'], ...choices], memory.comparisonId), memory, 'comparisonId');
  const candidate = setChoice(select('candidate', [['', 'Original converter or preserved 3.0 source'], ...choices], memory.candidateId), memory, 'candidateId');
  for (const control of [source, candidate]) control.addEventListener('change', () => memory.refreshMappings?.());
  const normalize = el('input', { type: 'checkbox', name: 'normalize-v3', checked: memory.normalizeV3 });
  bind(normalize, () => { memory.normalizeV3 = normalize.checked; memory.refreshMappings?.(); });
  const name = textInput('review-label', memory.label, { placeholder: 'Migration review · publisher edition' });
  bind(name, () => { memory.label = name.value; });
  return card(title('Prepare a complete migration review'),
    note('Select the source, an optional preceding edition, and an optional corrected candidate. Every preparation creates a separate saved review.'),
    field('Original source', source, true), field('Preceding catalogue edition', comparison, true),
    field('Candidate source', candidate, true),
    field('Normalize a flat DCAT-US 3.0 catalogue', normalize),
    note('Leave normalization off to preserve an already 3.0 source. Enable it only to request the original 3.0 normalization as a separately reviewed candidate. A selected operator-corrected candidate is reviewed as supplied.'),
    field('Review label', name, true),
    mappingEditor(ctx, memory, dcat),
    action(ctx, 'Prepare migration review', async () => {
      if (!memory.sourceId) throw new Error('Receive and select the original source catalogue.');
      if (memory.comparisonId === memory.sourceId) throw new Error('Choose a distinct preceding catalogue edition.');
      if (memory.mappingRows.length && !mappingContext(dcat, memory).enabled)
        throw new Error('Identity mappings need the selected candidate. Return to their original source selection or clear the draft, then prepare or receive a candidate.');
      const mappings = validateMappings(memory.mappingRows);
      await mutate(ctx, memory, 'dcat/review', {
        sourceId: memory.sourceId,
        ...(memory.comparisonId ? { comparisonId: memory.comparisonId } : {}),
        ...(memory.candidateId ? { candidateId: memory.candidateId } : {}),
        ...(memory.normalizeV3 ? { normalizeV3: true } : {}),
        ...(mappings.length ? { identityMappings: mappings } : {}),
        ...(memory.label.trim() ? { label: memory.label.trim() } : {})
      }, result => { memory.selectedReview = result.reviewId; memory.activeSection = 'overview'; });
    }, { primary: true, disabled: Boolean(ctx.state.active) || choices.length === 0 }));
}
function renderReport(ctx, dcat, summary, report, memory) {
  const source = findCatalog(dcat, summary.sourceId);
  const candidate = findCatalog(dcat, summary.candidateId);
  const comparison = findCatalog(dcat, summary.comparisonId);
  const section = el('div'), nav = el('div', { class: 'migration-tabs', role: 'group', 'aria-label': 'Migration review sections' });
  const sections = [['overview', 'Overview'], ['validation', 'Validation'], ['conservation', 'Record conservation'],
    ['editions', 'Successive editions'], ['cutover', 'Cutover & rollback']];
  const redraw = () => {
    section.replaceChildren();
    for (const item of nav.querySelectorAll('button')) {
      const active = item.dataset.section === memory.activeSection;
      item.classList.toggle('selected', active); item.setAttribute('aria-pressed', String(active));
    }
    if (memory.activeSection === 'overview') {
      section.append(card(row(title(summary.label || 'Retained migration review'), tag(summary.status ?? report.conversion?.state ?? 'Saved')),
        stats(Object.entries(report.summary ?? {}).filter(([, value]) => typeof value === 'number').map(([key, value]) => [readable(key), value])),
        report.conversion ? details('Original converter result', report.conversion, true) : null,
        Array.isArray(report.issues) && report.issues.length ? details('Review issues', report.issues, true) : null,
        report.review_sha256 ? field('Engine review SHA-256', textInput('review-sha256', report.review_sha256, { readOnly: true, class: 'mono' }), true) : null,
        summary.reportSha256 ? field('Saved report file SHA-256', textInput('report-file-sha256', summary.reportSha256, { readOnly: true, class: 'mono' }), true) : null,
        note(!hasCandidate(report) ? 'The original conversion did not produce candidate bytes. This saved review retains its error and validation results. Receive a corrected complete catalogue, select it as the candidate, and prepare another review.' :
          report.can_receive === true ? 'The engine permits receiving this exact candidate. Review the retained changes and record the cutover decision.' :
            'This candidate needs correction or a completed engine review before cutover. Read validation and conservation, then receive a corrected candidate and prepare a separate review.')),
        el('div', { class: 'grid' }, sourceDescriptor('Original source', source || report.source ? { ...source, ...report.source } : null),
          sourceDescriptor('Candidate', hasCandidate(report) ? { ...(candidate ?? {}), ...report.candidate } : null)),
        comparison ? sourceDescriptor('Preceding edition', { ...comparison, ...report.comparison }) : null,
        report.catalog_changes ? details('Catalogue-level conversion changes', report.catalog_changes) : null,
        details('Complete original engine report', report));
    } else if (memory.activeSection === 'validation') {
      section.append(renderValidation(ctx, 'Original source validation', report.validation?.source, memory),
        renderValidation(ctx, 'Candidate validation', report.validation?.candidate, memory));
      if (report.validation?.comparison) section.append(renderValidation(ctx, 'Preceding edition validation', report.validation.comparison, memory));
    } else if (memory.activeSection === 'conservation') {
      section.append(renderConservation(ctx, report.conservation, report.field_changes, memory));
    } else if (memory.activeSection === 'editions') {
      section.append(renderEditionComparison(ctx, report.comparison_changes, memory));
      if (report.comparison && !summary.comparisonId) section.append(details('Comparison source', report.comparison));
    } else if (memory.activeSection === 'cutover') {
      section.append(releasePanel(ctx, dcat, summary, report, memory));
    }
  };
  for (const [key, label] of sections) {
    const button = action(ctx, label, async () => { memory.activeSection = key; redraw(); });
    button.dataset.section = key; nav.append(button);
  }
  const downloadName = 'dcat-review-' + summary.id;
  const actions = card(title('Saved review documents'),
    row(action(ctx, 'Download original source', () => ctx.download('dcat/catalogs/' + encodeURIComponent(summary.sourceId) + '/download', 'dcat-source-' + summary.sourceId + '.json')),
      action(ctx, 'Download candidate', () => ctx.download('dcat/reviews/' + encodeURIComponent(summary.id) + '/candidate', downloadName + '-candidate.json'), { disabled: !hasCandidate(report) }),
      action(ctx, 'Download complete review', () => ctx.download('dcat/reviews/' + encodeURIComponent(summary.id) + '/download', downloadName + '.json'))),
    summary.comparisonId ? action(ctx, 'Download preceding edition', () => ctx.download('dcat/catalogs/' + encodeURIComponent(summary.comparisonId) + '/download', 'dcat-source-' + summary.comparisonId + '.json')) : null,
    summary.candidateId ? action(ctx, 'Download operator candidate original', () => ctx.download('dcat/catalogs/' + encodeURIComponent(summary.candidateId) + '/download', 'dcat-source-' + summary.candidateId + '.json')) : null,
    note('Keep these documents with the complete workspace archive. Candidate corrections are received as another original document and reviewed separately.'));
  redraw(); return el('div', {}, actions, nav, section);
}
function releasePanel(ctx, dcat, summary, report, memory) {
  const active = dcat.releases.find(item => item.id === dcat.activeReleaseId);
  const operatorNote = el('textarea', { name: 'cutover-note', rows: '4', placeholder: 'Operator, reviewed exceptions, intended scope, and cutover decision' }, memory.reviewNotes[summary.id] ?? '');
  bind(operatorNote, () => { memory.reviewNotes[summary.id] = operatorNote.value; });
  const targets = dcat.releases.filter(item => item.id !== dcat.activeReleaseId);
  if (!targets.some(item => item.id === memory.rollbackId)) memory.rollbackId = targets.at(-1)?.id ?? '';
  const rollback = setChoice(select('rollback-release', targets.map(item => [
    item.id, readableTime(item.createdAt) + ' · ' + item.id + ' · review ' + item.reviewId
  ]), memory.rollbackId), memory, 'rollbackId');
  const rollbackNote = el('textarea', { name: 'rollback-note', rows: '3', placeholder: 'Operator, release to restore, and reason' }, memory.rollbackNote);
  bind(rollbackNote, () => { memory.rollbackNote = rollbackNote.value; });
  return el('div', {}, card(title('Current catalogue release'),
    active ? details('Selected release and exact candidate', active, true) : note('This workspace has no selected catalogue release.'),
    active ? row(action(ctx, 'Open active release review', async () => { memory.selectedReview = active.reviewId; await ctx.render(); }),
      action(ctx, 'Download active candidate', () => ctx.download('dcat/reviews/' + encodeURIComponent(active.reviewId) + '/candidate', 'dcat-active-' + active.id + '.json'))) : null,
    note('Cutover selects the exact reviewed candidate inside this saved workspace. Use its downloaded candidate in the catalogue deployment process; record that external deployment in the operator note.'),
    field('Cutover decision and operator', operatorNote, true),
    action(ctx, 'Select this reviewed candidate', async () => {
      if (!String(memory.reviewNotes[summary.id] ?? '').trim()) throw new Error('Record the operator and cutover decision for this exact review.');
      await mutate(ctx, memory, 'dcat/cutover', {
        reviewId: summary.id, expectedActiveReleaseId: dcat.activeReleaseId ?? null,
        expectedReviewSha256: report.review_sha256, expectedCandidateSha256: report.candidate.sha256,
        note: memory.reviewNotes[summary.id].trim()
      });
    }, { primary: true, disabled: Boolean(ctx.state.active) || !hasCandidate(report) || report.can_receive !== true })),
    card(title('Restore a prior catalogue release'),
      note('Select an existing release to restore. The workspace records a new history entry and retains the cutover being replaced.'),
      field('Prior release', rollback, true), field('Rollback decision and operator', rollbackNote, true),
      action(ctx, 'Restore selected prior release', async () => {
        if (!memory.rollbackId || !memory.rollbackNote.trim()) throw new Error('Select a prior release and record its operator and rollback reason.');
        await mutate(ctx, memory, 'dcat/rollback', {
          releaseId: memory.rollbackId, expectedActiveReleaseId: dcat.activeReleaseId ?? null,
          expectedReviewSha256: targets.find(item => item.id === memory.rollbackId)?.reviewSha256,
          expectedCandidateSha256: targets.find(item => item.id === memory.rollbackId)?.sha256,
          note: memory.rollbackNote.trim()
        });
      }, { disabled: Boolean(ctx.state.active) || targets.length === 0 })),
    card(title('Complete release history'),
      dcat.releases.length ? table(['Created', 'Release', 'Review', 'Preceding release', 'Candidate SHA-256', 'Decision'], dcat.releases.map(item => [
        readableTime(item.createdAt), item.id === dcat.activeReleaseId ? el('strong', {}, item.id + ' · active') : item.id,
        action(ctx, item.reviewId, async () => { memory.selectedReview = item.reviewId; await ctx.render(); }), item.previousReleaseId ?? 'Initial release', el('code', {}, item.sha256 ?? ''), item.note ?? ''
      ])) : note('The first cutover records the initial release.'),
      details('Complete saved release records', dcat.releases)));
}
export async function renderDcatMigration(ctx) {
  const memory = migrationMemory(ctx.state);
  const dcat = ctx.state.dcat ?? { catalogs: [], reviews: [], releases: [], activeReleaseId: null };
  for (const key of ['catalogs', 'reviews', 'releases']) if (!Array.isArray(dcat[key]))
    throw new Error('The saved DCAT workspace has an invalid ' + key + ' inventory.');
  ctx.view.append(el('h2', {}, 'Catalogue migration'),
    note('Receive original DCAT-US documents, review conversion and publisher changes, and retain the selected catalogue release with its rollback history.'),
    row(action(ctx, 'Refresh workspace', () => ctx.refresh()),
      action(ctx, 'Open complete workspace handover', () => ctx.openWorkspace()),
      action(ctx, 'Download operating guide', () => ctx.download('dcat/guide', 'MIGRATION_OPERATING.md'))));
  ctx.view.append(await renderDcatSources(ctx, {
    onReviewCreated: value => { memory.selectedReview = value; memory.filters = {}; },
  }));
  if (!ctx.current()) return;
  ctx.view.append(uploadPanel(ctx, memory), reviewPanel(ctx, dcat, memory));
  if (dcat.catalogs.length) ctx.view.append(card(title('Retained catalogue documents'),
    table(['Label', 'Profile', 'Original source', 'Received', 'Bytes', 'SHA-256'], dcat.catalogs.map(item => [
      item.label || item.id, item.profile ?? '', item.origin ?? '', readableTime(item.receivedAt),
      Number(item.bytes).toLocaleString(), el('code', {}, item.sha256)
    ]))));
  if (!dcat.reviews.length) {
    ctx.view.append(card(title('Saved migration reviews'), note(ctx.state.active ?
      'The current operation is preparing the retained document or review. Its progress appears above.' :
      'Receive a source and prepare its complete migration review.')));
    return;
  }
  if (memory.selectedReview && !dcat.reviews.some(item => item.id === memory.selectedReview) && ctx.state.active) {
    ctx.view.append(card(title('Preparing the selected review'), note('The original workspace operation is retaining this complete review. Its saved identity will open here when the operation finishes.')));
    return;
  }
  if (!dcat.reviews.some(item => item.id === memory.selectedReview)) memory.selectedReview = dcat.reviews.at(-1).id;
  const chooseReview = select('saved-review', dcat.reviews.map(item => [
    item.id, (item.label || item.id) + ' · ' + (item.status || 'saved') + ' · ' + readableTime(item.createdAt)
  ]), memory.selectedReview);
  chooseReview.addEventListener('change', () => ctx.protect(async () => {
    memory.selectedReview = chooseReview.value; memory.filters = {}; await ctx.render();
  }));
  ctx.view.append(card(field('Saved review', chooseReview, true)));
  const selected = memory.selectedReview, summary = dcat.reviews.find(item => item.id === selected);
  if (!['READY', 'NEEDS_CORRECTION'].includes(summary.status)) {
    const preparing = summary.status === 'PREPARING';
    ctx.view.append(card(row(title(summary.label || 'Saved migration review'), tag(summary.status || 'Saved')),
      note(preparing ? 'The original operation is preparing this complete review. Progress appears above; the saved report opens when that operation finishes.' :
        'This review retains its operation state and source selection. Read the original operation result above, correct the selected input or runtime issue, and prepare a new review.'),
      details('Complete saved review state', summary, true),
      action(ctx, 'Use these review sources', async () => {
        memory.sourceId = summary.sourceId;
        memory.comparisonId = summary.comparisonId || '';
        memory.candidateId = summary.candidateId || '';
        memory.normalizeV3 = Boolean(summary.normalizeV3);
        memory.label = summary.label || '';
        await ctx.render();
      }, { disabled: Boolean(ctx.state.active) })));
    return;
  }
  const report = await dcatApi(ctx, 'dcat/reviews/' + encodeURIComponent(selected));
  if (!ctx.current() || memory.selectedReview !== selected) return;
  memory.lastReadReview = { id: selected, summary, report };
  memory.refreshMappings?.();
  ctx.view.append(renderReport(ctx, dcat, summary, report, memory));
}
