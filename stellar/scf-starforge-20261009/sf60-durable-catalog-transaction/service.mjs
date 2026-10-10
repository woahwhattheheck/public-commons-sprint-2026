// MIT. Read-only HTTP delivery of the original SF60 durable Bazaar catalog.
import { createServer } from 'node:http';
import { stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDiscoveryServer } from '../../../scf46-stellar-bazaar/src/catalog.mjs';
import { DurableCatalogTransaction } from './journal.mjs';

const HOST = '127.0.0.1';
const FILE = 'catalog-commits.json';
const ROUTES = new Set(['/discovery/resources', '/discovery/search']);
const COMMON_HEADERS = Object.freeze({
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
});

/** Mount a journal already owned by an authenticated operator process.
 * Closing the HTTP listener does not close or mutate the supplied catalog.
 * The original journal remains responsible for admission, commit and retirement.
 */
export async function serveDiscovery({ catalog, port = 0 } = {}) {
  if (!(catalog instanceof DurableCatalogTransaction)) {
    throw new TypeError('An open original DurableCatalogTransaction is required');
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError('Invalid port');
  // Fail before listening if the existing owner's journal is closed/poisoned.
  catalog.list(new URLSearchParams({ limit: '1' }));
  const discovery = createDiscoveryServer(catalog);
  let origin = '';
  let closing;
  const server = createServer({ maxHeaderSize: 8192, requestTimeout: 10000,
    headersTimeout: 10000, keepAliveTimeout: 2000 }, (req, res) => {
    for (const [name, value] of Object.entries(COMMON_HEADERS)) res.setHeader(name, value);
    const reply = (status, value) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(value));
    };
    if (req.socket.localAddress !== HOST || req.socket.remoteAddress !== HOST ||
        req.headers.host !== origin.slice('http://'.length) ||
        (req.headers.origin && req.headers.origin !== origin) ||
        req.headers['sec-fetch-site'] === 'cross-site') {
      return reply(403, { error: 'LOCAL_ORIGIN_REQUIRED' });
    }
    if (req.method !== 'GET') {
      res.setHeader('allow', 'GET');
      res.setHeader('connection', 'close');
      return reply(405, { error: 'GET_ONLY' });
    }
    if (req.headers['transfer-encoding'] ||
        (req.headers['content-length'] && req.headers['content-length'] !== '0')) {
      res.setHeader('connection', 'close');
      return reply(400, { error: 'REQUEST_BODY_NOT_ACCEPTED' });
    }
    if (typeof req.url !== 'string' || req.url.length > 4096 || !req.url.startsWith('/') || req.url.startsWith('//')) {
      return reply(400, { error: 'INVALID_REQUEST_TARGET' });
    }
    let url;
    try { url = new URL(req.url, origin); }
    catch { return reply(400, { error: 'INVALID_REQUEST_TARGET' }); }
    if (url.pathname === '/healthz' && !url.search) {
      try {
        const page = catalog.list(new URLSearchParams({ limit: '1' }));
        return reply(200, { status: 'ready', mode: 'READ_ONLY_DISCOVERY',
          activeResources: page.pagination.total, committedOperations: catalog.count,
          journalHead: catalog.head });
      } catch {
        return reply(503, { status: 'unavailable', error: 'JOURNAL_UNAVAILABLE' });
      }
    }
    if (!ROUTES.has(url.pathname)) return reply(404, { error: 'NOT_FOUND' });
    // Preserve the actual Bazaar response, filtering, ranking and cursor semantics.
    void discovery(req, res);
  });
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    else socket.destroy();
  });
  await new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(port, HOST, () => { server.off('error', fail); done(); });
  });
  origin = `http://${HOST}:${server.address().port}`;
  return {
    server, origin,
    close() {
      if (!closing) closing = new Promise((done, fail) => {
        server.close(error => error ? fail(error) : done());
        server.closeIdleConnections();
      });
      return closing;
    },
  };
}

/** Standalone owner: retain the original SF60 exclusive lock for the full service
 * lifetime. Never steal another writer's lock or modify its journal externally.
 */
export async function openDiscovery({ directory, port = 0, createEmpty = false } = {}) {
  if (typeof directory !== 'string' || !directory.trim()) throw new TypeError('Explicit journal directory required');
  if (typeof createEmpty !== 'boolean') throw new TypeError('createEmpty must be boolean');
  const target = resolve(directory);
  if (!createEmpty) {
    try {
      if (!(await stat(join(target, FILE))).isFile()) throw new Error('Not a regular journal file');
    } catch (error) {
      if (error.code === 'ENOENT') throw new Error('No existing catalog-commits.json; use --create-empty only for an intentionally empty catalog');
      throw error;
    }
  }
  let catalog;
  try { catalog = await DurableCatalogTransaction.open(target); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('SF60 journal already has an owner. Mount serveDiscovery({catalog}) inside that process or stop it cleanly first. The lock was preserved.');
    throw error;
  }
  let listener;
  try { listener = await serveDiscovery({ catalog, port }); }
  catch (error) { await catalog.close(); throw error; }
  let closing;
  return {
    server: listener.server, origin: listener.origin,
    close() {
      if (!closing) closing = (async () => {
        try { await listener.close(); }
        finally { await catalog.close(); }
      })();
      return closing;
    },
  };
}

const USAGE = 'node service.mjs --directory PATH [--port 0..65535] [--create-empty]';
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === '--help') {
      console.log(USAGE);
    } else {
      const options = {}, seen = new Set();
      for (let i = 0; i < args.length; i++) {
        const name = args[i];
        if (seen.has(name) || !['--directory', '--port', '--create-empty'].includes(name)) throw new Error(USAGE);
        seen.add(name);
        if (name === '--create-empty') { options.createEmpty = true; continue; }
        const value = args[++i];
        if (!value || value.startsWith('--')) throw new Error(USAGE);
        if (name === '--directory') options.directory = value;
        else {
          if (!/^\d{1,5}$/.test(value)) throw new Error(USAGE);
          options.port = Number(value);
        }
      }
      const service = await openDiscovery(options);
      console.log(JSON.stringify({ status: 'LISTENING', origin: service.origin,
        resources: service.origin + '/discovery/resources', search: service.origin + '/discovery/search',
        health: service.origin + '/healthz', ownership: 'EXCLUSIVE_SF60_OWNER', readOnly: true }));
      const stop = () => { service.close().catch(error => { console.error(error.message); process.exitCode = 1; }); };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
    }
  } catch (error) { console.error(String(error.message ?? error)); process.exitCode = 1; }
}
