// MIT. Receive the original immutable health export with its native identities.
import { join } from 'node:path';
import { readBytes } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/common.mjs';
import { readGrpcHealthSnapshotFile } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/health-receiving.mjs';
import { downloadGrpcExport } from './grpc-workspace-download.mjs';
import { GRPC_EXPORT_MANIFEST, parseGrpcExportManifest } from './grpc-workspace-export.mjs';

export async function downloadGrpcHealthExport(options) {
  const received = await downloadGrpcExport(options);
  const manifest = parseGrpcExportManifest(await readBytes(join(received.directory, GRPC_EXPORT_MANIFEST), 65000), received.exportId);
  if (manifest.kind !== 'health') throw Object.assign(new Error('Choose the original service-health export.'), { code: 'GRPC_HEALTH_EXPORT_REQUIRED' });
  const saved = await readGrpcHealthSnapshotFile(join(received.directory, 'grpc-health.json'), manifest.original.snapshotSha256);
  if (saved.value.operation.id !== manifest.original.operationId || saved.value.operation.revision !== manifest.original.revision ||
      saved.sha256 !== manifest.files[0].sha256 || saved.bytes.length !== manifest.files[0].bytes)
    throw Object.assign(new Error('The received health observation differs from its original export.'), { code: 'GRPC_HEALTH_RECORD_CHANGED' });
  return { ...received, healthFile: saved.path, snapshotSha256: saved.value.snapshotSha256, operation: saved.value.summary };
}
