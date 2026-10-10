import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { compileHttpSellerOffer, paymentRequiredResponse,
  auditCatalogVisibility, probeLocalVisibility } from '../seller.mjs';
import { makeWeatherOffer, startWeatherExample } from '../examples/weather.mjs';
const input = () => ({
  url: 'https://seller.example/weather', method: 'GET', serviceName: 'Example Weather',
  tags: ['weather', 'forecast'], description: 'City forecast endpoint',
  queryParameters: [{ name: 'city', type: 'string', description: 'City name', required: true, example: 'Louisville' }],
  outputExample: { city: 'Louisville', tempC: 20 },
  payment: { network: 'stellar:testnet', scheme: 'exact', amount: '10000',
    asset: 'C_REPLACE_WITH_REAL_SEP41', payTo: 'G_REPLACE_WITH_REAL_ACCOUNT', maxTimeoutSeconds: 60 },
});
test('source-standard HTTP GET info/schema + exact network amounts', () => {
  const offer = compileHttpSellerOffer(input());
  assert.equal(offer.x402Version, 2);
  assert.equal(offer.extensions.bazaar.info.input.queryParams.city, 'Louisville');
  assert.equal(offer.extensions.bazaar.schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(offer.extensions.bazaar.schema.properties.input.properties.queryParams.properties.city.description, 'City name');
  assert.deepEqual(offer.extensions.bazaar.schema.properties.input.properties.method.enum, ['GET']);
  assert.equal(offer.accepts[0].amount, '10000');
  const resp = paymentRequiredResponse(offer);
  assert.equal(resp.statusCode, 402);
  assert.deepEqual(JSON.parse(Buffer.from(resp.headers['PAYMENT-REQUIRED'], 'base64').toString()), offer);
  assert.equal(auditCatalogVisibility({ resources: [] }, offer).decision, 'NOT_INDEXED');
});
test('reject unsafe routes, scheme, decimal floats, URL and metadata poisoning', () => {
  for (const patch of [
    { url: 'http://evil.example/weather' },
    { url: 'https://user:pwd@evil.example/weather' },
    { routeTemplate: '/users/%2e%2e/admin' },
    { routeTemplate: '/users/%252e%252e/admin' },
    { serviceName: 'bad\nheader' },
    { tags: ['duplicated', 'DUPLICATED'] },
    { queryParameters: [{name:'bad',type:'string',example:'x'}] },
  ]) assert.throws(() => compileHttpSellerOffer({ ...input(), ...patch }));
  for (const payment of [
    { ...input().payment, scheme: 'upto' },
    { ...input().payment, amount: 10000 },
    { ...input().payment, amount: '0' },
    { ...input().payment, amount: '1.25' },
    { ...input().payment, network: 'stellar:invalid' },
  ]) assert.throws(() => compileHttpSellerOffer({ ...input(), payment }));
});
test('POST helper emits official body shape and correct body-method schema', () => {
  const offer = compileHttpSellerOffer({ ...input(), method: 'POST',
    bodyType: 'json', body: { query: 'agent commerce' } });
  const inpt = offer.extensions.bazaar.info.input;
  assert.equal(inpt.bodyType, 'json'); assert.deepEqual(inpt.body, { query: 'agent commerce' });
  assert.deepEqual(offer.extensions.bazaar.schema.properties.input.required, ['type','method','bodyType','body']);
});
test('actual local HTTP server advertises a PaymentRequired response, with no settlement', async () => {
  const app = await startWeatherExample();
  try {
    const resp = await fetch(app.endpoint);
    assert.equal(resp.status, 402);
    const body = await resp.json();
    assert.equal(body.x402Version, 2);
    assert.equal(body.extensions.bazaar.info.input.queryParams.city, 'Louisville');
    assert.deepEqual(JSON.parse(Buffer.from(resp.headers.get('payment-required'), 'base64').toString()), body);
  } finally { await app.close(); }
});
test('a real loopback catalog response can be paged and drift is detected', async () => {
  const offer = compileHttpSellerOffer(input());
  const fakeRows = [
    { ...offer, accepts: [{ ...offer.accepts[0], amount: '20000' }] },
  ];
  const server = createServer((req,res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const off = Number(url.searchParams.get('offset') ?? 0);
    const payload = { resources: fakeRows.slice(off, off+100), pagination: { offset:off,limit:100,total:fakeRows.length } };
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(payload));
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  try {
    const v = await probeLocalVisibility(`http://127.0.0.1:${server.address().port}/`, offer);
    assert.equal(v.decision, 'TERMS_DRIFT'); assert.equal(v.settlementAuthenticated, false);
  } finally { await new Promise(resolve => server.close(resolve)); }
});


test('seller resource URLs exclude the destinations blocked by the consumer buyer', () => {
  const denied = [
    'https://127.0.0.1/paid', 'https://0x7f000001/paid',
    'https://10.25.0.2/paid', 'https://169.254.169.254/latest/meta-data',
    'https://192.168.1.1/paid', 'https://[::1]/paid',
    'https://[::ffff:127.0.0.1]/paid', 'https://localhost./paid',
    'https://seller.local/paid', 'https://api.internal/paid',
    'https://seller.home.arpa/paid', 'https://sub.localhost/paid'
  ];
  for (const url of denied) {
    assert.throws(() => compileHttpSellerOffer({ ...input(), url }), /Disallowed resource host/, url);
    assert.throws(() => compileHttpSellerOffer({ ...input(), url }, { allowLocalhost:true }),
      /Disallowed resource host/, 'dev exception must not allow '+url);
  }
  assert.equal(compileHttpSellerOffer(input()).resource.url, 'https://seller.example/weather');
  assert.equal(compileHttpSellerOffer({ ...input(), url:'http://127.0.0.1:4874/weather' },
    {allowLocalhost:true}).resource.url, 'http://127.0.0.1:4874/weather');
  assert.throws(() => compileHttpSellerOffer({ ...input(), url:'http://127.0.0.1:4874/weather' }),
    /Paid resource URL must be HTTPS/);
});

test('seller amounts enforce signed Soroban i128 maximum', () => {
  const maximum = '170141183460469231731687303715884105727';
  const overflow = '170141183460469231731687303715884105728';
  const atMaximum = compileHttpSellerOffer({
    ...input(), payment: {...input().payment, amount: maximum}
  });
  assert.equal(atMaximum.accepts[0].amount, maximum);
  for (const invalid of [overflow, '999999999999999999999999999999999999999']) {
    assert.throws(() => compileHttpSellerOffer({
      ...input(), payment: {...input().payment, amount: invalid}
    }), /signed Soroban i128 limit/);
  }
});


test('PAYMENT-REQUIRED base64 header stays within the shipped SF31 buyer wire budget', () => {
  const headerLimit = 32768;
  // Base64 length 32768 represents a 24576-byte JSON body.
  const maxBodyBytes = headerLimit / 4 * 3;
  const sellerInput = input();
  const offerWithExample = size => compileHttpSellerOffer({
    ...sellerInput, outputExample: { blob: 'x'.repeat(size) }
  });
  const fixedBytes = Buffer.byteLength(JSON.stringify(offerWithExample(0)));
  const payloadBytes = maxBodyBytes - fixedBytes;
  assert.ok(payloadBytes > 0);
  const exactlyAtLimit = offerWithExample(payloadBytes);
  assert.equal(Buffer.byteLength(JSON.stringify(exactlyAtLimit)), maxBodyBytes);
  const wire = paymentRequiredResponse(exactlyAtLimit);
  assert.equal(wire.headers['PAYMENT-REQUIRED'].length, headerLimit);
  assert.deepEqual(JSON.parse(Buffer.from(wire.headers['PAYMENT-REQUIRED'], 'base64')), exactlyAtLimit);
  // One more JSON byte needs four more base64 characters, and must fail closed.
  const tooLarge = offerWithExample(payloadBytes + 1);
  assert.equal(Buffer.from(JSON.stringify(tooLarge)).toString('base64').length, 32772);
  assert.throws(() => paymentRequiredResponse(tooLarge),
    error => error instanceof RangeError && /32768-byte SF31 buyer limit/.test(error.message));
});
