// MIT. Retained identity and publication for the original SQL Server workspace.
import { constants } from 'node:fs';
import { open, mkdir, lstat, realpath, link, unlink, rename, readdir } from 'node:fs/promises';
import { resolve, dirname, join, isAbsolute } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { acquireStateLease } from '../../../merchant-fleet-gateway/state-lease.mjs';
import { inspectMssqlWorkspaceSource } from './model.mjs';

export const MSSQL_OPERATOR_SCHEMA = 'stellar-forge.mssql-operator-identity.v1';
export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const SHA = /^[a-f0-9]{64}$/;
export const RELEASE_ID = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
export const ALIAS = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const digest = value => createHash('sha256').update(value).digest('hex');
export const canonical = value => JSON.stringify(value, (_, item) => plain(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
export const encoded = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
export const failure = (code, message, status = 422) => Object.assign(new Error(message ?? code), { code, status });
export function need(value, code, message, status) { if (!value) throw failure(code, message, status); }
export function exact(value, allowed, required = []) {
  need(plain(value) && Object.keys(value).every(key => allowed.includes(key)) &&
    required.every(key => Object.hasOwn(value, key)), 'MSSQL_OPERATOR_INPUT_INVALID');
}
export function checked(value, pattern, label) {
  need(typeof value === 'string' && pattern.test(value) &&
    !['__proto__', 'constructor', 'prototype'].includes(value), 'MSSQL_OPERATOR_INPUT_INVALID', 'Select the original ' + label + '.');
  return value;
}
export function absolute(value) {
  need(typeof value === 'string' && value && !value.includes('\0') && isAbsolute(value) &&
    resolve(value) !== '/', 'MSSQL_OPERATOR_PATH_INVALID');
  return resolve(value);
}
export async function privateDirectory(path, create = false) {
  path = absolute(path);
  if (create) await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  need(info.isDirectory() && !info.isSymbolicLink() && !(info.mode & 0o077) &&
    await realpath(path) === path, 'MSSQL_OPERATOR_PRIVATE_DIRECTORY_REQUIRED');
  return path;
}
export async function readBytes(path, maximum = 4 * 1024 * 1024, privateOnly = true) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat({ bigint: true });
    need(before.isFile() && before.nlink === 1n && before.size <= BigInt(maximum) &&
      (!privateOnly || !(before.mode & 0o077n)), 'MSSQL_OPERATOR_FILE_INVALID');
    const bytes = await handle.readFile(), after = await handle.stat({ bigint: true });
    need(bytes.length <= maximum && ['dev','ino','size','mtimeNs','ctimeNs'].every(key => before[key] === after[key]),
      'MSSQL_OPERATOR_FILE_CHANGED', undefined, 409);
    return bytes;
  } finally { await handle.close(); }
}
export const decodeJSON = bytes => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
export const readJSON = async (path, maximum) => decodeJSON(await readBytes(path, maximum));
export async function exists(path) {
  try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
export async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function temporary(path, bytes) {
  const next = join(dirname(path), '.mssql-' + randomUUID() + '.next');
  const handle = await open(next, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); }
  catch (error) { await unlink(next).catch(() => {}); throw error; }
  finally { await handle.close(); }
  return next;
}
export async function publish(path, value) {
  const bytes = Buffer.isBuffer(value) ? value : encoded(value);
  const next = await temporary(path, bytes);
  try {
    try { await link(next, path); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      need((await readBytes(path, Math.max(bytes.length, 1))).equals(bytes),
        'MSSQL_OPERATOR_RECORD_CONFLICT', 'This original identity already contains different bytes.', 409);
    }
  } finally { await unlink(next); }
  await syncDirectory(dirname(path));
}
export async function replace(path, value) {
  const next = await temporary(path, Buffer.isBuffer(value) ? value : encoded(value));
  try { await rename(next, path); await syncDirectory(dirname(path)); }
  finally { await unlink(next).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
// A terminated publisher can leave its committed final name linked to its own
// staging inode. Reconcile that publication only while the original owner holds
// this directory's lease; private input reads keep their one-link requirement.
export async function reconcileMssqlPublications(directory) {
  await privateDirectory(directory);
  const entries = await readdir(directory, {withFileTypes:true});
  const snapshots = new Map();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const path = join(directory, entry.name), value = await lstat(path, {bigint:true});
    if (value.isFile() && !value.isSymbolicLink() && !(value.mode & 0o077n) &&
        (typeof process.getuid !== 'function' || value.uid === BigInt(process.getuid())))
      snapshots.set(entry.name, value);
  }
  let recovered = 0;
  const temporaryName = /^\.mssql-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.next$/;
  for (const [name, original] of snapshots) {
    if (!temporaryName.test(name) || original.nlink !== 2n) continue;
    const matches = [...snapshots].filter(([other, value]) => !temporaryName.test(other) &&
      value.dev === original.dev && value.ino === original.ino && value.nlink === 2n);
    if (matches.length !== 1) continue;
    const stage = join(directory, name), final = join(directory, matches[0][0]);
    const before = await lstat(stage, {bigint:true}), committed = await lstat(final, {bigint:true});
    need(['dev','ino','size','mode','uid','nlink','mtimeNs','ctimeNs'].every(key =>
      before[key] === original[key] && committed[key] === original[key]),
      'MSSQL_OPERATOR_PUBLICATION_CHANGED', undefined, 409);
    await unlink(stage);
    const after = await lstat(final, {bigint:true});
    need(after.isFile() && after.dev === original.dev && after.ino === original.ino &&
      after.size === original.size && after.mtimeNs === original.mtimeNs && after.nlink === 1n,
      'MSSQL_OPERATOR_PUBLICATION_CHANGED', undefined, 409);
    recovered++;
  }
  if (recovered) await syncDirectory(directory);
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const path = join(directory, entry.name), value = await lstat(path);
    if (!value.isDirectory() || value.isSymbolicLink() || (value.mode & 0o077) ||
        (typeof process.getuid === 'function' && value.uid !== process.getuid())) continue;
    recovered += await reconcileMssqlPublications(path);
  }
  return recovered;
}
export async function operatorLease(directory) {
  let lease;
  try { lease = await acquireStateLease(directory); }
  catch (error) {
    throw failure(error.message === 'FLEET_STATE_ALREADY_OWNED' ? 'MSSQL_WORKSPACE_ALREADY_OWNED' : 'MSSQL_WORKSPACE_FLOCK_REQUIRED',
      error.message === 'FLEET_STATE_ALREADY_OWNED' ? 'Use the existing SQL Server workspace listener.' :
        'The original SQL Server authoring owner requires Linux with util-linux flock.', 503);
  }
  try { lease.assertHeld(); await reconcileMssqlPublications(directory); return lease; }
  catch (error) { await lease.close(); throw error; }
}
export async function readMssqlOperatorIdentity(stateDirectory) {
  const root = await privateDirectory(absolute(stateDirectory));
  const directory = await privateDirectory(join(root, 'operator'));
  const path = join(directory, 'workspace.json'), bytes = await readBytes(path, 16384);
  const value = decodeJSON(bytes);
  exact(value, ['schema','workspaceId','createdAt'], ['schema','workspaceId','createdAt']);
  need(value.schema === MSSQL_OPERATOR_SCHEMA && UUID.test(value.workspaceId) &&
    Number.isFinite(Date.parse(value.createdAt)), 'MSSQL_WORKSPACE_IDENTITY_INVALID');
  return { ...value, stateDirectory: root, directory, path, sha256: digest(bytes) };
}
export async function initializeMssqlOperator({sourceFile, stateDirectory} = {}) {
  const source = await inspectMssqlWorkspaceSource(absolute(sourceFile));
  const root = await privateDirectory(absolute(stateDirectory), true);
  const directory = await privateDirectory(join(root, 'operator'), true), lease = await operatorLease(directory);
  try {
    const path = join(directory, 'workspace.json');
    if (!await exists(path)) await publish(path, {schema: MSSQL_OPERATOR_SCHEMA,
      workspaceId: randomUUID(), createdAt: new Date().toISOString()});
    const identity = await readMssqlOperatorIdentity(root);
    return { ...identity, sourceFile: absolute(sourceFile), profileId: source.profileId };
  } finally { await lease.close(); }
}
export async function inspectMssqlOperatorBinding({sourceFile, stateDirectory} = {}) {
  const selected = absolute(sourceFile), identity = await readMssqlOperatorIdentity(stateDirectory);
  const source = await inspectMssqlWorkspaceSource(selected);
  const sourceFiles = [{path: selected, bytes: (await readBytes(selected, 262144, false)).length}];
  if (source.config.connection.caFile) sourceFiles.push({path: resolve(dirname(selected), source.config.connection.caFile), bytes: source.ca.length});
  const files = [];
  for (const file of sourceFiles) {
    const bytes = await readBytes(file.path, file.path === selected ? 262144 : 1048576, false);
    files.push({path: file.path, bytes: bytes.length, sha256: digest(bytes)});
  }
  need(digest(JSON.stringify({source:files[0].sha256,ca:files[1]?.sha256??null})) === source.profileId &&
    (await inspectMssqlWorkspaceSource(selected)).profileId === source.profileId, 'SOURCE_PROFILE_CHANGED', undefined, 409);
  return {schema:'stellar-forge.mssql-operator-binding.v1', workspaceId:identity.workspaceId,
    workspaceCreatedAt:identity.createdAt, workspaceIdentitySha256:identity.sha256,
    identityFile:identity.path, sourceFile:selected, stateDirectory:identity.stateDirectory,
    profileId:source.profileId, files, requiredEnvironment:source.config.connection.passwordEnv ?? null};
}
export async function pageJSON(directory, {after, limit = 50} = {}, read) {
  need(Number.isSafeInteger(limit) && limit >= 1 && limit <= 100 &&
    (after === undefined || typeof after === 'string'), 'MSSQL_OPERATOR_PAGE_INVALID');
  const names = (await readdir(directory, {withFileTypes:true})).filter(item => item.isFile() && item.name.endsWith('.json'))
    .map(item => item.name.slice(0,-5)).sort().filter(id => after === undefined || id > after);
  const selected = names.slice(0,limit), items = [];
  for (const id of selected) items.push(await read(id));
  return {items, hasMore:names.length > selected.length, nextCursor:names.length > selected.length ? selected.at(-1) : null};
}
