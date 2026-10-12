// MIT. Managed launch of the original Snowflake workspace and its retained identity.
import { DatabaseSync } from 'node:sqlite';
import { lstat, realpath } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boundedFile, canonical, sha256 } from '../../sf46-release/release-core.mjs';
import { fault } from './declaration.mjs';

export const SNOWFLAKE_SOURCE = 'stellar/scf-starforge-20261009/sf30-seller-sdk/snowflake';
export const SNOWFLAKE_WORKSPACE_SCHEMA = 'stellar-forge.snowflake-workspace.v1';
export const SNOWFLAKE_STARTUP_SCHEMA = 'stellar-forge.snowflake-workspace-startup.v1';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const executedSourceRoot = fileURLToPath(new URL('../../../../', import.meta.url)).replace(/\/$/, '');
export const SNOWFLAKE_LAUNCH_FILES = Object.freeze([
  'declaration.mjs', 'store.mjs', 'source.mjs', 'edition.mjs', 'workspace.mjs',
  'transfer.mjs', 'publisher.mjs', 'cloud-delivery.mjs', 'server.mjs', 'cli.mjs',
  'managed.mjs', 'application.mjs', 'application-provider.mjs',
  'browser-assets.json', 'public/index.html', 'public/style.css', 'public/app.js',
].map(name => SNOWFLAKE_SOURCE + '/' + name));

function requireValue(value, code, message) {
  if (!value) throw fault(code, message, 409);
}
async function privatePath(filename, directory) {
  const path = resolve(filename), info = await lstat(path);
  requireValue(await realpath(path) === path && !info.isSymbolicLink() &&
    (directory ? info.isDirectory() : info.isFile()) && !(info.mode & 0o077),
  'SNOWFLAKE_PRIVATE_WORKSPACE_REQUIRED', 'Select the original canonical private Snowflake workspace.');
  return { path, info };
}

/** Read only the existing journal's stable identity, never hash mutable data as launch settings. */
export async function inspectSnowflakeWorkspace(directory, { expectedId } = {}) {
  const root = await privatePath(directory, true);
  const file = await privatePath(join(root.path, 'workspace.sqlite'), false);
  let db;
  try {
    db = new DatabaseSync(file.path, { readOnly: true });
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=5000;');
    const metadata = db.prepare('SELECT value FROM metadata WHERE key=?');
    const schema = metadata.get('schema')?.value, id = metadata.get('id')?.value;
    requireValue(schema === SNOWFLAKE_WORKSPACE_SCHEMA && UUID.test(id ?? ''),
      'SNOWFLAKE_WORKSPACE_SCHEMA_INVALID', 'The selected directory is not an initialized Snowflake workspace.');
    requireValue(expectedId === undefined || id === expectedId,
      'SNOWFLAKE_WORKSPACE_ID_CHANGED', 'The original workspace identity changed. Select the intended workspace.');
    const after = await privatePath(root.path, true), database = await privatePath(file.path, false);
    requireValue(after.info.dev === root.info.dev && after.info.ino === root.info.ino &&
      database.info.dev === file.info.dev && database.info.ino === file.info.ino,
    'SNOWFLAKE_WORKSPACE_ID_CHANGED', 'The selected workspace changed while reading its identity.');
    return { schema, id, directory: root.path, database: file.path,
      directoryIdentity: { dev: String(root.info.dev), ino: String(root.info.ino) } };
  } catch (error) {
    if (error.code?.startsWith('SNOWFLAKE_')) throw error;
    throw fault('SNOWFLAKE_WORKSPACE_INSPECTION_FAILED',
      'The original Snowflake journal could not be read: ' + error.message, 409);
  } finally { db?.close(); }
}

/** The selected package and the executing package must contain the same original product source. */
export async function inspectSnowflakeLaunchSource(sourceRoot, { expectedSha256 } = {}) {
  const root = resolve(sourceRoot);
  requireValue(await realpath(root) === root, 'SNOWFLAKE_SOURCE_ROOT_CHANGED');
  const files = [];
  for (const name of SNOWFLAKE_LAUNCH_FILES) {
    const bytes = await boundedFile(root, name, 1048576);
    files.push({ name, bytes: bytes.length, sha256: sha256(bytes) });
  }
  const identity = sha256(canonical(files));
  requireValue(expectedSha256 === undefined || identity === expectedSha256,
    'SNOWFLAKE_LAUNCH_SOURCE_CHANGED', 'The selected Snowflake source changed. Review the intended installed release.');
  return { sourceRoot: root, sha256: identity, files };
}

export async function startManagedSnowflakeWorkspace({
  directory, sourceRoot, expectedWorkspaceId, expectedSourceSha256, port = 0, env = process.env,
} = {}) {
  requireValue(UUID.test(expectedWorkspaceId ?? '') && HASH.test(expectedSourceSha256 ?? ''),
    'SNOWFLAKE_MANAGED_SELECTION_REQUIRED', 'Managed launch requires the reviewed workspace and source identities.');
  const original = await inspectSnowflakeWorkspace(directory, { expectedId: expectedWorkspaceId });
  const selected = await inspectSnowflakeLaunchSource(sourceRoot, { expectedSha256: expectedSourceSha256 });
  await inspectSnowflakeLaunchSource(executedSourceRoot, { expectedSha256: expectedSourceSha256 });
  const { startSnowflakeWorkspace } = await import('./server.mjs');
  const session = await startSnowflakeWorkspace({ directory: original.directory, port, env });
  try {
    const current = await session.workspace.state();
    requireValue(current.id === original.id, 'SNOWFLAKE_WORKSPACE_ID_CHANGED');
    const startup = {
      schema: SNOWFLAKE_STARTUP_SCHEMA, status: 'SNOWFLAKE_WORKSPACE_READY',
      directory: original.directory, workspaceId: original.id,
      sourceRoot: selected.sourceRoot, executedSourceRoot,
      sourceSha256: selected.sha256, sourceFiles: selected.files,
      instanceId: session.instanceId, pid: process.pid, operatorUrl: session.url,
    };
    return { ...session, startup };
  } catch (error) { await session.close(); throw error; }
}
