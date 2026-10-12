#!/usr/bin/env node
// MIT. Continue the existing completed checkout through its actual merchant MCP and full receiving client.
import assert from 'node:assert/strict';
import { open, rename, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID, randomBytes } from 'node:crypto';
import { openJobMerchant } from '../model.mjs';
import { startJobsWorkspace } from '../workspace/server.mjs';
import { openAccountingWorkspace } from '../../../merchant-settlement-accounting/workspace/store.mjs';
import { acquireStateLease } from '../../../merchant-fleet-gateway/state-lease.mjs';
import { privateDirectory, readPrivate, readDocument, writeDocument } from '../resolution/storage.mjs';
import { syncDirectory } from '../inputs/files.mjs';
import { hash, canonical, need } from './format.mjs';
import { initializePaidJobWorkspaceMerchant } from '../../../../../stellar-forge/mcp-merchant-operator/paid-jobs-setup.mjs';
import { startMerchantMcp } from '../../../../../stellar-forge/mcp-merchant-operator/serve.mjs';
import { openMerchantFileClient } from '../../../../../stellar-forge/mcp-merchant-operator/retained-download.mjs';
import { inspectPaidJobExport, downloadPaidJobExport, reopenPaidJobExport } from
  '../../../../../stellar-forge/mcp-merchant-operator/paid-jobs-client.mjs';

const OPERATION = 'SCF-PAID-JOB-AGENT-0B8D-20261012';
async function replacePrivate(path, bytes) {
  const temporary = path + '.' + randomUUID() + '.pending';
  try {
    const file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    await rename(temporary, path); await syncDirectory(dirname(path));
  } finally { await rm(temporary, { force: true }); }
}
export async function runPaidJobAgentContinuation({ checkoutResult, directory: requestedDirectory, signal } = {}) {
  need(typeof checkoutResult === 'string' && checkoutResult, 'JOB_AGENT_CONTINUATION_SOURCE_REQUIRED',
    'Select the original completed checkout and resolution result.');
  const sourcePath = resolve(checkoutResult), sourceBytes = await readPrivate(sourcePath, 1024 * 1024);
  const completed = JSON.parse(sourceBytes);
  need(completed.result === 'PASS' && completed.fixture?.protocol === 'LOCAL_PAID_JOB_PROTOCOL' &&
    completed.resolution?.result === 'PASS' && completed.checkout?.phase === 'ACCEPTED',
    'JOB_AGENT_CONTINUATION_SOURCE_REQUIRED', 'Complete the original checkout and its resolution first.');
  const fixture = resolve(completed.fixtureDirectory), merchantDirectory = join(fixture, 'merchant-state');
  need(fixture === completed.fixtureDirectory && completed.resolution.fixtureDirectory === fixture &&
    completed.resolution.jobId && completed.resolution.accountingWorkspace,
    'JOB_AGENT_CONTINUATION_SOURCE_CHANGED', 'Use the same original merchant, job and accounting workspace.');
  const directory = requestedDirectory ? resolve(requestedDirectory) : join(fixture, 'agent-continuation');
  await privateDirectory(directory);
  const lease = await acquireStateLease(directory);
  try {
    const planPath = join(directory, 'operation.json');
    const output = join(directory, 'native-result.json'), connection = join(directory, 'workspaces.json');
    const urlFile = join(directory, 'original-operator.url'), mcpDirectory = join(directory, 'merchant-mcp');
    const mcpConfig = join(mcpDirectory, 'merchant-mcp.json'), receiving = join(directory, 'received-job');
    const jobId = completed.resolution.jobId;
    const originalRequests = await readDocument(join(dirname(completed.resolution.output), 'operation.json'));
    let plan = await readDocument(planPath, { optional: true });
    if (!plan) {
      plan = { schema: 'stellar-forge.paid-job-agent-continuation.v1', operation: OPERATION,
        sourceSha256: hash(sourceBytes), jobId, requests: { prepare: randomUUID(), export: randomUUID() },
        export: null, interruptedDownload: null, mcpPort: 0, createdAt: new Date().toISOString() };
      await writeDocument(planPath, plan);
    }
    need(plan.schema === 'stellar-forge.paid-job-agent-continuation.v1' && plan.operation === OPERATION &&
      plan.sourceSha256 === hash(sourceBytes) && plan.jobId === jobId,
      'JOB_AGENT_CONTINUATION_SOURCE_CHANGED', 'Resume this operation with its same original completed checkout source.');
    const checkpoint = async () => { lease.assertHeld(); await writeDocument(planPath, plan); };
    const stop = new AbortController(), abort = () => stop.abort(signal?.reason);
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    let accounting, merchant, workspace, mcp, client, environment, phase = 'open original owners', complete = false;
    const progress = name => { phase = name; process.stdout.write(JSON.stringify({ operation: OPERATION, phase }) + '\n'); };
    const call = (name, args = {}) => client.call('merchant_jobs_' + name, { workspace: 'original', ...args });
    async function closeMcp() { const current = mcp; mcp = null; client = null; await current?.close(); }
    async function closeMerchant() {
      const host = workspace; workspace = null;
      try { await host?.close(); } finally { const owner = merchant; merchant = null; await owner?.close(); }
    }
    async function openOwners() {
      accounting = await openAccountingWorkspace({ directory: completed.resolution.accountingWorkspace });
      merchant = await openJobMerchant({ configPath: join(fixture, 'merchant.json'), directory: merchantDirectory,
        resolution: { accounting: { controller: accounting.adjustments } } });
      workspace = await startJobsWorkspace({ model: merchant, port: 0 });
      await replacePrivate(urlFile, Buffer.from(workspace.url + '\n'));
    }
    async function openMcp() {
      environment = { MCP_ACCESS_TOKEN: randomBytes(32).toString('base64url') };
      mcp = await startMerchantMcp({ configPath: mcpConfig, port: plan.mcpPort, environment });
      if (!plan.mcpPort) { plan.mcpPort = Number(new URL(mcp.url).port); await checkpoint(); }
      client = await openMerchantFileClient({ url: mcp.url, environment, signal: stop.signal,
        errorPrefix: 'JOB_AGENT', clientName: 'paid-job-native-receiving' });
    }
    try {
      stop.signal.throwIfAborted();
      await openOwners();
      const beforeJob = await merchant.get(jobId), originalJobSha256 = hash(canonical(beforeJob));
      const outboxPath = join(merchantDirectory, 'outbox', 'events.ndjson');
      const originalOutboxSha256 = hash(await readPrivate(outboxPath, 64 * 1024 * 1024));
      const source = (await merchant.snapshot()).source;
      await writeDocument(connection, { schema: 'stellar-forge.paid-job-workspace-connection.v1',
        workspaces: { original: { label: 'Original invoice reconciliation merchant', directory: merchantDirectory,
          urlFile, source: { configSha256: source.configSha256, applicationSha256: source.applicationSha256 } } } });
      if (!await readPrivate(mcpConfig, 1024 * 1024, { optional: true }))
        await initializePaidJobWorkspaceMerchant({ directory: mcpDirectory, connection });
      await openMcp();
      progress('original agent catalog, jobs and input receiving');
      const status = await call('status');
      assert.equal(status.launch.instanceId, workspace.identity.instanceId);
      assert.equal(status.source.configSha256, source.configSha256);
      const names = mcp.operator.tools.map(tool => tool.name);
      for (const name of ['merchant_jobs_prepare','merchant_jobs_case_record','merchant_jobs_file'])
        assert.ok(names.includes(name), 'Configured original merchant tool ' + name);
      const listed = await call('jobs', { functionId: beforeJob.functionId, q: jobId, limit: 1 });
      assert.equal(listed.jobs[0].id, jobId);
      const inputs = await call('inputs', { reference: jobId, ownership: 'RETAINED_JOB', limit: 200 });
      assert.equal(inputs.total, Object.keys(beforeJob.input.$files ?? {}).length);
      const previews = [];
      for (const original of inputs.items) {
        const detail = await call('input', { uploadId: original.id });
        assert.equal(detail.job.id, jobId); assert.equal(detail.usesFile, true);
        const preview = await call('input_preview', { uploadId: original.id });
        assert.equal(preview.sha256, original.file.sha256);
        previews.push({ slot: original.slot, uploadId: original.id, bytes: preview.bytes, sha256: preview.sha256,
          previewBytes: preview.previewBytes, truncated: preview.truncated });
      }
      const privateClaim = (await readPrivate(join(fixture, 'claim-token.txt'), 256)).toString('utf8').trim();
      const prepared = await call('prepare', { requestId: plan.requests.prepare, reference: jobId,
        functionId: beforeJob.functionId, input: beforeJob.input, claimToken: privateClaim });
      assert.equal(prepared.created, false); assert.equal(prepared.job.id, jobId);
      assert.equal(prepared.claimToken, privateClaim);
      const recovered = await call('prepare', { requestId: plan.requests.prepare, reference: jobId,
        functionId: beforeJob.functionId, input: beforeJob.input, claimToken: privateClaim });
      assert.equal(recovered.claimToken, privateClaim);
      progress('recover existing original support and accounting operations');
      const beforeCase = await merchant.resolution.get(jobId);
      for (const [action, key] of [['case_reply','reply'],['case_preview','preview'],['case_record','record'],['case_state','closeCase']]) {
        const request = originalRequests.requests[key];
        assert.ok(request, 'Original retained resolution request ' + key);
        const result = await call(action, { jobId, ...request });
        assert.equal(result.case.revision, beforeCase.case.revision);
      }
      const caseView = await call('case_read', { jobId, section: 'accounting' });
      assert.equal(caseView.case.accounting.source.runId, completed.resolution.accountingRunId);
      assert.equal(caseView.value.detail.adjustments.find(item => item.id === completed.resolution.adjustment.id)?.status, 'RECORDED');
      const messages = await call('case_read', { jobId, section: 'messages', limit: 1 });
      const allMessages = [...messages.items]; let cursor = messages.nextCursor;
      while (cursor) {
        const page = await call('case_read', { jobId, section: 'messages', limit: 1, cursor });
        allMessages.push(...page.items); cursor = page.nextCursor;
      }
      assert.equal(allMessages.length, beforeCase.case.messages.length);
      if (!plan.export) {
        plan.export = { requestId: plan.requests.export, jobId,
          expectedRevision: beforeJob.revision, expectedCaseRevision: beforeCase.case.revision };
        await checkpoint();
      }
      progress('freeze complete original job and receive an interrupted input');
      const exported = await call('export', plan.export);
      if (plan.exportId) assert.equal(exported.exportId, plan.exportId);
      plan.exportId = exported.exportId; plan.manifestSha256 ??= exported.manifestFile.sha256;
      assert.equal(exported.manifestFile.sha256, plan.manifestSha256); await checkpoint();
      const selected = await inspectPaidJobExport({ workspace: 'original', client, exportId: plan.exportId,
        expectedManifestSha256: plan.manifestSha256, signal: stop.signal });
      assert.equal(selected.manifest.inputs.length, inputs.total);
      assert.equal(selected.manifest.accounting.runId, completed.resolution.accountingRunId);
      const largeInput = selected.manifest.files.find(file => file.name.startsWith('input_') && file.bytes > 32768);
      if (!plan.interruptedDownload && largeInput) {
        const interruption = new AbortController();
        try {
          await downloadPaidJobExport({ workspace: 'original', client, exportId: plan.exportId,
            directory: receiving, expectedManifestSha256: plan.manifestSha256, chunkSize: 16384,
            signal: AbortSignal.any([stop.signal, interruption.signal]),
            onProgress: async value => {
              if (value.file === largeInput.name && value.bytes < value.total) {
                plan.interruptedDownload = { file: value.file, bytes: value.bytes, total: value.total };
                await checkpoint(); interruption.abort(new Error('Retain this original input prefix for MCP restart.'));
              }
            } });
        } catch (error) { if (!interruption.signal.aborted) throw error; }
        assert.ok(plan.interruptedDownload, 'Original input download retained its actual interrupted prefix');
      }
      progress('restart the original MCP and resume the same complete files');
      const previousMcpUrl = mcp.url;
      await closeMcp();
      assert.equal((await merchant.get(jobId)).revision, beforeJob.revision);
      await openMcp(); assert.equal(mcp.url, previousMcpUrl);
      const retained = await call('export', plan.export);
      assert.equal(retained.exportId, plan.exportId); assert.equal(retained.manifestFile.sha256, plan.manifestSha256);
      const saved = await downloadPaidJobExport({ workspace: 'original', client, exportId: plan.exportId,
        directory: receiving, expectedManifestSha256: plan.manifestSha256, chunkSize: 65536, signal: stop.signal });
      if (plan.interruptedDownload) assert.ok(saved.resumedBytes >= plan.interruptedDownload.bytes);
      const receivedCase = await call('case_receive', { sourceWorkspace: 'original', exportId: plan.exportId,
        expectedManifestSha256: plan.manifestSha256 });
      assert.equal(receivedCase.case.revision, beforeCase.case.revision);
      await call('worker', { action: 'start' });
      assert.equal((await call('status')).worker.running, true);
      await closeMcp();
      assert.equal((await merchant.snapshot()).worker.running, true);
      assert.equal(hash(canonical(await merchant.get(jobId))), originalJobSha256);
      assert.equal(hash(await readPrivate(outboxPath, 64 * 1024 * 1024)), originalOutboxSha256);
      await closeMerchant(); await accounting.close(); accounting = null;
      progress('reopen the complete received package without a merchant');
      const offline = await reopenPaidJobExport({ directory: receiving, expectedManifestSha256: plan.manifestSha256 });
      assert.equal(offline.exportId, plan.exportId);
      const result = { schema: 'stellar-forge.paid-job-agent-native-result.v1', operation: OPERATION, result: 'PASS',
        node: process.version, jobId, fixtureDirectory: fixture, directory, originalJobSha256, originalOutboxSha256,
        originalSettlementId: beforeJob.settlement.id, accountingRunId: completed.resolution.accountingRunId,
        exportId: plan.exportId, manifestSha256: plan.manifestSha256, files: selected.manifest.files,
        totalBytes: selected.manifest.totalBytes, inputPreviews: previews, messageCount: allMessages.length,
        interruptedDownload: plan.interruptedDownload, receiving: saved, offline,
        lifecycle: ['original job and input inspection', 'same prepared claim recovery',
          'original retained case and accounting request recovery', 'complete job/input/result/case/accounting export',
          'interrupted original input download', 'MCP restart and retained-prefix resume',
          'same original case receiving', 'borrowed worker lifetime', 'complete offline reopen'] };
      await writeDocument(output, result); plan.completedAt = new Date().toISOString(); plan.output = output; await checkpoint();
      complete = true; process.stdout.write(JSON.stringify({ operation: OPERATION, result: 'PASS', output }) + '\n');
      return { ...result, output };
    } catch (error) {
      await writeDocument(output, { schema: 'stellar-forge.paid-job-agent-native-result.v1', operation: OPERATION,
        result: 'FAIL', phase, jobId, directory, code: error.code ?? 'JOB_AGENT_CONTINUATION_FAILED',
        message: String(error.message ?? error).slice(0,1500) }).catch(() => {});
      throw error;
    } finally {
      stop.abort(); signal?.removeEventListener('abort', abort);
      const errors = [];
      for (const close of [closeMcp, closeMerchant, () => accounting?.close()])
        try { await close(); } catch (error) { errors.push(error); }
      if (!complete) process.stderr.write(JSON.stringify({ operation: OPERATION, phase, directory, output }) + '\n');
      if (errors.length) throw new AggregateError(errors, 'JOB_AGENT_CONTINUATION_CLOSE_FAILED');
    }
  } finally { await lease.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), options = {};
  try {
    need(args.length % 2 === 0, 'JOB_AGENT_CONTINUATION_ARGUMENTS', 'Supply --checkout-result and optional --directory.');
    for (let i = 0; i < args.length; i += 2) {
      const key = { '--checkout-result': 'checkoutResult', '--directory': 'directory' }[args[i]];
      need(key && !Object.hasOwn(options, key) && args[i+1], 'JOB_AGENT_CONTINUATION_ARGUMENTS', 'Use each declared option once.');
      options[key] = args[i+1];
    }
    await runPaidJobAgentContinuation(options);
  } catch (error) {
    process.stderr.write(JSON.stringify({ operation: OPERATION, error: error.code ?? 'JOB_AGENT_CONTINUATION_FAILED',
      message: String(error.message ?? error).slice(0,1500) }) + '\n'); process.exitCode = 1;
  }
}
