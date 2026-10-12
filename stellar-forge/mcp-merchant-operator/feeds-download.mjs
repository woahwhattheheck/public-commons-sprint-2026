// MIT. Original retained downloader, scoped to the original feed workspace.
import { lstat, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createRetainedDownload, openMerchantFileClient } from './retained-download.mjs';
import { FEEDS_MANIFEST_NAME, MAX_FEEDS_DELIVERY_BYTES, parseFeedsDeliveryManifest, feedsManifestSha256 } from './feeds-manifest.mjs';
const fail = (code, message) => Object.assign(new Error(message), { code });
const SHA = /^[0-9a-f]{64}$/;
function original(workspace) {
  if (typeof workspace !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(workspace))
    throw fail('FEEDS_DOWNLOAD_CONFIGURATION', 'Select the original configured feed workspace alias.');
  return createRetainedDownload({
    manifestName: FEEDS_MANIFEST_NAME, parseManifest: (bytes, exportId) => {
      const value = parseFeedsDeliveryManifest(bytes, exportId);
      if (value.workspace !== workspace) throw fail('FEEDS_EXPORT_CONFLICT', 'The delivery belongs to another workspace.');
      return value;
    },
    maximumBytes: MAX_FEEDS_DELIVERY_BYTES, stateSchema: 'stellar-forge.feeds-download-state.v1',
    resultSchema: 'stellar-forge.feeds-download.v1', toolPrefix: 'merchant_feeds_download',
    errorPrefix: 'FEEDS', clientName: 'starforge-feed-receiving',
    describe: manifest => ({ workspace: manifest.workspace, kind: manifest.kind, selection: manifest.selection }),
    connect: async options => scopedClient(workspace, options),
  });
}
async function scopedClient(workspace, { client, ...options }) {
  // The same endpoint string is the original durable download identity.
  if (client !== undefined && (options.url !== undefined || !client || typeof client.call !== 'function' ||
      typeof client.endpoint !== 'string' || !client.endpoint.trim() || client.endpoint.length > 4096 || /[\0\r\n]/.test(client.endpoint)))
    throw fail('FEEDS_DOWNLOAD_CONFIGURATION', 'Select one original client or its MCP URL.');
  const selected = client ?? await openMerchantFileClient(options);
  return Object.freeze({ endpoint: selected.endpoint,
    call(name, input, callOptions = {}) {
      if (input.workspace !== undefined && input.workspace !== workspace)
        throw fail('FEEDS_EXPORT_CONFLICT', 'The file request belongs to another workspace.');
      return selected.call(name, { ...input, workspace },
        { requestSignal: options.signal, ...callOptions });
    },
  });
}
function expectedDigest(actual, expected) {
  if (expected !== undefined && (typeof expected !== 'string' || !SHA.test(expected) || actual !== expected))
    throw fail('FEEDS_DOWNLOAD_EXPORT_CHANGED', 'The complete original manifest differs from the selected SHA256.');
}
export async function downloadFeedsDelivery({ workspace, ...options } = {}) {
  const transfer = original(workspace);
  if (options.client === undefined) return transfer.download(options);
  const client = await scopedClient(workspace, options);
  return transfer.download({ ...options, url: undefined, client });
}
export async function inspectFeedsDelivery({ workspace, ...options } = {}) {
  const transfer = original(workspace);
  const result = options.client === undefined ? await transfer.inspect(options)
    : await transfer.inspect({ ...options, url: undefined, client: await scopedClient(workspace, options) });
  expectedDigest(result.manifestSha256, options.expectedManifestSha256); return result;
}
/** Verify every completed original file locally, using its existing download state. */
export async function reopenFeedsDelivery({ workspace, directory, exportId, expectedManifestSha256, expectedEndpoint, signal } = {}) {
  const transfer = original(workspace); signal?.throwIfAborted();
  if (typeof directory !== 'string' || !directory || directory.includes('\0'))
    throw fail('FEEDS_DOWNLOAD_CONFIGURATION', 'Select the completed private delivery directory.');
  const root = resolve(directory), info = await lstat(root);
  if (!info.isDirectory() || await realpath(root) !== root)
    throw fail('FEEDS_DOWNLOAD_PRIVATE_DIRECTORY_REQUIRED', 'Reopen the original canonical download directory.');
  // Read before acquiring the original lease so an absent completion does not
  // create a new download or turn a partial result into a completed result.
  const preliminary = await transfer.bytesAt(join(root, FEEDS_MANIFEST_NAME), 65000);
  let selectedId;
  try { selectedId = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(preliminary)).exportId; }
  catch { throw fail('FEEDS_DELIVERY_MANIFEST', 'The complete original manifest must be valid UTF-8 JSON.'); }
  if (exportId !== undefined && exportId !== selectedId)
    throw fail('FEEDS_EXPORT_CONFLICT', 'This completed directory belongs to another original export.');
  return transfer.lockedDownload(root, async context => {
    signal?.throwIfAborted();
    const bytes = await transfer.bytesAt(join(context.root, FEEDS_MANIFEST_NAME), 65000);
    if (!bytes.equals(preliminary)) throw fail('FEEDS_DOWNLOAD_FILE_CHANGED', 'The completion changed while acquiring its original writer.');
    const manifest = parseFeedsDeliveryManifest(bytes, selectedId), digest = feedsManifestSha256(bytes);
    expectedDigest(digest, expectedManifestSha256);
    await transfer.loadContext(context, bytes, selectedId, expectedEndpoint);
    for (const file of manifest.files) {
      signal?.throwIfAborted(); context.lease.assertHeld();
      await transfer.verifiedFile(join(context.root, file.name), file, signal);
    }
    context.lease.assertHeld();
    for (const file of manifest.files)
      context.state.files[file.name] = { bytes: file.bytes, sha256: file.sha256, complete: true };
    await transfer.checkpoint(context);
    return { schema: 'stellar-forge.feeds-download.v1', state: 'REOPENED', directory: context.root,
      workspace: manifest.workspace, exportId: manifest.exportId, kind: manifest.kind,
      selection: manifest.selection, manifest, manifestSha256: digest,
      files: manifest.files.length, bytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0) };
  });
}
