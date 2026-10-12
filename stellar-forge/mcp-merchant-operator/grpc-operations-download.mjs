// MIT. Complete incident receiving through the original gRPC file transport.
import { join } from 'node:path';
import { readBytes } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/common.mjs';
import { readGrpcOperations } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/operations/receiving.mjs';
import { downloadGrpcExport } from './grpc-workspace-download.mjs';
import { GRPC_EXPORT_MANIFEST, parseGrpcExportManifest } from './grpc-workspace-export.mjs';
export async function downloadGrpcOperationsExport(options) {
  const received = await downloadGrpcExport(options);
  const manifest = parseGrpcExportManifest(await readBytes(join(received.directory, GRPC_EXPORT_MANIFEST), 65000), received.exportId);
  if (manifest.kind !== 'operations') throw Object.assign(new Error('Choose the original complete incident export.'), { code:'GRPC_OPERATIONS_EXPORT_REQUIRED' });
  const original = await readGrpcOperations(received.directory);
  if (manifest.original.operationId !== original.incident.id || manifest.original.reviewSha256 !== original.incident.sha256 ||
      manifest.original.snapshotSha256 !== original.capture.captureSha256 || manifest.original.topic !== 'operations:' + original.exportSha256 ||
      manifest.files.length !== original.files.length || manifest.files.some((file, index) =>
        file.path !== original.files[index].path || file.bytes !== original.files[index].bytes || file.sha256 !== original.files[index].sha256))
    throw Object.assign(new Error('The complete incident differs from its original file manifest.'), { code:'GRPC_OPERATIONS_EXPORT_CHANGED' });
  return { ...received, operations:original };
}
