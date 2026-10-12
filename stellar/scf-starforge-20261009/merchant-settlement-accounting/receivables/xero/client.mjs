/** HTTP client for Xero customer document handovers. Mutations are never replayed automatically. */
export class XeroReceivablesApiError extends Error {
  constructor(message, {status = 0, code = 'REQUEST_FAILED', details = null, requestId = null, response = null} = {}) {
    super(message); this.name = 'XeroReceivablesApiError';
    Object.assign(this, {status, code, details, requestId, response});
  }
}
function segment(value) {
  const text = String(value ?? '');
  if (!text || text === '.' || text === '..') throw new TypeError('A record identifier is required.');
  return encodeURIComponent(text);
}
function queryString(query = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  return search.size ? '?' + search : '';
}
export class XeroReceivablesClient {
  constructor({baseUrl = '/api/receivables/xero', fetch: fetcher = globalThis.fetch} = {}) {
    if (typeof fetcher !== 'function') throw new TypeError('A fetch implementation is required.');
    this.baseUrl = String(baseUrl).replace(/\/$/, ''); this.fetch = fetcher;
  }
  async request(path, {method = 'GET', body, signal, binary = false} = {}) {
    const headers = {Accept: binary ? '*/*' : 'application/json'};
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['X-Workspace-Request'] = '1';
    }
    let response;
    try {
      response = await this.fetch(this.baseUrl + path, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        signal, cache: 'no-store', credentials: 'same-origin', redirect: 'error',
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      throw new XeroReceivablesApiError('The server response could not be read. Keep this operation and use Retry after reconnecting.', {
        code: 'TRANSPORT_FAILED', details: {cause: String(error?.message || error), outcome: method === 'GET' ? 'read_failed' : 'unknown'},
      });
    }
    if (binary && response.ok) return response;
    let text;
    try { text = await response.text(); } catch {
      throw new XeroReceivablesApiError('The response ended before it could be read. Retry the same operation after reconnecting.', {
        status: response.status, code: 'TRANSPORT_FAILED', details: {outcome: method === 'GET' ? 'read_failed' : 'unknown'},
      });
    }
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch {
      throw new XeroReceivablesApiError('The server returned an unreadable response.', {
        status: response.status, code: 'INVALID_RESPONSE', details: {outcome: method === 'GET' ? 'read_failed' : 'unknown'},
        requestId: response.headers.get('x-request-id'),
      });
    }
    if (!response.ok) {
      const problem = payload?.error && typeof payload.error === 'object' ? payload.error : payload;
      throw new XeroReceivablesApiError(problem?.message || (typeof payload?.error === 'string' ? payload.error : 'Request failed (' + response.status + ').'), {
        status: response.status, code: problem?.code || payload?.code || 'REQUEST_FAILED',
        details: problem?.details ?? payload?.details ?? null,
        requestId: payload?.requestId || response.headers.get('x-request-id'), response: payload,
      });
    }
    return payload;
  }
  state(query) { return this.request('/state' + queryString(query)); }
  saveProfile(value) { return this.request('/profiles', {method: 'POST', body: value}); }
  preview(value) { return this.request('/preview', {method: 'POST', body: value}); }
  prepare(value) { return this.request('/packages', {method: 'POST', body: value}); }
  detail(id) { return this.request('/packages/' + segment(id)); }
  receive(id, value) { return this.request('/packages/' + segment(id) + '/receive', {method: 'POST', body: value}); }
  correct(id, value) { return this.request('/packages/' + segment(id) + '/correct', {method: 'POST', body: value}); }
  file(id, name) {
    return this.request('/packages/' + segment(id) + '/files/' + segment(name), {binary: true});
  }
  export(id) { return this.request('/packages/' + segment(id) + '/export'); }
  exportFile(id, name = 'handover.tar') {
    return this.request('/packages/' + segment(id) + '/export' + queryString({name}), {binary: true});
  }
}
export function createXeroReceivablesClient(options) { return new XeroReceivablesClient(options); }
