// MIT. Draft 2020-12 string lengths through the shared validator and seller HTTP path.
// Loopback challenges only; no native payment dependency or provider requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBazaarExtension } from './schema-validation.mjs';
import { importOpenApi } from '../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/importer.mjs';
import { createSellerServiceConfig } from '../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/service-config.mjs';
import { startSellerService } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/serve.mjs';

test('string bounds count Unicode characters, including paired surrogate escapes', () => {
  const check = (value, constraints) => validateBazaarExtension({
    info: { value }, schema: { $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object', properties: { value: { type: 'string', ...constraints } } },
  }).ok;
  assert.equal(check('🚀', { maxLength: 1 }), true);
  assert.equal(check('🚀', { minLength: 2 }), false);
  assert.equal(check(JSON.parse('"\\ud83d\\ude80"'), { minLength: 1, maxLength: 1 }), true);
  assert.equal(check('a🚀', { minLength: 2, maxLength: 2 }), true);
  assert.equal(check('🚀🪐', { maxLength: 1 }), false);
  assert.equal(check('é', { minLength: 1, maxLength: 1 }), true);
  // Combining sequences remain separate code points; do not count graphemes
  // or normalize the caller's original Unicode string.
  assert.equal(check('e\u0301', { minLength: 2, maxLength: 2 }), true);
  assert.equal(check('', { maxLength: 0 }), true);
  assert.equal(check('', { minLength: 1 }), false);
  assert.equal(check('ab', { minLength: 2, maxLength: 2 }), true);
});

test('an imported one-character Unicode path reaches the original HTTP challenge', async t => {
  const document = { openapi: '3.1.1', info: { title: 'Unicode route fixture' },
    servers: [{ url: 'https://seller.example/api' }], paths: { '/symbols/{symbol}': {
      get: { parameters: [{ name: 'symbol', in: 'path', required: true,
        schema: { type: 'string', minLength: 1, maxLength: 1, examples: ['🚀'] } }] },
    } } };
  const selections = [{ method: 'GET', path: '/symbols/{symbol}', accepts: [{
    scheme: 'exact', network: 'stellar:testnet', asset: 'FIXTURE_ASSET',
    payTo: 'FIXTURE_RECIPIENT', amount: '1', maxTimeoutSeconds: 60,
  }] }];
  const imported = importOpenApi(document, selections);
  const config = createSellerServiceConfig(imported, [{ method: 'GET', path: '/symbols/{symbol}',
    id: 'symbols', response: { protected: true } }]);
  const session = await startSellerService({ config, port: 0 });
  t.after(() => session.close());
  const response = await fetch(session.url + '/api/symbols/' + encodeURIComponent('🪐'));
  assert.equal(response.status, 402);
  const offer = JSON.parse(Buffer.from(response.headers.get('payment-required'), 'base64'));
  assert.deepEqual(offer.extensions.bazaar.info.input.pathParams, { symbol: '🪐' });
  assert.deepEqual(offer.extensions.bazaar.schema, imported.offers[0].seller.extensions.bazaar.schema);
  assert.equal((await fetch(session.url + '/api/symbols/' + encodeURIComponent('🚀🪐'))).status, 400);
});
