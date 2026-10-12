// MIT. One original Node checkout, receiving and restart on the retained application fixture.
// Run through native-continuation.py, which supplies disposable policy keys and a controlling PTY.
import assert from 'node:assert/strict';
import { createServer as httpServer, request as httpRequest } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { connect } from 'node:net';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { createNativeSellerServer, NATIVE_SDK_VERSION } from '../../../sf30-seller-sdk/native-factory.mjs';
import { openJobMerchant } from '../../../sf30-seller-sdk/jobs/model.mjs';
import { startJobSeller } from '../../../sf30-seller-sdk/jobs/merchant.mjs';
import { startCustomerServer } from '../../../sf30-seller-sdk/jobs/customer.mjs';
import { createPublicHttpsFetch } from '../../../sf31-buyer-client/public-transport.mjs';
import { readBytes, readJson, writeBytes, writeJson, jsonBytes, digest, exists,
  privateDirectory } from '../../node/store.mjs';
import { receiveCollection, inspectCollectionArchive, openReceivedLibrary } from '../../resource-library/collection-package.mjs';
import { openJobWorkspace } from '../model.mjs';
import { startJobCustomerWorkspace } from '../server.mjs';
import { readJobWorkspaceLaunch } from '../launch.mjs';
import { readJobCheckoutTicket } from './contract.mjs';

const origin = 'https://jobs-merchant.example';
const fixture = resolve(process.env.SF_JOBS_CHECKOUT_FIXTURE_DIR ?? '/');
assert.notEqual(fixture, '/', 'Use the original native-continuation.py launcher.');
const marker = await readJson(join(fixture, 'fixture.json'));
const browserApproval = marker.approvalMode === 'BROWSER';
const operation = browserApproval ? 'SCF-JOB-BROWSER-APPROVAL-0B8D-20261012'
  : 'SCF-JOB-CHECKOUT-CONTINUATION-0B8D-20261012';
const jobId = browserApproval ? 'browser-checkout:2026.10' : 'checkout:2026.10';
assert.equal(marker.schema, 'stellar-forge.sf88.job-checkout-journey.v1');
assert.equal(marker.operation, operation);
assert.equal(marker.fixtureDirectory, fixture);
assert.equal(fixture, join(marker.retainedDirectory, browserApproval ? 'checkout-browser-continuation' : 'checkout-continuation'));
const retained = marker.retainedDirectory, runtimeDirectory = resolve(fileURLToPath(new URL('../../', import.meta.url)));
assert.equal(marker.runtimeDirectory, runtimeDirectory);
assert.equal(process.env.NODE_EXTRA_CA_CERTS, join(fixture, 'tls', 'tls.pem'));
const directory = join(fixture, 'customer-workspace'), configPath = join(fixture, 'merchant.json');
const handoffPath = join(fixture, 'checkout.handoff.json'), output = join(fixture, 'native-result.json');
const profilePath = join(fixture, 'operator-profile.json'), merchantState = join(fixture, 'merchant-state');
const checkoutId = digest(JSON.stringify(['paid-job-checkout', origin + '/jobs/' + encodeURIComponent(jobId)]));
const intentId = 'job-checkout:' + checkoutId;
const fixtureAsset = 'C' + 'A'.repeat(55);
let merchant, seller, customer, model, host, received, complete = false, interrupted = false;
let frontend, proxy, facilitator, transport;
const sockets = new Set(), servers = new Set();
const traffic = { connects: 0, status: 0, result: 0 };
const progress = phase => process.stdout.write(JSON.stringify({ operation, phase }) + '\n');

async function nativeSdkVersion() {
  const require = createRequire(import.meta.url);
  let root = dirname(require.resolve('@x402/core/server'));
  for (let depth = 0; depth < 8; depth++, root = dirname(root)) {
    try {
      const metadata = JSON.parse(await readFile(join(root, 'package.json')));
      if (metadata.name === '@x402/core') return metadata.version;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  throw new Error('NATIVE_SDK_PACKAGE_REQUIRED');
}
async function immutable(path, bytes) {
  try { await writeBytes(path, bytes, { exclusive: true }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    assert.ok((await readBytes(path, Math.max(1048576, bytes.length))).equals(bytes), 'Retained fixture file changed: ' + path);
  }
}
async function serve(server) {
  servers.add(server);
  server.on('connection', socket => {
    sockets.add(socket); socket.once('close', () => sockets.delete(socket));
  });
  await new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => { server.off('error', fail); done(); });
  });
  return server;
}
async function shutdownServers() {
  for (const socket of sockets) socket.destroy();
  const closed = await Promise.allSettled([...servers].filter(server => server.listening).map(server =>
    new Promise((done, fail) => server.close(error => error ? fail(error) : done()))));
  servers.clear();
  const failures = closed.filter(value => value.status === 'rejected');
  if (failures.length) throw new AggregateError(failures.map(value => value.reason), 'CHECKOUT_FIXTURE_SERVERS_CLOSE_FAILED');
}
async function originalSnapshot() {
  const recordRoot = join(retained, 'merchant-state', 'records'), files = {};
  for (const name of (await readdir(recordRoot)).filter(name => name.endsWith('.json')).sort())
    files[name] = digest(await readFile(join(recordRoot, name)));
  return { configSha256: digest(await readFile(join(retained, 'merchant.json'))),
    applicationSha256: digest(await readFile(marker.application)), records: files };
}
async function api(path, body, method) {
  const response = await fetch(host.origin + path, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { authorization: 'Bearer ' + host.token, origin: host.origin,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(JSON.stringify({ path, status: response.status, value })),
    { code: 'CHECKOUT_API_FAILED', status: response.status });
  return value;
}
// This launcher can approve only its existing disposable native fixture.
// Read the SF62 review through the same authenticated route used by the browser.
async function approveBrowserFixture(taskId) {
  const path = '/api/job-checkout/checkouts/' + checkoutId + '/approval';
  const handoff = await readJson(handoffPath);
  assert.equal(handoff.job.id, jobId); assert.equal(handoff.purchase.orderReference, jobId);
  const body = Buffer.from(JSON.stringify({ jobId }));
  let snapshot;
  const deadline = Date.now() + 80000;
  while (Date.now() < deadline) {
    assert.equal(interrupted, false, 'Browser fixture was interrupted.');
    const current = await api(path);
    assert.equal(current.mode, 'BROWSER');
    assert.equal(current.checkoutId, checkoutId); assert.equal(current.intentId, intentId);
    if (current.snapshot?.state === 'AWAITING_OPERATOR') {
      assert.equal(current.taskId, taskId); assert.equal(current.executing, true);
      snapshot = current.snapshot; break;
    }
    const task = model.checkout.get(checkoutId).task;
    assert.equal(task?.id, taskId, 'Original checkout task changed while loading its live review.');
    assert.equal(task.state, 'RUNNING', JSON.stringify(task));
    await new Promise(done => setTimeout(done, 100));
  }
  assert.ok(snapshot, 'Original SF62 browser review was not received.');
  assert.equal(snapshot.intentId, intentId);
  const expected = {
    schema: 'stellar-forge.sf62.operator-review.v1',
    request_id: intentId, actor: 'fixture-job-checkout', service: 'fixture-application-jobs',
    resource: origin + '/analysis?sf98_order=' + encodeURIComponent(jobId), method: 'POST',
    scheme: 'exact', network: 'stellar:testnet', asset: fixtureAsset, pay_to: 'UNVERIFIED_DEMO_RECIPIENT',
    max_atomic_units_to_reserve: '10000', max_timeout_seconds: 60,
    body_present: true, body_bytes: body.length, body_sha256: digest(body),
  };
  for (const [key, value] of Object.entries(expected))
    assert.equal(snapshot.review[key], value, 'Disposable native review changed: ' + key);
  assert.deepEqual(snapshot.review.complete_original_accepted_terms, handoff.purchase.payment);
  assert.match(snapshot.review.request_sha256, /^[a-f0-9]{64}$/);
  assert.match(snapshot.review.accepted_terms_sha256, /^[a-f0-9]{64}$/);
  assert.equal(snapshot.current_native_budget_estimate.approved, true);
  assert.equal(snapshot.current_native_budget_estimate.reserved_max_base_units, '10000');
  for (const key of ['max_single', 'max_total', 'max_per_utc_day',
    'max_per_actor_utc_day', 'max_per_service_utc_day'])
    assert.match(snapshot.current_native_budget_estimate.limit_remaining[key], /^(0|[1-9][0-9]*)$/);
  await immutable(join(fixture, 'browser-review.json'), jsonBytes(snapshot));
  const decision = { intent: intentId, approvalId: snapshot.id,
    requestSha256: snapshot.review.request_sha256, decision: 'approve', taskId };
  // A delayed decision from an earlier task must leave this live review unchanged.
  await assert.rejects(api(path, { ...decision, taskId: 'previous-checkout-task' }),
    error => error.status === 409 && error.message.includes('JOB_CHECKOUT_APPROVAL_TASK_CHANGED'));
  const unchanged = await api(path);
  assert.equal(unchanged.snapshot.id, snapshot.id);
  assert.equal(unchanged.snapshot.state, 'AWAITING_OPERATOR');
  const decided = await api(path, decision);
  assert.equal(decided.approval.snapshot.id, snapshot.id);
  assert.ok(['APPROVING', 'APPROVED'].includes(decided.approval.snapshot.state));
  progress('original browser decision accepted');
}

async function runCheckout(kind) {
  const before = await api('/api/job-checkout/checkouts/' + checkoutId);
  const started = await api('/api/job-checkout/checkouts/' + checkoutId + '/start', { kind, expectedRevision: before.revision });
  if (browserApproval && kind === 'execute') await approveBrowserFixture(started.task.id);
  const after = await model.checkout.wait(checkoutId);
  assert.equal(after.task.state, 'COMPLETE', JSON.stringify({ kind, phase: after.phase, error: after.lastError,
    nativeDirectory: after.nativeDirectory }));
  return after;
}
async function startWorkspace() {
  model = await openJobWorkspace({ directory, buyerRoots: [], fileRoots: [], fetchImpl: transport,
    checkout: { operatorProfile: profilePath, runtimeDirectory, timeoutMs: 90000 } });
  host = await startJobCustomerWorkspace({ model, port: 0, browserApproval });
  const ready = await readJobWorkspaceLaunch({ directory, runtimeDirectory,
    operatorProfile: profilePath, pid: process.pid });
  assert.equal(ready.checkoutUrl, host.checkoutUrl);
}
async function closeWorkspace() {
  try { await host?.close(); }
  finally {
    host = null;
    if (model) {
      const current = model;
      try {
        const closing = current.close();
        assert.equal(current.close(), closing, 'All close callers await the same native-child drain.');
        await closing;
      } finally { model = null; }
    }
  }
}
async function transfer(path, body) {
  const ticket = await api(path, body), response = await fetch(host.origin + ticket.url);
  assert.equal(response.status, 200);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.length, ticket.bytes); assert.equal(digest(bytes), ticket.sha256);
  return { bytes, sha256: ticket.sha256 };
}
const stop = () => {
  interrupted = true;
  // The model drains its actual original native child before releasing its lease.
  void model?.close().catch(() => {});
};
process.on('SIGINT', stop); process.on('SIGTERM', stop);

try {
  const nativeSdk = await nativeSdkVersion();
  assert.equal(nativeSdk, NATIVE_SDK_VERSION);
  const original = await originalSnapshot();
  assert.equal(original.configSha256, marker.original.configSha256);
  assert.equal(original.applicationSha256, marker.original.applicationSha256);
  const raw = JSON.parse(await readFile(join(retained, 'merchant.json')));
  assert.equal(raw.publicOrigin, origin);
  assert.equal(raw.functions.analyze.payment.asset, 'UNVERIFIED_DEMO_ASSET');
  assert.equal(raw.functions.analyze.payment.payTo, 'UNVERIFIED_DEMO_RECIPIENT');
  assert.equal(raw.functions.analyze.payment.amount, '10000');
  assert.deepEqual(raw.environment ?? [], ['SF_JOBS_JOURNEY_GATE']);
  const report = await readJson(join(retained, 'merchant-state', 'records', 'report:2026.10.json'));
  assert.deepEqual(report.input, { values: [2, 4, 6, 8], window: 2 });
  const configured = { ...raw, application: marker.application, workerCount: 1, memoryLimitMb: 64,
    maxPending: 4, maxJobs: 32, functions: { analyze: { ...raw.functions.analyze,
      payment: { ...raw.functions.analyze.payment, asset: fixtureAsset } } } };
  await immutable(configPath, jsonBytes(configured));
  await immutable(join(fixture, 'signer.mjs'), Buffer.from([
    '// Disposable signer envelope for this one local original-protocol journey.',
    'export async function sign({ challenge, accepted }) {',
    "  if (challenge.resource?.url !== " + JSON.stringify(origin + '/analysis?sf98_order=' + encodeURIComponent(jobId)) + " ||",
    "      accepted.scheme !== 'exact' || accepted.network !== 'stellar:testnet' ||",
    "      accepted.asset !== 'C' + 'A'.repeat(55) || accepted.payTo !== 'UNVERIFIED_DEMO_RECIPIENT' ||",
    "      accepted.amount !== '10000') throw new Error('CHECKOUT_FIXTURE_TERMS_CHANGED');",
    "  return { x402Version: 2, resource: challenge.resource, accepted, extensions: challenge.extensions,",
    "    payload: { fixture: 'LOCAL_PAID_JOB_PROTOCOL', jobId: " + JSON.stringify(jobId) + " } };",
    '}', '',
  ].join('\n')));
  const profile = {
    operator: { python: process.env.SF_JOBS_CHECKOUT_PYTHON, actor: 'fixture-job-checkout',
      service: 'fixture-application-jobs', policy: join(fixture, 'policy.json'), ledger: join(fixture, 'ledger.sqlite') },
    signerModule: join(fixture, 'signer.mjs'),
    buyerTransport: { mode: 'explicit-connect', origin, proxyEnv: 'SF_JOBS_CHECKOUT_PROXY' },
  };
  await immutable(profilePath, jsonBytes(profile));
  const counterPath = join(fixture, 'facilitator.json');
  let counters = await exists(counterPath) ? await readJson(counterPath) :
    { operation, verifies: 0, settles: 0, paymentSha256: null };
  assert.equal(counters.operation, operation);
  let counterTail = Promise.resolve();
  facilitator = await serve(httpServer((request, response) => {
    const action = counterTail.then(async () => {
      const chunks = []; let size = 0;
      for await (const chunk of request) {
        size += chunk.length; assert.ok(size <= 262144); chunks.push(chunk);
      }
      const value = size ? JSON.parse(Buffer.concat(chunks)) : null;
      let result;
      if (request.url === '/supported') result = {
        kinds: [{ x402Version: 2, scheme: 'exact', network: 'stellar:testnet' }], extensions: ['bazaar'], signers: {},
      };
      else if (['/verify', '/settle'].includes(request.url)) {
        for (const field of ['scheme', 'network', 'asset', 'payTo', 'amount', 'maxTimeoutSeconds'])
          assert.equal(value.paymentRequirements[field], configured.functions.analyze.payment[field]);
        assert.deepEqual(value.paymentPayload.payload, { fixture: 'LOCAL_PAID_JOB_PROTOCOL', jobId });
        const paymentSha256 = digest(JSON.stringify(value.paymentPayload));
        if (counters.paymentSha256) assert.equal(paymentSha256, counters.paymentSha256);
        counters.paymentSha256 = paymentSha256;
        if (request.url === '/verify') {
          counters.verifies++;
          result = { isValid: true, payer: 'LOCAL_PAID_JOB_PROTOCOL' };
        } else {
          counters.settles++;
          result = { success: true, network: 'stellar:testnet',
            transaction: digest(operation + ':' + jobId), payer: 'LOCAL_PAID_JOB_PROTOCOL' };
        }
        await writeJson(counterPath, counters);
      }
      response.writeHead(result ? 200 : 404, { 'content-type': 'application/json' });
      response.end(JSON.stringify(result ?? {}));
    });
    counterTail = action.catch(() => {});
    action.catch(() => { if (!response.headersSent) response.writeHead(500); response.end('{}'); });
  }));
  merchant = await openJobMerchant({ configPath, directory: merchantState,
    env: { SF_JOBS_JOURNEY_GATE: join(retained, 'release-application') } });
  seller = await startJobSeller(merchant, { port: 0, operationsPort: 0,
    nativeFactory: compiled => createNativeSellerServer(compiled, {
      facilitatorClient: new HTTPFacilitatorClient({ url: 'http://127.0.0.1:' + facilitator.address().port }),
    }) });
  customer = await startCustomerServer({ model: merchant, port: 0 });

  frontend = await serve(httpsServer({
    key: await readFile(join(fixture, 'tls', 'tls.key')), cert: await readFile(join(fixture, 'tls', 'tls.pem')),
    minVersion: 'TLSv1.2',
  }, (request, response) => {
    const allowedPurchase = request.method === 'POST' &&
      request.url === '/analysis?sf98_order=' + encodeURIComponent(jobId);
    const allowedGet = request.method === 'GET' &&
      ['/jobs/' + encodeURIComponent(jobId), '/jobs/' + encodeURIComponent(jobId) + '/result'].includes(request.url);
    if (request.headers.host !== 'jobs-merchant.example' || !(allowedPurchase || allowedGet)) {
      response.writeHead(404); response.end(); return;
    }
    if (allowedGet) traffic[request.url.endsWith('/result') ? 'result' : 'status']++;
    const target = new URL(allowedGet ? customer.url : seller.url);
    const forwarded = httpRequest({ hostname: '127.0.0.1', port: target.port, method: request.method,
      path: request.url, headers: { ...request.headers, connection: 'close' }, agent: false }, incoming => {
      response.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(response);
    });
    request.once('aborted', () => forwarded.destroy());
    forwarded.once('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
    request.pipe(forwarded);
  }));
  proxy = await serve(httpServer((_request, response) => { response.writeHead(405); response.end(); }));
  proxy.on('connect', (request, socket, head) => {
    if (request.url !== 'jobs-merchant.example:443' || head.length) { socket.destroy(); return; }
    traffic.connects++;
    const upstream = connect({ host: '127.0.0.1', port: frontend.address().port });
    sockets.add(upstream); upstream.once('close', () => sockets.delete(upstream));
    upstream.once('connect', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      socket.pipe(upstream); upstream.pipe(socket);
    });
    upstream.once('error', () => socket.destroy());
    socket.once('error', () => upstream.destroy());
    socket.once('close', () => upstream.destroy());
  });
  process.env.SF_JOBS_CHECKOUT_PROXY = 'http://127.0.0.1:' + proxy.address().port;
  transport = createPublicHttpsFetch({ trustedProxy: profile.buyerTransport, timeoutMs: 30000 });

  // Save the capability before creating the merchant record or native operation.
  const claimPath = join(fixture, 'claim-token.txt');
  if (!await exists(claimPath)) await immutable(claimPath, Buffer.from(randomBytes(32).toString('base64url') + '\n'));
  const claimToken = (await readBytes(claimPath, 256)).toString('utf8').trim();
  assert.match(claimToken, /^[A-Za-z0-9_-]{43}$/);
  if (!await exists(handoffPath)) {
    const recordPath = join(directory, 'checkout', 'records', checkoutId, 'record.json');
    if (await exists(recordPath)) {
      const record = await readJson(recordPath);
      await immutable(handoffPath, await readBytes(join(directory, 'checkout', 'records', checkoutId,
        'tickets', record.handoffSha256 + '.json')));
    } else {
      const handoff = await merchant.createJob({ functionId: 'analyze', input: report.input,
        label: 'October checkout application', reference: jobId, claimToken });
      assert.equal(handoff.job.state, 'PREPARED', 'Recover the retained original ticket for an already submitted job.');
      await immutable(handoffPath, jsonBytes(handoff));
    }
  }
  const ticketBytes = await readBytes(handoffPath), ticket = readJobCheckoutTicket(ticketBytes);
  assert.equal(ticket.id, checkoutId); assert.equal(ticket.handoff.claimToken, claimToken);
  assert.equal(ticket.summary.inputSha256, (await merchant.get(jobId)).inputSha256);
  await startWorkspace();
  for (const path of ['/jobs/', '/jobs/checkout/', '/jobs/checkout/app.mjs', '/jobs/checkout/style.css', '/', '/collections'])
    assert.equal((await fetch(host.origin + path)).status, 200, path);
  const imported = await api('/api/job-checkout/import', {
    handoffBase64: ticketBytes.toString('base64'), label: 'October checkout application',
  });
  assert.equal(imported.checkout.id, checkoutId);
  assert.equal(JSON.stringify(imported).includes(claimToken), false);
  const resumed = imported.reused;
  let checked = imported.checkout;
  if (resumed) checked = await runCheckout('recover');
  if (!checked.attempted && checked.phase !== 'REVIEWED') {
    progress('original-offline-review');
    checked = await runCheckout('review');
    assert.equal(checked.review.mode, 'OFFLINE_REVIEW');
    assert.equal(checked.review.bodySha256, ticket.summary.bodySha256);
    assert.deepEqual(checked.review.acceptedTerms, ticket.summary.acceptedTerms);
  }
  if (!checked.attempted && checked.phase === 'REVIEWED') {
    progress('original-native-checkout');
    checked = await runCheckout('execute');
  }
  assert.equal(checked.phase, 'ACCEPTED', JSON.stringify({
    phase: checked.phase, error: checked.lastError, nativeDirectory: checked.nativeDirectory,
  }));
  assert.equal(checked.native.status, 'DELIVERED_REPORTED_SETTLED');
  assert.equal(checked.native.httpStatus, 202);
  const entryId = checked.jobEntryId, accepted = await api('/api/job-workspace/jobs/' + entryId);
  assert.equal(accepted.receipt.purchase.kind, 'SF88_NATIVE_RESULT');
  const purchase = await readJson(join(accepted.directory, 'purchase.json'), 1048576);
  assert.equal(purchase.source.nativeRecord.intentId, intentId);
  assert.equal(purchase.source.nativeRecord.native.mode, 'ORIGINAL_OPERATOR_APPROVED_BUYER_ATTEMPT');
  const attemptsBeforeRestart = digest(await readBytes(join(checked.nativeDirectory, 'attempt.json')));
  const settlementBeforeRestart = (await merchant.deliveryOutbox.rows()).map(row => row.event.id);
  assert.equal(settlementBeforeRestart.length, 1);

  progress('application-result-and-library');
  const currentJob = await merchant.get(jobId);
  if (['FAILED', 'INTERRUPTED', 'CANCELLED'].includes(currentJob.state))
    await merchant.retry({ id: jobId, expectedRevision: currentJob.revision,
      reason: 'Continue the same purchased checkout application after fixture interruption.' });
  await merchant.startWorker();
  await api('/api/job-workspace/jobs/' + entryId + '/start', { kind: 'fetch', deadlineMs: 30000, pollMs: 100 });
  const delivered = await model.wait(entryId);
  assert.equal(delivered.task.state, 'COMPLETE', delivered.lastError ?? '');
  assert.equal(delivered.resource.status, 'VERIFIED');
  const resource = delivered.resource;
  assert.equal(JSON.parse((await api('/api/resources/' + resource.id + '/preview')).text).mean, 5);
  const downloaded = await transfer('/api/resources/' + resource.id + '/download', {});
  assert.equal(JSON.parse(downloaded.bytes).sum, 20); assert.equal(downloaded.sha256, resource.sha256);
  const note = 'October application purchased through the original checkout; mean 5 and sum 20.';
  let annotation = resource.annotation;
  if (annotation.note !== note) annotation = await api('/api/resources/' + resource.id + '/note', {
    expectedRevision: annotation.revision, operationId: operation + ':note',
    note, tags: ['october', 'application'], starred: true,
  }, 'PATCH');
  const collectionId = 'checkout-application-result';
  let collection;
  try { collection = await api('/api/collections/' + collectionId); }
  catch (error) { if (error.status !== 404) throw error; }
  if (!collection) collection = await api('/api/collections', {
    id: collectionId, name: 'October checkout result', note: 'Purchased application and original job identity.',
    expectedRevision: 0, operationId: operation + ':collection',
    members: [{ id: resource.id, sha256: resource.sha256, annotationRevision: annotation.revision, mode: 'current' }],
  }, 'PUT');
  assert.equal(collection.members.length, 1);
  const exported = await transfer('/api/collections/' + collectionId + '/download', { revision: collection.revision });
  const archive = join(fixture, 'checkout-application-result.tar');
  await immutable(archive, exported.bytes);
  const inspected = await inspectCollectionArchive(archive, { expectedSha256: exported.sha256 });
  assert.equal(inspected.manifest.objects.length, 1);
  assert.equal(inspected.manifest.collection.members[0].job.acceptanceSha256, delivered.receipt.acceptanceSha256);
  assert.equal(JSON.stringify(inspected.manifest).includes(claimToken), false);
  const intake = await receiveCollection({ archive, destination: join(fixture, 'received-collection'),
    resume: true, expectedSha256: exported.sha256 });
  received = await openReceivedLibrary({ directory: intake.directory, state: join(fixture, 'received-library') });
  const receivedRows = received.search({ limit: 50 }).items;
  assert.equal(receivedRows.length, 1);
  assert.equal(receivedRows[0].origin.resource.job.jobId, jobId);
  assert.equal(JSON.parse((await received.preview(receivedRows[0].id)).text).mean, 5);

  progress('reopen-original-checkout-and-customer');
  const priorToken = host.token;
  await closeWorkspace(); await startWorkspace();
  assert.notEqual(host.token, priorToken);
  const reopened = await runCheckout('recover');
  assert.equal(reopened.phase, 'ACCEPTED'); assert.equal(reopened.jobEntryId, entryId);
  const reopenedJob = await api('/api/job-workspace/jobs/' + entryId);
  assert.equal(reopenedJob.receipt.purchase.kind, 'SF88_NATIVE_RESULT');
  assert.equal(reopenedJob.receipt.delivery.sha256, resource.sha256);
  assert.equal(reopenedJob.resource.annotation.note, note);
  assert.equal((await api('/api/collections/' + collectionId)).members.length, 1);
  assert.equal(digest(await readBytes(join(checked.nativeDirectory, 'attempt.json'))), attemptsBeforeRestart);
  assert.deepEqual((await merchant.deliveryOutbox.rows()).map(row => row.event.id), settlementBeforeRestart);
  assert.equal(counters.verifies, 1); assert.equal(counters.settles, 1);
  assert.deepEqual(await originalSnapshot(), original);
  assert.equal(interrupted, false);
  const summary = {
    result: 'PASS', operation, node: process.version, nativeSdk,
    retainedWorkDirectory: retained, fixtureDirectory: fixture, customerWorkspace: directory,
    fixture: { protocol: 'LOCAL_PAID_JOB_PROTOCOL', transport: 'ORIGINAL_EXPLICIT_CONNECT_AND_VERIFIED_TLS',
      approval: browserApproval ? 'ORIGINAL_SF62_BROWSER_BROKER_WITH_DISPOSABLE_FIXTURE_POLICY'
        : 'ORIGINAL_SF62_PTY_WITH_DISPOSABLE_FIXTURE_POLICY',
      source: { originalConfigSha256: original.configSha256, originalApplicationSha256: original.applicationSha256,
        checkoutConfigSha256: digest(await readBytes(configPath)), application: marker.application,
        asset: fixtureAsset, network: 'stellar:testnet' } },
    sources: { runtimeDirectory, buyerClientSha256: digest(await readFile(join(runtimeDirectory, 'node', 'client.mjs'))),
      checkoutControllerSha256: digest(await readFile(new URL('./controller.mjs', import.meta.url))),
      driverSha256: digest(await readFile(fileURLToPath(import.meta.url))) },
    checkout: { id: checkoutId, intentId, phase: reopened.phase, resumed, nativeDirectory: checked.nativeDirectory,
      nativeStatus: checked.native.status, httpStatus: checked.native.httpStatus, jobEntryId: entryId },
    artifact: { sha256: resource.sha256, bytes: resource.bytes },
    collection: { id: collectionId, archiveSha256: exported.sha256, receivedResources: receivedRows.length },
    nativeVerifies: counters.verifies, nativeSettlements: counters.settles, traffic,
    lifecycle: ['retained merchant application', 'prepared private ticket', 'original SDK offline review',
      browserApproval ? 'original browser decision and SF62/SF36 reservation'
        : 'original native CLI and SF62/SF36 reservation', 'native paid 202 and SF98 activation',
      'actual BuyerResult adoption', 'verified application result', 'library preview and download',
      'collection export and receiving', 'same-checkout recovery and customer restart'],
  };
  if (browserApproval) {
    const review = await readJson(join(fixture, 'browser-review.json'));
    assert.equal(review.intentId, intentId);
    summary.browserApproval = { approvalId: review.id, intentId,
      requestSha256: review.review.request_sha256, acceptedTermsSha256: review.review.accepted_terms_sha256,
      staleTaskDecision: 'REJECTED_BEFORE_RESERVATION', retainedReview: join(fixture, 'browser-review.json') };
  }
  await received.close(); received = null;
  await closeWorkspace();
  await writeJson(output, summary); complete = true;
  process.stdout.write(JSON.stringify({ operation, result: 'PASS', output }) + '\n');
} finally {
  process.off('SIGINT', stop); process.off('SIGTERM', stop);
  const closed = await Promise.allSettled([received?.close(), closeWorkspace()]);
  try { await shutdownServers(); } catch (error) { closed.push({ status: 'rejected', reason: error }); }
  closed.push(...await Promise.allSettled([seller?.close(), customer?.close()]));
  try { await merchant?.close(); } catch (error) { closed.push({ status: 'rejected', reason: error }); }
  const failures = closed.filter(value => value.status === 'rejected');
  if (!complete || failures.length) process.stderr.write(JSON.stringify({
    operation, fixtureDirectory: fixture, customerWorkspace: directory, retainedWorkDirectory: retained,
  }) + '\n');
  if (failures.length) throw new AggregateError(failures.map(value => value.reason), 'CHECKOUT_CONTINUATION_CLOSE_FAILED');
}
