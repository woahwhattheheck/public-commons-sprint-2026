/** MIT. Static buyer console on the original authenticated loopback workspace. */
import {readFile} from 'node:fs/promises';

const assets = new Map([
  ['/console/', ['index.html', 'text/html; charset=utf-8']],
  ['/console/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']],
  ['/console/client.mjs', ['client.mjs', 'text/javascript; charset=utf-8']],
  ['/console/style.css', ['style.css', 'text/css; charset=utf-8']],
]);
const security = {
  'cache-control':'no-store', 'x-content-type-options':'nosniff',
  'referrer-policy':'no-referrer', 'x-frame-options':'DENY',
  'content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src blob:; media-src blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};

/** The shell contains no workspace data or token. Every data call stays in MCP. */
export function createOperatorConsoleHandler(mcpHandler, {origin}) {
  const expected = new URL(origin);
  if (expected.protocol !== 'http:' || expected.hostname !== '127.0.0.1' ||
      expected.pathname !== '/' || expected.search || expected.hash)
    throw new TypeError('The console requires the original loopback origin');
  return async (req, res) => {
    let path;
    try { path = new URL(req.url, origin).pathname; }
    catch { res.writeHead(400); res.end(); return; }
    if (path !== '/console' && !path.startsWith('/console/')) return mcpHandler(req, res);
    const finish = (status, body = '', headers = {}) => {
      res.writeHead(status, {...security, ...headers});
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    if (req.headers.host !== expected.host || (req.headers.origin && req.headers.origin !== origin))
      return finish(403, 'Use the configured loopback console address.');
    if (!['GET', 'HEAD'].includes(req.method)) return finish(405, '', {allow:'GET, HEAD'});
    if (path === '/console') return finish(302, '', {location:'/console/'});
    const asset = assets.get(path);
    if (!asset) return finish(404, 'Console asset not found.');
    try {
      const body = await readFile(new URL('./operator-ui/' + asset[0], import.meta.url));
      return finish(200, body, {'content-type':asset[1], 'content-length':body.length});
    } catch {
      return finish(500, 'Console asset unavailable. Keep the complete installed package.');
    }
  };
}
