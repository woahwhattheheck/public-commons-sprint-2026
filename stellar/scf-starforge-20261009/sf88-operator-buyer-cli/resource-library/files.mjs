// MIT — Read only operator-declared files bound to original completed deliveries.
import { constants } from 'node:fs';
import { open, lstat, realpath, mkdtemp, rm, unlink } from 'node:fs/promises';
import { resolve, isAbsolute, relative, sep, join } from 'node:path';
import { createHash } from 'node:crypto';

export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function requireValue(condition, code, status = 400) {
  if (!condition) throw Object.assign(new Error(code), {code, status});
}
export function absolute(path) {
  requireValue(typeof path === 'string' && isAbsolute(path) && !path.includes('\0'), 'ABSOLUTE_PATH_REQUIRED');
  return resolve(path);
}
export async function directory(path, privateOnly = false) {
  path = absolute(path);
  const st = await lstat(path);
  requireValue(st.isDirectory() && !st.isSymbolicLink() && await realpath(path) === path,
    'REAL_DIRECTORY_REQUIRED');
  requireValue(process.platform === 'win32' || ((!privateOnly || (st.mode & 0o077) === 0) &&
    (typeof process.getuid !== 'function' || st.uid === process.getuid())), 'OPERATOR_DIRECTORY_REQUIRED');
  return path;
}
export async function readSnapshot(path, maxBytes = 64 * 1024 * 1024) {
  const file = await open(absolute(path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const st = await file.stat();
    requireValue(st.isFile() && st.size <= maxBytes, 'SNAPSHOT_FILE_INVALID');
    const chunks = [], buffer = Buffer.alloc(128 * 1024);
    let total = 0;
    while (true) {
      const {bytesRead} = await file.read(buffer,0,buffer.length,total);
      if (!bytesRead) break;
      total += bytesRead; requireValue(total <= maxBytes,'SNAPSHOT_TOO_LARGE');
      chunks.push(Buffer.from(buffer.subarray(0,bytesRead)));
    }
    requireValue(same(st,await file.stat()),'SNAPSHOT_CHANGED_DURING_READ',409);
    return Buffer.concat(chunks);
  } finally { await file.close(); }
}
const inside = (path, root) => {
  const r = relative(root, path);
  return r !== '' && r !== '..' && !r.startsWith('..' + sep) && !isAbsolute(r);
};
const same = (a, b) => ['dev','ino','size','mtimeMs','ctimeMs'].every(k => a[k] === b[k]);

/** Hash the whole original file while retaining only a declared text prefix.
 * Downloads spool these same hashed bytes, avoiding a second mutable-file read. */
export async function verifyFile(record, {roots, maxFileBytes, indexBytes, tempRoot, signal,
  spool = false} = {}) {
  requireValue(record.deliveryStatus === 'SAVED', 'COMPLETED_DELIVERY_REQUIRED', 409);
  const path = absolute(record.path);
  requireValue(roots.some(root => inside(path, root)), 'FILE_OUTSIDE_DECLARED_ROOT', 403);
  requireValue(Number.isSafeInteger(record.bytes) && record.bytes >= 0 &&
    record.bytes <= maxFileBytes && /^[a-f0-9]{64}$/.test(record.sha256 ?? ''), 'DELIVERY_METADATA_INVALID');
  signal?.throwIfAborted();
  for (const root of roots.filter(root => inside(path, root))) await directory(root);
  requireValue(await realpath(path) === path, 'SYMLINK_FILE_REFUSED', 409);
  const input = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let tmp, output, success = false;
  try {
    const before = await input.stat();
    requireValue(before.isFile() && before.size === record.bytes, 'FILE_SIZE_CHANGED', 409);
    if (spool) {
      tmp = await mkdtemp(join(tempRoot, '.download-'));
      output = await open(join(tmp, 'bytes'), 'wx+', 0o600);
      if (process.platform !== 'win32') {
        // The open descriptor owns these bytes. A process crash releases the
        // storage automatically rather than abandoning a downloaded copy.
        await unlink(join(tmp,'bytes')); await rm(tmp,{recursive:true}); tmp = null;
      }
    }
    const hash = createHash('sha256'), prefix = [], buffer = Buffer.alloc(128 * 1024);
    let total = 0, retained = 0;
    while (true) {
      signal?.throwIfAborted();
      const {bytesRead} = await input.read(buffer, 0, buffer.length, total);
      if (!bytesRead) break;
      total += bytesRead;
      requireValue(total <= record.bytes && total <= maxFileBytes, 'FILE_SIZE_CHANGED', 409);
      const chunk = buffer.subarray(0, bytesRead);
      hash.update(chunk);
      if (retained < indexBytes) {
        const part = Buffer.from(chunk.subarray(0, indexBytes - retained));
        prefix.push(part); retained += part.length;
      }
      if (output) {
        let offset = 0;
        while (offset < bytesRead) {
          const write = await output.write(chunk, offset, bytesRead - offset, total - bytesRead + offset);
          requireValue(write.bytesWritten > 0, 'DOWNLOAD_WRITE_FAILED', 500);
          offset += write.bytesWritten;
        }
      }
    }
    requireValue(same(before, await input.stat()) && total === record.bytes,
      'FILE_CHANGED_DURING_READ', 409);
    requireValue(hash.digest('hex') === record.sha256, 'FILE_DIGEST_CHANGED', 409);
    signal?.throwIfAborted();
    const bytes = Buffer.concat(prefix);
    let text = null;
    try {
      // A prefix may end inside a UTF-8 character. Streaming decode omits only
      // that incomplete final sequence; complete files require a complete decode.
      text = new TextDecoder('utf-8', {fatal:true,ignoreBOM:true}).decode(bytes, {stream:total > retained});
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) text = null;
    } catch { text = null; }
    const result = {verifiedAt:new Date().toISOString(), bytes:total, sha256:record.sha256,
      text, indexedBytes:text === null ? 0 : Buffer.byteLength(text),
      coverage:text === null ? 'BINARY' : total > retained ? 'PREFIX' : 'COMPLETE'};
    if (output) {
      await output.sync();
      result.file = output;
      result.dispose = async () => {
        await output.close().catch(() => {});
        if (tmp) await rm(tmp, {recursive:true, force:true});
      };
    }
    success = true;
    return result;
  } finally {
    await input.close();
    if (!success && output) await output.close().catch(() => {});
    if (!success && tmp) await rm(tmp, {recursive:true, force:true});
  }
}
