// MIT. Exact saved SF47 customer-use selections bound to original SF88 plans.
import { createHash } from 'node:crypto';

export const CUSTOMER_USE_SOURCE_SCHEMA = 'stellar-forge.sf47-customer-use-calendar.v1.selection';
export const CUSTOMER_USE_COMMISSION_SCHEMA = 'stellar-forge.sf88.customer-use-commission.v1';
export const CUSTOMER_USE_LIMITS = Object.freeze({
  sourceBytes: 32 * 1024 * 1024,
  documentBytes: 2 * 1024 * 1024,
  installations: 100,
  usesPerInstallation: 500,
  periods: 500,
  bindings: 2000,
  requestsPerBinding: 500,
});
const HASH = /^[a-f0-9]{64}$/;
const OWN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const MODES = new Set(['PURCHASE', 'ALLOWANCE_USE', 'REOPEN', 'FREE_USE']);
const STATES = new Set(['PLANNED', 'CANCELLED']);
export function customerUseError(code, message, status = 400, details) {
  return Object.assign(new Error(message), { code, status, ...(details === undefined ? {} : { details }) });
}
export function requireCustomerUse(condition, code, message, status = 400, details) {
  if (!condition) throw customerUseError(code, message, status, details);
}
export function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
export function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (plainObject(value)) return '{' + Object.keys(value).sort().map(key =>
    JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  throw customerUseError('CUSTOMER_USE_JSON_REQUIRED', 'Retain an ordinary complete JSON value.');
}
export function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
export function valueDigest(value) { return digest(canonical(value)); }
export function copy(value) { return JSON.parse(canonical(value)); }
function object(value, allowed, label) {
  requireCustomerUse(plainObject(value) && Object.keys(value).every(key => allowed.includes(key)),
    'CUSTOMER_USE_DOCUMENT_INVALID', 'Use the supported ' + label + ' fields.');
  return value;
}
function list(value, maximum, label) {
  requireCustomerUse(Array.isArray(value) && value.length <= maximum,
    'CUSTOMER_USE_LIST_INVALID', 'Retain at most ' + maximum + ' ' + label + '.');
  return value;
}
function text(value, label, maximum = 4000, required = false) {
  requireCustomerUse(typeof value === 'string' && value.length <= maximum && !value.includes('\0')
    && (!required || value.trim().length > 0), 'CUSTOMER_USE_TEXT_INVALID',
    'Retain ' + (required ? 'a nonempty ' : '') + label + ' within ' + maximum + ' characters.');
  return value;
}
function originalId(value, label) { return text(value, label, 512, true); }
export function commissionId(value) {
  requireCustomerUse(typeof value === 'string' && OWN_ID.test(value) && value !== '.' && value !== '..',
    'CUSTOMER_USE_ID_INVALID', 'Use a stable reference of at most 80 letters, digits, dots, underscores or hyphens.');
  return value;
}
export function hash(value, label = 'original SHA-256') {
  requireCustomerUse(typeof value === 'string' && HASH.test(value),
    'CUSTOMER_USE_HASH_INVALID', 'Retain the exact ' + label + '.');
  return value;
}
function integer(value, label, minimum = 1) {
  requireCustomerUse(Number.isSafeInteger(value) && value >= minimum,
    'CUSTOMER_USE_INTEGER_INVALID', 'Retain the original ' + label + ' as an integer.');
  return value;
}
export function civilDate(value) {
  requireCustomerUse(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(value + 'T00:00:00.000Z'))
    && new Date(value + 'T00:00:00.000Z').toISOString().slice(0, 10) === value,
    'CUSTOMER_USE_DATE_INVALID', 'Retain the original UTC civil date.');
  return value;
}
function distinct(values, key, label) {
  const seen = new Set();
  for (const value of values) {
    const identity = key(value);
    requireCustomerUse(!seen.has(identity), 'CUSTOMER_USE_DUPLICATE', 'Retain each ' + label + ' once.');
    seen.add(identity);
  }
  return values;
}
export function installationKey(value) {
  return canonical([value.id ?? value.installationId, value.revision, value.sha256 ?? value.installationSha256]);
}
export function entryKey(value) {
  return canonical([value.installationId, value.revision, value.installationSha256, value.entryId]);
}
export function planKey(value) { return canonical([value.planId, value.planSha256]); }
function sourceArray(value, label, maximum = 100000) {
  return list(value, maximum, label);
}
function checkedSource(value) {
  requireCustomerUse(plainObject(value) && value.schema === CUSTOMER_USE_SOURCE_SCHEMA,
    'CUSTOMER_USE_SOURCE_FORMAT_REQUIRED', 'Choose the complete original Customer-use calendar JSON export.');
  requireCustomerUse(plainObject(value.source), 'CUSTOMER_USE_SOURCE_INVALID', 'Retain the complete original case and plan selection.');
  originalId(value.source.caseId, 'case identity');
  integer(value.source.caseVersion, 'case version');
  originalId(value.source.mode, 'case mode');
  originalId(value.source.planId, 'plan identity');
  hash(value.source.planContentSha256, 'original case plan digest');
  civilDate(value.asOfDate);
  const selections = sourceArray(value.selection, 'Installation selections', CUSTOMER_USE_LIMITS.installations);
  distinct(selections, installationKey, 'selected Installation edition');
  for (const selection of selections) {
    requireCustomerUse(plainObject(selection), 'CUSTOMER_USE_SOURCE_INVALID', 'Retain each complete original Installation reference.');
    originalId(selection.id, 'Installation identity'); integer(selection.revision, 'Installation revision');
    hash(selection.sha256, 'Installation edition digest');
  }
  const selected = new Set(selections.map(installationKey));
  const calendars = sourceArray(value.calendars, 'saved Installation calendars', CUSTOMER_USE_LIMITS.installations);
  distinct(calendars, installationKey, 'saved Installation calendar');
  requireCustomerUse(calendars.length > 0, 'CUSTOMER_USE_CALENDAR_REQUIRED',
    'Select at least one saved Installation with a customer-use calendar.');
  for (const calendar of calendars) {
    requireCustomerUse(plainObject(calendar) && selected.has(installationKey(calendar)),
      'CUSTOMER_USE_SOURCE_BINDING_INVALID', 'Keep each calendar attached to its original selected Installation edition.');
    const doc = calendar.document;
    requireCustomerUse(plainObject(doc) && doc.schema === 'stellar-forge.sf47-customer-use-calendar.v1',
      'CUSTOMER_USE_SOURCE_INVALID', 'Retain the complete original saved customer-use document.');
    civilDate(doc.startDate); civilDate(doc.endDate);
    requireCustomerUse(doc.startDate <= doc.endDate, 'CUSTOMER_USE_SOURCE_INVALID', 'The original calendar window is reversed.');
    const tasks = sourceArray(doc.tasks, 'original useful tasks', 80);
    const groups = sourceArray(doc.settlements, 'original funding groups', 500);
    const entries = sourceArray(doc.entries, 'original dated uses', CUSTOMER_USE_LIMITS.usesPerInstallation);
    for (const [rows, label] of [[tasks, 'task'], [groups, 'funding group'], [entries, 'dated use']]) {
      for (const row of rows) {
        requireCustomerUse(plainObject(row), 'CUSTOMER_USE_SOURCE_INVALID', 'Retain each original ' + label + ' object.');
        originalId(row.id, label + ' identity');
      }
      distinct(rows, row => row.id, 'original ' + label);
    }
    const taskIds = new Set(tasks.map(row => row.id)), funding = new Map(groups.map(row => [row.id, row]));
    for (const task of tasks)
      for (const field of ['name', 'purpose', 'request', 'completeOutput', 'repeatTrigger', 'pricedUnit'])
        text(task[field], 'original task ' + field, 16000);
    for (const group of groups) {
      originalId(group.buyerDeploymentId, 'original buyer identity'); civilDate(group.date);
      requireCustomerUse(taskIds.has(group.taskId) && ['DIRECT', 'PREPAID'].includes(group.kind),
        'CUSTOMER_USE_SOURCE_BINDING_INVALID', 'Retain the original task and kind of each funding group.');
      distinct(sourceArray(group.purchaseIds, 'original purchase references', 200), id => originalId(id, 'purchase identity'), 'purchase reference');
    }
    for (const entry of entries) {
      originalId(entry.buyerDeploymentId, 'original buyer identity'); civilDate(entry.date);
      requireCustomerUse(entry.date >= doc.startDate && entry.date <= doc.endDate
        && taskIds.has(entry.taskId) && STATES.has(entry.state) && MODES.has(entry.mode),
      'CUSTOMER_USE_SOURCE_BINDING_INVALID', 'Retain the saved task, state, mode and date window of each use.');
      const ids = distinct(sourceArray(entry.fundingIds, 'funding references', 100), id => originalId(id, 'funding identity'), 'funding reference');
      requireCustomerUse(ids.every(id => funding.has(id)), 'CUSTOMER_USE_SOURCE_BINDING_INVALID',
        'Every use must retain its original selected funding groups.');
      if (['PURCHASE', 'ALLOWANCE_USE'].includes(entry.mode)) requireCustomerUse(ids.length > 0,
        'CUSTOMER_USE_SOURCE_BINDING_INVALID', 'Retain the saved funding relationship for a purchase or allowance use.');
      else requireCustomerUse(ids.length === 0, 'CUSTOMER_USE_SOURCE_BINDING_INVALID',
        'A reopened or free result carries no new planned settlement.');
      for (const id of ids) {
        const group = funding.get(id);
        requireCustomerUse(group.buyerDeploymentId === entry.buyerDeploymentId && group.date <= entry.date
          && group.kind === (entry.mode === 'ALLOWANCE_USE' ? 'PREPAID' : 'DIRECT')
          && (entry.mode !== 'PURCHASE' || group.taskId === entry.taskId),
        'CUSTOMER_USE_SOURCE_BINDING_INVALID', 'Retain the original buyer, task and funding semantics.');
      }
    }
    requireCustomerUse(plainObject(calendar.report) && Array.isArray(calendar.report.entries),
      'CUSTOMER_USE_SOURCE_INVALID', 'Retain the saved report and its original buyer observations.');
    const reportEntries = new Map(calendar.report.entries.map(row => [row.id, row]));
    requireCustomerUse(reportEntries.size === entries.length, 'CUSTOMER_USE_SOURCE_BINDING_INVALID',
      'The saved report and dated-use inventory differ.');
    for (const entry of entries) {
      const observed = reportEntries.get(entry.id);
      requireCustomerUse(plainObject(observed) && plainObject(observed.task) && plainObject(observed.buyer)
        && observed.task.id === entry.taskId && observed.buyer.id === entry.buyerDeploymentId
        && ['taskId', 'buyerDeploymentId', 'date', 'mode', 'state'].every(key => observed[key] === entry[key]),
      'CUSTOMER_USE_SOURCE_BINDING_INVALID', 'A saved report row belongs to another original task or buyer.');
    }
  }
  for (const key of ['groups', 'dueUses', 'receipts', 'receiptConflicts', 'unlinkedPurchases', 'sources'])
    sourceArray(value[key], 'original ' + key);
  text(value.qualification, 'original qualification statement', 16000, true);
  return value;
}
/** Validate native structure while retaining every original byte and unprojected field. */
export function readCustomerUseSource(bytes) {
  requireCustomerUse(bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= CUSTOMER_USE_LIMITS.sourceBytes,
    'CUSTOMER_USE_SOURCE_SIZE', 'Choose a complete calendar export within the 32 MiB source limit.', 413);
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw customerUseError('CUSTOMER_USE_SOURCE_JSON', 'Choose the original UTF-8 JSON calendar export.'); }
  checkedSource(value);
  return { bytes: bytes.length, sha256: digest(bytes), value };
}
export function sourceCatalogue(source) {
  checkedSource(source);
  const entries = [];
  for (const calendar of source.calendars) {
    const reportEntries = new Map(calendar.report.entries.map(row => [row.id, row]));
    const funding = new Map(calendar.document.settlements.map(row => [row.id, row]));
    for (const entry of calendar.document.entries) {
      const observed = reportEntries.get(entry.id);
      entries.push({
        ref: { installationId: calendar.id, revision: calendar.revision, installationSha256: calendar.sha256, entryId: entry.id },
        installation: { id: calendar.id, revision: calendar.revision, sha256: calendar.sha256,
          name: calendar.name, stage: calendar.stage, sourceVersion: calendar.sourceVersion, groupId: calendar.groupId },
        entry: copy(entry), task: copy(observed.task), buyer: copy(observed.buyer),
        funding: entry.fundingIds.map(id => copy(funding.get(id))),
        currentChanges: copy(calendar.currentChanges), sourceChanged: calendar.sourceChanged,
      });
    }
  }
  return entries;
}
function reference(value) {
  object(value, ['installationId', 'revision', 'installationSha256', 'entryId'], 'original dated-use reference');
  return { installationId: originalId(value.installationId, 'Installation identity'),
    revision: integer(value.revision, 'Installation revision'), installationSha256: hash(value.installationSha256),
    entryId: originalId(value.entryId, 'dated-use identity') };
}
function period(value) {
  object(value, ['collectionId', 'name', 'planId', 'planSha256', 'values'], 'original period selection');
  requireCustomerUse(plainObject(value.values) && Object.keys(value.values).length <= 100,
    'CUSTOMER_USE_PERIOD_VALUES_INVALID', 'Retain the original period parameter values as an object.');
  const values = Object.fromEntries(Object.entries(value.values).map(([key, value]) => [
    text(key, 'parameter name', 100, true), text(value, 'parameter value', 8000),
  ]));
  return { collectionId: commissionId(value.collectionId), name: text(value.name, 'period name', 160, true),
    planId: commissionId(value.planId), planSha256: hash(value.planSha256, 'saved Request plan revision'), values };
}
function requestReference(value) {
  object(value, ['collectionId', 'requestKey'], 'original period request reference');
  return { collectionId: commissionId(value.collectionId), requestKey: commissionId(value.requestKey) };
}
function responseReference(value) {
  object(value, ['collectionId', 'manifestSha256', 'intentId', 'responseSha256'], 'retained result reference');
  return { collectionId: commissionId(value.collectionId), manifestSha256: hash(value.manifestSha256),
    intentId: originalId(value.intentId, 'original intent identity'), responseSha256: hash(value.responseSha256) };
}
/** A following commission revision changes bindings; it never rewrites the Calendar source. */
export function customerUseDocument(value, source, expectedSourceSha256) {
  object(value, ['schema', 'id', 'name', 'calendarSha256', 'note', 'periods', 'bindings'], 'commission');
  requireCustomerUse(value.schema === CUSTOMER_USE_COMMISSION_SCHEMA, 'CUSTOMER_USE_DOCUMENT_SCHEMA',
    'Use the supported saved customer-use commissioning schema.');
  requireCustomerUse(hash(value.calendarSha256) === hash(expectedSourceSha256), 'CUSTOMER_USE_SOURCE_CHANGED',
    'Keep the exact selected calendar export attached to this commission.', 409);
  checkedSource(source);
  const catalogue = new Map(sourceCatalogue(source).map(row => [entryKey(row.ref), row]));
  const periods = distinct(list(value.periods, CUSTOMER_USE_LIMITS.periods, 'selected periods').map(period),
    row => row.collectionId, 'original period reference');
  const periodIds = new Set(periods.map(row => row.collectionId));
  const bindings = distinct(list(value.bindings, CUSTOMER_USE_LIMITS.bindings, 'use bindings').map(row => {
    object(row, ['id', 'entry', 'kind', 'requests', 'responses', 'note'], 'dated-use binding');
    const entry = reference(row.entry), original = catalogue.get(entryKey(entry));
    requireCustomerUse(original, 'CUSTOMER_USE_ENTRY_NOT_FOUND',
      'Select the exact original Installation edition and dated use.', 404);
    requireCustomerUse(['PERIOD_REQUESTS', 'RETAINED_RESPONSES'].includes(row.kind), 'CUSTOMER_USE_BINDING_KIND_INVALID',
      'Choose original period requests or an already retained response.');
    const requests = distinct(list(row.requests ?? [], CUSTOMER_USE_LIMITS.requestsPerBinding, 'period requests').map(requestReference),
      item => canonical([item.collectionId, item.requestKey]), 'period request');
    const responses = distinct(list(row.responses ?? [], CUSTOMER_USE_LIMITS.requestsPerBinding, 'retained responses').map(responseReference),
      item => canonical([item.collectionId, item.intentId]), 'retained response');
    if (row.kind === 'PERIOD_REQUESTS') {
      requireCustomerUse(original.entry.mode !== 'REOPEN' && requests.length > 0 && responses.length === 0
        && requests.every(item => periodIds.has(item.collectionId)), 'CUSTOMER_USE_REQUEST_BINDING_INVALID',
      'Bind an active request use to its selected periods. Reopened results use their existing response identities.');
    } else {
      requireCustomerUse(original.entry.mode === 'REOPEN' && responses.length > 0 && requests.length === 0,
        'CUSTOMER_USE_REOPEN_BINDING_INVALID', 'Bind a reopen entry to its existing original saved responses.');
    }
    return { id: commissionId(row.id), entry, kind: row.kind, requests, responses,
      note: text(row.note ?? '', 'operator binding note', 8000) };
  }), row => row.id, 'binding reference');
  distinct(bindings, row => entryKey(row.entry), 'dated-use binding');
  const document = { schema: CUSTOMER_USE_COMMISSION_SCHEMA, id: commissionId(value.id),
    name: text(value.name, 'commission name', 160, true), calendarSha256: value.calendarSha256,
    note: text(value.note ?? '', 'commission note', 16000), periods, bindings };
  requireCustomerUse(Buffer.byteLength(canonical(document)) <= CUSTOMER_USE_LIMITS.documentBytes,
    'CUSTOMER_USE_DOCUMENT_SIZE', 'The complete commission exceeds its 2 MiB definition limit.', 413);
  return document;
}
/** Only declared original Request plan keys/parameters are accepted, with no request reconstruction. */
export function checkCustomerUsePlans(document, plans) {
  const byPeriod = new Map();
  for (const selected of document.periods) {
    const plan = plans.get(planKey(selected));
    requireCustomerUse(plainObject(plan) && plan.schema === 'stellar-forge.sf88.collection-plan.v1'
      && plan.id === selected.planId && Array.isArray(plan.requests) && Array.isArray(plan.parameters),
    'CUSTOMER_USE_PLAN_NOT_FOUND', 'Read the exact selected saved Request plan revision.', 404);
    const keys = new Set(plan.requests.map(row => row.key));
    requireCustomerUse(keys.size === plan.requests.length, 'CUSTOMER_USE_PLAN_INVALID', 'Original Request plan keys differ.');
    const parameters = new Set(plan.parameters.map(row => row.name));
    requireCustomerUse(Object.keys(selected.values).every(key => parameters.has(key)), 'CUSTOMER_USE_PERIOD_VALUES_INVALID',
      'Period values must name original declared Request plan parameters.');
    byPeriod.set(selected.collectionId, keys);
  }
  for (const binding of document.bindings)
    for (const request of binding.requests)
      requireCustomerUse(byPeriod.get(request.collectionId)?.has(request.requestKey), 'CUSTOMER_USE_REQUEST_NOT_FOUND',
        'Choose a request key from this period’s exact saved plan revision.', 404);
  return document;
}
export function commissionSelection(document, source, collectionId) {
  const period = document.periods.find(row => row.collectionId === collectionId);
  requireCustomerUse(period, 'CUSTOMER_USE_PERIOD_NOT_FOUND', 'Choose an original period in this saved commission.', 404);
  const originals = new Map(sourceCatalogue(source).map(row => [entryKey(row.ref), row]));
  const bindings = document.bindings.filter(row => row.requests.some(item => item.collectionId === collectionId))
    .map(binding => ({ binding: copy(binding), original: originals.get(entryKey(binding.entry)) }));
  const active = bindings.filter(row => row.original.entry.state === 'PLANNED');
  const requestKeys = [...new Set(active.flatMap(row => row.binding.requests
    .filter(item => item.collectionId === collectionId).map(item => item.requestKey)))];
  requireCustomerUse(requestKeys.length > 0, 'CUSTOMER_USE_ACTIVE_REQUEST_REQUIRED',
    'Select at least one planned dated use before preparing this period.', 409);
  return { period: copy(period), bindings: copy(bindings), activeRequestKeys: requestKeys,
    cancelledBindingIds: bindings.filter(row => row.original.entry.state === 'CANCELLED').map(row => row.binding.id),
    executionStarted: false };
}
export function customerUseReview(document, source) {
  const originals = sourceCatalogue(source), bindings = new Map(document.bindings.map(row => [entryKey(row.entry), row]));
  const rows = originals.map(original => {
    const binding = bindings.get(entryKey(original.ref));
    return { ...original, binding: binding ? copy(binding) : null,
      state: original.entry.state === 'CANCELLED' ? 'CANCELLED' : binding ? 'BOUND' : 'UNBOUND' };
  });
  const occurrences = new Map();
  for (const row of rows)
    for (const selected of row.binding?.requests ?? []) {
      const key = canonical([selected.collectionId, selected.requestKey]);
      const owners = occurrences.get(key) ?? [];
      owners.push({ bindingId: row.binding.id, entry: row.ref, mode: row.entry.mode, date: row.entry.date });
      occurrences.set(key, owners);
    }
  return { schema: CUSTOMER_USE_COMMISSION_SCHEMA + '.review', source: copy(source.source),
    asOfDate: source.asOfDate, calendarSha256: document.calendarSha256, rows,
    periods: copy(document.periods), repeatedRequestBindings: [...occurrences.values()].filter(rows => rows.length > 1),
    receiptConflicts: copy(source.receiptConflicts), receipts: copy(source.receipts),
    groups: copy(source.groups), sources: copy(source.sources),
    counts: { savedUses: rows.length, activeUses: rows.filter(row => row.entry.state === 'PLANNED').length,
      boundUses: rows.filter(row => row.state === 'BOUND').length,
      cancelledUses: rows.filter(row => row.state === 'CANCELLED').length,
      periods: document.periods.length, uniqueBoundRequests: occurrences.size,
      reopenedResponses: document.bindings.reduce((sum, row) => sum + row.responses.length, 0) },
    qualification: source.qualification,
    execution: 'Prepare and create only the reviewed original period. Its existing Collections approval, signer, budget and receiving controls own execution.',
    purchaseBasis: 'These are planned uses and request bindings. Native buyer observations retain actual settlement, allowance, output and order states; the original Grant receiving and Cohort review establish their use.' };
}
function csvCell(value) {
  const text = typeof value === 'string' ? value : canonical(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}
export function customerUseCsv(review) {
  const fields = ['installationId', 'installationRevision', 'installationSha256', 'entryId', 'date',
    'mode', 'calendarState', 'buyerDeploymentId', 'taskId', 'task', 'purpose', 'wholeOutput',
    'sourcePeriod', 'fundingIds', 'bindingId', 'bindingKind', 'requests', 'responses', 'note'];
  const rows = review.rows.map(row => [row.ref.installationId, row.ref.revision, row.ref.installationSha256,
    row.ref.entryId, row.entry.date, row.entry.mode, row.entry.state, row.entry.buyerDeploymentId,
    row.task.id, row.task.name, row.task.purpose, row.task.completeOutput, row.entry.sourcePeriod,
    row.entry.fundingIds, row.binding?.id ?? '', row.binding?.kind ?? '', row.binding?.requests ?? [],
    row.binding?.responses ?? [], row.binding?.note ?? '']);
  return Buffer.from([fields, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n');
}
