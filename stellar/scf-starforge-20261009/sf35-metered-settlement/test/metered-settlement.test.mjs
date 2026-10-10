import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MeteredUptoSettlement as Engine} from '../metered-settlement.mjs';
const N='stellar:testnet', asset='C_TOKEN_SOURCE_PIN', payTo='G_ORIGINAL_PAYEE', from='G_ORIGINAL_BUYER', contract='C_TRUSTED_UPTO_SETTLEMENT';
const registry={[N]:{stateless:{settlementContract:contract}}};
let serial=0;
const makeInput=(price={numerator:'2',denominator:'3'},mode='bytes')=>{
  const now=Math.floor(Date.now()/1000), n=++serial;
  const accepted={scheme:'upto',network:N,amount:'10',asset,payTo,maxTimeoutSeconds:60,
    extra:{areFeesSponsored:true,settlementContract:contract,uptoProfile:'stateless'}};
  const paymentRequired={x402Version:2,resource:{url:'https://seller.test/metered'},accepts:[structuredClone(accepted)]};
  const paymentPayload={x402Version:2,accepted,payload:{from,payTo,asset,maxAmount:'10',validAfter:now-10,
    deadline:now+120,expirationLedger:900000,autoRevoke:true,salt:'salt-'+n,authEntries:['BASE64_SIGNED_XDR_TEST_ONLY_'+n]}};
  return {paymentRequired,paymentPayload,verifyRequirements:structuredClone(accepted),price,mode,registry};
};
const verifyPayment=async()=>({isValid:true}); // Test adapter; never a real Soroban assertion.
const submitAuthorizedPayment=async x=>({success:true,transaction:'actual-wire-shaped-tx-test-only',network:N,amount:x.actualAtomic});
const proof=({transaction,expectedAmount})=>({transaction,network:N,status:'SUCCESS',ledger:12345,
  transfers:BigInt(expectedAmount)===0n?[]:[{from,to:payTo,asset,amount:expectedAmount}]});
async function sandbox(fn) {const dir=await mkdtemp(join(tmpdir(),'sf35-'));try{await fn(dir);}finally{await rm(dir,{recursive:true,force:true});}}
test('actual produced bytes, exact ceiling, recorded proof and replay fence',()=>sandbox(async dir=>{
  const x=makeInput(), s=await Engine.open({...x,journalDir:dir,verifyPayment});
  await s.recordBytes(Buffer.from('hello')); // 5 observed bytes, 2/3 atomic per byte => ceil(10/3)=4
  assert.deepEqual(s.tally,{units:'5',chargeAtomic:'4',ceilingAtomic:'10'});
  const sealed=await s.seal();assert.equal(sealed.amount,'4');assert.equal(sealed.finality,false);
  const sent=await s.submit({verifyPayment,submitAuthorizedPayment});assert.equal(sent.finality,false);
  const done=await s.reconcile({observeTransaction:async e=>proof(e)});
  assert.equal(done.amount,'4');assert.equal(done.finality,true);assert.match(done.usageDigest,/^[a-f0-9]{64}$/);
  await assert.rejects(()=>Engine.open({...x,journalDir:dir,verifyPayment}),/AUTHORIZATION_ALREADY_RESERVED/);
  assert.equal((await Engine.inspect({journalDir:dir,authorizationId:s.id})).status,'LEDGER_CONFIRMED');
}));
test('refuses real meter over ceiling BEFORE persisting excess usage',()=>sandbox(async dir=>{
  const s=await Engine.open({...makeInput({numerator:'1',denominator:'1'}),journalDir:dir,verifyPayment});
  await s.recordBytes(Buffer.alloc(10));
  await assert.rejects(()=>s.recordBytes(Buffer.from([1])),/METER_EXCEEDS_AUTHORIZED_CEILING/);
  assert.equal(s.tally.units,'10');assert.equal(s.tally.chargeAtomic,'10');
}));
test('refuses recipient/contract/ceiling/timeout drift on real phase schema',()=>sandbox(async dir=>{
  for(const field of ['recipient','contract','ceiling','timeout']){
    const x=makeInput();
    if(field==='recipient')x.paymentPayload.payload.payTo='G_ATTACKER';
    if(field==='contract')x.paymentPayload.accepted.extra.settlementContract='C_ATTACKER';
    if(field==='ceiling')x.paymentPayload.payload.maxAmount='11';
    if(field==='timeout')x.verifyRequirements.maxTimeoutSeconds=61;
    await assert.rejects(()=>Engine.open({...x,journalDir:dir,verifyPayment}));
  }
}));
test('upstream verification rejection consumes reservation; never meters or settles',()=>sandbox(async dir=>{
  const x=makeInput(), bad=async()=>({isValid:false});
  await assert.rejects(()=>Engine.open({...x,journalDir:dir,verifyPayment:bad}),/UPSTREAM_VERIFY_DENIED/);
  await assert.rejects(()=>Engine.open({...x,journalDir:dir,verifyPayment}),/AUTHORIZATION_ALREADY_RESERVED/);
}));
test('submit transport uncertainty is durable and never automatically double-submits',()=>sandbox(async dir=>{
  const s=await Engine.open({...makeInput(),journalDir:dir,verifyPayment});
  await s.recordBytes(Buffer.from('data'));await s.seal();
  let sends=0;
  await assert.rejects(()=>s.submit({verifyPayment,submitAuthorizedPayment:async()=>{sends++;throw Error('timeout');}}),/SUBMIT_INDETERMINATE/);
  await assert.rejects(()=>s.submit({verifyPayment,submitAuthorizedPayment}),/SETTLEMENT_ALREADY_STARTED/);
  assert.equal(sends,1);assert.equal((await Engine.inspect({journalDir:dir,authorizationId:s.id})).status,'SUBMIT_UNKNOWN');
}));
test('cannot claim finality from an incorrectly decoded token transfer',()=>sandbox(async dir=>{
  const s=await Engine.open({...makeInput(),journalDir:dir,verifyPayment});
  await s.recordBytes(Buffer.from('data'));await s.seal();await s.submit({verifyPayment,submitAuthorizedPayment});
  await assert.rejects(()=>s.reconcile({observeTransaction:async e=>({...proof(e),transfers:[{from,to:'G_EVIL',asset,amount:e.expectedAmount}]})}),/LEDGER_TRANSFER_MISMATCH/);
  assert.equal(s.status,'AWAITING_LEDGER');
}));
test('zero measured usage can settle without emitting token transfer',()=>sandbox(async dir=>{
  const s=await Engine.open({...makeInput(),journalDir:dir,verifyPayment});
  assert.equal((await s.seal()).amount,'0');
  await s.submit({verifyPayment,submitAuthorizedPayment});
  assert.equal((await s.reconcile({observeTransaction:async e=>proof(e)})).finality,true);
}));
