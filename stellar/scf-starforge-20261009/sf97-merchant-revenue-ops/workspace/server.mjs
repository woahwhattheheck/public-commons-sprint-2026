// MIT. Operator-local HTTP interface for the original merchant pricing workflow.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { openWorkspace, fault } from './model.mjs';

const POLICY = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
const REPORT_POLICY = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";

export async function startWorkspace({port = 8457, ...options} = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError('Port must be 0–65535.');
  const model = await openWorkspace(options), token = randomBytes(32).toString('hex');
  const assets = new Map(await Promise.all([
    ['/', 'index.html','text/html; charset=utf-8'],
    ['/browser.mjs','browser.mjs','text/javascript; charset=utf-8'],
    ['/style.css','style.css','text/css; charset=utf-8'],
  ].map(async ([path,name,type]) => [path,{type,bytes:await readFile(new URL(name,import.meta.url))}])));
  let hosts = new Set(), origins = new Set();
  const server = createServer((req,res) => {
    function reply(status,type,data,extra = {}) {
      if (res.destroyed) return;
      const bytes = Buffer.isBuffer(data) ? data : Buffer.from(typeof data === 'string' ? data : JSON.stringify(data));
      res.writeHead(status,{'content-type':type,'content-length':String(bytes.length),'cache-control':'no-store',
        'x-content-type-options':'nosniff','referrer-policy':'no-referrer',
        'cross-origin-resource-policy':'same-origin','content-security-policy':POLICY,...extra});
      res.end(req.method === 'HEAD' ? undefined : bytes);
    }
    const json = (status,value) => reply(status,'application/json; charset=utf-8',value);
    async function body() {
      if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json')
        throw fault('JSON_REQUIRED','Use application/json.',415);
      const supplied = Buffer.from(String(req.headers['x-sf97-workspace'] ?? ''));
      const expected = Buffer.from(token);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied,expected))
        throw fault('WORKSPACE_SESSION_REQUIRED','Reload this workspace before saving.',403);
      let size = 0; const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) throw fault('REQUEST_TOO_LARGE','Commercial inputs exceed 2 MiB.',413);
        chunks.push(chunk);
      }
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
        return value;
      } catch { throw fault('INVALID_JSON','Use a JSON object for commercial inputs.'); }
    }
    (async () => {
      if (!hosts.has(req.headers.host) || (req.headers.origin && !origins.has(req.headers.origin)) ||
          ['cross-site','same-site'].includes(req.headers['sec-fetch-site']))
        throw fault('OPERATOR_ORIGIN_REQUIRED','Open the local operator workspace directly.',403);
      const url = new URL(req.url,`http://${req.headers.host}`);
      if (url.search || url.hash) throw fault('INVALID_URL','Use the workspace URL without query parameters.',400);
      if (req.method === 'GET' || req.method === 'HEAD') {
        const asset = assets.get(url.pathname);
        if (asset) return reply(200,asset.type,asset.bytes);
        if (url.pathname === '/api/state') return json(200,{...await model.state(),token});
        const match = /^\/files\/([a-f0-9-]{36})\/(.+)$/.exec(url.pathname);
        if (match) {
          const name = decodeURIComponent(match[2]);
          const bytes = await model.download(match[1],name), last = name.split('/').at(-1);
          const html = name.endsWith('.html');
          const type = html ? 'text/html; charset=utf-8' : name.endsWith('.json')
            ? 'application/json; charset=utf-8' : name.endsWith('.csv') ? 'text/csv; charset=utf-8' : 'application/octet-stream';
          return reply(200,type,bytes,{'content-security-policy':REPORT_POLICY,
            ...(html ? {} : {'content-disposition':`attachment; filename="${last.replace(/[^a-zA-Z0-9_.-]/g,'_')}"`})});
        }
        throw fault('NOT_FOUND','Workspace page not found.',404);
      }
      if (req.method !== 'POST') return reply(405,'text/plain','Use GET or POST.',{allow:'GET, HEAD, POST'});
      const input = await body();
      if (url.pathname === '/api/source') return json(200,{...await model.state(input.selection),token});
      if (url.pathname === '/api/preview') return json(200,await model.preview(input));
      if (url.pathname === '/api/save') return json(200,await model.save(input));
      if (url.pathname === '/api/load-version') return json(200,await model.loadVersion(input.version));
      if (url.pathname === '/api/compare') return json(200,await model.compare(input));
      throw fault('NOT_FOUND','Workspace operation not found.',404);
    })().catch(error => json(error.status ?? (error instanceof TypeError || error instanceof RangeError ? 422 : 500),
      {code:error.code ?? 'WORKSPACE_OPERATION_FAILED',
        message:error.status || error instanceof TypeError || error instanceof RangeError ? error.message : 'Workspace operation failed. Check the configured private source and state directory.'}));
  });
  server.requestTimeout = 20000; server.headersTimeout = 10000; server.keepAliveTimeout = 2000;
  await new Promise((done,fail) => {
    const onError = error => { server.removeListener('listening',onListen); fail(error); };
    const onListen = () => { server.removeListener('error',onError); done(); };
    server.once('error',onError); server.once('listening',onListen); server.listen(port,'127.0.0.1');
  });
  const assigned = server.address().port;
  hosts = new Set([`127.0.0.1:${assigned}`,`localhost:${assigned}`]);
  origins = new Set([...hosts].map(host => `http://${host}`));
  let closing;
  return {url:`http://127.0.0.1:${assigned}`,server,model,
    close() { return closing ??= new Promise((done,fail) => {
      server.close(error => error ? fail(error) : done()); server.closeIdleConnections?.();
    }); }};
}
