// MIT. Offline source/cache handoff inside the existing retained runtime workspace.
import { readdir, lstat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { reviewRuntimeTransfer, exportRuntimeTransfer, inspectRuntimeTransfer, beginRuntimeTransferReceive,
  receiveRuntimeTransferPart, completeRuntimeTransferReceive, openRuntimeTransferDownload,
  installReceivedRuntime } from '../runtime-transfer.mjs';
import { MAX_MANIFEST_BYTES, MAX_PART_BYTES } from '../runtime-transfer-lock.mjs';
import { plain, now, digest, canonical, json, need, absolute, recordId, operationId,
  privateDirectory, makePrivate, readJSON, saveJSON, operationLease, operationRunning } from './storage.mjs';

export const transferOperationFields = {
  'transfer-export': ['runtimeId', 'label', 'cache', 'offline', 'lockSha256', 'partBytes'],
  'transfer-complete': ['cacheTransferId', 'populateCache'],
  'transfer-install': ['cacheTransferId', 'name', 'nodeHeaders', 'install'],
  'transfer-recover': ['cacheTransferId', 'runtimeId', 'name', 'nodeHeaders', 'install'],
};
const base = root => join(root, 'runtime-transfers');
const metadata = (root, id) => join(base(root), 'records', recordId(id) + '.json');
async function ensure(path) {
  try { return await makePrivate(path); }
  catch (error) { if (error.code !== 'EEXIST') throw error; return privateDirectory(path); }
}
export async function initializeTransferWorkspace(root) {
  await ensure(base(root));
  await ensure(join(base(root), 'records'));
  await ensure(join(base(root), 'cohorts'));
}
async function entry(root, id) {
  const item = await readJSON(metadata(root, id));
  need(item?.id === id && typeof item.directory === 'string', 'RUNTIME_TRANSFER_ENTRY_INVALID');
  absolute(item.directory);
  return item;
}
async function retain(root, directory, label, extra = {}) {
  absolute(directory);
  need(typeof label === 'string' && label.trim() && label.length <= 120, 'RUNTIME_TRANSFER_LABEL_INVALID');
  const id = digest(directory).slice(0, 24), path = metadata(root, id), existing = await readJSON(path, true);
  if (existing) {
    need(existing.directory === directory, 'RUNTIME_TRANSFER_ENTRY_COLLISION'); return existing;
  }
  const item = { id, directory, label: label.trim(), createdAt: now(), ...extra };
  try { await saveJSON(path, item); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  return entry(root, id);
}
function summary(item, view) {
  return { ...item, mode: view.state?.mode ?? item.mode, phase: view.state?.phase ?? 'PREPARING',
    runtime: view.manifest?.runtime ?? view.state?.runtime ?? null,
    transferId: view.manifest?.transferId ?? null, manifestSha256: view.manifestSha256,
    complete: view.complete, partCount: view.parts?.length ?? 0,
    missingPartCount: view.missingParts?.length ?? 0, invalidPartCount: view.invalidParts?.length ?? 0,
    packageCount: view.manifest?.artifacts.length ?? view.state?.totalPackages ?? 0,
    payloadBytes: view.manifest?.payload.bytes ?? null,
    error: view.state?.error ?? null, progress: {
      completedPackages: view.state?.completedPackages ?? null, totalPackages: view.state?.totalPackages ?? null,
      cachedArtifacts: view.state?.cachedArtifacts?.length ?? null },
    cacheDirectory: view.cacheDirectory ?? null, filesDirectory: view.filesDirectory ?? null };
}
export async function runtimeTransferWorkspaceState(root, { cacheTransferId = null } = {}) {
  await initializeTransferWorkspace(root);
  const ids = (await readdir(join(base(root), 'records'))).filter(name => /^[a-f0-9]{24}\.json$/.test(name));
  const transfers = [];
  for (const name of ids) {
    const item = await readJSON(join(base(root), 'records', name));
    try { transfers.push(summary(item, await inspectRuntimeTransfer({ directory: item.directory }))); }
    catch (error) { transfers.push({ ...item, phase: error.code === 'ENOENT' ? 'PREPARING' : 'UNAVAILABLE',
      error: { code: error.code ?? 'RUNTIME_TRANSFER_INSPECTION_FAILED' } }); }
  }
  transfers.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const selected = cacheTransferId ? await entry(root, recordId(cacheTransferId)) : null;
  let inspected = null;
  if (selected) {
    try { inspected = { ...selected, ...await inspectRuntimeTransfer({ directory: selected.directory }) }; }
    catch (error) { inspected = { ...selected, state: { mode: selected.mode, phase: error.code === 'ENOENT' ? 'PREPARING' : 'UNAVAILABLE' },
      complete: false, manifest: null, parts: [], error: { code: error.code ?? 'RUNTIME_TRANSFER_INSPECTION_FAILED' } }; }
  }
  return { transfers, selected: inspected, maximumPartBytes: MAX_PART_BYTES, maximumManifestBytes: MAX_MANIFEST_BYTES };
}
export async function reviewWorkspaceRuntimeTransfer(root, { runtimeId, runtimeDirectory } = {}) {
  recordId(runtimeId);
  return { runtimeId, ...await reviewRuntimeTransfer({ runtimeDirectory: absolute(runtimeDirectory) }) };
}
export async function attachWorkspaceRuntimeTransfer(root, { directory, label } = {}) {
  await initializeTransferWorkspace(root);
  const path = await privateDirectory(absolute(directory));
  const view = await inspectRuntimeTransfer({ directory: path, verify: true });
  const item = await retain(root, path, label ?? basename(path), { mode: view.state.mode });
  return { cacheTransferId: item.id, transfer: summary(item, view), reopened: true };
}
export async function prepareWorkspaceRuntimeTransferReceive(root, { manifest, manifestSha256, requestId, label } = {}) {
  await initializeTransferWorkspace(root); operationId(requestId);
  need(label === undefined || typeof label === 'string' && label.trim() && label.length <= 120, 'RUNTIME_TRANSFER_LABEL_INVALID');
  need(typeof manifest === 'string' && Buffer.byteLength(manifest) <= MAX_MANIFEST_BYTES, 'RUNTIME_TRANSFER_MANIFEST_LIMIT');
  const directory = join(base(root), 'cohorts', requestId);
  const view = await beginRuntimeTransferReceive({ directory, manifest, manifestSha256 });
  const item = await retain(root, directory, label ?? view.manifest.runtime.packageVersion, { mode: 'RECEIVE', requestId });
  return { cacheTransferId: item.id, transfer: summary(item, view), inspection: view };
}
export async function uploadWorkspaceRuntimeTransferPart(root, { cacheTransferId, index, body } = {}) {
  const selected = await entry(root, recordId(cacheTransferId));
  return receiveRuntimeTransferPart({ directory: selected.directory, index, body });
}
export async function downloadWorkspaceRuntimeTransfer(root, { cacheTransferId, kind, index } = {}) {
  const selected = await entry(root, recordId(cacheTransferId));
  return openRuntimeTransferDownload({ directory: selected.directory, kind, index });
}
async function activeLock(path) {
  try { if (!(await lstat(path)).isFile()) return false; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  return operationRunning(path);
}
export async function normalizeRuntimeTransferOperation(root, request, id, config) {
  await initializeTransferWorkspace(root);
  need(Object.hasOwn(transferOperationFields, request.operation), 'RUNTIME_TRANSFER_OPERATION_INVALID');
  if (request.populateCache !== undefined) need(typeof request.populateCache === 'boolean', 'RUNTIME_TRANSFER_OPTIONS_INVALID');
  if (request.operation === 'transfer-export') {
    need(request.runtimeDirectory && typeof request.cache === 'string' &&
      /^[a-f0-9]{64}$/.test(request.lockSha256 ?? ''), 'RUNTIME_TRANSFER_REVIEW_REQUIRED');
    need(request.offline === undefined || typeof request.offline === 'boolean', 'RUNTIME_TRANSFER_OPTIONS_INVALID');
    need(request.partBytes === undefined || Number.isInteger(request.partBytes) &&
      request.partBytes >= 65536 && request.partBytes <= MAX_PART_BYTES, 'RUNTIME_TRANSFER_PART_LIMIT');
    request.offline ??= true;
    request.transferDirectory = join(base(root), 'cohorts', id);
    const item = await retain(root, request.transferDirectory, request.label ?? 'Offline runtime transfer',
      { mode: 'EXPORT', runtimeId: request.runtimeId });
    request.cacheTransferId = item.id;
  } else {
    const selected = await entry(root, recordId(request.cacheTransferId));
    request.transferDirectory = selected.directory;
    const view = await inspectRuntimeTransfer({ directory: selected.directory });
    need(view.state.mode === 'RECEIVE', 'RUNTIME_TRANSFER_RECEIVER_REQUIRED');
    request.manifestSha256 = view.manifestSha256;
    if (['transfer-install', 'transfer-recover'].includes(request.operation)) {
      need(typeof request.name === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(request.name),
        'RUNTIME_WORKSPACE_NAME_INVALID');
      request.targetDirectory = join(config.runtimeHome, request.name);
      request.targetId = digest(request.targetDirectory).slice(0, 24);
      if (request.operation === 'transfer-recover')
        need(request.runtimeDirectory, 'RUNTIME_TRANSFER_RECOVERY_RUNTIME_REQUIRED');
    }
  }
  const names = (await readdir(join(root, 'operations'))).filter(name => /^[a-f0-9-]{36}$/.test(name));
  for (const oldId of names) {
    if (oldId === id) continue;
    const directory = join(root, 'operations', oldId), old = await readJSON(join(directory, 'request.json'), true);
    if (old?.cacheTransferId !== request.cacheTransferId) continue;
    const state = await readJSON(join(directory, 'state.json'), true);
    need(state?.phase !== 'QUEUED' && !(state?.phase === 'RUNNING' && await activeLock(join(directory, 'worker.lock'))),
      'RUNTIME_TRANSFER_OPERATION_RUNNING', 'Open the retained transfer operation before another change', 409);
  }
  return request;
}
export async function executeRuntimeTransferOperation(root, request, { checkpoint = async () => {} } = {}) {
  const selected = await entry(root, recordId(request.cacheTransferId));
  need(selected.directory === request.transferDirectory, 'RUNTIME_TRANSFER_ENTRY_CHANGED');
  const onProgress = transferProgress => checkpoint({ transferProgress });
  let result;
  if (request.operation === 'transfer-export') result = await exportRuntimeTransfer({
    runtimeDirectory: request.runtimeDirectory, directory: selected.directory, cache: request.cache,
    offline: request.offline, expectedLockSha256: request.lockSha256,
    ...(request.partBytes ? { partBytes: request.partBytes } : {}), onProgress,
  });
  else {
    const view = await inspectRuntimeTransfer({ directory: selected.directory });
    need(view.manifestSha256 === request.manifestSha256, 'RUNTIME_TRANSFER_REVIEW_CHANGED');
    if (request.operation === 'transfer-complete') result = await completeRuntimeTransferReceive({
      directory: selected.directory, populateCache: request.populateCache ?? true, onProgress,
    });
    else {
      result = await installReceivedRuntime({ directory: selected.directory, runtimeDirectory: request.targetDirectory,
        nodeHeaders: request.nodeHeaders ?? null, install: request.install ?? true,
        recoverFrom: request.operation === 'transfer-recover' ? request.runtimeDirectory : null, onProgress });
      return { cacheTransferId: selected.id, runtimeId: request.targetId, status: result.status,
        transferId: result.transferId, manifestSha256: result.manifestSha256, runtimeDirectory: result.runtimeDirectory };
    }
  }
  return { cacheTransferId: selected.id, ...summary(selected, result) };
}
/** Requeue only this adapter's retained resumable operation, under the original kernel lease. */
export async function recoverWorkspaceRuntimeTransferOperation(root, id) {
  operationId(id);
  const directory = join(root, 'operations', id), request = await readJSON(join(directory, 'request.json'));
  need(Object.hasOwn(transferOperationFields, request.operation), 'RUNTIME_TRANSFER_OPERATION_INVALID');
  if (await activeLock(join(directory, 'worker.lock')) ||
    await activeLock(join(request.transferDirectory, 'transfer.lock')) ||
    request.targetDirectory && await activeLock(join(request.targetDirectory, 'install.lock')))
    return { operationId: id, active: true, resume: false };
  const lease = await operationLease(join(directory, 'worker.lock'));
  try {
    const state = await readJSON(join(directory, 'state.json'));
    if (state.phase === 'SUCCEEDED') return { operationId: id, completed: true, resume: false };
    need(['QUEUED', 'RUNNING', 'FAILED'].includes(state.phase), 'RUNTIME_TRANSFER_OPERATION_STATE_INVALID');
    await saveJSON(join(directory, 'state.json'), { phase: 'QUEUED', attempt: (state.attempt ?? 0) + 1,
      previousPhase: state.phase, previousError: state.error ?? null, resumedAt: now(), updatedAt: now() }, true);
    return { operationId: id, resume: true };
  } finally { await lease.close(); }
}
