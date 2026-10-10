import test from 'node:test';
import assert from 'node:assert/strict';
import { bindDiscoveryQuote, reviewPaymentRequired } from './quote-commitment.mjs';

const terms = { scheme: 'exact', network: 'stellar:testnet', asset: 'USDC',
  payTo: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
  amount: '2000', maxTimeoutSeconds: 60, extra: { name: 'USD Coin', version: '2' } };
const info = { type: 'http', method: 'GET' };
const listing = { resource: { url: 'https://seller.example/weather' },
  accepts: [terms], extensions: { bazaar: { info: { input: info }, schema: { type: 'object' } } } };
const invocation = { kind: 'http', resourceURL: 'https://seller.example/weather', method: 'GET' };
const challenge = { x402Version: 2, resource: { url: listing.resource.url }, accepts: [terms],
  extensions: { bazaar: { info: { input: info } } } };
const quote = () => bindDiscoveryQuote({ listing, observedAtMs: 1000, ttlMs: 60000 });
const review = (override = {}) => reviewPaymentRequired({ quote: quote(), paymentRequired: challenge, invocation,
  nowMs: 1001, ...override });

test('real Bazaar v2 record shape binds exact atomic quote and canonical-shape 402 preflight', () => {
  const q = quote();
  assert.match(q.quoteId, /^[a-f0-9]{64}$/);
  assert.equal(review().ok, true);
  const alternative = { ...terms, network: 'stellar:pubnet' };
  assert.equal(review({ paymentRequired: { ...challenge, accepts: [alternative, terms] } }).ok, true);
});

test('wrong actual method and source-discovered method never authorize', () => {
  assert.equal(review({ invocation: { ...invocation, method: 'POST' } }).reason, 'INVOCATION_METHOD_CHANGED');
  assert.equal(review({ paymentRequired: { ...challenge,
    extensions: { bazaar: { info: { input: { type: 'http', method: 'POST' } } } } } }).reason, 'CHALLENGE_METHOD_CHANGED');
});

test('destination, network, asset and price drift are distinct refusals', () => {
  for (const [key, value, expected] of [
    ['payTo', 'GDIFFERENT', 'RECIPIENT_CHANGED'],
    ['network', 'stellar:pubnet', 'PAYMENT_ROUTE_CHANGED'],
    ['asset', 'XLM', 'PAYMENT_ROUTE_CHANGED'],
    ['amount', '2001', 'AMOUNT_CHANGED'],
    ['extra', { name: 'Different' }, 'PAYMENT_TERMS_CHANGED']
  ]) {
    const altered = { ...terms, [key]: value };
    assert.equal(review({ paymentRequired: { ...challenge, accepts: [altered] } }).reason, expected, key);
  }
});

test('reject stale, mutated, malformed and wrong-resource offers without signing', () => {
  assert.equal(review({ nowMs: 61000 }).reason, 'QUOTE_EXPIRED');
  assert.equal(review({ quote: { ...quote(), terms: { ...terms, amount: '1' } } }).reason, 'QUOTE_CHANGED');
  assert.equal(review({ paymentRequired: { ...challenge, x402Version: 1 } }).reason, 'X402_V2_REQUIRED');
  assert.equal(review({ paymentRequired: { ...challenge, resource: { url: 'https://seller.example/other' } } }).reason, 'CHALLENGE_RESOURCE_CHANGED');
  assert.equal(review({ invocation: { ...invocation, resourceURL: 'https://other.example/weather' } }).reason, 'INVOCATION_RESOURCE_CHANGED');
});

test('MCP identity pins toolName independently of shared server resource URL', () => {
  const mcpListing = { ...listing, resource: { url: 'https://seller.example/mcp' },
    extensions: { bazaar: { info: { input: { type: 'mcp', toolName: 'forecast' } } } } };
  const q = bindDiscoveryQuote({ listing: mcpListing, observedAtMs: 1000 });
  const mcpChallenge = { ...challenge, resource: mcpListing.resource, extensions: mcpListing.extensions };
  const call = { kind: 'mcp', resourceURL: mcpListing.resource.url, toolName: 'forecast' };
  assert.equal(review({ quote: q, paymentRequired: mcpChallenge, invocation: call }).ok, true);
  assert.equal(review({ quote: q, paymentRequired: mcpChallenge, invocation: { ...call, toolName: 'calculate' } }).reason, 'INVOCATION_TOOL_CHANGED');
});

test('invalid amounts and uncataloged method are refused during quote creation', () => {
  assert.throws(() => bindDiscoveryQuote({ listing: { ...listing, accepts: [{ ...terms, amount: '2.5' }] } }), /Atomic amount/);
  assert.throws(() => bindDiscoveryQuote({ listing: { ...listing, extensions: { bazaar: { info: { input: { type: 'http', method: 'TRACE' } } } } } }), /identity/);
});

test('the signer receives only checked x402 fields, never injected 402 metadata', () => {
  const injected = { ...terms, signerOverride: { payTo: 'GATTACKER', amount: '1' },
    feeSponsor: 'another-wallet', witness: [1, 2, 3] };
  const reviewed = review({ paymentRequired: { ...challenge, accepts: [injected] } });
  assert.equal(reviewed.ok, true);
  assert.deepEqual(reviewed.accepted, terms);
  assert.equal(Object.hasOwn(reviewed.accepted, 'signerOverride'), false);

  const { maxTimeoutSeconds, extra, ...minimal } = terms;
  const minimalQuote = bindDiscoveryQuote({
    listing: { ...listing, accepts: [minimal] }, observedAtMs: 1000, ttlMs: 60000
  });
  const minimalChallenge = { ...challenge, accepts: [{ ...minimal, anotherUnknownField: 123 }] };
  const minimalReviewed = review({ quote: minimalQuote, paymentRequired: minimalChallenge });
  assert.equal(minimalReviewed.ok, true);
  assert.deepEqual(minimalReviewed.accepted, minimal);
});
