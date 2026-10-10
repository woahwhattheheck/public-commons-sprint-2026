// MIT. SF44 original-source local discovery -> SF32 MCP read-only acceptance.
// No real asset, merchant request, wallet, signer, or network payment is possible.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import {
  startLocalDevelopmentCatalog, developmentOnlyRecord, sourceProvenance
} from './onboard.mjs';
import {
  MCP_VERSION, McpPaidToolBroker, createMcpHttpHandler
} from '../../../stellar-forge/mcp-paid-agent/agent-server.mjs';

async function openServer(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
}
async function closeServer(server) {
  await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
}

/**
 * Starts two REAL public-source loopback servers:
 * PR451/SF23 Bazaar HTTP catalog and SF32 MCP Streamable HTTP (JSON response subset).
 * The source fixture has deliberately invalid recipient and asset, and is NEVER
 * a payable service. The broker has no approve or signPayment callback and an
 * egress guard that permits ONLY its local discovery server.
 *
 * Returned rpc() retains its random bearer token in a closure; the token is
 * never printed by this module or included in the acceptance receipt.
 */
export async function startReadOnlyMcpOnramp() {
  const source = await sourceProvenance();
  if (!source.baselineMatches)
    throw new Error('SF44 actual Bazaar source drifted; update the source pin before running');
  const catalog = await startLocalDevelopmentCatalog();
  let server;
  try {
    const catalogOrigin = new URL(catalog.baseUrl).origin;
    const fictitiousOrigin = new URL(developmentOnlyRecord().resource.url).origin;
    const audit = { discoveryHttpRequests: 0, merchantHttpRequests: 0 };
    const broker = new McpPaidToolBroker({
      discoveryUrl: catalog.baseUrl,
      // Allow only a fake source URL to reach PREVIEW; actual merchant access is
      // impossible even if a future caller accidentally connects a signer.
      allowedResourceOrigins: [fictitiousOrigin],
      fetchImpl: (input, options) => {
        const target = new URL(String(input));
        if (target.origin !== catalogOrigin) {
          audit.merchantHttpRequests++;
          throw new Error('External merchant requests are prohibited in SF44 onramp');
        }
        audit.discoveryHttpRequests++;
        return fetch(input, options);
      }
      // approve defaults to DENY and signPayment defaults to null.
    });
    const bearerToken = randomBytes(32).toString('hex');
    server = createServer(createMcpHttpHandler(broker, {
      bearerToken, allowedClientOrigins: []
    }));
    await openServer(server);
    const mcpUrl = 'http://127.0.0.1:' + server.address().port + '/mcp';
    let nextId = 0;
    const rpc = async (method, params = {}) => {
      const response = await fetch(mcpUrl, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: 'Bearer ' + bearerToken,
          'mcp-protocol-version': MCP_VERSION
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++nextId, method, params })
      });
      const payload = await response.json();
      if (response.status !== 200 || payload.error)
        throw new Error('Unexpected MCP response: HTTP ' + response.status + ' ' +
          String(payload.error?.message ?? 'unknown'));
      return payload.result;
    };
    let closed = false;
    return {
      mcpUrl, source, rpc,
      audit: () => ({ ...audit }),
      async close() {
        if (closed) return;
        closed = true;
        try { await closeServer(server); } finally { await catalog.close(); }
      }
    };
  } catch (error) {
    if (server?.listening) await closeServer(server);
    await catalog.close();
    throw error;
  }
}

function requireStatus(result, name, expected) {
  if (result?.isError !== true ||
      result.structuredContent?.code !== expected)
    throw new Error(name + ' must fail closed with ' + expected);
}

async function callTool(demo, name, args) {
  return demo.rpc('tools/call', { name, arguments: args });
}

/**
 * Real wire-level demonstration with real original PR451 and SF32 source.
 * No fake settlement, funded testnet or charge: it proves the safe pre-pay UX.
 */
export async function runReadOnlyMcpOnramp() {
  const demo = await startReadOnlyMcpOnramp();
  try {
    const init = await demo.rpc('initialize', {
      protocolVersion: MCP_VERSION,
      capabilities: {},
      clientInfo: { name: 'sf44-local-original-source', version: '1.0.0' }
    });
    if (init.protocolVersion !== MCP_VERSION)
      throw new Error('MCP protocol negotiation mismatch');
    const list = await demo.rpc('tools/list');
    const names = (list.tools ?? []).map(tool => tool.name);
    for (const expected of [
      'bazaar_search', 'bazaar_preview', 'bazaar_execute_approved',
      'bazaar_status', 'bazaar_cancel', 'sf43_discover_review_and_pay'
    ]) {
      if (!names.includes(expected)) throw new Error('Missing MCP tool ' + expected);
    }
    const found = await callTool(demo, 'bazaar_search',
      { query: 'weather', network: 'stellar:testnet' });
    if (found.isError || found.structuredContent?.resources?.length !== 1)
      throw new Error('Original catalog search must return precisely one local record');
    const discovered = found.structuredContent.resources[0];
    if (discovered.resourceType !== 'http' ||
        discovered.resource?.url !== developmentOnlyRecord().resource.url ||
        discovered.allowedOrigin !== true)
      throw new Error('Original source resource identity or origin mismatch');
    const preview = await callTool(demo, 'bazaar_preview',
      { handle: discovered.handle, input: {} });
    if (preview.isError || preview.structuredContent?.status !== 'PREVIEWED')
      throw new Error('Read-only price review did not generate a quote');
    const quoteId = preview.structuredContent.quoteId;
    const quote = preview.structuredContent.selected;
    if (quote.amount !== '10000' || quote.asset !== 'NONPAYABLE_DEMO_ASSET' ||
        quote.payTo !== 'INVALID_DEMO_RECIPIENT_NOT_A_WALLET')
      throw new Error('Developer-only payment terms were altered');
    const execute = await callTool(demo, 'bazaar_execute_approved', { quoteId });
    requireStatus(execute, 'unsigned paid request', 'SIGNER_NOT_CONNECTED');
    const status = await callTool(demo, 'bazaar_status', { quoteId });
    if (status.isError || status.structuredContent.status !== 'PREVIEWED')
      throw new Error('Denied unsigned request changed quote state');
    const cancelled = await callTool(demo, 'bazaar_cancel', { quoteId });
    if (cancelled.isError || cancelled.structuredContent.status !== 'CANCELLED')
      throw new Error('Local unpaid quote was not cancelled');
    const unwired = await callTool(demo, 'sf43_discover_review_and_pay', { query: 'weather' });
    requireStatus(unwired, 'unwired SF43 agent commerce', 'AGENT_COMMERCE_UNAVAILABLE');
    const anonymous = await fetch(demo.mcpUrl, {
      method: 'POST', redirect: 'error',
      headers: { 'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': MCP_VERSION },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    });
    await anonymous.body?.cancel();
    if (anonymous.status !== 401) throw new Error('Unauthenticated MCP access was not refused');
    const audit = demo.audit();
    if (audit.discoveryHttpRequests !== 1 || audit.merchantHttpRequests !== 0)
      throw new Error('Unexpected outbound HTTP activity during read-only demo');
    return {
      mode: 'REAL_SOURCE_LOCAL_READ_ONLY_MCP',
      originalSources: {
        bazaarCatalogGitBlob: demo.source.actualGitBlob,
        sourcePinMatches: demo.source.baselineMatches,
        mcpProtocolVersion: MCP_VERSION
      },
      mcpToolsAdvertised: names,
      discoveredResources: found.structuredContent.resources.length,
      origin: 'https://example.org (INTENTIONALLY FICTITIOUS)',
      quote: { status: 'PREVIEWED', amountAtomic: quote.amount, asset: quote.asset,
        payTo: quote.payTo, unpaid: true },
      deniedUnsignedExecution: execute.structuredContent.code,
      postDenialQuoteStatus: status.structuredContent.status,
      cancelledUnpaidQuoteStatus: cancelled.structuredContent.status,
      unwiredAgentToolStatus: unwired.structuredContent.code,
      anonymousHttpStatus: anonymous.status,
      audit,
      paymentSigner: false,
      merchantCalled: false,
      blockchainTransaction: null,
      settled: false,
      grantSubmitted: false
    };
  } finally {
    await demo.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runReadOnlyMcpOnramp().then(value => console.log(JSON.stringify(value, null, 2)))
    .catch(err => { console.error(err.message); process.exitCode = 1; });
}
