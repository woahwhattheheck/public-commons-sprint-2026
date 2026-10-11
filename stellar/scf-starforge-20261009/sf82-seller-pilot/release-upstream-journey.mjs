// One original release/process/console journey. Official SDK, local facilitator outcomes.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, rm, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePaymentSignatureHeader } from '@x402/core/http';
import { initReleaseStore, stageRelease, inspectRelease, compareReleases } from './releases.mjs';
import { startReleaseConsole } from './release-console.mjs';
import { releaseCacheControlPath } from './release-cache.mjs';

let reads = 0, verified = 0, settled = 0;
const listen = server => new Promise(done => server.listen(0, '127.0.0.1', done));
const stop = async server => { server.closeAllConnections(); await new Promise(done => server.close(done)); };
const backend = createServer(async (req, res) => {
  const serial = ++reads;
  await new Promise(done => setTimeout(done, 25));
  res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=120' });
  res.end(JSON.stringify({ serial, path: req.url, generation: req.headers.authorization }));
});
const facilitator = createServer(async (req, res) => {
  for await (const chunk of req) { /* Consume the original SDK request. */ }
  const result = req.url === '/supported' ? { kinds: [{ x402Version: 2, scheme: 'exact', network: 'stellar:testnet' }], extensions: ['bazaar'], signers: {} }
    : req.url === '/verify' ? (verified++, { isValid: true, payer: 'LOCAL_RELEASE_NO_WALLET' })
    : req.url === '/settle' ? { success: true, network: 'stellar:testnet', transaction: 'LOCAL_RELEASE_NO_CHAIN_' + ++settled, payer: 'LOCAL_RELEASE_NO_WALLET' }
    : null;
  res.writeHead(result ? 200 : 404, { 'content-type': 'application/json' }); res.end(JSON.stringify(result));
});
await listen(backend); await listen(facilitator);
const work = await mkdtemp(join(tmpdir(), 'sf82-api-release-')), root = join(work, 'releases');
const upstreamFile = join(work, 'upstreams.json'), selectionsFile = join(work, 'selections.json');
const example = name => fileURLToPath(new URL('./examples/' + name, import.meta.url));
const write = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n');
const envName = 'SCF_RELEASE_JOURNEY_AUTH', priorEnv = process.env[envName];
let operator;
try {
  delete process.env[envName];
  await initReleaseStore(root);
  const upstreams = { schema: 'stellar-forge.seller-upstreams.v1', bindings: { merchantDataset: {
    origin: `http://127.0.0.1:${backend.address().port}`, path: '/v1/dataset', method: 'GET', query: ['region'],
    headerEnv: { authorization: envName }, availability: { failureThreshold: 3, resetAfterMs: 100, maxResetAfterMs: 1000 },
    cache: { shareAcrossBuyers: true, ttlMs: 60000, maxEntries: 8, maxBytes: 65536, maxEntryBytes: 8192,
      maxSourceInFlight: 4, maxWaiters: 8, sourceTimeoutMs: 10000 },
  } } };
  const selections = JSON.parse(await readFile(example('upstream-selections.json')));
  await write(upstreamFile, upstreams); await write(selectionsFile, selections);
  const input = { spec: example('upstream-openapi.json'), config: selectionsFile,
    bindings: example('upstream-route-bindings.json'), upstreams: upstreamFile,
    runtime: { port: 0, allowLoopbackUpstream: true, allowLocalFacilitator: true,
      facilitator: `http://127.0.0.1:${facilitator.address().port}` } };
  await stageRelease(root, { ...input, id: 'first' });
  upstreams.bindings.merchantDataset.path = '/v2/dataset'; upstreams.bindings.merchantDataset.cache.ttlMs = 30000;
  selections[0].accepts[0].amount = '30000';
  await write(upstreamFile, upstreams); await write(selectionsFile, selections);
  await stageRelease(root, { ...input, id: 'second' });
  await write(upstreamFile, { laterInputDoesNotChangeStagedRelease: true });
  const diff = await compareReleases(root, 'first', 'second');
  assert.equal(diff.summary.paymentChanged, 1);
  assert.ok(diff.changes[0].fields.some(field => field.field === 'upstream'));
  assert.equal((await inspectRelease(root, 'first')).routes[0].upstream.cache.ttlMs, 60000);
  assert.equal(reads + verified + settled, 0);

  operator = await startReleaseConsole(root, { port: 0 });
  const call = async (path, value, extra = {}) => {
    const options = { headers: { 'x-release-token': operator.token, ...extra } };
    if (value !== undefined) Object.assign(options, { method: 'POST', body: JSON.stringify(value),
      headers: { ...options.headers, origin: options.headers.origin ?? operator.url, 'content-type': 'application/json' } });
    const response = await fetch(operator.url + path, options); return { status: response.status, value: await response.json() };
  };
  const ok = async (path, body) => { const result = await call(path, body); assert.equal(result.status, 200, JSON.stringify(result.value)); return result.value; };
  const buy = async (listener, amount) => {
    const unsigned = await fetch(listener + '/api/dataset?region=north'); assert.equal(unsigned.status, 402);
    const challenge = JSON.parse(Buffer.from(unsigned.headers.get('payment-required'), 'base64'));
    assert.equal(challenge.accepts[0].amount, amount); await unsigned.arrayBuffer();
    const response = await fetch(listener + '/api/dataset?region=north', { headers: {
      'payment-signature': encodePaymentSignatureHeader({ x402Version: 2, resource: challenge.resource,
        accepted: challenge.accepts[0], extensions: challenge.extensions, payload: { releaseJourney: 'LOCAL_ONLY' } }),
    } });
    assert.equal(response.status, 200); assert.ok(response.headers.get('payment-response')); return response.json();
  };
  assert.equal((await fetch(operator.url + '/api/cache')).status, 401);
  await ok('/api/activate', { id: 'first', expectedGeneration: 0, reason: 'Initial cached API' });
  process.env[envName] = 'local-generation-a';
  let state = await ok('/api/run', { expectedGeneration: 1 });
  const firstInstance = state.console.instanceId;
  const first = await Promise.all([buy(state.runtime.observed.listener, '20000'), buy(state.runtime.observed.listener, '20000')]);
  assert.equal(reads, 1); assert.equal(first[0].serial, first[1].serial); assert.equal(first[0].generation, 'local-generation-a');
  let cache = await ok('/api/cache'); assert.equal(cache.routes.dataset.policy.ttlMs, 60000);
  assert.ok(!JSON.stringify(cache).includes('local-generation-a'));
  assert.equal((await call('/api/cache/invalidate', { instanceId: firstInstance }, { origin: 'https://foreign.example' })).status, 403);
  const invalidated = await ok('/api/cache/invalidate', { instanceId: firstInstance, routeId: 'dataset' });
  assert.deepEqual(invalidated.invalidatedRoutes, ['dataset']);
  await buy(state.runtime.observed.listener, '20000'); assert.equal(reads, 2);
  await ok('/api/activate', { id: 'second', expectedGeneration: 1, reason: 'Updated backend and freshness' });
  process.env[envName] = 'local-generation-b';
  state = await ok('/api/restart', { expectedGeneration: 2, instanceId: firstInstance });
  assert.notEqual(state.console.instanceId, firstInstance);
  assert.equal((await call('/api/cache/invalidate', { instanceId: firstInstance, routeId: 'dataset' })).status, 409);
  await assert.rejects(lstat(releaseCacheControlPath(root, firstInstance)), { code: 'ENOENT' });
  cache = await ok('/api/cache'); assert.equal(cache.routes.dataset.policy.ttlMs, 30000);
  const second = await Promise.all([buy(state.runtime.observed.listener, '30000'), buy(state.runtime.observed.listener, '30000')]);
  assert.equal(reads, 3); assert.equal(second[0].generation, 'local-generation-b'); assert.ok(second[0].path.startsWith('/v2/'));
  await ok('/api/rollback', { expectedGeneration: 2, reason: 'Return to retained original API' });
  process.env[envName] = 'local-generation-c';
  state = await ok('/api/restart', { expectedGeneration: 3, instanceId: state.console.instanceId });
  const restored = await buy(state.runtime.observed.listener, '20000');
  assert.equal(reads, 4); assert.equal(restored.generation, 'local-generation-c'); assert.ok(restored.path.startsWith('/v1/'));
  await ok('/api/stop', { instanceId: state.console.instanceId });
  assert.equal((await ok('/api/cache')).available, false);
  assert.equal(verified, 6); assert.equal(settled, 6);
  console.log(JSON.stringify({ result: 'PASS', originalBackendReads: reads, nativeVerifies: verified, nativeSettlements: settled,
    journey: ['immutable upstream releases', 'exact policy/payment diff', 'real child runtime', 'private instance controls',
      'upgrade and stale-instance refusal', 'rollback with current credentials'], chainTransactions: 0, hostedActions: 0 }));
} finally {
  await operator?.close(); if (priorEnv === undefined) delete process.env[envName]; else process.env[envName] = priorEnv;
  await stop(backend); await stop(facilitator); await rm(work, { recursive: true, force: true });
}
