// MIT. Local capture and verification through the original SF101 recovery engine.
import { constants } from 'node:fs';
import { lstat, open, rename, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { CAPTURE_MARKER, inspectSnapshotPlan, run as recover } from '../recover.mjs';

const CAPTURE_SCHEMA = 'stellar-forge.merchant-recovery-capture.v1';
const BUNDLE_SCHEMA = 'stellar-forge.merchant-recovery.v1';
export const RETIRED_CAPTURE_PREFIX = '.sf101-interrupted-capture-';
const HEX = /^[a-f0-9]{64}$/;
const MAX_MANIFEST = 12 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const stamp = () => new Date().toISOString();
const inside = (parent, child) => parent === child || child.startsWith(parent + sep);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const fail = (code, message = code) => Object.assign(new Error(message), { code });
function need(value, code, message) { if (!value) throw fail(code, message); }
function absolute(value, name) {
  need(typeof value === 'string' && isAbsolute(value) && !value.includes('\0') &&
    resolve(value) === value, 'WORKSPACE_LOCAL_PATH_INVALID', name + ' must be an absolute normalized path');
  return value;
}
async function exists(path) {
  try { await lstat(path); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function privateDirectory(path) {
  const info = await lstat(path);
  need(info.isDirectory() && !info.isSymbolicLink() && (info.mode & 0o077) === 0 &&
    await realpath(path) === path,
    'WORKSPACE_LOCAL_DIRECTORY_INVALID', 'Keep the original private directory: ' + path);
}
async function privateBytes(path, maximum = MAX_MANIFEST) {
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await fd.stat();
    need(info.isFile() && info.nlink === 1 && (info.mode & 0o077) === 0 && info.size <= maximum,
      'WORKSPACE_LOCAL_FILE_INVALID', 'Keep the original private regular file: ' + path);
    const bytes = await fd.readFile();
    need(bytes.length === info.size && bytes.length <= maximum, 'WORKSPACE_LOCAL_FILE_CHANGED');
    return bytes;
  } finally { await fd.close(); }
}
async function syncDirectory(path) {
  const fd = await open(path, constants.O_RDONLY | constants.O_DIRECTORY);
  try { await fd.sync(); } finally { await fd.close(); }
}
function binding(options) {
  need(HEX.test(options.captureId ?? '') && HEX.test(options.expectedPlanSha256 ?? ''),
    'WORKSPACE_CAPTURE_BINDING_INVALID');
  return { schema: CAPTURE_SCHEMA, id: options.captureId, planSha256: options.expectedPlanSha256 };
}
function sameBinding(value, expected) {
  return object(value) && value.schema === expected.schema && value.id === expected.id &&
    value.planSha256 === expected.planSha256 &&
    Object.keys(value).every(key => ['schema', 'id', 'planSha256'].includes(key));
}

export async function inspectLocalCapture({ plan, out, forbiddenRoots = [] } = {}) {
  absolute(plan, 'Original snapshot plan'); absolute(out, 'Bundle destination');
  const selected = await inspectSnapshotPlan({ plan, out });
  for (const root of selected.roots) {
    need(await realpath(root.path) === root.path, 'WORKSPACE_CAPTURE_SOURCE_PATH_CHANGED',
      'Select the original real source path in the host snapshot plan');
    for (const forbidden of forbiddenRoots)
      need(!inside(root.path, forbidden) && !inside(forbidden, root.path),
        'WORKSPACE_CAPTURE_CONTROL_OVERLAP', 'A capture source cannot include its active recovery workspace');
  }
  return selected;
}

// This is a structural selection read. Authentication remains in recover verify.
export async function readCapturedBundle(options) {
  absolute(options.out, 'Bundle destination');
  const expected = binding(options);
  if (!await exists(options.out)) return null;
  await privateDirectory(options.out);
  const manifestPath = join(options.out, 'manifest.json');
  if (!await exists(manifestPath)) return null;
  const raw = await privateBytes(manifestPath);
  let manifest;
  try { manifest = JSON.parse(raw.toString('utf8')); }
  catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  need(object(manifest) && manifest.schema === BUNDLE_SCHEMA && sameBinding(manifest.capture, expected),
    'WORKSPACE_CAPTURE_DESTINATION_DIFFERENT',
    'The destination contains a different original snapshot; keep it and select another capture destination');
  need(Number.isSafeInteger(manifest.fileCount) && manifest.fileCount >= 0 &&
    Number.isSafeInteger(manifest.totalPlainBytes) && manifest.totalPlainBytes >= 0 &&
    Array.isArray(manifest.roots), 'WORKSPACE_CAPTURE_MANIFEST_INVALID');
  return { raw, manifest, snapshotId: hash(raw) };
}
async function ownedPartial(path, options) {
  await privateDirectory(path);
  const marker = join(path, CAPTURE_MARKER);
  need(await exists(marker), 'WORKSPACE_CAPTURE_OWNER_MISSING',
    'Preserve this unmarked directory and select a new capture ID and destination');
  let value;
  try { value = JSON.parse((await privateBytes(marker, 4096)).toString('utf8')); }
  catch { throw fail('WORKSPACE_CAPTURE_OWNER_INVALID', 'Preserve the interrupted capture marker'); }
  need(sameBinding(value, binding(options)), 'WORKSPACE_CAPTURE_OWNER_DIFFERENT',
    'The interrupted directory belongs to another capture');
}
async function retainInterrupted(options, state, save) {
  if (!state.pendingRetirement) {
    await ownedPartial(options.out, options);
    const retained = join(dirname(options.out), RETIRED_CAPTURE_PREFIX +
      options.captureId.slice(0, 12) + '-' + randomUUID());
    need(!await exists(retained), 'WORKSPACE_CAPTURE_RETENTION_EXISTS');
    state.pendingRetirement = { from: options.out, directory: retained,
      captureId: options.captureId, planSha256: options.expectedPlanSha256,
      selectedAt: stamp(), attempt: state.captureAttempts ?? 0 };
    await save();
  }
  const transition = state.pendingRetirement;
  need(transition.from === options.out && transition.captureId === options.captureId &&
    transition.planSha256 === options.expectedPlanSha256 &&
    dirname(transition.directory) === dirname(options.out) &&
    transition.directory.startsWith(join(dirname(options.out), RETIRED_CAPTURE_PREFIX)),
    'WORKSPACE_CAPTURE_RETENTION_CHANGED');
  const sourcePresent = await exists(options.out), retainedPresent = await exists(transition.directory);
  need(!(sourcePresent && retainedPresent), 'WORKSPACE_CAPTURE_RETENTION_AMBIGUOUS',
    'Both original and retained capture directories exist; preserve their original paths');
  if (sourcePresent) {
    await ownedPartial(options.out, options);
    await rename(options.out, transition.directory);
    await syncDirectory(dirname(options.out));
  } else {
    need(retainedPresent, 'WORKSPACE_CAPTURE_RETENTION_MISSING', 'Preserve the selected interrupted capture');
    await ownedPartial(transition.directory, options);
  }
  state.retainedCaptures ??= [];
  if (!state.retainedCaptures.some(item => item.directory === transition.directory))
    state.retainedCaptures.push({ ...transition, retainedAt: stamp() });
  state.pendingRetirement = null; state.creationIntent = false;
  state.progress = 'INTERRUPTED_CAPTURE_RETAINED';
  await save();
}
function captureResult(options, found, state, verification) {
  return { status: verification ? 'COMPLETE' : 'INTERRUPTED', command: 'snapshot',
    snapshotId: found.snapshotId, bundle: options.out, files: found.manifest.fileCount,
    plainBytes: found.manifest.totalPlainBytes, roots: found.manifest.roots.map(item => item.name),
    capture: { ...found.manifest.capture }, verified: Boolean(verification),
    original: { snapshot: state.originalSnapshot ?? null, verification: verification ?? null },
    retainedCaptures: [...(state.retainedCaptures ?? [])] };
}

export async function runLocalCapture({ options, state, save, cancelled = () => false,
  allowCapture = false } = {}) {
  need(object(options) && object(state) && typeof save === 'function', 'WORKSPACE_CAPTURE_REQUEST_INVALID');
  absolute(options.plan, 'Original snapshot plan'); absolute(options.out, 'Bundle destination');
  const expected = binding(options);
  await privateDirectory(dirname(options.out));
  if (state.pendingRetirement) {
    need(allowCapture, 'WORKSPACE_CAPTURE_REVIEW_REQUIRED',
      'Review the same capture and confirm that its original source producers are quiesced');
    await retainInterrupted(options, state, save);
  }
  let found = await readCapturedBundle(options);
  if (!found && await exists(options.out)) {
    need(state.creationIntent === true, 'WORKSPACE_CAPTURE_DESTINATION_EXISTS',
      'Select a new bundle destination; this existing directory is not owned by this capture');
    need(allowCapture, 'WORKSPACE_CAPTURE_REVIEW_REQUIRED',
      'Review the same capture and confirm that its original source producers are quiesced');
    await retainInterrupted(options, state, save);
  }
  if (!found) {
    need(allowCapture, 'WORKSPACE_CAPTURE_REVIEW_REQUIRED',
      'Review the same capture and confirm that its original source producers are quiesced');
    if (cancelled()) return { status: 'INTERRUPTED', command: 'snapshot',
      snapshotId: null, bundle: options.out, verified: false, retainedCaptures: [...(state.retainedCaptures ?? [])] };
    state.creationIntent = true; state.captureAttempts = (state.captureAttempts ?? 0) + 1;
    state.progress = 'CAPTURING'; await save();
    state.originalSnapshot = await recover(['snapshot', '--plan', options.plan, '--out', options.out,
      '--pass-env', options.passEnv, '--quiesced', '--capture-id', expected.id,
      '--expected-plan-sha256', expected.planSha256]);
    state.progress = 'CAPTURED'; await save();
    found = await readCapturedBundle(options);
    need(found, 'WORKSPACE_CAPTURE_MANIFEST_MISSING');
  }
  // A complete native bundle is authenticated before a lost completion is adopted.
  // The source may have legitimately changed after that original capture finished.
  if (cancelled()) return captureResult(options, found, state, null);
  state.progress = 'VERIFYING'; await save();
  const verified = await recover(['verify', '--bundle', options.out, '--pass-env', options.passEnv]);
  const current = await readCapturedBundle(options);
  need(current && current.snapshotId === found.snapshotId &&
    verified.status === 'SNAPSHOT_VERIFIED' && verified.files === found.manifest.fileCount &&
    verified.bytes === found.manifest.totalPlainBytes, 'WORKSPACE_CAPTURE_VERIFICATION_CHANGED');
  state.progress = 'VERIFIED'; state.snapshotId = found.snapshotId; state.verifiedAt = stamp();
  await save();
  return captureResult(options, found, state, verified);
}

export async function runLocalVerification({ options, state, save, cancelled = () => false } = {}) {
  need(object(options) && object(state) && typeof save === 'function' && HEX.test(options.snapshotId ?? ''),
    'WORKSPACE_LOCAL_VERIFICATION_INVALID');
  absolute(options.bundle, 'Original bundle'); await privateDirectory(options.bundle);
  need(hash(await privateBytes(join(options.bundle, 'manifest.json'))) === options.snapshotId,
    'WORKSPACE_ORIGINAL_SNAPSHOT_CHANGED');
  if (cancelled()) return { status: 'INTERRUPTED', command: 'local-verify',
    snapshotId: options.snapshotId, bundle: options.bundle, verified: false };
  state.progress = 'VERIFYING'; await save();
  const verified = await recover(['verify', '--bundle', options.bundle, '--pass-env', options.passEnv]);
  need(hash(await privateBytes(join(options.bundle, 'manifest.json'))) === options.snapshotId &&
    verified.status === 'SNAPSHOT_VERIFIED', 'WORKSPACE_ORIGINAL_SNAPSHOT_CHANGED');
  state.progress = 'VERIFIED'; state.verifiedAt = stamp(); await save();
  return { status: 'COMPLETE', command: 'local-verify', snapshotId: options.snapshotId,
    bundle: options.bundle, files: verified.files, plainBytes: verified.bytes,
    verified: true, original: { verification: verified } };
}
