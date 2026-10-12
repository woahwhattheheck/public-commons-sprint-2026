// MIT. Complete original Baserow pages and optional exact original file custody.
import { dirname, join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { object, bytes, digest, identity, readPrivate, createFile, privateDirectory, syncDirectory, fault, stamp } from '../postgres/publisher/files.mjs';
import { MAX_CAPTURE_BYTES, MAX_PAGE_BYTES, MAX_FILE_BYTES, HASH, binding, sourceSelection, compileQueries, integer, only } from './declaration.mjs';
import { createBaserowReader, metadataUrl, recordsUrl, validateRecordUrl, checkedHeaders, checkedAttachmentUrl, inspectMetadataBytes } from './http.mjs';
import { parseBaserowRecords, recordIdentity, identityDigest, countValue, projectedBaserowValue } from './values.mjs';

const PAGE_NAME = number => 'page-' + String(number).padStart(6, '0') + '.json';
const ASSET_NAME = number => 'attachment-' + String(number).padStart(6, '0') + '.bin';
const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const json = content => {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(content)); }
  catch { throw fault('BASEROW_CAPTURE_JSON_INVALID'); }
};
function selectionShape(value) {
  only(value, ['server', 'kind', 'slug', 'tableId', 'viewId', 'filters', 'search', 'orderBy', 'fields', 'attachments'], 'BASEROW_CAPTURE_SELECTION_INVALID');
  if (!Array.isArray(value.fields) || !value.fields.length || value.fields.length > 2048) throw fault('BASEROW_CAPTURE_FIELDS_INVALID');
  const seen = new Set();
  for (const item of value.fields) {
    only(item, ['id', 'type'], 'BASEROW_CAPTURE_FIELD_INVALID');
    integer(item.id, 1, Number.MAX_SAFE_INTEGER, 'BASEROW_CAPTURE_FIELD_INVALID');
    if (typeof item.type !== 'string' || !/^[a-z][a-z0-9_]{0,95}$/.test(item.type) || seen.has(item.id))
      throw fault('BASEROW_CAPTURE_FIELD_INVALID');
    seen.add(item.id);
  }
  only(value.attachments, ['mode', 'allowedOrigins', 'maxFileBytes', 'maxFiles'], 'BASEROW_CAPTURE_ATTACHMENTS_INVALID');
  const options = value.attachments;
  if (!['metadata', 'retain'].includes(options.mode) || !Array.isArray(options.allowedOrigins) ||
      options.allowedOrigins.length > 32 || new Set(options.allowedOrigins).size !== options.allowedOrigins.length ||
      options.mode === 'retain' && !options.allowedOrigins.length || options.mode === 'metadata' && options.allowedOrigins.length)
    throw fault('BASEROW_CAPTURE_ATTACHMENTS_INVALID');
  for (const origin of options.allowedOrigins) {
    const url = checkedAttachmentUrl(origin, options.allowedOrigins, true);
    if (url.origin !== origin) throw fault('BASEROW_CAPTURE_ATTACHMENTS_INVALID');
  }
  integer(options.maxFileBytes, 1, MAX_FILE_BYTES, 'BASEROW_CAPTURE_ATTACHMENTS_INVALID');
  integer(options.maxFiles, 1, 10000, 'BASEROW_CAPTURE_ATTACHMENTS_INVALID');
  if (identity({ ...binding(value), fields: value.fields, attachments: options }) !== identity(value))
    throw fault('BASEROW_CAPTURE_SELECTION_INVALID');
  return value;
}
function descriptor(file, observation) {
  return { file, bytes: observation.content.length, sha256: digest(observation.content), status: observation.status,
    receivedAt: observation.receivedAt, requestUrl: observation.requestUrl, finalUrl: observation.finalUrl,
    redirects: observation.redirects, headers: observation.headers };
}
function checkedDescriptor(item, filename, selection, asset = false) {
  only(item, ['file', 'bytes', 'sha256', 'status', 'receivedAt', 'requestUrl', 'finalUrl', 'redirects', 'headers',
    ...(asset ? ['source', 'references'] : [])], 'BASEROW_CAPTURE_RESOURCE_INVALID');
  if (item.file !== filename || !HASH.test(item.sha256 ?? '') || item.status !== 200 || !validTime(item.receivedAt) ||
      typeof item.requestUrl !== 'string' || item.requestUrl.length > 32768 ||
      typeof item.finalUrl !== 'string' || item.finalUrl.length > 32768 ||
      !Array.isArray(item.redirects) || item.redirects.length > 3) throw fault('BASEROW_CAPTURE_RESOURCE_INVALID');
  integer(item.bytes, asset ? 0 : 1, asset ? selection.attachments.maxFileBytes : MAX_PAGE_BYTES, 'BASEROW_CAPTURE_RESOURCE_SIZE_INVALID');
  checkedHeaders(item.headers);
  if (!asset && (item.finalUrl !== item.requestUrl || item.redirects.length)) throw fault('BASEROW_API_REDIRECT_CHANGED');
  if (asset) {
    let current = item.requestUrl;
    checkedAttachmentUrl(current, selection.attachments.allowedOrigins, true);
    const seen = new Set([current]);
    for (const hop of item.redirects) {
      only(hop, ['from', 'to', 'status', 'receivedAt', 'headers'], 'BASEROW_ATTACHMENT_REDIRECT_INVALID');
      if (hop.from !== current || ![301, 302, 303, 307, 308].includes(hop.status) ||
          !validTime(hop.receivedAt) || Date.parse(hop.receivedAt) > Date.parse(item.receivedAt) || seen.has(hop.to))
        throw fault('BASEROW_ATTACHMENT_REDIRECT_INVALID');
      checkedAttachmentUrl(hop.to, selection.attachments.allowedOrigins, true); checkedHeaders(hop.headers);
      seen.add(hop.to); current = hop.to;
    }
    if (item.finalUrl !== current) throw fault('BASEROW_ATTACHMENT_REDIRECT_INVALID');
  }
}
function acceptRows(response, selection, seen, rows, expectedCount, maximum) {
  if (response.count !== expectedCount) throw fault('BASEROW_COUNT_CHANGED_DURING_CAPTURE');
  const keys = new Set(selection.fields.map(item => 'field_' + item.id));
  for (const row of response.results) {
    const id = recordIdentity(row);
    if (seen.has(id)) throw fault('BASEROW_DUPLICATE_RECORD_ID', 'The original paginated read repeated a row ID. Review concurrent source changes before another capture.');
    seen.add(id);
    if ([...keys].some(key => !Object.hasOwn(row, key)) ||
        Object.keys(row).some(key => !['id', 'order'].includes(key) && !keys.has(key)))
      throw fault('BASEROW_PROVIDER_PROJECTION_CHANGED');
    rows.push(row);
    if (rows.length > maximum) throw fault('BASEROW_CAPTURE_TOO_MANY_ROWS');
  }
  if (!response.results.length && response.next !== null) throw fault('BASEROW_EMPTY_INTERMEDIATE_PAGE');
}
function nextPage(response, current, selection, number, requestedPageSize, appliedQuerySize) {
  if (response.next === null) return null;
  return validateRecordUrl(new URL(response.next, current).href, selection,
    { expectedPage: number + 1, requestedPageSize, appliedQuerySize });
}
function attachmentPlan(rows, selection) {
  const planned = new Map();
  if (selection.attachments.mode !== 'retain') return [];
  const fields = selection.fields.filter(item => item.type === 'file');
  for (const row of rows) for (const field of fields) {
    const key = 'field_' + field.id, files = row[key];
    if (files === null) continue;
    if (!Array.isArray(files)) throw fault('BASEROW_FILE_FIELD_INVALID');
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      if (!object(file) || typeof file.url !== 'string' || typeof file.name !== 'string' || !file.name.length ||
          typeof file.visible_name !== 'string' || typeof file.mime_type !== 'string') throw fault('BASEROW_FILE_METADATA_INVALID');
      const size = countValue(file.size);
      if (size > selection.attachments.maxFileBytes) throw fault('BASEROW_ATTACHMENT_TOO_LARGE');
      checkedAttachmentUrl(file.url, selection.attachments.allowedOrigins, true);
      const source = { url: file.url, storageName: file.name, declaredBytes: size, mimeType: file.mime_type };
      const id = identity(source);
      if (!planned.has(id)) planned.set(id, { source, references: [] });
      planned.get(id).references.push({ recordId: recordIdentity(row), field: key, index });
      if (planned.size > selection.attachments.maxFiles) throw fault('BASEROW_TOO_MANY_ATTACHMENTS');
    }
  }
  return [...planned.values()];
}
function attachmentIndex(items) {
  const result = new Map();
  for (const item of items) for (const ref of item.references) {
    const key = ref.recordId + ':' + ref.field + ':' + ref.index;
    if (result.has(key)) throw fault('BASEROW_ATTACHMENT_REFERENCE_DUPLICATE');
    result.set(key, item);
  }
  return result;
}
function checkProjections(rows, queries, attachments) {
  for (const row of rows) for (const query of Object.values(queries))
    for (const spec of Object.values(query.projection)) projectedBaserowValue(row, spec, attachments);
}
export async function captureBaserowSource(config, directory, options = {}) {
  const queries = compileQueries(config.queries), selection = sourceSelection(config, queries);
  const reader = createBaserowReader(config, options);
  await privateDirectory(dirname(directory)); await mkdir(directory, { mode: 0o700 }); await privateDirectory(directory);
  const startedAt = stamp(), pages = [], records = [], attachments = [], seen = new Set(), resources = new Map();
  let sourceBytes = 0;
  const retain = async (file, observation) => {
    if (sourceBytes + observation.content.length > reader.options.maxCaptureBytes) throw fault('BASEROW_CAPTURE_TOO_LARGE');
    await createFile(join(directory, file), observation.content); sourceBytes += observation.content.length;
    resources.set(file, observation.content); return descriptor(file, observation);
  };
  try {
    const initialMetadata = await reader.get(metadataUrl(selection));
    const before = inspectMetadataBytes(initialMetadata.content, selection, selection.fields);
    const metadataBefore = await retain('metadata-before.json', initialMetadata);
    let url = recordsUrl(selection, reader.options.pageSize), appliedQuerySize = null, expectedCount = null, firstIds = null;
    for (let number = 1; ; number++) {
      if (number > reader.options.maxPages) throw fault('BASEROW_CAPTURE_TOO_MANY_PAGES');
      const observed = await reader.get(url), response = parseBaserowRecords(observed.content);
      if (number === 1) { expectedCount = response.count; firstIds = identityDigest(response.results); }
      if (expectedCount > reader.options.maxRows) throw fault('BASEROW_CAPTURE_TOO_MANY_ROWS');
      if (response.results.length > (appliedQuerySize ?? reader.options.pageSize)) throw fault('BASEROW_PROVIDER_PAGE_SIZE_CHANGED');
      acceptRows(response, selection, seen, records, expectedCount, reader.options.maxRows);
      pages.push(await retain(PAGE_NAME(number), observed));
      const next = nextPage(response, url, selection, number, reader.options.pageSize, appliedQuerySize);
      if (next === null) break;
      appliedQuerySize = next.size; url = next.url;
    }
    if (records.length !== expectedCount) throw fault('BASEROW_INCOMPLETE_ROW_COUNT');
    const closing = await reader.get(recordsUrl(selection, reader.options.pageSize));
    const finalRows = parseBaserowRecords(closing.content);
    const closingPage = await retain('closing-page.json', closing);
    if (finalRows.count !== expectedCount || identityDigest(finalRows.results) !== firstIds)
      throw fault('BASEROW_SOURCE_CHANGED_DURING_CAPTURE', 'The closing count or first-page row order changed. Reopen the retained observations and capture after reviewing source writes.');
    const finalMetadata = await reader.get(metadataUrl(selection));
    const after = inspectMetadataBytes(finalMetadata.content, selection, selection.fields);
    const metadataAfter = await retain('metadata-after.json', finalMetadata);
    if (before.schemaSha256 !== after.schemaSha256) throw fault('BASEROW_SCHEMA_CHANGED_DURING_CAPTURE');
    for (const planned of attachmentPlan(records, selection)) {
      const observed = await reader.getAttachment(new URL(planned.source.url), selection.attachments);
      if (observed.content.length !== planned.source.declaredBytes) throw fault('BASEROW_ATTACHMENT_SIZE_CHANGED');
      attachments.push({ ...await retain(ASSET_NAME(attachments.length + 1), observed), ...planned });
    }
    const files = attachmentIndex(attachments);
    checkProjections(records, queries, files);
    const manifest = { schema: 'stellar-forge.baserow-capture.v1', provider: 'baserow', apiVersion: 'database',
      transport: 'baserow-rest', method: 'GET', readOnly: true, complete: true, responseKind: 'PAGED_TABLE_READ',
      atomicSourceSnapshot: false, selection, selectionSha256: identity(selection),
      startedAt, completedAt: stamp(), requestedPageSize: reader.options.pageSize, appliedQuerySize,
      metadataBefore, pages, closingPage, metadataAfter, countVerified: true, schemaSha256: before.schemaSha256,
      rowCount: records.length, pageCount: pages.length, sourceBytes, recordIdentitiesSha256: identityDigest(records),
      attachments, attachmentCount: attachments.length, attachmentsComplete: selection.attachments.mode === 'retain',
      attachmentBytes: attachments.reduce((sum, item) => sum + item.bytes, 0),
      metadataScope: selection.kind === 'public-grid' ? 'public-view-and-visible-fields' : 'authorized-table-fields' };
    const manifestBytes = bytes(manifest);
    if (manifestBytes.length > MAX_PAGE_BYTES) throw fault('BASEROW_CAPTURE_MANIFEST_TOO_LARGE');
    await createFile(join(directory, 'capture.json'), manifestBytes);
    await syncDirectory(directory); await syncDirectory(dirname(directory));
    return { manifest, manifestBytes, manifestFile: join(directory, 'capture.json'),
      manifestSha256: digest(manifestBytes), resources, records, attachments: files, table: before };
  } catch (issue) {
    const failure = { schema: 'stellar-forge.baserow-incomplete-capture.v1', complete: false, startedAt,
      stoppedAt: stamp(), completedPages: pages.length, retainedAttachments: attachments.length, retainedBytes: sourceBytes,
      code: issue.code ?? 'BASEROW_CAPTURE_FAILED', providerStatus: issue.providerStatus ?? null,
      requestId: issue.requestId ?? null, retryAfter: issue.retryAfter ?? null };
    try { await createFile(join(directory, 'incomplete.json'), bytes(failure)); await syncDirectory(directory); } catch {}
    throw issue;
  }
}
export async function readBaserowCapture(filename, expectedHash) {
  const manifestBytes = await readPrivate(filename, MAX_PAGE_BYTES), manifest = json(manifestBytes);
  if (expectedHash !== undefined && digest(manifestBytes) !== expectedHash) throw fault('BASEROW_CAPTURE_MANIFEST_CHANGED');
  only(manifest, ['schema', 'provider', 'apiVersion', 'transport', 'method', 'readOnly', 'complete', 'responseKind',
    'atomicSourceSnapshot', 'selection', 'selectionSha256', 'startedAt', 'completedAt', 'requestedPageSize', 'appliedQuerySize',
    'metadataBefore', 'pages', 'closingPage', 'metadataAfter', 'countVerified', 'schemaSha256', 'rowCount', 'pageCount',
    'sourceBytes', 'recordIdentitiesSha256', 'attachments', 'attachmentCount', 'attachmentsComplete', 'attachmentBytes', 'metadataScope'],
    'BASEROW_CAPTURE_MANIFEST_INVALID');
  if (manifest.schema !== 'stellar-forge.baserow-capture.v1' || manifest.provider !== 'baserow' ||
      manifest.apiVersion !== 'database' || manifest.transport !== 'baserow-rest' || manifest.method !== 'GET' ||
      manifest.readOnly !== true || manifest.complete !== true || manifest.responseKind !== 'PAGED_TABLE_READ' ||
      manifest.atomicSourceSnapshot !== false || manifest.countVerified !== true ||
      !validTime(manifest.startedAt) || !validTime(manifest.completedAt) || Date.parse(manifest.startedAt) > Date.parse(manifest.completedAt) ||
      !HASH.test(manifest.schemaSha256 ?? '') || !HASH.test(manifest.recordIdentitiesSha256 ?? ''))
    throw fault('BASEROW_CAPTURE_MANIFEST_INVALID');
  const selection = selectionShape(manifest.selection);
  if (identity(selection) !== manifest.selectionSha256) throw fault('BASEROW_CAPTURE_SELECTION_CHANGED');
  integer(manifest.requestedPageSize, 1, 200, 'BASEROW_CAPTURE_PAGE_SIZE_INVALID');
  if (manifest.appliedQuerySize !== null) integer(manifest.appliedQuerySize, 1, manifest.requestedPageSize, 'BASEROW_CAPTURE_PAGE_SIZE_INVALID');
  integer(manifest.pageCount, 1, 10000, 'BASEROW_CAPTURE_PAGE_COUNT_INVALID');
  integer(manifest.rowCount, 0, 1000000, 'BASEROW_CAPTURE_ROW_COUNT_INVALID');
  integer(manifest.sourceBytes, 1, MAX_CAPTURE_BYTES, 'BASEROW_CAPTURE_BYTES_INVALID');
  integer(manifest.attachmentCount, 0, selection.attachments.maxFiles, 'BASEROW_CAPTURE_ATTACHMENTS_INVALID');
  integer(manifest.attachmentBytes, 0, MAX_CAPTURE_BYTES, 'BASEROW_CAPTURE_ATTACHMENTS_INVALID');
  if (!Array.isArray(manifest.pages) || manifest.pages.length !== manifest.pageCount ||
      !Array.isArray(manifest.attachments) || manifest.attachments.length !== manifest.attachmentCount ||
      manifest.attachmentsComplete !== (selection.attachments.mode === 'retain') ||
      selection.attachments.mode === 'metadata' && manifest.attachmentCount !== 0 ||
      manifest.metadataScope !== (selection.kind === 'public-grid' ? 'public-view-and-visible-fields' : 'authorized-table-fields'))
    throw fault('BASEROW_CAPTURE_CONTENT_INVALID');
  const resources = new Map(); let total = 0, lastTime = Date.parse(manifest.startedAt);
  const read = async (item, file, asset = false) => {
    checkedDescriptor(item, file, selection, asset);
    const time = Date.parse(item.receivedAt);
    if (time < lastTime || time > Date.parse(manifest.completedAt)) throw fault('BASEROW_CAPTURE_TIME_ORDER_INVALID');
    lastTime = time;
    const content = await readPrivate(join(dirname(filename), file), asset ? selection.attachments.maxFileBytes : MAX_PAGE_BYTES);
    if (content.length !== item.bytes || digest(content) !== item.sha256) throw fault('BASEROW_CAPTURE_RESOURCE_CHANGED');
    total += content.length; if (total > manifest.sourceBytes) throw fault('BASEROW_CAPTURE_BYTES_CHANGED');
    resources.set(file, content); return content;
  };
  if (manifest.metadataBefore?.requestUrl !== metadataUrl(selection).href ||
      manifest.metadataAfter?.requestUrl !== metadataUrl(selection).href)
    throw fault('BASEROW_CAPTURE_METADATA_URL_CHANGED');
  const before = inspectMetadataBytes(await read(manifest.metadataBefore, 'metadata-before.json'), selection, selection.fields);
  const records = [], seen = new Set(); let firstIds = null, appliedQuerySize = null, expected = recordsUrl(selection, manifest.requestedPageSize);
  for (let index = 0; index < manifest.pages.length; index++) {
    const item = manifest.pages[index], number = index + 1;
    if (item.requestUrl !== expected.href) throw fault('BASEROW_CAPTURE_CONTINUATION_CHANGED');
    const response = parseBaserowRecords(await read(item, PAGE_NAME(number)));
    if (response.results.length > (appliedQuerySize ?? manifest.requestedPageSize)) throw fault('BASEROW_PROVIDER_PAGE_SIZE_CHANGED');
    if (index === 0) firstIds = identityDigest(response.results);
    acceptRows(response, selection, seen, records, manifest.rowCount, manifest.rowCount);
    const next = nextPage(response, expected, selection, number, manifest.requestedPageSize, appliedQuerySize);
    if (index === manifest.pages.length - 1 ? next !== null : next === null) throw fault('BASEROW_CAPTURE_INCOMPLETE');
    if (next) { appliedQuerySize = next.size; expected = next.url; }
  }
  if (manifest.closingPage?.requestUrl !== recordsUrl(selection, manifest.requestedPageSize).href)
    throw fault('BASEROW_CAPTURE_CLOSING_PAGE_CHANGED');
  const closing = parseBaserowRecords(await read(manifest.closingPage, 'closing-page.json'));
  if (closing.count !== manifest.rowCount || identityDigest(closing.results) !== firstIds) throw fault('BASEROW_CAPTURE_COUNT_CHANGED');
  const after = inspectMetadataBytes(await read(manifest.metadataAfter, 'metadata-after.json'), selection, selection.fields);
  if (before.schemaSha256 !== after.schemaSha256 || before.schemaSha256 !== manifest.schemaSha256 ||
      records.length !== manifest.rowCount || appliedQuerySize !== manifest.appliedQuerySize ||
      identityDigest(records) !== manifest.recordIdentitiesSha256) throw fault('BASEROW_CAPTURE_CONTENT_CHANGED');
  const planned = attachmentPlan(records, selection);
  if (planned.length !== manifest.attachments.length) throw fault('BASEROW_CAPTURE_ATTACHMENTS_CHANGED');
  let attachmentBytes = 0;
  for (let index = 0; index < planned.length; index++) {
    const item = manifest.attachments[index], expected = planned[index];
    if (identity(item.source) !== identity(expected.source) || identity(item.references) !== identity(expected.references) ||
        item.requestUrl !== expected.source.url || item.bytes !== expected.source.declaredBytes)
      throw fault('BASEROW_CAPTURE_ATTACHMENT_BINDING_CHANGED');
    await read(item, ASSET_NAME(index + 1), true); attachmentBytes += item.bytes;
  }
  if (total !== manifest.sourceBytes || attachmentBytes !== manifest.attachmentBytes) throw fault('BASEROW_CAPTURE_BYTES_CHANGED');
  return { manifest, manifestBytes, manifestFile: filename, manifestSha256: digest(manifestBytes), resources,
    records, attachments: attachmentIndex(manifest.attachments), table: before };
}
export function bindBaserowCapture(capture, config) {
  const queries = compileQueries(config.queries);
  if (identity(sourceSelection(config, queries)) !== capture.manifest.selectionSha256)
    throw fault('BASEROW_CAPTURE_SELECTION_MISMATCH', 'Reopen the original view/table, selected fields, filters, order and attachment policy.');
  checkProjections(capture.records, queries, capture.attachments);
  return capture.records;
}
export async function copyBaserowCapture(capture, directory) {
  await privateDirectory(dirname(directory)); await mkdir(directory, { mode: 0o700 }); await privateDirectory(directory);
  for (const item of [capture.manifest.metadataBefore, ...capture.manifest.pages, capture.manifest.closingPage,
    capture.manifest.metadataAfter, ...capture.manifest.attachments]) {
    const content = capture.resources.get(item.file);
    if (!content || content.length !== item.bytes || digest(content) !== item.sha256) throw fault('BASEROW_CAPTURE_COPY_CHANGED');
    await createFile(join(directory, item.file), content);
  }
  await createFile(join(directory, 'capture.json'), capture.manifestBytes);
  await syncDirectory(directory); await syncDirectory(dirname(directory));
  return { ...capture, manifestFile: join(directory, 'capture.json') };
}
export async function importBaserowCapture(filename, directory, config) {
  const capture = await readBaserowCapture(filename); bindBaserowCapture(capture, config);
  return copyBaserowCapture(capture, directory);
}
export async function exportBaserowAttachments(filename, directory) {
  const capture = await readBaserowCapture(filename);
  if (!capture.manifest.attachmentsComplete) throw fault('BASEROW_RETAINED_ATTACHMENTS_REQUIRED');
  await privateDirectory(dirname(directory)); await mkdir(directory, { mode: 0o700 }); await privateDirectory(directory);
  for (const item of capture.manifest.attachments)
    await createFile(join(directory, item.file), capture.resources.get(item.file));
  const result = { schema: 'stellar-forge.baserow-attachment-delivery.v1', captureSha256: capture.manifestSha256,
    source: capture.manifest.selection, files: capture.manifest.attachments.map(item => ({
      file: item.file, bytes: item.bytes, sha256: item.sha256, source: item.source, references: item.references })) };
  await createFile(join(directory, 'attachments.json'), bytes(result)); await syncDirectory(directory); await syncDirectory(dirname(directory));
  return { directory, file: join(directory, 'attachments.json'), ...result };
}
