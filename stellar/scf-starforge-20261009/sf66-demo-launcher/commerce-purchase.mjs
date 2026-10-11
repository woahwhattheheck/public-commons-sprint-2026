// MIT. Original SF101 handoffs and files, bound to the existing commerce inbox.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { readPrivateFile, parseJson } from '../sf103-native-buyer-signer/operator.mjs';
import { validateHandoff, privatePath } from '../sf101-merchant-receiver/checkout-config.mjs';
import { retrieveFile, inspectFileTransfer, resetFileTransfer } from '../sf101-merchant-receiver/purchase.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const need = (ok, code) => { if (!ok) throw Object.assign(new Error(code), { code }); };
const code = error => /^[A-Z0-9_]{1,120}$/.test(error?.code ?? '') ? error.code : 'PAID_FILE_UNAVAILABLE';
async function optionalPrivate(path, maximum) {
  // SF103's private reader intentionally masks filesystem error codes. Check
  // only absence here, then retain its original ownership/size/symlink checks.
  try { await lstat(path); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  return readPrivateFile(path, maximum);
}
function bind(handoff, op) {
  need(op.method === 'GET' && op.url === handoff.purchaseUrl &&
    op.orderReference === handoff.orderReference && op.headers?.['X-SF98-Order-ID'] === handoff.orderReference,
  'COMMERCE_HANDOFF_OPERATION_MISMATCH');
  need(['scheme', 'network', 'asset', 'payTo'].every(key => op.expect[key] === handoff.payment[key]) &&
    BigInt(op.expect.maxAtomic) >= BigInt(handoff.payment.amount) &&
    (op.expect.paymentFlow ?? 'authorization') === (handoff.payment.extra?.paymentFlow ?? 'authorization') &&
    (op.expect.maxTimeoutSeconds === undefined || op.expect.maxTimeoutSeconds >= handoff.payment.maxTimeoutSeconds),
  'COMMERCE_HANDOFF_TERMS_MISMATCH');
}

/** Called during the original session's create-only initialization, before enqueue. */
export async function readPurchaseInput(value, op, responseDestination) {
  need(value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every(key => ['handoff', 'destination', 'claimEnv'].includes(key)), 'COMMERCE_PAID_FILE_INVALID');
  privatePath(value.handoff); privatePath(value.destination);
  need(value.destination !== responseDestination, 'COMMERCE_PRODUCT_AND_RESPONSE_DESTINATIONS_MUST_DIFFER');
  const parent = dirname(value.destination), info = await lstat(parent);
  need(info.isDirectory() && !info.isSymbolicLink() && await realpath(parent) === parent &&
    (process.platform === 'win32' || info.uid === process.getuid() && (info.mode & 0o077) === 0),
  'COMMERCE_PAID_FILE_PRIVATE_PARENT_REQUIRED');
  const claimEnv = value.claimEnv ?? 'SF101_CLAIM_TOKEN';
  need(typeof claimEnv === 'string' && /^[A-Z][A-Z0-9_]{1,64}$/.test(claimEnv), 'COMMERCE_CLAIM_ENV_INVALID');
  const bytes = await readPrivateFile(value.handoff, 131072);
  const handoff = validateHandoff(parseJson(bytes)); bind(handoff, op);
  return { bytes, sha256: sha(bytes), destination: value.destination, claimEnv };
}

export async function freezePurchase(input, path) {
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try { await handle.writeFile(input.bytes); await handle.sync(); } finally { await handle.close(); }
  return { handoff: path, handoffSha256: input.sha256, destination: input.destination, claimEnv: input.claimEnv };
}

async function originalPurchase(entry, job) {
  const source = entry?.paidFile;
  if (!source) return null;
  const raw = await readPrivateFile(source.handoff, 131072);
  need(sha(raw) === source.handoffSha256, 'COMMERCE_SAVED_HANDOFF_CHANGED');
  const handoff = validateHandoff(parseJson(raw)); bind(handoff, job.operation);
  if (job.merchant) {
    need(job.merchant.routeId === handoff.routeId, 'COMMERCE_HANDOFF_ROUTE_MISMATCH');
    need(isDeepStrictEqual(job.merchant.originalTerms, handoff.payment), 'COMMERCE_HANDOFF_OFFER_MISMATCH');
  }
  return { source, handoff };
}

async function evidenceView(job) {
  const base = { path: job.evidencePath, intentId: job.operation.intentId };
  let raw;
  try { raw = await optionalPrivate(job.evidencePath, 2 * 1024 * 1024); }
  catch { return { ...base, status: 'UNAVAILABLE' }; }
  if (raw === null) return { ...base, status: 'NOT_RECORDED' };
  const value = parseJson(raw);
  if (job.attempt?.kind !== 'EXECUTE') return { ...base, status: 'NO_MATCHING_EXECUTION_ATTEMPT', sha256: sha(raw) };
  need(value?.schema === 'scf82.checkout-evidence.v1' && value.intentId === job.operation.intentId &&
    value.observation?.intentId === job.operation.intentId && value.observedAt === value.observation.observedAt,
  'COMMERCE_PAID_FILE_EVIDENCE_MISMATCH');
  need(Number.isFinite(Date.parse(value.observedAt)) &&
    Date.parse(value.observedAt) >= Date.parse(job.attempt.startedAt), 'COMMERCE_PAID_FILE_EVIDENCE_PREDATES_ATTEMPT');
  const terms = value.observation.buyer?.requirement, expected = job.operation.expect;
  if (terms) need(['scheme', 'network', 'asset', 'payTo'].every(key => terms[key] === expected[key]) &&
    BigInt(terms.amount) <= BigInt(expected.maxAtomic), 'COMMERCE_PAID_FILE_EVIDENCE_TERMS_MISMATCH');
  if (value.operatorReservation) need(value.operatorReservation.requestId === job.operation.intentId &&
    (value.operatorReservation.network === undefined || value.operatorReservation.network === expected.network),
  'COMMERCE_PAID_FILE_RESERVATION_MISMATCH');
  return { ...base, status: 'ORIGINAL_EVIDENCE_PRESENT', sha256: sha(raw), schema: value.schema,
    observedAt: value.observedAt, buyerStatus: value.observation.buyer?.status,
    binding: 'Original SF82 intent and terms. The frozen inbox request supplies the URL and order.' };
}

async function localDelivery(source, handoff) {
  const receiptPath = source.destination + '.sf101.json';
  const raw = await optionalPrivate(receiptPath, 131072);
  if (raw === null) {
    const info = await lstat(source.destination).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    return { available: false, status: info ? 'LOCAL_FILE_REQUIRES_CHECK' : 'NOT_RETRIEVED', receiptPath };
  }
  const receipt = parseJson(raw);
  need(receipt?.schema === 'stellar-forge.sf101.buyer-file.v1' && receipt.orderReference === handoff.orderReference &&
    receipt.purchaseUrl === handoff.purchaseUrl && receipt.deliveryUrl === handoff.deliveryUrl &&
    receipt.handoffSha256 === sha(JSON.stringify(handoff)) && receipt.file?.path === source.destination &&
    receipt.file.bytes === handoff.file.bytes && receipt.file.sha256 === handoff.file.sha256,
  'COMMERCE_PAID_FILE_RECEIPT_MISMATCH');
  const info = await lstat(source.destination);
  need(info.isFile() && !info.isSymbolicLink() && info.size === handoff.file.bytes &&
    (process.platform === 'win32' || info.uid === process.getuid() && (info.mode & 0o077) === 0),
  'COMMERCE_PAID_FILE_CHANGED');
  return { available: true, status: 'SAVED', path: source.destination, name: basename(source.destination),
    bytes: handoff.file.bytes, sha256: handoff.file.sha256, contentType: 'application/octet-stream',
    receiptPath, receiptObservedAt: receipt.observedAt, source: receipt.source };
}

async function transferView(source, handoff, delivery) {
  if (process.platform !== 'linux') return null;
  const statePath = source.destination + '.sf101-transfer.json';
  // Leave orders that have never retrieved a file without a transfer record.
  try { await lstat(statePath); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  try {
    const original = await inspectFileTransfer({ handoff, destination: source.destination });
    return { ...original, canReset: delivery.status === 'NOT_RETRIEVED' && original.retainedBytes > 0 &&
      ['INTERRUPTED', 'REJECTED'].includes(original.status) };
  } catch (error) {
    return { status: error.code === 'FILE_TRANSFER_ACTIVE' ? 'ACTIVE' : 'UNAVAILABLE',
      error: code(error), statePath, expectedBytes: handoff.file.bytes,
      resumable: false, canReset: false };
  }
}

/** Local status composes the original transfer recovery, inbox and receipt APIs. */
export async function inspectCommercePurchase(entry, job) {
  const original = await originalPurchase(entry, job);
  if (!original) return null;
  const { source, handoff } = original;
  let delivery, evidence;
  try { delivery = await localDelivery(source, handoff); }
  catch (error) { delivery = { available: false, status: code(error) }; }
  let transfer;
  try { transfer = await transferView(source, handoff, delivery); }
  catch (error) { transfer = { status: 'UNAVAILABLE', error: code(error), resumable: false, canReset: false }; }
  try { evidence = await evidenceView(job); }
  catch (error) { evidence = { status: code(error), path: job.evidencePath }; }
  return { orderReference: handoff.orderReference, purchaseUrl: handoff.purchaseUrl,
    deliveryUrl: handoff.deliveryUrl, file: handoff.file, handoffSha256: source.handoffSha256,
    destination: source.destination, delivery, transfer,
    request: { intentId: job.operation.intentId, configSha256: job.configSha256,
      inboxJobId: job.id, attemptId: job.attempt?.id ?? null, state: job.state },
    evidence, automaticPaymentRetry: false };
}

/** Exactly one explicit original entitlement retrieval, or original local-byte recovery. */
export async function retrieveCommercePurchase(entry, job, { environment, signal, fetchImpl } = {}) {
  const original = await originalPurchase(entry, job);
  need(original, 'COMMERCE_PAID_FILE_NOT_CONFIGURED');
  return retrieveFile({ handoff: original.handoff, destination: original.source.destination,
    token: environment?.[original.source.claimEnv], signal, fetchImpl });
}

/** Clear only this handoff's original retained partial; a later retrieve starts it. */
export async function resetCommercePurchase(entry, job) {
  const original = await originalPurchase(entry, job);
  need(original, 'COMMERCE_PAID_FILE_NOT_CONFIGURED');
  return resetFileTransfer({ handoff: original.handoff, destination: original.source.destination });
}
