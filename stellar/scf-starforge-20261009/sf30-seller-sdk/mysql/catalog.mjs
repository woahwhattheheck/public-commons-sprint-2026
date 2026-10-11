// MIT. Private operator metadata from the actual configured MySQL database.
import { readMysqlSourceFile, resolveMysqlConnection } from './config.mjs';
import { createMysqlPool, mysqlCall, mysqlDeadline } from './lifecycle.mjs';

export async function inspectMysqlCatalog(sourceFile, { environment = process.env, table } = {}) {
  if (table !== undefined && (typeof table !== 'string' || !table || table.length > 64 || table.includes('\0')))
    throw new TypeError('MYSQL_CATALOG_TABLE_INVALID');
  const declaration = await readMysqlSourceFile(sourceFile);
  const connection = await resolveMysqlConnection(declaration, environment);
  let mysql;
  try { ({ default: mysql } = await import('mysql2')); } catch { throw new Error('MYSQL_DRIVER_UNAVAILABLE'); }
  const pool = createMysqlPool(mysql, { ...connection,
    connectTimeout: declaration.config.connectTimeoutMs ?? 5000, multipleStatements: false,
    supportBigNumbers: true, bigNumberStrings: true, decimalNumbers: false, dateStrings: true,
    jsonStrings: true, charset: 'utf8mb4', flags: ['-LOCAL_FILES'] }, { maxConnections: 1, idleTimeoutMs: 1000 });
  const deadline = mysqlDeadline(declaration.config.startupTimeoutMs ?? 10000,
    new Error('MYSQL_CATALOG_TIMEOUT'), pool.close);
  try {
    const client = await deadline.wait(pool.acquire());
    const query = (method, sql, values) => deadline.wait(mysqlCall(client, method, sql, values));
    await query('query', 'SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await query('query', 'START TRANSACTION READ ONLY');
    const { rows: [server] } = await query('query', 'SELECT VERSION() AS version');
    let rows;
    if (table === undefined) {
      ({ rows } = await query('execute', 'SELECT TABLE_NAME AS name, TABLE_TYPE AS type, ENGINE AS engine, ' +
        'TABLE_COLLATION AS collation FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME LIMIT 1001'));
    } else {
      ({ rows } = await query('execute', 'SELECT COLUMN_NAME AS name, ORDINAL_POSITION AS position, DATA_TYPE AS dataType, ' +
        'COLUMN_TYPE AS columnType, IS_NULLABLE AS nullable, COLUMN_KEY AS keyKind, CHARACTER_SET_NAME AS charset, ' +
        'COLLATION_NAME AS collation, NUMERIC_PRECISION AS numericPrecision, NUMERIC_SCALE AS numericScale ' +
        'FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION LIMIT 1001', [table]));
    }
    await query('query', 'ROLLBACK');
    return { schema: 'stellar-forge.mysql-catalog.v1', serverVersion: server.version,
      ...(table === undefined ? {} : { table }), [table === undefined ? 'tables' : 'columns']: rows.slice(0, 1000),
      truncated: rows.length > 1000 };
  } catch (issue) {
    throw new Error(deadline.expired ? 'MYSQL_CATALOG_TIMEOUT' : 'MYSQL_CATALOG_UNAVAILABLE', { cause: issue });
  } finally { deadline.close(); pool.close(); }
}
