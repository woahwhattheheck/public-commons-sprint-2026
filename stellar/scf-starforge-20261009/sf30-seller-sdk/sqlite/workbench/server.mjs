// MIT. Loopback-only operator UI. No telemetry, hosted assets, public SQL endpoint or CORS.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openWorkbench } from './model.mjs';

const HOST = '127.0.0.1';
const assets = new Map([['/', ['index.html', 'text/html; charset=utf-8']],
  ['/browser.mjs', ['browser.mjs', 'text/javascript; charset=utf-8']], ['/style.css', ['style.css', 'text/css; charset=utf-8']]]);
const problem = (message, status = 400) => Object.assign(new Error(message), { status });
async function body(req) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw problem('Use application/json.', 415);
  const chunks = []; let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 1048576) throw problem('Request exceeds 1 MiB.', 413);
    chunks.push(chunk);
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
}
export async function startWorkbench({ database, workspace, port = 0 } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw problem('Invalid port.');
  const model = await openWorkbench({ database, workspace });
  const token = randomBytes(32).toString('hex'), expected = Buffer.from('Bearer ' + token);
  const previews = new Set();
  let origin, stopping;
  const headers = {
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  };
  function reply(res, status, data, type = 'application/json; charset=utf-8') {
    const payload = type.startsWith('application/json') ? JSON.stringify(data) : data;
    res.writeHead(status, { ...headers, 'content-type': type }); res.end(payload);
  }
  const server = createServer((req, res) => { (async () => {
    if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin) ||
        req.headers['sec-fetch-site'] === 'cross-site') throw problem('Use this workbench origin.', 403);
    const url = new URL(req.url, origin);
    if (req.method === 'GET' && assets.has(url.pathname)) {
      const [filename, type] = assets.get(url.pathname);
      reply(res, 200, await readFile(new URL(filename, import.meta.url)), type); return;
    }
    const auth = Buffer.from(req.headers.authorization ?? '');
    if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) throw problem('Open the private launch URL printed in your terminal.', 401);
    if (req.method === 'GET' && url.pathname === '/api/state') return reply(res, 200, await model.state());
    if (req.method === 'GET' && url.pathname === '/api/schema') return reply(res, 200, await model.schema(url.searchParams.get('table') ?? undefined));
    if (req.method !== 'POST') throw problem('Unknown endpoint or method.', 404);
    const data = await body(req);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw problem('Expected a JSON object.');
    if (url.pathname === '/api/save') return reply(res, 200, await model.save(data.draft, data.revision));
    if (url.pathname === '/api/inspect') return reply(res, 200, await model.inspectDraft(data.draft));
    if (url.pathname === '/api/export') return reply(res, 200, await model.exportPack(data.name, data.revision));
    if (url.pathname === '/api/preview') {
      const controller = new AbortController(); previews.add(controller);
      const cancel = () => { if (!res.writableEnded) controller.abort(); };
      res.once('close', cancel);
      try { reply(res, 200, await model.preview(data.query, data.input, { signal: controller.signal })); }
      finally { previews.delete(controller); res.removeListener('close', cancel); }
      return;
    }
    throw problem('Unknown endpoint.', 404);
  })().catch(error => {
    if (res.destroyed || res.writableEnded) return;
    reply(res, Number.isInteger(error.status) ? error.status : 422,
      { error: error.code ?? 'WORKBENCH_INPUT_ERROR', message: String(error.message ?? 'Operation failed.'), ...(error.field ? { field: error.field } : {}) });
  }); });
  server.requestTimeout = 60000; server.headersTimeout = 10000; server.keepAliveTimeout = 2000;
  try {
    await new Promise((done, fail) => { server.once('error', fail); server.listen(port, HOST, done); });
    origin = `http://${HOST}:${server.address().port}`;
  } catch (error) { await model.close(); throw error; }
  const close = () => stopping ??= (async () => {
    for (const controller of previews) controller.abort();
    const stopped = new Promise((done, fail) => server.close(error => error ? fail(error) : done()));
    server.closeIdleConnections(); await stopped; await model.close();
  })();
  return { origin, token, url: origin + '/#' + token, model, server, close };
}
async function main(args) {
  const help = 'node server.mjs --database EXISTING.sqlite --workspace PRIVATE_DIRECTORY [--port 0]';
  if (args.length === 1 && args[0] === '--help') { console.log(help); return; }
  const options = new Map();
  for (let i = 0; i < args.length; i += 2) {
    if (!['--database', '--workspace', '--port'].includes(args[i]) || !args[i + 1] || options.has(args[i])) throw problem(help);
    options.set(args[i], args[i + 1]);
  }
  if (!options.has('--database') || !options.has('--workspace')) throw problem(help);
  const session = await startWorkbench({ database: options.get('--database'), workspace: options.get('--workspace'), port: Number(options.get('--port') ?? 0) });
  console.log('Private SQLite merchant workbench: ' + session.url);
  console.log('No database rows are fetched until you request a preview. Keep this launch URL private.');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => session.close().catch(error => { console.error(error.message); process.exitCode = 1; }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
