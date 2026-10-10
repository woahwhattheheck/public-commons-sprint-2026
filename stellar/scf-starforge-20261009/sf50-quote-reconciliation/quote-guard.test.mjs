// MIT. Focused changed-behavior checks, no wallets, RPC or network spend.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileHttpQuote } from './quote-guard.mjs';

const url = 'https://weather.example.org/premium';
const terms = () => ({ scheme:'exact', network:'stellar:testnet', asset:'USDC-ISSUER-TEST',
  payTo:'G-SELLER-TEST', amount:'25000', maxTimeoutSeconds:60, extra:{areFeesSponsored:false} });
const extension = () => ({ bazaar:{ info:{ input:{type:'http',method:'GET'} }, schema:{type:'object'} } });
const catalog = () => ({ resource:{url}, accepts:[terms()], extensions:extension() });
const quote = () => ({ x402Version:2, resource:{url}, accepts:[terms()], extensions:extension() });
const selection = { scheme:'exact', network:'stellar:testnet', asset:'USDC-ISSUER-TEST', payTo:'G-SELLER-TEST' };
function response(q=quote(), override={}) {
  const header = Buffer.from(JSON.stringify(q)).toString('base64');
  const r = new Response('{}', {status:402,headers:{'PAYMENT-REQUIRED':header}});
  Object.defineProperty(r,'url',{value:override.url||url});
  Object.defineProperty(r,'redirected',{value:override.redirected||false});
  return r;
}
const args = (c=catalog(),r=response()) => ({catalogEntry:c,requestUrl:url,response:r,selection,maxAtomicUnits:'30000'});
test('matches a real v2-style Bazaar catalog entry to the fresh origin HTTP header',()=>{
  const x=reconcileHttpQuote(args()); assert.equal(x.decision,'allow');
  assert.equal(x.paymentRequirement.amount,'25000'); assert.equal(x.receiptSha256.length,64);
  assert.equal(reconcileHttpQuote(args()).receiptSha256,x.receiptSha256);
});
test('rejects changed price, payee, network, asset, timeout and scheme extra',()=>{
  for (const change of [t=>t.amount='25001',t=>t.payTo='G-EVIL',t=>t.network='stellar:pubnet',
    t=>t.asset='OTHER-ASSET',t=>t.maxTimeoutSeconds=90,t=>t.extra.areFeesSponsored=true]) {
    const q=quote(); change(q.accepts[0]);
    assert.notEqual(reconcileHttpQuote(args(catalog(),response(q))).decision,'allow');
  }
});
test('rejects unaffordable but otherwise matching quote',()=>{
  const x=reconcileHttpQuote({...args(),maxAtomicUnits:'24999'});
  assert.equal(x.reason,'BUYER_CAP_EXCEEDED');
});
test('rejects malformed/duplicate payment options and noncanonical decimal prices',()=>{
  for (const amount of ['025000','2.5','-1','1e5',3]) {
    const q=quote();q.accepts[0].amount=amount;
    assert.equal(reconcileHttpQuote(args(catalog(),response(q))).decision,'reject');
  }
  const q=quote();q.accepts.push(terms());
  assert.equal(reconcileHttpQuote(args(catalog(),response(q))).reason,'PAYMENT_OPTION_AMBIGUOUS_OR_MISSING');
});
test('stale marketplace resource, different request method, and wrong origin are rejected',()=>{
  let c=catalog();c.resource.url='https://bad.example/premium';
  assert.equal(reconcileHttpQuote(args(c)).reason,'DISCOVERY_RESOURCE_MISMATCH');
  assert.equal(reconcileHttpQuote({...args(),method:'POST'}).reason,'DISCOVERY_METHOD_MISMATCH');
  assert.equal(reconcileHttpQuote(args(catalog(),response(quote(),{url:'https://other.example/premium'}))).reason,'ORIGIN_REDIRECT_OR_MISMATCH');
});
test('quote without Bazaar identity is not authoritative for discovered method',()=>{
  const q=quote(); delete q.extensions;
  assert.equal(reconcileHttpQuote(args(catalog(),response(q))).reason,'ORIGIN_DISCOVERY_IDENTITY_DRIFT');
});
test('rejects redirects, missing header, non-402 and missing buyer authorization',()=>{
  assert.equal(reconcileHttpQuote(args(catalog(),response(quote(),{redirected:true}))).reason,'ORIGIN_REDIRECT_OR_MISMATCH');
  const r=new Response('{}',{status:402});Object.defineProperty(r,'url',{value:url});
  assert.equal(reconcileHttpQuote(args(catalog(),r)).reason,'MALFORMED_QUOTE_OR_RESOURCE');
  const ok=new Response('{}',{status:200});Object.defineProperty(ok,'url',{value:url});
  assert.equal(reconcileHttpQuote(args(catalog(),ok)).reason,'MALFORMED_QUOTE_OR_RESOURCE');
  assert.equal(reconcileHttpQuote({...args(),selection:null}).reason,'EXPLICIT_SELECTION_REQUIRED');
});
test('default mainnet/upto policy fails closed',()=>{
  const q=quote(),c=catalog();
  q.accepts[0].network='stellar:pubnet';c.accepts[0].network='stellar:pubnet';
  const requested={...selection,network:'stellar:pubnet'};
  assert.equal(reconcileHttpQuote({...args(c,response(q)),selection:requested}).reason,'BUYER_POLICY_SCHEME_OR_NETWORK');
  q.accepts[0].scheme='upto';c.accepts[0].scheme='upto';
  assert.equal(reconcileHttpQuote({...args(c,response(q)),selection:{...requested,scheme:'upto'}}).reason,'BUYER_POLICY_SCHEME_OR_NETWORK');
});
test('exact authorized dynamic template stays on catalog host and path family',()=>{
  const c=catalog(),q=quote();
  c.resource.url='https://weather.example.org/cities/12';c.extensions.bazaar.routeTemplate='/cities/:id';
  q.resource.url='https://weather.example.org/cities/23';q.extensions.bazaar.routeTemplate='/cities/:id';
  const r=response(q,{url:q.resource.url});
  const x=reconcileHttpQuote({...args(c,r),requestUrl:q.resource.url});
  assert.equal(x.decision,'allow');
  assert.equal(reconcileHttpQuote({...args(c,r),requestUrl:'https://weather.example.org/cities/23/extra'}).decision,'reject');
});

test('Soroban i128 extremes cannot become a buyer-approved signed amount',()=>{
  const max=((1n<<127n)-1n).toString(), overflow=((1n<<127n)).toString();
  // Original main accepted a 39-digit 9...9 quote when buyer cap matched it.
  for (const scheme of ['exact','upto']) {
    const c=catalog(),q=quote(),sel={...selection,scheme};
    c.accepts[0].scheme=scheme;q.accepts[0].scheme=scheme;
    c.accepts[0].amount=max;q.accepts[0].amount=max;
    assert.equal(reconcileHttpQuote({...args(c,response(q)),selection:sel,
      allowedSchemes:[scheme],maxAtomicUnits:max}).decision,'allow');
    for (const amount of [overflow,'9'.repeat(39),'9'.repeat(78)]) {
      c.accepts[0].amount=amount;q.accepts[0].amount=amount;
      assert.equal(reconcileHttpQuote({...args(c,response(q)),selection:sel,
        allowedSchemes:[scheme],maxAtomicUnits:max}).reason,'MALFORMED_QUOTE_OR_RESOURCE');
    }
  }
  assert.equal(reconcileHttpQuote({...args(),maxAtomicUnits:overflow}).reason,'BUYER_CAP_REQUIRED');
  assert.equal(reconcileHttpQuote({...args(),maxAtomicUnits:'0'}).reason,'BUYER_CAP_EXCEEDED');
});
