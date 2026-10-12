const LIMIT_FIELDS = ['METHOD_DETECTION_LEVEL', 'LAB_REPORTING_LEVEL', 'PQL', 'LOWER_QUANT_LIMIT', 'UPPER_QUANT_LIMIT'];
const PAGE = 25;
const MAX_BUNDLE_BYTES = 128 * 1024 * 1024;
const $ = id => document.getElementById(id);
const text = value => value === null || value === undefined ? '—' : value === '' ? '(empty)' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const make = (tag, value, attrs = {}) => {
  const element = document.createElement(tag);
  if (value !== undefined && value !== null) element.textContent = String(value);
  for (const [key, item] of Object.entries(attrs)) if (item !== undefined && item !== null) element.setAttribute(key, String(item));
  return element;
};
const option = (node, value, label) => node.append(make('option', label, { value }));
const copy = value => structuredClone(value);
const defaults = () => ({ organizationId: '', projectId: '', locationMode: 'create', identityMode: 'compact',
  locationOverrides: [], activityOverrides: [], resultOverrides: [], fieldTranslations: [], limitMappings: [], referenceValues: {}, notes: '' });
const name = () => 'open-waters-' + new Date().toISOString().slice(0, 10).replaceAll('-', '') + '-' + crypto.randomUUID().slice(0, 8);
function normalizeOptions(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Mapping options must be a JSON object.');
  const result = { ...defaults(), ...copy(value) };
  for (const key of ['locationOverrides', 'activityOverrides', 'resultOverrides', 'fieldTranslations', 'limitMappings'])
    if (!Array.isArray(result[key])) throw new Error(key + ' must be an array.');
  if (!result.referenceValues || typeof result.referenceValues !== 'object' || Array.isArray(result.referenceValues))
    throw new Error('referenceValues must be an object of native reference kinds and string arrays.');
  for (const values of Object.values(result.referenceValues))
    if (!Array.isArray(values) || values.some(item => typeof item !== 'string')) throw new Error('Each supplied reference list must contain only exact strings.');
  for (const key of ['organizationId', 'projectId', 'notes']) if (typeof result[key] !== 'string') throw new Error(key + ' must be a string.');
  if (!['create', 'existing'].includes(result.locationMode) || !['compact', 'source'].includes(result.identityMode))
    throw new Error('Use create or existing for locationMode, and compact or source for identityMode.');
  for (const [property, identity] of [['locationOverrides', 'sourceKey'], ['activityOverrides', 'sourceKey'], ['resultOverrides', 'sourceRecordId']]) {
    for (const item of result[property]) {
      if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item[identity] !== 'string' || !item[identity])
        throw new Error(property + ' requires the exact ' + identity + ' from the native preview.');
      if (item.id !== undefined && typeof item.id !== 'string') throw new Error('Destination ID overrides must be strings.');
      if (item.mode !== undefined && !['create', 'existing'].includes(item.mode)) throw new Error('A station handling override must be create or existing.');
      if (item.fields !== undefined && (!item.fields || typeof item.fields !== 'object' || Array.isArray(item.fields) || Object.values(item.fields).some(value => typeof value !== 'string')))
        throw new Error('Every exact field override must have a native field name and string value.');
    }
  }
  for (const item of result.fieldTranslations)
    if (!item || ['field', 'from', 'to', 'reason'].some(key => typeof item[key] !== 'string')) throw new Error('Field translations require string field, from, to, and reason values.');
  for (const item of result.limitMappings)
    if (!item || typeof item.type !== 'string' || typeof item.reason !== 'string' || item.field !== null && !LIMIT_FIELDS.includes(item.field))
      throw new Error('Limit mappings require an exact type, a native limit field or null, and a string reason.');
  for (const item of result.fieldTranslations) if (!item.reason.trim()) throw new Error('Every field translation needs its reason.');
  for (const item of result.limitMappings) if (!item.reason.trim()) throw new Error('Enter a reason for the limit choice: ' + item.type);
  return result;
}
function fillSelect(node, values, empty, preferred = node.value) {
  node.replaceChildren(); option(node, '', empty);
  for (const [value, label] of values) option(node, value, label);
  if ([...node.options].some(item => item.value === preferred)) node.value = preferred;
}
function emptyRow(body, columns, message) {
  const row = make('tr'); row.append(make('td', message, { colspan: columns, class: 'empty' })); body.append(row);
}
function addCell(row, value, className = '') { const cell = make('td', value, className ? { class: className } : {}); row.append(cell); return cell; }
function shortId(value) { const str = text(value); return str.length > 100 ? str.slice(0, 97) + '…' : str; }
function hasErrors(row) { return (row.issues ?? []).some(issue => issue.severity === 'error'); }
function compatibility(row) { return row.ready ? 'Compatible row' : hasErrors(row) ? 'Field correction required' : 'Review required'; }
function issueText(row) { return (row.issues ?? []).map(issue => issue.code + ': ' + issue.message).join('\n'); }
function pairTable(pairs, columns = ['Field', 'Value']) {
  const wrap = make('div', null, { class: 'table-wrap' }), table = make('table', null, { class: 'ow-table' });
  const head = make('thead'), heading = make('tr'); for (const title of columns) heading.append(make('th', title)); head.append(heading);
  const body = make('tbody'); for (const pair of pairs) { const row = make('tr'); for (const value of pair) addCell(row, text(value), 'ow-wrap'); body.append(row); }
  table.append(head, body); wrap.append(table); return wrap;
}

export function mountOpenWaters({ api, notice, refresh }) {
  let workspace = null, draft = defaults(), preview = null, version = 0, previewVersion = -1, busy = false;
  let editingTranslation = null, detail = null, observed = new Map(), sourceLimits = new Map(), issueRows = [];
  const pages = { locations: 0, activities: 0, results: 0, references: 0, issues: 0 };
  let resultTimer, referenceTimer, issueTimer;

  function optionsFromForm() {
    return { ...copy(draft), organizationId: $('ow-organization').value, projectId: $('ow-project').value,
      locationMode: $('ow-location-mode').value, identityMode: $('ow-identity-mode').value, notes: $('ow-notes').value };
  }
  function syncOptionsJson() { $('ow-options-json').value = JSON.stringify(optionsFromForm(), null, 2); }
  function applyForm() {
    $('ow-organization').value = draft.organizationId ?? ''; $('ow-project').value = draft.projectId ?? '';
    $('ow-location-mode').value = draft.locationMode; $('ow-identity-mode').value = draft.identityMode; $('ow-notes').value = draft.notes ?? '';
    syncOptionsJson();
  }
  function changed() {
    version++; draft = optionsFromForm(); syncOptionsJson(); renderStatus();
  }
  function renderStatus() {
    $('ow-controls').disabled = busy;
    $('tab-open-waters').setAttribute('aria-busy', String(busy));
    const current = Boolean(preview && previewVersion === version && preview.reviewId === $('ow-review').value);
    $('ow-preview').disabled = busy || !$('ow-review').value;
    $('ow-open-plan').disabled = busy || !$('ow-saved-plan').value;
    $('ow-receive').disabled = busy;
    $('ow-save').disabled = busy || !current;
    $('ow-status').textContent = busy ? 'Working' : !preview ? 'Choose and preview' : current ? preview.planId ? 'Saved plan reopened' : 'Preview current' : 'Draft has changes';
    $('ow-save-state').textContent = current ? preview.planId ? 'Save revisions under a new name' : 'Ready to save exact preview' : 'Update preview before saving';
    $('ow-draft-status').textContent = !preview
      ? 'Choose the saved review and receiving identifiers, then preview the complete selection.'
      : current ? 'Showing review ' + preview.reviewId + '. All selected rows remain available in the plan.'
        : 'The displayed preview uses review ' + preview.reviewId + ' and its prior mapping options. Update the preview to apply the current draft.';
    $('ow-preview-body').classList.toggle('ow-stale', Boolean(preview && !current));
  }
  async function run(fn, event) {
    event?.preventDefault(); if (busy) return;
    busy = true; renderStatus();
    try { await fn(); } catch (error) { notice(error.message, true); }
    finally { busy = false; renderStatus(); }
  }
  function paginate(kind, rows) {
    const maximum = Math.max(0, Math.ceil(rows.length / PAGE) - 1);
    pages[kind] = Math.min(Math.max(0, pages[kind]), maximum);
    const start = pages[kind] * PAGE, finish = Math.min(rows.length, start + PAGE);
    $('ow-' + kind + '-page').textContent = rows.length ? (start + 1) + '–' + finish + ' of ' + rows.length : '0 rows';
    $('ow-' + kind + '-previous').disabled = pages[kind] === 0;
    $('ow-' + kind + '-next').disabled = pages[kind] >= maximum;
    return rows.slice(start, finish);
  }
  function pane(which) {
    document.querySelectorAll('[data-ow-pane]').forEach(button => button.setAttribute('aria-current', button.dataset.owPane === which ? 'page' : 'false'));
    document.querySelectorAll('.ow-pane').forEach(section => { section.hidden = section.id !== 'ow-pane-' + which; });
    $('ow-detail').hidden = true; detail = null;
  }
  function overrideInfo(kind, row) {
    return kind === 'result' ? { property: 'resultOverrides', key: 'sourceRecordId', value: row.sourceRecordId }
      : { property: kind === 'location' ? 'locationOverrides' : 'activityOverrides', key: 'sourceKey', value: row.sourceKey };
  }
  function currentOverride(kind, row) {
    const info = overrideInfo(kind, row); return draft[info.property].find(item => item[info.key] === info.value);
  }
  function editOverride(kind, row, change) {
    const info = overrideInfo(kind, row);
    if (typeof info.value !== 'string' || !info.value) throw new Error('The native preview did not provide this record identity.');
    const index = draft[info.property].findIndex(item => item[info.key] === info.value);
    const item = index < 0 ? { [info.key]: info.value } : copy(draft[info.property][index]); change(item);
    if (item.fields && !Object.keys(item.fields).length) delete item.fields;
    if (Object.keys(item).length === 1) { if (index >= 0) draft[info.property].splice(index, 1); }
    else if (index < 0) draft[info.property].push(item); else draft[info.property][index] = item;
    changed();
  }
  function detailButton(row, kind) {
    const button = make('button', 'Inspect / edit fields', { type: 'button', class: 'row-view' });
    button.addEventListener('click', () => showDetail(kind, row)); return button;
  }
  function renderLocations() {
    const body = $('ow-locations'); body.replaceChildren();
    for (const row of paginate('locations', preview?.locations ?? [])) {
      const tr = make('tr'), first = addCell(tr, row.sourceId, 'ow-wrap'); first.append(make('small', shortId(row.sourceKey)));
      addCell(tr, row.destinationId, 'ow-wrap');
      const input = make('input', null, { 'aria-label': 'Destination ID override for location ' + row.sourceId, placeholder: row.destinationId ?? '', autocomplete: 'off' });
      input.value = currentOverride('location', row)?.id ?? '';
      input.addEventListener('input', () => editOverride('location', row, item => { if (input.value) item.id = input.value; else delete item.id; })); addCell(tr, null).append(input);
      const mode = make('select', null, { 'aria-label': 'Handling override for location ' + row.sourceId });
      option(mode, '', 'Use station default'); option(mode, 'create', 'Create location row'); option(mode, 'existing', 'Use existing location');
      mode.value = currentOverride('location', row)?.mode ?? '';
      mode.addEventListener('change', () => editOverride('location', row, item => { if (mode.value) item.mode = mode.value; else delete item.mode; })); addCell(tr, null).append(mode);
      const status = addCell(tr, row.mode === 'existing' ? 'Existing location reference' : compatibility(row), 'ow-wrap');
      if (row.issues?.length) status.append(make('small', row.issues.length + ' receiving issues', { title: issueText(row) }));
      status.append(detailButton(row, 'location')); body.append(tr);
    }
    if (!body.children.length) emptyRow(body, 5, 'This selection has no station identity rows.');
  }
  function renderActivities() {
    const body = $('ow-activities'); body.replaceChildren();
    for (const row of paginate('activities', preview?.activities ?? [])) {
      const tr = make('tr'), first = addCell(tr, row.sourceId, 'ow-wrap'); first.append(make('small', shortId(row.sourceKey)));
      addCell(tr, row.destinationId, 'ow-wrap');
      const input = make('input', null, { 'aria-label': 'Destination ID override for activity ' + row.sourceId, placeholder: row.destinationId ?? '', autocomplete: 'off' });
      input.value = currentOverride('activity', row)?.id ?? '';
      input.addEventListener('input', () => editOverride('activity', row, item => { if (input.value) item.id = input.value; else delete item.id; })); addCell(tr, null).append(input);
      const last = addCell(tr, (row.changes?.length ?? 0) + ' changes · ' + (row.issues?.length ?? 0) + ' issues', 'ow-wrap');
      last.append(detailButton(row, 'activity')); body.append(tr);
    }
    if (!body.children.length) emptyRow(body, 4, 'This selection has no activity identity rows.');
  }
  function nativeFields(kind) {
    const fields = preview?.fieldChoices?.[kind];
    return Array.isArray(fields) ? [...new Set(fields.filter(field => typeof field === 'string'))] : [];
  }
  function inspectObserved() {
    observed = new Map(); sourceLimits = new Map();
    issueRows = (preview.issues ?? []).map(issue => ({ kind: 'plan', row: { sourceId: preview.planId ?? preview.reviewId }, issue }));
    for (const [kind, rows] of [['location', preview.locations ?? []], ['activity', preview.activities ?? []], ['result', preview.results ?? []]]) {
      for (const row of rows) {
        for (const [field, value] of Object.entries(row.fields ?? {})) {
          if (!observed.has(field)) observed.set(field, new Map());
          const values = observed.get(field), exact = value === null || value === undefined ? '' : String(value); values.set(exact, (values.get(exact) ?? 0) + 1);
        }
        for (const issue of row.issues ?? []) issueRows.push({ kind, row, issue });
        if (kind === 'result') for (const limit of row.limits ?? []) {
          if (typeof limit.type !== 'string') continue;
          if (!sourceLimits.has(limit.type)) sourceLimits.set(limit.type, { count: 0, examples: new Set(), targets: new Set(), reasons: new Set() });
          const item = sourceLimits.get(limit.type); item.count++;
          if (item.examples.size < 3) item.examples.add(text(limit.value) + (limit.unit ? ' ' + limit.unit : ''));
          item.targets.add(limit.targetField ?? null); if (limit.choiceReason) item.reasons.add(limit.choiceReason);
        }
      }
    }
    const displayFields = [...new Set([...observed.keys(), ...nativeFields('activity'), ...nativeFields('result')])].sort();
    $('ow-field-names').replaceChildren();
    for (const field of nativeFields('translation')) option($('ow-field-names'), field, field);
    fillSelect($('ow-result-field'), displayFields.map(field => [field, field]), 'No additional field');
    const kinds = [...new Set((preview.references ?? []).map(item => item.kind))].filter(Boolean).sort();
    const families = [...new Set([...(preview.references ?? []).filter(item => item.kind === 'reference').map(item => item.name), ...Object.keys(draft.referenceValues)])].filter(Boolean).sort();
    fillSelect($('ow-reference-kind-filter'), kinds.map(kind => [kind, kind]), 'All requirement kinds');
    fillSelect($('ow-reference-kind'), families.map(family => [family, family]), 'Select a reference family');
    $('ow-issue-counts').textContent = Object.entries(preview.summary?.issueCounts ?? {}).map(([code, count]) => code + ': ' + count).join(' · ');
    renderObservedValues(); renderReferenceEditor();
  }
  function renderObservedValues() {
    const values = observed.get($('ow-translation-field').value) ?? new Map(); $('ow-observed-values').replaceChildren();
    for (const [value, count] of values) option($('ow-observed-values'), value, shortId(value) + ' · ' + count + ' rows');
    $('ow-observed-count').textContent = values.size ? values.size + ' exact values in the current preview for this receiving field.' : 'Choose a native field from the current preview; enter the exact value to translate.';
  }
  function renderTranslations() {
    const body = $('ow-translations'); body.replaceChildren();
    draft.fieldTranslations.forEach((rule, index) => {
      const tr = make('tr'); for (const value of [rule.field, rule.from, rule.to, rule.reason]) addCell(tr, text(value), 'ow-wrap');
      const cell = addCell(tr, null), edit = make('button', 'Edit', { type: 'button', class: 'row-view' }), remove = make('button', 'Remove', { type: 'button', class: 'row-view' });
      edit.addEventListener('click', () => {
        editingTranslation = index; for (const field of ['field', 'from', 'to', 'reason']) $('ow-translation-' + field).value = rule[field] ?? '';
        $('ow-add-translation').textContent = 'Update translation rule'; $('ow-cancel-translation').hidden = false; renderObservedValues(); $('ow-translation-field').focus();
      });
      remove.addEventListener('click', () => { draft.fieldTranslations.splice(index, 1); resetTranslation(); changed(); renderTranslations(); });
      cell.append(edit, remove); body.append(tr);
    });
    if (!body.children.length) emptyRow(body, 5, 'No exact-value translation rules have been added.');
  }
  function resetTranslation() {
    editingTranslation = null; $('ow-translation-form').reset(); $('ow-add-translation').textContent = 'Add translation rule';
    $('ow-cancel-translation').hidden = true; renderObservedValues();
  }
  function renderLimits() {
    const body = $('ow-limits'); body.replaceChildren();
    const types = [...new Set([...sourceLimits.keys(), ...draft.limitMappings.map(rule => rule.type)])];
    for (const type of types) {
      const stats = sourceLimits.get(type), rule = draft.limitMappings.find(item => item.type === type), tr = make('tr');
      addCell(tr, text(type), 'ow-wrap'); addCell(tr, (stats?.count ?? 0) + ' limits' + (stats?.examples.size ? '\n' + [...stats.examples].join(' · ') : ''), 'ow-wrap');
      const select = make('select', null, { 'aria-label': 'Native field for limit type ' + type });
      option(select, '', 'Retain in comments / crosswalk'); for (const field of LIMIT_FIELDS) option(select, field, field);
      select.value = rule ? rule.field ?? '' : stats?.targets.size === 1 ? [...stats.targets][0] ?? '' : '';
      const reason = make('input', null, { 'aria-label': 'Mapping reason for limit type ' + type, placeholder: 'Reason for this choice', autocomplete: 'off' });
      reason.value = rule?.reason ?? (stats?.reasons.size === 1 ? [...stats.reasons][0] : '');
      const update = () => {
        const next = { type, field: select.value || null, reason: reason.value }, index = draft.limitMappings.findIndex(item => item.type === type);
        if (index < 0) draft.limitMappings.push(next); else draft.limitMappings[index] = next; changed();
      };
      select.addEventListener('change', update); reason.addEventListener('input', update);
      addCell(tr, null).append(select); addCell(tr, null).append(reason); body.append(tr);
    }
    if (!body.children.length) emptyRow(body, 4, 'No detection or quantitation limits occur in this selection.');
  }
  function resultMatches(row) {
    const filter = $('ow-result-filter').value;
    if (filter === 'ready' && !row.ready || filter === 'review' && row.ready || filter === 'error' && !hasErrors(row)) return false;
    const query = $('ow-result-search').value.toLocaleLowerCase().trim(); if (!query) return true;
    return [row.sourceRecordId, row.nativeResultId, row.destinationActivityId, row.destinationLocationId, ...Object.values(row.fields ?? {})]
      .some(value => value !== null && value !== undefined && String(value).toLocaleLowerCase().includes(query));
  }
  function renderResults() {
    const rows = (preview?.results ?? []).filter(resultMatches), body = $('ow-results'); body.replaceChildren();
    const selectedField = $('ow-result-field').value; $('ow-result-field-heading').textContent = selectedField || 'Limits / changes';
    for (const row of paginate('results', rows)) {
      const fields = row.fields ?? {}, tr = make('tr'), first = addCell(tr, row.sourceRecordId, 'ow-wrap');
      first.append(make('small', text(fields.ACT_START_DT) + (fields.ACT_START_TIME ? ' · ' + fields.ACT_START_TIME : '')));
      const value = addCell(tr, text(fields.CHAR_NAME), 'ow-wrap');
      value.append(make('small', text(fields.RESULT_MSR) + (fields.RESULT_MSR_UNIT ? ' ' + fields.RESULT_MSR_UNIT : '')));
      if (fields.RESULT_DETECT_CONDITION) value.append(make('small', fields.RESULT_DETECT_CONDITION));
      const identity = addCell(tr, row.destinationActivityId, 'ow-wrap'); identity.append(make('small', text(row.destinationLocationId)));
      addCell(tr, selectedField ? text(fields[selectedField]) : (row.limits?.length ?? 0) + ' limits · ' + (row.changes?.length ?? 0) + ' changes', 'ow-wrap');
      const status = addCell(tr, compatibility(row), 'ow-wrap'); if (row.issues?.length) status.append(make('small', row.issues.length + ' issues', { title: issueText(row) }));
      addCell(tr, null).append(detailButton(row, 'result')); body.append(tr);
    }
    if (!body.children.length) emptyRow(body, 6, 'No selected rows match this filter.');
  }
  function referenceState(item) { return item.matched === true ? 'Matched supplied value' : item.matched === false ? 'Absent from supplied list' : 'Receiving lookup required'; }
  function renderReferences() {
    const filter = $('ow-reference-filter').value, kind = $('ow-reference-kind-filter').value, query = $('ow-reference-search').value.toLocaleLowerCase().trim();
    const rows = (preview?.references ?? []).filter(row => (!kind || row.kind === kind)
      && (filter === 'all' || filter === 'matched' && row.matched === true || filter === 'missing' && row.matched === false || filter === 'unknown' && row.matched !== true && row.matched !== false)
      && (!query || [row.kind, row.name, row.value, row.context].some(value => text(value).toLocaleLowerCase().includes(query))));
    const body = $('ow-references'); body.replaceChildren();
    for (const row of paginate('references', rows)) {
      const tr = make('tr'), first = addCell(tr, row.kind, 'ow-wrap'); if (row.name && row.name !== row.kind) first.append(make('small', row.name));
      addCell(tr, text(row.value), 'ow-wrap'); addCell(tr, text(row.context) + ' · ' + (row.count ?? 0) + ' uses', 'ow-wrap');
      addCell(tr, referenceState(row), 'ow-wrap'); body.append(tr);
    }
    if (!body.children.length) emptyRow(body, 4, 'No receiving references match this filter.');
  }
  function renderReferenceEditor() {
    const kind = $('ow-reference-kind').value; $('ow-reference-values').value = (draft.referenceValues[kind] ?? []).join('\n');
  }
  function renderIssues() {
    const filter = $('ow-issue-filter').value, query = $('ow-issue-search').value.toLocaleLowerCase().trim();
    const rows = issueRows.filter(item => (filter === 'all' || item.issue.severity === filter)
      && (!query || [item.row.sourceRecordId, item.row.sourceId, item.issue.code, item.issue.field, item.issue.message].some(value => text(value).toLocaleLowerCase().includes(query))));
    const body = $('ow-issues'); body.replaceChildren();
    for (const item of paginate('issues', rows)) {
      const tr = make('tr'); addCell(tr, item.kind + ' · ' + text(item.row.sourceRecordId ?? item.row.sourceId), 'ow-wrap');
      addCell(tr, item.issue.severity + ' · ' + item.issue.code, 'ow-wrap'); addCell(tr, text(item.issue.field), 'ow-wrap');
      addCell(tr, item.issue.message, 'ow-wrap');
      const action = addCell(tr, null);
      if (item.kind === 'plan') {
        const button = make('button', 'Review receiving context', { type: 'button', class: 'row-view' });
        button.addEventListener('click', () => {
          $('ow-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
          (/project/i.test(item.issue.field ?? '') ? $('ow-project') : $('ow-organization')).focus({ preventScroll: true });
        });
        action.append(button);
      } else action.append(detailButton(item.row, item.kind));
      body.append(tr);
    }
    if (!body.children.length) emptyRow(body, 5, 'No receiving issues match this filter.');
  }
  function showDetail(kind, row) {
    detail = { kind, row }; $('ow-detail').hidden = false;
    $('ow-detail-title').textContent = (kind === 'result' ? 'Result ' + row.sourceRecordId : (kind === 'location' ? 'Station ' : 'Activity ') + row.sourceId);
    const target = $('ow-detail-content'); target.replaceChildren();
    const pairs = kind === 'result' ? [['Original source record', row.sourceRecordId], ['Native result ID', row.nativeResultId], ['Destination activity', row.destinationActivityId], ['Destination location', row.destinationLocationId]]
      : [['Original source ID', row.sourceId], ['Destination ID', row.destinationId], ...(kind === 'location' ? [['Station handling', row.mode]] : [])];
    if (row.sourceKey) pairs.push(['Full native source identity', row.sourceKey]); target.append(pairTable(pairs));
    if (row.issues?.length) { target.append(make('h3', 'Receiving issues'), pairTable(row.issues.map(issue => [issue.severity, issue.code, issue.field, issue.message]), ['Severity', 'Code', 'Native field', 'Issue'])); }
    if (row.changes?.length) { target.append(make('h3', 'Recorded field changes'), pairTable(row.changes.map(change => [change.field, change.from, change.to, change.reason]), ['Field', 'Original value', 'Receiving value', 'Reason'])); }
    if (row.limits?.length) {
      target.append(make('h3', 'Every original detection and quantitation limit'),
        pairTable(row.limits.map(limit => [limit.id, limit.type, limit.value, limit.unit, limit.targetField ?? 'Comments / crosswalk', limit.choiceReason, limit.origin, limit.comment]),
          ['Limit ID', 'Original type', 'Value', 'Unit', 'Native target', 'Choice reason', 'Origin', 'Original comment']));
      const originals = make('details'), summary = make('summary', 'Original limit source and row pointers');
      originals.append(summary, make('pre', JSON.stringify(row.limits.map(limit => ({ id: limit.id, source: limit.source, origin: limit.origin })), null, 2))); target.append(originals);
    }
    target.append(make('h3', 'Complete receiving field values'), pairTable(Object.entries(row.fields ?? {}), ['Native field', 'Preview value']));
    const fields = nativeFields(kind); $('ow-field-name').replaceChildren();
    for (const field of fields) option($('ow-field-name'), field, field);
    $('ow-field-editor').hidden = !fields.length; $('ow-field-editor').open = false; renderFieldEditor();
    $('ow-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function renderFieldEditor() {
    if (!detail) return; const field = $('ow-field-name').value, override = currentOverride(detail.kind, detail.row);
    $('ow-field-current').textContent = 'Current preview value: ' + text(detail.row.fields?.[field]);
    $('ow-field-value').value = override?.fields && Object.hasOwn(override.fields, field) ? override.fields[field] : detail.row.fields?.[field] ?? '';
    $('ow-remove-field').disabled = !(override?.fields && Object.hasOwn(override.fields, field));
  }
  function renderDownloads() {
    const files = preview?.planId ? preview.files ?? [] : []; $('ow-files').hidden = !files.length;
    const target = $('ow-downloads'); target.replaceChildren();
    const titles = { locations: 'Compatible location import', results: 'Compatible sample / result import', crosswalk: 'Complete identity and field crosswalk',
      report: 'Complete receiving report', bundle: 'Complete portable plan bundle', references: 'Native receiving reference requirements' };
    for (const file of files) {
      const row = make('div', null, { class: 'record file-row' }), description = make('div');
      description.append(make('strong', titles[file.format] ?? file.format), make('small', file.filename + ' · ' + Number(file.bytes).toLocaleString() + ' bytes'), make('small', 'SHA-256 ' + file.sha256));
      const link = make('a', 'Download', { class: 'download', href: '/api/open-waters/' + encodeURIComponent(preview.planId) + '/' + encodeURIComponent(file.format), download: file.filename });
      row.append(description, link); target.append(row);
    }
  }
  function renderPreview() {
    $('ow-preview-body').hidden = !preview; if (!preview) { renderStatus(); return; }
    $('ow-preview-title').textContent = preview.planId ? 'Saved plan · ' + preview.planId : 'Receiving preview';
    $('ow-preview-identity').textContent = preview.reviewId;
    const summary = preview.summary ?? {}, references = preview.references ?? [], metrics = [
      ['Selected source results', summary.selectedResults ?? preview.results?.length ?? 0],
      ['Compatible result rows', summary.readyResults ?? 0], ['Result rows needing review', summary.reviewResults ?? 0],
      ['Distinct samples', summary.distinctActivities ?? preview.activities?.length ?? 0], ['New compatible locations', summary.readyLocations ?? 0],
      ['Existing location references', summary.existingLocations ?? 0], ['Mapped original limits', summary.mappedLimits ?? 0],
      ['Limits outside native slots', summary.retainedLimits ?? 0], ['Reference values to reconcile', references.filter(row => row.matched !== true).length]
    ];
    $('ow-summary').replaceChildren();
    for (const [label, value] of metrics) { const box = make('div'); box.append(make('span', label), make('strong', Number(value).toLocaleString())); $('ow-summary').append(box); }
    $('ow-source-identity').replaceChildren();
    for (const [label, value] of [['Review', preview.reviewId], ['Review SHA-256', preview.reviewSha256], ['Capture', preview.captureId], ['Capture SHA-256', preview.captureSha256], ['Plan SHA-256', preview.planSha256], ['All source results', summary.sourceResults]])
      $('ow-source-identity').append(make('dt', label), make('dd', text(value)));
    inspectObserved(); renderLocations(); renderActivities(); renderTranslations(); renderLimits(); renderResults(); renderReferences(); renderIssues(); renderDownloads(); renderStatus();
  }
  function acceptPlan(record) {
    preview = record; draft = normalizeOptions(record.options); version++; previewVersion = version;
    if (![...$('ow-review').options].some(item => item.value === record.reviewId)) option($('ow-review'), record.reviewId, record.reviewId);
    $('ow-review').value = record.reviewId; applyForm(); $('ow-plan-id').value = name();
    for (const key of Object.keys(pages)) pages[key] = 0;
    $('ow-detail').hidden = true; detail = null; resetTranslation(); renderPreview();
  }

  $('ow-form').addEventListener('input', changed);
  $('ow-form').addEventListener('change', renderStatus);
  $('ow-form').addEventListener('submit', event => run(async () => {
    const requestedVersion = version, reviewId = $('ow-review').value, options = normalizeOptions(optionsFromForm());
    const record = await api('/api/open-waters/preview', { reviewId, options });
    if (version === requestedVersion) acceptPlan(record);
    else { preview = record; previewVersion = requestedVersion; renderPreview(); }
    $('ow-preview-body').scrollIntoView({ behavior: 'smooth', block: 'start' });
    notice('Receiving preview contains ' + (record.summary?.selectedResults ?? record.results?.length ?? 0) + ' selected result rows.');
  }, event));
  $('ow-new').addEventListener('click', () => {
    if (busy) return; preview = null; previewVersion = -1; draft = defaults(); version++; applyForm();
    $('ow-plan-id').value = name(); $('ow-saved-plan').value = ''; $('ow-preview-body').hidden = true; resetTranslation(); renderStatus();
    notice('New receiving draft opened. Choose its review and receiving identifiers.');
  });
  $('ow-apply-json').addEventListener('click', () => {
    try { draft = normalizeOptions(JSON.parse($('ow-options-json').value)); applyForm(); changed(); if (preview) renderPreview(); notice('Complete mapping options applied to the draft. Update the receiving preview.'); }
    catch (error) { notice(error.message, true); }
  });
  $('ow-reset-json').addEventListener('click', syncOptionsJson);
  $('ow-saved-plan').addEventListener('change', renderStatus);
  $('ow-open-plan').addEventListener('click', event => run(async () => {
    const id = $('ow-saved-plan').value; if (!id) throw new Error('Choose a saved receiving plan.');
    acceptPlan(await api('/api/open-waters/' + encodeURIComponent(id))); $('ow-preview-body').scrollIntoView({ behavior: 'smooth', block: 'start' });
    notice('Immutable receiving plan ' + id + ' reopened.');
  }, event));
  $('ow-save-form').addEventListener('submit', event => run(async () => {
    if (!preview || previewVersion !== version || preview.reviewId !== $('ow-review').value) throw new Error('Update the receiving preview before saving its current mappings.');
    const planId = $('ow-plan-id').value;
    if (planId === preview.planId) throw new Error('Use a new name to save a revised immutable receiving plan.');
    const record = await api('/api/open-waters', { planId, reviewId: preview.reviewId, options: copy(preview.options), expectedReviewSha256: preview.reviewSha256 });
    acceptPlan(record); await refresh(); $('ow-saved-plan').value = record.planId;
    notice('Complete receiving plan ' + record.planId + ' saved with its original source and all selected results.');
  }, event));
  $('ow-receive-form').addEventListener('submit', event => run(async () => {
    const file = $('ow-receive-file').files[0]; if (!file) throw new Error('Choose a complete Open Waters plan bundle.');
    if (file.size > MAX_BUNDLE_BYTES) throw new Error('This receiving bundle exceeds 128 MiB.');
    const bundle = JSON.parse(await file.text()), record = await api('/api/open-waters/receive', { bundle });
    await refresh(); acceptPlan(record); $('ow-saved-plan').value = record.planId;
    $('ow-preview-body').scrollIntoView({ behavior: 'smooth', block: 'start' });
    notice('Complete receiving plan ' + record.planId + ' restored with its original capture and saved review.');
  }, event));
  document.querySelectorAll('[data-ow-pane]').forEach(button => button.addEventListener('click', () => pane(button.dataset.owPane)));
  const renders = { locations: renderLocations, activities: renderActivities, results: renderResults, references: renderReferences, issues: renderIssues };
  for (const kind of Object.keys(pages)) for (const [direction, delta] of [['previous', -1], ['next', 1]])
    $('ow-' + kind + '-' + direction).addEventListener('click', () => { pages[kind] += delta; renders[kind](); });
  $('ow-translation-field').addEventListener('input', renderObservedValues);
  $('ow-translation-form').addEventListener('submit', event => {
    event.preventDefault();
    const rule = Object.fromEntries(['field', 'from', 'to', 'reason'].map(field => [field, $('ow-translation-' + field).value]));
    if (!nativeFields('translation').includes(rule.field)) { notice('Choose an allowed native translation field from the current preview.', true); return; }
    if (!rule.reason.trim()) { notice('Enter the reason for this exact-value translation.', true); return; }
    const duplicate = draft.fieldTranslations.findIndex((item, index) => index !== editingTranslation && item.field === rule.field && item.from === rule.from);
    if (duplicate >= 0) { notice('This exact field and source value already have a translation rule. Edit the existing rule.', true); return; }
    if (editingTranslation === null) draft.fieldTranslations.push(rule); else draft.fieldTranslations[editingTranslation] = rule;
    resetTranslation(); changed(); renderTranslations();
  });
  $('ow-cancel-translation').addEventListener('click', resetTranslation);
  for (const id of ['ow-result-filter', 'ow-result-field']) $(id).addEventListener('change', () => { pages.results = 0; renderResults(); });
  $('ow-result-search').addEventListener('input', () => { clearTimeout(resultTimer); resultTimer = setTimeout(() => { pages.results = 0; renderResults(); }, 160); });
  for (const id of ['ow-reference-filter', 'ow-reference-kind-filter']) $(id).addEventListener('change', () => { pages.references = 0; renderReferences(); });
  $('ow-reference-search').addEventListener('input', () => { clearTimeout(referenceTimer); referenceTimer = setTimeout(() => { pages.references = 0; renderReferences(); }, 160); });
  $('ow-reference-kind').addEventListener('change', renderReferenceEditor);
  $('ow-reference-form').addEventListener('submit', event => {
    event.preventDefault(); const kind = $('ow-reference-kind').value;
    if (!kind) { notice('Choose the native reference family for these receiving values.', true); return; }
    draft.referenceValues[kind] = [...new Set($('ow-reference-values').value.split(/\r?\n/).filter(value => value !== ''))]; changed();
    notice('The supplied ' + kind + ' reference list is in the draft. Update the preview to compare its exact values.');
  });
  $('ow-remove-reference-kind').addEventListener('click', () => {
    const kind = $('ow-reference-kind').value; if (!kind) return; delete draft.referenceValues[kind]; renderReferenceEditor(); changed();
  });
  $('ow-reference-file').addEventListener('change', event => run(async () => {
    const file = event.target.files[0]; if (!file) return;
    if (file.size > MAX_BUNDLE_BYTES) throw new Error('This reference-values JSON exceeds 128 MiB.');
    const referenceValues = JSON.parse(await file.text()); draft = normalizeOptions({ ...optionsFromForm(), referenceValues });
    changed(); if (preview) renderPreview(); notice('Native reference values loaded into the receiving draft.');
  }, event));
  $('ow-issue-filter').addEventListener('change', () => { pages.issues = 0; renderIssues(); });
  $('ow-issue-search').addEventListener('input', () => { clearTimeout(issueTimer); issueTimer = setTimeout(() => { pages.issues = 0; renderIssues(); }, 160); });
  $('ow-close-detail').addEventListener('click', () => { $('ow-detail').hidden = true; detail = null; });
  $('ow-field-name').addEventListener('change', renderFieldEditor);
  $('ow-field-form').addEventListener('submit', event => {
    event.preventDefault(); if (!detail) return; const field = $('ow-field-name').value;
    editOverride(detail.kind, detail.row, item => { item.fields ??= {}; item.fields[field] = $('ow-field-value').value; });
    renderFieldEditor(); notice('Exact field override saved to the draft. Update the preview to check the complete receiving row.');
  });
  $('ow-remove-field').addEventListener('click', () => {
    if (!detail) return; const field = $('ow-field-name').value;
    editOverride(detail.kind, detail.row, item => { if (item.fields) delete item.fields[field]; }); renderFieldEditor();
  });

  $('ow-plan-id').value = name(); applyForm(); renderStatus();
  return {
    update(next) {
      workspace = next;
      const review = $('ow-review').value;
      fillSelect($('ow-review'), (workspace.reviews ?? []).map(item => [item.reviewId, item.reviewId]), 'Select a saved review', review);
      if (!$('ow-review').value && workspace.reviews?.length === 1) $('ow-review').value = workspace.reviews[0].reviewId;
      const plans = workspace.openWaters ?? [];
      fillSelect($('ow-saved-plan'), plans.map(item => [item.planId, item.planId + ' · ' + item.reviewId]), 'Select an immutable plan', preview?.planId ?? $('ow-saved-plan').value);
      $('ow-plan-count').textContent = plans.length; renderStatus();
    }
  };
}
