// MIT. A reviewed file edition and its typed, independently limited CSV product.
import { join } from 'node:path';
import { loadCsvDataset } from '../../dataset-handler.mjs';
import { validateSftpSource, bindSftpParameters, fail, object, exact } from '../config.mjs';
import { describeSftpQuery, sftpDatasetExtractionOptions } from '../source.mjs';
import { csvLine } from '../../postgres/publisher/plan.mjs';
import { readPrivate, bytes, digest, identity, createFile, fault } from '../../postgres/publisher/files.mjs';

function parse(original) {
  let declaration;
  try { declaration = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(original)); }
  catch { throw fail('SFTP_SOURCE_JSON_INVALID'); }
  return { declaration, source: validateSftpSource(declaration) };
}
export async function inspectSftpPublicationSource(path) {
  const original = await readPrivate(path, 1048576), { source } = parse(original);
  return { hash: digest(original), bytes: original.length, root: source.root,
    connection: { host: source.connection.host, port: source.connection.port, username: source.connection.username,
      hostKeyFingerprints: [...source.connection.hostKeyFingerprints] },
    queries: Object.fromEntries(Object.entries(source.queries).map(([name, query]) => [name, describeSftpQuery(query)])) };
}
export async function captureSftpPublicationPlan(sourceFile, directory, input) {
  exact(input, ['title', 'query', 'input', 'dataset', 'extraction', 'sourceHash'], 'INVALID_PUBLICATION_PLAN');
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 128) throw fail('PLAN_TITLE_REQUIRED');
  const original = await readPrivate(sourceFile, 1048576);
  if (digest(original) !== input.sourceHash) throw fault('SOURCE_REVIEW_CHANGED', 'Reload the source before saving this plan.', 409);
  const { declaration, source } = parse(original), query = source.queries[input.query];
  if (!query) throw fail('QUERY_NOT_FOUND');
  bindSftpParameters(query, input.input ?? {});
  const extraction = sftpDatasetExtractionOptions(query, input.extraction);
  exact(input.dataset, ['name', 'columns', 'filters', 'ranges', 'sorts', 'maxCellChars', 'defaultLimit', 'maxLimit', 'maxPageBytes'], 'INVALID_DATASET_PLAN');
  if (!object(input.dataset.columns) || !Object.keys(input.dataset.columns).length ||
      Object.keys(input.dataset.columns).some(name => !query.columns.includes(name))) throw fail('DATASET_COLUMN_NOT_IN_QUERY');
  const columns = Object.fromEntries(Object.entries(input.dataset.columns).map(([name, supplied]) => {
    const value = typeof supplied === 'string' ? { type: supplied, nullable: false } : supplied;
    exact(value, ['type', 'nullable'], 'INVALID_DATASET_COLUMN');
    return [name, { type: value.type, nullable: value.nullable ?? false }];
  }));
  checkSftpDatasetColumnTypes(columns, Object.fromEntries(Object.entries(query.mapping).map(([name, spec]) =>
    [name, { type: spec.type, nullable: spec.nullable, counts: {}, sourceTypes: {} }])));
  const dataset = { schema: 'stellar-forge.csv-dataset.v1', file: 'data.csv', name: input.dataset.name,
    columns, filters: input.dataset.filters ?? [], ranges: input.dataset.ranges ?? [], sorts: input.dataset.sorts ?? [],
    maxBytes: extraction.maxBytes, maxRows: extraction.maxRows, maxCellChars: input.dataset.maxCellChars ?? 65536,
    defaultLimit: input.dataset.defaultLimit ?? 50, maxLimit: input.dataset.maxLimit ?? 250,
    maxPageBytes: input.dataset.maxPageBytes ?? 921600 };
  await createFile(join(directory, 'schema.csv'), csvLine(Object.keys(columns)));
  await loadCsvDataset({ ...dataset, file: join(directory, 'schema.csv') });
  await createFile(join(directory, 'original-source.json'), original);
  // Retain the declaration accepted by readSftpSourceFile, not its normalized runtime form.
  const runtime = bytes(declaration); await createFile(join(directory, 'source.json'), runtime);
  const sourceQuery = describeSftpQuery(query);
  const value = { schema: 'stellar-forge.sftp-dataset-plan.v1', title: input.title.trim(), query: input.query,
    input: structuredClone(input.input ?? {}), dataset, extraction, sourceHash: digest(original), sourceBytes: original.length,
    caHash: null, runtimeSourceHash: digest(runtime), queryHash: identity(sourceQuery), sourceQuery };
  value.digest = identity(value); await createFile(join(directory, 'plan.json'), bytes(value)); return value;
}
export function checkSftpDatasetColumnTypes(columns, types) {
  if (!object(types)) throw fail('DATASET_COLUMN_TYPE_MISMATCH');
  for (const [name, spec] of Object.entries(columns)) {
    const source = types[name];
    if (!object(source) || !['string', 'integer', 'number', 'boolean'].includes(source.type) ||
        !['string', 'integer', 'number', 'boolean'].includes(spec.type) ||
        spec.type !== 'string' && spec.type !== source.type || !object(source.counts)) throw fail('DATASET_COLUMN_TYPE_MISMATCH');
    if (!spec.nullable && source.counts.null) throw fail('DATASET_NULL_NOT_ALLOWED');
  }
}
export function encodeSftpDatasetRow(row, dataset) {
  return csvLine(Object.entries(dataset.columns).map(([name, spec]) => {
    if (!Object.hasOwn(row, name)) throw fail('DATASET_SOURCE_FIELD_MISSING');
    const value = row[name];
    if (value === null) { if (!spec.nullable) throw fail('DATASET_NULL_NOT_ALLOWED'); return ''; }
    let text;
    if (spec.type === 'string') {
      if (!['string', 'boolean', 'number'].includes(typeof value)) throw fail('DATASET_SOURCE_ENCODING_INVALID');
      text = String(value);
    } else if (spec.type === 'boolean') {
      if (typeof value !== 'boolean') throw fail('DATASET_BOOLEAN_INVALID'); text = String(value);
    } else {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw fail('DATASET_NUMBER_NOT_FINITE');
      if (spec.type === 'integer' && !Number.isSafeInteger(value)) throw fail('DATASET_INTEGER_REQUIRES_EXACT_STRING');
      text = Object.is(value, -0) ? '-0' : String(value);
    }
    if (text.length > dataset.maxCellChars) throw fail('DATASET_CELL_TOO_LARGE');
    if (text === '' && spec.nullable) throw fail('DATASET_EMPTY_NULL_CONFLICT');
    return text;
  }));
}
export function validateSftpExtraction(value) {
  if (value?.schema !== 'stellar-forge.sftp-dataset-extraction.v1' || value.complete !== true || value.readOnly !== true ||
      value.capture?.schema !== 'stellar-forge.sftp-capture.v1' || value.capture.complete !== true ||
      !/^[a-f0-9]{64}$/.test(value.capture.sha256) || !Number.isSafeInteger(value.capture.bytes) || value.capture.bytes < 0 ||
      value.valueEncoding !== 'utf8-file-explicit-projection' || !Number.isSafeInteger(value.rowCount) || value.rowCount < 0 ||
      !Number.isSafeInteger(value.inputRowCount) || value.inputRowCount < value.rowCount || !Array.isArray(value.columns) || !object(value.columnTypes)) return false;
  return value.columns.every(name => {
    const types = value.columnTypes[name];
    return object(types) && ['counts', 'sourceTypes'].every(field => object(types[field]) &&
      Object.values(types[field]).every(n => Number.isSafeInteger(n) && n >= 0) &&
      Object.values(types[field]).reduce((sum, n) => sum + n, 0) === value.rowCount);
  });
}
