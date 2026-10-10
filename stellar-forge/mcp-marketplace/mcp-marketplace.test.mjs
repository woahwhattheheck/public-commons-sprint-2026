import test from 'node:test';
import assert from 'node:assert/strict';
import { listTools } from '../../hearthline-alexa-mcp/src/tools.mjs';
import { createInitializeResult, PROTOCOL_VERSION } from '../../hearthline-alexa-mcp/src/mcp-server.mjs';
import { McpMarketplaceCatalog, SOURCE_PINS } from './mcp-marketplace.mjs';

const RESOURCE = 'https://hearthline.example/mcp';
const PAY_TO = 'GHEARTHLINE';

function mcpSnapshot(overrides = {}) {
  const initialized = createInitializeResult({
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'sf26-focused-check', version: '1.0.0' },
  });
  return {
    resourceURL: RESOURCE,
    transport: 'streamable-http',
    protocolVersion: initialized.protocolVersion,
    serverInfo: initialized.serverInfo,
    capabilities: initialized.capabilities,
    tools: listTools(),
    source: {
      url: 'https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/main/hearthline-alexa-mcp/src',
      toolsBlob: SOURCE_PINS.hearthlineToolsBlob,
      serverBlob: SOURCE_PINS.hearthlineServerBlob,
    },
    ...overrides,
  };
}

const wrapperSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: {
    input: {
      type: 'object',
      properties: {
        type: { const: 'mcp' }, toolName: { type: 'string' }, description: { type: 'string' },
        transport: { enum: ['streamable-http', 'sse'] }, inputSchema: { type: 'object' },
      },
      required: ['type', 'toolName', 'inputSchema'],
      additionalProperties: false,
    },
  },
  required: ['input'],
  additionalProperties: false,
};

function payload(tool, amount = '25000') {
  return {
    x402Version: 2,
    resource: { url: RESOURCE, description: 'Hearthline owner-controlled MCP tool' },
    accepted: { network: 'stellar:testnet', scheme: 'exact', payTo: PAY_TO, asset: 'USDC:TEST', amount },
    payload: { transaction: 'fixture-not-a-real-transaction' },
    extensions: { bazaar: { info: { input: {
      type: 'mcp', toolName: tool.name, description: tool.description,
      transport: 'streamable-http', inputSchema: structuredClone(tool.inputSchema),
    } }, schema: structuredClone(wrapperSchema) } },
  };
}

function settlement(sequence, amount = '25000') {
  return {
    status: 'settled', sellerId: 'hearthline-owner', signer: 'G-HEARTHLINE-AUTHENTICATED',
    origin: new URL(RESOURCE).origin, network: 'stellar:testnet', scheme: 'exact', payTo: PAY_TO,
    asset: 'USDC:TEST', amount, receiptURL: `https://facilitator.example/receipts/hearthline/${sequence}`,
    receiptSha256: String(sequence).padStart(64, 'a'), observedAt: `2026-10-10T04:0${sequence}:00.000Z`,
  };
}

function ingest(catalog, tool, sequence = 1, snapshot = mcpSnapshot(), amount = '25000') {
  return catalog.ingest({ paymentPayload: payload(tool, amount), settlement: settlement(sequence, amount), sequence, mcpSnapshot: snapshot });
}

test('actual owner-controlled tools/list metadata becomes linked MCP discovery records', () => {
  const catalog = new McpMarketplaceCatalog();
  const tools = listTools();
  const first = ingest(catalog, tools[2], 1);
  const second = ingest(catalog, tools[3], 1);
  assert.equal(first.decision, 'accepted'); assert.equal(second.decision, 'accepted');
  assert.equal(catalog.size, 2);
  const result = catalog.list(new URLSearchParams('type=mcp'));
  assert.deepEqual(result.resources.map(row => row.extensions.bazaar.info.input.toolName),
    ['hearthline_get_mission', 'hearthline_list_missions']);
  for (const row of result.resources) {
    assert.equal(row.mcpServer.transport, 'streamable-http');
    assert.equal(row.mcpServer.protocolVersion, PROTOCOL_VERSION);
    assert.match(row.mcpServer.capabilityDigest, /^[a-f0-9]{64}$/);
    assert.equal(row.mcpServer.source.toolsBlob, SOURCE_PINS.hearthlineToolsBlob);
  }
});

test('unadvertised or altered schemas reject before catalog mutation', () => {
  const catalog = new McpMarketplaceCatalog();
  const tool = listTools()[2];
  assert.equal(ingest(catalog, tool, 1).decision, 'accepted');
  const version = catalog.version;

  const missing = structuredClone(tool); missing.name = 'hearthline_nonexistent_tool';
  assert.equal(ingest(catalog, missing, 2).reason, 'MCP_TOOL_NOT_ADVERTISED');

  const changed = structuredClone(tool); changed.inputSchema.properties.missionId.maxLength = 999;
  assert.equal(ingest(catalog, changed, 2).reason, 'MCP_TOOL_SCHEMA_MISMATCH');
  assert.equal(catalog.version, version);
  assert.equal(catalog.size, 1);
});

test('transport and server capability mismatches fail closed', () => {
  const catalog = new McpMarketplaceCatalog();
  const tool = listTools()[2];
  const wrongTransport = mcpSnapshot({ transport: 'sse' });
  assert.equal(ingest(catalog, tool, 1, wrongTransport).reason, 'MCP_TRANSPORT_CAPABILITY_MISMATCH');
  const wrongServer = mcpSnapshot({ resourceURL: 'https://other.example/mcp' });
  assert.equal(ingest(catalog, tool, 1, wrongServer).reason, 'MCP_RESOURCE_CAPABILITY_MISMATCH');
  assert.equal(catalog.size, 0); assert.equal(catalog.version, 0);
});

test('schema transitions require matching capability evidence and monotonic sequence', () => {
  const catalog = new McpMarketplaceCatalog();
  const original = listTools()[2];
  assert.equal(ingest(catalog, original, 4).decision, 'accepted');
  const updated = structuredClone(original);
  updated.inputSchema.properties.missionId.maxLength = 300;
  const tools = listTools().map(tool => tool.name === updated.name ? updated : tool);
  const snapshot = mcpSnapshot({ tools });

  assert.equal(ingest(catalog, updated, 4, snapshot).reason, 'CONFLICTING_REPLAY');
  assert.equal(ingest(catalog, updated, 3, snapshot).reason, 'STALE_SEQUENCE');
  const accepted = ingest(catalog, updated, 5, snapshot);
  assert.equal(accepted.decision, 'accepted'); assert.equal(accepted.reason, 'CORRECTION');
  assert.equal(catalog.list(new URLSearchParams('type=mcp')).resources[0]
    .extensions.bazaar.info.input.inputSchema.properties.missionId.maxLength, 300);
});

test('ordinary HTTP resources still use the accepted SF-25 path unchanged', () => {
  const catalog = new McpMarketplaceCatalog();
  const http = payload(listTools()[0]);
  http.resource = { url: 'https://hearthline.example/weather', description: 'Weather route' };
  http.extensions.bazaar.info.input = { type: 'http', method: 'GET' };
  http.extensions.bazaar.schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object',
    properties: { input: { type: 'object', properties: { type: { const: 'http' }, method: { const: 'GET' } }, required: ['type', 'method'], additionalProperties: false } },
    required: ['input'], additionalProperties: false,
  };
  const paid = settlement(1); paid.origin = 'https://hearthline.example';
  const result = catalog.ingest({ paymentPayload: http, settlement: paid, sequence: 1 });
  assert.equal(result.decision, 'accepted');
  const row = catalog.list(new URLSearchParams('type=http')).resources[0];
  assert.equal(row.resource.url, 'https://hearthline.example/weather');
  assert.equal(row.mcpServer, undefined);
});
