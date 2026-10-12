// MIT. The merchant retains native process ownership after a Worker is terminated.
import { fork } from 'node:child_process';
import { chmod, lstat, mkdtemp, realpath, rm } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { jobError } from './config.mjs';

const requireValue = (value, code = 'JOB_NATIVE_REQUEST_INVALID') => {
  if (!value) throw jobError(code, 503);
};
const integer = (value, fallback, maximum) => {
  value ??= fallback;
  requireValue(Number.isSafeInteger(value) && value >= 1 && value <= maximum);
  return value;
};
async function supervise(directory, env) {
  let child, readyResolve, readyReject, closeResolve, pending = null, stopped = false, failure = null;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const retired = new Promise(resolve => { closeResolve = resolve; });
  const stop = code => {
    failure ??= jobError(code, 503);
    if (child?.connected) child.disconnect();
  };
  try {
    child = fork(fileURLToPath(new URL('./process-supervisor.mjs', import.meta.url)), [directory], {
      execPath: process.execPath, execArgv: [], env, cwd: directory,
      silent: true, serialization: 'advanced',
    });
  } catch { throw jobError('JOB_NATIVE_START_FAILED', 503); }
  child.stdin.end(); child.stdout.resume(); child.stderr.resume();
  child.once('error', () => { failure ??= jobError('JOB_NATIVE_START_FAILED', 503); });
  child.once('close', () => {
    stopped = true;
    const error = failure ?? jobError('JOB_NATIVE_PROCESS_INTERRUPTED', 503);
    readyReject(error); pending?.reject(error); pending = null; closeResolve();
  });
  child.on('message', message => {
    if (message?.type === 'ready') { readyResolve(); return; }
    if (message?.type === 'failure') {
      stop(/^JOB_NATIVE_[A-Z_]+$/.test(message.code ?? '') ?
        message.code : 'JOB_NATIVE_SUPERVISOR_FAILED');
      return;
    }
    const slot = pending;
    if (!slot || message?.id !== slot.id) { stop('JOB_NATIVE_PROTOCOL_INVALID'); return; }
    if (message.type === 'output') {
      if (!['stdout', 'stderr'].includes(message.channel) || !(message.bytes instanceof Uint8Array)) {
        stop('JOB_NATIVE_PROTOCOL_INVALID'); return;
      }
      slot.counts[message.channel] += message.bytes.byteLength;
      if (slot.counts[message.channel] > slot.limits[message.channel]) {
        stop('JOB_NATIVE_OUTPUT_TOO_LARGE'); return;
      }
      slot.chunks[message.channel].push(Buffer.from(message.bytes));
    } else if (message.type === 'result') {
      pending = null;
      if (message.error) slot.reject(jobError(
        /^JOB_NATIVE_[A-Z_]+$/.test(message.error) ? message.error : 'JOB_NATIVE_SUPERVISOR_FAILED', 503));
      else if (!(Number.isInteger(message.code) || message.code === null) ||
          !(typeof message.signal === 'string' || message.signal === null))
        slot.reject(jobError('JOB_NATIVE_PROTOCOL_INVALID', 503));
      else slot.resolve({ exitCode: message.code, signal: message.signal,
        stdout: Buffer.concat(slot.chunks.stdout), stderr: Buffer.concat(slot.chunks.stderr) });
    } else stop('JOB_NATIVE_PROTOCOL_INVALID');
  });
  await ready;
  return {
    retired,
    close() { if (child.connected) child.disconnect(); return retired; },
    run(id, args, limits) {
      requireValue(!stopped && child.connected, 'JOB_NATIVE_CLOSED');
      requireValue(!pending, 'JOB_NATIVE_PROCESS_ALREADY_RUNNING');
      return new Promise((resolve, reject) => {
        pending = { id, resolve, reject, limits, counts: { stdout: 0, stderr: 0 },
          chunks: { stdout: [], stderr: [] } };
        child.send({ type: 'run', id, ...args, limits }, error => {
          if (error) stop('JOB_NATIVE_CHANNEL_CLOSED');
        });
      });
    },
  };
}
export function createNativeProcessHost({ env, temporaryDirectory = tmpdir() } = {}) {
  let closed = false, scratchPromise = null, guardian = null, running = false, calls = 0;
  const seen = new Set();
  async function directory() {
    requireValue(!closed, 'JOB_NATIVE_CLOSED');
    if (!scratchPromise) scratchPromise = (async () => {
      requireValue(process.platform !== 'win32', 'JOB_NATIVE_PLATFORM_UNAVAILABLE');
      requireValue(typeof temporaryDirectory === 'string' && isAbsolute(temporaryDirectory));
      const root = await realpath(temporaryDirectory);
      requireValue((await lstat(root)).isDirectory(), 'JOB_NATIVE_TEMPORARY_DIRECTORY_INVALID');
      const selected = await mkdtemp(join(root, 'starforge-job-'));
      try {
        await chmod(selected, 0o700);
        guardian = await supervise(selected, env);
        return selected;
      } catch (error) {
        await rm(selected, { recursive: true, force: true });
        throw error;
      }
    })();
    return scratchPromise;
  }
  async function run(args) {
    requireValue(!closed, 'JOB_NATIVE_CLOSED');
    requireValue(args && typeof args === 'object' && !Array.isArray(args));
    requireValue(!running, 'JOB_NATIVE_PROCESS_ALREADY_RUNNING');
    requireValue(++calls <= 32, 'JOB_NATIVE_PROCESS_LIMIT');
    running = true;
    try {
      const root = await directory();
      requireValue(!closed, 'JOB_NATIVE_CLOSED');
      const command = args.command;
      requireValue(Array.isArray(command) && command.length >= 1 && command.length <= 256 &&
        command.every(value => typeof value === 'string' && !value.includes('\0')) &&
        command.reduce((sum, value) => sum + Buffer.byteLength(value), 0) <= 65536 &&
        isAbsolute(command[0]));
      const cwd = await realpath(args.cwd ?? root), delta = relative(root, cwd);
      requireValue((delta === '' || (!delta.startsWith('../') && delta !== '..' && !isAbsolute(delta))) &&
        (await lstat(cwd)).isDirectory(), 'JOB_NATIVE_WORKING_DIRECTORY_INVALID');
      const input = args.input ?? new Uint8Array();
      requireValue(input instanceof Uint8Array && input.byteLength <= 1048576);
      const limits = {
        stdout: integer(args.maxStdoutBytes, 131072, 67108864),
        stderr: integer(args.maxStderrBytes, 65536, 1048576),
      };
      requireValue(!closed, 'JOB_NATIVE_CLOSED');
      return await guardian.run(calls, { command, cwd, input }, limits);
    } finally { running = false; }
  }
  return Object.freeze({
    run, directory,
    handle(message, reply) {
      if (message?.type !== 'native-request') return false;
      const respond = (error, value) => reply({ type: 'native-response', id: message.id, error, value });
      Promise.resolve().then(async () => {
        requireValue(!closed && Number.isSafeInteger(message.id) && message.id > 0 &&
          message.id <= 64 && !seen.has(message.id), 'JOB_NATIVE_REQUEST_INVALID');
        seen.add(message.id);
        if (message.operation === 'directory') return directory();
        if (message.operation === 'run') return run(message.args);
        throw jobError('JOB_NATIVE_REQUEST_INVALID', 503);
      }).then(value => respond(null, value), error => respond(
        /^JOB_NATIVE_[A-Z_]+$/.test(error.code ?? '') ? error.code : 'JOB_NATIVE_OPERATION_FAILED'));
      return true;
    },
    async close() {
      closed = true;
      let root;
      try { if (scratchPromise) root = await scratchPromise; }
      catch { return; }
      if (guardian) await guardian.close();
      if (root) await rm(root, { recursive: true, force: true });
    },
  });
}
