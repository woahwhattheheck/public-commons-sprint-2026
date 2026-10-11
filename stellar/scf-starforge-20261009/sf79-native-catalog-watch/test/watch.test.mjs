import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkNativeSnapshot, appendNativeObservation, loadWatch, parseArgs } from '../watch.mjs';
import { compareSnapshots } from '../../sf70-federated-bazaar-operator/offer-delta.mjs';

// Only tests local persistence/wire shape using one mechanics-only contract object.
// These are NOT source-provider captures, seller transactions or simulated grant proof.
const source = (provider,status='COMPLETE_GET_CAPTURE',rows=1) => ({
  provider,name:provider,network:'stellar:testnet',status,
  endpoint:`https://${provider}.example/discovery/resources`,rows:status==='SOURCE_ERROR'?0:rows,
  pages:status==='SOURCE_ERROR'?undefined:1,coverage:status==='SOURCE_ERROR'?'UNAVAILABLE':'DECLARED_TOTAL_MATCHED',
});
const operation = (amount='1000') => ({source:'vellar',url:'https://seller.example/items',sourceRow:1,
  method:'GET',kind:'http',toolName:'',label:'Item',description:'Test local metadata',
  paymentOptions:[{network:'stellar:testnet',scheme:'exact',asset:'USDC',payTo:'GTEST',amount}],hiddenPaymentOptions:0});
const snapshot = (amount='1000',failPeriplo=false) => ({
  schema:'SCF-SF70/federated-native-bazaar-v1',network:'stellar:testnet',observedAt:new Date().toISOString(),
  state:failPeriplo?'PARTIAL_SOURCE_FAILURE':'BOTH_SOURCES_COMPLETE',
  sources:[source('vellar'),source('periplo',failPeriplo?'SOURCE_ERROR':'COMPLETE_GET_CAPTURE',failPeriplo?0:0)],
  listings:[operation(amount)],observedListingRows:1,merchantRequests:0,payments:0,signatures:0,
});

test('native original SF71 comparator + persisted restart + coverage + digest recovery',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'scf79-watch-'));
  try {
    let watch=await loadWatch(dir,'stellar:testnet');
    let entry=await appendNativeObservation(watch,snapshot(),compareSnapshots);
    assert.equal(entry.sequence,1);
    assert.equal(entry.delta.status,'BASELINE_CAPTURE');
    watch=await loadWatch(dir,'stellar:testnet');
    entry=await appendNativeObservation(watch,snapshot('1200',true),compareSnapshots);
    assert.equal(entry.delta.counts.changed,1);
    assert.deepEqual(entry.delta.skippedSources,['periplo']);
    assert.equal(watch.lastComplete.sequence,1);
    watch=await loadWatch(dir,'stellar:testnet');
    entry=await appendNativeObservation(watch,snapshot('1300'),compareSnapshots);
    assert.equal(entry.baselineSequence,1);
    assert.equal(entry.delta.counts.changed,1);
    assert.equal(entry.delta.changes[0].addedOptions[0].amount,'1300');
    assert.equal(entry.delta.changes[0].removedOptions[0].amount,'1000');
    watch=await loadWatch(dir,'stellar:testnet');
    assert.equal(watch.sequence,3);
    const file=join(dir,'captures','capture-00000002.json');
    await writeFile(file, (await readFile(file,'utf8')).replace('1200','1500'));
    await assert.rejects(()=>loadWatch(dir,'stellar:testnet'),/CAPTURE_BYTES_SHA_MISMATCH_AT_2/);
  }finally {await rm(dir,{recursive:true,force:true});}
});

test('invalid scopes, signed snapshots and endpoint aliases cannot enter local watcher',()=>{
  assert.throws(()=>checkNativeSnapshot({...snapshot(),payments:1},'stellar:testnet'),/PAID_OR_SIGNED/);
  assert.throws(()=>checkNativeSnapshot(snapshot(),'stellar:pubnet'),/NETWORK_SCOPE_MISMATCH/);
  assert.throws(()=>parseArgs(['--dir=/tmp/test','--origin=http://localhost:8788']),/ORIGIN_MUST_BE/);
});
