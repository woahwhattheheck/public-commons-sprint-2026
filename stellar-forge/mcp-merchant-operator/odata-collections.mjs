// MIT. Complete saved live collections through the original OData workspace.
// Host aliases select inputs. The enclosing provider owns queueing and close.
import { join, dirname } from 'node:path';
import { exact, failure, identifier, plain, privateSupportDirectory } from './config.mjs';
import { digest } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/odata/state.mjs';
import { readRequestFile } from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/request-body.mjs';
import { openCollection, collectionAnalysisMapping, ANALYSIS_DOCUMENT_SCHEMA } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/odata/live/collection.mjs';

export const ODATA_COLLECTION_SELECTION_SCHEMA = 'stellar-forge.odata-collection-selection.v1';
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const MAX_PLAN_BYTES = 2 * 1024 * 1024;
const MAX_SOURCE_BYTES = 1024 * 1024;
const operations = new Set([
  'merchant_odata_collections', 'merchant_odata_collection', 'merchant_odata_collect',
  'merchant_odata_collection_rows', 'merchant_odata_collection_source', 'merchant_odata_collection_restore',
]);
const parse = raw => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
const need = (value, code, message) => { if (!value) throw failure(code, message); };
function nativeId(value) {
  need(typeof value === 'string' && ID.test(value), 'INVALID_PARAMS', 'Use an original service or collection identifier.');
  return value;
}
function sha(value) {
  need(typeof value === 'string' && HASH.test(value), 'INVALID_PARAMS', 'Use the exact original SHA-256.');
  return value;
}
function only(args, fields, required = []) {
  exact(args, ['workspace', ...fields], ['workspace', ...required]);
}
function count(value, label, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  need(Number.isSafeInteger(value) && value >= minimum && value <= maximum,
    'INVALID_PARAMS', label + ' must be an integer from ' + minimum + ' to ' + maximum + '.');
  return value;
}
function page(values, offset = 0, limit = 50) {
  count(offset, 'History offset'); count(limit, 'Page size', 1, 100);
  const items = values.slice(offset, offset + limit);
  return { items, page: { offset, limit, total: values.length,
    nextOffset: offset + items.length < values.length ? offset + items.length : null } };
}
function view(record, args) {
  const { directory, pages = [], originalFiles = [], retainedFiles = [], files = {}, reportedCounts = [], ...rest } = record;
  const result = { ...rest, pagination: {} };
  for (const [name, values] of Object.entries({ pages, originalFiles, retainedFiles, reportedCounts,
    files: Object.entries(files).map(([path, identity]) => ({ path, ...identity })) })) {
    const selected = page(values, args.offset, args.limit);
    result[name] = selected.items;
    result.pagination[name] = selected.page;
  }
  return result;
}
function selected(input, maximumPages) {
  exact(input, ['liveServiceId', 'collectionId', 'pages', 'fields', 'title', 'limits'],
    ['liveServiceId', 'collectionId', 'pages']);
  nativeId(input.liveServiceId); nativeId(input.collectionId);
  need(Array.isArray(input.pages) && input.pages.length > 0 && input.pages.length <= maximumPages,
    'INVALID_PARAMS', 'Select the ordered original saved pages. Large selections use a declared collectionSelections file.');
  const pages = input.pages.map(item => {
    exact(item, ['receivedId', 'buyerId'], ['receivedId']);
    return { receivedId: sha(item.receivedId), ...(item.buyerId === undefined ? {} : { buyerId: sha(item.buyerId) }) };
  });
  if (input.fields !== undefined) need(Array.isArray(input.fields) && input.fields.length > 0 && input.fields.length <= 32 &&
    input.fields.every(field => typeof field === 'string' && field.length > 0 && field.length <= 240) &&
    new Set(input.fields).size === input.fields.length, 'INVALID_PARAMS', 'Choose up to 32 distinct original CSDL field paths.');
  if (input.title !== undefined) need(typeof input.title === 'string' && input.title.trim() &&
    input.title.length <= 240 && !/[\x00-\x1f\x7f]/.test(input.title),
    'INVALID_PARAMS', 'Choose a nonempty collection title of at most 240 characters.');
  if (input.limits !== undefined) {
    const maxima = { maxPages: 10000, maxRows: 1000000, maxSourceBytes: 128 * 1024 * 1024, maxOutputBytes: 128 * 1024 * 1024 };
    exact(input.limits, Object.keys(maxima));
    for (const [name, value] of Object.entries(input.limits)) count(value, name, 1, maxima[name]);
  }
  return { ...input, pages };
}
function inputAlias(entry, kind, name) {
  const selected = entry[kind]?.[identifier(name, 'Collection input alias')];
  need(selected && HASH.test(selected.sha256 ?? ''), 'ODATA_COLLECTION_INPUT_NOT_CONFIGURED',
    'Choose a host-declared collection input with its complete SHA-256.');
  return selected;
}
async function originalDocument(collection) {
  need(collection.analysis?.path === 'analysis/source.json' && HASH.test(collection.analysis.sha256 ?? '') &&
    Number.isSafeInteger(collection.analysis.bytes) && collection.analysis.bytes > 0 &&
    collection.analysis.bytes <= MAX_SOURCE_BYTES, 'ODATA_COLLECTION_SOURCE_CHANGED',
    'The complete collection has no valid original Analysis source.');
  const file = join(collection.directory, collection.analysis.path);
  await privateSupportDirectory(dirname(file));
  const bytes = await readRequestFile(file, MAX_SOURCE_BYTES);
  need(bytes.length === collection.analysis.bytes && digest(bytes) === collection.analysis.sha256,
    'ODATA_COLLECTION_SOURCE_CHANGED', 'The original analytical source manifest changed.');
  const document = parse(bytes);
  need(plain(document) && document.schema === ANALYSIS_DOCUMENT_SCHEMA && document.complete === true,
    'ODATA_COLLECTION_SOURCE_CHANGED', 'Use the complete original collection source document.');
  return { document, bytes };
}

export const isODataCollectionOperation = name => operations.has(name);

/** All calls run inside MerchantODataWorkspaces' original handle.tail sequence. */
export async function callODataCollection({ name, args, entry, live, declared, readInput }) {
  need(operations.has(name), 'TOOL_NOT_FOUND', 'Unknown original collection operation.');
  const service = nativeId(args.liveServiceId), base = { workspace: args.workspace, liveServiceId: service };
  if (name === 'merchant_odata_collections') {
    only(args, ['liveServiceId', 'offset', 'limit'], ['liveServiceId']);
    const result = page(await live.collections({ id: service }), args.offset, args.limit);
    return { ...base, collections: result.items, page: result.page };
  }
  const collectionId = nativeId(args.collectionId);
  if (name === 'merchant_odata_collection') {
    only(args, ['liveServiceId', 'collectionId', 'offset', 'limit'], ['liveServiceId', 'collectionId']);
    return { ...base, ...view(await live.collection({ id: service, collectionId }), args) };
  }
  if (name === 'merchant_odata_collection_rows') {
    only(args, ['liveServiceId', 'collectionId', 'offset', 'limit'], ['liveServiceId', 'collectionId']);
    const offset = count(args.offset ?? 0, 'Row offset', 0, 1000000), limit = count(args.limit ?? 50, 'Row page size', 1, 100);
    return { ...base, collectionId, ...await live.collectionRows({ id: service, collectionId, offset, limit }) };
  }
  if (name === 'merchant_odata_collect') {
    only(args, ['liveServiceId', 'collectionId', 'pages', 'fields', 'title', 'limits', 'selection'],
      ['liveServiceId', 'collectionId']);
    let selection, selectedInput = null;
    if (args.selection !== undefined) {
      need(['pages', 'fields', 'title', 'limits'].every(key => args[key] === undefined), 'INVALID_PARAMS',
        'A declared selection supplies its complete original pages, fields, title and limits.');
      const declaredInput = inputAlias(entry, 'collectionSelections', args.selection);
      const bytes = await readInput('collectionSelections', args.selection, MAX_PLAN_BYTES), plan = parse(bytes);
      need(plan?.schema === ODATA_COLLECTION_SELECTION_SCHEMA, 'ODATA_COLLECTION_SELECTION_INVALID',
        'Choose the original complete collection-selection document.');
      const { schema, ...input } = plan;
      selection = selected(input, 10000);
      need(selection.liveServiceId === service && selection.collectionId === collectionId,
        'ODATA_COLLECTION_SELECTION_CONFLICT', 'The declared selection belongs to another service or collection.');
      selectedInput = { alias: args.selection, bytes: bytes.length, sha256: declaredInput.sha256 };
    } else {
      const { workspace, selection: unusedSelection, ...input } = args;
      selection = selected(input, 500);
    }
    const { liveServiceId, ...native } = selection;
    const { collectionId: identifier, ...input } = native;
    const result = await live.collect({ id: liveServiceId, collectionId: identifier, ...input });
    return { ...base, ...view(result, {}), selectedInput };
  }
  if (name === 'merchant_odata_collection_source') {
    only(args, ['liveServiceId', 'collectionId', 'source', 'sourceRevision', 'expectedSha256'], ['liveServiceId', 'collectionId']);
    need((args.source === undefined) === (args.sourceRevision === undefined), 'INVALID_PARAMS',
      'Use both the actual Analysis source name and its saved revision when requesting an import mapping.');
    const collection = await live.collection({ id: service, collectionId });
    if (args.expectedSha256 !== undefined) need(sha(args.expectedSha256) === collection.analysis.sha256,
      'ODATA_COLLECTION_SOURCE_CHANGED', 'Use the inspected original Analysis source digest.');
    const { document, bytes } = await originalDocument(collection);
    const reference = filename => ({ tool: 'merchant_odata_file', arguments: {
      workspace: args.workspace, kind: 'collection', id: service, recordId: collectionId, filename,
    } });
    const files = new Map([['analysis/source.json', { bytes: bytes.length, sha256: digest(bytes) }]]);
    for (const file of [document.document, ...document.originals]) {
      const path = 'analysis/' + file.path;
      const previous = files.get(path);
      need(!previous || previous.bytes === file.bytes && previous.sha256 === file.sha256,
        'ODATA_COLLECTION_SOURCE_CHANGED', 'The original Analysis source repeats a path with different bytes.');
      files.set(path, { bytes: file.bytes, sha256: file.sha256 });
    }
    return { ...base, collectionId, collectionSha256: collection.manifestSha256,
      sourceBinding: collection.sourceBinding, queryFingerprint: collection.queryFingerprint,
      rows: collection.rows, pages: collection.pageCount,
      manifest: { bytes: bytes.length, sha256: digest(bytes), ...reference('analysis/source.json') },
      document, files: [...files].map(([path, file]) => ({ path, ...file, ...reference(path) })),
      ...(args.source === undefined ? {} : { analysisInput: collectionAnalysisMapping(collection,
        { source: args.source, sourceRevision: args.sourceRevision }) }) };
  }
  only(args, ['liveServiceId', 'collectionId', 'sourceDocument', 'sourceWorkspace', 'sourceLiveServiceId',
    'sourceCollectionId', 'expectedSha256'], ['liveServiceId', 'collectionId']);
  let sourceManifest, expectedSha256, selectedSource;
  if (args.sourceDocument !== undefined) {
    need(['sourceWorkspace', 'sourceLiveServiceId', 'sourceCollectionId'].every(key => args[key] === undefined),
      'INVALID_PARAMS', 'Choose one declared source document or one original source collection.');
    const source = inputAlias(entry, 'collectionSources', args.sourceDocument);
    await readInput('collectionSources', args.sourceDocument, MAX_SOURCE_BYTES);
    sourceManifest = source.file; expectedSha256 = source.sha256;
    if (args.expectedSha256 !== undefined) need(sha(args.expectedSha256) === expectedSha256,
      'ODATA_COLLECTION_SOURCE_CHANGED', 'The source document differs from its selected digest.');
    selectedSource = { sourceDocument: args.sourceDocument, sha256: expectedSha256 };
  } else {
    const sourceWorkspace = args.sourceWorkspace ?? args.workspace,
      sourceService = nativeId(args.sourceLiveServiceId ?? service), sourceId = nativeId(args.sourceCollectionId);
    const configuration = declared(sourceWorkspace);
    const sourceDirectory = join(configuration.directory, 'live', 'products', sourceService, 'collections', sourceId);
    await privateSupportDirectory(sourceDirectory);
    const original = await openCollection(sourceDirectory);
    expectedSha256 = sha(args.expectedSha256);
    need(original.analysis.sha256 === expectedSha256, 'ODATA_COLLECTION_SOURCE_CHANGED',
      'The original collection document differs from its selected digest.');
    await originalDocument(original);
    sourceManifest = join(sourceDirectory, 'analysis', 'source.json');
    selectedSource = { sourceWorkspace, sourceLiveServiceId: sourceService,
      sourceCollectionId: sourceId, sha256: expectedSha256 };
  }
  const restored = await live.restoreCollection({ id: service, collectionId, sourceManifest, expectedSha256 });
  return { ...base, ...view(restored, {}), selectedSource };
}
