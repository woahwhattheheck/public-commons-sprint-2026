// MIT. Private loopback source editor; the original publisher keeps its own UI.
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fault, digest } from '../../postgres/publisher/files.mjs';
import { MAX_CAPTURE_BYTES } from '../declaration.mjs';

async function body(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) throw fault('JSON_REQUIRED', 'Send application/json.', 415);
  const parts = []; let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > MAX_CAPTURE_BYTES * 2 + 1048576) throw fault('SHEETS_UPLOAD_TOO_LARGE', 'The selected source file is too large.', 413);
    parts.push(part);
  }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts))); }
  catch { throw fault('SHEETS_UPLOAD_JSON_INVALID', 'Choose a complete UTF-8 JSON file.'); }
}

function upload(value) {
  if (value?.encoding !== 'base64' || typeof value.data !== 'string' || value.data.length > Math.ceil(MAX_CAPTURE_BYTES / 3) * 4 ||
      !Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > MAX_CAPTURE_BYTES ||
      !/^[a-f0-9]{64}$/.test(value.sha256 ?? '') || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.data))
    throw fault('SHEETS_UPLOAD_INVALID');
  const result = Buffer.from(value.data, 'base64');
  if (result.length !== value.bytes || digest(result) !== value.sha256) throw fault('SHEETS_UPLOAD_CHANGED');
  return result;
}

export async function serveSheetsAuthoring({ workspace, port = 8453 } = {}) {
  if (!workspace || typeof workspace.saveVersion !== 'function' || !Number.isInteger(port) || port < 0 || port > 65535)
    throw new TypeError('An open source workspace and valid port are required');
  const token = randomBytes(32).toString('hex'), expectedToken = Buffer.from(token);
  const assets = new Map(await Promise.all([
    ['/', 'index.html', 'text/html; charset=utf-8'], ['/browser.mjs', 'browser.mjs', 'text/javascript; charset=utf-8'],
    ['/style.css', 'style.css', 'text/css; charset=utf-8'],
  ].map(async ([path, file, mime]) => [path, { content: await readFile(new URL('./' + file, import.meta.url)), mime }])));
  let origin, closing;
  const server = createServer((req, res) => {
    const send = (status, value, mime = 'application/json; charset=utf-8', filename) => {
      const output = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
      res.writeHead(status, { 'content-type': mime, 'content-length': output.length, 'cache-control': 'no-store',
        'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
        'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
        ...(filename ? { 'content-disposition': 'attachment; filename="' + filename + '"' } : {}),
      }); res.end(output);
    };
    const handle = async () => {
      if (req.headers.host !== new URL(origin).host || req.headers.origin && req.headers.origin !== origin ||
          req.headers['sec-fetch-site'] === 'cross-site') throw fault('LOCAL_ORIGIN_REQUIRED', 'Open the exact local address printed by this process.', 403);
      if (typeof req.url !== 'string' || !req.url.startsWith('/') || req.url.startsWith('//')) throw fault('INVALID_REQUEST_TARGET');
      const url = new URL(req.url, origin), path = url.pathname;
      if (req.method === 'GET' && !url.search && assets.has(path)) {
        const asset = assets.get(path); return send(200, asset.content, asset.mime);
      }
      if (req.method === 'GET' && path === '/api/health') return send(200, { ready: !closing, service: 'sheets-source-authoring' });
      const supplied = Buffer.from(typeof req.headers['x-sheets-workspace-token'] === 'string' ? req.headers['x-sheets-workspace-token'] : '');
      if (supplied.length !== expectedToken.length || !timingSafeEqual(supplied, expectedToken))
        throw fault('SHEETS_WORKSPACE_SESSION_REQUIRED', 'Open the complete private URL printed by the current workspace process.', 403);
      if (closing) throw fault('SHEETS_WORKSPACE_CLOSING', 'The workspace is stopping.', 409);
      if (req.method === 'GET') {
        if (path === '/api/status') {
          const options = {};
          for (const key of ['limit', 'capturesOffset', 'versionsOffset']) if (url.searchParams.has(key)) options[key] = Number(url.searchParams.get(key));
          return send(200, await workspace.status(options));
        }
        if (path === '/api/deployment/status') {
          const options = {};
          for (const key of ['limit', 'runsOffset', 'operationsOffset']) if (url.searchParams.has(key)) options[key] = Number(url.searchParams.get(key));
          return send(200, await workspace.deploymentStatus(options));
        }
        if (path === '/api/deployment/package') return send(200, await workspace.inspectDeploymentPackage(url.searchParams.get('id')));
        if (path === '/api/deployment/compare') return send(200, await workspace.compareDeployment({
          from: url.searchParams.get('from'), to: url.searchParams.get('to') }));
        if (path === '/api/deployment/file') {
          const file = await workspace.deploymentFile(url.searchParams.get('packageId'), url.searchParams.get('file'));
          return send(200, file.bytes, file.mime, file.filename);
        }
        if (path === '/api/capture') return send(200, await workspace.inspectCapture(url.searchParams.get('id'), url.searchParams.get('range') ?? undefined));
        if (path === '/api/operation') return send(200, { operation: workspace.operation(url.searchParams.get('id')) });
        if (path === '/api/version') return send(200, workspace.version(Number(url.searchParams.get('id'))));
        if (path === '/api/compare') return send(200, await workspace.compareVersions(Number(url.searchParams.get('left')), Number(url.searchParams.get('right'))));
        if (path === '/api/export') {
          const file = await workspace.exportVersion(Number(url.searchParams.get('id')));
          return send(200, file.bytes, file.mime, file.filename);
        }
        throw fault('NOT_FOUND', 'Page not found.', 404);
      }
      if (req.method !== 'POST') throw fault('NOT_FOUND', 'Action not found.', 404);
      const input = await body(req);
      if (path === '/api/workbook') return send(200, await workspace.workbook(input));
      if (path === '/api/import') return send(201, await workspace.importObservation({ ...input, resourceBytes: upload(input.resource) }));
      if (path === '/api/import-package') return send(201, await workspace.importPacket(input));
      if (path === '/api/capture') return send(201, await workspace.readLive(input));
      if (path === '/api/draft') return send(200, await workspace.saveDraft(input));
      if (path === '/api/preview') return send(200, await workspace.preview(input));
      if (path === '/api/version') return send(201, await workspace.saveVersion(input));
      if (path === '/api/select') return send(200, await workspace.selectVersion(input));
      if (path === '/api/publisher/start') return send(200, await workspace.openPublisher(input));
      if (path === '/api/publisher/stop') return send(200, await workspace.closePublisher(input));
      if (path === '/api/deployment/review') return send(200, await workspace.reviewDeployment(input));
      if (path === '/api/deployment/prepare') return send(201, await workspace.prepareDeployment(input));
      if (path === '/api/deployment/stage') return send(201, await workspace.stageDeployment(input));
      if (path === '/api/deployment/console/open') return send(200, await workspace.openDeploymentConsole(input));
      if (path === '/api/deployment/console/close') return send(200, await workspace.closeDeploymentConsole(input));
      if (path === '/api/deployment/command') return send(200, await workspace.commandDeployment(input));
      if (path === '/api/resume') return send(200, await workspace.resume(input.requestId));
      throw fault('NOT_FOUND', 'Action not found.', 404);
    };
    handle().catch(issue => {
      if (!res.headersSent && !res.destroyed) send([400, 403, 404, 409, 413, 415, 422, 502].includes(issue.status) ? issue.status : 422,
        { error: issue.code ?? 'SHEETS_AUTHORING_FAILED', message: issue.code ? issue.message : 'Inspect the selected input and retained operation.' });
      else if (!res.writableEnded) res.end();
    });
  });
  server.requestTimeout = 180000; server.headersTimeout = 15000; server.keepAliveTimeout = 1000;
  await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done); });
  origin = new URL(`http://127.0.0.1:${server.address().port}`).origin;
  return { server, workspace, origin, token, url: origin + '/#token=' + token,
    close() {
      closing ??= (async () => {
        const stopped = new Promise((done, reject) => server.close(issue => issue ? reject(issue) : done()));
        server.closeIdleConnections?.();
        try { await workspace.close(); } finally { server.closeAllConnections?.(); await stopped; }
      })(); return closing;
    } };
}

