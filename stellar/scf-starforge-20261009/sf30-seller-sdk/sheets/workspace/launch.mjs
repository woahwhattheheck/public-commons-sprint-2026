// MIT. Managed launch identity for the original private Sheets source workspace.
import { DatabaseSync } from 'node:sqlite';
import { constants } from 'node:fs';
import { open, lstat, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { absolute, privateDirectory, readPrivate, object, digest, identity, fault } from '../../postgres/publisher/files.mjs';
import { normalizeConnections } from './provider.mjs';

export const SHEETS_STARTUP_SCHEMA = 'stellar-forge.sheets-authoring-startup.v1';
const WORKSPACE = 'stellar-forge.sheets-authoring.v1';
const HASH = /^[a-f0-9]{64}$/;
const SOURCE_FILES = ['launch.mjs', 'model.mjs', 'cli.mjs', 'server.mjs'];
const SOURCE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const changed = () => fault('SHEETS_MANAGED_INPUT_CHANGED',
  'Review the current source workspace, connection file and installed runtime before starting.', 409);

function expected(value) {
  if (value !== undefined && !HASH.test(value)) throw fault('SHEETS_MANAGED_HASH_REQUIRED');
}
function inode(stat) {
  return { dev: String(stat.dev), ino: String(stat.ino) };
}
function sameInode(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}
async function privateDatabase(path) {
  const stat = await lstat(path, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || stat.mode & 0o077n ||
      await realpath(path) !== path) throw fault('PRIVATE_DATABASE_REQUIRED');
  return stat;
}

/** Fixed read-only query over immutable original settings. Mutable SQLite bytes,
 * revisions, captures and publication records are deliberately not launch input. */
export async function inspectSheetsAuthoring(directory, { expectedIdentity } = {}) {
  absolute(directory); expected(expectedIdentity);
  await privateDirectory(directory);
  const directoryBefore = await lstat(directory, { bigint: true });
  const database = join(directory, 'sources.sqlite'), before = await privateDatabase(database);
  let db, row;
  try {
    db = new DatabaseSync(database, { readOnly: true });
    db.exec('PRAGMA query_only=ON; BEGIN');
    row = db.prepare('SELECT substr(data,1,65537) AS data,length(CAST(data AS BLOB)) AS bytes FROM settings WHERE id=1').get();
    db.exec('COMMIT');
  } catch (issue) {
    if (issue.errcode === 5 || issue.errcode === 6)
      throw fault('SHEETS_WORKSPACE_READING_BUSY', 'Let the current original workspace action finish, then retry this review.', 409);
    throw fault('SHEETS_ORIGINAL_SETTINGS_UNREADABLE',
      'Open the original workspace with the Sheets status command to reconcile its SQLite state, then review again.', 409);
  } finally { db?.close(); }
  const after = await privateDatabase(database), directoryAfter = await lstat(directory, { bigint: true });
  if (!sameInode(before, after) || !sameInode(directoryBefore, directoryAfter)) throw changed();
  if (!row || typeof row.data !== 'string' || row.bytes > 65536 || Buffer.byteLength(row.data) !== row.bytes)
    throw fault('SHEETS_AUTHORING_BINDING_CHANGED');
  let settings;
  try { settings = JSON.parse(row.data); } catch { throw fault('SHEETS_AUTHORING_BINDING_CHANGED'); }
  if (!object(settings) || settings.schema !== WORKSPACE || typeof settings.createdAt !== 'string' ||
      settings.sourceFile !== join(directory, 'current-source.json') ||
      settings.publisherDirectory !== join(directory, 'publisher'))
    throw fault('SHEETS_AUTHORING_BINDING_CHANGED');
  absolute(settings.targetDirectory);
  const value = {
    schema: 'stellar-forge.sheets-authoring-identity.v1', directory,
    directoryIdentity: inode(directoryAfter), database: { path: database, ...inode(after) },
    settingsSha256: digest(row.data), settings: {
      schema: settings.schema, createdAt: settings.createdAt, sourceFile: settings.sourceFile,
      publisherDirectory: settings.publisherDirectory, targetDirectory: settings.targetDirectory,
    },
  };
  const sha256 = identity(value);
  if (expectedIdentity !== undefined && sha256 !== expectedIdentity) throw changed();
  return { ...value, sha256 };
}

/** Credential references stay in the original private host file. This performs
 * local validation only and never reads or refreshes a Google grant. */
export async function readSheetsLaunchConnections(file, { expectedSha256 } = {}) {
  expected(expectedSha256);
  if (file === undefined || file === null) {
    if (expectedSha256 !== undefined) throw fault('SHEETS_MANAGED_CONNECTION_REQUIRED');
    return { file: null, sha256: null, connections: {} };
  }
  absolute(file, 'connection file');
  if (await realpath(file) !== file) throw fault('SHEETS_MANAGED_CONNECTION_PATH_REQUIRED');
  const bytes = await readPrivate(file);
  const sha256 = digest(bytes);
  if (expectedSha256 !== undefined && sha256 !== expectedSha256) throw changed();
  let parsed;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw fault('PRIVATE_JSON_INVALID'); }
  return { file, sha256, connections: normalizeConnections(parsed) };
}

async function sourceFile(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > 2 * 1024 * 1024) throw fault('SHEETS_MANAGED_SOURCE_INVALID');
    const bytes = await handle.readFile(), after = await handle.stat();
    if (bytes.length !== before.size || after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs)
      throw changed();
    return { bytes: bytes.length, sha256: digest(bytes) };
  } finally { await handle.close(); }
}

/** Paths differ after original managed adoption; source bytes must not. */
export async function inspectSheetsLaunchSource(directory, { expectedSha256 } = {}) {
  absolute(directory, 'source directory'); expected(expectedSha256);
  if (await realpath(directory) !== directory || !(await lstat(directory)).isDirectory())
    throw fault('SHEETS_MANAGED_SOURCE_INVALID');
  const files = [];
  for (const name of SOURCE_FILES) files.push({ name, ...await sourceFile(join(directory, name)) });
  const body = { schema: 'stellar-forge.sheets-authoring-launch-source.v1', files };
  const sha256 = identity(body);
  if (expectedSha256 !== undefined && sha256 !== expectedSha256) throw changed();
  return { ...body, directory, sha256 };
}

export async function prepareSheetsManagedLaunch({
  directory, sourceDirectory, expectedSourceSha256, expectedWorkspaceIdentity,
  connectionsFile, expectedConnectionsSha256,
} = {}) {
  absolute(directory); absolute(sourceDirectory);
  if (!HASH.test(expectedSourceSha256 ?? '') || !HASH.test(expectedWorkspaceIdentity ?? '') ||
      Boolean(connectionsFile) !== Boolean(expectedConnectionsSha256))
    throw fault('SHEETS_MANAGED_REVIEW_REQUIRED', 'Use the complete saved Applications launch review.');
  const source = await inspectSheetsLaunchSource(sourceDirectory, { expectedSha256: expectedSourceSha256 });
  const executed = await inspectSheetsLaunchSource(SOURCE_DIRECTORY, { expectedSha256: expectedSourceSha256 });
  const connection = await readSheetsLaunchConnections(connectionsFile, { expectedSha256: expectedConnectionsSha256 });
  return { directory, expectedWorkspaceIdentity, source, executed, connection };
}

export async function sheetsManagedStartup({ launch, workspace, service } = {}) {
  if (!launch || !workspace || !service || launch.directory !== workspace.directory)
    throw fault('SHEETS_MANAGED_REVIEW_REQUIRED');
  const current = await inspectSheetsAuthoring(workspace.directory, {
    expectedIdentity: launch.expectedWorkspaceIdentity,
  });
  await inspectSheetsLaunchSource(launch.source.directory, { expectedSha256: launch.source.sha256 });
  await inspectSheetsLaunchSource(launch.executed.directory, { expectedSha256: launch.source.sha256 });
  return {
    schema: SHEETS_STARTUP_SCHEMA, status: 'SHEETS_AUTHORING_READY',
    instanceId: randomUUID(), pid: process.pid, directory: workspace.directory,
    workspaceIdentity: current.sha256, settingsSha256: current.settingsSha256,
    sourceDirectory: launch.source.directory, launchSourceDirectory: launch.executed.directory,
    sourceSha256: launch.source.sha256, sourceFiles: launch.source.files,
    connectionsFile: launch.connection.file, connectionsSha256: launch.connection.sha256,
    sourceFile: current.settings.sourceFile, publisherDirectory: current.settings.publisherDirectory,
    targetDirectory: current.settings.targetDirectory, sheetsWorkspace: service.url,
  };
}

