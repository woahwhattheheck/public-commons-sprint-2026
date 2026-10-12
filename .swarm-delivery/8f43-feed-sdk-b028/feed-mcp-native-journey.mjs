// Original B028 feed receiving, with the complete 055c customer SDK consumer.
import { mkdir, readFile, rename, open, lstat, unlink, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { MerchantFeedWorkspaces, readFeedsWorkspaceConfiguration, feedsWorkspaceTools } from './feed-mcp-native-source/stellar-forge/mcp-merchant-operator/feeds-workspace.mjs';
import { openFeedsWorkspaceClient, retainFeedsRequest } from './feed-mcp-native-source/stellar-forge/mcp-merchant-operator/feeds-workspace-client.mjs';
import { openMerchantFileClient } from './feed-mcp-native-source/stellar-forge/mcp-merchant-operator/retained-download.mjs';
import { createMcpToolHandler } from './feed-mcp-native-source/stellar-forge/mcp-paid-agent/http-tools.mjs';
import { acquireStateLease } from './feed-mcp-native-source/stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';

const projectRoot = '/workspace/scratch/b0285b3810b3';
const sourceRoot = join(projectRoot, 'feed-mcp-native-source');
const root = join(projectRoot, 'feed-mcp-native-runtime');
const cli = join(sourceRoot, 'stellar/scf-starforge-20261009/sf30-seller-sdk/feeds/cli.py');
const sdkCli = join(sourceRoot, 'stellar-forge/mcp-merchant-operator/feeds-workspace-cli.mjs');
const sourceHash = 'b5334857c5f1ff9dbebb8ece2b86a8228d4bec1aeec69d6fdaac8c0d91ace072';
const SDK_SOURCE_COMMIT = '055c5231fa50c654e2d720062f72e0df42ea9865';
const ORIGINAL_DRIVER_BLOB = '6d75d87025388ced1804e1190b502743ec033e28';
const SDK_SOURCE_FILES = {
  "stellar-forge/mcp-merchant-operator/feeds-workspace-client.mjs": "a8168ad888f57a0768e16febf67163943ad9e6e6",
  "stellar-forge/mcp-merchant-operator/feeds-workspace-request.mjs": "f5d42e3dfe0a709f10ce5f18273f748fd3169759",
  "stellar-forge/mcp-merchant-operator/feeds-workspace-cli.mjs": "aeb10322abeac3dfde14196133637fa3f1b9c09a",
  "stellar-forge/mcp-merchant-operator/feeds-workspace-client.d.mts": "9b84b9e21c0c3ea55bd3f99ebc3ab8970d672c62",
  "stellar-forge/mcp-merchant-operator/feeds-workspace-request.d.mts": "ec6d9cdd06d50b3b3782b8de3820cf5a2bc05a2e",
  "stellar-forge/mcp-merchant-operator/feeds-workspace-cli.d.mts": "0f5966629688d1a9c91be583cb4b1c28c91575a4",
  "stellar-forge/mcp-merchant-operator/feeds-download.d.mts": "a3a44d04abc062e1a9d210e6f9930e6a5d51b23b",
  "stellar-forge/mcp-merchant-operator/FEEDS_WORKSPACE_CLIENT.md": "3426cc23412bfb3c09529e88d0c331c0f74f1d63",
  "stellar-forge/mcp-merchant-operator/feeds-download.mjs": "578aba96bb5e9c26272fb6a27fb3af05621a7189",
  "stellar-forge/mcp-merchant-operator/feeds-workspace.mjs": "01647a42e40e4a56d6dc5a613b709b08d09533dc",
  "stellar-forge/mcp-merchant-operator/retained-download.mjs": "f8c2e1917772c0b2c6bfdaa681073854104c9673",
  "stellar-forge/mcp-merchant-operator/FEEDS_WORKSPACE.md": "956466a33fd2886d4f713424267c7fd3e8f16b47",
  "stellar/scf-starforge-20261009/distribution/contributions/merchant-provider-feeds-workspaces.json": "2258dcc8ac4f54c5328bf0dd5c7329e6e3a555b5",
  "stellar-forge/mcp-merchant-operator/catalog/feeds-workspace.mjs": "58e1c8a486a6dfb57654bbfd890e617d39abfa53",
  "stellar-forge/mcp-merchant-operator/retained-file-reads.mjs": "546e4db6fe832b70adf13733b0bea3f96e64cdfa",
  "stellar-forge/mcp-paid-agent/http-tools.mjs": "c17f82d142bb51c3d3d3f8c214bfbaf35a0524cb",
  "stellar-forge/mcp-merchant-operator/retained-file-contracts.mjs": "16dbce5411cddc372ac93cbe4813c373b9d81457"
};
const SOURCE_SELECTION_BLOB = 'cbe7f008696f6e2d63dca8481c06ce71c1e265ce';
const node = process.execPath;
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const failure = (code, message) => Object.assign(new Error(message), { code });
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const privateEnv = { ...process.env, SF30_XML_NODE: node };
const nativeProcesses = new Map(), sdkClients = new Map();
const lifetime = new AbortController(), closeObservations = [], originalCleanups = new Map();
let controller, http, client, endpoint, port, token, httpClosing, outputLease, state;
let firstError, signalCode = 0, outputError, attempt;

function requestStop(error, code = 0) {
  if (code && !signalCode) signalCode = code;
  if (!lifetime.signal.aborted) lifetime.abort(error);
  for (const current of sdkClients.values()) current.requestClose();
}
const onSigint = () => requestStop(failure('NATIVE_INTERRUPTED', 'Original receiving interrupted by SIGINT.'), 130);
const onSigterm = () => requestStop(failure('NATIVE_INTERRUPTED', 'Original receiving interrupted by SIGTERM.'), 143);
const onOutputError = error => { outputError ??= error; requestStop(error); };
process.on('SIGINT', onSigint);
process.on('SIGTERM', onSigterm);
process.stdout.on('error', onOutputError);
process.stderr.on('error', onOutputError);

async function emit(value, stream = process.stdout) {
  await new Promise((resolve, reject) => stream.write(json(value), error => error ? reject(error) : resolve()));
}
async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function privateReplace(path, bytes) {
  outputLease.assertHeld();
  try {
    const current = await lstat(path);
    if (!current.isFile() || current.isSymbolicLink() || (current.mode & 0o077))
      throw failure('NATIVE_PRIVATE_OUTPUT', 'Preserve the original private regular output: ' + path);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = join(dirname(path), '.native-' + randomUUID());
  const handle = await open(temporary, 'wx', 0o600);
  let owned, closed = false;
  try {
    owned = await handle.stat({ bigint: true });
    await handle.writeFile(bytes); await handle.sync(); await handle.close(); closed = true;
    outputLease.assertHeld(); await rename(temporary, path); await syncDirectory(dirname(path));
  } finally {
    try { if (!closed) await handle.close(); } finally {
      if (owned) {
        try {
          const current = await lstat(temporary, { bigint: true });
          if (current.dev === owned.dev && current.ino === owned.ino) await unlink(temporary);
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    }
  }
}
async function save() { await privateReplace(join(root, 'journey-state.json'), json(state)); }
async function phase(name, details) {
  state.phases.push({ name, at: new Date().toISOString(), ...details });
  await save(); await emit({ phase: name, ...details });
}
async function drain(name, close) {
  let reported = false;
  for (;;) {
    try { return await close(); }
    catch (error) {
      if (!reported) {
        closeObservations.push({ owner: name, code: error.code ?? error.name, message: error.message });
        await emit({ state: 'DRAINING_ORIGINAL_OWNER', owner: name, code: error.code ?? error.name, message: error.message }, process.stderr).catch(() => {});
        reported = true;
      }
      await sleep(1000);
    }
  }
}
function childOwner(key, command, args, environment = privateEnv) {
  lifetime.signal.throwIfAborted();
  if (nativeProcesses.has(key)) throw failure('NATIVE_OWNER_EXISTS', 'Reopen the original process before another ' + key + '.');
  const child = spawn(command, args, { env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  const owned = { child, key, stopRequested: false, spawnError: null, stderr: '', done: null };
  owned.done = new Promise(resolve => {
    child.on('error', error => { owned.spawnError ??= error; });
    child.once('close', (code, signal) => resolve({ code, signal, error: owned.spawnError }));
  });
  child.stderr.on('data', bytes => { owned.stderr = (owned.stderr + bytes.toString()).slice(-16384); });
  nativeProcesses.set(key, owned);
  return owned;
}
async function stopConsole(alias) {
  const owned = nativeProcesses.get(alias);
  if (!owned) return;
  if (!owned.stopRequested && owned.child.exitCode === null && owned.child.signalCode === null) {
    owned.child.kill('SIGTERM');
    owned.stopRequested = true;
  }
  const result = await owned.done;
  nativeProcesses.delete(alias);
  return { alias, code: result.code, signal: result.signal, ...(result.error ? { error: result.error.message } : {}) };
}
async function runChild(key, command, args, environment = privateEnv) {
  const owned = childOwner(key, command, args, environment);
  let output = '';
  owned.child.stdout.on('data', bytes => {
    output += bytes.toString();
    if (Buffer.byteLength(output) > 32 * 1024 * 1024) requestStop(failure('NATIVE_CHILD_OUTPUT', 'Original child output exceeds its complete JSON limit.'));
  });
  const cancel = () => {
    if (!owned.stopRequested && owned.child.exitCode === null && owned.child.signalCode === null) {
      owned.child.kill('SIGTERM'); owned.stopRequested = true;
    }
  };
  lifetime.signal.addEventListener('abort', cancel, { once: true });
  try {
    const result = await owned.done; nativeProcesses.delete(key);
    if (result.error) throw result.error;
    lifetime.signal.throwIfAborted();
    if (result.code !== 0) throw failure('NATIVE_CHILD_FAILED', key + ' exited ' + result.code + '/' + result.signal + ': ' + owned.stderr);
    return output;
  } finally { lifetime.signal.removeEventListener('abort', cancel); }
}
async function runPython(args) { return JSON.parse(await runChild('feed-cli-' + randomUUID(), 'python3', [cli, ...args])); }
async function startConsole(alias) {
  const workspace = join(root, alias);
  try { await readFile(join(workspace, 'workspace.json')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; await runPython(['--workspace', workspace, 'init']); }
  const owned = childOwner(alias, 'python3', [cli, '--workspace', workspace, 'serve', '--startup-format', 'json',
    '--landing', 'subscriptions', '--port', '0']);
  const startup = await new Promise((resolve, reject) => {
    let pending = '', settled = false;
    const finish = (error, value) => {
      if (settled) return; settled = true; clearTimeout(timer);
      lifetime.signal.removeEventListener('abort', cancel);
      if (error) reject(error); else resolve(value);
    };
    const cancel = () => finish(lifetime.signal.reason);
    const timer = setTimeout(() => finish(failure('NATIVE_STARTUP_TIMEOUT', 'Original console did not announce startup.')), 30000);
    lifetime.signal.addEventListener('abort', cancel, { once: true });
    owned.child.stdout.on('data', bytes => {
      if (settled) return;
      pending += bytes.toString();
      if (Buffer.byteLength(pending) > 2 * 1024 * 1024) return finish(failure('NATIVE_STARTUP_OUTPUT', 'Original startup response is too large.'));
      const index = pending.indexOf('\n');
      if (index >= 0) { try { finish(null, JSON.parse(pending.slice(0, index))); } catch (error) { finish(error); } }
    });
    void owned.done.then(result => finish(result.error ?? failure('NATIVE_STARTUP_EXIT',
      'Original console exited before startup ' + result.code + ': ' + owned.stderr)));
    if (lifetime.signal.aborted) cancel();
  });
  if (startup.schema !== 'stellar-forge.feed-workspace-launch.v1' || startup.workspace !== workspace)
    throw failure('NATIVE_CONSOLE_CHANGED', 'Different original console.');
  await privateReplace(join(root, alias + '-launch.json'), json(startup));
  return { workspace, bindingSha256: startup.bindingSha256, pid: startup.pid };
}
async function openMcp() {
  lifetime.signal.throwIfAborted();
  if (http || controller || sdkClients.size) throw failure('NATIVE_MCP_OWNER_EXISTS', 'Drain the original MCP factory before reopening it.');
  const cfg = await readFeedsWorkspaceConfiguration(join(root, 'connections.json'));
  controller = new MerchantFeedWorkspaces({ feedsWorkspaces: cfg, exportsDirectory: join(root, 'exports') }, { environment: process.env });
  const tools = feedsWorkspaceTools((name, description, properties, required, annotations = {}) => ({ name, description,
    inputSchema: { type: 'object', properties, required, additionalProperties: false }, annotations }));
  token = randomBytes(32).toString('base64url');
  http = createServer(createMcpToolHandler({ tools, call: (name, args) => controller.call(name, args) }, {
    bearerToken: token, serverName: 'starforge-feed-native-journey',
    instructions: 'Use the original feed workspace and publisher. This host has no payer or signer.' }));
  const listening = once(http, 'listening');
  http.listen({ host: '127.0.0.1', port: state.sdk.mcpPort ?? port ?? 0 });
  await listening; port = http.address().port; endpoint = 'http://127.0.0.1:' + port + '/mcp';
  if (state.sdk.endpoint && state.sdk.endpoint !== endpoint) throw failure('NATIVE_MCP_ENDPOINT_CHANGED', 'Keep the saved MCP endpoint for original client recovery.');
  state.sdk.mcpPort = port; state.sdk.endpoint = endpoint; await save();
  client = await openMerchantFileClient({ url: endpoint, tokenEnv: 'FEED_NATIVE_MCP', environment: { FEED_NATIVE_MCP: token }, signal: lifetime.signal });
  for (const workspace of ['research', 'receiving']) {
    const sdk = await openFeedsWorkspaceClient({ client, workspace, signal: lifetime.signal, timeoutMs: 240000,
      resultsDirectory: join(root, 'complete-results', workspace) });
    sdkClients.set(workspace, sdk);
  }
  const response = await fetch(endpoint, { method: 'POST', signal: lifetime.signal, headers: {
    authorization: 'Bearer ' + token, 'content-type': 'application/json', accept: 'application/json, text/event-stream',
    'mcp-protocol-version': '2025-11-25' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1000, method: 'tools/list', params: {} }) });
  if (!response.ok) throw failure('NATIVE_MCP_CATALOG', 'Original MCP catalog returned HTTP ' + response.status + '.');
  const listed = (await response.json()).result.tools;
  if (listed.length !== 17 || !listed.every(tool => tool.name.startsWith('merchant_feeds_'))) throw failure('NATIVE_MCP_CATALOG', 'Different native MCP catalog.');
  return listed.length;
}
async function closeMcp() {
  for (const [alias, sdk] of sdkClients) { await sdk.close(); sdkClients.delete(alias); }
  client = null;
  if (http) {
    const originalHttp = http;
    if (!httpClosing) {
      httpClosing = new Promise((resolve, reject) => originalHttp.close(error =>
        error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve()));
      void httpClosing.catch(() => { httpClosing = null; });
    }
    await httpClosing; http = null; httpClosing = null;
  }
  if (controller) { await controller.close(); controller = null; }
}
function sdk(workspace = 'research') {
  const selected = sdkClients.get(workspace);
  if (!selected) throw failure('NATIVE_SDK_CLOSED', 'Open the original configured SDK workspace.');
  return selected;
}
async function call(name, args = {}) {
  const { workspace = 'research', ...input } = args;
  return sdk(workspace).call(name, input);
}
async function original(value) {
  if (Object.hasOwn(value, 'native') || value.completeResult) {
    const resolved = await sdk(value.workspace).resolveResult(value);
    if (resolved.delivery) {
      state.sdk.completeResults[resolved.delivery.exportId] = {
        exportId: resolved.delivery.exportId, manifestSha256: resolved.delivery.manifestSha256,
        directory: resolved.delivery.directory, resultPath: resolved.delivery.resultPath, bytes: resolved.delivery.bytes
      };
    }
    return resolved.native;
  }
  return value;
}
async function lookup(workspace, id, family) {
  try { return await original(await sdk(workspace).operation({ operationId: id, family })); }
  catch (error) { if (error.code === 'FEEDS_CONSOLE_HTTP_404') return null; throw error; }
}
async function recorded(workspace, key, tool, input, recovery) {
  const owner = sdk(workspace), request = owner.prepare(tool, input, { recovery });
  const directory = join(root, 'sdk-requests', workspace, key);
  const retained = await retainFeedsRequest({ directory, request, signal: lifetime.signal });
  if (retained.state === 'RECONCILIATION_REQUIRED') {
    const observed = await owner.reconcile({ directory });
    state.sdk.reconciliations.push({ directory, requestSha256: request.requestSha256,
      at: new Date().toISOString(), recordState: observed.recordState, activity: observed.activity,
      operation: observed.operation, publisher: observed.publisher });
    await save();
    if (observed.activity.state === 'RUNNING') {
      const waited = await owner.waitForJob(observed.activity.id);
      if (waited.state === 'RUNNING') throw failure('NATIVE_JOB_STILL_RUNNING', 'Keep the accepted original job.');
    }
  }
  // These recorded calls are reads or native ledger actions. An uncertain
  // response repeats this exact saved request only after the observation above.
  const completed = await owner.execute(request, { directory, repeat: retained.state === 'RECONCILIATION_REQUIRED' });
  const reopened = await owner.execute(request, { directory });
  if (completed.state !== 'RESPONSE_RETAINED' || !sameJson(completed.response, reopened.response))
    throw failure('NATIVE_SDK_RECORD_CHANGED', 'The original saved response changed during local reopen.');
  state.sdk.requests[key] = { workspace, directory, requestSha256: request.requestSha256,
    resultSha256: completed.response.resultSha256, state: completed.state, recovery: request.recovery };
  await save();
  return completed.response.result;
}
async function waitOriginal(workspace, jobId) {
  const owner = sdk(workspace);
  const status = await original(await owner.status());
  const selected = jobId ?? status.activity.id;
  if (selected) {
    const waited = await owner.waitForJob(selected);
    if (waited.state === 'FAILED') throw failure('NATIVE_JOB_FAILED', 'Original ' + waited.activity.action + ' failed: ' + waited.activity.error);
    if (waited.state === 'JOB_NO_LONGER_CURRENT') throw failure('NATIVE_JOB_CHANGED', 'Read the original operation after its accepted worker changed.');
    return waited.activity.result;
  }
  if (status.activity.state === 'FAILED') throw failure('NATIVE_JOB_FAILED', 'Original worker failed: ' + status.activity.error);
  return status.activity.result;
}
async function action(workspace, name, input, family = 'feed') {
  const owner = sdk(workspace), operationId = input.operationId;
  let prior = operationId ? await lookup(workspace, operationId, family) : null;
  if (prior?.state === 'RESULT_RETAINED' && !prior.historyOnly) return prior.result;
  let reply;
  if (prior?.continuation) {
    const { action: resume, ...selected } = prior.continuation;
    reply = await recorded(workspace, family + '-' + operationId + '-resume-' + attempt.id,
      'merchant_feeds_action', { action: resume, input: selected }, { family, operationId });
  } else if (operationId) {
    reply = await recorded(workspace, family + '-' + operationId, 'merchant_feeds_action',
      { action: name, input }, { family, operationId });
  } else reply = await owner.action(name, input);
  const accepted = await original(reply);
  if (!operationId) return waitOriginal(workspace, accepted.id);
  const observed = await owner.waitForOperation({ operationId, family, ...(accepted.id ? { jobId: accepted.id } : {}) });
  prior = await lookup(workspace, operationId, family);
  if (prior?.state === 'RESULT_RETAINED' && !prior.historyOnly) return prior.result;
  const error = failure('NATIVE_OPERATION_RETAINED', 'Original ' + operationId + ' remains ' + (prior?.run?.state ?? observed.state) + '.');
  error.operation = prior; throw error;
}
async function seller(action, input = {}) {
  return original(await sdk('research').publisher(state.productId, action, input));
}
async function retainedPublisherBuyer(snapshot) {
  const firstPageQuery = new URLSearchParams('fields=key,title,link&limit=5').toString();
  const publisher = await original(await sdk('research').publishers({ productId: state.productId }));
  if (publisher.productId !== state.productId || !Array.isArray(publisher.drafts?.buyers))
    throw failure('NATIVE_BUYER_INDEX_CHANGED', 'Reopen the original publisher and its saved buyer configurations.');
  const records = publisher.drafts.buyers;
  const originalFields = record => record?.intentId === state.intentId && record.snapshot === snapshot &&
    record.query === firstPageQuery && /^[a-f0-9]{64}$/.test(record.offerSha256 ?? '') &&
    /^[a-f0-9]{64}$/.test(record.configSha256 ?? '');
  let selected = state.sdk.publisherBuyerSelection;
  if (!selected) {
    // The original pre-SDK caller may already have received and retained its buyer ID.
    // Recover that exact native record without requesting a new offer.
    const prior = state.buyer?.id ? records.find(record => record.id === state.buyer.id) : null;
    if (state.buyer?.id && (!prior || !originalFields(prior) || prior.offerSha256 !== state.buyer.offerSha256))
      throw failure('NATIVE_BUYER_CONFIGURATION_CHANGED', 'Reopen the saved original buyer ID and complete selection.');
    const review = prior ? null : (await seller('publisher.buyer.review', {
      snapshot, query: firstPageQuery })).result;
    const parameters = review ? new URLSearchParams(review.query) : null;
    if (parameters) parameters.delete('snapshot');
    if (review && (review.snapshot !== snapshot || parameters.toString() !== firstPageQuery ||
        !/^[a-f0-9]{64}$/.test(review.offerSha256 ?? '') || typeof review.url !== 'string'))
      throw failure('NATIVE_BUYER_REVIEW_CHANGED', 'Retain the original first-page snapshot, query and offer.');
    selected = { schema: 'stellar-forge.feed-mcp-native-buyer-selection.v1', productId: state.productId,
      intentId: state.intentId, snapshot, query: firstPageQuery, acceptIndex: 0,
      offerSha256: prior?.offerSha256 ?? review.offerSha256, review,
      ...(prior ? { originalBuyerId: prior.id, originalConfigSha256: prior.configSha256 } : {}) };
    state.sdk.publisherBuyerSelection = selected;
    await save(); // The exact review and preparation input survive a lost prepare response.
  }
  if (selected.schema !== 'stellar-forge.feed-mcp-native-buyer-selection.v1' ||
      selected.productId !== state.productId || selected.intentId !== state.intentId ||
      selected.snapshot !== snapshot || selected.query !== firstPageQuery || selected.acceptIndex !== 0 ||
      !/^[a-f0-9]{64}$/.test(selected.offerSha256 ?? ''))
    throw failure('NATIVE_BUYER_SELECTION_CHANGED', 'Continue the complete original saved buyer selection.');
  if (selected.review) {
    const parameters = new URLSearchParams(selected.review.query); parameters.delete('snapshot');
    if (selected.review.snapshot !== selected.snapshot || parameters.toString() !== selected.query ||
        selected.review.offerSha256 !== selected.offerSha256 || typeof selected.review.url !== 'string')
      throw failure('NATIVE_BUYER_REVIEW_CHANGED', 'Continue the retained original review and offer bytes.');
  }
  const matches = records.filter(record => originalFields(record) && record.offerSha256 === selected.offerSha256);
  const savedId = state.buyer?.id ?? selected.originalBuyerId;
  let buyer;
  if (savedId) {
    buyer = matches.find(record => record.id === savedId);
    const expectedConfig = state.buyer?.configSha256 ?? selected.originalConfigSha256;
    if (!buyer || expectedConfig && buyer.configSha256 !== expectedConfig)
      throw failure('NATIVE_BUYER_CONFIGURATION_CHANGED', 'The original saved buyer differs from its native configuration.');
  } else {
    if (matches.length > 1)
      throw failure('NATIVE_BUYER_SELECTION_AMBIGUOUS', 'Retain the original saved buyer ID before selecting among these configurations.');
    buyer = matches[0];
  }
  const recoveredFromIndex = Boolean(buyer);
  if (!buyer) {
    if (!selected.review)
      throw failure('NATIVE_BUYER_REVIEW_REQUIRED', 'Recover the original saved buyer or its retained preparation review.');
    const prepared = (await seller('publisher.buyer.prepare', { review: selected.review,
      intentId: selected.intentId, acceptIndex: selected.acceptIndex, offerSha256: selected.offerSha256 })).result;
    buyer = prepared.buyer;
  }
  if (!originalFields(buyer) || buyer.offerSha256 !== selected.offerSha256 ||
      typeof buyer.id !== 'string' || state.buyer?.id && buyer.id !== state.buyer.id)
    throw failure('NATIVE_BUYER_CONFIGURATION_CHANGED', 'The prepared buyer differs from the original intent and reviewed offer.');
  state.buyer = structuredClone(buyer);
  state.sdk.publisherBuyer = { buyer: structuredClone(buyer), recoveredFromIndex,
    observedAt: new Date().toISOString() };
  await save(); // Export and download always use this exact original saved ID and config SHA.
  return { buyer, selection: selected };
}
async function readAll(workspace, input) {
  const items = [], pages = [];
  for await (const resolved of sdk(workspace).readPages(input)) {
    if (!Array.isArray(resolved.native.items)) throw failure('NATIVE_PAGE_CHANGED', 'Read the original native item page.');
    items.push(...resolved.native.items);
    pages.push({ offset: resolved.native.offset ?? null, nextOffset: resolved.native.nextOffset,
      snapshot: resolved.native.snapshot ?? null, items: resolved.native.items.length,
      manifestSha256: resolved.delivery?.manifestSha256 ?? null });
  }
  return { items, pages };
}
async function sdkCliResult(key, args) {
  const directory = join(root, 'sdk-cli'); await mkdir(directory, { recursive: true, mode: 0o700 });
  const output = join(directory, key + '.json');
  try { return JSON.parse(await readFile(output, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await runChild('sdk-cli-' + key, node, [sdkCli, ...args, '--output', output, '--quiet'],
    { ...privateEnv, FEED_NATIVE_MCP: token });
  return JSON.parse(await readFile(output, 'utf8'));
}
async function sdkPlan() {
  const reply = await recorded('research', 'complete-subscription-plan', 'merchant_feeds_read',
    { kind: 'subscription-plan', id: sourceHash }, { family: 'collection', operationId: 'b028-newsblur-intake' });
  const resolved = await sdk('research').resolveResult(reply);
  if (resolved.native.source?.sourceId !== sourceHash || resolved.native.entries?.length !== 573)
    throw failure('NATIVE_OPML_CHANGED', 'The complete SDK result differs from all original subscriptions.');
  if (resolved.delivery) state.sdk.completeResults[resolved.delivery.exportId] = {
    exportId: resolved.delivery.exportId, manifestSha256: resolved.delivery.manifestSha256,
    directory: resolved.delivery.directory, resultPath: resolved.delivery.resultPath, bytes: resolved.delivery.bytes };
  const record = state.sdk.requests['complete-subscription-plan'];
  const reconciled = await sdk('research').reconcile({ directory: record.directory });
  if (reconciled.operation?.id !== 'b028-newsblur-intake' || reconciled.operation?.family !== 'collection' ||
      reconciled.operation?.result?.sourceId !== sourceHash) throw failure('NATIVE_SDK_RECOVERY_CHANGED', 'Reconcile the original OPML intake ledger.');
  const local = await sdkCliResult('complete-subscription-plan-request', ['inspect-request', '--record', record.directory]);
  if (local.state !== 'RESPONSE_RETAINED' || local.request.requestSha256 !== record.requestSha256)
    throw failure('NATIVE_SDK_CLI_RECORD', 'The installed CLI reopened a different original request.');
  await phase('sdk-complete-source-and-request-recovery', { entries: resolved.native.entries.length,
    originalSourceSha256: sourceHash, requestSha256: record.requestSha256, recordState: local.state,
    originalOperationId: reconciled.operation.id, resultTransport: resolved.delivery ? 'complete-result.json' : 'inline',
    ...(resolved.delivery ? { exportId: resolved.delivery.exportId, manifestSha256: resolved.delivery.manifestSha256,
      resultBytes: resolved.delivery.bytes } : {}) });
  return resolved.native;
}
async function verifySource() {
  const checked = [], selectedPath = join(sourceRoot, 'sdk-receiving-source.json');
  const selectionBytes = await readFile(selectedPath);
  const selectionBlob = createHash('sha1').update('blob ' + selectionBytes.length + '\0').update(selectionBytes).digest('hex');
  if (selectionBlob !== SOURCE_SELECTION_BLOB) throw failure('NATIVE_SOURCE_SELECTION_CHANGED', 'Retain the complete adopted original source selection.');
  const selection = JSON.parse(selectionBytes);
  if (selection.schema !== 'stellar-forge.feed-mcp-sdk-source-selection.v1' ||
      selection.operationId !== 'scf-feed-mcp-native-b028-20261012' || selection.project !== projectRoot ||
      selection.sourceRoot !== sourceRoot || selection.sdkSourceCommit !== SDK_SOURCE_COMMIT ||
      selection.filesCount !== 341 || selection.files.length !== 341 ||
      selection.overlay.length !== Object.keys(SDK_SOURCE_FILES).length ||
      selection.overlay.some(file => SDK_SOURCE_FILES[file.path] !== file.sha))
    throw failure('NATIVE_SOURCE_SELECTION_CHANGED', 'Use the original donor plus the exact complete SDK adoption.');
  if (await realpath(sourceRoot) !== sourceRoot || await realpath(join(sourceRoot, 'node_modules')) !== selection.dependency.target)
    throw failure('NATIVE_SOURCE_PLACEMENT_CHANGED', 'Retain the original source and installed dependency placement.');
  for (const file of selection.files) {
    lifetime.signal.throwIfAborted();
    const path = join(sourceRoot, file.path), metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || await realpath(path) !== path)
      throw failure('NATIVE_SOURCE_FILE_CHANGED', 'Retain the original regular source file: ' + file.path);
    const bytes = await readFile(path);
    const actual = createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
    if (bytes.length !== file.bytes || actual !== file.sha)
      throw failure('NATIVE_SDK_SOURCE_CHANGED', 'Receive the complete original source at ' + file.path + '.');
    if (SDK_SOURCE_FILES[file.path]) checked.push({ path: file.path, sha: file.sha, bytes: file.bytes });
  }
  const originalInventory = await readFile(join(sourceRoot, selection.originalInventory.name));
  const inventoryBlob = createHash('sha1').update('blob ' + originalInventory.length + '\0').update(originalInventory).digest('hex');
  if (originalInventory.length !== selection.originalInventory.bytes || inventoryBlob !== selection.originalInventory.sha)
    throw failure('NATIVE_ORIGINAL_INVENTORY_CHANGED', 'Preserve the original 329-file donor inventory.');
  const opml = await readFile(join(projectRoot, 'feed-mcp-newsblur.opml'));
  if (opml.length !== 100070 || hash(opml) !== sourceHash) throw failure('NATIVE_OPML_CHANGED', 'The original selected OPML bytes changed.');
  return checked;
}

let terminal, workComplete = false;
const closed = [];
try {
 await mkdir(root, { recursive: true, mode: 0o700 });
 if (await realpath(root) !== root) throw failure('NATIVE_PRIVATE_ROOT', 'Keep the original canonical receiving workspace.');
 outputLease = await acquireStateLease(root);
 try { state = JSON.parse(await readFile(join(root, 'journey-state.json'), 'utf8')); }
 catch (error) {
  if (error.code !== 'ENOENT') throw error;
  state = { schema: 'stellar-forge.feed-mcp-native-journey.v1', startedAt: new Date().toISOString(),
   source: { url: 'https://github.com/benwerd/OPML/blob/HEAD/subscriptions.opml', sha256: sourceHash, bytes: 100070 },
   phases: [], productId: randomUUID(), intentId: randomUUID() };
 }
 if (state.schema !== 'stellar-forge.feed-mcp-native-journey.v1' || state.source?.sha256 !== sourceHash)
  throw failure('NATIVE_ORIGINAL_STATE', 'Keep the original B028 source and receiving journal.');
 state.sdk ??= { schema: 'stellar-forge.feed-mcp-sdk-receiving.v1', requests: {}, completeResults: {}, reconciliations: [] };
 state.sdk.requests ??= {}; state.sdk.completeResults ??= {}; state.sdk.reconciliations ??= [];
 const sourceFiles = await verifySource();
 attempt = { id: randomUUID(), startedAt: new Date().toISOString(), originalDriverBlob: ORIGINAL_DRIVER_BLOB,
  sdkSourceCommit: SDK_SOURCE_COMMIT, sourceSelectionBlob: SOURCE_SELECTION_BLOB, sourceFiles, state: 'RUNNING' };
 state.attempts ??= []; state.attempts.push(attempt);
 state.sdk.sourceCommit = SDK_SOURCE_COMMIT;
 await save();
 const launchResearch=await startConsole('research'),launchReceiving=await startConsole('receiving');
 for(const name of ['exports','complete-results','downloads'])await mkdir(join(root,name),{mode:0o700,recursive:true});
 const require=createRequire(join(sourceRoot,'package.json'));
 const {Asset,Networks,Keypair}=require('@stellar/stellar-sdk');
 state.payment??={scheme:'exact',network:'stellar:testnet',amount:'1000',asset:Asset.native().contractId(Networks.TESTNET),
  payTo:Keypair.random().publicKey(),maxTimeoutSeconds:300};
 const connection={schema:'stellar-forge.feeds-workspace-connection.v1',workspaces:{
  research:{label:'Original NewsBlur research',consoleUrlFile:join(root,'research-launch.json'),
   files:{newsblur:{path:join(projectRoot,'feed-mcp-newsblur.opml'),kind:'opml',sha256:sourceHash}},
   merchantProfiles:{research:{label:'Native research dataset',origin:'https://feeds.example.invalid',path:'/research',payment:state.payment}},runtime:{port:0}},
  receiving:{label:'Independent received collection',consoleUrlFile:join(root,'receiving-launch.json')}}};
 await privateReplace(join(root, 'connections.json'), json(connection));
 const registered=await openMcp();await phase('original-consoles-and-mcp',{registered,sourceBinding:launchResearch.bindingSha256,receivingBinding:launchReceiving.bindingSha256});
 if(!state.opmlImported){
  const prior=await lookup('research','b028-newsblur-intake','collection');
  if(!prior){
   const accepted = await original(await recorded('research', 'original-opml-intake', 'merchant_feeds_intake',
    { file: 'newsblur', operationId: 'b028-newsblur-intake' }, { family: 'collection', operationId: 'b028-newsblur-intake' }));
   await waitOriginal('research', accepted.id);
  }
  const complete=await lookup('research','b028-newsblur-intake','collection');
  if(complete?.state!=='RESULT_RETAINED'||complete.result.sourceId!==sourceHash||complete.result.entries.length!==573)
   throw new Error('Original NewsBlur intake differs');
  state.opmlImported=true;await phase('complete-original-opml',{bytes:100070,subscriptions:573,sourceSha256:sourceHash});
 }
 const fullPlan = await sdkPlan();
 if(!state.collection){
  const paged = await readAll('research', { kind: 'subscription-plan', id: sourceHash, array: 'entries', limit: 250 });
  const entries = paged.items;
  if (!sameJson(entries, fullPlan.entries)) throw failure('NATIVE_PLAN_PAGES_CHANGED', 'Original snapshot pages differ from the complete selected subscription plan.');
  state.sdk.subscriptionPages = paged.pages;
  if(entries.length!==573)throw new Error('Subscription plan did not retain every source entry');
  const selectedUrls=['https://jvns.ca/atom.xml','https://simonwillison.net/atom/everything/'];
  const selected=selectedUrls.map(url=>{const entry=entries.find(e=>e.url===url);if(!entry)throw new Error('Selected original source absent: '+url);return entry;});
  const newFeeds=Object.fromEntries(selected.map((e,index)=>['research-'+index,{url:e.url,label:e.title||e.text||e.url,
   allowedOrigins:[new URL(e.url).origin],rssIdentity:'guid'}]));
  const members=selected.map((e,index)=>({sourceId:sourceHash,entryId:e.entryId,feedId:'research-'+index,enabled:true}));
  state.collection=await action('research','collection-save',{collectionId:'research-library',title:'Public technical research',
   members,newFeeds,expectedRevision:0,operationId:'b028-research-library-save'},'collection');
  await phase('source-selection',{originalEntries:entries.length,enabled:2,urls:selectedUrls,revision:state.collection.revision});
 }
 if(!state.captured){
  const result=await action('research','collection-capture',{collectionId:'research-library',expectedRevision:state.collection.revision,
   expectedRevisions:{'research-0':1,'research-1':1},operationId:'b028-research-library-capture',pageLimit:1,force:false},'collection');
  if(result.state!=='CAPTURED')throw new Error('Original collection acquisition is '+result.state);
  state.captured=result;await phase('public-feed-acquisition',{runId:result.id,feeds:result.items.map(x=>({feedId:x.feedId,captureId:x.captureId,state:x.state}))});
 }
 if(!state.applied){
  const applications=[];
  for(const item of state.captured.items){
   const review=await original(await call('merchant_feeds_read',{workspace:'research',kind:'review',id:item.captureId,limit:250}));
   if(Object.entries(review.counts).some(([kind,count])=>/conflict|ambigu/i.test(kind)&&count))throw new Error('Original source review requires an explicit conflict choice');
   const applied=await action('research','apply',{captureId:item.captureId,expectedRevision:review.feed.revision,
    operationId:'b028-apply-'+item.feedId,decisions:{},acceptIdentity:false});
   applications.push(applied);
   const requests = await readAll('research', { kind: 'requests', id: item.captureId, limit: 250 });
   state.http ??= [];
   state.http = state.http.filter(row => row.captureId !== item.captureId);
   state.http.push({ feedId: item.feedId, captureId: item.captureId, requests: requests.items, pages: requests.pages });
  }
  state.applied=applications;await phase('original-review-and-apply',{applications:applications.map(x=>({feedId:x.feedId,revision:x.revision})),
   requests:state.http.flatMap(x=>x.requests).map(x=>({url:x.url,status:x.status,bytes:x.bytes,sourceSha256:x.sourceSha256}))});
 }
 const fields=['key','id','title','link','published','updated','summary','feed_id','source_sha256'];
 if(!state.edition){
  state.edition=await action('research','collection-edition',{runId:state.captured.id,name:'Public technical research',fields,
   expectedRevisions:Object.fromEntries(state.applied.map(x=>[x.feedId,x.revision])),operationId:'b028-research-library-edition'},'collection');
  await phase('native-collection-edition',{bindingId:state.edition.binding.id,editionId:state.edition.edition.id,rowCount:state.edition.edition.rowCount});
 }
 const editionId=state.edition.edition.id;
 const query=await action('research','query',{editionId,params:{fields:'key,title,link',sort:'title',limit:'5'}});
 if(!state.query){state.query=query;await phase('native-dataset-query',{rows:query.data?.length??query.rows?.length??null});}
 if(!state.delivery){
  state.delivery = await sdk('research').export({ kind: 'collection-project', id: state.edition.binding.id, operationId: 'b028-collection-delivery' });
  await phase('complete-collection-export',{exportId:state.delivery.exportId,manifestSha256:state.delivery.manifestSha256});
 }
 const downloadOptions = { exportId: state.delivery.exportId, directory: join(root, 'downloads', 'research-collection'),
  chunkSize: 32768, expectedManifestSha256: state.delivery.manifestSha256 };
 const inspected = await sdk('research').inspectDelivery({ exportId: state.delivery.exportId,
  expectedManifestSha256: state.delivery.manifestSha256 });
 if (inspected.manifest.workspace !== 'research' || inspected.manifest.kind !== 'collection-project' ||
     inspected.manifest.selection.id !== state.edition.binding.id)
  throw failure('NATIVE_COLLECTION_MANIFEST', 'Receive the exact original collection binding.');
 if(!state.downloadInterrupted){
  const abort = new AbortController(); let interrupted, previouslyCompleted;
  try {
   previouslyCompleted = await sdk('research').downloadDelivery({ ...downloadOptions, chunkSize: 1024, onProgress: progress => {
    if (!interrupted && progress.bytes > 0 && progress.bytes < progress.total) {
     interrupted = { at: new Date().toISOString(), file: progress.file, bytes: progress.bytes, total: progress.total };
     abort.abort(failure('NATIVE_RETAINED_DOWNLOAD_INTERRUPTION', 'Reopen this same original durable file prefix.'));
    }
   } }, { signal: abort.signal });
  } catch (error) {
   if (!interrupted || !abort.signal.aborted) throw error;
   state.downloadInterrupted = { ...interrupted, code: error.code ?? error.name,
    exportId: state.delivery.exportId, manifestSha256: state.delivery.manifestSha256 };
   await save();
  }
  if (!state.downloadInterrupted) {
   if (previouslyCompleted?.state !== 'COMPLETE') throw failure('NATIVE_DOWNLOAD_INCOMPLETE', 'Inspect the retained original transfer.');
   state.sdk.previouslyCompletedDownload = previouslyCompleted; await save();
  }
 }
 const originalEndpoint = endpoint, originalPort = port;
 await drain('merchant-mcp-before-original-reopen', closeMcp);
 await stopConsole('research');
 const reopened = await startConsole('research');
 await openMcp();
 if (endpoint !== originalEndpoint || port !== originalPort)
  throw failure('NATIVE_MCP_ENDPOINT_CHANGED', 'Resume the saved delivery on its original MCP endpoint.');
 const resumed = await sdk('research').downloadDelivery(downloadOptions);
 if (resumed.state !== 'COMPLETE' || state.downloadInterrupted && (!resumed.resumed || resumed.resumedBytes < state.downloadInterrupted.bytes))
  throw failure('NATIVE_DOWNLOAD_PREFIX_CHANGED', 'Continue the exact durable original download prefix.');
 const local = await sdk('research').reopenDelivery({ directory: resumed.directory, exportId: resumed.exportId,
  expectedManifestSha256: resumed.manifestSha256, expectedEndpoint: originalEndpoint });
 if (local.state !== 'REOPENED' || local.manifestSha256 !== inspected.manifestSha256 ||
     !sameJson(local.manifest.files, inspected.manifest.files))
  throw failure('NATIVE_DOWNLOAD_REOPEN_CHANGED', 'The original completed files changed on local reopen.');
 const cliDownload = await sdkCliResult('collection-download-reopen', ['reopen', '--workspace', 'research',
  '--directory', resumed.directory, '--export', resumed.exportId, '--manifest-sha256', resumed.manifestSha256,
  '--expected-endpoint', originalEndpoint]);
 if (cliDownload.state !== 'REOPENED' || cliDownload.manifestSha256 !== local.manifestSha256 ||
     cliDownload.files !== local.files || cliDownload.bytes !== local.bytes)
  throw failure('NATIVE_DOWNLOAD_CLI_CHANGED', 'The installed CLI reopened a different original delivery.');
 state.download = resumed;
 state.sdk.download = { sourceEndpoint: originalEndpoint, sourcePort: originalPort, interruption: state.downloadInterrupted ?? null,
  completed: resumed, local, cli: cliDownload };
 await phase('complete-sdk-download-after-restart', { ...resumed, sourceBinding: reopened.bindingSha256,
  completeFiles: local.manifest.files, cliState: cliDownload.state, originalPort });
 if(!state.received){
  const prior=await lookup('receiving','b028-receive-collection','collection');
  if(prior?.state!=='RESULT_RETAINED'){
   const accepted = await original(await recorded('receiving', 'original-collection-receive', 'merchant_feeds_receive',
    { fromWorkspace: 'research', exportId: state.delivery.exportId, operationId: 'b028-receive-collection' },
    { family: 'collection', operationId: 'b028-receive-collection' }));
   await waitOriginal('receiving', accepted.id);
  }
  const result=await lookup('receiving','b028-receive-collection','collection');
  if(result?.state!=='RESULT_RETAINED')throw new Error('Original collection receiving did not finish');
  state.received=result.result;
  await phase('original-customer-receiving',{operationId:result.id,state:result.state});
 }
 await stopConsole('receiving');await startConsole('receiving');
 const receivingQuery=await action('receiving','query',{editionId,params:{fields:'key,title,link',sort:'title',limit:'5'}});
 if(JSON.stringify(query)!==JSON.stringify(receivingQuery))throw new Error('Reopened received edition query differs');
 await phase('received-workspace-reopen',{editionId,querySha256:hash(json(receivingQuery))});
 if(!state.prepared){
  state.prepared=await original(await call('merchant_feeds_publisher_prepare',{workspace:'research',productId:state.productId,editionId,profile:'research'}));
  await phase('native-publisher-preparation',{productId:state.productId,draftId:state.prepared.result.draft.id,snapshot:state.prepared.source.snapshot});
 }
 const draftId=state.prepared.result.draft.id,snapshot=state.prepared.source.snapshot;
 const previewEnvelope=await seller('publisher.preview',{target:'draft:'+draftId,query:'fields=key,title,link&limit=5'});
 const preview=previewEnvelope.result;
 if(preview.status!==200)throw new Error('Original native draft query failed');
 await seller('publisher.release.stage',{draftId,id:'research-release',label:'Public technical research'});
 let publisherEnvelope=await seller('publisher.status',{});
 let pub=publisherEnvelope.state;
 if(pub.releases.state.active!=='research-release'){
  const generation=pub.releases.state.generation;
  await seller('publisher.release.activate',{id:'research-release',expectedGeneration:generation});
 }
 publisherEnvelope=await seller('publisher.status',{});pub=publisherEnvelope.state;
 const generation=pub.releases.state.generation;
 const startedEnvelope=await seller('publisher.release.start',{expectedGeneration:generation});
 const started=startedEnvelope.result;
 state.release={generation,started};await save();
 const { buyer, selection: buyerSelection } = await retainedPublisherBuyer(snapshot);
 const customerConfig = await call('merchant_feeds_publisher_export', { workspace: 'research', productId: state.productId,
  id: buyer.id, kind: 'buyer-config', operationId: 'b028-research-customer-config' });
 if (state.customerConfigExport && (state.customerConfigExport.exportId !== customerConfig.exportId ||
     state.customerConfigExport.manifestSha256 !== customerConfig.manifestSha256))
  throw failure('NATIVE_BUYER_EXPORT_CHANGED', 'Reopen the original saved buyer configuration delivery.');
 state.customerConfigExport = customerConfig; await save();
 state.customerConfig = await sdk('research').downloadDelivery({ exportId: customerConfig.exportId,
  directory: join(root, 'downloads', 'customer-config'), expectedManifestSha256: customerConfig.manifestSha256 });
 const customerConfigReopened = await sdk('research').reopenDelivery({ directory: state.customerConfig.directory,
  exportId: customerConfig.exportId, expectedManifestSha256: customerConfig.manifestSha256, expectedEndpoint: endpoint });
 const buyerFiles = customerConfigReopened.manifest.files;
 if (customerConfigReopened.manifest.kind !== 'publisher-buyer-config' ||
     customerConfigReopened.manifest.selection.productId !== state.productId ||
     customerConfigReopened.manifest.selection.id !== buyer.id || buyerFiles.length !== 1 ||
     buyerFiles[0].name !== 'buyer-request.json' || buyerFiles[0].sha256 !== buyer.configSha256)
  throw failure('NATIVE_BUYER_CONFIGURATION_CHANGED', 'Receive the exact saved original buyer configuration bytes.');
 state.sdk.customerConfig = customerConfigReopened;
 await seller('publisher.release.stop',{});
 await phase('native-publisher-and-customer',{productId:state.productId,draftId,snapshot,
  buyerId:buyer.id,offerSha256:buyerSelection.offerSha256,configSha256:buyer.configSha256,
  recoveredFromIndex:state.sdk.publisherBuyer.recoveredFromIndex,
  completeCustomerConfig:state.customerConfig.files,payments:0,signerConnected:false});
 const lookupOriginal=await lookup('research','b028-research-library-capture','collection');
 if(lookupOriginal.run?.id!==state.captured.id)throw new Error('Original operation lookup lost its exact capture');
 await phase('original-operation-recovery',{operationId:lookupOriginal.id,state:lookupOriginal.state,runId:lookupOriginal.run.id,historyOnly:lookupOriginal.historyOnly});
 workComplete = true;
} catch (error) {
 firstError = error;
 if (typeof error.close === 'function') originalCleanups.set(error.close, () => error.close());
 process.exitCode = signalCode || 1;
 if (state) {
  state.failure = { code: error.code ?? error.name, message: error.message, at: new Date().toISOString(),
   ...(error.operation ? { operation: error.operation } : {}) };
  if (attempt) attempt.failure = state.failure;
 }
 await emit({ state: 'INCOMPLETE', error: state?.failure ?? { code: error.code ?? error.name, message: error.message } }, process.stderr).catch(() => {});
} finally {
 try {
  await drain('original-merchant-sdk-mcp-and-publishers', closeMcp);
  closed.push('merchant-sdk-mcp-and-owned-publisher');
  for (const [key, close] of originalCleanups) {
   await drain('original-client-request-cleanup', close); originalCleanups.delete(key);
  }
  for (const alias of [...nativeProcesses.keys()]) closed.push(await drain(alias, () => stopConsole(alias)));
  if (outputLease && state) {
   const complete = workComplete && !firstError && !signalCode && !outputError;
   const finishedAt = new Date().toISOString();
   if (attempt) Object.assign(attempt, { state: complete ? 'COMPLETE' : 'INCOMPLETE', closed, closedAt: finishedAt,
    closeObservations: [...closeObservations] });
   state.state = complete ? 'COMPLETE' : 'INCOMPLETE';
   if (complete) { state.completedAt = finishedAt; delete state.failure; }
   else if (!state.failure) state.failure = { code: outputError?.code ?? (signalCode ? 'NATIVE_INTERRUPTED' : 'NATIVE_INCOMPLETE'),
    message: outputError?.message ?? 'The original receiving owner stopped before completion.', at: finishedAt };
   terminal = { schema: state.schema, state: state.state, startedAt: state.startedAt,
    ...(complete ? { completedAt: state.completedAt } : { failure: state.failure }),
    source: state.source, phases: state.phases, editionId: state.edition?.edition?.id ?? null,
    collectionBindingId: state.edition?.binding?.id ?? null, download: state.download ?? null,
    customerConfig: state.customerConfig ?? null, productId: state.productId, sdk: state.sdk,
    originalDriverBlob: ORIGINAL_DRIVER_BLOB, sdkSourceCommit: SDK_SOURCE_COMMIT,
    payments: 0, signerConnected: false, closed, closedAt: finishedAt, closeObservations };
   await drain('original-receiving-journal', save);
   await drain('original-receiving-result', () => privateReplace(join(root, 'result.json'), json(terminal)));
   await emit({ state: terminal.state, result: join(root, 'result.json'), closed }).catch(() => {});
  }
 } finally {
  try { await outputLease?.close(); }
  catch (error) {
   process.exitCode = 1;
   await emit({ code: error.code ?? error.name, message: error.message, owner: 'original-output-lease' }, process.stderr).catch(() => {});
  }
  process.removeListener('SIGINT', onSigint); process.removeListener('SIGTERM', onSigterm);
  process.stdout.removeListener('error', onOutputError); process.stderr.removeListener('error', onOutputError);
  if (signalCode || outputError || firstError || !workComplete) process.exitCode = signalCode || 1;
 }
}
