// MIT. Private operator UI over the ORIGINAL fleetControl adapter.
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fleetControl } from '../control.mjs';

const HOST = '127.0.0.1';
const USAGE = `Usage: node workspace/server.mjs --state PRIVATE_FLEET_DIRECTORY
  [--manifest NAME=FILE ...] [--port 8402]
Or: node workspace/server.mjs --releases ORIGINAL_PLAN --release-state PRIVATE_DIRECTORY
  [--state PRIVATE_GATEWAY_DIRECTORY] [--port 8402]
The existing gateway must be running with --state. Manifest names are declared
by the operator at startup. Managed mode starts the original release sessions
and gateway itself. The browser never supplies filesystem paths.`;
const failure = (code, status = 400) => Object.assign(new Error(code), { status });
const positive = value => Number.isSafeInteger(value) && value > 0;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function keys(value, allowed) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key)))
    throw failure('WORKSPACE_REQUEST_INVALID');
}
function nativeError(error) {
  if (/^[A-Z][A-Z0-9_]{1,100}$/.test(error?.message ?? '')) return error.message;
  if (/original live seller .*drift/.test(error?.message ?? '')) return 'FLEET_SELLER_IDENTITY_DRIFT';
  if (/NOT an original SF30 seller/.test(error?.message ?? '')) return 'FLEET_SELLER_UNAVAILABLE';
  return 'FLEET_CONTROL_REJECTED';
}
async function body(req) {
  if (req.headers['content-type']?.split(';', 1)[0].trim() !== 'application/json')
    throw failure('WORKSPACE_JSON_REQUIRED', 415);
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8192) throw failure('WORKSPACE_REQUEST_TOO_LARGE', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw failure('WORKSPACE_JSON_INVALID'); }
}

export async function startFleetWorkspace({ stateDirectory, manifests = {}, port = 8402,
  releasePlan, releaseDirectory } = {}) {
  const managed = releasePlan !== undefined;
  if (!managed && (typeof stateDirectory !== 'string' || !stateDirectory.trim())) throw new TypeError('--state is required');
  if (managed && (typeof releasePlan !== 'string' || !releasePlan.trim() ||
      typeof releaseDirectory !== 'string' || !releaseDirectory.trim())) throw new TypeError('--releases and --release-state are required together');
  if (!managed && releaseDirectory !== undefined) throw new TypeError('--release-state requires --releases');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError('Invalid workspace port');
  if (!object(manifests) || Object.keys(manifests).length > 32) throw new TypeError('At most 32 named manifests');
  if (managed && Object.keys(manifests).length) throw new TypeError('Managed releases use their original plan instead of manifest aliases');
  const sources = new Map();
  for (const [name, path] of Object.entries(manifests)) {
    if (!/^[a-z][a-z0-9-]{0,39}$/.test(name) || typeof path !== 'string' || !path.trim())
      throw new TypeError('Manifest requires a lowercase name and a file path');
    sources.set(name, resolve(path));
  }
  const assets = new Map(await Promise.all([
    ['/', 'index.html', 'text/html; charset=utf-8'],
    ['/browser.mjs', 'browser.mjs', 'text/javascript; charset=utf-8'],
    ['/style.css', 'style.css', 'text/css; charset=utf-8'],
  ].map(async ([path, file, type]) => [path, { type, bytes: await readFile(new URL(file, import.meta.url)) }])));
  const releases = managed ? await (await import('../release-operator.mjs')).openFleetReleaseOperator({
    planFile: releasePlan, directory: releaseDirectory, gatewayStateDirectory: stateDirectory,
  }) : null;
  const directory = releases ? releases.stateDirectory : resolve(stateDirectory);
  const snapshot = async () => {
    const releaseStatus = releases ? await releases.status() : undefined;
    return { status: releaseStatus ? releaseStatus.native : await fleetControl(directory, 'status'),
      ...(releaseStatus ? { releaseStatus } : {}), capturedAt: new Date().toISOString() };
  };
  // Use original private control and lifecycle ownership in both modes.
  try { await snapshot(); } catch (error) { await releases?.close(); throw error; }
  const sessionKey = randomBytes(32).toString('base64url');
  let url, closing = false, closingPromise;
  const headers = {
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer', 'cross-origin-resource-policy': 'same-origin',
    'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  };
  const send = (res, code, value, type = 'application/json; charset=utf-8') => {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
    res.writeHead(code, { ...headers, 'content-type': type, 'content-length': bytes.length }); res.end(bytes);
  };
  const sameSession = req => {
    const key = req.headers['x-fleet-workspace'];
    return typeof key === 'string' && /^[A-Za-z0-9_-]{43}$/.test(key) &&
      timingSafeEqual(Buffer.from(key), Buffer.from(sessionKey));
  };
  const server = createServer((req, res) => {
    let operationDispatched = false;
    const handle = async () => {
      const hosts = req.rawHeaders.filter((_, index) => index % 2 === 0 && req.rawHeaders[index].toLowerCase() === 'host');
      if (!url || hosts.length !== 1 || req.headers.host !== new URL(url).host)
        return send(res, 403, { error: 'WORKSPACE_LOCAL_AUTHORITY_REQUIRED' });
      if ((req.headers.origin && req.headers.origin !== url) ||
          (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])))
        return send(res, 403, { error: 'WORKSPACE_SAME_ORIGIN_REQUIRED' });
      if (closing) return send(res, 503, { error: 'WORKSPACE_CLOSING' });
      const asset = assets.get(req.url);
      if (req.method === 'GET' && asset) return send(res, 200, asset.bytes, asset.type);
      if (req.method === 'GET' && req.url === '/api/session')
        return send(res, 200, { session: sessionKey, manifests: [...sources.keys()], managed });
      if (!sameSession(req)) return send(res, 403, { error: 'WORKSPACE_SESSION_REQUIRED' });
      if (req.method === 'GET' && req.url === '/api/status')
        return send(res, 200, await snapshot());
      if (releases && req.method === 'GET' && req.url.startsWith('/api/releases/catalog?')) {
        const params = new URL(req.url, url).searchParams;
        if ([...params.keys()].length !== 2 || !params.has('tenant') || !params.has('slot'))
          throw failure('WORKSPACE_REQUEST_INVALID');
        return send(res, 200, await releases.catalog({ tenant: params.get('tenant'), slot: params.get('slot') }));
      }
      const releaseActions = {
        stage: ['tenant', 'slot', 'package', 'releaseId'], review: ['tenant', 'slot', 'releaseId'],
        prepare: ['reviewId'], 'review-rollback': ['targetRevision'], rollback: ['reviewId'],
        retire: ['tenant', 'slot', 'instanceId', 'expectedRevision'],
      };
      if (releases && req.method === 'POST' && req.url.startsWith('/api/releases/')) {
        const action = req.url.slice('/api/releases/'.length), allowed = releaseActions[action];
        if (!Object.hasOwn(releaseActions, action)) return send(res, 404, { error: 'WORKSPACE_ROUTE_NOT_FOUND' });
        const input = await body(req); keys(input, allowed);
        const method = action === 'review-rollback' ? 'reviewRollback' : action;
        operationDispatched = !['review', 'review-rollback'].includes(action);
        return send(res, 200, { result: await releases[method](input) });
      }
      if (req.method !== 'POST' || !['/api/prepare', '/api/activate', '/api/rollback'].includes(req.url))
        return send(res, 404, { error: 'WORKSPACE_ROUTE_NOT_FOUND' });
      const input = await body(req), action = req.url.slice('/api/'.length);
      if (releases && action !== 'activate') throw failure('WORKSPACE_MANAGED_RELEASE_REVIEW_REQUIRED', 409);
      keys(input, action === 'prepare' ? ['manifest', 'expectedRevision'] : action === 'activate' ?
        ['candidateId', 'expectedRevision'] : ['targetRevision', 'expectedRevision']);
      if (!positive(input.expectedRevision)) throw failure('WORKSPACE_REVISION_REQUIRED');
      const payload = { expectedRevision: input.expectedRevision };
      if (action === 'prepare') {
        if (!sources.has(input.manifest)) throw failure('WORKSPACE_MANIFEST_NOT_REGISTERED');
        payload.manifestPath = sources.get(input.manifest);
      } else if (action === 'activate') {
        if (typeof input.candidateId !== 'string' || !/^[a-f0-9-]{36}$/.test(input.candidateId))
          throw failure('WORKSPACE_CANDIDATE_REQUIRED');
        payload.candidateId = input.candidateId;
      } else {
        if (!positive(input.targetRevision)) throw failure('WORKSPACE_ROLLBACK_REVISION_REQUIRED');
        payload.targetRevision = input.targetRevision;
      }
      operationDispatched = true;
      const result = releases ? (await releases.activate(payload)).native : await fleetControl(directory, action, payload);
      send(res, 200, { status: result, capturedAt: new Date().toISOString() });
    };
    handle().catch(error => {
      if (res.headersSent) return res.destroy();
      const unknown = operationDispatched && (!error.status || error.status >= 500);
      const status = unknown ? 502 : [400, 401, 403, 404, 409, 413, 415, 422, 503].includes(error.status) ? error.status : 502;
      send(res, status, { error: unknown ? 'WORKSPACE_OPERATION_OUTCOME_UNKNOWN' : nativeError(error) });
    });
  });
  server.requestTimeout = 45000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000;
  try { await new Promise((done, fail) => { server.once('error', fail); server.listen(port, HOST, done); }); }
  catch (error) { await releases?.close(); throw error; }
  url = 'http://' + HOST + ':' + server.address().port;
  return {
    url, ...(releases ? { publicURL: releases.publicURL } : {}),
    close() {
      if (closingPromise) return closingPromise;
      closing = true;
      closingPromise = (async () => {
        try {
          await new Promise((done, fail) => { server.close(error => error ? fail(error) : done()); server.closeIdleConnections(); });
        } finally { await releases?.close(); }
      })();
      return closingPromise;
    },
  };
}

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') { process.stdout.write(USAGE + '\n'); return null; }
  const manifests = Object.create(null), options = new Map();
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i], value = args[i + 1];
    if (!['--state', '--manifest', '--port', '--releases', '--release-state'].includes(flag) || !value || value.startsWith('--')) throw new TypeError(USAGE);
    if (flag === '--manifest') {
      const split = value.indexOf('=');
      if (split < 1 || Object.hasOwn(manifests, value.slice(0, split))) throw new TypeError(USAGE);
      manifests[value.slice(0, split)] = value.slice(split + 1);
    } else {
      if (options.has(flag)) throw new TypeError(USAGE);
      options.set(flag, value);
    }
  }
  const portText = options.get('--port') ?? '8402';
  if (!/^\d{1,5}$/.test(portText)) throw new TypeError(USAGE);
  let service, requestedClose = false, stopping;
  const signals = ['SIGTERM', 'SIGINT'];
  const stop = () => {
    requestedClose = true;
    if (service && !stopping) stopping = service.close().finally(() => {
      for (const signal of signals) process.off(signal, onSignal);
    });
    return stopping;
  };
  const onSignal = () => { stop()?.catch(() => { process.exitCode = 1; }); };
  // Embedded original SF82 sessions use handleSignals:false. Own signals before
  // startup can create its first session, including a signal received mid-boot.
  for (const signal of signals) process.once(signal, onSignal);
  try {
    service = await startFleetWorkspace({ stateDirectory: options.get('--state'), manifests, port: Number(portText),
      releasePlan: options.get('--releases'), releaseDirectory: options.get('--release-state') });
    if (requestedClose) { await stop(); return null; }
    process.stdout.write(JSON.stringify({ workspace: service.url, manifests: Object.keys(manifests),
      ...(service.publicURL ? { merchantIngress: service.publicURL } : {}) }) + '\n');
    return service;
  } catch (error) {
    for (const signal of signals) process.off(signal, onSignal);
    throw error;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(nativeError(error) + '\n'); process.exitCode = 1; });
}
