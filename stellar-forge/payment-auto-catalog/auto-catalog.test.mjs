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

test('Draft 2020-12 local refs also enforce adjacent assertions', () => {
  const check = (value, adjacent, target = true) => validateBazaarExtension({
    info: { input: value },
    schema: { $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object', $defs: { target },
      properties: { input: { $ref: '#/$defs/target', ...adjacent } },
      required: ['input'], additionalProperties: false },
  });
  for (const [value, adjacent, target] of [
    ['x', { minLength: 2 }, { type: 'string' }],
    [1, { exclusiveMinimum: 1 }, { type: 'integer' }],
    ['1', { minimum: 0 }, { type: 'integer' }],
    ['POST', { enum: ['GET'] }, { type: 'string' }],
    [{}, { required: ['method'] }, { type: 'object' }],
    [{ unexpected: true }, { additionalProperties: false }, { type: 'object' }],
    [1, { allOf: [{ minimum: 2 }] }, true],
    [1, {}, false],
  ]) {
    const result = check(value, adjacent, target);
    assert.equal(result.ok, false, JSON.stringify({ value, adjacent, target }));
    assert.equal(result.reason, 'INFO_SCHEMA_MISMATCH');
  }
  assert.deepEqual(check(2, { exclusiveMinimum: 1 }, { type: 'integer' }), { ok: true });
  // A reference followed by the same reference in an independent sibling
  // branch is not a cycle; both still constrain the same instance.
  assert.deepEqual(check('GET', { allOf: [{ $ref: '#/$defs/target' }], enum: ['GET'] },
    { type: 'string' }), { ok: true });
});

test('a permissive local ref cannot bypass the catalog input schema', () => {
  const catalog = new PaymentAutoCatalog();
  const candidate = payload();
  const extension = candidate.extensions.bazaar;
  extension.schema.$defs = { anyInput: true };
  extension.schema.properties.input.$ref = '#/$defs/anyInput';
  extension.info.input.method = 'POST'; // Sibling schema still declares GET.
  const outcome = catalog.ingest({ paymentPayload: candidate, settlement: settlement(), sequence: 1 });
  assert.equal(outcome.decision, 'soft_drop');
  assert.equal(outcome.reason, 'INFO_SCHEMA_MISMATCH');
  assert.equal(catalog.size, 0);
  assert.equal(catalog.version, 0);
  extension.info.input.method = 'GET';
  assert.equal(catalog.ingest({ paymentPayload: candidate, settlement: settlement(), sequence: 1 }).decision, 'accepted');
  assert.equal(catalog.size, 1);
});


test('untrusted assertion keyword shapes fail closed before catalog commit', () => {
  const malformed = [
    ['root', 'type', 'constructor'],
    ['root', 'type', ['object', 'object']],
    ['root', 'minLength', '10'],
    ['root', 'maxItems', -1],
    ['root', 'minimum', '0'],
    ['root', 'uniqueItems', 'true'],
    ['root', 'required', ['input', 'input']],
    ['root', 'enum', 'example'],
    ['root', 'anyOf', []],
    ['input', 'items', 'false'],
    ['input', 'additionalProperties', 'false'],
  ];
  for (const [scope, key, value] of malformed) {
    const extension = payload().extensions.bazaar;
    const target = scope === 'root' ? extension.schema : extension.schema.properties.input;
    target[key] = value;
    const checked = validateBazaarExtension(extension);
    assert.equal(checked.ok, false, scope + '.' + key);
    assert.match(checked.reason, /^SCHEMA_.*_INVALID$/, scope + '.' + key);
  }
  const catalog = new PaymentAutoCatalog();
  const forged = payload();
  forged.extensions.bazaar.schema.properties.input.additionalProperties = 'false';
  forged.extensions.bazaar.info.input.unlisted = 'unvalidated property';
  const outcome = catalog.ingest({ paymentPayload: forged, settlement: settlement(), sequence: 1 });
  assert.equal(outcome.decision, 'soft_drop');
  assert.equal(outcome.reason, 'SCHEMA_ADDITIONALPROPERTIES_INVALID');
  assert.equal(catalog.size, 0);
});

test('valid structural schema boolean assertions still pass the original ingestion path', () => {
  const extension = payload().extensions.bazaar;
  extension.schema.properties.input.additionalProperties = false;
  extension.schema.properties.input.required = ['type', 'method'];
  extension.schema.properties.input.minLength = 0;
  extension.schema.examples = [{ input: { type: 'http', method: 'GET' } }];
  assert.deepEqual(validateBazaarExtension(extension), { ok: true });
  const valid = payload();
  valid.extensions.bazaar = extension;
  const catalog = new PaymentAutoCatalog();
  assert.equal(catalog.ingest({ paymentPayload: valid, settlement: settlement(), sequence: 1 }).decision, 'accepted');
  assert.equal(catalog.size, 1);
});
