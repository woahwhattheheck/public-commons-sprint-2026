// MIT. Private loopback operator surface for the original Stellar RPC merchant.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createRpcWorkspace, WorkspaceError, publicIssue } from './model.mjs';

const ASSETS = new Map([['/', ['index.html','text/html']],
  ['/app.mjs',['app.mjs','text/javascript']], ['/style.css',['style.css','text/css']]]);
const HEADERS = { 'cache-control':'no-store', 'x-content-type-options':'nosniff',
  'referrer-policy':'no-referrer', 'cross-origin-resource-policy':'same-origin',
  'content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" };
function send(res, status, value, type = 'application/json; charset=utf-8', headers = {}) {
  if (res.destroyed || res.writableEnded) return;
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
  res.writeHead(status, { ...HEADERS, 'content-type':type, 'content-length':bytes.length, ...headers });
  res.end(bytes);
}
async function body(req, waiting) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? ''))
    throw new WorkspaceError('JSON_BODY_REQUIRED',415);
  const chunks = []; let length = 0;
  const timeout = setTimeout(() => req.destroy(),10000); waiting.add(req);
  try {
    for await (const part of req) {
      length += part.length;
      if (length > 270336) throw new WorkspaceError('REQUEST_TOO_LARGE',413);
      chunks.push(part);
    }
    const value = JSON.parse(new TextDecoder('utf-8',{ fatal:true }).decode(Buffer.concat(chunks)));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new WorkspaceError('JSON_OBJECT_REQUIRED');
    return value;
  } catch (cause) {
    if (cause instanceof WorkspaceError) throw cause;
    throw new WorkspaceError('INVALID_JSON');
  } finally { clearTimeout(timeout); waiting.delete(req); }
}
function params(url, allowed, required = []) {
  const keys = [...url.searchParams.keys()];
  if (new Set(keys).size !== keys.length || keys.some(key => !allowed.includes(key)) ||
      required.some(key => !keys.includes(key))) throw new WorkspaceError('INVALID_QUERY');
  return Object.fromEntries(url.searchParams);
}
function number(value) {
  if (!/^[1-9][0-9]{0,12}$/.test(value ?? '')) throw new WorkspaceError('INVALID_DRAFT_REVISION');
  return Number(value);
}
export async function startRpcWorkspace({ port = 8447, ...options } = {}) {
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new WorkspaceError('INVALID_LISTENER_PORT');
  const assets = new Map(await Promise.all([...ASSETS].map(async ([path,[name,type]]) =>
    [path,{ bytes:await readFile(new URL('./public/'+name,import.meta.url)),type:type+'; charset=utf-8' }])));
  const key = randomBytes(32).toString('hex'), waiting = new Set();
  let origin, model, closing = false, closePromise;
  const actions = new Map([['/api/save','save'],['/api/import','importPlan'],['/api/review','review'],
    ['/api/compare','compare'],['/api/prepare','prepare'],['/api/diagnose','diagnose'],
    ['/api/buyer','buyer'],['/api/start','start'],['/api/stop','stop']]);
  const server = createServer((req,res) => {
    Promise.resolve().then(async () => {
      if (closing || !model) throw new WorkspaceError('WORKSPACE_CLOSING',503);
      if (req.headers.host !== new URL(origin).host || req.headers.origin && req.headers.origin !== origin ||
          ['cross-site','same-site'].includes(req.headers['sec-fetch-site']))
        throw new WorkspaceError('WORKSPACE_ORIGIN_REQUIRED',403);
      if (typeof req.url !== 'string' || !req.url.startsWith('/') || req.url.startsWith('//') || req.url.length > 2048)
        throw new WorkspaceError('INVALID_REQUEST_TARGET',400);
      const url = new URL(req.url,origin), supplied = req.headers['x-rpc-workspace'];
      if (req.method === 'GET' && assets.has(url.pathname) && !url.search) {
        const asset = assets.get(url.pathname); return send(res,200,asset.bytes,asset.type);
      }
      if (typeof supplied !== 'string' || Buffer.byteLength(supplied) !== Buffer.byteLength(key) ||
          !timingSafeEqual(Buffer.from(supplied),Buffer.from(key)))
        throw new WorkspaceError('WORKSPACE_KEY_REQUIRED',401,'Open the complete private workspace URL printed by the launcher.');
      if (req.method === 'GET' && url.pathname === '/api/state' && !url.search) return send(res,200,model.state());
      if (req.method === 'GET' && url.pathname === '/api/runtime' && !url.search) return send(res,200,model.runtime());
      if (req.method === 'GET' && url.pathname === '/api/draft') {
        const { revision } = params(url,['revision'],['revision']); return send(res,200,model.draft(number(revision)));
      }
      if (req.method === 'GET' && url.pathname === '/api/actions') {
        const values = params(url,['before']); return send(res,200,model.actions(values));
      }
      if (req.method === 'GET' && url.pathname === '/api/artifact') {
        const values = params(url,['kind','id','name'],['kind','id']), artifact = await model.artifact(values);
        return send(res,200,artifact.bytes,'application/octet-stream',
          { 'content-disposition':'attachment; filename="'+artifact.name+'"' });
      }
      if (req.method === 'POST' && actions.has(url.pathname) && !url.search)
        return send(res,200,await model[actions.get(url.pathname)](await body(req,waiting)));
      throw new WorkspaceError('WORKSPACE_ROUTE_NOT_FOUND',404);
    }).catch(cause => {
      const issue = publicIssue(cause);
      if (!res.headersSent) send(res,issue.status,issue); else res.destroy();
    });
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.keepAliveTimeout = 1500;
  await new Promise((done,fail) => {
    server.once('error',fail);
    server.listen(port,'127.0.0.1',() => { server.removeListener('error',fail); done(); });
  });
  origin = 'http://127.0.0.1:'+server.address().port;
  try { model = await createRpcWorkspace({ ...options, navigationOrigin: origin }); }
  catch (cause) { server.closeAllConnections(); await new Promise(done => server.close(done)); throw cause; }
  return { origin, url:origin+'/#key='+key, model,
    close() {
      if (closePromise) return closePromise;
      closing = true;
      for (const req of waiting) req.destroy();
      const listenerClosed = new Promise(done => server.close(done)); server.closeIdleConnections();
      return closePromise = model.close().finally(() => listenerClosed);
    },
  };
}
