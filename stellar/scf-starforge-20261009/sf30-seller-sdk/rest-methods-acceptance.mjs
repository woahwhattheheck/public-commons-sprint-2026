// MIT. One focused original-source REST serving and handoff exercise.
// Native payment is a controlled collaborator; no signer, provider or ledger.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run as importService } from '../sf61-openapi-seller-import/cli.mjs';
import { readSellerConfig, startSellerService } from './serve.mjs';
import { createUpstreamHandlers, compileUpstreamBindings, validateUpstreamService } from './upstream.mjs';
import { requiresJsonBody } from './http-methods.mjs';
import { startSellerOperations } from './operations/server.mjs';
import { captureBundle } from '../sf93-seller-support-bundle/bundle.mjs';
import { run as auditSeller, planProbes } from '../sf96-seller-acceptance/audit.mjs';

const methods = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'];
const root = await mkdtemp(join(tmpdir(), 'sf30-rest-methods-'));
const sessions = [], backends = [];
const json = async (path, value) => writeFile(path, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
const parsed = async path => JSON.parse(await readFile(path, 'utf8'));
const response = async (url, init) => {
  const value = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(5000) });
  const body = await value.text();
  return { status: value.status, headers: value.headers, body };
};

try {
  const quantity = { type: 'integer', minimum: 0, examples: [1] };
  const operations = Object.fromEntries(methods.map(method => [method.toLowerCase(), {
    operationId: method.toLowerCase() + 'Item', summary: method + ' an inventory item',
    ...(requiresJsonBody(method) ? { requestBody: { required: true, content: {
      'application/json': { schema: { type: 'object', properties: { quantity },
        required: ['quantity'], additionalProperties: false }, example: { quantity: 1 } },
    } } } : {}),
    responses: { '200': { description: 'Local application response' } },
  }]));
  const spec = { openapi: '3.1.1', info: { title: 'Local REST integration', version: '1' },
    servers: [{ url: 'https://seller.example/api' }], paths: { '/items/{sku}': {
      parameters: [
        { in: 'path', name: 'sku', required: true, schema: { type: 'string', minLength: 1 }, example: 'SKU-1' },
        { in: 'query', name: 'version', required: true, schema: { type: 'integer', minimum: 1 }, example: 1 },
      ], ...operations,
    } } };
  const payment = { scheme: 'exact', network: 'stellar:testnet', amount: '7',
    asset: 'LOCAL_NONPAYABLE_ASSET', payTo: 'LOCAL_NONPAYABLE_RECIPIENT', maxTimeoutSeconds: 60 };
  const options = [payment, { ...payment, amount: '11', asset: 'LOCAL_NONPAYABLE_ASSET_ALTERNATIVE',
    extra: { reference: 'preserve-this-original-choice' } }];
  const selections = methods.map(method => ({ method, path: '/items/{sku}', accepts: options }));
  const bindings = methods.map(method => ({ id: method.toLowerCase() + 'Item',
    method, path: '/items/{sku}', handler: method.toLowerCase() + 'Item', validateInput: true }));
  for (const [name, value] of [['spec', spec], ['selections', selections], ['bindings', bindings]])
    await json(join(root, name + '.json'), value);
  await importService(['--spec', join(root, 'spec.json'), '--config', join(root, 'selections.json'),
    '--service-bindings', join(root, 'bindings.json'), '--out', join(root, 'service')]);
  const config = await readSellerConfig(join(root, 'service', 'seller-service.json'));
  assert.deepEqual(config.routes.map(route => route.offer.extensions.bazaar.info.input.method), methods);
  for (const route of config.routes) assert.deepEqual(route.offer.accepts, options);

  const observed = [];
  let item = { quantity: 1 };
  const backend = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const bytes = Buffer.concat(chunks), target = new URL(req.url, 'http://127.0.0.1');
      observed.push({ method: req.method, body: bytes.length ? JSON.parse(bytes) : null,
        path: target.pathname, version: target.searchParams.get('version'),
        paymentHeader: req.headers['payment-signature'] });
      if (['POST', 'PUT'].includes(req.method)) item = JSON.parse(bytes);
      if (req.method === 'PATCH') item = { ...item, ...JSON.parse(bytes) };
      if (req.method === 'DELETE') { item = null; res.writeHead(204); res.end(); return; }
      const body = Buffer.from(JSON.stringify({ item }));
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': body.length });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch { res.writeHead(500); res.end(); }
  });
  await new Promise((done, fail) => { backend.once('error', fail); backend.listen(0, '127.0.0.1', done); });
  backends.push(backend);
  const upstreams = { schema: 'stellar-forge.seller-upstreams.v1', bindings: Object.fromEntries(methods.map(method =>
    [method.toLowerCase() + 'Item', { origin: `http://127.0.0.1:${backend.address().port}`,
      path: '/items/:sku', method, query: ['version'], responseMode: 'json' }])) };
  validateUpstreamService(config, compileUpstreamBindings(upstreams, { allowLoopback: true }));
  const handlers = createUpstreamHandlers(upstreams, { allowLoopback: true });

  // The actual challenge-only service carries every imported method through its
  // developer projection, original route audit and private support capture.
  const challengeSeller = await startSellerService({ config, handlers, port: 0 });
  sessions.push(challengeSeller);
  const challengeOps = await startSellerOperations(challengeSeller, { port: 0 });
  sessions.push(challengeOps);
  const openapi = JSON.parse((await response(challengeSeller.url + '/_seller/openapi.json')).body);
  const exposed = openapi.paths['/api/items/{sku}'];
  assert.deepEqual(Object.keys(exposed).sort(), methods.map(method => method.toLowerCase()).sort());
  for (const method of methods) assert.equal(Boolean(exposed[method.toLowerCase()].requestBody), requiresJsonBody(method));
  const planning = challengeSeller.compiled.routes.map(route => ({ id: route.id, method: route.method,
    advertisedUrl: route.offer.resource.url, template: route.path, offer: route.offer }));
  assert.ok(planProbes(planning).filter(plan => ['PUT', 'PATCH', 'DELETE'].includes(plan.route.method)).every(plan => plan.skip));
  const cases = { schema: 'scf.sf96.operator-cases.v1', routes: Object.fromEntries(methods.map(method =>
    [method.toLowerCase() + 'Item', { path: '/api/items/SKU-1', query: { version: 1 },
      ...(method === 'POST' ? { allowPost: true } : {}),
      ...(['PUT', 'PATCH', 'DELETE'].includes(method) ? { allowMethod: method } : {}),
      ...(requiresJsonBody(method) ? { body: { quantity: 1 } } : {}),
    }])) };
  await json(join(root, 'cases.json'), cases);
  const audit = await auditSeller({ seller: challengeSeller.url, casesPath: join(root, 'cases.json'), out: join(root, 'audit') });
  assert.deepEqual(audit.summary, { total: 6, passed: 6, blocked: 0, needsInput: 0 });
  assert.equal(observed.length, 0, 'challenge-only routes must not invoke backend');
  await captureBundle({ seller: challengeSeller.url, ops: challengeOps.url, out: join(root, 'support') });
  const support = await parsed(join(root, 'support', 'bundle.json'));
  assert.deepEqual(support.seller.advertisedRoutes.map(route => route.method), methods);
  assert.equal(support.observation.totals.challenge, 6);

  const native = { entered: 0, settled: 0 };
  const nativeSeller = await startSellerService({ config, handlers, port: 0, nativeFactory: async () => ({
    async processHTTPRequest(context) {
      native.entered++;
      if (context.paymentHeader !== 'LOCAL_CONTROLLED_PAYMENT')
        return { type: 'payment-error', response: { status: 402, body: { error: 'CONTROLLED_PAYMENT_REQUIRED' } } };
      return { type: 'payment-verified', cancellationDispatcher: { cancel: async () => ({}) },
        paymentPayload: {}, paymentRequirements: {}, declaredExtensions: {} };
    },
    async processSettlement() { native.settled++; return { success: true, headers: {} }; },
    createFailurePathSettlementHeaders() { return {}; },
  }) });
  sessions.push(nativeSeller);
  const nativeOps = await startSellerOperations(nativeSeller, { port: 0 });
  sessions.push(nativeOps);
  const target = nativeSeller.url + '/api/items/SKU-1?version=1';
  const unsigned = await response(target, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{"quantity":2}' });
  assert.equal(unsigned.status, 402);
  assert.equal(observed.length, 0, 'unpaid native request must not invoke backend');
  for (const [method, contentType, body, expected] of [
    ['PUT', 'application/json', '{"quantity":-1}', 422],
    ['PATCH', 'text/plain', '{"quantity":2}', 415],
    ['DELETE', 'application/json', '{"quantity":2}', 400],
  ]) {
    const result = await response(target, { method, headers: { 'content-type': contentType }, body });
    assert.equal(result.status, expected, method + ' prepayment rejection');
  }
  assert.equal(native.entered, 1, 'invalid inputs must stop before native payment');
  for (const [index, method] of methods.entries()) {
    const result = await response(target, { method,
      headers: { 'payment-signature': 'LOCAL_CONTROLLED_PAYMENT',
        ...(requiresJsonBody(method) ? { 'content-type': 'application/json' } : {}) },
      ...(requiresJsonBody(method) ? { body: JSON.stringify({ quantity: index + 1 }) } : {}),
    });
    assert.equal(result.status, method === 'DELETE' ? 204 : 200, method + ' delivery');
    if (method === 'HEAD' || method === 'DELETE') assert.equal(result.body, '');
  }
  assert.equal(item, null);
  assert.deepEqual(observed.map(row => row.method), methods);
  assert.ok(observed.every(row => row.path === '/items/SKU-1' && row.version === '1' && row.paymentHeader === undefined));
  assert.deepEqual(observed.map(row => row.body), [null, null, { quantity: 3 }, { quantity: 4 }, { quantity: 5 }, null]);
  assert.equal(native.settled, 6);
  const traffic = nativeOps.observer.snapshot();
  assert.equal(traffic.routes.find(row => row.id === '@method').started, 0);
  assert.ok(traffic.routes.filter(row => !row.id.startsWith('@')).every(row => row.success === 1));
  console.log(JSON.stringify({ status: 'PASS', methods, importedRoutes: 6,
    originalChallengeAcceptance: audit.summary, upstreamRequests: observed.length,
    prepaymentRejections: 3, nativeSettlements: '6 controlled collaborator calls; no ledger payment',
    supportMethodCoverage: 6, paymentAlternativesPerRoute: options.length, hostedActions: 0 }));
} finally {
  for (const session of sessions.reverse()) await session.close();
  for (const backend of backends) await new Promise(resolve => {
    backend.close(resolve); backend.closeIdleConnections?.();
  });
  await rm(root, { recursive: true, force: true });
}
