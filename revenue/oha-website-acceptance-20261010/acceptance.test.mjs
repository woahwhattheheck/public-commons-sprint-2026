import test from 'node:test';
import assert from 'node:assert/strict';
import { compareSnapshots } from './acceptance.mjs';

const baseline={origin:'https://www.orlandohousing.org',pages:[
 {path:'/',status:200,h1Count:1,imagesWithoutAlt:0},
 {path:'/bids-rfps',status:200,h1Count:1,imagesWithoutAlt:1},
],actions:[
 {id:'apply-online',href:'https://www.orlandohousing.org/apply'},
 {id:'pay-rent',href:'https://payments.example.org/rent'},
]};
const clone = v=>JSON.parse(JSON.stringify(v));
test('same source/target semantics with different host is preliminary pass',()=>{
 const next=clone(baseline);next.origin='https://preview.example.org';next.actions[0].href='https://preview.example.org/apply';
 const r=compareSnapshots(baseline,next);
 assert.equal(r.status,'PASS_PRELIMINARY');assert.equal(r.blockers,0);
 assert.equal(r.baselineCriticalActions,2);
});
test('retired route and changed external rent-payment URL block release',()=>{
 const next=clone(baseline);next.pages.pop();next.actions[1].href='https://wrong.example.org/pay';
 const r=compareSnapshots(baseline,next);
 assert.equal(r.status,'HOLD');assert.deepEqual(r.issues.map(x=>x.code),['PAGE_MISSING','ACTION_TARGET_CHANGED']);
});
test('HTTP 200 to 404 blocks, lost heading and alt increase require review',()=>{
 const next=clone(baseline);next.pages[0]={path:'/',status:404,h1Count:0,imagesWithoutAlt:3};
 const r=compareSnapshots(baseline,next);
 assert.equal(r.blockers,1);assert.equal(r.reviews,2);
 assert.deepEqual(r.issues.filter(x=>x.scope==='/').map(x=>x.code),['ALT_REGRESSION','HEADING_LOSS','PAGE_HTTP_REGRESSION']);
});
test('cannot pass duplicate routes, links bearing secrets or non-HTTPS origins',()=>{
 const dupe=clone(baseline);dupe.pages.push(clone(dupe.pages[0]));
 assert.throws(()=>compareSnapshots(baseline,dupe),/duplicate page path/);
 const token=clone(baseline);token.actions[0].href='https://www.orlandohousing.org/apply?token=secret';
 assert.throws(()=>compareSnapshots(baseline,token),/credential-like query/);
 const insecure=clone(baseline);insecure.origin='http://example.org';
 assert.throws(()=>compareSnapshots(baseline,insecure),/public HTTPS origin/);
});
