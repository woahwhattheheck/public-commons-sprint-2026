// MIT. Saved ordered launch plans over the original Applications lifecycle.
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { applicationRunState, reviewApplicationStart } from './applications-core.mjs';
import { makePrivate, privateDirectory, optionalPrivateEntries, readJSON, saveJSON, recordId, operationId,
  operationLease, createWorkspaceReceivingReader, plain, need, digest, json, canonical, now } from './storage.mjs';

const GROUP = 'stellar-forge.application-group.v1';
const RUN = 'stellar-forge.application-group-run.v1';
const REVIEW = 'stellar-forge.application-group-review.v1';
const hash = value => digest(json(canonical(value)));
const errorView = error => ({ code: error.code ?? 'APPLICATION_GROUP_ERROR', message: String(error.message ?? error).slice(0, 2000) });
const groupPath = (root, id) => join(root, 'application-groups', recordId(id));
const runPath = (root, id, runId) => join(groupPath(root, id), 'runs', operationId(runId) + '.json');
const reviewPath = (root, id) => join(root, 'application-group-reviews', recordId(id) + '.json');
const appPath = (root, id) => join(root, 'applications', recordId(id), 'application.json');
const revision = value => { need(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'APPLICATION_GROUP_REVISION_INVALID'); return value; };
const uuidFrom = value => {
  const id = digest(value);
  return id.slice(0, 8) + '-' + id.slice(8, 12) + '-4' + id.slice(13, 16) + '-a' + id.slice(17, 20) + '-' + id.slice(20, 32);
};
async function directory(path) {
  try { await makePrivate(path); }
  catch (error) { if (error.code !== 'EEXIST') throw error; await privateDirectory(path); }
}
async function persist(path, value, replace = false) {
  need(Buffer.byteLength(json(value)) <= 2 * 1024 * 1024, 'APPLICATION_GROUP_RECORD_TOO_LARGE');
  await saveJSON(path, value, replace);
}
async function immutable(path, value) {
  try { await persist(path, value); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
}
export async function initializeApplicationGroups(root) {
  await directory(join(root, 'application-groups'));
  await directory(join(root, 'application-group-reviews'));
}
async function group(root, id) {
  const value = await readJSON(join(groupPath(root, id), 'group.json'));
  need(value?.schema === GROUP && value.id === id && Array.isArray(value.applicationIds), 'APPLICATION_GROUP_RECORD_CHANGED');
  revision(value.revision);
  return value;
}
async function savedApplication(root, id) {
  const saved = await readJSON(appPath(root, id));
  need(saved?.schema === 'stellar-forge.runtime-application.v1' && saved.id === id, 'APPLICATION_GROUP_MEMBER_CHANGED');
  revision(saved.revision);
  return saved;
}
async function runRecord(root, groupId, id, optional = false) {
  const value = await readJSON(runPath(root, groupId, id), optional);
  if (!value && optional) return null;
  need(value?.schema === RUN && value.id === id && value.groupId === groupId &&
    Array.isArray(value.members) && Number.isInteger(value.version), 'APPLICATION_GROUP_RUN_CHANGED');
  return value;
}
async function withGroup(root, id, work) {
  await privateDirectory(groupPath(root, id));
  const lease = await operationLease(join(groupPath(root, id), 'group.lock'));
  try { return await work(); } finally { await lease.close(); }
}
async function saveRun(root, run) {
  run.version++;
  run.updatedAt = now();
  await persist(runPath(root, run.groupId, run.id), run, true);
}
const originalInput = member => ({ applicationId: member.applicationId, operationId: member.operationId });
const memberKeys = member => member.approved.resourceKeys ?? [member.approved.resourceKey];
const same = (a, b) => hash(a) === hash(b);

// homeRevision is the original managed-home optimistic concurrency token.
// Every dispatch obtains a current original review and retains its exact token.
// All source, command, input, release and resource fields remain in this identity.
export function applicationGroupReviewIdentity(review) {
  const { id, reviewedAt, homeRevision, ...identity } = review;
  return identity;
}
function memberPhase(operation) {
  if (operation.phase !== 'SUCCEEDED') return operation.phase;
  const result = operation.result ?? operation.state?.result;
  if (result?.state === 'COMPLETED' && result.exitCode === 0) return 'SUCCEEDED';
  if (['EXITED', 'LAUNCH_FAILED'].includes(result?.state)) return 'FAILED';
  if (['STOPPED', 'CANCELLED'].includes(result?.state)) return 'CANCELLED';
  return result?.state === 'RECONCILED' ? 'RECONCILED' : 'OUTCOME_UNAVAILABLE';
}
const acceptedFinalPhases = ['FAILED', 'CANCELLED', 'RECONCILED', 'OUTCOME_UNAVAILABLE'];
function outcomeIdentity(operation) {
  return hash({ phase: operation.phase, result: operation.result ?? operation.state?.result ?? null,
    error: operation.state?.error ?? null, stop: operation.stop ?? null });
}
function accepted(member, operation) {
  return member.acceptedOutcome?.identity === outcomeIdentity(operation);
}
function settledOrLaunched(member, operation) {
  if (!operation || operation.active === null) return false;
  const phase = memberPhase(operation);
  if (phase === 'SUCCEEDED') return true;
  if (phase === 'RUNNING' && operation.active && !operation.stop && operation.state?.commandProcess) return true;
  return !operation.active && acceptedFinalPhases.includes(phase) && accepted(member, operation);
}
async function observedMembers(root, run, observations = null, receiving = null) {
  return Promise.all(run.members.map(async member => {
    const operation = await applicationRunState(root, originalInput(member), observations, receiving);
    return { ...member, operation, operationPhase: operation ? memberPhase(operation) : null };
  }));
}
function progress(run, members) {
  const uncertain = members.some(member => member.operation?.active === null ||
    member.operation?.phase === 'OBSERVATION_UNAVAILABLE');
  const next = members.find(member => !member.operation);
  let waiting = null;
  for (const member of members) {
    if (!member.operation) break;
    if (!settledOrLaunched(member, member.operation)) { waiting = member; break; }
    if (next && member.operation.active && memberKeys(member).some(key => memberKeys(next).includes(key))) {
      waiting = member; break;
    }
  }
  const outstanding = members.some(member => member.operation &&
    (member.operation.active !== false || ['PENDING', 'QUEUED', 'RUNNING', 'INTERRUPTED', 'OBSERVATION_UNAVAILABLE'].includes(member.operation.phase)));
  const needsReview = Boolean(next?.error?.code === 'APPLICATION_GROUP_REVIEW_CHANGED');
  const phase = uncertain ? 'OBSERVATION_UNAVAILABLE' : run.stopRequestedAt ? (outstanding ? 'STOPPING' : 'STOPPED') :
    needsReview ? 'REVIEW_REQUIRED' : waiting ? 'ATTENTION' :
    !next ? (members.every(member => member.operation && !member.operation.active) ? 'COMPLETED' : 'LAUNCHED') : members.some(member => member.operation) ? 'IN_PROGRESS' : 'REVIEWED';
  return { phase, nextApplicationId: next?.applicationId ?? null,
    waitingApplicationId: waiting?.applicationId ?? null,
    canContinue: !uncertain && !run.stopRequestedAt && Boolean(next) && !waiting && !needsReview,
    started: members.filter(member => member.operation).length, total: members.length };
}
async function runView(root, run, observations = null, receiving = null) {
  const members = await observedMembers(root, run, observations, receiving);
  return { ...run, ...progress(run, members), members };
}
export async function applicationGroupsState(root, { groupId = null, runId = null, limit = 20, cursor = null } = {}, observations = null,
  receiving = createWorkspaceReceivingReader(root)) {
  if (!observations) await initializeApplicationGroups(root);
  need(Number.isInteger(limit) && limit >= 1 && limit <= 50, 'APPLICATION_GROUP_PAGE_INVALID');
  if (cursor) operationId(cursor);
  const ids = (await (observations ? optionalPrivateEntries(join(root, 'application-groups')) :
    readdir(join(root, 'application-groups')))).filter(name => /^[a-f0-9]{24}$/.test(name));
  const groups = [];
  for (const id of ids) {
    const value = await readJSON(join(groupPath(root, id), 'group.json'), true);
    if (!value) continue; // A new save may still be installing its first definition.
    need(value.schema === GROUP && value.id === id, 'APPLICATION_GROUP_RECORD_CHANGED');
    const current = await readJSON(join(groupPath(root, id), 'current.json'), true);
    groups.push({ ...value, currentRunId: current?.runId ?? null });
  }
  groups.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  if (!groupId) return { schema: 'stellar-forge.application-groups.v1', groups, selected: null };
  const selected = await group(root, recordId(groupId));
  const names = (await readdir(join(groupPath(root, groupId), 'runs'))).filter(name => /^[a-f0-9-]{36}\.json$/.test(name));
  const history = await Promise.all(names.map(name => runRecord(root, groupId, name.slice(0, -5))));
  history.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  let start = 0;
  if (cursor) {
    const index = history.findIndex(item => item.id === cursor);
    need(index >= 0, 'APPLICATION_GROUP_CURSOR_CHANGED');
    start = index + 1;
  }
  const page = history.slice(start, start + limit), current = await readJSON(join(groupPath(root, groupId), 'current.json'), true);
  const selectedRunId = runId ?? current?.runId ?? null;
  return { schema: 'stellar-forge.application-groups.v1', groups, selected: { ...selected,
    currentRunId: current?.runId ?? null,
    history: { items: page.map(item => ({ id: item.id, label: item.label, groupRevision: item.groupRevision,
      createdAt: item.createdAt, updatedAt: item.updatedAt, stopped: Boolean(item.stopRequestedAt), members: item.members.length })),
      total: history.length, nextCursor: start + page.length < history.length ? page.at(-1).id : null },
    run: selectedRunId ? await runView(root, await runRecord(root, groupId, selectedRunId), observations, receiving) : null } };
}
export async function saveApplicationGroup(root, { requestId, groupId = null, expectedRevision = null, label, applicationIds } = {}) {
  operationId(requestId);
  need(typeof label === 'string' && label.trim() && label.trim().length <= 120, 'APPLICATION_GROUP_LABEL_REQUIRED');
  need(Array.isArray(applicationIds) && applicationIds.length >= 1 && applicationIds.length <= 32 &&
    new Set(applicationIds).size === applicationIds.length, 'APPLICATION_GROUP_MEMBERS_INVALID', 'Choose 1 to 32 distinct saved Applications.');
  applicationIds.forEach(recordId);
  await initializeApplicationGroups(root);
  for (const id of applicationIds) await savedApplication(root, id);
  const id = groupId ? recordId(groupId) : digest('application-group:' + requestId).slice(0, 24);
  await directory(groupPath(root, id));
  await directory(join(groupPath(root, id), 'revisions'));
  await directory(join(groupPath(root, id), 'runs'));
  return withGroup(root, id, async () => {
    const previous = await readJSON(join(groupPath(root, id), 'group.json'), true);
    const definition = { schema: GROUP, id, label: label.trim(), applicationIds: [...applicationIds] };
    const nextRevision = hash(definition);
    if (previous?.revision === nextRevision) return { ...previous, saved: true, reopened: true };
    if (groupId) need(previous && previous.revision === revision(expectedRevision), 'APPLICATION_GROUP_EDIT_CHANGED',
      'Reopen this group before saving over another edit.', 409);
    else need(!previous, 'APPLICATION_GROUP_SAVE_ID_REUSED');
    const value = { ...definition, revision: nextRevision, createdAt: previous?.createdAt ?? now(), updatedAt: now() };
    await immutable(join(groupPath(root, id), 'revisions', nextRevision + '.json'), value);
    await persist(join(groupPath(root, id), 'group.json'), value, Boolean(previous));
    return { ...value, saved: true };
  });
}
export async function reviewApplicationGroup(root, { groupId, runId = null, navigationOrigin = null } = {}) {
  const selected = await group(root, recordId(groupId));
  return withGroup(root, groupId, async () => {
    const run = runId ? await runRecord(root, groupId, runId) : null;
    need(!run?.stopRequestedAt, 'APPLICATION_GROUP_STOPPED');
    const observed = run ? await observedMembers(root, run) : [];
    const ids = run ? observed.filter(member => !member.operation).map(member => member.applicationId) : selected.applicationIds;
    need(ids.length, 'APPLICATION_GROUP_NOTHING_TO_REVIEW', 'Every member already has its original operation.');
    const members = [];
    for (const applicationId of ids) {
      try {
        const saved = await savedApplication(root, applicationId);
        const review = await reviewApplicationStart(root, applicationId, { navigationOrigin });
        need(saved.revision === review.applicationRevision, 'APPLICATION_GROUP_MEMBER_CHANGED', 'Refresh the saved Application and review it again.', 409);
        members.push({ applicationId, label: saved.label, kind: saved.kind,
          applicationRevision: saved.revision, review, approved: applicationGroupReviewIdentity(review) });
      } catch (error) { members.push({ applicationId, error: errorView(error) }); }
    }
    const overlaps = [];
    for (let i = 0; i < members.length; i++) for (let j = 0; j < i; j++) {
      if (members[i].approved && members[j].approved && memberKeys(members[i]).some(key => memberKeys(members[j]).includes(key)))
        overlaps.push({ applicationId: members[i].applicationId, afterApplicationId: members[j].applicationId });
    }
    const value = { schema: REVIEW, groupId, groupRevision: run?.groupRevision ?? selected.revision,
      label: run?.label ?? selected.label, runId, runVersion: run?.version ?? null,
      ready: members.every(member => member.review), members, overlaps,
      ...(navigationOrigin !== null ? { navigationOrigin } : {}) };
    if (!value.ready) return { ...value, id: null, reviewedAt: now() };
    const id = hash(value).slice(0, 24);
    await immutable(reviewPath(root, id), { ...value, id, reviewedAt: now() });
    return readJSON(reviewPath(root, id));
  });
}
async function readReview(root, groupId, id) {
  const review = await readJSON(reviewPath(root, id));
  need(review?.schema === REVIEW && review.groupId === groupId && review.ready === true, 'APPLICATION_GROUP_REVIEW_REQUIRED');
  return review;
}
function checkVersion(run, expectedVersion) {
  need(Number.isInteger(expectedVersion) && expectedVersion === run.version, 'APPLICATION_GROUP_PROGRESS_CHANGED',
    'Refresh the retained group run before changing its progress.', 409);
}
async function advanceLocked(root, run, input, lifecycle) {
  need(!run.stopRequestedAt, 'APPLICATION_GROUP_STOPPED');
  const members = await observedMembers(root, run);
  const member = run.members.find(item => item.applicationId === recordId(input.applicationId));
  need(member, 'APPLICATION_GROUP_MEMBER_CHANGED');
  const existing = members.find(item => item.applicationId === member.applicationId).operation;
  if (existing) return { ...await runView(root, run), reopened: true };
  checkVersion(run, input.expectedVersion);
  const current = progress(run, members);
  need(current.nextApplicationId === member.applicationId, 'APPLICATION_GROUP_ORDER_CHANGED');
  need(!current.waitingApplicationId, 'APPLICATION_GROUP_PREVIOUS_MEMBER_PENDING',
    'Open, recover or accept the previous member result before continuing. Shared workspaces must finish first.', 409);
  try {
    const review = await reviewApplicationStart(root, member.applicationId, {
      navigationOrigin: member.approved.navigationOrigin ?? null,
    });
    need(same(applicationGroupReviewIdentity(review), member.approved), 'APPLICATION_GROUP_REVIEW_CHANGED',
      'A remaining Application, provider, input or release changed. Review the remaining members.', 409);
    member.launchReviewId = review.id;
    member.launchHomeRevision = review.homeRevision;
    member.attemptedAt = now();
    member.error = null;
    await saveRun(root, run); // Original request identity survives a lost dispatch response.
    const result = await lifecycle.start({ applicationId: member.applicationId,
      requestId: member.operationId, reviewId: member.launchReviewId });
    member.dispatchedAt = now();
    member.dispatchResult = { operationId: result.operationId ?? member.operationId, reopened: Boolean(result.reopened) };
  } catch (error) { member.error = errorView(error); }
  await saveRun(root, run);
  return runView(root, run);
}
export async function startApplicationGroup(root, { groupId, requestId, reviewId } = {}, lifecycle) {
  operationId(requestId);
  return withGroup(root, recordId(groupId), async () => {
    const existing = await runRecord(root, groupId, requestId, true);
    if (existing) {
      need(existing.approvalReviewId === reviewId, 'APPLICATION_GROUP_RUN_ID_REUSED');
      const pointer = await readJSON(join(groupPath(root, groupId), 'current.json'), true);
      if (!pointer || pointer.runId === existing.previousRunId)
        await persist(join(groupPath(root, groupId), 'current.json'), { groupId, runId: requestId }, true);
      return { ...await runView(root, existing), reopened: true };
    }
    const selected = await group(root, groupId), review = await readReview(root, groupId, reviewId);
    need(review.runId === null && review.groupRevision === selected.revision &&
      same(review.members.map(member => member.applicationId), selected.applicationIds), 'APPLICATION_GROUP_REVIEW_CHANGED');
    const current = await readJSON(join(groupPath(root, groupId), 'current.json'), true);
    if (current) {
      const previous = await runRecord(root, groupId, current.runId);
      need(previous.stopRequestedAt || (await observedMembers(root, previous)).every(member => member.operation),
        'APPLICATION_GROUP_RUN_PENDING', 'Continue or stop the current launch sequence before beginning another one.', 409);
    }
    const run = { schema: RUN, id: requestId, groupId, groupRevision: selected.revision,
      label: review.label, approvalReviewId: review.id, previousRunId: current?.runId ?? null, version: 1, createdAt: now(), updatedAt: now(),
      members: review.members.map(member => ({ applicationId: member.applicationId, label: member.label, kind: member.kind,
        applicationRevision: member.applicationRevision, approved: member.approved, approvedReviewId: member.review.id,
        approvedHomeRevision: member.review.homeRevision,
        operationId: uuidFrom('application-group:' + requestId + ':' + member.applicationId) })) };
    await persist(runPath(root, groupId, requestId), run);
    await persist(join(groupPath(root, groupId), 'current.json'), { groupId, runId: requestId }, true);
    return advanceLocked(root, run, { applicationId: run.members[0].applicationId, expectedVersion: run.version }, lifecycle);
  });
}
export async function continueApplicationGroup(root, input = {}, lifecycle) {
  return withGroup(root, recordId(input.groupId), async () =>
    advanceLocked(root, await runRecord(root, input.groupId, input.runId), input, lifecycle));
}
export async function applyApplicationGroupReview(root, { groupId, runId, reviewId, expectedVersion } = {}) {
  return withGroup(root, recordId(groupId), async () => {
    const run = await runRecord(root, groupId, runId), review = await readReview(root, groupId, reviewId);
    need(!run.stopRequestedAt, 'APPLICATION_GROUP_STOPPED');
    if (run.remainingReviewId === reviewId) return { ...await runView(root, run), reopened: true };
    checkVersion(run, expectedVersion);
    need(review.runId === runId && review.runVersion === run.version, 'APPLICATION_GROUP_REVIEW_CHANGED');
    const pending = (await observedMembers(root, run)).filter(member => !member.operation).map(member => member.applicationId);
    need(same(pending, review.members.map(member => member.applicationId)), 'APPLICATION_GROUP_REVIEW_CHANGED');
    for (const selected of review.members) {
      const member = run.members.find(item => item.applicationId === selected.applicationId);
      Object.assign(member, { label: selected.label, kind: selected.kind, applicationRevision: selected.applicationRevision,
        approved: selected.approved, approvedReviewId: selected.review.id, approvedHomeRevision: selected.review.homeRevision, error: null });
    }
    run.remainingReviewId = reviewId;
    await saveRun(root, run);
    return runView(root, run);
  });
}
export async function applicationGroupMemberAction(root, { groupId, runId, applicationId, action, expectedVersion } = {}, lifecycle) {
  need(['recover', 'stop', 'accept-result'].includes(action), 'APPLICATION_GROUP_ACTION_INVALID');
  return withGroup(root, recordId(groupId), async () => {
    const run = await runRecord(root, groupId, runId);
    const member = run.members.find(item => item.applicationId === recordId(applicationId));
    need(member, 'APPLICATION_GROUP_MEMBER_CHANGED');
    const original = await applicationRunState(root, originalInput(member));
    need(original, 'APPLICATION_GROUP_MEMBER_NOT_LAUNCHED');
    if (action === 'accept-result') {
      checkVersion(run, expectedVersion);
      need(!run.stopRequestedAt && !original.active && acceptedFinalPhases.includes(memberPhase(original)),
        'APPLICATION_GROUP_RESULT_NOT_FINAL', 'Recover an interrupted operation or wait for it to finish.');
      member.acceptedOutcome = { identity: outcomeIdentity(original), phase: memberPhase(original), acceptedAt: now() };
    } else {
      need(action === 'stop' || !run.stopRequestedAt, 'APPLICATION_GROUP_STOPPED');
      try {
        const result = await lifecycle[action](originalInput(member));
        member.lastAction = { action, at: now(), operationId: member.operationId,
          reopened: Boolean(result.reopened), running: Boolean(result.running) };
        member.error = null;
      } catch (error) { member.error = errorView(error); }
    }
    await saveRun(root, run);
    return runView(root, run);
  });
}
export async function stopApplicationGroup(root, { groupId, runId } = {}, lifecycle) {
  return withGroup(root, recordId(groupId), async () => {
    const run = await runRecord(root, groupId, runId);
    if (!run.stopRequestedAt) {
      run.stopRequestedAt = now();
      await saveRun(root, run); // No further member is dispatched after this durable stop.
    }
    for (const member of run.members) {
      const operation = await applicationRunState(root, originalInput(member));
      if (!operation || (!operation.active && !['PENDING', 'QUEUED', 'RUNNING', 'INTERRUPTED'].includes(operation.phase))) continue;
      try {
        await lifecycle.stop(originalInput(member));
        member.stopRequestedAt = now(); member.stopError = null;
      } catch (error) { member.stopError = errorView(error); }
      await saveRun(root, run);
    }
    return runView(root, run);
  });
}
