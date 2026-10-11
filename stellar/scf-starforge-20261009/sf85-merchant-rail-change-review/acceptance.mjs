/** Focused original SF84→SF85 source-integrated check. Not a live merchant replay. */
import assert from 'node:assert/strict';
import {compareCaptures,renderMarkdown} from './review.mjs';
const url='https://seller.example/pay?sku=one';
const b64=v=>Buffer.from(JSON.stringify(v)).toString('base64');
const offer=(amount='1000',extra={})=>({scheme:'exact',network:'stellar:testnet',asset:'USDC',payTo:'GTESTSELLER',amount,...extra});
const x402=o=>['PAYMENT-REQUIRED',b64({x402Version:2,resource:{url},accepts:o})];
const mpp=(intent,id,request={asset:'USDC',value:'2'})=>
  ['WWW-Authenticate','Payment id="'+id+'", realm="seller", method="stellar", intent="'+intent+
    '", request="'+Buffer.from(JSON.stringify(request)).toString('base64url')+'"'];
const make=(h,method='GET',target=url,status=402)=>Buffer.from(JSON.stringify({url:target,method,status,headers:h}));
let count=0;const check=f=>{f();count++;};
check(()=>{const r=compareCaptures(make([x402([offer()])]),make([x402([offer('1200')])]));
  assert.equal(r.decision,'MATERIAL_RAIL_CHANGE_REVIEW');assert.equal(r.changes.length,2);
  assert.equal(r.changes[0].kind,'REMOVED');assert.equal(r.changes[1].kind,'ADDED');assert.equal(r.changes[1].amount,'1200');});
check(()=>{const r=compareCaptures(make([mpp('charge','id1')]),make([mpp('session','id2')]));
  assert.equal(r.decision,'MATERIAL_RAIL_CHANGE_REVIEW');assert.equal(r.changes.length,2);
  assert.equal(r.changes[0].intent,'charge');assert.equal(r.changes[1].intent,'session');});
check(()=>{const r=compareCaptures(make([mpp('charge','first')]),make([mpp('charge','rotated')]));
  assert.equal(r.decision,'MATERIAL_TERMS_SAME_OPAQUE_FIELDS_CHANGED');assert.equal(r.changes.length,0);
  assert.equal(r.opaqueChanges[0].kind,'CHALLENGE_ID_ROTATION');});
check(()=>{const r=compareCaptures(make([x402([offer()]),mpp('charge','id1')]),make([x402([offer()]),mpp('charge','id1')]));
  assert.equal(r.decision,'NO_MATERIAL_RAIL_DELTA_OBSERVED');assert.equal(r.counts.before.mpp,1);});
check(()=>{const r=compareCaptures(make([x402([offer()])]),make([x402([offer()])],'POST'));
  assert.equal(r.decision,'SOURCE_OR_SCOPE_REVIEW_REQUIRED');assert(r.flags.includes('CAPTURE_HTTP_METHOD_CHANGED'));});
check(()=>{const r=compareCaptures(make([x402([offer()])]),make([x402([offer()])],'GET','https://seller.example/other'));
  assert(r.flags.includes('CAPTURE_RESOURCE_CHANGED'));});
check(()=>{const r=compareCaptures(make([x402([offer()])]),make([x402([offer()])],'GET',url,200));
  assert(r.flags.includes('NON_402_CAPTURE'));});
check(()=>{const r=compareCaptures(make([x402([offer()])]),make([x402([offer('1000',{description:'changed'})])]));
  assert.equal(r.decision,'MATERIAL_TERMS_SAME_OPAQUE_FIELDS_CHANGED');assert.equal(r.opaqueChanges[0].rail,'x402');});
check(()=>{const r=compareCaptures(make([x402([offer()])]),make([x402([{}])]));
  assert.equal(r.decision,'SOURCE_OR_SCOPE_REVIEW_REQUIRED');assert(r.flags.includes('X402_INCOMPLETE_MATERIAL_TERMS'));});
check(()=>{const r=compareCaptures(make([x402([offer()])]),make([x402([offer()])]));
  const md=renderMarkdown(r);assert(md.includes('Operator handoff'));assert(md.includes(r.source.before.sha256));
  assert(md.includes('Seller scope: GET https://seller.example/pay?sku=one'));});
console.log(JSON.stringify({status:'PASS',focusedCases:count,source:'original SF84 inspectBytes imported by SF85',node:process.version}));
