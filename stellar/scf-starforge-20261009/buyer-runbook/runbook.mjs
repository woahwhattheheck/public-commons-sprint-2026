// MIT. A durable local job composition around the original SF88 buyer command.
import { constants } from 'node:fs';
import { mkdir, open, readFile, stat, lstat, realpath, rename, unlink, link, readdir } from 'node:fs/promises';
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
async function publishFile(path, data) {
  const tmp = path + '.' + randomUUID() + '.tmp';
  try {
    await createFile(tmp, data);
    // A complete create-only record is visible in one filesystem operation.
    await link(tmp, path);
    await syncDir(dirname(path));
  } finally { await unlink(tmp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
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
async function prepareRunbook({ manifest, output }) {
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
  return {plan, writes, raw};
}

/** Review the same native import without creating a run or loading a signer. */
export function runbookPlanDigest(plan) {
  const {createdAt, ...reviewed} = plan;
  return sha256(serialized(reviewed));
}
export async function previewRunbook(options) {
  const {plan} = await prepareRunbook(options);
  return {plan, sha256:runbookPlanDigest(plan)};
}

function savedPlan(plan, directory) {
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

export async function readPlan(path) {
  const directory = absolute(path);
  await privateDirectory(directory);
  return savedPlan(await readJson(join(directory, 'plan.json'), 8 * 1048576), directory);
}

async function initializationDirectory(path) {
  await mkdir(path, {mode:0o700}).catch(error => { if (error.code !== 'EEXIST') throw error; });
  await privateDirectory(path);
  need(await realpath(path) === path, 'RUNBOOK_INITIALIZATION_DIRECTORY_CHANGED');
  await syncDir(dirname(path));
}
async function initializationFile(path, data) {
  try { await publishFile(path, data); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    need((await readRegular(path, data.length)).equals(data), 'RUNBOOK_INITIALIZATION_INPUT_CHANGED');
  }
}
async function readInitialization(snapshot, directory, expectedSha256) {
  await privateDirectory(snapshot);
  need(await realpath(snapshot) === snapshot, 'RUNBOOK_INITIALIZATION_DIRECTORY_CHANGED');
  const plan = savedPlan(await readJson(join(snapshot, 'plan.json'), 8 * 1048576), directory);
  need(runbookPlanDigest(plan) === expectedSha256, 'RUNBOOK_REVIEW_CHANGED');
  const raw = await readRegular(join(snapshot, 'manifest.source.json'));
  need(sha256(raw) === plan.manifest.sha256, 'RUNBOOK_INITIALIZATION_INPUT_CHANGED');
  const writes = [];
  for (const op of plan.operations) {
    const config = 'configs/' + op.id + '.json';
    need(op.config.path === config, 'RUNBOOK_INITIALIZATION_INPUT_CHANGED');
    const data = await readRegular(join(snapshot, config), 65536);
    need(sha256(data) === op.config.sha256, 'RUNBOOK_INITIALIZATION_INPUT_CHANGED');
    if (op.body) {
      const body = 'bodies/' + op.id + '.bin';
      need(op.body.path === body, 'RUNBOOK_INITIALIZATION_INPUT_CHANGED');
      const bytes = await readRegular(join(snapshot, body));
      need(bytes.length === op.body.bytes && sha256(bytes) === op.body.sha256, 'RUNBOOK_INITIALIZATION_INPUT_CHANGED');
      writes.push([body, bytes]);
    }
    writes.push([config, data]);
  }
  return {plan, writes, raw};
}
async function retainedInitialization({manifest, output, expectedSha256}) {
  const directory = absolute(output);
  const snapshot = join(dirname(directory), '.' + basename(directory) + '.initialization-' +
    (expectedSha256 ?? randomUUID()));
  if (expectedSha256) {
    try { return {snapshot, ...await readInitialization(snapshot, directory, expectedSha256)}; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const prepared = await prepareRunbook({manifest, output});
  const review = runbookPlanDigest(prepared.plan);
  if (expectedSha256 !== undefined) need(review === expectedSha256, 'RUNBOOK_REVIEW_CHANGED');
  await initializationDirectory(snapshot);
  for (const child of ['configs','bodies']) await initializationDirectory(join(snapshot, child));
  for (const [path, data] of prepared.writes) await initializationFile(join(snapshot, path), data);
  await initializationFile(join(snapshot, 'manifest.source.json'), prepared.raw);
  try { await publishFile(join(snapshot, 'plan.json'), serialized(prepared.plan)); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  return {snapshot, ...await readInitialization(snapshot, directory, review)};
}
async function unattemptedInitialization(directory) {
  for (const name of ['.execution-lock.json', '.execution-leases']) {
    try { await lstat(join(directory, name)); need(false, 'RUNBOOK_INITIALIZATION_HAS_EXECUTION_STATE'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  for (const name of ['attempts', 'downloads']) {
    const path = join(directory, name);
    try {
      await privateDirectory(path);
      need((await readdir(path)).length === 0, 'RUNBOOK_INITIALIZATION_HAS_EXECUTION_STATE');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

/** Retain reviewed native bytes before a run exists; resume only that snapshot. */
export async function initializeRunbook({manifest, output, expectedSha256, resume = false}) {
  need(expectedSha256 === undefined || /^[a-f0-9]{64}$/.test(expectedSha256), 'RUNBOOK_REVIEW_CHANGED');
  need(!resume || expectedSha256 !== undefined, 'RUNBOOK_RESUME_REVIEW_REQUIRED');
  const directory = absolute(output);
  if (resume) {
    try {
      const existing = await readPlan(directory);
      need(runbookPlanDigest(existing) === expectedSha256, 'RUNBOOK_REVIEW_CHANGED');
      return existing;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const {plan, writes, raw, snapshot} = await retainedInitialization({manifest, output, expectedSha256});
  try { await mkdir(directory, {mode:0o700}); await syncDir(dirname(directory)); }
  catch (error) { if (!resume || error.code !== 'EEXIST') throw error; }
  await privateDirectory(directory);
  need(await realpath(directory) === directory, 'RUNBOOK_INITIALIZATION_DIRECTORY_CHANGED');
  await unattemptedInitialization(directory);
  const identity = {schema:'stellar-forge.buyer-runbook-initialization.v1',
    directory, snapshot, reviewSha256:runbookPlanDigest(plan)};
  await initializationFile(join(directory, 'initialization.json'), serialized(identity));
  for (const child of ['configs','bodies','downloads','attempts']) await initializationDirectory(join(directory, child));
  for (const [path, data] of writes) await initializationFile(join(directory, path), data);
  await initializationFile(join(directory, 'manifest.source.json'), raw);
  await unattemptedInitialization(directory);
  try { await publishFile(join(directory, 'plan.json'), serialized(plan)); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const result = await readPlan(directory);
  need(runbookPlanDigest(result) === runbookPlanDigest(plan), 'RUNBOOK_REVIEW_CHANGED');
  return result;
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
    const self = await readFile('/proc/self/stat', 'utf8');
    if (Number(self.slice(0, self.indexOf(' '))) !== process.pid) return null;
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
const LEASE_SCHEMA = 'stellar-forge.buyer-runbook-lock.v2';
const RELEASE_SCHEMA = 'stellar-forge.buyer-runbook-lock-release.v1';
const INDEX_SCHEMA = 'stellar-forge.buyer-runbook-lock-index.v2';
const leaseRoot = directory => join(directory, '.execution-leases');
const markerPath = (directory, record) => join(leaseRoot(directory), record.generation + '-' + record.token + '.released.json');
function validateLease(value, generation) {
  need(object(value) && value.schema === (generation === '0' ? 'stellar-forge.buyer-runbook-lock.v1' : LEASE_SCHEMA) &&
    (generation === '0' || value.generation === generation) && Number.isSafeInteger(value.pid) && value.pid > 0 &&
    typeof value.host === 'string' && value.host.length > 0 && typeof value.startedAt === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.token ?? '') &&
    (value.processToken === null || typeof value.processToken === 'string'), 'INVALID_EXECUTION_LEASE');
  return {...value, generation};
}
async function latestLease(directory) {
  let names = [];
  try { await privateDirectory(leaseRoot(directory)); names = await readdir(leaseRoot(directory)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const generations = names.filter(name => /^[1-9][0-9]{0,99}\.json$/.test(name)).map(name => name.slice(0, -5));
  if (generations.length) {
    const generation = generations.reduce((a, b) => BigInt(a) > BigInt(b) ? a : b);
    return validateLease(await readJson(join(leaseRoot(directory), generation + '.json')), generation);
  }
  const legacy = await optionalJson(join(directory, '.execution-lock.json'));
  if (!legacy || legacy.schema === INDEX_SCHEMA) return null;
  return validateLease(legacy, '0');
}
async function wasReleased(directory, record) {
  const value = await optionalJson(markerPath(directory, record));
  if (!value) return false;
  need(value.schema === RELEASE_SCHEMA && value.generation === record.generation && value.token === record.token,
    'INVALID_EXECUTION_LEASE_RELEASE');
  return true;
}
async function prepareLeases(directory) {
  const root = leaseRoot(directory);
  await mkdir(root, {recursive:true, mode:0o700}); await privateDirectory(root);
  need(await realpath(root) === root, 'LEASE_DIRECTORY_MUST_BE_CANONICAL');
  const index = join(directory, '.execution-lock.json');
  if (!await optionalJson(index)) {
    try { await publishFile(index, serialized({schema:INDEX_SCHEMA, createdAt:now()})); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
}
async function releaseLease(directory, record, reason) {
  const marker = {schema:RELEASE_SCHEMA, generation:record.generation, token:record.token, releasedAt:now(), reason};
  try { await publishFile(markerPath(directory, record), serialized(marker)); return false; }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    need(await wasReleased(directory, record), 'INVALID_EXECUTION_LEASE_RELEASE');
    return true;
  }
}
/** Internal local exclusion primitive shared by execution and recovery. */
export async function acquireExecutionLease(directory) {
  await prepareLeases(directory);
  const previous = await latestLease(directory);
  need(!previous || await wasReleased(directory, previous), 'RUNBOOK_EXECUTION_LOCK_EXISTS');
  const generation = previous ? String(BigInt(previous.generation) + 1n) : '1';
  need(generation.length <= 100, 'EXECUTION_LEASE_GENERATION_LIMIT');
  const record = {schema:LEASE_SCHEMA, generation, token:randomUUID(), pid:process.pid,
    processToken:await processToken(process.pid), host:hostname(), startedAt:now()};
  try { await publishFile(join(leaseRoot(directory), generation + '.json'), serialized(record)); }
  catch (error) { if (error.code === 'EEXIST') need(false, 'RUNBOOK_EXECUTION_LOCK_EXISTS'); throw error; }
  // Generations and release markers are never reused or removed. Contenders for
  // the same next generation meet one create-exclusive publication; a delayed
  // release of an older generation cannot affect its successor.
  return () => releaseLease(directory, record, 'OPERATION_FINISHED');
}

/** Short metadata mutations share the original immutable lease generations.
 * No native buyer is launched under this lease. A dead local metadata owner
 * can be recovered before the next draft save or initialization continues. */
export async function acquireRunbookMetadataLease(directory) {
  await privateDirectory(directory);
  need(await realpath(directory) === directory, 'LEASE_DIRECTORY_MUST_BE_CANONICAL');
  const previous = await latestLease(directory);
  if (previous && !await wasReleased(directory, previous)) {
    need(previous.host === hostname() && !await alive(previous.pid, previous.processToken), 'RUNBOOK_METADATA_LOCK_EXISTS');
    await releaseLease(directory, previous, 'DEAD_METADATA_OWNER_RECOVERY');
  }
  try { return await acquireExecutionLease(directory); }
  catch (error) {
    if (error.code === 'RUNBOOK_EXECUTION_LOCK_EXISTS') need(false, 'RUNBOOK_METADATA_LOCK_EXISTS');
    throw error;
  }
}

/** Release only an explicitly selected, local dead owner's immutable lease. */
export async function unlockRunbook(directory, ownerPid) {
  const plan = await readPlan(directory), record = await latestLease(plan.directory);
  need(record && record.pid === ownerPid && record.host === hostname(), 'LOCK_OWNER_NOT_MATCHED');
  need(!await alive(record.pid, record.processToken), 'LOCK_OWNER_IS_STILL_RUNNING');
  for (const op of plan.operations) {
    const child = await recordAt(join(plan.directory, 'attempts', op.id + '.process.json'));
    const result = await finalRecord(plan.directory, op);
    if (!result && child?.host === hostname()) need(!await alive(child.pid, child.processToken), 'NATIVE_BUYER_IS_STILL_RUNNING');
  }
  await prepareLeases(plan.directory);
  const alreadyReleased = await releaseLease(plan.directory, record, 'DEAD_OWNER_RECOVERY');
  return {status:'STALE_LOCK_RELEASED', ownerPid, generation:record.generation, alreadyReleased, attemptsPreserved:true};
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
  const release = await acquireExecutionLease(plan.directory), results = [];
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
  const plan = await readPlan(directory), release = await acquireExecutionLease(plan.directory), recovered = [];
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
  const lease = await latestLease(plan.directory);
  const executionLock = lease && !await wasReleased(plan.directory, lease) ? lease : null;
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
    executionLock:executionLock ? {pid:executionLock.pid, generation:executionLock.generation, host:executionLock.host, startedAt:executionLock.startedAt,
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
