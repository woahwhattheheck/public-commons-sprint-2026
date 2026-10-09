#!/usr/bin/env node
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createWorkspace, restoreWorkspace, applyReview, exportReport} from './workspace.mjs';
const MAX_BODY = 2 * 1024 * 1024;
function respond(res, status, body, type='application/json; charset=utf-8') {
  const bytes = Buffer.from(type.startsWith('application/json') ? JSON.stringify(body) : body);
  res.writeHead(status, {'content-type':type, 'content-length':bytes.length, 'cache-control':'no-store',
    'x-content-type-options':'nosniff', 'content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"});
  res.end(bytes);
}
export function createWorkspaceServer() {
  return http.createServer(async(req,res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') return respond(res,200,{status:'ok',mode:'offline',model_requests:0});
      if (req.method === 'GET' && req.url === '/') return respond(res,200,await readFile(new URL('./workspace.html',import.meta.url),'utf8'),'text/html; charset=utf-8');
      const routes = new Set(['/api/workspace','/api/review','/api/report']);
      if (req.method !== 'POST' || !routes.has(req.url)) return respond(res,404,{error:'not found'});
      if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) return respond(res,415,{error:'send application/json'});
      // File-based local tool: reject cross-origin browser writes rather than accepting form posts.
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return respond(res,403,{error:'cross-origin request refused'});
      const chunks=[]; let size=0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY) return respond(res,413,{error:'workspace request exceeds 2 MiB'});
        chunks.push(chunk);
      }
      let input;
      try { input=JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return respond(res,400,{error:'invalid JSON'}); }
      try {
        if (req.url === '/api/workspace') return respond(res,200,input?.schema ? restoreWorkspace(input) : createWorkspace(input));
        if (req.url === '/api/review') return respond(res,200,applyReview(input?.workspace,input?.claim_id,input?.review));
        return respond(res,200,{markdown:exportReport(input)});
      } catch(error) { return respond(res,400,{error:error.message}); }
    } catch { if (!res.headersSent) respond(res,500,{error:'workspace request failed'}); else res.end(); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port=Number(process.env.PORT || 8788);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('PORT must be an integer from 1 to 65535');
  createWorkspaceServer().listen(port,'127.0.0.1',()=>console.log(`Review workspace: http://127.0.0.1:${port} (offline; no model calls)`));
}
