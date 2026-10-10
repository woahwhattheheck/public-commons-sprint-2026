// MIT. Focused buyer quote input-contract identity regression; no wallet/network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileHttpQuote } from './quote-guard.mjs';

const url = 'https://weather.example.org/premium';
const payment = () => ({scheme:'exact',network:'stellar:testnet',
  asset:'USDC-ISSUER-TEST',payTo:'G-SELLER-TEST',amount:'25000',
  maxTimeoutSeconds:60,extra:{areFeesSponsored:false}});
const input = () => ({type:'http',method:'GET',
  queryParams:{city:{type:'string',enum:['Austin']}},body:{type:'object',
    properties:{units:{type:'string',enum:['metric']}}}});
const entry = () => ({resource:{url},accepts:[payment()],
  extensions:{bazaar:{info:{input:input()},schema:{type:'object'}}}});
function liveResponse(live) {
  const header = Buffer.from(JSON.stringify({x402Version:2,resource:{url},
    accepts:[payment()],extensions:live.extensions})).toString('base64');
  const response = new Response('',{status:402,headers:{'PAYMENT-REQUIRED':header}});
  Object.defineProperty(response,'url',{value:url});
  return response;
}
const selection = {scheme:'exact',network:'stellar:testnet',
  asset:'USDC-ISSUER-TEST',payTo:'G-SELLER-TEST'};
function decide(c,live) {
  return reconcileHttpQuote({catalogEntry:c,requestUrl:url,
    response:liveResponse(live),selection,maxAtomicUnits:'30000'});
}
test('live 402 input contract cannot drift from catalog beyond type/method',()=>{
  const catalog=entry();
  assert.equal(decide(catalog,entry()).decision,'allow');
  const changedQuery=entry();
  changedQuery.extensions.bazaar.info.input.queryParams.city.enum=['Private'];
  assert.equal(decide(catalog,changedQuery).reason,'ORIGIN_DISCOVERY_IDENTITY_DRIFT');
  const changedBody=entry();
  changedBody.extensions.bazaar.info.input.body.properties.units.enum=['imperial'];
  assert.equal(decide(catalog,changedBody).reason,'ORIGIN_DISCOVERY_IDENTITY_DRIFT');
  const removed=entry();
  removed.extensions.bazaar.info.input={type:'http',method:'GET'};
  assert.equal(decide(catalog,removed).reason,'ORIGIN_DISCOVERY_IDENTITY_DRIFT');
  const reordered=entry();
  reordered.extensions.bazaar.info.input={
    body:{properties:{units:{enum:['metric'],type:'string'}},type:'object'},
    queryParams:{city:{enum:['Austin'],type:'string'}},method:'GET',type:'http'};
  assert.equal(decide(catalog,reordered).decision,'allow');
});
