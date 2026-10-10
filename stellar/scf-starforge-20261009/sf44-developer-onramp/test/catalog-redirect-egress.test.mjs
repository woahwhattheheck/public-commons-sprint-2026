// MIT. Focused real loopback HTTP redirect regression for the SF44 onramp.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createCatalogOnlyFetch } from '../mcp-onramp.mjs';
const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const close = server => new Promise((resolve, reject) =>
  server.close(error => error ? reject(error) : resolve()));

test('catalog redirects cannot reach a different origin', async () => {
  let secondOriginHits = 0;
  const second = createServer((_req, res) => {
    secondOriginHits++;
    res.end('unexpected request');
  });
  await listen(second);
  const secondUrl = 'http://127.0.0.1:' + second.address().port;
  const catalog = createServer((req, res) => {
    if (req.url === '/ok') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"resources":[]}');
    } else {
      res.writeHead(302, { location: secondUrl + '/different' });
      res.end();
    }
  });
  await listen(catalog);
  try {
    const origin = 'http://127.0.0.1:' + catalog.address().port;
    const audit = { discoveryHttpRequests: 0, merchantHttpRequests: 0 };
    const limited = createCatalogOnlyFetch(origin, audit);
    await assert.rejects(() => limited(origin + '/discovery/search',
      { redirect: 'follow' }), TypeError);
    await assert.rejects(() => limited(new Request(origin + '/discovery/search',
      { redirect: 'follow' })), TypeError);
    assert.equal(secondOriginHits, 0);
    const ok = await limited(origin + '/ok');
    assert.deepEqual(await ok.json(), { resources: [] });
    assert.equal(ok.status, 200);
    await assert.rejects(() => limited(secondUrl), /External merchant requests/);
    assert.equal(secondOriginHits, 0);
    assert.deepEqual(audit, { discoveryHttpRequests: 3, merchantHttpRequests: 1 });
  } finally {
    await close(catalog);
    await close(second);
  }
});
