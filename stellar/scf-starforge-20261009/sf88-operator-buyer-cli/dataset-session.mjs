// MIT. Persistent acquisition using original SF88 execution and SF30 page contracts.
import { constants } from 'node:fs';
import { open, mkdir, lstat, readdir, realpath, unlink, stat } from 'node:fs/promises';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { config, operation, execution, InputError, need } from './config.mjs';
import { execute } from './execute.mjs';
import { createOperatorApproval, checkOperatorTerminal } from '../sf81-buyer-operator-bridge/bridge.mjs';
import { analyzeOne } from '../sf52-buyer-outcomes/outcomes.mjs';
import { canonical, digest, inspectDatasetPage, object, validateDatasetQuery } from './dataset-page.mjs';
import { MAX_DATASET_PAGE_BYTES, MAX_DATASET_PAGES } from '../sf100-buyer-dataset-delivery/deliver.mjs';
import {pendingUnpaidContinuation,inspectUnpaidContinuation,continueUnpaidPage} from './dataset-unpaid.mjs';

const VERSION = 'stellar-forge.sf88.dataset-session.v1';
const MAX_ATOMIC = 170141183460469231731687303715884105727n;
const safeCode = e => typeof e?.code === 'string' && /^[A-Z0-9_]{1,120}$/.test(e.code) ? e.code : 'DATASET_OPERATION_FAILED';
const isCount = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max;
const atomic = v => typeof v === 'string' && /^[1-9][0-9]{0,38}$/.test(v) && BigInt(v) <= MAX_ATOMIC;
const equal = (a, b) => canonical(a) === canonical(b);
const indexName = index => String(index).padStart(6, '0');
const F = constants.O_NOFOLLOW ?? 0;

async function privateDirectory(path) {
  need(typeof path === 'string' && isAbsolute(path) && path === resolve(path), 'DATASET_ABSOLUTE_SESSION_REQUIRED');
  const info = await lstat(path);
  need(info.isDirectory() && !info.isSymbolicLink() &&
    (process.platform === 'win32' || (info.mode & 0o077) === 0), 'DATASET_PRIVATE_DIRECTORY_REQUIRED');
  need(await realpath(path) === path, 'DATASET_SYMLINK_DIRECTORY_REFUSED');
}
async function syncDirectory(path) {
  if (process.platform === 'win32') return;
  const file = await open(path, constants.O_RDONLY);
  try { await file.sync(); } finally { await file.close(); }
}
async function createJson(path, value) {
  const file = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | F, 0o600);
  try { await file.writeFile(JSON.stringify(value, null, 2) + '\n'); await file.sync(); }
  finally { await file.close(); }
  await syncDirectory(dirname(path));
}
async function readPrivate(path, maxBytes, optional = false) {
  let file;
  try { file = await open(path, constants.O_RDONLY | F); }
  catch (e) { if (optional && e.code === 'ENOENT') return null; throw e; }
  try {
    const info = await file.stat();
    need(info.isFile() && info.nlink === 1 && info.size <= maxBytes &&
      (process.platform === 'win32' || (info.mode & 0o077) === 0), 'DATASET_PRIVATE_FILE_REQUIRED');
    const bytes = await file.readFile();
    need(bytes.length <= maxBytes, 'DATASET_FILE_LIMIT_EXCEEDED');
    return bytes;
  } finally { await file.close(); }
}
async function readJson(path, maxBytes = 262144, optional = false) {
  const bytes = await readPrivate(path, maxBytes, optional);
  if (bytes === null) return null;
  try { return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes)); }
  catch { throw new InputError('DATASET_STATE_JSON_INVALID'); }
}
async function auxiliaryJson(path, maxBytes) {
  try { return {value:await readJson(path, maxBytes, true), warning:null}; }
  catch (error) {
    // These are post-execution convenience records. A torn write cannot erase
    // independently retained native checkout evidence and a published body.
    // Filesystem identity/permission failures still remain errors.
    if (error.code !== 'DATASET_STATE_JSON_INVALID') throw error;
    return {value:null, warning:{path,code:'INCOMPLETE_SESSION_METADATA'}};
  }
}
async function createRunLock(path, identity) {
  const file = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | F, 0o600);
  let created;
  try {
    created = await file.stat();
    await file.writeFile(JSON.stringify(identity, null, 2) + '\n');
    await file.sync();
    await syncDirectory(dirname(path));
  } catch (error) {
    // A failed exclusive write must not leave a false running-session marker.
    if (created) {
      try {
        const current = await lstat(path);
        if (current.isFile() && current.nlink === 1 &&
            current.dev === created.dev && current.ino === created.ino) {
          await unlink(path);
          await syncDirectory(dirname(path));
        }
      } catch (cleanupError) {
        if (cleanupError.code !== 'ENOENT') error.lockCleanupCode = safeCode(cleanupError);
      }
    }
    throw error;
  } finally { await file.close(); }
}
async function lock(directory, recoverDead = false) {
  await privateDirectory(directory);
  const path = join(directory, 'run.lock');
  if (recoverDead) {
    const old = await readJson(path, 4096, true);
    if (old) {
      need(object(old) && old.host === hostname() && isCount(old.pid, 1, 2147483647) &&
        typeof old.nonce === 'string', 'DATASET_LOCK_OTHER_HOST');
      let dead = false;
      try { process.kill(old.pid, 0); } catch (e) { dead = e.code === 'ESRCH'; }
      need(dead, 'DATASET_SESSION_RUNNING');
      need(equal(old, await readJson(path, 4096)), 'DATASET_LOCK_CHANGED');
      await unlink(path);
    }
  }
  const identity = {pid:process.pid, host:hostname(), nonce:randomUUID(), at:new Date().toISOString()};
  try { await createRunLock(path, identity); }
  catch (e) { if (e.code === 'EEXIST') throw new InputError('DATASET_SESSION_RUNNING_USE_STATUS'); throw e; }
  return async () => {
    const current = await readJson(path, 4096, true);
    if (current?.nonce === identity.nonce) { await unlink(path); await syncDirectory(directory); }
  };
}
function validateDefinition(value, directory) {
  need(object(value) && value.schema === VERSION && value.directory === directory &&
    typeof value.createdAt === 'string' && object(value.config) && object(value.limits) &&
    digest(canonical(value.config)) === value.configurationSha256, 'DATASET_SESSION_INVALID');
  const op = operation(value.config.operation);
  execution(value.config);
  need(op.method === 'GET' && op.bodyFile === undefined && value.config.responseFile === undefined &&
    (value.config.captureBody === undefined || value.config.captureBody === false), 'DATASET_GET_CONFIG_REQUIRED');
  const query = validateDatasetQuery(op.url, {initial:true});
  if (value.workspaceDirectory !== undefined)
    need(typeof value.workspaceDirectory === 'string' && isAbsolute(value.workspaceDirectory) &&
      resolve(value.workspaceDirectory) === value.workspaceDirectory, 'DATASET_ABSOLUTE_WORKSPACE_REQUIRED');
  const l = value.limits;
  need(atomic(op.expect.maxAtomic) && atomic(l.maxTotalAtomic) &&
    BigInt(l.maxTotalAtomic) >= BigInt(op.expect.maxAtomic) &&
    isCount(l.maxPages, 1, 10000) && isCount(l.maxRows, 1, 1000000) &&
    isCount(l.maxPageBytes, 1024, 16777216), 'DATASET_LIMITS_INVALID');
  need(value.expectedSnapshot === null || typeof value.expectedSnapshot === 'string' &&
    /^[a-f0-9]{64}$/.test(value.expectedSnapshot), 'DATASET_EXPECTED_SNAPSHOT_INVALID');
  need(!query.has('snapshot') || value.expectedSnapshot === query.get('snapshot'), 'DATASET_SNAPSHOT_SELECTION_CONFLICT');
  return value;
}
export async function createDatasetSession({directory, configPath, workspaceDirectory, maxPages, maxTotalAtomic,
  maxRows = 1000000, maxPageBytes = 1048576, expectedSnapshot = null} = {}) {
  need(typeof directory === 'string' && isAbsolute(directory) && directory === resolve(directory), 'DATASET_ABSOLUTE_SESSION_REQUIRED');
  // New acquisitions must fit the SAME original exporter they deliver into.
  // Keep historical definition validation unchanged for existing session recovery.
  need(isCount(maxPages, 1, MAX_DATASET_PAGES) && isCount(maxPageBytes, 1024, MAX_DATASET_PAGE_BYTES),
    'DATASET_DELIVERY_LIMITS_EXCEEDED');
  need((configPath !== undefined) !== (workspaceDirectory !== undefined), 'DATASET_ONE_CONFIG_SOURCE_REQUIRED');
  const source = workspaceDirectory === undefined ? await config(configPath)
    : (await (await import('./workspace.mjs')).openWorkspace(['--dir', workspaceDirectory])).config;
  const selected = validateDatasetQuery(source.operation?.url, {initial:true}).get('snapshot');
  if (selected && expectedSnapshot === null) expectedSnapshot = selected;
  const definition = validateDefinition({schema:VERSION, directory, createdAt:new Date().toISOString(),
    configurationSha256:digest(canonical(source)), config:source, expectedSnapshot,
    ...(workspaceDirectory === undefined ? {} : {workspaceDirectory}),
    limits:{maxPages,maxTotalAtomic,maxRows,maxPageBytes}}, directory);
  // A session has its own response/evidence directory; the original SF36 ledger stays shared.
  const parent = await realpath(dirname(directory));
  need(parent === dirname(directory), 'DATASET_SYMLINK_DIRECTORY_REFUSED');
  await mkdir(directory, {mode:0o700});
  await privateDirectory(directory);
  await mkdir(join(directory, 'pages'), {mode:0o700});
  await mkdir(join(directory, 'evidence'), {mode:0o700});
  await createJson(join(directory, 'session.json'), definition);
  await syncDirectory(directory);
  return inspectDatasetSession(directory);
}
function pageConfig(definition, index, cursor, allocated) {
  const c = structuredClone(definition.config), u = new URL(c.operation.url);
  if (cursor !== null) u.searchParams.set('cursor', cursor);
  const room = BigInt(definition.limits.maxTotalAtomic) - allocated;
  const cap = BigInt(c.operation.expect.maxAtomic) < room ? BigInt(c.operation.expect.maxAtomic) : room;
  need(cap > 0n, 'DATASET_TOTAL_CAP_REACHED');
  const key = digest(canonical({session:definition.configurationSha256, id:c.operation.intentId, index, url:u.href}));
  const intentId = 'dataset:' + key;
  c.operation = {...c.operation, intentId, url:u.href, expect:{...c.operation.expect, maxAtomic:cap.toString()}};
  c.captureBody = false;
  c.evidenceDir = join(definition.directory, 'evidence');
  c.responseFile = {destination:join(definition.directory, 'pages', indexName(index), 'response.json'),
    maxBytes:definition.limits.maxPageBytes, timeoutMs:30000};
  return c;
}

/** Read the original immutable page lineage for the shared lost-output source
 * adapter. It never acquires, retries, signs or changes the session. */
export async function readRetainedDatasetAttempt(directory,index) {
  need(Number.isSafeInteger(index)&&index>=1&&index<=10000,'DATASET_LOST_OUTPUT_PAGE_REQUIRED');
  await privateDirectory(directory);
  await privateDirectory(join(directory,'pages'));
  await privateDirectory(join(directory,'evidence'));
  const sessionRaw=await readPrivate(join(directory,'session.json'),262144);
  let definition;
  try {definition=validateDefinition(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(sessionRaw)),directory);}
  catch(error){if(error instanceof InputError)throw error;throw new InputError('DATASET_SESSION_INVALID');}
  const names=(await readdir(join(directory,'pages'))).filter(name=>/^[0-9]{6}$/.test(name)).sort();
  need(names.length<=definition.limits.maxPages&&index<=names.length&&
    names.every((name,position)=>name===indexName(position+1)),'DATASET_PAGE_GAP');
  const sourceHashes={session:digest(sessionRaw)};
  let previous=null,allocated=0n;
  for(let number=1;number<=index;number++) {
    const dir=join(directory,'pages',indexName(number));
    await privateDirectory(dir);
    const configurationRaw=await readPrivate(join(dir,'config.json'),262144);
    const attemptRaw=await readPrivate(join(dir,'attempt.json'),8192);
    let cfg,attempt;
    try {
      cfg=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(configurationRaw));
      attempt=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(attemptRaw));
    } catch {throw new InputError('DATASET_STATE_JSON_INVALID');}
    const wanted=pageConfig(definition,number,previous?.nextCursor??null,allocated);
    need(equal(cfg,wanted)&&attempt.schema==='stellar-forge.sf88.dataset-attempt.v1'&&
      attempt.index===number&&attempt.intentId===wanted.operation.intentId&&
      attempt.configurationSha256===digest(canonical(cfg))&&attempt.capAtomic===wanted.operation.expect.maxAtomic&&
      Number.isFinite(Date.parse(attempt.startedAt)),'DATASET_ATTEMPT_CHANGED');
    const body=await readPrivate(cfg.responseFile.destination,definition.limits.maxPageBytes,true);
    const responseState={condition:body===null?'ABSENT':body.length?'SAVED':'EMPTY',
      bytes:body?.length??0,sha256:body===null?null:digest(body)};
    if(number===index) {
      Object.assign(sourceHashes,{configuration:digest(configurationRaw),attempt:digest(attemptRaw),
        response:responseState.sha256});
      return {definition,cfg,attempt,sourceHashes,body,responseState,previous};
    }
    need(body?.length>0,'DATASET_PREVIOUS_PAGE_RESPONSE_REQUIRED');
    const prefix='previous.'+indexName(number)+'.';
    sourceHashes[prefix+'configuration']=digest(configurationRaw);
    sourceHashes[prefix+'attempt']=digest(attemptRaw);
    sourceHashes[prefix+'response']=digest(body);
    previous=inspectDatasetPage(body,{url:cfg.operation.url,previous,
      expectedSnapshot:definition.expectedSnapshot,maxRows:definition.limits.maxRows});
    need(previous.nextCursor!==null,'DATASET_PAGE_AFTER_COMPLETE');
    allocated+=BigInt(attempt.capAtomic);
  }
}

function baseReport(definition) {
  return {schema:'stellar-forge.sf88.dataset-acquisition.v1', directory:definition.directory,
    configurationSha256:definition.configurationSha256, sessionId:definition.config.operation.intentId,
    ...(definition.workspaceDirectory === undefined ? {} : {workspaceDirectory:definition.workspaceDirectory}),
    expectedSnapshot:definition.expectedSnapshot,
    status:'READY', limits:definition.limits, capAllocatedAtomic:'0', completedPages:0,
    acquiredRows:0, totalRows:null, snapshot:null, pages:[],
    paymentAccounting:'Page caps are allocations, not charges. Original SF36 reservations and original SF82 chain observations remain authoritative.'};
}
async function nativePage(definition, cfg, result, previous, index) {
  const intentId = cfg.operation.intentId;
  const evidencePath = join(definition.directory, 'evidence', digest(intentId) + '.json');
  const evidenceBytes = await readPrivate(evidencePath, 262144, true);
  const body = await readPrivate(cfg.responseFile.destination, definition.limits.maxPageBytes, true);
  let e,invalidJson=false;
  if(evidenceBytes?.length) {
    try {e=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(evidenceBytes));}
    catch {invalidJson=true;}
  }
  if(!evidenceBytes?.length||invalidJson) {
    const {recoveredDatasetPage}=await import('./dataset-lost-output.mjs');
    const recovered=await recoveredDatasetPage({directory:definition.directory,index,cfg,previous,
      expectedSnapshot:definition.expectedSnapshot,maxRows:definition.limits.maxRows});
    if(recovered)return recovered;
  }
  if (!evidenceBytes || !body) return {pending:true, code:'DATASET_ATTEMPT_NEEDS_ORIGINAL_RECONCILIATION'};
  if(invalidJson||!evidenceBytes.length)throw new InputError('DATASET_NATIVE_EVIDENCE_INVALID');
  need(e?.schema === 'scf82.checkout-evidence.v1' && e.intentId === intentId &&
    e.observation?.intentId === intentId, 'DATASET_NATIVE_EVIDENCE_MISMATCH');
  const outcome = analyzeOne(e.observation), b = e.observation.buyer;
  need(['NO_PAYMENT_REQUIRED','SELLER_REPORTED_ONLY','TRANSFER_VERIFIED_DELIVERY_UNCONFIRMED',
    'TRANSFER_AND_HTTP_BODY_OBSERVED'].includes(outcome.status), 'DATASET_NATIVE_OUTCOME_UNRESOLVED');
  need(b.httpStatus >= 200 && b.httpStatus < 300, 'DATASET_NATIVE_HTTP_NOT_DELIVERED');
  if (b.status === 'DELIVERED_REPORTED_SETTLED') {
    const t = b.requirement, expect = cfg.operation.expect, r = e.operatorReservation;
    need(['scheme','network','asset','payTo'].every(key => t[key] === expect[key]) &&
      BigInt(t.amount) <= BigInt(expect.maxAtomic), 'DATASET_NATIVE_TERMS_MISMATCH');
    need(r?.outcome === 'FRESH_RESERVATION_APPROVED' && r.requestId === intentId &&
      r.network === t.network && r.reservedAtomicUnits === t.amount, 'DATASET_NATIVE_RESERVATION_MISMATCH');
  } else need(b.status === 'NO_PAYMENT_REQUIRED' && e.operatorReservation === null, 'DATASET_NATIVE_OUTCOME_UNRESOLVED');
  if (result) {
    need(result.schema === 'stellar-forge.sf88.dataset-attempt-result.v1' && object(result.summary), 'DATASET_RESULT_INVALID');
    const s = result.summary, f = s.responseFile;
    need(s.mode === 'ORIGINAL_OPERATOR_APPROVED_BUYER_ATTEMPT' && s.intentId === intentId &&
      s.status === b.status && s.httpStatus === b.httpStatus && !s.error && !s.evidenceError &&
      !s.responseCleanupError && f?.status === 'SAVED' && f.sha256 === digest(body) &&
      f.bytes === body.length && f.path === cfg.responseFile.destination &&
      !f.cleanupWarnings?.length && s.evidencePath === evidencePath, 'DATASET_RESULT_NOT_COMPLETE');
  }
  const page = inspectDatasetPage(body, {url:cfg.operation.url, previous,
    expectedSnapshot:definition.expectedSnapshot, maxRows:definition.limits.maxRows});
  return {...page, intentId, requestUrl:cfg.operation.url, responsePath:cfg.responseFile.destination,
    evidencePath, evidenceSha256:digest(evidenceBytes), nativeBuyerStatus:b.status,
    originalOutcome:outcome, operatorReservation:e.operatorReservation,
    recoveredFromOriginalFiles:result === null};
}
async function inspectUnlocked(directory) {
  await privateDirectory(directory);
  await privateDirectory(join(directory, 'pages'));
  await privateDirectory(join(directory, 'evidence'));
  const definition = validateDefinition(await readJson(join(directory, 'session.json')), directory);
  const report = baseReport(definition);
  const entries = (await readdir(join(directory, 'pages'))).filter(name => /^[0-9]{6}$/.test(name)).sort();
  need(entries.length <= definition.limits.maxPages, 'DATASET_TOO_MANY_PAGE_DIRECTORIES');
  let previous = null, allocated = 0n;
  for (let position = 0; position < entries.length; position++) {
    const index = position + 1;
    need(entries[position] === indexName(index), 'DATASET_PAGE_GAP');
    need(previous?.nextCursor !== null, 'DATASET_PAGE_AFTER_COMPLETE');
    const cfg = pageConfig(definition, index, previous?.nextCursor ?? null, allocated);
    const dir = join(directory, 'pages', indexName(index));
    await privateDirectory(dir);
    const pending = await pendingUnpaidContinuation(dir,cfg);
    if(pending) {
      report.status='RECONCILIATION_REQUIRED';
      report.capAllocatedAtomic=(allocated+BigInt(cfg.operation.expect.maxAtomic)).toString();
      report.stoppedPage={index,intentId:cfg.operation.intentId,
        code:'DATASET_UNPAID_CONTINUATION_PENDING',responsePath:cfg.responseFile.destination};
      report.unpaidContinuation=pending;
      report.next='Continue this reviewed unpaid page with its retained attempt SHA-256.';
      return report;
    }
    const savedCfg = await readJson(join(dir, 'config.json'), 262144, true);
    const attempt = await readJson(join(dir, 'attempt.json'), 8192, true);
    const resultMetadata = await auxiliaryJson(join(dir, 'result.json'), 262144);
    const result = resultMetadata.value;
    if (savedCfg) need(equal(savedCfg, cfg), 'DATASET_PAGE_CONFIG_CHANGED');
    if (!attempt) {
      need(position === entries.length - 1 && result === null &&
        await readPrivate(cfg.responseFile.destination, definition.limits.maxPageBytes, true) === null,
        'DATASET_UNSTARTED_PAGE_HAS_OUTPUT');
      break; // A crash while preparing files cannot have invoked the buyer.
    }
    need(savedCfg && attempt.schema === 'stellar-forge.sf88.dataset-attempt.v1' &&
      attempt.index === index && attempt.intentId === cfg.operation.intentId &&
      attempt.configurationSha256 === digest(canonical(cfg)) && attempt.capAtomic === cfg.operation.expect.maxAtomic,
      'DATASET_ATTEMPT_CHANGED');
    allocated += BigInt(attempt.capAtomic);
    report.capAllocatedAtomic = allocated.toString();
    const failureMetadata = await auxiliaryJson(join(dir, 'failure.json'), 8192);
    const failure = failureMetadata.value;
    let page;
    try {
      page = await nativePage(definition, cfg, result, previous, index);
      if (page.pending) throw new InputError(page.code);
    } catch (error) {
      report.status = 'RECONCILIATION_REQUIRED';
      report.stoppedPage = {index, intentId:cfg.operation.intentId, code:safeCode(error),
        originalExecutionError:failure?.code ?? null, responsePath:cfg.responseFile.destination};
      report.unpaidContinuation=await inspectUnpaidContinuation(dir,cfg,attempt,result);
      report.next = report.unpaidContinuation
        ? 'Review the retained unsigned attempt, then explicitly continue it with retryUnpaid and its attempt SHA-256. Original approval and ledger checks run again.'
        : 'Inspect this intent in the original SF36 ledger and SF82 evidence. recover only reads existing files; it never repeats this attempt.';
      return report;
    }
    const recoveryWarnings = [resultMetadata.warning,failureMetadata.warning].filter(Boolean);
    report.pages.push({index, capAllocatedAtomic:attempt.capAtomic, ...page,
      ...(recoveryWarnings.length ? {recoveryWarnings} : {})});
    report.completedPages++;
    report.acquiredRows = page.nextOffset;
    report.totalRows = page.total;
    report.snapshot = page.snapshot;
    previous = page;
  }
  if (previous?.nextCursor === null) report.status = 'COMPLETE';
  else if (report.completedPages >= definition.limits.maxPages) report.status = 'PAGE_LIMIT_REACHED';
  else if (allocated >= BigInt(definition.limits.maxTotalAtomic)) report.status = 'TOTAL_CAP_REACHED';
  if (report.status === 'READY') {
    const cfg = pageConfig(definition, report.completedPages + 1, previous?.nextCursor ?? null, allocated);
    report.nextPage = {index:report.completedPages + 1, intentId:cfg.operation.intentId,
      url:cfg.operation.url, maxAtomic:cfg.operation.expect.maxAtomic};
  }
  return report;
}
export async function inspectDatasetSession(directory) {
  let release;
  try { release = await lock(directory); }
  catch (error) {
    if (error.code !== 'DATASET_SESSION_RUNNING_USE_STATUS') throw error;
    return {schema:'stellar-forge.sf88.dataset-acquisition.v1',directory,status:'RUNNING',
      next:'The session is being updated. Read status again after the current run finishes or use recover after its process exits.'};
  }
  try { return await inspectUnlocked(directory); } finally { await release(); }
}
async function originalPreflight(cfg, environment) {
  execution(cfg);
  const info = await stat(cfg.signerModule);
  need(info.isFile(), 'SIGNER_MODULE_MUST_EXIST');
  // Constructor-only original approval validation: no ledger mutation, signer or HTTP call.
  createOperatorApproval({...cfg.operator, environment});
  await checkOperatorTerminal(cfg.operation.intentId);
}
async function executionContext(definition,{workspace,environment,executePage}) {
  let operatorEnvironment = environment, evidenceRpcEndpoint;
  if (definition.workspaceDirectory !== undefined) {
    const {openWorkspace} = await import('./workspace.mjs');
    const workspace = await openWorkspace(['--dir', definition.workspaceDirectory],
      {execute:executePage === execute, environment});
    need(digest(canonical(workspace.config)) === definition.configurationSha256,
      'DATASET_WORKSPACE_CHANGED_REVIEW_REQUIRED');
    if (executePage === execute) operatorEnvironment = workspace.operatorEnvironment;
  }
  if (workspace !== undefined && definition.workspaceDirectory === undefined) {
    // Query-specific configs still use the selected original workspace's
    // keys, current cap and evidence RPC. Keep executePage unchanged so its
    // original terminal preflight remains before the durable attempt marker.
    const queue = await import('./queue.mjs');
    if (executePage === execute) {
      const selected = await queue.workspaceExecution(definition.config, workspace);
      operatorEnvironment = selected.environment;
      evidenceRpcEndpoint = selected.evidenceRpcEndpoint;
    } else await queue.workspaceConfiguration(workspace, {configuration:definition.config});
  }
  return {operatorEnvironment,evidenceRpcEndpoint};
}
/** Trusted host seam: CLI always supplies the original SF88 execute function. */
export async function runDatasetSession(directory, {signal, executePage = execute, onPage = () => {},
  environment = process.env, emitPageSummaries = true, workspace,
  retryUnpaid = false, expectedAttemptSha256} = {}) {
  need(signal === undefined || signal instanceof AbortSignal, 'INVALID_ABORT_SIGNAL');
  need(typeof executePage === 'function' && typeof onPage === 'function', 'DATASET_EXECUTOR_INVALID');
  need(typeof emitPageSummaries === 'boolean', 'INVALID_SUMMARY_OUTPUT_OPTION');
  need(typeof retryUnpaid==='boolean'&&
    (retryUnpaid?/^[a-f0-9]{64}$/.test(expectedAttemptSha256??''):expectedAttemptSha256===undefined),
    'DATASET_UNPAID_ATTEMPT_REVIEW_REQUIRED');
  if(retryUnpaid)need(executePage===execute,'DATASET_UNPAID_CONTINUATION_REQUIRES_ORIGINAL_EXECUTOR');
  const release = await lock(directory);
  try {
    const definition = validateDefinition(await readJson(join(directory, 'session.json')), directory);
    need(workspace === undefined || typeof workspace === 'string' && isAbsolute(workspace) &&
      resolve(workspace) === workspace, 'DATASET_ABSOLUTE_WORKSPACE_REQUIRED');
    need(workspace === undefined || definition.workspaceDirectory === undefined ||
      workspace === definition.workspaceDirectory, 'DATASET_SAVED_WORKSPACE_MISMATCH');
    let report = await inspectUnlocked(directory);
    if(retryUnpaid) {
      need(report.status==='RECONCILIATION_REQUIRED'&&report.unpaidContinuation&&
        report.unpaidContinuation.attemptSha256===expectedAttemptSha256,
        'DATASET_UNPAID_ATTEMPT_CHANGED');
      const index=report.completedPages+1,previous=report.pages.at(-1);
      need(report.unpaidContinuation.index===index,'DATASET_UNPAID_PAGE_CHANGED');
      const allocated=report.pages.reduce((total,page)=>total+BigInt(page.capAllocatedAtomic),0n);
      const cfg=pageConfig(definition,index,previous?.nextCursor??null,allocated);
      const {operatorEnvironment}=await executionContext(definition,{workspace,environment,executePage});
      await originalPreflight(cfg,operatorEnvironment);
      await continueUnpaidPage(join(directory,'pages',indexName(index)),cfg,
        {expectedAttemptSha256,environment:operatorEnvironment,signal});
      report=await inspectUnlocked(directory);
    }
    while (report.status === 'READY' && !signal?.aborted) {
      const index = report.completedPages + 1;
      const previous = report.pages.at(-1);
      const cfg = pageConfig(definition, index, previous?.nextCursor ?? null, BigInt(report.capAllocatedAtomic));
      const {operatorEnvironment,evidenceRpcEndpoint}=await executionContext(definition,{workspace,environment,executePage});
      if (executePage === execute) await originalPreflight(cfg, operatorEnvironment);
      const dir = join(directory, 'pages', indexName(index));
      try { await mkdir(dir, {mode:0o700}); } catch (e) { if (e.code !== 'EEXIST') throw e; }
      await privateDirectory(dir);
      const savedCfg = await readJson(join(dir, 'config.json'), 262144, true);
      if (!savedCfg) await createJson(join(dir, 'config.json'), cfg);
      else need(equal(savedCfg, cfg), 'DATASET_PAGE_CONFIG_CHANGED');
      if (signal?.aborted) break;
      // This marker is durable BEFORE execution. Only an explicit authenticated
      // unsigned continuation can archive an earlier marker; recover stays read-only.
      await createJson(join(dir, 'attempt.json'), {schema:'stellar-forge.sf88.dataset-attempt.v1',
        index, intentId:cfg.operation.intentId, configurationSha256:digest(canonical(cfg)),
        capAtomic:cfg.operation.expect.maxAtomic, startedAt:new Date().toISOString()});
      try {
        const summary = await executePage(cfg, {signal, environment:operatorEnvironment,
          emitSummary:emitPageSummaries, ...(evidenceRpcEndpoint === undefined ? {} : {evidenceRpcEndpoint})});
        await createJson(join(dir, 'result.json'), {schema:'stellar-forge.sf88.dataset-attempt-result.v1', summary});
      } catch (error) {
        await createJson(join(dir, 'failure.json'), {code:safeCode(error), at:new Date().toISOString()});
      }
      report = await inspectUnlocked(directory);
      await onPage(report);
    }
    return {...report, interrupted:signal?.aborted === true};
  } finally { await release(); }
}
/** Offline crash recovery: remove a proven-dead same-host lock, then read original files. */
export async function recoverDatasetSession(directory) {
  const release = await lock(directory, true);
  try { return await inspectUnlocked(directory); } finally { await release(); }
}

/** Account for existing page attempts independently of product-file recovery.
 * Session/config/attempt lineage is checked before the shared native worker.
 * Accounting never creates a page or substitutes an earlier purchase attempt. */
export async function accountDatasetSession(directory, {workspace,offset=0,limit=100,
  finalize=false,signal,outbox,merchantRoute}={}) {
  need(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=250,
    'DATASET_ACCOUNTING_RANGE_INVALID');
  need(typeof finalize==='boolean'&&(signal===undefined||signal instanceof AbortSignal),
    'DATASET_ACCOUNTING_OPTIONS_INVALID');
  const release=await lock(directory);
  try {
    const definition=validateDefinition(await readJson(join(directory,'session.json')),directory);
    const selectedWorkspace=workspace??definition.workspaceDirectory??null;
    need(definition.workspaceDirectory===undefined||selectedWorkspace===definition.workspaceDirectory,
      'DATASET_SAVED_WORKSPACE_MISMATCH');
    if(finalize)need(typeof selectedWorkspace==='string'&&isAbsolute(selectedWorkspace)&&
      resolve(selectedWorkspace)===selectedWorkspace,'DATASET_ACCOUNTING_WORKSPACE_REQUIRED');
    const pages=(await readdir(join(directory,'pages'))).filter(name=>/^[0-9]{6}$/.test(name)).sort();
    need(pages.length<=definition.limits.maxPages&&pages.every((name,index)=>name===indexName(index+1)),
      'DATASET_PAGE_GAP');
    need(offset<=pages.length,'DATASET_ACCOUNTING_RANGE_INVALID');
    const {finalizeOriginalAttempt,saveFinalizationView,summarizeFinalization,readUnpaidAttempt}=await import('./finalization.mjs');
    const entries=[];
    const end=Math.min(pages.length,offset+limit);
    for(let position=offset;position<end&&!signal?.aborted;position++) {
      const index=position+1,dir=join(directory,'pages',pages[position]);
      let previous=null,attempt;
      try {
        await privateDirectory(dir);
        attempt=await readJson(join(dir,'attempt.json'),8192,true);
        if(!attempt) {entries.push({index,outcome:'NOT_ATTEMPTED'});continue;}
        const raw=await readPrivate(join(dir,'config.json'),65536);
        let cfg;
        try {cfg=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
        catch {throw new InputError('DATASET_STATE_JSON_INVALID');}
        const query=validateDatasetQuery(cfg.operation?.url,{initial:index===1});
        const allocated=BigInt(definition.config.operation.expect.maxAtomic)*BigInt(index-1);
        const expected=pageConfig(definition,index,query.get('cursor')??null,allocated);
        need(equal(cfg,expected)&&attempt.schema==='stellar-forge.sf88.dataset-attempt.v1'&&
          attempt.index===index&&attempt.intentId===cfg.operation.intentId&&
          attempt.configurationSha256===digest(canonical(cfg))&&attempt.capAtomic===cfg.operation.expect.maxAtomic&&
          Number.isFinite(Date.parse(attempt.startedAt)),'DATASET_ATTEMPT_CHANGED');
        const viewPath=join(dir,'finalization.json');
        const retained=(await auxiliaryJson(viewPath,4_000_000)).value;
        if(retained?.schema==='stellar-forge.sf88.dataset-finalization.v1'&&
          retained.intentId===attempt.intentId&&retained.attemptSha256===digest(canonical(attempt))&&
          retained.configSha256===digest(raw))previous=retained;
        const evidencePath=join(directory,'evidence',digest(attempt.intentId)+'.json');
        const {readDatasetLostOutputRecovery}=await import('./dataset-lost-output.mjs');
        const lost=await readDatasetLostOutputRecovery({directory,index,workspace:selectedWorkspace});
        if(lost) {
          entries.push({index,intentId:attempt.intentId,
            ...summarizeFinalization({result:lost.result,completedAt:lost.completedAt}),
            viewPath:join(dir,'lost-output','recovery.json'),viewStatus:'AUTHENTICATED_RECOVERY',
            lostOutputFinalization:lost,
            ...(outbox?{merchant:{status:'USE_ORIGINAL_LOST_OUTPUT_TRANSFER_EXPORT',outbox,route:merchantRoute}}:{})});
          continue;
        }
        if(!previous) {
          const unpaid=await readUnpaidAttempt({evidencePath,intentId:attempt.intentId,attemptStartedAt:attempt.startedAt});
          if(unpaid) {entries.push({index,intentId:attempt.intentId,...unpaid,evidencePath,viewStatus:'ORIGINAL_RESPONSE'});continue;}
        }
        let view=previous,viewStatus='READ';
        if(finalize) {
          const finalized=await finalizeOriginalAttempt({configurationPath:join(dir,'config.json'),
            configSha256:digest(raw),intentId:attempt.intentId,
            evidencePath,
            bodySha256:null,bodyBytes:0,attemptStartedAt:attempt.startedAt,workspace:selectedWorkspace,
            sourceEvidenceDirectory:join(directory,'evidence'),signal,outbox,merchantRoute});
          view={schema:'stellar-forge.sf88.dataset-finalization.v1',intentId:attempt.intentId,
            sessionId:definition.config.operation.intentId,index,attemptSha256:digest(canonical(attempt)),
            configSha256:digest(raw),...finalized,
            recordAuthority:'ORIGINAL_SF36_LEDGER; THIS_FILE_IS_A_SAVED_OPERATOR_VIEW'};
          if(['FINALIZED','IDEMPOTENT_FINALIZED'].includes(finalized.result.outcome))
            view.lastFinalized={completedAt:view.completedAt,result:finalized.result};
          else if(previous?.lastFinalized)view.lastFinalized=previous.lastFinalized;
          try {await saveFinalizationView(viewPath,view);viewStatus='SAVED';}
          catch {viewStatus='SAVE_FAILED';}
        }
        entries.push({index,intentId:attempt.intentId,...summarizeFinalization(view),viewPath,viewStatus});
      } catch(error) {
        entries.push({index,intentId:attempt?.intentId??null,outcome:'NOT_FINALIZED',code:safeCode(error),
          lastFinalized:summarizeFinalization(previous).lastFinalized});
      }
    }
    const next=offset+entries.length;
    return {schema:'stellar-forge.sf88.session-accounting.v1',kind:'dataset',directory,
      sessionId:definition.config.operation.intentId,configurationSha256:definition.configurationSha256,
      workspace:selectedWorkspace,mode:finalize?'FINALIZE':'VIEW',observedAt:new Date().toISOString(),
      terms:definition.config.operation.expect,
      range:{offset,limit,total:pages.length,nextOffset:next<pages.length?next:null},
      entries,interrupted:signal?.aborted===true,
      recordAuthority:'ORIGINAL_SF36_LEDGER; PER-PAGE VIEWS ARE SAVED BESIDE THE ORIGINAL ATTEMPT'};
  } finally {await release();}
}
export async function exportDatasetManifest(directory, destination) {
  need(typeof destination === 'string' && isAbsolute(destination), 'DATASET_ABSOLUTE_EXPORT_REQUIRED');
  const release = await lock(directory);
  try {
    const report = await inspectUnlocked(directory);
    need(report.status === 'COMPLETE', 'DATASET_COMPLETE_SESSION_REQUIRED');
    const manifest = {...report, exportedAt:new Date().toISOString(),
      pageFiles:report.pages.map(page => page.responsePath),
      exporter:'Pass pageFiles in their existing order to the original SF100 buyer dataset delivery tool.'};
    await createJson(destination, manifest);
    return {status:'EXPORTED', path:destination, pages:report.completedPages, rows:report.acquiredRows};
  } finally { await release(); }
}
/** Complete the offline acquisition-to-data-room handoff using original SF100. */
export async function deliverDatasetSession(directory, destination) {
  const release = await lock(directory);
  try {
    const report = await inspectUnlocked(directory);
    need(report.status === 'COMPLETE', 'DATASET_COMPLETE_SESSION_REQUIRED');
    const {buildNativeDataRoom} = await import('./dataset-delivery.mjs');
    return await buildNativeDataRoom(report, destination);
  } finally { await release(); }
}

// Original canonical validation shared with the fixed SF36 source observer.
export {validateDefinition as validateDatasetDefinition,pageConfig as datasetPageConfiguration};
