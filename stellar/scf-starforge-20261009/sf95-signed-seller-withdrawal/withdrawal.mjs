// MIT. Seller-approved catalog withdrawal through the existing SF60 writer.
import {randomBytes} from 'node:crypto';
import {WITHDRAWAL_DOMAIN, ID, DEFAULT_LIFETIME_MS, MAX_LIFETIME_MS, fail, checkedRequest, verifyWithdrawal} from './proof.mjs';
export {WITHDRAWAL_DOMAIN, signWithdrawal, verifyWithdrawal} from './proof.mjs';

async function assertOriginalJournal(journal) {
  const {DurableCatalogTransaction} = await import('../sf60-durable-catalog-transaction/journal.mjs');
  if (!(journal instanceof DurableCatalogTransaction)) fail('ORIGINAL_SF60_WRITER_REQUIRED');
}
function currentSeller(journal, request) {
  const current = journal.lookupCatalogKey(request.catalogKey);
  if (!current || current.retired || current.sellerId !== request.sellerId ||
      current.signer !== request.signer) fail('CURRENT_SELLER_IDENTITY_NOT_MATCHED');
  if (!Number.isSafeInteger(current.sequence) ||
      current.sequence >= Number.MAX_SAFE_INTEGER || current.sequence + 1 !== request.sequence)
    fail('WITHDRAWAL_SEQUENCE_NOT_CURRENT');
  if (journal.head !== request.previousHead) fail('WITHDRAWAL_JOURNAL_HEAD_CHANGED');
  return current;
}

// Operator creates a head-bound request from an actual open original SF60 journal.
// Nothing is signed or retired here; the seller receives only this request JSON.
export async function prepareWithdrawal({journal, sellerId, catalogKey, sourceURL, reason,
  now = Date.now(), lifetimeMs = DEFAULT_LIFETIME_MS}) {
  await assertOriginalJournal(journal);
  if (!ID.test(sellerId ?? '') || typeof catalogKey !== 'string' ||
      typeof sourceURL !== 'string' || typeof reason !== 'string')
    fail('PREPARE_INPUTS_INVALID');
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(lifetimeMs) ||
      lifetimeMs < 60_000 || lifetimeMs > MAX_LIFETIME_MS) fail('PREPARE_CLOCK_INVALID');
  const current = journal.lookupCatalogKey(catalogKey);
  if (!current || current.retired || current.sellerId !== sellerId ||
      !Number.isSafeInteger(current.sequence) || current.sequence >= Number.MAX_SAFE_INTEGER)
    fail('ACTIVE_CATALOG_SELLER_REQUIRED');
  return checkedRequest({domain: WITHDRAWAL_DOMAIN, sellerId, catalogKey,
    signer: current.signer, sequence: current.sequence + 1, previousHead: journal.head,
    sourceURL, reason, nonce: randomBytes(32).toString('base64url'),
    issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + lifetimeMs).toISOString()});
}

// ORIGINAL SF60 validates its three projections and atomically persists retirement.
// A write failure is never hidden or reported as a successful withdrawal.
export async function applyWithdrawal({journal, envelope, pinnedPublicKey, now = Date.now()}) {
  await assertOriginalJournal(journal);
  const {request, proofSha256} = verifyWithdrawal(envelope, pinnedPublicKey, {now});
  currentSeller(journal, request);
  const receipt = await journal.retire({catalogKey:request.catalogKey, sellerId:request.sellerId,
    signer:request.signer, sequence:request.sequence, reason:request.reason,
    provenance: {authority:'signed_export', sellerId:request.sellerId,
      sourceURL:request.sourceURL, sourceSha256:proofSha256,
      observedAt:new Date(now).toISOString()}}, {expectedHead:request.previousHead});
  return {schema:'stellar-forge.seller-withdrawal-receipt/v1', decision:receipt.decision,
    journalHead:receipt.head, journalOperations:receipt.operations,
    sellerId:request.sellerId, catalogKey:request.catalogKey,
    sequence:request.sequence, previousHead:request.previousHead,
    proofSha256, withdrawnAt:new Date(now).toISOString(),
    paymentCalls:0, walletSignatures:0};
}
