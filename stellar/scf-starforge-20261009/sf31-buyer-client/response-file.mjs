// MIT License. Save one already-returned buyer response; never send a request.
import { createHash, randomUUID } from 'node:crypto';
import { open, lstat, realpath, link, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

export class BuyerResponseFileError extends Error {
  constructor(code, detail = '', { cause, bytes = 0, partialPath = null, cleanupWarnings = [] } = {}) {
    super(`${code}${detail ? ': ' + detail : ''}`, { cause });
    this.name = 'BuyerResponseFileError';
    this.code = code;
    this.bytes = bytes;
    this.partialPath = partialPath;
    this.cleanupWarnings = cleanupWarnings;
  }
}

/** Local expectations are supplied before purchase, never learned from the
 * response's digest header. This validates content consistency, not seller identity. */
export function validateResponseFileIntegrity({ expectedSha256, expectedBytes,
  expectedContentType } = {}, maxBytes = Number.MAX_SAFE_INTEGER) {
  const pins = {};
  if (expectedSha256 !== undefined) {
    if (typeof expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(expectedSha256))
      throw new BuyerResponseFileError('BAD_RESPONSE_FILE_EXPECTED_SHA256');
    pins.expectedSha256 = expectedSha256;
  }
  if (expectedBytes !== undefined) {
    if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0 || expectedBytes > maxBytes)
      throw new BuyerResponseFileError('BAD_RESPONSE_FILE_EXPECTED_BYTES');
    pins.expectedBytes = expectedBytes;
  }
  if (expectedContentType !== undefined) {
    if (typeof expectedContentType !== 'string' || expectedContentType.length > 127 ||
        !/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(expectedContentType))
      throw new BuyerResponseFileError('BAD_RESPONSE_FILE_EXPECTED_TYPE');
    pins.expectedContentType = expectedContentType.toLowerCase();
  }
  return Object.freeze(pins);
}

async function absent(path) {
  try { await lstat(path); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new BuyerResponseFileError('RESPONSE_FILE_EXISTS', path);
}

function readChunk(reader, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const finish = (settle, value) => {
      signal.removeEventListener('abort', onAbort);
      settle(value);
    };
    const onAbort = () => finish(reject, signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    try { reader.read().then(value => finish(resolve, value), error => finish(reject, error)); }
    catch (error) { finish(reject, error); }
  });
}

/** Reserve a caller-chosen destination BEFORE calling the buyer. The parent
 * must be an existing, trusted directory on a hard-link-capable filesystem. */
export async function prepareBuyerResponseFile({ destination, maxBytes = 64 * 1024 * 1024,
  timeoutMs = 30_000, expectedSha256, expectedBytes, expectedContentType } = {}) {
  if (typeof destination !== 'string' || !isAbsolute(destination) || destination.includes('\0') ||
      /[\\/]$/.test(destination) || ['.', '..'].includes(basename(destination)))
    throw new BuyerResponseFileError('BAD_RESPONSE_FILE_DESTINATION', 'absolute file path required');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
    throw new BuyerResponseFileError('BAD_RESPONSE_FILE_LIMIT');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647)
    throw new BuyerResponseFileError('BAD_RESPONSE_FILE_TIMEOUT');
  const pins = validateResponseFileIntegrity({ expectedSha256, expectedBytes, expectedContentType }, maxBytes);

  let finalPath, reservationPath, partialPath, probePath, reservation, file;
  let state = 'PREPARING', activeSave = null, bytes = 0;
  const controller = new AbortController();

  async function cleanup({ keepPartial = false } = {}) {
    const warnings = [];
    for (const [handle, path] of [[file, partialPath], [reservation, reservationPath]]) {
      if (handle) {
        try { await handle.close(); }
        catch (error) { warnings.push({ path, code: error.code ?? 'CLOSE_FAILED' }); }
      }
    }
    file = null; reservation = null;
    for (const path of [probePath, !keepPartial && partialPath, reservationPath]) {
      if (!path) continue;
      try { await unlink(path); }
      catch (error) { if (error.code !== 'ENOENT') warnings.push({ path, code: error.code ?? 'UNLINK_FAILED' }); }
    }
    return warnings;
  }

  try {
    const parent = await realpath(dirname(resolve(destination)));
    finalPath = join(parent, basename(destination));
    await absent(finalPath);
    // A filename-derived reservation follows the parent filesystem's own
    // case comparison, unlike a hash which gives case aliases different locks.
    const lockPath = join(parent, `.${basename(finalPath)}.x402-download.lock`);
    try { reservation = await open(lockPath, 'wx', 0o600); }
    catch (cause) {
      throw new BuyerResponseFileError(cause.code === 'EEXIST' ? 'RESPONSE_FILE_RESERVED' : 'RESPONSE_FILE_PREPARE_FAILED', finalPath, { cause });
    }
    // Record only paths actually created by this instance: never unlink another
    // process's existing lock or a coincidentally named partial file.
    reservationPath = lockPath;
    const candidate = join(parent, `.x402-response-${randomUUID()}.partial`);
    file = await open(candidate, 'wx', 0o600);
    partialPath = candidate;
    await reservation.writeFile(JSON.stringify({ destination: finalPath, partialPath, pid: process.pid }) + '\n');
    await reservation.sync();
    // Discover unsupported hard links before the caller sends a paid request.
    const probe = join(parent, `.x402-link-${randomUUID()}`);
    await link(partialPath, probe);
    probePath = probe;
    await unlink(probePath);
    probePath = null;
    await absent(finalPath);
    state = 'PREPARED';
  } catch (cause) {
    const cleanupWarnings = await cleanup();
    const error = cause instanceof BuyerResponseFileError ? cause : new BuyerResponseFileError('RESPONSE_FILE_PREPARE_FAILED', '', { cause });
    error.cleanupWarnings = cleanupWarnings;
    throw error;
  }

  async function saveOnce(result, signal, byteSource = false) {
    let reader = null, timer = null, onExternalAbort = null, complete = false;
    const stop = () => { throw controller.signal.reason; };
    const check = () => { if (controller.signal.aborted) stop(); };
    try {
      if (signal !== undefined && !(signal instanceof AbortSignal))
        throw new BuyerResponseFileError('BAD_RESPONSE_FILE_SIGNAL');
      if (signal) {
        onExternalAbort = () => controller.abort(new BuyerResponseFileError('RESPONSE_FILE_ABORTED'));
        signal.addEventListener('abort', onExternalAbort, { once: true });
        if (signal.aborted) onExternalAbort();
      }
      timer = setTimeout(() => controller.abort(new BuyerResponseFileError('RESPONSE_FILE_TIMEOUT')), timeoutMs);
      check();
      let body, contentType, objectMetadata = {};
      if (byteSource) {
        if (!(result.bytes instanceof Uint8Array) || result.bytes.byteLength > maxBytes)
          throw new BuyerResponseFileError('RESPONSE_FILE_BYTE_SOURCE_INVALID');
        if (typeof result.contentType !== 'string' || result.contentType.length > 256 ||
            /[\x00-\x1f\x7f]/.test(result.contentType))
          throw new BuyerResponseFileError('RESPONSE_FILE_BYTE_TYPE_INVALID');
        // Blob snapshots the caller's bytes. This is local serialization, with
        // no fabricated HTTP status, network response or payment outcome.
        body = new Blob([result.bytes]).stream();
        contentType = result.contentType;
      } else {
        const response = result?.response;
        if (!(response instanceof Response) || !response.ok)
          throw new BuyerResponseFileError('RESPONSE_FILE_HTTP_STATUS', 'a returned 2xx Response is required');
        if (response.bodyUsed || response.body?.locked)
          throw new BuyerResponseFileError('RESPONSE_FILE_BODY_UNAVAILABLE', 'save the unread original response');
        body = response.body; contentType = response.headers.get('content-type');
        objectMetadata = {
          contentRange: response.headers.get('content-range'),
          contentSha256: response.headers.get('x-content-sha256'),
          snapshot: response.headers.get('x-sf30-object-snapshot'),
          totalBytes: response.headers.get('x-sf30-object-bytes'),
        };
      }
      // Count the bytes Fetch exposes, not Content-Length: compression can make
      // that header describe a different representation than this stream.
      const hash = createHash('sha256');
      if (body) reader = body.getReader();
      if (pins.expectedContentType !== undefined &&
          contentType?.split(';', 1)[0].trim().toLowerCase() !== pins.expectedContentType)
        throw new BuyerResponseFileError('RESPONSE_FILE_TYPE_MISMATCH');
      while (reader) {
        check();
        let chunk;
        // One cancellation listener per pending read, removed after that read;
        // no growing chain of Promise.race callbacks on a shared timer promise.
        try { chunk = await readChunk(reader, controller.signal); }
        catch (cause) {
          if (cause instanceof BuyerResponseFileError) throw cause;
          throw new BuyerResponseFileError('RESPONSE_FILE_READ_FAILED', '', { cause });
        }
        const { done, value } = chunk;
        if (done) break;
        if (!(value instanceof Uint8Array)) throw new BuyerResponseFileError('RESPONSE_FILE_BAD_CHUNK');
        if (value.byteLength > maxBytes - bytes)
          throw new BuyerResponseFileError('RESPONSE_FILE_TOO_LARGE', `limit ${maxBytes} bytes`);
        let offset = 0;
        while (offset < value.byteLength) {
          check();
          const { bytesWritten } = await file.write(value, offset, value.byteLength - offset, null);
          if (bytesWritten < 1) throw new BuyerResponseFileError('RESPONSE_FILE_WRITE_FAILED', 'write made no progress');
          hash.update(value.subarray(offset, offset + bytesWritten));
          bytes += bytesWritten;
          offset += bytesWritten;
        }
      }
      check();
      await file.sync();
      await file.close();
      file = null;
      check();
      const saved = { path: finalPath, bytes, sha256: hash.digest('hex'), contentType };
      // A completed transfer is not yet an accepted product. Leave a mismatched
      // private partial for reconciliation; never publish it under the buyer's name.
      if (pins.expectedBytes !== undefined && bytes !== pins.expectedBytes)
        throw new BuyerResponseFileError('RESPONSE_FILE_SIZE_MISMATCH');
      if (pins.expectedSha256 !== undefined && saved.sha256 !== pins.expectedSha256)
        throw new BuyerResponseFileError('RESPONSE_FILE_DIGEST_MISMATCH');
      if (Object.keys(pins).length) saved.verifiedAgainst = { ...pins };
      if (Object.values(objectMetadata).some(value => value !== null))
        saved.objectMetadata = objectMetadata;
      // link is atomic and fails when the destination exists; rename would
      // silently overwrite a file created after the original preflight.
      try { await link(partialPath, finalPath); }
      catch (cause) {
        throw new BuyerResponseFileError(cause.code === 'EEXIST' ? 'RESPONSE_FILE_EXISTS' : 'RESPONSE_FILE_PUBLISH_FAILED', finalPath, { cause });
      }
      complete = true;
      state = 'SAVED';
      clearTimeout(timer);
      const cleanupWarnings = await cleanup();
      return { ...saved, cleanupWarnings };
    } catch (cause) {
      state = 'FAILED';
      if (reader) { try { void reader.cancel().catch(() => {}); } catch {} }
      const cleanupWarnings = await cleanup({ keepPartial: bytes > 0 });
      const error = cause instanceof BuyerResponseFileError ? cause : new BuyerResponseFileError('RESPONSE_FILE_WRITE_FAILED', '', { cause });
      error.bytes = bytes;
      error.partialPath = bytes > 0 ? partialPath : null;
      error.cleanupWarnings = cleanupWarnings;
      throw error;
    } finally {
      clearTimeout(timer);
      if (onExternalAbort) signal.removeEventListener('abort', onExternalAbort);
      if (reader) {
        // A remote source's unresolved cancellation must not hold the caller.
        if (!complete) { try { void reader.cancel().catch(() => {}); } catch {} }
        try { reader.releaseLock(); } catch {}
      }
    }
  }

  return Object.freeze({
    destination: finalPath,
    save(result, { signal } = {}) {
      if (state !== 'PREPARED')
        return Promise.reject(new BuyerResponseFileError('RESPONSE_FILE_NOT_PREPARED', state));
      state = 'SAVING';
      activeSave = saveOnce(result, signal);
      return activeSave;
    },
    /** Save already-returned non-HTTP bytes through the same reserved writer. */
    saveBytes(bytes, { contentType = 'application/octet-stream', signal } = {}) {
      if (state !== 'PREPARED')
        return Promise.reject(new BuyerResponseFileError('RESPONSE_FILE_NOT_PREPARED', state));
      state = 'SAVING';
      activeSave = saveOnce({ bytes, contentType }, signal, true);
      return activeSave;
    },
    async abort() {
      if (state === 'SAVING') {
        controller.abort(new BuyerResponseFileError('RESPONSE_FILE_ABORTED'));
        try { await activeSave; } catch {}
      } else if (state === 'PREPARED') {
        state = 'ABORTED';
        const cleanupWarnings = await cleanup();
        if (cleanupWarnings.length)
          throw new BuyerResponseFileError('RESPONSE_FILE_CLEANUP_FAILED', '', { cleanupWarnings });
      }
    },
  });
}
