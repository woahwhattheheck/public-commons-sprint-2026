import http from 'node:http';
import { randomUUID } from 'node:crypto';

export const PROTOCOL = '2025-11-25';

export async function startFixture(options = {}) {
  const sessions = new Set();
  const methods = [];
  const rpcMethods = [];
  const authValues = [];
  const server = http.createServer((req, res) => {
    void handle(req, res).catch((error) => {
      if (error?.code === 'ECONNRESET' || error?.code === 'ABORT_ERR' || error?.message === 'aborted') return;
      if (!res.headersSent && !res.destroyed) send(res, 500, { error: 'fixture failure' });
    });
  });
  async function handle(req, res) {
    methods.push(req.method);
    if (req.headers.authorization) authValues.push(req.headers.authorization);
    if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    if (options.redirect && req.method === 'POST') { res.writeHead(302, { location: 'https://example.invalid/escaped' }); return res.end(); }
    if (req.headers.origin === 'https://mcp-conformance.invalid') { res.writeHead(options.acceptInvalidOrigin ? 200 : 403, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'origin' })); }
    if (req.method === 'GET') { res.writeHead(405, { allow: 'POST, DELETE' }); return res.end(); }
    const sessionId = req.headers['mcp-session-id'];
    if (req.method === 'DELETE') {
      if (!sessionId || !sessions.has(sessionId)) return send(res, 404, { error: 'missing' });
      sessions.delete(sessionId); res.writeHead(204); return res.end();
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'method' });
    let body = '';
    for await (const chunk of req) body += chunk;
    const msg = JSON.parse(body);
    if (typeof msg?.method === 'string') rpcMethods.push(msg.method);
    if (msg.method === 'initialize') {
      const id = randomUUID(); sessions.add(id);
      return send(res, 200, { jsonrpc: '2.0', id: msg.id, result: { protocolVersion: options.protocolVersion ?? PROTOCOL, capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'fixture', version: '1' } } }, { 'mcp-session-id': id });
    }
    if (!sessionId || !sessions.has(sessionId)) return send(res, 404, { jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32001, message: 'Unknown session' } });
    if (req.headers['mcp-protocol-version'] !== PROTOCOL) return send(res, 400, { jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32002, message: 'wrong protocol' } });
    if (msg.id === undefined) { res.writeHead(202); return res.end(); }
    if (msg.method === 'ping') return send(res, 200, { jsonrpc: '2.0', id: msg.id, result: {} });
    if (msg.method === 'tools/list') {
      if (options.oversized) return send(res, 200, { jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'safe_probe_fixture', description: 'x'.repeat(options.oversized) }] } });
      return send(res, 200, { jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'safe_probe_fixture' }] } });
    }
    if (msg.method === 'resources/list') return send(res, 200, { jsonrpc: '2.0', id: msg.id, result: { resources: [{ uri: 'ui://fixture' }] } });
    if (msg.method === 'tools/call') return send(res, 500, { error: 'probe must never call tools' });
    const code = options.unknownMethodCode ?? -32601;
    const message = options.echoAuthInError ? `nope ${req.headers.authorization}` : 'method not found';
    return send(res, 200, { jsonrpc: '2.0', id: msg.id, error: { code, message } });
  }
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}/mcp`;
  return { endpoint, methods, rpcMethods, authValues, close: () => new Promise((resolve) => server.close(resolve)) };
}

function send(res, status, body, extra = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...extra });
  res.end(JSON.stringify(body));
}
