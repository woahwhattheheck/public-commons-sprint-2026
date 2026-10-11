// MIT. Operator mapping and profile validation; comparison stays in reconcile.mjs.
const ID = /^[A-Za-z][A-Za-z0-9_-]{0,79}$/;
const FIELD = /^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const SHA = /^[a-f0-9]{64}$/;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const WORKSPACE_SCHEMA = 'erp-conversion-workspace.v1';
export const REVIEW_SCHEMA = 'erp-conversion-workspace-review.v1';
export class WorkspaceError extends Error {
  constructor(code, message, status = 400) {
    super(message); this.name = 'WorkspaceError'; this.code = code; this.status = status;
  }
}
export const fail = (code, message, status) => { throw new WorkspaceError(code, message, status); };
const need = (test, code, message) => { if (!test) fail(code, message); };
const string = (value, label, maximum = 200, required = true) => {
  need(typeof value === 'string' && value.length <= maximum && (!required || value.trim()),
    'MAPPING_INVALID', `${label} is required and must be at most ${maximum} characters.`);
  need(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), 'MAPPING_INVALID', `${label} contains an unsupported control character.`);
  return value;
};
const name = (value, label) => { need(typeof value === 'string' && FIELD.test(value), 'MAPPING_INVALID', `${label} must use letters, digits and underscores, starting with a letter.`); return value; };
const unique = values => new Set(values).size === values.length;
const array = (value, label, maximum = 100) => { need(Array.isArray(value) && value.length <= maximum, 'MAPPING_INVALID', `${label} must be an array with at most ${maximum} entries.`); return value; };
const textList = (value, label, maximum = 100) => array(value, label, maximum).map(v => name(v, label));

function amount(value) {
  need(plain(value), 'MAPPING_INVALID', 'Each amount needs a name, scale and tolerance.');
  name(value.name, 'Amount name');
  need(Number.isInteger(value.scale) && value.scale >= 0 && value.scale <= 8, 'MAPPING_INVALID', 'Amount scale must be an integer from 0 to 8.');
  need(typeof value.tolerance === 'string' && /^\+?\d+(?:\.\d+)?$/.test(value.tolerance) && value.tolerance.length <= 100,
    'MAPPING_INVALID', 'Tolerance must be an exact non-negative decimal string.');
  need((value.tolerance.split('.')[1] ?? '').length <= value.scale, 'MAPPING_INVALID', 'Tolerance has more decimal places than its declared scale.');
  return { name: value.name, scale: value.scale, tolerance: value.tolerance };
}

export function validateProfile(input) {
  need(plain(input) && typeof input.id === 'string' && ID.test(input.id), 'PROFILE_INVALID', 'The profile needs a stable identifier.');
  const title = string(input.title, 'Profile title', 200);
  need(plain(input.source), 'PROFILE_INVALID', 'The profile needs its original source reference.');
  let url;
  try { url = new URL(input.source.url); } catch { fail('PROFILE_INVALID', 'The profile source must be an HTTPS URL.'); }
  need(url.protocol === 'https:' && !url.username && !url.password, 'PROFILE_INVALID', 'The profile source must be an HTTPS URL without credentials.');
  const source = { url: url.href, label: string(input.source.label ?? title, 'Source label', 200),
    sections: array(input.source.sections ?? [], 'Source sections', 30).map(v => string(String(v), 'Source section', 80)) };
  const cohorts = array(input.cohorts, 'Cohorts', 40).map(cohort => {
    need(plain(cohort) && ID.test(cohort.id), 'PROFILE_INVALID', 'Each cohort needs a stable identifier.');
    const keys = textList(cohort.keys ?? [], 'Cohort keys');
    const attributes = textList(cohort.attributes ?? [], 'Cohort attributes');
    const amounts = array(cohort.amounts ?? [], 'Cohort amounts').map(amount);
    const groupBy = textList(cohort.groupBy ?? [], 'Cohort groups');
    need(unique([...keys, ...attributes, ...amounts.map(v => v.name)]) && unique(groupBy) && groupBy.every(v => keys.includes(v)),
      'PROFILE_INVALID', 'Profile fields must be distinct and groups must select keys.');
    return { id: cohort.id, title: string(cohort.title, 'Cohort title', 200), purpose: string(cohort.purpose ?? '', 'Cohort purpose', 1000, false), keys, attributes, amounts, groupBy };
  });
  need(cohorts.length > 0 && unique(cohorts.map(v => v.id)), 'PROFILE_INVALID', 'The profile needs distinct cohorts.');
  const scenarios = array(input.scenarios ?? [], 'UAT scenarios', 40).map(scenario => {
    need(plain(scenario) && ID.test(scenario.id), 'PROFILE_INVALID', 'Each UAT scenario needs a stable identifier.');
    const selected = array(scenario.cohorts ?? [], 'Scenario cohorts', 40).map(v => string(v, 'Scenario cohort', 80));
    need(selected.every(v => cohorts.some(c => c.id === v)), 'PROFILE_INVALID', 'A UAT scenario refers to an unknown cohort.');
    return { id: scenario.id, title: string(scenario.title, 'Scenario title', 300), cohorts: selected };
  });
  need(unique(scenarios.map(v => v.id)), 'PROFILE_INVALID', 'UAT scenario identifiers must be distinct.');
  return { id: input.id, title, source, cohorts, scenarios };
}

// Inspect only the first CSV record to help select columns. The original engine
// remains responsible for parsing and validating the complete supplied files.
export function inspectCsvHeader(bytes, { complete = true } = {}) {
  need(bytes instanceof Uint8Array, 'CSV_HEADER_INVALID', 'CSV bytes are required.');
  let content;
  try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: !complete }); }
  catch { fail('CSV_HEADER_INVALID', 'The export must use UTF-8 text.'); }
  if (content.startsWith('\ufeff')) content = content.slice(1);
  const fields = []; let value = '', state = 0, finished = false;
  for (const c of content) {
    if (state === 1) { if (c === '"') state = 2; else value += c; }
    else if (state === 2) {
      if (c === '"') { value += c; state = 1; }
      else if (c === ',') { fields.push(value); value = ''; state = 0; }
      else if (c === '\n' || c === '\r') { fields.push(value); finished = true; break; }
      else fail('CSV_HEADER_INVALID', 'Unexpected content after a quoted CSV header.');
    } else if (c === '"') {
      need(value === '', 'CSV_HEADER_INVALID', 'A CSV header quote must begin its field.'); state = 1;
    } else if (c === ',') { fields.push(value); value = ''; }
    else if (c === '\n' || c === '\r') { fields.push(value); finished = true; break; }
    else value += c;
    need(value.length <= 1000 && fields.length <= 1000, 'CSV_HEADER_INVALID', 'The CSV header exceeds the supported inspection size.');
  }
  if (!finished) {
    need(complete && state !== 1, 'CSV_HEADER_INVALID', 'The complete CSV header must fit within 64 KiB.');
    fields.push(value);
  }
  const result = fields.map(v => v.trim());
  need(result.length > 0 && result.length <= 1000 && result.every(v => v && v.length <= 160) && unique(result),
    'CSV_HEADER_INVALID', 'CSV column names must be non-empty, unique and at most 160 characters.');
  return result;
}

function validateCrosswalk(input, keys) {
  if (input === null || input === undefined) return null;
  need(plain(input), 'CROSSWALK_INVALID', 'The crosswalk must contain keys and rows.');
  const selected = textList(input.keys, 'Crosswalk keys');
  need(selected.length > 0 && unique(selected) && selected.every(v => keys.includes(v)), 'CROSSWALK_INVALID', 'Select distinct reconciliation keys for the crosswalk.');
  const seen = new Set();
  const rows = array(input.rows, 'Crosswalk rows', 10000).map((row, index) => {
    need(plain(row), 'CROSSWALK_INVALID', `Crosswalk row ${index + 1} is invalid.`);
    const tuple = (values, side) => {
      need(Array.isArray(values) && values.length === selected.length, 'CROSSWALK_INVALID', `Crosswalk row ${index + 1} ${side} needs one value per selected key.`);
      return values.map(v => string(v, `Crosswalk row ${index + 1} ${side}`, 1000).trim().normalize('NFC'));
    };
    const source = tuple(row.source, 'source'), target = tuple(row.target, 'target');
    const identity = JSON.stringify(source);
    need(!seen.has(identity), 'CROSSWALK_INVALID', `Crosswalk row ${index + 1} repeats an earlier source tuple.`);
    seen.add(identity); return { source, target };
  });
  need(rows.length > 0, 'CROSSWALK_INVALID', 'An enabled crosswalk needs approved source and target tuples.');
  return { keys: selected, rows };
}

export function draftFromSpec(spec, fallbackProfile) {
  need(plain(spec), 'MAPPING_INVALID', 'A retained mapping is required.');
  const workspace = spec.workspace?.schema === WORKSPACE_SCHEMA ? spec.workspace : null;
  const profile = validateProfile(workspace?.profile ?? fallbackProfile);
  const fields = [
    ...(spec.keys ?? []).map(name => ({ name, type: 'key', grouped: (spec.group_by ?? []).includes(name) })),
    ...(spec.attributes ?? []).map(name => ({ name, type: 'attribute' })),
    ...(spec.amounts ?? []).map(value => ({ ...value, type: 'amount' })),
  ].map(field => ({ ...field, source: spec.source_columns?.[field.name] ?? '', target: spec.target_columns?.[field.name] ?? '' }));
  return { profile, cohortId: workspace?.cohortId ?? profile.cohorts[0].id, dataset: spec.dataset,
    fields, scope: { ...(workspace?.scope ?? {}) }, crosswalk: spec.source_key_crosswalk ?? null,
    correctionReason: '', headers: workspace?.headers ?? { source: [...new Set(Object.values(spec.source_columns ?? {}))], target: [...new Set(Object.values(spec.target_columns ?? {}))] },
    inputs: workspace?.inputs ?? { source: { name: 'Retained source export' }, target: { name: 'Retained target export' } } };
}

export function newDraft(profileInput, cohortId) {
  const profile = validateProfile(profileInput), cohort = profile.cohorts.find(v => v.id === cohortId) ?? profile.cohorts[0];
  return { ...draftFromSpec({ dataset: cohort.title, keys: cohort.keys, attributes: cohort.attributes,
    amounts: cohort.amounts, group_by: cohort.groupBy }, profile), cohortId: cohort.id };
}

export function compileDraft(draft, { profile: profileInput, headers, inputs, previous = null } = {}) {
  need(plain(draft), 'MAPPING_INVALID', 'A mapping draft is required.');
  const profile = validateProfile(profileInput);
  need(profile.cohorts.some(v => v.id === draft.cohortId), 'MAPPING_INVALID', 'Select a cohort from the retained profile.');
  const dataset = string(draft.dataset, 'Dataset name', 160);
  need(plain(headers) && ['source', 'target'].every(side => Array.isArray(headers[side])), 'MAPPING_INVALID', 'Inspect both export headers before staging.');
  const fields = array(draft.fields, 'Mapping fields').map(field => {
    need(plain(field) && ['key', 'attribute', 'amount'].includes(field.type), 'MAPPING_INVALID', 'Each mapping field needs a valid type.');
    name(field.name, 'Logical field name');
    for (const side of ['source', 'target']) need(headers[side].includes(field[side]), 'MAPPING_INVALID', `Choose an observed ${side} column for ${field.name}.`);
    return field;
  });
  need(unique(fields.map(v => v.name)), 'MAPPING_INVALID', 'Logical field names must be distinct across keys, text and amounts.');
  const keys = fields.filter(v => v.type === 'key').map(v => v.name);
  need(keys.length > 0, 'MAPPING_INVALID', 'Choose at least one stable unique record key.');
  const attributes = fields.filter(v => v.type === 'attribute').map(v => v.name);
  const amounts = fields.filter(v => v.type === 'amount').map(amount);
  const group_by = fields.filter(v => v.type === 'key' && v.grouped === true).map(v => v.name);
  const source_columns = Object.fromEntries(fields.map(v => [v.name, v.source]));
  const target_columns = Object.fromEntries(fields.map(v => [v.name, v.target]));
  const crosswalk = validateCrosswalk(draft.crosswalk, keys);
  need(plain(draft.scope), 'MAPPING_INVALID', 'Conversion responsibility and scope are required.');
  const scope = {};
  for (const key of ['period', 'sourceSystem', 'targetSystem', 'conversionOwner', 'coverage', 'excludedHistory', 'resources', 'timeline'])
    scope[key] = string(draft.scope[key] ?? '', key, ['coverage', 'excludedHistory', 'resources', 'timeline'].includes(key) ? 2000 : 200, ['conversionOwner', 'coverage'].includes(key));
  const correctionReason = string(draft.correctionReason ?? '', 'Correction reason', 2000, !!previous);
  const retainedInputs = {};
  for (const side of ['source', 'target']) retainedInputs[side] = { name: string(inputs?.[side]?.name ?? '', `${side} filename`, 255) };
  if (previous) need(SHA.test(previous.bundleId) && (!previous.jobId || /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(previous.jobId)), 'MAPPING_INVALID', 'The preceding bundle/job identity is invalid.');
  const revision = previous ? (previous.revision ?? 0) + 1 : 1;
  need(Number.isSafeInteger(revision) && revision > 0, 'MAPPING_INVALID', 'The mapping revision is invalid.');
  return { version: 1, dataset, keys, amounts, ...(attributes.length ? { attributes } : {}), source_columns, target_columns, group_by,
    ...(crosswalk ? { source_key_crosswalk: crosswalk } : {}),
    workspace: { schema: WORKSPACE_SCHEMA, profile, cohortId: draft.cohortId, scope, revision,
      previous: previous ? { bundleId: previous.bundleId, ...(previous.jobId ? { jobId: previous.jobId } : {}) } : null,
      correctionReason, headers: { source: [...headers.source], target: [...headers.target] }, inputs: retainedInputs } };
}

export function reviewNote({ comment = '', observations = [] } = {}, profile) {
  string(comment, 'Review note', 3000, false);
  const items = array(observations, 'UAT observations', 40).map(item => {
    need(plain(item) && profile.scenarios.some(v => v.id === item.id) && ['passed', 'failed', 'not_applicable'].includes(item.status),
      'REVIEW_INVALID', 'Each recorded UAT observation needs a profile scenario and a result.');
    return { id: item.id, status: item.status, note: string(item.note ?? '', 'UAT observation', 1000, false) };
  });
  need(unique(items.map(v => v.id)), 'REVIEW_INVALID', 'Record each UAT scenario once per review.');
  const encoded = JSON.stringify({ schema: REVIEW_SCHEMA, comment, observations: items });
  need(encoded.length <= 4000, 'REVIEW_INVALID', 'This review exceeds 4,000 characters. Shorten its notes or record another versioned review.');
  return encoded;
}

export function parseReviewNote(value) {
  try { const result = JSON.parse(value); if (result?.schema === REVIEW_SCHEMA && typeof result.comment === 'string' && Array.isArray(result.observations)) return result; } catch {}
  return { comment: String(value ?? ''), observations: [] };
}
