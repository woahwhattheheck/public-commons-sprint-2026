import http from 'node:http';
import { randomUUID } from 'node:crypto';

export const PROTOCOL = '2025-11-25';
const INVALID_ORIGIN = 'https://mcp-conformance.invalid';

export async function startFixture(options = {}) {
  const sessions = new Set();
  const methods = [];
  const rpcMethods = [];
  const authValues = [];
  const initializeVersions = [];
  const server = http.createServer((req, res) => {
    void handle(req, res).catch((error) => {
      if (error?.code === 'ECONNRESET' || error?.code === 'ABORT_ERR' || error?.message === 'aborted') return;
      if (!res.headersSent && !res.destroyed) send(res, 500, { error: 'fixture failure' });
    });
  });

  const shapeRpc = (method, body) => {
    const shaped = { ...body };
    if (options.wrongIdMethod === method) shaped.id = 999;
    if (options.badJsonrpcMethod === method) shaped.jsonrpc = '1.0';
    if (options.omitJsonrpcMethod === method) delete shaped.jsonrpc;
    return shaped;
  };

  const sendRpc = (res, status, body, extra = {}) => {
    if (options.sseResponses && status === 200 && body?.jsonrpc === '2.0' && body?.id !== undefined) {
      res.writeHead(200, { 'content-type': 'text/event-stream', ...extra });
      if (options.ssePrelude) res.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: { progress: 0.5 } })}\n\n`);
      return res.end(`event: message\ndata: ${JSON.stringify(body)}\n\n`);
    }
    return send(res, status, body, extra);
  };

  async function handle(req, res) {
    methods.push(req.method);
    if (req.headers.authorization) authValues.push(req.headers.authorization);
    if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    if (options.redirect && req.method === 'POST') { res.writeHead(302, { location: 'https://example.invalid/escaped' }); return res.end(); }

    const invalidOrigin = req.headers.origin === INVALID_ORIGIN;
    const sessionId = req.headers['mcp-session-id'];

    if (req.method === 'GET') {
      if (invalidOrigin && !options.acceptInvalidOriginAfterInitialize) return send(res, 403, { error: 'origin' });
      if (options.getSse) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        return res.end(': fixture stream\n\n');
      }
      res.writeHead(405, { allow: 'POST, DELETE' });
      return res.end();
    }

    if (req.method === 'DELETE') {
      if (invalidOrigin) return send(res, 403, { error: 'origin' });
      if (!sessionId || !sessions.has(sessionId)) return send(res, 404, { error: 'missing' });
      if (!options.retainSessionAfterDelete) sessions.delete(sessionId);
      res.writeHead(204);
      return res.end();
    }

    if (req.method !== 'POST') return send(res, 405, { error: 'method' });
    let body = '';
    for await (const chunk of req) body += chunk;
    const msg = JSON.parse(body);
    if (typeof msg?.method === 'string') rpcMethods.push(msg.method);

    if (invalidOrigin) {
      if (options.acceptInvalidOrigin) {
        return sendRpc(res, 200, shapeRpc(msg.method, { jsonrpc: '2.0', id: msg.id ?? null, result: {} }));
      }
      if (!(options.acceptInvalidOriginAfterInitialize && msg.method !== 'initialize')) {
        return send(res, 403, { error: 'origin' });
      }
    }

    if (msg.method === 'initialize') {
      initializeVersions.push(msg.params?.protocolVersion);
      const id = options.noSession ? null : (options.sessionId ?? randomUUID());
      if (id) sessions.add(id);
      const defaultCapabilities = {
        ...(options.noToolsCapability ? {} : { tools: {} }),
        ...(options.noResourcesCapability ? {} : { resources: {} }),
      };
      const capabilities = options.capabilitiesOverride ?? defaultCapabilities;
      const result = {
        protocolVersion: options.protocolVersion ?? PROTOCOL,
        ...(options.omitCapabilities ? {} : { capabilities }),
        ...(options.omitServerInfo ? {} : { serverInfo: { name: 'fixture', version: '1' } }),
      };
      return sendRpc(res, 200, shapeRpc(msg.method, { jsonrpc: '2.0', id: msg.id, result }), id ? { 'mcp-session-id': id } : {});
    }

    if (!options.noSession && (!sessionId || !sessions.has(sessionId))) {
      return send(res, 404, { jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32001, message: 'Unknown session' } });
    }

    if (req.headers['mcp-protocol-version'] !== PROTOCOL) {
      const status = options.wrongProtocolStatus ?? 400;
      if (status === 200) return sendRpc(res, 200, shapeRpc(msg.method, { jsonrpc: '2.0', id: msg.id ?? null, result: {} }));
      return send(res, status, { jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32002, message: 'wrong protocol' } });
    }

    if (msg.id === undefined) { res.writeHead(202); return res.end(); }
    if (msg.method === 'ping') return sendRpc(res, 200, shapeRpc(msg.method, { jsonrpc: '2.0', id: msg.id, result: {} }));
    if (msg.method === 'tools/list') {
      if (options.oversized) return sendRpc(res, 200, shapeRpc(msg.method, { jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'safe_probe_fixture', description: 'x'.repeat(options.oversized) }] } }));
      return sendRpc(res, 200, shapeRpc(msg.method, { jsonrpc: '2.0', id: msg.id, result: { tools: options.emptyTools ? [] : [{ name: 'safe_probe_fixture' }] } }));
    }
    if (msg.method === 'resources/list') return sendRpc(res, 200, shapeRpc(msg.method, { jsonrpc: '2.0', id: msg.id, result: { resources: [{ uri: 'ui://fixture' }] } }));
    if (msg.method === 'tools/call') return send(res, 500, { error: 'probe must never call tools' });
    const code = options.unknownMethodCode ?? -32601;
    const message = options.echoAuthInError ? `nope ${req.headers.authorization}` : 'method not found';
    return sendRpc(res, 200, shapeRpc(msg.method, { jsonrpc: '2.0', id: msg.id, error: { code, message } }));
  }

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}/mcp`;
  return { endpoint, methods, rpcMethods, authValues, initializeVersions, close: () => new Promise((resolve) => server.close(resolve)) };
}

function send(res, status, body, extra = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...extra });
  res.end(JSON.stringify(body));
}
