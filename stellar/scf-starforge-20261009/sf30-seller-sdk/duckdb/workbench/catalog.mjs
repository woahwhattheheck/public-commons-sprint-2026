// MIT. Actual database/Parquet metadata using the original reader's connection policy.
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readDuckdbSourceFile } from '../config.mjs';

const SCHEMA = 'stellar-forge.duckdb-catalog.v1';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fault = code => Object.assign(new Error(code), { code });
const codes = new Set(['CONFIG_INVALID', 'DUCKDB_NOT_INSTALLED', 'DATASET_CHANGED',
  'CATALOG_CURSOR_INVALID', 'CATALOG_METADATA_UNAVAILABLE']);
const approvedProfiles = new WeakSet();

function decodeCursor(cursor, sourceSha256) {
  if (cursor === undefined || cursor === null || cursor === '') return 0;
  if (typeof cursor !== 'string' || cursor.length > 256 || !/^[A-Za-z0-9_-]+$/.test(cursor))
    throw fault('CATALOG_CURSOR_INVALID');
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (value.sourceSha256 !== sourceSha256) throw fault('CATALOG_SOURCE_CHANGED');
    if (!Number.isSafeInteger(value.offset) || value.offset < 0 || value.offset > 1000000)
      throw fault('CATALOG_CURSOR_INVALID');
    return value.offset;
  } catch (issue) { throw issue?.code ? issue : fault('CATALOG_CURSOR_INVALID'); }
}

function runCatalog({ python, environment, snapshotPath, cwd, timeoutMs, offset, signal }) {
  if (typeof python !== 'string' || !python || python.startsWith('-') || /[\x00-\x1f]/.test(python))
    throw fault('DUCKDB_PYTHON_EXECUTABLE_INVALID');
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError('signal must be AbortSignal');
  if (signal?.aborted) return Promise.reject(fault('CATALOG_ABORTED'));
  const env = Object.create(null);
  for (const name of ['PATH', 'LANG', 'LC_ALL', 'SYSTEMROOT'])
    if (typeof environment[name] === 'string') env[name] = environment[name];
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-I', '-u', fileURLToPath(new URL('./catalog.py', import.meta.url)),
      '--source', snapshotPath, '--offset', String(offset)],
    { env, cwd, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    const chunks = []; let length = 0, failure, settled = false;
    const finish = (issue, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (issue) reject(issue); else resolve(value);
    };
    const stop = code => { failure ??= fault(code); child.kill('SIGKILL'); };
    const abort = () => stop('CATALOG_ABORTED');
    const timer = setTimeout(() => stop('CATALOG_TIMEOUT'), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.once('error', () => { failure ??= fault('DUCKDB_WORKER_UNAVAILABLE'); });
    child.stdout.on('error', () => stop('CATALOG_METADATA_UNAVAILABLE'));
    child.stdout.on('data', chunk => {
      if (failure) return;
      length += chunk.length;
      if (length > 2 * 1024 * 1024 + 1) stop('CATALOG_METADATA_TOO_LARGE');
      else chunks.push(chunk);
    });
    child.once('close', code => {
      if (failure) return finish(failure);
      let value;
      try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
      catch { return finish(fault('CATALOG_PROTOCOL_INVALID')); }
      if (value?.ok !== true || code !== 0)
        return finish(fault(codes.has(value?.error) ? value.error : 'CATALOG_METADATA_UNAVAILABLE'));
      if (value.schema !== 'stellar-forge.duckdb-catalog-native.v1' ||
          !Array.isArray(value.relations) || value.relations.length > 32 ||
          !Number.isSafeInteger(value.totalRelations) || value.totalRelations < 0 || value.offset !== offset ||
          value.nextOffset !== null && (!Number.isSafeInteger(value.nextOffset) || value.nextOffset <= offset))
        return finish(fault('CATALOG_PROTOCOL_INVALID'));
      finish(null, value);
    });
  });
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Only profiles produced by actual original-source inspection may author SQL. */
export function requireDuckdbCatalogProfile(profile) {
  if (!approvedProfiles.has(profile)) throw fault('DUCKDB_CATALOG_PROFILE_REQUIRED');
  return profile;
}

/**
 * Returns {catalog, profile}. Only catalog is a browser response. The private
 * profile retains the original declaration, data locations and native locators.
 * Optional cursor pages the same unchanged source; no data rows are selected.
 */
export async function inspectDuckdbCatalog({ sourceFile, python = 'python3', environment = process.env,
  signal, cursor } = {}) {
  const declaration = await readDuckdbSourceFile(sourceFile);
  const offset = decodeCursor(cursor, declaration.sourceSha256);
  const directory = await mkdtemp(join(tmpdir(), 'sf30-duckdb-catalog-'));
  let raw;
  try {
    const snapshotPath = join(directory, 'source.json');
    await writeFile(snapshotPath, JSON.stringify(declaration.snapshot), { flag: 'wx', mode: 0o600 });
    raw = await runCatalog({ python, environment, snapshotPath, cwd: declaration.snapshot.baseDirectory,
      timeoutMs: declaration.options.startupTimeoutMs, offset, signal });
    if ((await readDuckdbSourceFile(declaration.path)).sourceSha256 !== declaration.sourceSha256)
      throw fault('CATALOG_SOURCE_CHANGED');
  } finally { await rm(directory, { recursive: true, force: true }); }
  const locators = Object.create(null);
  const relations = raw.relations.map(item => {
    if (!['table', 'view', 'parquet'].includes(item?.kind) || typeof item.name !== 'string' ||
        !Array.isArray(item.columns) || item.columns.length > 256 ||
        item.columns.some(column => typeof column?.name !== 'string' || typeof column.type !== 'string' ||
          typeof column.nullable !== 'boolean')) throw fault('CATALOG_PROTOCOL_INVALID');
    if (item.kind !== 'parquet' && (typeof item.catalog !== 'string' || typeof item.namespace !== 'string'))
      throw fault('CATALOG_PROTOCOL_INVALID');
    let originalFile;
    if (item.kind === 'parquet') {
      if (typeof item.file !== 'string') throw fault('CATALOG_PROTOCOL_INVALID');
      const index = declaration.snapshot.parquetFiles.indexOf(resolve(declaration.snapshot.baseDirectory, item.file));
      if (index < 0) throw fault('CATALOG_PROTOCOL_INVALID');
      originalFile = declaration.config.parquetFiles[index];
    }
    const locator = { kind: item.kind, catalog: item.catalog, namespace: item.namespace, name: item.name,
      ...(item.kind === 'parquet' ? { file: originalFile } : {}) };
    const id = digest(locator), fingerprint = digest({ locator, columns: item.columns });
    locators[id] = locator;
    return { schema: 'stellar-forge.duckdb-relation.v1', id, fingerprint, kind: item.kind,
      namespace: item.namespace ?? null, name: item.name, columns: item.columns,
      columnsTruncated: item.columnsTruncated === true,
      ...(item.unavailable ? { unavailable: item.unavailable } : {}) };
  });
  const files = [...new Map(declaration.snapshot.files.map(file => [file.path, file])).values()];
  const catalog = freeze({ schema: SCHEMA, sourceSha256: declaration.sourceSha256,
    engineVersion: raw.engineVersion,
    source: { mode: declaration.snapshot.database === ':memory:' ? 'approved-parquet' : 'read-only-database',
      approvedFileCount: files.length, totalBytes: String(files.reduce((sum, file) => sum + BigInt(file.size), 0n)) },
    relations, totalRelations: raw.totalRelations, offset,
    nextCursor: raw.nextOffset === null ? null : Buffer.from(JSON.stringify({ sourceSha256: declaration.sourceSha256,
      offset: raw.nextOffset })).toString('base64url'), columnLimit: raw.columnLimit });
  const profile = freeze({ sourceFile: declaration.path, sourceDirectory: declaration.snapshot.baseDirectory,
    sourceSha256: declaration.sourceSha256, sourceConfig: structuredClone(declaration.config),
    snapshot: structuredClone(declaration.snapshot), python, catalog, locators });
  approvedProfiles.add(profile);
  return { catalog, profile };
}

/** Compare the original current declaration and every pinned source-file identity. */
export async function assertDuckdbCatalogCurrent(profile) {
  requireDuckdbCatalogProfile(profile);
  const current = await readDuckdbSourceFile(profile.sourceFile);
  if (current.sourceSha256 !== profile.sourceSha256) throw fault('CATALOG_SOURCE_CHANGED');
  return current;
}
