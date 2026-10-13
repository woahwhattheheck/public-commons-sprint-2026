// MIT. Durable target publication within the original CKAN workbench.
import { join } from 'node:path';
import { lstat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { object, bytes, digest, readPrivate, createFile, atomicJson,
  privateDirectory, syncDirectory, fault, stamp } from '../postgres/publisher/files.mjs';
import { parseCkanJson, ExactCkanNumber } from './capture.mjs';
import { cloneRemote as clone, remoteIdentity as identity } from './remote-json.mjs';
import { remoteTarget, remoteCredentialAvailable, requestRemoteCkan,
  remoteFieldsMatch, remoteFieldChanges, remoteError, isRemoteUuid } from './remote-adapter.mjs';

export const CKAN_REMOTE_SCHEMA = 'stellar-forge.ckan-remote-workspace.v1';
const RECORD_SCHEMA = 'stellar-forge.ckan-remote-publication.v1';
const PLAN_SCHEMA = 'stellar-forge.ckan-remote-plan.v1';
const HASH = /^[a-f0-9]{64}$/;
const STATES = new Set(['PREPARING','READY','APPROVED','REJECTED','PUBLISHING','PARTIAL','COMPLETE','UNCERTAIN','CONFLICT','FAILED']);
const MODES = new Set(['create','patch']);
const PRIVATE_KEYS = new Set(['__proto__','constructor','prototype']);
const RESERVED_EXTRA = 'tjlabs_publication_intent';
const MAX_RECORD = 67108864;
const own = (value, key) => Object.hasOwn(value, key);
const exists = async path => { try { await lstat(path); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
const need = (value, code, message, status = 400) => { if (!value) throw fault(code, message, status); };
function uid(value) { need(isRemoteUuid(value), 'CKAN_REMOTE_ID_INVALID', 'Use the original UUID for this item.'); return value; }
function text(value, label, max = 256) {
  need(typeof value === 'string' && value.trim() && value.length <= max, 'CKAN_REMOTE_INPUT_INVALID', 'Enter ' + label + '.');
  return value.trim();
}
function jsonValue(value, depth = 0) {
  need(depth < 32, 'CKAN_REMOTE_INPUT_TOO_DEEP');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (value instanceof ExactCkanNumber) { identity(value); return; }
  if (typeof value === 'number') { need(Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value)),
    'CKAN_REMOTE_NUMBER_INVALID', 'Use the original exact JSON parser for numeric tokens that cannot be represented by a JavaScript number.'); return; }
  need(Array.isArray(value) || object(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)), 'CKAN_REMOTE_JSON_REQUIRED');
  for (const [key, item] of Object.entries(value)) { need(!PRIVATE_KEYS.has(key), 'CKAN_REMOTE_FIELD_INVALID'); jsonValue(item, depth + 1); }
}
function fields(value, kind, mode) {
  need(object(value) && Object.keys(value).length > 0, 'CKAN_REMOTE_FIELDS_REQUIRED');
  jsonValue(value);
  for (const key of Object.keys(value))
    need(!['id','package_id','resources','upload','__extras','__junk','context'].includes(key),
      'CKAN_REMOTE_FIELD_OWNED', 'IDs, resources and uploads are separate from reviewed metadata fields.');
  if (kind === 'package' && mode === 'create')
    need(typeof value.name === 'string' && /^[a-z0-9_-]{2,100}$/.test(value.name), 'CKAN_REMOTE_PACKAGE_NAME_REQUIRED');
  if (value.extras !== undefined) {
    need(Array.isArray(value.extras), 'CKAN_REMOTE_EXTRAS_INVALID');
    const seen = new Set();
    for (const item of value.extras) {
      need(object(item) && typeof item.key === 'string' && item.key && own(item, 'value') &&
        !seen.has(item.key) && item.key !== RESERVED_EXTRA, 'CKAN_REMOTE_EXTRAS_INVALID');
      seen.add(item.key);
    }
  }
  if (kind === 'resource' && mode === 'create') need(typeof value.url === 'string' && value.url, 'CKAN_REMOTE_RESOURCE_URL_REQUIRED');
  if (value.url !== undefined) {
    let url; try { url = new URL(value.url); } catch { throw fault('CKAN_REMOTE_RESOURCE_URL_INVALID'); }
    need(['https:','http:'].includes(url.protocol) && !url.username && !url.password,
      'CKAN_REMOTE_RESOURCE_URL_INVALID', 'Use an explicit HTTP distribution URL without embedded credentials.');
  }
  return clone(value);
}
export function validateRemotePublicationInput(input) {
  need(object(input), 'CKAN_REMOTE_INPUT_REQUIRED');
  uid(input.id); uid(input.targetId);
  const title = text(input.title, 'a publication title');
  need(Array.isArray(input.sourceIds) && input.sourceIds.length > 0 && input.sourceIds.length <= 64 &&
    new Set(input.sourceIds).size === input.sourceIds.length, 'CKAN_REMOTE_SOURCES_REQUIRED');
  input.sourceIds.forEach(uid);
  need(object(input.package) && MODES.has(input.package.mode), 'CKAN_REMOTE_PACKAGE_MODE_INVALID');
  const pkg = { mode: input.package.mode, fields: fields(input.package.fields, 'package', input.package.mode) };
  if (pkg.mode === 'patch') pkg.id = text(input.package.id, 'an existing target package ID or name', 512);
  need(Array.isArray(input.resources) && input.resources.length <= 64, 'CKAN_REMOTE_RESOURCES_INVALID');
  const keys = new Set(['package']), ids = new Set();
  const resources = input.resources.map(item => {
    need(object(item) && MODES.has(item.mode), 'CKAN_REMOTE_RESOURCE_MODE_INVALID');
    const key = text(item.key, 'a resource mapping key', 128);
    need(!keys.has(key) && input.sourceIds.includes(item.sourceId), 'CKAN_REMOTE_RESOURCE_BINDING_INVALID'); keys.add(key);
    const result = { key, mode: item.mode, sourceId: uid(item.sourceId), fields: fields(item.fields, 'resource', item.mode) };
    if (item.mode === 'patch') {
      need(pkg.mode === 'patch', 'CKAN_REMOTE_EXISTING_RESOURCE_PARENT_REQUIRED');
      result.id = uid(item.id); need(!ids.has(result.id), 'CKAN_REMOTE_RESOURCE_DUPLICATE'); ids.add(result.id);
    }
    return result;
  });
  const value = { id: input.id, title, targetId: input.targetId, sourceIds: [...input.sourceIds],
    package: pkg, resources, ...(input.previousReleaseId ? { previousReleaseId: uid(input.previousReleaseId) } : {}) };
  need(bytes(value).length <= 4194304, 'CKAN_REMOTE_PLAN_TOO_LARGE');
  return value;
}
export function validateCkanRemoteState(value) {
  if (value === undefined) return;
  need(object(value) && value.schema === CKAN_REMOTE_SCHEMA && Array.isArray(value.targets) && Array.isArray(value.releases),
    'CKAN_REMOTE_STATE_INVALID');
  const targets = new Set(), releases = new Set();
  for (const target of value.targets) {
    need(remoteTarget(target).sha256 === target.sha256 && !targets.has(target.id), 'CKAN_REMOTE_TARGET_CHANGED');
    need(target.retryNotBefore === undefined || target.retryNotBefore === null ||
      typeof target.retryNotBefore === 'string' && Number.isFinite(Date.parse(target.retryNotBefore)), 'CKAN_REMOTE_RETRY_TIME_INVALID');
    targets.add(target.id);
  }
  for (const row of value.releases) {
    need(isRemoteUuid(row.id) && targets.has(row.targetId) && !releases.has(row.id) && STATES.has(row.state),
      'CKAN_REMOTE_RELEASE_INVALID'); releases.add(row.id);
  }
}
function validateRecord(record) {
  need(object(record) && record.schema === RECORD_SCHEMA && isRemoteUuid(record.id) &&
    STATES.has(record.state) && Array.isArray(record.receipts) && Array.isArray(record.progress) &&
    Array.isArray(record.history), 'CKAN_REMOTE_RECORD_INVALID');
  const input = validateRemotePublicationInput(record.input);
  need(record.id === input.id && identity(input) === record.inputSha256, 'CKAN_REMOTE_INPUT_CHANGED');
  need(remoteTarget(record.target).sha256 === record.target.sha256 && record.target.id === input.targetId,
    'CKAN_REMOTE_TARGET_CHANGED');
  if (record.plan) {
    need(record.plan.schema === PLAN_SCHEMA && record.plan.inputSha256 === record.inputSha256 &&
      record.plan.targetSha256 === record.target.sha256 && identity(record.plan) === record.planSha256,
      'CKAN_REMOTE_PLAN_CHANGED');
    need(record.plan.actions.length === record.progress.length, 'CKAN_REMOTE_ACTIONS_CHANGED');
    for (let i = 0; i < record.plan.actions.length; i++) {
      need(record.plan.actions[i].key === record.progress[i].key, 'CKAN_REMOTE_ACTIONS_CHANGED');
    }
  }
  const seen = new Set();
  for (const ref of record.receipts) {
    need(isRemoteUuid(ref.id) && !seen.has(ref.id) && HASH.test(ref.sha256 ?? '') &&
      Number.isSafeInteger(ref.bytes) && ref.bytes >= 0 && ref.bytes <= record.target.maxResponseBytes &&
      ref.file === 'responses/' + ref.id + '.json', 'CKAN_REMOTE_RECEIPT_INVALID');
    seen.add(ref.id);
  }
  if (record.review) need(record.review.planSha256 === record.planSha256 &&
    isRemoteUuid(record.review.id) && ['approve','reject'].includes(record.review.decision), 'CKAN_REMOTE_REVIEW_CHANGED');
  return record;
}
function operationResult(record) {
  return { id: record.id, releaseId: record.id, state: record.state,
    planSha256: record.planSha256 ?? null, reviewId: record.review?.id ?? null,
    confirmedActions: record.progress.filter(item => item.status === 'CONFIRMED').length,
    actionCount: record.plan?.actions.length ?? 0, error: record.error ?? null };
}
const recordFolder = (directory, id) => join(directory, 'remote', 'publications', uid(id));
async function readRecord(directory, id) {
  return validateRecord(parseCkanJson(await readPrivate(join(recordFolder(directory, id), 'record.json'), MAX_RECORD)));
}
async function readResponseRaw(directory, record, ref) {
  need(record.receipts.some(item => item.id === ref.id && item.sha256 === ref.sha256), 'CKAN_REMOTE_RECEIPT_MISSING');
  const raw = await readPrivate(join(recordFolder(directory, record.id), ref.file), record.target.maxResponseBytes);
  need(raw.length === ref.bytes && digest(raw) === ref.sha256, 'CKAN_REMOTE_RESPONSE_CHANGED');
  return raw;
}
async function readResponse(directory, record, ref) {
  return parseCkanJson(await readResponseRaw(directory, record, ref));
}
async function readPlan(directory, record) {
  const raw = await readPrivate(join(recordFolder(directory, record.id), 'plan-' + record.planSha256 + '.json'), MAX_RECORD);
  need(identity(parseCkanJson(raw)) === record.planSha256 && raw.equals(bytes(record.plan)),
    'CKAN_REMOTE_PLAN_CHANGED');
  return raw;
}
export async function validateCkanRemoteFiles(directory, remote) {
  validateCkanRemoteState(remote); if (!remote) return;
  for (const summary of remote.releases) {
    const record = await readRecord(directory, summary.id);
    need(record.target.id === summary.targetId &&
      remote.targets.some(target => target.id === record.target.id && target.sha256 === record.target.sha256),
      'CKAN_REMOTE_TARGET_CHANGED');
    for (const ref of record.receipts) await readResponseRaw(directory, record, ref);
    if (record.plan) await readPlan(directory, record);
  }
}
export function ckanRemoteSummary(remote) {
  if (!remote) return undefined;
  return { schema: remote.schema,
    targets: remote.targets.map(({ id, origin, sha256 }) => ({ id, origin, sha256 })),
    releases: remote.releases.map(({ id, targetId, state, planSha256, reviewId, completedAt }) =>
      ({ id, targetId, state, planSha256, reviewId, completedAt })) };
}

/** The workbench's original private lock and launch/persist lifecycle own every
 * mutation. Receiving opens offline; interrupted POSTs become UNCERTAIN. */
export async function createCkanRemoteWorkspace({ directory, state, launch, persist,
  environment = process.env, transport, assertSource } = {}) {
  validateCkanRemoteState(state.remote);
  let recovered = state.remote === undefined;
  if (!state.remote) state.remote = { schema: CKAN_REMOTE_SCHEMA, targets: [], releases: [] };
  const remote = state.remote;
  const targetFor = id => {
    const result = remote.targets.find(row => row.id === uid(id));
    need(result, 'CKAN_REMOTE_TARGET_NOT_FOUND', 'Choose a saved target.', 404); return result;
  };
  const releaseFor = id => {
    const row = remote.releases.find(row => row.id === uid(id));
    need(row, 'CKAN_REMOTE_RELEASE_NOT_FOUND', 'Choose a retained publication.', 404); return row;
  };
  function updateSummary(record) {
    const row = releaseFor(record.id);
    Object.assign(row, { title: record.input.title, state: record.state,
      planSha256: record.planSha256 ?? null, reviewId: record.review?.id ?? null,
      completedAt: record.completedAt ?? null, error: record.error ?? null,
      confirmedActions: record.progress.filter(item => item.status === 'CONFIRMED').length,
      actionCount: record.plan?.actions.length ?? 0, updatedAt: record.updatedAt });
  }
  async function save(record) {
    record.updatedAt = stamp(); validateRecord(record);
    need(bytes(record).length <= MAX_RECORD, 'CKAN_REMOTE_RECORD_TOO_LARGE');
    await atomicJson(recordFolder(directory, record.id), 'record.json', record);
    updateSummary(record); await persist();
  }
  async function sourceBindings(input) {
    return await Promise.all(input.sourceIds.map(async id => {
      const source = state.sources.find(row => row.id === id);
      const edition = source && state.editions.find(row => row.id === source.editionId);
      need(source && !source.withdrawal && edition?.state === 'COMPLETE' && HASH.test(edition.manifestSha256 ?? ''),
        'CKAN_REMOTE_SOURCE_NOT_READY', 'Choose an existing complete reviewed source selection.');
      await assertSource?.(source);
      const raw = await readPrivate(join(directory, 'sources', id + '.json'), 1048576);
      need(digest(raw) === source.sha256, 'CKAN_REMOTE_SOURCE_CHANGED');
      return { sourceId: id, sourceSha256: source.sha256, editionId: edition.id,
        captureSha256: edition.manifestSha256, semanticReview: source.semanticReview ?? null };
    }));
  }
  async function response(record, action, parameters, signal, purpose) {
    const targetState = targetFor(record.target.id);
    if (Date.parse(targetState.retryNotBefore ?? '') > Date.now())
      throw Object.assign(fault('CKAN_REMOTE_RETRY_NOT_BEFORE',
        'Wait until the retained target retry time before this request.', 429),
        { category: 'rate', uncertain: false, retryAfter: targetState.retryNotBefore });
    const refId = randomUUID(), attempt = { id: refId, purpose, action,
      parametersSha256: identity(parameters), requestedAt: stamp(), state: 'REQUESTING' };
    record.history.push(attempt); await save(record);
    try {
      const result = await requestRemoteCkan(record.target, action, parameters, {
        environment, signal, ...(transport ? { fetch: transport } : {}),
        onResponse: async (raw, receipt) => {
          const file = 'responses/' + refId + '.json';
          await createFile(join(recordFolder(directory, record.id), file), raw);
          await syncDirectory(join(recordFolder(directory, record.id), 'responses'));
          const ref = { id: refId, file, bytes: raw.length, sha256: digest(raw), receipt };
          const retry = receipt.headers['retry-after'];
          const deadline = typeof retry === 'string' && /^\d+$/.test(retry.trim()) ?
            Date.parse(receipt.receivedAt) + Number(retry.trim()) * 1000 : Date.parse(retry ?? '');
          if (Number.isFinite(deadline) && deadline > Date.now() && deadline <= 8640000000000000)
            targetState.retryNotBefore = new Date(Math.max(deadline, Date.parse(targetState.retryNotBefore ?? '') || 0)).toISOString();
          record.receipts.push(ref); attempt.responseId = refId; attempt.state = 'RECEIVED'; await save(record);
        },
      });
      attempt.state = 'COMPLETE'; await save(record);
      return { ...result, ref: record.receipts.find(item => item.id === refId) };
    } catch (error) {
      attempt.state = 'FAILED'; attempt.error = remoteError(error); await save(record); throw error;
    }
  }
  async function snapshot(record, action, signal, purpose) {
    return response(record, action.kind === 'package' ? 'package_show' : 'resource_show',
      { id: action.kind === 'package' ? record.progress.find(item => item.key === action.key)?.observedId ?? action.targetId : action.targetId }, signal, purpose);
  }
  async function baseline(record, action) {
    const found = await readResponse(directory, record, action.baseline.ref);
    if (!action.baseline.found) return null;
    need(found.success === true && object(found.result) && identity(found.result) === action.baseline.identity,
      'CKAN_REMOTE_BASELINE_CHANGED');
    return found.result;
  }
  function expected(record, action) {
    if (action.kind === 'package') return action.fields;
    const packageId = record.progress[0].observedId ?? record.plan.actions[0].resolvedId;
    need(isRemoteUuid(packageId), 'CKAN_REMOTE_PARENT_UNCONFIRMED');
    return { ...action.fields, id: action.targetId, package_id: packageId };
  }
  function compatible(record, action, value) {
    const knownId = action.kind === 'package' && action.mode === 'create' ?
      record.progress.find(item => item.key === action.key)?.observedId : action.targetId;
    return object(value) && isRemoteUuid(value.id) && (!knownId || value.id === knownId) &&
      remoteFieldsMatch(value, expected(record, action));
  }
  function event(record, kind, details = {}) { record.history.push({ id: randomUUID(), kind, at: stamp(), ...details }); }
  async function prepare(record, signal) {
    try {
      record.state = 'PREPARING'; record.error = null; await save(record);
      const bindings = await sourceBindings(record.input);
      const pkg = record.input.package;
      const packageFields = clone(pkg.fields);
      if (pkg.mode === 'create') packageFields.extras = [...(packageFields.extras ?? []),
        { key: RESERVED_EXTRA, value: record.id }];
      const actions = [{ key: 'package', kind: 'package', mode: pkg.mode,
        action: pkg.mode === 'create' ? 'package_create' : 'package_patch',
        targetId: pkg.mode === 'create' ? pkg.fields.name : pkg.id, fields: packageFields }];
      for (const item of record.input.resources) actions.push({ key: item.key, kind: 'resource', mode: item.mode,
        action: item.mode === 'create' ? 'resource_create' : 'resource_patch',
        targetId: item.mode === 'create' ? record.resourceIds[item.key] : item.id,
        sourceId: item.sourceId, fields: clone(item.fields) });
      let packageId;
      for (const action of actions) {
        const current = await snapshot(record, action, signal, 'prepare baseline');
        need(action.mode === 'create' ? !current.found : current.found, 'CKAN_REMOTE_TARGET_BASELINE_CONFLICT',
          action.mode === 'create' ? 'The selected create identity already exists. Review it as an existing target.' :
            'The selected existing target was not found.', 409);
        if (current.found) {
          need(isRemoteUuid(current.value.id), 'CKAN_REMOTE_TARGET_ID_INVALID');
          action.targetId = current.value.id; action.resolvedId = current.value.id;
          if (action.kind === 'package') packageId = current.value.id;
          else need(current.value.package_id === packageId, 'CKAN_REMOTE_RESOURCE_PARENT_CHANGED');
        }
        action.baseline = { found: current.found, ref: current.ref,
          identity: current.found ? identity(current.value) : null };
        action.changes = remoteFieldChanges(current.value, action.fields);
      }
      const plan = { schema: PLAN_SCHEMA, inputSha256: record.inputSha256, targetSha256: record.target.sha256,
        sourceBindings: bindings, actions, preparedAt: stamp() };
      const planSha256 = identity(plan), planName = 'plan-' + planSha256 + '.json';
      if (await exists(join(recordFolder(directory, record.id), planName)))
        await readPlan(directory, { ...record, plan, planSha256 });
      else await atomicJson(recordFolder(directory, record.id), planName, plan);
      record.plan = plan; record.planSha256 = planSha256;
      record.progress = actions.map(action => ({ key: action.key, status: 'PENDING', attempts: 0 }));
      record.state = 'READY'; event(record, 'PLAN_PREPARED', { planSha256: record.planSha256 }); await save(record);
      return operationResult(record);
    } catch (error) {
      record.state = error.status === 409 ? 'CONFLICT' : 'FAILED'; record.error = remoteError(error); await save(record); throw error;
    }
  }
  async function inspectAction(record, index, signal, purpose) {
    const action = record.plan.actions[index], progress = record.progress[index];
    const wasConfirmed = !!progress.confirmedAt;
    const wasConflicted = progress.status === 'CONFLICT' || progress.identityMismatch === true;
    const current = await snapshot(record, action, signal, purpose);
    if (wasConflicted) {
      progress.status = 'CONFLICT'; progress.readbackId = current.ref.id; record.state = 'CONFLICT';
      event(record, 'CONFLICT_TARGET_OBSERVED', { key: action.key, responseId: current.ref.id, found: current.found });
      await save(record); return 'CONFLICT';
    }
    if (current.found && compatible(record, action, current.value)) {
      progress.status = 'CONFIRMED'; progress.observedId = current.value.id;
      progress.readbackId = current.ref.id; progress.confirmedAt = stamp();
      event(record, 'ACTION_RECONCILED', { key: action.key, observedId: current.value.id, responseId: current.ref.id });
      await save(record); return 'CONFIRMED';
    }
    const before = await baseline(record, action);
    if (!wasConfirmed && (before === null ? !current.found : current.found && identity(current.value) === action.baseline.identity)) {
      progress.status = 'RETRYABLE'; progress.readbackId = current.ref.id;
      await save(record); return 'RETRYABLE';
    }
    progress.status = 'CONFLICT'; progress.readbackId = current.ref.id;
    record.state = 'CONFLICT'; record.error = { code: 'CKAN_REMOTE_TARGET_CHANGED', category: 'conflict',
      message: 'The target differs from both the accepted baseline and the intended result. Review this response before a new plan.' };
    await save(record); return 'CONFLICT';
  }
  function requireReview(record, input) {
    need(record.plan && input?.expectedPlanSha256 === record.planSha256 &&
      record.review?.decision === 'approve' && input.expectedReviewId === record.review.id,
      'CKAN_REMOTE_APPROVAL_CHANGED', 'Approve this exact plan before publishing it.', 409);
  }
  async function publish(record, input, signal) {
    requireReview(record, input);
    if (record.state === 'COMPLETE') return operationResult(record);
    need(identity(await sourceBindings(record.input)) === identity(record.plan.sourceBindings),
      'CKAN_REMOTE_SOURCE_CHANGED', 'This approved source selection changed.', 409);
    need(!['REJECTED','CONFLICT','PREPARING','READY'].includes(record.state), 'CKAN_REMOTE_REVIEW_REQUIRED');
    record.state = 'PUBLISHING'; record.error = null; await save(record);
    try {
      for (let i = 0; i < record.plan.actions.length; i++) {
        signal?.throwIfAborted();
        const action = record.plan.actions[i], progress = record.progress[i];
        // Reconcile every prior dispatch before considering another POST.
        if (['DISPATCHING','UNCERTAIN','CONFIRMED'].includes(progress.status)) {
          const status = await inspectAction(record, i, signal, 'reconcile previous dispatch');
          if (status === 'CONFLICT') return operationResult(record);
          if (status === 'CONFIRMED') continue;
        }
        const current = await snapshot(record, action, signal, 'pre-write target comparison');
        const before = await baseline(record, action);
        if (!(before === null ? !current.found : current.found && identity(current.value) === action.baseline.identity)) {
          progress.status = 'CONFLICT'; record.state = 'CONFLICT';
          record.error = { code: 'CKAN_REMOTE_TARGET_CHANGED', category: 'conflict',
            message: 'The target changed after this plan was prepared. Review its current fields before publishing.' };
          progress.readbackId = current.ref.id; await save(record); return operationResult(record);
        }
        const parameters = action.kind === 'package'
          ? { ...action.fields, ...(action.mode === 'patch' ? { id: action.targetId } : {}) }
          : expected(record, action);
        progress.status = 'DISPATCHING'; progress.attempts++;
        progress.request = { action: action.action, parameters, parametersSha256: identity(parameters), at: stamp() };
        await save(record);
        try {
          const result = await response(record, action.action, parameters, signal, 'approved write');
          progress.responseId = result.ref.id;
          if (!isRemoteUuid(result.value.id) || (action.kind !== 'package' || action.mode === 'patch') && result.value.id !== action.targetId) {
            progress.identityMismatch = true; progress.status = 'CONFLICT'; record.state = 'CONFLICT';
            throw fault('CKAN_REMOTE_RETURNED_ID_CHANGED', 'The target returned a different object identity. Review a new plan.', 409);
          }
          progress.observedId = result.value.id;
          if (action.kind === 'package') {
            // Creates are located by their unique name until the original server UUID is known.
            progress.observedId = result.value.id;
          }
          progress.status = 'UNCERTAIN'; await save(record);
        } catch (error) {
          progress.status = progress.identityMismatch ? 'CONFLICT' : 'UNCERTAIN'; progress.error = remoteError(error);
          record.state = progress.identityMismatch ? 'CONFLICT' : 'UNCERTAIN'; record.error = remoteError(error); await save(record); throw error;
        }
        const confirmed = await inspectAction(record, i, signal, 'post-write target readback');
        if (confirmed !== 'CONFIRMED') {
          if (confirmed === 'RETRYABLE') { record.state = 'UNCERTAIN'; await save(record); }
          return operationResult(record);
        }
      }
      record.state = 'COMPLETE'; record.completedAt = stamp(); record.error = null;
      event(record, 'PUBLICATION_COMPLETE'); await save(record); return operationResult(record);
    } catch (error) {
      if (!['UNCERTAIN','CONFLICT'].includes(record.state)) {
        record.state = record.progress.some(item => ['DISPATCHING','UNCERTAIN'].includes(item.status)) ? 'UNCERTAIN' :
          record.progress.some(item => item.status === 'CONFIRMED') ? 'PARTIAL' : 'FAILED';
        record.error = remoteError(error); await save(record);
      }
      throw error;
    }
  }
  // Offline reopen makes possible remote effects explicit. It never reissues a request.
  for (const row of remote.releases) {
    const record = await readRecord(directory, row.id);
    if (record.progress.some(item => item.status === 'DISPATCHING') || record.state === 'PUBLISHING') {
      for (const item of record.progress) if (item.status === 'DISPATCHING') item.status = 'UNCERTAIN';
      record.state = 'UNCERTAIN'; event(record, 'LOCAL_REOPEN_REQUIRES_RECONCILIATION'); await save(record);
    } else {
      const before = JSON.stringify(row); updateSummary(record);
      if (JSON.stringify(row) !== before) recovered = true;
    }
  }
  if (recovered) await persist();
  return {
    saveRemoteTarget(input) {
      const target = remoteTarget(input), existing = remote.targets.find(row => row.id === target.id);
      if (existing) need(existing.sha256 === target.sha256, 'CKAN_REMOTE_TARGET_IMMUTABLE',
        'Use a new target ID when changing the catalogue or credential reference.', 409);
      const started = launch('save remote CKAN target', async () => {
        if (!existing) { remote.targets.push(target); await persist(); }
        return { ...clone(target), credentialAvailable: remoteCredentialAvailable(target, environment) };
      });
      return { ...started, targetId: target.id };
    },
    remoteTarget(value) {
      const target = targetFor(value);
      return { ...clone(target), credentialAvailable: remoteCredentialAvailable(target, environment) };
    },
    prepareRemotePublication(supplied) {
      const input = validateRemotePublicationInput(supplied), target = targetFor(input.targetId);
      if (input.previousReleaseId) releaseFor(input.previousReleaseId);
      const started = launch('prepare remote CKAN publication', async signal => {
        let record;
        if (remote.releases.some(row => row.id === input.id)) {
          record = await readRecord(directory, input.id);
          need(record.inputSha256 === identity(input), 'CKAN_REMOTE_REQUEST_ID_REUSED',
            'Resume with the original input or create an explicit new plan edition.', 409);
          if (record.plan) return operationResult(record);
        } else {
          await privateDirectory(join(directory, 'remote'), true);
          await privateDirectory(join(directory, 'remote', 'publications'), true);
          const folder = recordFolder(directory, input.id); await privateDirectory(folder, true);
          await privateDirectory(join(folder, 'responses'), true);
          const file = join(folder, 'record.json');
          if (await exists(file)) {
            record = await readRecord(directory, input.id);
            need(record.inputSha256 === identity(input) && record.target.sha256 === target.sha256,
              'CKAN_REMOTE_REQUEST_ID_REUSED');
          } else {
            record = { schema: RECORD_SCHEMA, id: input.id, input, inputSha256: identity(input), target: clone(target),
              state: 'PREPARING', createdAt: stamp(), updatedAt: stamp(), receipts: [], history: [], progress: [],
              resourceIds: Object.fromEntries(input.resources.filter(item => item.mode === 'create')
                .map(item => [item.key, randomUUID()])) };
            await atomicJson(folder, 'record.json', record);
          }
          remote.releases.push({ id: record.id, targetId: target.id, title: input.title, state: record.state });
          await save(record);
        }
        return prepare(record, signal);
      });
      return { ...started, releaseId: input.id };
    },
    async remotePublication(value) { releaseFor(value); return clone(await readRecord(directory, value)); },
    reviewRemotePublication(value, input) {
      releaseFor(value);
      return launch('review remote CKAN publication', async () => {
        const record = await readRecord(directory, value);
        need(record.plan && record.planSha256 === input?.expectedPlanSha256, 'CKAN_REMOTE_PLAN_CHANGED');
        need(['approve','reject'].includes(input.decision), 'CKAN_REMOTE_DECISION_REQUIRED');
        const proposed = { planSha256: record.planSha256, reviewer: text(input.reviewer, 'a reviewer', 128),
          decision: input.decision, reason: text(input.reason, 'the review decision', 4096) };
        if (record.review && identity(proposed) === record.review.inputSha256) return operationResult(record);
        need(record.state === 'READY', 'CKAN_REMOTE_REVIEW_STATE_CHANGED',
          'Create an explicit new plan edition to change a retained decision.', 409);
        record.review = { ...proposed, id: randomUUID(), inputSha256: identity(proposed), recordedAt: stamp() };
        record.state = proposed.decision === 'approve' ? 'APPROVED' : 'REJECTED';
        event(record, 'PLAN_REVIEWED', { reviewId: record.review.id }); await save(record); return operationResult(record);
      });
    },
    publishRemotePublication(value, input) {
      releaseFor(value);
      return launch('publish remote CKAN publication', async signal => publish(await readRecord(directory, value), input, signal));
    },
    reconcileRemotePublication(value) {
      releaseFor(value);
      return launch('reconcile remote CKAN publication', async signal => {
        const record = await readRecord(directory, value);
        need(record.plan && record.review?.decision === 'approve', 'CKAN_REMOTE_REVIEW_REQUIRED');
        for (let i = 0; i < record.progress.length; i++) {
          const progress = record.progress[i];
          if (!progress.attempts) continue;
          if (i > 0 && !record.progress[0].observedId && !record.plan.actions[0].resolvedId) break;
          await inspectAction(record, i, signal, 'operator reconciliation');
        }
        if (record.progress.every(item => item.status === 'CONFIRMED')) {
          record.state = 'COMPLETE'; record.completedAt ??= stamp(); record.error = null;
        } else if (record.progress.some(item => item.status === 'CONFLICT')) record.state = 'CONFLICT';
        else {
          record.state = record.progress.some(item => item.status === 'CONFIRMED') ? 'PARTIAL' : 'APPROVED';
          record.error = null;
        }
        event(record, 'PUBLICATION_RECONCILED'); await save(record); return operationResult(record);
      });
    },
    async remotePublicationFile(value, kind = 'record', receiptId) {
      releaseFor(value); const record = await readRecord(directory, value), folder = recordFolder(directory, value);
      let file, filename, expected;
      if (kind === 'receipt') {
        const ref = record.receipts.find(item => item.id === uid(receiptId));
        need(ref, 'CKAN_REMOTE_RECEIPT_NOT_FOUND', 'Choose a retained target response.', 404);
        file = join(folder, ref.file); filename = 'ckan-target-response-' + ref.id + '.json'; expected = ref;
      } else {
        need(kind === 'record' || kind === 'plan', 'CKAN_REMOTE_FILE_KIND_INVALID');
        if (kind === 'plan') {
          need(record.plan, 'CKAN_REMOTE_PLAN_NOT_READY');
          file = join(folder, 'plan-' + record.planSha256 + '.json');
          await readPlan(directory, record);
          filename = 'ckan-publication-plan-' + value + '.json';
        } else { file = join(folder, 'record.json'); filename = 'ckan-publication-' + value + '.json'; }
      }
      const raw = await readPrivate(file, MAX_RECORD);
      if (expected) need(raw.length === expected.bytes && digest(raw) === expected.sha256, 'CKAN_REMOTE_RESPONSE_CHANGED');
      return { path: file, file, filename, contentType: 'application/json', id: value,
        mediaType: 'application/json', downloadName: filename, bytes: raw.length, sha256: digest(raw) };
    },
  };
}
