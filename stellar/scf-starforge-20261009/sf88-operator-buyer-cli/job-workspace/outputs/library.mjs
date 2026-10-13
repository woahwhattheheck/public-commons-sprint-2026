// MIT. Derived file resources retain the original buyer/job result identity.
import { join } from 'node:path';
import { RESULT_PACKAGE_TYPE } from '../../../sf30-seller-sdk/jobs/outputs/contract.mjs';
import { reopenResultPackage } from '../../../sf30-seller-sdk/jobs/outputs/receive.mjs';
import { digest, jsonBytes } from '../../node/store.mjs';
import { resourceId, delivered, requireValue } from '../state.mjs';

export { RESULT_PACKAGE_TYPE };
export const outputDirectory = (directory, entryId) => join(directory, 'artifacts', entryId + '.outputs');
export function outputResourceId(directory, entryId, packageSha256, slot, sha256) {
  const memberId = digest(jsonBytes({ kind: 'paid-job-output', entryId, packageSha256, slot }));
  return resourceId(directory, memberId, sha256);
}
export function outputBinding(receipt) {
  const saved = delivered(receipt), accepted = receipt.acceptance;
  requireValue(saved?.contentType === RESULT_PACKAGE_TYPE, 'JOB_OUTPUT_PACKAGE_REQUIRED', 409);
  return { saved, job: { id: accepted.jobId, functionId: accepted.functionId,
    inputSha256: accepted.inputSha256, publicOrigin: new URL(accepted.resultUrl).origin,
    nativeSettlement: saved.nativeSettlement } };
}
export async function receivedOutputs({ directory, entryId, receipt, signal } = {}) {
  const { saved, job } = outputBinding(receipt);
  return reopenResultPackage({ directory: outputDirectory(directory, entryId), expected: saved, job, signal });
}
export function outputResources({ directory, entry, receipt, received }) {
  const accepted = receipt.acceptance, saved = delivered(receipt);
  return received.files.map(file => ({
    id: outputResourceId(directory, entry.id, saved.sha256, file.slot, file.sha256),
    intentId: null, inboxId: null, configSha256: received.job.configSha256,
    createdAt: receipt.retainedAt, queueState: null,
    method: 'GET', url: saved.sourceUrl, name: file.filename,
    path: file.path, bytes: file.bytes, sha256: file.sha256,
    contentType: file.contentType, deliveryStatus: 'SAVED',
    buyerStatus: receipt.purchase.status ?? null, httpStatus: receipt.purchase.httpStatus ?? null,
    paymentTerms: { scheme: null, network: null, asset: null, payTo: null, maxAtomic: null },
    source: { kind: 'paid-jobs', path: directory }, status: 'UNVERIFIED',
    job: { workspaceEntryId: entry.id, jobId: accepted.jobId, functionId: accepted.functionId,
      label: entry.label, inputSha256: accepted.inputSha256, acceptanceSha256: receipt.acceptanceSha256,
      completedRevision: saved.completedRevision, nativeSettlement: saved.nativeSettlement,
      purchaseKind: receipt.purchase.kind, statusUrl: accepted.statusUrl, resultUrl: accepted.resultUrl,
      deliveredAt: saved.deliveredAt },
  }));
}
