#!/usr/bin/env node
// MIT. Private browser transport for the original Cube onboarding workflow.
import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openCubeWorkbench } from './model.mjs';

const HELP = `Cube merchant workspace — Node 22+, private loopback browser

  node workspace/server.mjs --state NEW_DIRECTORY --metadata ORIGINAL_CUBE_META.json
       [--plan ORIGINAL_MERCHANT_PLAN.json] [--port 0]
  node workspace/server.mjs --state EXISTING_DIRECTORY [--port 0]

Open the exact printed browser URL. Select actual members, compose named reports,
review original offers, save/reopen versions and export original seller packages.
Credentials stay in the launch environment. Probe reads one saved report example
through the original Cube handler. Buyer preparation uses the original SF88 flow.
The saved metadata snapshot remains fixed; use a new workspace for changed /meta.`;
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);
function json(res, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': body.length });
  res.end(body);
}
async function requestBody(req) {
  if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? ''))
    throw Object.assign(new TypeError('Send application/json'), { status: 415 });
  const parts = []; let total = 0;
  for await (const part of req) {
    total += part.length;
    if (total > 1024 * 1024) throw Object.assign(new RangeError('Merchant plan exceeds 1 MiB'), { status: 413 });
    parts.push(part);
  }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts))); }
  catch { throw new TypeError('Invalid UTF-8 JSON request'); }
}
const fields = (value, allowed) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key)))
    throw new TypeError('Unsupported request fields');
  return value;
};

export async function startCubeWorkbench(options = {}) {
  const { port = 0, ...modelOptions } = options;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError('port must be 0–65535');
  const model = await openCubeWorkbench(modelOptions), token = randomBytes(32).toString('base64url');
  const tokenBytes = Buffer.from('Bearer ' + token);
  let origin, closing = false, pending = Promise.resolve();
  const mutate = operation => {
    const result = pending.then(operation);
    pending = result.catch(() => {});
    return result;
  };
  const server = createServer((req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    Promise.resolve().then(async () => {
      if (closing) return json(res, 503, { error: 'Workspace is closing' });
      if (req.headers.host !== new URL(origin).host) return json(res, 403, { error: 'Use the printed loopback origin' });
      const url = new URL(req.url, origin);
      if (url.origin !== origin || url.hash) return json(res, 400, { error: 'Invalid request target' });
      if (assets.has(url.pathname) && req.method === 'GET' && !url.search) {
        const [name, type] = assets.get(url.pathname), bytes = await readFile(new URL('./public/' + name, import.meta.url));
        res.writeHead(200, { 'content-type': type, 'content-length': bytes.length }); res.end(bytes); return;
      }
      if (!url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Not found' });
      const supplied = Buffer.from(req.headers.authorization ?? '');
      if (supplied.length !== tokenBytes.length || !timingSafeEqual(supplied, tokenBytes))
        return json(res, 401, { error: 'Open the complete workspace URL from its launch terminal' });
      if (req.headers.origin && req.headers.origin !== origin || req.method !== 'GET' && req.headers.origin !== origin)
        return json(res, 403, { error: 'Workspace changes require its exact browser origin' });
      if (!['GET', 'POST'].includes(req.method)) return json(res, 405, { error: 'Use GET or POST' });
      let result;
      if (req.method === 'GET') {
        if (url.pathname === '/api/bootstrap') result = { ...model.bootstrap(), runtimeRoot: fileURLToPath(new URL('../../', import.meta.url)) };
        else if (url.pathname === '/api/members') result = model.members({
          query: url.searchParams.get('query') ?? '', kind: url.searchParams.get('kind') ?? '',
          cube: url.searchParams.get('cube') ?? '', offset: Number(url.searchParams.get('offset') ?? 0),
          limit: Number(url.searchParams.get('limit') ?? 100),
        });
        else if (url.pathname === '/api/versions') result = await model.listVersions({
          before: url.searchParams.get('before') ?? '', limit: Number(url.searchParams.get('limit') ?? 20),
        });
        else if (/^\/api\/versions\/[a-z0-9-]+$/.test(url.pathname)) result = await model.inspectVersion(url.pathname.split('/').at(-1));
        else if (/^\/api\/exports\/[a-z0-9-]+$/.test(url.pathname)) result = await model.inspectExport(url.pathname.split('/').at(-1));
        else if (url.pathname.startsWith('/api/files/')) {
          const parts = url.pathname.split('/');
          if (parts.length !== 6) return json(res, 404, { error: 'Not found' });
          const file = await model.download({ kind: parts[3], item: parts[4], file: parts[5] });
          res.writeHead(200, { 'content-type': file.mime, 'content-length': file.bytes.length,
            'content-disposition': `attachment; filename="${file.name}"` });
          res.end(file.bytes); return;
        } else return json(res, 404, { error: 'Not found' });
      } else {
        const body = await requestBody(req);
        if (url.pathname === '/api/review') { fields(body, ['plan']); result = model.preview(body.plan); }
        else if (url.pathname === '/api/versions') { fields(body, ['plan']); result = await mutate(() => model.save(body.plan)); }
        else if (url.pathname === '/api/export') { fields(body, ['version']); result = await mutate(() => model.exportVersion(body.version)); }
        else if (url.pathname === '/api/probe') { fields(body, ['version', 'reportId']); result = await mutate(() => model.probe(body.version, body.reportId)); }
        else if (url.pathname === '/api/buyer') {
          fields(body, ['package', 'reportId', 'acceptIndex', 'intentId', 'inputs']);
          result = await mutate(() => model.buyer(body.package, { reportId: body.reportId, acceptIndex: body.acceptIndex,
            intentId: body.intentId, ...(body.inputs === undefined ? {} : { inputs: body.inputs }) }));
        } else return json(res, 404, { error: 'Not found' });
      }
      json(res, 200, result);
    }).catch(error => {
      if (res.headersSent) { res.destroy(); return; }
      const status = error.status ?? (error.code === 'ENOENT' ? 404 : error.code === 'EEXIST' ? 409 : 400);
      json(res, status, { error: error.message });
    });
  });
  server.requestTimeout = 20000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000;
  await new Promise((done, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', done); });
  origin = `http://127.0.0.1:${server.address().port}`;
  let shutdown;
  const close = () => shutdown ??= (async () => {
    closing = true;
    const stopped = new Promise((done, fail) => server.close(error => error ? fail(error) : done()));
    server.closeIdleConnections();
    await pending; await stopped;
  })();
  return { server, model, origin, url: origin + '/#' + token, close };
}

export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.length === 1 && args[0] === '--help') { console.log(HELP); return; }
  const options = {}, map = { '--state': 'directory', '--metadata': 'metadataPath', '--plan': 'planPath', '--port': 'port' };
  for (let i = 0; i < args.length; i += 2) {
    const name = map[args[i]], value = args[i + 1];
    if (!name || Object.hasOwn(options, name) || !value || value.startsWith('--')) throw new TypeError(HELP);
    if (name === 'port') {
      if (!/^(0|[1-9]\d{0,4})$/.test(value)) throw new TypeError('port must be 0–65535');
      options[name] = Number(value);
    } else options[name] = resolve(value);
  }
  const session = await startCubeWorkbench(options);
  console.log(JSON.stringify({ cubeWorkspace: session.url, directory: session.model.root }));
  const stop = () => session.close().catch(error => { console.error(error.message); process.exitCode = 1; });
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  return session;
}
if (process.argv[1] && await realpath(resolve(process.argv[1])).then(value => value === fileURLToPath(import.meta.url), () => false))
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
