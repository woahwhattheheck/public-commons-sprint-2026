// MIT. Portable, hash-bound observations from the original gRPC health workspace.
import { canonical, sha256, fail } from './common.mjs';

export const GRPC_HEALTH_OPERATION_SCHEMA = 'stellar-forge.grpc-health-operation.v1';
export const GRPC_HEALTH_EVENT_SCHEMA = 'stellar-forge.grpc-health-event.v1';
export const GRPC_HEALTH_SNAPSHOT_SCHEMA = 'stellar-forge.grpc-health-snapshot.v1';
export const GRPC_HEALTH_MAX_BYTES = 40 * 1024 * 1024;
export const GRPC_HEALTH_JOURNAL_MAX_BYTES = 36 * 1024 * 1024;
export const GRPC_HEALTH_ZERO_SHA256 = '0'.repeat(64);
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const phases = ['PREPARED', 'RUNNING', 'COMPLETED', 'CANCELLED', 'INTERRUPTED', 'FAILED', 'UNSUPPORTED', 'EXPIRED'];
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const changed = () => fail('GRPC_HEALTH_RECORD_CHANGED', 409);
const closed = (value, keys) => plain(value) && Object.keys(value).every(key => keys.includes(key));

export function grpcHealthId(id) {
  if (typeof id !== 'string' || !UUID.test(id)) fail('GRPC_HEALTH_OPERATION_ID_REQUIRED');
  return id;
}
export function validateGrpcHealthOperation(value) {
  if (!closed(value, ['schema', 'id', 'revision', 'source', 'sourceSha256', 'protocolSha256',
    'request', 'createdAt', 'deadlineAt', 'operationSha256']) ||
      value.schema !== GRPC_HEALTH_OPERATION_SCHEMA || !UUID.test(value.id ?? '') ||
      !SHA.test(value.revision ?? '') || !SHA.test(value.protocolSha256 ?? '') ||
      !plain(value.source) || !plain(value.request) || !date(value.createdAt) || !date(value.deadlineAt) ||
      Date.parse(value.deadlineAt) < Date.parse(value.createdAt) ||
      value.sourceSha256 !== sha256(canonical(value.source))) changed();
  const { operationSha256, ...body } = value;
  if (!SHA.test(operationSha256 ?? '') || operationSha256 !== sha256(canonical(body))) changed();
  return value;
}
export function validateGrpcHealthEvent(event, operation, sequence, previousSha256) {
  if (!closed(event, ['schema', 'operationId', 'sequence', 'observedAt', 'kind', 'data', 'previousSha256', 'sha256']) ||
      event.schema !== GRPC_HEALTH_EVENT_SCHEMA || event.operationId !== operation.id ||
      event.sequence !== sequence || event.previousSha256 !== previousSha256 || !date(event.observedAt) ||
      !['native', 'lifecycle', 'result', 'control'].includes(event.kind) || !plain(event.data)) changed();
  if (event.kind === 'control' && !['stop', 'workspace_close'].includes(event.data.action)) changed();
  if (event.kind === 'native' && !['opening', 'status', 'terminal', 'retry'].includes(event.data.type)) changed();
  if (event.kind === 'lifecycle' && (!phases.includes(event.data.phase) || typeof event.data.reason !== 'string')) changed();
  if (event.kind === 'result' && (!phases.includes(event.data.phase) ||
      typeof event.data.reason !== 'string' || !plain(event.data.result))) changed();
  const { sha256: digest, ...body } = event;
  if (!SHA.test(digest ?? '') || digest !== sha256(canonical(body))) changed();
  return event;
}
export function grpcHealthSummary(operation, events) {
  let phase = 'PREPARED', reason = 'prepared', endedAt = null, nativeEvents = 0, updates = 0;
  let connections = 0, retries = 0, lastStatus = null, lastNative = null, terminal = null, result = null, epochs = 0;
  for (const event of events) {
    if (event.kind === 'lifecycle' || event.kind === 'result') {
      phase = event.data.phase; reason = event.data.reason;
      endedAt = phase === 'RUNNING' || phase === 'PREPARED' ? null : event.observedAt;
      if (phase === 'RUNNING') epochs++;
      if (event.kind === 'result') result = event.data.result;
    } else if (event.kind === 'native') {
      nativeEvents++; lastNative = event.data;
      if (event.data.type === 'opening') connections++;
      if (event.data.type === 'retry') retries++;
      if (event.data.type === 'terminal') terminal = event.data;
      if (event.data.type === 'status') { updates++; lastStatus = event.data; }
    }
  }
  const status = lastStatus?.status ?? lastStatus?.response?.status ?? lastStatus?.value?.status ?? null;
  const statuses = lastStatus?.statuses ?? lastStatus?.response?.statuses ?? lastStatus?.value?.statuses;
  return { id: operation.id, revision: operation.revision, operationSha256: operation.operationSha256,
    sourceSha256: operation.sourceSha256, target: operation.source.target, kind: operation.request.kind,
    ...(operation.request.kind === 'list' ? {} : { service: operation.request.service }),
    createdAt: operation.createdAt, deadlineAt: operation.deadlineAt, phase, reason, endedAt,
    version: events.length, snapshot: events.at(-1)?.sha256 ?? GRPC_HEALTH_ZERO_SHA256,
    nativeEvents, updates, connections, retries, epochs,
    reportedStatus: typeof status === 'string' ? status : typeof status?.name === 'string' ? status.name : null,
    services: Array.isArray(statuses) ? statuses.length : plain(statuses) ? Object.keys(statuses).length : 0,
    lastObservedAt: [...events].reverse().find(event => event.kind === 'native' && event.data.type === 'status')?.observedAt ?? null,
    terminal: terminal ? { grpcCode: terminal.grpcCode ?? null, reason: terminal.reason ?? terminal.error ?? null } : null,
    outcome: result ? { reason: result.reason ?? reason, eventCount: result.eventCount ?? null } : null };
}
export function createGrpcHealthSnapshot(operation, events) {
  const body = { schema: GRPC_HEALTH_SNAPSHOT_SCHEMA, operation: structuredClone(operation),
    summary: grpcHealthSummary(operation, events), events: structuredClone(events) };
  const value = { ...body, snapshotSha256: sha256(canonical(body)) };
  if (Buffer.byteLength(JSON.stringify(value)) + 1 > GRPC_HEALTH_MAX_BYTES) fail('GRPC_HEALTH_EXPORT_TOO_LARGE', 413);
  return value;
}
export function validateGrpcHealthSnapshot(value, expectedSha256) {
  if (!closed(value, ['schema', 'operation', 'summary', 'events', 'snapshotSha256']) ||
      value.schema !== GRPC_HEALTH_SNAPSHOT_SCHEMA || !Array.isArray(value.events) ||
      value.events.length > 10130 || !plain(value.summary)) changed();
  const operation = validateGrpcHealthOperation(value.operation);
  let previous = GRPC_HEALTH_ZERO_SHA256;
  for (let index = 0; index < value.events.length; index++) {
    const event = validateGrpcHealthEvent(value.events[index], operation, index + 1, previous);
    previous = event.sha256;
  }
  if (canonical(value.summary) !== canonical(grpcHealthSummary(operation, value.events))) changed();
  const { snapshotSha256, ...body } = value;
  if (!SHA.test(snapshotSha256 ?? '') || snapshotSha256 !== sha256(canonical(body)) ||
      expectedSha256 !== undefined && snapshotSha256 !== expectedSha256) changed();
  return value;
}
export function parseGrpcHealthSnapshot(bytes, expectedSha256) {
  if (!(bytes instanceof Uint8Array) || bytes.length > GRPC_HEALTH_MAX_BYTES) fail('GRPC_HEALTH_EXPORT_TOO_LARGE', 413);
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { changed(); }
  return validateGrpcHealthSnapshot(value, expectedSha256);
}
