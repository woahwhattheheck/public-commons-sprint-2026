// MIT. Fixed PostgreSQL metadata queries for the original seller's merchant workspace.
import { createHash } from 'node:crypto';

export class CatalogError extends Error {
  constructor(code) { super(code); this.name = 'CatalogError'; this.code = code; }
}
const fail = code => { throw new CatalogError(code); };
const relationId = value => typeof value === 'string' && /^[1-9][0-9]{0,9}$/.test(value) && BigInt(value) <= 4294967295n;
const LIST = `SELECT c.oid::text AS id, n.nspname AS schema, c.relname AS name,
 c.relkind AS kind, c.reltuples::text AS "estimatedRows"
 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relkind IN ('r','p','v','m')
 AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'
 AND pg_catalog.has_schema_privilege(n.oid,'USAGE') AND pg_catalog.has_table_privilege(c.oid,'SELECT')
 AND ($1::text='' OR n.nspname=$1)
 ORDER BY n.nspname,c.relname,c.oid LIMIT 501`;
const COLUMNS = `SELECT c.oid::text AS id, n.nspname AS schema, c.relname AS name, c.relkind AS kind,
 a.attnum::integer AS position, a.attname AS column, a.attnotnull AS "notNull",
 t.typname AS "typeName", tn.nspname AS "typeSchema", pg_catalog.format_type(a.atttypid,a.atttypmod) AS "sqlType",
 EXISTS (SELECT 1 FROM pg_catalog.pg_index i WHERE i.indrelid=c.oid AND i.indisprimary AND a.attnum=ANY(i.indkey)) AS "primaryKey"
 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
 JOIN pg_catalog.pg_type t ON t.oid=a.atttypid JOIN pg_catalog.pg_namespace tn ON tn.oid=t.typnamespace
 WHERE c.oid=$1::oid AND c.relkind IN ('r','p','v','m') AND a.attnum>0 AND NOT a.attisdropped
 AND pg_catalog.has_schema_privilege(n.oid,'USAGE') AND pg_catalog.has_table_privilege(c.oid,'SELECT')
 ORDER BY a.attnum LIMIT 257`;

/** One short, read-only metadata connection per operation; no merchant row query. */
export async function createMerchantCatalog({ connection, Client, timeoutMs = 4000 } = {}) {
  if (!connection || typeof connection !== 'object' || typeof connection.host !== 'string' ||
      !Object.hasOwn(connection, 'ssl') || Object.hasOwn(connection, 'connectionString'))
    fail('DATABASE_CONNECTION_NOT_CONFIGURED');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 15000) fail('INVALID_CATALOG_TIMEOUT');
  if (!Client) {
    try { ({ Client } = await import('pg')); } catch { fail('PG_PACKAGE_NOT_INSTALLED'); }
  }
  let closed = false;
  const active = new Set();
  async function query(sql, values) {
    if (closed) fail('CATALOG_CLOSED');
    if (active.size >= 2) fail('CATALOG_BUSY');
    const client = new Client({ ...connection, application_name: 'sf30-postgres-merchant-workspace',
      connectionTimeoutMillis: timeoutMs, statement_timeout: timeoutMs,
      idle_in_transaction_session_timeout: timeoutMs });
    active.add(client);
    let interrupted = false;
    const timer = setTimeout(() => { interrupted = true; client.end().catch(() => {}); }, timeoutMs);
    // Errors stay in the operator process; never serialize DSNs, SQL or server detail.
    client.on('error', () => {});
    try {
      await client.connect();
      await client.query('BEGIN READ ONLY');
      await client.query("SET LOCAL search_path = pg_catalog");
      const result = await client.query({ text: sql, values, queryMode: 'extended' });
      await client.query('ROLLBACK');
      if (interrupted || closed) fail(interrupted ? 'CATALOG_TIMEOUT' : 'CATALOG_CLOSED');
      return result.rows;
    } catch (error) {
      if (error instanceof CatalogError) throw error;
      fail(interrupted || error?.code === '57014' ? 'CATALOG_TIMEOUT' : 'CATALOG_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
      await client.end().catch(() => {});
      active.delete(client);
    }
  }
  return Object.freeze({
    async list(schema = '') {
      if (typeof schema !== 'string' || Buffer.byteLength(schema) > 63 || schema.includes('\0')) fail('INVALID_SCHEMA');
      const rows = await query(LIST, [schema]);
      return { schema: 'stellar-forge.postgres-catalog.v1', relations: rows.slice(0, 500), truncated: rows.length > 500 };
    },
    async inspect(id) {
      if (!relationId(id)) fail('INVALID_RELATION_ID');
      const rows = await query(COLUMNS, [id]);
      if (!rows.length) fail('RELATION_NOT_AVAILABLE');
      if (rows.length > 256) fail('RELATION_HAS_TOO_MANY_COLUMNS');
      const first = rows[0];
      const snapshot = {
        schema: 'stellar-forge.postgres-relation.v1', id: first.id,
        namespace: first.schema, name: first.name, kind: first.kind,
        columns: rows.map(row => ({ name: row.column, position: row.position,
          typeName: row.typeName, typeSchema: row.typeSchema, sqlType: row.sqlType,
          nullable: !row.notNull, primaryKey: row.primaryKey })),
      };
      return { ...snapshot, fingerprint: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex') };
    },
    async close() { closed = true; await Promise.allSettled([...active].map(client => client.end())); },
  });
}
