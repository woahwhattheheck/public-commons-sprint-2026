import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openAccountingWorkspace} from '../workspace/store.mjs';
import {accountingWorkspaceBinding, assertAccountingWorkspaceBinding} from '../workspace/binding.mjs';
import {ReceivablesWorkspace, RECEIVABLE_REQUEST_BYTES} from './store.mjs';
import {renderCustomerTar} from './core.mjs';
import {PaymentPlanWorkspace} from './payment-plans/store.mjs';
import {paymentPlanAsset, handlePaymentPlansRequest, PAYMENT_PLAN_REQUEST_BYTES} from './payment-plans/server.mjs';
import {readBrowserAssets} from '../../distribution/browser-assets.mjs';
import {CustomerStatementWorkspace, STATEMENT_REQUEST_BYTES} from '../customer-statements/store.mjs';
import {customerStatementAsset, handleCustomerStatementRequest} from '../customer-statements/server.mjs';

const STATIC = await readBrowserAssets(new URL('./browser-assets.json', import.meta.url));
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const DOCUMENT_NAMES = new Set(['invoice.json', 'invoice.html', 'invoice.csv', 'manifest.json', 'status.json', 'credit.json', 'credit.html', 'credit.csv']);

function problem(code, message, status = 400, details) {
  return Object.assign(new Error(message), {code, status, details});
}
function basePath(value, fallback) {
  const path = String(value || fallback).replace(/\/+$/, '');
  if (!path.startsWith('/') || path.includes('?') || path.includes('#') || path.includes('//') || path.split('/').includes('..')) {
    throw new TypeError('A local absolute route path is required.');
  }
  return path;
}
function securityHeaders(response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
}
function json(response, status, value) {
  const bytes = Buffer.from(JSON.stringify(value, (_, item) => typeof item === 'bigint' ? String(item) : item));
  response.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Content-Length': bytes.length});
  response.end(bytes);
}
function localRequest(request, configuredPort, mutation) {
  const raw = request.headers.host;
  if (typeof raw !== 'string' || raw.includes('@') || /[\s/#?]/.test(raw)) throw problem('INVALID_HOST', 'Use the local workspace address.', 403);
  let host;
  try { host = new URL('http://' + raw); } catch { throw problem('INVALID_HOST', 'Use the local workspace address.', 403); }
  const port = configuredPort || request.socket?.localPort;
  const effectivePort = host.port ? Number(host.port) : 80;
  if (!LOOPBACK.has(host.hostname.toLowerCase()) || (port && Number(port) !== effectivePort)) {
    throw problem('INVALID_HOST', 'Use the local workspace address and port.', 403);
  }
  if (request.headers.origin !== undefined) {
    let origin;
    try { origin = new URL(String(request.headers.origin)); } catch { throw problem('INVALID_ORIGIN', 'Open this request in the local workspace.', 403); }
    if (origin.protocol !== 'http:' || origin.host.toLowerCase() !== host.host.toLowerCase() || origin.username || origin.password) {
      throw problem('INVALID_ORIGIN', 'Open this request in the local workspace.', 403);
    }
  }
  if (mutation) {
    if (request.headers['x-workspace-request'] !== '1') throw problem('WORKSPACE_REQUEST_REQUIRED', 'Use the workspace client to save changes.', 403);
    const contentType = String(request.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (contentType !== 'application/json') throw problem('JSON_REQUIRED', 'Send an application/json request.', 415);
    const encoding = request.headers['content-encoding'];
    if (encoding && encoding !== 'identity') throw problem('UNSUPPORTED_ENCODING', 'Send an uncompressed JSON request.', 415);
  }
  return host;
}
async function body(request, maximum = RECEIVABLE_REQUEST_BYTES) {
  const declared = request.headers['content-length'];
  if (declared !== undefined && (!/^\d+$/.test(String(declared)) || Number(declared) > maximum)) {
    throw problem('REQUEST_TOO_LARGE', 'The request exceeds the workspace document limit.', 413);
  }
  const buffers = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximum) throw problem('REQUEST_TOO_LARGE', 'The request exceeds the workspace document limit.', 413);
    buffers.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(buffers).toString('utf8')); } catch { throw problem('INVALID_JSON', 'The request body must contain valid JSON.'); }
  if (!value || Array.isArray(value) || typeof value !== 'object') throw problem('INVALID_JSON', 'The request must be a JSON object.');
  return value;
}
function identifier(raw) {
  let value;
  try { value = decodeURIComponent(raw); } catch { throw problem('INVALID_IDENTIFIER', 'The record identifier is malformed.'); }
  if (!value || value.length > 240 || value === '.' || value === '..' || /[\\/\u0000-\u001f]/.test(value)) throw problem('INVALID_IDENTIFIER', 'The record identifier is malformed.');
  return value;
}
function integer(query, name, fallback, maximum) {
  const value = query.get(name);
  if (value === null || value === '') return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > maximum) throw problem('INVALID_PAGINATION', 'Use valid ledger pagination.');
  return Number(value);
}
function file(response, result, head = false) {
  if (!result || !result.bytes || typeof result.name !== 'string') throw problem('DOCUMENT_NOT_FOUND', 'The requested document is unavailable.', 404);
  const bytes = Buffer.isBuffer(result.bytes) ? result.bytes : Buffer.from(result.bytes);
  const filename = result.name.replace(/[\r\n"\\]/g, '_').split('/').pop();
  response.writeHead(200, {
    'Content-Type': result.type || 'application/octet-stream',
    'Content-Length': bytes.length,
    'Content-Disposition': 'attachment; filename="' + filename + '"',
  });
  response.end(head ? undefined : bytes);
}
function publicError(error) {
  const code = String(error?.code || 'INTERNAL_ERROR');
  let status = Number(error?.status || error?.statusCode);
  if (!Number.isInteger(status) || status < 400 || status > 599) {
    status = /NOT_FOUND|UNKNOWN_(INVOICE|CUSTOMER|RECEIPT|DOCUMENT|RUN)/i.test(code) ? 404 :
      /CONFLICT|STALE|REVISION|VERSION|REQUEST_ID_REUSED|LEASE|ALREADY/i.test(code) ? 409 :
      code === 'INTERNAL_ERROR' ? 500 : 400;
  }
  return {status, value: {error: {code, message: status >= 500 ? 'The workspace could not finish this request. Keep the operation and retry after recovery.' : String(error?.message || code), ...(error?.details === undefined ? {} : {details: error.details})}}};
}

/** Assets are reusable by the original accounting HTTP runtime. */
export async function receivablesAsset(path, {apiPath = '/api/receivables', uiPath = '/receivables'} = {}) {
  apiPath = basePath(apiPath, '/api/receivables'); uiPath = basePath(uiPath, '/receivables');
  if (path !== uiPath && !path.startsWith(uiPath + '/')) return null;
  const name = path === uiPath ? 'index.html' : path.slice(uiPath.length + 1) || 'index.html';
  if (name === 'config.json') return {bytes: Buffer.from(JSON.stringify({apiPath, uiPath, requestBytes: RECEIVABLE_REQUEST_BYTES})), type: 'application/json; charset=utf-8'};
  const entry = STATIC.get('/receivables/' + name);
  return entry ? {bytes: await readFile(entry.url), type: entry.type} : null;
}

/** Original-style pure route adapter: the parent keeps its request/auth/lifecycle boundary. */
export async function handleReceivablesRequest(receivables, {method, path, query = {}, value, apiPath = '/api/receivables', expectedWorkspaceId, expectedSourcesSha256}) {
  apiPath = basePath(apiPath, '/api/receivables');
  if (path !== apiPath && !path.startsWith(apiPath + '/')) return null;
  const workspace = receivables.workspace;
  if (expectedWorkspaceId !== undefined || expectedSourcesSha256 !== undefined)
    assertAccountingWorkspaceBinding(workspace.directory, workspace.state, {expectedWorkspaceId, expectedSourcesSha256});
  const parts = path.slice(apiPath.length).split('/').filter(Boolean).map(identifier);
  const route = parts.join('/');
  const search = query instanceof URLSearchParams ? query : new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined && value !== null));
  const cashComparisonQuery = () => Object.fromEntries(['leftId','rightId','leftEditionId','rightEditionId'].map(key => [key,search.get(key)||undefined]));
  const collectionsQuery = () => Object.fromEntries(['asOf','customerId','owner','status','search'].map(key => [key, search.get(key) || undefined]));
  let result;
  if (method === 'GET') {
    if (route === 'identity') {
      const {schema, workspaceId, sourcesSha256} = accountingWorkspaceBinding(workspace.directory, workspace.state);
      result = {schema, workspaceId, sourcesSha256};
    }
    else if (route === '' || route === 'state') result = await receivables.state({asOf: search.get('asOf') || undefined});
    else if (route === 'credit-control') result = await receivables.creditControl({
      customerId:search.get('customerId')||undefined,search:search.get('search')||undefined,
    });
    else if (parts[0] === 'credit-control' && parts[1] === 'policies' && parts.length === 3)
      result = await receivables.creditPolicy(parts[2]);
    else if (parts[0] === 'credit-control' && parts[1] === 'decisions' && parts.length === 3)
      result = await receivables.creditDecision(parts[2]);
    else if (parts[0] === 'credit-control' && parts[1] === 'decisions' && parts[3] === 'files' && parts.length === 5) {
      const selected=await receivables.creditDecisionFile(parts[2],parts[4]);
      return {file:selected,type:selected.type};
    }
    else if (parts[0] === 'credit-control' && parts[1] === 'operations' && parts.length === 3)
      result = await receivables.creditControlOperation(parts[2]);
    else if (route === 'cash-plans') result = await receivables.cashPlans({status:search.get('status')||undefined,search:search.get('search')||undefined});
    else if (route === 'cash-plans/compare') result = await receivables.compareCashPlans(cashComparisonQuery());
    else if (route === 'cash-plans/compare/export') {
      const selected=await receivables.cashPlanComparisonFile(search.get('name'),cashComparisonQuery());
      return {file:selected,type:selected.type};
    }
    else if (parts[0] === 'cash-plans' && parts[1] === 'operations' && parts.length === 3)
      result = await receivables.cashPlanOperation(parts[2]);
    else if (parts[0] === 'cash-plans' && parts.length === 2)
      result = await receivables.cashPlan(parts[1],{editionId:search.get('editionId')||undefined});
    else if (parts[0] === 'cash-plans' && parts[2] === 'files' && parts.length === 4) {
      const selected=await receivables.cashPlanFile(parts[1],parts[3],{editionId:search.get('editionId')||undefined});
      return {file:selected,type:selected.type};
    }
    else if (route === 'collections') result = await receivables.collectionCases(collectionsQuery());
    else if (route === 'collections/export') {
      const selected = await receivables.collectionsFile(search.get('name'), collectionsQuery());
      return {file: selected, type: selected.type};
    }
    else if (parts[0] === 'collections' && parts[1] === 'operations' && parts.length === 3)
      result = await receivables.collectionOperation(parts[2]);
    else if (parts[0] === 'collections' && parts.length === 2)
      result = await receivables.collectionCase(parts[1], {asOf: search.get('asOf') || undefined});
    else if (parts[0] === 'collections' && parts[2] === 'reminder' && parts.length === 3)
      result = await receivables.collectionReminder(parts[1], {asOf: search.get('asOf') || undefined});
    else if (parts[0] === 'collections' && parts[2] === 'files' && parts.length === 4) {
      const selected = await receivables.collectionFile(parts[1], parts[3], {asOf: search.get('asOf') || undefined});
      return {file: selected, type: selected.type};
    }
    else if (route === 'bank-accounts') result = await receivables.bankAccounts({
      status: search.get('status') || undefined, search: search.get('search') || undefined,
      offset: integer(search, 'offset', 0, Number.MAX_SAFE_INTEGER), limit: integer(search, 'limit', 100, 500),
    });
    else if (route === 'bank-imports') result = await receivables.bankImports({
      accountId: search.get('accountId') || undefined, status: search.get('status') || undefined,
      search: search.get('search') || undefined,
      offset: integer(search, 'offset', 0, Number.MAX_SAFE_INTEGER), limit: integer(search, 'limit', 100, 500),
    });
    else if (parts[0] === 'bank-imports' && parts.length === 2) result = await receivables.bankImport(parts[1], {
      view: search.get('view') || undefined, rowStatus: search.get('rowStatus') || undefined,
      direction: search.get('direction') || undefined, search: search.get('search') || undefined,
      offset: integer(search, 'offset', 0, Number.MAX_SAFE_INTEGER), limit: integer(search, 'limit', 100, 500),
    });
    else if (parts[0] === 'bank-imports' && parts[2] === 'files' && parts.length === 4) {
      const selected = await receivables.bankImportFile(parts[1], parts[3]);
      return {file: selected, type: selected.type};
    }
    else if (route === 'funds') result = await receivables.customerFunds({
      customerId: search.get('customerId') || undefined, asOf: search.get('asOf') || undefined,
    });
    else if (parts[0] === 'customers' && parts[2] === 'funds' && parts.length === 3)
      result = await receivables.customerFunds({customerId: parts[1], asOf: search.get('asOf') || undefined});
    else if (route === 'refunds') result = await receivables.refunds({
      customerId: search.get('customerId') || undefined, receiptId: search.get('receiptId') || undefined,
      status: search.get('status') || undefined, asOf: search.get('asOf') || undefined,
      offset: integer(search, 'offset', 0, Number.MAX_SAFE_INTEGER), limit: integer(search, 'limit', 100, 500),
    });
    else if (parts[0] === 'refunds' && parts.length === 2)
      result = await receivables.refund(parts[1], {asOf: search.get('asOf') || undefined});
    else if (parts[0] === 'refunds' && parts[2] === 'files' && parts.length === 4) {
      const selected = await receivables.refundFile(parts[1], parts[3]);
      return {file: selected, type: selected.type};
    }
    else if (route === 'payment-requests') result = await receivables.paymentRequests({
      invoiceId: search.get('invoiceId') || undefined, customerId: search.get('customerId') || undefined,
      status: search.get('status') || undefined, asOf: search.get('asOf') || undefined,
      offset: integer(search, 'offset', 0, Number.MAX_SAFE_INTEGER), limit: integer(search, 'limit', 100, 500),
    });
    else if (parts[0] === 'payment-requests' && parts.length === 2) result = await receivables.paymentRequest(parts[1], {asOf: search.get('asOf') || undefined});
    else if (parts[0] === 'payment-requests' && parts[2] === 'files' && parts.length === 4) {
      const selected = await receivables.paymentRequestFile(parts[1], parts[3]);
      return {file: selected, type: selected.type};
    }
    else if (route === 'ledger') result = await receivables.ledger({
      runId: search.get('runId') || '', customerId: search.get('customerId') || '',
      offset: integer(search, 'offset', 0, Number.MAX_SAFE_INTEGER), limit: integer(search, 'limit', 100, 500),
    });
    else if (parts[0] === 'invoices' && parts.length === 2) result = await receivables.detail(parts[1], {asOf: search.get('asOf') || undefined});
    else if (parts[0] === 'invoices' && parts[2] === 'preview' && parts.length === 3) result = await receivables.preview(parts[1]);
    else if (parts[0] === 'invoices' && parts[2] === 'source' && parts.length === 4) {
      if (!['quote.json', 'response.json', 'source.json', 'review.json'].includes(parts[3])) throw problem('DOCUMENT_NOT_FOUND', 'Choose an available source quote document.', 404);
      const selected = await receivables.quoteFile(parts[1], parts[3]); return {file: selected, type: selected.type};
    }
    else if (parts[0] === 'documents' && parts[2] === 'files' && parts.length === 4) {
      if (!DOCUMENT_NAMES.has(parts[3])) throw problem('DOCUMENT_NOT_FOUND', 'Choose an available invoice or credit document.', 404);
      const selected = await receivables.file(parts[1], parts[3]);
      return {file: selected, type: selected.type};
    } else if (parts[0] === 'customers' && parts[2] === 'export' && parts.length === 3) {
      const bundle = await receivables.exportCustomer(parts[1], {asOf: search.get('asOf') || undefined});
      const name = search.get('name');
      if (name === 'account.tar') return {file: {bytes: renderCustomerTar(bundle.files), name: 'customer-account-' + parts[1] + '.tar', type: 'application/x-tar'}, type: 'application/x-tar'};
      if (name) {
        const selected = bundle.files?.find(item => item.name === name);
        if (!selected) throw problem('DOCUMENT_NOT_FOUND', 'This customer export format is unavailable.', 404);
        return {file: selected, type: selected.type};
      }
      result = bundle.value;
    } else throw problem('NOT_FOUND', 'This receivables route does not exist.', 404);
  } else if (method === 'POST') {
    if (!value || Array.isArray(value) || typeof value !== 'object') throw problem('INVALID_JSON', 'Send a JSON operator request.');
    if (route === 'settings') result = await receivables.settings(value);
    else if (route === 'credit-control/policies') result = await receivables.saveCreditPolicy(value);
    else if (parts[0] === 'credit-control' && parts[1] === 'invoices' && parts[3] === 'assessment' && parts.length === 4)
      result = await receivables.previewCreditAssessment(parts[2],value);
    else if (parts[0] === 'credit-control' && parts[1] === 'invoices' && parts[3] === 'decisions' && parts.length === 4)
      result = await receivables.saveCreditDecision(parts[2],value);
    else if (parts[0] === 'credit-control' && parts[1] === 'decisions' && parts[3] === 'withdraw' && parts.length === 4)
      result = await receivables.withdrawCreditDecision(parts[2],value);
    else if (route === 'cash-plans/preview') result = await receivables.previewCashPlan(value);
    else if (route === 'cash-plans') result = await receivables.saveCashPlan(value);
    else if (parts[0] === 'cash-plans' && parts.length === 3) {
      if (parts[2] === 'archive') result=await receivables.archiveCashPlan(parts[1],value);
      else if (parts[2] === 'reopen') result=await receivables.reopenCashPlan(parts[1],value);
      else throw problem('NOT_FOUND','Choose an existing cash-plan operation.',404);
    }
    else if (route === 'collections') result = await receivables.saveCollectionCase(value);
    else if (parts[0] === 'collections' && parts.length === 3) {
      if (parts[2] === 'activities') result = await receivables.recordCollectionActivity(parts[1], value);
      else if (parts[2] === 'close') result = await receivables.closeCollectionCase(parts[1], value);
      else if (parts[2] === 'reopen') result = await receivables.reopenCollectionCase(parts[1], value);
      else throw problem('NOT_FOUND', 'Choose an existing collection case operation.', 404);
    }
    else if (route === 'bank-accounts') result = await receivables.saveBankAccount(value);
    else if (route === 'bank-imports/inspect') result = await receivables.inspectBankSource(value);
    else if (route === 'bank-imports') result = await receivables.importBankSource(value);
    else if (parts[0] === 'bank-imports' && parts.length === 3) {
      if (parts[2] === 'preview') result = await receivables.previewBankPosting(parts[1], value);
      else if (parts[2] === 'post') result = await receivables.postBankReceipts(parts[1], value);
      else if (parts[2] === 'ignore') result = await receivables.ignoreBankRows(parts[1], value);
      else if (parts[2] === 'restore') result = await receivables.restoreBankRows(parts[1], value);
      else if (parts[2] === 'close') result = await receivables.closeBankImport(parts[1], value);
      else throw problem('NOT_FOUND', 'This bank statement operation does not exist.', 404);
    }
    else if (route === 'refunds/preview') result = await receivables.previewRefund(value);
    else if (route === 'refunds') result = await receivables.commitRefund(value);
    else if (route === 'credit-dispositions/preview') result = await receivables.previewCreditDisposition(value);
    else if (route === 'credit-dispositions') result = await receivables.applyCreditDisposition(value);
    else if (parts[0] === 'refunds' && parts.length === 3) {
      if (parts[2] === 'cancel') result = await receivables.cancelRefund(parts[1], value);
      else if (parts[2] === 'reverse') result = await receivables.reverseRefund(parts[1], value);
      else if (parts[2] === 'returns') result = await receivables.reportRefundReturn(parts[1], value);
      else if (parts[2] === 'receive') result = await receivables.receiveRefund(parts[1], value);
      else throw problem('NOT_FOUND', 'This customer refund operation does not exist.', 404);
    }
    else if (route === 'invoices') result = await receivables.saveDraft(value);
    else if (route === 'import-quote') result = await receivables.importQuote(value);
    else if (route === 'receipts') result = await receivables.receipt(value);
    else if (route === 'receipts/settlement') result = await receivables.importSettlement(value);
    else if (route === 'allocations') result = await receivables.allocate(value);
    else if (parts[0] === 'invoices' && parts[2] === 'payment-requests' && parts.length === 4 && parts[3] === 'preview') result = await receivables.previewPaymentRequest(parts[1], value);
    else if (parts[0] === 'invoices' && parts[2] === 'payment-requests' && parts.length === 3) result = await receivables.createPaymentRequest(parts[1], value);
    else if (parts[0] === 'payment-requests' && parts.length === 3) {
      if (parts[2] === 'cancel') result = await receivables.cancelPaymentRequest(parts[1], value);
      else if (parts[2] === 'returns') result = await receivables.reportPaymentReturn(parts[1], value);
      else if (parts[2] === 'receive') result = await receivables.receivePaymentRequest(parts[1], value);
      else throw problem('NOT_FOUND', 'This payment request operation does not exist.', 404);
    }
    else if (parts[0] === 'invoices' && parts.length === 3) {
      if (parts[2] === 'issue') result = await receivables.issue(parts[1], value);
      else if (parts[2] === 'void') result = await receivables.voidInvoice(parts[1], value);
      else if (parts[2] === 'credits') result = await receivables.credit(parts[1], value);
      else throw problem('NOT_FOUND', 'This invoice operation does not exist.', 404);
    } else if (parts[0] === 'allocations' && parts[2] === 'release' && parts.length === 3) result = await receivables.release(parts[1], value);
    else if (parts[0] === 'receipts' && parts[2] === 'void' && parts.length === 3) result = await receivables.voidReceipt(parts[1], value);
    else throw problem('NOT_FOUND', 'This receivables operation does not exist.', 404);
  } else throw problem('METHOD_NOT_ALLOWED', 'Use a supported workspace operation.', 405);
  return {value: result};
}

/** Compose with a provided accounting workspace; no additional lease is acquired. */
export async function createReceivablesHandler(receivables, {apiPath = '/api/receivables', uiPath = '/receivables', port, statements, paymentPlans} = {}) {
  apiPath = basePath(apiPath, '/api/receivables'); uiPath = basePath(uiPath, '/receivables');
  await receivables.init();
  if (paymentPlans) await paymentPlans.init();
  const planApiPath = apiPath + '/payment-plans';
  return async function receivablesHandler(request, response) {
    let url;
    try { url = new URL(request.url || '/', 'http://localhost'); } catch { return false; }
    const api = url.pathname === apiPath || url.pathname.startsWith(apiPath + '/');
    const ui = url.pathname === uiPath || url.pathname.startsWith(uiPath + '/');
    const customer = statements && (url.pathname === '/customer-statements' || url.pathname.startsWith('/customer-statements/') ||
      url.pathname === '/api/customer-statements' || url.pathname.startsWith('/api/customer-statements/'));
    const planUi = url.pathname === '/payment-plans' || url.pathname.startsWith('/payment-plans/');
    const planRequest = paymentPlans && (planUi || url.pathname === planApiPath || url.pathname.startsWith(planApiPath + '/'));
    if (!api && !ui && !customer && !planRequest) return false;
    securityHeaders(response);
    try {
      const mutation = request.method === 'POST';
      localRequest(request, port, mutation);
      if (request.method === 'GET' || request.method === 'HEAD') {
        if (url.pathname === uiPath) { response.writeHead(302, {Location: uiPath + '/'}); response.end(); return true; }
        if (planRequest && url.pathname === '/payment-plans') { response.writeHead(302, {Location: '/payment-plans/'}); response.end(); return true; }
        const asset = planRequest ? await paymentPlanAsset(url.pathname, {apiPath: planApiPath}) :
          ui ? await receivablesAsset(url.pathname, {apiPath, uiPath}) : customer ? await customerStatementAsset(url.pathname) : null;
        if (asset) {
          response.writeHead(200, {'Content-Type': asset.type, 'Content-Length': asset.bytes.length});
          response.end(request.method === 'HEAD' ? undefined : asset.bytes); return true;
        }
      }
      if (request.method !== 'GET' && request.method !== 'POST') throw problem('METHOD_NOT_ALLOWED', 'Use a supported workspace operation.', 405);
      const value = mutation ? await body(request, planRequest ? PAYMENT_PLAN_REQUEST_BYTES : customer ? STATEMENT_REQUEST_BYTES : RECEIVABLE_REQUEST_BYTES) : undefined;
      const parameters = {method: request.method, path: url.pathname, query: Object.fromEntries(url.searchParams), value, apiPath,
        expectedWorkspaceId: request.headers['x-accounting-workspace-id'],
        expectedSourcesSha256: request.headers['x-accounting-sources-sha256']};
      const result = planRequest ? await handlePaymentPlansRequest(paymentPlans, {...parameters, apiPath: planApiPath}) :
        customer ? await handleCustomerStatementRequest(statements, parameters) : await handleReceivablesRequest(receivables, parameters);
      if (!result) throw problem('NOT_FOUND', 'This workspace route does not exist.', 404);
      if (result.file) file(response, result.file);
      else {
        const requestId = result.value?.operation?.id || value?.requestId;
        if (typeof requestId === 'string' && !/[\r\n]/.test(requestId)) response.setHeader('X-Request-Id', requestId);
        json(response, 200, result.value);
      }
    } catch (error) {
      if (response.headersSent) { response.end(); return true; }
      const responseError = publicError(error);
      if (responseError.status === 405) response.setHeader('Allow', ui || planUi ? 'GET, HEAD' : 'GET, POST');
      json(response, responseError.status, responseError.value);
    }
    return true;
  };
}
export async function createReceivablesHttpHandler(workspace, options = {}) {
  const paymentPlans = options.paymentPlans || new PaymentPlanWorkspace(workspace);
  return createReceivablesHandler(new ReceivablesWorkspace(workspace), {...options, paymentPlans});
}

/** Open one accounting workspace and retain its lease until the caller closes this service. */
export async function prepareReceivablesServer(options = {}) {
  const port = Number(options.port ?? 8448);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError('Use a valid local port.');
  const host = String(options.host || '127.0.0.1');
  if (!['127.0.0.1', 'localhost'].includes(host)) throw new TypeError('The receivables workspace binds to loopback.');
  const ownsWorkspace = !options.workspace;
  const workspace = options.workspace || await openAccountingWorkspace({
    directory: resolve(options.directory || '.'),
    ...(options.expectedWorkspaceId ? {expectedWorkspaceId: options.expectedWorkspaceId} : {}),
    ...(options.expectedSourcesSha256 ? {expectedSourcesSha256: options.expectedSourcesSha256} : {}),
    ...(options.outboxDir ? {outboxDir: resolve(options.outboxDir)} : {}),
    ...(options.proofDir ? {proofDir: resolve(options.proofDir)} : {}),
    ...(options.termsFile ? {termsFile: resolve(options.termsFile)} : {}),
    ...(options.recoveredDir ? {recoveredDir: resolve(options.recoveredDir)} : {}),
  });
  let handler;
  let receivables;
  let statements;
  let paymentPlans;
  try {
    receivables = new ReceivablesWorkspace(workspace);
    if (options.includeCustomerStatements !== false) { statements = new CustomerStatementWorkspace(workspace); await statements.init(); }
    if (options.includePaymentPlans !== false) paymentPlans = new PaymentPlanWorkspace(workspace);
    handler = await createReceivablesHandler(receivables, {...options, port: port || undefined, statements, paymentPlans});
  } catch (error) { if (ownsWorkspace) await workspace.close(); throw error; }
  const server = createServer(async (request, response) => {
    try {
      if (!(await handler(request, response))) { securityHeaders(response); json(response, 404, {error: {code: 'NOT_FOUND', message: 'Open the receivables desk at ' + (options.uiPath || '/receivables') + '/'}}); }
    } catch {
      if (!response.headersSent) json(response, 500, {error: {code: 'INTERNAL_ERROR', message: 'The workspace request could not finish.'}});
      else response.end();
    }
  });
  server.requestTimeout = 60000; server.headersTimeout = 15000;
  let closed = false;
  async function close() {
    if (closed) return; closed = true;
    if (server.listening) await new Promise((accept, reject) => server.close(error => error ? reject(error) : accept()));
    if (ownsWorkspace) await workspace.close();
  }
  return {server, workspace, receivables, statements, paymentPlans, handler, port, close,
    async listen() {
      await new Promise((accept, reject) => { server.once('error', reject); server.listen(port, host, () => {server.off('error', reject); accept();}); });
      const actual = server.address();
      return 'http://' + host + ':' + actual.port + (options.uiPath || '/receivables') + '/';
    },
  };
}
export async function createReceivablesServer(options = {}) {
  const service = await prepareReceivablesServer(options);
  try { service.url = await service.listen(); return service; } catch (error) { await service.close(); throw error; }
}
export const startReceivablesServer = createReceivablesServer;
async function main() {
  const args = process.argv.slice(2);
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!value || !['--workspace', '--port', '--outbox', '--proofs', '--terms', '--recovered'].includes(key)) throw new Error('Usage: node server.mjs --workspace DIRECTORY [--port 8448] [--outbox DIRECTORY] [--proofs DIRECTORY] [--terms FILE]');
    options[{'--workspace': 'directory', '--port': 'port', '--outbox': 'outboxDir', '--proofs': 'proofDir', '--terms': 'termsFile', '--recovered': 'recoveredDir'}[key]] = value;
  }
  if (!options.directory) throw new Error('Pass --workspace with the existing accounting workspace directory.');
  const service = await startReceivablesServer(options);
  process.stdout.write(JSON.stringify({service: 'merchant-receivables', url: service.url}) + '\n');
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; try { await service.close(); process.exitCode = 0; } catch { process.exitCode = 1; } };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { process.stderr.write(String(error?.message || error) + '\n'); process.exitCode = 1; });
}
