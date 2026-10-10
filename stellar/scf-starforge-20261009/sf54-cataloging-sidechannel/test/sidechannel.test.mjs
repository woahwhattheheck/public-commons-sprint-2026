import test from 'node:test';
import assert from 'node:assert/strict';
import { BazaarSettlementSidechannel, encodeCatalogSidechannel } from '../sidechannel.mjs';
// Runs original accepted SF25->SF46->SF27->SF21 source; no wallet or chain calls.
function payload() { return {
  x402Version: 2,
  resource: { url: 'https://seller.example/weather', description: 'Weather report' },
  accepted: { scheme:'exact',network:'stellar:testnet',payTo:'GSELLER',
    asset:'USDC:TEST',amount:'20000',maxTimeoutSeconds:60,extra:{} },
  payload: {transaction:'fixture-not-real-transaction'},
  extensions: { bazaar: {info:{input:{type:'http',method:'GET'}},
    schema: {$schema:'https://json-schema.org/draft/2020-12/schema',
      type:'object',properties:{input:{type:'object',
        properties:{type:{const:'http'},method:{enum:['GET']}},
        required:['type','method'],additionalProperties:false}},
      required:['input'],additionalProperties:false}} }
}; }
function settlement(overrides={}) { return {
  status:'settled',sellerId:'owner-seller',signer:'GAUTHENTICATED',
  origin:'https://seller.example',network:'stellar:testnet',scheme:'exact',
  payTo:'GSELLER',asset:'USDC:TEST',amount:'20000',
  receiptURL:'https://facilitator.example/receipt/fixture',
  receiptSha256:'b'.repeat(64), observedAt:'2026-10-10T09:00:00Z',...overrides,
}; }
const decode = result => result.headerValue ?
  JSON.parse(Buffer.from(result.headerValue,'base64').toString('utf8')):null;
test('original SF25 catalogs and emits spec-exact successful wire sidechannel',()=>{
  const side=new BazaarSettlementSidechannel();
  const out=side.processSettled({paymentPayload:payload(),settlement:settlement(),sequence:1});
  assert.equal(out.catalogDecision.decision,'accepted');
  assert.equal(out.headerName,'EXTENSION-RESPONSES');
  assert.deepEqual(decode(out),{bazaar:{status:'success'}});
  assert.equal(side.size,1);
  assert.equal(side.list().resources[0].resource.url,'https://seller.example/weather');
});
test('exact replay is success, never a second catalog generation',()=>{
  const side=new BazaarSettlementSidechannel();
  side.processSettled({paymentPayload:payload(),settlement:settlement(),sequence:1});
  const before=side.version;
  const out=side.processSettled({paymentPayload:payload(),settlement:settlement(),sequence:1});
  assert.equal(out.catalogDecision.reason,'EXACT_REPLAY');
  assert.deepEqual(decode(out),{bazaar:{status:'success'}});
  assert.equal(side.version,before);
});
test('invalid schema and mismatched settlement get rejected, never cataloged',()=>{
  const side=new BazaarSettlementSidechannel();
  const bad=payload();bad.extensions.bazaar.info.input.method='POST';
  const first=side.processSettled({paymentPayload:bad,settlement:settlement(),sequence:1});
  assert.equal(first.catalogDecision.reason,'INFO_SCHEMA_MISMATCH');
  assert.deepEqual(decode(first),{bazaar:{status:'rejected',rejectedReason:'INFO_SCHEMA_MISMATCH'}});
  const second=side.processSettled({paymentPayload:payload(),
    settlement:settlement({payTo:'GNOTSELLER'}),sequence:2});
  assert.equal(second.catalogDecision.reason,'SETTLEMENT_PAYTO_MISMATCH');
  assert.deepEqual(decode(second),{bazaar:{status:'rejected',rejectedReason:'SETTLEMENT_PAYTO_MISMATCH'}});
  assert.equal(side.size,0);
});
test('missing bazaar omits the header, preserving other authorized extension keys',()=>{
  const side=new BazaarSettlementSidechannel();
  const absent=payload();delete absent.extensions.bazaar;
  const first=side.processSettled({paymentPayload:absent,settlement:settlement(),sequence:1});
  assert.equal(first.catalogDecision.reason,'BAZAAR_EXTENSION_ABSENT');
  assert.equal(first.headerValue,null);
  const other=side.processSettled({paymentPayload:absent,settlement:settlement(),sequence:2,
    otherExtensionResponses:{paymentidentifier:{status:'processing'}}});
  assert.deepEqual(decode(other),{paymentidentifier:{status:'processing'}});
});
test('cannot override bazaar with preexisting data; rejects unknown result safely',()=>{
  assert.throws(()=>encodeCatalogSidechannel({paymentPayload:payload(),
    catalogDecision:{decision:'accepted'},
    otherExtensionResponses:{bazaar:{status:'success'}}}),/OTHER_EXTENSION_KEY_INVALID/);
  const out=encodeCatalogSidechannel({paymentPayload:payload(),
    catalogDecision:{decision:'unknown',reason:'account secret\nstack trace'}});
  assert.deepEqual(decode(out),{bazaar:{status:'rejected',rejectedReason:'CATALOGING_REJECTED'}});
});


test('sibling collision, cycle and near-cap wire failure occur before settled catalog mutation', () => {
  const side = new BazaarSettlementSidechannel();
  const params = { paymentPayload: payload(), settlement: settlement(), sequence: 1 };
  const before = side.version;
  assert.throws(() => side.processSettled({
    ...params, otherExtensionResponses: { bazaar: { status: 'success' } },
  }), /OTHER_EXTENSION_KEY_INVALID/);
  assert.equal(side.size, 0);
  assert.equal(side.version, before);

  const cyclic = {}; cyclic.self = cyclic;
  assert.throws(() => side.processSettled({
    ...params, otherExtensionResponses: { paymentidentifier: cyclic },
  }), /OTHER_EXTENSION_OUTCOMES_NOT_JSON/);
  assert.equal(side.size, 0);
  assert.equal(side.version, before);

  // Sibling JSON alone is below 16,384 bytes. Adding the worst possible
  // Bazaar rejection extension would make the final HTTP header too large.
  const nearLimit = { paymentidentifier: { note: 'x'.repeat(16_260) } };
  assert.ok(Buffer.byteLength(JSON.stringify(nearLimit), 'utf8') < 16_384);
  assert.throws(() => side.processSettled({
    ...params, otherExtensionResponses: nearLimit,
  }), /EXTENSION_RESPONSES_TOO_LARGE/);
  assert.equal(side.size, 0);
  assert.equal(side.version, before);

  const accepted = side.processSettled(params);
  assert.equal(accepted.catalogDecision.decision, 'accepted');
  assert.deepEqual(decode(accepted), { bazaar: { status: 'success' } });
  assert.equal(side.size, 1);
  assert.equal(side.version, before + 1);
});
