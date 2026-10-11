// MIT. Customer workflow over the ORIGINAL SF88 acquisition and SF100 delivery.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { inspectDatasetSession, runDatasetSession, recoverDatasetSession,
  deliverDatasetSession, accountDatasetSession, exportDatasetManifest } from '../dataset-session.mjs';
import { canonical as nativeCanonical } from '../dataset-page.mjs';
import { absolute, privateDirectory, readPrivate, readJson, atomicJson, acquireWorkspace,
  digest, identity, object, fault } from '../../sf30-seller-sdk/postgres/publisher/files.mjs';
import { openDatasetReceiving, SCHEMA, HASH, ID, check, safeCode, optionalJson } from './receiving.mjs';
import { analysisLauncher } from './analysis.mjs';

const now = () => new Date().toISOString();
const ACTION = /^[A-Za-z0-9][A-Za-z0-9_-]{7,99}$/;
const FILES = new Set(['dataset.jsonl', 'dataset.csv', 'review.html', 'manifest.json']);
const savedRecord = (records, id) => Object.hasOwn(records, id) ? records[id] : null;
const revision = report => identity({ sessionId: report.sessionId, configurationSha256: report.configurationSha256,
  status: report.status, completedPages: report.completedPages, snapshot: report.snapshot,
  capAllocatedAtomic: report.capAllocatedAtomic, pages: report.pages, nextPage: report.nextPage });
const summary = (entry, report) => ({ id: entry.id, label: entry.label, sessionId: entry.sessionId,
  kind: entry.kind, createdAt: entry.createdAt, status: report?.status ?? 'NEEDS_INSPECTION',
  completedPages: report?.completedPages ?? null, acquiredRows: report?.acquiredRows ?? null,
  snapshot: report?.snapshot ?? null, delivery: entry.delivery ? {
    paymentStatus: entry.delivery.paymentStatus, rows: entry.delivery.nativeStatus?.rows,
    files: Object.fromEntries(Object.entries(entry.delivery.outputs).map(([key, value]) => [key, { bytes: value.bytes, sha256: value.sha256 }])) } : null });

export async function openDatasetWorkspace({ stateDirectory, profilePath = null, operatorSettings = null, analysis = null } = {}) {
  const root = absolute(stateDirectory);
  await privateDirectory(root, true);
  const release = await acquireWorkspace(root);
  const launcher = analysisLauncher(analysis);
  let state, receiving, active = null, mutating = false, mutation = null, closed = false, closing = null, persistenceError = null;
  const reports = new Map();
  const verifiedFiles = new Map(), rowOffsets = new Map();
  const fileStamp = info => ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].map(key => String(info[key])).join(':');
  async function save() { state.revision++; state.updatedAt = now(); await atomicJson(root, 'workspace.json', state); }
  async function exclusive(action) {
    check(!closed && !mutating && !active, 'DATASET_WORKSPACE_BUSY', 'Finish or stop the current customer operation first.', 409);
    mutating = true;
    const current = Promise.resolve().then(action); mutation = current;
    try { return await current; } finally { if (mutation === current) mutation = null; mutating = false; }
  }
  function entry(id) {
    check(ID.test(id ?? ''), 'DATASET_SESSION_SELECTION_INVALID');
    return savedRecord(state.sessions, id) ?? (() => { throw fault('DATASET_SESSION_NOT_FOUND', 'Choose an existing acquired or prepared dataset.', 404); })();
  }
  async function definition(record) {
    const raw = await readPrivate(join(record.session, 'session.json'));
    const value = JSON.parse(raw);
    check(value.schema === 'stellar-forge.sf88.dataset-session.v1' && value.directory === record.session &&
      typeof record.sessionId === 'string' && record.sessionId.length > 0 && value.config.operation.intentId === record.sessionId && value.configurationSha256 === record.configurationSha256 &&
      digest(nativeCanonical(value.config)) === record.configurationSha256 && digest(raw) === record.definitionSha256,
    'DATASET_SESSION_CHANGED', 'The registered original acquisition identity changed.', 409);
    return value;
  }
  async function attach({ id, label, session, room, kind = 'attached', reviewId = null }) {
    check(ID.test(id ?? '') && typeof label === 'string' && label.length > 0 && label.length <= 160 && !/[\x00-\x1f\x7f]/.test(label), 'DATASET_PROFILE_INVALID');
    absolute(session); absolute(room);
    const raw = await readPrivate(join(session, 'session.json')), native = JSON.parse(raw);
    check(native.schema === 'stellar-forge.sf88.dataset-session.v1' && native.directory === session &&
      typeof native.config?.operation?.intentId === 'string' && native.config.operation.intentId.length > 0 &&
      HASH.test(native.configurationSha256 ?? '') && digest(nativeCanonical(native.config)) === native.configurationSha256,
    'DATASET_NATIVE_SESSION_REQUIRED');
    const record = { id, label, session, room, kind, reviewId, sessionId: native.config.operation.intentId,
      configurationSha256: native.configurationSha256, definitionSha256: digest(raw),
      workspace: native.workspaceDirectory ?? null, createdAt: native.createdAt };
    const prior = savedRecord(state.sessions, id);
    if (prior) check(['session', 'room', 'sessionId', 'configurationSha256', 'definitionSha256', 'reviewId']
      .every(key => prior[key] === record[key]), 'DATASET_PROFILE_SOURCE_CHANGED', 'A source name already belongs to another original acquisition.', 409);
    else { state.sessions[id] = record; await save(); }
    return summary(state.sessions[id], reports.get(id));
  }
  async function inspect(id) {
    const record = entry(id), native = await definition(record);
    let report = await inspectDatasetSession(record.session), lockSha256 = null;
    if (report.status === 'RUNNING') {
      try { lockSha256 = digest(await readPrivate(join(record.session, 'run.lock'), 4096)); }
      catch (error) { if (error.code !== 'ENOENT') throw error; report = await inspectDatasetSession(record.session); }
    }
    if (report.status !== 'RUNNING') {
      check(report.sessionId === record.sessionId && report.configurationSha256 === record.configurationSha256,
        'DATASET_SESSION_CHANGED', 'The inspected original acquisition identity changed.', 409);
      reports.set(id, report);
    }
    const current = report.status === 'RUNNING' ? lockSha256 === null ? null : identity({
      definitionSha256: record.definitionSha256, status: report.status, lockSha256,
    }) : revision(report);
    return { ...summary(record, report), report, revision: current, canFinalizePurchases: record.workspace !== null,
      selection: { url: native.config.operation.url, method: native.config.operation.method, terms: native.config.operation.expect,
        limits: native.limits, expectedSnapshot: native.expectedSnapshot } };
  }
  async function sessionView(id) {
    if (active?.session === id) {
      const record = entry(id), report = reports.get(id), native = await definition(record);
      return { ...summary(record, report), report, revision: null, active: publicJob(active.job), canFinalizePurchases: record.workspace !== null,
        selection: { url: native.config.operation.url, method: native.config.operation.method, terms: native.config.operation.expect,
          limits: native.limits, expectedSnapshot: native.expectedSnapshot } };
    }
    return inspect(id);
  }
  function publicJob(job) {
    return { id: job.id, session: job.session, kind: job.kind, status: job.status,
      createdAt: job.createdAt, startedAt: job.startedAt, endedAt: job.endedAt,
      result: job.result, error: job.error, interrupted: job.interrupted ?? false };
  }
  async function start(input) {
    check(object(input) && ACTION.test(input.actionId ?? ''), 'DATASET_ACTION_ID_REQUIRED');
    check(['run', 'recover', 'deliver', 'finalize', 'analysis'].includes(input.kind), 'DATASET_ACTION_INVALID');
    const requestHash = identity(input);
    function existing() {
      const old = savedRecord(state.jobs, input.actionId);
      if (!old) return null;
      check(old.requestHash === requestHash, 'DATASET_ACTION_ID_CONFLICT', 'This action ID belongs to a different operation.', 409);
      return publicJob(old);
    }
    const old = existing(); if (old) return old;
    return exclusive(async () => {
      const old = existing(); if (old) return old;
      const record = entry(input.session), current = await inspect(input.session);
      check(current.revision !== null && HASH.test(input.expectedRevision ?? '') && current.revision === input.expectedRevision,
        'DATASET_REVIEW_STALE', 'This acquisition changed. Refresh its original status before continuing.', 409);
      if (input.kind !== 'recover') check(current.status !== 'RUNNING', 'DATASET_ORIGINAL_SESSION_RUNNING', 'The original session has another owner. Refresh or use native crash recovery.', 409);
      if (input.kind === 'run') check(current.status === 'READY', 'DATASET_NOT_READY', 'Use the native recovery or purchase record for the stopped step.', 409);
      if (input.kind === 'run' && record.reviewId) {
        const ready = await receiving.preflight(record.reviewId);
        check(ready.session === record.session && ready.workspace === record.workspace && ready.sessionId === record.sessionId &&
          ready.definitionSha256 === record.definitionSha256, 'DATASET_PREPARED_WORKSPACE_CHANGED');
      }
      if (['deliver', 'analysis'].includes(input.kind)) check(current.status === 'COMPLETE', 'DATASET_ACQUISITION_INCOMPLETE', 'Complete the original dataset acquisition first.', 409);
      if (input.kind === 'analysis') { check(record.delivery, 'DATASET_DELIVERY_REQUIRED', 'Finalize the original data room first.'); launcher.command(record, input.alias); }
      if (input.kind === 'finalize') check(record.workspace, 'DATASET_ACCOUNTING_WORKSPACE_REQUIRED', 'Purchase continuation requires the original operator workspace.');
      const job = { id: input.actionId, session: record.id, kind: input.kind, requestHash,
        status: 'RUNNING', createdAt: now(), startedAt: now() };
      state.jobs[job.id] = job;
      const controller = new AbortController();
      active = { session: record.id, job, controller, done: null };
      try { await save(); } catch (error) { active = null; delete state.jobs[job.id]; throw error; }
      const running = active;
      running.done = Promise.resolve().then(async () => {
        try {
          if (job.kind === 'run') {
            const report = await runDatasetSession(record.session, { signal: controller.signal,
              emitPageSummaries: false, onPage: async value => { reports.set(record.id, value); } });
            reports.set(record.id, report);
            job.result = { status: report.status, completedPages: report.completedPages, acquiredRows: report.acquiredRows,
              interrupted: report.interrupted === true };
          } else if (job.kind === 'recover') {
            const report = await recoverDatasetSession(record.session); reports.set(record.id, report);
            job.result = { status: report.status, completedPages: report.completedPages, acquiredRows: report.acquiredRows };
          } else if (job.kind === 'deliver') {
            const delivery = await deliverDatasetSession(record.session, record.room);
            record.delivery = delivery;
            job.result = { paymentStatus: delivery.paymentStatus, appendedPages: delivery.appendedPages,
              resumed: delivery.resumed, sourceBindingSha256: delivery.sourceBindingSha256,
              nativeStatus: delivery.nativeStatus };
          } else if (job.kind === 'finalize') {
            let offset = 0, ranges = 0, complete = false;
            while (!complete && !controller.signal.aborted) {
              const report = await accountDatasetSession(record.session, { workspace: record.workspace ?? undefined,
                offset, limit: 50, finalize: true, signal: controller.signal });
              await atomicJson(join(root, 'accounting'), `${job.id}-${offset}.json`, report);
              ranges++;
              const next = report.range?.nextOffset;
              if (next === null || next === undefined) complete = true;
              else { check(Number.isSafeInteger(next) && next > offset, 'DATASET_ACCOUNTING_RANGE_INVALID'); offset = next; }
            }
            job.result = { ranges, complete, nextOffset: complete ? null : offset, interrupted: controller.signal.aborted };
          } else {
            const opened = await launcher.open(record, input.alias);
            // The private capability remains in the original launch file and live memory.
            job.result = { alias: opened.alias, workspaceId: opened.workspaceId, registered: opened.registered };
          }
          job.status = controller.signal.aborted ? 'STOPPED' : 'COMPLETE';
        } catch (error) {
          job.status = controller.signal.aborted ? 'STOPPED' : 'FAILED';
          job.error = { code: safeCode(error), message: error.message ?? safeCode(error),
            ...(error.partialWorkPreserved ? { partialWorkPreserved: true } : {}) };
        } finally {
          job.endedAt = now();
          try { await save(); } finally { if (active === running) active = null; }
        }
      });
      running.done.catch(error => { persistenceError = { code: safeCode(error),
        message: 'The customer operation finished, but its browser record could not be saved. Its original native files remain available; reopen and inspect the session.' }; });
      return publicJob(job);
    });
  }
  async function file(id, name) {
    check(FILES.has(name), 'DATASET_FILE_NOT_FOUND', 'Choose an original delivered file.', 404);
    const record = entry(id); await definition(record);
    const expected = record.delivery?.outputs?.[name];
    check(expected && expected.path === join(record.room, name) && HASH.test(expected.sha256 ?? '') &&
      Number.isSafeInteger(expected.bytes) && expected.bytes >= 0, 'DATASET_DELIVERY_REQUIRED');
    const handle = await open(expected.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = await handle.stat({ bigint: true });
      check(before.isFile() && before.nlink === 1n && (before.mode & 0o077n) === 0n && before.size === BigInt(expected.bytes), 'DATASET_DELIVERY_FILE_CHANGED');
      const stamp = fileStamp(before), key = expected.path + ':' + expected.sha256;
      if (verifiedFiles.get(key) !== stamp) {
        const hash = createHash('sha256'), buffer = Buffer.alloc(65536); let offset = 0;
        while (offset <= expected.bytes) {
          const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, expected.bytes - offset + 1), offset);
          if (!bytesRead) break; offset += bytesRead; hash.update(buffer.subarray(0, bytesRead));
        }
        check(offset === expected.bytes && hash.digest('hex') === expected.sha256, 'DATASET_DELIVERY_FILE_CHANGED');
      }
      const after = await handle.stat({ bigint: true });
      check(stamp === fileStamp(after), 'DATASET_DELIVERY_FILE_CHANGED');
      if (verifiedFiles.size >= 512 && !verifiedFiles.has(key)) verifiedFiles.delete(verifiedFiles.keys().next().value);
      verifiedFiles.set(key, stamp);
      return { handle, name, bytes: expected.bytes, sha256: expected.sha256, stamp };
    } catch (error) { await handle.close(); throw error; }
  }
  async function preview(id, offset = 0, limit = 50) {
    check(Number.isSafeInteger(offset) && offset >= 0 && offset <= 1000000 && Number.isSafeInteger(limit) && limit >= 1 && limit <= 100, 'DATASET_PREVIEW_RANGE_INVALID');
    const retained = await file(id, 'dataset.jsonl'), rows = [], key = id + ':' + retained.sha256;
    let indexed = rowOffsets.get(key);
    if (!indexed || indexed.stamp !== retained.stamp) {
      if (rowOffsets.size >= 8) rowOffsets.delete(rowOffsets.keys().next().value);
      indexed = { stamp: retained.stamp, offsets: new Map([[0, 0]]) }; rowOffsets.set(key, indexed);
    }
    let index = 0, position = 0;
    for (const [row, byte] of indexed.offsets) if (row <= offset && row > index) { index = row; position = byte; }
    const stream = retained.handle.createReadStream({ autoClose: false, start: position });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        if (index >= offset && rows.length < limit) rows.push(JSON.parse(line));
        // SF100's original JSONL exporter writes one UTF-8 JSON value + LF per row.
        position += Buffer.byteLength(line, 'utf8') + 1; index++;
        if (index % 50 === 0) indexed.offsets.set(index, position);
        if (index >= offset + limit) break;
      }
      return { offset, rows, nextOffset: offset + rows.length < (entry(id).delivery.nativeStatus?.rows ?? index + (rows.length === limit ? 1 : 0)) ? offset + rows.length : null,
        originalSha256: retained.sha256 };
    } finally { lines.close(); stream.destroy(); await retained.handle.close(); }
  }
  try {
    for (const name of ['received', 'accounting', 'exports']) await privateDirectory(join(root, name), true);
    state = await optionalJson(join(root, 'workspace.json'), 16777216) ?? {
      schema: SCHEMA, revision: 0, createdAt: now(), sessions: {}, sources: {}, jobs: {},
    };
    check(state.schema === SCHEMA && object(state.sessions) && object(state.sources) && object(state.jobs), 'DATASET_WORKSPACE_INVALID');
    for (const job of Object.values(state.jobs)) if (job.status === 'RUNNING') {
      job.status = 'INTERRUPTED'; job.interrupted = true; job.endedAt = now();
    }
    await save();
    receiving = await openDatasetReceiving({ directory: join(root, 'received'), operatorSettings });
    if (profilePath !== null) {
      const profile = await readJson(absolute(profilePath), 262144);
      check(profile.schema === SCHEMA && Array.isArray(profile.sessions) && profile.sessions.length <= 64, 'DATASET_PROFILE_INVALID');
      for (const item of profile.sessions) await attach(item);
    }
  } catch (error) { await launcher.close(); await release(); throw error; }
  return {
    async state() {
      return { schema: SCHEMA, revision: state.revision, operator: await receiving.operatorView(),
        sources: Object.values(state.sources), sessions: Object.values(state.sessions).map(record => summary(record, reports.get(record.id))),
        jobs: Object.values(state.jobs).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(publicJob),
        active: active ? publicJob(active.job) : null, analysis: launcher.state(), persistenceError };
    },
    receive: value => exclusive(async () => { const result = await receiving.receive(value); state.sources[result.id] = result; await save(); return result; }),
    source: id => receiving.describe(id),
    review: value => exclusive(() => receiving.review(value)),
    prepare: reviewId => exclusive(async () => {
      const proof = await receiving.reviewed(reviewId), prior = savedRecord(state.sessions, proof.name);
      check(!prior || prior.reviewId === reviewId, 'DATASET_SESSION_NAME_EXISTS', 'Choose another name; this session name already belongs to a different acquisition.', 409);
      const value = await receiving.provision(reviewId);
      return attach({ id: value.name, label: value.name, session: value.session, room: value.room, kind: 'received', reviewId });
    }),
    session: sessionView, start,
    job: id => { const job = savedRecord(state.jobs, id); check(job, 'DATASET_JOB_NOT_FOUND', 'This saved operation is not present.', 404); return publicJob(job); },
    async cancel(id) {
      check(active?.job.id === id && ['run', 'finalize'].includes(active.job.kind), 'DATASET_JOB_NOT_CANCELLABLE', 'Only the current native page or purchase continuation can be stopped.', 409);
      active.controller.abort(); return publicJob(active.job);
    },
    accounting: (id, offset = 0) => exclusive(async () => { const record = entry(id); await definition(record);
      check(Number.isSafeInteger(offset) && offset >= 0, 'DATASET_ACCOUNTING_RANGE_INVALID');
      return accountDatasetSession(record.session, { offset, limit: 50 }); }),
    handoff: (id, alias) => { const record = entry(id); check(record.delivery, 'DATASET_DELIVERY_REQUIRED');
      return { schema: 'stellar-forge.sf88.dataset-analysis-handoff.v1', sessionId: record.sessionId,
        sourceBindingSha256: record.delivery.sourceBindingSha256, session: record.session, room: record.room,
        source: alias, command: launcher.command(record, alias) }; },
    manifest: id => exclusive(async () => { const record = entry(id); await definition(record);
      const current = await inspect(id);
      check(current.status === 'COMPLETE', 'DATASET_COMPLETE_SESSION_REQUIRED');
      const destination = join(root, 'exports', record.definitionSha256 + '-' + current.revision + '.json');
      try { return await readPrivate(destination, 16777216); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await exportDatasetManifest(record.session, destination);
      return readPrivate(destination, 16777216); }),
    file, preview,
    close() {
      if (closing) return closing;
      closed = true;
      closing = (async () => { if (mutation) await mutation.catch(() => {});
        if (active) { active.controller.abort(); await active.done.catch(() => {}); }
        await launcher.close(); await release(); })();
      return closing;
    },
  };
}
