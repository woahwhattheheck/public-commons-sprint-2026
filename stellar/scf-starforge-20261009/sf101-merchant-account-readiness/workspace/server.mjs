// MIT. Private HTTP composition for the original SF101 receiving workspace.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {openReceivingWorkspace, workspaceFault, workspaceErrorCode} from './controller.mjs';

const MIB = 1024 * 1024;
const PROFILE_LIMIT = 5 * MIB;
// Original 96 MiB decoded bundle plus three 1 MiB source files, base64 + JSON.
const IMPORT_LIMIT = 136 * MIB;
const ID = '[a-z0-9]{8,13}-[a-f0-9]{16}';
const POLICY = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'";
const ASSETS = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const need = (condition, code, status = 400) => { if (!condition) throw workspaceFault(code, status); };
const encoded = value => Buffer.from(JSON.stringify(value) + '\n');
function mountPath(value) {
  need(typeof value === 'string' && /^(?:\/[A-Za-z0-9_-]+)*$/.test(value), 'INVALID_RECEIVING_BASE_PATH');
  return value;
}
function reply(req, res, status, bytes, type = 'application/json; charset=utf-8', extra = {}) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, {'content-type':type, 'content-length':bytes.length,
    'cache-control':'no-store', 'x-content-type-options':'nosniff',
    'referrer-policy':'no-referrer', 'cross-origin-resource-policy':'same-origin',
    'content-security-policy':POLICY, ...extra});
  res.end(req.method === 'HEAD' ? undefined : bytes);
}
function pagination(url, profiles) {
  const allowed = profiles ? ['after','limit'] : ['after','limit','profileId'];
  need([...url.searchParams.keys()].every(key => allowed.includes(key) &&
    url.searchParams.getAll(key).length === 1), 'INVALID_WORKSPACE_QUERY');
  const result = Object.fromEntries(url.searchParams);
  if (result.limit !== undefined) {
    need(/^[1-9][0-9]{0,2}$/.test(result.limit), 'INVALID_WORKSPACE_PAGE_SIZE');
    result.limit = Number(result.limit);
  }
  return result;
}
async function readJson(req, max, pendingBodies) {
  need(/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? ''),
    'JSON_CONTENT_TYPE_REQUIRED', 415);
  need(req.headers['content-encoding'] === undefined || req.headers['content-encoding'] === 'identity',
    'COMPRESSED_REQUEST_NOT_SUPPORTED', 415);
  const declared = req.headers['content-length'];
  if (declared !== undefined) need(/^\d+$/.test(declared) && Number(declared) <= max,
    'WORKSPACE_REQUEST_TOO_LARGE', 413);
  pendingBodies.add(req);
  try {
    const bytes = await new Promise((done, fail) => {
      let size = 0; const chunks = [];
      const finish = (error, value) => {
        clearTimeout(timer); req.off('data', data); req.off('end', end);
        req.off('error', broken); req.off('aborted', aborted);
        if (error) { req.pause(); fail(error); } else done(value);
      };
      const data = chunk => {
        size += chunk.length;
        if (size > max) finish(workspaceFault('WORKSPACE_REQUEST_TOO_LARGE', 413));
        else chunks.push(chunk);
      };
      const end = () => finish(null, Buffer.concat(chunks, size));
      const broken = () => finish(workspaceFault('WORKSPACE_REQUEST_INTERRUPTED', 400));
      const aborted = () => finish(workspaceFault('WORKSPACE_REQUEST_INTERRUPTED', 400));
      const timer = setTimeout(() => finish(workspaceFault('WORKSPACE_REQUEST_TIMEOUT', 408)), 30000);
      req.on('data', data); req.once('end', end); req.once('error', broken); req.once('aborted', aborted);
      if (req.destroyed) aborted();
    });
    let value;
    try { value = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes)); }
    catch { throw workspaceFault('INVALID_INPUT_JSON'); }
    need(object(value), 'INVALID_WORKSPACE_REQUEST');
    return value;
  } finally { pendingBodies.delete(req); }
}

/** A private mount for an existing host. The caller retains the controller lease. */
export function createReceivingWorkspaceHandler({workspace, origins, basePath = '',
  token = randomBytes(32).toString('hex')} = {}) {
  need(workspace && typeof workspace.status === 'function', 'RECEIVING_CONTROLLER_REQUIRED');
  basePath = mountPath(basePath);
  need(Array.isArray(origins) && origins.length > 0, 'EXPLICIT_RECEIVING_ORIGINS_REQUIRED');
  const allowed = new Set(origins.map(value => {
    const url = new URL(value);
    need(['http:', 'https:'].includes(url.protocol) && url.origin === value && !url.username && !url.password,
      'INVALID_RECEIVING_ORIGIN');
    return url.origin;
  }));
  const hosts = new Set([...allowed].map(value => new URL(value).host.toLowerCase()));
  need(typeof token === 'string' && /^[a-f0-9]{64}$/.test(token), 'INVALID_RECEIVING_SESSION');
  const secret = Buffer.from(token), pendingBodies = new Set(), assets = new Map();
  let closing = false, largeTransfer = false, activeBodies = 0;
  const authorized = req => {
    const supplied = req.headers['x-receiving-session'];
    return typeof supplied === 'string' && Buffer.byteLength(supplied) === secret.length &&
      timingSafeEqual(Buffer.from(supplied), secret);
  };
  const handler = async (req, res) => {
    let url;
    try {
      need(typeof req.url === 'string' && req.url.startsWith('/') && !req.url.startsWith('//'), 'INVALID_REQUEST_TARGET');
      url = new URL(req.url, 'http://receiving.invalid');
    } catch (error) { reply(req, res, 400, encoded({error:workspaceErrorCode(error)})); return true; }
    if (basePath && url.pathname !== basePath && !url.pathname.startsWith(basePath + '/')) return false;
    const path = url.pathname.slice(basePath.length) || '/';
    try {
      need(!closing, 'RECEIVING_SERVER_CLOSING', 503);
      need(typeof req.headers.host === 'string' && hosts.has(req.headers.host.toLowerCase()), 'RECEIVING_HOST_REJECTED', 403);
      const origin = req.headers.origin;
      need(origin === undefined || allowed.has(origin), 'RECEIVING_ORIGIN_REJECTED', 403);
      const site = req.headers['sec-fetch-site'];
      const landing = ['GET','HEAD'].includes(req.method) && path === '/' &&
        req.headers['sec-fetch-mode'] === 'navigate' && req.headers['sec-fetch-dest'] === 'document';
      need(site === undefined || site === 'same-origin' || site === 'none' || landing,
        'RECEIVING_SITE_REJECTED', 403);
      if (basePath && url.pathname === basePath && ['GET','HEAD'].includes(req.method)) {
        reply(req, res, 308, Buffer.alloc(0), 'text/plain', {location:basePath + '/'}); return true;
      }
      if (['GET','HEAD'].includes(req.method) && ASSETS.has(path)) {
        need(!url.search, 'INVALID_WORKSPACE_QUERY');
        const [name, type] = ASSETS.get(path);
        if (!assets.has(name)) assets.set(name, readFile(new URL('./' + name, import.meta.url)));
        reply(req, res, 200, await assets.get(name), type); return true;
      }
      if (path === '/api/session' && ['GET','HEAD'].includes(req.method)) {
        need(!url.search, 'INVALID_WORKSPACE_QUERY');
        reply(req, res, 200, encoded({token})); return true;
      }
      need(path.startsWith('/api/'), 'RECEIVING_ROUTE_NOT_FOUND', 404);
      need(authorized(req), 'RECEIVING_SESSION_REQUIRED', 403);
      let result, status = 200;
      if (['GET','HEAD'].includes(req.method)) {
        if (path === '/api/profiles') result = await workspace.listProfiles(pagination(url, true));
        else if (path === '/api/reviews') result = await workspace.listReviews(pagination(url, false));
        else {
          need(!url.search, 'INVALID_WORKSPACE_QUERY');
          let match;
          if (path === '/api/state') result = await workspace.status();
          else if ((match = path.match(new RegExp('^/api/profiles/(' + ID + ')$')))) result = await workspace.getProfile(match[1]);
          else if ((match = path.match(new RegExp('^/api/reviews/(' + ID + ')$')))) result = await workspace.getReview(match[1]);
          else if ((match = path.match(new RegExp('^/api/reviews/(' + ID + ')/export$')))) {
            need(!largeTransfer, 'RECEIVING_REQUEST_BUSY', 429); largeTransfer = true;
            try {
              const bytes = await workspace.exportReview(match[1]);
              const sent = new Promise(done => {
                const finish = () => { res.off('finish', finish); res.off('close', finish); done(); };
                res.once('finish', finish); res.once('close', finish);
              });
              reply(req, res, 200, bytes, 'application/json; charset=utf-8',
                {'content-disposition':'attachment; filename="receiving-review-' + match[1] + '.json"'});
              if (!res.destroyed) await sent;
            } finally { largeTransfer = false; }
            return true;
          } else throw workspaceFault('RECEIVING_ROUTE_NOT_FOUND', 404);
        }
      } else if (req.method === 'POST') {
        need(!url.search, 'INVALID_WORKSPACE_QUERY');
        const cancelling = path.match(new RegExp('^/api/reviews/(' + ID + ')/cancel$'));
        need(['/api/profiles','/api/reviews','/api/compare','/api/import'].includes(path) || cancelling,
          'RECEIVING_ROUTE_NOT_FOUND', 404);
        const importing = path === '/api/import';
        need(activeBodies < 4 && (!importing || !largeTransfer), 'RECEIVING_REQUEST_BUSY', 429);
        activeBodies++; if (importing) largeTransfer = true;
        try {
          const input = await readJson(req, importing ? IMPORT_LIMIT : PROFILE_LIMIT, pendingBodies);
          if (path === '/api/profiles') { result = await workspace.createProfile(input); status = 201; }
          else if (path === '/api/reviews') { result = await workspace.startReview(input); status = 202; }
          else if (path === '/api/compare') result = await workspace.compare(input);
          else if (path === '/api/import') { result = await workspace.importReview(input); status = 201; }
          else { need(Object.keys(input).length === 0, 'INVALID_WORKSPACE_REQUEST'); result = await workspace.cancelReview(cancelling[1]); status = 202; }
        } finally { activeBodies--; if (importing) largeTransfer = false; }
      } else throw workspaceFault('RECEIVING_METHOD_NOT_ALLOWED', 405);
      reply(req, res, status, encoded(result));
    } catch (error) {
      const status = error.status ?? (error.code === 'ENOENT' ? 404 : 500);
      const unfinished = !req.complete && req.method !== 'GET' && req.method !== 'HEAD';
      if (unfinished) res.once('finish', () => req.destroy());
      reply(req, res, status, encoded({error:workspaceErrorCode(error)}), 'application/json; charset=utf-8',
        {...(unfinished ? {connection:'close'} : {}), ...(status === 405 ? {allow:'GET, HEAD, POST'} : {})});
    }
    return true;
  };
  handler.close = () => { closing = true; for (const req of pendingBodies) req.destroy(); };
  return handler;
}

/** Own a loopback server and the original controller; composable hosts use the handler. */
export async function startReceivingWorkspace({port = 8408, basePath = '', ...options} = {}) {
  need(Number.isInteger(port) && port >= 0 && port <= 65535, 'INVALID_RECEIVING_PORT');
  basePath = mountPath(basePath);
  const workspace = await openReceivingWorkspace(options);
  let handler, closed;
  const server = createServer(async (req, res) => {
    if (!handler || !await handler(req, res)) reply(req, res, 404, encoded({error:'RECEIVING_ROUTE_NOT_FOUND'}));
  });
  server.requestTimeout = 45000; server.headersTimeout = 10000; server.keepAliveTimeout = 2000;
  try {
    await new Promise((done, fail) => {
      server.once('error', fail); server.listen(port, '127.0.0.1', () => { server.off('error', fail); done(); });
    });
    const assigned = server.address().port, origin = 'http://127.0.0.1:' + assigned;
    handler = createReceivingWorkspaceHandler({workspace, origins:[origin, 'http://localhost:' + assigned], basePath});
    return {server, workspace, url:origin + basePath + '/', close() {
      return closed ??= (async () => {
        handler.close();
        const stopped = new Promise((done, fail) => server.close(error => error ? fail(error) : done()));
        server.closeIdleConnections?.();
        try { await workspace.close(); }
        finally { server.closeAllConnections?.(); await stopped; }
      })();
    }};
  } catch (error) { server.closeAllConnections?.(); server.close(); await workspace.close(); throw error; }
}

export const workspaceUsage = [
  'Usage: merchant-readiness workspace --directory /absolute/private/receiving-desk [--port 8408]',
  '',
  'Opens the saved merchant receiving desk on 127.0.0.1. Add the original seller JSON',
  'in the browser, review every payment choice, run native receiving reads, replay',
  'and compare retained observations, and export or import the complete private review.',
  'Existing workspaces reopen their original configurations and review history.',
  'Optional --base-path /merchant/receiving mounts the desk beneath that URL path.',
  'Guide: ../RECEIVING_DESK.md',
].join('\n');

export async function main(argv = process.argv.slice(2)) {
  if (!argv.length || argv.includes('--help')) { console.log(workspaceUsage); return; }
  const values = new Map(), allowed = new Set(['--directory','--port','--base-path']);
  for (let index = 0; index < argv.length; index += 2) {
    need(allowed.has(argv[index]) && !values.has(argv[index]) && argv[index + 1] &&
      !argv[index + 1].startsWith('--'), 'INVALID_COMMAND_ARGUMENT');
    values.set(argv[index], argv[index + 1]);
  }
  need(values.has('--directory'), 'WORKSPACE_DIRECTORY_REQUIRED');
  const port = values.get('--port') ?? '8408';
  need(/^(0|[1-9][0-9]{0,4})$/.test(port), 'INVALID_RECEIVING_PORT');
  const app = await startReceivingWorkspace({directory:values.get('--directory'), port:Number(port),
    basePath:values.get('--base-path') ?? ''});
  let shuttingDown = false;
  const stop = async () => {
    if (shuttingDown) return; shuttingDown = true;
    try { await app.close(); }
    catch (error) { console.error(JSON.stringify({error:workspaceErrorCode(error)})); process.exitCode = 3; }
    finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
  };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  console.log(JSON.stringify({url:app.url, directory:values.get('--directory')}));
  return app;
}
