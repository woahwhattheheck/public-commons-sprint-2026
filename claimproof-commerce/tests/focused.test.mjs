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
  const calls=[];
  const transport=async (url,req)=>{
    calls.push(url);
    if(url.endsWith('/v1/oauth2/token'))return{ok:true,json:async()=>({access_token:'fixture'})};
    if(url.endsWith('/capture'))return{ok:true,json:async()=>({status:'COMPLETED',id:'0KD30046EH157382X'})};
    return{ok:true,json:async()=>({id:'0KD30046EH157382X',intent:'CAPTURE',status:'APPROVED',purchase_units:[{amount:{currency_code:'USD',value:'19.90'}}]})};
  };
  const sandbox=new PayPalSandbox({clientId:'test',secret:'test',transport});
  const response=await sandbox.captureApproved('0KD30046EH157382X',cart,'12345678-1111-4444-8888-123456789123');
  assert.equal(response.status,'COMPLETED');
  assert.equal(calls.filter(x=>x.endsWith('/capture')).length,1);
});
