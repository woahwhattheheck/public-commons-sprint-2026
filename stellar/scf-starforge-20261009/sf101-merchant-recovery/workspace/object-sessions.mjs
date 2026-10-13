// SPDX-License-Identifier: MIT
// SF101 adapter over the original standalone ObjectSessionRecovery SDK.
// The workspace owns its writer lease, original requests and explicit continuations.
import { constants } from 'node:fs';
import { lstat, realpath, mkdir, open, link, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { ObjectSessionRecovery } from '../../sf88-operator-buyer-cli/node/workspace-recovery.mjs';

export const OBJECT_SESSION_EVIDENCE_SCHEMA = 'stellar-forge.sf101.object-session-evidence.v1';
const NATIVE_SCHEMA = 'stellar-forge.sf88.object-session-recovery.v1';
const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;
const HASH = /^[a-f0-9]{64}$/;
const PASS_ENV = /^[A-Z][A-Z0-9_]{4,63}$/;
const KINDS = ['snapshot', 'verify', 'restore'];
const MAX_EVIDENCE = 16 * 1024 * 1024;
const MAX_COMPACT = 768 * 1024;
const MAX_REFERENCES = 4096;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = value => JSON.parse(JSON.stringify(value));
const digest = value => createHash('sha256').update(value).digest('hex');
const encoded = value => Buffer.from(JSON.stringify(value) + '\n');
const inside = (root, path) => path === root || path.startsWith(root + sep);
const overlap = (left, right) => inside(left, right) || inside(right, left);
const pick = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined)
  .map(key => [key, clone(value[key])]));
function need(condition, code, message = code, status = 400) {
  if (!condition) throw Object.assign(new Error(message), { code, status });
}
function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function fields(value, allowed) {
  need(object(value) && Object.keys(value).every(key => allowed.includes(key)),
    'WORKSPACE_OBJECT_SELECTION_INVALID');
}
function absolute(value) {
  need(typeof value === 'string' && isAbsolute(value) && resolve(value) === value &&
    value !== sep && !/[\u0000-\u001f]/.test(value), 'WORKSPACE_OBJECT_CANONICAL_PATH_REQUIRED');
  return value;
}
function hash(value) {
  need(typeof value === 'string' && HASH.test(value), 'WORKSPACE_OBJECT_HASH_REQUIRED');
  return value;
}
function passphrase(value) {
  need(typeof value === 'string' && PASS_ENV.test(value), 'WORKSPACE_PASSPHRASE_NAME_INVALID');
  return value;
}
function errorInfo(error) {
  return { code: typeof error?.code === 'string' ? error.code.slice(0, 160) : 'WORKSPACE_OBJECT_NATIVE_FAILED',
    message: String(error?.message ?? 'Object-session recovery did not complete').slice(0, 600) };
}
function normalized(input) {
  fields(input, ['id', 'label', 'directory', 'stateRoot', 'include', 'bundle', 'sessionId', 'kinds', 'expectedRecordSha256']);
  need(ID.test(input.id ?? '') && typeof input.sessionId === 'string' &&
    input.sessionId.length > 0 && input.sessionId.length <= 160 && !/[\u0000-\u001f]/.test(input.sessionId),
    'WORKSPACE_OBJECT_DECLARATION_INVALID');
  const value = { id: input.id, label: input.label ?? input.id,
    directory: absolute(input.directory), stateRoot: absolute(input.stateRoot),
    include: input.include ?? [], bundle: absolute(input.bundle), sessionId: input.sessionId, kinds: input.kinds };
  need(typeof value.label === 'string' && value.label.trim() && value.label.length <= 160 &&
    !/[\u0000-\u001f]/.test(value.label), 'WORKSPACE_LABEL_INVALID');
  need(Array.isArray(value.include) && value.include.length <= 64 &&
    value.include.every(path => absolute(path) === path) &&
    new Set(value.include).size === value.include.length, 'WORKSPACE_OBJECT_INCLUDE_INVALID');
  need(value.directory !== value.stateRoot && inside(value.stateRoot, value.directory) &&
    value.include.every(path => inside(value.stateRoot, path)), 'WORKSPACE_OBJECT_SOURCE_OUTSIDE_ROOT');
  need(!overlap(value.stateRoot, value.bundle), 'WORKSPACE_OBJECT_BUNDLE_SOURCE_OVERLAP');
  need(Array.isArray(value.kinds) && value.kinds.length > 0 && value.kinds.length <= 3 &&
    value.kinds.every(kind => KINDS.includes(kind)) && new Set(value.kinds).size === value.kinds.length,
    'WORKSPACE_OBJECT_KINDS_INVALID');
  value.include = [...value.include].sort(); value.kinds = [...value.kinds].sort();
  if (input.expectedRecordSha256 !== undefined) value.expectedRecordSha256 = hash(input.expectedRecordSha256);
  need(value.kinds.includes('snapshot') || value.expectedRecordSha256,
    'WORKSPACE_OBJECT_RECEIVED_RECORD_REQUIRED');
  return value;
}

/** Compile trusted host declarations; browser selectors never supply these paths. */
export function compileObjectSessions(input, { bundleRoots, downloadRoot, controls = [] } = {}) {
  need(input === undefined || Array.isArray(input), 'WORKSPACE_OBJECT_DECLARATIONS_INVALID');
  need(Array.isArray(bundleRoots) && bundleRoots.length > 0 && Array.isArray(controls),
    'WORKSPACE_OBJECT_HOST_ROOTS_REQUIRED');
  const roots = bundleRoots.map(root => absolute(typeof root === 'string' ? root : root?.directory));
  roots.push(absolute(downloadRoot));
  const excluded = controls.map(absolute), ids = new Set();
  const selected = (input ?? []).map(raw => {
    const value = normalized(raw);
    need(!ids.has(value.id), 'WORKSPACE_OBJECT_DUPLICATE_DECLARATION'); ids.add(value.id);
    need(roots.some(root => value.bundle !== root && inside(root, value.bundle)),
      'WORKSPACE_OBJECT_BUNDLE_OUTSIDE_HOST_ROOTS');
    for (const control of excluded) need(!overlap(value.stateRoot, control) && !overlap(value.bundle, control),
      'WORKSPACE_OBJECT_CONTROL_OVERLAP');
    return value;
  });
  need(selected.length <= 32, 'WORKSPACE_OBJECT_DECLARATIONS_INVALID');
  return selected;
}

async function privateDirectory(path, create = false) {
  absolute(path);
  if (create) {
    try { await mkdir(path, { mode: 0o700 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  const stat = await lstat(path);
  need(stat.isDirectory() && !stat.isSymbolicLink() && !(stat.mode & 0o077) &&
    await realpath(path) === path, 'WORKSPACE_OBJECT_PRIVATE_DIRECTORY_REQUIRED');
  return { dev: stat.dev, ino: stat.ino };
}
async function privateBytes(path, maximum = MAX_EVIDENCE) {
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const first = await fd.stat();
    need(first.isFile() && first.nlink === 1 && !(first.mode & 0o077) && first.size <= maximum,
      'WORKSPACE_OBJECT_PRIVATE_EVIDENCE_REQUIRED');
    const data = await fd.readFile(), last = await fd.stat();
    need(data.length === first.size && data.length <= maximum && first.dev === last.dev &&
      first.ino === last.ino && first.size === last.size && first.mtimeMs === last.mtimeMs &&
      first.ctimeMs === last.ctimeMs, 'WORKSPACE_OBJECT_EVIDENCE_CHANGED');
    return data;
  } finally { await fd.close(); }
}
async function syncDirectory(path) {
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { await fd.sync(); } finally { await fd.close(); }
}
async function canonicalExistingAncestor(path) {
  let selected = absolute(path);
  while (true) {
    try {
      const stat = await lstat(selected);
      need(!stat.isSymbolicLink() && await realpath(selected) === selected,
        'WORKSPACE_OBJECT_PATH_ALIAS_REJECTED');
      if (selected !== path) need(stat.isDirectory(), 'WORKSPACE_OBJECT_PARENT_INVALID');
      return;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = dirname(selected);
      need(parent !== selected, 'WORKSPACE_OBJECT_PARENT_INVALID');
      selected = parent;
    }
  }
}
function checkpoint(value) {
  return value == null ? null : pick(value, ['sessionId', 'status', 'progressStatus', 'configurationSha256',
    'sessionSha256', 'objectSha256', 'bytes', 'chunkCount', 'completeChunks', 'attemptedChunks',
    'downloadedBytes', 'capAllocatedAtomic']);
}
function nativeBinding(declaration, result, { expectedRecordSha256, expectedReviewSha256, objectSession,
  inspect = false } = {}) {
  const native = result?.native;
  need(result?.ok === true && result.completionReported === true &&
    native?.schema === NATIVE_SCHEMA && native.directory === declaration.directory &&
    native.stateRoot === declaration.stateRoot && native.restoreMode === 'ORIGINAL_CANONICAL_STATE_ROOT' &&
    native.absentLedger?.state === 'ABSENT' && object(native.objectSession) &&
    native.objectSession.sessionId === declaration.sessionId &&
    native.objectSession.directory === declaration.directory, 'WORKSPACE_OBJECT_NATIVE_SELECTION_CHANGED');
  hash(native.reviewSha256);
  if (objectSession !== undefined) need(isDeepStrictEqual(native.objectSession, objectSession),
    'WORKSPACE_OBJECT_NATIVE_DEFINITION_CHANGED');
  if (expectedReviewSha256 !== undefined) need(native.reviewSha256 === expectedReviewSha256,
    'WORKSPACE_OBJECT_NATIVE_REVIEW_CHANGED');
  if (expectedRecordSha256 !== undefined) need(native.recordSha256 === expectedRecordSha256,
    'WORKSPACE_OBJECT_NATIVE_RECORD_CHANGED');
  if (inspect) {
    need(Array.isArray(native.include) && isDeepStrictEqual([...native.include].sort(), declaration.include) &&
      Array.isArray(native.selected) && Array.isArray(native.sourceFiles) &&
      native.selected.every(path => typeof path === 'string' && inside(declaration.stateRoot, path)),
      'WORKSPACE_OBJECT_NATIVE_INCLUDE_CHANGED');
  } else hash(native.recordSha256);
  return native;
}
function compact(result, error = null) {
  const native = result?.native;
  const value = { ok: result?.ok === true && !error, nativeOk: result?.ok === true,
    completionReported: result?.completionReported === true, process: clone(result?.process ?? null),
    ...(native ? pick(native, ['schema', 'status', 'recordSha256', 'reviewSha256', 'createdAt',
      'files', 'bytes', 'reused', 'originalStateRetained', 'executionStarted', 'publicationSyncError',
      'restoreMode', 'walletEnvironmentExported']) : {}),
    objectSession: clone(native?.objectSession ?? null), checkpoint: checkpoint(native?.checkpoint),
    current: checkpoint(native?.current), absentLedger: clone(native?.absentLedger ?? null),
    nativeReopenErrors: clone(native?.nativeReopenErrors ?? []),
    cleanupErrors: clone(native?.cleanupErrors ?? []), leaseReleaseErrors: clone(native?.leaseReleaseErrors ?? []),
    ...(error ? { error } : {}) };
  if (Array.isArray(native?.sourceFiles)) value.sourceFileCount = native.sourceFiles.length;
  if (Array.isArray(native?.selected)) value.selected = clone(native.selected);
  need(encoded(value).length <= MAX_COMPACT, 'WORKSPACE_OBJECT_COMPACT_RESULT_TOO_LARGE');
  return value;
}

/**
 * The caller retains the original outer review/request before invoking run.
 * This adapter creates no operation records, leases, retries or alternate engine.
 * close() aborts and drains original SDK children AND their evidence publication.
 */
export function createObjectRecoveryAdapter({ directory, environment = process.env,
  isClosing = () => false, readOnly = false } = {}) {
  absolute(directory); need(typeof isClosing === 'function', 'WORKSPACE_OBJECT_HOST_REQUIRED');
  const evidenceRoot = join(directory, 'object-session-evidence');
  const runtimeDirectory = fileURLToPath(new URL('../../sf88-operator-buyer-cli/', import.meta.url));
  const recovery = new ObjectSessionRecovery({ runtimeDirectory, node: process.execPath, environment });
  const shutdown = new AbortController(), pending = new Set();
  let closed = false, closePromise = null, rootIdentity = null, evidenceIdentity = null, writes = Promise.resolve();
  function available(write = false) {
    need(!closed && !isClosing(), 'WORKSPACE_OBJECT_CLOSING', 'The original workspace is closing', 409);
    if (write) need(!readOnly, 'WORKSPACE_READ_ONLY', 'Fresh native evidence requires the original workspace writer', 409);
  }
  async function setup(create) {
    const current = await privateDirectory(directory);
    if (rootIdentity) need(isDeepStrictEqual(current, rootIdentity), 'WORKSPACE_OBJECT_WORKSPACE_CHANGED');
    else rootIdentity = current;
    const original = await privateDirectory(evidenceRoot, create);
    if (evidenceIdentity) need(isDeepStrictEqual(original, evidenceIdentity), 'WORKSPACE_OBJECT_EVIDENCE_ROOT_CHANGED');
    else evidenceIdentity = original;
  }
  function tracked(task, signal) {
    available(true);
    need(signal === undefined || signal instanceof AbortSignal, 'WORKSPACE_OBJECT_SIGNAL_INVALID');
    const ownedSignal = AbortSignal.any([shutdown.signal, ...(signal ? [signal] : [])]);
    const promise = Promise.resolve().then(() => { ownedSignal.throwIfAborted(); return task(ownedSignal); });
    pending.add(promise); promise.finally(() => pending.delete(promise)).catch(() => {});
    return promise;
  }
  async function publishEvidence(envelope) {
    const data = encoded(envelope);
    need(data.length <= MAX_EVIDENCE, 'WORKSPACE_OBJECT_EVIDENCE_TOO_LARGE');
    const sha256 = digest(data), path = join(evidenceRoot, sha256 + '.json');
    const publish = async () => {
      await setup(true);
      const temporary = join(evidenceRoot, '.object-evidence-' + randomUUID());
      let made = false;
      try {
        const fd = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL |
          constants.O_NOFOLLOW, 0o600); made = true;
        try { await fd.writeFile(data); await fd.sync(); } finally { await fd.close(); }
        try { await link(temporary, path); }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
        await unlink(temporary); made = false;
        const saved = await privateBytes(path);
        need(saved.equals(data), 'WORKSPACE_OBJECT_EVIDENCE_COLLISION');
        await syncDirectory(evidenceRoot);
        await setup(false);
        return { sha256, bytes: data.length };
      } finally { if (made) await unlink(temporary).catch(() => {}); }
    };
    const next = writes.then(publish, publish); writes = next.catch(() => {}); return next;
  }
  async function evidence(sha256) {
    hash(sha256); await setup(false);
    const data = await privateBytes(join(evidenceRoot, sha256 + '.json'));
    need(digest(data) === sha256, 'WORKSPACE_OBJECT_EVIDENCE_CHANGED');
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data));
    need(value.schema === OBJECT_SESSION_EVIDENCE_SCHEMA, 'WORKSPACE_OBJECT_EVIDENCE_INVALID');
    return { sha256, bytes: data.length, evidence: value };
  }
  function declaration(input) {
    const value = normalized(input);
    need(!overlap(directory, value.stateRoot) && !overlap(directory, value.bundle),
      'WORKSPACE_OBJECT_CONTROL_OVERLAP');
    return value;
  }
  async function paths(value) {
    for (const path of [value.stateRoot, value.directory, ...value.include, value.bundle])
      await canonicalExistingAncestor(path);
  }
  const declarationHash = value => digest(stable(value));
  async function invoke(value, command, method, options, checks, signal) {
    let result = null, problem = null;
    try {
      result = await recovery[method]({ ...options, signal });
      nativeBinding(value, result, checks);
    } catch (error) {
      if (error?.result) result = error.result;
      problem = errorInfo(error);
    }
    const nativeEvidence = await publishEvidence({ schema: OBJECT_SESSION_EVIDENCE_SCHEMA,
      declarationSha256: declarationHash(value), command, method, result: clone(result), error: problem });
    return { ...compact(result, problem), nativeEvidence };
  }
  function failed(reviewed) {
    if (!reviewed.ok) {
      const problem = reviewed.error ?? { code: 'WORKSPACE_OBJECT_NATIVE_INCOMPLETE',
        message: 'The native command did not complete cleanly; its complete evidence was retained' };
      throw Object.assign(new Error(problem.message), { code: problem.code, status: 409,
        objectRecoveryResult: { ...reviewed, status: 'INTERRUPTED' } });
    }
    return reviewed;
  }
  async function inspectOriginal(input, signal) {
    const value = declaration(input); await paths(value);
    const result = failed(await invoke(value, 'object-inspect', 'inspect',
      { directory: value.directory, stateRoot: value.stateRoot, include: value.include }, { inspect: true }, signal));
    return { ...result, command: 'object-inspect', objectSessionId: value.id,
      declarationSha256: declarationHash(value), directory: value.directory, stateRoot: value.stateRoot,
      bundle: value.bundle, sessionId: value.sessionId, expectedReviewSha256: result.reviewSha256 };
  }
  function inspect(input, { signal } = {}) {
    return tracked(ownedSignal => inspectOriginal(input, ownedSignal), signal);
  }
  function review(input, { action, expectedRecordSha256, quiesced, passEnv, signal } = {}) {
    return tracked(async ownedSignal => {
      const value = declaration(input), kind = action?.replace(/^object-/, '');
      need(KINDS.includes(kind) && action === 'object-' + kind && value.kinds.includes(kind),
        'WORKSPACE_OBJECT_ACTION_NOT_DECLARED');
      passphrase(passEnv);
      if (kind === 'snapshot') {
        need(quiesced === true && expectedRecordSha256 === undefined,
          'WORKSPACE_OBJECT_QUIESCENCE_REQUIRED');
        const result = await inspectOriginal(value, ownedSignal);
        return { ...result, command: action, quiesced: true };
      }
      need(quiesced === undefined, 'WORKSPACE_OBJECT_QUIESCENCE_NOT_APPLICABLE');
      const expected = expectedRecordSha256 ?? value.expectedRecordSha256;
      if (expected !== undefined) hash(expected);
      if (value.expectedRecordSha256) need(expected === value.expectedRecordSha256,
        'WORKSPACE_OBJECT_NATIVE_RECORD_CHANGED');
      await paths(value);
      const result = failed(await invoke(value, action, 'verify',
        { bundle: value.bundle, passphraseEnv: passEnv, ...(expected ? { expectedRecordSha256: expected } : {}) },
        { expectedRecordSha256: expected }, ownedSignal));
      return { ...result, declarationSha256: declarationHash(value), command: action,
        objectSessionId: value.id, directory: value.directory, stateRoot: value.stateRoot, bundle: value.bundle,
        sessionId: value.sessionId, expectedRecordSha256: result.recordSha256 };
    }, signal);
  }
  async function originalReview(value, reviewed) {
    need(object(reviewed) && reviewed.declarationSha256 === declarationHash(value) &&
      reviewed.objectSessionId === value.id && reviewed.directory === value.directory &&
      reviewed.stateRoot === value.stateRoot && reviewed.bundle === value.bundle &&
      reviewed.sessionId === value.sessionId && KINDS.some(kind => reviewed.command === 'object-' + kind) &&
      value.kinds.includes(reviewed.command.slice(7)) && object(reviewed.objectSession) && object(reviewed.nativeEvidence),
      'WORKSPACE_OBJECT_REVIEW_CHANGED');
    const saved = await evidence(reviewed.nativeEvidence.sha256);
    need(saved.bytes === reviewed.nativeEvidence.bytes &&
      saved.evidence.declarationSha256 === reviewed.declarationSha256 && !saved.evidence.error,
      'WORKSPACE_OBJECT_REVIEW_EVIDENCE_CHANGED');
    const snapshot = reviewed.command === 'object-snapshot';
    need(saved.evidence.method === (snapshot ? 'inspect' : 'verify') &&
      saved.evidence.command === (snapshot ? 'object-inspect' : reviewed.command),
      'WORKSPACE_OBJECT_REVIEW_EVIDENCE_CHANGED');
    nativeBinding(value, saved.evidence.result, snapshot ?
      { inspect: true, expectedReviewSha256: hash(reviewed.expectedReviewSha256), objectSession: reviewed.objectSession } :
      { expectedRecordSha256: hash(reviewed.expectedRecordSha256), objectSession: reviewed.objectSession });
    need(reviewed.ok === true && (!snapshot || reviewed.quiesced === true), 'WORKSPACE_OBJECT_REVIEW_CHANGED');
    if (!snapshot && value.expectedRecordSha256) need(reviewed.expectedRecordSha256 === value.expectedRecordSha256,
      'WORKSPACE_OBJECT_NATIVE_RECORD_CHANGED');
  }
  function run({ declaration: input, review: reviewed, state, save, signal, passEnv, cancelled = () => false } = {}) {
    return tracked(async ownedSignal => {
      const value = declaration(input); passphrase(passEnv);
      need(object(state) && typeof save === 'function' && typeof cancelled === 'function',
        'WORKSPACE_OBJECT_EXECUTION_INVALID');
      await originalReview(value, reviewed); await paths(value);
      const binding = { declarationSha256: declarationHash(value), reviewSha256: digest(stable(reviewed)), passEnv };
      if (state.objectRecoveryBinding) need(isDeepStrictEqual(state.objectRecoveryBinding, binding),
        'WORKSPACE_OBJECT_ORIGINAL_REQUEST_CHANGED');
      else state.objectRecoveryBinding = binding;
      state.objectRecoveryEvidence ??= [];
      need(Array.isArray(state.objectRecoveryEvidence) && state.objectRecoveryEvidence.length <= MAX_REFERENCES - 2,
        'WORKSPACE_OBJECT_EVIDENCE_HISTORY_LIMIT');
      const interrupted = () => ({ status: 'INTERRUPTED', command: reviewed.command, bundle: value.bundle,
        sessionId: value.sessionId, ok: false, completionReported: false, process: null,
        nativeEvidence: null, nativeReopenErrors: [], cleanupErrors: [], leaseReleaseErrors: [],
        error: { code: 'WORKSPACE_OBJECT_CANCELLED', message: 'Cancelled before native dispatch' } });
      async function execute(method, options, checks, phase) {
        state.progress = phase; await save();
        if (cancelled() || ownedSignal.aborted) return interrupted();
        const result = await invoke(value, reviewed.command, method, options, checks, ownedSignal);
        state.objectRecoveryEvidence.push({ phase, ...result.nativeEvidence });
        state.objectRecoveryLastResult = result;
        state.progress = result.ok ? phase + '_COMPLETE' : 'INTERRUPTED';
        await save(); // Persist evidence reference before a following restore or caller reply.
        return result;
      }
      if (cancelled() || ownedSignal.aborted) return interrupted();
      const kind = reviewed.command.slice(7), archive = { bundle: value.bundle, passphraseEnv: passEnv,
        expectedRecordSha256: reviewed.expectedRecordSha256 };
      let result;
      if (kind === 'snapshot') {
        result = await execute('snapshot', { directory: value.directory, stateRoot: value.stateRoot,
          include: value.include, output: value.bundle, passphraseEnv: passEnv, quiesced: true,
          expectedReviewSha256: reviewed.expectedReviewSha256 },
          { expectedReviewSha256: reviewed.expectedReviewSha256, objectSession: reviewed.objectSession }, 'OBJECT_SNAPSHOT');
      } else {
        result = await execute('verify', archive,
          { expectedRecordSha256: reviewed.expectedRecordSha256, objectSession: reviewed.objectSession }, 'OBJECT_VERIFY');
        if (result.ok && kind === 'restore') result = await execute('restore', archive,
          { expectedRecordSha256: reviewed.expectedRecordSha256, objectSession: reviewed.objectSession }, 'OBJECT_RESTORE');
      }
      const returned = { ...result, status: result.ok ? 'COMPLETE' : 'INTERRUPTED',
        command: reviewed.command, bundle: value.bundle, sessionId: value.sessionId };
      state.objectRecoveryLastResult = returned; state.progress = returned.status; await save();
      return returned;
    }, signal);
  }
  return { inspect, review, run, evidence,
    close() {
      if (!closePromise) {
        closed = true; shutdown.abort();
        closePromise = (async () => { await Promise.allSettled([...pending]); await writes; })();
      }
      return closePromise;
    } };
}
