// MIT. Resume the original transport, then bind all four files to the native upgrade.
import { downloadGrpcExport } from './grpc-workspace-download.mjs';
import { readGrpcUpgradeDirectory } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/upgrade-receiving.mjs';

export async function downloadGrpcUpgrade(options) {
  const { expectedReviewSha256, verifyNative = false, ...transportOptions } = options ?? {};
  const received = await downloadGrpcExport(transportOptions);
  if (received.kind !== 'upgrade') throw Object.assign(new Error('Select a complete original contract-upgrade export.'), { code: 'GRPC_UPGRADE_EXPORT_REQUIRED' });
  const value = await readGrpcUpgradeDirectory(received.directory, {
    expectedReviewSha256: expectedReviewSha256 ?? received.original.reviewSha256, native: verifyNative,
  });
  if (value.summary.id !== received.original.operationId ||
      value.summary.baseRevision !== received.original.revision ||
      value.summary.reviewSha256 !== received.original.reviewSha256)
    throw Object.assign(new Error('The received records differ from the reviewed export identity.'), { code: 'GRPC_UPGRADE_RECEIVING_CHANGED' });
  return { ...received, upgrade: value.summary };
}
