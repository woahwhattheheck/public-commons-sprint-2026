// MIT. Operator extraction through the original PostgreSQL source transaction.
import { PostgresResultError } from '../stream.mjs';

const fail = code => new PostgresResultError(code);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value, low, high, name) => {
  if (!Number.isSafeInteger(value) || value < low || value > high) throw fail(name);
  return value;
};
const quote = name => '"' + name + '"';

export function datasetExtractionOptions(query, supplied = {}) {
  if (!object(supplied) || Object.keys(supplied).some(key =>
    !['maxRows', 'maxBytes', 'maxRowBytes', 'timeoutMs', 'order'].includes(key)))
    throw fail('DATASET_EXTRACTION_OPTIONS_INVALID');
  const limits = {
    maxRows: integer(supplied.maxRows ?? 250000, 1, 1000000, 'DATASET_EXTRACTION_ROW_LIMIT'),
    maxBytes: integer(supplied.maxBytes ?? 67108864, 1024, 268435456, 'DATASET_EXTRACTION_BYTE_LIMIT'),
    maxRowBytes: integer(supplied.maxRowBytes ?? 1048576, 1024, 8388608, 'DATASET_EXTRACTION_ROW_BYTES'),
    timeoutMs: integer(supplied.timeoutMs ?? 30000, 100, 300000, 'DATASET_EXTRACTION_TIMEOUT'),
  };
  if (!Array.isArray(supplied.order) || !supplied.order.length || supplied.order.length > query.columns.length)
    throw fail('DATASET_EXTRACTION_ORDER_REQUIRED');
  const names = new Set();
  limits.order = supplied.order.map(item => {
    if (!object(item) || Object.keys(item).some(key => !['column', 'direction'].includes(key)) ||
        !query.columns.includes(item.column) || names.has(item.column) || !['asc', 'desc'].includes(item.direction))
      throw fail('DATASET_EXTRACTION_ORDER_INVALID');
    names.add(item.column); return { column: item.column, direction: item.direction };
  });
  return limits;
}

function statement(query, limits) {
  let flag = '__sf30_export_oversized';
  while (query.columns.includes(flag)) flag += '_';
  const names = query.columns.map(quote);
  const ordering = limits.order.map(item => quote(item.column) + ' ' + item.direction.toUpperCase() + ' NULLS LAST').join(', ');
  const bytes = names.map(name => 'COALESCE(octet_length(' + name + '::text)::bigint, 0)').join(' + ');
  // The explicit outer ordering survives the byte-guard projection. PostgreSQL
  // suppresses an oversized row before any of its values reach the driver.
  return 'WITH sf30_extract AS MATERIALIZED (SELECT ' + names.join(', ') + '\nFROM (\n' + query.sql +
    '\n) AS sf30_approved_source ORDER BY ' + ordering + ' LIMIT ' + (limits.maxRows + 1) +
    '), sf30_export_budget AS MATERIALIZED (SELECT sf30_extract.*, (' + bytes + ') > ' +
    limits.maxRowBytes + ' AS ' + quote(flag) + ' FROM sf30_extract)\nSELECT ' +
    names.map(name => 'CASE WHEN ' + quote(flag) + ' THEN NULL ELSE ' + name + ' END AS ' + name).join(', ') +
    ', ' + quote(flag) + ' FROM sf30_export_budget ORDER BY ' + ordering;
}

/** No successful partial export: every row is delivered inside one original
 * read-only transaction; the caller commits before exposing the candidate. */
export async function readPostgresDataset(client, query, { name, values, Cursor,
  ensureActive, options, onRow }) {
  const info = await client.query({ text: "SELECT pg_catalog.pg_current_snapshot()::text AS snapshot, " +
    "pg_catalog.transaction_timestamp()::text AS started, current_setting('transaction_isolation') AS isolation, " +
    "current_setting('transaction_read_only') AS readonly", rowMode: 'array', queryMode: 'extended' });
  ensureActive();
  if (info.rows[0]?.[2] !== 'repeatable read' || info.rows[0]?.[3] !== 'on')
    throw fail('DATASET_EXTRACTION_TRANSACTION_INVALID');
  const cursor = client.query(new Cursor(statement(query, options), values, {
    rowMode: 'array', types: Object.freeze({ getTypeParser: () => value => value }),
  }));
  let columnTypes, rowCount = 0, sourceTextBytes = 0;
  while (true) {
    const batch = await new Promise((resolve, reject) => cursor.read(8, (issue, rows, result) =>
      issue ? reject(issue) : resolve({ rows, fields: result?.fields })));
    ensureActive();
    if (!columnTypes) {
      if (batch.fields?.length !== query.columns.length + 1 ||
          batch.fields.slice(0, -1).some((field, index) => field.name !== query.columns[index]) ||
          batch.fields.at(-1).dataTypeID !== 16) throw fail('QUERY_PROJECTION_CHANGED');
      columnTypes = batch.fields.slice(0, -1).map(field => ({ name: field.name, oid: field.dataTypeID }));
    }
    if (!batch.rows.length) break;
    for (const row of batch.rows) {
      ensureActive();
      if (rowCount >= options.maxRows) throw fail('DATASET_EXTRACTION_TOO_MANY_ROWS');
      if (row.length !== query.columns.length + 1 || row.at(-1) !== 'f')
        throw fail('DATASET_EXTRACTION_ROW_TOO_LARGE');
      const values = row.slice(0, -1);
      if (values.some(value => value !== null && typeof value !== 'string'))
        throw fail('DATASET_EXTRACTION_ENCODING_CHANGED');
      sourceTextBytes += values.reduce((total, value) => total + (value === null ? 0 : Buffer.byteLength(value)), 0);
      if (sourceTextBytes > options.maxBytes) throw fail('DATASET_EXTRACTION_TOO_MANY_BYTES');
      await onRow(Object.fromEntries(query.columns.map((column, index) => [column, values[index]])),
        columnTypes, { rowCount: rowCount + 1, sourceTextBytes });
      ensureActive(); rowCount++;
    }
  }
  await cursor.close(); ensureActive();
  return { schema: 'stellar-forge.postgres-dataset-extraction.v1', query: name,
    rowCount, sourceTextBytes, columns: [...query.columns], columnTypes,
    transaction: { snapshot: info.rows[0][0], startedAt: info.rows[0][1], isolation: 'REPEATABLE READ', readOnly: true },
    valueEncoding: 'postgres-text', nullEncoding: 'json-null', order: options.order };
}
