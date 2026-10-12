// MIT. Private operator view of the original durable job merchant.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { JOB_ID } from '../config.mjs';

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);
const fault = (code, message, status = 400) => Object.assign(new Error(message), { code, status });
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const policy = {
  'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer', 'cross-origin-resource-policy': 'same-origin',
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
};
async function readJSON(req) {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json')
    throw fault('JSON_REQUIRED', 'Send application/json.', 415);
  const chunks = []; let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 1024 * 1024) throw fault('REQUEST_TOO_LARGE', 'The job request exceeds 1 MiB.', 413);
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw fault('INVALID_JSON', 'Enter a valid JSON object.'); }
  if (!plain(value)) throw fault('OBJECT_REQUIRED', 'Enter a JSON object.');
  return value;
}
function fields(value, allowed) {
  if (Object.keys(value).some(key => !allowed.includes(key)))
    throw fault('UNKNOWN_FIELD', 'The request contains an unsupported field.');
  return value;
}
function name(value) {
  return String(value || 'job-result.bin').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 160) || 'job-result.bin';
}
/** The owning merchant retains the model, lease and worker lifetime. */
export async function startJobsWorkspace({ model, delivery = null, port = 0 } = {}) {
  if (!model || typeof model.snapshot !== 'function' || typeof model.get !== 'function')
    throw fault('JOB_MODEL_REQUIRED', 'Open the original job merchant first.');
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw fault('INVALID_PORT', 'Choose an integer port from 0 to 65535.');
  const token = randomBytes(32).toString('hex'), expected = Buffer.from('Bearer ' + token);
  const staticAssets = new Map(await Promise.all([...assets].map(async ([path, [file, type]]) =>
    [path, { body: await readFile(new URL('./public/' + file, import.meta.url)), type }])));
  if (delivery) {
    const deliveryAssets = [
      ['/deliveries', 'index.html', 'text/html; charset=utf-8'],
      ['/job-result-delivery.mjs', 'app.mjs', 'text/javascript; charset=utf-8'],
      ['/job-result-delivery.css', 'style.css', 'text/css; charset=utf-8'],
    ];
    for (const [path, file, type] of deliveryAssets)
      staticAssets.set(path, { body: await readFile(new URL('../result-delivery/workspace/' + file, import.meta.url)), type });
  }
  const pending = new Set(), readers = new Set();
  let origin, hostname, closing = false, closingPromise, drainPromise, drainError;
  const snapshot = async () => ({ ...await model.snapshot(), operator: { drainError: drainError ?? null },
    ...(delivery ? { resultDelivery: { workspace: '/deliveries' } } : {}) });
  const server = createServer((req, res) => {
    const operation = (async () => {
      function send(status, data, type = 'application/json; charset=utf-8', extra = {}) {
        if (res.destroyed) return;
        const body = Buffer.isBuffer(data) ? data : Buffer.from(typeof data === 'string' ? data : JSON.stringify(data));
        res.writeHead(status, { ...policy, 'content-type': type, 'content-length': String(body.length), ...extra });
        res.end(req.method === 'HEAD' ? undefined : body);
      }
      try {
        if (closing) throw fault('WORKSPACE_CLOSING', 'The operator workspace is closing.', 503);
        if (req.headers.host !== hostname || req.headers.origin && req.headers.origin !== origin ||
            ['cross-site', 'same-site'].includes(req.headers['sec-fetch-site']))
          throw fault('WORKSPACE_ORIGIN_REQUIRED', 'Use the original private workspace address.', 403);
        const url = new URL(req.url, origin);
        if (url.search) throw fault('UNSUPPORTED_QUERY', 'This endpoint does not accept query parameters.');
        if (['GET', 'HEAD'].includes(req.method) && staticAssets.has(url.pathname)) {
          const asset = staticAssets.get(url.pathname); return send(200, asset.body, asset.type);
        }
        const supplied = Buffer.from(String(req.headers.authorization ?? ''));
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
          throw fault('WORKSPACE_AUTH_REQUIRED', 'Open the complete private launch address from your terminal.', 401);
        const match = /^\/api\/jobs\/([^/?#]+)(?:\/(preview|result|cancel|retry|renew-claim))?$/.exec(url.pathname);
        if (match) {
          let id;
          try { id = decodeURIComponent(match[1]); } catch { throw fault('NOT_FOUND', 'This job was not found.', 404); }
          if (!JOB_ID.test(id) || encodeURIComponent(id) !== match[1])
            throw fault('NOT_FOUND', 'This job was not found.', 404);
          match[1] = id;
        }
        if (['GET', 'HEAD'].includes(req.method)) {
          if (url.pathname === '/api/state') return send(200, await snapshot());
          if (delivery && url.pathname === '/api/deliveries') return send(200, delivery.snapshot());
          if (delivery && url.pathname === '/api/deliveries/export') return send(200, {
            schema: 'stellar-forge.job-result-delivery-export.v1', capturedAt: new Date().toISOString(),
            snapshot: delivery.snapshot(),
          }, undefined, { 'content-disposition': 'attachment; filename="job-result-deliveries.json"' });
          if (delivery && /^\/api\/deliveries\/[a-f0-9]{64}$/.test(url.pathname))
            return send(200, delivery.get(url.pathname.split('/')[3]));
          if (url.pathname === '/api/export') return send(200, {
            schema: 'stellar-forge.paid-jobs.operator-export.v1', capturedAt: new Date().toISOString(),
            snapshot: await model.snapshot(),
          }, undefined, { 'content-disposition': 'attachment; filename="paid-jobs-ledger.json"' });
          if (match && !match[2]) return send(200, await model.get(match[1]));
          if (match && ['preview', 'result'].includes(match[2])) {
            const output = await model.result(match[1]);
            if (!Buffer.isBuffer(output.body)) throw fault('RESULT_UNAVAILABLE', 'The completed result is unavailable.', 409);
            if (match[2] === 'result') return send(200, output.body, output.contentType || 'application/octet-stream', {
              'content-disposition': 'attachment; filename="' + name(output.filename) + '"',
              'x-sfjobs-sha256': output.sha256,
            });
            const previewBytes = output.body.subarray(0, 262144);
            let text = null;
            try { text = new TextDecoder('utf-8', { fatal: true }).decode(previewBytes); } catch {}
            return send(200, { filename: output.filename, contentType: output.contentType, bytes: output.bytes,
              sha256: output.sha256, truncated: output.body.length > previewBytes.length, text });
          }
          throw fault('NOT_FOUND', 'This job or endpoint was not found.', 404);
        }
        if (req.method !== 'POST') throw fault('METHOD_NOT_ALLOWED', 'Use GET or POST.', 405);
        readers.add(req); let input;
        try { input = await readJSON(req); } finally { readers.delete(req); }
        const deliveryCommand = delivery && /^\/api\/deliveries\/(scan|drain|start|stop)$/.exec(url.pathname);
        if (deliveryCommand) {
          fields(input, []); return send(200, await delivery[deliveryCommand[1]]());
        }
        if (delivery && /^\/api\/deliveries\/[a-f0-9]{64}\/requeue$/.test(url.pathname)) {
          fields(input, ['expectedRevision', 'reason']);
          return send(200, await delivery.requeue({ id: url.pathname.split('/')[3], ...input }));
        }
        if (url.pathname === '/api/jobs') {
          fields(input, ['functionId', 'input', 'label', 'reference']);
          return send(201, await model.createJob(input));
        }
        if (url.pathname === '/api/reconcile') {
          fields(input, []); return send(200, await model.reconcile());
        }
        if (url.pathname === '/api/worker/start') {
          fields(input, []);
          if (drainPromise) throw fault('WORKER_DRAINING', 'Let current work drain, or cancel its running job, before restarting.', 409);
          return send(200, await model.startWorker());
        }
        if (url.pathname === '/api/worker/stop') {
          fields(input, []);
          if (!drainPromise) {
            drainError = null;
            drainPromise = model.stopWorker({ cancelRunning: false });
            drainPromise.catch(error => { drainError = error.code || 'WORKER_DRAIN_FAILED'; })
              .finally(() => { drainPromise = null; });
          }
          return send(200, await snapshot());
        }
        if (match && ['cancel', 'retry', 'renew-claim'].includes(match[2])) {
          fields(input, ['expectedRevision', 'reason']);
          if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1)
            throw fault('REVISION_REQUIRED', 'Refresh and select the current job revision.', 409);
          if (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 500)
            throw fault('REASON_REQUIRED', 'Enter a reason of 1 to 500 characters.');
          const method = match[2] === 'renew-claim' ? 'renewClaim' : match[2];
          return send(200, await model[method]({ id: match[1], ...input }));
        }
        throw fault('NOT_FOUND', 'This endpoint was not found.', 404);
      } catch (error) {
        if (res.headersSent) { res.destroy(); return; }
        const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status :
          error.code === 'ENOENT' ? 404 : /REVISION|CONFLICT|BUSY|NOT_READY|STATE/.test(error.code ?? '') ? 409 :
          error instanceof TypeError || error instanceof RangeError ? 400 : 500;
        send(status, { code: error.code || 'JOB_OPERATION_FAILED', message: status === 500 ?
          'The operation could not complete. The original job remains in its workspace.' : error.message });
      }
    })();
    pending.add(operation); operation.finally(() => pending.delete(operation)).catch(() => {});
  });
  server.requestTimeout = 30000; server.headersTimeout = 10000; server.keepAliveTimeout = 2000;
  await new Promise((done, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', () => { server.off('error', fail); done(); }); });
  hostname = '127.0.0.1:' + server.address().port; origin = 'http://' + hostname;
  return { server, model, origin, token, url: origin + '/#' + token, close() {
    return closingPromise ??= (async () => {
      closing = true; for (const request of readers) request.destroy();
      const stopped = new Promise(done => server.close(done)); server.closeIdleConnections?.();
      await Promise.allSettled([...pending]); server.closeAllConnections?.(); await stopped;
      // A drain belongs to the borrowed model; its owner closes or aborts it.
    })();
  } };
}
