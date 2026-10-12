// MIT. Source-bound opportunity decisions beside the maintained SF88 dossier.
import { readdir, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  privateDirectory, writeJson, readJson, readBytes, writeBytes,
  digest, jsonBytes, parseJson, object,
} from '../../sf88-operator-buyer-cli/node/store.mjs';
import { openDossierStore } from '../../sf88-operator-buyer-cli/research-dossiers/dossier.mjs';
import {
  SOURCE_ROLES, sourceUrl, sourceTime, retainOpportunitySource, retainAwardEdition,
  selectDossierRevision, validateOpportunitySource, readOpportunitySource, bindOpportunityEvidence,
} from './sources.mjs';
import {
  MAX_PACKAGE_BYTES, createOpportunitySnapshot, assembleOpportunityPackage,
  validateOpportunityPackage, validateOpportunitySnapshot, opportunityHandoffReadiness,
} from './package.mjs';

export const OPPORTUNITY_SCHEMA = 'stellar-forge.opportunity-workspace.v1';
const MAX_STATE = 8 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const PROJECT_ID = /^opp_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const ARRAYS = ['sources', 'capabilities', 'requirements', 'coverage', 'teaming', 'milestones', 'questions', 'changes', 'packages'];
const clone = value => structuredClone(value);
const timestamp = () => new Date().toISOString();
const newId = prefix => prefix + '_' + randomUUID();
const fileName = revision => String(revision).padStart(8, '0') + '.json';

export class OpportunityError extends Error {
  constructor(code, message = code, status = 400, details = {}) {
    super(message); this.name = 'OpportunityError'; this.code = code; this.status = status; this.details = details;
  }
  toJSON() { return {error: this.code, message: this.message, details: this.details}; }
}
function check(ok, code, message = code, status = 400, details = {}) {
  if (!ok) throw new OpportunityError(code, message, status, details);
}
function text(value, code, max = 4000, empty = false) {
  check(typeof value === 'string' && value.length <= max && (empty || value.trim()), code);
  return value;
}
function strings(value, code, max = 200) {
  check(Array.isArray(value) && value.length <= max &&
    value.every(item => typeof item === 'string' && item.length > 0 && item.length <= 512) &&
    new Set(value).size === value.length, code);
  return clone(value);
}
function choice(value, values, code) { check(values.includes(value), code); return value; }
function optionalTime(value = '') { return value === '' ? '' : sourceTime(value); }
function zone(value = '') {
  value = text(value, 'TIME_ZONE_INVALID', 160, true);
  if (value) { try { new Intl.DateTimeFormat('en', {timeZone: value}); }
    catch { check(false, 'TIME_ZONE_INVALID'); } }
  return value;
}
function recordId(value, prefix) {
  check(typeof value === 'string' && new RegExp('^' + prefix + '_[a-f0-9-]{36}$').test(value), 'RECORD_ID_INVALID');
  return value;
}
function company(value = {}) {
  check(object(value), 'COMPANY_INVALID');
  return {name: text(value.name ?? '', 'COMPANY_NAME_INVALID', 240, true),
    website: sourceUrl(value.website), uei: text(value.uei ?? '', 'COMPANY_UEI_INVALID', 100, true),
    naics: strings(value.naics ?? [], 'COMPANY_NAICS_INVALID', 100),
    size: text(value.size ?? '', 'COMPANY_SIZE_INVALID', 200, true),
    description: text(value.description ?? '', 'COMPANY_DESCRIPTION_INVALID', 30000, true)};
}
function opportunity(value = {}) {
  check(object(value), 'OPPORTUNITY_INVALID');
  return {title: text(value.title ?? '', 'OPPORTUNITY_TITLE_INVALID', 500, true),
    buyer: text(value.buyer ?? '', 'OPPORTUNITY_BUYER_INVALID', 500, true),
    reference: text(value.reference ?? '', 'OPPORTUNITY_REFERENCE_INVALID', 240, true),
    url: sourceUrl(value.url), documentKind: choice(value.documentKind ?? 'other',
      ['rfi', 'sources_sought', 'solicitation', 'implementation_target', 'other'], 'DOCUMENT_KIND_INVALID'),
    stage: choice(value.stage ?? 'research', ['research', 'qualifying', 'preparing', 'submitted', 'closed'], 'OPPORTUNITY_STAGE_INVALID'),
    dueAt: optionalTime(value.dueAt), timeZone: zone(value.timeZone),
    notes: text(value.notes ?? '', 'OPPORTUNITY_NOTES_INVALID', 50000, true)};
}
function rules(state, value = {}) {
  check(object(value), 'RESPONSE_RULES_INVALID');
  const positive = (number, code) => {
    if (number === undefined || number === null || number === '') return null;
    check(Number.isSafeInteger(number) && number >= 1 && number <= 10000, code); return number;
  };
  return {maxPages: positive(value.maxPages, 'PAGE_LIMIT_INVALID'),
    capabilityMaxPages: positive(value.capabilityMaxPages, 'CAPABILITY_PAGE_LIMIT_INVALID'),
    excludedSections: strings(value.excludedSections ?? [], 'PAGE_EXCLUSIONS_INVALID', 100),
    notes: text(value.notes ?? '', 'RESPONSE_RULES_NOTES_INVALID', 50000, true),
    evidence: bindOpportunityEvidence(state, value.evidence ?? [])};
}
function references(state, values, collection, code) {
  values = strings(values ?? [], code);
  check(values.every(id => state[collection].some(row => row.id === id)), code);
  return values;
}
function entityMetadata(previous, operator, at) {
  return {createdAt: previous?.createdAt ?? at, createdBy: previous?.createdBy ?? operator,
    updatedAt: at, updatedBy: operator, version: (previous?.version ?? 0) + 1};
}
function normalizeCapability(state, value) {
  const result = {
    title: text(value.title, 'CAPABILITY_TITLE_REQUIRED', 500),
    kind: choice(value.kind ?? 'capability', ['capability', 'past_performance'], 'CAPABILITY_KIND_INVALID'),
    description: text(value.description ?? '', 'CAPABILITY_DESCRIPTION_INVALID', 100000, true),
    owner: text(value.owner ?? '', 'OWNER_INVALID', 240, true),
    status: choice(value.status ?? 'draft', ['draft', 'reviewed', 'retired'], 'CAPABILITY_STATUS_INVALID'),
    deliveryStatus: choice(value.deliveryStatus ?? 'unspecified', ['unspecified', 'deployed', 'pilot', 'proposed'], 'DELIVERY_STATUS_INVALID'),
    tags: strings(value.tags ?? [], 'CAPABILITY_TAGS_INVALID', 100),
    evidence: bindOpportunityEvidence(state, value.evidence ?? []),
  };
  check(result.status !== 'reviewed' || result.evidence.length > 0, 'REVIEWED_CAPABILITY_SOURCE_REQUIRED',
    'A reviewed capability needs retained source evidence.');
  return result;
}
function normalizeRequirement(state, value) {
  check(typeof value.mandatory === 'boolean', 'REQUIREMENT_MANDATORY_REQUIRED');
  return {number: text(value.number, 'REQUIREMENT_NUMBER_REQUIRED', 100),
    title: text(value.title, 'REQUIREMENT_TITLE_REQUIRED', 500),
    text: text(value.text, 'REQUIREMENT_TEXT_REQUIRED', 100000),
    category: text(value.category ?? '', 'REQUIREMENT_CATEGORY_INVALID', 240, true),
    mandatory: value.mandatory,
    responseDisposition: choice(value.responseDisposition ?? 'unanswered',
      ['unanswered', 'answer', 'not_applicable'], 'RESPONSE_DISPOSITION_INVALID'),
    evidenceRule: choice(value.evidenceRule ?? 'any', ['any', 'deployed_only'], 'EVIDENCE_RULE_INVALID'),
    owner: text(value.owner ?? '', 'OWNER_INVALID', 240, true),
    status: choice(value.status ?? 'open', ['open', 'in_progress', 'reviewed', 'retired'], 'REQUIREMENT_STATUS_INVALID'),
    evidence: bindOpportunityEvidence(state, value.evidence ?? [])};
}
function normalizeTeam(state, value) {
  return {name: text(value.name, 'TEAM_NAME_REQUIRED', 500),
    role: text(value.role ?? '', 'TEAM_ROLE_INVALID', 500, true),
    decision: choice(value.decision ?? 'considering', ['considering', 'contacted', 'confirmed', 'declined'], 'TEAM_DECISION_INVALID'),
    owner: text(value.owner ?? '', 'OWNER_INVALID', 240, true),
    scope: text(value.scope ?? '', 'TEAM_SCOPE_INVALID', 50000, true),
    note: text(value.note ?? '', 'TEAM_NOTE_INVALID', 50000, true),
    capabilityIds: references(state, value.capabilityIds, 'capabilities', 'TEAM_CAPABILITIES_INVALID'),
    requirementIds: references(state, value.requirementIds, 'requirements', 'TEAM_REQUIREMENTS_INVALID'),
    evidence: bindOpportunityEvidence(state, value.evidence ?? [])};
}
function normalizeMilestone(state, value) {
  return {title: text(value.title, 'MILESTONE_TITLE_REQUIRED', 500),
    owner: text(value.owner ?? '', 'OWNER_INVALID', 240, true),
    dueAt: optionalTime(value.dueAt), timeZone: zone(value.timeZone),
    status: choice(value.status ?? 'open', ['open', 'in_progress', 'done', 'cancelled'], 'MILESTONE_STATUS_INVALID'),
    dependsOn: references(state, value.dependsOn, 'milestones', 'MILESTONE_DEPENDENCIES_INVALID'),
    requirementIds: references(state, value.requirementIds, 'requirements', 'MILESTONE_REQUIREMENTS_INVALID'),
    evidence: bindOpportunityEvidence(state, value.evidence ?? []),
    note: text(value.note ?? '', 'MILESTONE_NOTE_INVALID', 50000, true)};
}
function normalizeQuestion(state, value) {
  const result = {number: text(value.number ?? '', 'QUESTION_NUMBER_INVALID', 100, true),
    text: text(value.text, 'QUESTION_TEXT_REQUIRED', 50000),
    owner: text(value.owner ?? '', 'OWNER_INVALID', 240, true), dueAt: optionalTime(value.dueAt),
    status: choice(value.status ?? 'open', ['open', 'submitted', 'answered', 'parked'], 'QUESTION_STATUS_INVALID'),
    answer: text(value.answer ?? '', 'QUESTION_ANSWER_INVALID', 100000, true),
    requirementIds: references(state, value.requirementIds, 'requirements', 'QUESTION_REQUIREMENTS_INVALID'),
    evidence: bindOpportunityEvidence(state, value.evidence ?? [])};
  check(result.status !== 'answered' || result.answer.trim(), 'QUESTION_ANSWER_REQUIRED');
  return result;
}
function graph(state) {
  const seen = new Set(), visiting = new Set(), nodes = new Map(state.milestones.map(row => [row.id, row]));
  function visit(id) {
    check(!visiting.has(id), 'MILESTONE_DEPENDENCY_CYCLE');
    if (seen.has(id)) return;
    const node = nodes.get(id); check(node, 'MILESTONE_DEPENDENCY_NOT_FOUND');
    visiting.add(id);
    for (const dependency of node.dependsOn) visit(dependency);
    visiting.delete(id); seen.add(id);
  }
  for (const row of state.milestones) visit(row.id);
}
const evidenceCollections = ['capabilities', 'requirements', 'coverage', 'teaming', 'milestones', 'questions'];
function affectedRecords(state, sourceId) {
  const affected = new Set();
  for (const name of evidenceCollections) for (const row of state[name])
    if (row.evidence.some(ref => ref.sourceId === sourceId)) affected.add(row.id);
  for (const row of state.coverage) if (affected.has(row.requirementId) ||
    row.capabilityIds.some(id => affected.has(id)) || row.teamIds.some(id => affected.has(id))) affected.add(row.id);
  if (state.responseRules.evidence.some(ref => ref.sourceId === sourceId)) affected.add('responseRules');
  return [...affected];
}
function validEvidence(state, rows) {
  const expected = bindOpportunityEvidence(state, rows);
  check(JSON.stringify(rows) === JSON.stringify(expected), 'EVIDENCE_BINDING_CHANGED');
}
function validateState(state) {
  check(object(state) && state.schema === OPPORTUNITY_SCHEMA && PROJECT_ID.test(state.id) &&
    Number.isSafeInteger(state.revision) && state.revision >= 1 && state.revision < 100000000 &&
    (state.previous === null || HASH.test(state.previous)), 'OPPORTUNITY_STATE_INVALID');
  text(state.title, 'TITLE_REQUIRED', 500); text(state.description, 'DESCRIPTION_INVALID', 50000, true);
  company(state.company); opportunity(state.opportunity);
  sourceTime(state.createdAt); sourceTime(state.updatedAt);
  check(object(state.change) && typeof state.change.action === 'string' && typeof state.change.operator === 'string',
    'OPPORTUNITY_CHANGE_INVALID');
  check(object(state.dossier) && /^d_[a-f0-9-]{36}$/.test(state.dossier.id) &&
    /^q_[a-f0-9-]{36}$/.test(state.dossier.questionId) &&
    Number.isSafeInteger(state.dossier.revision) && state.dossier.revision >= 1, 'OPPORTUNITY_DOSSIER_INVALID');
  for (const collection of ARRAYS) check(Array.isArray(state[collection]) &&
    state[collection].length <= 10000 && state[collection].every(object) &&
    new Set(state[collection].map(row => row.id)).size === state[collection].length,
    'OPPORTUNITY_COLLECTION_INVALID');
  for (const source of state.sources) check(object(source) && /^src_[a-f0-9]{64}$/.test(source.id) &&
    SOURCE_ROLES.includes(source.role) && source.dossierId === state.dossier.id &&
    source.dossierRevision <= state.dossier.revision, 'SOURCE_REFERENCE_INVALID');
  for (const row of state.capabilities) { recordId(row.id, 'cap'); normalizeCapability(state, row); }
  for (const row of state.requirements) { recordId(row.id, 'req'); normalizeRequirement(state, row); }
  for (const row of state.teaming) { recordId(row.id, 'team'); normalizeTeam(state, row); }
  for (const row of state.milestones) { recordId(row.id, 'ms'); normalizeMilestone(state, row); }
  for (const row of state.questions) { recordId(row.id, 'qa'); normalizeQuestion(state, row); }
  check(new Set(state.requirements.filter(row => row.status !== 'retired').map(row => row.number)).size ===
    state.requirements.filter(row => row.status !== 'retired').length, 'REQUIREMENT_NUMBER_DUPLICATE');
  for (const collection of evidenceCollections) for (const row of state[collection]) {
    check(Number.isSafeInteger(row.version) && row.version >= 1, 'RECORD_VERSION_INVALID');
    sourceTime(row.createdAt); sourceTime(row.updatedAt);
    text(row.createdBy, 'RECORD_OPERATOR_INVALID', 240); text(row.updatedBy, 'RECORD_OPERATOR_INVALID', 240);
    validEvidence(state, row.evidence);
  }
  for (const row of state.coverage) {
    check(row.id === 'cov_' + row.requirementId && state.requirements.some(req => req.id === row.requirementId),
      'COVERAGE_REQUIREMENT_INVALID');
    choice(row.decision, ['unreviewed', 'supported', 'partial', 'gap', 'team_required', 'exception'], 'COVERAGE_DECISION_INVALID');
    references(state, row.capabilityIds, 'capabilities', 'COVERAGE_CAPABILITY_INVALID');
    references(state, row.teamIds, 'teaming', 'COVERAGE_TEAM_INVALID');
    text(row.owner, 'OWNER_INVALID', 240, true); text(row.response, 'COVERAGE_RESPONSE_INVALID', 100000, true);
    text(row.reviewNote, 'COVERAGE_REVIEW_NOTE_INVALID', 50000, true);
    check(Number.isSafeInteger(row.requirementVersion) && row.requirementVersion >= 1 &&
      Array.isArray(row.capabilityVersions) && Array.isArray(row.teamVersions), 'COVERAGE_VERSION_INVALID');
  }
  for (const row of state.changes) {
    recordId(row.id, 'chg'); choice(row.status, ['pending', 'reviewed'], 'SOURCE_CHANGE_STATUS_INVALID');
    check(state.sources.some(source => source.id === row.beforeSourceId) &&
      state.sources.some(source => source.id === row.afterSourceId), 'SOURCE_CHANGE_REFERENCE_INVALID');
    strings(row.affectedIds, 'SOURCE_CHANGE_AFFECTED_INVALID', 10000);
  }
  for (const row of state.packages) {
    recordId(row.id, 'pkg'); check(HASH.test(row.sha256) && HASH.test(row.sourceStateSha256) &&
      row.sourceRevision >= 1 && row.sourceRevision < row.revision && row.revision <= state.revision,
      'HANDOFF_RECORD_INVALID');
  }
  validEvidence(state, state.responseRules.evidence); rules(state, state.responseRules); graph(state);
  return state;
}
function validateEnvelope(envelope, id, revision) {
  check(object(envelope) && object(envelope.state) && envelope.state.id === id &&
    envelope.state.revision === revision && envelope.sha256 === digest(jsonBytes(envelope.state)),
    'OPPORTUNITY_REVISION_CHANGED');
  validateState(envelope.state); return envelope;
}
function renderView(state, history, at = Date.now()) {
  const result = clone(state);
  const pending = new Set(state.changes.filter(row => row.status !== 'reviewed').flatMap(row => row.affectedIds));
  for (const name of evidenceCollections) result[name] = result[name].map(row => ({...row, reviewRequired: pending.has(row.id)}));
  result.coverage = result.coverage.map(row => {
    const requirement = state.requirements.find(item => item.id === row.requirementId);
    const reasons = [];
    if (requirement?.version !== row.requirementVersion) reasons.push('requirement_changed');
    if (row.capabilityVersions.some(binding => state.capabilities.find(item => item.id === binding.id)?.version !== binding.version))
      reasons.push('capability_changed');
    if (row.teamVersions.some(binding => state.teaming.find(item => item.id === binding.id)?.version !== binding.version))
      reasons.push('team_changed');
    if (row.reviewRequired) reasons.push('source_changed');
    return {...row, reviewRequired: reasons.length > 0, reviewReasons: reasons};
  });
  result.sources = result.sources.map(row => ({...row, supersededBy: state.sources
    .filter(source => source.replacesSourceId === row.id).map(source => source.id)}));
  result.milestones = result.milestones.map(row => ({...row,
    blocked: row.dependsOn.some(id => state.milestones.find(item => item.id === id)?.status !== 'done'),
    overdue: Boolean(row.dueAt && !['done', 'cancelled'].includes(row.status) && Date.parse(row.dueAt) < at)}));
  result.responseRules = {...result.responseRules, reviewRequired: pending.has('responseRules')};
  const requirements = result.requirements.filter(row => row.status !== 'retired');
  const activeRequirements = new Set(requirements.map(row => row.id));
  const decisions = result.coverage.filter(row => activeRequirements.has(row.requirementId));
  const deadlines = result.milestones.filter(row => row.dueAt && !['done', 'cancelled'].includes(row.status))
    .map(row => ({id: row.id, title: row.title, dueAt: row.dueAt, timeZone: row.timeZone}));
  if (state.opportunity.dueAt && !['submitted', 'closed'].includes(state.opportunity.stage))
    deadlines.push({id: 'opportunity', title: state.opportunity.title || state.title,
      dueAt: state.opportunity.dueAt, timeZone: state.opportunity.timeZone});
  deadlines.sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
  result.summary = {
    requirements: requirements.length, sources: result.sources.length,
    capabilities: result.capabilities.filter(row => row.status !== 'retired').length,
    unansweredRequirements: requirements.filter(row => row.responseDisposition === 'unanswered').length,
    notApplicable: requirements.filter(row => row.responseDisposition === 'not_applicable').length,
    reviewedRequirements: requirements.filter(row => row.status === 'reviewed').length,
    supported: decisions.filter(row => row.decision === 'supported' && !row.reviewRequired).length,
    partial: decisions.filter(row => row.decision === 'partial').length,
    gaps: decisions.filter(row => row.decision === 'gap').length,
    teamRequired: decisions.filter(row => row.decision === 'team_required').length,
    reviewRequired: decisions.filter(row => row.reviewRequired).length,
    unresolvedChanges: state.changes.filter(row => row.status !== 'reviewed').length,
    openQuestions: state.questions.filter(row => ['open', 'submitted'].includes(row.status)).length,
    overdueMilestones: result.milestones.filter(row => row.overdue).length,
    blockedMilestones: result.milestones.filter(row => row.blocked && row.status !== 'cancelled').length,
    teams: state.teaming.length, packages: state.packages.length, nextDeadline: deadlines[0] ?? null,
  };
  result.history = history.map(envelope => ({
    revision: envelope.state.revision, createdAt: envelope.state.updatedAt,
    operator: envelope.state.change.operator, action: envelope.state.change.action,
    requestId: envelope.state.change.requestId, sha256: envelope.sha256,
  }));
  result.readiness = opportunityHandoffReadiness(result);
  delete result.previous; delete result.change;
  return result;
}


function validateRenderedView(view, state, history, at, code, {variableClock = false} = {}) {
  check(object(view) && Number.isFinite(at), code);
  const actual = clone(view), expected = renderView(state, history, at);
  // An unnamed export renders just before its envelope records createdAt.
  // Only the live overdue indicators may cross a deadline in that interval.
  if (variableClock) {
    for (const value of [actual, expected]) {
      if (Array.isArray(value.milestones))
        for (const row of value.milestones) if (object(row)) delete row.overdue;
      if (object(value.summary)) delete value.summary.overdueMilestones;
    }
  }
  check(JSON.stringify(actual) === JSON.stringify(expected), code);
}

export async function openOpportunityStore({directory, operator, dossierDirectory, awardDirectory} = {}) {
  operator = text(operator, 'OPERATOR_REQUIRED', 240);
  directory = await privateDirectory(resolve(text(directory, 'WORKSPACE_DIRECTORY_REQUIRED', 4000)));
  const projects = await privateDirectory(join(directory, 'opportunities'));
  const dossiers = await openDossierStore(dossierDirectory ? resolve(dossierDirectory) : join(directory, 'research'));
  const pending = new Map();
  let closed = false, closing = false, cachedDossier = null;
  function ensureOpen() { check(!closed, 'WORKSPACE_CLOSED', 'The workspace is closed.', 409); }
  function path(id) { check(PROJECT_ID.test(id), 'PROJECT_ID_INVALID'); return join(projects, id); }
  async function revisionDirectory(id, create = false) {
    const parent = await privateDirectory(path(id), {create});
    return privateDirectory(join(parent, 'revisions'), {create});
  }
  async function packageDirectory(id, create = false) {
    const parent = await privateDirectory(path(id), {create});
    return privateDirectory(join(parent, 'packages'), {create});
  }
  async function history(id) {
    let names;
    try { names = await readdir(await revisionDirectory(id), {withFileTypes: true}); }
    catch (error) { if (error.code === 'ENOENT') throw new OpportunityError('PROJECT_NOT_FOUND', 'Project not found.', 404); throw error; }
    const revisions = names.filter(row => row.isFile() && /^[0-9]{8}\.json$/.test(row.name))
      .map(row => Number(row.name.slice(0, 8))).sort((a, b) => a - b);
    check(revisions.length && revisions.every((value, index) => value === index + 1), 'PROJECT_HISTORY_INCOMPLETE');
    const result = []; let previous = null;
    for (const revision of revisions) {
      const envelope = validateEnvelope(await readJson(join(await revisionDirectory(id), fileName(revision)), MAX_STATE), id, revision);
      check(envelope.state.previous === previous, 'PROJECT_HISTORY_CHANGED');
      result.push(envelope); previous = envelope.sha256;
    }
    return result;
  }
  async function maybeHistory(id) {
    try { return await history(id); } catch (error) { if (error.code === 'PROJECT_NOT_FOUND') return []; throw error; }
  }
  async function dossierMetadata(id, revision) {
    return typeof dossiers.getMetadata === 'function' ? dossiers.getMetadata(id, {revision}) : dossiers.get(id, {revision});
  }
  async function portableDossier(id, revision) {
    if (!cachedDossier || cachedDossier.id !== id || cachedDossier.revision < revision) {
      const packet = parseJson((await dossiers.exportDossier(id, {format: 'json'})).body);
      cachedDossier = {id, revision: packet.versions.length, packet};
    }
    return selectDossierRevision(cachedDossier.packet, revision);
  }
  async function get(id, {revision} = {}) {
    ensureOpen();
    const all = await history(id), selected = revision ?? all.length;
    check(Number.isSafeInteger(selected) && selected >= 1 && selected <= all.length, 'REVISION_NOT_FOUND',
      'Project revision not found.', 404);
    const state = all[selected - 1].state;
    const native = await dossierMetadata(state.dossier.id, state.dossier.revision);
    check(native.revision === state.dossier.revision &&
      native.questions.some(row => row.id === state.dossier.questionId), 'PROJECT_DOSSIER_CHANGED');
    for (const source of state.sources) for (const binding of source.editionBindings) {
      const edition = native.editions.find(row => row.id === binding.id);
      check(edition?.raw?.sha256 === binding.sha256 && edition.raw.bytes === binding.bytes,
        'SOURCE_EDITION_CHANGED');
    }
    return renderView(state, all.slice(0, selected));
  }
  async function list() {
    ensureOpen(); const result = [];
    for (const entry of await readdir(projects, {withFileTypes: true})) {
      if (!entry.isDirectory() || !PROJECT_ID.test(entry.name)) continue;
      const all = await history(entry.name), state = all.at(-1).state;
      const view = renderView(state, all);
      result.push({id: view.id, title: view.title, revision: view.revision, updatedAt: view.updatedAt,
        company: view.company, opportunity: view.opportunity, summary: view.summary});
    }
    return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  function enqueue(key, operation) {
    ensureOpen(); check(!closing, 'WORKSPACE_CLOSING', 'The workspace is closing.', 409);
    const previous = pending.get(key) ?? Promise.resolve();
    const promise = previous.catch(() => {}).then(operation);
    pending.set(key, promise);
    void promise.finally(() => { if (pending.get(key) === promise) pending.delete(key); }).catch(() => {});
    return promise;
  }
  function requestIdentity(action, payload) {
    const requestId = payload.requestId === undefined ? null : text(payload.requestId, 'REQUEST_ID_INVALID', 200);
    return {requestId, requestSha256: requestId ? digest(jsonBytes({action, payload})) : null};
  }
  function replay(all, identity) {
    if (!identity.requestId) return null;
    const found = all.find(row => row.state.change.requestId === identity.requestId);
    if (found) check(found.state.change.requestSha256 === identity.requestSha256, 'REQUEST_ID_CONFLICT',
      'This request ID already belongs to a different action payload.', 409);
    return found;
  }
  async function commit(id, expectedRevision, action, payload, update) {
    return enqueue(id, async () => {
      const all = await history(id), identity = requestIdentity(action, payload);
      if (replay(all, identity)) return get(id);
      const current = all.at(-1);
      check(Number.isSafeInteger(expectedRevision) && expectedRevision === current.state.revision,
        'REVISION_CONFLICT', 'Read the current project revision before saving.', 409,
        {expectedRevision, currentRevision: current.state.revision});
      const next = clone(current.state), at = timestamp();
      await update(next, current, all, at);
      next.revision = current.state.revision + 1; next.previous = current.sha256; next.updatedAt = at;
      next.change = {action, operator, at, ...identity};
      validateState(next);
      const envelope = {sha256: digest(jsonBytes(next)), state: next};
      check(jsonBytes(envelope).length <= MAX_STATE, 'PROJECT_STATE_TOO_LARGE');
      try { await writeJson(join(await revisionDirectory(id), fileName(next.revision)), envelope, {exclusive: true}); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const latest = await history(id);
        if (replay(latest, identity)) return get(id);
        throw new OpportunityError('REVISION_CONFLICT', 'Another writer saved this revision.', 409);
      }
      return get(id);
    });
  }
  async function create(payload) {
    const identity = requestIdentity('create', payload);
    let id;
    if (identity.requestId) {
      const hash = digest(operator + '\n' + identity.requestId).slice(0, 32);
      id = 'opp_' + [hash.slice(0, 8), hash.slice(8, 12), hash.slice(12, 16), hash.slice(16, 20), hash.slice(20)].join('-');
    } else id = newId('opp');
    return enqueue(id, async () => {
      const existing = await maybeHistory(id);
      if (existing.length) { check(replay(existing, identity), 'PROJECT_ID_CONFLICT'); return get(id); }
      const title = text(payload.title, 'TITLE_REQUIRED', 500);
      const description = text(payload.description ?? '', 'DESCRIPTION_INVALID', 50000, true);
      const at = timestamp();
      let dossier = await dossiers.create({title: title.slice(0, 240),
        description: 'Retained source dossier for opportunity ' + id + '.\n' + description.slice(0, 18000)});
      dossier = await dossiers.addQuestion(dossier.id, {
        text: 'Which retained source records support the company, requirements, decisions and response for ' + title + '?',
        expectedRevision: dossier.revision,
      });
      const state = {schema: OPPORTUNITY_SCHEMA, id, title, description, revision: 1, previous: null,
        createdAt: at, updatedAt: at, change: {action: 'create', operator, at, ...identity},
        company: company(payload.company), opportunity: opportunity(payload.opportunity),
        dossier: {id: dossier.id, revision: dossier.revision, questionId: dossier.questions.at(-1).id},
        sources: [], capabilities: [], requirements: [], coverage: [], teaming: [], milestones: [],
        questions: [], changes: [], packages: []};
      state.responseRules = rules(state, payload.responseRules);
      validateState(state);
      try { await writeJson(join(await revisionDirectory(id, true), fileName(1)),
        {sha256: digest(jsonBytes(state)), state}, {exclusive: true}); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        check(replay(await history(id), identity), 'PROJECT_ID_CONFLICT');
      }
      return get(id);
    });
  }
  function saveRecord(state, collection, prefix, payload, key, normalize, at) {
    const selected = payload[key], existing = selected === undefined ? null : state[collection].find(row => row.id === selected);
    check(selected === undefined || existing, 'RECORD_NOT_FOUND', 'The selected record does not exist.', 404);
    const id = selected ?? newId(prefix);
    const record = {id, ...normalize(state, {...existing, ...payload}), ...entityMetadata(existing, operator, at)};
    const index = existing ? state[collection].findIndex(row => row.id === id) : state[collection].length;
    state[collection][index] = record;
    return record;
  }
  async function dispatch(action, payload = {}) {
    ensureOpen(); check(typeof action === 'string' && object(payload), 'ACTION_PAYLOAD_INVALID');
    if (action === 'list') return list();
    if (action === 'get' || action === 'open') return get(payload.id, {revision: payload.revision});
    if (action === 'create') return create(payload);
    if (action === 'source' || action === 'read_source') {
      const all = await history(payload.id), selected = payload.revision ?? all.length;
      check(Number.isSafeInteger(selected) && selected >= 1 && selected <= all.length, 'REVISION_NOT_FOUND');
      const state = all[selected - 1].state, source = state.sources.find(row => row.id === payload.sourceId);
      check(source, 'SOURCE_NOT_FOUND', 'Source not found in this revision.', 404);
      return readOpportunitySource(source, await portableDossier(state.dossier.id, state.dossier.revision));
    }
    if (action === 'compare') return compare(payload.id, {before: payload.before, after: payload.after});
    const allowed = ['update', 'retain_source', 'import_award_edition', 'save_capability', 'save_requirement',
      'save_coverage', 'save_team', 'save_milestone', 'save_question', 'review_change', 'create_package'];
    check(allowed.includes(action), 'ACTION_UNKNOWN', 'Unknown workspace action.', 404);
    check(PROJECT_ID.test(payload.id), 'PROJECT_ID_INVALID');
    return commit(payload.id, payload.expectedRevision, action, payload, async (state, current, all, at) => {
      if (action === 'update') {
        if (payload.title !== undefined) state.title = text(payload.title, 'TITLE_REQUIRED', 500);
        if (payload.description !== undefined) state.description = text(payload.description, 'DESCRIPTION_INVALID', 50000, true);
        if (payload.company !== undefined) state.company = company({...state.company, ...payload.company});
        if (payload.opportunity !== undefined) state.opportunity = opportunity({...state.opportunity, ...payload.opportunity});
        if (payload.responseRules !== undefined) state.responseRules = rules(state, {...state.responseRules, ...payload.responseRules});
      } else if (action === 'retain_source') {
        if (payload.replacesSourceId) check(state.sources.some(row => row.id === payload.replacesSourceId),
          'REPLACED_SOURCE_NOT_FOUND');
        const source = await retainOpportunitySource(dossiers, state.dossier.id, state.dossier.questionId, payload);
        state.dossier.revision = source.dossierRevision; cachedDossier = null;
        if (!state.sources.some(row => row.id === source.id)) {
          if (source.replacesSourceId) {
            check(source.id !== source.replacesSourceId, 'SOURCE_CANNOT_REPLACE_ITSELF');
            const before = state.sources.find(row => row.id === source.replacesSourceId);
            state.changes.push({id: newId('chg'), beforeSourceId: before.id, afterSourceId: source.id,
              status: 'pending', decision: '', note: '', affectedIds: affectedRecords(state, before.id),
              contentChanged: before.sha256 !== source.sha256, beforeSha256: before.sha256,
              afterSha256: source.sha256, createdAt: at, createdBy: operator, reviewedAt: null, reviewedBy: null});
          }
          state.sources.push(source);
        }
      } else if (action === 'import_award_edition') {
        check(Boolean(payload.packet) !== Boolean(payload.editionId), 'ONE_AWARD_EDITION_INPUT_REQUIRED');
        let packet = payload.packet;
        if (payload.editionId) {
          check(awardDirectory, 'AWARD_WORKSPACE_NOT_CONFIGURED',
            'Select the original award workspace in the trusted launch configuration.');
          const root = resolve(awardDirectory);
          const stat = await lstat(join(root, 'awards.sqlite3'));
          check(stat.isFile() && !stat.isSymbolicLink(), 'ORIGINAL_AWARD_WORKSPACE_REQUIRED');
          const {AwardWorkspace} = await import('../../sf30-seller-sdk/usaspending/workspace.mjs');
          const original = new AwardWorkspace(root, {operator});
          try { packet = await original.exportEdition(payload.editionId, {includeSourceBytes: true, includeReviews: false}); }
          finally { original.close(); }
        }
        const source = await retainAwardEdition(dossiers, state.dossier.id, state.dossier.questionId,
          {packet, label: payload.label});
        state.dossier.revision = source.dossierRevision; cachedDossier = null;
        if (!state.sources.some(row => row.id === source.id)) state.sources.push(source);
      } else if (action === 'save_capability') {
        saveRecord(state, 'capabilities', 'cap', payload, 'capabilityId', normalizeCapability, at);
      } else if (action === 'save_requirement') {
        const record = saveRecord(state, 'requirements', 'req', payload, 'requirementId', normalizeRequirement, at);
        check(record.status === 'retired' || !state.requirements.some(row => row.id !== record.id &&
          row.status !== 'retired' && row.number === record.number), 'REQUIREMENT_NUMBER_DUPLICATE');
      } else if (action === 'save_team') {
        saveRecord(state, 'teaming', 'team', payload, 'teamId', normalizeTeam, at);
      } else if (action === 'save_milestone') {
        const record = saveRecord(state, 'milestones', 'ms', payload, 'milestoneId', normalizeMilestone, at);
        graph(state);
        check(record.status !== 'done' || record.dependsOn.every(id =>
          state.milestones.find(row => row.id === id)?.status === 'done'), 'MILESTONE_PREDECESSOR_INCOMPLETE',
          'Finish or revise the recorded predecessor work before completing this milestone.');
      } else if (action === 'save_question') {
        saveRecord(state, 'questions', 'qa', payload, 'questionId', normalizeQuestion, at);
      } else if (action === 'save_coverage') {
        const requirement = state.requirements.find(row => row.id === payload.requirementId);
        check(requirement, 'COVERAGE_REQUIREMENT_NOT_FOUND', 'Requirement not found.', 404);
        const old = state.coverage.find(row => row.requirementId === requirement.id);
        const value = {...old, ...payload};
        const row = {id: 'cov_' + requirement.id, requirementId: requirement.id,
          decision: choice(value.decision ?? 'unreviewed',
            ['unreviewed', 'supported', 'partial', 'gap', 'team_required', 'exception'], 'COVERAGE_DECISION_INVALID'),
          capabilityIds: references(state, value.capabilityIds, 'capabilities', 'COVERAGE_CAPABILITY_INVALID'),
          teamIds: references(state, value.teamIds, 'teaming', 'COVERAGE_TEAM_INVALID'),
          owner: text(value.owner ?? '', 'OWNER_INVALID', 240, true),
          response: text(value.response ?? '', 'COVERAGE_RESPONSE_INVALID', 100000, true),
          reviewNote: text(value.reviewNote ?? '', 'COVERAGE_REVIEW_NOTE_INVALID', 50000, true),
          evidence: bindOpportunityEvidence(state, value.evidence ?? []),
          ...entityMetadata(old, operator, at), requirementVersion: requirement.version};
        row.capabilityVersions = row.capabilityIds.map(id => ({id, version: state.capabilities.find(item => item.id === id).version}));
        row.teamVersions = row.teamIds.map(id => ({id, version: state.teaming.find(item => item.id === id).version}));
        if (row.decision === 'supported') {
          const capabilities = row.capabilityIds.map(id => state.capabilities.find(item => item.id === id));
          check(row.reviewNote.trim() && (row.evidence.length || capabilities.some(item =>
            item.status === 'reviewed' && item.evidence.length)), 'SUPPORTED_SOURCE_REVIEW_REQUIRED',
            'Record the source-backed capability or direct evidence and the coverage review note.');
          if (requirement.evidenceRule === 'deployed_only' && requirement.responseDisposition !== 'not_applicable') {
            check(capabilities.some(item => item.status === 'reviewed' && item.deliveryStatus === 'deployed' &&
              item.evidence.length), 'DEPLOYED_CAPABILITY_REQUIRED',
              'This requirement needs a reviewed deployed capability, as recorded in its source rule.');
          }
        }
        state.coverage[old ? state.coverage.findIndex(item => item.id === old.id) : state.coverage.length] = row;
      } else if (action === 'review_change') {
        const change = state.changes.find(row => row.id === payload.changeId);
        check(change, 'SOURCE_CHANGE_NOT_FOUND', 'Source change not found.', 404);
        change.status = choice(payload.status, ['pending', 'reviewed'], 'SOURCE_CHANGE_STATUS_INVALID');
        change.decision = text(payload.decision ?? '', 'SOURCE_CHANGE_DECISION_INVALID', 500, true);
        change.note = text(payload.note ?? '', 'SOURCE_CHANGE_NOTE_INVALID', 50000, true);
        if (payload.affectedIds !== undefined) {
          const valid = new Set(['responseRules', ...evidenceCollections.flatMap(name => state[name].map(row => row.id))]);
          const additions = strings(payload.affectedIds, 'SOURCE_CHANGE_AFFECTED_INVALID', 10000);
          check(additions.every(id => valid.has(id)), 'SOURCE_CHANGE_RECORD_NOT_FOUND');
          change.affectedIds = [...new Set([...change.affectedIds, ...additions])];
        }
        check(change.status !== 'reviewed' || change.decision.trim() && change.note.trim(),
          'SOURCE_CHANGE_REVIEW_REQUIRED');
        change.reviewedAt = change.status === 'reviewed' ? at : null;
        change.reviewedBy = change.status === 'reviewed' ? operator : null;
      } else if (action === 'create_package') {
        const id = newId('pkg'), title = text(payload.title, 'PACKAGE_TITLE_REQUIRED', 500);
        const status = choice(payload.status ?? 'draft',
          ['draft', 'ready_for_review', 'approved_for_handoff'], 'PACKAGE_STATUS_INVALID');
        const note = text(payload.note ?? '', 'PACKAGE_NOTE_INVALID', 50000, true);
        const sourceDossier = await portableDossier(current.state.dossier.id, current.state.dossier.revision);
        const snapshot = createOpportunitySnapshot(renderView(current.state, all, Date.parse(at)),
          {id, title, status, note, operator, createdAt: at, sourceStateSha256: current.sha256,
            dossierExportedAt: sourceDossier.exportedAt});
        await writeJson(join(await packageDirectory(state.id, true), id + '.json'), snapshot, {exclusive: true});
        state.packages.push({id, title, status, note, createdAt: at, createdBy: operator,
          revision: state.revision + 1, sourceRevision: current.state.revision,
          sourceStateSha256: current.sha256, sha256: snapshot.sha256});
      }
    });
  }

  async function compare(id, {before, after} = {}) {
    const all = await history(id);
    check(Number.isSafeInteger(before) && Number.isSafeInteger(after) &&
      before >= 1 && after >= 1 && before <= all.length && after <= all.length, 'REVISION_NOT_FOUND');
    const left = all[before - 1].state, right = all[after - 1].state;
    const fields = ['title', 'description', 'company', 'opportunity', 'responseRules'];
    const changes = {id, before, after, fields: fields.filter(key =>
      JSON.stringify(left[key]) !== JSON.stringify(right[key])).map(key => ({field: key, before: clone(left[key]), after: clone(right[key])}))};
    for (const collection of ARRAYS) {
      const earlier = new Map(left[collection].map(row => [row.id, row]));
      const later = new Map(right[collection].map(row => [row.id, row]));
      changes[collection] = {
        added: right[collection].filter(row => !earlier.has(row.id)).map(clone),
        removed: left[collection].filter(row => !later.has(row.id)).map(clone),
        changed: right[collection].filter(row => earlier.has(row.id) &&
          JSON.stringify(earlier.get(row.id)) !== JSON.stringify(row)).map(row => ({
            id: row.id, before: clone(earlier.get(row.id)), after: clone(row),
          })),
      };
    }
    changes.dossier = {id: right.dossier.id, before: left.dossier.revision, after: right.dossier.revision};
    return changes;
  }
  async function readSnapshot(id, record) {
    const snapshot = await readJson(join(await packageDirectory(id), record.id + '.json'), MAX_PACKAGE_BYTES);
    validateOpportunitySnapshot(snapshot);
    check(snapshot.sha256 === record.sha256 && snapshot.id === record.id && snapshot.projectId === id &&
      snapshot.sourceRevision === record.sourceRevision && snapshot.sourceStateSha256 === record.sourceStateSha256,
      'HANDOFF_SNAPSHOT_CHANGED');
    for (const key of ['title', 'status', 'note', 'createdAt']) check(snapshot[key] === record[key], 'HANDOFF_RECORD_CHANGED');
    check(snapshot.operator === record.createdBy, 'HANDOFF_RECORD_CHANGED');
    return snapshot;
  }
  async function exportPackage(id, {revision, packageId} = {}) {
    ensureOpen();
    const all = await history(id);
    let selected = revision ?? all.length;
    check(Number.isSafeInteger(selected) && selected >= 1 && selected <= all.length, 'REVISION_NOT_FOUND');
    let named = null;
    if (packageId) {
      const record = all[selected - 1].state.packages.find(row => row.id === packageId);
      check(record, 'HANDOFF_PACKAGE_NOT_FOUND', 'Named package not found in this revision.', 404);
      selected = record.revision;
      named = await readSnapshot(id, record);
    }
    const versions = all.slice(0, selected), state = versions.at(-1).state;
    const project = renderView(state, versions, named ? Date.parse(named.createdAt) : Date.now());
    const dossier = await portableDossier(state.dossier.id, state.dossier.revision);
    if (named) dossier.exportedAt = named.dossierExportedAt;
    for (const source of state.sources) readOpportunitySource(source, dossier);
    const sealedPackages = [];
    for (const record of state.packages) sealedPackages.push(await readSnapshot(id, record));
    return assembleOpportunityPackage({project, versions, dossier, sealedPackages,
      selectedPackageId: packageId ?? null});
  }
  async function importPackage(packet) {
    ensureOpen(); validateOpportunityPackage(packet);
    check(PROJECT_ID.test(packet.projectId), 'PROJECT_ID_INVALID');
    return enqueue(packet.projectId, async () => {
      const id = packet.projectId, incoming = packet.versions;
      let previous = null; const sourceIdentities = new Map(), requests = new Set();
      for (let index = 0; index < incoming.length; index++) {
        const envelope = validateEnvelope(incoming[index], id, index + 1), state = envelope.state;
        check(jsonBytes(envelope).length <= MAX_STATE && state.previous === previous, 'PORTABLE_PROJECT_HISTORY_CHANGED');
        previous = envelope.sha256;
        check(state.dossier.id === packet.dossier.id && state.dossier.revision <= packet.dossier.versions.length,
          'PORTABLE_PROJECT_DOSSIER_CHANGED');
        if (state.change.requestId !== null) {
          text(state.change.requestId, 'REQUEST_ID_INVALID', 200);
          check(HASH.test(state.change.requestSha256) && !requests.has(state.change.requestId), 'PORTABLE_REQUEST_ID_CONFLICT');
          requests.add(state.change.requestId);
        }
        for (const source of state.sources) {
          const identity = digest(jsonBytes(source));
          if (sourceIdentities.has(source.id)) check(sourceIdentities.get(source.id) === identity, 'IMMUTABLE_SOURCE_CHANGED');
          else {
            sourceIdentities.set(source.id, identity);
            validateOpportunitySource(source, packet.dossier);
            readOpportunitySource(source, packet.dossier);
          }
        }
      }
      const final = incoming.at(-1).state;
      check(final.dossier.revision === packet.dossier.versions.length, 'PORTABLE_DOSSIER_REVISION_CHANGED');
      const selectedSnapshot = packet.selectedPackageId ?
        packet.sealedPackages.find(row => row.id === packet.selectedPackageId) : null;
      validateRenderedView(packet.project, final, incoming,
        Date.parse(selectedSnapshot ? selectedSnapshot.createdAt : packet.createdAt),
        'PORTABLE_PROJECT_VIEW_CHANGED', {variableClock: !selectedSnapshot});
      const snapshots = new Map(packet.sealedPackages.map(row => [row.id, row]));
      for (const record of final.packages) {
        const snapshot = snapshots.get(record.id);
        check(snapshot && snapshot.sha256 === record.sha256 &&
          snapshot.sourceStateSha256 === incoming[record.sourceRevision - 1]?.sha256 &&
          snapshot.sourceStateSha256 === record.sourceStateSha256 &&
          snapshot.sourceRevision === record.sourceRevision && record.revision <= incoming.length,
          'PORTABLE_HANDOFF_REFERENCE_CHANGED');
        for (const key of ['title', 'status', 'note', 'createdAt'])
          check(snapshot[key] === record[key], 'PORTABLE_HANDOFF_RECORD_CHANGED');
        check(snapshot.operator === record.createdBy, 'PORTABLE_HANDOFF_RECORD_CHANGED');
        const bound = incoming[record.sourceRevision - 1].state;
        validateRenderedView(snapshot.project, bound, incoming.slice(0, record.sourceRevision),
          Date.parse(snapshot.createdAt), 'PORTABLE_HANDOFF_PROJECT_CHANGED');
        check(JSON.stringify(snapshot.readiness) === JSON.stringify(snapshot.project.readiness),
          'PORTABLE_HANDOFF_READINESS_CHANGED');
      }
      check(snapshots.size === final.packages.length, 'PORTABLE_HANDOFF_SET_CHANGED');
      const existing = await maybeHistory(id);
      for (let index = 0; index < Math.min(existing.length, incoming.length); index++)
        check(existing[index].sha256 === incoming[index].sha256, 'PORTABLE_PROJECT_HISTORY_CONFLICT',
          'This project has a different local revision history.', 409);
      // The original dossier validates its entire source/history packet before
      // writing. Project revisions are appended only after that original reopen.
      await dossiers.reopen(packet.dossier); cachedDossier = null;
      const target = await revisionDirectory(id, true), packages = await packageDirectory(id, true);
      for (const snapshot of packet.sealedPackages) {
        const destination = join(packages, snapshot.id + '.json');
        try { await writeJson(destination, snapshot, {exclusive: true}); }
        catch (error) {
          if (error.code !== 'EEXIST') throw error;
          const retained = await readJson(destination, MAX_PACKAGE_BYTES);
          check(retained.sha256 === snapshot.sha256 &&
            digest(jsonBytes(retained)) === digest(jsonBytes(snapshot)), 'PORTABLE_HANDOFF_CONFLICT');
        }
      }
      for (let index = existing.length; index < incoming.length; index++) {
        try { await writeJson(join(target, fileName(index + 1)), incoming[index], {exclusive: true}); }
        catch (error) {
          if (error.code !== 'EEXIST') throw error;
          const retained = await readJson(join(target, fileName(index + 1)), MAX_STATE);
          check(retained.sha256 === incoming[index].sha256, 'REVISION_CONFLICT',
            'Another writer saved a different revision while receiving.', 409);
        }
      }
      return get(id);
    });
  }
  async function close() {
    if (closed) return;
    closing = true;
    await Promise.allSettled([...pending.values()]);
    cachedDossier = null; closed = true;
  }
  return Object.freeze({directory, operator, list, get, dispatch, compare, exportPackage, importPackage, close});
}
