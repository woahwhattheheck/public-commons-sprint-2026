// MIT. Exact WordPress HTTP captures; credentials resolve only at dispatch.
import { parseSourceJson } from '../sftp/formats.mjs';
import { fail, identity, sha256, now, requestHeaders, credentialReferences, requestUrl, object } from './config.mjs';
import { immutableJson, readJson, exists } from './files.mjs';
export const RESPONSE_SCHEMA = 'stellar-forge.wordpress-response.v1';
const KEPT_HEADERS = new Set(['content-type','content-length','date','etag','last-modified','link','location','retry-after','x-wp-total','x-wp-totalpages','x-wp-nonce','vary','cache-control']);
export function responseBytes(record) {
  if (record?.schema !== RESPONSE_SCHEMA || typeof record.response?.bodyBase64 !== 'string') fail('WORDPRESS_RESPONSE_RECORD', 'Select an original HTTP capture.', 409);
  const body = Buffer.from(record.response.bodyBase64, 'base64');
  if (body.toString('base64') !== record.response.bodyBase64 || body.length !== record.response.bytes || sha256(body) !== record.response.sha256)
    fail('WORDPRESS_RESPONSE_CHANGED', 'The retained response bytes differ from their original receipt.', 409);
  return body;
}
export function responseBody(record, { exact = false } = {}) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(responseBytes(record));
  try { return exact ? parseSourceJson(text) : JSON.parse(text); }
  catch (error) { if (error.code) throw error; fail('WORDPRESS_RESPONSE_JSON', 'The native response is not valid JSON; its original bytes remain retained.', 409); }
}
export function retryAt(record) {
  const supplied = record.response.headers['retry-after'];
  if (!supplied) return null;
  const seconds = /^\d+$/.test(supplied) ? Number(supplied) : null;
  const time = seconds === null ? Date.parse(supplied) : Date.parse(record.observedAt) + seconds * 1000;
  return Number.isFinite(time) ? new Date(Math.max(Date.parse(record.observedAt), time)).toISOString() : null;
}
export async function captureRequest({ source, route, query = {}, path, environment = process.env, fetchImpl = fetch, signal, onRetained }) {
  const request = { method: 'GET', url: requestUrl(source, route, query), sourceSha256: identity(source),
    context: source.context, credentialReferences: credentialReferences(source) };
  const requestSha256 = identity(request);
  if (await exists(path)) {
    const previous = await readJson(path, source.maxResponseBytes * 2 + 1048576);
    if (previous.requestSha256 !== requestSha256 || identity(previous.request) !== requestSha256)
      fail('WORDPRESS_REQUEST_CHANGED', 'The retained response belongs to a different original request.', 409);
    responseBytes(previous);
    return { record: previous, reused: true };
  }
  signal?.throwIfAborted();
  const controller = new AbortController(), forward = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', forward, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error('WordPress request timeout.')), source.timeoutMs);
  let response, raw;
  const startedAt = now();
  try {
    response = await fetchImpl(request.url, { method: 'GET', headers: requestHeaders(source, environment), redirect: 'manual', signal: controller.signal });
    const chunks = []; let length = 0;
    if (response.body) for await (const chunk of response.body) {
      const bytes = Buffer.from(chunk); length += bytes.length;
      if (length > source.maxResponseBytes) { controller.abort(); fail('WORDPRESS_RESPONSE_LIMIT', 'The native response exceeded the selected byte ceiling.', 413); }
      chunks.push(bytes);
    }
    raw = Buffer.concat(chunks);
  } finally { clearTimeout(timeout); signal?.removeEventListener('abort', forward); }
  const headers = {};
  for (const [key, value] of response.headers) {
    const name = key.toLowerCase();
    if (KEPT_HEADERS.has(name) && name !== 'x-wp-nonce') headers[name] = value;
  }
  const record = { schema: RESPONSE_SCHEMA, request, requestSha256, startedAt, observedAt: now(),
    response: { status: response.status, headers, bytes: raw.length, sha256: sha256(raw), bodyBase64: raw.toString('base64') } };
  await immutableJson(path, record, source.maxResponseBytes * 2 + 1048576);
  // An observer may retain the actual request boundary before the source cursor advances.
  await onRetained?.({ event: 'wordpress.response.retained', requestSha256, path, status: response.status, sha256: record.response.sha256 });
  return { record, reused: false };
}
export function nativeFailure(record) {
  let body; try { body = responseBody(record); } catch {}
  const status = record.response.status;
  return { code: typeof body?.code === 'string' ? body.code : 'HTTP_' + status,
    message: typeof body?.message === 'string' ? body.message : 'The native WordPress request returned HTTP ' + status + '.',
    status, requestSha256: record.requestSha256, responseSha256: record.response.sha256 };
}
