// MIT. Datasette workspace HTTP client. Mutating requests are never replayed automatically.
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const utf8 = new TextEncoder();
export const DATASETTE_OPERATIONS = Object.freeze([
  'source.capture', 'source.adopt', 'source.inspect', 'source.review',
  'editions.create', 'editions.list', 'editions.inspect', 'editions.compare',
  'source.select', 'publisher.status', 'publisher.source', 'publisher.target',
  'publisher.plan', 'publisher.extract', 'publisher.inspect', 'publisher.review',
  'publisher.publish', 'publisher.recover', 'publisher.buyer-offer',
  'publisher.prepare-buyer', 'release.prepare', 'release.stage',
  'source.export', 'source.receive', 'operations.cancel',
]);
const operationNames = new Set(DATASETTE_OPERATIONS);

export class DatasetteClientError extends Error {
  constructor(code, message, {status = null, operation = null, operationId = null,
    uncertain = false, result = null, cause} = {}) {
    super(message, cause === undefined ? undefined : {cause});
    this.name = 'DatasetteClientError';
    this.code = code; this.status = status; this.operation = operation;
    this.operationId = operationId; this.uncertain = uncertain; this.result = result;
  }
}

export function datasetteConnection(value) {
  let url;
  try { url = new URL(value); } catch {
    throw new DatasetteClientError('DATASETTE_CONNECTION_INVALID', 'Use the URL printed by the Datasette workspace.');
  }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if ((!local || url.protocol !== 'http:') && url.protocol !== 'https:' ||
      url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      typeof value !== 'string' || value.length > 4096) {
    throw new DatasetteClientError('DATASETTE_CONNECTION_INVALID', 'Use a workspace HTTP loopback or HTTPS origin without user information, query, fragment or path.');
  }
  return Object.freeze({origin: url.origin});
}

function options(value = {}) {
  if (!object(value)) throw new TypeError('Request options must be an object.');
  if (Object.keys(value).some(key => key !== 'signal')) throw new TypeError('Only signal is accepted in request options.');
  return {signal: value.signal};
}
function linkedSignal(signal, timeoutMs) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, {once: true});
  const timer = setTimeout(() => controller.abort(new Error('Datasette request timed out.')), timeoutMs);
  timer.unref?.();
  return {signal: controller.signal, close() {clearTimeout(timer); signal?.removeEventListener('abort', abort);}};
}
async function readResponse(response, maximum) {
  if (!response.body?.getReader) {
    const text = await response.text();
    if (utf8.encode(text).byteLength > maximum) throw new RangeError('Workspace response exceeds its byte limit.');
    return text;
  }
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', {fatal: true});
  let bytes = 0, text = '';
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maximum) {await reader.cancel(); throw new RangeError('Workspace response exceeds its byte limit.');}
      text += decoder.decode(part.value, {stream: true});
    }
    return text + decoder.decode();
  } finally {reader.releaseLock();}
}

/** Recreate this client from the original connection file after the local server restarts. */
export function createDatasetteClient({url, expectedWorkspaceId, fetchImpl = globalThis.fetch,
  timeoutMs = 300000, maxResponseBytes = MAX_RESPONSE_BYTES} = {}) {
  const connection = datasetteConnection(url);
  if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required.');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3600000 ||
      !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1024 || maxResponseBytes > 256 * 1024 * 1024)
    throw new TypeError('Choose valid request time and response-byte limits.');

  if (expectedWorkspaceId !== undefined && (typeof expectedWorkspaceId !== 'string' || !expectedWorkspaceId.trim()))
    throw new TypeError('An expected workspace identity must be a nonempty string.');
  let workspaceId = expectedWorkspaceId ?? null, connectionPending = null, verified = false;
  async function connect(requestOptions = {}) {
    if (connectionPending) return connectionPending;
    connectionPending = request('/api/health', requestOptions).then(value => {
      if (!object(value) || typeof value.workspaceId !== 'string' || !value.workspaceId.trim())
        throw new DatasetteClientError('DATASETTE_HEALTH_INVALID', 'The workspace did not return its original identity.');
      if (workspaceId !== null && value.workspaceId !== workspaceId)
        throw new DatasetteClientError('DATASETTE_WORKSPACE_CHANGED', 'The connection now belongs to a different workspace. Reopen the selected original workspace.');
      workspaceId = value.workspaceId; verified = true; return value;
    }).finally(() => {connectionPending = null;});
    return connectionPending;
  }
  async function request(path, {operation = null, input, signal} = {}) {
    const mutating = input !== undefined, operationId = input?.operationId ?? input?.runId ?? input?.id ?? null;
    let body;
    if (mutating) {
      try {body = JSON.stringify({operation, input});}
      catch (cause) {throw new DatasetteClientError('DATASETTE_INPUT_INVALID', 'Use serializable JSON operation input.', {operation, operationId, cause});}
      if (utf8.encode(body).byteLength > MAX_REQUEST_BYTES)
        throw new DatasetteClientError('DATASETTE_INPUT_TOO_LARGE', 'Use a retained input file for the complete operation.', {operation, operationId});
    }
    const lifetime = linkedSignal(signal, timeoutMs);
    let response, value;
    try {
      response = await fetchImpl(connection.origin + path, {
        method: mutating ? 'POST' : 'GET', redirect: 'error', signal: lifetime.signal,
        headers: {Accept: 'application/json', ...(mutating ? {'Content-Type': 'application/json'} : {}),
          ...(workspaceId !== null ? {'X-Datasette-Workspace-ID': workspaceId} : {})},
        ...(mutating ? {body} : {}),
      });
      const text = await readResponse(response, maxResponseBytes);
      try {value = JSON.parse(text);} catch (cause) {
        throw new DatasetteClientError('DATASETTE_RESPONSE_INVALID', 'The workspace response was not complete JSON. Reopen the original operation before repeating a change.',
          {status: response.status, operation, operationId, uncertain: mutating, cause});
      }
      if (!response.ok) {
        const code = typeof value?.error === 'string' ? value.error
          : typeof value?.code === 'string' ? value.code : 'DATASETTE_REQUEST_FAILED';
        throw new DatasetteClientError(code, typeof value?.message === 'string' ? value.message : 'The selected Datasette operation did not complete.',
          {status: response.status, operation, operationId,
            uncertain: mutating && (value?.uncertain === true || response.status >= 500), result: value});
      }
      return value;
    } catch (cause) {
      if (cause instanceof DatasetteClientError) throw cause;
      throw new DatasetteClientError(lifetime.signal.aborted ? 'DATASETTE_REQUEST_INTERRUPTED' : 'DATASETTE_TRANSPORT_FAILED',
        mutating ? 'Connection ended before the operation result was received. Inspect the original operation ID before continuing.'
          : 'The original Datasette workspace is unavailable. Reopen its connection and retry the read.',
        {status: response?.status ?? null, operation, operationId, uncertain: mutating, cause});
    } finally {lifetime.close();}
  }

  return Object.freeze({
    origin: connection.origin,
    get workspaceId() {return workspaceId;},
    health(requestOptions) {return connect(options(requestOptions));},
    async status(requestOptions) {
      if (!verified) await connect(options(requestOptions));
      return request('/api/status', options(requestOptions));
    },
    async operations(requestOptions) {
      if (!verified) await connect(options(requestOptions));
      return request('/api/operations', options(requestOptions));
    },
    async dispatch(operation, input = {}, requestOptions) {
      if (!operationNames.has(operation) || !object(input))
        throw new DatasetteClientError('DATASETTE_INPUT_INVALID', 'Select a declared Datasette operation and its JSON object.');
      const selected = options(requestOptions);
      if (!verified) await connect(selected);
      return request('/api/operation', {operation, input, ...selected});
    },
  });
}
