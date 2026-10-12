// MIT. Review native SF47 planning editions inside the existing submission draft.
export const PLAN_SCHEMA = 'stellar-forge.sf47-planning.v1';
export const PLAN_SOURCE_SCHEMA = 'stellar-forge.grant-plan-source.v1';
export const PLAN_REVIEW_SCHEMA = 'stellar-forge.grant-plan-review.v1';
const hashPattern = /^[a-f0-9]{64}$/;
const copy = value => JSON.parse(JSON.stringify(value));
function need(value, message) { if (!value) throw new Error(message); }
function text(value, label) { need(typeof value === 'string', label + ' must be text.'); return value; }
function unique(values, label) { need(new Set(values).size === values.length, 'Retain unique ' + label + '.'); }
function integer(value, label, min = 1, max = 1000000) {
  need(Number.isSafeInteger(value) && value >= min && value <= max, 'Retain the native ' + label + '.');
  return value;
}
/** Integer arithmetic keeps the native two-decimal USD amounts exact. */
export function cents(value, label = 'USD amount') {
  const raw = String(value);
  need(/^\d+(?:\.\d{1,2})?$/.test(raw) && raw.length < 30, label + ' needs an exact nonnegative USD amount.');
  const [whole, fraction = ''] = raw.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}
export function decimalUsd(value) {
  const amount = typeof value === 'bigint' ? value : cents(value);
  return (amount / 100n).toString() + '.' + (amount % 100n).toString().padStart(2, '0');
}
export function usd(value) {
  const [whole, fraction] = decimalUsd(value).split('.');
  return '$' + whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + fraction;
}
function decimal(value, label) {
  const raw = String(value);
  need(/^\d+(?:\.\d+)?$/.test(raw) && raw.length < 40, 'Retain the native ' + label + '.');
  return raw;
}
function addDecimals(values) {
  const parts = values.map(value => decimal(value, 'hours').split('.'));
  const places = Math.max(0, ...parts.map(x => (x[1] || '').length));
  const divisor = 10n ** BigInt(places);
  const total = parts.reduce((sum, [a, b = '']) => sum + BigInt(a) * divisor + BigInt(b.padEnd(places, '0') || '0'), 0n);
  if (!places) return total.toString();
  return ((total / divisor).toString() + '.' + (total % divisor).toString().padStart(places, '0')).replace(/\.?0+$/, '');
}
export function validatePlanRevision(plan) {
  need(plan && typeof plan === 'object', 'Open the complete saved SF47 plan.');
  for (const key of ['id', 'name', 'savedAt', 'contentSha256']) text(plan[key], 'Plan ' + key);
  need(plan.id && hashPattern.test(plan.contentSha256), 'Retain the native plan identity.');
  integer(plan.revision, 'plan revision');
  need(Number.isFinite(Date.parse(plan.savedAt)), 'Retain the native save date.');
  need(hashPattern.test(plan.source?.sha256), 'Retain the original scenario source identity.');
  const scenario = plan.scenario, report = plan.report;
  need(scenario && plan.planning && report?.schema === PLAN_SCHEMA, 'Use show --part all or the complete SF47 planning ZIP.');
  const award = cents(scenario.award_request_usd, 'Requested award');
  need(award > 0n, 'Retain the positive requested award.');
  integer(scenario.project_end_day, 'project duration', 1, 180);
  need(Array.isArray(scenario.milestones) && scenario.milestones.length === 3 &&
    scenario.milestones.every((x, i) => x.tranche === i + 1), 'Retain all three ordered native tranches.');
  let previousDay = 0;
  for (const milestone of scenario.milestones) {
    integer(milestone.submit_day, 'tranche submission day', 1, scenario.project_end_day);
    need(milestone.submit_day > previousDay, 'Keep the original ordered tranche dates.');
    previousDay = milestone.submit_day;
    text(milestone.deliverable, 'Tranche deliverable'); text(milestone.measurable_proof, 'Tranche completion measure');
  }
  const costs = scenario.future_costs;
  need(Array.isArray(costs) && costs.length > 0 && costs.length <= 1000, 'Retain the native future work packages.');
  unique(costs.map(x => x.id), 'work package identities');
  let total = 0n;
  for (const cost of costs) {
    need(typeof cost.id === 'string' && cost.id, 'Retain the work package identity.');
    integer(cost.tranche, 'work package tranche', 1, 3);
    integer(cost.start_day, 'work start day', 1, scenario.project_end_day);
    integer(cost.end_day, 'work end day', cost.start_day, scenario.milestones[cost.tranche - 1].submit_day);
    need(cost.future_only === true, 'Keep the original future development cost selection.');
    for (const key of ['category', 'remaining_work', 'measurable_proof']) text(cost[key], 'Work package ' + key);
    const amount = cents(cost.amount_usd);
    need(amount > 0n, 'Retain the positive native work package price.'); total += amount;
    if (cost.estimated_hours !== undefined && cost.estimated_hours !== null) decimal(cost.estimated_hours, 'estimated hours');
    if (cost.assumed_hourly_rate_usd !== undefined && cost.assumed_hourly_rate_usd !== null) decimal(cost.assumed_hourly_rate_usd, 'hourly rate');
  }
  need(total === award, 'The native work package total must equal its requested award. Reopen the complete saved plan.');
  need(report.originalModel && cents(report.originalModel.award_request_usd) === award &&
    cents(report.originalModel.planned_future_costs_usd) === total, 'Retain the matching native budget calculation.');
  const payouts = report.originalModel.payouts;
  need(Array.isArray(payouts) && payouts.length === 4 && payouts.every((x, i) => x.tranche === i),
    'Retain the four conditional payments from the native calculator.');
  need(payouts.reduce((sum, x) => sum + cents(x.usd), 0n) === award, 'Retain the complete native payment allocation.');
  for (const payout of payouts) text(payout.release_condition, 'Native payment condition');
  need(hashPattern.test(report.scenarioSha256), 'Retain the scenario calculation identity.');
  return plan;
}
export function validatePlanDocument(document) {
  need(document && Array.isArray(document.revisions) && document.revisions.length > 0, 'Retain the complete received plan edition.');
  text(document.id, 'Native plan identity'); text(document.name, 'Native plan name');
  unique(document.revisions.map(x => x.revision), 'native revisions');
  for (const plan of document.revisions) {
    validatePlanRevision(plan);
    need(plan.id === document.id, 'Keep revisions attached to their original native plan.');
  }
  need(document.revisions.some(x => x.revision === document.currentRevision), 'Retain the current received plan revision.');
  return document;
}
export function validatePlanSources(sources = []) {
  need(Array.isArray(sources), 'Retain the received planning sources.');
  unique(sources.map(x => x.sha256), 'planning source identities');
  for (const source of sources) {
    need(source?.schema === PLAN_SOURCE_SCHEMA && hashPattern.test(source.sha256), 'Retain the original planning file identity.');
    need(['json', 'zip'].includes(source.kind), 'Retain the original planning file format.');
    text(source.filename, 'Planning filename'); text(source.receivedAt, 'Plan acquisition date');
    need(source.filename && Number.isFinite(Date.parse(source.receivedAt)), 'Retain the planning filename and acquisition date.');
    integer(source.bytes, 'complete planning file length', 1, 32 * 1024 * 1024);
    text(source.base64, 'Complete original planning bytes');
    need(source.base64.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(source.base64),
      'Retain complete base64 planning bytes.');
    const length = source.base64.length / 4 * 3 - (source.base64.endsWith('==') ? 2 : source.base64.endsWith('=') ? 1 : 0);
    need(length === source.bytes, 'Retain every original planning byte.');
    validatePlanDocument(source.document);
  }
  return sources;
}
export function selectedPlan(sources, review) {
  const source = sources.find(x => x.sha256 === review?.sourceSha);
  need(source, 'Select a retained original planning file.');
  const plan = source.document.revisions.find(x => x.revision === review.revision);
  need(plan, 'Select a retained native revision.');
  return {source, plan};
}
export function newPlanReview(source, revision = source.document.currentRevision) {
  const plan = source.document.revisions.find(x => x.revision === revision);
  need(plan, 'Select a received native plan revision.');
  return {
    schema: PLAN_REVIEW_SCHEMA, sourceSha: source.sha256, revision,
    costIds: plan.scenario.future_costs.map(x => x.id),
    note: '', previewText: '', previewBasis: '', summaryReviewed: false, applications: [],
  };
}
export function validatePlanningState(review, sources = []) {
  if (review === undefined || review === null) return;
  need(review.schema === PLAN_REVIEW_SCHEMA, 'Retain the selected planning review.');
  const {plan} = selectedPlan(sources, review), costIds = plan.scenario.future_costs.map(x => x.id);
  for (const key of ['costIds', 'applications']) need(Array.isArray(review[key]), 'Retain planning ' + key + '.');
  unique(review.costIds, 'selected work packages');
  need(review.costIds.every(x => costIds.includes(x)), 'Review packages from this exact planning edition.');
  for (const key of ['note', 'previewText', 'previewBasis']) text(review[key], 'Plan review ' + key);
  need(typeof review.summaryReviewed === 'boolean', 'Keep the explicit budget review selection.');
  for (const application of review.applications) {
    for (const key of ['at', 'kind', 'id', 'mode', 'text', 'basis']) text(application[key], 'Applied plan ' + key);
    need(['answer', 'field'].includes(application.kind) && ['replace', 'append'].includes(application.mode),
      'Retain the original plan application target.');
  }
}
export function planSummary(source, revision, costIds = null) {
  const plan = source.document.revisions.find(x => x.revision === revision);
  need(plan, 'Select the retained native revision.');
  const original = plan.scenario.future_costs;
  const ids = costIds === null ? original.map(x => x.id) : costIds;
  unique(ids, 'selected work packages');
  need(ids.every(id => original.some(x => x.id === id)), 'Select original work packages.');
  const costs = original.filter(x => ids.includes(x.id));
  const total = costs.reduce((sum, x) => sum + cents(x.amount_usd), 0n);
  const hours = costs.every(x => x.estimated_hours !== undefined && x.estimated_hours !== null) ?
    addDecimals(costs.map(x => x.estimated_hours)) : null;
  const tranches = plan.scenario.milestones.map(milestone => {
    const selected = costs.filter(x => x.tranche === milestone.tranche);
    return {milestone, costs: selected, amount: decimalUsd(selected.reduce((sum, x) => sum + cents(x.amount_usd), 0n)),
      note: plan.planning.deliveryNotes?.[String(milestone.tranche)] || ''};
  });
  return {plan, costs, tranches, amount: decimalUsd(total), award: decimalUsd(plan.scenario.award_request_usd),
    hours, allSelected: costs.length === original.length, duration: plan.scenario.project_end_day,
    payouts: plan.report.originalModel.payouts, cash: plan.report.cash, capacity: plan.report.capacity,
    lagComparisons: plan.report.lagComparisons || []};
}
export function reviewBasis(review) {
  return JSON.stringify({sourceSha: review.sourceSha, revision: review.revision, costIds: review.costIds});
}
export function composePlan(source, review) {
  const summary = planSummary(source, review.revision, review.costIds);
  need(summary.costs.length, 'Select at least one native work package.');
  const lines = [
    summary.allSelected ? 'Requested award: ' + usd(summary.award) + ' USD.' :
      'Selected work packages: ' + usd(summary.amount) + ' USD of the native plan’s ' + usd(summary.award) + ' USD requested award.',
    'Future development scope: ' + summary.costs.length + ' priced work packages' +
      (summary.hours === null ? '.' : ' totaling ' + summary.hours + ' estimated hours.'),
    'Planned completion: day ' + summary.duration + ' from the plan’s award-acceptance day zero. These relative days describe the selected planning schedule.',
  ];
  for (const tranche of summary.tranches) {
    if (!tranche.costs.length) continue;
    const milestone = tranche.milestone;
    lines.push('', '### Tranche ' + milestone.tranche + ': ' + milestone.deliverable,
      'Development cost: ' + usd(tranche.amount) + ' USD. Planned submission: day ' + milestone.submit_day + '.',
      'Completion assessment: ' + milestone.measurable_proof);
    for (const cost of tranche.costs) {
      const hours = cost.estimated_hours !== undefined && cost.estimated_hours !== null ?
        ' ' + cost.estimated_hours + ' estimated hours' + (cost.assumed_hourly_rate_usd !== undefined && cost.assumed_hourly_rate_usd !== null ?
          ' at an assumed $' + cost.assumed_hourly_rate_usd + ' USD/hour' : '') + '.' : '';
      lines.push('', '- ' + cost.remaining_work,
        '  Price: ' + usd(cost.amount_usd) + ' USD.' + hours + ' Work window: days ' + cost.start_day + '–' + cost.end_day + '.',
        '  Completion assessment: ' + cost.measurable_proof);
    }
    if (tranche.note.trim()) lines.push('', tranche.note.trim());
  }
  if (summary.allSelected) {
    lines.push('', '### Conditional grant payments',
      'The native plan allocates the requested award to the following conditional payments. Delivery costs above describe the engineering work within each tranche.');
    for (const payout of summary.payouts) lines.push('- ' + (payout.tranche === 0 ? 'Initial allocation' : 'After tranche ' + payout.tranche) +
      ': ' + usd(payout.usd) + ' USD. ' + payout.release_condition);
  }
  return lines.join('\n').trim();
}
export function preparedReview(source, review) {
  const result = copy(review);
  result.previewText = composePlan(source, result);
  result.previewBasis = reviewBasis(result);
  result.summaryReviewed = false;
  return result;
}
export function planningReadiness(source, review, {kind = 'answer'} = {}) {
  const summary = planSummary(source, review.revision, review.costIds), issues = [];
  if (!summary.costs.length) issues.push('Select the native work packages to include.');
  if (kind === 'answer' && !summary.allSelected) issues.push('Use all work packages for the complete Delivery answer, or apply selected packages to an issuer field.');
  if (!review.previewText.trim() || review.previewBasis !== reviewBasis(review)) issues.push('Prepare the preview for the current source revision and package selection.');
  if (!review.summaryReviewed) issues.push('Review the exact preview before applying it.');
  return {summary, issues};
}
/** The caller retains a full submission version before this mutation. */
export function applyPlanReview(draft, {kind, id, mode = 'replace', now = new Date().toISOString()}) {
  need(['answer', 'field'].includes(kind) && ['replace', 'append'].includes(mode), 'Select the draft target and application mode.');
  const review = draft.planningReview;
  validatePlanningState(review, draft.planSources || []);
  const {source} = selectedPlan(draft.planSources || [], review);
  const readiness = planningReadiness(source, review, {kind});
  need(readiness.issues.length === 0, readiness.issues.join(' '));
  if (kind === 'answer') need(id === 'delivery', 'Apply the complete plan to the existing Delivery answer.');
  const target = (kind === 'answer' ? draft.answers : draft.fields).find(x => x.id === id);
  need(target, 'Select an existing draft answer or issuer field.');
  target.text = mode === 'append' && target.text.trim() ? target.text.trimEnd() + '\n\n' + review.previewText : review.previewText;
  review.applications.push({at: now, kind, id, mode, text: review.previewText, basis: review.previewBasis});
  draft.updatedAt = now;
  return draft;
}
