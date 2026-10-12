#!/usr/bin/env node
// MIT. Local customer application for the original SF88 and SF100 workflow.
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { openDatasetWorkspace } from './model.mjs';
import { check, safeCode, CATALOG_LIMIT } from './receiving.mjs';
import { datasetWorkspaceLaunch } from './launch.mjs';

const HOST = '127.0.0.1';
const security = {
  'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
};
const HELP = `Starforge dataset customer workspace

  node server.mjs --state ABSOLUTE_PRIVATE_DIRECTORY
       [--profile ABSOLUTE_PROFILE_JSON] [--operator-settings ABSOLUTE_PRIVATE_PRESET]
       [--analysis-python ABSOLUTE_PYTHON --analysis-checkout ABSOLUTE_CHECKOUT
        --analysis-directory ABSOLUTE_PRIVATE_DATABASE_DIRECTORY] [--port 8439]
       [--startup-format json]

Receive the merchant's original offer file, review the dataset query and caps,
then create and continue the original private acquisition. Keep this terminal
open for native per-page purchase approval. Existing host-selected native
sessions can be attached through --profile. No browser path input is executed.
The optional analysis configuration opens the original Python workspace from
the finalized original session and room. Ctrl+C drains owned work and preserves
every native page, purchase and delivered file.
`;

async function input(req, allowed, maximum = 16384) {
  check((req.headers['content-type'] ?? '').split(';')[0].trim() === 'application/json', 'DATASET_JSON_REQUIRED', undefined, 415);
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    check(size <= maximum, 'DATASET_REQUEST_TOO_LARGE', undefined, 413); chunks.push(chunk);
  }
  let value; try { value = JSON.parse(Buffer.concat(chunks)); } catch { check(false, 'DATASET_JSON_INVALID'); }
  check(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key)), 'DATASET_ACTION_FIELDS_INVALID');
  return value;
}
function params(url, allowed) {
  check([...url.searchParams.keys()].every(key => allowed.includes(key) && url.searchParams.getAll(key).length === 1), 'DATASET_QUERY_INVALID');
  return Object.fromEntries(url.searchParams);
}
function integer(value, fallback = 0) {
  if (value === undefined) return fallback;
  check(/^(0|[1-9][0-9]{0,6})$/.test(value), 'DATASET_RANGE_INVALID'); return Number(value);
}

export async function startDatasetWorkspace({ stateDirectory, profilePath = null, operatorSettings = null, analysis = null, port = 8439 } = {}) {
  check(Number.isInteger(port) && port >= 0 && port <= 65535, 'DATASET_PORT_INVALID');
  const assets = new Map(await Promise.all([
    ['/', 'index.html', 'text/html; charset=utf-8'], ['/app.mjs', 'app.mjs', 'text/javascript; charset=utf-8'],
    ['/style.css', 'style.css', 'text/css; charset=utf-8'],
  ].map(async ([path, name, type]) => [path, { type, raw: await readFile(new URL('./public/' + name, import.meta.url)) }])));
  const model = await openDatasetWorkspace({ stateDirectory, profilePath, operatorSettings, analysis });
  const capability = randomBytes(32).toString('hex'), secret = Buffer.from(capability);
  const tickets = new Map(), sockets = new Set(), transfers = new Set();
  let host, origin, closed = false, closing;
  const server = createServer(async (req, res) => {
    const reply = (status, type, raw, extra = {}) => {
      if (res.destroyed || res.headersSent) return;
      raw = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      res.writeHead(status, { ...security, 'content-type': type, 'content-length': String(raw.length), ...extra });
      res.end(req.method === 'HEAD' ? undefined : raw);
    };
    const json = (status, value) => reply(status, 'application/json; charset=utf-8', JSON.stringify(value));
    try {
      check(req.headers.host === host && (!req.headers.origin || req.headers.origin === origin) &&
        !['cross-site', 'same-site'].includes(req.headers['sec-fetch-site']), 'DATASET_ORIGIN_REQUIRED', undefined, 403);
      check(req.url?.startsWith('/') && !req.url.startsWith('//'), 'DATASET_TARGET_INVALID');
      const url = new URL(req.url, origin);
      if (['GET', 'HEAD'].includes(req.method) && assets.has(url.pathname) && !url.search) {
        const asset = assets.get(url.pathname); return reply(200, asset.type, asset.raw);
      }
      check(!closed, 'DATASET_WORKSPACE_CLOSED', undefined, 409);
      if (req.method === 'GET' && url.pathname === '/download') {
        const { ticket } = params(url, ['ticket']), saved = tickets.get(ticket);
        check(saved && saved.expires > Date.now(), 'DATASET_DOWNLOAD_EXPIRED', 'Request a new download link.', 401);
        tickets.delete(ticket);
        const controller = new AbortController(); transfers.add(controller);
        const disconnected = () => { if (!res.writableFinished) controller.abort(); };
        res.once('close', disconnected); req.once('aborted', disconnected);
        let file;
        try {
          file = await model.file(saved.session, saved.name); controller.signal.throwIfAborted();
          res.writeHead(200, { ...security, 'content-type': 'application/octet-stream',
            'content-disposition': 'attachment; filename="' + file.name + '"',
            'content-length': String(file.bytes), 'x-content-sha256': file.sha256 });
          await pipeline(file.handle.createReadStream({ autoClose: false, start: 0 }), res, { signal: controller.signal });
        } finally {
          res.off('close', disconnected); req.off('aborted', disconnected); transfers.delete(controller);
          await file?.handle.close();
        }
        return;
      }
      const supplied = Buffer.from(typeof req.headers['x-dataset-workspace-token'] === 'string' ? req.headers['x-dataset-workspace-token'] : '');
      check(supplied.length === secret.length && timingSafeEqual(supplied, secret), 'DATASET_CAPABILITY_REQUIRED', 'Open the complete private link from the launching terminal.', 401);
      if (req.method === 'GET') {
        if (url.pathname === '/api/state' && !url.search) return json(200, await model.state());
        if (url.pathname === '/api/source') { const value = params(url, ['id']); return json(200, await model.source(value.id)); }
        if (url.pathname === '/api/session') { const value = params(url, ['id']); return json(200, await model.session(value.id)); }
        if (url.pathname === '/api/job') { const value = params(url, ['id']); return json(200, model.job(value.id)); }
        if (url.pathname === '/api/accounting') { const value = params(url, ['session', 'offset']); return json(200, await model.accounting(value.session, integer(value.offset))); }
        if (url.pathname === '/api/preview') { const value = params(url, ['session', 'offset', 'limit']); return json(200, await model.preview(value.session, integer(value.offset), integer(value.limit, 50))); }
        if (url.pathname === '/api/handoff') { const value = params(url, ['session', 'alias']); return json(200, model.handoff(value.session, value.alias)); }
        if (url.pathname === '/api/manifest') {
          const value = params(url, ['session']), raw = await model.manifest(value.session);
          return reply(200, 'application/json; charset=utf-8', raw, { 'content-disposition': 'attachment; filename="acquisition-manifest.json"' });
        }
      }
      const actions = {
        '/api/receive': ['name', 'base64'],
        '/api/review': ['sourceId', 'name', 'rowIndex', 'acceptIndex', 'query', 'maxPages', 'maxRows', 'maxPageBytes', 'maxTotalAtomic', 'dailyAtomic'],
        '/api/prepare': ['reviewId'], '/api/start': ['actionId', 'session', 'kind', 'expectedRevision', 'alias'],
        '/api/cancel': ['id'], '/api/download-ticket': ['session', 'name'],
      };
      check(req.method === 'POST' && !url.search && actions[url.pathname], 'DATASET_ROUTE_NOT_FOUND', undefined, 404);
      check(req.headers.origin === origin, 'DATASET_ORIGIN_REQUIRED', undefined, 403);
      const value = await input(req, actions[url.pathname], url.pathname === '/api/receive' ? 4 * Math.ceil(CATALOG_LIMIT / 3) + 4096 : 16384);
      if (url.pathname === '/api/receive') return json(201, await model.receive(value));
      if (url.pathname === '/api/review') return json(200, await model.review(value));
      if (url.pathname === '/api/prepare') return json(201, await model.prepare(value.reviewId));
      if (url.pathname === '/api/start') return json(202, await model.start(value));
      if (url.pathname === '/api/cancel') return json(202, await model.cancel(value.id));
      if (url.pathname === '/api/download-ticket') {
        const session = await model.session(value.session);
        check(session.delivery?.files?.[value.name], 'DATASET_DELIVERY_REQUIRED');
        for (const [id, entry] of tickets) if (entry.expires < Date.now()) tickets.delete(id);
        if (tickets.size >= 32) tickets.delete(tickets.keys().next().value);
        const ticket = randomBytes(32).toString('hex');
        tickets.set(ticket, { ...value, expires: Date.now() + 60000 });
        return json(200, { url: '/download?ticket=' + ticket });
      }
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      json(error.status ?? 500, { error: safeCode(error), message: error.message ?? safeCode(error) });
    }
  });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000; server.maxRequestsPerSocket = 100;
  try { await new Promise((resolveReady, reject) => { server.once('error', reject); server.listen(port, HOST, resolveReady); }); }
  catch (error) { await model.close(); throw error; }
  host = HOST + ':' + server.address().port; origin = 'http://' + host;
  async function close() {
    if (closing) return closing;
    closed = true;
    closing = (async () => {
      const stopped = new Promise(resolveStopped => server.close(resolveStopped));
      for (const transfer of transfers) transfer.abort();
      await model.close(); tickets.clear(); server.closeIdleConnections();
      for (const socket of sockets) socket.destroy();
      await stopped;
    })();
    return closing;
  }
  return { url: origin + '/#' + capability, origin, close };
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 0 || argv.includes('--help')) { process.stdout.write(HELP); return; }
  const args = {}, allowed = ['--state', '--profile', '--operator-settings', '--port', '--analysis-python', '--analysis-checkout', '--analysis-directory', '--startup-format'];
  for (let index = 0; index < argv.length; index += 2) {
    check(allowed.includes(argv[index]) && args[argv[index]] === undefined && argv[index + 1], 'DATASET_ARGUMENTS_INVALID');
    args[argv[index]] = argv[index + 1];
  }
  check(args['--state'], 'DATASET_STATE_REQUIRED');
  check(args['--startup-format'] === undefined || args['--startup-format'] === 'json', 'DATASET_STARTUP_FORMAT_INVALID');
  if (args['--port'] !== undefined) check(/^(0|[1-9][0-9]{0,4})$/.test(args['--port']), 'DATASET_PORT_INVALID');
  const keys = ['--analysis-python', '--analysis-checkout', '--analysis-directory'];
  const configured = keys.some(key => args[key] !== undefined);
  check(!configured || keys.every(key => args[key]), 'DATASET_ANALYSIS_SETTINGS_REQUIRED');
  const settings = { stateDirectory: args['--state'], profilePath: args['--profile'] ?? null,
    operatorSettings: args['--operator-settings'] ?? null, port: args['--port'] === undefined ? 8439 : Number(args['--port']),
    analysis: configured ? { python: args['--analysis-python'], checkout: args['--analysis-checkout'], directory: args['--analysis-directory'] } : null };
  const workspace = await startDatasetWorkspace(settings);
  process.stdout.write(args['--startup-format'] === 'json'
    ? JSON.stringify(datasetWorkspaceLaunch(settings, workspace.url)) + '\n'
    : 'Dataset customer workspace: ' + workspace.url + '\n');
  process.stdout.write('Keep this terminal open for original per-page purchase approval.\n');
  let stopping = false;
  const stop = async () => {
    if (stopping) return; stopping = true;
    try { await workspace.close(); }
    catch (error) { process.stderr.write(safeCode(error) + '\n'); process.exitCode = 1; }
    finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
  };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { process.stderr.write(safeCode(error) + '\n'); process.exitCode = 1; });

