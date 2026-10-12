// MIT. Private loopback application for one original Huwise / Opendatasoft workbench.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readPrivate, fault } from '../../postgres/publisher/files.mjs';

const staticRoot = fileURLToPath(new URL('./static/', import.meta.url));
const receivingGuideFile = new URL('../publisher/RECEIVING.md', import.meta.url);
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/app.css', ['app.css', 'text/css; charset=utf-8']],
]);
const formats = new Set(['json', 'csv', 'geojson', 'html']);
function json(response, value, status = 200) {
  if (response.writableEnded || response.destroyed) return;
  const bytes = Buffer.from(JSON.stringify(value));
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': bytes.length });
  response.end(bytes);
}
async function readBody(request, limit = 131072) {
  if (!/^application\/json(?:\s*;|$)/i.test(String(request.headers['content-type'] ?? '')))
    throw fault('ODS_JSON_REQUIRED', 'Send a JSON object.', 415);
  let size = 0; const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw fault('ODS_REQUEST_TOO_LARGE', 'The request exceeds this action’s ' + limit + '-byte limit.', 413);
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw fault('ODS_INVALID_JSON', 'Enter valid UTF-8 JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fault('ODS_JSON_OBJECT_REQUIRED', 'Send a JSON object.');
  return value;
}
function authenticated(request, token) {
  const actual = Buffer.from(String(request.headers.authorization ?? ''));
  const expected = Buffer.from('Bearer ' + token);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function scalar(params, key, fallback = '') {
  if (params.getAll(key).length > 1) throw fault('ODS_PARAMETER_REPEATED', 'Use one value for ' + key + '.');
  return params.get(key) ?? fallback;
}
function integer(params, key, fallback) {
  const raw = scalar(params, key, String(fallback));
  if (!/^(0|[1-9][0-9]*)$/.test(raw) || !Number.isSafeInteger(Number(raw)))
    throw fault('ODS_INTEGER_REQUIRED', 'Enter a whole number for ' + key + '.');
  return Number(raw);
}
function item(workbench, collection, id) {
  const entry = workbench.status()[collection]?.find(value => value.id === id);
  if (!entry) throw fault('ODS_ITEM_NOT_FOUND', 'Choose an existing project item.', 404);
  return entry;
}
function filename(value) {
  return String(value).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 180) || 'opendatasoft-download';
}
function download(response, content, contentType, name) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  response.writeHead(200, {
    'content-type': contentType,
    'content-length': bytes.length,
    'content-disposition': 'attachment; filename="' + filename(name) + '"',
  });
  response.end(bytes);
}
function archive(response, entry, children) {
  const child = spawn('tar', ['-czf', '-', '-C', entry.directory, '.'], { stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  let settled = false, started = false;
  const finish = () => { children.delete(child); response.off('drain', resume); response.off('close', disconnect); };
  const resume = () => child.stdout.resume();
  const disconnect = () => { if (!settled && !child.killed) child.kill('SIGTERM'); };
  child.stderr.resume();
  child.once('error', error => {
    settled = true; finish();
    if (response.headersSent) response.destroy(error);
    else json(response, { error: 'ODS_ARCHIVE_UNAVAILABLE', message: 'Install tar to download the retained merchant package.' }, 503);
  });
  child.stdout.on('data', chunk => {
    if (response.destroyed || settled) return;
    if (!started) {
      started = true;
      response.writeHead(200, {
        'content-type': 'application/gzip',
        'content-disposition': 'attachment; filename="' + filename('opendatasoft-merchant-' + entry.id + '.tar.gz') + '"',
      });
    }
    if (!response.write(chunk)) child.stdout.pause();
  });
  response.on('drain', resume); response.once('close', disconnect);
  child.once('close', code => {
    if (settled) return;
    settled = true; finish();
    if (response.destroyed) return;
    if (code !== 0) {
      if (response.headersSent) response.destroy();
      else json(response, { error: 'ODS_ARCHIVE_FAILED', message: 'The archive could not be created. The retained package is still in the project.' }, 500);
    } else response.end();
  });
}

/**
 * Serve an already opened and locked original workbench.
 * The caller owns workbench.close(); this server owns HTTP connections and archive children.
 */
export async function startOpendatasoftServer({
  workbench, port = 0, token = randomBytes(32).toString('base64url'),
} = {}) {
  if (!workbench || typeof workbench.status !== 'function' || !Number.isInteger(port) || port < 0 || port > 65535 ||
      typeof token !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(token))
    throw fault('ODS_SERVER_OPTIONS', 'Supply an opened project, a valid port and a private capability.');
  const children = new Set();
  let origin, closing = null, stopping = false;
  const server = http.createServer({ maxHeaderSize: 32768 }, async (request, response) => {
    response.setHeader('cache-control', 'no-store');
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      if (stopping) throw fault('ODS_SERVER_CLOSING', 'The project is closing.', 503);
      if (request.headers.host !== new URL(origin).host)
        throw fault('ODS_HOST_REJECTED', 'Use the printed project loopback address.', 403);
      if (request.headers.origin && request.headers.origin !== origin || request.headers['sec-fetch-site'] === 'cross-site')
        throw fault('ODS_ORIGIN_REJECTED', 'Open the project directly.', 403);
      if (typeof request.url !== 'string' || request.url.length > 32768)
        throw fault('ODS_URL_TOO_LONG', 'The request address is too long.', 414);
      const url = new URL(request.url, origin);
      if (url.origin !== origin) throw fault('ODS_ORIGIN_REJECTED', 'Use this project address.', 403);
      const asset = assets.get(url.pathname);
      if (asset && (request.method === 'GET' || request.method === 'HEAD')) {
        const bytes = await readFile(join(staticRoot, asset[0]));
        response.writeHead(200, { 'content-type': asset[1], 'content-length': bytes.length });
        response.end(request.method === 'HEAD' ? undefined : bytes); return;
      }
      if (!url.pathname.startsWith('/api/') || !authenticated(request, token))
        throw fault('ODS_PROJECT_ACCESS_REQUIRED', 'Open the complete project link printed by the command.', 401);
      let parts;
      try { parts = url.pathname.slice(5).split('/').map(decodeURIComponent); }
      catch { throw fault('ODS_ROUTE_NOT_FOUND', 'The requested project action does not exist.', 404); }
      if (parts.some(part => !part || part.includes('/') || part.includes('\\') || part === '.' || part === '..'))
        throw fault('ODS_ROUTE_NOT_FOUND', 'The requested project action does not exist.', 404);
      const p = url.searchParams;
      if (request.method === 'GET') {
        if (parts[0] === 'status' && parts.length === 1) return json(response, workbench.status());
        if (parts[0] === 'search' && parts.length === 1) {
          const query = { limit: integer(p, 'limit', 20), offset: integer(p, 'offset', 0) };
          for (const key of ['where', 'order_by', 'lang']) { const value = scalar(p, key); if (value) query[key] = value; }
          for (const key of ['refine', 'exclude']) if (p.has(key)) query[key] = p.getAll(key);
          return json(response, await workbench.search(query));
        }
        if (parts[0] === 'datasets' && parts.length === 2) return json(response, await workbench.dataset(parts[1]));
        if (parts[0] === 'editions' && parts.length === 2) return json(response, await workbench.edition(parts[1]));
        if (parts[0] === 'editions' && parts[2] === 'rows' && parts.length === 3)
          return json(response, await workbench.editionRows(parts[1], { offset: integer(p, 'offset', 0), limit: integer(p, 'limit', 100) }));
        if (parts[0] === 'editions' && parts[2] === 'facets' && parts.length === 3)
          return json(response, await workbench.editionFacets(parts[1], { field: scalar(p, 'field'), limit: integer(p, 'limit', 50), mode: scalar(p, 'mode', 'value') }));
        if (parts[0] === 'editions' && parts[2] === 'download' && parts.length === 3) {
          const format = scalar(p, 'format', 'json');
          if (!formats.has(format)) throw fault('ODS_EXPORT_FORMAT', 'Choose JSON, CSV, GeoJSON or HTML.');
          const geometryField = scalar(p, 'geometryField');
          const result = await workbench.exportEdition(parts[1], format, geometryField ? { geometryField } : {});
          return download(response, result.content, result.contentType, result.filename);
        }
        if (parts[0] === 'compare' && parts.length === 1)
          return json(response, await workbench.compare(scalar(p, 'before'), scalar(p, 'after'), scalar(p, 'key')));
        if (parts[0] === 'publications' && parts.length === 2)
          return json(response, await workbench.publication(parts[1], scalar(p, 'query')));
        if (parts[0] === 'sources' && parts[2] === 'download' && parts.length === 3) {
          const entry = item(workbench, 'sources', parts[1]);
          return download(response, await readPrivate(entry.file, 1048576), 'application/json; charset=utf-8', 'opendatasoft-source-' + entry.id + '.json');
        }
        if (parts[0] === 'buyer-requests' && parts[2] === 'download' && parts.length === 3) {
          const entry = item(workbench, 'buyerRequests', parts[1]);
          return download(response, await readPrivate(entry.out, 1048576), 'application/json; charset=utf-8', 'opendatasoft-buyer-' + entry.id + '.json');
        }
        if (parts[0] === 'exports' && parts[2] === 'guide' && parts.length === 3) {
          const entry = item(workbench, 'exports', parts[1]);
          const guide = await readFile(receivingGuideFile);
          const binding = {
            manifestSha256: entry.manifestSha256, handlerSha256: entry.handlerSha256,
            resource: entry.resource, snapshot: entry.dataset?.snapshot, rowCount: entry.dataset?.rowCount,
            capture: {
              catalogOrigin: entry.capture?.catalogOrigin, datasetId: entry.capture?.datasetId,
              datasetUid: entry.capture?.datasetUid, manifestSha256: entry.capture?.manifestSha256,
            },
          };
          const companion = Buffer.from('\n## Selected package for this companion\n\n' +
            'Use these identities when receiving this retained package. The manifest SHA-256 is the value for ODS_MANIFEST_SHA256.\n\n' +
            '~~~json\n' + JSON.stringify(binding, null, 2) + '\n~~~\n');
          return download(response, Buffer.concat([guide, companion]), 'text/markdown; charset=utf-8',
            'opendatasoft-receiving-' + entry.id + '.md');
        }
        if (parts[0] === 'exports' && parts[2] === 'download' && parts.length === 3)
          return archive(response, item(workbench, 'exports', parts[1]), children);
      }
      if (request.method === 'POST') {
        const input = await readBody(request, parts[0] === 'editions' && parts[2] === 'notes' && parts.length === 3 ? 4194304 : 131072);
        if (parts[0] === 'datasets' && parts[2] === 'preview' && parts.length === 3)
          return json(response, await workbench.previewRecords(parts[1], input));
        if (parts[0] === 'exports' && parts[2] === 'offer' && parts.length === 3)
          return json(response, await workbench.buyerOffer(parts[1], input));
        if (parts[0] === 'cancel' && parts.length === 1) return json(response, await workbench.cancel());
        let started;
        if (parts[0] === 'capture' && parts.length === 1) started = await workbench.startCapture(input);
        else if (parts[0] === 'import' && parts.length === 1) {
          if (typeof input.manifestFile !== 'string' || !input.manifestFile.trim())
            throw fault('ODS_CAPTURE_FILE_REQUIRED', 'Enter the existing capture manifest path on this host.');
          started = await workbench.importCapture(input.manifestFile);
        } else if (parts[0] === 'editions' && parts[2] === 'resume' && parts.length === 3) started = await workbench.resumeCapture(parts[1], input);
        else if (parts[0] === 'editions' && parts[2] === 'notes' && parts.length === 3) started = await workbench.saveEditionNotes(parts[1], input);
        else if (parts[0] === 'editions' && parts[2] === 'sources' && parts.length === 3) started = await workbench.saveSource(parts[1], input);
        else if (parts[0] === 'sources' && parts[2] === 'publications' && parts.length === 3) started = await workbench.createPublication(parts[1], input);
        else if (parts[0] === 'publications' && parts[2] === 'review' && parts.length === 3) started = await workbench.reviewPublication(parts[1], input);
        else if (parts[0] === 'publications' && parts[2] === 'recover' && parts.length === 3) started = await workbench.recoverPublication(parts[1]);
        else if (parts[0] === 'publications' && parts[2] === 'publish' && parts.length === 3) started = await workbench.publishDataset(parts[1], input.reviewId);
        else if (parts[0] === 'publications' && parts[2] === 'exports' && parts.length === 3) started = await workbench.exportMerchant(parts[1], input);
        else if (parts[0] === 'exports' && parts[2] === 'stage' && parts.length === 3) started = await workbench.stageMerchant(parts[1], input);
        else if (parts[0] === 'exports' && parts[2] === 'buyer' && parts.length === 3) started = await workbench.prepareBuyer(parts[1], input);
        else throw fault('ODS_ROUTE_NOT_FOUND', 'The requested project action does not exist.', 404);
        if (!started || typeof started.id !== 'string') throw fault('ODS_OPERATION_RESULT', 'Read the project status to recover this action.', 500);
        started.completion?.catch(() => {});
        return json(response, { operationId: started.id, ...(started.editionId ? { editionId: started.editionId } : {}) }, 202);
      }
      throw fault('ODS_ROUTE_NOT_FOUND', 'The requested project action does not exist.', 404);
    } catch (error) {
      if (response.headersSent) response.destroy(error);
      else json(response, { error: error.code ?? 'ODS_REQUEST_FAILED',
        message: error.code ? error.message : 'The request did not complete. Read the project status before continuing.' },
      Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 400);
    }
  });
  server.requestTimeout = 30000; server.headersTimeout = 15000; server.keepAliveTimeout = 5000;
  await new Promise((resolve, reject) => {
    const fail = error => { server.off('listening', ready); reject(error); };
    const ready = () => { server.off('error', fail); resolve(); };
    server.once('error', fail); server.once('listening', ready); server.listen(port, '127.0.0.1');
  });
  origin = 'http://127.0.0.1:' + server.address().port;
  return {
    server, origin, token, url: origin + '/#' + token,
    close() {
      if (closing) return closing;
      stopping = true;
      for (const child of children) child.kill('SIGTERM');
      closing = new Promise((resolve, reject) => {
        const timer = setTimeout(() => server.closeAllConnections?.(), 2000); timer.unref?.();
        server.close(error => { clearTimeout(timer); if (error) reject(error); else resolve(); });
        server.closeIdleConnections?.();
      });
      return closing;
    },
  };
}
