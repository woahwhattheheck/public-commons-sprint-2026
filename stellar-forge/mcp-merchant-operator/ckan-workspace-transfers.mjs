// MIT. Agent selection and paged inspection of the original whole-workspace archive.
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { failure, privateSupportDirectory } from './config.mjs';
import { MAX_RETAINED_IMMUTABLE_FILE_BYTES } from './retained-file-reads.mjs';

// The native reader must accept every archive this MCP interface exports.
export const CKAN_TRANSFER_MAX_ARCHIVE_BYTES = MAX_RETAINED_IMMUTABLE_FILE_BYTES;
export const CKAN_TRANSFER_MAX_BYTES = CKAN_TRANSFER_MAX_ARCHIVE_BYTES - 67108864;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const ALIAS = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const unavailable = message => failure('CONFIGURATION_ERROR', message);
async function exists(path) {
  try { return await lstat(path); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function regular(info) {
  return info?.isFile() && !info.isSymbolicLink() && info.nlink === 1 && !(info.mode & 0o077);
}

/** Receiving aliases authorize a new sibling or the same retained receive.
 * An unrelated existing project cannot silently become a receive destination. */
export async function checkCkanProjectDeclaration(directory, receiveTarget = false) {
  if (typeof receiveTarget !== 'boolean')
    throw unavailable('receiveTarget must be a boolean.');
  directory = resolve(directory);
  if (!receiveTarget) {
    await privateSupportDirectory(directory);
    if (await realpath(directory) !== directory || !regular(await exists(directory + '/workbench.json')))
      throw unavailable('Bind each existing private original CKAN project through one canonical alias.');
    return directory;
  }
  await privateSupportDirectory(dirname(directory));
  if (await realpath(dirname(directory)) !== dirname(directory))
    throw unavailable('Declare the receiving project under its canonical private parent.');
  const current = await exists(directory);
  if (!current) return directory;
  await privateSupportDirectory(directory);
  if (await realpath(directory) !== directory || !regular(await exists(directory + '/.ckan-receive.json')))
    throw unavailable('A receiving alias selects a new directory or its existing original workspace receive.');
  return directory;
}
function identity(info) {
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1n || info.mode & 0o077n ||
      info.size < 1n || info.size > BigInt(CKAN_TRANSFER_MAX_ARCHIVE_BYTES))
    throw failure('CKAN_ARCHIVE_FILE_INVALID', 'Select the private complete workspace archive.');
  return [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].map(String).join(':');
}
async function namedIdentity(file) {
  if (await realpath(file) !== resolve(file))
    throw failure('CKAN_ARCHIVE_FILE_INVALID', 'The selected workspace archive must retain its canonical location.');
  return identity(await lstat(file, { bigint: true }));
}
export function ckanTransferSource(source) {
  return { catalogOrigin: source.catalogOrigin, projectCreatedAt: source.projectCreatedAt,
    workbenchSha256: source.workbenchSha256,
    counts: Object.fromEntries(['editions', 'sources', 'publications', 'exports', 'buyerRequests', 'refreshes']
      .map(name => [name, Array.isArray(source[name]) ? source[name].length : 0])) };
}
export function ckanTransferDescriptor(value) {
  if (!value || !UUID.test(value.id ?? '') || !SHA.test(value.sha256 ?? '') ||
      !SHA.test(value.manifestSha256 ?? '') || !Number.isSafeInteger(value.bytes) || value.bytes < 1)
    throw failure('CKAN_WORKSPACE_ARCHIVE_INVALID', 'Read the original retained archive descriptor.');
  return { archiveId: value.id, createdAt: value.createdAt, bytes: value.bytes, sha256: value.sha256,
    manifestSha256: value.manifestSha256, files: value.files, unpackedBytes: value.unpackedBytes,
    source: ckanTransferSource(value.source),
    download: { method: 'GET', path: '/api/workspace/archives/' + value.id,
      name: 'ckan-workspace-' + value.id + '.ckanw',
      mediaType: 'application/vnd.stellar-forge.ckan-workspace',
      authentication: 'Use the bearer token in this owned browserUrl fragment.' } };
}
export function ckanTransferPage(values, offset = 0, limit = 25) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw failure('INVALID_PARAMS', 'Use a nonnegative offset and a page limit from 1 through 100.');
  return { items: values.slice(offset, offset + limit), offset, limit, total: values.length,
    nextOffset: offset + limit < values.length ? offset + limit : null };
}

/** Cache one verified metadata table, never the archive payload. Concurrent
 * inspections share the same decoder; later pages check the original inode. */
export class CkanWorkspaceTransferInspections {
  #cached = null; #pending = null;
  async select(model, definition, input) {
    const hasArchive = input.archiveId !== undefined, hasInput = input.input !== undefined;
    if (hasArchive === hasInput || !SHA.test(input.expectedSha256 ?? ''))
      throw failure('INVALID_PARAMS', 'Select exactly one archiveId or input alias, with its complete expectedSha256.');
    if (hasArchive) {
      if (!UUID.test(input.archiveId))
        throw failure('INVALID_PARAMS', 'Use the retained original archive UUID.');
      const descriptor = await model.workspaceArchive(input.archiveId);
      ckanTransferDescriptor(descriptor);
      if (descriptor.sha256 !== input.expectedSha256)
        throw failure('CKAN_ARCHIVE_SELECTION_CHANGED', 'Use the exact SHA256 from the selected archive descriptor.');
      return { file: resolve(descriptor.file), expectedSha256: descriptor.sha256, archiveId: descriptor.id };
    }
    if (typeof input.input !== 'string' || !ALIAS.test(input.input))
      throw failure('INVALID_PARAMS', 'Select one declared original archive input alias.');
    const selected = definition.inputs[input.input];
    if (!selected || selected.kind !== 'workspace-archive')
      throw failure('CKAN_ARCHIVE_INPUT_NOT_CONFIGURED', 'Choose a host input declared with kind workspace-archive.');
    return { file: selected.file, expectedSha256: input.expectedSha256, input: input.input };
  }
  async openFile(model, definition, input) {
    const selected = await this.select(model, definition, input), observed = await namedIdentity(selected.file);
    const handle = await open(selected.file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const info = await handle.stat({ bigint: true });
      if (identity(info) !== observed)
        throw failure('CKAN_ARCHIVE_SELECTION_CHANGED', 'The original archive changed before its read opened.');
      // Transfer the read-only descriptor to the existing native retained-file
      // reader. It hashes the full original once and reads subsequent chunks
      // from that same descriptor without a payload copy or in-memory archive.
      return { readonlyFileHandle: handle, bytes: Number(info.size), sha256: selected.expectedSha256,
        name: selected.archiveId ? 'ckan-workspace-' + selected.archiveId + '.ckanw' : basename(selected.file),
        type: 'application/vnd.stellar-forge.ckan-workspace' };
    } catch (error) { await handle.close(); throw error; }
  }
  async inspect(model, definition, input) {
    const selected = await this.select(model, definition, input);
    const observed = await namedIdentity(selected.file);
    const key = selected.file + ':' + selected.expectedSha256 + ':' + observed;
    if (this.#cached?.key === key) return this.#cached.value;
    if (this.#pending) {
      await this.#pending.promise.catch(() => {});
      return this.inspect(model, definition, input);
    }
    const pending = {};
    pending.promise = (async () => {
      const { inspectCkanWorkspaceArchive } = await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/ckan/archive.mjs');
      const result = await inspectCkanWorkspaceArchive({ file: selected.file, expectedSha256: selected.expectedSha256 });
      if (await namedIdentity(selected.file) !== observed)
        throw failure('CKAN_ARCHIVE_SELECTION_CHANGED', 'The archive changed during its complete inspection.');
      const value = { bytes: result.bytes, sha256: result.sha256, manifestSha256: result.manifestSha256,
        unpackedBytes: result.unpackedBytes, directoryCount: result.manifest.directories.length,
        source: ckanTransferSource(result.source),
        files: result.manifest.files.map(item => ({ name: item.path, bytes: item.bytes, sha256: item.sha256 })) };
      this.#cached = { key, value };
      return value;
    })();
    this.#pending = pending;
    try { return await pending.promise; }
    finally { if (this.#pending === pending) this.#pending = null; }
  }
  clear() { this.#cached = null; }
}
