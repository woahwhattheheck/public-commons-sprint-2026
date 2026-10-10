// MIT. One source-integrated Node22 runtime acceptance; no network or money.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runLocalSourceSmoke } from '../smoke.mjs';

test('merged Bazaar discovery and SF32 MCP bridge fail closed without signer', async () => {
  const result = await runLocalSourceSmoke();
  assert.deepEqual(result, {
    status: 'PASS', source: 'SCF original BazaarCatalog + SF32 McpPaidToolBroker',
    protocol: '2025-11-25', discovered: 1, previewAmountAtomic: '25000',
    executedPaymentCalls: 0, merchantGet402: 1, signedRequests: 0,
    cancelledReplay: true, testnetTransactions: 0, grantSubmission: false,
  });
});
