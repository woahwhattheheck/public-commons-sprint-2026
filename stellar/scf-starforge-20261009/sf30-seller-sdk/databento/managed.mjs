// MIT. Managed Databento launch over the original retained Python workspace.
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DATABENTO_STARTUP_SCHEMA = 'stellar-forge.databento-workspace-startup.v1';
export const DATABENTO_SOURCE = 'stellar/scf-starforge-20261009/sf30-seller-sdk/databento';
const PYTHON = 'stellar/scf-starforge-20261009/sf30-seller-sdk/python/workspace';
const EXECUTED_SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
export const DATABENTO_LAUNCH_FILES = Object.freeze([
  DATABENTO_SOURCE + '/managed.mjs',
  DATABENTO_SOURCE + '/workbench.mjs',
  DATABENTO_SOURCE + '/processor.py',
  DATABENTO_SOURCE + '/application.py',
  DATABENTO_SOURCE + '/browser-assets.json',
  DATABENTO_SOURCE + '/web/index.html',
  DATABENTO_SOURCE + '/web/browser.mjs',
  DATABENTO_SOURCE + '/web/style.css',
  PYTHON + '/model.mjs',
  PYTHON + '/server.mjs',
  PYTHON + '/local-draft-store.mjs',
  'stellar/scf-starforge-20261009/distribution/browser-assets.mjs',
]);
const HASH = /^[a-f0-9]{64}$/;
const WORKSPACE_ID = /^ws-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const canonical = value => Array.isArray(value) ? value.map(canonical) : object(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const databentoIdentity = value => hash(JSON.stringify(canonical(value)) + '\n');
const inode = stat => ({ dev: String(stat.dev), ino: String(stat.ino) });
const sameInode = (left, right) => left.dev === right.dev && left.ino === right.ino;
function fail(code, message) { return Object.assign(new Error(message), { code }); }
function need(value, code, message) { if (!value) throw fail(code, message); }
function path(value, label) {
  need(typeof value === 'string' && isAbsolute(value) && resolve(value) === value &&
    !value.includes('\0'), 'DATABENTO_MANAGED_PATH_REQUIRED', 'Choose an absolute original ' + label + '.');
  return value;
}
function expected(value) {
  need(value === undefined || HASH.test(value), 'DATABENTO_MANAGED_HASH_REQUIRED',
    'Use the complete original launch identity from Applications review.');
}
const changed = () => fail('DATABENTO_MANAGED_INPUT_CHANGED',
  'The selected original workspace or runtime source changed. Review the current selection in Applications.');
async function directory(value) {
  path(value, 'directory');
  const stat = await lstat(value, { bigint: true });
  need(stat.isDirectory() && !stat.isSymbolicLink() && !(stat.mode & 0o077n) &&
    await realpath(value) === value, 'DATABENTO_PRIVATE_DIRECTORY_REQUIRED',
  'Choose the original private Databento workbench directory.');
  return stat;
}
async function privateDatabase(value) {
  const stat = await lstat(value, { bigint: true });
  need(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1n && !(stat.mode & 0o077n) &&
    await realpath(value) === value, 'DATABENTO_ORIGINAL_DATABASE_REQUIRED',
  'Choose the original private workspace.sqlite3 file through its workbench directory.');
  return stat;
}
async function readFile(value, limit, { privateOnly = false } = {}) {
  const handle = await open(value, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    need(before.isFile() && before.size <= BigInt(limit) &&
      (!privateOnly || before.nlink === 1n && !(before.mode & 0o077n)),
    'DATABENTO_MANAGED_FILE_INVALID', 'The selected original file is not a regular file within its limit: ' + value);
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true }), current = await lstat(value, { bigint: true });
    if (BigInt(bytes.length) !== before.size || before.size !== after.size ||
        before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs ||
        !sameInode(before, after) || !sameInode(after, current) || current.isSymbolicLink()) throw changed();
    return { bytes, sha256: hash(bytes), identity: inode(after) };
  } finally { await handle.close(); }
}

/** Read the existing marker and native immutable identity without opening a
 * producer model, executing Python, recovering previews or changing a revision. */
export async function inspectDatabentoWorkspace(value, { expectedIdentity } = {}) {
  expected(expectedIdentity);
  const root = path(value, 'Databento workbench directory');
  const rootBefore = await directory(root), workspaceDirectory = join(root, 'workspace');
  const workspaceBefore = await directory(workspaceDirectory);
  const markerFile = join(root, 'operation.json');
  const markerBytes = await readFile(markerFile, 256 * 1024, { privateOnly: true });
  let marker;
  try { marker = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(markerBytes.bytes)); }
  catch { throw fail('DATABENTO_WORKBENCH_MARKER_INVALID', 'The original Databento operation.json is unreadable.'); }
  need(object(marker) && marker.schema === 'tj.databento-workbench.v1' &&
    ['create', 'import'].includes(marker.mode), 'DATABENTO_WORKBENCH_REQUIRED',
  'Select a directory initialized or received by the original databento-workspace command.');
  const database = join(workspaceDirectory, 'workspace.sqlite3'), before = await privateDatabase(database);
  let db, row;
  try {
    db = new DatabaseSync(database, { readOnly: true });
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=3000; BEGIN');
    row = db.prepare('SELECT substr(value,1,65537) AS value,length(CAST(value AS BLOB)) AS bytes FROM metadata WHERE id=1').get();
    db.exec('COMMIT');
  } catch (error) {
    throw fail('DATABENTO_WORKSPACE_IDENTITY_UNREADABLE',
      'Read the original Databento workspace identity again after its current SQLite operation finishes: ' +
      String(error.message).slice(0,600));
  } finally { db?.close(); }
  need(row && typeof row.value === 'string' && row.bytes <= 65536 &&
    Buffer.byteLength(row.value) === row.bytes, 'DATABENTO_WORKSPACE_METADATA_INVALID',
  'The original Python workspace metadata is missing or exceeds its identity limit.');
  let metadata;
  try { metadata = JSON.parse(row.value); }
  catch { throw fail('DATABENTO_WORKSPACE_METADATA_INVALID', 'The original Python workspace metadata is unreadable.'); }
  need(object(metadata) && metadata.schema === 'stellar-forge.python-workspace.v1' &&
    WORKSPACE_ID.test(metadata.id ?? '') && typeof metadata.createdAt === 'string' &&
    Number.isFinite(Date.parse(metadata.createdAt)), 'DATABENTO_WORKSPACE_METADATA_INVALID',
  'Select an initialized original Python workspace owned by this Databento workbench.');
  const after = await privateDatabase(database), rootAfter = await directory(root);
  const workspaceAfter = await directory(workspaceDirectory);
  const markerAfter = await readFile(markerFile, 256 * 1024, { privateOnly: true });
  if (!sameInode(before, after) || !sameInode(rootBefore, rootAfter) ||
      !sameInode(workspaceBefore, workspaceAfter) ||
      markerAfter.sha256 !== markerBytes.sha256 ||
      !sameInode(markerAfter.identity, markerBytes.identity)) throw changed();
  const identity = {
    schema: 'stellar-forge.databento-workbench-identity.v1',
    directory: root, directoryIdentity: inode(rootAfter),
    workspaceDirectory, workspaceDirectoryIdentity: inode(workspaceAfter),
    database: { path: database, ...inode(after) },
    marker: { path: markerFile, bytes: markerBytes.bytes.length, sha256: markerBytes.sha256, ...markerBytes.identity },
    workspace: { schema: metadata.schema, id: metadata.id, createdAt: metadata.createdAt },
  };
  const sha256 = databentoIdentity(identity);
  if (expectedIdentity !== undefined && expectedIdentity !== sha256) throw changed();
  return { ...identity, sha256, label: metadata.label ?? 'Databento migration',
    configuration: marker.configuration ?? (marker.mode === 'import' ? 'RECEIVED_ORIGINAL_WORKSPACE' : null) };
}

/** The original managed runtime records its complete package identity.
 * These direct launch/source/browser leaves additionally bind selected bytes
 * to the source copy that executes, while allowing different adoption paths. */
export async function inspectDatabentoLaunchSource(value, { expectedSha256 } = {}) {
  expected(expectedSha256);
  const sourceRoot = path(value, 'runtime source root'), stat = await lstat(sourceRoot);
  need(stat.isDirectory() && !stat.isSymbolicLink() && await realpath(sourceRoot) === sourceRoot,
    'DATABENTO_MANAGED_SOURCE_REQUIRED', 'Choose the original repository or installed runtime source root.');
  const files = [];
  for (const name of DATABENTO_LAUNCH_FILES) {
    const file = await readFile(join(sourceRoot, name), 2 * 1024 * 1024);
    files.push({ name, bytes: file.bytes.length, sha256: file.sha256 });
  }
  const identity = { schema: 'stellar-forge.databento-launch-source.v1', files };
  const sha256 = databentoIdentity(identity);
  if (expectedSha256 !== undefined && expectedSha256 !== sha256) throw changed();
  return { ...identity, sourceRoot, sha256 };
}

export async function prepareDatabentoManagedLaunch({
  directory: root, sourceRoot, expectedWorkspaceIdentity, expectedSourceSha256,
} = {}) {
  need(HASH.test(expectedWorkspaceIdentity ?? '') && HASH.test(expectedSourceSha256 ?? ''),
    'DATABENTO_MANAGED_REVIEW_REQUIRED', 'Use the complete workspace and runtime identities from the original Applications review.');
  const workspace = await inspectDatabentoWorkspace(root, { expectedIdentity: expectedWorkspaceIdentity });
  const source = await inspectDatabentoLaunchSource(sourceRoot, { expectedSha256: expectedSourceSha256 });
  const executed = await inspectDatabentoLaunchSource(EXECUTED_SOURCE_ROOT, { expectedSha256: expectedSourceSha256 });
  return { directory: workspace.directory, expectedWorkspaceIdentity, workspace, source, executed };
}

/** Called only after the original Python workspace and native server opened. */
export async function databentoManagedStartup({ launch, workspace, service } = {}) {
  need(launch && workspace && service && workspace.root === launch.workspace.workspaceDirectory,
    'DATABENTO_MANAGED_REVIEW_REQUIRED', 'The original native workspace must match the saved Databento launch.');
  const current = await inspectDatabentoWorkspace(launch.directory, { expectedIdentity: launch.expectedWorkspaceIdentity });
  const metadata = workspace.metadata();
  need(metadata.id === current.workspace.id && metadata.createdAt === current.workspace.createdAt,
    'DATABENTO_MANAGED_WORKSPACE_CHANGED', 'The running original workspace differs from its reviewed identity.');
  await inspectDatabentoLaunchSource(launch.source.sourceRoot, { expectedSha256: launch.source.sha256 });
  await inspectDatabentoLaunchSource(launch.executed.sourceRoot, { expectedSha256: launch.source.sha256 });
  const operator = new URL(service.operatorUrl), native = new URL(service.nativeOperatorUrl);
  need(operator.protocol === 'http:' && operator.hostname === '127.0.0.1' &&
    operator.pathname === '/databento-migration/' && !operator.search &&
    !operator.username && !operator.password && /^#[a-f0-9]{64}$/.test(operator.hash) &&
    native.origin === operator.origin && native.pathname === '/' && native.hash === operator.hash &&
    !native.search && !native.username && !native.password,
    'DATABENTO_NATIVE_SERVER_REQUIRED', 'Use the original authenticated Python server with the Databento operator assets.');
  return {
    schema: DATABENTO_STARTUP_SCHEMA, status: 'DATABENTO_WORKSPACE_READY',
    instanceId: randomUUID(), pid: process.pid,
    directory: current.directory, workspaceDirectory: current.workspaceDirectory,
    workspaceId: current.workspace.id, workspaceCreatedAt: current.workspace.createdAt,
    workspaceIdentity: current.sha256, configuration: current.configuration,
    sourceRoot: launch.source.sourceRoot, executedSourceRoot: launch.executed.sourceRoot,
    sourceSha256: launch.source.sha256, sourceFiles: launch.source.files,
    operatorUrl: operator.href, nativeOperatorUrl: native.href,
  };
}
