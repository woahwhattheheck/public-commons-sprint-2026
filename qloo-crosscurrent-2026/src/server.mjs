// SPDX-License-Identifier: MIT
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {QlooClient, QlooError} from './qloo.mjs';
import {makeCulturalPlan, makeSyntheticDemo} from './agent.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Math.max(1, Math.min(65535, Number(process.env.PORT) || 8765));
const host = process.env.HOST || '127.0.0.1';
const upstreamBudget = process.env.QLOO_UPSTREAM_PER_MINUTE === undefined ? 48 :
  Number(process.env.QLOO_UPSTREAM_PER_MINUTE);
const client = process.env.QLOO_API_KEY ? new QlooClient({
  key: process.env.QLOO_API_KEY, maxUpstreamRequestsPerMinute: upstreamBudget
}) : null;
const perIp = new Map();
const json = (res, status, body) => {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(body));
};
function failure(res, status, code) { json(res, status, {error:code}); }
function requestIsAllowed(req) {
  const ip = req.socket.remoteAddress ?? 'unknown';
  const now = Date.now();
  for (const [address, quota] of perIp) if (quota.until < now) perIp.delete(address);
  const quota = perIp.get(ip) ?? {until: now+60000, count:0};
  if (++quota.count > 12) return false;
  perIp.set(ip, quota);
  return true;
}
async function bodyJson(req) {
  let size = 0; const buffers = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8192) throw new Error('INPUT_TOO_LARGE');
    buffers.push(chunk);
  }
  return JSON.parse(Buffer.concat(buffers).toString('utf8'));
}
const files = new Map([
  ['/', ['public/index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['public/styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['public/app.js', 'text/javascript; charset=utf-8']]
]);
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url || '/', 'http://localhost').pathname;
    if (req.method === 'GET' && path === '/api/health') {
      return json(res, 200, {status:'ok', live_configured: Boolean(client), hackathon_origin:'hackathon.api.qloo.com',
        upstream_budget_per_minute: client?.maxUpstreamRequestsPerMinute ?? 0,
        data_source_notice:'Live requires Qloo API access; demo is fictional synthetic fixture.'});
    }
    if (req.method === 'POST' && path === '/api/plan') {
      if (!requestIsAllowed(req)) return failure(res, 429, 'LOCAL_REQUEST_LIMIT');
      if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return failure(res,415,'JSON_REQUIRED');
      let payload;
      try {payload = await bodyJson(req);} catch {return failure(res, 400, 'INVALID_JSON');}
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return failure(res,400,'INVALID_INPUT');
      const {seed, city='', goal='community-night', mode='demo'} = payload;
      if (typeof seed !== 'string' || seed.trim().length < 2 || seed.trim().length > 100 ||
          typeof city !== 'string' || city.length > 80 ||
          !['community-night','independent-venue','pop-up-market'].includes(goal) ||
          !['live','demo'].includes(mode)) return failure(res,400,'INVALID_INPUT');
      if (mode === 'live' && !client) return failure(res,503,'QLOO_KEY_REQUIRED');
      try {
        const plan = mode === 'demo' ? makeSyntheticDemo({seed,city,goal}) :
          await makeCulturalPlan({seed,city,goal}, client);
        return json(res,200,plan);
      } catch(error) {
        return failure(res, error instanceof QlooError ? error.status : 502,
          error?.code ?? (error?.message === 'INVALID_GOAL' ? 'INVALID_GOAL' : 'PLAN_FAILED'));
      }
    }
    if (req.method === 'GET' && files.has(path)) {
      const [pathOnDisk, mime] = files.get(path);
      const content = await readFile(join(root, pathOnDisk));
      res.writeHead(200, {'Content-Type':mime, 'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'", 'X-Content-Type-Options':'nosniff'});
      return res.end(content);
    }
    return failure(res,404,'NOT_FOUND');
  } catch { return failure(res,500,'SERVER_ERROR'); }
});
server.listen(port,host,()=>console.log(`CrossCurrent is available at http://${host}:${port} (live Qloo configured: ${Boolean(client)})`));
