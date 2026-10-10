// MIT. One focused end-to-end check using actual public Bazaar and SF32 MCP HTTP.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runReadOnlyMcpOnramp } from '../mcp-onramp.mjs';

test('source discovery -> MCP preview -> no-signer refusal -> cancel, zero merchant traffic', async () => {
  const receipt = await runReadOnlyMcpOnramp();
  assert.equal(receipt.mode, 'REAL_SOURCE_LOCAL_READ_ONLY_MCP');
  assert.equal(receipt.originalSources.sourcePinMatches, true);
  assert.equal(receipt.originalSources.mcpProtocolVersion, '2025-11-25');
  assert.equal(receipt.discoveredResources, 1);
  assert.deepEqual(receipt.audit, { discoveryHttpRequests: 1, merchantHttpRequests: 0 });
  assert.equal(receipt.quote.status, 'PREVIEWED');
  assert.equal(receipt.quote.unpaid, true);
  assert.equal(receipt.deniedUnsignedExecution, 'SIGNER_NOT_CONNECTED');
  assert.equal(receipt.postDenialQuoteStatus, 'PREVIEWED');
  assert.equal(receipt.cancelledUnpaidQuoteStatus, 'CANCELLED');
  assert.equal(receipt.unwiredAgentToolStatus, 'AGENT_COMMERCE_UNAVAILABLE');
  assert.equal(receipt.anonymousHttpStatus, 401);
  assert.equal(receipt.paymentSigner, false);
  assert.equal(receipt.merchantCalled, false);
  assert.equal(receipt.blockchainTransaction, null);
  assert.equal(receipt.settled, false);
  assert.equal(receipt.grantSubmitted, false);
});
