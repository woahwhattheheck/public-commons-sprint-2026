#!/usr/bin/env node
// MIT. Retain reviewed merchant adjustments and recover original native responses.
import { constants } from 'node:fs';
import { open, mkdir, realpath, lstat, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { acquireStateLease } from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import { writePrivate, privateSupportDirectory } from './config.mjs';
import { accountingAdjustmentArguments, accountingAdjustmentRecordArguments, connectAccountingAdjustmentClient } from './accounting-adjustment-client.mjs';
import { downloadAccountingMaintenanceFile } from './accounting-maintenance-cli.mjs';

const REQUEST = 'stellar-forge.accounting-adjustment-client-request.v1';
const STATE = 'stellar-forge.accounting-adjustment-client-state.v1';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const ACTIVE = new Set(['QUEUED', 'RUNNING']);
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const now = () => new Date().toISOString();
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (code, message) => Object.assign(new Error(message), { code: 'ACCOUNTING_ADJUSTMENT_CLIENT_' + code });
const problem = error => ({ code: error.code ?? 'ERROR', message: String(error.message).slice(0, 1000) });
function need(ok, message, code = 'ARGUMENTS') { if (!ok) throw fail(code, message); }
function exact(value, fields) { need(plain(value) && Object.keys(value).every(key => fields.includes(key)), 'The saved operation contains undeclared fields.', 'REQUEST'); }
function endpoint(url) {
  let value; try { value = new URL(url); } catch { throw fail('CONFIGURATION', 'Supply the existing HTTPS or loopback HTTP merchant endpoint.'); }
  need(!value.username && !value.password && !value.search && !value.hash &&
    (value.protocol === 'https:' || value.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(value.hostname)),
    'Use the original HTTPS or loopback HTTP endpoint without credentials, query or fragment.', 'CONFIGURATION');
  return value.href;
}
async function privateDirectory(path) {
  path = resolve(path); await privateSupportDirectory(path);
  const info = await lstat(path);
  need(await realpath(path) === path && (!process.getuid || info.uid === process.getuid()),
    'Use an owner-controlled private directory without symlink ancestors.', 'PRIVATE_DIRECTORY');
  return path;
}
async function readJson(path, maximum = 2 * 1024 * 1024) {
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const info = await file.stat();
    need(info.isFile() && info.nlink === 1 && info.size <= maximum && !(info.mode & 0o077) &&
      (!process.getuid || info.uid === process.getuid()), 'Use the original bounded private regular JSON file.', 'PRIVATE_FILE');
    const bytes = await file.readFile();
    need(bytes.length <= maximum, 'The original operation file grew beyond its size limit.', 'PRIVATE_FILE');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally { await file.close(); }
}
async function syncDirectory(directory) {
  const file = await open(directory, constants.O_RDONLY);
  try { await file.sync(); } finally { await file.close(); }
}
function validateRequest(request) {
  exact(request, ['schema', 'preparedAt', 'url', 'workspace', 'tokenEnv', 'kind', 'arguments', 'preview', 'jobId', 'afterJobId', 'sha256']);
  const { sha256, ...content } = request;
  need(request.schema === REQUEST && Number.isFinite(Date.parse(request.preparedAt)) && sha(content) === sha256 &&
    endpoint(request.url) === request.url && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(request.workspace ?? '') &&
    /^[A-Za-z_][A-Za-z0-9_]*$/.test(request.tokenEnv ?? ''), 'The prepared operation or its retained identity changed.', 'REQUEST');
  const args = request.kind === 'record' ? accountingAdjustmentRecordArguments(request.preview) : accountingAdjustmentArguments(request.kind, request.arguments);
  need(JSON.stringify(args) === JSON.stringify(request.arguments), 'The original reviewed arguments changed after preparation.', 'REQUEST');
  if (request.kind !== 'record') need(request.preview === undefined, 'Verification and withdrawal retain their original arguments, without another preview.', 'REQUEST');
  for (const field of ['jobId', 'afterJobId']) if (request[field] !== undefined)
    need(request.kind === 'verify' && UUID.test(request[field]), 'Use an original verification job UUID only for verify.', 'REQUEST');
  need(!(request.jobId && request.afterJobId), 'Choose an exact retained job or a reviewed failed predecessor.', 'REQUEST');
  return request;
}

/** Preparation writes only a private retained request; it makes no merchant call. */
export async function prepareAccountingAdjustmentOperation({ directory, url, workspace, tokenEnv = 'MCP_ACCESS_TOKEN',
  kind, preview, arguments: value, jobId, afterJobId } = {}) {
  const args = kind === 'record' ? accountingAdjustmentRecordArguments(preview) : accountingAdjustmentArguments(kind, value);
  const content = { schema: REQUEST, preparedAt: now(), url: endpoint(url), workspace, tokenEnv, kind, arguments: args,
    ...(kind === 'record' ? { preview: structuredClone(preview) } : {}),
    ...(jobId === undefined ? {} : { jobId }), ...(afterJobId === undefined ? {} : { afterJobId }) };
  const request = validateRequest({ ...content, sha256: sha(content) });
  directory = resolve(directory);
  await privateDirectory(dirname(directory)); await mkdir(directory, { mode: 0o700 }); await privateDirectory(directory);
  await writePrivate(join(directory, 'request.json'), request);
  await writePrivate(join(directory, 'state.json'), { schema: STATE, requestSha256: request.sha256, phase: 'PREPARED',
    preparedAt: request.preparedAt, updatedAt: now(), submissionAttempted: false, jobId: jobId ?? null, observation: null });
  await syncDirectory(directory); await syncDirectory(dirname(directory));
  return { directory, request, submitted: false };
}
async function operation(directory, execute) {
  directory = await privateDirectory(directory);
  const lease = await acquireStateLease(directory);
  try {
    const request = validateRequest(await readJson(join(directory, 'request.json'))), state = await readJson(join(directory, 'state.json'), 4 * 1024 * 1024);
    need(state.schema === STATE && state.requestSha256 === request.sha256 && typeof state.submissionAttempted === 'boolean' &&
      (state.jobId === null || request.kind === 'verify' && UUID.test(state.jobId)) &&
      (request.jobId === undefined || state.jobId === request.jobId),
      'The operation journal does not belong to this original request.', 'STATE');
    async function checkpoint(changes) {
      lease.assertHeld(); Object.assign(state, changes, { updatedAt: now() });
      const temporary = join(directory, 'state-' + randomUUID() + '.next');
      try {
        await writePrivate(temporary, state); lease.assertHeld();
        await rename(temporary, join(directory, 'state.json')); await syncDirectory(directory);
      } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    }
    return await execute({ directory, request, state, checkpoint });
  } finally { await lease.close(); }
}
function selectedId(request) { return request.kind === 'record' ? request.arguments.id : request.arguments.adjustmentId; }
async function lookup(client, request, state, options) {
  if (request.kind === 'record') return client.reconcileRecord(request.preview, options);
  if (request.kind === 'withdraw') return client.reconcileWithdrawal(request.arguments, options);
  const jobId = state.jobId ?? request.jobId;
  return client.reconcileVerification({ adjustmentId: request.arguments.adjustmentId, transaction: request.arguments.transaction,
    ...(jobId ? { jobId } : request.afterJobId ? { afterJobId: request.afterJobId } : {}) }, options);
}
function checkVerification(result, request, jobId) {
  need(result.job?.adjustmentId === request.arguments.adjustmentId && result.job?.transaction === request.arguments.transaction &&
    (!jobId || result.job?.id === jobId), 'The observed job differs from the prepared original refund and transaction.', 'JOB_BINDING');
}

/** Reconcile recovers original stored results. Execute may submit the exact prepared native operation. */
export async function runAccountingAdjustmentOperation({ directory, execute = false, client: providedClient,
  environment = process.env, maxWaitMs = 30000, pollMs = 1000, signal } = {}) {
  need(typeof execute === 'boolean' && Number.isSafeInteger(maxWaitMs) && maxWaitMs >= 0 && maxWaitMs <= 300000 &&
    Number.isSafeInteger(pollMs) && pollMs >= 250 && pollMs <= 30000,
    'Use explicit execute:true, wait-ms 0–300000, and poll-ms 250–30000.');
  signal?.throwIfAborted();
  return operation(directory, async context => {
    const { request, state, checkpoint } = context;
    const client = providedClient ?? await connectAccountingAdjustmentClient({ url: request.url, workspace: request.workspace,
      tokenEnv: request.tokenEnv, environment, signal });
    let failure;
    try {
      need(client.workspace === request.workspace && (!client.endpoint || client.endpoint === request.url),
        'Use the prepared endpoint and original workspace alias.', 'CONNECTION_BINDING');
      let observed = await lookup(client, request, state, { requestSignal: signal });
      let submissionAttempted = false, acknowledged = false;
      if (!observed.found) {
        // Native verify creates its own job UUID and only deduplicates active or
        // completed attempts. After an uncertain send, discover that original
        // job; do not turn another execute invocation into a second RPC read.
        const maySubmit = execute && !request.jobId && !(request.kind === 'verify' && state.submissionAttempted);
        if (!maySubmit) {
          await checkpoint({ phase: 'NOT_OBSERVED', observation: observed });
          return { directory: context.directory, kind: request.kind, adjustmentId: selectedId(request), found: false,
            submissionAttempted: false, previouslyAttempted: state.submissionAttempted, acknowledged: false, pending: null,
            reason: request.jobId ? 'SELECTED_JOB_NOT_OBSERVED' : state.submissionAttempted ? 'ORIGINAL_REPLY_NOT_OBSERVED' : 'PREPARED_ONLY' };
        }
        await checkpoint({ phase: 'SENDING', submissionAttempted: true, sendingAt: now(), sendError: null, lookupError: null });
        try {
          submissionAttempted = true;
          const result = request.kind === 'record' ? await client.record(request.preview, { requestSignal: signal }) :
            request.kind === 'verify' ? await client.verify(request.arguments, { requestSignal: signal }) :
            await client.withdraw(request.arguments, { requestSignal: signal });
          observed = { found: true, ...result }; acknowledged = true;
        } catch (error) {
          await checkpoint({ phase: 'UNOBSERVED_REPLY', sendError: problem(error) });
          try { observed = await lookup(client, request, state, { timeoutMs: 10000 }); }
          catch (lookupError) { await checkpoint({ lookupError: problem(lookupError) }); error.lookupError = problem(lookupError); throw error; }
          if (!observed.found) throw error;
        }
      }
      if (request.kind === 'verify') checkVerification(observed, request, state.jobId);
      await checkpoint({ phase: 'OBSERVED', observation: observed, ...(observed.job ? { jobId: observed.job.id } : {}), lookupError: null });
      if (observed.job && ACTIVE.has(observed.job.status)) {
        observed = { found: true, ...(await client.waitForVerification(observed.job.id, { maxWaitMs, pollMs, signal })) };
        checkVerification(observed, request, state.jobId);
        await checkpoint({ phase: 'OBSERVED', observation: observed });
      }
      return { directory: context.directory, kind: request.kind, adjustmentId: selectedId(request),
        submissionAttempted, acknowledged, previouslyAttempted: state.submissionAttempted,
        ...observed, pending: observed.job ? ACTIVE.has(observed.job.status) : false };
    } catch (error) {
      failure = error; error.operationDirectory = context.directory; error.adjustmentId = selectedId(request); throw error;
    } finally {
      if (!providedClient) {
        try { await client.disconnect(); }
        catch (error) { if (failure) failure.releaseError = problem(error); else throw error; }
      }
    }
  });
}

/** The original maintenance consumer owns SHA-pinned streaming and private delivery. */
export const downloadAccountingAdjustmentFile = downloadAccountingMaintenanceFile;

const HELP = `Starforge merchant adjustment customer

  open|close|status --url MCP_URL --workspace ALIAS [--token-env NAME]
  status ... [--view summary|adjustments|jobs] [--offset N] [--limit N]
  events ... --run-id UUID [--search TEXT] [--offset N] [--limit N]
  event ... --run-id UUID --event-id SHA256 [--offset N] [--limit N]
  detail ... --adjustment-id UUID [--view summary|history|jobs] [--offset N] [--limit N]
  job ... --job-id UUID [--wait-ms N] [--poll-ms N]
  preview ... --request PRIVATE_DRAFT_JSON --out NEW_PRIVATE_PREVIEW_JSON
  prepare --dir NEW_PRIVATE_OPERATION --url MCP_URL --workspace ALIAS --action record
      --preview PRIVATE_PREVIEW_JSON [--token-env NAME]
  prepare --dir NEW_PRIVATE_OPERATION --url MCP_URL --workspace ALIAS --action verify|withdraw
      --request PRIVATE_NATIVE_ARGUMENTS_JSON [--token-env NAME]
      [--job-id ORIGINAL_UUID | --after-job-id REVIEWED_FAILED_UUID]  (verify only)
  execute|reconcile --dir PRIVATE_OPERATION [--wait-ms N] [--poll-ms N]
  download ... --selection PRIVATE_JSON --sha256 SHA256 --out NEW_PRIVATE_FILE [--chunk-bytes N]

Use the original host-declared workspace. preview saves its complete native result.
prepare is local only; execute first checks the original request or verification job.
reconcile reads original state/proofs and never starts verification or resends writes.
After an uncertain verify send, reuse the same directory to reconcile its original job.
To explicitly retry a retained FAILED/INTERRUPTED read, prepare a new operation with
its current revision and --after-job-id; a timeout alone is not a failed native job.
--job-id adopts an existing job and never submits a verification, even with execute.
No transaction is signed or sent. Verification observes an already executed reverse
transfer using the host's original reader. COMPLETED describes the read job; inspect
the original adjustment status, job.result.official and proof source/verdict.
Ordinary commands disconnect only their own readers; close explicitly closes the
original workspace, whose owner handles native jobs. Tokens remain in their named
environment variable. Files and operation directories are private and never replaced.
Exit 0: prepared/read/observed; 3: pending/not observed; 2: failed/interrupted/error.
`;
function options(args, allowed) {
  const values = new Map();
  for (let i = 0; i < args.length; i += 2) {
    need(allowed.includes(args[i]) && !values.has(args[i]) && args[i + 1] !== undefined, 'Use documented option/value pairs without duplicates.');
    values.set(args[i], args[i + 1]);
  }
  return values;
}
function required(values, name) { need(values.has(name) && values.get(name), 'Supply ' + name + '.'); return values.get(name); }
function numeric(values, name, fallback) {
  if (!values.has(name)) return fallback;
  need(/^\d+$/.test(values.get(name)), 'Use a nonnegative integer for ' + name + '.'); return Number(values.get(name));
}
function paging(values) { return { offset: numeric(values, '--offset', 0), limit: numeric(values, '--limit', 50) }; }
export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.length === 1 && ['--help', 'help'].includes(args[0])) { process.stdout.write(HELP); return; }
  const [command, ...rest] = args, connectionFields = ['--url', '--workspace', '--token-env'];
  let result;
  if (command === 'prepare') {
    const values = options(rest, ['--dir', ...connectionFields, '--action', '--preview', '--request', '--job-id', '--after-job-id']);
    const kind = required(values, '--action');
    need(kind === 'record' ? values.has('--preview') && !values.has('--request') :
      ['verify', 'withdraw'].includes(kind) && values.has('--request') && !values.has('--preview'),
      'Record uses --preview; verify/withdraw use --request with the original native arguments.');
    result = await prepareAccountingAdjustmentOperation({ directory: required(values, '--dir'), url: required(values, '--url'),
      workspace: required(values, '--workspace'), tokenEnv: values.get('--token-env') ?? 'MCP_ACCESS_TOKEN', kind,
      ...(kind === 'record' ? { preview: await readJson(resolve(required(values, '--preview'))) } :
        { arguments: await readJson(resolve(required(values, '--request')), 65536) }),
      jobId: values.get('--job-id'), afterJobId: values.get('--after-job-id') });
  } else if (command === 'execute' || command === 'reconcile') {
    const values = options(rest, ['--dir', '--wait-ms', '--poll-ms']);
    result = await runAccountingAdjustmentOperation({ directory: required(values, '--dir'), execute: command === 'execute',
      maxWaitMs: numeric(values, '--wait-ms', 30000), pollMs: numeric(values, '--poll-ms', 1000) });
  } else {
    const extra = { open: [], close: [], status: ['--view', '--offset', '--limit'], events: ['--run-id', '--search', '--offset', '--limit'],
      event: ['--run-id', '--event-id', '--offset', '--limit'], detail: ['--adjustment-id', '--view', '--offset', '--limit'],
      job: ['--job-id', '--wait-ms', '--poll-ms'], preview: ['--request', '--out'],
      download: ['--selection', '--sha256', '--out', '--chunk-bytes'] }[command];
    need(extra !== undefined, 'Choose open, close, status, events, event, detail, job, preview, prepare, execute, reconcile or download.');
    const values = options(rest, [...connectionFields, ...extra]);
    const client = await connectAccountingAdjustmentClient({ url: required(values, '--url'), workspace: required(values, '--workspace'),
      tokenEnv: values.get('--token-env') ?? 'MCP_ACCESS_TOKEN' });
    let failure;
    try {
      if (command === 'open') result = await client.open();
      if (command === 'close') result = await client.close();
      if (command === 'status') result = await client.status({ view: values.get('--view') ?? 'summary', ...paging(values) });
      if (command === 'events') result = await client.events({ runId: required(values, '--run-id'), ...paging(values),
        ...(values.has('--search') ? { search: values.get('--search') } : {}) });
      if (command === 'event') result = await client.event({ runId: required(values, '--run-id'), eventId: required(values, '--event-id'), ...paging(values) });
      if (command === 'detail') result = await client.detail({ adjustmentId: required(values, '--adjustment-id'), view: values.get('--view') ?? 'summary', ...paging(values) });
      if (command === 'job') result = await client.waitForVerification(required(values, '--job-id'),
        { maxWaitMs: numeric(values, '--wait-ms', 0), pollMs: numeric(values, '--poll-ms', 1000) });
      if (command === 'preview') {
        const output = resolve(required(values, '--out')); await privateDirectory(dirname(output));
        const preview = await client.preview(await readJson(resolve(required(values, '--request')), 65536));
        await writePrivate(output, preview); await syncDirectory(dirname(output)); result = { output, preview, submitted: false };
      }
      if (command === 'download') result = await downloadAccountingAdjustmentFile({ client,
        selection: await readJson(resolve(required(values, '--selection')), 65536), expectedSha256: required(values, '--sha256'),
        output: required(values, '--out'), chunkBytes: numeric(values, '--chunk-bytes', 65536) });
    } catch (error) { failure = error; throw error; }
    finally {
      try { await client.disconnect(); }
      catch (error) { if (failure) failure.releaseError = problem(error); else throw error; }
    }
  }
  process.stdout.write(JSON.stringify(result) + '\n');
  if (result?.pending === true || result?.found === false || ACTIVE.has(result?.job?.status)) process.exitCode = 3;
  else if (result?.job && result.job.status !== 'COMPLETED') process.exitCode = 2;
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { process.stderr.write(JSON.stringify({ error: problem(error),
    ...(error.operationDirectory ? { operationDirectory: error.operationDirectory, adjustmentId: error.adjustmentId } : {}) }) + '\n'); process.exitCode = 2; });
