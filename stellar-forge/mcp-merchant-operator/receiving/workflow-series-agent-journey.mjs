#!/usr/bin/env node
// MIT. Continue a complete saved customer through the actual Merchant MCP provider.
import assert from 'node:assert/strict';
import { readFile, readdir, lstat, mkdir, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMerchantMcp } from '../serve.mjs';
import { MerchantConsoleStore } from '../console/store.mjs';
import { canonical } from '../console/records.mjs';
import { cycleId } from '../console/workflow-series-records.mjs';
import { reopenWorkflowSeriesHandover } from '../console/workflow-series-handover.mjs';
import { writeConsoleWorkflowFile, writeConsoleWorkflowStream, inspectConsoleWorkflowFile } from '../console/client-files.mjs';
import { nativeReceivingAccessToken } from './workflow-native-artifacts.mjs';
import { workflowSeriesPrivateDirectory } from '../workflow-series-connection.mjs';

const SCHEMA = 'stellar-forge.merchant-workflow-series-agent-receiving.v1';
const PREFIX = 'merchant_workflow_series_', VERSION = '2025-11-25';
const hash = value => createHash('sha256').update(value).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
function secondaryFailure(primary, stage, error) {
  if (primary === error) return;
  const detail = { stage, code: error.code ?? 'WORKFLOW_SERIES_AGENT_SECONDARY', message: error.message };
  try { (primary.secondaryErrors ??= []).push(detail); } catch {}
  process.stderr.write(JSON.stringify({ secondaryFailure: detail }) + '\n');
}
const inside = (parent, path) => path !== parent && !relative(parent, path).startsWith('..' + sep) &&
  relative(parent, path) !== '..' && !relative(parent, path).startsWith(sep);
const isoDay = value => value.toISOString().slice(0, 10);
async function optionalJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; return null; }
}
async function privateTree(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  return workflowSeriesPrivateDirectory(path);
}
async function cloneOriginal(source, destination) {
  await privateTree(destination);
  for (const entry of (await readdir(source, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const from = join(source, entry.name), to = join(destination, entry.name);
    const info = await lstat(from);
    assert.ok(!info.isSymbolicLink(), 'Retain the original regular source files.');
    if (info.isDirectory()) await cloneOriginal(from, to);
    else {
      assert.ok(info.isFile(), 'Retain the complete original regular-file archive.');
      const bytes = await readFile(from);
      await writeConsoleWorkflowFile(to, bytes);
    }
  }
}
function relocate(value, original, destination) {
  if (typeof value === 'string') return value === original ? destination :
    value.startsWith(original + '/') ? destination + value.slice(original.length) : value;
  if (Array.isArray(value)) return value.map(item => relocate(item, original, destination));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .map(([key, item]) => [key, relocate(item, original, destination)]));
  return value;
}
async function receiveNativeDeliveryPaths({ original, owned, releaseStore, state, save }) {
  assert.ok(inside(owned, releaseStore), 'Keep the received release store inside this complete customer.');
  const directory = join(releaseStore, 'settlement-delivery');
  for (const name of ['binding.json', 'producer.json']) {
    const path = join(directory, name);
    let bytes;
    try { bytes = await readFile(path); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const record = JSON.parse(bytes);
    assert.equal(record.schema, 'stellar-forge.native-settlement-delivery.v1');
    assert.equal(typeof record.sourceDirectory, 'string');
    const target = relocate(record.sourceDirectory, original.directory, owned);
    if (target === record.sourceDirectory) continue;
    assert.ok(inside(owned, target), 'Receive the complete original outbox within this customer.');
    await workflowSeriesPrivateDirectory(target);
    assert.ok((await lstat(path)).isFile() && !(await lstat(path)).isSymbolicLink());
    const next = Buffer.from(JSON.stringify({ ...record, sourceDirectory: target }, null, 2) + '\n');
    const relativePath = relative(owned, path).split(sep).join('/');
    state.nativePathReceivings ??= [];
    let receiving = state.nativePathReceivings.find(value => value.path === relativePath);
    if (!receiving) {
      receiving = { path: relativePath, sourceDirectory: record.sourceDirectory, receivedDirectory: target,
        previousJson: bytes.toString('utf8'), previousSha256: hash(bytes), receivedSha256: hash(next) };
      state.nativePathReceivings.push(receiving); await save();
    }
    assert.equal(receiving.previousSha256, hash(bytes));
    assert.equal(receiving.receivedSha256, hash(next));
    await writeFile(path + '.agent-receiving.tmp', next, { mode: 0o600 });
    await rename(path + '.agent-receiving.tmp', path);
    receiving.completedAt ??= new Date().toISOString(); await save();
  }
}
function mcpClient(host, token) {
  let id = 0;
  const rpc = async (method, params) => {
    const response = await fetch(host.url + '/mcp', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json',
        accept: 'application/json, text/event-stream', 'mcp-protocol-version': VERSION },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
      signal: AbortSignal.timeout(145000),
    });
    const packet = await response.json();
    if (!response.ok || packet.error) throw Object.assign(new Error(
      packet.error?.message ?? 'The original Merchant MCP response was not completed.'), {
      code: packet.error?.code ?? 'WORKFLOW_SERIES_MCP_HTTP', status: response.status, response: packet,
    });
    const value = packet.result;
    if (value?.isError) {
      const detail = value.structuredContent ?? JSON.parse(value.content.find(item => item.type === 'text').text);
      throw Object.assign(new Error(detail.reason ?? detail.message ?? detail.code), detail);
    }
    return method === 'tools/call' ? value.structuredContent ??
      JSON.parse(value.content.find(item => item.type === 'text').text) : value;
  };
  return {
    initialize: () => rpc('initialize', { protocolVersion: VERSION, capabilities: {},
      clientInfo: { name: 'merchant-workflow-series-receiving', version: '1.0.0' } }),
    call: (action, input = {}, console = 'operations') => rpc('tools/call', {
      name: PREFIX + action, arguments: action === 'connections' ? {} : { console, ...input },
    }),
  };
}
async function readAllPeriods(call, seriesId) {
  let offset = 0, selected;
  const cycles = [];
  for (;;) {
    const page = await call('get', { id: seriesId, offset, limit: 100 });
    selected ??= page.series;
    assert.equal(page.series.contentSha256, selected.contentSha256);
    cycles.push(...page.cycles);
    if (page.nextOffset === null) return { series: selected, cycles, total: page.total };
    assert.ok(page.nextOffset > offset); offset = page.nextOffset;
  }
}
async function retainedCalls(call, run) {
  const calls = [];
  for (const step of run.steps) {
    const value = await call('call', { id: step.resolvedCallId ?? step.callId });
    assert.equal(value.state, 'COMPLETE'); assert.equal(value.profileId, run.profileId);
    assert.equal(hash(value.argumentsJson), value.argumentsSha256);
    assert.equal(hash(value.resultJson), value.resultSha256); calls.push(value);
  }
  return calls;
}
async function copyHandover(call, selection, description, destination) {
  await privateTree(destination);
  const files = [];
  for (const file of description.files) {
    const output = resolve(destination, file.path);
    assert.ok(inside(destination, output), 'Receive a complete original handover member.');
    await privateTree(dirname(output));
    let retained;
    try { retained = await inspectConsoleWorkflowFile(output, file); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (retained) {
      assert.equal(retained.bytes, file.bytes); assert.equal(retained.sha256, file.sha256);
      files.push({ path: file.path, ...retained }); continue;
    }
    let readId, primary;
    try {
      const result = await writeConsoleWorkflowStream(output, async handle => {
        const digest = createHash('sha256'); let bytes = 0;
        for (;;) {
          const part = await call('handover_file', { ...selection,
            expectedContentSha256: description.contentSha256, file: file.path, expectedSha256: file.sha256,
            offset: bytes, limit: 65536, ...(readId ? { readId } : {}) });
          assert.equal(part.offset, bytes); assert.equal(part.file.sha256, file.sha256);
          assert.equal(part.file.bytes, file.bytes);
          assert.equal(part.encoding, 'base64');
          if (readId) assert.equal(part.readId, readId); else readId = part.readId;
          const chunk = Buffer.from(part.data, 'base64');
          assert.equal(chunk.length, part.bytesRead); assert.ok(bytes + chunk.length <= file.bytes);
          await handle.writeFile(chunk); digest.update(chunk); bytes += chunk.length;
          if (part.nextOffset === null) break;
          assert.ok(chunk.length > 0); assert.equal(part.nextOffset, bytes);
        }
        const sha256 = digest.digest('hex');
        assert.equal(bytes, file.bytes); assert.equal(sha256, file.sha256);
        return { bytes, sha256 };
      });
      files.push({ path: file.path, bytes: result.bytes, sha256: result.sha256 });
    } catch (error) { primary = error; throw error; }
    finally {
      if (readId) try { await call('handover_file_release', { ...selection, readId }); }
      catch (error) { if (!primary) throw error; secondaryFailure(primary, 'handover file release', error); }
    }
  }
  return files;
}

/**
 * Receive one further linked period from the complete original two-period
 * customer archive. All business work uses the original Console engine through
 * the configured MCP provider, including when that provider is on the same host.
 */
export async function receiveMerchantWorkflowSeriesAgent({
  originalDirectory, directory, sourceCommit, openSession = startMerchantMcp,
} = {}) {
  assert.ok(originalDirectory && directory, 'Select the complete original archive and an owned continuation directory.');
  assert.match(sourceCommit ?? '', /^[a-f0-9]{40}$/);
  originalDirectory = resolve(originalDirectory); directory = resolve(directory);
  assert.ok(originalDirectory !== directory && !inside(originalDirectory, directory) && !inside(directory, originalDirectory));
  await workflowSeriesPrivateDirectory(originalDirectory); await privateTree(directory);
  const originalBytes = await readFile(join(originalDirectory, 'workflow-series-native-run.json'));
  const original = JSON.parse(originalBytes);
  assert.equal(original.schema, 'stellar-forge.merchant-workflow-series-native-receiving.v1');
  assert.equal(original.result, 'PASS'); assert.equal(original.periods.length, 2);
  const originalHandover = await reopenWorkflowSeriesHandover({ directory: join(originalDirectory, 'series-customer-handover') });
  assert.equal(originalHandover.contentSha256, original.handover.contentSha256);
  const checkpoint = join(directory, 'workflow-series-agent-checkpoint.json'), suffix = hash(directory).slice(0, 18);
  const state = await optionalJson(checkpoint) ?? {
    schema: SCHEMA, operationId: 'workflow-series-agent-' + suffix, originalOperationId: original.operationId,
    originalDirectory, directory, originalReportSha256: hash(originalBytes), originalHandoverSha256: originalHandover.contentSha256,
    profileId: original.profileId, seriesId: original.seriesId, sourceSelections: [], requests: {},
    workspaceIds: { operations: original.workspaces.receiver }, result: 'RUNNING',
    handoverId: 'customer-agent-' + suffix, draftId: 'agent-before-' + suffix, workflowId: 'agent-workflow-' + suffix,
    startedAt: new Date().toISOString(),
  };
  assert.equal(state.schema, SCHEMA); assert.equal(state.originalOperationId, original.operationId);
  assert.equal(state.originalDirectory, originalDirectory); assert.equal(state.directory, directory);
  assert.equal(state.originalReportSha256, hash(originalBytes));
  const save = async () => {
    const temporary = checkpoint + '.tmp';
    await writeFile(temporary, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
    await rename(temporary, checkpoint);
  };
  const freeze = async (name, value) => {
    if (state.requests[name]) assert.deepEqual(state.requests[name], value, 'Continue the saved complete ' + name + '.');
    else { state.requests[name] = value; await save(); }
    return state.requests[name];
  };
  const retain = async (name, value) => writeConsoleWorkflowFile(join(directory, name), value);
  const emit = async (stage, detail = {}) => {
    state.stage = stage; await save();
    process.stdout.write(JSON.stringify({ operationId: state.operationId, stage, ...detail }) + '\n');
  };
  const root = fileURLToPath(new URL('../../../', import.meta.url)), sourceFiles = [];
  for (const path of [
    'stellar-forge/mcp-paid-agent/http-tools.mjs',
    'stellar-forge/mcp-merchant-operator/catalog/workflow-series.mjs',
    'stellar-forge/mcp-merchant-operator/workflow-series-connection.mjs',
    'stellar-forge/mcp-merchant-operator/workflow-series-agent.mjs',
    'stellar-forge/mcp-merchant-operator/providers/workflow-series.mjs',
    'stellar-forge/mcp-merchant-operator/receiving/workflow-series-agent-journey.mjs',
    'stellar-forge/mcp-merchant-operator/console/WORKFLOW_SERIES_AGENT.md',
    'stellar-forge/mcp-merchant-operator/console/WORKFLOW_SERIES.md',
    'stellar/scf-starforge-20261009/distribution/contributions/merchant-console.json',
  ]) {
    const bytes = await readFile(join(root, path));
    sourceFiles.push({ path, bytes: bytes.length, sha256: hash(bytes) });
  }
  const sourceSelection = { baseCommit: sourceCommit, files: sourceFiles };
  const sourceSha256 = hash(canonical(sourceSelection));
  if (state.sourceSelections.at(-1)?.contentSha256 !== sourceSha256)
    state.sourceSelections.push({ ...sourceSelection, contentSha256: sourceSha256, selectedAt: new Date().toISOString() });
  const owned = join(directory, 'original-customer'), receivingDirectory = join(directory, 'receiving-console');
  if (!state.cloned) {
    await cloneOriginal(originalDirectory, owned);
    state.cloned = true; await emit('complete-original-customer-received', { originalOperationId: original.operationId });
  }
  const configPath = join(owned, 'merchant', 'agent-mcp.json');
  const raw = relocate(JSON.parse(await readFile(join(owned, 'merchant', 'merchant-mcp.json'), 'utf8')), original.directory, owned);
  // Preserve all original input files. Relocated file-body paths get their own
  // private companion input, while the complete source selection remains visible.
  for (const [alias, selection] of Object.entries(raw.sources)) {
    for (const field of ['spec', 'selections', 'bindings']) {
      if (!selection[field]) continue;
      const path = resolve(dirname(configPath), selection[field]);
      assert.ok(inside(owned, path), 'Retain the complete selected original source within this received customer.');
      const bytes = await readFile(path), input = JSON.parse(bytes), relocated = relocate(input, original.directory, owned);
      if (canonical(input) !== canonical(relocated)) {
        await privateTree(join(owned, 'merchant', 'agent-inputs'));
        const output = join(owned, 'merchant', 'agent-inputs', alias + '-' + field + '.json');
        await writeConsoleWorkflowFile(output, relocated); selection[field] = output;
      }
    }
  }
  if (!state.workspaceIds.receiving) {
    const store = new MerchantConsoleStore(receivingDirectory);
    try { state.workspaceIds.receiving = store.id; } finally { store.close(); }
    await save();
  }
  const connectionPath = join(owned, 'merchant', 'workflow-series-connection.json');
  await writeConsoleWorkflowFile(connectionPath, {
    schema: 'stellar-forge.workflow-series-connection.v1',
    consoles: {
      operations: { label: 'Original recurring customer', workspaceId: state.workspaceIds.operations,
        urlEnv: 'WORKFLOW_OPERATIONS_URL', tokenEnv: 'MCP_ACCESS_TOKEN' },
      receiving: { label: 'Complete receiving Console', workspaceId: state.workspaceIds.receiving,
        urlEnv: 'WORKFLOW_RECEIVING_URL', tokenEnv: 'MCP_ACCESS_TOKEN',
        incoming: { original_customer: { directory: join(owned, 'series-customer-handover'),
          expectedContentSha256: state.originalHandoverSha256 } } },
    },
  });
  await writeConsoleWorkflowFile(configPath, { ...raw, workflowSeriesConnection: './workflow-series-connection.json' });
  await receiveNativeDeliveryPaths({ original, owned,
    releaseStore: resolve(dirname(configPath), raw.releaseStore), state, save });
  const token = await nativeReceivingAccessToken(directory);
  const environment = { ...process.env, MCP_ACCESS_TOKEN: token };
  const hosts = new Map(); let client, receiver;
  const openHosts = async () => {
    for (const [role, consoleDirectory] of [['operations', join(owned, 'receiver-console')], ['receiving', receivingDirectory]]) {
      const host = await openSession({ configPath, port: 0, consoleDirectory, environment,
        providerOptions: { workflowSeries: { environment } } });
      hosts.set(role, host);
      environment[role === 'operations' ? 'WORKFLOW_OPERATIONS_URL' : 'WORKFLOW_RECEIVING_URL'] = host.consoleUrl;
    }
    client = mcpClient(hosts.get('operations'), token); receiver = mcpClient(hosts.get('receiving'), token);
    await client.initialize(); await receiver.initialize();
  };
  const closeHosts = async () => {
    const closing = [...hosts.values()];
    const results = await Promise.allSettled(closing.map(host => host.close()));
    const failed = results.find(value => value.status === 'rejected'); if (failed) throw failed.reason;
    hosts.clear();
  };
  const call = (...args) => client.call(...args);
  const receivedCall = (action, args) => receiver.call(action, args, 'receiving');
  const missing = async (action, args, code) => {
    try { return await call(action, args); } catch (error) { if (error.code !== code) throw error; return null; }
  };
  const verifyOldCalls = async selected => {
    const profile = await selected('profile', { id: original.profileId });
    const byId = new Map(profile.calls.map(value => [value.id, value]));
    for (const previous of state.originalCalls) {
      const retained = byId.get(previous.id);
      assert.ok(retained, 'Retain every original customer call.');
      for (const field of ['requestSha256', 'argumentsSha256', 'resultSha256']) assert.equal(retained[field], previous[field]);
    }
    for (const previous of original.periods) {
      const retained = await selected('cycle', { id: previous.id });
      assert.equal(retained.cycle.contentSha256, previous.cycle.contentSha256);
      assert.equal(retained.run.id, previous.run.id); assert.equal(retained.run.state, 'COMPLETE');
    }
    return profile;
  };
  let primaryFailure;
  try {
    state.result = 'RUNNING'; delete state.error; await save(); await openHosts();
    const connections = await call('connections');
    assert.equal(connections.consoles.length, 2);
    const host = await call('host'), profile = await call('profile', { id: state.profileId });
    assert.equal(host.console.workspaceId, state.workspaceIds.operations);
    assert.equal((await receivedCall('host')).console.workspaceId, state.workspaceIds.receiving);
    if (!state.originalCalls) {
      assert.equal(profile.calls.length, 24);
      state.originalCalls = profile.calls.map(({ id, requestSha256, argumentsSha256, resultSha256 }) =>
        ({ id, requestSha256, argumentsSha256, resultSha256 }));
      const baseline = await call('profile', { id: original.baseline.profileId });
      state.baselineCalls = baseline.calls.map(({ id, requestSha256, argumentsSha256, resultSha256 }) =>
        ({ id, requestSha256, argumentsSha256, resultSha256 }));
      await save();
    }
    if (!state.incoming) {
      state.incoming = await receivedCall('handover_receive', { incoming: 'original_customer' }); await save();
    }
    assert.equal(state.incoming.contentSha256, original.handover.contentSha256);
    const incoming = await receivedCall('handover_reopen', { incoming: 'original_customer' });
    state.originalFiles = await copyHandover(receivedCall, { incoming: 'original_customer' }, incoming, join(directory, 'original-handover'));
    if (profile.profile.hostFingerprint !== host.configurationFingerprint)
      await call('profile_bind', { id: state.profileId, expectedRevision: profile.profile.revision,
        expectedHostFingerprint: host.configurationFingerprint, expectedCompositionFingerprint: host.compositionFingerprint });
    const definition = (await call('workflow', { id: original.workflowId, revision: original.workflowRevision })).definition;
    assert.equal(definition.steps.length, 8); assert.equal(definition.steps[0].id, 'before');
    const first = definition.steps[0], originalDraft = await call('draft', { id: first.draftId, revision: first.draftRevision });
    const draft = originalDraft.draft ?? originalDraft;
    const draftRequest = await freeze('draft', { id: state.draftId, profileId: state.profileId,
      name: 'Read original merchant before the next customer period', tool: draft.tool, arguments: JSON.parse(draft.argumentsJson) });
    let savedDraft = await missing('draft', { id: state.draftId }, 'CONSOLE_DRAFT_NOT_FOUND');
    if (!savedDraft) savedDraft = await call('draft_save', { input: draftRequest });
    savedDraft = savedDraft.draft ?? savedDraft;
    assert.equal(savedDraft.tool, draft.tool); assert.equal(savedDraft.argumentsJson, JSON.stringify(draftRequest.arguments));
    const steps = definition.steps.map(step => Object.fromEntries(
      ['id', 'name', 'draftId', 'draftRevision', 'bindings', 'expect', 'pauseAfter'].map(key => [key, copy(step[key])])));
    steps[0] = { ...steps[0], draftId: state.draftId, draftRevision: savedDraft.revision, pauseAfter: true };
    const workflowRequest = await freeze('workflow', { id: state.workflowId, profileId: state.profileId,
      name: 'Reviewed continuation of the original recurring customer', steps });
    let savedWorkflow = await missing('workflow', { id: state.workflowId }, 'CONSOLE_WORKFLOW_NOT_FOUND');
    if (!savedWorkflow) savedWorkflow = await call('workflow_save', { input: workflowRequest });
    assert.deepEqual(savedWorkflow.definition.steps, steps);
    let history = await readAllPeriods(call, state.seriesId);
    if (!state.requests.series) {
      assert.equal(history.total, 2);
      const originalSeries = history.series;
      const request = { ...originalSeries.request, requestId: 'agent-series-' + suffix, expectedRevision: originalSeries.revision,
        workflowId: state.workflowId, workflowRevision: savedWorkflow.definition.revision };
      await freeze('series', request);
    }
    const series = (await call('save', { input: state.requests.series })).series;
    if (!state.requests.period) {
      const previous = [...original.periods].sort((a, b) => a.request.period.end.localeCompare(b.request.period.end)).at(-1);
      const start = new Date(previous.request.period.end + 'T00:00:00.000Z'); start.setUTCDate(start.getUTCDate() + 1);
      const end = new Date(start); end.setUTCFullYear(end.getUTCFullYear() + 1);
      const calendar = await call('calendar', { id: state.seriesId, revision: series.revision,
        from: isoDay(start), to: isoDay(end), limit: 1 });
      assert.equal(calendar.periods.length, 1);
      const { existing, ...period } = calendar.periods[0]; assert.equal(existing, null);
      const edition = original.sourceEditions.at(-1), selected = raw.sources[edition.sourceAlias];
      assert.ok(selected); assert.equal(hash(await readFile(resolve(dirname(configPath), selected.spec))), edition.specSha256);
      await freeze('period', { seriesId: state.seriesId, seriesRevision: series.revision, ...period,
        previousCycleId: previous.id, sourceEdition: 'sha256:' + edition.specSha256,
        reason: 'Continue this original customer through the agent tools, review its first native return, and receive every customer file.',
        inputs: { ...series.baseInputs, sourceAlias: edition.sourceAlias } });
    }
    state.cycleId = cycleId(state.seriesId, state.requests.period.key); await save();
    let selected = await missing('cycle', { id: state.cycleId }, 'CONSOLE_CYCLE_NOT_FOUND');
    if (!selected) {
      const prepared = state.requests.periodPreparation ?? await call('cycle_prepare', state.requests.period);
      assert.equal(prepared.review.canStart, true); await freeze('periodPreparation', prepared);
      selected = await call('cycle_save', { preparation: prepared });
    }
    if (!selected.run) {
      const prepared = state.requests.startPreparation ?? await call('cycle_start_prepare', { id: state.cycleId });
      assert.equal(prepared.review.canStart, true); await freeze('startPreparation', prepared);
      selected = await call('cycle_start', { preparation: prepared });
    }
    state.runId = selected.run.id; await emit('original-period-started', { cycleId: state.cycleId, runId: state.runId });
    // The native engine checkpoints the first completed original request. An
    // interrupted command reopens this same run and current revision.
    for (;;) {
      selected = await call('cycle_wait', { id: state.cycleId, timeoutMs: 120000, pollMs: 150 });
      state.cycle = selected.cycle; state.run = selected.run; await save();
      if (selected.run.state === 'COMPLETE') break;
      if (selected.run.state === 'WAITING') {
        const step = selected.run.steps.find(value => !['COMPLETE', 'RECOVERED'].includes(value.state));
        const failed = step?.callId ? await call('call', { id: step.callId }) : null;
        const receiving = state.nativePathReceivings?.find(value =>
          failed?.error?.message?.includes(value.sourceDirectory));
        if (step?.id !== 'start' || failed?.state !== 'FAILED' || failed.tool !== 'merchant_start' ||
            !receiving || !failed.error.message.includes('ENOENT'))
          throw Object.assign(new Error(failed?.error?.message ?? selected.run.error?.message ??
            'Continue the original saved native recovery.'), {
            code: failed?.error?.code ?? selected.run.error?.code ?? 'WORKFLOW_SERIES_AGENT_RECOVERY',
            details: { runId: selected.run.id, stepId: step?.id, callId: step?.callId },
          });
        state.nativeRecovery ??= { originalCall: failed,
          options: await call('call_recovery', { id: failed.id }), sourceReceiving: receiving };
        await save();
        const draftId = 'agent-recovery-draft-' + suffix, callId = 'agent-recovery-call-' + suffix;
        const draftInput = await freeze('recoveryDraft', { id: draftId, profileId: state.profileId,
          name: 'Continue the original merchant after receiving its complete outbox',
          tool: failed.tool, arguments: JSON.parse(failed.argumentsJson), recoveryOf: failed.id });
        let recoveryDraft = await missing('draft', { id: draftId }, 'CONSOLE_DRAFT_NOT_FOUND');
        if (!recoveryDraft) recoveryDraft = await call('draft_save', { input: draftInput });
        recoveryDraft = recoveryDraft.draft ?? recoveryDraft;
        assert.equal(recoveryDraft.recoveryOf, failed.id);
        assert.equal(recoveryDraft.argumentsSha256, failed.argumentsSha256);
        const recoveryInput = await freeze('recoveryCall', { id: callId, profileId: state.profileId,
          draftId, draftRevision: recoveryDraft.revision,
          expectedHostFingerprint: (await call('host')).configurationFingerprint });
        let recovered = await missing('call', { id: callId }, 'CONSOLE_CALL_NOT_FOUND');
        if (!recovered) {
          const dispatched = await call('call_start', { input: recoveryInput });
          recovered = dispatched.call ?? dispatched;
        }
        while (recovered.state === 'RUNNING') {
          await new Promise(resolve => setTimeout(resolve, 150));
          recovered = await call('call', { id: callId });
        }
        if (recovered.state !== 'COMPLETE')
          throw Object.assign(new Error(recovered.error?.message ?? 'Continue the saved native recovery request.'),
            { code: recovered.error?.code ?? 'WORKFLOW_SERIES_AGENT_RECOVERY' });
        state.nativeRecovery.completedCall = await call('call', { id: callId }); await save();
        const current = await call('cycle', { id: state.cycleId });
        await call('run_resolve', { id: state.runId, expectedRevision: current.run.revision,
          stepId: step.id, callId, note: 'Received the original complete settlement outbox at this customer location. ' +
            'The unchanged native merchant start now completes; retain the earlier failed call and this linked recovery.' });
        const resolved = await call('cycle', { id: state.cycleId });
        await call('run_resume', { id: state.runId, expectedRevision: resolved.run.revision });
        continue;
      }
      if (selected.run.active) { await emit('original-native-period-running', { runId: selected.run.id }); continue; }
      if (selected.run.state === 'PAUSED') {
        if (selected.run.stepsComplete === 1) {
          const firstCall = await call('call', { id: selected.run.steps[0].callId });
          assert.equal(firstCall.state, 'COMPLETE'); assert.equal(firstCall.tool, draft.tool);
          assert.equal(hash(firstCall.resultJson), firstCall.resultSha256);
          assert.equal(JSON.parse(firstCall.resultJson).operator.managesRunningSeller, false);
          state.reviewedFirstCall = firstCall; await save();
        } else assert.ok(state.reviewedFirstCall && selected.run.stepsComplete > 1,
          'Continue after the original first native review and retained later checkpoints.');
        await call('run_resume', { id: selected.run.id, expectedRevision: selected.run.revision });
      } else if (selected.run.state === 'READY') {
        await call('run_resume', { id: selected.run.id, expectedRevision: selected.run.revision });
      } else throw Object.assign(new Error('Reopen the original native run at its retained state: ' + selected.run.state),
        { code: 'WORKFLOW_SERIES_AGENT_RUN_STATE' });
    }
    assert.equal(selected.run.state, 'COMPLETE', 'Continue the retained native run and its original recovery record.');
    assert.equal(selected.run.id, state.runId); assert.equal(selected.run.stepsComplete, 8);
    assert.ok(state.reviewedFirstCall, 'Retain the actual original first-call review.');
    const calls = await retainedCalls(call, selected.run), results = calls.map(value => JSON.parse(value.resultJson));
    const inputs = JSON.parse(selected.cycle.inputsJson);
    assert.equal(results[1].release.id, inputs.releaseId);
    assert.equal(results[3].runtime.state, 'RUNNING'); assert.equal(results[4].mode, 'CHALLENGE_ONLY');
    assert.equal(results[4].files.length, 5); assert.equal(results[7].operator.managesRunningSeller, false);
    state.cycle = selected.cycle; state.run = selected.run; state.nativeCalls = calls;
    state.nativeAttempts = [];
    for (const id of new Set(selected.run.steps.flatMap(step => [step.callId, step.resolvedCallId].filter(Boolean))))
      state.nativeAttempts.push(await call('call', { id }));
    const currentHost = await call('host');
    const customerInput = state.requests.customer ?? { profileId: state.profileId, family: 'core',
      exportId: inputs.customerId, expectedManifestSha256: results[5].manifestFile.sha256,
      expectedHostFingerprint: currentHost.configurationFingerprint };
    await freeze('customer', customerInput);
    const customer = await call('customer_receive', { input: customerInput });
    const delivery = await call('customer_wait', { profileId: state.profileId,
      deliveryId: customer.delivery?.id ?? customer.id, timeoutMs: 120000, pollMs: 150 });
    assert.equal(delivery.delivery.state, 'COMPLETE'); assert.equal(delivery.delivery.files.length, 6);
    state.customer = delivery.delivery; await emit('customer-period-complete', { nativeCalls: calls.length, customerFiles: 6 });
    const full = await verifyOldCalls(call);
    assert.equal(full.calls.length, state.originalCalls.length + state.nativeAttempts.length);
    const baseline = await call('profile', { id: original.baseline.profileId });
    assert.deepEqual(baseline.calls.map(({ id, requestSha256, argumentsSha256, resultSha256 }) =>
      ({ id, requestSha256, argumentsSha256, resultSha256 })), state.baselineCalls);
    const handover = await call('handover_capture', { profileId: state.profileId, handoverId: state.handoverId });
    assert.equal(handover.manifest.customers.length, full.deliveries.filter(value => value.state === 'COMPLETE' && value.localFiles).length);
    state.handover = handover;
    state.customerFiles = await copyHandover((action, args) => receiver.call(action, args, 'operations'),
      { handoverId: state.handoverId }, handover, join(directory, 'complete-customer-handover'));
    state.received = await receivedCall('handover_receive', { sourceConsole: 'operations', handoverId: state.handoverId });
    assert.equal(state.received.contentSha256, handover.contentSha256);
    const destination = await verifyOldCalls(receivedCall);
    assert.equal(destination.calls.length, full.calls.length);
    assert.equal((await receivedCall('cycle', { id: state.cycleId })).run.id, state.runId);
    const window = { profileId: state.profileId, from: original.periods[0].request.period.start,
      to: state.requests.period.period.end, includeProposed: false };
    let offset = 0; const agendaPages = [];
    for (;;) {
      const page = await call('agenda', { ...window, offset, limit: 100 }); agendaPages.push(page);
      if (page.nextOffset === null) break;
      assert.ok(page.nextOffset > offset); offset = page.nextOffset;
    }
    state.agenda = agendaPages;
    state.calendar ??= await call('agenda_calendar', window);
    await retain('customer-agenda.ics', state.calendar.content);
    await closeHosts(); await openHosts();
    for (const select of [call, receivedCall]) {
      const retained = await verifyOldCalls(select);
      assert.equal(retained.calls.length, full.calls.length);
      const reopened = await select('cycle', { id: state.cycleId });
      assert.equal(reopened.run.id, state.runId); assert.equal(reopened.run.state, 'COMPLETE');
    }
    assert.equal((await call('handover_reopen', { handoverId: state.handoverId })).contentSha256, handover.contentSha256);
    await closeHosts();
    state.result = 'COMPLETE'; state.completedAt ??= new Date().toISOString();
    state.stage = 'complete-customer-received-and-reopened'; await save();
    const completedPath = join(directory, 'workflow-series-agent-native-run.json');
    await writeFile(completedPath + '.tmp', JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
    await rename(completedPath + '.tmp', completedPath);
    process.stdout.write(JSON.stringify({ operationId: state.operationId, stage: state.stage, profileId: state.profileId,
      periods: original.periods.length + 1, retainedCustomerCalls: full.calls.length,
      newNativeCalls: calls.length, retainedNativeAttempts: state.nativeAttempts.length,
      completeHandoverFiles: state.customerFiles.length,
      handoverSha256: handover.contentSha256 }) + '\n');
    return state;
  } catch (error) {
    primaryFailure = error; state.result = 'FAILED';
    state.error = { code: error.code ?? 'WORKFLOW_SERIES_AGENT_RECEIVING', message: error.message,
      ...(error.outcomeUnknown === undefined ? {} : { outcomeUnknown: error.outcomeUnknown }) };
    try { await save(); } catch (savingError) { secondaryFailure(error, 'checkpoint save', savingError); }
    throw error;
  } finally {
    try { await closeHosts(); }
    catch (closingError) {
      if (!primaryFailure) throw closingError;
      secondaryFailure(primaryFailure, 'native host close', closingError);
    }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const flags = new Map();
  for (let index = 2; index < process.argv.length; index += 2) {
    const flag = process.argv[index], value = process.argv[index + 1];
    assert.ok(['--original-directory', '--directory', '--source-commit'].includes(flag) && value && !flags.has(flag),
      'Use --original-directory, --directory and --source-commit with their complete selections.');
    flags.set(flag, value);
  }
  receiveMerchantWorkflowSeriesAgent({ originalDirectory: flags.get('--original-directory'),
    directory: flags.get('--directory'), sourceCommit: flags.get('--source-commit') }).catch(error => {
      process.stderr.write(error.stack + '\n'); process.exitCode = 1;
    });
}
