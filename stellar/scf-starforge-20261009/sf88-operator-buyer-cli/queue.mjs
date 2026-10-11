// MIT — Durable local operator inbox around the original SF88 execution path.
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, mkdir, lstat, realpath, readdir, rename, link, unlink, rmdir } from 'node:fs/promises';
import { isAbsolute, join, resolve, dirname } from 'node:path';
import { hostname } from 'node:os';
import { config, execution, need, InputError } from './config.mjs';
import { aggregateOutcomes } from '../sf52-buyer-outcomes/outcomes.mjs';
import { resolveBuyerProxy } from '../sf31-buyer-client/public-transport.mjs';
import { loadOperationTicket, operationTicketView, requireCurrentOperationTicket } from './operation-ticket.mjs';

const SCHEMA = 'stellar-forge.sf88.buyer-inbox.v1';
const HASH = /^[a-f0-9]{64}$/;
const INTENT = /^[A-Za-z0-9._:-]{1,128}$/;
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const sha = x => createHash('sha256').update(x).digest('hex');
const encoded = x => Buffer.from(JSON.stringify(x, null, 2) + '\n');
const now = () => new Date().toISOString();
const errorCode = e => /^[A-Z0-9_]{1,120}$/.test(e?.code ?? '') ? e.code : 'INBOX_OPERATION_FAILED';
const fail = code => { throw new InputError(code); };
// A long-lived embedding must not reuse an older cached signer module after an
// operator has changed the entry file. The CLI starts a fresh process per run.
const loadedSigners = new Map();
function rootPath(path) {
  need(typeof path === 'string' && isAbsolute(path) && !path.includes('\0'), 'INBOX_ABSOLUTE_PATH_REQUIRED');
  return resolve(path);
}
function jobKey(intentId) {
  need(typeof intentId === 'string' && INTENT.test(intentId), 'STABLE_INTENT_ID_REQUIRED');
  return sha(intentId);
}
function ownPrivate(info) {
  return process.platform === 'win32' || ((info.mode & 0o077) === 0 &&
    (typeof process.getuid !== 'function' || info.uid === process.getuid()));
}
async function privateDirectory(path) {
  const info = await lstat(path);
  need(info.isDirectory() && !info.isSymbolicLink() && ownPrivate(info), 'INBOX_PRIVATE_DIRECTORY_REQUIRED');
  need(await realpath(path) === resolve(path), 'INBOX_SYMLINK_DIRECTORY_REFUSED');
}
async function syncDirectory(path) {
  if (process.platform === 'win32') return;
  const handle = await open(path, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function readFile(path, limit, {privateOnly = true} = {}) {
  let handle;
  try { handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
  catch (e) { if (e.code === 'ELOOP') fail('INBOX_SYMLINK_FILE_REFUSED'); throw e; }
  try {
    const info = await handle.stat();
    need(info.isFile() && info.size <= limit && (!privateOnly || ownPrivate(info)), 'INBOX_FILE_INVALID');
    const data = await handle.readFile();
    need(data.length <= limit, 'INBOX_FILE_TOO_LARGE');
    return data;
  } finally { await handle.close(); }
}
async function jsonFile(path, limit = 2 * 1024 * 1024) {
  const data = await readFile(path, limit);
  try { return {value:JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(data)), data}; }
  catch { fail('INBOX_JSON_INVALID'); }
}
async function optionalJson(path) {
  try { return (await jsonFile(path)).value; }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
// Link publication is exclusive and exposes only a fully written, fsynced file.
async function createFile(path, data) {
  const temporary = join(dirname(path), '.write-' + randomUUID());
  const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try {
    try { await handle.writeFile(data); await handle.sync(); }
    finally { await handle.close(); }
    await link(temporary, path);
    await syncDirectory(dirname(path));
  }
  finally { await unlink(temporary).catch(() => {}); }
}
async function writeJson(path, value) { await createFile(path, encoded(value)); }
async function fingerprint(path, limit) {
  rootPath(path);
  const data = await readFile(path, limit, {privateOnly:false});
  return {path, sha256:sha(data), bytes:data.length};
}
async function dependencySame(dependency, limit) {
  const current = await fingerprint(dependency.path, limit);
  need(current.sha256 === dependency.sha256 && current.bytes === dependency.bytes, 'INBOX_DEPENDENCY_CHANGED_REVIEW_REQUIRED');
}
async function workspaceEnvironment(cfg, path) {
  const {openWorkspace} = await import('./workspace.mjs');
  const workspace = await openWorkspace(['--dir', rootPath(path)], {execute:true});
  const {op, owner, transport} = execution(cfg);
  const {op:workspaceOp, owner:workspaceOwner, transport:workspaceTransport} = execution(workspace.config);
  const signer = workspace.manifest.signer;
  // A selected workspace supplies operator keys, never replacement queue terms.
  need(['python','actor','service','policy','ledger'].every(key => owner[key] === workspaceOwner[key]) &&
    cfg.signerModule === workspace.config.signerModule &&
    cfg.evidenceDir === workspace.config.evidenceDir &&
    cfg.trustedPayer === workspace.config.trustedPayer && cfg.trustedPayer === signer.expectedPayer,
    'INBOX_WORKSPACE_OPERATOR_MISMATCH');
  need(JSON.stringify(transport) === JSON.stringify(workspaceTransport),
    'INBOX_WORKSPACE_TRANSPORT_MISMATCH');
  need(['scheme','network','asset','payTo'].every(key => op.expect[key] === workspaceOp.expect[key]) &&
    ['network','asset','payTo'].every(key => op.expect[key] === signer[key]),
    'INBOX_WORKSPACE_TERMS_MISMATCH');
  // Respect a lower current workspace cap as well as its generated signer cap.
  const maximum = BigInt(op.expect.maxAtomic);
  need(maximum > 0n && maximum <= BigInt(workspaceOp.expect.maxAtomic) &&
    maximum <= BigInt(signer.maxAtomic), 'INBOX_WORKSPACE_CAP_EXCEEDED');
  return workspace.operatorEnvironment;
}
async function ensureAbsent(path, code) {
  try { await lstat(path); fail(code); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
}
async function readRequest(root, intentId) {
  const id = jobKey(intentId), directory = join(root, 'jobs', id);
  await privateDirectory(directory);
  const request = (await jsonFile(join(directory, 'request.json'))).value;
  need(request?.schema === SCHEMA && request.id === id && request.operation?.intentId === intentId &&
    HASH.test(request.configSha256) && HASH.test(request.sourceConfigSha256), 'INBOX_REQUEST_INVALID');
  const raw = await readFile(join(directory, 'execution.json'), 65536);
  need(sha(raw) === request.configSha256, 'INBOX_CONFIG_CHANGED');
  const sourceRaw = await readFile(join(directory, 'source-config.json'), 65536);
  need(sha(sourceRaw) === request.sourceConfigSha256, 'INBOX_SOURCE_CONFIG_CHANGED');
  const cfg = await config(join(directory, 'execution.json'));
  const {op} = execution(cfg);
  need(op.intentId === intentId && JSON.stringify(op) === JSON.stringify(request.operation), 'INBOX_OPERATION_CHANGED');
  if (request.bodySha256 !== null) {
    need(op.bodyFile === join(directory, 'request-body.bin'), 'INBOX_BODY_PATH_CHANGED');
    const body = await readFile(op.bodyFile, 1048576);
    need(body.length === request.bodyBytes && sha(body) === request.bodySha256, 'INBOX_BODY_CHANGED');
  } else need(op.bodyFile === undefined, 'INBOX_BODY_CHANGED');
  let ticket = null;
  if (request.operationTicket != null) {
    need(op.ticketFile === join(directory, 'operation-ticket.json'), 'INBOX_TICKET_PATH_CHANGED');
    ticket = await loadOperationTicket(op);
    need(ticket && JSON.stringify({...ticket}) === JSON.stringify(request.operationTicket), 'INBOX_TICKET_CHANGED');
  } else need(op.ticketFile === undefined, 'INBOX_TICKET_CHANGED');
  return {id, directory, request, cfg, ticket};
}
function outcomeView(terminal) {
  if (!terminal) return null;
  return terminal.summary ?? null;
}
async function inspect(root, intentId) {
  const {id, directory, request, ticket} = await readRequest(root, intentId);
  const [attempt, terminal, recovery, finalization] = await Promise.all([
    optionalJson(join(directory, 'attempt.json')),
    optionalJson(join(directory, 'terminal.json')),
    optionalJson(join(directory, 'recovery.json')),
    optionalJson(join(directory, 'finalization.json')),
  ]);
  if (attempt) need(attempt.schema === SCHEMA && attempt.intentId === intentId &&
    attempt.configSha256 === request.configSha256, 'INBOX_ATTEMPT_INVALID');
  if (terminal) need(attempt && terminal.schema === SCHEMA && terminal.attemptId === attempt.id &&
    terminal.intentId === intentId, 'INBOX_TERMINAL_INVALID');
  if (recovery) need(attempt && recovery.schema === SCHEMA && recovery.attemptId === attempt.id &&
    recovery.intentId === intentId, 'INBOX_RECOVERY_INVALID');
  if (finalization) need(attempt && finalization.schema === 'stellar-forge.sf88.inbox-finalization.v1' &&
    finalization.attemptId === attempt.id && finalization.intentId === intentId &&
    finalization.configSha256 === request.configSha256, 'INBOX_FINALIZATION_VIEW_INVALID');
  const state = attempt?.kind === 'CANCELLED' ? 'CANCELLED' : recovery ? 'RECOVERED' :
    terminal ? 'ATTEMPT_RECORDED' : attempt ? 'RUNNING_OR_INTERRUPTED' : 'QUEUED';
  return {
    schema:SCHEMA, id, createdAt:request.createdAt, state,
    configSha256:request.configSha256, sourceConfigSha256:request.sourceConfigSha256,
    bodySha256:request.bodySha256, bodyBytes:request.bodyBytes,
    operationTicket:operationTicketView(ticket),
    operation:request.operation, operator:request.operator,
    dependencies:request.dependencies, evidencePath:request.evidencePath,
    responseDestination:request.responseDestination,
    attempt, outcome:outcomeView(terminal), lastError:terminal?.error ?? null,
    recovery, finalization, retry:'NO_AUTOMATIC_RETRY',
  };
}

export async function initializeQueue(path) {
  const root = rootPath(path);
  await mkdir(root, {mode:0o700});
  await privateDirectory(root);
  await mkdir(join(root, 'jobs'), {mode:0o700});
  await writeJson(join(root, 'inbox.json'), {schema:SCHEMA, createdAt:now()});
  await syncDirectory(root);
  return {schema:SCHEMA, root};
}

export async function openQueue(path) {
  const root = rootPath(path);
  await privateDirectory(root);
  await privateDirectory(join(root, 'jobs'));
  need((await jsonFile(join(root, 'inbox.json'))).value?.schema === SCHEMA, 'INBOX_SCHEMA_INVALID');

  async function enqueue(configPath) {
    const raw = await readFile(rootPath(configPath), 65536);
    const sourceConfigSha256 = sha(raw);
    const stage = join(root, 'jobs', '.intake-' + randomUUID());
    await mkdir(stage, {mode:0o700});
    let published = false;
    try {
      await createFile(join(stage, 'source-config.json'), raw);
      const cfg = await config(join(stage, 'source-config.json'));
      const {op, owner, download} = execution(cfg);
      const id = jobKey(op.intentId), destination = join(root, 'jobs', id);
      await privateDirectory(cfg.evidenceDir);
      const evidencePath = join(cfg.evidenceDir, id + '.json');
      const body = op.bodyFile === undefined ? null : await readFile(op.bodyFile, 1048576);
      const bodySha256 = body === null ? null : sha(body);
      const ticket = await loadOperationTicket(op, {requireCurrent:true});
      const dependencies = {
        signer:await fingerprint(cfg.signerModule, 1048576),
        policy:await fingerprint(owner.policy, 1048576),
      };
      // The ledger is live original SF36 state; never snapshot or replace it.
      const pinned = {...cfg, operation:{...op,
        ...(body === null ? {} : {bodyFile:join(destination, 'request-body.bin')}),
        ...(ticket ? {ticketFile:join(destination, 'operation-ticket.json')} : {})}};
      const executionRaw = encoded(pinned);
      need(executionRaw.length <= 65536, 'INBOX_CONFIG_TOO_LARGE');
      const request = {
        schema:SCHEMA, id, createdAt:now(), sourceConfigSha256,
        configSha256:sha(executionRaw), bodySha256, bodyBytes:body?.length ?? 0,
        operationTicket:ticket ? {...ticket} : null,
        operation:pinned.operation, operator:{actor:owner.actor, service:owner.service, ledger:owner.ledger},
        dependencies, evidencePath, responseDestination:download?.destination ?? null,
      };
      await createFile(join(stage, 'execution.json'), executionRaw);
      if (body !== null) await createFile(join(stage, 'request-body.bin'), body);
      if (ticket) await createFile(join(stage, 'operation-ticket.json'), ticket.sourceBytes);
      await writeJson(join(stage, 'request.json'), request);
      await syncDirectory(stage);
      try { await rename(stage, destination); published = true; }
      catch (e) {
        if (!['EEXIST','ENOTEMPTY'].includes(e.code)) throw e;
        const existing = await inspect(root, op.intentId);
        need(existing.configSha256 === request.configSha256 &&
          existing.sourceConfigSha256 === sourceConfigSha256 && existing.bodySha256 === bodySha256 &&
          (existing.operationTicket?.sha256 ?? null) === (ticket?.sha256 ?? null) &&
          JSON.stringify(existing.dependencies) === JSON.stringify(dependencies), 'INBOX_INTENT_CONFLICT');
        return {...existing, disposition:'EXISTING_IDENTICAL_INTENT'};
      }
      await syncDirectory(join(root, 'jobs'));
      return {...await inspect(root, op.intentId), disposition:'ENQUEUED'};
    } finally {
      if (!published) {
        // Only unpublished known intake files are removable; no attempt/outcome.
        for (const name of ['source-config.json','execution.json','request-body.bin','operation-ticket.json','request.json'])
          await unlink(join(stage, name)).catch(() => {});
        await rmdir(stage).catch(() => {});
      }
    }
  }

  async function list() {
    const entries = await readdir(join(root, 'jobs'), {withFileTypes:true});
    const records = [];
    for (const entry of entries) {
      if (!HASH.test(entry.name)) continue;
      need(entry.isDirectory() && !entry.isSymbolicLink(), 'INBOX_JOB_DIRECTORY_INVALID');
      let intentId;
      try {
        const r = (await jsonFile(join(root, 'jobs', entry.name, 'request.json'))).value;
        intentId = r.operation?.intentId;
        need(entry.name === jobKey(intentId), 'INBOX_REQUEST_INVALID');
        records.push(await inspect(root, intentId));
      }
      catch (e) {
        records.push({schema:SCHEMA, id:entry.name, state:'REVIEW_REQUIRED',
          operation:{intentId:typeof intentId === 'string' && INTENT.test(intentId) ? intentId : entry.name}, lastError:{code:errorCode(e)},
          retry:'NO_AUTOMATIC_RETRY'});
      }
    }
    return records.sort((a,b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.id.localeCompare(b.id));
  }

  async function run(intentId, {signal, workspace} = {}) {
    need(signal === undefined || signal instanceof AbortSignal, 'INVALID_ABORT_SIGNAL');
    need(!signal?.aborted, 'OPERATOR_ABORTED');
    const {directory, request, cfg, ticket} = await readRequest(root, intentId);
    await ensureAbsent(join(directory, 'attempt.json'), 'INBOX_ATTEMPT_ALREADY_EXISTS');
    await dependencySame(request.dependencies.signer, 1048576);
    await dependencySame(request.dependencies.policy, 1048576);
    need(!loadedSigners.has(cfg.signerModule) || loadedSigners.get(cfg.signerModule) === request.dependencies.signer.sha256,
      'INBOX_SIGNER_CHANGED_START_FRESH_PROCESS');
    // Resolve/bind the actual operator workspace before claiming this attempt.
    // A wrong workspace or unavailable key file must leave the job QUEUED.
    const environment = workspace === undefined ? undefined : await workspaceEnvironment(cfg, workspace);
    // A named managed proxy may change between processes; resolve it now,
    // before the permanent attempt, without changing the saved origin/profile.
    if (cfg.buyerTransport !== undefined) resolveBuyerProxy(cfg.buyerTransport);
    await privateDirectory(cfg.evidenceDir);
    await ensureAbsent(request.evidencePath, 'INBOX_ORIGINAL_EVIDENCE_ALREADY_EXISTS');
    if (request.responseDestination) await ensureAbsent(request.responseDestination, 'INBOX_RESPONSE_DESTINATION_EXISTS');
    need(!signal?.aborted, 'OPERATOR_ABORTED');
    requireCurrentOperationTicket(ticket);
    // Permanent single-attempt claim. It is never expired, stolen or retried.
    const attempt = {schema:SCHEMA, kind:'EXECUTE', id:randomUUID(), intentId,
      configSha256:request.configSha256, startedAt:now(), pid:process.pid, host:hostname()};
    try { await writeJson(join(directory, 'attempt.json'), attempt); }
    catch (e) { if (e.code === 'EEXIST') fail('INBOX_ATTEMPT_ALREADY_EXISTS'); throw e; }
    let summary = null, error = null;
    try {
      const {execute} = await import('./execute.mjs');
      loadedSigners.set(cfg.signerModule, request.dependencies.signer.sha256);
      summary = await execute(cfg, {signal, emitSummary:false,
        operationTicketSha256:ticket?.sha256 ?? null,
        ...(environment === undefined ? {} : {environment})});
      need(object(summary) && summary.intentId === intentId &&
        summary.mode === 'ORIGINAL_OPERATOR_APPROVED_BUYER_ATTEMPT', 'INBOX_ORIGINAL_SUMMARY_INVALID');
    } catch (e) {
      error = {code:errorCode(e), paymentSent:typeof e?.paymentSent === 'boolean' ? e.paymentSent : null,
        interrupted:signal?.aborted === true};
    }
    const terminal = {schema:SCHEMA, attemptId:attempt.id, intentId, completedAt:now(), summary, error,
      retry:'NO_AUTOMATIC_RETRY'};
    await writeJson(join(directory, 'terminal.json'), terminal);
    return inspect(root, intentId);
  }

  async function cancel(intentId) {
    const {directory, request} = await readRequest(root, intentId);
    const attempt = {schema:SCHEMA, kind:'CANCELLED', id:randomUUID(), intentId,
      configSha256:request.configSha256, startedAt:now(), pid:process.pid, host:hostname()};
    try { await writeJson(join(directory, 'attempt.json'), attempt); }
    catch (e) { if (e.code === 'EEXIST') fail('INBOX_ATTEMPT_ALREADY_EXISTS'); throw e; }
    return inspect(root, intentId);
  }

  async function recover(intentId) {
    const {directory, request, cfg} = await readRequest(root, intentId);
    const before = await inspect(root, intentId);
    need(before.attempt?.kind === 'EXECUTE', 'INBOX_EXECUTION_ATTEMPT_REQUIRED');
    if (before.recovery) return before;
    const {value:evidence, data:raw} = await jsonFile(request.evidencePath);
    need(evidence?.schema === 'scf82.checkout-evidence.v1' && evidence.intentId === intentId &&
      evidence.observation?.intentId === intentId && evidence.observedAt === evidence.observation.observedAt,
      'INBOX_ORIGINAL_EVIDENCE_MISMATCH');
    need(Number.isFinite(Date.parse(evidence.observedAt)) &&
      Date.parse(evidence.observedAt) >= Date.parse(before.attempt.startedAt), 'INBOX_EVIDENCE_PREDATES_ATTEMPT');
    // Recompute using ORIGINAL SF52; never trust a saved report's totals.
    const originalOutcomeReport = aggregateOutcomes([evidence.observation]);
    const terms = evidence.observation.buyer?.requirement;
    if (terms) {
      const expected = cfg.operation.expect;
      need(['scheme','network','asset','payTo'].every(k => terms[k] === expected[k]) &&
        BigInt(terms.amount) <= BigInt(expected.maxAtomic), 'INBOX_EVIDENCE_TERMS_MISMATCH');
    }
    const reservation = evidence.operatorReservation;
    if (reservation) need(reservation.requestId === intentId &&
      (reservation.network === undefined || reservation.network === cfg.operation.expect.network),
      'INBOX_EVIDENCE_RESERVATION_MISMATCH');
    // SF82 does not bind URL/method or a response-file hash. Preserve that limit.
    const recovery = {schema:SCHEMA, attemptId:before.attempt.id, intentId, recoveredAt:now(),
      evidencePath:request.evidencePath, evidenceSchema:evidence.schema, evidenceSha256:sha(raw), observedAt:evidence.observedAt,
      observationStatus:evidence.observation.buyer.status,
      originalOutcomeReport, bodyCapture:evidence.bodyCapture ?? null,
      operatorReservation:reservation ?? null,
      reconciliationStatus:evidence.reconciliation?.status ?? null,
      deliveryFile:request.responseDestination ? {
        destination:request.responseDestination, status:'REQUIRES_ORIGINAL_DOWNLOAD_SUMMARY',
      } : {status:'NOT_REQUESTED'},
      binding:'ORIGINAL_SF82_INTENT_AND_TERMS; URL_METHOD_NOT_RECORDED_BY_SF82',
      retry:'NO_AUTOMATIC_RETRY'};
    try { await writeJson(join(directory, 'recovery.json'), recovery); }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
    return inspect(root, intentId);
  }

  return Object.freeze({root, enqueue, list, show:intentId => inspect(root, intentId), run, cancel, recover});
}

export async function saveQueueReport(destination, html) {
  const path = rootPath(destination);
  await privateDirectory(dirname(path));
  need(typeof html === 'string' && Buffer.byteLength(html) <= 32 * 1024 * 1024, 'INBOX_REPORT_TOO_LARGE');
  await createFile(path, Buffer.from(html));
  return {path, sha256:sha(Buffer.from(html)), bytes:Buffer.byteLength(html)};
}
