// MIT. Python applications consume original workspace, purchase and file APIs.
// Operator keys remain inside the original Node workspace/approval components.
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { config, operation, need } from '../config.mjs';
import { MAX_REQUEST_BODY_BYTES } from '../request-body.mjs';
import { openWorkspace } from '../workspace.mjs';
import { workspaceEnvironment } from '../queue.mjs';
import { loadOperationTicket, requireOperationTicketFingerprint } from '../operation-ticket.mjs';

const modes = {
  'workspace-read':['--dir'],
  'workspace-check':['--dir','--config','--ticket-sha'],
  'execute-workspace':['--dir','--config','--ticket-sha'],
  'config-check':['--config','--ticket-sha'],
  'execute-config':['--config','--ticket-sha'],
  'prepare-file':['--config','--handoff','--out'],
  'retrieve-file':['--handoff','--out','--claim-env','--timeout-ms','--resume'],
  'inspect-file-transfer':['--handoff','--out'],
  'reset-file-transfer':['--handoff','--out'],
  'finalize-operation':['--operation-dir','--outbox','--merchant-route'],
};
const safeCode = error => /^[A-Z0-9_]{1,120}$/.test(error?.code ?? '')
  ? error.code : 'ORIGINAL_APPLICATION_OPERATION_FAILED';
const print = result => process.stdout.write(JSON.stringify(result) + '\n');
const sha = value => createHash('sha256').update(value).digest('hex');

async function privateApplicationFile(path, limit=65536) {
  need(isAbsolute(path) && resolve(path) === path, 'APPLICATION_PRIVATE_PATH_REQUIRED');
  const directory = dirname(path), info = await lstat(directory);
  need(info.isDirectory() && !info.isSymbolicLink() && (info.mode & 0o077) === 0 &&
    info.uid === process.getuid() && await realpath(directory) === directory,
    'APPLICATION_PRIVATE_DIRECTORY_REQUIRED');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    need(stat.isFile() && (stat.mode & 0o077) === 0 && stat.uid === process.getuid() && stat.size <= limit,
      'APPLICATION_PRIVATE_FILE_REQUIRED');
    const raw = await handle.readFile();
    need(raw.length <= limit, 'APPLICATION_PRIVATE_FILE_LIMIT');
    return raw;
  } finally { await handle.close(); }
}

async function originalApplicationAttempt(directory) {
  need(typeof directory === 'string' && isAbsolute(directory) && resolve(directory) === directory,
    'APPLICATION_PRIVATE_PATH_REQUIRED');
  const readJson = async name => JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(
    await privateApplicationFile(join(directory, name))));
  const meta = await readJson('operation.json'), attempt = await readJson('attempt.json');
  need(meta?.schema === 'stellar-forge.python-buyer.v1' && attempt?.schema === meta.schema &&
    /^[A-Za-z0-9._:-]{1,128}$/.test(meta.intentId ?? '') && attempt.intentId === meta.intentId &&
    basename(directory) === sha(meta.intentId) &&
    typeof meta.nativeWorkspace === 'string' && isAbsolute(meta.nativeWorkspace),
    'APPLICATION_ORIGINAL_ATTEMPT_REQUIRED');
  need(['STARTING','STARTED','RECORDED','INTERRUPTED_OR_START_FAILED','NATIVE_RESULT_UNAVAILABLE'].includes(attempt.state) &&
    typeof attempt.createdAt === 'string' && Number.isFinite(Date.parse(attempt.createdAt)),
    'APPLICATION_ORIGINAL_ATTEMPT_INVALID');
  const configurationPath = join(directory, 'config.json');
  const raw = await privateApplicationFile(configurationPath);
  need(sha(raw) === attempt.configSha256, 'APPLICATION_ATTEMPT_CONFIG_CHANGED');
  const cfg = await config(configurationPath), op = operation(cfg.operation);
  need(op.intentId === meta.intentId, 'APPLICATION_OPERATION_ID_MISMATCH');
  const body = op.bodyFile ? await privateApplicationFile(op.bodyFile, MAX_REQUEST_BODY_BYTES) : Buffer.alloc(0);
  need(sha(body) === attempt.bodySha256, 'APPLICATION_ATTEMPT_BODY_CHANGED');
  const attemptStartedAt = attempt.startedAt ?? attempt.createdAt;
  need(typeof attemptStartedAt === 'string' && Number.isFinite(Date.parse(attemptStartedAt)),
    'APPLICATION_ORIGINAL_ATTEMPT_INVALID');
  return {configurationPath, configSha256:attempt.configSha256, intentId:meta.intentId,
    evidencePath:join(cfg.evidenceDir, sha(meta.intentId) + '.json'),
    bodySha256:op.bodyFile ? sha(body) : null, bodyBytes:body.length,
    attemptStartedAt, workspace:meta.nativeWorkspace};
}

export async function main(args = process.argv.slice(2)) {
  const action = args[0], allowed = modes[action], options = new Map();
  need(allowed && args.length % 2 === 1, 'APPLICATION_COMMAND_INVALID');
  for (let index=1; index<args.length; index+=2) {
    need(allowed.includes(args[index]) && !options.has(args[index]) &&
      typeof args[index+1] === 'string' && !args[index+1].startsWith('--'), 'APPLICATION_OPTION_INVALID');
    options.set(args[index], args[index+1]);
  }
  need(allowed.every(key => ['--claim-env','--ticket-sha','--outbox','--merchant-route',
    '--timeout-ms','--resume'].includes(key) || options.has(key)), 'APPLICATION_OPTION_REQUIRED');
  if (action === 'workspace-read') {
    const workspace = await openWorkspace(['--dir', options.get('--dir')]);
    return print({mode:'ORIGINAL_PYTHON_WORKSPACE', directory:workspace.manifest.directory,
      configuration:workspace.config, keyCustody:'ORIGINAL_NODE_WORKSPACE'});
  }
  if (['workspace-check','execute-workspace','config-check','execute-config'].includes(action)) {
    const cfg = await config(options.get('--config'));
    const rawFingerprint = options.get('--ticket-sha');
    need(rawFingerprint === undefined || rawFingerprint === 'none' || /^[a-f0-9]{64}$/.test(rawFingerprint),
      'APPLICATION_TICKET_FINGERPRINT_INVALID');
    const fingerprint = rawFingerprint === 'none' ? null : rawFingerprint;
    const ticket = await loadOperationTicket(operation(cfg.operation), {requireCurrent:true});
    requireOperationTicketFingerprint(ticket, fingerprint);
    // The EXACT shared original inbox binding and native signer preflight.
    const environment = options.has('--dir') ? await workspaceEnvironment(cfg, options.get('--dir')) : process.env;
    if (action.endsWith('-check')) return print({mode:action === 'workspace-check'
      ? 'ORIGINAL_PYTHON_WORKSPACE_READY' : 'ORIGINAL_PYTHON_CONFIG_READY',
      intentId:cfg.operation.intentId, keyCustody:options.has('--dir')
        ? 'ORIGINAL_NODE_WORKSPACE' : 'ORIGINAL_PROCESS_ENVIRONMENT'});
    const {execute} = await import('../execute.mjs');
    const controller = new AbortController();
    const interrupt = () => { process.exitCode=130; controller.abort(); };
    const terminate = () => { process.exitCode=143; controller.abort(); };
    process.once('SIGINT', interrupt); process.once('SIGTERM', terminate);
    try { return await execute(cfg, {environment, signal:controller.signal, operationTicketSha256:fingerprint}); }
    finally { process.off('SIGINT', interrupt); process.off('SIGTERM', terminate); }
  }
  if (action === 'finalize-operation') {
    const attempt = await originalApplicationAttempt(options.get('--operation-dir'));
    const {finalizeOriginalAttempt} = await import('../finalization.mjs');
    need(typeof finalizeOriginalAttempt === 'function', 'ORIGINAL_SHARED_FINALIZER_REQUIRED');
    const controller = new AbortController();
    const interrupt = () => { process.exitCode=130; controller.abort(); };
    const terminate = () => { process.exitCode=143; controller.abort(); };
    process.once('SIGINT', interrupt); process.once('SIGTERM', terminate);
    try {
      const result = await finalizeOriginalAttempt({...attempt,
        outbox:options.get('--outbox'), merchantRoute:options.get('--merchant-route'), signal:controller.signal});
      if (!['FINALIZED','IDEMPOTENT_FINALIZED'].includes(result.result?.outcome)) process.exitCode ||= 2;
      return print({mode:'ORIGINAL_PYTHON_FINALIZATION', intentId:attempt.intentId,
        configSha256:attempt.configSha256, ...result});
    } finally { process.off('SIGINT', interrupt); process.off('SIGTERM', terminate); }
  }
  const {readJson} = await import('../../sf101-merchant-receiver/checkout-config.mjs');
  const {preparePurchase, retrieveFile, inspectFileTransfer, resetFileTransfer} =
    await import('../../sf101-merchant-receiver/purchase.mjs');
  const handoff = await readJson(options.get('--handoff'));
  if (action === 'prepare-file') {
    const result = await preparePurchase({handoff, configuration:await config(options.get('--config')),
      output:options.get('--out')});
    return print({mode:'ORIGINAL_PYTHON_PAID_FILE_PREPARED', ...result});
  }
  if (action === 'inspect-file-transfer' || action === 'reset-file-transfer') {
    const input = {handoff, destination:options.get('--out')};
    const reset = action === 'reset-file-transfer' ? await resetFileTransfer(input) : null;
    const result = await inspectFileTransfer(input);
    return print({mode:'ORIGINAL_PYTHON_FILE_TRANSFER', action:reset ? 'RESET' : 'INSPECT',
      orderReference:handoff.orderReference, ...result,
      ...(reset ? {removedPartialBytes:reset.removedPartialBytes} : {})});
  }
  const name = options.get('--claim-env') ?? 'SF101_CLAIM_TOKEN';
  need(/^[A-Z][A-Z0-9_]{1,64}$/.test(name), 'CLAIM_ENV_NAME_INVALID');
  const timeoutMs = options.has('--timeout-ms') ? Number(options.get('--timeout-ms')) : 30000;
  need(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 300000, 'DELIVERY_TIMEOUT_INVALID');
  need(!options.has('--resume') || ['true','false'].includes(options.get('--resume')), 'DELIVERY_RESUME_INVALID');
  const controller = new AbortController();
  const interrupt = () => { process.exitCode=130; controller.abort(); };
  const terminate = () => { process.exitCode=143; controller.abort(); };
  process.once('SIGINT', interrupt); process.once('SIGTERM', terminate);
  try {
    const result = await retrieveFile({handoff, destination:options.get('--out'), token:process.env[name],
      timeoutMs, signal:controller.signal,
      ...(options.has('--resume') ? {resume:options.get('--resume') === 'true'} : {})});
    return print({mode:'ORIGINAL_PYTHON_FILE_DELIVERY', ...result});
  } catch (error) {
    process.exitCode ||= 1;
    return print({mode:'ORIGINAL_PYTHON_FILE_DELIVERY', status:'FILE_NOT_SAVED',
      error:safeCode(error), ...(typeof error.partialPath === 'string' ? {partialPath:error.partialPath} : {}),
      ...(typeof error.transferState === 'string' ? {transferState:error.transferState} : {}),
      ...(Number.isSafeInteger(error.retainedBytes) ? {retainedBytes:error.retainedBytes} : {}),
      ...(typeof error.resumable === 'boolean' ? {resumable:error.resumable} : {}),
      automaticPaymentRetry:false});
  } finally {
    process.off('SIGINT', interrupt); process.off('SIGTERM', terminate);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => { process.stderr.write(JSON.stringify({error:safeCode(error)}) + '\n'); process.exitCode=1; });
