// MIT. OpenAPI customer archives from the original verified downloader and SF82 ustar encoder.
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { createRetainedDownload } from '../retained-download.mjs';
import { OPENAPI_CUSTOMER_DOWNLOAD, validateOpenApiCustomerSelection } from './openapi-customer-records.mjs';
import { canonical, digest, fail } from './records.mjs';

/** Own only the current streamed responses; retained files and leases stay with the original downloader. */
export async function createOpenApiCustomerArchive({ record, directory }) {
  const selection = validateOpenApiCustomerSelection(record.identity);
  const driver = createRetainedDownload(OPENAPI_CUSTOMER_DOWNLOAD);
  const { tarHeader } = await import('../../../stellar/scf-starforge-20261009/sf82-seller-pilot/release-client.mjs');
  const active = new Map();
  let closing = false, closed;
  async function sendDownload(req, res, input) {
    if (closing) throw fail('CONSOLE_CLOSING', 'The original customer archive owner is closing.', 503);
    if (active.size >= 2) throw fail('CONSOLE_CUSTOMER_CAPACITY', 'Finish or stop a current customer archive before starting another.', 409);
    if (!input || Object.keys(input).some(key => !['exportId', 'expectedManifestSha256'].includes(key)) ||
        input.exportId !== selection.exportId || input.expectedManifestSha256 !== selection.expectedManifestSha256)
      throw fail('CONSOLE_CUSTOMER_CHANGED', 'Select the original reviewed OpenAPI export and manifest.', 409);
    if (req.headers.range !== undefined)
      throw fail('CONSOLE_CUSTOMER_ARCHIVE_RANGE', 'Restart the complete package archive, or resume receiving its individual original files.', 416);
    const controller = new AbortController(), signal = controller.signal;
    const disconnected = () => { if (!res.writableFinished) controller.abort(); };
    req.once('aborted', disconnected); res.once('close', disconnected);
    const task = driver.lockedDownload(directory, async context => {
      signal.throwIfAborted();
      const manifestBytes = await driver.bytesAt(join(context.root, OPENAPI_CUSTOMER_DOWNLOAD.manifestName), 65000);
      if (digest(manifestBytes) !== selection.expectedManifestSha256)
        throw fail('CONSOLE_CUSTOMER_CHANGED', 'The complete local OpenAPI manifest differs from its reviewed bytes.', 409);
      await driver.loadContext(context, manifestBytes, selection.exportId);
      const manifest = context.manifest;
      const files = [...manifest.files, {
        name: OPENAPI_CUSTOMER_DOWNLOAD.manifestName, bytes: manifestBytes.length, sha256: digest(manifestBytes)
      }];
      if (canonical(files) !== canonical(record.files) || canonical(manifest) !== canonical(record.manifest))
        throw fail('CONSOLE_CUSTOMER_CHANGED', 'The original retained customer file identities changed.', 409);
      // Validate every original member before committing the archive response.
      for (const file of files) await driver.verifiedFile(join(context.root, file.name), file, signal);
      signal.throwIfAborted(); context.lease.assertHeld();
      const source = Readable.from((async function* () {
        // A short fixed root preserves even the longest original compiled response name in ustar.
        yield tarHeader('package/', 0, manifest.package.createdAt, { directory: true });
        const directories = new Set();
        for (const file of files) {
          const parts = file.name.split('/');
          for (let index = 1; index < parts.length; index++) directories.add(parts.slice(0, index).join('/') + '/');
        }
        for (const name of [...directories].sort())
          yield tarHeader('package/' + name, 0, manifest.package.createdAt, { directory: true });
        for (const file of files) {
          signal.throwIfAborted(); context.lease.assertHeld();
          // The original bounded file reader checks private regular-file custody.
          // Hold one member at a time and validate those same bytes before streaming it.
          const bytes = await driver.bytesAt(join(context.root, file.name), file.bytes);
          if (bytes.length !== file.bytes || digest(bytes) !== file.sha256)
            throw fail('CONSOLE_CUSTOMER_CHANGED', 'An original customer member changed during archive receiving.', 409);
          yield tarHeader('package/' + file.name, file.bytes, manifest.package.createdAt);
          for (let offset = 0; offset < bytes.length; offset += 65536) {
            signal.throwIfAborted(); yield bytes.subarray(offset, offset + 65536);
          }
          yield Buffer.alloc((512 - file.bytes % 512) % 512);
        }
        yield Buffer.alloc(1024);
      })());
      res.writeHead(200, {
        'content-type': 'application/gzip', 'cache-control': 'no-store',
        'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
        'cross-origin-resource-policy': 'same-origin',
        'x-client-manifest-sha256': selection.expectedManifestSha256,
        'content-disposition': 'attachment; filename="' + selection.exportId + '-package.tar.gz"'
      });
      await pipeline(source, createGzip({ level: 6 }), res, { signal });
    });
    active.set(controller, task);
    try { await task; }
    finally { req.off('aborted', disconnected); res.off('close', disconnected); active.delete(controller); }
  }
  return {
    sendDownload,
    get summary() { return { activeDownloads: active.size }; },
    close() {
      if (!closed) {
        closing = true;
        for (const controller of active.keys()) controller.abort();
        closed = Promise.allSettled([...active.values()]).then(() => undefined);
      }
      return closed;
    }
  };
}
