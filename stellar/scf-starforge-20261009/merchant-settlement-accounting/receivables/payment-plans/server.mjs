// MIT. Routes and browser assets composed into the original receivables process.
import {readFile} from 'node:fs/promises';
import {readBrowserAssets} from '../../../distribution/browser-assets.mjs';
import {RECEIVABLE_REQUEST_BYTES} from '../store.mjs';

const STATIC = await readBrowserAssets(new URL('./browser-assets.json', import.meta.url));
export const PAYMENT_PLAN_REQUEST_BYTES = RECEIVABLE_REQUEST_BYTES;
const SCHEDULE_FILES = new Set(['schedule.json', 'schedule.csv', 'schedule.html', 'manifest.json']);
const COLLECTION_FILES = new Set(['collections.json', 'collections.csv']);

function problem(code, message, status = 400) {
  return Object.assign(new Error(message), {code, status});
}
function basePath(value, fallback) {
  const path = String(value || fallback).replace(/\/+$/, '');
  if (!path.startsWith('/') || /[?#\\\u0000-\u0020]/.test(path) || path.includes('//') ||
      path.split('/').some(part => part === '..' || part === '.')) {
    throw new TypeError('Use a local absolute workspace route.');
  }
  return path;
}
function identifier(raw) {
  let value;
  try { value = decodeURIComponent(raw); } catch { throw problem('INVALID_IDENTIFIER', 'The record identifier is malformed.'); }
  if (!value || value.length > 240 || value === '.' || value === '..' || /[\\/\u0000-\u001f]/.test(value)) {
    throw problem('INVALID_IDENTIFIER', 'The record identifier is malformed.');
  }
  return value;
}
function filters(search) {
  return {asOf: search.get('asOf') || undefined, through: search.get('through') || undefined,
    customerId: search.get('customerId') || undefined};
}
export async function paymentPlanAsset(path, {apiPath = '/api/receivables/payment-plans', uiPath = '/payment-plans'} = {}) {
  apiPath = basePath(apiPath, '/api/receivables/payment-plans');
  uiPath = basePath(uiPath, '/payment-plans');
  if (path !== uiPath && !path.startsWith(uiPath + '/')) return null;
  const name = path === uiPath ? 'index.html' : path.slice(uiPath.length + 1) || 'index.html';
  if (name === 'config.json') {
    return {bytes: Buffer.from(JSON.stringify({apiPath, uiPath, requestBytes: PAYMENT_PLAN_REQUEST_BYTES})),
      type: 'application/json; charset=utf-8'};
  }
  const asset = STATIC.get('/payment-plans/' + name);
  return asset ? {bytes: await readFile(asset.url), type: asset.type} : null;
}

/** The caller retains the original local request, JSON-size and accounting lease boundaries. */
export async function handlePaymentPlansRequest(workspace, {method, path, query = {}, value,
  apiPath = '/api/receivables/payment-plans'}) {
  apiPath = basePath(apiPath, '/api/receivables/payment-plans');
  if (path !== apiPath && !path.startsWith(apiPath + '/')) return null;
  const parts = path.slice(apiPath.length).split('/').filter(Boolean).map(identifier);
  const route = parts.join('/');
  const search = query instanceof URLSearchParams ? query :
    new URLSearchParams(Object.entries(query).filter(([, item]) => item !== undefined && item !== null));
  let result;
  if (method === 'GET') {
    if (!route || route === 'state') result = await workspace.state(filters(search));
    else if (parts[0] === 'plans' && parts.length === 2) result = await workspace.detail(parts[1], {asOf: search.get('asOf') || undefined});
    else if (parts[0] === 'plans' && parts.length === 3 && parts[2] === 'preview') result = await workspace.previewPlan(parts[1]);
    else if (parts[0] === 'operations' && parts.length === 2) result = await workspace.getOperation(parts[1]);
    else if (parts[0] === 'plans' && parts.length === 6 && parts[2] === 'editions' && parts[4] === 'files') {
      if (!SCHEDULE_FILES.has(parts[5])) throw problem('DOCUMENT_NOT_FOUND', 'Choose a saved schedule document.', 404);
      const file = await workspace.scheduleFile(parts[1], parts[3], parts[5]);
      return {file, type: file.type};
    } else if (route === 'collections/export') {
      const output = await workspace.collectionsFiles(filters(search));
      const name = search.get('name');
      if (name) {
        if (!COLLECTION_FILES.has(name)) throw problem('DOCUMENT_NOT_FOUND', 'Choose a collections export format.', 404);
        const file = output.files.find(item => item.name === name);
        if (!file) throw problem('DOCUMENT_NOT_FOUND', 'The selected collections file is unavailable.', 404);
        return {file, type: file.type};
      }
      result = {report: output.report, revision: output.revision,
        files: output.files.map(file => ({name: file.name, type: file.type, bytes: file.bytes.length}))};
    } else throw problem('NOT_FOUND', 'This payment-plan route does not exist.', 404);
  } else if (method === 'POST') {
    if (!value || Array.isArray(value) || typeof value !== 'object') throw problem('INVALID_JSON', 'Send a JSON operator request.');
    if (route === 'generate') result = await workspace.generate(value);
    else if (route === 'plans') result = await workspace.savePlan(value);
    else if (parts[0] === 'plans' && parts.length === 3 && parts[2] === 'activate') result = await workspace.activate(parts[1], value);
    else if (parts[0] === 'plans' && parts.length === 3 && parts[2] === 'cancel') result = await workspace.cancelPlan(parts[1], value);
    else throw problem('NOT_FOUND', 'This payment-plan operation does not exist.', 404);
  } else throw problem('METHOD_NOT_ALLOWED', 'Use a supported payment-plan operation.', 405);
  return {value: result};
}

export const handlePaymentPlanRequest = handlePaymentPlansRequest;
