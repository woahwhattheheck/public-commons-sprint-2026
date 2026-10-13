// MIT. Saved customer procedures using the original installed command catalog.
import { CATALOG_SCHEMA, findCatalogItem } from './catalog.mjs';

export const OPERATING_PLAN_SCHEMA = 'stellar-forge.operating-plan.v1';
export const OPERATING_DRAFT_SCHEMA = 'stellar-forge.operating-plan-draft.v1';
export const OPERATING_COMPARISON_SCHEMA = 'stellar-forge.operating-plan-comparison.v1';
export const STEP_STATES = Object.freeze(['planned', 'in-progress', 'completed', 'skipped']);
const KINDS = ['command', 'source', 'feature', 'export', 'application', 'merchant'];
const BODY_KEYS = ['title', 'customer', 'purpose', 'period', 'owner', 'receiving', 'notes', 'steps'];
const STEP_KEYS = ['id', 'title', 'instruction', 'inputs', 'expectedResult', 'owner', 'due', 'status', 'recordedResult', 'argv', 'selection', 'files'];
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

export const OPERATING_FILE_MAX_BYTES = 24 * 1024 * 1024;
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** Complete carried output. Legacy steps keep their original shape until files are attached. */
export function inspectOperatingFile(value) {
  only(value, ['id', 'name', 'mediaType', 'bytes', 'encoding', 'content', 'note'], 'Operating file');
  identity(value.id, 'File ID'); text(value.name, 'File name', 255, true);
  need(!/[\\/\x00-\x1f\x7f]/.test(value.name) && !['.', '..'].includes(value.name),
    'PLAN_FILE_NAME_INVALID', 'Use a file name without path separators or control characters.');
  text(value.mediaType, 'File media type', 255, true); text(value.note, 'File note');
  need(Number.isSafeInteger(value.bytes) && value.bytes >= 0 && value.bytes <= OPERATING_FILE_MAX_BYTES,
    'PLAN_FILE_SIZE_INVALID', 'A carried file must fit within 24 MiB; the complete saved plan must fit its receiving application.');
  need(value.encoding === 'base64' && typeof value.content === 'string' &&
    value.content.length === Math.ceil(value.bytes / 3) * 4 &&
    !/[^A-Za-z0-9+/=]/.test(value.content),
    'PLAN_FILE_CONTENT_INVALID', 'Keep the complete file bytes as canonical base64.');
  const padding = value.content.endsWith('==') ? 2 : value.content.endsWith('=') ? 1 : 0;
  need(!value.content.slice(0, value.content.length - padding).includes('=') &&
    value.content.length / 4 * 3 - padding === value.bytes &&
    (padding !== 2 || (BASE64.indexOf(value.content.at(-3)) & 15) === 0) &&
    (padding !== 1 || (BASE64.indexOf(value.content.at(-2)) & 3) === 0),
    'PLAN_FILE_CONTENT_INVALID', 'The file length or base64 padding does not match its complete contents.');
  return copy(value);
}
export function createOperatingFile({ id, name, mediaType = 'application/octet-stream', bytes, note = '' }) {
  need(bytes instanceof Uint8Array && bytes.length <= OPERATING_FILE_MAX_BYTES,
    'PLAN_FILE_BYTES_REQUIRED', 'Read the complete output as bytes within 24 MiB.');
  const chunks = []; let chunk = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const value = (bytes[index] << 16) | ((bytes[index + 1] ?? 0) << 8) | (bytes[index + 2] ?? 0);
    chunk += BASE64[value >>> 18] + BASE64[(value >>> 12) & 63] +
      (index + 1 < bytes.length ? BASE64[(value >>> 6) & 63] : '=') +
      (index + 2 < bytes.length ? BASE64[value & 63] : '=');
    if (chunk.length >= 16384) { chunks.push(chunk); chunk = ''; }
  }
  chunks.push(chunk);
  return inspectOperatingFile({ id, name, mediaType: mediaType || 'application/octet-stream',
    bytes: bytes.length, encoding: 'base64', content: chunks.join(''), note });
}
export function operatingFileBytes(value) {
  const file = inspectOperatingFile(value), bytes = new Uint8Array(file.bytes);
  for (let position = 0, output = 0; position < file.content.length; position += 4) {
    const a = BASE64.indexOf(file.content[position]), b = BASE64.indexOf(file.content[position + 1]);
    const c = BASE64.indexOf(file.content[position + 2]), d = BASE64.indexOf(file.content[position + 3]);
    bytes[output++] = (a << 2) | (b >> 4);
    if (output < bytes.length) bytes[output++] = ((b & 15) << 4) | (Math.max(c, 0) >> 2);
    if (output < bytes.length) bytes[output++] = ((Math.max(c, 0) & 3) << 6) | Math.max(d, 0);
  }
  return bytes;
}
export function operatingFileSummary(value) {
  const { content, ...summary } = inspectOperatingFile(value);
  return summary;
}
export function addOperatingFile(draft, stepId, file) {
  const next = copy(draft); validateBody(next.content);
  const step = next.content.steps.find(item => item.id === stepId);
  need(step, 'PLAN_STEP_MISSING', 'Open the intended operating step before adding its output.');
  const added = inspectOperatingFile(file);
  need(!(step.files ?? []).some(item => item.id === added.id),
    'PLAN_FILE_ID_EXISTS', 'This step already contains that file ID.');
  step.files = [...(step.files ?? []), added]; validateBody(next.content); return next;
}
export function removeOperatingFile(draft, stepId, fileId) {
  const next = copy(draft); validateBody(next.content);
  const step = next.content.steps.find(item => item.id === stepId);
  need(step?.files?.some(item => item.id === fileId), 'PLAN_FILE_MISSING', 'The selected step file is unavailable.');
  step.files = step.files.filter(item => item.id !== fileId);
  if (!step.files.length) delete step.files;
  return next;
}
/** Complete file differences, including content, notes and order, without copying encoded bodies into the index. */
export function compareOperatingFiles(previous = [], returned = []) {
  previous.forEach(inspectOperatingFile); returned.forEach(inspectOperatingFile);
  return {
    orderChanged: !equal(previous.map(file => file.id), returned.map(file => file.id)),
    previous: previous.map(operatingFileSummary), returned: returned.map(operatingFileSummary),
    added: returned.filter(file => !previous.some(old => old.id === file.id)).map(operatingFileSummary),
    removed: previous.filter(file => !returned.some(next => next.id === file.id)).map(operatingFileSummary),
    changed: returned.filter(file => previous.some(old => old.id === file.id && !equal(old, file))).map(file => ({
      id: file.id, previous: operatingFileSummary(previous.find(old => old.id === file.id)),
      returned: operatingFileSummary(file),
      contentChanged: previous.find(old => old.id === file.id).content !== file.content,
    })),
  };
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
  if (value.files !== undefined) {
    need(Array.isArray(value.files) && value.files.length <= 1000, 'PLAN_FILES_INVALID', 'Keep at most 1,000 complete files per operating step.');
    value.files.forEach(inspectOperatingFile);
    need(new Set(value.files.map(file => file.id)).size === value.files.length, 'PLAN_FILE_ID_EXISTS', 'Each carried file needs its own step-local ID.');
  }
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
  expectedResult = '', owner = '', due = '', status = 'planned', recordedResult = '', argv, files } = {}) {
  if (selection !== null) validateSelection(selection);
  return copy(validateStep({ id, title: title ?? selection?.item?.name ?? 'Operating step',
    instruction, inputs, expectedResult, owner, due, status, recordedResult,
    argv: argv ?? selection?.item?.helpArgv ?? [], selection: copy(selection), ...(files === undefined ? {} : { files: copy(files) }) }));
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

/** Prepare another period from one saved revision while retaining every original revision. */
export function previewOperatingPlanCycle(plan, options = {}) {
  const original = inspectOperatingPlan(plan);
  need(!original.revisions.some(revision => revision.steps.some(step => step.id === 'grant-tracker')),
    'PLAN_CYCLE_NATIVE_PREPARATION', 'Prepare a new managed Grant tracker through its original application; preserve the programme decisions and required source files.');
  only(options, ['revision', 'title', 'period', 'datePolicy', 'shiftFrom', 'shiftTo', 'referenceFiles'], 'Cycle preparation');
  const selected = operatingPlanRevision(original, options.revision);
  text(options.title, 'New cycle title', 300, true);
  text(options.period, 'New cycle period', 1000, true);
  const datePolicy = options.datePolicy ?? 'clear';
  need(['clear', 'keep', 'shift'].includes(datePolicy), 'PLAN_CYCLE_DATES_INVALID',
    'Choose whether to clear, retain or shift the original due dates.');
  let shiftDays = 0;
  if (datePolicy === 'shift') {
    date(options.shiftFrom); date(options.shiftTo);
    need(options.shiftFrom && options.shiftTo, 'PLAN_CYCLE_ANCHORS_REQUIRED',
      'Choose the original and next cycle anchor dates before shifting due dates.');
    shiftDays = (Date.parse(options.shiftTo + 'T00:00:00Z') - Date.parse(options.shiftFrom + 'T00:00:00Z')) / 86400000;
  } else need(options.shiftFrom === undefined && options.shiftTo === undefined,
    'PLAN_CYCLE_ANCHORS_UNUSED', 'Anchor dates apply only to the shift policy.');
  const references = options.referenceFiles ?? [];
  need(Array.isArray(references) && references.length <= 1000000,
    'PLAN_CYCLE_FILES_INVALID', 'Select original files by their step and file IDs.');
  const referenceIds = new Set();
  const sourceFiles = new Set(selected.steps.flatMap(step => (step.files ?? []).map(file => JSON.stringify([step.id, file.id]))));
  for (const reference of references) {
    only(reference, ['stepId', 'fileId'], 'Cycle reference file');
    identity(reference.stepId, 'Reference step ID'); identity(reference.fileId, 'Reference file ID');
    const key = JSON.stringify([reference.stepId, reference.fileId]);
    need(!referenceIds.has(key), 'PLAN_CYCLE_FILE_REPEATED', 'Select each reference file once.');
    need(sourceFiles.has(key), 'PLAN_CYCLE_FILE_MISSING',
      'A selected reference file is unavailable in the chosen source revision.');
    referenceIds.add(key);
  }
  const content = bodyFromRevision(selected);
  content.title = options.title; content.period = options.period;
  const steps = content.steps.map(step => {
    const previousDue = step.due, previousStatus = step.status;
    const originalFiles = step.files ?? [];
    step.status = 'planned'; step.recordedResult = '';
    if (datePolicy === 'clear') step.due = '';
    if (datePolicy === 'shift' && step.due) {
      const next = new Date(Date.parse(step.due + 'T00:00:00Z') + shiftDays * 86400000);
      need(Number.isFinite(next.getTime()), 'PLAN_CYCLE_DATE_RANGE', 'The shifted due date is outside the calendar range.');
      step.due = next.toISOString().slice(0, 10); date(step.due);
    }
    const kept = originalFiles.filter(file => referenceIds.has(JSON.stringify([step.id, file.id])));
    if (kept.length) step.files = kept;
    else delete step.files;
    return { id: step.id, title: step.title, owner: step.owner, previousStatus,
      previousDue, due: step.due, originalFiles: originalFiles.map(operatingFileSummary),
      referenceFiles: kept.map(operatingFileSummary) };
  });
  validateBody(content);
  return {
    source: { id: original.id, revision: selected.revision, historyRevisions: original.revisions.length,
      createdAt: original.createdAt, title: selected.title, period: selected.period },
    datePolicy, shiftDays,
    ...(datePolicy === 'shift' ? { shiftFrom: options.shiftFrom, shiftTo: options.shiftTo } : {}),
    content, steps,
  };
}
export function createOperatingPlanCycle(plan, { id, savedAt = new Date().toISOString(), ...options } = {}) {
  const original = inspectOperatingPlan(plan), preview = previewOperatingPlanCycle(original, options);
  identity(id, 'New cycle plan ID'); time(savedAt, 'New cycle save time');
  need(id !== original.id, 'PLAN_COPY_ID_REQUIRED', 'A new cycle needs its own plan ID.');
  // A cycle always has an explicit new saved revision, including an identical empty procedure.
  return inspectOperatingPlan({ ...original, id,
    origin: { id: original.id, revision: preview.source.revision, createdAt: original.createdAt },
    revisions: [...original.revisions, { revision: original.revisions.length + 1, savedAt, ...preview.content }] });
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
    if (step.files?.length) {
      lines.push('**Complete output files**', '', 'The complete editable JSON and HTML handover retain these original file bytes.', '');
      for (const file of step.files) lines.push('- ' + md(file.name) + ' · ' + file.bytes + ' bytes · ' +
        md(file.mediaType) + ' · file ' + md(file.id) + (file.note ? ' · ' + md(file.note) : ''), '');
    }
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
    (step.files?.length ? '<h3>Complete output files</h3><ul>' + step.files.map(file =>
      '<li><a download="' + html(file.name) + '" href="data:application/octet-stream;base64,' + file.content + '">' +
      html(file.name) + '</a> · ' + file.bytes + ' bytes · ' + html(file.mediaType) +
      (file.note ? '<p class="text">' + html(file.note) + '</p>' : '') + '</li>').join('') + '</ul>' : '') +
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


export const OPERATING_WORK_SCHEMA = 'stellar-forge.operating-work-selection.v1';
export const OPERATING_WORK_MAX_BYTES = 32 * 1024 * 1024;
const WORK_DUE = ['all', 'overdue', 'today', 'future', 'undated'];
const lexical = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function workOptions(value) {
  only(value, ['asOf', 'owner', 'customer', 'search', 'status', 'due', 'assignment'], 'Work selection');
  const options = { asOf: value.asOf, owner: value.owner ?? '', customer: value.customer ?? '',
    search: value.search ?? '', status: value.status ?? 'unfinished', due: value.due ?? 'all',
    assignment: value.assignment ?? 'all' };
  date(options.asOf);
  need(Boolean(options.asOf), 'WORK_DATE_REQUIRED', 'Choose the explicit calendar date for this work selection.');
  for (const field of ['owner', 'customer', 'search']) text(options[field], 'Work ' + field + ' filter', 1000);
  need(['all', 'unfinished', ...STEP_STATES].includes(options.status), 'WORK_STATUS_INVALID', 'Choose an original recorded work status.');
  need(WORK_DUE.includes(options.due), 'WORK_DUE_INVALID', 'Choose all, overdue, today, future or undated work.');
  need(['all', 'assigned', 'unassigned'].includes(options.assignment), 'WORK_ASSIGNMENT_INVALID', 'Choose an owner assignment filter.');
  return options;
}
function workProjection(plans, options) {
  const ids = new Set(), rows = [], sources = [];
  const includes = (value, query) => value.toLowerCase().includes(query.trim().toLowerCase());
  for (const plan of plans) {
    need(!ids.has(plan.id), 'WORK_SOURCE_DUPLICATE', 'Keep one complete selected history for each plan ID; reconcile different copies first.');
    ids.add(plan.id);
    const revision = plan.revisions.at(-1);
    sources.push({ id: plan.id, revision: revision.revision, savedAt: revision.savedAt,
      title: revision.title, steps: revision.steps.length });
    revision.steps.forEach((step, index) => {
      const owner = step.owner.trim() ? step.owner : revision.owner;
      const due = !step.due ? 'undated' : step.due < options.asOf ? 'overdue'
        : step.due === options.asOf ? 'today' : 'future';
      if (options.status === 'unfinished' && !['planned', 'in-progress'].includes(step.status)) return;
      if (!['all', 'unfinished'].includes(options.status) && step.status !== options.status) return;
      if (options.due !== 'all' && due !== options.due) return;
      if (options.assignment === 'assigned' && !owner.trim() || options.assignment === 'unassigned' && owner.trim()) return;
      if (!includes(owner, options.owner) || !includes(revision.customer, options.customer)) return;
      const searchable = [revision.title, revision.customer, revision.period, revision.owner, step.title, step.owner,
        step.instruction, step.inputs, step.expectedResult, step.recordedResult, ...step.argv,
        ...(step.files ?? []).flatMap(file => [file.name, file.note])].join('\n');
      if (!includes(searchable, options.search)) return;
      rows.push({ planId: plan.id, revision: revision.revision, savedAt: revision.savedAt,
        stepId: step.id, position: index + 1, title: step.title, planTitle: revision.title,
        customer: revision.customer, period: revision.period, owner, stepOwner: step.owner,
        planOwner: revision.owner, status: step.status, due: step.due, dueState: due,
        files: (step.files ?? []).map(file => ({ id: file.id, name: file.name, bytes: file.bytes, mediaType: file.mediaType })) });
    });
  }
  const rank = { overdue: 0, today: 1, future: 2, undated: 3 };
  rows.sort((a, b) => rank[a.dueState] - rank[b.dueState] || lexical(a.due, b.due) ||
    lexical(a.planId, b.planId) || a.position - b.position);
  sources.sort((a, b) => lexical(a.id, b.id));
  return { asOf: options.asOf, filters: copy(options), sources, rows,
    counts: { plans: sources.length, matchedPlans: new Set(rows.map(row => row.planId)).size, work: rows.length,
      due: Object.fromEntries(WORK_DUE.slice(1).map(state => [state, rows.filter(row => row.dueState === state).length])),
      status: Object.fromEntries(STEP_STATES.map(state => [state, rows.filter(row => row.status === state).length])) } };
}
export function projectOperatingWork(plans, options) {
  need(Array.isArray(plans), 'WORK_PLANS_REQUIRED', 'Read the complete saved operating plans.');
  return workProjection(plans.map(inspectOperatingPlan), workOptions(options));
}
/** A portable selection carries complete histories only for plans with matching work. */
export function createOperatingWorkSelection(plans, options) {
  need(Array.isArray(plans), 'WORK_PLANS_REQUIRED', 'Read the complete saved operating plans.');
  const saved = plans.map(inspectOperatingPlan), selected = workOptions(options), projection = workProjection(saved, selected);
  const matched = new Set(projection.rows.map(row => row.planId));
  const value = { schema: OPERATING_WORK_SCHEMA, options: selected,
    plans: saved.filter(plan => matched.has(plan.id)).sort((a, b) => lexical(a.id, b.id)) };
  serializeOperatingWorkSelection(value);
  return value;
}
export function inspectOperatingWorkSelection(value) {
  only(value, ['schema', 'options', 'plans'], 'Portable work selection');
  need(value.schema === OPERATING_WORK_SCHEMA && Array.isArray(value.plans),
    'WORK_SCHEMA_INVALID', 'Choose the complete Operating Plans work-selection JSON.');
  const plans = value.plans.map(inspectOperatingPlan), options = workOptions(value.options);
  workProjection(plans, options);
  return { schema: OPERATING_WORK_SCHEMA, options, plans };
}
export function serializeOperatingWorkSelection(value) {
  const selected = inspectOperatingWorkSelection(value), result = JSON.stringify(selected, null, 2) + '\n';
  need(new TextEncoder().encode(result).length <= OPERATING_WORK_MAX_BYTES,
    'WORK_SELECTION_TOO_LARGE', 'Keep the complete selected plan histories within 32 MiB. Refine the work filters or export original plans separately.');
  return result;
}
export function renderOperatingWorkHTML(value) {
  const selected = inspectOperatingWorkSelection(value), complete = serializeOperatingWorkSelection(selected);
  const report = workProjection(selected.plans, selected.options), byId = new Map(selected.plans.map(plan => [plan.id, plan]));
  const articles = report.rows.map(row => {
    const step = byId.get(row.planId).revisions.at(-1).steps.find(item => item.id === row.stepId);
    return '<article><h2>' + html(row.title) + '</h2><p>' + html(row.planTitle) + ' · revision ' + row.revision +
      ' · step ' + row.position + '</p><dl><dt>Customer / period</dt><dd>' + html(row.customer + ' / ' + row.period) +
      '</dd><dt>Owner</dt><dd>' + html(row.owner || 'Unassigned') + '</dd><dt>Status</dt><dd>' + html(row.status) +
      '</dd><dt>Due</dt><dd>' + html(row.due || 'Undated') + ' · ' + html(row.dueState) + '</dd></dl>' +
      [['instruction', 'Work'], ['inputs', 'Inputs'], ['expectedResult', 'Expected result'], ['recordedResult', 'Recorded result']]
        .map(([key, label]) => '<h3>' + label + '</h3><p class="text">' + html(step[key] || '—') + '</p>').join('') +
      (step.argv.length ? '<h3>Original command</h3><pre>' + html(operatingStepCommand(step)) + '</pre>' : '') +
      (step.selection ? '<details><summary>Original registration</summary><pre>' + html(JSON.stringify(step.selection, null, 2)) + '</pre></details>' : '') +
      '<ul>' + (step.files ?? []).map(file => '<li><a download="' + html(file.name) +
        '" href="data:application/octet-stream;base64,' + file.content + '">' + html(file.name) +
        '</a> · ' + file.bytes + ' bytes<p class="text">' + html(file.note) + '</p></li>').join('') + '</ul>' +
      '<p class="identity">' + html(row.planId) + ' / ' + html(row.stepId) + ' · saved ' + html(row.savedAt) + '</p></article>';
  }).join('');
  return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Operating work · ' + html(report.asOf) + '</title><style>body{font:15px/1.55 Arial,sans-serif;max-width:1040px;margin:auto;padding:2rem;color:#202326;background:white}article{border:1px solid #bbb;padding:1rem;margin:1rem 0}h1{font-size:1.6rem}h2{font-size:1.2rem}h3{font-size:1rem}pre,.text{white-space:pre-wrap;overflow-wrap:anywhere}a,.identity{overflow-wrap:anywhere}dl{display:grid;grid-template-columns:10rem 1fr;gap:.3rem}dd{margin:0}@media(max-width:600px){body{padding:1rem}dl{grid-template-columns:1fr}}@media print{details>pre{display:block}}</style></head><body>' +
    '<header><p>STARFORGE · OPERATING WORK</p><h1>Work as of ' + html(report.asOf) + '</h1><p>' +
    report.rows.length + ' matching saved steps in ' + selected.plans.length + ' complete source plans.</p>' +
    '<p>Dates are recorded calendar days. Undated work stays separate. Unfinished browser drafts are not saved results.</p>' +
    '<a download="operating-work-' + report.asOf + '.json" href="data:application/json;charset=utf-8,' + encodeURIComponent(complete) +
    '">Download the complete editable selection and source histories</a><details><summary>Exact selection filters</summary><pre>' +
    html(JSON.stringify(selected.options, null, 2)) + '</pre></details></header>' + (articles || '<p>No saved steps match this selection.</p>') +
    '<footer><p>Open the complete selection in Operating Plans. Receive its original plans through their existing history comparison before continuing work.</p></footer></body></html>\n';
}
