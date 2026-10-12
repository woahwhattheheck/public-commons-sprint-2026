// MIT. Native managed startup over the original gRPC workspace and writer lease.
import { randomUUID } from 'node:crypto';
import { open, lstat, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicJson } from '../../../sf46-release/release-core.mjs';
import { canonical, sha256, fields, fail, privateDirectory, writeJsonSnapshot } from '../common.mjs';
import { validateGrpcWorkspaceBinding } from './binding.mjs';

export const GRPC_MANAGED_SELECTION = 'stellar-forge.grpc-workspace-selection.v1';
export const GRPC_MANAGED_LAUNCH = 'stellar-forge.grpc-workspace-launch.v1';
export const GRPC_LAUNCH_FILES = Object.freeze([
  'workspace/binding.mjs', 'workspace/managed-launch.mjs',
  'workspace/model.mjs', 'workspace/server.mjs',
]);
const sourceDirectory = fileURLToPath(new URL('../', import.meta.url));
const HASH = /^[a-f0-9]{64}$/;
const MAX_SELECTION = 16384;

async function sourceFile(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size > 262144n) fail('GRPC_MANAGED_SOURCE_INVALID');
    const buffer = Buffer.alloc(262145); let total = 0;
    while (total < buffer.length) {
      const value = await handle.read(buffer, total, buffer.length - total, total);
      if (!value.bytesRead) break;
      total += value.bytesRead;
    }
    const after = await handle.stat({ bigint: true }), named = await lstat(path, { bigint: true });
    if (total !== Number(before.size) || before.size !== after.size ||
        before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs ||
        before.dev !== after.dev || before.ino !== after.ino ||
        named.dev !== after.dev || named.ino !== after.ino || named.isSymbolicLink())
      fail('GRPC_MANAGED_SOURCE_CHANGED', 409);
    return { bytes: total, sha256: sha256(buffer.subarray(0, total)) };
  } finally { await handle.close(); }
}
export async function readGrpcLaunchSource(directory = sourceDirectory) {
  const root = await realpath(directory), before = await lstat(root, { bigint: true });
  const workspace = join(root, 'workspace'), inside = await lstat(workspace, { bigint: true });
  if (!before.isDirectory() || before.isSymbolicLink() || !inside.isDirectory() ||
      inside.isSymbolicLink() || await realpath(workspace) !== workspace)
    fail('GRPC_MANAGED_SOURCE_INVALID');
  const files = {};
  for (const path of GRPC_LAUNCH_FILES) files[path] = await sourceFile(join(root, path));
  const after = await lstat(root, { bigint: true }), insideAfter = await lstat(workspace, { bigint: true });
  if (before.dev !== after.dev || before.ino !== after.ino || await realpath(directory) !== root ||
      inside.dev !== insideAfter.dev || inside.ino !== insideAfter.ino || insideAfter.isSymbolicLink() ||
      !insideAfter.isDirectory() || await realpath(workspace) !== workspace)
    fail('GRPC_MANAGED_SOURCE_CHANGED', 409);
  return { files, sha256: sha256(canonical(files)) };
}
export function validateGrpcManagedSelection(value) {
  fields(value, ['schema', 'workspace', 'sourceFiles', 'sourceSha256'], 'GRPC_MANAGED_SELECTION_INVALID');
  if (value.schema !== GRPC_MANAGED_SELECTION) fail('GRPC_MANAGED_SELECTION_INVALID');
  validateGrpcWorkspaceBinding(value.workspace);
  fields(value.sourceFiles, GRPC_LAUNCH_FILES, 'GRPC_MANAGED_SOURCE_INVALID');
  if (Object.keys(value.sourceFiles).length !== GRPC_LAUNCH_FILES.length) fail('GRPC_MANAGED_SOURCE_INVALID');
  for (const path of GRPC_LAUNCH_FILES) {
    const item = value.sourceFiles[path];
    fields(item, ['bytes', 'sha256'], 'GRPC_MANAGED_SOURCE_INVALID');
    if (!Number.isSafeInteger(item.bytes) || item.bytes < 1 || item.bytes > 262144 ||
        !HASH.test(item.sha256 ?? '')) fail('GRPC_MANAGED_SOURCE_INVALID');
  }
  if (!HASH.test(value.sourceSha256 ?? '') || sha256(canonical(value.sourceFiles)) !== value.sourceSha256)
    fail('GRPC_MANAGED_SOURCE_CHANGED', 409);
  if (Buffer.byteLength(canonical(value)) > MAX_SELECTION) fail('GRPC_MANAGED_SELECTION_TOO_LARGE', 413);
  return structuredClone(value);
}
export function parseGrpcManagedSelection(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_SELECTION) fail('GRPC_MANAGED_SELECTION_INVALID');
  let value;
  try { value = JSON.parse(text); } catch { fail('GRPC_MANAGED_SELECTION_INVALID'); }
  return validateGrpcManagedSelection(value);
}
export async function assertGrpcManagedSource(selection) {
  validateGrpcManagedSelection(selection);
  const actual = await readGrpcLaunchSource();
  if (actual.sha256 !== selection.sourceSha256 || canonical(actual.files) !== canonical(selection.sourceFiles))
    fail('GRPC_MANAGED_EXECUTED_SOURCE_CHANGED', 409);
}
export async function createGrpcManagedLaunch(selection, { directory, url, origin }) {
  validateGrpcManagedSelection(selection);
  if (selection.workspace.directory !== directory) fail('GRPC_MANAGED_DIRECTORY_CHANGED', 409);
  const folder = await privateDirectory(join(directory, 'managed-launches'), true);
  const instanceId = randomUUID(), path = join(folder, instanceId + '.json');
  let current = {
    schema: GRPC_MANAGED_LAUNCH, state: 'LISTENING', instanceId, pid: process.pid,
    directory, selectionSha256: sha256(canonical(selection)),
    sourceSha256: selection.sourceSha256, sourceFiles: selection.sourceFiles,
    selectedCurrent: selection.workspace.current, createdAt: new Date().toISOString(), url, origin,
  };
  await writeJsonSnapshot(path, current, 16384);
  return {
    value: () => structuredClone(current),
    async transition(state, error) {
      if (!['DRAINING', 'STOPPED', 'STOP_UNCONFIRMED'].includes(state)) fail('GRPC_MANAGED_PHASE_INVALID');
      current = { ...current, state, updatedAt: new Date().toISOString(),
        ...(state === 'DRAINING' ? {} : { endedAt: new Date().toISOString() }),
        ...(error ? { error: String(error.code ?? error.message ?? 'GRPC_WORKSPACE_CLOSE_FAILED').slice(0, 500) } : {}),
      };
      // An old owner's final write only touches its unique instance record.
      // A subsequent original writer can never have its startup replaced here.
      await atomicJson(path, current);
    },
  };
}

