// MIT. Original BazaarCatalog response-envelope regression, actual Node22 loopback HTTP.
// Uses the resource object shape from scf46-stellar-bazaar/src/catalog.mjs.
// No payment, signing, wallet, network provider or hosted Actions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { inspectCatalog, resourceKey } from '../diagnose.mjs';

const sellerUrl = 'https://merchant.example/paid';
const payTo = 'G' + 'A'.repeat(55);
const entry = {
  resource: {url:sellerUrl, description:'Source-native Bazaar resource envelope'},
  accepts:[{scheme:'exact', network:'stellar:testnet',
    asset:'C' + 'A'.repeat(55), payTo, amount:'37'}],
  extensions:{bazaar:{info:{input:{type:'http', method:'GET'}}}}
};

test('source-native resource.url is found in actual paginated catalog HTTP', async () => {
  const server = createServer((req,res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    assert.equal(url.pathname, '/discovery/resources');
    assert.equal(url.searchParams.get('limit'), '2');
    assert.equal(url.searchParams.get('offset'), '0');
    res.writeHead(200, {'content-type':'application/json'});
    res.end(JSON.stringify({
      resources:[entry], pagination:{offset:0,limit:2,total:1}
    }));
  });
  server.listen(0,'127.0.0.1');
  try {
    await once(server,'listening');
    const output = await inspectCatalog({
      catalogUrl:'http://127.0.0.1:' + server.address().port + '/discovery/resources',
      targetResource:sellerUrl, network:'stellar:testnet', payTo,
      allowLoopback:true, pageLimit:2, maxPages:3
    });
    assert.equal(output.complete,true);
    assert.equal(output.incompleteReason,null);
    assert.equal(output.pages,1);
    assert.equal(output.rawRows,1);
    assert.equal(output.matchingResourceCount,1);
    assert.equal(output.matches[0].resource,sellerUrl);
    assert.equal(output.matches[0].desiredNetworkFound,true);
    assert.equal(output.matches[0].desiredPayToFound,true);
  } finally {
    await new Promise(resolve=>server.close(resolve));
  }
});

test('flat external-provider URL still matches; malformed nested objects never match',()=>{
  assert.equal(resourceKey(sellerUrl),sellerUrl);
  assert.equal(resourceKey({url:sellerUrl}),sellerUrl);
  assert.equal(resourceKey({url:{href:sellerUrl}}),null);
  assert.equal(resourceKey({}),null);
  assert.equal(resourceKey(['https://merchant.example/paid']),null);
  assert.equal(resourceKey({url:'javascript:alert(1)'}),null);
});
