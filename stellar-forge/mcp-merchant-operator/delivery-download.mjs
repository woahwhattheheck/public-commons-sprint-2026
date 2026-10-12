// MIT. Original SF98 exchanges through the retained merchant-file download engine.
import { createHash, randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { lstat } from 'node:fs/promises';
import { readJSON, privateDirectory } from '../../stellar/scf-starforge-20261009/sf98-merchant-delivery/destinations/storage.mjs';
import { openDestinationWorkspace } from '../../stellar/scf-starforge-20261009/sf98-merchant-delivery/destinations/model.mjs';
import { createRetainedDownload, openMerchantFileClient } from './retained-download.mjs';
import { inspectDestinationExchange, receiveDestinationExchange }
  from '../../stellar/scf-starforge-20261009/sf98-merchant-delivery/destinations/exchange.mjs';
import { MAX_RETAINED_CHUNK_BYTES } from './retained-file-contracts.mjs';

export const DELIVERY_DOWNLOAD_MANIFEST = 'delivery-files.json';
export const DELIVERY_DOWNLOAD_SCHEMA = 'stellar-forge.release-delivery-files.v1';
const PREFIX = 'merchant_delivery_download';
const HEX = /^[a-f0-9]{64}$/, ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const FILE = /^(?:manifest\.json|source\/(?:manifest\.json|events\.ndjson|deliveries\.ndjson)|destinations\/([a-z][a-z0-9-]{0,47})\/(?:manifest\.json|events\.ndjson|deliveries\.ndjson))$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (code, message = code) => Object.assign(new Error(message), { code });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function id(value) {
  if (!ID.test(value ?? '')) throw fail('RELEASE_DELIVERY_TRANSFER_ID_REQUIRED');
  return value;
}
function fingerprint(value) {
  if (!HEX.test(value ?? '')) throw fail('RELEASE_DELIVERY_TRANSFER_FINGERPRINT_REQUIRED');
  return value;
}
function directoryNames(files) {
  const destinations = [...new Set(files.flatMap(file => FILE.exec(file.name.slice(9))?.[1] ?? []))].sort();
  return ['exchange', 'exchange/source', 'exchange/destinations',
    ...destinations.map(name => 'exchange/destinations/' + name)];
}
/** The transport header wraps exact original names and hashes. It lives beside
 * exchange/, so the original receiver still sees only its three native entries. */
export function parseDeliveryDownloadManifest(bytes, expectedId) {
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw fail('RELEASE_DELIVERY_DOWNLOAD_MANIFEST_INVALID'); }
  if (!object(value) || value.schema !== DELIVERY_DOWNLOAD_SCHEMA || value.id !== id(expectedId) ||
      !HEX.test(value.fingerprint ?? '') || !HEX.test(value.sourceFingerprint ?? '') ||
      typeof value.createdAt !== 'string' || !Array.isArray(value.files) || !Array.isArray(value.directories) ||
      value.files.length < 4 || value.files.length > 388 ||
      Object.keys(value).some(key => !['schema', 'id', 'fingerprint', 'sourceFingerprint', 'createdAt', 'files', 'directories'].includes(key)))
    throw fail('RELEASE_DELIVERY_DOWNLOAD_MANIFEST_INVALID');
  const names = new Set();
  for (const file of value.files) {
    if (!object(file) || Object.keys(file).some(key => !['name', 'bytes', 'sha256'].includes(key)) ||
        typeof file.name !== 'string' || !file.name.startsWith('exchange/') || !FILE.test(file.name.slice(9)) ||
        names.has(file.name) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > 33554432 ||
        !HEX.test(file.sha256 ?? '')) throw fail('RELEASE_DELIVERY_DOWNLOAD_MANIFEST_INVALID');
    names.add(file.name);
  }
  const directories = directoryNames(value.files);
  const required = ['exchange/manifest.json', 'exchange/source/manifest.json',
    'exchange/source/events.ndjson', 'exchange/source/deliveries.ndjson',
    ...directories.filter(name => name.startsWith('exchange/destinations/'))
      .flatMap(name => ['manifest.json', 'events.ndjson', 'deliveries.ndjson'].map(file => name + '/' + file))];
  if (required.length !== names.size || required.some(name => !names.has(name)) ||
      JSON.stringify(value.directories) !== JSON.stringify(directories))
    throw fail('RELEASE_DELIVERY_DOWNLOAD_MANIFEST_INVALID');
  return value;
}
function catalogBytes(catalog, exportId, expectedFingerprint) {
  if (!object(catalog) || catalog.id !== exportId || catalog.fingerprint !== expectedFingerprint ||
      !HEX.test(catalog.source?.fingerprint ?? '') || !Array.isArray(catalog.files))
    throw fail('RELEASE_DELIVERY_TRANSFER_CHANGED');
  const files = catalog.files.map(file => ({ name: 'exchange/' + file.name, bytes: file.bytes, sha256: file.sha256 }));
  const value = { schema: DELIVERY_DOWNLOAD_SCHEMA, id: exportId, fingerprint: expectedFingerprint,
    sourceFingerprint: catalog.source.fingerprint, createdAt: catalog.createdAt,
    files, directories: directoryNames(files) };
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  parseDeliveryDownloadManifest(bytes, exportId);
  return bytes;
}
const transport = createRetainedDownload({
  manifestName: DELIVERY_DOWNLOAD_MANIFEST, parseManifest: parseDeliveryDownloadManifest,
  maximumBytes: 16 * 1024 ** 3, maximumManifestBytes: 1048576, maximumCheckpointBytes: 4194304,
  stateSchema: 'stellar-forge.release-delivery-download-state.v1',
  resultSchema: 'stellar-forge.release-delivery-download.v1',
  toolPrefix: PREFIX, errorPrefix: 'RELEASE_DELIVERY', clientName: 'starforge-delivery-receiver',
  nestedFiles: true, validateExportId: id,
  describe: manifest => ({ fingerprint: manifest.fingerprint, sourceFingerprint: manifest.sourceFingerprint }),
});
export function createReleaseDeliveryFileClient(desk) {
  if (!desk || typeof desk.transferManifest !== 'function' || typeof desk.file !== 'function')
    throw fail('RELEASE_DELIVERY_CLIENT_REQUIRED');
  return { endpoint: 'sf82-release-store:' + desk.summary.releaseStore,
    call(name, args) {
      const method = { merchant_delivery_manifest: 'transferManifest',
        merchant_delivery_file: 'file', merchant_delivery_file_release: 'releaseFile' }[name];
      if (!method) throw fail('RELEASE_DELIVERY_CLIENT_TOOL_UNKNOWN');
      return desk[method](args);
    } };
}
async function originalClient(options) {
  if (options.client !== undefined) {
    if (options.url !== undefined || !options.client || typeof options.client.call !== 'function' ||
        typeof options.client.endpoint !== 'string' || !options.client.endpoint)
      throw fail('RELEASE_DELIVERY_CLIENT_REQUIRED');
    return options.client;
  }
  return openMerchantFileClient({ url: options.url, tokenEnv: options.tokenEnv,
    environment: options.environment, signal: options.signal,
    errorPrefix: 'RELEASE_DELIVERY', clientName: 'starforge-delivery-receiver' });
}
async function bridge(options) {
  const exportId = id(options.id), expectedFingerprint = fingerprint(options.expectedFingerprint);
  const original = await originalClient(options), virtual = new Map(), native = new Set();
  let bytes, manifestSha256, originalCatalog;
  async function load(callOptions) {
    if (!bytes) {
      originalCatalog = await original.call('merchant_delivery_manifest',
        { id: exportId, expectedFingerprint }, callOptions);
      bytes = catalogBytes(originalCatalog, exportId, expectedFingerprint);
      manifestSha256 = sha(bytes);
    }
  }
  const client = {
    endpoint: original.endpoint,
    async call(name, input, callOptions) {
      if (input.exportId !== exportId) throw fail('RELEASE_DELIVERY_TRANSFER_CHANGED');
      if (name === PREFIX + '_file_release') {
        if (virtual.delete(input.readId)) return { released: true };
        native.delete(input.readId);
        return original.call('merchant_delivery_file_release', { id: exportId, readId: input.readId }, callOptions);
      }
      await load(callOptions);
      const manifestFile = { name: DELIVERY_DOWNLOAD_MANIFEST, bytes: bytes.length, sha256: manifestSha256 };
      if (name === PREFIX + '_manifest') return {
        state: 'MANIFEST_RETAINED', exportId, manifestFile,
      };
      if (name !== PREFIX + '_file' || input.expectedManifestSha256 !== manifestSha256)
        throw fail('RELEASE_DELIVERY_TRANSFER_CHANGED');
      if (input.file === DELIVERY_DOWNLOAD_MANIFEST) {
        if (input.expectedSha256 !== manifestSha256) throw fail('RELEASE_DELIVERY_TRANSFER_CHANGED');
        const offset = input.offset ?? 0, limit = input.limit ?? MAX_RETAINED_CHUNK_BYTES;
        if (!Number.isSafeInteger(offset) || offset < 0 || offset > bytes.length ||
            !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_RETAINED_CHUNK_BYTES ||
            input.readId && !virtual.has(input.readId)) throw fail('RELEASE_DELIVERY_DOWNLOAD_CHUNK_INVALID');
        const readId = input.readId ?? randomUUID(); virtual.set(readId, true);
        const part = bytes.subarray(offset, Math.min(bytes.length, offset + limit));
        const nextOffset = offset + part.length < bytes.length ? offset + part.length : null;
        if (nextOffset === null) virtual.delete(readId);
        return { exportId, manifestSha256, file: manifestFile, readId, offset, bytesRead: part.length,
          nextOffset, encoding: 'base64', data: part.toString('base64') };
      }
      const nameInExchange = typeof input.file === 'string' && input.file.startsWith('exchange/') ? input.file.slice(9) : '';
      const file = originalCatalog.files.find(file => file.name === nameInExchange);
      if (!file || file.sha256 !== input.expectedSha256) throw fail('RELEASE_DELIVERY_TRANSFER_CHANGED');
      const result = await original.call('merchant_delivery_file', {
        id: exportId, expectedFingerprint, name: nameInExchange, expectedSha256: file.sha256,
        ...(input.readId ? { readId: input.readId } : {}), offset: input.offset, limit: input.limit,
      }, callOptions);
      if (result.readId) {
        if (result.nextOffset === null) native.delete(result.readId);
        else native.add(result.readId);
      }
      return { ...result, exportId, manifestSha256, file: { ...result.file, name: input.file } };
    },
  };
  return { client, async close() {
    virtual.clear();
    await Promise.allSettled([...native].map(readId => original.call('merchant_delivery_file_release',
      { id: exportId, readId }, { requestSignal: null, timeoutMs: 2000 })));
    native.clear();
  } };
}
export async function inspectDeliveryDownload(options = {}) {
  const held = await bridge(options);
  try { return await transport.inspect({ client: held.client, exportId: options.id, signal: options.signal }); }
  finally { await held.close(); }
}
export async function downloadDeliveryExchange(options = {}) {
  const held = await bridge(options);
  try {
    const result = await transport.download({ client: held.client, exportId: options.id,
      directory: options.directory, signal: options.signal, chunkSize: options.chunkSize,
      onProgress: options.onProgress, expectedManifestSha256: options.expectedManifestSha256 });
    const exchangeDirectory = join(result.directory, 'exchange');
    const original = await inspectDestinationExchange(exchangeDirectory);
    if (original.fingerprint !== options.expectedFingerprint) throw fail('RELEASE_DELIVERY_TRANSFER_CHANGED');
    return { ...result, exchangeDirectory, receiving: { module: 'sf98-merchant-delivery/destinations/cli.mjs',
      inspect: ['inspect', '--workspace', exchangeDirectory],
      receive: ['receive', '--from', exchangeDirectory, '--workspace', 'NEW_PRIVATE_DIRECTORY',
        '--fingerprint', original.fingerprint] } };
  } finally { await held.close(); }
}
export async function reopenDeliveryDownload({ directory, id: exportId, expectedFingerprint, signal } = {}) {
  id(exportId); fingerprint(expectedFingerprint);
  return transport.lockedDownload(directory, async context => {
    const bytes = await transport.bytesAt(join(context.root, DELIVERY_DOWNLOAD_MANIFEST), 1048576);
    await transport.loadContext(context, bytes, exportId);
    if (context.manifest.fingerprint !== expectedFingerprint) throw fail('RELEASE_DELIVERY_TRANSFER_CHANGED');
    for (const file of context.manifest.files) await transport.verifiedFile(join(context.root, file.name), file, signal);
    const exchangeDirectory = join(context.root, 'exchange'), original = await inspectDestinationExchange(exchangeDirectory);
    if (original.fingerprint !== expectedFingerprint) throw fail('RELEASE_DELIVERY_TRANSFER_CHANGED');
    return { state: 'COMPLETE', directory: context.root, exchangeDirectory, id: exportId,
      fingerprint: original.fingerprint, source: original.source, destinations: original.destinations,
      manifestSha256: sha(bytes), reopened: true };
  });
}
export async function receiveDeliveryDownload({ workspace, ...options } = {}) {
  if (typeof workspace !== 'string' || !workspace) throw fail('RELEASE_DELIVERY_RECEIVING_DIRECTORY_REQUIRED');
  const result = await reopenDeliveryDownload(options), target = resolve(workspace);
  async function retained() {
    await privateDirectory(target);
    const receipt = await readJSON(join(target, 'received.json'));
    const sourceDirectory = join(target, 'source'), workspaceDirectory = join(target, 'workspace');
    if (receipt.schema !== 'stellar-forge.sf98.destinations-received.v1' ||
        receipt.fingerprint !== result.fingerprint || receipt.sourceDirectory !== sourceDirectory ||
        receipt.workspaceDirectory !== workspaceDirectory ||
        receipt.sourceNativeFingerprint !== result.source.nativeFingerprint ||
        JSON.stringify(receipt.destinations) !== JSON.stringify(result.destinations.map(row => ({
          id: row.id, nativeFingerprint: row.nativeFingerprint,
        }))) || typeof receipt.receivedAt !== 'string' || receipt.serviceStarted !== false)
      throw fail('RELEASE_DELIVERY_RECEIVING_CHANGED');
    const model = await openDestinationWorkspace({ directory: workspaceDirectory, sourceDirectory });
    try {
      return { operation: 'receive', ...receipt, retained: true, current: await model.state() };
    } finally { await model.close(); }
  }
  let exists = false;
  try { await lstat(target); exists = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (exists) return retained();
  try { return await receiveDestinationExchange(result.exchangeDirectory, target, result.fingerprint); }
  catch (error) {
    if (['PORTABLE_DESTINATION_EXISTS', 'EEXIST'].includes(error.code)) return retained();
    throw error;
  }
}
