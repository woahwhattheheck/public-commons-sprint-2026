#!/usr/bin/env node
// MIT. Private loopback presentation for the original object buyer workflow.
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { openObjectWorkspace, workspaceError, fail } from './model.mjs';
import { OBJECT_RECEIVING_REQUEST_LIMIT } from './intake.mjs';

const HOST = '127.0.0.1';
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
const security = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
  'content-security-policy': CSP, 'referrer-policy': 'no-referrer', 'cross-origin-resource-policy': 'same-origin' };
const HELP = `Starforge object buyer workspace

  node server.mjs --state ABSOLUTE_PRIVATE_DIRECTORY [--profile ABSOLUTE_PROFILE_JSON]
       [--operator-settings ABSOLUTE_PRIVATE_PRESET] [--port 8438]

An optional trusted profile selects existing merchant objects and native buyer
workspaces. Existing sessions reopen from --state without a profile. The native
buyer keeps per-chunk approval in this launching terminal. Ctrl+C stops owned
work, closes the private browser server and retains every original session.
The original local operator preset also enables receiving public merchant object
descriptions and offers, then creating a private buyer and reviewed download.
Backup and recovery uses a separate SF88_BACKUP_PASSPHRASE environment variable
set before launch. The browser receives its name only, never its value.
`;

async function input(req, allowed, maximum = 8192) {
  if ((req.headers['content-type'] ?? '').split(';')[0].trim() !== 'application/json')
    fail('OBJECT_WORKSPACE_JSON_REQUIRED', 415);
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maximum) fail('OBJECT_WORKSPACE_REQUEST_TOO_LARGE', 413);
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks)); } catch { fail('OBJECT_WORKSPACE_JSON_INVALID'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).some(key => !allowed.includes(key))) fail('OBJECT_WORKSPACE_ACTION_FIELDS_INVALID');
  return value;
}
function params(url, names) {
  if ([...url.searchParams.keys()].some(key => !names.includes(key) || url.searchParams.getAll(key).length !== 1))
    fail('OBJECT_WORKSPACE_QUERY_INVALID');
  return Object.fromEntries(url.searchParams);
}

/** Run the native model on a fixed loopback interface, with a per-instance capability. */
export async function startObjectWorkspace({ stateDirectory, profilePath = null, operatorSettings, port = 8438 } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) fail('OBJECT_WORKSPACE_PORT_INVALID');
  const model = await openObjectWorkspace({ stateDirectory, profilePath, operatorSettings });
  const token = randomBytes(32).toString('hex'), tokenBytes = Buffer.from(token);
  const assets = new Map(await Promise.all([
    ['/', 'index.html', 'text/html; charset=utf-8'],
    ['/app.mjs', 'app.mjs', 'text/javascript; charset=utf-8'],
    ['/style.css', 'style.css', 'text/css; charset=utf-8'],
  ].map(async ([path, filename, type]) => [path, { bytes: await readFile(new URL('./public/' + filename, import.meta.url)), type }])));
  const tickets = new Map(), sockets = new Set(), downloadControllers = new Set();
  let origin, host, closing, closed = false;
  const server = createServer(async (req, res) => {
    const reply = (status, type, bytes, headers = {}) => {
      if (res.destroyed || res.headersSent) return;
      if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
      res.writeHead(status, { ...security, 'content-type': type, 'content-length': String(bytes.length), ...headers });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    };
    const send = (status, value) => reply(status, 'application/json; charset=utf-8', JSON.stringify(value));
    try {
      if (req.headers.host !== host || req.headers.origin && req.headers.origin !== origin ||
        ['cross-site', 'same-site'].includes(req.headers['sec-fetch-site'])) fail('OBJECT_WORKSPACE_ORIGIN_REQUIRED', 403);
      if (!req.url?.startsWith('/') || req.url.startsWith('//')) fail('OBJECT_WORKSPACE_TARGET_INVALID');
      const url = new URL(req.url, origin);
      if (['GET', 'HEAD'].includes(req.method) && assets.has(url.pathname) && !url.search) {
        const asset = assets.get(url.pathname); return reply(200, asset.type, asset.bytes);
      }
      if (closed) fail('OBJECT_WORKSPACE_CLOSED', 409);
      // One-use, short-lived download links support native streamed browser
      // downloads without buffering a large object into a browser Blob.
      if (req.method === 'GET' && url.pathname === '/download') {
        const value = params(url, ['ticket']), ticket = tickets.get(value.ticket);
        if (!ticket || ticket.expires < Date.now()) fail('OBJECT_WORKSPACE_DOWNLOAD_EXPIRED', 401);
        tickets.delete(value.ticket);
        const controller = new AbortController();
        const disconnected = () => { if (!res.writableFinished) controller.abort(); };
        downloadControllers.add(controller);
        res.once('close', disconnected); req.once('aborted', disconnected);
        if (res.destroyed || req.aborted) controller.abort();
        let saved, failure;
        try {
          const accounting = ticket.kind === 'accounting';
          saved = accounting ? await model.openAccountingExport(ticket.session) :
            await model.openDownload(ticket.session, { signal: controller.signal });
          const signal = AbortSignal.any([saved.signal, controller.signal]); signal.throwIfAborted();
          res.writeHead(200, { ...security,
            'content-type': accounting ? 'application/x-ndjson; charset=utf-8' : 'application/octet-stream',
            'content-disposition': 'attachment; filename="' + saved.name + '"',
            ...(accounting ? {} : { 'content-length': String(saved.bytes), 'x-content-sha256': saved.sha256 }) });
          await pipeline(Readable.from(saved.body, { objectMode: false, highWaterMark: 65536 }), res, { signal });
        } catch (error) { failure = error; throw error; }
        finally {
          res.off('close', disconnected); req.off('aborted', disconnected);
          downloadControllers.delete(controller); await saved?.finish(failure);
        }
        return;
      }
      const supplied = Buffer.from(typeof req.headers['x-object-workspace-token'] === 'string' ? req.headers['x-object-workspace-token'] : '');
      if (supplied.length !== tokenBytes.length || !timingSafeEqual(supplied, tokenBytes))
        fail('OBJECT_WORKSPACE_CAPABILITY_REQUIRED', 401);
      if (req.method === 'GET' && url.pathname === '/api/products' && !url.search)
        return send(200, { products: await model.products() });
      if (req.method === 'GET' && url.pathname === '/api/receiving' && !url.search)
        return send(200, await model.receivingState());
      if (req.method === 'GET' && url.pathname === '/api/recovery' && !url.search)
        return send(200, await model.recoveryState());
      if (req.method === 'GET' && url.pathname === '/api/receiving/options') {
        const value = params(url, ['id', 'objectId']);
        return send(200, await model.receivingOptions(value.id, value.objectId));
      }
      if (req.method === 'GET' && url.pathname === '/api/state') {
        const values = params(url, ['session', 'page', 'filter', 'query', 'section']);
        if (values.page !== undefined && !/^(0|[1-9][0-9]{0,3})$/.test(values.page)) fail('OBJECT_WORKSPACE_PAGE_INVALID');
        return send(200, await model.view({ ...values, ...(values.page === undefined ? {} : { page: Number(values.page) }) }));
      }
      if (req.method === 'GET' && url.pathname === '/api/export') {
        const values = params(url, ['session', 'kind']);
        const output = await model.exportReport(values.session, values.kind);
        return reply(200, output.type, output.bytes, { 'content-disposition': 'attachment; filename="' + output.name + '"' });
      }
      const actions = {
        '/api/review': ['productId', 'sessionName', 'chunkBytes', 'maxTotalAtomic'],
        '/api/create': ['reviewId'], '/api/refresh': ['session', 'section'],
        '/api/run': ['session', 'expectedRevision', 'actionId'], '/api/stop': ['session', 'runId'],
        '/api/finalize': ['session', 'expectedRevision', 'actionId'],
        '/api/recover': ['session', 'expectedRevision'], '/api/assemble': ['session', 'expectedRevision'],
        '/api/download-ticket': ['session'], '/api/accounting-export-ticket': ['session'],
        '/api/receiving/receive': ['descriptionName', 'descriptionBase64', 'catalogName', 'catalogBase64'],
        '/api/receiving/review': ['id', 'objectId', 'rowIndex', 'acceptIndex', 'chunkBytes', 'sessionName', 'maxTotalAtomic', 'dailyAtomic'],
        '/api/receiving/create': ['reviewId'],
        '/api/recovery/review': ['stateRoot'],
        '/api/recovery/start': ['kind', 'actionId', 'stateRoot', 'output', 'expectedReviewSha256',
          'passEnv', 'quiesced', 'bundle', 'expected'],
      };
      if (req.method !== 'POST' || url.search || !actions[url.pathname]) fail('OBJECT_WORKSPACE_ROUTE_NOT_FOUND', 404);
      if (req.headers.origin !== origin) fail('OBJECT_WORKSPACE_ORIGIN_REQUIRED', 403);
      const value = await input(req, actions[url.pathname],
        url.pathname === '/api/receiving/receive' ? OBJECT_RECEIVING_REQUEST_LIMIT : 8192);
      if (url.pathname === '/api/recovery/review') return send(200, await model.inspectRecovery(value));
      if (url.pathname === '/api/recovery/start') return send(202, model.startRecovery(value));
      if (url.pathname === '/api/receiving/receive') return send(201, await model.receive(value));
      if (url.pathname === '/api/receiving/review') return send(200, await model.reviewReceived(value));
      if (url.pathname === '/api/receiving/create') return send(201, await model.createReceived(value));
      if (url.pathname === '/api/review') return send(200, await model.reviewSelection(value));
      if (url.pathname === '/api/create') return send(201, await model.create(value));
      if (url.pathname === '/api/refresh') { await model.refresh(value.session ?? null, value.section ?? 'delivery'); return send(200, { refreshed: true }); }
      if (url.pathname === '/api/run') return send(202, await model.run(value));
      if (url.pathname === '/api/finalize') return send(202, await model.finalize(value));
      if (url.pathname === '/api/stop') return send(202, model.stop(value));
      if (url.pathname === '/api/recover') { await model.recover(value); return send(200, { recovered: true }); }
      if (url.pathname === '/api/assemble') { await model.assemble(value); return send(200, { assembled: true }); }
      if (url.pathname === '/api/download-ticket' || url.pathname === '/api/accounting-export-ticket') {
        const accounting = url.pathname === '/api/accounting-export-ticket';
        const state = await model.view({ session: value.session, section: accounting ? 'accounting' : 'delivery' });
        if (!state.selected?.controls[accounting ? 'export' : 'download'])
          fail(accounting ? 'OBJECT_WORKSPACE_BUSY' : 'OBJECT_WORKSPACE_ASSEMBLY_REQUIRED', 409);
        for (const [id, item] of tickets) if (item.expires < Date.now()) tickets.delete(id);
        if (tickets.size >= 32) tickets.delete(tickets.keys().next().value);
        const ticket = randomBytes(32).toString('hex');
        tickets.set(ticket, { session: value.session, kind: accounting ? 'accounting' : 'file', expires: Date.now() + 60000 });
        return send(200, { url: '/download?ticket=' + ticket, expiresInSeconds: 60 });
      }
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      const code = workspaceError(error);
      const conflict = /(?:CHANGED|OCCUPIED|EXISTS|LOCK|BUSY|RECONCILIATION|REVIEW|UNAVAILABLE)/.test(code);
      send(error.status ?? (conflict ? 409 : 400), { error: code });
    }
  });
  server.on('connection', socket => {
    sockets.add(socket); socket.once('close', () => sockets.delete(socket));
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000;
  server.maxRequestsPerSocket = 100;
  try {
    await new Promise((resolveReady, reject) => {
      server.once('error', reject); server.listen(port, HOST, resolveReady);
    });
  } catch (error) { await model.close(); throw error; }
  host = HOST + ':' + server.address().port; origin = 'http://' + host;
  async function close() {
    if (closing) return closing;
    closed = true;
    closing = (async () => {
      const serverClosed = new Promise(resolveClosed => server.close(resolveClosed));
      for (const controller of downloadControllers) controller.abort();
      await model.close(); tickets.clear();
      server.closeIdleConnections();
      // The native buyer and exact file reads have drained. Partial requests
      // and disconnected download consumers cannot keep the listener alive.
      for (const socket of sockets) socket.destroy();
      await serverClosed;
    })();
    return closing;
  }
  return { url: origin + '/#' + token, origin, close };
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 0 || argv.includes('--help')) { process.stdout.write(HELP); return; }
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!['--state', '--profile', '--operator-settings', '--port'].includes(key) || options[key] !== undefined || !argv[i + 1])
      fail('OBJECT_WORKSPACE_ARGUMENTS_INVALID');
    options[key] = argv[i + 1];
  }
  if (!options['--state']) fail('OBJECT_WORKSPACE_STATE_REQUIRED');
  if (options['--port'] !== undefined && !/^(0|[1-9][0-9]{0,4})$/.test(options['--port'])) fail('OBJECT_WORKSPACE_PORT_INVALID');
  const workspace = await startObjectWorkspace({ stateDirectory: options['--state'],
    profilePath: options['--profile'] ?? null, operatorSettings: options['--operator-settings'],
    port: options['--port'] === undefined ? 8438 : Number(options['--port']) });
  process.stdout.write('Object buyer workspace: ' + workspace.url + '\nKeep this terminal open for original per-chunk approval.\n');
  let stopping = false;
  const stop = async () => {
    if (stopping) return; stopping = true;
    try { await workspace.close(); }
    catch (error) { process.stderr.write(workspaceError(error) + '\n'); process.exitCode = 1; }
    finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
  };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { process.stderr.write(workspaceError(error) + '\n'); process.exitCode = 1; });
