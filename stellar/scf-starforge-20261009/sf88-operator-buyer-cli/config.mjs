// MIT — SF88 trusted local operator input, consumed only by original SF31/SF81/SF82.
import { stat, readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { normalizeBuyerTransport } from '../sf31-buyer-client/public-transport.mjs';
import { operationTicketReference } from './operation-ticket.mjs';

export class InputError extends Error {
  constructor(code) { super(code); this.code = code; this.name = 'InputError'; }
}
export function need(ok, code) { if (!ok) throw new InputError(code); }
const obj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
function shape(x, names, code) {
  need(obj(x) && Object.keys(x).every(k => names.includes(k)), code);
  return x;
}
export function abs(value, code) {
  need(typeof value === 'string' && isAbsolute(value) && !value.includes('\0'), code);
  return value;
}
export async function bytes(path, max, code) {
  abs(path, code);
  const info = await stat(path);
  need(info.isFile() && info.size <= max, code);
  const data = await readFile(path);
  need(data.byteLength <= max, code);
  return data;
}
export async function config(path) {
  const raw = await bytes(path, 65536, 'INVALID_CONFIG_FILE');
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(raw)); }
  catch { throw new InputError('CONFIG_JSON_INVALID'); }
  shape(value, ['catalog','operation','operator','signerModule','evidenceDir',
    'trustedPayer','captureBody','bodyCaptureTimeoutMs','responseFile','preparedFrom',
    'buyerTransport'], 'INVALID_CONFIG_FIELDS');
  if (value.preparedFrom !== undefined) preparedFrom(value.preparedFrom);
  buyerTransport(value);
  return value;
}
export function buyerTransport(c) {
  if (c.buyerTransport === undefined) return null;
  const profile = normalizeBuyerTransport(c.buyerTransport);
  let origin;
  try { origin = new URL(c.operation?.url).origin; }
  catch { throw new InputError('BUYER_TRANSPORT_OPERATION_REQUIRED'); }
  need(profile.origin === origin, 'BUYER_TRANSPORT_ORIGIN_MISMATCH');
  return profile;
}
// Saved source data is review context only; it grants no payment authority.
export function preparedFrom(x) {
  shape(x, ['schema','discoveryFileSha256','source','sourceEnvelope','rowIndex',
    'acceptIndex','originalListing'], 'INVALID_PREPARED_SOURCE');
  need(x.schema === 'stellar-forge.sf88.saved-discovery.v1' &&
    typeof x.discoveryFileSha256 === 'string' && /^[a-f0-9]{64}$/.test(x.discoveryFileSha256) &&
    (x.source === null || typeof x.source === 'string' && x.source.length <= 8192) &&
    ['resources','items'].includes(x.sourceEnvelope) &&
    Number.isSafeInteger(x.rowIndex) && x.rowIndex >= 0 &&
    Number.isSafeInteger(x.acceptIndex) && x.acceptIndex >= 0 &&
    obj(x.originalListing) && Array.isArray(x.originalListing.accepts) &&
    obj(x.originalListing.accepts[x.acceptIndex]), 'INVALID_PREPARED_SOURCE');
  return x;
}
export function responseFile(c) {
  if (c.responseFile === undefined) return null;
  const x = shape(c.responseFile, ['destination','maxBytes','timeoutMs'], 'INVALID_RESPONSE_FILE');
  abs(x.destination, 'RESPONSE_FILE_PATH_NOT_ABSOLUTE');
  need(c.captureBody === undefined || c.captureBody === false,
    'RESPONSE_FILE_REQUIRES_CAPTURE_BODY_FALSE');
  const maxBytes = x.maxBytes === undefined ? 64 * 1024 * 1024 : x.maxBytes;
  const timeoutMs = x.timeoutMs === undefined ? 30000 : x.timeoutMs;
  need(Number.isSafeInteger(maxBytes) && maxBytes >= 1, 'RESPONSE_FILE_LIMIT_INVALID');
  need(Number.isInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 2147483647,
    'RESPONSE_FILE_TIMEOUT_INVALID');
  return { destination:x.destination, maxBytes, timeoutMs };
}
export function catalog(x) {
  shape(x, ['origin','query','filters','limit','offset','sandboxGatewayIPv4'], 'INVALID_CATALOG');
  need(typeof x.origin === 'string' && x.origin.startsWith('https://'), 'CATALOG_HTTPS_REQUIRED');
  if (x.query !== undefined) need(typeof x.query === 'string' && x.query.length < 257, 'INVALID_QUERY');
  if (x.limit !== undefined) need(Number.isInteger(x.limit) && x.limit >= 1 && x.limit <= 100, 'INVALID_LIMIT');
  if (x.offset !== undefined) need(Number.isSafeInteger(x.offset) && x.offset >= 0, 'INVALID_OFFSET');
  if (x.sandboxGatewayIPv4 !== undefined)
    need(typeof x.sandboxGatewayIPv4 === 'string' &&
      x.sandboxGatewayIPv4.length >= 7 && x.sandboxGatewayIPv4.length <= 15,
      'CATALOG_SANDBOX_GATEWAY_INVALID');
  if (x.filters !== undefined) {
    shape(x.filters, ['network','scheme','payTo','type','extensions'], 'INVALID_FILTERS');
    need(Object.values(x.filters).every(v => typeof v === 'string'), 'INVALID_FILTERS');
  }
  return x;
}
export function operation(x) {
  shape(x, ['intentId','url','method','expect','bodyFile','headers','orderReference','ticketFile','ticketHeader'], 'INVALID_OPERATION');
  need(typeof x.intentId === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(x.intentId),
    'STABLE_INTENT_ID_REQUIRED');
  let u;
  try { u = new URL(x.url); } catch { throw new InputError('SELLER_URL_INVALID'); }
  need(u.protocol === 'https:' && !u.username && !u.password && !u.hash, 'SELLER_HTTPS_REQUIRED');
  const method = x.method ?? 'GET';
  need(['GET','HEAD','POST','PUT','PATCH','DELETE'].includes(method), 'INVALID_METHOD');
  const e = shape(x.expect, ['scheme','network','asset','payTo','maxAtomic',
    'maxTimeoutSeconds','paymentFlow'], 'INVALID_ACCEPTED_TERMS');
  need(e.scheme === 'exact' && ['stellar:testnet','stellar:pubnet'].includes(e.network),
    'ORIGINAL_EXACT_STELLAR_ONLY');
  need(typeof e.asset === 'string' && e.asset.length > 0 && e.asset.length <= 256 &&
    typeof e.payTo === 'string' && e.payTo.length > 0 && e.payTo.length <= 256,
    'EXPLICIT_ASSET_AND_RECIPIENT_REQUIRED');
  need(typeof e.maxAtomic === 'string' && /^(0|[1-9][0-9]*)$/.test(e.maxAtomic) &&
    BigInt(e.maxAtomic) <= 170141183460469231731687303715884105727n,
    'MAX_SPEND_I128_INVALID');
  if (e.maxTimeoutSeconds !== undefined)
    need(Number.isInteger(e.maxTimeoutSeconds) && e.maxTimeoutSeconds >= 1 &&
      e.maxTimeoutSeconds <= 86400, 'MAX_TIMEOUT_INVALID');
  if (e.paymentFlow !== undefined) need(e.paymentFlow === 'authorization', 'PAYMENT_FLOW_UNSUPPORTED');
  if (x.bodyFile !== undefined) {
    abs(x.bodyFile, 'BODY_PATH_MUST_BE_ABSOLUTE');
    need(!['GET','HEAD'].includes(method), 'BODY_DISALLOWED_FOR_METHOD');
  }
  const headers = {...(x.headers ?? {})};
  shape(x.headers ?? {}, ['Content-Type','Accept','X-SF98-Order-ID'], 'INVALID_HEADERS');
  need(Object.values(headers).every(v => typeof v === 'string' && v.length <= 256 &&
    !/[\r\n]/.test(v)), 'INVALID_HEADERS');
  if (x.orderReference !== undefined) {
    need(typeof x.orderReference === 'string' && /^[A-Za-z0-9._:-]{1,80}$/.test(x.orderReference),
      'INVALID_ORDER_REFERENCE');
    // The native SF31/SF54/SF36 approval already binds the complete resource URL.
    // Derive this one fulfillment header from the SAME visible, approved value.
    const references = u.searchParams.getAll('sf98_order');
    need(references.length === 1 && references[0] === x.orderReference,
      'ORDER_REFERENCE_MUST_MATCH_APPROVED_RESOURCE');
    need(headers['X-SF98-Order-ID'] === undefined || headers['X-SF98-Order-ID'] === x.orderReference,
      'ORDER_HEADER_MISMATCH');
    headers['X-SF98-Order-ID'] = x.orderReference;
  } else need(headers['X-SF98-Order-ID'] === undefined, 'ORDER_REFERENCE_REQUIRED');
  const ticket = operationTicketReference({...x, method, headers});
  return { ...x, method, headers, ...(ticket ? {ticketHeader:ticket.requestHeader} : {}) };
}
export function operator(x) {
  shape(x, ['python','actor','service','policy','ledger'], 'INVALID_OPERATOR');
  for (const field of ['python','policy','ledger']) abs(x[field], 'OPERATOR_PATH_NOT_ABSOLUTE');
  for (const field of ['actor','service'])
    need(typeof x[field] === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(x[field]),
      'VERIFIED_OPERATOR_ID_REQUIRED');
  return x;
}
export function execution(x) {
  const op = operation(x.operation);
  const owner = operator(x.operator);
  abs(x.signerModule, 'SIGNER_PATH_NOT_ABSOLUTE');
  abs(x.evidenceDir, 'EVIDENCE_PATH_NOT_ABSOLUTE');
  if (x.trustedPayer !== undefined)
    need(typeof x.trustedPayer === 'string' && /^[GC][A-Z2-7]{55}$/.test(x.trustedPayer),
      'TRUSTED_PAYER_INVALID');
  if (x.captureBody !== undefined) need(typeof x.captureBody === 'boolean', 'CAPTURE_BODY_INVALID');
  if (x.bodyCaptureTimeoutMs !== undefined)
    need(Number.isInteger(x.bodyCaptureTimeoutMs) && x.bodyCaptureTimeoutMs >= 1 &&
      x.bodyCaptureTimeoutMs <= 60000, 'BODY_TIMEOUT_INVALID');
  return { op, owner, download:responseFile(x), transport:buyerTransport(x) };
}
