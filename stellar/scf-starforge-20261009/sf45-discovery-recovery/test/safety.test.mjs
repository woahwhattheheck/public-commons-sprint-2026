// MIT. Focused actual Node HTTP safety regressions for the released SF45 GET-only client.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fetchDiscoveryCatalog, DiscoveryError} from '../recovery.mjs';

async function serve(handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    baseUrl: 'http://127.0.0.1:' + server.address().port,
    close: () => new Promise(resolve => server.close(resolve))
  };
}
const resource = n => ({
  resource: { url: 'https://seller.example/weather-' + n },
  extensions: { bazaar: { info: { input: { type: 'http', method: 'GET' } } } }
});
function reply(res, resources, cursor) {
  res.writeHead(200, {'content-type': 'application/json'});
  res.end(JSON.stringify({resources, pagination: {cursor}}));
}
const catches = code => e => e instanceof DiscoveryError && e.code === code;

test('chunked oversized body is rejected before JSON parse or extra discovery calls', async () => {
  let calls = 0;
  const server = await serve((req, res) => {
    calls++;
    res.writeHead(200, {'content-type':'application/json', 'transfer-encoding':'chunked'});
    res.write('{"resources":[' + ' '.repeat(400));
    res.end(' '.repeat(400) + '],"pagination":{"cursor":null}}');
  });
  try {
    await assert.rejects(fetchDiscoveryCatalog({baseUrl:server.baseUrl, query:'weather', maxPageBytes:300}), catches('DISCOVERY_RESPONSE_TOO_LARGE'));
    assert.equal(calls,1);
  } finally { await server.close(); }
});

test('nonadjacent cursor A-B-A is stopped on the third response, not 100000 requests', async () => {
  let calls = 0;
  const server = await serve((req, res) => {
    const next = ['A','B','A'][Math.min(calls++, 2)];
    reply(res, [resource('same')], next);
  });
  try {
    await assert.rejects(fetchDiscoveryCatalog({baseUrl:server.baseUrl, query:'weather'}), catches('DISCOVERY_CURSOR_LOOP'));
    assert.equal(calls, 3);
  } finally { await server.close(); }
});

test('new unique rows cannot silently exceed caller resource budget', async () => {
  let calls = 0;
  const server = await serve((req, res) => {
    if (++calls === 1) reply(res,[resource(1),resource(2)],'more');
    else reply(res,[resource(3)],null);
  });
  try {
    await assert.rejects(fetchDiscoveryCatalog({baseUrl:server.baseUrl, query:'weather', maxResources:2}), catches('DISCOVERY_RESOURCE_BOUND_EXHAUSTED'));
    assert.equal(calls,2);
  } finally { await server.close(); }
});

test('finite page budget rejects endless new cursors even without duplication', async () => {
  let calls=0;
  const server=await serve((req,res)=>reply(res,[resource(++calls)],'next'+calls));
  try {
    await assert.rejects(fetchDiscoveryCatalog({baseUrl:server.baseUrl, query:'weather', maxPages:2}), catches('DISCOVERY_PAGE_BOUND_EXHAUSTED'));
    assert.equal(calls,2);
  }finally {await server.close();}
});
