#!/usr/bin/env node
// MIT. Owner-local SQL Server merchant workspace; host CLI owns paths and credentials.
import { createServer } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMssqlOperator } from './operator.mjs';
import { initializeMssqlOperator, inspectMssqlOperatorBinding, privateDirectory, readJSON,
  exists, replace, need, syncDirectory } from './operator-store.mjs';
import { createMssqlNativeFactory } from '../merchant.mjs';

const FILES = new Map([['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']], ['/style.css', ['style.css', 'text/css; charset=utf-8']]]);
const errorCode = error => /^[A-Z][A-Z0-9_]*(?::[A-Za-z0-9_./-]+)?$/.test(error.code ?? error.message ?? '')
  ? error.code ?? error.message : 'MSSQL_WORKSPACE_OPERATION_FAILED';
const json = (res, status, value) => {
  const bytes = Buffer.from(JSON.stringify(value));
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': bytes.length,
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(bytes);
};
async function body(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) throw Object.assign(new Error('JSON_REQUIRED'), { status: 415 });
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 524288) throw Object.assign(new Error('INPUT_TOO_LARGE'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw Object.assign(new Error('INVALID_JSON'), { status: 400 }); }
}

export async function startMssqlMerchantWorkspace({ model, port = 8441, ...options } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError('WORKSPACE_PORT_INVALID');
  model ??= await createMssqlOperator(options);
  let files;
  try {files = new Map(await Promise.all([...FILES].map(async ([url, [name, type]]) =>
    [url, { type, bytes: await readFile(new URL('./public/' + name, import.meta.url)) }])));}
  catch(error){await model.close();throw error;}
  const instanceId = randomUUID();
  const capability = randomBytes(32).toString('hex'), tickets = new Map(), sockets = new Set(), downloads = new Set();
  let origin, closing = false, closePromise;
  const authorized = req => {
    const token = req.headers['x-workspace-token'];
    return typeof token === 'string' && Buffer.byteLength(token) === capability.length &&
      timingSafeEqual(Buffer.from(token), Buffer.from(capability));
  };
  const server = createServer((req, res) => {
    Promise.resolve().then(async () => {
      if (req.headers.host !== new URL(origin).host || req.headers.origin && req.headers.origin !== origin ||
          req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, { error: 'LOCAL_WORKSPACE_ORIGIN_REQUIRED' });
      if (closing) return json(res, 503, { error: 'WORKSPACE_CLOSING' });
      if (typeof req.url !== 'string' || !req.url.startsWith('/') || req.url.startsWith('//')) return json(res, 400, { error: 'INVALID_REQUEST_TARGET' });
      const url = new URL(req.url, origin);
      if (req.method === 'GET' && files.has(url.pathname) && !url.search) {
        const file = files.get(url.pathname);
        res.writeHead(200, { 'content-type': file.type, 'content-length': file.bytes.length,
          'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
          'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
        return res.end(file.bytes);
      }
      for (const [key, value] of tickets) if (Date.now() > value.expiresAt) tickets.delete(key);
      if (req.method === 'GET' && /^\/download\/[a-f0-9]{64}$/.test(url.pathname) && !url.search) {
        const key = url.pathname.slice('/download/'.length), ticket = tickets.get(key);
        if (!ticket) return json(res, 410, { error: 'DOWNLOAD_TICKET_EXPIRED' });
        tickets.delete(key); downloads.add(req.socket);
        res.once('close', () => downloads.delete(req.socket));
        res.writeHead(200, { 'content-type': 'application/gzip', 'content-length': ticket.bytes.length,
          'content-disposition': `attachment; filename="${ticket.filename}"`, 'cache-control': 'no-store',
          'x-content-type-options': 'nosniff', 'x-content-sha256': ticket.sha256 });
        return res.end(ticket.bytes);
      }
      if (!authorized(req)) return json(res, 403, { error: 'WORKSPACE_CAPABILITY_REQUIRED' });
      if (req.headers['x-mssql-workspace-id'] !== undefined && req.headers['x-mssql-workspace-id'] !== model.workspaceId)
        return json(res, 409, {error:'MSSQL_WORKSPACE_IDENTITY_CHANGED'});
      const query = (allowed, numbers=[]) => {
        if ([...url.searchParams.keys()].some(key=>!allowed.includes(key)) ||
            new Set(url.searchParams.keys()).size!==[...url.searchParams.keys()].length)
          throw Object.assign(new Error('MSSQL_WORKSPACE_QUERY_INVALID'),{status:422});
        return Object.fromEntries([...url.searchParams].map(([key,value])=>[key,numbers.includes(key)?Number(value):value]));
      };
      if (req.method === 'GET') {
        if (url.pathname === '/api/info' && !url.search) return json(res, 200, { ...await model.info(), instanceId, pid:process.pid });
        if (url.pathname === '/api/runtime' && !url.search) return json(res, 200, { runtime: await model.runtime() });
        if (url.pathname === '/api/catalog' && !url.search) return json(res, 200, await model.catalog());
        if (url.pathname === '/api/table' && [...url.searchParams.keys()].join(',') === 'name') return json(res, 200, await model.catalog(url.searchParams.get('name')));
        if (url.pathname === '/api/release' && [...url.searchParams.keys()].join(',') === 'id') return json(res, 200, await model.open(url.searchParams.get('id')));
        if (url.pathname === '/api/releases' && (!url.search || [...url.searchParams.keys()].join(',') === 'page'))
          return json(res, 200, await model.list(Number(url.searchParams.get('page') ?? 0)));
      }
      if (req.method === 'GET') {
        if (url.pathname === '/api/operator/reviews') return json(res,200,await model.reviewList(query(['after','limit'],['limit'])));
        if (url.pathname === '/api/operator/review') return json(res,200,await model.reviewLoad(query(['reviewId']).reviewId));
        if (url.pathname === '/api/operator/operations') return json(res,200,await model.operationList(query(['after','limit'],['limit'])));
        if (url.pathname === '/api/operator/operation') return json(res,200,await model.operationLoad(query(['operationId']).operationId));
        if (url.pathname === '/api/transfer/exports') return json(res,200,await model.exports(query(['after','limit'],['limit'])));
        if (url.pathname === '/api/transfer/manifest') return json(res,200,await model.exportManifest(query(['exportId']).exportId));
        if (url.pathname === '/api/transfer/file') return json(res,200,await model.exportFile(query(
          ['exportId','file','expectedManifestSha256','expectedSha256','readId','offset','limit'],['offset','limit'])));
      }
      if (req.method === 'POST' && !url.search) {
        const actions = { '/api/review': 'review', '/api/preview': 'preview', '/api/prepare': 'prepare',
          '/api/run': 'run', '/api/stop': 'stop', '/api/export-client': 'exportClient',
          '/api/operator/stage':'stage','/api/transfer/export':'exportSource',
          '/api/transfer/receive':'receiveSource','/api/transfer/file-release':'exportFileRelease' };
        if (Object.hasOwn(actions, url.pathname)) {
          const result = await model[actions[url.pathname]](await body(req));
          if (url.pathname === '/api/export-client') {
            while (tickets.size >= 4) tickets.delete(tickets.keys().next().value);
            const ticket = randomBytes(32).toString('hex');
            tickets.set(ticket, { ...result, expiresAt: Date.now() + 60000 });
            return json(res, 200, { download: '/download/' + ticket, filename: result.filename, bytes: result.bytes.length, sha256: result.sha256 });
          }
          return json(res, url.pathname === '/api/prepare' ? 201 : 200, result);
        }
      }
      return json(res, 404, { error: 'WORKSPACE_ROUTE_NOT_FOUND' });
    }).catch(error => {
      if (res.writableEnded || res.destroyed) return;
      const status = error.status ?? (error.field !== undefined || error instanceof TypeError || error instanceof RangeError ? 422 : 503);
      if (!res.headersSent) json(res, status, { error: errorCode(error), ...(error.field ? { field: error.field } : {}),
        ...(error instanceof TypeError || error instanceof RangeError ? { detail: String(error.message).slice(0, 300) } : {}) }); else res.end();
    });
  });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => { sockets.delete(socket); downloads.delete(socket); }); });
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.keepAliveTimeout = 3000;
  try { await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done); }); }
  catch (error) { await model.close(); throw error; }
  origin = `http://127.0.0.1:${server.address().port}`;
  return { url: origin + '/#' + capability, origin, model, server, instanceId,
    close() {
      if (closePromise) return closePromise;
      closing = true;
      closePromise = (async () => {
        const listenerClosed = new Promise(done => server.close(done)); server.closeIdleConnections();
        try { await model.close(); }
        finally {
          for (const socket of sockets) if (!downloads.has(socket)) socket.destroy();
          let grace;
          if (downloads.size) await Promise.race([listenerClosed, new Promise(done => { grace = setTimeout(done, 15000); })]);
          clearTimeout(grace); for (const socket of sockets) socket.destroy();
          await listenerClosed; tickets.clear();
        }
      })();
      return closePromise;
    },
  };
}

export async function main(args = process.argv.slice(2)) {
  const help = 'SQL Server merchant browser workspace\n' +
    '  mssql-workspace init|inspect --source /private/source.json --state /private/mssql-workspace\n' +
    '  mssql-workspace --source /private/source.json --state /private/mssql-workspace\n' +
    '    [--port 8441] [--seller-port 0] [--operations-port 0]\n' +
    '    [--facilitator HTTPS_URL] [--allow-local-facilitator] [--release-store /private/releases]\n' +
    '    [--connection-file /private/connection.json]\n' +
    'Open the printed workspace URL or start this initialized workspace through Applications.';
  if (args.length === 1 && args[0] === '--help') { process.stdout.write(help + '\n'); return null; }
  const action = ['init','inspect'].includes(args[0]) ? args[0] : null;
  if (action) args = args.slice(1);
  const options = new Map();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (options.has(key)) throw new TypeError('WORKSPACE_DUPLICATE_OPTION');
    if (key === '--allow-local-facilitator') { options.set(key, true); continue; }
    if (!['--source', '--state', '--port', '--seller-port', '--operations-port', '--facilitator',
      '--release-store','--expected-workspace-id','--expected-profile-id','--connection-file'].includes(key) ||
        !args[i + 1] || args[i + 1].startsWith('--')) throw new TypeError(help);
    options.set(key, args[++i]);
  }
  if (!options.has('--source') || !options.has('--state')) throw new TypeError(help);
  if (action) {
    need([...options.keys()].every(key=>['--source','--state'].includes(key)),'MSSQL_WORKSPACE_OPTION_INVALID');
    const selected={sourceFile:resolve(options.get('--source')),stateDirectory:resolve(options.get('--state'))};
    const result=await (action==='init'?initializeMssqlOperator(selected):inspectMssqlOperatorBinding(selected));
    process.stdout.write(JSON.stringify(result)+'\n');return result;
  }
  const port = (key, fallback) => {
    const value = options.get(key) ?? String(fallback);
    if (!/^\d{1,5}$/.test(value) || Number(value) > 65535) throw new TypeError('WORKSPACE_PORT_INVALID');
    return Number(value);
  };
  const nativeFactory = await createMssqlNativeFactory({ facilitator: options.get('--facilitator'),
    allowLocalFacilitator: options.has('--allow-local-facilitator') });
  const session = await startMssqlMerchantWorkspace({ sourceFile: resolve(options.get('--source')),
    stateDirectory: resolve(options.get('--state')), port: port('--port', 8441), sellerPort: port('--seller-port', 0),
    operationsPort: port('--operations-port', 0), nativeFactory,
    ...(options.has('--release-store')?{releaseStore:resolve(options.get('--release-store'))}:{}),
    ...(options.has('--expected-workspace-id')?{expectedWorkspaceId:options.get('--expected-workspace-id')}:{}),
    ...(options.has('--expected-profile-id')?{expectedProfileId:options.get('--expected-profile-id')}:{}),
  });
  let startup,connectionFile;
  try {
    const selected=await session.model.info();
    connectionFile=options.has('--connection-file')?resolve(options.get('--connection-file')):
      join(selected.stateDirectory,'operator','connection.json');
    startup={schema:'stellar-forge.mssql-workspace-startup.v1',workspace:session.url,state:selected.stateDirectory,
      workspaceId:selected.workspaceId,workspaceCreatedAt:selected.workspaceCreatedAt,
      workspaceIdentitySha256:selected.workspaceIdentitySha256,profileId:selected.profileId,sourceFile:selected.sourceFile,
      instanceId:session.instanceId,pid:process.pid};
    await privateDirectory(dirname(connectionFile));
    if(await exists(connectionFile)) {
      const prior=await readJSON(connectionFile,16384);
      need(prior.schema===startup.schema && prior.workspaceId===startup.workspaceId,'MSSQL_CONNECTION_FILE_IN_USE');
    }
    await replace(connectionFile,startup);
  } catch(error) {await session.close();throw error;}
  const originalClose=session.close;
  session.close=async()=>{
    try {await originalClose();}
    finally {
      if(await exists(connectionFile)) {
        const current=await readJSON(connectionFile,16384);
        if(current.schema===startup.schema && current.instanceId===session.instanceId) {
          await unlink(connectionFile);await syncDirectory(dirname(connectionFile));
        }
      }
    }
  };
  process.stdout.write(JSON.stringify({...startup,connectionFile})+'\n');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => session.close().catch(() => { process.exitCode = 1; }));
  return session;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  process.stderr.write(JSON.stringify({ error: errorCode(error) }) + '\n'); process.exitCode = 1;
});
