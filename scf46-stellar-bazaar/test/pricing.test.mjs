import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { BazaarCatalog, createDiscoveryServer } from '../src/catalog.mjs';
import { parseAtomicBudget, sanitizeBazaarPricing } from '../src/pricing.mjs';

const quote = (network, asset, scheme, amount, payTo = 'GPAYEE') =>
  ({network, asset, scheme, amount, payTo});
const entry = (name, accepts, pricing) => ({
  resource: {url:'https://seller.example/'+name,serviceName:name,description:'Forecast by city'},
  accepts,
  extensions:{bazaar:{
    info:{input:{type:'http',method:'GET'},output:{type:'json'}},
    schema:{type:'object',properties:{city:{type:'string'}}},
    ...(pricing === undefined ? {} : {pricing})
  }}
});

test('real catalog view compares intact network/asset options and separates ceiling from price', () => {
  const c = new BazaarCatalog();
  const fixed = quote('stellar:testnet','USDC:STELLAR','exact','50');
  const metered = quote('stellar:pubnet','USDC:MAIN','upto','1000','GMAIN');
  c.insertValidated(entry('forecast',[fixed,metered],{
    model:'per-token', unit:{amount:'12',per:'1000 tokens'},typical:'30'
  }));
  const testnet = c.pricing(new URLSearchParams(
    'network=stellar:testnet&asset=USDC%3ASTELLAR&budgetAtomic=100'
  )).resources;
  assert.equal(testnet.length,1);
  assert.equal(testnet[0].pricingView.offers.length,1);
  assert.equal(testnet[0].pricingView.offers[0].scheme,'exact');
  assert.equal(testnet[0].pricingView.offers[0].budgetAssessment,
    'ADVERTISED_PRICE_WITHIN_BUDGET');
  const prod = c.pricing(new URLSearchParams(
    'network=stellar:pubnet&asset=USDC%3AMAIN&scheme=upto&payTo=GMAIN&budgetAtomic=100'
  )).resources[0];
  assert.equal(prod.pricingView.offers.length,1);
  assert.equal(prod.pricingView.offers[0].budgetAssessment,
    'CEILING_ABOVE_BUDGET_SELLER_TYPICAL_WITHIN');
  assert.equal(prod.pricingView.offers[0].amountMeaning,'MAXIMUM_AUTHORIZATION_NOT_SETTLED_PRICE');
  assert.equal(prod.pricingView.offers[0].observedSettledAmountAtomic,null);
  assert.equal(prod.pricingView.offers[0].requiresFresh402AndBuyerApproval,true);
  assert.equal(c.pricing(new URLSearchParams(
    'network=stellar:testnet&asset=USDC%3AMAIN&budgetAtomic=100')).resources.length,0);
  assert.equal(c.search(new URLSearchParams(
    'query=forecast&network=stellar:testnet&asset=USDC%3AMAIN')).resources.length,0);
  assert.equal(c.list().resources[0].pricingView,undefined,'legacy list unchanged');
  assert.equal(c.size,1);
});

test('unknown metered cost retained, mixed denominations do not assign unscoped typical', () => {
  const c = new BazaarCatalog();
  c.insertValidated(entry('weather',[
    quote('stellar:testnet','ASSET:A','upto','500'),
    quote('stellar:pubnet','ASSET:B','upto','900')
  ],{model:'per-token',typical:'10'}));
  const all = c.pricing().resources[0].pricingView.offers;
  assert.equal(all.length,2);
  assert.equal(all[0].sellerClaimedTypicalAtomic,null);
  assert.equal(all[1].sellerClaimedTypicalAtomic,null);
  const scoped = c.pricing(new URLSearchParams('network=stellar:testnet&asset=ASSET%3AA&budgetAtomic=50'));
  assert.equal(scoped.resources[0].pricingView.offers[0].sellerClaimedTypicalAtomic,'10');
  assert.equal(scoped.resources[0].pricingView.offers[0].budgetAssessment,
    'CEILING_ABOVE_BUDGET_SELLER_TYPICAL_WITHIN');
  c.insertValidated(entry('unknown',[quote('stellar:testnet','ASSET:A','upto','1000')]));
  const unknown = c.pricing(new URLSearchParams('network=stellar:testnet&asset=ASSET%3AA&budgetAtomic=50'))
    .resources.find(r=>r.resource.url.endsWith('/unknown'));
  assert.equal(unknown.pricingView.offers[0].budgetAssessment,'CEILING_ABOVE_BUDGET_COST_UNKNOWN');
});

test('untrusted pricing hint fails soft, and honest seller amount remains untouched', () => {
  const c = new BazaarCatalog();
  const invalid = entry('stale',[quote('stellar:testnet','USD','upto','1100')],{
    model:'malicious',note:'false price',typical:'1'
  });
  c.insertValidated(invalid);
  const row = c.list().resources[0];
  assert.equal(row.extensions.bazaar.pricing,undefined);
  assert.equal(row.accepts[0].amount,'1100');
  assert.equal(invalid.extensions.bazaar.pricing.model,'malicious','input remains unchanged');
  assert.deepEqual(sanitizeBazaarPricing({model:'custom',unit:{amount:'1e9',per:'x'},typical:'1e8'}),
    {model:'custom'});
  assert.throws(()=>c.pricing(new URLSearchParams('budgetAtomic=10')),RangeError);
  assert.throws(()=>c.pricing(new URLSearchParams('asset=USD&budgetAtomic=10')),RangeError);
  assert.throws(()=>parseAtomicBudget('170141183460469231731687303715884105728'),RangeError);
});

test('HTTP pricing endpoint works with actual native server and 400s are explicit', async () => {
  const c = new BazaarCatalog();
  c.insertValidated(entry('time',[quote('stellar:testnet','USD','exact','6')],{model:'per-call'}));
  const server = createServer(createDiscoveryServer(c));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const root = 'http://127.0.0.1:'+server.address().port;
    const good = await fetch(root+'/discovery/pricing?network=stellar:testnet&asset=USD&budgetAtomic=7');
    assert.equal(good.status,200);
    const body = await good.json();
    assert.equal(body.pricingViewVersion,'stellar-bazaar-pricing-v1');
    assert.equal(body.resources[0].pricingView.offers[0].budgetAssessment,'ADVERTISED_PRICE_WITHIN_BUDGET');
    assert.equal(body.resources[0].pricingView.offers[0].requiresFresh402AndBuyerApproval,true);
    const old = await (await fetch(root+'/discovery/resources')).json();
    assert.equal(old.resources[0].pricingView,undefined);
    const invalid = await fetch(root+'/discovery/pricing?budgetAtomic=7');
    assert.equal(invalid.status,400);
    const err = await invalid.json();
    assert.equal(err.error,'INVALID_REQUEST');
    assert.match(err.reason,/requires network and asset/);
    const post = await fetch(root+'/discovery/pricing',{method:'POST'});
    assert.equal(post.status,405);
  } finally {
    await new Promise(resolve=>server.close(resolve));
  }
});
