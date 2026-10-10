import test from 'node:test';
import assert from 'node:assert/strict';
import { BazaarCatalog } from '../../scf46-stellar-bazaar/src/catalog.mjs';
import { CatalogTrustBoundary, verifyAuditTrail } from './catalog-trust.mjs';

const baseEntry = () => ({
  resource: {
    url: 'https://seller.example/weather',
    description: 'Verified weather observations',
    serviceName: 'Weather seller',
    tags: ['weather'],
  },
  accepts: [{
    network: 'stellar:testnet', scheme: 'exact', payTo: 'GSELLER',
    maxAmountRequired: '20000', asset: 'USDC:TEST',
  }],
  extensions: { bazaar: {
    info: { input: { type: 'http', method: 'GET', description: 'City weather' }, output: { type: 'json' } },
    schema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
  } },
});

const authority = (overrides = {}) => ({
  sellerId: 'seller-1', signer: 'GDUMMYAUTHENTICATEDSIGNER',
  allowedOrigins: new Set(['https://seller.example']),
  allowedRecipients: new Set(['GSELLER']),
  allowedNetworks: new Set(['stellar:testnet']),
  allowedSchemes: new Set(['exact']),
  ...overrides,
});

test('real BazaarCatalog stays frozen under hostile seller payloads', () => {
  const catalog = new BazaarCatalog();
  const trust = new CatalogTrustBoundary(catalog, { maxDocumentBytes: 8_192, maxStringBytes: 512 });

  const first = baseEntry();
  assert.equal(trust.ingest({ sellerId: 'seller-1', sequence: 1, entry: first }, authority()).decision, 'accepted');
  const frozen = structuredClone(catalog.list().resources);
  assert.equal(catalog.size, 1);

  const forgedSeller = baseEntry(); forgedSeller.resource.description = 'impersonated';
  assert.equal(trust.ingest({ sellerId: 'seller-2', sequence: 2, entry: forgedSeller }, authority()).reason,
    'SELLER_IDENTITY_MISMATCH');

  const forgedRecipient = baseEntry(); forgedRecipient.accepts[0].payTo = 'GATTACKER';
  assert.equal(trust.ingest({ sellerId: 'seller-1', sequence: 2, entry: forgedRecipient }, authority()).reason,
    'PAYMENT_RECIPIENT_UNAUTHORIZED');

  const originTakeover = baseEntry();
  assert.equal(trust.ingest({ sellerId: 'seller-2', sequence: 1, entry: originTakeover },
    authority({ sellerId: 'seller-2', signer: 'GOTHERAUTHENTICATEDSIGNER' })).reason, 'SELLER_ORIGIN_CONFLICT');

  const bomb = baseEntry(); bomb.resource.description = 'x'.repeat(513);
  assert.equal(trust.ingest({ sellerId: 'seller-1', sequence: 2, entry: bomb }, authority()).reason,
    'METADATA_STRING_LIMIT');

  const poisonedSchema = baseEntry();
  poisonedSchema.extensions.bazaar.schema = JSON.parse('{"type":"object","__proto__":{"polluted":true}}');
  assert.equal(trust.ingest({ sellerId: 'seller-1', sequence: 2, entry: poisonedSchema }, authority()).reason,
    'METADATA_FORBIDDEN_KEY');

  const conflictingTerms = baseEntry();
  conflictingTerms.accepts.push({ ...conflictingTerms.accepts[0], maxAmountRequired: '999999' });
  assert.equal(trust.ingest({ sellerId: 'seller-1', sequence: 2, entry: conflictingTerms }, authority()).reason,
    'PAYMENT_TERM_CONFLICT');

  const conflict = baseEntry(); conflict.resource.description = 'different at the same sequence';
  assert.equal(trust.ingest({ sellerId: 'seller-1', sequence: 1, entry: conflict }, authority()).reason,
    'CONFLICTING_REPLAY');

  assert.deepEqual(catalog.list().resources, frozen);
  assert.equal(catalog.size, 1);
});

test('exact replay soft-drops, authorized monotonic update replaces one listing', () => {
  const catalog = new BazaarCatalog();
  const trust = new CatalogTrustBoundary(catalog);
  const entry = baseEntry();
  const candidate = { sellerId: 'seller-1', sequence: 4, entry };
  assert.equal(trust.ingest(candidate, authority()).reason, 'NEW_RESOURCE');
  assert.equal(trust.ingest(candidate, authority()).reason, 'EXACT_REPLAY');

  const updated = baseEntry(); updated.accepts[0].maxAmountRequired = '15000';
  const accepted = trust.ingest({ sellerId: 'seller-1', sequence: 5, entry: updated }, authority());
  assert.equal(accepted.reason, 'AUTHORIZED_UPDATE');
  assert.equal(catalog.size, 1);
  assert.equal(catalog.list().resources[0].accepts[0].maxAmountRequired, '15000');
  assert.equal(verifyAuditTrail(trust.auditTrail()), true);

  const tampered = trust.auditTrail(); tampered[1].reason = 'FAKE';
  assert.equal(verifyAuditTrail(tampered), false);
});

test('parser rejections quarantine without publishing a resource', () => {
  const catalog = new BazaarCatalog();
  const trust = new CatalogTrustBoundary(catalog);
  const invalid = baseEntry(); invalid.extensions.bazaar.info.input.method = 'TRACE';
  const result = trust.ingest({ sellerId: 'seller-1', sequence: 1, entry: invalid }, authority());
  assert.equal(result.reason, 'CATALOG_PARSER_REJECTED');
  assert.equal(catalog.size, 0);
  assert.equal(verifyAuditTrail(trust.auditTrail()), true);
});
