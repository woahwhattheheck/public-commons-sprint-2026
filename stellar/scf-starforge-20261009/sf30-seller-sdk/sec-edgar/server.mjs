// MIT. Private SEC operator listener. Buyer traffic uses the original seller listener.
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { openEdgarWorkspace } from './workspace.mjs';

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);
const POLICY = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
const failure = (status, code, message) => Object.assign(new Error(message), { status, code });
const equal = (left, right) => typeof left === 'string' && typeof right === 'string' &&
  Buffer.byteLength(left) === Buffer.byteLength(right) && timingSafeEqual(Buffer.from(left), Buffer.from(right));
const token = () => randomBytes(32).toString('base64url');

async function bytes(req, limit) {
  const declared = req.headers['content-length'];
  if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > limit))
    throw failure(413, 'EDGAR_UPLOAD_TOO_LARGE', 'This upload exceeds the workspace limit.');
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw failure(413, 'EDGAR_UPLOAD_TOO_LARGE', 'This upload exceeds the workspace limit.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}
async function body(req, limit = 2 * 1024 * 1024) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? ''))
    throw failure(415, 'EDGAR_JSON_REQUIRED', 'Send this action as JSON.');
  let value;
  try { value = JSON.parse((await bytes(req, limit)).toString('utf8')); }
  catch (cause) { if (cause.status) throw cause; throw failure(400, 'EDGAR_JSON_INVALID', 'The JSON could not be read.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure(400, 'EDGAR_JSON_REQUIRED', 'Send a JSON object.');
  return value;
}
function identifier(encoded) {
  let id;
  try { id = decodeURIComponent(encoded); } catch { throw failure(400, 'EDGAR_ID_INVALID', 'The capture identifier is invalid.'); }
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(id)) throw failure(400, 'EDGAR_ID_INVALID', 'The capture identifier is invalid.');
  return id;
}

/** Start a loopback operator desk; the returned fragment opens its private session. */
export async function startEdgarWorkspace({ directory, storeDirectory, workspace = null, port = 0,
  host = '127.0.0.1', workspaceKey = null, maxCaptureBytes = 32 * 1024 * 1024 } = {}) {
  if (!['127.0.0.1', '::1', 'localhost'].includes(host)) throw failure(400, 'EDGAR_OPERATOR_LOOPBACK_REQUIRED', 'The operator workspace listens on loopback.');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw failure(400, 'EDGAR_PORT_INVALID', 'Port must be 0–65535.');
  if (!Number.isSafeInteger(maxCaptureBytes) || maxCaptureBytes < 1024 || maxCaptureBytes > 32 * 1024 * 1024)
    throw failure(400, 'EDGAR_UPLOAD_LIMIT_INVALID', 'Capture limit must be between 1 KiB and 32 MiB.');
  if (workspaceKey !== null && (typeof workspaceKey !== 'string' || workspaceKey.length < 32 || workspaceKey.length > 200 || /[\s\x00-\x1f]/.test(workspaceKey)))
    throw failure(400, 'EDGAR_WORKSPACE_KEY_INVALID', 'The workspace key must be at least 32 non-whitespace characters.');
  const ownsWorkspace = workspace === null;
  workspace ??= await openEdgarWorkspace(directory, { storeDirectory });
  const access = workspaceKey ?? token(), session = token();
  const staticFiles = new Map();
  let origin, cookieName, hosts = new Set(), origins = new Set(), closing;
  const reply = (req, res, status, data, type = 'application/json; charset=utf-8', extra = {}) => {
    if (res.destroyed || res.writableEnded) return;
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(typeof data === 'string' ? data : JSON.stringify(data));
    res.writeHead(status, { 'content-type': type, 'content-length': String(raw.length), 'cache-control': 'no-store',
      'x-content-type-options': 'nosniff', 'content-security-policy': POLICY, 'referrer-policy': 'no-referrer',
      'cross-origin-resource-policy': 'same-origin', ...extra });
    res.end(req.method === 'HEAD' ? undefined : raw);
  };
  const authenticated = req => {
    if (equal(req.headers.authorization, 'Bearer ' + access)) return true;
    return (req.headers.cookie ?? '').split(';').some(part => {
      const entry = part.trim(); return entry.startsWith(cookieName + '=') && equal(entry.slice(cookieName.length + 1), session);
    });
  };
  const server = createServer(async (req, res) => {
    try {
      if (!hosts.has(req.headers.host) || (req.headers.origin && !origins.has(req.headers.origin)) ||
          ['cross-site', 'same-site'].includes(req.headers['sec-fetch-site']))
        throw failure(403, 'EDGAR_OPERATOR_ORIGIN_REQUIRED', 'Open the local operator workspace URL.');
      const url = new URL(req.url, origin), path = url.pathname;
      if (path === '/api/session' && req.method === 'POST') {
        const input = await body(req, 1024);
        if (!equal(input.key, access)) throw failure(401, 'EDGAR_SESSION_REQUIRED', 'Open the authorized workspace link.');
        return reply(req, res, 200, { connected: true }, undefined,
          { 'set-cookie': cookieName + '=' + session + '; HttpOnly; SameSite=Strict; Path=/' });
      }
      const asset = staticFiles.get(path);
      if (asset && ['GET', 'HEAD'].includes(req.method)) return reply(req, res, 200, asset.bytes, asset.type);
      if (!path.startsWith('/api/')) throw failure(404, 'EDGAR_ROUTE_NOT_FOUND', 'This workspace page does not exist.');
      if (!authenticated(req)) throw failure(401, 'EDGAR_SESSION_REQUIRED', 'Open the authorized workspace link.');
      if (path === '/api/session' && req.method === 'DELETE')
        return reply(req, res, 200, { connected: false }, undefined, { 'set-cookie': cookieName + '=; Max-Age=0; HttpOnly; SameSite=Strict; Path=/' });
      if (path === '/api/state' && req.method === 'GET') return reply(req, res, 200, await workspace.snapshot());
      if (path === '/api/draft' && req.method === 'PUT') return reply(req, res, 200, await workspace.saveDraft(await body(req)));
      if (path === '/api/revisions' && req.method === 'GET') return reply(req, res, 200, await workspace.listRevisions());
      if (path === '/api/restore' && req.method === 'POST') return reply(req, res, 200, await workspace.restoreRevision(await body(req)));
      if (path === '/api/query' && req.method === 'POST') {
        const result = await workspace.preview(await body(req));
        const headers = {};
        for (const name of ['x-data-provider', 'x-edgar-edition', 'x-edgar-source-sha256'])
          if (typeof result.headers?.[name] === 'string') headers[name] = result.headers[name];
        return reply(req, res, result.status ?? 200, result.body, undefined, headers);
      }
      if (path === '/api/import' && req.method === 'POST') {
        const allowed = new Set(['id', 'kind', 'cik', 'sourceUrl', 'capturedAt']);
        if ([...url.searchParams.keys()].some(key => !allowed.has(key)) || [...url.searchParams.keys()].length !== new Set(url.searchParams.keys()).size)
          throw failure(400, 'EDGAR_IMPORT_PARAMETERS', 'Capture metadata contains unsupported or repeated fields.');
        const meta = Object.fromEntries(url.searchParams);
        if (!meta.id || !meta.kind || !meta.cik || !meta.sourceUrl) throw failure(400, 'EDGAR_IMPORT_METADATA', 'Supply the edition, kind, CIK and original source URL.');
        const result = await workspace.importCapture({ ...meta, bytes: await bytes(req, maxCaptureBytes) });
        return reply(req, res, 201, result);
      }
      const selected = path.match(/^\/api\/editions\/([^/]+)(\/raw)?$/);
      if (selected && req.method === 'GET') {
        const id = identifier(selected[1]);
        if (!selected[2]) return reply(req, res, 200, await workspace.getEdition(id));
        return reply(req, res, 200, await workspace.readRaw(id), 'application/json; charset=utf-8',
          { 'content-disposition': 'attachment; filename="' + id.replace(/[^A-Za-z0-9._-]/g, '_') + '-source.json"' });
      }
      const download = path.match(/^\/api\/download\/(config|openapi|handoff)$/);
      if (download && req.method === 'GET') {
        const values = { config: () => workspace.exportConfig(), openapi: () => workspace.exportOpenApi(), handoff: () => workspace.buyerHandoff() };
        return reply(req, res, 200, JSON.stringify(await values[download[1]](), null, 2) + '\n', undefined,
          { 'content-disposition': 'attachment; filename="sec-edgar-' + download[1] + '.json"' });
      }
      throw failure(404, 'EDGAR_ROUTE_NOT_FOUND', 'This workspace action does not exist.');
    } catch (cause) {
      const proposed = Number(cause.status ?? cause.statusCode ?? cause.httpStatus);
      const status = proposed >= 400 && proposed <= 599 ? proposed : cause.code === 'ENOENT' ? 404 : 400;
      const code = /^[A-Z0-9_]{1,120}$/.test(cause.code ?? '') ? cause.code : 'EDGAR_OPERATION_FAILED';
      const message = status >= 500 || code === 'EDGAR_OPERATION_FAILED' ? 'The workspace could not complete this operation.' : cause.message;
      reply(req, res, status, { error: { code, message, ...(cause.currentRevision === undefined ? {} : { currentRevision: cause.currentRevision }) } });
    }
  });
  server.requestTimeout = 120000; server.headersTimeout = 15000; server.keepAliveTimeout = 2000;
  const close = () => closing ??= (async () => {
    try {
      if (server.listening) await new Promise((done, reject) => {
        server.close(cause => cause ? reject(cause) : done()); server.closeIdleConnections?.();
      });
    } finally { if (ownsWorkspace) await workspace.close(); }
  })();
  try {
    for (const [route, [name, type]] of assets) staticFiles.set(route, { bytes: await readFile(new URL('./public/' + name, import.meta.url)), type });
    await new Promise((done, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => { server.off('error', reject); done(); });
    });
    const assigned = server.address().port, authority = (host.includes(':') ? '[' + host + ']' : host) + ':' + assigned;
    origin = 'http://' + authority;
    hosts = new Set([authority, 'localhost:' + assigned, '127.0.0.1:' + assigned, '[::1]:' + assigned]);
    origins = new Set([...hosts].map(value => 'http://' + value));
    cookieName = 'sf_edgar_session_' + assigned;
    return { server, workspace, workspaceKey: access, origin, url: origin + '/#session=' + encodeURIComponent(access), close };
  } catch (cause) { await close().catch(() => {}); throw cause; }
}
