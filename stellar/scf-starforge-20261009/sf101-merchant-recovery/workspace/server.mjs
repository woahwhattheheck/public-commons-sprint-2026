// MIT. Loopback HTTP transport for the original SF101 recovery workspace.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { openRecoveryWorkspace } from './model.mjs';
import { publishRecoveryWorkspaceLaunch, retireRecoveryWorkspaceLaunch, recoveryLaunchView, RECOVERY_LAUNCH_FILE } from './connection.mjs';
import {createSourceEditionDeliveryRoutes} from '../../../scf_2026/sf49_data_commissioning/source-edition-http.mjs';
import { readBrowserAssets } from '../../distribution/browser-assets.mjs';

const MAX_BODY = 65536;
const TYPES = await readBrowserAssets(new URL('./browser-assets.json', import.meta.url));

function fail(code, message, status = 400) {
  const error = new Error(message); error.code = code; error.status = status; throw error;
}
function responseError(error) {
  const value = { code: String(error.code ?? 'RECOVERY_WORKSPACE_FAILED').slice(0, 100),
    message: String(error.message ?? 'The recovery workspace request failed').slice(0, 500) };
  for (const key of ['status', 'providerCode', 'originalCode', 'requestId', 'putRequestId', 'retryAfter', 'retryable', 'mayHaveCommitted', 'reconciliationCode', 'reconciliationStatus'])
    if (['string', 'number', 'boolean'].includes(typeof error[key])) value[key] = error[key];
  const evidence=error.objectRecoveryResult?.nativeEvidence;
  if(evidence&&/^[a-f0-9]{64}$/.test(evidence.sha256)&&Number.isSafeInteger(evidence.bytes)&&evidence.bytes>0)
    value.nativeEvidence={sha256:evidence.sha256,bytes:evidence.bytes};
  return value;
}
function headers(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'");
}
function send(res, status, body, type = 'application/json; charset=utf-8') {
  if (res.writableEnded || res.destroyed) return;
  const data = Buffer.isBuffer(body) ? body : Buffer.from(type.startsWith('application/json') ? JSON.stringify(body) + '\n' : body);
  headers(res); res.writeHead(status, { 'Content-Type': type, 'Content-Length': data.length }); res.end(data);
}
function authorized(actual, expected) {
  if (typeof actual !== 'string' || actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}
function fields(value, allowed) {
  if (!value || Array.isArray(value) || typeof value !== 'object' ||
      Object.keys(value).some(key => !allowed.includes(key)))
    fail('WORKSPACE_INPUT_INVALID', 'Unexpected recovery request fields');
  return value;
}
function body(req) {
  if ((req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase() !== 'application/json')
    fail('WORKSPACE_JSON_REQUIRED', 'Send the recovery selection as application/json', 415);
  const length = req.headers['content-length'];
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > MAX_BODY))
    fail('WORKSPACE_REQUEST_TOO_LARGE', 'Recovery request exceeds 64 KiB', 413);
  return new Promise((resolve, reject) => {
    let size = 0, settled = false;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        if (!settled) { settled = true; const error = new Error('Recovery request exceeds 64 KiB'); error.code = 'WORKSPACE_REQUEST_TOO_LARGE'; error.status = 413; reject(error); }
        return;
      }
      if (!settled) chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { const error = new Error('Recovery request is not valid JSON'); error.code = 'WORKSPACE_JSON_INVALID'; error.status = 400; reject(error); }
    });
    req.on('aborted', () => { if (!settled) { settled = true; const error = new Error('Recovery request was interrupted'); error.code = 'WORKSPACE_REQUEST_INTERRUPTED'; error.status = 400; reject(error); } });
    req.on('error', error => { if (!settled) { settled = true; reject(error); } });
  });
}
function query(url, allowed) {
  const seen = new Set();
  for (const key of url.searchParams.keys()) {
    if (!allowed.includes(key) || seen.has(key)) fail('WORKSPACE_QUERY_INVALID', 'Unexpected or repeated recovery query field');
    seen.add(key);
  }
  return Object.fromEntries(url.searchParams);
}
function page(input) {
  const value = {};
  if (input.cursor) value.cursor = input.cursor;
  if (input.limit !== undefined) {
    if (!/^[1-9]\d{0,2}$/.test(input.limit) || Number(input.limit) > 100)
      fail('WORKSPACE_PAGE_LIMIT_INVALID', 'Page limit must be between 1 and 100');
    value.limit = Number(input.limit);
  }
  return value;
}

// An embedding host can mount this exact handler after providing its owned
// workspace and exact loopback origin. Sensitive API responses require the token.
export function createRecoveryHandler({ workspace, token, origin, connection = null, isDraining = () => false }) {
  const expected = new URL(origin);
  if (expected.protocol !== 'http:' || expected.hostname !== '127.0.0.1' ||
      expected.pathname !== '/' || expected.search || expected.hash || expected.username || expected.password)
    fail('WORKSPACE_LOOPBACK_REQUIRED', 'Recovery workspace uses an exact loopback origin');
  if (!/^[a-f0-9]{64}$/.test(token ?? '')) fail('WORKSPACE_TOKEN_INVALID', 'A generated recovery session token is required');
  const assets = new Map();
  const binaryRoutes=createSourceEditionDeliveryRoutes({service:{
    dispatch(){fail('WORKSPACE_METHOD_INVALID','Use the original recovery request queue',405);},
    async artifact(input){
      fields(input,['id','kind','name']);
      if(input.kind!=='archive')fail('WORKSPACE_BUNDLE_ARCHIVE_REQUIRED','Select a completed bundle archive');
      return workspace.bundleArtifact(input.id,input.name);
    },
    async close(){}
  }});
  const recoveryHandler=async function recoveryHandler(req, res) {
    try {
      if (isDraining()) fail('WORKSPACE_DRAINING', 'The original recovery listener is draining; read its next launch before continuing', 503);
      if (!['127.0.0.1', '::ffff:127.0.0.1', '::1'].includes(req.socket.remoteAddress))
        fail('WORKSPACE_LOOPBACK_REQUIRED', 'Recovery workspace accepts local connections only', 403);
      if (req.headers.host !== expected.host) fail('WORKSPACE_HOST_REJECTED', 'Open the printed recovery workspace address', 403);
      if (req.headers.origin && req.headers.origin !== expected.origin)
        fail('WORKSPACE_ORIGIN_REJECTED', 'Recovery workspace requires its own origin', 403);
      if (req.headers['sec-fetch-site'] === 'cross-site')
        fail('WORKSPACE_ORIGIN_REJECTED', 'Recovery workspace requires its own origin', 403);
      const url = new URL(req.url, expected.origin);
      if (url.origin !== expected.origin) fail('WORKSPACE_ORIGIN_REJECTED', 'Invalid recovery request origin', 403);
      if (TYPES.has(url.pathname)) {
        if (!['GET', 'HEAD'].includes(req.method)) fail('WORKSPACE_METHOD_INVALID', 'Use GET for workspace assets', 405);
        if (url.search) fail('WORKSPACE_QUERY_INVALID', 'Workspace assets do not accept query parameters');
        const { url: assetUrl, type } = TYPES.get(url.pathname);
        if (!assets.has(assetUrl.href)) assets.set(assetUrl.href, await readFile(assetUrl));
        const data = assets.get(assetUrl.href);
        headers(res); res.writeHead(200, { 'Content-Type': type, 'Content-Length': data.length });
        res.end(req.method === 'HEAD' ? undefined : data); return;
      }
      if (!url.pathname.startsWith('/api/')) fail('WORKSPACE_ROUTE_NOT_FOUND', 'Unknown recovery workspace route', 404);
      if (!authorized(req.headers['x-recovery-token'], token))
        fail('WORKSPACE_SESSION_REQUIRED', 'Open the current browser URL printed by workspace serve', 401);
      if(url.pathname==='/api/commissioning/source-bundles/download'&&['GET','HEAD'].includes(req.method)){
        await binaryRoutes.handle(req,res,{origin:expected.origin});return;
      }
      if (req.method === 'GET') {
        let value;
        switch (url.pathname) {
          case '/api/state': query(url, []); value = await workspace.state(); break;
          case '/api/connection':
            query(url, []);
            if (!connection) fail('WORKSPACE_CONNECTION_NOT_AVAILABLE', 'This embedding host did not publish an original listener connection', 409);
            value = { ...connection, identity: await workspace.identity() }; break;
          case '/api/object-comparison-artifact': {const q=query(url,['profile','id','kind','sha256']);
            value=await workspace.comparisonArtifact(q.profile,q.id,q.kind,q.sha256);break;}
          case '/api/bundle-attachment': {const q=query(url,['profile','id','sha256','pair']);
            value=await workspace.bundleAttachment({profileId:q.profile,transferId:q.id,
              ...(q.sha256!==undefined?{archiveSha256:q.sha256}:{}),...(q.pair!==undefined?{pairSha256:q.pair}:{})});break;}
          case '/api/bundle-pair': {const q=query(url,['profile','before','after']);value=await workspace.bundlePair(q.profile,q.before,q.after);break;}
          case '/api/bundle-inspection': {const q=query(url,['profile','archive']);value=await workspace.bundleInspection(q.profile,q.archive);break;}
          case '/api/bundle-report': {const q=query(url,['profile','id','kind']);value=await workspace.bundleReport(q.profile,q.id,q.kind);break;}
          case '/api/bundle-artifact': {const q=query(url,['profile','id']);value=await workspace.bundleArtifact(q.profile,q.id);break;}
          case '/api/object-session': { const q=query(url,['profile','session']); value=await workspace.objectSession(q.profile,q.session); break; }
          case '/api/object-evidence': { const q=query(url,['sha256']); value=await workspace.objectEvidence(q.sha256); break; }
          case '/api/support-cases': {const q=query(url,['profile','q','offset','limit']);const input={};
            if(q.q!==undefined)input.q=q.q;for(const key of ['offset','limit'])if(q[key]!==undefined){
              if(!/^(0|[1-9][0-9]*)$/.test(q[key])||!Number.isSafeInteger(Number(q[key])))fail('WORKSPACE_QUERY_INVALID','Invalid Support page');
              input[key]=Number(q[key]);}value=await workspace.supportCases(q.profile,input);break;}
          case '/api/support-transfers': {const q=query(url,['profile']);value=await workspace.supportTransfers(q.profile);break;}
          case '/api/support-transfer': {const q=query(url,['profile','id']);value=await workspace.supportTransfer(q.profile,q.id);break;}
          case '/api/support-handoff': {const q=query(url,['profile','id']);value=await workspace.supportHandoff(q.profile,q.id);break;}
          case '/api/support-package': {const q=query(url,['profile','id']);value=await workspace.supportPackage(q.profile,q.id);break;}
          case '/api/request': { const q = query(url, ['profile', 'id']); value = await workspace.request(q.profile, q.id); break; }
          case '/api/requests': { const q = query(url, ['cursor', 'limit']); value = await workspace.requests(page(q)); break; }
          case '/api/bundles': { const q = query(url, ['profile']); value = await workspace.localBundles(q.profile); break; }
          case '/api/operations': { const q = query(url, ['profile', 'cursor', 'limit']); value = await workspace.operations(q.profile, page(q)); break; }
          case '/api/operation': { const q = query(url, ['profile', 'id']); value = await workspace.operation(q.profile, q.id); break; }
          case '/api/inventory': { const q = query(url, ['profile', 'cursor', 'limit']); value = await workspace.inventory(q.profile, page(q)); break; }
          default: fail('WORKSPACE_ROUTE_NOT_FOUND', 'Unknown recovery workspace route', 404);
        }
        send(res, 200, value); return;
      }
      if (req.method === 'POST') {
        query(url, []);
        const value = await body(req);
        if (isDraining()) fail('WORKSPACE_DRAINING', 'The original recovery listener is draining; read the retained request before continuing', 503);
        let result;
        switch (url.pathname) {
          case '/api/bundle-attach': result=await workspace.bundleAttach(value);break;
          case '/api/bundle-pair-attach': result=await workspace.bundlePairAttach(value);break;
          case '/api/bundle-case-export': result=await workspace.bundleCaseExport(value);break;
          case '/api/support-review': result=await workspace.supportReview(value);break;
          case '/api/support-save': result=await workspace.supportSave(value);break;
          case '/api/support-export': result=await workspace.supportExport(value);break;
          case '/api/review': result = await workspace.review(value); break;
          case '/api/start': fields(value, ['selection', 'expectedReviewHash']); result = await workspace.start(value); break;
          case '/api/resume': { fields(value,['profileId','id','expectedReviewHash','afterAttempt','quiesced']);
            const {profileId,id,...continuation}=value; result=await workspace.resume(profileId,id,continuation); break; }
          case '/api/cancel': fields(value, ['profileId', 'id']); result = await workspace.cancel(value.profileId, value.id); break;
          default: fail('WORKSPACE_ROUTE_NOT_FOUND', 'Unknown recovery workspace route', 404);
        }
        send(res, 200, result); return;
      }
      fail('WORKSPACE_METHOD_INVALID', 'Use the documented recovery workspace method', 405);
    } catch (error) {
      const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status :
        error.code === 'ENOENT' ? 404 : 500;
      send(res, status, { error: responseError(error) });
    }
  };
  recoveryHandler.close=()=>binaryRoutes.close();return recoveryHandler;
}

export async function serveRecoveryWorkspace({ configFile, directory, port = 8481 } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    fail('WORKSPACE_PORT_INVALID', 'Choose a TCP port from 0 through 65535');
  const workspace = await openRecoveryWorkspace({ configFile, directory });
  const token = randomBytes(32).toString('hex');
  let handler, closePromise, launch;
  let draining = false;
  const server = createServer((req, res) => handler ? handler(req, res) : send(res, 503, { error: { code: 'WORKSPACE_STARTING', message: 'Recovery workspace is starting' } }));
  server.requestTimeout = 120000;
  server.headersTimeout = 15000;
  server.keepAliveTimeout = 5000;
  let finish;
  const closed = new Promise(resolve => { finish = resolve; });
  try {
    await new Promise((resolve, reject) => {
      const failed = error => { server.off('listening', listening); reject(error); };
      const listening = () => { server.off('error', failed); resolve(); };
      server.once('error', failed); server.once('listening', listening);
      server.listen(port, '127.0.0.1');
    });
    const origin = 'http://127.0.0.1:' + server.address().port;
    launch = await publishRecoveryWorkspaceLaunch({ directory, identity: await workspace.identity(), origin, token });
    handler = createRecoveryHandler({ workspace, token, origin, connection: recoveryLaunchView(launch), isDraining: () => draining });
    const close = ({ cancelActive = true } = {}) => {
      draining = true;
      if (!closePromise) closePromise = (async () => {
        const stopped = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        server.closeIdleConnections();
        let retirementError;
        // Retire the session while this server still holds the original writer lease.
        // A later server can then publish its own launch without an unlink race.
        try { await retireRecoveryWorkspaceLaunch({ directory, instanceId: launch.instanceId }); }
        catch (error) { retirementError = error; }
        try { await handler?.close(); await workspace.close({ cancelActive }); await stopped; if (retirementError) throw retirementError; }
        finally { finish(); }
      })();
      return closePromise;
    };
    return { server, workspace, origin, url: origin + '/#token=' + token,
      connection: recoveryLaunchView(launch), connectionFile: directory + '/' + RECOVERY_LAUNCH_FILE, close, closed };
  } catch (error) {
    server.close();
    if (launch) await retireRecoveryWorkspaceLaunch({ directory, instanceId: launch.instanceId }).catch(() => {});
    await workspace.close({ cancelActive: true }); finish(); throw error;
  }
}
