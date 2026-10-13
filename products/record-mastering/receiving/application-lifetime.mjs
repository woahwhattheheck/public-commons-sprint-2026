// MIT. One receiving course retains the original Applications request and closure.
import { join } from 'node:path';
import { readdir } from 'node:fs/promises';

export function createReceivingApplicationLifetime({ root, selection, stepDirectory, product, Product,
  readJSON, saveJSON, openRuntimeWorkspace, operationId: validateOperationId, need, pause, sha, json, shouldStop = () => false }) {
  let model = null, opening = null, closing = null;
  const selectedHere = new Map();
  const report = value => { try { process.stderr.write(JSON.stringify(value) + '\n'); } catch {} };
  const slotPattern = /^(first|reopen)(?:-resume-[0-9]{5})?$/;
  const closedPath = slot => join(root, 'application-' + slot + '-closed.json');
  const startPath = slot => join(stepDirectory, 'application-' + slot + '-start.json');
  const validTime = x => typeof x === 'string' && Number.isFinite(Date.parse(x));
  const same = (a,b) => json(a) === json(b);
  const cancelled = (v, applicationId, operationId) =>
    v?.schema === 'stellar-forge.application-run-cancellation.v1' &&
    v.applicationId === applicationId && v.operationId === operationId &&
    v.state === 'CANCELLED' && v.launched === false;
  const completed = (v, operationId) => {
    const r = v?.commandResult;
    return v?.operationId === operationId && v.active === false && v.phase === 'SUCCEEDED' &&
      r?.operation === 'original-command' && validTime(r.completedAt) &&
      (r.state === 'STOPPED' && r.stopped === true && r.launched === false ||
       r.launched === true && ['STOPPED','COMPLETED','EXITED'].includes(r.state) &&
         (Number.isInteger(r.exitCode) || typeof r.signal === 'string' && r.signal.length > 0) ||
       r.state === 'LAUNCH_FAILED' && r.exitCode === null && r.signal === null && r.error &&
         r.closure?.schema === 'stellar-forge.managed-command-closure.v1' &&
         typeof r.closure.childCreated === 'boolean' && r.closure.childClosed === true &&
         typeof r.closure.observerCreated === 'boolean' && r.closure.observerClosed === true);
  };
  async function selected(slot, operationId = null) {
    need(slotPattern.test(slot), 'Retain the original receiving application slot.');
    const entry = await readJSON(startPath(slot), true);
    const memory = selectedHere.get(slot);
    if (!entry && !memory) return null;
    const request = entry?.request ?? memory;
    if (entry) need(entry.name === 'application-' + slot + '-start' &&
      entry.requestSha256 === sha(json(request)), 'The original application Start request changed.');
    need(request.directory === product && typeof request.requestId === 'string' &&
      (!operationId || operationId === request.requestId), 'Retain the same original application Start ID.');
    validateOperationId(request.requestId);
    const state = await Product.masteringProductStatus({ directory: product });
    const applicationId = state.saved?.applicationId;
    need(typeof applicationId === 'string', 'The original saved application is required for closure.');
    const launch = await readJSON(join(product, 'starts', request.requestId + '.json'), true);
    if (launch) need(launch.schema === Product.PRODUCT_SCHEMA + '.start' &&
      launch.request.applicationId === applicationId && launch.request.requestId === request.requestId &&
      typeof launch.request.reviewId === 'string' && launch.review?.id === launch.request.reviewId,
      'The original product launch identity changed.');
    return { slot, request, applicationId, operationId: request.requestId, launch };
  }
  function validateProof(proof, owned) {
    const unentered = proof.unentered?.schema === 'stellar-forge.receiving-unentered-launch.v1' &&
      proof.unentered.state === 'CANCELLED_BEFORE_DISPATCH' && proof.unentered.nativeRunObserved === false;
    need(proof.schema === 'stellar-forge.record-mastering-receiving-closure.v1' &&
      proof.receivingOperationId === selection.operationId && proof.sourceCommit === selection.sourceCommit &&
      proof.slot === owned.slot && proof.applicationId === owned.applicationId &&
      proof.operationId === owned.operationId && same(proof.startRequest, owned.request) && validTime(proof.closedAt) &&
      (unentered || cancelled(proof.cancellation, owned.applicationId, owned.operationId) ||
        completed(proof.output, owned.operationId)), 'Retain the exact original positive application closure proof.');
    return proof;
  }
  async function observer() {
    if (model) return model;
    if (!opening) opening = (async () => { model = await openRuntimeWorkspace({ directory: join(root, 'operator') }); return model; })().finally(() => { opening = null; });
    return opening;
  }
  async function closeRun(slot, operationId = null) {
    const owned = await selected(slot, operationId);
    if (!owned) return null;
    const prior = await readJSON(closedPath(slot), true);
    if (prior) return validateProof(prior, owned);
    const applications = await observer(), input = { applicationId: owned.applicationId, operationId: owned.operationId };
    let absent = false, output = null, cancellation = null, unentered = null;
    try { await applications.applicationsOutput(input); }
    catch (error) { if (error.code !== 'ENOENT') throw error; absent = true; }
    if (absent && (!owned.launch || owned.launch.dispatch === 'selected')) {
      unentered = { schema: 'stellar-forge.receiving-unentered-launch.v1',
        state: 'CANCELLED_BEFORE_DISPATCH', nativeRunObserved: false };
    } else {
      if (absent) await applications.applicationsStart(owned.launch.request);
      cancellation = await Product.stopMasteringProduct({ directory: product, operationId: owned.operationId });
      if (!cancelled(cancellation, owned.applicationId, owned.operationId)) {
        cancellation = null;
        for (;;) {
          output = await applications.applicationsOutput(input);
          if (completed(output, owned.operationId)) break;
          // A failed outcome can be closed; an inactive pending observation cannot.
          await pause(500);
        }
      }
    }
    const proof = { schema: 'stellar-forge.record-mastering-receiving-closure.v1',
      receivingOperationId: selection.operationId, sourceCommit: selection.sourceCommit,
      slot, applicationId: owned.applicationId, operationId: owned.operationId,
      startRequest: owned.request, closedAt: new Date().toISOString(), cancellation, output, unentered };
    validateProof(proof, owned);
    try { await saveJSON(closedPath(slot), proof); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      return validateProof(await readJSON(closedPath(slot)), owned);
    }
    return proof;
  }
  async function chooseSlot(base) {
    need(base === 'first' || base === 'reopen', 'Use the original receiving application stage.');
    for (let attempt = 0; attempt < 100000; attempt++) {
      const slot = attempt === 0 ? base : base + '-resume-' + String(attempt).padStart(5, '0');
      const owned = await selected(slot);
      if (!owned) return slot;
      const proof = await readJSON(closedPath(slot), true);
      if (!proof) return slot;
      validateProof(proof, owned);
      const normalStop = await readJSON(join(stepDirectory, 'application-' + slot + '-stop.json'), true);
      if (normalStop?.state === 'COMPLETE') {
        need(normalStop.name === 'application-' + slot + '-stop' &&
          normalStop.requestSha256 === sha(json(normalStop.request)) &&
          normalStop.request.directory === product && normalStop.request.operationId === owned.operationId,
          'The retained normal stop must select this original application run.');
        return slot;
      }
      // The previous attempt closed during interruption. Keep every original
      // business step and start a separately retained attempt of this same stage.
    }
    throw Error('The original application stage has too many retained attempts.');
  }
  function enter(slot, request) {
    need(!shouldStop(), 'The original receiving course is stopping before Start dispatch.');
    need(slotPattern.test(slot) && request.directory === product, 'Retain the original product request.');
    validateOperationId(request.requestId);
    selectedHere.set(slot, { ...request });
  }
  function close() {
    if (closing) return closing;
    closing = (async () => {
      let slots;
      for (;;) {
        try {
          const names = await readdir(stepDirectory);
          slots = new Set([...selectedHere.keys(), ...names.map(name => {
            const match = /^application-((?:first|reopen)(?:-resume-[0-9]{5})?)-start\.json$/.exec(name);
            return match?.[1];
          }).filter(Boolean)]);
          break;
        } catch (error) { report({ state: 'APPLICATION_SELECTION_CLOSE_PENDING', message: error.message }); await pause(500); }
      }
      await Promise.all([...slots].map(async slot => { for (;;) {
        try { await closeRun(slot); return; }
        catch (error) { report({ state: 'ORIGINAL_APPLICATION_CLOSE_PENDING', slot, message: error.message }); await pause(500); }
      } }));
      if (model) for (;;) {
        try { await model.close(); model = null; break; }
        catch (error) { report({ state: 'APPLICATION_OBSERVER_CLOSE_PENDING', message: error.message }); await pause(500); }
      }
    })().finally(() => { closing = null; });
    return closing;
  }
  return { chooseSlot, enter, closeRun, close };
}
