// MIT. One native HTTP workflow, using existing seller compilation and routing.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startSellerService } from '../serve.mjs';
import { compileHttpSellerOffer } from '../seller.mjs';
import { compileSellerOpenApi } from '../developer-portal.mjs';
import { buildUnpaidRequest, decodePaymentRequired, readLimitedResponse } from '../developer/request.mjs';
const payment = { scheme: 'exact', network: 'stellar:testnet', amount: '900719925474099312345',
  asset: 'UNVERIFIED_TEST_ASSET', payTo: 'UNVERIFIED_TEST_RECIPIENT', maxTimeoutSeconds: 60 };
export function exampleConfig() {
  const definition = { method: 'GET', serviceName: 'Field Intelligence API', description: 'Location-specific weather observations for connected applications.',
    payment, queryParameters: [{ name: 'units', type: 'string', description: 'Measurement system', example: 'metric', required: true }],
    outputExample: { city: 'Tokyo', temperature: 18, unit: 'C' } };
  const offer = compileHttpSellerOffer({ ...definition, url: 'https://seller.example/weather/Tokyo' });
  const bazaar = offer.extensions.bazaar;
  bazaar.routeTemplate = '/weather/:city'; bazaar.info.input.pathParams = { city: 'Tokyo' };
  bazaar.schema.properties.input.properties.pathParams = { type: 'object', properties: { city: { type: 'string', minLength: 1 } }, required: ['city'], additionalProperties: false };
  bazaar.schema.properties.input.required.push('pathParams');
  // A local ref and a literal "$ref" in example data must behave differently.
  bazaar.schema.$defs = { unit: { type: 'string', enum: ['metric', 'imperial'] } };
  bazaar.schema.properties.input.properties.queryParams.properties.units = { $ref: '#/$defs/unit' };
  bazaar.info.output.example = { '$ref': '#/literal-customer-data', city: 'Tokyo' };
  const post = { ...definition, method: 'POST', queryParameters: [], bodyType: 'json', body: { locations: ['Tokyo', 'Louisville'] }, description: 'Compare a batch of observation locations.' };
  return { schema: 'stellar-forge.seller-service.v1', publicOrigin: 'https://seller.example', routes: [
    { id: 'weather', path: '/weather/:city', offer, handler: 'never' },
    { id: 'compare', path: '/compare', definition: post, handler: 'never' },
    { id: 'head', path: '/status', definition: { ...definition, method: 'HEAD', queryParameters: [] }, handler: 'never' },
  ] };
}
function resolve(spec, ref) {
  return decodeURIComponent(ref.slice(2)).split('/').reduce((value, raw) => value[raw.replace(/~1/g, '/').replace(/~0/g, '~')], spec);
}
test('developer workspace uses exact native offers and actual unpaid GET/POST/HEAD', async () => {
  let handlerCalls = 0; const config = exampleConfig();
  const directory = await mkdtemp(join(tmpdir(), 'seller-docs-'));
  const dataset = join(directory, 'dataset.json'); await writeFile(dataset, '{"from":"file"}\n');
  config.routes.push({ id: 'dataset', path: '/dataset', definition: { ...config.routes[1].definition, method: 'GET', body: undefined, bodyType: undefined }, responseFile: dataset });
  const session = await startSellerService({ config, port: 0, handlers: { never: async () => { handlerCalls++; throw new Error('Unpaid application call'); } } });
  try {
    const docResponse = await fetch(session.url + '/_seller/openapi.json');
    assert.equal(docResponse.status, 200); const spec = await docResponse.json();
    assert.equal(spec.openapi, '3.1.1'); assert.equal(spec.servers[0].url, 'https://seller.example');
    const op = spec.paths['/weather/{city}'].get;
    assert.deepEqual(op['x-x402-payment-required'], session.compiled.routes.find(r => r.id === 'weather').offer);
    assert.equal(op['x-x402-payment-required'].accepts[0].amount, payment.amount);
    assert.equal(op.parameters.find(p => p.in === 'path').required, true);
    const querySchema = resolve(spec, op.parameters.find(p => p.name === 'units').schema.$ref);
    assert.deepEqual(resolve(spec, querySchema.$ref).enum, ['metric', 'imperial']);
    assert.deepEqual(op.responses['2XX'].content['application/json'].example, { '$ref': '#/literal-customer-data', city: 'Tokyo' });
    assert.equal(op.responses['2XX'].content['application/json'].schema, undefined);
    const built = buildUnpaidRequest(op, { path: { city: '東京' }, query: { units: ['metric', 'imperial'] } }, session.url);
    assert.equal(new URL(built.url).origin, session.url); assert.match(built.publicUrl, /^https:\/\/seller.example\/weather\//);
    assert.deepEqual(new URL(built.url).searchParams.getAll('units'), ['metric', 'imperial']);
    assert.equal(built.init.credentials, 'omit'); assert.equal(built.init.redirect, 'error');
    const response = await fetch(built.url, built.init); assert.equal(response.status, 402);
    const challenge = decodePaymentRequired(response.headers.get('payment-required'));
    assert.deepEqual(challenge.accepts, op['x-x402-payment-required'].accepts);
    assert.equal(challenge.extensions.bazaar.info.input.pathParams.city, '東京');
    assert.equal(challenge.resource.url, built.publicUrl);
    assert.match(await readLimitedResponse(response), /Payment required/);
    for (const path of ['/_seller/docs', '/_seller/docs/', '/_seller/developer/style.css', '/_seller/developer/browser.mjs', '/_seller/developer/request.mjs']) {
      const asset = await fetch(session.url + path); assert.equal(asset.status, 200); assert.ok((await asset.text()).length > 100);
      assert.match(asset.headers.get('content-security-policy'), /connect-src 'self'/);
    }
    const head = await fetch(session.url + '/_seller/openapi.json', { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(await head.text(), '');
    assert.equal((await fetch(session.url + '/_seller/docs', { method: 'POST' })).status, 405);
    const post = buildUnpaidRequest(spec.paths['/compare'].post, { query: {}, body: '{"value":"O\'Brien"}' }, session.url);
    assert.match(post.curl, /--data-raw/); assert.equal((await fetch(post.url, post.init)).status, 402);
    const paidHead = await fetch(session.url + '/status', { method: 'HEAD' }); assert.equal(paidHead.status, 402); assert.equal(await paidHead.text(), '');
    assert.equal((await fetch(session.url + '/dataset')).status, 402); assert.equal(handlerCalls, 0);
    for (const city of ['../admin', '.', '..', 'a%2fb', 'a/b', 'a\\b'])
      assert.throws(() => buildUnpaidRequest(op, { path: { city }, query: { units: 'metric' } }, session.url));
    assert.throws(() => buildUnpaidRequest(op, { path: { city: 'Tokyo' }, query: {} }, session.url), /Required/);
    const exact = JSON.stringify(session.compiled.routes.map(r => r.offer));
    const copy = compileSellerOpenApi(session.compiled); copy.paths['/weather/{city}'].get['x-x402-payment-required'].accepts[0].amount = '1';
    assert.equal(JSON.stringify(session.compiled.routes.map(r => r.offer)), exact);
    await assert.rejects(readLimitedResponse(new Response('12345'), 4), /display limit/);
    console.log('Native service + current responseFile + exact OpenAPI refs/terms + Unicode 402 + GET/POST/HEAD + no application calls: PASS');
  } finally { await session.close(); await rm(directory, { recursive: true, force: true }); }
});
