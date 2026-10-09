// Loopback-only demo host. The backend is the unmodified production MCP server.
import http from 'node:http';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonStore } from '../../hearthline-alexa-mcp/src/store.mjs';
import { HearthlineOrchestrator } from '../../hearthline-alexa-mcp/src/orchestrator.mjs';
import { createMcpHttpServer } from '../../hearthline-alexa-mcp/src/mcp-server.mjs';

const here = fileURLToPath(import.meta.url);
const port = Number(process.env.DEMO_PORT ?? 8790);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid DEMO_PORT');
const origin = `http://127.0.0.1:${port}`;
const fixture = Object.freeze({ id: 'synthetic-demo-weather', event: 'Severe Thunderstorm Warning',
  severity: 'Severe', urgency: 'Immediate', headline: 'SYNTHETIC DEMO: storm-readiness exercise',
  onset: null, expires: null, instruction: 'Demonstration fixture, not a live weather alert.' });
if (process.argv[2] === '--backend') {
  if (!process.send || !process.env.DEMO_PRIVATE_STATE) throw new Error('Backend requires its local supervisor');
  const store = new JsonStore(process.env.DEMO_PRIVATE_STATE);
  await store.load();
  const orchestrator = new HearthlineOrchestrator({ store, alertProvider: async () => [fixture] });
  const server = createMcpHttpServer({ orchestrator, allowedOrigins: [origin] });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  process.send({ port: server.address().port, pid: process.pid });
  process.on('SIGTERM', () => { server.closeAllConnections(); server.close(() => process.exit(0)); });
} else {
  const stateFile = join(await mkdtemp(join(tmpdir(), 'hearthline-live-')), 'state.json');
  let child, backendPort, restarting = false, restarts = 0;
  async function startBackend() {
    child = fork(here, ['--backend'], { env: { ...process.env, DEMO_PRIVATE_STATE: stateFile },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    const current = child;
    const ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { current.kill(); reject(new Error('Backend start timeout')); }, 10000);
      current.once('message', value => { clearTimeout(timer); resolve(value); });
      current.once('error', error => { clearTimeout(timer); reject(error); });
      current.once('exit', () => { clearTimeout(timer); reject(new Error('Backend exited before ready')); });
    });
    backendPort = ready.port;
  }
  async function stopBackend() {
    if (!child || child.exitCode !== null) return;
    const exited = once(child, 'exit');
    const timer = setTimeout(() => child.kill('SIGKILL'), 4000);
    child.kill('SIGTERM');
    try { await exited; } finally { clearTimeout(timer); }
  }
  async function snapshot() {
    const state = JSON.parse(await readFile(stateFile, 'utf8'));
    return { backendPid: child.pid, restarts, sourceCommit: process.env.SOURCE_COMMIT ?? 'not recorded',
      weather: 'synthetic fixture; no NWS request', missionCount: Object.keys(state.missions).length,
      outboxCount: state.outbox.length, receiptCount: state.receipts.length };
  }
  function json(res, status, value) {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(value));
  }
  await startBackend();
  const server = http.createServer(async (req, res) => {
    try {
      if (req.headers.host !== `127.0.0.1:${port}` || (req.headers.origin && req.headers.origin !== origin))
        return json(res, 403, { error: 'Local demo host/origin mismatch' });
      if (req.url === '/mcp' && ['POST', 'DELETE'].includes(req.method)) {
        if (restarting) return json(res, 503, { error: 'Backend restarting' });
        const upstream = http.request({ hostname: '127.0.0.1', port: backendPort, path: '/mcp',
          method: req.method, headers: { ...req.headers, host: `127.0.0.1:${backendPort}` } }, result => {
          res.writeHead(result.statusCode, result.headers); result.pipe(res);
        });
        upstream.on('error', () => { if (!res.headersSent) json(res, 502, { error: 'Backend unavailable' }); else res.end(); });
        req.on('aborted', () => upstream.destroy()); req.pipe(upstream); return;
      }
      if (req.url === '/demo/runtime' && req.method === 'GET') return json(res, 200, await snapshot());
      if (req.url === '/demo/restart' && req.method === 'POST') {
        if (req.headers.origin !== origin) return json(res, 403, { error: 'Same-origin restart required' });
        if (restarting) return json(res, 409, { error: 'Restart already in progress' });
        restarting = true;
        const previousPid = child.pid;
        try { await stopBackend(); await startBackend(); restarts++; return json(res, 200, { previousPid, ...await snapshot() }); }
        finally { restarting = false; }
      }
      const assets = { '/': ['index.html', 'text/html'], '/app.mjs': ['app.mjs', 'text/javascript'] };
      if (req.method !== 'GET' || !Object.hasOwn(assets, req.url)) return json(res, 404, { error: 'Not found' });
      const [name, type] = assets[req.url];
      res.writeHead(200, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
      res.end(await readFile(new URL(name, import.meta.url)));
    } catch (error) { if (!res.headersSent) json(res, 500, { error: error.message }); else res.end(); }
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  console.log(`HEARTHLINE_DEMO_READY ${origin}`);
  async function shutdown() { server.closeAllConnections(); server.close(); await stopBackend(); process.exit(0); }
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
}
