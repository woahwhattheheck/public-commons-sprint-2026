import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {parseCaptureFilters,buildNativePageURL,assertNativePageScope,validateCaptureFilters} from '../capture_filters.mjs';
const origin='https://vellar-facilitator-testnet-production.up.railway.app/discovery/resources';
test('first-party Stellar testnet request scoped identically across native pages',()=>{
  const filters=parseCaptureFilters(['--url',origin,'--network','stellar:testnet','--id','vellar','--type','http']);
  const first=buildNativePageURL(origin,filters,0,100);
  const second=buildNativePageURL(origin,filters,27,100);
  assert.equal(first.search,'?type=http&network=stellar%3Atestnet&limit=100&offset=0');
  assert.equal(second.searchParams.get('network'),'stellar:testnet');
  assert.ok(assertNativePageScope(first,filters));
  assert.ok(assertNativePageScope(second,filters));
});
test('full documented native filter set and legacy unfiltered requests',()=>{
  const filters={type:'mcp',payTo:'GB5FAKEPUBLICADDRESS',scheme:'exact',network:'stellar:testnet',extensions:'bazaar'};
  const p=buildNativePageURL(origin,filters,0,50);
  assert.ok(assertNativePageScope(p,filters));
  assert.deepEqual(validateCaptureFilters({}),{});
  assert.ok(assertNativePageScope(buildNativePageURL(origin,{},0,100),undefined));
});
test('request query tampering, page drift and duplicate params fail',()=>{
  const filters={network:'stellar:testnet'};
  const p=buildNativePageURL(origin,filters,0,100);
  p.searchParams.set('network','stellar:pubnet');
  assert.throws(()=>assertNativePageScope(p,filters),/filter drift/);
  p.searchParams.set('network','stellar:testnet');p.searchParams.append('network','stellar:testnet');
  assert.throws(()=>assertNativePageScope(p,filters),/Duplicate/);
  p.searchParams.delete('network');
  assert.throws(()=>assertNativePageScope(p,filters),/Missing/);
  p.searchParams.set('network','stellar:testnet');p.searchParams.set('query','needle');
  assert.throws(()=>assertNativePageScope(p,filters),/Undeclared/);
  assert.throws(()=>assertNativePageScope(p,{}),/Undeclared/);
});
test('reject invalid CLI filters before network or recording a manifest',()=>{
  assert.throws(()=>parseCaptureFilters(['--network','stellar:testnet','--network','stellar:pubnet']),/Duplicate/);
  assert.throws(()=>parseCaptureFilters(['--network','--id','oops']),/Invalid/);
  assert.throws(()=>validateCaptureFilters({cursor:'secret'}),/Unsupported/);
  assert.throws(()=>validateCaptureFilters({network:'x\ny'}),/Invalid/);
  assert.throws(()=>validateCaptureFilters({payTo:'x'.repeat(257)}),/Invalid/);
  assert.throws(()=>buildNativePageURL(origin+'?network=stellar:testnet',{},0,100),/no query/);
});
