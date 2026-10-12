// MIT. Portable review records bound to the original source, plan and compiler preview.
import { createHash } from 'node:crypto';
import { routeSheetText } from './route-sheet-model.mjs';
import {
  OPERATION_POLICY_APPLICATION_BYTES, operationPolicyCanonical, operationPolicyJSON,
  normalizeOperationPolicy, operationPolicyText, applyOperationPolicy, operationPolicyCurrent
} from './operation-policy-model.mjs';

export const OPERATION_POLICY_APPLICATION_SCHEMA = 'stellar-forge.api-operation-policy-application.v1';
export const OPERATION_POLICY_REVIEW_SCHEMA = 'stellar-forge.api-operation-policy-review.v1';
export const operationPolicySha256 = value => createHash('sha256').update(value).digest('hex');
const canonical = operationPolicyCanonical;
const digest = value => operationPolicySha256(canonical(value));
const hash = /^[a-f0-9]{64}$/;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => {
  throw Object.assign(new TypeError(message), {code:'OPENAPI_OPERATION_POLICY_REVIEW_INVALID',status:400});
};
function exact(value, allowed, required, label) {
  if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key)) ||
      required.some(key => !Object.hasOwn(value,key))) fail('Keep the complete original ' + label + ' fields.');
}
function sourceInspection(specText, inspection) {
  if (typeof specText !== 'string' || !plain(inspection) || !Array.isArray(inspection.operations) ||
      inspection.sourceSha256 !== operationPolicySha256(specText))
    fail('Review the exact original source bytes and their current native inventory.');
  return inspection;
}
/** The native workspace supplies inspectOpenApi output; this module never compiles routes. */
export function prepareOperationPolicyApplication({
  specText, plan, worksheet, policy, targets, overrides = [], operationPlans = [], capturedSource, inspection
}) {
  sourceInspection(specText,inspection);
  const basePlan = operationPolicyJSON(plan,OPERATION_POLICY_APPLICATION_BYTES,'base merchant plan');
  const current = operationPolicyCurrent({...inspection,plan:basePlan});
  const applied = applyOperationPolicy({
    plan:basePlan,sheet:worksheet,current,operations:inspection.operations,
    policy,targets,overrides,operationPlans
  });
  const captured = capturedSource === undefined ? undefined
    : operationPolicyJSON(capturedSource,OPERATION_POLICY_APPLICATION_BYTES,'captured source selection');
  const input = {
    sourceSha256:inspection.sourceSha256,basePlan,worksheet:applied.worksheet,
    policy:applied.policy,targets:applied.targets,overrides:applied.overrides,
    operationPlans:applied.operationPlans,...(captured === undefined ? {} : {capturedSource:captured})
  };
  operationPolicyJSON(input,OPERATION_POLICY_APPLICATION_BYTES,'complete policy application');
  return {...applied,input};
}
/** Native prepareMerchant validates the exact candidate before this decision is made. */
export function operationPolicyReview(prepared, preview) {
  const input = operationPolicyJSON(prepared.input,OPERATION_POLICY_APPLICATION_BYTES,'reviewed policy input');
  const nativePreview = operationPolicyJSON(preview,OPERATION_POLICY_APPLICATION_BYTES,'native merchant preview');
  const core = {
    schema:OPERATION_POLICY_REVIEW_SCHEMA,
    sourceSha256:input.sourceSha256,
    basePlanSha256:digest(input.basePlan),
    candidatePlanSha256:digest(prepared.plan),
    worksheetSha256:operationPolicySha256(routeSheetText(input.worksheet)),
    policySha256:operationPolicySha256(operationPolicyText(input.policy)),
    inputSha256:digest(input),
    nativePreviewSha256:digest(nativePreview),
    capturedSourceSha256:Object.hasOwn(input,'capturedSource') ? digest(input.capturedSource) : null
  };
  const review = {...core,sha256:digest(core)};
  const operationPolicy = {
    schema:OPERATION_POLICY_APPLICATION_SCHEMA,
    ...input,policySha256:core.policySha256,review
  };
  operationPolicyRecordText(operationPolicy);
  return {review,plan:prepared.plan,preview:nativePreview,changes:prepared.changes,operationPolicy};
}
/** Reconstruct portable review decisions through the same original worksheet planner. */
export function verifyOperationPolicyRecord(value,{specText,plan,inspection,preview}) {
  const record = operationPolicyJSON(value,OPERATION_POLICY_APPLICATION_BYTES,'portable policy review record');
  const names = [
    'schema','sourceSha256','basePlan','worksheet','policy','targets','overrides',
    'operationPlans','capturedSource','policySha256','review'
  ];
  exact(record,names,names.filter(key=>key!=='capturedSource'),'policy review record');
  if (record.schema !== OPERATION_POLICY_APPLICATION_SCHEMA || !hash.test(record.sourceSha256 ?? '') ||
      !hash.test(record.policySha256 ?? '') || record.sourceSha256 !== operationPolicySha256(specText))
    fail('The policy review belongs to different original source bytes.');
  const document = normalizeOperationPolicy(record.policy);
  if (record.policySha256 !== operationPolicySha256(operationPolicyText(document)))
    fail('The complete retained policy edition differs from its selected SHA-256.');
  const prepared = prepareOperationPolicyApplication({
    specText,plan:record.basePlan,worksheet:record.worksheet,policy:document,
    targets:record.targets,overrides:record.overrides,operationPlans:record.operationPlans,
    ...(Object.hasOwn(record,'capturedSource') ? {capturedSource:record.capturedSource} : {}),
    inspection
  });
  if (canonical(prepared.plan) !== canonical(plan))
    fail('The saved merchant plan differs from the exact reviewed policy candidate. Review the edited plan again.');
  const expected = operationPolicyReview(prepared,preview).operationPolicy;
  if (canonical(expected) !== canonical(record))
    fail('The retained policy review decision or native preview differs. Reopen its complete original review.');
  return expected;
}
export function operationPolicyRecordText(value) {
  const result = JSON.stringify(operationPolicyJSON(value,OPERATION_POLICY_APPLICATION_BYTES,'portable policy review record'),null,2)+'\n';
  if (Buffer.byteLength(result) > OPERATION_POLICY_APPLICATION_BYTES) fail('The complete portable policy review record exceeds 4 MiB.');
  return result;
}
/** Ordinary editor saves must carry the same original HAR selection as their review. */
export function assertOperationPolicyCapture(record,capturedSource) {
  if (record === undefined) return;
  const retained = Object.hasOwn(record,'capturedSource') ? record.capturedSource : undefined;
  if (canonical(retained) !== canonical(capturedSource))
    fail('Keep the exact captured-source selection attached to this reviewed policy package.');
}
