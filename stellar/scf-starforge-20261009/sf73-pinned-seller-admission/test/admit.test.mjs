// One focused original-implementation acceptance: unchanged SF50 and SF60 imports.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableCatalogTransaction } from '../../sf60-durable-catalog-transaction/journal.mjs';
import { createChallenge, signProof } from '../../sf50-seller-proof/proof.mjs';
import { admitPinnedSeller } from '../admit.mjs';

const offer = () => ({
  x402Version: 2, type: 'http',
  resource: { url:'https://seller.example/weather', serviceName:'Forecast', description:'Read forecast' },
  accepts: [
    {scheme:'exact',network:'stellar:testnet',asset:'USDC:TEST',payTo:'GSELLERA',amount:'20000'},
    {scheme:'exact',network:'stellar:testnet',asset:'USDC:TEST',payTo:'GSELLERB',amount:'30000'}
  ],
  extensions: { bazaar: {
    info: { input: {type:'http',method:'GET',description:'One read'},
      output: {type:'json',example:{forecast:'clear'}} },
    schema: {type:'object',properties:{forecast:{type:'string'}}}
  }}
});
test('original SF50 all-accept proofs atomically commit to native SF60; tamper, missing proof and restart', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const signer = publicKey.export({format:'der',type:'spki'}).toString('base64url');
  const original = offer();
  const sourceBytes = Buffer.from(JSON.stringify(original));
  const now = Date.now();
  const observedAt = new Date(now).toISOString();
  const authority = {
    sellerId:'seller-1', signer,
    allowedOrigins:new Set(['https://seller.example']),
    allowedRecipients:new Set(['GSELLERA','GSELLERB']),
    allowedNetworks:new Set(['stellar:testnet']),
    allowedSchemes:new Set(['exact'])
  };
  const proofs = original.accepts.map((_,i) => {
    const nonce = createChallenge();
    return { nonce, proof: signProof(original,{nonce,privateKeyPem:privateKey,now,selectedAccept:i}) };
  });
  const options = {
    sourceBytes, sourceURL:'https://seller.example/offers/export',
    observedAt, sellerId:'seller-1', sequence:1, authority,
    pinnedPublicKey:publicKey, proofs, now:now+1000
  };
  const dir = await mkdtemp(join(tmpdir(),'sf73-'));
  let writer;
  try {
    writer = await DurableCatalogTransaction.open(dir);
    const first = await admitPinnedSeller({...options,journal:writer});
    assert.equal(first.decision,'accepted');
    assert.equal(first.verifiedPaymentOptions,2);
    assert.equal(first.paymentCalls,0);
    assert.equal(writer.list().resources.length,1);
    const committedHead = writer.head;
    const altered = offer(); altered.accepts[1].amount = '30001';
    await assert.rejects(
      () => admitPinnedSeller({...options,journal:writer,sourceBytes:Buffer.from(JSON.stringify(altered))}),
      /differs from original resource and quote/);
    await assert.rejects(
      () => admitPinnedSeller({...options,journal:writer,proofs:proofs.slice(0,1)}),
      /ONE_ORIGINAL_PROOF_PER_PAYMENT_OPTION_REQUIRED/);
    await assert.rejects(
      () => admitPinnedSeller({...options,journal:writer,authority:{...authority,signer:'impostor'}}),
      /INDEPENDENT_OPERATOR_AUTHORITY_REQUIRED/);
    assert.equal(writer.head,committedHead);
    assert.equal(writer.count,1);
    assert.equal((await admitPinnedSeller({...options,journal:writer})).decision,'soft_drop');
    await writer.close();writer=null;
    writer=await DurableCatalogTransaction.open(dir);
    assert.equal(writer.count,1);
    assert.equal(writer.list().resources.length,1);
    assert.deepEqual(writer.list().resources[0].accepts,original.accepts);
  } finally {
    if(writer) await writer.close();
    await rm(dir,{recursive:true,force:true});
  }
});
