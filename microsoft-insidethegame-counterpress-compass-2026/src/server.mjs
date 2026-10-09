import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {makeSnapshot, TEAMS, validateFixture} from './engine.mjs';
import {foundryConfigured, suggestedNarrative} from './foundry.mjs';
import {createFoundryQuota} from './foundry_quota.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const FIXTURE = JSON.parse(await readFile(join(ROOT, 'data', 'events.json'), 'utf8'));
validateFixture(FIXTURE);
const TYPES = {'/':'text/html; charset=utf-8', '/app.js':'text/javascript; charset=utf-8', '/style.css':'text/css; charset=utf-8'};
const ROUTES = {'/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css'};
const DEFAULT_PORT = 3167;
const foundryQuota = createFoundryQuota();
const port = Number(process.env.PORT || DEFAULT_PORT);
const host = process.env.HOST || '127.0.0.1';
if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error('Invalid PORT');

function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(body);
}
async function getJSON(req) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw Object.assign(new Error('Expected application/json'), {status:415});
  let length = 0;
  const chunks = [];
  for await (const c of req) {
    length += c.length;
    if (length > 8192) throw Object.assign(new Error('Body exceeds 8KB'), {status:413});
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid JSON'), {status:400}); }
}
function parseChoice(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Object.assign(new Error('Object body required'), {status:400});
  const count = body.count;
  if (!Number.isInteger(count) || count < 0 || count > FIXTURE.length) throw Object.assign(new Error('count must be 0..'+FIXTURE.length), {status:400});
  if (body.team !== undefined && !TEAMS.includes(body.team)) throw Object.assign(new Error('Unknown team'), {status:400});
  if (body.audience !== undefined && !['casual','analyst'].includes(body.audience)) throw Object.assign(new Error('Unknown audience'), {status:400});
  if (body.locale !== undefined && !['en','es'].includes(body.locale)) throw Object.assign(new Error('Unknown locale'), {status:400});
  return {count, team: body.team || TEAMS[0], audience: body.audience || 'casual', locale: body.locale || 'en'};
}
function runSnapshot(body) {
  const {count, ...choice} = parseChoice(body);
  return {count, selectedEvents: FIXTURE.slice(0, count),
    ...makeSnapshot(FIXTURE.slice(0,count), choice)};
}
export const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (req.method === 'GET' && path === '/health') return send(res, 200, {ok: true, fixture: 'synthetic', foundryConfigured: foundryConfigured()});
    if (req.method === 'GET' && path === '/api/bootstrap') return send(res, 200, {
      fixture: 'SYNTHETIC ONLY', teams: TEAMS, events: FIXTURE,
      rules: {counterpressWindowSeconds:8, success:'same-team loss, pressure action and regain within window'},
      foundryConfigured: foundryConfigured(), providerCallsOnReplay:0,
    });
    if (req.method === 'POST' && path === '/api/analyze') return send(res, 200, runSnapshot(await getJSON(req)));
    if (req.method === 'POST' && path === '/api/foundry-draft') {
      if (!foundryConfigured()) return send(res, 503, {error:'Optional Foundry not configured'});
      const snapshot = runSnapshot(await getJSON(req));
      const latest = snapshot.overlays.at(-1);
      if (!latest) return send(res, 422, {error:'No evidence-backed overlay in current frame'});
      const admission = foundryQuota.reserve();
      if (!admission.allowed) {
        res.setHeader('Retry-After', String(admission.retryAfterSeconds));
        return send(res, 429, {error:'Optional Foundry draft capacity reached',
          code: admission.reason, retryAfterSeconds: admission.retryAfterSeconds});
      }
      try { return send(res, 200, await suggestedNarrative(latest)); }
      catch { return send(res, 502, {error:'Foundry draft unavailable; deterministic overlay retained'}); }
      finally { admission.release(); }
    }
    if (req.method === 'GET' && Object.hasOwn(ROUTES,path)) {
      const filename = join(ROOT,'web',ROUTES[path]);
      const buf = await readFile(filename);
      res.writeHead(200, {'Content-Type':TYPES[path], 'Cache-Control':'no-store'});
      return res.end(buf);
    }
    return send(res, 404, {error:'Not found'});
  } catch (e) { return send(res, e.status || 400, {error: e.status ? e.message : 'Invalid request'}); }
});

if (process.env.NODE_ENV !== 'test') server.listen(port, host, () => {
  process.stdout.write(`Counterpress Compass synthetic demo http://${host}:${port}\n`);
});
