// MIT. Typed-client implementation for the original private gRPC operations API.
import { createHash } from 'node:crypto';
import { OPERATIONS_MAX_BYTES } from './domain.mjs';
import { OPERATIONS_FILES } from './report.mjs';
const ROUTES = new Set(['capture','captures','read','save','case','cases','export','receive']);
const error = (code, message, status = 400) => Object.assign(new Error(message), { code, status });
async function readResponse(response, maximum) {
  const chunks = []; let bytes = 0;
  for await (const chunk of response.body ?? []) {
    bytes += chunk.length;
    if (bytes > maximum) throw error('GRPC_OPERATIONS_RESPONSE_TOO_LARGE', 'The original response exceeds its declared capacity.', 413);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, bytes);
}
export function createGrpcOperationsClient({ url, fetch: transport = globalThis.fetch } = {}) {
  let selected;
  try { selected = new URL(url); } catch { throw error('GRPC_OPERATIONS_CONNECTION_REQUIRED', 'Choose the original private gRPC workspace URL.'); }
  if (selected.protocol !== 'http:' || selected.hostname !== '127.0.0.1' || !selected.port ||
    selected.username || selected.password || selected.pathname !== '/' || selected.search || !/^#[a-f0-9]{64}$/.test(selected.hash))
    throw error('GRPC_OPERATIONS_CONNECTION_INVALID', 'Use the original loopback workspace URL and capability.');
  const origin = selected.origin, token = selected.hash.slice(1), active = new Set(), controllers = new Set();
  let closing = false, closed;
  function call(route, body, file) {
    if (closing) return Promise.reject(error('GRPC_OPERATIONS_CLIENT_CLOSED', 'This client is closed.'));
    const controller = new AbortController(); controllers.add(controller);
    const promise = (async () => {
      const response = await transport(origin + '/api/operations-' + route, { method:'POST', redirect:'error',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(420000)]),
        headers:{ 'content-type':'application/json', 'x-workspace-token':token, origin }, body:JSON.stringify(body) });
      if (!response.ok) {
        let problem = {}; try { problem = JSON.parse((await readResponse(response, 65536)).toString('utf8')); } catch {}
        const code = /^[A-Z][A-Z0-9_]+$/.test(problem.error ?? '') ? problem.error : 'GRPC_OPERATIONS_REQUEST_FAILED';
        throw error(code, String(problem.detail ?? code).split(token).join('[private capability]').slice(0, 1200), response.status);
      }
      const bytes = await readResponse(response, file?.maximum ?? OPERATIONS_MAX_BYTES + 1048576);
      if (!file) {
        try { return JSON.parse(new TextDecoder('utf-8', { fatal:true }).decode(bytes)); }
        catch { throw error('GRPC_OPERATIONS_RESPONSE_INVALID', 'The original response is not complete JSON.'); }
      }
      const digest = createHash('sha256').update(bytes).digest('hex'), length = response.headers.get('content-length');
      if (length === null || !/^\d+$/.test(length) || Number(length) !== bytes.length ||
        response.headers.get('x-content-sha256') !== digest) throw error('GRPC_OPERATIONS_DOWNLOAD_CHANGED', 'The original file differs from its native download identity.');
      return { path:file.path, contentType:response.headers.get('content-type') ?? file.contentType, bytes, sha256:digest };
    })().finally(() => controllers.delete(controller));
    active.add(promise); void promise.finally(() => active.delete(promise)).catch(() => {});
    return promise;
  }
  return Object.freeze({
    request(action, body = {}) {
      if (!ROUTES.has(action)) throw error('GRPC_OPERATIONS_ACTION_INVALID', 'Choose an original operations action.');
      return call(action, body);
    },
    download({ exportSha256, file }) {
      const definition = OPERATIONS_FILES.find(row => row.path === file);
      if (!definition || !/^[a-f0-9]{64}$/.test(exportSha256 ?? '')) throw error('GRPC_OPERATIONS_FILE_INVALID', 'Choose a returned complete file descriptor.');
      return call('download', { exportSha256, file }, definition);
    },
    close() {
      if (!closed) { closing = true; for (const controller of controllers) controller.abort(); closed = Promise.allSettled([...active]).then(() => {}); }
      return closed;
    },
  });
}
