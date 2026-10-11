// MIT. Native merchant review composes the original Woo, SF98 and SF86 stores.
import {randomUUID} from 'node:crypto';
import {readdir} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fields, publicUrl, reference} from './buyer.mjs';
import {openOutbox, SCHEMA as OUTBOX_SCHEMA} from '../sf98-merchant-delivery/outbox.mjs';
import {createPublicHttpsFetch} from '../sf31-buyer-client/public-transport.mjs';
import {reconcileRpc, reconcileReportedReceipt} from '../sf86-rpc-transfer-reconcile/verify.mjs';
import {checkOriginalTerms, checkReportedTerms, networkProfile} from '../sf86-rpc-transfer-reconcile/terms.mjs';
import {originalRecordFromEvidence} from '../sf86-rpc-transfer-reconcile/cli.mjs';
import {createOfficialEventDecoder} from '../sf43-agent-commerce/verify.mjs';
import {absolute, need, object, digest, now, privateDirectory, readBytes, readJson,
  parseJson, writeBytes, writeJson, exists, jsonBytes, safeCode} from '../sf88-operator-buyer-cli/node/store.mjs';

export const CONFIG_SCHEMA = 'stellar-forge.sf104.merchant-operator.v1';
export const ORDER_SCHEMA = 'stellar-forge.sf104.merchant-order.v1';
export const REFUND_ORDER_SCHEMA = 'stellar-forge.sf104.merchant-refunds.v1';
export const INPUT_SCHEMA = 'stellar-forge.sf104.merchant-review-input.v1';
export const REVIEW_SCHEMA = 'stellar-forge.sf104.merchant-review.v1';
export const RELEASE_SCHEMA = 'stellar-forge.sf104.merchant-release.v1';
const HASH = /^[0-9a-f]{64}$/;
const REVIEW_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const MAX_RESPONSE = 1024 * 1024;
const MAX_RECORD = 4 * 1024 * 1024;

export function compileOperator(raw) {
  fields(raw, ['schema', 'siteUrl', 'usernameEnv', 'applicationPasswordEnv', 'outbox', 'workspace',
    'timeoutMs', 'allowLocal'], 'WOO_OPERATOR_FIELDS_INVALID');
  need(raw.schema === CONFIG_SCHEMA, 'WOO_OPERATOR_SCHEMA_INVALID');
  need(raw.allowLocal === undefined || typeof raw.allowLocal === 'boolean', 'WOO_OPERATOR_LOCAL_OPTION_INVALID');
  let url;
  try { url = new URL(raw.siteUrl); } catch { need(false, 'WOO_OPERATOR_SITE_INVALID'); }
  const local = raw.allowLocal === true && url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
    !!url.port && Number(url.port) >= 1 && Number(url.port) <= 65535;
  if (!local) url = publicUrl(raw.siteUrl, 'WOO_OPERATOR_SITE_INVALID');
  need(!url.search && !url.hash && !url.username && !url.password && !/%2f|%5c|\.\./i.test(url.pathname),
    'WOO_OPERATOR_SITE_INVALID');
  for (const name of ['usernameEnv', 'applicationPasswordEnv']) {
    need(typeof raw[name] === 'string' && /^[A-Z][A-Z0-9_]{1,80}$/.test(raw[name]), 'WOO_OPERATOR_AUTH_ENV_REQUIRED');
  }
  const timeoutMs = raw.timeoutMs ?? 15000;
  need(Number.isSafeInteger(timeoutMs) && timeoutMs >= 100 && timeoutMs <= 60000, 'WOO_OPERATOR_TIMEOUT_INVALID');
  const siteUrl = url.href.replace(/\/$/, '');
  return Object.freeze({schema:CONFIG_SCHEMA, siteUrl, usernameEnv:raw.usernameEnv,
    applicationPasswordEnv:raw.applicationPasswordEnv, outbox:absolute(raw.outbox),
    workspace:absolute(raw.workspace), timeoutMs, allowLocal:local,
    restUrl:siteUrl + '/wp-json/stellar-forge/v1/merchant/orders/'});
}

export async function loadOperator(path) { return compileOperator(await readJson(resolve(path), 65536)); }

async function responseJson(response) {
  need(response instanceof Response && response.body && !response.redirected, 'WOO_OPERATOR_RESPONSE_INVALID');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) {
      const {value, done} = await reader.read(); if (done) break;
      size += value.byteLength; need(size <= MAX_RESPONSE, 'WOO_OPERATOR_RESPONSE_TOO_LARGE'); chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  return parseJson(Buffer.concat(chunks));
}

/** Credentials are resolved only when a live WordPress read/write is selected. */
export function createMerchantClient(config, {env = process.env, fetchImpl} = {}) {
  const username = env[config.usernameEnv], password = env[config.applicationPasswordEnv];
  need(typeof username === 'string' && username.length >= 1 && username.length <= 250 &&
    !/[:\x00-\x1f\x7f]/.test(username) && typeof password === 'string' && password.length >= 1 &&
    password.length <= 1024 && !/[\x00-\x1f\x7f]/.test(password), 'WOO_OPERATOR_AUTH_REQUIRED');
  need(fetchImpl === undefined || typeof fetchImpl === 'function', 'WOO_OPERATOR_FETCH_INVALID');
  const transport = fetchImpl ?? (config.allowLocal ? fetch : createPublicHttpsFetch({timeoutMs:config.timeoutMs}));
  const authorization = 'Basic ' + Buffer.from(username + ':' + password).toString('base64');
  const request = async (order, body, suffix = body ? '/release' : '', validate = validateOrder) => {
    need(reference(order), 'WOO_OPERATOR_ORDER_REQUIRED');
    const response = await transport(config.restUrl + order + suffix, {
      method:body ? 'POST' : 'GET', redirect:'manual', signal:AbortSignal.timeout(config.timeoutMs),
      headers:{authorization, accept:'application/json', ...(body ? {'content-type':'application/json'} : {})},
      ...(body ? {body:JSON.stringify(body)} : {}),
    });
    need(response.status < 300 || response.status >= 400, 'WOO_OPERATOR_REDIRECT_REFUSED');
    const value = await responseJson(response);
    if (response.status === 401 || response.status === 403) need(false, 'WOO_OPERATOR_AUTH_REFUSED');
    if (body) return {httpStatus:response.status, response:value};
    need(response.status === 200, safeCode(value.status, 'WOO_OPERATOR_ORDER_READ_FAILED'));
    return validate(value, config, order);
  };
  return Object.freeze({
    inspect:order => request(order), release:(order, body) => request(order, body),
    inspectRefunds:order => request(order, undefined, '/refunds', validateRefundOrder),
    prepareRefund:(order, body) => request(order, body, '/refunds/prepare'),
    applyRefund:(order, body) => request(order, body, '/refunds/apply'),
  });
}

export function validateOrder(snapshot, config, order) {
  need(object(snapshot) && snapshot.schema === ORDER_SCHEMA && snapshot.siteUrl === config.siteUrl &&
    snapshot.orderReference === order && HASH.test(snapshot.revision) && HASH.test(snapshot.identitySha256) &&
    object(snapshot.content) && object(snapshot.content.identity) && object(snapshot.content.order), 'WOO_OPERATOR_ORDER_INVALID');
  need(snapshot.content.identity.orderReference === order, 'WOO_OPERATOR_ORDER_IDENTITY_MISMATCH');
  return snapshot;
}

/** Same authenticated transport as payment review; native bindings are checked
 * by refund-operator before a refund is prepared or applied. */
export function validateRefundOrder(snapshot, config, order) {
  need(object(snapshot) && snapshot.schema === REFUND_ORDER_SCHEMA && snapshot.siteUrl === config.siteUrl &&
    snapshot.orderReference === order && HASH.test(snapshot.revision) && HASH.test(snapshot.identitySha256) &&
    typeof snapshot.observedAt === 'string' && object(snapshot.originalPayment) && object(snapshot.order) &&
    Array.isArray(snapshot.refunds) && Array.isArray(snapshot.adjustments), 'WOO_REFUND_ORDER_INVALID');
  const money = snapshot.order;
  need(typeof money.currency === 'string' && /^[A-Z0-9]{3,12}$/.test(money.currency) &&
    Number.isSafeInteger(money.priceDecimals) && money.priceDecimals >= 0 && money.priceDecimals <= 6 &&
    ['total', 'refundedTotal', 'remainingTotal'].every(key => typeof money[key] === 'string') &&
    typeof money.status === 'string', 'WOO_REFUND_ORDER_MONEY_INVALID');
  return snapshot;
}

function recordFromOriginal(value) {
  const record = value?.schema === 'scf82.checkout-evidence.v1' ? originalRecordFromEvidence(value) : value;
  need(object(record) && object(record.requirement) && object(record.receipt), 'WOO_ORIGINAL_NATIVE_RECORD_REQUIRED');
  return record;
}

/** Both the original authenticated store notice and local native outbox must
 * identify the exact transaction, route, recipient, amount and Woo order. */
export function bindNativeSources(snapshot, nativeRow, record, payer) {
  const q = record.requirement, r = record.receipt;
  if (record.operatorReservation) checkOriginalTerms(record, payer); else checkReportedTerms(record, payer);
  need(r.success === true, 'WOO_SUCCESSFUL_NATIVE_RECEIPT_REQUIRED');
  const binding = snapshot.content.identity.binding, event = snapshot.content.event, original = nativeRow?.event;
  need(object(binding) && binding.approved === 'YES' && object(event) && HASH.test(event.id), 'WOO_ACCEPTED_BOUND_NOTICE_REQUIRED');
  need(snapshot.content.checkout?.valid !== false, 'WOO_CHECKOUT_SOURCE_CHANGED');
  need(object(original) && original.schema === OUTBOX_SCHEMA && original.id === event.id &&
    original.authority === 'ORIGINAL_NATIVE_PROCESS_SETTLEMENT_SUCCESS' &&
    original.orderReference === snapshot.orderReference && original.at === event.occurredAt,
    'WOO_NATIVE_NOTICE_SOURCE_MISMATCH');
  need(original.transactionFingerprint === digest(r.transaction), 'WOO_NATIVE_TRANSACTION_MISMATCH');
  for (const name of ['routeId', 'method', 'network', 'amountAtomic', 'assetDigest', 'recipientDigest']) {
    need(typeof binding[name] === 'string' && binding[name] === original[name], 'WOO_NATIVE_BINDING_MISMATCH');
  }
  need(binding.network === q.network && binding.amountAtomic === q.amount && binding.assetDigest === digest(q.asset) &&
    binding.recipientDigest === digest(q.payTo), 'WOO_SELECTED_NATIVE_TERMS_MISMATCH');
  need(event.id === digest(['sf98.v1', binding.routeId, binding.method, q.network, digest(r.transaction)].join('\n')),
    'WOO_TRANSACTION_EVENT_ID_MISMATCH');
  need(['RECEIVED', 'REVIEWING', 'RELEASED'].includes(event.state), 'WOO_EVENT_STATE_INVALID');
  if (event.transactionHash !== null) need(event.transactionHash === r.transaction, 'WOO_ORDER_TRANSACTION_CONFLICT');
  if (snapshot.content.order.paid) need(snapshot.content.order.transactionHash === r.transaction,
    'WOO_PAID_ORDER_TRANSACTION_CONFLICT');
  return {eventId:event.id, orderReference:snapshot.orderReference, transaction:r.transaction,
    routeId:binding.routeId, method:binding.method, network:q.network, payer, asset:q.asset,
    recipient:q.payTo, atomicAmount:q.amount, identitySha256:snapshot.identitySha256};
}

async function workspace(config, create = true) {
  const root = await privateDirectory(config.workspace, {create});
  if (create) await privateDirectory(join(root, 'reviews'));
  return root;
}
function reviewPath(config, id) {
  need(typeof id === 'string' && REVIEW_ID.test(id), 'WOO_STABLE_REVIEW_ID_REQUIRED');
  return join(config.workspace, 'reviews', id);
}
async function saveOnce(path, value) {
  try { await writeJson(path, value, {exclusive:true}); return value; }
  catch (error) { if (error.code !== 'EEXIST') throw error; return readJson(path, MAX_RECORD * 2); }
}
async function loadInput(config, id) {
  await workspace(config, false);
  const directory = await privateDirectory(reviewPath(config, id), {create:false});
  const input = await readJson(join(directory, 'input.json'), MAX_RECORD * 2);
  need(input.schema === INPUT_SCHEMA && input.reviewId === id && input.siteUrl === config.siteUrl &&
    reference(input.orderReference) && object(input.source), 'WOO_RETAINED_REVIEW_INPUT_INVALID');
  const {sha256, ...source} = input.source;
  need(HASH.test(sha256) && digest(jsonBytes(source)) === sha256, 'WOO_RETAINED_REVIEW_SOURCE_CHANGED');
  const originalBytes = await readBytes(join(directory, 'native-record.json'), MAX_RECORD);
  need(digest(originalBytes) === input.source.nativeRecordSha256, 'WOO_RETAINED_NATIVE_RECORD_CHANGED');
  const record = recordFromOriginal(parseJson(originalBytes));
  bindNativeSources(input.source.order, input.source.nativeRow, record, input.payer);
  return {directory, input, record};
}
function reviewDigest(review) {
  const {sha256, ...value} = review;
  return digest(jsonBytes(value));
}
async function loadReview(config, id) {
  const loaded = await loadInput(config, id);
  const review = await readJson(join(loaded.directory, 'review.json'), MAX_RESPONSE);
  need(review.schema === REVIEW_SCHEMA && review.reviewId === id && review.siteUrl === config.siteUrl &&
    review.sourceSha256 === loaded.input.source.sha256 && review.sha256 === reviewDigest(review),
    'WOO_RETAINED_REVIEW_CHANGED');
  return {...loaded, review};
}

export async function reviewOrder(config, {id, order, recordPath, payer, rpcEndpoint, maxEventPages = 24,
  signal, client, decodeContractEvent, fetchRpc, expectedRecordSha256} = {}) {
  need(reference(order) && typeof payer === 'string', 'WOO_ORDER_AND_TRUSTED_PAYER_REQUIRED');
  need(expectedRecordSha256 === undefined || HASH.test(expectedRecordSha256), 'WOO_REVIEW_SOURCE_HASH_REQUIRED');
  need(Number.isSafeInteger(maxEventPages) && maxEventPages >= 1 && maxEventPages <= 100, 'WOO_EVENT_PAGE_LIMIT_INVALID');
  await workspace(config);
  const directory = await privateDirectory(reviewPath(config, id));
  const inputPath = join(directory, 'input.json');
  if (!await exists(inputPath)) {
    need(typeof recordPath === 'string', 'WOO_ORIGINAL_NATIVE_RECORD_REQUIRED');
    const raw = await readBytes(absolute(recordPath), MAX_RECORD), record = recordFromOriginal(parseJson(raw));
    need(expectedRecordSha256 === undefined || digest(raw) === expectedRecordSha256, 'WOO_REVIEW_SOURCE_CHANGED');
    const observed = await (client ?? createMerchantClient(config)).inspect(order);
    await privateDirectory(config.outbox, {create:false});
    const outbox = await openOutbox(config.outbox);
    const rows = await outbox.rows();
    const nativeRow = rows.find(row => row.event.id === observed.content.event?.id);
    const binding = bindNativeSources(observed, nativeRow, record, payer);
    const source = {order:observed, nativeRow, nativeRecordSha256:digest(raw)};
    // The retained original record is written before the operation input; a
    // competing author can reuse these bytes only when the exact hash agrees.
    const nativePath = join(directory, 'native-record.json');
    try { await writeBytes(nativePath, raw, {exclusive:true}); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    need(digest(await readBytes(nativePath, MAX_RECORD)) === source.nativeRecordSha256, 'WOO_REVIEW_ID_CONFLICT');
    await saveOnce(inputPath, {schema:INPUT_SCHEMA, reviewId:id, siteUrl:config.siteUrl,
      orderReference:order, payer, createdAt:now(), binding,
      rpcEndpoint:rpcEndpoint ?? null, maxEventPages,
      source:{...source, sha256:digest(jsonBytes(source))}});
  }
  const loaded = await loadInput(config, id), input = loaded.input;
  need(expectedRecordSha256 === undefined || input.source.nativeRecordSha256 === expectedRecordSha256,
    'WOO_REVIEW_SOURCE_CHANGED');
  need(input.orderReference === order && input.payer === payer && input.rpcEndpoint === (rpcEndpoint ?? null) &&
    input.maxEventPages === maxEventPages, 'WOO_REVIEW_ID_CONFLICT');
  if (await exists(join(directory, 'review.json'))) return (await loadReview(config, id)).review;
  const decoder = decodeContractEvent ?? await createOfficialEventDecoder();
  const options = {payer:input.payer, rpcEndpoint:input.rpcEndpoint ?? undefined,
    maxEventPages:input.maxEventPages, decodeContractEvent:decoder, signal,
    ...(fetchRpc ? {fetchImpl:fetchRpc} : {})};
  const chain = loaded.record.operatorReservation ? await reconcileRpc({...options, record:loaded.record}) :
    await reconcileReportedReceipt({...options, ...loaded.record});
  const review = {schema:REVIEW_SCHEMA, reviewId:id, siteUrl:config.siteUrl, orderReference:order,
    sourceSha256:input.source.sha256, createdAt:now(), binding:input.binding, chain,
    releasable:chain.verdict === networkProfile(chain.network).transferVerdict};
  review.sha256 = reviewDigest(review);
  await saveOnce(join(directory, 'review.json'), review);
  return (await loadReview(config, id)).review;
}

export async function resumeReview(config, id, options = {}) {
  const {input} = await loadInput(config, id);
  return reviewOrder(config, {id, order:input.orderReference, payer:input.payer,
    rpcEndpoint:input.rpcEndpoint ?? undefined, maxEventPages:input.maxEventPages, ...options});
}

const TRANSFER_FIELDS = ['schema', 'verdict', 'network', 'transaction', 'asset', 'recipient', 'payer',
  'atomicAmount', 'ledger', 'matchingTransfers', 'matchingEventId', 'rpcEndpoint'];
function releasePayload(input, review) {
  need(review.releasable === true && review.chain.verdict === networkProfile(review.binding.network).transferVerdict,
    'WOO_LIVE_NATIVE_RECONCILIATION_REQUIRED');
  need(review.chain.network === review.binding.network && review.chain.transaction === review.binding.transaction &&
    review.chain.asset === review.binding.asset && review.chain.recipient === review.binding.recipient &&
    review.chain.atomicAmount === review.binding.atomicAmount && review.chain.payer === review.binding.payer &&
    review.chain.matchingTransfers === 1, 'WOO_NATIVE_REVIEW_BINDING_MISMATCH');
  return {schema:RELEASE_SCHEMA, eventId:review.binding.eventId, transactionHash:review.binding.transaction,
    expectedRevision:input.source.order.revision, expectedIdentitySha256:input.source.order.identitySha256,
    reviewSha256:review.sha256, reviewedTransfer:Object.fromEntries(TRANSFER_FIELDS.map(key => [key, review.chain[key]])),
    confirm:'RELEASE_THIS_ORDER'};
}

function completion(snapshot, payload) {
  const event = snapshot.content.event, order = snapshot.content.order, native = snapshot.nativeReview;
  return event?.id === payload.eventId && event.state === 'RELEASED' && event.transactionHash === payload.transactionHash &&
    order.paid === true && order.transactionHash === payload.transactionHash &&
    native?.reviewSha256 === payload.reviewSha256 && native?.eventId === payload.eventId &&
    native?.transactionHash === payload.transactionHash;
}

export async function releaseOrder(config, id, {confirmOrder, client, expectedReviewSha256} = {}) {
  const {directory, input, review} = await loadReview(config, id);
  need(confirmOrder === review.orderReference, 'WOO_EXPLICIT_ORDER_CONFIRMATION_REQUIRED');
  need(expectedReviewSha256 === undefined || HASH.test(expectedReviewSha256) && review.sha256 === expectedReviewSha256,
    'WOO_RETAINED_REVIEW_CHANGED');
  const payload = releasePayload(input, review), api = client ?? createMerchantClient(config);
  const before = await api.inspect(review.orderReference);
  if (completion(before, payload)) return {schema:RELEASE_SCHEMA, status:'RELEASE_CONFIRMED',
    reviewId:id, reviewSha256:review.sha256, orderReference:review.orderReference, order:before};
  need(before.identitySha256 === payload.expectedIdentitySha256, 'WOO_REVIEW_SOURCE_CHANGED');
  const recovery = ['REVIEWING', 'RELEASED'].includes(before.content.event?.state) &&
    before.content.event.transactionHash === payload.transactionHash;
  need(recovery || before.revision === payload.expectedRevision, 'WOO_REVIEW_SOURCE_CHANGED');
  const attemptId = randomUUID(), attemptFile = join(directory, 'release-' + attemptId + '.json');
  let attempt = {schema:RELEASE_SCHEMA, attemptId, reviewId:id, reviewSha256:review.sha256,
    orderReference:review.orderReference, startedAt:now(), status:'DISPATCH_RECORDED', payload};
  await writeJson(attemptFile, attempt, {exclusive:true});
  let response;
  try { response = await api.release(review.orderReference, payload); }
  catch (error) { attempt.error = safeCode(error.code, 'WOO_RELEASE_RESPONSE_UNAVAILABLE'); }
  let observed;
  try { observed = await api.inspect(review.orderReference); }
  catch (error) { attempt.readbackError = safeCode(error.code, 'WOO_RELEASE_READBACK_UNAVAILABLE'); }
  attempt = {...attempt, completedAt:now(), response:response ?? null, order:observed ?? null,
    status:observed && completion(observed, payload) ? 'RELEASE_CONFIRMED' :
      response ? safeCode(response.response?.status, 'RELEASE_REOPEN_REQUIRED') : 'RELEASE_OUTCOME_UNKNOWN'};
  await writeJson(attemptFile, attempt);
  return attempt;
}

export async function inspectReview(config, id, {live = false, client} = {}) {
  const {directory, input} = await loadInput(config, id);
  const review = await exists(join(directory, 'review.json')) ? (await loadReview(config, id)).review : null;
  const names = (await readdir(directory)).filter(name => /^release-[0-9a-f-]{36}\.json$/.test(name));
  const attempts = await Promise.all(names.map(name => readJson(join(directory, name), MAX_RESPONSE * 2)));
  attempts.sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.attemptId.localeCompare(b.attemptId));
  const observed = live ? await (client ?? createMerchantClient(config)).inspect(input.orderReference) : null;
  return {schema:'stellar-forge.sf104.merchant-review-status.v1', reviewId:id,
    siteUrl:config.siteUrl, orderReference:input.orderReference,
    status:review ? 'REVIEW_COMPLETE' : 'REVIEW_PREPARED', input, review, attempts,
    ...(observed ? {order:observed} : {})};
}

export async function listReviews(config) {
  await workspace(config, false);
  const names = (await readdir(join(config.workspace, 'reviews'), {withFileTypes:true}))
    .filter(entry => entry.isDirectory() && REVIEW_ID.test(entry.name)).map(entry => entry.name).sort();
  return Promise.all(names.map(async id => {
    try {
      const value = await inspectReview(config, id);
      return {reviewId:id, orderReference:value.orderReference, status:value.status,
        verdict:value.review?.chain.verdict ?? null, transaction:value.review?.binding.transaction ?? null,
        lastRelease:value.attempts.at(-1)?.status ?? null};
    } catch (error) { return {reviewId:id, status:'REVIEW_UNAVAILABLE', error:safeCode(error.code, 'WOO_REVIEW_READ_FAILED')}; }
  }));
}

export async function exportReview(config, id, destination) {
  const {directory} = await loadInput(config, id);
  const status = await inspectReview(config, id);
  const target = await privateDirectory(absolute(destination));
  need(target !== directory && !target.startsWith(directory + '/'), 'WOO_EXPORT_OUTSIDE_REVIEW_REQUIRED');
  const names = ['input.json', 'native-record.json', ...(status.review ? ['review.json'] : []),
    ...status.attempts.map(attempt => 'release-' + attempt.attemptId + '.json')];
  const files = [];
  for (const name of names) {
    const bytes = await readBytes(join(directory, name), MAX_RECORD * 2);
    try { await writeBytes(join(target, name), bytes, {exclusive:true}); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    need(digest(await readBytes(join(target, name), MAX_RECORD * 2)) === digest(bytes), 'WOO_EXPORT_FILE_CONFLICT');
    files.push({name, bytes:bytes.length, sha256:digest(bytes)});
  }
  const manifest = {schema:'stellar-forge.sf104.merchant-review-export.v1', reviewId:id,
    siteUrl:config.siteUrl, orderReference:status.orderReference, files};
  const saved = await saveOnce(join(target, 'manifest.json'), manifest);
  need(JSON.stringify(saved) === JSON.stringify(manifest), 'WOO_EXPORT_MANIFEST_CONFLICT');
  return {...manifest, directory:target};
}
