// MIT. Source-exact SF31 discovery offset behavior; imports the existing buyer module.
import test from 'node:test';
import assert from 'node:assert/strict';
import { X402BuyerClient, BuyerError } from '../buyer.mjs';

function fixture() {
  const requests = [];
  const buyer = new X402BuyerClient({
    fetchImpl: async (url, options) => {
      requests.push({url: String(url), method: options.method, redirect: options.redirect});
      return new Response(JSON.stringify({
        resources: [{id:'real-source-client-consumed-page'}],
        pagination: {limit: 20, offset: 40, total: 81}
      }), {status: 200, headers: {'content-type': 'application/json'}});
    }
  });
  return {buyer, requests};
}

test('default zero offset keeps original root-route URL and a single GET', async () => {
  const {buyer,requests}=fixture();
  const page=await buyer.discover({origin:'https://catalog.example/'});
  assert.deepEqual(requests,[{
    url:'https://catalog.example/discovery/resources?limit=20',
    method:'GET', redirect:'manual'
  }]);
  assert.equal(page.source,requests[0].url);
  assert.equal(page.pagination.offset,40);
});

test('explicit offset works with the separately merged provider prefix', async () => {
  const {buyer,requests}=fixture();
  const page=await buyer.discover({
    origin:'https://catalog.example/platform/v2/x402/?discard=old',
    query:'Stellar API',
    filters:{network:'stellar:testnet'}, limit:10, offset:40
  });
  assert.equal(requests[0].url,
    'https://catalog.example/platform/v2/x402/discovery/search?query=Stellar+API&network=stellar%3Atestnet&limit=10&offset=40');
  assert.equal(requests[0].redirect,'manual');
  assert.equal(page.resources.length,1);
  assert.deepEqual(page.pagination,{limit:20,offset:40,total:81});
  assert.equal(requests.length,1);
});

test('nonzero resource offset is serialized without unexpected query changes', async () => {
  const {buyer,requests}=fixture();
  await buyer.discover({origin:'https://catalog.example/api',offset:1});
  assert.equal(requests[0].url,
    'https://catalog.example/api/discovery/resources?limit=20&offset=1');
});

test('invalid offsets fail before fetch', async () => {
  const {buyer,requests}=fixture();
  for(const offset of [-1,0.5,'1',NaN,Infinity,Number.MAX_SAFE_INTEGER+1]){
    await assert.rejects(
      ()=>buyer.discover({origin:'https://catalog.example/',offset}),
      e=>e instanceof BuyerError&&e.code==='BAD_DISCOVERY_OFFSET',
      String(offset)
    );
  }
  assert.equal(requests.length,0);
});
