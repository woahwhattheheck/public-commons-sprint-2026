// MIT. Complete original OData collection downloads and customer receiving.
import { join, resolve, relative, isAbsolute, basename, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { createRetainedDownload, openMerchantFileClient } from './retained-download.mjs';

export const ODATA_COLLECTION_DOWNLOAD_SCHEMA = 'stellar-forge.odata-collection-download.v1';
export const ODATA_COLLECTION_RECEIVING_SCHEMA = 'stellar-forge.odata-collection-receiving.v1';
const STATE_SCHEMA = 'stellar-forge.odata-collection-download-state.v1';
const SCOPE_SCHEMA = 'stellar-forge.odata-collection-download-scope.v1';
const DOCUMENT_SCHEMA = 'stellar-forge.analysis-source-document.v1';
const MANIFEST = 'source.json';
const TOOL = 'odata_collection_original';
const MAX_MANIFEST = 1024 * 1024;
const MAX_SOURCE = 256 * 1024 * 1024;
const MAX_ORIGINAL = 32 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const ALIAS = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const FILE = /^files\/([a-f0-9]{64})\.(json|csv|bin)$/;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = (code, message) => Object.assign(new Error(message), { code: 'ODATA_COLLECTION_CLIENT_' + code });
const need = (value, code, message) => { if (!value) throw fail(code, message); };
function checksum(value) {
  need(typeof value === 'string' && HASH.test(value), 'IDENTITY', 'Select the complete original source SHA-256.');
  return value;
}
function selection(input) {
  need(typeof input.workspace === 'string' && ALIAS.test(input.workspace) &&
    typeof input.liveServiceId === 'string' && ID.test(input.liveServiceId) &&
    typeof input.collectionId === 'string' && ID.test(input.collectionId),
    'SELECTION', 'Select the original host workspace alias, live service and collection identifiers.');
  return { workspace: input.workspace, liveServiceId: input.liveServiceId, collectionId: input.collectionId };
}
function integer(value, low, high, label) {
  need(Number.isSafeInteger(value) && value >= low && value <= high, 'ARGUMENTS', label + ' is outside its original limit.');
  return value;
}
function identity(record, maximum) {
  const match = typeof record?.path === 'string' && record.path.match(FILE);
  need(plain(record) && match && match[1] === record.sha256 && HASH.test(record.sha256) &&
    Number.isSafeInteger(record.bytes) && record.bytes >= 0 && record.bytes <= maximum &&
    typeof record.contentType === 'string' && record.contentType.length > 0 && record.contentType.length <= 160,
    'DOCUMENT', 'Use the original content-addressed source file, complete byte count and digest.');
  return { name: record.path, bytes: record.bytes, sha256: record.sha256, contentType: record.contentType };
}
function parseSource(bytes, expectedSha256) {
  checksum(expectedSha256);
  need(bytes.length > 0 && bytes.length <= MAX_MANIFEST && sha(bytes) === expectedSha256,
    'DOCUMENT_CHANGED', 'The original source document differs from its selected digest.');
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw fail('DOCUMENT', 'Use the original UTF-8 JSON source document.'); }
  need(plain(value) && value.schema === DOCUMENT_SCHEMA && value.complete === true &&
    ['csv', 'json'].includes(value.format) && typeof value.title === 'string' && value.title.length > 0 &&
    value.title.length <= 240 && Array.isArray(value.originals) && value.originals.length >= 3 &&
    value.originals.length <= 32 && plain(value.provenance) && plain(value.provenance.transform),
    'DOCUMENT', 'Select a complete original OData analytical source document.');
  const document = identity(value.document, value.format === 'json' ? MAX_ORIGINAL : 128 * 1024 * 1024);
  need(value.document.path === 'files/' + value.document.sha256 + '.' + value.format &&
    value.document.contentType === (value.format === 'json' ? 'application/json' : 'text/csv; charset=utf-8'),
    'DOCUMENT', 'The analytical format and original document disagree.');
  const roles = new Map(), files = new Map([[document.name, document]]);
  for (const record of value.originals) {
    const file = identity(record, MAX_ORIGINAL);
    need(typeof record.role === 'string' && !roles.has(record.role) &&
      (['collection-manifest', 'collection-transform'].includes(record.role) || /^page-packet-[0-9]{4}$/.test(record.role)),
      'DOCUMENT', 'Retain each original collection manifest, transformation and ordered page packet once.');
    roles.set(record.role, record);
    const prior = files.get(file.name);
    need(!prior || prior.bytes === file.bytes && prior.sha256 === file.sha256 && prior.contentType === file.contentType, 'DOCUMENT',
      'The original document repeats a file with different bytes.');
    files.set(file.name, file);
  }
  const original = roles.get('collection-manifest'), transform = roles.get('collection-transform');
  need(original?.contentType === 'application/json' && original.bytes > 0 &&
    transform?.contentType === 'text/javascript; charset=utf-8' && transform.bytes > 0 &&
    value.provenance.transform.sha256 === transform.sha256, 'DOCUMENT',
    'The collection manifest and exact transformation must accompany the analytical document.');
  const packets = [...roles.keys()].filter(role => role.startsWith('page-packet-')).sort();
  need(packets.length + 2 === roles.size && packets.length > 0 &&
    packets.every((role, index) => role === 'page-packet-' + String(index + 1).padStart(4, '0') &&
      roles.get(role).contentType === 'application/gzip'), 'DOCUMENT', 'Retain the complete ordered original page packets.');
  need([...files.values()].reduce((total, file) => total + file.bytes, 0) <= MAX_SOURCE,
    'DOCUMENT_LIMIT', 'The complete original analytical source exceeds 256 MiB.');
  return { ...value, exportId: expectedSha256, files: [...files.values()], collectionSha256: original.sha256 };
}
function describe(source) {
  return { title: source.title, format: source.format, collectionSha256: source.collectionSha256 };
}
function sourceSummary(source, manifestSha256) {
  return { schema: source.schema, title: source.title, format: source.format, sourceSha256: manifestSha256,
    collectionSha256: source.collectionSha256, files: source.files.length,
    bytes: source.files.reduce((total, file) => total + file.bytes, 0), originalPackets: source.originals.length - 2 };
}
function scopedEndpoint(endpoint, selected) {
  const result = JSON.stringify({ schema: SCOPE_SCHEMA, endpoint, ...selected });
  need(result.length <= 4096, 'ENDPOINT', 'Use the original endpoint and source selection within the retained identity limit.');
  return result;
}
function restoredScope(endpoint) {
  let value;
  try { value = JSON.parse(endpoint); } catch { throw fail('DOWNLOAD_CHANGED', 'The original download scope is unavailable.'); }
  need(value?.schema === SCOPE_SCHEMA && typeof value.endpoint === 'string' && value.endpoint.length > 0,
    'DOWNLOAD_CHANGED', 'The retained download has no original merchant endpoint.');
  return { endpoint: value.endpoint, ...selection(value) };
}
async function originalClient(options) {
  const { client, url, tokenEnv, environment, signal } = options;
  if (client !== undefined) {
    need(url === undefined && plain(client) && typeof client.call === 'function' &&
      typeof client.endpoint === 'string' && client.endpoint.length > 0 && client.endpoint.length <= 3072 &&
      !/[\0\r\n]/.test(client.endpoint), 'ENDPOINT', 'Select one original MCP client or its authenticated HTTP endpoint.');
    return { endpoint: client.endpoint, call: client.call.bind(client) };
  }
  return openMerchantFileClient({ url, tokenEnv, environment, signal, errorPrefix: 'ODATA',
    clientName: 'starforge-odata-collection-customer', maximumResponseBytes: 4 * 1024 * 1024 });
}
async function originalSelection(options) {
  const selected = selection(options), client = await originalClient(options);
  await client.call('merchant_odata_open', { workspace: selected.workspace });
  return { client, selected };
}
function sameSelection(value, selected) {
  need(plain(value) && Object.entries(selected).every(([key, expected]) => value[key] === expected),
    'SELECTION_CHANGED', 'The merchant returned another workspace, service or collection.');
}
async function sourceClient(options) {
  const { client, selected } = await originalSelection(options);
  if (options.expectedSha256 !== undefined) checksum(options.expectedSha256);
  const result = await client.call('merchant_odata_collection_source', {
    ...selected, ...(options.expectedSha256 === undefined ? {} : { expectedSha256: options.expectedSha256 })
  });
  sameSelection(result, selected);
  const sourceSha256 = checksum(result.manifest?.sha256);
  need(options.expectedSha256 === undefined || sourceSha256 === options.expectedSha256,
    'SOURCE_CHANGED', 'The merchant source differs from the inspected selection.');
  integer(result.manifest.bytes, 1, MAX_MANIFEST, 'Source document bytes');
  checksum(result.collectionSha256); checksum(result.sourceBinding); checksum(result.queryFingerprint);
  integer(result.rows, 0, 1000000, 'Original rows'); integer(result.pages, 1, 10000, 'Original pages');
  need(Array.isArray(result.files) && result.files.length >= 4 && result.files.length <= 34,
    'SOURCE_FILES', 'The merchant must return the complete original analytical source file references.');
  const remoteFiles = new Map();
  for (const file of result.files) {
    const name = typeof file?.path === 'string' && file.path.startsWith('analysis/') ? file.path.slice(9) : '';
    const match = name.match(FILE);
    need((name === MANIFEST || match && match[1] === file.sha256) &&
      Number.isSafeInteger(file.bytes) && file.bytes >= 0 && file.bytes <= MAX_SOURCE && HASH.test(file.sha256 ?? '') &&
      !remoteFiles.has(name), 'SOURCE_FILES', 'The merchant returned a missing or conflicting original source file.');
    const args = file.arguments;
    need(file.tool === 'merchant_odata_file' && plain(args) && args.workspace === selected.workspace &&
      args.kind === 'collection' && args.id === selected.liveServiceId && args.recordId === selected.collectionId &&
      args.filename === file.path, 'SOURCE_FILES', 'A retained file reference belongs to another original collection.');
    remoteFiles.set(name, { name, bytes: file.bytes, sha256: file.sha256, remote: file.path });
  }
  const manifest = remoteFiles.get(MANIFEST);
  need(manifest && manifest.bytes === result.manifest.bytes && manifest.sha256 === sourceSha256,
    'SOURCE_FILES', 'The complete source manifest reference is missing.');
  const parseManifest = (bytes, exportId) => {
    const source = parseSource(bytes, exportId);
    need(source.collectionSha256 === result.collectionSha256 && source.files.length + 1 === remoteFiles.size &&
      source.files.every(file => {
        const original = remoteFiles.get(file.name);
        return original && original.bytes === file.bytes && original.sha256 === file.sha256;
      }), 'SOURCE_FILES_CHANGED', 'The original source document and merchant file inventory disagree.');
    return source;
  };
  const adapter = {
    endpoint: scopedEndpoint(client.endpoint, selected),
    async call(name, args, requestOptions) {
      need(args.exportId === sourceSha256, 'SOURCE_CHANGED', 'Keep the exact selected source for every retained-file request.');
      if (name === TOOL + '_manifest') return { state: 'MANIFEST_RETAINED', exportId: sourceSha256,
        manifestFile: { name: MANIFEST, bytes: manifest.bytes, sha256: sourceSha256 } };
      if (name === TOOL + '_file_release') {
        const released = await client.call('merchant_odata_file_release',
          { workspace: selected.workspace, readId: args.readId }, requestOptions);
        need(released?.workspace === selected.workspace && released.readId === args.readId && released.released === true,
          'READ_RELEASE', 'The original retained read did not return its selected release.');
        return released;
      }
      need(name === TOOL + '_file' && args.expectedManifestSha256 === sourceSha256,
        'SOURCE_CHANGED', 'Use the original complete source file operation and manifest digest.');
      const file = remoteFiles.get(args.file);
      need(file && args.expectedSha256 === file.sha256, 'FILE_CHANGED', 'Select a file declared by the original source document.');
      const value = await client.call('merchant_odata_file', { workspace: selected.workspace, kind: 'collection',
        id: selected.liveServiceId, recordId: selected.collectionId, filename: file.remote,
        expectedSha256: file.sha256, offset: args.offset, limit: args.limit,
        ...(args.readId ? { readId: args.readId } : {}) }, requestOptions);
      need(value?.file?.name === basename(file.remote) && value.file.bytes === file.bytes &&
        value.file.sha256 === file.sha256, 'FILE_CHANGED', 'The original retained reader returned another file identity.');
      return { ...value, exportId: sourceSha256, manifestSha256: sourceSha256, file: {
        ...value.file, name: file.name } };
    }
  };
  return { adapter, parseManifest, sourceSha256, selected, endpoint: client.endpoint,
    original: { collectionSha256: result.collectionSha256, sourceBinding: result.sourceBinding,
      queryFingerprint: result.queryFingerprint, rows: result.rows, pages: result.pages } };
}
function downloader(parseManifest = parseSource) {
  return createRetainedDownload({ manifestName: MANIFEST, parseManifest, maximumBytes: MAX_SOURCE,
    maximumManifestBytes: MAX_MANIFEST, maximumCheckpointBytes: MAX_MANIFEST,
    stateSchema: STATE_SCHEMA, resultSchema: ODATA_COLLECTION_DOWNLOAD_SCHEMA,
    toolPrefix: TOOL, errorPrefix: 'ODATA', clientName: 'starforge-odata-collection-customer',
    validateExportId: checksum, nestedFiles: true, describe });
}

/** One page of actual original collections; continue at the returned nextOffset. */
export async function listMerchantODataCollections(options = {}) {
  const { workspace, liveServiceId } = options;
  need(typeof workspace === 'string' && ALIAS.test(workspace) &&
    typeof liveServiceId === 'string' && ID.test(liveServiceId), 'SELECTION',
    'Select the original workspace alias and live service.');
  const offset = integer(options.offset ?? 0, 0, Number.MAX_SAFE_INTEGER, 'History offset');
  const limit = integer(options.limit ?? 50, 1, 100, 'History page size');
  const client = await originalClient(options);
  await client.call('merchant_odata_open', { workspace });
  const result = await client.call('merchant_odata_collections', { workspace, liveServiceId, offset, limit });
  need(result?.workspace === workspace && result.liveServiceId === liveServiceId && Array.isArray(result.collections) &&
    result.page?.offset === offset && result.page.limit === limit &&
    Number.isSafeInteger(result.page.total) && result.page.total >= 0 &&
    result.collections.length <= limit &&
    result.page.nextOffset === (offset + result.collections.length < result.page.total
      ? offset + result.collections.length : null), 'SELECTION_CHANGED', 'The original collection history page changed identity.');
  return result;
}

/** Inspect exact source bytes before selecting a durable customer download. */
export async function inspectMerchantODataCollection(options = {}) {
  const source = await sourceClient(options);
  const inspected = await downloader(source.parseManifest).inspect({ client: source.adapter, exportId: source.sourceSha256 });
  return { schema: ODATA_COLLECTION_DOWNLOAD_SCHEMA, state: 'INSPECTED',
    endpoint: source.endpoint, ...source.selected, ...source.original,
    source: sourceSummary(inspected.manifest, inspected.manifestSha256),
    document: { schema: inspected.manifest.schema, title: inspected.manifest.title, format: inspected.manifest.format,
      document: inspected.manifest.document, originals: inspected.manifest.originals,
      provenance: inspected.manifest.provenance, complete: inspected.manifest.complete } };
}

/** Retain source.json last, after the original downloader has synced every selected file. */
export async function downloadMerchantODataCollection(options = {}) {
  checksum(options.expectedSha256);
  const source = await sourceClient(options);
  const result = await downloader(source.parseManifest).download({ client: source.adapter, exportId: source.sourceSha256,
    expectedManifestSha256: source.sourceSha256, directory: options.directory, signal: options.signal,
    chunkSize: options.chunkSize, onProgress: options.onProgress });
  return { ...result, endpoint: source.endpoint, ...source.selected, ...source.original,
    sourceSha256: source.sourceSha256, sourceManifest: join(result.directory, MANIFEST) };
}
async function withDownload(options, operation) {
  need(typeof options.directory === 'string' && options.directory.length > 0, 'DIRECTORY',
    'Select the original completed download directory.');
  const native = downloader();
  return native.lockedDownload(options.directory, async context => {
    const bytes = await native.bytesAt(join(context.root, MANIFEST), MAX_MANIFEST);
    const expectedSha256 = checksum(options.expectedSha256 ?? sha(bytes));
    const source = parseSource(bytes, expectedSha256);
    const checkpointBytes = await native.bytesAt(join(context.stateDirectory, 'checkpoint.json'), MAX_MANIFEST);
    let saved;
    try { saved = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(checkpointBytes)); }
    catch { throw fail('DOWNLOAD_CHANGED', 'The original download checkpoint cannot be read.'); }
    need(saved?.schema === STATE_SCHEMA && saved.exportId === expectedSha256 && saved.manifestSha256 === expectedSha256,
      'DOWNLOAD_CHANGED', 'The saved download and selected source differ.');
    const selected = restoredScope(saved.endpoint);
    await native.loadContext(context, bytes, expectedSha256, saved.endpoint);
    for (const file of source.files) {
      const retained = context.state.files[file.name];
      need(retained?.complete === true && retained.bytes === file.bytes && retained.sha256 === file.sha256,
        'DOWNLOAD_INCOMPLETE', 'Resume the original download before receiving its incomplete file: ' + file.name + '.');
      await native.verifiedFile(join(context.root, file.name), file, options.signal);
    }
    return operation({ context, source, selected, expectedSha256 });
  });
}
/** Offline byte-complete reopen of the same downloaded source and checkpoint. */
export async function inspectODataCollectionDownload(options = {}) {
  return withDownload(options, async ({ context, source, selected, expectedSha256 }) => ({
    schema: ODATA_COLLECTION_DOWNLOAD_SCHEMA, state: 'COMPLETE', directory: context.root, ...selected,
    sourceManifest: join(context.root, MANIFEST), source: sourceSummary(source, expectedSha256)
  }));
}
function disjoint(first, second) {
  const inside = (parent, child) => { const path = relative(parent, child); return path === '' || !path.startsWith('..' + sep) && path !== '..' && !isAbsolute(path); };
  need(!inside(first, second) && !inside(second, first), 'DIRECTORY',
    'Use separate download and receiving directories so both original file sets remain complete.');
}
function receivedSummary(collection) {
  return { schema: collection.schema, directory: collection.directory, title: collection.title,
    operation: collection.operation, entitySet: collection.entitySet, metadataSha256: collection.metadataSha256,
    sourceBinding: collection.sourceBinding, query: collection.query, queryFingerprint: collection.queryFingerprint,
    keyFields: collection.keyFields, rows: collection.rows, pages: collection.pageCount,
    completion: collection.completion, reportedCounts: collection.reportedCounts,
    countConsistent: collection.countConsistent, acquisition: collection.acquisition,
    mapping: collection.mapping, manifestSha256: collection.manifestSha256, analysis: collection.analysis,
    analysisProjection: collection.analysisProjection, ...(collection.restoredFrom ? { restoredFrom: collection.restoredFrom } : {}) };
}
const collectionEngine = () => import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/odata/live/collection.mjs');

/** The original collection engine restores every page and recomputes the complete collection. */
export async function receiveODataCollectionDownload(options = {}) {
  checksum(options.expectedSha256);
  need(typeof options.collectionDirectory === 'string' && options.collectionDirectory.length > 0,
    'DIRECTORY', 'Select a private receiving collection directory.');
  need(typeof options.directory === 'string' && options.directory.length > 0, 'DIRECTORY',
    'Select the original completed download directory.');
  const target = resolve(options.collectionDirectory);
  disjoint(resolve(options.directory), target);
  return withDownload(options, async ({ context, source, selected, expectedSha256 }) => {
    const { restoreCollection } = await collectionEngine();
    const collection = await restoreCollection({ sourceManifest: join(context.root, MANIFEST),
      directory: target, expectedSha256 });
    need(collection.manifestSha256 === source.collectionSha256 && collection.analysis.sha256 === expectedSha256,
      'RECEIVING_CHANGED', 'The original collection receiver returned another selected source.');
    return { schema: ODATA_COLLECTION_RECEIVING_SCHEMA, state: 'COMPLETE', ...selected,
      downloadDirectory: context.root, sourceSha256: expectedSha256, collection: receivedSummary(collection) };
  });
}

/** Resume download and restore serially with the same selected source; no new acquisition. */
export async function fetchODataCollection(options = {}) {
  checksum(options.expectedSha256);
  need(typeof options.directory === 'string' && options.directory.length > 0 &&
    typeof options.collectionDirectory === 'string' && options.collectionDirectory.length > 0,
    'DIRECTORY', 'Select both the download directory and receiving collection directory.');
  disjoint(resolve(options.directory), resolve(options.collectionDirectory));
  const download = await downloadMerchantODataCollection(options);
  const receiving = await receiveODataCollectionDownload({ directory: options.directory,
    collectionDirectory: options.collectionDirectory, expectedSha256: options.expectedSha256, signal: options.signal });
  return { schema: ODATA_COLLECTION_RECEIVING_SCHEMA, state: 'COMPLETE', download, receiving };
}
export async function inspectReceivedODataCollection({ directory } = {}) {
  const { openCollection } = await collectionEngine();
  return receivedSummary(await openCollection(directory));
}
export async function readReceivedODataCollectionRows({ directory, offset = 0, limit = 100 } = {}) {
  const { readCollectionRows } = await collectionEngine();
  return readCollectionRows(directory, { offset, limit });
}
/** Supply the actual name and revision returned by the original Analysis registration. */
export async function receivedODataCollectionAnalysisMapping({ directory, source, sourceRevision } = {}) {
  const { openCollection, collectionAnalysisMapping } = await collectionEngine();
  return collectionAnalysisMapping(await openCollection(directory), { source, sourceRevision });
}
