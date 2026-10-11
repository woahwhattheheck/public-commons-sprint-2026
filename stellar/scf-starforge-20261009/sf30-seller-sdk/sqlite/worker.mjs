// MIT. One disposable read-only native SQLite process. Parent enforces wall time.
import { DatabaseSync } from 'node:sqlite';
import { readSqliteDataset } from './publisher/extraction.mjs';
let database;
let exporting = null;
const statements = new Map();
function send(value) { if (process.connected) process.send(value); }
function fail(code, query) { return { code, ...(query ? { query } : {}) }; }
function encode(value) {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Uint8Array) return { $base64: Buffer.from(value).toString('base64') };
  if (typeof value === 'number' && !Number.isFinite(value)) throw fail('QUERY_NONFINITE_RESULT');
  return value;
}
process.on('disconnect', () => { try { database?.close(); } finally { process.exit(0); } });
process.on('message', message => {
  if (message?.type === 'dataset-row-ack') {
    if (exporting?.id === message.id && exporting.pending?.sequence === message.sequence) {
      const pending = exporting.pending; exporting.pending = null; pending.resolve();
    }
    return;
  }
  if (message?.type === 'init') {
    try {
      if (database) throw fail('SOURCE_ALREADY_INITIALIZED');
      database = new DatabaseSync(message.database, { readOnly: true, allowExtension: false, enableDoubleQuotedStringLiterals: false });
      database.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=100;');
      for (const [name, query] of Object.entries(message.queries)) {
        try {
          // SQLite parses the SELECT wrapper. Parameters never affect its syntax.
          // Explicit projection prevents a future SELECT * source column from being sold.
          const sql = `SELECT ${query.columns.map(column => `"${column}"`).join(',')} FROM (${query.sql}) AS "__sf30_source" LIMIT $__sf30_rows`;
          const statement = database.prepare(sql);
          if (statement.sourceSQL.trim() !== sql) throw fail('QUERY_MULTIPLE_STATEMENTS');
          statement.setAllowBareNamedParameters(false); statement.setReadBigInts(true);
          statements.set(name, { statement, query });
        } catch { throw fail('QUERY_PREPARE_FAILED', name); }
      }
      send({ type: 'ready' });
    } catch (error) { send({ type: 'startup-error', ...fail(error.code ?? 'SOURCE_OPEN_FAILED', error.query) }); }
    return;
  }
  if (message?.type === 'dataset-export') {
    const { id, name, parameters, options } = message;
    if (exporting) { send({ type: 'query-error', id, code: 'SOURCE_BUSY' }); return; }
    const state = { id, pending: null }; exporting = state;
    (async () => {
      try {
        const entry = statements.get(name);
        if (!entry) throw fail('QUERY_NOT_FOUND');
        const result = await readSqliteDataset(database, entry.query, { name, parameters, options,
          onRow(row, columnTypes, progress) {
            return new Promise((resolve, reject) => {
              state.pending = { sequence: progress.rowCount, resolve, reject };
              if (!process.connected) { reject(fail('SOURCE_PROCESS_FAILED')); return; }
              process.send({ type: 'dataset-row', id, sequence: progress.rowCount, row, columnTypes, progress },
                error => { if (error) reject(fail('SOURCE_PROCESS_FAILED')); });
            });
          } });
        send({ type: 'result', id, result });
      } catch (error) {
        const code = typeof error.code === 'string' && /^(?:DATASET_|QUERY_|SOURCE_)[A-Z_]+$/.test(error.code)
          ? error.code : 'DATASET_EXTRACTION_FAILED';
        send({ type: 'query-error', id, code });
      } finally { exporting = null; }
    })();
    return;
  }
  if (message?.type !== 'query') return;
  const { id, name, parameters } = message;
  try {
    const entry = statements.get(name);
    if (!entry) throw fail('QUERY_NOT_FOUND');
    const { statement, query } = entry;
    const rows = []; let bytes = 256, truncated = false;
    for (const source of statement.iterate({ ...parameters, $__sf30_rows: query.maxRows + 1 })) {
      if (rows.length === query.maxRows) { truncated = true; break; }
      const row = Object.create(null);
      for (const column of query.columns) row[column] = encode(source[column]);
      bytes += Buffer.byteLength(JSON.stringify(row)) + 1;
      if (bytes > query.maxBytes) throw fail('QUERY_RESULT_TOO_LARGE');
      rows.push(row);
    }
    const result = { schema: 'stellar-forge.sqlite-result.v1', query: name,
      columns: query.columns, rows, rowCount: rows.length, truncated,
      integerEncoding: 'decimal-string', blobEncoding: 'tagged-base64' };
    if (Buffer.byteLength(JSON.stringify(result)) > query.maxBytes) throw fail('QUERY_RESULT_TOO_LARGE');
    send({ type: 'result', id, result });
  } catch (error) {
    const codes = new Set(['QUERY_NOT_FOUND', 'QUERY_RESULT_TOO_LARGE', 'QUERY_NONFINITE_RESULT']);
    send({ type: 'query-error', id, code: codes.has(error.code) ? error.code : 'QUERY_EXECUTION_FAILED' });
  }
});
