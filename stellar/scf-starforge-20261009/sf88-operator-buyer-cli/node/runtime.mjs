// MIT — One native SF88 subprocess, never a shell or replacement payment engine.
import { spawn } from 'node:child_process';
import { open, lstat, mkdtemp, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { absolute, privateDirectory, readBytes, parseJson, object, need, BuyerError, safeCode } from './store.mjs';

export class NativeRuntime {
  constructor({ runtimeDirectory, node = process.execPath, environment = process.env,
    timeoutMs = 360000, cleanupGraceMs = 15000, outputLimit = 1048576 }) {
    this.directory = absolute(runtimeDirectory);
    this.cli = join(this.directory, 'cli.mjs');
    this.node = absolute(node);
    this.environment = { ...environment };
    for (const [name, value] of Object.entries({ timeoutMs, cleanupGraceMs, outputLimit }))
      need(Number.isSafeInteger(value) && value > 0 && value <= 2147483647, 'RUNTIME_LIMIT_INVALID');
    Object.assign(this, { timeoutMs, cleanupGraceMs, outputLimit });
  }

  async run(args, { directory, signal, started, entryFile = this.cli, resultFile, resultLimit = this.outputLimit } = {}) {
    need(Array.isArray(args) && args.every(value => typeof value === 'string' && !value.includes('\0')), 'NATIVE_ARGUMENTS_INVALID');
    need(signal === undefined || signal instanceof AbortSignal, 'INVALID_ABORT_SIGNAL');
    need(Number.isSafeInteger(resultLimit) && resultLimit > 0 && resultLimit <= 268435456, 'NATIVE_RESULT_LIMIT_INVALID');
    need(!signal?.aborted, 'OPERATION_ABORTED_BEFORE_START');
    entryFile = absolute(entryFile);
    need((await lstat(entryFile)).isFile(), 'NATIVE_CLI_REQUIRED');
    directory = await privateDirectory(directory, { create: false });
    resultFile = resultFile === undefined ? join(directory, 'stdout.json') : absolute(resultFile);
    need(dirname(resultFile) === directory, 'NATIVE_RESULT_PATH_INVALID');
    // Native writes directly to private descriptors. A parent crash does not
    // discard a later complete native summary, which recover() can read.
    const stdout = await open(join(directory, 'stdout.json'), 'wx', 0o600);
    let stderr;
    try { stderr = await open(join(directory, 'stderr.log'), 'wx', 0o600); }
    catch (error) { await stdout.close(); throw error; }
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
          child = spawn(this.node, [entryFile, ...args], {
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
      await Promise.all([stdout.close(), stderr.close()]);
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
