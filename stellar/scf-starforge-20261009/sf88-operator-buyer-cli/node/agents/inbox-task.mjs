// MIT — External tasks compose the original Inbox and its complete saved responses.
import { join, relative, isAbsolute, sep } from 'node:path';
import { readdir, realpath } from 'node:fs/promises';
import { Inbox } from '../inbox.mjs';
import { VerifiedFile } from '../result.mjs';
import { BuyerError, need, object, intent, absolute, digest, jsonBytes, now,
  privateDirectory, readJson, readBytes, writeJson, writeBytes, exists } from '../store.mjs';

const TASK = 'stellar-forge.inbox-task.v1';
const RECORD = 'stellar-forge.inbox-task-record.v1';
const PLAN = 'stellar-forge.inbox-task-receiving.v1';
const PACKET = 'stellar-forge.inbox-task-packet.v1';
const HEX = /^[a-f0-9]{64}$/;
const FILE = /^responses\/[0-9]{3}-[a-f0-9]{16}\.bin$/;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (object(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const sha = value => digest(jsonBytes(canonical(value)));
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function text(value, field, max = 512, nullable = false) {
  if (nullable && (value === null || value === undefined)) return null;
  need(typeof value === 'string' && value.length > 0 && value.length <= max &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value), 'TASK_' + field + '_INVALID');
  return value;
}
function shape(value, fields, code) {
  need(object(value) && Object.keys(value).every(key => fields.includes(key)), code);
}
function taskInput(value) {
  shape(value, ['system', 'id', 'revision', 'title', 'purpose', 'service'], 'TASK_FIELDS_INVALID');
  return { system: text(value.system, 'SYSTEM', 256), id: text(value.id, 'ID', 256),
    revision: text(value.revision, 'REVISION', 128), title: text(value.title, 'TITLE', 512),
    purpose: text(value.purpose, 'PURPOSE', 4096), service: text(value.service, 'SERVICE', 512) };
}

function rpcSelection(value) {
  shape(value, ['commerceDirectory','readId','responseSha256'], 'TASK_RPC_RESULT_SELECTION_INVALID');
  need(typeof value.readId === 'string' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.readId) &&
    HEX.test(value.responseSha256), 'TASK_RPC_RESULT_SELECTION_INVALID');
  return { commerceDirectory:absolute(value.commerceDirectory), readId:value.readId,
    responseSha256:value.responseSha256 };
}
function recoveryDocument(value) {
  need(object(value) && typeof value.text === 'string' &&
    Number.isSafeInteger(value.bytes) && value.bytes > 0 && value.bytes <= 131072 &&
    HEX.test(value.sha256), 'TASK_RPC_RESULT_DOCUMENT_INVALID');
  const bytes = Buffer.from(value.text);
  need(bytes.length === value.bytes && digest(bytes) === value.sha256, 'TASK_RPC_RESULT_DOCUMENT_CHANGED');
  try { return JSON.parse(value.text); } catch { throw new BuyerError('TASK_RPC_RESULT_DOCUMENT_INVALID'); }
}
function recoveryIdentity(entry, job) {
  const selected = rpcSelection(entry.selection.rpcResult), recovered = job.rpcRecovery;
  need(recovered?.schema === 'stellar-forge.commerce-rpc-saved-results.v1' &&
    recovered.state === 'SETTLED_RESULT_RECOVERED' && recovered.providerReads === 0 &&
    recovered.commerceDirectory === selected.commerceDirectory &&
    recovered.readId === selected.readId && HEX.test(recovered.sessionSha256) &&
    HEX.test(recovered.sellerConfigSha256) && HEX.test(recovered.planSha256) &&
    recovered.readDocument?.sha256 === recovered.readSha256 &&
    recovered.completedDocument?.sha256 === recovered.completedSha256,
    'TASK_RPC_RESULT_BINDING_CHANGED');
  const read = recoveryDocument(recovered.readDocument);
  const complete = recoveryDocument(recovered.completedDocument);
  const { publishedAt, publication, ...captured } = complete;
  need(read.schema === 'stellar-forge.commerce-rpc-response-recovery.v1' &&
    read.source === 'NEW_ORIGINAL_PROVIDER_READ_FOR_EXISTING_SETTLED_OPERATION' &&
    sha(captured) === sha(read) && ['ORIGINAL_PRIVATE_RESPONSE_WRITER','ORIGINAL_LOCAL_BYTES_RECOVERED'].includes(publication) &&
    Number.isFinite(Date.parse(publishedAt)) && Number.isFinite(Date.parse(read.recoveryReadStartedAt)) &&
    Number.isFinite(Date.parse(read.responseObservedAt)) &&
    Date.parse(publishedAt) >= Date.parse(read.responseObservedAt) &&
    Date.parse(read.responseObservedAt) >= Date.parse(read.recoveryReadStartedAt),
    'TASK_RPC_RESULT_CAPTURE_CHANGED');
  const request = read.request, response = read.response, file = recovered.responseFile;
  need(object(request) && object(response) && file?.status === 'SAVED' &&
    request.intentId === job.operation.intentId && request.attemptId === job.attempt?.id &&
    request.originalAttemptStartedAt === job.attempt.startedAt &&
    Date.parse(read.recoveryReadStartedAt) >= Date.parse(job.attempt.startedAt) &&
    request.configSha256 === job.configSha256 && request.bodySha256 === job.bodySha256 &&
    request.bodyBytes === job.bodyBytes && request.method === job.operation.method &&
    request.url === job.operation.url && request.routeId === job.merchant?.routeId &&
    request.planSha256 === recovered.planSha256 && sha(request.settlement) === sha(recovered.settlement) &&
    response.path === job.responseDestination && Number.isSafeInteger(response.bytes) && response.bytes > 0 &&
    response.sha256 === selected.responseSha256 && response.contentType === 'application/json' &&
    ['path','bytes','sha256','contentType'].every(key => response[key] === file[key]) &&
    file.source === 'SETTLED_RPC_RECOVERY_READ' && file.readId === selected.readId &&
    file.readSha256 === recovered.readSha256 && file.completedSha256 === recovered.completedSha256 &&
    file.originalAttemptStartedAt === request.originalAttemptStartedAt &&
    file.recoveryReadStartedAt === read.recoveryReadStartedAt &&
    file.responseObservedAt === read.responseObservedAt && file.publishedAt === publishedAt &&
    file.transaction === request.settlement.transaction && file.httpStatus === 200 &&
    file.httpStatusSource === 'ORIGINAL_RPC_RECOVERY_HTTP_200_CONTRACT',
    'TASK_RPC_RESULT_BINDING_CHANGED');
  return { source:'SETTLED_RPC_RECOVERY_READ', commerceDirectory:recovered.commerceDirectory,
    inboxDirectory:absolute(recovered.inboxDirectory), sessionSha256:recovered.sessionSha256,
    sellerConfigSha256:recovered.sellerConfigSha256, planSha256:recovered.planSha256,
    readId:recovered.readId, readSha256:recovered.readSha256,
    completedSha256:recovered.completedSha256, responseSha256:response.sha256 };
}
function selectedDelivery(entry, job) {
  boundJob(entry, job);
  if (entry.selection.rpcResult) {
    need(sha(recoveryIdentity(entry, job)) === entry.binding.rpcResultSha256,
      'TASK_RPC_RESULT_EDITION_CHANGED');
    return job.rpcRecovery.responseFile;
  }
  return job.outcome?.responseFile ?? null;
}

function selectionInput(value) {
  shape(value, ['intentId', 'role', 'sourceEdition', 'facilitator', 'decisionRef', 'reservationRef', 'rpcResult'],
    'TASK_SELECTION_FIELDS_INVALID');
  let facilitator = text(value.facilitator, 'FACILITATOR', 2048, true);
  if (facilitator !== null) {
    let url;
    try { url = new URL(facilitator); } catch { throw new BuyerError('TASK_FACILITATOR_INVALID'); }
    need(url.protocol === 'https:' && !url.username && !url.password && !url.hash && !url.search,
      'TASK_FACILITATOR_INVALID');
    facilitator = url.href.replace(/\/$/, '');
  }
  return { intentId: intent(value.intentId), role: text(value.role, 'ROLE', 256),
    sourceEdition: text(value.sourceEdition, 'SOURCE_EDITION', 1024, true), facilitator,
    decisionRef: text(value.decisionRef, 'DECISION_REF', 1024, true),
    reservationRef: text(value.reservationRef, 'RESERVATION_REF', 1024, true),
    ...(value.rpcResult === undefined ? {} : {rpcResult:rpcSelection(value.rpcResult)}) };
}
function predecessorInput(value) {
  if (value === null || value === undefined) return null;
  shape(value, ['taskSha256', 'system', 'id', 'revision'], 'TASK_PREDECESSOR_INVALID');
  need(HEX.test(value.taskSha256), 'TASK_PREDECESSOR_INVALID');
  return { taskSha256: value.taskSha256, system: text(value.system, 'SYSTEM', 256),
    id: text(value.id, 'ID', 256), revision: text(value.revision, 'REVISION', 128) };
}
function jobBinding(job) {
  need(job?.schema === 'stellar-forge.sf88.buyer-inbox.v1' && typeof job.id === 'string' &&
    object(job.operation) && HEX.test(job.configSha256), 'TASK_ORIGINAL_JOB_INVALID');
  const bodySha256 = job.bodySha256 ?? null, ticketSha256 = job.operationTicket?.sha256 ?? null;
  need(bodySha256 === null || HEX.test(bodySha256), 'TASK_ORIGINAL_JOB_INVALID');
  need(ticketSha256 === null || HEX.test(ticketSha256), 'TASK_ORIGINAL_JOB_INVALID');
  return { jobId: job.id, intentId: intent(job.operation.intentId), configSha256: job.configSha256,
    bodySha256, ticketSha256, operationSha256: sha(job.operation) };
}
function boundJob(entry, job) {
  const { rpcResultSha256, ...requestBinding } = entry.binding;
  need(sha(jobBinding(job)) === sha(requestBinding), 'TASK_ORIGINAL_JOB_CHANGED');
  if (rpcResultSha256 !== undefined && job.rpcRecovery !== undefined)
    need(sha(recoveryIdentity(entry, job)) === rpcResultSha256, 'TASK_RPC_RESULT_EDITION_CHANGED');
  return job;
}
async function selectedJobs(inbox, ids, signal) {
  const result = await inbox.list({ signal });
  need(Array.isArray(result.native?.jobs), 'TASK_INBOX_LIST_INVALID');
  const selected = new Map();
  for (const job of result.native.jobs) {
    const id = job?.operation?.intentId;
    if (ids.includes(id)) {
      need(!selected.has(id), 'TASK_DUPLICATE_ORIGINAL_JOB');
      selected.set(id, job);
    }
  }
  for (const id of ids) need(selected.has(id), 'TASK_ORIGINAL_JOB_MISSING');
  return { jobs: selected, process: result.process };
}
function validateManifest(value) {
  shape(value, ['schema', 'task', 'inboxDirectory', 'predecessor', 'entries'], 'TASK_MANIFEST_INVALID');
  need(value.schema === TASK && absolute(value.inboxDirectory) === value.inboxDirectory &&
    Array.isArray(value.entries) && value.entries.length >= 1 && value.entries.length <= 500,
    'TASK_MANIFEST_INVALID');
  need(sha(taskInput(value.task)) === sha(value.task) &&
    sha(predecessorInput(value.predecessor)) === sha(value.predecessor), 'TASK_MANIFEST_INVALID');
  const ids = new Set();
  for (const entry of value.entries) {
    shape(entry, ['selection', 'binding', 'request'], 'TASK_ENTRY_INVALID');
    need(sha(selectionInput(entry.selection)) === sha(entry.selection) &&
      object(entry.request) && entry.request.intentId === entry.selection.intentId &&
      object(entry.binding) && typeof entry.binding.jobId === 'string' &&
      entry.binding.intentId === entry.selection.intentId && HEX.test(entry.binding.configSha256) &&
      (entry.binding.bodySha256 === null || HEX.test(entry.binding.bodySha256)) &&
      (entry.binding.ticketSha256 === null || HEX.test(entry.binding.ticketSha256)) &&
      entry.binding.operationSha256 === sha(entry.request), 'TASK_ENTRY_INVALID');
    need((entry.selection.rpcResult === undefined && entry.binding.rpcResultSha256 === undefined) ||
      (entry.selection.rpcResult !== undefined && HEX.test(entry.binding.rpcResultSha256)),
      'TASK_RPC_RESULT_BINDING_INVALID');
    need(!ids.has(entry.selection.intentId), 'TASK_DUPLICATE_INTENT');
    ids.add(entry.selection.intentId);
  }
  return value;
}
function validateRecord(value) {
  shape(value, ['schema', 'taskSha256', 'createdAt', 'manifest'], 'TASK_RECORD_INVALID');
  need(value.schema === RECORD && typeof value.createdAt === 'string', 'TASK_RECORD_INVALID');
  validateManifest(value.manifest);
  need(value.taskSha256 === sha(value.manifest), 'TASK_RECORD_CHANGED');
  return value;
}
class ReceivedFile extends VerifiedFile {
  constructor(metadata) { super(); this.metadata = freeze(structuredClone(metadata)); }
  _metadata() { return this.metadata; }
}
function containsDirectory(parent, candidate) {
  const path = relative(parent, candidate);
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith('..' + sep));
}
function fileName(index, intentId) {
  return 'responses/' + String(index).padStart(3, '0') + '-' + digest(Buffer.from(intentId)).slice(0, 16) + '.bin';
}
function localFile(directory, item) {
  need(FILE.test(item.path) && Number.isSafeInteger(item.bytes) && item.bytes >= 0 && HEX.test(item.sha256),
    'TASK_PACKET_FILE_INVALID');
  return new ReceivedFile({ path: join(directory, item.path), bytes: item.bytes, sha256: item.sha256 });
}
function validatePlan(value) {
  shape(value, ['schema', 'createdAt', 'task', 'jobs', 'files'], 'TASK_RECEIVING_PLAN_INVALID');
  need(value.schema === PLAN && typeof value.createdAt === 'string' &&
    Array.isArray(value.jobs) && Array.isArray(value.files), 'TASK_RECEIVING_PLAN_INVALID');
  validateRecord(value.task);
  const entries = value.task.manifest.entries;
  need(value.files.length === entries.length && value.jobs.length === entries.length, 'TASK_RECEIVING_PLAN_INVALID');
  value.files.forEach((file, index) => {
    const entry = entries[index];
    shape(file, ['intentId', 'path', 'bytes', 'sha256', 'contentType'], 'TASK_PACKET_FILE_INVALID');
    need(file.intentId === entry.selection.intentId && file.path === fileName(index, file.intentId) &&
      Number.isSafeInteger(file.bytes) && file.bytes >= 0 && HEX.test(file.sha256) &&
      (file.contentType === null || typeof file.contentType === 'string'), 'TASK_PACKET_FILE_INVALID');
    boundJob(entry, value.jobs[index]);
    const saved = selectedDelivery(entry, value.jobs[index]);
    need(saved?.status === 'SAVED' && saved.bytes === file.bytes && saved.sha256 === file.sha256 &&
      (saved.contentType ?? null) === file.contentType,
      'TASK_RECEIVING_SOURCE_CHANGED');
  });
  return value;
}
function nativeOutcome(job) {
  const native = job.outcome ?? null;
  return { intentId: job.operation.intentId, state: job.state ?? null,
    responseStatus: native?.responseFile?.status ?? null,
    httpStatus: native?.httpStatus ?? null, nativeStatus: native?.status ?? null,
    nativeError: native?.error ?? null, lastError: job.lastError ?? null,
    evidenceError: native?.evidenceError ?? null,
    responseCleanupError: native?.responseCleanupError ?? null,
    ...(job.rpcRecovery?.responseFile ? { recoveredResult:{
      readId:job.rpcRecovery.readId, source:job.rpcRecovery.responseFile.source,
      httpStatus:job.rpcRecovery.responseFile.httpStatus,
      httpStatusSource:job.rpcRecovery.responseFile.httpStatusSource,
      recoveryReadStartedAt:job.rpcRecovery.responseFile.recoveryReadStartedAt,
      responseObservedAt:job.rpcRecovery.responseFile.responseObservedAt,
      publishedAt:job.rpcRecovery.responseFile.publishedAt,
      transaction:job.rpcRecovery.responseFile.transaction,
      bytes:job.rpcRecovery.responseFile.bytes, sha256:job.rpcRecovery.responseFile.sha256,
    } } : {}) };
}
async function receiveIntent(task, directory) {
  const state = await privateDirectory(join(task.directory, 'receivings'));
  const path = join(state, digest(Buffer.from(directory)) + '.json');
  function checked(value) {
    need(value?.schema === 'stellar-forge.inbox-task-receiving-intent.v1' &&
      value.taskSha256 === task.taskSha256 && value.outputDirectory === directory,
      'TASK_RECEIVING_OTHER_TASK');
    return value;
  }
  if (await exists(path)) return checked(await readJson(path));
  // Claim the exact destination before the receiver creates any files there.
  if (await exists(directory)) {
    await privateDirectory(directory, { create: false });
    const plan = join(directory, 'receiving.json');
    if (await exists(plan))
      need(validatePlan(await readJson(plan, 128 * 1024 * 1024)).task.taskSha256 === task.taskSha256,
        'TASK_RECEIVING_OTHER_TASK');
    else need((await readdir(directory)).length === 0, 'TASK_RECEIVING_DIRECTORY_NOT_EMPTY');
  }
  const record = { schema: 'stellar-forge.inbox-task-receiving-intent.v1',
    taskSha256: task.taskSha256, outputDirectory: directory, createdAt: now() };
  try { await writeJson(path, record, { exclusive: true }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return checked(await readJson(path));
  }
  return record;
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
function report(plan, { legacy = false } = {}) {
  const task = plan.task.manifest.task;
  const cell = label => legacy ? '<td>' : '<td data-label="' + label + '">';
  const rows = plan.files.map((file, index) => {
    const entry = plan.task.manifest.entries[index], job = plan.jobs[index];
    const outcome = nativeOutcome(job);
    const errors = Object.fromEntries(Object.entries(outcome).filter(([key, value]) =>
      ['nativeError', 'lastError', 'evidenceError', 'responseCleanupError'].includes(key) && value !== null));
    return '<tr>' + cell('Result') + escapeHtml(entry.selection.role) + '</td>' + cell('Original intent') +
      escapeHtml(entry.selection.intentId) + '</td>' + cell('Full output') +
      '<a href="' + file.path + '"' + (legacy ? '' : ' download') + '>Complete result</a> (' + file.bytes + ' bytes)</td>' + cell('Source edition') +
      escapeHtml(entry.selection.sourceEdition ?? 'Recorded in original request') + '</td>' + cell('Facilitator selection') +
      escapeHtml(entry.selection.facilitator ?? 'Original merchant configuration') + '</td>' + cell('Native outcome') +
      escapeHtml(outcome.state) + '<br>HTTP ' + escapeHtml(outcome.httpStatus ?? 'not recorded') +
      '<br>Native status: ' + escapeHtml(outcome.nativeStatus ?? 'not recorded') +
      (Object.keys(errors).length ? '<pre>' + escapeHtml(JSON.stringify(errors, null, 2)) + '</pre>' : '') +
      (outcome.recoveredResult ? '<p><strong>Recovered RPC result</strong><br>HTTP ' +
        escapeHtml(outcome.recoveredResult.httpStatus) + ' accepted by original recovery<br>Read ' +
        escapeHtml(outcome.recoveredResult.readId) + '<br>Started ' +
        escapeHtml(outcome.recoveredResult.recoveryReadStartedAt) + '<br>Observed ' +
        escapeHtml(outcome.recoveredResult.responseObservedAt) + '<br>Settled transaction ' +
        escapeHtml(outcome.recoveredResult.transaction) + '</p>' : '') +
      '</td></tr>';
  }).join('');
  const details = plan.jobs.map((job, index) => '<details><summary>' +
    escapeHtml(plan.task.manifest.entries[index].selection.role) +
    ': original request and native outcome</summary><pre>' +
    escapeHtml(JSON.stringify({ selection: plan.task.manifest.entries[index].selection, job }, null, 2)) +
    '</pre></details>').join('');
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + escapeHtml(task.title) + '</title><style>body{font:15px system-ui,sans-serif;color:#171717;background:#fff;' +
    'max-width:1200px;margin:40px auto;padding:0 24px;line-height:1.5}h1{font-size:26px}h2{font-size:18px}' +
    'table{border-collapse:collapse;width:100%;margin:24px 0}th,td{border:1px solid #bbb;padding:10px;text-align:left;' +
    'vertical-align:top;overflow-wrap:anywhere}th{background:#eee}a{color:#111;text-decoration:underline}' +
    'pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f5f5;border:1px solid #ccc;padding:16px}' +
    (legacy ? 'details{border-top:1px solid #ccc;padding:12px 0}small{display:block;overflow-wrap:anywhere}</style>'
      : 'details{border-top:1px solid #ccc;padding:12px 0}summary{overflow-wrap:anywhere}small{display:block;overflow-wrap:anywhere}' +
    '@media(max-width:720px){body{margin:24px auto;padding:0 16px}h1{font-size:23px}' +
    'table,tbody,tr,td{display:block}thead{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}' +
    'tr{border:1px solid #bbb;margin:0 0 16px}td{border:0;border-bottom:1px solid #ddd;padding:9px 12px}' +
    'td:last-child{border-bottom:0}td::before{content:attr(data-label);display:block;font-size:12px;font-weight:650;color:#555}' +
    'pre{padding:12px;max-width:100%;box-sizing:border-box}}@media print{body{margin:0;max-width:none}details{break-inside:avoid}}</style>') +
    '<h1>' + escapeHtml(task.title) + '</h1><p>' + escapeHtml(task.purpose) + '</p>' +
    '<p><strong>All selected response files received</strong> · ' + plan.files.length + ' complete files</p>' +
    '<p>' + escapeHtml(task.system) + ' / ' + escapeHtml(task.id) + ' / ' + escapeHtml(task.revision) + '</p>' +
    '<table><thead><tr><th>Result</th><th>Original intent</th><th>Full output</th><th>Source edition</th>' +
    '<th>Facilitator selection</th><th>Native outcome</th></tr></thead><tbody>' + rows + '</tbody></table>' +
    '<h2>Original operating history</h2>' + details +
    '<h2>Receiving and continuation</h2><p>Open each complete file above in its intended application. ' +
    'The saved task and receiving plan retain the original caller references and buyer history. ' +
    'For continued buying, restore the original full buyer workspace at its original operating roots through its existing recovery workflow ' +
    'and reopen this task in that installation. A later useful request uses its own original intent.</p>' +
    '<small>Task ' + escapeHtml(plan.task.taskSha256) + '</small>' +
    '<small>Source snapshot ' + escapeHtml(plan.createdAt) + '</small></html>\n';
}
async function publishExact(path, bytes) {
  try { await writeBytes(path, bytes, { exclusive: true }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    need(digest(await readBytes(path, bytes.length)) === digest(bytes), 'TASK_PACKET_EXISTING_FILE_CHANGED');
  }
}
// Existing receivings retain either official v1 report byte sequence across a layout upgrade.
async function publishReport(path, plan) {
  let html = Buffer.from(report(plan));
  try { await publishExact(path, html); }
  catch (error) {
    if (error.code !== 'TASK_PACKET_EXISTING_FILE_CHANGED') throw error;
    html = Buffer.from(report(plan, { legacy: true }));
    await publishExact(path, html);
  }
  return html;
}

async function completedPacket(directory, expectedTaskSha256, signal) {
  if (!await exists(join(directory, 'manifest.json'))) return null;
  return openInboxTaskPacket({ directory, expectedTaskSha256, signal });
}

/** Review a caller's task against already-retained original Inbox jobs. */
export async function previewInboxTask({ inbox, task, selections, predecessor, signal } = {}) {
  need(inbox instanceof Inbox, 'ORIGINAL_NODE_INBOX_REQUIRED');
  task = taskInput(task);
  need(Array.isArray(selections) && selections.length >= 1 && selections.length <= 500, 'TASK_SELECTION_INVALID');
  selections = selections.map(selectionInput);
  const ids = selections.map(item => item.intentId);
  need(new Set(ids).size === ids.length, 'TASK_DUPLICATE_INTENT');
  const { jobs, process } = await selectedJobs(inbox, ids, signal);
  const entries = [];
  for (const selection of selections) {
    const job = jobs.get(selection.intentId);
    const entry = { selection, binding:jobBinding(job), request:structuredClone(job.operation) };
    if (selection.rpcResult) {
      const response = await inbox.rpcResponse(selection.intentId, {
        commerceDirectory:selection.rpcResult.commerceDirectory, readId:selection.rpcResult.readId,
        expectedResponseSha256:selection.rpcResult.responseSha256, signal });
      need(response, 'TASK_RPC_RESULT_NOT_SAVED');
      boundJob(entry, response.job);
      const original = recoveryIdentity(entry, response.job);
      need(original.inboxDirectory === inbox.directory, 'TASK_RPC_RESULT_INBOX_CHANGED');
      entry.binding.rpcResultSha256 = sha(original);
    }
    entries.push(entry);
  }
  const manifest = { schema:TASK, task, inboxDirectory:inbox.directory,
    predecessor:predecessorInput(predecessor), entries };
  validateManifest(manifest);
  need(jsonBytes(manifest).length <= 32 * 1024 * 1024, 'TASK_MANIFEST_LIMIT');
  return freeze({ previewSha256: sha(manifest), manifest, process });
}

export async function createInboxTask({ inbox, directory, task, selections, predecessor,
  expectedPreviewSha256, signal } = {}) {
  need(HEX.test(expectedPreviewSha256), 'TASK_REVIEW_REQUIRED');
  directory = absolute(directory);
  const file = join(directory, 'task.json');
  if (await exists(file)) {
    await privateDirectory(directory, { create: false });
    const saved = validateRecord(await readJson(file, 128 * 1024 * 1024));
    need(saved.taskSha256 === expectedPreviewSha256 && inbox instanceof Inbox &&
      saved.manifest.inboxDirectory === inbox.directory &&
      sha(taskInput(task)) === sha(saved.manifest.task) && Array.isArray(selections) &&
      sha(selections.map(selectionInput)) === sha(saved.manifest.entries.map(entry => entry.selection)) &&
      sha(predecessorInput(predecessor)) === sha(saved.manifest.predecessor), 'TASK_EXISTING_REVIEW_MISMATCH');
    return new InboxTask(inbox, directory, saved);
  }
  const preview = await previewInboxTask({ inbox, task, selections, predecessor, signal });
  need(preview.previewSha256 === expectedPreviewSha256, 'TASK_SOURCE_CHANGED_SINCE_REVIEW');
  await privateDirectory(directory);
  const record = { schema: RECORD, taskSha256: preview.previewSha256, createdAt: now(), manifest: preview.manifest };
  try { await writeJson(file, record, { exclusive: true }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const saved = validateRecord(await readJson(file, 128 * 1024 * 1024));
    need(saved.taskSha256 === record.taskSha256, 'TASK_EXISTING_REVIEW_MISMATCH');
    return new InboxTask(inbox, directory, saved);
  }
  return new InboxTask(inbox, directory, record);
}

export async function openInboxTask({ inbox, directory, expectedTaskSha256 } = {}) {
  need(inbox instanceof Inbox, 'ORIGINAL_NODE_INBOX_REQUIRED');
  directory = await privateDirectory(directory, { create: false });
  const record = validateRecord(await readJson(join(directory, 'task.json'), 128 * 1024 * 1024));
  need(record.manifest.inboxDirectory === inbox.directory, 'TASK_INBOX_BINDING_MISMATCH');
  if (expectedTaskSha256 !== undefined) need(record.taskSha256 === expectedTaskSha256, 'TASK_BINDING_MISMATCH');
  return new InboxTask(inbox, directory, record);
}

export class InboxTask {
  constructor(inbox, directory, record) {
    need(inbox instanceof Inbox, 'ORIGINAL_NODE_INBOX_REQUIRED');
    validateRecord(record);
    need(record.manifest.inboxDirectory === inbox.directory, 'TASK_INBOX_BINDING_MISMATCH');
    this.inbox = inbox; this.directory = absolute(directory);
    this.record = freeze(structuredClone(record));
  }
  get taskSha256() { return this.record.taskSha256; }
  get manifest() { return this.record.manifest; }
  _entry(intentId) {
    const entry = this.manifest.entries.find(item => item.selection.intentId === intentId);
    need(entry, 'TASK_INTENT_NOT_SELECTED');
    return entry;
  }
  async inspect({ signal } = {}) {
    const ids = this.manifest.entries.map(item => item.selection.intentId);
    const { jobs, process } = await selectedJobs(this.inbox, ids, signal);
    const entries = [];
    for (const entry of this.manifest.entries) {
      let job = boundJob(entry, jobs.get(entry.selection.intentId));
      if (entry.selection.rpcResult) {
        const response = await this.response(entry.selection.intentId, { signal });
        need(response, 'TASK_RPC_RESULT_NOT_SAVED');
        job = response.job;
      }
      entries.push({ selection:entry.selection, job, delivery:selectedDelivery(entry, job) });
    }
    return { schema: 'stellar-forge.inbox-task-inspection.v1', taskSha256: this.taskSha256,
      task: this.manifest.task, entries, process,
      savedResults: entries.filter(entry => entry.delivery?.status === 'SAVED').length,
      requiredResults: entries.length };
  }
  async review(intentId, { signal } = {}) {
    const entry = this._entry(intentId);
    boundJob(entry, (await this.inbox.show(intentId, { signal })).native);
    const review = await this.inbox.review(intentId, { signal });
    boundJob(entry, (await this.inbox.show(intentId, { signal })).native);
    need(review.configSha256 === entry.binding.configSha256 &&
      review.bodySha256 === entry.binding.bodySha256 &&
      review.ticketSha256 === entry.binding.ticketSha256, 'TASK_REVIEW_BINDING_MISMATCH');
    return review;
  }
  async execute(intentId, { review, workspaceDirectory, signal } = {}) {
    const entry = this._entry(intentId);
    const job = boundJob(entry, (await this.inbox.show(intentId, { signal })).native);
    if (job.attempt || job.outcome || job.state !== 'QUEUED')
      return { taskSha256: this.taskSha256, dispatched: false, job };
    need(review?.root === this.inbox.directory && review.intentId === intentId &&
      review.configSha256 === entry.binding.configSha256 &&
      review.bodySha256 === entry.binding.bodySha256 &&
      review.ticketSha256 === entry.binding.ticketSha256, 'TASK_MATCHING_REVIEW_REQUIRED');
    const result = await this.inbox.execute(intentId, { review, workspaceDirectory, signal });
    boundJob(entry, result.native);
    return { taskSha256: this.taskSha256, dispatched: true, result };
  }
  async recover(intentId, { signal } = {}) {
    const entry = this._entry(intentId);
    boundJob(entry, (await this.inbox.show(intentId, { signal })).native);
    const result = await this.inbox.recover(intentId, { signal });
    boundJob(entry, result.native);
    return { taskSha256: this.taskSha256, result };
  }
  async response(intentId, { signal } = {}) {
    const entry = this._entry(intentId);
    const selected = entry.selection.rpcResult;
    const response = selected ? await this.inbox.rpcResponse(intentId, {
      commerceDirectory:selected.commerceDirectory, readId:selected.readId,
      expectedResponseSha256:selected.responseSha256, signal,
    }) : await this.inbox.response(intentId, { signal });
    if (selected) need(response, 'TASK_RPC_RESULT_NOT_SAVED');
    if (response) {
      boundJob(entry, response.job);
      if (selected) selectedDelivery(entry, response.job);
    }
    else boundJob(entry, (await this.inbox.show(intentId, { signal })).native);
    return response;
  }
  /** Complete bytes are copied by the original verified receiver; exact copies resume locally. */
  async receive({ directory, signal } = {}) {
    directory = absolute(directory);
    need(!containsDirectory(this.directory, directory) &&
      !containsDirectory(this.inbox.directory, directory), 'TASK_RECEIVING_DIRECTORY_INVALID');
    const ready = await completedPacket(directory, this.taskSha256, signal);
    if (ready) return ready;
    await receiveIntent(this, directory);
    await privateDirectory(directory);
    need(await realpath(directory) === directory, 'TASK_RECEIVING_SYMLINK_DIRECTORY');
    const planFile = join(directory, 'receiving.json');
    let plan;
    if (await exists(planFile)) {
      plan = validatePlan(await readJson(planFile, 128 * 1024 * 1024));
      need(plan.task.taskSha256 === this.taskSha256, 'TASK_RECEIVING_OTHER_TASK');
    } else {
      // A process death before plan publication can leave its original atomic-write
      // temporary. The retained task/destination intent owns this continuation.
      need((await readdir(directory)).every(name => /^\.write-[a-f0-9-]{36}$/.test(name)),
        'TASK_RECEIVING_DIRECTORY_NOT_EMPTY');
      const jobs = [], files = [];
      for (const [index, entry] of this.manifest.entries.entries()) {
        const response = await this.response(entry.selection.intentId, { signal });
        need(response?.delivery?.status === 'SAVED', 'TASK_RESULTS_PENDING');
        const saved = response.delivery;
        jobs.push(response.job);
        files.push({ intentId: entry.selection.intentId, path: fileName(index, entry.selection.intentId),
          bytes: saved.bytes, sha256: saved.sha256, contentType: saved.contentType ?? null });
      }
      plan = validatePlan({ schema: PLAN, createdAt: now(), task: this.record, jobs, files });
      need(jsonBytes(plan).length <= 128 * 1024 * 1024, 'TASK_RECEIVING_PLAN_LIMIT');
      try { await writeJson(planFile, plan, { exclusive: true }); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        plan = validatePlan(await readJson(planFile, 128 * 1024 * 1024));
        need(plan.task.taskSha256 === this.taskSha256, 'TASK_RECEIVING_OTHER_TASK');
      }
    }
    await privateDirectory(join(directory, 'responses'));
    for (const file of plan.files) {
      const destination = join(directory, file.path);
      if (await exists(destination)) {
        await localFile(directory, file).verify({ signal });
        continue;
      }
      const response = await this.response(file.intentId, { signal });
      need(response?.delivery?.status === 'SAVED' && response.delivery.bytes === file.bytes &&
        response.delivery.sha256 === file.sha256, 'TASK_RECEIVING_SOURCE_CHANGED');
      try { await response.saveAs(destination, { signal }); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        await localFile(directory, file).verify({ signal });
      }
    }
    const taskBytes = jsonBytes(plan.task);
    await publishExact(join(directory, 'task.json'), taskBytes);
    const html = await publishReport(join(directory, 'review.html'), plan);
    const packet = { schema: PACKET, taskSha256: this.taskSha256, planSha256: sha(plan),
      receivedAt: now(), files: [...plan.files,
        { path: 'task.json', bytes: taskBytes.length, sha256: digest(taskBytes) },
        { path: 'review.html', bytes: html.length, sha256: digest(html) }] };
    try { await writeJson(join(directory, 'manifest.json'), packet, { exclusive: true }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    return openInboxTaskPacket({ directory, expectedTaskSha256: this.taskSha256, signal });
  }
}

/** Open every complete output offline; the original Inbox is needed only for continued operation. */
export async function openInboxTaskPacket({ directory, expectedTaskSha256, signal } = {}) {
  directory = await privateDirectory(directory, { create: false });
  await privateDirectory(join(directory, 'responses'), { create: false });
  const packet = await readJson(join(directory, 'manifest.json'), 128 * 1024 * 1024);
  const plan = validatePlan(await readJson(join(directory, 'receiving.json'), 128 * 1024 * 1024));
  need(packet.schema === PACKET && packet.taskSha256 === plan.task.taskSha256 &&
    packet.planSha256 === sha(plan) && Array.isArray(packet.files) &&
    packet.files.length === plan.files.length + 2, 'TASK_PACKET_MANIFEST_INVALID');
  if (expectedTaskSha256 !== undefined) need(packet.taskSha256 === expectedTaskSha256, 'TASK_BINDING_MISMATCH');
  const taskBytes = jsonBytes(plan.task);
  const expectedFor = html => [...plan.files,
    { path: 'task.json', bytes: taskBytes.length, sha256: digest(taskBytes) },
    { path: 'review.html', bytes: html.length, sha256: digest(html) }];
  let expected = expectedFor(Buffer.from(report(plan)));
  if (sha(packet.files) !== sha(expected))
    expected = expectedFor(Buffer.from(report(plan, { legacy: true })));
  need(sha(packet.files) === sha(expected), 'TASK_PACKET_MANIFEST_INVALID');
  for (const file of expected) {
    need(Number.isSafeInteger(file.bytes) && file.bytes >= 0 && HEX.test(file.sha256), 'TASK_PACKET_FILE_INVALID');
    await new ReceivedFile({ path: join(directory, file.path), bytes: file.bytes, sha256: file.sha256 }).verify({ signal });
  }
  return new ReceivedInboxTask(directory, packet, plan);
}
export class ReceivedInboxTask {
  constructor(directory, packet, plan) {
    this.directory = absolute(directory);
    this.packet = freeze(structuredClone(packet));
    this.plan = freeze(structuredClone(plan));
  }
  get taskSha256() { return this.packet.taskSha256; }
  get task() { return this.plan.task.manifest.task; }
  get files() { return this.plan.files; }
  get outcomes() { return this.plan.jobs.map(nativeOutcome); }
  response(intentId) {
    const file = this.files.find(item => item.intentId === intentId);
    need(file, 'TASK_INTENT_NOT_SELECTED');
    return localFile(this.directory, file);
  }
  toJSON() {
    return { schema: this.packet.schema, directory: this.directory, taskSha256: this.taskSha256,
      task: this.task, files: this.files, outcomes: this.outcomes, report: join(this.directory, 'review.html') };
  }
}

/** Explain a fresh caller task's source/provider changes beside its retained predecessor. */
export function compareInboxTasks(previous, next) {
  const a = validateRecord(previous), b = validateRecord(next);
  need(a.manifest.task.system === b.manifest.task.system &&
    a.manifest.task.service === b.manifest.task.service, 'TASK_SAME_CALLER_SERVICE_REQUIRED');
  need(b.manifest.predecessor?.taskSha256 === a.taskSha256 &&
    ['system', 'id', 'revision'].every(key => b.manifest.predecessor[key] === a.manifest.task[key]),
    'TASK_PREDECESSOR_BINDING_REQUIRED');
  const old = new Map(a.manifest.entries.map(entry => [entry.selection.role, entry]));
  need(old.size === a.manifest.entries.length &&
    new Set(b.manifest.entries.map(entry => entry.selection.role)).size === b.manifest.entries.length,
    'TASK_COMPARISON_UNIQUE_ROLES_REQUIRED');
  return { previous: a.taskSha256, next: b.taskSha256,
    entries: b.manifest.entries.map(entry => {
      const before = old.get(entry.selection.role);
      return { role: entry.selection.role, previousIntent: before?.selection.intentId ?? null,
        nextIntent: entry.selection.intentId, reusedOriginalIntent: before?.selection.intentId === entry.selection.intentId,
        sourceChanged: (before?.selection.sourceEdition ?? null) !== entry.selection.sourceEdition,
        facilitatorChanged: (before?.selection.facilitator ?? null) !== entry.selection.facilitator,
        requestChanged: before?.binding.operationSha256 !== entry.binding.operationSha256,
        resultChanged: (before?.binding.rpcResultSha256 ?? null) !== (entry.binding.rpcResultSha256 ?? null),
        previous: before ?? null, next: entry };
    }), removedRoles: [...old.keys()].filter(role => !b.manifest.entries.some(entry => entry.selection.role === role)) };
}
