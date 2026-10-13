// MIT. OAuth Support procedures use the original OperatingPlan model and case artifacts.
import {createOperatingPlan, createOperatingStep, snapshotRegistration, inspectOperatingPlan,
  operatingPlanDraft, saveOperatingPlanRevision} from './operating-plan.mjs';

export const SUPPORT_OPERATING_SOURCE_SCHEMA = 'stellar-forge.oauth-support-operating-source.v1';
export const SUPPORT_OPERATING_PHASES = Object.freeze([
  'sources', 'authority', 'observation', 'response', 'recovery', 'case', 'handover'
]);
const BINDING_SCHEMA = 'stellar-forge.oauth-support-operating-binding.v1';
const RESULT_SCHEMA = 'stellar-forge.oauth-support-operating-result.v1';
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const plain = value => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const copy = value => JSON.parse(JSON.stringify(value));
const fail = (code, message) => { throw Object.assign(new TypeError(message), {code}); };
const need = (condition, code, message) => { if (!condition) fail(code, message); };
function fields(value, allowed, label) {
  need(plain(value) && Object.keys(value).every(key => allowed.includes(key)),
    'SUPPORT_PLAN_FIELDS', label + ' contains unsupported fields.');
}
function text(value, label, maximum = 2000, required = true) {
  need(typeof value === 'string' && value.length <= maximum &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) &&
    (!required || value.trim().length > 0), 'SUPPORT_PLAN_TEXT', label + ' must be valid text.');
  return value;
}
function hash(value, label) {
  need(typeof value === 'string' && HASH.test(value), 'SUPPORT_PLAN_HASH', label + ' must be a SHA-256 identity.');
  return value;
}
function time(value, label) {
  need(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,19) === value.slice(0,19),
    'SUPPORT_PLAN_TIME', label + ' must be an actual UTC timestamp.');
  return value;
}
function artifact(value, label) {
  fields(value, ['path', 'bytes', 'sha256'], label);
  text(value.path, label + ' path', 2000);
  need(!value.path.startsWith('/') && !value.path.includes('\\') &&
    !value.path.split('/').some(part => !part || part === '.' || part === '..') &&
    !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value.path), 'SUPPORT_PLAN_PATH',
    label + ' must name a relative file inside the retained source package.');
  need(Number.isSafeInteger(value.bytes) && value.bytes >= 0, 'SUPPORT_PLAN_SIZE', label + ' has an invalid byte length.');
  hash(value.sha256, label + ' hash');
}
function jsonObject(value, label) {
  need(plain(value), 'SUPPORT_PLAN_OBJECT', label + ' must retain the original JSON object.');
  let encoded;
  try { encoded = JSON.stringify(value); } catch { fail('SUPPORT_PLAN_JSON', label + ' must be serializable JSON.'); }
  need(encoded.length <= 16000, 'SUPPORT_PLAN_SIZE', label + ' exceeds the descriptor field limit.');
  const walk = item => {
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return;
    if (typeof item === 'number') { need(Number.isFinite(item), 'SUPPORT_PLAN_JSON', label + ' has a non-finite number.'); return; }
    if (Array.isArray(item)) { item.forEach(walk); return; }
    need(plain(item), 'SUPPORT_PLAN_JSON', label + ' must contain JSON values.');
    for (const [key, child] of Object.entries(item)) {
      need(!['__proto__','constructor','prototype'].includes(key), 'SUPPORT_PLAN_JSON', label + ' has an unsupported key.');
      walk(child);
    }
  };
  walk(value);
}
function capture(value, label) {
  if (value === null) return;
  fields(value, ['kind', 'routeId', 'registration', 'resource', 'configurationSha256',
    'sessionId', 'startedAt', 'capturedAt', 'sequence', 'collectionStartedAt', 'collectedAt', 'coverage', 'files'], label);
  need(value.kind === 'OAUTH_RESOURCE', 'SUPPORT_PLAN_CAPTURE', label + ' must be an original OAuth resource capture.');
  text(value.routeId, label + ' route', 512);
  fields(value.registration, ['id', 'label'], label + ' registration');
  text(value.registration.id, label + ' registration ID', 512);
  text(value.registration.label, label + ' registration label', 1000, false);
  if (value.resource !== null) text(value.resource, label + ' resource', 4000);
  if (value.configurationSha256 !== null) hash(value.configurationSha256, label + ' configuration');
  if (value.sessionId !== null) text(value.sessionId, label + ' session', 512);
  if (value.startedAt !== null) time(value.startedAt, label + ' session start');
  if (value.capturedAt !== null) time(value.capturedAt, label + ' capture time');
  time(value.collectionStartedAt, label + ' collection start'); time(value.collectedAt, label + ' collection time');
  need(value.sequence === null || Number.isSafeInteger(value.sequence) && value.sequence >= 0,
    'SUPPORT_PLAN_CAPTURE', label + ' has an invalid sequence.');
  fields(value.coverage, ['state','windowComplete','sourceError','identityContradiction'], label + ' coverage');
  need(['COMPLETE','SOURCE_UNAVAILABLE','IDENTITY_CHANGED','OBSERVER_INCOMPLETE'].includes(value.coverage.state),
    'SUPPORT_PLAN_COVERAGE', label + ' must retain the original source coverage state.');
  need(value.coverage.windowComplete === null || typeof value.coverage.windowComplete === 'boolean',
    'SUPPORT_PLAN_COVERAGE', label + ' must retain the original source window completeness.');
  jsonObject(value.coverage, label + ' coverage');
  fields(value.files, ['oauth-observation.json', 'oauth-source.json'], label + ' files');
  for (const name of ['oauth-observation.json', 'oauth-source.json']) artifact(value.files[name], label + ' ' + name);
}
/** Inspect a compact descriptor. Exact artifact bytes and full case history are received by SF74. */
export function inspectSupportOperatingSource(value) {
  fields(value, ['schema','id','capturedAt','case','artifacts','captures','actions','incidentSource','nativeDelivery','evidence'], 'Support source');
  need(value.schema === SUPPORT_OPERATING_SOURCE_SCHEMA, 'SUPPORT_PLAN_SCHEMA', 'Choose an OAuth Support operating source.');
  need(typeof value.id === 'string' && ID.test(value.id), 'SUPPORT_PLAN_ID', 'The source needs its original stable ID.');
  time(value.capturedAt, 'Source capture time');
  fields(value.case, ['id','revision','currentRevision','createdAt','updatedAt','ancestors'], 'Original case');
  need(typeof value.case.id === 'string' && UUID.test(value.case.id), 'SUPPORT_PLAN_CASE', 'The original SF74 case ID is invalid.');
  hash(value.case.revision, 'Selected case revision'); hash(value.case.currentRevision, 'Current case revision');
  time(value.case.createdAt, 'Case creation time'); time(value.case.updatedAt, 'Case update time');
  need(Array.isArray(value.case.ancestors) && value.case.ancestors.length <= 100000,
    'SUPPORT_PLAN_CASE', 'Keep the original selected revision ancestors.');
  value.case.ancestors.forEach(revision => hash(revision, 'Case ancestor'));
  need(new Set(value.case.ancestors).size === value.case.ancestors.length &&
    !value.case.ancestors.includes(value.case.revision), 'SUPPORT_PLAN_CASE', 'Case ancestors must be unique prior revisions.');
  fields(value.artifacts, ['caseSnapshot','workspace','runtime','handoff','report','html'], 'Source artifacts');
  for (const key of ['caseSnapshot','workspace','runtime']) artifact(value.artifacts[key], key);
  for (const key of ['handoff','report','html']) if (value.artifacts[key] !== undefined) artifact(value.artifacts[key], key);
  fields(value.captures, ['before','after'], 'OAuth captures');
  capture(value.captures.before, 'Before capture'); capture(value.captures.after, 'After capture');
  need(value.captures.before !== null || value.captures.after !== null,
    'SUPPORT_PLAN_CAPTURE', 'The source must retain at least one original OAuth capture.');
  need(Array.isArray(value.actions) && value.actions.length <= 10000, 'SUPPORT_PLAN_ACTIONS', 'Keep the original report queue.');
  for (const row of value.actions) {
    fields(row, ['source','routeId','kind','action'], 'Original queue row');
    for (const key of ['source','routeId','kind','action']) text(row[key], 'Queue ' + key, 8000, false);
  }
  if (value.incidentSource !== null) {
    fields(value.incidentSource, ['id','configurationRevision'], 'Incident source');
    text(value.incidentSource.id, 'Incident source ID', 512);
    hash(value.incidentSource.configurationRevision, 'Incident source configuration');
  }
  if (value.nativeDelivery !== null) artifact(value.nativeDelivery, 'Complete native delivery');
  need(Array.isArray(value.evidence) && value.evidence.length <= 10000, 'SUPPORT_PLAN_EVIDENCE', 'Keep the original returned result references.');
  const evidenceIds = new Set();
  for (const row of value.evidence) {
    fields(row, ['id','role','artifact'], 'Returned evidence');
    text(row.id, 'Evidence ID', 2000); text(row.role, 'Evidence role', 512);
    need(!evidenceIds.has(row.id), 'SUPPORT_PLAN_EVIDENCE', 'Returned evidence IDs must be unique.');
    evidenceIds.add(row.id); artifact(row.artifact, 'Returned evidence');
  }
  const paths = new Map();
  const refs = [...Object.values(value.artifacts), ...(value.nativeDelivery ? [value.nativeDelivery] : []),
    ...Object.values(value.captures).filter(Boolean).flatMap(item => Object.values(item.files)),
    ...value.evidence.map(item => item.artifact)];
  for (const ref of refs) {
    const prior = paths.get(ref.path);
    need(!prior || prior.bytes === ref.bytes && prior.sha256 === ref.sha256,
      'SUPPORT_PLAN_ARTIFACT_CONFLICT', 'A retained path has two different byte identities: ' + ref.path);
    paths.set(ref.path, ref);
  }
  return copy(value);
}
const DEFINITIONS = [
  ['sources', 'Receive the selected Support case',
    'Open the complete native case delivery and verify the retained workspace, runtime, source pair and selected case revision. Keep later local case editions when receiving an older delivery.',
    'The original case and its complete source files reopen, with the selected revision and local current revision visible.'],
  ['authority', 'Review the source and current authority',
    'Review the registered source, configuration revision, protected resource, capture session, coverage and source age. Read the currently installed registration and current provider state before relying on an older capture.',
    'The operating owner records which retained capture and current source configuration apply to this work.'],
  ['observation', 'Inspect the original OAuth observation',
    'Use the selected installed command or the original Support console to inspect authentication, authorization, host authority and provider stages. Retain the returned source pair and request or session identifiers.',
    'The selected original observation is attached with its coverage, time and source identity.'],
  ['response', 'Work the original repair queue',
    'Review the original report queue and choose the appropriate response through the existing Support controls. Assign the response owner and record the actual returned result and its source file.',
    'The reviewed response has an owner and a retained returned result for the original case.'],
  ['recovery', 'Review the returned recovery',
    'Inspect the subsequent original capture and comparison. Check the changed provider or policy condition against its coverage and retained source, then record the observed recovery outcome.',
    'The before and after source pair and original comparison support the recorded recovery outcome.'],
  ['case', 'Save the customer case continuation',
    'Save through the existing SF74 case store using the selected current case revision. Reopen the saved edition, preserve prior history and keep any later local case head.',
    'The complete saved case, selected revision and next owner are retained for continuation.'],
  ['handover', 'Deliver the editable operating plan and case',
    'Export the full OperatingPlan JSON history together with the separate complete native case delivery and compact source descriptor. Receive the plan through its original prefix-history merge and reopen the native case.',
    'The recipient can edit the same plan, inspect its source, and continue the original case with both histories preserved.']
];
function phaseMap(value, label) {
  fields(value, SUPPORT_OPERATING_PHASES, label);
}
function binding(source) {
  return {schema:BINDING_SCHEMA, sourceId:source.id, capturedAt:source.capturedAt,
    case:{id:source.case.id, revision:source.case.revision},
    artifacts:{caseSnapshot:source.artifacts.caseSnapshot, workspace:source.artifacts.workspace, runtime:source.artifacts.runtime},
    incidentSource:source.incidentSource};
}
function phaseInputs(source, phase) {
  const compactCapture = value => value && {routeId:value.routeId, registration:value.registration,
    resource:value.resource, configurationSha256:value.configurationSha256, sessionId:value.sessionId,
    capturedAt:value.capturedAt, sequence:value.sequence, collectionStartedAt:value.collectionStartedAt,
    collectedAt:value.collectedAt, coverage:value.coverage, files:value.files};
  const base = {sourceId:source.id, capturedAt:source.capturedAt, case:binding(source).case};
  if (phase === 'sources' || phase === 'case' || phase === 'handover')
    return {...base, artifacts:source.artifacts, nativeDelivery:source.nativeDelivery};
  if (phase === 'authority') return {...base, incidentSource:source.incidentSource,
    before:compactCapture(source.captures.before), after:compactCapture(source.captures.after),
    currentAuthority:'Read the current configuration and provider state when carrying out this step.'};
  if (phase === 'response') return {...base, report:source.artifacts.report ?? null,
    queueRows:source.actions.length, queueSource:'The full original queue remains in the source descriptor and native report.'};
  return {...base, before:compactCapture(source.captures.before), after:compactCapture(source.captures.after),
    report:source.artifacts.report ?? null};
}
/** Author an ordinary, fully editable plan. Registration snapshots come from the actual catalog. */
export function createSupportOperatingPlan({source, catalog, id, title = 'OAuth Support operating plan',
  customer = '', owner = '', period = '', savedAt = new Date().toISOString(),
  registrations = {}, argvByPhase = {}} = {}) {
  const selected = inspectSupportOperatingSource(source);
  phaseMap(registrations, 'Selected registrations'); phaseMap(argvByPhase, 'Selected command arguments');
  const steps = DEFINITIONS.map(([phase, heading, instruction, expectedResult]) => {
    const itemId = registrations[phase];
    if (itemId !== undefined) text(itemId, 'Selected catalog ID', 2000);
    const selection = itemId === undefined ? null : snapshotRegistration(catalog, itemId);
    const argv = argvByPhase[phase] ?? [];
    need(selection !== null || argv.length === 0, 'SUPPORT_PLAN_REGISTRATION_REQUIRED',
      'Choose the original catalog registration before retaining command arguments for ' + phase + '.');
    return createOperatingStep({id:'support-' + phase, title:heading, instruction,
      inputs:JSON.stringify(phaseInputs(selected, phase), null, 2), expectedResult,
      owner, status:'planned', recordedResult:'', selection, argv});
  });
  return createOperatingPlan({id, title, customer, owner, period, savedAt, steps,
    purpose:'Operate the original OAuth Support case from its retained source through response, recovery and customer continuation.',
    receiving:'Receive the complete editable OperatingPlan JSON with its entire revision history. Carry the separate native SF74 case delivery and source files alongside it; use the existing case receiving route to verify their bytes and history.',
    notes:JSON.stringify(binding(selected), null, 2)});
}
function originalBinding(plan) {
  let value;
  try { value = JSON.parse(plan.revisions[0].notes); } catch { fail('SUPPORT_PLAN_BINDING', 'The first plan revision has no original Support source binding.'); }
  need(value?.schema === BINDING_SCHEMA && UUID.test(value.case?.id ?? '') && HASH.test(value.case?.revision ?? ''),
    'SUPPORT_PLAN_BINDING', 'Use a plan created from the original OAuth Support source.');
  return value;
}
/** Append a reviewed outcome; evidence references always come from the supplied original source. */
export function recordSupportOperatingResult(plan, {source, stepId, status, result, owner,
  savedAt = new Date().toISOString()} = {}) {
  const current = inspectOperatingPlan(plan), selected = inspectSupportOperatingSource(source);
  const original = originalBinding(current);
  need(selected.case.id === original.case.id && (selected.case.revision === original.case.revision ||
    selected.case.ancestors.includes(original.case.revision)), 'SUPPORT_PLAN_CASE_LINEAGE',
    'The returned result must belong to the original case revision or its retained continuation.');
  need(SUPPORT_OPERATING_PHASES.some(phase => stepId === 'support-' + phase),
    'SUPPORT_PLAN_STEP', 'Select an original Support procedure step.');
  need(['planned','in-progress','completed','skipped'].includes(status), 'SUPPORT_PLAN_STATUS', 'Select an ordinary recorded step status.');
  fields(result, ['summary','evidenceIds'], 'Reviewed result');
  text(result.summary, 'Reviewed result summary', 16000);
  need(Array.isArray(result.evidenceIds) && result.evidenceIds.length <= 100 &&
    result.evidenceIds.every(value => typeof value === 'string') &&
    new Set(result.evidenceIds).size === result.evidenceIds.length,
    'SUPPORT_PLAN_EVIDENCE', 'Select distinct returned evidence IDs.');
  const evidence = result.evidenceIds.map(id => {
    const row = selected.evidence.find(item => item.id === id);
    need(row, 'SUPPORT_PLAN_EVIDENCE', 'The selected source has no returned evidence with ID ' + id + '.');
    return row;
  });
  need(status !== 'completed' || evidence.length > 0, 'SUPPORT_PLAN_EVIDENCE_REQUIRED',
    'Attach at least one original returned result when recording this step as completed.');
  const draft = operatingPlanDraft(current), step = draft.content.steps.find(item => item.id === stepId);
  need(step, 'SUPPORT_PLAN_STEP', 'This step was removed from the current plan. Keep the current draft or restore it explicitly.');
  if (owner !== undefined) step.owner = text(owner, 'Operating owner', 300, false);
  step.status = status;
  step.recordedResult = JSON.stringify({schema:RESULT_SCHEMA, summary:result.summary, reviewedBy:step.owner,
    source:{id:selected.id, capturedAt:selected.capturedAt, case:binding(selected).case}, evidence}, null, 2);
  return saveOperatingPlanRevision(current, draft, {savedAt});
}
