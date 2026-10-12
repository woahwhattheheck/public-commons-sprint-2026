// MIT. Complete retained-file access under the original Datasette workspace owner.
import { constants } from 'node:fs';
import { open, readdir, lstat } from 'node:fs/promises';
import { resolve, relative, sep, basename } from 'node:path';
import { absolute, hashPrivate, fault } from '../postgres/publisher/files.mjs';
import { retainedDatasetteUploads } from './uploads.mjs';

const MAX_FILE = 2 * 1024 * 1024 * 1024;
const MAX_FILES = 30000;
const HASH = /^[a-f0-9]{64}$/;
const SCHEMA = 'stellar-forge.datasette-retained-file.v1';

function signature(info) {
  return [info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs, info.mode, info.nlink].join(':');
}
function fileKind(path) {
  if (path.startsWith('captures/')) return 'source-capture';
  if (path.startsWith('editions/')) return 'source-edition';
  if (path.startsWith('publisher/plans/')) return 'publisher-plan';
  if (path.startsWith('publisher/runs/')) return 'publisher-candidate';
  if (path.startsWith('publisher/')) return 'publisher-history';
  if (path.startsWith('dataset/')) return 'dataset-version';
  if (/^(?:analysis|customer|reports)\//.test(path)) return 'customer-analysis';
  if (path.startsWith('releases/')) return 'merchant-release';
  if (path.startsWith('exports/')) return 'export';
  if (path.startsWith('imports/') || path.startsWith('receiving/')) return 'received-source';
  return 'workspace';
}
function position(input, name, fallback) {
  const value = input === undefined ? fallback : typeof input === 'string' && /^(0|[1-9][0-9]*)$/.test(input) ? Number(input) : input;
  if (!Number.isSafeInteger(value) || value < 0) throw fault('DATASETTE_FILE_RANGE_INVALID', 'Use a non-negative ' + name + '.');
  return value;
}
function checkedFile(info) {
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.mode & 0o077 || info.size > MAX_FILE)
    throw fault('DATASETTE_PRIVATE_FILE_REQUIRED');
}
const nativeServiceMember = path => path === 'dataset/control.json' || path === 'dataset/control.sock';
function internalTransient(name) {
  return name.endsWith('.lock') || name.endsWith('.sock') || name.endsWith('.pid') ||
    name.endsWith('-shm') || name.endsWith('-wal') || name.startsWith('.source-archive-stage-');
}

export function retainedDatasetteFiles({ directory, workspaceId }) {
  directory = absolute(directory, 'Datasette workspace directory');
  const cache = new Map();

  async function locate(name) {
    if (typeof name !== 'string' || !name || name.length > 4096 || name.includes('\\') || name.includes('\0') ||
        name.startsWith('/') || name.split('/').some(part => !part || part === '.' || part === '..'))
      throw fault('DATASETTE_FILE_PATH_INVALID', 'Select a relative file from this workspace.');
    const path = resolve(directory, name);
    if (!path.startsWith(directory + sep)) throw fault('DATASETTE_FILE_PATH_INVALID');
    let ancestor = directory;
    const parts = name.split('/');
    for (const part of parts.slice(0, -1)) {
      ancestor += sep + part;
      const info = await lstat(ancestor);
      if (!info.isDirectory() || info.isSymbolicLink() || info.mode & 0o077)
        throw fault('DATASETTE_PRIVATE_DIRECTORY_REQUIRED');
    }
    if (nativeServiceMember(name) || internalTransient(parts.at(-1))) throw fault('DATASETTE_FILE_NOT_RETAINED', 'Select a retained source, result or export file.');
    const info = await lstat(path);
    checkedFile(info);
    return { path, info };
  }
  async function inspect({ path: name, sha256 } = {}) {
    const current = await locate(name), key = signature(current.info);
    let pin = cache.get(name);
    if (!pin || pin.signature !== key) {
      const hashed = await hashPrivate(current.path, MAX_FILE);
      const after = await lstat(current.path);
      checkedFile(after);
      if (signature(after) !== key) throw fault('DATASETTE_FILE_CHANGED', 'Read this file again after its writer completes.', 409);
      pin = { signature: key, sha256: hashed.hash, bytes: String(hashed.bytes) };
      if (cache.size >= MAX_FILES) cache.clear();
      cache.set(name, pin);
    }
    if (sha256 !== undefined && (!HASH.test(sha256) || sha256 !== pin.sha256))
      throw fault('DATASETTE_FILE_CHANGED', 'Select the current retained file identity.', 409);
    return { schema: SCHEMA, workspaceId, path: name, name: basename(name),
      bytes: pin.bytes, sha256: pin.sha256, kind: fileKind(name), modifiedAt: current.info.mtime.toISOString() };
  }
  async function list(input = {}) {
    const offset = position(input.offset, 'file offset', 0);
    const limit = position(input.limit, 'page size', 100);
    if (limit < 1 || limit > 250) throw fault('DATASETTE_FILE_PAGE_INVALID');
    const prefix = input.prefix ?? '';
    if (typeof prefix !== 'string' || prefix.startsWith('/') || prefix.includes('\\') ||
        prefix.split('/').some(part => part === '.' || part === '..'))
      throw fault('DATASETTE_FILE_PATH_INVALID');
    const names = [];
    async function visit(path) {
      const entries = await readdir(path, { withFileTypes: true });
      for (const entry of entries) {
        const next = resolve(path, entry.name);
        const name = relative(directory, next).split(sep).join('/');
        if (entry.isSymbolicLink() || internalTransient(entry.name) || nativeServiceMember(name)) continue;
        if (entry.isDirectory()) await visit(next);
        else if (entry.isFile()) {
          if (name.startsWith(prefix)) names.push(name);
          if (names.length > MAX_FILES) throw fault('DATASETTE_FILE_INVENTORY_LIMIT');
        }
      }
    }
    await visit(directory); names.sort();
    const files = [];
    for (const name of names.slice(offset, offset + limit)) files.push(await inspect({ path: name }));
    return { workspaceId, files, page: { offset, limit, total: names.length,
      next: offset + files.length < names.length ? offset + files.length : null,
      previous: offset > 0 ? Math.max(0, offset - limit) : null } };
  }
  async function read(input = {}) {
    if (!HASH.test(input.sha256 ?? '')) throw fault('DATASETTE_FILE_HASH_REQUIRED');
    const meta = await inspect(input);
    const offset = position(input.offset, 'byte offset', 0);
    const limit = position(input.limit, 'byte length', 65536);
    if (limit < 1 || limit > 262144 || offset > Number(meta.bytes)) throw fault('DATASETTE_FILE_RANGE_INVALID');
    const current = await locate(input.path);
    const retained = cache.get(input.path);
    const handle = await open(current.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = await handle.stat();
      checkedFile(before);
      if (signature(before) !== retained.signature) throw fault('DATASETTE_FILE_CHANGED', undefined, 409);
      const count = Math.min(limit, before.size - offset), buffer = Buffer.alloc(count);
      let total = 0;
      while (total < count) {
        const { bytesRead } = await handle.read(buffer, total, count - total, offset + total);
        if (!bytesRead) throw fault('DATASETTE_FILE_CHANGED', undefined, 409);
        total += bytesRead;
      }
      const after = await handle.stat(), final = await lstat(current.path);
      if (signature(after) !== retained.signature || signature(final) !== retained.signature)
        throw fault('DATASETTE_FILE_CHANGED', undefined, 409);
      const nextOffset = offset + total;
      return { ...meta, offset: String(offset), length: String(total), encoding: 'base64', data: buffer.toString('base64'),
        complete: nextOffset === before.size, nextOffset: nextOffset < before.size ? String(nextOffset) : null };
    } finally { await handle.close(); }
  }
  function relativeName(path) {
    path = absolute(path, 'retained file');
    const name = relative(directory, path).split(sep).join('/');
    if (!name || name.startsWith('../') || name.startsWith('/')) throw fault('DATASETTE_FILE_PATH_INVALID');
    return name;
  }
  const uploads = retainedDatasetteUploads({ directory, workspaceId, inspect });
  return Object.freeze({ inspect, list, read, relativeName,
    uploadStatus: uploads.status, receiveUpload: uploads.receive, close: uploads.close });
}
