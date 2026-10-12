// MIT. Complete WQX inputs and exports in the original merchant's private file store.
import { constants } from 'node:fs';
import { mkdir, mkdtemp, open, readdir, rename, rm, lstat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import { acquireStateLease } from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import { RetainedFileReads } from './retained-file-reads.mjs';
import { failure, identifier, line, plain, writePrivate } from './host-files.mjs';
import { WQX_MAX_FILE_BYTES, wqxHash, wqxJson, wqxDigest, wqxInteger, wqxPrivateDirectory,
  wqxPrivateFile, wqxReadPrivate, wqxDescribeFile, wqxDecode } from './wqx-workspace-connection.mjs';

export const WQX_MAX_CHUNK_BYTES = 65536;
const INPUT_SCHEMA = 'stellar-forge.wqx-operator-input.v1';
const FILE_SCHEMA = 'stellar-forge.wqx-operator-file.v1';
const now = () => new Date().toISOString();
async function exists(path) {
  try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function folder(path) {
  await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  return wqxPrivateDirectory(path);
}
async function syncFolder(path) {
  const handle = await open(path, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function jsonAt(path, maximum = 65536) { return wqxDecode(await wqxReadPrivate(path, maximum)); }
export function wqxFileName(value) {
  if (typeof value !== 'string' || !value || value.length > 180 || value !== basename(value) ||
      /[\\/\x00-\x1f\x7f]/.test(value) || value === '.' || value === '..')
    throw failure('INVALID_PARAMS', 'Use one original download basename up to 180 characters.');
  return value;
}
export function wqxPage(items, { offset = 0, limit = 50, expectedSnapshot } = {}) {
  wqxInteger(offset, 0, Number.MAX_SAFE_INTEGER, 'page offset'); wqxInteger(limit, 1, 250, 'page length');
  const snapshot = wqxHash(wqxJson(items));
  if (expectedSnapshot !== undefined && wqxDigest(expectedSnapshot) !== snapshot)
    throw failure('WQX_INVENTORY_CHANGED', 'The original inventory changed. Reopen its first page.');
  if (offset > 0 && expectedSnapshot === undefined) throw failure('WQX_SNAPSHOT_REQUIRED', 'Repeat the first page snapshot for the following page.');
  if (offset > items.length) throw failure('INVALID_PARAMS', 'Choose an offset within this complete original inventory.');
  const selected = []; let bytes = 0;
  for (let i = offset; i < Math.min(offset + limit, items.length); i++) {
    const size = Buffer.byteLength(JSON.stringify(items[i]));
    if (bytes + size > 384 * 1024) {
      if (!selected.length) throw failure('WQX_PAGE_ITEM_TOO_LARGE', 'Inspect the original record at a more specific JSON pointer, or receive its complete file.');
      break;
    }
    bytes += size; selected.push(items[i]);
  }
  return { total: items.length, snapshot, offset, items: selected, nextOffset: offset + selected.length < items.length ? offset + selected.length : null };
}
const publicInput = (request, status, receivedBytes, completedAt) => ({
  inputId: request.inputId, status, name: request.name, contentType: request.contentType,
  bytes: request.bytes, sha256: request.sha256, receivedBytes,
  ...(status === 'COMPLETE' ? { inputRef: 'input:' + request.inputId, completedAt } : {}),
});
function sameRequest(request, selected) {
  return ['inputId', 'name', 'contentType', 'bytes', 'sha256'].every(key => request[key] === selected[key]);
}
export class WqxWorkspaceFiles {
  #root; #config; #reads = new RetainedFileReads({ errorPrefix: 'WQX', maxSnapshotBytes: WQX_MAX_FILE_BYTES });
  #ready; #closing = false;
  constructor(config) {
    this.#config = config.wqxWorkspaces;
    this.#root = join(config.exportsDirectory, 'wqx');
    this.#ready = (async () => {
      await wqxPrivateDirectory(config.exportsDirectory); await folder(this.#root);
      await folder(join(this.#root, 'inputs')); await folder(join(this.#root, 'files'));
      return this;
    })();
    this.#ready.catch(() => {});
  }
  get summary() { return { fileReads: this.#reads.summary, closing: this.#closing }; }
  async #active() {
    if (this.#closing) throw failure('WQX_FILES_CLOSING', 'The original file operator is closing.');
    await this.#ready;
  }
  #inputDirectory(inputId) { return join(this.#root, 'inputs', identifier(inputId, 'Input identifier')); }
  #fileDirectory(fileId) { return join(this.#root, 'files', wqxDigest(fileId, 'file identifier')); }
  async #inputRequest(inputId) {
    const directory = this.#inputDirectory(inputId); await wqxPrivateDirectory(directory);
    const request = await jsonAt(join(directory, 'request.json'));
    if (request.schema !== INPUT_SCHEMA || request.inputId !== inputId ||
        wqxHash(wqxJson(Object.fromEntries(['inputId', 'name', 'contentType', 'bytes', 'sha256'].map(key => [key, request[key]])))) !== request.requestSha256)
      throw failure('WQX_INPUT_CHANGED', 'The original input request changed.');
    return { directory, request };
  }
  async #inputState(inputId) {
    const { directory, request } = await this.#inputRequest(inputId);
    const finalPath = join(directory, 'input.bin'), partialPath = join(directory, 'partial.bin');
    const [final, partial, completed] = await Promise.all([exists(finalPath), exists(partialPath), exists(join(directory, 'complete.json'))]);
    if (final && partial || !final && !partial) throw failure('WQX_INPUT_INCOMPLETE', 'Reopen the original input begin operation to reconcile its retained file.');
    const path = final ? finalPath : partialPath, { handle, identity } = await wqxPrivateFile(path, request.bytes);
    await handle.close();
    let complete = null;
    if (completed) {
      complete = await jsonAt(join(directory, 'complete.json'));
      if (!final || complete.schema !== INPUT_SCHEMA || complete.requestSha256 !== request.requestSha256 ||
          complete.sha256 !== request.sha256 || complete.bytes !== request.bytes || Number(identity.size) !== request.bytes)
        throw failure('WQX_INPUT_CHANGED', 'The completed input differs from its original request.');
    }
    return { directory, request, path, final: Boolean(final), complete, receivedBytes: Number(identity.size) };
  }
  async inputStatus(inputId) {
    await this.#active();
    const state = await this.#inputState(inputId);
    return publicInput(state.request, state.complete ? 'COMPLETE' : 'RECEIVING', state.receivedBytes, state.complete?.completedAt);
  }
  async inputBegin(input) {
    await this.#active();
    const selected = { inputId: identifier(input.inputId, 'Input identifier'), name: wqxFileName(input.name),
      contentType: line(input.contentType ?? 'application/octet-stream', 'Input content type'),
      bytes: wqxInteger(input.bytes, 0, WQX_MAX_FILE_BYTES, 'complete input length'), sha256: wqxDigest(input.sha256) };
    const directory = await folder(this.#inputDirectory(selected.inputId)), lease = await acquireStateLease(directory);
    try {
      const path = join(directory, 'request.json');
      if (await exists(path)) {
        const { request } = await this.#inputRequest(selected.inputId);
        if (!sameRequest(request, selected)) throw failure('WQX_INPUT_ID_REUSED', 'This input identifier already belongs to a different original file.');
      } else {
        await writePrivate(path, { schema: INPUT_SCHEMA, ...selected, requestSha256: wqxHash(wqxJson(selected)), createdAt: now() });
      }
      if (!await exists(join(directory, 'input.bin')) && !await exists(join(directory, 'partial.bin'))) {
        const handle = await open(join(directory, 'partial.bin'), 'wx', 0o600);
        try { await handle.sync(); } finally { await handle.close(); }
        await syncFolder(directory);
      }
      lease.assertHeld();
      return await this.inputStatus(selected.inputId);
    } finally { await lease.close(); }
  }
  async inputAppend(input) {
    await this.#active();
    const inputId = identifier(input.inputId), expected = wqxDigest(input.sha256);
    const offset = wqxInteger(input.offset, 0, WQX_MAX_FILE_BYTES, 'input offset');
    if (typeof input.dataBase64 !== 'string' || !input.dataBase64 || input.dataBase64.length > 4 * Math.ceil(WQX_MAX_CHUNK_BYTES / 3) ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.dataBase64))
      throw failure('INVALID_PARAMS', 'Send one complete canonical base64 chunk of at most 65,536 bytes.');
    const bytes = Buffer.from(input.dataBase64, 'base64');
    if (!bytes.length || bytes.length > WQX_MAX_CHUNK_BYTES || bytes.toString('base64') !== input.dataBase64)
      throw failure('INVALID_PARAMS', 'Send the exact canonical base64 bytes of this input chunk.');
    const directory = this.#inputDirectory(inputId), lease = await acquireStateLease(directory);
    try {
      const state = await this.#inputState(inputId);
      if (state.request.sha256 !== expected) throw failure('WQX_INPUT_CHANGED', 'Use this input identifier with its original complete hash.');
      if (offset > state.receivedBytes || offset + bytes.length > state.request.bytes)
        throw Object.assign(failure('WQX_INPUT_OFFSET', 'Resume at the received byte offset from input status.'), { receivedBytes: state.receivedBytes });
      const { handle, identity } = await wqxPrivateFile(state.path, state.request.bytes, { writable: !state.complete && !state.final });
      try {
        const overlap = Math.min(bytes.length, state.receivedBytes - offset);
        if (overlap > 0) {
          const previous = Buffer.alloc(overlap); let read = 0;
          while (read < overlap) { const value = await handle.read(previous, read, overlap - read, offset + read); if (!value.bytesRead) break; read += value.bytesRead; }
          if (read !== overlap || !previous.equals(bytes.subarray(0, overlap)))
            throw failure('WQX_INPUT_CHUNK_CHANGED', 'The replayed input bytes differ from the original retained chunk.');
        }
        if (overlap < bytes.length) {
          if (state.complete || state.final) throw failure('WQX_INPUT_COMPLETE', 'Finish or reopen this original completed input.');
          let written = overlap;
          while (written < bytes.length) {
            lease.assertHeld(); const value = await handle.write(bytes, written, bytes.length - written, offset + written);
            if (!value.bytesWritten) throw failure('WQX_INPUT_WRITE_INCOMPLETE', 'The original input write did not progress.');
            written += value.bytesWritten;
          }
          await handle.sync();
          const after = await handle.stat({ bigint: true });
          if (after.dev !== identity.dev || after.ino !== identity.ino || Number(after.size) !== offset + bytes.length)
            throw failure('WQX_INPUT_CHANGED', 'The original input changed while its chunk was saved.');
        }
      } finally { await handle.close(); }
      lease.assertHeld(); return await this.inputStatus(inputId);
    } finally { await lease.close(); }
  }
  async inputFinish(input) {
    await this.#active();
    const inputId = identifier(input.inputId), expected = wqxDigest(input.sha256);
    const directory = this.#inputDirectory(inputId), lease = await acquireStateLease(directory);
    try {
      const state = await this.#inputState(inputId);
      if (state.request.sha256 !== expected) throw failure('WQX_INPUT_CHANGED', 'Use the original complete input hash.');
      if (state.receivedBytes !== state.request.bytes)
        throw Object.assign(failure('WQX_INPUT_INCOMPLETE', 'Continue the original input at its retained byte offset.'), { receivedBytes: state.receivedBytes });
      const observed = await wqxDescribeFile(state.path, WQX_MAX_FILE_BYTES, expected);
      if (observed.bytes !== state.request.bytes) throw failure('WQX_INPUT_CHANGED', 'The completed input length differs from its request.');
      if (!state.final) { lease.assertHeld(); await rename(state.path, join(directory, 'input.bin')); await syncFolder(directory); }
      if (!state.complete) {
        lease.assertHeld(); await writePrivate(join(directory, 'complete.json'), {
          schema: INPUT_SCHEMA, requestSha256: state.request.requestSha256, ...observed, completedAt: now(),
        }); await syncFolder(directory);
      }
      return await this.inputStatus(inputId);
    } finally { await lease.close(); }
  }
  inputFiles() {
    return { inputs: Object.entries(this.#config.inputs).map(([id, item]) =>
      ({ inputRef: 'host:' + id, label: item.label, bytes: item.bytes, sha256: item.sha256, contentType: item.contentType })),
      captures: Object.entries(this.#config.captures).map(([source, item]) => ({ source, label: item.label, captureSha256: item.captureSha256 })) };
  }
  async inputDescription(inputRef) {
    await this.#active();
    if (typeof inputRef !== 'string' || inputRef.length > 80) throw failure('INVALID_PARAMS', 'Choose a complete named input or retained file reference.');
    const at = inputRef.indexOf(':'), kind = inputRef.slice(0, at), id = inputRef.slice(at + 1);
    if (kind === 'host') {
      const item = this.#config.inputs[identifier(id)];
      if (!item) throw failure('WQX_INPUT_NOT_FOUND', 'Choose one of the original host-configured input files.');
      return { path: item.file, bytes: item.bytes, sha256: item.sha256, name: basename(item.file), contentType: item.contentType, inputRef };
    }
    if (kind === 'input') {
      const state = await this.#inputState(identifier(id));
      if (!state.complete) throw failure('WQX_INPUT_INCOMPLETE', 'Finish the complete original upload before applying it.');
      return { path: state.path, bytes: state.request.bytes, sha256: state.request.sha256,
        name: state.request.name, contentType: state.request.contentType, inputRef };
    }
    if (kind === 'file') {
      const file = await this.file(wqxDigest(id));
      return { path: join(this.#fileDirectory(id), 'data'), bytes: file.bytes, sha256: file.sha256, name: file.name, contentType: file.contentType, inputRef };
    }
    throw failure('INVALID_PARAMS', 'Use host:, input: or file: with its exact retained identifier.');
  }
  async readInput(inputRef, maximum = WQX_MAX_FILE_BYTES) {
    const source = await this.inputDescription(inputRef);
    if (source.bytes > maximum) throw failure('WQX_INPUT_TOO_LARGE', 'The original input exceeds this native operation limit.');
    const bytes = await wqxReadPrivate(source.path, maximum, source.sha256);
    if (bytes.length !== source.bytes) throw failure('WQX_INPUT_CHANGED', 'The complete original input length changed.');
    return bytes;
  }
  async file(fileId) {
    await this.#active();
    const directory = this.#fileDirectory(fileId); await wqxPrivateDirectory(directory);
    const value = await jsonAt(join(directory, 'file.json'));
    if (value.schema !== FILE_SCHEMA || value.fileId !== fileId ||
        wqxHash(wqxJson({ workspace: value.workspace ?? null, source: value.source, sha256: value.sha256 })) !== fileId)
      throw failure('WQX_FILE_CHANGED', 'The original retained file descriptor changed.');
    wqxDigest(value.sha256); wqxInteger(value.bytes, 0, WQX_MAX_FILE_BYTES, 'file length');
    return value;
  }
  async files(input = {}) {
    await this.#active();
    const ids = (await readdir(join(this.#root, 'files'))).filter(value => /^[0-9a-f]{64}$/.test(value)).sort();
    const result = [];
    for (const id of ids) {
      if (await exists(join(this.#fileDirectory(id), 'file.json'))) result.push(await this.file(id));
    }
    return wqxPage(result, input);
  }
  async retain({ workspace = null, source, name, contentType = 'application/octet-stream', bytes, stream, expectedBytes, assertSource }) {
    await this.#active(); wqxFileName(name); line(contentType, 'File content type');
    if (!plain(source) || Buffer.byteLength(JSON.stringify(source)) > 16384) throw failure('INVALID_PARAMS', 'Retain the compact original file source selector.');
    if ((bytes === undefined) === (stream === undefined)) throw failure('INVALID_PARAMS', 'Retain exactly one complete byte buffer or source stream.');
    if (bytes !== undefined && !Buffer.isBuffer(bytes)) throw failure('INVALID_PARAMS', 'Retain the exact original byte buffer.');
    if (expectedBytes !== undefined) wqxInteger(expectedBytes, 0, WQX_MAX_FILE_BYTES, 'complete source length');
    const temporary = await mkdtemp(join(this.#root, '.export-'));
    let handle;
    try {
      handle = await open(join(temporary, 'data'), 'wx', 0o600);
      const digest = createHash('sha256'); let total = 0;
      const chunks = bytes === undefined ? stream : [bytes];
      for await (const item of chunks) {
        const chunk = Buffer.from(item); total += chunk.length;
        if (total > WQX_MAX_FILE_BYTES || expectedBytes !== undefined && total > expectedBytes)
          throw failure('WQX_EXPORT_TOO_LARGE', 'The source exceeds its complete original export size.');
        digest.update(chunk); await handle.writeFile(chunk);
      }
      if (expectedBytes !== undefined && total !== expectedBytes) throw failure('WQX_EXPORT_INCOMPLETE', 'The complete original export was interrupted.');
      await handle.sync(); await handle.close(); handle = null;
      if (assertSource) await assertSource();
      const sha256 = digest.digest('hex'), fileId = wqxHash(wqxJson({ workspace, source, sha256 }));
      const directory = await folder(this.#fileDirectory(fileId)), lease = await acquireStateLease(directory);
      try {
        const metadataPath = join(directory, 'file.json');
        if (await exists(metadataPath)) {
          const original = await this.file(fileId);
          if (original.bytes !== total || original.sha256 !== sha256 || original.name !== name || original.contentType !== contentType)
            throw failure('WQX_EXPORT_CHANGED', 'The existing retained export differs from the same original source.');
          const observed = await wqxDescribeFile(join(directory, 'data'), WQX_MAX_FILE_BYTES, original.sha256);
          if (observed.bytes !== original.bytes) throw failure('WQX_EXPORT_CHANGED', 'The retained original export length changed.');
          return original;
        }
        const target = join(directory, 'data');
        if (await exists(target)) {
          const original = await wqxDescribeFile(target, WQX_MAX_FILE_BYTES, sha256);
          if (original.bytes !== total) throw failure('WQX_EXPORT_CHANGED', 'The interrupted export differs from this complete source.');
        } else { lease.assertHeld(); await rename(join(temporary, 'data'), target); }
        const value = { schema: FILE_SCHEMA, fileId, name, contentType, bytes: total, sha256, workspace, source, createdAt: now() };
        lease.assertHeld(); await writePrivate(metadataPath, value); await syncFolder(directory);
        return value;
      } finally { await lease.close(); }
    } finally {
      await handle?.close().catch(() => {});
      await rm(temporary, { recursive: true, force: true });
    }
  }
  async read(input) {
    await this.#active();
    const file = await this.file(input.fileId), scope = 'wqx:' + file.fileId;
    if (input.expectedSha256 !== file.sha256) throw failure('WQX_FILE_CHANGED', 'Repeat the original complete file hash.');
    return { fileId: file.fileId, ...await this.#reads.read({ scope, key: file.fileId, kind: 'wqx',
      directory: this.#root, readId: input.readId, expectedSha256: input.expectedSha256,
      offset: input.offset, limit: wqxInteger(input.limit ?? WQX_MAX_CHUNK_BYTES, 1, WQX_MAX_CHUNK_BYTES, 'file chunk length'),
      load: async () => {
        const { handle, identity } = await wqxPrivateFile(join(this.#fileDirectory(file.fileId), 'data'), WQX_MAX_FILE_BYTES);
        if (Number(identity.size) !== file.bytes) { await handle.close(); throw failure('WQX_FILE_CHANGED', 'The complete retained file length changed.'); }
        return { readonlyFileHandle: handle, bytes: file.bytes, sha256: file.sha256, name: file.name, type: file.contentType };
      },
    }) };
  }
  async release({ fileId, readId }) {
    await this.#active(); await this.file(fileId);
    await this.#reads.release('wqx:' + fileId, readId);
    return { fileId, readId, released: true };
  }
  async close() { this.#closing = true; await this.#ready; await this.#reads.close(); }
}
