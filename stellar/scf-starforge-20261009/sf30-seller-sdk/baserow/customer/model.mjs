// MIT. Original Baserow publisher pages -> complete source-bound customer packet.
import { dirname, join, resolve } from 'node:path';
import { mkdir, rename, rm, open, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { init, appendMany, scan, finalize, checkPage, MAX_DATASET_PAGES,
  MAX_DATASET_PAGE_BYTES } from '../../../sf100-buyer-dataset-delivery/deliver.mjs';
import { readBaserowSourceFile, binding, compileQueries, fieldId } from '../declaration.mjs';
import { readBaserowCapture, bindBaserowCapture } from '../capture.mjs';
import { recordIdentity, projectedBaserowValue } from '../values.mjs';
import { openBaserowPublisher } from '../publisher/model.mjs';
import { object, bytes, digest, identity, rootDirectory, privateDirectory, readPrivate,
  readJson, hashPrivate, syncDirectory, acquireWorkspace, fault, check, same, once,
  exists, cancelled, describeFile, validateFiles, copyExact, descriptor, fileLimit,
  MAX_METADATA_BYTES, HASH, UUID } from './files.mjs';

export const BASEROW_CUSTOMER_SCHEMA = 'stellar-forge.baserow-customer-delivery.v1';
export const BASEROW_CUSTOMER_SOURCE_SCHEMA = 'stellar-forge.baserow-customer-source.v1';
export const BASEROW_CUSTOMER_ATTACHMENTS_SCHEMA = 'stellar-forge.baserow-customer-attachments.v1';
export const BASEROW_CUSTOMER_MANIFEST = 'customer-manifest.json';
const REQUEST_SCHEMA = 'stellar-forge.baserow-customer-request.v1';
const FIELD = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;
const KEY = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const recordId = value => typeof value === 'string' && /^[1-9][0-9]*$/.test(value);
const pageName = index => String(index).padStart(5, '0') + '.json';
const nativeNames = state => ['dataset/session.json',
  ...state.pages.map((_, index) => 'dataset/pages/' + pageName(index)),
  'dataset/manifest.json', 'dataset/dataset.jsonl', 'dataset/dataset.csv', 'dataset/review.html'];
const sourceKey = logical => 'baserow-' + identity(logical);
async function listedJson(root, manifest, name) {
  const listed = manifest.files.find(file => file.name === name);
  check(listed, 'BASEROW_CUSTOMER_COMPLETE_FILE_SET_CHANGED');
  const raw = await readPrivate(join(root, name), fileLimit(name));
  check(raw.length === listed.bytes && digest(raw) === listed.sha256, 'BASEROW_CUSTOMER_FILE_CHANGED');
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
  catch { throw fault('BASEROW_CUSTOMER_JSON_INVALID'); }
}
const descendant = (parent, path) => path === parent || path.startsWith(parent + '/');
function queryFor(value, snapshot, defaultLimit) {
  check(typeof value === 'string' && value.length <= 8192 && !value.includes('\0'),
    'BASEROW_CUSTOMER_QUERY_INVALID');
  const query = new URLSearchParams(value);
  const seen = new Set();
  for (const [key] of query) {
    check(!seen.has(key) && key !== 'cursor', 'BASEROW_CUSTOMER_QUERY_MUST_START_AT_FIRST_PAGE');
    seen.add(key);
  }
  check(!query.has('snapshot') || query.get('snapshot') === snapshot, 'BASEROW_CUSTOMER_SNAPSHOT_CHANGED');
  query.set('snapshot', snapshot);
  if (!query.has('limit')) query.set('limit', String(defaultLimit));
  return query;
}
function requestFor(options) {
  const { publisher, runId, expectedCandidateDigest, expectedSnapshot, customerKey,
    query = '', requestId } = options;
  check(publisher && typeof publisher.candidate === 'function' && typeof publisher.plan === 'function' &&
    typeof publisher.directory === 'string', 'BASEROW_CUSTOMER_ORIGINAL_PUBLISHER_REQUIRED');
  check(UUID.test(runId ?? '') && UUID.test(requestId ?? '') &&
    HASH.test(expectedCandidateDigest ?? '') && HASH.test(expectedSnapshot ?? '') &&
    KEY.test(customerKey ?? '') && typeof query === 'string' && query.length <= 8192,
    'BASEROW_CUSTOMER_SELECTION_REQUIRED');
  return { schema: REQUEST_SCHEMA, requestId, customerKey, publisherDirectory: publisher.directory,
    runId, expectedCandidateDigest, expectedSnapshot, query };
}
function originalResponse(candidate, query) {
  const response = candidate.dataset.handle({ query });
  check(response && response.status === 200, response?.body?.error ?? 'BASEROW_CUSTOMER_NATIVE_QUERY_REJECTED',
    response?.body?.message ?? 'Review the original published dataset query.');
  return { payload: response.body, checked: checkPage(response.body) };
}
function selectedProjection(plan, payload) {
  const original = plan.data.sourceQuery.projection;
  check(object(original), 'BASEROW_CUSTOMER_ORIGINAL_PROJECTION_REQUIRED');
  const columns = payload.fields.map(name => {
    const spec = original[name], physical = payload.dataset.columns.find(column => column.name === name);
    check(object(spec) && physical && physical.type === spec.type, 'BASEROW_CUSTOMER_PROJECTION_CHANGED');
    check(spec.providerType !== 'file' || spec.encoding === 'attachments',
      'BASEROW_CUSTOMER_ORIGINAL_FILE_ENCODING_REQUIRED',
      'Select the retained attachments encoding for each customer file column.');
    return { name, ...structuredClone(spec) };
  });
  const keys = columns.filter(column => column.source === '$recordId' &&
    column.type === 'string' && column.encoding === 'identity-text' && column.nullable === false);
  check(keys.length >= 1, 'BASEROW_CUSTOMER_ORIGINAL_RECORD_ID_REQUIRED',
    'Include an original $recordId Text/identity-text column in the customer query.');
  return { columns, recordIdColumn: keys[0].name };
}
function logicalFor(selected, plan, columns) {
  return { provider: 'baserow', ...binding(selected.config), queryName: plan.data.query, columns };
}
function validateSource(source, manifest) {
  check(object(source) && source.schema === BASEROW_CUSTOMER_SOURCE_SCHEMA &&
    source.customerKey === manifest.customerKey && source.sourceKey === manifest.sourceKey &&
    source.logicalSourceSha256 === manifest.logicalSourceSha256 &&
    source.recordIdColumn === manifest.recordIdColumn && object(source.logicalSource) &&
    source.logicalSource.provider === 'baserow', 'BASEROW_CUSTOMER_SOURCE_BINDING_CHANGED');
  const logical = source.logicalSource;
  check(typeof logical.queryName === 'string' && FIELD.test(logical.queryName) &&
    Array.isArray(logical.columns) && logical.columns.length >= 1 && logical.columns.length <= 64,
    'BASEROW_CUSTOMER_LOGICAL_SOURCE_INVALID');
  same(binding(logical), Object.fromEntries(['server', 'kind', 'slug', 'tableId', 'viewId',
    'filters', 'search', 'orderBy'].map(key => [key, logical[key]])), 'BASEROW_CUSTOMER_LOGICAL_SOURCE_INVALID');
  const input = Object.fromEntries(logical.columns.map(column => {
    check(object(column) && typeof column.name === 'string' && FIELD.test(column.name),
      'BASEROW_CUSTOMER_LOGICAL_SOURCE_INVALID');
    const { name, ...spec } = column; return [name, spec];
  }));
  check(Object.keys(input).length === logical.columns.length, 'BASEROW_CUSTOMER_LOGICAL_SOURCE_INVALID');
  const compiled = compileQueries({ [logical.queryName]: { columns: input } })[logical.queryName];
  same(compiled.columns, manifest.dataset.fields, 'BASEROW_CUSTOMER_SELECTED_COLUMNS_CHANGED');
  same(logical.columns, compiled.columns.map(name => ({ name, ...compiled.projection[name] })),
    'BASEROW_CUSTOMER_PROJECTION_CHANGED');
  check(identity(logical) === source.logicalSourceSha256 && sourceKey(logical) === source.sourceKey &&
    source.sourceKey === 'baserow-' + source.logicalSourceSha256, 'BASEROW_CUSTOMER_LOGICAL_SOURCE_CHANGED');
  const key = compiled.projection[manifest.recordIdColumn];
  check(key?.source === '$recordId' && key.type === 'string' && key.encoding === 'identity-text' &&
    key.nullable === false, 'BASEROW_CUSTOMER_ORIGINAL_RECORD_ID_REQUIRED');
  const publication = source.publication, capture = source.capture;
  check(object(publication) && UUID.test(publication.runId ?? '') &&
    Number.isSafeInteger(publication.planId) && publication.planId >= 1 &&
    publication.state === 'PUBLISHED' && publication.snapshot === manifest.dataset.snapshot &&
    ['planDigest', 'sourceHash', 'runtimeSourceHash', 'queryHash', 'candidateDigest',
      'csvSha256', 'datasetConfigSha256'].every(key => HASH.test(publication[key] ?? '')) &&
    object(capture) && ['sha256', 'selectionSha256', 'schemaSha256', 'recordIdentitiesSha256']
      .every(key => HASH.test(capture[key] ?? '')) && capture.atomicSourceSnapshot === false &&
    capture.responseKind === 'PAGED_TABLE_READ' && Number.isSafeInteger(capture.rows) &&
    capture.rows >= manifest.dataset.rows && Number.isSafeInteger(capture.pages) && capture.pages >= 1 &&
    typeof capture.startedAt === 'string' && typeof capture.completedAt === 'string',
    'BASEROW_CUSTOMER_ORIGINAL_EDITION_CHANGED');
  check(object(source.query) && source.query.querySha256 === manifest.dataset.querySha256,
    'BASEROW_CUSTOMER_QUERY_CHANGED');
  same(source.query.fields, manifest.dataset.fields, 'BASEROW_CUSTOMER_QUERY_CHANGED');
  check(Array.isArray(source.originalFields), 'BASEROW_CUSTOMER_FIELD_DEFINITIONS_REQUIRED');
  check(source.originalFields.every(field => object(field)), 'BASEROW_CUSTOMER_FIELD_DEFINITIONS_REQUIRED');
  const fields = new Map(source.originalFields.map(field => [field.id, field]));
  for (const column of logical.columns) {
    if (column.source.startsWith('$')) continue;
    const field = fields.get(fieldId(column.source));
    check(field && field.type === column.providerType, 'BASEROW_CUSTOMER_FIELD_DEFINITION_CHANGED');
  }
  return compiled;
}
function attachmentIndex(attachments, source, manifest) {
  check(object(attachments) && attachments.schema === BASEROW_CUSTOMER_ATTACHMENTS_SCHEMA &&
    attachments.captureSha256 === source.capture.sha256 &&
    attachments.logicalSourceSha256 === manifest.logicalSourceSha256 &&
    attachments.recordIdColumn === manifest.recordIdColumn && Array.isArray(attachments.files) &&
    attachments.files.length <= 10000, 'BASEROW_CUSTOMER_ATTACHMENTS_CHANGED');
  const files = new Map(), refs = new Map(); let totalBytes = 0, referenceCount = 0;
  const projections = new Map(source.logicalSource.columns.map(column => [column.name, column]));
  for (const file of attachments.files) {
    check(object(file) && /^attachment-[0-9]{6}\.bin$/.test(file.originalFile ?? '') &&
      file.file === 'attachments/' + file.originalFile && !files.has(file.file) &&
      Number.isSafeInteger(file.bytes) && file.bytes >= 0 && file.bytes <= 33554432 &&
      HASH.test(file.sha256 ?? '') && object(file.source) && typeof file.source.url === 'string' &&
      typeof file.source.storageName === 'string' && typeof file.source.mimeType === 'string' &&
      file.source.declaredBytes === file.bytes && Array.isArray(file.references) && file.references.length > 0,
      'BASEROW_CUSTOMER_ATTACHMENT_FILE_INVALID');
    files.set(file.file, file); totalBytes += file.bytes;
    for (const ref of file.references) {
      const spec = object(ref) && projections.get(ref.column);
      check(object(ref) && recordId(ref.recordId) && spec?.source === ref.field &&
        spec.encoding === 'attachments' && spec.providerType === 'file' &&
        Number.isSafeInteger(ref.index) && ref.index >= 0 && typeof ref.name === 'string',
        'BASEROW_CUSTOMER_ATTACHMENT_REFERENCE_INVALID');
      const key = [ref.recordId, ref.column, ref.index].join(':');
      check(!refs.has(key), 'BASEROW_CUSTOMER_DUPLICATE_ATTACHMENT_REFERENCE');
      refs.set(key, { file, ref }); referenceCount++;
    }
  }
  check(files.size === manifest.attachments.count && referenceCount === manifest.attachments.referenceCount &&
    totalBytes === manifest.attachments.totalBytes, 'BASEROW_CUSTOMER_ATTACHMENT_TOTAL_CHANGED');
  return { files, refs };
}
function validateAttachmentValue(value, item) {
  check(object(value) && value.name === item.ref.name &&
    value.storageName === item.file.source.storageName && value.mimeType === item.file.source.mimeType &&
    value.bytes === item.file.bytes && value.sha256 === item.file.sha256 &&
    value.sourceUrl === item.file.source.url, 'BASEROW_CUSTOMER_ATTACHMENT_VALUE_CHANGED');
}
async function validateNative(root, manifest, source, attachments, signal) {
  const nativeRoot = join(root, 'dataset'), state = await scan(nativeRoot, { retainPayload: false });
  const native = await listedJson(root, manifest, 'dataset/manifest.json');
  check(state.finalized && state.pages.length >= 1 && state.nextCursor === null && state.count === state.total &&
    state.count === manifest.dataset.rows && state.pages.length === manifest.dataset.pages &&
    state.snapshot === manifest.dataset.snapshot && state.queryHash === manifest.dataset.querySha256 &&
    state.chain === manifest.dataset.chainDigest && state.semantics === null,
    'BASEROW_CUSTOMER_COMPLETE_NATIVE_DATASET_CHANGED');
  same(state.fields, manifest.dataset.fields);
  check(native.schema === 'stellar-forge.buyer-delivery-manifest.v1' &&
    native.chainDigest === state.chain && native.dataset?.originalQueryHash === state.queryHash &&
    native.dataset?.originalQuerySignature === state.pages[0].signature &&
    native.dataset?.snapshot === state.snapshot && native.dataset?.rows === state.count &&
    native.dataset?.name === state.name, 'BASEROW_CUSTOMER_NATIVE_MANIFEST_CHANGED');
  same(native.dataset.projectedFields, state.fields);
  same(native.dataset.filters, source.query.filters);
  same(native.dataset.ranges, source.query.ranges);
  same(native.dataset.order, source.query.order);
  same(native.sourcePages, state.pages.map(page => ({ index: page.index, intent: page.intent,
    sourceSha256: page.sourceSha256, evidenceSha256: page.evidenceSha256,
    recordDigest: page.chain, rows: page.returned, requestedCursor: page.requestCursor })),
    'BASEROW_CUSTOMER_NATIVE_PAGES_CHANGED');
  const outputs = ['dataset.jsonl', 'dataset.csv', 'review.html'];
  same(Object.keys(native.outputs).sort(), [...outputs].sort(), 'BASEROW_CUSTOMER_NATIVE_OUTPUTS_CHANGED');
  for (const name of outputs) {
    const file = manifest.files.find(item => item.name === 'dataset/' + name);
    same(native.outputs[name], { bytes: file?.bytes, sha256: file?.sha256 },
      'BASEROW_CUSTOMER_NATIVE_OUTPUTS_CHANGED');
  }
  const selected = attachmentIndex(attachments, source, manifest), seenRows = new Set(), seenRefs = new Set();
  const fileColumns = source.logicalSource.columns.filter(column => column.encoding === 'attachments');
  const jsonl = createHash('sha256'); let jsonlBytes = 0;
  for (const item of state.pages) {
    cancelled(signal);
    const archive = await listedJson(root, manifest, 'dataset/pages/' + pageName(item.index));
    check(archive.chain === item.chain && archive.payload?.dataset?.snapshot === state.snapshot,
      'BASEROW_CUSTOMER_NATIVE_PAGE_CHANGED');
    const physical = archive.payload.dataset.columns;
    for (const column of source.logicalSource.columns)
      check(physical.some(field => field.name === column.name && field.type === column.type),
        'BASEROW_CUSTOMER_NATIVE_COLUMN_CHANGED');
    for (const row of archive.payload.rows) {
      const id = row[manifest.recordIdColumn];
      check(recordId(id) && !seenRows.has(id), 'BASEROW_CUSTOMER_RECORD_ID_CHANGED');
      seenRows.add(id);
      const text = JSON.stringify(row) + '\n'; jsonl.update(text); jsonlBytes += Buffer.byteLength(text);
      for (const column of fileColumns) {
        if (row[column.name] === null) continue;
        check(typeof row[column.name] === 'string', 'BASEROW_CUSTOMER_ATTACHMENT_VALUE_CHANGED');
        let values; try { values = JSON.parse(row[column.name]); } catch { throw fault('BASEROW_CUSTOMER_ATTACHMENT_VALUE_CHANGED'); }
        check(Array.isArray(values), 'BASEROW_CUSTOMER_ATTACHMENT_VALUE_CHANGED');
        for (let index = 0; index < values.length; index++) {
          const key = [id, column.name, index].join(':'), value = selected.refs.get(key);
          check(value && !seenRefs.has(key), 'BASEROW_CUSTOMER_ATTACHMENT_REFERENCE_CHANGED');
          validateAttachmentValue(values[index], value); seenRefs.add(key);
        }
      }
    }
  }
  const rowsFile = manifest.files.find(file => file.name === 'dataset/dataset.jsonl');
  check(seenRows.size === state.count && seenRefs.size === selected.refs.size &&
    rowsFile.bytes === jsonlBytes && rowsFile.sha256 === jsonl.digest('hex'),
    'BASEROW_CUSTOMER_COMPLETE_ROWS_CHANGED');
  return { state, native, selected };
}
export async function readBaserowCustomer(directory, { expectedManifestSha256, signal } = {}) {
  await rootDirectory(directory); cancelled(signal);
  const raw = await readPrivate(join(directory, BASEROW_CUSTOMER_MANIFEST), MAX_METADATA_BYTES);
  const manifestSha256 = digest(raw);
  if (expectedManifestSha256 !== undefined)
    check(HASH.test(expectedManifestSha256) && manifestSha256 === expectedManifestSha256,
      'BASEROW_CUSTOMER_MANIFEST_CHANGED');
  let manifest; try { manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
  catch { throw fault('BASEROW_CUSTOMER_MANIFEST_INVALID'); }
  check(object(manifest) && manifest.schema === BASEROW_CUSTOMER_SCHEMA && UUID.test(manifest.requestId ?? '') &&
    KEY.test(manifest.customerKey ?? '') && HASH.test(manifest.logicalSourceSha256 ?? '') &&
    manifest.sourceKey === 'baserow-' + manifest.logicalSourceSha256 &&
    FIELD.test(manifest.recordIdColumn ?? '') && object(manifest.source) && manifest.source.file === 'source.json' &&
    object(manifest.attachments) && manifest.attachments.file === 'attachments.json' &&
    object(manifest.dataset) && manifest.dataset.directory === 'dataset' &&
    ['manifestSha256', 'snapshot', 'querySha256', 'chainDigest'].every(key => HASH.test(manifest.dataset[key] ?? '')) &&
    Number.isSafeInteger(manifest.dataset.rows) && manifest.dataset.rows >= 0 && manifest.dataset.rows <= 1000000 &&
    Number.isSafeInteger(manifest.dataset.pages) && manifest.dataset.pages >= 1 && manifest.dataset.pages <= MAX_DATASET_PAGES &&
    Array.isArray(manifest.dataset.fields) && manifest.dataset.fields.length >= 1 && manifest.dataset.fields.length <= 64,
    'BASEROW_CUSTOMER_MANIFEST_INVALID');
  const observed = await validateFiles(directory, manifest.files, signal);
  for (const item of [manifest.source, manifest.attachments]) {
    const listed = manifest.files.find(file => file.name === item.file);
    check(listed && listed.bytes === item.bytes && listed.sha256 === item.sha256,
      'BASEROW_CUSTOMER_METADATA_DESCRIPTOR_CHANGED');
  }
  check(manifest.files.find(file => file.name === 'dataset/manifest.json')?.sha256 === manifest.dataset.manifestSha256,
    'BASEROW_CUSTOMER_NATIVE_MANIFEST_CHANGED');
  const source = await listedJson(directory, manifest, 'source.json');
  const attachments = await listedJson(directory, manifest, 'attachments.json');
  validateSource(source, manifest);
  const native = await validateNative(directory, manifest, source, attachments, signal);
  const required = ['source.json', 'attachments.json', ...nativeNames(native.state),
    ...attachments.files.map(file => file.file)];
  same([...observed.names].sort(), required.sort(), 'BASEROW_CUSTOMER_COMPLETE_FILE_SET_CHANGED');
  for (const file of attachments.files) {
    same(manifest.files.find(item => item.name === file.file),
      { name: file.file, bytes: file.bytes, sha256: file.sha256 }, 'BASEROW_CUSTOMER_ATTACHMENT_FILE_CHANGED');
  }
  // Re-read both control documents after all asynchronous source reads.
  check(digest(await readPrivate(join(directory, BASEROW_CUSTOMER_MANIFEST), MAX_METADATA_BYTES)) === manifestSha256 &&
    digest(await readPrivate(join(directory, 'source.json'), MAX_METADATA_BYTES)) === manifest.source.sha256 &&
    digest(await readPrivate(join(directory, 'attachments.json'), MAX_METADATA_BYTES)) === manifest.attachments.sha256,
    'BASEROW_CUSTOMER_METADATA_CHANGED');
  return { directory, manifestFile: join(directory, BASEROW_CUSTOMER_MANIFEST), manifestSha256,
    manifest, source, attachments, bytes: observed.bytes };
}
async function originalSelection(publisher, request) {
  const run = publisher.run(request.runId);
  check(run.state === 'PUBLISHED' && run.data.publication?.snapshot === request.expectedSnapshot,
    'BASEROW_CUSTOMER_PUBLISHED_RUN_REQUIRED');
  const plan = publisher.plan(run.plan), candidate = await publisher.candidate(run.id);
  check(candidate.manifest.schema === 'stellar-forge.baserow-dataset-candidate.v1' &&
    candidate.manifest.candidateDigest === request.expectedCandidateDigest &&
    candidate.manifest.dataset.snapshot === request.expectedSnapshot &&
    plan.data.schema === 'stellar-forge.baserow-dataset-plan.v1', 'BASEROW_CUSTOMER_ORIGINAL_RUN_CHANGED');
  const planDirectory = join(publisher.directory, 'plans', plan.folder);
  const selected = await readBaserowSourceFile(join(planDirectory, 'source.json'));
  check(selected.hash === plan.data.runtimeSourceHash, 'BASEROW_CUSTOMER_RUNTIME_SOURCE_CHANGED');
  const captureFile = selected.captureFile ?? candidate.manifest.extraction.observation.capture.file;
  check(typeof captureFile === 'string' && resolve(captureFile) === captureFile && descendant(planDirectory, captureFile),
    'BASEROW_CUSTOMER_ORIGINAL_CAPTURE_REQUIRED');
  const captureHash = candidate.manifest.extraction.observation.capture.manifestSha256;
  const capture = await readBaserowCapture(captureFile, captureHash);
  bindBaserowCapture(capture, selected.config);
  check(capture.manifest.rowCount === candidate.manifest.extraction.rowCount &&
    capture.manifest.selectionSha256 === candidate.manifest.extraction.observation.capture.selectionSha256,
    'BASEROW_CUSTOMER_CAPTURE_CHANGED');
  return { run, plan, candidate, selected, capture };
}
async function rawPages(directory, candidate, initialQuery, request, recordIdColumn, columns, capture, signal) {
  const rawDirectory = join(directory, 'source-pages');
  await privateDirectory(rawDirectory, true);
  const inputs = [], files = new Map(), seenRows = new Set(); let cursor = null, rows = 0, queryCheck = null;
  const selectedFileColumns = columns.filter(column => column.encoding === 'attachments');
  const originalRecords = new Map(capture.records.map(row => [recordIdentity(row), row]));
  for (let index = 0; ; index++) {
    cancelled(signal);
    check(index < MAX_DATASET_PAGES, 'BASEROW_CUSTOMER_NATIVE_PAGE_LIMIT');
    const query = new URLSearchParams(initialQuery);
    if (cursor !== null) query.set('cursor', cursor);
    const response = originalResponse(candidate, query), payload = response.payload;
    check(payload.dataset.snapshot === request.expectedSnapshot, 'BASEROW_CUSTOMER_SNAPSHOT_CHANGED');
    if (queryCheck) check(response.checked.signature === queryCheck.signature, 'BASEROW_CUSTOMER_QUERY_CHANGED');
    else queryCheck = response.checked;
    const content = Buffer.from(JSON.stringify(payload) + '\n');
    check(content.length <= MAX_DATASET_PAGE_BYTES, 'BASEROW_CUSTOMER_NATIVE_PAGE_TOO_LARGE',
      'Choose a smaller original page limit; keep the same native query fields and filters.');
    const file = join(rawDirectory, pageName(index));
    await once(file, content);
    inputs.push({ page: file, intent: 'baserow-local-' + request.requestId + '-' + index,
      ...(cursor === null ? {} : { cursor }) });
    for (const row of payload.rows) {
      const id = row[recordIdColumn];
      check(recordId(id) && !seenRows.has(id), 'BASEROW_CUSTOMER_RECORD_ID_CHANGED'); seenRows.add(id); rows++;
      const originalRecord = originalRecords.get(id);
      check(originalRecord, 'BASEROW_CUSTOMER_SOURCE_ROW_MISSING');
      for (const column of columns) {
        const { name, ...spec } = column;
        same(row[name], projectedBaserowValue(originalRecord, spec, capture.attachments),
          'BASEROW_CUSTOMER_ORIGINAL_ROW_VALUE_CHANGED');
      }
      for (const column of selectedFileColumns) {
        if (row[column.name] === null) continue;
        check(capture.manifest.attachmentsComplete && typeof row[column.name] === 'string',
          'BASEROW_CUSTOMER_ORIGINAL_ATTACHMENTS_REQUIRED');
        let values; try { values = JSON.parse(row[column.name]); } catch { throw fault('BASEROW_CUSTOMER_ATTACHMENT_VALUE_CHANGED'); }
        check(Array.isArray(values), 'BASEROW_CUSTOMER_ATTACHMENT_VALUE_CHANGED');
        for (let position = 0; position < values.length; position++) {
          const original = capture.attachments.get(id + ':' + column.source + ':' + position);
          check(original, 'BASEROW_CUSTOMER_ORIGINAL_ATTACHMENT_MISSING');
          let retained = files.get(original.file);
          if (!retained) {
            retained = { file: 'attachments/' + original.file, originalFile: original.file,
              bytes: original.bytes, sha256: original.sha256, source: structuredClone(original.source), references: [] };
            files.set(original.file, retained);
          }
          const reference = { recordId: id, field: column.source, index: position,
            column: column.name, name: values[position]?.name };
          validateAttachmentValue(values[position], { file: retained, ref: reference });
          retained.references.push(reference);
        }
      }
    }
    check(rows <= payload.page.total, 'BASEROW_CUSTOMER_NATIVE_ROW_TOTAL');
    cursor = payload.page.nextCursor;
    if (cursor === null) {
      check(rows === payload.page.total, 'BASEROW_CUSTOMER_NATIVE_ROW_TOTAL'); break;
    }
  }
  return { inputs, queryCheck, rows, files: [...files.values()].sort((a, b) => a.file.localeCompare(b.file)) };
}
async function finalizeOriginalRoom(directory, inputs, requestSha256, signal) {
  const target = join(directory, 'dataset');
  if (await exists(target)) {
    const original = await scan(target, { retainPayload: false });
    check(original.finalized && original.nextCursor === null && original.count === original.total &&
      original.pages.length === inputs.length, 'BASEROW_CUSTOMER_NATIVE_ROOM_CHANGED');
    for (let index = 0; index < inputs.length; index++) {
      const raw = await readPrivate(inputs[index].page, MAX_DATASET_PAGE_BYTES);
      check(original.pages[index].sourceSha256 === digest(raw) &&
        original.pages[index].intent === inputs[index].intent &&
        original.pages[index].requestCursor === (inputs[index].cursor ?? null),
        'BASEROW_CUSTOMER_NATIVE_ROOM_CHANGED');
    }
    return original;
  }
  const stage = join(directory, 'native-stage');
  await once(join(directory, 'native-stage-owner.json'), bytes({
    schema: 'stellar-forge.baserow-customer-native-stage.v1', requestSha256 }));
  // The original raw pages stay create-only. A process-interrupted temporary
  // export is rebuilt from those same bytes, UUIDs and native page chain.
  if (await exists(stage)) { await privateDirectory(stage); await rm(stage, { recursive: true }); }
  cancelled(signal); await init(stage);
  await appendMany(stage, inputs); cancelled(signal);
  await finalize(stage);
  const native = await scan(stage, { retainPayload: false });
  for (const name of ['session.json', 'manifest.json', 'dataset.jsonl', 'dataset.csv', 'review.html',
    ...native.pages.map((_, index) => 'pages/' + pageName(index))]) {
    const handle = await open(join(stage, name), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try { await handle.sync(); } finally { await handle.close(); }
  }
  await syncDirectory(join(stage, 'pages')); await syncDirectory(stage); cancelled(signal);
  await rename(stage, target); await syncDirectory(directory);
  return scan(target, { retainPayload: false });
}
export async function prepareBaserowCustomer(options) {
  const request = requestFor(options), { publisher, signal } = options;
  const directory = resolve(options.directory ?? '');
  check(typeof options.directory === 'string' && options.directory === directory &&
    !descendant(publisher.directory, directory) && !descendant(directory, publisher.directory),
    'BASEROW_CUSTOMER_SEPARATE_OUTPUT_DIRECTORY_REQUIRED');
  await rootDirectory(directory, true);
  const release = await acquireWorkspace(directory);
  try {
    cancelled(signal); const requestBytes = bytes(request);
    await once(join(directory, 'operation.json'), requestBytes);
    if (await exists(join(directory, BASEROW_CUSTOMER_MANIFEST))) return readBaserowCustomer(directory, { signal });
    const original = await originalSelection(publisher, request), { run, plan, candidate, selected, capture } = original;
    const query = queryFor(request.query, request.expectedSnapshot, Math.min(100, plan.data.dataset.maxLimit));
    const first = originalResponse(candidate, query), projection = selectedProjection(plan, first.payload);
    const logicalSource = logicalFor(selected, plan, projection.columns), logicalSourceSha256 = identity(logicalSource);
    const captured = await rawPages(directory, candidate, query, request, projection.recordIdColumn,
      projection.columns, capture, signal);
    same(captured.queryCheck.fields, projection.columns.map(column => column.name));
    const fieldIds = new Set(projection.columns.filter(column => !column.source.startsWith('$')).map(column => fieldId(column.source)));
    const source = { schema: BASEROW_CUSTOMER_SOURCE_SCHEMA, customerKey: request.customerKey,
      sourceKey: sourceKey(logicalSource), logicalSourceSha256, logicalSource,
      recordIdColumn: projection.recordIdColumn,
      originalFields: capture.table.fields.filter(field => fieldIds.has(field.id)),
      publication: { runId: run.id, planId: plan.id, planDigest: plan.data.digest,
        sourceHash: plan.data.sourceHash, runtimeSourceHash: plan.data.runtimeSourceHash,
        queryHash: plan.data.queryHash, candidateDigest: candidate.manifest.candidateDigest,
        csvSha256: candidate.manifest.csvHash, csvBytes: candidate.manifest.csvBytes,
        datasetConfigSha256: candidate.manifest.configHash, datasetName: candidate.manifest.dataset.name,
        snapshot: candidate.manifest.dataset.snapshot, publishedRevision: run.data.publication.revision ?? null,
        state: run.state, reviewId: run.data.review?.id ?? null },
      capture: { sha256: capture.manifestSha256, selectionSha256: capture.manifest.selectionSha256,
        schemaSha256: capture.manifest.schemaSha256, recordIdentitiesSha256: capture.manifest.recordIdentitiesSha256,
        rows: capture.manifest.rowCount, pages: capture.manifest.pageCount, startedAt: capture.manifest.startedAt,
        completedAt: capture.manifest.completedAt, responseKind: 'PAGED_TABLE_READ', atomicSourceSnapshot: false },
      query: { originalRequestQuery: query.toString(), querySha256: captured.queryCheck.queryHash,
        fields: captured.queryCheck.fields, filters: captured.queryCheck.filters, ranges: captured.queryCheck.ranges,
        order: captured.queryCheck.order ?? 'csv-record-order' } };
    const attachments = { schema: BASEROW_CUSTOMER_ATTACHMENTS_SCHEMA, captureSha256: capture.manifestSha256,
      logicalSourceSha256, recordIdColumn: projection.recordIdColumn, files: captured.files };
    await once(join(directory, 'source.json'), bytes(source));
    await privateDirectory(join(directory, 'attachments'), true);
    for (const item of captured.files) {
      cancelled(signal); const content = capture.resources.get(item.originalFile);
      check(content && content.length === item.bytes && digest(content) === item.sha256,
        'BASEROW_CUSTOMER_ORIGINAL_ATTACHMENT_CHANGED');
      await once(join(directory, item.file), content);
    }
    await once(join(directory, 'attachments.json'), bytes(attachments));
    const native = await finalizeOriginalRoom(directory, captured.inputs, digest(requestBytes), signal);
    check(native.snapshot === request.expectedSnapshot && native.queryHash === source.query.querySha256 &&
      native.count === captured.rows, 'BASEROW_CUSTOMER_FINALIZED_SOURCE_CHANGED');
    const files = [];
    for (const name of ['source.json', 'attachments.json', ...nativeNames(native), ...captured.files.map(file => file.file)])
      files.push(await describeFile(directory, name));
    const named = name => { const file = files.find(item => item.name === name); return { file: name, bytes: file.bytes, sha256: file.sha256 }; };
    const manifest = { schema: BASEROW_CUSTOMER_SCHEMA, customerKey: request.customerKey, requestId: request.requestId,
      sourceKey: source.sourceKey, logicalSourceSha256, recordIdColumn: projection.recordIdColumn,
      source: named('source.json'), attachments: { ...named('attachments.json'), count: captured.files.length,
        referenceCount: captured.files.reduce((sum, file) => sum + file.references.length, 0),
        totalBytes: captured.files.reduce((sum, file) => sum + file.bytes, 0) },
      dataset: { directory: 'dataset', manifestSha256: files.find(file => file.name === 'dataset/manifest.json').sha256,
        rows: native.count, pages: native.pages.length, snapshot: native.snapshot,
        querySha256: native.queryHash, chainDigest: native.chain, fields: native.fields }, files };
    // The native publisher's original candidate remains the selected edition.
    const final = await publisher.candidate(request.runId);
    check(final.manifest.candidateDigest === request.expectedCandidateDigest, 'BASEROW_CUSTOMER_ORIGINAL_RUN_CHANGED');
    await validateFiles(directory, files, signal);
    cancelled(signal); await once(join(directory, BASEROW_CUSTOMER_MANIFEST), bytes(manifest));
    await syncDirectory(directory);
    return readBaserowCustomer(directory, { expectedManifestSha256: digest(bytes(manifest)), signal });
  } finally { await release(); }
}
export async function resumeBaserowCustomer(directory, { signal } = {}) {
  await rootDirectory(directory);
  if (await exists(join(directory, BASEROW_CUSTOMER_MANIFEST))) return readBaserowCustomer(directory, { signal });
  const request = await readJson(join(directory, 'operation.json'), 65536);
  check(request.schema === REQUEST_SCHEMA, 'BASEROW_CUSTOMER_ORIGINAL_REQUEST_REQUIRED');
  const publisher = await openBaserowPublisher({ directory: request.publisherDirectory });
  try { return await prepareBaserowCustomer({ publisher, directory, runId: request.runId,
    expectedCandidateDigest: request.expectedCandidateDigest, expectedSnapshot: request.expectedSnapshot,
    customerKey: request.customerKey, query: request.query, requestId: request.requestId, signal }); }
  finally { await publisher.close(); }
}
export async function copyBaserowCustomer(directory, destination, { expectedManifestSha256, signal } = {}) {
  check(HASH.test(expectedManifestSha256 ?? ''), 'BASEROW_CUSTOMER_MANIFEST_HASH_REQUIRED');
  check(typeof destination === 'string' && resolve(destination) === destination &&
    !descendant(directory, destination) && !descendant(destination, directory),
    'BASEROW_CUSTOMER_SEPARATE_OUTPUT_DIRECTORY_REQUIRED');
  const original = await readBaserowCustomer(directory, { expectedManifestSha256, signal });
  await rootDirectory(destination, true);
  const release = await acquireWorkspace(destination);
  try {
    const selection = { schema: 'stellar-forge.baserow-customer-copy.v1', manifestSha256: expectedManifestSha256 };
    await once(join(destination, 'copy.json'), bytes(selection));
    if (await exists(join(destination, BASEROW_CUSTOMER_MANIFEST)))
      return readBaserowCustomer(destination, { expectedManifestSha256, signal });
    for (const file of original.manifest.files) {
      cancelled(signal);
      await privateDirectory(dirname(join(destination, file.name)), true);
      await copyExact(join(directory, file.name), join(destination, file.name), file, signal);
    }
    const raw = await readPrivate(join(directory, BASEROW_CUSTOMER_MANIFEST), MAX_METADATA_BYTES);
    check(digest(raw) === expectedManifestSha256, 'BASEROW_CUSTOMER_MANIFEST_CHANGED');
    await once(join(destination, BASEROW_CUSTOMER_MANIFEST), raw);
    return readBaserowCustomer(destination, { expectedManifestSha256, signal });
  } finally { await release(); }
}
