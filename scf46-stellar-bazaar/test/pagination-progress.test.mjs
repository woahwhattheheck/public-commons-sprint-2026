import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { BazaarCatalog, createDiscoveryServer } from '../src/catalog.mjs';

// Uses the ACTUAL trusted catalog, ranker, identity validator and loopback HTTP
// handler. No synthetic discovery service, facilitator, ledger or payment.
const entry = (name) => ({
  resource: {url: 'https://example.org/weather/' + name, description: 'Weather forecast for ' + name},
  accepts: [{network: 'stellar:testnet', scheme: 'exact', payTo: 'GTESTADDRESS'}],
  extensions: {bazaar: {info: {input: {type: 'http', method: 'GET'}}, schema: {type: 'object'}}}
});

test('nonpositive page sizes cannot produce non-advancing Bazaar cursors', async () => {
  const catalog = new BazaarCatalog();
  catalog.insertValidated(entry('alpha'));
  catalog.insertValidated(entry('beta'));
  assert.throws(() => catalog.search(new URLSearchParams('query=weather&limit=0')), RangeError);
  assert.throws(() => catalog.list(new URLSearchParams('limit=0')), RangeError);
  assert.throws(() => catalog.search(new URLSearchParams('query=weather&limit=000')), RangeError);
  assert.throws(() => catalog.list(new URLSearchParams('limit=101')), RangeError);
  assert.equal(catalog.list(new URLSearchParams('offset=0&limit=2')).resources.length, 2);

  // Cursor generation must still advance and then finish with positive limits.
  const first = catalog.search(new URLSearchParams('query=weather&limit=1'));
  assert.equal(first.resources.length, 1);
  assert.equal(first.partialResults, true);
  assert.ok(first.pagination.cursor);
  const second = catalog.search(new URLSearchParams({
    query: 'weather', limit: '1', cursor: first.pagination.cursor
  }));
  assert.equal(second.resources.length, 1);
  assert.notDeepEqual(second.resources, first.resources);
  assert.equal(second.pagination.cursor, null);

  const server = createServer(createDiscoveryServer(catalog));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = 'http://127.0.0.1:' + server.address().port;
    for (const path of [
      '/discovery/resources?limit=0',
      '/discovery/search?query=weather&limit=0',
      '/discovery/search?query=weather&limit=000'
    ]) {
      const response = await fetch(base + path);
      assert.equal(response.status, 400, path);
      assert.equal((await response.json()).error, 'INVALID_REQUEST');
    }
    const ok = await fetch(base + '/discovery/search?query=weather&limit=1');
    assert.equal(ok.status, 200);
    assert.ok((await ok.json()).pagination.cursor);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('cursor decoding is length-bounded and canonical; valid issued cursors work', () => {
  const catalog = new BazaarCatalog();
  catalog.insertValidated(entry('alpha'));
  catalog.insertValidated(entry('beta'));
  for (const bad of [
    'A'.repeat(10000), // Previously decoded and parsed without any input bound.
    '*'.repeat(10),    // Invalid base64url alphabet.
    'e30=',            // Noncanonical padded base64url.
    ' ',               // Empty/whitespace is not a cursor.
  ]) {
    assert.throws(() => catalog.search(new URLSearchParams({
      query: 'weather', limit: '1', cursor: bad
    })), RangeError, 'invalid cursor ' + bad.slice(0, 12));
  }
  const first = catalog.search(new URLSearchParams('query=weather&limit=1'));
  const next = catalog.search(new URLSearchParams({
    query: 'weather', limit: '1', cursor: first.pagination.cursor
  }));
  assert.equal(next.resources.length, 1);
  assert.equal(next.pagination.cursor, null);
});
