// MIT. Original Lab merchant, SF88 browser approval and complete MCP receiving.
// Run through lab-edd-native-receiving.py, which owns the private fixture and PTY.
import assert from 'node:assert/strict';
import { createServer as httpServer, request as httpRequest } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { connect } from 'node:net';
import { readFile, rename, rm, realpath } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { createNativeSellerServer, NATIVE_SDK_VERSION } from
  '../../stellar/scf-starforge-20261009/sf30-seller-sdk/native-factory.mjs';
import { openJobMerchant } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/model.mjs';
import { startJobSeller } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/merchant.mjs';
import { startCustomerServer } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/customer.mjs';
import { startJobsWorkspace } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/workspace/server.mjs';
import { CATALOG_PATH, REQUEST_PATH, WITHDRAW_PATH } from
  '../../stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/intake/protocol.mjs';
import { isInputRoute } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/inputs/http.mjs';
import { readBytes, readJson, writeBytes, writeJson, jsonBytes, digest, exists, privateDirectory, syncDirectory } from
  '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/node/store.mjs';
import { validStrKey } from '../../stellar/scf-starforge-20261009/sf86-rpc-transfer-reconcile/terms.mjs';
import { initializeLabWorkspaceMerchant } from './lab-edd-setup.mjs';
import { readMerchantConfig } from './config.mjs';
import { receiveLaboratoryOperator } from './lab-edd-receiving.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PREFIX = 'stellar/scf-starforge-20261009';
const OPERATION = 'MCCAMPBELL-LAB-MCP-RECEIVING-9F77-20261012';
const JOB = 'mccampbell-lab-mcp:2026.10';
const ORIGIN = 'https://jobs-merchant.example';
const SCHEMA = 'stellar-forge.lab-edd-native-fixture.v1';
const FUNCTION = 'laboratoryReview';
const PAYMENT = Object.freeze({
  scheme: 'exact', network: 'stellar:testnet',
  asset: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
  payTo: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
  amount: '10000', maxTimeoutSeconds: 60,
});
const PAYER = 'GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H';
const FIELDS = ['scheme', 'network', 'asset', 'payTo', 'amount', 'maxTimeoutSeconds'];
const HASH = /^[a-f0-9]{64}$/;

async function immutable(path, bytes) {
  bytes = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  try { await writeBytes(path, bytes, { exclusive: true }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    assert.ok((await readBytes(path, Math.max(1048576, bytes.length))).equals(bytes),
      'Continue with the original retained native file: ' + path);
  }
}
async function sdkVersion() {
  const require = createRequire(import.meta.url);
  let root = dirname(require.resolve('@x402/core/server'));
  for (let depth = 0; depth < 8; depth++, root = dirname(root)) {
    try {
      const metadata = JSON.parse(await readFile(join(root, 'package.json')));
      if (metadata.name === '@x402/core') return metadata.version;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  throw new Error('ORIGINAL_NATIVE_SDK_PACKAGE_REQUIRED');
}
async function completeMcpDirectory({ fixture, connection, merchantConnection }) {
  const final = join(fixture, 'mcp'), target = join(final, 'laboratory-mcp.json');
  if (await exists(target)) {
    await readMerchantConfig(target); return target;
  }
  assert.equal(await exists(final), false, 'Restore the complete retained MCP directory.');
  const staging = join(fixture, '.mcp-preparing');
  const marker = { schema: SCHEMA, operation: OPERATION, directory: staging, connection, merchantConnection };
  await immutable(join(fixture, 'mcp-preparation.json'), jsonBytes(marker));
  const staged = join(staging, 'laboratory-mcp.json');
  if (await exists(staging) && !await exists(staged)) {
    // This exact launcher owns an incomplete initializer, before any customer or
    // checkout operation. Customer state is outside this generated directory.
    assert.equal(await realpath(staging), staging);
    await privateDirectory(staging, { create: false });
    await rm(staging, { recursive: true });
  }
  if (!await exists(staged))
    await initializeLabWorkspaceMerchant({ directory: staging, connection, merchantConnection,
      name: 'Original Lab EDD native receiving' });
  await readMerchantConfig(staged);
  await rename(staging, final); await syncDirectory(fixture);
  await readMerchantConfig(target);
  return target;
}

/**
 * One source-selected local protocol fixture around the actual full MCP receiver.
 * The original SDK and SF88 produce the payment and job results. The disposable
 * facilitator and signer are the maintained checkout fixture's explicit seam.
 */
export async function receiveLaboratoryNativeFixture({
  directory = process.env.SF_LAB_NATIVE_FIXTURE_DIR,
  signal, environment = process.env, onProgress,
} = {}) {
  assert.equal(process.platform, 'linux', 'Use the original Linux PTY/process-owner fixture.');
  assert(Number(process.versions.node.split('.')[0]) >= 24, 'Use the existing Node 24+ SQLite runtime.');
  assert(typeof directory === 'string' && directory !== '/' && resolve(directory) === directory,
    'Run the original Python launcher with one canonical private fixture directory.');
  const fixture = await privateDirectory(directory, { create: false });
  assert.equal(await realpath(fixture), fixture);
  const marker = await readJson(join(fixture, 'fixture.json'));
  assert.equal(marker.schema, SCHEMA); assert.equal(marker.operation, OPERATION);
  assert.equal(marker.jobId, JOB); assert.equal(marker.origin, ORIGIN); assert.equal(marker.directory, fixture);
  const sourceRoot = await realpath(resolve(HERE, '../..'));
  assert.equal(marker.sourceRoot, sourceRoot);
  const application = join(sourceRoot, PREFIX, 'sf30-seller-sdk/lab-edd/application.mjs');
  const examplePath = join(sourceRoot, PREFIX, 'sf30-seller-sdk/lab-edd/merchant.example.json');
  const runtimeDirectory = join(sourceRoot, PREFIX, 'sf88-operator-buyer-cli');
  assert.equal(marker.application, application);
  assert.equal(digest(await readFile(application)), marker.applicationSha256);
  assert.equal(digest(await readFile(examplePath)), marker.merchantExampleSha256);
  assert.equal(environment.NODE_EXTRA_CA_CERTS, join(fixture, 'tls', 'tls.pem'));
  assert.equal(process.env.NODE_EXTRA_CA_CERTS, environment.NODE_EXTRA_CA_CERTS);
  assert.match(environment.MCP_ACCESS_TOKEN ?? '', /^[a-f0-9]{64}$/);
  assert.ok(validStrKey(PAYMENT.asset, 'C') && validStrKey(PAYMENT.payTo, 'G') && validStrKey(PAYER, 'G'));
  assert.notEqual(PAYMENT.payTo, PAYER);
  const nativeSdk = await sdkVersion();
  assert.equal(nativeSdk, NATIVE_SDK_VERSION);

  const raw = JSON.parse(await readFile(examplePath, 'utf8'));
  assert.equal(raw.schema, 'stellar-forge.paid-jobs.v1');
  assert.equal(raw.functions[FUNCTION].path, '/laboratory-review');
  assert.deepEqual(raw.environment, ['LAB_EDD_TEMP_ROOT', 'LAB_EDD_PYTHON', 'SF30_JOB_TEMP']);
  assert.deepEqual(Object.keys(raw.functions[FUNCTION].inputFiles.slots).sort(),
    ['baseline', 'baseline_decisions', 'decisions', 'reconciliation', 'source']);
  const configured = {
    ...raw, application, publicOrigin: ORIGIN,
    functions: { ...raw.functions, [FUNCTION]: { ...raw.functions[FUNCTION], payment: { ...PAYMENT } } },
  };
  const purchasePath = configured.functions[FUNCTION].path;
  const purchaseUrl = ORIGIN + purchasePath + '?sf98_order=' + encodeURIComponent(JOB);
  const checkoutId = digest(JSON.stringify(['paid-job-checkout', ORIGIN + '/jobs/' + encodeURIComponent(JOB)]));
  const intentId = 'job-checkout:' + checkoutId;
  const configPath = join(fixture, 'merchant.json'), merchantState = join(fixture, 'merchant-state');
  const profilePath = join(fixture, 'operator-profile.json'), scratch = join(fixture, 'scratch');
  await immutable(configPath, jsonBytes(configured));
  for (const path of [scratch, join(fixture, 'customer'), join(fixture, 'receiver')])
    assert.equal(await realpath(await privateDirectory(path)), path);
  await immutable(join(fixture, 'signer.mjs'), Buffer.from([
    '// Original disposable LOCAL_PAID_JOB_PROTOCOL signer, limited to this retained job.',
    'export async function sign({ challenge, accepted }) {',
    '  const expected = ' + JSON.stringify(PAYMENT) + ';',
    '  if (challenge.resource?.url !== ' + JSON.stringify(purchaseUrl) + ' ||',
    '      Object.entries(expected).some(([key,value]) => accepted[key] !== value))',
    "    throw new Error('LAB_FIXTURE_ORIGINAL_TERMS_CHANGED');",
    '  return { x402Version: 2, resource: challenge.resource, accepted, extensions: challenge.extensions,',
    "    payload: { fixture: 'LOCAL_PAID_JOB_PROTOCOL', jobId: " + JSON.stringify(JOB) + ' } };',
    '}', '',
  ].join('\n')));
  const profile = {
    operator: { python: marker.python, actor: 'fixture-job-checkout', service: 'fixture-application-jobs',
      policy: join(fixture, 'policy.json'), ledger: join(fixture, 'ledger.sqlite') },
    signerModule: join(fixture, 'signer.mjs'),
    buyerTransport: { mode: 'explicit-connect', origin: ORIGIN, proxyEnv: 'SF_JOBS_CHECKOUT_PROXY' },
  };
  await immutable(profilePath, jsonBytes(profile));
  const counterPath = join(fixture, 'facilitator.json');
  let counters = await exists(counterPath) ? await readJson(counterPath) :
    { operation: OPERATION, jobId: JOB, verifies: 0, settles: 0, paymentSha256: null };
  assert.equal(counters.operation, OPERATION); assert.equal(counters.jobId, JOB);
  for (const key of ['verifies', 'settles']) assert(Number.isSafeInteger(counters[key]) && counters[key] >= 0);
  if (counters.paymentSha256 !== null) assert.match(counters.paymentSha256, HASH);
  let merchant, seller, customer, operator, frontend, proxy, facilitator;
  let counterTail = Promise.resolve(), originalResult, complete = false;
  const sockets = new Set(), servers = new Set(), forwards = new Set();
  const traffic = { connects: 0, purchases: 0, status: 0, result: 0, intakeCatalog: 0,
    intakePrepare: 0, intakeWithdraw: 0, inputFiles: 0 };
  const controller = new AbortController();
  const activeSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const abort = () => controller.abort(Error('Original Lab native receiving interrupted.'));
  process.on('SIGINT', abort); process.on('SIGTERM', abort);
  const priorProxy = process.env.SF_JOBS_CHECKOUT_PROXY;
  const startedAt = new Date().toISOString();
  const progress = async (phase, detail = {}) => {
    activeSignal.throwIfAborted();
    const value = { operationId: OPERATION, phase, at: new Date().toISOString(), ...detail };
    if (onProgress) await onProgress(value);
    else process.stdout.write(JSON.stringify(value) + '\n');
  };
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
  async function closeOriginalOwners() {
    const failures = [];
    // receiveLaboratoryOperator has already drained its original checkout,
    // customer, process host and retained-file owners before this fixture closes.
    try { await operator?.close(); } catch (error) { failures.push(error); }
    operator = null;
    const endpoints = await Promise.allSettled([customer?.close(), seller?.close()]);
    customer = seller = null;
    failures.push(...endpoints.filter(item => item.status === 'rejected').map(item => item.reason));
    try { await merchant?.close(); } catch (error) { failures.push(error); }
    merchant = null;
    for (const request of forwards) request.destroy();
    for (const socket of sockets) socket.destroy();
    const closed = await Promise.allSettled([...servers].filter(server => server.listening).map(server =>
      new Promise((done, fail) => server.close(error => error ? fail(error) : done()))));
    failures.push(...closed.filter(item => item.status === 'rejected').map(item => item.reason));
    await counterTail;
    if (failures.length) throw new AggregateError(failures, 'LAB_NATIVE_OWNERS_CLOSE_FAILED');
  }
  try {
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
          for (const field of FIELDS) assert.equal(value.paymentRequirements[field], PAYMENT[field]);
          assert.deepEqual(value.paymentPayload.payload, { fixture: 'LOCAL_PAID_JOB_PROTOCOL', jobId: JOB });
          const paymentSha256 = digest(JSON.stringify(value.paymentPayload));
          if (counters.paymentSha256) assert.equal(paymentSha256, counters.paymentSha256);
          counters.paymentSha256 = paymentSha256;
          if (request.url === '/verify') {
            counters.verifies++; result = { isValid: true, payer: PAYER };
          } else {
            counters.settles++; result = { success: true, network: PAYMENT.network,
              transaction: digest(OPERATION + ':' + JOB), payer: PAYER };
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
      env: { LAB_EDD_TEMP_ROOT: scratch, LAB_EDD_PYTHON: marker.python, SF30_JOB_TEMP: scratch } });
    seller = await startJobSeller(merchant, { port: 0, operationsPort: 0,
      nativeFactory: compiled => createNativeSellerServer(compiled, {
        facilitatorClient: new HTTPFacilitatorClient({ url: 'http://127.0.0.1:' + facilitator.address().port }),
      }) });
    customer = await startCustomerServer({ model: merchant, port: 0,
      intakeConfig: { enabled: true, functions: [FUNCTION] } });
    operator = await startJobsWorkspace({ model: merchant, port: 0 });
    await writeBytes(join(fixture, 'operator-url.txt'), Buffer.from(operator.url + '\n'));
    await immutable(join(fixture, 'merchant-source.json'), jsonBytes({
      configSha256: operator.identity.source.configSha256,
      applicationSha256: operator.identity.source.applicationSha256,
      runtimeDirectory: operator.identity.runtimeDirectory,
    }));
    frontend = await serve(httpsServer({
      key: await readFile(join(fixture, 'tls', 'tls.key')),
      cert: await readFile(join(fixture, 'tls', 'tls.pem')), minVersion: 'TLSv1.2',
    }, (request, response) => {
      const allowedPurchase = request.method === 'POST' &&
        request.url === purchasePath + '?sf98_order=' + encodeURIComponent(JOB);
      const allowedGet = ['GET', 'HEAD'].includes(request.method) &&
        ['/jobs/' + encodeURIComponent(JOB), '/jobs/' + encodeURIComponent(JOB) + '/result'].includes(request.url);
      const allowedIntake = request.method === 'GET' && request.url === CATALOG_PATH ||
        request.method === 'POST' && [REQUEST_PATH, WITHDRAW_PATH].includes(request.url);
      const allowedInput = isInputRoute(request.url) && ['POST', 'PUT', 'GET', 'HEAD', 'DELETE'].includes(request.method);
      if (request.headers.host !== 'jobs-merchant.example' || !(allowedPurchase || allowedGet || allowedIntake || allowedInput)) {
        response.writeHead(404); response.end(); return;
      }
      if (allowedPurchase) traffic.purchases++;
      if (allowedGet) traffic[request.url.endsWith('/result') ? 'result' : 'status']++;
      if (allowedIntake) traffic[request.url === CATALOG_PATH ? 'intakeCatalog' :
        request.url === REQUEST_PATH ? 'intakePrepare' : 'intakeWithdraw']++;
      if (allowedInput) traffic.inputFiles++;
      const target = new URL(allowedPurchase ? seller.url : customer.url);
      const forwarded = httpRequest({ hostname: '127.0.0.1', port: target.port,
        method: request.method, path: request.url,
        headers: { ...request.headers, connection: 'close' }, agent: false }, incoming => {
        response.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(response);
      });
      forwards.add(forwarded); forwarded.once('close', () => forwards.delete(forwarded));
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
    const nativeEnvironment = { ...environment, SF_JOBS_CHECKOUT_PROXY: process.env.SF_JOBS_CHECKOUT_PROXY,
      SF_JOBS_CHECKOUT_PYTHON: marker.python, LAB_EDD_PYTHON: marker.python };
    const merchantConnection = join(fixture, 'paid-workspaces.json');
    await immutable(merchantConnection, jsonBytes({
      schema: 'stellar-forge.paid-job-workspace-connection.v1',
      workspaces: { laboratory: {
        label: 'Original Lab native merchant', directory: merchantState,
        urlFile: join(fixture, 'operator-url.txt'),
        source: { configSha256: operator.identity.source.configSha256,
          applicationSha256: operator.identity.source.applicationSha256 },
        runtimeDirectory: operator.identity.runtimeDirectory,
      } },
    }));
    const connection = join(fixture, 'lab-workspaces.json');
    const selectedConnections = JSON.parse(await readFile(join(HERE, 'lab-edd-workspaces.example.json'), 'utf8'));
    assert.deepEqual(Object.keys(selectedConnections.workspaces).sort(), ['laboratory', 'receiver']);
    for (const [alias, selected] of Object.entries(selectedConnections.workspaces)) {
      Object.assign(selected, {
        directory: join(fixture, alias === 'laboratory' ? 'customer' : 'receiver'),
        merchant: 'laboratory', origin: ORIGIN, functionId: FUNCTION, runtimeDirectory,
        operatorProfile: profilePath, approvalMode: 'operator',
        transport: { ...profile.buyerTransport }, temporaryDirectory: scratch,
      });
    }
    await immutable(connection, jsonBytes(selectedConnections));
    const merchantConfiguration = await completeMcpDirectory({ fixture, connection, merchantConnection });
    const receivingExample = join(HERE, 'lab-edd-receiving.example.json');
    const receiving = JSON.parse(await readFile(receivingExample, 'utf8'));
    assert.equal(receiving.operationId, OPERATION); assert.equal(receiving.families.length, 1);
    assert.equal(receiving.families[0].reference, JOB);
    assert.deepEqual(receiving.expectedPayment, PAYMENT);
    receiving.merchantConfiguration = merchantConfiguration;
    for (const family of receiving.families)
      for (const selected of [family.source, family.baseline, ...Object.values(family.documents)].filter(Boolean))
        selected.path = resolve(dirname(receivingExample), selected.path);
    const receivingPath = join(fixture, 'receiving.json');
    await immutable(receivingPath, jsonBytes(receiving));
    await progress('original-native-merchant-and-operator-ready', { sdk: nativeSdk,
      source: operator.identity.source, configuration: receivingPath });
    originalResult = await receiveLaboratoryOperator({
      configuration: receivingPath, directory: join(fixture, 'receiving'),
      signal: activeSignal, environment: nativeEnvironment,
      onProgress: async value => progress(value.phase, {
        ...(value.elapsedMs === undefined ? {} : { elapsedMs: value.elapsedMs }),
        ...(value.checkoutId === undefined ? {} : { checkoutId: value.checkoutId }),
      }),
      approve: async ({ approval, checkout, payment }) => {
        activeSignal.throwIfAborted();
        assert.equal(approval.mode, 'BROWSER');
        assert.equal(checkout.id, checkoutId); assert.equal(checkout.intentId, intentId);
        assert.equal(approval.checkoutId, checkoutId); assert.equal(approval.intentId, intentId);
        assert.equal(approval.taskId, checkout.task.id);
        assert.equal(approval.snapshot.state, 'AWAITING_OPERATOR');
        const snapshot = approval.snapshot, body = Buffer.from(JSON.stringify({ jobId: JOB }));
        assert.equal(snapshot.intentId, intentId);
        const expected = {
          schema: 'stellar-forge.sf62.operator-review.v1',
          request_id: intentId, actor: 'fixture-job-checkout', service: 'fixture-application-jobs',
          resource: purchaseUrl, method: 'POST', scheme: PAYMENT.scheme, network: PAYMENT.network,
          asset: PAYMENT.asset, pay_to: PAYMENT.payTo,
          max_atomic_units_to_reserve: PAYMENT.amount, max_timeout_seconds: PAYMENT.maxTimeoutSeconds,
          body_present: true, body_bytes: body.length, body_sha256: digest(body),
        };
        for (const [key, value] of Object.entries(expected))
          assert.equal(snapshot.review[key], value, 'Original disposable review changed: ' + key);
        assert.deepEqual(payment, PAYMENT);
        assert.deepEqual(snapshot.review.complete_original_accepted_terms, PAYMENT);
        assert.match(snapshot.review.request_sha256, HASH); assert.match(snapshot.review.accepted_terms_sha256, HASH);
        assert.equal(snapshot.current_native_budget_estimate.approved, true);
        assert.equal(snapshot.current_native_budget_estimate.reserved_max_base_units, PAYMENT.amount);
        for (const key of ['max_single', 'max_total', 'max_per_utc_day', 'max_per_actor_utc_day', 'max_per_service_utc_day'])
          assert.match(snapshot.current_native_budget_estimate.limit_remaining[key], /^(0|[1-9][0-9]*)$/);
        await immutable(join(fixture, 'browser-review-' + digest(snapshot.id) + '.json'), jsonBytes(snapshot));
        // The complete receiver sends this decision to the original SF62 broker
        // with its exact approval, request and currently captured task identity.
        return 'approve';
      },
    });
    assert.equal(originalResult.status, 'COMPLETE'); assert.equal(originalResult.operationId, OPERATION);
    assert.equal(Object.keys(originalResult.families).length, 1);
    const familyResult = originalResult.families[receiving.families[0].id];
    assert.equal(familyResult.result.members, 37); assert.equal(familyResult.result.checkoutId, checkoutId);
    assert.equal(familyResult.result.currentSourceSha256, receiving.families[0].parameters.expectedSourceSha256);
    assert.equal(familyResult.result.baselineSourceSha256, receiving.families[0].parameters.expectedBaselineSha256);
    await counterTail;
    const finalCounters = await readJson(counterPath);
    assert.equal(finalCounters.verifies, 1); assert.equal(finalCounters.settles, 1);
    assert.match(finalCounters.paymentSha256, HASH);
    const resultPath = join(fixture, 'receiving/result.json');
    const resultBytes = await readBytes(resultPath, 4 * 1024 * 1024);
    const completed = {
      schema: SCHEMA, status: 'COMPLETE', operationId: OPERATION, startedAt,
      completedAt: new Date().toISOString(), jobId: JOB, checkoutId, intentId,
      sdk: nativeSdk, node: process.versions.node, applicationSha256: marker.applicationSha256,
      merchantSource: operator.identity.source,
      nativeResult: { file: resultPath, bytes: resultBytes.length, sha256: digest(resultBytes) },
      result: familyResult.result, requestCount: originalResult.requests,
      restarts: originalResult.restarts, transfers: originalResult.transfers.length,
      payment: PAYMENT, facilitator: finalCounters, transport: { mode: 'explicit-connect', origin: ORIGIN, traffic },
      approval: { mode: 'ORIGINAL_BROWSER_BROKER', policy: join(fixture, 'policy.json'),
        ledger: join(fixture, 'ledger.sqlite'), fixture: 'LOCAL_PAID_JOB_PROTOCOL' },
    };
    await writeJson(join(fixture, 'native-result.json'), completed);
    complete = true;
    return completed;
  } finally {
    try { await closeOriginalOwners(); }
    finally {
      process.off('SIGINT', abort); process.off('SIGTERM', abort);
      if (priorProxy === undefined) delete process.env.SF_JOBS_CHECKOUT_PROXY;
      else process.env.SF_JOBS_CHECKOUT_PROXY = priorProxy;
      originalResult = null;
      globalThis.gc?.();
      if (!complete) controller.abort(Error('Original native receiving remains retained.'));
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  receiveLaboratoryNativeFixture().then(result => {
    process.stdout.write(JSON.stringify({ status: result.status, operationId: result.operationId,
      nativeResult: result.nativeResult, members: result.result.members,
      originalCheckoutId: result.checkoutId }) + '\n');
  }).catch(error => {
    process.stderr.write(JSON.stringify({ status: 'INTERRUPTED', operationId: OPERATION,
      code: error.code ?? error.name, message: error.message, stack: error.stack }) + '\n');
    process.exitCode = 1;
  });
}
