// MIT. Retained Socrata captures and dataset editions using the original SF30 engine.
import { mkdir, readFile, writeFile, rename, link, unlink, open, lstat, realpath, readdir, copyFile } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { resolve, dirname, basename, relative, isAbsolute, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createGzip, createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { once } from 'node:events';
import { loadDatasetConfig } from '../dataset-handler.mjs';
import { buildDatasetSellerConfig, datasetQueryParameters } from '../dataset-cli.mjs';
import { createSocrataClient, normalizeSource, metadataSummary, parseRows, sourceJSON, isSourceNumber,
  sameRevision, sha256, stable, json, plain, fail, integer } from './source.mjs';

const SCHEMA = 'stellar-forge.socrata-workspace.v1';
const CAPTURE = 'stellar-forge.socrata-capture.v1';
const PACKAGE = 'stellar-forge.socrata-package.v1';
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/;
const HASH = /^[a-f0-9]{64}$/;
const RESERVED = new Set(['constructor', 'prototype', '__proto__']);
const now = () => new Date().toISOString();
const id = prefix => prefix + '-' + randomUUID();
const exists = async path => { try { await lstat(path); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
function safeRelative(path) {
  if (typeof path !== 'string' || path.length > 500 || isAbsolute(path) || path.includes('\\') ||
      path.split('/').some(part => !part || part === '.' || part === '..') || /[\x00-\x1f\x7f]/.test(path))
    throw fail('SOCRATA_PATH', 'The retained file path is invalid.');
  return path;
}
function inside(root, path) { return resolve(root, safeRelative(path)); }
async function bytesAt(root, path, maxBytes = 256 * 1024 * 1024) {
  const full = inside(root, path), actual = await realpath(full), rel = relative(await realpath(root), actual);
  if (rel.startsWith('..' + sep) || rel === '..' || isAbsolute(rel)) throw fail('SOCRATA_PATH', 'A retained file leaves its workspace.');
  const info = await lstat(full);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maxBytes) throw fail('SOCRATA_FILE', 'Expected a regular retained file within the configured byte limit.');
  const bytes = await readFile(full);
  if (bytes.length > maxBytes) throw fail('SOCRATA_FILE', 'Retained file exceeds its byte limit.');
  return bytes;
}
async function jsonAt(root, path, maxBytes) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await bytesAt(root, path, maxBytes))); }
  catch (error) { if (error.code?.startsWith('SOCRATA_')) throw error; throw fail('SOCRATA_JSON', 'A retained JSON file could not be read.'); }
}
async function stagedWrite(path, value, commit) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = path + '.' + randomUUID() + '.tmp';
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(typeof value === 'string' || Buffer.isBuffer(value) ? value : json(value));
    await handle.sync(); await handle.close(); handle = null;
    await commit(temporary);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
async function atomic(path, value) {
  await stagedWrite(path, value, temporary => rename(temporary, path));
}
async function immutable(root, path, bytes) {
  const full = inside(root, path);
  try { await stagedWrite(full, bytes, temporary => link(temporary, full)); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (sha256(await bytesAt(root, path)) !== sha256(bytes)) throw fail('SOCRATA_RETAINED_CONFLICT', 'A retained artifact has different bytes.', 409);
  }
  return { file: path, bytes: bytes.length, sha256: sha256(bytes) };
}
const receiptOnly = receipt => ({ url: receipt.url, request: receipt.request,
  receivedAt: receipt.receivedAt, headers: receipt.headers, sha256: receipt.sha256, bytes: receipt.bytes.length });
function validMapping(raw) {
  if (!plain(raw) || typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 128 || /[\x00-\x1f\x7f]/.test(raw.name))
    throw fail('SOCRATA_MAPPING', 'Choose a printable dataset name up to 128 characters.');
  if (!Array.isArray(raw.columns) || !raw.columns.length || raw.columns.length > 64)
    throw fail('SOCRATA_MAPPING', 'Select between one and 64 output columns.');
  const columns = raw.columns.map(column => {
    if (!plain(column) || typeof column.source !== 'string' || !column.source || column.source.length > 256 ||
        !NAME.test(column.name ?? '') || RESERVED.has(column.name) || !['string', 'integer', 'number', 'boolean'].includes(column.type) ||
        (column.nullable !== undefined && typeof column.nullable !== 'boolean'))
      throw fail('SOCRATA_MAPPING', 'Each output needs a source field, unique native column name, explicit type, and null policy.');
    const nullable = column.nullable ?? false;
    const nullPolicy = column.nullPolicy ?? (nullable ? 'empty-is-null' : 'reject-null');
    if (!['empty-is-null', 'reject-null', 'literal-json'].includes(nullPolicy) ||
        (nullPolicy === 'empty-is-null' && !nullable) ||
        (nullPolicy === 'literal-json' && (column.type !== 'string' || nullable)))
      throw fail('SOCRATA_MAPPING', 'Empty-as-null requires nullable; literal JSON requires a nonnullable string output.');
    return { source: column.source, name: column.name, type: column.type, nullable, nullPolicy };
  });
  const names = new Set(columns.map(column => column.name));
  if (names.size !== columns.length) throw fail('SOCRATA_MAPPING', 'Output names must be unique.');
  const pick = (label, max = 8) => {
    const keys = raw[label] ?? [];
    if (!Array.isArray(keys) || keys.length > max || new Set(keys).size !== keys.length || keys.some(key => !names.has(key)))
      throw fail('SOCRATA_MAPPING', label + ' must be a unique selection of output names.');
    return [...keys];
  };
  const filters = pick('filters'), ranges = pick('ranges'), sorts = pick('sorts'), idColumns = pick('idColumns', 16);
  if (ranges.some(name => columns.find(column => column.name === name).type === 'boolean'))
    throw fail('SOCRATA_MAPPING', 'Boolean columns do not support native ranges.');
  if (3 + filters.length + 4 * ranges.length + (sorts.length ? 1 : 0) > 32)
    throw fail('SOCRATA_MAPPING', 'These capabilities exceed the native 32 query-parameter limit. Reduce the filter or range selection.');
  const maxPageSize = integer(raw.maxPageSize ?? 250, 'maxPageSize', 1, 1000);
  return { name: raw.name, columns, filters, ranges, sorts, idColumns,
    pageSize: integer(raw.pageSize ?? 50, 'pageSize', 1, maxPageSize), maxPageSize };
}
function mappedValue(value, column, rowNumber) {
  const label = 'Row ' + rowNumber + ', ' + column.name;
  if (column.nullPolicy === 'literal-json') return sourceJSON(value ?? null);
  if (value === undefined || value === null) {
    if (column.nullPolicy === 'empty-is-null') return null;
    throw fail('SOCRATA_NULL', label + ' is missing. Choose nullable empty-as-null or literal JSON.');
  }
  const text = isSourceNumber(value) ? value.text : typeof value === 'string' ? value :
    typeof value === 'boolean' ? String(value) : null;
  if (text === null) throw fail('SOCRATA_COMPLEX_VALUE', label + ' is structured. Choose a string with the literal JSON policy.');
  if (text === '' && column.nullable) {
    if (column.nullPolicy === 'empty-is-null') return null;
    throw fail('SOCRATA_EMPTY_VALUE', label + ' is empty and the native nullable CSV type treats empty cells as null.');
  }
  if (column.type === 'string') return text;
  if (column.type === 'boolean' && (text === 'true' || text === 'false')) return text === 'true';
  if (column.type === 'integer' && /^-?(0|[1-9][0-9]*)$/.test(text) && Number.isSafeInteger(Number(text))) return Number(text);
  if (column.type === 'number' && /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/.test(text) && Number.isFinite(Number(text))) return Number(text);
  throw fail('SOCRATA_TYPE', label + ' cannot be represented as ' + column.type + '. Keep precise identifiers or decimal values as strings.');
}
const csvCell = value => { const text = value === null ? '' : String(value); return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text; };
function rowIndex(rows, mapping) {
  const index = new Map();
  for (const row of rows) {
    const digest = sha256(stable(row));
    const key = mapping.idColumns.length ? stable(mapping.idColumns.map(name => {
      if (row[name] === null) throw fail('SOCRATA_ROW_KEY', 'Identity columns contain null. Select complete keys or use row-content comparison.');
      return row[name];
    })) : digest;
    if (mapping.idColumns.length && index.has(key)) throw fail('SOCRATA_ROW_KEY', 'Identity columns repeat in this capture. Add a distinguishing column or use row-content comparison.');
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(digest);
  }
  return Object.fromEntries([...index].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}
function compareIndex(previous, current, keyed) {
  if (!previous) return { added: Object.values(current).reduce((n, values) => n + values.length, 0), removed: 0, changed: 0, unchanged: 0 };
  let added = 0, removed = 0, changed = 0, unchanged = 0;
  for (const key of new Set([...Object.keys(previous), ...Object.keys(current)])) {
    const old = previous[key] ?? [], next = current[key] ?? [];
    if (keyed && old.length && next.length) { if (old[0] === next[0]) unchanged++; else changed++; }
    else { unchanged += Math.min(old.length, next.length); added += Math.max(0, next.length - old.length); removed += Math.max(0, old.length - next.length); }
  }
  return { added, removed, changed, unchanged };
}

export async function openSocrataWorkspace({ directory, appToken, fetcher } = {}) {
  if (typeof directory !== 'string' || !directory) throw fail('SOCRATA_DIRECTORY', 'Choose a private workspace directory.');
  directory = resolve(directory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  // The kernel releases this SQLite writer lease on process exit, including when
  // PID namespaces differ. There is no PID-file ownership or guessed stale lock.
  const lease = new DatabaseSync(resolve(directory, 'operator-lease.sqlite'));
  try {
    lease.exec('PRAGMA busy_timeout=250; CREATE TABLE IF NOT EXISTS holder (id INTEGER PRIMARY KEY, started TEXT); BEGIN IMMEDIATE;');
    lease.prepare('INSERT OR REPLACE INTO holder (id,started) VALUES (1,?)').run(now());
  } catch (error) {
    lease.close();
    if ([5,6].includes(error.errcode) || /database is (locked|busy)/i.test(error.message))
      throw fail('SOCRATA_WORKSPACE_BUSY', 'This workspace is open in another operator process. Use its existing session or close it first.', 409);
    throw fail('SOCRATA_WORKSPACE_STORAGE', 'The workspace storage could not acquire its writer lease: ' + error.message, 500,
      { sqliteCode: error.code, sqliteErrcode: error.errcode });
  }
  let client;
  try { client = createSocrataClient({ appToken, fetcher }); }
  catch (error) { lease.exec('ROLLBACK'); lease.close(); throw error; }
  const statePath = resolve(directory, 'workspace.json');
  let state, closing = false, busy = false, tail = Promise.resolve(), datasetCache = null;
  try {
    state = await exists(statePath) ? await jsonAt(directory, 'workspace.json', 32 * 1024 * 1024) :
      { schema: SCHEMA, createdAt: now(), updatedAt: now(), source: null, metadata: null, captureId: null,
        captures: [], mapping: null, editions: [], activeEditionId: null, merchants: {}, queries: {}, exports: [], error: null };
    if (state.schema !== SCHEMA || !Array.isArray(state.captures) || !Array.isArray(state.editions) || !Array.isArray(state.exports) ||
        !plain(state.merchants)) throw fail('SOCRATA_WORKSPACE', 'The directory is not a supported Socrata workspace.');
    state.queries ??= {};
    if (!plain(state.queries)) throw fail('SOCRATA_WORKSPACE', 'The retained query history is invalid.');
    if (!(await exists(statePath))) await atomic(statePath, state);
  } catch (error) { lease.exec('ROLLBACK'); lease.close(); throw error; }
  const save = async () => { state.updatedAt = now(); await atomic(statePath, state); };
  const capture = () => state.captures.find(item => item.id === state.captureId) ?? null;
  const edition = () => state.editions.find(item => item.id === state.activeEditionId) ?? null;
  const publicState = () => structuredClone({ schema: state.schema, createdAt: state.createdAt, updatedAt: state.updatedAt,
    source: state.source, metadata: state.metadata, capture: capture(), mapping: state.mapping,
    captures: state.captures.map(({ pages, ...item }) => item), editions: state.editions,
    activeEditionId: state.activeEditionId, merchant: state.merchants[state.activeEditionId] ?? null,
    exports: state.exports, lastQuery: state.queries[state.activeEditionId] ?? null, busy, error: state.error });
  const serial = operation => {
    if (closing) return Promise.reject(fail('SOCRATA_CLOSED', 'The workspace is closing.', 409));
    const job = tail.then(async () => { busy = true; try { return await operation(); } finally { busy = false; } });
    tail = job.catch(() => {});
    return job;
  };
  async function storeReceipt(c, label, receipt) {
    const path = 'captures/' + c.id + '/' + label + '-' + receipt.sha256 + '.json';
    return { ...receiptOnly(receipt), ...await immutable(directory, path, receipt.bytes) };
  }
  async function nativeDataset() {
    const active = edition();
    if (!active) throw fail('SOCRATA_EDITION_REQUIRED', 'Build and activate a dataset edition first.', 409);
    if (datasetCache?.id === active.id) return datasetCache.dataset;
    const config = await jsonAt(directory, active.configFile, 65536);
    if (config.file !== 'dataset.csv') throw fail('SOCRATA_DATASET_CONFIG', 'The retained native dataset must use its adjacent dataset.csv.');
    const dataFile = dirname(active.configFile).replaceAll('\\', '/') + '/dataset.csv';
    if (sha256(await bytesAt(directory, dataFile)) !== active.sha256)
      throw fail('SOCRATA_EDITION_CHANGED', 'The retained dataset CSV changed. Restore its original exported bytes.', 409);
    const dataset = await loadDatasetConfig(inside(directory, active.configFile));
    datasetCache = { id: active.id, dataset };
    return dataset;
  }
  async function checkRevision(c) {
    const observed = await client.metadata(c.source);
    if (!sameRevision(c.revision, observed.summary.revision)) {
      c.status = 'changed'; c.error = { code: 'SOCRATA_SOURCE_CHANGED', message: 'The publisher revision changed. Keep this capture and start a new complete capture.', at: now() };
      c.changedMetadata = await storeReceipt(c, 'metadata-changed', observed);
      await save(); throw fail(c.error.code, c.error.message, 409);
    }
    return observed;
  }
  async function finalizeCapture(c) {
    const after = await checkRevision(c), count = await client.count(c.source);
    c.metadataAfter = await storeReceipt(c, 'metadata-after', after);
    c.countAfter = await storeReceipt(c, 'count-after', count);
    if (count.count !== c.expectedRows || c.rowCount !== c.expectedRows) {
      c.status = 'changed'; c.error = { code: 'SOCRATA_SOURCE_COUNT_CHANGED', message: 'The complete row count changed during capture. Start a new capture to avoid mixing revisions.', at: now() };
      await save(); throw fail(c.error.code, c.error.message, 409);
    }
    c.status = 'completed'; c.completedAt = now(); c.error = null;
    c.consistency = 'publisher-revision-and-selection-count-checked';
    await save(); return c;
  }

  async function importCapture(manifestPath) {
    if (typeof manifestPath !== 'string' || !manifestPath) throw fail('SOCRATA_IMPORT', 'Choose the retained capture manifest path.');
    const full = resolve(manifestPath), root = dirname(full);
    const imported = await jsonAt(root, basename(full), 16 * 1024 * 1024);
    if (imported.schema !== CAPTURE || imported.status !== 'completed' || !Array.isArray(imported.pages) ||
        !plain(imported.metadata) || !Array.isArray(imported.metadata.columns) || !plain(imported.revision) ||
        !HASH.test(imported.metadataBefore?.sha256 ?? '') || !HASH.test(imported.metadataAfter?.sha256 ?? ''))
      throw fail('SOCRATA_IMPORT', 'The capture manifest requires completed pages, source metadata, and before/after revision receipts.');
    if (imported.metadataBefore.sha256 !== imported.metadataAfter.sha256 &&
        !(plain(imported.revisionBefore) && plain(imported.revisionAfter) && sameRevision(imported.revisionBefore, imported.revisionAfter)))
      throw fail('SOCRATA_IMPORT_REVISION', 'The retained capture reports different publisher revisions.');
    const source = normalizeSource(imported.source, { retainOrder: true });
    const expectedRows = integer(imported.expectedRows, 'expectedRows', 0, source.maxRows);
    if (!imported.pages.length || imported.pages.length > source.maxRows + 1)
      throw fail('SOCRATA_IMPORT', 'The capture must contain its complete ordered page list.');
    const manifestSHA = sha256(await bytesAt(root, basename(full), 16 * 1024 * 1024));
    const found = state.captures.find(item => item.importManifestSha256 === manifestSHA);
    if (found) {
      state.source = found.source; state.metadata = found.metadata; state.captureId = found.id;
      await save(); return { capture: found, reused: true };
    }
    const c = { schema: CAPTURE, id: id('capture'), source, metadata: imported.metadata, revision: imported.revision,
      status: 'completed', createdAt: imported.createdAt ?? now(), completedAt: imported.completedAt ?? now(), importedAt: now(),
      expectedRows, rowCount: 0, pageCount: 0, nextOffset: 0, byteCount: 0, pages: [],
      metadataBefore: imported.metadataBefore, metadataAfter: imported.metadataAfter,
      countBefore: imported.countBefore ?? null, countAfter: imported.countAfter ?? null,
      consistency: 'retained-publisher-receipts-and-complete-pages', importManifestSha256: manifestSHA,
      provenance: imported.provenance ?? null, error: null };
    for (let index = 0; index < imported.pages.length; index++) {
      const page = imported.pages[index];
      if (!plain(page) || !HASH.test(page.sha256 ?? '') || page.offset !== c.nextOffset)
        throw fail('SOCRATA_IMPORT_PAGE', 'Retained pages must have exact hashes and contiguous offsets.');
      const pageURL = new URL(page.url);
      if (pageURL.protocol !== 'https:' || pageURL.hostname !== source.domain || pageURL.username || pageURL.password ||
          pageURL.port || pageURL.hash) throw fail('SOCRATA_IMPORT_SOURCE', 'A retained page belongs to another source.');
      if (source.protocol === 'soda2.1') {
        if (pageURL.pathname !== '/resource/' + source.datasetId + '.json' || (page.request?.method ?? 'GET') !== 'GET')
          throw fail('SOCRATA_IMPORT_SOURCE', 'A retained page does not match the selected SODA 2.1 endpoint.');
        const parameters = { ...Object.fromEntries(pageURL.searchParams), ...(page.request?.parameters ?? {}) };
        const expected = { '$where': source.where, '$order': source.order, '$limit': String(source.pageSize), '$offset': String(c.nextOffset) };
        for (const [key, value] of Object.entries(expected))
          if (String(parameters[key] ?? '') !== value) throw fail('SOCRATA_IMPORT_QUERY', 'A retained page has a different selection or paging request.');
        if (Object.keys(parameters).some(key => !Object.hasOwn(expected, key)))
          throw fail('SOCRATA_IMPORT_QUERY', 'The retained capture contains an unsupported extra query parameter.');
      } else {
        if (pageURL.pathname !== '/api/v3/views/' + source.datasetId + '/query.json' || page.request?.method !== 'POST')
          throw fail('SOCRATA_IMPORT_SOURCE', 'A retained page does not match the selected SODA 3 endpoint.');
        const expectedQuery = 'SELECT *' + (source.where ? ' WHERE ' + source.where : '') + ' ORDER BY ' + source.order;
        if (page.request.body?.query !== expectedQuery ||
            page.request.body?.page?.pageNumber !== Math.floor(c.nextOffset / source.pageSize) + 1 ||
            page.request.body?.page?.pageSize !== source.pageSize)
          throw fail('SOCRATA_IMPORT_QUERY', 'A retained SODA 3 page has a different query or page.');
      }
      const bytes = await bytesAt(root, page.file, source.maxBytes);
      if (bytes.length !== page.bytes || sha256(bytes) !== page.sha256) throw fail('SOCRATA_IMPORT_HASH', 'The retained page bytes do not match their source manifest.');
      const rows = parseRows(bytes);
      if (rows.length !== page.rowCount || rows.length > source.pageSize ||
          (index < imported.pages.length - 1 && rows.length !== source.pageSize))
        throw fail('SOCRATA_IMPORT_COUNT', 'The retained page row count or page boundary is incomplete.');
      c.rowCount += rows.length; c.byteCount += bytes.length;
      if (c.rowCount > expectedRows || c.byteCount > source.maxBytes) throw fail('SOCRATA_IMPORT_LIMIT', 'The capture exceeds its stated row or byte limit.');
      const artifact = await immutable(directory, 'captures/' + c.id + '/page-' + String(index).padStart(6, '0') + '-' + page.sha256 + '.json', bytes);
      c.pages.push({ ...page, ...artifact, index, rowCount: rows.length });
      c.nextOffset += rows.length; c.pageCount++;
    }
    if (c.rowCount !== expectedRows) throw fail('SOCRATA_IMPORT_COUNT', 'The retained pages do not contain the entire selected source count.');
    await immutable(directory, 'captures/' + c.id + '/import-manifest.json', await bytesAt(root, basename(full), 16 * 1024 * 1024));
    if (state.source && stable(state.source) !== stable(source)) { state.mapping = null; state.activeEditionId = null; datasetCache = null; }
    state.source = source; state.metadata = c.metadata; state.captures.push(c); state.captureId = c.id; state.error = null;
    await save(); return { capture: c, reused: false };
  }
  async function buildEdition() {
    const c = capture();
    if (c?.status !== 'completed') throw fail('SOCRATA_CAPTURE_REQUIRED', 'Complete or import the full source capture before building an edition.', 409);
    const mapping = validMapping(state.mapping);
    const rows = [], sourceFields = new Set();
    let rowNumber = 0;
    for (const page of c.pages) {
      const bytes = await bytesAt(directory, page.file, c.source.maxBytes);
      if (sha256(bytes) !== page.sha256 || bytes.length !== page.bytes)
        throw fail('SOCRATA_CAPTURE_CHANGED', 'The retained page bytes changed. Restore the original capture.', 409);
      const pageRows = parseRows(bytes);
      if (pageRows.length !== page.rowCount) throw fail('SOCRATA_CAPTURE_CHANGED', 'A retained page count changed.', 409);
      for (const sourceRow of pageRows) {
        rowNumber++;
        Object.keys(sourceRow).forEach(key => sourceFields.add(key));
        rows.push(Object.fromEntries(mapping.columns.map(column => [column.name, mappedValue(sourceRow[column.source], column, rowNumber)])));
      }
    }
    if (rowNumber !== c.rowCount) throw fail('SOCRATA_CAPTURE_CHANGED', 'The retained capture is incomplete.', 409);
    for (const column of mapping.columns) {
      if (rowNumber && !sourceFields.has(column.source)) throw fail('SOCRATA_MAPPING_FIELD', 'Source field "' + column.source + '" never occurs in this capture.');
      if (!rowNumber && !c.metadata.columns.some(field => field.fieldName === column.source))
        throw fail('SOCRATA_MAPPING_FIELD', 'Source field "' + column.source + '" is absent from the source schema.');
    }
    const csv = Buffer.from(mapping.columns.map(column => csvCell(column.name)).join(',') + '\r\n' +
      rows.map(row => mapping.columns.map(column => csvCell(row[column.name])).join(',')).join('\r\n') + (rows.length ? '\r\n' : ''));
    if (csv.length > 256 * 1024 * 1024) throw fail('SOCRATA_EDITION_LIMIT', 'The native dataset CSV exceeds 256 MiB.', 413);
    const mappingSHA = sha256(stable(mapping)), csvSHA = sha256(csv);
    const editionId = 'edition-' + sha256(stable({ capture: c.id, mappingSHA, csvSHA })).slice(0,32);
    const priorSame = state.editions.find(item => item.id === editionId);
    if (priorSame) { state.activeEditionId = priorSame.id; datasetCache = null; await save(); return { edition: priorSame, reused: true }; }
    const dir = 'editions/' + editionId;
    const columns = Object.fromEntries(mapping.columns.map(column => [column.name, { type: column.type, nullable: column.nullable }]));
    const config = { schema: 'stellar-forge.csv-dataset.v1', file: 'dataset.csv', name: mapping.name, columns,
      filters: mapping.filters, ranges: mapping.ranges, sorts: mapping.sorts,
      defaultLimit: mapping.pageSize, maxLimit: mapping.maxPageSize,
      maxRows: Math.max(1, rows.length), maxBytes: Math.max(1, csv.length) };
    const index = rowIndex(rows, mapping);
    const compatible = [...state.editions].reverse().find(item => item.mappingSha256 === mappingSHA &&
      item.sourceIdentity === sha256(stable({ domain: c.source.domain, datasetId: c.source.datasetId, where: c.source.where })));
    const previous = compatible ? await jsonAt(directory, compatible.indexFile, 256 * 1024 * 1024) : null;
    const changes = compareIndex(previous, index, mapping.idColumns.length > 0);
    await immutable(directory, dir + '/dataset.csv', csv);
    await immutable(directory, dir + '/dataset.json', Buffer.from(json(config)));
    await immutable(directory, dir + '/row-index.json', Buffer.from(json(index)));
    await immutable(directory, dir + '/mapping.json', Buffer.from(json(mapping)));
    const native = await loadDatasetConfig(inside(directory, dir + '/dataset.json'));
    const description = native.describe();
    const result = { id: editionId, captureId: c.id, createdAt: now(), rowCount: rows.length, sha256: csvSHA,
      snapshot: description.snapshot, mappingSha256: mappingSHA, configFile: dir + '/dataset.json',
      indexFile: dir + '/row-index.json', mappingFile: dir + '/mapping.json',
      sourceIdentity: sha256(stable({ domain: c.source.domain, datasetId: c.source.datasetId, where: c.source.where })),
      previousEditionId: compatible?.id ?? null, comparison: mapping.idColumns.length ? 'identity-columns' : 'row-content-multiset',
      changes, description };
    const provenance = { schema: 'stellar-forge.socrata-edition.v1', edition: result, source: c.source,
      metadata: c.metadata, revision: c.revision, consistency: c.consistency, sourceProvenance: c.provenance,
      metadataBefore: c.metadataBefore, metadataAfter: c.metadataAfter, pages: c.pages.map(page => ({ ...page })),
      mapping, definitions: c.metadata.columns, exactCSV: { bytes: csv.length, sha256: csvSHA } };
    await immutable(directory, dir + '/source.json', Buffer.from(json(provenance)));
    state.editions.push(result); state.activeEditionId = result.id; datasetCache = { id: result.id, dataset: native };
    await save(); return { edition: result, dataset: description, queryParameters: datasetQueryParameters(description),
      preview: native.handle({ query: { limit: String(Math.min(5, mapping.maxPageSize)) } }).body, reused: false };
  }
  async function dispatch(action, input) {
    switch (action) {
      case 'source.configure': {
        const source = normalizeSource(input);
        if (capture()?.status === 'running') throw fail('SOCRATA_CAPTURE_ACTIVE', 'Pause the active capture before changing its source.', 409);
        if (!state.source || stable(state.source) !== stable(source)) {
          state.source = source; state.metadata = null; state.captureId = null; state.mapping = null;
          state.activeEditionId = null; datasetCache = null;
        }
        await save(); return { source: state.source };
      }
      case 'source.search': return client.search({ ...input, domain: input.domain ?? state.source?.domain });
      case 'source.inspect': {
        if (!state.source) throw fail('SOCRATA_SOURCE_REQUIRED', 'Configure a source first.', 409);
        const metadata = await client.metadata(state.source), count = await client.count(state.source);
        state.metadata = metadata.summary; await save();
        return { metadata: metadata.summary, expectedRows: count.count, metadataReceipt: receiptOnly(metadata), countReceipt: receiptOnly(count) };
      }
      case 'capture.start': {
        if (!state.source) throw fail('SOCRATA_SOURCE_REQUIRED', 'Configure a source first.', 409);
        if (capture()?.status === 'running') throw fail('SOCRATA_CAPTURE_ACTIVE', 'Continue the current capture.', 409);
        const metadata = await client.metadata(state.source), count = await client.count(state.source);
        if (count.count > state.source.maxRows) throw fail('SOCRATA_CAPTURE_LIMIT', 'The selected source exceeds maxRows. Select a smaller meaningful scope.', 413);
        const c = { schema: CAPTURE, id: id('capture'), source: structuredClone(state.source), metadata: metadata.summary,
          revision: metadata.summary.revision, status: 'running', createdAt: now(), expectedRows: count.count,
          rowCount: 0, byteCount: 0, pageCount: 0, nextOffset: 0, pages: [], error: null };
        c.metadataBefore = await storeReceipt(c, 'metadata-before', metadata);
        c.countBefore = await storeReceipt(c, 'count-before', count);
        state.captures.push(c); state.captureId = c.id; state.metadata = metadata.summary;
        await save(); return { capture: c };
      }
      case 'capture.advance': {
        const c = capture();
        if (!c || c.status !== 'running') throw fail('SOCRATA_CAPTURE_STATE', 'Start or resume a capture before advancing it.', 409);
        const pages = integer(input.pages ?? 1, 'pages', 1, 100);
        for (let iteration = 0; iteration < pages && c.status === 'running'; iteration++) {
          if (c.rowCount === c.expectedRows) { await finalizeCapture(c); break; }
          await checkRevision(c);
          const page = await client.page(c.source, c.nextOffset);
          if (c.rowCount + page.rows.length > c.expectedRows || c.byteCount + page.bytes.length > c.source.maxBytes)
            throw fail('SOCRATA_CAPTURE_LIMIT', 'The selected capture exceeded its recorded row count or byte limit.', 413);
          const artifact = await immutable(directory, 'captures/' + c.id + '/page-' + String(c.pageCount).padStart(6,'0') + '-' + page.sha256 + '.json', page.bytes);
          c.pages.push({ ...receiptOnly(page), ...artifact, index: c.pageCount, offset: c.nextOffset, rowCount: page.rows.length });
          c.pageCount++; c.rowCount += page.rows.length; c.nextOffset += page.rows.length; c.byteCount += page.bytes.length;
          await save();
          if (page.rows.length < c.source.pageSize || c.rowCount === c.expectedRows) await finalizeCapture(c);
        }
        return { capture: c };
      }
      case 'capture.pause': {
        const c = capture();
        if (!c) throw fail('SOCRATA_CAPTURE_REQUIRED', 'There is no capture to pause.', 409);
        if (c.status === 'running') { c.status = 'paused'; c.pausedAt = now(); await save(); }
        return { capture: c };
      }
      case 'capture.resume': {
        const c = capture();
        if (!c) throw fail('SOCRATA_CAPTURE_REQUIRED', 'There is no capture to resume.', 409);
        if (c.status === 'completed' || c.status === 'running') return { capture: c };
        if (c.status === 'changed') throw fail('SOCRATA_SOURCE_CHANGED', 'Keep this changed capture and start a new complete capture.', 409);
        if (c.error?.retryAt && Date.parse(c.error.retryAt) > Date.now()) throw fail('SOCRATA_RATE_LIMIT', 'Wait until the recorded provider retry time.', 429, { retryAt: c.error.retryAt });
        await checkRevision(c); c.status = 'running'; c.error = null; c.resumedAt = now(); await save();
        return { capture: c };
      }
      case 'capture.import': {
        if (capture()?.status === 'running') throw fail('SOCRATA_CAPTURE_ACTIVE', 'Pause the active capture before importing another.', 409);
        return importCapture(input.manifestPath);
      }
      case 'mapping.save': state.mapping = validMapping(input); await save(); return { mapping: state.mapping };
      case 'edition.build': return buildEdition();
      case 'edition.activate': {
        const selected = state.editions.find(item => item.id === input.editionId);
        if (!selected) throw fail('SOCRATA_EDITION', 'Select a retained edition.', 404);
        state.activeEditionId = selected.id; state.captureId = selected.captureId;
        const c = capture(); state.source = c.source; state.metadata = c.metadata;
        state.mapping = await jsonAt(directory, selected.mappingFile, 65536); datasetCache = null;
        await nativeDataset(); await save(); return { edition: selected };
      }
      case 'dataset.query': {
        const native = await nativeDataset();
        const query = typeof input.query === 'string' ? new URLSearchParams(input.query) : input.query ?? {};
        const context = { query }, admission = native.admit(context), response = admission === true ? native.handle(context) : admission;
        const merchant = state.merchants[state.activeEditionId], params = new URLSearchParams(query);
        const requestURL = merchant ? merchant.origin + merchant.path + (params.size ? '?' + params.toString() : '') : null;
        if (response.status === 200) {
          state.queries[state.activeEditionId] = { query: Object.fromEntries(params),
            initialQuery: Object.fromEntries([...params].filter(([name]) => name !== 'cursor')),
            snapshot: native.describe().snapshot, nextCursor: response.body.page.nextCursor,
            returned: response.body.page.returned, total: response.body.page.total, queriedAt: now() };
          await save();
        }
        return { status: response.status, body: response.body, snapshot: native.describe().snapshot, query: params.toString(),
          requestURL, queryParameters: datasetQueryParameters(native.describe()) };
      }
      case 'merchant.configure': {
        const native = await nativeDataset();
        const config = await buildDatasetSellerConfig(native, { payment: input.payment, origin: input.origin, path: input.path ?? '/data' });
        const active = edition(), tag = sha256(stable(config)).slice(0,24);
        const file = 'editions/' + active.id + '/seller-' + tag + '.json';
        await immutable(directory, file, Buffer.from(json(config)));
        const merchant = { editionId: active.id, configFile: file, origin: config.publicOrigin, path: config.routes[0].path,
          payment: config.routes[0].definition.payment, createdAt: now() };
        state.merchants[active.id] = merchant; await save();
        return { merchant, config, datasetConfigFile: inside(directory, active.configFile),
          command: { executable: 'node', arguments: ['serve.mjs', '--config', inside(directory,file),
            '--handlers', 'examples/dataset-application.mjs'], environment: { SF30_DATASET_CONFIG: inside(directory, active.configFile) } } };
      }
      case 'package.export': return exportPackage();
      case 'package.import': return importPackage(input.packagePath);
      default: throw fail('SOCRATA_ACTION', 'Unknown Socrata workspace action.', 404);
    }
  }

  function retainedFiles(snapshot) {
    const paths = new Set();
    for (const c of snapshot.captures) {
      if (!ID.test(c.id) || RESERVED.has(c.id)) throw fail('SOCRATA_CAPTURE_ID', 'Invalid retained capture ID.');
      for (const page of c.pages ?? []) paths.add(safeRelative(page.file));
      for (const key of ['metadataBefore','metadataAfter','countBefore','countAfter','changedMetadata'])
        if (c[key]?.file) paths.add(safeRelative(c[key].file));
      if (c.importManifestSha256) paths.add('captures/' + c.id + '/import-manifest.json');
    }
    for (const e of snapshot.editions) {
      if (!ID.test(e.id) || RESERVED.has(e.id)) throw fail('SOCRATA_EDITION_ID', 'Invalid retained edition ID.');
      for (const key of ['configFile','indexFile','mappingFile']) paths.add(safeRelative(e[key]));
      paths.add('editions/' + e.id + '/dataset.csv'); paths.add('editions/' + e.id + '/source.json');
    }
    for (const merchant of Object.values(snapshot.merchants)) paths.add(safeRelative(merchant.configFile));
    return [...paths].sort();
  }
  async function exportPackage() {
    const active = edition();
    if (!active) throw fail('SOCRATA_EDITION_REQUIRED', 'Activate a complete dataset edition before exporting.', 409);
    const native = await nativeDataset(), snapshot = structuredClone(state);
    snapshot.exports = []; snapshot.error = null;
    for (const c of snapshot.captures) if (c.status === 'running') { c.status = 'paused'; c.pausedAt = now(); }
    const files = retainedFiles(snapshot), expectedHashes = new Map();
    for (const c of snapshot.captures) {
      for (const page of c.pages) expectedHashes.set(page.file, page.sha256);
      for (const key of ['metadataBefore','metadataAfter','countBefore','countAfter','changedMetadata'])
        if (c[key]?.file) expectedHashes.set(c[key].file, c[key].sha256);
      if (c.importManifestSha256) expectedHashes.set('captures/' + c.id + '/import-manifest.json', c.importManifestSha256);
    }
    for (const e of snapshot.editions) expectedHashes.set('editions/' + e.id + '/dataset.csv', e.sha256);
    const exportId = id('export'), dir = 'exports/' + exportId;
    await mkdir(inside(directory, dir), { recursive: true, mode: 0o700 });
    const packageName = 'starforge-socrata.json.gz', temporary = inside(directory, dir + '/' + packageName + '.tmp');
    const gzip = createGzip({ level: 6 }), output = createWriteStream(temporary, { flags: 'wx', mode: 0o600 });
    const completed = pipeline(gzip, output);
    completed.catch(() => {});
    const put = async text => { if (!gzip.write(text)) await once(gzip, 'drain'); };
    try {
      await put('{"schema":' + JSON.stringify(PACKAGE) + ',"createdAt":' + JSON.stringify(now()) +
        ',"workspace":' + JSON.stringify(snapshot) + ',"files":[');
      let total = 0;
      for (let index = 0; index < files.length; index++) {
        const bytes = await bytesAt(directory, files[index]);
        if (expectedHashes.has(files[index]) && sha256(bytes) !== expectedHashes.get(files[index]))
          throw fail('SOCRATA_RETAINED_CHANGED', 'A retained source or dataset file changed. Restore its original bytes before export.', 409);
        total += bytes.length;
        if (total > 512 * 1024 * 1024) throw fail('SOCRATA_PACKAGE_LIMIT', 'This portable package exceeds 512 MiB of retained source files. Export a workspace with fewer retained captures.', 413);
        await put((index ? ',' : '') + JSON.stringify({ path: files[index], bytes: bytes.length,
          sha256: sha256(bytes), encoding: 'base64', content: bytes.toString('base64') }));
      }
      await put(']}\n'); gzip.end(); await completed;
    } catch (error) { gzip.destroy(error); output.destroy(error); await completed.catch(() => {}); throw error; }
    await rename(temporary, inside(directory, dir + '/' + packageName));
    const publishFile = async (name, bytes) => { await immutable(directory, dir + '/' + name, bytes); };
    for (const [name,path] of [['dataset.csv','editions/' + active.id + '/dataset.csv'],
      ['dataset.json',active.configFile],['source.json','editions/' + active.id + '/source.json']])
      await publishFile(name, await bytesAt(directory, path));
    const merchant = state.merchants[active.id], savedQuery = state.queries[active.id];
    const query = savedQuery?.initialQuery ?? { limit: String(Math.min(50, native.describe().maxLimit)) };
    await publishFile('query.json', Buffer.from(json({ schema: 'stellar-forge.dataset-query.v1',
      snapshot: native.describe().snapshot, query, lastQuery: savedQuery?.query ?? null,
      nextCursor: savedQuery?.nextCursor ?? null, queryParameters: datasetQueryParameters(native.describe()),
      requestURL: merchant ? merchant.origin + merchant.path + '?' + new URLSearchParams(query) : null })));
    if (merchant) await publishFile('seller.json', await bytesAt(directory, merchant.configFile, 65536));
    const c = capture();
    const readme = [
      '# ' + native.describe().name,
      '',
      'This package contains the complete selected Socrata capture, retained dataset editions, original source definitions, native CSV configuration, and query capabilities.',
      '',
      '- Provider: https://' + c.source.domain + '/resource/' + c.source.datasetId + '.json',
      '- Capture protocol: ' + c.source.protocol,
      '- Selection: ' + (c.source.where || '(all records)'),
      '- Rows in this edition: ' + native.describe().rowCount,
      '- Dataset snapshot: ' + native.describe().snapshot,
      '- Capture consistency: ' + c.consistency,
      '',
      '## Use the dataset',
      '',
      'Place dataset.csv beside dataset.json. With the installed Stellar Forge merchant package, run:',
      '',
      '    node dataset-cli.mjs --dataset /absolute/path/dataset.json',
      '',
      'Open the original private query workspace with dataset-workspace.mjs --dataset /absolute/path/dataset.json. Query parameters are listed in query.json. Use each returned cursor unchanged with the same fields, filters, and sort.',
      '',
      ...(merchant ? [
        '## Serve with the configured merchant',
        '',
        'seller.json contains the operator-selected public payment terms. Set SF30_DATASET_CONFIG to the absolute dataset.json path and run the original seller:',
        '',
        '    node serve.mjs --config /absolute/path/seller.json --handlers examples/dataset-application.mjs',
        '',
        'Use the original merchant deployment and facilitator configuration for the selected network. The exported origin is ' + merchant.origin + merchant.path + '.',
        ''
      ] : []),
      '## Restore the complete workspace',
      '',
      'Run socrata/cli.mjs action package.import --directory /absolute/empty-workspace --json \'{"packagePath":"/absolute/path/starforge-socrata.json.gz"}\'. Then open socrata/cli.mjs workspace --directory /absolute/empty-workspace.',
      '',
      'The portable gzip JSON contains all referenced source pages and configuration files with exact file hashes. The importing operator verifies them before selecting an edition. Provide SOCRATA_APP_TOKEN at startup if a future capture uses SODA 3. Restoring or querying a retained edition reads local data.',
      '',
      '## Source interpretation',
      '',
      c.metadata.description || '',
      '',
      'Source field definitions and the explicit conversion/null policy are preserved in source.json. String identifiers and floating timestamps keep their original text. A number output uses JavaScript finite-number semantics; use string outputs for exact decimal arithmetic or large identifiers.',
      '',
      'The dataset CSV is machine-oriented. Spreadsheet software can interpret strings beginning with formula characters; import its columns as text when using a spreadsheet. The original source text is preserved in the CSV.',
      ''
    ].join('\n');
    await publishFile('README.md', Buffer.from(readme));
    const names = [packageName,'dataset.csv','dataset.json','source.json','query.json','README.md',...(merchant ? ['seller.json'] : [])];
    const exported = [];
    for (const name of names) {
      const bytes = await bytesAt(directory, dir + '/' + name, 512 * 1024 * 1024);
      exported.push({ name, bytes: bytes.length, sha256: sha256(bytes) });
    }
    const result = { id: exportId, createdAt: now(), editionId: active.id, directory: inside(directory, dir),
      files: exported, packageFile: inside(directory, dir + '/' + packageName) };
    state.exports.push(result); await save(); return result;
  }
  async function importPackage(packagePath) {
    if (typeof packagePath !== 'string' || !packagePath) throw fail('SOCRATA_PACKAGE', 'Choose a portable Socrata package file.');
    if (state.captures.length || state.editions.length || state.source)
      throw fail('SOCRATA_IMPORT_EMPTY', 'Restore into an empty Socrata workspace directory.', 409);
    const full = resolve(packagePath), raw = await bytesAt(dirname(full), basename(full), 512 * 1024 * 1024);
    let decoded = raw;
    if (raw[0] === 0x1f && raw[1] === 0x8b) {
      const unzip = createGunzip(); const chunks = []; let size = 0;
      const consumed = (async () => { for await (const chunk of unzip) {
        size += chunk.length;
        if (size > 768 * 1024 * 1024) throw fail('SOCRATA_PACKAGE_LIMIT', 'The expanded portable package exceeds 768 MiB.', 413);
        chunks.push(chunk);
      } return Buffer.concat(chunks); })();
      unzip.end(raw);
      try { decoded = await consumed; } catch (error) { unzip.destroy(); throw error; }
    }
    let imported;
    try { imported = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decoded)); }
    catch { throw fail('SOCRATA_PACKAGE', 'The portable file is not valid gzip JSON or JSON.'); }
    const snapshot = imported.workspace;
    if (imported.schema !== PACKAGE || snapshot?.schema !== SCHEMA || !Array.isArray(imported.files) ||
        !Array.isArray(snapshot.captures) || !Array.isArray(snapshot.editions) || !plain(snapshot.merchants) ||
        imported.files.length > 100000) throw fail('SOCRATA_PACKAGE', 'The portable package has an unsupported structure.');
    const expected = new Set(retainedFiles(snapshot)), supplied = new Map();
    let total = 0;
    for (const file of imported.files) {
      const path = safeRelative(file.path);
      if (!expected.has(path) || supplied.has(path) || !/^(captures|editions)\//.test(path) ||
          file.encoding !== 'base64' || typeof file.content !== 'string' || !HASH.test(file.sha256 ?? '') ||
          !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > 256 * 1024 * 1024)
        throw fail('SOCRATA_PACKAGE_FILE', 'The portable package contains an unexpected or duplicate retained file.');
      const bytes = Buffer.from(file.content, 'base64');
      if (bytes.toString('base64') !== file.content || bytes.length !== file.bytes || sha256(bytes) !== file.sha256)
        throw fail('SOCRATA_PACKAGE_HASH', 'A portable file does not match its complete bytes and hash.');
      total += bytes.length;
      if (total > 512 * 1024 * 1024) throw fail('SOCRATA_PACKAGE_LIMIT', 'The portable package exceeds 512 MiB of retained files.', 413);
      supplied.set(path, bytes);
    }
    if (expected.size !== supplied.size) throw fail('SOCRATA_PACKAGE_INCOMPLETE', 'The portable package is missing retained source files.');
    const captureIds = new Set(), editionIds = new Set();
    for (const c of snapshot.captures) {
      if (captureIds.has(c.id) || !Array.isArray(c.pages)) throw fail('SOCRATA_PACKAGE_CAPTURE', 'The package contains duplicate or invalid captures.');
      captureIds.add(c.id); c.source = normalizeSource(c.source, { retainOrder: true });
      let rows = 0, bytes = 0, offset = 0;
      for (const page of c.pages) {
        const content = supplied.get(page.file), decodedRows = parseRows(content);
        if (sha256(content) !== page.sha256 || content.length !== page.bytes || decodedRows.length !== page.rowCount || page.offset !== offset)
          throw fail('SOCRATA_PACKAGE_CAPTURE', 'A retained capture page differs from its original descriptor.');
        rows += decodedRows.length; bytes += content.length; offset += decodedRows.length;
      }
      if (rows !== c.rowCount || bytes !== c.byteCount || (c.status === 'completed' && rows !== c.expectedRows))
        throw fail('SOCRATA_PACKAGE_CAPTURE', 'The retained capture counts are incomplete.');
      if (c.status === 'running') c.status = 'paused';
    }
    for (const e of snapshot.editions) {
      if (editionIds.has(e.id) || !captureIds.has(e.captureId)) throw fail('SOCRATA_PACKAGE_EDITION', 'A retained edition has no matching capture.');
      editionIds.add(e.id);
      const config = JSON.parse(supplied.get(e.configFile).toString('utf8'));
      const mapping = validMapping(JSON.parse(supplied.get(e.mappingFile).toString('utf8')));
      if (config.file !== 'dataset.csv' || e.configFile !== 'editions/' + e.id + '/dataset.json' ||
          sha256(supplied.get('editions/' + e.id + '/dataset.csv')) !== e.sha256 ||
          sha256(stable(mapping)) !== e.mappingSha256)
        throw fail('SOCRATA_PACKAGE_EDITION', 'The edition mapping, CSV or configuration differs from its descriptor.');
    }
    if ((snapshot.activeEditionId && !editionIds.has(snapshot.activeEditionId)) ||
        (snapshot.captureId && !captureIds.has(snapshot.captureId)))
      throw fail('SOCRATA_PACKAGE_SELECTION', 'The saved selection is absent from the portable package.');
    for (const [path,bytes] of supplied) await immutable(directory, path, bytes);
    for (const e of snapshot.editions) {
      const native = await loadDatasetConfig(inside(directory, e.configFile));
      if (native.describe().snapshot !== e.snapshot || native.describe().rowCount !== e.rowCount)
        throw fail('SOCRATA_PACKAGE_DATASET', 'The restored dataset does not match its native snapshot.');
    }
    state = { ...snapshot, queries: plain(snapshot.queries) ? snapshot.queries : {}, exports: [], error: null, restoredAt: now() }; datasetCache = null;
    await save();
    return { restored: true, captures: state.captures.length, editions: state.editions.length,
      activeEditionId: state.activeEditionId, snapshot: (await nativeDataset()).describe().snapshot };
  }
  return {
    state: async () => publicState(),
    act: (action, input = {}) => serial(async () => {
      if (typeof action !== 'string' || !plain(input)) throw fail('SOCRATA_ACTION', 'Use an action name and an object payload.');
      const previousError = state.error; state.error = null;
      try {
        const result = await dispatch(action, input);
        if (previousError) await save();
        return { state: { ...publicState(), busy: false }, result };
      } catch (error) {
        const detail = { code: error.code?.startsWith('SOCRATA_') ? error.code : 'SOCRATA_OPERATION',
          message: error.message, at: now(), ...(error.retryAt ? { retryAt: error.retryAt } : {}) };
        state.error = detail;
        const c = capture();
        if (action.startsWith('capture.') && c?.status === 'running') {
          c.status = error.status === 429 ? 'paused' : 'error'; c.error = detail;
        }
        await save().catch(() => {});
        throw error;
      }
    }),
    readExport: (exportId, filename) => serial(async () => {
      const saved = state.exports.find(item => item.id === exportId);
      const descriptor = saved?.files.find(file => file.name === filename);
      if (!descriptor || basename(filename) !== filename || !ID.test(exportId))
        throw fail('SOCRATA_EXPORT', 'Select an exported file from this workspace.', 404);
      const path = 'exports/' + exportId + '/' + filename, bytes = await bytesAt(directory, path, 512 * 1024 * 1024);
      if (bytes.length !== descriptor.bytes || sha256(bytes) !== descriptor.sha256)
        throw fail('SOCRATA_EXPORT_CHANGED', 'The retained export has different bytes. Export the edition again.', 409);
      return { path: inside(directory, path), contentType: filename.endsWith('.gz') ? 'application/gzip' :
        filename.endsWith('.csv') ? 'text/csv; charset=utf-8' :
        filename.endsWith('.json') ? 'application/json; charset=utf-8' : 'text/markdown; charset=utf-8',
        bytes: descriptor.bytes, sha256: descriptor.sha256 };
    }),
    close: async () => {
      if (closing) return;
      closing = true; await tail; datasetCache = null;
      lease.exec('ROLLBACK'); lease.close();
    }
  };
}
