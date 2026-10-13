// MIT. Browser authoring over the same original-source model and native generator as the CLI.
import {
  TYPES, EMPTY_POLICIES, LIMITS, createProject, addDocument, addEdition, addDocumentTable, initialMapping,
  freezeReview, importProject, inspectSource, parseTable, decodeSource, selectedEdition, selectedReview,
  reviewIsCurrent, selectedCorrections, recordCorrection, sourceRecords, correctionsCsv, compareReviews, comparisonCsv, createTableArchive, SourceTableError,
} from './source-table-workspace.mjs';
import { createDocumentTableSource, validateDocumentTableSource, inspectDocumentTables, projectDocumentTable, validateDocumentTableProjection } from './source-document-tables.mjs';
import { importWorkspaceDraft } from './onboarding.mjs';
import { DOCUMENT_INTAKE_PACKET_SCHEMA, createDocumentIntake, captureDocumentPreparation, documentPreparation, restoreDocumentPreparation, createDocumentIntakePacket, receiveDocumentIntakePacket } from './source-table-intake.mjs';

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
  for (const control of document.querySelectorAll('button,input,select,textarea')) control.disabled = true;
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
  const data=await file.arrayBuffer();
  if(limit<=LIMITS.sourceBytes)return decodeSource(data);
  try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(data);}catch{throw new Error('Choose complete valid UTF-8 document intake JSON or extracted text.');}
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
  for (const control of document.querySelectorAll('button,input,select,textarea')) control.disabled = busy;
  const shared = { 'project-name': project.name, 'merchant-folder': project.starter.folder, 'merchant-network': project.starter.network,
    'merchant-asset': project.starter.asset, 'merchant-recipient': project.starter.payTo, 'merchant-amount': project.starter.amount, 'merchant-timeout': project.starter.maxTimeoutSeconds };
  for (const [field, value] of Object.entries(shared)) $(field).value = value ?? '';
  renderSources(); renderDocumentIntake();
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
  renderSourcePreview(doc); renderCorrections(doc); renderMapping(doc); renderReviews(doc);
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
  replaceProject(verified); await restoreProjectIntake(); savedRef = { id: row.id, revision: row.revision }; dirty = false;
  message('Opened ' + verified.name + ' at browser revision ' + row.revision + '.');
}
async function showSaved() {
  const rows = await savedCatalog(), list = $('saved-rows'); list.replaceChildren();
  rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (!rows.length) list.append(element('p', 'No source-table projects have been saved in this browser.'));
  for (const row of rows) {
    const item = element('div', undefined, 'saved-row'), text = element('span', row.name), button = element('button', 'Open');
    text.append(element('small', row.tables + ' tables · revision ' + row.revision + ' · ' + new Date(row.updatedAt).toLocaleString()));
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
  touch(); renderSourcePreview(doc); renderCorrections(doc);
});
$('source-edition').addEventListener('change', () => { currentDocument().selectedEditionId = $('source-edition').value; touch(); render(); });
$('baseline-selection').addEventListener('change', () => { currentDocument().baselineReviewId = $('baseline-selection').value || null; touch(); renderComparison(currentDocument()); });
$('new-project').addEventListener('click', () => {
  if (dirty && !confirm('Create a new project and discard the current unsaved changes?')) return;
  project = createProject(); documentId = null; clearProjectIntake(); dirty = false; savedRef = null; clearError(); message('New source-table project.'); render();
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
    replaceProject(verified); await restoreProjectIntake(); savedRef = null; dirty = false; message('Opened the complete project, unfinished document preparations and original retained reviews.');
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

// Document extraction stays data throughout: all source content enters textContent.
let documentIntake = {source:null,inspection:null,tableIndex:1,rowPage:0,columnPage:0,projection:null};
const documentPageRows = 20, documentPageColumns = 12;
const intakeFields = {'document-header-rows':'headerRows','document-data-rows':'dataRows','document-columns':'columns','document-exclusions':'exclusions','document-merge':'mergedCells','document-whitespace':'whitespace','document-csv-name':'filename','document-target':'target'};
const intakeState = () => project.documentIntake || createDocumentIntake();
function retainDocumentPreparation({replace=false,changed=true}={}) {
  if(!documentIntake.source || !intakeTable())return;
  project.documentTableSources ||= [];
  if(!project.documentTableSources.some(row=>row.id===documentIntake.source.id))
    project.documentTableSources.push(clone(documentIntake.source));
  const fields=Object.fromEntries(Object.entries(intakeFields).map(([id,key])=>[key,$(id).value]));
  project.documentIntake=captureDocumentPreparation(intakeState(),documentIntake.source.id,documentIntake.tableIndex,
    {fields,rowPage:documentIntake.rowPage,columnPage:documentIntake.columnPage},{replace});
  if(changed)touch();
}
function applyDocumentPreparation(saved) {
  for(const [id,key] of Object.entries(intakeFields)) {
    if(id==='document-target' && ![...$(id).options].some(row=>row.value===saved.fields[key]))
      $(id).append(option(saved.fields[key],'Original destination · choose a current target',true));
    $(id).value=saved.fields[key];
  }
  documentIntake.rowPage=saved.rowPage;documentIntake.columnPage=saved.columnPage;
}
function clearProjectIntake() {
  documentIntake={source:null,inspection:null,tableIndex:1,rowPage:0,columnPage:0,projection:null};
  const details=intakeState().sourceDetails;
  $('document-source-url').value=details.url;$('document-original-name').value=details.filename;$('document-provider').value=details.provider;
  $('document-intake-status').textContent='Open an extraction to inspect its tables.';
}
async function restoreProjectIntake() {
  clearProjectIntake();
  const state=intakeState(),selected=project.documentTableSources?.find(row=>row.id===state.selectedSourceId);
  if(selected)await loadDocumentSource(selected,null,{restoring:true});
  $('document-source-url').value=state.sourceDetails.url;$('document-original-name').value=state.sourceDetails.filename;$('document-provider').value=state.sourceDetails.provider;
}
async function prepareRetainedPreview() {
  try {documentIntake.projection=await projectDocumentTable(documentIntake.source,readDocumentSelection());}
  catch {documentIntake.projection=null;}
}

const intakeTable = () => documentIntake.inspection?.tables.find(t => t.tableIndex === documentIntake.tableIndex);
function selectedDocumentSource(edition) {
  const sources = project.documentTableSources || [];
  return Array.isArray(sources) ? sources.find(s => s.id === edition?.documentTable?.sourceId) : sources[edition?.documentTable?.sourceId];
}
function integerRanges(value, maximum, label, empty = false) {
  if (!value.trim()) { if (empty) return []; throw new Error('Choose ' + label + '.'); }
  const result = [], seen = new Set();
  for (const part of value.split(',')) {
    const match = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(part);
    if (!match) throw new Error('Use comma-separated whole numbers or ranges for ' + label + '.');
    const first = Number(match[1]), last = Number(match[2] || match[1]);
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || last < first || last > maximum)
      throw new Error(label + ' must stay within 1–' + maximum + '.');
    for (let n = first; n <= last; n++) { if (seen.has(n)) throw new Error(label + ' repeats ' + n + '.'); seen.add(n); result.push(n); }
  }
  return result;
}
function rangeText(values) {
  const chunks = [];
  for (let i = 0; i < values.length; i++) { let last = values[i], end = i; while (end + 1 < values.length && values[end + 1] === last + 1) last = values[++end]; chunks.push(end === i ? String(values[i]) : values[i] + '-' + last); i = end; }
  return chunks.join(', ');
}
function readDocumentSelection() {
  const t = intakeTable(); if (!t) throw new Error('Open a source table first.');
  const excludedRows = [];
  for (const line of $('document-exclusions').value.split(/\r?\n/).filter(s => s.trim())) {
    const match = /^\s*(\d+)\s*:\s*(.+)$/.exec(line);
    if (!match) throw new Error('Each optional exclusion note needs an original row number followed by a colon and note.');
    excludedRows.push({row:Number(match[1]),reason:match[2].trim()});
  }
  return {tableIndex:t.tableIndex,headerRows:integerRanges($('document-header-rows').value,t.rowCount,'header rows',true),
    dataRows:integerRanges($('document-data-rows').value,t.rowCount,'data rows'),columns:integerRanges($('document-columns').value,t.columnCount,'columns'),
    mergedCells:$('document-merge').value,whitespace:$('document-whitespace').value,excludedRows};
}
function writeDocumentSelection(selection) {
  $('document-header-rows').value = rangeText(selection.headerRows);
  $('document-data-rows').value = rangeText(selection.dataRows);
  $('document-columns').value = rangeText(selection.columns);
  $('document-merge').value = selection.mergedCells;
  $('document-whitespace').value = selection.whitespace;
  $('document-exclusions').value = (selection.excludedRows || []).map(x => x.row + ': ' + x.reason).join('\n');
}
function resetDocumentSelection() {
  const t = intakeTable(); if (!t) return;
  writeDocumentSelection({headerRows:t.rowCount > 1 ? [1] : [],dataRows:Array.from({length:t.rowCount > 1 ? t.rowCount-1 : t.rowCount},(_,i)=>i+(t.rowCount > 1 ? 2 : 1)),
    columns:Array.from({length:t.columnCount},(_,i)=>i+1),mergedCells:'anchor',whitespace:'preserve',excludedRows:[]});
  documentIntake.rowPage = 0; documentIntake.columnPage = 0; invalidateDocumentProjection();
  $('document-csv-name').value = (documentIntake.source.filename.replace(/\.[^.]*$/, '') || 'document') + '-table-' + t.tableIndex + '.csv';
  $('document-cell-origin').textContent = ''; $('document-cell-detail').open = false;
  $('document-original-markup').hidden = true; $('document-original-markup').textContent = '';
}
function invalidateDocumentProjection() {
  documentIntake.projection = null;
  $('document-projection-panel').hidden = true;
  $('document-intake-status').textContent = 'Selection is editable. Prepare the CSV preview to review its exact output.';
}
async function loadDocumentSource(source, projection = null, {restoring=false}={}) {
  const incoming = await validateDocumentTableSource(source);
  const verified = project.documentTableSources?.find(row=>row.id===incoming.id) || incoming;
  const inspection = await inspectDocumentTables(verified);
  if (!inspection.tables.length) throw new Error('This extraction contains no HTML tables. Choose extracted HTML or Markdown with table elements.');
  if (projection) await validateDocumentTableProjection({source:verified,projection});
  if(!restoring)retainDocumentPreparation();
  const state=intakeState(), prior=state.sources.find(row=>row.sourceId===verified.id);
  const tableIndex=projection?.selection.tableIndex || prior?.selectedTable || inspection.tables[0].tableIndex;
  const saved=documentPreparation(state,verified.id,tableIndex);
  documentIntake = {source:verified,inspection,tableIndex,rowPage:0,columnPage:0,projection:null};
  // These inputs describe the next text file; source navigation preserves their unfinished values.
  resetDocumentSelection();
  if(saved)applyDocumentPreparation(saved);
  if(projection) { writeDocumentSelection(projection.selection);documentIntake.projection=projection; }
  retainDocumentPreparation({replace:Boolean(projection),changed:!restoring});
  if(!projection && saved)await prepareRetainedPreview();
  $('document-intake-status').textContent = verified.filename + ' · ' + inspection.tables.length + ' tables · complete extraction and preparation retained in this project. Save or download the project to reopen it.';
}
function showDocumentCell(t, row, column) {
  const index = t.grid[row-1]?.[column-1], cell = index == null ? null : t.cells[index];
  const lines = [
    'Extraction: ' + documentIntake.source.filename,
    'Original document: ' + (documentIntake.source.document?.filename || '(not supplied)'),
    'Source URL: ' + (documentIntake.source.sourceUrl || documentIntake.source.document?.url || '(not supplied)'),
    'Table ' + t.tableIndex + (t.location?.page ? ' · original page ' + t.location.page : '') + (t.location?.label ? ' · ' + t.location.label : ''),
    'Selected grid coordinate: row ' + row + ', column ' + column
  ];
  if (cell) lines.push('Anchor: row ' + cell.row + ', column ' + cell.column + ' · spans ' + cell.rowspan + ' row(s) × ' + cell.colspan + ' column(s)',
    'Original extraction offsets: ' + cell.htmlStart + '–' + cell.htmlEnd + ' (UTF-16 characters)',
    '', 'Complete original text:', cell.text, '', 'Complete original cell markup:', cell.html);
  else lines.push('This grid coordinate has no source cell.');
  $('document-cell-origin').textContent = lines.join('\n'); $('document-cell-detail').open = true;
}
function renderDocumentGrid() {
  const t = intakeTable(), area = $('document-cell-grid'); area.replaceChildren(); if (!t) return;
  const rowStart = documentIntake.rowPage * documentPageRows, colStart = documentIntake.columnPage * documentPageColumns;
  const rowEnd = Math.min(t.rowCount,rowStart+documentPageRows), colEnd = Math.min(t.columnCount,colStart+documentPageColumns);
  const grid = element('table',undefined,'preview-table document-grid'), head = element('thead'), hr = element('tr'), body = element('tbody');
  hr.append(element('th','Original row'));
  for(let c=colStart+1;c<=colEnd;c++) {const th=element('th','Column '+c);th.scope='col';hr.append(th);}head.append(hr);
  for(let r=rowStart+1;r<=rowEnd;r++) {
    const tr=element('tr'), th=element('th',String(r));th.scope='row';tr.append(th);
    for(let c=colStart+1;c<=colEnd;c++) {
      const index=t.grid[r-1]?.[c-1],cell=index==null?null:t.cells[index],td=element('td'),button=element('button');
      button.type='button';button.disabled=busy;button.className='document-cell';
      const covered=cell&&(cell.row!==r||cell.column!==c);
      button.textContent=cell?previewValue(cell.text):'(no source cell)';
      button.setAttribute('aria-label','Inspect original row '+r+', column '+c+(covered?', covered by row '+cell.row+', column '+cell.column:''));
      if(covered)button.append(element('small','Covered → '+cell.row+':'+cell.column));
      button.addEventListener('click',()=>showDocumentCell(t,r,c));td.append(button);tr.append(td);
    }body.append(tr);
  }grid.append(head,body);area.append(grid);
  $('document-preview-range').textContent='Rows '+(rowStart+1)+'–'+rowEnd+' of '+t.rowCount+' · columns '+(colStart+1)+'–'+colEnd+' of '+t.columnCount;
  $('document-rows-prev').disabled=busy||rowStart===0;$('document-rows-next').disabled=busy||rowEnd===t.rowCount;
  $('document-cols-prev').disabled=busy||colStart===0;$('document-cols-next').disabled=busy||colEnd===t.columnCount;
}
function renderDocumentIntake() {
  const source=documentIntake.source, t=intakeTable(), projection=documentIntake.projection;
  const state=intakeState(), list=$('document-source-choice');
  list.replaceChildren(option('','Choose a retained extraction',!source));
  for(const row of state.sources){const original=project.documentTableSources?.find(item=>item.id===row.sourceId);if(original)list.append(option(row.sourceId,original.filename+' · '+row.tables.length+' prepared tables',row.sourceId===source?.id));}
  list.disabled=busy||!state.sources.length;
  $('document-download-intake').disabled=busy||!state.sources.length;
  $('document-intake-editor').hidden=!source;
  const activeDoc=currentDocument();
  $('reopen-document-selection').hidden=!activeDoc||!selectedEdition(activeDoc).documentTable;
  if(!source||!t)return;
  $('document-table-choice').replaceChildren(...documentIntake.inspection.tables.map(x=>option(String(x.tableIndex),
    'Table '+x.tableIndex+' · '+x.rowCount+' rows × '+x.columnCount+' columns'+(x.location?.page?' · page '+x.location.page:'')+(x.location?.label?' · '+x.location.label:''),x.tableIndex===t.tableIndex)));
  const target=$('document-target'), chosen=target.value;target.replaceChildren(option('','New merchant resource',chosen===''));
  for(const resource of project.starter.resources)if(!project.documents.some(d=>d.resourceId===resource.id))target.append(option('resource:'+resource.id,'Existing unbound resource · '+resource.id,chosen==='resource:'+resource.id));
  for(const doc of project.documents)target.append(option('document:'+doc.id,'Next edition · '+doc.label,chosen==='document:'+doc.id));
  if(![...target.options].some(x=>x.value===chosen))target.append(option(chosen,'Original destination unavailable · choose a current target',true));
  const saved=documentPreparation(state,source.id,t.tableIndex), history=$('document-preparation-history');
  history.replaceChildren(option('','Current preparation',true));
  for(const [index,prior] of (saved?.history||[]).entries())history.append(option(String(index),new Date(prior.retainedAt).toLocaleString()+' · '+prior.fields.filename,false));
  history.disabled=busy||!saved?.history.length;
  renderDocumentGrid();
  $('document-projection-panel').hidden=!projection;
  if(projection) {
    const s=projection.summary;
    $('document-projection-summary').textContent=s.dataRows+' data rows · '+s.columns+' columns · '+s.omittedRows+' original rows omitted · '+projection.bytes+' CSV bytes. Preview below shows the first 20 projected rows; downloads retain every row.';
    $('document-projection-preview').replaceChildren(table(projection.headings,projection.rows.slice(0,20).map(r=>r.cells.map(c=>c.value)),projection.rows.slice(0,20).map(r=>r.row)));
    $('document-omitted-rows').textContent=projection.omittedRows.length?projection.omittedRows.map(r=>'Original row '+r.row+' · '+r.kind+(r.reason?' · '+r.reason:'')).join('\n'):'Every original row is selected as a header or data row.';
  }
}
$('open-document-text').addEventListener('click',()=>chooseFile('document-extraction-file'));
$('document-extraction-file').addEventListener('change',()=>{
  const file=$('document-extraction-file').files[0];if(!file)return;
  perform(async()=>{
    const text=await fileText(file,LIMITS.projectBytes);
    let source, projection=null;
    if(/\.json$/i.test(file.name)||/^\s*\{/.test(text)) {
      const value=JSON.parse(text);
      if(value.schema===DOCUMENT_INTAKE_PACKET_SCHEMA){
        retainDocumentPreparation();
        const received=await receiveDocumentIntakePacket(intakeState(),project.documentTableSources||[],value);
        project.documentIntake=received.intake;project.documentTableSources=received.sources;
        await restoreProjectIntake();touch();message('Opened the complete document preparations. Earlier current choices remain in preparation history; choose a current destination before receiving.');return;
      }
      source=value.schema==='stellar-forge.document-table-source.v1'?value:value.source;
      projection=value.projection||null;
      if(!source)throw new Error('Choose retained document-table source JSON or a saved source and selection. Complete projects open through Open project JSON.');
    } else {
      const document={},extraction={};
      if($('document-source-url').value.trim())document.url=$('document-source-url').value.trim();
      if($('document-original-name').value.trim())document.filename=$('document-original-name').value.trim();
      if($('document-provider').value.trim())extraction.provider=$('document-provider').value.trim();
      source=await createDocumentTableSource({filename:file.name,sourceText:text,sourceUrl:document.url||'',document,extraction});
    }
    await loadDocumentSource(source,projection);
    message('Opened the complete extracted source. Review original cells and choose the rows and columns to receive.');
  });
});
$('document-table-choice').addEventListener('change',()=>{const target=Number($('document-table-choice').value);perform(async()=>{
  retainDocumentPreparation();documentIntake.tableIndex=target;resetDocumentSelection();
  const saved=documentPreparation(intakeState(),documentIntake.source.id,target);if(saved)applyDocumentPreparation(saved);
  retainDocumentPreparation();if(saved)await prepareRetainedPreview();
});});
for(const id of ['document-header-rows','document-data-rows','document-columns','document-exclusions','document-merge','document-whitespace'])
  $(id).addEventListener(id==='document-merge'||id==='document-whitespace'?'change':'input',()=>{invalidateDocumentProjection();retainDocumentPreparation();});
for(const [id,field,delta] of [['document-rows-prev','rowPage',-1],['document-rows-next','rowPage',1],['document-cols-prev','columnPage',-1],['document-cols-next','columnPage',1]])
  $(id).addEventListener('click',()=>{documentIntake[field]+=delta;retainDocumentPreparation();renderDocumentGrid();});
$('document-show-markup').addEventListener('click',()=>{
  const pre=$('document-original-markup');pre.hidden=!pre.hidden;
  pre.textContent=pre.hidden?'':intakeTable().html;
  $('document-show-markup').textContent=pre.hidden?'Show original table markup':'Hide original table markup';
});
$('document-download-source').addEventListener('click',()=>download('Document_Table_Source.json',json(documentIntake.source)));
$('document-preview').addEventListener('click',()=>perform(async()=>{
  retainDocumentPreparation();
  documentIntake.projection=await projectDocumentTable(documentIntake.source,readDocumentSelection());
  message('Prepared the complete selected CSV. Review it, then use it in field mapping.');
}));
$('document-download-csv').addEventListener('click',()=>download($('document-csv-name').value||'document-table.csv',documentIntake.projection.csv,'text/csv;charset=utf-8'));
$('document-download-selection').addEventListener('click',()=>download('Document_Table_Selection.json',json({source:documentIntake.source,projection:documentIntake.projection})));
$('document-receive').addEventListener('click',()=>perform(async()=>{
  if(!documentIntake.projection)throw new Error('Prepare the current selection first.');
  const target=$('document-target').value;
  if(target && !(target.startsWith('document:')&&project.documents.some(row=>row.id===target.slice(9))) && !(target.startsWith('resource:')&&project.starter.resources.some(row=>row.id===target.slice(9))&&!project.documents.some(row=>row.resourceId===target.slice(9))))throw new Error('Choose a current destination for this retained preparation.');
  retainDocumentPreparation();
  const result=await addDocumentTable(project,{source:documentIntake.source,projection:documentIntake.projection,
    filename:$('document-csv-name').value.trim()||undefined,
    ...(target.startsWith('document:')?{documentId:target.slice(9)}:target.startsWith('resource:')?{resourceId:target.slice(9)}:{})});
  replaceProject(result.project,result.documentId);
  renderDocumentIntake(); $('document-target').value='document:'+result.documentId;retainDocumentPreparation();
  message(result.reused?'Reopened the retained identical document projection. Continue with its field mapping.':'Received the projected CSV, complete original extraction and cell origins. Review the field mapping below.');
  $('document-workspace').scrollIntoView({block:'start',behavior:'smooth'});
}));
$('reopen-document-selection').addEventListener('click',()=>perform(async()=>{
  const edition=selectedEdition(currentDocument()),source=selectedDocumentSource(edition);
  if(!source||!edition.documentTable?.projection)throw new Error('This edition has no retained document-table source.');
  await loadDocumentSource(source,edition.documentTable.projection);
  $('document-target').value='document:'+documentId;$('document-csv-name').value=edition.filename;retainDocumentPreparation();
  message('Reopened the exact original extraction and selection. Change the selection to prepare another edition.');
  $('document-intake').scrollIntoView({block:'start',behavior:'smooth'});
}));


$('document-source-choice').addEventListener('change',()=>{const sourceId=$('document-source-choice').value;if(!sourceId)return;perform(async()=>{const source=project.documentTableSources?.find(row=>row.id===sourceId);if(!source)throw new Error('The original extraction is absent.');await loadDocumentSource(source);});});
$('document-preparation-history').addEventListener('change',()=>{const value=$('document-preparation-history').value;if(value==='')return;perform(async()=>{
  retainDocumentPreparation();project.documentIntake=restoreDocumentPreparation(intakeState(),documentIntake.source.id,documentIntake.tableIndex,Number(value));
  applyDocumentPreparation(documentPreparation(intakeState(),documentIntake.source.id,documentIntake.tableIndex));await prepareRetainedPreview();touch();
  message('Reopened the selected preparation. The preceding complete choices remain in history.');
});});
for(const id of ['document-csv-name','document-target'])$(id).addEventListener(id==='document-target'?'change':'input',()=>retainDocumentPreparation());
for(const [id,key] of [['document-source-url','url'],['document-original-name','filename'],['document-provider','provider']])$(id).addEventListener('input',()=>{
  project.documentIntake ||= createDocumentIntake();project.documentIntake.sourceDetails[key]=$(id).value;touch();
});
$('document-download-intake').addEventListener('click',()=>perform(async()=>{
  retainDocumentPreparation();const packet=await createDocumentIntakePacket(intakeState(),project.documentTableSources||[]);
  download('Document_Table_Preparations.json',json(packet));message('Downloaded every retained extraction, unfinished table choice and earlier preparation.');
}));


let correctionOffset=0, correctionColumnOffset=0, correctionSelection=null, correctionDocument=null;
function correctionContextKey(doc) {
  return doc.id+':'+doc.selectedEditionId+':'+JSON.stringify([doc.mapping.delimiter,doc.mapping.header,doc.mapping.skipEmptyRecords]);
}
function renderCorrections(doc) {
  const context=correctionContextKey(doc);
  if(correctionDocument!==context){correctionDocument=context;correctionOffset=0;correctionColumnOffset=0;correctionSelection=null;}
  try {
    const data=sourceRecords(doc,{offset:correctionOffset,limit:20});
    if(correctionOffset>=data.total&&correctionOffset){correctionOffset=Math.max(0,Math.floor((data.total-1)/20)*20);return renderCorrections(doc);}
    const start=correctionColumnOffset,end=Math.min(data.headings.length,start+6);
    $('correction-summary').textContent=data.total+' original data records · '+data.correctedCells+' selected cell replacements · '+data.excludedRecords+' excluded rows · history revision '+data.revision;
    $('correction-page').textContent='Records '+(data.total?correctionOffset+1:0)+'–'+Math.min(data.total,correctionOffset+20)+' of '+data.total+'; columns '+(start+1)+'–'+end+' of '+data.headings.length;
    $('correction-prev').disabled=busy||!correctionOffset;$('correction-next').disabled=busy||correctionOffset+20>=data.total;
    $('correction-cols-prev').disabled=busy||!start;$('correction-cols-next').disabled=busy||end>=data.headings.length;
    const grid=element('table'),head=element('thead'),body=element('tbody'),header=element('tr');
    for(const label of ['Original record / line','Selection',...data.headings.slice(start,end)])header.append(element('th',label));
    head.append(header);grid.append(head,body);
    for(const row of data.rows){
      const tr=element('tr');tr.append(element('th',row.record+' / '+row.line),element('td',row.exclusion?'Excluded: '+row.exclusion.reason:'Included'));
      row.cells.slice(start,end).forEach((original,relative)=>{
        const column=start+relative,decision=row.decisions[column],td=element('td'),button=element('button',previewValue(decision?decision.value:original));
        button.type='button';button.className='source-cell-choice';button.title='Inspect complete original record '+row.record+', column '+(column+1);button.disabled=busy;
        if(decision)td.append(element('small','Reviewed replacement'));
        button.addEventListener('click',()=>{correctionSelection={record:row.record,column,context};showCorrection(doc,row,column);});
        td.append(button);tr.append(td);
      });body.append(tr);
    }
    $('correction-grid').replaceChildren(grid);
    $('correction-editor').hidden=!correctionSelection;
    if(correctionSelection){
      const parsed=parseTable(selectedEdition(doc).sourceText,doc.mapping),row=parsed.rows.find(r=>r.record===correctionSelection.record);
      if(row)showCorrection(doc,row,correctionSelection.column,false);else correctionSelection=null;
    }
    const history=selectedCorrections(doc)?.history||[];
    $('correction-history').textContent=history.length?history.map(e=>e.at+' · '+e.actor+' · '+e.action+' · record '+e.record+(e.column===undefined?'':' / column '+(e.column+1))+'\n'+e.reason+'\nOriginal: '+JSON.stringify(e.original)+'\nBefore: '+JSON.stringify(e.before)+'\nAfter: '+JSON.stringify(e.after)).join('\n\n'):'No recorded corrections for this source and parsing choice.';
    $('correction-download').disabled=busy||!history.length;
  } catch(error){$('correction-grid').replaceChildren(element('p',error.message));$('correction-editor').hidden=true;}
}
function showCorrection(doc,row,column,reset=true) {
  const set=selectedCorrections(doc),current=set?.history||[],state=sourceRecords(doc,{offset:parseTable(selectedEdition(doc).sourceText,doc.mapping).rows.findIndex(r=>r.record===row.record),limit:1}).rows[0];
  $('correction-editor').hidden=false;
  $('correction-selected').textContent='Original record '+row.record+' · physical line '+row.line+' · column '+(column+1)+' · '+doc.mapping.columns.find(c=>c.index===column)?.sourceName;
  $('correction-original').textContent=row.cells[column];
  $('correction-current').textContent=state.decisions[column]?state.decisions[column].value:row.cells[column];
  $('correction-row-state').textContent=state.exclusion?'This row is excluded: '+state.exclusion.reason:'This row is included.';
  if(reset){$('correction-value').value=state.decisions[column]?.value??row.cells[column];$('correction-reason').value='';}
  $('correction-restore-cell').disabled=busy||!state.decisions[column];
  $('correction-exclude').disabled=busy||!!state.exclusion;
  $('correction-restore-row').disabled=busy||!state.exclusion;
}
async function commitCorrection(action) {
  const doc=currentDocument();if(!doc||!correctionSelection)throw new Error('Choose an original source cell.');
  if(correctionSelection.context!==correctionContextKey(doc)||correctionDocument!==correctionSelection.context){
    renderCorrections(doc);
    throw new Error('The source or parsing choice changed. Choose the cell again before recording a correction.');
  }
  const input={id:'correction-'+crypto.randomUUID(),actor:$('correction-actor').value,reason:$('correction-reason').value,
    action,record:correctionSelection.record,...(action.endsWith('cell')?{column:correctionSelection.column}:{}),
    ...(action==='set-cell'?{value:$('correction-value').value}:{}),at:new Date().toISOString()};
  replaceProject(recordCorrection(project,doc.id,input),doc.id);
  message('Recorded the source decision. The original bytes and earlier reviews remain unchanged. Retain a new review to update the native output.');
}
for(const [id,action] of [['correction-apply','set-cell'],['correction-restore-cell','restore-cell'],['correction-exclude','exclude-row'],['correction-restore-row','restore-row']])
  $(id).addEventListener('click',()=>perform(()=>commitCorrection(action)));
for(const [id,kind,delta] of [['correction-prev','row',-20],['correction-next','row',20],['correction-cols-prev','column',-6],['correction-cols-next','column',6]])
  $(id).addEventListener('click',()=>{if(kind==='row')correctionOffset+=delta;else correctionColumnOffset+=delta;renderCorrections(currentDocument());});
$('correction-download').addEventListener('click',()=>download('Source_Correction_History.csv',correctionsCsv(selectedCorrections(currentDocument())),'text/csv;charset=utf-8'));

window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
render();
message('Add the original source files or reopen a complete project.');
