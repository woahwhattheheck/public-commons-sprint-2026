// SPDX-License-Identifier: MIT
// Authenticated Object backup comparison in the original SF101 request queue.
// The host owns review/request identity, attempts, serialization and its writer lease.
import { constants } from 'node:fs';
import { lstat, realpath, mkdir, open, link, unlink } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { ObjectSessionRecovery } from '../../sf88-operator-buyer-cli/node/workspace-recovery.mjs';
import { validateObjectRecoveryComparison, renderObjectRecoveryComparison } from '../../sf88-operator-buyer-cli/object-comparison-core.mjs';

export const OBJECT_COMPARISON_ARTIFACT_BYTES = 256 * 1024 * 1024;
const ARTIFACT_SCHEMA = 'stellar-forge.sf101.object-comparison-artifact.v1';
const NATIVE_SCHEMA = 'stellar-forge.sf88.object-session-comparison.v1';
const NATIVE_STATUS = 'OBJECT_SESSION_BACKUPS_COMPARED';
const REVIEW_FIELDS = new Set(['profileId', 'action', 'id', 'beforeObjectSessionId',
  'afterObjectSessionId', 'beforeExpectedRecordSha256', 'afterExpectedRecordSha256']);
const HASH = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const MEDIA = new Set(['application/json', 'text/html', 'text/markdown']);
const runtimeDirectory = fileURLToPath(new URL('../../sf88-operator-buyer-cli/', import.meta.url));
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = value => JSON.parse(JSON.stringify(value));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function issue(code, message = code, details = undefined) {
  return Object.assign(new Error(message), { code, status: 422, ...(details === undefined ? {} : { details }) });
}
function need(condition, code, message) { if (!condition) throw issue(code, message); }
function absolute(value, label) {
  need(typeof value === 'string' && isAbsolute(value) && resolve(value) === value,
    'OBJECT_COMPARISON_PATH', 'Use the declared canonical absolute ' + label + '.');
  return value;
}
function hash(value, label) {
  need(typeof value === 'string' && HASH.test(value), 'OBJECT_COMPARISON_RECORD_HASH',
    'Select the complete original ' + label + ' record SHA-256.');
  return value;
}
function identifier(value, label) {
  need(typeof value === 'string' && ID.test(value), 'OBJECT_COMPARISON_SELECTION',
    'Select the original ' + label + '.');
  return value;
}
function passEnv(profile) {
  const value = profile.passEnv ?? null;
  need(value === null || typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value),
    'OBJECT_COMPARISON_ENVIRONMENT', 'Use the trusted profile password-environment name.');
  return value;
}
function declaration(profile, id) {
  need(plain(profile) && Array.isArray(profile.objectSessions), 'OBJECT_COMPARISON_PROFILE',
    'Select an existing normalized recovery profile.');
  const values = profile.objectSessions.filter(row => row?.id === id);
  need(values.length === 1, 'OBJECT_COMPARISON_SELECTION', 'Select exactly one declared Object backup.');
  const value = values[0];
  need(plain(value) && Array.isArray(value.kinds) && value.kinds.includes('verify'),
    'OBJECT_COMPARISON_PERMISSION', 'The selected Object backup must permit native verification.');
  identifier(value.id, 'Object backup ID');
  absolute(value.bundle, 'backup bundle');
  absolute(value.directory, 'Object session directory');
  absolute(value.stateRoot, 'canonical state root');
  need(typeof value.sessionId === 'string' && value.sessionId.length > 0,
    'OBJECT_COMPARISON_SESSION', 'The trusted declaration must bind the original Object session.');
  if (value.expectedRecordSha256 !== undefined && value.expectedRecordSha256 !== null)
    hash(value.expectedRecordSha256, 'declared backup');
  return value;
}
function sameSource(before, after) {
  need(before.sessionId === after.sessionId && before.directory === after.directory &&
    before.stateRoot === after.stateRoot, 'OBJECT_COMPARISON_SOURCE',
    'Both declared backups must belong to the same original session, directory and canonical state root.');
}
function expected(value, selected, side) {
  const chosen = hash(value, side);
  need(selected.expectedRecordSha256 == null || selected.expectedRecordSha256 === chosen,
    'OBJECT_COMPARISON_RECORD_CHANGED', 'The selected ' + side + ' digest differs from the trusted declaration.');
  return chosen;
}
function privateIdentity(stat) {
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  need(stat.isDirectory() && (stat.mode & 0o077) === 0 && (uid === null || stat.uid === uid),
    'OBJECT_COMPARISON_PRIVATE_DIRECTORY', 'Retain the original private workspace directory and owner.');
  return { dev: stat.dev, ino: stat.ino, uid: stat.uid, mode: stat.mode };
}
async function privateDirectory(path, create = false) {
  absolute(path, 'private evidence directory');
  if (create) await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const stat = await lstat(path);
  need(!stat.isSymbolicLink() && await realpath(path) === path,
    'OBJECT_COMPARISON_PRIVATE_DIRECTORY', 'The private evidence directory must not be redirected.');
  return privateIdentity(stat);
}
function sameDirectory(actual, wanted) {
  need(isDeepStrictEqual(actual, wanted), 'OBJECT_COMPARISON_DIRECTORY_CHANGED',
    'The original private workspace or artifact directory changed; retain the original request.');
}
async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { need((await handle.stat()).isDirectory(), 'OBJECT_COMPARISON_PRIVATE_DIRECTORY'); await handle.sync(); }
  finally { await handle.close(); }
}
function sameFile(before, after) {
  return ['dev', 'ino', 'mode', 'uid', 'gid', 'nlink', 'size', 'mtimeNs', 'ctimeNs']
    .every(key => before[key] === after[key]);
}
async function privateBytes(path, limit) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    const uid = typeof process.getuid === 'function' ? BigInt(process.getuid()) : null;
    need(before.isFile() && before.nlink === 1n && (before.mode & 0o077n) === 0n &&
      (uid === null || before.uid === uid), 'OBJECT_COMPARISON_PRIVATE_FILE',
      'Read the original private regular artifact without a link or changed owner.');
    need(before.size <= BigInt(limit), 'OBJECT_COMPARISON_ARTIFACT_LIMIT',
      'The complete original artifact exceeds the supported byte limit.');
    const chunks = []; let length = 0;
    while (true) {
      // The extra byte detects concurrent growth without an unbounded readFile allocation.
      const block = Buffer.allocUnsafe(Math.min(65536, limit + 1 - length));
      const { bytesRead } = await handle.read(block, 0, block.length, null);
      if (!bytesRead) break;
      length += bytesRead;
      need(length <= limit, 'OBJECT_COMPARISON_ARTIFACT_LIMIT',
        'The complete original artifact grew beyond its supported byte limit.');
      chunks.push(block.subarray(0, bytesRead));
    }
    const after = await handle.stat({ bigint: true });
    need(sameFile(before, after) && BigInt(length) === before.size,
      'OBJECT_COMPARISON_ARTIFACT_CHANGED', 'The original artifact changed during its complete read.');
    return Buffer.concat(chunks, length);
  } finally { await handle.close(); }
}
function utf8(bytes) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  need(Buffer.from(text, 'utf8').equals(bytes), 'OBJECT_COMPARISON_ARTIFACT_ENCODING',
    'Retain the exact original UTF-8 artifact bytes.');
  return text;
}
function errorFacts(error) {
  if (!error) return null;
  const bounded = value => typeof value === 'string' ? value.slice(0, 4096) : null;
  return { name: bounded(error.name), code: bounded(error.code), message: bounded(error.message) };
}
function processFacts(value) {
  const result = {};
  if (!plain(value)) return null;
  for (const name of ['exitCode', 'exitSignal', 'errorCode', 'started', 'cleanupErrorCode']) {
    if (Object.hasOwn(value, name)) {
      const field = value[name];
      result[name] = typeof field === 'string' ? field.slice(0, 4096)
        : field === null || ['number', 'boolean'].includes(typeof field) ? field : null;
    }
  }
  return result;
}
function assertNative(native, review) {
  validateObjectRecoveryComparison(native);
  need(plain(native) && native.schema === NATIVE_SCHEMA && native.status === NATIVE_STATUS &&
    native.authenticated === true, 'OBJECT_COMPARISON_NATIVE_RESULT',
    'The original SDK did not return a complete authenticated Object comparison.');
  need(native.sessionId === review.before.sessionId && native.directory === review.before.directory &&
    native.stateRoot === review.before.stateRoot, 'OBJECT_COMPARISON_NATIVE_SOURCE',
    'The authenticated comparison differs from the reviewed original Object source.');
  hash(native.comparisonSha256, 'comparison');
  need(plain(native.comparison), 'OBJECT_COMPARISON_NATIVE_RESULT', 'Retain the complete native comparison.');
  for (const side of ['before', 'after']) {
    const value = native[side], selected = review[side], expectedHash = review[side + 'ExpectedRecordSha256'];
    need(plain(value) && value.bundle === selected.bundle && value.recordSha256 === expectedHash &&
      plain(value.verification) && plain(value.record) && Array.isArray(value.record.files),
      'OBJECT_COMPARISON_NATIVE_RECORD', 'The authenticated ' + side + ' record differs from its reviewed backup.');
    need(value.verification.recordSha256 === expectedHash &&
      value.verification.directory === selected.directory && value.verification.stateRoot === selected.stateRoot &&
      value.verification.objectSession?.sessionId === selected.sessionId,
      'OBJECT_COMPARISON_NATIVE_VERIFICATION', 'Retain the complete original ' + side + ' verification binding.');
  }
}
function assertPartial(native, review) {
  validateObjectRecoveryComparison(native);
  need(native.authenticated === false &&
    native.status === 'OBJECT_SESSION_BACKUP_COMPARISON_INCOMPLETE',
    'OBJECT_COMPARISON_NATIVE_RESULT', 'Retain the original incomplete comparison.');
  for (const side of ['before', 'after']) {
    const selected = review[side], expectedHash = review[side + 'ExpectedRecordSha256'];
    need(native.selection?.[side]?.bundle === selected.bundle &&
      native.selection?.[side]?.expected === expectedHash,
      'OBJECT_COMPARISON_NATIVE_SELECTION', 'The incomplete comparison differs from the original selection.');
    const value = native[side];
    if (!value) continue;
    need(value.bundle === selected.bundle && value.recordSha256 === expectedHash &&
      value.verification.directory === selected.directory && value.verification.stateRoot === selected.stateRoot &&
      value.verification.objectSession?.sessionId === selected.sessionId &&
      value.record.plan.directory === selected.directory && value.record.plan.stateRoot === selected.stateRoot &&
      value.record.plan.objectSession?.sessionId === selected.sessionId,
      'OBJECT_COMPARISON_NATIVE_SOURCE', 'A completed side differs from its original trusted source.');
  }
}
function summary(native) {
  if (!plain(native) || native.schema !== NATIVE_SCHEMA || native.authenticated !== true) return null;
  return { authenticated: true, sessionId: native.sessionId, directory: native.directory, stateRoot: native.stateRoot,
    comparisonSha256: native.comparisonSha256,
    chronology: clone(native.comparison.chronology), changes: clone(native.comparison.summary),
    before: { recordSha256: native.before?.recordSha256,
      files: native.before?.record?.files?.length ?? null,
      sourceFiles: native.before?.record?.plan?.sourceFiles?.length ?? null },
    after: { recordSha256: native.after?.recordSha256,
      files: native.after?.record?.files?.length ?? null,
      sourceFiles: native.after?.record?.plan?.sourceFiles?.length ?? null } };
}

/** No secondary request journal: the original host queue supplies state/save and its AbortSignal. */
export function createObjectComparisonAdapter({ directory, environment, isClosing = () => false, readOnly = false }) {
  absolute(directory, 'original workspace');
  const root = join(directory, 'object-comparison-artifacts');
  const sdk = new ObjectSessionRecovery({ runtimeDirectory, node: process.execPath, environment });
  const shutdown = new AbortController(), pending = new Set();
  let closed = false, closePromise = null, workspaceIdentity = null, rootIdentity = null, writes = Promise.resolve();
  function available(write) {
    need(!closed && !isClosing(), 'OBJECT_COMPARISON_CLOSED', 'The original workspace is closing.');
    need(!write || !readOnly, 'OBJECT_COMPARISON_READ_ONLY', 'The workspace is read-only; existing artifacts remain available.');
  }
  async function setup(create) {
    const workspace = await privateDirectory(directory);
    if (workspaceIdentity) sameDirectory(workspace, workspaceIdentity); else workspaceIdentity = workspace;
    const original = await privateDirectory(root, create);
    if (rootIdentity) sameDirectory(original, rootIdentity); else rootIdentity = original;
    sameDirectory(await privateDirectory(directory), workspaceIdentity);
    sameDirectory(await privateDirectory(root), rootIdentity);
  }
  function tracked(write, task) {
    available(write);
    const promise = Promise.resolve().then(task);
    pending.add(promise);
    return promise.finally(() => pending.delete(promise));
  }
  function serialized(task) {
    const promise = writes.then(task); writes = promise.catch(() => {});
    return promise;
  }
  async function immutable(path, bytes) {
    // A fixed, content-bound staging name makes both a partial write and the
    // link/unlink crash window recoverable under the original workspace lease.
    const temporary = path + '.publishing';
    await setup(true);
    let handle;
    try {
      try {
        handle = await open(temporary, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        handle = await open(temporary, constants.O_RDWR | constants.O_NOFOLLOW);
      }
      const before = await handle.stat({ bigint: true });
      const uid = typeof process.getuid === 'function' ? BigInt(process.getuid()) : null;
      need(before.isFile() && (before.mode & 0o077n) === 0n &&
        (uid === null || before.uid === uid) && [1n, 2n].includes(before.nlink) &&
        before.size <= BigInt(bytes.length), 'OBJECT_COMPARISON_STAGING_CHANGED',
        'The retained artifact staging differs from its complete expected bytes.');
      if (before.nlink === 2n) {
        const published = await lstat(path, { bigint: true });
        need(published.isFile() && sameFile(before, published) && before.size === BigInt(bytes.length),
          'OBJECT_COMPARISON_STAGING_CHANGED', 'Only the original completed publication link can be resumed.');
      }
      let position = 0;
      while (position < Number(before.size)) {
        const block = Buffer.allocUnsafe(Math.min(65536, Number(before.size) - position));
        const { bytesRead } = await handle.read(block, 0, block.length, position);
        need(bytesRead > 0 && block.subarray(0, bytesRead).equals(bytes.subarray(position, position + bytesRead)),
          'OBJECT_COMPARISON_STAGING_CHANGED', 'The original staging prefix differs; it was preserved.');
        position += bytesRead;
      }
      need(sameFile(before, await handle.stat({ bigint: true })), 'OBJECT_COMPARISON_STAGING_CHANGED');
      while (position < bytes.length) {
        const { bytesWritten } = await handle.write(bytes, position, Math.min(65536, bytes.length - position), position);
        need(bytesWritten > 0, 'OBJECT_COMPARISON_ARTIFACT_WRITE');
        position += bytesWritten;
      }
      await handle.sync();
      const complete = await handle.stat({ bigint: true });
      need(complete.size === BigInt(bytes.length) &&
        ['dev', 'ino', 'mode', 'uid', 'gid', 'nlink'].every(key => complete[key] === before[key]),
        'OBJECT_COMPARISON_STAGING_CHANGED');
      await setup(false);
      need(sameFile(complete, await lstat(temporary, { bigint: true })), 'OBJECT_COMPARISON_STAGING_CHANGED');
      try { await link(temporary, path); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      const staged = await handle.stat({ bigint: true });
      const visible = await lstat(temporary, { bigint: true });
      need(sameFile(staged, visible), 'OBJECT_COMPARISON_STAGING_CHANGED');
      // Remove only this exact verified staging name, including the original
      // completed second link recovered after a lost publication response.
      await unlink(temporary);
    } finally { await handle?.close(); }
    const actual = await privateBytes(path, Math.max(bytes.length, 1));
    need(actual.equals(bytes), 'OBJECT_COMPARISON_ARTIFACT_CONFLICT',
      'The original content-addressed artifact contains different bytes.');
    await syncDirectory(root); await setup(false);
  }
  function retain(text, mediaType) {
    need(typeof text === 'string' && MEDIA.has(mediaType), 'OBJECT_COMPARISON_ARTIFACT_TYPE',
      'Retain the full JSON, HTML or Markdown text.');
    const bytes = Buffer.from(text, 'utf8');
    need(bytes.length <= OBJECT_COMPARISON_ARTIFACT_BYTES, 'OBJECT_COMPARISON_ARTIFACT_LIMIT',
      'The complete artifact exceeds 256 MiB; no truncated artifact was published.');
    const sha256 = digest(bytes), identity = { sha256, bytes: bytes.length, mediaType };
    return serialized(async () => {
      await immutable(join(root, sha256 + '.data'), bytes);
      const metadata = Buffer.from(JSON.stringify({ schema: ARTIFACT_SCHEMA, ...identity }) + '\n');
      await immutable(join(root, sha256 + '.json'), metadata);
      return identity;
    });
  }
  function review(profile, input) {
    available(false);
    need(plain(input) && Object.keys(input).every(key => REVIEW_FIELDS.has(key)),
      'OBJECT_COMPARISON_INPUT', 'Use only the declared Object comparison selection fields.');
    need(input.action === 'object-compare' && input.profileId === profile?.id,
      'OBJECT_COMPARISON_PROFILE', 'Select the original profile and comparison action.');
    identifier(input.id, 'request ID');
    const before = declaration(profile, input.beforeObjectSessionId);
    const after = declaration(profile, input.afterObjectSessionId);
    sameSource(before, after);
    return { profileId: profile.id, before: clone(before), after: clone(after),
      beforeExpectedRecordSha256: expected(input.beforeExpectedRecordSha256, before, 'before'),
      afterExpectedRecordSha256: expected(input.afterExpectedRecordSha256, after, 'after'),
      passEnv: passEnv(profile) };
  }
  function binding(profile, selected) {
    need(plain(selected) && selected.profileId === profile?.id &&
      selected.passEnv === passEnv(profile), 'OBJECT_COMPARISON_REVIEW_CHANGED',
      'The original profile or password-environment selection changed; review the original request.');
    const before = declaration(profile, selected.before?.id);
    const after = declaration(profile, selected.after?.id);
    need(isDeepStrictEqual(before, selected.before) && isDeepStrictEqual(after, selected.after),
      'OBJECT_COMPARISON_REVIEW_CHANGED', 'The trusted declarations differ from the original saved review.');
    sameSource(before, after);
    expected(selected.beforeExpectedRecordSha256, before, 'before');
    expected(selected.afterExpectedRecordSha256, after, 'after');
    return clone(selected);
  }
  async function artifact(sha256) {
    return tracked(false, async () => {
      hash(sha256, 'artifact');
      await setup(false);
      const metadataBytes = await privateBytes(join(root, sha256 + '.json'), 4096);
      const metadata = JSON.parse(utf8(metadataBytes));
      need(plain(metadata) && metadata.schema === ARTIFACT_SCHEMA && metadata.sha256 === sha256 &&
        Number.isSafeInteger(metadata.bytes) && metadata.bytes >= 0 && metadata.bytes <= OBJECT_COMPARISON_ARTIFACT_BYTES &&
        MEDIA.has(metadata.mediaType) && Object.keys(metadata).length === 4,
        'OBJECT_COMPARISON_ARTIFACT_IDENTITY', 'The saved artifact metadata differs from its original identity.');
      const bytes = await privateBytes(join(root, sha256 + '.data'), OBJECT_COMPARISON_ARTIFACT_BYTES);
      need(bytes.length === metadata.bytes && digest(bytes) === sha256,
        'OBJECT_COMPARISON_ARTIFACT_IDENTITY', 'The complete saved artifact differs from its original bytes or digest.');
      const text = utf8(bytes);
      await setup(false);
      return { sha256, bytes: bytes.length, mediaType: metadata.mediaType, text };
    });
  }
  async function run({ profile, id, review: selected, state, save, signal, cancelled = () => false }) {
    return tracked(true, async () => {
      identifier(id, 'request ID');
      need(plain(state ?? {}) && typeof save === 'function', 'OBJECT_COMPARISON_STATE',
        'Use the original request local state and persistence callback.');
      const local = clone(state ?? {});
      need(local.objectComparisonEvidence === undefined || Array.isArray(local.objectComparisonEvidence),
        'OBJECT_COMPARISON_STATE', 'Preserve the original comparison evidence history.');
      const frozen = binding(profile, selected);
      await setup(true);
      const combined = AbortSignal.any([shutdown.signal, ...(signal ? [signal] : [])]);
      const artifacts = {}, publicationErrors = [];
      let sdkResult = null, failure = null, bindingFailure = null, report = null;
      try {
        need(!combined.aborted && !cancelled(), 'OPERATOR_ABORTED', 'The original comparison was cancelled before dispatch.');
        sdkResult = await sdk.compare({
          before: { bundle: frozen.before.bundle, expectedRecordSha256: frozen.beforeExpectedRecordSha256,
            ...(frozen.passEnv === null ? {} : { passphraseEnv: frozen.passEnv }) },
          after: { bundle: frozen.after.bundle, expectedRecordSha256: frozen.afterExpectedRecordSha256,
            ...(frozen.passEnv === null ? {} : { passphraseEnv: frozen.passEnv }) },
          signal: combined
        });
      } catch (error) {
        failure = error;
        if (plain(error.result)) sdkResult = error.result;
      }
      // SDK compare settles only after its original child and private native lifetime are drained.
      const partial = sdkResult?.native?.partialComparison ?? sdkResult?.partialComparison;
      try {
        if (sdkResult?.native?.status === NATIVE_STATUS) {
          assertNative(sdkResult.native, frozen); report = sdkResult.native;
        } else if (partial) {
          assertPartial(partial, frozen); report = partial;
        } else if (sdkResult?.ok === true) assertNative(sdkResult.native, frozen);
      } catch (error) { bindingFailure = error; failure ??= error; }
      if (sdkResult?.ok !== true && !failure) failure = issue('OBJECT_COMPARISON_INTERRUPTED',
        'The original comparison did not report a clean native completion.');
      const evidence = sdkResult ?? { operation: 'compare', native: null, process: null,
        completionReported: false, ok: false, adapterFailure: errorFacts(failure) };
      try { artifacts.result = await retain(JSON.stringify(evidence) + '\n', 'application/json'); }
      catch (error) { publicationErrors.push({ stage: 'result', ...errorFacts(error) }); failure ??= error; }
      if (report && !bindingFailure) {
        for (const [kind, mediaType] of [['html', 'text/html'], ['markdown', 'text/markdown']]) {
          try {
            const text = await renderObjectRecoveryComparison(report, { format: kind });
            artifacts[kind] = await retain(text, mediaType);
          } catch (error) {
            publicationErrors.push({ stage: kind, ...errorFacts(error) }); failure ??= error;
          }
        }
      }
      const ok = sdkResult?.ok === true && !failure && !!artifacts.result && !!artifacts.html && !!artifacts.markdown;
      const outcome = { status: ok ? 'COMPLETE' : 'INTERRUPTED', command: 'object-compare', ok,
        completionReported: sdkResult?.completionReported === true, process: processFacts(sdkResult?.process),
        beforeObjectSessionId: frozen.before.id, afterObjectSessionId: frozen.after.id,
        beforeExpectedRecordSha256: frozen.beforeExpectedRecordSha256,
        afterExpectedRecordSha256: frozen.afterExpectedRecordSha256,
        sessionId: frozen.before.sessionId, summary: bindingFailure ? null : summary(report),
        partial: report?.authenticated === false ? {
          status: report.status, failedSide: report.failedSide, errorCode: report.errorCode,
          partialComparisonSha256: report.partialComparisonSha256,
          completedSides: ['before', 'after'].filter(side => !!report[side])
        } : null,
        artifacts, error: errorFacts(failure), bindingError: errorFacts(bindingFailure), publicationErrors,
        partialComparisonRetained: !!artifacts.result &&
          !!(sdkResult?.partialComparison || sdkResult?.native?.partialComparison) };
      local.objectComparisonEvidence = [...(local.objectComparisonEvidence ?? []),
        { observedAt: new Date().toISOString(), artifacts: clone(artifacts), status: outcome.status,
          completionReported: outcome.completionReported }];
      local.objectComparisonLastResult = clone(outcome);
      try { await save(local); }
      catch (error) {
        outcome.status = 'INTERRUPTED'; outcome.ok = false;
        outcome.statePublicationError = errorFacts(error); failure ??= error;
        outcome.error = errorFacts(failure);
        local.objectComparisonLastResult = clone(outcome);
      }
      if (failure) {
        const error = issue(failure.code ?? 'OBJECT_COMPARISON_INTERRUPTED',
          failure.message ?? 'The original comparison was interrupted; retain its complete evidence.');
        error.objectComparisonResult = outcome;
        throw error;
      }
      return outcome;
    });
  }
  function close() {
    if (closePromise) return closePromise;
    closed = true; shutdown.abort();
    closePromise = (async () => {
      await Promise.allSettled([...pending]);
      await writes;
    })();
    return closePromise;
  }
  return Object.freeze({ review, binding, run, artifact, close });
}
