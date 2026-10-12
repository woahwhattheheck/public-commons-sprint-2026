// MIT. Complete private operator client and bounded, resumable archive transport.
import { constants } from 'node:fs';
import { open, lstat, readdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { acquireStateLease } from '../../../merchant-fleet-gateway/state-lease.mjs';
import { canonical, sha256, fail, syncDirectory } from '../common.mjs';
import { GRPC_TRANSFER_ARCHIVE, GRPC_TRANSFER_MANIFEST, GRPC_TRANSFER_MANIFEST_BYTES,
  GRPC_TRANSFER_ARCHIVE_BYTES, GRPC_TRANSFER_CHUNK_BYTES, transferId, transferSha, transferInteger,
  transferDescriptor, validateGrpcTransferManifest } from './manifest.mjs';
import { transferDirectory, transferRead, transferJson, transferWrite, hashTransferFile } from './files.mjs';

const ROUTES = new Set(['capture', 'read', 'list', 'files', 'chunk', 'upload', 'upload-status', 'inspect',
  'receive', 'receipt', 'open', 'close', 'cancel', 'download']);
const privateFile = info => info.isFile() && !(info.mode & 0o077) &&
  (typeof process.getuid !== 'function' || info.uid === process.getuid());
async function responseBytes(response, maximum) {
  const chunks = []; let bytes = 0;
  for await (const chunk of response.body ?? []) {
    bytes += chunk.length;
    if (bytes > maximum) fail('GRPC_TRANSFER_RESPONSE_TOO_LARGE', 413);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, bytes);
}
export function createGrpcTransferClient({ url, fetch: transport = globalThis.fetch, timeoutMs = 3600000 } = {}) {
  let selected;
  try { selected = new URL(url); } catch { fail('GRPC_TRANSFER_CONNECTION_REQUIRED'); }
  if (selected.protocol !== 'http:' || selected.hostname !== '127.0.0.1' || !selected.port ||
    selected.username || selected.password || selected.pathname !== '/' || selected.search || !/^#[a-f0-9]{64}$/.test(selected.hash))
    fail('GRPC_TRANSFER_CONNECTION_INVALID');
  transferInteger(timeoutMs, 86400000, 1000);
  const origin = selected.origin, token = selected.hash.slice(1), active = new Set(), controllers = new Set();
  let closing = false, closePromise;
  function request(action, body, { binary = false, signal } = {}) {
    if (closing) return Promise.reject(Object.assign(new Error('GRPC_TRANSFER_CLIENT_CLOSED'), { code: 'GRPC_TRANSFER_CLIENT_CLOSED' }));
    if (!ROUTES.has(action) && action !== 'manifest-file') fail('GRPC_TRANSFER_ACTION_INVALID');
    const payload = JSON.stringify(body ?? {});
    if (Buffer.byteLength(payload) > 2097152) fail('GRPC_TRANSFER_REQUEST_TOO_LARGE', 413);
    const controller = new AbortController(); controllers.add(controller);
    const promise = (async () => {
      const response = await transport(origin + '/api/transfer-' + action, { method: 'POST', redirect: 'error',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]),
        headers: { 'content-type': 'application/json', 'x-workspace-token': token, origin }, body: payload });
      if (!response.ok) {
        let value = {};
        try { value = JSON.parse((await responseBytes(response, 65536)).toString('utf8')); } catch {}
        const code = /^[A-Z][A-Z0-9_]+$/.test(value.error ?? '') ? value.error : 'GRPC_TRANSFER_REQUEST_FAILED';
        throw Object.assign(new Error(String(value.detail ?? code).split(token).join('[private capability]').slice(0, 1200)),
          { code, status: response.status });
      }
      const bytes = await responseBytes(response, GRPC_TRANSFER_MANIFEST_BYTES + 524288);
      if (binary) {
        if (response.headers.get('content-length') !== String(bytes.length) ||
          response.headers.get('x-content-sha256') !== sha256(bytes)) fail('GRPC_TRANSFER_FILE_CHANGED', 409);
        return bytes;
      }
      try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
      catch { fail('GRPC_TRANSFER_RESPONSE_INVALID', 409); }
    })().finally(() => controllers.delete(controller));
    active.add(promise); void promise.finally(() => active.delete(promise)).catch(() => {});
    return promise;
  }
  function own(operation, signal) {
    if (closing) return Promise.reject(Object.assign(new Error('GRPC_TRANSFER_CLIENT_CLOSED'), { code: 'GRPC_TRANSFER_CLIENT_CLOSED' }));
    const controller = new AbortController(); controllers.add(controller);
    const joined = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
    const promise = Promise.resolve().then(() => { joined.throwIfAborted(); return operation(joined); })
      .finally(() => controllers.delete(controller));
    active.add(promise); void promise.finally(() => active.delete(promise)).catch(() => {});
    return promise;
  }
  const client = {
    request(action, body = {}, options) { return request(action, body, options); },
    manifestFile(body, options = {}) { return request('manifest-file', body, { ...options, binary: true }); },
    uploadFile(input, options = {}) {
      return own(signal => uploadGrpcTransferArchive(client, input, { ...options, signal }), options.signal);
    },
    downloadTo(input, options = {}) {
      return own(signal => downloadGrpcTransferArchive(client, input, { ...options, signal }), options.signal);
    },
    close() {
      if (!closePromise) {
        closing = true; for (const controller of controllers) controller.abort();
        closePromise = Promise.allSettled([...active]).then(() => {});
      }
      return closePromise;
    },
  };
  return Object.freeze(client);
}
export async function uploadGrpcTransferArchive(client, { id, path, expectedSha256, expectedBytes }, { signal, progress = () => {} } = {}) {
  transferId(id);
  const identity = await hashTransferFile(path, GRPC_TRANSFER_ARCHIVE_BYTES, { signal });
  if (expectedSha256 !== undefined && transferSha(expectedSha256) !== identity.sha256 ||
    expectedBytes !== undefined && transferInteger(expectedBytes, GRPC_TRANSFER_ARCHIVE_BYTES, 1) !== identity.bytes)
    fail('GRPC_TRANSFER_UPLOAD_SOURCE_CHANGED', 409);
  let state;
  try { state = await client.request('upload-status', { id }, { signal }); }
  catch (issue) { if (issue.code !== 'ENOENT' && issue.status !== 404) throw issue; }
  if (state && (state.sha256 !== identity.sha256 || state.bytes !== identity.bytes))
    fail('GRPC_TRANSFER_UPLOAD_ID_CONFLICT', 409);
  if (state?.state === 'COMPLETED') return state;
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const original = await handle.stat();
    if (!privateFile(original) || original.size !== identity.bytes) fail('GRPC_TRANSFER_UPLOAD_SOURCE_CHANGED', 409);
    let offset = state?.receivedBytes ?? 0;
    while (offset <= identity.bytes) {
      signal?.throwIfAborted();
      const length = Math.min(GRPC_TRANSFER_CHUNK_BYTES, identity.bytes - offset), bytes = Buffer.alloc(length);
      let read = 0;
      while (read < length) {
        const next = await handle.read(bytes, read, length - read, offset + read);
        if (!next.bytesRead) fail('GRPC_TRANSFER_UPLOAD_SOURCE_CHANGED', 409); read += next.bytesRead;
      }
      state = await client.request('upload', { id, ...identity, offset, base64: bytes.toString('base64'),
        chunkSha256: sha256(bytes) }, { signal });
      if (state.sha256 !== identity.sha256 || state.bytes !== identity.bytes ||
        !Number.isSafeInteger(state.receivedBytes) || state.receivedBytes < offset + length ||
        state.receivedBytes > identity.bytes) fail('GRPC_TRANSFER_UPLOAD_POSITION_CHANGED', 409);
      await progress(state);
      if (state.state === 'COMPLETED') break;
      if (state.receivedBytes === offset) fail('GRPC_TRANSFER_UPLOAD_NO_PROGRESS', 409);
      offset = state.receivedBytes;
    }
    const after = await handle.stat(), named = await lstat(path);
    if (original.dev !== after.dev || original.ino !== after.ino || after.dev !== named.dev || after.ino !== named.ino ||
      named.isSymbolicLink() || original.size !== after.size || original.mtimeMs !== after.mtimeMs || original.ctimeMs !== after.ctimeMs)
      fail('GRPC_TRANSFER_UPLOAD_SOURCE_CHANGED', 409);
    return state;
  } finally { await handle.close(); }
}
export async function downloadGrpcTransferArchive(client, { id, expectedManifestSha256, directory },
  { signal, progress = () => {} } = {}) {
  transferId(id); transferSha(expectedManifestSha256);
  await transferDirectory(directory, true);
  const lease = await acquireStateLease(directory); let handle;
  try {
    const allowed = new Set(['lease.lock', 'transfer-download.json', GRPC_TRANSFER_ARCHIVE, GRPC_TRANSFER_ARCHIVE + '.part', GRPC_TRANSFER_MANIFEST]);
    for (const name of await readdir(directory)) if (!allowed.has(name)) fail('GRPC_TRANSFER_DOWNLOAD_DIRECTORY_IN_USE', 409);
    const selected = transferDescriptor(await client.request('read', { id }, { signal }));
    if (selected.manifestSha256 !== expectedManifestSha256) fail('GRPC_TRANSFER_MANIFEST_CHANGED', 409);
    const identity = { schema: 'stellar-forge.grpc-workspace-download.v1', id,
      sha256: selected.sha256, bytes: selected.bytes, manifestSha256: selected.manifestSha256 };
    const saved = await transferJson(join(directory, 'transfer-download.json'), 131072);
    if (saved && canonical(saved) !== canonical(identity)) fail('GRPC_TRANSFER_DOWNLOAD_ID_CONFLICT', 409);
    await transferWrite(join(directory, 'transfer-download.json'), identity, { exclusive: true, cap: 131072 });
    const manifestBytes = await client.manifestFile({ id, expectedManifestSha256 }, { signal });
    const manifest = validateGrpcTransferManifest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes)));
    if (manifest.id !== id || manifest.sha256 !== expectedManifestSha256) fail('GRPC_TRANSFER_MANIFEST_CHANGED', 409);
    const manifestPath = join(directory, GRPC_TRANSFER_MANIFEST);
    try {
      if (!(await transferRead(manifestPath)).equals(manifestBytes)) fail('GRPC_TRANSFER_MANIFEST_CHANGED', 409);
    } catch (issue) { if (issue.code !== 'ENOENT') throw issue; await transferWrite(manifestPath, manifestBytes); }
    const final = join(directory, GRPC_TRANSFER_ARCHIVE), partial = final + '.part';
    try {
      const existing = await hashTransferFile(final);
      if (canonical(existing) !== canonical({ sha256: selected.sha256, bytes: selected.bytes }))
        fail('GRPC_TRANSFER_DOWNLOAD_CHANGED', 409);
      return { ...selected, directory, archivePath: final, reused: true };
    } catch (issue) { if (issue.code !== 'ENOENT') throw issue; }
    handle = await open(partial, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
    const before = await handle.stat();
    if (!privateFile(before) || before.size > selected.bytes) fail('GRPC_TRANSFER_DOWNLOAD_CHANGED', 409);
    // Replay and compare the already-retained prefix; a resumed receiver never
    // skips unverifiable bytes because its last process stopped mid-write.
    let offset = 0;
    while (offset < selected.bytes) {
      signal?.throwIfAborted(); lease.assertHeld();
      const value = await client.request('chunk', { id, expectedManifestSha256, offset, limit: GRPC_TRANSFER_CHUNK_BYTES }, { signal });
      const bytes = Buffer.from(value.base64 ?? '', 'base64');
      const end = offset + bytes.length;
      if (value.id !== id || value.manifestSha256 !== expectedManifestSha256 || value.sha256 !== selected.sha256 ||
        value.bytes !== selected.bytes || value.offset !== offset || value.bytesRead !== bytes.length ||
        !bytes.length || bytes.length > GRPC_TRANSFER_CHUNK_BYTES || end > selected.bytes ||
        bytes.toString('base64') !== value.base64 || sha256(bytes) !== value.chunkSha256 ||
        value.nextOffset !== (end < selected.bytes ? end : null)) fail('GRPC_TRANSFER_CHUNK_CHANGED', 409);
      const exists = Math.max(0, Math.min(bytes.length, before.size - offset)), prefix = Buffer.alloc(exists);
      let copied = 0;
      while (copied < exists) {
        const next = await handle.read(prefix, copied, exists - copied, offset + copied);
        if (!next.bytesRead) fail('GRPC_TRANSFER_DOWNLOAD_CHANGED', 409); copied += next.bytesRead;
      }
      if (!prefix.equals(bytes.subarray(0, exists))) fail('GRPC_TRANSFER_DOWNLOAD_PREFIX_CONFLICT', 409);
      let written = exists;
      while (written < bytes.length) {
        const next = await handle.write(bytes, written, bytes.length - written, offset + written);
        if (!next.bytesWritten) fail('GRPC_TRANSFER_DOWNLOAD_WRITE_FAILED', 500); written += next.bytesWritten;
      }
      await handle.sync(); offset = end; await progress({ id, bytes: selected.bytes, receivedBytes: offset });
    }
    await handle.close(); handle = null;
    const actual = await hashTransferFile(partial);
    if (actual.sha256 !== selected.sha256 || actual.bytes !== selected.bytes) fail('GRPC_TRANSFER_DOWNLOAD_CHANGED', 409);
    await rename(partial, final); await syncDirectory(directory);
    return { ...selected, directory, archivePath: final, reused: false };
  } finally { await handle?.close(); await lease.close(); }
}
