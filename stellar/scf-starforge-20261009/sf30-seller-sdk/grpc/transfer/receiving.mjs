// MIT. Receive one original whole-workspace archive through the native engines.
import { dirname, resolve } from 'node:path';
import { fields, fail } from '../common.mjs';
import { inspectGrpcWorkspaceBinding, inspectGrpcWorkspaceParent } from '../workspace/binding.mjs';
import { transferId, transferSha, transferInteger, GRPC_TRANSFER_ARCHIVE_BYTES,
  validateGrpcTransferArchive, validateGrpcTransferManifest } from './manifest.mjs';
import { runArchiveHelper, transferDirectory } from './files.mjs';

export async function inspectGrpcWorkspaceArchive({ archivePath, expectedSha256, expectedBytes,
  expectedManifestSha256 }, { signal } = {}) {
  if (typeof archivePath !== 'string' || resolve(archivePath) !== archivePath)
    fail('GRPC_TRANSFER_ABSOLUTE_ARCHIVE_REQUIRED');
  if (expectedSha256 !== undefined) transferSha(expectedSha256);
  if (expectedBytes !== undefined) transferInteger(expectedBytes, GRPC_TRANSFER_ARCHIVE_BYTES, 1);
  if (expectedManifestSha256 !== undefined) transferSha(expectedManifestSha256);
  const result = await runArchiveHelper({ command: 'inspect', archivePath,
    ...(expectedSha256 === undefined ? {} : { expectedSha256 }),
    ...(expectedBytes === undefined ? {} : { expectedBytes }),
    ...(expectedManifestSha256 === undefined ? {} : { expectedManifestSha256 }) }, { signal });
  return validateGrpcTransferArchive(result);
}
export async function auditGrpcReceivedWorkspace(directory, manifest, { env = process.env } = {}) {
  await transferDirectory(directory);
  validateGrpcTransferManifest(manifest);
  // Import only the installed original engine. Received client/source files are
  // data examined by that engine; receiving never imports a customer's module.
  const { createGrpcWorkspace } = await import('../workspace/model.mjs');
  const model = await createGrpcWorkspace({ stateDirectory: directory, env });
  let result, originalIssue, closeIssue;
  try {
    result = await model.transferAudit(manifest);
  } catch (issue) { originalIssue = issue; }
  try { await model.close(); } catch (issue) { closeIssue = issue; }
  if (originalIssue || closeIssue) {
    if (originalIssue && closeIssue) throw Object.assign(new AggregateError([originalIssue, closeIssue],
      'GRPC_TRANSFER_NATIVE_RECEIVING_FAILED'), { code: 'GRPC_TRANSFER_NATIVE_RECEIVING_FAILED', status: 409 });
    throw originalIssue ?? closeIssue;
  }
  return { ...result, binding: await inspectGrpcWorkspaceBinding(directory) };
}
export async function receiveGrpcWorkspaceArchive(input, { signal, env = process.env, audit = true } = {}) {
  fields(input, ['archivePath', 'directory', 'expectedSha256', 'expectedBytes', 'expectedManifestSha256', 'operationId'],
    'GRPC_TRANSFER_RECEIVE_FIELDS_INVALID');
  transferId(input.operationId); transferSha(input.expectedSha256); transferSha(input.expectedManifestSha256);
  transferInteger(input.expectedBytes, GRPC_TRANSFER_ARCHIVE_BYTES, 1);
  if (typeof input.archivePath !== 'string' || resolve(input.archivePath) !== input.archivePath ||
    typeof input.directory !== 'string' || resolve(input.directory) !== input.directory ||
    input.directory === dirname(input.directory)) fail('GRPC_TRANSFER_ABSOLUTE_DIRECTORY_REQUIRED');
  await inspectGrpcWorkspaceParent(input.directory);
  const result = await runArchiveHelper({ command: 'receive', ...input }, { signal });
  validateGrpcTransferArchive(result);
  if (result.directory !== input.directory || result.receipt?.operationId !== input.operationId ||
    result.receipt.archiveSha256 !== input.expectedSha256 || result.receipt.archiveBytes !== input.expectedBytes ||
    result.receipt.manifestSha256 !== input.expectedManifestSha256 ||
    result.receipt.transferId !== result.manifest.id || result.received !== true)
    fail('GRPC_TRANSFER_RECEIVING_CHANGED', 409);
  const native = audit ? await auditGrpcReceivedWorkspace(result.directory, result.manifest, { env }) : undefined;
  return { ...result, ...(native ? { native } : {}) };
}
