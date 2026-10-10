import test from 'node:test';
import assert from 'node:assert/strict';
import { atomicAmount,resolveUptoProfile,inspectUptoPhase } from '../upto-profile.mjs';
const registry={ 'stellar:testnet':{
  stateless:{settlementContract:'C_PINNED_STATELESS'},
  contract:{settlementContract:'C_PINNED_STATEFUL',facilitator:'G_KNOWN_FACILITATOR'}
}};
const terms=(profile='stateless')=>({scheme:'upto',network:'stellar:testnet',amount:'10000000',asset:'C_TEST_ASSET',
  payTo:'G_TEST_PAYEE',maxTimeoutSeconds:60,extra:{areFeesSponsored:true,
  settlementContract:profile==='stateless'?'C_PINNED_STATELESS':'C_PINNED_STATEFUL',uptoProfile:profile}});
const stateless=()=>({from:'G_PAYER',payTo:'G_TEST_PAYEE',asset:'C_TEST_ASSET',maxAmount:'10000000',
  validAfter:1800000000,deadline:1800000060,expirationLedger:400,autoRevoke:true,salt:'some-unique-salt',authEntries:['BASE64_XDR_EXAMPLE_UNVERIFIED']});
const stateful=()=>({transaction:'BASE64_TX_XDR_EXAMPLE_UNVERIFIED',authorization:{from:'G_PAYER',to:'G_TEST_PAYEE',asset:'C_TEST_ASSET',maxAmount:'10000000',validAfterLedger:400,deadlineLedger:412,nonce:'unique-nonce',facilitator:'G_KNOWN_FACILITATOR'}});
function input(profile='stateless',actual='3000000'){
 const accepted=terms(profile);
 return {paymentRequired:{x402Version:2,resource:{url:'https://seller.example/pay'},accepts:[structuredClone(accepted)]},
 paymentPayload:{x402Version:2,accepted,payload:profile==='stateless'?stateless():stateful()},
 verifyRequirements:structuredClone(accepted),settleRequirements:{...structuredClone(accepted),amount:actual},
 registry,supportedProfiles:['stateless','contract']};
}
test('signed i128 only, zero is legal at settle',()=>{
 assert.equal(atomicAmount('0',{allowZero:true}),0n);
 assert.equal(atomicAmount('170141183460469231731687303715884105727').toString(),'170141183460469231731687303715884105727');
 for(const x of ['01','0','-1','1.2','1e4','170141183460469231731687303715884105728'])
   assert.throws(()=>atomicAmount(x));
});
test('explicit stateless and contract negotiation prevents downgrade',()=>{
 assert.equal(resolveUptoProfile({uptoProfile:'contract'},{supportedProfiles:['stateless','contract']}).profile,'contract');
 assert.throws(()=>resolveUptoProfile({}, {supportedProfiles:['stateless','contract'],allowSingleStatelessLegacy:true}));
 assert.equal(resolveUptoProfile({}, {supportedProfiles:['stateless'],allowSingleStatelessLegacy:true}).source,'3134_stateless_legacy');
 assert.throws(()=>resolveUptoProfile({uptoProfile:'unknown'},{supportedProfiles:['stateless','contract']}));
});
test('real upstream-compatible stateless shape partial/max/zero',()=>{
 for(const actual of ['3000000','10000000','0']){
   const x=inspectUptoPhase(input('stateless',actual));
   assert.equal(x.actual,actual);assert.equal(x.profile,'stateless');assert.equal(x.signatureVerified,false);
   assert.equal(x.paymentSettled,false);assert.equal(x.window,'unix_seconds_plus_ledger_sequence');
 }
});
test('real proposed contract profile is structurally distinct, never fallback stateless',()=>{
 const x=inspectUptoPhase(input('contract','200000'));
 assert.equal(x.profile,'contract');assert.equal(x.window,'ledger_sequence');
 const a=input('contract');a.paymentPayload.payload=stateless();
 assert.throws(()=>inspectUptoPhase(a));
});
test('must refuse over ceiling and changed verify max or accept ceiling',()=>{
 let a=input();a.settleRequirements.amount='10000001';assert.throws(()=>inspectUptoPhase(a),/ACTUAL_OVER/);
 a=input();a.verifyRequirements.amount='3000000';assert.throws(()=>inspectUptoPhase(a),/VERIFY_MUST_USE/);
 a=input();a.paymentPayload.accepted.amount='15000000';assert.throws(()=>inspectUptoPhase(a),/ACCEPTED_NOT_IN/);
});
test('reject contract/payee/asset/network/scheme drift',()=>{
 for(const prop of ['payTo','asset','network','scheme']){
  let a=input();a.settleRequirements[prop]='DRIFT';assert.throws(()=>inspectUptoPhase(a));
 }
 let a=input();a.settleRequirements.extra.settlementContract='C_Evil';assert.throws(()=>inspectUptoPhase(a),/SETTLEMENT_CONTRACT/);
 a=input();a.paymentPayload.accepted.extra.settlementContract='C_Evil';assert.throws(()=>inspectUptoPhase(a),/ACCEPTED_NOT/);
});
test('profile tampering or untrusted stateful facilitator fails',()=>{
 let a=input();a.settleRequirements.extra.uptoProfile='contract';assert.throws(()=>inspectUptoPhase(a),/PROFILE_CHANGED/);
 a=input('contract');a.paymentPayload.payload.authorization.facilitator='G_ATTACKER';
 assert.throws(()=>inspectUptoPhase(a),/ADVISORY_FACILITATOR/);
});
test('reject malformed wire and invalid window',()=>{
 let a=input();a.paymentPayload.payload.authEntries=[];assert.throws(()=>inspectUptoPhase(a),/ONE_AUTH_ENTRY/);
 a=input();a.paymentPayload.payload.expirationLedger=0;assert.throws(()=>inspectUptoPhase(a));
 a=input();a.paymentPayload.payload.deadline=a.paymentPayload.payload.validAfter;assert.throws(()=>inspectUptoPhase(a));
 a=input('contract');a.paymentPayload.payload.authorization.validAfterLedger=413;assert.throws(()=>inspectUptoPhase(a));
});
