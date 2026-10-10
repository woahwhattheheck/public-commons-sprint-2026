import test from 'node:test';
import assert from 'node:assert/strict';
import { createSellerDiscovery } from '../index.mjs';

const make = (url, allowHttpLoopback = false) => createSellerDiscovery({
  resource: { url, description: 'Weather endpoint' },
  accepts: [{
    scheme: 'exact', network: 'stellar:testnet', asset: 'DEMO_ASSET_UNSET',
    amount: '20000', payTo: 'DEMO_PAYTO_UNSET', maxTimeoutSeconds: 60,
  }],
  input: { type: 'http', method: 'GET', querySchema: {
    type: 'object', properties: {city: {type: 'string', examples: ['Louisville']}},
    required: ['city'], additionalProperties: false,
  }},
  allowHttpLoopback,
});

test('public Seller Discovery rejects private and local resource hosts', () => {
  const blocked = [
    'https://127.0.0.1/paid', 'https://10.2.3.4/paid',
    'https://192.168.1.5/paid', 'https://169.254.169.254/latest',
    'https://[::1]/paid', 'https://[::ffff:127.0.0.1]/paid',
    'https://localhost/paid', 'https://api.internal/paid',
    'https://seller.home.arpa/paid', 'https://seller.local/paid',
    'https://sub.localhost/paid',
  ];
  for (const url of blocked) {
    assert.throws(() => make(url), /Private or local seller resource host/, url);
    assert.throws(() => make(url, true), /Private or local seller resource host/,
      'developer exception must not open HTTPS local URLs: ' + url);
  }
});

test('preserve real HTTPS resources and the original explicit HTTP loopback dev exception', () => {
  const publicUrl = 'https://seller.example/paid';
  assert.equal(make(publicUrl).resource.url, publicUrl);
  for (const url of [
    'http://127.0.0.1:8422/paid',
    'http://localhost:8422/paid',
    'http://[::1]:8422/paid',
  ]) {
    assert.throws(() => make(url), /HTTPS/, 'without developer opt-in: ' + url);
    assert.equal(make(url, true).resource.url, url, 'opted-in dev fixture: ' + url);
  }
  assert.throws(() => make('http://api.internal/paid', true), /HTTPS/);
});
