// MIT. One installed original SDK/SF30/SF31/SF88/SF98 durable paid-jobs journey.
// Facilitator and HTTP connection are explicit loopback protocol fixtures.
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, readFile, writeFile, open, link, lstat, rm } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { setTimeout as pause } from 'node:timers/promises';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { createNativeSellerServer, NATIVE_SDK_VERSION } from '../native-factory.mjs';
import { X402BuyerClient } from '../../sf31-buyer-client/buyer.mjs';
import { createPublicHttpsFetch } from '../../sf31-buyer-client/public-transport.mjs';
import { prepareBuyerResponseFile } from '../../sf31-buyer-client/response-file.mjs';
import { Buyer } from '../../sf88-operator-buyer-cli/node/client.mjs';
import { openJobMerchant } from './model.mjs';
import { startJobSeller } from './merchant.mjs';
import { startCustomerServer } from './customer.mjs';
import { startJobsWorkspace } from './workspace/server.mjs';
import { createJobBuyer, openJobBuyer } from './buyer.mjs';

const resumeDirectory = process.env.SF_JOBS_JOURNEY_RESUME;
const work = resumeDirectory ? resolve(resumeDirectory) :
  await mkdtemp(join(process.env.SF_JOBS_JOURNEY_TMPDIR ?? tmpdir(), 'sf30-paid-jobs-'));
const stateDirectory = join(work, 'merchant-state'), configPath = join(work, 'merchant.json');
const gate = join(work, 'release-application'), output = process.env.SF_JOBS_JOURNEY_OUTPUT;
const keepWork = process.env.SF_JOBS_JOURNEY_KEEP === '1' || !!resumeDirectory;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const write = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
});
const shutdown = async server => {
  if (!server?.listening) return;
  server.closeAllConnections?.(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
};
let model, seller, customer, workspace, verified = 0, settled = 0, journeyCompleted = false;
const facilitator = createServer(async (req, res) => {
  try {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : null;
    let result;
    if (req.url === '/supported') result = {
      kinds: [{ x402Version: 2, scheme: 'exact', network: 'stellar:testnet' }], extensions: ['bazaar'], signers: {},
    };
    else if (req.url === '/verify') {
      assert.equal(body.paymentRequirements.network, 'stellar:testnet');
      assert.equal(body.paymentRequirements.amount, '10000');
      assert.equal(body.paymentPayload.payload.fixture, 'LOCAL_PAID_JOB_PROTOCOL');
      verified++; result = { isValid: true, payer: 'LOCAL_PAID_JOB_PROTOCOL' };
    } else if (req.url === '/settle') {
      settled++; result = { success: true, network: 'stellar:testnet',
        transaction: hash('LOCAL_PAID_JOB_PROTOCOL_' + settled), payer: 'LOCAL_PAID_JOB_PROTOCOL' };
    }
    res.writeHead(result ? 200 : 404, { 'content-type': 'application/json' }); res.end(JSON.stringify(result ?? {}));
  } catch { res.writeHead(500); res.end('{}'); }
});
async function version() {
  const require = createRequire(import.meta.url);
  let directory = dirname(require.resolve('@x402/core/server'));
  for (let depth = 0; depth < 8; depth++, directory = dirname(directory)) {
    try {
      const metadata = JSON.parse(await readFile(join(directory, 'package.json')));
      if (metadata.name === '@x402/core') return metadata.version;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  throw new Error('NATIVE_SDK_PACKAGE_REQUIRED');
}
async function startMerchant() {
  model = await openJobMerchant({ configPath, directory: stateDirectory,
    env: { SF_JOBS_JOURNEY_GATE: gate } });
  seller = await startJobSeller(model, { port: 0, operationsPort: 0,
    nativeFactory: compiled => createNativeSellerServer(compiled, {
      facilitatorClient: new HTTPFacilitatorClient({ url: 'http://127.0.0.1:' + facilitator.address().port }),
    }),
  });
  customer = await startCustomerServer({ model, port: 0 });
  workspace = await startJobsWorkspace({ model, port: 0 });
}
async function closeMerchant() {
  const stopped = await Promise.allSettled([workspace?.close(), customer?.close(), seller?.close()]);
  workspace = customer = seller = null;
  try { await model?.close(); } finally { model = null; }
  const failures = stopped.filter(item => item.status === 'rejected').map(item => item.reason);
  if (failures.length) throw new AggregateError(failures, 'JOURNEY_MERCHANT_SHUTDOWN_FAILED');
}
async function operator(path, body) {
  const response = await fetch(workspace.origin + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: 'Bearer ' + workspace.token, origin: workspace.origin,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  assert.ok(response.ok, JSON.stringify({ status: response.status, result })); return result;
}
async function state(id, wanted) {
  const deadline = Date.now() + 15000;
  let row;
  do {
    row = await model.get(id);
    if (row.state === wanted) return row;
    await pause(50);
  } while (Date.now() < deadline);
  throw new Error('JOB_STATE_TIMEOUT:' + wanted + ':' + row.state);
}
// Preserve original public URL/header/response handling while replacing only
// the documented connection seam with this journey's owned loopback listeners.
const transport = createPublicHttpsFetch({
  timeoutMs: 30000,
  lookup: async () => [{ address: '8.8.8.8', family: 4 }],
  requestImpl(options, receive) {
    assert.equal(options.hostname, 'jobs-merchant.example');
    const local = new URL(options.path.startsWith('/jobs/') ? customer.url : seller.url);
    return httpRequest({ hostname: '127.0.0.1', port: local.port, method: options.method, path: options.path,
      headers: { ...options.headers, host: options.hostname }, signal: options.signal, agent: false,
      maxHeaderSize: options.maxHeaderSize }, receive);
  },
});
const nativeBuyer = new X402BuyerClient({ fetchImpl: transport });
const applicationBuyer = new Buyer({
  runtimeDirectory: fileURLToPath(new URL('../../sf88-operator-buyer-cli', import.meta.url)),
  stateDirectory: join(work, 'original-buyer'),
});
const reviews = [];
async function retainHandoff(handoff) {
  const filename = handoff.job.id.replace(/:/g, '_') + '.handoff-r' + handoff.job.revision + '.json';
  const path = join(work, filename), bytes = JSON.stringify(handoff, null, 2) + '\n';
  let handle;
  try {
    handle = await open(path, 'wx', 0o600);
    await handle.writeFile(bytes); await handle.sync();
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    assert.equal(await readFile(path, 'utf8'), bytes, 'Retained handoff revision changed.');
  } finally { await handle?.close(); }
  const directory = await open(work, 'r');
  try { await directory.sync(); } finally { await directory.close(); }
  return path;
}
async function buy(handoff) {
  // Native buyer preparation can fail before returning its operation. Retain the
  // exact private capability first so the original prepared job stays recoverable.
  await retainHandoff(handoff);
  const payment = handoff.purchase.payment;
  const expect = { scheme: payment.scheme, network: payment.network, asset: payment.asset,
    payTo: payment.payTo, maxAtomic: payment.amount, maxTimeoutSeconds: payment.maxTimeoutSeconds };
  const request = { intentId: 'paid-jobs-journey:' + handoff.job.id, url: handoff.purchase.url,
    method: 'POST', expect, orderReference: handoff.purchase.orderReference,
    headers: { 'content-type': 'application/json', ...handoff.purchase.headers },
    body: JSON.stringify(handoff.purchase.body) };
  const prepared = await applicationBuyer.fromRequest(request,
    { responseFile: { maxBytes: 65536, timeoutMs: 30000 } });
  reviews.push((await prepared.review()).native.mode);
  const destination = join(work, handoff.job.id.replace(/:/g, '_') + '.accepted.json');
  const capture = await prepareBuyerResponseFile({ destination, maxBytes: 65536, expectedContentType: 'application/json' });
  try {
    const result = await nativeBuyer.call({ ...request, approve: () => true,
      sign: async ({ challenge, accepted }) => {
        assert.equal((await model.get(handoff.job.id)).state, 'PREPARED');
        return { x402Version: 2, resource: challenge.resource, accepted,
          extensions: challenge.extensions, payload: { fixture: 'LOCAL_PAID_JOB_PROTOCOL' } };
      },
    });
    assert.equal(result.status, 'DELIVERED_REPORTED_SETTLED', JSON.stringify({ status: result.status, reason: result.reason }));
    assert.equal(result.response.status, 202);
    await capture.save(result);
  } finally { await capture.abort(); }
  return createJobBuyer({ directory: join(work, 'customer-' + handoff.job.id.replace(/:/g, '_')),
    acceptanceFile: destination, handoff, fetchImpl: transport });
}

try {
  assert.equal(await version(), NATIVE_SDK_VERSION);
  let input;
  if (!resumeDirectory) {
    const config = JSON.parse(await readFile(new URL('./example-merchant.json', import.meta.url)));
    const application = await readFile(new URL('./example-application.mjs', import.meta.url), 'utf8');
    input = JSON.parse(await readFile(new URL('./example-input.json', import.meta.url)));
    const gated = [
      '',
      'export async function gated(input, { signal }) {',
      "  const { access } = await import('node:fs/promises');",
      "  const { setTimeout } = await import('node:timers/promises');",
      '  for (;;) {',
      '    signal.throwIfAborted();',
      '    try { await access(process.env.SF_JOBS_JOURNEY_GATE); break; }',
      "    catch (error) { if (error.code !== 'ENOENT') throw error; }",
      '    await setTimeout(50, undefined, { signal });',
      '  }',
      '  return analyze(input, { signal });',
      '}', '',
    ].join('\n');
    await writeFile(join(work, 'application.mjs'), application + gated, { mode: 0o600 });
    config.application = './application.mjs'; config.workerCount = 1; config.memoryLimitMb = 64;
    config.environment = ['SF_JOBS_JOURNEY_GATE'];
    config.functions.gated = { ...structuredClone(config.functions.analyze), path: '/gated-analysis',
      description: 'Loopback journey application held until the operator releases its work.', timeoutMs: 30000 };
    await write(configPath, config);
  }
  await listen(facilitator); await startMerchant();
  assert.equal((await fetch(workspace.origin)).status, 200);
  let report;
  if (resumeDirectory) {
    const prepared = await model.get('report:2026.10'), snapshot = await model.snapshot();
    assert.equal(snapshot.jobs.length, 1, 'Resume the original pre-purchase report without recreating other jobs.');
    assert.equal(prepared.functionId, 'analyze');
    assert.equal(prepared.state, 'PREPARED');
    assert.equal(prepared.submittedAt, null); assert.equal(prepared.settlement, null);
    assert.equal((await model.deliveryOutbox.rows()).length, 0);
    input = structuredClone(prepared.input);
    report = await operator('/api/jobs/' + encodeURIComponent(prepared.id) + '/renew-claim', {
      expectedRevision: prepared.revision,
      reason: 'Recover the original prepared job after buyer runtime setup interrupted ticket delivery.',
    });
    assert.equal(report.created, false); assert.equal(report.job.id, prepared.id);
    assert.equal(report.job.revision, prepared.revision + 1);
    assert.equal(report.job.inputSha256, prepared.inputSha256);
    assert.deepEqual(report.purchase.payment, prepared.payment);
    const renewed = await model.get(prepared.id);
    assert.equal(renewed.history.at(-1).action, 'claim-renewed');
    assert.equal(renewed.history.at(-1).previousRevision, prepared.revision);
    assert.equal(renewed.history.at(-1).revision, renewed.revision);
  } else {
    report = await operator('/api/jobs', { functionId: 'analyze', input, label: 'October series report', reference: 'report:2026.10' });
  }
  assert.equal(new URL(report.purchase.url).searchParams.get('sf98_order'), report.job.id);
  const firstBuyer = await buy(report);
  const queued = await firstBuyer.inspect();
  assert.equal(queued.state, 'QUEUED'); assert.ok(queued.nativeSettlement);
  assert.equal((await model.get(report.job.id)).attempts.length, 0);
  const denied = await transport(report.statusUrl, { method: 'GET', redirect: 'manual' });
  assert.equal(denied.status, 404); await denied.body.cancel();
  await operator('/api/worker/start', {});
  const completed = await firstBuyer.wait({ pollMs: 100, deadlineMs: 15000 });
  const destination = join(work, 'analysis.json');
  const download = await firstBuyer.download({ destination });
  const analysis = JSON.parse(await readFile(destination));
  assert.equal(analysis.sum, 20); assert.equal(analysis.mean, 5);
  assert.deepEqual(analysis.rows.map(row => row.windowMean), [2, 3, 5, 7]);
  const path = '/api/jobs/' + encodeURIComponent(report.job.id);
  assert.equal((await operator(path)).state, 'COMPLETED');
  assert.equal(JSON.parse((await operator(path + '/preview')).text).mean, 5);
  const duplicate = await transport(report.purchase.url, { method: 'POST', headers: {
    'content-type': 'application/json', ...report.purchase.headers }, body: JSON.stringify(report.purchase.body), redirect: 'manual' });
  assert.equal(duplicate.status, 409); await duplicate.body.cancel();

  const recovery = await operator('/api/jobs', { functionId: 'gated', input, reference: 'recovery:2026.10' });
  const secondBuyer = await buy(recovery);
  await state(recovery.job.id, 'RUNNING');
  assert.equal((await operator('/api/worker/stop', {})).worker.draining, true);
  await model.stopWorker({ cancelRunning: true });
  assert.equal((await model.get(recovery.job.id)).state, 'INTERRUPTED');
  const retained = await model.get(report.job.id);
  await closeMerchant();

  // Exercise the concrete crash window between immutable-result link and temp unlink.
  const temporary = join(stateDirectory, 'results', '.result-' + randomUUID() + '.tmp');
  await link(join(stateDirectory, 'results', retained.result.file), temporary);
  assert.equal((await lstat(temporary)).nlink, 2);
  await startMerchant();
  await assert.rejects(lstat(temporary), error => error.code === 'ENOENT');
  const reopened = await openJobBuyer({ directory: firstBuyer.directory, fetchImpl: transport });
  assert.equal((await reopened.inspect()).result.sha256, completed.result.sha256);
  assert.equal((await reopened.download({ destination })).reused, true);
  const resumed = await model.get(recovery.job.id);
  assert.equal(resumed.state, 'INTERRUPTED');
  await operator('/api/jobs/' + encodeURIComponent(recovery.job.id) + '/retry',
    { expectedRevision: resumed.revision, reason: 'Resume the same paid application after worker interruption.' });
  await operator('/api/worker/start', {});
  const running = await state(recovery.job.id, 'RUNNING');
  await operator('/api/jobs/' + encodeURIComponent(recovery.job.id) + '/cancel',
    { expectedRevision: running.revision, reason: 'Cancel this running application attempt.' });
  const cancelled = await state(recovery.job.id, 'CANCELLED');
  await writeFile(gate, 'ready\n', { mode: 0o600 });
  await operator('/api/jobs/' + encodeURIComponent(recovery.job.id) + '/retry',
    { expectedRevision: cancelled.revision, reason: 'Finish the same paid application after operator release.' });
  const secondCompleted = await secondBuyer.wait({ pollMs: 100, deadlineMs: 15000 });
  const secondDownload = await secondBuyer.download({ destination: join(work, 'recovered-analysis.json') });
  assert.equal(secondDownload.sha256, download.sha256);
  assert.equal((await model.get(recovery.job.id)).attempts.length, 3);
  assert.equal(verified, 2); assert.equal(settled, 2);
  assert.equal((await model.deliveryOutbox.rows()).length, 2);
  const summary = {
    result: 'PASS', nativeSdk: NATIVE_SDK_VERSION, node: process.version,
    ...(keepWork ? { retainedWorkDirectory: work } : {}),
    facilitator: 'LOCAL_PROTOCOL_FIXTURE',
    transport: 'ORIGINAL_SF31_PUBLIC_TRANSPORT_WITH_LOOPBACK_REQUEST_SEAM',
    originalOfflineBuyerReviews: reviews, nativeVerifies: verified, nativeSettlements: settled,
    resumedPreparedJob: !!resumeDirectory, privateHandoffsRetainedBeforeBuyerPreparation: true,
    jobs: [{ jobId: report.job.id, state: completed.state, sha256: download.sha256, bytes: download.bytes },
      { jobId: recovery.job.id, state: secondCompleted.state, sha256: secondDownload.sha256, attempts: 3 }],
    recoveredTemporaryResultLink: true,
    lifecycle: ['operator preparation', 'original paid 202 and SF98 activation', 'queued worker and buyer result',
      'private operator preview', 'nonblocking drain and interruption', 'retained merchant and buyer reopen',
      'native worker cancellation', 'explicit same-paid-job retry'],
  };
  await closeMerchant(); await shutdown(facilitator);
  if (output) await write(output, summary);
  process.stdout.write(JSON.stringify(summary) + '\n');
  journeyCompleted = true;
} finally {
  try { await closeMerchant(); } finally {
    try { await shutdown(facilitator); } finally {
      if (journeyCompleted) {
        if (!keepWork) await rm(work, { recursive: true, force: true });
      } else process.stderr.write(JSON.stringify({ retainedWorkDirectory: work,
        purpose: 'Inspect the original failed operation and retained job before any recovery run.' }) + '\n');
    }
  }
}
