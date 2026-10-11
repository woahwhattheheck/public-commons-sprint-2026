#!/usr/bin/env node
// MIT. Local-only interactive wrapper around the ORIGINAL SF70 merchant intake.
// No paid requests, signing, merchant credentials, deployment, or data persistence.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {parseArgs, capture} from '../sf70-merchant-intake/run.mjs';

const ASSETS = Object.freeze({
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/console.mjs': ['console.mjs', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
});
const ROOT = new URL('.', import.meta.url);
const MAX_BODY = 8192;
const HEADERS = Object.freeze({
  'cache-control': 'no-store, max-age=0',
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
});

function json(res, code, data) {
  res.writeHead(code, {'content-type': 'application/json; charset=utf-8'});
  res.end(JSON.stringify(data));
}
function argsFromForm(input, allowLoopback) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Expected one merchant intake object');
  const allowed = new Set(['resource', 'catalog', 'origin', 'network', 'payTo', 'method', 'permission']);
  if (Object.keys(input).some(k => !allowed.has(k))) throw new TypeError('Unexpected intake field');
  if (input.permission !== true) throw new TypeError('Operator must confirm authorization for the named resource and facilitator');
  const opts = [
    ['--resource', 'resource'], ['--catalog', 'catalog'], ['--origin', 'origin'],
    ['--network', 'network'], ['--pay-to', 'payTo'], ['--method', 'method'],
  ];
  const argv = [];
  for (const [flag, field] of opts) {
    const v = input[field];
    if (typeof v !== 'string' || !v.trim() || v.length > 2048 || v !== v.trim())
      throw new TypeError('Invalid ' + field + ': expected a nonempty trimmed string');
    argv.push(flag, v);
  }
  if (allowLoopback) argv.push('--allow-loopback');
  // Keep the exact canonical SF70 endpoint, network, address, method and origin validation.
  return parseArgs(argv);
}
async function boundedBody(req) {
  if (req.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json')
    throw Object.assign(new TypeError('Content-Type must be application/json'), {status:415});
  const length = Number(req.headers['content-length']);
  if (Number.isFinite(length) && length > MAX_BODY)
    throw Object.assign(new TypeError('Intake payload exceeds 8 KiB'), {status:413});
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.byteLength;
    if (size > MAX_BODY) throw Object.assign(new TypeError('Intake payload exceeds 8 KiB'), {status:413});
    chunks.push(chunk);
  }
  if (!size) throw new TypeError('Intake payload is empty');
  try { return JSON.parse(Buffer.concat(chunks, size).toString('utf8')); }
  catch { throw new TypeError('Invalid JSON document'); }
}

// Injection is only for the focused loopback HTTP-contract check, not for deployed usage.
export function createConsoleServer({runCapture = capture, allowLoopback = false} = {}) {
  let active = false;
  const server = createServer(async (req, res) => {
    for (const [key, value] of Object.entries(HEADERS)) res.setHeader(key, value);
    const port = server.address()?.port;
    const ownOrigin = `http://127.0.0.1:${port}`;
    if (req.socket.remoteAddress !== '127.0.0.1' && req.socket.remoteAddress !== '::ffff:127.0.0.1') {
      json(res, 403, {error: 'LOOPBACK_ONLY'}); return;
    }
    if (req.headers.host !== `127.0.0.1:${port}`) {
      json(res, 403, {error: 'INVALID_LOCAL_HOST'}); return;
    }
    const route = (req.url || '').split('?')[0];
    if (req.method === 'GET' && route === '/health') {
      json(res, 200, {status: 'LOCAL_READY', originalIntake: 'SF70', providerCallsOnPageLoad: 0, paidCalls: 0}); return;
    }
    if (req.method === 'GET' && Object.hasOwn(ASSETS, route)) {
      try {
        const [filename, mime] = ASSETS[route];
        const data = await readFile(new URL(filename, ROOT));
        res.writeHead(200, {'content-type': mime}); res.end(data);
      } catch { json(res, 500, {error: 'STATIC_ASSET_UNAVAILABLE'}); }
      return;
    }
    if (route === '/api/intake' && req.method === 'POST') {
      // Enforce same-origin. Browser POSTs have Origin; empty Origin must not bypass the CSRF fence.
      if (req.headers.origin !== ownOrigin) { json(res, 403, {error: 'ORIGIN_MISMATCH'}); return; }
      if (active) { json(res, 409, {error: 'INTAKE_IN_PROGRESS'}); return; }
      active = true;
      try {
        const config = argsFromForm(await boundedBody(req), allowLoopback);
        const report = await runCapture(config);
        // Direct return of original SF70 schema and exact finding states, not a recomputation.
        json(res, 200, {report});
      } catch (error) {
        const status = Number(error?.status) || (error instanceof TypeError ? 422 : 502);
        json(res, status, {error: status === 502 ? 'ORIGINAL_INTAKE_FAILED' : 'INVALID_INTAKE',
          detail: String(error?.message ?? error).slice(0, 240)});
      } finally { active = false; }
      return;
    }
    json(res, 404, {error: 'NOT_FOUND'});
  });
  return server;
}

export async function start({port = 0, allowLoopback = false, runCapture = capture} = {}) {
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new TypeError('Invalid port');
  const server = createConsoleServer({allowLoopback, runCapture});
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolveListen);
  });
  return {server, url: `http://127.0.0.1:${server.address().port}/`};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const flags = new Set(process.argv.slice(2));
  if (flags.size !== process.argv.slice(2).length || [...flags].some(f => f !== '--allow-loopback')) {
    process.stderr.write('Usage: node server.mjs [--allow-loopback]  (localhost demo only)\n');
    process.exitCode = 1;
  } else start({allowLoopback: flags.has('--allow-loopback')}).then(({url}) =>
    process.stdout.write('Open locally: '+url+'\n')).catch(e => {
      process.stderr.write('SF74: '+String(e.message)+'\n'); process.exitCode=1;
    });
}
