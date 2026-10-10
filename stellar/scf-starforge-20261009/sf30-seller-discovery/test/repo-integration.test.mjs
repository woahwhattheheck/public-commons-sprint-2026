/**
 * Source-coupled test runnable from THIS checked-out public repository.
 * No settlement is initiated: all hook facts below are local fixtures.
 * Never run by GitHub Actions; invoke only as a focused local check.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createSellerDiscovery, verifyCatalogAcceptance } from '../index.mjs';
import { PaymentAutoCatalog, validateBazaarExtension } from '../../../../stellar-forge/payment-auto-catalog/auto-catalog.mjs';
import { createDiscoveryServer } from '../../../../scf46-stellar-bazaar/src/catalog.mjs';

const seller = createSellerDiscovery({
  resource: {url: 'https://seller.example/weather',description:'Independent city forecast',serviceName:'Forecast Seller',tags:['weather','data']},
  accepts: [{scheme:'exact',network:'stellar:testnet',payTo:'GSELLER',asset:'USDC:TEST',amount:'20000',maxTimeoutSeconds:60}],
  input: {type:'http',method:'GET',querySchema: {type:'object',properties:{city:{type:'string',description:'City name',examples:['Louisville']}},required:['city'],additionalProperties:false}},
  output: {type:'json',example:{city:'Louisville',forecast:'sunny'}},
});

test('SF30 generated schema accepted by actual SF25 validator, then SF46 -> PR451 GET',async()=>{
  const checked=validateBazaarExtension(seller.extensions.bazaar);
  assert.equal(checked.ok,true,JSON.stringify(checked));
  const payload={x402Version:2,resource:structuredClone(seller.resource),accepted:structuredClone(seller.accepts[0]),
    payload:{fixture:'unsigned; NOT a real authorization'},extensions:structuredClone(seller.extensions)};
  const settlement={status:'settled',sellerId:'test-seller',signer:'GTESTSELLERSIGNER',origin:'https://seller.example',
    network:'stellar:testnet',scheme:'exact',payTo:'GSELLER',asset:'USDC:TEST',amount:'20000',
    receiptSha256:'c'.repeat(64),receiptURL:'https://facilitator.example/receipt/offline-sample',observedAt:'2026-10-10T02:00:00.000Z'};
  const catalog=new PaymentAutoCatalog();
  const original=verifyCatalogAcceptance({seller,paymentPayload:payload,settlement,sequence:1,catalog});
  assert.equal(original.decision,'accepted',JSON.stringify(original));
  assert.equal(catalog.size,1);
  const version=catalog.version;
  const replay=verifyCatalogAcceptance({seller,paymentPayload:payload,settlement,sequence:1,catalog});
  assert.equal(replay.decision,'soft_drop');assert.equal(catalog.version,version);
  const server=createServer(createDiscoveryServer(catalog));
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  try{
    const origin=`http://127.0.0.1:${server.address().port}`;
    const response=await fetch(origin+'/discovery/resources?type=http&scheme=exact&network=stellar%3Atestnet&extensions=bazaar');
    assert.equal(response.status,200);
    const listing=await response.json();
    assert.equal(listing.resources.length,1);
    assert.equal(listing.resources[0].resource.url,seller.resource.url);
    assert.equal(listing.resources[0].extensions.bazaar.info.input.queryParams.city,'Louisville');
    assert.equal(listing.resources[0].extensions.bazaar.schema.properties.input.properties.queryParams.properties.city.description,'City name');
    const search=await fetch(origin+'/discovery/search?query=forecast');
    assert.equal((await search.json()).resources.length,1);
    const mutation=await fetch(origin+'/discovery/resources',{method:'POST'});
    assert.equal(mutation.status,405);
  } finally {await new Promise(ok=>server.close(ok));}
});
