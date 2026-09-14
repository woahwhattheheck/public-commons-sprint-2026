import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { APP_MIME, APP_URI, dashboardHtml } from './app-resource.mjs';
import { callTool, listTools } from './tools.mjs';

export const PROTOCOL_VERSION = '2025-11-25';
const MAX_BODY = 1_000_000;

function jsonRpcResult(id, result) { return { jsonrpc: '2.0', id, result }; }
function jsonRpcError(id, code, message, data) { return { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } }; }
function validRequestId(id) { return typeof id === 'string' || (typeof id === 'number' && Number.isInteger(id)); }

function isAllowedOrigin(origin, allowedOrigins) {
  if (!origin) return true;
  if (allowedOrigins.has(origin)) return true;
  try { const url = new URL(origin); return (url.hostname === '127.0.0.1' || url.hostname === 'localhost') && (url.protocol === 'http:' || url.protocol === 'https:'); }
  catch { return false; }
}

async function readJson(req) {
  let bytes = 0; const chunks = [];
  for await (const chunk of req) { bytes += chunk.length; if (bytes > MAX_BODY) throw Object.assign(new Error('request body too large'), { status: 413 }); chunks.push(chunk); }
  if (bytes === 0) throw Object.assign(new Error('empty request body'), { status: 400 });
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('invalid JSON'), { status: 400 }); }
}

export function createMcpHttpServer({ orchestrator, allowedOrigins = [], logger = console, sessionTtlMs = 30 * 60_000 }) {
  if (!Number.isFinite(sessionTtlMs) || sessionTtlMs <= 0) throw new Error('sessionTtlMs must be finite and > 0');
  const sessions = new Map(); const allow = new Set(allowedOrigins);
  const server = http.createServer(async (req, res) => {
    try {
      pruneExpiredSessions(sessions, Date.now(), sessionTtlMs);
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/health' && req.method === 'GET') return sendJson(res, 200, { ok: true, protocolVersion: PROTOCOL_VERSION, sessions: sessions.size });
      if (url.pathname !== '/mcp') return sendJson(res, 404, { error: 'not found' });
      if (!isAllowedOrigin(req.headers.origin, allow)) return sendJson(res, 403, { error: 'origin not allowed' });
      if (req.method === 'GET') { res.writeHead(405, { Allow: 'POST, DELETE', 'Cache-Control': 'no-store' }); return res.end(); }
      if (req.method === 'DELETE') {
        const sessionId = req.headers['mcp-session-id'];
        if (!sessionId) return sendRpc(res, 400, jsonRpcError(null, -32001, 'MCP-Session-Id is required'));
        if (!sessions.has(sessionId)) return sendRpc(res, 404, jsonRpcError(null, -32001, 'Unknown or expired MCP session'));
        const protocol = req.headers['mcp-protocol-version'];
        if (protocol !== PROTOCOL_VERSION) return sendRpc(res, 400, jsonRpcError(null, -32002, `MCP-Protocol-Version must be ${PROTOCOL_VERSION}`), sessionId);
        sessions.delete(sessionId);
        res.writeHead(204, { 'Cache-Control': 'no-store' });
        return res.end();
      }
      if (req.method !== 'POST') { res.writeHead(405, { Allow: 'GET, POST, DELETE' }); return res.end(); }
      const accept = String(req.headers.accept ?? '');
      if (!accept.includes('application/json') || !accept.includes('text/event-stream')) return sendRpc(res, 406, jsonRpcError(null, -32000, 'Accept must include application/json and text/event-stream'));
      const message = await readJson(req);
      if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return sendRpc(res, 400, jsonRpcError(message?.id, -32600, 'Invalid Request'));
      if (Object.prototype.hasOwnProperty.call(message, 'id') && !validRequestId(message.id)) return sendRpc(res, 400, jsonRpcError(null, -32600, 'Invalid Request: id must be a string or integer'));
      const isInitialize = message.method === 'initialize';
      if (isInitialize && message.id === undefined) return sendRpc(res, 400, jsonRpcError(null, -32600, 'initialize must be a JSON-RPC request with an id'));
      let sessionId = req.headers['mcp-session-id'];
      if (isInitialize) {
        const requested = message.params?.protocolVersion;
        if (typeof requested !== 'string' || requested.length === 0) return sendRpc(res, 200, jsonRpcError(message.id, -32602, 'initialize requires protocolVersion'));
        sessionId = randomUUID(); sessions.set(sessionId, { createdAt: Date.now(), lastSeenAt: Date.now(), initialized: false, toolCalls: [] });
      }
      else {
        if (!sessionId) return sendRpc(res, 400, jsonRpcError(message.id, -32001, 'MCP-Session-Id is required'));
        if (!sessions.has(sessionId)) return sendRpc(res, 404, jsonRpcError(message.id, -32001, 'Unknown or expired MCP session'));
        const protocol = req.headers['mcp-protocol-version'];
        if (protocol !== PROTOCOL_VERSION) return sendRpc(res, 400, jsonRpcError(message.id, -32002, `MCP-Protocol-Version must be ${PROTOCOL_VERSION}`), sessionId);
        sessions.get(sessionId).lastSeenAt = Date.now();
      }
      if (message.id === undefined) { if (message.method === 'notifications/initialized' && sessions.has(sessionId)) sessions.get(sessionId).initialized = true; res.writeHead(202, { 'MCP-Session-Id': sessionId, 'Cache-Control': 'no-store' }); return res.end(); }
      if (!isInitialize && message.method !== 'ping' && !sessions.get(sessionId).initialized) return sendRpc(res, 400, jsonRpcError(message.id, -32003, 'session not initialized; send notifications/initialized first'), sessionId);
      let result;
      try { result = await dispatch(message.method, message.params ?? {}, orchestrator, sessions, sessionId); }
      catch (error) { logger.error?.('mcp method error', { method: message.method, error: error?.message }); return sendRpc(res, 200, jsonRpcError(message.id, error?.jsonRpcCode ?? -32010, error?.message ?? 'method execution failed'), sessionId); }
      return sendRpc(res, 200, jsonRpcResult(message.id, result), sessionId);
    } catch (error) { const status = Number(error?.status ?? 500); logger.error?.('mcp transport error', { error: error?.message, status }); return sendRpc(res, status, jsonRpcError(null, status === 400 ? -32700 : -32000, error?.message ?? 'transport failure')); }
  });
  return server;
}

async function dispatch(method, params, orchestrator, sessions, sessionId) {
  switch (method) {
    case 'initialize': return { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false } }, serverInfo: { name: 'Hearthline Household Mission MCP', version: '0.1.0' }, instructions: 'Use Hearthline to build stateful household missions. External-commit actions require explicit approval, then idempotent execution. Shopping demo actions never place purchases.' };
    case 'ping': return {};
    case 'tools/list': return { tools: listTools() };
    case 'tools/call': {
      if (typeof params?.name !== 'string') throw protocolError(-32602, 'tools/call requires name');
      if (!listTools().some((tool) => tool.name === params.name)) throw protocolError(-32602, `unknown tool: ${params.name}`);
      enforceToolRateLimit(sessions.get(sessionId));
      try { return { ...(await callTool(orchestrator, params.name, params.arguments ?? {})), isError: false }; }
      catch (error) { return { content: [{ type: 'text', text: `Hearthline rejected the tool call: ${String(error?.message ?? 'execution failed').slice(0, 1000)}` }], isError: true }; }
    }
    case 'resources/list': return { resources: [{ uri: APP_URI, name: 'Hearthline Mission Dashboard', description: 'Interactive mission status and approval dashboard', mimeType: APP_MIME }] };
    case 'resources/read': if (params?.uri !== APP_URI) throw new Error('resource not found'); else return { contents: [{ uri: APP_URI, mimeType: APP_MIME, text: dashboardHtml(), _meta: { ui: { prefersBorder: true } } }] };
    default: throw protocolError(-32601, `method not found: ${method}`);
  }
}
function protocolError(code, message) { return Object.assign(new Error(message), { jsonRpcCode: code }); }
function pruneExpiredSessions(sessions, now, ttlMs) { for (const [id, session] of sessions) if (now - session.lastSeenAt > ttlMs) sessions.delete(id); }
function enforceToolRateLimit(session, now = Date.now()) { const windowStart = now - 60_000; session.toolCalls = session.toolCalls.filter((time) => time >= windowStart); if (session.toolCalls.length >= 120) throw new Error('tool rate limit exceeded; retry after the current one-minute window'); session.toolCalls.push(now); }
function sendRpc(res, status, body, sessionId) { const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }; if (sessionId) headers['MCP-Session-Id'] = sessionId; res.writeHead(status, headers); res.end(JSON.stringify(body)); }
function sendJson(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); }
