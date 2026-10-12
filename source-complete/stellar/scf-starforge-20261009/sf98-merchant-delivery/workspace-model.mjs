// MIT. Private receiver revisions and owned control of the original SF98 worker.
import {constants} from 'node:fs';
import {mkdir, open, readdir, realpath, lstat, link, unlink} from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import {dirname, isAbsolute, join, resolve} from 'node:path';
import {openOutbox} from './outbox.mjs';
import {runWorker, workerStatus} from './worker.mjs';
import {drainOnce, sendSignedWebhook, validateDestination} from './deliver.mjs';
import {acquireDeliveryLease, withDeliveryLease} from './delivery-lock.mjs';
import {deliveryRevision, requeueDelivery} from './delivery-recovery.mjs';

const SCHEMA = 'stellar-forge.sf98.delivery-workspace.v1';
const PROFILE = 'stellar-forge.sf98.receiver-profile.v1';
const JOB = 'stellar-forge.sf98.delivery-maintenance.v1';
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const hash = value => createHash('sha256').update(encode(value)).digest('hex');
const now = () => new Date().toISOString();
const uuid = /^(?:profile|job)-[a-f0-9-]{36}$/;
const eventId = /^[a-f0-9]{64}$/;
export function workspaceFault(code, status = 400) { return Object.assign(new Error(code), {code, status}); }
function need(value, code, status) { if (!value) throw workspaceFault(code, status); }
function errorCode(error) {
  return [error?.code, error?.message].find(value => typeof value === 'string' &&
    /^[A-Z][A-Z0-9_]{0,100}$/.test(value)) ?? 'DELIVERY_WORKSPACE_OPERATION_FAILED';
}
function identifier(value, kind) {
  need(typeof value === 'string' && uuid.test(value) && value.startsWith(kind + '-'), 'INVALID_WORKSPACE_ID');
  return value;
}
async function syncDirectory(path) {
  const file = await open(path, 'r'); try { await file.sync(); } finally { await file.close(); }
}
async function privateDirectory(path, create = false) {
  need(typeof path === 'string' && isAbsolute(path) && path !== '/' && resolve(path) === path &&
    !path.includes('\0'), 'PRIVATE_ABSOLUTE_DIRECTORY_REQUIRED');
  if (create) {
    need(await realpath(dirname(path)) === dirname(path), 'CANONICAL_DIRECTORY_PARENT_REQUIRED');
    await mkdir(path, {mode:0o700}).catch(error => { if (error.code !== 'EEXIST') throw error; });
  }
  const info = await lstat(path);
  need(info.isDirectory() && (info.mode & 0o077) === 0 && await realpath(path) === path,
    'PRIVATE_CANONICAL_DIRECTORY_REQUIRED');
  return path;
}
async function readJson(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    need(info.isFile() && info.size <= 2 * 1024 * 1024 && (info.mode & 0o077) === 0,
      'PRIVATE_WORKSPACE_RECORD_REQUIRED');
    const bytes = await file.readFile();
    need(bytes.length <= 2 * 1024 * 1024, 'WORKSPACE_RECORD_TOO_LARGE');
    return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
  } finally { await file.close(); }
}
async function optionalJson(path) {
  try { return await readJson(path); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function publish(path, value) {
  const temporary = path + '.' + randomUUID() + '.tmp', bytes = encode(value);
  const file = await open(temporary, constants.O_CREAT | constants.O_EXCL |
    constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try {
    await file.writeFile(bytes); await file.sync(); await file.close();
    try { await link(temporary, path); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      need(encode(await readJson(path)).equals(bytes), 'WORKSPACE_RECORD_CONFLICT', 409);
    }
    await syncDirectory(dirname(path));
  } finally { await file.close().catch(() => {}); await unlink(temporary).catch(() => {}); }
}
async function latest(directory, revision) {
  const versions = (await readdir(directory)).filter(name => /^r[1-9][0-9]*\.json$/.test(name))
    .map(name => Number(name.slice(1, -5))).filter(Number.isSafeInteger).sort((a,b) => b - a);
  const selected = revision ?? versions[0];
  need(versions.includes(selected), 'WORKSPACE_REVISION_NOT_FOUND', 404);
  const record = await readJson(join(directory, 'r' + selected + '.json'));
  need(record.revision === selected, 'WORKSPACE_REVISION_INVALID');
  return {...record, revisions:versions};
}
function receiver(value) {
  const fields = ['name','url','allowedHost','secretEnv','limit','concurrency','pollMs','timeoutMs'];
  need(value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every(key => fields.includes(key)), 'INVALID_RECEIVER_FIELDS');
  need(typeof value.name === 'string' && value.name.trim().length > 0 && value.name.length <= 100 &&
    !/[\x00-\x1f\x7f]/.test(value.name), 'RECEIVER_NAME_REQUIRED');
  need(typeof value.secretEnv === 'string' && /^[A-Z][A-Z0-9_]{1,64}$/.test(value.secretEnv),
    'SECRET_ENVIRONMENT_NAME_REQUIRED');
  let endpoint;
  try { endpoint = validateDestination(value.url, value.allowedHost); }
  catch { throw workspaceFault('PUBLIC_HTTPS_RECEIVER_AND_EXACT_HOST_REQUIRED'); }
  const result = {...value, name:value.name.trim(), url:endpoint.href,
    allowedHost:endpoint.hostname, limit:value.limit ?? 20, concurrency:value.concurrency ?? 1,
    pollMs:value.pollMs ?? 5000, timeoutMs:value.timeoutMs ?? 7000};
  for (const [name,min,max] of [['limit',1,100],['concurrency',1,16],['pollMs',50,60000],['timeoutMs',100,60000]])
    need(Number.isInteger(result[name]) && result[name] >= min && result[name] <= max, 'INVALID_RECEIVER_' + name.toUpperCase());
  return result;
}
function secretAvailable(name) {
  const value = process.env[name];
  return typeof value === 'string' && Buffer.byteLength(value) >= 32 && Buffer.byteLength(value) <= 1024;
}
const rowView = row => ({...row, sha256:hash(row), deliveryState:row.state?.state ?? 'PENDING'});

export async function openDeliveryWorkspace({directory, outboxDirectory, deliveryOptions = {}} = {}) {
  directory = await privateDirectory(directory, true);
  outboxDirectory = await privateDirectory(outboxDirectory, true);
  need(directory !== outboxDirectory, 'SEPARATE_WORKSPACE_AND_OUTBOX_REQUIRED');
  // The existing kernel lease also gives the separate workspace one supervisor.
  // The original worker/drain/requeue continue leasing the original outbox.
  const supervisor = await acquireDeliveryLease(directory, {purpose:'worker'});
  let model;
  try {
    for (const name of ['profiles','control','jobs']) await privateDirectory(join(directory, name), true);
    const metaPath = join(directory, 'workspace.json');
    let meta = await optionalJson(metaPath);
    if (!meta) {
      meta = {schema:SCHEMA, directory, outboxDirectory, createdAt:now()};
      await publish(metaPath, meta);
    }
    need(meta.schema === SCHEMA && meta.directory === directory && meta.outboxDirectory === outboxDirectory,
      'WORKSPACE_OUTBOX_IDENTITY_MISMATCH');
    const outbox = await openOutbox(outboxDirectory);
    const controls = join(directory, 'control');
    let control;
    try { control = await latest(controls); }
    catch (error) {
      if (error.code !== 'WORKSPACE_REVISION_NOT_FOUND') throw error;
      control = {schema:SCHEMA, revision:1, mode:'PAUSED', profile:null, changedAt:now(), lastJob:null};
      await publish(join(controls, 'r1.json'), control);
    }
    need(control.schema === SCHEMA && ['PAUSED','WORKER'].includes(control.mode), 'WORKSPACE_CONTROL_INVALID');
    let active = null, task = null, closing = false, tail = Promise.resolve(), persistenceWarning = null;
    const nativeReaders = new Set();
    let nativeOpening = null;
    const serial = action => {
      const next = tail.then(() => { need(!closing, 'WORKSPACE_CLOSING', 503); return action(); });
      tail = next.catch(() => {}); return next;
    };
    const profilePath = id => join(directory, 'profiles', identifier(id, 'profile'));
    const jobPath = id => join(directory, 'jobs', identifier(id, 'job'));
    function expect(revision) {
      need(Number.isSafeInteger(revision) && revision === control.revision, 'WORKSPACE_CHANGED_RELOAD', 409);
    }
    async function writeControl(change) {
      const {revisions, ...old} = control;
      const next = {...old, ...change, revision:old.revision + 1, changedAt:now()};
      const path = join(controls, 'r' + next.revision + '.json');
      try { await publish(path, next); persistenceWarning = null; }
      catch (error) {
        // A complete link can be visible even when directory sync fails.
        // Reconcile it before another command chooses a revision or a worker
        // lifecycle step runs against stale in-memory control.
        let visible;
        try { visible = await readJson(path); } catch {}
        if (visible && encode(visible).equals(encode(next))) {
          persistenceWarning = {revision:next.revision, code:errorCode(error), observedAt:now()};
        } else {
          try {
            const current = await latest(controls);
            need(current.schema === SCHEMA && ['PAUSED','WORKER'].includes(current.mode), 'WORKSPACE_CONTROL_INVALID');
            control = current;
          } catch {}
          throw error;
        }
      }
      control = next; return next;
    }
    async function profile(id, revision) {
      const record = await latest(await privateDirectory(profilePath(id)), revision);
      need(record.schema === PROFILE && record.id === id && record.sha256 === hash(record.profile),
        'RECEIVER_PROFILE_IDENTITY_MISMATCH');
      receiver(record.profile);
      return {...record, secretAvailable:secretAvailable(record.profile.secretEnv)};
    }
    async function selected(input) {
      const record = await profile(input.profileId, input.profileRevision);
      need(record.revision === input.profileRevision && record.sha256 === input.profileSha256,
        'RECEIVER_PROFILE_CHANGED_RELOAD', 409);
      return record;
    }
    const reference = record => ({id:record.id, revision:record.revision, sha256:record.sha256});
    async function fromReference(value) {
      need(value && typeof value === 'object', 'RECEIVER_PROFILE_REQUIRED');
      return selected({profileId:value.id, profileRevision:value.revision, profileSha256:value.sha256});
    }
    function options(record, signal) {
      need(secretAvailable(record.profile.secretEnv), 'RECEIVER_SECRET_ENVIRONMENT_UNAVAILABLE', 409);
      const {name, secretEnv, ...settings} = record.profile;
      return {...deliveryOptions, ...settings, secret:process.env[secretEnv], signal};
    }
    function sendingOptions(record, signal, opened) {
      const native = options(record, signal), send = native.send ?? sendSignedWebhook;
      return {...native, send:input => { opened(); return send(input); }};
    }
    async function observeNative() {
      // The original status probe briefly locks an available outbox. Let an
      // owned native operation acquire its lease before starting a new probe.
      while (nativeOpening) await nativeOpening;
      const reading = workerStatus(outbox); nativeReaders.add(reading);
      try { return await reading; }
      finally { nativeReaders.delete(reading); }
    }
    async function saveProfile({id, expectedRevision = 0, profile:input}) {
      need(Number.isSafeInteger(expectedRevision) && expectedRevision >= 0, 'INVALID_PROFILE_REVISION');
      const value = receiver(input);
      if (id) need((await profile(id)).revision === expectedRevision, 'RECEIVER_PROFILE_CHANGED_RELOAD', 409);
      else {
        need(expectedRevision === 0, 'RECEIVER_PROFILE_CHANGED_RELOAD', 409);
        id = 'profile-' + randomUUID(); await privateDirectory(profilePath(id), true);
      }
      const record = {schema:PROFILE, id, revision:expectedRevision + 1, savedAt:now(),
        profile:value, sha256:hash(value)};
      await publish(join(profilePath(id), 'r' + record.revision + '.json'), record);
      return profile(id, record.revision);
    }
    async function profiles() {
      const records = [];
      for (const id of await readdir(join(directory, 'profiles'))) {
        if (!uuid.test(id) || !id.startsWith('profile-')) continue;
        try { records.push(await profile(id)); }
        catch (error) { if (error.code !== 'WORKSPACE_REVISION_NOT_FOUND') throw error; }
      }
      return records.sort((a,b) => a.profile.name.localeCompare(b.profile.name));
    }
    function owned() {
      if (!active) return null;
      const {controller, ...visible} = active; return visible;
    }
    async function stopOwned() {
      if (!active || active.finishedAt) return;
      active.status = 'PAUSING'; active.controller.abort(new Error('SF98_WORKSPACE_PAUSE'));
      await task;
    }
    function begin(kind, record, operation, job = null) {
      need(!active || active.finishedAt, 'OWNED_DELIVERY_OPERATION_BUSY', 409);
      const current = {id:job?.id ?? randomUUID(), kind, profile:reference(record), status:'STARTING',
        startedAt:now(), finishedAt:null, cycle:null, error:null, controller:new AbortController()};
      active = current;
      const previousReaders = [...nativeReaders];
      let ready;
      const opening = new Promise(resolvePromise => { ready = resolvePromise; });
      nativeOpening = opening;
      const opened = () => { if (nativeOpening === opening) nativeOpening = null; ready(); };
      task = Promise.allSettled(previousReaders).then(() => operation(current, opened)).then(async result => {
        current.result = result;
        current.status = result?.complete === false ? 'INTERRUPTED' : 'FINISHED';
        if (job && result?.complete !== false) await publish(join(jobPath(job.id), 'result.json'),
          {schema:JOB, id:job.id, completedAt:now(), result});
      }).catch(error => { current.error = errorCode(error); current.status = 'FAILED'; })
        .finally(() => { opened(); current.finishedAt = now(); });
      return owned();
    }
    function beginWorker(record) {
      return begin('WORKER', record, (current, opened) => runWorker(outbox, {
        ...sendingOptions(record, current.controller.signal, opened),
        onCycle:cycle => { opened(); current.status = 'RUNNING'; current.cycle = cycle; },
      }));
    }
    async function start(input) {
      expect(input.expectedRevision);
      const record = await selected(input); options(record);
      await stopOwned();
      await writeControl({mode:'WORKER', profile:reference(record), resumeAfterJob:null});
      beginWorker(record); return state();
    }
    async function pause(input) {
      expect(input.expectedRevision);
      try { await writeControl({mode:'PAUSED', resumeAfterJob:null}); }
      finally { await stopOwned(); }
      return state();
    }
    async function createJob(kind, record, extra = {}) {
      const id = 'job-' + randomUUID(), root = await privateDirectory(jobPath(id), true);
      await privateDirectory(join(root, 'events'), true);
      const job = {schema:JOB, id, kind, createdAt:now(), profile:reference(record), ...extra};
      await publish(join(root, 'job.json'), job); return job;
    }
    async function job(id) {
      const root = await privateDirectory(jobPath(id));
      const record = await readJson(join(root, 'job.json'));
      need(record.schema === JOB && record.id === id, 'MAINTENANCE_JOB_IDENTITY_MISMATCH');
      const result = await optionalJson(join(root, 'result.json'));
      const completed = [];
      for (const row of record.events ?? []) {
        const receipt = await optionalJson(join(root, 'events', row.id + '.json'));
        if (receipt) completed.push(receipt);
      }
      return {...record, completed, result,
        status:result ? 'COMPLETE' : active?.id === id && !active.finishedAt ? active.status : 'INTERRUPTED'};
    }
    async function jobs() {
      const values = [];
      for (const id of await readdir(join(directory, 'jobs'))) {
        if (!uuid.test(id) || !id.startsWith('job-')) continue;
        try {
          const root = await privateDirectory(jobPath(id)), record = await readJson(join(root, 'job.json'));
          need(record.schema === JOB && record.id === id, 'MAINTENANCE_JOB_IDENTITY_MISMATCH');
          const result = await optionalJson(join(root, 'result.json'));
          values.push({record, interrupted:record.kind === 'REQUEUE' && !result});
        }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      // Keep every unfinished repair discoverable even after newer operations
      // fill the recent history; only selected jobs need full event checkpoints.
      const selected = values.sort((a,b) => b.record.createdAt.localeCompare(a.record.createdAt))
        .filter((value,index) => index < 50 || value.interrupted);
      const detailed = [];
      for (const value of selected) detailed.push(await job(value.record.id));
      return detailed;
    }
    async function drain(input) {
      expect(input.expectedRevision);
      const record = await selected(input); options(record);
      await stopOwned();
      const request = await createJob('DRAIN', record);
      await writeControl({mode:'PAUSED', profile:reference(record), lastJob:request.id, resumeAfterJob:null});
      begin('DRAIN', record, (current, opened) =>
        drainOnce(outbox, sendingOptions(record, current.controller.signal, opened)), request);
      return state();
    }
    async function event(id) {
      need(typeof id === 'string' && eventId.test(id), 'EXACT_EVENT_ID_REQUIRED');
      const row = (await outbox.rows()).find(row => row.event.id === id);
      need(row, 'DELIVERY_EVENT_NOT_FOUND', 404); return rowView(row);
    }
    async function events({state:filter = 'ALL', query = '', offset = 0, limit = 100} = {}) {
      need(['ALL','PENDING','RETRY','REQUEUE','EXHAUSTED','DELIVERED'].includes(filter), 'INVALID_EVENT_FILTER');
      need(typeof query === 'string' && query.length <= 160 && Number.isSafeInteger(offset) && offset >= 0 &&
        Number.isSafeInteger(limit) && limit >= 1 && limit <= 100, 'INVALID_EVENT_PAGE');
      const all = await outbox.rows();
      const rows = all.filter(row => (filter === 'ALL' || (row.state?.state ?? 'PENDING') === filter) &&
        (!query || [row.event.id,row.event.orderReference,row.event.routeId].some(value =>
          typeof value === 'string' && value.toLowerCase().includes(query.toLowerCase())))).reverse();
      return {total:rows.length, offset, limit, nextOffset:offset + limit < rows.length ? offset + limit : null,
        rows:rows.slice(offset, offset + limit).map(rowView)};
    }
    async function performMaintenance(request, record, signal, opened) {
      const outcomes = [];
      await withDeliveryLease(outbox.dir, async lease => {
        opened();
        for (const selected of request.events) {
          if (signal.aborted) return;
          const path = join(jobPath(request.id), 'events', selected.id + '.json');
          let receipt = await optionalJson(path);
          if (!receipt) {
            const row = await event(selected.id);
            if (row.deliveryState === 'EXHAUSTED' && row.sha256 === selected.sha256) {
              const recovery = await requeueDelivery(outbox, {id:selected.id,
                expectedRevision:deliveryRevision(row), lease});
              receipt = {id:selected.id, outcome:'REQUEUED', recovery,
                observed:await event(selected.id), at:now()};
            } else {
              receipt = {id:selected.id, outcome:row.deliveryState === 'EXHAUSTED' ? 'CHANGED_EXHAUSTION' :
                row.deliveryState === 'REQUEUE' ? 'RECONCILED_REQUEUE' : 'ADVANCED_NATIVE_STATE', observed:row, at:now()};
            }
            await publish(path, receipt);
          }
          outcomes.push(receipt);
        }
      }, {purpose:'requeue'});
      const complete = outcomes.length === request.events.length;
      return {complete, outcomes, resumeWorker:request.resumeWorker && complete &&
        outcomes.every(row => row.outcome !== 'CHANGED_EXHAUSTION')};
    }
    function beginMaintenance(request, record) {
      const acceptedRevision = control.revision;
      const launched = begin('REQUEUE', record, (current, opened) =>
        performMaintenance(request, record, current.controller.signal, opened), request);
      const completion = task;
      // Resume after the original lease is released and the maintenance result
      // is durable. Rejoin the same mutation queue as user pause/start commands.
      completion.then(() => {
        if (closing || active?.id !== request.id || !active.result?.complete || active.error) return;
        serial(async () => {
          if (active?.id !== request.id || control.revision !== acceptedRevision ||
            control.resumeAfterJob !== request.id || control.mode !== 'PAUSED') return;
          if (active.result.resumeWorker) {
            await writeControl({mode:'WORKER', profile:reference(record), resumeAfterJob:null}); beginWorker(record);
          } else await writeControl({resumeAfterJob:null});
        }).catch(error => { if (active?.id === request.id) active.error = errorCode(error); });
      });
      return launched;
    }
    async function requeue(input) {
      expect(input.expectedRevision);
      const record = await selected(input);
      need(Array.isArray(input.events) && input.events.length >= 1 && input.events.length <= 100 &&
        new Set(input.events.map(row => row?.id)).size === input.events.length, 'EXACT_EXHAUSTED_EVENTS_REQUIRED');
      need(typeof input.resumeWorker === 'boolean', 'EXPLICIT_WORKER_RESUME_REQUIRED');
      if (input.resumeWorker) options(record);
      // Stop the owned worker before inspecting the exact selected failures.
      await writeControl({mode:'PAUSED', resumeAfterJob:null});
      await stopOwned();
      const selectedRows = [];
      for (const selection of input.events) {
        const row = await event(selection?.id);
        need(row.deliveryState === 'EXHAUSTED' && row.sha256 === selection.sha256,
          'DELIVERY_EVENT_CHANGED_RELOAD', 409);
        selectedRows.push({id:row.event.id, sha256:row.sha256});
      }
      const request = await createJob('REQUEUE', record, {events:selectedRows, resumeWorker:input.resumeWorker});
      await writeControl({mode:'PAUSED', profile:reference(record), lastJob:request.id,
        resumeAfterJob:request.resumeWorker ? request.id : null});
      beginMaintenance(request, record); return state();
    }
    async function resumeMaintenance(input) {
      expect(input.expectedRevision);
      const request = await job(input.jobId);
      need(request.kind === 'REQUEUE' && !request.result, 'INTERRUPTED_REQUEUE_REQUIRED', 409);
      const record = await fromReference(request.profile);
      if (request.resumeWorker) options(record);
      await stopOwned();
      await writeControl({mode:'PAUSED', profile:reference(record), lastJob:request.id,
        resumeAfterJob:request.resumeWorker ? request.id : null});
      beginMaintenance(request, record); return state();
    }
    async function recoverDelivery(input) {
      // The existing SF30 fulfillment desk supplies its exact original state
      // revision. Join the same durable maintenance path and pinned receiver.
      need(eventId.test(input?.expectedRevision ?? ''), 'DELIVERY_RECOVERY_INPUT_INVALID');
      const before = await event(input.id);
      need(deliveryRevision(before) === input.expectedRevision, 'DELIVERY_STATE_CHANGED', 409);
      need(before.deliveryState === 'EXHAUSTED', 'DELIVERY_NOT_EXHAUSTED', 409);
      need(control.profile, 'DELIVERY_RECEIVER_PROFILE_REQUIRED', 409);
      const record = await fromReference(control.profile);
      const resumeWorker = control.mode === 'WORKER';
      if (resumeWorker) need(secretAvailable(record.profile.secretEnv), 'DELIVERY_RECEIVER_SECRET_UNAVAILABLE', 409);
      await requeue({expectedRevision:control.revision, profileId:record.id,
        profileRevision:record.revision, profileSha256:record.sha256,
        events:[{id:before.event.id, sha256:before.sha256}], resumeWorker});
      const operation = active, completion = task;
      await completion;
      if (operation.error) throw workspaceFault(operation.error, 409);
      need(operation.result?.complete, 'DELIVERY_RECOVERY_INTERRUPTED', 409);
      const outcome = operation.result.outcomes[0];
      need(outcome.outcome !== 'CHANGED_EXHAUSTION', 'DELIVERY_STATE_CHANGED', 409);
      return {schema:'stellar-forge.sf98.delivery-recovery.v1', previousRevision:input.expectedRevision,
        ...outcome.recovery, id:before.event.id, jobId:operation.id,
        outcome:outcome.outcome, state:outcome.observed.deliveryState,
        revision:deliveryRevision(outcome.observed), profile:reference(record),
        resumeWorker:operation.result.resumeWorker};
    }
    async function state() {
      return {schema:SCHEMA, directory, outboxDirectory, revision:control.revision,
        desiredMode:control.mode, selectedProfile:control.profile, changedAt:control.changedAt,
        lastJob:control.lastJob, resumeAfterJob:control.resumeAfterJob ?? null, persistenceWarning,
        profiles:await profiles(), worker:{owned:owned(), native:await observeNative()},
        jobs:await jobs()};
    }
    async function handoff() {
      const current = await state();
      return {...current, exportedAt:now(),
        startup:{module:'sf98-merchant-delivery/workspace-server.mjs',
          directory, outboxDirectory, secretEnvironmentNames:current.profiles.map(row => row.profile.secretEnv)},
        resume:{desiredMode:control.mode, profile:control.profile,
          interruptedMaintenance:current.jobs.filter(row => row.kind === 'REQUEUE' && !row.result).map(row => row.id)}};
    }
    model = {directory, outboxDirectory, state, events, event, profile, job, handoff,
      saveProfile:input => serial(() => saveProfile(input)),
      start:input => serial(() => start(input)), pause:input => serial(() => pause(input)),
      drain:input => serial(() => drain(input)), requeue:input => serial(() => requeue(input)),
      resumeMaintenance:input => serial(() => resumeMaintenance(input)),
      recoverDelivery:input => serial(() => recoverDelivery(input)),
      async close() {
        closing = true; await tail; await stopOwned(); await supervisor.release();
      }};
    if (control.mode === 'PAUSED' && control.resumeAfterJob) {
      const maintenance = await job(control.resumeAfterJob);
      if (maintenance.result) await writeControl({resumeAfterJob:null,
        ...(maintenance.result.result?.resumeWorker ? {mode:'WORKER', profile:maintenance.profile} : {})});
    }
    if (control.mode === 'WORKER') {
      try { beginWorker(await fromReference(control.profile)); }
      catch (error) {
        active = {id:randomUUID(), kind:'WORKER', profile:control.profile, status:'FAILED',
          startedAt:now(), finishedAt:now(), error:errorCode(error)};
      }
    }
    return model;
  } catch (error) { await supervisor.release(); throw error; }
}
