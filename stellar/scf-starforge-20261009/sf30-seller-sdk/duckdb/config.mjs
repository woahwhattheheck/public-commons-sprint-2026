// MIT. Operator-declared local analytics; original SF30 scalar input contract.
import { open, lstat, realpath } from 'node:fs/promises';
import { dirname, resolve, isAbsolute, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { compileQueries, bindParameters, record, QueryInputError } from '../sqlite/parameters.mjs';
export { QueryInputError };
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;
export const bounded = (value, low, high, code) => {
  if (!Number.isInteger(value) || value < low || value > high) throw new TypeError(code);
  return value;
};

export async function readDuckdbSourceFile(filename) {
  const path = await realpath(resolve(filename)), handle = await open(path, 'r');
  let config;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 262144) throw new TypeError('DUCKDB_CONFIG_INVALID');
    const bytes = Buffer.alloc(262145); let total = 0;
    while (total < bytes.length) {
      const next = await handle.read(bytes, total, bytes.length - total, null);
      if (!next.bytesRead) break;
      total += next.bytesRead;
    }
    if (total > 262144) throw new TypeError('DUCKDB_CONFIG_TOO_LARGE');
    config = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, total)));
  } finally { await handle.close(); }
  if (!record(config) || config.schema !== 'stellar-forge.duckdb-source.v1')
    throw new TypeError('DUCKDB_CONFIG_INVALID');
  const baseDirectory = dirname(path), database = config.database ?? ':memory:';
  const parquetFiles = config.parquetFiles ?? [];
  if (!Array.isArray(parquetFiles) || parquetFiles.length > 32 || new Set(parquetFiles).size !== parquetFiles.length)
    throw new TypeError('DUCKDB_FILES_INVALID');
  const files = [];
  async function localFile(name, parquet = false) {
    if (typeof name !== 'string' || !name || name.includes('\0') || isAbsolute(name) ||
        name.split(/[\\/]/).includes('..') || parquet && !name.toLowerCase().endsWith('.parquet'))
      throw new TypeError('DUCKDB_FILE_NOT_LOCAL');
    const candidate = resolve(baseDirectory, name), canonical = await realpath(candidate);
    const subpath = relative(baseDirectory, canonical);
    if (canonical !== candidate || subpath === '..' || subpath.startsWith('..' + sep) || isAbsolute(subpath))
      throw new TypeError('DUCKDB_FILE_NOT_LOCAL');
    const stat = await lstat(canonical, { bigint: true });
    if (!stat.isFile() || stat.isSymbolicLink()) throw new TypeError('DUCKDB_FILE_INVALID');
    files.push({ path: canonical, size: String(stat.size), modifiedNs: String(stat.mtimeNs), inode: String(stat.ino) });
    return canonical;
  }
  const databasePath = database === ':memory:' ? database : await localFile(database);
  const approved = [];
  for (const file of parquetFiles) approved.push(await localFile(file, true));
  const queries = compileQueries(config.queries);
  if (Object.keys(queries).length > 32) throw new TypeError('DUCKDB_QUERY_LIMIT');
  for (const [name, query] of Object.entries(queries)) {
    if (!NAME.test(name) || query.columns.some(column => !NAME.test(column)) ||
        Object.keys(query.parameters).some(field => !NAME.test(field)) ||
        Object.keys(query.parameters).length > 32) throw new TypeError('DUCKDB_DECLARATION_INVALID');
  }
  const options = {
    maxWorkers: bounded(config.maxWorkers ?? 2, 1, 4, 'DUCKDB_WORKER_LIMIT'),
    maxPending: bounded(config.maxPending ?? 32, 1, 128, 'DUCKDB_PENDING_LIMIT'),
    startupTimeoutMs: bounded(config.startupTimeoutMs ?? 20000, 1000, 60000, 'DUCKDB_STARTUP_LIMIT'),
    memoryLimitMb: bounded(config.memoryLimitMb ?? 256, 32, 1024, 'DUCKDB_MEMORY_LIMIT'),
    threads: bounded(config.threads ?? 2, 1, 4, 'DUCKDB_THREAD_LIMIT'),
  };
  const snapshot = { schema: config.schema, baseDirectory, database: databasePath,
    parquetFiles: approved, files, queries, options };
  const sourceSha256 = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  return { path, config, queries, options, snapshot, sourceSha256 };
}

export function bindDuckdbParameters(query, input) {
  const named = bindParameters(query, input), values = Object.create(null);
  for (const [name, spec] of Object.entries(query.parameters)) {
    const value = named['$' + name];
    values[name] = value === null ? null : spec.type === 'boolean' ? value === 1n :
      typeof value === 'bigint' ? String(value) : value;
  }
  if (Buffer.byteLength(JSON.stringify({ values })) > 262144) throw new QueryInputError(null, 'INPUT_TOO_LARGE');
  return values;
}

export function describeDuckdbSource(declaration) {
  return { schema: 'stellar-forge.duckdb-description.v1', sourceSha256: declaration.sourceSha256,
    mode: declaration.config.database && declaration.config.database !== ':memory:' ? 'read-only-database' : 'approved-parquet',
    approvedFileCount: declaration.snapshot.files.length, ...declaration.options,
    queries: Object.fromEntries(Object.entries(declaration.queries).map(([name, query]) => [name,
      { parameters: structuredClone(query.parameters), columns: [...query.columns],
        maxRows: query.maxRows, maxBytes: query.maxBytes, timeoutMs: query.timeoutMs }])) };
}
