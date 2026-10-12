// MIT. Complete CKAN workspace transfer through the original project and store owners.
import { constants } from 'node:fs';
import { open, mkdir, readdir, lstat, realpath, unlink, rename } from 'node:fs/promises';
import { basename, dirname, join, resolve, relative, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createGzip, createGunzip } from 'node:zlib';
import { Readable, Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { absolute, object, bytes, digest, identity, readPrivate, readJson, privateDirectory,
  acquireWorkspace, atomicJson, createFile, syncDirectory, fault, stamp } from '../postgres/publisher/files.mjs';
import { acquireDatasetLease } from '../dataset-refresh/writer-lease.mjs';
import { acquireReleaseLease } from '../../sf82-seller-pilot/release-process.mjs';
import { releaseStatus, installReleaseHandler, inspectReleaseInstallation } from '../../sf82-seller-pilot/releases.mjs';
import { compileQueries } from './declaration.mjs';
import { readCkanRefreshComparison } from './refresh.mjs';
import { inspectCkanMerchantPackage } from './publisher/release.mjs';
import { CKAN_SOURCE_LOCATIONS_SCHEMA, ckanWorkspaceMember } from './source-locations.mjs';

export const CKAN_WORKSPACE_ARCHIVE_SCHEMA = 'stellar-forge.ckan-workspace-archive.v1';
export const CKAN_WORKSPACE_RECEIVE_SCHEMA = 'stellar-forge.ckan-workspace-receive.v1';
const MAGIC = Buffer.from('SCF-CKAN-WORKSPACE/1\n');
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const RELEASE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const ROOTS = new Set(['editions', 'sources', 'publications', 'datasets', 'merchant-packages',
  'buyer-requests', 'seller-releases', 'transfers', 'refreshes']);
const INTERNAL = new Set(['publisher.lock', '.ckan-receive.json', 'workspace-archives', 'workspace-incoming']);
const PATH_KEYS = new Set(['directory', 'file', 'out', 'path', 'sourceFile', 'targetDirectory', 'root', 'packageDirectory']);
const exists = async path => { try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
const abort = signal => { if (signal?.aborted) throw fault('CKAN_WORKSPACE_TRANSFER_CANCELLED'); };
function limits(value = {}) {
  const maxBytes = value.maxBytes ?? 8589934592, maxFiles = value.maxFiles ?? 100000;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 1099511627776 ||
      !Number.isSafeInteger(maxFiles) || maxFiles < 1 || maxFiles > 100000)
    throw fault('CKAN_WORKSPACE_LIMITS_INVALID');
  return { maxBytes, maxFiles, maxManifestBytes: 33554432, maxArchiveBytes: maxBytes + 67108864 };
}
function projectState(value) {
  if (!object(value) || value.schema !== 'stellar-forge.ckan-workbench.v1' ||
      typeof value.catalogOrigin !== 'string' || typeof value.createdAt !== 'string')
    throw fault('CKAN_PROJECT_INVALID');
  for (const key of ['editions', 'sources', 'publications', 'exports', 'buyerRequests',
    ...(value.refreshes === undefined ? [] : ['refreshes'])]) {
    if (!Array.isArray(value[key])) throw fault('CKAN_PROJECT_INVALID');
    const ids = new Set();
    for (const item of value[key]) {
      if (!object(item) || !UUID.test(item.id ?? '') || ids.has(item.id)) throw fault('CKAN_PROJECT_ITEM_INVALID');
      ids.add(item.id);
    }
  }
  if (value.operation?.state === 'RUNNING') throw fault('CKAN_PROJECT_BUSY', 'Finish the current project operation before exporting its snapshot.', 409);
  return value;
}
async function privateFile(path, maximum) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.mode & 0o077 ||
        !Number.isSafeInteger(info.size) || info.size < 0 || info.size > maximum)
      throw fault('CKAN_WORKSPACE_FILE_INVALID', 'Use private, single-link regular files within the transfer budget.');
    return { handle, info };
  } catch (error) { await handle.close(); throw error; }
}
function unchanged(before, after) {
  return before.dev === after.dev && before.ino === after.ino && before.size === after.size &&
    before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs && after.nlink === 1;
}
async function hashFile(path, maximum, signal) {
  const { handle, info } = await privateFile(path, maximum), hash = createHash('sha256');
  let count = 0;
  try {
    for await (const part of handle.createReadStream({ autoClose: false })) {
      abort(signal); count += part.length; if (count > maximum) throw fault('CKAN_WORKSPACE_TOO_LARGE');
      hash.update(part);
    }
    if (count !== info.size || !unchanged(info, await handle.stat())) throw fault('CKAN_WORKSPACE_CHANGED');
    return { bytes: count, sha256: hash.digest('hex') };
  } finally { await handle.close(); }
}
function omitted(path) {
  const parts = path.split('/'), leaf = parts.at(-1);
  if (parts.length === 1 && INTERNAL.has(leaf)) return true;
  if (leaf === 'publisher.lock' || leaf === 'writer.lease') return true;
  if (leaf === 'writer.lock') throw fault('CKAN_LEGACY_DATASET_OWNER', 'Open and close the original dataset store to resolve its legacy writer ownership before transfer.');
  if (parts[0] === 'seller-releases') {
    if (parts.length === 2 && !['state.json', 'releases', 'ckan-packages'].includes(parts[1])) return true;
    if (parts[1] === 'releases' && parts.length === 4 && leaf === 'pilot-runtime.json') return true;
  }
  if (leaf.endsWith('.sock')) throw fault('CKAN_WORKSPACE_BUSY', 'Stop the original store listener before transferring its workspace.', 409);
  return false;
}
async function inventory(directory, stateBytes, budget, signal) {
  const files = [], directories = [], excluded = [];
  let totalBytes = 0;
  async function visit(parent, prefix = '') {
    const entries = (await readdir(parent, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const item of entries) {
      abort(signal);
      const path = prefix ? prefix + '/' + item.name : item.name;
      ckanWorkspaceMember(path);
      if (omitted(path)) { excluded.push(path); continue; }
      if (!prefix && path !== 'workbench.json' && !ROOTS.has(path))
        throw fault('CKAN_WORKSPACE_MEMBER_UNREGISTERED', 'Register the retained project member before transfer: ' + path);
      const full = join(directory, path), info = await lstat(full);
      if (info.isSymbolicLink() || await realpath(full) !== full) throw fault('CKAN_WORKSPACE_LINK_REJECTED');
      if (info.isDirectory()) {
        await privateDirectory(full); directories.push(path); await visit(full, path);
      } else {
        if (!info.isFile()) throw fault('CKAN_WORKSPACE_FILE_INVALID');
        const checked = path === 'workbench.json' ? { bytes: stateBytes.length, sha256: digest(stateBytes) } :
          await hashFile(full, budget.maxBytes - totalBytes, signal);
        totalBytes += checked.bytes;
        if (totalBytes > budget.maxBytes || files.length >= budget.maxFiles) throw fault('CKAN_WORKSPACE_TOO_LARGE');
        files.push({ path, ...checked });
      }
    }
  }
  await visit(directory);
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  directories.sort();
  if (!files.some(file => file.path === 'workbench.json')) throw fault('CKAN_PROJECT_INVALID');
  return { files, directories, totalBytes, excluded };
}
async function quiesce(directory, state) {
  const close = [];
  try {
    for (const item of [...state.publications].sort((a, b) => a.id.localeCompare(b.id))) {
      const root = join(directory, 'publications', item.id);
      if (await exists(root)) close.push(await acquireWorkspace(root));
    }
    const datasetRoot = join(directory, 'datasets');
    for (const item of (await readdir(datasetRoot, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!item.isDirectory() || !UUID.test(item.name)) throw fault('CKAN_DATASET_DIRECTORY_INVALID');
      const root = join(datasetRoot, item.name);
      if (await exists(join(root, 'state.json'))) {
        const lease = acquireDatasetLease(root); close.push(() => lease.close());
      }
    }
    const seller = join(directory, 'seller-releases');
    if (await exists(seller)) {
      for (const name of ['run.lock', 'state.lock']) {
        const lease = await acquireReleaseLease(seller, name);
        if (!lease) throw fault('LINUX_FLOCK_REQUIRED');
        close.push(() => lease.close());
      }
      const status = await releaseStatus(seller);
      if (status.runtime.state !== 'STOPPED') throw fault('CKAN_SELLER_STILL_RUNNING', 'Stop the original seller before exporting this workspace.', 409);
    }
    return async () => { for (const finish of close.reverse()) await finish(); };
  } catch (error) { for (const finish of close.reverse()) await finish(); throw error; }
}
function summary(state) {
  return { catalogOrigin: state.catalogOrigin, projectCreatedAt: state.createdAt,
    editions: state.editions.map(item => ({ id: item.id, state: item.state, manifestSha256: item.manifestSha256 ?? null })),
    sources: state.sources.map(item => ({ id: item.id, editionId: item.editionId, sha256: item.sha256, semanticReview: item.semanticReview ?? null })),
    publications: state.publications.map(item => ({ id: item.id, sourceId: item.sourceId, planId: item.planId,
      runId: item.runId, state: item.state, candidateDigest: item.run?.data?.candidate?.candidateDigest ?? null })),
    exports: state.exports.map(item => ({ id: item.id, manifestSha256: item.manifestSha256,
      snapshot: item.dataset?.snapshot, releaseId: item.staged?.release?.id ?? null,
      releaseDigest: item.staged?.release?.digest ?? null })),
    buyerRequests: state.buyerRequests.map(item => ({ id: item.id, exportId: item.exportId })),
    refreshes: (state.refreshes ?? []).map(item => ({ id: item.id, sourceId: item.sourceId,
      afterEditionId: item.afterEditionId, state: item.state, comparisonSha256: item.comparisonSha256 ?? null,
      decisionSha256: item.decisionSha256 ?? null, acceptedSourceId: item.acceptedSourceId ?? null,
      previousPublicationId: item.previousPublicationId ?? null })),
    operation: state.operation ? { id: state.operation.id, kind: state.operation.kind, state: state.operation.state } : null };
}
/** workbenchBytes is the original state captured immediately before the owning
 * native export operation begins. Its own RUNNING marker is not a saved edition. */
export async function createCkanWorkspaceArchive({ directory, out, workbenchBytes,
  projectLeaseHeld = false, signal, onProgress, ...supplied } = {}) {
  const budget = limits(supplied);
  directory = resolve(directory); out = resolve(out);
  await privateDirectory(directory); await privateDirectory(dirname(out));
  const inside = relative(directory, out);
  if (!inside.startsWith('..' + sep) && inside !== '..' && !inside.startsWith('workspace-archives' + sep))
    throw fault('CKAN_ARCHIVE_OUTPUT_SEPARATE', 'Save the transfer outside its project or in its workspace-archives directory.');
  const release = projectLeaseHeld ? null : await acquireWorkspace(directory);
  let stores, target, targetIdentity, created = false;
  try {
    const rawState = workbenchBytes ?? await readPrivate(join(directory, 'workbench.json'), 16777216);
    if (!Buffer.isBuffer(rawState)) throw fault('CKAN_ARCHIVE_STATE_INVALID');
    const state = projectState(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawState)));
    stores = await quiesce(directory, state);
    const items = await inventory(directory, rawState, budget, signal);
    const manifest = { schema: CKAN_WORKSPACE_ARCHIVE_SCHEMA, createdAt: stamp(),
      source: { directory, workbenchSha256: digest(rawState), ...summary(state) }, ...items };
    const manifestBytes = bytes(manifest), manifestSha256 = digest(manifestBytes);
    if (manifestBytes.length > budget.maxManifestBytes) throw fault('CKAN_WORKSPACE_MANIFEST_TOO_LARGE');
    const header = Buffer.alloc(MAGIC.length + 4);
    MAGIC.copy(header); header.writeUInt32BE(manifestBytes.length, MAGIC.length);
    const archiveHash = createHash('sha256'); let archiveBytes = 0, copied = 0, files = 0;
    const meter = new Transform({ transform(chunk, encoding, done) {
      archiveBytes += chunk.length;
      if (archiveBytes > budget.maxArchiveBytes) return done(fault('CKAN_WORKSPACE_TOO_LARGE'));
      archiveHash.update(chunk); done(null, chunk);
    } });
    target = await open(out, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    targetIdentity = await target.stat(); created = true;
    async function* payload() {
      yield header; yield manifestBytes;
      for (const member of manifest.files) {
        abort(signal);
        if (member.path === 'workbench.json') { yield rawState; copied += rawState.length; }
        else {
          const { handle, info } = await privateFile(join(directory, member.path), member.bytes);
          const hash = createHash('sha256'); let count = 0;
          try {
            for await (const part of handle.createReadStream({ autoClose: false })) {
              abort(signal); count += part.length; copied += part.length;
              if (count > member.bytes) throw fault('CKAN_WORKSPACE_CHANGED');
              hash.update(part); yield part;
            }
            if (count !== member.bytes || hash.digest('hex') !== member.sha256 || !unchanged(info, await handle.stat()))
              throw fault('CKAN_WORKSPACE_CHANGED', 'A retained file changed during transfer: ' + member.path);
          } finally { await handle.close(); }
        }
        files++; onProgress?.({ phase: 'EXPORTING', files, totalFiles: manifest.files.length, bytes: copied, totalBytes: manifest.totalBytes });
      }
    }
    await pipeline(Readable.from(payload()), createGzip({ level: 6 }), meter,
      new Writable({ write(chunk, encoding, done) {
        (async () => { let offset = 0; while (offset < chunk.length) {
          const result = await target.write(chunk, offset, chunk.length - offset);
          if (!result.bytesWritten) throw fault('CKAN_WORKSPACE_WRITE_FAILED'); offset += result.bytesWritten;
        } })().then(() => done(), done);
      } }), { signal });
    await target.sync(); await syncDirectory(dirname(out));
    return { schema: CKAN_WORKSPACE_ARCHIVE_SCHEMA, file: out, bytes: archiveBytes,
      sha256: archiveHash.digest('hex'), manifestSha256, createdAt: manifest.createdAt,
      source: manifest.source, files: manifest.files.length, unpackedBytes: manifest.totalBytes };
  } catch (error) {
    if (created) {
      await target?.close(); target = null;
      const current = await exists(out);
      if (current && current.dev === targetIdentity.dev && current.ino === targetIdentity.ino) await unlink(out);
    }
    throw error;
  } finally { await target?.close(); await stores?.(); await release?.(); }
}
function checkManifest(value, budget) {
  if (!object(value) || value.schema !== CKAN_WORKSPACE_ARCHIVE_SCHEMA || !object(value.source) ||
      !HASH.test(value.source.workbenchSha256 ?? '') || typeof value.source.directory !== 'string' ||
      !Array.isArray(value.files) || !value.files.length || value.files.length > budget.maxFiles ||
      !Array.isArray(value.directories) || value.directories.length > budget.maxFiles)
    throw fault('CKAN_WORKSPACE_ARCHIVE_INVALID');
  absolute(value.source.directory, 'original project directory');
  let total = 0, last = ''; const files = new Set(), dirs = new Set();
  for (const name of value.directories) {
    ckanWorkspaceMember(name);
    if (dirs.has(name) || name === 'workbench.json' || !ROOTS.has(name.split('/')[0]))
      throw fault('CKAN_WORKSPACE_ARCHIVE_INVALID');
    dirs.add(name);
  }
  for (const file of value.files) {
    ckanWorkspaceMember(file.path);
    if (file.path <= last || files.has(file.path) || dirs.has(file.path) ||
        file.path !== 'workbench.json' && !ROOTS.has(file.path.split('/')[0]) ||
        !HASH.test(file.sha256 ?? '') || !Number.isSafeInteger(file.bytes) || file.bytes < 0)
      throw fault('CKAN_WORKSPACE_ARCHIVE_INVALID');
    if (omitted(file.path)) throw fault('CKAN_WORKSPACE_RUNTIME_MEMBER');
    const parts = file.path.split('/'); parts.pop();
    while (parts.length) {
      if (!dirs.has(parts.join('/'))) throw fault('CKAN_WORKSPACE_ARCHIVE_INVALID');
      parts.pop();
    }
    files.add(file.path); last = file.path; total += file.bytes;
    if (!Number.isSafeInteger(total) || total > budget.maxBytes) throw fault('CKAN_WORKSPACE_TOO_LARGE');
  }
  for (const name of dirs) {
    const parts = name.split('/'); parts.pop();
    if (parts.length && !dirs.has(parts.join('/'))) throw fault('CKAN_WORKSPACE_ARCHIVE_INVALID');
    if (omitted(name)) throw fault('CKAN_WORKSPACE_RUNTIME_MEMBER');
  }
  const state = value.files.find(file => file.path === 'workbench.json');
  if (!state || state.bytes > 16777216 || state.sha256 !== value.source.workbenchSha256 || total !== value.totalBytes)
    throw fault('CKAN_WORKSPACE_ARCHIVE_INVALID');
  return value;
}
/** One bounded streaming decoder. Both inspect and receive verify every byte. */
async function decodeArchive(file, { expectedSha256, signal, onManifest, openMember, onProgress, ...supplied } = {}) {
  const budget = limits(supplied);
  if (expectedSha256 !== undefined && !HASH.test(expectedSha256)) throw fault('CKAN_ARCHIVE_HASH_REQUIRED');
  const { handle, info } = await privateFile(resolve(file), budget.maxArchiveBytes);
  const hash = createHash('sha256'); let compressed = 0, decompressed = 0;
  const raw = handle.createReadStream({ autoClose: false, start: 0 });
  const meter = new Transform({ transform(chunk, encoding, done) {
    compressed += chunk.length;
    if (compressed > budget.maxArchiveBytes) return done(fault('CKAN_WORKSPACE_TOO_LARGE'));
    hash.update(chunk); done(null, chunk);
  } });
  const gunzip = createGunzip(), pending = pipeline(raw, meter, gunzip);
  pending.catch(() => {});
  const iterator = gunzip[Symbol.asyncIterator](); let buffered = Buffer.alloc(0), ended = false;
  async function next() {
    abort(signal);
    const item = await iterator.next();
    if (item.done) { ended = true; return false; }
    decompressed += item.value.length;
    if (decompressed > budget.maxBytes + budget.maxManifestBytes + MAGIC.length + 4)
      throw fault('CKAN_WORKSPACE_TOO_LARGE');
    buffered = item.value; return true;
  }
  async function consume(count, write) {
    while (count > 0) {
      if (!buffered.length && !await next()) throw fault('CKAN_WORKSPACE_ARCHIVE_TRUNCATED');
      const size = Math.min(count, buffered.length), part = buffered.subarray(0, size);
      await write(part); buffered = buffered.subarray(size); count -= size;
    }
  }
  async function take(count) {
    const output = Buffer.alloc(count); let offset = 0;
    await consume(count, part => { part.copy(output, offset); offset += part.length; }); return output;
  }
  let manifest;
  const stopped = () => gunzip.destroy(fault('CKAN_WORKSPACE_TRANSFER_CANCELLED'));
  signal?.addEventListener('abort', stopped, { once: true });
  try {
    const header = await take(MAGIC.length + 4);
    if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw fault('CKAN_WORKSPACE_ARCHIVE_FORMAT');
    const length = header.readUInt32BE(MAGIC.length);
    if (length < 2 || length > budget.maxManifestBytes) throw fault('CKAN_WORKSPACE_MANIFEST_TOO_LARGE');
    const manifestBytes = await take(length);
    manifest = checkManifest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes)), budget);
    const manifestSha256 = digest(manifestBytes);
    await onManifest?.(manifest, manifestBytes, manifestSha256);
    let copied = 0, files = 0;
    for (const member of manifest.files) {
      const selected = await openMember?.(member), checked = createHash('sha256');
      try {
        await consume(member.bytes, async part => {
          abort(signal); checked.update(part); copied += part.length;
          if (selected) await selected.write(part);
        });
        if (checked.digest('hex') !== member.sha256) throw fault('CKAN_WORKSPACE_MEMBER_CHANGED', 'Archive member digest differs: ' + member.path);
        await selected?.complete();
      } catch (error) { await selected?.close(); throw error; }
      files++; onProgress?.({ phase: 'RECEIVING', files, totalFiles: manifest.files.length, bytes: copied, totalBytes: manifest.totalBytes });
    }
    if (buffered.length || !ended && await next()) throw fault('CKAN_WORKSPACE_ARCHIVE_TRAILING_BYTES');
    await pending;
    const sha256 = hash.digest('hex');
    if (compressed !== info.size || !unchanged(info, await handle.stat())) throw fault('CKAN_WORKSPACE_ARCHIVE_CHANGED');
    if (expectedSha256 !== undefined && sha256 !== expectedSha256) throw fault('CKAN_WORKSPACE_ARCHIVE_HASH_MISMATCH');
    return { schema: CKAN_WORKSPACE_ARCHIVE_SCHEMA, file: resolve(file), bytes: compressed, sha256,
      manifestSha256, manifest, files: manifest.files.length, unpackedBytes: manifest.totalBytes, source: manifest.source };
  } finally {
    signal?.removeEventListener('abort', stopped);
    raw.destroy(); meter.destroy(); gunzip.destroy();
    await pending.catch(() => {}); await handle.close();
  }
}
export async function inspectCkanWorkspaceArchive(options = {}) {
  const { file, ...rest } = options;
  return decodeArchive(file, rest);
}
async function sameMember(path, member, signal) {
  const stat = await exists(path); if (!stat) return false;
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.mode & 0o077)
    throw fault('CKAN_RECEIVE_MEMBER_CHANGED');
  if (stat.size === member.bytes) {
    const checked = await hashFile(path, member.bytes, signal);
    if (checked.sha256 === member.sha256) return true;
    throw fault('CKAN_RECEIVE_MEMBER_CHANGED', 'A completed receiving file changed: ' + member.path);
  }
  if (stat.size > member.bytes) throw fault('CKAN_RECEIVE_MEMBER_CHANGED');
  return false;
}
async function atomicRaw(directory, name, raw) {
  const path = join(directory, '.receive-write-' + randomUUID());
  await createFile(path, raw);
  try { await rename(path, join(directory, name)); await syncDirectory(directory); }
  finally { await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
async function retainedOriginal(root, history, member) {
  const raw = await readPrivate(join(root, member), 33554432), path = join(history, 'original', member);
  await privateDirectory(dirname(path), true);
  if (!await exists(path)) await createFile(path, raw);
  else if (digest(await readPrivate(path, 33554432)) !== digest(raw)) throw fault('CKAN_RECEIVE_RELOCATION_CHANGED');
  return raw;
}
function rebase(value, oldRoot, newRoot, key = '') {
  if (typeof value === 'string' && PATH_KEYS.has(key) &&
      (value === oldRoot || value.startsWith(oldRoot + '/'))) return newRoot + value.slice(oldRoot.length);
  if (Array.isArray(value)) return value.map(item => rebase(item, oldRoot, newRoot));
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, rebase(item, oldRoot, newRoot, name)]));
  return value;
}
async function relocate(root, archive, history, signal) {
  const originalState = await retainedOriginal(root, history, 'workbench.json');
  const initial = projectState(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(originalState)));
  if (digest(originalState) !== archive.manifest.source.workbenchSha256 ||
      initial.createdAt !== archive.manifest.source.projectCreatedAt || initial.catalogOrigin !== archive.manifest.source.catalogOrigin)
    throw fault('CKAN_RECEIVE_PROJECT_CHANGED');
  const state = rebase(initial, archive.manifest.source.directory, root), rewritten = [];
  const locations = { schema: CKAN_SOURCE_LOCATIONS_SCHEMA, projectCreatedAt: initial.createdAt,
    catalogOrigin: initial.catalogOrigin, sources: [] };
  const originals = new Map(archive.manifest.files.map(file => [file.path, file])), sourceConfigs = new Map();
  for (const source of state.sources) {
    abort(signal);
    const member = 'sources/' + source.id + '.json', raw = await readPrivate(join(root, member), 262144);
    if (digest(raw) !== source.sha256 || originals.get(member)?.sha256 !== source.sha256)
      throw fault('CKAN_RECEIVE_SOURCE_CHANGED');
    const config = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    const edition = state.editions.find(item => item.id === source.editionId);
    if (!edition || config.schema !== 'stellar-forge.ckan-source.v1' ||
        config.connection?.kind !== 'capture' || config.connection.sha256 !== edition.manifestSha256 ||
        config.catalogOrigin !== state.catalogOrigin ||
        originals.get('editions/' + edition.id + '/capture.json')?.sha256 !== edition.manifestSha256)
      throw fault('CKAN_RECEIVE_SOURCE_BINDING_CHANGED');
    source.file = join(root, member); sourceConfigs.set(source.id, config);
    if (typeof config.connection.file !== 'string') throw fault('CKAN_RECEIVE_SOURCE_BINDING_CHANGED');
    if (config.connection.file.startsWith('/')) locations.sources.push({ file: source.id + '.json',
      sourceSha256: source.sha256, originalCaptureFile: config.connection.file,
      captureSha256: edition.manifestSha256, captureFile: 'editions/' + edition.id + '/capture.json' });
    else if (resolve(dirname(join(root, member)), config.connection.file) !== join(root, 'editions', edition.id, 'capture.json'))
      throw fault('CKAN_RECEIVE_SOURCE_BINDING_CHANGED');
  }
  for (const refresh of state.refreshes ?? []) {
    abort(signal);
    const before = state.sources.find(item => item.id === refresh.sourceId);
    const beforeEdition = state.editions.find(item => item.id === refresh.beforeEditionId);
    const after = state.editions.find(item => item.id === refresh.afterEditionId);
    if (refresh.schema !== 'stellar-forge.ckan-reviewed-refresh.v1' || !before || !beforeEdition || !after ||
        before.sha256 !== refresh.sourceSha256 || before.editionId !== refresh.beforeEditionId ||
        beforeEdition.manifestSha256 !== refresh.beforeCaptureSha256 || after.manifestSha256 !== refresh.afterCaptureSha256)
      throw fault('CKAN_RECEIVE_REFRESH_BINDING_CHANGED');
    const member = 'refreshes/' + refresh.id + '/decision.json';
    if (!refresh.comparisonSha256) {
      if (originals.has(member) || refresh.decisionSha256) throw fault('CKAN_RECEIVE_REFRESH_DECISION_CHANGED');
      continue;
    }
    const comparison = await readCkanRefreshComparison({ directory: join(root, 'refreshes', refresh.id),
      expectedSha256: refresh.comparisonSha256 });
    if (comparison.comparison.before.manifestSha256 !== refresh.beforeCaptureSha256 ||
        comparison.comparison.after.manifestSha256 !== refresh.afterCaptureSha256 ||
        identity(comparison.comparison.keys) !== identity(refresh.keys))
      throw fault('CKAN_RECEIVE_REFRESH_BINDING_CHANGED');
    const outcome = { ACCEPTED: 'accept', KEPT_CURRENT: 'keep-current', SOURCE_WITHDRAWN: 'withdraw-source' }[refresh.state];
    if (!originals.has(member)) {
      if (refresh.decisionSha256 || outcome) throw fault('CKAN_RECEIVE_REFRESH_DECISION_CHANGED');
      continue;
    }
    // A saved decision can precede its workbench projection. Preserve and
    // validate that exact pending file so the original resume can finish it.
    const raw = await readPrivate(join(root, member), 1048576);
    const decisionSha256 = digest(raw), decision = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    if (decision.schema !== 'stellar-forge.ckan-refresh-decision.v1' ||
        refresh.decisionSha256 && decisionSha256 !== refresh.decisionSha256 ||
        outcome && (!refresh.decisionSha256 || decision.intent?.decision !== outcome) ||
        !['accept', 'keep-current', 'withdraw-source'].includes(decision.intent?.decision) ||
        decision.intent?.refreshId !== refresh.id || decision.intent?.comparisonSha256 !== refresh.comparisonSha256 ||
        decision.intent?.sourceId !== refresh.sourceId || decision.intent?.sourceSha256 !== refresh.sourceSha256 ||
        decision.intent?.afterEditionId !== refresh.afterEditionId || decision.intent?.afterCaptureSha256 !== refresh.afterCaptureSha256 ||
        decision.intent.decision === 'accept' && decision.intent.acceptedSourceId !== refresh.nextSourceId)
      throw fault('CKAN_RECEIVE_REFRESH_DECISION_CHANGED');
    if (refresh.state === 'SOURCE_WITHDRAWN') {
      const withdrawal = before.withdrawal;
      // A later explicit withdrawal can supersede an earlier one on the same
      // source. Its current pointer must still name an exact retained decision.
      if (!withdrawal || !(state.refreshes ?? []).some(item => item.id === withdrawal.refreshId &&
          item.sourceId === before.id && item.state === 'SOURCE_WITHDRAWN' &&
          item.decisionSha256 === withdrawal.decisionSha256))
        throw fault('CKAN_RECEIVE_REFRESH_DECISION_CHANGED');
    }
    if (refresh.state === 'ACCEPTED') {
      const accepted = state.sources.find(item => item.id === refresh.acceptedSourceId);
      const config = accepted && sourceConfigs.get(accepted.id);
      const query = config && compileQueries(config.queries)[accepted.query];
      if (!accepted || !query ||
          accepted.refreshId !== refresh.id || accepted.refreshDecisionSha256 !== refresh.decisionSha256 ||
          accepted.editionId !== refresh.afterEditionId || decision.intent.acceptedSourceId !== accepted.id ||
          identity({ query: accepted.query, projection: query.projection }) !== decision.intent.selection?.projectionSha256 ||
          identity(query.semanticReview ?? null) !== identity(decision.intent.selection?.semanticReview ?? null))
        throw fault('CKAN_RECEIVE_REFRESH_DECISION_CHANGED');
    }
  }
  for (const publication of state.publications) {
    const member = 'publications/' + publication.id + '/workspace.json';
    if (!originals.has(member)) continue;
    const before = await retainedOriginal(root, history, member), config = JSON.parse(before.toString('utf8'));
    const source = state.sources.find(item => item.id === publication.sourceId);
    if (!source || config.schema !== 'stellar-forge.ckan-publisher-workspace.v1') throw fault('CKAN_RECEIVE_PUBLISHER_INVALID');
    config.sourceFile = source.file; config.targetDirectory = join(root, 'datasets', publication.id);
    publication.targetDirectory = config.targetDirectory;
    await atomicJson(dirname(join(root, member)), 'workspace.json', config);
    rewritten.push({ path: member, beforeSha256: digest(before), afterSha256: digest(bytes(config)) });
  }
  for (const item of state.exports) {
    item.directory = join(root, 'merchant-packages', item.id);
    await inspectCkanMerchantPackage(item.directory, item.manifestSha256);
    if (item.staged) {
      item.staged.root = join(root, 'seller-releases');
      item.staged.packageDirectory = join(item.staged.root, 'ckan-packages', item.manifestSha256);
    }
  }
  for (const item of state.buyerRequests) {
    item.out = join(root, 'buyer-requests', item.id + '.json');
    if (typeof item.path === 'string') item.path = item.out;
  }
  if (originals.has('sources/source-locations.json')) await retainedOriginal(root, history, 'sources/source-locations.json');
  await atomicJson(join(root, 'sources'), 'source-locations.json', locations);
  await atomicJson(root, 'workbench.json', state);
  rewritten.push({ path: 'workbench.json', beforeSha256: digest(originalState), afterSha256: digest(bytes(state)) });
  const installed = [];
  const seller = join(root, 'seller-releases');
  if (await exists(seller)) {
    for (const entry of (await readdir(join(seller, 'releases'), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      abort(signal);
      if (!entry.isDirectory() || !RELEASE_ID.test(entry.name)) throw fault('CKAN_RECEIVE_RELEASE_INVALID');
      const record = await readJson(join(seller, 'releases', entry.name, 'release.json'), 4194304);
      if (record.handlerEntry) {
        const ending = /(?:^|\/)ckan-packages\/([a-f0-9]{64})\/handlers\.mjs$/.exec(record.handlerEntry.path);
        if (!ending) throw fault('CKAN_RECEIVE_RELEASE_KIND', 'This CKAN transfer requires its complete retained CKAN handler package.');
        const packageRoot = 'ckan-packages/' + ending[1];
        const checked = await inspectCkanMerchantPackage(join(seller, packageRoot), ending[1]);
        if (checked.handlerSha256 !== record.handlerEntry.sha256 || checked.handlerBytes.length !== record.handlerEntry.bytes)
          throw fault('CKAN_RECEIVE_RELEASE_HANDLER_CHANGED');
        const result = await installReleaseHandler(seller, entry.name, { expectedDigest: record.digest,
          handler: packageRoot + '/handlers.mjs', source: {
            schema: 'stellar-forge.ckan-merchant-package.v1', manifestFile: packageRoot + '/merchant-manifest.json',
            manifestSha256: ending[1] } });
        installed.push({ id: entry.name, digest: result.release.digest, installation: result.installation });
      } else await inspectReleaseInstallation(seller, entry.name);
    }
  }
  return { rewritten, installed, project: summary(state), workbenchSha256: digest(bytes(state)) };
}
/** Receive once into a new private directory. A repeated call with the same
 * archive and directory resumes that original receive under publisher.lock. */
export async function receiveCkanWorkspaceArchive({ file, directory, expectedSha256, signal, onProgress, ...supplied } = {}) {
  if (!HASH.test(expectedSha256 ?? '')) throw fault('CKAN_ARCHIVE_HASH_REQUIRED', 'Supply the SHA-256 of the complete archive.');
  directory = resolve(directory); await privateDirectory(dirname(directory));
  const marker = join(directory, '.ckan-receive.json');
  let fresh = false;
  try { await mkdir(directory, { mode: 0o700 }); fresh = true; }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  await privateDirectory(directory);
  let progress;
  if (!fresh) {
    progress = await readJson(marker, 33554432).catch(error => {
      if (error.code === 'ENOENT') throw fault('CKAN_RECEIVE_DESTINATION_EXISTS', 'Choose a new project directory.'); throw error;
    });
    if (progress.schema !== CKAN_WORKSPACE_RECEIVE_SCHEMA || progress.archiveSha256 !== expectedSha256 || progress.directory !== directory)
      throw fault('CKAN_RECEIVE_DESTINATION_EXISTS', 'This directory belongs to another project or transfer.');
  }
  const release = await acquireWorkspace(directory);
  try {
    if (fresh) {
      progress = { schema: CKAN_WORKSPACE_RECEIVE_SCHEMA, archiveSha256: expectedSha256,
        directory, state: 'RECEIVING', startedAt: stamp() };
      await createFile(marker, bytes(progress));
    } else {
      progress = await readJson(marker, 33554432).catch(error => {
        if (error.code === 'ENOENT') throw fault('CKAN_RECEIVE_DESTINATION_EXISTS', 'Choose a new project directory.'); throw error;
      });
      if (progress.schema !== CKAN_WORKSPACE_RECEIVE_SCHEMA || progress.archiveSha256 !== expectedSha256 || progress.directory !== directory)
        throw fault('CKAN_RECEIVE_DESTINATION_EXISTS', 'This directory belongs to another project or transfer.');
      if (progress.state === 'COMPLETE') {
        const state = projectState(await readJson(join(directory, 'workbench.json'), 16777216));
        if (state.createdAt !== progress.project.projectCreatedAt || state.catalogOrigin !== progress.project.catalogOrigin)
          throw fault('CKAN_RECEIVE_PROJECT_CHANGED');
        return { ...progress, reused: true };
      }
    }
    const history = join(directory, 'transfers', expectedSha256);
    let currentManifest;
    const archive = await decodeArchive(file, { ...supplied, signal, expectedSha256, onProgress,
      async onManifest(manifest, raw, manifestSha256) {
        if (progress.manifestSha256 && progress.manifestSha256 !== manifestSha256) throw fault('CKAN_RECEIVE_ARCHIVE_CHANGED');
        currentManifest = manifest;
        for (const name of [...manifest.directories].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b)))
          await privateDirectory(join(directory, name), true);
        await privateDirectory(history, true);
        const retained = join(history, 'archive-manifest.json');
        if (!await exists(retained)) await createFile(retained, raw);
        else if (digest(await readPrivate(retained, 33554432)) !== manifestSha256) throw fault('CKAN_RECEIVE_ARCHIVE_CHANGED');
        progress.manifestSha256 = manifestSha256; await atomicJson(directory, '.ckan-receive.json', progress);
      },
      async openMember(member) {
        const path = join(directory, member.path);
        if (progress.state === 'RELOCATING') return null;
        if (await sameMember(path, member, signal)) return null;
        const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
        let closed = false;
        return {
          async write(part) {
            let position = 0;
            while (position < part.length) {
              const written = await handle.write(part, position, part.length - position);
              if (!written.bytesWritten) throw fault('CKAN_RECEIVE_WRITE_FAILED');
              position += written.bytesWritten;
            }
          },
          async complete() { await handle.sync(); if (!closed) { closed = true; await handle.close(); } },
          async close() { if (!closed) { closed = true; await handle.close(); } },
        };
      },
    });
    progress.state = 'RELOCATING'; await atomicJson(directory, '.ckan-receive.json', progress);
    // Relocation can be replayed from retained originals after a lost reply.
    const originalRoot = join(history, 'original');
    if (await exists(join(originalRoot, 'workbench.json'))) {
      for (const member of ['workbench.json', ...currentManifest.files.filter(item => /^publications\/[^/]+\/workspace\.json$/.test(item.path)).map(item => item.path),
        ...(await exists(join(originalRoot, 'sources', 'source-locations.json')) ? ['sources/source-locations.json'] : [])]) {
        if (await exists(join(originalRoot, member))) {
          const raw = await readPrivate(join(originalRoot, member), 33554432);
          await atomicRaw(dirname(join(directory, member)), basename(member), raw);
        }
      }
    }
    // A resumed relocation still checks the existing durable payload, using
    // its saved pre-relocation bytes only for the explicitly mutable bindings.
    for (const member of archive.manifest.files) {
      const mutable = member.path === 'workbench.json' || member.path === 'sources/source-locations.json' ||
        /^publications\/[^/]+\/workspace\.json$/.test(member.path);
      const original = join(originalRoot, member.path);
      const path = mutable && await exists(original) ? original : join(directory, member.path);
      const checked = await hashFile(path, member.bytes, signal);
      if (checked.sha256 !== member.sha256 || checked.bytes !== member.bytes) throw fault('CKAN_RECEIVE_MEMBER_CHANGED');
    }
    const result = await relocate(directory, archive, history, signal);
    delete progress.error;
    progress = { ...progress, state: 'COMPLETE', completedAt: stamp(), archiveBytes: archive.bytes,
      files: archive.files, unpackedBytes: archive.unpackedBytes, source: archive.source, ...result };
    await atomicJson(history, 'receiving.json', progress);
    await atomicJson(directory, '.ckan-receive.json', progress); await syncDirectory(directory);
    return { ...progress, reused: false };
  } catch (error) {
    if (progress) {
      progress.error = { code: error.code ?? 'CKAN_WORKSPACE_RECEIVE_FAILED', at: stamp() };
      await atomicJson(directory, '.ckan-receive.json', progress).catch(() => {});
    }
    throw error;
  } finally { await release(); }
}
export async function assertCkanWorkspaceReceived(directory) {
  let record;
  try { record = await readJson(join(directory, '.ckan-receive.json'), 33554432); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (record.schema !== CKAN_WORKSPACE_RECEIVE_SCHEMA || record.directory !== resolve(directory) || record.state !== 'COMPLETE')
    throw fault('CKAN_WORKSPACE_RECEIVE_INCOMPLETE', 'Resume this workspace receive with its original archive and SHA-256 before opening it.', 409);
}
