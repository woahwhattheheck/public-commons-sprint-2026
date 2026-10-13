// MIT. Review returned customer procedures against their complete original saved history.
import { inspectOperatingPlan, operatingPlanDraft, saveOperatingPlanRevision,
  renderOperatingPlanMarkdown, receiveOperatingPlan, inspectOperatingFile } from './operating-plan.mjs';

export const OPERATING_RETURN_SCHEMA = 'stellar-forge.operating-plan-return.v1';
export const OPERATING_RETURN_COMPARISON_SCHEMA = 'stellar-forge.operating-plan-return-comparison.v1';
export const OPERATING_RETURN_MAX_BYTES = 128 * 1024 * 1024;
export const OPERATING_RETURN_PLAN_MAX_BYTES = 32 * 1024 * 1024;
export const OPERATING_RETURN_CHOICES = Object.freeze(['current', 'incoming', 'base', 'custom']);
const PLAN_FIELDS = ['title', 'customer', 'purpose', 'period', 'owner', 'receiving', 'notes'];
const STEP_FIELDS = ['title', 'instruction', 'inputs', 'expectedResult', 'owner', 'due', 'files'];
const WORK_FIELDS = ['title', 'instruction', 'inputs', 'expectedResult', 'argv', 'selection'];
const RESULT_FIELDS = ['status', 'recordedResult'];
const progress = (value, version) => version === 2
  ? { status: value.status, recordedResult: value.recordedResult,
      files: Object.hasOwn(value, 'files') ? clone(value.files) : null }
  : pick(value, RESULT_FIELDS);
const pick = (value, keys) => Object.fromEntries(keys.map(key => [key, value[key]]));
const resultChanged = (left, right, version) =>
  !same(progress(left, version), progress(right, version)) ||
  (version === 'current' && !same(left.files ?? [], right.files ?? []));
const ORDER_KEY = '/steps/@order';
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = value => JSON.parse(JSON.stringify(value));
const canonical = value => Array.isArray(value) ? value.map(canonical) : plain(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
const fail = (code, message) => { const error = new TypeError(message); error.code = code; throw error; };
const need = (condition, code, message) => { if (!condition) fail(code, message); };
const only = (value, keys, field) => need(plain(value) && Object.keys(value).every(key => keys.includes(key)),
  'RETURN_FIELDS_INVALID', field + ' contains unsupported fields.');
function text(value, field, maximum = 32000) {
  need(typeof value === 'string' && value.length <= maximum && !value.includes('\u0000'),
    'RETURN_TEXT_INVALID', field + ' must be text up to ' + maximum + ' characters without NUL.');
}
function identity(value, field) {
  need(typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value),
    'RETURN_ID_INVALID', field + ' must be 1–128 letters, numbers, dots, underscores or hyphens.');
}
function time(value) {
  need(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19),
  'RETURN_TIME_INVALID', 'Use a UTC ISO date and time.');
}
function size(value, maximum, field) {
  let encoded;
  try { encoded = JSON.stringify(value); } catch { fail('RETURN_JSON_INVALID', field + ' must be complete JSON.'); }
  need(typeof encoded === 'string' && new TextEncoder().encode(encoded).length <= maximum,
    'RETURN_TOO_LARGE', field + ' exceeds ' + Math.floor(maximum / 1024 / 1024) + ' MiB.');
}
function json(value, depth = 0) {
  need(depth <= 40, 'RETURN_VALUE_INVALID', 'A custom value is nested too deeply.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) { value.forEach(item => json(item, depth + 1)); return; }
  need(plain(value), 'RETURN_VALUE_INVALID', 'A custom choice must contain JSON values.');
  Object.values(value).forEach(item => json(item, depth + 1));
}
function sources(currentValue, incomingValue) {
  size(currentValue, OPERATING_RETURN_PLAN_MAX_BYTES, 'Current plan');
  size(incomingValue, OPERATING_RETURN_PLAN_MAX_BYTES, 'Returned plan');
  const current = inspectOperatingPlan(currentValue), incoming = inspectOperatingPlan(incomingValue);
  let relationship = 'same-plan';
  if (current.id === incoming.id) {
    need(current.createdAt === incoming.createdAt && same(current.origin, incoming.origin),
      'RETURN_ORIGIN_CONFLICT', 'The plans have different original identities.');
  } else {
    need(incoming.origin?.id === current.id && incoming.origin.createdAt === current.createdAt &&
      incoming.createdAt === current.createdAt, 'RETURN_ORIGIN_CONFLICT',
    'Choose the same original plan or a returned copy made directly from it.');
    relationship = 'returned-copy';
  }
  let shared = 0;
  while (shared < Math.min(current.revisions.length, incoming.revisions.length) &&
    same(current.revisions[shared], incoming.revisions[shared])) shared++;
  need(shared > 0, 'RETURN_ANCESTOR_MISSING', 'The complete plans must retain an identical first saved revision.');
  if (relationship === 'returned-copy') need(incoming.origin.revision <= incoming.revisions.length,
    'RETURN_COPY_HISTORY_CHANGED', 'The copy’s recorded origin revision must exist in its complete returned history.');
  return { current, incoming, relationship, shared,
    base: current.revisions[shared - 1],
    local: current.revisions.at(-1), returned: incoming.revisions.at(-1) };
}
const label = key => ({ title: 'Title', customer: 'Customer', purpose: 'Useful result', period: 'Period or recurrence',
  owner: 'Owner', receiving: 'Receiving and continuation', notes: 'Plan notes', instruction: 'Work',
  inputs: 'Inputs', expectedResult: 'Expected result', due: 'Due date', status: 'Recorded status',
  recordedResult: 'Recorded result', argv: 'Command arguments', selection: 'Complete registration selection' })[key] ?? key;
function row(key, kind, title, base, current, incoming, stepId = null) {
  if (same(base, current) && same(base, incoming)) return null;
  const automatic = same(current, incoming) ? 'current' : same(base, current) ? 'incoming' :
    same(base, incoming) ? 'current' : null;
  return { key, kind, label: title, stepId, base: clone(base), current: clone(current), incoming: clone(incoming),
    automatic, conflict: automatic === null };
}
function comparisons(source, version) {
  const rows = [];
  for (const field of PLAN_FIELDS) {
    const item = row('/' + field, 'plan-field', label(field), source.base[field], source.local[field], source.returned[field]);
    if (item) rows.push(item);
  }
  const maps = [source.base, source.local, source.returned].map(revision =>
    new Map(revision.steps.map(step => [step.id, step])));
  const ids = [...new Set([source.base, source.local, source.returned].flatMap(revision => revision.steps.map(step => step.id)))];
  for (const id of ids) {
    const [base, current, incoming] = maps.map(map => map.get(id) ?? null);
    const title = (current ?? incoming ?? base).title;
    if (!base || !current || !incoming) {
      const item = row('/steps/' + id, 'step-presence', title + ' · complete step', base, current, incoming, id);
      if (item) rows.push(item);
    } else {
      const currentWork = pick(current, WORK_FIELDS), incomingWork = pick(incoming, WORK_FIELDS);
      const crossedResult = !same(currentWork, incomingWork) &&
        ((!same(currentWork, pick(base, WORK_FIELDS)) && resultChanged(incoming, base, version)) ||
         (!same(incomingWork, pick(base, WORK_FIELDS)) && resultChanged(current, base, version)));
      if (crossedResult) {
        const item = row('/steps/' + id, 'step-context', title + ' · work and recorded results', base, current, incoming, id);
        item.automatic = null; item.conflict = true;
        item.reason = 'The work changed on one branch while recorded progress or results changed on the other. Review the complete step before carrying results onto different work.';
        rows.push(item);
      } else {
        // The maintained unversioned format compares files separately. Version 2
        // groups files with progress; the original legacy format has no file row.
        for (const field of version === 'current' ? STEP_FIELDS : STEP_FIELDS.filter(key => key !== 'files')) {
          const item = row('/steps/' + id + '/' + field, 'step-field', title + ' · ' + label(field),
            field === 'files' ? base.files ?? [] : base[field],
            field === 'files' ? current.files ?? [] : current[field],
            field === 'files' ? incoming.files ?? [] : incoming[field], id);
          if (item) rows.push(item);
        }
        const item = row('/steps/' + id + '/@command', 'step-command', title + ' · registration and command arguments',
          pick(base, ['selection', 'argv']), pick(current, ['selection', 'argv']), pick(incoming, ['selection', 'argv']), id);
        if (item) rows.push(item);
        const result = row('/steps/' + id + '/@progress', 'step-progress',
          title + (version === 2 ? ' · recorded progress, result and files' : ' · recorded progress and result'),
          progress(base, version), progress(current, version), progress(incoming, version), id);
        if (result) rows.push(result);
      }
    }
  }
  const order = row(ORDER_KEY, 'step-order', 'Complete operating order',
    source.base.steps.map(step => step.id), source.local.steps.map(step => step.id), source.returned.steps.map(step => step.id));
  if (order) rows.push(order);
  return { rows, ids, maps };
}
function validateDecision(value, keys) {
  only(value, ['key', 'take', 'value', 'note', 'order'], 'Review decision');
  need(typeof value.key === 'string' && keys.has(value.key), 'RETURN_DECISION_MISSING',
    'A review decision must refer to a displayed change in these exact source plans.');
  need(OPERATING_RETURN_CHOICES.includes(value.take), 'RETURN_CHOICE_INVALID',
    'Choose current, incoming, base or a custom value.');
  text(value.note, 'Decision note');
  need(Object.hasOwn(value, 'value') === (value.take === 'custom'), 'RETURN_CUSTOM_VALUE',
    'Only a custom choice carries an explicit value.');
  if (value.take === 'custom') json(value.value);
  const ordered = value.key === ORDER_KEY && value.take !== 'custom';
  need(Object.hasOwn(value, 'order') === ordered, 'RETURN_ORDER_CHOICE',
    'A source order choice must retain the exact reviewed sequence.');
  if (ordered) need(Array.isArray(value.order) && value.order.length <= 3000 &&
    value.order.every(id => typeof id === 'string') && new Set(value.order).size === value.order.length,
  'RETURN_ORDER_CHOICE', 'Keep each selected step ID once in the reviewed order.');
}
function recordMode(value, version) {
  only(value, ['schema', 'id', 'createdAt', 'current', 'incoming', 'reviewer', 'notes', 'decisions', 'completion', 'reportingVersion'], 'Returned-plan review');
  need(value.schema === OPERATING_RETURN_SCHEMA, 'RETURN_SCHEMA_INVALID', 'Choose a complete operating-plan return review.');
  need(value.reportingVersion === undefined || value.reportingVersion === 2,
    'RETURN_REPORTING_VERSION', 'Keep the original review comparison version.');
  identity(value.id, 'Review ID'); time(value.createdAt);
  text(value.reviewer, 'Reviewing operator', 1000); text(value.notes, 'Review notes');
  size(value, OPERATING_RETURN_MAX_BYTES, 'Complete return review');
  const source = sources(value.current, value.incoming), compared = comparisons(source, version);
  const keys = new Set(compared.rows.map(item => item.key));
  need(Array.isArray(value.decisions) && value.decisions.length <= keys.size,
    'RETURN_DECISIONS_INVALID', 'Keep one decision for each selected change.');
  value.decisions.forEach(decision => validateDecision(decision, keys));
  need(new Set(value.decisions.map(decision => decision.key)).size === value.decisions.length,
    'RETURN_DECISION_DUPLICATE', 'A change may have one current review decision.');
  need(value.completion === null || plain(value.completion), 'RETURN_COMPLETION_INVALID',
    'The review completion must be a complete saved result or null.');
  return { value: clone(value), source, compared };
}
function record(value) {
  if (value?.reportingVersion !== undefined) return recordMode(value, value.reportingVersion);
  // Unfinished unversioned reviews keep the maintained separate-file comparison
  // when it preserves every explicit decision. Completed records must reproduce
  // their complete saved result. The original interpretation remains available
  // for older decisions or results that the later comparison cannot reproduce.
  let currentError;
  try {
    const parsed = recordMode(value, 'current');
    validateCompletion(parsed);
    return parsed;
  } catch (error) { currentError = error; }
  try {
    const parsed = recordMode(value, 'legacy');
    validateCompletion(parsed);
    return parsed;
  } catch { throw currentError; }
}
function choiceValue(item, decision) {
  const take = decision?.take ?? item.automatic ?? 'current';
  return { take, value: clone(take === 'custom' ? decision.value : item[take]),
    reviewed: Boolean(decision), note: decision?.note ?? '' };
}
function completeOrder(order, sourceOrders, selected) {
  const included = new Set(selected), output = [];
  for (const id of [...order, ...sourceOrders.flat()]) if (included.has(id) && !output.includes(id)) output.push(id);
  return output;
}
function project(parsed) {
  const { value, source, compared } = parsed;
  const decisions = new Map(value.decisions.map(decision => [decision.key, decision]));
  const changed = new Map(compared.rows.map(item => [item.key, item]));
  const draft = operatingPlanDraft(source.current), unresolved = [], issues = [];
  const rendered = new Map();
  for (const item of compared.rows) {
    const selected = choiceValue(item, decisions.get(item.key));
    if (item.conflict && !selected.reviewed) unresolved.push(item.key);
    rendered.set(item.key, { ...clone(item), ...selected });
  }
  for (const field of PLAN_FIELDS) if (rendered.has('/' + field)) draft.content[field] = clone(rendered.get('/' + field).value);
  const steps = [];
  for (const id of compared.ids) {
    const presence = rendered.get('/steps/' + id);
    let step;
    if (presence) step = clone(presence.value);
    else {
      step = clone(compared.maps[1].get(id) ?? null);
      if (step) {
        for (const field of STEP_FIELDS) if (rendered.has('/steps/' + id + '/' + field))
          step[field] = clone(rendered.get('/steps/' + id + '/' + field).value);
        for (const [suffix, fields] of [['@command', ['selection', 'argv']],
          ['@progress', value.reportingVersion === 2 ? [...RESULT_FIELDS, 'files'] : RESULT_FIELDS]]) {
          const grouped = rendered.get('/steps/' + id + '/' + suffix);
          if (grouped) {
            if (!plain(grouped.value) || fields.some(field => !Object.hasOwn(grouped.value, field)) ||
              Object.keys(grouped.value).length !== fields.length)
              issues.push({ key: grouped.key, message: 'Keep ' + fields.join(' and ') + ' together in this complete choice.' });
            else for (const field of fields) {
              if (field === 'files' && grouped.value.files === null) delete step.files;
              else step[field] = clone(grouped.value[field]);
            }
          }
        }
      }
    }
    if (step === null) continue;
    if (!plain(step) || step.id !== id) {
      issues.push({ key: '/steps/' + id, message: 'A selected complete step must retain its original step ID, or be null to remove it.' });
      continue;
    }
    steps.push(step);
  }
  const byId = new Map(steps.map(step => [step.id, step]));
  const sourceOrders = [source.local, source.returned, source.base].map(revision => revision.steps.map(step => step.id));
  let order = completeOrder(sourceOrders[0], sourceOrders, [...byId.keys()]);
  const orderRow = rendered.get(ORDER_KEY);
  if (orderRow) {
    const decision = decisions.get(ORDER_KEY);
    const alternatives = Object.fromEntries(['base', 'current', 'incoming'].map(key =>
      [key, completeOrder(orderRow[key], sourceOrders, [...byId.keys()])]));
    if (!decision && orderRow.automatic && [...byId.keys()].some(id => !orderRow[orderRow.automatic].includes(id))) {
      orderRow.conflict = true; orderRow.automatic = null;
      orderRow.reason = 'The selected steps include work absent from the proposed source order. Review its complete position before saving.';
      if (!unresolved.includes(ORDER_KEY)) unresolved.push(ORDER_KEY);
    }
    if (decision?.take === 'custom') {
      const custom = decision.value;
      if (!Array.isArray(custom) || custom.length !== byId.size || new Set(custom).size !== custom.length ||
        custom.some(id => typeof id !== 'string' || !byId.has(id))) {
        issues.push({ key: ORDER_KEY, message: 'A custom order must list every selected step ID exactly once. Revisit it after changing a step’s inclusion.' });
      } else order = [...custom];
    } else {
      order = alternatives[orderRow.take];
      if (decision && !same(decision.order, order)) {
        issues.push({ key: ORDER_KEY, message: 'The selected steps changed after this order was reviewed. Choose the complete order again.' });
        orderRow.stale = true; orderRow.reviewedOrder = clone(decision.order);
        if (!unresolved.includes(ORDER_KEY)) unresolved.push(ORDER_KEY);
      }
    }
    orderRow.value = [...order];
    orderRow.alternatives = alternatives;
  }
  draft.content.steps = order.map(id => byId.get(id));
  try {
    saveOperatingPlanRevision(source.current, draft, { savedAt: source.current.revisions.at(-1).savedAt });
  } catch (error) { issues.push({ key: '/content', message: (error.code ? error.code + ': ' : '') + error.message }); }
  if (!value.reviewer.trim()) issues.push({ key: '/reviewer', message: 'Name the operator reviewing this returned work.' });
  return { schema: OPERATING_RETURN_COMPARISON_SCHEMA, reviewId: value.id, planId: source.current.id,
    incomingPlanId: source.incoming.id, relationship: source.relationship, commonRevision: source.shared,
    currentRevision: source.current.revisions.length, incomingRevision: source.incoming.revisions.length,
    rows: [...rendered.values()], unresolved, issues, ready: unresolved.length === 0 && issues.length === 0,
    draft, summary: { changes: changed.size, conflicts: [...rendered.values()].filter(item => item.conflict).length,
      decisions: value.decisions.length, steps: steps.length, unresolved: unresolved.length } };
}
function resultPlan(parsed, proposal, savedAt) {
  // An unchanged forward history remains the exact original history, including intermediate revisions.
  if (parsed.source.relationship === 'same-plan' && parsed.source.shared === parsed.source.current.revisions.length &&
    same(proposal.draft.content, operatingPlanDraft(parsed.source.incoming).content))
    return receiveOperatingPlan(parsed.source.incoming, parsed.source.current).plan;
  return saveOperatingPlanRevision(parsed.source.current, proposal.draft, { savedAt });
}
function containsResult(actual, expected) {
  return actual.id === expected.id && actual.createdAt === expected.createdAt && same(actual.origin, expected.origin) &&
    actual.revisions.length >= expected.revisions.length &&
    expected.revisions.every((revision, index) => same(revision, actual.revisions[index]));
}
function validateCompletion(parsed) {
  const completion = parsed.value.completion;
  if (completion === null) return;
  only(completion, ['savedAt', 'plan'], 'Completed return review');
  time(completion.savedAt);
  const proposal = project(parsed);
  need(proposal.ready, 'RETURN_REVIEW_INCOMPLETE', 'A completed review must resolve every conflict and retain valid operating work.');
  const expected = resultPlan(parsed, proposal, completion.savedAt);
  size(expected, OPERATING_RETURN_PLAN_MAX_BYTES, 'Reviewed plan');
  need(same(inspectOperatingPlan(completion.plan), expected), 'RETURN_RESULT_CHANGED',
    'The completed plan differs from the original saver’s result for these retained sources and decisions.');
}
/** Validate both complete source plans, each decision and the exact result when completed. */
export function inspectOperatingPlanReturn(value) {
  const parsed = record(value); validateCompletion(parsed); return parsed.value;
}
export function createOperatingPlanReturn(current, incoming, {
  id, reviewer = '', notes = '', createdAt = new Date().toISOString(),
} = {}) {
  return inspectOperatingPlanReturn({ schema: OPERATING_RETURN_SCHEMA, reportingVersion: 2, id, createdAt,
    current, incoming, reviewer, notes, decisions: [], completion: null });
}
export function compareOperatingPlanReturn(value) {
  const parsed = record(value); validateCompletion(parsed); return project(parsed);
}
export function reviseOperatingPlanReturn(value, updates) {
  const saved = inspectOperatingPlanReturn(value);
  need(saved.completion === null, 'RETURN_ALREADY_COMPLETED', 'Keep the completed review and prepare a new review for later work.');
  only(updates, ['reviewer', 'notes'], 'Review details');
  return inspectOperatingPlanReturn({ ...saved, ...clone(updates) });
}
export function decideOperatingPlanReturn(value, key, decision = null) {
  const saved = inspectOperatingPlanReturn(value);
  need(saved.completion === null, 'RETURN_ALREADY_COMPLETED', 'Keep the completed review and prepare a new review for later work.');
  const keys = new Set(record(saved).compared.rows.map(item => item.key));
  need(keys.has(key), 'RETURN_DECISION_MISSING', 'Choose a displayed change in this return review.');
  const decisions = saved.decisions.filter(item => item.key !== key);
  if (decision !== null) {
    only(decision, ['take', 'value', 'note'], 'Selected review choice');
    const selected = { key, ...clone(decision), note: decision.note ?? '' };
    if (key === ORDER_KEY && selected.take !== 'custom' && OPERATING_RETURN_CHOICES.includes(selected.take)) {
      const proposal = project(record(saved));
      selected.order = clone(proposal.rows.find(item => item.key === ORDER_KEY).alternatives[selected.take]);
    }
    decisions.push(selected);
  }
  const order = new Map([...keys].map((item, index) => [item, index]));
  decisions.sort((left, right) => order.get(left.key) - order.get(right.key));
  return inspectOperatingPlanReturn({ ...saved, decisions });
}
/**
 * Compute a complete original-format result. An actual current plan is compared exactly.
 * Repeating a completed operation accepts its exact result or a complete later history that includes it.
 * Persist the returned review before writing result.plan through the destination's transaction.
 */
export function applyOperatingPlanReturn(value, {
  current = value?.current, savedAt = new Date().toISOString(),
} = {}) {
  const parsed = record(value); validateCompletion(parsed);
  const actual = inspectOperatingPlan(current);
  let review = parsed.value, plan = review.completion?.plan;
  if (!plan) {
    const proposal = project(parsed);
    need(proposal.ready, 'RETURN_REVIEW_INCOMPLETE',
      'Resolve every conflicting change, correct invalid values and name the reviewing operator before completing this return.');
    time(savedAt);
    plan = resultPlan(parsed, proposal, savedAt);
    size(plan, OPERATING_RETURN_PLAN_MAX_BYTES, 'Reviewed plan');
    review = inspectOperatingPlanReturn({ ...review, completion: { savedAt, plan } });
  }
  const alreadyPresent = containsResult(actual, plan);
  need(alreadyPresent || same(actual, review.current), 'RETURN_CURRENT_ADVANCED',
    'The destination plan changed. Keep this review, export its latest complete plan and prepare another comparison.');
  return { review, plan: clone(alreadyPresent ? actual : plan), alreadyPresent,
    addedRevisions: alreadyPresent ? 0 : plan.revisions.length - review.current.revisions.length,
    reviewedRevisions: plan.revisions.length - review.current.revisions.length };
}
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const display = value => typeof value === 'string' ? value : JSON.stringify(value, null, 2);
function renderReviewValue(value) {
  const carried = Array.isArray(value) ? value : plain(value) ? value.files : null;
  if (!Array.isArray(carried) || carried.length === 0)
    return '<pre>' + escapeHTML(display(value)) + '</pre>';
  let files;
  try { files = carried.map(inspectOperatingFile); }
  catch { return '<pre>' + escapeHTML(display(value)) + '</pre>'; }
  const summaries = files.map(({ content, ...file }) => file);
  const visible = Array.isArray(value) ? summaries : { ...value, files: summaries };
  return '<pre>' + escapeHTML(display(visible)) + '</pre><ul>' + files.map(file =>
    '<li><a download="' + escapeHTML(file.name) + '" href="data:application/octet-stream;base64,' +
    file.content + '">' + escapeHTML(file.name) + '</a> · ' + file.bytes + ' bytes · ' +
    escapeHTML(file.mediaType) + '</li>').join('') + '</ul>';
}
export function renderOperatingPlanReturnHTML(value) {
  const review = inspectOperatingPlanReturn(value), report = compareOperatingPlanReturn(review);
  const rows = report.rows.map(item => '<article><h2>' + escapeHTML(item.label) + '</h2><p>' +
    escapeHTML(item.key) + ' · ' + (item.conflict ? 'Conflicting changes' : 'Compatible changes') + '</p>' +
    (item.reason ? '<p class="text">' + escapeHTML(item.reason) + '</p>' : '') +
    (item.stale ? '<p>The included work changed after this order was reviewed. Choose its complete sequence again.</p><pre>' +
      escapeHTML(display(item.reviewedOrder)) + '</pre>' : '') +
    '<div class="values">' + [['base', 'Shared revision'], ['current', 'Current work'], ['incoming', 'Returned work']]
      .map(([key, title]) => '<section><h3>' + title + '</h3>' + renderReviewValue(item[key]) + '</section>').join('') +
    '</div><h3>' + (item.reviewed ? 'Reviewed choice: ' : 'Proposed choice: ') + escapeHTML(item.take) +
    '</h3>' + renderReviewValue(item.value) +
    (item.note ? '<h3>Decision note</h3><p class="text">' + escapeHTML(item.note) + '</p>' : '') + '</article>').join('');
  const result = review.completion?.plan;
  const operating = result ? '<h2>Reviewed operating procedure</h2><pre>' +
    escapeHTML(renderOperatingPlanMarkdown(result)) + '</pre>' + result.revisions.at(-1).steps
      .filter(step => step.files?.length).map(step => '<h3>' + escapeHTML(step.title) + '</h3>' +
        renderReviewValue({ files: step.files })).join('') : '';
  return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Returned procedure · ' + escapeHTML(review.current.revisions.at(-1).title) +
    '</title><style>body{font:15px/1.55 Arial,Helvetica,sans-serif;color:#202326;background:#fff;max-width:1200px;margin:auto;padding:2rem}h1{font-size:1.8rem}h2{font-size:1.2rem}h3{font-size:1rem}header{border-bottom:2px solid #30363b}article{border:1px solid #b8bec4;padding:1rem;margin:1rem 0;break-inside:avoid}.values{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem}pre{font:12px/1.5 monospace;background:#f4f5f6;padding:1rem;white-space:pre-wrap;overflow-wrap:anywhere}.text{white-space:pre-wrap;overflow-wrap:anywhere}@media(max-width:720px){body{padding:1rem}.values{grid-template-columns:1fr}}@media print{body{max-width:none;padding:0}details>pre{display:block}}</style></head><body><header>' +
    '<p>STARFORGE · RETURNED PROCEDURE REVIEW</p><h1>' + escapeHTML(review.current.revisions.at(-1).title) +
    '</h1><p>Shared revision ' + report.commonRevision + ' · Current revision ' + report.currentRevision +
    ' · Returned revision ' + report.incomingRevision + '</p><p>Reviewing operator: ' + escapeHTML(review.reviewer) +
    '</p><p>' + (result ? 'Completed ' + escapeHTML(review.completion.savedAt) + ' · Result revision ' +
      result.revisions.length : report.unresolved.length + ' unresolved conflicts · ' + report.issues.length + ' items to correct') +
    '</p></header><section><h2>Review notes</h2><p class="text">' + escapeHTML(review.notes) +
    '</p></section>' + (report.issues.length ? '<section><h2>Items to correct</h2><ul>' + report.issues.map(issue =>
      '<li>' + escapeHTML(issue.key + ': ' + issue.message) + '</li>').join('') + '</ul></section>' : '') +
    rows + (rows ? '' : '<p>Both selected procedures have identical content.</p>') + operating +
    '<details><summary>Complete editable review and both original saved histories</summary><pre>' +
    escapeHTML(JSON.stringify(review, null, 2)) + '</pre></details></body></html>\n';
}
