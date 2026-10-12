// MIT. Complete immutable exports from the original Huwise application.
import { constants } from 'node:fs';
import { open, mkdir, realpath, readdir, link, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { exact, failure, identifier, plain, privateSupportDirectory, writePrivate } from './host-files.mjs';
import { RetainedSourceFileReads } from './retained-source-files.mjs';
import { acquireStateLease } from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';

export const OPENDATASOFT_MANIFEST = 'opendatasoft-export.json';
export const OPENDATASOFT_EXPORT_SCHEMA = 'stellar-forge.opendatasoft-agent-export.v1';
export const OPENDATASOFT_MAX_FILE_BYTES = 512 * 1024 * 1024;
const SHA = /^[a-f0-9]{64}$/, ID = /^[a-f0-9-]{36}$/;
const NAMES = new Set(['data.json','data.csv','data.geojson','review.html','DATASET-RECEIVING.md',
  'source-declaration.json','merchant.tar.gz','MERCHANT-RECEIVING.md','buyer-request.json']);
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const fail = (code, message) => failure('OPENDATASOFT_' + code, message);
function count(value, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw fail('EXPORT_INVALID', 'The original file count or size is invalid.');
  return value;
}
export function parseOpendatasoftExport(bytes, exportId) {
  identifier(exportId, 'Export ID');
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > 65000) throw fail('EXPORT_INVALID', 'Read the complete original export manifest.');
  let value;
  try { value = JSON.parse(decode(bytes)); } catch { throw fail('EXPORT_INVALID', 'The export manifest must be complete UTF-8 JSON.'); }
  exact(value, ['schema','exportId','workspace','createdAt','source','selection','files'], ['schema','exportId','workspace','createdAt','source','selection','files']);
  identifier(value.workspace, 'Workspace alias');
  if (value.schema !== OPENDATASOFT_EXPORT_SCHEMA || value.exportId !== exportId ||
      typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt)) ||
      !plain(value.source) || !plain(value.selection) || !SHA.test(value.source.captureSha256 ?? '') ||
      !ID.test(value.source.editionId ?? '') || !Array.isArray(value.files) || value.files.length < 5 || value.files.length > NAMES.size)
    throw fail('EXPORT_INVALID', 'The completed export has an invalid original identity.');
  count(value.source.notesRevision); count(value.source.rowCount);
  const names = new Set();
  for (const file of value.files) {
    exact(file, ['name','bytes','sha256','contentType'], ['name','bytes','sha256','contentType']);
    if (!NAMES.has(file.name) || names.has(file.name) || !SHA.test(file.sha256 ?? '') ||
        typeof file.contentType !== 'string' || !file.contentType || file.contentType.length > 256)
      throw fail('EXPORT_INVALID', 'The completed export contains an invalid or repeated original file.');
    names.add(file.name); count(file.bytes, OPENDATASOFT_MAX_FILE_BYTES);
  }
  if (!['data.json','data.csv','data.geojson','review.html','DATASET-RECEIVING.md'].every(name => names.has(name)) ||
      names.has('merchant.tar.gz') !== names.has('MERCHANT-RECEIVING.md'))
    throw fail('EXPORT_INVALID', 'The export must include every analyst format and the selected merchant receiving guide.');
  return value;
}
async function privateDirectory(path, create = false) {
  path = resolve(path);
  if (create) await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  await privateSupportDirectory(path);
  if (await realpath(path) !== path) throw fail('DIRECTORY_CHANGED', 'Use the original canonical private export directory.');
  return path;
}
async function regular(path, maximum) {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maximum || process.platform !== 'win32' &&
        ((stat.mode & 0o077) || process.getuid && stat.uid !== process.getuid()))
      throw fail('FILE_CHANGED', 'Use owned private regular original export files.');
    return { handle, stat };
  } catch (error) { await handle.close(); throw error; }
}
async function bytesAt(path, maximum) {
  const { handle } = await regular(path, maximum);
  try { const bytes = await handle.readFile(); if (bytes.length > maximum) throw fail('FILE_CHANGED', 'The original file grew during reading.'); return bytes; }
  finally { await handle.close(); }
}
async function verifiedHandle(path, file) {
  const { handle, stat } = await regular(path, file.bytes);
  try {
    if (stat.size !== file.bytes) throw fail('FILE_CHANGED', 'The original file size differs from its completion manifest.');
    const before = await handle.stat({ bigint: true }), hash = createHash('sha256'), chunk = Buffer.alloc(65536);
    let offset = 0;
    while (offset < file.bytes) {
      const { bytesRead } = await handle.read(chunk, 0, Math.min(chunk.length, file.bytes - offset), offset);
      if (!bytesRead) throw fail('FILE_CHANGED', 'The original file ended before its completion manifest.');
      hash.update(chunk.subarray(0, bytesRead)); offset += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (hash.digest('hex') !== file.sha256 || ['dev','ino','size','mtimeNs','ctimeNs'].some(key => before[key] !== after[key]))
      throw fail('FILE_CHANGED', 'The original file changed from its completion manifest.');
    return handle;
  } catch (error) { await handle.close(); throw error; }
}
async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}

/** All paths are selected by the private host connection, never by agent arguments. */
export class OpendatasoftRetainedExports {
  #root; #declared; #reads = new RetainedSourceFileReads({ errorPrefix: 'OPENDATASOFT' });
  constructor(exportsDirectory, declared) { this.#root = resolve(exportsDirectory, 'opendatasoft'); this.#declared = declared; }
  get summary() { return { reads: this.#reads.summary() }; }
  async #directory(exportId, create = false) {
    identifier(exportId, 'Export ID');
    await privateDirectory(this.#root, true);
    return privateDirectory(join(this.#root, exportId), create);
  }
  async retained(exportId) {
    const directory = await this.#directory(exportId), manifestBytes = await bytesAt(join(directory, OPENDATASOFT_MANIFEST), 65000);
    const manifest = parseOpendatasoftExport(manifestBytes, exportId);
    this.#declared(manifest.workspace);
    const manifestSha256 = sha256(manifestBytes), manifestFile = {
      name: OPENDATASOFT_MANIFEST, bytes: manifestBytes.length, sha256: manifestSha256, contentType: 'application/json'
    };
    return { directory, manifest, manifestBytes, manifestSha256, manifestFile };
  }
  async manifest(exportId) {
    const value = await this.retained(exportId);
    return { state: 'MANIFEST_RETAINED', exportId, manifest: value.manifest, manifestSha256: value.manifestSha256, manifestFile: value.manifestFile };
  }
  async list({ workspace, offset = 0, limit = 50 } = {}) {
    if (workspace !== undefined) this.#declared(workspace);
    count(offset); if (count(limit, 100) < 1) throw fail('EXPORT_INVALID', 'Choose a positive page size.');
    await privateDirectory(this.#root, true);
    const rows = [];
    for (const entry of await readdir(this.#root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(entry.name)) continue;
      try {
        const item = await this.manifest(entry.name);
        if (workspace === undefined || item.manifest.workspace === workspace) rows.push(item);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    rows.sort((a,b) => b.manifest.createdAt.localeCompare(a.manifest.createdAt) || a.exportId.localeCompare(b.exportId));
    const exports = rows.slice(offset, offset + limit);
    return { exports, page: { offset, limit, total: rows.length, nextOffset: offset + exports.length < rows.length ? offset + exports.length : null } };
  }
  async retain({ exportId, workspace, source, selection, files, receive, validate }) {
    this.#declared(workspace);
    const directory = await this.#directory(exportId, true);
    const lease = await acquireStateLease(directory);
    const identity = { schema: 'stellar-forge.opendatasoft-agent-export-request.v1', exportId, workspace, source, selection,
      files: files.map(({ name, route, contentType, content }) => ({ name, ...(route ? { route } : {}), contentType, ...(content === undefined ? {} : { sha256: sha256(Buffer.from(content)) }) })) };
    try {
      lease.assertHeld();
      const requestPath = join(directory, 'request.json');
      let request;
      try { request = JSON.parse(decode(await bytesAt(requestPath, 65000))); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (request && JSON.stringify(request.identity) !== JSON.stringify(identity))
        throw fail('EXPORT_CONFLICT', 'This export ID belongs to another source, notes revision or selection. Use its original request.');
      if (!request) { request = { identity, createdAt: new Date().toISOString() }; await writePrivate(requestPath, request); await syncDirectory(directory); }
      try { return await this.manifest(exportId); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await validate();
      const completed = [];
      for (const file of files) {
        if (!NAMES.has(file.name)) throw fail('EXPORT_INVALID', 'Select a declared original native export file.');
        lease.assertHeld();
        const temporary = join(directory, '.' + file.name + '.next');
        await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
        const output = await open(temporary, 'wx', 0o600), hash = createHash('sha256');
        let bytes = 0, response;
        try {
          const iterable = file.content !== undefined ? [Buffer.from(file.content)] : (response = await receive(file)).body;
          if (!iterable) throw fail('EXPORT_TRUNCATED', 'The original application returned no file body.');
          for await (const part of iterable) {
            const chunk = Buffer.from(part); bytes += chunk.length;
            if (bytes > OPENDATASOFT_MAX_FILE_BYTES) throw fail('EXPORT_TOO_LARGE', 'This original file exceeds the 512 MiB delivery capacity.');
            lease.assertHeld(); hash.update(chunk); await output.writeFile(chunk);
          }
          const declared = response?.headers.get('content-length');
          if (declared != null && (!/^[0-9]+$/.test(declared) || Number(declared) !== bytes))
            throw fail('EXPORT_TRUNCATED', 'The complete original application file did not reach its declared byte count.');
          await output.sync();
        } finally { await output.close(); await response?.body?.cancel().catch(() => {}); }
        const metadata = { name: file.name, bytes, sha256: hash.digest('hex'), contentType: file.contentType };
        lease.assertHeld();
        try { await link(temporary, join(directory, file.name)); }
        catch (error) {
          if (error.code !== 'EEXIST') throw error;
          const existing = await verifiedHandle(join(directory, file.name), metadata); await existing.close();
        }
        await unlink(temporary); completed.push(metadata);
      }
      await validate(); lease.assertHeld();
      const manifest = { schema: OPENDATASOFT_EXPORT_SCHEMA, exportId, workspace, createdAt: request.createdAt, source, selection, files: completed };
      const manifestBytes = encode(manifest); parseOpendatasoftExport(manifestBytes, exportId);
      await writePrivate(join(directory, OPENDATASOFT_MANIFEST), manifestBytes);
      await syncDirectory(directory);
      return await this.manifest(exportId);
    } finally { await lease.close(); }
  }
  async file(args) {
    const retained = await this.retained(args.exportId);
    if (args.expectedManifestSha256 !== retained.manifestSha256) throw fail('EXPORT_CONFLICT', 'Use the inspected original completion manifest SHA256.');
    const file = args.file === OPENDATASOFT_MANIFEST ? retained.manifestFile : retained.manifest.files.find(file => file.name === args.file);
    if (!file) throw fail('FILE_NOT_FOUND', 'Select a complete original filename from this manifest.');
    return { exportId: args.exportId, manifestSha256: retained.manifestSha256,
      ...await this.#reads.read({ scope: args.exportId, key: args.file + ':' + retained.manifestSha256,
        readId: args.readId, expectedSha256: args.expectedSha256, offset: args.offset, limit: args.limit,
        load: async () => ({ handle: await verifiedHandle(join(retained.directory, file.name), file),
          filename: file.name, contentType: file.contentType, size: file.bytes, sha256: file.sha256 }) }) };
  }
  async release(exportId, readId) {
    await this.retained(exportId);
    return { exportId, readId, released: await this.#reads.release(exportId, readId) };
  }
  close() { return this.#reads.close(); }
}
