import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as tick} from 'node:timers/promises';
import {PayPalSandbox,CaptureOutcomeUnknown} from '../src/paypal.mjs';
import {checkout} from '../src/checkout.mjs';
import {normalizeCart} from '../src/core.mjs';

const id='ORDER123456789',captureId='CAPTURE123456',requestId='11111111-1111-1111-1111-111111111111';
const cart=normalizeCart({currency:'USD',merchantTerms:'Digital delivery. Refunds available.',items:[{sku:'SEAT',name:'Workshop seat',quantity:1,unit_price:'19.99'}]});
const approved={id,intent:'CAPTURE',status:'APPROVED',purchase_units:[{amount:{currency_code:'USD',value:cart.total}}]};
const captured=status=>({...approved,status:'COMPLETED',purchase_units:[{...approved.purchase_units[0],payments:{captures:[{id:captureId,status,amount:{currency_code:'USD',value:cart.total}}]}}]});
const json=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
const newReview=()=>({cart,state:'REVIEWED',order:null,createRequestId:requestId,captureRequestId:requestId});
const request={fingerprint:cart.fingerprint,confirm:true};
const statusRequest={fingerprint:cart.fingerprint};
function provider({postOutcome='PENDING',losePost=false}={}) {
  let current=structuredClone(approved),writes=0,auth=0,reads=0;
  const client=new PayPalSandbox({clientId:'fixture-only',secret:'fixture-only',transport:async(url,opts)=>{
    assert.ok(url.startsWith('https://api-m.sandbox.paypal.com/'));
    if(url.endsWith('/token')){auth++;return json({access_token:'synthetic-only',expires_in:300})}
    if(url.endsWith('/capture')){
      assert.equal(opts.method,'POST');assert.equal(opts.headers['PayPal-Request-Id'],requestId);
      writes++;current=captured(postOutcome);
      if(losePost)throw new Error('synthetic lost response');
      return json(current);
    }
    assert.equal(opts.method,'GET');reads++;return json(structuredClone(current));
  }});
  return {client,stats:()=>({writes,auth,reads}),set:value=>{current=structuredClone(value)}};
}

test('OAuth singleflight, expiry, failed refresh recovery and 401 invalidation without replay',async()=>{
  let now=0,auth=0,api=0,fail=false,unauthorized=false;
  const client=new PayPalSandbox({clientId:'fixture',secret:'fixture',clock:()=>now,transport:async(url)=>{
    if(url.endsWith('/token')){auth++;await tick();if(fail)throw new Error('synthetic unavailable');return json({access_token:'synthetic-'+auth,expires_in:100})}
    api++;return json({},unauthorized?401:200);
  }});
  await Promise.all(Array.from({length:8},()=>client.get(id)));
  assert.equal(auth,1);assert.equal(api,8);
  now=89999;await client.get(id);assert.equal(auth,1);
  now=90000;fail=true;await assert.rejects(client.get(id),/synthetic unavailable/);assert.equal(api,9);
  fail=false;await client.get(id);assert.equal(auth,3);
  unauthorized=true;await assert.rejects(client.get(id),/HTTP 401/);assert.equal(api,11);
  unauthorized=false;await client.get(id);assert.equal(auth,4);assert.equal(api,12);
});

test('order COMPLETED with pending capture stays pending; settlement/decline reads do not recapture',async()=>{
  const p=provider();
  const first=await p.client.captureApproved(id,cart,requestId);
  assert.equal(first.status,'PENDING');assert.equal(first.id,captureId);
  assert.deepEqual(p.stats(),{writes:1,auth:1,reads:2});
  p.set(captured('COMPLETED'));
  assert.equal((await p.client.captureApproved(id,cart,requestId)).status,'COMPLETED');
  p.set(captured('DECLINED'));
  assert.equal((await p.client.captureApproved(id,cart,requestId)).status,'DECLINED');
  assert.equal(p.stats().writes,1);
});

test('order/capture mismatches, malformed completion and missing buyer approval never initiate capture',async()=>{
  const p=provider();
  const wrong=captured('COMPLETED');wrong.purchase_units[0].payments.captures[0].amount.value='20.00';
  p.set(wrong);await assert.rejects(p.client.captureApproved(id,cart,requestId),/capture identity, amount or status/);
  p.set({...approved,id:'OTHER123456789'});await assert.rejects(p.client.captureApproved(id,cart,requestId),/order identity/);
  p.set({...approved,status:'COMPLETED'});await assert.rejects(p.client.captureApproved(id,cart,requestId),/lacks a verified capture/);
  p.set({...approved,status:'CREATED'});await assert.rejects(p.client.captureApproved(id,cart,requestId),/APPROVED/);
  await assert.rejects(p.client.captureApproved(id,cart,'invalid'),/idempotency/);
  assert.equal(p.stats().writes,0);
});

test('same-review create and capture coalesce; pending status advances without another write',async()=>{
  const review=newReview();let creates=0,captures=0,reads=0,next='PENDING';
  const pp={create:async()=>{creates++;await tick();return {order_id:id}},captureApproved:async()=>{captures++;await tick();return {status:next,id:captureId}},captureStatus:async()=>{reads++;return {status:next,id:captureId}}};
  await Promise.all(Array.from({length:8},()=>checkout(review,'create',request,pp,'http://127.0.0.1:3159')));
  assert.equal(creates,1);assert.equal(review.state,'ORDER_CREATED');
  await Promise.all(Array.from({length:8},()=>checkout(review,'capture',request,pp)));
  assert.equal(captures,1);assert.equal(review.state,'CAPTURE_PENDING');
  await checkout(review,'status',statusRequest,pp);assert.equal(review.state,'CAPTURE_PENDING');
  next='COMPLETED';await checkout(review,'status',statusRequest,pp);
  assert.equal(review.state,'CAPTURED');assert.equal(reads,2);assert.equal(captures,1);
});

test('lost capture response preserves unknown state and reconciles read-only with stable original order',async()=>{
  const review=newReview();review.state='ORDER_CREATED';review.order={order_id:id};
  const p=provider({postOutcome:'COMPLETED',losePost:true});
  await assert.rejects(checkout(review,'capture',request,p.client),CaptureOutcomeUnknown);
  assert.equal(review.state,'CAPTURE_UNKNOWN');assert.equal(p.stats().writes,1);
  p.set(approved);await checkout(review,'status',statusRequest,p.client);
  assert.equal(review.state,'CAPTURE_UNKNOWN');
  p.set(captured('COMPLETED'));await checkout(review,'capture',request,p.client);
  assert.equal(review.state,'CAPTURED');assert.equal(p.stats().writes,1);
  assert.equal(review.captureRequestId,requestId);
});

test('each joining request still requires consent/fingerprint; competing operations do not queue writes',async()=>{
  const review=newReview();let creates=0,release;
  const gate=new Promise(resolve=>{release=resolve});
  const pp={create:async()=>{creates++;await gate;return {order_id:id}}};
  const pending=checkout(review,'create',request,pp,'http://127.0.0.1:3159');
  assert.throws(()=>checkout(review,'create',statusRequest,pp),/explicit human/);
  assert.throws(()=>checkout(review,'status',{fingerprint:'different'},pp),/fingerprint/);
  assert.throws(()=>checkout(review,'capture',request,pp),/in progress/);
  release();await pending;assert.equal(creates,1);
  let attempts=0;pp.captureApproved=async()=>{attempts++;throw new Error('synthetic preflight failure')};
  await assert.rejects(checkout(review,'capture',request,pp),/preflight failure/);
  assert.equal(review.state,'ORDER_CREATED');
  pp.captureApproved=async()=>{attempts++;return {status:'DECLINED',id:captureId}};
  await checkout(review,'capture',request,pp);assert.equal(review.state,'CAPTURE_FAILED');
  await checkout(review,'capture',request,pp);assert.equal(attempts,2);
});
