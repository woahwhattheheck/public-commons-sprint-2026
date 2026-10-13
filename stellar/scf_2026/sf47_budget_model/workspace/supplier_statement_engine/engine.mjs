import { canonicalJson, fail, parseStrictJson, sha256 } from './json.mjs';
import { isCanonicalDateString, isCanonicalUtcString, parseRetainedDateMs, processUtcNow } from './clock.mjs';
import {
  INPUT_SCHEMA,
  RECEIPT_SCHEMA,
  inputDigest,
  normalizeInput,
  publicNormalizedInput,
  snapshotSemanticDigest,
} from './validation.mjs';
import { reconcile } from './reconcile.mjs';

export { parseStrictJson, canonicalJson, sha256 } from './json.mjs';
export { INPUT_SCHEMA, RECEIPT_SCHEMA } from './validation.mjs';

const OPERATION = 'SUPPLIER_STATEMENT_AP_RECONCILIATION_REVIEW';
const CURRENT_MODE = 'CURRENT_PROCESS_UTC';
const HISTORICAL_MODE = 'HISTORICAL_INTEGRITY_ONLY';

function retainedTemporalPreflight(input, evaluatedAt) {
  if (!isCanonicalUtcString(evaluatedAt)) fail('INVALID_EVALUATION_TIME');
  const evalMs = parseRetainedDateMs(evaluatedAt);
  if (!input || typeof input !== 'object' || Array.isArray(input)) return;
  const maxAgeHours = input?.policy?.maxAgeHours;
  const boundedMaxAge = typeof maxAgeHours === 'number' && Number.isInteger(maxAgeHours) && maxAgeHours >= 1 && maxAgeHours <= 24 * 31
    ? maxAgeHours
    : null;
  for (const side of ['statement', 'ledger']) {
    const snapshot = input[side];
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) continue;
    const { capturedAt, periodEnd } = snapshot;
    if (typeof capturedAt === 'string' && !isCanonicalUtcString(capturedAt)) fail('INVALID_TIMESTAMP');
    if (typeof periodEnd === 'string' && !isCanonicalDateString(periodEnd)) fail('INVALID_DATE');
    if (typeof capturedAt === 'string' && isCanonicalUtcString(capturedAt)) {
      const capturedMs = parseRetainedDateMs(capturedAt);
      if (capturedMs > evalMs) fail('FUTURE_GENERATION', side);
      if (boundedMaxAge !== null && evalMs - capturedMs > boundedMaxAge * 3_600_000) fail('STALE_GENERATION', side);
      if (typeof periodEnd === 'string' && isCanonicalDateString(periodEnd)) {
        if (parseRetainedDateMs(`${periodEnd}T00:00:00Z`) > evalMs) fail('FUTURE_PERIOD_END', side);
        if (capturedAt.slice(0, 10) < periodEnd) fail('CAPTURED_BEFORE_PERIOD_END', side);
      }
    }
    if (Array.isArray(snapshot.rows)) {
      for (const row of snapshot.rows) {
        if (row && typeof row === 'object' && typeof row.eventDate === 'string' && !isCanonicalDateString(row.eventDate)) fail('INVALID_DATE');
      }
    }
  }
}

function assertReceiptShape(received, expected, path = 'receipt') {
  if (expected === null) {
    if (received !== null) fail('RECEIPT_SHAPE_MISMATCH', path);
    return;
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(received)) fail('RECEIPT_SHAPE_MISMATCH', path);
    const expectedKeys = Object.keys(expected);
    const receivedKeys = Object.keys(received);
    if (receivedKeys.length !== expectedKeys.length) fail('RECEIPT_SHAPE_MISMATCH', path);
    for (const key of expectedKeys) {
      if (!Object.hasOwn(received, key)) fail('RECEIPT_SHAPE_MISMATCH', `${path}.${key}`);
      assertReceiptShape(received[key], expected[key], `${path}[${key}]`);
    }
    return;
  }

  if (typeof expected === 'object') {
    if (!received || typeof received !== 'object' || Array.isArray(received)) {
      fail('RECEIPT_SHAPE_MISMATCH', path);
    }
    const expectedKeys = Object.keys(expected);
    const receivedKeys = Object.keys(received);
    if (receivedKeys.length !== expectedKeys.length) fail('RECEIPT_SHAPE_MISMATCH', path);
    for (const key of expectedKeys) {
      if (!Object.hasOwn(received, key)) fail('RECEIPT_SHAPE_MISMATCH', `${path}.${key}`);
      assertReceiptShape(received[key], expected[key], `${path}.${key}`);
    }
    return;
  }

  if (received === null || typeof received !== typeof expected) fail('RECEIPT_SHAPE_MISMATCH', path);
}

function compileAt(input, evaluatedAt, evaluationMode) {
  retainedTemporalPreflight(input, evaluatedAt);
  const canonicalEvaluatedAt = evaluatedAt;
  const normalized = normalizeInput(input, canonicalEvaluatedAt);
  const result = reconcile(normalized);
  const statementDigest = snapshotSemanticDigest(normalized.statement);
  const ledgerDigest = snapshotSemanticDigest(normalized.ledger);
  const base = {
    schemaVersion: RECEIPT_SCHEMA,
    operation: OPERATION,
    evaluationMode,
    evaluatedAt: canonicalEvaluatedAt,
    scope: {
      supplierRef: normalized.statement.supplierRef,
      currency: normalized.statement.currency,
      periodEnd: normalized.statement.periodEnd,
    },
    inputSchemaVersion: INPUT_SCHEMA,
    inputDigest: inputDigest(normalized),
    generationDigests: { statement: statementDigest, ledger: ledgerDigest },
    policy: normalized.policy,
    counts: result.counts,
    balances: result.balances,
    reviewQueue: result.queue,
    currentness: {
      status: evaluationMode === CURRENT_MODE ? 'CURRENT_PROCESS_CLOCK_EVALUATION' : 'HISTORICAL_INTEGRITY_ONLY',
      currentReadinessMinted: evaluationMode === CURRENT_MODE,
    },
    authority: {
      supplierContactAuthorized: false,
      invoiceOrCreditMemoMutationAuthorized: false,
      apOrLedgerMutationAuthorized: false,
      paymentRefundCreditOffsetAuthorized: false,
      disputeCollectionOrClaimAuthorized: false,
      accountingTaxLegalDeterminationAuthorized: false,
      fraudDeterminationAuthorized: false,
      cashSavingsProfitReceivableRevenueAsserted: false,
      deploymentFulfillmentOrSpendAuthorized: false,
    },
  };
  return { ...base, receiptDigest: sha256(base) };
}

export function compileSupplierStatementReconciliation(input) {
  return compileAt(input, processUtcNow(), CURRENT_MODE);
}

export function compileSupplierStatementReconciliationHistorical(input, { asOf } = {}) {
  return compileAt(input, asOf, HISTORICAL_MODE);
}

export function verifySupplierStatementReconciliation(receipt, input) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) fail('RECEIPT_OBJECT_REQUIRED');
  if (receipt.schemaVersion !== RECEIPT_SCHEMA) fail('INVALID_RECEIPT_SCHEMA');
  if (receipt.evaluationMode !== CURRENT_MODE) fail('HISTORICAL_RECEIPT_CANNOT_MINT_CURRENT_VERIFICATION');
  const exact = compileAt(input, receipt.evaluatedAt, CURRENT_MODE);
  assertReceiptShape(receipt, exact);
  if (canonicalJson(exact) !== canonicalJson(receipt)) fail('RECEIPT_MISMATCH');
  const verifiedAt = processUtcNow();
  if (parseRetainedDateMs(verifiedAt) < parseRetainedDateMs(receipt.evaluatedAt)) fail('FUTURE_RECEIPT_EVALUATION');
  retainedTemporalPreflight(input, verifiedAt);
  normalizeInput(input, verifiedAt);
  return { ok: true, receiptDigest: exact.receiptDigest, verifiedAt, currentness: 'CURRENT_PROCESS_CLOCK_VERIFIED' };
}

export function verifySupplierStatementReconciliationHistorical(receipt, input) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) fail('RECEIPT_OBJECT_REQUIRED');
  if (receipt.schemaVersion !== RECEIPT_SCHEMA) fail('INVALID_RECEIPT_SCHEMA');
  if (receipt.evaluationMode !== HISTORICAL_MODE) fail('RECEIPT_NOT_HISTORICAL');
  const exact = compileAt(input, receipt.evaluatedAt, HISTORICAL_MODE);
  assertReceiptShape(receipt, exact);
  if (canonicalJson(exact) !== canonicalJson(receipt)) fail('RECEIPT_MISMATCH');
  return { ok: true, receiptDigest: exact.receiptDigest, currentness: 'HISTORICAL_INTEGRITY_ONLY' };
}

export function normalizedInputForDigest(input, evaluatedAt) {
  retainedTemporalPreflight(input, evaluatedAt);
  return publicNormalizedInput(normalizeInput(input, evaluatedAt));
}

export function renderMarkdown(receipt) {
  if (!receipt || receipt.schemaVersion !== RECEIPT_SCHEMA) fail('INVALID_RECEIPT_SCHEMA');
  const lines = [
    '# Supplier Statement ↔ AP Ledger Reconciliation Review',
    '',
    `Evaluated: ${receipt.evaluatedAt}`,
    `Mode: ${receipt.evaluationMode}`,
    `Receipt: \`${receipt.receiptDigest}\``,
    '',
    '## Scope',
    '',
    `- Supplier: ${receipt.scope.supplierRef}`,
    `- Currency: ${receipt.scope.currency}`,
    `- Period end: ${receipt.scope.periodEnd}`,
    `- Statement rows: ${receipt.counts.statementRows}`,
    `- Ledger rows: ${receipt.counts.ledgerRows}`,
    `- Exact matches: ${receipt.counts.exactMatches}`,
    `- Review items: ${receipt.counts.reviewItems}`,
    '',
    '## Balance reconciliation',
    '',
    `- Statement closing: ${receipt.balances.statementClosingBalanceMinor} minor units`,
    `- Ledger closing: ${receipt.balances.ledgerClosingBalanceMinor} minor units`,
    `- Closing variance (statement - ledger): ${receipt.balances.closingBalanceVarianceMinor} minor units`,
    '',
    '## Owner review queue',
    '',
  ];
  if (receipt.reviewQueue.length === 0) lines.push('- No reconciliation exception found in the two supplied complete generations.');
  for (const row of receipt.reviewQueue) {
    lines.push(`- **${row.kind}** · ${row.documentRef} · ${row.rowType} · review magnitude ${row.reviewMagnitudeMinor} ${row.currency} minor units · ${row.factuality}`);
  }
  lines.push(
    '',
    '## Interpretation',
    '',
    'A supplier credit absent from the internal ledger is a supplied-evidence owner-review candidate only. No exception is an entitlement, refund, receivable, recovered cash, savings, profit, or revenue assertion.',
    'A POSSIBLE_MATCH_REVIEW row is heuristic only and never removes or resolves either underlying missing-item exception.',
    '',
    '## Authority ceiling',
    '',
    'Offline owner review only. This artifact does not contact suppliers, create or modify invoices/credits/AP/ledger records, move money, execute refunds/credits/offsets, file disputes or claims, make accounting/tax/legal/fraud determinations, deploy, fulfill, or spend.',
    '',
  );
  return lines.join('\n');
}
