// MIT. Terminable native Node workers; queued records, execution and payment remain separate.
import { Worker } from 'node:worker_threads';
import { jobError } from './config.mjs';

export function executeJob(source, row, attempt, { env = process.env, signal } = {}) {
  const definition = source.compiled.functions[row.functionId];
  const environment = Object.create(null);
  for (const name of source.compiled.environment) {
    if (typeof env[name] !== 'string') return Promise.reject(jobError('JOB_ENVIRONMENT_MISSING', 503));
    environment[name] = env[name];
  }
  if (signal?.aborted) return Promise.reject(jobError(signal.reason?.code ?? 'JOB_EXECUTION_CANCELLED', 409));
  return new Promise((resolve, reject) => {
    let worker, terminal = false, retiring = false, timer, cancellationTimer;
    const finish = async (failure, body) => {
      if (terminal) return;
      terminal = true; clearTimeout(timer); clearTimeout(cancellationTimer);
      signal?.removeEventListener('abort', abort);
      retiring = true;
      try { if (worker) await worker.terminate(); } catch { failure ??= jobError('JOB_WORKER_RETIRE_FAILED', 503); }
      if (failure) reject(failure); else resolve(body);
    };
    const abort = () => {
      if (terminal || cancellationTimer) return;
      try { worker?.postMessage({ type: 'cancel' }); } catch { /* Forced retirement follows. */ }
      cancellationTimer = setTimeout(() => finish(jobError(signal?.reason?.code ?? 'JOB_EXECUTION_CANCELLED', 409)), 250);
    };
    try {
      worker = new Worker(new URL('./runner.mjs', import.meta.url), {
        workerData: { application: source.applicationPath ?? source.identity.application, applicationSha256: source.identity.applicationSha256,
          functionId: row.functionId, input: row.input, jobId: row.id, attemptId: attempt.id,
          output: definition.output, maxOutputBytes: definition.maxOutputBytes },
        env: environment, execArgv: [], stdout: true, stderr: true,
        resourceLimits: { maxOldGenerationSizeMb: source.compiled.memoryLimitMb },
      });
      worker.stdout.resume(); worker.stderr.resume();
      worker.once('error', () => finish(jobError('JOB_WORKER_FAILED', 503)));
      worker.once('exit', () => { if (!retiring) finish(jobError('JOB_WORKER_EXITED', 503)); });
      worker.on('message', message => {
        if (terminal) return;
        if (signal?.aborted) return finish(jobError(signal.reason?.code ?? 'JOB_EXECUTION_CANCELLED', 409));
        if (message?.type === 'failure' && typeof message.code === 'string')
          return finish(jobError(/^JOB_[A-Z_]+$/.test(message.code) ? message.code : 'JOB_APPLICATION_FAILED', 503));
        if (message?.type !== 'result' || !(message.body instanceof Uint8Array) || message.body.byteLength > definition.maxOutputBytes)
          return finish(jobError('JOB_WORKER_PROTOCOL_INVALID', 503));
        return finish(null, Buffer.from(message.body));
      });
      timer = setTimeout(() => finish(jobError('JOB_EXECUTION_TIMEOUT', 504)), definition.timeoutMs);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    } catch { finish(jobError('JOB_WORKER_START_FAILED', 503)); }
  });
}
