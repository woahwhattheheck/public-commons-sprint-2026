// MIT. One explicitly configured merchant application function in one owned worker.
import { parentPort, workerData } from 'node:worker_threads';
import { readFile, lstat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { canonical, digest } from './config.mjs';

const stopped = new AbortController();
parentPort.on('message', message => {
  if (message?.type === 'cancel' && !stopped.signal.aborted)
    stopped.abort(Object.assign(new Error('JOB_EXECUTION_CANCELLED'), { code: 'JOB_EXECUTION_CANCELLED' }));
});
async function run() {
  const { application, applicationSha256, functionId, input, jobId, attemptId, output, maxOutputBytes } = workerData;
  const info = await lstat(application);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 4194304) throw new Error('JOB_APPLICATION_CHANGED');
  if (digest(await readFile(application)) !== applicationSha256) throw new Error('JOB_APPLICATION_CHANGED');
  const module = await import(pathToFileURL(application).href);
  if (!Object.hasOwn(module, functionId) || typeof module[functionId] !== 'function') throw new Error('JOB_FUNCTION_UNAVAILABLE');
  stopped.signal.throwIfAborted();
  const result = await module[functionId](input, Object.freeze({ jobId, attemptId, signal: stopped.signal }));
  stopped.signal.throwIfAborted();
  let body;
  if (output.format === 'json') body = Buffer.from(canonical(result));
  else if (typeof result === 'string') body = Buffer.from(result, 'utf8');
  else if (result instanceof Uint8Array) body = Buffer.from(result);
  else throw new Error('JOB_OUTPUT_TYPE_INVALID');
  if (body.length > maxOutputBytes) throw new Error('JOB_OUTPUT_TOO_LARGE');
  const bytes = Uint8Array.from(body);
  parentPort.postMessage({ type: 'result', body: bytes }, [bytes.buffer]);
}
run().catch(error => {
  const allowed = new Set(['JOB_APPLICATION_CHANGED', 'JOB_FUNCTION_UNAVAILABLE', 'JOB_EXECUTION_CANCELLED',
    'JOB_OUTPUT_TYPE_INVALID', 'JOB_OUTPUT_TOO_LARGE', 'JOB_JSON_REQUIRED', 'JOB_JSON_TOO_COMPLEX']);
  parentPort.postMessage({ type: 'failure', code: allowed.has(error?.message) ? error.message : 'JOB_APPLICATION_FAILED' });
});
