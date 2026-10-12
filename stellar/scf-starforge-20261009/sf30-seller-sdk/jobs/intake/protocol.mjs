// MIT. Public input preparation contract; original SF30 remains the purchase authority.
import { createHash } from 'node:crypto';

export const CATALOG_SCHEMA = 'stellar-forge.job-intake-catalog.v1';
export const REQUEST_SCHEMA = 'stellar-forge.job-intake-request.v1';
export const RESPONSE_SCHEMA = 'stellar-forge.job-intake-response.v1';
export const WITHDRAW_SCHEMA = 'stellar-forge.job-intake-withdraw.v1';
export const CATALOG_PATH = '/jobs/intake/v1/functions';
export const REQUEST_PATH = '/jobs/intake/v1/requests';
export const WITHDRAW_PATH = '/jobs/intake/v1/withdrawals';
export const HASH = /^[a-f0-9]{64}$/;
export const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
export const FUNCTION_ID = /^[A-Za-z][A-Za-z0-9_]{0,55}$/;
export const CLAIM = /^[A-Za-z0-9_-]{43,128}$/;
export const MAX_CATALOG_BYTES = 2097152;
export const MAX_REQUEST_BYTES = 1052672;
export const MAX_RESPONSE_BYTES = 131072;
export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
export const problem = (code, status = 400) => Object.assign(new Error(code), { code, status });
export const need = (condition, code, status = 400) => { if (!condition) throw problem(code, status); };
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const text = (value, max) => typeof value === 'string' && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
export function canonical(value) {
  let count = 0;
  const visit = (item, depth) => {
    need(++count <= 100000 && depth <= 48, 'JOB_INTAKE_JSON_TOO_COMPLEX');
    if (item === null || ['string', 'boolean'].includes(typeof item)) return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (Array.isArray(item)) {
      need(Object.keys(item).length === item.length &&
        Object.keys(item).every((key, index) => key === String(index)), 'JOB_INTAKE_JSON_REQUIRED');
      return item.map(child => visit(child, depth + 1));
    }
    need(object(item), 'JOB_INTAKE_JSON_REQUIRED');
    return Object.fromEntries(Object.keys(item).sort().map(key => [key, visit(item[key], depth + 1)]));
  };
  return JSON.stringify(visit(value, 0));
}
export function originOf(value) {
  let url;
  try { url = new URL(value); } catch { throw problem('JOB_INTAKE_ORIGIN_INVALID'); }
  need(url.protocol === 'https:' && value === url.origin && !url.username && !url.password,
    'JOB_INTAKE_ORIGIN_INVALID');
  return url.origin;
}
const keys = (value, allowed, code) => need(object(value) && Object.keys(value).every(key => allowed.includes(key)), code);
const integer = (value, low, high) => Number.isSafeInteger(value) && value >= low && value <= high;
export function functionDigest(value) {
  const copy = { ...value }; delete copy.functionSha256;
  return sha256(canonical(copy));
}
export function catalogDigest(value) {
  const copy = { ...value }; delete copy.catalogSha256;
  return sha256(canonical(copy));
}
export function validateFunction(value, origin) {
  keys(value, ['id', 'description', 'inputSchema', 'example', 'maxInputBytes', 'maxOutputBytes',
    'timeoutMs', 'output', 'payment', 'purchaseUrl', 'functionSha256'], 'JOB_INTAKE_FUNCTION_INVALID');
  need(FUNCTION_ID.test(value.id ?? '') && !['__proto__', 'constructor', 'prototype'].includes(value.id) &&
    text(value.description, 4096) && object(value.inputSchema) && value.inputSchema.type === 'object' &&
    object(value.inputSchema.properties) && Object.keys(value.inputSchema.properties).length <= 64 &&
    value.inputSchema.additionalProperties === false && object(value.example) &&
    Buffer.byteLength(canonical(value.inputSchema)) <= 24000 &&
    integer(value.maxInputBytes, 1, 1048576) && integer(value.maxOutputBytes, 1, 67108864) &&
    integer(value.timeoutMs, 100, 3600000), 'JOB_INTAKE_FUNCTION_INVALID');
  need(object(value.output) && ['json', 'bytes'].includes(value.output.format) &&
    text(value.output.contentType, 160) && text(value.output.filename, 100), 'JOB_INTAKE_OUTPUT_INVALID');
  const payment = value.payment;
  need(object(payment) && text(payment.scheme, 128) && text(payment.network, 256) &&
    text(payment.asset, 4096) && text(payment.payTo, 4096) &&
    typeof payment.amount === 'string' && /^[0-9]{1,80}$/.test(payment.amount), 'JOB_INTAKE_PAYMENT_INVALID');
  let url;
  try { url = new URL(value.purchaseUrl); } catch { throw problem('JOB_INTAKE_PURCHASE_URL_INVALID'); }
  need(url.origin === origin && url.protocol === 'https:' && !url.username && !url.password &&
    !url.search && !url.hash && url.href === value.purchaseUrl && url.pathname !== '/jobs' &&
    !url.pathname.startsWith('/jobs/'), 'JOB_INTAKE_PURCHASE_URL_INVALID');
  need(HASH.test(value.functionSha256 ?? '') && value.functionSha256 === functionDigest(value),
    'JOB_INTAKE_FUNCTION_CHANGED', 409);
  return structuredClone(value);
}
export function validateCatalog(value, expectedOrigin) {
  keys(value, ['schema', 'publicOrigin', 'serviceName', 'catalogSha256', 'authentication',
    'requestUrl', 'withdrawalUrl', 'functions'], 'JOB_INTAKE_CATALOG_INVALID');
  const origin = originOf(value.publicOrigin);
  need(value.schema === CATALOG_SCHEMA && (!expectedOrigin || origin === expectedOrigin) &&
    text(value.serviceName, 512) && ['none', 'access-token'].includes(value.authentication) &&
    value.requestUrl === origin + REQUEST_PATH && value.withdrawalUrl === origin + WITHDRAW_PATH &&
    Array.isArray(value.functions) && value.functions.length > 0 && value.functions.length <= 64,
    'JOB_INTAKE_CATALOG_INVALID');
  const ids = new Set();
  for (const definition of value.functions) {
    validateFunction(definition, origin);
    need(!ids.has(definition.id), 'JOB_INTAKE_FUNCTION_DUPLICATE'); ids.add(definition.id);
  }
  need(HASH.test(value.catalogSha256 ?? '') && value.catalogSha256 === catalogDigest(value),
    'JOB_INTAKE_CATALOG_CHANGED', 409);
  return structuredClone(value);
}
export function validateRequest(value) {
  keys(value, ['schema', 'catalogSha256', 'functionSha256', 'functionId', 'reference',
    'claimToken', 'label', 'input'], 'JOB_INTAKE_REQUEST_INVALID');
  need(value.schema === REQUEST_SCHEMA && HASH.test(value.catalogSha256 ?? '') &&
    HASH.test(value.functionSha256 ?? '') && FUNCTION_ID.test(value.functionId ?? '') &&
    JOB_ID.test(value.reference ?? '') && CLAIM.test(value.claimToken ?? '') &&
    text(value.label, 300) && object(value.input) &&
    Buffer.byteLength(canonical(value)) <= MAX_REQUEST_BYTES, 'JOB_INTAKE_REQUEST_INVALID');
  return structuredClone(value);
}
export function validateWithdrawal(value) {
  keys(value, ['schema', 'reference', 'claimToken', 'expectedRevision', 'reason'], 'JOB_INTAKE_WITHDRAWAL_INVALID');
  need(value.schema === WITHDRAW_SCHEMA && JOB_ID.test(value.reference ?? '') &&
    CLAIM.test(value.claimToken ?? '') && integer(value.expectedRevision, 1, Number.MAX_SAFE_INTEGER) &&
    text(value.reason, 500) && value.reason.trim(), 'JOB_INTAKE_WITHDRAWAL_INVALID');
  return structuredClone(value);
}
/** A returned ticket must retain the exact original prepared input and offer. */
export function validateResponse(value, request, definition, origin) {
  need(object(value) && value.schema === RESPONSE_SCHEMA && value.reference === request.reference &&
    value.catalogSha256 === request.catalogSha256 && value.functionSha256 === request.functionSha256 &&
    object(value.handoff), 'JOB_INTAKE_RESPONSE_INVALID');
  const handoff = value.handoff, job = handoff.job, acceptance = handoff.acceptance, purchase = handoff.purchase;
  const inputSha256 = sha256(canonical(request.input)), statusUrl = origin + '/jobs/' + encodeURIComponent(request.reference);
  need(handoff.schema === 'stellar-forge.job-handoff.v1' && handoff.claimToken === request.claimToken &&
    object(job) && job.id === request.reference && job.jobId === request.reference &&
    job.functionId === request.functionId && job.inputSha256 === inputSha256 && job.label === request.label &&
    integer(job.revision, 1, Number.MAX_SAFE_INTEGER) &&
    ['PREPARED', 'AWAITING_SETTLEMENT', 'QUEUED', 'RUNNING', 'CANCELLING', 'COMPLETED',
      'FAILED', 'INTERRUPTED', 'CANCELLED'].includes(job.state) &&
    canonical(job.payment) === canonical(definition.payment), 'JOB_INTAKE_JOB_BINDING_CHANGED', 409);
  const purchaseUrl = new URL(definition.purchaseUrl); purchaseUrl.searchParams.set('sf98_order', request.reference);
  need(object(purchase) && purchase.url === purchaseUrl.href && purchase.method === 'POST' &&
    purchase.orderReference === request.reference && object(purchase.headers) &&
    Object.keys(purchase.headers).length === 2 && purchase.headers['x-sf98-order-id'] === request.reference &&
    purchase.headers['x-sfjobs-token'] === request.claimToken &&
    canonical(purchase.body) === canonical({ jobId: request.reference }) &&
    canonical(purchase.payment) === canonical(definition.payment), 'JOB_INTAKE_PURCHASE_CHANGED', 409);
  need(object(acceptance) && acceptance.schema === 'stellar-forge.job-accepted.v1' &&
    acceptance.jobId === request.reference && acceptance.functionId === request.functionId &&
    acceptance.inputSha256 === inputSha256 && acceptance.state === 'AWAITING_SETTLEMENT' &&
    acceptance.statusUrl === statusUrl && acceptance.resultUrl === statusUrl + '/result' &&
    handoff.statusUrl === statusUrl && handoff.resultUrl === statusUrl + '/result',
    'JOB_INTAKE_ACCEPTANCE_CHANGED', 409);
  return structuredClone(value);
}
