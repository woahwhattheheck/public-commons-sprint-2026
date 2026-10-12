// MIT. One account-selected provider request per call. No automatic create retry.
import { BuyerError, need, now } from '../../node/store.mjs';
import { normalizeConfiguration, apiEndpoint, jobPath, JOB_STATUSES, providerId } from './contract.mjs';

const responseHeaders = response => Object.fromEntries(
  ['content-type', 'content-length', 'retry-after', 'request-id', 'x-request-id', 'date']
    .filter(name => response.headers.has(name)).map(name => [name, response.headers.get(name)])
);
async function readBounded(response, maxBytes, signal) {
  const chunks = []; let count = 0, reader;
  try {
    if (!response.body) return Buffer.alloc(0);
    need(typeof response.body.getReader === 'function', 'PIPELINE_RESPONSE_STREAM_REQUIRED');
    reader = response.body.getReader();
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      need(value instanceof Uint8Array, 'PIPELINE_RESPONSE_BYTES_REQUIRED');
      const remaining = maxBytes - count;
      if (value.byteLength > remaining) {
        if (remaining > 0) chunks.push(Buffer.from(value.subarray(0, remaining)));
        count = maxBytes;
        throw new BuyerError('PIPELINE_RESPONSE_TOO_LARGE');
      }
      chunks.push(Buffer.from(value)); count += value.byteLength;
    }
    return Buffer.concat(chunks, count);
  } catch (error) {
    await reader?.cancel().catch(() => {});
    const wrapped = new BuyerError(error.code === 'PIPELINE_RESPONSE_TOO_LARGE' ?
      'PIPELINE_RESPONSE_TOO_LARGE' : signal.aborted ? 'PIPELINE_REQUEST_ABORTED' : 'PIPELINE_RESPONSE_INCOMPLETE',
      { partialBody: Buffer.concat(chunks, count) });
    throw wrapped;
  } finally { reader?.releaseLock(); }
}
export function createPipelineClient({ configuration, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const config = normalizeConfiguration(configuration);
  need(typeof fetchImpl === 'function', 'PIPELINE_FETCH_REQUIRED');
  function credential() {
    const key = env?.[config.apiKeyEnv];
    need(typeof key === 'string' && key.length > 0 && key.length <= 16384 &&
      !/[\r\n\u0000]/u.test(key), 'PIPELINE_API_KEY_REQUIRED');
    return key;
  }
  function ready() { credential(); }
  function prepareCreate(requestData, inputs) {
    ready();
    need(Array.isArray(inputs) && inputs.length > 0 && inputs.length <= config.limits.maxInputs,
      'PIPELINE_INPUTS_REQUIRED');
    const form = new FormData();
    const serialized = JSON.stringify(requestData);
    need(Buffer.byteLength(serialized) <= config.limits.maxRequestDataBytes, 'PIPELINE_REQUEST_DATA_TOO_LARGE');
    form.append('request_data', serialized);
    let total = 0;
    for (const input of inputs) {
      need(input?.body instanceof Uint8Array && input.body.byteLength > 0 &&
        input.body.byteLength <= config.limits.maxInputBytes, 'PIPELINE_INPUT_SIZE_INVALID');
      total += input.body.byteLength;
      need(total <= config.limits.maxTotalInputBytes, 'PIPELINE_TOTAL_INPUT_LIMIT');
      need(typeof input.filename === 'string' && typeof input.contentType === 'string', 'PIPELINE_INPUT_METADATA_INVALID');
      form.append('input_files', new Blob([input.body], { type: input.contentType }), input.filename);
    }
    return { method: 'POST', path: 'api/v1/jobs/', body: form, maxBytes: config.limits.maxResponseBytes };
  }
  async function request(spec, { signal } = {}) {
    if (signal !== undefined) need(signal instanceof AbortSignal, 'PIPELINE_ABORT_SIGNAL_INVALID');
    if (signal?.aborted) throw new BuyerError('PIPELINE_REQUEST_NOT_SENT', { dispatched: false });
    const key = credential(), url = apiEndpoint(config.apiUrl, spec.path, spec.query);
    const controller = new AbortController();
    const abort = () => controller.abort(new BuyerError('PIPELINE_REQUEST_ABORTED'));
    const timeoutMs = spec.timeoutMs ?? config.limits.requestTimeoutMs;
    need(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= config.limits.requestTimeoutMs,
      'PIPELINE_TIMEOUT_INVALID');
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(new BuyerError('PIPELINE_REQUEST_TIMEOUT')), timeoutMs);
    let response, receivedAt, headers, body;
    try {
      response = await fetchImpl(url, {
        method: spec.method ?? 'GET',
        headers: { accept: 'application/json', 'unstructured-api-key': key },
        ...(spec.body === undefined ? {} : { body: spec.body }),
        signal: controller.signal, redirect: 'manual',
      });
      receivedAt = now();
      need(Number.isInteger(response?.status) && response.status >= 100 && response.status <= 599 &&
        response.headers instanceof Headers, 'PIPELINE_HTTP_RESPONSE_INVALID');
      headers = responseHeaders(response);
      // A custom launcher transport must also preserve the exact selected target.
      need(!response.url || response.url === url, 'PIPELINE_REDIRECT_FORBIDDEN');
      body = await readBounded(response, spec.maxBytes ?? config.limits.maxResponseBytes, controller.signal);
      return {
        method: spec.method ?? 'GET', path: spec.path, query: spec.query ?? {},
        status: response.status, headers, body, complete: true, receivedAt, completedAt: now(),
      };
    } catch (error) {
      if (response && headers) {
        const partialBody = error.partialBody ?? body ?? Buffer.alloc(0);
        throw new BuyerError(error.code === 'PIPELINE_RESPONSE_TOO_LARGE' ? error.code :
          controller.signal.aborted ? 'PIPELINE_REQUEST_ABORTED' : 'PIPELINE_RESPONSE_INCOMPLETE', {
          response: {
            method: spec.method ?? 'GET', path: spec.path, query: spec.query ?? {},
            status: response.status, headers, body: partialBody, complete: false,
            receivedAt, completedAt: now(),
          },
        });
      }
      throw new BuyerError(controller.signal.aborted ? 'PIPELINE_REQUEST_ABORTED' : 'PIPELINE_REQUEST_FAILED');
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
    }
  }
  const specForJob = id => ({ method: 'GET', path: jobPath(id) });
  const specForDetails = id => ({ method: 'GET', path: jobPath(id, '/details') });
  const specForCancel = id => ({ method: 'POST', path: jobPath(id, '/cancel') });
  function specForList({ workflowId, status } = {}) {
    if (workflowId !== undefined) providerId(workflowId);
    if (status !== undefined) need(JOB_STATUSES.includes(status), 'PIPELINE_STATUS_FILTER_INVALID');
    return { method: 'GET', path: 'api/v1/jobs/', query: {
      ...(workflowId === undefined ? {} : { workflow_id: workflowId }),
      ...(status === undefined ? {} : { status }),
    } };
  }
  function specForOutput(id, fileId, nodeId = null) {
    providerId(fileId); if (nodeId !== null) providerId(nodeId);
    return { method: 'GET', path: jobPath(id, '/download'), query: {
      file_id: fileId, ...(nodeId === null ? {} : { node_id: nodeId }),
    }, maxBytes: config.limits.maxOutputBytes };
  }
  return {
    ready, request, prepareCreate, specForJob, specForDetails, specForCancel, specForList, specForOutput,
    create: (requestData, inputs, options) => request(prepareCreate(requestData, inputs), options),
    getJob: (id, options) => request(specForJob(id), options),
    getDetails: (id, options) => request(specForDetails(id), options),
    cancelJob: (id, options) => request(specForCancel(id), options),
    listJobs: (filters, options) => request(specForList(filters), options),
    download: (id, fileId, nodeId, options) => request(specForOutput(id, fileId, nodeId), options),
  };
}
