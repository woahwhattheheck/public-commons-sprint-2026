// MIT. One native-SDK / original-seller journey; no RPC calls or funded accounts.
import assert from 'node:assert/strict';
import { Keypair } from '@stellar/stellar-sdk';
import { USDC_TESTNET_ADDRESS } from '@x402/stellar';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { reviewConfig } from './config.mjs';
import { createNativeFacilitator, startSelfFacilitatedSeller } from './runtime.mjs';
import { startFacilitatorServer } from './server.mjs';

// Publicly reproducible, unfunded fixture identities. Never use as real accounts.
const fee = Keypair.fromRawEd25519Seed(Buffer.alloc(32,17));
const merchant = Keypair.fromRawEd25519Seed(Buffer.alloc(32,23));
const config = {schema:'stellar-forge.native-facilitator.v1',network:'stellar:testnet',
  rpcUrl:'https://soroban-testnet.stellar.org',
  signers:[{address:fee.publicKey(),secretEnv:'NATIVE_ACCEPTANCE_FIXTURE_ONLY'}],
  payments:{assets:[USDC_TESTNET_ADDRESS],recipients:[merchant.publicKey()],maxAtomic:'10000'},
  limits:{maxTransactionFeeStroops:50000,drainGraceMs:1000}};
const environment = {NATIVE_ACCEPTANCE_FIXTURE_ONLY:fee.secret()};
assert.equal(reviewConfig(config).signingMaterialLoaded,false);
await assert.rejects(createNativeFacilitator(config,{environment:{}}),{code:'SIGNER_ENV_UNAVAILABLE'});
const facilitator = await createNativeFacilitator(config,{environment});
let transport, seller;
try {
  const supported = await facilitator.getSupported();
  assert(supported.kinds.some(k => k.x402Version === 2 && k.scheme === 'exact' &&
    k.network === 'stellar:testnet' && k.extra.areFeesSponsored === true));
  assert(supported.signers['stellar:*'].includes(fee.publicKey()));
  transport = await startFacilitatorServer({facilitator,port:0});
  // The actual official HTTP client must consume our untouched native protocol.
  const client = new HTTPFacilitatorClient({url:transport.url});
  assert.deepEqual(await client.getSupported(),supported);
  const requirements = {scheme:'exact',network:config.network,asset:USDC_TESTNET_ADDRESS,
    payTo:merchant.publicKey(),amount:'10000',maxTimeoutSeconds:60,extra:{areFeesSponsored:true}};
  // Missing transaction is refused by the SDK before any network or signing call.
  const payload = {x402Version:2,accepted:requirements,payload:{}};
  const verification = await client.verify(payload,requirements);
  assert.equal(verification.isValid,false);
  assert.equal(verification.invalidReason,'invalid_exact_stellar_payload_malformed');
  const settlement = await client.settle(payload,requirements);
  assert.equal(settlement.success,false);
  assert.equal(settlement.transaction,'');
  const rejected = {...requirements,amount:'10001'};
  const denied = await fetch(transport.url+'/verify',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({paymentPayload:{...payload,accepted:rejected},paymentRequirements:rejected})});
  assert.equal(denied.status,400);
  assert.equal((await denied.json()).error,'PAYMENT_AMOUNT_DENIED');
  assert.equal((await fetch(transport.url+'/supported',{headers:{Origin:'https://other.example'}})).status,403);
  assert.deepEqual(facilitator.status().counters,{verifyCalls:1,settleCalls:1,verifyRefusals:1,
    settlementRefusals:1,nativeErrors:0});
  assert.equal((await transport.close()).drained,true); transport = null;

  const service = {schema:'stellar-forge.seller-service.v1',routes:[{id:'dataset',path:'/dataset',
    definition:{method:'GET',description:'Native self-facilitated dataset',
      payment:{scheme:'exact',network:config.network,asset:USDC_TESTNET_ADDRESS,
        payTo:merchant.publicKey(),amount:'10000',maxTimeoutSeconds:60}},
    response:{dataset:'native-facilitator-acceptance',rows:[{value:7}]}}]};
  seller = await startSelfFacilitatedSeller({facilitatorConfig:config,config:service,environment});
  assert.equal(seller.mode,'NATIVE_X402');
  assert.equal(seller.lifecycle.snapshot().maxInFlight,1);
  const challenge = await fetch(seller.url+'/dataset');
  assert.equal(challenge.status,402);
  // Native v2 carries the quote in PAYMENT-REQUIRED; its body is an error object.
  const offer = JSON.parse(Buffer.from(challenge.headers.get('payment-required'),'base64').toString('utf8'));
  await challenge.arrayBuffer();
  assert.equal(offer.x402Version,2);
  assert.equal(offer.accepts[0].extra.areFeesSponsored,true);
  assert.equal(offer.accepts[0].asset,USDC_TESTNET_ADDRESS);
  assert.equal(offer.accepts[0].payTo,merchant.publicKey());
  assert.equal(seller.facilitator.status().counters.settleCalls,0);
  assert.equal((await seller.close()).drained,true); seller = null;
  const wrongMerchant = structuredClone(service);
  wrongMerchant.routes[0].definition.payment.payTo=fee.publicKey();
  await assert.rejects(startSelfFacilitatedSeller({facilitatorConfig:config,config:wrongMerchant,environment}),
    {code:'SELLER_TERMS_OUTSIDE_FACILITATOR_POLICY'});
  process.stdout.write(JSON.stringify({result:'PASS',sdk:'@x402/stellar@2.28.0',
    nativeSupported:true,officialHttpClient:true,nativeVerifyRefusal:verification.invalidReason,
    nativeSettleRefusal:settlement.errorReason,originalSellerMode:'NATIVE_X402',
    originalSellerHttp:402,merchantPolicyBound:true,settlementConcurrency:1,
    fundedAccounts:false,rpcCalls:0,chainTransactions:0})+'\n');
} finally {
  if(seller) await seller.close();
  if(transport) await transport.close();
  await facilitator.drain();
}
