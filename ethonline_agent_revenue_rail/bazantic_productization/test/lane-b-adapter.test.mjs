import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256Hex } from '../src/canonical.mjs';
import { adaptLaneBReceipt } from '../src/lane-b-adapter.mjs';
import { evaluateRecipeFlow } from '../src/recipe-contract.mjs';

function receipt(decision='BUY', overrides={}) {
  const core={
    schema:'graph-purchase-decision/v1', decision, reasons:[decision==='BUY'?'POLICY_SATISFIED':'PRICE_ABOVE_MAX'],
    offerId:'offer-1', sellerAgentId:'8453:77', serviceKey:'agent-revenue-report', serviceUrl:'https://rail.example.test/report', currency:'TINYBAR', priceAtomic:'900719925474099312345',
    budgetBeforeAtomic:'900719925474099399999', budgetAfterAtomic:decision==='BUY'?'87654':'900719925474099399999',
    offerDigest:'1'.repeat(64), policyDigest:'2'.repeat(64), evidenceDigest:'3'.repeat(64),
    metrics:{feedbackCount:3,averageFeedbackScore:'95.00',paidFeedbackCount:2,completedValidationCount:1,averageCompletedValidationScore:'90.00',supportedTrustModels:['reputation'],serviceOrigin:'https://rail.example.test',matchedEndpointKinds:['web'],graphBlockNumber:'123',graphBlockTimestamp:'1789292390'},
    qualification:{evidenceTransport:'live_graph',declaredSourceMode:'live_graph',liveGraphEvidence:true,fixtureOnly:false,prizeEligibilityClaimed:false},
    authority:{payment:false,walletWrite:false,providerMutation:false,submission:false},
    ...overrides,
  };
  return {...core,receiptDigest:sha256Hex(core)};
}
const now='2026-09-13T09:41:00.000Z';

test('Lane B BUY receipt maps to C BUY with exact large atomic price',()=>{
  const out=adaptLaneBReceipt(receipt('BUY'),{now});
  assert.equal(out.decision,'BUY'); assert.equal(out.priceAtomic,'900719925474099312345'); assert.equal(out.agentId,'8453:77'); assert.equal(out.serviceUrl,'https://rail.example.test/report');
});
test('Lane B SKIP maps to refusal/no payment path',()=>{assert.equal(adaptLaneBReceipt(receipt('SKIP'),{now}).decision,'REFUSE');});
test('Lane B HOLD maps to defer/no payment path',()=>{assert.equal(adaptLaneBReceipt(receipt('HOLD'),{now}).decision,'DEFER');});
test('receipt digest tampering rejected',()=>{const r=receipt();r.priceAtomic='1';assert.throws(()=>adaptLaneBReceipt(r,{now}),/receiptDigest mismatch/);});
test('any payment authority in Lane B receipt rejected',()=>{const r=receipt('BUY',{authority:{payment:true,walletWrite:false,providerMutation:false,submission:false}});assert.throws(()=>adaptLaneBReceipt(r,{now}),/must be false/);});
test('fixture-only B receipt cannot become BUY in C',()=>{const r=receipt('BUY',{qualification:{evidenceTransport:'fixture',declaredSourceMode:'fixture',liveGraphEvidence:false,fixtureOnly:true,prizeEligibilityClaimed:false},metrics:null});const out=adaptLaneBReceipt(r,{now});assert.equal(out.decision,'DEFER');});
test('forged live flag cannot outrun evidence transport provenance',()=>{const r=receipt('BUY',{qualification:{evidenceTransport:'fixture',declaredSourceMode:'live_graph',liveGraphEvidence:true,fixtureOnly:true,prizeEligibilityClaimed:false}});assert.throws(()=>adaptLaneBReceipt(r,{now}),/live provenance is inconsistent/);});
test('B offer atomic price must equal A purchase amount',()=>{const r=receipt();const input={now,laneBReceipt:r,purchase:{state:'PAYMENT_REQUIRED',httpStatus:402,network:'hedera:testnet',asset:'0.0.0',serviceUrl:'https://rail.example.test/report',amountTinybar:'1',upstreamVerified:false}};assert.throws(()=>evaluateRecipeFlow(input),/does not match/);});
test('matching huge string atomic price crosses C without Number precision loss',()=>{const r=receipt();const out=evaluateRecipeFlow({now,laneBReceipt:r,purchase:{state:'PAYMENT_REQUIRED',httpStatus:402,network:'hedera:testnet',asset:'0.0.0',serviceUrl:'https://rail.example.test/report',amountTinybar:'900719925474099312345',upstreamVerified:false}});assert.equal(out.state,'PAYMENT_REQUIRED');});
test('Lane A purchase must carry the exact Lane B bound service URL',()=>{const r=receipt();const input={now,laneBReceipt:r,purchase:{state:'PAYMENT_REQUIRED',httpStatus:402,network:'hedera:testnet',asset:'0.0.0',serviceUrl:'https://other.example.test/report',amountTinybar:'900719925474099312345',upstreamVerified:false}};assert.throws(()=>evaluateRecipeFlow(input),/does not match Lane B serviceUrl/);});
test('Lane A purchase cannot omit the Lane B bound service URL',()=>{const r=receipt();const input={now,laneBReceipt:r,purchase:{state:'PAYMENT_REQUIRED',httpStatus:402,network:'hedera:testnet',asset:'0.0.0',amountTinybar:'900719925474099312345',upstreamVerified:false}};assert.throws(()=>evaluateRecipeFlow(input),/serviceUrl is required/);});
test('Lane B metric service origin must stay bound to receipt service URL',()=>{const r=receipt('BUY',{metrics:{feedbackCount:3,averageFeedbackScore:'95.00',paidFeedbackCount:2,completedValidationCount:1,averageCompletedValidationScore:'90.00',supportedTrustModels:['reputation'],serviceOrigin:'https://wrong.example.test',matchedEndpointKinds:['web'],graphBlockNumber:'123',graphBlockTimestamp:'1789292390'}});assert.throws(()=>adaptLaneBReceipt(r,{now}),/serviceOrigin does not match serviceUrl/);});
test('stale live B Graph block becomes POLICY_EXPIRED before any purchase',()=>{
  const r=receipt('BUY'); r.metrics.graphBlockTimestamp='1789292000'; const {receiptDigest,...core}=r; r.receiptDigest=sha256Hex(core);
  const out=evaluateRecipeFlow({now,laneBReceipt:r}); assert.equal(out.state,'POLICY_EXPIRED'); assert.equal(out.canUseReport,false);
});
test('future live B Graph block is rejected',()=>{
  const r=receipt('BUY'); r.metrics.graphBlockTimestamp='1789293000'; const {receiptDigest,...core}=r; r.receiptDigest=sha256Hex(core);
  assert.throws(()=>adaptLaneBReceipt(r,{now}),/future/);
});
