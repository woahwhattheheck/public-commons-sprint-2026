/**
 * SF19 offline signing-admission regression, not a canonical SDK / chain sim.
 * Run: node stellar/scf-starforge-20261009/sf19-secretless-signer-boundary/custody.check.mjs
 */
import assert from 'node:assert/strict';
import { SecretlessSignerBoundary } from './custody.mjs';
const NOW=1_000_000;
const baseline=()=>({
 actors:['agent-A'],allowedOrigins:['https://merchant.example'],
 assetPolicies:{TEST_USDC:{network:'stellar:testnet',
  payTo:['GRECIPIENT'],maxBaseUnits:'1000000'}},
 clock:()=>NOW,approve:async()=>true
});
const quote=(id='q1')=>({
 quoteId:id,actor:'agent-A',resourceUrl:'https://merchant.example/pricing?a=1',
 method:'GET',scheme:'exact',network:'stellar:testnet',asset:'TEST_USDC',
 payTo:'GRECIPIENT',amount:'100',expiresAt:NOW+60000
});
const signed=q=>({
 x402Version:2,resource:{url:q.resourceUrl},
 accepted:{scheme:q.scheme,network:q.network,asset:q.asset,
  payTo:q.payTo,amount:q.amount},payload:{signature:'public-signed-envelope'}
});
let signerCalls=0;
const config=()=>({...baseline(),sign:async q=>{signerCalls++;return signed(q)}});
const good=new SecretlessSignerBoundary(config());
const result=await good.authorizeAndSign(quote());
assert.equal(result.status,'SIGNED_ONLY_NOT_SETTLED');
assert.equal(result.audit.settled,false);
assert.equal(signerCalls,1);
await assert.rejects(good.authorizeAndSign(quote()),/QUOTE_ALREADY_SEEN/);
const disabled=new SecretlessSignerBoundary(baseline());
assert.equal(disabled.readiness.externalSignerAttached,false);
await assert.rejects(disabled.authorizeAndSign(quote('absent')),/SIGNER_NOT_CONNECTED/);
const neverApproved=new SecretlessSignerBoundary({...config(),approve:async()=>false});
await assert.rejects(neverApproved.authorizeAndSign(quote('denied')),/APPROVAL_REQUIRED/);
assert.equal(signerCalls,1);
const bad=[
 {...quote('inject'),approved:true},
 {...quote('actor'),actor:'untrusted'},
 {...quote('host'),resourceUrl:'https://merchant.example.attacker.test/'},
 {...quote('http'),resourceUrl:'http://merchant.example/'},
 {...quote('local'),resourceUrl:'https://merchant.internal/'},
 {...quote('network'),network:'stellar:pubnet'},
 {...quote('payee'),payTo:'GINTRUDER'},
 {...quote('cap'),amount:'1000001'},
 {...quote('fraction'),amount:'1.5'},
 {...quote('expired'),expiresAt:NOW-1},
 {...quote('long'),expiresAt:NOW+3600000},
 {...quote('method'),method:'POST'},
 {...quote('upto'),scheme:'upto'}
];
for(const badQuote of bad){
 const gateway=new SecretlessSignerBoundary(config());
 await assert.rejects(gateway.authorizeAndSign(badQuote));
}
assert.equal(signerCalls,1,'invalid input must never reach external signer');
const revoked=new SecretlessSignerBoundary(config());revoked.revoke();
await assert.rejects(revoked.authorizeAndSign(quote('revoke')),/CUSTODY_REVOKED/);
let release;
const concurrent=new SecretlessSignerBoundary({...config(),
 approve:()=>new Promise(resolve=>{release=resolve;})});
const pending=concurrent.authorizeAndSign(quote('same'));
await assert.rejects(concurrent.authorizeAndSign(quote('same')),/QUOTE_ALREADY_SEEN/);
release(true);await pending;
assert.equal(signerCalls,2);
let unblock;
const during=new SecretlessSignerBoundary({...config(),
 approve:()=>new Promise(resolve=>{unblock=resolve;})});
const inflight=during.authorizeAndSign(quote('revoke-inflight'));
during.revoke();unblock(true);
await assert.rejects(inflight,/CUSTODY_REVOKED/);
assert.equal(signerCalls,2,'post-approval revocation prevents signer entry');
const badEnvelope=new SecretlessSignerBoundary({...baseline(),
 sign:async q=>({...signed(q),privateKey:'not-to-export'})});
await assert.rejects(badEnvelope.authorizeAndSign(quote('leak')),/SIGNER_ENVELOPE_MISMATCH/);
const secretPayload=new SecretlessSignerBoundary({...baseline(),
 sign:async q=>({...signed(q),payload:{mnemonic:'bad-accidental-export'}})});
await assert.rejects(secretPayload.authorizeAndSign(quote('payload')),/SIGNER_ENVELOPE_SECRET_FIELD/);
const wrongTerms=new SecretlessSignerBoundary({...baseline(),
 sign:async q=>({...signed(q),accepted:{...signed(q).accepted,payTo:'OTHER'}})});
await assert.rejects(wrongTerms.authorizeAndSign(quote('wrong')),/SIGNER_ENVELOPE_MISMATCH/);
const noMore=new SecretlessSignerBoundary({...config(),maxEntries:1});
await noMore.authorizeAndSign(quote('first'));
await assert.rejects(noMore.authorizeAndSign(quote('second')),/IDEMPOTENCY_CAPACITY_EXHAUSTED/);
console.log('PASS SF19 fail-closed signer-custody policy: 29 checks; no network, wallet, keys or settlement');
