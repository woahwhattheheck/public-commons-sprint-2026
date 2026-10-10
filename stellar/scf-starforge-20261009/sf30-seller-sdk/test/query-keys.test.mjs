import test from 'node:test';
import assert from 'node:assert/strict';
import { compileHttpSellerOffer, paymentRequiredResponse } from '../seller.mjs';

const param = (name, value = 'x') => ({
  name, type: 'string', description: 'Example query parameter', example: value, required: true,
});
const compile = queryParameters => compileHttpSellerOffer({
  url: 'https://seller.example/weather', method: 'GET',
  description: 'Small public weather response', queryParameters,
  payment: {
    network: 'stellar:testnet', scheme: 'exact', amount: '10000',
    asset: 'C_REPLACE_WITH_REAL_SEP41', payTo: 'G_REPLACE_WITH_REAL_ACCOUNT',
    maxTimeoutSeconds: 60,
  },
});

test('reject reserved prototype-affecting query keys instead of silently dropping them', () => {
  const originalProto = Object.getPrototypeOf({});
  for (const name of ['__proto__', 'prototype', 'constructor']) {
    assert.throws(() => compile([param(name)]), /Parameter name invalid or repeated/, name);
  }
  assert.equal(Object.getPrototypeOf({}), originalProto);
  assert.equal(Object.prototype.polluted, undefined);
});

test('roundtrip ordinary inherited names as own serialized Bazaar metadata keys', () => {
  const names = ['toString', 'hasOwnProperty', 'valueOf'];
  const offer = compile(names.map((name, i) => param(name, 'value' + i)));
  const wire = JSON.parse(paymentRequiredResponse(offer).body);
  const query = wire.extensions.bazaar.info.input.queryParams;
  const defs = wire.extensions.bazaar.schema.properties.input.properties.queryParams;
  assert.deepEqual(Object.keys(query), names);
  assert.deepEqual(Object.keys(defs.properties), names);
  assert.deepEqual(defs.required, names);
  for (const [i, name] of names.entries()) {
    assert.equal(Object.hasOwn(query, name), true);
    assert.equal(Object.hasOwn(defs.properties, name), true);
    assert.equal(query[name], 'value' + i);
    assert.equal(defs.properties[name].type, 'string');
  }
  assert.throws(() => compile([param('toString'), param('toString', 'duplicate')]),
    /Parameter name invalid or repeated/);
});
