#!/usr/bin/env node
// MIT. Private loopback browser for SFTP sources and original dataset publishers.
import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { openSftpWorkbench } from './model.mjs';

const HELP = [
  'SFTP dataset workspace — Node 22+, private loopback browser', '',
  '  node workspace/server.mjs --state NEW_DIRECTORY [--source SOURCE.json --merchant MERCHANT.json] [--port 0]',
  '  node workspace/server.mjs --state EXISTING_DIRECTORY [--port 0]',
  '  Add --dataset-facilitator HTTPS_URL for the original native x402 dataset seller.',
  '  A local development facilitator also requires --allow-local-dataset-facilitator.', '',
  'Open the complete printed URL. SSH keys, passwords, and passphrases stay in environment references.',
  'Save a pinned source, inspect complete retained files, map reports, set payment choices,',
  'then open each dataset product’s original publication and recurring-refresh console.',
].join('\n');
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);
const failure = (message, status = 400) => Object.assign(new TypeError(message), { status });
function json(res, status, value) {
  const content = Buffer.from(JSON.stringify(value));
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': content.length });
  res.end(content);
}
function queryFields(url, allowed) {
  for (const name of url.searchParams.keys())
    if (!allowed.includes(name) || url.searchParams.getAll(name).length !== 1) throw failure('Unsupported query fields');
}
async function input(req) {
  if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? ''))
    throw failure('Send application/json', 415);
  const chunks = []; let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 1048576) throw failure('Source and merchant settings exceed 1 MiB', 413);
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw failure('Send a valid UTF-8 JSON object'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure('Send a JSON object');
  return value;
}
async function download(res, file) {
  res.writeHead(200, { 'content-type': file.type, 'content-length': file.size ?? file.bytes.length,
    'content-disposition': 'attachment; filename="' + file.name.replaceAll('"', '') + '"' });
  if (!file.handle) return res.end(file.bytes);
  try { await pipeline(file.handle.createReadStream({ autoClose: false }), res); }
  finally { await file.handle.close(); }
}

export async function startSftpWorkbench({ port = 0, ...options } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw failure('Port must be 0–65535');
  const model = await openSftpWorkbench(options), token = randomBytes(32).toString('base64url');
  const expected = Buffer.from('Bearer ' + token);
  let origin, closing = false, pending = Promise.resolve();
  const mutate = action => { const result = pending.then(action); pending = result.catch(() => {}); return result; };
  const server = createServer((req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    Promise.resolve().then(async () => {
      if (closing) return json(res, 503, { error: 'Workspace is closing' });
      if (req.headers.host !== new URL(origin).host) return json(res, 403, { error: 'Use the printed loopback origin' });
      const url = new URL(req.url, origin);
      if (url.origin !== origin || url.hash) throw failure('Invalid request target');
      if (req.method === 'GET' && assets.has(url.pathname) && !url.search) {
        const [name, type] = assets.get(url.pathname), content = await readFile(new URL('./public/' + name, import.meta.url));
        res.writeHead(200, { 'content-type': type, 'content-length': content.length }); return res.end(content);
      }
      if (!url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Not found' });
      const supplied = Buffer.from(req.headers.authorization ?? '');
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
        return json(res, 401, { error: 'Open the complete workspace URL printed by the launch terminal' });
      if (req.headers.origin && req.headers.origin !== origin || req.method !== 'GET' && req.headers.origin !== origin)
        return json(res, 403, { error: 'Workspace changes require its exact browser origin' });
      const publication = /^\/api\/publications\/([a-z][a-z0-9-]+)(?:\/(.*))?$/.exec(url.pathname);
      let result;
      if (req.method === 'GET') {
        if (url.pathname === '/api/state') { queryFields(url, []); result = await model.inspect(); }
        else if (/^\/api\/revisions\/[1-9]\d{0,8}$/.test(url.pathname)) {
          queryFields(url, []); result = await model.revision(Number(url.pathname.split('/').at(-1)));
        } else if (publication) {
          const [, selected, action] = publication;
          if (!action) { queryFields(url, []); result = await model.inspectPublication(selected); }
          else if (action === 'run') {
            queryFields(url, ['runId']); result = await model.inspectRun(selected, url.searchParams.get('runId'));
          } else if (action === 'buyer') {
            queryFields(url, ['runId', 'query']);
            result = await model.buyerOffer(selected, url.searchParams.get('runId'), url.searchParams.get('query') ?? '');
          } else if (/^files\/[a-f0-9-]+\/(?:data\.csv|dataset\.json|candidate\.json)$/.test(action)) {
            queryFields(url, []); const [, runId, name] = action.split('/');
            return download(res, await model.candidateFile(selected, runId, name));
          } else return json(res, 404, { error: 'Not found' });
        } else if (/^\/api\/files\/(?:revision|buyer)\/[^/]+\/[^/]+$/.test(url.pathname)) {
          queryFields(url, []); const [, , , kind, selected, name] = url.pathname.split('/');
          return download(res, await model.file(kind, selected, name));
        } else return json(res, 404, { error: 'Not found' });
      } else if (req.method === 'POST') {
        queryFields(url, []); const value = await input(req);
        if (url.pathname === '/api/save') result = await mutate(() => model.save(value));
        else if (url.pathname === '/api/catalogue') result = await mutate(() => model.catalogue(value));
        else if (url.pathname === '/api/sample') result = await mutate(() => model.sample(value));
        else if (url.pathname === '/api/publications') result = await mutate(() => model.createPublication(value));
        else if (publication && ['seller/start', 'seller/stop', 'buyer'].includes(publication[2]))
          result = await mutate(() => model.publicationAction(publication[1], publication[2], value));
        else return json(res, 404, { error: 'Not found' });
      } else return json(res, 405, { error: 'Use GET or POST' });
      json(res, 200, result);
    }).catch(issue => {
      if (res.headersSent) return res.destroy();
      json(res, issue.status ?? (issue.code === 'ENOENT' ? 404 : issue.code === 'EEXIST' ? 409 : 400),
        { error: issue.message, ...(issue.code ? { code: issue.code } : {}) });
    });
  });
  server.requestTimeout = 20000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000;
  try { await new Promise((done, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', done); }); }
  catch (issue) { await model.close(); throw issue; }
  origin = 'http://127.0.0.1:' + server.address().port;
  let shutdown;
  const close = () => shutdown ??= (async () => {
    closing = true;
    const stopped = new Promise((done, fail) => server.close(issue => issue ? fail(issue) : done()));
    server.closeIdleConnections();
    const results = await Promise.allSettled([pending, model.close(), stopped]);
    const failed = results.find(item => item.status === 'rejected');
    if (failed) throw failed.reason;
  })();
  return { model, server, origin, url: origin + '/#' + token, close };
}

export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.length === 1 && args[0] === '--help') { console.log(HELP); return; }
  const options = {}, names = { '--state': 'directory', '--source': 'sourcePath', '--merchant': 'merchantPath',
    '--port': 'port', '--dataset-facilitator': 'datasetFacilitator' };
  let allowLocalDatasetFacilitator = false;
  for (let index = 0; index < args.length;) {
    if (args[index] === '--allow-local-dataset-facilitator') {
      if (allowLocalDatasetFacilitator) throw failure(HELP);
      allowLocalDatasetFacilitator = true; index++; continue;
    }
    const name = names[args[index]], value = args[index + 1];
    if (!name || Object.hasOwn(options, name) || !value || value.startsWith('--')) throw failure(HELP);
    if (name === 'port') {
      if (!/^(0|[1-9]\d{0,4})$/.test(value)) throw failure('Port must be 0–65535');
      options[name] = Number(value);
    } else options[name] = name === 'datasetFacilitator' ? value : resolve(value);
    index += 2;
  }
  if (!options.directory || allowLocalDatasetFacilitator && !options.datasetFacilitator) throw failure(HELP);
  if (options.datasetFacilitator) {
    const url = new URL(options.datasetFacilitator);
    const local = allowLocalDatasetFacilitator && url.protocol === 'http:' && url.hostname === '127.0.0.1';
    if ((!local && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash)
      throw failure('Dataset facilitator requires HTTPS or explicitly enabled local HTTP');
    const [{ HTTPFacilitatorClient }, { createNativeSellerServer }] = await Promise.all([
      import('@x402/core/server'), import('../../native-factory.mjs'),
    ]);
    options.datasetNativeFactory = compiled => createNativeSellerServer(compiled, {
      facilitatorClient: new HTTPFacilitatorClient({ url: url.href.replace(/\/$/, '') }),
    });
    delete options.datasetFacilitator;
  }
  const session = await startSftpWorkbench(options);
  console.log(JSON.stringify({ sftpWorkspace: session.url, directory: session.model.directory }));
  const stop = () => session.close().catch(issue => { console.error(issue.message); process.exitCode = 1; });
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  return session;
}
if (process.argv[1] && await realpath(resolve(process.argv[1])).then(path => path === fileURLToPath(import.meta.url), () => false))
  main().catch(issue => { console.error(issue.message); process.exitCode = 1; });
