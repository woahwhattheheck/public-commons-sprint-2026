import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {start} from '../server.mjs';
import {evaluate} from '../../sf72-post-only-preflight/preflight.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = bytes => Buffer.from(bytes).toString('base64');
const bytesOf = report => Buffer.from(JSON.stringify(report, null, 2).replace(/\n/g, '\r\n') + '\r\n');
const close = server => new Promise(resolve => {server.close(resolve); server.closeAllConnections();});

test('existing console connects original GET and POST captures to original SF76 offline comparison', async t => {
  let ready = false, method = 'GET', requests = 0;
  const buyerOrigin = 'http://127.0.0.1:1';
  const merchant = createServer((req, res) => {
    requests++;
    const origin = `http://127.0.0.1:${merchant.address().port}`;
    const offer = {resource: {url: origin + '/paid'}, type: 'http', x402Version: 2,
      accepts: [{network: 'stellar:testnet', scheme: 'exact', payTo: 'PUBLIC_TEST_RECIPIENT', amount: '1', asset: 'TEST'}],
      extensions: {bazaar: {info: {input: {type: 'http', method}}}}};
    if (req.url.startsWith('/discovery/resources')) {
      res.writeHead(200, {'content-type': 'application/json'});
      res.end(JSON.stringify({items: [offer], pagination: {total: 1}})); return;
    }
    if (ready) {
      res.setHeader('access-control-allow-origin', buyerOrigin);
      res.setHeader('access-control-expose-headers', 'payment-required');
      res.setHeader('access-control-allow-methods', 'GET, POST');
      res.setHeader('access-control-allow-headers', 'payment-signature, content-type');
    }
    if (req.method === 'OPTIONS') {res.writeHead(204); res.end(); return;}
    assert.equal(req.method, 'GET', 'fixture must not receive a paid operation');
    res.writeHead(402, {'payment-required': encode(JSON.stringify(offer))}); res.end();
  });
  await new Promise(resolve => merchant.listen(0, '127.0.0.1', resolve));
  t.after(() => close(merchant));
  const {server, url} = await start({allowLoopback: true});
  t.after(() => close(server));
  const consoleOrigin = new URL(url).origin;
  const merchantOrigin = `http://127.0.0.1:${merchant.address().port}`;
  const api = async (path, input, origin = consoleOrigin) => {
    const response = await fetch(new URL(path, url), {method: 'POST',
      headers: {'content-type': 'application/json', ...(origin ? {origin} : {})}, body: JSON.stringify(input)});
    return {status: response.status, body: await response.json()};
  };
  const intake = async () => {
    const result = await api('/api/intake', {resource: merchantOrigin + '/paid',
      catalog: merchantOrigin + '/discovery/resources', origin: buyerOrigin,
      network: 'stellar:testnet', payTo: 'PUBLIC_TEST_RECIPIENT', method, permission: true});
    assert.equal(result.status, 200); return result.body.report;
  };

  const before = await intake();
  ready = true;
  const after = await intake();
  const beforeBytes = bytesOf(before), afterBytes = bytesOf(after);
  const pair = {before: encode(beforeBytes), after: encode(afterBytes)};
  const requestCount = requests;
  const result = await api('/api/compare', pair);
  assert.equal(result.status, 200);
  assert.equal(result.body.report.classification, 'GET_UNPAID_DISCOVERY_AND_BROWSER_READY');
  assert.equal(result.body.report.source.before.sha256, hash(beforeBytes));
  assert.equal(result.body.report.source.after.sha256, hash(afterBytes));
  assert.ok(result.body.report.changes.notReobservedWithCompleteAfterCatalog.length > 0);
  assert.equal(requests, requestCount, 'comparison must not call any merchant/provider endpoint');

  for (const origin of [undefined, 'https://unrelated.example']) {
    assert.equal((await api('/api/compare', pair, origin === undefined ? null : origin)).status, 403);
  }
  assert.equal((await api('/api/compare', {...pair, before: pair.before + '\n'})).status, 422);
  assert.equal((await api('/api/compare', {...pair, postAfter: encode('{}')})).status, 422);
  const different = structuredClone(after); different.scope.resource += '/different';
  assert.equal((await api('/api/compare', {...pair, after: encode(bytesOf(different))})).status, 422);
  const tampered = structuredClone(before); tampered.findings = []; tampered.state = 'UNPAID_DISCOVERY_AND_BROWSER_READY';
  assert.equal((await api('/api/compare', {...pair, before: encode(bytesOf(tampered))})).status, 422);
  assert.equal((await api('/api/compare', {...pair, before: encode(Buffer.alloc(2_000_001, 32))})).status, 422);

  method = 'POST'; ready = false;
  const postBefore = await intake(), postBeforeBytes = bytesOf(postBefore);
  const pb = await evaluate(postBefore, {allowLoopback: true}); pb.source.intakeSha256 = hash(postBeforeBytes);
  ready = true;
  const postAfter = await intake(), postAfterBytes = bytesOf(postAfter);
  const pa = await evaluate(postAfter, {allowLoopback: true}); pa.source.intakeSha256 = hash(postAfterBytes);
  const postPair = {before: encode(postBeforeBytes), after: encode(postAfterBytes),
    postBefore: encode(bytesOf(pb)), postAfter: encode(bytesOf(pa))};
  const postRequestCount = requests;
  const postResult = await api('/api/compare', postPair);
  assert.equal(postResult.status, 200);
  assert.equal(postResult.body.report.classification, 'POST_OPTIONS_READY_CHALLENGE_UNCHECKED');
  assert.equal(postResult.body.report.source.sf72After.reportSha256, hash(bytesOf(pa)));
  assert.equal(requests, postRequestCount);
  // Semantically identical JSON with different bytes must not satisfy the original SF72 binding.
  assert.equal((await api('/api/compare', {...postPair, before: encode(JSON.stringify(postBefore))})).status, 422);
  assert.equal(requests, postRequestCount);

  const page = await fetch(url);
  assert.match(await page.text(), /id="compare-form"/);
  assert.equal(page.headers.get('cache-control'), 'no-store, max-age=0');
  assert.equal((await fetch(new URL('/console.mjs', url))).status, 200);
});
