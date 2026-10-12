// MIT. Full original WebDAV file receiving through the maintained durable writer.
import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { createRetainedDownload } from './retained-download.mjs';
import {
  WEBDAV_RECEIVING_MANIFEST, WEBDAV_MAX_FILE_BYTES, WEBDAV_MAX_MANIFEST_BYTES,
  createWebDavReceivingManifest, parseWebDavReceivingManifest, validateWebDavFileSelector,
  validateWebDavFileMetadata, webDavError, webDavHash, webDavUuid, webDavSha,
  webDavRelativeFile, webDavPlain
} from './webdav-workspace-contracts.mjs';

const PREFIX = 'webdav_client_download';
function originalClient(client) {
  if (!client || typeof client.file !== 'function' || typeof client.readJsonFile !== 'function'
      || typeof client.assertWorkspace !== 'function' || typeof client.endpoint !== 'string')
    throw webDavError('WEBDAV_CLIENT_REQUIRED', 'Use createWebDavWorkspaceClient with the original merchant endpoint.');
  return client;
}
function exportMembers(value, id) {
  if (!webDavPlain(value) || value.schema !== 'stellar-forge.webdav-merchant-export.v1' || value.id !== id
      || !Array.isArray(value.files) || value.files.length < 4 || value.files.length > 8000)
    throw webDavError('WEBDAV_RECEIVING_EXPORT_INVALID', 'Select the complete original merchant export manifest.');
  const names = new Set();
  for (const file of value.files) {
    webDavRelativeFile(file?.path);
    if (file.path === 'manifest.json' || names.has(file.path))
      throw webDavError('WEBDAV_RECEIVING_EXPORT_INVALID', 'Original export members must be unique and preserve their manifest separately.');
    validateWebDavFileMetadata({ ...file, name: file.path }); names.add(file.path);
  }
  for (const name of ['dataset.csv','dataset.json','source.json','seller.json'])
    if (!names.has(name)) throw webDavError('WEBDAV_RECEIVING_EXPORT_INCOMPLETE', 'The complete export requires its four original native entrypoints.');
  return value.files;
}
async function describeFile(client, workspace, input, options) {
  const selector = validateWebDavFileSelector(input.selector);
  const name = webDavRelativeFile(input.name);
  if (input.expectedSha256 !== undefined) webDavSha(input.expectedSha256);
  let value;
  try {
    value = await client.file({ workspace, ...selector, limit: 1,
      ...(input.expectedSha256 ? { expectedSha256: input.expectedSha256 } : {}) }, options);
    validateWebDavFileMetadata(value.file);
    if (input.expectedSha256 && value.file.sha256 !== input.expectedSha256)
      throw webDavError('WEBDAV_RECEIVING_FILE_CHANGED', 'The selected original file has a different SHA256.');
    return { name, remoteName: value.file.name, bytes: value.file.bytes, sha256: value.file.sha256, selector };
  } finally {
    if (value?.readId && value.nextOffset !== null)
      await client.releaseFile({ workspace, readId: value.readId }, { requestSignal: null, timeoutMs: 2000 }).catch(() => {});
  }
}
/** Read-only selection. A full export always includes every native manifest member. */
export async function prepareWebDavReceiving({
  client, workspace, exportId, expectedManifestSha256, files
}, options = {}) {
  originalClient(client);
  if ((exportId !== undefined) === (files !== undefined))
    throw webDavError('WEBDAV_RECEIVING_SELECTION', 'Choose one complete merchant export or an explicit set of original files.');
  const status = await client.status({ workspace }, options);
  if (status.state !== 'OPEN' || !status.native?.id)
    throw webDavError('WEBDAV_CLIENT_WORKSPACE_CLOSED', 'Open the original workspace before selecting its retained source files.');
  const workspaceId = webDavUuid(status.native.id);
  let source, selected;
  if (exportId !== undefined) {
    webDavUuid(exportId);
    const original = await client.readJsonFile({ workspace,
      selector: { kind: 'export', id: exportId, filename: 'manifest.json' },
      expectedSha256: expectedManifestSha256, maximumBytes: WEBDAV_MAX_MANIFEST_BYTES }, options);
    if (original.file.name !== 'manifest.json') throw webDavError('WEBDAV_RECEIVING_EXPORT_INVALID', 'The selected native export manifest has changed its filename.');
    const members = exportMembers(original.value, exportId);
    source = { mode: 'export', id: exportId, manifestSha256: original.file.sha256,
      editionId: original.value.editionId, merchantId: original.value.merchantId, snapshot: original.value.snapshot };
    selected = [{ name: 'manifest.json', remoteName: original.file.name, bytes: original.file.bytes,
      sha256: original.file.sha256, selector: { kind: 'export', id: exportId, filename: 'manifest.json' } },
      ...members.map(file => ({ name: file.path, remoteName: file.path, bytes: file.bytes, sha256: file.sha256,
        selector: { kind: 'export', id: exportId, filename: file.path } }))];
  } else {
    if (!Array.isArray(files) || !files.length || files.length > 8000)
      throw webDavError('WEBDAV_RECEIVING_SELECTION', 'Select 1–8000 complete original files with unique receiving paths.');
    source = { mode: 'files' }; selected = [];
    for (const file of files) selected.push(await describeFile(client, workspace, file, options));
  }
  await client.assertWorkspace({ workspace, workspaceId }, options);
  const result = createWebDavReceivingManifest({ endpoint: client.endpoint, workspace, workspaceId, source, files: selected });
  return { manifest: result.manifest, manifestSha256: result.sha256 };
}
function receiver() {
  return createRetainedDownload({
    manifestName: WEBDAV_RECEIVING_MANIFEST, parseManifest: parseWebDavReceivingManifest,
    maximumBytes: WEBDAV_MAX_FILE_BYTES, maximumManifestBytes: WEBDAV_MAX_MANIFEST_BYTES,
    maximumCheckpointBytes: 16 * 1024 * 1024, nestedFiles: true,
    stateSchema: 'stellar-forge.webdav-client-download-state.v1',
    resultSchema: 'stellar-forge.webdav-client-download-result.v1',
    toolPrefix: PREFIX, errorPrefix: 'WEBDAV', clientName: 'starforge-webdav-receiving',
    validateExportId: webDavSha,
    describe: manifest => ({ workspace: manifest.workspace, workspaceId: manifest.workspaceId,
      source: manifest.source, originalEndpoint: manifest.endpoint })
  });
}
async function receivingTransport(client, manifest, bytes, options) {
  originalClient(client);
  if (client.endpoint !== manifest.endpoint) throw webDavError('WEBDAV_RECEIVING_ENDPOINT_CHANGED', 'Use the original selected merchant endpoint for this saved receiving plan.');
  await client.assertWorkspace({ workspace: manifest.workspace, workspaceId: manifest.workspaceId }, options);
  const manifestSha256 = webDavHash(bytes), readId = randomUUID();
  const manifestFile = { name: WEBDAV_RECEIVING_MANIFEST, bytes: bytes.length, sha256: manifestSha256 };
  const files = new Map(manifest.files.map(file => [file.name, file]));
  return { endpoint: client.endpoint,
    async call(name, args, callOptions = options) {
      if (args.exportId !== manifest.exportId) throw webDavError('WEBDAV_RECEIVING_ID_CHANGED', 'Continue this original receiving selection.');
      if (name === PREFIX + '_manifest')
        return { state: 'MANIFEST_RETAINED', exportId: manifest.exportId, manifestFile };
      if (name === PREFIX + '_file_release') {
        if (args.readId === readId) return { released: true };
        return client.releaseFile({ workspace: manifest.workspace, readId: args.readId }, callOptions);
      }
      if (name !== PREFIX + '_file' || args.expectedManifestSha256 !== manifestSha256)
        throw webDavError('WEBDAV_RECEIVING_REQUEST_CHANGED', 'Use the saved original receiving manifest and file selectors.');
      if (args.file === WEBDAV_RECEIVING_MANIFEST) {
        if (args.expectedSha256 !== manifestSha256 || args.readId && args.readId !== readId)
          throw webDavError('WEBDAV_RECEIVING_REQUEST_CHANGED', 'Continue the same original receiving manifest.');
        const chunk = bytes.subarray(args.offset, args.offset + args.limit), next = args.offset + chunk.length;
        return { exportId: manifest.exportId, manifestSha256, readId, file: manifestFile,
          offset: args.offset, bytesRead: chunk.length, nextOffset: next < bytes.length ? next : null,
          encoding: 'base64', data: chunk.toString('base64') };
      }
      const selected = files.get(args.file);
      if (!selected || selected.sha256 !== args.expectedSha256)
        throw webDavError('WEBDAV_RECEIVING_REQUEST_CHANGED', 'Read only the exact original members from this selection.');
      const result = await client.file({ workspace: manifest.workspace, ...selected.selector,
        expectedSha256: selected.sha256, offset: args.offset, limit: args.limit,
        ...(args.readId ? { readId: args.readId } : {}) }, callOptions);
      if (result.file?.name !== selected.remoteName || result.file?.bytes !== selected.bytes || result.file?.sha256 !== selected.sha256)
        throw webDavError('WEBDAV_RECEIVING_FILE_CHANGED', 'The native file differs from the reviewed receiving selection.');
      // The common writer owns byte validation, partial recovery, lease and publication.
      // Only the caller's selected local path is different from the native filename.
      return { ...result, file: { ...result.file, name: selected.name }, exportId: manifest.exportId, manifestSha256 };
    }
  };
}
async function verifyNativeExport(writer, directory, manifest) {
  if (manifest.source.mode !== 'export') return;
  const bytes = await writer.bytesAt(join(directory, 'manifest.json'), WEBDAV_MAX_MANIFEST_BYTES);
  if (webDavHash(bytes) !== manifest.source.manifestSha256)
    throw webDavError('WEBDAV_RECEIVING_EXPORT_CHANGED', 'The received native manifest differs from the selected original.');
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw webDavError('WEBDAV_RECEIVING_EXPORT_INVALID', 'The received original export manifest is invalid.'); }
  const originals = exportMembers(value, manifest.source.id);
  if (manifest.source.editionId !== value.editionId || manifest.source.merchantId !== value.merchantId
      || manifest.source.snapshot !== value.snapshot)
    throw webDavError('WEBDAV_RECEIVING_EXPORT_CHANGED', 'The original export edition, merchant and snapshot must stay with their selected files.');
  if (manifest.files.length !== originals.length + 1)
    throw webDavError('WEBDAV_RECEIVING_EXPORT_INCOMPLETE', 'Receive every member of the original native export.');
  const selected = new Map(manifest.files.map(file => [file.name, file]));
  for (const file of originals) {
    const received = selected.get(file.path);
    if (!received || received.bytes !== file.bytes || received.sha256 !== file.sha256)
      throw webDavError('WEBDAV_RECEIVING_EXPORT_CHANGED', 'The received member set differs from the original native export.');
  }
}
/** Reusing the same directory resumes verified original prefixes; no source capture is made. */
export async function downloadWebDavReceiving({
  client, manifest: input, directory, signal, chunkSize, onProgress, expectedManifestSha256
} = {}) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(JSON.stringify(input, null, 2) + '\n');
  const manifest = parseWebDavReceivingManifest(bytes);
  if (expectedManifestSha256 !== undefined && webDavHash(bytes) !== webDavSha(expectedManifestSha256))
    throw webDavError('WEBDAV_RECEIVING_MANIFEST_CHANGED', 'The saved receiving plan differs from the reviewed bytes.');
  const writer = receiver(), adapter = await receivingTransport(client, manifest, bytes, { requestSignal: signal });
  const result = await writer.download({ client: adapter, exportId: manifest.exportId, directory,
    signal, chunkSize, onProgress, expectedManifestSha256: webDavHash(bytes) });
  await verifyNativeExport(writer, result.directory, manifest);
  return { ...result, manifestFile: join(result.directory, WEBDAV_RECEIVING_MANIFEST) };
}
/** Verify and reopen the full received files in a fresh process, without a network client. */
export async function inspectWebDavReceiving({ directory, expectedManifestSha256, signal } = {}) {
  const writer = receiver(), root = resolve(directory);
  const bytes = await writer.bytesAt(join(root, WEBDAV_RECEIVING_MANIFEST), WEBDAV_MAX_MANIFEST_BYTES);
  const manifest = parseWebDavReceivingManifest(bytes), sha256 = webDavHash(bytes);
  if (expectedManifestSha256 !== undefined && sha256 !== webDavSha(expectedManifestSha256))
    throw webDavError('WEBDAV_RECEIVING_MANIFEST_CHANGED', 'The retained receiving manifest differs from the selected original.');
  return writer.lockedDownload(root, async context => {
    for (const file of manifest.files) await writer.verifiedFile(join(context.root, file.name), file, signal);
    await verifyNativeExport(writer, root, manifest);
    return { schema: 'stellar-forge.webdav-client-offline-receiving.v1', state: 'COMPLETE',
      directory: root, manifestSha256: sha256, manifest,
      files: manifest.files.length, bytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0) };
  });
}
/** Use the original source packet importer on a fresh receiving workspace. */
export async function restoreWebDavSourcePacket({
  directory, file, destination, python = 'python3', expectedManifestSha256, signal
} = {}) {
  const inspected = await inspectWebDavReceiving({ directory, expectedManifestSha256, signal });
  const selected = inspected.manifest.files.find(row => row.name === file);
  if (!selected || selected.selector.kind !== 'packet')
    throw webDavError('WEBDAV_RECEIVING_PACKET_REQUIRED', 'Select the original source-packet member in this completed receiving.');
  const { inspectSourcePacket, importSourcePacket } = await import(
    '../../stellar/scf-starforge-20261009/sf30-seller-sdk/webdav/packet.mjs');
  const input = join(inspected.directory, selected.name);
  const original = await inspectSourcePacket({ input, python, signal });
  if (original.source?.sha256 !== selected.sha256 || original.source?.bytes !== selected.bytes)
    throw webDavError('WEBDAV_RECEIVING_PACKET_CHANGED', 'The original packet differs from the completed receiving selection.');
  const restored = await importSourcePacket({ input, directory: resolve(destination), python, signal });
  if (restored.source?.sha256 !== selected.sha256 || restored.source?.bytes !== selected.bytes)
    throw webDavError('WEBDAV_RECEIVING_PACKET_CHANGED', 'Inspect the original receiving destination; its source changed during import.');
  return { ...restored, originalReceivingId: inspected.manifest.exportId, originalWorkspaceId: inspected.manifest.workspaceId };
}
