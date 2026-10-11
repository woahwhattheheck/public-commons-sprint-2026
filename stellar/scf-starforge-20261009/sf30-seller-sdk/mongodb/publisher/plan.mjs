// MIT. Exact native MongoDB source, typed CSV projection, and retained review.
import { dirname, join, resolve } from 'node:path';
import { loadCsvDataset } from '../../dataset-handler.mjs';
import { readMongoSourceFile, validateMongoSource } from '../config.mjs';
import { compileMongoQueries, bindMongoParameters } from '../declaration.mjs';
import { canonicalEjson, bsonType } from '../values.mjs';
import { csvLine } from '../../postgres/publisher/plan.mjs';
import { object, bytes, digest, identity, readPrivate, createFile, fault } from '../../postgres/publisher/files.mjs';
import { MongoDatasetError, mongoDatasetExtractionOptions } from './stream.mjs';

const only = (value, keys, code) => {
  if (!object(value) || Object.keys(value).some(key => !keys.includes(key))) throw fault(code);
};
const count = (value, low, high, label) => {
  if (!Number.isSafeInteger(value) || value < low || value > high)
    throw fault('INVALID_LIMIT', label + ' is outside its allowed range.');
  return value;
};
const description = query => ({ collection: query.collection, pipeline: structuredClone(query.pipeline),
  readConcern: query.readConcern, referencedCollections: [...query.referencedCollections],
  columns: [...query.columns], parameters: structuredClone(query.parameters), parameterOrder: [...query.parameterOrder] });
function parseSource(original) {
  let source;
  try { source = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(original)); }
  catch { throw fault('MONGODB_SOURCE_JSON_INVALID'); }
  return validateMongoSource(source);
}

export async function inspectMongoPublicationSource(path) {
  const original = await readPrivate(path, 262144), source = parseSource(original);
  return { hash: digest(original), bytes: original.length,
    queries: Object.fromEntries(Object.entries(compileMongoQueries(source.queries)).map(([name, query]) => [name, description(query)])) };
}

export async function captureMongoPublicationPlan(sourceFile, directory, input) {
  only(input, ['title', 'query', 'input', 'dataset', 'extraction', 'sourceHash'], 'INVALID_PUBLICATION_PLAN');
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 128) throw fault('PLAN_TITLE_REQUIRED');
  const original = await readPrivate(sourceFile, 262144);
  if (digest(original) !== input.sourceHash) throw fault('SOURCE_REVIEW_CHANGED', 'Reload the source before saving this plan.', 409);
  const source = parseSource(original);
  await createFile(join(directory, 'original-source.json'), original);
  let caHash = null;
  if (source.connection.caFile !== undefined) {
    const ca = await readPrivate(resolve(dirname(sourceFile), source.connection.caFile), 1048576);
    caHash = digest(ca); await createFile(join(directory, 'ca.pem'), ca); source.connection.caFile = 'ca.pem';
  }
  const runtimeBytes = bytes(source); await createFile(join(directory, 'source.json'), runtimeBytes);
  const declaration = await readMongoSourceFile(join(directory, 'source.json'));
  const query = compileMongoQueries(declaration.config.queries)[input.query];
  if (!query) throw fault('QUERY_NOT_FOUND');
  bindMongoParameters(query, input.input ?? {});
  const extraction = mongoDatasetExtractionOptions(query, input.extraction);
  only(input.dataset, ['name', 'columns', 'filters', 'ranges', 'sorts', 'maxCellChars', 'defaultLimit', 'maxLimit', 'maxPageBytes'], 'INVALID_DATASET_PLAN');
  if (!object(input.dataset.columns) || !Object.keys(input.dataset.columns).length ||
      Object.keys(input.dataset.columns).some(name => !query.columns.includes(name))) throw fault('DATASET_COLUMN_NOT_IN_QUERY');
  if (Object.keys(input.dataset.columns).some(name => !/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(name)))
    throw fault('DATASET_COLUMN_REQUIRES_PUBLIC_ALIAS',
      'Alias this source field in the reviewed pipeline: dataset columns begin with a letter and contain at most 48 letters, digits or underscores.');
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
  const sourceQuery = description(query);
  const value = { schema: 'stellar-forge.mongodb-dataset-plan.v1', title: input.title.trim(),
    query: input.query, input: structuredClone(input.input ?? {}), dataset, extraction,
    sourceHash: digest(original), sourceBytes: original.length, caHash,
    runtimeSourceHash: digest(runtimeBytes), queryHash: identity(sourceQuery), sourceQuery };
  value.digest = identity(value); await createFile(join(directory, 'plan.json'), bytes(value)); return value;
}

const integerTypes = new Set(['Int32', 'Long']);
const numberTypes = new Set(['Double', 'number']);
export function checkMongoDatasetColumnTypes(columns, types) {
  if (!object(types)) throw new MongoDatasetError('DATASET_COLUMN_TYPE_MISMATCH');
  for (const [name, spec] of Object.entries(columns)) {
    if (!Object.hasOwn(types, name) || !object(types[name])) throw new MongoDatasetError('DATASET_COLUMN_TYPE_MISMATCH');
    for (const [type, occurrences] of Object.entries(types[name])) {
      if (!Number.isSafeInteger(occurrences) || occurrences < 0) throw new MongoDatasetError('DATASET_COLUMN_TYPE_MISMATCH');
      if (type === 'missing') throw new MongoDatasetError('DATASET_MISSING_FIELD_REQUIRES_EXPLICIT_PROJECTION');
      if (type === 'null') { if (!spec.nullable) throw new MongoDatasetError('DATASET_NULL_NOT_ALLOWED'); continue; }
      if (spec.type === 'integer' && !integerTypes.has(type) || spec.type === 'number' && !numberTypes.has(type) ||
          spec.type === 'boolean' && type !== 'boolean') throw new MongoDatasetError('DATASET_COLUMN_TYPE_MISMATCH');
    }
  }
}

/** String projection keeps exact integer/decimal text. Structured BSON values
 * use canonical Extended JSON, preserving their nested BSON scalar types. */
export function encodeMongoDatasetRow(row, dataset) {
  const fail = code => { throw new MongoDatasetError(code); };
  return csvLine(Object.entries(dataset.columns).map(([name, spec]) => {
    if (!Object.hasOwn(row, name)) fail('DATASET_MISSING_FIELD_REQUIRES_EXPLICIT_PROJECTION');
    const value = row[name], type = bsonType(value);
    if (value === null) { if (!spec.nullable) fail('DATASET_NULL_NOT_ALLOWED'); return ''; }
    let text;
    if (spec.type === 'boolean') {
      if (typeof value !== 'boolean') fail('DATASET_BOOLEAN_INVALID'); text = value ? 'true' : 'false';
    } else if (spec.type === 'integer') {
      if (!integerTypes.has(type)) fail('DATASET_COLUMN_TYPE_MISMATCH');
      text = value.toString();
      if (!/^-?(0|[1-9][0-9]*)$/.test(text) || !Number.isSafeInteger(Number(text)))
        fail('DATASET_INTEGER_REQUIRES_EXACT_STRING');
    } else if (spec.type === 'number') {
      if (!numberTypes.has(type)) fail('DATASET_COLUMN_TYPE_MISMATCH');
      const numeric = type === 'Double' ? value.value : value;
      if (!Number.isFinite(numeric)) fail('DATASET_NUMBER_NOT_FINITE');
      text = Object.is(numeric, -0) ? '-0' : String(numeric);
    } else if (spec.type === 'string') {
      if (typeof value === 'string') text = value;
      else if (['Int32', 'Long', 'Decimal128'].includes(type)) text = value.toString();
      else if (type === 'ObjectId') text = value.toHexString();
      else if (typeof value === 'boolean') text = String(value);
      else text = JSON.stringify(canonicalEjson(value));
    } else fail('DATASET_COLUMN_TYPE_MISMATCH');
    if (typeof text !== 'string') fail('DATASET_SOURCE_ENCODING_INVALID');
    if (text.length > dataset.maxCellChars) fail('DATASET_CELL_TOO_LARGE');
    if (text === '' && spec.nullable) fail('DATASET_EMPTY_NULL_CONFLICT');
    return text;
  }));
}

export function validateMongoExtraction(extraction) {
  if (extraction?.schema !== 'stellar-forge.mongodb-dataset-extraction.v1' || extraction.complete !== true ||
      extraction.readOnly !== true || !['snapshot', 'majority', 'local'].includes(extraction.read?.concern) ||
      extraction.read.preference !== 'primary' || extraction.read.session !== 'one-extraction' ||
      extraction.valueEncoding !== 'mongodb-native-bson' || !Number.isSafeInteger(extraction.rowCount) ||
      extraction.rowCount < 0 || !object(extraction.columnTypes) || !Array.isArray(extraction.columns)) return false;
  return extraction.columns.every(name => object(extraction.columnTypes[name]) &&
    Object.values(extraction.columnTypes[name]).every(count => Number.isSafeInteger(count) && count >= 0) &&
    Object.values(extraction.columnTypes[name]).reduce((total, count) => total + count, 0) === extraction.rowCount);
}
