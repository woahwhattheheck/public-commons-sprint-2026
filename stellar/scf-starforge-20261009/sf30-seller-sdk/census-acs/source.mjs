// MIT. Original ACS selected rows and immutable source-file projection.
import { realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { bytes, digest, identity, readPrivate, hashPrivate, fault, object } from '../postgres/publisher/files.mjs';

export const CAPTURE_SCHEMA = 'stellar-forge.census-acs-capture.v1';
export const SOURCE_SCHEMA = 'stellar-forge.census-acs-source.v1';
export const MANIFEST_PATH = '_census/capture-manifest.json';
export const CHUNK_BYTES = 49152;
const HASH = /^[a-f0-9]{64}$/, TABLE = /^[BC][0-9]{5}[A-I]?$/, GEO = /^[0-9]{7}US[0-9A-Z]*$/;
const MAX_TOTAL = 128 * 1024 * 1024;
const fail = (code, message) => { throw fault(code, message); };
const same = (a, b) => identity(a) === identity(b);
const sorted = values => [...values].sort();
const exactly = (value, keys) => object(value) && same(sorted(Object.keys(value)), sorted(keys));
const json = data => {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)); }
  catch { fail('CENSUS_JSON_INVALID'); }
};
export function safeMember(value, allowManifest = false) {
  if (typeof value !== 'string' || !value || value.length > 600 || /[\\:\x00-\x1f\x7f]/.test(value) ||
      value.split('/').some(part => ['', '.', '..'].includes(part)) ||
      value.startsWith('_census/') && !(allowManifest && value === MANIFEST_PATH))
    fail('CENSUS_MEMBER_PATH_INVALID');
  return value;
}
async function memberPath(root, path) {
  safeMember(path, true);
  const result = join(root, path);
  if (await realpath(result) !== result) fail('CENSUS_MEMBER_SYMLINK');
  return result;
}
function select(value, pattern, code) {
  if (!Array.isArray(value) || !value.length || new Set(value).size !== value.length ||
      value.some(item => typeof item !== 'string' || !pattern.test(item))) fail(code);
  return sorted(value);
}
function checkManifest(value) {
  if (!object(value) || value.schema !== CAPTURE_SCHEMA || !Number.isSafeInteger(value.year) ||
      value.year < 2018 || !same(value.period, { start: value.year - 4, end: value.year }) ||
      typeof value.source_prefix !== 'string' || value.source_prefix && !value.source_prefix.endsWith('/'))
    fail('CENSUS_CAPTURE_INVALID');
  if (value.source_prefix) safeMember(value.source_prefix.slice(0, -1));
  select(value.tables, TABLE, 'CENSUS_TABLE_SELECTION_INVALID');
  select(value.geography_ids, GEO, 'CENSUS_GEOGRAPHY_SELECTION_INVALID');
  if (!Array.isArray(value.files) || !value.files.length || value.files.length > 20000 ||
      new Set(value.files.map(item => item.path)).size !== value.files.length) fail('CENSUS_FILE_INVENTORY_INVALID');
  let total = 0;
  for (const file of value.files) {
    if (!exactly(file, ['path', 'bytes', 'sha256']) || !HASH.test(file.sha256) ||
        !Number.isSafeInteger(file.bytes) || file.bytes < 0) fail('CENSUS_FILE_INVENTORY_INVALID');
    safeMember(file.path); total += file.bytes;
  }
  if (total > MAX_TOTAL) fail('CENSUS_CAPTURE_TOO_LARGE');
  if (!Array.isArray(value.annotations)) fail('CENSUS_ANNOTATIONS_INVALID');
  for (const annotation of value.annotations) {
    if (!object(annotation) || annotation.year !== value.year || !HASH.test(annotation.sha256))
      fail('CENSUS_ANNOTATIONS_INVALID');
    safeMember(annotation.path);
    let url; try { url = new URL(annotation.source_url); } catch { fail('CENSUS_ANNOTATION_SOURCE_INVALID'); }
    if (url.protocol !== 'https:' || !['www.census.gov', 'www2.census.gov'].includes(url.hostname) ||
        url.username || url.password) fail('CENSUS_ANNOTATION_SOURCE_INVALID');
    if (annotation.receipt_path !== undefined) safeMember(annotation.receipt_path);
    if (annotation.normalized_path !== undefined) safeMember(annotation.normalized_path);
  }
  return value;
}

/** Source JSON contains a retained public manifest reference, never an endpoint
 * selected by HTTP. Every declared byte is checked before a plan or extraction. */
export async function readCensusSource(sourceFile, { verifyFiles = true } = {}) {
  sourceFile = resolve(sourceFile);
  const original = await readPrivate(sourceFile, 262144), declaration = json(original);
  if (!exactly(declaration, ['schema', 'capture', 'captureSha256']) || declaration.schema !== SOURCE_SCHEMA ||
      ![MANIFEST_PATH, 'capture/' + MANIFEST_PATH].includes(declaration.capture) || !HASH.test(declaration.captureSha256)) fail('CENSUS_SOURCE_INVALID');
  const root = declaration.capture.startsWith('capture/') ? join(dirname(sourceFile), 'capture') : dirname(sourceFile);
  if (await realpath(root) !== root) fail('CENSUS_SOURCE_DIRECTORY_SYMLINK');
  const manifestPath = await memberPath(root, MANIFEST_PATH);
  const manifestBytes = await readPrivate(manifestPath, 8 * 1024 * 1024);
  if (digest(manifestBytes) !== declaration.captureSha256) fail('CENSUS_CAPTURE_MANIFEST_CHANGED');
  const manifest = checkManifest(json(manifestBytes));
  const files = new Map(manifest.files.map(file => [file.path, file]));
  const required = [manifest.source_prefix + 'geographies.txt', manifest.source_prefix + 'geographies.capture.json',
    manifest.source_prefix + 'table-shells.txt', manifest.source_prefix + 'table-shells.capture.json',
    ...manifest.tables.flatMap(table => [manifest.source_prefix + 'table-' + table + '.txt',
      manifest.source_prefix + 'table-' + table + '.capture.json'])];
  if (required.some(path => !files.has(path))) fail('CENSUS_REQUIRED_SOURCE_MEMBER_MISSING');
  for (const annotation of manifest.annotations) {
    if (files.get(annotation.path)?.sha256 !== annotation.sha256 ||
        annotation.receipt_path && !files.has(annotation.receipt_path) ||
        annotation.normalized_path && !files.has(annotation.normalized_path))
      fail('CENSUS_ANNOTATION_MEMBER_MISSING');
  }
  async function read(path) {
    if (path === MANIFEST_PATH) return Buffer.from(manifestBytes);
    const expected = files.get(path);
    if (!expected) fail('CENSUS_UNDECLARED_SOURCE_MEMBER');
    const data = await readPrivate(await memberPath(root, path), MAX_TOTAL);
    if (data.length !== expected.bytes || digest(data) !== expected.sha256) fail('CENSUS_SOURCE_FILE_CHANGED');
    return data;
  }
  if (verifyFiles) for (const expected of manifest.files) {
    const actual = await hashPrivate(await memberPath(root, expected.path), MAX_TOTAL);
    if (actual.hash !== expected.sha256 || actual.bytes !== expected.bytes) fail('CENSUS_SOURCE_FILE_CHANGED');
  }
  return { sourceFile, original, declaration, root, manifest, manifestBytes, files,
    hash: digest(original), captureHash: declaration.captureSha256, read };
}

const string = { type: 'string', nullable: false }, integer = { type: 'integer', nullable: false };
const number = { type: 'number', nullable: true }, optionalInteger = { type: 'integer', nullable: true };
export const OBSERVATION_COLUMNS = Object.freeze({
  capture_id: string, release_year: integer, period_start: integer, period_end: integer,
  dataset_id: string, observation_id: string, table_id: string, indicator_id: string,
  estimate_variable: string, moe_variable: string,
  geo_id: string, geography_name: string, summary_level: string,
  state_fips: string, county_fips: string, place_fips: string,
  table_title: string, universe: string, label: string, label_path: string, source_type: string,
  estimate_raw: string, moe_raw: string, estimate: number, moe: number,
  estimate_status: string, moe_status: string, confidence_level: integer,
  bound_kind: string, bound_value: number, bound_label: string, bound_status: string,
  bound_source_year: optionalInteger, bound_source_path: string, bound_source_sha256: string, bound_source_cell: string,
  source_file: string, source_sha256: string, source_row_sha256: string, source_line: integer,
  estimate_column: string, moe_column: string, selection_receipt: string, source_url: string, retrieved_at: string,
});
export const SOURCE_FILE_COLUMNS = Object.freeze({
  release_year: integer, period_start: integer, period_end: integer, capture_id: string,
  path: string, file_sha256: string, file_bytes: integer, chunk_index: integer, chunk_count: integer,
  chunk_sha256: string, content_base64: string,
});
export const CENSUS_COLUMNS = Object.freeze({ observations: OBSERVATION_COLUMNS, source_files: SOURCE_FILE_COLUMNS });
export const columnTypes = query => {
  const columns = CENSUS_COLUMNS[query];
  if (!Object.hasOwn(CENSUS_COLUMNS, query)) fail('CENSUS_QUERY_NOT_FOUND');
  return Object.entries(columns).map(([name, spec]) => ({ name, ...spec }));
};
export function queryDefinitions(capture) {
  const m = capture.manifest;
  const serviceQuery = { protocol: 'Census ACS table-based Summary File', year: m.year,
    period: m.period, tables: m.tables, geographies: m.geography_ids,
    sourceHash: capture.captureHash, selectionHash: identity({ tables: m.tables, geographies: m.geography_ids }) };
  return Object.fromEntries(Object.keys(CENSUS_COLUMNS).map(query => [query, {
    serviceQuery: { ...serviceQuery, projection: query }, columns: Object.keys(CENSUS_COLUMNS[query]),
    columnTypes: columnTypes(query), parameters: {},
  }]));
}
export async function inspectCensusPublicationSource(sourceFile) {
  const capture = await readCensusSource(sourceFile);
  return { hash: capture.hash, bytes: capture.original.length, captureHash: capture.captureHash,
    queries: queryDefinitions(capture) };
}

function pipeRows(data) {
  const result = []; let start = 0, line = 0, header;
  const consume = raw => {
    line++;
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(raw); } catch { fail('CENSUS_UTF8_INVALID'); }
    text = text.replace(/\r?\n$/, '');
    const cells = text.split('|');
    if (!header) {
      cells[0] = cells[0].replace(/^\uFEFF/, '');
      if (new Set(cells).size !== cells.length || cells.some(name => !name)) fail('CENSUS_HEADER_INVALID');
      header = cells; return;
    }
    if (cells.length !== header.length) fail('CENSUS_ROW_WIDTH_INVALID');
    result.push({ values: Object.fromEntries(header.map((key, index) => [key, cells[index]])),
      line, rawHash: digest(raw) });
  };
  for (let i = 0; i < data.length; i++) if (data[i] === 10) {
    consume(data.subarray(start, i + 1)); start = i + 1;
  }
  if (start < data.length) consume(data.subarray(start));
  if (!header) fail('CENSUS_HEADER_REQUIRED');
  return { header, rows: result };
}
async function retainedRows(capture, name, { ids, key, unique }) {
  const path = capture.manifest.source_prefix + name + '.txt', raw = await capture.read(path);
  const receiptPath = capture.manifest.source_prefix + name + '.capture.json';
  const receipt = json(await capture.read(receiptPath));
  if (receipt.status !== 200 || receipt.complete_for_requested_ids !== true ||
      receipt.selected_sha256 !== digest(raw) || receipt.selected_bytes !== raw.length ||
      !Array.isArray(receipt.requested_ids) || !same(sorted(receipt.requested_ids), sorted(ids)) ||
      !HASH.test(receipt.stream_sha256 ?? '') || !Number.isSafeInteger(receipt.stream_bytes_read))
    fail('CENSUS_SELECTION_RECEIPT_INVALID');
  const base = 'https://www2.census.gov/programs-surveys/acs/summary_file/' + capture.manifest.year + '/table-based-SF/';
  const expectedURL = base + (name === 'table-shells' ? 'documentation/ACS' + capture.manifest.year + '5YR_Table_Shells.txt' :
    name === 'geographies' ? 'documentation/Geos' + capture.manifest.year + '5YR.txt' :
      'data/5YRData/acsdt5y' + capture.manifest.year + '-' + name.slice(6).toLowerCase() + '.dat');
  if (receipt.url !== expectedURL || receipt.resolved_url !== expectedURL) fail('CENSUS_RELEASE_SOURCE_CHANGED');
  const parsed = pipeRows(raw);
  if (!parsed.header.includes(key)) fail('CENSUS_SELECTION_COLUMN_MISSING');
  const values = parsed.rows.map(row => row.values[key]);
  if (unique && new Set(values).size !== values.length || !same(sorted(new Set(values)), sorted(ids)) ||
      receipt.retained_rows !== parsed.rows.length) fail('CENSUS_SELECTION_INCOMPLETE');
  return { ...parsed, path, receiptPath, receipt, hash: digest(raw) };
}

const ESTIMATE_SPECIAL = new Map([
  ['-666666666', 'insufficient_sample'], ['-888888888', 'not_applicable'], ['-999999999', 'suppressed'],
]);
const MOE_SPECIAL = new Map([
  ['-222222222', 'insufficient_sample'], ['-333333333', 'open_interval'], ['-555555555', 'controlled'],
  ['-888888888', 'not_applicable'], ['-999999999', 'suppressed'],
]);
export function normalizeScalar(raw, kind, sourceType = 'int') {
  const token = raw.trim();
  if (!token || ['null', 'None'].includes(token)) return { value: null, status: 'missing' };
  const special = (kind === 'moe' ? MOE_SPECIAL : ESTIMATE_SPECIAL).get(token);
  if (special) return { value: null, status: special };
  if (!/^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/.test(token))
    return { value: null, status: 'annotated' };
  const value = Number(token);
  if (!Number.isFinite(value) || kind === 'moe' && value < 0) return { value: null, status: 'invalid_source_value' };
  if (Math.abs(value) > Number.MAX_SAFE_INTEGER || sourceType === 'int' && !Number.isSafeInteger(value))
    return { value: null, status: 'precision_loss' };
  return { value, status: 'reported' };
}

async function annotationRules(capture) {
  const rules = new Map();
  for (const annotation of capture.manifest.annotations) {
    if (!annotation.normalized_path) continue;
    const normalized = json(await capture.read(annotation.normalized_path));
    if (normalized.schema !== 'stellar-forge.census-acs-annotations.v1' ||
        normalized.year !== annotation.year || normalized.workbook_sha256 !== annotation.sha256 ||
        normalized.workbook_path !== annotation.path || !Array.isArray(normalized.bounds))
      fail('CENSUS_ANNOTATION_MAPPING_INVALID');
    for (const row of normalized.bounds) {
      if (!object(row) || typeof row.indicator_id !== 'string' || typeof row.raw !== 'string' ||
          !['lt', 'lte', 'gte', 'gt'].includes(row.kind) || !Number.isFinite(row.value) ||
          typeof row.label !== 'string' || typeof row.cell !== 'string') fail('CENSUS_BOUND_MAPPING_INVALID');
      const key = row.indicator_id + ':' + row.raw;
      if (rules.has(key)) fail('CENSUS_BOUND_MAPPING_DUPLICATE');
      rules.set(key, { ...row, source_year: annotation.year, source_path: annotation.path, sha256: annotation.sha256 });
    }
  }
  return rules;
}

async function* observations(capture) {
  const m = capture.manifest;
  const geographies = await retainedRows(capture, 'geographies', { ids: m.geography_ids, key: 'GEO_ID', unique: true });
  if (['GEO_ID', 'NAME', 'SUMLEVEL', 'STATE', 'COUNTY', 'PLACE'].some(key => !geographies.header.includes(key))) fail('CENSUS_GEOGRAPHY_HEADER_INVALID');
  const byGeo = new Map(geographies.rows.map(row => [row.values.GEO_ID, row.values]));
  const shells = await retainedRows(capture, 'table-shells', { ids: m.tables, key: 'Table ID', unique: false });
  if (['Table ID', 'Unique ID', 'Indent', 'Label', 'Title', 'Universe', 'Type'].some(key => !shells.header.includes(key))) fail('CENSUS_TABLE_SHELL_HEADER_INVALID');
  const labels = new Map(), stacks = new Map();
  for (const record of shells.rows) {
    const row = record.values, table = row['Table ID'];
    if (!Number.isInteger(Number(row.Indent)) || Number(row.Indent) < 0 || Number(row.Indent) > 20)
      fail('CENSUS_TABLE_SHELL_INDENT_INVALID');
    const stack = stacks.get(table) ?? []; stack.length = Number(row.Indent); stack.push(row.Label);
    stacks.set(table, stack);
    if (!row['Unique ID']) continue;
    if (labels.has(row['Unique ID'])) fail('CENSUS_TABLE_SHELL_ID_DUPLICATE');
    labels.set(row['Unique ID'], { ...row, labelPath: stack.filter(Boolean).join(' > ') });
  }
  const bounds = await annotationRules(capture);
  for (const table of sorted(m.tables)) {
    const data = await retainedRows(capture, 'table-' + table, { ids: m.geography_ids, key: 'GEO_ID', unique: true });
    const fields = data.header.filter(name => name !== 'GEO_ID'), pairs = [];
    for (const field of fields) {
      const match = new RegExp('^' + table + '_([EM])([0-9]{3})$').exec(field);
      if (!match) fail('CENSUS_ESTIMATE_MOE_COLUMN_INVALID');
      if (match[1] === 'E') {
        const indicator = table + '_' + match[2], moeColumn = table + '_M' + match[2];
        if (!data.header.includes(moeColumn) || !labels.has(indicator)) fail('CENSUS_ESTIMATE_MOE_PAIR_MISSING');
        pairs.push({ indicator, estimateColumn: field, moeColumn, metadata: labels.get(indicator) });
      } else if (!data.header.includes(table + '_E' + match[2])) fail('CENSUS_ESTIMATE_MOE_PAIR_MISSING');
    }
    if (!pairs.length || pairs.length * 2 !== fields.length) fail('CENSUS_ESTIMATE_MOE_PAIR_INVALID');
    const dataset = 'census-acs5-' + m.year + '-' + table.toLowerCase() + '-' + data.hash.slice(0, 16);
    for (const row of data.rows) for (const pair of pairs) {
      const values = row.values, geo = byGeo.get(values.GEO_ID), meta = pair.metadata;
      const estimateRaw = values[pair.estimateColumn], moeRaw = values[pair.moeColumn];
      let estimate = normalizeScalar(estimateRaw, 'estimate', meta.Type);
      const moe = normalizeScalar(moeRaw, 'moe', meta.Type);
      let bound = null, boundStatus = '';
      if (moe.status === 'open_interval') {
        estimate = { value: null, status: 'open_interval' };
        bound = bounds.get(pair.indicator + ':' + estimateRaw.trim()) ?? null;
        boundStatus = bound ? 'resolved' : 'unresolved_bound';
      }
      yield {
        capture_id: capture.captureHash, release_year: m.year, period_start: m.period.start, period_end: m.period.end,
        dataset_id: dataset, observation_id: dataset + ':' + values.GEO_ID + ':' + pair.indicator,
        table_id: table, indicator_id: pair.indicator, estimate_variable: pair.estimateColumn, moe_variable: pair.moeColumn,
        geo_id: values.GEO_ID, geography_name: geo.NAME, summary_level: geo.SUMLEVEL,
        state_fips: geo.STATE, county_fips: geo.COUNTY, place_fips: geo.PLACE,
        table_title: meta.Title, universe: meta.Universe, label: meta.Label, label_path: meta.labelPath, source_type: meta.Type,
        estimate_raw: estimateRaw, moe_raw: moeRaw, estimate: estimate.value, moe: moe.value,
        estimate_status: estimate.status, moe_status: moe.status, confidence_level: 90,
        bound_kind: bound?.kind ?? '', bound_value: bound?.value ?? null, bound_label: bound?.label ?? '',
        bound_status: boundStatus, bound_source_year: bound?.source_year ?? null, bound_source_path: bound?.source_path ?? '',
        bound_source_sha256: bound?.sha256 ?? '', bound_source_cell: bound?.cell ?? '',
        source_file: data.path, source_sha256: data.hash, source_row_sha256: row.rawHash, source_line: row.line,
        estimate_column: pair.estimateColumn, moe_column: pair.moeColumn, selection_receipt: data.receiptPath,
        source_url: data.receipt.url, retrieved_at: data.receipt.retrieved_at,
      };
    }
  }
}
async function* sourceFiles(capture) {
  const m = capture.manifest;
  const members = [...m.files, { path: MANIFEST_PATH, sha256: capture.captureHash, bytes: capture.manifestBytes.length }]
    .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  for (const member of members) {
    const data = await capture.read(member.path), count = Math.max(1, Math.ceil(data.length / CHUNK_BYTES));
    for (let index = 0; index < count; index++) {
      const chunk = data.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES);
      yield { release_year: m.year, period_start: m.period.start, period_end: m.period.end,
        capture_id: capture.captureHash, path: member.path, file_sha256: member.sha256, file_bytes: data.length,
        chunk_index: index, chunk_count: count, chunk_sha256: digest(chunk), content_base64: chunk.toString('base64') };
    }
  }
}
export function extractionOptions(query, supplied = {}) {
  if (!Object.hasOwn(CENSUS_COLUMNS, query) || !object(supplied) ||
      Object.keys(supplied).some(key => !['maxRows', 'maxBytes', 'maxRowBytes', 'timeoutMs', 'order'].includes(key)))
    fail('CENSUS_EXTRACTION_OPTIONS_INVALID');
  const limits = { maxRows: supplied.maxRows ?? 250000, maxBytes: supplied.maxBytes ?? 67108864,
    maxRowBytes: supplied.maxRowBytes ?? 1048576, timeoutMs: supplied.timeoutMs ?? 120000 };
  for (const [key, maximum] of [['maxRows', 1000000], ['maxBytes', 268435456],
    ['maxRowBytes', 4194304], ['timeoutMs', 3600000]])
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > maximum) fail('CENSUS_EXTRACTION_LIMIT_INVALID');
  // Source order is deterministic and retains original row addresses. Sorting is
  // offered by the original dataset reader after immutable publication.
  const first = Object.keys(CENSUS_COLUMNS[query])[0];
  const order = supplied.order ?? [{ column: first, direction: 'asc' }];
  if (!Array.isArray(order) || order.length !== 1 || order[0].column !== first || order[0].direction !== 'asc')
    fail('CENSUS_SOURCE_ORDER_REQUIRED', 'Keep the displayed source order; select dataset sort columns for customer queries.');
  return { ...limits, order };
}
export async function openCensusSourceFile(sourceFile) {
  const capture = await readCensusSource(sourceFile);
  let closed = false;
  const source = Object.freeze({
    inspect: () => ({ columnTypes: Object.fromEntries(Object.keys(CENSUS_COLUMNS).map(query => [query, columnTypes(query)])) }),
    async exportDataset(query, input = {}, options = {}) {
      if (closed) fail('CENSUS_SOURCE_CLOSED');
      if (!exactly(input, [])) fail('CENSUS_SELECTION_IS_CAPTURED');
      const limits = extractionOptions(query, Object.fromEntries(Object.entries(options).filter(([key]) =>
        !['signal', 'onRow'].includes(key))));
      if (typeof options.onRow !== 'function') fail('CENSUS_ROW_CONSUMER_REQUIRED');
      const started = Date.now(); let rowCount = 0, sourceRowBytes = 0;
      const types = columnTypes(query);
      for await (const row of query === 'observations' ? observations(capture) : sourceFiles(capture)) {
        if (closed || options.signal?.aborted) fail('CENSUS_EXTRACTION_CANCELLED');
        if (Date.now() - started > limits.timeoutMs) fail('CENSUS_EXTRACTION_TIMEOUT');
        const size = Buffer.byteLength(JSON.stringify(row)); sourceRowBytes += size;
        if (size > limits.maxRowBytes) fail('CENSUS_ROW_TOO_LARGE');
        if (++rowCount > limits.maxRows) fail('DATASET_EXTRACTION_TOO_MANY_ROWS');
        await options.onRow(row, types, { rowCount });
      }
      // Check the complete source after streaming, before the original publisher
      // can create its reviewed candidate.
      const after = await readCensusSource(sourceFile);
      if (after.captureHash !== capture.captureHash || after.hash !== capture.hash) fail('CENSUS_SOURCE_CHANGED_DURING_EXTRACTION');
      return { schema: 'stellar-forge.census-acs-extraction.v1', projection: query,
        captureHash: capture.captureHash, sourceHash: capture.hash, releaseYear: capture.manifest.year,
        period: capture.manifest.period, sourceFiles: capture.manifest.files.length,
        completeSelection: true, sourceVerified: true, rowCount, sourceRowBytes, columnTypes: types,
        sourceOrder: query === 'observations' ? 'table-id,original-row,original-variable' : 'member-path,chunk-index',
        confidenceLevel: 90, rawValuesPreserved: true };
    },
    async close() { closed = true; },
  });
  return { source, config: capture.declaration };
}
