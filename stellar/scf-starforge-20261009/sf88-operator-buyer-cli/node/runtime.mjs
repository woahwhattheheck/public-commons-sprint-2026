// MIT — One native SF88 subprocess, never a shell or replacement payment engine.
import { spawn } from 'node:child_process';
import { open, lstat, mkdtemp, rm, realpath } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { absolute, privateDirectory, readBytes, parseJson, jsonBytes, object, need, BuyerError, safeCode, currentFileReservation, digest, writeBytes, withFileReservation } from './store.mjs';
import { normalizeNativeFileReservation, createNativeFileReservation } from './file-reservation.mjs';


async function allocateOutput(fileHandle, path, kind, bytes, signal, reserveFile) {
  if (!reserveFile) return;
  need(!signal?.aborted, 'OPERATION_ABORTED_BEFORE_START');
  const fd = fileHandle.fd;
  const before = await fileHandle.stat({ bigint: true });
  need(before.isFile() && before.size === 0n, 'NATIVE_OUTPUT_ALLOCATION_TARGET_INVALID');
  // The caller owns this live descriptor. Allocators reserve its backing space
  // with KEEP_SIZE and must settle before returning or relinquishing this handle.
  await reserveFile(Object.freeze({ fileHandle, path, kind, bytes, signal }));
  const after = await fileHandle.stat({ bigint: true });
  const named = await lstat(path, { bigint: true });
  need(fileHandle.fd === fd && after.isFile() && named.isFile() && !named.isSymbolicLink() &&
    before.dev === after.dev && before.ino === after.ino && before.size === after.size &&
    before.mode === after.mode && before.uid === after.uid && before.gid === after.gid &&
    before.nlink === after.nlink && named.dev === after.dev && named.ino === after.ino &&
    named.size === after.size && named.mode === after.mode && named.uid === after.uid &&
    named.gid === after.gid, 'NATIVE_OUTPUT_ALLOCATION_TARGET_CHANGED');
  need(typeof after.blocks === 'bigint' && after.blocks * 512n >= BigInt(bytes),
    'NATIVE_OUTPUT_ALLOCATION_INCOMPLETE');
  await fileHandle.sync();
  need(!signal?.aborted, 'OPERATION_ABORTED_BEFORE_START');
}

async function closeOutput(fileHandle, { reserved = false, reset = false, limit } = {}) {
  if (!fileHandle) return;
  let failure;
  if (reserved) {
    try {
      // KEEP_SIZE may allocate beyond EOF. Trim to the actual logical output,
      // including zero on a failed pre-spawn allocation; never publish padding.
      const length = reset ? 0 : Math.min((await fileHandle.stat()).size, limit);
      await fileHandle.truncate(length);
      await fileHandle.sync();
    } catch (error) { failure = error; }
  }
  try { await fileHandle.close(); } catch (error) { failure ??= error; }
  if (failure) throw failure;
}

export class NativeRuntime {
  constructor({ runtimeDirectory, node = process.execPath, environment = process.env,
    timeoutMs = 360000, cleanupGraceMs = 15000, outputLimit = 1048576, reserveFile, nativeFileReservation, nativeRuntimeSource }) {
    this.directory = absolute(runtimeDirectory);
    this.cli = join(this.directory, 'cli.mjs');
    this.node = absolute(node);
    this.environment = { ...environment };
    for (const [name, value] of Object.entries({ timeoutMs, cleanupGraceMs, outputLimit }))
      need(Number.isSafeInteger(value) && value > 0 && value <= 2147483647, 'RUNTIME_LIMIT_INVALID');
    need(reserveFile === undefined || typeof reserveFile === 'function', 'NATIVE_RESERVE_FILE_CALLBACK_INVALID');
    Object.assign(this, { timeoutMs, cleanupGraceMs, outputLimit, reserveFile,
      nativeFileReservation: normalizeNativeFileReservation(nativeFileReservation),
      nativeRuntimeSource: nativeRuntimeSource === undefined ? undefined :
        Object.freeze(parseJson(jsonBytes(nativeRuntimeSource))) });
  }

  async fileReservation() {
    if (this.reserveFile) return this.reserveFile;
    const inherited = currentFileReservation()?.reserveFile;
    if (inherited) return inherited;
    return this.nativeFileReservation ? createNativeFileReservation(this.nativeFileReservation) : null;
  }

  async run(args, { directory, signal, started, entryFile = this.cli, resultFile, resultLimit = this.outputLimit } = {}) {
    need(Array.isArray(args) && args.every(value => typeof value === 'string' && !value.includes('\0')), 'NATIVE_ARGUMENTS_INVALID');
    need(signal === undefined || signal instanceof AbortSignal, 'INVALID_ABORT_SIGNAL');
    need(Number.isSafeInteger(resultLimit) && resultLimit > 0 && resultLimit <= 268435456, 'NATIVE_RESULT_LIMIT_INVALID');
    need(!signal?.aborted, 'OPERATION_ABORTED_BEFORE_START');
    if (this.nativeRuntimeSource !== undefined) {
      const { verifySuccessorRuntimeSource } = await import('./runtime-source.mjs');
      const binding = await verifySuccessorRuntimeSource(this.nativeRuntimeSource, { signal });
      need(binding.directory === this.directory, 'NATIVE_RUNTIME_SOURCE_DIRECTORY_MISMATCH');
    }
    entryFile = absolute(entryFile);
    need((await lstat(entryFile)).isFile(), 'NATIVE_CLI_REQUIRED');
    // ESM resolves parent directory links before evaluating a main-entry guard.
    // Pass that same real filename in argv while keeping the regular-file check.
    entryFile = await realpath(entryFile);
    directory = await privateDirectory(directory, { create: false });
    resultFile = resultFile === undefined ? join(directory, 'stdout.json') : absolute(resultFile);
    need(dirname(resultFile) === directory, 'NATIVE_RESULT_PATH_INVALID');
    // Native writes directly to private descriptors. A parent crash does not
    // discard a later complete native summary, which recover() can read.
    const reserveFile = await this.fileReservation();
    need(!signal?.aborted, 'OPERATION_ABORTED_BEFORE_START');
    let nativeArgs = [entryFile, ...args];
    if (this.nativeFileReservation) {
      const bootstrap = await realpath(join(this.directory, 'node', 'reserved-entry.mjs'));
      need((await lstat(bootstrap)).isFile(), 'NATIVE_RESERVED_ENTRY_REQUIRED');
      const requestPath = join(directory, 'native-reserved-request.json');
      const request = jsonBytes({
        schema: 'stellar-forge.sf88.reserved-entry.v1', entryFile,
        entrySha256: digest(await readBytes(entryFile, 16777216)),
        args: [...args], nativeFileReservation: this.nativeFileReservation,
        ...(this.nativeRuntimeSource === undefined ? {} : { nativeRuntimeSource: this.nativeRuntimeSource }),
      });
      need(request.length <= 2097152, 'NATIVE_RESERVED_REQUEST_LIMIT');
      await withFileReservation({ reserveFile, signal },
        () => writeBytes(requestPath, request, { exclusive: true }));
      nativeArgs = [bootstrap, requestPath, digest(request)];
    }
    const stdoutPath = join(directory, 'stdout.json');
    const stderrPath = join(directory, 'stderr.log');
    const stdout = await open(stdoutPath, 'wx', 0o600);
    let stderr;
    try {
      stderr = await open(stderrPath, 'wx', 0o600);
      await allocateOutput(stdout, stdoutPath, 'native-stdout', this.outputLimit, signal, reserveFile);
      await allocateOutput(stderr, stderrPath, 'native-stderr', this.outputLimit, signal, reserveFile);
      need(!signal?.aborted, 'OPERATION_ABORTED_BEFORE_START');
    } catch (error) {
      // A second-allocation failure must also release the first held extent.
      // Settle both cleanups so one failing descriptor cannot leak its peer.
      const cleanup = await Promise.allSettled([stdout, stderr].filter(Boolean).map(fileHandle =>
        closeOutput(fileHandle, { reserved: Boolean(reserveFile), reset: true, limit: this.outputLimit })));
      if (cleanup.some(item => item.status === 'rejected'))
        throw new BuyerError(safeCode(error?.code, 'NATIVE_OUTPUT_ALLOCATION_FAILED'), { outputCleanupFailed: true });
      throw error;
    }
    let child, exitCode = null, exitSignal = null, localError = null;
    let timeout, grace, monitor, closed = false, startRecording = Promise.resolve();
    const stop = code => {
      localError ??= code;
      if (!child || closed || child.exitCode !== null || child.signalCode !== null) return;
      if (!grace) {
        child.kill('SIGTERM');
        grace = setTimeout(() => {
          if (!closed && child.exitCode === null && child.signalCode === null) {
            localError = 'NATIVE_CLEANUP_DEADLINE_EXCEEDED';
            child.kill('SIGKILL');
          }
        }, this.cleanupGraceMs);
        grace.unref();
      }
    };
    const abort = () => stop('OPERATION_ABORTED');
    try {
      await new Promise(resolveClose => {
        try {
          child = spawn(this.node, nativeArgs, {
            cwd: this.directory, env: this.environment, shell: false,
            stdio: ['inherit', stdout.fd, stderr.fd], windowsHide: true,
          });
        } catch { localError = 'NATIVE_START_FAILED'; resolveClose(); return; }
        child.once('error', () => { localError ??= 'NATIVE_PROCESS_ERROR'; });
        child.once('spawn', () => {
          startRecording = Promise.resolve().then(() => started?.(child.pid)).catch(() => stop('ATTEMPT_STATE_WRITE_FAILED'));
        });
        child.once('close', (code, nativeSignal) => {
          closed = true; exitCode = code; exitSignal = nativeSignal; resolveClose();
        });
        timeout = setTimeout(() => stop('NATIVE_TIMEOUT'), this.timeoutMs);
        timeout.unref();
        // No raw stdout/stderr enters application callbacks. Enforce a private
        // log budget; the native command's own limits remain authoritative.
        let checking = false;
        monitor = setInterval(async () => {
          if (checking || closed) return;
          checking = true;
          try {
            const sizes = await Promise.all([stdout.stat(), stderr.stat()]);
            if (sizes.some(stat => stat.size > this.outputLimit)) stop('NATIVE_OUTPUT_LIMIT');
          } catch { if (!closed) stop('NATIVE_LOG_IO_FAILED'); }
          finally { checking = false; }
        }, 100);
        monitor.unref();
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
      });
      await startRecording;
      for (const handle of [stdout, stderr]) {
        if ((await handle.stat()).size > this.outputLimit) {
          localError = 'NATIVE_OUTPUT_LIMIT';
          await handle.truncate(this.outputLimit);
        }
      }
      await Promise.all([stdout.sync(), stderr.sync()]);
    } finally {
      clearTimeout(timeout); clearTimeout(grace); clearInterval(monitor);
      signal?.removeEventListener('abort', abort);
      const outputCleanup = await Promise.allSettled([stdout, stderr].map(fileHandle =>
        closeOutput(fileHandle, { reserved: Boolean(reserveFile), limit: this.outputLimit })));
      const failedCleanup = outputCleanup.find(result => result.status === 'rejected');
      if (failedCleanup) {
        if (!reserveFile) throw failedCleanup.reason;
        // Complete native stdout remains recoverable even if releasing unused
        // backing space fails; do not replace its result with a cleanup exception.
        localError ??= 'NATIVE_OUTPUT_RESERVATION_RELEASE_FAILED';
      }
    }
    let output = null, nativeError = null, unavailable = false;
    try { const value = parseJson(await readBytes(resultFile, resultLimit)); if (object(value)) output = value; }
    catch { unavailable = true; }
    try {
      const raw = await readBytes(join(directory, 'stderr.log'), this.outputLimit);
      const line = raw.toString('utf8').trim().split('\n').at(-1);
      const parsed = JSON.parse(line);
      nativeError = safeCode(parsed?.error, null);
    } catch { /* Raw stderr is private, never an exception message. */ }
    return { exitCode, exitSignal, errorCode: localError ?? nativeError ?? (unavailable ? 'NATIVE_RESULT_UNAVAILABLE' : null), output };
  }

  async checked(args, { stateDirectory, mode, signal, entryFile } = {}) {
    const directory = await mkdtemp(join(stateDirectory, '.native-'));
    try {
      const run = await this.run(args, { directory, signal, entryFile });
      if (run.exitCode !== 0 || run.errorCode || !run.output || run.output.mode !== mode)
        throw new BuyerError(run.errorCode ?? 'NATIVE_COMMAND_FAILED', { exitCode: run.exitCode });
      return run.output;
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
}
