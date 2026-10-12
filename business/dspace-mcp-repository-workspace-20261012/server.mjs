#!/usr/bin/env node
// Local operator HTTP surface for the unchanged original 4Science DSpace MCP tools.
import http from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { dirname, basename, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openWorkspace } from './workspace.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const MAX_BODY = 32 * 1024 * 1024;
const STATIC = new Map([
  ['/', ['public/index.html', 'text/html; charset=utf-8']],
  ['/app.mjs', ['public/app.mjs', 'text/javascript; charset=utf-8']],
  ['/style.css', ['public/style.css', 'text/css; charset=utf-8']],
]);
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const failure = (status, code, message) => Object.assign(new Error(message), {status, code});

function headers(res, type) {
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
}
function json(res, status, value) {
  if (res.destroyed || res.writableEnded) return;
  const bytes = Buffer.from(JSON.stringify(value));
  headers(res, 'application/json; charset=utf-8');
  res.writeHead(status, {'Content-Length': bytes.length});
  res.end(bytes);
}
async function body(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
    throw failure(415, 'JSON_REQUIRED', 'Send application/json.');
  }
  const declared = req.headers['content-length'];
  if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY)) {
    throw failure(413, 'BODY_TOO_LARGE', 'The request exceeds the 32 MiB receiving limit.');
  }
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > MAX_BODY) throw failure(413, 'BODY_TOO_LARGE', 'The request exceeds the 32 MiB receiving limit.');
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw failure(400, 'INVALID_JSON', 'The request body is not valid JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure(400, 'OBJECT_REQUIRED', 'The request body must be an object.');
  return value;
}
function pageNumber(url, name, fallback, max) {
  const value = url.searchParams.get(name);
  if (value === null) return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max) {
    throw failure(400, 'INVALID_PAGE', name + ' must be an integer between 0 and ' + max + '.');
  }
  return Number(value);
}
function parts(path, prefix) {
  if (!path.startsWith(prefix)) return null;
  const segments = path.slice(prefix.length).split('/');
  if (segments.length !== 2) return null;
  return segments.map(segment => {
    let value;
    try { value = decodeURIComponent(segment); }
    catch { throw failure(400, 'INVALID_PATH', 'The requested record path is invalid.'); }
    if (!value || /[\/\\\x00-\x1f]/.test(value) || value === '.' || value === '..') throw failure(400, 'INVALID_PATH', 'The requested record path is invalid.');
    return value;
  });
}
function documentPage(title, content) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
    escapeHtml(title) + '</title><link rel="stylesheet" href="/style.css"></head><body><main class="document-page"><a href="/">Repository Workspace</a><h1>' +
    escapeHtml(title) + '</h1>' + content + '</main></body></html>';
}

async function sendFile(req, res, file) {
  const name = String(file.filename || 'workspace-download').replace(/[\r\n\x00-\x1f]/g, '_');
  headers(res, file.contentType || 'application/octet-stream');
  res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(name).replace(/'/g, '%27'));
  if (file.path) {
    res.writeHead(200, {'Content-Length': file.bytes});
    try { await pipeline(createReadStream(file.path), res); }
    finally { if (file.temporary) await unlink(file.path).catch(() => {}); }
  } else {
    const bytes = Buffer.isBuffer(file.bytes) ? file.bytes : Buffer.from(file.bytes);
    res.writeHead(200, {'Content-Length': bytes.length});
    res.end(bytes);
  }
}

export async function startServer({directory, upstreamRoot, port = 0} = {}) {
  if (!directory) throw new Error('A workspace directory is required.');
  const workspace = await openWorkspace({directory: resolve(directory), ...(upstreamRoot ? {upstreamRoot: resolve(upstreamRoot)} : {})});
  const token = randomBytes(32).toString('hex');
  const tokenBytes = Buffer.from(token);
  let closing = false;
  const tasks = new Set();
  const receivingRoot = join(resolve(directory), 'receiving');
  const receiving = new Set();
  const downloadTickets = new Map();
  const receivingId = value => {
    if (typeof value !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) throw failure(400, 'INVALID_RECEIVING_ID', 'Use the original archive receiving identifier.');
    return value;
  };
  const receivingPath = id => join(receivingRoot, receivingId(id));
  async function readReceipt(id) {
    try { return JSON.parse(await readFile(join(receivingPath(id), 'receipt.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') throw failure(404, 'RECEIVING_NOT_FOUND', 'The original archive has not finished receiving. Select that file again to resume.'); throw error; }
  }
  async function saveReceipt(id, receipt) {
    const path = join(receivingPath(id), 'receipt.json');
    await writeFile(path + '.tmp', JSON.stringify(receipt), {mode:0o600});
    await rename(path + '.tmp', path);
  }
  async function previewReceived(id) {
    const receipt = await readReceipt(id);
    if (!receipt.preview) {
      const preview = await workspace.previewFile(join(receivingPath(id), 'archive.sqlite'));
      if (preview.sha256 !== receipt.source_sha256) throw failure(409, 'RECEIVING_CHANGED', 'The received archive differs from its original digest.');
      receipt.preview = preview; receipt.status = 'READY';
      await saveReceipt(id, receipt);
    }
    return receipt;
  }
  async function receiveArchive(req) {
    let metadata;
    const header = req.headers['x-workspace-metadata'];
    if (typeof header !== 'string' || header.length > 8192) throw failure(400, 'RECEIVING_METADATA_REQUIRED', 'Supply the archive receiving metadata.');
    try { metadata = JSON.parse(decodeURIComponent(header)); } catch { throw failure(400, 'INVALID_RECEIVING_METADATA', 'The archive receiving metadata is invalid.'); }
    const id = receivingId(metadata.receiving_id);
    const filename = basename(String(metadata.filename || ''));
    if (!filename || filename.length > 240 || /[\r\n\x00-\x1f]/.test(filename)) throw failure(400, 'INVALID_FILENAME', 'Use the original archive filename.');
    if (typeof metadata.actor !== 'string' || !metadata.actor.trim() || metadata.actor.length > 160) throw failure(400, 'ACTOR_REQUIRED', 'Name the operator receiving this archive.');
    if (receiving.has(id)) throw failure(409, 'RECEIVING_RUNNING', 'The original archive is still receiving. Read that same receiving identifier.');
    receiving.add(id);
    let temporary;
    try {
      const dir = receivingPath(id);
      await mkdir(dir, {recursive:true, mode:0o700});
      const prior = await readReceipt(id).catch(error => { if (error.status === 404) return null; throw error; });
      if (prior && (prior.filename !== filename || prior.actor !== metadata.actor)) throw failure(409, 'RECEIVING_CONFLICT', 'This receiving identifier already belongs to another original file or operator.');
      temporary = join(dir, 'incoming-' + randomUUID() + '.part');
      const hash = createHash('sha256'); let bytes = 0;
      const meter = new Transform({transform(chunk, encoding, callback) { bytes += chunk.length; hash.update(chunk); callback(null, chunk); }});
      await pipeline(req, meter, createWriteStream(temporary, {flags:'wx', mode:0o600}));
      const sha256 = hash.digest('hex');
      if (!bytes) throw failure(400, 'EMPTY_ARCHIVE', 'Select the complete original handover file.');
      if (prior && (prior.source_sha256 !== sha256 || prior.bytes !== bytes)) throw failure(409, 'RECEIVING_CONFLICT', 'Different archive bytes were sent under the original receiving identifier.');
      if (prior) { await unlink(temporary); temporary = null; }
      else {
        await rename(temporary, join(dir, 'archive.sqlite')); temporary = null;
        await saveReceipt(id, {receiving_id:id,filename,actor:metadata.actor,source_sha256:sha256,bytes,status:'RECEIVED',received_at:new Date().toISOString()});
      }
      return await previewReceived(id);
    } finally {
      if (temporary) await unlink(temporary).catch(() => {});
      receiving.delete(id);
    }
  }
  const server = http.createServer((req, res) => {
    const task = handle(req, res).catch(error => {
      const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
      json(res, status, {
        error: error.code || 'WORKSPACE_ERROR',
        message: error.message || 'The workspace could not complete this request.',
        ...(Number.isInteger(error.current_revision) ? {current_revision: error.current_revision} : {}),
      });
    }).finally(() => tasks.delete(task));
    tasks.add(task);
  });
  server.requestTimeout = 0; // Original native operations may outlive a browser connection.
  server.headersTimeout = 30_000;
  server.keepAliveTimeout = 5_000;

  async function handle(req, res) {
    if (closing) throw failure(503, 'CLOSING', 'The workspace is closing. Reopen its saved directory to continue.');
    const bound = server.address();
    const allowedHosts = new Set(['127.0.0.1:' + bound.port, 'localhost:' + bound.port]);
    if (!allowedHosts.has(req.headers.host)) throw failure(403, 'HOST_REJECTED', 'Open the workspace at its local address.');
    const expectedOrigin = 'http://' + req.headers.host;
    if (req.headers.origin && req.headers.origin !== expectedOrigin) throw failure(403, 'ORIGIN_REJECTED', 'This request did not originate from the local workspace.');
    if (req.headers['sec-fetch-site'] === 'cross-site') throw failure(403, 'CROSS_SITE_REJECTED', 'Open the workspace directly at its local address.');
    const url = new URL(req.url, expectedOrigin);
    if (url.pathname.startsWith('/api/')) {
      const supplied = Buffer.from(String(req.headers['x-workspace-token'] || ''));
      if (supplied.length !== tokenBytes.length || !timingSafeEqual(supplied, tokenBytes)) throw failure(403, 'SESSION_REQUIRED', 'Reload this workspace to use its current local session.');
      if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, workspace.state());
      if (req.method === 'POST' && url.pathname === '/api/receiving/archive') return json(res, 200, await receiveArchive(req));
      const receiptRoute = parts(url.pathname, '/api/receiving/');
      if (req.method === 'GET' && receiptRoute?.[0] === 'archive') return json(res, 200, await previewReceived(receiptRoute[1]));
      if (req.method === 'POST' && url.pathname === '/api/downloads') {
        const input = await body(req);
        if (typeof input.kind !== 'string' || typeof input.id !== 'string') throw failure(400, 'FILE_REQUIRED', 'Choose the retained file to download.');
        for (const [id, value] of downloadTickets) if (Date.now() - value.created_at > 300000) {
          downloadTickets.delete(id);
          if (value.file.temporary) await unlink(value.file.path).catch(() => {});
        }
        const file = await workspace.exportFile(input.kind, input.id), id = randomUUID();
        downloadTickets.set(id, {file,created_at:Date.now()});
        return json(res, 200, {url:'/downloads/' + id,filename:file.filename,bytes:file.path ? file.bytes : file.bytes.length});
      }
      const record = parts(url.pathname, '/api/records/');
      if (req.method === 'GET' && record) {
        return json(res, 200, workspace.read(record[0], record[1], {
          offset: pageNumber(url, 'offset', 0, Number.MAX_SAFE_INTEGER),
          limit: pageNumber(url, 'limit', 50, 500),
        }));
      }
      const file = parts(url.pathname, '/api/files/');
      if (req.method === 'GET' && file) {
        return sendFile(req, res, await workspace.exportFile(file[0], file[1]));
      }
      const action = /^\/api\/actions\/([a-z][a-z0-9-]+)$/.exec(url.pathname);
      if (req.method === 'POST' && action) {
        const input = await body(req);
        // Dispatch continues if the caller disconnects. The original operation ID owns recovery.
        if (action[1] === 'restore-file') {
          const receipt = await readReceipt(input.receiving_id);
          if (input.source_sha256 !== receipt.source_sha256 || input.filename !== receipt.filename) throw failure(409, 'RECEIVING_CONFLICT', 'Restore the exact archive shown in the receiving preview.');
          const result = await workspace.restoreFile({actor:input.actor,operationId:input.operationId,revision:input.revision,filename:input.filename,source_sha256:input.source_sha256}, join(receivingPath(input.receiving_id), 'archive.sqlite'));
          await unlink(join(receivingPath(input.receiving_id), 'archive.sqlite')).catch(() => {});
          return json(res, 200, result);
        }
        return json(res, 200, await workspace.dispatch(action[1], input));
      }
      throw failure(404, 'UNKNOWN_API_ROUTE', 'This workspace API route does not exist.');
    }
    const ticketRoute = /^\/downloads\/([0-9a-f-]+)$/.exec(url.pathname);
    if (req.method === 'GET' && ticketRoute) {
      const ticket = downloadTickets.get(ticketRoute[1]);
      if (!ticket || Date.now() - ticket.created_at > 300000) throw failure(404, 'DOWNLOAD_EXPIRED', 'Request this download again from the workspace.');
      downloadTickets.delete(ticketRoute[1]);
      return sendFile(req, res, ticket.file);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw failure(405, 'METHOD_NOT_ALLOWED', 'Use GET for this document.');
    let bytes, contentType;
    if (STATIC.has(url.pathname)) {
      const [path, type] = STATIC.get(url.pathname);
      bytes = await readFile(join(ROOT, path));
      contentType = type;
      if (url.pathname === '/') bytes = Buffer.from(bytes.toString('utf8').replace('__SESSION_TOKEN__', token));
    } else if (url.pathname === '/workflow') {
      bytes = Buffer.from(documentPage('Operating guide', '<pre class="guide-text">' + escapeHtml(await readFile(join(ROOT, 'WORKFLOW.md'), 'utf8')) + '</pre>'));
      contentType = 'text/html; charset=utf-8';
    } else if (url.pathname === '/source') {
      const state = workspace.state();
      const upstream = state.upstream || {};
      bytes = Buffer.from(documentPage('Source and license',
        '<p>This operator workspace connects the original 4Science DSpace MCP tools to retained repository operations.</p><p><a href="https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/main/business/dspace-mcp-repository-workspace-20261012/">Complete workspace source</a></p><p><a href="https://github.com/4Science/dspace-mcp/tree/' +
        encodeURIComponent(upstream.commit || 'ee503ba97910f592867c897c1fa938f9e029d03c') +
        '">Pinned original 4Science source</a></p><p>The complete original source and license notices are included under vendor/dspace-mcp.</p><p><a href="/license">Original AGPL license</a></p>'));
      contentType = 'text/html; charset=utf-8';
    } else if (url.pathname === '/license') {
      bytes = await readFile(join(upstreamRoot ? resolve(upstreamRoot) : join(ROOT, 'vendor/dspace-mcp'), 'LICENSE'));
      contentType = 'text/plain; charset=utf-8';
    } else throw failure(404, 'NOT_FOUND', 'This workspace page does not exist.');
    headers(res, contentType);
    res.writeHead(200, {'Content-Length': bytes.length});
    res.end(req.method === 'HEAD' ? undefined : bytes);
  }

  try {
    await new Promise((resolveListen, rejectListen) => {
      server.once('error', rejectListen);
      server.listen(port, '127.0.0.1', () => { server.off('error', rejectListen); resolveListen(); });
    });
  } catch (error) { await workspace.close(); throw error; }
  const address = 'http://127.0.0.1:' + server.address().port;
  return {
    server, workspace, address, token,
    async close() {
      if (closing) return;
      closing = true;
      await new Promise(resolveClose => server.close(resolveClose));
      await Promise.allSettled([...tasks]);
      for (const ticket of downloadTickets.values()) if (ticket.file.temporary) await unlink(ticket.file.path).catch(() => {});
      downloadTickets.clear();
      await workspace.close();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const options = {};
  for (let i = 2; i < process.argv.length; i++) {
    const key = process.argv[i];
    if (!['--workspace', '--upstream-root', '--port'].includes(key) || !process.argv[i + 1]) {
      throw new Error('Usage: node server.mjs --workspace <directory> [--port <port>] [--upstream-root <directory>]');
    }
    const value = process.argv[++i];
    if (key === '--workspace') options.directory = value;
    if (key === '--upstream-root') options.upstreamRoot = value;
    if (key === '--port') {
      if (!/^\d+$/.test(value) || Number(value) > 65535) throw new Error('Port must be between 0 and 65535.');
      options.port = Number(value);
    }
  }
  const running = await startServer(options);
  process.stdout.write('Repository Workspace: ' + running.address + '\n');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
    await running.close();
    process.exitCode = 0;
  });
}
