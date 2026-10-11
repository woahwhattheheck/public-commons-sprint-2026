// MIT. Resume original Python workspace and customer bytes through the native MCP reader.
import { constants } from 'node:fs';
import { open, mkdir, readdir, realpath, link, unlink, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join, dirname, sep } from 'node:path';
import { openMerchantFileClient } from './support-download.mjs';
import { MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';
import { failure, identifier, privateSupportDirectory, writePrivate } from './config.mjs';
import { acquireStateLease } from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import { importWorkspace, MAX_BUNDLE_BYTES } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/python/workspace/model.mjs';

const MANIFEST_SCHEMA = 'stellar-forge.python-workspace-download-manifest.v1';
const STATE_SCHEMA = 'stellar-forge.python-workspace-download.v1';
const META_LIMIT = 2 * 1024 * 1024;
const MANIFEST = 'python-download.json';
const sha = value => createHash('sha256').update(value).digest('hex');
const validSha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const validReadId = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const parse = bytes => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
const ordered = value => Array.isArray(value) ? value.map(ordered) : plain(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const formatted = value => Buffer.from(JSON.stringify(ordered(value), null, 2) + '\n');
const problem = (code, message) => failure('PYTHON_DOWNLOAD_' + code, message);
const fileKey = file => sha(file.name);

function fileDescriptor(value, maximum) {
  const name = value?.name;
  if (typeof name !== 'string' || !name || name.length > 4096 || /[\\\x00-\x1f\x7f]/.test(name) || name.startsWith('/') ||
      name.split('/').some(part => !part || part === '.' || part === '..') ||
      ['download-state', MANIFEST].includes(name.split('/')[0]) ||
      !Number.isSafeInteger(value.bytes) || value.bytes < 0 || value.bytes > maximum || !validSha(value.sha256))
    throw problem('MANIFEST_INVALID', 'The original file record must contain a relative path, exact SHA256 and bounded byte count.');
  return { name, bytes: value.bytes, sha256: value.sha256 };
}
function manifestFor(source, { workspace, id, kind }) {
  identifier(workspace, 'Python workspace alias'); identifier(id, 'Export ID');
  let files;
  if (kind === 'export') {
    if (source?.schema !== 'stellar-forge.python-mcp-export.v1' || source.workspace !== workspace || source.id !== id ||
        typeof source.workspaceId !== 'string' || !source.workspaceId || typeof source.head !== 'string' || !source.head ||
        !Number.isSafeInteger(source.generation) || source.generation < 0 || source.file?.name !== 'workspace.python-workspace.json' || source.file.bytes < 1)
      throw problem('MANIFEST_INVALID', 'Select a retained original Python workspace export.');
    files = [fileDescriptor(source.file, MAX_BUNDLE_BYTES)];
  } else if (kind === 'customer') {
    const record = source?.record;
    if (source?.kind !== 'customers' || record?.id !== id || record.status !== 'COMPLETED' ||
        !Array.isArray(record.fileRecords) || !record.fileRecords.length || record.fileRecords.length > 512)
      throw problem('MANIFEST_INVALID', 'Select a completed original customer export with its retained file records.');
    files = record.fileRecords.map(file => fileDescriptor({ name: file.path, bytes: file.bytes, sha256: file.sha256 }, 32 * 1024 * 1024));
  } else throw problem('CONFIGURATION', 'Download kind must be export or customer.');
  files.sort((a, b) => a.name.localeCompare(b.name));
  const paths = new Set(files.map(file => file.name));
  if (paths.size !== files.length || files.some(file => file.name.split('/').slice(0, -1).some((_, index, parts) => paths.has(parts.slice(0, index + 1).join('/')))))
    throw problem('MANIFEST_INVALID', 'Original file paths must be unique and cannot also name parent directories.');
  // History includes the live authoring head; the completed customer record is
  // immutable and remains downloadable after later authoring revisions.
  const retainedSource = kind === 'customer' ? { kind: 'customers', record: source.record } : source;
  const manifest = { schema: MANIFEST_SCHEMA, workspace, id, kind, source: retainedSource, files };
  if (formatted(manifest).length > META_LIMIT) throw problem('MANIFEST_INVALID', 'The original completion metadata exceeds the bounded MCP response size.');
  return manifest;
}
async function regular(path, flags = constants.O_RDONLY, maximum = MAX_BUNDLE_BYTES) {
  const handle = await open(path, flags | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maximum || info.mode & 0o077)
      throw problem('PRIVATE_FILE_REQUIRED', 'Download files must be private regular files within their original byte limit.');
    return { handle, info };
  } catch (error) { await handle.close(); throw error; }
}
async function bytesAt(path, maximum = META_LIMIT) {
  const { handle } = await regular(path, constants.O_RDONLY, maximum);
  try {
    const bytes = await handle.readFile();
    if (bytes.length > maximum) throw problem('FILE_CHANGED', 'A saved file grew beyond its retained limit.');
    return bytes;
  } finally { await handle.close(); }
}
async function prefixHash(handle, length) {
  const hash = createHash('sha256'), buffer = Buffer.alloc(65536); let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, length - offset), offset);
    if (!bytesRead) throw problem('FILE_CHANGED', 'The partial file ended before its durable checkpoint.');
    hash.update(buffer.subarray(0, bytesRead)); offset += bytesRead;
  }
  return hash;
}
async function verifiedFile(path, file) {
  const { handle, info } = await regular(path, constants.O_RDONLY, file.bytes);
  try {
    if (info.size !== file.bytes || (await prefixHash(handle, info.size)).digest('hex') !== file.sha256)
      throw problem('FILE_CHANGED', 'The saved original file differs from its retained bytes: ' + file.name + '.');
  } finally { await handle.close(); }
}
async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function privateDirectory(path, create = true) {
  if (create) { try { await mkdir(path, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; } }
  await privateSupportDirectory(path);
  if (await realpath(path) !== path) throw problem('PRIVATE_DIRECTORY_REQUIRED', 'Use a canonical private path without symlink components.');
}
async function checkpoint(context) {
  context.lease.assertHeld();
  const temporary = join(context.stateDirectory, 'checkpoint.next');
  await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  await writePrivate(temporary, context.state); context.lease.assertHeld();
  await rename(temporary, join(context.stateDirectory, 'checkpoint.json')); await syncDirectory(context.stateDirectory);
}
async function installMetadata(context, destination, bytes) {
  context.lease.assertHeld();
  const temporary = join(context.stateDirectory, 'manifest.next');
  const discardTemporary = async () => {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await syncDirectory(context.stateDirectory);
  };
  try {
    if (!(await bytesAt(destination)).equals(bytes)) throw problem('EXPORT_CHANGED', 'The existing completion metadata differs from this original download.');
    await discardTemporary(); return;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await discardTemporary();
  await writePrivate(temporary, bytes); context.lease.assertHeld();
  try { await link(temporary, destination); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (!(await bytesAt(destination)).equals(bytes)) throw problem('EXPORT_CHANGED', 'The existing completion metadata differs from this original download.');
  }
  await syncDirectory(dirname(destination)); await discardTemporary();
}
async function lockedDownload(directory, operation, create = true) {
  if (typeof directory !== 'string' || !directory || directory.includes('\0') || resolve(directory) === '/')
    throw problem('CONFIGURATION', 'Choose a private directory for this original download.');
  const root = resolve(directory); await privateDirectory(root, create);
  const stateDirectory = join(root, 'download-state'), entries = await readdir(root);
  if (create && entries.length && !entries.includes('download-state'))
    throw problem('DIRECTORY_IN_USE', 'Choose an empty directory or this download’s existing directory.');
  await privateDirectory(stateDirectory, create);
  let lease;
  try { lease = await acquireStateLease(stateDirectory); }
  catch (error) { throw problem(error.message === 'FLEET_STATE_ALREADY_OWNED' ? 'BUSY' : 'LEASE_UNAVAILABLE',
    error.message === 'FLEET_STATE_ALREADY_OWNED' ? 'Another process owns this download.' : 'The download requires the original Linux flock lease (util-linux).'); }
  try { return await operation({ root, stateDirectory, lease }); }
  finally { await lease.close(); }
}
async function originalTree(directory, paths, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (!prefix && entry.name === 'download-state') continue;
    if (entry.isDirectory() && paths.some(path => path.startsWith(name + '/'))) {
      await privateDirectory(join(directory, entry.name), false);
      await originalTree(join(directory, entry.name), paths, name + '/');
    } else if (!entry.isFile() || !paths.includes(name))
      throw problem('DIRECTORY_IN_USE', 'The directory contains a path outside this original download: ' + name + '.');
  }
}
async function loadContext(context, manifest, endpoint) {
  const manifestBytes = formatted(manifest), manifestSha256 = sha(manifestBytes);
  const files = new Set(manifest.files.map(fileKey));
  await originalTree(context.root, [MANIFEST, ...manifest.files.map(file => file.name)]);
  const stateNames = new Set(['lease.lock', 'checkpoint.json', 'checkpoint.next', 'manifest.next', MANIFEST, ...[...files].map(key => key + '.part')]);
  if ((await readdir(context.stateDirectory)).some(name => !stateNames.has(name)))
    throw problem('DIRECTORY_IN_USE', 'The saved state contains files outside this original download.');
  await installMetadata(context, join(context.stateDirectory, MANIFEST), manifestBytes);
  let state;
  try { state = parse(await bytesAt(join(context.stateDirectory, 'checkpoint.json'))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (state && (state.schema !== STATE_SCHEMA || state.manifestSha256 !== manifestSha256 || !plain(state.files) ||
      endpoint !== undefined && state.endpoint !== endpoint || Object.keys(state.files).some(key => !files.has(key))))
    throw problem('CHECKPOINT_CONFLICT', 'The saved checkpoint belongs to a different original export or endpoint.');
  const resumed = Boolean(state);
  state ??= { schema: STATE_SCHEMA, manifestSha256, endpoint, files: {} };
  Object.assign(context, { manifest, manifestBytes, manifestSha256, state, resumed });
  await checkpoint(context); return context;
}
function chunkBytes(result, file, offset, limit, readId) {
  const size = Math.min(limit, file.bytes - offset);
  if (result.file?.name !== file.name || result.file.bytes !== file.bytes || result.file.sha256 !== file.sha256 ||
      !validReadId(result.readId) || readId && readId !== result.readId || result.offset !== offset ||
      result.bytesRead !== size || result.encoding !== 'base64' || result.nextOffset !== (offset + size < file.bytes ? offset + size : null) ||
      typeof result.data !== 'string') throw problem('CHUNK_CONFLICT', 'The chunk differs from its selected original file and offset.');
  const bytes = Buffer.from(result.data, 'base64');
  if (bytes.length !== size || bytes.toString('base64') !== result.data) throw problem('CHUNK_INVALID', 'The original chunk has invalid base64 or a different byte count.');
  return bytes;
}
async function persistFile(context, client, file, { chunkSize, signal, onProgress }) {
  const key = fileKey(file), destination = join(context.root, file.name), partial = join(context.stateDirectory, key + '.part');
  let parent = context.root;
  for (const part of file.name.split('/').slice(0, -1)) { parent = join(parent, part); await privateDirectory(parent); }
  try {
    await verifiedFile(destination, file);
    context.state.files[key] = { bytes: file.bytes, sha256: file.sha256, complete: true }; await checkpoint(context);
    await unlink(partial).catch(error => { if (error.code !== 'ENOENT') throw error; }); return;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const saved = context.state.files[key] ?? { bytes: 0, sha256: sha(Buffer.alloc(0)), complete: false };
  if (!plain(saved) || !Number.isSafeInteger(saved.bytes) || saved.bytes < 0 || saved.bytes > file.bytes || !validSha(saved.sha256) ||
      saved.complete !== false || saved.readId != null && !validReadId(saved.readId))
    throw problem('CHECKPOINT_CONFLICT', 'A completed or invalid checkpoint has no matching original file: ' + file.name + '.');
  let opened;
  try { opened = await regular(partial, constants.O_RDWR, file.bytes); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (saved.bytes) throw problem('FILE_CHANGED', 'A checkpointed partial file is missing.');
    const handle = await open(partial, 'wx+', 0o600); opened = { handle, info: await handle.stat() };
  }
  const { handle, info } = opened; let offset = saved.bytes, readId = saved.readId ?? null;
  try {
    const hash = await prefixHash(handle, offset);
    if (info.size < offset || hash.copy().digest('hex') !== saved.sha256) throw problem('FILE_CHANGED', 'The saved prefix differs from its durable checkpoint.');
    await handle.truncate(offset); // Discard only an interrupted write’s uncheckpointed suffix.
    while (offset < file.bytes) {
      signal?.throwIfAborted(); context.lease.assertHeld();
      const args = { workspace: context.manifest.workspace, kind: context.manifest.kind, id: context.manifest.id,
        ...(context.manifest.kind === 'customer' ? { file: file.name } : {}), expectedSha256: file.sha256, offset, limit: chunkSize,
        ...(readId ? { readId } : {}) };
      let result;
      try { result = await client.call('merchant_python_read', args); }
      catch (error) {
        if (error.code !== 'PYTHON_READ_NOT_FOUND' || !readId) throw error;
        readId = null; delete args.readId; result = await client.call('merchant_python_read', args);
      }
      const bytes = chunkBytes(result, file, offset, chunkSize, readId);
      readId = result.nextOffset === null ? null : result.readId;
      let written = 0;
      while (written < bytes.length) {
        const result = await handle.write(bytes, written, bytes.length - written, offset + written);
        if (!result.bytesWritten) throw problem('WRITE_FAILED', 'The local partial file could not advance.');
        written += result.bytesWritten;
      }
      hash.update(bytes); offset += bytes.length; await handle.sync();
      context.state.files[key] = { bytes: offset, sha256: hash.copy().digest('hex'), readId, complete: false }; await checkpoint(context);
      await onProgress?.({ workspace: context.manifest.workspace, kind: context.manifest.kind, id: context.manifest.id,
        file: file.name, bytes: offset, total: file.bytes, state: 'DOWNLOADING' });
    }
    if (hash.digest('hex') !== file.sha256) throw problem('FILE_CHANGED', 'The complete file differs from the original SHA256.');
    context.lease.assertHeld(); await link(partial, destination); await syncDirectory(dirname(destination));
    await unlink(partial); await syncDirectory(context.stateDirectory);
    context.state.files[key] = { bytes: file.bytes, sha256: file.sha256, complete: true }; await checkpoint(context);
  } finally {
    await handle.close();
    if (readId) await client.call('merchant_python_read_release', { workspace: context.manifest.workspace, readId },
      { requestSignal: null, timeoutMs: 2000 }).catch(() => {});
  }
}

/** Download a saved export, or its original customer file set. Never generates an export. */
export async function downloadPythonWorkspace({ url, workspace, id, directory, kind = 'export', tokenEnv, environment,
  signal, chunkSize = MAX_RETAINED_CHUNK_BYTES, onProgress } = {}) {
  identifier(workspace, 'Python workspace alias'); identifier(id, 'Export ID');
  if (!['export', 'customer'].includes(kind) || !Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize > MAX_RETAINED_CHUNK_BYTES)
    throw problem('CONFIGURATION', 'Choose export or customer and a chunk size from 1 to 196608 bytes.');
  const client = await openMerchantFileClient({ url, tokenEnv, environment, signal });
  const source = await client.call(kind === 'export' ? 'merchant_python_export_status' : 'merchant_python_history',
    { workspace, id, ...(kind === 'customer' ? { kind: 'customers' } : {}) });
  const manifest = manifestFor(source, { workspace, id, kind });
  return lockedDownload(directory, async context => {
    await loadContext(context, manifest, client.endpoint);
    const resumedBytes = Object.values(context.state.files).reduce((total, value) => total + (Number.isSafeInteger(value?.bytes) ? value.bytes : 0), 0);
    for (const file of manifest.files) await persistFile(context, client, file, { chunkSize, signal, onProgress });
    await installMetadata(context, join(context.root, MANIFEST), context.manifestBytes);
    await syncDirectory(context.root);
    return { schema: 'stellar-forge.python-workspace-download-result.v1', state: 'COMPLETE', workspace, id, kind,
      directory: context.root, manifestSha256: context.manifestSha256, resumed: context.resumed, resumedBytes,
      files: manifest.files, bytes: manifest.files.reduce((total, file) => total + file.bytes, 0) };
  });
}

/** Offline, create-only reopening through the original model; starts no Python or seller. */
export async function reopenDownloadedPythonWorkspace({ directory, workspaceDirectory } = {}) {
  if (typeof workspaceDirectory !== 'string' || !workspaceDirectory || workspaceDirectory.includes('\0') || resolve(workspaceDirectory) === '/')
    throw problem('CONFIGURATION', 'Supply a new private Python workspace directory.');
  const target = resolve(workspaceDirectory);
  if (await realpath(dirname(target)) !== dirname(target)) throw problem('PRIVATE_DIRECTORY_REQUIRED', 'Use the canonical workspace parent path.');
  return lockedDownload(directory, async context => {
    if (target === context.root || target.startsWith(context.root + sep))
      throw problem('CONFIGURATION', 'Keep the new native workspace outside its retained download directory.');
    const savedBytes = await bytesAt(join(context.root, MANIFEST)), saved = parse(savedBytes);
    if (saved.schema !== MANIFEST_SCHEMA || saved.kind !== 'export') throw problem('EXPORT_REQUIRED', 'Reopening requires a complete portable workspace export.');
    const manifest = manifestFor(saved.source, saved);
    if (!formatted(manifest).equals(savedBytes)) throw problem('MANIFEST_INVALID', 'The local completion metadata differs from its original file selection.');
    await loadContext(context, manifest);
    for (const file of manifest.files) await verifiedFile(join(context.root, file.name), file);
    const file = manifest.files[0];
    // importWorkspace itself creates target exclusively. An existing directory is never replaced.
    const model = await importWorkspace(target, join(context.root, file.name));
    try {
      const state = await model.state();
      if (state.workspace.id !== manifest.source.workspaceId || state.workspace.head !== manifest.source.head ||
          state.workspace.importSha256 !== file.sha256 || state.release.state.generation !== manifest.source.generation)
        throw problem('IMPORT_CONFLICT', 'The imported native workspace does not match its retained export selection.');
      return { schema: 'stellar-forge.python-workspace-reopen-result.v1', state: 'REOPENED', directory: context.root,
        workspaceDirectory: target, workspace: manifest.workspace, id: manifest.id, workspaceId: state.workspace.id,
        head: state.workspace.head, generation: state.release.state.generation, sha256: file.sha256,
        revisions: state.revisions.length, previews: state.previews.length, releases: state.staged.length,
        customerExports: state.customerExports.length };
    } finally { await model.close(); }
  }, false);
}
