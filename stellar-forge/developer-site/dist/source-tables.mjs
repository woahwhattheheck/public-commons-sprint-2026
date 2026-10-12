// MIT. Browser authoring over the same original-source model and native generator as the CLI.
import {
  TYPES, EMPTY_POLICIES, LIMITS, createProject, addDocument, addEdition, initialMapping,
  freezeReview, importProject, inspectSource, parseTable, decodeSource, selectedEdition, selectedReview,
  reviewIsCurrent, compareReviews, comparisonCsv, createTableArchive, SourceTableError,
} from './source-table-workspace.mjs';
import { importWorkspaceDraft } from './onboarding.mjs';

const $ = id => document.getElementById(id);
const clone = value => structuredClone(value);
const json = value => JSON.stringify(value, null, 2) + '\n';
const labels = { text: 'Text', integer: 'Safe JSON integer', 'integer-text': 'Integer text', 'decimal-text': 'Decimal text', boolean: 'True / false', date: 'Date text', timestamp: 'Timestamp text' };
const empties = { keep: 'Empty text', null: 'JSON null', omit: 'Omit field', error: 'Require value' };
let project = createProject(), documentId = null, busy = false, dirty = false, savedRef = null, database;
const currentDocument = () => project.documents.find(d => d.id === documentId);
const resourceFor = doc => project.starter.resources.find(r => r.id === doc.resourceId);
function element(tag, text, className) {
  const value = document.createElement(tag);
  if (text !== undefined) value.textContent = text;
  if (className) value.className = className;
  return value;
}
function message(value) { $('status').textContent = value; }
function clearError() { $('error').hidden = true; $('error').replaceChildren(); }
function showError(error) {
  const area = $('error'); area.replaceChildren(element('strong', error.message || String(error)));
  const issues = error.issues || error.errors || [];
  if (issues.length) {
    const list = element('ul');
    for (const issue of issues) {
      const row = element('li');
      const prefix = issue.record ? 'Record ' + issue.record + ', line ' + issue.line + (issue.name ? ', ' + issue.name : '') + ': ' : '';
      row.append(element('span', prefix + issue.message));
      if (Number.isInteger(issue.column)) {
        const button = element('button', 'Review field');
        button.type = 'button'; button.addEventListener('click', () => { const input = $('column-name-' + issue.column); input?.focus(); input?.scrollIntoView({ block: 'center' }); });
        row.append(' ', button);
      }
      list.append(row);
    }
    area.append(list);
  }
  if (error.issuesTruncated) area.append(element('p', 'Showing the first ' + issues.length + ' of ' + error.issueCount + ' issues. All source records remain in the project.'));
  area.hidden = false;
}
function touch() {
  dirty = true;
  const doc = currentDocument();
  $('review-state').textContent = doc && reviewIsCurrent(doc) ? 'Current source and mapping are retained.' : 'The current source or mapping needs a retained review.';
  $('export-workspace').disabled = busy || !project.documents.length || project.documents.some(d => !reviewIsCurrent(d));
  message('Unsaved project changes.');
}
async function perform(action) {
  if (busy) return;
  busy = true; clearError();
  for (const control of document.querySelectorAll('button,input,select')) control.disabled = true;
  try { await action(); }
  catch (error) { showError(error); message('Your current project remains available.'); }
  finally { busy = false; render(); }
}
function download(name, content, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = element('a'); anchor.href = url; anchor.download = name.replace(/[\\/]/g, '-');
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
async function fileText(file, limit) {
  if (file.size > limit) throw new SourceTableError('FILE_SIZE', 'The file exceeds the selected workflow size limit.');
  return decodeSource(await file.arrayBuffer());
}
function replaceProject(next, selection = null) {
  project = next;
  documentId = selection || next.documents[0]?.id || null;
  dirty = true;
}
function chooseFile(input) { if (!busy) { $(input).value = ''; $(input).click(); } }
function option(value, label, selected) { const node = element('option', label); node.value = value; node.selected = selected; return node; }
function previewValue(value, original = false) {
  if (value === undefined) return '(omitted)';
  if (value === null) return 'null';
  const text = typeof value === 'string' ? (value === '' ? '""' : value) : JSON.stringify(value);
  return text.length > 600 ? text.slice(0, 600) + ' … [preview shortened]' : text;
}
function table(headings, rows, recordNumbers) {
  const t = element('table', undefined, 'preview-table'), head = element('thead'), tr = element('tr'), body = element('tbody');
  if (recordNumbers) tr.append(element('th', 'Record'));
  for (const heading of headings) { const th = element('th', heading); th.scope = 'col'; tr.append(th); }
  head.append(tr);
  rows.forEach((row, i) => {
    const line = element('tr');
    if (recordNumbers) line.append(element('td', String(recordNumbers[i]), 'record'));
    for (const cell of row) line.append(element('td', previewValue(cell)));
    body.append(line);
  });
  t.append(head, body); return t;
}
function renderSources() {
  const list = $('document-list'); list.replaceChildren();
  $('table-count').textContent = '(' + project.documents.length + ')';
  for (const doc of project.documents) {
    const button = element('button'); button.type = 'button'; button.setAttribute('aria-current', String(doc.id === documentId));
    button.append(element('span', doc.label), element('small', doc.editions.length + ' edition' + (doc.editions.length === 1 ? '' : 's') + ' · ' + (reviewIsCurrent(doc) ? 'review retained' : 'review pending')));
    button.addEventListener('click', () => { documentId = doc.id; clearError(); render(); });
    list.append(button);
  }
  const bind = $('bind-resource'), selected = bind.value; bind.replaceChildren(option('', 'New merchant resource', selected === ''));
  for (const resource of project.starter.resources) if (!project.documents.some(d => d.resourceId === resource.id))
    bind.append(option(resource.id, resource.id + ' · ' + resource.path, selected === resource.id));
}
function renderSourcePreview(doc) {
  const edition = selectedEdition(doc); $('source-preview').replaceChildren();
  try {
    const parsed = parseTable(edition.sourceText, doc.mapping);
    $('source-summary').textContent = parsed.rows.length + ' data records · ' + parsed.width + ' columns · ' + parsed.skippedEmptyRecords + ' empty records skipped · ' + edition.bytes + ' original bytes · SHA-256 ' + edition.sha256;
    $('source-preview').append(table(parsed.headings, parsed.rows.slice(0, 20).map(r => r.cells), parsed.rows.slice(0, 20).map(r => r.record)));
  } catch (error) {
    $('source-summary').textContent = edition.bytes + ' original bytes · SHA-256 ' + edition.sha256;
    $('source-preview').append(element('p', error.message));
  }
}
function mappingControl(type, value, label, onChange) {
  const control = document.createElement(type === 'select' ? 'select' : 'input');
  control.setAttribute('aria-label', label);
  if (type !== 'select') control.type = type;
  if (type === 'checkbox') control.checked = Boolean(value);
  else control.value = value;
  control.addEventListener(type === 'text' ? 'input' : 'change', () => onChange(type === 'checkbox' ? control.checked : control.value));
  return control;
}
function renderMapping(doc) {
  const body = $('mapping-rows'); body.replaceChildren();
  for (const column of doc.mapping.columns) {
    const row = element('tr'), prefix = 'Field ' + (column.index + 1) + ' ';
    const append = control => { const cell = element('td'); cell.append(control); row.append(cell); return control; };
    append(mappingControl('checkbox', column.include, prefix + 'included', value => {
      column.include = value;
      if (!value) doc.mapping.keyColumns = doc.mapping.keyColumns.filter(index => index !== column.index);
      touch(); renderMapping(doc);
    }));
    row.append(element('td', (column.index + 1) + '. ' + column.sourceName));
    const name = append(mappingControl('text', column.name, prefix + 'output name', value => { column.name = value; touch(); }));
    name.id = 'column-name-' + column.index; name.maxLength = 128; name.disabled = !column.include;
    const type = append(mappingControl('select', column.type, prefix + 'type', value => { column.type = value; touch(); }));
    for (const value of TYPES) type.append(option(value, labels[value], value === column.type)); type.disabled = !column.include;
    const empty = append(mappingControl('select', column.empty, prefix + 'empty value', value => { column.empty = value; touch(); }));
    for (const value of EMPTY_POLICIES) empty.append(option(value, empties[value], value === column.empty)); empty.disabled = !column.include;
    const trim = append(mappingControl('checkbox', column.trim, prefix + 'trim whitespace', value => { column.trim = value; touch(); })); trim.disabled = !column.include;
    const unit = append(mappingControl('text', column.unit, prefix + 'unit', value => { column.unit = value; touch(); })); unit.maxLength = 256; unit.disabled = !column.include;
    const basis = append(mappingControl('text', column.timeBasis, prefix + 'time basis', value => { column.timeBasis = value; touch(); })); basis.maxLength = 256; basis.disabled = !column.include;
    const key = append(mappingControl('checkbox', doc.mapping.keyColumns.includes(column.index), prefix + 'record key', value => {
      doc.mapping.keyColumns = value ? [...doc.mapping.keyColumns, column.index] : doc.mapping.keyColumns.filter(index => index !== column.index); touch();
    })); key.disabled = !column.include;
    body.append(row);
  }
}
function renderComparison(doc) {
  const summary = $('comparison-summary'), preview = $('comparison-preview'); summary.replaceChildren(); preview.replaceChildren();
  const enabled = doc.baselineReviewId && doc.baselineReviewId !== doc.selectedReviewId;
  $('download-comparison-json').disabled = !enabled || busy;
  $('download-comparison-csv').disabled = !enabled || busy;
  if (!enabled) { summary.append(element('p', 'Select an earlier retained review to compare the source editions.', 'note')); return; }
  try {
    const comparison = compareReviews(doc, doc.baselineReviewId), counts = element('div', undefined, 'comparison-counts');
    for (const [key, value] of Object.entries(comparison.summary)) counts.append(element('span', value + ' ' + key));
    summary.append(counts);
    summary.append(element('p', comparison.mode === 'record-keys' ? 'Records match by ' + comparison.keyFields.join(', ') + '.' :
      'Whole-row comparison preserves duplicate counts. ' + (comparison.keysChanged ? 'The declared key fields differ between reviews; rows are compared as complete values.' : 'Choose stable record keys to identify changed records.'), 'note'));
    const changes = comparison.columns.added.length + comparison.columns.removed.length + comparison.columns.changed.length;
    summary.append(element('p', changes + ' field definition changes. Full column and row changes are included in the comparison downloads.', 'note'));
    if (comparison.changes.length) {
      const t = element('table', undefined, 'preview-table'), head = element('thead'), headings = element('tr'), body = element('tbody');
      for (const label of ['Change', 'Original record', 'Current record', 'Before', 'After']) headings.append(element('th', label));
      head.append(headings);
      for (const change of comparison.changes.slice(0, 25)) {
        const row = element('tr'); row.append(element('td', change.kind), element('td', String(change.beforeRecord?.record ?? '')), element('td', String(change.afterRecord?.record ?? '')));
        for (const value of [change.before, change.after]) { const cell = element('td'); cell.append(element('pre', value === null ? '—' : JSON.stringify(value, null, 2))); row.append(cell); }
        body.append(row);
      }
      t.append(head, body); preview.append(t);
      summary.append(element('p', 'Showing ' + Math.min(25, comparison.changes.length) + ' of ' + comparison.changes.length + ' complete row changes.', 'note'));
    }
  } catch (error) { summary.append(element('p', error.message, 'note')); }
}
function renderReviews(doc) {
  $('review-panel').hidden = !doc.reviews.length;
  $('review-state').textContent = reviewIsCurrent(doc) ? 'Current source and mapping are retained.' : 'The current source or mapping needs a retained review.';
  if (!doc.reviews.length) return;
  const selection = $('review-selection'), baseline = $('baseline-selection');
  selection.replaceChildren(); baseline.replaceChildren(option('', 'No comparison selected', !doc.baselineReviewId));
  for (const review of [...doc.reviews].reverse()) {
    const edition = doc.editions.find(e => e.id === review.editionId);
    const label = edition.filename + ' · ' + review.summary.rows + ' rows · ' + review.id.slice(0, 14);
    selection.append(option(review.id, label, review.id === doc.selectedReviewId));
    if (review.id !== doc.selectedReviewId) baseline.append(option(review.id, label, review.id === doc.baselineReviewId));
  }
  const review = selectedReview(doc), data = JSON.parse(review.dataText);
  $('output-summary').textContent = review.summary.rows + ' complete rows · ' + review.summary.columns + ' fields · ' + review.dataBytes + ' output bytes · SHA-256 ' + review.outputSha256;
  $('output-preview').replaceChildren(table(data.fields.map(f => f.name), data.rows.slice(0, 20).map(row => data.fields.map(f => Object.prototype.hasOwnProperty.call(row, f.name) ? row[f.name] : undefined)),
    review.sourceRecords.slice(0, 20).map(r => r.record)));
  renderComparison(doc);
}
function render() {
  for (const control of document.querySelectorAll('button,input,select')) control.disabled = busy;
  const shared = { 'project-name': project.name, 'merchant-folder': project.starter.folder, 'merchant-network': project.starter.network,
    'merchant-asset': project.starter.asset, 'merchant-recipient': project.starter.payTo, 'merchant-amount': project.starter.amount, 'merchant-timeout': project.starter.maxTimeoutSeconds };
  for (const [field, value] of Object.entries(shared)) $(field).value = value ?? '';
  renderSources();
  const doc = currentDocument(); $('empty-state').hidden = Boolean(doc); $('document-workspace').hidden = !doc;
  $('export-workspace').disabled = busy || !project.documents.length || project.documents.some(d => !reviewIsCurrent(d));
  if (!doc) return;
  const resource = resourceFor(doc);
  $('document-title').textContent = doc.label;
  for (const [field, value] of Object.entries({ 'document-label': doc.label, 'resource-id': doc.resourceId, 'resource-path': resource.path, 'resource-name': resource.serviceName, 'resource-description': resource.description })) $(field).value = value;
  $('source-edition').replaceChildren(...[...doc.editions].reverse().map(e => option(e.id, e.filename + ' · ' + e.sha256.slice(0, 12), e.id === doc.selectedEditionId)));
  $('delimiter').value = doc.mapping.delimiter;
  $('has-header').checked = doc.mapping.header; $('skip-empty').checked = doc.mapping.skipEmptyRecords;
  const count = resource.paymentOptions?.length || (resource.paymentMode === 'route' ? 1 : 0);
  $('resource-terms').textContent = count ? count + ' retained ordered route payment choice' + (count === 1 ? '.' : 's.') : 'This resource uses the shared native merchant terms.';
  renderSourcePreview(doc); renderMapping(doc); renderReviews(doc);
}
async function openDatabase() {
  if (database) return database;
  database = new Promise((resolve, reject) => {
    const request = indexedDB.open('stellar-forge-source-tables-v1', 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('projects', { keyPath: 'id' }); request.result.createObjectStore('catalog', { keyPath: 'id' }); };
    let failed = false;
    request.onsuccess = () => {
      if (failed) { request.result.close(); return; }
      request.result.onversionchange = () => { request.result.close(); database = null; };
      resolve(request.result);
    };
    request.onerror = () => { failed = true; reject(request.error); };
    request.onblocked = () => { failed = true; reject(new Error('Close the older source-table browser tab, then try opening the project store again.')); };
  }).catch(error => { database = null; throw error; });
  return database;
}
async function saveLocal(asCopy) {
  const db = await openDatabase(), next = clone(project);
  if (asCopy) next.id = 'project-' + crypto.randomUUID();
  const expected = !asCopy && savedRef?.id === next.id ? savedRef.revision : 0;
  const revision = await new Promise((resolve, reject) => {
    const tx = db.transaction(['projects', 'catalog'], 'readwrite'), store = tx.objectStore('projects');
    let conflict, written;
    const request = store.get(next.id);
    request.onsuccess = () => {
      const actual = request.result?.revision || 0;
      if (actual !== expected) { conflict = new Error('A newer browser revision exists. Open that saved project or use Save as copy to keep these edits.'); tx.abort(); return; }
      written = actual + 1;
      store.put({ id: next.id, revision: written, project: next });
      tx.objectStore('catalog').put({ id: next.id, revision: written, name: next.name, updatedAt: new Date().toISOString(), tables: next.documents.length });
    };
    tx.oncomplete = () => resolve(written);
    tx.onabort = () => reject(conflict || tx.error || new Error('The project save was interrupted.'));
    tx.onerror = () => reject(tx.error);
  });
  project = next; savedRef = { id: next.id, revision }; dirty = false;
  message('Saved ' + next.name + ' in this browser at revision ' + revision + '.');
}
async function savedCatalog() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('catalog').objectStore('catalog').getAll();
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
async function openSaved(id) {
  const db = await openDatabase();
  const row = await new Promise((resolve, reject) => {
    const request = db.transaction('projects').objectStore('projects').get(id);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  if (!row) throw new Error('That saved project is absent.');
  const verified = await importProject(row.project);
  replaceProject(verified); savedRef = { id: row.id, revision: row.revision }; dirty = false;
  message('Opened ' + verified.name + ' at browser revision ' + row.revision + '.');
}
async function showSaved() {
  const rows = await savedCatalog(), list = $('saved-rows'); list.replaceChildren();
  rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (!rows.length) list.append(element('p', 'No source-table projects have been saved in this browser.'));
  for (const row of rows) {
    const item = element('div', undefined, 'saved-row'), text = element('span', row.name), button = element('button', 'Open');
    text.append(element('small', row.tables + ' tables · revision ' + row.revision + ' · ' + row.updatedAt));
    button.type = 'button'; button.addEventListener('click', () => {
      if (dirty && !confirm('Open the saved project and discard the current unsaved changes?')) return;
      perform(() => openSaved(row.id));
    }); item.append(text, button); list.append(item);
  }
  $('saved-list').hidden = false; $('saved-projects').setAttribute('aria-expanded', 'true');
}
const sharedFields = { 'project-name': 'name', 'merchant-folder': 'folder', 'merchant-network': 'network', 'merchant-asset': 'asset', 'merchant-recipient': 'payTo', 'merchant-amount': 'amount', 'merchant-timeout': 'maxTimeoutSeconds' };
for (const [field, key] of Object.entries(sharedFields)) $(field).addEventListener('input', () => { if (field === 'project-name') project.name = $(field).value; else project.starter[key] = $(field).value; touch(); });
for (const [field, key] of Object.entries({ 'resource-path': 'path', 'resource-name': 'serviceName', 'resource-description': 'description' })) $(field).addEventListener('input', () => { resourceFor(currentDocument())[key] = $(field).value; touch(); });
$('document-label').addEventListener('input', () => { currentDocument().label = $('document-label').value; $('document-title').textContent = currentDocument().label; touch(); });
$('resource-id').addEventListener('change', () => {
  const doc = currentDocument(), resource = resourceFor(doc), value = $('resource-id').value;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(value) || project.starter.resources.some(other => other !== resource && String(other.id).toLowerCase() === value.toLowerCase())) {
    $('resource-id').value = resource.id;
    showError(new SourceTableError('RESOURCE_ID', 'Choose a unique resource ID with 1–64 letters, digits, underscores or hyphens.'));
    return;
  }
  resource.id = value; doc.resourceId = value; touch(); renderSources();
});
for (const field of ['delimiter', 'has-header', 'skip-empty']) $(field).addEventListener('change', () => {
  const doc = currentDocument(); doc.mapping.delimiter = $('delimiter').value; doc.mapping.header = $('has-header').checked; doc.mapping.skipEmptyRecords = $('skip-empty').checked;
  touch(); renderSourcePreview(doc);
});
$('source-edition').addEventListener('change', () => { currentDocument().selectedEditionId = $('source-edition').value; touch(); render(); });
$('baseline-selection').addEventListener('change', () => { currentDocument().baselineReviewId = $('baseline-selection').value || null; touch(); renderComparison(currentDocument()); });
$('new-project').addEventListener('click', () => {
  if (dirty && !confirm('Create a new project and discard the current unsaved changes?')) return;
  project = createProject(); documentId = null; dirty = false; savedRef = null; clearError(); message('New source-table project.'); render();
});
$('open-project').addEventListener('click', () => chooseFile('project-file'));
$('import-merchant').addEventListener('click', () => chooseFile('merchant-file'));
$('add-source').addEventListener('click', () => chooseFile('source-files'));
$('new-edition').addEventListener('click', () => chooseFile('edition-file'));
$('source-files').addEventListener('change', () => {
  const files = [...$('source-files').files], binding = $('bind-resource').value;
  if (!files.length) return;
  perform(async () => {
    if (binding && files.length !== 1) throw new Error('Select one source file when binding an existing merchant resource.');
    let next = project, selected;
    const suggestions = [];
    for (const file of files) {
      const value = await fileText(file, LIMITS.sourceBytes), inspection = inspectSource(value);
      const result = await addDocument(next, { filename: file.name, sourceText: value, resourceId: binding || undefined, delimiter: inspection.delimiter });
      next = result.project; selected = result.documentId;
      if (inspection.ambiguous) suggestions.push(file.name);
    }
    replaceProject(next, selected);
    message('Added ' + files.length + ' original source file' + (files.length === 1 ? '.' : 's.') + (suggestions.length ? ' Review the delimiter for: ' + suggestions.join(', ') + '.' : ' Review the source dialect and field mapping.'));
  });
});
$('edition-file').addEventListener('change', () => {
  const file = $('edition-file').files[0], target = documentId; if (!file) return;
  perform(async () => {
    const result = await addEdition(project, target, { filename: file.name, sourceText: await fileText(file, LIMITS.sourceBytes) });
    replaceProject(result.project, target); message(result.reused ? 'Selected the existing identical source edition.' : 'Added the source edition. Review its current header, mapping and complete output.');
  });
});
$('project-file').addEventListener('change', () => {
  const file = $('project-file').files[0]; if (!file) return;
  if (dirty && !confirm('Open this project and discard the current unsaved changes?')) return;
  perform(async () => {
    if (file.size > LIMITS.projectBytes) throw new Error('The project exceeds 128 MiB.');
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer()); } catch { throw new Error('Choose a valid UTF-8 project JSON.'); }
    const verified = await importProject(text);
    replaceProject(verified); savedRef = null; dirty = false; message('Opened the complete project and reproduced every retained review from its original source.');
  });
});
$('merchant-file').addEventListener('change', () => {
  const file = $('merchant-file').files[0]; if (!file) return;
  perform(async () => {
    const starter = importWorkspaceDraft(await fileText(file, LIMITS.sourceBytes));
    if (!Array.isArray(starter.resources)) throw new Error('The merchant draft needs its original resources.');
    for (const doc of project.documents) if (!starter.resources.some(r => r.id === doc.resourceId)) throw new Error('The merchant draft omits the bound resource ' + doc.resourceId + '. Keep that resource or begin a new source project.');
    project.starter = clone(starter); dirty = true;
    message('Imported the original merchant draft, route metadata and payment choices. Bind a source to an existing resource or add another resource.');
  });
});
$('reset-mapping').addEventListener('click', () => {
  if (!confirm('Reset the current column mapping to text fields from this source? Earlier retained reviews stay available.')) return;
  perform(async () => { const doc = currentDocument(); doc.mapping = initialMapping(selectedEdition(doc).sourceText, doc.mapping); dirty = true; message('Reset the editable mapping from the current source.'); });
});
$('review-source').addEventListener('click', () => perform(async () => {
  const target = documentId, result = await freezeReview(project, target);
  replaceProject(result.project, target);
  message(result.reused ? 'Reopened the existing identical review.' : 'Retained the complete ' + result.review.summary.rows + '-row output with its original source and mapping.');
}));
$('open-review').addEventListener('click', () => perform(async () => {
  const doc = currentDocument(), review = doc.reviews.find(r => r.id === $('review-selection').value);
  if (!review) throw new Error('Select a retained review.');
  doc.selectedReviewId = review.id; doc.selectedEditionId = review.editionId; doc.mapping = clone(review.mapping);
  if (doc.baselineReviewId === review.id) doc.baselineReviewId = null;
  resourceFor(doc).dataText = review.dataText; dirty = true;
  message('Reopened the selected source edition and its exact saved mapping.');
}));
$('download-project').addEventListener('click', () => {
  download((project.starter.folder || 'source-tables') + '-project.json', json(project)); message('Downloaded the editable project with all original sources and retained reviews.');
});
$('download-source').addEventListener('click', () => { const source = selectedEdition(currentDocument()); download(source.filename, source.sourceText, 'text/plain;charset=utf-8'); });
$('download-output').addEventListener('click', () => { const doc = currentDocument(); download(doc.resourceId + '.json', selectedReview(doc).dataText); });
for (const [field, format] of [['download-comparison-json', 'json'], ['download-comparison-csv', 'csv']]) $(field).addEventListener('click', () => {
  try {
    const doc = currentDocument(), comparison = compareReviews(doc, doc.baselineReviewId);
    download(doc.resourceId + '-comparison.' + format, format === 'csv' ? comparisonCsv(comparison) : json(comparison), format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json');
  } catch (error) { showError(error); }
});
$('export-workspace').addEventListener('click', () => perform(async () => {
  const archive = await createTableArchive(project);
  download(archive.workspace.summary.folder + '-source-tables.zip', archive.bytes, 'application/zip');
  message('Exported the complete native workspace, all original sources, retained reviews and receiving instructions.');
}));
$('save-browser').addEventListener('click', () => perform(() => saveLocal(false)));
$('save-copy').addEventListener('click', () => perform(() => saveLocal(true)));
$('saved-projects').addEventListener('click', () => {
  if (!$('saved-list').hidden) { $('saved-list').hidden = true; $('saved-projects').setAttribute('aria-expanded', 'false'); return; }
  perform(showSaved);
});
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
render();
message('Add the original source files or reopen a complete project.');
