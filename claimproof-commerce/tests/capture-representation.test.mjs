import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCart,InputError} from '../src/core.mjs';
import {PayPalSandbox} from '../src/paypal.mjs';
const id='0KD30046EH157382X',captureId='2PY98415LG287822X',key='12345678-1111-4444-8888-123456789123';
const cart=normalizeCart({currency:'USD',merchantTerms:'Digital delivery. Refund available.',items:[{sku:'CLASS',name:'Course seat',quantity:2,unit_price:'9.95'}]});
const amount={currency_code:'USD',value:cart.total};
const approved=()=>({id,intent:'CAPTURE',status:'APPROVED',purchase_units:[{reference_id:cart.fingerprint.slice(0,24),amount}]});
const representation=(status='COMPLETED')=>({id,status:'COMPLETED',purchase_units:[{reference_id:cart.fingerprint.slice(0,24),payments:{captures:[{id:captureId,status,amount}]}}]});
const response=data=>({ok:true,status:200,json:async()=>data});
function fixture(post,first=approved()){
  const calls={oauth:0,reads:0,posts:0};
  const client=new PayPalSandbox({clientId:'fixture',secret:'fixture',transport:async(url,req)=>{
    assert.ok(url.startsWith('https://api-m.sandbox.paypal.com/'));
    if(url.endsWith('/token')){calls.oauth++;return response({access_token:'fixture-token',expires_in:3600});}
    if(url.endsWith('/capture')){
      calls.posts++;assert.equal(req.headers.Prefer,'return=representation');assert.equal(req.headers['PayPal-Request-Id'],key);
      return response(post);
    }
    calls.reads++;
    if(calls.reads===1)return response(first);
    const complete=representation();complete.intent='CAPTURE';complete.purchase_units[0].amount=amount;
    return response(complete);
  }});
  return {client,calls};
}

test('complete capture representation saves one GET and never mistakes pending for settled',async()=>{
  for(const status of ['COMPLETED','PENDING']){
    const {client,calls}=fixture(representation(status));
    const result=await client.captureApproved(id,cart,key);
    assert.equal(result.status,status);assert.equal(result.id,captureId);assert.equal(result.already_captured,false);
    assert.deepEqual(calls,{oauth:1,reads:1,posts:1});
  }
});

test('minimal or absent capture records retain a read-only fallback without replaying capture',async()=>{
  for(const post of [{id,status:'COMPLETED'},{id,status:'COMPLETED',purchase_units:[{reference_id:cart.fingerprint.slice(0,24),payments:{captures:[]}}]}]){
    const {client,calls}=fixture(post);
    assert.equal((await client.captureApproved(id,cart,key)).status,'COMPLETED');
    assert.deepEqual(calls,{oauth:1,reads:2,posts:1});
  }
});

test('contradictory full capture responses fail before fallback can conceal the mismatch',async()=>{
  for(const mutate of [
    x=>{x.id='0KD30046EH157382Y';},
    x=>{x.purchase_units[0].reference_id='another-cart';},
    x=>{x.purchase_units[0].payments.captures[0].amount={currency_code:'USD',value:'19.89'};},
    x=>{x.purchase_units[0].payments.captures[0].status='DECLINED';},
    x=>{x.intent='AUTHORIZE';},
    x=>{x.purchase_units[0].payments.captures=null;}
  ]){
    const post=structuredClone(representation());mutate(post);
    const {client,calls}=fixture(post);
    await assert.rejects(client.captureApproved(id,cart,key),InputError);
    assert.deepEqual(calls,{oauth:1,reads:1,posts:1});
  }
});

test('pre-capture GET retains full order requirements and rejects a contradictory cart reference',async()=>{
  for(const mutate of [x=>{delete x.intent;},x=>{delete x.purchase_units[0].amount;},x=>{x.purchase_units[0].reference_id='another-cart';}]){
    const first=approved();mutate(first);
    const {client,calls}=fixture(representation(),first);
    await assert.rejects(client.captureApproved(id,cart,key),InputError);
    assert.equal(calls.posts,0);
  }
});
