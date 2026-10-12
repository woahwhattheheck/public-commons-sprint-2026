// MIT. Typed-action client and complete original-file receiving over maintained MCP.
import { join, dirname, resolve, basename } from 'node:path';
import { realpath } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { canonical, boundedFile } from '../../../sf46-release/release-core.mjs';
import { openMerchantFileClient, createRetainedDownload } from '../../../../../stellar-forge/mcp-merchant-operator/retained-download.mjs';
import { SNOWFLAKE_TOOL_PREFIX, snowflakeAction, snowflakeActions } from './catalog.mjs';
import { validateSnowflakeReceivingManifest, MAX_SNOWFLAKE_TRANSFER_CHUNK_BYTES } from '../transfer.mjs';
import { SNOWFLAKE_EXPORT_SCHEMA, SNOWFLAKE_EXPORT_MANIFEST, SNOWFLAKE_MAX_FILE_BYTES, SNOWFLAKE_MAX_MANIFEST_BYTES,
  parseSnowflakeExport, verifiedHandle, alias, fail, sha256 } from './files.mjs';
export { snowflakeActions, SNOWFLAKE_EXPORT_SCHEMA };
const decode = bytes => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
const terminal = new Set(['COMPLETE','FAILED','CANCELLED','REJECTED','INTERRUPTED','AUTH_REQUIRED','RESULT_UNAVAILABLE']);
function abortable(signal, timeoutMs) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3600000) throw fail('WAIT_INVALID');
  const deadline = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, deadline]) : deadline;
}
function clientOption(client) {
  if (!client || typeof client.call !== 'function' || typeof client.endpoint !== 'string') throw fail('CLIENT_REQUIRED');
  return client;
}
export async function openSnowflakeClient(options = {}) {
  const original = await openMerchantFileClient({ ...options, errorPrefix: 'SNOWFLAKE', clientName: 'starforge-snowflake-operator', maximumResponseBytes: 16 * 1024 * 1024 });
  const call = async (action, args = {}, requestOptions) => {
    const { definition } = snowflakeAction(action, args);
    return original.call(definition.name, args, requestOptions);
  };
  const named = Object.fromEntries(Object.keys(snowflakeActions).map(action =>
    [action.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()), (args = {}, requestOptions) => call(action, args, requestOptions)]));
  const awaitOperation = async ({ workspace, operationId }, { intervalMs = 250, timeoutMs = 300000, signal } = {}) => {
    if (!Number.isSafeInteger(intervalMs) || intervalMs < 25 || intervalMs > 60000) throw fail('WAIT_INVALID');
    const combined = abortable(signal, timeoutMs);
    while (true) {
      combined.throwIfAborted();
      const value = await call('operation', { workspace, operationId }, { requestSignal: combined });
      if (terminal.has(value.operation?.status)) return value;
      await delay(intervalMs, undefined, { signal: combined });
    }
  };
  /** Async history iteration follows the original nextOffset and rejects cursor cycles. */
  async function* pages(action, args, requestOptions) {
    if (!['sources','operations','observations','editions','rows','publications','exports'].includes(action)) throw fail('PAGE_INVALID');
    let offset = args?.offset ?? 0;
    const seen = new Set();
    while (true) {
      if (seen.has(offset)) throw fail('PAGE_CURSOR_CHANGED');
      seen.add(offset);
      const value = await call(action, { ...args, offset }, requestOptions);
      yield value;
      if (value.nextOffset === null) return;
      if (!Number.isSafeInteger(value.nextOffset) || value.nextOffset <= offset) throw fail('PAGE_CURSOR_CHANGED');
      offset = value.nextOffset;
    }
  }
  return Object.freeze({ endpoint: original.endpoint, call, ...named, awaitOperation, pages });
}
const downloads = createRetainedDownload({
  manifestName: SNOWFLAKE_EXPORT_MANIFEST, parseManifest: parseSnowflakeExport,
  maximumBytes: SNOWFLAKE_MAX_FILE_BYTES, maximumManifestBytes: SNOWFLAKE_MAX_MANIFEST_BYTES,
  maximumCheckpointBytes: 32 * 1024 * 1024, nestedFiles: true, validateExportId: alias,
  stateSchema: 'stellar-forge.snowflake-download.v1', resultSchema: 'stellar-forge.snowflake-download-result.v1',
  toolPrefix: SNOWFLAKE_TOOL_PREFIX.slice(0, -1), errorPrefix: 'SNOWFLAKE', clientName: 'starforge-snowflake-download',
  describe: manifest => ({ workspace: manifest.workspace, workspaceId: manifest.workspaceId, original: manifest.source }),
});
async function deliveryClient({ client, url, tokenEnv, environment, signal, exportId, expectedManifestSha256 }) {
  if (client && url !== undefined) throw fail('CLIENT_REQUIRED', 'Select one original client or endpoint.');
  const original = clientOption(client ?? await openSnowflakeClient({ url, tokenEnv, environment, signal }));
  const info = await original.call('manifest', { exportId }, { requestSignal: signal });
  if (typeof info.workspaceId !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(info.workspaceId) ||
      !/^[a-f0-9]{64}$/.test(info.manifestSha256 ?? '') ||
      expectedManifestSha256 !== undefined && info.manifestSha256 !== expectedManifestSha256) throw fail('EXPORT_CHANGED');
  // The original UUID, rather than a replacement loopback port, owns the checkpoint.
  return { client: { endpoint: 'snowflake-workspace:' + info.workspaceId,
    call: (name, args, requestOptions) => original.call(name, args, requestOptions) }, info };
}
export async function downloadSnowflakeExport(options = {}) {
  const { client, info } = await deliveryClient(options);
  const { url, client: supplied, tokenEnv, environment, ...selection } = options;
  return downloads.download({ ...selection, client, expectedManifestSha256: info.manifestSha256 });
}
export async function inspectSnowflakeExport(options = {}) {
  const { client } = await deliveryClient(options);
  return downloads.inspect({ client, exportId: options.exportId, signal: options.signal });
}
/** Reopen every original file, including nested merchant members and native SQLite. */
export async function reopenSnowflakeExport({ directory, exportId, expectedManifestSha256 } = {}) {
  alias(exportId);
  if (typeof directory !== 'string' || !directory || directory.includes('\0') ||
      expectedManifestSha256 !== undefined && !/^[a-f0-9]{64}$/.test(expectedManifestSha256)) throw fail('DOWNLOAD_CONFIGURATION');
  const root = resolve(directory);
  const manifestBytes = await downloads.bytesAt(join(root, SNOWFLAKE_EXPORT_MANIFEST), SNOWFLAKE_MAX_MANIFEST_BYTES);
  const manifestSha256 = sha256(manifestBytes), manifest = parseSnowflakeExport(manifestBytes, exportId);
  if (expectedManifestSha256 !== undefined && expectedManifestSha256 !== manifestSha256) throw fail('EXPORT_CHANGED');
  return downloads.lockedDownload(root, async context => {
    await downloads.loadContext(context, manifestBytes, exportId);
    for (const file of manifest.files) {
      context.lease.assertHeld();
      await downloads.verifiedFile(join(root, file.name), file);
    }
    const receiving = validateSnowflakeReceivingManifest(decode(await downloads.bytesAt(join(root, 'receiving.json'), 2097152)));
    const edition = decode(await downloads.bytesAt(join(root, 'edition.json'), SNOWFLAKE_MAX_MANIFEST_BYTES));
    if (receiving.editionId !== manifest.source.editionId || edition.id !== manifest.source.editionId ||
        receiving.sourceId !== manifest.source.sourceId ||
        receiving.partitions.some(part => !manifest.files.some(file =>
          file.name === part.path && file.bytes === part.bytes && file.sha256 === part.sha256))) throw fail('EXPORT_CHANGED');
    return { schema: 'stellar-forge.snowflake-download-result.v1', state: 'REOPENED', directory: root,
      exportId, workspace: manifest.workspace, workspaceId: manifest.workspaceId, original: manifest.source,
      manifestSha256, files: manifest.files.length, bytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0),
      verifiedFiles: manifest.files };
  });
}
/** Stream the original native partitions through the same durable server-side record. */
export async function uploadSnowflakeOriginals({
  client, url, tokenEnv, environment, workspace, manifestFile, chunkSize = MAX_SNOWFLAKE_TRANSFER_CHUNK_BYTES,
  expectedWorkspaceId, signal, onProgress, repairIncomplete = true,
} = {}) {
  alias(workspace);
  if (client && url !== undefined || typeof manifestFile !== 'string' || !manifestFile || manifestFile.includes('\0') ||
      !Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize > MAX_SNOWFLAKE_TRANSFER_CHUNK_BYTES ||
      typeof repairIncomplete !== 'boolean') throw fail('RECEIVING_CONFIGURATION');
  const original = clientOption(client ?? await openSnowflakeClient({ url, tokenEnv, environment, signal }));
  const path = resolve(manifestFile);
  if (await realpath(path) !== path) throw fail('RECEIVING_CONFIGURATION', 'Use the canonical original receiving manifest.');
  const manifest = validateSnowflakeReceivingManifest(decode(await boundedFile(dirname(path), basename(path), 2097152)));
  const transferId = sha256(canonical(manifest));
  const call = (action, args) => original.call(action, args, { requestSignal: signal });
  let response = await call('receive_begin', { workspace, manifest });
  const workspaceId = response.workspaceId;
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(workspaceId ?? '') ||
      expectedWorkspaceId !== undefined && expectedWorkspaceId !== workspaceId) throw fail('WORKSPACE_CHANGED');
  function coverage(value) {
    const transfer = value.transfer;
    if (value.workspaceId !== workspaceId || transfer?.id !== transferId || !Array.isArray(transfer.partitions) ||
        transfer.partitions.length !== manifest.partitions.length ||
        transfer.partitions.some((part, index) => {
          const expected = manifest.partitions[index];
          return part.partition !== index || part.sha256 !== expected.sha256 || part.bytes !== expected.bytes ||
            !Number.isSafeInteger(part.receivedBytes) || part.receivedBytes < 0 || part.receivedBytes > part.bytes;
        })) throw fail('RECEIVING_CHANGED', 'The server returned a different original receiving selection.');
    return transfer;
  }
  let transfer = coverage(response), resumedBytes = transfer.partitions.reduce((sum, part) => sum + part.receivedBytes, 0), uploadedBytes = 0;
  for (const descriptor of manifest.partitions) {
    signal?.throwIfAborted();
    const originalFile = await verifiedHandle(join(dirname(path), descriptor.path), descriptor);
    try {
      let current = transfer.partitions[descriptor.partition], repaired = false;
      while (!current.received) {
        // A crash after the final byte but before object publication replays the
        // original suffix and completes that same partition.
        const offset = current.receivedBytes === descriptor.bytes
          ? Math.max(0, descriptor.bytes - chunkSize) : current.receivedBytes;
        const bytes = Buffer.alloc(Math.min(chunkSize, descriptor.bytes - offset));
        let used = 0;
        while (used < bytes.length) {
          signal?.throwIfAborted();
          const part = await originalFile.handle.read(bytes, used, bytes.length - used, offset + used);
          if (!part.bytesRead) throw fail('RECEIVING_BYTES_CHANGED');
          used += part.bytesRead;
        }
        try {
          response = await call('receive_chunk', { workspace, transferId, partition: descriptor.partition,
            offset, data: bytes.toString('base64'), chunkSha256: sha256(bytes) });
        } catch (error) {
          if (!repairIncomplete || repaired || !['SNOWFLAKE_RECEIVING_PARTIAL_CHANGED','SNOWFLAKE_RECEIVING_BYTES_CHANGED'].includes(error.code)) throw error;
          response = await call('receive_repair', { workspace, transferId, partition: descriptor.partition });
          transfer = coverage(response); current = transfer.partitions[descriptor.partition]; repaired = true;
          await onProgress?.({ workspace, workspaceId, transferId, partition: descriptor.partition, repaired: true,
            receivedBytes: current.receivedBytes, partitionBytes: descriptor.bytes, resumedBytes, uploadedBytes });
          continue;
        }
        transfer = coverage(response);
        const after = transfer.partitions[descriptor.partition];
        if (!after.received && after.receivedBytes <= current.receivedBytes) throw fail('RECEIVING_CURSOR_CHANGED');
        current = after; uploadedBytes += bytes.length;
        await onProgress?.({ workspace, workspaceId, transferId, partition: descriptor.partition,
          receivedBytes: current.receivedBytes, partitionBytes: descriptor.bytes, resumedBytes, uploadedBytes });
      }
    } finally { await originalFile.handle.close(); }
  }
  response = await call('receive_commit', { workspace, transferId });
  transfer = coverage(response);
  if (transfer.status !== 'RECEIVED' || manifest.editionId && transfer.editionId !== manifest.editionId) throw fail('RECEIVING_INCOMPLETE');
  return { schema: 'stellar-forge.snowflake-upload-result.v1', state: 'RECEIVED', workspace, workspaceId,
    transferId, editionId: transfer.editionId, operationId: manifest.requestId.toLowerCase(),
    partitions: manifest.partitions.length, resumedBytes, uploadedBytes, transfer };
}
