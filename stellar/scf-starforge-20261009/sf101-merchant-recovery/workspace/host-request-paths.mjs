// SPDX-License-Identifier: MIT
// Pure historical path selection from the original SF101 saved request.
// No filesystem access, provider call, request rewrite or recovery execution.
import { createHash } from 'node:crypto';
import { isAbsolute, resolve, basename, dirname, join, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { identity } from '../../sf30-seller-sdk/postgres/publisher/files.mjs';

const SCHEMA = 'stellar-forge.recovery-workspace-request.v1';
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;
const PASS = /^[A-Z][A-Z0-9_]{4,63}$/;
const ROOT_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const COMMANDS = new Set(['snapshot', 'local-verify', 'publisher-prepare', 'fleet-prepare',
  'push', 'pull', 'restore', 'object-snapshot', 'object-verify', 'object-restore',
  'object-compare', 'object-bundle-export', 'object-bundle-receive']);
const PHASES = new Set(['PREPARED', 'RUNNING', 'INTERRUPTED', 'FAILED', 'COMPLETE']);
export const RECOVERY_REQUEST_PATH_LIMITS = Object.freeze({
  requestBytes: 2 * 1024 * 1024, pathCharacters: 4096, paths: 2048
});
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = value => createHash('sha256').update(value).digest('hex');
const inside = (root, path) => root === path || path.startsWith(root + sep);
const overlap = (left, right) => inside(left, right) || inside(right, left);
const same = isDeepStrictEqual;
const fail = (code, message = code) => { throw Object.assign(new Error(message), { code, status: 409 }); };
const need = (ok, code, message) => { if (!ok) fail(code, message); };
function exact(value, keys) {
  need(object(value) && Object.keys(value).every(key => keys.includes(key)),
    'HOST_HANDOFF_REQUEST_FIELDS_INVALID');
}
function absolute(value) {
  need(typeof value === 'string' && value.length <= RECOVERY_REQUEST_PATH_LIMITS.pathCharacters &&
    isAbsolute(value) && resolve(value) === value && value !== sep && !/[\u0000-\u001f]/.test(value),
    'HOST_HANDOFF_REQUEST_PATH_INVALID');
  return value;
}
function digest(value) {
  need(typeof value === 'string' && HASH.test(value), 'HOST_HANDOFF_REQUEST_DIGEST_INVALID');
  return value;
}
function identifier(value) {
  need(typeof value === 'string' && ID.test(value), 'HOST_HANDOFF_REQUEST_ID_INVALID');
  return value;
}
// Object declarations use the adapter's explicit sorted-member serialization;
// native fleet identities use the original imported identity() helper instead.
function objectStable(value) {
  if (Array.isArray(value)) return '[' + value.map(objectStable).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort().map(key =>
    JSON.stringify(key) + ':' + objectStable(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function declaration(value) {
  exact(value, ['id', 'label', 'directory', 'stateRoot', 'include', 'bundle',
    'sessionId', 'kinds', 'expectedRecordSha256']);
  identifier(value.id);
  need(typeof value.label === 'string' && value.label.trim() && value.label.length <= 160 &&
    !/[\u0000-\u001f]/.test(value.label), 'HOST_HANDOFF_REQUEST_OBJECT_INVALID');
  need(typeof value.sessionId === 'string' && value.sessionId.length > 0 &&
    value.sessionId.length <= 160 && !/[\u0000-\u001f]/.test(value.sessionId),
    'HOST_HANDOFF_REQUEST_OBJECT_INVALID');
  for (const key of ['directory', 'stateRoot', 'bundle']) absolute(value[key]);
  need(value.directory !== value.stateRoot && inside(value.stateRoot, value.directory) &&
    !overlap(value.stateRoot, value.bundle), 'HOST_HANDOFF_REQUEST_OBJECT_INVALID');
  need(Array.isArray(value.include) && value.include.length <= 64 &&
    new Set(value.include).size === value.include.length, 'HOST_HANDOFF_REQUEST_OBJECT_INVALID');
  for (const path of value.include)
    need(inside(value.stateRoot, absolute(path)), 'HOST_HANDOFF_REQUEST_OBJECT_INVALID');
  need(Array.isArray(value.kinds) && value.kinds.length > 0 && value.kinds.length <= 3 &&
    new Set(value.kinds).size === value.kinds.length &&
    value.kinds.every(kind => ['snapshot', 'verify', 'restore'].includes(kind)),
    'HOST_HANDOFF_REQUEST_OBJECT_INVALID');
  if (value.expectedRecordSha256 !== undefined) digest(value.expectedRecordSha256);
  need(value.kinds.includes('snapshot') || value.expectedRecordSha256,
    'HOST_HANDOFF_REQUEST_OBJECT_INVALID');
  return value;
}
function originalRestoreSelector(options, specific) {
  const a = options[specific], b = options.sourceRestoreId;
  need((a !== undefined) !== (b !== undefined), 'HOST_HANDOFF_REQUEST_RESTORE_SELECTOR_INVALID');
  identifier(a ?? b);
}
function completed(request) {
  // The original native result may be complete while outer publication failed.
  if (request.phase === 'COMPLETE')
    need(object(request.result) && request.result.status === 'COMPLETE',
      'HOST_HANDOFF_REQUEST_COMPLETION_INVALID');
  return object(request.result) && request.result.status === 'COMPLETE';
}

/**
 * Return the historical paths selected by one complete saved native request.
 *
 * required means a completed output must still be retained. Historical input
 * absence is observed by the caller: a completed original operation may reopen
 * after its source was removed. It never authorizes recreating that source.
 *
 * provider-configuration and fleet-target-private are EXTERNAL PRIVATE roles;
 * the caller must route them to external custody before capture-root coverage.
 * All whole-workspace evidence, prepared reviews and Support transfer history
 * remain in the caller's complete original workspace root.
 */
export function recoveryRequestPaths(request, { path: requestPath } = {}) {
  exact(request, ['schema', 'review', 'phase', 'attempts', 'createdAt', 'updatedAt',
    'local', 'result', 'error']);
  let serialized;
  try { serialized = JSON.stringify(request); }
  catch { fail('HOST_HANDOFF_REQUEST_JSON_INVALID'); }
  need(Buffer.byteLength(serialized, 'utf8') <= RECOVERY_REQUEST_PATH_LIMITS.requestBytes &&
    request.schema === SCHEMA && object(request.review) && PHASES.has(request.phase) &&
    Number.isSafeInteger(request.attempts) && request.attempts >= 0 &&
    ['createdAt', 'updatedAt'].every(key => typeof request[key] === 'string' &&
      Number.isFinite(Date.parse(request[key]))), 'HOST_HANDOFF_REQUEST_INVALID');
  const review = request.review, options = review.options;
  identifier(review.profileId); identifier(review.operationId);
  need(COMMANDS.has(review.command) && object(options) &&
    options.command === review.command && options.id === review.operationId &&
    PASS.test(options.passEnv ?? '') &&
    (review.store === null || object(review.store)) &&
    (review.snapshotId === null || HASH.test(review.snapshotId ?? '')),
    'HOST_HANDOFF_REQUEST_REVIEW_INVALID');
  const projection = { profileId: review.profileId, command: review.command,
    operationId: review.operationId, store: review.store, snapshotId: review.snapshotId, options };
  need(hash(JSON.stringify(projection)) === digest(review.reviewHash),
    'HOST_HANDOFF_REQUEST_REVIEW_CHANGED');
  const done = completed(request), rows = new Map();
  function add(path, kind, required, role) {
    absolute(path);
    need(['file', 'directory', 'entry'].includes(kind) && typeof required === 'boolean',
      'HOST_HANDOFF_REQUEST_PATH_INVALID');
    const key = JSON.stringify([path, kind, role]), old = rows.get(key);
    rows.set(key, { path, kind, required: required || old?.required === true, role,
      profileId: review.profileId, operationId: review.operationId });
    need(rows.size <= RECOVERY_REQUEST_PATH_LIMITS.paths, 'HOST_HANDOFF_REQUEST_PATH_LIMIT');
  }
  function objectPaths(selected, { stateRequired = false, bundleRequired = false } = {}) {
    const value = declaration(selected);
    add(value.stateRoot, 'directory', stateRequired, 'object-state-root');
    add(value.directory, 'directory', stateRequired, 'object-directory');
    for (const path of value.include) add(path, 'entry', false, 'object-include');
    add(value.bundle, 'directory', bundleRequired, 'object-bundle');
    return value;
  }
  function visible(source, destination) {
    need(review.source === source && review.destination === destination,
      'HOST_HANDOFF_REQUEST_VISIBLE_BINDING_CHANGED');
  }
  if (requestPath !== undefined) {
    absolute(requestPath);
    need(basename(requestPath) === hash(review.profileId + '\n' + review.operationId) + '.json',
      'HOST_HANDOFF_REQUEST_FILENAME_CHANGED');
    add(requestPath, 'file', true, 'workspace-request');
  }
  const common = ['command', 'id', 'passEnv'];
  switch (review.command) {
    case 'push':
    case 'pull':
    case 'restore': {
      exact(options, [...common, 'config', 'operations', 'bundle', 'snapshot', 'out', 'bundleOut']);
      need(object(review.store), 'HOST_HANDOFF_REQUEST_REMOTE_STORE_INVALID');
      add(options.config, 'file', false, 'provider-configuration');
      add(options.operations, 'directory', done, 'transfer-operations');
      add(join(options.operations, options.id), 'directory', done, 'transfer-operation');
      if (review.command === 'push') {
        need(options.snapshot === undefined && options.out === undefined && options.bundleOut === undefined,
          'HOST_HANDOFF_REQUEST_REMOTE_BINDING_CHANGED');
        digest(review.snapshotId);
        add(options.bundle, 'directory', false, 'transfer-source-bundle');
        visible(options.bundle, null);
      } else {
        need(options.bundle === undefined && digest(options.snapshot) === review.snapshotId,
          'HOST_HANDOFF_REQUEST_REMOTE_BINDING_CHANGED');
        add(options.out, 'directory', done, review.command === 'restore' ? 'transfer-restored-output' : 'transfer-downloaded-bundle');
        if (review.command === 'restore') add(options.bundleOut, 'directory', done, 'transfer-downloaded-bundle');
        else need(options.bundleOut === undefined, 'HOST_HANDOFF_REQUEST_REMOTE_BINDING_CHANGED');
        visible(options.bundleOut ?? null, options.out);
      }
      break;
    }
    case 'snapshot': {
      exact(options, [...common, 'plan', 'out', 'captureId', 'expectedPlanSha256', 'captureKind']);
      digest(options.captureId); digest(options.expectedPlanSha256);
      need(review.store === null && review.snapshotId === null &&
        object(review.capturePlan) && review.capturePlan.planFile === options.plan,
        'HOST_HANDOFF_REQUEST_CAPTURE_BINDING_CHANGED');
      visible(options.plan, options.out);
      add(options.plan, 'file', false, 'capture-plan');
      add(options.out, 'directory', done, 'capture-output');
      // Native typed captures retain the entire original plan before execution.
      // The live plan file may legitimately have changed after this operation.
      const typed = {
        'merchant-fleet': ['merchantFleetPlan', 'merchantFleet', 'stellar-forge.fleet-recovery-profile.v1'],
        'paid-jobs': ['paidJobsPlan', 'paidJobs', 'stellar-forge.paid-job-recovery-profile.v1'],
        'dataset-publisher': ['datasetPublisherPlan', 'datasetPublisher', 'stellar-forge.dataset-publisher-recovery-profile.v1']
      };
      for (const [kind, [key, member, schema]] of Object.entries(typed)) {
        const retained = request.local?.[key];
        if (retained === undefined) continue;
        need((options.captureKind ?? 'generic') === kind && object(retained) &&
          retained.schema === schema && retained.planSha256 === options.expectedPlanSha256 &&
          typeof retained.base64 === 'string' && retained.base64.length <= Math.ceil(256 * 1024 / 3) * 4,
          'HOST_HANDOFF_REQUEST_CAPTURE_PLAN_CHANGED');
        const raw = Buffer.from(retained.base64, 'base64');
        need(raw.length <= 256 * 1024 && raw.length === retained.bytes &&
          raw.toString('base64') === retained.base64 && hash(raw) === options.expectedPlanSha256,
          'HOST_HANDOFF_REQUEST_CAPTURE_PLAN_CHANGED');
        let plan;
        try { plan = JSON.parse(raw.toString('utf8')); }
        catch { fail('HOST_HANDOFF_REQUEST_CAPTURE_PLAN_CHANGED'); }
        need(object(plan) && plan.schema === 'stellar-forge.merchant-recovery-plan.v1' &&
          object(plan[member]) && plan[member].schema === schema &&
          Array.isArray(plan.roots) && plan.roots.length > 0 && plan.roots.length <= 20 &&
          new Set(plan.roots.map(row => row?.name)).size === plan.roots.length,
          'HOST_HANDOFF_REQUEST_CAPTURE_PLAN_CHANGED');
        const sourcePaths = [];
        for (const root of plan.roots) {
          need(object(root) && ROOT_NAME.test(root.name ?? ''),
            'HOST_HANDOFF_REQUEST_CAPTURE_PLAN_CHANGED');
          absolute(root.path);
          need(!overlap(root.path, options.out) && sourcePaths.every(path => !overlap(path, root.path)),
            'HOST_HANDOFF_REQUEST_CAPTURE_PLAN_CHANGED');
          sourcePaths.push(root.path); add(root.path, 'entry', false, 'capture-source');
        }
      }
      // Interrupted captures are preserved by the original local adapter beside
      // its selected output. Keep that explicit history without traversing
      // arbitrary result strings or manufacturing a new capture selection.
      const retired = (row, required) => {
        need(object(row) && row.from === options.out && row.captureId === options.captureId &&
          row.planSha256 === options.expectedPlanSha256 &&
          Number.isSafeInteger(row.attempt) && row.attempt >= 0 &&
          typeof row.selectedAt === 'string' && Number.isFinite(Date.parse(row.selectedAt)),
          'HOST_HANDOFF_REQUEST_CAPTURE_RETENTION_CHANGED');
        absolute(row.directory);
        const prefix = '.sf101-interrupted-capture-' + options.captureId.slice(0, 12) + '-';
        need(dirname(row.directory) === dirname(options.out) && basename(row.directory).startsWith(prefix) &&
          /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
            basename(row.directory).slice(prefix.length)),
          'HOST_HANDOFF_REQUEST_CAPTURE_RETENTION_CHANGED');
        add(row.directory, 'directory', required, 'capture-retained-output');
      };
      if (request.local?.pendingRetirement != null) retired(request.local.pendingRetirement, false);
      for (const list of [request.local?.retainedCaptures, request.result?.retainedCaptures]) {
        if (list === undefined) continue;
        need(Array.isArray(list), 'HOST_HANDOFF_REQUEST_CAPTURE_RETENTION_CHANGED');
        for (const row of list) retired(row, true);
      }
      break;
    }
    case 'local-verify': {
      exact(options, [...common, 'bundle', 'snapshotId']);
      need(review.store === null && digest(options.snapshotId) === review.snapshotId,
        'HOST_HANDOFF_REQUEST_VERIFY_BINDING_CHANGED');
      visible(options.bundle, null);
      add(options.bundle, 'directory', false, 'verification-bundle');
      break;
    }
    case 'publisher-prepare': {
      exact(options, [...common, 'sourcePublisherRestoreId', 'sourceRestoreId', 'bundle', 'out',
        'snapshotId', 'expectedReviewSha256', 'publisherOperationId']);
      originalRestoreSelector(options, 'sourcePublisherRestoreId');
      digest(options.expectedReviewSha256); digest(options.publisherOperationId);
      need(review.store === null && digest(options.snapshotId) === review.snapshotId &&
        object(review.restoredPublisher) &&
        review.restoredPublisher.reviewSha256 === options.expectedReviewSha256 &&
        review.restoredPublisher.operationId === options.publisherOperationId &&
        review.restoredPublisher.manifestSha256 === options.snapshotId &&
        review.restoredPublisher.bundleDirectory === options.bundle &&
        review.restoredPublisher.restoreDirectory === options.out,
        'HOST_HANDOFF_REQUEST_PUBLISHER_BINDING_CHANGED');
      visible(options.bundle, options.out);
      add(options.bundle, 'directory', false, 'publisher-source-bundle');
      // All prepared publisher paths are below the authenticated original restore.
      // Do not follow unhashed originalPaths display fields into another tree.
      add(options.out, 'directory', done, 'publisher-restored-output');
      break;
    }
    case 'fleet-prepare': {
      exact(options, [...common, 'sourceFleetRestoreId', 'sourceRestoreId', 'fleetTargetId',
        'bundle', 'out', 'snapshotId', 'quiesced', 'targetFile', 'operationDirectory',
        'expectedReviewSha256', 'fleetOperationId']);
      originalRestoreSelector(options, 'sourceFleetRestoreId'); identifier(options.fleetTargetId);
      const native = review.restoredFleet, selected = native?.review;
      need(review.store === null && digest(options.snapshotId) === review.snapshotId &&
        options.quiesced === true && object(native) && object(selected) &&
        ['FLEET_RECEIVING_REVIEW', 'FLEET_RECEIVING_COMPLETE'].includes(native.status) &&
        native.reviewSha256 === digest(options.expectedReviewSha256) &&
        identity(selected) === options.expectedReviewSha256 &&
        native.operationId === digest(options.fleetOperationId) &&
        identity({ purpose: 'receive-original-fleet', reviewSha256: native.reviewSha256 }) === options.fleetOperationId &&
        selected.schema === 'stellar-forge.fleet-recovery-receiving.v1' &&
        selected.snapshotId === options.snapshotId && selected.bundleDirectory === options.bundle &&
        selected.restoreDirectory === options.out && selected.targetFile === options.targetFile &&
        selected.operationDirectory === options.operationDirectory,
        'HOST_HANDOFF_REQUEST_FLEET_BINDING_CHANGED');
      for (const key of ['sourcePlanSha256', 'profileSha256', 'targetSha256']) digest(selected[key]);
      need(Array.isArray(selected.roots) && selected.roots.length > 0 && selected.roots.length <= RECOVERY_REQUEST_PATH_LIMITS.paths &&
        new Set(selected.roots.map(row => row?.name)).size === selected.roots.length &&
        Array.isArray(selected.destinationParents) && selected.destinationParents.length > 0 &&
        Number.isSafeInteger(selected.serviceUid) && selected.serviceUid > 0 &&
        Number.isSafeInteger(selected.serviceGid) && selected.serviceGid > 0, 'HOST_HANDOFF_REQUEST_FLEET_BINDING_CHANGED');
      for (const path of selected.destinationParents) absolute(path);
      visible(options.bundle, options.out);
      add(options.bundle, 'directory', false, 'fleet-source-bundle');
      add(options.out, 'directory', false, 'fleet-restored-source');
      add(options.targetFile, 'file', false, 'fleet-target-private');
      add(options.operationDirectory, 'directory', done, 'fleet-operation');
      add(selected.sourceRoot, 'directory', false, 'fleet-runtime-source');
      add(selected.deploymentBundle, 'directory', done, 'fleet-deployment-bundle');
      for (const root of selected.roots) {
        need(object(root) && ROOT_NAME.test(root.name ?? '') &&
          ['file', 'directory'].includes(root.kind) && object(root.source) &&
          root.source.kind === root.kind && HASH.test(root.source.sha256 ?? '') &&
          ['files', 'directories', 'bytes'].every(key => Number.isSafeInteger(root.source[key]) && root.source[key] >= 0) &&
          root.destination === root.path && root.restored === join(options.out, root.name),
          'HOST_HANDOFF_REQUEST_FLEET_ROOT_CHANGED');
        absolute(root.restored);
        add(root.destination, root.kind, done, 'fleet-received-root');
      }
      break;
    }
    case 'object-snapshot':
    case 'object-verify':
    case 'object-restore': {
      exact(options, [...common, 'objectSessionId', 'objectRecovery']);
      const selected = options.objectRecovery, declared = declaration(review.objectDeclaration);
      need(review.store === null && object(selected) && same(selected, review.objectRecovery) &&
        selected.command === review.command && options.objectSessionId === declared.id &&
        selected.objectSessionId === declared.id && selected.declarationSha256 === hash(objectStable(declared)) &&
        selected.directory === declared.directory && selected.stateRoot === declared.stateRoot &&
        selected.bundle === declared.bundle && selected.sessionId === declared.sessionId &&
        declared.kinds.includes(review.command.slice('object-'.length)),
        'HOST_HANDOFF_REQUEST_OBJECT_BINDING_CHANGED');
      if (review.command === 'object-snapshot') {
        digest(selected.expectedReviewSha256);
        need(selected.quiesced === true && review.snapshotId === null,
          'HOST_HANDOFF_REQUEST_OBJECT_BINDING_CHANGED');
      } else need(digest(selected.expectedRecordSha256) === review.snapshotId &&
        (!declared.expectedRecordSha256 || declared.expectedRecordSha256 === review.snapshotId),
        'HOST_HANDOFF_REQUEST_OBJECT_BINDING_CHANGED');
      visible(declared.directory, review.command === 'object-snapshot' ? declared.bundle :
        review.command === 'object-restore' ? declared.stateRoot : null);
      objectPaths(declared, { stateRequired: done && review.command === 'object-restore',
        bundleRequired: done && review.command === 'object-snapshot' });
      break;
    }
    case 'object-compare': {
      exact(options, [...common, 'objectComparison']);
      const selected = options.objectComparison;
      need(review.store === null && review.snapshotId === null && object(selected) &&
        same(selected, review.objectComparison) && selected.profileId === review.profileId &&
        selected.passEnv === options.passEnv, 'HOST_HANDOFF_REQUEST_COMPARISON_BINDING_CHANGED');
      const before = objectPaths(selected.before), after = objectPaths(selected.after);
      need(before.sessionId === after.sessionId && before.directory === after.directory &&
        before.stateRoot === after.stateRoot && before.kinds.includes('verify') && after.kinds.includes('verify'),
        'HOST_HANDOFF_REQUEST_COMPARISON_BINDING_CHANGED');
      for (const [side, value] of [['before', before], ['after', after]]) {
        const expected = digest(selected[side + 'ExpectedRecordSha256']);
        need(!value.expectedRecordSha256 || value.expectedRecordSha256 === expected,
          'HOST_HANDOFF_REQUEST_COMPARISON_BINDING_CHANGED');
      }
      visible(before.bundle, null);
      break;
    }
    case 'object-bundle-export':
    case 'object-bundle-receive': {
      exact(options, [...common, 'objectBundle']);
      const selected = options.objectBundle;
      need(review.store === null && object(selected) && same(selected, review.objectBundle) &&
        selected.schema === 'stellar-forge.sf101.object-bundle-selection.v1' &&
        selected.command === review.command && digest(selected.recordSha256) === review.snapshotId,
        'HOST_HANDOFF_REQUEST_BUNDLE_BINDING_CHANGED');
      const declared = objectPaths(selected.objectDeclaration,
        { bundleRequired: done && review.command === 'object-bundle-receive' });
      if (review.command === 'object-bundle-receive') {
        const archive = selected.archiveDeclaration;
        exact(archive, ['id', 'label', 'path', 'sha256']); identifier(archive.id); digest(archive.sha256);
        add(archive.path, 'file', false, 'object-bundle-archive');
        visible(archive.path, declared.bundle);
      } else {
        need(object(selected.sourceRequest) && ID.test(selected.sourceRequest.id ?? '') &&
          HASH.test(selected.sourceRequest.reviewHash ?? '') && HASH.test(selected.sourceRequest.sha256 ?? '') &&
          Number.isSafeInteger(selected.sourceRequest.attempt) && selected.sourceRequest.attempt >= 0,
          'HOST_HANDOFF_REQUEST_BUNDLE_BINDING_CHANGED');
        visible(declared.bundle, null);
      }
      break;
    }
    default: fail('HOST_HANDOFF_REQUEST_COMMAND_UNSUPPORTED');
  }
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  return [...rows.values()].sort((a, b) => compare(a.path, b.path) ||
    compare(a.role, b.role) || compare(a.kind, b.kind));
}
