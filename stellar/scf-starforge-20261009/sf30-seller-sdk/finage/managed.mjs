// MIT. Managed Finage launch over the original retained Python workspace.
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FINAGE_STARTUP_SCHEMA = 'stellar-forge.finage-workspace-startup.v1';
export const FINAGE_SOURCE = 'stellar/scf-starforge-20261009/sf30-seller-sdk/finage';
const PYTHON = 'stellar/scf-starforge-20261009/sf30-seller-sdk/python/workspace';
const EXECUTED_SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
export const FINAGE_LAUNCH_FILES = Object.freeze([
  FINAGE_SOURCE + '/managed.mjs',
  FINAGE_SOURCE + '/workbench.mjs',
  FINAGE_SOURCE + '/processor.py',
  FINAGE_SOURCE + '/application.py',
  FINAGE_SOURCE + '/browser-assets.json',
  FINAGE_SOURCE + '/web/index.html',
  FINAGE_SOURCE + '/web/browser.mjs',
  FINAGE_SOURCE + '/web/style.css',
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
export const finageIdentity = value => hash(JSON.stringify(canonical(value)) + '\n');
const inode = stat => ({ dev: String(stat.dev), ino: String(stat.ino) });
const sameInode = (left, right) => left.dev === right.dev && left.ino === right.ino;
function fail(code, message) { return Object.assign(new Error(message), { code }); }
function need(value, code, message) { if (!value) throw fail(code, message); }
function path(value, label) {
  need(typeof value === 'string' && isAbsolute(value) && resolve(value) === value &&
    !value.includes('\0'), 'FINAGE_MANAGED_PATH_REQUIRED', 'Choose an absolute original ' + label + '.');
  return value;
}
function expected(value) {
  need(value === undefined || HASH.test(value), 'FINAGE_MANAGED_HASH_REQUIRED',
    'Use the complete original launch identity from Applications review.');
}
const changed = () => fail('FINAGE_MANAGED_INPUT_CHANGED',
  'The selected original workspace or runtime source changed. Review the current selection in Applications.');
async function directory(value) {
  path(value, 'directory');
  const stat = await lstat(value, { bigint: true });
  need(stat.isDirectory() && !stat.isSymbolicLink() && !(stat.mode & 0o077n) &&
    await realpath(value) === value, 'FINAGE_PRIVATE_DIRECTORY_REQUIRED',
  'Choose the original private Finage workbench directory.');
  return stat;
}
async function privateDatabase(value) {
  const stat = await lstat(value, { bigint: true });
  need(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1n && !(stat.mode & 0o077n) &&
    await realpath(value) === value, 'FINAGE_ORIGINAL_DATABASE_REQUIRED',
  'Choose the original private workspace.sqlite3 file through its workbench directory.');
  return stat;
}
async function readFile(value, limit, { privateOnly = false } = {}) {
  const handle = await open(value, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    need(before.isFile() && before.size <= BigInt(limit) &&
      (!privateOnly || before.nlink === 1n && !(before.mode & 0o077n)),
    'FINAGE_MANAGED_FILE_INVALID', 'The selected original file is not a regular file within its limit: ' + value);
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
export async function inspectFinageWorkspace(value, { expectedIdentity } = {}) {
  expected(expectedIdentity);
  const root = path(value, 'Finage workbench directory');
  const rootBefore = await directory(root), workspaceDirectory = join(root, 'workspace');
  const workspaceBefore = await directory(workspaceDirectory);
  const markerFile = join(root, 'operation.json');
  const markerBytes = await readFile(markerFile, 256 * 1024, { privateOnly: true });
  let marker;
  try { marker = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(markerBytes.bytes)); }
  catch { throw fail('FINAGE_WORKBENCH_MARKER_INVALID', 'The original Finage operation.json is unreadable.'); }
  need(object(marker) && marker.schema === 'tj.finage-workbench.v1' &&
    ['create', 'import'].includes(marker.mode), 'FINAGE_WORKBENCH_REQUIRED',
  'Select a directory initialized or received by the original finage-workspace command.');
  const database = join(workspaceDirectory, 'workspace.sqlite3'), before = await privateDatabase(database);
  let db, row;
  try {
    db = new DatabaseSync(database, { readOnly: true });
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=3000; BEGIN');
    row = db.prepare('SELECT substr(value,1,65537) AS value,length(CAST(value AS BLOB)) AS bytes FROM metadata WHERE id=1').get();
    db.exec('COMMIT');
  } catch (error) {
    throw fail('FINAGE_WORKSPACE_IDENTITY_UNREADABLE',
      'Read the original Finage workspace identity again after its current SQLite operation finishes: ' +
      String(error.message).slice(0,600));
  } finally { db?.close(); }
  need(row && typeof row.value === 'string' && row.bytes <= 65536 &&
    Buffer.byteLength(row.value) === row.bytes, 'FINAGE_WORKSPACE_METADATA_INVALID',
  'The original Python workspace metadata is missing or exceeds its identity limit.');
  let metadata;
  try { metadata = JSON.parse(row.value); }
  catch { throw fail('FINAGE_WORKSPACE_METADATA_INVALID', 'The original Python workspace metadata is unreadable.'); }
  need(object(metadata) && metadata.schema === 'stellar-forge.python-workspace.v1' &&
    WORKSPACE_ID.test(metadata.id ?? '') && typeof metadata.createdAt === 'string' &&
    Number.isFinite(Date.parse(metadata.createdAt)), 'FINAGE_WORKSPACE_METADATA_INVALID',
  'Select an initialized original Python workspace owned by this Finage workbench.');
  const after = await privateDatabase(database), rootAfter = await directory(root);
  const workspaceAfter = await directory(workspaceDirectory);
  const markerAfter = await readFile(markerFile, 256 * 1024, { privateOnly: true });
  if (!sameInode(before, after) || !sameInode(rootBefore, rootAfter) ||
      !sameInode(workspaceBefore, workspaceAfter) ||
      markerAfter.sha256 !== markerBytes.sha256 ||
      !sameInode(markerAfter.identity, markerBytes.identity)) throw changed();
  const identity = {
    schema: 'stellar-forge.finage-workbench-identity.v1',
    directory: root, directoryIdentity: inode(rootAfter),
    workspaceDirectory, workspaceDirectoryIdentity: inode(workspaceAfter),
    database: { path: database, ...inode(after) },
    marker: { path: markerFile, bytes: markerBytes.bytes.length, sha256: markerBytes.sha256, ...markerBytes.identity },
    workspace: { schema: metadata.schema, id: metadata.id, createdAt: metadata.createdAt },
  };
  const sha256 = finageIdentity(identity);
  if (expectedIdentity !== undefined && expectedIdentity !== sha256) throw changed();
  return { ...identity, sha256, label: metadata.label ?? 'Finage market review',
    configuration: marker.configuration ?? (marker.mode === 'import' ? 'RECEIVED_ORIGINAL_WORKSPACE' : null) };
}

/** The original managed runtime records its complete package identity.
 * These direct launch/source/browser leaves additionally bind selected bytes
 * to the source copy that executes, while allowing different adoption paths. */
export async function inspectFinageLaunchSource(value, { expectedSha256 } = {}) {
  expected(expectedSha256);
  const sourceRoot = path(value, 'runtime source root'), stat = await lstat(sourceRoot);
  need(stat.isDirectory() && !stat.isSymbolicLink() && await realpath(sourceRoot) === sourceRoot,
    'FINAGE_MANAGED_SOURCE_REQUIRED', 'Choose the original repository or installed runtime source root.');
  const files = [];
  for (const name of FINAGE_LAUNCH_FILES) {
    const file = await readFile(join(sourceRoot, name), 2 * 1024 * 1024);
    files.push({ name, bytes: file.bytes.length, sha256: file.sha256 });
  }
  const identity = { schema: 'stellar-forge.finage-launch-source.v1', files };
  const sha256 = finageIdentity(identity);
  if (expectedSha256 !== undefined && expectedSha256 !== sha256) throw changed();
  return { ...identity, sourceRoot, sha256 };
}

export async function prepareFinageManagedLaunch({
  directory: root, sourceRoot, expectedWorkspaceIdentity, expectedSourceSha256,
} = {}) {
  need(HASH.test(expectedWorkspaceIdentity ?? '') && HASH.test(expectedSourceSha256 ?? ''),
    'FINAGE_MANAGED_REVIEW_REQUIRED', 'Use the complete workspace and runtime identities from the original Applications review.');
  const workspace = await inspectFinageWorkspace(root, { expectedIdentity: expectedWorkspaceIdentity });
  const source = await inspectFinageLaunchSource(sourceRoot, { expectedSha256: expectedSourceSha256 });
  const executed = await inspectFinageLaunchSource(EXECUTED_SOURCE_ROOT, { expectedSha256: expectedSourceSha256 });
  return { directory: workspace.directory, expectedWorkspaceIdentity, workspace, source, executed };
}

/** Called only after the original Python workspace and native server opened. */
export async function finageManagedStartup({ launch, workspace, service } = {}) {
  need(launch && workspace && service && workspace.root === launch.workspace.workspaceDirectory,
    'FINAGE_MANAGED_REVIEW_REQUIRED', 'The original native workspace must match the saved Finage launch.');
  const current = await inspectFinageWorkspace(launch.directory, { expectedIdentity: launch.expectedWorkspaceIdentity });
  const metadata = workspace.metadata();
  need(metadata.id === current.workspace.id && metadata.createdAt === current.workspace.createdAt,
    'FINAGE_MANAGED_WORKSPACE_CHANGED', 'The running original workspace differs from its reviewed identity.');
  await inspectFinageLaunchSource(launch.source.sourceRoot, { expectedSha256: launch.source.sha256 });
  await inspectFinageLaunchSource(launch.executed.sourceRoot, { expectedSha256: launch.source.sha256 });
  const operator = new URL(service.operatorUrl), native = new URL(service.nativeOperatorUrl);
  need(operator.protocol === 'http:' && operator.hostname === '127.0.0.1' &&
    operator.pathname === '/finage-market/' && !operator.search &&
    !operator.username && !operator.password && /^#[a-f0-9]{64}$/.test(operator.hash) &&
    native.origin === operator.origin && native.pathname === '/' && native.hash === operator.hash &&
    !native.search && !native.username && !native.password,
    'FINAGE_NATIVE_SERVER_REQUIRED', 'Use the original authenticated Python server with the Finage operator assets.');
  return {
    schema: FINAGE_STARTUP_SCHEMA, status: 'FINAGE_WORKSPACE_READY',
    instanceId: randomUUID(), pid: process.pid,
    directory: current.directory, workspaceDirectory: current.workspaceDirectory,
    workspaceId: current.workspace.id, workspaceCreatedAt: current.workspace.createdAt,
    workspaceIdentity: current.sha256, configuration: current.configuration,
    sourceRoot: launch.source.sourceRoot, executedSourceRoot: launch.executed.sourceRoot,
    sourceSha256: launch.source.sha256, sourceFiles: launch.source.files,
    operatorUrl: operator.href, nativeOperatorUrl: native.href,
  };
}
