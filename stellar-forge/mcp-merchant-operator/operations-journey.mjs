// MIT. One real MCP subprocess → original seller/cache/catalog operating journey.
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { createServer } from 'node:http';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodePaymentSignatureHeader } from '@x402/core/http';
import { initializeMerchant } from './config.mjs';
import { startMerchantMcpStdio } from './stdio.mjs';
import { releaseStatus } from '../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs';
import { openCatalogOperator, POLICY_SCHEMA } from '../../stellar/scf-starforge-20261009/sf60-durable-catalog-transaction/operator.mjs';
import { RELEASE_CATALOG_CONFIG } from '../../stellar/scf-starforge-20261009/sf82-seller-pilot/release-catalog.mjs';

let backendReads = 0, verified = 0, settled = 0;
const listen = server => new Promise(done => server.listen(0, '127.0.0.1', done));
const stop = async server => { server.closeAllConnections(); await new Promise(done => server.close(done)); };
const backend = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=120' });
  res.end(JSON.stringify({ serial: ++backendReads, path: req.url }));
});
const facilitator = createServer(async (req, res) => {
  for await (const chunk of req) { /* Consume the original SDK request. */ }
  const value = req.url === '/supported' ? { kinds: [{ x402Version: 2, scheme: 'exact', network: 'stellar:testnet' }], extensions: ['bazaar'], signers: {} }
    : req.url === '/verify' ? (verified++, { isValid: true, payer: 'LOCAL_MCP_JOURNEY' })
    : req.url === '/settle' ? { success: true, network: 'stellar:testnet', payer: 'LOCAL_MCP_JOURNEY', transaction: 'LOCAL_NO_CHAIN_' + ++settled }
    : null;
  res.writeHead(value ? 200 : 404, { 'content-type': 'application/json' }); res.end(JSON.stringify(value));
});
await listen(backend); await listen(facilitator);
const work = await mkdtemp(join(tmpdir(), 'sf-merchant-operations-'));
const directory = join(work, 'catalog'), policyFile = join(work, 'policy.json'), keyFile = join(work, 'merchant.pem');
const connectionFile = join(work, 'connection.json'), merchantRoot = join(work, 'merchant');
const save = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
const example = name => readFile(new URL('../../stellar/scf-starforge-20261009/sf82-seller-pilot/examples/' + name, import.meta.url)).then(JSON.parse);
const input = new PassThrough(), output = new PassThrough(), pending = new Map();
let catalog, mcp, serial = 0, frames = 0, buffered = '', protocolError;
output.setEncoding('utf8');
output.on('data', chunk => {
  buffered += chunk;
  while (buffered.includes('\n')) {
    const end = buffered.indexOf('\n'), line = buffered.slice(0, end); buffered = buffered.slice(end + 1);
    try {
      const reply = JSON.parse(line); assert.equal(reply.jsonrpc, '2.0'); frames++;
      const request = pending.get(reply.id);
      if (request) { clearTimeout(request.timer); pending.delete(reply.id); request.resolve(reply); }
    } catch (error) { protocolError = error; for (const request of pending.values()) request.reject(error); }
  }
});
const rpc = (method, params = {}) => new Promise((resolve, reject) => {
  if (protocolError) { reject(protocolError); return; }
  const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(new Error('MCP response timed out: ' + method)); }, 30000);
  pending.set(id, { resolve, reject, timer });
  input.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
});
const call = async (name, args = {}, errorCode) => {
  const reply = await rpc('tools/call', { name, arguments: args });
  assert.ok(reply.result, JSON.stringify(reply));
  const envelope = reply.result, value = envelope.structuredContent;
  assert.deepEqual(JSON.parse(envelope.content[0].text), value);
  if (errorCode) { assert.equal(envelope.isError, true); assert.equal(value.code, errorCode); }
  else assert.equal(envelope.isError, false, JSON.stringify(value));
  return value;
};
try {
  const spec = await example('upstream-openapi.json');
  spec.paths['/archive'] = structuredClone(spec.paths['/dataset']); spec.paths['/archive'].get.operationId = 'archive';
  const selections = await example('upstream-selections.json');
  selections.push({ ...structuredClone(selections[0]), path: '/archive' });
  const bindings = [{ method: 'GET', path: '/dataset', id: 'dataset', handler: 'existingDataset', validateInput: true },
    { method: 'GET', path: '/archive', id: 'archive', handler: 'existingArchive', validateInput: true }];
  const source = path => ({ origin: 'http://127.0.0.1:' + backend.address().port, path, query: ['region'],
    maxResponseBytes: 65536,
    cache: { shareAcrossBuyers: true, ttlMs: 60000, maxEntries: 8, maxBytes: 65536,
      maxEntryBytes: 8192, maxSourceInFlight: 4, maxWaiters: 8, sourceTimeoutMs: 10000 } });
  const upstreams = { schema: 'stellar-forge.seller-upstreams.v1', bindings: {
    existingDataset: source('/dataset'), existingArchive: source('/archive') } };
  const specFile = join(work, 'openapi.json'), selectionsFile = join(work, 'selections.json');
  const bindingsFile = join(work, 'bindings.json'), upstreamsFile = join(work, 'upstreams.json');
  await save(specFile, spec); await save(selectionsFile, selections); await save(bindingsFile, bindings); await save(upstreamsFile, upstreams);
  const keys = generateKeyPairSync('ed25519');
  await save(policyFile, { schema: POLICY_SCHEMA, sellers: [{ sellerId: 'merchant-1',
    pinnedPublicKey: keys.publicKey.export({ format: 'pem', type: 'spki' }), allowedOrigins: ['https://dataset.example'],
    allowedRecipients: [selections[0].accepts[0].payTo], allowedNetworks: ['stellar:testnet'], allowedSchemes: ['exact'] }] });
  await save(connectionFile, { schema: RELEASE_CATALOG_CONFIG, directory: './catalog', sellerId: 'merchant-1',
    sourceURL: 'https://dataset.example/_seller/offers', keyFile: './merchant.pem' });
  catalog = await openCatalogOperator({ directory, policyFile, createEmpty: true, controlTransport: 'loopback' });
  const initialized = await initializeMerchant({ directory: merchantRoot, spec: specFile, selections: selectionsFile,
    bindings: bindingsFile, upstreams: upstreamsFile, catalog: connectionFile, runtime: { port: 0,
      allowLoopbackUpstream: true, allowLocalFacilitator: true, facilitator: 'http://127.0.0.1:' + facilitator.address().port } });
  assert.equal(initialized.catalogConfigured, true);
  mcp = await startMerchantMcpStdio({ configPath: initialized.configuration, input, output });
  const initializedMcp = await rpc('initialize', { protocolVersion: mcp.protocolVersion, capabilities: {}, clientInfo: { name: 'merchant-operations-journey', version: '1' } });
  assert.equal(initializedMcp.result.serverInfo.name, 'starforge-merchant-operator');
  input.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const tools = (await rpc('tools/list')).result.tools;
  for (const name of ['merchant_discovery_status', 'merchant_discovery_review', 'merchant_discovery_apply', 'merchant_cache_status', 'merchant_cache_invalidate'])
    assert.ok(tools.some(tool => tool.name === name));
  const first = (await call('merchant_stage', { source: 'initial', id: 'first' })).release;
  await call('merchant_activate', { id: 'first', expectedDigest: first.digest, expectedGeneration: 0, reason: 'Original merchant' });
  let running = await call('merchant_start', { expectedGeneration: 1, expectedDigest: first.digest });
  let review = await call('merchant_discovery_review', { id: 'first' });
  assert.equal(review.changes.length, 2); assert.ok(!JSON.stringify(review).includes(work));
  const failed = await call('merchant_discovery_apply', { reviewId: review.id }, 'ENOENT');
  assert.ok(!JSON.stringify(failed).includes(work));
  await call('merchant_discovery_apply', { reviewId: review.id }, 'MERCHANT_CATALOG_REVIEW_REQUIRED');
  assert.equal((await call('merchant_status')).operator.discovery.lastApply.error.code, 'ENOENT');
  await writeFile(keyFile, keys.privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });
  review = await call('merchant_discovery_review', { id: 'first' });
  let applied = await call('merchant_discovery_apply', { reviewId: review.id });
  assert.equal(applied.decision, 'COMMITTED'); assert.equal(applied.signaturesIssued, 2);
  assert.ok(applied.status.rows.every(row => row.state === 'MATCHES')); assert.ok(!JSON.stringify(applied).includes(work));

  const buy = async () => {
    const url = running.runtime.observed.listener + '/api/dataset?region=north';
    const unsigned = await fetch(url); assert.equal(unsigned.status, 402); await unsigned.arrayBuffer();
    const challenge = JSON.parse(Buffer.from(unsigned.headers.get('payment-required'), 'base64'));
    const response = await fetch(url, { headers: { 'payment-signature': encodePaymentSignatureHeader({ x402Version: 2,
      resource: challenge.resource, accepted: challenge.accepts[0], extensions: challenge.extensions, payload: { originalMcpJourney: 'LOCAL_ONLY' } }) } });
    assert.equal(response.status, 200); assert.ok(response.headers.get('payment-response')); return response.json();
  };
  const firstRead = await buy(), shared = await buy(); assert.equal(firstRead.serial, shared.serial); assert.equal(backendReads, 1);
  const cache = await call('merchant_cache_status'); assert.equal(cache.instanceId, running.operator.instanceId);
  assert.equal(cache.routes.dataset.policy.ttlMs, 60000);
  await call('merchant_cache_invalidate', { instanceId: running.operator.instanceId }, 'INVALID_PARAMS');
  const invalidated = await call('merchant_cache_invalidate', { instanceId: running.operator.instanceId, routeId: 'dataset' });
  assert.deepEqual(invalidated.invalidatedRoutes, ['dataset']); await buy(); assert.equal(backendReads, 2);
  const stale = await call('merchant_discovery_review', { id: 'first' }); assert.equal(stale.changes.length, 0);
  selections[0].accepts[0].amount = '30000'; upstreams.bindings.existingDataset.cache.ttlMs = 30000;
  delete upstreams.bindings.existingArchive;
  await save(selectionsFile, [selections[0]]); await save(bindingsFile, [bindings[0]]); await save(upstreamsFile, upstreams);
  const second = (await call('merchant_stage', { source: 'initial', id: 'second' })).release;
  await call('merchant_activate', { id: 'second', expectedDigest: second.digest, expectedGeneration: 1, reason: 'Upgrade and retire archive' });
  const previousInstance = running.operator.instanceId;
  running = (await call('merchant_restart', { instanceId: previousInstance, expectedGeneration: 2, expectedDigest: second.digest })).status;
  await call('merchant_cache_invalidate', { instanceId: previousInstance, all: true }, 'INSTANCE_CONFLICT');
  const currentCache = await call('merchant_cache_invalidate', { instanceId: running.operator.instanceId, all: true });
  assert.equal(currentCache.routes.dataset.policy.ttlMs, 30000);
  await call('merchant_discovery_apply', { reviewId: stale.id }, 'RELEASE_CATALOG_NOT_RUNNING');
  review = await call('merchant_discovery_review', { id: 'second' });
  assert.equal(review.changes[0].before.payment[0].amount, '20000'); assert.equal(review.changes[0].payment[0].amount, '30000');
  applied = await call('merchant_discovery_apply', { reviewId: review.id }); assert.equal(applied.signaturesIssued, 1);
  review = await call('merchant_discovery_review', { id: 'first', action: 'withdraw', routeId: 'archive', reason: 'Retired API operation' });
  applied = await call('merchant_discovery_apply', { reviewId: review.id }); assert.equal(applied.signaturesIssued, 1);
  await catalog.close(); catalog = await openCatalogOperator({ directory, policyFile, controlTransport: 'loopback' });
  assert.equal((await call('merchant_discovery_status', { id: 'second' })).rows[0].state, 'MATCHES');
  assert.equal((await call('merchant_discovery_status', { id: 'first' })).rows.find(row => row.routeId === 'archive').state, 'WITHDRAWN');
  review = await call('merchant_discovery_review', { id: 'second' });
  applied = await call('merchant_discovery_apply', { reviewId: review.id }); assert.equal(applied.decision, 'UNCHANGED'); assert.equal(applied.signaturesIssued, 0);
  await mcp.close(); mcp = null;
  assert.equal((await releaseStatus(join(merchantRoot, 'releases'))).runtime.state, 'STOPPED');
  assert.equal(verified, 3); assert.equal(settled, 3); assert.equal(backendReads, 2);
  assert.equal(protocolError, undefined); assert.equal(buffered, '');
  console.log(JSON.stringify({ result: 'PASS', merchantTools: tools.length, completeMcpFrames: frames,
    catalogOperations: 4, quoteSignatures: 3, withdrawalSignatures: 1, nativeVerifications: verified,
    nativeSettlements: settled, backendReads, chainSubmissions: 0, hostedActions: 0,
    journey: ['original subprocess MCP', 'host-only catalog connection', 'private failure redaction',
      'review and signed publish', 'native cached response', 'MCP cache invalidation',
      'running release upgrade', 'stale review and instance refusal', 'signed retirement',
      'original catalog restart', 'exact no-op reconciliation', 'owned seller shutdown'] }));
} finally {
  for (const request of pending.values()) clearTimeout(request.timer);
  await mcp?.close(); input.end(); output.end(); await catalog?.close();
  await stop(backend); await stop(facilitator); await rm(work, { recursive: true, force: true });
}
