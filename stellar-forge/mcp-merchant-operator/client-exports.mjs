// MIT. Original customer exporter and retained-file authority, shared with SF82.
import { join, resolve } from 'node:path';
import { mkdtemp, rm, open, opendir, lstat } from 'node:fs/promises';
import { exportSellerClient, inspectSellerClientExport, adoptSellerClientExport,
  readSellerClientManifest, readSellerClientFile, CLIENT_EXPORT_FILES, CLIENT_EXPORT_MANIFEST,
} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/developer/client-export.mjs';
import { RetainedFileReads } from './retained-file-reads.mjs';

const validId = value => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value);
const fail = (code, message) => Object.assign(new Error(message), { code });
function identifier(value) {
  if (!validId(value)) throw fail('INVALID_PARAMS', 'Export ID must use 1–64 lowercase letters, digits, underscores or hyphens.');
  return value;
}
async function originalJson(url, signal, maximum = 16 * 1024 * 1024) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(5000), ...(signal ? [signal] : [])]),
    headers: { accept: 'application/json' } });
  if (!response.ok) throw fail('SELLER_UNAVAILABLE', 'Original seller metadata returned HTTP ' + response.status + '.');
  const parts = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maximum) throw fail('SELLER_METADATA_TOO_LARGE', 'Original metadata exceeds its size limit.');
    parts.push(chunk);
  }
  const bytes = Buffer.concat(parts);
  return { value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), bytes };
}

/** The caller retains the existing runtime owner; this reads only its metadata. */
export async function readOwnedSellerCatalog({ session, isCurrent, signal } = {}) {
  if (!session || !/^http:\/\/127\.0\.0\.1:\d+$/.test(session.url))
    throw fail('SELLER_UNAVAILABLE', 'Original seller must use its loopback listener.');
  if (typeof isCurrent !== 'function' || !isCurrent(session))
    throw fail('INSTANCE_CONFLICT', 'This operator does not own the selected seller instance.');
  const [health, offers, openapi] = await Promise.all(['health', 'offers', 'openapi.json']
    .map(name => originalJson(session.url + '/_seller/' + name, signal)));
  if (!isCurrent(session)) throw fail('INSTANCE_CONFLICT', 'Seller stopped while reading its metadata.');
  return { session, health, offers, openapi };
}

/** No seller, secondary export store or generated-code execution lives here. */
export class MerchantClientExports {
  #directory; #reads = new RetainedFileReads({ errorPrefix: 'CLIENT' });
  #tasks = new Set(); #closing = false; #close;
  constructor({ directory }) { this.#directory = resolve(directory); }
  get summary() { return this.#reads.summary; }
  #track(operation) {
    if (this.#closing) return Promise.reject(fail('CLIENT_CLOSING', 'Customer export reads are closing.'));
    const task = Promise.resolve().then(operation); this.#tasks.add(task);
    task.then(() => this.#tasks.delete(task), () => this.#tasks.delete(task)); return task;
  }
  inspect({ exportId, includeOffers = false }) {
    return this.#track(async () => {
      exportId = identifier(exportId);
      return { ...await inspectSellerClientExport({ directory: join(this.#directory, exportId), exportId, includeOffers }),
        exportId, fileReads: this.#reads.status(exportId) };
    });
  }
  generate({ exportId, session, openapi }) {
    return this.#track(async () => {
      exportId = identifier(exportId);
      const temporary = await mkdtemp(join(this.#directory, '.openapi-'));
      try {
        const input = join(temporary, 'seller-openapi.json'), file = await open(input, 'wx', 0o600);
        try { await file.writeFile(openapi.bytes); await file.sync(); } finally { await file.close(); }
        const result = await exportSellerClient({ openapi: input, out: join(this.#directory, exportId),
          provenance: { exportId, releaseId: session.release.id, releaseDigest: session.release.digest,
            instanceId: session.observation.instanceId } });
        return { ...result, exportId, releaseId: session.release.id, releaseDigest: session.release.digest,
          instanceId: session.observation.instanceId };
      } finally { await rm(temporary, { recursive: true, force: true }); }
    });
  }
  list({ after, limit = 20 } = {}) {
    return this.#track(async () => {
      if (after !== undefined) identifier(after);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
        throw fail('INVALID_PARAMS', 'List 1–50 retained client exports per page.');
      const candidates = [], names = await opendir(this.#directory); let scanned = 0;
      for await (const entry of names) {
        if (++scanned > 10000) throw fail('CLIENT_EXPORT_LIST_LIMIT', 'This export directory exceeds the 10,000-entry listing limit.');
        if (!entry.isDirectory() || !validId(entry.name) || after !== undefined && entry.name <= after) continue;
        candidates.push(entry.name);
      }
      candidates.sort(); const entries = []; let nextAfter = null;
      for (const exportId of candidates) {
        const directory = join(this.#directory, exportId);
        // Shared customer/support roots may also contain unrelated handoffs.
        let candidate = false;
        for (const file of [CLIENT_EXPORT_MANIFEST, 'seller-openapi.json', 'seller-client.mjs']) {
          try { await lstat(join(directory, file)); candidate = true; break; }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
        if (!candidate) continue;
        if (entries.length === limit) { nextAfter = entries.at(-1).exportId; break; }
        try {
          const { manifest, manifestFile } = await readSellerClientManifest({ directory, exportId });
          entries.push({ exportId, state: 'COMPLETION_RETAINED', completedAt: manifest.completedAt,
            completion: manifest.completion, origin: manifest.origin, mode: manifest.mode,
            sourceSha256: manifest.sourceSha256, operations: manifest.operations.length,
            files: manifest.files.length, bytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0),
            manifestFile, ...(manifest.provenance ? { provenance: manifest.provenance } : {}) });
        } catch (error) {
          entries.push({ exportId, state: error.code === 'CLIENT_EXPORT_MANIFEST_REQUIRED' ? 'LEGACY_OR_INCOMPLETE' : 'NEEDS_ATTENTION',
            ...(error.code === 'CLIENT_EXPORT_MANIFEST_REQUIRED' ? {} : { error: error.code ?? 'CLIENT_EXPORT_UNAVAILABLE' }) });
        }
      }
      return { schema: 'stellar-forge.seller-client-export-list.v1', entries, nextAfter };
    });
  }
  call(name, args = {}) {
    if (name === 'merchant_client_export_list') return this.list(args);
    if (name === 'merchant_client_export_status') return this.inspect(args);
    return this.#track(async () => {
      const exportId = identifier(args.exportId), directory = join(this.#directory, exportId);
      if (name === 'merchant_client_export_adopt') return { ...await adoptSellerClientExport({ directory,
        expectedFilesSha256: args.expectedFilesSha256, provenance: { exportId } }), exportId };
      if (name === 'merchant_client_export_manifest') {
        const { manifest, manifestFile } = await readSellerClientManifest({ directory, exportId });
        return { state: 'MANIFEST_RETAINED', exportId, manifest, manifestFile, fileReads: this.#reads.status(exportId) };
      }
      if (name === 'merchant_client_export_file_release') {
        if (typeof args.readId !== 'string') throw fail('INVALID_PARAMS', 'Supply the original file read ID.');
        await this.#reads.release(exportId, args.readId); return { exportId, readId: args.readId, released: true };
      }
      if (name === 'merchant_client_export_file') {
        if (typeof args.expectedManifestSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(args.expectedManifestSha256) ||
            ![CLIENT_EXPORT_MANIFEST, ...CLIENT_EXPORT_FILES].includes(args.file))
          throw fail('INVALID_PARAMS', 'Select the original customer file and inspected completion digest.');
        const result = await this.#reads.read({ scope: exportId, kind: 'client-export',
          key: JSON.stringify([exportId, args.file, args.expectedManifestSha256]), directory: this.#directory,
          readId: args.readId, offset: args.offset, limit: args.limit, expectedSha256: args.expectedSha256,
          load: () => readSellerClientFile({ directory, exportId, file: args.file, expectedManifestSha256: args.expectedManifestSha256 }) });
        return { exportId, manifestSha256: args.expectedManifestSha256, ...result };
      }
      throw fail('TOOL_NOT_FOUND', 'Unknown original client export operation.');
    });
  }
  close() {
    if (!this.#close) {
      this.#closing = true;
      this.#close = (async () => {
        await Promise.allSettled([...this.#tasks]); await this.#reads.close();
      })();
    }
    return this.#close;
  }
}
