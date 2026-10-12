// MIT. Loopback UI for one locked CKAN project.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readPrivate, fault } from '../postgres/publisher/files.mjs';

const assets = new Map([['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']], ['/style.css', ['style.css', 'text/css; charset=utf-8']]]);
const root = fileURLToPath(new URL('./public/', import.meta.url));
const json = (response, value, status = 200) => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
};
async function body(request) {
  if (!String(request.headers['content-type'] ?? '').startsWith('application/json'))
    throw fault('CKAN_JSON_REQUIRED', 'Send a JSON request.', 415);
  let size = 0; const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 131072) throw fault('CKAN_REQUEST_TOO_LARGE', 'The request exceeds 128 KiB.', 413);
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw fault('CKAN_INVALID_JSON', 'Enter valid JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fault('CKAN_JSON_OBJECT_REQUIRED');
  return value;
}
function bearer(request, token) {
  const received = Buffer.from(String(request.headers.authorization ?? ''));
  const expected = Buffer.from('Bearer ' + token);
  return received.length === expected.length && timingSafeEqual(received, expected);
}
function lookup(workbench, collection, id) {
  const item = workbench.status()[collection].find(item => item.id === id);
  if (!item) throw fault('CKAN_ITEM_NOT_FOUND', 'Choose an existing project item.', 404);
  return item;
}
export async function startCkanServer({ workbench, port = 0, token = randomBytes(32).toString('base64url') } = {}) {
  if (!workbench || !Number.isInteger(port) || port < 0 || port > 65535 || typeof token !== 'string' || token.length < 32)
    throw fault('CKAN_SERVER_OPTIONS');
  let origin, closing;
  const server = http.createServer(async (request, response) => {
    response.setHeader('cache-control', 'no-store');
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      if (request.headers.host !== new URL(origin).host) throw fault('CKAN_HOST_REJECTED', 'Use the project loopback address.', 403);
      const incomingOrigin = request.headers.origin;
      if (incomingOrigin && incomingOrigin !== origin) throw fault('CKAN_ORIGIN_REJECTED', 'Open this project directly.', 403);
      if (request.headers['sec-fetch-site'] === 'cross-site') throw fault('CKAN_ORIGIN_REJECTED', 'Open this project directly.', 403);
      const url = new URL(request.url, origin), pathname = url.pathname;
      const asset = assets.get(pathname);
      if (asset && request.method === 'GET') {
        response.writeHead(200, { 'content-type': asset[1] });
        response.end(await readFile(join(root, asset[0]))); return;
      }
      if (!pathname.startsWith('/api/') || !bearer(request, token))
        throw fault('CKAN_PROJECT_ACCESS_REQUIRED', 'Open the project link printed by the command.', 401);
      const parts = pathname.slice(5).split('/').map(decodeURIComponent);
      if (request.method === 'GET') {
        if (parts[0] === 'status' && parts.length === 1) return json(response, workbench.status());
        if (parts[0] === 'search' && parts.length === 1)
          return json(response, await workbench.search({ q: url.searchParams.get('q') ?? '',
            start: Number(url.searchParams.get('start') ?? 0), rows: Number(url.searchParams.get('rows') ?? 20) }));
        if (parts[0] === 'packages' && parts.length === 2) return json(response, await workbench.package(parts[1]));
        if (parts[0] === 'editions' && parts.length === 2) return json(response, await workbench.edition(parts[1]));
        if (parts[0] === 'compare' && parts.length === 1)
          return json(response, await workbench.compare(url.searchParams.get('before'), url.searchParams.get('after'), url.searchParams.get('key') ?? '_id'));
        if (parts[0] === 'publications' && parts.length === 2)
          return json(response, await workbench.publication(parts[1], url.searchParams.get('query') ?? ''));
        if (parts[0] === 'sources' && parts[2] === 'download' && parts.length === 3) {
          const entry = lookup(workbench, 'sources', parts[1]);
          response.setHeader('content-disposition', 'attachment; filename="ckan-source-' + entry.id + '.json"');
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(await readPrivate(entry.file, 1048576)); return;
        }
        if (parts[0] === 'buyer-requests' && parts[2] === 'download' && parts.length === 3) {
          const entry = lookup(workbench, 'buyerRequests', parts[1]);
          response.setHeader('content-disposition', 'attachment; filename="ckan-buyer-' + entry.id + '.json"');
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(await readPrivate(entry.out, 1048576)); return;
        }
        if (parts[0] === 'exports' && parts[2] === 'download' && parts.length === 3) {
          const entry = lookup(workbench, 'exports', parts[1]);
          const child = spawn('tar', ['-czf', '-', '-C', entry.directory, '.'], { stdio: ['ignore', 'pipe', 'pipe'] });
          let started = false, stderr = '';
          child.stderr.on('data', data => { if (stderr.length < 4096) stderr += data.toString(); });
          child.once('error', error => { if (!response.headersSent) json(response, { error: 'CKAN_ARCHIVE_UNAVAILABLE', message: 'Install tar to download a package archive. The complete package remains in the project.' }, 503); else response.destroy(error); });
          child.stdout.on('data', data => {
            if (!started) {
              started = true;
              response.writeHead(200, { 'content-type': 'application/gzip',
                'content-disposition': 'attachment; filename="ckan-merchant-' + entry.id + '.tar.gz"' });
            }
            if (!response.write(data)) child.stdout.pause();
          });
          response.on('drain', () => child.stdout.resume());
          response.on('close', () => { if (!child.killed) child.kill(); });
          child.once('close', code => {
            if (code !== 0) { if (!response.headersSent) json(response, { error: 'CKAN_ARCHIVE_FAILED', message: 'The archive could not be created. Read the saved package in the project.' }, 500); else response.destroy(); }
            else response.end();
          });
          return;
        }
      }
      if (request.method === 'POST') {
        const input = await body(request);
        let result;
        if (parts[0] === 'capture' && parts.length === 1) result = workbench.startCapture(input);
        else if (parts[0] === 'editions' && parts[2] === 'resume' && parts.length === 3) result = workbench.resumeCapture(parts[1], input);
        else if (parts[0] === 'editions' && parts[2] === 'sources' && parts.length === 3) result = workbench.saveSource(parts[1], input);
        else if (parts[0] === 'sources' && parts[2] === 'publications' && parts.length === 3) result = workbench.createPublication(parts[1], input);
        else if (parts[0] === 'publications' && parts[2] === 'review' && parts.length === 3) result = workbench.reviewPublication(parts[1], input);
        else if (parts[0] === 'publications' && parts[2] === 'recover' && parts.length === 3) result = workbench.recoverPublication(parts[1]);
        else if (parts[0] === 'publications' && parts[2] === 'publish' && parts.length === 3) result = workbench.publishDataset(parts[1], input.reviewId);
        else if (parts[0] === 'publications' && parts[2] === 'exports' && parts.length === 3) result = workbench.exportMerchant(parts[1], input);
        else if (parts[0] === 'exports' && parts[2] === 'stage' && parts.length === 3) result = workbench.stageMerchant(parts[1], input);
        else if (parts[0] === 'exports' && parts[2] === 'offer' && parts.length === 3) return json(response, await workbench.buyerOffer(parts[1], input));
        else if (parts[0] === 'exports' && parts[2] === 'buyer' && parts.length === 3) result = workbench.prepareBuyer(parts[1], input);
        else if (parts[0] === 'cancel' && parts.length === 1) return json(response, workbench.cancel());
        else throw fault('CKAN_ROUTE_NOT_FOUND', 'The requested project action does not exist.', 404);
        return json(response, { operationId: result.id, ...(result.editionId ? { editionId: result.editionId } : {}) }, 202);
      }
      throw fault('CKAN_ROUTE_NOT_FOUND', 'The requested project action does not exist.', 404);
    } catch (error) {
      if (response.headersSent) response.destroy(error);
      else json(response, { error: error.code ?? 'CKAN_REQUEST_FAILED',
        message: error.code ? error.message : 'The request did not complete. Read the project status and retry the action.' },
        Number.isInteger(error.status) ? error.status : 400);
    }
  });
  server.requestTimeout = 30000; server.headersTimeout = 15000; server.keepAliveTimeout = 5000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  origin = 'http://127.0.0.1:' + server.address().port;
  return { server, origin, token, url: origin + '/#' + token,
    close() { return closing ??= new Promise(resolve => { server.close(resolve); server.closeIdleConnections?.(); }); } };
}

