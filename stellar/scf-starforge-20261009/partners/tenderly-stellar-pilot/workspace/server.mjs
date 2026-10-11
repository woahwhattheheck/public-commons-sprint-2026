#!/usr/bin/env node
// MIT. Loopback browser transport for the original saved-simulation operator.
import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openTenderlyWorkspace } from './model.mjs';

const ASSETS = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);
const HELP = [
  'Tenderly merchant workspace — Node 22.16+, private local browser',
  '',
  'node workspace/server.mjs --state /private/tenderly-workspace',
  '  [--plan /private/plan.json] [--port 0]',
  '  [--facilitator https://selected-facilitator.example]',
  '',
  'Set the access-key and operation-key environment references named by your plan.',
  'Keep the same private directory and operation key when reopening.',
  'Review and save merchant profiles, issue original request tickets, start and drain',
  'the original seller, inspect completed results, and reconcile an interrupted operation.',
].join('\n');
const need = (ok, message, status = 400) => {
  if (!ok) throw Object.assign(new Error(message), { status });
};
function fields(value, allowed) {
  need(value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every(key => allowed.includes(key)), 'Unsupported request fields');
  return value;
}
function sendJson(res, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': body.length });
  res.end(body);
}
async function body(req) {
  need(/^application\/json(?:;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? ''),
    'Send application/json', 415);
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length; need(size <= 2 * 1024 * 1024, 'Request exceeds 2 MiB', 413); chunks.push(chunk);
  }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new TypeError('Invalid UTF-8 JSON request'); }
}

export async function startTenderlyWorkspace({ port = 0, ...options } = {}) {
  need(Number.isInteger(port) && port >= 0 && port <= 65535, 'port must be 0–65535');
  const model = await openTenderlyWorkspace(options);
  const token = randomBytes(32).toString('base64url'), expected = Buffer.from('Bearer ' + token);
  let origin, closing = false, shutdown;
  const server = createServer((req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('content-security-policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    Promise.resolve().then(async () => {
      need(!closing, 'Workspace is closing', 503);
      need(req.headers.host === new URL(origin).host, 'Use the printed local workspace address', 403);
      const url = new URL(req.url, origin);
      need(url.origin === origin && !url.hash, 'Invalid request target');
      if (req.method === 'GET' && !url.search && ASSETS.has(url.pathname)) {
        const [name, mime] = ASSETS.get(url.pathname);
        const bytes = await readFile(new URL('./public/' + name, import.meta.url));
        res.writeHead(200, { 'content-type': mime, 'content-length': bytes.length }); res.end(bytes); return;
      }
      need(url.pathname.startsWith('/api/'), 'Not found', 404);
      const supplied = Buffer.from(req.headers.authorization ?? '');
      need(supplied.length === expected.length && timingSafeEqual(supplied, expected),
        'Open the complete workspace URL from its launch terminal', 401);
      need((!req.headers.origin || req.headers.origin === origin) &&
        (req.method === 'GET' || req.headers.origin === origin), 'Use the exact workspace origin', 403);
      need(['GET', 'POST'].includes(req.method), 'Use GET or POST', 405);
      const query = url.searchParams;
      const selected = () => ({ profile: query.get('profile') });
      const operation = () => ({ ...selected(), operationKey: query.get('operationKey') });
      const limit = () => Number(query.get('limit') ?? 25);
      let result;
      if (req.method === 'GET') {
        if (url.pathname === '/api/bootstrap') result = await model.bootstrap();
        else if (url.pathname === '/api/status') result = model.status();
        else if (url.pathname === '/api/profiles') result = await model.profiles({ before: query.get('before') ?? '', limit: limit() });
        else if (url.pathname === '/api/profile') result = await model.inspectProfile(query.get('profile'));
        else if (url.pathname === '/api/requests') result = await model.requests({ ...selected(), before: query.get('before') ?? '', limit: limit() });
        else if (url.pathname === '/api/request') result = await model.inspectRequest(query.get('id'));
        else if (url.pathname === '/api/operations') result = await model.operations({
          ...selected(), limit: limit(), ...(query.has('state') ? { state: query.get('state') } : {}),
          ...(query.has('cursor') ? { cursor: query.get('cursor') } : {}),
        });
        else if (url.pathname === '/api/operation') result = await model.operation(operation());
        else if (url.pathname === '/api/audit') result = await model.audit({
          ...operation(), after: Number(query.get('after') ?? 0), limit: limit(),
        });
        else if (url.pathname === '/api/provider-lookups') result = await model.providerLookups({
          ...operation(), before: query.get('before') ?? '', limit: limit(),
        });
        else if (url.pathname === '/api/provider-lookup') result = await model.providerLookup({ ...selected(), id: query.get('id') });
        else if (url.pathname === '/api/provider-response') {
          const saved = await model.providerResponse({ ...selected(), lookupId: query.get('lookupId'), observationId: query.get('observationId') });
          result = { ...saved.record, preview: saved.bytes.subarray(0, 65536).toString('utf8'),
            previewTruncated: saved.bytes.length > 65536 };
        }
        else if (url.pathname === '/api/response') {
          const saved = await model.response(operation());
          result = { status: saved.status, headers: saved.headers, summary: saved.summary,
            bytes: saved.bytes.length, sha256: saved.sha256,
            preview: saved.bytes.subarray(0, 65536).toString('utf8'), previewTruncated: saved.bytes.length > 65536 };
        } else if (url.pathname === '/api/download') {
          const saved = await model.download({ ...selected(), kind: query.get('kind'), id: query.get('id'), observationId: query.get('observationId') });
          res.writeHead(200, { 'content-type': saved.mime, 'content-length': saved.bytes.length,
            'content-disposition': 'attachment; filename="' + saved.name + '"' });
          res.end(saved.bytes); return;
        } else throw Object.assign(new Error('Not found'), { status: 404 });
      } else {
        const value = await body(req);
        if (url.pathname === '/api/review') {
          fields(value, ['plan']); result = model.preview(value.plan);
        } else if (url.pathname === '/api/profiles') {
          fields(value, ['plan', 'label']); result = await model.saveProfile(value);
        } else if (url.pathname === '/api/prepare') {
          fields(value, ['profile']); result = await model.prepare(value.profile);
        } else if (url.pathname === '/api/open') {
          fields(value, ['profile']); result = await model.openProfile(value.profile);
        } else if (url.pathname === '/api/start') {
          fields(value, ['profile', 'port', 'operationsPort']); result = await model.start(value);
        } else if (url.pathname === '/api/stop') {
          fields(value, ['profile']); result = await model.stop(value.profile);
        } else if (url.pathname === '/api/issue') {
          fields(value, ['profile', 'body', 'id', 'subject', 'expiresAt']); result = await model.issue(value);
        } else if (url.pathname === '/api/provider-lookup') {
          fields(value, ['profile', 'operationKey', 'simulationId', 'refresh']); result = await model.lookupProvider(value);
        } else if (url.pathname === '/api/provider-recover') {
          fields(value, ['profile', 'lookupId', 'observationId', 'expectedGeneration', 'reference']);
          result = await model.recoverProvider(value);
        } else if (url.pathname === '/api/recover') {
          fields(value, ['profile', 'operationKey', 'expectedGeneration', 'requestHash', 'action', 'reference', 'response']);
          result = await model.recover(value);
        } else throw Object.assign(new Error('Not found'), { status: 404 });
      }
      sendJson(res, 200, result);
    }).catch(error => {
      if (res.headersSent) { res.destroy(); return; }
      const status = Number.isInteger(error.status) ? error.status :
        error.code === 'ENOENT' ? 404 : error.code === 'EEXIST' ? 409 : 400;
      // Original handlers use constant provider errors. Avoid filesystem paths from native errors.
      const message = /^(EACCES|EPERM|EIO|ENOSPC)$/.test(error.code ?? '') ?
        'Workspace storage operation failed (' + error.code + ')' : error.message;
      sendJson(res, status >= 400 && status < 600 ? status : 400, { error: message, code: error.code, ...(error.retryAt ? { retryAt: error.retryAt } : {}) });
    });
  });
  server.requestTimeout = 20000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000;
  try {
    await new Promise((done, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', done); });
  } catch (error) { await model.close(); throw error; }
  origin = 'http://127.0.0.1:' + server.address().port;
  const close = () => shutdown ??= (async () => {
    closing = true;
    const stopped = new Promise((done, fail) => server.close(error => error ? fail(error) : done()));
    server.closeIdleConnections();
    await model.close(); await stopped;
  })();
  return { server, model, origin, url: origin + '/#' + token, close };
}

export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.length === 1 && args[0] === '--help') { console.log(HELP); return; }
  const options = {}, merchantOptions = {};
  const mapping = { '--state': 'directory', '--plan': 'planPath', '--port': 'port', '--facilitator': 'facilitator' };
  for (let i = 0; i < args.length; i += 2) {
    const key = mapping[args[i]], value = args[i + 1];
    need(key && value && !value.startsWith('--') && !Object.hasOwn(options, key) &&
      !Object.hasOwn(merchantOptions, key), HELP);
    if (key === 'port') {
      need(/^(0|[1-9][0-9]{0,4})$/.test(value), 'port must be 0–65535'); options.port = Number(value);
    } else if (key === 'facilitator') merchantOptions.facilitator = value;
    else options[key] = resolve(value);
  }
  options.merchantOptions = merchantOptions;
  const workspace = await startTenderlyWorkspace(options);
  console.log(JSON.stringify({ tenderlyWorkspace: workspace.url, directory: workspace.model.root }));
  const stop = () => workspace.close().catch(error => { console.error(error.message); process.exitCode = 1; });
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  return workspace;
}
if (process.argv[1] && await realpath(resolve(process.argv[1])).then(value => value === fileURLToPath(import.meta.url), () => false))
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
