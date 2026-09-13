import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPublicOffer, formatHbarFromTinybar } from '../src/offer-surface.mjs';
import { normalizePublicConfig } from '../src/config-contract.mjs';

test('tinybar formatting is exact without floating-point rounding', () => {
  assert.equal(formatHbarFromTinybar('1'), '0.00000001');
  assert.equal(formatHbarFromTinybar('10'), '0.0000001');
  assert.equal(formatHbarFromTinybar('100000000'), '1');
  assert.equal(formatHbarFromTinybar('123456789'), '1.23456789');
  assert.equal(formatHbarFromTinybar('900719925474099312345'), '9007199254740.99312345');
});

test('public offer binds HBAR testnet price and denies authority', () => {
  const out = buildPublicOffer({ serviceId:'agent-revenue-report', amountTinybar:'1000000', description:'One report' });
  assert.equal(out.amountTinybar,'1000000'); assert.equal(out.amountHbar, '0.01'); assert.equal(out.network, 'hedera:testnet'); assert.equal(out.asset, '0.0.0');
  assert.equal(out.paymentAuthority, false); assert.equal(out.settlementAuthority, false); assert.match(out.offerDigest, /^[0-9a-f]{64}$/);
});

test('noncanonical price string is rejected rather than normalized ambiguously', () => {
  assert.throws(() => buildPublicOffer({ serviceId:'agent-revenue-report', amountTinybar:'0001' }), /canonical/);
  assert.throws(() => buildPublicOffer({ serviceId:'agent-revenue-report', amountTinybar:Number.MAX_SAFE_INTEGER + 1 }), /safe integer/);
});

test('public config is deterministic and secret-free', () => {
  const input = { reportServiceBaseUrl:'https://rail.example.test/', graphNetwork:'base', providerAgentId:'8453:123', serviceId:'agent-revenue-report', amountTinybar:'1000000', graphEndpointLabel:'agent0-live' };
  assert.deepEqual(normalizePublicConfig(input), normalizePublicConfig(input)); assert.equal(normalizePublicConfig(input).reportServiceBaseUrl, 'https://rail.example.test');
});

test('public config rejects embedded secret-shaped material', () => {
  const input = { reportServiceBaseUrl:'https://rail.example.test', graphNetwork:'base', providerAgentId:'8453:123', serviceId:'agent-revenue-report', amountTinybar:'1000000', graphEndpointLabel:['api','key=supersecretvalue'].join('_') };
  assert.throws(() => normalizePublicConfig(input), /secret-shaped/);
});

test('public config rejects credential-bearing URLs and plaintext transport', () => {
  const base = { graphNetwork:'base', providerAgentId:'8453:123', serviceId:'agent-revenue-report', amountTinybar:'1000000' };
  assert.throws(() => normalizePublicConfig({ ...base, reportServiceBaseUrl:'http://rail.example.test' }), /https/);
  assert.throws(() => normalizePublicConfig({ ...base, reportServiceBaseUrl:'https://user:pass@rail.example.test' }), /credentials/);
});
