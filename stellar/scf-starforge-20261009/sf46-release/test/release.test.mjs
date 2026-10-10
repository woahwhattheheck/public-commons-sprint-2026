// MIT. Focused offline release checks against actual installed source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gitBlobSha, assessRelease } from '../preflight.mjs';
import { BazaarCatalog, McpPaidToolBroker, createDiscoveryServer } from '../index.mjs';

test('git object digest', () => {
  assert.equal(gitBlobSha(Buffer.from('hello\n')),
    'ce013625030ba8dba906f756967f9e9ca394464a');
});

test('original source export and constructor contract', () => {
  const catalog = new BazaarCatalog();
  assert.equal(catalog.size, 0);
  assert.deepEqual(catalog.list(new URLSearchParams()).resources, []);
  assert.equal(typeof createDiscoveryServer(catalog), 'function');
  const broker = new McpPaidToolBroker({
    discoveryUrl: 'http://127.0.0.1:9', allowedResourceOrigins: [],
    approve: () => false, signPayment: null
  });
  assert.equal(typeof broker.search, 'function');
  assert.equal(typeof broker.preview, 'function');
});

test('full current checkout passes module contract', async () => {
  const report = await assessRelease();
  assert.equal(report.sources.length, 8);
  assert.equal(report.status, 'PASS_SOURCE_CONTRACTS_ONLY',
    JSON.stringify(report.failures));
  assert.ok(report.unverifiedGates.length >= 4);
});
