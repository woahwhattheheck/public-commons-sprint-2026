#!/usr/bin/env node
// MIT. Private operator HTTP and original provider webhook intake.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { randomBytes } from 'node:crypto';
import {
  need, hash, directory, readJSON, jsonBytes, confined, safeEqual,
  publicError, writeStream,
} from './lib/files.mjs';
import {parseSourceJSON} from './lib/source-json.mjs';
import {assertExactNativeNumbers} from './lib/provider-auth.mjs';
import { openAmeroWorkspace, AMERO_METHODS } from './lib/workspace.mjs';
import { streamAmeroDelivery, unpackAmeroDelivery } from './lib/archive.mjs';

const SOURCE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']],
  ['/journal.mjs', ['journal.mjs', 'text/javascript; charset=utf-8']],
  ['/sha256.mjs', ['sha256.mjs', 'text/javascript; charset=utf-8']],
  ['/collective-display.mjs', ['collective-display.mjs', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);

async function readBody(request, maximumBytes = 1024 * 1024) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    need(bytes <= maximumBytes, 'REQUEST_TOO_LARGE');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, bytes);
}

function send(response, status, value) {
  const bytes = jsonBytes(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': bytes.length, 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(bytes);
}

function statusFor(error) {
  if (['AUTHORIZATION_REQUIRED'].includes(error.code)) return 401;
  if (['WORKSPACE_ID_MISMATCH', 'ORIGIN_NOT_ALLOWED'].includes(error.code)) return 403;
  if (['RECORD_NOT_FOUND', 'FILE_NOT_AVAILABLE', 'ROUTE_NOT_FOUND'].includes(error.code)) return 404;
  if (['REVISION_CONFLICT', 'REQUEST_ID_CONFLICT', 'OPERATION_BUSY',
    'PROVIDER_DISPATCH_DISABLED', 'LEASE_UNAVAILABLE'].includes(error.code)) return 409;
  if (['REQUEST_TOO_LARGE', 'UPLOAD_TOO_LARGE'].includes(error.code)) return 413;
  return error.code ? 400 : 500;
}

export async function startAmeroServer({
  directory: workspaceDirectory,
  configuration = {},
  configurationFile,
  host = '127.0.0.1',
  port = 8781,
  token,
  sourceDirectory = SOURCE_DIRECTORY,
  runtimeDirectory,
  expectedManifestSha256,
  signal,
} = {}) {
  if (configurationFile) {
    configuration = { ...await readJSON(configurationFile), ...configuration };
  }
  token = token ?? configuration.operatorToken;
  const retainedTokenSelected = !token;
  const tokenFile = path.join(workspaceDirectory, 'operator-token.private.json');
  if (!token) {
    await directory(workspaceDirectory);
    let saved = await readJSON(tokenFile, true);
    if (!saved) {
      saved = { token: randomBytes(32).toString('base64url') };
      const { writeExact } = await import('./lib/files.mjs');
      await writeExact(tokenFile, jsonBytes(saved));
    }
    token = saved.token;
  }
  need(typeof token === 'string' && token.length >= 24, 'OPERATOR_TOKEN_REQUIRED');
  const workspace = await openAmeroWorkspace({
    directory: workspaceDirectory, connections: configuration.connections ?? {},
    name: configuration.name, sourceDirectory,
    runtimeDirectory: runtimeDirectory ?? configuration.runtimeDirectory,
    expectedManifestSha256: expectedManifestSha256 ?? configuration.expectedManifestSha256,
  });
  const initial = workspace.describe().workspace.id;
  const aborter = new AbortController();
  const inFlight = new Set();
  let closing = false;
  let origin,worker=null,workerError=null;

  let server=null,closePromise,workspaceClosed=false;
  function close() {
    if(closePromise)return closePromise;
    closing=true;
    closePromise=(async()=>{
      aborter.abort('server-closing');
      signal?.removeEventListener('abort',close);
      const errors=[];
      try{await worker?.close();}catch(error){errors.push(error);}
      let stopped=Promise.resolve();
      if(server){
        stopped=new Promise(resolve=>server.close(error=>{
          if(error&&error.code!=='ERR_SERVER_NOT_RUNNING')errors.push(error);
          resolve();
        }));
        server.closeIdleConnections?.();
      }
      await Promise.allSettled([...inFlight]);
      server?.closeAllConnections?.();
      await stopped;
      if(!workspaceClosed){
        try{await workspace.close();workspaceClosed=true;}catch(error){errors.push(error);}
      }
      if(errors.length)throw new AggregateError(errors,'Amero server closure failed.');
    })();
    closePromise.catch(()=>{closePromise=null;});
    return closePromise;
  }
  try {

  function authorized(request) {
    const value = request.headers.authorization;
    need(typeof value === 'string' && value.startsWith('Bearer ') &&
      safeEqual(value.slice(7), token), 'AUTHORIZATION_REQUIRED');
  }

  function mutation(request) {
    need(request.headers['x-amero-workspace-id'] === initial &&
      workspace.describe().workspace.id === initial, 'WORKSPACE_ID_MISMATCH');
    if (request.headers.origin) {
      const allowed = new Set([origin, ...(configuration.operatorOrigins ?? [])]);
      need(allowed.has(request.headers.origin), 'ORIGIN_NOT_ALLOWED');
    }
  }

  async function projectQueuedWebhook(id) {
    try {
      await workspace.command({
        requestId: 'project-webhook:' + id,
        method: 'webhook.reconcile', args: { webhookId: id }, signal: aborter.signal,
      });
    } catch {
      // Its original request and failure remain visible for operator reconciliation.
    }
  }

  async function route(request, response) {
    const url = new URL(request.url, origin ?? 'http://127.0.0.1');
    if (request.method === 'POST' && url.pathname.startsWith('/webhooks/provider/')) {
      const segments = url.pathname.split('/').slice(3);
      need(segments.length === 2 && segments.every(Boolean), 'ROUTE_NOT_FOUND');
      const [connectionAlias, subscriptionId] = segments.map(decodeURIComponent);
      const body = await readBody(request, configuration.webhookMaximumBytes ?? 16 * 1024 * 1024);
      const result = await workspace.webhook({
        connectionAlias, subscriptionId, body,
        headers: Object.fromEntries(Object.entries(request.headers)
          .filter(([key]) => !['authorization', 'cookie'].includes(key))),
      });
      send(response, result.accepted ? 200 : 401, result);
      if (result.accepted) {
        const work = projectQueuedWebhook(result.id);
        inFlight.add(work);
        work.finally(() => inFlight.delete(work));
      }
      return;
    }
    if (request.method === 'GET' && ASSETS.has(url.pathname)) {
      const [filename, contentType] = ASSETS.get(url.pathname);
      const file = await confined(path.join(sourceDirectory, 'web'), filename);
      const stat = await fs.stat(file);
      response.writeHead(200, {
        'content-type': contentType, 'content-length': stat.size,
        'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        'content-security-policy': "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-src blob:; base-uri 'none'; frame-ancestors 'none'",
      });
      await pipeline(createReadStream(file), response);
      return;
    }
    authorized(request);
    if (request.method === 'GET' && url.pathname === '/api/bootstrap') {
      send(response, 200, {
        ...workspace.describe(),
        operator:{origin,directory:workspaceDirectory,sourceDirectory,
          webhooks:{enabled:configuration.webhookWorker?.enabled!==false,
            selected:configuration.webhookWorker?.enabled!==false,
            pollSeconds:configuration.webhookWorker?.pollSeconds??15,
            active:Boolean(worker)&&!closing&&!workerError,error:workerError}},
      });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/list') {
      const query = Object.fromEntries(url.searchParams);
      if (query.limit !== undefined) query.limit = Number(query.limit);
      send(response, 200, workspace.list(query));
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/item') {
      send(response, 200, workspace.item(url.searchParams.get('table'), url.searchParams.get('id')));
      return;
    }
    if (request.method === 'GET' && url.pathname.startsWith('/api/file/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/file/'.length));
      const descriptor = workspace.file(id);
      const body = await workspace.fileBytes(id);
      response.writeHead(200, {
        'content-type': descriptor.contentType, 'content-length': body.length,
        'content-disposition': 'inline; filename="' + descriptor.filename.replace(/["\\\r\n]/g, '_') + '"',
        'x-content-sha256': descriptor.sha256,
        'content-security-policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:",
        'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
      });
      response.end(body);
      return;
    }
    if (request.method === 'GET' && /^\/api\/exports\/[^/]+\/archive$/.test(url.pathname)) {
      const id = decodeURIComponent(url.pathname.split('/')[3]);
      const selected = workspace.privateItem('exports', id);
      const output = await streamAmeroDelivery({
        sourceDirectory: selected.directory,
        expectedManifestSha256: selected.manifestSha256,
        signal: aborter.signal,
      });
      response.writeHead(200, {
        'content-type': 'application/gzip',
        'content-disposition': 'attachment; filename="amero-' + hash(id).slice(0, 16) + '.tar.gz"',
        'x-amero-manifest-sha256': selected.manifestSha256,
        'cache-control': 'no-store',
      });
      await pipeline(output, response, { signal: aborter.signal });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/command') {
      mutation(request);
      const body = assertExactNativeNumbers(parseSourceJSON(await readBody(request,16*1024*1024),{maxBytes:16*1024*1024}));
      need(AMERO_METHODS.some(method => method.name === body.method), 'UNKNOWN_METHOD');
      send(response, 200, await workspace.command({ ...body, signal: aborter.signal }));
      return;
    }
    if (request.method === 'POST' && ['/api/source-import','/api/files/upload'].includes(url.pathname)) {
      mutation(request);
      const args = assertExactNativeNumbers(parseSourceJSON(Buffer.from(url.searchParams.get('args')??'{}')));
      need(typeof args.requestId === 'string' && args.requestId, 'REQUEST_ID_REQUIRED');
      const expected = request.headers['x-content-sha256'];
      need(typeof expected === 'string' && /^[a-f0-9]{64}$/.test(expected),
        'ORIGINAL_UPLOAD_HASH_REQUIRED');
      const relative = 'incoming/uploads/' + hash(args.requestId) + '/' + expected;
      const uploaded = await writeStream(workspaceDirectory, relative, request, {
        expectedSha256: expected, maximumBytes: configuration.maximumUploadBytes ?? 64 * 1024 * 1024,
        signal: aborter.signal,
      });
      const original = await fs.readFile(await confined(workspaceDirectory, uploaded.path));
      const descriptor = await workspace.retainFile(original, {
        filename: args.filename ?? 'original-provider-source.json',
        contentType: request.headers['content-type'] ?? 'application/json', private: true,
      });
      if (url.pathname === '/api/files/upload') {
        send(response,200,await workspace.command({
          requestId:args.requestId,expectedRevision:args.expectedRevision,
          method:'file.retain',args:{fileId:descriptor.id},signal:aborter.signal,
        }));
        return;
      }
      const {requestId,expectedRevision,filename,method='source.import',...selection}=args;
      need(method==='source.import','INVALID_UPLOAD_METHOD');
      send(response, 200, await workspace.command({
        requestId, expectedRevision, method,
        args: { ...selection, fileId: descriptor.id }, signal: aborter.signal,
      }));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/packages/unpack') {
      mutation(request);
      const requestId = url.searchParams.get('requestId');
      need(requestId, 'REQUEST_ID_REQUIRED');
      const queryHash = url.searchParams.get('manifestSha256');
      const headerHash = request.headers['x-amero-manifest-sha256'];
      need(!queryHash || !headerHash || queryHash === headerHash, 'DELIVERY_MANIFEST_MISMATCH');
      const expected = headerHash ?? queryHash;
      if (expected) need(/^[a-f0-9]{64}$/.test(expected), 'INVALID_MANIFEST_HASH');
      const destination = path.join(workspaceDirectory, 'incoming/packages', hash(requestId));
      send(response, 200, await unpackAmeroDelivery({
        input: request, destination, expectedManifestSha256: expected,
        signal: aborter.signal,
      }));
      return;
    }
    throw Object.assign(new Error('Route not found.'), { code: 'ROUTE_NOT_FOUND' });
  }

  server = http.createServer((request, response) => {
    if (closing) { send(response, 503, { error: { code: 'SERVER_DRAINING' } }); return; }
    const work = route(request, response).catch(error => {
      if (!response.headersSent) {
        send(response, statusFor(error), { error: publicError(error) });
      } else response.destroy(error);
      if (!request.complete) request.destroy();
    });
    inFlight.add(work);
    work.finally(() => inFlight.delete(work));
  });
  server.requestTimeout = 0;
  server.headersTimeout = 60000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  origin = 'http://' + (host.includes(':') ? '[' + host + ']' : host) + ':' + address.port;
  const startup = {
    schema: 'amero.operations-startup.v1', workspaceId: initial,
    directory: workspaceDirectory, sourceDirectory, origin, port: address.port,
    operatorTokenFile: retainedTokenSelected ? tokenFile : null,
    runtimeDirectory: runtimeDirectory ?? configuration.runtimeDirectory ?? null,
    expectedManifestSha256: expectedManifestSha256 ?? configuration.expectedManifestSha256 ?? null,
  };
  const queued = workspace.privateList('webhooks').filter(row => row.status === 'RETAINED' && row.verified);
  for (const row of queued) {
    const work = projectQueuedWebhook(row.id);
    inFlight.add(work);
    work.finally(() => inFlight.delete(work));
  }
  if(configuration.webhookWorker?.enabled !== false) {
    try {
      const {startAmeroWorker}=await import('./worker.mjs');
      worker=await startAmeroWorker({workspace,configuration,signal:aborter.signal,
        pollSeconds:configuration.webhookWorker?.pollSeconds ?? 15});
      worker.done.catch(error=>{workerError=publicError(error);});
    } catch(error) { await close();throw error; }
  }
  signal?.addEventListener('abort',close,{once:true});
  if(signal?.aborted)await close();
  return {startup,token,server,workspace,worker,close};
  } catch(error) {
    try { await close(); } catch(closeError) {
      throw new AggregateError([error,closeError], 'Amero server startup and closure failed.');
    }
    throw error;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const values = {};
  for (let index = 2; index < process.argv.length; index += 2) {
    need(process.argv[index]?.startsWith('--') && process.argv[index + 1], 'ARGUMENT_REQUIRED');
    values[process.argv[index].slice(2)] = process.argv[index + 1];
  }
  const selected = await startAmeroServer({
    directory: values.directory, configurationFile: values.configuration,
    host: values.host ?? '127.0.0.1', port: Number(values.port ?? 8781),
    runtimeDirectory: values.runtime, expectedManifestSha256: values['runtime-sha256'],
    token: process.env.AMERO_OPERATOR_TOKEN,
  });
  // Tokens stay in private configuration or the caller's in-memory return value.
  process.stdout.write('AMERO_OPERATIONS_READY ' + JSON.stringify(selected.startup) + '\n');
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => selected.close());
}
