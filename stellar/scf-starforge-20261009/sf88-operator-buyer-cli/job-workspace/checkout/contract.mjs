// MIT. A merchant job ticket becomes one ordinary original SF88 request.
import { operation as nativeOperation } from '../../config.mjs';
import { digest, jsonBytes, parseJson, object } from '../../node/store.mjs';
import { HASH, requireValue } from '../state.mjs';

export const SCHEMA = 'stellar-forge.sf88.job-checkout.v1';
export const PHASES = ['IMPORTED', 'REVIEWED', 'RECOVERABLE', 'ACCEPTED', 'FINISHED'];
export const MAX_TICKET_BYTES = 65536;
const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const PROFILE_FIELDS = ['operator', 'signerModule', 'trustedPayer',
  'bodyCaptureTimeoutMs', 'buyerTransport', 'requestTimeoutMs'];
const text = (value, limit) => typeof value === 'string' && value.length <= limit &&
  !/[\x00-\x1f\x7f]/.test(value);
const eq = (left, right) => JSON.stringify(Object.entries(left).sort(([a], [b]) => a.localeCompare(b))) ===
  JSON.stringify(Object.entries(right).sort(([a], [b]) => a.localeCompare(b)));
export const safe = value => typeof value === 'string' && /^[A-Z0-9_]{1,120}$/.test(value) ? value : null;

function accepted(value) {
  requireValue(object(value) && value.schema === 'stellar-forge.job-accepted.v1' &&
    JOB_ID.test(value.jobId ?? '') && /^[A-Za-z][A-Za-z0-9_]{0,55}$/.test(value.functionId ?? '') &&
    HASH.test(value.inputSha256 ?? '') && value.state === 'AWAITING_SETTLEMENT',
    'JOB_CHECKOUT_ACCEPTANCE_INVALID');
  let url;
  try { url = new URL(value.statusUrl); } catch { requireValue(false, 'JOB_CHECKOUT_URL_INVALID'); }
  const path = '/jobs/' + encodeURIComponent(value.jobId);
  requireValue(url.protocol === 'https:' && !url.username && !url.password && !url.hash && !url.search &&
    value.statusUrl === url.origin + path && value.resultUrl === value.statusUrl + '/result',
    'JOB_CHECKOUT_URL_INVALID');
  return { schema: value.schema, jobId: value.jobId, functionId: value.functionId,
    inputSha256: value.inputSha256, state: value.state, statusUrl: value.statusUrl, resultUrl: value.resultUrl };
}

function terms(payment) {
  requireValue(object(payment), 'JOB_CHECKOUT_PAYMENT_REQUIRED');
  // The native exact Stellar validator remains the terms authority.
  const value = { scheme: payment.scheme, network: payment.network, asset: payment.asset,
    payTo: payment.payTo, maxAtomic: payment.amount };
  if (payment.maxTimeoutSeconds !== undefined) value.maxTimeoutSeconds = payment.maxTimeoutSeconds;
  const flow = payment.extra?.paymentFlow ?? payment.paymentFlow;
  if (flow !== undefined) value.paymentFlow = flow;
  return value;
}

/** Preserve exact private ticket bytes; project only the original purchase request. */
export function readJobCheckoutTicket(raw) {
  requireValue(Buffer.isBuffer(raw) && raw.length > 0 && raw.length <= MAX_TICKET_BYTES,
    'JOB_CHECKOUT_TICKET_FILE_REQUIRED');
  const handoff = parseJson(raw);
  requireValue(object(handoff) && handoff.schema === 'stellar-forge.job-handoff.v1' &&
    typeof handoff.claimToken === 'string' && /^[A-Za-z0-9_-]{43,128}$/.test(handoff.claimToken) &&
    object(handoff.job) && object(handoff.purchase), 'JOB_CHECKOUT_TICKET_INVALID');
  const acceptance = accepted(handoff.acceptance), job = handoff.job, purchase = handoff.purchase;
  requireValue(job.state === 'PREPARED' && job.submittedAt === null && job.nativeSettlement === null,
    'JOB_CHECKOUT_PREPARED_TICKET_REQUIRED');
  requireValue(job.id === acceptance.jobId && job.jobId === job.id &&
    job.functionId === acceptance.functionId && job.inputSha256 === acceptance.inputSha256 &&
    Number.isSafeInteger(job.revision) && job.revision >= 1 && text(job.label, 512) &&
    handoff.statusUrl === acceptance.statusUrl && handoff.resultUrl === acceptance.resultUrl &&
    purchase.method === 'POST' && purchase.orderReference === job.id &&
    object(purchase.body) && Object.keys(purchase.body).length === 1 && purchase.body.jobId === job.id,
    'JOB_CHECKOUT_TICKET_BINDING_INVALID');
  requireValue(object(purchase.headers), 'JOB_CHECKOUT_HEADERS_INVALID');
  const headers = {};
  for (const [key, value] of Object.entries(purchase.headers)) {
    const name = key.toLowerCase();
    requireValue(['x-sfjobs-token', 'x-sf98-order-id', 'content-type'].includes(name) &&
      !Object.hasOwn(headers, name) && typeof value === 'string', 'JOB_CHECKOUT_HEADERS_INVALID');
    headers[name] = value;
  }
  requireValue(headers['x-sfjobs-token'] === handoff.claimToken &&
    headers['x-sf98-order-id'] === job.id &&
    (headers['content-type'] === undefined || headers['content-type'].toLowerCase() === 'application/json'),
    'JOB_CHECKOUT_HEADERS_INVALID');
  headers['content-type'] = 'application/json';
  const id = digest(JSON.stringify(['paid-job-checkout', acceptance.statusUrl]));
  const intentId = 'job-checkout:' + id;
  const operation = nativeOperation({ intentId, url: purchase.url, method: 'POST',
    expect: terms(purchase.payment), headers, orderReference: job.id });
  const url = new URL(operation.url);
  requireValue(url.origin === new URL(acceptance.statusUrl).origin &&
    [...url.searchParams].length === 1 && url.searchParams.get('sf98_order') === job.id &&
    url.pathname !== '/jobs' && !url.pathname.startsWith('/jobs/'),
    'JOB_CHECKOUT_REQUEST_URL_INVALID');
  requireValue(eq(terms(job.payment), operation.expect), 'JOB_CHECKOUT_PAYMENT_BINDING_INVALID');
  const body = JSON.stringify({ jobId: job.id });
  const summary = { jobId: job.id, functionId: job.functionId, label: job.label,
    merchantRevision: job.revision, inputSha256: job.inputSha256,
    statusUrl: acceptance.statusUrl, resultUrl: acceptance.resultUrl,
    sellerUrl: operation.url, method: operation.method, orderReference: operation.orderReference,
    acceptedTerms: operation.expect, bodySha256: digest(body), bodyBytes: Buffer.byteLength(body) };
  const binding = { ...summary };
  delete binding.label; delete binding.merchantRevision;
  return { id, intentId, raw: Buffer.from(raw), handoff, operation, body, summary,
    handoffSha256: digest(raw), bindingSha256: digest(jsonBytes(binding)) };
}

export function validateProfile(raw) {
  const profile = parseJson(raw);
  requireValue(object(profile) && Object.keys(profile).every(key => PROFILE_FIELDS.includes(key)),
    'OPERATOR_PROFILE_FIELDS_INVALID');
  // The original SDK composes and validates these settings during native review.
  return profile;
}

export function reviewSummary(review) {
  const value = review?.native;
  requireValue(object(value) && value.mode === 'OFFLINE_REVIEW' &&
    typeof review.intentId === 'string' && HASH.test(review.configSha256 ?? '') &&
    HASH.test(review.bodySha256 ?? ''), 'JOB_CHECKOUT_NATIVE_REVIEW_INVALID');
  return { mode: value.mode, intentId: review.intentId, reviewedAt: review.reviewedAt,
    configSha256: review.configSha256, bodySha256: review.bodySha256,
    sellerUrl: value.sellerUrl, method: value.method, acceptedTerms: value.acceptedTerms,
    bodyBytes: value.bodyBytes, nativeWorkspace: review.nativeWorkspace ?? null,
    operatorId: text(value.operatorId, 160) ? value.operatorId : null,
    serviceId: text(value.serviceId, 160) ? value.serviceId : null,
    signerFilename: text(value.signerFilename, 4096) ? value.signerFilename : null };
}

export function resultSummary(result) {
  const value = result.native, record = result.record;
  return { status: safe(value.status), httpStatus: Number.isInteger(value.httpStatus) ? value.httpStatus : null,
    deliveryStatus: safe(result.delivery?.status), exitCode: Number.isInteger(record.exitCode) ? record.exitCode : null,
    runtimeError: safe(record.runtimeError), recovered: record.recovered === true,
    recordedAt: typeof record.recordedAt === 'string' ? record.recordedAt : null };
}

export function matchesOriginalRequest(config, ticket) {
  const op = nativeOperation(config.operation);
  requireValue(op.intentId === ticket.intentId && op.url === ticket.operation.url && op.method === 'POST' &&
    op.orderReference === ticket.summary.jobId && eq(op.expect, ticket.operation.expect) &&
    eq(op.headers, ticket.operation.headers) && op.ticketFile === undefined &&
    config.responseFile?.maxBytes === 65536 &&
    config.responseFile?.expectedContentType === 'application/json', 'JOB_CHECKOUT_NATIVE_BINDING_CHANGED', 409);
  return op;
}
