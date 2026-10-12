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
  constructor({baseUrl = '/api/receivables', fetch: fetcher = globalThis.fetch, expectedWorkspaceId, expectedSourcesSha256} = {}) {
    if (typeof fetcher !== 'function') throw new TypeError('A fetch implementation is required.');
    this.baseUrl = String(baseUrl).replace(/\/$/, ''); this.fetch = fetcher;
    if (expectedWorkspaceId !== undefined || expectedSourcesSha256 !== undefined) {
      if (!/^[a-f0-9]{64}$/.test(expectedWorkspaceId || '') || !/^[a-f0-9]{64}$/.test(expectedSourcesSha256 || '')) {
        throw new TypeError('Both original accounting workspace and source identities are required.');
      }
      this.expectedWorkspaceId = expectedWorkspaceId; this.expectedSourcesSha256 = expectedSourcesSha256;
    }
  }
  async request(path, {method = 'GET', body, signal, binary = false} = {}) {
    const headers = {Accept: binary ? '*/*' : 'application/json'};
    if (this.expectedWorkspaceId) {
      headers['X-Accounting-Workspace-Id'] = this.expectedWorkspaceId;
      headers['X-Accounting-Sources-Sha256'] = this.expectedSourcesSha256;
    }
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
  identity() { return this.request('/identity'); }
  state(query) { return this.request('/state' + queryString(query)); }
  creditControl(query, {signal} = {}) { return this.request('/credit-control' + queryString(query), {signal}); }
  creditPolicy(id, {signal} = {}) { return this.request('/credit-control/policies/' + segment(id), {signal}); }
  saveCreditPolicy(value, {signal} = {}) { return this.request('/credit-control/policies', {method:'POST',body:value,signal}); }
  previewCreditAssessment(invoiceId, value, {signal} = {}) {
    return this.request('/credit-control/invoices/' + segment(invoiceId) + '/assessment', {method:'POST',body:value,signal});
  }
  saveCreditDecision(invoiceId, value, {signal} = {}) {
    return this.request('/credit-control/invoices/' + segment(invoiceId) + '/decisions', {method:'POST',body:value,signal});
  }
  creditDecision(id, {signal} = {}) { return this.request('/credit-control/decisions/' + segment(id), {signal}); }
  withdrawCreditDecision(id, value, {signal} = {}) {
    return this.request('/credit-control/decisions/' + segment(id) + '/withdraw', {method:'POST',body:value,signal});
  }
  creditDecisionFile(id, name, {signal} = {}) {
    return this.request('/credit-control/decisions/' + segment(id) + '/files/' + segment(name), {binary:true,signal});
  }
  creditControlOperation(requestId, {signal} = {}) {
    return this.request('/credit-control/operations/' + segment(requestId), {signal});
  }
  cashPlans(query, {signal} = {}) { return this.request('/cash-plans' + queryString(query), {signal}); }
  previewCashPlan(value, {signal} = {}) { return this.request('/cash-plans/preview', {method:'POST', body:value, signal}); }
  cashPlan(id, query, {signal} = {}) { return this.request('/cash-plans/' + segment(id) + queryString(query), {signal}); }
  saveCashPlan(value, {signal} = {}) { return this.request('/cash-plans', {method:'POST', body:value, signal}); }
  archiveCashPlan(id, value, {signal} = {}) { return this.request('/cash-plans/' + segment(id) + '/archive', {method:'POST', body:value, signal}); }
  reopenCashPlan(id, value, {signal} = {}) { return this.request('/cash-plans/' + segment(id) + '/reopen', {method:'POST', body:value, signal}); }
  cashPlanFile(id, name, query, {signal} = {}) { return this.request('/cash-plans/' + segment(id) + '/files/' + segment(name) + queryString(query), {binary:true, signal}); }
  compareCashPlans(query, {signal} = {}) { return this.request('/cash-plans/compare' + queryString(query), {signal}); }
  cashPlanComparisonFile(name, query, {signal} = {}) { return this.request('/cash-plans/compare/export' + queryString({...query,name}), {binary:true, signal}); }
  cashPlanOperation(requestId, {signal} = {}) { return this.request('/cash-plans/operations/' + segment(requestId), {signal}); }
  collectionCases(query, {signal} = {}) { return this.request('/collections' + queryString(query), {signal}); }
  collectionCase(id, query, {signal} = {}) { return this.request('/collections/' + segment(id) + queryString(query), {signal}); }
  saveCollectionCase(value, {signal} = {}) { return this.request('/collections', {method:'POST', body:value, signal}); }
  recordCollectionActivity(id, value, {signal} = {}) { return this.request('/collections/' + segment(id) + '/activities', {method:'POST', body:value, signal}); }
  closeCollectionCase(id, value, {signal} = {}) { return this.request('/collections/' + segment(id) + '/close', {method:'POST', body:value, signal}); }
  reopenCollectionCase(id, value, {signal} = {}) { return this.request('/collections/' + segment(id) + '/reopen', {method:'POST', body:value, signal}); }
  collectionReminder(id, query, {signal} = {}) { return this.request('/collections/' + segment(id) + '/reminder' + queryString(query), {signal}); }
  collectionFile(id, name, query, {signal} = {}) { return this.request('/collections/' + segment(id) + '/files/' + segment(name) + queryString(query), {binary:true, signal}); }
  collectionsFile(name, query, {signal} = {}) { return this.request('/collections/export' + queryString({...query,name}), {binary:true, signal}); }
  collectionOperation(requestId, {signal} = {}) { return this.request('/collections/operations/' + segment(requestId), {signal}); }
  settings(value) { return this.request('/settings', {method: 'POST', body: value}); }
  saveDraft(value) { return this.request('/invoices', {method: 'POST', body: value}); }
  importQuote(value) { return this.request('/import-quote', {method: 'POST', body: value}); }
  quoteFile(id, name) { return this.request('/invoices/' + segment(id) + '/source/' + segment(name), {binary: true}); }
  detail(id, query) { return this.request('/invoices/' + segment(id) + queryString(query)); }
  preview(id) { return this.request('/invoices/' + segment(id) + '/preview'); }

  previewPaymentRequest(invoiceId, value, {signal} = {}) {
    return this.request('/invoices/' + segment(invoiceId) + '/payment-requests/preview', {method: 'POST', body: value, signal});
  }
  createPaymentRequest(invoiceId, value, {signal} = {}) {
    return this.request('/invoices/' + segment(invoiceId) + '/payment-requests', {method: 'POST', body: value, signal});
  }
  paymentRequests(query, {signal} = {}) {
    return this.request('/payment-requests' + queryString(query), {signal});
  }
  paymentRequest(id, query, {signal} = {}) {
    return this.request('/payment-requests/' + segment(id) + queryString(query), {signal});
  }
  cancelPaymentRequest(id, value, {signal} = {}) {
    return this.request('/payment-requests/' + segment(id) + '/cancel', {method: 'POST', body: value, signal});
  }
  reportPaymentReturn(id, value, {signal} = {}) {
    return this.request('/payment-requests/' + segment(id) + '/returns', {method: 'POST', body: value, signal});
  }
  receivePaymentRequest(id, value, {signal} = {}) {
    return this.request('/payment-requests/' + segment(id) + '/receive', {method: 'POST', body: value, signal});
  }
  paymentRequestFile(id, name, {signal} = {}) {
    return this.request('/payment-requests/' + segment(id) + '/files/' + segment(name), {binary: true, signal});
  }
  async paymentRequestBytes(id, name, options) {
    const response = await this.paymentRequestFile(id, name, options);
    try {
      return {name, type: response.headers.get('content-type') || 'application/octet-stream',
        bytes: new Uint8Array(await response.arrayBuffer())};
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      throw new ReceivablesApiError('The payment request file could not be read. Download that same file again.', {
        status: response.status, code: 'DOWNLOAD_FAILED',
        details: {name, cause: String(error?.message || error), outcome: 'read_failed'},
      });
    }
  }

  customerFunds(query, {signal} = {}) {
    return this.request('/funds' + queryString(query), {signal});
  }
  previewRefund(value, {signal} = {}) {
    return this.request('/refunds/preview', {method: 'POST', body: value, signal});
  }
  commitRefund(value, {signal} = {}) {
    return this.request('/refunds', {method: 'POST', body: value, signal});
  }
  refunds(query, {signal} = {}) {
    return this.request('/refunds' + queryString(query), {signal});
  }
  refund(id, query, {signal} = {}) {
    return this.request('/refunds/' + segment(id) + queryString(query), {signal});
  }
  cancelRefund(id, value, {signal} = {}) {
    return this.request('/refunds/' + segment(id) + '/cancel', {method: 'POST', body: value, signal});
  }
  reverseRefund(id, value, {signal} = {}) {
    return this.request('/refunds/' + segment(id) + '/reverse', {method: 'POST', body: value, signal});
  }
  reportRefundReturn(id, value, {signal} = {}) {
    return this.request('/refunds/' + segment(id) + '/returns', {method: 'POST', body: value, signal});
  }
  receiveRefund(id, value, {signal} = {}) {
    return this.request('/refunds/' + segment(id) + '/receive', {method: 'POST', body: value, signal});
  }
  refundFile(id, name, {signal} = {}) {
    return this.request('/refunds/' + segment(id) + '/files/' + segment(name), {binary: true, signal});
  }
  async refundBytes(id, name, options) {
    const response = await this.refundFile(id, name, options);
    try {
      return {name, type: response.headers.get('content-type') || 'application/octet-stream',
        bytes: new Uint8Array(await response.arrayBuffer())};
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      throw new ReceivablesApiError('The refund file could not be read. Download that same file again.', {
        status: response.status, code: 'DOWNLOAD_FAILED',
        details: {name, cause: String(error?.message || error), outcome: 'read_failed'},
      });
    }
  }
  previewCreditDisposition(value, {signal} = {}) {
    return this.request('/credit-dispositions/preview', {method: 'POST', body: value, signal});
  }
  applyCreditDisposition(value, {signal} = {}) {
    return this.request('/credit-dispositions', {method: 'POST', body: value, signal});
  }

  bankAccounts(query, {signal} = {}) {
    return this.request('/bank-accounts' + queryString(query), {signal});
  }
  saveBankAccount(value, {signal} = {}) {
    return this.request('/bank-accounts', {method: 'POST', body: value, signal});
  }
  inspectBankSource(value, {signal} = {}) {
    return this.request('/bank-imports/inspect', {method: 'POST', body: value, signal});
  }
  importBankSource(value, {signal} = {}) {
    return this.request('/bank-imports', {method: 'POST', body: value, signal});
  }
  bankImports(query, {signal} = {}) {
    return this.request('/bank-imports' + queryString(query), {signal});
  }
  bankImport(id, query, {signal} = {}) {
    return this.request('/bank-imports/' + segment(id) + queryString(query), {signal});
  }
  previewBankPosting(id, value, {signal} = {}) {
    return this.request('/bank-imports/' + segment(id) + '/preview', {method: 'POST', body: value, signal});
  }
  postBankReceipts(id, value, {signal} = {}) {
    return this.request('/bank-imports/' + segment(id) + '/post', {method: 'POST', body: value, signal});
  }
  ignoreBankRows(id, value, {signal} = {}) {
    return this.request('/bank-imports/' + segment(id) + '/ignore', {method: 'POST', body: value, signal});
  }
  restoreBankRows(id, value, {signal} = {}) {
    return this.request('/bank-imports/' + segment(id) + '/restore', {method: 'POST', body: value, signal});
  }
  closeBankImport(id, value, {signal} = {}) {
    return this.request('/bank-imports/' + segment(id) + '/close', {method: 'POST', body: value, signal});
  }
  bankImportFile(id, name, {signal} = {}) {
    return this.request('/bank-imports/' + segment(id) + '/files/' + segment(name), {binary: true, signal});
  }
  async bankImportBytes(id, name, options) {
    const response = await this.bankImportFile(id, name, options);
    try {
      return {name, type: response.headers.get('content-type') || 'application/octet-stream',
        bytes: new Uint8Array(await response.arrayBuffer())};
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      throw new ReceivablesApiError('The bank import file could not be read. Download that same file again.', {
        status: response.status, code: 'DOWNLOAD_FAILED',
        details: {name, cause: String(error?.message || error), outcome: 'read_failed'},
      });
    }
  }
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
