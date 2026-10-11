// MIT. A retained CKAN edition joins the original durable dataset publisher.
import { dirname, join, posix } from 'node:path';
import { loadCsvDataset } from '../../dataset-handler.mjs';
import { csvLine } from '../../postgres/publisher/plan.mjs';
import { datasetExtractionOptions } from '../../postgres/publisher/stream.mjs';
import { object, bytes, digest, identity, createFile, privateDirectory, syncDirectory, fault } from '../../postgres/publisher/files.mjs';
import { readCkanSourceFile } from '../declaration.mjs';
import { readCkanCapture } from '../capture.mjs';
import { inspectCkanSource, openCkanSourceFile, checkCkanColumnTypes, encodeCkanRow } from '../source.mjs';

const HASH = /^[a-f0-9]{64}$/;
const only = (value, keys, code) => {
  if (!object(value) || Object.keys(value).some(key => !keys.includes(key))) throw fault(code);
};
const integer = (value, low, high, code) => {
  if (!Number.isSafeInteger(value) || value < low || value > high) throw fault(code);
  return value;
};
export function captureMember(name) {
  if (typeof name !== 'string' || !name || name.length > 512 || name.includes('\\') ||
      name.includes('\0') || posix.isAbsolute(name) || posix.normalize(name) !== name ||
      name.split('/').some(part => !part || part === '.' || part === '..') ||
      name === 'capture.json') throw fault('CKAN_CAPTURE_MEMBER_INVALID');
  return name;
}
export async function retainCkanCapture(capture, directory) {
  if (!(capture.rawFiles instanceof Map) || !capture.rawFiles.size || capture.rawFiles.size > 10000)
    throw fault('CKAN_CAPTURE_FILES_INVALID');
  await privateDirectory(directory, true);
  for (const [relative, content] of capture.rawFiles) {
    const name = captureMember(relative);
    if (!Buffer.isBuffer(content)) throw fault('CKAN_CAPTURE_BYTES_INVALID');
    const parent = dirname(join(directory, name));
    if (parent !== directory) await privateDirectory(parent, true);
    await createFile(join(directory, name), content);
  }
  await createFile(join(directory, 'capture.json'), capture.manifestBytes);
  await syncDirectory(directory);
}
function bindCapture(capture, config) {
  const manifest = capture.manifest;
  if (manifest?.schema !== 'stellar-forge.ckan-capture.v1' || manifest.provider !== 'ckan' ||
      manifest.readOnly !== true || manifest.state !== 'COMPLETE' ||
      manifest.catalogOrigin !== config.catalogOrigin || manifest.packageId !== config.packageId ||
      manifest.resourceId !== config.resourceId || !HASH.test(capture.manifestSha256 ?? '') ||
      !Array.isArray(manifest.pages) || !Number.isSafeInteger(manifest.rowCount) || manifest.rowCount < 0)
    throw fault('CKAN_CAPTURE_BINDING_CHANGED');
}
export async function captureCkanPublicationPlan(sourceFile, directory, input) {
  only(input, ['title', 'query', 'input', 'dataset', 'extraction', 'sourceHash'], 'INVALID_PUBLICATION_PLAN');
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 128)
    throw fault('PLAN_TITLE_REQUIRED');
  const selected = await readCkanSourceFile(sourceFile);
  if (selected.hash !== input.sourceHash)
    throw fault('SOURCE_REVIEW_CHANGED', 'Reload the CKAN source before saving this plan.', 409);
  const query = selected.queries[input.query];
  if (!query) throw fault('QUERY_NOT_FOUND');
  if (!object(input.input ?? {}) || Object.keys(input.input ?? {}).length)
    throw fault('CKAN_QUERY_INPUT_NOT_SUPPORTED');
  const extraction = datasetExtractionOptions(query, input.extraction);
  only(input.dataset, ['name', 'columns', 'filters', 'ranges', 'sorts', 'maxCellChars', 'defaultLimit', 'maxLimit', 'maxPageBytes'], 'INVALID_DATASET_PLAN');
  if (!object(input.dataset.columns) || !Object.keys(input.dataset.columns).length ||
      Object.keys(input.dataset.columns).some(name => !query.columns.includes(name)))
    throw fault('DATASET_COLUMN_NOT_IN_QUERY');
  const columns = Object.fromEntries(Object.entries(input.dataset.columns).map(([name, spec]) => {
    const value = typeof spec === 'string' ? { type: spec, nullable: false } : spec;
    only(value, ['type', 'nullable'], 'INVALID_DATASET_COLUMN');
    return [name, { type: value.type, nullable: value.nullable ?? false }];
  }));
  checkCkanColumnTypes(columns, Object.entries(query.projection).map(([name, spec]) => ({ name, type: spec.type })));
  const dataset = { schema: 'stellar-forge.csv-dataset.v1', file: 'data.csv', name: input.dataset.name,
    columns, filters: input.dataset.filters ?? [], ranges: input.dataset.ranges ?? [], sorts: input.dataset.sorts ?? [],
    maxBytes: extraction.maxBytes, maxRows: extraction.maxRows,
    maxCellChars: integer(input.dataset.maxCellChars ?? 65536, 1, 1048576, 'DATASET_CELL_SIZE_INVALID'),
    defaultLimit: input.dataset.defaultLimit ?? 50, maxLimit: input.dataset.maxLimit ?? 250,
    maxPageBytes: input.dataset.maxPageBytes ?? 921600 };
  await createFile(join(directory, 'schema.csv'), csvLine(Object.keys(columns)));
  await loadCsvDataset({ ...dataset, file: join(directory, 'schema.csv') });
  const capture = await readCkanCapture(selected.captureFile, selected.config.connection.sha256);
  bindCapture(capture, selected.config);
  await retainCkanCapture(capture, join(directory, 'capture'));
  const runtime = structuredClone(selected.config);
  runtime.connection.file = 'capture/capture.json';
  const runtimeBytes = bytes(runtime);
  await createFile(join(directory, 'original-source.json'), selected.original);
  await createFile(join(directory, 'source.json'), runtimeBytes);
  const value = { schema: 'stellar-forge.ckan-dataset-plan.v1', title: input.title.trim(),
    query: input.query, input: {}, dataset, extraction,
    sourceHash: selected.hash, sourceBytes: selected.original.length,
    runtimeSourceHash: digest(runtimeBytes), queryHash: identity(query),
    retainedCapture: { manifestSha256: capture.manifestSha256, catalogOrigin: selected.config.catalogOrigin,
      packageId: selected.config.packageId, resourceId: selected.config.resourceId,
      rowCount: capture.manifest.rowCount, pageCount: capture.manifest.pages.length },
    sourceQuery: { sql: query.sql, columns: query.columns, parameters: {},
      catalogOrigin: selected.config.catalogOrigin, packageId: selected.config.packageId,
      resourceId: selected.config.resourceId, projection: query.projection } };
  value.digest = identity(value);
  await createFile(join(directory, 'plan.json'), bytes(value));
  return value;
}
export const ckanPublisherDriver = Object.freeze({
  sourceName: 'CKAN DataStore',
  workspaceSchema: 'stellar-forge.ckan-publisher-workspace.v1',
  statusSchema: 'stellar-forge.ckan-publisher-status.v1',
  candidateSchema: 'stellar-forge.ckan-dataset-candidate.v1',
  capturePlan: captureCkanPublicationPlan, inspectSource: inspectCkanSource, openSource: openCkanSourceFile,
  checkColumnTypes: checkCkanColumnTypes, encodeRow: encodeCkanRow,
  validateExtraction: record => record?.schema === 'stellar-forge.ckan-dataset-extraction.v1' &&
    record.valueEncoding === 'ckan-reviewed-projection' && record.nullEncoding === 'json-null' &&
    record.observation?.schema === 'stellar-forge.ckan-edition-observation.v1' &&
    record.observation.kind === 'RETAINED_DATASTORE_PAGES' && record.observation.readOnly === true &&
    record.observation.capture?.schema === 'stellar-forge.ckan-capture.v1' &&
    record.observation.capture.provider === 'ckan' && record.observation.capture.readOnly === true &&
    record.observation.capture.state === 'COMPLETE' &&
    HASH.test(record.observation.capture.manifestSha256 ?? '') &&
    Number.isSafeInteger(record.rowCount) && record.rowCount >= 0 &&
    record.rowCount === record.observation.capture.rowCount,
});
