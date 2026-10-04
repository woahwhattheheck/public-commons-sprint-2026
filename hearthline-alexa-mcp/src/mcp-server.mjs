import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { APP_MIME, APP_URI, dashboardHtml } from './app-resource.mjs';
import { callTool, listTools } from './tools.mjs';

export const PROTOCOL_VERSION = '2025-11-25';
const MAX_BODY = 1_000_000;
const SERVER_INFO = Object.freeze({ name: 'Hearthline Household Mission MCP', version: '0.1.0' });
const SERVER_CAPABILITIES = Object.freeze({ tools: { listChanged: false }, resources: { subscribe: false, listChanged: false } });
const DEFAULT_SCOPES = Object.freeze(['mcp:service', 'mcp:tools', 'mcp:resources']);

export function jsonRpcResult(id, result) { return { jsonrpc: '2.0', id, result }; }
export function jsonRpcError(id, code, message, data) { return { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } }; }
export function protocolError(code, message, data) { return Object.assign(new Error(message), { jsonRpcCode: code, jsonRpcData: data }); }

function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function hasOwn(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }
function isRequestId(value) { return typeof value === 'string' || (typeof value === 'number' && Number.isInteger(value)); }
function nonEmptyString(value) { return typeof value === 'string' && value.length > 0; }
function requestIdKey(value) { return `${typeof value}:${String(value)}`; }
function isNotificationCandidate(value) { return isRecord(value) && value.jsonrpc === '2.0' && typeof value.method === 'string' && !hasOwn(value, 'id'); }

export function validateMcpMessage(message) {
  if (!isRecord(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') throw protocolError(-32600, 'Invalid Request');
  if (message.id !== undefined && !isRequestId(message.id)) throw protocolError(-32600, 'Invalid Request: id must be a string or integer');
  if (message.params !== undefined && !isRecord(message.params)) throw protocolError(-32602, 'params must be an object');
  return message;
}

export function createInitializeResult(params) {
  if (!isRecord(params)) throw protocolError(-32602, 'initialize requires params');
  if (!nonEmptyString(params.protocolVersion)) throw protocolError(-32602, 'initialize requires protocolVersion');
  if (!isRecord(params.capabilities)) throw protocolError(-32602, 'initialize requires capabilities object');
  if (!isRecord(params.clientInfo) || !nonEmptyString(params.clientInfo.name) || !nonEmptyString(params.clientInfo.version)) {
    throw protocolError(-32602, 'initialize requires clientInfo.name and clientInfo.version');
  }
  return {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: SERVER_CAPABILITIES,
    serverInfo: SERVER_INFO,
    instructions: 'Use Hearthline to build stateful household missions. External-commit actions require explicit approval, then idempotent execution. Shopping demo actions never place purchases.',
  };
}

function canonicalHttpsUrl(value, field) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${field} must be a valid URL`); }
  if (url.protocol !== 'https:') throw new Error(`${field} must use https`);
  if (url.username || url.password || url.hash) throw new Error(`${field} must not contain credentials or a fragment`);
  return url.href;
}

function normalizeScopeMap(value, field) {
  if (value === undefined) return Object.freeze(Object.create(null));
  if (!isRecord(value)) throw new Error(`${field} must be an object`);
  const out = Object.create(null);
  for (const [key, scopes] of Object.entries(value)) {
    if (!nonEmptyString(key) || !Array.isArray(scopes) || scopes.length === 0 || !scopes.every(nonEmptyString)) throw new Error(`${field} values must be non-empty scope arrays`);
    Object.defineProperty(out, key, { value: Object.freeze([...new Set(scopes)]), enumerable: true, writable: false, configurable: false });
  }
  return Object.freeze(out);
}

export function normalizeAuthConfig(auth) {
  if (auth == null) return null;
  if (!isRecord(auth)) throw new Error('auth must be an object');
  if (!nonEmptyString(auth.resource)) throw new Error('auth.resource must be a canonical MCP resource URI');
  if (!Array.isArray(auth.authorizationServers) || auth.authorizationServers.length === 0 || !auth.authorizationServers.every(nonEmptyString)) throw new Error('auth.authorizationServers must contain at least one URI');
  if (auth.scopesSupported !== undefined && (!Array.isArray(auth.scopesSupported) || auth.scopesSupported.length === 0 || !auth.scopesSupported.every(nonEmptyString))) throw new Error('auth.scopesSupported must be a non-empty array of strings');
  if (typeof auth.verifyBearerToken !== 'function') throw new Error('auth.verifyBearerToken must be a function');
  const resource = canonicalHttpsUrl(auth.resource, 'auth.resource');
  const authorizationServers = Object.freeze(auth.authorizationServers.map((value) => canonicalHttpsUrl(value, 'auth.authorizationServers')));
  const scopesSupported = Object.freeze([...(auth.scopesSupported ?? DEFAULT_SCOPES)]);
  return Object.freeze({
    resource,
    authorizationServers,
    scopesSupported,
    verifyBearerToken: auth.verifyBearerToken,
    toolScopes: normalizeScopeMap(auth.toolScopes, 'auth.toolScopes'),
    resourceScopes: normalizeScopeMap(auth.resourceScopes, 'auth.resourceScopes'),
  });
}

export function protectedResourceMetadata(auth) {
  const config = normalizeAuthConfig(auth);
  if (!config) throw new Error('auth configuration required');
  return { resource: config.resource, authorization_servers: [...config.authorizationServers], scopes_supported: [...config.scopesSupported] };
}

function normalizeAuthContext(raw, auth) {
  if (!isRecord(raw)) throw new Error('bearer verifier must return an authorization context object');
  if (!nonEmptyString(raw.actorId) || raw.actorId.length > 512) throw new Error('authorization context actorId required');
  if (!nonEmptyString(raw.issuer) || raw.issuer.length > 2048) throw new Error('authorization context issuer required');
  if (raw.subject !== undefined && (!nonEmptyString(raw.subject) || raw.subject.length > 512)) throw new Error('authorization context subject invalid');
  if (!Array.isArray(raw.scopes) || !raw.scopes.every(nonEmptyString)) throw new Error('authorization context scopes must be an array');
  if (raw.resource !== auth.resource) throw new Error('authorization context resource mismatch');
  const scopeSet = new Set(raw.scopes);
  for (const scope of scopeSet) if (!auth.scopesSupported.includes(scope)) throw new Error(`authorization context contains unsupported scope: ${scope}`);
  const context = {
    actorId: raw.actorId,
    issuer: canonicalHttpsUrl(raw.issuer, 'authorization context issuer'),
    scopes: Object.freeze([...scopeSet]),
    resource: raw.resource,
  };
  if (raw.subject !== undefined) context.subject = raw.subject;
  if (raw.grantType !== undefined) {
    if (!nonEmptyString(raw.grantType) || raw.grantType.length > 128) throw new Error('authorization context grantType invalid');
    context.grantType = raw.grantType;
  }
  return Object.freeze(context);
}

async function authenticate(req, auth) {
  if (!auth) return null;
  const authorization = header(req, 'authorization');
  if (!authorization || !authorization.startsWith('Bearer ')) return undefined;
  const token = authorization.slice('Bearer '.length).trim();
  if (!token) return undefined;
  try {
    const verified = await auth.verifyBearerToken(token, Object.freeze({ resource: auth.resource }));
    if (!verified) return undefined;
    return normalizeAuthContext(verified, auth);
  } catch {
    return undefined;
  }
}

function requiredScopes(method, params, auth) {
  switch (method) {
    case 'initialize': return ['mcp:service', 'mcp:tools', 'mcp:resources'];
    case 'ping': return ['mcp:service', 'mcp:tools', 'mcp:resources'];
    case 'notifications/initialized': return ['mcp:service', 'mcp:tools', 'mcp:resources'];
    case 'tools/list': return ['mcp:service', 'mcp:tools'];
    case 'tools/call': return hasOwn(auth.toolScopes, params?.name) ? auth.toolScopes[params.name] : ['mcp:tools'];
    case 'resources/list': return ['mcp:service', 'mcp:resources'];
    case 'resources/read': return hasOwn(auth.resourceScopes, params?.uri) ? auth.resourceScopes[params.uri] : ['mcp:resources'];
    default: return ['mcp:service', 'mcp:tools', 'mcp:resources'];
  }
}

function hasAnyScope(context, required) { return required.some((scope) => context.scopes.includes(scope)); }
function authorizationDecision(context, method, params, auth) {
  if (!auth) return Object.freeze({ ok: true, requiredScopes: [] });
  const required = requiredScopes(method, params, auth);
  return Object.freeze({ ok: hasAnyScope(context, required), requiredScopes: Object.freeze([...required]) });
}
function requiresUserSubject(method) { return method === 'tools/call' || method === 'resources/read'; }

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
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks))); } catch { throw Object.assign(new Error('invalid JSON'), { status: 400, jsonRpcCode: -32700 }); }
}

function header(req, name) { const value = req.headers[name]; return Array.isArray(value) ? value[0] : value; }
function validateProtocolHeader(req, session) {
  const protocol = header(req, 'mcp-protocol-version');
  if (protocol !== session.protocolVersion) throw Object.assign(protocolError(-32002, `MCP-Protocol-Version must be ${session.protocolVersion}`), { status: 400 });
}
function assertFreshRequestId(session, id) {
  const key = requestIdKey(id);
  if (session.seenRequestIds.has(key)) throw protocolError(-32600, 'request id already used in this MCP session');
  session.seenRequestIds.add(key);
}
function authError(message) { return Object.assign(protocolError(-32004, message), { status: 403 }); }
function assertSessionActor(session, authContext) {
  if (session.authActorId !== authContext.actorId || session.authIssuer !== authContext.issuer) throw authError('MCP session belongs to a different authenticated actor');
}
function sessionUserCandidate(session, authContext, { requireUser = false } = {}) {
  const incomingSubject = authContext.subject ?? null;
  if (session.authSubject !== null) {
    if (incomingSubject !== null && incomingSubject !== session.authSubject) throw authError('MCP session belongs to a different authenticated user');
    if (requireUser && incomingSubject === null) throw authError('MCP session requires its bound authenticated user');
    return null;
  }
  if (requireUser && incomingSubject === null) throw authError('user-authorized MCP operation requires an authenticated user subject');
  return requireUser ? incomingSubject : null;
}
function bindSessionUser(session, candidateSubject) {
  if (candidateSubject === null) return;
  if (session.authSubject === null) {
    session.authSubject = candidateSubject;
    return;
  }
  if (session.authSubject !== candidateSubject) throw authError('MCP session belongs to a different authenticated user');
}

export function createMcpHttpServer({ orchestrator, allowedOrigins = [], logger = console, sessionTtlMs = 30 * 60_000, auth = null }) {
  if (!Number.isFinite(sessionTtlMs) || sessionTtlMs <= 0) throw new Error('sessionTtlMs must be finite and > 0');
  const sessions = new Map(); const allow = new Set(allowedOrigins); const authConfig = normalizeAuthConfig(auth);
  const server = http.createServer(async (req, res) => {
    let rawMessage;
    let notification = false;
    try {
      pruneExpiredSessions(sessions, Date.now(), sessionTtlMs);
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/health' && req.method === 'GET') return sendJson(res, 200, { ok: true, protocolVersion: PROTOCOL_VERSION, sessions: sessions.size, auth: Boolean(authConfig) });
      if (url.pathname === '/.well-known/oauth-protected-resource' && req.method === 'GET') {
        if (!authConfig) return sendJson(res, 404, { error: 'not found' });
        return sendJson(res, 200, protectedResourceMetadata(authConfig));
      }
      if (url.pathname !== '/mcp') return sendJson(res, 404, { error: 'not found' });
      if (!isAllowedOrigin(req.headers.origin, allow)) return sendRpc(res, 403, jsonRpcError(null, -32000, 'origin not allowed'));
      const authContext = await authenticate(req, authConfig);
      if (authConfig && authContext === undefined) return sendUnauthorized(res);
      if (req.method === 'GET') {
        const sessionId = header(req, 'mcp-session-id');
        if (sessionId) {
          const session = sessions.get(sessionId);
          if (!session) return sendRpc(res, 404, jsonRpcError(null, -32001, 'Unknown or expired MCP session'));
          validateProtocolHeader(req, session);
          if (authConfig) {
            assertSessionActor(session, authContext);
            sessionUserCandidate(session, authContext, { requireUser: session.authSubject !== null });
          }
        }
        res.writeHead(405, { Allow: 'POST, DELETE', 'Cache-Control': 'no-store' });
        return res.end();
      }
      if (req.method === 'DELETE') {
        const sessionId = header(req, 'mcp-session-id');
        if (!sessionId) return sendRpc(res, 400, jsonRpcError(null, -32001, 'MCP-Session-Id required'));
        const session = sessions.get(sessionId);
        if (!session) return sendRpc(res, 404, jsonRpcError(null, -32001, 'Unknown or expired MCP session'));
        validateProtocolHeader(req, session);
        if (authConfig) {
          assertSessionActor(session, authContext);
          sessionUserCandidate(session, authContext, { requireUser: session.authSubject !== null });
        }
        sessions.delete(sessionId); res.writeHead(204, { 'Cache-Control': 'no-store' }); return res.end();
      }
      if (req.method !== 'POST') { res.writeHead(405, { Allow: 'GET, POST, DELETE' }); return res.end(); }
      const accept = String(req.headers.accept ?? '').toLowerCase();
      if (!accept.includes('application/json') || !accept.includes('text/event-stream')) return sendRpc(res, 406, jsonRpcError(null, -32000, 'Accept must include application/json and text/event-stream'));
      rawMessage = await readJson(req);
      notification = isNotificationCandidate(rawMessage);
      let message;
      try { message = validateMcpMessage(rawMessage); }
      catch (error) { if (notification) return sendEmpty(res, Number(error?.status ?? 202)); throw error; }
      const isInitialize = message.method === 'initialize';
      let sessionId = header(req, 'mcp-session-id');
      if (isInitialize) {
        if (message.id === undefined) return sendEmpty(res, 400);
        if (sessionId) return sendRpc(res, 400, jsonRpcError(message.id, -32600, 'initialize must not reuse an MCP session'));
        if (authConfig) {
          const decision = authorizationDecision(authContext, message.method, message.params ?? {}, authConfig);
          if (!decision.ok) return sendForbidden(res, message.id, decision.requiredScopes);
        }
        let result;
        try { result = createInitializeResult(message.params); }
        catch (error) { return sendRpc(res, 200, errorBody(message.id, error)); }
        sessionId = randomUUID();
        const seenRequestIds = new Set([requestIdKey(message.id)]);
        sessions.set(sessionId, {
          createdAt: Date.now(),
          lastSeenAt: Date.now(),
          initialized: false,
          protocolVersion: result.protocolVersion,
          toolCalls: [],
          seenRequestIds,
          authActorId: authConfig ? authContext.actorId : null,
          authIssuer: authConfig ? authContext.issuer : null,
          authSubject: authConfig ? (authContext.subject ?? null) : null,
        });
        return sendRpc(res, 200, jsonRpcResult(message.id, result), sessionId);
      }

      if (!sessionId) return notification ? sendEmpty(res, 400) : sendRpc(res, 400, jsonRpcError(message.id, -32001, 'MCP-Session-Id required'));
      const session = sessions.get(sessionId);
      if (!session) return notification ? sendEmpty(res, 404) : sendRpc(res, 404, jsonRpcError(message.id, -32001, 'Unknown or expired MCP session'));
      validateProtocolHeader(req, session);
      let pendingUserSubject = null;
      if (authConfig) {
        try {
          assertSessionActor(session, authContext);
          const decision = authorizationDecision(authContext, message.method, message.params ?? {}, authConfig);
          if (!decision.ok) return notification ? sendEmpty(res, 403, sessionId) : sendForbidden(res, message.id, decision.requiredScopes, sessionId);
          pendingUserSubject = sessionUserCandidate(session, authContext, { requireUser: requiresUserSubject(message.method) });
        } catch (error) {
          return notification ? sendEmpty(res, 403, sessionId) : sendRpc(res, 403, errorBody(message.id, error), sessionId);
        }
      }
      session.lastSeenAt = Date.now();

      if (message.id === undefined) {
        if (message.method === 'notifications/initialized') session.initialized = true;
        else if (!session.initialized) logger.error?.('mcp notification rejected before initialized', { method: message.method });
        return sendEmpty(res, 202, sessionId);
      }
      try { assertFreshRequestId(session, message.id); }
      catch (error) { return sendRpc(res, 200, errorBody(message.id, error), sessionId); }
      if (message.method !== 'ping' && !session.initialized) return sendRpc(res, 400, jsonRpcError(message.id, -32003, 'session not initialized; send notifications/initialized first'), sessionId);
      try {
        prepareMcpMethod(message.method, message.params ?? {}, session);
        bindSessionUser(session, pendingUserSubject);
        return sendRpc(res, 200, jsonRpcResult(message.id, await executeMcpMethod(message.method, message.params ?? {}, orchestrator, session, authContext)), sessionId);
      } catch (error) {
        logger.error?.('mcp method error', { method: message.method, error: error?.message });
        return sendRpc(res, 200, errorBody(message.id, error), sessionId);
      }
    } catch (error) {
      const status = Number(error?.status ?? (Number.isInteger(error?.jsonRpcCode) ? 400 : 500));
      logger.error?.('mcp transport error', { error: error?.message, status });
      if (notification) return sendEmpty(res, status);
      const code = Number.isInteger(error?.jsonRpcCode) ? error.jsonRpcCode : status === 400 ? -32700 : -32603;
      return sendRpc(res, status, jsonRpcError(null, code, error?.message ?? 'transport failure', error?.jsonRpcData));
    }
  });
  return server;
}

function prepareMcpMethod(method, params, session) {
  switch (method) {
    case 'ping': return;
    case 'tools/list':
      if (params?.cursor !== undefined && typeof params.cursor !== 'string') throw protocolError(-32602, 'tools/list cursor must be a string');
      return;
    case 'tools/call':
      if (!nonEmptyString(params?.name)) throw protocolError(-32602, 'tools/call requires name');
      if (params.arguments !== undefined && !isRecord(params.arguments)) throw protocolError(-32602, 'tools/call arguments must be an object');
      if (!listTools().some((tool) => tool.name === params.name)) throw protocolError(-32602, `unknown tool: ${params.name}`);
      enforceToolRateLimit(session);
      return;
    case 'resources/list':
      if (params?.cursor !== undefined && typeof params.cursor !== 'string') throw protocolError(-32602, 'resources/list cursor must be a string');
      return;
    case 'resources/read':
      if (!nonEmptyString(params?.uri)) throw protocolError(-32602, 'resources/read requires uri');
      if (params.uri !== APP_URI) throw protocolError(-32002, 'Resource not found', { uri: params.uri });
      return;
    default: throw protocolError(-32601, `Method not found: ${method}`);
  }
}

async function executeMcpMethod(method, params, orchestrator, _session, _authContext = null) {
  switch (method) {
    case 'ping': return {};
    case 'tools/list': return { tools: listTools() };
    case 'tools/call': {
      try { return { ...(await callTool(orchestrator, params.name, params.arguments ?? {})), isError: false }; }
      catch (error) { return { content: [{ type: 'text', text: `Hearthline rejected the tool call: ${String(error?.message ?? 'execution failed').slice(0, 1000)}` }], isError: true }; }
    }
    case 'resources/list': return { resources: [{ uri: APP_URI, name: 'Hearthline Mission Dashboard', description: 'Interactive mission status and approval dashboard', mimeType: APP_MIME }] };
    case 'resources/read': return { contents: [{ uri: APP_URI, mimeType: APP_MIME, text: dashboardHtml(), _meta: { ui: { prefersBorder: true } } }] };
    default: throw protocolError(-32601, `Method not found: ${method}`);
  }
}

export async function dispatchMcpMethod(method, params, orchestrator, session, authContext = null) {
  prepareMcpMethod(method, params, session);
  return executeMcpMethod(method, params, orchestrator, session, authContext);
}

function errorBody(id, error) { return jsonRpcError(id, Number.isInteger(error?.jsonRpcCode) ? error.jsonRpcCode : -32603, error?.message ?? 'Internal error', error?.jsonRpcData); }
function pruneExpiredSessions(sessions, now, ttlMs) { for (const [id, session] of sessions) if (now - session.lastSeenAt > ttlMs) sessions.delete(id); }
function enforceToolRateLimit(session, now = Date.now()) { const windowStart = now - 60_000; session.toolCalls = session.toolCalls.filter((time) => time >= windowStart); if (session.toolCalls.length >= 120) throw protocolError(-32000, 'tool rate limit exceeded; retry after the current one-minute window'); session.toolCalls.push(now); }
function sendRpc(res, status, body, sessionId) { const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }; if (sessionId) headers['MCP-Session-Id'] = sessionId; res.writeHead(status, headers); res.end(JSON.stringify(body)); }
function sendJson(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); }
function sendEmpty(res, status, sessionId) { const headers = { 'Cache-Control': 'no-store' }; if (sessionId) headers['MCP-Session-Id'] = sessionId; res.writeHead(status, headers); res.end(); }
function sendUnauthorized(res) { res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ error: 'unauthorized', message: 'Bearer access token required' })); }
function sendForbidden(res, id, requiredScopes, sessionId) { return sendRpc(res, 403, jsonRpcError(id, -32004, 'insufficient authorization scope', { requiredScopes }), sessionId); }