// MIT. Resumable object acquisition through the original SF88 durable buyer inbox.
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, mkdir, lstat, stat, realpath, readdir, readFile, link, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { hostname } from 'node:os';
import { config, execution, preparedFrom, InputError, need } from './config.mjs';
import { initializeQueue, openQueue } from './queue.mjs';
import { createOperatorApproval } from '../sf81-buyer-operator-bridge/bridge.mjs';
import { analyzeOne } from '../sf52-buyer-outcomes/outcomes.mjs';

const SESSION = 'stellar-forge.sf88.object-session.v1';
const REPORT = 'stellar-forge.sf88.object-acquisition.v1';
const LOCK = 'stellar-forge.sf88.object-session-lock.v1';
const RELEASE = 'stellar-forge.sf88.object-session-lock-release.v1';
const ASSEMBLY = 'stellar-forge.sf88.object-assembly.v1';
const MAX_I128 = 170141183460469231731687303715884105727n;
const MAX_CHUNKS = 100000;
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sha = value => createHash('sha256').update(value).digest('hex');
const encoded = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const now = () => new Date().toISOString();
const indexName = index => String(index).padStart(6, '0');
const count = value => Number.isSafeInteger(value) && value >= 1;
const atomic = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,38})$/.test(value) && BigInt(value) <= MAX_I128;
const codeOf = error => /^[A-Z0-9_]{1,120}$/.test(error?.code ?? '') ? error.code :
  /^[A-Z0-9_]{1,120}$/.test(error?.message ?? '') ? error.message : 'OBJECT_OPERATION_FAILED';

function absolute(path, code = 'OBJECT_ABSOLUTE_PATH_REQUIRED') {
  need(typeof path === 'string' && isAbsolute(path) && !path.includes('\0') && path === resolve(path), code);
  return path;
}
function privateInfo(info) {
  return process.platform === 'win32' || ((info.mode & 0o077) === 0 &&
    (typeof process.getuid !== 'function' || info.uid === process.getuid()));
}
async function privateDirectory(path) {
  absolute(path);
  const info = await lstat(path);
  need(info.isDirectory() && !info.isSymbolicLink() && privateInfo(info), 'OBJECT_PRIVATE_DIRECTORY_REQUIRED');
  need(await realpath(path) === path, 'OBJECT_SYMLINK_DIRECTORY_REFUSED');
}
async function syncDirectory(path) {
  if (process.platform === 'win32') return;
  const handle = await open(path, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function readPrivate(path, limit, optional = false) {
  let file;
  try { file = await open(path, constants.O_RDONLY | NOFOLLOW | (constants.O_NONBLOCK ?? 0)); }
  catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
  try {
    const info = await file.stat();
    need(info.isFile() && info.size <= limit && privateInfo(info), 'OBJECT_PRIVATE_FILE_REQUIRED');
    const bytes = await file.readFile();
    need(bytes.length <= limit, 'OBJECT_FILE_LIMIT_EXCEEDED');
    return bytes;
  } finally { await file.close(); }
}
async function readJson(path, limit = 131072, optional = false) {
  const bytes = await readPrivate(path, limit, optional);
  if (bytes === null) return null;
  try { return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes)); }
  catch { throw new InputError('OBJECT_STATE_JSON_INVALID'); }
}
async function absent(path, code) {
  try { await lstat(path); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new InputError(code);
}
// A visible manifest, lock or configuration is always a complete, fsynced file.
// Publication refuses an existing filename; no retained attempt is overwritten.
async function createFile(path, bytes) {
  const temporary = join(dirname(path), '.object-write-' + randomUUID());
  const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW, 0o600);
  try {
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    await link(temporary, path);
    await syncDirectory(dirname(path));
  } finally { await unlink(temporary).catch(() => {}); }
}
async function createJson(path, value) { await createFile(path, encoded(value)); }

function validateSelection(value, sourceUrl) {
  if (value === null) return;
  need(object(value) && Object.keys(value).every(key =>
    ['schema','descriptionSha256','objectId','filename','path'].includes(key)) &&
    value.schema === 'stellar-forge.sf88.object-selection.v1' && HASH.test(value.descriptionSha256) &&
    typeof value.objectId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value.objectId) &&
    typeof value.filename === 'string' && value.filename.length <= 120 &&
    /^[A-Za-z0-9][A-Za-z0-9_. -]*$/.test(value.filename) && !/[. ]$/.test(value.filename) &&
    value.path === new URL(sourceUrl).pathname, 'OBJECT_SELECTION_INVALID');
}
function validateDefinition(value, directory) {
  need(object(value) && value.schema === SESSION && value.directory === directory &&
    UUID.test(value.sessionId) && Number.isFinite(Date.parse(value.createdAt)) && object(value.config) &&
    value.configurationSha256 === sha(encoded(value.config)), 'OBJECT_SESSION_INVALID');
  need(Object.keys(value.config).every(key => ['catalog','operation','operator','signerModule','evidenceDir',
    'trustedPayer','captureBody','bodyCaptureTimeoutMs','preparedFrom','buyerTransport'].includes(key)), 'OBJECT_GET_CONFIG_REQUIRED');
  if (value.config.preparedFrom !== undefined) preparedFrom(value.config.preparedFrom);
  const {op} = execution(value.config);
  need(op.method === 'GET' && op.bodyFile === undefined && value.config.responseFile === undefined &&
    (value.config.captureBody === undefined || value.config.captureBody === false), 'OBJECT_GET_CONFIG_REQUIRED');
  need(new URL(op.url).search === '', 'OBJECT_INITIAL_QUERY_MUST_BE_EMPTY');
  need(value.workspace === null || typeof value.workspace === 'string', 'OBJECT_WORKSPACE_INVALID');
  if (value.workspace !== null) absolute(value.workspace, 'OBJECT_ABSOLUTE_WORKSPACE_REQUIRED');
  // Sessions written before whole-file support keep their exact range plan.
  const deliveryMode = value.deliveryMode === undefined ? 'chunks' : value.deliveryMode;
  need(['chunks','whole'].includes(deliveryMode), 'OBJECT_DELIVERY_MODE_INVALID');
  need(Number.isSafeInteger(value.bytes) && count(value.chunkBytes) && count(value.chunkCount) &&
    (deliveryMode === 'whole'
      ? value.bytes >= 0 && value.chunkCount === 1 && value.chunkBytes === Math.max(1,value.bytes)
      : value.bytes > 0 && value.chunkCount <= MAX_CHUNKS &&
        BigInt(value.chunkCount) === (BigInt(value.bytes) + BigInt(value.chunkBytes) - 1n) / BigInt(value.chunkBytes)),
    'OBJECT_BYTE_PLAN_INVALID');
  need(typeof value.expectedSnapshot === 'string' && HASH.test(value.expectedSnapshot), 'OBJECT_EXPECTED_SNAPSHOT_REQUIRED');
  need(value.expectedSha256 === null || typeof value.expectedSha256 === 'string' && HASH.test(value.expectedSha256),
    'OBJECT_EXPECTED_SHA256_INVALID');
  need(value.expectedContentType === null || typeof value.expectedContentType === 'string' &&
    value.expectedContentType.length > 0 && value.expectedContentType.length <= 256 &&
    !/[\x00-\x1f\x7f]/.test(value.expectedContentType), 'OBJECT_EXPECTED_CONTENT_TYPE_INVALID');
  const limits = value.limits;
  need(object(limits) && atomic(limits.maxTotalAtomic) && atomic(op.expect.maxAtomic) &&
    limits.maxAtomic === op.expect.maxAtomic &&
    limits.plannedMaxAtomic === (BigInt(op.expect.maxAtomic) * BigInt(value.chunkCount)).toString() &&
    BigInt(limits.plannedMaxAtomic) <= BigInt(limits.maxTotalAtomic), 'OBJECT_TOTAL_BUDGET_INSUFFICIENT');
  validateSelection(value.selection, op.url);
  return {...value,deliveryMode};
}
function chunkPlan(definition, index) {
  const whole = definition.deliveryMode === 'whole';
  const offset = index * definition.chunkBytes;
  const length = Math.min(definition.chunkBytes, definition.bytes - offset);
  const id = indexName(index), intentId = `object:${definition.sessionId}:${id}`;
  const url = new URL(definition.config.operation.url);
  if (!whole) {
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('length', String(length));
  }
  const configuration = structuredClone(definition.config);
  const {op} = execution(configuration);
  configuration.operation = {...op, intentId, url:url.href};
  configuration.captureBody = false;
  configuration.responseFile = {destination:join(definition.directory, 'chunks', id + '.bin'),
    maxBytes:Math.max(1,length), timeoutMs:30000,
    ...(whole ? {expectedBytes:definition.bytes,
      ...(definition.expectedSha256 === null ? {} : {expectedSha256:definition.expectedSha256})} : {})};
  return {index, offset, length, intentId, url:url.href, configuration,
    configPath:join(definition.directory, 'configs', id + '.json'),
    responsePath:configuration.responseFile.destination,
    evidencePath:join(configuration.evidenceDir, sha(intentId) + '.json')};
}
/** Read the original immutable plan from live state or a mapped recovery copy.
 * Logical paths remain unchanged; only the storage location is substituted.
 * This never opens a signer, starts a request or changes an inbox/ledger. */
export async function readObjectRecoveryPlan(directory, {storageDirectory = directory} = {}) {
  absolute(directory); await privateDirectory(storageDirectory);
  const raw = await readPrivate(join(storageDirectory, 'session.json'), 131072);
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(raw)); }
  catch { throw new InputError('OBJECT_STATE_JSON_INVALID'); }
  const definition = validateDefinition(value, directory), digest = createHash('sha256');
  const configs = join(storageDirectory, 'configs'); await privateDirectory(configs);
  const names = await readdir(configs);
  need(names.length === definition.chunkCount && names.every(name => /^[0-9]{6}\.json$/.test(name)),
    'OBJECT_CONFIGURATION_BINDING_CHANGED');
  for (let index = 0; index < definition.chunkCount; index++) {
    const id = indexName(index), bytes = await readPrivate(join(configs, id + '.json'), 131072);
    need(bytes.equals(encoded(chunkPlan(definition, index).configuration)), 'OBJECT_CONFIGURATION_BINDING_CHANGED');
    digest.update(id + ':' + sha(bytes) + '\n');
  }
  return {definition, definitionSha256:sha(raw), configurationsSha256:digest.digest('hex'),
    assemblies:await recordedAssemblies(definition, {storageDirectory})};
}

function baseReport(definition) {
  const {op} = execution(definition.config);
  return {schema:REPORT, directory:definition.directory, sessionId:definition.sessionId,
    sourceIntentId:op.intentId, createdAt:definition.createdAt, inspectedAt:now(),
    configurationSha256:definition.configurationSha256, sourceUrl:op.url,
    queueRoot:join(definition.directory, 'inbox'), workspace:definition.workspace, selection:definition.selection,
    deliveryMode:definition.deliveryMode, bytes:definition.bytes,
    chunkBytes:definition.chunkBytes, chunkCount:definition.chunkCount,
    expectedSnapshot:definition.expectedSnapshot, expectedSha256:definition.expectedSha256,
    expectedContentType:definition.expectedContentType, snapshot:definition.expectedSnapshot,
    terms:{scheme:op.expect.scheme,network:op.expect.network,asset:op.expect.asset,payTo:op.expect.payTo},
    limits:definition.limits, maxTotalAtomic:definition.limits.maxTotalAtomic,
    status:'READY', attemptedChunks:0, completeChunks:0, completedChunks:0, assemblies:[], assembly:null,
    downloadedBytes:0, capAllocatedAtomic:'0', chunks:[], nextChunk:null, objectSha256:null,
    retry:'NO_AUTOMATIC_RETRY',
    paymentAccounting:'Allocated caps are maximum authorizations, not charges. Each request retains the original SF36 reservation and SF52 outcome.'};
}
function chunkView(plan, job) {
  return {index:plan.index, offset:plan.offset, length:plan.length, intentId:plan.intentId,
    url:plan.url, responsePath:plan.responsePath, evidencePath:plan.evidencePath,
    state:job?.state ?? 'MISSING', queueState:job?.state ?? 'MISSING',
    capAllocatedAtomic:job?.attempt?.kind === 'EXECUTE' ? plan.configuration.operation.expect.maxAtomic : '0',
    attemptId:job?.attempt?.id ?? null, originalOutcome:null, sha256:null, contentType:null};
}
function bindJob(plan, job) {
  const bytes = encoded(plan.configuration), owner = plan.configuration.operator;
  need(job && job.state !== 'REVIEW_REQUIRED', job?.lastError?.code ?? 'OBJECT_NATIVE_JOB_MISSING');
  need(job.id === sha(plan.intentId) && job.sourceConfigSha256 === sha(bytes) && job.configSha256 === sha(bytes) &&
    same(job.operation, plan.configuration.operation) &&
    same(job.operator, {actor:owner.actor,service:owner.service,ledger:owner.ledger}) &&
    job.responseDestination === plan.responsePath && job.evidencePath === plan.evidencePath,
  'OBJECT_NATIVE_JOB_BINDING_CHANGED');
}

// Stream the exact saved file through one reusable buffer. The hash binds the
// bytes actually read, while before/after file identity catches concurrent edits.
async function streamChunk(path, length, expectedSha256, consume = null) {
  const file = await open(path, constants.O_RDONLY | NOFOLLOW | (constants.O_NONBLOCK ?? 0));
  try {
    const info = await file.stat();
    need(info.isFile() && info.nlink === 1 && info.size === length && privateInfo(info), 'OBJECT_CHUNK_FILE_INVALID');
    const before = await file.stat({bigint:true}), hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(Math.max(1, Math.min(65536, length)));
    let bytes = 0;
    for (;;) {
      const {bytesRead} = await file.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      need(bytesRead <= length - bytes, 'OBJECT_CHUNK_LENGTH_MISMATCH');
      const part = buffer.subarray(0, bytesRead);
      hash.update(part);
      if (consume) await consume(part);
      bytes += bytesRead;
    }
    const after = await file.stat({bigint:true});
    need(['dev','ino','size','mtimeNs','ctimeNs'].every(key => before[key] === after[key]), 'OBJECT_CHUNK_CHANGED_DURING_READ');
    need(bytes === length, 'OBJECT_CHUNK_LENGTH_MISMATCH');
    const digest = hash.digest('hex');
    need(digest === expectedSha256, 'OBJECT_CHUNK_SHA256_MISMATCH');
    return {bytes, sha256:digest};
  } finally { await file.close(); }
}
async function nativeChunk(definition, plan, job, {hash, contentType, verifyBytes = true}) {
  const whole = definition.deliveryMode === 'whole';
  bindJob(plan, job);
  need(job.attempt?.kind === 'EXECUTE', job.attempt?.kind === 'CANCELLED' ? 'OBJECT_CHUNK_CANCELLED' : 'OBJECT_NATIVE_ATTEMPT_REQUIRED');
  const summary = job.outcome;
  // An SF82 recovery record alone has no response range/snapshot/header binding.
  // Only the original complete download summary can authenticate a saved chunk.
  need(object(summary), 'OBJECT_ORIGINAL_DOWNLOAD_SUMMARY_REQUIRED');
  need(summary.mode === 'ORIGINAL_OPERATOR_APPROVED_BUYER_ATTEMPT' && summary.intentId === plan.intentId &&
    summary.httpStatus === (whole ? 200 : 206) && ['NO_PAYMENT_REQUIRED','DELIVERED_REPORTED_SETTLED'].includes(summary.status) &&
    summary.evidencePath === plan.evidencePath && !summary.error && !summary.evidenceError &&
    !summary.responseCleanupError && !job.lastError, 'OBJECT_ORIGINAL_RESULT_NOT_COMPLETE');
  const file = summary.responseFile;
  need(object(file) && file.status === 'SAVED' && file.path === plan.responsePath && file.bytes === plan.length &&
    typeof file.sha256 === 'string' && HASH.test(file.sha256) && !file.cleanupError && !file.cleanupWarnings?.length &&
    (file.contentType === null || typeof file.contentType === 'string' && file.contentType.length <= 256 &&
      !/[\x00-\x1f\x7f]/.test(file.contentType)), 'OBJECT_ORIGINAL_FILE_SUMMARY_INVALID');
  const metadata = file.objectMetadata;
  need(object(metadata), 'OBJECT_ORIGINAL_HEADERS_REQUIRED');
  if (whole) need(metadata.contentRange === null, 'OBJECT_WHOLE_CONTENT_RANGE_REFUSED');
  else need(metadata.contentRange === `bytes ${plan.offset}-${plan.offset + plan.length - 1}/${definition.bytes}`,
    'OBJECT_CONTENT_RANGE_MISMATCH');
  need(metadata.totalBytes === String(definition.bytes), 'OBJECT_TOTAL_BYTES_MISMATCH');
  need(metadata.snapshot === definition.expectedSnapshot, 'OBJECT_SNAPSHOT_MISMATCH');
  need(typeof metadata.contentSha256 === 'string' && HASH.test(metadata.contentSha256) &&
    metadata.contentSha256 === file.sha256, 'OBJECT_CONTENT_SHA256_MISMATCH');
  if (definition.expectedContentType !== null)
    need(file.contentType === definition.expectedContentType, 'OBJECT_CONTENT_TYPE_MISMATCH');
  if (contentType !== undefined) need(file.contentType === contentType, 'OBJECT_CONTENT_TYPE_CHANGED');

  const rawEvidence = await readPrivate(plan.evidencePath, 2 * 1024 * 1024);
  let evidence;
  try { evidence = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(rawEvidence)); }
  catch { throw new InputError('OBJECT_NATIVE_EVIDENCE_INVALID'); }
  need(evidence?.schema === 'scf82.checkout-evidence.v1' && evidence.intentId === plan.intentId &&
    evidence.observation?.intentId === plan.intentId && evidence.observedAt === evidence.observation.observedAt &&
    Number.isFinite(Date.parse(evidence.observedAt)) &&
    Date.parse(evidence.observedAt) >= Date.parse(job.attempt.startedAt), 'OBJECT_NATIVE_EVIDENCE_MISMATCH');
  const buyer = evidence.observation.buyer, outcome = analyzeOne(evidence.observation);
  need(buyer.status === summary.status && buyer.httpStatus === summary.httpStatus &&
    ['NO_PAYMENT_REQUIRED','SELLER_REPORTED_ONLY','TRANSFER_VERIFIED_DELIVERY_UNCONFIRMED',
      'TRANSFER_AND_HTTP_BODY_OBSERVED'].includes(outcome.status), 'OBJECT_NATIVE_OUTCOME_UNRESOLVED');
  const reservation = evidence.operatorReservation;
  if (buyer.status === 'DELIVERED_REPORTED_SETTLED') {
    const expected = plan.configuration.operation.expect, terms = buyer.requirement;
    need(['scheme','network','asset','payTo'].every(key => terms[key] === expected[key]) &&
      BigInt(terms.amount) <= BigInt(expected.maxAtomic), 'OBJECT_NATIVE_TERMS_MISMATCH');
    need(reservation?.outcome === 'FRESH_RESERVATION_APPROVED' && reservation.requestId === plan.intentId &&
      reservation.network === terms.network && reservation.reservedAtomicUnits === terms.amount,
    'OBJECT_NATIVE_RESERVATION_MISMATCH');
    need(summary.operatorReservation?.request_id === reservation.requestId &&
      summary.operatorReservation.outcome === reservation.outcome &&
      summary.operatorReservation.network === reservation.network &&
      summary.operatorReservation.reserved_atomic_units === reservation.reservedAtomicUnits,
    'OBJECT_NATIVE_RESERVATION_MISMATCH');
  } else need(reservation === null && summary.operatorReservation === null, 'OBJECT_NATIVE_FREE_RESERVATION_MISMATCH');
  if (verifyBytes) await streamChunk(plan.responsePath, plan.length, file.sha256, part => { hash.update(part); });
  return {...chunkView(plan, job), state:'VERIFIED', sha256:file.sha256, contentType:file.contentType,
    objectMetadata:metadata, evidenceSha256:sha(rawEvidence), nativeBuyerStatus:buyer.status,
    originalOutcome:outcome, operatorReservation:reservation,
    recoveredFromOriginalQueue:job.state === 'RECOVERED'};
}
function finishReport(definition, report, hash, verifyBytes = true) {
  report.inspectedAt = now();
  report.completedChunks = report.completeChunks;
  if (report.status === 'RECONCILIATION_REQUIRED') { report.nextChunk = null; return; }
  if (report.completeChunks === definition.chunkCount) {
    report.status = 'COMPLETE';
    report.nextChunk = null;
    if (verifyBytes) {
      report.objectSha256 = hash.copy().digest('hex');
      if (definition.expectedSha256 !== null && report.objectSha256 !== definition.expectedSha256) {
        report.status = 'RECONCILIATION_REQUIRED';
        report.stoppedChunk = {index:definition.chunkCount - 1, code:'OBJECT_COMPLETE_SHA256_MISMATCH'};
      }
    }
  } else {
    report.status = 'READY';
    const next = report.chunks[report.completeChunks];
    report.nextChunk = {index:next.index,offset:next.offset,length:next.length,intentId:next.intentId,
      url:next.url,maxAtomic:definition.limits.maxAtomic};
  }
}
function stopped(report, view, error) {
  const code = codeOf(error);
  view.state = 'RECONCILIATION_REQUIRED';
  view.code = code;
  if (report.status !== 'RECONCILIATION_REQUIRED') {
    report.status = 'RECONCILIATION_REQUIRED';
    report.stoppedChunk = {index:view.index,intentId:view.intentId,code,responsePath:view.responsePath,
      evidencePath:view.evidencePath};
  }
}
async function inspectInternal(directory, {verifyBytes = true} = {}) {
  absolute(directory);
  await privateDirectory(directory);
  await privateDirectory(join(directory, 'chunks'));
  await privateDirectory(join(directory, 'configs'));
  await privateDirectory(join(directory, 'assemblies'));
  const definition = validateDefinition(await readJson(join(directory, 'session.json')), directory);
  const queue = await openQueue(join(directory, 'inbox'));
  const jobs = await queue.list(), byId = new Map(jobs.map(job => [job.id,job]));
  need(jobs.length === definition.chunkCount && byId.size === definition.chunkCount, 'OBJECT_NATIVE_QUEUE_PLAN_CHANGED');
  const configEntries = (await readdir(join(directory, 'configs'))).filter(name => !name.startsWith('.object-write-'));
  need(configEntries.length === definition.chunkCount, 'OBJECT_CONFIG_PLAN_CHANGED');
  const report = baseReport(definition), hash = createHash('sha256');
  let contentType, gap = false, allocated = 0n;
  for (let index = 0; index < definition.chunkCount; index++) {
    const plan = chunkPlan(definition, index), job = byId.get(sha(plan.intentId));
    const view = chunkView(plan, job);
    report.chunks.push(view);
    if (job?.attempt?.kind === 'EXECUTE') {
      report.attemptedChunks++;
      allocated += BigInt(definition.limits.maxAtomic);
    }
    try {
      const cfgBytes = await readPrivate(plan.configPath, 65536);
      need(cfgBytes.equals(encoded(plan.configuration)), 'OBJECT_CHUNK_CONFIG_CHANGED');
      bindJob(plan, job);
      if (!job.attempt) {
        need(job.state === 'QUEUED', 'OBJECT_NATIVE_QUEUE_STATE_INVALID');
        await absent(plan.responsePath, 'OBJECT_UNATTEMPTED_CHUNK_HAS_OUTPUT');
        await absent(plan.evidencePath, 'OBJECT_UNATTEMPTED_CHUNK_HAS_EVIDENCE');
        gap = true;
        view.state = 'QUEUED';
        continue;
      }
      need(!gap, 'OBJECT_CHUNK_ORDER_INVALID');
      const verified = await nativeChunk(definition, plan, job, {hash,contentType,verifyBytes});
      Object.assign(view, verified);
      contentType = view.contentType;
      report.completeChunks++;
      report.downloadedBytes += plan.length;
    } catch (error) {
      stopped(report, view, error);
      gap = true;
      if (job?.lastError) view.originalExecutionError = job.lastError.code;
      if (job?.recovery) view.originalRecovery = job.recovery;
    }
  }
  report.capAllocatedAtomic = allocated.toString();
  need(allocated <= BigInt(definition.limits.maxTotalAtomic), 'OBJECT_TOTAL_BUDGET_EXCEEDED');
  finishReport(definition, report, hash, verifyBytes);
  report.assemblies = await recordedAssemblies(definition);
  report.assembly = report.assemblies.at(-1) ?? null;
  return {definition,queue,report,hash,contentType};
}

async function recordedAssemblies(definition, {storageDirectory = definition.directory} = {}) {
  const root = join(storageDirectory, 'assemblies'), result = [];
  for (const name of (await readdir(root)).sort()) {
    if (name.startsWith('.object-write-')) continue;
    need(/^[a-f0-9]{64}\.json$/.test(name), 'OBJECT_ASSEMBLY_RECORD_INVALID');
    const value = await readJson(join(root, name), 8192);
    need(value.schema === ASSEMBLY && value.sessionId === definition.sessionId &&
      value.configurationSha256 === definition.configurationSha256 && value.snapshot === definition.expectedSnapshot &&
      value.bytes === definition.bytes && HASH.test(value.sha256) && HASH.test(value.chunkManifestSha256) &&
      value.chunkCount === definition.chunkCount && Number.isFinite(Date.parse(value.createdAt)) &&
      typeof value.destination === 'string' && sha(value.destination) + '.json' === name,
    'OBJECT_ASSEMBLY_RECORD_INVALID');
    absolute(value.destination, 'OBJECT_ASSEMBLY_RECORD_INVALID');
    need(definition.expectedSha256 === null || value.sha256 === definition.expectedSha256, 'OBJECT_ASSEMBLY_RECORD_INVALID');
    result.push({...value,status:'RECORDED',fileRevalidated:false});
  }
  return result.sort((a,b) => a.createdAt.localeCompare(b.createdAt) || a.destination.localeCompare(b.destination));
}
async function processIdentity(pid) {
  try {
    const own = await readFile('/proc/self/stat', 'utf8');
    if (Number(own.slice(0, own.indexOf(' '))) !== process.pid) return null;
    const [record, boot] = await Promise.all([
      readFile(`/proc/${pid}/stat`, 'utf8'),readFile('/proc/sys/kernel/random/boot_id', 'utf8')]);
    return boot.trim() + ':' + record.slice(record.lastIndexOf(')') + 2).split(' ')[19];
  } catch { return null; }
}
async function deadProcess(value) {
  if (value.host !== hostname()) return false;
  if (value.processIdentity) {
    const current = await processIdentity(value.pid);
    if (current && current !== value.processIdentity) return true;
  }
  try { process.kill(value.pid, 0); return false; }
  catch (error) { return error.code === 'ESRCH'; }
}
const leaseRoot = directory => join(directory, 'leases');
const releasePath = (directory, record) => join(leaseRoot(directory), `${record.generation}-${record.nonce}.released.json`);
async function latestLease(directory) {
  await privateDirectory(leaseRoot(directory));
  const numbers = (await readdir(leaseRoot(directory)))
    .filter(name => /^[1-9][0-9]{0,99}\.json$/.test(name)).map(name => name.slice(0, -5));
  if (!numbers.length) return null;
  const generation = numbers.reduce((a,b) => BigInt(a) > BigInt(b) ? a : b);
  const value = await readJson(join(leaseRoot(directory), generation + '.json'), 4096);
  need(value.schema === LOCK && value.generation === generation && UUID.test(value.nonce) && count(value.pid) &&
    value.pid <= 2147483647 && typeof value.host === 'string' && typeof value.startedAt === 'string' &&
    (value.processIdentity === null || typeof value.processIdentity === 'string'), 'OBJECT_LOCK_INVALID');
  return value;
}
async function wasReleased(directory, record) {
  const value = await readJson(releasePath(directory, record), 4096, true);
  if (!value) return false;
  need(value.schema === RELEASE && value.generation === record.generation && value.nonce === record.nonce,
    'OBJECT_LOCK_RELEASE_INVALID');
  return true;
}
async function releaseLease(directory, record, reason) {
  try {
    await createJson(releasePath(directory, record), {schema:RELEASE,generation:record.generation,
      nonce:record.nonce,releasedAt:now(),reason});
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    need(await wasReleased(directory, record), 'OBJECT_LOCK_RELEASE_INVALID');
  }
}
async function readLock(directory) {
  const record = await latestLease(directory);
  return record && !await wasReleased(directory, record) ? record : null;
}
async function acquireLock(directory, {recover = false, kind = 'RUN'} = {}) {
  await privateDirectory(directory);
  const previous = await latestLease(directory);
  if (previous && !await wasReleased(directory, previous)) {
    need(recover, 'OBJECT_SESSION_RUNNING_USE_STATUS_OR_RECOVER');
    need(previous.host === hostname(), 'OBJECT_LOCK_OTHER_HOST');
    need(await deadProcess(previous), 'OBJECT_SESSION_RUNNING');
    await releaseLease(directory, previous, 'DEAD_OWNER_RECOVERY');
  }
  const generation = previous ? (BigInt(previous.generation) + 1n).toString() : '1';
  need(generation.length <= 100, 'OBJECT_LEASE_GENERATION_LIMIT');
  const identity = {schema:LOCK,generation,kind,pid:process.pid,host:hostname(),nonce:randomUUID(),
    processIdentity:await processIdentity(process.pid),startedAt:now()};
  try { await createJson(join(leaseRoot(directory), generation + '.json'), identity); }
  catch (error) {
    if (error.code === 'EEXIST') throw new InputError('OBJECT_SESSION_RUNNING_USE_STATUS_OR_RECOVER');
    throw error;
  }
  // Same native pattern as buyer-runbook: immutable numbered lease claims and
  // generation-specific releases. A delayed recoverer cannot remove a successor.
  const release = () => releaseLease(directory, identity, 'OPERATION_FINISHED');
  release.sealSnapshot = async stagedDirectory => {
    need(stagedDirectory !== directory, 'OBJECT_RECOVERY_CAPTURE_LEASE_CHANGED');
    await privateDirectory(stagedDirectory);
    const source = await latestLease(directory), captured = await latestLease(stagedDirectory);
    need(same(source, identity) && same(captured, identity) && !await wasReleased(directory, identity),
      'OBJECT_RECOVERY_CAPTURE_LEASE_CHANGED');
    await releaseLease(stagedDirectory, identity, 'RECOVERY_SNAPSHOT_COMPLETED');
  };
  return release;
}

/** Hold the same session owner used by acquisition, assembly and finalization. */
export async function acquireObjectRecoveryLease(directory) {
  return acquireLock(directory, {kind:'BACKUP'});
}

async function bindWorkspace(source, path) {
  absolute(path, 'OBJECT_ABSOLUTE_WORKSPACE_REQUIRED');
  const {openWorkspace} = await import('./workspace.mjs');
  const workspace = await openWorkspace(['--dir', path], {execute:false});
  const {op,owner} = execution(source), {op:workspaceOp,owner:workspaceOwner} = execution(workspace.config);
  need(['python','actor','service','policy','ledger'].every(key => owner[key] === workspaceOwner[key]) &&
    source.signerModule === workspace.config.signerModule && source.evidenceDir === workspace.config.evidenceDir &&
    source.trustedPayer === workspace.config.trustedPayer &&
    source.trustedPayer === workspace.manifest.signer.expectedPayer, 'OBJECT_WORKSPACE_OPERATOR_MISMATCH');
  need(['scheme','network','asset','payTo'].every(key => op.expect[key] === workspaceOp.expect[key]) &&
    ['network','asset','payTo'].every(key => op.expect[key] === workspace.manifest.signer[key]) &&
    BigInt(op.expect.maxAtomic) > 0n && BigInt(op.expect.maxAtomic) <= BigInt(workspaceOp.expect.maxAtomic) &&
    BigInt(op.expect.maxAtomic) <= BigInt(workspace.manifest.signer.maxAtomic), 'OBJECT_WORKSPACE_TERMS_MISMATCH');
}
async function bareOperatorPreflight(configuration, environment) {
  execution(configuration);
  need((await stat(configuration.signerModule)).isFile(), 'SIGNER_MODULE_MUST_EXIST');
  // Original constructor only: no approval invocation, child process, signature,
  // wallet import or ledger change. Missing setup leaves the native job QUEUED.
  try { createOperatorApproval({...configuration.operator,environment}); }
  catch (error) { error.code ??= 'OBJECT_ORIGINAL_OPERATOR_PREFLIGHT_FAILED'; throw error; }
}

/** Prepare the selected whole response or fixed ranges in the original inbox. */
export async function createObjectSession({directory,configPath,bytes,chunkBytes,expectedSnapshot,
  expectedSha256 = null,expectedContentType = null,selection = null,workspace = null,maxTotalAtomic,
  deliveryMode = 'chunks'} = {}) {
  absolute(directory);
  absolute(configPath, 'OBJECT_ABSOLUTE_CONFIG_REQUIRED');
  const source = await config(configPath);
  const {op} = execution(source);
  need(['chunks','whole'].includes(deliveryMode), 'OBJECT_DELIVERY_MODE_INVALID');
  if (deliveryMode === 'whole') chunkBytes ??= Math.max(1,bytes);
  need(Number.isSafeInteger(bytes) && (deliveryMode === 'whole' ? bytes >= 0 : bytes > 0) &&
    count(chunkBytes), 'OBJECT_BYTE_PLAN_INVALID');
  const chunkCount = deliveryMode === 'whole' ? 1 :
    Number((BigInt(bytes) + BigInt(chunkBytes) - 1n) / BigInt(chunkBytes));
  const definition = validateDefinition({schema:SESSION,directory,sessionId:randomUUID(),createdAt:now(),
    configurationSha256:sha(encoded(source)),config:source,deliveryMode,bytes,chunkBytes,chunkCount,
    expectedSnapshot,expectedSha256,expectedContentType,selection,workspace,
    limits:{maxAtomic:op.expect.maxAtomic,maxTotalAtomic,
      plannedMaxAtomic:(BigInt(op.expect.maxAtomic) * BigInt(chunkCount)).toString()}}, directory);
  if (workspace !== null) await bindWorkspace(source, workspace);
  need(await realpath(dirname(directory)) === dirname(directory), 'OBJECT_SYMLINK_DIRECTORY_REFUSED');
  await privateDirectory(source.evidenceDir);
  await mkdir(directory, {mode:0o700});
  await privateDirectory(directory);
  await mkdir(join(directory, 'configs'), {mode:0o700});
  await mkdir(join(directory, 'chunks'), {mode:0o700});
  await mkdir(join(directory, 'assemblies'), {mode:0o700});
  await mkdir(leaseRoot(directory), {mode:0o700});
  await initializeQueue(join(directory, 'inbox'));
  const queue = await openQueue(join(directory, 'inbox'));
  for (let index = 0; index < chunkCount; index++) {
    const plan = chunkPlan(definition, index), bytes = encoded(plan.configuration);
    need(bytes.length <= 65536, 'OBJECT_CHUNK_CONFIG_TOO_LARGE');
    await createFile(plan.configPath, bytes);
    await queue.enqueue(plan.configPath);
  }
  // The manifest is published last; a directory interrupted before this point
  // contains no callable object session and has never invoked a buyer.
  await createJson(join(directory, 'session.json'), definition);
  await syncDirectory(directory);
  return (await inspectInternal(directory)).report;
}

/** Read-only progress and byte verification; no wallet, signer or operator keys. */
export async function inspectObjectSession(directory) {
  const {report} = await inspectInternal(directory);
  const lock = await readLock(directory);
  if (lock) {
    const stale = await deadProcess(lock);
    report.lock = {generation:lock.generation,kind:lock.kind,host:lock.host,pid:lock.pid,startedAt:lock.startedAt,
      state:stale ? 'STALE' : lock.host === hostname() ? 'ACTIVE' : 'OTHER_HOST'};
    if (!stale) { report.progressStatus = report.status; report.status = 'RUNNING'; }
  }
  return report;
}

/** Continue only untouched original inbox jobs, preserving their one-attempt custody. */
export async function runObjectSession(directory, {signal,workspace,onChunk = () => {},
  environment = process.env} = {}) {
  need(signal === undefined || signal instanceof AbortSignal, 'INVALID_ABORT_SIGNAL');
  need(typeof onChunk === 'function', 'OBJECT_PROGRESS_CALLBACK_INVALID');
  const release = await acquireLock(directory);
  try {
    const current = await inspectInternal(directory);
    const {definition,queue,report,hash} = current;
    const selectedWorkspace = workspace === undefined ? definition.workspace : workspace;
    need(definition.workspace === null || selectedWorkspace === definition.workspace, 'OBJECT_SAVED_WORKSPACE_MISMATCH');
    if (selectedWorkspace !== null) absolute(selectedWorkspace, 'OBJECT_ABSOLUTE_WORKSPACE_REQUIRED');
    let contentType = current.contentType;
    while (report.status === 'READY' && !signal?.aborted) {
      const index = report.completeChunks, plan = chunkPlan(definition, index);
      let job = await queue.show(plan.intentId), failure = null;
      bindJob(plan, job);
      // A direct original-queue operator may have taken this job since inspection.
      // Let its durable attempt prevail; never run an attempted job again.
      if (!job.attempt) {
        if (selectedWorkspace === null) await bareOperatorPreflight(plan.configuration, environment);
        try { job = await queue.run(plan.intentId, {signal, environment,
          ...(selectedWorkspace === null ? {} : {workspace:selectedWorkspace})}); }
        catch (error) {
          job = await queue.show(plan.intentId);
          if (!job.attempt) throw error; // Original preflight left this job untouched.
          failure = error;
        }
      }
      const view = chunkView(plan, job);
      report.chunks[index] = view;
      if (job.attempt?.kind === 'EXECUTE') {
        report.attemptedChunks++;
        report.capAllocatedAtomic = (BigInt(report.capAllocatedAtomic) + BigInt(definition.limits.maxAtomic)).toString();
      }
      try {
        if (failure) throw failure;
        Object.assign(view, await nativeChunk(definition, plan, job, {hash,contentType}));
        contentType = view.contentType;
        report.completeChunks++;
        report.downloadedBytes += plan.length;
      } catch (error) {
        stopped(report, view, error);
        if (job.lastError) view.originalExecutionError = job.lastError.code;
        if (job.recovery) view.originalRecovery = job.recovery;
      }
      finishReport(definition, report, hash);
      // Previous chunks have already been hashed during this run. Keeping the
      // in-memory prefix avoids re-reading N completed files after every chunk.
      await onChunk(structuredClone({schema:REPORT,directory:report.directory,sessionId:report.sessionId,
        deliveryMode:report.deliveryMode,
        status:report.status,completeChunks:report.completeChunks,completedChunks:report.completedChunks,
        attemptedChunks:report.attemptedChunks,chunkCount:report.chunkCount,bytes:report.bytes,
        downloadedBytes:report.downloadedBytes,capAllocatedAtomic:report.capAllocatedAtomic,
        limits:report.limits,chunk:view,nextChunk:report.nextChunk,
        ...(report.stoppedChunk ? {stoppedChunk:report.stoppedChunk} : {})}));
    }
    report.interrupted = signal?.aborted === true;
    if (report.interrupted && report.status === 'READY') report.status = 'INTERRUPTED';
    return report;
  } finally { await release(); }
}

/** Recover saved native outcomes and a proven-dead local lock, never a paid retry. */
export async function recoverObjectSession(directory) {
  const release = await acquireLock(directory, {recover:true,kind:'RECOVER'});
  try {
    let current = await inspectInternal(directory);
    const stoppedIntent = current.report.stoppedChunk?.intentId;
    if (stoppedIntent) {
      const job = await current.queue.show(stoppedIntent);
      if (job.attempt?.kind === 'EXECUTE' && !job.outcome && !job.recovery) {
        try {
          await current.queue.recover(stoppedIntent);
          current = await inspectInternal(directory);
        } catch (error) {
          current.report.stoppedChunk.recoveryCode = codeOf(error);
        }
      }
    }
    return {...current.report,recovered:true};
  } finally { await release(); }
}

/** Read or finish original object reservations without reading product bytes.
 * Each call returns a bounded range. Existing inbox finalization files retain
 * complete native results; the caller continues from nextOffset when present. */
export async function accountObjectSession(directory, {workspace,offset=0,limit=100,
  finalize=false,signal,outbox,merchantRoute}={}) {
  need(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=250,
    'OBJECT_ACCOUNTING_RANGE_INVALID');
  need(typeof finalize==='boolean'&&(signal===undefined||signal instanceof AbortSignal),
    'OBJECT_ACCOUNTING_OPTIONS_INVALID');
  await privateDirectory(directory);
  const release=finalize?await acquireLock(directory,{kind:'FINALIZE'}):null;
  try {
    const definition=validateDefinition(await readJson(join(directory,'session.json')),directory);
    const selectedWorkspace=workspace===undefined?definition.workspace:workspace;
    need(definition.workspace===null||selectedWorkspace===definition.workspace,'OBJECT_SAVED_WORKSPACE_MISMATCH');
    if(finalize)absolute(selectedWorkspace,'OBJECT_ACCOUNTING_WORKSPACE_REQUIRED');
    need(offset<=definition.chunkCount,'OBJECT_ACCOUNTING_RANGE_INVALID');
    const queue=await openQueue(join(directory,'inbox'));
    const {finalizeQueueIntent,summarizeFinalization,readUnpaidAttempt}=await import('./finalization.mjs');
    const entries=[];
    const end=Math.min(definition.chunkCount,offset+limit);
    for(let index=offset;index<end&&!signal?.aborted;index++) {
      const plan=chunkPlan(definition,index);
      let job;
      try {
        job=await queue.show(plan.intentId);
        need((await readPrivate(plan.configPath,65536)).equals(encoded(plan.configuration)),
          'OBJECT_CHUNK_CONFIG_CHANGED');
        bindJob(plan,job);
        if(job.attempt?.kind!=='EXECUTE') {
          entries.push({index,intentId:plan.intentId,outcome:'NOT_ATTEMPTED'});
          continue;
        }
        if(!job.finalization) {
          const unpaid=await readUnpaidAttempt({evidencePath:job.evidencePath,
            intentId:plan.intentId,attemptStartedAt:job.attempt.startedAt});
          if(unpaid) {entries.push({index,intentId:plan.intentId,...unpaid,
            evidencePath:job.evidencePath,viewStatus:'ORIGINAL_RESPONSE'});continue;}
        }
        if(finalize)job=await finalizeQueueIntent({root:queue.root,intentId:plan.intentId,
          workspace:selectedWorkspace,signal,outbox,merchantRoute});
        entries.push({index,intentId:plan.intentId,...summarizeFinalization(job.finalization),
          viewPath:join(queue.root,'jobs',job.id,'finalization.json'),
          viewStatus:job.finalizationView?.status??'READ'});
      } catch(error) {
        entries.push({index,intentId:plan.intentId,outcome:'NOT_FINALIZED',code:codeOf(error),
          lastFinalized:summarizeFinalization(job?.finalization).lastFinalized});
      }
    }
    const next=offset+entries.length;
    return {schema:'stellar-forge.sf88.session-accounting.v1',kind:'object',directory,
      sessionId:definition.sessionId,configurationSha256:definition.configurationSha256,
      deliveryMode:definition.deliveryMode,
      workspace:selectedWorkspace,mode:finalize?'FINALIZE':'VIEW',observedAt:now(),
      terms:execution(definition.config).op.expect,
      range:{offset,limit,total:definition.chunkCount,nextOffset:next<definition.chunkCount?next:null},
      entries,interrupted:signal?.aborted===true,
      recordAuthority:'ORIGINAL_SF36_LEDGER; PER-REQUEST VIEWS ARE SAVED IN THE ORIGINAL INBOX'};
  } finally {if(release)await release();}
}

/** Stream contiguous verified native chunks into a private create-only object. */
export async function assembleObjectSession(directory, destination) {
  absolute(destination, 'OBJECT_ABSOLUTE_DESTINATION_REQUIRED');
  need(!/[\\/]$/.test(destination) && !['.','..'].includes(basename(destination)), 'OBJECT_DESTINATION_INVALID');
  await privateDirectory(dirname(destination));
  await absent(destination, 'OBJECT_DESTINATION_EXISTS');
  const release = await acquireLock(directory, {kind:'ASSEMBLE'});
  let temporary = null, file = null;
  try {
    // Validate original job/header/outcome bindings first. Actual bytes are read
    // exactly once below while assembling, including a fresh per-chunk digest.
    const {definition,report} = await inspectInternal(directory, {verifyBytes:false});
    need(report.status === 'COMPLETE', 'OBJECT_COMPLETE_SESSION_REQUIRED');
    const receiptPath = join(directory, 'assemblies', sha(destination) + '.json');
    await absent(receiptPath, 'OBJECT_ASSEMBLY_DESTINATION_ALREADY_RECORDED');
    temporary = join(dirname(destination), '.object-assembly-' + randomUUID());
    file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW, 0o600);
    const hash = createHash('sha256');
    let bytes = 0, nextOffset = 0;
    for (const chunk of report.chunks) {
      need(chunk.state === 'VERIFIED' && chunk.offset === nextOffset, 'OBJECT_CHUNK_ORDER_INVALID');
      await streamChunk(chunk.responsePath, chunk.length, chunk.sha256, async part => {
        let offset = 0;
        while (offset < part.length) {
          const {bytesWritten} = await file.write(part, offset, part.length - offset, null);
          need(bytesWritten > 0, 'OBJECT_ASSEMBLY_WRITE_FAILED');
          hash.update(part.subarray(offset, offset + bytesWritten));
          bytes += bytesWritten;
          offset += bytesWritten;
        }
      });
      nextOffset += chunk.length;
    }
    need(bytes === definition.bytes && nextOffset === definition.bytes, 'OBJECT_ASSEMBLY_LENGTH_MISMATCH');
    const sha256 = hash.digest('hex');
    need(definition.expectedSha256 === null || sha256 === definition.expectedSha256, 'OBJECT_COMPLETE_SHA256_MISMATCH');
    await file.sync();
    await file.close();
    file = null;
    await link(temporary, destination);
    await syncDirectory(dirname(destination));
    report.objectSha256 = sha256;
    const receipt = {schema:ASSEMBLY,sessionId:definition.sessionId,
      configurationSha256:definition.configurationSha256,snapshot:definition.expectedSnapshot,
      chunkCount:definition.chunkCount,chunkManifestSha256:sha(encoded(report.chunks.map(chunk =>
        ({index:chunk.index,offset:chunk.offset,length:chunk.length,intentId:chunk.intentId,sha256:chunk.sha256})))),
      destination,bytes,sha256,createdAt:now()};
    try { await createJson(receiptPath, receipt); }
    catch (error) {
      // The complete output already exists. Retain that concrete result even if
      // recording its handoff fails; never report or repeat a paid acquisition.
      return {...report,assembly:{...receipt,status:'SAVED',fileRevalidated:true,
        receiptStatus:'NOT_RECORDED',receiptError:codeOf(error)}};
    }
    report.assemblies.push({...receipt,status:'RECORDED',fileRevalidated:false});
    return {...report,assembly:{...receipt,status:'SAVED',fileRevalidated:true,receiptPath}};
  } finally {
    if (file) await file.close().catch(() => {});
    if (temporary) await unlink(temporary).catch(() => {});
    await release();
  }
}
