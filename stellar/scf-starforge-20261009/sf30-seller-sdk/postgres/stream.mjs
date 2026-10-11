// MIT. Bounded PostgreSQL result delivery, preserving original type metadata.
import { projectedStatement } from './declaration.mjs';

export class PostgresResultError extends Error {
  constructor(code) { super(code); this.name = 'PostgresResultError'; this.code = code; }
}
const fail = code => new PostgresResultError(code);

export function boundedProjectedStatement(query) {
  let flag = '__sf30_result_oversized';
  for (let suffix = 0; query.columns.includes(flag); suffix++) flag = '__sf30_result_oversized_' + suffix;
  const names = query.columns.map(name => '"' + name + '"');
  // Materialize the selected page and its byte calculation once. A very large
  // value is replaced inside PostgreSQL before it can cross the wire. Preserve
  // each public column's SQL type; the extra boolean is private to this reader.
  const bytes = names.map(name => 'COALESCE(octet_length(' + name + '::text)::bigint, 0)').join(' + ');
  return 'WITH sf30_page AS MATERIALIZED (\n' + projectedStatement(query) +
    '\n), sf30_budget AS MATERIALIZED (\nSELECT sf30_page.*, (' + bytes + ') > ' +
    query.maxBytes + ' AS "' + flag + '" FROM sf30_page\n)\nSELECT ' +
    names.map(name => 'CASE WHEN "' + flag + '" THEN NULL ELSE ' + name + ' END AS ' + name).join(', ') +
    ', "' + flag + '" FROM sf30_budget';
}

/** The caller owns the transaction and retires the client on every error. */
export async function readPostgresResult(client, query, { name, values, Cursor, ensureActive }) {
  const types = Object.freeze({ getTypeParser: () => value => value });
  const cursor = client.query(new Cursor(boundedProjectedStatement(query), values, { rowMode: 'array', types }));
  const output = { schema: 'stellar-forge.postgres-result.v1', query: name,
    columns: [...query.columns], columnTypes: [], rows: [], rowCount: 0, truncated: false,
    valueEncoding: 'postgres-text', nullEncoding: 'json-null', snapshot: 'single-request-repeatable-read' };
  let bytes;
  outer: while (true) {
    // pg-cursor 2.22.1 supplies pg.Result as the callback's third argument.
    // This retains exact field OIDs without a second metadata query or private
    // driver fields, including for an empty result.
    const batch = await new Promise((resolve, reject) => cursor.read(8, (issue, rows, result) =>
      issue ? reject(issue) : resolve({ rows, fields: result?.fields })));
    ensureActive();
    if (bytes === undefined) {
      if (batch.fields?.length !== query.columns.length + 1 ||
          batch.fields.slice(0, -1).some((field, index) => field.name !== query.columns[index]) ||
          batch.fields.at(-1).dataTypeID !== 16) throw fail('QUERY_PROJECTION_CHANGED');
      output.columnTypes = batch.fields.slice(0, -1).map(field => ({ name: field.name, oid: field.dataTypeID }));
      bytes = Buffer.byteLength(JSON.stringify(output));
    }
    if (!batch.rows.length) break;
    for (const row of batch.rows) {
      if (output.rows.length === query.maxRows) { output.truncated = true; break outer; }
      if (row.length !== query.columns.length + 1 || row.at(-1) !== 'f') throw fail('QUERY_RESULT_TOO_LARGE');
      const value = Object.fromEntries(query.columns.map((column, index) => [column, row[index]]));
      const added = Buffer.byteLength(JSON.stringify(value)) + (output.rows.length ? 1 : 0);
      // Reserve rowCount growth; final serialization below checks the exact
      // envelope size. A failed result is never returned as a partial page.
      if (bytes + added + 32 > query.maxBytes) throw fail('QUERY_RESULT_TOO_LARGE');
      bytes += added; output.rows.push(value);
    }
  }
  await cursor.close(); ensureActive();
  output.rowCount = output.rows.length;
  if (Buffer.byteLength(JSON.stringify(output)) > query.maxBytes) throw fail('QUERY_RESULT_TOO_LARGE');
  return output;
}
