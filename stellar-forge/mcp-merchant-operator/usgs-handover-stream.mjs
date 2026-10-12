// MIT. Stream one selected original handover into the original Water receiver.
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { USGS_MAX_HANDOVER_BYTES } from './usgs-delivery.mjs';

const failure = message => Object.assign(new Error(message), { code: 'USGS_FILE_CHANGED' });
const same = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size &&
  a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;

/** The selected hash is checked before EOF reaches the original publishing receiver. */
export async function openUSGSHandoverStream(path, { sha256, bytes, signal } = {}) {
  if (typeof path !== 'string' || !path || path.includes('\0') || !/^[0-9a-f]{64}$/.test(sha256 ?? '') ||
      bytes !== undefined && (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > USGS_MAX_HANDOVER_BYTES))
    throw failure('Select the complete original handover path, SHA256 and optional exact byte count.');
  path = resolve(path); signal?.throwIfAborted();
  if (await realpath(dirname(path)) !== dirname(path)) throw failure('The original handover parent changed.');
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  let before;
  try {
    before = await file.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size < 1n || before.size > BigInt(USGS_MAX_HANDOVER_BYTES) ||
        process.platform !== 'win32' && (before.mode & 0o077n) || bytes !== undefined && before.size !== BigInt(bytes))
      throw failure('Use the selected private original regular handover with its exact byte count.');
    signal?.throwIfAborted();
  } catch (error) { await file.close(); throw error; }
  let stream, closing, closed = false;
  const abort = () => stream.destroy(signal.reason instanceof Error ? signal.reason : failure('The handover receiving operation was cancelled.'));
  function release() {
    if (!closing) { signal?.removeEventListener('abort', abort); closing = file.close(); }
    return closing;
  }
  function close() { closed = true; stream?.destroy(); return release(); }
  stream = Readable.from((async function* () {
    const digest = createHash('sha256'), buffer = Buffer.alloc(65536); let offset = 0;
    try {
      while (offset < Number(before.size)) {
        signal?.throwIfAborted();
        if (closed || !same(before, await file.stat({ bigint: true }))) throw failure('The original handover changed during receiving.');
        const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, Number(before.size) - offset), offset);
        if (!bytesRead) throw failure('The original handover ended before its retained byte count.');
        const chunk = Buffer.from(buffer.subarray(0, bytesRead));
        digest.update(chunk); offset += bytesRead; yield chunk;
      }
      if (!same(before, await file.stat({ bigint: true })) || digest.digest('hex') !== sha256)
        throw failure('The received stream differs from the selected complete original handover SHA256.');
    } finally { closed = true; await release(); }
  })(), { objectMode: false, highWaterMark: 65536 });
  // The original receiver may await its native lease before consuming the stream.
  // Keep cancellation as the stream's retained error until that consumer attaches.
  stream.on('error', () => {});
  signal?.addEventListener('abort', abort, { once: true });
  return { stream, close, bytes: Number(before.size), sha256 };
}
