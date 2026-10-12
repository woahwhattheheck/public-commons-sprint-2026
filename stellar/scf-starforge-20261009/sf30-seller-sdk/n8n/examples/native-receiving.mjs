#!/usr/bin/env node
// MIT. One real n8n import, original SF30 application Worker, retained recovery and operator journey.
import assert from 'node:assert/strict';
import { mkdir, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonical, digest, readJobMerchant } from '../../jobs/config.mjs';
import { executeJob } from '../../jobs/execution.mjs';
import { createAutomationWorkflow, prepareN8nMerchant, inspectN8nMerchant } from '../prepare.mjs';
import { openN8nMerchant } from '../merchant.mjs';
import { readDispatch, readDispatchResult, privateDirectory, writePrivate } from '../store.mjs';
import { startN8nWorkspace } from '../workspace/server.mjs';

const HELP = 'node examples/native-receiving.mjs --api-base http://127.0.0.1:5678/api/v1 --api-key-file /private/n8n-api-key --directory /private/NEW-merchant-journey\n'
  + 'Use an existing same-host n8n engine and its installed original SF30 dependency closure. The API key needs workflow:read, workflow:create, workflow:activate, workflow:deactivate and execution:read.\n'
  + 'The new private directory retains the selected source, imported workflow IDs, actual execution, result, dispatch and operator export. Keep it on the same host for reopen.\n';
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  if (process.argv[i] === '--help') { process.stdout.write(HELP); process.exit(0); }
  const key = process.argv[i], value = process.argv[i + 1];
  if (!['--api-base', '--api-key-file', '--directory'].includes(key) || !value || value.startsWith('--') || args.has(key))
    throw new Error(HELP);
  args.set(key, value);
}
if (args.size !== 3) throw new Error(HELP);
const apiBase = new URL(args.get('--api-base'));
if (!['https:', 'http:'].includes(apiBase.protocol) || apiBase.username || apiBase.password || apiBase.search || apiBase.hash ||
    !apiBase.pathname.replace(/\/$/, '').endsWith('/api/v1') ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(apiBase.hostname))
  throw new Error('Use the actual same-host loopback n8n API ending in /api/v1.');
apiBase.pathname = apiBase.pathname.replace(/\/$/, '');
const engineRoot = new URL(apiBase);
engineRoot.pathname = apiBase.pathname.slice(0, -'/api/v1'.length);
const directory = args.get('--directory');
if (!isAbsolute(directory) || resolve(directory) !== directory || directory === '/' || await realpath(dirname(directory)) !== dirname(directory))
  throw new Error('Select a new absolute private directory under an existing canonical parent.');
const apiKeyFile = resolve(args.get('--api-key-file'));
const apiKey = (await readFile(apiKeyFile, 'utf8')).trim();
if (!apiKey || apiKey.length > 16384 || /[\r\n]/.test(apiKey)) throw new Error('The private API-key file is invalid.');
await mkdir(directory, { mode: 0o700 }); // Existing directories are never treated as a new operation.
await privateDirectory(directory, { create: false });

const secrets = [apiKey], createdWorkflows = [], abort = new AbortController();
const interrupt = () => abort.abort(Object.assign(new Error('Native receiving interrupted.'), { code: 'NATIVE_RECEIVING_INTERRUPTED' }));
process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
const runId = 'native-' + randomUUID(), functionId = 'invoiceSummary';
const receipt = {
  schema: 'stellar-forge.n8n-native-receiving.v1', operation: 'SCF-N8N-AUTOMATION-MERCHANT-20261012-3BDA',
  runId, directory, startedAt: new Date().toISOString(), phase: 'source', nodeVersion: process.version,
  apiBaseUrl: apiBase.href, apiKeyFile, engineVersion: null, workflows: [], artifacts: {}, cleanup: [],
};
let merchant, workspace, failure;
const redact = value => secrets.reduce((text, secret) => secret ? text.split(secret).join('[private]') : text, String(value));
const safeError = error => ({ code: String(error.code || 'NATIVE_RECEIVING_FAILED'), status: error.status ?? null, message: redact(error.message || error).slice(0,2000) });
async function save(name, value, replace = false) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
  await writePrivate(join(directory, name), bytes, { replace });
  receipt.artifacts[name] = { bytes: bytes.length, sha256: digest(bytes) };
  return bytes;
}
async function checkpoint(phase) {
  receipt.phase = phase; receipt.updatedAt = new Date().toISOString();
  await writePrivate(join(directory, 'native-receiving.json'), Buffer.from(JSON.stringify(receipt, null, 2) + '\n'), { replace: true });
  process.stdout.write(JSON.stringify({ runId, phase, directory }) + '\n');
}
async function bodyBytes(response, maximum = 32 * 1024 * 1024) {
  const chunks = []; let length = 0;
  if (!response.body) return Buffer.alloc(0);
  for await (const chunk of response.body) {
    length += chunk.byteLength;
    if (length > maximum) throw Object.assign(new Error('The native response exceeds the receiving limit.'), { code: 'NATIVE_RESPONSE_TOO_LARGE' });
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
async function api(path, { method = 'GET', body, cleanup = false } = {}) {
  if (!path.startsWith('/')) throw new Error('Native API paths must remain relative to the selected API.');
  const response = await fetch(apiBase.href + path, {
    method, redirect: 'error',
    headers: { accept: 'application/json', 'X-N8N-API-KEY': apiKey, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: cleanup ? AbortSignal.timeout(30000) : AbortSignal.any([abort.signal, AbortSignal.timeout(30000)]),
  });
  const bytes = await bodyBytes(response);
  let result; try { result = bytes.length ? JSON.parse(bytes.toString('utf8')) : null; } catch { result = null; }
  if (!response.ok) throw Object.assign(new Error('n8n ' + method + ' ' + path.split('?')[0] + ' returned HTTP ' + response.status +
    (typeof result?.message === 'string' ? ': ' + redact(result.message) : '')), { code: 'N8N_HTTP_' + response.status, status: response.status });
  if (result === null) throw Object.assign(new Error('The native API returned no JSON object.'), { code: 'N8N_JSON_REQUIRED' });
  return result;
}
function subset(expected, actual) {
  if (Array.isArray(expected)) return Array.isArray(actual) && expected.length === actual.length && expected.every((value, i) => subset(value, actual[i]));
  if (expected !== null && typeof expected === 'object') return actual !== null && typeof actual === 'object' &&
    Object.entries(expected).every(([key, value]) => Object.hasOwn(actual, key) && subset(value, actual[key]));
  return Object.is(expected, actual);
}
function payload(workflow, name) {
  return { name, nodes: structuredClone(workflow.nodes), connections: structuredClone(workflow.connections), settings: structuredClone(workflow.settings ?? {}) };
}
async function findExactWorkflow(selected) {
  let cursor, pages = 0; const found = [];
  do {
    const response = await api('/workflows?limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
    if (!Array.isArray(response.data)) throw new Error('The native workflow list is invalid.');
    for (const row of response.data) if (row.name === selected.name) {
      const original = await api('/workflows/' + encodeURIComponent(row.id));
      if (subset(selected, original)) found.push(original);
    }
    cursor = response.nextCursor;
    if (++pages > 100) throw new Error('The native workflow list needs operator reconciliation.');
  } while (cursor);
  if (found.length !== 1) throw Object.assign(new Error('The original workflow-create response needs reconciliation against its retained name and import source.'), { code: 'NATIVE_CREATE_UNRESOLVED' });
  return found[0];
}
async function importWorkflow(kind, selected) {
  await save(kind + '-import.json', selected); await checkpoint('import-' + kind);
  let created;
  try { created = await api('/workflows', { method: 'POST', body: selected }); }
  catch (error) {
    if ((error.status && error.status < 500 && error.status !== 408) || abort.signal.aborted) throw error;
    created = await findExactWorkflow(selected);
  }
  assert.match(String(created.id), /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
  createdWorkflows.push({ kind, id: created.id, name: selected.name, published: false });
  receipt.workflows = createdWorkflows.map(row => ({ ...row }));
  await checkpoint('imported-' + kind);
  const readback = await api('/workflows/' + encodeURIComponent(created.id));
  assert.ok(subset(selected, readback), 'The native imported workflow must retain the selected source.');
  await save(kind + '-native-workflow.json', readback);
  return readback;
}
async function publishWorkflow(workflow, kind) {
  await checkpoint('publish-' + kind);
  const body = typeof workflow.versionId === 'string' ? { versionId: workflow.versionId } : {};
  let published;
  try { published = await api('/workflows/' + encodeURIComponent(workflow.id) + '/publish', { method: 'POST', body }); }
  catch (error) {
    const current = await api('/workflows/' + encodeURIComponent(workflow.id));
    const activeVersion = current.activeVersionId ?? current.activeVersion?.versionId;
    if (!(current.active === true || activeVersion) || body.versionId && activeVersion !== body.versionId) throw error;
    published = current;
  }
  createdWorkflows.find(row => row.id === workflow.id).published = true;
  receipt.workflows = createdWorkflows.map(row => ({ ...row }));
  await save(kind + '-published.json', published);
  await checkpoint('published-' + kind);
}
async function executionList(workflowId) {
  const rows = new Map();
  for (const status of ['', 'running']) {
    let cursor;
    do {
      const response = await api('/executions?workflowId=' + encodeURIComponent(workflowId) + '&limit=100' +
        (status ? '&status=' + status : '') + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
      if (!Array.isArray(response.data)) throw new Error('The native execution list is invalid.');
      for (const row of response.data) {
        assert.equal(String(row.workflowId), String(workflowId));
        rows.set(String(row.id), { id: String(row.id), workflowId: String(row.workflowId), status: row.status });
      }
      cursor = response.nextCursor;
      if (rows.size > 100) throw new Error('This receiving workflow has unexpected additional executions.');
    } while (cursor);
  }
  return [...rows.values()].sort((a,b) => a.id.localeCompare(b.id));
}
async function operator(path, { method = 'GET', body, authenticated = true, status = 200 } = {}) {
  const response = await fetch(workspace.origin + path, { method, redirect: 'error',
    headers: { ...(authenticated ? { authorization: 'Bearer ' + workspace.token } : {}), origin: workspace.origin,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
  const bytes = await bodyBytes(response); assert.equal(response.status, status, 'Original operator endpoint ' + path);
  const type = response.headers.get('content-type') ?? '';
  return { bytes, value: /json/i.test(type) ? JSON.parse(bytes.toString('utf8')) : bytes.toString('utf8'), type };
}
function invoiceExpected(input) {
  const lines = input.lines.map(line => ({ ...line, lineTotalMinor: Number(BigInt(line.quantity) * BigInt(line.unitPriceMinor)) }));
  const subtotal = lines.reduce((sum, line) => sum + BigInt(line.lineTotalMinor), 0n);
  const discount = BigInt(input.discountMinor ?? 0), taxable = subtotal - discount, rate = BigInt(input.taxBasisPoints ?? 0);
  const product = taxable * rate, tax = product / 10000n + (product % 10000n >= 5000n ? 1n : 0n);
  const result = { invoiceId: input.invoiceId, currency: input.currency, lineCount: lines.length,
    totalQuantity: input.lines.reduce((sum, line) => sum + line.quantity, 0), subtotalMinor: Number(subtotal),
    discountMinor: Number(discount), taxableMinor: Number(taxable), taxBasisPoints: Number(rate),
    taxMinor: Number(tax), totalMinor: Number(taxable + tax), rounding: 'invoice-tax-half-up', lines };
  for (const [key, value] of Object.entries(result)) if (typeof value === 'number') assert.ok(Number.isSafeInteger(value), key);
  return result;
}
function originalWebhook(execution, nodeName) {
  const runs = execution.data?.resultData?.runData?.[nodeName];
  assert.ok(Array.isArray(runs) && runs.length === 1, 'One original Webhook node run is required.');
  const outputs = runs[0].data?.main;
  assert.ok(Array.isArray(outputs) && outputs.length === 1 && outputs[0]?.length === 1);
  return outputs[0][0].json.body;
}

try {
  const sourceNames = ['example-merchant.json', 'example-input.json', 'example-child-workflow.json',
    'config.mjs', 'store.mjs', 'client.mjs', 'runtime.mjs', 'prepare.mjs', 'merchant.mjs', 'workspace/server.mjs'];
  const sourceManifest = [];
  const receivingSource = await readFile(import.meta.url.startsWith('file:') ? new URL(import.meta.url) : import.meta.url);
  await save('native-receiving-source.mjs', receivingSource);
  for (const path of sourceNames) {
    const bytes = await readFile(new URL('../' + path, import.meta.url));
    sourceManifest.push({ path, bytes: bytes.length, sha256: digest(bytes) });
  }
  await save('source-manifest.json', sourceManifest);
  const [configBytes, inputBytes, childBytes] = await Promise.all(['example-merchant.json','example-input.json','example-child-workflow.json']
    .map(name => readFile(new URL('../' + name, import.meta.url))));
  await save('original-merchant.json', configBytes); await save('original-input.json', inputBytes); await save('original-child-workflow.json', childBytes);
  const raw = JSON.parse(configBytes), input = JSON.parse(inputBytes), childSource = JSON.parse(childBytes);
  const expected = invoiceExpected(input); await save('expected-invoice.json', expected);
  assert.deepEqual(raw.automations[functionId].example, input);
  await checkpoint('native-access');
  const access = await api('/workflows?limit=1'); assert.ok(Array.isArray(access.data));
  try {
    const settingsUrl = new URL(engineRoot); settingsUrl.pathname += '/rest/settings';
    const response = await fetch(settingsUrl, { redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (response.ok) {
      const settings = JSON.parse((await bodyBytes(response, 1048576)).toString('utf8'));
      const version = settings.data?.versionCli ?? settings.versionCli;
      if (typeof version === 'string') receipt.engineVersion = version;
    }
  } catch { /* The receiving operator can also retain the installed engine's version output. */ }
  const child = await importWorkflow('child', payload(childSource, childSource.name + ' [' + runId + ']'));
  await publishWorkflow(child, 'child');
  raw.n8n.apiBaseUrl = apiBase.href;
  const webhook = new URL(engineRoot); webhook.pathname += '/webhook/starforge-' + runId;
  raw.automations[functionId].webhookUrl = webhook.href;
  raw.automations[functionId].webhookHeader = null;
  const generated = createAutomationWorkflow(raw, { functionId, childWorkflowId: String(child.id) });
  const wrapper = await importWorkflow('wrapper', payload(generated, generated.name + ' [' + runId + ']'));
  raw.automations[functionId].workflowId = String(wrapper.id);
  await publishWorkflow(wrapper, 'wrapper');
  await save('selected-merchant.json', raw);
  const merchantDirectory = join(directory, 'merchant');
  const prepared = await prepareN8nMerchant({ configPath: join(directory, 'selected-merchant.json'), directory: merchantDirectory });
  const env = { ...process.env, [raw.n8n.apiKeyEnvironment]: apiKey };
  const inspected = await inspectN8nMerchant(merchantDirectory, { env });
  assert.equal(inspected.configurationSha256, prepared.configurationSha256);
  assert.ok(inspected.environment.every(row => row.present));
  await save('prepared-merchant.json', prepared);
  merchant = await openN8nMerchant(merchantDirectory, { env });
  workspace = await startN8nWorkspace({ merchant, port: 0 }); secrets.push(workspace.token);
  const page = await operator('/', { authenticated: false });
  assert.match(page.type, /^text\/html/); await save('operator-page.html', page.bytes);
  await operator('/api/state', { authenticated: false, status: 401 });
  const initialState = (await operator('/api/state')).value;
  assert.equal(initialState.configuration.configurationSha256, prepared.configurationSha256);
  const created = (await operator('/api/jobs', { method: 'POST', status: 201,
    body: { functionId, input, label: 'Native invoice summary', reference: runId } })).value;
  secrets.push(created.claimToken);
  assert.equal(created.job.state, 'PREPARED'); assert.equal(created.job.id, runId);
  let selected = (await operator('/api/jobs/' + encodeURIComponent(runId))).value;
  assert.equal(selected.job.inputSha256, digest(canonical(input))); assert.equal(selected.dispatch, null);
  await save('prepared-job.json', selected.job);
  receipt.job = { id: runId, functionId, state: selected.job.state, inputSha256: selected.job.inputSha256 };
  await checkpoint('original-application-worker');
  const jobSource = await readJobMerchant(prepared.configPath), attemptId = randomUUID();
  const output = await executeJob(jobSource, selected.job, { id: attemptId }, { env, signal: abort.signal });
  const result = JSON.parse(output.toString('utf8')); assert.deepEqual(result, expected);
  await save('native-result.json', output);
  const dispatch = await readDispatch(prepared.dispatchDirectory, runId);
  assert.equal(dispatch.dispatches.length, 1);
  const active = dispatch.dispatches[0]; assert.equal(active.state, 'SUCCEEDED'); assert.ok(active.executionId);
  assert.equal(dispatch.workflowId, String(wrapper.id)); assert.equal(dispatch.inputSha256, selected.job.inputSha256);
  const retained = await readDispatchResult(prepared.dispatchDirectory, runId);
  assert.deepEqual(JSON.parse(retained.body), result); await save('retained-result.json', retained.body);
  await save('original-dispatch.json', dispatch);
  const execution = await api('/executions/' + encodeURIComponent(active.executionId) + '?includeData=true');
  assert.equal(String(execution.id), String(active.executionId)); assert.equal(String(execution.workflowId), String(wrapper.id));
  assert.equal(execution.status, 'success');
  const original = originalWebhook(execution, raw.automations[functionId].webhookNode);
  assert.equal(original.jobId, runId); assert.equal(original.attemptId, attemptId); assert.equal(original.dispatchId, active.id);
  assert.equal(original.inputSha256, selected.job.inputSha256); assert.equal(original.configurationSha256, prepared.configurationSha256);
  assert.deepEqual(original.input, input); await save('native-execution.json', execution);
  const before = { wrapper: await executionList(wrapper.id), child: await executionList(child.id) };
  assert.equal(before.wrapper.length, 1); assert.equal(before.wrapper[0].id, String(active.executionId));
  assert.equal(before.child.length, 1); assert.equal(before.child[0].status, 'success');
  await save('native-child-execution.json', await api('/executions/' + encodeURIComponent(before.child[0].id) + '?includeData=true'));
  await workspace.close(); workspace = null; await merchant.close(); merchant = null;
  await checkpoint('source-reopen-and-retained-worker');
  const reopened = await inspectN8nMerchant(merchantDirectory, { env });
  assert.equal(reopened.configurationSha256, inspected.configurationSha256);
  merchant = await openN8nMerchant(merchantDirectory, { env });
  workspace = await startN8nWorkspace({ merchant, port: 0 }); secrets.push(workspace.token);
  selected = (await operator('/api/jobs/' + encodeURIComponent(runId))).value;
  assert.equal(selected.job.state, 'PREPARED'); assert.deepEqual(selected.job.input, input);
  const reopenedSource = await readJobMerchant(prepared.configPath);
  assert.deepEqual(reopenedSource.identity, jobSource.identity);
  const recoveredOutput = await executeJob(reopenedSource, selected.job, { id: randomUUID() }, { env, signal: abort.signal });
  assert.ok(recoveredOutput.equals(output), 'A new original Worker must return the identical retained bytes.');
  const recoveredDispatch = await readDispatch(prepared.dispatchDirectory, runId);
  assert.equal(canonical(recoveredDispatch), canonical(dispatch), 'Recovery must preserve the original dispatch and execution.');
  const after = { wrapper: await executionList(wrapper.id), child: await executionList(child.id) };
  assert.deepEqual(after, before, 'Reopen must retain the same native executions.');
  await save('reopened-dispatch.json', recoveredDispatch);
  const renewed = (await operator('/api/jobs/' + encodeURIComponent(runId) + '/renew-claim', { method: 'POST',
    body: { expectedRevision: selected.job.revision, reason: 'Renew the original native receiving handoff after merchant reopen.' } })).value;
  secrets.push(renewed.claimToken);
  assert.notEqual(renewed.claimToken, created.claimToken); assert.equal(renewed.job.id, runId);
  assert.equal(renewed.job.state, 'PREPARED'); assert.equal(renewed.job.revision, selected.job.revision + 1);
  const exported = (await operator('/api/export')).value;
  const full = exported.jobs.jobs.find(row => row.id === runId);
  assert.ok(full && Object.hasOwn(full, 'input') && Array.isArray(full.history));
  assert.deepEqual(full.input, input); assert.equal(full.revision, renewed.job.revision);
  assert.ok(full.history.some(row => row.action === 'claim-renewed'));
  assert.equal(exported.dispatches.length, 1); assert.equal(exported.dispatches[0].dispatches[0].executionId, active.executionId);
  await save('operator-export.json', exported);
  receipt.application = { path: 'ORIGINAL_SF30_APPLICATION_WORKER', attemptId, resultBytes: output.length,
    resultSha256: digest(output), retainedResultSha256: retained.dispatch.result.sha256, configurationSha256: prepared.configurationSha256 };
  receipt.native = { wrapperWorkflowId: String(wrapper.id), childWorkflowId: String(child.id),
    executionId: String(active.executionId), childExecutionId: before.child[0].id, status: execution.status,
    dispatchId: active.id, executionsBeforeReopen: before, executionsAfterReopen: after };
  receipt.operator = { authenticationStatus: 401, stateStatus: 200, preparedJobId: runId,
    claimRevisionBefore: selected.job.revision, claimRevisionAfter: renewed.job.revision, fullRecordExported: true };
  receipt.recovery = { sourceIdentityPreserved: true, sameResultBytes: true, sameDispatch: true, sameNativeExecutions: true };
  receipt.status = 'PASSED';
} catch (error) {
  failure = error; receipt.status = 'FAILED'; receipt.error = safeError(error);
} finally {
  if (workspace) try { await workspace.close(); } catch (error) { receipt.cleanup.push({ service: 'operator', error: safeError(error) }); failure ??= error; }
  if (merchant) try { await merchant.close(); } catch (error) { receipt.cleanup.push({ service: 'merchant', error: safeError(error) }); failure ??= error; }
  for (const workflow of [...createdWorkflows].reverse()) {
    try {
      const current = await api('/workflows/' + encodeURIComponent(workflow.id), { cleanup: true });
      assert.equal(current.name, workflow.name, 'Cleanup retains the exact workflow created by this operation.');
      if (current.active === true || current.activeVersionId || current.activeVersion) {
        try { await api('/workflows/' + encodeURIComponent(workflow.id) + '/unpublish', { method: 'POST', body: {}, cleanup: true }); }
        catch (error) {
          const reconciled = await api('/workflows/' + encodeURIComponent(workflow.id), { cleanup: true });
          if (reconciled.active === true || reconciled.activeVersionId || reconciled.activeVersion) throw error;
        }
      }
      const retained = await api('/workflows/' + encodeURIComponent(workflow.id), { cleanup: true });
      assert.ok(retained.active !== true && !retained.activeVersionId && !retained.activeVersion);
      receipt.cleanup.push({ workflowId: String(workflow.id), state: 'retained-unpublished' });
    } catch (error) { receipt.cleanup.push({ workflowId: String(workflow.id), error: safeError(error) }); failure ??= error; }
  }
  process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
  if (failure) { receipt.status = 'FAILED'; receipt.error ??= safeError(failure); }
  receipt.finishedAt = new Date().toISOString(); await checkpoint(failure ? 'failed' : 'completed');
}
process.stdout.write(JSON.stringify({ schema: receipt.schema, status: receipt.status, runId, directory,
  engineVersion: receipt.engineVersion, native: receipt.native, application: receipt.application, recovery: receipt.recovery,
  receipt: join(directory, 'native-receiving.json'), ...(receipt.error ? { error: receipt.error } : {}) }, null, 2) + '\n');
if (failure) process.exitCode = 1;
