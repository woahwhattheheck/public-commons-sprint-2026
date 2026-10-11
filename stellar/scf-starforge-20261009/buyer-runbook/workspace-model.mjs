// MIT. A private operator workspace around the original runbook and SF88 input.
import {constants} from 'node:fs';
import {mkdir, open, readdir, realpath, lstat, link, unlink, rmdir} from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import {dirname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {isatty} from 'node:tty';
import {config as nativeConfig, execution, need} from '../sf88-operator-buyer-cli/config.mjs';
import {MANIFEST_SCHEMA, previewRunbook, initializeRunbook, runbookPlanDigest,
  readPlan, inspectRunbook, executeRunbook, recoverRunbook, unlockRunbook, acquireRunbookMetadataLease,
  finalizeRunbook,bindRunbookWorkspace} from './runbook.mjs';
import {renderReport,renderAccountingCSV} from './report.mjs';
import {openHandoffIntake} from './handoff-intake.mjs';
import {createRunbookRecovery,verifyRunbookRecovery} from './recovery.mjs';

const SCHEMA = 'stellar-forge.buyer-runbook-workspace.v1';
const DRAFT = 'stellar-forge.buyer-runbook-draft.v1';
const keyPattern = /^(?:draft-[a-f0-9-]{36}|import-[a-f0-9]{32})$/;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const now = () => new Date().toISOString();
export function fault(code, status = 400) { return Object.assign(new Error(code), {code, status}); }
const check = (condition, code, status) => { if (!condition) throw fault(code, status); };
const codeOf = error => /^[A-Z0-9_]{1,120}$/.test(error?.code ?? '') ? error.code : 'WORKSPACE_LOCAL_ERROR';
const inside = (root, path) => path.startsWith(root + sep);
function key(value) { check(typeof value === 'string' && keyPattern.test(value), 'INVALID_WORKSPACE_ITEM'); return value; }

async function regular(path, limit = 8 * 1024 * 1024) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    check(stat.isFile() && stat.size <= limit, 'WORKSPACE_FILE_INVALID');
    const bytes = await file.readFile();
    check(bytes.length <= limit, 'WORKSPACE_FILE_TOO_LARGE');
    return bytes;
  } finally { await file.close(); }
}
async function json(path) { return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(await regular(path))); }
async function syncDirectory(path) { const file = await open(path, 'r'); try { await file.sync(); } finally { await file.close(); } }
async function publish(path, value) {
  const temporary = path + '.' + randomUUID() + '.tmp';
  const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    await file.writeFile(encode(value)); await file.sync(); await file.close();
    await link(temporary, path); await syncDirectory(dirname(path));
  } finally { await file.close().catch(() => {}); await unlink(temporary).catch(() => {}); }
}
async function privateDirectory(path, create = false) {
  check(typeof path === 'string' && isAbsolute(path) && !path.includes('\0'), 'ABSOLUTE_WORKSPACE_PATH_REQUIRED');
  const target = resolve(path);
  if (create) {
    check(await realpath(dirname(target)) === dirname(target), 'CANONICAL_WORKSPACE_PARENT_REQUIRED');
    await mkdir(target, {mode:0o700}).catch(error => { if (error.code !== 'EEXIST') throw error; });
  }
  const info = await lstat(target);
  check(info.isDirectory() && !info.isSymbolicLink() && await realpath(target) === target,
    'CANONICAL_WORKSPACE_DIRECTORY_REQUIRED');
  check(process.platform === 'win32' || (info.mode & 0o077) === 0, 'PRIVATE_WORKSPACE_DIRECTORY_REQUIRED');
  return target;
}
async function terminalAvailable() {
  if (process.platform === 'win32') return false;
  let terminal;
  try { terminal = await open('/dev/tty', 'r+'); return isatty(terminal.fd); }
  catch { return false; }
  finally { await terminal?.close(); }
}

export async function openRunbookWorkspace({directory, configsDirectory, operatorSettings, runs = []} = {}) {
  directory = await privateDirectory(directory, true);
  for (const name of ['drafts', 'runs', 'imports']) await privateDirectory(join(directory, name), true);
  let meta;
  try { meta = await json(join(directory, 'workspace.json')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    check(configsDirectory, 'CONFIG_DIRECTORY_REQUIRED');
    meta = {schema:SCHEMA, directory, configsDirectory:await privateDirectory(configsDirectory), createdAt:now()};
    try { await publish(join(directory, 'workspace.json'), meta); }
    catch (failure) { if (failure.code !== 'EEXIST') throw failure; meta = await json(join(directory, 'workspace.json')); }
  }
  check(meta.schema === SCHEMA && meta.directory === directory, 'WORKSPACE_IDENTITY_MISMATCH');
  configsDirectory = await privateDirectory(configsDirectory ?? meta.configsDirectory);
  check(meta.configsDirectory === configsDirectory, 'WORKSPACE_CONFIG_DIRECTORY_MISMATCH');
  const intake = await openHandoffIntake({directory:join(directory,'handoffs'), configsDirectory, operatorSettings});
  let active = null, task = null, recoveryActive=null,recoveryTask=null,closing = false, sequence = Promise.resolve();
  const recovery=createRunbookRecovery({directory,configsDirectory,state:list,resolveRun,intake});
  const serial = action => {
    const next = sequence.then(() => { check(!closing, 'WORKSPACE_CLOSING', 503); return action(); });
    sequence = next.catch(() => {}); return next;
  };
  const mutate=action=>serial(()=>{check(!recoveryActive||recoveryActive.finishedAt,'WORKSPACE_RECOVERY_BUSY',409);return action();});
  async function mutateDraft(action) {
    let release;
    try { release = await acquireRunbookMetadataLease(join(directory, 'drafts')); }
    catch (error) {
      if (error.code === 'RUNBOOK_METADATA_LOCK_EXISTS') throw fault(error.code, 409);
      throw error;
    }
    try { return await action(); } finally { await release(); }
  }
  const runPath = id => join(directory, 'runs', key(id));
  const draftPath = id => join(directory, 'drafts', key(id));
  const importPath = id => join(directory, 'imports', key(id) + '.json');
  async function resolveRun(id) {
    key(id);
    if (id.startsWith('draft-')) return runPath(id);
    const record = await json(importPath(id));
    check(record.id === id && record.schema === SCHEMA, 'IMPORTED_RUN_MISMATCH');
    return privateDirectory(record.path);
  }
  async function latestDraft(id, revision) {
    const root = draftPath(id);
    await privateDirectory(root);
    const versions = (await readdir(root)).filter(name => /^r[1-9][0-9]*\.json$/.test(name))
      .map(name => Number(name.slice(1, -5))).filter(Number.isSafeInteger).sort((a,b) => b-a);
    const selected = revision ?? versions[0];
    check(versions.includes(selected), 'DRAFT_REVISION_NOT_FOUND', 404);
    const record = await json(join(root, 'r' + selected + '.json'));
    check(record.schema === DRAFT && record.id === id && record.revision === selected, 'DRAFT_RECORD_INVALID');
    return {...record, revisions:versions};
  }
  async function initialization(id) {
    try { await privateDirectory(runPath(id)); }
    catch (error) { if (error.code === 'ENOENT') return 'NOT_STARTED'; throw error; }
    try { await readPlan(runPath(id)); return 'READY'; }
    catch (error) {
      if (['ENOENT','RUNBOOK_JSON_INVALID','RUNBOOK_FILE_INVALID','INVALID_SAVED_RUNBOOK',
        'INVALID_SAVED_JOB'].includes(error.code)) return 'INCOMPLETE';
      throw error;
    }
  }
  async function configurationPath(value) {
    check(typeof value === 'string' && value.length > 0 && value.length <= 1024 && !value.includes('\0'), 'CONFIG_SELECTION_REQUIRED');
    const path = resolve(configsDirectory, value);
    check(inside(configsDirectory, path) && path.endsWith('.json') && await realpath(path) === path,
      'CONFIG_OUTSIDE_SELECTED_DIRECTORY');
    await regular(path, 65536);
    return path;
  }
  async function configurations() {
    const names = [];
    async function scan(root, depth) {
      for (const entry of await readdir(root, {withFileTypes:true})) {
        check(names.length < 512, 'CONFIG_DIRECTORY_TOO_LARGE');
        if (entry.isDirectory() && !entry.name.startsWith('.') && depth < 4) await scan(join(root, entry.name), depth + 1);
        if (entry.isFile() && entry.name.endsWith('.json')) names.push(join(root, entry.name));
      }
    }
    await scan(configsDirectory, 0);
    const records = [];
    for (const path of names.sort()) {
      const name = relative(configsDirectory, path).split(sep).join('/');
      try {
        const {op, owner, download} = execution(await nativeConfig(await configurationPath(name)));
        records.push({name, valid:true, intentId:op.intentId, url:op.url, method:op.method,
          acceptedCaps:op.expect, actor:owner.actor, service:owner.service, responseFile:download,
          hasBody:op.bodyFile !== undefined});
      } catch (error) { records.push({name, valid:false, error:codeOf(error)}); }
    }
    return records;
  }
  async function normalizeManifest(value) {
    check(value && typeof value === 'object' && !Array.isArray(value) &&
      Object.keys(value).every(name => ['schema','id','title','operations'].includes(name)), 'INVALID_MANIFEST_FIELDS');
    check(value.schema === MANIFEST_SCHEMA && Array.isArray(value.operations) && value.operations.length >= 1 &&
      value.operations.length <= 64, 'INVALID_MANIFEST');
    const operations = [];
    for (const entry of value.operations) {
      check(entry && typeof entry === 'object' && Object.keys(entry).every(name =>
        ['id','label','config','saveAs'].includes(name)), 'INVALID_MANIFEST_OPERATION');
      operations.push({...entry, config:await configurationPath(entry.config)});
    }
    return {...value, operations};
  }
  async function saveDraft({id, expectedRevision = 0, manifest}) {
    check(Number.isSafeInteger(expectedRevision) && expectedRevision >= 0, 'INVALID_DRAFT_REVISION');
    const normalized = await normalizeManifest(manifest), newDraft = !id;
    if (id) {
      const previous = await latestDraft(id);
      check(previous.revision === expectedRevision, 'DRAFT_CHANGED_RELOAD', 409);
      check(await initialization(id) === 'NOT_STARTED', 'ACQUISITION_ALREADY_INITIALIZED', 409);
    } else {
      check(expectedRevision === 0, 'DRAFT_CHANGED_RELOAD', 409);
      id = 'draft-' + randomUUID(); await privateDirectory(draftPath(id), true);
    }
    const revision = expectedRevision + 1;
    check(Number.isSafeInteger(revision) && revision <= 10000, 'DRAFT_REVISION_LIMIT');
    // rN.json is the sole revision publication point. Unreferenced manifests
    // from an interrupted publication cannot reserve the next revision name.
    const manifestPath = join(draftPath(id), 'r' + revision + '.' + randomUUID() + '.manifest.json');
    await publish(manifestPath, normalized);
    let preview;
    try { preview = await previewRunbook({manifest:manifestPath, output:runPath(id)}); }
    catch (error) {
      // This manifest was never accepted as a revision; remove only our own
      // new unreferenced file, so correcting the form can save the same version.
      await unlink(manifestPath).catch(() => {});
      if (newDraft) await rmdir(draftPath(id)).catch(() => {});
      throw error;
    }
    const record = {schema:DRAFT, id, revision, savedAt:now(), manifest:normalized,
      manifestPath, reviewSha256:preview.sha256, plan:preview.plan};
    const recordPath = join(draftPath(id), 'r' + revision + '.json');
    try { await publish(recordPath, record); }
    catch (error) {
      // A link can succeed before its directory sync reports an error. Recover
      // that accepted revision; retain its input whenever publication is unsure.
      let accepted;
      try { accepted = await json(recordPath); } catch {}
      if (accepted?.schema === DRAFT && accepted.id === id && accepted.revision === revision &&
        accepted.manifestPath === manifestPath && accepted.reviewSha256 === preview.sha256) return latestDraft(id);
      if (error.code === 'EEXIST') throw fault('DRAFT_CHANGED_RELOAD', 409);
      throw error;
    }
    return latestDraft(id);
  }
  async function activate({id, expectedRevision, reviewSha256}) {
    const draft = await latestDraft(id);
    check(draft.revision === expectedRevision && draft.reviewSha256 === reviewSha256, 'DRAFT_CHANGED_RELOAD', 409);
    if (await initialization(id) === 'READY') {
      const plan = await readPlan(runPath(id));
      check(runbookPlanDigest(plan) === draft.reviewSha256, 'EXISTING_ACQUISITION_MISMATCH', 409);
    } else await initializeRunbook({manifest:draft.manifestPath, output:runPath(id),
      expectedSha256:reviewSha256, resume:true});
    return getRun(id);
  }
  async function getRun(id) {
    const state = await inspectRunbook(await resolveRun(id));
    return {id, state, active:active?.runId === id ? {...active, events:[...active.events]} : null,
      terminalAvailable:await terminalAvailable()};
  }
  async function list() {
    const drafts = [], acquisitions = [], errors = [];
    for (const id of await readdir(join(directory, 'drafts'))) {
      if (!keyPattern.test(id) || !id.startsWith('draft-')) continue;
      try {
        const draft = await latestDraft(id), status = await initialization(id), ready = status === 'READY';
        drafts.push({id, revision:draft.revision, title:draft.plan.title, planId:draft.plan.id,
          savedAt:draft.savedAt, operations:draft.plan.operations.length, initialized:ready, initialization:status});
        if (ready) acquisitions.push({id, title:draft.plan.title, planId:draft.plan.id, imported:false});
      } catch (error) { if (error.code !== 'DRAFT_REVISION_NOT_FOUND') errors.push({id, code:codeOf(error)}); }
    }
    for (const name of await readdir(join(directory, 'imports'))) {
      if (!/^import-[a-f0-9]{32}\.json$/.test(name)) continue;
      const id = name.slice(0,-5);
      try { const plan = await readPlan(await resolveRun(id)); acquisitions.push({id, title:plan.title, planId:plan.id, imported:true}); }
      catch (error) { errors.push({id, code:codeOf(error)}); }
    }
    drafts.sort((a,b) => b.savedAt.localeCompare(a.savedAt));
    return {directory, configsDirectory, drafts, acquisitions, errors, active,
      terminalAvailable:await terminalAvailable(), configurations:await configurations(), intake:await intake.state(),
      recovery:{active:recoveryActive,history:await recovery.history()}};
  }
  async function launch({id, only},kind='BUYER') {
    check(!active || active.finishedAt, 'WORKSPACE_EXECUTION_BUSY', 409);
    if(kind==='BUYER')check(await terminalAvailable(), 'CONTROLLING_TERMINAL_REQUIRED', 409);
    const path = await resolveRun(id), state = await inspectRunbook(path);
    check(!state.executionLock, 'RUNBOOK_EXECUTION_LOCK_EXISTS', 409);
    need(only === undefined || state.operations.some(row => row.id === only), 'UNKNOWN_JOB_ID');
    const controller = new AbortController();
    const current = {executionId:randomUUID(), runId:id, kind, only:only ?? null, startedAt:now(),
      status:'RUNNING', cancelRequested:false, events:[], finishedAt:null};
    active = current;
    const run=kind==='ACCOUNTING'?finalizeRunbook:executeRunbook;
    task = run(path, {only, signal:controller.signal,
      ...(kind==='ACCOUNTING'?{workspaceForOperation:intake.workspaceForOperation}:
        {environmentForOperation:intake.environmentForOperation}),onProgress:event => {
      current.events.push({...event, at:now()});
      if (current.events.length > 128) current.events.shift();
    }}).then(result => { current.result = result; current.status = result.interrupted ? 'CANCELLED' : 'FINISHED'; },
      error => { current.error = codeOf(error); current.status = 'FAILED'; }).finally(() => { current.finishedAt = now(); });
    current.cancel = () => { current.cancelRequested = true; current.status = 'CANCELLING'; controller.abort(); };
    return {executionId:current.executionId, runId:id, kind, status:current.status};
  }
  async function bindAccounting({id,only,workspace}) {
    check(!active||active.finishedAt,'WORKSPACE_EXECUTION_BUSY',409);
    const binding=await bindRunbookWorkspace(await resolveRun(id),{only,workspace});
    return {...await getRun(id),binding};
  }
  function cancel({id, executionId}) {
    check(active?.runId === id && active.executionId === executionId && !active.finishedAt, 'EXECUTION_CHANGED_RELOAD', 409);
    active.cancel(); return {runId:id, executionId, status:'CANCELLING'};
  }
  async function recover({id}) {
    check(active?.runId !== id || active.finishedAt, 'RUNBOOK_EXECUTION_LOCK_EXISTS', 409);
    const action = await recoverRunbook(await resolveRun(id)); return {...await getRun(id), action};
  }
  async function unlock({id, ownerPid}) {
    check(Number.isSafeInteger(ownerPid) && ownerPid > 0, 'EXACT_OWNER_PID_REQUIRED');
    const action = await unlockRunbook(await resolveRun(id), ownerPid); return {...await getRun(id), action};
  }
  async function exportRun(id, format) {
    const state = await inspectRunbook(await resolveRun(id));
    check(['json','html','csv'].includes(format), 'INVALID_EXPORT_FORMAT');
    return {bytes:format === 'json' ? encode(state) : Buffer.from(format==='csv'?renderAccountingCSV(state):renderReport(state)),
      name:state.plan.id+(format==='csv'?'-accounting':'')+'.'+format};
  }
  async function download(id, operationId) {
    const state = await inspectRunbook(await resolveRun(id));
    const row = state.operations.find(item => item.id === operationId);
    const saved = row?.result?.summary?.responseFile;
    check(row?.downloadName && saved?.status === 'SAVED', 'SAVED_RUNBOOK_RESOURCE_REQUIRED', 404);
    const parent = join(state.plan.directory, 'downloads'), path = join(parent, row.downloadName);
    check(await realpath(parent) === parent && path === saved.path && path === row.responseFile.destination,
      'RESOURCE_PATH_MISMATCH');
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await file.stat();
      check(info.isFile() && info.size === saved.bytes && /^[a-f0-9]{64}$/.test(saved.sha256), 'RESOURCE_BYTES_CHANGED');
      const hash = createHash('sha256'), buffer = Buffer.alloc(65536); let offset = 0;
      while (true) { const {bytesRead} = await file.read(buffer, 0, buffer.length, offset); if (!bytesRead) break;
        offset += bytesRead; hash.update(buffer.subarray(0,bytesRead)); }
      check(offset === saved.bytes && hash.digest('hex') === saved.sha256, 'RESOURCE_BYTES_CHANGED');
      const identity = Object.fromEntries(['dev','ino','size','mtimeMs','ctimeMs'].map(name => [name, info[name]]));
      const current = await file.stat();
      check(Object.entries(identity).every(([name,value]) => current[name] === value), 'RESOURCE_BYTES_CHANGED');
      const contentType = typeof saved.contentType === 'string' && saved.contentType.length <= 256 &&
        !/[\x00-\x1f\x7f]/.test(saved.contentType) ? saved.contentType : null;
      return {file, name:row.downloadName, bytes:info.size, sha256:saved.sha256, contentType, identity};
    } catch (error) { await file.close(); throw error; }
  }
  async function previewResource(id, operationId) {
    const resource = await download(id, operationId);
    const {file, name, bytes, sha256, contentType, identity} = resource;
    const type = contentType?.split(';', 1)[0].trim().toLowerCase() ?? '';
    const textual = /^text\/[a-z0-9!#$&^_.+-]+$/.test(type) ||
      /^application\/(?:json|xml|javascript|ecmascript|x-javascript|x-www-form-urlencoded|yaml|x-yaml|toml|sql|[a-z0-9!#$&^_.+-]+\+(?:json|xml))$/.test(type);
    const result = {name, bytes, sha256, contentType, textual, text:null, previewBytes:0, truncated:bytes > 65536};
    try {
      if (!textual) return result;
      const buffer = Buffer.alloc(Math.min(bytes, 65536));
      let offset = 0;
      while (offset < buffer.length) {
        const {bytesRead} = await file.read(buffer, offset, buffer.length - offset, offset);
        check(bytesRead > 0, 'RESOURCE_BYTES_CHANGED'); offset += bytesRead;
      }
      const current = await file.stat();
      check(Object.entries(identity).every(([name,value]) => current[name] === value), 'RESOURCE_BYTES_CHANGED');
      try {
        // Streaming decoding withholds an incomplete UTF-8 character at the
        // 64 KiB boundary instead of appending a fabricated replacement glyph.
        result.text = new TextDecoder('utf-8', {fatal:true}).decode(buffer, {stream:result.truncated});
        result.previewBytes = buffer.length;
      } catch { result.previewError = 'RESOURCE_NOT_UTF8'; }
      return result;
    } finally { await file.close(); }
  }
  async function launchRecovery({kind,...input}) {
    check(['SNAPSHOT','VERIFY'].includes(kind),'RUNBOOK_RECOVERY_ACTION_REQUIRED');
    check(!recoveryActive||recoveryActive.finishedAt,'WORKSPACE_RECOVERY_BUSY',409);
    check(!active||active.finishedAt,'WORKSPACE_EXECUTION_BUSY',409);
    const controller=new AbortController(),current={id:randomUUID(),kind,status:'RUNNING',
      startedAt:now(),finishedAt:null,events:[],cancelRequested:false};
    recoveryActive=current;
    const operation=kind==='SNAPSHOT'?recovery.snapshot:verifyRunbookRecovery;
    recoveryTask=operation(input,{signal:controller.signal,onProgress:event=>{
      current.events.push({...event,at:now()});if(current.events.length>128)current.events.shift();
    }}).then(result=>{current.result=result;current.status='FINISHED';},error=>{
      current.error=codeOf(error);current.status=controller.signal.aborted?'CANCELLED':'FAILED';
    }).finally(()=>{current.finishedAt=now();});
    current.cancel=()=>{current.cancelRequested=true;current.status='CANCELLING';controller.abort();};
    return {id:current.id,kind:current.kind,status:current.status};
  }
  function cancelRecovery({id}) {
    check(recoveryActive?.id===id&&!recoveryActive.finishedAt,'RUNBOOK_RECOVERY_OPERATION_CHANGED',409);
    recoveryActive.cancel();return {id,status:'CANCELLING'};
  }
  for (const path of runs) {
    const canonical = await privateDirectory(path), plan = await readPlan(canonical);
    const id = 'import-' + digest(canonical).slice(0,32);
    const record = {schema:SCHEMA, id, path:canonical, planId:plan.id, registeredAt:now()};
    try { await publish(importPath(id), record); }
    catch (error) { if (error.code !== 'EEXIST') throw error;
      const old = await json(importPath(id)); check(old.path === canonical && old.planId === plan.id, 'IMPORTED_RUN_MISMATCH'); }
  }
  return {directory, state:list, draft:latestDraft, run:getRun, export:exportRun, download, previewResource,
    request:intake.get, requestAttachment:intake.attachment,
    receiveRequest:input => mutate(() => intake.receive(input)),
    reviewRequest:input => mutate(() => intake.review(input)),
    prepareRequest:input => mutate(() => intake.provision(input)),
    save:input => mutate(() => mutateDraft(() => saveDraft(input))),
    initialize:input => mutate(() => mutateDraft(() => activate(input))),
    execute:input => mutate(() => launch(input)), cancel:input => serial(() => cancel(input)),
    finalize:input => mutate(() => launch(input,'ACCOUNTING')),
    bindAccounting:input => mutate(() => bindAccounting(input)),
    recover:input => mutate(() => recover(input)), unlock:input => mutate(() => unlock(input)),
    inspectRecovery:input=>serial(()=>recovery.inspect(input)),
    snapshotRecovery:(input,context)=>mutate(()=>recovery.snapshot(input,context)),
    startRecovery:input=>serial(()=>launchRecovery(input)),
    cancelRecovery:input=>serial(()=>cancelRecovery(input)),
    async close() { closing = true; await sequence; if (active && !active.finishedAt) active.cancel();
      if(recoveryActive&&!recoveryActive.finishedAt)recoveryActive.cancel();
      await Promise.all([task,recoveryTask]); }};
}
