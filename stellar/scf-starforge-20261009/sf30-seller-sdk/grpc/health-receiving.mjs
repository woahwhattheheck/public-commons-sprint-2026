// MIT. Exact portable health snapshots; receiving never repeats a native health RPC.
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { privateDirectory, writeJsonSnapshot, sha256, fail } from './common.mjs';
import { parseGrpcHealthSnapshot, validateGrpcHealthSnapshot, GRPC_HEALTH_MAX_BYTES } from './health-record.mjs';

export async function readGrpcHealthSnapshotFile(path, expectedSnapshotSha256) {
  const absolute = resolve(path);
  const handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(GRPC_HEALTH_MAX_BYTES) ||
        process.platform !== 'win32' && Number(before.mode) & 0o077 ||
        typeof process.getuid === 'function' && before.uid !== BigInt(process.getuid()))
      fail('GRPC_HEALTH_PRIVATE_FILE_REQUIRED');
    const bytes = await handle.readFile(), after = await handle.stat({ bigint: true });
    if (BigInt(bytes.length) !== before.size ||
        ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].some(key => before[key] !== after[key]))
      fail('GRPC_HEALTH_FILE_CHANGED', 409);
    return { path: absolute, bytes, sha256: sha256(bytes), value: parseGrpcHealthSnapshot(bytes, expectedSnapshotSha256) };
  } finally { await handle.close(); }
}
export async function writeGrpcHealthSnapshotFile(path, snapshot) {
  validateGrpcHealthSnapshot(snapshot);
  const absolute = resolve(path), bytes = Buffer.from(JSON.stringify(snapshot) + '\n');
  if (bytes.length > GRPC_HEALTH_MAX_BYTES) fail('GRPC_HEALTH_EXPORT_TOO_LARGE', 413);
  await privateDirectory(dirname(absolute));
  try { await writeJsonSnapshot(absolute, snapshot, GRPC_HEALTH_MAX_BYTES); }
  catch (issue) {
    if (issue.code !== 'EEXIST') throw issue;
    const existing = await readGrpcHealthSnapshotFile(absolute, snapshot.snapshotSha256);
    if (!existing.bytes.equals(bytes)) fail('GRPC_HEALTH_RECEIVING_CONFLICT', 409);
  }
  const saved = await readGrpcHealthSnapshotFile(absolute, snapshot.snapshotSha256);
  return { path: absolute, bytes: saved.bytes.length, sha256: saved.sha256,
    snapshotSha256: saved.value.snapshotSha256, operation: saved.value.summary };
}
