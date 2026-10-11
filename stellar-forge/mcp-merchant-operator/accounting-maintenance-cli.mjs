#!/usr/bin/env node
// MIT. Prepared requests and recovery of the same merchant maintenance job.
import { constants } from 'node:fs';
import { open, mkdir, realpath, lstat, rename, unlink, link } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { acquireStateLease } from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import { writePrivate, privateSupportDirectory } from './config.mjs';
import { accountingMaintenanceArguments, connectAccountingMaintenanceClient } from './accounting-maintenance-client.mjs';

const REQUEST = 'stellar-forge.accounting-maintenance-request.v1';
const STATE = 'stellar-forge.accounting-maintenance-client-state.v1';
const ACTIVE = new Set(['QUEUED', 'RUNNING']);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const now = () => new Date().toISOString();
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (code, message) => Object.assign(new Error(message), { code: 'ACCOUNTING_MAINTENANCE_CLIENT_' + code });
const problem = error => ({ code: error.code ?? 'ERROR', message: String(error.message).slice(0, 800) });
function exact(value, fields) {
  if (!plain(value) || Object.keys(value).some(key => !fields.includes(key))) throw fail('REQUEST', 'The saved request has undeclared fields.');
}
function endpoint(url) {
  let value; try { value = new URL(url); } catch { throw fail('CONFIGURATION', 'Supply the existing HTTPS or loopback HTTP merchant endpoint.'); }
  if (value.username || value.password || value.search || value.hash ||
      value.protocol !== 'https:' && !(value.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(value.hostname)))
    throw fail('CONFIGURATION', 'Use the existing HTTPS or loopback HTTP endpoint without credentials, query or fragment.');
  return value.href;
}
async function privateDirectory(path) {
  path = resolve(path); await privateSupportDirectory(path);
  const info = await lstat(path);
  if (await realpath(path) !== path || process.getuid && info.uid !== process.getuid())
    throw fail('PRIVATE_DIRECTORY', 'Use an owner-controlled private directory without symlink ancestors.');
  return path;
}
async function readJson(path, maximum = 4 * 1024 * 1024) {
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > maximum || info.mode & 0o077 || process.getuid && info.uid !== process.getuid())
      throw fail('PRIVATE_FILE', 'Use the original bounded private regular operation file.');
    const bytes = await file.readFile();
    if (bytes.length > maximum) throw fail('PRIVATE_FILE', 'The operation file grew beyond its size limit.');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally { await file.close(); }
}
async function syncDirectory(directory) {
  const file = await open(directory, constants.O_RDONLY);
  try { await file.sync(); } finally { await file.close(); }
}
function validateRequest(request) {
  exact(request, ['schema', 'createdAt', 'url', 'workspace', 'tokenEnv', 'kind', 'arguments', 'sha256']);
  const { sha256, ...content } = request;
  if (request.schema !== REQUEST || typeof request.createdAt !== 'string' || !Number.isFinite(Date.parse(request.createdAt)) ||
      sha(JSON.stringify(content)) !== sha256 || endpoint(request.url) !== request.url ||
      !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(request.workspace ?? '') || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(request.tokenEnv ?? ''))
    throw fail('REQUEST', 'The operation request or its retained identity changed.');
  const args = accountingMaintenanceArguments(request.kind, request.arguments);
  if (JSON.stringify(args) !== JSON.stringify(request.arguments)) throw fail('REQUEST', 'The operation arguments changed after preparation.');
  return request;
}

/** Prepare only local private files. No merchant call or operation occurs. */
export async function prepareAccountingMaintenanceOperation({ directory, url, workspace, tokenEnv = 'MCP_ACCESS_TOKEN', kind, arguments: value } = {}) {
  const args = accountingMaintenanceArguments(kind, { ...value, requestId: value?.requestId ?? randomUUID() });
  const content = { schema: REQUEST, createdAt: now(), url: endpoint(url), workspace, tokenEnv, kind, arguments: args };
  const request = validateRequest({ ...content, sha256: sha(JSON.stringify(content)) });
  directory = resolve(directory);
  await privateDirectory(dirname(directory)); await mkdir(directory, { mode: 0o700 }); await privateDirectory(directory);
  await writePrivate(join(directory, 'request.json'), request);
  await writePrivate(join(directory, 'state.json'), { schema: STATE, requestSha256: request.sha256,
    requestId: args.requestId, phase: 'PREPARED', preparedAt: request.createdAt, updatedAt: now(), observation: null });
  await syncDirectory(directory); await syncDirectory(dirname(directory));
  return { directory, request, submitted: false };
}

async function operation(directory, execute) {
  directory = await privateDirectory(directory);
  const lease = await acquireStateLease(directory);
  try {
    const request = validateRequest(await readJson(join(directory, 'request.json'), 65536));
    const state = await readJson(join(directory, 'state.json'));
    if (state.schema !== STATE || state.requestSha256 !== request.sha256 || state.requestId !== request.arguments.requestId)
      throw fail('STATE', 'The operation journal belongs to another prepared request.');
    async function checkpoint(changes) {
      lease.assertHeld();
      Object.assign(state, changes, { updatedAt: now() });
      const temporary = join(directory, 'state-' + randomUUID() + '.next');
      try {
        await writePrivate(temporary, state); lease.assertHeld();
        await rename(temporary, join(directory, 'state.json')); await syncDirectory(directory);
      } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    }
    return await execute({ directory, request, state, checkpoint });
  } finally { await lease.close(); }
}
function matchesRequest(job, request) {
  const expected = { kind: request.kind, actor: request.arguments.actor };
  for (const [key, value] of Object.entries(request.arguments)) if (!['requestId', 'actor', 'jobId'].includes(key)) expected[key] = value;
  if (request.kind === 'backup' && expected.label === undefined) expected.label = 'Accounting backup';
  if (request.kind === 'cancel') expected.target = request.arguments.jobId;
  if (job.id !== request.arguments.requestId || job.kind !== request.kind || job.actor !== request.arguments.actor ||
      !plain(job.input) || Object.keys(job.input).length !== Object.keys(expected).length ||
      Object.entries(expected).some(([key, value]) => job.input[key] !== value))
    throw fail('JOB_BINDING', 'This UUID is retained with different native operation inputs. Keep the original request and inspect that job.');
}

/** Reconcile the saved UUID; submit only when execute:true was explicitly requested. */
export async function runAccountingMaintenanceOperation({ directory, execute = false, client: providedClient,
  environment = process.env, maxWaitMs = 30000, pollMs = 500, signal } = {}) {
  if (!Number.isSafeInteger(maxWaitMs) || maxWaitMs < 0 || maxWaitMs > 86400000 ||
      !Number.isSafeInteger(pollMs) || pollMs < 100 || pollMs > 60000)
    throw fail('ARGUMENTS', 'Use wait-ms from 0 to 86400000 and poll-ms from 100 to 60000.');
  if (typeof execute !== 'boolean') throw fail('ARGUMENTS', 'Use an explicit execute:true only to submit the prepared request.');
  signal?.throwIfAborted();
  return operation(directory, async context => {
    const { request, state, checkpoint } = context;
    const client = providedClient ?? await connectAccountingMaintenanceClient({ url: request.url, workspace: request.workspace,
      tokenEnv: request.tokenEnv, environment, signal });
    if (client.workspace !== request.workspace || client.endpoint && client.endpoint !== request.url)
      throw fail('CONNECTION_BINDING', 'Use the saved endpoint and original workspace alias for this operation.');
    const jobId = request.arguments.requestId;
    let observed;
    try { observed = await client.job(jobId, { requestSignal: signal }); }
    catch (error) {
      if (error.code !== 'ACCOUNTING_MAINTENANCE_JOB_NOT_FOUND') throw error;
      if (!execute) {
        await checkpoint({ phase: 'NOT_OBSERVED', observation: null, lookupError: problem(error) });
        return { directory: context.directory, requestId: jobId, found: false, submissionAttempted: false, acknowledged: false, pending: null };
      }
    }
    if (observed) matchesRequest(observed.job, request);
    let submissionAttempted = false, acknowledged = false;
    if (!observed) {
      // This durable boundary precedes the only mutating call. Reopening it reads
      // the same UUID before any explicitly requested resend.
      await checkpoint({ phase: 'SENDING', sendingAt: now(), observation: null, lookupError: null, sendError: null });
      try {
        submissionAttempted = true;
        observed = await client.command(request.kind, request.arguments, { requestSignal: signal });
        acknowledged = true; matchesRequest(observed.job, request);
      } catch (error) {
        await checkpoint({ phase: 'UNOBSERVED_REPLY', sendError: problem(error) });
        // A lost response does not create another UUID or replay the mutation.
        try { observed = await client.job(jobId, { timeoutMs: 10000 }); matchesRequest(observed.job, request); }
        catch (lookupError) {
          await checkpoint({ lookupError: problem(lookupError) });
          error.operationDirectory = context.directory; error.requestId = jobId; throw error;
        }
      }
    }
    await checkpoint({ phase: 'OBSERVED', observation: observed, lookupError: null });
    const result = ACTIVE.has(observed.job.status)
      ? await client.wait(jobId, { maxWaitMs, pollMs, signal }) : { ...observed, pending: false };
    matchesRequest(result.job, request);
    await checkpoint({ phase: 'OBSERVED', observation: result, lookupError: null });
    return { directory: context.directory, requestId: jobId, found: true, submissionAttempted, acknowledged, ...result };
  });
}

/** Save a complete SHA-checked original file; a partial download never occupies out. */
export async function downloadAccountingMaintenanceFile({ client, selection, expectedSha256, output,
  chunkBytes = 65536, signal } = {}) {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256 ?? '')) throw fail('FILE_SHA', 'Use the reviewed original file SHA256.');
  output = resolve(output); const directory = await privateDirectory(dirname(output));
  const temporary = join(directory, 'accounting-read-' + randomUUID() + '.partial');
  const file = await open(temporary, 'wx', 0o600); let metadata, bytes = 0;
  try {
    for await (const chunk of client.fileChunks(selection, { expectedSha256, chunkBytes, signal })) {
      await file.writeFile(chunk.bytes); metadata = chunk.file; bytes += chunk.bytes.length;
    }
    if (!metadata || bytes !== metadata.bytes) throw fail('FILE_REPLY', 'The original file did not finish.');
    await file.sync(); await file.close(); await link(temporary, output); await unlink(temporary); await syncDirectory(directory);
    return { output, workspace: client.workspace, selection, file: metadata, complete: true };
  } catch (error) { await file.close().catch(() => {}); await unlink(temporary).catch(() => {}); throw error; }
}

const HELP = `Starforge accounting maintenance client

  open|close|status --url MCP_URL --workspace ALIAS [--token-env NAME]
  status ... [--view summary|backups|jobs|sources] [--offset N] [--limit N]
  job --url MCP_URL --workspace ALIAS --job-id UUID [--token-env NAME]
  prepare --dir NEW_PRIVATE_OPERATION --url MCP_URL --workspace ALIAS --actor NAME
      --action pause|review|backup|verify|restore|resume|cancel [--request-id UUID]
      [--token-env NAME] [--review-id SHA256] [--backup-id ID] [--sha256 SHA256]
      [--external-writers-stopped true] [--label NAME] [--job-id UUID]
  execute|reconcile --dir PRIVATE_OPERATION [--wait-ms N] [--poll-ms N]
  download --url MCP_URL --workspace ALIAS --selection PRIVATE_JSON
      --sha256 SHA256 --out NEW_PRIVATE_FILE [--token-env NAME] [--chunk-bytes N]

Use the existing merchant service. Open the configured alias once per host session.
prepare writes a private request without contacting the service. execute first reads
its original job UUID, then submits that exact request only if no job is retained.
reconcile reads/waits for the same job and never submits it. The saved endpoint,
workspace and token environment NAME are reused; no token or passphrase is saved.
Exit 0: complete/read/prepared; 3: pending or not observed; 2: failed/interrupted/error.
`;
function options(args, allowed) {
  const values = new Map();
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.includes(args[i]) || values.has(args[i]) || args[i + 1] === undefined)
      throw fail('ARGUMENTS', 'Use the documented option/value pairs without duplicates.');
    values.set(args[i], args[i + 1]);
  }
  return values;
}
function required(values, name) {
  if (!values.has(name) || !values.get(name)) throw fail('ARGUMENTS', 'Supply ' + name + '.');
  return values.get(name);
}
function numeric(values, name, fallback) {
  if (!values.has(name)) return fallback;
  if (!/^\d+$/.test(values.get(name))) throw fail('ARGUMENTS', 'Use a nonnegative integer for ' + name + '.');
  return Number(values.get(name));
}
export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.length === 1 && ['--help', 'help'].includes(args[0])) { process.stdout.write(HELP); return; }
  const [command, ...rest] = args;
  const connectionFields = ['--url', '--workspace', '--token-env'];
  let result;
  if (command === 'prepare') {
    const values = options(rest, ['--dir', ...connectionFields, '--actor', '--action', '--request-id', '--review-id', '--backup-id',
      '--sha256', '--external-writers-stopped', '--label', '--job-id']);
    const value = { actor: required(values, '--actor') };
    for (const [option, field] of [['--request-id', 'requestId'], ['--review-id', 'expectedReviewId'], ['--backup-id', 'backupId'],
      ['--sha256', 'expectedSha256'], ['--label', 'label'], ['--job-id', 'jobId']]) if (values.has(option)) value[field] = values.get(option);
    if (values.has('--external-writers-stopped')) {
      if (values.get('--external-writers-stopped') !== 'true') throw fail('ARGUMENTS', 'Use --external-writers-stopped true only after stopping external source writers.');
      value.externalWritersStopped = true;
    }
    result = await prepareAccountingMaintenanceOperation({ directory: required(values, '--dir'), url: required(values, '--url'),
      workspace: required(values, '--workspace'), tokenEnv: values.get('--token-env') ?? 'MCP_ACCESS_TOKEN',
      kind: required(values, '--action'), arguments: value });
  } else if (command === 'execute' || command === 'reconcile') {
    const values = options(rest, ['--dir', '--wait-ms', '--poll-ms']);
    result = await runAccountingMaintenanceOperation({ directory: required(values, '--dir'), execute: command === 'execute',
      maxWaitMs: numeric(values, '--wait-ms', 30000), pollMs: numeric(values, '--poll-ms', 500) });
  } else if (['open', 'close', 'status', 'job', 'download'].includes(command)) {
    const extras = { open: [], close: [], status: ['--view', '--offset', '--limit'], job: ['--job-id'],
      download: ['--selection', '--sha256', '--out', '--chunk-bytes'] }[command];
    const values = options(rest, [...connectionFields, ...extras]);
    const client = await connectAccountingMaintenanceClient({ url: required(values, '--url'), workspace: required(values, '--workspace'),
      tokenEnv: values.get('--token-env') ?? 'MCP_ACCESS_TOKEN' });
    if (command === 'open') result = await client.open();
    if (command === 'close') result = await client.closeWorkspace();
    if (command === 'job') result = await client.job(required(values, '--job-id'));
    if (command === 'status') result = await client.status({ view: values.get('--view') ?? 'summary',
      offset: numeric(values, '--offset', 0), limit: numeric(values, '--limit', 25) });
    if (command === 'download') result = await downloadAccountingMaintenanceFile({ client,
      selection: await readJson(resolve(required(values, '--selection')), 65536), expectedSha256: required(values, '--sha256'),
      output: required(values, '--out'), chunkBytes: numeric(values, '--chunk-bytes', 65536) });
  } else throw fail('ARGUMENTS', 'Choose open, close, status, job, prepare, execute, reconcile or download.');
  process.stdout.write(JSON.stringify(result) + '\n');
  if (result?.pending === true || result?.found === false || ACTIVE.has(result?.job?.status)) process.exitCode = 3;
  else if (result?.job && result.job.status !== 'COMPLETE') process.exitCode = 2;
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(JSON.stringify({ error: problem(error), ...(error.requestId ? { requestId: error.requestId,
      operationDirectory: error.operationDirectory } : {}) }) + '\n'); process.exitCode = 2;
  });
}
