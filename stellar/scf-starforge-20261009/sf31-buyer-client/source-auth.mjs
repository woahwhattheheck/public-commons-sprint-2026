// MIT. Operator-owned source credentials for the maintained SF31 HTTPS transport.
import { normalizeSourceAuthorization } from './public-transport.mjs';

export class SourceAuthenticationError extends Error {
  constructor(code) {
    super(code);
    this.name = 'SourceAuthenticationError';
    this.code = code;
  }
}
const fail = code => { throw new SourceAuthenticationError(code); };
const METHODS = new Set(['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS']);
const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const CREDENTIAL_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,511}$/;
const BEARER_TOKEN = /^[A-Za-z0-9._~+/-]+=*$/;

function binding(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !['origin','tokenEnv','credentialRef'].includes(key)))
    fail('SOURCE_AUTH_BINDING_INVALID');
  const authorization = normalizeSourceAuthorization({origin:value.origin, scheme:'Bearer'});
  if ((value.tokenEnv === undefined) === (value.credentialRef === undefined))
    fail('SOURCE_AUTH_ONE_CREDENTIAL_REFERENCE_REQUIRED');
  if (value.tokenEnv !== undefined) {
    if (typeof value.tokenEnv !== 'string' || !ENVIRONMENT_NAME.test(value.tokenEnv))
      fail('SOURCE_AUTH_ENVIRONMENT_NAME_INVALID');
    return Object.freeze({...authorization, tokenEnv:value.tokenEnv});
  }
  if (typeof value.credentialRef !== 'string' || !CREDENTIAL_REFERENCE.test(value.credentialRef))
    fail('SOURCE_AUTH_CREDENTIAL_REFERENCE_INVALID');
  return Object.freeze({...authorization, credentialRef:value.credentialRef});
}
function requestIdentity(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input))
    fail('SOURCE_AUTH_REQUEST_INVALID');
  let url;
  try { url = new URL(input.url); } catch { fail('SOURCE_AUTH_REQUEST_INVALID'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash ||
      (url.port && url.port !== '443')) fail('SOURCE_AUTH_REQUEST_INVALID');
  const method = String(input.method ?? 'GET').toUpperCase();
  if (!METHODS.has(method)) fail('SOURCE_AUTH_REQUEST_INVALID');
  if (input.signal !== undefined && !(input.signal instanceof AbortSignal))
    fail('SOURCE_AUTH_ABORT_SIGNAL_INVALID');
  return {url:url.href, origin:url.origin, method, signal:input.signal};
}
function awaitCredential(promise, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const stop = () => { cleanup(); reject(signal.reason); };
    const cleanup = () => signal.removeEventListener('abort', stop);
    signal.addEventListener('abort', stop, {once:true});
    Promise.resolve(promise).then(
      value => { cleanup(); resolve(value); },
      error => { cleanup(); reject(error); }
    );
  });
}

/**
 * Configure only from the operator's private runtime, never a catalog, asset,
 * offered request, portable edition or downloaded deployment package.
 * Environment values and resolver results are read afresh for each dispatch.
 */
export function createSourceBearerAuth({
  bindings, resolveCredential=null, environment=process.env, timeoutMs=30_000
}={}) {
  if (!Array.isArray(bindings) || !bindings.length || bindings.length > 64)
    fail('SOURCE_AUTH_BINDINGS_REQUIRED');
  if ((resolveCredential !== null && typeof resolveCredential !== 'function') ||
      environment === null || typeof environment !== 'object' ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000)
    fail('SOURCE_AUTH_CONFIGURATION_INVALID');
  const selected = bindings.map(binding);
  const byOrigin = new Map(selected.map(value => [value.origin, value]));
  if (byOrigin.size !== selected.length) fail('SOURCE_AUTH_DUPLICATE_ORIGIN');
  if (selected.some(value => value.credentialRef !== undefined) && resolveCredential === null)
    fail('SOURCE_AUTH_CREDENTIAL_RESOLVER_REQUIRED');
  const authorizations = new Map(selected.map(value => [value.origin,
    Object.freeze({origin:value.origin, scheme:'Bearer'})]));
  const active = new Set();
  let closed = false;

  function authorizationForOrigin(origin) {
    if (closed) fail('SOURCE_AUTH_CLOSED');
    const checked = normalizeSourceAuthorization({origin, scheme:'Bearer'});
    return authorizations.get(checked.origin) ?? null;
  }
  async function requestHeaders(input) {
    if (closed) fail('SOURCE_AUTH_CLOSED');
    const request = requestIdentity(input);
    const selected = byOrigin.get(request.origin);
    // Each asset/next URL is considered independently. An unbound origin has
    // no source authority; callers must use the unchanged public transport.
    if (!selected) return Object.freeze({});
    const controller = new AbortController();
    const stop = () => controller.abort(new SourceAuthenticationError('SOURCE_AUTH_ABORTED'));
    if (request.signal?.aborted) stop();
    else request.signal?.addEventListener('abort', stop, {once:true});
    const timer = setTimeout(() => controller.abort(
      new SourceAuthenticationError('SOURCE_AUTH_RESOLUTION_TIMEOUT')), timeoutMs);
    active.add(controller);
    try {
      controller.signal.throwIfAborted();
      let value;
      try {
        value = await awaitCredential(Promise.resolve().then(() =>
          selected.tokenEnv !== undefined
            ? environment[selected.tokenEnv]
            : resolveCredential(selected.credentialRef, {
                url:request.url, origin:request.origin, method:request.method,
                signal:controller.signal
              })
        ), controller.signal);
      } catch {
        if (controller.signal.aborted) throw controller.signal.reason;
        // Every resolver exception is private, including a custom error that
        // happens to use our class. Never forward its message, value or cause.
        throw new SourceAuthenticationError('SOURCE_AUTH_CREDENTIAL_RESOLUTION_FAILED');
      }
      controller.signal.throwIfAborted();
      if (typeof value !== 'string' || value.length < 1)
        fail('SOURCE_AUTH_CREDENTIAL_UNAVAILABLE');
      // No trimming or JSON coercion: use exactly the assigned native token.
      if (value.length > 16384 || !BEARER_TOKEN.test(value))
        fail('SOURCE_AUTH_CREDENTIAL_INVALID');
      return Object.freeze({authorization:'Bearer ' + value});
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', stop);
      active.delete(controller);
    }
  }
  function close() {
    if (closed) return;
    closed = true;
    for (const controller of active)
      controller.abort(new SourceAuthenticationError('SOURCE_AUTH_CLOSED'));
  }
  return Object.freeze({
    origins:Object.freeze([...byOrigin.keys()]),
    requestHeaders, authorizationForOrigin, close
  });
}
