// MIT. Reviewed MySQL source and exact projection for the original publisher.
import { dirname, join, resolve } from 'node:path';
import { loadCsvDataset } from '../../dataset-handler.mjs';
import { readMysqlSourceFile } from '../config.mjs';
import { compileMysqlQueries, bindMysqlParameters } from '../declaration.mjs';
import { csvLine } from '../../postgres/publisher/plan.mjs';
import { object, bytes, digest, identity, readPrivate, createFile, fault } from '../../postgres/publisher/files.mjs';
import { MysqlDatasetError, mysqlDatasetExtractionOptions } from './stream.mjs';

const only = (value, keys, code) => {
  if (!object(value) || Object.keys(value).some(key => !keys.includes(key))) throw fault(code);
};
const count = (value, low, high, label) => {
  if (!Number.isSafeInteger(value) || value < low || value > high)
    throw fault('INVALID_LIMIT', label + ' is outside its allowed range.');
  return value;
};

export async function inspectMysqlPublicationSource(path) {
  const original = await readPrivate(path, 262144);
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(original)); }
  catch { throw fault('MYSQL_SOURCE_JSON_INVALID'); }
  if (!object(value) || value.schema !== 'stellar-forge.mysql-source.v1') throw fault('MYSQL_SOURCE_CONFIG_INVALID');
  const queries = compileMysqlQueries(value.queries);
  return { hash: digest(original), bytes: original.length,
    queries: Object.fromEntries(Object.entries(queries).map(([name, query]) => [name, {
      sql: query.sql, columns: query.columns, parameters: query.parameters, parameterOrder: query.parameterOrder,
    }])) };
}

/** Retain source bytes and a copied CA; the original MySQL reader validates the
 * captured runtime profile while all credential references remain references. */
export async function captureMysqlPublicationPlan(sourceFile, directory, input) {
  only(input, ['title', 'query', 'input', 'dataset', 'extraction', 'sourceHash'], 'INVALID_PUBLICATION_PLAN');
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 128)
    throw fault('PLAN_TITLE_REQUIRED');
  const original = await readPrivate(sourceFile, 262144);
  if (digest(original) !== input.sourceHash)
    throw fault('SOURCE_REVIEW_CHANGED', 'Reload the source before saving this plan.', 409);
  let source;
  try { source = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(original)); }
  catch { throw fault('MYSQL_SOURCE_JSON_INVALID'); }
  if (!object(source) || source.schema !== 'stellar-forge.mysql-source.v1') throw fault('MYSQL_SOURCE_CONFIG_INVALID');
  await createFile(join(directory, 'original-source.json'), original);
  const caFile = source.connection?.caFile;
  let caHash = null;
  if (caFile !== undefined) {
    if (typeof caFile !== 'string') throw fault('MYSQL_CA_FILE_INVALID');
    const ca = await readPrivate(resolve(dirname(sourceFile), caFile), 1048576);
    caHash = digest(ca); await createFile(join(directory, 'ca.pem'), ca);
    source.connection.caFile = 'ca.pem';
  }
  const runtimeBytes = bytes(source);
  await createFile(join(directory, 'source.json'), runtimeBytes);
  const declaration = await readMysqlSourceFile(join(directory, 'source.json'));
  const queries = compileMysqlQueries(declaration.config.queries), query = queries[input.query];
  if (!query) throw fault('QUERY_NOT_FOUND');
  bindMysqlParameters(query, input.input ?? {});
  const extraction = mysqlDatasetExtractionOptions(query, input.extraction);
  only(input.dataset, ['name', 'columns', 'filters', 'ranges', 'sorts', 'maxCellChars', 'defaultLimit', 'maxLimit', 'maxPageBytes'], 'INVALID_DATASET_PLAN');
  if (!object(input.dataset.columns) || !Object.keys(input.dataset.columns).length ||
      Object.keys(input.dataset.columns).some(name => !query.columns.includes(name)))
    throw fault('DATASET_COLUMN_NOT_IN_QUERY');
  const columns = Object.fromEntries(Object.entries(input.dataset.columns).map(([name, supplied]) => {
    const value = typeof supplied === 'string' ? { type: supplied, nullable: false } : supplied;
    only(value, ['type', 'nullable'], 'INVALID_DATASET_COLUMN');
    return [name, { type: value.type, nullable: value.nullable ?? false }];
  }));
  const dataset = { schema: 'stellar-forge.csv-dataset.v1', file: 'data.csv', name: input.dataset.name,
    columns, filters: input.dataset.filters ?? [], ranges: input.dataset.ranges ?? [], sorts: input.dataset.sorts ?? [],
    maxBytes: extraction.maxBytes, maxRows: extraction.maxRows,
    maxCellChars: count(input.dataset.maxCellChars ?? 65536, 1, 1048576, 'Cell size'),
    defaultLimit: input.dataset.defaultLimit ?? 50, maxLimit: input.dataset.maxLimit ?? 250,
    maxPageBytes: input.dataset.maxPageBytes ?? 921600 };
  await createFile(join(directory, 'schema.csv'), csvLine(Object.keys(columns)));
  await loadCsvDataset({ ...dataset, file: join(directory, 'schema.csv') });
  const value = { schema: 'stellar-forge.mysql-dataset-plan.v1', title: input.title.trim(),
    query: input.query, input: structuredClone(input.input ?? {}), dataset, extraction,
    sourceHash: digest(original), sourceBytes: original.length, caHash,
    runtimeSourceHash: digest(runtimeBytes), queryHash: identity(query),
    sourceQuery: { sql: query.sql, columns: query.columns, parameters: query.parameters } };
  value.digest = identity(value);
  await createFile(join(directory, 'plan.json'), bytes(value));
  return value;
}

const integers = new Set([1, 2, 3, 8, 9, 13]);
export function checkMysqlDatasetColumnTypes(columns, types) {
  if (!Array.isArray(types)) throw new MysqlDatasetError('DATASET_COLUMN_TYPE_MISMATCH');
  const byName = new Map(types.map(field => [field.name, field.type]));
  for (const [name, spec] of Object.entries(columns)) {
    const type = byName.get(name);
    if (!byName.has(name) || !Number.isInteger(type) ||
        spec.type === 'integer' && !integers.has(type) ||
        spec.type === 'number' && ![4, 5].includes(type) ||
        spec.type === 'boolean' && !integers.has(type) && type !== 16)
      throw new MysqlDatasetError('DATASET_COLUMN_TYPE_MISMATCH');
  }
}

export function encodeMysqlDatasetRow(row, dataset) {
  const fail = code => { throw new MysqlDatasetError(code); };
  return csvLine(Object.entries(dataset.columns).map(([name, spec]) => {
    let value = row[name];
    if (value === null) { if (!spec.nullable) fail('DATASET_NULL_NOT_ALLOWED'); return ''; }
    if (object(value) && Object.keys(value).length === 1 && typeof value.base64 === 'string') {
      if (value.base64.length > dataset.maxCellChars) fail('DATASET_CELL_TOO_LARGE');
      const buffer = Buffer.from(value.base64, 'base64');
      if (buffer.toString('base64') !== value.base64) fail('DATASET_SOURCE_ENCODING_INVALID');
      if (spec.type === 'boolean') {
        if (buffer.length !== 1 || buffer[0] > 1) fail('DATASET_BOOLEAN_INVALID');
        value = String(buffer[0]);
      } else {
        if (spec.type !== 'string') fail('DATASET_BINARY_REQUIRES_STRING');
        value = value.base64;
      }
    }
    if (typeof value !== 'string') fail('DATASET_SOURCE_ENCODING_INVALID');
    if (value.length > dataset.maxCellChars) fail('DATASET_CELL_TOO_LARGE');
    if (value === '' && spec.nullable) fail('DATASET_EMPTY_NULL_CONFLICT');
    if (spec.type === 'string') return value;
    if (spec.type === 'boolean') {
      if (!['0', '1'].includes(value)) fail('DATASET_BOOLEAN_INVALID');
      return value === '1' ? 'true' : 'false';
    }
    if (spec.type === 'integer' && (!/^-?(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value))))
      fail('DATASET_INTEGER_REQUIRES_EXACT_STRING');
    if (spec.type === 'number' && !Number.isFinite(Number(value))) fail('DATASET_NUMBER_NOT_FINITE');
    return value;
  }));
}

export function validateMysqlExtraction(extraction) {
  return extraction?.schema === 'stellar-forge.mysql-dataset-extraction.v1' &&
    extraction.transaction?.isolation === 'REPEATABLE READ' && extraction.transaction.readOnly === true &&
    extraction.transaction.consistentSnapshotRequested === true && extraction.transaction.committed === true &&
    extraction.valueEncoding === 'mysql-exact-scalars' && extraction.binaryEncoding === 'base64-object' &&
    extraction.nullEncoding === 'json-null' && Number.isSafeInteger(extraction.rowCount) && extraction.rowCount >= 0;
}
