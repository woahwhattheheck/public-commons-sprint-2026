// Dependency-free, loopback-only browser host for the real Hearthline MCP server.
import http from 'node:http';
import { fork } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const store = join(await mkdtemp(join(tmpdir(), 'hearthline-browser-')), 'state.json');
const staticFiles = new Map([['/', ['index.html', 'text/html']], ['/app.mjs', ['app.mjs', 'text/javascript']], ['/style.css', ['style.css', 'text/css']]]);
let worker, upstream, generation = 0, restarting = false, active = 0;

function startWorker() {
  return new Promise((resolve, reject) => {
    const child = fork(join(here, 'worker.mjs'), [store], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    const timer = setTimeout(() => { child.kill(); reject(new Error('MCP worker startup timed out')); }, 10000);
    child.once('error', err => { clearTimeout(timer); reject(err); });
    child.once('exit', () => { clearTimeout(timer); if (worker === child) upstream = null; reject(new Error('MCP worker exited')); });
    child.once('message', info => {
      if (!Number.isInteger(info.port) || info.port < 1 || info.port > 65535 || info.pid !== child.pid) return;
      clearTimeout(timer); worker = child; upstream = info; generation++; resolve();
    });
  });
}
async function stopWorker() {
  const child = worker;
  if (!child || child.exitCode !== null) return;
  await new Promise(resolve => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    child.kill('SIGTERM');
  });
}
function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
await startWorker();
const server = http.createServer(async (req, res) => {
  try {
    const host = `127.0.0.1:${server.address().port}`;
    // Fixed Host and same-origin writes reject cross-site/DNS-rebinding access.
    if (req.headers.host !== host || (req.headers.origin && req.headers.origin !== `http://${host}`) || req.headers['sec-fetch-site'] === 'cross-site') {
      req.resume(); return json(res, 403, { error: 'This demo accepts its own loopback origin only.' });
    }
    if (req.url === '/mcp' && req.method === 'POST') {
      if (restarting || !upstream) { req.resume(); return json(res, 503, { error: 'MCP server restarting; reconnect.' }); }
      active++;
      let done = false;
      const finish = () => { if (!done) { done = true; active--; } };
      const headers = {};
      for (const key of ['content-type', 'accept', 'mcp-session-id', 'mcp-protocol-version', 'origin']) if (req.headers[key]) headers[key] = req.headers[key];
      // Do not forward cookies, authorization, proxy headers, or arbitrary paths.
      const proxy = http.request({ host: '127.0.0.1', port: upstream.port, path: '/mcp', method: 'POST', headers }, response => {
        const responseHeaders = { 'content-type': response.headers['content-type'] ?? 'application/json', 'cache-control': 'no-store' };
        if (response.headers['mcp-session-id']) responseHeaders['mcp-session-id'] = response.headers['mcp-session-id'];
        res.writeHead(response.statusCode, responseHeaders); response.pipe(res);
        response.once('end', finish); response.once('error', () => { finish(); res.destroy(); });
      });
      proxy.setTimeout(15000, () => proxy.destroy(new Error('MCP request timed out')));
      proxy.on('error', () => { finish(); if (!res.headersSent) json(res, 502, { error: 'Local MCP transport failed.' }); else res.destroy(); });
      req.on('aborted', () => proxy.destroy());
      res.on('close', () => { if (!res.writableFinished) proxy.destroy(); });
      req.pipe(proxy); return;
    }
    if (req.url === '/demo/restart' && req.method === 'POST') {
      req.resume();
      if (req.headers['content-type'] !== 'application/json') return json(res, 415, { error: 'JSON control request required.' });
      if (restarting || active) return json(res, 409, { error: 'Finish active requests before restart.' });
      restarting = true;
      try { const previousPid = worker.pid; await stopWorker(); await startWorker(); return json(res, 200, { previousPid, pid: worker.pid, generation, sameStore: true }); }
      finally { restarting = false; }
    }
    if (req.url === '/demo/status' && req.method === 'GET') {
      const state = JSON.parse(await readFile(store, 'utf8'));
      return json(res, 200, { pid: upstream?.pid ?? null, generation, localOutboxItems: state.outbox.length, receipts: state.receipts.length, missions: Object.keys(state.missions).length, weather: 'fixture', effects: 'local_only' });
    }
    if (req.method === 'GET' && staticFiles.has(req.url)) {
      const [name, type] = staticFiles.get(req.url);
      const data = await readFile(join(here, name));
      res.writeHead(200, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'" });
      return res.end(data);
    }
    req.resume(); json(res, 404, { error: 'Not found' });
  } catch (error) { if (!res.headersSent) json(res, 500, { error: 'Local demo operation failed; inspect terminal.' }); else res.destroy(); console.error(error.message); }
});
const requestedPort = Number(process.env.PORT ?? 8790);
if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) throw new Error('Invalid PORT');
await new Promise(resolve => server.listen(requestedPort, '127.0.0.1', resolve));
console.log(JSON.stringify({ url: `http://127.0.0.1:${server.address().port}`, source: 'real MCP runtime', weather: 'fixture', effects: 'local_only' }));
let closing = false;
async function close() {
  if (closing) return; closing = true;
  server.close(); server.closeIdleConnections(); await stopWorker(); process.exit(0);
}
process.on('SIGTERM', close); process.on('SIGINT', close);
