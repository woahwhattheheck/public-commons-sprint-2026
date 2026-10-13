// MIT. One retained provider request produces one bounded transport attempt.
import {invariant, sha256, canonicalJSON, parseSourceJSON} from './source-json.mjs';
import {credentialBinding,injectPaycashlessAuthentication} from './provider-auth.mjs';

function configuredURL(value) {
  invariant(typeof value === 'string' && value.length > 0, 'PROVIDER_BASE_URL_REQUIRED');
  const url = new URL(value);
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
  invariant(url.protocol === 'https:' || url.protocol === 'http:' && loopback,
    'PROVIDER_HTTPS_REQUIRED');
  invariant(!url.username && !url.password && !url.hash && !url.search,
    'PROVIDER_BASE_URL_INVALID');
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url;
}

function selectedRequest(request, connection) {
  invariant(request && typeof request === 'object' && connection &&
    typeof connection === 'object', 'PREPARED_REQUEST_REQUIRED');
  invariant(['paycashless', 'horizon'].includes(request.provider), 'PROVIDER_UNSUPPORTED');
  invariant(request.provider === connection.provider, 'PROVIDER_BINDING_CHANGED');
  invariant(['sandbox', 'production'].includes(request.environment) &&
    request.environment === connection.environment, 'PROVIDER_ENVIRONMENT_MISMATCH');
  invariant(typeof request.action === 'string' && request.action,
    'PROVIDER_ACTION_REQUIRED');
  invariant(typeof request.requestSha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(request.requestSha256), 'PREPARED_REQUEST_HASH_REQUIRED');
  const {requestSha256, ...identity} = request;
  invariant(sha256(Buffer.from(canonicalJSON(identity))) === requestSha256,
    'PREPARED_REQUEST_CHANGED');

  const base = configuredURL(connection.baseUrl);
  const preparedBase = configuredURL(request.baseUrl);
  invariant(base.href === preparedBase.href, 'PROVIDER_BASE_URL_CHANGED');
  if (request.provider === 'paycashless') invariant(base.href==='https://api.paycashless.com/','PAYCASHLESS_ORIGIN_REQUIRED');
  if (request.provider === 'horizon') {
    invariant(request.method === 'GET' && request.mutation === false, 'HORIZON_READ_ONLY');
  }
  const url = new URL(request.url);
  invariant(url.origin === base.origin && !url.username && !url.password && !url.hash,
    'PROVIDER_ORIGIN_MISMATCH');
  const prefix = base.pathname.replace(/\/$/, '');
  invariant(!prefix || url.pathname === prefix || url.pathname.startsWith(prefix + '/'),
    'PROVIDER_PATH_OUTSIDE_BASE');
  invariant(['GET','HEAD','POST','PUT','PATCH','DELETE'].includes(request.method),
    'PROVIDER_METHOD_INVALID');

  let body = null;
  if (request.bodyBase64 !== null && request.bodyBase64 !== undefined) {
    invariant(typeof request.bodyBase64 === 'string', 'PREPARED_BODY_INVALID');
    body = Buffer.from(request.bodyBase64, 'base64');
    invariant(body.toString('base64') === request.bodyBase64,
      'PREPARED_BODY_BASE64_INVALID');
    invariant(sha256(body) === request.bodySha256, 'PREPARED_BODY_CHANGED');
    invariant(Number.isSafeInteger(request.bodyBytes) && body.length === request.bodyBytes,
      'PREPARED_BODY_SIZE_CHANGED');
  } else {
    invariant(request.bodySha256 == null && (request.bodyBytes == null || request.bodyBytes === 0),
      'PREPARED_EMPTY_BODY_CHANGED');
  }
  invariant(!['GET','HEAD'].includes(request.method) || body === null,
    'READ_BODY_NOT_SUPPORTED');

  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers ?? {})) {
    invariant(typeof value === 'string' && !/[\r\n]/.test(value),
      'PREPARED_HEADER_INVALID', {name});
    invariant(!/authorization|cookie|api.?key|token|secret|request-signature|request-timestamp/i.test(name),
      'PREPARED_SECRET_HEADER', {name});
    invariant(!/^(host|content-length|connection|transfer-encoding|proxy-.*)$/i.test(name),
      'PREPARED_TRANSPORT_HEADER', {name});
    invariant(!headers.has(name), 'PREPARED_HEADER_DUPLICATE', {name});
    headers.set(name, value);
  }

  let authentication=null;
  if (request.provider === 'paycashless') {
    invariant(request.context?.credentialBinding===credentialBinding(connection),'PROVIDER_CREDENTIAL_BINDING_CHANGED');
    authentication=injectPaycashlessAuthentication(request,connection,headers,url);
  }
  return {url,headers,body,authentication};
}

function originalRetryAfter(header, observedAt) {
  if (!header) return null;
  const value = header.trim();
  let timestamp;
  if (/^\d+$/.test(value)) {
    const seconds = Number(value);
    if (!Number.isSafeInteger(seconds)) return null;
    timestamp = observedAt + seconds * 1000;
  } else timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp > 8640000000000000) return null;
  return new Date(timestamp).toISOString();
}

function errorCode(value) {
  if (!value || typeof value !== 'object') return null;
  return typeof value.code === 'string' ? value.code : null;
}

function classify(request, result) {
  const response = result.response;
  if (!response?.complete) return {outcome: 'uncertain', reason: 'PROVIDER_RESPONSE_INCOMPLETE'};
  const status = response.status;
  if (status >= 200 && status < 300) {
    const requiresJSON = request.responseFormat === 'json' && !request.allowEmptyResponse &&
      status !== 204 && request.method !== 'HEAD';
    if (result.parseError || requiresJSON && result.parsed === null)
      return {outcome: 'uncertain', reason: 'PROVIDER_SUCCESS_BODY_UNREADABLE'};
    return {outcome: 'accepted', reason: 'PROVIDER_ACCEPTED'};
  }
  if (status === 409) return {outcome: 'uncertain', reason: 'CONFLICT_REQUIRES_ORIGINAL_RESOURCE_READ'};
  if (status >= 500) return {outcome: 'uncertain', reason: 'PROVIDER_SERVER_ERROR'};
  return {outcome: 'rejected', reason: 'PROVIDER_HTTP_' + status};
}

// The caller retains the original attempt before invoking this function.
// It returns complete bytes or an explicitly incomplete prefix, never a retry.
export async function executeProvider(request, {connection, signal} = {}) {
  const selected = selectedRequest(request, connection);
  const timeoutMs = connection.requestTimeoutMs ?? connection.timeoutMs ?? 60000;
  const maxResponseBytes = connection.maxResponseBytes ?? connection.maximumResponseBytes ?? 64 * 1024 * 1024;
  invariant(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 &&
    timeoutMs <= 2147483647, 'PROVIDER_TIMEOUT_INVALID');
  invariant(Number.isSafeInteger(maxResponseBytes) && maxResponseBytes > 0,
    'PROVIDER_RESPONSE_LIMIT_INVALID');
  const result = {
    schema: 'paycashless.original-provider-exchange.v1', request,
    startedAt: new Date().toISOString(), finishedAt: null,
    transport: {status: 'not-sent', dispatched: false},
    response: null, parsed: null, parseError: null, authentication:selected.authentication,
    classification: {outcome: 'uncertain', reason: 'TRANSPORT_NOT_FINISHED'},
  };
  const chunks = [];
  let receivedBytes = 0, observedBytes = 0, reader = null;
  const timed = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timed]) : timed;
  try {
    if (combined.aborted) {
      result.classification = {outcome: 'rejected', reason: 'ABORTED_BEFORE_DISPATCH'};
      return result;
    }
    result.transport = {status: 'uncertain', dispatched: true};
    const response = await fetch(selected.url, {
      method: request.method, headers: selected.headers,
      ...(selected.body === null ? {} : {body: selected.body}),
      redirect: 'error', signal: combined,
    });
    const observedAt = Date.now();
    result.response = {
      status: response.status, statusText: response.statusText,
      headers: Object.fromEntries(response.headers), bodyBase64: '', bytes: 0,
      sha256: sha256(Buffer.alloc(0)), complete: false,
    };
    const retryHeader = response.headers.get('retry-after');
    if (retryHeader !== null) {
      result.retryAfter = retryHeader;
      result.retryNotBefore = originalRetryAfter(retryHeader, observedAt);
    }
    if (response.body) {
      reader = response.body.getReader();
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        observedBytes += chunk.length;
        const remaining = maxResponseBytes - receivedBytes;
        if (chunk.length > remaining) {
          if (remaining > 0) { chunks.push(chunk.subarray(0, remaining)); receivedBytes += remaining; }
          invariant(false, 'PROVIDER_RESPONSE_TOO_LARGE', {maxResponseBytes, observedBytes});
        }
        chunks.push(chunk); receivedBytes += chunk.length;
      }
      reader.releaseLock(); reader = null;
    }
    const bytes = Buffer.concat(chunks, receivedBytes);
    Object.assign(result.response, {
      bodyBase64: bytes.toString('base64'), bytes: bytes.length,
      sha256: sha256(bytes), complete: true,
    });
    result.transport = {status: 'received', dispatched: true};
    const type = response.headers.get('content-type') ?? '';
    if (bytes.length && (request.responseFormat === 'json' || /(^|[/+])json(?:;|$)/i.test(type))) {
      try { result.parsed = parseSourceJSON(bytes, {maxBytes: maxResponseBytes}); }
      catch (error) { result.parseError = {
        code: error.code ?? error.name ?? 'PROVIDER_JSON_INVALID',
        message: 'The complete provider body did not match strict JSON.',
      }; }
    }
    result.classification = classify(request, result);
  } catch (error) {
    if (result.response) {
      const bytes = Buffer.concat(chunks, receivedBytes);
      Object.assign(result.response, {
        bodyBase64: bytes.toString('base64'), bytes: bytes.length,
        sha256: sha256(bytes), complete: false, observedBytes,
      });
    }
    result.transport = {status: result.transport.dispatched ? 'uncertain' : 'not-sent',
      dispatched: result.transport.dispatched, error: {
        name: error.name ?? 'Error',
        code: error.code ?? error.cause?.code ?? 'TRANSPORT_FAILURE',
      }};
    result.classification = {outcome: result.transport.dispatched ? 'uncertain' : 'rejected',
      reason: error.code ?? 'TRANSPORT_RESPONSE_UNCERTAIN'};
  } finally {
    if (reader) { try { await reader.cancel(); } catch {} try { reader.releaseLock(); } catch {} }
    result.finishedAt = new Date().toISOString();
  }
  return result;
}
