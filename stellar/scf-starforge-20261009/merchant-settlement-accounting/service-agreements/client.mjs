/** Service agreements HTTP client. Preserve the complete original mutation request. */
export class ServiceAgreementClientError extends Error {
  constructor(message, {status = 0, code = 'SERVICE_AGREEMENT_REQUEST_FAILED', details = null,
    uncertain = false, reopenRequired = false, method = '', url = '', requestId = null, response = null, cause} = {}) {
    super(message, cause === undefined ? undefined : {cause});
    this.name = 'ServiceAgreementClientError';
    Object.assign(this, {status, code, details, uncertain, reopenRequired, method, url, requestId, response});
    this.billingId = typeof details?.billingId === 'string' ? details.billingId : null;
  }
}
const MAX_REQUEST_BYTES = 2_000_000;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function segment(value, label = 'record identifier') {
  if (typeof value !== 'string' || !value || value === '.' || value === '..' || /[/\\\u0000-\u001f\u007f]/.test(value))
    throw new TypeError('Supply a valid ' + label + '.');
  return encodeURIComponent(value);
}
function apiBase(value) {
  const source = value ?? '/api/service-agreements';
  let url;
  try { url = new URL(String(source), globalThis.location?.href); }
  catch { throw new TypeError('Use an absolute service-agreement API URL outside a browser.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new TypeError('Use an HTTP service-agreement API URL without credentials, query or fragment.');
  return url.href.replace(/\/+$/, '');
}
function query(values) {
  const output = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string' || !value) throw new TypeError('Supply a nonempty ' + key + '.');
    output.set(key, value);
  }
  return output.size ? '?' + output.toString() : '';
}
function downloadName(header, fallback) {
  let value;
  const encoded = /(?:^|;)\s*filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header ?? '');
  if (encoded) {
    try { value = decodeURIComponent(encoded[1].trim()); } catch {}
  }
  if (!value) {
    const quoted = /(?:^|;)\s*filename\s*=\s*"((?:\\.|[^"])*)"/i.exec(header ?? '');
    if (quoted) value = quoted[1].replace(/\\(.)/g, '$1');
    else value = /(?:^|;)\s*filename\s*=\s*([^;]+)/i.exec(header ?? '')?.[1]?.trim();
  }
  value = (value ?? fallback).split(/[/\\]/).at(-1).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return value && value !== '.' && value !== '..' ? value : fallback;
}
export function createServiceAgreementClient({baseUrl, fetch: fetcher = globalThis.fetch} = {}) {
  if (typeof fetcher !== 'function') throw new TypeError('Supply a fetch implementation.');
  const base = apiBase(baseUrl);
  async function request(path, {method = 'GET', body, signal, download, filename} = {}) {
    const url = base + path, mutation = method !== 'GET' && method !== 'HEAD';
    const originalRequestId = typeof body?.requestId === 'string' ? body.requestId : null;
    const error = (message, values = {}) => new ServiceAgreementClientError(message,
      {method, url, requestId: originalRequestId, ...values});
    if (signal?.aborted) throw error('The request was canceled before it was sent.',
      {code: 'REQUEST_ABORTED', cause: signal.reason});
    let wire;
    if (body !== undefined) {
      if (!object(body)) throw error('Supply the complete original mutation body.', {code: 'INVALID_REQUEST'});
      try { wire = JSON.stringify(body); }
      catch (cause) { throw error('The mutation body must be complete JSON.', {code: 'INVALID_REQUEST', cause}); }
      if (typeof wire !== 'string' || new TextEncoder().encode(wire).byteLength > MAX_REQUEST_BYTES)
        throw error('The complete service-agreement request exceeds 2,000,000 UTF-8 bytes.', {code: 'REQUEST_TOO_LARGE'});
    }
    const headers = {Accept: download ? '*/*' : 'application/json'};
    if (wire !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['X-Workspace-Request'] = '1';
    }
    let response;
    try {
      response = await fetcher(url, {method, headers, body: wire, signal,
        cache: 'no-store', credentials: 'same-origin', redirect: 'error'});
    } catch (cause) {
      throw error('The response could not be received. Retain this original request for reconciliation.', {
        code: cause?.name === 'AbortError' ? 'REQUEST_ABORTED' : 'TRANSPORT_FAILED',
        uncertain: mutation, cause,
      });
    }
    if (download && response.ok) {
      try {
        const bytes = new Uint8Array(await response.arrayBuffer());
        return {name: downloadName(response.headers.get('content-disposition'), filename),
          type: response.headers.get('content-type') ?? 'application/octet-stream', bytes};
      } catch (cause) {
        throw error('The complete file response could not be received.', {
          status: response.status, code: 'TRANSPORT_FAILED', cause,
          requestId: originalRequestId ?? response.headers.get('x-request-id'),
        });
      }
    }
    let raw, payload;
    try { raw = await response.text(); }
    catch (cause) {
      throw error('The response ended before its outcome could be read. Retain this original request.', {
        status: response.status, code: 'TRANSPORT_FAILED', uncertain: mutation, cause,
        requestId: originalRequestId ?? response.headers.get('x-request-id'),
      });
    }
    try { payload = JSON.parse(raw); }
    catch (cause) {
      throw error('The server returned an unreadable response. Retain this original request.', {
        status: response.status, code: 'INVALID_RESPONSE', uncertain: mutation, cause,
        requestId: originalRequestId ?? response.headers.get('x-request-id'),
      });
    }
    if (!response.ok) {
      const problem = object(payload?.error) ? payload.error : object(payload) ? payload : {};
      const details = problem.details ?? payload?.details ?? null;
      const prepared = details?.agreementBillingPrepared === true;
      const durableUnknown = problem.code === 'WORKSPACE_COMMIT_UNKNOWN' ||
        problem.outcomeUnknown === true || details?.outcomeUnknown === true;
      const reopenRequired = durableUnknown || problem.reopenRequired === true || details?.reopenRequired === true;
      const requestId = prepared && typeof details.requestId === 'string' ? details.requestId :
        originalRequestId ?? problem.requestId ?? payload?.requestId ?? response.headers.get('x-request-id');
      const message = typeof problem.message === 'string' ? problem.message :
        typeof payload?.error === 'string' ? payload.error : 'The service-agreement request failed (' + response.status + ').';
      throw error(message, {status: response.status,
        code: typeof problem.code === 'string' ? problem.code : 'SERVICE_AGREEMENT_REQUEST_FAILED',
        details, uncertain: mutation && (response.status >= 500 || prepared || durableUnknown || reopenRequired),
        reopenRequired, requestId, response: payload});
    }
    if (!object(payload)) throw error('The service-agreement response is incomplete. Retain this original request.', {
      status: response.status, code: 'INVALID_RESPONSE', uncertain: mutation, response: payload});
    return payload;
  }
  const agreementPath = id => '/agreements/' + segment(id, 'agreement identifier');
  const action = (name, id, body, options = {}) => request(agreementPath(id) + '/' + name,
    {method: 'POST', body, signal: options.signal});
  return Object.freeze({
    baseUrl: base,
    state: ({asOf, signal} = {}) => request(query({asOf}), {signal}),
    detail: (id, {asOf, signal} = {}) => request(agreementPath(id) + query({asOf}), {signal}),
    preview: (id, {periodId, asOf, signal} = {}) => {
      if (typeof periodId !== 'string' || !periodId) throw new TypeError('Supply the original billing period identifier.');
      return request(agreementPath(id) + '/preview' + query({periodId, asOf}), {signal});
    },
    create: (body, {signal} = {}) => request('/agreements', {method: 'POST', body, signal}),
    amend: (id, body, options) => action('amend', id, body, options),
    renew: (id, body, options) => action('renew', id, body, options),
    cancel: (id, body, options) => action('cancel', id, body, options),
    bill: (id, body, options) => action('bill', id, body, options),
    sourceFile: (id, sourceId, name, {signal} = {}) => request(agreementPath(id) + '/sources/' +
      segment(sourceId, 'source identifier') + '/' + segment(name, 'source filename'),
      {download: true, filename: name, signal}),
    exportAgreement: (id, {format = 'tar', asOf, signal} = {}) => {
      if (!['tar', 'json', 'csv', 'html'].includes(format)) throw new TypeError('Select tar, json, csv or html.');
      return request(agreementPath(id) + '/export' + query({format, asOf}),
        {download: true, filename: 'agreement.' + format, signal});
    },
  });
}
