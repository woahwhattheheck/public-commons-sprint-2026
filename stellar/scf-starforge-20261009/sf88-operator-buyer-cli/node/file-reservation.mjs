// MIT — Allocate the caller's live output inode with an explicitly pinned Linux tool.
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { open, lstat, realpath } from 'node:fs/promises';
import { absolute, need, object, digest, BuyerError } from './store.mjs';

export const FILE_RESERVATION_SCHEMA = 'stellar-forge.sf88.file-reservation.v1';
const MAX_EXECUTABLE_BYTES = 16777216;
const MAX_HELPER_OUTPUT = 8192;
const MAX_RESERVATION_BYTES = 2147483647;

export function normalizeNativeFileReservation(value) {
  if (value === undefined) return undefined;
  need(object(value) && Object.keys(value).every(key =>
    ['schema', 'executable', 'executableSha256', 'timeoutMs'].includes(key)),
  'NATIVE_FILE_RESERVATION_DESCRIPTOR_INVALID');
  need(value.schema === FILE_RESERVATION_SCHEMA &&
    typeof value.executableSha256 === 'string' && /^[a-f0-9]{64}$/.test(value.executableSha256) &&
    Number.isSafeInteger(value.timeoutMs) && value.timeoutMs > 0 && value.timeoutMs <= 60000,
  'NATIVE_FILE_RESERVATION_DESCRIPTOR_INVALID');
  return Object.freeze({ schema: FILE_RESERVATION_SCHEMA, executable: absolute(value.executable),
    executableSha256: value.executableSha256, timeoutMs: value.timeoutMs });
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode &&
    left.uid === right.uid && left.gid === right.gid && left.size === right.size &&
    left.nlink === right.nlink;
}

async function openExecutable(executable, expectedSha256) {
  need(process.platform === 'linux', 'NATIVE_FILE_RESERVATION_LINUX_REQUIRED');
  executable = absolute(executable);
  need(await realpath(executable) === executable, 'NATIVE_FILE_RESERVATION_EXECUTABLE_CANONICAL_REQUIRED');
  const handle = await open(executable, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat({ bigint: true });
    need(before.isFile() && before.size > 0n && before.size <= BigInt(MAX_EXECUTABLE_BYTES) &&
      (before.mode & 0o111n) !== 0n && (before.mode & 0o022n) === 0n,
    'NATIVE_FILE_RESERVATION_EXECUTABLE_INVALID');
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const read = await handle.read(bytes, offset, bytes.length - offset, offset);
      need(read.bytesRead > 0, 'NATIVE_FILE_RESERVATION_EXECUTABLE_CHANGED');
      offset += read.bytesRead;
    }
    const sha256 = digest(bytes);
    const after = await handle.stat({ bigint: true });
    const named = await lstat(executable, { bigint: true });
    need(named.isFile() && !named.isSymbolicLink() && sameFile(before, after) &&
      sameFile(after, named) && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs,
    'NATIVE_FILE_RESERVATION_EXECUTABLE_CHANGED');
    need(expectedSha256 === undefined || sha256 === expectedSha256,
      'NATIVE_FILE_RESERVATION_EXECUTABLE_HASH_MISMATCH');
    return { handle, executable, sha256 };
  } catch (error) { await handle.close(); throw error; }
}

export async function inspectNativeFileReservation({ executable, timeoutMs = 10000 }) {
  const selected = await openExecutable(await realpath(absolute(executable)));
  try {
    return normalizeNativeFileReservation({ schema: FILE_RESERVATION_SCHEMA,
      executable: selected.executable, executableSha256: selected.sha256, timeoutMs });
  } finally { await selected.handle.close(); }
}

async function targetIdentity(fileHandle, path, fd, before) {
  need(fileHandle && Number.isInteger(fileHandle.fd) && fileHandle.fd === fd && fd >= 0,
    'NATIVE_FILE_RESERVATION_TARGET_INVALID');
  const current = await fileHandle.stat({ bigint: true });
  const named = await lstat(path, { bigint: true });
  need(current.isFile() && named.isFile() && !named.isSymbolicLink() &&
    sameFile(current, named) && (!before || sameFile(current, before)),
  'NATIVE_FILE_RESERVATION_TARGET_CHANGED');
  return current;
}

async function runAllocation(executableHandle, fileHandle, bytes, timeoutMs, signal) {
  need(!signal?.aborted, 'OPERATION_ABORTED_BEFORE_START');
  let child, failure, exitCode = null, exitSignal = null, timer, killTimer;
  let outputBytes = 0;
  const stop = code => {
    failure ??= code;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    if (!killTimer) killTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }, 1000);
  };
  const abort = () => stop('OPERATION_ABORTED');
  try {
    await new Promise(resolve => {
      try {
        // fd 4 is the same executable inode that was just hashed. Running that
        // descriptor also avoids selecting a replacement pathname after hashing.
        child = spawn('/proc/self/fd/4',
          ['--keep-size', '--length', String(bytes), '/proc/self/fd/3'], {
            shell: false, stdio: ['ignore', 'pipe', 'pipe', fileHandle.fd, executableHandle.fd],
            env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' },
          });
      } catch { failure = 'NATIVE_FILE_RESERVATION_START_FAILED'; resolve(); return; }
      for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
        outputBytes += chunk.length;
        // Drain all output but never retain private target names in exceptions.
        if (outputBytes > MAX_HELPER_OUTPUT) stop('NATIVE_FILE_RESERVATION_OUTPUT_LIMIT');
      });
      child.once('error', () => { failure ??= 'NATIVE_FILE_RESERVATION_START_FAILED'; });
      child.once('close', (code, nativeSignal) => {
        exitCode = code; exitSignal = nativeSignal; resolve();
      });
      timer = setTimeout(() => stop('NATIVE_FILE_RESERVATION_TIMEOUT'), timeoutMs);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
  } finally {
    clearTimeout(timer); clearTimeout(killTimer);
    signal?.removeEventListener('abort', abort);
  }
  if (failure || exitCode !== 0 || exitSignal)
    throw new BuyerError(failure ?? 'NATIVE_FILE_RESERVATION_FAILED', { exitCode });
  need(!signal?.aborted, 'OPERATION_ABORTED_BEFORE_START');
}

export async function createNativeFileReservation(value) {
  const descriptor = normalizeNativeFileReservation(value);
  need(descriptor, 'NATIVE_FILE_RESERVATION_DESCRIPTOR_REQUIRED');
  const initial = await openExecutable(descriptor.executable, descriptor.executableSha256);
  await initial.handle.close();
  return async function reserveFile({ fileHandle, path, kind, bytes, signal }) {
    need(typeof kind === 'string' && /^[a-z][a-z0-9-]{0,79}$/.test(kind),
      'NATIVE_FILE_RESERVATION_KIND_INVALID');
    need(Number.isSafeInteger(bytes) && bytes > 0 && bytes <= MAX_RESERVATION_BYTES,
      'NATIVE_FILE_RESERVATION_BYTES_INVALID');
    need(signal === undefined || signal instanceof AbortSignal, 'INVALID_ABORT_SIGNAL');
    need(!signal?.aborted, 'OPERATION_ABORTED_BEFORE_START');
    path = absolute(path);
    const fd = fileHandle?.fd;
    const before = await targetIdentity(fileHandle, path, fd);
    const selected = await openExecutable(descriptor.executable, descriptor.executableSha256);
    let allocationError;
    try {
      await targetIdentity(fileHandle, path, fd, before);
      await runAllocation(selected.handle, fileHandle, bytes, descriptor.timeoutMs, signal);
    } catch (error) { allocationError = error; }
    finally { await selected.handle.close(); }
    // Even a failed allocation must not change the descriptor or logical EOF.
    // The caller releases any partial extents and remains the descriptor owner.
    await targetIdentity(fileHandle, path, fd, before);
    if (allocationError) throw allocationError;
    need(!signal?.aborted, 'OPERATION_ABORTED_BEFORE_START');
    return Object.freeze({ schema: FILE_RESERVATION_SCHEMA, kind, bytes,
      executableSha256: descriptor.executableSha256 });
  };
}
