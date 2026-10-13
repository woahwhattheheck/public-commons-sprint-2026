// MIT. CKAN 2.11 Action API transport for explicitly reviewed target operations.
import { catalogOrigin, parseCkanJson } from './capture.mjs';
import { object, bytes, digest, fault, stamp } from '../postgres/publisher/files.mjs';

import { remoteIdentity as identity, isRemoteNumber, remoteNumericEqual } from './remote-json.mjs';

export const CKAN_REMOTE_TARGET_SCHEMA = 'stellar-forge.ckan-remote-target.v1';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const READ = new Set(['package_show', 'resource_show', 'status_show']);
const WRITE = new Set(['package_create', 'package_patch', 'resource_create', 'resource_patch']);
export const isRemoteUuid = value => typeof value === 'string' && UUID.test(value);
const integer = (value, min, max, code) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw fault(code);
  return value;
};
export function remoteTarget(input) {
  if (!object(input) || !isRemoteUuid(input.id) || typeof input.label !== 'string' ||
      !input.label.trim() || input.label.length > 256 ||
      typeof input.authTokenEnv !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(input.authTokenEnv))
    throw fault('CKAN_REMOTE_TARGET_INVALID', 'Choose a target ID, label, HTTPS catalogue and private token environment reference.');
  const value = { schema: CKAN_REMOTE_TARGET_SCHEMA, id: input.id, label: input.label.trim(),
    origin: catalogOrigin(input.origin), authTokenEnv: input.authTokenEnv,
    timeoutMs: integer(input.timeoutMs ?? 30000, 100, 300000, 'CKAN_REMOTE_TIMEOUT_INVALID'),
    maxResponseBytes: integer(input.maxResponseBytes ?? 16777216, 1024, 67108864, 'CKAN_REMOTE_RESPONSE_LIMIT_INVALID') };
  return { ...value, sha256: identity(value) };
}
function tokenFor(target, environment) {
  const token = environment[target.authTokenEnv];
  if (typeof token !== 'string' || !token.length || token.length > 16384 || /[^\x21-\x7e]/.test(token))
    throw fault('CKAN_REMOTE_TOKEN_UNAVAILABLE', 'Provide the selected target token through its private environment reference.');
  return token;
}
export function remoteCredentialAvailable(target, environment = process.env) {
  try { tokenFor(target, environment); return true; } catch { return false; }
}
export function remoteError(error) {
  return { code: error?.code ?? 'CKAN_REMOTE_OPERATION_FAILED',
    message: error?.code ? error.message : 'Read this retained operation before continuing.',
    category: error?.category ?? 'local',
    uncertain: error?.uncertain === true,
    ...(error?.retryAfter ? { retryAfter: error.retryAfter } : {}) };
}
function issue(code, message, { category = 'provider', uncertain = false, retryAfter, receipt } = {}) {
  return Object.assign(fault(code, message, 502), { category, uncertain, retryAfter, receipt });
}
/** No automatic write retry. Preserve the complete returned bytes with the owning
 * release before interpreting a response. Credentials never enter that receipt. */
export async function requestRemoteCkan(target, action, parameters, {
  environment = process.env, signal, fetch: transport = globalThis.fetch, onResponse,
} = {}) {
  if (!READ.has(action) && !WRITE.has(action) || !object(parameters))
    throw fault('CKAN_REMOTE_ACTION_INVALID');
  const checked = remoteTarget(target);
  if (checked.sha256 !== target.sha256) throw fault('CKAN_REMOTE_TARGET_CHANGED');
  const token = tokenFor(target, environment), writing = WRITE.has(action);
  const endpoint = new URL('/api/3/action/' + action, checked.origin);
  const headers = { accept: 'application/json', authorization: token };
  const payload = writing ? bytes(parameters) : undefined;
  if (payload && payload.length > 16777216) throw fault('CKAN_REMOTE_REQUEST_TOO_LARGE');
  if (writing) headers['content-type'] = 'application/json';
  else for (const [key, value] of Object.entries(parameters)) endpoint.searchParams.set(key, String(value));
  const timeout = AbortSignal.timeout(checked.timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const receipt = { schema: 'stellar-forge.ckan-remote-response.v1', targetId: checked.id,
    targetSha256: checked.sha256, origin: checked.origin, action, method: writing ? 'POST' : 'GET',
    requestedAt: stamp(), parametersSha256: identity(parameters) };
  let response;
  try {
    response = await transport(endpoint, { method: receipt.method, headers, body: payload,
      signal: combined, redirect: 'error' });
  } catch {
    throw issue(combined.aborted ? 'CKAN_REMOTE_REQUEST_INTERRUPTED' : 'CKAN_REMOTE_TRANSPORT_FAILED',
      'The target request did not return a complete response. Reconcile this original action before continuing.',
      { category: 'transport', uncertain: writing, receipt });
  }
  Object.assign(receipt, { status: response.status, receivedAt: stamp(),
    headers: Object.fromEntries(['content-type', 'etag', 'last-modified', 'date', 'retry-after']
      .map(key => [key, response.headers.get(key)]).filter(([, value]) => value !== null && !value.includes(token))) });
  const chunks = []; let size = 0;
  try {
    if (!response.body) throw new Error('Missing response body');
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > checked.maxResponseBytes) {
        await response.body.cancel().catch(() => {});
        throw issue('CKAN_REMOTE_RESPONSE_TOO_LARGE', 'The response exceeds this target’s retained-response limit.',
          { category: 'transport', uncertain: writing, receipt });
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error.code) throw error;
    throw issue('CKAN_REMOTE_RESPONSE_INTERRUPTED', 'The target response was interrupted. Reconcile the original action.',
      { category: 'transport', uncertain: writing, receipt });
  }
  const raw = Buffer.concat(chunks);
  // A broken or malicious endpoint must not persist the authorization value.
  if (raw.includes(Buffer.from(token)))
    throw issue('CKAN_REMOTE_CREDENTIAL_REFLECTED', 'The target reflected a credential in its response; no response bytes were retained.',
      { category: 'provider', uncertain: writing, receipt });
  let envelope, invalid = false;
  try { envelope = parseCkanJson(raw); } catch { invalid = true; }
  const reflected = value => {
    const pending = [value];
    while (pending.length) {
      const item = pending.pop();
      if (typeof item === 'string') { if (item.includes(token)) return true; }
      else if (item !== null && typeof item === 'object')
        for (const [key, child] of Object.entries(item)) { if (key.includes(token)) return true; pending.push(child); }
    }
    return false;
  };
  if (!invalid && reflected(envelope))
    throw issue('CKAN_REMOTE_CREDENTIAL_REFLECTED', 'The target reflected a credential in decoded JSON; no response bytes were retained.',
      { category: 'provider', uncertain: writing, receipt });
  Object.assign(receipt, { bytes: raw.length, sha256: digest(raw) });
  try { await onResponse?.(raw, receipt); }
  catch { throw issue('CKAN_REMOTE_RETENTION_FAILED', 'The target response could not be fully retained. Reconcile the original action before continuing.',
    { category: 'retention', uncertain: writing, receipt }); }
  if (response.status === 429)
    throw issue('CKAN_REMOTE_RATE_LIMITED', 'The target rate limit is active. Preserve this action and respect its retry time.',
      { category: 'rate', uncertain: writing, retryAfter: receipt.headers['retry-after'], receipt });
  if ([401, 403].includes(response.status))
    throw issue('CKAN_REMOTE_ACCESS_DENIED', 'The configured target actor could not perform this action.',
      { category: 'authorization', uncertain: writing, receipt });
  if (invalid) {
    throw issue('CKAN_REMOTE_RESPONSE_INVALID', 'The target returned an invalid CKAN response. Inspect its retained response.',
      { category: 'provider', uncertain: writing, receipt });
  }
  const type = typeof envelope?.error?.__type === 'string' ? envelope.error.__type : '';
  if (type === 'Authorization Error')
    throw issue('CKAN_REMOTE_ACCESS_DENIED', 'The configured target actor could not perform this action.',
      { category: 'authorization', uncertain: writing, receipt });
  if (!writing && response.status === 404 && type === 'Not Found Error' && envelope?.success === false)
    return { found: false, value: null, receipt, raw };
  if (!response.ok || envelope?.success !== true || !object(envelope.result)) {
    const validation = type === 'Validation Error';
    throw issue(validation ? 'CKAN_REMOTE_VALIDATION_FAILED' : 'CKAN_REMOTE_PROVIDER_FAILED',
      validation ? 'The target rejected these fields. Inspect the retained validation response and revise the plan.' :
        'The target did not confirm this action. Inspect its retained response and reconcile before continuing.',
      { category: validation ? 'validation' : 'provider', uncertain: writing, receipt });
  }
  return { found: true, value: envelope.result, receipt, raw };
}

/** Match only explicitly requested fields, retaining server-added metadata.
 * CKAN tag/group/extra lists are sets identified by their requested item fields. */
export function remoteFieldsMatch(actual, expected, key = '') {
  if (isRemoteNumber(actual) || isRemoteNumber(expected)) return remoteNumericEqual(actual, expected);
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return false;
    if (['tags', 'groups', 'extras'].includes(key)) {
      const remaining = [...actual];
      return expected.every(item => {
        const index = remaining.findIndex(value => remoteFieldsMatch(value, item));
        if (index < 0) return false; remaining.splice(index, 1); return true;
      });
    }
    return expected.every((item, index) => remoteFieldsMatch(actual[index], item));
  }
  if (object(expected)) return object(actual) &&
    Object.entries(expected).every(([name, value]) => Object.hasOwn(actual, name) && remoteFieldsMatch(actual[name], value, name));
  return Object.is(actual, expected);
}
export function remoteFieldChanges(before, fields) {
  return Object.entries(fields).filter(([key, value]) => !before || !remoteFieldsMatch(before[key], value, key))
    .map(([key, value]) => ({ field: key,
      before: { present: !!before && Object.hasOwn(before, key), value: before?.[key] ?? null },
      after: { present: true, value } }));
}
