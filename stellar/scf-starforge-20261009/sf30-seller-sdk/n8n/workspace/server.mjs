// MIT. Private n8n merchant console over original native jobs and dispatch records.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { JOB_ID } from '../../jobs/config.mjs';
import { fault } from '../config.mjs';

const assetFiles = [['/', 'index.html', 'text/html; charset=utf-8'],
  ['/app.mjs', 'app.mjs', 'text/javascript; charset=utf-8'], ['/style.css', 'style.css', 'text/css; charset=utf-8']];
const policy = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer', 'cross-origin-resource-policy': 'same-origin',
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" };
function fields(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !allowed.includes(k)))
    throw fault('REQUEST_FIELDS', 'Use only the fields declared by this operation.');
}
async function body(request) {
  if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json')
    throw fault('REQUEST_JSON', 'Send an application/json object.', 415);
  let size = 0; const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1100000) throw fault('REQUEST_LIMIT', 'The request exceeds the original job input limit.', 413);
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw fault('REQUEST_JSON', 'Enter a UTF-8 JSON object.'); }
  return value;
}
export async function startN8nWorkspace({ merchant, port = 0 } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw fault('PORT', 'Choose a port from 0 to 65535.');
  const token = randomBytes(32).toString('hex'), expected = Buffer.from('Bearer ' + token);
  const assets = new Map(await Promise.all(assetFiles.map(async ([path, file, type]) =>
    [path, { type, bytes: await readFile(new URL('./public/' + file, import.meta.url)) }])));
  const pending = new Set(), readers = new Set();
  let origin, host, closing = false, closePromise, drain;
  const server = createServer((request, response) => {
    const operation = (async () => {
      const send = (status, value, type = 'application/json; charset=utf-8', headers = {}) => {
        if (response.destroyed) return;
        const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
        response.writeHead(status, { ...policy, 'content-type': type, 'content-length': bytes.length, ...headers });
        response.end(request.method === 'HEAD' ? undefined : bytes);
      };
      try {
        if (closing) throw fault('CLOSING', 'This original merchant is closing.', 503);
        if (request.headers.host !== host || request.headers.origin && request.headers.origin !== origin ||
            ['cross-site', 'same-site'].includes(request.headers['sec-fetch-site']))
          throw fault('ORIGIN', 'Use the private launch URL on the operator host.', 403);
        const url = new URL(request.url, origin);
        if (url.search) throw fault('QUERY', 'This endpoint uses the original path and JSON request.');
        if (['GET', 'HEAD'].includes(request.method) && assets.has(url.pathname)) {
          const asset = assets.get(url.pathname); return send(200, asset.bytes, asset.type);
        }
        const supplied = Buffer.from(request.headers.authorization ?? '');
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
          throw fault('AUTH', 'Open the complete private launch URL from the merchant terminal.', 401);
        const match = /^\/api\/jobs\/([^/?#]+)(?:\/(result|retry|cancel|renew-claim|reconcile|authorize-rerun))?$/.exec(url.pathname);
        if (match) {
          let id; try { id = decodeURIComponent(match[1]); } catch {}
          if (!id || !JOB_ID.test(id) || encodeURIComponent(id) !== match[1]) throw fault('NOT_FOUND', 'Select an original job.', 404);
          match[1] = id;
        }
        if (['GET', 'HEAD'].includes(request.method)) {
          if (url.pathname === '/api/state') return send(200, await merchant.snapshot());
          if (url.pathname === '/api/export') return send(200, await merchant.exportState(), undefined,
            { 'content-disposition': 'attachment; filename="automation-merchant.json"' });
          if (match && !match[2]) return send(200, await merchant.get(match[1]));
          if (match?.[2] === 'result') {
            const result = await merchant.model.result(match[1]);
            return send(200, result.body, result.contentType, { 'content-disposition': 'attachment; filename="' + result.filename + '"',
              'x-content-sha256': result.sha256 });
          }
          throw fault('NOT_FOUND', 'This job or operation was not found.', 404);
        }
        if (request.method !== 'POST') throw fault('METHOD', 'Use GET or POST.', 405);
        readers.add(request); let input;
        try { input = await body(request); } finally { readers.delete(request); }
        if (url.pathname === '/api/jobs') {
          fields(input, ['functionId', 'input', 'label', 'reference']);
          return send(201, await merchant.model.createJob(input));
        }
        if (url.pathname === '/api/worker/start') {
          fields(input, []);
          if (drain) throw fault('DRAINING', 'The original worker is finishing its current jobs.', 409);
          return send(200, await merchant.model.startWorker());
        }
        if (url.pathname === '/api/worker/stop') {
          fields(input, []);
          if (!drain) { drain = merchant.model.stopWorker({ cancelRunning: false }); drain.finally(() => { drain = null; }).catch(() => {}); }
          return send(200, await merchant.snapshot());
        }
        if (match && ['retry', 'cancel', 'renew-claim'].includes(match[2])) {
          fields(input, ['expectedRevision', 'reason']);
          const name = match[2] === 'renew-claim' ? 'renewClaim' : match[2];
          return send(200, await merchant.model[name]({ id: match[1], ...input }));
        }
        if (match?.[2] === 'reconcile') {
          fields(input, ['expectedRevision', 'reason', 'executionId']);
          return send(200, await merchant.reconcile(match[1], input));
        }
        if (match?.[2] === 'authorize-rerun') {
          fields(input, ['expectedRevision', 'jobRevision', 'reason']);
          return send(200, await merchant.authorizeRerun(match[1], input));
        }
        throw fault('NOT_FOUND', 'This operation was not found.', 404);
      } catch (error) {
        if (response.headersSent) return response.destroy();
        const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status :
          error.code === 'ENOENT' ? 404 : 500;
        send(status, { code: error.code ?? 'JOB_AUTOMATION_OPERATION_FAILED',
          message: status === 500 ? 'The original merchant retained this operation. Review its source and state before resuming.' : error.message });
      }
    })();
    pending.add(operation); operation.finally(() => pending.delete(operation)).catch(() => {});
  });
  server.requestTimeout = 30000; server.headersTimeout = 10000; server.keepAliveTimeout = 2000;
  await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => {
    server.off('error', reject); done();
  }); });
  const address = new URL('http://127.0.0.1:' + server.address().port);
  host = address.host; origin = address.origin;
  return { server, token, origin, url: origin + '/#' + token, close() {
    return closePromise ??= (async () => {
      closing = true; for (const request of readers) request.destroy();
      const stopped = new Promise(done => server.close(done)); server.closeIdleConnections?.();
      await Promise.allSettled([...pending]); server.closeAllConnections?.(); await stopped;
    })();
  } };
}
