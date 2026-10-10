/**
 * MIT — SF-51 read-only source integration: original Bazaar + original MCP bridge.
 * No signer or settlement code, no external requests, no hosted CI, no grant claims.
 * The only listener binds to 127.0.0.1 using a kernel-chosen port.
 */
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { BazaarCatalog, createDiscoveryServer } from '../../../scf46-stellar-bazaar/src/catalog.mjs';
import { McpPaidToolBroker, createMcpHttpHandler, MCP_VERSION } from '../../../stellar-forge/mcp-paid-agent/agent-server.mjs';

const accept = {
  scheme: 'exact', network: 'stellar:testnet', asset: 'TEST-ONLY-UNISSUED-ASSET',
  payTo: 'TEST-ONLY-UNISSUED-RECIPIENT', amount: '25000', maxTimeoutSeconds: 60,
};
const method = 'GET';
const strictLocal = '127.0.0.1';

function entry(base) {
  return {
    resource: { url: base + '/premium', serviceName: 'SCF Local Sample',
      description: 'Local demo of a priced Stellar agent discovery endpoint', tags: ['stellar', 'sample', 'discovery'] },
    accepts: [{ ...accept }],
    extensions: { bazaar: { info: { input: { type: 'http', method, description: 'Demo read-only priced route' } },
      schema: { type: 'object', properties: {} } } },
  };
}

async function start() {
  const counts = { discovery: 0, merchant402: 0, signedRequests: 0, attemptedPayment: 0 };
  const catalog = new BazaarCatalog();
  const catalogHandler = createDiscoveryServer(catalog);
  const operatorToken = randomBytes(32).toString('hex');
  let handler;
  let base;
  const server = createServer((req, res) => {
    // Never allow this sample to be contacted through any other interface.
    if (req.socket.localAddress !== strictLocal) { res.writeHead(403); res.end(); return; }
    const path = new URL(req.url ?? '/', base ?? 'http://127.0.0.1').pathname;
    if (path === '/mcp') return void handler(req, res);
    if (path.startsWith('/discovery/')) { counts.discovery++; return void catalogHandler(req, res); }
    if (path === '/premium' && req.method === method) {
      if (req.headers['payment-signature']) {
        counts.signedRequests++;
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end('{"error":"demo-seller-rejects-any-signed-request"}');
        return;
      }
      counts.merchant402++;
      const required = {
        x402Version: 2, resource: { url: base + '/premium' }, accepts: [{ ...accept }],
        extensions: { bazaar: { info: { input: { type: 'http', method } }, schema: { type: 'object' } } },
      };
      res.writeHead(402, { 'PAYMENT-REQUIRED': Buffer.from(JSON.stringify(required)).toString('base64'),
        'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end('{"paymentRequired":true}');
      return;
    }
    res.writeHead(404); res.end();
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, strictLocal, resolve);
    });
    base = 'http://' + strictLocal + ':' + server.address().port;
    // Trusted local fixture ingestion ONLY. Production ingestion MUST use the
    // merged SF-46/SF-27 settlement/identity/version preflight before mutation.
    catalog.insertValidated(entry(base));
    const broker = new McpPaidToolBroker({ discoveryUrl: base,
      allowedResourceOrigins: [base], approve: () => false, signPayment: null });
    handler = createMcpHttpHandler(broker, { bearerToken: operatorToken });
    return { server, base, operatorToken, counts };
  } catch (error) {
    await new Promise(resolve => server.close(resolve));
    throw error;
  }
}

const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function mcp(base, token, id, name, params) {
  const response = await fetch(base + '/mcp', { method: 'POST', redirect: 'error',
    headers: { 'authorization': 'Bearer ' + token, 'content-type': 'application/json',
      'accept': 'application/json, text/event-stream', 'mcp-protocol-version': MCP_VERSION },
    body: JSON.stringify({ jsonrpc: '2.0', id, method: name, ...(params ? { params } : {}) }),
    signal: AbortSignal.timeout(8000),
  });
  assert(response.status === 200, 'MCP HTTP response ' + response.status);
  const obj = await response.json();
  assert(obj.id === id && obj.jsonrpc === '2.0' && !obj.error,
    'Malformed MCP result ' + JSON.stringify(obj.error ?? {}));
  return obj.result;
}

async function tool(base, token, id, name, args = {}) {
  const rpc = await mcp(base, token, id, 'tools/call', { name, arguments: args });
  assert(rpc && rpc.structuredContent, 'Missing native MCP structuredContent');
  return rpc;
}

/**
 * One first-party codepath exercise: real HTTP GET discovery -> actual source
 * MCP tool wrapper -> preview -> denied execution -> cancelled replay.
 */
export async function runLocalSourceSmoke() {
  const session = await start();
  const { base, operatorToken, server, counts } = session;
  try {
    const init = await mcp(base, operatorToken, 1, 'initialize', {
      protocolVersion: MCP_VERSION, capabilities: {}, clientInfo: { name: 'sf51', version: '1' },
    });
    assert(init.protocolVersion === MCP_VERSION, 'MCP version mismatch');
    const tools = await mcp(base, operatorToken, 2, 'tools/list');
    const names = new Set(tools.tools.map(x => x.name));
    for (const name of ['bazaar_search', 'bazaar_preview', 'bazaar_execute_approved', 'bazaar_cancel', 'bazaar_status'])
      assert(names.has(name), 'Missing actual MCP tool: ' + name);
    // Use the genuine source's discovery index rather than a re-created query.
    const found = await tool(base, operatorToken, 3, 'bazaar_search', { query: 'stellar sample discovery' });
    assert(!found.isError && found.structuredContent.resources.length === 1, 'Original Bazaar search failed');
    const handle = found.structuredContent.resources[0].handle;
    const preview = await tool(base, operatorToken, 4, 'bazaar_preview', { handle });
    assert(!preview.isError && preview.structuredContent.status === 'PREVIEWED', 'Price preview failed');
    assert(preview.structuredContent.selected.amount === accept.amount, 'Wrong quoted amount');
    const quoteId = preview.structuredContent.quoteId;
    const denied = await tool(base, operatorToken, 5, 'bazaar_execute_approved', { quoteId });
    assert(denied.isError && denied.structuredContent.code === 'SIGNER_NOT_CONNECTED', 'Execution must require absent signer');
    const cancelled = await tool(base, operatorToken, 6, 'bazaar_cancel', { quoteId });
    assert(!cancelled.isError && cancelled.structuredContent.status === 'CANCELLED', 'Cancel did not hold');
    const replay = await tool(base, operatorToken, 7, 'bazaar_execute_approved', { quoteId });
    assert(!replay.isError && replay.structuredContent.status === 'CANCELLED', 'Replay escaped cancellation');
    // The local merchant is a real HTTP server emitting an actual 402 challenge.
    // It is not called by an unapproved MCP execution.
    assert(counts.merchant402 === 0 && counts.signedRequests === 0, 'Unexpected merchant/payment attempt');
    const merchant = await fetch(base + '/premium', { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(8000) });
    assert(merchant.status === 402 && typeof merchant.headers.get('payment-required') === 'string', 'Missing real HTTP 402');
    assert(counts.merchant402 === 1 && counts.signedRequests === 0, 'Seller request guard failed');
    return Object.freeze({ status: 'PASS', source: 'SCF original BazaarCatalog + SF32 McpPaidToolBroker',
      protocol: MCP_VERSION, discovered: 1, previewAmountAtomic: accept.amount,
      executedPaymentCalls: 0, merchantGet402: counts.merchant402, signedRequests: counts.signedRequests,
      cancelledReplay: true, testnetTransactions: 0, grantSubmission: false });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  runLocalSourceSmoke().then(result => { console.log(JSON.stringify(result, null, 2)); },
    error => { console.error(error); process.exitCode = 1; });
}
