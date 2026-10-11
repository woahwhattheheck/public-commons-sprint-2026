#!/usr/bin/env node
// MIT. SF70 native, two-facilitator Stellar Bazaar operator: read-only discovery, never paid-resource calls.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRefreshCoordinator } from './refresh.mjs';

// Original independent public testnet facilitator sources. Do not infer seller ownership or endorsement.
export const PROVIDERS = Object.freeze([
  Object.freeze({ id: 'vellar', name: 'Vellar', origin: 'https://vellar-facilitator-testnet-production.up.railway.app' }),
  Object.freeze({ id: 'periplo', name: 'Periplo', origin: 'https://periplo-testnet.fly.dev' }),
]);
const NETWORKS = new Set(['stellar:testnet', 'stellar:pubnet']);
const PAGE_SIZE = 100;
const MAX_PAGES = 30;
const MAX_ENTRIES = 3000;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_STATIC_BYTES = 250 * 1024;
const PORT_MIN = 0;
const PORT_MAX = 65535;
const HERE = new URL('.', import.meta.url);
const STATIC = Object.freeze({
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.mjs': ['app.mjs', 'text/javascript; charset=utf-8'],
  '/offer-delta.mjs': ['offer-delta.mjs', 'text/javascript; charset=utf-8'],
  '/shortlist.mjs': ['shortlist.mjs', 'text/javascript; charset=utf-8'],
  '/offer-csv.mjs': ['offer-csv.mjs', 'text/javascript; charset=utf-8'],
  '/federated-query.mjs': ['federated-query.mjs', 'text/javascript; charset=utf-8'],
  '/ranking.mjs': ['../../../scf46-stellar-bazaar/src/ranking.mjs', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
});
const HEADERS = Object.freeze({
  'cache-control': 'no-store, max-age=0',
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
});
const fail = message => { throw new Error(message); };
const plain = item => item !== null && typeof item === 'object' && !Array.isArray(item);

function options(argv) {
  let port = 0;
  let network = 'stellar:testnet';
  const used = new Set();
  for (const arg of argv) {
    const idx = arg.indexOf('=');
    const key = arg.slice(0, idx);
    const value = arg.slice(idx + 1);
    if (idx === -1 || !['--port', '--network'].includes(key) || used.has(key)) fail('Usage: node server.mjs [--port=0..65535] [--network=stellar:testnet|stellar:pubnet]');
    used.add(key);
    if (key === '--port') {
      if (!/^(0|[1-9][0-9]{0,4})$/.test(value)) fail('INVALID_PORT');
      port = Number(value);
      if (port < PORT_MIN || port > PORT_MAX) fail('INVALID_PORT');
    } else {
      if (!NETWORKS.has(value)) fail('UNSUPPORTED_STELLAR_NETWORK');
      network = value;
    }
  }
  return { port, network };
}

async function boundedJson(response) {
  const size = Number(response.headers.get('content-length'));
  if (Number.isFinite(size) && size > MAX_PAGE_BYTES) fail('NATIVE_PAGE_TOO_LARGE');
  if (!response.body) fail('NATIVE_PAGE_EMPTY_BODY');
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_PAGE_BYTES) fail('NATIVE_PAGE_TOO_LARGE');
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (!length) fail('NATIVE_PAGE_EMPTY_BODY');
  try { return JSON.parse(Buffer.concat(chunks.map(x => Buffer.from(x)), length).toString('utf8')); }
  catch { fail('INVALID_NATIVE_JSON'); }
}

function nativePage(document, offset) {
  const rows = Array.isArray(document?.resources) ? document.resources :
    Array.isArray(document?.items) ? document.items :
    Array.isArray(document?.data?.resources) ? document.data.resources :
    Array.isArray(document?.data?.items) ? document.data.items : null;
  if (!rows || rows.length > PAGE_SIZE || rows.some(row => !plain(row))) fail('INVALID_NATIVE_RESOURCE_LIST');
  const paging = document.pagination ?? document.data?.pagination ?? {};
  if (!plain(paging)) fail('INVALID_NATIVE_PAGINATION');
  if (paging.offset !== undefined && paging.offset !== offset) fail('NATIVE_OFFSET_MISMATCH');
  const total = paging.total === undefined ? null : paging.total;
  if (total !== null && (!Number.isSafeInteger(total) || total < 0 || total > MAX_ENTRIES)) fail('INVALID_NATIVE_DECLARED_TOTAL');
  return { rows, total };
}

// This reader is intentionally pinned to the two observed original public sources.
// The browser cannot pick URLs or make seller calls; redirects and credentials are never forwarded.
export async function captureProvider(provider, network, fetchPage = fetch) {
  if (!PROVIDERS.some(x => x.id === provider?.id && x.origin === provider.origin)) fail('UNAPPROVED_FACILITATOR_ORIGIN');
  if (!NETWORKS.has(network)) fail('UNSUPPORTED_STELLAR_NETWORK');
  let offset = 0;
  let declaredTotal = null;
  const gathered = [];
  let pages = 0;
  let coverage = null;
  while (pages < MAX_PAGES) {
    const url = new URL('/discovery/resources', provider.origin);
    url.searchParams.set('network', network);
    url.searchParams.set('limit', String(PAGE_SIZE));
    url.searchParams.set('offset', String(offset));
    const response = await fetchPage(url.href, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(12_000),
      headers: { accept: 'application/json' },
    });
    if (!response.ok) fail('FACILITATOR_HTTP_' + response.status);
    const { rows, total } = nativePage(await boundedJson(response), offset);
    if (declaredTotal !== null && total !== null && total !== declaredTotal) fail('NATIVE_TOTAL_CHANGED_DURING_PAGING');
    if (total !== null) declaredTotal = total;
    gathered.push(...rows);
    pages++;
    if (gathered.length > MAX_ENTRIES) fail('MAX_NATIVE_RESOURCES_EXCEEDED');
    if (declaredTotal !== null) {
      if (gathered.length > declaredTotal) fail('NATIVE_OVERFULL_DECLARED_TOTAL');
      if (gathered.length === declaredTotal) { coverage = 'DECLARED_TOTAL_MATCHED'; break; }
      if (rows.length === 0) fail('NATIVE_PAGINATION_PREMATURE_EMPTY');
    } else if (rows.length < PAGE_SIZE) {
      coverage = 'LAST_SHORT_PAGE_WITHOUT_DECLARED_TOTAL';
      break;
    }
    if (rows.length === 0) fail('NATIVE_PAGINATION_STALLED');
    offset += rows.length;
  }
  if (!coverage) fail('NATIVE_PAGINATION_PAGE_LIMIT');
  return {
    provider: provider.id, name: provider.name, endpoint: new URL('/discovery/resources', provider.origin).href,
    status: 'COMPLETE_GET_CAPTURE', network, observedAt: new Date().toISOString(),
    coverage, declaredTotal, rows: gathered.length, pages,
    listings: gathered.map((row, index) => ({ ...shapeListing(row), source: provider.id, sourceRow: index + 1 })),
  };
}

function asText(x, maximum = 1800) { return typeof x === 'string' ? x.slice(0, maximum) : ''; }
function shapeListing(row) {
  const resource = plain(row.resource) ? row.resource : {};
  const ext = row.extensions?.bazaar?.info ?? {};
  const data = plain(ext) ? ext : {};
  // The original v2 Bazaar operation declaration lives below info.input.
  const input = plain(data.input) ? data.input : {};
  const rawAddress = typeof row.resource === 'string' ? row.resource : (resource.url ?? row.url);
  const url = asText(rawAddress);
  // These fields are displayed only, never used as fetch destinations.
  const terms = Array.isArray(row.accepts) ? row.accepts.slice(0, 40).map(option => plain(option) ? ({
    network: asText(option.network), scheme: asText(option.scheme), asset: asText(option.asset),
    payTo: asText(option.payTo), amount: typeof option.amount === 'string' || typeof option.amount === 'number' ? String(option.amount).slice(0, 150) : '',
  }) : {}) : [];
  return {
    url, label: asText(resource.serviceName ?? resource.name ?? row.serviceName ?? row.name, 200) || (url || 'Unnamed resource'),
    description: asText(resource.description ?? row.description ?? data.description, 500),
    kind: asText(input.type ?? data.type ?? row.type, 40),
    method: asText(input.method ?? data.method ?? row.method, 32).trim().toUpperCase(),
    toolName: asText(input.toolName ?? input.name ?? data.toolName, 150),
    routeTemplate: asText(input.routeTemplate ?? data.routeTemplate, 240),
    paymentOptions: terms,
    hiddenPaymentOptions: Array.isArray(row.accepts) ? Math.max(0, row.accepts.length - terms.length) : 0,
  };
}

export async function readFederation(network = 'stellar:testnet', capture = captureProvider) {
  if (!NETWORKS.has(network)) fail('UNSUPPORTED_STELLAR_NETWORK');
  const observedAt = new Date().toISOString();
  const results = await Promise.all(PROVIDERS.map(async provider => {
    try { return await capture(provider, network); }
    catch (error) { return { provider: provider.id, name: provider.name,
      endpoint: new URL('/discovery/resources', provider.origin).href, network, status: 'SOURCE_ERROR',
      error: String(error?.message ?? error).slice(0, 180), coverage: 'UNAVAILABLE', rows: 0,
      listings: [] }; }
  }));
  const listings = results.flatMap(x => x.listings);
  return { schema: 'SCF-SF70/federated-native-bazaar-v1', observedAt, network,
    state: results.every(x => x.status === 'COMPLETE_GET_CAPTURE') ? 'BOTH_SOURCES_COMPLETE' :
      results.some(x => x.status === 'COMPLETE_GET_CAPTURE') ? 'PARTIAL_SOURCE_FAILURE' : 'NO_SOURCES_AVAILABLE',
    sources: results.map(({ listings: _listings, ...rest }) => rest),
    observedListingRows: listings.length, listings,
    interpretation: 'Independently sourced advertised entries. Two providers can show different resource catalogs; absence in one is not a seller failure or payment conflict. No cross-provider route equality, seller ownership, paid delivery, verification or settlement is asserted.',
    merchantRequests: 0, payments: 0, signatures: 0,
  };
}

export async function start({ port = 0, network = 'stellar:testnet' } = {}) {
  if (!Number.isSafeInteger(port) || port < PORT_MIN || port > PORT_MAX) fail('INVALID_PORT');
  if (!NETWORKS.has(network)) fail('UNSUPPORTED_STELLAR_NETWORK');
  // A shared native fetch for concurrent local tabs; only complete captures are briefly reusable.
  const coordinatedCapture = createRefreshCoordinator(readFederation);
  const server = createServer(async (req, res) => {
    for (const [key, value] of Object.entries(HEADERS)) res.setHeader(key, value);
    const localPort = server.address()?.port;
    const peer = req.socket.remoteAddress;
    if (req.headers.host !== `127.0.0.1:${localPort}` || !['127.0.0.1', '::ffff:127.0.0.1'].includes(peer)) {
      res.writeHead(403); res.end('Loopback-only'); return;
    }
    if (req.method !== 'GET') { res.writeHead(405, {allow:'GET'}); res.end('GET only'); return; }
    const path = req.url;
    if (path === '/api/federated' || path === '/api/federated?refresh=1') {
      try {
        const result = await coordinatedCapture(network, { force: path.endsWith('?refresh=1') });
        const payload = JSON.stringify(result);
        res.writeHead(result.state === 'NO_SOURCES_AVAILABLE' ? 502 : 200,
          {'content-type': 'application/json; charset=utf-8'});
        res.end(payload);
      } catch (error) {
        res.writeHead(502, {'content-type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({state:'FETCH_ERROR',error:String(error?.message??error).slice(0,160)}));
      }
      return;
    }
    if (Object.hasOwn(STATIC, path)) {
      const [name, contentType] = STATIC[path];
      try {
        const body = await readFile(new URL(name, HERE));
        if (body.length > MAX_STATIC_BYTES) fail('STATIC_TOO_LARGE');
        res.writeHead(200, {'content-type':contentType});res.end(body);
      } catch { res.writeHead(500);res.end('Static file unavailable'); }
      return;
    }
    res.writeHead(404);res.end('Not found');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  start(options(process.argv.slice(2))).then(server => {
    process.stdout.write(`SF70 native federated operator: http://127.0.0.1:${server.address().port}/ (two original live public providers; GET only)\n`);
  }).catch(error => {process.stderr.write('SF70: '+String(error?.message ?? error)+'\n');process.exitCode = 1;});
}
