// MIT. A durable local job composition around the original SF88 buyer command.
import { constants } from 'node:fs';
import { mkdir, open, readFile, stat, lstat, realpath, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { hostname } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as readNativeConfig, execution, bytes, need } from '../sf88-operator-buyer-cli/config.mjs';

export const MANIFEST_SCHEMA = 'stellar-forge.buyer-runbook.v1';
const PLAN_SCHEMA = 'stellar-forge.buyer-runbook-plan.v1';
const STATE_SCHEMA = 'stellar-forge.buyer-runbook-result.v1';
const nativeCli = fileURLToPath(new URL('../sf88-operator-buyer-cli/cli.mjs', import.meta.url));
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const has = (value, key) => Object.hasOwn(value, key);
const serialized = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const codeOf = (error, fallback = 'RUNBOOK_IO_ERROR') => /^[A-Z0-9_]{1,120}$/.test(error?.code ?? '') ? error.code : fallback;
const within = (dir, path) => path.startsWith(dir + '/');
const now = () => new Date().toISOString();

function shape(value, keys, code) {
  need(object(value) && Object.keys(value).every(key => keys.includes(key)), code);
}
function label(value, fallback) {
  if (value === undefined) return fallback;
  need(typeof value === 'string' && value.length > 0 && value.length <= 160 && !/[\x00-\x1f\x7f]/.test(value), 'INVALID_LABEL');
  return value;
}
function absolute(value) {
  need(typeof value === 'string' && isAbsolute(value) && !value.includes('\0'), 'ABSOLUTE_RUNBOOK_PATH_REQUIRED');
  return resolve(value);
}
async function syncDir(path) {
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
async function createFile(path, data) {
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
  await syncDir(dirname(path));
}
async function replaceFile(path, data) {
  const tmp = path + '.' + randomUUID() + '.tmp';
  await createFile(tmp, data);
  try { await rename(tmp, path); await syncDir(dirname(path)); }
  catch (error) { await unlink(tmp).catch(() => {}); throw error; }
}
async function readRegular(path, max = 1048576) {
  const info = await lstat(path);
  need(info.isFile() && info.size <= max, 'RUNBOOK_FILE_INVALID');
  const data = await readFile(path);
  need(data.length <= max, 'RUNBOOK_FILE_TOO_LARGE');
  return data;
}
async function readJson(path, max) {
  const data = await readRegular(path, max);
  try { return JSON.parse(new TextDecoder('utf-8', { fatal:true }).decode(data)); }
  catch { need(false, 'RUNBOOK_JSON_INVALID'); }
}
async function optionalJson(path) {
  try { return await readJson(path); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function recordAt(path) {
  try { return await readJson(path); }
  catch (error) { return error.code === 'ENOENT' ? null : {readError:codeOf(error, 'RECORD_UNREADABLE')}; }
}
async function attempted(directory, id) {
  for (const suffix of ['started.json','result.json','recovered.json','stdout.json','stderr.txt']) {
    try { await lstat(join(directory, 'attempts', id + '.' + suffix)); return true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return false;
}
async function finalRecord(directory, op) {
  for (const suffix of ['recovered.json','result.json']) {
    const value = await recordAt(join(directory, 'attempts', op.id + '.' + suffix));
    if (value && !value.readError) {
      need(value.schema === STATE_SCHEMA && value.id === op.id && value.intentId === op.intentId &&
        (value.summary === null || validSummary(value.summary, op.intentId)), 'RESULT_RECORD_MISMATCH');
      return value;
    }
  }
  return null;
}
async function privateDirectory(path) {
  const info = await lstat(path);
  need(info.isDirectory() && (process.platform === 'win32' || (info.mode & 0o077) === 0), 'PRIVATE_RUNBOOK_DIRECTORY_REQUIRED');
}
async function canonicalDestination(path) {
  // Resolve directory aliases before checking output collisions. A planned
  // runbook download directory is handled by its future canonical parent.
  return join(await realpath(dirname(path)), basename(path));
}
function configPath(dir, id) { return join(dir, 'configs', id + '.json'); }
function startedPath(dir, id) { return join(dir, 'attempts', id + '.started.json'); }
function resultPath(dir, id) { return join(dir, 'attempts', id + '.result.json'); }
function stdoutPath(dir, id) { return join(dir, 'attempts', id + '.stdout.json'); }
function stderrPath(dir, id) { return join(dir, 'attempts', id + '.stderr.txt'); }

/** Snapshot explicit, complete SF88 configurations. No signer module is loaded. */
export async function initializeRunbook({ manifest, output }) {
  const manifestPath = absolute(manifest), directory = absolute(output);
  const parent = await realpath(dirname(directory));
  need(directory === join(parent, basename(directory)), 'RUNBOOK_PARENT_MUST_BE_CANONICAL');
  const raw = await readRegular(manifestPath);
  let source;
  try { source = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(raw)); }
  catch { need(false, 'MANIFEST_JSON_INVALID'); }
  shape(source, ['schema','id','title','operations'], 'INVALID_MANIFEST_FIELDS');
  need(source.schema === MANIFEST_SCHEMA && idPattern.test(source.id ?? '') &&
    Array.isArray(source.operations) && source.operations.length >= 1 && source.operations.length <= 64, 'INVALID_MANIFEST');
  const title = label(source.title, source.id);
  const ids = new Set(), intents = new Set(), destinations = new Set(), groups = new Map();
  const records = [], writes = [];
  let totalBodyBytes = 0;
  for (const entry of source.operations) {
    shape(entry, ['id','label','config','saveAs'], 'INVALID_MANIFEST_OPERATION');
    need(idPattern.test(entry.id ?? '') && !ids.has(entry.id), 'DUPLICATE_OR_INVALID_JOB_ID');
    ids.add(entry.id);
    need(typeof entry.config === 'string' && entry.config.length > 0 && !entry.config.includes('\0'), 'CONFIG_PATH_REQUIRED');
    const sourcePath = resolve(dirname(manifestPath), entry.config);
    const sourceBytes = await bytes(sourcePath, 65536, 'INVALID_CONFIG_FILE');
    const cfg = await readNativeConfig(sourcePath);
    // Catch a concurrent edit between the native parse and byte snapshot.
    need(sha256(sourceBytes) === sha256(await bytes(sourcePath, 65536, 'INVALID_CONFIG_FILE')), 'CONFIG_CHANGED_DURING_IMPORT');
    const parsedSnapshot = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(sourceBytes));
    need(JSON.stringify(cfg) === JSON.stringify(parsedSnapshot), 'CONFIG_CHANGED_DURING_IMPORT');
    if (entry.saveAs !== undefined) {
      need(typeof entry.saveAs === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(entry.saveAs) &&
        cfg.responseFile === undefined && cfg.captureBody !== true, 'SAVE_AS_REQUIRES_UNCONFIGURED_RESPONSE_FILE');
      cfg.responseFile = { destination:join(directory, 'downloads', entry.saveAs) };
      cfg.captureBody = false;
    }
    const { op, owner, download } = execution(cfg);
    need(!intents.has(op.intentId), 'DUPLICATE_NATIVE_INTENT_ID');
    intents.add(op.intentId);
    let destination = null;
    if (download) {
      destination = entry.saveAs === undefined ? await canonicalDestination(download.destination) : download.destination;
      need(!destinations.has(destination), 'DUPLICATE_RESPONSE_DESTINATION');
      destinations.add(destination);
    }
    let body = null;
    if (op.bodyFile !== undefined) {
      const sourceBody = await bytes(op.bodyFile, 1048576, 'BODY_FILE_INVALID');
      totalBodyBytes += sourceBody.length;
      need(totalBodyBytes <= 64 * 1048576, 'BODY_SNAPSHOT_BUDGET_EXCEEDED');
      const name = entry.id + '.bin';
      body = { sourcePath:op.bodyFile, path:'bodies/' + name, bytes:sourceBody.length, sha256:sha256(sourceBody) };
      cfg.operation.bodyFile = join(directory, body.path);
      writes.push([body.path, sourceBody]);
    }
    const snapshot = serialized(cfg);
    need(snapshot.length <= 65536, 'SNAPSHOT_EXCEEDS_NATIVE_CONFIG_LIMIT');
    const groupKey = JSON.stringify([op.expect.network, op.expect.asset]);
    const group = groups.get(groupKey) ?? { network:op.expect.network, asset:op.expect.asset, plannedMaximumAtomic:'0', operations:0 };
    group.plannedMaximumAtomic = (BigInt(group.plannedMaximumAtomic) + BigInt(op.expect.maxAtomic)).toString();
    group.operations++;
    groups.set(groupKey, group);
    records.push({ id:entry.id, label:label(entry.label, entry.id), sourceConfig:{path:sourcePath, sha256:sha256(sourceBytes)},
      config:{path:'configs/' + entry.id + '.json', sha256:sha256(snapshot)}, body,
      intentId:op.intentId, url:op.url, method:op.method, acceptedCaps:op.expect, headers:op.headers,
      actor:owner.actor, service:owner.service, signerFilename:basename(cfg.signerModule),
      evidenceDirectory:cfg.evidenceDir, responseFile:download,
      ...(entry.saveAs === undefined ? {} : {downloadName:entry.saveAs}) });
    writes.push(['configs/' + entry.id + '.json', snapshot]);
  }
  // Do not let a response destination overwrite frozen plans, request bodies,
  // or journals. Only declared saveAs outputs may live inside this runbook.
  for (const record of records) if (record.responseFile && within(directory, record.responseFile.destination))
    need(record.downloadName !== undefined, 'INTERNAL_OUTPUT_REQUIRES_SAVE_AS');
  const plan = { schema:PLAN_SCHEMA, id:source.id, title, createdAt:now(), directory,
    manifest:{path:manifestPath, sha256:sha256(raw)}, operations:records, plannedMaximums:[...groups.values()],
    budgetMeaning:'Independent request ceilings grouped by network and asset. These sums are not an approval, reservation, exchange rate or available governor budget.' };
  await mkdir(directory, {mode:0o700});
  await syncDir(dirname(directory));
  for (const child of ['configs','bodies','downloads','attempts']) await mkdir(join(directory, child), {mode:0o700});
  await syncDir(directory);
  for (const [path, data] of writes) await createFile(join(directory, path), data);
  await createFile(join(directory, 'manifest.source.json'), raw);
  await createFile(join(directory, 'plan.json'), serialized(plan));
  return plan;
}

export async function readPlan(path) {
  const directory = absolute(path);
  await privateDirectory(directory);
  const plan = await readJson(join(directory, 'plan.json'), 8 * 1048576);
  need(plan.schema === PLAN_SCHEMA && plan.directory === directory && idPattern.test(plan.id ?? '') &&
    Array.isArray(plan.operations) && plan.operations.length >= 1 && plan.operations.length <= 64, 'INVALID_SAVED_RUNBOOK');
  const ids = new Set();
  for (const op of plan.operations) {
    need(object(op) && idPattern.test(op.id ?? '') && !ids.has(op.id) &&
      /^[a-f0-9]{64}$/.test(op.config?.sha256 ?? ''), 'INVALID_SAVED_JOB');
    ids.add(op.id);
  }
  return plan;
}

async function nativeInput(plan, op) {
  const path = configPath(plan.directory, op.id), raw = await readRegular(path, 65536);
  need(sha256(raw) === op.config.sha256, 'FROZEN_CONFIG_CHANGED');
  const cfg = await readNativeConfig(path);
  need(sha256(await readRegular(path, 65536)) === op.config.sha256, 'FROZEN_CONFIG_CHANGED');
  const parsed = execution(cfg);
  need(parsed.op.intentId === op.intentId && parsed.op.url === op.url && parsed.op.method === op.method &&
    JSON.stringify(parsed.op.expect) === JSON.stringify(op.acceptedCaps) &&
    JSON.stringify(parsed.op.headers) === JSON.stringify(op.headers) &&
    parsed.owner.actor === op.actor && parsed.owner.service === op.service &&
    cfg.evidenceDir === op.evidenceDirectory &&
    JSON.stringify(parsed.download) === JSON.stringify(op.responseFile), 'FROZEN_PLAN_MISMATCH');
  if (op.body) {
    need(parsed.op.bodyFile === join(plan.directory, 'bodies', op.id + '.bin'), 'FROZEN_BODY_PATH_CHANGED');
    const rawBody = await readRegular(parsed.op.bodyFile, 1048576);
    need(sha256(rawBody) === op.body.sha256 && rawBody.length === op.body.bytes, 'FROZEN_BODY_CHANGED');
  } else need(parsed.op.bodyFile === undefined, 'FROZEN_BODY_CHANGED');
  return cfg;
}
function validSummary(summary, id) {
  return object(summary) && summary.mode === 'ORIGINAL_OPERATOR_APPROVED_BUYER_ATTEMPT' &&
    summary.intentId === id && summary.retry === 'NO_AUTOMATIC_RETRY';
}
async function parseSummary(path, id) {
  try { const value = await readJson(path); return validSummary(value, id) ? value : null; }
  catch { return null; }
}
async function processToken(pid) {
  try {
    const [processStat, boot] = await Promise.all([
      readFile(`/proc/${pid}/stat`, 'utf8'), readFile('/proc/sys/kernel/random/boot_id', 'utf8')]);
    return boot.trim() + ':' + processStat.slice(processStat.lastIndexOf(')') + 2).split(' ')[19];
  } catch { return null; }
}
async function alive(pid, token) {
  if (!Number.isSafeInteger(pid) || pid < 1) return true;
  if (token) {
    const current = await processToken(pid);
    if (current && current !== token) return false;
  }
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
}
async function lock(directory) {
  const path = join(directory, '.execution-lock.json');
  const record = { schema:'stellar-forge.buyer-runbook-lock.v1', token:randomUUID(), pid:process.pid,
    processToken:await processToken(process.pid), host:hostname(), startedAt:now() };
  try { await createFile(path, serialized(record)); }
  catch (error) { if (error.code === 'EEXIST') need(false, 'RUNBOOK_EXECUTION_LOCK_EXISTS'); throw error; }
  return async () => {
    const current = await optionalJson(path);
    if (current?.token === record.token) { await unlink(path); await syncDir(directory); }
  };
}

/** Remove only an explicitly selected, local dead owner's execution lock. */
export async function unlockRunbook(directory, ownerPid) {
  const plan = await readPlan(directory), path = join(plan.directory, '.execution-lock.json');
  const record = await optionalJson(path);
  need(record && record.pid === ownerPid && record.host === hostname(), 'LOCK_OWNER_NOT_MATCHED');
  need(!await alive(record.pid, record.processToken), 'LOCK_OWNER_IS_STILL_RUNNING');
  for (const op of plan.operations) {
    const child = await recordAt(join(plan.directory, 'attempts', op.id + '.process.json'));
    const result = await finalRecord(plan.directory, op);
    if (!result && child?.host === hostname()) need(!await alive(child.pid, child.processToken), 'NATIVE_BUYER_IS_STILL_RUNNING');
  }
  // All attempts retain their create-only started record after lock recovery.
  await unlink(path); await syncDir(plan.directory);
  return {status:'STALE_LOCK_REMOVED', ownerPid, attemptsPreserved:true};
}

async function capture(stream, handle, maxBytes) {
  let captured = 0, truncated = false, captureError;
  try {
    for await (const chunk of stream) {
      const available = Math.max(0, maxBytes - captured), take = Math.min(available, chunk.length);
      if (take && !captureError) {
        try { await handle.writeFile(chunk.subarray(0, take)); captured += take; }
        catch { captureError = 'OUTPUT_WRITE_FAILED'; }
      }
      if (take < chunk.length) truncated = true;
    }
    try { await handle.sync(); } catch { captureError ??= 'OUTPUT_SYNC_FAILED'; }
  } catch { captureError ??= 'OUTPUT_STREAM_FAILED'; }
  finally { try { await handle.close(); } catch { captureError ??= 'OUTPUT_CLOSE_FAILED'; } }
  return {bytes:captured, truncated, ...(captureError ? {captureError} : {})};
}

async function nativeAttempt(plan, op, signal) {
  const dir = plan.directory;
  const started = { schema:'stellar-forge.buyer-runbook-started.v1', id:op.id, intentId:op.intentId,
    at:now(), configSha256:op.config.sha256, nativeCliSha256:sha256(await readRegular(nativeCli)),
    owner:{pid:process.pid, host:hostname()}, nativeCommand:'SF88 --execute', retry:'NO_AUTOMATIC_RETRY' };
  await createFile(startedPath(dir, op.id), serialized(started));
  let child, launched = false, exitCode = null, exitSignal = null, stdout, stderr, launchError, outHandle, errHandle;
  try {
    // Recording files must be available before trusted code can execute.
    outHandle = await open(stdoutPath(dir, op.id), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    errHandle = await open(stderrPath(dir, op.id), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await syncDir(join(dir, 'attempts'));
    need(!signal?.aborted, 'RUNBOOK_INTERRUPTED_BEFORE_LAUNCH');
    child = spawn(process.execPath, [nativeCli, '--execute', '--config', configPath(dir, op.id)], {
      shell:false, detached:false, stdio:['inherit','pipe','pipe'], env:process.env,
    });
    const completion = new Promise(resolveExit => {
      child.once('error', error => { launchError = codeOf(error, 'NATIVE_BUYER_START_FAILED'); });
      child.once('close', (code, sig) => resolveExit({code, sig}));
    });
    launched = Number.isSafeInteger(child.pid);
    const stop = () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); };
    signal?.addEventListener('abort', stop, {once:true});
    if (signal?.aborted) stop();
    const streams = [capture(child.stdout, outHandle, 1048576), capture(child.stderr, errHandle, 65536)];
    outHandle = null; errHandle = null;
    try {
      if (launched) await createFile(join(dir, 'attempts', op.id + '.process.json'), serialized({pid:child.pid,
        processToken:await processToken(child.pid), host:hostname(), at:now()}));
    } catch { /* The durable started record still excludes an automatic repeat. */ }
    const outcomes = await Promise.allSettled([completion, ...streams]);
    signal?.removeEventListener('abort', stop);
    if (outcomes[0].status === 'fulfilled') ({code:exitCode, sig:exitSignal} = outcomes[0].value);
    stdout = outcomes[1].status === 'fulfilled' ? outcomes[1].value : {captureError:'STDOUT_CAPTURE_FAILED'};
    stderr = outcomes[2].status === 'fulfilled' ? outcomes[2].value : {captureError:'STDERR_CAPTURE_FAILED'};
  } catch (error) { launchError = codeOf(error, 'NATIVE_BUYER_START_FAILED'); }
  finally {
    if (outHandle) await outHandle.close().catch(() => {});
    if (errHandle) await errHandle.close().catch(() => {});
  }
  const summary = stdout?.truncated || stdout?.captureError ? null : await parseSummary(stdoutPath(dir, op.id), op.intentId);
  const result = { schema:STATE_SCHEMA, id:op.id, intentId:op.intentId, startedAt:started.at, finishedAt:now(),
    nativeProcessStarted:launched, exitCode, exitSignal, summary,
    state:summary ? 'RESULT_RECORDED' : launched ? 'NO_COMPLETE_NATIVE_RESULT' : 'NOT_LAUNCHED',
    stdout:stdout ?? null, stderr:stderr ?? null, ...(launchError ? {launchError} : {}), recovered:false };
  await createFile(resultPath(dir, op.id), serialized(result));
  return result;
}

/** Run every untouched, explicit operation once. Original /dev/tty approval is inherited. */
export async function executeRunbook(directory, {only, signal, onProgress = () => {}} = {}) {
  need(signal === undefined || signal instanceof AbortSignal, 'INVALID_ABORT_SIGNAL');
  const plan = await readPlan(directory);
  need(only === undefined || plan.operations.some(op => op.id === only), 'UNKNOWN_JOB_ID');
  const release = await lock(plan.directory), results = [];
  try {
    for (const op of plan.operations) {
      if (only !== undefined && op.id !== only) continue;
      if (signal?.aborted) break;
      if (await attempted(plan.directory, op.id)) {
        results.push({id:op.id, status:'ALREADY_ATTEMPTED'}); continue;
      }
      try {
        const cfg = await nativeInput(plan, op);
        // These are ordinary native setup prerequisites, checked before a
        // durable attempted record is created. No signer code is imported.
        await privateDirectory(cfg.evidenceDir);
        need((await stat(cfg.signerModule)).isFile(), 'SIGNER_MODULE_MUST_EXIST');
        if (cfg.responseFile) {
          await stat(dirname(cfg.responseFile.destination));
          try { await lstat(cfg.responseFile.destination); need(false, 'RESPONSE_DESTINATION_ALREADY_EXISTS'); }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
        onProgress({id:op.id, status:'STARTING_ORIGINAL_SF88'});
        const result = await nativeAttempt(plan, op, signal);
        results.push({id:op.id, status:result.state, exitCode:result.exitCode});
        onProgress({id:op.id, status:result.state, exitCode:result.exitCode});
      } catch (error) {
        // A failed preflight does not reserve an attempt or stop independent jobs.
        const hasAttempt = await attempted(plan.directory, op.id);
        const item = {id:op.id, status:hasAttempt ? 'ATTEMPT_RECORD_INCOMPLETE' : 'PREFLIGHT_FAILED', code:codeOf(error)};
        await replaceFile(join(plan.directory, 'attempts', op.id + '.last-error.json'), serialized({...item, at:now()}));
        results.push(item); onProgress(item);
      }
    }
  } finally { await release(); }
  return {schema:'stellar-forge.buyer-runbook-execution.v1', results, interrupted:signal?.aborted === true};
}

/** Recover an original complete SF88 stdout result; never execute or retry. */
export async function recoverRunbook(directory) {
  const plan = await readPlan(directory), release = await lock(plan.directory), recovered = [];
  try {
    for (const op of plan.operations) {
      const started = await recordAt(startedPath(plan.directory, op.id));
      if (!await attempted(plan.directory, op.id) || await finalRecord(plan.directory, op)) continue;
      const processRecord = await recordAt(join(plan.directory, 'attempts', op.id + '.process.json'));
      if (processRecord?.host === hostname() && await alive(processRecord.pid, processRecord.processToken)) {
        recovered.push({id:op.id, state:'NATIVE_BUYER_STILL_RUNNING'}); continue;
      }
      const summary = await parseSummary(stdoutPath(plan.directory, op.id), op.intentId);
      if (!summary) { recovered.push({id:op.id, state:'NO_COMPLETE_NATIVE_RESULT'}); continue; }
      const result = {schema:STATE_SCHEMA, id:op.id, intentId:op.intentId, startedAt:started?.at ?? null,
        recoveredAt:now(), nativeProcessStarted:true, exitCode:null, exitSignal:null, summary,
        state:'RESULT_RECOVERED', recovered:true};
      await createFile(join(plan.directory, 'attempts', op.id + '.recovered.json'), serialized(result));
      recovered.push({id:op.id, state:result.state});
    }
  } finally { await release(); }
  return {schema:'stellar-forge.buyer-runbook-recovery.v1', recovered};
}

/** Current state is reconstructed from immutable attempts, never HTTP guesses. */
export async function inspectRunbook(directory) {
  const plan = await readPlan(directory), rows = [];
  const executionLock = await optionalJson(join(plan.directory, '.execution-lock.json'));
  for (const op of plan.operations) {
    const started = await recordAt(startedPath(plan.directory, op.id));
    const result = await finalRecord(plan.directory, op);
    const lastError = await recordAt(join(plan.directory, 'attempts', op.id + '.last-error.json'));
    let integrity = 'UNCHANGED', integrityError = null;
    try { await nativeInput(plan, op); }
    catch (error) { integrity = 'INPUT_CHANGED_OR_UNAVAILABLE'; integrityError = codeOf(error); }
    rows.push({...op, state:result?.state ?? (await attempted(plan.directory, op.id) ? 'INTERRUPTED_NO_RESULT' : 'UNATTEMPTED'),
      integrity, integrityError, started, result, lastError:result ? null : lastError });
  }
  return {schema:'stellar-forge.buyer-runbook-status.v1', inspectedAt:now(), plan,
    executionLock:executionLock ? {pid:executionLock.pid, host:executionLock.host, startedAt:executionLock.startedAt,
      ownerRunning:executionLock.host === hostname() ? await alive(executionLock.pid, executionLock.processToken) : null} : null,
    operations:rows};
}

export async function saveRunbookReport(directory) {
  const state = await inspectRunbook(directory);
  const { renderReport } = await import('./report.mjs');
  await replaceFile(join(state.plan.directory, 'status.json'), serialized(state));
  await replaceFile(join(state.plan.directory, 'report.html'), Buffer.from(renderReport(state)));
  return {state, reportPath:join(state.plan.directory, 'report.html'), statusPath:join(state.plan.directory, 'status.json')};
}
