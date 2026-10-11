// MIT. Native facilitator discovery envelope compatibility on the actual SF31 client.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BuyerError, X402BuyerClient } from '../buyer.mjs';

function provider(body, requests) {
  return new X402BuyerClient({ fetchImpl: async (url, init) => {
    requests.push({ url: String(url), method: init.method, redirect: init.redirect });
    return new Response(JSON.stringify(body), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  } });
}

test('current native items envelope preserves original method, offers, and offset pagination', async () => {
  // Provider-native row fields and top-level "items" match SF70's original native reader.
  const nativeRow = {
    resource: 'https://seller.example/api/forecast',
    accepts: [{ scheme:'exact', network:'stellar:testnet', asset:'USDC',
      payTo:'GAPPROVEDSELLER', amount:'200000' }],
    extensions: { bazaar: { info: { input: { type:'http', method:'POST' } } } },
  };
  const payload = { items:[nativeRow], pagination:{offset:20,limit:20,total:28} };
  const requests=[];
  const buyer=provider(payload,requests);
  const result=await buyer.discover({
    origin:'https://facilitator.example',
    filters:{network:'stellar:testnet'}, limit:20, offset:20,
  });
  assert.equal(result.sourceEnvelope,'items');
  assert.deepEqual(result.resources,[nativeRow]);
  assert.deepEqual(result.pagination,payload.pagination);
  assert.deepEqual(requests,[{
    url:'https://facilitator.example/discovery/resources?network=stellar%3Atestnet&limit=20&offset=20',
    method:'GET', redirect:'manual',
  }]);
  // No seller GET, quote mutation, signer, wallet or payment is invoked by discover().
});

test('original resources envelope remains compatible, ambiguous or malformed envelopes fail closed', async () => {
  const requests=[];
  const page={resources:[{resource:{url:'https://seller.example/paid'}}],
    pagination:{offset:0,limit:20,total:1}};
  const buyer=provider(page,requests);
  const original=await buyer.discover({origin:'https://facilitator.example'});
  assert.equal(original.sourceEnvelope,'resources');
  assert.deepEqual(original.resources,page.resources);
  assert.deepEqual(original.pagination,page.pagination);
  for (const malformed of [
    {resources:[],items:[],pagination:{}},
    {resources:[],items:null,pagination:{}},
    {items:{bad:'shape'},pagination:{}},
    {items:['not an original native resource'],pagination:{}},
    {items:[],pagination:[]},
  ]) {
    await assert.rejects(
      provider(malformed,[]).discover({origin:'https://facilitator.example'}),
      e=>e instanceof BuyerError && e.code==='BAD_DISCOVERY_RESPONSE');
  }
});
