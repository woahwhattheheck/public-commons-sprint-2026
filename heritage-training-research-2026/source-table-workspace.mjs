// MIT. Source-table authoring for the existing Stellar Forge merchant workspace.
import { DEFAULT_STARTER, DEFAULT_RESOURCE, SOURCE_CONTRACT, createDatasetWorkspace, zipWorkspace } from './onboarding.mjs';
import { validateDocumentTableSource, validateDocumentTableProjection } from './source-document-tables.mjs';
import { validateDocumentIntake } from './source-table-intake.mjs';

export const PROJECT_SCHEMA = 'stellar-forge.source-table-project.v1';
export const MAPPING_SCHEMA = 'stellar-forge.source-table-mapping.v1';
export const RESOURCE_SCHEMA = 'stellar-forge.tabular-resource.v1';
export const TYPES = Object.freeze(['text', 'integer', 'integer-text', 'decimal-text', 'boolean', 'date', 'timestamp']);
export const EMPTY_POLICIES = Object.freeze(['keep', 'null', 'omit', 'error']);
export const DELIMITERS = Object.freeze({ comma: ',', tab: '\t', semicolon: ';', pipe: '|' });
export const LIMITS = Object.freeze({ sourceBytes: 16 * 1024 * 1024, projectBytes: 128 * 1024 * 1024, rows: 100000, columns: 512, documents: 64 });
const encoder = new TextEncoder();
const own = (o, key) => Object.prototype.hasOwnProperty.call(o, key);
const object = o => o !== null && typeof o === 'object' && !Array.isArray(o);
const copy = value => JSON.parse(JSON.stringify(value));
const json = value => JSON.stringify(value, null, 2) + '\n';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const now = () => new Date().toISOString();
const id = prefix => prefix + '-' + crypto.randomUUID();
const bytes = text => encoder.encode(text).length;

export class SourceTableError extends Error {
  constructor(code, message, details = {}) {
    super(message); this.name = 'SourceTableError'; this.code = code; Object.assign(this, details);
  }
}
function fail(code, message, details) { throw new SourceTableError(code, message, details); }
function text(value, label, maximum = 1000) {
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))
    fail('TEXT', label + ' must be ordinary text of at most ' + maximum + ' characters.');
  return value;
}
function sourceText(value) {
  if (typeof value !== 'string') fail('SOURCE_TEXT', 'The source must be decoded UTF-8 text.');
  if (bytes(value) > LIMITS.sourceBytes) fail('SOURCE_SIZE', 'The source exceeds the 16 MiB table-authoring limit.');
  if (value.includes('\u0000')) fail('SOURCE_BINARY', 'The source contains a NUL character. Choose a UTF-8 delimited text file.');
  if (typeof value.isWellFormed === 'function' && !value.isWellFormed()) fail('SOURCE_UNICODE', 'The source contains an unpaired Unicode surrogate.');
  return value;
}
export async function sha256(value) {
  const data = typeof value === 'string' ? encoder.encode(value) : value;
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), b => b.toString(16).padStart(2, '0')).join('');
}
export function decodeSource(value) {
  try { return sourceText(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(value)); }
  catch (error) { if (error instanceof SourceTableError) throw error; fail('SOURCE_ENCODING', 'The selected file is not valid UTF-8. Export the original table as UTF-8 CSV or TSV.'); }
}
function delimiter(value) {
  const d = own(DELIMITERS, value) ? DELIMITERS[value] : value;
  if (!Object.values(DELIMITERS).includes(d)) fail('DELIMITER', 'Select comma, tab, semicolon or pipe.');
  return d;
}

/** Strict delimited-text reader. Original text is retained separately, including BOM and line endings. */
export function parseTable(input, { delimiter: selected = ',', header = true, skipEmptyRecords = false } = {}) {
  sourceText(input);
  if (typeof header !== 'boolean' || typeof skipEmptyRecords !== 'boolean') fail('DIALECT', 'Header and empty-record options must be true or false.');
  const separator = delimiter(selected), s = input.replace(/^\uFEFF/, '');
  if (!s.length) fail('EMPTY_SOURCE', 'The selected source is empty.');
  const records = [];
  let cells = [], cell = '', quoted = false, closed = false, started = false;
  let line = 1, recordLine = 1, skipped = 0;
  const pushCell = () => {
    cells.push(cell); cell = ''; closed = false;
    if (cells.length > LIMITS.columns) fail('COLUMN_LIMIT', 'A table can contain at most ' + LIMITS.columns + ' columns.', { line });
  };
  const pushRecord = () => {
    pushCell(); records.push({ cells, line: recordLine, record: records.length + 1 });
    if (records.length > LIMITS.rows + 1) fail('ROW_LIMIT', 'A source can contain at most ' + LIMITS.rows + ' data records.');
    cells = []; started = false;
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } }
      else if (c === '\r') { cell += c; if (s[i + 1] === '\n') cell += s[++i]; line++; }
      else { cell += c; if (c === '\n') line++; }
      continue;
    }
    if (c === '\r' || c === '\n') {
      pushRecord(); if (c === '\r' && s[i + 1] === '\n') i++;
      line++; recordLine = line; continue;
    }
    if (c === separator) { pushCell(); started = true; continue; }
    if (closed) fail('CSV_AFTER_QUOTE', 'Unexpected character after a closing quote on source line ' + line + '.', { line });
    if (c === '"') {
      if (cell.length) fail('CSV_QUOTE', 'A quoted field must start with a quote on source line ' + line + '.', { line });
      quoted = true; started = true; continue;
    }
    cell += c; started = true;
  }
  if (quoted) fail('CSV_UNCLOSED_QUOTE', 'The quoted field beginning in record at line ' + recordLine + ' is not closed.', { line: recordLine });
  if (started || cells.length || cell.length || closed) pushRecord();
  const first = records[0], width = first.cells.length;
  const headings = header ? [...first.cells] : Array.from({ length: width }, (_, i) => 'Column ' + (i + 1));
  const body = header ? records.slice(1) : records;
  const rows = [];
  for (const record of body) {
    if (skipEmptyRecords && record.cells.every(value => value === '')) { skipped++; continue; }
    if (record.cells.length !== width)
      fail('ROW_WIDTH', 'Source record ' + record.record + ' (line ' + record.line + ') has ' + record.cells.length + ' fields; the table declares ' + width + '.', { line: record.line, record: record.record, expected: width, actual: record.cells.length });
    rows.push(record);
  }
  if (rows.length > LIMITS.rows) fail('ROW_LIMIT', 'A source can contain at most ' + LIMITS.rows + ' data records.');
  return { delimiter: separator, header, skipEmptyRecords, headings, width, rows, skippedEmptyRecords: skipped, sourceRecordCount: body.length };
}

/** Dialect suggestions are shown for review; the saved mapping always contains an explicit delimiter. */
export function inspectSource(input, options = {}) {
  if (options.delimiter) {
    const parsed = parseTable(input, options);
    return { delimiter: parsed.delimiter, candidates: [parsed.delimiter], ambiguous: false, ...tableSummary(parsed) };
  }
  const candidates = [];
  for (const d of Object.values(DELIMITERS)) {
    try { const p = parseTable(input, { ...options, delimiter: d }); candidates.push({ delimiter: d, width: p.width, parsed: p }); } catch {}
  }
  if (!candidates.length) return inspectSource(input, { ...options, delimiter: ',' });
  const highest = Math.max(...candidates.map(c => c.width));
  const best = candidates.filter(c => c.width === highest);
  const selected = best[0];
  return { delimiter: selected.delimiter, candidates: best.map(c => c.delimiter), ambiguous: best.length > 1, ...tableSummary(selected.parsed) };
}
function tableSummary(p) {
  return { headings: [...p.headings], columnCount: p.width, rowCount: p.rows.length, skippedEmptyRecords: p.skippedEmptyRecords,
    sourceRecordCount: p.sourceRecordCount, preview: p.rows.slice(0, 20).map(copy) };
}
export function initialMapping(input, options = {}) {
  const selected = options.delimiter || inspectSource(input, options).delimiter;
  const p = parseTable(input, { delimiter: selected, header: options.header !== false, skipEmptyRecords: options.skipEmptyRecords === true });
  const used = new Set();
  return { schema: MAPPING_SCHEMA, delimiter: p.delimiter, header: p.header, skipEmptyRecords: p.skipEmptyRecords, keyColumns: [],
    columns: p.headings.map((heading, index) => {
      const base = heading.trim().slice(0, 110) || 'column_' + (index + 1);
      let name = base, suffix = 2;
      while (used.has(name)) name = base + '_' + suffix++;
      used.add(name);
      return { index, sourceName: heading, name, include: true, type: 'text', empty: 'keep', trim: false, unit: '', timeBasis: '' };
    }) };
}
function validateMapping(mapping, parsed) {
  if (!object(mapping) || mapping.schema !== MAPPING_SCHEMA) fail('MAPPING_SCHEMA', 'Choose a complete source-table mapping.');
  if (!Array.isArray(mapping.columns) || mapping.columns.length !== parsed.width) fail('MAPPING_WIDTH', 'Review the mapping for this source: its column count changed.');
  const seen = new Set(), names = new Set();
  for (const column of mapping.columns) {
    if (!object(column) || !Number.isSafeInteger(column.index) || column.index < 0 || column.index >= parsed.width || seen.has(column.index))
      fail('MAPPING_INDEX', 'Each source column needs one unique mapping.');
    seen.add(column.index);
    if (column.sourceName !== parsed.headings[column.index])
      fail('MAPPING_HEADER', 'Source column ' + (column.index + 1) + ' changed from ' + JSON.stringify(column.sourceName) + ' to ' + JSON.stringify(parsed.headings[column.index]) + '. Review and reset the mapping for the new header.', { column: column.index });
    if (typeof column.include !== 'boolean' || typeof column.trim !== 'boolean') fail('MAPPING_BOOLEAN', 'Include and trim choices must be explicit booleans.');
    if (!TYPES.includes(column.type) || !EMPTY_POLICIES.includes(column.empty)) fail('MAPPING_TYPE', 'Select a supported field type and empty-value policy.');
    text(column.name, 'Output field name', 128); text(column.unit, 'Unit', 256); text(column.timeBasis, 'Time basis', 256);
    if (column.include) {
      if (!column.name.trim() || names.has(column.name)) fail('MAPPING_NAME', 'Included fields need unique, nonempty output names.', { column: column.index });
      names.add(column.name);
    }
  }
  if (!names.size) fail('MAPPING_EMPTY', 'Include at least one output field.');
  if (!Array.isArray(mapping.keyColumns) || new Set(mapping.keyColumns).size !== mapping.keyColumns.length ||
    mapping.keyColumns.some(index => !mapping.columns.some(c => c.index === index && c.include)))
    fail('MAPPING_KEYS', 'Record keys must identify distinct included source columns.');
}
function validDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return month >= 1 && month <= 12 && day >= 1 && day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}
function valueFor(raw, column) {
  const value = column.trim ? raw.trim() : raw;
  if (value === '') {
    if (column.empty === 'keep') return '';
    if (column.empty === 'null') return null;
    if (column.empty === 'omit') return undefined;
    throw new Error('An empty value is not allowed.');
  }
  switch (column.type) {
    case 'text': return value;
    case 'integer':
      if (!/^-?(0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('Use an exact safe JSON integer; choose Integer text for larger or zero-padded values.');
      return Number(value);
    case 'integer-text':
      if (!/^[+-]?\d+$/.test(value)) throw new Error('Expected an integer written as text.');
      return value;
    case 'decimal-text':
      if (!/^[+-]?\d+(?:\.\d+)?$/.test(value)) throw new Error('Expected decimal text. Its original digits and scale are preserved.');
      return value;
    case 'boolean':
      if (value === 'true') return true;
      if (value === 'false') return false;
      throw new Error('Expected exactly true or false.');
    case 'date':
      if (!validDate(value)) throw new Error('Expected a real calendar date in YYYY-MM-DD form.');
      return value;
    case 'timestamp': {
      const m = /^(\d{4}-\d{2}-\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/.exec(value);
      if (!m || !validDate(m[1]) || Number(m[2]) > 23 || Number(m[3]) > 59 || Number(m[4]) > 59 || (m[5] && (Number(m[6]) > 23 || Number(m[7]) > 59)))
        throw new Error('Expected an explicit RFC 3339 time and UTC offset. The saved value is not shifted to another timezone.');
      return value;
    }
    default: throw new Error('Unsupported field type.');
  }
}
function keyNames(mapping) { return mapping.keyColumns.map(index => mapping.columns.find(c => c.index === index).name); }
function keyFor(row, names) {
  return JSON.stringify(names.map(name => {
    if (!own(row, name) || row[name] === null || row[name] === '') throw new Error('Record key ' + JSON.stringify(name) + ' is empty, null or omitted.');
    return [typeof row[name], row[name]];
  }));
}

/** Convert only the operator-selected fields. Strings, exact decimals and original source records stay recoverable. */
export function normalizeTable(edition, mapping) {
  const parsed = parseTable(edition.sourceText, mapping);
  validateMapping(mapping, parsed);
  const columns = mapping.columns.filter(c => c.include), names = keyNames(mapping);
  const projectedRecords = edition.documentTable ? new Map(edition.documentTable.projection.rows.map(row => [row.record, row])) : null;
  const rows = [], records = [], issues = [], seenKeys = new Map();
  let issueCount = 0;
  const issue = value => { issueCount++; if (issues.length < 200) issues.push(value); };
  for (const record of parsed.rows) {
    const row = Object.create(null);
    let invalid = false;
    for (const column of columns) {
      try { const value = valueFor(record.cells[column.index], column); if (value !== undefined) row[column.name] = value; }
      catch (error) { invalid = true; issue({ record: record.record, line: record.line, column: column.index, name: column.name, value: record.cells[column.index], message: error.message }); }
    }
    if (!invalid && names.length) {
      try {
        const key = keyFor(row, names);
        if (seenKeys.has(key)) { invalid = true; issue({ record: record.record, line: record.line, message: 'Duplicate record key; first seen in source record ' + seenKeys.get(key) + '.', key }); }
        else seenKeys.set(key, record.record);
      } catch (error) { invalid = true; issue({ record: record.record, line: record.line, message: error.message }); }
    }
    if (!invalid) {
      rows.push(row);
      const origin = { record: record.record, line: record.line };
      if (edition.documentTable) {
        const retained = edition.documentTable, projection = retained.projection;
        const projected = projectedRecords.get(record.record);
        origin.documentTable = { sourceId: retained.sourceId, projectionId: projection.id,
          tableIndex: projection.selection.tableIndex,
          ...(projected ? { row: projected.row, cells: copy(projected.cells) } :
            { headerRows: copy(projection.selection.headerRows), cells: copy(projection.headerCells) }) };
      }
      records.push(origin);
    }
  }
  if (issueCount) fail('FIELD_VALUES', 'Review ' + issueCount + ' source field or key issue' + (issueCount === 1 ? '' : 's') + ' before retaining this edition.', { issues, issueCount, issuesTruncated: issueCount > issues.length });
  const fields = columns.map(c => ({ name: c.name, sourceName: c.sourceName, sourceIndex: c.index, type: c.type, empty: c.empty, trim: c.trim, unit: c.unit, timeBasis: c.timeBasis }));
  const data = { schema: RESOURCE_SCHEMA, source: { editionId: edition.id, filename: edition.filename, sha256: edition.sha256, bytes: edition.bytes,
      ...(edition.documentTable ? { documentTable: { sourceId: edition.documentTable.sourceId,
        sourceSha256: edition.documentTable.sourceSha256, projectionId: edition.documentTable.projection.id,
        tableIndex: edition.documentTable.projection.selection.tableIndex, document: copy(edition.documentTable.document) } } : {}) },
    fields, keyFields: names, rows };
  const dataText = json(data), dataBytes = bytes(dataText);
  if (dataBytes > SOURCE_CONTRACT.maximumDataBytes) fail('OUTPUT_SIZE', 'The complete mapped output is ' + dataBytes + ' bytes; the native dataset resource accepts ' + SOURCE_CONTRACT.maximumDataBytes + '. Select fewer fields or use the existing native database/dataset workflow.');
  return { data, dataText, dataBytes, sourceRecords: records, summary: { rows: rows.length, columns: fields.length, sourceRecords: parsed.sourceRecordCount, skippedEmptyRecords: parsed.skippedEmptyRecords, keyFields: names } };
}
export function createProject({ name = 'Source tables', starter } = {}) {
  text(name, 'Project name', 200);
  return { schema: PROJECT_SCHEMA, id: id('project'), name, createdAt: now(),
    starter: starter ? copy(starter) : { ...copy(DEFAULT_STARTER), resources: [] }, documents: [] };
}
function documentIn(project, documentId) {
  const doc = project.documents.find(d => d.id === documentId);
  if (!doc) fail('DOCUMENT', 'Choose a source document in this project.');
  return doc;
}
export function selectedEdition(doc) {
  const edition = doc.editions.find(e => e.id === doc.selectedEditionId);
  if (!edition) fail('EDITION', 'The selected source edition is absent.');
  return edition;
}
export function selectedReview(doc) {
  const review = doc.reviews.find(r => r.id === doc.selectedReviewId);
  if (!review) fail('REVIEW_REQUIRED', 'Review ' + doc.label + ' before exporting its native resource.');
  return review;
}
async function newEdition(filename, value) {
  text(filename, 'Original filename', 500); sourceText(value);
  const hash = await sha256(value);
  return { id: 'e-' + hash, filename, sourceText: value, bytes: bytes(value), sha256: hash, receivedAt: now() };
}
function resourceIdentifier(filename, project) {
  const stem = filename.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 52) || 'table';
  const names = new Set(project.starter.resources.map(r => String(r.id).toLowerCase()));
  let value = stem, i = 2;
  while (names.has(value.toLowerCase())) value = stem + '-' + i++;
  return value;
}
export async function addDocument(project, { filename, sourceText: value, resourceId, delimiter: d, header = true, skipEmptyRecords = false }) {
  const next = copy(project);
  if (next.documents.length >= LIMITS.documents) fail('DOCUMENT_LIMIT', 'A project supports up to 64 table resources.');
  const edition = await newEdition(filename, value);
  const mapping = initialMapping(value, { delimiter: d, header, skipEmptyRecords });
  const rid = resourceId || resourceIdentifier(filename, next);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(rid)) fail('RESOURCE_ID', 'Use 1–64 letters, digits, underscores or hyphens for the resource ID.');
  if (next.documents.some(doc => doc.resourceId.toLowerCase() === rid.toLowerCase())) fail('RESOURCE_BOUND', 'That resource already has a source table.');
  const resource = next.starter.resources.find(r => r.id === rid);
  if (!resource) next.starter.resources.push({ ...copy(DEFAULT_RESOURCE), id: rid, path: '/' + rid, serviceName: rid.slice(0, 32),
    description: 'Reviewed table from ' + filename, tags: ['dataset'], amount: '', dataText: '{"rows":[]}\n' });
  const doc = { id: id('table'), label: filename, resourceId: rid, mapping, selectedEditionId: edition.id, selectedReviewId: null, baselineReviewId: null, editions: [edition], reviews: [] };
  next.documents.push(doc); return { project: next, documentId: doc.id, editionId: edition.id };
}
export async function addEdition(project, documentId, { filename, sourceText: value }) {
  const next = copy(project), doc = documentIn(next, documentId), edition = await newEdition(filename, value);
  const previous = doc.editions.find(e => e.sha256 === edition.sha256 && !e.documentTable);
  if (!previous) doc.editions.push(edition);
  doc.selectedEditionId = previous ? previous.id : edition.id;
  return { project: next, documentId, editionId: doc.selectedEditionId, reused: Boolean(previous) };
}
function documentTableMetadata(source, projection) {
  return { sourceId: source.id, sourceSha256: source.sha256, document: copy(source.document), projection: copy(projection) };
}
async function editionIdentity(edition) {
  return 'e-' + edition.sha256 + (edition.documentTable ? '-d-' + await sha256(JSON.stringify(edition.documentTable)) : '');
}

/** Receive a selected document table into the existing editable resource and edition flow. */
export async function addDocumentTable(project, { source, projection, filename, resourceId, documentId } = {}) {
  const verified = await validateDocumentTableProjection({ source, projection });
  source = verified.source; projection = verified.projection;
  let next = copy(project);
  if (next.documentTableSources !== undefined && !Array.isArray(next.documentTableSources))
    fail('DOCUMENT_TABLE_SOURCES', 'The retained document extraction register must be an array.');
  next.documentTableSources ||= [];
  const original = next.documentTableSources.find(item => item.id === source.id);
  if (original && !same(original, source))
    fail('DOCUMENT_TABLE_IDENTITY', 'This document source identifier already refers to a different retained extraction.');
  if (!original) next.documentTableSources.push(copy(source));
  const name = filename || (source.document.filename || source.filename).replace(/\.[^.]+$/, '') + '-table-' + projection.selection.tableIndex + '.csv';
  let doc, edition, reused = false;
  if (documentId) {
    if (resourceId) fail('DOCUMENT_TABLE_RESOURCE', 'An existing table keeps its original resource. Omit resourceId when adding an edition.');
    doc = documentIn(next, documentId);
    edition = await newEdition(name, projection.csv);
    edition.documentTable = documentTableMetadata(source, projection);
    edition.id = await editionIdentity(edition);
    const prior = doc.editions.find(item => item.id === edition.id);
    if (prior) { edition = prior; reused = true; } else doc.editions.push(edition);
    doc.selectedEditionId = edition.id;
  } else {
    const received = await addDocument(next, { filename: name, sourceText: projection.csv, resourceId, delimiter: ',', header: true, skipEmptyRecords: false });
    next = received.project; doc = documentIn(next, received.documentId); edition = doc.editions[0];
    edition.documentTable = documentTableMetadata(source, projection);
    edition.id = await editionIdentity(edition); doc.selectedEditionId = edition.id;
  }
  return { project: next, documentId: doc.id, editionId: edition.id, reused, sourceId: source.id, projectionId: projection.id };
}

export function resetMapping(project, documentId, options = {}) {
  const next = copy(project), doc = documentIn(next, documentId);
  doc.mapping = initialMapping(selectedEdition(doc).sourceText, options);
  return next;
}
export function replaceMapping(project, documentId, mapping) {
  const next = copy(project), doc = documentIn(next, documentId);
  validateMapping(mapping, parseTable(selectedEdition(doc).sourceText, mapping));
  doc.mapping = copy(mapping); return next;
}
export async function freezeReview(project, documentId) {
  const next = copy(project), doc = documentIn(next, documentId), edition = selectedEdition(doc);
  const result = normalizeTable(edition, doc.mapping), outputSha256 = await sha256(result.dataText);
  const fingerprint = await sha256(JSON.stringify({ source: edition.sha256, mapping: doc.mapping, output: outputSha256 }));
  const reviewId = 'r-' + fingerprint;
  let review = doc.reviews.find(r => r.id === reviewId);
  const reused = Boolean(review);
  if (!review) {
    review = { id: reviewId, editionId: edition.id, reviewedAt: now(), mapping: copy(doc.mapping), sourceSha256: edition.sha256,
      outputSha256, dataText: result.dataText, dataBytes: result.dataBytes, sourceRecords: result.sourceRecords, summary: result.summary };
    doc.reviews.push(review);
  }
  if (doc.selectedReviewId && doc.selectedReviewId !== reviewId) doc.baselineReviewId = doc.selectedReviewId;
  doc.selectedReviewId = reviewId;
  const resource = next.starter.resources.find(r => r.id === doc.resourceId);
  if (!resource) fail('RESOURCE_MISSING', 'The original merchant resource ' + doc.resourceId + ' is absent.');
  resource.dataText = review.dataText;
  return { project: next, review: copy(review), reused };
}
export function reviewIsCurrent(doc) {
  if (!doc.selectedReviewId) return false;
  const review = selectedReview(doc);
  return review.editionId === doc.selectedEditionId && same(review.mapping, doc.mapping);
}
export function compareReviews(doc, baselineId, currentId = doc.selectedReviewId) {
  const before = doc.reviews.find(r => r.id === baselineId), after = doc.reviews.find(r => r.id === currentId);
  if (!before || !after) fail('COMPARE_REVIEW', 'Choose two retained reviews from the same table.');
  const base = JSON.parse(before.dataText), head = JSON.parse(after.dataText);
  const keysCompatible = same(base.keyFields, head.keyFields);
  const keys = keysCompatible ? head.keyFields : [];
  const fieldsBefore = new Map(base.fields.map(f => [f.name, f])), fieldsAfter = new Map(head.fields.map(f => [f.name, f]));
  const columns = { added: [], removed: [], changed: [] };
  for (const [name, field] of fieldsBefore) {
    if (!fieldsAfter.has(name)) columns.removed.push(copy(field));
    else if (!same(field, fieldsAfter.get(name))) columns.changed.push({ name, before: copy(field), after: copy(fieldsAfter.get(name)) });
  }
  for (const [name, field] of fieldsAfter) if (!fieldsBefore.has(name)) columns.added.push(copy(field));
  const changes = [], summary = { added: 0, removed: 0, changed: 0, unchanged: 0 };
  if (keys.length) {
    const left = new Map(base.rows.map((row, index) => [keyFor(row, keys), { row, index }]));
    const right = new Map(head.rows.map((row, index) => [keyFor(row, keys), { row, index }]));
    for (const [key, entry] of left) {
      if (!right.has(key)) { summary.removed++; changes.push({ kind: 'removed', key, beforeRecord: before.sourceRecords[entry.index], before: entry.row, after: null }); }
      else {
        const other = right.get(key);
        const names = new Set([...Object.keys(entry.row), ...Object.keys(other.row)]);
        const changedFields = [...names].filter(name => own(entry.row, name) !== own(other.row, name) || !same(entry.row[name], other.row[name]));
        if (changedFields.length) { summary.changed++; changes.push({ kind: 'changed', key, beforeRecord: before.sourceRecords[entry.index], afterRecord: after.sourceRecords[other.index], changedFields, before: entry.row, after: other.row }); }
        else summary.unchanged++;
      }
    }
    for (const [key, entry] of right) if (!left.has(key)) { summary.added++; changes.push({ kind: 'added', key, afterRecord: after.sourceRecords[entry.index], before: null, after: entry.row }); }
  } else {
    const counts = new Map();
    const signature = row => JSON.stringify(Object.keys(row).sort().map(name => [name, row[name]]));
    for (let i = 0; i < base.rows.length; i++) { const key = signature(base.rows[i]); if (!counts.has(key)) counts.set(key, []); counts.get(key).push(i); }
    for (let i = 0; i < head.rows.length; i++) {
      const key = signature(head.rows[i]), indices = counts.get(key);
      if (indices && indices.length) { indices.pop(); summary.unchanged++; }
      else { summary.added++; changes.push({ kind: 'added', key, afterRecord: after.sourceRecords[i], before: null, after: head.rows[i] }); }
    }
    for (const [key, indices] of counts) for (const index of indices) { summary.removed++; changes.push({ kind: 'removed', key, beforeRecord: before.sourceRecords[index], before: base.rows[index], after: null }); }
  }
  return { schema: 'stellar-forge.source-table-comparison.v1', documentId: doc.id, baselineReviewId: before.id, currentReviewId: after.id,
    mode: keys.length ? 'record-keys' : 'whole-row-multiset', keyFields: keys, keysChanged: !keysCompatible,
    declaredKeyFields: { baseline: base.keyFields, current: head.keyFields }, summary, columns, changes };
}
export function comparisonCsv(comparison) {
  const escape = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
  return [['change', 'key_json', 'before_record', 'after_record', 'changed_fields_json', 'before_json', 'after_json'],
    ...comparison.changes.map(c => [c.kind, c.key, c.beforeRecord?.record ?? '', c.afterRecord?.record ?? '', JSON.stringify(c.changedFields || []), c.before === null ? '' : JSON.stringify(c.before), c.after === null ? '' : JSON.stringify(c.after)])]
    .map(row => row.map(escape).join(',')).join('\r\n') + '\r\n';
}

/** Verify the complete portable project from its original sources, then retain its authoring state. */
export async function importProject(input) {
  const raw = typeof input === 'string' ? input : json(input);
  if (bytes(raw) > LIMITS.projectBytes) fail('PROJECT_SIZE', 'The portable project exceeds 128 MiB.');
  let project;
  try { project = JSON.parse(raw.replace(/^\uFEFF/, '')); } catch { fail('PROJECT_JSON', 'Choose a complete source-table project JSON.'); }
  if (!object(project) || project.schema !== PROJECT_SCHEMA || !/^project-[0-9a-f-]{36}$/.test(project.id || '') || !Array.isArray(project.documents) || project.documents.length > LIMITS.documents ||
    !object(project.starter) || !Array.isArray(project.starter.resources)) fail('PROJECT_SCHEMA', 'This file is not a complete source-table project.');
  text(project.name, 'Project name', 200);
  if (project.documentTableSources !== undefined && !Array.isArray(project.documentTableSources))
    fail('DOCUMENT_TABLE_SOURCES', 'The retained document extraction register must be an array.');
  const documentSources = new Map();
  for (const source of project.documentTableSources || []) {
    await validateDocumentTableSource(source);
    if (documentSources.has(source.id)) fail('DOCUMENT_TABLE_SOURCE', 'A retained document source is duplicated.');
    documentSources.set(source.id, source);
  }
  if (project.documentIntake !== undefined) project.documentIntake = await validateDocumentIntake(project.documentIntake, project.documentTableSources || []);
  const ids = new Set(), resources = new Set();
  for (const doc of project.documents) {
    if (!object(doc) || !/^table-[0-9a-f-]{36}$/.test(doc.id || '') || ids.has(doc.id) || !Array.isArray(doc.editions) || !doc.editions.length || !Array.isArray(doc.reviews))
      fail('PROJECT_DOCUMENT', 'A source-table document is incomplete or duplicated.');
    ids.add(doc.id); text(doc.label, 'Document label', 500);
    if (typeof doc.resourceId !== 'string' || doc.resourceId.length > 64 || resources.has(doc.resourceId.toLowerCase()) || !project.starter.resources.some(r => r.id === doc.resourceId))
      fail('PROJECT_RESOURCE', 'Each table must bind one existing, unique merchant resource.');
    resources.add(doc.resourceId.toLowerCase());
    const editions = new Map();
    for (const edition of doc.editions) {
      text(edition.filename, 'Original filename', 500); sourceText(edition.sourceText);
      const hash = await sha256(edition.sourceText);
      if (edition.documentTable) {
        const retained = edition.documentTable, source = documentSources.get(retained.sourceId);
        if (!source) fail('DOCUMENT_TABLE_SOURCE', 'A projected table is missing its complete original document extraction.');
        await validateDocumentTableProjection({ source, projection: retained.projection });
        if (!same(retained, documentTableMetadata(source, retained.projection)) || edition.sourceText !== retained.projection.csv)
          fail('DOCUMENT_TABLE_PROJECTION', 'The retained table CSV and original document projection do not agree.');
      }
      if (edition.sha256 !== hash || edition.id !== await editionIdentity(edition) || edition.bytes !== bytes(edition.sourceText) || editions.has(edition.id))
        fail('PROJECT_SOURCE', 'The retained source bytes or source identity do not match.');
      editions.set(edition.id, edition);
    }
    const reviews = new Set();
    for (const review of doc.reviews) {
      const edition = editions.get(review.editionId);
      if (!edition) fail('PROJECT_REVIEW', 'A retained review is missing its original source.');
      const result = normalizeTable(edition, review.mapping), hash = await sha256(result.dataText);
      const fingerprint = await sha256(JSON.stringify({ source: edition.sha256, mapping: review.mapping, output: hash }));
      if (review.id !== 'r-' + fingerprint || reviews.has(review.id) || review.sourceSha256 !== edition.sha256 || review.dataText !== result.dataText ||
        review.outputSha256 !== hash || review.dataBytes !== result.dataBytes || !same(review.sourceRecords, result.sourceRecords) || !same(review.summary, result.summary))
        fail('PROJECT_REVIEW', 'A retained review does not reproduce from its original source and mapping.');
      reviews.add(review.id);
    }
    if (!editions.has(doc.selectedEditionId) || (doc.selectedReviewId && !reviews.has(doc.selectedReviewId)) || (doc.baselineReviewId && !reviews.has(doc.baselineReviewId)))
      fail('PROJECT_SELECTION', 'A selected source or review is absent from the project.');
    // In-progress mappings stay editable; retained reviews above must reproduce completely.
    if (!object(doc.mapping) || doc.mapping.schema !== MAPPING_SCHEMA || !Array.isArray(doc.mapping.columns) ||
      !doc.mapping.columns.length || doc.mapping.columns.length > LIMITS.columns || typeof doc.mapping.header !== 'boolean' ||
      typeof doc.mapping.skipEmptyRecords !== 'boolean' || !Array.isArray(doc.mapping.keyColumns))
      fail('PROJECT_MAPPING', 'The saved editable mapping is incomplete.');
    delimiter(doc.mapping.delimiter);
    const mappingIndices = new Set();
    for (const column of doc.mapping.columns) {
      if (!object(column) || !Number.isSafeInteger(column.index) || column.index < 0 || column.index >= LIMITS.columns ||
        mappingIndices.has(column.index) || typeof column.sourceName !== 'string' || typeof column.include !== 'boolean' ||
        typeof column.trim !== 'boolean' || !TYPES.includes(column.type) || !EMPTY_POLICIES.includes(column.empty))
        fail('PROJECT_MAPPING', 'The saved editable mapping contains an incomplete column.');
      mappingIndices.add(column.index);
      text(column.name, 'Output field name', 128); text(column.unit, 'Unit', 256); text(column.timeBasis, 'Time basis', 256);
    }
    if (new Set(doc.mapping.keyColumns).size !== doc.mapping.keyColumns.length ||
      doc.mapping.keyColumns.some(index => !doc.mapping.columns.some(column => column.index === index && column.include)))
      fail('PROJECT_MAPPING', 'The saved editable record keys must identify distinct included columns.');
  }
  return project;
}
export function projectSummary(project) {
  return { schema: project.schema, id: project.id, name: project.name, folder: project.starter.folder,
    tables: project.documents.map(doc => ({ id: doc.id, label: doc.label, resourceId: doc.resourceId, sourceEditions: doc.editions.length,
      reviews: doc.reviews.length, selectedEditionId: doc.selectedEditionId, selectedReviewId: doc.selectedReviewId, reviewedCurrentInput: reviewIsCurrent(doc),
      summary: doc.selectedReviewId ? selectedReview(doc).summary : null,
      ...(selectedEdition(doc).documentTable ? { documentTable: { sourceId: selectedEdition(doc).documentTable.sourceId, projectionId: selectedEdition(doc).documentTable.projection.id, tableIndex: selectedEdition(doc).documentTable.projection.selection.tableIndex } } : {}) })) };
}
export async function createTableWorkspace(project) {
  const verified = await importProject(project);
  if (!verified.documents.length) fail('NO_TABLES', 'Add and review at least one source table.');
  const starter = copy(verified.starter);
  for (const doc of verified.documents) {
    if (!reviewIsCurrent(doc)) fail('REVIEW_STALE', 'Review the current source and mapping for ' + doc.label + ' before exporting.');
    starter.resources.find(r => r.id === doc.resourceId).dataText = selectedReview(doc).dataText;
  }
  const native = createDatasetWorkspace(starter), prefix = native.summary.folder + '/source-tables/';
  const files = [...native.files], manifest = { schema: 'stellar-forge.source-table-materials.v1', projectId: verified.id, projectName: verified.name,
    nativeWorkspaceSchema: native.workspace.schema, documents: [] };
  const append = (path, content) => { files.push({ path: prefix + path, content }); return 'source-tables/' + path; };
  const portable = { ...verified, starter: native.draft };
  append('project.json', json(portable));
  if (verified.documentTableSources?.length) {
    manifest.documentTableSources = [];
    for (const source of verified.documentTableSources) {
      const base = 'documents/' + source.id + '/';
      const original = append(base + 'extracted-source.txt', source.sourceText);
      const record = append(base + 'source.json', json(source));
      manifest.documentTableSources.push({ id: source.id, filename: source.filename, original, record,
        bytes: source.bytes, sha256: source.sha256, document: copy(source.document) });
    }
  }
  for (const doc of verified.documents) {
    const entry = { id: doc.id, label: doc.label, resourceId: doc.resourceId, selectedReviewId: doc.selectedReviewId, sources: [], reviews: [], comparisons: [] };
    for (const edition of doc.editions) {
      const path = append('sources/' + doc.id + '/' + edition.id + '.txt', edition.sourceText);
      const sourceEntry = { id: edition.id, filename: edition.filename, path, bytes: edition.bytes, sha256: edition.sha256, receivedAt: edition.receivedAt };
      if (edition.documentTable) {
        const base = 'projections/' + doc.id + '/' + edition.id + '/';
        const retained = edition.documentTable, projection = retained.projection;
        sourceEntry.documentTable = { sourceId: retained.sourceId, projectionId: projection.id,
          document: copy(retained.document),
          projection: append(base + 'projection.json', json(projection)),
          selection: append(base + 'selection.json', json(projection.selection)),
          rows: append(base + 'row-origins.json', json(projection.rows)) };
      }
      entry.sources.push(sourceEntry);
    }
    for (const review of doc.reviews) {
      const base = 'reviews/' + doc.id + '/' + review.id + '/';
      const output = append(base + 'output.json', review.dataText);
      const mapping = append(base + 'mapping.json', json(review.mapping));
      const record = append(base + 'review.json', json({ ...review, dataText: undefined }));
      entry.reviews.push({ id: review.id, editionId: review.editionId, output, mapping, record, bytes: review.dataBytes, sha256: review.outputSha256, summary: review.summary });
    }
    if (doc.baselineReviewId && doc.baselineReviewId !== doc.selectedReviewId) {
      const comparison = compareReviews(doc, doc.baselineReviewId);
      const base = 'comparisons/' + doc.id + '/' + doc.baselineReviewId + '--' + doc.selectedReviewId;
      entry.comparisons.push({ json: append(base + '.json', json(comparison)), csv: append(base + '.csv', comparisonCsv(comparison)), summary: comparison.summary, mode: comparison.mode });
    }
    manifest.documents.push(entry);
  }
  if (verified.documentIntake) manifest.documentIntake = { source: 'source-tables/project.json', sources: verified.documentIntake.sources.length, tables: verified.documentIntake.sources.reduce((count, item) => count + item.tables.length, 0) };
  append('materials.json', json(manifest));
  const guide = '# ' + verified.name + ': source-table operation\n\n' +
    'This directory contains the original source editions, explicit mappings, reviewed complete outputs and editable project. The merchant uses the original seller.json and workspace.json in the parent directory.\n\n' +
    '## Reopen and update\n\nOpen source-tables.html in the maintained Stellar Forge front door and choose Open project JSON, then select source-tables/project.json. Select a table, add the next source edition, inspect the declared header and mapping, and retain its review. The prior source and output remain available. Record keys identify changed rows; with no keys, comparisons report whole-row additions and removals including duplicates. Unit and time-basis fields document meaning and do not convert values.\n\n' +
    'Export the complete native workspace after reviewing every current mapping. The parent README.md contains the original installation and merchant commands. Keep the original source version and receiving application with the commissioned installation. The current dataset resource is a startup snapshot; follow the native release/change operation when replacing a serving source.\n\n' +
    '## Document tables\n\nDocument-derived resources retain complete extracted text under documents/, original document identity and extraction metadata in source.json, and each explicit table selection plus projected row and cell origins under projections/. The selected CSV is an ordinary source edition in the same mapping and review workflow. Saving and reopening preserves unselected original rows for later remapping. Selecting a new projection creates a new edition even when its CSV text matches an earlier projection.\n\n' +
    '## Receiving and commissioning\n\nReceive the entire directory. materials.json lists every original source and reviewed output with its exact identity. Each output has fields, keyFields, source and rows. Integers of arbitrary size and exact decimals use their explicitly selected text types. An empty string, null and an omitted value retain distinct policies. The same project reopens in the browser or original source-table CLI.\n\n' +
    'For an existing SF49 commissioning case, retain this complete directory as the source material attached through its existing source-bundle operation. Use that case owner’s original source handoff, terms, operation ID and source-bundle writer. The original case/bundle keeps the selected customer workorder and native receiving result alongside these files.\n\n' +
    '## Terminal use from the maintained source\n\nnode stellar-forge/developer-site/dist/source-table-cli.mjs show --project /absolute/path/to/source-tables/project.json\nnode stellar-forge/developer-site/dist/source-table-cli.mjs export --project /absolute/path/to/source-tables/project.json --out /absolute/new-workspace.zip\n\n' +
    'Choose a new output path for every CLI save. A project can be downloaded while its mapping is unfinished; a native workspace exports the complete currently reviewed outputs.\n';
  append('OPERATING.md', guide);
  const fileManifest = [];
  for (const file of files) fileManifest.push({ path: file.path, bytes: typeof file.content === 'string' ? bytes(file.content) : file.content.length, sha256: await sha256(file.content) });
  append('files.json', json({ schema: 'stellar-forge.source-table-files.v1', files: fileManifest }));
  return { ...native, files, project: portable, manifest, summary: { ...native.summary, projectId: verified.id, sourceTables: projectSummary(verified).tables } };
}
export async function createTableArchive(project) { const workspace = await createTableWorkspace(project); return { workspace, bytes: zipWorkspace(workspace.files) }; }
