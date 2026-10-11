// MIT. Original SQLite source -> original retained dataset publisher.
import { dirname, join, resolve } from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import { compileQueries, bindParameters } from '../parameters.mjs';
import { openSqliteQueryFile } from '../config.mjs';
import { loadCsvDataset } from '../../dataset-handler.mjs';
import { csvLine } from '../../postgres/publisher/plan.mjs';
import { object, bytes, digest, identity, readPrivate, createFile, fault } from '../../postgres/publisher/files.mjs';
import { sqliteExtractionOptions } from './extraction.mjs';

const only = (value, keys, code) => {
  if (!object(value) || Object.keys(value).some(key => !keys.includes(key))) throw fault(code);
};
async function sourceRecord(path) {
  const original = await readPrivate(path);
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(original)); }
  catch { throw fault('SQLITE_SOURCE_JSON_INVALID'); }
  if (!object(value) || value.schema !== 'stellar-forge.sqlite-source.v1' ||
      typeof value.database !== 'string' || !value.database || value.database.includes('\0'))
    throw fault('SQLITE_SOURCE_CONFIG_INVALID');
  return { original, value, queries: compileQueries(value.queries) };
}
async function databaseIdentity(path) {
  const canonical = await realpath(path), info = await stat(canonical, { bigint: true });
  if (!info.isFile()) throw fault('SQLITE_DATABASE_FILE_REQUIRED');
  return { path: canonical, device: String(info.dev), inode: String(info.ino) };
}

export async function inspectSqlitePublicationSource(path) {
  const source = await sourceRecord(path);
  return { hash: digest(source.original), bytes: source.original.length,
    queries: Object.fromEntries(Object.entries(source.queries).map(([name, query]) =>
      [name, { sql: query.sql, columns: query.columns, parameters: query.parameters }])) };
}

export async function captureSqlitePublicationPlan(sourceFile, directory, input) {
  only(input, ['title', 'query', 'input', 'dataset', 'extraction', 'sourceHash'], 'INVALID_PUBLICATION_PLAN');
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 128)
    throw fault('PLAN_TITLE_REQUIRED');
  const { original, value, queries } = await sourceRecord(sourceFile);
  if (digest(original) !== input.sourceHash) throw fault('SOURCE_REVIEW_CHANGED', 'Reload the source before saving this plan.', 409);
  const query = queries[input.query];
  if (!query) throw fault('QUERY_NOT_FOUND');
  bindParameters(query, input.input ?? {});
  const extraction = sqliteExtractionOptions(query, input.extraction);
  only(input.dataset, ['name', 'columns', 'filters', 'ranges', 'sorts', 'maxCellChars', 'defaultLimit', 'maxLimit', 'maxPageBytes'], 'INVALID_DATASET_PLAN');
  if (!object(input.dataset.columns) || !Object.keys(input.dataset.columns).length ||
      Object.keys(input.dataset.columns).some(name => !query.columns.includes(name)))
    throw fault('DATASET_COLUMN_NOT_IN_QUERY');
  const columns = Object.fromEntries(Object.entries(input.dataset.columns).map(([name, spec]) => {
    const value = typeof spec === 'string' ? { type: spec, nullable: false } : spec;
    only(value, ['type', 'nullable'], 'INVALID_DATASET_COLUMN');
    return [name, { type: value.type, nullable: value.nullable ?? false }];
  }));
  const maxCellChars = input.dataset.maxCellChars ?? 65536;
  if (!Number.isSafeInteger(maxCellChars) || maxCellChars < 1 || maxCellChars > 1048576)
    throw fault('DATASET_CELL_SIZE_INVALID');
  const dataset = { schema: 'stellar-forge.csv-dataset.v1', file: 'data.csv', name: input.dataset.name,
    columns, filters: input.dataset.filters ?? [], ranges: input.dataset.ranges ?? [], sorts: input.dataset.sorts ?? [],
    maxBytes: extraction.maxBytes, maxRows: extraction.maxRows, maxCellChars,
    defaultLimit: input.dataset.defaultLimit ?? 50, maxLimit: input.dataset.maxLimit ?? 250,
    maxPageBytes: input.dataset.maxPageBytes ?? 921600 };
  await createFile(join(directory, 'schema.csv'), csvLine(Object.keys(columns)));
  await loadCsvDataset({ ...dataset, file: join(directory, 'schema.csv') });
  const observed = await databaseIdentity(resolve(dirname(sourceFile), value.database));
  const runtimeSource = { ...value, database: observed.path, publicationDatabaseIdentity: observed };
  const runtimeBytes = bytes(runtimeSource);
  if (runtimeBytes.length > 262144) throw fault('SQLITE_SOURCE_CONFIG_TOO_LARGE');
  await createFile(join(directory, 'original-source.json'), original);
  await createFile(join(directory, 'source.json'), runtimeBytes);
  const plan = { schema: 'stellar-forge.sqlite-dataset-plan.v1', title: input.title.trim(),
    query: input.query, input: structuredClone(input.input ?? {}), dataset, extraction,
    sourceHash: digest(original), sourceBytes: original.length, runtimeSourceHash: digest(runtimeBytes),
    databaseIdentity: observed, queryHash: identity(query),
    sourceQuery: { sql: query.sql, columns: query.columns, parameters: query.parameters } };
  plan.digest = identity(plan); await createFile(join(directory, 'plan.json'), bytes(plan));
  return plan;
}

function checkColumns(columns, types) {
  if (!Array.isArray(types) || Object.keys(columns).some(name => !types.some(item => item.name === name)))
    throw fault('DATASET_COLUMN_TYPE_MISMATCH');
}
function encodeRow(row, dataset) {
  return csvLine(Object.entries(dataset.columns).map(([name, spec]) => {
    const value = row[name];
    if (value === null) {
      if (!spec.nullable) throw fault('DATASET_NULL_NOT_ALLOWED');
      return '';
    }
    let text;
    if (spec.type === 'string') {
      if (typeof value !== 'string' && typeof value !== 'bigint')
        throw fault('DATASET_TEXT_REQUIRES_SQL_TEXT', 'Choose Float for REAL values; use an explicit SQL text/hex projection for other values.');
      text = String(value);
    } else if (spec.type === 'integer') {
      if (typeof value !== 'bigint' || !Number.isSafeInteger(Number(value)))
        throw fault('DATASET_INTEGER_REQUIRES_EXACT_STRING');
      text = String(value);
    } else if (spec.type === 'number') {
      if (typeof value === 'bigint' && !Number.isSafeInteger(Number(value)) ||
          !['bigint', 'number'].includes(typeof value) || !Number.isFinite(Number(value)))
        throw fault('DATASET_NUMBER_NOT_FINITE');
      text = String(value);
    } else if (spec.type === 'boolean') {
      if (value !== 0n && value !== 1n) throw fault('DATASET_BOOLEAN_INVALID');
      text = value === 1n ? 'true' : 'false';
    } else throw fault('INVALID_DATASET_COLUMN');
    if (text.length > dataset.maxCellChars) throw fault('DATASET_CELL_TOO_LARGE');
    if (text === '' && spec.nullable) throw fault('DATASET_EMPTY_NULL_CONFLICT');
    return text;
  }));
}

async function openSource(filename) {
  const { value } = await sourceRecord(filename);
  const observed = await databaseIdentity(value.database);
  if (identity(observed) !== identity(value.publicationDatabaseIdentity))
    throw fault('SQLITE_DATABASE_REPLACED', 'The selected database file was replaced. Save a newly reviewed source plan.', 409);
  const source = await openSqliteQueryFile(filename);
  try {
    if (identity(await databaseIdentity(value.database)) !== identity(observed)) throw fault('SQLITE_DATABASE_REPLACED');
  } catch (issue) { await source.close(); throw issue; }
  return { source: {
    inspect: () => ({ columnTypes: Object.fromEntries(Object.entries(source.describe()).map(([name, query]) =>
      [name, query.columns.map(column => ({ name: column }))])) }),
    async exportDataset(name, input, options) {
      const result = await source.exportDataset(name, input, options);
      return { ...result, databaseIdentity: observed };
    },
    close: () => source.close(),
  } };
}

export const sqlitePublisherDriver = Object.freeze({
  sourceName: 'SQLite',
  workspaceSchema: 'stellar-forge.sqlite-publisher-workspace.v1',
  statusSchema: 'stellar-forge.sqlite-publisher-status.v1',
  candidateSchema: 'stellar-forge.sqlite-dataset-candidate.v1',
  capturePlan: captureSqlitePublicationPlan,
  inspectSource: inspectSqlitePublicationSource,
  openSource, checkColumnTypes: checkColumns, encodeRow,
  validateExtraction: extraction => extraction?.schema === 'stellar-forge.sqlite-dataset-extraction.v1' &&
    extraction.transaction?.readOnly === true && extraction.transaction.isolation === 'SERIALIZABLE' &&
    extraction.transaction.queryOnly === 1 && extraction.transaction.readUncommitted === 0,
});
