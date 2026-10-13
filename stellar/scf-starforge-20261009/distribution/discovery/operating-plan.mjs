// MIT. Saved customer procedures using the original installed command catalog.
import { CATALOG_SCHEMA, findCatalogItem } from './catalog.mjs';

export const OPERATING_PLAN_SCHEMA = 'stellar-forge.operating-plan.v1';
export const OPERATING_DRAFT_SCHEMA = 'stellar-forge.operating-plan-draft.v1';
export const OPERATING_COMPARISON_SCHEMA = 'stellar-forge.operating-plan-comparison.v1';
export const STEP_STATES = Object.freeze(['planned', 'in-progress', 'completed', 'skipped']);
const KINDS = ['command', 'source', 'feature', 'export', 'application', 'merchant'];
const BODY_KEYS = ['title', 'customer', 'purpose', 'period', 'owner', 'receiving', 'notes', 'steps'];
const STEP_KEYS = ['id', 'title', 'instruction', 'inputs', 'expectedResult', 'owner', 'due', 'status', 'recordedResult', 'argv', 'selection'];
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const copy = value => JSON.parse(JSON.stringify(value));
const fail = (code, message) => { const error = new TypeError(message); error.code = code; throw error; };
const need = (condition, code, message) => { if (!condition) fail(code, message); };
const canonical = value => Array.isArray(value) ? value.map(canonical) : plain(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const equal = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
const only = (value, keys, field) => need(plain(value) && Object.keys(value).every(key => keys.includes(key)),
  'PLAN_FIELDS_INVALID', field + ' contains unsupported fields.');
function text(value, field, maximum = 32000, required = false) {
  need(typeof value === 'string' && value.length <= maximum && !value.includes('\u0000'),
    'PLAN_TEXT_INVALID', field + ' must be text up to ' + maximum + ' characters without NUL.');
  need(!required || value.trim().length > 0, 'PLAN_TEXT_REQUIRED', field + ' is required.');
  return value;
}
function identity(value, field) {
  need(typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value),
    'PLAN_ID_INVALID', field + ' must be 1–128 letters, numbers, dots, underscores or hyphens.');
  return value;
}
function time(value, field) {
  need(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19), 'PLAN_TIME_INVALID', field + ' must be a UTC ISO date and time.');
  return value;
}
function date(value) {
  text(value, 'Due date', 10);
  if (value) need(/^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + 'T00:00:00Z')) &&
    new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value,
  'PLAN_DATE_INVALID', 'Due date must be a real YYYY-MM-DD calendar date.');
}
function catalog(value) {
  need(value?.schema === CATALOG_SCHEMA && plain(value.package) && Array.isArray(value.items) &&
    Array.isArray(value.sources), 'PLAN_CATALOG_REQUIRED', 'Read the original Command finder catalog first.');
  return value;
}
function validateSelection(value) {
  only(value, ['package', 'capturedAt', 'item', 'sources', 'runtimeGroups'], 'Registration selection');
  need(plain(value.package) && typeof value.package.name === 'string' && typeof value.package.version === 'string',
    'PLAN_PACKAGE_INVALID', 'The retained package needs its original name and version.');
  need(value.capturedAt === null || typeof value.capturedAt === 'string', 'PLAN_CAPTURE_INVALID',
    'The retained catalog time must be text or null.');
  const item = value.item;
  need(plain(item) && KINDS.includes(item.kind) && typeof item.name === 'string' && item.name &&
    item.id === item.kind + ':' + item.name && typeof item.description === 'string' &&
    Array.isArray(item.sourceIds) && item.sourceIds.every(id => typeof id === 'string') &&
    Array.isArray(item.featureIds) && item.featureIds.every(id => typeof id === 'string'),
  'PLAN_REGISTRATION_INVALID', 'The retained original registration is invalid.');
  need(Array.isArray(value.sources) && value.sources.every(source => plain(source) &&
    typeof source.id === 'string' && typeof source.path === 'string' && item.sourceIds.includes(source.id)) &&
    new Set(value.sources.map(source => source.id)).size === value.sources.length &&
    item.sourceIds.every(id => value.sources.some(source => source.id === id)),
  'PLAN_SOURCES_INVALID', 'Keep each original registration source with its selection.');
  need(Array.isArray(value.runtimeGroups) && value.runtimeGroups.every(group => plain(group) &&
    group.kind === 'feature' && group.id === 'feature:' + group.name && item.featureIds.includes(group.name)) &&
    new Set(value.runtimeGroups.map(group => group.id)).size === value.runtimeGroups.length &&
    item.featureIds.every(id => value.runtimeGroups.some(group => group.name === id)),
  'PLAN_RUNTIME_INVALID', 'Keep every declared runtime group with its original registration.');
  return value;
}
function validateStep(value) {
  only(value, STEP_KEYS, 'Operating step');
  identity(value.id, 'Step ID'); text(value.title, 'Step title', 300, true);
  for (const key of ['instruction', 'inputs', 'expectedResult', 'recordedResult']) text(value[key], key);
  text(value.owner, 'Step owner', 300); date(value.due);
  need(STEP_STATES.includes(value.status), 'PLAN_STATUS_INVALID', 'Select a recorded step status.');
  need(Array.isArray(value.argv) && value.argv.length <= 256 &&
    value.argv.every(arg => typeof arg === 'string' && arg.length <= 32000 && !arg.includes('\u0000')),
  'PLAN_ARGUMENTS_INVALID', 'Command arguments must be a JSON array of text values.');
  if (value.selection !== null) validateSelection(value.selection);
  return value;
}
function validateBody(value) {
  only(value, BODY_KEYS, 'Operating plan content');
  text(value.title, 'Plan title', 300, true);
  for (const key of ['customer', 'period', 'owner']) text(value[key], key, 1000);
  for (const key of ['purpose', 'receiving', 'notes']) text(value[key], key);
  need(Array.isArray(value.steps) && value.steps.length <= 1000, 'PLAN_STEPS_INVALID',
    'An operating plan can contain up to 1,000 steps.');
  value.steps.forEach(validateStep);
  need(new Set(value.steps.map(step => step.id)).size === value.steps.length,
    'PLAN_DUPLICATE_STEP', 'Each operating step needs its own stable ID.');
  return value;
}
function bodyFromRevision(revision) {
  return Object.fromEntries(BODY_KEYS.map(key => [key, copy(revision[key])]));
}
export function inspectOperatingPlan(value) {
  only(value, ['schema', 'id', 'createdAt', 'origin', 'revisions'], 'Operating plan');
  need(value.schema === OPERATING_PLAN_SCHEMA, 'PLAN_SCHEMA_INVALID', 'Choose a complete Starforge operating plan.');
  identity(value.id, 'Plan ID'); time(value.createdAt, 'Plan creation time');
  if (value.origin !== null) {
    only(value.origin, ['id', 'revision', 'createdAt'], 'Original plan');
    identity(value.origin.id, 'Original plan ID'); time(value.origin.createdAt, 'Original plan creation time');
    need(Number.isSafeInteger(value.origin.revision) && value.origin.revision > 0,
      'PLAN_ORIGIN_INVALID', 'The original plan revision is invalid.');
  }
  need(Array.isArray(value.revisions) && value.revisions.length > 0,
    'PLAN_REVISIONS_INVALID', 'Keep the complete plan revision history.');
  value.revisions.forEach((revision, index) => {
    only(revision, [...BODY_KEYS, 'revision', 'savedAt'], 'Plan revision');
    need(revision.revision === index + 1, 'PLAN_REVISION_ORDER', 'Plan revisions must retain their original order.');
    time(revision.savedAt, 'Revision time'); validateBody(bodyFromRevision(revision));
  });
  need(value.revisions[0].savedAt === value.createdAt, 'PLAN_CREATION_CHANGED',
    'The first revision must retain the original plan creation time.');
  return copy(value);
}
export function operatingPlanRevision(plan, revision = plan?.revisions?.length) {
  const saved = inspectOperatingPlan(plan);
  need(Number.isSafeInteger(revision) && revision > 0 && revision <= saved.revisions.length,
    'PLAN_REVISION_MISSING', 'The selected plan revision is unavailable.');
  return saved.revisions[revision - 1];
}
export function operatingPlanDraft(plan, revision) {
  const selected = operatingPlanRevision(plan, revision);
  return { schema: OPERATING_DRAFT_SCHEMA, planId: plan.id,
    baseRevision: plan.revisions.length, content: bodyFromRevision(selected) };
}
export function createOperatingPlan({ id, title, customer = '', purpose = '', period = '',
  owner = '', receiving = '', notes = '', steps = [], savedAt = new Date().toISOString() }) {
  identity(id, 'Plan ID'); time(savedAt, 'Plan creation time');
  const content = validateBody({ title, customer, purpose, period, owner, receiving, notes, steps: copy(steps) });
  return inspectOperatingPlan({ schema: OPERATING_PLAN_SCHEMA, id, createdAt: savedAt, origin: null,
    revisions: [{ revision: 1, savedAt, ...content }] });
}
export function saveOperatingPlanRevision(plan, draft, { savedAt = new Date().toISOString() } = {}) {
  const saved = inspectOperatingPlan(plan);
  only(draft, ['schema', 'planId', 'baseRevision', 'content'], 'Editable plan draft');
  need(draft.schema === OPERATING_DRAFT_SCHEMA && draft.planId === saved.id,
    'PLAN_DRAFT_MISMATCH', 'This draft belongs to a different operating plan.');
  need(draft.baseRevision === saved.revisions.length, 'PLAN_REVISION_CONFLICT',
    'The saved plan advanced. Keep this draft and reopen the current revision or save it as a copy.');
  validateBody(draft.content); time(savedAt, 'Revision time');
  if (equal(draft.content, bodyFromRevision(saved.revisions.at(-1)))) return saved;
  saved.revisions.push({ revision: saved.revisions.length + 1, savedAt, ...copy(draft.content) });
  return inspectOperatingPlan(saved);
}
export function snapshotRegistration(value, itemId) {
  const selected = catalog(value), item = findCatalogItem(selected, itemId);
  return copy(validateSelection({ package: selected.package, capturedAt: selected.capturedAt,
    item, sources: selected.sources.filter(source => item.sourceIds.includes(source.id)),
    runtimeGroups: selected.items.filter(group => group.kind === 'feature' && item.featureIds.includes(group.name)) }));
}
export function createOperatingStep({ id, title, selection = null, instruction = '', inputs = '',
  expectedResult = '', owner = '', due = '', status = 'planned', recordedResult = '', argv } = {}) {
  if (selection !== null) validateSelection(selection);
  return copy(validateStep({ id, title: title ?? selection?.item?.name ?? 'Operating step',
    instruction, inputs, expectedResult, owner, due, status, recordedResult,
    argv: argv ?? selection?.item?.helpArgv ?? [], selection: copy(selection) }));
}
export function addOperatingStep(draft, step, beforeId = null) {
  const next = copy(draft); validateBody(next.content); validateStep(step);
  need(!next.content.steps.some(item => item.id === step.id), 'PLAN_DUPLICATE_STEP', 'The step ID already exists.');
  const position = beforeId === null ? next.content.steps.length : next.content.steps.findIndex(item => item.id === beforeId);
  need(position >= 0, 'PLAN_STEP_MISSING', 'The selected insertion step is unavailable.');
  next.content.steps.splice(position, 0, copy(step)); validateBody(next.content); return next;
}
export function moveOperatingStep(draft, stepId, index) {
  const next = copy(draft); validateBody(next.content);
  need(Number.isInteger(index) && index >= 0 && index < next.content.steps.length,
    'PLAN_STEP_POSITION', 'Choose an existing position in this operating plan.');
  const previous = next.content.steps.findIndex(step => step.id === stepId);
  need(previous >= 0, 'PLAN_STEP_MISSING', 'The selected step is unavailable.');
  const [step] = next.content.steps.splice(previous, 1); next.content.steps.splice(index, 0, step);
  return next;
}
export function forkOperatingPlan(plan, { id, title, savedAt = new Date().toISOString(), draft } = {}) {
  const original = inspectOperatingPlan(plan);
  identity(id, 'New plan ID');
  need(id !== original.id, 'PLAN_COPY_ID_REQUIRED', 'A copy needs its own new plan ID.');
  const forked = { ...copy(original), id,
    origin: { id: original.id, revision: original.revisions.length, createdAt: original.createdAt } };
  const content = draft ? validateBody(draft.content) : bodyFromRevision(original.revisions.at(-1));
  return saveOperatingPlanRevision(forked, { schema: OPERATING_DRAFT_SCHEMA, planId: id,
    baseRevision: forked.revisions.length,
    content: { ...copy(content), ...(title !== undefined ? { title } : {}) } }, { savedAt });
}
/** Extend an existing history only when every shared revision is identical. */
export function receiveOperatingPlan(incoming, existing = null) {
  const received = inspectOperatingPlan(incoming);
  if (!existing) return { plan: received, reused: false, addedRevisions: received.revisions.length };
  const current = inspectOperatingPlan(existing);
  need(current.id === received.id && current.createdAt === received.createdAt && equal(current.origin, received.origin),
    'PLAN_ORIGIN_CONFLICT', 'This plan ID belongs to a different original plan. Import as a new copy.');
  const shared = Math.min(current.revisions.length, received.revisions.length);
  for (let index = 0; index < shared; index++) need(equal(current.revisions[index], received.revisions[index]),
    'PLAN_HISTORY_DIVERGED', 'These histories contain different edits. Keep both and import as a new copy.');
  return received.revisions.length > current.revisions.length
    ? { plan: received, reused: false, addedRevisions: received.revisions.length - current.revisions.length }
    : { plan: current, reused: true, addedRevisions: 0 };
}
export function compareOperatingPlan(plan, value, { revision } = {}) {
  const selected = operatingPlanRevision(plan, revision), current = catalog(value);
  const steps = selected.steps.map(step => {
    if (!step.selection) return { stepId: step.id, title: step.title, itemId: null, status: 'manual', changedFields: [] };
    const original = step.selection, item = current.items.find(candidate => candidate.id === original.item.id);
    if (!item) return { stepId: step.id, title: step.title, itemId: original.item.id, status: 'missing',
      changedFields: [], original: copy(original), current: null };
    const replacement = snapshotRegistration(current, item.id);
    const fields = [...new Set([...Object.keys(original.item), ...Object.keys(replacement.item)])].sort()
      .filter(key => !equal(original.item[key], replacement.item[key]));
    if (!equal(original.sources, replacement.sources)) fields.push('registrationSources');
    if (!equal(original.runtimeGroups, replacement.runtimeGroups)) fields.push('runtimeGroups');
    return { stepId: step.id, title: step.title, itemId: item.id, status: fields.length ? 'changed' : 'unchanged',
      changedFields: fields, packageChanged: !equal(original.package, replacement.package),
      original: copy(original), current: replacement };
  });
  return { schema: OPERATING_COMPARISON_SCHEMA, planId: plan.id, revision: selected.revision,
    package: copy(current.package), capturedAt: current.capturedAt, total: steps.length,
    counts: Object.fromEntries(['manual', 'unchanged', 'changed', 'missing'].map(status =>
      [status, steps.filter(step => step.status === status).length])), steps };
}
export function summarizeOperatingPlan(plan, { revision } = {}) {
  const selected = operatingPlanRevision(plan, revision);
  return { id: plan.id, revision: selected.revision, revisions: plan.revisions.length,
    title: selected.title, customer: selected.customer, purpose: selected.purpose, period: selected.period,
    owner: selected.owner, savedAt: selected.savedAt, steps: selected.steps.length,
    counts: Object.fromEntries(STEP_STATES.map(status => [status, selected.steps.filter(step => step.status === status).length])),
    registrations: [...new Set(selected.steps.filter(step => step.selection).map(step => step.selection.item.id))] };
}
export function shellArgument(value) {
  text(value, 'Command argument');
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(value) ? value : "'" + value.replace(/'/g, "'\\''") + "'";
}
export function operatingStepCommand(step) {
  validateStep(step); return step.argv.map(shellArgument).join(' ');
}
const md = value => String(value).replace(/([\\\x60*_[\]<>#|])/g, '\\$1');
function fenced(value, language = '') {
  const ticks = String.fromCharCode(96).repeat(Math.max(3, ...[...String(value).matchAll(/\x60+/g)].map(item => item[0].length + 1)));
  return ticks + language + '\n' + value + '\n' + ticks;
}
export function renderOperatingPlanMarkdown(plan, { revision } = {}) {
  const saved = inspectOperatingPlan(plan), selected = operatingPlanRevision(saved, revision);
  const lines = ['# ' + md(selected.title), '', 'Revision ' + selected.revision + ' · ' + selected.savedAt, ''];
  for (const [key, label] of [['customer', 'Customer'], ['purpose', 'Useful result'], ['period', 'Period or recurrence'],
    ['owner', 'Operating owner'], ['receiving', 'Receiving and continuation'], ['notes', 'Plan notes']])
    if (selected[key]) lines.push('## ' + label, '', selected[key], '');
  lines.push('## Operating steps', '');
  selected.steps.forEach((step, index) => {
    lines.push('### ' + (index + 1) + '. ' + md(step.title), '', 'Recorded status: ' + step.status, '');
    if (step.owner) lines.push('Owner: ' + md(step.owner), '');
    if (step.due) lines.push('Due: ' + step.due, '');
    for (const [key, label] of [['instruction', 'Work'], ['inputs', 'Inputs'], ['expectedResult', 'Expected result'],
      ['recordedResult', 'Recorded result']]) if (step[key]) lines.push('**' + label + '**', '', step[key], '');
    if (step.argv.length) lines.push('**Selected command arguments**', '', fenced(operatingStepCommand(step), 'sh'), '');
    if (step.selection) lines.push('**Retained registration and declared runtime**', '',
      fenced(JSON.stringify(step.selection, null, 2), 'json'), '');
  });
  if (!selected.steps.length) lines.push('No operating steps have been recorded.', '');
  lines.push('## Plan identity', '', fenced(JSON.stringify({ schema: saved.schema, id: saved.id,
    createdAt: saved.createdAt, origin: saved.origin, selectedRevision: selected.revision,
    savedRevisionCount: saved.revisions.length }, null, 2), 'json'), '');
  return lines.join('\n');
}
const html = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
export function renderOperatingPlanHTML(plan, { revision } = {}) {
  const saved = inspectOperatingPlan(plan), selected = operatingPlanRevision(saved, revision);
  const paragraph = (label, value) => value ? '<section><h2>' + html(label) + '</h2><p class="text">' + html(value) + '</p></section>' : '';
  const steps = selected.steps.map((step, index) => '<article><h2>' + (index + 1) + '. ' + html(step.title) +
    '</h2><dl><dt>Recorded status</dt><dd>' + html(step.status) + '</dd>' +
    (step.owner ? '<dt>Owner</dt><dd>' + html(step.owner) + '</dd>' : '') +
    (step.due ? '<dt>Due</dt><dd>' + html(step.due) + '</dd>' : '') + '</dl>' +
    [['instruction', 'Work'], ['inputs', 'Inputs'], ['expectedResult', 'Expected result'], ['recordedResult', 'Recorded result']]
      .map(([key, label]) => step[key] ? '<h3>' + label + '</h3><p class="text">' + html(step[key]) + '</p>' : '').join('') +
    (step.argv.length ? '<h3>Selected command arguments</h3><pre>' + html(operatingStepCommand(step)) + '</pre>' : '') +
    (step.selection ? '<details><summary>Retained registration and declared runtime</summary><pre>' +
      html(JSON.stringify(step.selection, null, 2)) + '</pre></details>' : '') + '</article>').join('');
  return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + html(selected.title) + '</title><style>body{font:15px/1.55 Arial,Helvetica,sans-serif;color:#202326;background:#fff;max-width:1040px;margin:0 auto;padding:2rem}h1{font-size:1.8rem}h2{font-size:1.2rem}h3{font-size:1rem}header{border-bottom:2px solid #30363b;margin-bottom:1.5rem}article{border:1px solid #b8bec4;padding:1.3rem;margin:1.3rem 0;break-inside:avoid}dl{display:grid;grid-template-columns:9rem 1fr;gap:.3rem}dt{font-weight:bold}dd{margin:0}pre{font:12px/1.5 monospace;background:#f4f5f6;border:1px solid #d4d8dc;padding:1rem;white-space:pre-wrap;overflow-wrap:anywhere}.text{white-space:pre-wrap;overflow-wrap:anywhere}summary{cursor:pointer}footer{border-top:1px solid #b8bec4;margin-top:2rem;font-size:.85rem}@media(max-width:600px){body{padding:1rem}article{padding:.8rem}dl{grid-template-columns:1fr}}@media print{body{max-width:none;padding:0}details{display:block}details>pre{display:block}}</style></head><body><header><p>STARFORGE · OPERATING PLAN</p><h1>' +
    html(selected.title) + '</h1><p>Revision ' + selected.revision + ' · ' + html(selected.savedAt) + '</p></header>' +
    [['customer', 'Customer'], ['purpose', 'Useful result'], ['period', 'Period or recurrence'], ['owner', 'Operating owner'],
      ['receiving', 'Receiving and continuation'], ['notes', 'Plan notes']].map(([key, label]) => paragraph(label, selected[key])).join('') +
    steps + (!steps ? '<p>No operating steps have been recorded.</p>' : '') +
    '<footer><p>Plan ' + html(saved.id) + ' · Created ' + html(saved.createdAt) +
    ' · Complete editable JSON retains ' + saved.revisions.length + ' saved revisions.</p></footer></body></html>\n';
}
