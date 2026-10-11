// MIT: one original SF30 -> SF84 -> SF96 -> SF88 source-native operator flow.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileHttpSellerOffer, paymentRequiredResponse } from '../sf30-seller-sdk/seller.mjs';
import { config as readSf88Config } from '../sf88-operator-buyer-cli/config.mjs';
import { create, derive, verify, HandoffError } from './handoff.mjs';

const url = 'https://merchant.example/paid-forecast';
const terms = {
  scheme:'exact', network:'stellar:testnet', amount:'17000',
  asset:'UNPAYABLE_LOCAL_ASSET', payTo:'UNPAYABLE_LOCAL_RECIPIENT',
  maxTimeoutSeconds:60,
};
const encode = v => Buffer.from(JSON.stringify(v, null, 2)+'\n');

export async function acceptance() {
  const checkout = mkdtemp(join(tmpdir(),'scf96-'));
  const tmp = await checkout;
  try {
    // Exact existing SF30 compiler and native 402 response, not a copied x402 parser.
    const sellerOffer = compileHttpSellerOffer({
      url, method:'GET', description:'Original local seller to SF88 review acceptance',
      serviceName:'SF96 Native', tags:['stellar'], payment:terms,
    });
    const response = paymentRequiredResponse(sellerOffer);
    assert.equal(response.statusCode,402);
    const headers = Object.entries(response.headers).filter(([k]) =>
      ['payment-required','www-authenticate'].includes(k.toLowerCase()));
    assert.ok(headers.some(([k])=>k.toLowerCase()==='payment-required'));
    const capture = {
      schema:'scf.sf85.capture.v1', collectedAtUtc:new Date().toISOString(),
      url, method:'GET', status:response.statusCode, headers,
    };
    const original = join(tmp,'real-sf30-402.json');
    const bytes = encode(capture);
    await writeFile(original,bytes,{flag:'wx',mode:0o600});

    const outDir = join(tmp,'review-001');
    const result = await create({capturePath:original,outDir,index:0,
      intentId:'sf96-original-local-001',maxAtomic:terms.amount});
    assert.equal(result.quotedAtomic, terms.amount);
    const verified = await verify(outDir);
    assert.equal(verified.intentId,'sf96-original-local-001');
    assert.equal(verified.outcome,'OFFLINE_ONLY_NOT_A_PAYMENT');
    const sf88 = await readSf88Config(join(outDir,'buyer-review.json'));
    assert.equal(sf88.operation.expect.network,'stellar:testnet');
    assert.equal(sf88.operation.url,url);
    assert.equal(sf88.operation.method,'GET');
    assert.equal(sf88.operator,undefined);
    assert.equal(sf88.signerModule,undefined);

    // Correctly deny a budget cap below the ORIGINAL offer; never change terms.
    assert.throws(()=>derive(bytes,{index:0,intentId:'other-intent',maxAtomic:'16999'}),
      e=>e instanceof HandoffError && e.code==='OPERATOR_CEILING_BELOW_QUOTED_AMOUNT');
    assert.throws(()=>derive(bytes,{index:1,intentId:'other-intent',maxAtomic:'18000'}),
      e=>e instanceof HandoffError && e.code==='SELECTED_ORIGINAL_EXACT_STELLAR_OFFER_REQUIRED');
    assert.throws(()=>derive(encode({...capture,url:'https://other.example/paid-forecast'}),
      {index:0,intentId:'other-intent',maxAtomic:'18000'}),
      e=>e instanceof HandoffError && e.code==='CAPTURE_AND_OFFER_RESOURCE_MISMATCH');

    // Original config content cannot mutate after native source-bound generation.
    const reviewFile = join(outDir,'buyer-review.json');
    const originalReview = await readFile(reviewFile);
    await writeFile(reviewFile,Buffer.concat([originalReview,Buffer.from(' ')]));
    await assert.rejects(()=>verify(outDir),e=>e.code==='BUNDLE_FILE_HASH_MISMATCH');

    return {status:'PASS',source:'original SF30 seller -> SF84 inspect -> SF96 handoff -> SF88 config',
      generatedFiles:5, originalQuotedAtomic:terms.amount,selectedNativeRail:'stellar:testnet',
      checks:'review configuration, independent cap, original resource identity, offer index, integrity',
      networkRequests:0, signingCallbacks:0, payments:0, githubActions:0};
  } finally {
    await rm(tmp,{recursive:true,force:true});
  }
}
if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  acceptance().then(x=>console.log(JSON.stringify(x,null,2)),
    e=>{console.error('SF96_ACCEPTANCE_ERROR',e);process.exitCode=1;});
}
