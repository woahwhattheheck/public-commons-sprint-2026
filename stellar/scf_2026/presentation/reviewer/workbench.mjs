/** MIT. Private reviewer workbench, using the original grant Buyer and browser MCP client. */
import {createServer} from 'node:http';
import {randomBytes, randomUUID, timingSafeEqual} from 'node:crypto';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {unlink} from 'node:fs/promises';
import {openReviewerWorkbench} from './workbench-model.mjs';
import {MAX_PACKET_BYTES, readSourceFile, writeSourceFile} from './workspace.mjs';

export const WORKBENCH_READY_SCHEMA = 'stellar-forge.grant-reviewer-workbench-ready.v1';
export const WORKBENCH_CONNECTION_SCHEMA = 'stellar-forge.grant-reviewer-workbench-connection.v1';
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (code, message = code, status = 400) => { throw Object.assign(new Error(message), {code, status}); };
const need = (value, code, message, status) => { if (!value) fail(code, message, status); };
const readTools = new Set(['bazaar_history', 'bazaar_results', 'bazaar_status', 'bazaar_read_result']);
async function body(request, maximum = MAX_PACKET_BYTES * 4 / 3 + 16384) {
  const chunks = []; let count = 0;
  for await (const chunk of request) {
    count += chunk.length;
    need(count <= maximum, 'REVIEWER_HTTP_BODY_LIMIT', 'The receiving packet exceeds the original 8 MiB limit.', 413);
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(Buffer.concat(chunks))); }
  catch { fail('REVIEWER_JSON_INVALID'); }
  need(plain(value), 'REVIEWER_JSON_OBJECT_REQUIRED'); return value;
}
function secretMatches(actual, expected) {
  const a = Buffer.from(actual ?? ''), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A controller remains open while its original Buyer is closed for a coherent export. */
export async function startReviewerWorkbench(options = {}) {
  const port = options.port ?? 0;
  need(Number.isSafeInteger(port) && port >= 0 && port <= 65535, 'REVIEWER_PORT_INVALID');
  const model = await openReviewerWorkbench(options);
  const token = randomBytes(32).toString('base64url'), instanceId = randomUUID();
  const connectionFile = join(model.directory, 'workbench-connection.json');
  const staticRoot = fileURLToPath(new URL('./workbench-ui/', import.meta.url));
  const assets = new Map();
  let server, address, closing = false, closePromise;
  const active = new Set();
  function headers(response, contentType = 'application/json; charset=utf-8') {
    response.setHeader('Content-Type', contentType);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  }
  function send(response, status, value, type) {
    if (response.writableEnded || response.destroyed) return;
    headers(response, type);
    const bytes = Buffer.isBuffer(value) ? value : json(value);
    response.statusCode = status; response.setHeader('Content-Length', bytes.length); response.end(bytes);
  }
  function authenticate(request) {
    need(!closing, 'REVIEWER_CLOSING', 'The reviewer is closing.', 409);
    need(secretMatches(request.headers.authorization, 'Bearer ' + token),
      'REVIEWER_ACCESS_REQUIRED', 'Connect with this running workbench’s private access code.', 401);
  }
  async function proxyMcp(request, response) {
    const envelope = await body(request, 65536);
    need(envelope.jsonrpc === '2.0' && typeof envelope.method === 'string', 'REVIEWER_MCP_REQUEST_INVALID');
    const result = await model.withBuyer(async (original, selection) => {
      if (envelope.method === 'tools/call') {
        need(readTools.has(envelope.params?.name), 'REVIEWER_SAVED_READ_REQUIRED',
          'This reviewer opens the retained history and complete saved results.', 403);
        const args = envelope.params?.arguments ?? {};
        if (['bazaar_status', 'bazaar_read_result'].includes(envelope.params.name))
          need(selection.packet.quotes.some(quote => quote.quoteId === args.quoteId), 'REVIEWER_ORIGINAL_QUOTE_REQUIRED');
      } else need(['initialize', 'notifications/initialized', 'tools/list'].includes(envelope.method),
        'REVIEWER_SAVED_READ_REQUIRED', undefined, 403);
      const originalResponse = await fetch(original.address, {
        method:'POST', redirect:'error', signal:AbortSignal.timeout(20000),
        headers:{authorization:'Bearer ' + original.accessToken, 'content-type':'application/json',
          accept:'application/json, text/event-stream',
          ...(request.headers['mcp-protocol-version'] ? {'mcp-protocol-version':request.headers['mcp-protocol-version']} : {})},
        body:JSON.stringify(envelope),
      });
      const bytes = Buffer.from(await originalResponse.arrayBuffer());
      need(bytes.length <= 3 * 1024 * 1024, 'REVIEWER_NATIVE_RESPONSE_LIMIT');
      if (envelope.method === 'tools/list' && originalResponse.ok) {
        const catalog = JSON.parse(bytes);
        if (Array.isArray(catalog.result?.tools)) catalog.result.tools = catalog.result.tools.filter(tool => readTools.has(tool.name));
        return {status:originalResponse.status, bytes:json(catalog)};
      }
      return {status:originalResponse.status, bytes};
    });
    send(response, result.status, result.bytes);
  }
  async function route(request, response) {
    need(request.headers.host === new URL(address).host, 'REVIEWER_HOST_REQUIRED', undefined, 403);
    need(!request.headers.origin || request.headers.origin === address, 'REVIEWER_ORIGIN_REQUIRED', undefined, 403);
    const url = new URL(request.url, address), path = url.pathname;
    if (request.method === 'GET' && path === '/health') return send(response, 200,
      {schema:WORKBENCH_READY_SCHEMA, workbenchId:model.workbenchId, instanceId, active:!closing});
    if (request.method === 'GET' && assets.has(path)) {
      const asset = assets.get(path); return send(response, 200, asset.bytes, asset.type);
    }
    authenticate(request);
    if (request.method === 'GET' && path === '/api/state') return send(response, 200, await model.snapshot());
    if (request.method === 'GET' && path === '/api/selection')
      return send(response, 200, await model.inspectSelection(url.searchParams.get('id')));
    if (request.method === 'GET' && path === '/api/buyer-connection')
      return send(response, 200, await model.buyerCredential());
    if (request.method === 'GET' && ['/api/document', '/api/export'].includes(path)) {
      const output = path === '/api/document' ?
        await model.document(url.searchParams.get('id'), Number(url.searchParams.get('index'))) :
        await model.downloadExport(url.searchParams.get('id'));
      response.setHeader('Content-Disposition', 'attachment; filename="' + output.filename.replace(/[^A-Za-z0-9._-]/g, '_') + '"');
      response.setHeader('X-Content-SHA256', output.sha256);
      return send(response, 200, output.bytes, output.contentType);
    }
    if (request.method === 'POST' && path === '/') return proxyMcp(request, response);
    if (request.method === 'POST' && path.startsWith('/api/')) {
      need((request.headers['content-type'] ?? '').split(';')[0].trim() === 'application/json',
        'REVIEWER_JSON_CONTENT_TYPE_REQUIRED', undefined, 415);
      const input = await body(request);
      const methods = {'/api/review':'review', '/api/receive':'receive', '/api/open':'openBuyer',
        '/api/close':'closeBuyer', '/api/export':'exportPacket'};
      if (methods[path]) return send(response, 200, await model[methods[path]](input));
      if (path === '/api/shutdown') {
        send(response, 200, {closing:true});
        setImmediate(() => close().catch(error => { process.stderr.write((error.code ?? 'REVIEWER_CLOSE_FAILED') + '\n'); }));
        return;
      }
    }
    fail('REVIEWER_ROUTE_NOT_FOUND', undefined, 404);
  }
  async function deactivate() {
    let current;
    try { current = JSON.parse(await readSourceFile(connectionFile, {privateFile:true})); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (current.instanceId !== instanceId) return;
    delete current.accessToken; current.active = false;
    try { await writeSourceFile(connectionFile, json(current), {replace:true}); }
    catch (error) {
      const latest = JSON.parse(await readSourceFile(connectionFile, {privateFile:true}));
      if (latest.instanceId === instanceId) await unlink(connectionFile); else throw error;
    }
  }
  function close() {
    if (closePromise) return closePromise;
    closing = true;
    closePromise = (async () => {
      const listenerClosed = server?.listening ? new Promise(resolve => server.close(resolve)) : Promise.resolve();
      server?.closeIdleConnections?.();
      try { await deactivate(); }
      finally {
        try { await model.close(); }
        finally {
          server?.closeAllConnections?.(); await Promise.allSettled([...active]); await listenerClosed;
        }
      }
    })(); return closePromise;
  }
  try {
    for (const [path, file, type] of [
      ['/', 'index.html', 'text/html; charset=utf-8'],
      ['/app.mjs', 'app.mjs', 'text/javascript; charset=utf-8'],
      ['/style.css', 'style.css', 'text/css; charset=utf-8'],
    ]) assets.set(path, {bytes:await readSourceFile(join(staticRoot, file)), type});
    assets.set('/native-client.mjs', {bytes:await readSourceFile(join(model.sourceRoot,
      'stellar-forge/mcp-paid-agent/operator-ui/client.mjs')), type:'text/javascript; charset=utf-8'});
    server = createServer((request, response) => {
      const task = route(request, response).catch(error => send(response, error.status ?? 400,
        {error:{code:error.code ?? error.name, message:error.message}}));
      active.add(task); task.finally(() => active.delete(task)).catch(() => {});
    });
    server.requestTimeout = 15000; server.headersTimeout = 10000;
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    address = 'http://127.0.0.1:' + server.address().port;
    const connection = {schema:WORKBENCH_CONNECTION_SCHEMA, workbenchId:model.workbenchId, instanceId,
      directory:model.directory, pid:process.pid, processStart:model.processStart, active:true,
      url:address + '/', accessToken:token, startedAt:new Date().toISOString()};
    await writeSourceFile(connectionFile, json(connection), {replace:true});
    return {model, address, url:address + '/', accessToken:token, connectionFile, instanceId,
      workbenchId:model.workbenchId, close, startup:{schema:WORKBENCH_READY_SCHEMA,
        workbenchId:model.workbenchId, instanceId, directory:model.directory, pid:process.pid,
        processStart:model.processStart, connectionFile, url:address + '/'}};
  } catch (error) { await close(); throw error; }
}
