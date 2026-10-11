// MIT. One native HTTP streaming journey, reusing the original SDK and buyer.
// The facilitator is the existing local outcome fixture; no chain calls.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { startStreamingBackend } from './examples/streaming-backend.mjs';
import { createUpstreamApplication } from './upstream.mjs';
import { createNativeSellerServer } from './native-factory.mjs';
import { startSellerService } from './serve.mjs';
import { streamingResponse } from './stream-response.mjs';
import { X402BuyerClient } from '../sf31-buyer-client/buyer.mjs';
import { prepareBuyerResponseFile } from '../sf31-buyer-client/response-file.mjs';
import { BuyerResult } from '../sf88-operator-buyer-cli/node/result.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'sf30-stream-journey-'));
const selected = process.argv.includes('--case') ? process.argv[process.argv.indexOf('--case') + 1] : null;
const report = { schema: 'stellar-forge.native-stream-journey.v1', cases: {},
  runtime: process.version, nativeSdk: '2.28.0', facilitator: 'existing-local-outcome-fixture' };
const counts = { verify: 0, settle: 0, approved: 0, signed: 0 };
const settlements = [];
let refuse = false, malformedClosed = 0, seller, application;
const backend = await startStreamingBackend({ port: 0 });
const config = JSON.parse(await readFile(join(root, 'examples/streaming-service.json'), 'utf8'));
const bindings = JSON.parse(await readFile(join(root, 'examples/streaming-upstreams.json'), 'utf8'));
for (const value of Object.values(bindings.bindings)) value.origin = backend.url;
const malformedRoute = { id: 'malformed-records', path: '/malformed', handler: 'malformed',
  definition: { method: 'GET', responseFormat: 'ndjson', description: 'Local malformed-source failure case',
    payment: structuredClone(config.routes[1].definition.payment), outputExample: { record: 1 } } };
const facilitator = {
  async getSupported() {
    return { kinds: [{ x402Version: 2, scheme: 'exact', network: 'stellar:testnet' }],
      extensions: ['bazaar'], signers: {} };
  },
  async verify() { counts.verify++; return { isValid: true, payer: 'LOCAL_STREAM_JOURNEY' }; },
  async settle(_payload, requirements) {
    counts.settle++;
    settlements.push({ flow: requirements.extra?.paymentFlow ?? 'authorization',
      source: backend.snapshot(), refused: refuse });
    return refuse ? { success: false, network: 'stellar:testnet', transaction: '',
      errorReason: 'LOCAL_STREAM_JOURNEY_DECLINED' } :
      { success: true, network: 'stellar:testnet',
        transaction: createHash('sha256').update('LOCAL_STREAM_JOURNEY_' + counts.settle).digest('hex'),
        payer: 'LOCAL_STREAM_JOURNEY' };
  },
};
const buyer = new X402BuyerClient({ allowLocal: true });
const signs = {
  approve: async intent => {
    assert.ok(Object.isFrozen(intent.acceptedTerms));
    counts.approved++; return true;
  },
  sign: async ({ challenge, accepted }) => {
    counts.signed++;
    return { x402Version: 2, resource: challenge.resource, accepted,
      extensions: challenge.extensions, payload: { fixture: 'LOCAL_ONLY_NO_SIGNATURE' } };
  },
};
const expectation = flow => ({ scheme: 'exact', network: 'stellar:testnet',
  asset: 'UNVERIFIED_DEMO_ASSET', payTo: 'UNVERIFIED_DEMO_RECIPIENT',
  maxAtomic: '10000', maxTimeoutSeconds: 120,
  ...(flow ? { paymentFlow: flow } : {}) });
const reader = (native, delivery, selectedFile) => {
  const { response, ...original } = native;
  return new BuyerResult({ native: { ...original, responseFile: delivery },
    exitCode: null, exitSignal: null, runtimeError: 'DIRECT_SF31_CAPTURE', recovered: false },
  selectedFile, resolve(root, '../sf88-operator-buyer-cli'));
};
const persist = async () => {
  report.observed = { ...counts, backend: backend.snapshot() };
  if (process.argv.includes('--out')) {
    const destination = resolve(process.argv[process.argv.indexOf('--out') + 1]);
    await writeFile(destination, JSON.stringify(report, null, 2) + '\n');
  }
};
const run = async (name, action) => {
  if (selected && !selected.split(',').includes(name)) return;
  try { report.cases[name] = { status: 'PASS', ...await action() }; }
  catch (error) {
    report.cases[name] = { status: 'FAIL', code: error.code ?? error.name, message: error.message };
    await persist(); throw error;
  }
  await persist();
};
try {
  application = createUpstreamApplication(config, bindings, { allowLoopback: true });
  application.config.routes.push(malformedRoute);
  seller = await startSellerService({ config: application.config, port: 0,
    handlers: { ...application.handlers, malformed: async () => streamingResponse({
      format: 'ndjson', body: (async function* () {
        yield Buffer.from('{"record":1}\n'); yield Buffer.from('not-json\n');
      })(), close() { malformedClosed++; },
    }) },
    nativeFactory: compiled => createNativeSellerServer(compiled, { facilitatorClient: facilitator }) });

  await run('explicit-upfront-selection', async () => {
    const before = { ...counts }, source = backend.snapshot();
    await assert.rejects(() => buyer.call({ url: seller.url + '/metrics/events?count=2&intervalMs=10',
      expect: expectation(), ...signs }), error => error.code === 'PAYMENT_TERMS_NOT_AUTHORIZED');
    assert.deepEqual(counts, before);
    assert.deepEqual(backend.snapshot(), source);
    return { approvalCalls: 0, signerCalls: 0, sourceCalls: 0 };
  });

  await run('live-upfront-sse', async () => {
    const before = { ...counts }, source = backend.snapshot(), records = [];
    const options = { destination: join(directory, 'telemetry.sse'), maxBytes: 1024 * 1024,
      timeoutMs: 10000, stream: { format: 'sse' } };
    const prepared = await prepareBuyerResponseFile(options);
    const result = await buyer.call({ url: seller.url + '/metrics/events?count=6&intervalMs=200',
      expect: expectation('upfront'), ...signs });
    assert.equal(result.httpStatus, 200);
    assert.equal(result.settlement, 'REPORTED_SUCCESS', result.reason ?? 'Expected native receipt');
    assert.equal(result.receipt.success, true);
    let firstSource;
    const saved = await prepared.save(result, { onRecord(record) {
      firstSource ??= backend.snapshot(); records.push(record);
    } });
    assert.equal(saved.stream.complete, true); assert.equal(records.length, 7);
    assert.equal(counts.verify - before.verify, 0);
    assert.equal(counts.settle - before.settle, 1);
    assert.equal(settlements.at(-1).source.requests, source.requests);
    assert.equal(firstSource.completed, source.completed);
    assert.ok(JSON.parse(records[0].data).residentBytes > 0);
    const bytes = await readFile(saved.path);
    assert.equal(saved.sha256, createHash('sha256').update(bytes).digest('hex'));
    const reopened = reader(result, { status: 'SAVED', ...saved }, options), recovered = [];
    for await (const event of reopened.events()) recovered.push(event);
    assert.deepEqual(recovered, records);
    return { records: records.length, bytes: saved.bytes, sha256: saved.sha256,
      originalSettlements: 1, firstRecordBeforeGenerationCompleted: true, reopened: true };
  });

  await run('authorization-ndjson', async () => {
    const before = { ...counts }, source = backend.snapshot();
    const options = { destination: join(directory, 'telemetry.ndjson'), maxBytes: 1024 * 1024,
      timeoutMs: 10000, stream: { format: 'ndjson' } };
    const prepared = await prepareBuyerResponseFile(options);
    const result = await buyer.call({ url: seller.url + '/metrics/records', method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ count: 4, intervalMs: 20 }), expect: expectation(), ...signs });
    assert.equal(result.httpStatus, 200);
    assert.equal(settlements.at(-1).source.completed, source.completed + 1);
    const saved = await prepared.save(result);
    assert.equal(counts.verify - before.verify, 1); assert.equal(counts.settle - before.settle, 1);
    const reopened = reader(result, { status: 'SAVED', ...saved }, options), records = [];
    for await (const record of reopened.ndjson()) records.push(record);
    assert.equal(records.length, 5); assert.equal(records.at(-1).samples, 4);
    return { records: records.length, bytes: saved.bytes,
      generationCompletedBeforeSettlement: true, reopened: true };
  });

  await run('cancel-and-reopen-partial', async () => {
    const before = { ...counts }, source = backend.snapshot(), controller = new AbortController();
    const options = { destination: join(directory, 'partial.sse'), maxBytes: 1024 * 1024,
      timeoutMs: 10000, stream: { format: 'sse' } };
    const prepared = await prepareBuyerResponseFile(options);
    const result = await buyer.call({ url: seller.url + '/metrics/events?count=30&intervalMs=50',
      expect: expectation('upfront'), signal: controller.signal, ...signs });
    let observed = 0, failure;
    try { await prepared.save(result, { signal: controller.signal, onRecord() {
      observed++; if (observed === 3) controller.abort();
    } }); } catch (error) { failure = error; }
    assert.ok(failure?.partialPath); assert.equal(failure.stream.complete, false);
    assert.ok(failure.bytes > 0); assert.ok(failure.partialSha256);
    const delivery = { status: 'FAILED', code: failure.code, bytes: failure.bytes,
      partialPath: failure.partialPath, partialSha256: failure.partialSha256, stream: failure.stream };
    const reopened = reader(result, delivery, options), records = [];
    for await (const event of reopened.events({ allowPartial: true })) records.push(event);
    // A transport chunk may contain more fully retained records than the
    // callback visited before cancellation. Reopen the exact stored prefix.
    assert.equal(records.length, failure.stream.records);
    assert.ok(records.length >= observed);
    assert.ok(records.length < 31);
    assert.equal(counts.settle - before.settle, 1);
    assert.equal(result.receipt.success, true);
    await delay(40);
    assert.equal(backend.snapshot().active, 0);
    assert.equal(backend.snapshot().cancelled, source.cancelled + 1);
    return { retainedRecords: records.length, retainedBytes: failure.bytes,
      partialSha256: failure.partialSha256, sourceCancelled: true, originalSettlements: 1 };
  });

  await run('settlement-refusal', async () => {
    const source = backend.snapshot(), before = { ...counts };
    refuse = true;
    let result;
    try { result = await buyer.call({ url: seller.url + '/metrics/events?count=2&intervalMs=10',
      expect: expectation('upfront'), ...signs }); }
    finally { refuse = false; }
    assert.equal(result.httpStatus, 402);
    await result.response.body?.cancel();
    assert.deepEqual(backend.snapshot(), source);
    assert.equal(counts.settle - before.settle, 1);
    return { sourceCalls: 0, receiptStatus: result.settlement };
  });

  await run('malformed-authorization-source', async () => {
    const before = { ...counts }, closed = malformedClosed;
    const result = await buyer.call({ url: seller.url + '/malformed',
      expect: expectation(), ...signs });
    assert.equal(result.httpStatus, 500);
    await result.response.body?.cancel();
    assert.equal(counts.verify - before.verify, 1);
    assert.equal(counts.settle - before.settle, 0);
    assert.equal(malformedClosed, closed + 1);
    return { originalSettlements: 0, originalSourceClosed: true };
  });
  if (selected && selected.split(',').some(name => !Object.hasOwn(report.cases, name)))
    throw new Error('Unknown --case');
  report.status = 'PASS';
} finally {
  await seller?.close();
  await application?.close();
  await backend.close();
  await rm(directory, { recursive: true, force: true });
  await persist();
}
console.log(JSON.stringify(report, null, 2));

