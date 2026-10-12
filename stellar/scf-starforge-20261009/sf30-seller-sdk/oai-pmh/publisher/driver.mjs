// MIT. OAI capture -> original durable extraction/review/version publisher.
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { csvLine } from '../../postgres/publisher/plan.mjs';
import { bytes, digest, identity, createFile, object, fault, absolute } from '../../postgres/publisher/files.mjs';
import { readOaiSourceFile, openOaiSourceFile, copyOaiCapture, oaiDatasetConfig } from '../source.mjs';
import { only, bindOaiInput, OAI_QUERY, HASH } from '../declaration.mjs';

const integer = (value, low, high, code) => {
  if (!Number.isSafeInteger(value) || value < low || value > high) throw fault(code);
  return value;
};
export async function inspectOaiPublicationSource(sourceFile) {
  const source = await readOaiSourceFile(sourceFile);
  return { sourceFile: source.sourceFile, hash: source.sourceHash, bytes: source.original.length,
    manifestSha256: source.config.connection.sha256,
    repository: source.capture.repository, selection: source.capture.selection,
    edition: source.capture.edition, build: source.capture.build,
    queries: { records: { columns: source.description.columns.map(value => value.name),
      columnTypes: source.description.columns.map(({ name, type, nullable }) => ({ name, type, nullable })),
      parameters: {}, dataset: source.description,
      order: 'csv-record-order', sorts: source.description.columns.filter(value => value.sortable).map(value => value.name) } } };
}
export async function captureOaiPublicationPlan(sourceFile, directory, input) {
  only(input, ['title', 'query', 'input', 'dataset', 'extraction', 'sourceHash', 'sourceFile'], 'OAI_PUBLICATION_PLAN');
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 128)
    throw fault('PLAN_TITLE_REQUIRED');
  if (input.query !== undefined && input.query !== OAI_QUERY) throw fault('OAI_QUERY_NOT_FOUND');
  const selectedSourceFile = input.sourceFile === undefined ? sourceFile : absolute(input.sourceFile, 'source file');
  const retained = await readOaiSourceFile(selectedSourceFile);
  if (input.sourceHash !== retained.sourceHash)
    throw fault('SOURCE_REVIEW_CHANGED', 'Reload the exact retained source before saving this plan.', 409);
  const selected = bindOaiInput(input.input ?? {}, retained.description);
  const originalDataset = oaiDatasetConfig(retained.datasetConfig);
  if (input.dataset !== undefined && !isDeepStrictEqual(oaiDatasetConfig(input.dataset), originalDataset))
    throw fault('OAI_DATASET_TRANSFORM', 'This publisher carries every field and type from the reviewed native dataset.');
  const requested = input.extraction ?? {};
  only(requested, ['maxRows', 'maxBytes', 'pageRows', 'timeoutMs'], 'OAI_EXTRACTION_OPTIONS');
  const extraction = {
    maxRows: integer(requested.maxRows ?? originalDataset.maxRows, 1, 1000000, 'OAI_EXTRACTION_ROW_LIMIT'),
    maxBytes: integer(requested.maxBytes ?? originalDataset.maxBytes, 1, 256 * 1024 * 1024, 'OAI_EXTRACTION_BYTE_LIMIT'),
    pageRows: integer(requested.pageRows ?? Math.min(250, retained.description.maxLimit), 1,
      retained.description.maxLimit, 'OAI_EXTRACTION_PAGE_LIMIT'),
    timeoutMs: integer(requested.timeoutMs ?? 300000, 1000, 3600000, 'OAI_EXTRACTION_TIMEOUT_LIMIT'),
  };
  if (retained.description.rowCount > extraction.maxRows) throw fault('OAI_EXTRACTION_ROW_LIMIT');
  const dataset = { ...originalDataset, maxRows: extraction.maxRows, maxBytes: extraction.maxBytes };
  await createFile(join(directory, 'original-source.json'), retained.original);
  await copyOaiCapture(retained, join(directory, 'capture'));
  // Preserve the original source bytes; its relative capture path is unchanged.
  await createFile(join(directory, 'source.json'), retained.original);
  const sourceQuery = { provider: 'oai-pmh', query: OAI_QUERY,
    manifestSha256: retained.config.connection.sha256,
    columns: retained.description.columns, selection: retained.capture.selection,
    editionId: retained.capture.edition.id, reviewDigest: retained.capture.edition.review.digest,
    buildId: retained.capture.build.id, snapshot: retained.description.snapshot,
    order: selected.sort ?? 'csv-record-order' };
  const plan = { schema: 'stellar-forge.oai-pmh-dataset-plan.v1', title: input.title.trim(),
    query: OAI_QUERY, input: selected, dataset, extraction,
    sourceHash: retained.sourceHash, sourceBytes: retained.original.length, sourceFile: retained.sourceFile,
    runtimeSourceHash: retained.sourceHash, caHash: null, queryHash: identity(sourceQuery), sourceQuery,
    capture: { manifestSha256: retained.config.connection.sha256, totalBytes: retained.totalBytes,
      fileCount: retained.files.length, edition: retained.capture.edition, build: retained.capture.build,
      repository: { id: retained.capture.repository.id, baseURL: retained.capture.repository.baseURL }, operationId: retained.capture.operationId, attempt: retained.capture.attempt } };
  plan.digest = identity(plan);
  await createFile(join(directory, 'plan.json'), bytes(plan));
  return plan;
}
export function checkOaiColumnTypes(columns, types) {
  if (!Array.isArray(types) || types.length !== Object.keys(columns).length)
    throw fault('OAI_DATASET_COLUMN_TYPE_MISMATCH');
  const declared = Object.entries(columns);
  for (let index = 0; index < declared.length; index++) {
    const [name, raw] = declared[index], spec = typeof raw === 'string' ? { type: raw, nullable: false } : raw;
    const actual = types[index];
    if (!actual || actual.name !== name || actual.type !== spec.type || actual.nullable !== (spec.nullable ?? false))
      throw fault('OAI_DATASET_COLUMN_TYPE_MISMATCH');
  }
}
export function encodeOaiDatasetRow(row, dataset) {
  if (!object(row)) throw fault('OAI_DATASET_ROW');
  return csvLine(Object.entries(dataset.columns).map(([name, spec]) => {
    if (!Object.hasOwn(row, name)) throw fault('OAI_DATASET_FIELD_MISSING');
    const value = row[name];
    if (value === null) {
      if (!spec.nullable) throw fault('OAI_DATASET_NULL_NOT_ALLOWED');
      return '';
    }
    let encoded;
    if (spec.type === 'string') {
      if (typeof value !== 'string') throw fault('OAI_DATASET_COLUMN_TYPE_MISMATCH');
      encoded = value;
    } else if (spec.type === 'boolean') {
      if (typeof value !== 'boolean') throw fault('OAI_DATASET_COLUMN_TYPE_MISMATCH');
      encoded = value ? 'true' : 'false';
    } else {
      if (typeof value !== 'number' || !Number.isFinite(value) ||
          spec.type === 'integer' && !Number.isSafeInteger(value) ||
          !['integer', 'number'].includes(spec.type)) throw fault('OAI_DATASET_COLUMN_TYPE_MISMATCH');
      encoded = Object.is(value, -0) ? '-0' : String(value);
    }
    if (encoded.length > dataset.maxCellChars) throw fault('OAI_DATASET_CELL_TOO_LARGE');
    if (encoded === '' && spec.nullable) throw fault('OAI_DATASET_EMPTY_NULL_CONFLICT');
    return encoded;
  }));
}
export function validateOaiExtraction(value) {
  return object(value) && value.schema === 'stellar-forge.oai-pmh-dataset-extraction.v1' &&
    value.provider === 'oai-pmh' && value.complete === true && value.readOnly === true &&
    value.valueEncoding === 'sf30-native-scalars' &&
    ['sourceHash', 'manifestSha256', 'editionId', 'reviewDigest', 'datasetSnapshot'].every(key => HASH.test(value[key] ?? '')) &&
    typeof value.operationId === 'string' && value.operationId.length > 0 &&
    typeof value.buildId === 'string' && value.buildId.length > 0 &&
    Number.isSafeInteger(value.attempt) && value.attempt >= 1 &&
    Number.isSafeInteger(value.rowCount) && value.rowCount >= 0 && value.rowCount === value.sourceRowCount &&
    Number.isSafeInteger(value.deletedRecords) && value.deletedRecords >= 0 &&
    Number.isSafeInteger(value.pageCount) && value.pageCount >= 1 &&
    Array.isArray(value.columns) && Array.isArray(value.columnTypes) &&
    value.columns.length === value.columnTypes.length && new Set(value.columns).size === value.columns.length &&
    value.columnTypes.every((column, index) => object(column) && column.name === value.columns[index] &&
      ['string', 'boolean', 'integer', 'number'].includes(column.type) && typeof column.nullable === 'boolean');
}
export const oaiPublisherDriver = Object.freeze({
  sourceName: 'OAI-PMH',
  workspaceSchema: 'stellar-forge.oai-pmh-publisher-workspace.v1',
  statusSchema: 'stellar-forge.oai-pmh-publisher-status.v1',
  candidateSchema: 'stellar-forge.oai-pmh-dataset-candidate.v1',
  capturePlan: captureOaiPublicationPlan, inspectSource: inspectOaiPublicationSource,
  openSource: openOaiSourceFile, checkColumnTypes: checkOaiColumnTypes,
  encodeRow: encodeOaiDatasetRow, validateExtraction: validateOaiExtraction,
});
