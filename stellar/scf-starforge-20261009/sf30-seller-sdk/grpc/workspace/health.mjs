// MIT. Durable health operations owned by the original gRPC workspace lease.
import { constants } from 'node:fs';
import { open, readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { normalizeGrpcHealthRequest, observeGrpcHealth, GRPC_HEALTH_PROTOCOL_SHA256 } from '../health.mjs';
import { validateGrpcConfig } from '../config.mjs';
import { canonical, sha256, fail, fields, readJson, readBytes, writeJsonSnapshot, privateDirectory, syncDirectory } from '../common.mjs';
import { GRPC_HEALTH_OPERATION_SCHEMA, GRPC_HEALTH_EVENT_SCHEMA, GRPC_HEALTH_JOURNAL_MAX_BYTES,
  GRPC_HEALTH_ZERO_SHA256, grpcHealthId, validateGrpcHealthOperation, validateGrpcHealthEvent,
  grpcHealthSummary, createGrpcHealthSnapshot } from '../health-record.mjs';

const stamp = () => new Date().toISOString();
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const number = (value, fallback, low, high) => {
  value ??= fallback;
  if (!Number.isSafeInteger(value) || value < low || value > high) fail('GRPC_HEALTH_PAGE_INVALID');
  return value;
};
const safeError = issue => /^[A-Z][A-Z0-9_]{0,119}$/.test(issue?.code ?? '') ? issue.code : 'GRPC_HEALTH_OBSERVATION_FAILED';

export function createGrpcHealthWorkspace({ directory, loadRevision, selection, assertHeld, env }) {
  const index = new Map(), cache = new Map(), loads = new Map(), jobs = new Map();
  let closing = false, closed;
  function held() { assertHeld(); if (closing) fail('GRPC_HEALTH_WORKSPACE_CLOSING', 503); }
  function remember(entry) {
    index.set(entry.operation.id, grpcHealthSummary(entry.operation, entry.events));
    cache.delete(entry.operation.id); cache.set(entry.operation.id, entry);
    for (const [id] of cache) {
      if (cache.size <= 4) break;
      if (!jobs.has(id) && id !== entry.operation.id) cache.delete(id);
    }
  }
  async function load(id) {
    grpcHealthId(id);
    if (cache.has(id)) return cache.get(id);
    if (loads.has(id)) return loads.get(id);
    const pending = (async () => {
      const root = await privateDirectory(join(directory, id));
      const operation = validateGrpcHealthOperation(await readJson(join(root, 'operation.json'), 131072));
      if (operation.id !== id || canonical(normalizeGrpcHealthRequest(operation.request)) !== canonical(operation.request) ||
          canonical(validateGrpcConfig(operation.source)) !== canonical(operation.source)) fail('GRPC_HEALTH_RECORD_CHANGED', 409);
      const saved = await loadRevision(operation.revision);
      if (sha256(canonical(saved.source)) !== operation.sourceSha256) fail('GRPC_HEALTH_REVISION_CHANGED', 409);
      const path = join(root, 'events.ndjson');
      let bytes;
      try { bytes = await readBytes(path, GRPC_HEALTH_JOURNAL_MAX_BYTES); }
      catch (issue) { if (issue.code !== 'ENOENT') throw issue; bytes = Buffer.alloc(0); }
      const completeBytes = bytes.length ? bytes.lastIndexOf(10) + 1 : 0, events = [];
      let previous = GRPC_HEALTH_ZERO_SHA256;
      if (completeBytes) {
        let rows;
        try { rows = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, completeBytes)).trimEnd().split('\n'); }
        catch { fail('GRPC_HEALTH_RECORD_CHANGED', 409); }
        if (rows.length > 10130) fail('GRPC_HEALTH_RECORD_CHANGED', 409);
        for (const row of rows) {
          let event;
          try { event = JSON.parse(row); } catch { fail('GRPC_HEALTH_RECORD_CHANGED', 409); }
          validateGrpcHealthEvent(event, operation, events.length + 1, previous);
          previous = event.sha256; events.push(event);
        }
      }
      // Only an uncommitted final append is truncated. Every complete line has
      // already passed its original sequence and chained content hash.
      if (completeBytes !== bytes.length) {
        assertHeld();
        const handle = await open(path, constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0));
        try { await handle.truncate(completeBytes); await handle.sync(); } finally { await handle.close(); }
      }
      const entry = { root, path, operation, events, bytes: completeBytes, chain: Promise.resolve(), fault: null };
      remember(entry); return entry;
    })();
    loads.set(id, pending);
    try { return await pending; } finally { loads.delete(id); }
  }
  function append(entry, kind, data) {
    const write = entry.chain.then(async () => {
      assertHeld();
      if (entry.fault) throw entry.fault;
      const body = { schema: GRPC_HEALTH_EVENT_SCHEMA, operationId: entry.operation.id,
        sequence: entry.events.length + 1, observedAt: stamp(), kind, data: structuredClone(data),
        previousSha256: entry.events.at(-1)?.sha256 ?? GRPC_HEALTH_ZERO_SHA256 };
      const event = { ...body, sha256: sha256(canonical(body)) };
      validateGrpcHealthEvent(event, entry.operation, body.sequence, body.previousSha256);
      const bytes = Buffer.from(JSON.stringify(event) + '\n');
      if (entry.events.length >= 10130 || entry.bytes + bytes.length > GRPC_HEALTH_JOURNAL_MAX_BYTES)
        fail('GRPC_HEALTH_HISTORY_LIMIT_REACHED', 413);
      const handle = await open(entry.path, constants.O_CREAT | constants.O_APPEND | constants.O_WRONLY |
        (constants.O_NOFOLLOW ?? 0), 0o600);
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size !== entry.bytes || process.platform !== 'win32' && stat.mode & 0o077)
          fail('GRPC_HEALTH_RECORD_CHANGED', 409);
        await handle.writeFile(bytes); await handle.sync();
        if (!entry.bytes) await syncDirectory(entry.root);
      } finally { await handle.close(); }
      entry.bytes += bytes.length; entry.events.push(event); remember(entry);
      return event;
    });
    entry.chain = write.catch(issue => { entry.fault = issue; });
    return write;
  }
  async function settled(entry) {
    await entry.chain;
    if (entry.fault) throw entry.fault;
    return grpcHealthSummary(entry.operation, entry.events);
  }
  async function finish(entry, result, cancellation) {
    let phase = result.reason === 'NATIVE_ERROR' ? 'FAILED' : result.reason === 'UNIMPLEMENTED' ? 'UNSUPPORTED' :
      result.reason === 'CANCELLED' ? cancellation === 'workspace_closed' ? 'INTERRUPTED' : 'CANCELLED' : 'COMPLETED';
    const reason = result.reason === 'CANCELLED' && cancellation ? cancellation : result.reason;
    await append(entry, 'result', { phase, reason, result });
  }
  async function launch(entry, reason) {
    held();
    const summary = await settled(entry), request = entry.operation.request;
    if (entry.operation.protocolSha256 !== GRPC_HEALTH_PROTOCOL_SHA256) fail('GRPC_HEALTH_PROTOCOL_REVISION_CHANGED', 409);
    if (jobs.has(entry.operation.id)) return;
    if (jobs.size >= 4) fail('GRPC_HEALTH_CAPACITY_REACHED', 409);
    const remaining = Date.parse(entry.operation.deadlineAt) - Date.now();
    if (remaining <= 0) { await append(entry, 'lifecycle', { phase: 'EXPIRED', reason: 'original_deadline_elapsed' }); return; }
    const remainingEvents = request.kind === 'watch' ? request.maxEvents - summary.nativeEvents : null;
    if (remainingEvents !== null && remainingEvents <= 0) {
      await append(entry, 'lifecycle', { phase: 'COMPLETED', reason: 'original_event_limit_reached' }); return;
    }
    if (summary.epochs >= 32) fail('GRPC_HEALTH_RESUME_LIMIT_REACHED', 409);
    await append(entry, 'lifecycle', { phase: 'RUNNING', reason,
      remainingDurationMs: remaining, remainingEvents });
    if (closing) { await append(entry, 'lifecycle', { phase: 'INTERRUPTED', reason: 'workspace_closed' }); return; }
    const controller = new AbortController(), job = { controller, promise: null, entry, stopping: null };
    jobs.set(entry.operation.id, job);
    job.promise = Promise.resolve().then(async () => {
      const available = Date.parse(entry.operation.deadlineAt) - Date.now();
      if (available <= 0) { await append(entry, 'lifecycle', { phase: 'EXPIRED', reason: 'original_deadline_elapsed' }); return; }
      const nativeRequest = request.kind === 'watch' ? { ...request,
        durationMs: Math.max(1, Math.min(request.durationMs, available)), maxEvents: remainingEvents }
        : { ...request, timeoutMs: Math.max(1, Math.min(request.timeoutMs, available)) };
      try {
        const result = await observeGrpcHealth(entry.operation.source, nativeRequest, {
          env, signal: controller.signal, onEvent: event => append(entry, 'native', event),
        });
        await finish(entry, result, controller.signal.reason);
      } catch (issue) {
        // Native failures have an ordinary retained result. An exception here
        // is a storage/callback/runtime failure, never a reconnect instruction.
        if (!entry.fault) await append(entry, 'lifecycle', { phase: 'FAILED', reason: safeError(issue) });
        else throw issue;
      }
    }).finally(() => { jobs.delete(entry.operation.id); remember(entry); });
    job.promise.catch(() => {});
  }
  function visible(summary) {
    const current = selection();
    return { ...summary, selectedRevision: current.revision,
      appliesToSelectedRevision: summary.revision === current.revision,
      runningHere: jobs.has(summary.id) };
  }
  async function initialize() {
    await privateDirectory(directory, true);
    for (const id of (await readdir(directory)).filter(name => UUID.test(name)).sort()) {
      const entry = await load(id), summary = await settled(entry);
      if (!['RUNNING', 'PREPARED'].includes(summary.phase)) continue;
      const epoch = [...entry.events].reverse().find(event => event.kind === 'lifecycle' && event.data.phase === 'RUNNING')?.sequence ?? 0;
      const terminalEvent = [...entry.events].reverse().find(event => event.sequence > epoch && event.kind === 'native' && event.data.type === 'terminal');
      const statusEvent = [...entry.events].reverse().find(event => event.kind === 'native' && event.data.type === 'status');
      const control = [...entry.events].reverse().find(event => event.sequence > epoch && event.kind === 'control');
      const terminal = terminalEvent?.data, latest = statusEvent?.data;
      // The unary source emits status only after its original call returned.
      // Both a returned value and a retained failure therefore have a first
      // outcome even if the workspace died before appending its result record.
      if (entry.operation.request.kind !== 'watch' && (latest || terminal)) {
        const cancelled = !latest && terminal?.grpcStatus === 'CANCELLED' && control &&
          control.sequence < terminalEvent.sequence;
        const cancellation = cancelled ? control.data.action === 'workspace_close' ? 'workspace_closed' : 'operator_cancelled' : undefined;
        const reason = latest ? 'COMPLETED' : cancelled ? 'CANCELLED' :
          terminal.grpcStatus === 'UNIMPLEMENTED' ? 'UNIMPLEMENTED' : 'NATIVE_ERROR';
        await finish(entry, { schema: 'stellar-forge.grpc-health-observation.v1',
          protocolSha256: entry.operation.protocolSha256, reason, ...(latest ? { latest } : {}),
          updates: summary.updates, connections: summary.connections, ...(terminal ? { terminal } : {}),
          eventCount: summary.nativeEvents, recoveredFromOriginalJournal: true }, cancellation);
      } else if (control) {
        const cancellation = control.data.action === 'workspace_close' ? 'workspace_closed' : 'operator_cancelled';
        await finish(entry, { schema: 'stellar-forge.grpc-health-observation.v1',
          protocolSha256: entry.operation.protocolSha256, reason: 'CANCELLED', ...(latest ? { latest } : {}),
          updates: summary.updates, connections: summary.connections, ...(terminal ? { terminal } : {}),
          eventCount: summary.nativeEvents, recoveredFromOriginalJournal: true }, cancellation);
      } else await append(entry, 'lifecycle', { phase: 'INTERRUPTED', reason: 'previous_workspace_owner_ended' });
    }
  }
  async function start(body) {
    held(); fields(body, ['id', 'revision', 'request'], 'GRPC_HEALTH_START_FIELDS_INVALID');
    const id = grpcHealthId(body.id), request = normalizeGrpcHealthRequest(body.request);
    if (typeof body.revision !== 'string' || !SHA.test(body.revision)) fail('GRPC_HEALTH_REVISION_REQUIRED');
    let existing;
    try { existing = await load(id); } catch (issue) { if (issue.code !== 'ENOENT') throw issue; }
    if (existing) {
      if (existing.operation.revision !== body.revision ||
          canonical(existing.operation.request) !== canonical(request)) fail('GRPC_HEALTH_OPERATION_CONFLICT', 409);
      return read({ id });
    }
    if (body.revision !== selection().revision) fail('GRPC_SELECT_SAVED_REVISION_FIRST', 409);
    if (jobs.size >= 4) fail('GRPC_HEALTH_CAPACITY_REACHED', 409);
    const revision = await loadRevision(body.revision), source = validateGrpcConfig(revision.source);
    const createdAt = stamp(), bodyRecord = { schema: GRPC_HEALTH_OPERATION_SCHEMA, id, revision: body.revision,
      source, sourceSha256: sha256(canonical(source)), protocolSha256: GRPC_HEALTH_PROTOCOL_SHA256, request,
      createdAt, deadlineAt: new Date(Date.parse(createdAt) + (request.kind === 'watch' ? request.durationMs : request.timeoutMs)).toISOString() };
    const operation = { ...bodyRecord, operationSha256: sha256(canonical(bodyRecord)) };
    const root = await privateDirectory(join(directory, id), true);
    await writeJsonSnapshot(join(root, 'operation.json'), operation, 131072);
    const entry = { root, path: join(root, 'events.ndjson'), operation, events: [], bytes: 0, chain: Promise.resolve(), fault: null };
    remember(entry);
    await launch(entry, 'operator_started'); return read({ id });
  }
  async function resume(body) {
    held(); fields(body, ['id', 'expectedVersion'], 'GRPC_HEALTH_RESUME_FIELDS_INVALID');
    const entry = await load(body.id), summary = await settled(entry);
    if (jobs.has(body.id)) return read({ id: body.id });
    if (summary.version !== body.expectedVersion) fail('GRPC_HEALTH_VERSION_CHANGED', 409);
    if (entry.operation.request.kind !== 'watch' || !['INTERRUPTED', 'CANCELLED'].includes(summary.phase))
      fail('GRPC_HEALTH_WATCH_RESUME_REQUIRED', 409);
    if (entry.operation.revision !== selection().revision) fail('GRPC_SELECT_SAVED_REVISION_FIRST', 409);
    await launch(entry, 'operator_resumed'); return read({ id: body.id });
  }
  async function cancel(body) {
    held(); fields(body, ['id'], 'GRPC_HEALTH_CANCEL_FIELDS_INVALID');
    const id = grpcHealthId(body.id);
    let job = jobs.get(id);
    if (!job) {
      const entry = await load(id), summary = await settled(entry);
      // Publication and the RUNNING append precede native registration. Never
      // acknowledge a stop while that same original launch can still open.
      job = jobs.get(id);
      if (!job && ['PREPARED', 'RUNNING'].includes(summary.phase))
        fail('GRPC_HEALTH_START_IN_PROGRESS', 409);
    }
    if (job) await stopJob(job, 'operator_cancelled');
    return read({ id });
  }
  async function stopJob(job, reason) {
    if (!job.stopping) job.stopping = (async () => {
      try { await append(job.entry, 'control', { action: reason === 'workspace_closed' ? 'workspace_close' : 'stop' }); }
      finally { job.controller.abort(reason); }
    })();
    try { await job.stopping; } finally { await job.promise; }
  }
  async function read(body) {
    assertHeld(); fields(body, ['id', 'afterSequence', 'throughSequence', 'expectedSnapshot', 'limit', 'section', 'serviceFilter'], 'GRPC_HEALTH_READ_FIELDS_INVALID');
    const entry = await load(body.id), summary = await settled(entry);
    const through = number(body.throughSequence, entry.events.length, 0, entry.events.length);
    const section = body.section ?? 'events';
    const after = number(body.afterSequence, 0, 0, section === 'services' ? Number.MAX_SAFE_INTEGER : through), limit = number(body.limit, 50, 1, 250);
    const eventSnapshot = through ? entry.events[through - 1].sha256 : GRPC_HEALTH_ZERO_SHA256;
    const serviceFilter = body.serviceFilter ?? '';
    if (typeof serviceFilter !== 'string' || serviceFilter.length > 512 || /[\x00-\x1f\x7f]/.test(serviceFilter)) fail('GRPC_HEALTH_SERVICE_FILTER_INVALID');
    if (body.serviceFilter !== undefined && section !== 'services') fail('GRPC_HEALTH_SERVICE_FILTER_INVALID');
    const snapshot = section === 'services' ? sha256(canonical({ eventSnapshot, serviceFilter })) : eventSnapshot;
    if (body.expectedSnapshot !== undefined && body.expectedSnapshot !== snapshot) fail('GRPC_HEALTH_SNAPSHOT_CHANGED', 409);
    if (after && body.throughSequence !== undefined && !body.expectedSnapshot) fail('GRPC_HEALTH_SNAPSHOT_REQUIRED');
    if (!['events', 'summary', 'services'].includes(section)) fail('GRPC_HEALTH_SECTION_INVALID');
    const result = { schema: 'stellar-forge.grpc-health-read.v1', operation: visible(summary), request: entry.operation.request,
      source: entry.operation.source, protocolSha256: entry.operation.protocolSha256 };
    if (section === 'summary') return result;
    if (section === 'services') {
      const event = [...entry.events.slice(0, through)].reverse().find(item => item.kind === 'native' && item.data.type === 'status');
      const all = Array.isArray(event?.data.statuses) ? event.data.statuses : [];
      const statuses = all.filter(row => row.service.toLowerCase().includes(serviceFilter.toLowerCase()));
      const start = number(body.afterSequence, 0, 0, statuses.length);
      return { ...result, services: structuredClone(statuses.slice(start, start + limit)), atomic: false, serviceFilter, sourceServices: all.length,
        page: { afterSequence: start, throughSequence: through, snapshot, total: statuses.length,
          nextAfterSequence: start + limit < statuses.length ? start + limit : null } };
    }
    return { ...result, events: structuredClone(entry.events.slice(after, Math.min(through, after + limit))),
      page: { afterSequence: after, throughSequence: through, snapshot, total: through,
        nextAfterSequence: after + limit < through ? after + limit : null } };
  }
  async function list(body = {}) {
    assertHeld(); fields(body, ['revision', 'offset', 'limit', 'expectedSnapshot'], 'GRPC_HEALTH_LIST_FIELDS_INVALID');
    if (body.revision !== undefined && !SHA.test(body.revision)) fail('GRPC_HEALTH_REVISION_REQUIRED');
    const rows = [...index.values()].filter(row => body.revision === undefined || row.revision === body.revision)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
    const snapshot = sha256(canonical(rows)), offset = number(body.offset, 0, 0, rows.length), limit = number(body.limit, 50, 1, 250);
    if (offset && !body.expectedSnapshot) fail('GRPC_HEALTH_SNAPSHOT_REQUIRED');
    if (body.expectedSnapshot !== undefined && body.expectedSnapshot !== snapshot) fail('GRPC_HEALTH_SNAPSHOT_CHANGED', 409);
    return { schema: 'stellar-forge.grpc-health-list.v1', total: rows.length, snapshot, offset,
      items: rows.slice(offset, offset + limit).map(visible), nextOffset: offset + limit < rows.length ? offset + limit : null };
  }
  async function exportSnapshot(body) {
    assertHeld(); fields(body, ['id', 'expectedVersion', 'throughSequence', 'expectedSnapshot'], 'GRPC_HEALTH_EXPORT_FIELDS_INVALID');
    const entry = await load(body.id), summary = await settled(entry);
    if (body.expectedVersion !== undefined && body.expectedVersion !== summary.version) fail('GRPC_HEALTH_VERSION_CHANGED', 409);
    const through = number(body.throughSequence, entry.events.length, 0, entry.events.length);
    const snapshot = through ? entry.events[through - 1].sha256 : GRPC_HEALTH_ZERO_SHA256;
    if (body.throughSequence !== undefined && body.expectedSnapshot === undefined) fail('GRPC_HEALTH_SNAPSHOT_REQUIRED');
    if (body.expectedSnapshot !== undefined && body.expectedSnapshot !== snapshot) fail('GRPC_HEALTH_SNAPSHOT_CHANGED', 409);
    return createGrpcHealthSnapshot(entry.operation, entry.events.slice(0, through));
  }

  async function captureSnapshots(accept, throughAt, maximumBytes) {
    assertHeld();
    // The original workspace serializes starts/resumes while this captures the
    // fixed operation inventory. Existing Watches retain their own append owner.
    const ids = [...index.values()].filter(accept).map(row => row.id).sort();
    const result = []; let bytes = 0;
    for (const id of ids) {
      const entry = await load(id); await settled(entry);
      const firstLater = throughAt ? entry.events.findIndex(event => event.observedAt > throughAt) : -1;
      const events = entry.events.slice(0, firstLater < 0 ? entry.events.length : firstLater);
      const snapshot = createGrpcHealthSnapshot(entry.operation, events);
      bytes += Buffer.byteLength(JSON.stringify(snapshot));
      if (bytes > maximumBytes) fail('GRPC_OPERATIONS_CAPTURE_TOO_LARGE', 413);
      result.push(snapshot);
    }
    return result;
  }

  function latest(revision) {
    return [...index.values()].filter(row => row.revision === revision)
      .sort((a, b) => (b.lastObservedAt ?? b.createdAt).localeCompare(a.lastObservedAt ?? a.createdAt)).slice(0, 10).map(visible);
  }
  function close() {
    if (closed) return closed;
    closing = true;
    const owned = [...jobs.values()];
    closed = (async () => {
      const outcomes = await Promise.allSettled(owned.map(job => stopJob(job, 'workspace_closed')));
      const errors = [...new Set([...outcomes.filter(row => row.status === 'rejected').map(row => row.reason),
        ...[...cache.values()].map(entry => entry.fault).filter(Boolean)])];
      if (errors.length) throw Object.assign(new AggregateError(errors, 'GRPC_HEALTH_CLOSE_FAILED'), { code: 'GRPC_HEALTH_CLOSE_FAILED' });
    })();
    return closed;
  }
  return { initialize, start, resume, cancel, read, list, exportSnapshot, captureSnapshots, latest, close,
    runtime: () => [...jobs.keys()], count: () => index.size };
}
