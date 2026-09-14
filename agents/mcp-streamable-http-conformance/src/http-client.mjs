export class ProbeTransportError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ProbeTransportError';
    this.code = code;
    this.details = details;
  }
}

export function validateEndpoint(input) {
  let url;
  try { url = new URL(input); } catch { throw new ProbeTransportError('ENDPOINT_URL', 'endpoint must be an absolute http(s) URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new ProbeTransportError('ENDPOINT_SCHEME', 'endpoint must use http or https');
  if (url.username || url.password) throw new ProbeTransportError('ENDPOINT_USERINFO', 'endpoint URL must not contain credentials');
  if (url.hash) throw new ProbeTransportError('ENDPOINT_FRAGMENT', 'endpoint URL must not contain a fragment');
  return url;
}

function timeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('probe request timed out')), timeoutMs);
  timer.unref?.();
  return { controller, timer };
}

async function readBounded(response, maxBytes) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel('body limit exceeded').catch(() => {});
        throw new ProbeTransportError('BODY_LIMIT', `response body exceeded ${maxBytes} bytes`, { status: response.status, maxBytes });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(merged);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function responseMatchesRequest(message, requestId) {
  if (!message || message.jsonrpc !== '2.0' || message.id !== requestId) return false;
  const hasResult = Object.prototype.hasOwnProperty.call(message, 'result');
  const hasError = Object.prototype.hasOwnProperty.call(message, 'error');
  if (hasResult === hasError) return false;
  if (hasError) {
    const error = message.error;
    if (!isPlainObject(error) || !Number.isInteger(error.code) || typeof error.message !== 'string') return false;
  }
  return true;
}

async function readSseRpcResponse(response, maxBytes, requestId) {
  if (!response.body) throw new ProbeTransportError('SSE_RESPONSE_MISSING', 'SSE response has no body', { status: response.status });
  if (requestId === undefined) throw new ProbeTransportError('SSE_REQUEST_ID', 'cannot correlate SSE response without a JSON-RPC request id');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let buffer = '';
  let dataLines = [];

  const consumeEvent = () => {
    if (dataLines.length === 0) return null;
    const data = dataLines.join('\n');
    dataLines = [];
    let message;
    try { message = JSON.parse(data); }
    catch { throw new ProbeTransportError('INVALID_SSE_JSON', 'SSE data event is not valid JSON', { status: response.status }); }
    return responseMatchesRequest(message, requestId) ? message : null;
  };

  const processLine = (rawLine) => {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line === '') return consumeEvent();
    if (line.startsWith(':')) return null;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') dataLines.push(value);
    return null;
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        if (buffer.length > 0) {
          const message = processLine(buffer);
          if (message) return message;
        }
        const final = consumeEvent();
        if (final) return final;
        break;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel('body limit exceeded').catch(() => {});
        throw new ProbeTransportError('BODY_LIMIT', `response body exceeded ${maxBytes} bytes`, { status: response.status, maxBytes });
      }
      buffer += decoder.decode(value, { stream: true });
      for (;;) {
        const newline = buffer.indexOf('\n');
        if (newline === -1) break;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const message = processLine(line);
        if (message) {
          await reader.cancel('matched JSON-RPC response').catch(() => {});
          return message;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  throw new ProbeTransportError('SSE_RESPONSE_MISSING', 'SSE stream ended without the matching JSON-RPC response', { status: response.status, requestId });
}

export async function requestJson({ url, method = 'POST', headers = {}, body, timeoutMs, maxResponseBytes }) {
  const { controller, timer } = timeoutSignal(timeoutMs);
  const started = performance.now();
  try {
    let response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) throw new ProbeTransportError('TIMEOUT', `request exceeded ${timeoutMs}ms`);
      throw new ProbeTransportError('NETWORK', error?.message ?? 'network failure');
    }
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => {});
      throw new ProbeTransportError('REDIRECT', 'redirects are not followed by the probe', { status: response.status, location: response.headers.get('location') });
    }

    const contentType = response.headers.get('content-type') ?? '';
    let parsed = null;
    let responseMode = 'empty';
    if (/^text\/event-stream(?:;|$)/i.test(contentType)) {
      parsed = await readSseRpcResponse(response, maxResponseBytes, body?.id);
      responseMode = 'sse';
    } else {
      const text = await readBounded(response, maxResponseBytes);
      if (text.length > 0) {
        try { parsed = JSON.parse(text); }
        catch { throw new ProbeTransportError('INVALID_JSON', 'response body is not valid JSON', { status: response.status }); }
        responseMode = 'json';
      }
      if (response.status === 200 && body?.id !== undefined && !responseMatchesRequest(parsed, body.id)) {
        throw new ProbeTransportError('RPC_RESPONSE_MISMATCH', 'JSON response does not exactly correlate to the JSON-RPC request', {
          status: response.status,
          requestId: body.id,
          responseId: parsed?.id ?? null,
          responseJsonrpc: parsed?.jsonrpc ?? null,
        });
      }
    }
    const elapsedMs = performance.now() - started;
    return { response, body: parsed, elapsedMs, responseMode };
  } catch (error) {
    if (controller.signal.aborted && error?.code !== 'TIMEOUT') throw new ProbeTransportError('TIMEOUT', `request exceeded ${timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function requestHeadersOnly({ url, method = 'GET', headers = {}, timeoutMs }) {
  const { controller, timer } = timeoutSignal(timeoutMs);
  const started = performance.now();
  try {
    let response;
    try { response = await fetch(url, { method, headers, redirect: 'manual', signal: controller.signal }); }
    catch (error) {
      if (controller.signal.aborted) throw new ProbeTransportError('TIMEOUT', `request exceeded ${timeoutMs}ms`);
      throw new ProbeTransportError('NETWORK', error?.message ?? 'network failure');
    }
    const elapsedMs = performance.now() - started;
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => {});
      throw new ProbeTransportError('REDIRECT', 'redirects are not followed by the probe', { status: response.status, location: response.headers.get('location') });
    }
    const contentType = response.headers.get('content-type');
    await response.body?.cancel().catch(() => {});
    return { response, contentType, elapsedMs };
  } finally {
    clearTimeout(timer);
  }
}
