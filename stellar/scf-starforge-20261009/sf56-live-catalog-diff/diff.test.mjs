// MIT. One focused native-format contract check, never a provider live simulation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {snapshotFromNative,compareSnapshots} from './diff.mjs';
const sha = b => createHash('sha256').update(b).digest('hex');
const clone = value => structuredClone(value);
const vellar = 'https://vellar-facilitator-testnet-production.up.railway.app/discovery/resources';
const makeRow = (id, overrides={}) => ({
  resource:{url:'https://merchant.example.test/api/'+id,serviceName:id},
  accepts:[{network:'stellar:testnet',scheme:'exact',payTo:'GABC',maxAmountRequired:'100'}],
  extensions:{bazaar:{info:{input:{type:'http',method:'GET',queryParams:{q:'text'}}},schema:{type:'object'},routeTemplate:'/api/'+id}},
  ...overrides
});
function capture(rows,{when='2026-10-10T19:00:00.000Z',otherFilter='',expectedTotal=rows.length}={}) {
  const body={x402Version:2,items:rows,pagination:{offset:0,limit:100,total:expectedTotal}};
  const bytes=Buffer.from(JSON.stringify(body));
  const src={id:'live-0',file:'live-00000000.json',method:'GET',status:200,permission:'public-read',
    captured_at:when,url:vellar+'?limit=100&offset=0'+otherFilter,sha256:sha(bytes)};
  return {manifest:{schema:'SCF-SF41/capture-v1',generated_at:when,endpoint:vellar,
      page_size:100,expected_total:expectedTotal,rows_captured:rows.length,
      pagination_coverage:'DECLARED_TOTAL_MATCHED',sources:[src]},pages:[bytes]};
}
const snapshot = x => snapshotFromNative(x);

test('SF41 complete native snapshots: deterministic adds/removals and independent payment/contract/metadata drift',()=>{
  const original=[makeRow('paid'),makeRow('schema'),makeRow('title'),makeRow('removed'),makeRow('unchanged')];
  const next=clone(original);
  next[0].accepts[0].payTo='GNEW';
  next[1].extensions.bazaar.info.input.queryParams.q='integer';
  next[2].resource.serviceName='title-changed';
  next.splice(3,1);
  next.push(makeRow('added'));
  const before=snapshot(capture(original));
  const after=snapshot(capture(next,{when:'2026-10-10T20:00:00.000Z'}));
  const r=compareSnapshots(before,after);
  assert.deepEqual(r.summary,{changed_routes:5,review_routes:3,ADDED:1,REMOVED:1,
    PAYMENT_TERMS:1,INPUT_CONTRACT:1,METADATA:1,unchanged_routes:1});
  assert.equal(r.original_source.provider_scope,vellar+'?');
  assert.equal(r.changes.filter(x=>x.priority==='REVIEW').length,3);
  assert.deepEqual(r.changes.find(x=>x.change.includes('PAYMENT_TERMS')).change,['PAYMENT_TERMS']);
  assert.equal(JSON.stringify(r).includes('GNEW'),false); // hashed offers, no copied payment address
  assert.deepEqual(compareSnapshots(before,after),r);
});

test('native evidence integrity: reject tampered bytes, truncated total, mixed filters, duplicate canonical route',()=>{
  const first=capture([makeRow('one')]);
  const changed=clone(first);changed.pages[0]=Buffer.from('{}');
  assert.throws(()=>snapshot(changed),/ORIGINAL_PAGE_HASH_MISMATCH/);
  assert.throws(()=>snapshot(capture([makeRow('one')],{expectedTotal:2})),/Capture coverage:/);
  const before=snapshot(first),after=snapshot(capture([makeRow('one')],{when:'2026-10-10T20:00:00.000Z',otherFilter:'&network=eip155%3A8453'}));
  assert.throws(()=>compareSnapshots(before,after),/INCOMPARABLE_PROVIDER_OR_FILTER/);
  assert.throws(()=>snapshot(capture([makeRow('one'),makeRow('one')])),/NONUNIQUE_CANONICAL_ROUTE/);
  assert.throws(()=>compareSnapshots(after,before),/INCOMPARABLE_PROVIDER_OR_FILTER/);
});
