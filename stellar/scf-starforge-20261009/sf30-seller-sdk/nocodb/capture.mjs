// MIT. Exact complete provider pages, private custody and immutable capture import.
import { dirname, join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { object, bytes, digest, identity, readPrivate, createFile, privateDirectory, syncDirectory, fault, stamp } from '../postgres/publisher/files.mjs';
import { MAX_CAPTURE_BYTES, MAX_PAGE_BYTES, HASH, SCALAR_TYPES, binding, sourceSelection, compileQueries, integer, only, identifier } from './declaration.mjs';
import { createNocoDBReader, tableUrl, countUrl, recordsUrl, validateRecordUrl, checkedHeaders, inspectTableBytes } from './http.mjs';
import { parseNocoDBRecords, recordIdentity, identityDigest, projectedNocoDBValue } from './values.mjs';

const PAGE_FILE = /^page-[0-9]{6}\.json$/;
const PAGE_NAME = number => 'page-' + String(number).padStart(6, '0') + '.json';
const json = content => {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(content)); }
  catch { throw fault('NOCODB_CAPTURE_JSON_INVALID'); }
};
function countFromBytes(content) {
  const value = json(content);
  if (!object(value) || !Number.isSafeInteger(value.count) || value.count < 0)
    throw fault('NOCODB_COUNT_RESPONSE_INVALID');
  return value.count;
}
const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
function selectionShape(value) {
  only(value, ['server', 'apiVersion', 'baseId', 'tableId', 'viewId', 'where', 'sourceOrder', 'fields'], 'NOCODB_CAPTURE_SELECTION_INVALID');
  if (!Array.isArray(value.fields) || !value.fields.length || value.fields.length > 2048) throw fault('NOCODB_CAPTURE_FIELDS_INVALID');
  const ids = new Set();
  for (const field of value.fields) {
    only(field, ['id', 'type'], 'NOCODB_CAPTURE_FIELDS_INVALID'); identifier(field.id, 'FIELD_ID');
    if (!SCALAR_TYPES.has(field.type) || ids.has(field.id)) throw fault('NOCODB_CAPTURE_FIELDS_INVALID');
    ids.add(field.id);
  }
  const normalized = { ...binding(value), fields: value.fields };
  if (identity(normalized) !== identity(value)) throw fault('NOCODB_CAPTURE_SELECTION_INVALID');
  return value;
}
function descriptor(file, observation) {
  return { file, bytes: observation.content.length, sha256: digest(observation.content), receivedAt: observation.receivedAt,
    requestUrl: observation.requestUrl, headers: observation.headers };
}
function checkedDescriptor(value, filename) {
  only(value, ['file', 'bytes', 'sha256', 'receivedAt', 'requestUrl', 'headers'], 'NOCODB_CAPTURE_RESOURCE_INVALID');
  if (value.file !== filename || !HASH.test(value.sha256 ?? '') || !validTime(value.receivedAt) ||
      typeof value.requestUrl !== 'string' || value.requestUrl.length > 32768)
    throw fault('NOCODB_CAPTURE_RESOURCE_INVALID');
  integer(value.bytes, 1, MAX_PAGE_BYTES, 'NOCODB_CAPTURE_RESOURCE_SIZE_INVALID'); checkedHeaders(value.headers);
}
function pageRecords(response, selection, seen, accumulated, maximum) {
  const fields = new Set(selection.fields.map(field => field.id));
  for (const row of response.records) {
    const id = recordIdentity(row);
    if (seen.has(id)) throw fault('NOCODB_DUPLICATE_RECORD_ID', 'The paginated read repeated a native record identity. Capture the source again after reviewing its stable order and concurrent writes.');
    seen.add(id);
    const identityFields = Object.keys(row.id_fields ?? {});
    for (const field of identityFields) {
      identifier(field, 'NATIVE_IDENTITY_FIELD');
      if (fields.has(field))
        throw fault('NOCODB_PRIMARY_KEY_USE_RECORD_ID', 'The selected field is a native primary key, which v3 separates from fields. Use the explicit $recordId projection.');
      if (!selection.sourceOrder.some(order => order.field === field))
        throw fault('NOCODB_IDENTITY_ORDER_REQUIRED', 'Include every observed native primary-key field ID in the stable source order.');
    }
    for (const field of fields) if (!Object.hasOwn(row.fields, field)) throw fault('NOCODB_SELECTED_FIELD_MISSING');
    if (Object.keys(row.fields).some(id => !fields.has(id))) throw fault('NOCODB_PROVIDER_PROJECTION_CHANGED');
    accumulated.push(row);
    if (accumulated.length > maximum) throw fault('NOCODB_CAPTURE_TOO_MANY_ROWS');
  }
  if (!response.records.length && response.next != null) throw fault('NOCODB_EMPTY_INTERMEDIATE_PAGE');
}
function observeNext(response, current, selection, number, maximumPageSize, appliedPageSize) {
  if (response.next == null) return null; // Original serializer also omits undefined terminal next.
  return validateRecordUrl(new URL(response.next, current).href, selection,
    { expectedPage: number + 1, maximumPageSize, appliedPageSize });
}
export async function captureNocoDBSource(config, directory, options = {}) {
  const queries = compileQueries(config.queries), selection = sourceSelection(config, queries);
  const reader = createNocoDBReader(config, options);
  await privateDirectory(dirname(directory)); await mkdir(directory, { mode: 0o700 }); await privateDirectory(directory);
  const startedAt = stamp(), pages = [], records = [], seen = new Set(), resources = new Map();
  let sourceBytes = 0;
  const retain = async (file, observation) => {
    const nextTotal = sourceBytes + observation.content.length;
    if (nextTotal > reader.options.maxCaptureBytes) throw fault('NOCODB_CAPTURE_TOO_LARGE');
    await createFile(join(directory, file), observation.content);
    sourceBytes = nextTotal;
    resources.set(file, observation.content);
    return descriptor(file, observation);
  };
  try {
    const beforeResponse = await reader.get(tableUrl(selection));
    const before = inspectTableBytes(beforeResponse.content, selection, selection.fields);
    const tableBefore = await retain('table-before.json', beforeResponse);
    const beforeCountResponse = await reader.get(countUrl(selection));
    const expectedRows = countFromBytes(beforeCountResponse.content);
    const countBefore = await retain('count-before.json', beforeCountResponse);
    if (expectedRows > reader.options.maxRows) throw fault('NOCODB_CAPTURE_TOO_MANY_ROWS');
    let url = recordsUrl(selection, reader.options.pageSize), appliedPageSize = null;
    for (let number = 1; ; number++) {
      if (number > reader.options.maxPages) throw fault('NOCODB_CAPTURE_TOO_MANY_PAGES');
      const observed = await reader.get(url), response = parseNocoDBRecords(observed.content);
      pageRecords(response, selection, seen, records, expectedRows);
      // Every configured public projection is checked before this capture can be complete.
      for (const row of response.records) for (const query of Object.values(queries))
        for (const spec of Object.values(query.projection)) projectedNocoDBValue(row, spec);
      pages.push(await retain(PAGE_NAME(number), observed));
      const next = observeNext(response, url, selection, number, reader.options.pageSize, appliedPageSize);
      if (next === null) break;
      appliedPageSize = next.pageSize; url = next.url;
    }
    const afterCountResponse = await reader.get(countUrl(selection));
    const countAfter = await retain('count-after.json', afterCountResponse);
    if (records.length !== expectedRows || countFromBytes(afterCountResponse.content) !== expectedRows)
      throw fault('NOCODB_COUNT_CHANGED_DURING_CAPTURE', 'The original count, complete unique rows and closing count differ. Capture again after reviewing concurrent source changes.');
    const afterResponse = await reader.get(tableUrl(selection));
    const after = inspectTableBytes(afterResponse.content, selection, selection.fields);
    const tableAfter = await retain('table-after.json', afterResponse);
    if (before.schemaSha256 !== after.schemaSha256) throw fault('NOCODB_SCHEMA_CHANGED_DURING_CAPTURE');
    const manifest = { schema: 'stellar-forge.nocodb-capture.v1', provider: 'nocodb', apiVersion: 'v3',
      transport: 'nocodb-rest', method: 'GET', readOnly: true, complete: true, responseKind: 'PAGED_TABLE_READ',
      atomicSourceSnapshot: false, selection, selectionSha256: identity(selection),
      startedAt, completedAt: stamp(), requestedPageSize: reader.options.pageSize, appliedPageSize,
      tableBefore, countBefore, pages, countAfter, tableAfter, countVerified: true, schemaSha256: before.schemaSha256,
      rowCount: records.length, pageCount: pages.length, sourceBytes, recordIdentitiesSha256: identityDigest(records) };
    const manifestBytes = bytes(manifest);
    if (manifestBytes.length > 16777216) throw fault('NOCODB_CAPTURE_MANIFEST_TOO_LARGE');
    await createFile(join(directory, 'capture.json'), manifestBytes);
    await syncDirectory(directory); await syncDirectory(dirname(directory));
    return { manifest, manifestBytes, manifestFile: join(directory, 'capture.json'),
      manifestSha256: digest(manifestBytes), resources, records, table: before.table };
  } catch (issue) {
    // Preserve the already received original pages. A failed capture never gains a complete manifest.
    const failure = { schema: 'stellar-forge.nocodb-incomplete-capture.v1', complete: false, startedAt,
      stoppedAt: stamp(), completedPages: pages.length, retainedBytes: sourceBytes,
      code: issue.code ?? 'NOCODB_CAPTURE_FAILED', providerStatus: issue.providerStatus ?? null,
      requestId: issue.requestId ?? null, retryAfter: issue.retryAfter ?? null };
    try { await createFile(join(directory, 'incomplete.json'), bytes(failure)); await syncDirectory(directory); } catch {}
    throw issue;
  }
}
export async function readNocoDBCapture(filename, expectedHash) {
  const manifestBytes = await readPrivate(filename, 16777216), manifest = json(manifestBytes);
  if (expectedHash !== undefined && digest(manifestBytes) !== expectedHash) throw fault('NOCODB_CAPTURE_MANIFEST_CHANGED');
  only(manifest, ['schema', 'provider', 'apiVersion', 'transport', 'method', 'readOnly', 'complete', 'responseKind',
    'atomicSourceSnapshot', 'selection', 'selectionSha256', 'startedAt', 'completedAt', 'requestedPageSize', 'appliedPageSize',
    'tableBefore', 'countBefore', 'pages', 'countAfter', 'tableAfter', 'countVerified', 'schemaSha256', 'rowCount', 'pageCount', 'sourceBytes', 'recordIdentitiesSha256'],
    'NOCODB_CAPTURE_MANIFEST_INVALID');
  if (manifest.schema !== 'stellar-forge.nocodb-capture.v1' || manifest.provider !== 'nocodb' || manifest.apiVersion !== 'v3' ||
      manifest.transport !== 'nocodb-rest' || manifest.method !== 'GET' || manifest.readOnly !== true || manifest.complete !== true ||
      manifest.responseKind !== 'PAGED_TABLE_READ' || manifest.atomicSourceSnapshot !== false || manifest.countVerified !== true ||
      !HASH.test(manifest.schemaSha256 ?? '') || !HASH.test(manifest.recordIdentitiesSha256 ?? '') ||
      !validTime(manifest.startedAt) || !validTime(manifest.completedAt) || Date.parse(manifest.startedAt) > Date.parse(manifest.completedAt))
    throw fault('NOCODB_CAPTURE_MANIFEST_INVALID');
  const selection = selectionShape(manifest.selection);
  if (identity(selection) !== manifest.selectionSha256) throw fault('NOCODB_CAPTURE_SELECTION_CHANGED');
  integer(manifest.requestedPageSize, 1, 1000, 'NOCODB_CAPTURE_PAGE_SIZE_INVALID');
  if (manifest.appliedPageSize !== null) integer(manifest.appliedPageSize, 1, manifest.requestedPageSize, 'NOCODB_CAPTURE_PAGE_SIZE_INVALID');
  integer(manifest.pageCount, 1, 10000, 'NOCODB_CAPTURE_PAGE_COUNT_INVALID');
  integer(manifest.rowCount, 0, 1000000, 'NOCODB_CAPTURE_ROW_COUNT_INVALID');
  integer(manifest.sourceBytes, 1, MAX_CAPTURE_BYTES, 'NOCODB_CAPTURE_BYTES_INVALID');
  if (!Array.isArray(manifest.pages) || manifest.pages.length !== manifest.pageCount) throw fault('NOCODB_CAPTURE_PAGES_INVALID');
  const resources = new Map(); let total = 0, lastTime = Date.parse(manifest.startedAt);
  const read = async (item, file) => {
    checkedDescriptor(item, file);
    const time = Date.parse(item.receivedAt);
    if (time < lastTime || time > Date.parse(manifest.completedAt)) throw fault('NOCODB_CAPTURE_TIME_ORDER_INVALID');
    lastTime = time;
    const content = await readPrivate(join(dirname(filename), file), MAX_PAGE_BYTES);
    if (content.length !== item.bytes || digest(content) !== item.sha256) throw fault('NOCODB_CAPTURE_RESOURCE_CHANGED');
    total += content.length; if (total > manifest.sourceBytes) throw fault('NOCODB_CAPTURE_BYTES_CHANGED');
    resources.set(file, content); return content;
  };
  if (manifest.tableBefore?.requestUrl !== tableUrl(selection).href || manifest.tableAfter?.requestUrl !== tableUrl(selection).href)
    throw fault('NOCODB_CAPTURE_TABLE_URL_CHANGED');
  const before = inspectTableBytes(await read(manifest.tableBefore, 'table-before.json'), selection, selection.fields);
  if (manifest.countBefore?.requestUrl !== countUrl(selection).href || manifest.countAfter?.requestUrl !== countUrl(selection).href)
    throw fault('NOCODB_CAPTURE_COUNT_URL_CHANGED');
  const expectedRows = countFromBytes(await read(manifest.countBefore, 'count-before.json'));
  if (expectedRows !== manifest.rowCount) throw fault('NOCODB_CAPTURE_COUNT_CHANGED');
  const records = [], seen = new Set();
  let expected = recordsUrl(selection, manifest.requestedPageSize), appliedPageSize = null;
  for (let index = 0; index < manifest.pages.length; index++) {
    const item = manifest.pages[index], number = index + 1;
    if (!PAGE_FILE.test(item?.file ?? '')) throw fault('NOCODB_CAPTURE_PAGE_FILE_INVALID');
    if (item.requestUrl !== expected.href) throw fault('NOCODB_CAPTURE_CONTINUATION_CHANGED');
    const response = parseNocoDBRecords(await read(item, PAGE_NAME(number)));
    pageRecords(response, selection, seen, records, manifest.rowCount);
    const next = observeNext(response, expected, selection, number, manifest.requestedPageSize, appliedPageSize);
    if (index === manifest.pages.length - 1 ? next !== null : next === null) throw fault('NOCODB_CAPTURE_INCOMPLETE');
    if (next) { appliedPageSize = next.pageSize; expected = next.url; }
  }
  if (countFromBytes(await read(manifest.countAfter, 'count-after.json')) !== expectedRows) throw fault('NOCODB_CAPTURE_COUNT_CHANGED');
  const after = inspectTableBytes(await read(manifest.tableAfter, 'table-after.json'), selection, selection.fields);
  if (before.schemaSha256 !== after.schemaSha256 || before.schemaSha256 !== manifest.schemaSha256 ||
      records.length !== manifest.rowCount || total !== manifest.sourceBytes ||
      appliedPageSize !== manifest.appliedPageSize || identityDigest(records) !== manifest.recordIdentitiesSha256)
    throw fault('NOCODB_CAPTURE_CONTENT_CHANGED');
  return { manifest, manifestBytes, manifestFile: filename, manifestSha256: digest(manifestBytes), resources, records, table: before.table };
}
export function bindNocoDBCapture(capture, config) {
  if (identity(sourceSelection(config)) !== capture.manifest.selectionSha256)
    throw fault('NOCODB_CAPTURE_SELECTION_MISMATCH', 'Use the reviewed server, v3 base/table/view/filter, source order and exact field-ID/type projection.');
  return capture.records;
}
export async function copyNocoDBCapture(capture, directory) {
  await privateDirectory(dirname(directory)); await mkdir(directory, { mode: 0o700 }); await privateDirectory(directory);
  for (const item of [capture.manifest.tableBefore, capture.manifest.countBefore, ...capture.manifest.pages, capture.manifest.countAfter, capture.manifest.tableAfter]) {
    const content = capture.resources.get(item.file);
    if (!content || content.length !== item.bytes || digest(content) !== item.sha256) throw fault('NOCODB_CAPTURE_COPY_CHANGED');
    await createFile(join(directory, item.file), content);
  }
  await createFile(join(directory, 'capture.json'), capture.manifestBytes);
  await syncDirectory(directory); await syncDirectory(dirname(directory));
  return { ...capture, manifestFile: join(directory, 'capture.json') };
}
export async function importNocoDBCapture(filename, directory, config) {
  const capture = await readNocoDBCapture(filename); bindNocoDBCapture(capture, config);
  return copyNocoDBCapture(capture, directory);
}
