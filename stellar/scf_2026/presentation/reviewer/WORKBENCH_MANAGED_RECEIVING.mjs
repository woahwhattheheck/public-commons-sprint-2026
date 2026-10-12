/** MIT. Full maintained Applications receiving for the original retained grant workbench. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash, randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {readSourceFile} from './workspace.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const unfinished = run => Boolean(run && (run.active ||
  ['PENDING', 'QUEUED', 'RUNNING', 'INTERRUPTED'].includes(run.phase)));
const exists = async path => {
  try { await readFile(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
};

/**
 * Continue the SAME private receiving journal after its direct workbenches close.
 * The selected runtime is inspected and adopted through the maintained APIs.
 * This function never prepares or installs another runtime and never buys data.
 */
export async function receiveManagedGrantReviewer({operation, sourceRoot, runtimeDirectory,
  workbenchDirectory, selectionId, packetSha256, workbenchId, record, checkpoint, inspectLive,
  cancelled = () => false} = {}) {
  assert(record && typeof checkpoint === 'function' && typeof inspectLive === 'function');
  const runtimeRoot = resolve(runtimeDirectory), applicationsDirectory = join(resolve(operation), 'applications');
  const {inspectMerchantRuntime} = await import(pathToFileURL(join(resolve(sourceRoot),
    'stellar/scf-starforge-20261009/sf46-release/runtime-package.mjs')).href);
  const selected = await inspectMerchantRuntime(runtimeRoot, {load:false});
  const binding = Object.fromEntries(['directory','installationId','profileId','profileSha256',
    'lockSha256','sourceCommit','sourceManifestSha256','sourceRoot'].map(key => [key, selected[key]]));
  if (record.runtime) assert.deepEqual(record.runtime, binding, 'Continue the original reviewed installed runtime.');
  else record.runtime = binding;
  assert.equal(resolve(selected.directory), runtimeRoot);
  const moduleRoot = join(selected.sourceRoot, 'stellar/scf-starforge-20261009/distribution/runtime-workspace');
  const {createRuntimeWorkspace, openRuntimeWorkspace} = await import(pathToFileURL(join(moduleRoot, 'model.mjs')).href);
  const {prepareApplicationStart} = await import(pathToFileURL(join(moduleRoot, 'applications.mjs')).href);
  const {operationRunning} = await import(pathToFileURL(join(moduleRoot, 'storage.mjs')).href);
  const descriptor = {applicationsDirectory, workbenchDirectory:resolve(workbenchDirectory),
    selectionId, packetSha256, workbenchId};
  if (record.input) assert.deepEqual(record.input, descriptor);
  else record.input = descriptor;
  record.saveId ??= randomUUID(); record.steps ??= {}; record.initialStarts ??= []; record.recoveryStarts ??= [];
  const save = async (step, result) => {
    if (step) record.steps[step] = {...result, completedAt:new Date().toISOString()};
    await checkpoint();
  };
  const check = () => assert(!cancelled(), 'The original managed receiving was cancelled.');
  await save();
  let model = null, primaryError = null;
  async function application() {
    assert(model);
    const state = await model.applicationsState();
    const value = state.applications.find(item => item.id === record.applicationId);
    assert(value, 'Reopen the original saved grant-reviewer application.');
    assert.equal(value.runtimeId, record.runtimeId); assert.equal(value.kind, 'grant-reviewer');
    assert.equal(value.settings.directory, descriptor.workbenchDirectory);
    return value;
  }
  async function until(predicate, label) {
    const deadline = Date.now() + 90000;
    for (;;) {
      check();
      const value = await application();
      if (predicate(value)) return value;
      if (value.phase === 'UNAVAILABLE' || value.adoption && ['FAILED','CANCELLED'].includes(value.adoption.phase))
        throw new Error(label + ': retained native phase ' + (value.adoption?.phase ?? value.phase));
      if (Date.now() >= deadline) throw new Error(label + ': the original operation remains at ' + value.phase);
      await delay(250);
    }
  }
  async function waitRunning(id, label) {
    return until(value => {
      assert.equal(value.current?.id, id, 'Follow the selected original managed operation.');
      if (!unfinished(value.current) || value.current.stop)
        throw new Error(label + ': the selected original run ended before its listener became ready.');
      return Boolean(value.current.privateUrl);
    }, label);
  }
  async function stopCurrent() {
    let value = await application(), current = value.current;
    if (!unfinished(current)) return current;
    const id = current.id;
    await model.applicationsStop({applicationId:record.applicationId, operationId:id});
    const deadline = Date.now() + 90000;
    for (;;) {
      value = await application(); current = value.runs.find(run => run.id === id);
      assert(current, 'The original stopped run remains retained.');
      if (!unfinished(current)) return current;
      if (current.phase === 'INTERRUPTED' && !current.active) {
        try { await model.applicationsRecover({applicationId:record.applicationId, operationId:id}); }
        catch (error) { if (error.code !== 'RUNTIME_WORKSPACE_OPERATION_RUNNING') throw error; }
      }
      if (Date.now() >= deadline) throw new Error('Original managed stop remains at ' + current.phase);
      await delay(250);
    }
  }
  async function recoverCurrent(value) {
    const current = value.current;
    if (!unfinished(current)) return value;
    if (current.stop) { await stopCurrent(); return application(); }
    if (!current.active) {
      const result = await model.applicationsRecover({applicationId:record.applicationId, operationId:current.id});
      value = await application();
      if (result.commandActive && !value.current.active) {
        // The maintained engine recognizes its surviving child. Its own stop
        // and reconciliation finish that run before a reviewed new start.
        await stopCurrent(); return application();
      }
    }
    value = await application();
    return unfinished(value.current) ? waitRunning(value.current.id, 'Original application recovery') : value;
  }
  async function begin(scope, preparedRecovery = false) {
    let value = await application();
    if (preparedRecovery && unfinished(value.current)) {
      const planned = record[scope].find(item => item.requestId === value.current.id);
      if (planned && !planned.recoveredAfterControllerReopen) {
        assert(value.runs.some(run => run.id === planned.requestId));
        // A response can be lost after the pending run or dispatch is saved.
        // Reopen the controller and reconcile that exact original ID.
        planned.prepared = true; await save();
        await model.close(); model = await openRuntimeWorkspace({directory:applicationsDirectory});
        check();
        await model.applicationsRecover({applicationId:record.applicationId,operationId:planned.requestId});
        planned.recoveredAfterControllerReopen = true; await save();
        value = await application();
      }
    }
    value = await recoverCurrent(value);
    if (unfinished(value.current)) return waitRunning(value.current.id, 'Original application reattachment');
    check();
    const reviewed = await model.applicationsStartReview({applicationId:record.applicationId});
    const attempts = record[scope], previous = attempts.at(-1);
    let planned = previous && previous.reviewId === reviewed.id && !value.runs.some(run => run.id === previous.requestId)
      ? previous : null;
    if (!planned) {
      planned = {requestId:randomUUID(), reviewId:reviewed.id, createdAt:new Date().toISOString()};
      attempts.push(planned); await save();
    }
    if (preparedRecovery) {
      check();
      const pending = await prepareApplicationStart(applicationsDirectory, {
        applicationId:record.applicationId, requestId:planned.requestId, reviewId:planned.reviewId});
      assert.equal(pending.id, planned.requestId);
      planned.prepared = true; await save();
      await model.close(); model = await openRuntimeWorkspace({directory:applicationsDirectory});
      const retained = (await application()).runs.find(run => run.id === planned.requestId);
      assert(retained && retained.phase === 'PENDING', 'The saved original start has no dispatched child.');
      check();
      const dispatched = await model.applicationsRecover({applicationId:record.applicationId, operationId:planned.requestId});
      if (dispatched.operationId) assert.equal(dispatched.operationId, planned.requestId);
      planned.recoveredAfterControllerReopen = true; await save();
    } else {
      check();
      const started = await model.applicationsStart({applicationId:record.applicationId,
        requestId:planned.requestId, reviewId:planned.reviewId});
      assert.equal(started.operationId, planned.requestId);
    }
    return waitRunning(planned.requestId, 'Original application startup');
  }
  async function connection(value) {
    assert(value.current?.active && value.current.privateUrl);
    const original = value.current.url.original, url = new URL(value.current.privateUrl);
    assert.equal(original.directory, descriptor.workbenchDirectory);
    assert.equal(original.workbenchId, descriptor.workbenchId);
    assert.equal(original.connectionFile, join(descriptor.workbenchDirectory, 'workbench-connection.json'));
    const privateRecord = JSON.parse(await readSourceFile(original.connectionFile, {privateFile:true,maxBytes:16384}));
    assert(privateRecord.active); assert.equal(privateRecord.instanceId, original.instanceId);
    assert.equal(privateRecord.workbenchId, descriptor.workbenchId);
    const accessToken = decodeURIComponent(url.hash.slice(1));
    assert.equal(accessToken, privateRecord.accessToken);
    const health = await fetch(new URL('/health', url), {redirect:'error',signal:AbortSignal.timeout(10000)});
    assert(health.ok);
    const observed = await health.json();
    assert.equal(observed.instanceId, original.instanceId); assert.equal(observed.workbenchId, descriptor.workbenchId);
    return {url:url.origin + '/', address:url.origin, accessToken, instanceId:original.instanceId,
      workbenchId:original.workbenchId, model:{directory:descriptor.workbenchDirectory}};
  }
  async function closedState(operationId) {
    const value = await application(), run = value.runs.find(item => item.id === operationId);
    assert(run && !unfinished(run)); assert.equal(value.current?.privateUrl ?? null, null);
    assert.equal(await operationRunning(join(descriptor.workbenchDirectory, 'workbench.lock')), false);
    let privateConnectionRemoved = false;
    try {
      const privateRecord = JSON.parse(await readSourceFile(join(descriptor.workbenchDirectory,
        'workbench-connection.json'), {privateFile:true,maxBytes:16384}));
      assert.equal(privateRecord.active, false);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // The original workbench removes its own credential if deactivation
      // cannot be saved. The kernel lease above still proves closure.
      privateConnectionRemoved = true;
    }
    return {operationId, phase:run.phase, active:false, originalWorkbenchLeaseReleased:true,privateConnectionRemoved};
  }
  try {
    check();
    if (!await exists(join(applicationsDirectory, 'workspace.json')))
      await createRuntimeWorkspace({directory:applicationsDirectory});
    model = await openRuntimeWorkspace({directory:applicationsDirectory});
    const attached = await model.attach({directory:runtimeRoot, label:'Original grant reviewer runtime'});
    if (record.runtimeId) assert.equal(record.runtimeId, attached.runtimeId); else record.runtimeId = attached.runtimeId;
    const catalog = await model.applicationsState();
    assert(catalog.catalog.some(item => item.id === 'grant-reviewer'),
      'Select the maintained distribution containing the grant-reviewer contribution.');
    if (!record.applicationId) {
      const retained = catalog.applications.find(item => item.saveRequestId === record.saveId);
      if (retained) {
        assert.equal(retained.kind, 'grant-reviewer'); assert.equal(retained.runtimeId, record.runtimeId);
        assert.equal(retained.settings.directory, descriptor.workbenchDirectory);
        record.applicationId = retained.id; record.reviewId = retained.reviewId;
      } else {
        if (!record.reviewId) {
          check();
          const reviewed = await model.applicationsReview({runtimeId:record.runtimeId, kind:'grant-reviewer',
            label:'Original grant purchase reviewer', settings:{directory:descriptor.workbenchDirectory,port:0}});
          record.reviewId = reviewed.id; await save();
        }
        check();
        const saved = await model.applicationsSave({requestId:record.saveId,reviewId:record.reviewId});
        assert(saved.saved); record.applicationId = saved.applicationId;
      }
      await save('saved', {applicationId:record.applicationId,reviewId:record.reviewId,runtimeId:record.runtimeId});
    }
    check(); await model.applicationsConnect({applicationId:record.applicationId});
    const connected = await until(value => Boolean(value.release), 'Original runtime adoption');
    assert.equal(connected.release.sourceCommit, selected.sourceCommit);
    if (!record.steps.connected) await save('connected', {releaseId:connected.release.id,
      releaseDigest:connected.release.digest,homeId:connected.home.id,sourceCommit:connected.release.sourceCommit});
    if (!record.steps.retained_launch) {
      let active = await begin('initialStarts'), opened = await connection(active);
      const originalId = active.current.id, originalInstance = opened.instanceId;
      const reopened = await openRuntimeWorkspace({directory:applicationsDirectory});
      const same = (await reopened.applicationsState()).applications.find(item => item.id === record.applicationId);
      assert.equal(same.current.id, originalId); assert.equal(same.current.url.original.instanceId, originalInstance);
      check();
      const recovered = await reopened.applicationsRecover({applicationId:record.applicationId,operationId:originalId});
      assert(recovered.reopened && (recovered.running || recovered.commandActive));
      await model.close(); model = reopened;
      const result = await inspectLive(opened, 'managed_original', record);
      await save('retained_launch', {operationId:originalId,instanceId:originalInstance,
        accessCodeSha256:sha(opened.accessToken),sameOperationAfterControllerReopen:true,result});
    }
    if (!record.steps.original_stop) {
      await stopCurrent();
      await save('original_stop', await closedState(record.steps.retained_launch.operationId));
    }
    if (!record.steps.prepared_restart) {
      const active = await begin('recoveryStarts', true), opened = await connection(active);
      assert.notEqual(opened.instanceId, record.steps.retained_launch.instanceId);
      assert.notEqual(sha(opened.accessToken), record.steps.retained_launch.accessCodeSha256);
      const result = await inspectLive(opened, 'managed_prepared_recovery', record);
      const planned = record.recoveryStarts.find(item => item.requestId === active.current.id);
      assert(planned?.prepared && planned.recoveredAfterControllerReopen);
      await save('prepared_restart', {operationId:active.current.id,instanceId:opened.instanceId,
        originalPreparedRequest:planned.requestId,freshPrivateAccessCode:true,result});
    }
    if (!record.steps.closed_reopen) {
      await stopCurrent();
      const closed = await closedState(record.steps.prepared_restart.operationId);
      await model.close(); model = await openRuntimeWorkspace({directory:applicationsDirectory});
      const retained = await application();
      assert(retained.runs.every(run => !unfinished(run)));
      assert.equal(retained.runtime.installationId, selected.installationId);
      assert.equal(retained.release.id, record.steps.connected.releaseId);
      const header = JSON.parse(await readSourceFile(join(descriptor.workbenchDirectory,'workbench.json'),{privateFile:true}));
      assert.equal(header.id, descriptor.workbenchId);
      await save('closed_reopen', {...closed,applicationId:retained.id,applicationRevision:retained.revision,
        installationId:selected.installationId,releaseId:retained.release.id,totalRetainedRuns:retained.runs.length});
    }
    record.state = 'COMPLETE'; await save();
  } catch (error) {
    primaryError = error;
    record.state = 'CONTINUATION_REQUIRED';
    record.failures ??= [];
    record.failures.push({at:new Date().toISOString(),code:error.code ?? error.name,message:error.message});
    await save();
  } finally {
    const cleanup = {managedControllerClosed:false,ownedApplicationClosed:!record.applicationId};
    try {
      if (model && record.applicationId) {
        await stopCurrent();
        const final = await application();
        cleanup.ownedApplicationClosed = final.runs.every(run => !unfinished(run));
      }
    } catch (error) {
      cleanup.error = {code:error.code ?? error.name,message:error.message};
      primaryError ??= error;
    }
    try { await model?.close(); cleanup.managedControllerClosed = true; }
    catch (error) { primaryError ??= error; }
    record.cleanup = cleanup;
    if (primaryError) record.state = 'CONTINUATION_REQUIRED';
    await save();
  }
  if (primaryError) throw primaryError;
  assert(record.cleanup.ownedApplicationClosed && record.cleanup.managedControllerClosed);
  return record;
}
