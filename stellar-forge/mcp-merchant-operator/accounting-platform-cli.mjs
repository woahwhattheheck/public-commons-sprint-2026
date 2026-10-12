#!/usr/bin/env node
// MIT. Prepared customer operations for the original QuickBooks and Xero controllers.
import { constants } from 'node:fs';
import { open, mkdir, lstat, realpath, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { acquireStateLease } from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import { writePrivate, privateSupportDirectory } from './config.mjs';
import { accountingPlatformOperation, accountingPlatformActions, connectAccountingPlatformClient } from './accounting-platform-client.mjs';
import { downloadAccountingMaintenanceFile } from './accounting-maintenance-cli.mjs';

const REQUEST = 'stellar-forge.accounting-platform-client-request.v1';
const STATE = 'stellar-forge.accounting-platform-client-state.v1';
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const now = () => new Date().toISOString();
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (code, message) => Object.assign(new Error(message), { code: 'ACCOUNTING_PLATFORM_CLIENT_' + code });
const problem = error => ({ code: error.code ?? 'ERROR', message: String(error.message).slice(0, 2000) });
function need(ok, message, code = 'ARGUMENTS') { if (!ok) throw fail(code, message); }
function endpoint(url) {
  let result; try { result = new URL(url); } catch { throw fail('CONFIGURATION', 'Supply the original HTTPS or loopback HTTP merchant endpoint.'); }
  need(!result.username && !result.password && !result.search && !result.hash &&
    (result.protocol === 'https:' || result.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(result.hostname)),
    'Use an original HTTPS or loopback HTTP endpoint without embedded credentials, query or fragment.', 'CONFIGURATION');
  return result.href;
}
async function privateDirectory(value) {
  const path = resolve(value); await privateSupportDirectory(path); const info = await lstat(path);
  need(await realpath(path) === path && (!process.getuid || info.uid === process.getuid()),
    'Use a private owner-controlled directory without symlink ancestors.', 'PRIVATE_DIRECTORY');
  return path;
}
async function readJson(path, maximum = 2 * 1024 * 1024) {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const info = await handle.stat();
    need(info.isFile() && info.nlink === 1 && info.size <= maximum && !(info.mode & 0o077) &&
      (!process.getuid || info.uid === process.getuid()), 'Use the original bounded private regular JSON file.', 'PRIVATE_FILE');
    const bytes = await handle.readFile(); need(bytes.length <= maximum, 'The original file grew beyond its supported size.', 'PRIVATE_FILE');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally { await handle.close(); }
}
async function syncDirectory(path) { const handle = await open(path, constants.O_RDONLY); try { await handle.sync(); } finally { await handle.close(); } }
function validateRequest(request) {
  const fields = ['schema', 'preparedAt', 'url', 'workspace', 'platform', 'tokenEnv', 'operation', 'preview', 'sha256'];
  need(plain(request) && Object.keys(request).length === fields.length && fields.every(field => Object.hasOwn(request, field)),
    'Keep the complete original prepared request.', 'REQUEST');
  const { sha256, ...content } = request;
  need(request.schema === REQUEST && Number.isFinite(Date.parse(request.preparedAt)) && sha(content) === sha256 &&
    endpoint(request.url) === request.url && /^[A-Za-z_][A-Za-z0-9_]*$/.test(request.tokenEnv ?? ''),
    'The retained request or endpoint identity changed.', 'REQUEST');
  const operation = accountingPlatformOperation(request.preview);
  need(JSON.stringify(operation) === JSON.stringify(request.operation) && operation.platform === request.platform &&
    operation.command.arguments.workspace === request.workspace, 'The prepared command, preview, platform or workspace changed.', 'REQUEST');
  return request;
}
function validateState(state, request) {
  need(plain(state) && state.schema === STATE && state.requestSha256 === request.sha256 &&
    typeof state.submissionAttempted === 'boolean' && Number.isSafeInteger(state.sendAttempts) && state.sendAttempts >= 0 &&
    Number.isSafeInteger(state.recoveryAttempts) && state.recoveryAttempts >= 0,
    'The journal does not belong to the exact original prepared operation.', 'STATE');
  return state;
}
const initialState = request => ({ schema: STATE, requestSha256: request.sha256, phase: 'PREPARED', preparedAt: request.preparedAt,
  updatedAt: now(), submissionAttempted: false, sendAttempts: 0, recoveryAttempts: 0, observation: null });

/** Local preparation retains the exact reviewed command before any merchant mutation. */
export async function prepareAccountingPlatformOperation({ directory, url, workspace, platform, tokenEnv = 'MCP_ACCESS_TOKEN', preview } = {}) {
  const operation = accountingPlatformOperation(preview), content = { schema: REQUEST, preparedAt: now(), url: endpoint(url),
    workspace, platform, tokenEnv, operation, preview: structuredClone(preview) };
  const proposed = validateRequest({ ...content, sha256: sha(content) });
  directory = resolve(directory); await privateDirectory(dirname(directory));
  let created = false;
  try { await mkdir(directory, { mode: 0o700 }); created = true; } catch (error) { if (error.code !== 'EEXIST') throw error; }
  await privateDirectory(directory);
  const lease = await acquireStateLease(directory);
  try {
    let request, reopened = false;
    try {
      request = validateRequest(await readJson(join(directory, 'request.json'), 4 * 1024 * 1024)); reopened = true;
      const identity = value => ({ url: value.url, workspace: value.workspace, platform: value.platform, tokenEnv: value.tokenEnv,
        operation: value.operation, preview: value.preview });
      need(sha(identity(request)) === sha(identity(proposed)), 'This directory retains another exact preview or destination. Keep its original request.', 'REQUEST');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      need(created, 'Choose a new operation directory or one with its original request.json.', 'PRIVATE_DIRECTORY');
      request = proposed; lease.assertHeld();
      // Publish the initial send history before request.json can be executable.
      await writePrivate(join(directory, 'state.json'), initialState(request)); await syncDirectory(directory);
      await writePrivate(join(directory, 'request.json'), request); await syncDirectory(directory);
    }
    let state;
    try { state = validateState(await readJson(join(directory, 'state.json'), 4 * 1024 * 1024), request); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      throw fail('STATE_MISSING', 'Restore this original operation state.json; its prior send history cannot be reset.');
    }
    await syncDirectory(directory); await syncDirectory(dirname(directory));
    return { directory, request, state, reopened, submitted: false };
  } finally { await lease.close(); }
}
async function withOperation(directory, run) {
  directory = await privateDirectory(directory);
  const lease = await acquireStateLease(directory);
  try {
    const request = validateRequest(await readJson(join(directory, 'request.json'), 4 * 1024 * 1024));
    const state = validateState(await readJson(join(directory, 'state.json'), 4 * 1024 * 1024), request);
    async function checkpoint(changes) {
      lease.assertHeld(); Object.assign(state, changes, { updatedAt: now() });
      const temporary = join(directory, 'state-' + randomUUID() + '.next');
      try {
        await writePrivate(temporary, state); lease.assertHeld();
        await rename(temporary, join(directory, 'state.json')); await syncDirectory(directory);
      } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    }
    return await run({ directory, request, state, checkpoint });
  } finally { await lease.close(); }
}

/** Reconcile original records; both modes may finish an already-retained accountant return. */
export async function runAccountingPlatformOperation({ directory, execute = false, client: providedClient,
  environment = process.env, maxWaitMs = 30000, pollMs = 1000, signal } = {}) {
  need(typeof execute === 'boolean' && Number.isSafeInteger(maxWaitMs) && maxWaitMs >= 0 && maxWaitMs <= 300000 &&
    Number.isSafeInteger(pollMs) && pollMs >= 250 && pollMs <= 30000,
    'Choose explicit execute:true, wait-ms 0–300000 and poll-ms 250–30000.');
  signal?.throwIfAborted();
  return withOperation(directory, async ({ directory, request, state, checkpoint }) => {
    const operation = request.operation;
    let client = providedClient;
    let failure, submissionAttempted = false, acknowledged = false;
    const recoveryAtStart = state.recoveryAttempts;
    const beforeRecovery = async command => {
      await checkpoint({ phase: 'RECOVERING', recoveryAttempts: state.recoveryAttempts + 1,
        lastRecovery: command, recoveryStartedAt: now(), recoveryError: null });
    };
    const lookup = options => client.reconcile(operation, { recover: !signal?.aborted, onRecovery: beforeRecovery, ...options });
    try {
      client ??= await connectAccountingPlatformClient({ url: request.url, workspace: request.workspace,
        platform: request.platform, tokenEnv: request.tokenEnv, environment, signal });
      need(client.workspace === request.workspace && client.platform === request.platform &&
        (!client.endpoint || client.endpoint === request.url), 'Use the prepared endpoint, platform and workspace.', 'CONNECTION_BINDING');
      let observed = await lookup({ requestSignal: signal });
      const nativePostResume = operation.platform === 'qbo' && operation.action === 'post-resume' && observed.executionRequired === true;
      if (!observed.found || nativePostResume) {
        // Native context capture reads the provider before it can deduplicate the
        // retained context import. Its ambiguous send is never repeated here.
        const captureAlreadySent = operation.platform === 'xero' && operation.action === 'context-capture' && state.submissionAttempted;
        if (!execute || captureAlreadySent) {
          await checkpoint({ phase: observed.found ? 'OBSERVED' : 'NOT_OBSERVED', observation: observed });
          return { directory, platform: request.platform, action: operation.action, binding: operation.binding, ...observed,
            submissionAttempted: false, previouslyAttempted: state.submissionAttempted,
            recoveryAttempted: state.recoveryAttempts > recoveryAtStart,
            reason: nativePostResume ? 'EXPLICIT_NATIVE_POST_RESUME_REQUIRED' :
              captureAlreadySent ? 'ORIGINAL_CONTEXT_REPLY_NOT_OBSERVED' : state.submissionAttempted ? 'ORIGINAL_REPLY_NOT_OBSERVED' : 'PREPARED_ONLY' };
        }
        signal?.throwIfAborted();
        await checkpoint({ phase: 'SENDING', submissionAttempted: true, sendAttempts: state.sendAttempts + 1,
          lastCommand: operation.command, sendingAt: now(), sendError: null, lookupError: null });
        try {
          submissionAttempted = true;
          const reply = await client.command(operation, { requestSignal: signal });
          acknowledged = true;
          await checkpoint({ phase: 'ACKNOWLEDGED', acknowledgement: reply });
          observed = await lookup({ requestSignal: signal });
        } catch (error) {
          await checkpoint({ phase: 'UNOBSERVED_REPLY', sendError: problem(error) });
          try { observed = await lookup({ timeoutMs: 10000 }); }
          catch (lookupError) { await checkpoint({ lookupError: problem(lookupError) }); error.lookupError = problem(lookupError); throw error; }
          if (!observed.found) throw error;
        }
      }
      await checkpoint({ phase: observed.found ? 'OBSERVED' : 'NOT_OBSERVED', observation: observed, lookupError: null });
      if (observed.found && observed.pending && operation.platform === 'xero' && operation.action === 'operate') {
        observed = await client.waitForOperation(operation, { maxWaitMs, pollMs, signal });
        await checkpoint({ phase: 'OBSERVED', observation: observed });
      }
      return { directory, platform: request.platform, action: operation.action, submissionAttempted, acknowledged,
        previouslyAttempted: state.submissionAttempted, recoveryAttempted: state.recoveryAttempts > recoveryAtStart, ...observed };
    } catch (error) {
      failure = error; error.operationDirectory = directory; error.platform = request.platform; error.action = operation.action;
      await checkpoint({ lastError: problem(error) }).catch(checkpointError => { error.checkpointError = problem(checkpointError); });
      throw error;
    } finally {
      if (!providedClient && client) {
        try { await client.disconnect(); }
        catch (error) { if (failure) failure.releaseError = problem(error); else throw error; }
      }
    }
  });
}

export const downloadAccountingPlatformFile = downloadAccountingMaintenanceFile;
const HELP = "Starforge QuickBooks and Xero customer operations\n\n  actions --platform qbo|xero\n  sources|open|close --url MCP_URL --workspace ALIAS --platform qbo|xero [--token-env NAME]\n  status ... [--view NATIVE_VIEW] [--offset N] [--limit N]\n  plan ... --plan-id UUID [--view NATIVE_VIEW] [--offset N] [--limit N] [--journal-index N]\n  read ... --action NATIVE_READ_ACTION [--request PRIVATE_ARGUMENTS_JSON]\n  preview ... --action ACTION --request PRIVATE_ARGUMENTS_JSON --out NEW_PRIVATE_PREVIEW_JSON\n  prepare --dir PRIVATE_OPERATION --url MCP_URL --workspace ALIAS --platform qbo|xero\n      --preview PRIVATE_PREVIEW_JSON [--token-env NAME]\n  execute|reconcile --dir PRIVATE_OPERATION [--wait-ms N] [--poll-ms N]\n  download ... --selection PRIVATE_JSON --sha256 SHA256 --out NEW_PRIVATE_FILE [--chunk-bytes N]\n\nQuickBooks preview actions: create, review, cancel, response-save, response-resume,\npost and post-resume.\nXero preview actions: context-import, context-capture, create, cancel, operate,\nresponse-import, return-apply, return-resume. Read action names use hyphens,\nfor example connection, company-fetch, company-preview, handoff, context, source,\ncomparison and operation.\nactions prints the complete actual input fields. Each platform keeps its native phases.\n\nNative previews return the exact command and binding. Inline review/cancel/operate/\nresume/capture choices inspect the original records and retain the caller's exact\narguments; they create no accounting job. IDs, source aliases, digests, tenant and\nparent choices are explicit. prepare is local and never submits a merchant command.\nAn existing preparation can reopen only its same exact preview/destination.\n\nexecute first reconciles original IDs, then may send the retained command.\nreconcile creates no new plan, import, provider request or journal operation.\nA pending native QuickBooks post-resume needs explicit execute; reconcile never\ninvokes that provider continuation. An existing BOOKED native post is only adopted.\nEither mode may finish the same retained PENDING QuickBooks accountant response or\nXero return intent; that recovery command is recorded separately before dispatch.\nAfter an ambiguous native Xero context capture, the same operation directory only\nlooks for its existing context. It never repeats that provider read automatically.\nXero RUNNING/COMPLETE/FAILED/INTERRUPTED describe the original operation, not whether\neach journal was posted. Read its native comparison and accountant-return outcome.\nQuickBooks response FAULT/PENDING/SAVED and plan DRAFT/REVIEWED/BOOKED/CANCELLED stay\nnative. Native posting PREPARED/RUNNING/UNCERTAIN/RETRYABLE/RECEIVED needs observation\nor explicit resume; BOOKED is retained completion and FAULT/CONFLICT needs review.\n\nOrdinary commands disconnect only caller-owned file readers. Explicit close drains\nand closes the original workspace, whose controller owns its native operations.\nKeep tokens in their named environment variable. Output files are private; existing\ndownloads and previews are not replaced. Save the whole private operation directory.\nExit 0: preparation/read/observed; 3: pending/not observed; 2: native fault/error.\n";
function options(args, allowed) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    need(allowed.includes(args[index]) && !values.has(args[index]) && args[index + 1] !== undefined,
      'Use the documented option/value pairs without duplicates.');
    values.set(args[index], args[index + 1]);
  }
  return values;
}
const required = (values, key) => { need(values.has(key) && values.get(key), 'Supply ' + key + '.'); return values.get(key); };
function numeric(values, key, fallback) {
  if (!values.has(key)) return fallback;
  need(/^\d+$/.test(values.get(key)), 'Use a nonnegative integer for ' + key + '.');
  const value = Number(values.get(key)); need(Number.isSafeInteger(value), 'Use an exact supported integer for ' + key + '.'); return value;
}
function page(values) { return { offset: numeric(values, '--offset', 0), limit: numeric(values, '--limit', 50) }; }
export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.length === 1 && ['help', '--help'].includes(args[0])) { process.stdout.write(HELP); return; }
  const [command, ...rest] = args, connectionFields = ['--url', '--workspace', '--platform', '--token-env'];
  let result;
  if (command === 'actions') {
    const values = options(rest, ['--platform']); result = accountingPlatformActions(required(values, '--platform'));
  } else if (command === 'prepare') {
    const values = options(rest, [...connectionFields, '--dir', '--preview']);
    result = await prepareAccountingPlatformOperation({ directory: required(values, '--dir'), url: required(values, '--url'),
      workspace: required(values, '--workspace'), platform: required(values, '--platform'), tokenEnv: values.get('--token-env') ?? 'MCP_ACCESS_TOKEN',
      preview: await readJson(resolve(required(values, '--preview'))) });
  } else if (command === 'execute' || command === 'reconcile') {
    const values = options(rest, ['--dir', '--wait-ms', '--poll-ms']);
    result = await runAccountingPlatformOperation({ directory: required(values, '--dir'), execute: command === 'execute',
      maxWaitMs: numeric(values, '--wait-ms', 30000), pollMs: numeric(values, '--poll-ms', 1000) });
  } else {
    const extra = { sources: [], open: [], close: [], status: ['--view', '--offset', '--limit'],
      plan: ['--plan-id', '--view', '--offset', '--limit', '--journal-index'],
      read: ['--action', '--request'], preview: ['--action', '--request', '--out'],
      download: ['--selection', '--sha256', '--out', '--chunk-bytes'] }[command];
    need(extra !== undefined, 'Choose actions, sources, open, close, status, plan, read, preview, prepare, execute, reconcile or download.');
    const values = options(rest, [...connectionFields, ...extra]);
    const client = await connectAccountingPlatformClient({ url: required(values, '--url'), workspace: required(values, '--workspace'),
      platform: required(values, '--platform'), tokenEnv: values.get('--token-env') ?? 'MCP_ACCESS_TOKEN' });
    let failure;
    try {
      if (command === 'sources') result = await client.sources();
      if (command === 'open') result = await client.open();
      if (command === 'close') result = await client.close();
      if (command === 'status') result = await client.status({ view: values.get('--view') ?? 'summary', ...page(values) });
      if (command === 'plan') result = await client.plan({ planId: required(values, '--plan-id'), view: values.get('--view') ?? 'summary', ...page(values),
        ...(values.has('--journal-index') ? { journalIndex: numeric(values, '--journal-index') } : {}) });
      if (command === 'read') result = await client.read(required(values, '--action'),
        values.has('--request') ? await readJson(resolve(values.get('--request')), 65536) : {});
      if (command === 'preview') {
        const output = resolve(required(values, '--out')); await privateDirectory(dirname(output));
        const preview = await client.preview(required(values, '--action'), await readJson(resolve(required(values, '--request')), 65536));
        await writePrivate(output, preview); await syncDirectory(dirname(output)); result = { output, preview, submitted: false };
      }
      if (command === 'download') result = await downloadAccountingPlatformFile({ client,
        selection: await readJson(resolve(required(values, '--selection')), 65536), expectedSha256: required(values, '--sha256'),
        output: required(values, '--out'), chunkBytes: numeric(values, '--chunk-bytes', 65536) });
    } catch (error) { failure = error; throw error; }
    finally {
      try { await client.disconnect(); }
      catch (error) { if (failure) failure.releaseError = problem(error); else throw error; }
    }
  }
  process.stdout.write(JSON.stringify(result) + '\n');
  if (result?.pending === true || result?.found === false || result?.operation?.status === 'RUNNING') process.exitCode = 3;
  else if (['FAILED', 'INTERRUPTED'].includes(result?.operation?.status) || result?.response?.status === 'FAULT' ||
    ['FAULT', 'CONFLICT'].includes(result?.nativePost?.status)) process.exitCode = 2;
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { process.stderr.write(JSON.stringify({ error: problem(error),
    ...(error.operationDirectory ? { operationDirectory: error.operationDirectory, platform: error.platform, action: error.action } : {}) }) + '\n'); process.exitCode = 2; });
