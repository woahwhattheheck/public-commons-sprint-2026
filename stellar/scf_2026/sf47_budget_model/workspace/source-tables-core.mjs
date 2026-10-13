// MIT. Retained source tables feed the original planning writer and calculator.
import {
  PROJECT_SCHEMA, createProject, addDocument, addEdition, importProject,
  initialMapping, replaceMapping, freezeReview, selectedEdition, selectedReview,
  reviewIsCurrent, normalizeTable, compareReviews, sha256, parseTable,
} from '../../../../stellar-forge/developer-site/dist/source-table-workspace.mjs';

import {
  validateWorkbookSource, validateWorkbookProjection, validateWorkbookMaterials, requireWorkbookProjectCapacity,
  workbookSelectionBody, planningWorkbookRows, workbookOperatingGuide,
} from './source-workbooks.mjs';

export const BOOK_SCHEMA = 'stellar-forge.planning-source-tables.v1';
export const STORAGE_SCHEMA = BOOK_SCHEMA + '.retained';
export const PREVIEW_SCHEMA = 'stellar-forge.planning-source-tables.preview.v1';
export const ROLES = Object.freeze({
  packages: {label: 'Work packages', keys: ['id'], fields: [
    ['id','Package ID','id'], ['tranche','Tranche','integer'], ['start_day','Start day','integer'],
    ['end_day','End day','integer'], ['estimated_hours','Estimated hours','decimal'],
    ['assumed_hourly_rate_usd','Hourly rate · USD','decimal'], ['amount_usd','Fixed amount · USD','decimal'],
    ['category','Development category','text'], ['remaining_work','Complete remaining work','text'],
    ['measurable_proof','Completion assessment','text'], ['pricing_mode','Pricing: hours or fixed','text'],
  ]},
  milestones: {label: 'Milestones', keys: ['tranche'], fields: [
    ['tranche','Tranche','integer'], ['submit_day','Submission day','integer'],
    ['review_and_payment_lag_days','Modeled review/payment delay','integer'],
    ['deliverable','Complete deliverable','text'], ['measurable_proof','Completion assessment','text'],
  ]},
  contributors: {label: 'Contributors', keys: ['id'], fields: [
    ['id','Contributor ID','id'], ['name','Contributor name','text'],
    ['weeklyHours','Weekly capacity · hours','decimal'], ['note','Capacity source or note','text'],
  ]},
  assignments: {label: 'Assignments', keys: ['costId','contributorId'], fields: [
    ['costId','Package ID','id'], ['contributorId','Contributor ID','id'], ['hours','Assigned hours','decimal'],
  ]},
});
const copy = value => JSON.parse(JSON.stringify(value));
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const json = value => JSON.stringify(value, null, 2) + '\n';
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
const stamp = () => new Date().toISOString();
const hash = /^[a-f0-9]{64}$/;
const packageFields = ROLES.packages.fields.map(x => x[0]).filter(x => x !== 'pricing_mode');

export class PlanningTableError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'PlanningTableError'; this.code = code; Object.assign(this, details); }
}
function need(value, code, message, details) { if (!value) throw new PlanningTableError(code, message, details); }
function string(value, label, max = 12000, required = false) {
  need(typeof value === 'string' && value.length <= max && !value.includes('\u0000'), 'TEXT', label + ' must be text of at most ' + max + ' characters.');
  need(!required || value.trim(), 'REQUIRED', 'Enter ' + label + '.');
  return value;
}
function decimal(value, label, optional = false) {
  if (optional && (value === '' || value === null || value === undefined)) return null;
  const raw = String(value);
  need(/^\d+(?:\.\d+)?$/.test(raw) && raw.length <= 40, 'DECIMAL', label + ' needs an exact nonnegative decimal value.');
  return raw;
}
function integer(value, label) {
  const raw = String(value);
  need(/^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)), 'INTEGER', label + ' needs a whole nonnegative number.');
  return Number(raw);
}
function identifier(value, label) {
  need(typeof value === 'string' || typeof value === 'number', 'IDENTIFIER', label + ' needs an explicit source identity.');
  const raw = string(String(value), label, 100, true);
  need(/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(raw), 'IDENTIFIER', label + ' uses letters, numbers, dots, hyphens or underscores.');
  return raw;
}
function withoutTables(planning) { const result = copy(planning); delete result.sourceTables; return result; }
export function planningBaseline(plan) {
  need(object(plan) && /^plan-[a-f0-9]{32}$/.test(plan.id || '') && Number.isSafeInteger(plan.revision) && plan.revision > 0 &&
    hash.test(plan.contentSha256 || '') && object(plan.scenario) && object(plan.planning), 'BASELINE', 'Open a complete saved native plan revision.');
  return {id: plan.id, name: plan.name, revision: plan.revision, contentSha256: plan.contentSha256,
    source: copy(plan.source), scenario: copy(plan.scenario), planning: withoutTables(plan.planning)};
}
export function createPlanningBook(plan, {name = plan.name + ' source tables'} = {}) {
  return {schema: BOOK_SCHEMA, id: 'table-plan-' + crypto.randomUUID(), name: string(name, 'Project name', 200, true),
    createdAt: stamp(), baseline: planningBaseline(plan), project: createProject({name}),
    bindings: [], settings: {scenarioName: plan.scenario.scenario_name, awardRequestUsd: String(plan.scenario.award_request_usd),
      projectEndDay: plan.scenario.project_end_day}, orphanPolicy: 'preserve', reviews: [], appliedReviewId: null};
}
function bindingIn(book, role) {
  need(own(ROLES, role), 'ROLE', 'Choose a supported planning table.');
  const binding = book.bindings.find(x => x.role === role);
  need(binding, 'BINDING', 'Add the ' + ROLES[role].label.toLowerCase() + ' table first.');
  return binding;
}
function documentIn(book, binding) {
  const doc = book.project.documents.find(x => x.id === binding.documentId);
  need(doc, 'DOCUMENT', 'Retain the complete source document for ' + binding.role + '.');
  return doc;
}
export function nativeRoleRows(baseline, role) {
  if (role === 'packages') return baseline.scenario.future_costs.map(row =>
    ({...copy(row), pricing_mode: baseline.planning.pricing?.[row.id] ||
      (row.estimated_hours !== undefined && row.assumed_hourly_rate_usd !== undefined ? 'hours' : 'fixed')}));
  if (role === 'milestones') return copy(baseline.scenario.milestones);
  return copy(baseline.planning[role] || []);
}
function rowKey(role, row) { return JSON.stringify(ROLES[role].keys.map(key => row[key])); }
function fieldsFor(role, mapping) {
  return Object.fromEntries(ROLES[role].fields.map(([name]) => {
    const column = mapping.columns.find(x => x.include && (x.sourceName === name || x.name === name));
    return [name, column ? {source: 'column', column: column.name} : {source: 'existing'}];
  }));
}
export async function addPlanningTable(book, {role, filename, sourceText, delimiter = ',', header = true}) {
  need(own(ROLES, role), 'ROLE', 'Choose a supported planning table.');
  need(!book.bindings.some(x => x.role === role), 'ROLE_EXISTS', 'Receive the next edition of this planning table, or choose a different role.');
  const next = copy(book), added = await addDocument(next.project, {filename, sourceText, delimiter, header, resourceId: 'planning-' + role});
  next.project = added.project;
  const doc = next.project.documents.find(x => x.id === added.documentId);
  next.bindings.push({role, documentId: doc.id, mode: 'merge', fields: fieldsFor(role, doc.mapping), excludedRows: []});
  return next;
}
export async function addReviewedPlanningDocument(book, {role, project, documentId}) {
  need(own(ROLES, role) && !book.bindings.some(x => x.role === role), 'ROLE_EXISTS', 'Choose a planning role without a source table.');
  const source = await importProject(project), document = source.documents.find(x => x.id === documentId);
  need(document, 'DOCUMENT', 'Choose one complete table from the received Source Tables project.');
  const next = copy(book);
  need(!next.project.documents.some(x => x.id === document.id || x.resourceId === document.resourceId), 'DOCUMENT_EXISTS', 'This original source table is already in the planning project.');
  next.project.documents.push(copy(document));
  next.project.starter.resources.push(copy(source.starter.resources.find(x => x.id === document.resourceId)));
  next.bindings.push({role, documentId, mode: 'merge', fields: fieldsFor(role, document.mapping), excludedRows: []});
  return next;
}
export async function receivePlanningEdition(book, role, {filename, sourceText}) {
  const next = copy(book), binding = bindingIn(next, role);
  next.project = (await addEdition(next.project, binding.documentId, {filename, sourceText})).project;
  if (next.selectedWorkbooks) next.selectedWorkbooks[binding.documentId] = null;
  return next;
}

export async function retainPlanningWorkbookSource(book, source) {
  await validateWorkbookSource(source);
  const next = copy(book);
  next.workbookSources ??= []; next.workbookSelections ??= []; next.selectedWorkbooks ??= {};
  const existing = next.workbookSources.find(item => item.id === source.id);
  if (existing) need(existing.dataBase64 === source.dataBase64, 'WORKBOOK_BYTES', 'The original workbook identity must retain the same complete bytes.');
  else next.workbookSources.push(copy(source));
  requireWorkbookProjectCapacity(next);
  return next;
}
export async function receivePlanningWorkbook(book, {role, source, projection, receivedAt = stamp()}) {
  await validateWorkbookSource(source);
  const body = await validateWorkbookProjection(projection, source);
  let next = await retainPlanningWorkbookSource(book, source);
  const filename = (source.filename + '.' + body.mapping.plan.sheet.replace(/[\\/]/g, '-')).slice(0,480) + '.csv';
  if (next.bindings.some(item => item.role === role))
    next = await receivePlanningEdition(next, role, {filename, sourceText: body.csv.text});
  else next = await addPlanningTable(next, {role, filename, sourceText: body.csv.text, delimiter:',', header:true});
  const binding = bindingIn(next, role), doc = documentIn(next, binding), edition = selectedEdition(doc);
  const id = 'wbsel-' + await sha256(source.id + '\n' + doc.id + '\n' + projection.sha256);
  if (!next.workbookSelections.some(item => item.id === id))
    next.workbookSelections.push({id, sourceId: source.id, documentId: doc.id, editionId: edition.id,
      text: projection.text, bytes: new TextEncoder().encode(projection.text).length, sha256: projection.sha256, receivedAt});
  next.selectedWorkbooks[doc.id] = id;
  await validateWorkbookMaterials(next);
  return next;
}
export function selectPlanningWorkbook(book, selectionId) {
  const next = copy(book), selected = next.workbookSelections?.find(item => item.id === selectionId);
  need(selected, 'WORKBOOK_SELECTION', 'Choose a complete retained worksheet selection.');
  const doc = next.project.documents.find(item => item.id === selected.documentId);
  need(doc?.editions.some(item => item.id === selected.editionId), 'WORKBOOK_SELECTION', 'Retain the original projected source edition.');
  doc.selectedEditionId = selected.editionId;
  next.selectedWorkbooks ??= {};
  next.selectedWorkbooks[doc.id] = selected.id;
  return next;
}
export function selectPlanningSourceEdition(book, role, editionId) {
  const next = copy(book), doc = documentIn(next, bindingIn(next, role));
  need(doc.editions.some(item => item.id === editionId), 'SOURCE_EDITION', 'Choose an original source edition.');
  doc.selectedEditionId = editionId;
  const choices = (next.workbookSelections || []).filter(item => item.documentId === doc.id && item.editionId === editionId);
  if (next.selectedWorkbooks) {
    if (choices.length < 2) next.selectedWorkbooks[doc.id] = choices[0]?.id || null;
    else delete next.selectedWorkbooks[doc.id];
  }
  return next;
}

export function changePlanningMapping(book, role, mapping) {
  const next = copy(book), binding = bindingIn(next, role);
  next.project = replaceMapping(next.project, binding.documentId, mapping);
  return next;
}
export async function retainPlanningTableReview(book, role) {
  const next = copy(book), binding = bindingIn(next, role);
  next.project = (await freezeReview(next.project, binding.documentId)).project;
  return next;
}
export function sourceTableRows(book, role) {
  const binding = bindingIn(book, role), doc = documentIn(book, binding);
  const result = normalizeTable(selectedEdition(doc), doc.mapping);
  return {binding, doc, edition: selectedEdition(doc), rows: result.data.rows, fields: result.data.fields,
    records: result.sourceRecords, summary: result.summary};
}
export function sourceEditionComparison(book, role) {
  const binding = bindingIn(book, role), doc = documentIn(book, binding);
  if (!doc.baselineReviewId || !doc.selectedReviewId || doc.baselineReviewId === doc.selectedReviewId) return null;
  return compareReviews(doc, doc.baselineReviewId);
}
export function setSourceRowExclusion(book, role, record, excluded, note = '') {
  const next = copy(book), binding = bindingIn(next, role), edition = selectedEdition(documentIn(next, binding));
  need(Number.isSafeInteger(record) && record > 0, 'SOURCE_ROW', 'Choose the original source record.');
  if (excluded) string(note, 'Reason for excluding this source row', 2000, true);
  binding.excludedRows = binding.excludedRows.filter(x => !(x.editionId === edition.id && x.record === record));
  if (excluded) binding.excludedRows.push({editionId: edition.id, record, note});
  return next;
}
export function rebasePlanningBook(book, plan) {
  const next = copy(book); next.baseline = planningBaseline(plan); next.appliedReviewId = null; return next;
}
export function retainPlanningBook(book) { return {schema: STORAGE_SCHEMA, text: json(book)}; }
export async function importPlanningBook(input) {
  if (object(input) && input.schema === STORAGE_SCHEMA) input = input.text;
  let book;
  try { book = typeof input === 'string' ? JSON.parse(input.replace(/^\uFEFF/, '')) : copy(input); }
  catch { throw new PlanningTableError('BOOK_JSON', 'Open a complete planning source-table project.'); }
  // Source Tables agent replies retain the same complete native book. Accept their
  // original response file here so both browser consumers and generated CLI steps
  // read one selected source without replacing its retained outer bytes.
  let response = null;
  if (object(book) && book.schema === 'stellar-forge.sf47-planning-source-agent.v1') {
    response = book;
    need(object(response.book) && object(response.baseline) &&
      typeof response.operation === 'string' && response.operation.length > 0,
      'BOOK_RESPONSE', 'Retain the complete Source Tables response, its native book and selected baseline.');
    book = copy(response.book);
  }
  need(object(book) && book.schema === BOOK_SCHEMA && /^table-plan-[a-f0-9-]{36}$/.test(book.id || ''),
    'BOOK_SCHEMA', 'Use a complete planning source-table project.');
  string(book.name, 'Project name', 200, true);
  need(object(book.baseline) && object(book.settings) && Array.isArray(book.bindings) && book.bindings.length <= 4 &&
    Array.isArray(book.reviews), 'BOOK_SCHEMA', 'Retain the complete baseline, bindings and saved reviews.');
  planningBaseline({...book.baseline, planning: book.baseline.planning});
  book.project = await importProject(book.project);
  need(['preserve','remove-unreferenced'].includes(book.orphanPolicy), 'REFERENCE_POLICY', 'Choose how removed rows affect their existing assignments and payment settings.');
  const roles = new Set(), docs = new Set();
  for (const binding of book.bindings) {
    need(object(binding) && own(ROLES, binding.role) && !roles.has(binding.role) && !docs.has(binding.documentId),
      'BINDING', 'Bind each planning role to one distinct retained source table.');
    roles.add(binding.role); docs.add(binding.documentId);
    documentIn(book, binding);
    need(['merge','replace'].includes(binding.mode) && object(binding.fields) && Array.isArray(binding.excludedRows),
      'BINDING', 'Retain the collection mode, field mapping and source-row decisions.');
    const names = new Set(ROLES[binding.role].fields.map(x => x[0]));
    need(Object.keys(binding.fields).every(x => names.has(x)), 'FIELD', 'Remove unknown target fields from the ' + binding.role + ' binding.');
    for (const [name, rule] of Object.entries(binding.fields)) {
      need(object(rule) && ['column','constant','existing'].includes(rule.source), 'FIELD', 'Choose the source for ' + name + '.');
      if (rule.source === 'column') string(rule.column, 'Source column', 128, true);
      if (rule.source === 'constant') need(typeof rule.value === 'string' || typeof rule.value === 'number' || rule.value === null, 'FIELD', 'Use an explicit text or numeric constant.');
      if (rule.members !== undefined) {
        need(object(rule.members) && Object.values(rule.members).every(x => typeof x === 'string'), 'MEMBERS', 'Save exact source-to-target member names.');
      }
    }
    const exclusions = new Set();
    for (const exclusion of binding.excludedRows) {
      need(object(exclusion) && Number.isSafeInteger(exclusion.record) && exclusion.record > 0 &&
        typeof exclusion.editionId === 'string' && !exclusions.has(exclusion.editionId + ':' + exclusion.record),
        'EXCLUSION', 'Retain each excluded source record once in its original edition.');
      need(documentIn(book, binding).editions.some(x => x.id === exclusion.editionId), 'EXCLUSION', 'Retain the original edition for each row decision.');
      string(exclusion.note, 'Source-row decision', 2000);
      exclusions.add(exclusion.editionId + ':' + exclusion.record);
    }
  }
  need(book.project.documents.every(doc => docs.has(doc.id)), 'UNBOUND_SOURCE', 'Assign every received source document a planning role.');
  string(book.settings.scenarioName, 'Scenario description', 500, true);
  decimal(book.settings.awardRequestUsd, 'Requested award');
  integer(book.settings.projectEndDay, 'Project end day');
  const reviewIds = new Set();
  for (const review of book.reviews) {
    need(object(review) && hash.test(review.id || '') && !reviewIds.has(review.id) &&
      object(review.base) && Array.isArray(review.sourceRows) && Array.isArray(review.changes), 'REVIEW', 'Retain the complete saved planning reviews.');
    reviewIds.add(review.id);
  }
  need(book.appliedReviewId === null || reviewIds.has(book.appliedReviewId), 'REVIEW', 'Retain the selected applied review.');
  await validateWorkbookMaterials(book);
  if (response) {
    need(response.baseline.id === book.baseline.id &&
      response.baseline.revision === book.baseline.revision &&
      response.baseline.contentSha256 === book.baseline.contentSha256,
      'BOOK_RESPONSE_BASELINE', 'The Source Tables response and its complete book must retain the same native planning baseline.');
  }
  return book;
}
function resolveRule(binding, field, row, existing) {
  const rule = binding.fields[field];
  need(object(rule), 'FIELD_UNMAPPED', 'Choose a source for ' + binding.role + '.' + field + '.');
  if (rule.source === 'existing') {
    need(existing && own(existing, field), 'EXISTING_VALUE', 'There is no existing ' + field + ' for this source row. Map a source column or enter a constant.', {role: binding.role, field});
    return existing[field];
  }
  let value;
  if (rule.source === 'column') {
    need(own(row, rule.column), 'SOURCE_COLUMN', 'The reviewed source row has no field ' + rule.column + '.', {role: binding.role, field, column: rule.column});
    value = row[rule.column];
  } else value = rule.value;
  if (rule.members !== undefined) {
    need(own(rule.members, String(value)), 'MEMBER_UNMAPPED', 'Map the source value "' + String(value) + '" for ' + field + '.', {role: binding.role, field, value});
    value = rule.members[String(value)];
  }
  return value;
}
function converted(value, role, field, kind) {
  const label = ROLES[role].label + ' · ' + field;
  if (kind === 'id') return identifier(value, label);
  if (kind === 'integer') return integer(value, label);
  if (kind === 'decimal') return decimal(value, label, role === 'packages' && ['estimated_hours','assumed_hourly_rate_usd','amount_usd'].includes(field));
  return string(value === null || value === undefined ? '' : String(value), label, field === 'note' ? 2000 : 12000,
    !['note'].includes(field));
}
function rowsForBinding(book, binding) {
  const doc = documentIn(book, binding);
  need(reviewIsCurrent(doc), 'TABLE_REVIEW', 'Review the selected source and mapping for ' + ROLES[binding.role].label.toLowerCase() + '.');
  const review = selectedReview(doc), data = JSON.parse(review.dataText), baselineRows = nativeRoleRows(book.baseline, binding.role);
  const before = new Map(baselineRows.map(row => [rowKey(binding.role, row), row]));
  need(before.size === baselineRows.length, 'BASELINE_KEYS', 'Resolve repeated ' + binding.role + ' keys in the original planning editor before applying a source table.');
  const exclusions = new Map(binding.excludedRows.filter(x => x.editionId === review.editionId).map(x => [x.record, x.note]));
  const records = new Set(review.sourceRecords.map(x => x.record));
  need([...exclusions.keys()].every(record => records.has(record)), 'SOURCE_ROW', 'Each exclusion must refer to a retained source data record.');
  const rows = [], sourceRows = [], keys = new Set();
  const workbookRows = planningWorkbookRows(book, doc.id, review.editionId);
  for (let i = 0; i < data.rows.length; i++) {
    const sourceRow = data.rows[i], position = review.sourceRecords[i];
    const provenance = {role: binding.role, documentId: doc.id, editionId: review.editionId,
      reviewId: review.id, sourceSha256: review.sourceSha256, record: position.record, line: position.line,
      ...(workbookRows ? {workbook: workbookRows.get(position.record)} : {})};
    need(!workbookRows || provenance.workbook, 'WORKBOOK_ROW_MAP', 'Retain the original selected worksheet row for this table review.');
    if (exclusions.has(position.record)) {
      string(exclusions.get(position.record), 'Reason for excluding source record ' + position.record, 2000, true);
      sourceRows.push({...provenance, choice: 'exclude', note: exclusions.get(position.record)}); continue;
    }
    let target = {};
    try {
      for (const key of ROLES[binding.role].keys) {
        const field = ROLES[binding.role].fields.find(x => x[0] === key);
        need(binding.fields[key]?.source !== 'existing', 'ROW_KEY', 'Map each row identity from a source column or an explicit constant.');
        target[key] = converted(resolveRule(binding, key, sourceRow, null), binding.role, key, field[2]);
      }
      const key = rowKey(binding.role, target), existing = before.get(key);
      need(!keys.has(key), 'DUPLICATE_ROW', 'Two included source rows map to the same ' + binding.role + ' identity.');
      keys.add(key);
      for (const [field, , kind] of ROLES[binding.role].fields) {
        if (own(target, field)) continue;
        target[field] = converted(resolveRule(binding, field, sourceRow, existing), binding.role, field, kind);
      }
      if (binding.role === 'packages') {
        need(['hours','fixed'].includes(target.pricing_mode), 'PRICING_MODE', 'Choose hours or fixed pricing for ' + target.id + '.');
        if (target.pricing_mode === 'hours') {
          need(target.estimated_hours !== null && target.assumed_hourly_rate_usd !== null, 'HOURS_PRICE', 'Hours pricing needs both estimated hours and an hourly rate.');
        } else need(target.amount_usd !== null, 'FIXED_PRICE', 'Fixed pricing needs a complete amount.');
        if (target.estimated_hours === null) target.estimated_hours = '0';
        if (target.assumed_hourly_rate_usd === null) delete target.assumed_hourly_rate_usd;
        if (target.amount_usd === null) delete target.amount_usd;
      }
      rows.push(target); sourceRows.push({...provenance, choice: 'include', targetKey: key, target: copy(target)});
    } catch (error) {
      if (error instanceof PlanningTableError) Object.assign(error, {record: position.record, line: position.line, role: binding.role});
      throw error;
    }
  }
  need(rows.length || binding.role === 'contributors' || binding.role === 'assignments', 'NO_ROWS', 'Include at least one source row for ' + binding.role + '.');
  if (binding.mode === 'merge') {
    const replaced = new Map(rows.map(row => [rowKey(binding.role, row), row]));
    return {rows: [...baselineRows.map(row => replaced.get(rowKey(binding.role, row)) || row),
      ...rows.filter(row => !before.has(rowKey(binding.role, row)))], sourceRows};
  }
  return {rows, sourceRows};
}
export function comparePlanningValues(before, after) {
  const changes = [];
  const rowChanges = (kind, left, right, keys) => {
    const key = row => JSON.stringify(keys.map(x => row[x]));
    const a = new Map(left.map(row => [key(row), row])), b = new Map(right.map(row => [key(row), row]));
    for (const [id, value] of a) {
      if (!b.has(id)) changes.push({kind, key: id, action: 'remove', before: value, after: null});
      else if (canonical(value) !== canonical(b.get(id))) changes.push({kind, key: id, action: 'change', before: value, after: b.get(id)});
    }
    for (const [id, value] of b) if (!a.has(id)) changes.push({kind, key: id, action: 'add', before: null, after: value});
  };
  for (const role of Object.keys(ROLES)) rowChanges(role, nativeRoleRows(before, role), nativeRoleRows(after, role), ROLES[role].keys);
  for (const field of ['scenario_name','award_request_usd','project_end_day']) {
    if (String(before.scenario[field]) !== String(after.scenario[field])) changes.push({kind: 'settings', key: field,
      action: 'change', before: before.scenario[field], after: after.scenario[field]});
  }
  const leftPayments = before.planning.payments || {}, rightPayments = after.planning.payments || {};
  rowChanges('payment settings', Object.entries(leftPayments).map(([id, value]) => ({id, ...value})),
    Object.entries(rightPayments).map(([id, value]) => ({id, ...value})), ['id']);
  return copy(changes);
}
function editableScenario(scenario) {
  return {scenario_name: scenario.scenario_name, award_request_usd: scenario.award_request_usd, project_end_day: scenario.project_end_day,
    future_costs: scenario.future_costs.map(row => Object.fromEntries(packageFields.filter(key => own(row, key)).map(key => [key, row[key]]))),
    milestones: scenario.milestones.map(row => Object.fromEntries(ROLES.milestones.fields.map(([key]) => [key, row[key]])))};
}
function bookInput(book) {
  const value = copy(book); delete value.reviews; delete value.appliedReviewId; return value;
}
export async function preparePlanningImport(input) {
  const book = await importPlanningBook(input);
  need(book.bindings.length, 'NO_TABLES', 'Add a planning source table.');
  const scenario = copy(book.baseline.scenario), planning = copy(book.baseline.planning), sourceRows = [];
  const imported = {};
  for (const binding of book.bindings) {
    const result = rowsForBinding(book, binding); imported[binding.role] = result.rows; sourceRows.push(...result.sourceRows);
  }
  if (imported.packages) {
    const originals = new Map(scenario.future_costs.map(row => [row.id, row]));
    scenario.future_costs = imported.packages.map(row => {
      const item = {...copy(originals.get(row.id) || {future_only: true, quote_status: 'OPERATOR_PLANNING_INPUT'}), ...copy(row)};
      delete item.pricing_mode; return item;
    });
    planning.pricing = {...planning.pricing};
    for (const row of imported.packages) planning.pricing[row.id] = row.pricing_mode;
  }
  if (imported.milestones) {
    const originals = new Map(scenario.milestones.map(row => [row.tranche, row]));
    scenario.milestones = imported.milestones.map(row => ({...copy(originals.get(row.tranche) || {}), ...row})).sort((a,b) => a.tranche - b.tranche);
  }
  if (imported.contributors) planning.contributors = imported.contributors;
  if (imported.assignments) planning.assignments = imported.assignments;
  scenario.scenario_name = book.settings.scenarioName;
  scenario.award_request_usd = decimal(book.settings.awardRequestUsd, 'Requested award');
  scenario.project_end_day = integer(book.settings.projectEndDay, 'Project end day');
  const packageIds = new Set(scenario.future_costs.map(row => row.id)), contributorIds = new Set((planning.contributors || []).map(row => row.id));
  const orphanAssignments = (planning.assignments || []).filter(row => !packageIds.has(row.costId) || !contributorIds.has(row.contributorId));
  const orphanPayments = Object.keys(planning.payments || {}).filter(id => !packageIds.has(id));
  const orphanPricing = Object.keys(planning.pricing || {}).filter(id => !packageIds.has(id));
  if (orphanAssignments.length || orphanPayments.length || orphanPricing.length) {
    need(book.orphanPolicy === 'remove-unreferenced', 'DEPENDENT_ROWS',
      'The replacement removes rows used by saved assignments or payment settings. Keep those source rows, or explicitly choose removal of their dependent settings.',
      {assignments: orphanAssignments, paymentIds: orphanPayments, pricingIds: orphanPricing});
    planning.assignments = (planning.assignments || []).filter(row => packageIds.has(row.costId) && contributorIds.has(row.contributorId));
    planning.payments = Object.fromEntries(Object.entries(planning.payments || {}).filter(([id]) => packageIds.has(id)));
    planning.pricing = Object.fromEntries(Object.entries(planning.pricing || {}).filter(([id]) => packageIds.has(id)));
  }
  const bindingHash = await sha256(JSON.stringify(bookInput(book)));
  const scenarioPatch = editableScenario(scenario);
  const review = {id: bindingHash, preparedAt: stamp(), base: {id: book.baseline.id, revision: book.baseline.revision,
    contentSha256: book.baseline.contentSha256}, sourceRows, changes: comparePlanningValues(book.baseline, {scenario, planning}),
    scenarioPatch: copy(scenarioPatch), planning: copy(planning)};
  return {schema: PREVIEW_SCHEMA, id: bindingHash, book, expectedRevision: book.baseline.revision,
    planId: book.baseline.id, scenarioPatch, planning: {...planning, sourceTables: retainPlanningBook(book)}, review};
}
export function requireCurrentBaseline(book, plan) {
  need(book.baseline.id === plan.id && book.baseline.revision === plan.revision &&
    book.baseline.contentSha256 === plan.contentSha256, 'BASELINE_CHANGED',
    'This source project compares with an earlier saved plan. Review the current native revision and rebase the source project before preparing its changes.');
}
export function requireWorkingBaseline(book, plan, draft) {
  requireCurrentBaseline(book, plan);
  need(canonical(editableScenario(book.baseline.scenario)) === canonical(editableScenario(draft.scenario)) &&
    canonical(book.baseline.planning) === canonical(withoutTables(draft.planning)), 'WORKING_DRAFT_CHANGED',
    'Save the current native draft, then rebase this source project on that saved plan before preparing another table import.');
}
export async function completeNativePreview(preparation, nativeResult) {
  need(preparation?.schema === PREVIEW_SCHEMA && object(nativeResult?.scenario) && object(nativeResult?.planning) &&
    nativeResult.report?.schema === 'stellar-forge.sf47-planning.v1', 'NATIVE_PREVIEW', 'Use the complete response from the original planner estimate.');
  const requested = await preparePlanningImport(preparation.book);
  need(requested.id === preparation.id && canonical(requested.scenarioPatch) === canonical(preparation.scenarioPatch) &&
    canonical(requested.planning) === canonical(preparation.planning), 'PREVIEW_CHANGED', 'Rebuild the preview from the complete current source project.');
  need(canonical(nativeResult.planning.sourceTables) === canonical(retainPlanningBook(preparation.book)), 'NATIVE_SOURCE', 'The native estimate must retain this complete source project.');
  const result = copy(preparation);
  result.native = copy(nativeResult);
  result.nativeSha256 = await sha256(canonical(nativeResult));
  result.review.changes = comparePlanningValues(result.book.baseline, {scenario: nativeResult.scenario, planning: nativeResult.planning});
  result.review.calculatorSha256 = nativeResult.report.calculatorSha256;
  result.review.scenarioSha256 = nativeResult.report.scenarioSha256;
  result.review.nativeSummary = {awardRequestUsd: nativeResult.scenario.award_request_usd,
    hours: nativeResult.report.capacity?.totalHours, payouts: nativeResult.report.originalModel?.payouts,
    peakCashGapUsd: nativeResult.report.cash?.peakCashGapUsd,
    peakCashGapDay: nativeResult.report.cash?.peakCashGapDay};
  return result;
}
export async function acceptPlanningPreview(preview, currentBook, {note, reviewedAt = stamp()} = {}) {
  string(note, 'Source-import review note', 4000, true);
  need(preview?.native && preview.schema === PREVIEW_SCHEMA, 'NATIVE_PREVIEW', 'Calculate the complete source import with the original planner first.');
  need(hash.test(preview.nativeSha256 || '') && await sha256(canonical(preview.native)) === preview.nativeSha256,
    'NATIVE_PREVIEW_CHANGED', 'Recalculate the native preview after a change to its saved result.');
  const current = await preparePlanningImport(currentBook);
  need(current.id === preview.id, 'PREVIEW_CHANGED', 'The sources or mapping changed. Calculate the new preview before applying it.');
  const book = copy(currentBook), review = {...copy(preview.review), note, reviewedAt};
  const existing = book.reviews.findIndex(x => x.id === review.id);
  if (existing < 0) book.reviews.push(review); else book.reviews[existing] = review;
  book.appliedReviewId = review.id;
  return {scenario: copy(preview.native.scenario), planning: {...copy(preview.native.planning), sourceTables: retainPlanningBook(book)},
    report: copy(preview.native.report)};
}
function csvCell(value) { return '"' + String(value ?? '').replaceAll('"','""') + '"'; }
export function planningRoleCsv(plan, role) {
  need(own(ROLES, role), 'ROLE', 'Choose a supported planning table.');
  const baseline = plan.scenario && plan.planning ? plan : plan.baseline;
  const fields = ROLES[role].fields.map(x => x[0]), rows = nativeRoleRows(baseline, role);
  return [fields, ...rows.map(row => fields.map(field => row[field] ?? ''))].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
export async function planningBookFromNative(plan, {roles = Object.keys(ROLES)} = {}) {
  let book = createPlanningBook(plan);
  for (const role of roles) {
    if (!nativeRoleRows(book.baseline, role).length) continue;
    book = await addPlanningTable(book, {role, filename: role + '-revision-' + plan.revision + '.csv', sourceText: planningRoleCsv(plan, role)});
    const binding = bindingIn(book, role), doc = documentIn(book, binding);
    doc.mapping.keyColumns = ROLES[role].keys.map(key => doc.mapping.columns.find(x => x.sourceName === key).index);
    book = await retainPlanningTableReview(book, role);
  }
  return book;
}
export function tableImportGuide(book) {
  return '# ' + book.name + '\n\n' +
    'Open Source tables in the original Grant Planning application. Use Open source project to receive planning-source-tables.json. ' +
    'Its complete source editions, mappings, row decisions and reviewed changes remain editable.\n\n' +
    'Select the intended saved plan. If this project was prepared against an earlier native revision, use Rebase on saved plan, ' +
    'review its complete proposed changes and Calculate native preview. Enter the review note and apply the preview to the working plan. ' +
    'Save a named revision with the existing Save revision control. Download the complete planning ZIP after saving.\n\n' +
    'In Prepare submission, choose Planning edition and receive that planning ZIP. Review the selected native revision, ' +
    'prepare its complete budget and roadmap, and apply the reviewed text to the appropriate answer or issuer field.\n\n' +
    'CSV amounts, rates and hours remain decimal text through mapping. The original planning calculator applies the saved hours/fixed pricing choices ' +
    'and its documented rounding and payment model. The source-import preview shows that complete result before applying it.\n\n' +
    'Table inputs replace or merge only the chosen planning roles. The original payment timing and capital settings remain available in the same plan. ' +
    'The exact source rows and explicit exclusions travel in the portable source project and every native planning revision that retains it.\n' + workbookOperatingGuide(book);
}
export const serializePlanningBook = book => json(book);
