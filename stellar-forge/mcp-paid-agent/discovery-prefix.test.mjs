/**
 * Focused regression for SF32 discovery path-prefix preservation.
 * Proves the old leading-slash construction drops operator prefixes,
 * and the repaired construction keeps them, normalizes trailing slash,
 * and still lands on /discovery/search for a root base.
 * No network, no payments, no secrets.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { McpPaidToolBroker } from './agent-server.mjs';

function captureSearchUrl(discoveryUrl) {
  let seen = null;
  const broker = new McpPaidToolBroker({
    discoveryUrl,
    fetchImpl: async (url) => {
      seen = String(url);
      return new Response(JSON.stringify({ resources: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  return broker.search({ query: 'x' }).then(() => seen);
}

test('preserves configured facilitator path prefix', async () => {
  const url = await captureSearchUrl('https://facilitator.example/x402');
  assert.equal(url, 'https://facilitator.example/x402/discovery/search?query=x');
});

test('normalizes trailing slash identically', async () => {
  const a = await captureSearchUrl('https://facilitator.example/x402');
  const b = await captureSearchUrl('https://facilitator.example/x402/');
  assert.equal(a, b);
  assert.equal(a, 'https://facilitator.example/x402/discovery/search?query=x');
});

test('root base still resolves to /discovery/search', async () => {
  const url = await captureSearchUrl('https://facilitator.example');
  assert.equal(url, 'https://facilitator.example/discovery/search?query=x');
});

test('negative control: old root-dropping construction fails the prefix case', () => {
  const base = new URL('https://facilitator.example/x402');
  const broken = new URL('/discovery/search', base);
  assert.equal(broken.pathname, '/discovery/search');
  assert.notEqual(broken.href, 'https://facilitator.example/x402/discovery/search');
});
