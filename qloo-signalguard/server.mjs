import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { audit } from './src/audit.mjs';
import { createDemoProvider } from './src/demo.mjs';
import { createQlooProvider, QlooError } from './src/qloo.mjs';
import { createAuditTraffic, TrafficError } from './src/traffic.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3108);
const host = process.env.HOST || '127.0.0.1';
const hourlyBudget = Number(process.env.MAX_LIVE_AUDITS_PER_HOUR || 12);
if (!Number.isInteger(port) || port < 1 || port > 65535 ||
    !Number.isInteger(hourlyBudget) || hourlyBudget < 1 || hourlyBudget > 1000) {
  throw new Error('Invalid PORT or MAX_LIVE_AUDITS_PER_HOUR');
}
const traffic = createAuditTraffic({ maxLivePerHour: hourlyBudget });
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);
const send = (res, status, payload, extraHeaders = {}) => {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...extraHeaders,
  });
  res.end(body);
};
const server = http.createServer(async (req, res) => {
  if (req.method !== 'GET') return send(res, 405, { error: 'Read-only service: GET required' });
  let url;
  try { url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); }
  catch { return send(res, 400, { error: 'Malformed URL' }); }
  if (url.pathname === '/api/status')
    return send(res, 200, { liveConfigured: !!process.env.QLOO_API_KEY, liveEndpoint: 'https://hackathon.api.qloo.com', demoLabel: 'SYNTHETIC – not Qloo evidence', apiCalls: 'GET /search and GET /v2/insights only', ...traffic.stats() });
  if (url.pathname === '/api/audit') {
    try {
      const mode = url.searchParams.get('mode');
      if (mode !== 'live' && mode !== 'demo') return send(res, 400, { error: 'Select live or synthetic demo mode' });
      const input = {
        seed: url.searchParams.get('seed'),
        seedType: url.searchParams.get('seedType'),
        target: url.searchParams.get('target'),
      };
      // Reject malformed identifiers without allocating a live budget slot.
      if (typeof input.seed !== 'string' || input.seed.trim().length < 2 || input.seed.trim().length > 100 ||
        !['urn:entity:movie', 'urn:entity:book', 'urn:entity:artist'].includes(input.seedType) ||
        !['urn:entity:movie', 'urn:entity:book', 'urn:entity:artist'].includes(input.target)) {
        return send(res, 400, { error: 'Enter a valid title (2–100 characters), seed type and target type' });
      }
      const provider = mode === 'demo' ? createDemoProvider() : createQlooProvider(process.env.QLOO_API_KEY);
      const { result, delivery } = await traffic.run({ ...input, mode, remoteAddress: req.socket.remoteAddress, execute: () => audit(input, provider) });
      const provenance = mode === 'demo' ? 'SYNTHETIC DEMO — NOT A QLOO RESPONSE'
        : delivery === 'cache' ? 'CACHED LIVE QLOO RESULTS (up to 5 minutes old)'
        : 'LIVE QLOO HACKATHON API';
      return send(res, 200, { ...result, provenance, sourceMode: mode, delivery });
    } catch (err) {
      const status = err instanceof TrafficError ? 429 : err instanceof QlooError
        ? (err.status >= 400 && err.status < 600 ? err.status : 502)
        : err?.message?.includes('Enter a seed') || err?.message?.includes('Unsupported Qloo') ? 400 : 502;
      const retryAfter = err instanceof TrafficError ? err.retryAfter : null;
      return send(res, status, { error: String(err?.message || err).slice(0, 240), provenance: 'NO VERIFIED AUDIT',
        ...(retryAfter ? { retryAfterSeconds: retryAfter } : {}) }, retryAfter ? { 'Retry-After': String(retryAfter) } : {});
    }
  }
  const file = files.get(url.pathname);
  if (!file) return send(res, 404, { error: 'Not found' });
  try {
    const content = await readFile(path.join(root, 'public', file[0]));
    res.writeHead(200, { 'Content-Type': file[1], 'Content-Length': content.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; img-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'" });
    res.end(content);
  } catch { send(res, 500, { error: 'Static asset unavailable' }); }
});
server.listen(port, host, () => process.stdout.write(`SignalGuard ready on ${host}:${port}\n`));
