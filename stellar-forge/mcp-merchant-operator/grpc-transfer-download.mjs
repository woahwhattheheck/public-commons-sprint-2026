// MIT. Complete original merchant-file receiving followed by native workspace relocation.
import { dirname, resolve, join } from 'node:path';
import { downloadGrpcExport, inspectGrpcExport } from './grpc-workspace-download.mjs';
import { GRPC_EXPORT_MANIFEST, grpcHash, parseGrpcExportManifest } from './grpc-workspace-export.mjs';
import { GRPC_TRANSFER_MANIFEST, GRPC_TRANSFER_ARCHIVE, GRPC_TRANSFER_ARCHIVE_BYTES,
  transferId, transferSha, transferInteger, validateGrpcTransferManifest } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/transfer/manifest.mjs';
import { transferRead, transferDirectory } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/transfer/files.mjs';
import { inspectGrpcWorkspaceParent } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/workspace/binding.mjs';
import { receiveGrpcWorkspaceArchive } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/transfer/receiving.mjs';
const fail = message => { throw Object.assign(new Error(message), { code: 'GRPC_TRANSFER_EXPORT_CHANGED' }); };
function selected(manifest, input) {
  if (manifest.kind !== 'workspace-transfer' || manifest.original.topic !== 'workspace-transfer' ||
    manifest.original.snapshotSha256 !== input.expectedTransferManifestSha256) fail('Select the reviewed original complete workspace-transfer export.');
  const archive = manifest.files.find(file => file.path === GRPC_TRANSFER_ARCHIVE);
  if (!archive || archive.sha256 !== input.expectedArchiveSha256 || archive.bytes !== input.expectedArchiveBytes)
    fail('The received archive must match the original complete SHA256 and byte length.');
  return archive;
}
/**
 * expectedManifestSha256 identifies the outer merchant export file.
 * expectedTransferManifestSha256 identifies the original canonical native manifest.
 * directory is the retained download folder; destination is the distinct new native workspace.
 */
export async function downloadGrpcWorkspaceTransfer(options) {
  const { destination, operationId, expectedTransferManifestSha256, expectedArchiveSha256, expectedArchiveBytes,
    receivingEnvironment = process.env, ...download } = options ?? {};
  transferId(operationId); transferSha(expectedTransferManifestSha256); transferSha(expectedArchiveSha256);
  transferSha(download.expectedManifestSha256); transferInteger(expectedArchiveBytes, GRPC_TRANSFER_ARCHIVE_BYTES, 1);
  if (typeof destination !== 'string' || resolve(destination) !== destination ||
    typeof download.directory !== 'string' || resolve(download.directory) !== download.directory ||
    destination === download.directory || destination.startsWith(download.directory + '/') || download.directory.startsWith(destination + '/'))
    fail('Use distinct canonical absolute download and receiving directories.');
  await inspectGrpcWorkspaceParent(destination);
  await transferDirectory(dirname(download.directory));
  const reviewed = await inspectGrpcExport(download);
  if (reviewed.manifestSha256 !== download.expectedManifestSha256) fail('The original merchant export manifest changed.');
  selected(reviewed.manifest, { expectedTransferManifestSha256, expectedArchiveSha256, expectedArchiveBytes });
  const received = await downloadGrpcExport(download);
  const outerBytes = await transferRead(join(received.directory, GRPC_EXPORT_MANIFEST), 65000);
  if (grpcHash(outerBytes) !== download.expectedManifestSha256) fail('The retained outer manifest differs from the reviewed export.');
  const outer = parseGrpcExportManifest(outerBytes, received.exportId);
  selected(outer, { expectedTransferManifestSha256, expectedArchiveSha256, expectedArchiveBytes });
  const original = outer.files.find(file => file.path === GRPC_TRANSFER_MANIFEST);
  const bytes = await transferRead(join(received.directory, GRPC_TRANSFER_MANIFEST));
  if (bytes.length !== original.bytes || grpcHash(bytes) !== original.sha256) fail('The complete native manifest differs from its delivery.');
  const manifest = validateGrpcTransferManifest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  if (manifest.id !== outer.original.operationId || manifest.sha256 !== expectedTransferManifestSha256)
    fail('The native manifest belongs to a different original workspace capture.');
  const native = await receiveGrpcWorkspaceArchive({
    archivePath: join(received.directory, GRPC_TRANSFER_ARCHIVE), directory: destination, operationId,
    expectedSha256: expectedArchiveSha256, expectedBytes: expectedArchiveBytes,
    expectedManifestSha256: expectedTransferManifestSha256,
  }, { signal: download.signal, env: receivingEnvironment });
  return { ...received, transferId: manifest.id, transferManifestSha256: manifest.sha256,
    archiveSha256: expectedArchiveSha256, archiveBytes: expectedArchiveBytes,
    receivedWorkspace: native.directory, originalReceiving: native.receipt, native: native.native, reused: native.reused };
}
