import test from 'node:test';
import assert from 'node:assert/strict';
import { AssetRegistry,parseAtomic,formatAtomic,validatePaymentTerms,StellarUSDC } from './assets.mjs';
const now=1791600000000;
const G='G'+'A'.repeat(55);
const mk=(overrides={})=>new AssetRegistry([{network:'stellar:testnet',asset:StellarUSDC.testnet,code:'USDC',decimals:7,source:'stellar/x402-stellar@45d735a/packages/paywall',verifiedAtMs:now-5000,expiresAtMs:now+60000,...overrides}],{now});
const req={scheme:'exact',network:'stellar:testnet',asset:StellarUSDC.testnet,amount:'15000000',payTo:G};
const verified=(input)=>({...input,ready:true,observedAtMs:now-100});
test('official @x402/stellar 1.50 USDC 7-decimal amount is exact',()=>{
 assert.equal(StellarUSDC.testnet,'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA');
 assert.equal(parseAtomic('1.5',7),'15000000'); assert.equal(formatAtomic('15000000',7),'1.5');
 assert.equal(parseAtomic('0.0000001',7),'1'); assert.equal(formatAtomic('1',7),'0.0000001');
});
test('reject unsafe decimal floats, extra precision, exponent, negatives, overflow and zero',()=>{
 for(const x of [1.5,1e-8,'1e-8','-1','00.1','0.00000001','1.00000001']) assert.throws(()=>parseAtomic(x,7));
 assert.throws(()=>parseAtomic('0',7));
 assert.throws(()=>parseAtomic('170141183460469231731687303715884105728',0));
 assert.equal(parseAtomic('170141183460469231731687303715884105727',0),'170141183460469231731687303715884105727');
 assert.throws(()=>formatAtomic('00001',7));
});
test('reject wrong-chain, unregistered asset, duplicate and stale token metadata',()=>{
 const reg=mk();assert.throws(()=>reg.get('stellar:pubnet',StellarUSDC.testnet,now));
 assert.throws(()=>reg.get('stellar:testnet',StellarUSDC.pubnet,now));
 assert.throws(()=>reg.get('stellar:testnet',StellarUSDC.testnet,now+61000));
 assert.throws(()=>mk({decimals:6}));
 assert.throws(()=>mk({asset:'C'+'B'.repeat(55)}));
 assert.throws(()=>mk({expiresAtMs:now-1}));
});
test('recipient state must come from trusted chain/asset-pinned resolver',async()=>{
 let called=0;
 const v=await validatePaymentTerms(req,mk(),{now,verifyRecipient:async input=>{called++;return verified(input)}});
 assert.equal(v.decimalAmount,'1.5');assert.equal(called,1);
 await assert.rejects(()=>validatePaymentTerms(req,mk(),{now}));
 await assert.rejects(()=>validatePaymentTerms(req,mk(),{now,verifyRecipient:async()=>({...verified(req),network:'stellar:pubnet'})}));
 await assert.rejects(()=>validatePaymentTerms(req,mk(),{now,verifyRecipient:async input=>({...verified(input),ready:false})}));
 await assert.rejects(()=>validatePaymentTerms(req,mk(),{now,verifyRecipient:async input=>({...verified(input),observedAtMs:now-60001})}));
});
test('amount and recipient safety reject no trusted string path or mismatched terms',async()=>{
 for(const p of [{amount:15000000},{amount:'00001'},{amount:'0'},{amount:'170141183460469231731687303715884105728'},{payTo:'evil'},{scheme:'upto'},{network:'stellar:pubnet'}]) {
  await assert.rejects(()=>validatePaymentTerms({...req,...p},mk(),{now,verifyRecipient:async input=>verified(input)}));
 }
});

test('async recipient verifier cannot rewrite already-validated payment terms',async()=>{
 const candidate={...req};
 const observed=await validatePaymentTerms(candidate,mk(),{now,verifyRecipient:async input=>{
   candidate.amount='23000000';candidate.payTo='G'+'B'.repeat(55);
   candidate.network='stellar:pubnet';candidate.scheme='upto';
   return verified(input);
 }});
 assert.equal(candidate.amount,'23000000');
 assert.equal(observed.amount,'15000000');
 assert.equal(observed.decimalAmount,'1.5');
 assert.equal(observed.payTo,req.payTo);
 assert.equal(observed.network,'stellar:testnet');
 assert.equal(observed.scheme,'exact');
});

test('changing payment-amount getter is read once into immutable snapshot',async()=>{
 let reads=0;
 const candidate={...req};
 Object.defineProperty(candidate,'amount',{get(){reads++;return reads===1?'15000000':'23000000';}});
 const observed=await validatePaymentTerms(candidate,mk(),{now,verifyRecipient:async input=>verified(input)});
 assert.equal(observed.amount,'15000000');
 assert.equal(observed.decimalAmount,'1.5');
 assert.equal(reads,1);
});
