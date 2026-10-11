// MIT. Reviewed native PostgreSQL -> original CSV dataset declaration.
import { dirname, join, resolve } from 'node:path';
import { loadCsvDataset } from '../../dataset-handler.mjs';
import { readPostgresSourceFile } from '../config.mjs';
import { bindPostgresParameters, compilePostgresQueries } from '../declaration.mjs';
import { PostgresResultError } from '../stream.mjs';
import { datasetExtractionOptions } from './stream.mjs';
import { object, bytes, digest, identity, readPrivate, createFile, fault } from './files.mjs';

const only = (value, keys, code) => {
  if (!object(value) || Object.keys(value).some(key => !keys.includes(key))) throw fault(code);
};
const count = (value, low, high, label) => {
  if (!Number.isSafeInteger(value) || value < low || value > high) throw fault('INVALID_LIMIT', label + ' is outside its allowed range.');
  return value;
};
export const csvCell = value => '"' + String(value).replaceAll('"', '""') + '"';
export const csvLine = values => values.map(csvCell).join(',') + '\n';

export async function inspectSource(path) {
  const original = await readPrivate(path);
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(original));
  if (!object(value) || value.schema !== 'stellar-forge.postgres-source.v1') throw fault('POSTGRES_SOURCE_CONFIG_INVALID');
  const queries = compilePostgresQueries(value.queries);
  return { hash: digest(original), bytes: original.length, queries: Object.fromEntries(Object.entries(queries).map(([name, query]) =>
    [name, { sql: query.sql, columns: query.columns, parameters: query.parameters, parameterOrder: query.parameterOrder }])) };
}

/** Keep the original bytes, then resolve only the CA file into a retained copy.
 * Environment references stay references. No environment value is stored. */
export async function capturePlan(sourceFile, directory, input) {
  only(input, ['title', 'query', 'input', 'dataset', 'extraction', 'sourceHash'], 'INVALID_PUBLICATION_PLAN');
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 128)
    throw fault('PLAN_TITLE_REQUIRED');
  const original = await readPrivate(sourceFile);
  if (digest(original) !== input.sourceHash) throw fault('SOURCE_REVIEW_CHANGED', 'Reload the source before saving this plan.', 409);
  let raw;
  try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(original)); }
  catch { throw fault('POSTGRES_SOURCE_JSON_INVALID'); }
  await createFile(join(directory, 'original-source.json'), original);
  const source = structuredClone(raw);
  const caFile = source.connection?.caFile ?? source.caFile;
  let caHash = null;
  if (caFile !== undefined) {
    if (typeof caFile !== 'string') throw fault('POSTGRES_CA_FILE_INVALID');
    const ca = await readPrivate(resolve(dirname(sourceFile), caFile), 1048576);
    caHash = digest(ca); await createFile(join(directory, 'ca.pem'), ca);
    if (source.connection?.caFile !== undefined) source.connection.caFile = 'ca.pem';
    if (source.caFile !== undefined) source.caFile = 'ca.pem';
  }
  await createFile(join(directory, 'source.json'), bytes(source));
  const declaration = await readPostgresSourceFile(join(directory, 'source.json'));
  const queries = compilePostgresQueries(declaration.config.queries), query = queries[input.query];
  if (!query) throw fault('QUERY_NOT_FOUND');
  bindPostgresParameters(query, input.input ?? {});
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
  const dataset = { schema: 'stellar-forge.csv-dataset.v1', file: 'data.csv', name: input.dataset.name,
    columns, filters: input.dataset.filters ?? [], ranges: input.dataset.ranges ?? [], sorts: input.dataset.sorts ?? [],
    maxBytes: extraction.maxBytes, maxRows: extraction.maxRows,
    maxCellChars: count(input.dataset.maxCellChars ?? 65536, 1, 1048576, 'Cell size'),
    defaultLimit: input.dataset.defaultLimit ?? 50, maxLimit: input.dataset.maxLimit ?? 250,
    maxPageBytes: input.dataset.maxPageBytes ?? 921600 };
  await createFile(join(directory, 'schema.csv'), csvLine(Object.keys(columns)));
  // The maintained native loader is the schema validator, including all existing
  // scalar, filter, range, sort and query-budget rules.
  await loadCsvDataset({ ...dataset, file: join(directory, 'schema.csv') });
  const value = { schema: 'stellar-forge.postgres-dataset-plan.v1', title: input.title.trim(),
    query: input.query, input: structuredClone(input.input ?? {}), dataset, extraction,
    sourceHash: digest(original), sourceBytes: original.length, caHash,
    runtimeSourceHash: digest(bytes(source)), queryHash: identity(query),
    sourceQuery: { sql: query.sql, columns: query.columns, parameters: query.parameters } };
  value.digest = identity(value);
  await createFile(join(directory, 'plan.json'), bytes(value));
  return value;
}

export function checkColumnTypes(columns, types) {
  const byName = new Map(types.map(field => [field.name, field.oid]));
  for (const [name, spec] of Object.entries(columns)) {
    const oid = byName.get(name);
    if (!oid || spec.type === 'boolean' && oid !== 16 ||
        spec.type === 'integer' && ![20, 21, 23].includes(oid) ||
        spec.type === 'number' && ![700, 701].includes(oid))
      throw new PostgresResultError('DATASET_COLUMN_TYPE_MISMATCH');
  }
}

export function encodeRow(row, dataset) {
  const fail = code => { throw new PostgresResultError(code); };
  return csvLine(Object.entries(dataset.columns).map(([name, spec]) => {
    const value = row[name];
    if (value === null) { if (!spec.nullable) fail('DATASET_NULL_NOT_ALLOWED'); return ''; }
    if (typeof value !== 'string') fail('DATASET_SOURCE_ENCODING_INVALID');
    if (value.length > dataset.maxCellChars) fail('DATASET_CELL_TOO_LARGE');
    // Native CSV uses an empty nullable cell as NULL. Preserve that contract
    // without silently turning a real empty PostgreSQL string into NULL.
    if (value === '' && spec.nullable) fail('DATASET_EMPTY_NULL_CONFLICT');
    if (spec.type === 'string') return value;
    if (spec.type === 'boolean') {
      if (!['t', 'f'].includes(value)) fail('DATASET_BOOLEAN_INVALID');
      return value === 't' ? 'true' : 'false';
    }
    if (spec.type === 'integer' && (!/^-?(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value))))
      fail('DATASET_INTEGER_REQUIRES_EXACT_STRING');
    if (spec.type === 'number' && !Number.isFinite(Number(value))) fail('DATASET_NUMBER_NOT_FINITE');
    return value;
  }));
}
