import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../src/store.mjs';
import { HearthlineOrchestrator } from '../src/orchestrator.mjs';
import { createMcpHttpServer, PROTOCOL_VERSION } from '../src/mcp-server.mjs';

async function start(options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'hearthline-http-'));
  const store = new JsonStore(join(dir, 'state.json')); await store.load();
  const orchestrator = new HearthlineOrchestrator({ store, alertProvider: async () => [] });
  const server = createMcpHttpServer({ orchestrator, allowedOrigins: ['https://allowed.example'], logger: { error() {} }, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { base: `http://127.0.0.1:${server.address().port}`, server };
}
async function rpc(base, body, headers = {}) { return fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(body) }); }
function initParams(protocolVersion = PROTOCOL_VERSION) { return { protocolVersion, capabilities: {}, clientInfo: { name: 'http-test', version: '1.0.0' } }; }

test('initializes 2025-11-25 session and serves tools + MCP App resource', async (t) => {
  const { base, server } = await start(); t.after(() => server.close());
  const init = await rpc(base, { jsonrpc: '2.0', id: 1, method: 'initialize', params: initParams() });
  assert.equal(init.status, 200); const session = init.headers.get('mcp-session-id'); assert.ok(session);
  const h = { 'mcp-session-id': session, 'mcp-protocol-version': PROTOCOL_VERSION };
  assert.equal((await rpc(base, { jsonrpc: '2.0', method: 'notifications/initialized' }, h)).status, 202);
  const toolsBody = await (await rpc(base, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, h)).json();
  assert.equal(toolsBody.result.tools.find(x => x.name === 'hearthline_prepare_storm')._meta.ui.resourceUri, 'ui://hearthline/mission-dashboard.html');
  const resourcesBody = await (await rpc(base, { jsonrpc: '2.0', id: 3, method: 'resources/read', params: { uri: 'ui://hearthline/mission-dashboard.html' } }, h)).json();
  assert.equal(resourcesBody.result.contents[0].mimeType, 'text/html;profile=mcp-app'); assert.match(resourcesBody.result.contents[0].text, /Hearthline Mission Dashboard/);
});

test('rejects bad origins, distinguishes missing session, and rejects wrong protocol version', async (t) => {
  const { base, server } = await start(); t.after(() => server.close());
  assert.equal((await rpc(base, { jsonrpc: '2.0', id: 1, method: 'initialize', params: initParams() }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await rpc(base, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, { 'mcp-protocol-version': PROTOCOL_VERSION })).status, 400);
  const init = await rpc(base, { jsonrpc: '2.0', id: 3, method: 'initialize', params: initParams() }); const session = init.headers.get('mcp-session-id');
  assert.equal((await rpc(base, { jsonrpc: '2.0', id: 4, method: 'tools/list', params: {} }, { 'mcp-session-id': session, 'mcp-protocol-version': '2025-03-26' })).status, 400);
});

test('GET /mcp returns allowed Streamable HTTP 405 when server does not expose SSE', async (t) => { const { base, server } = await start(); t.after(() => server.close()); assert.equal((await fetch(`${base}/mcp`, { headers: { accept: 'text/event-stream' } })).status, 405); });

test('GET /mcp validates session and protocol before the no-SSE 405 decision', async (t) => {
  const { base, server } = await start(); t.after(() => server.close());
  const init = await rpc(base, { jsonrpc: '2.0', id: 5, method: 'initialize', params: initParams() });
  const session = init.headers.get('mcp-session-id'); assert.ok(session);
  const current = { accept: 'text/event-stream', 'mcp-session-id': session, 'mcp-protocol-version': PROTOCOL_VERSION };
  const wrongVersion = await fetch(`${base}/mcp`, { headers: { ...current, 'mcp-protocol-version': '1900-01-01' } });
  assert.equal(wrongVersion.status, 400);
  assert.equal((await wrongVersion.json()).error.code, -32002);
  assert.equal((await fetch(`${base}/mcp`, { headers: current })).status, 405);
  assert.equal((await fetch(`${base}/mcp`, { method: 'DELETE', headers: current })).status, 204);
  const afterDelete = await fetch(`${base}/mcp`, { headers: current });
  assert.equal(afterDelete.status, 404);
  assert.match((await afterDelete.json()).error.message, /Unknown or expired MCP session/);

  const { base: expiringBase, server: expiringServer } = await start({ sessionTtlMs: 5 }); t.after(() => expiringServer.close());
  const expiringInit = await rpc(expiringBase, { jsonrpc: '2.0', id: 6, method: 'initialize', params: initParams() });
  const expiringSession = expiringInit.headers.get('mcp-session-id'); assert.ok(expiringSession);
  const expiringHeaders = { accept: 'text/event-stream', 'mcp-session-id': expiringSession, 'mcp-protocol-version': PROTOCOL_VERSION };
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal((await fetch(`${expiringBase}/mcp`, { headers: expiringHeaders })).status, 404);
});

test('rejects malformed UTF-8 before replacement decoding can allocate a session', async (t) => {
  const { base, server } = await start(); t.after(() => server.close());
  const prefix = `{"jsonrpc":"2.0","id":7,"method":"initialize","params":{"protocolVersion":"${PROTOCOL_VERSION}","capabilities":{},"clientInfo":{"name":"bad`;
  const suffix = '","version":"1.0.0"}}}';
  const malformed = Buffer.concat([Buffer.from(prefix), Buffer.from([0x80]), Buffer.from(suffix)]);
  assert.doesNotThrow(() => JSON.parse(malformed.toString('utf8')));

  const response = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: malformed,
  });
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('mcp-session-id'), null);
  assert.equal((await response.json()).error.code, -32700);
  assert.equal((await (await fetch(`${base}/health`)).json()).sessions, 0);
});

test('enforces initialized lifecycle and runs a full mission approval/receipt flow through MCP', async (t) => {
  const { base, server } = await start(); t.after(() => server.close());
  const init = await rpc(base, { jsonrpc: '2.0', id: 10, method: 'initialize', params: initParams() }); const session = init.headers.get('mcp-session-id'); const h = { 'mcp-session-id': session, 'mcp-protocol-version': PROTOCOL_VERSION };
  assert.equal((await rpc(base, { jsonrpc: '2.0', id: 11, method: 'tools/list', params: {} }, h)).status, 400); await rpc(base, { jsonrpc: '2.0', method: 'notifications/initialized' }, h);
  const mission = (await (await rpc(base, { jsonrpc: '2.0', id: 12, method: 'tools/call', params: { name: 'hearthline_prepare_storm', arguments: { latitude: 38.2, longitude: -85.7 } } }, h)).json()).result.structuredContent.mission;
  const action = mission.actions.find(a => a.kind === 'household_reminder');
  const approvedMission = (await (await rpc(base, { jsonrpc: '2.0', id: 13, method: 'tools/call', params: { name: 'hearthline_approve_action', arguments: { missionId: mission.id, actionId: action.id, planHash: mission.planHash } } }, h)).json()).result.structuredContent.mission;
  assert.equal(approvedMission.actions.find(a => a.id === action.id).status, 'approved');
  const result = (await (await rpc(base, { jsonrpc: '2.0', id: 14, method: 'tools/call', params: { name: 'hearthline_execute_approved', arguments: { missionId: mission.id, actionId: action.id, idempotencyKey: 'e2e-reminder-0001' } } }, h)).json()).result.structuredContent;
  assert.equal(result.replayed, false); assert.equal(result.receipt.semantics, 'local_demo_delivery');
});

test('MCP App resource performs the ui/initialize handshake and source-checks postMessage', async (t) => {
  const { base, server } = await start(); t.after(() => server.close()); const init = await rpc(base, { jsonrpc: '2.0', id: 20, method: 'initialize', params: initParams() }); const session = init.headers.get('mcp-session-id'); const h = { 'mcp-session-id': session, 'mcp-protocol-version': PROTOCOL_VERSION }; await rpc(base, { jsonrpc: '2.0', method: 'notifications/initialized' }, h);
  const html = (await (await rpc(base, { jsonrpc: '2.0', id: 21, method: 'resources/read', params: { uri: 'ui://hearthline/mission-dashboard.html' } }, h)).json()).result.contents[0].text;
  assert.match(html, /method:'ui\/initialize'/); assert.match(html, /protocolVersion:'2026-01-26'/); assert.match(html, /ev\.source!==window\.parent/); assert.match(html, /ui\/notifications\/tool-result/);
});

test('tool validation/business failures are MCP tool errors while unknown tool is a protocol error', async (t) => {
  const { base, server } = await start(); t.after(() => server.close()); const init = await rpc(base, { jsonrpc: '2.0', id: 30, method: 'initialize', params: initParams() }); const session = init.headers.get('mcp-session-id'); const h = { 'mcp-session-id': session, 'mcp-protocol-version': PROTOCOL_VERSION }; await rpc(base, { jsonrpc: '2.0', method: 'notifications/initialized' }, h);
  const badBody = await (await rpc(base, { jsonrpc: '2.0', id: 31, method: 'tools/call', params: { name: 'hearthline_prepare_storm', arguments: { latitude: 999, longitude: 0 } } }, h)).json(); assert.equal(badBody.result.isError, true); assert.match(badBody.result.content[0].text, /invalid latitude/);
  const unknownBody = await (await rpc(base, { jsonrpc: '2.0', id: 32, method: 'tools/call', params: { name: 'does_not_exist', arguments: {} } }, h)).json(); assert.equal(unknownBody.error.code, -32602);
});

test('unknown MCP method returns canonical JSON-RPC method-not-found', async (t) => {
  const { base, server } = await start(); t.after(() => server.close()); const init = await rpc(base, { jsonrpc: '2.0', id: 35, method: 'initialize', params: initParams() }); const session = init.headers.get('mcp-session-id'); const h = { 'mcp-session-id': session, 'mcp-protocol-version': PROTOCOL_VERSION }; await rpc(base, { jsonrpc: '2.0', method: 'notifications/initialized' }, h);
  const body = await (await rpc(base, { jsonrpc: '2.0', id: 36, method: 'hearthline/no_such_method', params: {} }, h)).json(); assert.equal(body.error.code, -32601);
});

test('expires idle MCP transport sessions without deleting durable mission state', async (t) => {
  const { base, server } = await start({ sessionTtlMs: 5 }); t.after(() => server.close()); const init = await rpc(base, { jsonrpc: '2.0', id: 40, method: 'initialize', params: initParams() }); const session = init.headers.get('mcp-session-id'); const h = { 'mcp-session-id': session, 'mcp-protocol-version': PROTOCOL_VERSION }; await rpc(base, { jsonrpc: '2.0', method: 'notifications/initialized' }, h); await new Promise(resolve => setTimeout(resolve, 15));
  const expired = await rpc(base, { jsonrpc: '2.0', id: 41, method: 'ping', params: {} }, h); assert.equal(expired.status, 404); assert.match((await expired.json()).error.message, /Unknown or expired MCP session/);
});
