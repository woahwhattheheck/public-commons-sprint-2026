import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createQlooClient } from './qloo-client.mjs';
import { fixtureResponses } from './fixtures.mjs';
import { buildSchedule, CATEGORIES, validateRequest } from './planner.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const MIME = { '/': 'text/html; charset=utf-8', '/app.js': 'text/javascript; charset=utf-8', '/styles.css': 'text/css; charset=utf-8' };
const FILES = { '/': 'index.html', '/app.js': 'app.js', '/styles.css': 'styles.css' };
const COMMON_HEADERS = {
  'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};

export async function plan(input, { clientFactory = createQlooClient } = {}) {
  const args = validateRequest(input);
  let data;
  if (args.mode === 'fixture') {
    data = fixtureResponses(args);
  } else {
    // No simulation or fallback allowed in a purportedly live request.
    const client = clientFactory();
    const signals = await Promise.all(args.tastes.map(q => client.resolve(q)));
    const ids = signals.map(x => x.id);
    const results = await Promise.all(CATEGORIES.map(async kind =>
      [kind, await client.recommendations(kind, { city: args.city, ids, excludedIds: args.excludedIds })]));
    data = { signals, raw: Object.fromEntries(results) };
  }
  return buildSchedule(args, data.signals, data.raw);
}

function respond(res, status, body, contentType = 'application/json; charset=utf-8') {
  const bytes = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { ...COMMON_HEADERS, 'content-type': contentType });
  res.end(bytes);
}
function readPayload(req) {
  return new Promise((resolve, reject) => {
    let data = ''; let rejected = false;
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 32768 && !rejected) { rejected = true; reject(new Error('Request body exceeds 32 KB.')); req.destroy(); }
    });
    req.on('end', () => {
      if (rejected) return;
      try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON payload.')); }
    });
    req.on('error', reject);
  });
}
export function createHandler(deps = {}) {
  return async (req, res) => {
    try {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (req.method === 'GET' && path === '/api/health') {
        return respond(res, 200, { name: 'NeighborhoodPulse', liveReady: !!process.env.QLOO_API_KEY,
          fixtureReady: true, distinction: 'Synthetic fixture mode is not Qloo validation.' });
      }
      if (req.method === 'POST' && path === '/api/plan') {
        // Basic same-origin browser gate; CLI/API clients without Origin remain supported.
        const origin = req.headers.origin;
        const host = req.headers.host;
        if (origin && host && new URL(origin).host !== host) return respond(res, 403, { error: 'Cross-origin requests are not allowed.' });
        const body = await readPayload(req);
        const request = validateRequest(body);
        if (request.mode !== 'fixture' && !process.env.QLOO_API_KEY && !deps.clientFactory) {
          return respond(res, 503, { error: 'Live mode requires QLOO_API_KEY on the server. Switch to clearly labeled synthetic fixture mode for a preview.' });
        }
        return respond(res, 200, await plan(request, deps));
      }
      if (req.method === 'GET' && FILES[path]) {
        return respond(res, 200, await readFile(join(ROOT, FILES[path]), 'utf8'), MIME[path]);
      }
      return respond(res, 404, { error: 'Not found.' });
    } catch (e) {
      // Input messages are helpful, but do not expose arbitrary external error details or keys.
      const value = e instanceof Error ? e.message : 'Unknown error';
      const isBadInput = /required|must be|Expected|Supply|Excluded|Invalid JSON|exceeds|valid characters/i.test(value);
      const isServiceUnavailable = /QLOO_API_KEY|Qloo .* HTTP|Qloo response|Qloo returned|No Qloo entity|Unapproved Qloo/i.test(value);
      return respond(res, isBadInput ? 400 : isServiceUnavailable ? 502 : 500, {
        error: isBadInput || isServiceUnavailable ? value : 'The plan could not be generated. Try a more specific seed or retry.'
      });
    }
  };
}
export function startServer({ port = Number(process.env.PORT || '4173'), host = process.env.HOST || '127.0.0.1' } = {}) {
  const server = http.createServer(createHandler());
  server.listen(port, host, () => {
    process.stdout.write(`NeighborhoodPulse listening on http://${host}:${server.address().port}\n`);
    process.stdout.write(`Live Qloo configured: ${Boolean(process.env.QLOO_API_KEY)}; fixture mode clearly labeled synthetic.\n`);
  });
  return server;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) startServer();
