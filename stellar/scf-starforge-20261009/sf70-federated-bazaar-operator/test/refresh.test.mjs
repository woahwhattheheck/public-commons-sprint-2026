// Focused original SF70 operator HTTP capture coordinator regression.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRefreshCoordinator } from '../refresh.mjs';
const full = (network, stamp) => ({schema:'SCF-SF70/federated-native-bazaar-v1',
  network,observedAt:stamp,state:'BOTH_SOURCES_COMPLETE',
  sources:[{provider:'vellar',status:'COMPLETE_GET_CAPTURE',observedAt:stamp},
           {provider:'periplo',status:'COMPLETE_GET_CAPTURE',observedAt:stamp}],
  listings:[{source:'vellar',url:'https://seller.invalid/example'}],
  observedListingRows:1,merchantRequests:0,payments:0,signatures:0});
test('concurrent real native capture has one upstream operation and distinct delivery label', async () => {
  let calls=0, unblock;
  const capture=async scope=>{calls++;await new Promise(resolve=>{unblock=resolve});return full(scope,'2026-10-11T07:12:54Z')};
  let clock=10000;
  const read=createRefreshCoordinator(capture,{now:()=>clock});
  const first=read('stellar:testnet');const second=read('stellar:testnet');
  await Promise.resolve();
  assert.equal(calls,1);
  unblock();
  const [a,b]=await Promise.all([first,second]);
  assert.equal(calls,1);
  assert.equal(a.operatorDelivery.mode,'LIVE_NATIVE_CAPTURE');
  assert.equal(b.operatorDelivery.mode,'SHARED_LIVE_CAPTURE');
  assert.equal(a.sources[0].observedAt,b.sources[0].observedAt);
  const again=await read('stellar:testnet');
  assert.equal(again.operatorDelivery.mode,'RECENT_COMPLETE_CAPTURE');
  assert.equal(calls,1);
  const manual=read('stellar:testnet',{force:true});await Promise.resolve();assert.equal(calls,2);
  unblock();assert.equal((await manual).operatorDelivery.mode,'LIVE_NATIVE_CAPTURE');
  clock+=8000;
  const next=read('stellar:testnet');await Promise.resolve();assert.equal(calls,3);
  unblock();assert.equal((await next).operatorDelivery.mode,'LIVE_NATIVE_CAPTURE');
});
test('failed or incomplete native provider capture cannot masquerade as cached completeness', async () => {
  let calls=0, clock=1000;
  const read=createRefreshCoordinator(async network=>{calls++; if(calls===1)return {
    ...full(network,'source-t1'),state:'PARTIAL_SOURCE_FAILURE',sources:[
      {provider:'vellar',status:'COMPLETE_GET_CAPTURE'}, {provider:'periplo',status:'SOURCE_ERROR'}]};
    return full(network,'source-t2');},{now:()=>clock});
  const bad=await read('stellar:testnet');
  assert.equal(bad.state,'PARTIAL_SOURCE_FAILURE');
  assert.equal(bad.operatorDelivery.mode,'LIVE_NATIVE_CAPTURE');
  const good=await read('stellar:testnet');assert.equal(calls,2);
  assert.equal(good.state,'BOTH_SOURCES_COMPLETE');
  assert.equal((await read('stellar:testnet')).operatorDelivery.mode,'RECENT_COMPLETE_CAPTURE');
  clock+=10000;
  assert.equal((await read('stellar:testnet')).operatorDelivery.mode,'LIVE_NATIVE_CAPTURE');
});
test('errors clear in-flight; network scopes do not share results',async()=>{
  let calls=0;
  const read=createRefreshCoordinator(async net=>{calls++;if(calls===1)throw Error('TEMPORARY_UPSTREAM');return full(net,'source-time')});
  await assert.rejects(read('stellar:testnet'),/TEMPORARY_UPSTREAM/);
  const b=await read('stellar:pubnet');assert.equal(b.network,'stellar:pubnet');
  const c=await read('stellar:testnet');assert.equal(c.network,'stellar:testnet');
  assert.equal(calls,3);
  await assert.rejects(read('bitcoin:mainnet'),/UNSUPPORTED_STELLAR_NETWORK/);
});
