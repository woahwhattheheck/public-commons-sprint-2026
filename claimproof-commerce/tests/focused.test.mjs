import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCart, InputError, paypalOrderBody, staticReview} from '../src/core.mjs';
import {PayPalSandbox} from '../src/paypal.mjs';
const raw={currency:'USD',merchantTerms:'Digital delivery within 2 days. Refund available for unused access.',items:[{sku:'CLASS',name:'Course seat',quantity:2,unit_price:'9.95'}]};
const cart=normalizeCart(raw);
test('amount is fixed from validated decimal cart, not model advice',()=>{
  assert.equal(cart.total,'19.90');
  assert.equal(paypalOrderBody(cart,'http://127.0.0.1:3159').purchase_units[0].amount.value,'19.90');
  assert.throws(()=>normalizeCart({...raw,items:[{...raw.items[0],unit_price:'9.999'}]}),InputError);
  assert.throws(()=>normalizeCart({...raw,items:[{...raw.items[0],quantity:2.7}]}),InputError);
});
test('offline safety findings never claim unsupported external verification',()=>{
  assert.equal(staticReview(normalizeCart({...raw,merchantTerms:''}))[0].code,'NO_TERMS');
  assert.deepEqual(staticReview(cart),[]);
});
test('explicit no-refund language is surfaced rather than treated as benign return terms',()=>{
  const policies=[
    'All sales final. Digital delivery in two days.',
    'No refunds. Digital fulfillment in two days.',
    'Returns are not accepted. Digital delivery in two days.',
    'All items are non-refundable. Digital delivery in two days.'
  ];
  for(const merchantTerms of policies){
    const codes=staticReview(normalizeCart({...raw,merchantTerms})).map(x=>x.code);
    assert.ok(codes.includes('RETURNS_RESTRICTED'),merchantTerms);
    assert.ok(!codes.includes('RETURNS_UNCLEAR'),merchantTerms);
  }
  const unclear=staticReview(normalizeCart({...raw,merchantTerms:'Digital delivery within two days.'})).map(x=>x.code);
  assert.ok(unclear.includes('RETURNS_UNCLEAR'));
  assert.ok(!unclear.includes('RETURNS_RESTRICTED'));
});

test('PayPal Orders v2 state mismatch prevents capture even when browser claims approval',async()=>{
  const calls=[];
  const transport=async (url,req)=>{
    calls.push({url,method:req.method});
    if(url.endsWith('/v1/oauth2/token'))return{ok:true,json:async()=>({access_token:'fixture'})};
    if(url.endsWith('/capture'))throw Error('capture must not be attempted');
    return{ok:true,json:async()=>({id:'0KD30046EH157382X',intent:'CAPTURE',status:'CREATED',purchase_units:[{amount:{currency_code:'USD',value:'19.90'}}]})};
  };
  const sandbox=new PayPalSandbox({clientId:'test',secret:'test',transport});
  await assert.rejects(()=>sandbox.captureApproved('0KD30046EH157382X',cart,'12345678-1111-4444-8888-123456789123'),InputError);
  assert.equal(calls.filter(x=>x.url.endsWith('/capture')).length,0);
});
test('capture only after server-verified APPROVED state and unchanged amount',async()=>{
  const calls=[];let captured=false;
  const transport=async (url,req)=>{
    calls.push(url);
    if(url.endsWith('/v1/oauth2/token'))return{ok:true,json:async()=>({access_token:'fixture'})};
    if(url.endsWith('/capture')){captured=true;return{ok:true,json:async()=>({status:'COMPLETED',id:'0KD30046EH157382X'})};}
    return{ok:true,json:async()=>({id:'0KD30046EH157382X',intent:'CAPTURE',status:captured?'COMPLETED':'APPROVED',purchase_units:[{amount:{currency_code:'USD',value:'19.90'},...(captured?{payments:{captures:[{id:'2PY98415LG287822X',status:'COMPLETED',amount:{currency_code:'USD',value:'19.90'}}]}}:{})}]})};
  };
  const sandbox=new PayPalSandbox({clientId:'test',secret:'test',transport});
  const response=await sandbox.captureApproved('0KD30046EH157382X',cart,'12345678-1111-4444-8888-123456789123');
  assert.equal(response.status,'COMPLETED');
  assert.equal(calls.filter(x=>x.endsWith('/capture')).length,1);
});

test('completed order with matching settled capture reconciles without a second capture POST',async()=>{
  const calls=[];
  const orderId='0KD30046EH157382X';
  const transport=async(url,req)=>{
    calls.push({url,method:req.method});
    if(url.endsWith('/v1/oauth2/token'))return{ok:true,json:async()=>({access_token:'fixture'})};
    if(url.endsWith('/capture'))throw Error('must never post a duplicate capture');
    return{ok:true,json:async()=>({
      id:orderId,intent:'CAPTURE',status:'COMPLETED',
      purchase_units:[{amount:{currency_code:'USD',value:'19.90'},payments:{captures:[
        {id:'2PY98415LG287822X',status:'COMPLETED',amount:{currency_code:'USD',value:'19.90'}}
      ]}}]
    })};
  };
  const sandbox=new PayPalSandbox({clientId:'test',secret:'test',transport});
  const response=await sandbox.captureApproved(orderId,cart,'12345678-1111-4444-8888-123456789123');
  assert.equal(response.status,'COMPLETED');
  assert.equal(response.already_captured,true);
  assert.equal(calls.filter(x=>x.url.endsWith('/capture')).length,0);
});
test('completed order with unverified capture amount fails closed',async()=>{
  const calls=[];
  const orderId='0KD30046EH157382X';
  const transport=async(url,req)=>{
    calls.push(url);
    if(url.endsWith('/v1/oauth2/token'))return{ok:true,json:async()=>({access_token:'fixture'})};
    if(url.endsWith('/capture'))throw Error('must not request capture after completed-order mismatch');
    return{ok:true,json:async()=>({
      id:orderId,intent:'CAPTURE',status:'COMPLETED',
      purchase_units:[{amount:{currency_code:'USD',value:'19.90'},payments:{captures:[
        {id:'2PY98415LG287822X',status:'COMPLETED',amount:{currency_code:'USD',value:'19.89'}}
      ]}}]
    })};
  };
  const sandbox=new PayPalSandbox({clientId:'test',secret:'test',transport});
  await assert.rejects(()=>sandbox.captureApproved(orderId,cart,'12345678-1111-4444-8888-123456789123'),InputError);
  assert.equal(calls.filter(x=>x.endsWith('/capture')).length,0);
});

test('pending capture is read-only until matching settlement, never outer-order success',async()=>{
  const orderId='0KD30046EH157382X',requestId='12345678-1111-4444-8888-123456789123';
  let captured=false,status='PENDING',amount='19.90',posts=0;
  const sandbox=new PayPalSandbox({clientId:'test',secret:'test',transport:async(url)=>{
    if(url.endsWith('/token'))return{ok:true,json:async()=>({access_token:'fixture',expires_in:300})};
    if(url.endsWith('/capture')){posts++;captured=true;return{ok:true,json:async()=>({id:orderId,status:'COMPLETED'})};}
    return{ok:true,json:async()=>({id:orderId,intent:'CAPTURE',status:captured?'COMPLETED':'APPROVED',purchase_units:[{
      amount:{currency_code:'USD',value:'19.90'},...(captured?{payments:{captures:[{
        id:'2PY98415LG287822X',status,amount:{currency_code:'USD',value:amount}
      }]}}:{})
    }]})};
  }});
  assert.equal((await sandbox.captureApproved(orderId,cart,requestId)).status,'PENDING');
  assert.equal((await sandbox.captureApproved(orderId,cart,requestId)).status,'PENDING');
  status='COMPLETED';
  assert.equal((await sandbox.captureStatus(orderId,cart)).status,'COMPLETED');
  amount='19.89';
  await assert.rejects(()=>sandbox.captureStatus(orderId,cart),InputError);
  assert.equal(posts,1);
});

test('OAuth shares refreshes, respects expiry and clears rejected tokens without API replay',async()=>{
  let authCalls=0,apiCalls=0,failAuth=true,rejectToken=false;
  const sandbox=new PayPalSandbox({clientId:'test',secret:'test',transport:async(url)=>{
    if(url.endsWith('/token')){
      authCalls++;await new Promise(resolve=>setImmediate(resolve));
      if(failAuth)throw Error('temporary auth outage');
      return{ok:true,json:async()=>({access_token:'fixture-'+authCalls,expires_in:300})};
    }
    apiCalls++;return rejectToken?{ok:false,status:401}:{ok:true,json:async()=>({id:'test'})};
  }});
  const failed=await Promise.allSettled([sandbox.accessToken(),sandbox.accessToken()]);
  assert.ok(failed.every(x=>x.status==='rejected'));assert.equal(authCalls,1);
  failAuth=false;
  const tokens=await Promise.all([sandbox.accessToken(),sandbox.accessToken(),sandbox.accessToken()]);
  assert.equal(new Set(tokens).size,1);assert.equal(authCalls,2);
  await sandbox.accessToken();assert.equal(authCalls,2);
  sandbox.tokenUntil=Date.now()-1;
  await sandbox.accessToken();assert.equal(authCalls,3);
  rejectToken=true;
  await assert.rejects(()=>sandbox.api('/v2/checkout/orders'),/401/);
  assert.equal(apiCalls,1);assert.equal(sandbox.token,null);
  rejectToken=false;
  await sandbox.api('/v2/checkout/orders');
  assert.equal(authCalls,4);assert.equal(apiCalls,2);
});
