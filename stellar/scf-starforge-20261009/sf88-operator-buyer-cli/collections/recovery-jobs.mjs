// MIT. Retained application operations around the existing encrypted recovery engine.
import { randomUUID } from 'node:crypto';
import { readdir, lstat } from 'node:fs/promises';
import { join, isAbsolute, resolve } from 'node:path';
import { acquireCollectionLease } from './model.mjs';
import { initializationDirectory, initializationBytes, optionalInitializationBytes,
  retainInitializationRecord } from '../initialization.mjs';
import { inspectCollectionRecovery, snapshotCollectionRecovery,
  verifyCollectionRecovery, restoreCollectionRecovery,
  reconcileCollectionRestore, collectionBundleFiles } from './recovery.mjs';

const SCHEMA = 'stellar-forge.sf88.collection-recovery-operation.v1';
const ID = /^[a-f0-9-]{36}$/;
const HASH = /^[a-f0-9]{64}$/;
const PASS = /^[A-Z][A-Z0-9_]{4,63}$/;
const KINDS = new Set(['SNAPSHOT','VERIFY','RESTORE']);
const codeOf = error => /^[A-Z0-9_]{1,120}$/.test(error?.code ?? '')
  ? error.code : 'COLLECTION_RECOVERY_FAILED';
function need(value, code) { if (!value) throw Object.assign(new Error(code), { code, status: 409 }); }
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function absolute(path) {
  need(typeof path === 'string' && isAbsolute(path) && resolve(path) === path
    && path !== '/' && !path.includes('\0'), 'COLLECTION_RECOVERY_CANONICAL_PATH_REQUIRED');
  return path;
}
function selection(kind, options) {
  need(KINDS.has(kind) && object(options), 'COLLECTION_RECOVERY_REQUEST_INVALID');
  const allowed = kind === 'SNAPSHOT'
    ? ['stateRoot','output','expectedReviewSha256','passEnv','quiesced']
    : ['bundle','passEnv','python','expected','expectedStateRoot'];
  need(Object.keys(options).every(key => allowed.includes(key)), 'COLLECTION_RECOVERY_REQUEST_INVALID');
  const clean = { passEnv: options.passEnv ?? 'SF88_BACKUP_PASSPHRASE' };
  need(PASS.test(clean.passEnv), 'WORKSPACE_RECOVERY_PASSPHRASE_NAME_INVALID');
  if (kind === 'SNAPSHOT') {
    need(options.quiesced === true && HASH.test(options.expectedReviewSha256 ?? ''),
      'COLLECTION_RECOVERY_REVIEW_REQUIRED');
    Object.assign(clean, { stateRoot: absolute(options.stateRoot), output: absolute(options.output),
      expectedReviewSha256: options.expectedReviewSha256, quiesced: true });
  } else {
    Object.assign(clean, { bundle: absolute(options.bundle), python: absolute(options.python ?? '/usr/bin/python3') });
    if (options.expected !== undefined) {
      need(HASH.test(options.expected), 'COLLECTION_RECOVERY_VERIFIED_BACKUP_REQUIRED');
      clean.expected = options.expected;
    }
    if (options.expectedStateRoot !== undefined) clean.expectedStateRoot = absolute(options.expectedStateRoot);
    if (kind === 'RESTORE') need(clean.expected && clean.expectedStateRoot,
      'COLLECTION_RECOVERY_VERIFIED_BACKUP_REQUIRED');
  }
  return clean;
}
async function read(path, maximum = 32 * 1024 * 1024) {
  const bytes = await optionalInitializationBytes(path, maximum);
  if (bytes === null) return null;
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
async function targetStatus(result) {
  const path = result.application?.profile?.stateRoot;
  if (!path) return null;
  try {
    const st = await lstat(path);
    if (!st.isDirectory() || st.isSymbolicLink()) return { path, state: 'UNSAFE' };
    return { path, state: (await readdir(path)).length ? 'POPULATED' : 'EMPTY' };
  } catch (error) {
    if (error.code === 'ENOENT') return { path, state: 'ABSENT' };
    return { path, state: 'UNAVAILABLE', error: codeOf(error) };
  }
}
function summary(request, result, active) {
  return { schema: SCHEMA, requestId: request.requestId, kind: request.kind,
    createdAt: request.createdAt, options: request.options,
    state: active?.state ?? result?.state ?? 'UNFINISHED',
    completedAt: result?.completedAt ?? null, progress: active?.progress ?? [],
    result: result?.result ?? active?.result ?? null, error: result?.error ?? active?.error ?? null,
    persistenceError: active?.persistenceError ?? null,
    retry: 'EXPLICIT_SAME_REQUEST_RECOVERY', executionStarted: false };
}

/** A journal for archive operations, not a second queue or payment ledger. */
export async function openCollectionRecovery({ directory, getCollections = () => null,
  environment = process.env } = {}) {
  directory = absolute(directory);
  await initializationDirectory(directory, { create: true });
  const operations = join(directory, 'operations');
  await initializationDirectory(operations, { create: true });
  const meta = join(directory, 'recovery.json');
  await retainInitializationRecord(meta, { schema: SCHEMA, directory }, { resume: true });
  let active = null, closing = false, starting = false, startingCompletion = null;
  function pathFor(id) { need(ID.test(id ?? ''), 'COLLECTION_RECOVERY_REQUEST_ID_REQUIRED'); return join(operations, id); }
  async function retained(id) {
    const path = pathFor(id), request = await read(join(path, 'request.json'), 65536);
    need(request, 'COLLECTION_RECOVERY_OPERATION_NOT_FOUND');
    need(request.schema === SCHEMA && request.requestId === id && KINDS.has(request.kind)
      && JSON.stringify(selection(request.kind, request.options)) === request.selection,
    'COLLECTION_RECOVERY_OPERATION_CHANGED');
    const result = await read(join(path, 'result.json'));
    need(!result || result.schema === SCHEMA && result.requestId === id
      && result.selection === request.selection && ['COMPLETED','CANCELLED','FAILED'].includes(result.state),
    'COLLECTION_RECOVERY_OPERATION_CHANGED');
    return { request, result, path };
  }
  async function inspect(id) {
    const saved = await retained(id);
    return summary(saved.request, saved.result, active?.requestId === id ? active : null);
  }
  async function list({ offset = 0, limit = 50 } = {}) {
    need(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(limit)
      && limit >= 1 && limit <= 100, 'COLLECTION_RECOVERY_PAGE_INVALID');
    const entries = await readdir(operations, { withFileTypes: true }), rows = [];
    for (const entry of entries) {
      if (!ID.test(entry.name)) continue;
      need(entry.isDirectory() && !entry.isSymbolicLink(), 'COLLECTION_RECOVERY_OPERATION_CHANGED');
      const request = await read(join(operations, entry.name, 'request.json'), 65536);
      if (request) rows.push({ id: entry.name, createdAt: request.createdAt });
    }
    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
    const page = [];
    for (const row of rows.slice(offset, offset + limit)) {
      const current = await inspect(row.id), result = current.result;
      const { application, ...compact } = result ?? {};
      page.push({ ...current, result: result ? { ...compact,
        collectionCount: application?.profile?.collections?.length ?? result.collectionCount,
        requestCount: application?.profile?.jobs?.length ?? result.requestCount } : null });
    }
    return { schema: SCHEMA, directory, offset, limit, total: rows.length,
      hasMore: offset + page.length < rows.length, rows: page,
      activeRequestId: active?.requestId ?? null };
  }
  async function review(options) {
    need(!closing, 'COLLECTION_WORKSPACE_CLOSING');
    return inspectCollectionRecovery({ ...options, collections: getCollections() });
  }
  async function launch(request, path, release, resumed) {
    const controller = new AbortController();
    const running = { requestId: request.requestId, state: 'RUNNING', progress: [],
      controller, result: null, error: null, completion: null };
    active = running;
    const onProgress = value => {
      running.progress.push({ observedAt: new Date().toISOString(), ...value });
      if (running.progress.length > 64) running.progress.shift();
    };
    running.completion = (async () => {
      let result = null, error = null;
      try {
        const context = { environment, signal: controller.signal, onProgress };
        if (request.kind === 'SNAPSHOT') {
          const existing = await lstat(request.options.output).catch(cause => {
            if (cause.code === 'ENOENT') return null; throw cause;
          });
          if (resumed && existing) {
            result = await verifyCollectionRecovery({ bundle: request.options.output,
              passEnv: request.options.passEnv }, context);
            need(result.application.operationId === request.requestId
              && result.application.profile.reviewSha256 === request.options.expectedReviewSha256,
            'COLLECTION_RECOVERY_OUTPUT_BINDING_CHANGED');
            result = { ...result, status: 'COLLECTION_BACKUP_PUBLICATION_RECOVERED',
              publicationRecovered: true };
          } else {
            result = await snapshotCollectionRecovery({ ...request.options,
              operationId: request.requestId, collections: getCollections() }, context);
          }
          need(Array.isArray(result.encryptedFiles), 'COLLECTION_RECOVERY_BUNDLE_CHANGED');
        } else if (request.kind === 'VERIFY') {
          result = await verifyCollectionRecovery(request.options, context);
        } else {
          const target = await lstat(request.options.expectedStateRoot).catch(cause => {
            if (cause.code === 'ENOENT') return null; throw cause;
          });
          if (resumed && target && target.isDirectory() && (await readdir(request.options.expectedStateRoot)).length) {
            result = await reconcileCollectionRestore({ ...request.options, receivingDirectory: directory }, context);
          } else {
            result = await restoreCollectionRecovery({ ...request.options, receivingDirectory: directory }, context);
          }
        }
        result = { ...result, target: await targetStatus(result) };
        running.state = 'COMPLETED'; running.result = result;
      } catch (cause) {
        error = { code: codeOf(cause) }; running.error = error;
        running.state = controller.signal.aborted ? 'CANCELLED' : 'FAILED';
      }
      const saved = { schema: SCHEMA, requestId: request.requestId, selection: request.selection,
        state: running.state, completedAt: new Date().toISOString(), result, error };
      try { await retainInitializationRecord(join(path, 'result.json'), saved); }
      catch (cause) { running.persistenceError = codeOf(cause); }
      try { await release(); } catch (cause) { running.persistenceError ??= codeOf(cause); }
      const view = summary(request, saved, running);
      if (active === running) active = null;
      return view;
    })();
    return summary(request, null, running);
  }
  async function start({ requestId = randomUUID(), kind, options } = {}) {
    need(!closing, 'COLLECTION_WORKSPACE_CLOSING');
    const chosen = selection(kind, options), path = pathFor(requestId);
    const before = await read(join(path, 'request.json'), 65536);
    if (before) {
      const saved = await retained(requestId);
      need(saved.request.kind === kind && saved.request.selection === JSON.stringify(chosen),
        'COLLECTION_RECOVERY_REQUEST_CHANGED');
      return { ...summary(saved.request, saved.result, active?.requestId === requestId ? active : null), reused: true };
    }
    need(!active && !starting, 'COLLECTION_RECOVERY_BUSY');
    starting = true;
    let settle; startingCompletion = new Promise(done => { settle = done; });
    let release;
    try {
      release = await acquireCollectionLease(directory);
      need(!closing, 'COLLECTION_WORKSPACE_CLOSING');
      await initializationDirectory(path, { create: true });
      const request = { schema: SCHEMA, requestId, kind, createdAt: new Date().toISOString(),
        options: chosen, selection: JSON.stringify(chosen) };
      try { await retainInitializationRecord(join(path, 'request.json'), request); }
      catch (cause) {
        if (cause.code !== 'EEXIST') throw cause;
        const saved = await retained(requestId);
        need(saved.request.selection === request.selection && saved.request.kind === kind,
          'COLLECTION_RECOVERY_REQUEST_CHANGED');
        await release(); release = null;
        return { ...summary(saved.request, saved.result, null), reused: true };
      }
      const result = await launch(request, path, release, false); release = null; return result;
    } finally { if (release) await release(); starting = false; settle(); startingCompletion = null; }
  }
  async function resume(requestId) {
    need(!closing && !active && !starting, 'COLLECTION_RECOVERY_BUSY');
    starting = true;
    let settle; startingCompletion = new Promise(done => { settle = done; });
    let release;
    try {
      const prior = await retained(requestId);
      if (prior.result) return { ...summary(prior.request, prior.result, null), reused: true };
      release = await acquireCollectionLease(directory);
      need(!closing, 'COLLECTION_WORKSPACE_CLOSING');
      const current = await retained(requestId);
      if (current.result) return { ...summary(current.request, current.result, null), reused: true };
      const result = await launch(current.request, current.path, release, true);
      release = null; return result;
    } finally {
      if (release) await release();
      starting = false; settle(); startingCompletion = null;
    }
  }
  async function cancel(requestId) {
    need(active?.requestId === requestId, 'COLLECTION_RECOVERY_NOT_ACTIVE');
    active.state = 'CANCELLING'; active.controller.abort();
    return inspect(requestId);
  }
  async function wait(requestId) {
    const current = active?.requestId === requestId ? active.completion : null;
    return current ? current : inspect(requestId);
  }
  async function openResult(requestId) {
    const saved = await retained(requestId), result = saved.result?.result;
    need(saved.result?.state === 'COMPLETED' && result?.application?.profile
      && saved.request.kind === 'RESTORE' && result.reopened && !result.reopenError,
    'COLLECTION_RECOVERY_VERIFIED_BACKUP_REQUIRED');
    return { directory: result.application.profile.directory, queueRoot: result.application.profile.queueRoot,
      recordSha256: result.recordSha256, headerSha256: result.application.profile.headerSha256, existingOnly: true };
  }
  return { directory, review, start, resume, cancel, wait, inspect, list, openResult,
    get busy() { return active !== null || starting; },
    async close() {
      if (closing) return; closing = true; await startingCompletion;
      if (active) { active.controller.abort(); await active.completion; }
    } };
}
