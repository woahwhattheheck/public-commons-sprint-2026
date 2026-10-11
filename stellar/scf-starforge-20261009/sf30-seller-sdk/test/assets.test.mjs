// MIT. One complete file-product journey plus startup/admission edge cases.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, stat, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { inspectResponseAsset, readResponseAsset, prepareResponseAssets,
  composeAssetAdmission, compileAssetRouteOffer, validateResponseAssetRoute } from '../response-asset.mjs';
import { createAssetBundle, verifyAssetBundle } from '../asset-cli.mjs';
import { compileHttpSellerOffer, paymentRequiredResponse } from '../seller.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const payment = { network: 'stellar:testnet', scheme: 'exact', amount: '10000',
  asset: 'REPLACE_WITH_REAL_SEP41_CONTRACT', payTo: 'REPLACE_WITH_REAL_RECEIVING_ACCOUNT', maxTimeoutSeconds: 60 };
function config(responseAsset) { return { schema: 'stellar-forge.seller-service.v1',
  maxResponseBytes: 3 * 1024 * 1024, assetBudgetBytes: 6 * 1024 * 1024,
  routes: [{ id: 'download', path: '/download', definition: { method: 'GET', description: 'Local file product', payment }, responseAsset }] }; }

test('file product: inspect → pin → package → relocate → verify → immutable delivery', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'sf30-assets-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const bytes = Buffer.alloc(2 * 1024 * 1024 + 37);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 17 + 129) % 256;
  const source = join(dir, 'source.bin'); await writeFile(source, bytes);
  const { bytes: length, ...responseAsset } = await inspectResponseAsset(source, 'application/octet-stream', 'données.bin');
  assert.equal(length, bytes.length); assert.equal(responseAsset.sha256, sha(bytes));
  const input = config(responseAsset), output = join(dir, 'product');
  const bundle = await createAssetBundle(input, { out: output });
  assert.equal(bundle.uniqueFiles, 1);
  assert.equal((await verifyAssetBundle(output)).totalRouteBytes, bytes.length);
  assert.equal((await stat(output)).mode & 0o777, 0o700);
  assert.equal((await stat(join(output, 'seller.json'))).mode & 0o777, 0o600);
  await assert.rejects(createAssetBundle(input, { out: output }), { code: 'EEXIST' });
  await rm(source); // The bundle, not the original machine's path, is the product.
  const portable = JSON.parse(await readFile(join(output, 'seller.json'), 'utf8'));
  assert.match(portable.routes[0].responseAsset.file, /^assets\/[a-f0-9]{64}\.blob$/);
  assert.ok(!JSON.stringify(portable).includes(dir));
  portable.routes[0].responseAsset.file = join(output, portable.routes[0].responseAsset.file);
  const { assets } = await prepareResponseAssets(portable), snapshot = assets.get('download');
  const first = await snapshot.handler(); assert.deepEqual(first.body, bytes);
  assert.match(first.headers['content-disposition'], /filename\*=UTF-8''donn%C3%A9es.bin/);
  first.body.fill(0); assert.deepEqual((await snapshot.handler()).body, bytes);
  await writeFile(portable.routes[0].responseAsset.file, Buffer.alloc(bytes.length));
  assert.deepEqual((await snapshot.handler()).body, bytes); // Running snapshot stays exact.
  await assert.rejects(verifyAssetBundle(output), /SHA-256/); // A restart/package check will reject drift.
  const offer = compileAssetRouteOffer(input.routes[0], 'https://files.example', compileHttpSellerOffer);
  assert.equal(offer.resource.mimeType, 'application/octet-stream');
  assert.ok(!Object.hasOwn(offer.extensions.bazaar.info, 'output'));
  assert.ok(!Object.hasOwn(offer.extensions.bazaar.schema.properties, 'output'));
  assert.deepEqual(offer.accepts[0], payment);
  const advertised = JSON.parse(Buffer.from(paymentRequiredResponse(offer).headers['PAYMENT-REQUIRED'], 'base64'));
  assert.equal(advertised.resource.mimeType, responseAsset.contentType);
});

test('asset startup limits and composed application admission', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'sf30-asset-edges-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const source = join(dir, 'data.bin'), bytes = Buffer.from([0, 128, 255, 5]); await writeFile(source, bytes);
  const { bytes: ignored, ...descriptor } = await inspectResponseAsset(source, 'application/zip', 'archive.zip');
  const input = config(descriptor);
  await assert.rejects(prepareResponseAssets({ ...input, maxResponseBytes: 3 }), /remaining memory limit/);
  await assert.rejects(prepareResponseAssets({ ...input, assetBudgetBytes: 7, routes: [input.routes[0], { ...input.routes[0], id: 'second', path: '/second' }] }), /remaining memory limit/);
  await assert.rejects(readResponseAsset({ ...descriptor, sha256: '0'.repeat(64) }), /SHA-256/);
  const link = join(dir, 'link.bin'); await symlink(source, link);
  if (process.platform === 'linux') await assert.rejects(readResponseAsset({ ...descriptor, file: link }), { code: 'ELOOP' });
  assert.throws(() => validateResponseAssetRoute({ ...input.routes[0], definition: { ...input.routes[0].definition, outputExample: {} } }), /JSON/);
  assert.throws(() => validateResponseAssetRoute({ ...input.routes[0], responseAsset: { ...descriptor, downloadName: '../escape' } }), /safe downloadName/);
  let applicationCalls = 0;
  const admit = composeAssetAdmission(async () => { applicationCalls++; return true; });
  assert.equal(admit({ headers: { Range: 'bytes=0-1' } }).status, 416);
  assert.equal(admit({ headers: { 'If-None-Match': 'x' } }).status, 400);
  assert.equal(applicationCalls, 0);
  assert.equal(await admit({ headers: {} }), true); assert.equal(applicationCalls, 1);
  const aborted = AbortSignal.abort(); assert.throws(() => admit({ headers: {}, signal: aborted }), { name: 'AbortError' });
  const duplicate = await createAssetBundle({ ...input, routes: [input.routes[0], { ...input.routes[0], id: 'second', path: '/second' }] }, { out: join(dir, 'dedup') });
  assert.equal(duplicate.uniqueFiles, 1); assert.equal(duplicate.manifest.totalRouteBytes, 8);
  const empty = join(dir, 'empty'); await writeFile(empty, '');
  const info = await inspectResponseAsset(empty, 'application/octet-stream', 'empty.bin');
  const { bytes: emptySize, ...emptyDescriptor } = info;
  await assert.rejects(createAssetBundle({ ...input, routes: [input.routes[0], { ...input.routes[0], id: 'case', path: '/DOWNLOAD' }] }, { out: join(dir, 'bad-path') }), /ambiguous/);
  await assert.rejects(createAssetBundle({ ...input, admissionTimeoutMs: -1 }, { out: join(dir, 'bad-timeout') }), /admissionTimeoutMs/);
  assert.equal(emptySize, 0); assert.equal((await readResponseAsset(emptyDescriptor)).metadata.bytes, 0);
});

test('original HTTP adapter: challenge, prepayment admission, exact delivery and settlement refusal', async t => {
  // The real SF30 adapter runs over HTTP; this controlled native-server double
  // isolates its lifecycle. It does not perform SDK cryptography or a chain payment.
  const [{ createServer }, { compileSellerRoutes, createSellerResourceHandler }] = await Promise.all([
    import('node:http'), import('../resource-server.mjs'),
  ]);
  const dir = await mkdtemp(join(tmpdir(), 'sf30-asset-http-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const original = Buffer.alloc(2 * 1024 * 1024 + 37, 0xa5), file = join(dir, 'product.bin');
  await writeFile(file, original);
  const { bytes: unused, ...descriptor } = await inspectResponseAsset(file, 'application/octet-stream', 'product.bin');
  const input = config(descriptor), snapshot = await readResponseAsset(descriptor);
  const offer = compileAssetRouteOffer(input.routes[0], 'https://files.example', compileHttpSellerOffer);
  let verifyCalls = 0, settleCalls = 0, handlerCalls = 0, allowSettlement = true;
  const compiled = compileSellerRoutes([{ id: 'download', offer, admit: composeAssetAdmission(),
    handler: async () => { handlerCalls++; return snapshot.handler(); } }]);
  const nativeServer = {
    async processHTTPRequest(context) {
      verifyCalls++;
      if (!context.paymentHeader) {
        const challenge = paymentRequiredResponse(offer);
        return { type: 'payment-error', response: { status: challenge.statusCode, headers: challenge.headers, body: challenge.body } };
      }
      return { type: 'payment-verified', paymentPayload: {}, paymentRequirements: {}, declaredExtensions: {},
        cancellationDispatcher: { async cancel() { return {}; } } };
    },
    async processSettlement(_payload, _requirements, _extensions, result) {
      settleCalls++; assert.equal(sha(result.responseBody), descriptor.sha256);
      return allowSettlement ? { success: true, headers: { 'PAYMENT-RESPONSE': 'controlled-local-outcome' } } :
        { success: false, response: { status: 402, body: { error: 'CONTROLLED_SETTLEMENT_REFUSAL' } } };
    },
    createFailurePathSettlementHeaders() { return {}; },
  };
  const handler = createSellerResourceHandler({ compiled, nativeServer, maxResponseBytes: input.maxResponseBytes });
  const server = createServer((req, res) => handler(req, res).catch(error => { res.destroy(error); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}/download`;
  let response = await fetch(url);
  assert.equal(response.status, 402); assert.equal(handlerCalls, 0); assert.equal(settleCalls, 0);
  const challenge = JSON.parse(Buffer.from(response.headers.get('payment-required'), 'base64'));
  assert.equal(challenge.resource.mimeType, descriptor.contentType); await response.arrayBuffer();
  const before = verifyCalls;
  response = await fetch(url, { headers: { Range: 'bytes=0-1', 'payment-signature': 'local-test-only' } });
  assert.equal(response.status, 416); await response.arrayBuffer(); assert.equal(verifyCalls, before);
  response = await fetch(url, { headers: { 'If-None-Match': descriptor.sha256 } });
  assert.equal(response.status, 400); await response.arrayBuffer(); assert.equal(verifyCalls, before);
  response = await fetch(url, { method: 'HEAD' }); assert.equal(response.status, 405); assert.equal(verifyCalls, before);
  response = await fetch(url, { headers: { 'payment-signature': 'local-test-only' } });
  assert.equal(response.status, 200); assert.equal(response.headers.get('x-content-sha256'), descriptor.sha256);
  assert.match(response.headers.get('content-disposition'), /attachment/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), original);
  assert.equal(handlerCalls, 1); assert.equal(settleCalls, 1);
  await writeFile(file, Buffer.alloc(original.length));
  response = await fetch(url, { headers: { 'payment-signature': 'local-test-only' } });
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), original);
  allowSettlement = false;
  response = await fetch(url, { headers: { 'payment-signature': 'local-test-only' } });
  assert.equal(response.status, 402); assert.deepEqual(await response.json(), { error: 'CONTROLLED_SETTLEMENT_REFUSAL' });
  assert.equal(response.headers.get('x-content-sha256'), null);
});
