import test from 'node:test';
import assert from 'node:assert/strict';
import { createSellerDiscovery, makePaymentRequiredResponse } from '../index.mjs';

const MAX_I128 = '170141183460469231731687303715884105727';
const ABOVE_MAX = '170141183460469231731687303715884105728';
const bigDecimal = '9'.repeat(1000);
const fixture = (amount, scheme = 'exact') => createSellerDiscovery({
  resource: { url: 'https://merchant.example/service', description: 'Merchant service' },
  accepts: [{ scheme, network: 'stellar:testnet', asset: 'DEMO_ASSET_UNSET',
    amount, payTo: 'DEMO_PAYTO_UNSET', maxTimeoutSeconds: 60 }],
  input: {type: 'http', method: 'GET', querySchema: {type:'object',
    properties: {city:{type:'string',example:'Louisville'}}, required:['city']}},
});

test('Soroban signed i128 max is serializable in canonical seller discovery metadata', () => {
  for (const scheme of ['exact', 'upto']) {
    const seller = fixture(MAX_I128, scheme);
    assert.equal(seller.accepts[0].amount, MAX_I128);
    assert.equal(seller.accepts[0].scheme, scheme);
    const headers = makePaymentRequiredResponse(seller).headers;
    const encoded = headers['PAYMENT-REQUIRED'];
    assert.equal(JSON.parse(Buffer.from(encoded, 'base64').toString()).accepts[0].amount, MAX_I128);
  }
});

test('reject max-plus-one, much larger atomics, and noncanonical decimals before advertising', () => {
  for (const scheme of ['exact', 'upto']) {
    for (const amount of [ABOVE_MAX, '999999999999999999999999999999999999999',
      bigDecimal]) {
      assert.throws(() => fixture(amount, scheme), /exceeds Stellar signed i128 maximum/,
        'scheme=' + scheme + ' amount=' + amount.slice(0, 42));
    }
    for (const amount of ['0', '-1', '+1', '01', '1.5']) {
      assert.throws(() => fixture(amount, scheme), /positive atomic-unit decimal string/);
    }
  }
});

test('ordinary small atomics still supported and previous local URL guard retained', () => {
  assert.equal(fixture('20000').accepts[0].amount, '20000');
  assert.throws(() => createSellerDiscovery({
    resource:{url:'https://127.0.0.1/pay'}, accepts:[{
      scheme:'exact',network:'stellar:testnet',asset:'DEMO_ASSET_UNSET',
      amount:'20000',payTo:'DEMO_PAYTO_UNSET',maxTimeoutSeconds:60}],
    input:{type:'http',method:'GET',querySchema:{type:'object',properties:{
      city:{type:'string',example:'Louisville'}},required:['city']}}
  }), /Private or local seller resource host/);
});
