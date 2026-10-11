// MIT. Original signed batch workflow inside the existing catalog workspace.
// Authority, proof checks, atomic preview/apply and the journal remain in SF60.
import { SIGNED_BATCH_SCHEMA, SIGNED_BATCH_PLAN_SCHEMA } from './operator.mjs';
import { MAX_BATCH_OPERATIONS } from './journal.mjs';
import { renderReview } from './bulk-import.mjs';
import { reconcileCatalogOperation } from './workspace-recovery.mjs';
import { renderRecoveryReport } from './recover-cli.mjs';

export const MAX_BATCH_BODY = 8 * 1024 * 1024 - 8192;
const fail = code => {throw Object.assign(new Error(code), {httpStatus:400});};
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Received original bytes only; no filesystem paths or browser-supplied plan. */
export async function prepareWorkspaceBatch(batch, call, validateAdmission) {
  if (!plain(batch) || batch.schema !== SIGNED_BATCH_SCHEMA || Object.keys(batch).length !== 2 ||
      !Array.isArray(batch.admissions) || !batch.admissions.length || batch.admissions.length > MAX_BATCH_OPERATIONS)
    fail('SIGNED_BATCH_SCHEMA_INVALID');
  if (Buffer.byteLength(JSON.stringify(batch)) > MAX_BATCH_BODY) fail('SIGNED_BATCH_COMMAND_SIZE_LIMIT');
  const sellers = new Set();
  for (const [index, row] of batch.admissions.entries()) {
    try { validateAdmission(row); sellers.add(row.sellerId); }
    catch (error) {
      const code = /^[A-Z][A-Z0-9_]{0,100}$/.test(error?.message ?? '') ? error.message : 'RECEIVED_ADMISSION_INVALID';
      fail(`BATCH_ROW_${index}_${code}`);
    }
  }
  // Original PR922 verifies every proof against the actual startup policy here.
  // It repeats verification on apply, including expiry and all plan bindings.
  const plan = await call('preview-batch', {batch});
  if (plan?.schema !== SIGNED_BATCH_PLAN_SCHEMA || !plain(plan.review) || !Array.isArray(plan.review.changes) ||
      plan.review.requested !== batch.admissions.length) fail('ORIGINAL_BATCH_PLAN_REQUIRED');
  const input = {batch,expectedHead:plan.review.baseHead,expectedPlan:plan.review.planId,
    expectedBatch:plan.batchSha256,expectedPolicy:plan.policySha256};
  if (Buffer.byteLength(JSON.stringify({schema:'stellar-forge.catalog-operator-command/v1',
      requestId:'00000000-0000-0000-0000-000000000000',operation:'apply-batch',input})) > 8 * 1024 * 1024)
    fail('SIGNED_BATCH_COMMAND_SIZE_LIMIT');
  return {input,plan,summary:{members:batch.admissions.length,sellerCount:sellers.size,
    sellerId:[...sellers][0] + (sellers.size > 1 ? ` (+${sellers.size - 1} others)` : ''),
    batchSha256:plan.batchSha256,changes:plan.review.applied,replays:plan.review.replayed,
    verifiedPaymentOptions:plan.verifiedPaymentOptions,expiresAt:plan.expiresAt}};
}

export async function reconcileWorkspaceBatch(record, directory) {
  if (record.operation !== 'apply-batch') fail('SIGNED_BATCH_RECORD_REQUIRED');
  const report = await reconcileCatalogOperation({directory,operation:record.operation,input:record.input,
    expectedPolicySha256:record.policySha256});
  return {...report,operationId:record.id,recordedCommandPhase:record.phase,
    recordedReceiptAvailable:Boolean(record.result),commandResent:false,
    verdict:report.catalogEffects === 'all-observed' ? 'ALL_ORIGINAL_BATCH_EFFECTS_PRESENT'
      : report.catalogEffects === 'partially-observed' ? 'SOME_ORIGINAL_BATCH_EFFECTS_PRESENT' : 'NO_ORIGINAL_BATCH_EFFECTS_OBSERVED'};
}

/** Export an existing observation/plan; this route never runs another command. */
export function batchDocument(record, kind) {
  if (record.operation !== 'apply-batch') fail('SIGNED_BATCH_RECORD_REQUIRED');
  if (kind === 'recovery') {
    if (record.reconciliation?.schema !== 'stellar-forge.catalog-effect-recovery/v1') fail('SAVE_BATCH_RECONCILIATION_FIRST');
    return {filename:`catalog-batch-recovery-${record.id}.html`,mediaType:'text/html',content:renderRecoveryReport(record.reconciliation)};
  }
  if (kind !== 'review' || record.batchReview?.schema !== SIGNED_BATCH_PLAN_SCHEMA) fail('ORIGINAL_BATCH_PLAN_REQUIRED');
  const plan = record.batchReview;
  return {filename:`catalog-batch-review-${record.id}.html`,mediaType:'text/html',content:renderReview({review:plan.review,
    inputSha256:plan.batchSha256,authoritiesSha256:plan.policySha256},
    {notice:`The original operator verified every included seller proof at preview. Apply verifies them again. Earliest proof expiry: ${plan.expiresAt}. This plan and its atomic amounts describe catalog changes, not payments or revenue.`})};
}
