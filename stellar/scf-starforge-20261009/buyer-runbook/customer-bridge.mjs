#!/usr/bin/env node
// MIT. Customer commands on the original runbook, intake and recovery engines.
import {constants} from 'node:fs';
import {open, lstat, realpath, link, unlink} from 'node:fs/promises';
import {basename, dirname, isAbsolute, join, resolve, sep} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {need} from '../sf88-operator-buyer-cli/config.mjs';
import {openRunbookWorkspace} from './workspace-model.mjs';
import {runbookPlanDigest} from './runbook.mjs';
import {verifyRunbookRecovery, restoreRunbookRecovery} from './recovery.mjs';
import {OPERATION_HANDOFF_MAX_BYTES} from '../sf88-operator-buyer-cli/operation-handoff.mjs';

const SCHEMA = 'stellar-forge.buyer-acquisitions-command.v1';
const HASH = /^[a-f0-9]{64}$/;
const controller = new AbortController();
let signalExit;
const interrupt = () => {signalExit ??= 130; controller.abort();};
const terminate = () => {signalExit ??= 143; controller.abort();};
const codeOf = error => /^[A-Z0-9_]{1,120}$/.test(error?.code ?? '') ? error.code : 'ACQUISITION_LOCAL_ERROR';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const encode = value => Buffer.from(JSON.stringify(value, (_key, item) =>
  typeof item === 'function' ? undefined : item, 2) + '\n');
const digest = value => createHash('sha256').update(value).digest('hex');
function fields(value, names) {
  need(object(value) && Object.keys(value).every(name => names.includes(name)), 'ACQUISITION_ARGUMENT_FIELDS_INVALID');
}
function canonical(value) {
  need(typeof value === 'string' && isAbsolute(value) && !value.includes('\0') &&
    resolve(value) === value && value !== sep, 'ACQUISITION_CANONICAL_PATH_REQUIRED');
  return value;
}
async function read(path, limit) {
  path = canonical(path);
  need(await realpath(path) === path, 'ACQUISITION_CANONICAL_PATH_REQUIRED');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    need(info.isFile() && info.size <= limit, 'ACQUISITION_INPUT_LIMIT_OR_TYPE');
    const bytes = await file.readFile();
    need(bytes.length <= limit, 'ACQUISITION_INPUT_LIMIT_OR_TYPE');
    return bytes;
  } finally {await file.close();}
}
async function sync(path) {
  const file = await open(path, 'r');
  try {await file.sync();} finally {await file.close();}
}
async function destinationParent(path) {
  canonical(path);
  const parent = dirname(path), info = await lstat(parent);
  need(await realpath(parent) === parent && info.isDirectory() && !info.isSymbolicLink() &&
    (process.platform === 'win32' || (info.mode & 0o077) === 0),
  'ACQUISITION_PRIVATE_OUTPUT_PARENT_REQUIRED');
  return parent;
}
async function publishBytes(path, bytes) {
  const parent = await destinationParent(path), temporary = join(parent, '.acquisition-' + randomUUID());
  let published = false, publicationSyncError = null, publishedResult = null;
  const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    await file.writeFile(bytes); await file.sync(); await file.close();
    need(!controller.signal.aborted, 'ACQUISITION_CANCELLED_BEFORE_PUBLICATION');
    await link(temporary, path); published = true;
    try {await sync(parent);} catch (error) {publicationSyncError = codeOf(error);}
    publishedResult = {destination:path, bytes:bytes.length, sha256:digest(bytes), published, publicationSyncError, cleanupErrors:[]};
    return publishedResult;
  } finally {
    const cleanup = error => {if (publishedResult) publishedResult.cleanupErrors.push(codeOf(error));};
    await file.close().catch(cleanup); await unlink(temporary).catch(cleanup);
  }
}
async function saveDownload(model, p, paidFile = false) {
  const resource = await (paidFile ? model.downloadPaidFile(p.id, p.operationId) : model.download(p.id, p.operationId));
  let file, temporary, publishedResult = null;
  try {
    const parent = await destinationParent(p.destination);
    // The original paid-file engine returns its verified open descriptor. Keep
    // the same descriptor and pin it again across this create-only export.
    const initial = await resource.file.stat();
    const identity = resource.identity ?? Object.fromEntries(
      ['dev','ino','size','mtimeMs','ctimeMs'].map(name => [name, initial[name]]));
    need(initial.isFile(), 'RESOURCE_BYTES_CHANGED');
    temporary = join(parent, '.acquisition-' + randomUUID());
    file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const hash = createHash('sha256'), chunk = Buffer.alloc(65536); let offset = 0;
    while (true) {
      need(!controller.signal.aborted, 'ACQUISITION_DOWNLOAD_CANCELLED');
      const {bytesRead} = await resource.file.read(chunk, 0, chunk.length, offset);
      if (!bytesRead) break;
      await file.writeFile(chunk.subarray(0, bytesRead));
      hash.update(chunk.subarray(0, bytesRead)); offset += bytesRead;
    }
    const current = await resource.file.stat();
    need(offset === resource.bytes && hash.digest('hex') === resource.sha256 &&
      Object.entries(identity).every(([name, value]) => current[name] === value),
    'RESOURCE_BYTES_CHANGED');
    await file.sync(); await file.close(); file = null;
    need(!controller.signal.aborted, 'ACQUISITION_CANCELLED_BEFORE_PUBLICATION');
    await link(temporary, p.destination);
    let publicationSyncError = null;
    try {await sync(parent);} catch (error) {publicationSyncError = codeOf(error);}
    publishedResult = {destination:p.destination, name:resource.name, bytes:resource.bytes,
      sha256:resource.sha256, contentType:resource.contentType ?? null, published:true, publicationSyncError, cleanupErrors:[]};
    return publishedResult;
  } finally {
    const cleanup = error => {if (publishedResult) publishedResult.cleanupErrors.push(codeOf(error));};
    await resource.file.close().catch(cleanup); await file?.close().catch(cleanup);
    if (temporary) await unlink(temporary).catch(cleanup);
  }
}
function runView(value) {
  return {...value, planSha256:value.state?.plan ? runbookPlanDigest(value.state.plan) : null};
}
function diagnostics(value) {
  return value?.publicationSyncError || value?.selectionRecordError || value?.reopenError || value?.stateRefreshError ||
    value?.leaseReleaseErrors?.length || value?.cleanupErrors?.length || value?.nativeReopenErrors?.length;
}
async function execute(model, command, p) {
  const before = await model.run(p.id);
  if (command === 'execute')
    need(HASH.test(p.expectedPlanSha256 ?? '') &&
      runbookPlanDigest(before.state.plan) === p.expectedPlanSha256, 'MATCHING_ACQUISITION_REVIEW_REQUIRED');
  need(!controller.signal.aborted, 'OPERATION_ABORTED_BEFORE_START');
  const paidFile = ['retrieve-paid-file','reset-paid-file'].includes(command);
  const method = command === 'retrieve-paid-file' ? 'retrievePaidFile' :
    command === 'reset-paid-file' ? 'resetPaidFile' : command;
  const started = await model[method]({id:p.id, ...(p.only === undefined ? {} : {only:p.only}),
    ...(paidFile ? {configSha256:p.configSha256, handoffSha256:p.handoffSha256} : {})});
  const cancel = () => {model.cancel({id:p.id, executionId:started.executionId}).catch(() => {});};
  controller.signal.addEventListener('abort', cancel, {once:true});
  if (controller.signal.aborted) cancel();
  try {
    const result = runView(await model.waitForExecution({id:p.id, executionId:started.executionId}));
    result.planSha256 = runbookPlanDigest(before.state.plan);
    const execution = result.execution;
    const accepted = command === 'execute' ? ['RESULT_RECORDED','ALREADY_ATTEMPTED'] :
      ['FINALIZED','IDEMPOTENT_FINALIZED','NO_PAYMENT_REQUIRED','UNATTEMPTED'];
    if (result.stateRefreshError || execution.status !== 'FINISHED' || execution.result?.interrupted ||
      execution.result?.results?.some(row => !accepted.includes(row.status) ||
        row.exitCode !== undefined && row.exitCode !== 0 || row.viewStatus === 'SAVE_FAILED')) process.exitCode = 2;
    return result;
  } finally {controller.signal.removeEventListener('abort', cancel);}
}

async function main([inputFile, resultFile, ...extra]) {
  need(extra.length === 0, 'ACQUISITION_BRIDGE_ARGUMENTS_INVALID');
  const input = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(await read(inputFile, 1048576)));
  fields(input, ['schema','command','commandId','workspace','parameters','resultLimit']);
  need(input.schema === SCHEMA && /^[a-f0-9-]{36}$/.test(input.commandId ?? ''),
    'ACQUISITION_BRIDGE_INPUT_INVALID');
  need(Number.isSafeInteger(input.resultLimit) && input.resultLimit >= 1048576 &&
    input.resultLimit <= 268435456, 'ACQUISITION_RESULT_LIMIT_INVALID');
  const p = input.parameters ?? {}, command = input.command;
  const options = {
    state:[], attach:['run'], request:['id'], receive:['file','filename'],
    'paid-file':['id'], 'receive-paid-file':['file','filename'],
    'review-paid-file':['id','expectedRevision','totalAtomic','dailyAtomic','filename','claimEnv'],
    'prepare-paid-file':['id','reviewSha256'], 'export-paid-file':['id','destination'],
    'retrieve-paid-file':['id','only','configSha256','handoffSha256'],
    'reset-paid-file':['id','only','configSha256','handoffSha256'],
    'download-paid-file':['id','operationId','destination'],
    'review-request':['id','acceptIndex','totalAtomic','dailyAtomic'], 'prepare-request':['id','reviewSha256'],
    draft:['id','revision'], save:['id','expectedRevision','manifest'],
    initialize:['id','expectedRevision','reviewSha256'], inspect:['id'],
    execute:['id','only','expectedPlanSha256'], recover:['id'], unlock:['id','ownerPid'],
    finalize:['id','only'], 'bind-accounting':['id','only','workspace'],
    preview:['id','operationId'], download:['id','operationId','destination'],
    export:['id','format','destination'], 'export-request':['id','kind','destination'],
    'backup-review':['stateRoot'], backup:['stateRoot','output','expectedReviewSha256','quiesced','passEnv'],
    verify:['bundle','expected','passEnv','python'], restore:['bundle','expected','passEnv','python'],
  };
  need(Object.hasOwn(options, command), 'ACQUISITION_COMMAND_REQUIRED');
  fields(p, options[command]);
  let model, native = null, error = null, cleanupError = null, completed = false;
  try {
    need(!controller.signal.aborted, 'OPERATION_ABORTED_BEFORE_START');
    if (command === 'verify' || command === 'restore') {
      native = await (command === 'verify' ? verifyRunbookRecovery : restoreRunbookRecovery)(p, {signal:controller.signal});
    } else {
      fields(input.workspace, ['directory','configsDirectory','operatorSettings','paidFileClaimEnvs']);
      canonical(input.workspace.directory);
      model = await openRunbookWorkspace({...input.workspace,
        ...(command === 'attach' ? {runs:[canonical(p.run)]} : {})});
      need(!controller.signal.aborted, 'OPERATION_ABORTED_BEFORE_START');
      if (command === 'state' || command === 'attach') native = await model.state();
      else if (command === 'request') native = await model.request(p.id);
      else if (command === 'receive') {
        const bytes = await read(p.file, OPERATION_HANDOFF_MAX_BYTES);
        native = await model.receiveRequest({filename:p.filename ?? basename(p.file), base64:bytes.toString('base64')});
      } else if (command === 'paid-file') native = await model.paidFile(p.id);
      else if (command === 'receive-paid-file') {
        const bytes = await read(p.file, 131072);
        native = await model.receivePaidFile({filename:p.filename ?? basename(p.file), base64:bytes.toString('base64')});
      } else if (command === 'review-paid-file') native = await model.reviewPaidFile(p);
      else if (command === 'prepare-paid-file') native = await model.preparePaidFile(p);
      else if (command === 'review-request') native = await model.reviewRequest(p);
      else if (command === 'prepare-request') native = await model.prepareRequest(p);
      else if (command === 'draft') native = await model.draft(p.id, p.revision);
      else if (command === 'save') native = await model.save(p);
      else if (command === 'initialize') native = runView(await model.initialize(p));
      else if (command === 'inspect') native = runView(await model.run(p.id));
      else if (['execute','finalize','retrieve-paid-file','reset-paid-file'].includes(command))
        native = await execute(model, command, p);
      else if (command === 'recover') native = runView(await model.recover(p));
      else if (command === 'unlock') native = runView(await model.unlock(p));
      else if (command === 'bind-accounting') native = runView(await model.bindAccounting(p));
      else if (command === 'preview') native = await model.previewResource(p.id, p.operationId);
      else if (command === 'download' || command === 'download-paid-file')
        native = await saveDownload(model, p, command === 'download-paid-file');
      else if (command === 'export') {
        const output = await model.export(p.id, p.format);
        native = {...await publishBytes(p.destination, output.bytes), name:output.name, format:p.format};
      } else if (command === 'export-request') {
        need(['body','handoff'].includes(p.kind), 'ACQUISITION_REQUEST_ATTACHMENT_REQUIRED');
        const output = await model.requestAttachment(p.id, p.kind);
        native = {...await publishBytes(p.destination, output.bytes), name:output.name, kind:p.kind};
      } else if (command === 'export-paid-file') {
        const output = await model.paidFileAttachment(p.id);
        native = {...await publishBytes(p.destination, output.bytes), name:output.name, kind:'paid-file-handoff'};
      } else if (command === 'backup-review') native = await model.inspectRecovery(p);
      else if (command === 'backup') native = await model.snapshotRecovery(p, {signal:controller.signal});
    }
    completed = true;
    if (diagnostics(native)) process.exitCode = 2;
  } catch (problem) {
    error = codeOf(problem); process.exitCode = signalExit ?? 1;
    // Preserve current original state when a native action already changed it.
    // This is inspection only; no retry, unlock or payment is introduced.
    if (model && p.id && ['execute','finalize','recover','initialize','bind-accounting','retrieve-paid-file','reset-paid-file'].includes(command))
      try {native = runView(await model.run(p.id));} catch {}
  } finally {
    try {await model?.close();}
    catch (problem) {cleanupError = codeOf(problem); process.exitCode ||= 2;}
  }
  const record = {schema:SCHEMA, command, commandId:input.commandId,
    directory:input.workspace?.directory ?? null, completed, native, error, cleanupError,
    interrupted:controller.signal.aborted};
  const bytes = encode(record);
  need(bytes.length <= input.resultLimit, 'ACQUISITION_RESULT_LIMIT');
  // This descriptor is independent of stdout and is always caller-private.
  // A completed native restore is still reported if later cleanup had a problem.
  const file = await open(canonical(resultFile), constants.O_WRONLY | constants.O_CREAT |
    constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {await file.writeFile(bytes); await file.sync();} finally {await file.close();}
  await sync(dirname(resultFile));
  process.stdout.write(JSON.stringify({schema:SCHEMA, command, commandId:input.commandId,
    resultBytes:bytes.length, resultSha256:digest(bytes), completed, error, cleanupError}) + '\n');
  if (signalExit !== undefined) process.exitCode = signalExit;
}

process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
main(process.argv.slice(2)).catch(error => {
  process.stderr.write(JSON.stringify({error:codeOf(error)}) + '\n');
  process.exitCode = signalExit ?? 1;
}).finally(() => {process.off('SIGINT', interrupt); process.off('SIGTERM', terminate);});
