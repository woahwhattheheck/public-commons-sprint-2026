// MIT. Record verified merchant refunds in the original WooCommerce order.
import {randomUUID} from 'node:crypto';
import {readdir} from 'node:fs/promises';
import {join, sep} from 'node:path';
import {reference} from './buyer.mjs';
import {createMerchantClient, validateRefundOrder} from './merchant-operator.mjs';
import {networkProfile, checkMerchantRefundTerms} from '../sf86-rpc-transfer-reconcile/terms.mjs';
import {ADJUSTMENT_EXPORT_SCHEMA, adjustmentId, adjustmentAmount, adjustmentInstant,
  adjustmentEventIdentity, adjustmentRequest, adjustmentJson, validateAdjustment,
  validateRefundProof} from '../merchant-settlement-accounting/adjustments.mjs';
import {absolute, need, object, digest, now, privateDirectory, readBytes, readJson,
  parseJson, writeBytes, writeJson, exists, jsonBytes, safeCode} from '../sf88-operator-buyer-cli/node/store.mjs';

export const REFUND_SCHEMA = 'stellar-forge.sf104.merchant-refund.v1';
export const REFUND_INPUT_SCHEMA = 'stellar-forge.sf104.merchant-refund-input.v1';
export const REFUND_REVIEW_SCHEMA = 'stellar-forge.sf104.merchant-refund-review.v1';
export const REFUND_STATUS_SCHEMA = 'stellar-forge.sf104.merchant-refund-status.v1';
const HASH = /^[0-9a-f]{64}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const MAX_EXPORT = 32 * 1024 * 1024;
const MAX_STATE = 4 * 1024 * 1024;
const ATTEMPT = /^(prepare|apply|recover)-[a-f0-9-]{36}\.json$/;
const REVIEW = /^review-[a-f0-9]{64}\.json$/;
const nativeId = value => typeof value === 'string' ? /^[1-9][0-9]{0,17}$/.test(value) :
  Number.isSafeInteger(value) && value > 0;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (object(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
const same = (left, right) => JSON.stringify(stable(left)) === JSON.stringify(stable(right));
function sealed(value) { return {...value, sha256:digest(jsonBytes(value))}; }
function validSeal(value, code) {
  const {sha256, ...body} = value;
  need(HASH.test(sha256) && digest(jsonBytes(body)) === sha256, code);
  return value;
}

/** Parse store currency without binary floating point or an implied FX rate. */
export function wooMoney(value, decimals, {positive = false} = {}) {
  need(Number.isSafeInteger(decimals) && decimals >= 0 && decimals <= 6 &&
    typeof value === 'string' && /^(0|[1-9][0-9]{0,11})(?:\.[0-9]+)?$/.test(value),
    'WOO_REFUND_AMOUNT_INVALID');
  const [whole, fraction = ''] = value.split('.');
  need(fraction.length <= decimals, 'WOO_REFUND_AMOUNT_PRECISION');
  const units = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
  need(units <= 9007199254740991n, 'WOO_REFUND_AMOUNT_TOO_LARGE');
  need(!positive || units > 0n, 'WOO_REFUND_POSITIVE_AMOUNT_REQUIRED');
  return {units, amount:whole + (decimals ? '.' + fraction.padEnd(decimals, '0') : '')};
}

function originalIdentity(event) {
  return {...adjustmentEventIdentity(event), routeId:event.routeId ?? null, method:event.method ?? null,
    orderReferenceDigest:event.orderReferenceDigest ?? null};
}

/** Select exactly one verified adjustment from the unmodified accounting export. */
export function selectRefundAdjustment(value, id) {
  adjustmentId(id);
  need(object(value) && value.schema === ADJUSTMENT_EXPORT_SCHEMA && object(value.source) &&
    Array.isArray(value.events) && value.events.length <= 5000 &&
    object(value.originalReport) && Array.isArray(value.originalReport.ledger),
    'WOO_ORIGINAL_ADJUSTMENT_EXPORT_REQUIRED');
  adjustmentInstant(value.exportedAt, 'export date');
  const found = [], seen = new Set(); let count = 0;
  for (const event of value.events) {
    need(object(event) && object(event.original) && Array.isArray(event.adjustments), 'WOO_ADJUSTMENT_EXPORT_INVALID');
    for (const record of event.adjustments) {
      need(object(record) && ++count <= 5000 && !seen.has(record.id), 'WOO_DUPLICATE_ADJUSTMENT');
      seen.add(record.id);
      if (record.id === id) found.push({event, record});
    }
  }
  need(found.length === 1, 'WOO_REFUND_ADJUSTMENT_NOT_FOUND');
  const {event, record} = found[0];
  validateAdjustment(record);
  need(record.kind === 'REFUND' && record.status === 'VERIFIED', 'WOO_VERIFIED_REFUND_REQUIRED');
  validateRefundProof(record.verification.proof, record);
  for (const key of ['runId', 'reportSha256', 'inputManifestSha256']) {
    need(value.source[key] === record.source[key], 'WOO_REFUND_EXPORT_SOURCE_MISMATCH');
  }
  need(same(originalIdentity(event.original), originalIdentity(record.original)), 'WOO_REFUND_ORIGINAL_EVENT_CHANGED');
  const originals = value.originalReport.ledger.filter(row =>
    row.eventId === record.eventId && row.network === record.original.network);
  need(originals.length === 1 && same(originalIdentity(originals[0]), originalIdentity(record.original)),
    'WOO_REFUND_ORIGINAL_REPORT_CHANGED');
  return {record, event:event.original};
}

/** Bind the selected accounting row to the exact released Woo payment and its
 * original native payer, then require the canonical reverse-transfer proof. */
export function bindRefundAdjustment(value, id, snapshot, config, order) {
  validateRefundOrder(snapshot, config, order);
  const selected = selectRefundAdjustment(value, id), record = selected.record;
  const original = record.original, payment = snapshot.originalPayment;
  const binding = payment.binding, transfer = payment.reviewedTransfer, proof = record.verification.proof;
  need(payment.state === 'RELEASED' && HASH.test(payment.eventId) && HASH.test(payment.transactionHash) &&
    object(binding) && binding.approved === 'YES' && object(transfer), 'WOO_RELEASED_NATIVE_PAYMENT_REQUIRED');
  need(original.eventId === payment.eventId && record.eventId === payment.eventId &&
    original.routeId === binding.routeId && original.method === binding.method &&
    snapshot.order.transactionHash === payment.transactionHash && original.orderReferenceDigest === digest(order) &&
    original.transactionFingerprint === digest(payment.transactionHash),
    'WOO_REFUND_ORIGINAL_PAYMENT_MISMATCH');
  const identity = originalIdentity(original), profile = networkProfile(binding.network);
  need(identity.network === binding.network && identity.amountAtomic === binding.amountAtomic &&
    identity.assetDigest === binding.assetDigest && identity.recipientDigest === binding.recipientDigest,
    'WOO_REFUND_ORIGINAL_TERMS_MISMATCH');
  need(typeof binding.routeId === 'string' && typeof binding.method === 'string' &&
    payment.eventId === digest(['sf98.v1', binding.routeId, binding.method, binding.network,
      digest(payment.transactionHash)].join('\n')), 'WOO_REFUND_EVENT_ID_MISMATCH');
  need(transfer.verdict === profile.transferVerdict && transfer.matchingTransfers === 1 &&
    transfer.network === binding.network && transfer.transaction === payment.transactionHash &&
    transfer.atomicAmount === binding.amountAtomic && typeof transfer.asset === 'string' &&
    typeof transfer.recipient === 'string' && typeof transfer.payer === 'string' &&
    digest(transfer.asset) === binding.assetDigest && digest(transfer.recipient) === binding.recipientDigest,
    'WOO_REFUND_ORIGINAL_REVIEW_MISMATCH');
  need(record.refundTerms.network === transfer.network && record.refundTerms.asset === transfer.asset &&
    record.refundTerms.from === transfer.recipient && record.refundTerms.to === transfer.payer &&
    proof.transaction !== payment.transactionHash, 'WOO_REFUND_REVERSE_IDENTITY_MISMATCH');
  checkMerchantRefundTerms({refundId:id, network:proof.network, asset:proof.asset, payer:proof.payer,
    recipient:proof.recipient, atomicAmount:proof.atomicAmount, transaction:proof.transaction});
  need(BigInt(adjustmentAmount(record.amountAtomic)) <= BigInt(adjustmentAmount(binding.amountAtomic)),
    'WOO_REFUND_EXCEEDS_ORIGINAL_PAYMENT');
  return selected;
}

async function workspace(config, create = true) {
  const root = await privateDirectory(config.workspace, {create});
  return privateDirectory(join(root, 'refunds'), {create});
}
function refundPath(config, id) { return join(config.workspace, 'refunds', adjustmentId(id)); }
async function retainBytes(path, bytes, limit = MAX_STATE) {
  try { await writeBytes(path, bytes, {exclusive:true}); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  need(digest(await readBytes(path, limit)) === digest(bytes), 'WOO_REFUND_RETAINED_FILE_CONFLICT');
}
async function saveFirst(path, value) {
  try { await writeJson(path, value, {exclusive:true}); return value; }
  catch (error) { if (error.code !== 'EEXIST') throw error; return readJson(path, MAX_STATE); }
}

async function loadInput(config, id) {
  await workspace(config, false);
  const directory = await privateDirectory(refundPath(config, id), {create:false});
  const input = validSeal(await readJson(join(directory, 'input.json'), MAX_STATE), 'WOO_REFUND_INPUT_CHANGED');
  need(input.schema === REFUND_INPUT_SCHEMA && input.adjustmentId === id && input.siteUrl === config.siteUrl &&
    reference(input.orderReference), 'WOO_REFUND_INPUT_INVALID');
  const raw = await readBytes(join(directory, 'adjustments.json'), MAX_EXPORT);
  const beforeRaw = await readBytes(join(directory, 'order-before.json'), MAX_STATE);
  const request = await readBytes(join(directory, 'adjustment-request.json'), MAX_STATE);
  need(digest(raw) === input.sourceSha256 && digest(beforeRaw) === input.originalSnapshotSha256 &&
    digest(request) === input.requestSha256, 'WOO_REFUND_SOURCE_CHANGED');
  const exported = parseJson(raw), before = parseJson(beforeRaw);
  const {record} = bindRefundAdjustment(exported, id, before, config, input.orderReference);
  need(digest(adjustmentJson(adjustmentRequest(record))) === input.requestSha256 &&
    before.identitySha256 === input.identitySha256 && before.originalPayment.eventId === input.eventId &&
    before.originalPayment.transactionHash === input.originalTransactionHash &&
    input.amountAtomic === record.amountAtomic && input.reason === record.reason &&
    same(input.reviewedRefund, record.verification.proof) &&
    input.currency === before.order.currency && input.priceDecimals === before.order.priceDecimals,
    'WOO_REFUND_INPUT_BINDING_CHANGED');
  need(wooMoney(input.wooAmount, input.priceDecimals, {positive:true}).amount === input.wooAmount,
    'WOO_REFUND_INPUT_AMOUNT_CHANGED');
  return {directory, input, exported, record};
}

function payload(input, revision) {
  return {schema:REFUND_SCHEMA, adjustmentId:input.adjustmentId, eventId:input.eventId,
    originalTransactionHash:input.originalTransactionHash, expectedIdentitySha256:input.identitySha256,
    expectedRevision:revision, sourceSha256:input.sourceSha256, requestSha256:input.requestSha256,
    amountAtomic:input.amountAtomic, wooAmount:input.wooAmount, currency:input.currency,
    reason:input.reason, reviewedRefund:input.reviewedRefund, confirm:'PREPARE_THIS_REFUND'};
}

function inspectMapping(config, loaded, snapshot) {
  const {input, exported} = loaded;
  bindRefundAdjustment(exported, input.adjustmentId, snapshot, config, input.orderReference);
  need(snapshot.identitySha256 === input.identitySha256 && snapshot.order.currency === input.currency &&
    snapshot.order.priceDecimals === input.priceDecimals, 'WOO_REFUND_ORDER_CHANGED');
  const rows = snapshot.adjustments.filter(row => row?.adjustmentId === input.adjustmentId);
  need(rows.length <= 1, 'WOO_REFUND_DUPLICATE_MAPPING');
  if (!rows.length) return {status:'NOT_PREPARED', adjustment:null, refund:null};
  const row = rows[0];
  for (const key of ['adjustmentId', 'eventId', 'originalTransactionHash', 'sourceSha256', 'requestSha256',
    'amountAtomic', 'currency', 'reason']) {
    need(row[key] === input[key], 'WOO_REFUND_MAPPING_CHANGED');
  }
  need(HASH.test(row.reviewSha256) && row.orderReference === input.orderReference &&
    row.transactionHash === input.reviewedRefund.transaction && row.network === input.reviewedRefund.network &&
    wooMoney(row.wooAmount, input.priceDecimals, {positive:true}).amount === input.wooAmount &&
    same(row.reviewedRefund, input.reviewedRefund), 'WOO_REFUND_MAPPING_CHANGED');
  const children = snapshot.refunds.filter(refund => refund?.adjustmentId === input.adjustmentId);
  const child = children.length === 1 ? children[0] : null;
  const exact = child && nativeId(child.id) &&
    child.reviewSha256 === row.reviewSha256 && child.transactionHash === row.transactionHash &&
    child.currency === input.currency &&
    wooMoney(child.amount, input.priceDecimals, {positive:true}).amount === input.wooAmount;
  if (children.length > 1 || (children.length && !exact)) {
    return {status:'REFUND_RECONCILIATION_REQUIRED', adjustment:row, refund:child};
  }
  if (row.status === 'APPLIED') return {
    status:exact && nativeId(row.refundId) && String(row.refundId) === String(child.id) ?
      'APPLIED' : 'REFUND_RECONCILIATION_REQUIRED',
    adjustment:row, refund:child};
  if (exact) return {status:'REFUND_SAVED_JOURNAL_PENDING', adjustment:row, refund:child};
  return {status:['PREPARED', 'APPLYING'].includes(row.status) ? row.status : 'REFUND_RECONCILIATION_REQUIRED',
    adjustment:row, refund:null};
}

async function retainReview(loaded, observed) {
  if (!observed.adjustment) return;
  const row = observed.adjustment, input = loaded.input;
  const value = sealed({schema:REFUND_REVIEW_SCHEMA, adjustmentId:input.adjustmentId,
    inputSha256:input.sha256, reviewSha256:row.reviewSha256, observedAt:now(), adjustment:row});
  const saved = await saveFirst(join(loaded.directory, 'review-' + row.reviewSha256 + '.json'), value);
  validSeal(saved, 'WOO_REFUND_REVIEW_CHANGED');
  need(saved.inputSha256 === input.sha256 && saved.reviewSha256 === row.reviewSha256,
    'WOO_REFUND_REVIEW_CHANGED');
}

async function attemptsAt(directory) {
  const names = (await readdir(directory)).filter(name => ATTEMPT.test(name));
  const attempts = await Promise.all(names.map(async name =>
    validSeal(await readJson(join(directory, name), MAX_STATE), 'WOO_REFUND_OUTCOME_CHANGED')));
  return attempts.sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.attemptId.localeCompare(b.attemptId));
}

async function observe(config, loaded, api, phase = 'recover') {
  const attemptId = randomUUID(), startedAt = now();
  let order = null, observed = null, error = null;
  try {
    order = await api.inspectRefunds(loaded.input.orderReference);
    observed = inspectMapping(config, loaded, order);
    await retainReview(loaded, observed);
  } catch (failure) { error = safeCode(failure.code, 'WOO_REFUND_READBACK_UNAVAILABLE'); }
  const result = sealed({schema:REFUND_STATUS_SCHEMA, adjustmentId:loaded.input.adjustmentId,
    orderReference:loaded.input.orderReference, inputSha256:loaded.input.sha256, phase, attemptId,
    startedAt, completedAt:now(), status:observed?.status ?? 'REFUND_READBACK_UNAVAILABLE',
    adjustment:observed?.adjustment ?? null, refund:observed?.refund ?? null, order, error});
  await writeJson(join(loaded.directory, 'recover-' + attemptId + '.json'), result, {exclusive:true});
  return result;
}

async function dispatch(config, loaded, api, phase, body) {
  const attemptId = randomUUID(), file = join(loaded.directory, phase + '-' + attemptId + '.json');
  const start = {schema:REFUND_STATUS_SCHEMA, adjustmentId:loaded.input.adjustmentId,
    orderReference:loaded.input.orderReference, inputSha256:loaded.input.sha256, phase, attemptId,
    startedAt:now(), status:'DISPATCH_RECORDED', payload:body};
  await writeJson(file, sealed(start), {exclusive:true});
  let response = null, error = null, order = null, observed = null, readbackError = null;
  try {
    response = await (phase === 'prepare' ? api.prepareRefund(loaded.input.orderReference, body) :
      api.applyRefund(loaded.input.orderReference, body));
  } catch (failure) { error = safeCode(failure.code, 'WOO_REFUND_RESPONSE_UNAVAILABLE'); }
  try {
    order = await api.inspectRefunds(loaded.input.orderReference);
    observed = inspectMapping(config, loaded, order);
    await retainReview(loaded, observed);
  } catch (failure) { readbackError = safeCode(failure.code, 'WOO_REFUND_READBACK_UNAVAILABLE'); }
  const confirmed = observed && observed.status !== 'NOT_PREPARED';
  const rejected = response && Number.isInteger(response.httpStatus) &&
    response.httpStatus >= 400 && response.httpStatus < 500;
  const status = confirmed ? observed.status : rejected ?
    safeCode(response.response?.status, 'WOO_REFUND_REQUEST_REJECTED') :
    phase === 'prepare' ? 'PREPARE_OUTCOME_UNKNOWN' : 'APPLY_OUTCOME_UNKNOWN';
  const result = sealed({...start, completedAt:now(), status, response, error, readbackError,
    adjustment:observed?.adjustment ?? null, refund:observed?.refund ?? null, order});
  await writeJson(file, result);
  return result;
}

async function recordRead(loaded, order, observed, phase) {
  await retainReview(loaded, observed);
  const attemptId = randomUUID(), result = sealed({schema:REFUND_STATUS_SCHEMA,
    adjustmentId:loaded.input.adjustmentId, orderReference:loaded.input.orderReference,
    inputSha256:loaded.input.sha256, phase, attemptId, startedAt:now(), completedAt:now(),
    status:observed.status, adjustment:observed.adjustment, refund:observed.refund, order, error:null});
  await writeJson(join(loaded.directory, 'recover-' + attemptId + '.json'), result, {exclusive:true});
  return result;
}

export async function inspectRefunds(config, order, {client} = {}) {
  need(reference(order), 'WOO_REFUND_ORDER_REQUIRED');
  return validateRefundOrder(await (client ?? createMerchantClient(config)).inspectRefunds(order), config, order);
}

/** Each explicit prepare reads the original order first. At most one POST is
 * sent; its response is followed by a fresh GET, including after interruption. */
export async function prepareRefund(config, {adjustmentId:id, order, adjustmentsPath, wooAmount, client,
  expectedSourceSha256, expectedCurrency} = {}) {
  adjustmentId(id);
  need(reference(order), 'WOO_REFUND_ORDER_REQUIRED');
  const raw = await readBytes(absolute(adjustmentsPath), MAX_EXPORT), exported = parseJson(raw);
  need(expectedSourceSha256 === undefined || HASH.test(expectedSourceSha256) && digest(raw) === expectedSourceSha256,
    'WOO_REFUND_SOURCE_CHANGED');
  const {record} = selectRefundAdjustment(exported, id);
  const api = client ?? createMerchantClient(config);
  const before = await api.inspectRefunds(order);
  bindRefundAdjustment(exported, id, before, config, order);
  need(expectedCurrency === undefined || typeof expectedCurrency === 'string' && before.order.currency === expectedCurrency,
    'WOO_REFUND_CURRENCY_CHANGED');
  const money = wooMoney(wooAmount, before.order.priceDecimals, {positive:true});
  await workspace(config);
  const directory = await privateDirectory(refundPath(config, id));
  if (!await exists(join(directory, 'input.json'))) {
    await retainBytes(join(directory, 'adjustments.json'), raw, MAX_EXPORT);
    await retainBytes(join(directory, 'adjustment-request.json'), adjustmentJson(adjustmentRequest(record)));
    // Concurrent reopeners keep the first original order snapshot. The current
    // authenticated order is independently checked again below before dispatch.
    const original = await saveFirst(join(directory, 'order-before.json'), before);
    bindRefundAdjustment(exported, id, original, config, order);
    await saveFirst(join(directory, 'input.json'), sealed({schema:REFUND_INPUT_SCHEMA,
      adjustmentId:id, siteUrl:config.siteUrl, orderReference:order, createdAt:now(),
      sourceSha256:digest(raw), requestSha256:record.requestSha256,
      originalSnapshotSha256:digest(await readBytes(join(directory, 'order-before.json'), MAX_STATE)),
      identitySha256:original.identitySha256, eventId:record.eventId,
      originalTransactionHash:original.originalPayment.transactionHash, amountAtomic:record.amountAtomic,
      wooAmount:money.amount, wooAmountEntered:wooAmount, currency:original.order.currency,
      priceDecimals:original.order.priceDecimals, reason:record.reason, reviewedRefund:record.verification.proof}));
  }
  const loaded = await loadInput(config, id), input = loaded.input;
  need(input.orderReference === order && input.sourceSha256 === digest(raw) &&
    input.requestSha256 === record.requestSha256 && input.wooAmount === money.amount,
    'WOO_REFUND_ID_CONFLICT');
  const observed = inspectMapping(config, loaded, before);
  if (observed.status !== 'NOT_PREPARED') return recordRead(loaded, before, observed, 'prepare');
  const total = wooMoney(before.order.total, input.priceDecimals).units;
  const refunded = wooMoney(before.order.refundedTotal, input.priceDecimals).units;
  const remaining = wooMoney(before.order.remainingTotal, input.priceDecimals).units;
  need(total >= refunded && remaining === total - refunded && money.units <= remaining,
    'WOO_REFUND_EXCEEDS_REMAINING_ORDER_AMOUNT');
  return dispatch(config, loaded, api, 'prepare', payload(input, before.revision));
}

/** Explicitly record/recover the same verified credit. The server's stable
 * adjustment metadata identifies a refund child saved before journal recovery. */
export async function applyRefund(config, id, {confirmOrder, client, expectedReviewSha256} = {}) {
  const loaded = await loadInput(config, id), input = loaded.input;
  need(confirmOrder === input.orderReference, 'WOO_REFUND_ORDER_CONFIRMATION_REQUIRED');
  const api = client ?? createMerchantClient(config);
  const before = await api.inspectRefunds(input.orderReference);
  const observed = inspectMapping(config, loaded, before);
  need(expectedReviewSha256 === undefined || HASH.test(expectedReviewSha256) && observed.adjustment?.reviewSha256 === expectedReviewSha256,
    'WOO_REFUND_REVIEW_CHANGED');
  if (['APPLIED', 'REFUND_RECONCILIATION_REQUIRED'].includes(observed.status)) {
    return recordRead(loaded, before, observed, 'apply');
  }
  need(['PREPARED', 'APPLYING', 'REFUND_SAVED_JOURNAL_PENDING'].includes(observed.status),
    'WOO_REFUND_PREPARE_REQUIRED');
  await retainReview(loaded, observed);
  return dispatch(config, loaded, api, 'apply', {schema:REFUND_SCHEMA, adjustmentId:id,
    reviewSha256:observed.adjustment.reviewSha256, expectedRevision:before.revision, confirm:'RECORD_THIS_REFUND'});
}

/** A recovery read has no POST side effects. A saved child with an APPLYING
 * journal is reported as REFUND_SAVED_JOURNAL_PENDING for explicit same-ID apply. */
export async function recoverRefund(config, id, {client} = {}) {
  const loaded = await loadInput(config, id);
  return observe(config, loaded, client ?? createMerchantClient(config));
}

export async function inspectRefund(config, id, {live = false, client} = {}) {
  const loaded = await loadInput(config, id);
  if (live) await observe(config, loaded, client ?? createMerchantClient(config));
  const attempts = await attemptsAt(loaded.directory);
  for (const attempt of attempts) {
    need(attempt.adjustmentId === id && attempt.inputSha256 === loaded.input.sha256 &&
      attempt.orderReference === loaded.input.orderReference, 'WOO_REFUND_OUTCOME_BINDING_CHANGED');
  }
  const names = (await readdir(loaded.directory)).filter(name => REVIEW.test(name)).sort();
  const reviews = await Promise.all(names.map(async name => {
    const review = validSeal(await readJson(join(loaded.directory, name), MAX_STATE), 'WOO_REFUND_REVIEW_CHANGED');
    need(review.schema === REFUND_REVIEW_SCHEMA && review.adjustmentId === id &&
      review.inputSha256 === loaded.input.sha256 && name === 'review-' + review.reviewSha256 + '.json',
      'WOO_REFUND_REVIEW_BINDING_CHANGED');
    return review;
  }));
  return {schema:REFUND_STATUS_SCHEMA, adjustmentId:id, siteUrl:config.siteUrl,
    orderReference:loaded.input.orderReference, status:attempts.at(-1)?.status ?? 'INPUT_RETAINED',
    input:loaded.input, reviews, attempts, ...(live ? {order:attempts.at(-1)?.order ?? null} : {})};
}

export async function listRefunds(config) {
  if (!await exists(join(config.workspace, 'refunds'))) return [];
  const root = await workspace(config, false);
  const ids = (await readdir(root, {withFileTypes:true}))
    .filter(entry => entry.isDirectory() && UUID.test(entry.name)).map(entry => entry.name).sort();
  return Promise.all(ids.map(async id => {
    try {
      const value = await inspectRefund(config, id);
      return {adjustmentId:id, orderReference:value.orderReference, status:value.status,
        amountAtomic:value.input.amountAtomic, wooAmount:value.input.wooAmount, currency:value.input.currency,
        transactionHash:value.input.reviewedRefund.transaction, latest:value.attempts.at(-1)?.completedAt ?? null};
    } catch (error) {
      return {adjustmentId:id, status:'REFUND_UNAVAILABLE', error:safeCode(error.code, 'WOO_REFUND_READ_FAILED')};
    }
  }));
}

export async function exportRefund(config, id, destination) {
  const loaded = await loadInput(config, id), status = await inspectRefund(config, id);
  const target = await privateDirectory(absolute(destination));
  need(target !== loaded.directory && !target.startsWith(loaded.directory + sep) &&
    !loaded.directory.startsWith(target + sep), 'WOO_REFUND_EXPORT_OUTSIDE_OPERATION_REQUIRED');
  const names = ['adjustments.json', 'adjustment-request.json', 'order-before.json', 'input.json',
    ...(await readdir(loaded.directory)).filter(name => ATTEMPT.test(name) || REVIEW.test(name)).sort()];
  const files = [];
  for (const name of names) {
    const bytes = await readBytes(join(loaded.directory, name), name === 'adjustments.json' ? MAX_EXPORT : MAX_STATE);
    await retainBytes(join(target, name), bytes, name === 'adjustments.json' ? MAX_EXPORT : MAX_STATE);
    files.push({name, bytes:bytes.length, sha256:digest(bytes)});
  }
  const manifest = {schema:'stellar-forge.sf104.merchant-refund-export.v1', adjustmentId:id,
    siteUrl:config.siteUrl, orderReference:status.orderReference, inputSha256:loaded.input.sha256, files};
  const saved = await saveFirst(join(target, 'manifest.json'), manifest);
  need(same(saved, manifest), 'WOO_REFUND_EXPORT_MANIFEST_CONFLICT');
  return {...manifest, directory:target};
}
