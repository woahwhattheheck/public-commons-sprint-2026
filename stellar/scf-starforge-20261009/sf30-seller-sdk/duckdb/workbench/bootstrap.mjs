// MIT. Selected local data files -> an original private source declaration.
import { open, realpath, lstat, link, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { readDuckdbSourceFile } from '../config.mjs';

const fault = code => Object.assign(new Error(code), { code });
const identity = stat => `${stat.dev}:${stat.ino}`;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function directory(path, { privateDirectory = false } = {}) {
  if (typeof path !== 'string' || !path || path.includes('\0')) throw fault('WORKBENCH_DIRECTORY_REQUIRED');
  const requested = resolve(path), canonical = await realpath(requested), stat = await lstat(canonical, { bigint: true });
  if (canonical !== requested || !stat.isDirectory() || stat.isSymbolicLink())
    throw fault('WORKBENCH_DIRECTORY_INVALID');
  if (privateDirectory && process.platform !== 'win32' && (stat.mode & 0o777n) !== 0o700n)
    throw fault('WORKBENCH_DIRECTORY_MUST_BE_PRIVATE');
  return { path: canonical, identity: identity(stat) };
}

async function unchangedDirectory(selected) {
  const current = await directory(selected.path);
  if (current.identity !== selected.identity) throw fault('WORKBENCH_DIRECTORY_CHANGED');
}

async function readGeneratedSource(filename, config) {
  const before = await lstat(filename, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() ||
      process.platform !== 'win32' && (before.mode & 0o777n) !== 0o600n)
    throw fault('WORKBENCH_SOURCE_MUST_BE_PRIVATE');
  const declaration = await readDuckdbSourceFile(filename);
  const after = await lstat(filename, { bigint: true });
  if (declaration.path !== filename || !after.isFile() || after.isSymbolicLink() ||
      identity(before) !== identity(after) || before.size !== after.size || before.mtimeNs !== after.mtimeNs)
    throw fault('WORKBENCH_SOURCE_CHANGED');
  if (!isDeepStrictEqual(declaration.config, config)) throw fault('WORKBENCH_SOURCE_SELECTION_CHANGED');
  return declaration;
}

async function syncDirectory(filename) {
  if (process.platform === 'win32') return;
  const handle = await open(filename, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

/**
 * Existing source mode returns its original validated canonical path.
 * Raw mode needs write access to dataDirectory for one private metadata file;
 * it never edits the selected database or Parquet files. workspace already
 * exists as a private 0700 directory. Subsequent opens may use sourceFile alone.
 */
export async function prepareWorkbenchSource({ sourceFile, dataDirectory, database = ':memory:',
  parquetFiles = [], workspace } = {}) {
  if (sourceFile !== undefined && sourceFile !== null) {
    if (typeof sourceFile !== 'string' || !sourceFile || dataDirectory !== undefined && dataDirectory !== null ||
        database !== ':memory:' || !Array.isArray(parquetFiles) || parquetFiles.length)
      throw fault('WORKBENCH_CHOOSE_SOURCE_OR_DATA_FILES');
    const declaration = await readDuckdbSourceFile(sourceFile);
    return { sourceFile: declaration.path };
  }
  if (typeof database !== 'string' || !database || !Array.isArray(parquetFiles) ||
      parquetFiles.some(file => typeof file !== 'string' || !file) || parquetFiles.length > 32)
    throw fault('DUCKDB_FILES_INVALID');
  if (database === ':memory:' && !parquetFiles.length) throw fault('DUCKDB_SOURCE_FILES_REQUIRED');
  const [data, owner] = await Promise.all([directory(dataDirectory), directory(workspace, { privateDirectory: true })]);
  const workspaceId = digest({ path: owner.path, identity: owner.identity }).slice(0, 32);
  const filename = join(data.path, `.sf30-workbench-${workspaceId}.json`);
  const config = { schema: 'stellar-forge.duckdb-source.v1', database, parquetFiles: [...parquetFiles],
    queries: { workbenchSeed: { sql: 'SELECT CAST(1 AS BIGINT) AS workbench_seed', parameters: {},
      columns: ['workbench_seed'], maxRows: 1, maxBytes: 1024, timeoutMs: 1500 } } };
  const bytes = JSON.stringify(config, null, 2) + '\n';
  if (Buffer.byteLength(bytes) > 262144) throw fault('DUCKDB_CONFIG_TOO_LARGE');

  // Publish a validated, fully written declaration in one create-only link.
  // Its original reader resolves relative data names from this same directory.
  // An existing declaration is reused only when the exact choices still match.
  const temporary = join(data.path, `.sf30-workbench-${workspaceId}-${randomUUID()}.tmp.json`);
  let created = false;
  try {
    const output = await open(temporary, 'wx', 0o600); created = true;
    try { await output.writeFile(bytes); await output.sync(); } finally { await output.close(); }
    const staged = await readDuckdbSourceFile(temporary);
    await Promise.all([unchangedDirectory(data), unchangedDirectory(owner)]);
    try { await link(temporary, filename); }
    catch (issue) { if (issue.code !== 'EEXIST') throw issue; }
    const retained = await readGeneratedSource(filename, config);
    if (retained.sourceSha256 !== staged.sourceSha256) throw fault('DATASET_CHANGED');
    await Promise.all([unchangedDirectory(data), unchangedDirectory(owner)]);
    await syncDirectory(data.path);
    return { sourceFile: retained.path };
  } finally {
    if (created) await rm(temporary, { force: true });
  }
}
