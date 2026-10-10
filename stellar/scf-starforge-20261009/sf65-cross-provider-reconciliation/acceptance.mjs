// MIT. Focused offline comparator invariants; not a live provider benchmark.
import assert from 'node:assert/strict';
import {reconcileNativeProviders,renderCrossProviderHtml} from './reconcile.mjs';
const sha=x=>x.repeat(64);
const bucket=(payment='a',contract='b',metadata='c')=>({
  payment:sha(payment),contract:sha(contract),metadata:sha(metadata),
  networks:['stellar:testnet'],offer_count:1
});
const capture=(host,entries,time='2026-10-10T20:18:06Z',network='stellar:testnet')=>({
  schema:'SCF-SF56/snapshot-v1',coverage:'DECLARED_TOTAL_MATCHED',count:entries.length,
  entries:new Map(entries),manifest_sha256:sha('0'),timestamp:time,capture_rows:entries.length,
  scope:'https://'+host+'/discovery/resources?network='+encodeURIComponent(network)
});
const left=capture('provider-a.example',[
  ['http|https://merchant.example/paid|GET',bucket()],
  ['http|https://only-a.example/paid|GET',bucket()]
]);
const right=capture('provider-b.example',[
  ['http|https://merchant.example/paid|GET',bucket('e')],
  ['http|https://only-b.example/paid|GET',bucket()]
]);
const report=reconcileNativeProviders(left,right);
assert.deepEqual([report.summary.uniqueRoutes,report.summary.sharedRoutes,report.summary.paymentTermsConflict,
  report.summary.onlyLeft,report.summary.onlyRight,report.summary.requiresReview],[3,1,1,1,1,1]);
assert.deepEqual(new Set(report.findings.map(x=>x.status)),
  new Set(['ONLY_LEFT_OBSERVED','PAYMENT_TERMS_CONFLICT','ONLY_RIGHT_OBSERVED']));
assert.match(renderCrossProviderHtml(report),/PAYMENT_TERMS_CONFLICT/);
assert.match(renderCrossProviderHtml(report),/Content-Security-Policy/);
assert.throws(()=>reconcileNativeProviders(left,left),/INDEPENDENT_PROVIDER/);
assert.throws(()=>reconcileNativeProviders(left,capture('b.example',[],undefined,'stellar:pubnet')),/INCOMPARABLE_NETWORK/);
assert.equal(reconcileNativeProviders(left,capture('b.example',[], '2026-10-01T00:00:00Z')).capturePair.temporallyPaired,false);
assert.throws(()=>reconcileNativeProviders({...left,manifest_sha256:'nope'},right),/NOT_VERIFIED/);
assert.throws(()=>reconcileNativeProviders(left,{...right,scope:left.scope}),/INDEPENDENT_PROVIDER/);
console.log('SF65 focused comparator invariants: PASS (no real-provider acceptance claimed)');
