// Focused changed-path checks using EXACT checked-in canonical x402 Bazaar resource example.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateKeyPairSync} from 'node:crypto';
import {createChallenge,signProof,verifyPinnedProof,statementFor} from '../proof.mjs';
const fixture=JSON.parse(readFileSync(new URL('./official-bazaar-resource.json',import.meta.url)));
const keys=generateKeyPairSync('ed25519');
const second=generateKeyPairSync('ed25519');
const nonce=createChallenge();
const now=Date.UTC(2026,9,10,4,35,0);
const proof=()=>signProof(fixture,{nonce,privateKeyPem:keys.privateKey,now});
const verify=(entry,p=proof(),opts={})=>verifyPinnedProof(entry,p,{nonce,pinnedPublicKey:keys.publicKey,now:now+5000,...opts});
const copy=()=>structuredClone(fixture);

test('canonical x402 Foundation resource: fresh challenge, Ed25519 signature, pinned-key verification',()=>{
  assert.equal(Buffer.from(nonce,'base64url').length,32);
  const p=proof(); const result=verify(fixture,p);
  assert.equal(result.verified,true);assert.equal(result.origin,'https://api.example.com');
  assert.equal(result.quote.amount,'200');assert.equal(result.identity.method,'GET');
  assert.deepEqual(p.statement,statementFor(fixture,{nonce,issuedAt:now,expiresAt:now+30000}));
});
test('tampered x402 payment terms cannot inherit seller proof',()=>{
  for(const [key,value] of [['amount','201'],['payTo','0xChanged'],['asset','0xChanged'],['network','stellar:testnet'],['scheme','upto']]){
    const e=copy();e.accepts[0][key]=value;
    assert.throws(()=>verify(e),/differs from original resource and quote/);
  }
});
test('canonical HTTP resource/method and MCP URL+toolName are signed',()=>{
  const e=copy();e.resource='https://api.example.com/x402/other';assert.throws(()=>verify(e));
  e.resource=fixture.resource;e.extensions.bazaar.info.input.method='POST';assert.throws(()=>verify(e));
  const m=copy();m.resource='https://seller.example.net/mcp';m.extensions.bazaar.info.input={type:'mcp',toolName:'weather',inputSchema:{type:'object'}};
  const p=signProof(m,{nonce,privateKeyPem:keys.privateKey,now});
  assert.equal(verify(m,p).identity.toolName,'weather');
  m.extensions.bazaar.info.input.toolName='stocks';assert.throws(()=>verify(m,p));
});
test('refuse nonce replay/mismatch, expired/future, overlong life',()=>{
  assert.throws(()=>verify(fixture,proof(),{nonce:createChallenge()}));
  assert.throws(()=>verify(fixture,proof(),{now:now+40000}),/expired/);
  assert.throws(()=>verify(fixture,proof(),{now:now-10000}),/issued in future/);
  assert.throws(()=>signProof(fixture,{nonce,privateKeyPem:keys.privateKey,now,lifetimeMs:121000}));
});
test('refuse unpinned or impostor key and signature substitutions',()=>{
  assert.throws(()=>verifyPinnedProof(fixture,proof(),{nonce,now}),/independent key pin/);
  assert.throws(()=>verify(fixture,proof(),{pinnedPublicKey:second.publicKey}),/differs from independent pin/);
  const p=proof();p.signature=signProof(fixture,{nonce,privateKeyPem:second.privateKey,now}).signature;
  assert.throws(()=>verify(fixture,p),/Invalid seller proof signature/);
});
test('strict canonical inputs: no float/implicit conversion, non-HTTPS or malformed metadata',()=>{
  const e=copy();e.accepts[0].amount=0.002;assert.throws(()=>signProof(e,{nonce,privateKeyPem:keys.privateKey,now}));
  e.accepts[0].amount='200';e.resource='http://api.example.com/x402/weather';assert.throws(()=>signProof(e,{nonce,privateKeyPem:keys.privateKey,now}));
  e.resource=fixture.resource;delete e.extensions.bazaar.info.input.type;assert.throws(()=>signProof(e,{nonce,privateKeyPem:keys.privateKey,now}));
});
