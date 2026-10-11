// MIT. Complete native extraction through the original MySQL source lifetime.
import { datasetExtractionOptions } from '../../postgres/publisher/stream.mjs';
import { quoteIdentifier } from '../declaration.mjs';
import { mysqlCall } from '../lifecycle.mjs';

export class MysqlDatasetError extends Error {
  constructor(code) { super(code); this.name = 'MysqlDatasetError'; this.code = code; }
}
const fail = code => new MysqlDatasetError(code);

/** Keep the original publisher's row, byte, deadline and ordering contract. */
export function mysqlDatasetExtractionOptions(query, supplied = {}) {
  try { return datasetExtractionOptions(query, supplied); }
  catch (issue) {
    throw fail(/^DATASET_[A-Z0-9_]+$/.test(issue?.code ?? '') ? issue.code : 'DATASET_EXTRACTION_OPTIONS_INVALID');
  }
}

function statement(query, limits) {
  const names = query.columns.map(quoteIdentifier);
  let flag = '__sf30_export_oversized';
  while (query.columns.includes(flag)) flag += '_';
  const order = limits.order.map(item => {
    const name = quoteIdentifier(item.column);
    return name + ' IS NULL ASC, ' + name + ' ' + item.direction.toUpperCase();
  }).join(', ');
  const size = names.map(name => 'COALESCE(OCTET_LENGTH(' + name + '),0)').join(' + ');
  const source = 'SELECT ' + names.join(', ') + '\nFROM (\n' + query.sql +
    '\n) AS sf30_mysql_approved\nORDER BY ' + order + '\nLIMIT ' + (limits.maxRows + 1);
  // LIMIT prevents merging this derived table. Oversized values are suppressed
  // inside MySQL, and the outer ordering preserves the reviewed null-last order.
  return 'SELECT ' + names.map(name => 'IF((' + size + ') > ' + limits.maxRowBytes + ',NULL,' + name + ') AS ' + name).join(', ') +
    ', ((' + size + ') > ' + limits.maxRowBytes + ') AS ' + quoteIdentifier(flag) +
    '\nFROM (\n' + source + '\n) AS sf30_mysql_extract\nORDER BY ' + order;
}

/** The source opens WITH CONSISTENT SNAPSHOT, READ ONLY before this operation,
 * and commits only after every awaited row consumer and this stream complete. */
export async function readMysqlDataset(connection, query, { name, values, options,
  onRow, ensureActive, serverVersion, metadata, encodeScalar }) {
  const maria = serverVersion.toLowerCase().includes('mariadb');
  const info = await mysqlCall(connection, 'query', 'SELECT CONNECTION_ID(), UTC_TIMESTAMP(6), @@session.' +
    (maria ? 'tx_isolation' : 'transaction_isolation'));
  ensureActive();
  const [connectionId, startedAt, isolation] = info.rows[0] ?? [];
  if (String(isolation).replaceAll('-', ' ').toUpperCase() !== 'REPEATABLE READ')
    throw fail('DATASET_EXTRACTION_TRANSACTION_INVALID');

  const command = connection.execute({ sql: statement(query, options), rowsAsArray: true }, values);
  // The native stream removes its listeners when a consumer throws. Keep a
  // command error receiver through the source's subsequent socket retirement.
  command.on('error', () => {});
  const rows = command.stream({ highWaterMark: 1 });
  let columnTypes, rowCount = 0, sourceBytes = 0;
  const fields = actual => {
    try {
      ensureActive();
      if (actual.length !== query.columns.length + 1 ||
          actual.slice(0, -1).some((field, index) => field.name !== query.columns[index]))
        throw fail('QUERY_PROJECTION_CHANGED');
      columnTypes = metadata(actual.slice(0, -1));
    } catch (issue) { rows.destroy(issue); }
  };
  rows.once('fields', fields);
  try {
    for await (const row of rows) {
      ensureActive();
      if (rowCount >= options.maxRows) throw fail('DATASET_EXTRACTION_TOO_MANY_ROWS');
      if (!columnTypes || !Array.isArray(row) || row.length !== query.columns.length + 1 || Number(row.at(-1)) !== 0)
        throw fail('DATASET_EXTRACTION_ROW_TOO_LARGE');
      const selected = row.slice(0, -1);
      sourceBytes += selected.reduce((total, value) => total + (value === null ? 0 :
        Buffer.isBuffer(value) ? value.length : Buffer.byteLength(String(value))), 0);
      if (sourceBytes > options.maxBytes) throw fail('DATASET_EXTRACTION_TOO_MANY_BYTES');
      const result = Object.fromEntries(query.columns.map((column, index) => [column, encodeScalar(selected[index])]));
      await onRow(result, columnTypes, { rowCount: rowCount + 1, sourceBytes });
      ensureActive(); rowCount++;
    }
    ensureActive();
    if (!columnTypes) throw fail('QUERY_PROJECTION_CHANGED');
  } finally { rows.removeListener('fields', fields); rows.destroy(); }
  return { schema: 'stellar-forge.mysql-dataset-extraction.v1', query: name,
    rowCount, sourceBytes, columns: [...query.columns], columnTypes,
    transaction: { connectionId: String(connectionId), startedAt: String(startedAt),
      serverVersion, isolation: 'REPEATABLE READ', readOnly: true,
      consistentSnapshotRequested: true, scope: 'single-native-extraction' },
    valueEncoding: 'mysql-exact-scalars', binaryEncoding: 'base64-object', nullEncoding: 'json-null',
    order: options.order, nullOrder: 'last' };
}
