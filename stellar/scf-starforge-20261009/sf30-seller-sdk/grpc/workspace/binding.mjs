// MIT. Read the original private workspace selection without opening another writer.
import { constants } from 'node:fs';
import { open, lstat, realpath } from 'node:fs/promises';
import { resolve, join, dirname, isAbsolute } from 'node:path';
import { canonical, sha256, fields, fail } from '../common.mjs';

export const GRPC_WORKSPACE_BINDING = 'stellar-forge.grpc-workspace-binding.v1';
const HASH = /^[a-f0-9]{64}$/;
const inode = value => ({ device: value.dev.toString(), inode: value.ino.toString() });
const sameInode = (a, b) => a.dev === b.dev && a.ino === b.ino;
const privateOwner = value => !(Number(value.mode) & 0o077) &&
  (process.getuid === undefined || value.uid === BigInt(process.getuid()));

async function directoryInfo(path) {
  const before = await lstat(path, { bigint: true });
  if (!before.isDirectory() || before.isSymbolicLink() || !privateOwner(before) ||
      await realpath(path) !== path) fail('GRPC_MANAGED_PRIVATE_DIRECTORY_REQUIRED');
  return before;
}
async function currentFile(path) {
  let handle;
  try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (issue) { if (issue.code === 'ENOENT') return null; throw issue; }
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || !privateOwner(before) || before.size > 65536n)
      fail('GRPC_MANAGED_CURRENT_INVALID');
    const buffer = Buffer.alloc(65537); let total = 0;
    while (total < buffer.length) {
      const value = await handle.read(buffer, total, buffer.length - total, total);
      if (!value.bytesRead) break;
      total += value.bytesRead;
    }
    const after = await handle.stat({ bigint: true }), named = await lstat(path, { bigint: true });
    if (total !== Number(before.size) || before.size !== after.size ||
        before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs ||
        !sameInode(before, after) || !sameInode(after, named) || named.isSymbolicLink())
      fail('GRPC_MANAGED_CURRENT_CHANGED', 409);
    const bytes = buffer.subarray(0, total);
    let current;
    try { current = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { fail('GRPC_MANAGED_CURRENT_INVALID'); }
    if (current?.schema !== 'stellar-forge.grpc-workspace-current.v1' ||
        !HASH.test(current.revision ?? '') || !Number.isSafeInteger(current.generation) || current.generation < 1)
      fail('GRPC_MANAGED_CURRENT_INVALID');
    return { revision: current.revision, generation: current.generation, sha256: sha256(bytes) };
  } finally { await handle.close(); }
}
export function validateGrpcWorkspaceBinding(value) {
  fields(value, ['schema', 'directory', 'identity', 'current'], 'GRPC_MANAGED_BINDING_INVALID');
  if (value.schema !== GRPC_WORKSPACE_BINDING || typeof value.directory !== 'string' ||
      !isAbsolute(value.directory) || resolve(value.directory) !== value.directory || value.directory.includes('\0'))
    fail('GRPC_MANAGED_BINDING_INVALID');
  fields(value.identity, ['device', 'inode'], 'GRPC_MANAGED_BINDING_INVALID');
  if (!/^(0|[1-9][0-9]*)$/.test(value.identity.device ?? '') ||
      !/^[1-9][0-9]*$/.test(value.identity.inode ?? '')) fail('GRPC_MANAGED_BINDING_INVALID');
  if (value.current !== null) {
    fields(value.current, ['revision', 'generation', 'sha256'], 'GRPC_MANAGED_BINDING_INVALID');
    if (!HASH.test(value.current.revision ?? '') || !HASH.test(value.current.sha256 ?? '') ||
        !Number.isSafeInteger(value.current.generation) || value.current.generation < 1)
      fail('GRPC_MANAGED_BINDING_INVALID');
  }
  return structuredClone(value);
}
export async function inspectGrpcWorkspaceBinding(directory) {
  if (typeof directory !== 'string' || !isAbsolute(directory) || resolve(directory) !== directory)
    fail('GRPC_ABSOLUTE_WORKSPACE_REQUIRED');
  const before = await directoryInfo(directory);
  // Directory timestamps change during ordinary authoring; inode identity and
  // the exact current source selection are the stable reviewed inputs.
  const current = await currentFile(join(directory, 'current.json'));
  const after = await directoryInfo(directory);
  if (!sameInode(before, after)) fail('GRPC_MANAGED_DIRECTORY_CHANGED', 409);
  return { schema: GRPC_WORKSPACE_BINDING, directory, identity: inode(after), current };
}
export async function assertGrpcWorkspaceBinding(directory, expected) {
  validateGrpcWorkspaceBinding(expected);
  if (expected.directory !== directory ||
      canonical(await inspectGrpcWorkspaceBinding(directory)) !== canonical(expected))
    fail('GRPC_MANAGED_WORKSPACE_CHANGED', 409);
}
export async function inspectGrpcWorkspaceParent(directory) {
  if (typeof directory !== 'string' || !isAbsolute(directory) || resolve(directory) !== directory ||
      directory === dirname(directory)) fail('GRPC_ABSOLUTE_WORKSPACE_REQUIRED');
  const parent = dirname(directory), value = await directoryInfo(parent);
  return { directory, parent, identity: inode(value) };
}

