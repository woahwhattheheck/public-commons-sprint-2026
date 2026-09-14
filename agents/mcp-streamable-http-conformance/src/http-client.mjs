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
  if (url.search) throw new ProbeTransportError('ENDPOINT_QUERY', 'endpoint URL must not contain a query string');
  if (url.hash) throw new ProbeTransportError('ENDPOINT_FRAGMENT', 'endpoint URL must not contain a fragment');
  return url;
}

function timeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('probe request timed out')), timeoutMs);
  timer.unref?.();
  return { controller, timer };
}

function decodeUtf8(decoder, value, options, response) {
  try { return decoder.decode(value, options); }
  catch {
    throw new ProbeTransportError('INVALID_UTF8', 'response body is not valid UTF-8', { status: response.status });
  }
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
  return merged;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function responseMatchesRequest(message, requestId, requestMethod) {
  if (!message || message.jsonrpc !== '2.0' || message.id !== requestId) return false;
  const hasResult = Object.prototype.hasOwnProperty.call(message, 'result');
  const hasError = Object.prototype.hasOwnProperty.call(message, 'error');
  if (hasResult === hasError) return false;
  if (hasResult && requestMethod === 'ping' && !isPlainObject(message.result)) return false;
  if (hasError) {
    const error = message.error;
    if (!isPlainObject(error) || !Number.isInteger(error.code) || typeof error.message !== 'string') return false;
  }
  return true;
}

async function readSseRpcResponse(response, maxBytes, requestId, requestMethod) {
  if (!response.body) throw new ProbeTransportError('SSE_RESPONSE_MISSING', 'SSE response has no body', { status: response.status });
  if (requestId === undefined) throw new ProbeTransportError('SSE_REQUEST_ID', 'cannot correlate SSE response without a JSON-RPC request id');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
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
    return responseMatchesRequest(message, requestId, requestMethod) ? message : null;
  };

  const processLine = (line) => {
    if (line === '') return consumeEvent();
    if (line.startsWith(':')) return null;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') dataLines.push(value);
    return null;
  };

  const drainCompleteLines = (final = false) => {
    for (;;) {
      let lineEnd = -1;
      let terminatorLength = 0;
      for (let index = 0; index < buffer.length; index += 1) {
        if (buffer[index] === '\n') {
          lineEnd = index;
          terminatorLength = 1;
          break;
        }
        if (buffer[index] === '\r') {
          if (index + 1 === buffer.length && !final) return null;
          lineEnd = index;
          terminatorLength = buffer[index + 1] === '\n' ? 2 : 1;
          break;
        }
      }
      if (lineEnd === -1) return null;
      const line = buffer.slice(0, lineEnd);
      buffer = buffer.slice(lineEnd + terminatorLength);
      const message = processLine(line);
      if (message) return message;
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decodeUtf8(decoder, undefined, undefined, response);
        const message = drainCompleteLines(true);
        if (message) return message;
        // The SSE algorithm discards an incomplete event at EOF.
        break;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel('body limit exceeded').catch(() => {});
        throw new ProbeTransportError('BODY_LIMIT', `response body exceeded ${maxBytes} bytes`, { status: response.status, maxBytes });
      }
      buffer += decodeUtf8(decoder, value, { stream: true }, response);
      const message = drainCompleteLines();
      if (message) {
        await reader.cancel('matched JSON-RPC response').catch(() => {});
        return message;
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
    const sseResponse = /^text\/event-stream(?:;|$)/i.test(contentType);
    const jsonResponse = /^application\/json(?:;|$)/i.test(contentType);
    const rpcRequest = body?.id !== undefined;
    if (response.status === 200 && rpcRequest && !sseResponse && !jsonResponse) {
      await response.body?.cancel().catch(() => {});
      throw new ProbeTransportError(
        'RESPONSE_MEDIA_TYPE',
        'JSON-RPC request response must use application/json or text/event-stream',
        { status: response.status, contentType: contentType || null },
      );
    }
    let parsed = null;
    let responseMode = 'empty';
    if (response.status !== 200) {
      const bytes = await readBounded(response, maxResponseBytes);
      if (bytes.length > 0) {
        responseMode = 'opaque';
        if (jsonResponse) {
          try {
            const text = decodeUtf8(new TextDecoder('utf-8', { fatal: true }), bytes, undefined, response);
            parsed = JSON.parse(text);
            responseMode = 'json';
          } catch (error) {
            if (error?.code !== 'INVALID_UTF8' && !(error instanceof SyntaxError)) throw error;
            parsed = null;
          }
        }
      }
    } else if (sseResponse) {
      parsed = await readSseRpcResponse(response, maxResponseBytes, body?.id, body?.method);
      responseMode = 'sse';
    } else {
      const bytes = await readBounded(response, maxResponseBytes);
      if (bytes.length > 0) {
        const text = decodeUtf8(new TextDecoder('utf-8', { fatal: true }), bytes, undefined, response);
        try { parsed = JSON.parse(text); }
        catch { throw new ProbeTransportError('INVALID_JSON', 'response body is not valid JSON', { status: response.status }); }
        responseMode = 'json';
      }
      if (body?.id !== undefined && !responseMatchesRequest(parsed, body.id, body.method)) {
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
