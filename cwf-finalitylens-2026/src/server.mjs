import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { checkSignature, DEMO_SIGNATURE, parseProviders } from './finality.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const demo = process.env.FINALITY_MODE !== 'live';
const providers = demo ? [] : parseProviders(process.env.FINALITY_RPC_URLS);
const port = Number(process.env.PORT || 8789);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1..65535');
let active = 0;
const assets = new Map([['/', ['index.html', 'text/html; charset=utf-8']], ['/app.js', ['app.js', 'text/javascript; charset=utf-8']], ['/style.css', ['style.css', 'text/css; charset=utf-8']]]);
const json = (res, code, value) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(value)); };
const server = createServer(async (req, res) => {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('content-security-policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  if (req.method !== 'GET') return json(res, 405, { error: 'Read-only GET routes only' });
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch { return json(res, 400, { error: 'Invalid route' }); }
  if (url.pathname === '/api/info') return json(res, 200, { mode: demo ? 'SYNTHETIC_DEMO' : 'LIVE_READ_ONLY', signature: demo ? DEMO_SIGNATURE : null, providerCount: providers.length });
  if (url.pathname === '/api/check') {
    if (active >= 2) return json(res, 429, { error: 'Two concurrent evidence checks already running' });
    active++;
    try {
      const data = await checkSignature(url.searchParams.get('signature') || '', { demo, providers, scenario: url.searchParams.get('scenario') || 'aligned' });
      return json(res, 200, data);
    } catch (err) { return json(res, 400, { error: err.message }); }
    finally { active--; }
  }
  const asset = assets.get(url.pathname);
  if (!asset) return json(res, 404, { error: 'Route not found' });
  try { const bytes = await readFile(resolve(root, asset[0])); res.writeHead(200, { 'content-type': asset[1], 'cache-control': 'no-store' }); res.end(bytes); }
  catch { json(res, 500, { error: 'Local page unavailable' }); }
});
server.listen(port, '127.0.0.1', () => console.log(`FinalityLens ${demo ? 'SYNTHETIC DEMO' : 'LIVE READ-ONLY'} listening at http://127.0.0.1:${port}`));
