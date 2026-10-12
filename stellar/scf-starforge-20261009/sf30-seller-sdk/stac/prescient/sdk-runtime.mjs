import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const MAX_PROTOCOL_BYTES = 8 * 1024 * 1024;
const DEFAULT_WORKER = fileURLToPath(new URL('./sdk_bridge.py', import.meta.url));

function failure(code, details) {
  const error = new Error(code);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}
function need(value, code) { if (!value) throw failure(code); }
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function workerFailure(value) {
  const code = typeof value?.code === 'string' && /^PRESCIENT_[A-Z0-9_]+$/.test(value.code)
    ? value.code : 'PRESCIENT_WORKER_OPERATION_FAILED';
  // The private worker already removes native exception text. Keep this boundary
  // explicit so a changed worker cannot copy OAuth responses into host journals.
  const details = {};
  for (const key of ['errno', 'httpStatus']) if (Number.isInteger(value?.details?.[key])) details[key] = value.details[key];
  for (const key of ['awsCode', 'requestId']) {
    if (typeof value?.details?.[key] === 'string' && /^[A-Za-z0-9_.:/+-]{1,160}$/.test(value.details[key])) {
      details[key] = value.details[key];
    }
  }
  return failure(code, Object.keys(details).length ? details : undefined);
}

/**
 * Own one private original-SDK process and its serialized requests.
 *
 * config is the reviewed runtime configuration, including an absolute envFile
 * or privately supplied process environment, exact origins, approved S3 scopes
 * and the private receiving/capture roots. Never put credentials in config.
 *
 * Cancellation terminates and drains only this worker. The next request starts
 * a new original SDK client and rejoins the original durable receiving spool.
 */
export async function createPrescientSdkRuntime({
  pythonCommand = ['python3'],
  workerPath = DEFAULT_WORKER,
  config,
  env = process.env,
  timeoutMs = 120000,
  signal,
} = {}) {
  need(Array.isArray(pythonCommand) && pythonCommand.length > 0 && pythonCommand.length <= 32 &&
    pythonCommand.every(value => typeof value === 'string' && value.length > 0 && !value.includes('\0')),
    'PRESCIENT_PYTHON_COMMAND_REQUIRED');
  need(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 3600000,
    'PRESCIENT_RUNTIME_TIMEOUT_INVALID');
  need(config && typeof config === 'object' && !Array.isArray(config), 'PRESCIENT_CONFIGURATION_REQUIRED');
  need(typeof workerPath === 'string' && workerPath.length > 0, 'PRESCIENT_WORKER_PATH_REQUIRED');
  let retainedConfig;
  try { retainedConfig = freeze(JSON.parse(JSON.stringify(config))); }
  catch { throw failure('PRESCIENT_CONFIGURATION_NOT_SERIALIZABLE'); }
  const command = [...pythonCommand], privateEnv = { ...env, PYTHONUNBUFFERED: '1', PYTHONDONTWRITEBYTECODE: '1' };
  const scriptPath = resolve(workerPath);
  let worker = null, lifetimeClosed = false, sequence = 0, tail = Promise.resolve(), metadata;
  let closeResult = null;

  function terminate(selected, reason) {
    if (!selected || selected.exited) return selected?.closed ?? Promise.resolve();
    if (!selected.ending) {
      selected.ending = true;
      selected.reason = reason ?? failure('PRESCIENT_RUNTIME_CLOSED');
      selected.process.kill('SIGTERM');
      selected.killTimer = setTimeout(() => selected.process.kill('SIGKILL'), 1500);
      selected.killTimer.unref?.();
    }
    return selected.closed;
  }

  function launch() {
    const child = spawn(command[0], [...command.slice(1), '-u', scriptPath], {
      env: privateEnv, shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    const selected = {
      process: child, buffer: Buffer.alloc(0), current: null, initialized: false,
      ending: false, exited: false, reason: null, killTimer: null,
    };
    selected.closed = new Promise(done => { selected.resolveClosed = done; });
    worker = selected;

    // SDK logging and interactive-provider exceptions can contain private data.
    // Drain stderr without persisting it or forwarding it into product errors.
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => {
      void terminate(selected, failure('PRESCIENT_WORKER_INPUT_FAILED'));
    });
    child.once('error', () => {
      void terminate(selected, failure('PRESCIENT_WORKER_START_FAILED'));
    });
    child.once('close', (exitCode, exitSignal) => {
      selected.exited = true;
      clearTimeout(selected.killTimer);
      selected.buffer = Buffer.alloc(0);
      const current = selected.current;
      selected.current = null;
      if (worker === selected) worker = null;
      if (current) {
        current.cleanup();
        current.reject(selected.reason ?? failure('PRESCIENT_WORKER_EXITED', {
          exitCode: Number.isInteger(exitCode) ? exitCode : null,
          exitSignal: typeof exitSignal === 'string' ? exitSignal : null,
        }));
      }
      selected.resolveClosed();
    });
    child.stdout.on('data', chunk => {
      if (selected.ending) return;
      selected.buffer = Buffer.concat([selected.buffer, chunk]);
      let newline;
      while ((newline = selected.buffer.indexOf(10)) !== -1) {
        if (newline > MAX_PROTOCOL_BYTES) {
          void terminate(selected, failure('PRESCIENT_PROTOCOL_LIMIT'));
          return;
        }
        const line = selected.buffer.subarray(0, newline);
        selected.buffer = selected.buffer.subarray(newline + 1);
        let message;
        try { message = JSON.parse(line.toString('utf8')); }
        catch { void terminate(selected, failure('PRESCIENT_WORKER_PROTOCOL_INVALID')); return; }
        const current = selected.current;
        if (!current || message?.id !== current.id) {
          void terminate(selected, failure('PRESCIENT_WORKER_RESPONSE_ID_MISMATCH'));
          return;
        }
        if (message.event === 'progress') {
          if (typeof current.onProgress === 'function') {
            // Observer errors do not invalidate fsynced receiving progress.
            Promise.resolve().then(() => current.onProgress(freeze(message.progress))).catch(() => {});
          }
          continue;
        }
        if (!Object.hasOwn(message, 'result') && !Object.hasOwn(message, 'error')) {
          void terminate(selected, failure('PRESCIENT_WORKER_RESPONSE_INVALID'));
          return;
        }
        selected.current = null;
        current.cleanup();
        if (message.error) current.reject(workerFailure(message.error));
        else current.resolve(message.result);
      }
      if (selected.buffer.length > MAX_PROTOCOL_BYTES) {
        void terminate(selected, failure('PRESCIENT_PROTOCOL_LIMIT'));
      }
    });
    return selected;
  }

  function exchange(selected, method, params, { signal, onProgress } = {}) {
    need(!selected.ending && !selected.exited && !selected.current, 'PRESCIENT_WORKER_UNAVAILABLE');
    need(!signal?.aborted, 'PRESCIENT_OPERATION_ABORTED');
    const id = String(++sequence);
    let encoded;
    try { encoded = Buffer.from(JSON.stringify({ id, method, params }) + '\n'); }
    catch { throw failure('PRESCIENT_REQUEST_NOT_SERIALIZABLE'); }
    need(encoded.length <= MAX_PROTOCOL_BYTES, 'PRESCIENT_PROTOCOL_LIMIT');
    return new Promise((resolveResult, rejectResult) => {
      const onAbort = () => { void terminate(selected, failure('PRESCIENT_OPERATION_ABORTED')); };
      const timer = setTimeout(() => {
        void terminate(selected, failure('PRESCIENT_OPERATION_DEADLINE'));
      }, timeoutMs);
      timer.unref?.();
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      };
      selected.current = { id, resolve: resolveResult, reject: rejectResult, cleanup, onProgress };
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) { onAbort(); return; }
      selected.process.stdin.write(encoded, error => {
        if (error) void terminate(selected, failure('PRESCIENT_WORKER_INPUT_FAILED'));
      });
    });
  }

  async function ensureWorker(options) {
    if (worker?.ending) await worker.closed;
    const selected = worker ?? launch();
    if (!selected.initialized) {
      try {
        const current = await exchange(selected, 'initialize', { config: retainedConfig }, options);
        need(current?.schema === 'prescient-sdk-runtime/v1' &&
          current.endpoint === retainedConfig.expectedEndpoint &&
          current.authMode === retainedConfig.authMode,
          'PRESCIENT_RUNTIME_METADATA_MISMATCH');
        need(retainedConfig.authMode !== 'oauth' || retainedConfig.expectedIdentityProvider == null ||
          current.identityProvider === retainedConfig.expectedIdentityProvider, 'PRESCIENT_RUNTIME_IDENTITY_PROVIDER_MISMATCH');
        if (metadata) need(JSON.stringify(current) === JSON.stringify(metadata), 'PRESCIENT_RUNTIME_SOURCE_CHANGED');
        metadata = freeze(current);
        selected.initialized = true;
      } catch (error) {
        await terminate(selected, error);
        throw error;
      }
    }
    return selected;
  }

  function enqueue(method, params = {}, options = {}) {
    let retainedParams;
    try { retainedParams = JSON.parse(JSON.stringify(params)); }
    catch { return Promise.reject(failure('PRESCIENT_REQUEST_NOT_SERIALIZABLE')); }
    const result = tail.then(async () => {
      need(!lifetimeClosed, 'PRESCIENT_RUNTIME_CLOSED');
      need(!options.signal?.aborted, 'PRESCIENT_OPERATION_ABORTED');
      const selected = await ensureWorker(options);
      if (method === null) return metadata;
      return exchange(selected, method, retainedParams, options);
    });
    // Serialize requests while allowing a later request to recover a stopped
    // process. Every caller still receives its own original rejection.
    tail = result.then(() => {}, () => {});
    return result;
  }

  await enqueue(null, {}, { signal });
  // An abort can arrive after initialize replies but before construction
  // returns its close handle. Drain that just-created worker as well.
  if (signal?.aborted) {
    const error = failure('PRESCIENT_OPERATION_ABORTED');
    await terminate(worker, error);
    throw error;
  }
  return Object.freeze({
    get metadata() { return metadata; },
    async requestHeaders({ url, method = 'GET', signal } = {}) {
      const headers = await enqueue('requestHeaders', { url, method }, { signal });
      const expected = retainedConfig.authMode === 'api-key' ? 'api-key' : 'authorization';
      need(headers && Object.keys(headers).length === 1 && typeof headers[expected] === 'string' &&
        headers[expected].length > 0 && !/[\r\n]/.test(headers[expected]), 'PRESCIENT_AUTH_RESPONSE_INVALID');
      return headers;
    },
    observeResponse({ url, status, signal } = {}) {
      return enqueue('observeResponse', { url, status }, { signal });
    },
    sessionStatus({ refresh = false, signal } = {}) {
      return enqueue('sessionStatus', { refresh: refresh === true }, { signal });
    },
    reviewS3({ descriptor, signal } = {}) {
      return enqueue('reviewS3', { descriptor }, { signal });
    },
    downloadS3({ descriptor, directory, maxBytes, selection, signal, onProgress } = {}) {
      return enqueue('downloadS3', { descriptor, directory, maxBytes, selection }, { signal, onProgress });
    },
    close() {
      if (!closeResult) {
        lifetimeClosed = true;
        closeResult = (async () => {
          if (worker) await terminate(worker, failure('PRESCIENT_RUNTIME_CLOSED'));
          await tail;
        })();
      }
      return closeResult;
    },
  });
}
