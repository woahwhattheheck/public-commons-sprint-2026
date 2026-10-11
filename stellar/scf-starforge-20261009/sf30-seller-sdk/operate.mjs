// MIT. Local operator surface for the original runnable SF30 seller service.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachSellerTraffic } from './traffic.mjs';

const HOST = '127.0.0.1';
const FILES = Object.freeze({
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.mjs': ['app.mjs', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
});
const SECURITY = Object.freeze({
  'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin', 'cross-origin-opener-policy': 'same-origin',
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
});
const USAGE = `Usage: node operate.mjs [--ops-port 8424] -- --config FILE [original seller options]

Starts the ORIGINAL SF30 seller service plus its loopback-only traffic dashboard.
Everything after -- is passed unchanged to serve.mjs (including --handlers and
--facilitator). Default service port: 8423. --ops-port 0 selects a free port.
No requests are made to the seller or any external service by the dashboard.
Read-only exports: GET /api/traffic (JSON), GET /metrics (Prometheus).`;

/** Start the operator surface for an existing startSellerService() session. */
export async function startSellerOperations(session, { port = 8424, recentLimit = 160 } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError('ops port must be 0–65535');
  const assets = new Map(await Promise.all(Object.entries(FILES).map(async ([path, [file, type]]) =>
    [path, { type, bytes: await readFile(new URL(`./operations/${file}`, import.meta.url)) }])));
  const observer = attachSellerTraffic(session, { recentLimit });
  let origin = null, closing = null;
  const server = createServer((req, res) => {
    const send = (status, body, type = 'text/plain; charset=utf-8', extra = {}) => {
      const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
      res.writeHead(status, { ...SECURITY, 'content-type': type, 'content-length': String(bytes.length), ...extra });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    };
    try {
      // A separate literal-loopback origin prevents accidental publication by
      // the seller reverse proxy and rejects DNS-rebinding/cross-site reads.
      if (!origin || req.headers.host !== new URL(origin).host ||
          req.headers.origin !== undefined && req.headers.origin !== origin ||
          req.headers['sec-fetch-site'] === 'cross-site') return send(403, 'Operator origin required\n');
      if (!['GET', 'HEAD'].includes(req.method)) return send(405, 'Read-only surface\n', undefined, { allow: 'GET, HEAD' });
      if (req.url === '/api/traffic') return send(200, JSON.stringify(observer.snapshot()), 'application/json; charset=utf-8');
      if (req.url === '/metrics') return send(200, observer.prometheus(), 'text/plain; version=0.0.4; charset=utf-8');
      if (req.url === '/traffic.json') return send(200, JSON.stringify(observer.snapshot(), null, 2) + '\n',
        'application/json; charset=utf-8', { 'content-disposition': 'attachment; filename="seller-traffic.json"' });
      const asset = assets.get(req.url);
      if (asset) return send(200, asset.bytes, asset.type);
      return send(404, 'Not found\n');
    } catch {
      if (!res.headersSent) send(500, 'Operator snapshot unavailable\n');
      else res.destroy();
    }
  });
  server.requestTimeout = 5000; server.headersTimeout = 5000; server.keepAliveTimeout = 2000;
  const close = () => closing ??= new Promise((done, fail) => {
    observer.detach();
    if (!server.listening) return done();
    server.close(error => error ? fail(error) : done());
    server.closeIdleConnections?.();
  });
  try {
    await new Promise((done, fail) => { server.once('error', fail); server.listen(port, HOST, done); });
    origin = `http://${HOST}:${server.address().port}`;
    return { server, url: origin, observer, close };
  } catch (error) {
    await close(); throw error;
  }
}

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') { process.stdout.write(USAGE + '\n'); return null; }
  const separator = args.indexOf('--');
  if (separator < 0 || separator === args.length - 1) throw new TypeError(USAGE);
  const own = args.slice(0, separator);
  if (own.length !== 0 && (own.length !== 2 || own[0] !== '--ops-port' || !/^\d{1,5}$/.test(own[1])))
    throw new TypeError(USAGE);
  const port = own.length ? Number(own[1]) : 8424;
  if (port > 65535) throw new RangeError('ops port must be 0–65535');
  // Lazy import keeps the operator library usable without starting a seller.
  // Reuse the original CLI: no copied config/native-factory implementation.
  const { main: sellerMain } = await import('./serve.mjs');
  const session = await sellerMain(args.slice(separator + 1));
  if (!session) return null;
  try {
    const operations = await startSellerOperations(session, { port });
    const closeSeller = session.close;
    let closing = null;
    // The original CLI's signal handlers call session.close at signal time.
    // Compose that existing lifetime instead of adding competing signal owners.
    session.close = () => closing ??= Promise.all([operations.close(), closeSeller()]).then(() => undefined);
    process.stdout.write(JSON.stringify({ operations: operations.url,
      traffic: operations.url + '/api/traffic', metrics: operations.url + '/metrics' }) + '\n');
    return { session, operations, close: session.close };
  } catch (error) {
    await session.close(); throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(String(error?.message ?? error) + '\n'); process.exitCode = 1; });
}
