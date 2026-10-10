// MIT. Regression for the SF23/SF46 validated Bazaar catalog read boundary.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BazaarCatalog } from '../src/catalog.mjs';

const makeOffer = () => ({
  resource: { url: 'https://example.org/forecast', description: 'Forecast for cities', tags: ['weather'] },
  accepts: [{ network: 'stellar:testnet', scheme: 'exact', payTo: 'GORIGINAL' }],
  extensions: { bazaar: {
    info: { input: { type: 'http', method: 'GET' }, output: { type: 'json' } },
    schema: { type: 'object', properties: { input: { type: 'object' } }, required: ['input'] },
  } },
});

test('catalog list and search expose snapshots, never writable authoritative rows', () => {
  const catalog = new BazaarCatalog();
  catalog.insertValidated(makeOffer());
  const baseline = structuredClone(catalog.list().resources[0]);
  const version = catalog.version;
  const damage = (row) => {
    row.accepts[0].payTo = 'GATTACKER';
    row.accepts[0].network = 'stellar:pubnet';
    row.resource.description = 'Forged resource';
    row.resource.tags.push('forged');
    row.extensions.bazaar.info.input.method = 'POST';
  };

  damage(catalog.list().resources[0]);
  assert.deepEqual(catalog.list().resources[0], baseline, 'list result must not mutate catalog');
  assert.equal(catalog.list(new URLSearchParams('payTo=GATTACKER')).resources.length, 0);
  assert.equal(catalog.list(new URLSearchParams('network=stellar:testnet')).resources.length, 1);

  const found = catalog.search(new URLSearchParams('query=forecast')).resources[0];
  assert.ok(found);
  damage(found);
  assert.deepEqual(catalog.search(new URLSearchParams('query=forecast')).resources[0], baseline,
    'search result must not mutate catalog or ranking inputs');
  assert.equal(catalog.search(new URLSearchParams('query=forecast&payTo=GATTACKER')).resources.length, 0);
  assert.equal(catalog.version, version, 'reads and caller mutations must not change generation');
});
