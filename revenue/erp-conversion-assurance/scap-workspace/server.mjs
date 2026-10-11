// MIT. Private loopback browser host for the original reconciliation service.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { openReconciliationService } from '../service/service.mjs';
import { SCAP_PROFILE } from '../profiles/scap-rfp-2027/profile.mjs';
import { createConversionWorkspace } from './model.mjs';
import { WorkspaceError, fail } from './mapping.mjs';

const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']],
  ['/mapping.mjs', ['mapping.mjs', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);
const messages = {
  ENOENT: 'The selected retained job or bundle could not be found.',
  JOB_INPUT_CONFLICT: 'This job ID already belongs to another bundle. Reopen it or choose a new job ID.',
  BUNDLE_CHANGED: 'The retained bundle no longer matches its recorded bytes. Reopen the original source custody before running it.',
  REPORT_CHANGED: 'The report no longer matches its recorded digest.',
  REPORT_NOT_READY: 'The original job has not produced a completed report yet.',
  REVIEW_REPORT_CONFLICT: 'The review must name the exact completed report. Refresh the selected run.',
  QUEUE_BUSY: 'The original service is updating its queue. Refresh the job before deciding whether to submit again.',
  RECOVERY_NOT_REQUIRED: 'This job does not require recovery. Refresh its current state.',
  FLEET_STATE_ALREADY_OWNED: 'An original worker currently owns this operation. Refresh its status before recovery.',
  PRIVATE_DIRECTORY_REQUIRED: 'Choose a private service directory owned by the operating-system account.',
  INPUT_CHANGED_DURING_IMPORT: 'An export changed during intake. Select the completed export and stage it again.',
  INPUT_LIMIT_EXCEEDED: 'An export exceeds the service’s saved input limit.',
  SERVICE_CONFIGURATION_MISMATCH: 'The supplied limits differ from this retained service’s configuration.',
  SPEC_INVALID: 'The retained mapping is not valid JSON.',
  EEXIST: 'The requested create-only destination already exists.',
};
const conflicts = new Set(['JOB_INPUT_CONFLICT', 'BUNDLE_CHANGED', 'REPORT_CHANGED', 'REPORT_NOT_READY',
  'REVIEW_REPORT_CONFLICT', 'QUEUE_BUSY', 'RECOVERY_NOT_REQUIRED', 'FLEET_STATE_ALREADY_OWNED', 'EEXIST']);

function errorView(error) {
  if (error instanceof WorkspaceError) return { status: error.status, error: error.code, message: error.message };
  const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.code) ? error.code : 'WORKSPACE_FAILED';
  return { status: code === 'ENOENT' ? 404 : conflicts.has(code) ? 409 : messages[code] ? 400 : 500,
    error: code, message: messages[code] ?? 'The operation could not complete. Refresh the retained job and use its original service status.' };
}

function headers(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
}

function send(res, status, body) {
  if (res.destroyed || res.writableEnded) return;
  res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

async function readJson(req, maximum) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? ''))
    fail('JSON_REQUIRED', 'Use a JSON request for this operation.', 415);
  const advertised = req.headers['content-length'];
  if (advertised !== undefined && (!/^\d+$/.test(advertised) || Number(advertised) > maximum))
    fail('REQUEST_LIMIT_EXCEEDED', 'The request exceeds this service’s intake limit.', 413);
  const chunks = []; let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > maximum) fail('REQUEST_LIMIT_EXCEEDED', 'The request exceeds this service’s intake limit.', 413);
    chunks.push(chunk);
  }
  let result;
  try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { fail('JSON_INVALID', 'The request is not valid JSON.'); }
  if (result === null || typeof result !== 'object' || Array.isArray(result)) fail('JSON_INVALID', 'The request must be a JSON object.');
  return result;
}

function upload(value, side, maximum) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || typeof value.name !== 'string' || value.encoding !== 'base64' || typeof value.data !== 'string' ||
      value.data.length > Math.ceil(maximum / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.data))
    fail('INPUT_INVALID', `The ${side} file upload is invalid.`);
  const bytes = Buffer.from(value.data, 'base64');
  if (bytes.length > maximum || bytes.toString('base64') !== value.data) fail('INPUT_INVALID', `The ${side} file upload is invalid.`);
  return { name: value.name, bytes };
}

export async function startConversionWorkspace({ directory, profile = SCAP_PROFILE, port = 8470,
  service: suppliedService, extension = null, ...limits } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) fail('PORT_INVALID', 'Port must be an integer from 0 to 65535.');
  const service = suppliedService ?? await openReconciliationService({ directory, ...limits });
  if (extension !== null && (typeof extension !== 'object' || Array.isArray(extension)))
    fail('EXTENSION_INVALID', 'Use a trusted local profile extension.');
  const model = createConversionWorkspace({ service, profile, extension });
  const token = randomBytes(32).toString('hex'), tokenBytes = Buffer.from(token);
  const assets = new Map(await Promise.all([...files].map(async ([path, [name, type]]) =>
    [path, { bytes: await readFile(new URL(name, import.meta.url)), type }])));
  for (const asset of extension?.assets ?? []) {
    if (!asset || typeof asset.path !== 'string' || !/^\/[A-Za-z0-9_.\/-]+$/.test(asset.path) ||
      asset.path.includes('..') || asset.path.includes('//') || asset.path.startsWith('/api/') ||
      asset.path === '/health' || assets.has(asset.path) ||
      !['text/javascript; charset=utf-8', 'text/css; charset=utf-8', 'application/json; charset=utf-8'].includes(asset.type))
      fail('EXTENSION_INVALID', 'The profile extension has an invalid or conflicting asset.');
    assets.set(asset.path, { bytes: await readFile(asset.file), type: asset.type });
  }
  const extensionInfo = extension?.browserModule ? { id: extension.id, browserModule: extension.browserModule } : null;
  if (extensionInfo && (!assets.has(extensionInfo.browserModule) || typeof extensionInfo.id !== 'string'))
    fail('EXTENSION_INVALID', 'The profile extension must name its explicit browser module.');
  const maximumRequest = Math.ceil(model.configuration.maxInputBytes / 3) * 8 + 1024 * 1024;
  let origin, hostnames, closing;

  const server = createServer(async (req, res) => {
    headers(res);
    req.setTimeout(60000, () => req.destroy());
    try {
      if (!hostnames?.has(req.headers.host) || !req.url?.startsWith('/') || req.url.startsWith('//'))
        fail('HOST_REJECTED', 'Use the exact local workspace address.', 421);
      const requestOrigin = `http://${req.headers.host}`;
      if (req.headers.origin !== undefined && req.headers.origin !== requestOrigin)
        fail('ORIGIN_REJECTED', 'Use this workspace’s own page for the operation.', 403);
      const url = new URL(req.url, requestOrigin);
      if (req.method === 'GET' && url.pathname === '/health' && !url.search) return send(res, 200, { status: 'ok', application: 'conversion-workspace' });
      const asset = req.method === 'GET' && !url.search ? assets.get(url.pathname) : null;
      if (asset) { res.statusCode = 200; res.setHeader('Content-Type', asset.type); return res.end(asset.bytes); }
      if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'NOT_FOUND', message: 'The workspace endpoint was not found.' });
      const provided = req.headers['x-erp-workspace-token'];
      if (typeof provided !== 'string' || !/^[a-f0-9]{64}$/.test(provided) || !timingSafeEqual(Buffer.from(provided), tokenBytes))
        fail('WORKSPACE_ACCESS_REQUIRED', 'Open the private workspace URL printed by the launcher.', 401);
      if (req.method !== 'GET' && req.headers.origin !== requestOrigin)
        fail('ORIGIN_REQUIRED', 'The operation needs the exact workspace Origin.', 403);
      if (!['GET', 'POST'].includes(req.method)) { res.setHeader('Allow', 'GET, POST'); return send(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Use the supported workspace operation.' }); }
      if (req.method === 'POST' && url.search) fail('QUERY_REJECTED', 'Submit changes in the request body.');

      if (req.method === 'GET' && url.pathname === '/api/bootstrap') return send(res, 200, { profile: model.profile, configuration: model.configuration, ...(extensionInfo ? { extension: extensionInfo } : {}) });
      if (req.method === 'GET' && url.pathname === '/api/jobs') return send(res, 200, await model.listJobs({ limit: Number(url.searchParams.get('limit') ?? 25), after: url.searchParams.get('after') ?? '' }));
      if (req.method === 'GET' && url.pathname === '/api/bundles') return send(res, 200, await model.listBundles({ limit: Number(url.searchParams.get('limit') ?? 25), after: url.searchParams.get('after') ?? '' }));
      let match = /^\/api\/bundles\/([a-f0-9]{64})$/.exec(url.pathname);
      if (req.method === 'GET' && match) return send(res, 200, await model.getBundle(match[1]));
      match = /^\/api\/jobs\/([^/]+)(?:\/(handoff|cancel|recover))?$/.exec(url.pathname);
      if (match) {
        const jobId = decodeURIComponent(match[1]), action = match[2];
        if (req.method === 'GET' && !action) return send(res, 200, await model.getJob(jobId, {
          kind: url.searchParams.get('kind') ?? 'records', offset: Number(url.searchParams.get('offset') ?? 0),
          limit: Number(url.searchParams.get('limit') ?? 50), filter: url.searchParams.get('filter') ?? '',
        }));
        if (req.method === 'GET' && action === 'handoff') {
          const artifact = await model.createHandoff(jobId);
          try {
            res.statusCode = 200; res.setHeader('Content-Type', 'application/gzip');
            res.setHeader('Content-Disposition', `attachment; filename="${artifact.filename}"`);
            res.setHeader('Content-Length', artifact.bytes);
            res.setHeader('X-Reconciliation-Report-Sha256', artifact.exported.reportSha256);
            await pipeline(artifact.stream(), res);
          } finally { await artifact.close(); }
          return;
        }
        if (req.method === 'POST' && ['cancel', 'recover'].includes(action)) {
          await readJson(req, 1024);
          return send(res, 200, await model[action](jobId));
        }
      }
      if (req.method === 'POST' && url.pathname === '/api/stage') {
        const body = await readJson(req, maximumRequest);
        const result = await model.stage({ draft: body.draft, baseBundleId: body.baseBundleId, previousJobId: body.previousJobId,
          source: upload(body.source, 'source', model.configuration.maxInputBytes), target: upload(body.target, 'target', model.configuration.maxInputBytes) });
        return send(res, 200, result);
      }
      if (req.method === 'POST' && url.pathname === '/api/execute') {
        const body = await readJson(req, 4096);
        return send(res, 200, await model.execute({ jobId: body.jobId, bundleId: body.bundleId }));
      }
      if (req.method === 'POST' && url.pathname === '/api/review') {
        const body = await readJson(req, 32 * 1024);
        return send(res, 200, await model.review(body));
      }
      if (extension?.handleRequest && await extension.handleRequest({ req, res, url, model, service, readJson, send })) return;
      return send(res, 404, { error: 'NOT_FOUND', message: 'The workspace endpoint was not found.' });
    } catch (error) {
      if (res.headersSent) { if (!res.writableEnded) res.destroy(); return; }
      const view = errorView(error); send(res, view.status, { error: view.error, message: view.message });
    }
  });
  server.headersTimeout = 10000; server.requestTimeout = 60000; server.keepAliveTimeout = 5000;
  await new Promise((yes, no) => { server.once('error', no); server.listen(port, '127.0.0.1', yes); });
  const actualPort = server.address().port;
  origin = `http://127.0.0.1:${actualPort}`;
  hostnames = new Set([`127.0.0.1:${actualPort}`, `localhost:${actualPort}`]);
  const close = () => closing ??= new Promise((yes, no) => {
    server.close(error => { model.close(); if (error) no(error); else yes(); }); server.closeIdleConnections();
  });
  return Object.freeze({ server, model, origin, url: `${origin}/#${token}`, close });
}
