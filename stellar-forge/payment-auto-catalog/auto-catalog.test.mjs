import test from 'node:test';
import assert from 'node:assert/strict';
import { PaymentAutoCatalog, validateBazaarExtension } from './auto-catalog.mjs';

const schema = () => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: {
    input: { type: 'object', properties: { type: { type: 'string', const: 'http' }, method: { type: 'string', enum: ['GET'] } }, required: ['type', 'method'], additionalProperties: false },
    output: { type: 'object', properties: { type: { type: 'string' } }, required: ['type'], additionalProperties: false },
  },
  required: ['input'], additionalProperties: false,
});

const payload = () => ({
  x402Version: 2,
  resource: { url: 'https://seller.example/weather', description: 'Verified weather', serviceName: 'Weather seller' },
  accepted: { network: 'stellar:testnet', scheme: 'exact', payTo: 'GSELLER', asset: 'USDC:TEST', amount: '20000', maxTimeoutSeconds: 60, extra: {} },
  payload: { transaction: 'fixture-not-a-real-transaction' },
  extensions: { bazaar: { info: { input: { type: 'http', method: 'GET' }, output: { type: 'json' } }, schema: schema() } },
});

const settlement = (overrides = {}) => ({
  status: 'settled', sellerId: 'seller-1', signer: 'GAUTHENTICATEDSELLER', origin: 'https://seller.example',
  network: 'stellar:testnet', scheme: 'exact', payTo: 'GSELLER', asset: 'USDC:TEST', amount: '20000',
  receiptURL: 'https://facilitator.example/receipts/fixture-1', receiptSha256: 'a'.repeat(64), observedAt: '2026-10-10T03:30:00.000Z',
  ...overrides,
});

test('canonical v2 extension validates and catalogs exactly once without registration', () => {
  const catalog = new PaymentAutoCatalog();
  const first = catalog.ingest({ paymentPayload: payload(), settlement: settlement(), sequence: 1 });
  assert.equal(first.decision, 'accepted');
  assert.equal(first.reason, 'NEW_RESOURCE');
  assert.equal(catalog.size, 1);
  assert.equal(catalog.list().resources[0].resource.url, 'https://seller.example/weather');
  const version = catalog.version;
  assert.equal(catalog.ingest({ paymentPayload: payload(), settlement: settlement(), sequence: 1 }).reason, 'EXACT_REPLAY');
  assert.equal(catalog.version, version);
});

test('absence and invalid supplied schema soft-drop without catalog mutation', () => {
  const catalog = new PaymentAutoCatalog();
  const absent = payload(); delete absent.extensions.bazaar;
  assert.equal(catalog.ingest({ paymentPayload: absent, settlement: settlement(), sequence: 1 }).reason, 'BAZAAR_EXTENSION_ABSENT');

  const mismatch = payload(); mismatch.extensions.bazaar.info.input.method = 'POST';
  assert.equal(catalog.ingest({ paymentPayload: mismatch, settlement: settlement(), sequence: 1 }).reason, 'INFO_SCHEMA_MISMATCH');

  const external = payload(); external.extensions.bazaar.schema.properties.input.$ref = 'https://attacker.example/schema.json';
  assert.equal(catalog.ingest({ paymentPayload: external, settlement: settlement(), sequence: 1 }).reason, 'SCHEMA_EXTERNAL_REFERENCE');
  assert.equal(catalog.size, 0);
});

test('settlement facts and seller origin bind the echoed PaymentPayload', () => {
  const catalog = new PaymentAutoCatalog();
  assert.equal(catalog.ingest({ paymentPayload: payload(), settlement: settlement({ status: 'verified' }), sequence: 1 }).reason, 'SETTLEMENT_NOT_CONFIRMED');
  assert.equal(catalog.ingest({ paymentPayload: payload(), settlement: settlement({ payTo: 'GATTACKER' }), sequence: 1 }).reason, 'SETTLEMENT_PAYTO_MISMATCH');
  assert.equal(catalog.ingest({ paymentPayload: payload(), settlement: settlement({ origin: 'https://other.example' }), sequence: 1 }).reason, 'SETTLEMENT_ORIGIN_MISMATCH');
  assert.equal(catalog.size, 0);
});

test('local fragment refs work while cyclic or unsupported schemas fail closed', () => {
  const extension = payload().extensions.bazaar;
  extension.schema.$defs = { input: extension.schema.properties.input };
  extension.schema.properties.input = { $ref: '#/$defs/input' };
  assert.deepEqual(validateBazaarExtension(extension), { ok: true });
  extension.schema.$defs.input = { $ref: '#/$defs/input' };
  assert.equal(validateBazaarExtension(extension).reason, 'INFO_SCHEMA_MISMATCH');
  const unsupported = payload().extensions.bazaar; unsupported.schema.patternProperties = {};
  assert.equal(validateBazaarExtension(unsupported).reason, 'SCHEMA_KEYWORD_UNSUPPORTED:patternProperties');
});
