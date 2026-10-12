/** HTTP client for merchant receivables. Mutations are never replayed automatically. */
export class ReceivablesApiError extends Error {
  constructor(message, {status = 0, code = 'REQUEST_FAILED', details = null, requestId = null, response = null} = {}) {
    super(message); this.name = 'ReceivablesApiError';
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
export class ReceivablesClient {
  constructor({baseUrl = '/api/receivables', fetch: fetcher = globalThis.fetch} = {}) {
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
      throw new ReceivablesApiError('The server response could not be read. Keep this operation and use Retry after reconnecting.', {
        code: 'TRANSPORT_FAILED', details: {cause: String(error?.message || error), outcome: method === 'GET' ? 'read_failed' : 'unknown'},
      });
    }
    if (binary && response.ok) return response;
    let text;
    try { text = await response.text(); } catch {
      throw new ReceivablesApiError('The response ended before it could be read. Retry the same operation after reconnecting.', {
        status: response.status, code: 'TRANSPORT_FAILED', details: {outcome: method === 'GET' ? 'read_failed' : 'unknown'},
      });
    }
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch {
      throw new ReceivablesApiError('The server returned an unreadable response.', {
        status: response.status, code: 'INVALID_RESPONSE', details: {outcome: method === 'GET' ? 'read_failed' : 'unknown'},
        requestId: response.headers.get('x-request-id'),
      });
    }
    if (!response.ok) {
      const problem = payload?.error && typeof payload.error === 'object' ? payload.error : payload;
      throw new ReceivablesApiError(problem?.message || (typeof payload?.error === 'string' ? payload.error : 'Request failed (' + response.status + ').'), {
        status: response.status, code: problem?.code || payload?.code || 'REQUEST_FAILED',
        details: problem?.details ?? payload?.details ?? null,
        requestId: payload?.requestId || response.headers.get('x-request-id'), response: payload,
      });
    }
    return payload;
  }
  state(query) { return this.request('/state' + queryString(query)); }
  settings(value) { return this.request('/settings', {method: 'POST', body: value}); }
  saveDraft(value) { return this.request('/invoices', {method: 'POST', body: value}); }
  importQuote(value) { return this.request('/import-quote', {method: 'POST', body: value}); }
  quoteFile(id, name) { return this.request('/invoices/' + segment(id) + '/source/' + segment(name), {binary: true}); }
  detail(id, query) { return this.request('/invoices/' + segment(id) + queryString(query)); }
  preview(id) { return this.request('/invoices/' + segment(id) + '/preview'); }
  issue(id, value) { return this.request('/invoices/' + segment(id) + '/issue', {method: 'POST', body: value}); }
  voidInvoice(id, value) { return this.request('/invoices/' + segment(id) + '/void', {method: 'POST', body: value}); }
  credit(id, value) { return this.request('/invoices/' + segment(id) + '/credits', {method: 'POST', body: value}); }
  receipt(value) { return this.request('/receipts', {method: 'POST', body: value}); }
  importSettlement(value) { return this.request('/receipts/settlement', {method: 'POST', body: value}); }
  allocate(value) { return this.request('/allocations', {method: 'POST', body: value}); }
  release(id, value) { return this.request('/allocations/' + segment(id) + '/release', {method: 'POST', body: value}); }
  voidReceipt(id, value) { return this.request('/receipts/' + segment(id) + '/void', {method: 'POST', body: value}); }
  ledger(query) { return this.request('/ledger' + queryString(query)); }
  exportCustomer(customerId, query) { return this.request('/customers/' + segment(customerId) + '/export' + queryString(query)); }
  customerFile(customerId, name, query) {
    return this.request('/customers/' + segment(customerId) + '/export' + queryString({...query, name}), {binary: true});
  }
  file(id, name) { return this.request('/documents/' + segment(id) + '/files/' + segment(name), {binary: true}); }
}
export function createReceivablesClient(options) { return new ReceivablesClient(options); }
