// MIT. Customer handover in the original release console and retained MCP store.
import { mkdir, lstat, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { MerchantClientExports, readOwnedSellerCatalog } from '../../../stellar-forge/mcp-merchant-operator/client-exports.mjs';

const failure = (code, message, status = 400) => Object.assign(new Error(message), { code, status });
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const view = ({ directory, ...value }) => value;
function fields(input, allowed, required = allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(input, key)))
    throw failure('CLIENT_PARAMETERS', 'Supply only the declared customer handover fields.');
}
async function privateDirectory(directory) {
  try { await mkdir(directory, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || process.platform !== 'win32' && (stat.mode & 0o077) ||
      await realpath(directory) !== directory)
    throw failure('CLIENT_DIRECTORY', 'Configure an existing real private customer export directory (0700).');
}

// Original MongoDB workspace ustar encoding, streamed from the shared verified
// reader instead of accumulating a second complete package or store on disk.
function tarHeader(name, bytes, completedAt) {
  const header = Buffer.alloc(512);
  if (Buffer.byteLength(name) > 100) throw failure('CLIENT_ARCHIVE', 'Customer archive member name exceeds its fixed format.');
  header.write(name, 0, 100, 'utf8');
  const octal = (value, offset, length) => header.write(value.toString(8).padStart(length - 1, '0') + '\0', offset, length, 'ascii');
  octal(0o600, 100, 8); octal(0, 108, 8); octal(0, 116, 8); octal(bytes, 124, 12);
  octal(Math.floor(Date.parse(completedAt) / 1000), 136, 12);
  header.fill(32, 148, 156); header.write('0', 156); header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii'); header.write('merchant', 265, 32, 'ascii');
  const checksum = header.reduce((sum, value) => sum + value, 0);
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii'); return header;
}
function byteRange(range, size) {
  if (range === undefined) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=([0-9]+)-([0-9]*)$/.exec(range);
  if (!match) throw failure('CLIENT_RANGE', 'Use one explicit starting byte range.', 416);
  const start = Number(match[1]), end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start)
    throw failure('CLIENT_RANGE', 'Use a byte range within the reviewed original file.', 416);
  return { start, end, partial: true };
}

export async function createReleaseClientConsole(root, { directory = resolve(root) + '.clients', getManaged } = {}) {
  if (typeof directory !== 'string' || !directory || directory.includes('\0') || typeof getManaged !== 'function')
    throw failure('CLIENT_CONFIGURATION', 'Configure the private customer export directory and existing seller owner.');
  directory = resolve(directory); await privateDirectory(directory);
  const exports = new MerchantClientExports({ directory }), downloads = new Map(); let closing = false, closed;
  const current = () => {
    const session = getManaged();
    return session ? { instanceId: session.observation.instanceId, releaseId: session.release.id,
      releaseDigest: session.release.digest, mode: session.mode ?? session.release.mode } : null;
  };
  async function list(input = {}) {
    fields(input, ['after', 'limit'], []);
    return { ...await exports.list(input), ownedSeller: current(), downloads: downloads.size };
  }
  async function inspect(input) {
    fields(input, ['exportId']);
    return view(await exports.inspect({ exportId: input.exportId, includeOffers: true }));
  }
  async function generate(input) {
    fields(input, ['id', 'instanceId']);
    if (closing) throw failure('CLIENT_CLOSING', 'This customer handover console is closing.', 503);
    const session = getManaged();
    if (!session || input.instanceId !== session.observation.instanceId)
      throw failure('INSTANCE_CONFLICT', 'Generate from the seller currently owned by this console. Refresh its status.', 409);
    const { openapi } = await readOwnedSellerCatalog({ session, isCurrent: candidate => getManaged() === candidate });
    try { await exports.generate({ exportId: input.id, session, openapi }); }
    catch (error) {
      if (error.code === 'EEXIST') throw failure('CLIENT_EXPORT_EXISTS', 'That export ID is already retained. Inspect it to recover the completed or interrupted handover.', 409);
      throw error;
    }
    return inspect({ exportId: input.id });
  }
  async function adopt(input) {
    fields(input, ['exportId', 'expectedFilesSha256']);
    await exports.call('merchant_client_export_adopt', input); return inspect({ exportId: input.exportId });
  }
  async function* originalFile(exportId, manifestSha256, file, range, signal) {
    let readId, offset = range.start;
    try {
      while (offset <= range.end) {
        signal.throwIfAborted();
        const result = await exports.call('merchant_client_export_file', { exportId, file: file.name,
          expectedManifestSha256: manifestSha256, expectedSha256: file.sha256,
          ...(readId ? { readId } : {}), offset, limit: Math.min(196608, range.end - offset + 1) });
        readId = result.readId; signal.throwIfAborted();
        const bytes = Buffer.from(result.data, 'base64');
        if (!bytes.length || result.offset !== offset || bytes.length !== result.bytesRead)
          throw failure('CLIENT_TRANSFER', 'The original customer read returned an incomplete byte range.');
        yield bytes; offset += bytes.length;
      }
    } finally {
      if (readId) await exports.call('merchant_client_export_file_release', { exportId, readId }).catch(() => {});
    }
  }
  async function sendDownload(req, res, input) {
    fields(input, ['exportId', 'expectedManifestSha256', 'file', 'expectedSha256'], ['exportId', 'expectedManifestSha256']);
    if (closing) throw failure('CLIENT_CLOSING', 'This customer handover console is closing.', 503);
    if (downloads.size >= 2) throw failure('CLIENT_DOWNLOAD_CAPACITY', 'Finish or stop an existing customer download before starting another.', 409);
    if (!digest(input.expectedManifestSha256)) throw failure('CLIENT_REVIEW', 'Inspect the retained completion receipt before downloading.');
    const controller = new AbortController(), signal = controller.signal;
    const disconnected = () => { if (!res.writableFinished) controller.abort(); };
    req.once('aborted', disconnected); res.once('close', disconnected);
    const job = (async () => {
      const retained = await exports.call('merchant_client_export_manifest', { exportId: input.exportId });
      signal.throwIfAborted();
      if (retained.manifestFile.sha256 !== input.expectedManifestSha256)
        throw failure('CLIENT_REVIEW_CHANGED', 'The retained completion receipt changed. Inspect this export again.', 409);
      const files = [...retained.manifest.files, retained.manifestFile];
      const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer', 'cross-origin-resource-policy': 'same-origin',
        'x-client-manifest-sha256': input.expectedManifestSha256 };
      let stream;
      if (input.file !== undefined) {
        const file = files.find(value => value.name === input.file);
        if (!file || !digest(input.expectedSha256) || input.expectedSha256 !== file.sha256)
          throw failure('CLIENT_FILE_REVIEW', 'Select an original file and its exact reviewed digest.');
        const range = byteRange(req.headers.range, file.bytes);
        headers['content-type'] = file.contentType ?? (file.name.endsWith('.json') ? 'application/json' : 'application/octet-stream');
        headers['content-length'] = String(range.end - range.start + 1);
        headers['content-disposition'] = 'attachment; filename="' + file.name + '"';
        headers['x-content-sha256'] = file.sha256; headers.etag = '"' + file.sha256 + '"'; headers['accept-ranges'] = 'bytes';
        if (range.partial) headers['content-range'] = 'bytes ' + range.start + '-' + range.end + '/' + file.bytes;
        // Verify the original bytes before committing the HTTP response.
        const iterator = originalFile(input.exportId, input.expectedManifestSha256, file, range, signal);
        try {
          const first = await iterator.next(); signal.throwIfAborted();
          stream = Readable.from((async function* () { yield first.value; yield* iterator; })());
          res.writeHead(range.partial ? 206 : 200, headers);
          await pipeline(stream, res, { signal });
        } finally { await iterator.return(); }
      } else {
        if (input.expectedSha256 !== undefined || req.headers.range !== undefined)
          throw failure('CLIENT_ARCHIVE_RANGE', 'Resume an individual original file by byte range, or restart the complete customer archive.');
        headers['content-type'] = 'application/gzip';
        headers['content-disposition'] = 'attachment; filename="' + input.exportId + '-client.tar.gz"';
        stream = Readable.from((async function* () {
          for (const file of files) {
            signal.throwIfAborted();
            yield tarHeader(input.exportId + '/' + file.name, file.bytes, retained.manifest.completedAt);
            yield* originalFile(input.exportId, input.expectedManifestSha256, file, { start: 0, end: file.bytes - 1 }, signal);
            yield Buffer.alloc((512 - file.bytes % 512) % 512);
          }
          yield Buffer.alloc(1024);
        })());
        res.writeHead(200, headers);
        await pipeline(stream, createGzip({ level: 6 }), res, { signal });
      }
    })();
    downloads.set(controller, job);
    try { await job; }
    finally { req.off('aborted', disconnected); res.off('close', disconnected); downloads.delete(controller); }
  }
  return { list, inspect, generate, adopt, sendDownload,
    get summary() { return { ...exports.summary, activeDownloads: downloads.size }; },
    close() {
      if (!closed) {
        closing = true;
        for (const controller of downloads.keys()) controller.abort();
        closed = (async () => { await Promise.allSettled([...downloads.values()]); await exports.close(); })();
      }
      return closed;
    } };
}
