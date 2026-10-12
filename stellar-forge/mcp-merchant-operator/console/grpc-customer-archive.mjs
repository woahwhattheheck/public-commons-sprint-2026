// MIT. Bounded gRPC file and native-layout archive receiving under the original lease.
import { constants } from 'node:fs';
import { open, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { createRetainedDownload } from '../retained-download.mjs';
import { GRPC_CUSTOMER_DOWNLOAD } from './customer-grpc.mjs';
import { normalizeGrpcCustomer, validateGrpcCustomerRecord } from './grpc-customer-records.mjs';
import { canonical, digest, fail } from './records.mjs';

const changed = () => fail('CONSOLE_CUSTOMER_CHANGED', 'An original retained gRPC file or its selected identity changed.', 409);
function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
    left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}
function explicitRange(value, size) {
  if (value === undefined) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=([0-9]+)-([0-9]*)$/.exec(value);
  if (!match) throw fail('CONSOLE_CUSTOMER_RANGE', 'Use one explicit starting byte range.', 416);
  const start = Number(match[1]), end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start)
    throw fail('CONSOLE_CUSTOMER_RANGE', 'Use a byte range within the original retained file.', 416);
  return { start, end, partial: true };
}

/** The original downloader owns all files/checkpoints; this owner holds only open responses. */
export async function createGrpcCustomerArchive({ record, directory }) {
  const retained = JSON.parse(JSON.stringify(record));
  validateGrpcCustomerRecord(retained);
  if (retained.state !== 'COMPLETE' || !Number.isFinite(Date.parse(retained.completedAt)))
    throw fail('CONSOLE_CUSTOMER_RECEIVE', 'Complete the original gRPC receiving before downloading its retained files.', 409);
  const selection = normalizeGrpcCustomer(retained.identity);
  const driver = createRetainedDownload(GRPC_CUSTOMER_DOWNLOAD);
  const { tarHeader } = await import('../../../stellar/scf-starforge-20261009/sf82-seller-pilot/release-client.mjs');
  const active = new Map(), cleanupOwners = new Set();
  let closing = false, closed;
  function keepCleanup(close, label) {
    const entry = { close, label };
    cleanupOwners.add(entry);
    return entry;
  }
  async function assertSource(source, context, signal) {
    signal.throwIfAborted(); context.lease.assertHeld();
    const info = await source.handle.stat(), pathInfo = await lstat(source.path);
    if (!info.isFile() || !pathInfo.isFile() || pathInfo.isSymbolicLink() ||
        process.platform !== 'win32' && info.mode & 0o077 ||
        !sameFile(source.info, info) || !sameFile(info, pathInfo)) throw changed();
    return info;
  }
  async function openSource(context, file, signal) {
    signal.throwIfAborted(); context.lease.assertHeld();
    const path = join(context.root, file.name);
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
      const info = await handle.stat(), source = { handle, info, path, file };
      if (!info.isFile() || info.size !== file.bytes || process.platform !== 'win32' && info.mode & 0o077)
        throw changed();
      // Hash through the maintained original verifier before committing HTTP headers.
      // Keep this same inode open for the whole streamed response.
      await driver.verifiedFile(path, file, signal);
      await assertSource(source, context, signal);
      return source;
    } catch (error) {
      try { await handle.close(); }
      catch (closeError) { keepCleanup(() => handle.close(), file.name); error.closeError = closeError; }
      throw error;
    }
  }
  async function* streamSource(source, context, signal, range = { start: 0, end: source.file.bytes - 1 }) {
    const full = range.start === 0 && range.end === source.file.bytes - 1;
    const hash = full ? createHash('sha256') : null;
    let offset = range.start;
    await assertSource(source, context, signal);
    while (offset <= range.end) {
      signal.throwIfAborted(); context.lease.assertHeld();
      const bytes = Buffer.alloc(Math.min(65536, range.end - offset + 1));
      const { bytesRead } = await source.handle.read(bytes, 0, bytes.length, offset);
      if (!bytesRead) throw changed();
      const chunk = bytesRead === bytes.length ? bytes : bytes.subarray(0, bytesRead);
      hash?.update(chunk); offset += bytesRead;
      if (offset > range.end) {
        // Verify before releasing the last chunk, so a changed file cannot produce
        // an apparently complete Content-Length response or complete gzip member.
        if (hash && hash.digest('hex') !== source.file.sha256) throw changed();
        await assertSource(source, context, signal);
      }
      yield chunk;
    }
    if (range.end < range.start) {
      if (hash && hash.digest('hex') !== source.file.sha256) throw changed();
      await assertSource(source, context, signal);
    }
  }
  function checkInput(input, fileRequest) {
    const fields = fileRequest ? ['exportId', 'expectedManifestSha256', 'file', 'expectedSha256'] :
      ['exportId', 'expectedManifestSha256'];
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
        Object.keys(input).some(key => !fields.includes(key)) ||
        fields.some(key => !Object.hasOwn(input, key)) ||
        input.exportId !== selection.exportId || input.expectedManifestSha256 !== selection.expectedManifestSha256)
      throw fail('CONSOLE_CUSTOMER_CHANGED', 'Select the original reviewed gRPC export and manifest.', 409);
  }
  async function send(req, res, input, fileRequest) {
    if (closing) throw fail('CONSOLE_CLOSING', 'The original gRPC customer owner is closing.', 503);
    if (active.size >= 2)
      throw fail('CONSOLE_CUSTOMER_CAPACITY', 'Finish or stop a current gRPC customer download before starting another.', 409);
    checkInput(input, fileRequest);
    if (!fileRequest && req.headers.range !== undefined)
      throw fail('CONSOLE_CUSTOMER_ARCHIVE_RANGE', 'Restart the complete archive, or resume an individual original file.', 416);
    const controller = new AbortController(), signal = controller.signal;
    const disconnected = () => { if (!res.writableFinished) controller.abort(); };
    req.once('aborted', disconnected); res.once('close', disconnected);
    if (req.aborted || res.destroyed) controller.abort();
    const task = driver.lockedDownload(directory, async context => {
      const opened = [];
      let primary;
      try {
        signal.throwIfAborted();
        const manifestBytes = await driver.bytesAt(join(context.root, GRPC_CUSTOMER_DOWNLOAD.manifestName), 65000);
        if (digest(manifestBytes) !== selection.expectedManifestSha256) throw changed();
        await driver.loadContext(context, manifestBytes, selection.exportId);
        const manifest = context.manifest;
        const files = [...manifest.files, {
          name: GRPC_CUSTOMER_DOWNLOAD.manifestName, bytes: manifestBytes.length, sha256: digest(manifestBytes)
        }];
        if (manifest.workspace !== selection.workspace || canonical(files) !== canonical(retained.files) ||
            canonical(manifest) !== canonical(retained.manifest)) throw changed();
        let selected, range;
        if (fileRequest) {
          selected = files.find(file => file.name === input.file);
          if (!selected || input.expectedSha256 !== selected.sha256)
            throw fail('CONSOLE_CUSTOMER_FILE', 'Select an original gRPC file and its exact reviewed digest.', 400);
          range = explicitRange(req.headers.range, selected.bytes);
        }
        for (const file of fileRequest ? [selected] : files)
          opened.push(await openSource(context, file, signal));
        signal.throwIfAborted(); context.lease.assertHeld();
        const headers = {
          'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
          'referrer-policy': 'no-referrer', 'cross-origin-resource-policy': 'same-origin',
          'x-client-manifest-sha256': selection.expectedManifestSha256
        };
        if (fileRequest) {
          Object.assign(headers, {
            'content-type': selected.contentType ?? 'application/json; charset=utf-8',
            'content-length': String(range.end - range.start + 1),
            'content-disposition': 'attachment; filename="' + selected.name + '"',
            'x-content-sha256': selected.sha256, etag: '"' + selected.sha256 + '"', 'accept-ranges': 'bytes'
          });
          if (range.partial)
            headers['content-range'] = 'bytes ' + range.start + '-' + range.end + '/' + selected.bytes;
          const source = Readable.from(streamSource(opened[0], context, signal, range), { objectMode: false, highWaterMark: 65536 });
          res.writeHead(range.partial ? 206 : 200, headers);
          await pipeline(source, res, { signal });
        } else {
          headers['content-type'] = 'application/gzip';
          headers['content-disposition'] = 'attachment; filename="' + selection.exportId + '-grpc.tar.gz"';
          const source = Readable.from((async function* () {
            const prefix = 'grpc/', directories = new Set();
            yield tarHeader(prefix, 0, retained.completedAt, { directory: true });
            for (const file of files) {
              const nativePath = file.path ?? file.name, parts = nativePath.split('/');
              for (let index = 1; index < parts.length; index++)
                directories.add(parts.slice(0, index).join('/') + '/');
            }
            for (const path of [...directories].sort())
              yield tarHeader(prefix + path, 0, retained.completedAt, { directory: true });
            for (const member of opened) {
              signal.throwIfAborted(); context.lease.assertHeld();
              yield tarHeader(prefix + (member.file.path ?? member.file.name), member.file.bytes, retained.completedAt);
              yield* streamSource(member, context, signal);
              yield Buffer.alloc((512 - member.file.bytes % 512) % 512);
            }
            yield Buffer.alloc(1024);
          })(), { objectMode: false, highWaterMark: 65536 });
          res.writeHead(200, headers);
          await pipeline(source, createGzip({ level: 6 }), res, { signal });
        }
      } catch (error) { primary = error; }
      const releases = await Promise.allSettled(opened.map(source => source.handle.close()));
      const failed = releases.flatMap((result, index) => {
        if (result.status !== 'rejected') return [];
        keepCleanup(() => opened[index].handle.close(), opened[index].file.name);
        return [result.reason];
      });
      if (failed.length) {
        const error = primary ?? fail('CONSOLE_GRPC_FILE_CLOSE_INCOMPLETE', 'The original gRPC file owner requires cleanup recovery.', 503);
        error.cleanupErrors = failed;
        throw error;
      }
      if (primary) throw primary;
    }).catch(error => {
      if (typeof error.close === 'function') keepCleanup(error.close, 'original download lease');
      throw error;
    });
    active.set(controller, task);
    try { await task; }
    finally { req.off('aborted', disconnected); res.off('close', disconnected); active.delete(controller); }
  }
  return {
    sendDownload: (req, res, input) => send(req, res, input, false),
    sendFile: (req, res, input) => send(req, res, input, true),
    get summary() { return { activeDownloads: active.size, pendingCloses: cleanupOwners.size }; },
    close() {
      closing = true;
      for (const controller of active.keys()) controller.abort();
      if (!closed) {
        closed = (async () => {
          await Promise.allSettled([...active.values()]);
          const entries = [...cleanupOwners];
          const results = await Promise.allSettled(entries.map(entry => entry.close()));
          const errors = [];
          results.forEach((result, index) => {
            if (result.status === 'fulfilled') cleanupOwners.delete(entries[index]);
            else errors.push(result.reason);
          });
          if (errors.length)
            throw Object.assign(new AggregateError(errors, 'Original gRPC customer file or lease cleanup is incomplete; retry this owner.'),
              { code: 'CONSOLE_GRPC_CLOSE_INCOMPLETE' });
        })().catch(error => { closed = undefined; throw error; });
      }
      return closed;
    }
  };
}
