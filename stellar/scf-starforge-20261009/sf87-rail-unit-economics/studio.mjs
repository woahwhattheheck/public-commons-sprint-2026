/**
 * SF87 Studio. Native loopback-only HTTP user interface for the original SF87
 * compare.mjs cost engine. No external requests, packages, wallets or storage.
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze, renderMarkdown } from './compare.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const MAX_BODY = 128 * 1024;
const FILES = Object.freeze({
  '/': ['studio.html', 'text/html; charset=utf-8'],
  '/studio.js': ['studio.js', 'text/javascript; charset=utf-8'],
  '/studio.css': ['studio.css', 'text/css; charset=utf-8'],
  '/sample.json': ['illustrative-input.json', 'application/json; charset=utf-8'],
});
const POLICIES = Object.freeze({
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
  'cross-origin-opener-policy': 'same-origin',
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
});
function send(res, status, payload, type) {
  res.writeHead(status, { ...POLICIES, 'content-type': type });
  res.end(payload);
}
function json(res, code, body) {
  send(res, code, JSON.stringify(body), 'application/json; charset=utf-8');
}
export function createStudioServer() {
  const assets = Object.fromEntries(Object.entries(FILES).map(([route, [name, type]]) => [route, {
    content: readFileSync(join(ROOT, name)), type,
  }]));
  const server = createServer(async (req, res) => {
    try {
      const port = server.address()?.port;
      if (req.headers.host !== '127.0.0.1:' + port) {
        json(res, 403, { error: 'Invalid local host' });
        return;
      }
      const url = new URL(req.url, 'http://127.0.0.1:' + port);
      if (req.method === 'GET' && Object.hasOwn(assets, url.pathname) && !url.search) {
        const asset = assets[url.pathname];
        send(res, 200, asset.content, asset.type);
        return;
      }
      if (req.method === 'POST' && url.pathname === '/evaluate' && !url.search) {
        if (req.headers.origin && req.headers.origin !== 'http://127.0.0.1:' + port) {
          json(res, 403, { error: 'Cross-origin submissions disabled' });
          return;
        }
        if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
          json(res, 415, { error: 'Send application/json' });
          return;
        }
        const chunks = [];
        let bytes = 0;
        for await (const c of req) {
          bytes += c.length;
          if (bytes > MAX_BODY) {
            json(res, 413, { error: 'Scenario exceeds 128 KiB' });
            return;
          }
          chunks.push(c);
        }
        let scenario;
        try { scenario = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { json(res, 400, { error: 'Invalid JSON scenario' }); return; }
        try {
          const report = analyze(scenario);
          json(res, 200, { report, markdown: renderMarkdown(report) });
        } catch (e) {
          json(res, 422, { error: String(e.message).slice(0, 500) });
        }
        return;
      }
      json(res, 404, { error: 'Route not found' });
    } catch (e) {
      if (!res.headersSent) json(res, 500, { error: 'Local server error' });
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 0 && (args.length !== 2 || args[0] !== '--port')) throw new TypeError('usage: node studio.mjs [--port 0..65535]');
    const port = args.length ? Number(args[1]) : 0;
    if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new TypeError('Invalid --port');
    const server = createStudioServer();
    server.on('error', e => { console.error('SF87 Studio: ' + e.message); process.exitCode = 1; });
    server.listen(port, '127.0.0.1', () => {
      console.log('SF87 Studio listening at http://127.0.0.1:' + server.address().port + '/');
      console.log('Runs locally, with no external requests or persistence; Ctrl-C to stop.');
    });
  } catch (e) { console.error('SF87 Studio: ' + e.message); process.exitCode = 1; }
}
