// Source-exact SF50 Bazaar v2 regression. No network, wallet, signer or spend.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileHttpQuote } from './quote-guard.mjs';

const URL = 'https://weather.example.org/premium';
const requirements = () => ({ scheme:'exact',network:'stellar:testnet',
  asset:'USDC-ISSUER-TEST',payTo:'G-SELLER-TEST',amount:'25000',
  maxTimeoutSeconds:60,extra:{areFeesSponsored:false} });
const validSchema = () => ({type:'object',required:['input'],
  properties:{input:{type:'object',required:['type','method']}}});
const bazaar = (method='GET') => ({info:{input:{type:'http',method,
  ...(method==='POST' ? {bodyType:'json',body:{city:'Paris'}} :
    {queryParams:{city:'Paris'},headers:{'x-region':'eu'}})}},schema:validSchema()});
function catalog(method='GET',url=URL) {return {resource:{url},accepts:[requirements()],extensions:{bazaar:bazaar(method)}};}
function quote(method='GET',url=URL) {return {x402Version:2,resource:{url},accepts:[requirements()],extensions:{bazaar:bazaar(method)}};}
function response(q,url=q.resource.url) {
  const header=Buffer.from(JSON.stringify(q)).toString('base64');
  const r=new Response('{}',{status:402,headers:{'PAYMENT-REQUIRED':header}});
  Object.defineProperty(r,'url',{value:url});
  return r;
}
function decision(c,q,requestUrl=q.resource.url,method='GET') {
  return reconcileHttpQuote({catalogEntry:c,requestUrl,method,response:response(q),
    selection:{scheme:'exact',network:'stellar:testnet',asset:'USDC-ISSUER-TEST',payTo:'G-SELLER-TEST'},
    maxAtomicUnits:'30000'});
}

test('identical original x402 v2 invocation shape still authorizes',()=>{
  assert.equal(decision(catalog(),quote()).decision,'allow');
  assert.equal(decision(catalog('POST'),quote('POST'),URL,'POST').decision,'allow');
});
test('same payee/amount cannot hide live query/header or schema drift',()=>{
  for (const mutate of [
    q=>{q.extensions.bazaar.info.input.queryParams.city='Berlin';},
    q=>{q.extensions.bazaar.info.input.headers['x-region']='us';},
    q=>{q.extensions.bazaar.schema.properties.input.required=['type','method','headers'];},
  ]) {
    const c=catalog(),q=quote();mutate(q);
    assert.equal(decision(c,q).reason,'ORIGIN_BAZAAR_INPUT_CONTRACT_DRIFT');
  }
});
test('POST body encoding and example drift require renewed buyer approval',()=>{
  for (const mutate of [
    q=>{q.extensions.bazaar.info.input.bodyType='text';},
    q=>{q.extensions.bazaar.info.input.body.city='Berlin';},
  ]) {
    const c=catalog('POST'),q=quote('POST');mutate(q);
    assert.equal(decision(c,q,URL,'POST').reason,'ORIGIN_BAZAAR_INPUT_CONTRACT_DRIFT');
  }
});
test('dynamic route may vary concrete pathParams but not static input contract',()=>{
  const c=catalog('GET','https://weather.example.org/cities/12');
  const q=quote('GET','https://weather.example.org/cities/23');
  c.extensions.bazaar.routeTemplate='/cities/:id';
  q.extensions.bazaar.routeTemplate='/cities/:id';
  c.extensions.bazaar.info.input.pathParams={id:'12'};
  q.extensions.bazaar.info.input.pathParams={id:'23'};
  assert.equal(decision(c,q).decision,'allow');
  q.extensions.bazaar.info.input.headers['x-region']='other';
  assert.equal(decision(c,q).reason,'ORIGIN_BAZAAR_INPUT_CONTRACT_DRIFT');
});
test('missing schema is not a stable authentic v2 Bazaar contract',()=>{
  const c=catalog(),q=quote();delete q.extensions.bazaar.schema;
  assert.equal(decision(c,q).decision,'reject');
  delete c.extensions.bazaar.schema;
  assert.equal(decision(c,q).reason,'MALFORMED_QUOTE_OR_RESOURCE');
});
