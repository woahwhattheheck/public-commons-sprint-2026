// MIT. Original-record operations analysis and reviewed incident documents.
import { canonical, sha256, fail, fields, record } from '../common.mjs';
import { validateGrpcHealthSnapshot } from '../health-record.mjs';

export const OPERATIONS_CAPTURE_SCHEMA = 'stellar-forge.grpc-operations-capture.v1';
export const OPERATIONS_CASE_SCHEMA = 'stellar-forge.grpc-incident-revision.v1';
export const OPERATIONS_EXPORT_SCHEMA = 'stellar-forge.grpc-operations-export.v1';
export const OPERATIONS_MAX_BYTES = 128 * 1024 * 1024;
export const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export const SHA = /^[a-f0-9]{64}$/;
const PHASES = ['ATTEMPTED', 'COMPLETED', 'OUTCOME_UNCONFIRMED', 'NOT_STARTED'];
const isDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const changed = () => fail('GRPC_OPERATIONS_RECORD_CHANGED', 409);
const exact = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
export function operationId(value) { if (!UUID.test(value ?? '')) fail('GRPC_OPERATIONS_ID_REQUIRED'); return value; }
export function operationSha(value) { if (!SHA.test(value ?? '')) fail('GRPC_OPERATIONS_SHA_REQUIRED'); return value; }
function boundedText(value, maximum, required = false) {
  if (typeof value !== 'string' || value.length > maximum || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value) || required && !value.trim())
    fail('GRPC_OPERATIONS_TEXT_INVALID');
  return value;
}
export function normalizeOperationsSelection(value = {}) {
  fields(value, ['from', 'to', 'revisions', 'methods', 'includeHealth'], 'GRPC_OPERATIONS_SELECTION_INVALID');
  const list = (items, validate) => {
    if (items === undefined) return [];
    if (!Array.isArray(items) || items.length > 500) fail('GRPC_OPERATIONS_SELECTION_INVALID');
    const normalized = items.map(validate);
    if (new Set(normalized).size !== normalized.length) fail('GRPC_OPERATIONS_SELECTION_INVALID');
    return normalized.sort();
  };
  const date = value => { if (value === undefined || value === null) return null; if (!isDate(value)) fail('GRPC_OPERATIONS_DATE_INVALID'); return value; };
  const from = date(value.from), to = date(value.to);
  if (from && to && from > to) fail('GRPC_OPERATIONS_DATE_RANGE_INVALID');
  if (value.includeHealth !== undefined && typeof value.includeHealth !== 'boolean') fail('GRPC_OPERATIONS_SELECTION_INVALID');
  return { from, to, revisions: list(value.revisions, operationSha),
    methods: list(value.methods, name => { if (typeof name !== 'string' || name.length > 1024 || !/^\/[A-Za-z_][\w.]*(?:\/[A-Za-z_]\w*)$/.test(name)) fail('GRPC_OPERATIONS_METHOD_INVALID'); return name; }),
    includeHealth: value.includeHealth ?? true };
}
export function selectedCall(call, selection) {
  return (!selection.revisions.length || selection.revisions.includes(call.revision)) &&
    (!selection.methods.length || selection.methods.includes(call.method)) &&
    (!selection.from || call.startedAt >= selection.from) && (!selection.to || call.startedAt <= selection.to);
}
export function selectedHealth(summary, selection) {
  const services = new Set(selection.methods.map(method => method.slice(1, method.lastIndexOf('/'))));
  return selection.includeHealth && (!selection.revisions.length || selection.revisions.includes(summary.revision)) &&
    (!selection.to || summary.createdAt <= selection.to) && (!selection.from || summary.deadlineAt >= selection.from) &&
    (!services.size || summary.kind === 'list' || !summary.service || services.has(summary.service));
}
export function validateOperationsCapture(value) {
  if (!exact(value, ['schema', 'id', 'originWorkspaceId', 'startedAt', 'capturedAt', 'selection', 'selectionSha256',
    'selectedRevision', 'generation', 'attemptInventorySnapshot', 'calls', 'health', 'revisions', 'prepared', 'captureSha256']) ||
    value.schema !== OPERATIONS_CAPTURE_SCHEMA || !UUID.test(value.id ?? '') || !UUID.test(value.originWorkspaceId ?? '') ||
    !isDate(value.startedAt) || !isDate(value.capturedAt) || value.capturedAt < value.startedAt ||
    !(value.selectedRevision === null || SHA.test(value.selectedRevision ?? '')) || !Number.isSafeInteger(value.generation) || value.generation < 0 ||
    !SHA.test(value.attemptInventorySnapshot ?? '') || !Array.isArray(value.calls) || !Array.isArray(value.health) ||
    !Array.isArray(value.revisions) || !Array.isArray(value.prepared)) changed();
  const selection = normalizeOperationsSelection(value.selection);
  if (canonical(selection) !== canonical(value.selection) || value.selectionSha256 !== sha256(canonical(selection))) changed();
  const revisions = new Map();
  for (const row of value.revisions) {
    if (!exact(row, ['schema', 'id', 'parent', 'createdAt', 'title', 'source', 'protoSource', 'plan']) ||
      row.schema !== 'stellar-forge.grpc-workspace-revision.v1' || !SHA.test(row.id ?? '') || revisions.has(row.id) ||
      !(row.parent === null || SHA.test(row.parent ?? '')) || !isDate(row.createdAt) ||
      !record(row.source) || !record(row.protoSource) || !record(row.plan) ||
      sha256(canonical({ source: row.source, protoSource: row.protoSource, plan: row.plan, title: row.title })) !== row.id) changed();
    revisions.set(row.id, row);
  }
  const calls = new Set(), health = new Set();
  for (const call of value.calls) {
    if (!record(call) || call.schema !== 'stellar-forge.grpc-workspace-call.v1' || !UUID.test(call.id ?? '') ||
      calls.has(call.id) || !revisions.has(call.revision) || !PHASES.includes(call.phase) ||
      !isDate(call.startedAt) || call.finishedAt !== undefined && !isDate(call.finishedAt) ||
      !selectedCall(call, selection) || call.inputSha256 !== sha256(canonical(call.input)) ||
      call.fingerprint !== sha256(canonical({ revision: call.revision, method: call.method, input: call.input })) ||
      call.responseSha256 !== undefined && (!call.outputRetained || call.responseSha256 !== sha256(canonical(call.output))) ||
      call.phase === 'COMPLETED' && !call.outputRetained) changed();
    calls.add(call.id);
  }
  for (const observation of value.health) {
    validateGrpcHealthSnapshot(observation);
    const op = observation.operation;
    if (health.has(op.id) || !revisions.has(op.revision) || !selectedHealth(observation.summary, selection) ||
      sha256(canonical(revisions.get(op.revision).source)) !== op.sourceSha256) changed();
    if (selection.to && observation.events.some(event => event.observedAt > selection.to)) changed();
    health.add(op.id);
  }
  for (const prepared of value.prepared)
    if (!record(prepared) || !UUID.test(prepared.id ?? '') || !revisions.has(prepared.revision)) changed();
  const { captureSha256, ...body } = value;
  if (!SHA.test(captureSha256 ?? '') || captureSha256 !== sha256(canonical(body))) changed();
  if (Buffer.byteLength(JSON.stringify(value)) + 1 > OPERATIONS_MAX_BYTES) fail('GRPC_OPERATIONS_CAPTURE_TOO_LARGE', 413);
  return value;
}
export function createOperationsCapture(body) {
  return validateOperationsCapture({ ...body, schema: OPERATIONS_CAPTURE_SCHEMA, captureSha256: sha256(canonical({ ...body, schema: OPERATIONS_CAPTURE_SCHEMA })) });
}
const elapsed = row => {
  if (!row.finishedAt) return null;
  const value = Date.parse(row.finishedAt) - Date.parse(row.startedAt);
  return Number.isFinite(value) && value >= 0 ? value : null;
};
const percentile = (values, p) => values.length ? values[Math.max(0, Math.ceil(values.length * p) - 1)] : null;
function totals(rows) {
  const counts = Object.fromEntries(PHASES.map(phase => [phase, 0]));
  for (const row of rows) counts[row.phase]++;
  const measured = rows.map(elapsed).filter(value => value !== null).sort((a, b) => a - b);
  return { attempts: rows.length, outcomes: counts, recordedElapsed: { samples: measured.length,
    missing: rows.length - measured.length, minMs: measured[0] ?? null, p50Ms: percentile(measured, .5),
    p95Ms: percentile(measured, .95), maxMs: measured.at(-1) ?? null } };
}
export function operationsTables(capture) {
  const revisions = new Map(capture.revisions.map(row => [row.id, row]));
  const calls = capture.calls.map(row => ({ id: row.id, revision: row.revision, method: row.method,
    service: row.method.slice(1, row.method.lastIndexOf('/')), phase: row.phase, startedAt: row.startedAt,
    finishedAt: row.finishedAt ?? null, recordedElapsedMs: elapsed(row), error: row.error ?? null,
    grpcCode: row.grpcCode ?? (row.responseFormat === 'ndjson' ? row.output?.grpcCode : null) ?? null, inputSha256: row.inputSha256,
    responseSha256: row.responseSha256 ?? null, plannedRequestMessages: row.requestSeries?.messages ?? 1,
    requestBytes: row.requestSeries?.requestBytes ?? null, responseFormat: row.responseFormat ?? 'json',
    responseMessages: row.responseFormat === 'ndjson' ? row.stream?.records ?? row.output?.records ?? null : row.outputRetained ? 1 : null,
    responseStreamBytes: row.responseFormat === 'ndjson' ? row.stream?.bytes ?? row.output?.bytes ?? null : null,
    target: revisions.get(row.revision).source.target }));
  const methods = [...new Set(calls.map(row => row.method))].sort().map(method => ({ method, ...totals(capture.calls.filter(row => row.method === method)) }));
  const cohorts = capture.revisions.map(row => ({ revision: row.id, title: row.title, createdAt: row.createdAt,
    target: row.source.target, protoSha256: row.protoSource.sha256, routes: row.plan.routes?.length ?? 0,
    ...totals(capture.calls.filter(call => call.revision === row.id)) }));
  const timeline = calls.flatMap(row => [{ observedAt: row.startedAt, kind: 'call-start', id: row.id, revision: row.revision,
    method: row.method, description: row.phase, sequence: null }, ...(row.finishedAt ? [{ observedAt: row.finishedAt,
    kind: 'call-finish', id: row.id, revision: row.revision, method: row.method, description: row.phase + (row.error ? ' · ' + row.error : ''), sequence: null }] : [])]);
  const health = [];
  for (const snapshot of capture.health) {
    const op = snapshot.operation;
    for (const event of snapshot.events) {
      if (capture.selection.from && event.observedAt < capture.selection.from || capture.selection.to && event.observedAt > capture.selection.to) continue;
      const data = event.data, statuses = event.kind === 'native' && data.type === 'status'
        ? Array.isArray(data.statuses) ? data.statuses : [{ service: data.service ?? op.request.service ?? '', status: data.status }] : [];
      const description = event.kind === 'native' ? data.type + (data.grpcCode !== undefined ? ' · ' + data.grpcCode : '')
        : data.phase ?? data.action ?? event.kind;
      timeline.push({ observedAt: event.observedAt, kind: 'health-' + event.kind, id: op.id, revision: op.revision,
        method: op.request.service ?? '', description, sequence: event.sequence });
      if (!statuses.length) health.push({ id: op.id, revision: op.revision, sequence: event.sequence, observedAt: event.observedAt,
        kind: event.kind, type: data.type ?? data.action ?? data.phase ?? event.kind, service: op.request.service ?? '',
        reportedStatus: null, grpcCode: data.grpcCode ?? null, eventSha256: event.sha256 });
      else for (const status of statuses) health.push({ id: op.id, revision: op.revision, sequence: event.sequence, observedAt: event.observedAt,
        kind: event.kind, type: 'status', service: status.service, reportedStatus: status.status?.name ?? status.status ?? null,
        grpcCode: null, eventSha256: event.sha256 });
    }
  }
  timeline.sort((a, b) => a.observedAt.localeCompare(b.observedAt) || a.id.localeCompare(b.id) || (a.sequence ?? 0) - (b.sequence ?? 0) || a.kind.localeCompare(b.kind));
  return { calls, health, timeline, methods, revisions: cohorts };
}
export function operationsSummary(capture) {
  return { id: capture.id, captureSha256: capture.captureSha256, originWorkspaceId: capture.originWorkspaceId,
    startedAt: capture.startedAt, capturedAt: capture.capturedAt, selection: capture.selection,
    selectedRevision: capture.selectedRevision, generation: capture.generation, ...totals(capture.calls),
    healthObservations: capture.health.length, sourceRevisions: capture.revisions.length, preparations: capture.prepared.length,
    meaning: 'These are original operator-workspace call outcomes and retained service-health event prefixes. Recorded elapsed time spans saved start and finish records, including acquisition and persistence. Health events do not establish continuous availability; revision cohorts are descriptive.' };
}
export function normalizeIncidentEdit(value, capture) {
  fields(value, ['title', 'severity', 'state', 'summary', 'impact', 'findings', 'review', 'links', 'actions'], 'GRPC_INCIDENT_EDIT_INVALID');
  const edit = { title: boundedText(value.title, 200, true), severity: value.severity ?? 'medium', state: value.state ?? 'open',
    summary: boundedText(value.summary ?? '', 4000), impact: boundedText(value.impact ?? '', 4000),
    findings: boundedText(value.findings ?? '', 12000) };
  if (!['low', 'medium', 'high', 'critical'].includes(edit.severity) || !['open', 'investigating', 'monitoring', 'resolved'].includes(edit.state))
    fail('GRPC_INCIDENT_STATE_INVALID');
  fields(value.review ?? {}, ['state', 'reviewer', 'note'], 'GRPC_INCIDENT_REVIEW_INVALID');
  edit.review = { state: value.review?.state ?? 'draft', reviewer: boundedText(value.review?.reviewer ?? '', 200),
    note: boundedText(value.review?.note ?? '', 4000) };
  if (!['draft', 'reviewed'].includes(edit.review.state) || edit.review.state === 'reviewed' && !edit.review.reviewer.trim())
    fail('GRPC_INCIDENT_REVIEWER_REQUIRED');
  if (!Array.isArray(value.links ?? []) || (value.links?.length ?? 0) > 1000 ||
    !Array.isArray(value.actions ?? []) || (value.actions?.length ?? 0) > 1000) fail('GRPC_INCIDENT_LIST_INVALID');
  const links = new Set();
  edit.links = (value.links ?? []).map(link => {
    fields(link, ['kind', 'id', 'sequence'], 'GRPC_INCIDENT_LINK_INVALID');
    let valid;
    if (link.kind === 'call') valid = link.sequence === undefined && capture.calls.some(row => row.id === link.id);
    else if (link.kind === 'revision') valid = link.sequence === undefined && capture.revisions.some(row => row.id === link.id);
    else if (link.kind === 'health') valid = capture.health.some(row => row.operation.id === link.id &&
      (link.sequence === undefined || Number.isInteger(link.sequence) && link.sequence >= 1 && link.sequence <= row.events.length));
    if (!valid || links.has(canonical(link))) fail('GRPC_INCIDENT_LINK_INVALID');
    links.add(canonical(link)); return structuredClone(link);
  });
  const ids = new Set();
  edit.actions = (value.actions ?? []).map(action => {
    fields(action, ['id', 'title', 'owner', 'state', 'dueAt', 'note'], 'GRPC_INCIDENT_ACTION_INVALID');
    operationId(action.id);
    if (ids.has(action.id) || !['planned', 'in-progress', 'completed', 'cancelled'].includes(action.state)) fail('GRPC_INCIDENT_ACTION_INVALID');
    ids.add(action.id);
    if (action.dueAt !== undefined && action.dueAt !== null && !isDate(action.dueAt)) fail('GRPC_INCIDENT_DATE_INVALID');
    return { id: action.id, title: boundedText(action.title, 400, true), owner: boundedText(action.owner ?? '', 200),
      state: action.state, dueAt: action.dueAt ?? null, note: boundedText(action.note ?? '', 4000) };
  });
  return edit;
}
export function validateIncidentHistory(history, capture) {
  if (!Array.isArray(history) || !history.length) changed();
  let parentSha256 = null, caseId = null;
  const operations = new Set();
  for (let i = 0; i < history.length; i++) {
    const row = history[i];
    if (!exact(row, ['schema', 'id', 'version', 'parentSha256', 'captureId', 'captureSha256', 'createdAt',
      'authorWorkspaceId', 'operationId', 'inputSha256', 'edit', 'sha256']) ||
      row.schema !== OPERATIONS_CASE_SCHEMA || !UUID.test(row.id ?? '') || caseId && row.id !== caseId ||
      !UUID.test(row.authorWorkspaceId ?? '') || !UUID.test(row.operationId ?? '') || operations.has(row.operationId) ||
      row.version !== i + 1 || row.parentSha256 !== parentSha256 || !isDate(row.createdAt) ||
      row.captureId !== capture.id || row.captureSha256 !== capture.captureSha256 ||
      canonical(normalizeIncidentEdit(row.edit, capture)) !== canonical(row.edit)) changed();
    const input = { operationId: row.operationId, id: row.id, captureId: row.captureId, expectedVersion: i, edit: row.edit };
    const { sha256: digest, ...body } = row;
    if (row.inputSha256 !== sha256(canonical(input)) || digest !== sha256(canonical(body))) changed();
    operations.add(row.operationId); caseId = row.id; parentSha256 = digest;
  }
  return history;
}
export function createIncidentRevision({ id, operationId: actionId, authorWorkspaceId, edit, capture, history = [], createdAt }) {
  operationId(id); operationId(actionId); operationId(authorWorkspaceId);
  if (history.length) validateIncidentHistory(history, capture);
  const normalized = normalizeIncidentEdit(edit, capture), version = history.length + 1;
  const input = { operationId: actionId, id, captureId: capture.id, expectedVersion: version - 1, edit: normalized };
  const body = { schema: OPERATIONS_CASE_SCHEMA, id, version, parentSha256: history.at(-1)?.sha256 ?? null,
    captureId: capture.id, captureSha256: capture.captureSha256, createdAt, authorWorkspaceId, operationId: actionId,
    inputSha256: sha256(canonical(input)), edit: normalized };
  return { ...body, sha256: sha256(canonical(body)) };
}
export function incidentSummary(row) {
  return { id: row.id, version: row.version, sha256: row.sha256, captureId: row.captureId, captureSha256: row.captureSha256,
    updatedAt: row.createdAt, title: row.edit.title, severity: row.edit.severity, state: row.edit.state,
    review: row.edit.review, actions: row.edit.actions.length,
    outstandingActions: row.edit.actions.filter(action => !['completed', 'cancelled'].includes(action.state)).length };
}
export function createOperationsExport(capture, history) {
  validateOperationsCapture(capture); validateIncidentHistory(history, capture);
  const body = { schema: OPERATIONS_EXPORT_SCHEMA, capture, history };
  const value = { ...body, exportSha256: sha256(canonical(body)) };
  if (Buffer.byteLength(JSON.stringify(value)) + 1 > OPERATIONS_MAX_BYTES) fail('GRPC_OPERATIONS_EXPORT_TOO_LARGE', 413);
  return value;
}
export function validateOperationsExport(value) {
  if (!exact(value, ['schema', 'capture', 'history', 'exportSha256']) || value.schema !== OPERATIONS_EXPORT_SCHEMA) changed();
  validateOperationsCapture(value.capture); validateIncidentHistory(value.history, value.capture);
  const { exportSha256, ...body } = value;
  if (exportSha256 !== sha256(canonical(body))) changed();
  if (Buffer.byteLength(JSON.stringify(value)) + 1 > OPERATIONS_MAX_BYTES) fail('GRPC_OPERATIONS_EXPORT_TOO_LARGE', 413);
  return value;
}
