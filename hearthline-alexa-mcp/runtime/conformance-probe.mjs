import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createMcpHttpServer, PROTOCOL_VERSION } from '../src/mcp-server.mjs';

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function sha256(value) { return createHash('sha256').update(canonical(value)).digest('hex'); }
function record(checks, id, ok, evidence) { checks.push({ id, ok: Boolean(ok), evidence }); }
const initParams = (protocolVersion = PROTOCOL_VERSION) => ({ protocolVersion, capabilities: {}, clientInfo: { name: 'conformance-probe', version: '1' } });

async function start() {
  const server = createMcpHttpServer({ orchestrator: {}, allowedOrigins: ['https://allowed.example'], logger: { error() {} } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { base: `http://127.0.0.1:${server.address().port}`, server };
}
async function rpc(base, body, headers = {}) {
  const response = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(body) });
  const text = await response.text();
  let parsed = null;
  if (text) { try { parsed = JSON.parse(text); } catch { parsed = { parseError: true, text }; } }
  return { response, body: parsed, text };
}

export async function runConformanceProbe() {
  const { base, server } = await start();
  const checks = [];
  try {
    const health = await (await fetch(`${base}/health`)).json();
    record(checks, 'protocol-advertised', health.ok === true && health.protocolVersion === PROTOCOL_VERSION, { protocolVersion: health.protocolVersion });

    const initializeNotification = await rpc(base, { jsonrpc: '2.0', method: 'initialize', params: initParams() });
    const afterBadInitialize = await (await fetch(`${base}/health`)).json();
    record(checks, 'initialize-notification-is-silent-and-allocates-no-session', initializeNotification.response.status === 400 && initializeNotification.text === '' && afterBadInitialize.sessions === 0, { httpStatus: initializeNotification.response.status, responseBytes: initializeNotification.text.length, sessions: afterBadInitialize.sessions });

    const negotiated = await rpc(base, { jsonrpc: '2.0', id: 1, method: 'initialize', params: initParams('1900-01-01') });
    const oldSession = negotiated.response.headers.get('mcp-session-id');
    record(checks, 'version-negotiation', negotiated.response.status === 200 && negotiated.body?.result?.protocolVersion === PROTOCOL_VERSION && Boolean(oldSession), { httpStatus: negotiated.response.status, protocolVersion: negotiated.body?.result?.protocolVersion ?? null, sessionAssigned: Boolean(oldSession) });
    if (oldSession) await fetch(`${base}/mcp`, { method: 'DELETE', headers: { 'mcp-session-id': oldSession, 'mcp-protocol-version': PROTOCOL_VERSION } });

    const init = await rpc(base, { jsonrpc: '2.0', id: 2, method: 'initialize', params: initParams() });
    const session = init.response.headers.get('mcp-session-id');
    record(checks, 'initialize', init.response.status === 200 && init.body?.result?.protocolVersion === PROTOCOL_VERSION && Boolean(session), { httpStatus: init.response.status, sessionAssigned: Boolean(session) });
    if (!session) throw new Error('initialize did not return MCP-Session-Id');
    const headers = { 'mcp-session-id': session, 'mcp-protocol-version': PROTOCOL_VERSION };

    const premature = await rpc(base, { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} }, headers);
    record(checks, 'initialized-lifecycle-gate', premature.response.status === 400 && premature.body?.error?.code === -32003, { httpStatus: premature.response.status, errorCode: premature.body?.error?.code ?? null });
    const initialized = await rpc(base, { jsonrpc: '2.0', method: 'notifications/initialized' }, headers);
    record(checks, 'initialized-notification-is-silent', initialized.response.status === 202 && initialized.text === '', { httpStatus: initialized.response.status, responseBytes: initialized.text.length });

    const tools = await rpc(base, { jsonrpc: '2.0', id: 4, method: 'tools/list', params: {} }, headers);
    const toolNames = Array.isArray(tools.body?.result?.tools) ? tools.body.result.tools.map((tool) => tool.name).sort() : [];
    record(checks, 'tools-discovery', tools.response.status === 200 && toolNames.length > 0, { httpStatus: tools.response.status, toolNames });
    const duplicate = await rpc(base, { jsonrpc: '2.0', id: 4, method: 'tools/list', params: {} }, headers);
    record(checks, 'request-id-reuse-rejected', duplicate.body?.error?.code === -32600, { httpStatus: duplicate.response.status, errorCode: duplicate.body?.error?.code ?? null });
    const typedDistinct = await rpc(base, { jsonrpc: '2.0', id: '4', method: 'ping', params: {} }, headers);
    record(checks, 'request-id-type-preserved', typedDistinct.response.status === 200 && typedDistinct.body?.result && Object.keys(typedDistinct.body.result).length === 0, { httpStatus: typedDistinct.response.status });

    const resources = await rpc(base, { jsonrpc: '2.0', id: 5, method: 'resources/list', params: {} }, headers);
    const resourceUris = Array.isArray(resources.body?.result?.resources) ? resources.body.result.resources.map((resource) => resource.uri).sort() : [];
    record(checks, 'resources-discovery', resources.response.status === 200 && resourceUris.includes('ui://hearthline/mission-dashboard.html'), { httpStatus: resources.response.status, resourceUris });
    const unknown = await rpc(base, { jsonrpc: '2.0', id: 6, method: 'hearthline/unknown', params: {} }, headers);
    record(checks, 'jsonrpc-method-not-found', unknown.response.status === 200 && unknown.body?.error?.code === -32601, { httpStatus: unknown.response.status, errorCode: unknown.body?.error?.code ?? null });
    const missing = await rpc(base, { jsonrpc: '2.0', id: 7, method: 'ping', params: {} }, { 'mcp-protocol-version': PROTOCOL_VERSION });
    record(checks, 'missing-session-is-bad-request', missing.response.status === 400, { httpStatus: missing.response.status });
    const wrongVersion = await rpc(base, { jsonrpc: '2.0', id: 8, method: 'ping', params: {} }, { ...headers, 'mcp-protocol-version': '2025-03-26' });
    record(checks, 'wrong-version-header-rejected', wrongVersion.response.status === 400, { httpStatus: wrongVersion.response.status });
    const invalidId = await rpc(base, { jsonrpc: '2.0', id: null, method: 'ping', params: {} }, headers);
    record(checks, 'invalid-request-id-rejected', invalidId.response.status === 400 && invalidId.body?.error?.code === -32600, { httpStatus: invalidId.response.status, errorCode: invalidId.body?.error?.code ?? null });
    const malformedNotification = await rpc(base, { jsonrpc: '2.0', method: 'tools/list', params: [] }, headers);
    record(checks, 'invalid-notification-remains-silent', malformedNotification.response.status === 202 && malformedNotification.text === '', { httpStatus: malformedNotification.response.status, responseBytes: malformedNotification.text.length });

    const denied = await rpc(base, { jsonrpc: '2.0', id: 9, method: 'initialize', params: initParams() }, { origin: 'https://evil.example' });
    record(checks, 'origin-fence', denied.response.status === 403, { httpStatus: denied.response.status });
    const anonymousGet = await fetch(`${base}/mcp`, { headers: { accept: 'text/event-stream' } });
    record(checks, 'get-without-sse-is-405', anonymousGet.status === 405, { httpStatus: anonymousGet.status });
    const currentGet = await fetch(`${base}/mcp`, { headers: { accept: 'text/event-stream', ...headers } });
    record(checks, 'get-current-session-without-sse-is-405', currentGet.status === 405, { httpStatus: currentGet.status });
    const badVersionGet = await fetch(`${base}/mcp`, { headers: { accept: 'text/event-stream', ...headers, 'mcp-protocol-version': '1900-01-01' } });
    record(checks, 'get-rejects-unsupported-version-before-405', badVersionGet.status === 400, { httpStatus: badVersionGet.status });
    const deleteWithoutVersion = await fetch(`${base}/mcp`, { method: 'DELETE', headers: { 'mcp-session-id': session } });
    record(checks, 'delete-requires-version-header', deleteWithoutVersion.status === 400, { httpStatus: deleteWithoutVersion.status });
    const closed = await fetch(`${base}/mcp`, { method: 'DELETE', headers });
    record(checks, 'session-delete', closed.status === 204, { httpStatus: closed.status });
    const deletedGet = await fetch(`${base}/mcp`, { headers: { accept: 'text/event-stream', ...headers } });
    record(checks, 'get-deleted-session-is-not-found', deletedGet.status === 404, { httpStatus: deletedGet.status });
    const afterDelete = await rpc(base, { jsonrpc: '2.0', id: 10, method: 'ping', params: {} }, headers);
    record(checks, 'deleted-session-is-not-found', afterDelete.response.status === 404, { httpStatus: afterDelete.response.status });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  const body = { schema: 'hearthline.mcp-runtime-conformance/v1', protocolVersion: PROTOCOL_VERSION, transport: 'Streamable HTTP', checks, summary: { passed: checks.filter((entry) => entry.ok).length, total: checks.length, ok: checks.every((entry) => entry.ok) } };
  return { ...body, sha256: sha256(body) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await runConformanceProbe();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.summary.ok) process.exitCode = 1;
}