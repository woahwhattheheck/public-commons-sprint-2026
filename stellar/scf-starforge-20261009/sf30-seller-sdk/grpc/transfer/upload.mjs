// MIT. Original-workspace-owned, resumable archive intake with exact chunk identity.
import { constants } from 'node:fs';
import { open, lstat, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { fields, canonical, sha256, fail, syncDirectory } from '../common.mjs';
import { GRPC_TRANSFER_ARCHIVE, GRPC_TRANSFER_ARCHIVE_BYTES, GRPC_TRANSFER_CHUNK_BYTES,
  transferId, transferSha, transferInteger } from './manifest.mjs';
import { transferDirectory, transferJson, transferWrite, hashTransferFile } from './files.mjs';

const SCHEMA = 'stellar-forge.grpc-workspace-upload.v1';
const privateFile = stat => stat.isFile() && !(stat.mode & 0o077) &&
  (typeof process.getuid !== 'function' || stat.uid === process.getuid());
const safeCode = issue => /^GRPC_TRANSFER_[A-Z0-9_]+$/.test(issue.code ?? '') ? issue.code : 'GRPC_TRANSFER_UPLOAD_FAILED';
export function createGrpcTransferUploads({ directory, assertHeld }) {
  const location = id => join(directory, transferId(id));
  async function original(id) {
    const root = location(id); await transferDirectory(root);
    const request = await transferJson(join(root, 'request.json'), 65536);
    if (!request || request.schema !== SCHEMA || request.id !== id) fail('GRPC_TRANSFER_UPLOAD_UNKNOWN', 404);
    transferSha(request.sha256); transferInteger(request.bytes, GRPC_TRANSFER_ARCHIVE_BYTES, 1);
    return { root, request };
  }
  async function status(body) {
    fields(body, ['id'], 'GRPC_TRANSFER_UPLOAD_STATUS_FIELDS_INVALID');
    const { root, request } = await original(body.id);
    const saved = await transferJson(join(root, 'record.json'), 65536);
    let position = 0, file = join(root, 'archive.part'), published = false;
    try { await lstat(join(root, GRPC_TRANSFER_ARCHIVE)); file = join(root, GRPC_TRANSFER_ARCHIVE); published = true; }
    catch (issue) { if (issue.code !== 'ENOENT') throw issue; }
    try {
      const stat = await lstat(file);
      if (!privateFile(stat) || stat.isSymbolicLink() || stat.size > request.bytes) fail('GRPC_TRANSFER_UPLOAD_CHANGED', 409);
      position = stat.size;
    } catch (issue) { if (issue.code !== 'ENOENT') throw issue; }
    const complete = published && saved?.state === 'COMPLETED' && saved.sha256 === request.sha256 &&
      saved.bytes === request.bytes && position === request.bytes;
    return { ...request, state: complete ? 'COMPLETED' : saved?.state === 'FAILED' ? 'FAILED' : 'UPLOADING',
      receivedBytes: position, nextOffset: complete ? null : position, ...(saved?.error ? { error: saved.error } : {}) };
  }
  async function chunk(body, { signal } = {}) {
    assertHeld(); fields(body, ['id', 'sha256', 'bytes', 'offset', 'base64', 'chunkSha256'],
      'GRPC_TRANSFER_UPLOAD_FIELDS_INVALID');
    const id = transferId(body.id), digest = transferSha(body.sha256),
      bytes = transferInteger(body.bytes, GRPC_TRANSFER_ARCHIVE_BYTES, 1),
      offset = transferInteger(body.offset, bytes);
    transferSha(body.chunkSha256);
    if (typeof body.base64 !== 'string' || body.base64.length > 4 * Math.ceil(GRPC_TRANSFER_CHUNK_BYTES / 3))
      fail('GRPC_TRANSFER_UPLOAD_CHUNK_TOO_LARGE', 413);
    const content = Buffer.from(body.base64, 'base64');
    if (content.toString('base64') !== body.base64 || sha256(content) !== body.chunkSha256 ||
      content.length > GRPC_TRANSFER_CHUNK_BYTES || offset + content.length > bytes ||
      !content.length && offset !== bytes) fail('GRPC_TRANSFER_UPLOAD_CHUNK_INVALID');
    const root = location(id); await transferDirectory(root, true);
    const request = { schema: SCHEMA, id, sha256: digest, bytes };
    const retained = await transferJson(join(root, 'request.json'), 65536);
    if (retained && canonical(retained) !== canonical(request)) fail('GRPC_TRANSFER_UPLOAD_ID_CONFLICT', 409);
    await transferWrite(join(root, 'request.json'), request, { exclusive: true, cap: 65536 });
    const final = join(root, GRPC_TRANSFER_ARCHIVE), partial = join(root, 'archive.part');
    let handle, published = false;
    try {
      try { handle = await open(final, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); published = true; }
      catch (issue) {
        if (issue.code !== 'ENOENT') throw issue;
        handle = await open(partial, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
      }
      const before = await handle.stat(), named = await lstat(published ? final : partial);
      if (!privateFile(before) || named.isSymbolicLink() || before.dev !== named.dev || before.ino !== named.ino ||
        before.size > bytes || offset > before.size || published && before.size !== bytes)
        fail('GRPC_TRANSFER_UPLOAD_POSITION_CHANGED', 409);
      const repeated = Math.min(content.length, Math.max(0, before.size - offset));
      const prefix = Buffer.alloc(repeated); let read = 0;
      while (read < prefix.length) {
        const next = await handle.read(prefix, read, prefix.length - read, offset + read);
        if (!next.bytesRead) fail('GRPC_TRANSFER_UPLOAD_CHANGED', 409); read += next.bytesRead;
      }
      if (!prefix.equals(content.subarray(0, repeated))) fail('GRPC_TRANSFER_UPLOAD_PREFIX_CONFLICT', 409);
      if (published && repeated !== content.length) fail('GRPC_TRANSFER_UPLOAD_CHANGED', 409);
      let written = repeated;
      while (written < content.length) {
        signal?.throwIfAborted(); assertHeld();
        const next = await handle.write(content, written, content.length - written, offset + written);
        if (!next.bytesWritten) fail('GRPC_TRANSFER_UPLOAD_WRITE_FAILED', 500); written += next.bytesWritten;
      }
      if (!published) await handle.sync();
      const after = await handle.stat();
      await handle.close(); handle = null;
      if (after.size === bytes) {
        const identity = await hashTransferFile(published ? final : partial);
        if (identity.bytes !== bytes || identity.sha256 !== digest) fail('GRPC_TRANSFER_UPLOAD_HASH_MISMATCH', 409);
        if (!published) { await rename(partial, final); await syncDirectory(root); }
        await transferWrite(join(root, 'record.json'), { ...request, state: 'COMPLETED',
          completedAt: new Date().toISOString() }, { cap: 65536 });
      } else await transferWrite(join(root, 'record.json'), { ...request, state: 'UPLOADING',
        receivedBytes: after.size, updatedAt: new Date().toISOString() }, { cap: 65536 });
      return status({ id });
    } catch (issue) {
      // An invalid repeated chunk must not replace the original accepted upload.
      // Read the actual durable record too: this same invocation may have
      // published COMPLETED immediately before a later status read failed.
      const accepted = await transferJson(join(root, 'record.json'), 65536).catch(() => null);
      if (!(accepted?.schema === SCHEMA && accepted.id === id && accepted.state === 'COMPLETED' &&
        accepted.sha256 === digest && accepted.bytes === bytes)) {
        await transferWrite(join(root, 'record.json'), { ...request, state: 'FAILED',
          error: safeCode(issue), updatedAt: new Date().toISOString() }, { cap: 65536 }).catch(() => {});
      }
      throw issue;
    } finally { await handle?.close(); }
  }
  async function archive(id) {
    const value = await status({ id });
    if (value.state !== 'COMPLETED') fail('GRPC_TRANSFER_UPLOAD_INCOMPLETE', 409);
    return { path: join(location(id), GRPC_TRANSFER_ARCHIVE), sha256: value.sha256, bytes: value.bytes };
  }
  return { status, chunk, archive };
}
