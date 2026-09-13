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
    const elapsedMs = performance.now() - started;
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => {});
      throw new ProbeTransportError('REDIRECT', 'redirects are not followed by the probe', { status: response.status, location: response.headers.get('location') });
    }
    const text = await readBounded(response, maxResponseBytes);
    let parsed = null;
    if (text.length > 0) {
      try { parsed = JSON.parse(text); }
      catch { throw new ProbeTransportError('INVALID_JSON', 'response body is not valid JSON', { status: response.status }); }
    }
    return { response, body: parsed, elapsedMs };
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
