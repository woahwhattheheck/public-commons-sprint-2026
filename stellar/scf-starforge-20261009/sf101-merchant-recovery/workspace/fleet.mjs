// MIT. Workspace binding for the original deployed-fleet receiving operation.
import { join } from 'node:path';
import { absolute, identity, object, fault } from '../../sf30-seller-sdk/postgres/publisher/files.mjs';

const RECEIVING_SCHEMA = 'stellar-forge.fleet-recovery-receiving.v1';
const WORKSPACE_SCHEMA = 'stellar-forge.workspace-fleet-preparation.v1';
const HEX = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;
const validId = value => typeof value === 'string' && ID.test(value);
const ROOT_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const stamp = () => new Date().toISOString();
const copy = value => structuredClone(value);
const inside = (parent, child) => parent === child || child.startsWith(parent + '/');
const need = (ok, code, message = code) => {
  if (!ok) throw fault(code, message, 409);
};

function sourceIdentity(options) {
  const fleet = options.sourceFleetRestoreId !== undefined;
  const generic = options.sourceRestoreId !== undefined;
  need(fleet !== generic, 'WORKSPACE_FLEET_RESTORE_SELECTION_INVALID',
    'Select exactly one original fleet restore or original generic cold restore.');
  const key = fleet ? 'sourceFleetRestoreId' : 'sourceRestoreId';
  need(validId(options[key]), 'WORKSPACE_FLEET_RESTORE_SELECTION_INVALID');
  return { [key]: options[key] };
}

function fleetInput(options) {
  need(object(options) && HEX.test(options.snapshotId ?? '') && typeof options.passEnv === 'string' &&
    /^[A-Z][A-Z0-9_]{4,63}$/.test(options.passEnv ?? ''),
    'WORKSPACE_FLEET_RESTORE_SELECTION_INVALID');
  const input = {
    bundleDirectory: absolute(options.bundle, 'original encrypted bundle'),
    restoreDirectory: absolute(options.out, 'completed original cold restore'),
    passphraseEnv: options.passEnv,
    expectedManifestSha256: options.snapshotId,
    targetFile: absolute(options.targetFile, 'original private receiving target declaration'),
    operationDirectory: absolute(options.operationDirectory, 'original native receiving operation'),
  };
  return input;
}

function preparationSelection(options) {
  const input = fleetInput(options);
  need(options.command === 'fleet-prepare' && validId(options.id) &&
    validId(options.fleetTargetId) &&
    HEX.test(options.expectedReviewSha256 ?? '') && HEX.test(options.fleetOperationId ?? ''),
    'WORKSPACE_FLEET_PREPARATION_INVALID');
  need(options.quiesced === true, 'WORKSPACE_FLEET_QUIESCENCE_REQUIRED',
    'Confirm that the receiving fleet and selected source writers remain stopped.');
  return { command: 'fleet-prepare', id: options.id,
    bundle: input.bundleDirectory, out: input.restoreDirectory, passEnv: input.passphraseEnv,
    snapshotId: input.expectedManifestSha256, targetFile: input.targetFile,
    operationDirectory: input.operationDirectory, ...sourceIdentity(options),
    fleetTargetId: options.fleetTargetId, expectedReviewSha256: options.expectedReviewSha256,
    fleetOperationId: options.fleetOperationId, quiesced: true };
}

function preparedResult(prepared, inspected) {
  const review = inspected.review;
  need(object(prepared) && prepared.status === 'FLEET_RECEIVING_COMPLETE' &&
    prepared.operationId === inspected.operationId &&
    prepared.reviewSha256 === inspected.reviewSha256 &&
    prepared.snapshotId === review.snapshotId &&
    prepared.sourcePlanSha256 === review.sourcePlanSha256 &&
    prepared.profileSha256 === review.profileSha256 &&
    prepared.operationDirectory === review.operationDirectory &&
    prepared.deploymentBundle === review.deploymentBundle &&
    prepared.serviceUid === review.serviceUid && prepared.serviceGid === review.serviceGid &&
    prepared.fleet === inspected.summary.fleet && prepared.planDigest === inspected.summary.planDigest &&
    object(prepared.summary) && identity(prepared.summary) === identity(inspected.summary),
    'WORKSPACE_FLEET_PREPARATION_RESULT_CHANGED');
  const roots = review.roots.map(root => ({ name: root.name, path: root.destination,
    kind: root.kind, source: copy(root.source) }));
  need(Array.isArray(prepared.roots) && identity(prepared.roots) === identity(roots),
    'WORKSPACE_FLEET_PREPARATION_ROOTS_CHANGED',
    'Retain every original root path and its authenticated source tree.');
  absolute(prepared.originalDeploymentBundle, 'original captured deployment bundle');
  need(review.roots.some(root => inside(root.destination, prepared.originalDeploymentBundle)) &&
    prepared.originalDeploymentBundle !== prepared.deploymentBundle,
    'WORKSPACE_FLEET_PREPARATION_RESULT_CHANGED');
  need(object(prepared.runtime) && prepared.runtime.sourceRoot === review.sourceRoot &&
    prepared.runtime.workspacePort === inspected.summary.workspacePort &&
    typeof prepared.runtime.unit === 'string' && prepared.runtime.unit.length > 0 &&
    typeof prepared.completedAt === 'string' && Number.isFinite(Date.parse(prepared.completedAt)),
    'WORKSPACE_FLEET_PREPARATION_RESULT_CHANGED');
  absolute(prepared.runtime.node, 'original receiving Node runtime');
  return prepared;
}

function checkedReview(native, input) {
  need(object(native) && ['FLEET_RECEIVING_REVIEW', 'FLEET_RECEIVING_COMPLETE'].includes(native.status) &&
    object(native.review) && HEX.test(native.reviewSha256 ?? '') &&
    identity(native.review) === native.reviewSha256,
    'WORKSPACE_FLEET_RESTORE_REVIEW_CHANGED');
  const review = native.review;
  need(review.schema === RECEIVING_SCHEMA &&
    review.snapshotId === input.expectedManifestSha256 &&
    review.bundleDirectory === input.bundleDirectory &&
    review.restoreDirectory === input.restoreDirectory &&
    review.targetFile === input.targetFile && review.operationDirectory === input.operationDirectory &&
    HEX.test(review.sourcePlanSha256 ?? '') && HEX.test(review.profileSha256 ?? '') &&
    HEX.test(review.targetSha256 ?? '') &&
    Number.isSafeInteger(review.serviceUid) && review.serviceUid > 0 &&
    Number.isSafeInteger(review.serviceGid) && review.serviceGid > 0,
    'WORKSPACE_FLEET_RESTORE_BINDINGS_REQUIRED');
  absolute(review.sourceRoot, 'original installed fleet source');
  absolute(review.deploymentBundle, 'reviewed new deployment bundle');
  need(Array.isArray(review.destinationParents) && review.destinationParents.length > 0 &&
    Array.isArray(review.roots) && review.roots.length > 0 &&
    new Set(review.roots.map(root => root?.name)).size === review.roots.length,
    'WORKSPACE_FLEET_RESTORE_BINDINGS_REQUIRED');
  for (const parent of review.destinationParents) absolute(parent, 'reviewed private receiving parent');
  for (const root of review.roots) {
    need(object(root) && ROOT_NAME.test(root.name ?? '') &&
      ['file', 'directory'].includes(root.kind) && object(root.source) &&
      root.source.kind === root.kind && HEX.test(root.source.sha256 ?? '') &&
      ['files', 'directories', 'bytes'].every(key =>
        Number.isSafeInteger(root.source[key]) && root.source[key] >= 0),
      'WORKSPACE_FLEET_RESTORE_ROOTS_CHANGED');
    absolute(root.path, 'original fleet root');
    absolute(root.destination, 'reviewed receiving root');
    absolute(root.restored, 'authenticated restored root');
    need(root.destination === root.path && root.restored === join(input.restoreDirectory, root.name),
      'WORKSPACE_FLEET_RESTORE_ROOTS_CHANGED',
      'Receiving keeps each captured absolute root path and its original restored member.');
  }
  need(object(native.summary) && HEX.test(native.summary.planDigest ?? '') &&
    native.summary.serviceUid === review.serviceUid && native.summary.serviceGid === review.serviceGid &&
    Array.isArray(native.availability) && native.availability.length === review.roots.length,
    'WORKSPACE_FLEET_RESTORE_REVIEW_CHANGED');
  for (let i = 0; i < review.roots.length; i++) {
    const row = native.availability[i], root = review.roots[i];
    need(object(row) && row.name === root.name && row.destination === root.destination &&
      typeof row.state === 'string' && row.state.length > 0,
      'WORKSPACE_FLEET_RESTORE_REVIEW_CHANGED');
  }
  // Use the engine's original canonical helper and its exact receiving rule.
  const operationId = identity({ purpose: 'receive-original-fleet', reviewSha256: native.reviewSha256 });
  if (native.operation !== null) {
    need(object(native.operation) && native.operation.operationId === operationId &&
      ['PLACING', 'GENERATING', 'COMPLETE'].includes(native.operation.phase),
      'WORKSPACE_FLEET_RESTORE_OPERATION_CHANGED');
  }
  if (native.operationId !== undefined)
    need(native.operationId === operationId, 'WORKSPACE_FLEET_RESTORE_OPERATION_CHANGED');
  const inspected = { ...native, operationId: native.operation?.operationId ?? operationId };
  if (native.status === 'FLEET_RECEIVING_COMPLETE') {
    need(native.operation?.phase === 'COMPLETE', 'WORKSPACE_FLEET_RESTORE_OPERATION_CHANGED');
    preparedResult(native.operation.result, inspected);
  } else {
    need(native.operation === null || (native.operation.result === null &&
      native.operation.phase !== 'COMPLETE'), 'WORKSPACE_FLEET_RESTORE_OPERATION_CHANGED');
  }
  return inspected;
}

/** Authenticate the original cold restore and inspect its native target review.
 * Native review, summary, availability and operation fields remain unchanged.
 * operationId is added from the exact same canonical rule as the engine. */
export async function inspectLocalFleetRestore(options) {
  const input = fleetInput(options);
  const { inspectRestoredFleet } = await import('../../merchant-fleet-gateway/recovery.mjs');
  return checkedReview(await inspectRestoredFleet(input), input);
}

function serviceIdentity(review) {
  need(process.platform === 'linux' && typeof process.getuid === 'function' &&
    typeof process.getgid === 'function', 'WORKSPACE_FLEET_SERVICE_IDENTITY_REQUIRED',
    'Use the original Linux service account for native receiving.');
  const actual = { uid: process.getuid(), gid: process.getgid() };
  need(actual.uid === review.serviceUid && actual.gid === review.serviceGid,
    'WORKSPACE_FLEET_SERVICE_IDENTITY_REQUIRED',
    'Run receiving as the captured service UID ' + review.serviceUid +
      ' and GID ' + review.serviceGid + '.');
  return actual;
}

function retainedJournal(state, selected) {
  const selectionSha256 = identity(selected);
  if (state.fleetPreparation !== undefined) {
    const prior = state.fleetPreparation;
    need(object(prior) && prior.schema === WORKSPACE_SCHEMA &&
      prior.selectionSha256 === selectionSha256 && object(prior.selection) &&
      identity(prior.selection) === selectionSha256 &&
      prior.operationId === selected.fleetOperationId &&
      prior.reviewSha256 === selected.expectedReviewSha256,
      'WORKSPACE_FLEET_PREPARATION_SELECTION_CHANGED',
      'Resume this workspace operation with its original source, target and native review.');
    return prior;
  }
  const journal = { schema: WORKSPACE_SCHEMA, selection: copy(selected), selectionSha256,
    operationId: selected.fleetOperationId, reviewSha256: selected.expectedReviewSha256,
    phase: 'VERIFYING', selectedAt: stamp() };
  state.fleetPreparation = journal;
  return journal;
}

/** Save outer phases around the existing native receiving operation.
 * This adapter never creates an alternate deployment or rewrites restored roots.
 * Native receiving.json remains the authority for an interrupted invocation. */
export async function runLocalFleetPreparation({ options, state, save,
  cancelled = () => false } = {}) {
  need(object(state) && typeof save === 'function' && typeof cancelled === 'function',
    'WORKSPACE_FLEET_PREPARATION_INVALID');
  // Capture every selected value before any asynchronous inspection or save.
  const selected = preparationSelection(options), input = fleetInput(selected);
  const source = sourceIdentity(selected);
  const interrupted = () => ({ status: 'INTERRUPTED', command: 'fleet-prepare',
    snapshotId: selected.snapshotId, bundle: selected.bundle, destination: selected.out,
    ...source, fleetTargetId: selected.fleetTargetId, fleetOperationId: selected.fleetOperationId,
    reviewSha256: selected.expectedReviewSha256, operationDirectory: selected.operationDirectory });
  const journal = retainedJournal(state, selected);
  if (cancelled()) return interrupted();
  state.progress = 'VERIFYING_RESTORED_FLEET'; await save();
  const inspected = await inspectLocalFleetRestore(selected);
  need(inspected.reviewSha256 === selected.expectedReviewSha256 &&
    inspected.operationId === selected.fleetOperationId,
    'WORKSPACE_FLEET_PREPARATION_REVIEW_CHANGED');
  if (journal.review !== undefined)
    need(identity(journal.review) === inspected.reviewSha256,
      'WORKSPACE_FLEET_PREPARATION_REVIEW_CHANGED');
  if (journal.summary !== undefined)
    need(identity(journal.summary) === identity(inspected.summary),
      'WORKSPACE_FLEET_PREPARATION_REVIEW_CHANGED');
  journal.review = copy(inspected.review); journal.summary = copy(inspected.summary);
  journal.availability = copy(inspected.availability);
  journal.nativeOperation = copy(inspected.operation);
  journal.phase = inspected.operation?.phase ?? 'REVIEWED';
  journal.inspectedAt = stamp();
  await save();
  let prepared;
  if (inspected.status === 'FLEET_RECEIVING_COMPLETE') {
    // A lost outer acknowledgement reopens this exact completed native result.
    prepared = inspected.operation.result;
  } else {
    if (cancelled()) return interrupted();
    const { prepareRestoredFleet } = await import('../../merchant-fleet-gateway/recovery.mjs');
    if (cancelled()) return interrupted();
    journal.serviceIdentity = serviceIdentity(inspected.review);
    journal.preparationRequestedAt ??= stamp();
    state.progress = 'PREPARING_RESTORED_FLEET'; await save();
    // Cancellation during the save cannot cross the native preparation boundary.
    if (cancelled()) return interrupted();
    const actual = serviceIdentity(inspected.review);
    need(identity(actual) === identity(journal.serviceIdentity),
      'WORKSPACE_FLEET_SERVICE_IDENTITY_REQUIRED');
    prepared = await prepareRestoredFleet({ ...input,
      expectedReviewSha256: selected.expectedReviewSha256, quiesced: selected.quiesced });
  }
  preparedResult(prepared, inspected);
  if (journal.result !== undefined)
    need(identity(journal.result) === identity(prepared),
      'WORKSPACE_FLEET_PREPARATION_RESULT_CHANGED',
      'Preserve the exact completed original native receiving result.');
  journal.result = copy(prepared); journal.phase = 'COMPLETE';
  journal.completedAt = prepared.completedAt;
  state.progress = 'FLEET_PREPARED'; await save();
  return { status: 'COMPLETE', command: 'fleet-prepare', snapshotId: selected.snapshotId,
    bundle: selected.bundle, destination: selected.out, ...source,
    fleetTargetId: selected.fleetTargetId, fleetOperationId: selected.fleetOperationId,
    reviewSha256: selected.expectedReviewSha256, operationDirectory: selected.operationDirectory,
    prepared };
}
