import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeNativeCatalog,renderMerchantHtml} from './input-hints.mjs';
// Source-shaped excerpt of the genuine Vellar discovery schema observed Oct 11.
// Input-key names/field paths are taken from the live native provider result, not a substitute physics/economics simulator.
const offer={type:'http',resource:'https://vellar-seller-demo.onrender.com/convert',accepts:[{network:'stellar:testnet',payTo:'GTEST',amount:'100',scheme:'exact'}],extensions:{bazaar:{
  info:{input:{type:'http',method:'GET',queryParams:{markdown:'example'}}},
  schema:{properties:{input:{properties:{queryParams:{type:'object',properties:{markdown:{type:'string'}},required:['markdown']}}}}}
}}};
const catalog={items:[offer],pagination:{total:1}};
const sf52={schema:'stellar-forge.seller-visibility.v1',mode:'READ_ONLY_UNAUTHENTICATED',seller:offer.resource,network:'stellar:testnet',desiredPayTo:'GTEST',challenge:{state:'NOT_HTTP_402',httpStatus:400},catalog:{complete:true,rawRows:1},verdict:'LISTED'};
test('a native required-query schema does not turn a bare GET 400 into a proven checkout defect',()=>{
  const out=analyzeNativeCatalog(catalog,sf52);
  assert.equal(out.triage,'GET_400_WITH_DECLARED_MISSING_INPUT');
  assert.deepEqual(out.declaredRequiredQueryKeyUnion,['markdown']);
  assert.equal(out.matchedGetOperations,1);
  assert.ok(!JSON.stringify(out).includes('\"example\"'));
  assert.match(renderMerchantHtml(out),/markdown/);
});
test('incomplete catalog or unknown schema retains unresolved 400 severity',()=>{
  assert.equal(analyzeNativeCatalog(catalog,{...sf52,catalog:{complete:false}}).triage,'GET_400_CAUSE_UNRESOLVED');
  const missingSchema=structuredClone(offer);delete missingSchema.extensions.bazaar.schema;
  assert.equal(analyzeNativeCatalog({items:[missingSchema]},sf52).triage,'GET_400_CAUSE_UNRESOLVED');
});
test('match payment option atomically; non-GET does not satisfy GET evidence',()=>{
  const other=structuredClone(offer);other.accepts=[{network:'stellar:testnet',payTo:'OTHER'}];
  const out=analyzeNativeCatalog({items:[other]},sf52);
  assert.equal(out.matchedPaymentRows,0);
  assert.equal(out.triage,'GET_400_CAUSE_UNRESOLVED');
  const post=structuredClone(offer);post.extensions.bazaar.info.input.method='POST';
  assert.equal(analyzeNativeCatalog({items:[post]},sf52).allMatchedGetRequireInput,false);
});

test('native Vellar Railway /inspect/:address path requirement is handled separately',()=>{
  const path=structuredClone(offer);
  path.resource='https://vellar-seller-demo-testnet-production.up.railway.app/inspect/:address';
  path.extensions.bazaar.info.input={type:'http',method:'GET',queryParams:{},pathParams:{address:'never-read-example'}};
  const input=path.extensions.bazaar.schema.properties.input.properties;
  input.queryParams={type:'object',properties:{}};
  input.pathParams={type:'object',properties:{address:{type:'string'}},required:['address']};
  const report={...sf52,seller:path.resource};
  const out=analyzeNativeCatalog({items:[path],pagination:{total:1}},report);
  assert.equal(out.triage,'GET_400_WITH_DECLARED_MISSING_INPUT');
  assert.deepEqual(out.operations[0].unresolvedPathKeys,['address']);
  const concrete={...report,seller:path.resource.replace(':address','GVALIDTESTADDRESS')};
  // The existing exact-resource matcher does not falsely treat an unresolved
  // published URL template as a successful probe of a concrete URL.
  assert.equal(analyzeNativeCatalog({items:[path],pagination:{total:1}},concrete).triage,'GET_400_CAUSE_UNRESOLVED');
});
test('provider first-page subset cannot establish exhaustion; existing real query values do not count as missing',()=>{
  assert.equal(analyzeNativeCatalog({items:[offer],pagination:{total:27}},sf52).triage,'GET_400_CAUSE_UNRESOLVED');
  assert.equal(analyzeNativeCatalog(catalog,{...sf52,seller:offer.resource+'?markdown=hello'}).triage,'GET_400_CAUSE_UNRESOLVED');
  assert.equal(analyzeNativeCatalog(catalog,{...sf52,catalog:{complete:true,rawRows:28}}).triage,'GET_400_CAUSE_UNRESOLVED');
});
