// MIT. Local command finder over a current maintained distribution snapshot.
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readBrowserAssets } from '../browser-assets.mjs';
import { exportCommandCatalog, searchCommandCatalog } from './catalog.mjs';
import { loadCommandCatalog } from './load.mjs';

const HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'",
};
function filters(parameters) {
  const allowed = new Set(['q', 'kind', 'source', 'feature', 'page', 'pageSize']);
  for (const key of parameters.keys()) {
    if (!allowed.has(key) || parameters.getAll(key).length !== 1)
      throw new TypeError('Unknown or repeated query option: ' + key);
  }
  return {
    query: parameters.get('q') ?? '', kind: parameters.get('kind') ?? 'all',
    source: parameters.get('source') ?? '', feature: parameters.get('feature') ?? '',
    page: parameters.has('page') ? Number(parameters.get('page')) : 1,
    pageSize: parameters.has('pageSize') ? Number(parameters.get('pageSize')) : 50,
  };
}
function send(response, status, body, type = 'application/json; charset=utf-8', extra = {}, head = false) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  response.writeHead(status, { ...HEADERS, 'content-type': type, 'content-length': bytes.length, ...extra });
  response.end(head ? undefined : bytes);
}

export async function startDiscoveryServer({ sourceRoot, selection, port = 0, host = '127.0.0.1' } = {}) {
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new TypeError('Port must be 0–65535.');
  if (!['127.0.0.1', 'localhost', '::1'].includes(host))
    throw new TypeError('Select a local listener: 127.0.0.1, localhost or ::1.');
  const assets = await readBrowserAssets(new URL('./browser-assets.json', import.meta.url));
  let catalog = await loadCommandCatalog({ sourceRoot, selection });
  let refreshing = null;
  const refresh = () => {
    refreshing ??= loadCommandCatalog({ sourceRoot, selection }).then(value => { catalog = value; return value; })
      .finally(() => { refreshing = null; });
    return refreshing;
  };
  const instanceId = randomUUID();
  const health = () => ({ schema: 'stellar-forge.operator-discovery-health.v1',
    instanceId, package: catalog.package, capturedAt: catalog.capturedAt, counts: catalog.counts });
  const server = createServer(async (request, response) => {
    const head = request.method === 'HEAD';
    try {
      if (request.method !== 'GET' && !head)
        return send(response, 405, { error: 'Use GET or HEAD.' }, undefined, { allow: 'GET, HEAD' }, head);
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname === '/api/health') return send(response, 200, health(), undefined, {}, head);
      if (url.pathname === '/api/catalog') {
        if (url.search) throw new TypeError('The catalog endpoint takes no query options.');
        return send(response, 200, await refresh(), undefined, {}, head);
      }
      if (url.pathname === '/api/search') return send(response, 200,
        searchCommandCatalog(catalog, filters(url.searchParams)), undefined, {}, head);
      if (url.pathname === '/api/export') return send(response, 200,
        exportCommandCatalog(catalog, filters(url.searchParams)), undefined,
        { 'content-disposition': 'attachment; filename="starforge-command-catalog.json"' }, head);
      const asset = assets.get(url.pathname);
      if (!asset) return send(response, 404, { error: 'Catalog resource not found.' }, undefined, {}, head);
      return send(response, 200, await readFile(asset.url), asset.type, {}, head);
    } catch (error) {
      if (!response.headersSent) send(response, error instanceof TypeError ? 400 : 500,
        { error: error.message }, undefined, {}, head);
      else response.destroy(error);
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  const hostname = address.address.includes(':') ? '[' + address.address + ']' : address.address;
  const url = 'http://' + hostname + ':' + address.port + '/';
  let closing;
  const close = () => closing ??= new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeIdleConnections();
  });
  return { server, url, close, instanceId, health };
}
