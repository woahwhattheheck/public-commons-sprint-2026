// MIT. Prepare and receive customer procedures in the original native SF47 review.
import { planSummary, selectedPlan, validatePlanningState, validatePlanSources, usd } from './grant-plan-core.mjs';
import { createOperatingPlan, createOperatingStep, inspectOperatingPlan, receiveOperatingPlan, compareOperatingFiles } from
  '../../../stellar/scf-starforge-20261009/distribution/discovery/operating-plan.mjs';

import { OPERATING_RETURN_SCHEMA, inspectOperatingPlanReturn, applyOperatingPlanReturn } from
  '../../../stellar/scf-starforge-20261009/distribution/discovery/operating-plan-return.mjs';

export const GRANT_OPERATING_REVIEW_RECEIPT_SCHEMA = 'stellar-forge.grant-operating-review-receipt.v1';
export const GRANT_OPERATING_SELECTION_SCHEMA = 'stellar-forge.grant-operating-selection.v1';
export const GRANT_OPERATING_PREPARATION_SCHEMA = 'stellar-forge.grant-operating-preparation.v1';
export const GRANT_OPERATING_CONTINUATION_SCHEMA = 'stellar-forge.grant-operating-continuation.v1';
export const GRANT_OPERATING_RETURN_COMPARISON_SCHEMA = 'stellar-forge.grant-operating-return-comparison.v1';
export const GRANT_OPERATING_RETURN_DRAFT_SCHEMA = 'stellar-forge.grant-operating-return-draft.v1';
const copy = value => JSON.parse(JSON.stringify(value));
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const need = (condition, message) => { if (!condition) throw new TypeError(message); };
const fields = ['title', 'customer', 'purpose', 'owner', 'receiving', 'notes'];
function text(value, label, maximum = 32000) {
  need(typeof value === 'string' && value.length <= maximum && !value.includes('\u0000'),
    label + ' must be text within ' + maximum + ' characters.');
}
export function newGrantOperatingSelection(source, revision = source.document.currentRevision) {
  const plan = source.document.revisions.find(value => value.revision === revision);
  need(plan, 'Select a retained native planning revision.');
  return { schema: GRANT_OPERATING_SELECTION_SCHEMA, sourceSha256: source.sha256, revision,
    title: (plan.name || source.document.name || 'Grant delivery').slice(0, 276) + ' — operating procedure',
    customer: '', purpose: 'Perform the selected native work packages and deliver their original completion results.',
    owner: '', receiving: '', notes: '', bindings: {}, prepared: [] };
}
export function validateGrantOperatingSelection(value, source, revision) {
  need(plain(value) && value.schema === GRANT_OPERATING_SELECTION_SCHEMA,
    'Open the customer procedure selection from this planning review.');
  need(value.sourceSha256 === source.sha256 && value.revision === revision,
    'Keep the procedure selection with its original planning file and native revision.');
  for (const field of fields) text(value[field], field, ['title', 'owner'].includes(field) ? 300 : field === 'customer' ? 1000 : 32000);
  need(plain(value.bindings), 'Retain the selected original registrations by work-package ID.');
  const native = source.document.revisions.find(plan => plan.revision === revision);
  need(native, 'Retain the selected native plan revision.');
  const packageIds = new Set(native.scenario.future_costs.map(cost => cost.id));
  for (const [packageId, registration] of Object.entries(value.bindings)) {
    need(packageIds.has(packageId), 'The selected registration belongs to another native work package: ' + packageId);
    if (registration !== null) createOperatingStep({ id: 'selected-registration', selection: registration });
  }
  need(Array.isArray(value.prepared), 'Retain the prepared customer procedures.');
  const identities = new Set();
  for (const item of value.prepared) {
    need(item?.schema === GRANT_OPERATING_PREPARATION_SCHEMA && item.source?.sha256 === source.sha256 &&
      item.source.revision === revision, 'Retain each prepared procedure with its original native source.');
    inspectOperatingPlan(item.plan);
    validateContinuation(item);
    need(!identities.has(item.plan.id), 'Keep unique prepared operating-plan identities.'); identities.add(item.plan.id);
    need(Array.isArray(item.packageIds) && item.packageIds.every(id => packageIds.has(id)) &&
      new Set(item.packageIds).size === item.packageIds.length, 'Retain the original selected work-package identities.');
  }
  if (value.returnDraft !== undefined && value.returnDraft !== null) {
    const pending = value.returnDraft;
    need(plain(pending) && pending.schema === GRANT_OPERATING_RETURN_DRAFT_SCHEMA &&
      pending.sourceSha256 === source.sha256 && pending.nativeRevision === revision,
      'Retain the unfinished return with its original native planning selection.');
    text(pending.filename, 'Returned procedure filename', 300);
    text(pending.note, 'Procedure receiving note'); receivingTime(pending.openedAt);
    const incoming = inspectOperatingPlan(pending.incoming);
    if (pending.reviewedReturn !== undefined) {
      const returned = grantOperatingReturnInput(pending.reviewedReturn);
      need(sameValue(returned.plan, incoming), 'Keep the pending review with its exact completed original procedure.');
    }
    const prepared = value.prepared.find(item => item.plan.id === incoming.id);
    need(prepared && pending.planId === incoming.id, 'Keep the unfinished return with its prepared procedure.');
    receiveOperatingPlan(incoming, prepared.plan);
    if (pending.reviewedReturn !== undefined) validateReviewOrigin(pending.reviewedReturn, prepared);
    const current = grantOperatingContinuationPlan(prepared);
    need(Number.isSafeInteger(pending.comparedRevision) &&
      pending.comparedRevision >= prepared.plan.revisions.length &&
      pending.comparedRevision <= current.revisions.length,
      'Retain the exact previously compared operating revision.');
  }
  return value;
}
/** Read the native summary; prices, scope and relative dates are never recalculated here. */
export function prepareGrantOperatingPlan(source, review, {
  id, savedAt = new Date().toISOString(), selection = review.operatingSelection,
} = {}) {
  validatePlanSources([source]); validatePlanningState(review, [source]);
  const { plan: native } = selectedPlan([source], review);
  const chosen = validateGrantOperatingSelection(selection ?? newGrantOperatingSelection(source, native.revision), source, native.revision);
  const summary = planSummary(source, native.revision, review.costIds);
  need(summary.costs.length > 0, 'Select at least one original work package for the procedure.');
  const ordered = summary.tranches.flatMap(tranche => tranche.costs.map(cost => ({ cost, milestone: tranche.milestone })));
  const basis = {
    filename: source.filename, sha256: source.sha256, bytes: source.bytes,
    planId: native.id, planName: native.name, revision: native.revision,
    contentSha256: native.contentSha256, scenarioSourceSha256: native.source.sha256, scenarioCalculationSha256: native.report.scenarioSha256,
  };
  const totals = { plannedUsd: summary.amount, estimatedHours: summary.hours,
    awardRequestUsd: summary.award, projectEndDay: summary.duration };
  const packageIds = ordered.map(({ cost }) => cost.id);
  const firstDay = Math.min(...ordered.map(({ cost }) => cost.start_day));
  const lastDay = Math.max(...ordered.map(({ cost }) => cost.end_day));
  const steps = ordered.map(({ cost, milestone }) => {
    const position = native.scenario.future_costs.findIndex(value => value.id === cost.id);
    const registration = Object.hasOwn(chosen.bindings, cost.id) ? chosen.bindings[cost.id] : null;
    const sourceFields = [
      'Native plan: ' + native.name + ' · revision ' + native.revision,
      'Original work package: ' + cost.id + ' · tranche ' + cost.tranche,
      'Prospective package price: ' + usd(cost.amount_usd) + ' USD',
      ...(cost.estimated_hours === undefined || cost.estimated_hours === null ? [] : ['Native estimated work: ' + cost.estimated_hours + ' hours']),
      'Native work window: days ' + cost.start_day + '–' + cost.end_day + ' from award-acceptance day zero.',
      'Tranche delivery: ' + milestone.deliverable,
      'Tranche completion measure: ' + milestone.measurable_proof,
      'Tranche submission day: ' + milestone.submit_day,
      '',
      'Original native package fields:',
      JSON.stringify(cost, null, 2),
    ];
    return createOperatingStep({
      id: 'native-package-' + (position + 1),
      title: (cost.id + ' · ' + cost.remaining_work).slice(0, 300),
      instruction: cost.remaining_work,
      inputs: sourceFields.join('\n'),
      expectedResult: cost.measurable_proof,
      owner: chosen.owner, selection: registration,
    });
  });
  const sourceNote = 'Native planning selection\n' + JSON.stringify({ source: basis, packageIds, totals }, null, 2);
  const continuation = 'Original native planning file: ' + source.filename + '. Continue its grant, payment, budget and calendar work in the original SF47 workspace. Keep that complete file or the containing submission draft with this procedure.';
  const plan = createOperatingPlan({
    id, savedAt, title: chosen.title, customer: chosen.customer, purpose: chosen.purpose,
    period: 'Native work window: days ' + firstDay + '–' + lastDay + ' from award-acceptance day zero',
    owner: chosen.owner,
    receiving: [chosen.receiving.trim(), continuation].filter(Boolean).join('\n\n'),
    notes: [chosen.notes.trim(), sourceNote].filter(Boolean).join('\n\n'),
    steps,
  });
  return { schema: GRANT_OPERATING_PREPARATION_SCHEMA, source: copy(basis),
    packageIds, totals, plan };
}
export function grantOperatingSelectionOf(review, source) {
  const selection = review.operatingSelection ?? newGrantOperatingSelection(source, review.revision);
  return copy(validateGrantOperatingSelection(selection, source, review.revision));
}

const canonicalValue = value => Array.isArray(value) ? value.map(canonicalValue) : plain(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key])])) : value;
const sameValue = (left, right) => JSON.stringify(canonicalValue(left)) === JSON.stringify(canonicalValue(right));
const STEP_COMPARISON_FIELDS = ['title', 'instruction', 'inputs', 'expectedResult', 'owner', 'due', 'status', 'recordedResult', 'argv', 'selection', 'files'];
const PLAN_COMPARISON_FIELDS = ['title', 'customer', 'purpose', 'period', 'owner', 'receiving', 'notes'];
function receivingTime(value) {
  need(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19),
  'Retain the procedure receiving time as a complete UTC timestamp.');
}
/** Accept the original procedure or an entire completed original reconciliation review. */
export function grantOperatingReturnInput(value) {
  if (value?.schema !== OPERATING_RETURN_SCHEMA)
    return { plan: inspectOperatingPlan(value), reviewedReturn: null };
  const reviewedReturn = inspectOperatingPlanReturn(value);
  need(reviewedReturn.completion !== null,
    'Complete this return in Returned procedures, then open its complete review JSON here.');
  const result = applyOperatingPlanReturn(reviewedReturn, { current: reviewedReturn.current });
  need(sameValue(result.review, reviewedReturn), 'Retain the complete original completed review.');
  return { plan: inspectOperatingPlan(reviewedReturn.completion.plan), reviewedReturn };
}
function validateReviewOrigin(value, prepared) {
  const result = grantOperatingReturnInput(value);
  need(result.reviewedReturn, 'Retain the complete original reconciliation review.');
  receiveOperatingPlan(result.reviewedReturn.current, prepared.plan);
  receiveOperatingPlan(result.plan, prepared.plan);
  return result;
}
function validateReviewedReturns(prepared) {
  if (prepared.reviewedReturns === undefined) return;
  need(Array.isArray(prepared.reviewedReturns), 'Retain the complete received reconciliation reviews.');
  const ids = new Set(), current = inspectOperatingPlan(prepared.continuation?.plan ?? prepared.plan);
  for (const entry of prepared.reviewedReturns) {
    need(plain(entry) && entry.schema === GRANT_OPERATING_REVIEW_RECEIPT_SCHEMA,
      'Retain the original completed-review receiving entry.');
    receivingTime(entry.at); text(entry.filename, 'Returned review filename', 300);
    text(entry.note, 'Reviewed procedure receiving note');
    const returned = validateReviewOrigin(entry.review, prepared);
    need(!ids.has(returned.reviewedReturn.id), 'Retain each complete reconciliation review once.');
    ids.add(returned.reviewedReturn.id);
    need(entry.resultRevision === returned.plan.revisions.length,
      'Keep the review result revision separately from later customer work.');
    const applied = applyOperatingPlanReturn(returned.reviewedReturn, { current });
    need(applied.alreadyPresent, 'Keep the completed review result in the selected original history.');
  }
}
function validateContinuation(prepared) {
  validateReviewedReturns(prepared);
  if (prepared.continuation === undefined) return;
  const value = prepared.continuation;
  need(plain(value) && value.schema === GRANT_OPERATING_CONTINUATION_SCHEMA &&
    Array.isArray(value.receipts) && value.receipts.length > 0, 'Retain the complete customer procedure continuation.');
  const received = receiveOperatingPlan(value.plan, prepared.plan);
  need(received.plan.revisions.length === value.plan.revisions.length,
    'The customer continuation must retain the whole prepared procedure.');
  let previous = prepared.plan.revisions.length;
  for (const receipt of value.receipts) {
    need(plain(receipt), 'Retain each original procedure receiving entry.');
    receivingTime(receipt.at); text(receipt.filename, 'Returned procedure filename', 300);
    text(receipt.note, 'Procedure receiving note');
    need(receipt.fromRevision === previous && Number.isSafeInteger(receipt.toRevision) &&
      receipt.toRevision > previous && receipt.toRevision <= value.plan.revisions.length,
    'Retain the ordered complete customer procedure revisions with their receiving entries.');
    previous = receipt.toRevision;
  }
  need(previous === value.plan.revisions.length, 'Keep the selected procedure revision with its original receiving entry.');
}
/** The original preparation stays intact; later work uses the received whole history. */
export function grantOperatingContinuationPlan(prepared) {
  need(prepared?.schema === GRANT_OPERATING_PREPARATION_SCHEMA, 'Choose a retained grant operating preparation.');
  inspectOperatingPlan(prepared.plan); validateContinuation(prepared);
  return inspectOperatingPlan(prepared.continuation?.plan ?? prepared.plan);
}
function returnContext(source, review, incoming) {
  validatePlanSources([source]); validatePlanningState(review, [source]);
  const selection = grantOperatingSelectionOf(review, source), receivedInput = grantOperatingReturnInput(incoming);
  const received = receivedInput.plan, reviewedReturn = receivedInput.reviewedReturn;
  const index = selection.prepared.findIndex(item => item.plan.id === received.id);
  need(index >= 0, 'Open the original native planning review containing this prepared operating-plan identity.');
  const prepared = selection.prepared[index], native = selectedPlan([source], review).plan;
  const summary = planSummary(source, native.revision, prepared.packageIds);
  const orderedIds = summary.tranches.flatMap(tranche => tranche.costs.map(cost => cost.id));
  need(sameValue(prepared.packageIds, orderedIds), 'Retain the original native package order for this prepared procedure.');
  const basis = { filename: source.filename, sha256: source.sha256, bytes: source.bytes,
    planId: native.id, planName: native.name, revision: native.revision, contentSha256: native.contentSha256,
    scenarioSourceSha256: native.source.sha256, scenarioCalculationSha256: native.report.scenarioSha256 };
  const totals = { plannedUsd: summary.amount, estimatedHours: summary.hours,
    awardRequestUsd: summary.award, projectEndDay: summary.duration };
  need(sameValue(prepared.source, basis) && sameValue(prepared.totals, totals),
    'Receive customer work against the complete original native preparation and its selected totals.');
  if (reviewedReturn) validateReviewOrigin(reviewedReturn, prepared);
  const retainedReview = reviewedReturn ? (prepared.reviewedReturns ?? []).find(entry => entry.review.id === reviewedReturn.id) : null;
  need(!retainedReview || sameValue(retainedReview.review, reviewedReturn),
    'A different completed review already uses this identity. Keep its original source and prepare a new review.');
  const original = prepared.plan.revisions.at(-1), existing = grantOperatingContinuationPlan(prepared);
  const merged = receiveOperatingPlan(received, existing);
  const packages = prepared.packageIds.map(packageId => {
    const position = native.scenario.future_costs.findIndex(cost => cost.id === packageId);
    const cost = native.scenario.future_costs[position], stepId = 'native-package-' + (position + 1);
    const baseline = original.steps.find(step => step.id === stepId);
    need(baseline && baseline.instruction === cost.remaining_work && baseline.expectedResult === cost.measurable_proof,
      'Retain the prepared native work and completion measure for package ' + packageId + '.');
    return { packageId, stepId, native: copy(cost), original: copy(baseline) };
  });
  return { selection, index, prepared, received, reviewedReturn, retainedReview, existing, merged, packages };
}
/** Inspect the whole incoming history before receiving it into the original planning review. */
export function compareGrantOperatingReturn(source, review, incoming) {
  const context = returnContext(source, review, incoming);
  const { prepared, received, existing, merged } = context;
  const original = prepared.plan.revisions.at(-1), previous = existing.revisions.at(-1), next = received.revisions.at(-1);
  const packages = context.packages.map(item => {
    const before = previous.steps.find(step => step.id === item.stepId) ?? null;
    const returned = next.steps.find(step => step.id === item.stepId) ?? null;
    return { ...item, previous: copy(before), returned: copy(returned), status: returned?.status ?? 'missing',
      filesFromPrepared: compareOperatingFiles(item.original.files ?? [], returned?.files ?? []),
      filesFromPrevious: compareOperatingFiles(before?.files ?? [], returned?.files ?? []),
      changedFromPrepared: STEP_COMPARISON_FIELDS.filter(field => !sameValue(item.original[field], returned?.[field])),
      changedFromPrevious: STEP_COMPARISON_FIELDS.filter(field => !sameValue(before?.[field], returned?.[field])) };
  });
  const originalIds = new Set(packages.map(item => item.stepId));
  return { schema: GRANT_OPERATING_RETURN_COMPARISON_SCHEMA,
    planId: prepared.plan.id, source: copy(prepared.source), packageIds: copy(prepared.packageIds), totals: copy(prepared.totals),
    preparedRevision: prepared.plan.revisions.length, previousRevision: existing.revisions.length,
    incomingRevision: received.revisions.length, selectedRevision: merged.plan.revisions.length,
    addedRevisions: merged.addedRevisions, reused: merged.reused,
    reviewedReturn: context.reviewedReturn ? {
      id: context.reviewedReturn.id, reviewer: context.reviewedReturn.reviewer,
      notes: context.reviewedReturn.notes, completedAt: context.reviewedReturn.completion.savedAt,
      currentRevision: context.reviewedReturn.current.revisions.length,
      incomingRevision: context.reviewedReturn.incoming.revisions.length,
      resultRevision: received.revisions.length, decisions: context.reviewedReturn.decisions.length,
      retained: !!context.retainedReview,
    } : null,
    originalTitle: original.title, previousTitle: previous.title, incomingTitle: next.title,
    planChanges: PLAN_COMPARISON_FIELDS.filter(field => !sameValue(previous[field], next[field])).map(field =>
      ({ field, original: copy(original[field]), previous: copy(previous[field]), returned: copy(next[field]) })),
    stepOrder: {
      prepared: original.steps.map((step, index) => ({ id: step.id, title: step.title, position: index + 1 })),
      previous: previous.steps.map((step, index) => ({ id: step.id, title: step.title, position: index + 1 })),
      returned: next.steps.map((step, index) => ({ id: step.id, title: step.title, position: index + 1 })),
      changedFromPrepared: !sameValue(original.steps.map(step => step.id), next.steps.map(step => step.id)),
      changedFromPrevious: !sameValue(previous.steps.map(step => step.id), next.steps.map(step => step.id)),
      addedIds: next.steps.filter(step => !previous.steps.some(old => old.id === step.id)).map(step => step.id),
      removedIds: previous.steps.filter(step => !next.steps.some(row => row.id === step.id)).map(step => step.id),
    },
    packages, additionalSteps: copy(next.steps.filter(step => !originalIds.has(step.id))),
    counts: Object.fromEntries(['planned', 'in-progress', 'completed', 'skipped', 'missing'].map(status =>
      [status, packages.filter(item => item.status === status).length])) };
}
/** Receive original later revisions once, keeping the native plan and preparation intact. */
export function receiveGrantOperatingReturn(source, review, incoming, {
  at = new Date().toISOString(), filename = '', note, expectedRevision,
} = {}) {
  const returned = grantOperatingReturnInput(incoming);
  const pendingMatches = pending => !!pending &&
    sameValue(pending.reviewedReturn ?? pending.incoming, returned.reviewedReturn ?? returned.plan);
  if (note === undefined) note = pendingMatches(review.operatingSelection?.returnDraft)
    ? review.operatingSelection.returnDraft.note : '';
  receivingTime(at); text(filename, 'Returned procedure filename', 300); text(note, 'Procedure receiving note');
  const comparison = compareGrantOperatingReturn(source, review, incoming);
  if (expectedRevision !== undefined) need(Number.isSafeInteger(expectedRevision) &&
    expectedRevision === comparison.previousRevision, 'The procedure advanced after comparison. Reopen its current return before receiving.');
  const next = copy(review), selection = grantOperatingSelectionOf(next, source);
  const prepared = selection.prepared.find(item => item.plan.id === comparison.planId);
  if (!comparison.reused) {
    const current = grantOperatingContinuationPlan(prepared);
    const received = receiveOperatingPlan(returned.plan, current);
    prepared.continuation = { schema: GRANT_OPERATING_CONTINUATION_SCHEMA, plan: received.plan,
      receipts: [...copy(prepared.continuation?.receipts ?? []), {
        at, filename, note, fromRevision: comparison.previousRevision, toRevision: comparison.incomingRevision,
      }] };
  }
  const reviewAdded = !!returned.reviewedReturn && !comparison.reviewedReturn.retained;
  if (reviewAdded) {
    prepared.reviewedReturns = [...copy(prepared.reviewedReturns ?? []), {
      schema: GRANT_OPERATING_REVIEW_RECEIPT_SCHEMA, at, filename, note,
      resultRevision: returned.plan.revisions.length, review: copy(returned.reviewedReturn),
    }];
  }
  if (pendingMatches(selection.returnDraft)) selection.returnDraft = null;
  next.operatingSelection = validateGrantOperatingSelection(selection, source, next.revision);
  return { review: next, comparison, reused: comparison.reused && !reviewAdded,
    addedRevisions: comparison.addedRevisions, reviewAdded };
}

/** Keep the complete unfinished source and review in the original saved planning selection. */
export function stageGrantOperatingReturn(source, review, incoming, {
  filename = '', note = '', openedAt = new Date().toISOString(),
} = {}) {
  receivingTime(openedAt); text(filename, 'Returned procedure filename', 300); text(note, 'Procedure receiving note');
  const comparison = compareGrantOperatingReturn(source, review, incoming);
  const next = copy(review), selection = grantOperatingSelectionOf(next, source);
  const returned = grantOperatingReturnInput(incoming);
  selection.returnDraft = { schema: GRANT_OPERATING_RETURN_DRAFT_SCHEMA,
    sourceSha256: source.sha256, nativeRevision: review.revision, planId: comparison.planId,
    incoming: returned.plan,
    ...(returned.reviewedReturn ? { reviewedReturn: returned.reviewedReturn } : {}),
    filename, note, openedAt,
    comparedRevision: comparison.previousRevision };
  next.operatingSelection = validateGrantOperatingSelection(selection, source, next.revision);
  return { review: next, comparison };
}
export function refreshGrantOperatingReturn(source, review) {
  const next = copy(review), selection = grantOperatingSelectionOf(next, source);
  need(selection.returnDraft, 'Open a retained customer return first.');
  const comparison = compareGrantOperatingReturn(source, next, selection.returnDraft.reviewedReturn ?? selection.returnDraft.incoming);
  selection.returnDraft.comparedRevision = comparison.previousRevision;
  next.operatingSelection = validateGrantOperatingSelection(selection, source, next.revision);
  return { review: next, comparison };
}
export function closeGrantOperatingReturn(source, review) {
  const next = copy(review), selection = grantOperatingSelectionOf(next, source);
  selection.returnDraft = null; next.operatingSelection = selection;
  return next;
}
