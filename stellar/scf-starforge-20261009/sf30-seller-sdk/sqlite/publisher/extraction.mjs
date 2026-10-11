// MIT. Complete operator export within an original SQLite read worker.
import { constants } from 'node:sqlite';

const fail = code => Object.assign(new Error(code), { code });
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const count = (value, low, high, code) => {
  if (!Number.isSafeInteger(value) || value < low || value > high) throw fail(code);
  return value;
};
const quote = name => '"' + name + '"';

export function sqliteExtractionOptions(query, supplied = {}) {
  if (!record(supplied) || Object.keys(supplied).some(key =>
    !['maxRows', 'maxBytes', 'maxRowBytes', 'timeoutMs', 'order'].includes(key)))
    throw fail('DATASET_EXTRACTION_OPTIONS_INVALID');
  const result = {
    maxRows: count(supplied.maxRows ?? 250000, 1, 1000000, 'DATASET_EXTRACTION_ROW_LIMIT'),
    maxBytes: count(supplied.maxBytes ?? 67108864, 1024, 268435456, 'DATASET_EXTRACTION_BYTE_LIMIT'),
    maxRowBytes: count(supplied.maxRowBytes ?? 1048576, 1024, 8388608, 'DATASET_EXTRACTION_ROW_BYTES'),
    timeoutMs: count(supplied.timeoutMs ?? 30000, 100, 300000, 'DATASET_EXTRACTION_TIMEOUT'),
  };
  if (!Array.isArray(supplied.order) || !supplied.order.length || supplied.order.length > query.columns.length)
    throw fail('DATASET_EXTRACTION_ORDER_REQUIRED');
  const names = new Set();
  result.order = supplied.order.map(item => {
    if (!record(item) || Object.keys(item).some(key => !['column', 'direction'].includes(key)) ||
        !query.columns.includes(item.column) || names.has(item.column) || !['asc', 'desc'].includes(item.direction))
      throw fail('DATASET_EXTRACTION_ORDER_INVALID');
    names.add(item.column); return { column: item.column, direction: item.direction };
  });
  return result;
}

function valueBytes(value) {
  if (value === null) return 0;
  if (value instanceof Uint8Array) return value.byteLength;
  if (typeof value === 'string' || typeof value === 'bigint') return Buffer.byteLength(String(value));
  if (typeof value === 'number' && Number.isFinite(value)) return Buffer.byteLength(String(value));
  throw fail('DATASET_EXTRACTION_ENCODING_CHANGED');
}

/** The worker holds this transaction while each row is acknowledged by the
 * parent's actual consumer. No materialized result array or fire-and-forget IPC. */
export async function readSqliteDataset(database, query, { name, parameters, options, onRow }) {
  const limits = sqliteExtractionOptions(query, options);
  let rowCount = 0, sourceBytes = 0, authorizer = false, transaction;
  const priorLength = database.limits?.length;
  try {
    if (database.isTransaction) throw fail('DATASET_TRANSACTION_ALREADY_OPEN');
    database.exec('BEGIN');
    const settings = {
      queryOnly: database.prepare('PRAGMA query_only').get().query_only,
      readUncommitted: database.prepare('PRAGMA read_uncommitted').get().read_uncommitted,
      journalMode: database.prepare('PRAGMA journal_mode').get().journal_mode,
      schemaVersion: database.prepare('PRAGMA schema_version').get().schema_version,
      dataVersion: database.prepare('PRAGMA data_version').get().data_version,
      sqliteVersion: database.prepare('SELECT sqlite_version() AS version').get().version,
    };
    // Force the database read snapshot before yielding any source values.
    database.prepare('SELECT COUNT(*) FROM sqlite_schema').get();
    if (settings.queryOnly !== 1 || settings.readUncommitted !== 0 || !database.isTransaction)
      throw fail('DATASET_EXTRACTION_TRANSACTION_INVALID');
    transaction = { readOnly: true, isolation: 'SERIALIZABLE', scope: 'single-connection-read-transaction',
      startedAt: new Date().toISOString(), ...settings };
    if (priorLength !== undefined) database.limits.length = Math.min(priorLength, limits.maxRowBytes);
    if (typeof database.setAuthorizer === 'function') {
      database.setAuthorizer((code, _first, second, dbName) => {
        if (code === constants.SQLITE_SELECT || code === constants.SQLITE_RECURSIVE) return constants.SQLITE_OK;
        if (code === constants.SQLITE_READ && dbName === 'main') return constants.SQLITE_OK;
        if (code === constants.SQLITE_FUNCTION && second !== 'load_extension') return constants.SQLITE_OK;
        return constants.SQLITE_DENY;
      });
      authorizer = true;
    }
    const ordering = limits.order.map(item => quote(item.column) + ' ' + item.direction.toUpperCase() + ' NULLS LAST').join(', ');
    const sql = 'SELECT ' + query.columns.map(quote).join(', ') + '\nFROM (\n' + query.sql +
      '\n) AS "__sf30_source" ORDER BY ' + ordering + ' LIMIT ' + (limits.maxRows + 1);
    const statement = database.prepare(sql);
    if (statement.sourceSQL.trim() !== sql) throw fail('QUERY_MULTIPLE_STATEMENTS');
    statement.setAllowBareNamedParameters(false); statement.setReadBigInts(true);
    const columnTypes = statement.columns().map(item => ({ name: item.name,
      declaredType: item.type, sourceColumn: item.column, sourceTable: item.table, database: item.database }));
    if (columnTypes.length !== query.columns.length || columnTypes.some((item, index) => item.name !== query.columns[index]))
      throw fail('QUERY_PROJECTION_CHANGED');
    for (const row of statement.iterate(parameters)) {
      if (rowCount >= limits.maxRows) throw fail('DATASET_EXTRACTION_TOO_MANY_ROWS');
      const rowBytes = query.columns.reduce((total, column) => total + valueBytes(row[column]), 0);
      if (rowBytes > limits.maxRowBytes) throw fail('DATASET_EXTRACTION_ROW_TOO_LARGE');
      sourceBytes += rowBytes;
      if (sourceBytes > limits.maxBytes) throw fail('DATASET_EXTRACTION_TOO_MANY_BYTES');
      await onRow(row, columnTypes, { rowCount: rowCount + 1, sourceBytes });
      rowCount++;
    }
    if (authorizer) { database.setAuthorizer(null); authorizer = false; }
    database.exec('COMMIT');
    return { schema: 'stellar-forge.sqlite-dataset-extraction.v1', query: name, rowCount, sourceBytes,
      columns: [...query.columns], columnTypes, transaction: { ...transaction, completedAt: new Date().toISOString() },
      valueEncoding: 'sqlite-native', nullEncoding: 'json-null', order: limits.order };
  } finally {
    if (authorizer) database.setAuthorizer(null);
    if (database.isTransaction) database.exec('ROLLBACK');
    if (priorLength !== undefined) database.limits.length = priorLength;
  }
}
